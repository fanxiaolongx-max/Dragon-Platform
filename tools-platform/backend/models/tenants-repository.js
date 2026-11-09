const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { all, get, run } = require('./control-db');
const { DEFAULT_TENANT_ID, getDataDir, TENANTS_ROOT } = require('./tenant-context');
const appDb = require('./app-db');
const tenantPool = require('./tenant-sqlite-pool');
const { initializeTenantStorage } = require('./tenant-storage-initializer');

let initPromise;
function tenantError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

async function ensureReady() {
    if (!initPromise) initPromise = (async () => {
        await run(`CREATE TABLE IF NOT EXISTS tenants (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        await run(`INSERT OR IGNORE INTO tenants (id, name, description, status) VALUES (?, ?, ?, 'active')`,
            [DEFAULT_TENANT_ID, '默认租户', '升级租户模式前的现有业务数据']);
    })().catch(error => { initPromise = null; throw error; });
    return initPromise;
}

function publicTenant(row) {
    return row && { id: row.id, name: row.name, description: row.description || '', status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function requireTenantId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(raw)) throw tenantError('租户标识无效');
    return raw;
}

async function listTenantsForUser(username, role) {
    await ensureReady();
    const rows = await all(`SELECT * FROM tenants WHERE status = 'active'
        ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END, created_at`, [DEFAULT_TENANT_ID]);
    return rows.map(publicTenant);
}

async function listManagedTenants() {
    await ensureReady();
    const rows = await all(`SELECT * FROM tenants
        ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END,
                 CASE status WHEN 'active' THEN 0 ELSE 1 END,
                 created_at`, [DEFAULT_TENANT_ID]);
    return rows.map(publicTenant);
}

async function canAccess(username, role, tenantId) {
    await ensureReady();
    const id = requireTenantId(tenantId);
    return Boolean(await get(`SELECT id FROM tenants WHERE id=? AND status='active'`, [id]));
}

async function getTenantById(tenantId) {
    await ensureReady();
    return publicTenant(await get('SELECT * FROM tenants WHERE id=?', [requireTenantId(tenantId)]));
}

function createId(value, explicit = false) {
    const source = String(value || '').trim().toLowerCase();
    if (explicit) {
        if (source === DEFAULT_TENANT_ID) throw tenantError('default 是保留租户标识');
        if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(source)) throw tenantError('租户标识无效');
        return source;
    }
    const raw = source.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    if (/^[a-z0-9][a-z0-9_-]{0,62}$/.test(raw) && raw !== DEFAULT_TENANT_ID) return raw;
    return `tenant-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

async function createTenant(input, options = {}) {
    const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
    const progress = entry => {
        if (!onProgress) return;
        try { onProgress(entry); } catch (_) {}
    };
    progress({ stage: 'validate', percent: 4, message: '正在校验租户名称与稳定标识', messageEn: 'Validating the tenant name and stable ID' });
    await ensureReady();
    const name = String(input?.name || '').trim();
    if (!name) throw tenantError('租户名称不能为空');
    const requestedId = String(input?.id || '').trim();
    const id = createId(requestedId || name, Boolean(requestedId));
    if (await get('SELECT id FROM tenants WHERE id=?', [id])) throw tenantError('租户标识已存在', 409);
    progress({ stage: 'validated', percent: 8, level: 'success', message: `租户标识 ${id} 可用，开始初始化独立存储`, messageEn: `Tenant ID ${id} is available; initializing isolated storage` });
    await initializeTenantStorage(id, progress);
    try {
        progress({ stage: 'registry', percent: 94, message: '正在写入全局租户登记表', messageEn: 'Registering the tenant in the global control plane' });
        await run('BEGIN IMMEDIATE');
        await run(`INSERT INTO tenants (id,name,description,status) VALUES (?,?,?,'active')`, [id, name, String(input?.description || '').trim()]);
        await run('COMMIT');
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        fs.rmSync(getDataDir(id), { recursive: true, force: true });
        throw error;
    }
    progress({ stage: 'scheduler', percent: 98, message: '正在启动租户独立备份调度', messageEn: 'Starting the tenant-specific backup scheduler' });
    try {
        await require('./global-backup-repository').startTenantAutoBackupScheduler(id);
    } catch (error) {
        console.warn(`[tenants] 启动租户 ${id} 自动备份调度失败：${error.message}`);
        progress({ stage: 'scheduler-warning', percent: 99, level: 'warn', message: `租户已创建，但备份调度启动失败：${error.message}`, messageEn: `The tenant was created, but its backup scheduler could not start: ${error.message}` });
    }
    progress({ stage: 'completed', percent: 100, level: 'success', message: `租户 ${name}（${id}）创建完成`, messageEn: `Tenant ${name} (${id}) was created successfully` });
    return publicTenant(await get('SELECT * FROM tenants WHERE id=?', [id]));
}

async function updateTenant(idValue, input) {
    await ensureReady();
    const id = requireTenantId(idValue);
    const current = await get('SELECT * FROM tenants WHERE id=?', [id]);
    if (!current) throw tenantError('租户不存在', 404);
    const name = String(input?.name ?? current.name).trim();
    if (!name) throw tenantError('租户名称不能为空');
    await run(`UPDATE tenants SET name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`, [name, String(input?.description ?? current.description ?? '').trim(), id]);
    return publicTenant(await get('SELECT * FROM tenants WHERE id=?', [id]));
}

async function archiveTenant(idValue) {
    await ensureReady();
    const id = requireTenantId(idValue);
    if (id === DEFAULT_TENANT_ID) throw tenantError('默认租户不能归档');
    const result = await run(`UPDATE tenants SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'`, [id]);
    if (!result.changes) throw tenantError('租户不存在或已归档', 404);
    await run('UPDATE auth_sessions SET active_tenant_id=? WHERE active_tenant_id=?', [DEFAULT_TENANT_ID, id]);
    require('./global-backup-repository').stopAutoBackupScheduler(id);
    require('./snapshot-publish-service').stopTenantScheduler(id);
    return { success: true, id };
}

async function restoreTenant(idValue) {
    await ensureReady();
    const id = requireTenantId(idValue);
    const tenant = await get(`SELECT * FROM tenants WHERE id=? AND status='archived'`, [id]);
    if (!tenant) throw tenantError('租户不存在或未归档', 404);
    if (!fs.existsSync(getDataDir(id))) throw tenantError('租户数据目录不存在，为避免创建空租户已停止恢复', 409);
    await run(`UPDATE tenants SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`, [id]);
    require('./global-backup-repository').startTenantAutoBackupScheduler(id).catch(error => {
        console.warn(`[tenants] 恢复租户 ${id} 后启动自动备份调度失败：${error.message}`);
    });
    await require('./snapshot-publish-service').scheduleTenant(id).catch(error => {
        console.warn(`[tenants] 恢复租户 ${id} 后启动静态推送调度失败：${error.message}`);
    });
    return publicTenant(await get('SELECT * FROM tenants WHERE id=?', [id]));
}

async function deleteTenantPermanently(idValue) {
    await ensureReady();
    const id = requireTenantId(idValue);
    if (id === DEFAULT_TENANT_ID) throw tenantError('默认租户不能删除');
    const tenant = await get(`SELECT * FROM tenants WHERE id=? AND status='archived'`, [id]);
    if (!tenant) throw tenantError('只能彻底删除已归档租户', 409);

    const tenantDir = path.resolve(getDataDir(id));
    const tenantRoot = path.resolve(TENANTS_ROOT);
    if (!tenantDir.startsWith(`${tenantRoot}${path.sep}`)) throw tenantError('租户数据目录越界，已拒绝删除', 400);
    const tombstone = `${tenantDir}.deleting-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const hasDirectory = fs.existsSync(tenantDir);

    require('./global-backup-repository').stopAutoBackupScheduler(id);
    require('./snapshot-publish-service').stopTenantScheduler(id);
    await Promise.all([appDb.closeTenant(id), tenantPool.closeTenant(id)]);
    if (hasDirectory) fs.renameSync(tenantDir, tombstone);
    try {
        await run('BEGIN IMMEDIATE');
        const userTenantsTable = await get(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_tenants'`);
        if (userTenantsTable) await run('DELETE FROM user_tenants WHERE tenant_id=?', [id]);
        await run('UPDATE auth_sessions SET active_tenant_id=? WHERE active_tenant_id=?', [DEFAULT_TENANT_ID, id]);
        const result = await run(`DELETE FROM tenants WHERE id=? AND status='archived'`, [id]);
        if (!result.changes) throw tenantError('租户状态已变化，删除已取消', 409);
        await run('COMMIT');
    } catch (error) {
        await run('ROLLBACK').catch(() => {});
        if (hasDirectory && fs.existsSync(tombstone) && !fs.existsSync(tenantDir)) fs.renameSync(tombstone, tenantDir);
        throw error;
    }

    try {
        if (hasDirectory) fs.rmSync(tombstone, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
    } catch (error) {
        console.error(`[tenants] 删除租户 ${id} 目录失败，正在回滚：${error.message}`);
        try {
            await run('BEGIN IMMEDIATE');
            await run(`INSERT INTO tenants (id,name,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
                [tenant.id, tenant.name, tenant.description || '', tenant.status, tenant.created_at, tenant.updated_at]);
            await run('COMMIT');
            if (fs.existsSync(tombstone) && !fs.existsSync(tenantDir)) fs.renameSync(tombstone, tenantDir);
        } catch (rollbackError) {
            await run('ROLLBACK').catch(() => {});
            console.error(`[tenants] 租户 ${id} 删除回滚失败：${rollbackError.message}`);
        }
        throw tenantError(`删除租户数据失败：${error.message}`, 500);
    }
    return { success: true, id };
}

module.exports = {
    DEFAULT_TENANT_ID,
    archiveTenant,
    canAccess,
    createTenant,
    deleteTenantPermanently,
    ensureReady,
    getTenantById,
    listManagedTenants,
    listTenantsForUser,
    restoreTenant,
    updateTenant
};
