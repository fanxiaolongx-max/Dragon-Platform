const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA_DIR } = require('./store');
const backupRepo = require('./global-backup-repository');
const usersRepo = require('./auth-users-repository');
const appDb = require('./app-db');
const tenantSqlitePool = require('./tenant-sqlite-pool');
const platformDb = require('./control-db'); // 团队登记在控制库
const { initializeTenantStorage } = require('./tenant-storage-initializer');
const { DEFAULT_TENANT_ID, getDataDir, getReportDataDir, getTenantId } = require('./tenant-context');

const CONFIRMATION_TEXT = 'RESET';
const RESET_ROOT = path.resolve(DATA_DIR, '../factory-reset-archives');
const WORKER_PATH = path.join(__dirname, '../scripts/factory-reset-worker.js');

function timestampForFile() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function writePrivateJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function prepareFactoryReset(options = {}) {
    if (String(options.confirmation || '').trim() !== CONFIRMATION_TEXT) {
        const error = new Error(`请输入 ${CONFIRMATION_TEXT} 确认彻底初始化`);
        error.statusCode = 400;
        throw error;
    }

    const username = String(options.actor || '').trim();
    const admin = await usersRepo.getUser(username);
    if (!admin || admin.role !== 'admin' || !admin.passwordHash) {
        const error = new Error('无法确认当前管理员身份，已取消初始化');
        error.statusCode = 403;
        throw error;
    }

    const tenantId = getTenantId();
    if (tenantId === DEFAULT_TENANT_ID) {
        const tenantCount = await platformDb.get('SELECT COUNT(*) AS count FROM tenants').catch(() => ({ count: 1 }));
        if (Number(tenantCount?.count || 0) > 1) {
            const error = new Error('为保护其他租户，默认租户存在其他租户记录时不能执行整库初始化；请切换到目标非默认租户后初始化该租户。');
            error.statusCode = 409;
            throw error;
        }
    }

    const backup = await backupRepo.createBackup({ reason: 'pre-factory-reset' });
    const archiveDir = path.join(RESET_ROOT, timestampForFile());

    if (tenantId !== DEFAULT_TENANT_ID) {
        const tenantDataDir = path.resolve(getDataDir(tenantId));
        const archivedDataDir = path.join(archiveDir, 'tenant-data');
        await appDb.closeDatabase();
        await tenantSqlitePool.closeAll();
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(tenantDataDir, archivedDataDir);
        try {
            await initializeTenantStorage(tenantId);
            const archivedBackup = path.join(archivedDataDir, 'backups', backup.name);
            if (fs.existsSync(archivedBackup)) {
                const liveBackupDir = path.join(tenantDataDir, 'backups');
                fs.mkdirSync(liveBackupDir, { recursive: true });
                fs.copyFileSync(archivedBackup, path.join(liveBackupDir, backup.name));
            }
        } catch (error) {
            fs.rmSync(tenantDataDir, { recursive: true, force: true });
            fs.renameSync(archivedDataDir, tenantDataDir);
            throw error;
        }
        return { success: true, backup: backup.name, archiveDir, needsRestart: false, tenantId };
    }

    const planPath = path.join(RESET_ROOT, `pending-${process.pid}-${Date.now()}.json`);
    writePrivateJson(planPath, {
        schemaVersion: 1,
        parentPid: process.pid,
        createdAt: new Date().toISOString(),
        dataDir: path.resolve(getDataDir()),
        reportDataDir: path.resolve(getReportDataDir()),
        archiveDir,
        admin: { username, role: 'admin', passwordHash: admin.passwordHash }
    });

    const child = spawn(process.execPath, [WORKER_PATH, planPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
    child.unref();

    return {
        success: true,
        backup: backup.name,
        archiveDir,
        needsRestart: true
    };
}

module.exports = { CONFIRMATION_TEXT, prepareFactoryReset };
