// AI BI 看板的保存与读取；对话生成布局走 /api/ai-report/bi/plan（与格子编译共用数据工具）。
const express = require('express');
const router = express.Router();
const boards = require('../models/ai-bi-repository');

const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (error) {
        const status = error.status || 500;
        if (status >= 500) console.error('[AI BI]', error);
        res.status(status).json({ error: error.message || 'AI BI request failed' });
    }
};
const user = req => String(req.user?.username || req.user?.id || '');

router.get('/boards', handle(async (_req, res) => res.json(await boards.list())));
router.get('/boards/:id', handle(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await boards.read(req.params.id)); }));
router.post('/boards', handle(async (req, res) => res.json(await boards.save(req.body, user(req)))));
router.delete('/boards/:id', handle(async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: '只有管理员可以删除看板' });
    res.json(await boards.remove(req.params.id));
}));

module.exports = router;
