const path = require('node:path');
const { initializeBuiltinTools } = require('./builtin-tools-sync');
const repo = require('./custom-tools-repository');
const { getDataDir, runWithTenant } = require('./tenant-context');

// 只处理调用方选定的租户；文件、备份和 SQLite 注册信息必须在同一个租户上下文中更新。
async function initializeTenantBuiltinTools(tenantId, { logger = console } = {}) {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(String(tenantId || ''))) throw new Error('无效的租户 ID');
    return runWithTenant(tenantId, async () => {
        const dataDir = getDataDir();
        const result = initializeBuiltinTools({
            sourceDir: repo.BUILTIN_TOOLS_DIR,
            targetDir: repo.getCustomToolsDir(),
            stateFile: path.join(dataDir, 'builtin-tools-sync-decisions.json'),
            backupRoot: path.join(dataDir, 'backups', 'builtin-tools'),
            logger
        });
        const reconcile = await repo.reconcileToolsFromDisk();
        const changed = [...result.installed, ...result.adopted, ...result.updated];
        if (changed.length) await repo.markToolsUpdated(changed);
        if (reconcile.recovered.length) logger.log(`[custom-tools] 已根据磁盘清单恢复注册：${reconcile.recovered.join('、')}`);
        if (reconcile.unregistered.length) logger.warn(`[custom-tools] 发现未注册且无可信清单的目录：${reconcile.unregistered.join('、')}`);
        return { ...result, changed, reconcile };
    });
}

module.exports = { initializeTenantBuiltinTools };
