const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const repo = require('../models/desktop-agents/repository'), service = require('../models/desktop-agents/service');
router.use(requireAdmin);
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
    if (error.status)
        return res.status(error.status).json({ error: error.message, code: error.code || 'DESKTOP_AGENT_ERROR', ...(error.requestId ? { requestId: error.requestId } : {}) });
    res.status(503).json({ error: '桌面连接暂时不可用，请刷新或检查全局设置', code: 'DESKTOP_AGENT_UNAVAILABLE' });
});
router.get('/settings', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); const cfg = await repo.settings(); const owned = (!cfg.owner || cfg.owner === req.user.username) && await require('../models/desktop-agents/binding').available(req.user.username); res.json({ owned, settings: owned ? cfg : null, reason: owned ? '' : '本机桌面对话已绑定其他租户或账号' }); }));
router.put('/settings', route(async (req, res) => res.json({ settings: await service.save(req.user.username, req.body || {}) })));
router.get('/sessions', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await service.list(req.user.username, { provider: req.query.provider, q: req.query.q })); }));
router.post('/sync', route(async (req, res) => res.json(await service.list(req.user.username, { force: true }))));
router.get('/:provider/sessions/:id/messages', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await service.messages(req.user.username, req.params.provider, req.params.id)); }));
router.post('/:provider/sessions/:id/messages', route(async (req, res) => res.status(202).json(await service.send(req.user.username, req.params.provider, req.params.id, req.body || {}))));
module.exports = router;
