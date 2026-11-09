// 平台账号（控制库 auth_users）。一个账号 = 一个团队 = 一个租户：tenant_id 是该账号的数据空间；
// is_super=1 的是超级管理员（平台级设置、增删账号、进入其他团队排障），其余账号都是自己团队里的管理员。
const { run, get, all } = require('./control-db');
// middleware/auth ↔ 会话库 ↔ 本模块有循环依赖，用到时再取
const hashUserPassword = password => require('../middleware/auth').hashUserPassword(password);
// 静态门户（超级管理员的静态页面推送）用旧 sha256 口令哈希包装站点密钥，浏览器端据此解锁，所以只给超级管理员空间的账号保留这一份
const legacyPortalHash = password => require('../middleware/auth').hashPassword(password);
const isLegacyHash = hash => require('../middleware/auth').isLegacyPasswordHash(hash);
const { DEFAULT_TENANT_ID } = require('./tenant-context');

let initPromise = null;

function getInitialAdmin() {
    return {
        username: process.env.INITIAL_ADMIN_USERNAME || 'admin',
        password: process.env.INITIAL_ADMIN_PASSWORD || 'admin123',
        role: 'admin'
    };
}

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS auth_users (
                    username TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            const columns = new Set((await all('PRAGMA table_info(auth_users)')).map(col => col.name));
            if (!columns.has('tenant_id')) await run(`ALTER TABLE auth_users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT '${DEFAULT_TENANT_ID}'`);
            if (!columns.has('is_super')) await run('ALTER TABLE auth_users ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0');
            if (!columns.has('display_name')) await run(`ALTER TABLE auth_users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`);
            if (!columns.has('portal_hash')) await run(`ALTER TABLE auth_users ADD COLUMN portal_hash TEXT NOT NULL DEFAULT ''`);
            const row = await get('SELECT COUNT(1) AS count FROM auth_users');
            const initial = getInitialAdmin();
            if (row && row.count === 0) {
                await run(
                    'INSERT INTO auth_users (username, role, password_hash, tenant_id, is_super, portal_hash) VALUES (?, ?, ?, ?, 1, ?)',
                    [initial.username, initial.role, hashUserPassword(initial.password), DEFAULT_TENANT_ID, legacyPortalHash(initial.password)]
                );
            }
            // 升级：还没有超级管理员时，初始管理员（没有就取最早的管理员）成为超级管理员并归属默认团队
            const hasSuper = await get('SELECT username FROM auth_users WHERE is_super=1 LIMIT 1');
            if (!hasSuper) {
                const candidate = await get(`SELECT username FROM auth_users WHERE username=? AND role='admin'`, [initial.username])
                    || await get(`SELECT username FROM auth_users WHERE role='admin' ORDER BY created_at ASC LIMIT 1`);
                if (candidate) await run('UPDATE auth_users SET is_super=1, tenant_id=? WHERE username=?', [DEFAULT_TENANT_ID, candidate.username]);
            }
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

function publicUser(row) {
    return row && {
        username: row.username,
        role: row.role,
        tenantId: row.tenant_id || DEFAULT_TENANT_ID,
        isSuper: Number(row.is_super) === 1,
        displayName: row.display_name || '',
        createdAt: row.created_at
    };
}

/** 静态门户可用的口令哈希：门户专用哈希，或尚未升级的旧密码哈希；都没有则该账号不能登录静态门户 */
function portalHashOf(row) {
    if (row.portal_hash) return row.portal_hash;
    return isLegacyHash(row.password_hash) ? row.password_hash : '';
}

async function listFromDb() {
    await ensureReady();
    const rows = await all('SELECT * FROM auth_users ORDER BY is_super DESC, created_at ASC');
    const result = {};
    for (const row of rows) result[row.username] = { ...publicUser(row), passwordHash: row.password_hash, portalHash: portalHashOf(row) };
    return result;
}

async function listUsers() {
    const items = await listFromDb();
    return { items, source: 'sqlite' };
}

async function getUser(username) {
    await ensureReady();
    const row = await get('SELECT * FROM auth_users WHERE username = ?', [username]);
    return row ? { ...publicUser(row), passwordHash: row.password_hash, portalHash: portalHashOf(row) } : null;
}

async function getUserByTenant(tenantId) {
    await ensureReady();
    const row = await get('SELECT * FROM auth_users WHERE tenant_id = ? ORDER BY is_super DESC, created_at ASC LIMIT 1', [tenantId]);
    return row ? publicUser(row) : null;
}

/** 新建账号（不存在才写入）。tenantId 必须已初始化。 */
async function createUser({ username, role = 'admin', passwordHash, tenantId, isSuper = false, displayName = '' }) {
    await ensureReady();
    await run(
        'INSERT INTO auth_users (username, role, password_hash, tenant_id, is_super, display_name) VALUES (?, ?, ?, ?, ?, ?)',
        [username, role, passwordHash, tenantId, isSuper ? 1 : 0, displayName]
    );
}

/** 兼容旧调用：只改角色与密码哈希，保留团队归属与超级管理员标记。 */
async function saveUser(username, role, passwordHash) {
    await ensureReady();
    const portalHash = isLegacyHash(passwordHash) ? passwordHash : '';
    const existing = await get('SELECT username FROM auth_users WHERE username=?', [username]);
    if (existing) {
        await run('UPDATE auth_users SET role=?, password_hash=?, portal_hash=? WHERE username=?', [role, passwordHash, portalHash, username]);
    } else {
        await run('INSERT INTO auth_users (username, role, password_hash, portal_hash) VALUES (?, ?, ?, ?)', [username, role, passwordHash, portalHash]);
    }
}

/** 换密码（有明文时调用）：超级管理员空间的账号同步门户哈希，团队账号不保留 */
async function setPassword(username, password) {
    await ensureReady();
    const row = await get('SELECT tenant_id FROM auth_users WHERE username=?', [username]);
    if (!row) return false;
    const portalHash = (row.tenant_id || DEFAULT_TENANT_ID) === DEFAULT_TENANT_ID ? legacyPortalHash(password) : '';
    await run('UPDATE auth_users SET password_hash=?, portal_hash=? WHERE username=?', [hashUserPassword(password), portalHash, username]);
    return true;
}

async function updatePasswordHash(username, passwordHash) {
    await ensureReady();
    const result = await run('UPDATE auth_users SET password_hash=? WHERE username=?', [passwordHash, username]);
    return result.changes > 0;
}

async function deleteUser(username) {
    await ensureReady();
    await run('DELETE FROM auth_users WHERE username = ?', [username]);
}

module.exports = {
    createUser,
    deleteUser,
    ensureReady,
    getUser,
    getUserByTenant,
    listUsers,
    saveUser,
    setPassword,
    updatePasswordHash
};
