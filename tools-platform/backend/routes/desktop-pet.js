const express = require('express');
const language = require('../models/desktop-language');
const stories = require('../models/pet-stories-repository');
const quotaHistory = require('../models/pet-quota-history-repository');
const router = express.Router();

// A logged-in local user may change this machine's UI language, including viewers.
// Use the actual peer address, never forwarded headers, to exclude remote clients.
router.use((req, res, next) => {
    if (!req.user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Login required' });
    const peer = req.socket?.remoteAddress;
    if (process.env.TOOLS_DESKTOP_RUNTIME !== '1' ||
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) {
        return res.status(403).json({ code: 'DESKTOP_LOCAL_ONLY', error: 'Local desktop access required' });
    }
    if (req.headers.origin) {
        try {
            const origin = new URL(req.headers.origin);
            if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.host !== req.headers.host) {
                return res.status(403).json({ code: 'DESKTOP_LOCAL_ONLY', error: 'Same-origin access required' });
            }
        } catch (_) {
            return res.status(403).json({ code: 'DESKTOP_LOCAL_ONLY', error: 'Invalid origin' });
        }
    }
    next();
});
router.post('/language', (req, res) => {
    if (!language.setLanguage(req.body?.language)) {
        return res.status(400).json({ code: 'INVALID_LANGUAGE', error: 'Unsupported language' });
    }
    res.json({ success: true, language: language.getLanguage() });
});
router.post('/quota-history', async (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({code:'ADMIN_REQUIRED', error:'Administrator required'});
    if (!req.user.username || !quotaHistory.identifier(req.body?.device)) return res.status(400).json({code:'INVALID_QUOTA_SCOPE', error:'Invalid installation'});
    try {
        await quotaHistory.record(req.user.username, req.body.device, req.body.quotas);
        res.setHeader('Cache-Control', 'no-store');
        res.json({success:true});
    } catch (error) { next(error); }
});
router.get('/quota-history', async (req, res, next) => {
    const days = Number(req.query.days || 1);
    if (!req.user.username || !quotaHistory.identifier(req.query.device) ||
        !['codex','claudecode','antigravity'].includes(req.query.provider) || !Number.isFinite(days) || days < 1 || days > 90) {
        return res.status(400).json({code:'INVALID_QUOTA_QUERY', error:'Invalid quota query'});
    }
    try {
        const history = await quotaHistory.history(req.user.username, req.query.device, req.query.provider, days);
        res.setHeader('Cache-Control', 'no-store');
        res.json({success:true, history});
    } catch (error) { next(error); }
});
router.get('/stories', async (req, res, next) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, stories: await stories.listStories(req.query.language) });
    } catch (error) { next(error); }
});
router.get('/stories/:id', async (req, res, next) => {
    try {
        const story = await stories.getStory(req.params.id, req.query.language);
        if (!story) return res.status(404).json({ code: 'PET_STORY_NOT_FOUND', error: 'Story not found' });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ success: true, story });
    } catch (error) { next(error); }
});
module.exports = router;
