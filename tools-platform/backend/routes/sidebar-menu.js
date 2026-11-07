const router = require('express').Router();
const repo = require('../models/sidebar-menu-repository');

// The global API middleware authenticates first and supplies the session tenant.
// No client-supplied account or tenant can select another user's preferences.
router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user?.username) return res.status(401).json({ code: 'AUTH_REQUIRED', error: '请先登录' });
    next();
});
router.get('/', async (req, res, next) => {
    try { res.json(await repo.getLayout(req.user.username)); }
    catch (error) { next(error); }
});
router.put('/', async (req, res, next) => {
    try { res.json(await repo.saveLayout(req.user.username, req.body)); }
    catch (error) {
        if (error.status === 400) return res.status(400).json({ code: error.code, error: error.message });
        next(error);
    }
});
module.exports = router;
