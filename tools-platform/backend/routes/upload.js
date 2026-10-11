/**
 * 上传历史记录路由
 * 记录两个工具的操作历史，存储在服务端
 */
const express = require('express');
const router = express.Router();
const historyRepo = require('../models/upload-history-repository');

// GET /api/upload/history?tool=uiv|sla&limit=50
router.get('/history', async (req, res) => {
    try {
        const { tool, limit = 50, mode = 'auto' } = req.query;
        const { items, source } = await historyRepo.listHistory({ tool, limit, mode });
        res.setHeader('X-Data-Source', source);
        console.log(`[DATA SOURCE] GET /api/upload/history -> ${source.toUpperCase()} (mode=${mode}, tool=${tool || 'all'}, limit=${limit})`);
        res.json(items);
    } catch (err) {
        console.error('[GET /api/upload/history] failed:', err);
        res.status(500).json({ error: '读取历史记录失败' });
    }
});

// POST /api/upload/history  → 追加一条历史记录
router.post('/history', async (req, res) => {
    const { tool, action, detail } = req.body;
    if (!tool || !action) return res.status(400).json({ error: '参数不完整' });

    try {
        const item = await historyRepo.addHistory({ tool, action, detail });
        res.json({ success: true, item });
    } catch (err) {
        console.error('[POST /api/upload/history] failed:', err);
        res.status(500).json({ error: '保存历史记录失败' });
    }
});

// DELETE /api/upload/history  → 清空历史
router.delete('/history', async (req, res) => {
    try {
        const { tool } = req.query;
        await historyRepo.clearHistory({ tool });
        res.json({ success: true });
    } catch (err) {
        console.error('[DELETE /api/upload/history] failed:', err);
        res.status(500).json({ error: '清空历史记录失败' });
    }
});

router.use(require('./import-sources'));

module.exports = router;
