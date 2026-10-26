const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const repo = require('../models/desktop-agents/repository'), service = require('../models/desktop-agents/service');
router.use(requireAdmin);
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
    if (error.status || error.statusCode)
        return res.status(error.status || error.statusCode).json({ error: error.message, code: error.code || 'DESKTOP_AGENT_ERROR', ...(error.requestId ? { requestId: error.requestId } : {}) });
    res.status(503).json({ error: '桌面连接暂时不可用，请刷新或检查全局设置', code: 'DESKTOP_AGENT_UNAVAILABLE' });
});
router.get('/settings', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); const cfg = await repo.settings(); const owned = (!cfg.owner || cfg.owner === req.user.username) && await require('../models/desktop-agents/binding').available(req.user.username); res.json({ owned, settings: owned ? cfg : null, reason: owned ? '' : '本机桌面对话已绑定其他租户或账号' }); }));
router.put('/settings', route(async (req, res) => res.json({ settings: await service.save(req.user.username, req.body || {}) })));
router.get('/sessions', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await service.list(req.user.username, { provider: req.query.provider, q: req.query.q })); }));
router.post('/sync', route(async (req, res) => res.json(await service.list(req.user.username, { force: true }))));
const discussion = require('../models/desktop-agents/discussion');
router.get('/discussions/:sessionId',route(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({settings:await discussion.settings(req.user.username,req.params.sessionId),activeRun:await discussion.current(req.user.username,req.params.sessionId)});}));
router.put('/discussions/:sessionId',route(async(req,res)=>res.json({settings:await discussion.saveSettings(req.user.username,req.params.sessionId,req.body)})));
router.post('/discussion-runs',route(async(req,res)=>{const job=await discussion.start(req.user.username,req.body);if(job.status==='queued')discussion.schedule(req.user.username,job.id);res.status(202).json(job);}));
router.get('/discussion-runs/:id',route(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(await discussion.get(req.user.username,req.params.id));}));
router.post('/discussion-runs/:id/cancel',route(async(req,res)=>res.json(await discussion.cancel(req.user.username,req.params.id))));
router.get('/:provider/sessions/:id/messages', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await service.messages(req.user.username, req.params.provider, req.params.id, { passive: req.query.passive === '1' })); }));
router.post('/:provider/sessions/:id/messages', route(async (req, res) => { const body = req.body || {}; res.status(202).json(body.mode === 'queue' ? await service.enqueue(req.user.username, req.params.provider, req.params.id, body) : await service.send(req.user.username, req.params.provider, req.params.id, body)); }));
router.post('/:provider/new', route(async (req, res) => res.status(202).json(await service.create(req.user.username, req.params.provider, req.body || {}))));
router.delete('/:provider/sessions/:id/queue/:requestId', route(async (req, res) => res.json(service.cancelQueued(req.user.username, req.params.provider, req.params.id, req.params.requestId))));
module.exports = router;
