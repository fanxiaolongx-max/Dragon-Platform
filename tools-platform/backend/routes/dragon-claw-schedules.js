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
        if (req.query.page !== undefined) {
            const page = Number(req.query.page);
            if (!Number.isSafeInteger(page) || page < 1 || page > 10000000) return res.status(400).json({ error: '页码无效' });
            return res.json(await schedules.listPage(req.user.username, { page, q: String(req.query.q || '').trim().slice(0, 4000), status: String(req.query.status || '') }));
        }
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
            modelId: body.modelId,
            targets: Array.isArray(body.targets) ? body.targets : []
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

router.post('/:id/run', checkAuth, async (req, res) => {
    try {
        const item = await schedules.runNow(req.params.id, req.user.username, req.body?.runCount, req.body?.status);
        res.status(202).json({ item });
    } catch (error) { sendError(res, error); }
});

router.delete('/:id/record', checkAuth, async (req, res) => {
    try {
        await schedules.remove(req.params.id, req.user.username);
        res.status(204).end();
    } catch (error) { sendError(res, error); }
});

module.exports = router;
