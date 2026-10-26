const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const repo = require('../models/dragon-tac/repository');
const service = require('../models/dragon-tac/service');
router.get('/capabilities', requireAdmin, async (_req, res, next) => { try { res.json(await service.capabilities()); } catch (e) { next(e); } });
router.get('/hud', requireAdmin, async (_req, res, next) => { try { res.json(await require('../models/dragon-tac/hud').inspect()); } catch (e) { next(e); } });
router.get('/jobs', async (req, res, next) => {
    try { res.json({ items: await repo.list({ channel: 'web', kind: 'user', id: req.user.username, actor: req.user.username }) }); } catch (e) { next(e); }
});
module.exports = router;
