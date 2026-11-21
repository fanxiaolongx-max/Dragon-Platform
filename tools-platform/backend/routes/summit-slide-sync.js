const express = require('express');
const { randomBytes } = require('node:crypto');

const ROOM_TTL = 8 * 60 * 60 * 1000;
const MAX_ROOMS = 256;
const MAX_ROOMS_PER_USER = 8;
const ROOM_ID = /^[a-f0-9]{32}$/;
const PARTICIPANTS = new Set(['we-ai', 'ai-en']);

function createSummitSlideSyncRouter() {
    const router = express.Router();
    const rooms = new Map();
    const defaultRooms = new Map();

    router.use((req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        if (!req.user?.username || !req.user.tenantId) {
            return res.status(401).json({ code: 'AUTH_REQUIRED' });
        }
        next();
    });

    function parseSlide(body) {
        const { slideIndex, from, language } = body || {};
        if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= 10 || !PARTICIPANTS.has(from)) {
            return null;
        }
        if (language === undefined) return { slideIndex, from };
        if (from !== 'we-ai' || (language !== 'zh' && language !== 'en')) return null;
        return { slideIndex, from, language };
    }

    router.post('/', (req, res) => {
        const slide = parseSlide(req.body);
        if (!slide || slide.from !== 'we-ai') return res.status(400).json({ code: 'INVALID_SLIDE' });
        const now = Date.now();
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
        rooms.set(id, { tenantId, username, expiresAt: now + ROOM_TTL, state });
        res.status(201).json({ room: id, ...state });
    });

    function findRoom(req, res, next) {
        const id = req.get('X-Summit-Sync-Room') || '';
        const room = ROOM_ID.test(id) ? rooms.get(id) : null;
        if (!room || room.tenantId !== req.user.tenantId || room.expiresAt <= Date.now()) {
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
        const room = getDefaultRoom(req.user.tenantId, Date.now());
        if (req.method === 'GET' || req.method === 'HEAD') return res.json(room?.state || { revision: 0 });
        req.summitRoom = room;
        next();
    }

    router.get('/', useSlideRoom, (req, res) => res.json(req.summitRoom.state));

    router.put('/', useSlideRoom, (req, res) => {
        const slide = parseSlide(req.body);
        if (!slide) return res.status(400).json({ code: 'INVALID_SLIDE' });
        const now = Date.now();
        let room = req.summitRoom;
        if (!room) {
            for (const [tenantId, entry] of defaultRooms) {
                if (entry.expiresAt <= now) defaultRooms.delete(tenantId);
            }
            if (defaultRooms.size >= MAX_ROOMS) return res.status(429).json({ code: 'ROOM_LIMIT' });
            room = { state: { revision: now } };
            defaultRooms.set(req.user.tenantId, room);
        }
        room.state = { ...room.state, ...slide, revision: room.state.revision + 1 };
        room.expiresAt = now + ROOM_TTL;
        res.json(room.state);
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
