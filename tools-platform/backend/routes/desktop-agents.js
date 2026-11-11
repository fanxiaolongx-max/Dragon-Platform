const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const repo = require('../models/desktop-agents/repository'), service = require('../models/desktop-agents/service');
router.use(requireAdmin);
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(error => {
    if (error.status || error.statusCode)
        return res.status(error.status || error.statusCode).json({ error: error.message, code: error.code || 'DESKTOP_AGENT_ERROR', ...(error.requestId ? { requestId: error.requestId } : {}) });
    console.error('[DesktopAgents] 路由处理未捕获异常:', error);
    res.status(503).json({ error: '桌面连接暂时不可用，请刷新或检查全局设置', code: 'DESKTOP_AGENT_UNAVAILABLE' });
});
router.get('/settings', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); const cfg = await repo.settings(); const owned = (!cfg.owner || cfg.owner === req.user.username) && await require('../models/desktop-agents/binding').available(req.user.username); res.json({ owned, settings: owned ? cfg : null, reason: owned ? '' : '本机桌面对话已绑定其他租户或账号' }); }));
router.put('/settings', route(async (req, res) => res.json({ settings: await service.save(req.user.username, req.body || {}) })));
router.get('/sessions', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await service.list(req.user.username, { provider: req.query.provider, q: req.query.q })); }));
router.get('/quota/history', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await require('../models/desktop-agents/quota').trends(req.user.username, req.query.provider, Number(req.query.days || 1))); }));
router.get('/quota', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await require('../models/desktop-agents/quota').read(req.user.username, { force: req.query.refresh === '1' })); }));
router.post('/sync',route(async (req, res) => res.json(await service.list(req.user.username, { force: true }))));
const discussion = require('../models/desktop-agents/discussion');
router.get('/discussions/:sessionId',route(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json({settings:await discussion.settings(req.user.username,req.params.sessionId),activeRun:await discussion.current(req.user.username,req.params.sessionId)});}));
router.put('/discussions/:sessionId',route(async(req,res)=>res.json({settings:await discussion.saveSettings(req.user.username,req.params.sessionId,req.body)})));
router.post('/discussion-runs',route(async(req,res)=>{const job=await discussion.start(req.user.username,req.body);if(job.status==='queued')discussion.schedule(req.user.username,job.id);res.status(202).json(job);}));
router.get('/discussion-runs/:id',route(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(await discussion.get(req.user.username,req.params.id));}));
router.post('/discussion-runs/:id/cancel',route(async(req,res)=>res.json(await discussion.cancel(req.user.username,req.params.id))));
router.get('/:provider/models', route(async (req,res)=>{res.setHeader('Cache-Control','no-store');res.json(await service.availableModels(req.user.username,req.params.provider,{force:req.query.refresh==='1',cached:req.query.cached==='1',day:req.query.day}));}));
router.put('/:provider/sessions/:id/model', route(async (req,res)=>res.json(await service.setModel(req.user.username,req.params.provider,req.params.id,req.body?.model))));
router.get('/:provider/sessions/:id/export', route(async (req, res) => {
    const log = await service.exportConversation(req.user.username, req.params.provider, req.params.id);
    const id = String(req.params.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
    res.setHeader('Content-Disposition', `attachment; filename="dragon-claw-${req.params.provider}-${id}-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(log);
}));
router.get('/:provider/sessions/:id/messages', route(async (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(await service.messages(req.user.username, req.params.provider, req.params.id, { passive: req.query.passive === '1', limit: req.query.limit, before: req.query.before })); }));
router.post('/:provider/sessions/:id/interaction', route(async (req, res) => res.json(await service.chooseInteraction(req.user.username, req.params.provider, req.params.id, req.body || {}))));
router.post('/:provider/sessions/:id/messages', route(async (req, res) => { const body = req.body || {}; res.status(202).json(body.mode === 'queue' ? await service.enqueue(req.user.username, req.params.provider, req.params.id, body) : await service.send(req.user.username, req.params.provider, req.params.id, body)); }));
router.post('/:provider/new', route(async (req, res) => res.status(202).json(await service.create(req.user.username, req.params.provider, req.body || {}))));
router.delete('/:provider/sessions/:id/queue/:requestId', route(async (req, res) => res.json(service.cancelQueued(req.user.username, req.params.provider, req.params.id, req.params.requestId))));
module.exports = router;
