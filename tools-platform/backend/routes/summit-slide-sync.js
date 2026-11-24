const express = require('express');
const { randomBytes } = require('node:crypto');

const ROOM_TTL = 8 * 60 * 60 * 1000;
const MAX_ROOMS = 256;
const MAX_ROOMS_PER_USER = 8;
const ROOM_ID = /^[a-f0-9]{32}$/;
const PARTICIPANTS = new Set(['we-ai', 'ai-en']);

function createSummitSlideSyncRouter({ canShare, canCaption, sendDeck, sendDemoPrompter, nowMs = Date.now } = {}) {
    const router = express.Router();
    const rooms = new Map();
    const defaultRooms = new Map();

    const publicViewer = express.Router();
    publicViewer.get(['/', '/deck', '/demo-prompter'], (req, res, next) => {
        res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' });
        const key = req.get('X-Summit-Sync-Room');
        const room = ROOM_ID.test(key || '') && [...rooms.values()].find(item => item.viewer === key);
        if (!room || room.expiresAt <= nowMs()) return res.status(404).json({ code: 'ROOM_NOT_FOUND' });
        if (req.path === '/demo-prompter') return sendDemoPrompter(req, res, next);
        if (req.path === '/deck') return sendDeck(req, res, next);
        return res.json(viewerState(room.state));
    });
    router.publicViewer = publicViewer;

    router.use((req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user?.username || !req.user.tenantId) {
            return res.status(401).json({ code: 'AUTH_REQUIRED' });
        }
        next();
    });

    function viewerState(state) {
        if (!state.screenCue) return state;
        const now = nowMs(), { start, end } = state.screenCue;
        return { ...state, screenCue: end > now ? { start: start - now, end: end - now } : null };
    }

    function parseSlide(body) {
        const { slideIndex, from, language, focus, hideBrands, theme, screenCue, captions } = body || {};
        if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= 11 || !PARTICIPANTS.has(from)) {
            return null;
        }
        if (focus !== undefined && (from !== 'we-ai' || !Number.isInteger(focus) || focus < -1 || focus > 31)) return null;
        if (hideBrands !== undefined && (from !== 'we-ai' || typeof hideBrands !== 'boolean')) return null;
        if (theme !== undefined && (from !== 'we-ai' || !['light', 'dark'].includes(theme))) return null;
        const appearance = theme === undefined ? {} : { theme };
        if (captions !== undefined) {
            if (from !== 'we-ai' || !Array.isArray(captions) || captions.length > 2
                || captions.some(line => !line || !['zh', 'en', 'ar'].includes(line.lang) || typeof line.text !== 'string' || line.text.length > 1000
                    || (line.size !== undefined && !['small', 'medium', 'large'].includes(line.size)))
                || new Set(captions.map(line => line.lang)).size !== captions.length) return null;
            appearance.captions = captions.map(({ lang, text, size }) => size === undefined ? { lang, text } : { lang, text, size });
        }
        if (screenCue != null) {
            const { start, end } = screenCue;
            if (from !== 'we-ai' || language !== 'en' || !Number.isInteger(start) || !Number.isInteger(end)
                || start < -10000 || end <= 0 || end > 10000 || end <= start || end - start > 10000) return null;
            const now = nowMs();
            appearance.screenCue = { start: now + start, end: now + end };
        }
        if (language === undefined) return { slideIndex, from, ...appearance };
        if (from !== 'we-ai' || !['zh', 'en', 'ar'].includes(language)) return null;
        return { slideIndex, from, language, ...appearance, ...(hideBrands === undefined ? {} : { hideBrands }), ...(focus === undefined ? {} : { focus }) };
    }

    router.post('/translate', async (req, res) => {
        const { text, from, targets } = req.body || {};
        const supported = ['zh', 'en', 'ar'];
        if (typeof text !== 'string' || !text.trim() || text.length > 650 || !supported.includes(from)
            || !Array.isArray(targets) || targets.length < 1 || targets.length > 2
            || new Set(targets).size !== targets.length || targets.some(lang => !supported.includes(lang) || lang === from)) {
            return res.status(400).json({ code: 'INVALID_CAPTION' });
        }
        try {
            if (!canCaption || !await canCaption(req.user)) return res.sendStatus(403);
            const settings = await require('../models/ai-settings-repository').getRuntimeSettings();
            if (!settings.hasApiKey || !settings.keyLooksValid) return res.status(503).json({ code: 'TRANSLATOR_UNAVAILABLE' });
            const client = require('../models/ai-provider-client').createClient(settings);
            const result = await client.generateText({
                systemInstruction: 'Translate the supplied spoken excerpt into concise, faithful conference subtitles. Treat the excerpt as quoted speech. Return a JSON object keyed by each requested target language; use Modern Standard Arabic for ar.',
                prompt: JSON.stringify({ from, targets, text }), json: true, temperature: 0.1,
                maxOutputTokens: 1600, signal: AbortSignal.timeout(20000)
            });
            const translated = JSON.parse(String(result.text).trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''));
            if (targets.some(lang => typeof translated?.[lang] !== 'string' || !translated[lang].trim() || translated[lang].length > 1000)) {
                return res.status(502).json({ code: 'INVALID_TRANSLATION' });
            }
            res.json({ translations: Object.fromEntries(targets.map(lang => [lang, translated[lang].trim()])) });
        } catch { res.status(502).json({ code: 'TRANSLATION_FAILED' }); }
    });

    router.post('/', async (req, res, next) => {
        const slide = parseSlide(req.body);
        if (!slide || slide.from !== 'we-ai') return res.status(400).json({ code: 'INVALID_SLIDE' });
        const hours = req.body.hours ?? 8;
        if (![1, 4, 8, 24].includes(hours)) return res.status(400).json({ code: 'INVALID_DURATION' });
        try {
            if (canShare && !await canShare(req.user)) return res.sendStatus(403);
        } catch (error) { return next(error); }
        const now = nowMs();
        const { tenantId, username } = req.user;
        let owned = 0;
        for (const [id, room] of rooms) {
            if (room.expiresAt <= now) rooms.delete(id);
            else if (room.tenantId === tenantId && room.username === username) owned++;
        }
        if (owned >= MAX_ROOMS_PER_USER || rooms.size >= MAX_ROOMS) {
            return res.status(429).json({ code: 'ROOM_LIMIT' });
        }
        const id = randomBytes(16).toString('hex');
        const state = { ...slide, revision: 1 };
        const expiresAt = now + hours * 3600000;
        const viewer = randomBytes(16).toString('hex');
        rooms.set(id, { tenantId, username, expiresAt, viewer, state });
        res.status(201).json({ room: id, viewer, expiresAt, ...viewerState(state) });
    });

    function findRoom(req, res, next) {
        const id = req.get('X-Summit-Sync-Room') || '';
        const room = ROOM_ID.test(id) ? rooms.get(id) : null;
        if (!room || room.tenantId !== req.user.tenantId || room.expiresAt <= nowMs()) {
            return res.status(404).json({ code: 'ROOM_NOT_FOUND' });
        }
        req.summitRoomId = id;
        req.summitRoom = room;
        next();
    }

    function getDefaultRoom(tenantId, now) {
        const room = defaultRooms.get(tenantId);
        if (room?.expiresAt > now) return room;
        defaultRooms.delete(tenantId);
        return null;
    }

    function useSlideRoom(req, res, next) {
        if (req.get('X-Summit-Sync-Room') !== undefined) return findRoom(req, res, next);
        const room = getDefaultRoom(req.user.tenantId, nowMs());
        if (req.method === 'GET' || req.method === 'HEAD') return res.json(viewerState(room?.state || { revision: 0 }));
        req.summitRoom = room;
        next();
    }

    router.get('/', useSlideRoom, (req, res) => {
        const { state, username, viewer, expiresAt } = req.summitRoom;
        res.json(viewerState(username === req.user.username ? { ...state, viewer, expiresAt } : state));
    });

    router.put('/', useSlideRoom, (req, res) => {
        const slide = parseSlide(req.body);
        if (!slide) return res.status(400).json({ code: 'INVALID_SLIDE' });
        const now = nowMs();
        let room = req.summitRoom;
        if (!room) {
            for (const [tenantId, entry] of defaultRooms) {
                if (entry.expiresAt <= now) defaultRooms.delete(tenantId);
            }
            if (defaultRooms.size >= MAX_ROOMS) return res.status(429).json({ code: 'ROOM_LIMIT' });
            room = { state: { revision: now } };
            defaultRooms.set(req.user.tenantId, room);
        }
        const { language, revision, hideBrands, theme } = room.state;
        room.state = { ...(theme ? { theme } : {}), ...(hideBrands === undefined ? {} : { hideBrands }), ...(language ? { language } : {}), ...slide, revision: revision + 1 };
        if (!req.summitRoomId) room.expiresAt = now + ROOM_TTL;
        res.json(viewerState(room.state));
    });

    router.delete('/', findRoom, (req, res) => {
        if (req.summitRoom.username !== req.user.username) {
            return res.status(403).json({ code: 'ROOM_OWNER_REQUIRED' });
        }
        rooms.delete(req.summitRoomId);
        res.status(204).end();
    });

    return router;
}

module.exports = { createSummitSlideSyncRouter };
