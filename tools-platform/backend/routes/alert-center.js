const express = require('express');
const repo = require('../models/alert-center-repository');
const alertAiAnalyzer = require('../models/alert-ai-analyzer');

const router = express.Router();

function getActor(req) {
    return (req.user && req.user.username) || req.headers['x-user'] || '';
}

router.get('/summary', async (req, res, next) => {
    try {
        res.json(await repo.getSummary());
    } catch (err) {
        next(err);
    }
});

router.get('/events', async (req, res, next) => {
    try {
        const events = await repo.listEvents({
            status: req.query.status,
            eventType: req.query.type,
            severity: req.query.severity,
            limit: req.query.limit
        });
        res.json({ events });
    } catch (err) {
        next(err);
    }
});

router.post('/events', async (req, res, next) => {
    try {
        const body = req.body || {};
        const event = await repo.addEvent({
            eventType: body.eventType || body.event_type || 'system',
            severity: body.severity || 'info',
            status: body.status || 'unread',
            title: body.title,
            message: body.message,
            actor: body.actor || getActor(req),
            source: body.source || 'manual',
            objectType: body.objectType || body.object_type || '',
            objectId: body.objectId || body.object_id || '',
            detail: body.detail || {}
        });
        res.json(event);
    } catch (err) {
        next(err);
    }
});

router.put('/events/read', async (req, res, next) => {
    try {
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
        res.json(await repo.markRead(ids));
    } catch (err) {
        next(err);
    }
});

router.put('/events/read-all', async (req, res, next) => {
    try {
        res.json(await repo.markAllRead());
    } catch (err) {
        next(err);
    }
});

router.put('/events/archive-all', async (req, res, next) => {
    try {
        res.json(await repo.archiveAllEvents());
    } catch (err) {
        next(err);
    }
});

router.post('/events/clear-all', async (req, res, next) => {
    try {
        res.json(await repo.clearAllEvents());
    } catch (err) {
        next(err);
    }
});

router.delete('/events/clear-all', async (req, res, next) => {
    try {
        res.json(await repo.clearAllEvents());
    } catch (err) {
        next(err);
    }
});

router.post('/ai/backfill', async (req, res, next) => {
    try {
        const limit = req.body && req.body.limit;
        res.json(await alertAiAnalyzer.enqueuePendingAlertAnalyses({
            limit: limit || 120,
            force: Boolean(req.body && req.body.force)
        }));
    } catch (err) {
        next(err);
    }
});

router.delete('/events/:id', async (req, res, next) => {
    try {
        res.json(await repo.archiveEvent(req.params.id));
    } catch (err) {
        next(err);
    }
});

module.exports = router;
