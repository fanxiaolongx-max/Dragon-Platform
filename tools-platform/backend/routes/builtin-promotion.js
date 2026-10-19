// 「转为内置 / 取消内置」API（models/builtin-promotion.js）：仅管理员；状态接口告诉前端源码目录是否可写。
const express = require('express');
const router = express.Router();
const promotion = require('../models/builtin-promotion');
const { requireAdmin } = require('../middleware/auth');

function sendError(res, error, fallback) {
    res.status(error.statusCode || 500).json({ code: error.code, error: error.statusCode ? error.message : `${fallback}: ${error.message}` });
}

router.get('/status', requireAdmin, (_req, res) => {
    res.json(promotion.status());
});

router.post('/:kind/:id', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...(await promotion.promote(req.params.kind, req.params.id, { createdBy: req.user?.username || '' })) });
    } catch (error) {
        sendError(res, error, '转为内置失败');
    }
});

router.delete('/:kind/:id', requireAdmin, async (req, res) => {
    try {
        res.json({ success: true, ...(await promotion.demote(req.params.kind, req.params.id, { createdBy: req.user?.username || '' })) });
    } catch (error) {
        sendError(res, error, '取消内置失败');
    }
});

module.exports = router;
