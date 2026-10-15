const express = require('express');
const repo = require('../models/ezscan-warehouse-repository');
const { requireAdmin } = require('../middleware/auth');
const { getTenantId } = require('../models/tenant-context');
const domain = require('../../frontend/js/ezscan-warehouse-domain');

const router = express.Router();

router.use((req, res, next) => {
    req.suppressBodyLog = true;
    res.set('Cache-Control', 'no-store');
    next();
});

function route(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(error => {
        if (!error.status) return next(error);
        res.status(error.status).json({ error: error.message, code: error.code || 'WAREHOUSE_ERROR' });
    });
}

function assertCurrentTenant(expectedTenant) {
    if (expectedTenant !== undefined && expectedTenant !== getTenantId()) {
        throw Object.assign(new Error('平台已切换租户，请刷新仓储页面后重试'), {
            status: 409,
            code: 'WAREHOUSE_TENANT_CHANGED'
        });
    }
}

router.get('/', route(async (req, res) => {
    res.json({ ...(await repo.loadState()), tenantId: getTenantId(), canWrite: req.user?.role === 'admin', username: req.user?.username || '', databaseFile: repo.DB_FILENAME });
}));

router.put('/', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    assertCurrentTenant(req.body?.data?._serverStorage?.tenantId);
    const result = await repo.saveState(req.body?.data, req.body?.revision);
    res.json({ success: true, ...result });
}));

router.post('/sample-data', requireAdmin, route(async (req, res) => {
    assertCurrentTenant(req.body?.tenantId);
    repo.validateRevision(req.body?.revision);
    const current = await repo.loadState();
    if (current.revision !== req.body.revision) throw Object.assign(new Error('服务器数据已更新，请重新加载后添加测试数据'), { status: 409, code: 'WAREHOUSE_REVISION_CONFLICT' });
    const action = req.body?.action;
    if (!['add', 'remove'].includes(action)) throw Object.assign(new Error('无效的测试数据操作'), { status: 400, code: 'WAREHOUSE_INVALID_STATE' });
    let result;
    try { result = action === 'add' ? domain.appendSamples(current.data || domain.emptyState()) : { data: domain.removeSamples(current.data || domain.emptyState()), added: true }; }
    catch (error) { throw Object.assign(error, { status: 400, code: 'WAREHOUSE_SAMPLE_REFERENCED' }); }
    if (!result.added) return res.json({ success: true, unchanged: true, ...current });
    result.data.logs.unshift({ id: require('crypto').randomUUID(), time: new Date().toISOString(), action: action === 'add' ? '添加测试数据' : '清理测试数据', detail: '仅处理标记为测试的数据，保留其他业务记录' });
    result.data.logs = result.data.logs.slice(0, 500);
    res.json({ success: true, data: result.data, ...await repo.saveState(result.data, current.revision) });
}));

router.get('/database', requireAdmin, route(async (req, res, next) => {
    assertCurrentTenant(req.query.tenantId);
    const backup = await repo.createDatabaseBackup();
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        backup.cleanup().catch(error => console.warn(`[warehouse] 临时数据库备份清理失败：${error.message}`));
    };
    res.once('close', cleanup);
    res.type('application/vnd.sqlite3');
    res.download(backup.filePath, backup.filename, error => {
        cleanup();
        if (error) next(error);
    });
}));

module.exports = router;
