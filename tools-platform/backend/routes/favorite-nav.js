const express = require('express');
const repo = require('../models/favorite-nav-repository');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        res.json({ ids: await repo.listFavorites(req.user.username) });
    } catch (error) {
        res.status(500).json({ error: '读取收藏失败' });
    }
});

router.put('/', async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > repo.MAX_FAVORITES || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 160)) {
        return res.status(400).json({ error: `收藏列表无效（最多 ${repo.MAX_FAVORITES} 个）` });
    }
    try {
        res.json({ ids: await repo.replaceFavorites(req.user.username, ids) });
    } catch (error) {
        res.status(500).json({ error: '保存收藏失败' });
    }
});

module.exports = router;
