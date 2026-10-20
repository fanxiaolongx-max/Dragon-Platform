const express = require('express');
const tenantsRepo = require('../models/tenants-repository');
const sessionsRepo = require('../models/auth-sessions-repository');
const { initializeTenantBuiltinTools } = require('../models/builtin-tools-startup');

const router = express.Router();
const operationLogs = new Map();
const MAX_OPERATION_LOGS = 40;

function operationKey(req, operationId) {
    return `${req.user?.username || 'unknown'}:${operationId}`;
}

function getOperationId(req) {
    const value = String(req.headers['x-tenant-operation-id'] || '').trim();
    return /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : '';
}

function startOperation(req) {
    const id = getOperationId(req);
    if (!id) return null;
    const operation = { id, type: 'create-tenant', status: 'running', progress: 1, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), entries: [] };
    operationLogs.set(operationKey(req, id), operation);
    while (operationLogs.size > MAX_OPERATION_LOGS) operationLogs.delete(operationLogs.keys().next().value);
    return operation;
}

function appendOperation(operation, entry = {}) {
    if (!operation) return;
    operation.progress = Math.max(operation.progress || 0, Math.min(100, Number(entry.percent) || 0));
    operation.entries.push({
        timestamp: new Date().toISOString(), stage: entry.stage || 'progress', level: entry.level || 'info',
        message: entry.message || '', messageEn: entry.messageEn || '', detail: entry.detail || null
    });
    operation.updatedAt = new Date().toISOString();
    if (operation.entries.length > 100) operation.entries.splice(0, operation.entries.length - 100);
}

function finishOperation(operation, status, error) {
    if (!operation) return;
    operation.status = status;
    operation.progress = 100;
    operation.completedAt = new Date().toISOString();
    operation.updatedAt = operation.completedAt;
    if (error) appendOperation(operation, { percent: 100, stage: 'failed', level: 'error', message: `创建租户失败：${error.message}`, messageEn: `Tenant creation failed: ${error.message}` });
}

router.get('/', async (req, res) => {
    try {
        const includeArchived = ['1', 'true'].includes(String(req.query.includeArchived || '').toLowerCase());
        if (includeArchived && req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可查看已归档租户' });
        const tenants = includeArchived
            ? await tenantsRepo.listManagedTenants()
            : await tenantsRepo.listTenantsForUser(req.user.username, req.user.role);
        res.json({ tenants, activeTenantId: req.user.tenantId || tenantsRepo.DEFAULT_TENANT_ID });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || '读取租户失败' });
    }
});

router.get('/operations/:id', (req, res) => {
    const operation = operationLogs.get(operationKey(req, req.params.id));
    if (!operation) return res.status(404).json({ error: '租户创建日志不存在或已过期' });
    res.json(operation);
});

router.post('/switch', async (req, res) => {
    try {
        const tenantId = String(req.body?.tenantId || '').trim().toLowerCase();
        if (!await tenantsRepo.canAccess(req.user.username, req.user.role, tenantId)) {
            return res.status(403).json({ error: '无权访问该租户' });
        }
        await initializeTenantBuiltinTools(tenantId);
        await sessionsRepo.setActiveTenant(req.authToken, tenantId);
        res.json({ success: true, tenantId });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message || '切换租户失败' });
    }
});

router.post('/', async (req, res) => {
    const operation = startOperation(req);
    try {
        appendOperation(operation, { percent: 2, stage: 'accepted', message: '服务端已接收创建租户请求', messageEn: 'The server accepted the tenant creation request' });
        const tenant = await tenantsRepo.createTenant(req.body || {}, { onProgress: entry => appendOperation(operation, entry) });
        finishOperation(operation, 'completed');
        res.status(201).json(tenant);
    } catch (error) {
        finishOperation(operation, 'failed', error);
        res.status(error.statusCode || 500).json({ error: error.message || '创建租户失败' });
    }
});

router.put('/:id', async (req, res) => {
    try { res.json(await tenantsRepo.updateTenant(req.params.id, req.body || {})); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message || '更新租户失败' }); }
});

router.delete('/:id', async (req, res) => {
    try { res.json(await tenantsRepo.archiveTenant(req.params.id)); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message || '归档租户失败' }); }
});

router.post('/:id/restore', async (req, res) => {
    try { res.json(await tenantsRepo.restoreTenant(req.params.id)); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message || '恢复租户失败' }); }
});

router.delete('/:id/permanent', async (req, res) => {
    try { res.json(await tenantsRepo.deleteTenantPermanently(req.params.id)); }
    catch (error) { res.status(error.statusCode || 500).json({ error: error.message || '彻底删除租户失败' }); }
});

module.exports = router;
