const express = require('express');
const authority = require('../models/desktop-license-authority');
const registry = require('../models/desktop-license-registry');

const router = express.Router();

router.get('/', (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, licenses: registry.listRecords({ includeArchived: req.query.includeArchived === '1' }) });
    } catch (error) {
        res.status(500).json({ error: error.message || '读取 EXE License 失败' });
    }
});

// 签发前预览机器码：解析设备信息，并提示该设备是否已绑定过其他 License
router.post('/machine-code/inspect', (req, res) => {
    const result = authority.inspectMachineCode(req.body && req.body.machineCode);
    res.status(result.valid ? 200 : 400).json(result.valid ? { success: true, machine: result } : { error: result.error, reasonCode: result.reasonCode });
});

// ── 桌面端在线申请：列表 / 一键审批（可改有效期，默认 30 天）/ 拒绝 ──
const requests = require('../models/desktop-license-requests-repository');
router.get('/requests', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, requests: await requests.listRequests({ status: req.query.status === 'all' ? '' : (req.query.status || 'pending'), limit: req.query.limit }) });
    } catch (error) {
        res.status(500).json({ error: error.message || '读取申请失败' });
    }
});

router.post('/requests/:requestId/approve', async (req, res) => {
    try {
        res.json({ success: true, ...await requests.approveRequest(req.params.requestId, { ...(req.body || {}), decidedBy: req.user && req.user.username }) });
    } catch (error) {
        res.status(400).json({ error: error.message || '审批失败' });
    }
});

router.post('/requests/:requestId/reject', async (req, res) => {
    try {
        res.json({ success: true, request: await requests.rejectRequest(req.params.requestId, { reason: req.body && req.body.reason, decidedBy: req.user && req.user.username }) });
    } catch (error) {
        res.status(400).json({ error: error.message || '操作失败' });
    }
});

router.post('/issue', (req, res) => {
    try {
        res.json({ success: true, ...authority.issue(req.body || {}) });
    } catch (error) {
        res.status(400).json({ error: error.message || '签发 EXE License 失败' });
    }
});

router.post('/:licenseId/renew', (req, res) => {
    try {
        res.json({ success: true, ...authority.renew(req.params.licenseId, req.body || {}) });
    } catch (error) {
        res.status(400).json({ error: error.message || '续期失败' });
    }
});

router.post('/:licenseId/revoke', (req, res) => {
    try {
        res.json({ success: true, record: registry.setStatus(req.params.licenseId, 'revoked', req.body && req.body.reason) });
    } catch (error) {
        res.status(400).json({ error: error.message || '失效操作失败' });
    }
});

router.post('/:licenseId/restore', (req, res) => {
    try {
        res.json({ success: true, record: registry.setStatus(req.params.licenseId, 'active') });
    } catch (error) {
        res.status(400).json({ error: error.message || '恢复失败' });
    }
});

router.post('/:licenseId/archive', (req, res) => {
    try {
        res.json({ success: true, record: registry.setStatus(req.params.licenseId, 'archived') });
    } catch (error) {
        res.status(400).json({ error: error.message || '归档失败' });
    }
});

module.exports = router;
