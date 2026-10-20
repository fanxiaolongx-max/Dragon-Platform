const express = require('express');
const router = express.Router();
const repo = require('../models/nav-settings-repository');
const customToolsRepo = require('../models/custom-tools-repository');
const { requireAdmin } = require('../middleware/auth');

router.get('/', async (req, res) => {
    res.json(await repo.getSettings());
});

router.put('/', async (req, res) => {
    try {
        res.json(await repo.saveSettings(req.body || {}));
    } catch (err) {
        res.status(500).json({ error: err.message || '保存导航设置失败' });
    }
});

router.post('/restore-defaults', requireAdmin, async (req, res) => {
    try {
        const tools = await customToolsRepo.listTools();
        const customToolIds = tools.map(tool => `custom:${tool.slug}`);
        res.json(await repo.restoreDefaultsPreservingCustomTools(customToolIds));
    } catch (err) {
        res.status(500).json({ error: err.message || '恢复系统默认导航失败' });
    }
});

router.post('/set-as-default', requireAdmin, async (req, res) => {
    try {
        const layoutInput = req.body?.settings || req.body?.layout || null;
        res.json(await repo.setAsDefaultLayout(layoutInput));
    } catch (err) {
        res.status(500).json({ error: err.message || '设置系统默认导航布局失败' });
    }
});

module.exports = router;
