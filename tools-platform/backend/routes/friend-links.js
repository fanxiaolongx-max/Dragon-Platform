const express = require('express');
const repo = require('../models/friend-links-repository');
const service = require('../models/friend-links-service');
const claudeCodeConfig = require('../models/claude-code-config-service');
const { hasCurrentSuperAdminAccount } = require('../middleware/auth');

const router = express.Router();

async function sendSnapshot(req, res, snapshot) {
    if (await hasCurrentSuperAdminAccount(req.user)) {
        snapshot.licenseAdminUrl = process.env.TOOLS_DESKTOP_RUNTIME === '1'
            ? 'https://cs.fanxiaolong.uk/desktop-license-admin'
            : '/desktop-license-admin';
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(snapshot);
}

router.get('/', async (req, res) => {
    try {
        await sendSnapshot(req, res, await service.buildSnapshot());
    } catch (error) {
        res.status(500).json({ error: error.message || '读取友情链接失败' });
    }
});

router.put('/', async (req, res) => {
    try {
        await repo.saveConfig(req.body || {});
        await sendSnapshot(req, res, await service.refreshSchedule());
    } catch (error) {
        res.status(400).json({ error: error.message || '保存友情链接失败' });
    }
});

router.post('/probe', async (req, res) => {
    try {
        await sendSnapshot(req, res, await service.probeAll());
    } catch (error) {
        res.status(500).json({ error: error.message || '探测友情链接失败' });
    }
});

router.put('/api-relay', async (req, res) => {
    req.suppressBodyLog = true;
    try {
        const current = await repo.getConfig();
        await repo.saveConfig({ ...current, apiRelay: req.body || {} });
        await sendSnapshot(req, res, await service.buildSnapshot());
    } catch (error) {
        res.status(400).json({ error: error.message || '保存 API 中转配置失败' });
    }
});

router.post('/api-relay/install-claude-code', async (req, res) => {
    req.suppressBodyLog = true;
    try {
        const config = await repo.getConfig();
        res.json(claudeCodeConfig.installClaudeCodeConfig(config.apiRelay));
    } catch (error) {
        const status = error.code === 'DESKTOP_RUNTIME_REQUIRED' ? 409 : 500;
        res.status(status).json({ error: error.message || '写入 Claude Code 配置失败' });
    }
});

router.post('/:linkId/probe', async (req, res) => {
    try {
        res.json(await service.probeOne(req.params.linkId));
    } catch (error) {
        const status = error.message === '友情链接不存在' ? 404 : 500;
        res.status(status).json({ error: error.message || '探测友情链接失败' });
    }
});

module.exports = router;
