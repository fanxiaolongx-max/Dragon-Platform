// Dragon Claw「/schedule」定时指令：只能查看 / 创建 / 取消自己的任务。
const express = require('express');
const router = express.Router();
const { checkAuth } = require('../middleware/auth');
const schedules = require('../models/dragon-claw-schedules');

function sendError(res, error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[DragonClaw] schedule error:', error);
    res.status(status).json({ code: error.code, error: status >= 500 ? '定时任务服务异常' : error.message });
}

router.get('/', checkAuth, async (req, res) => {
    try {
        const since = typeof req.query.since === 'string' && !Number.isNaN(Date.parse(req.query.since)) ? new Date(req.query.since).toISOString() : '';
        const serverTime = new Date().toISOString();
        const [items, active] = await Promise.all([schedules.list(req.user.username, { since }), schedules.countActive(req.user.username)]);
        res.json({ items, active, serverTime });
    } catch (error) {
        sendError(res, error);
    }
});

router.post('/', checkAuth, async (req, res) => {
    try {
        const body = req.body || {};
        const item = await schedules.create({
            owner: req.user.username,
            role: req.user.role,
            text: String(body.text || '').slice(0, 4200),
            sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 120) : '',
            timezone: typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : '',
            modelId: body.modelId
        });
        res.status(201).json({ item });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete('/:id', checkAuth, async (req, res) => {
    try {
        res.json({ item: await schedules.cancel(String(req.params.id), req.user.username) });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = router;
