const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-schedules-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const db = require('../backend/models/app-db');
const schedules = require('../backend/models/dragon-claw-schedules');
const pool = require('../backend/models/tenant-sqlite-pool');

test('conversation schedules match exact target, preserve statuses, and isolate owners and tenants through the API', async t => {
    const express = require('../backend/node_modules/express');
    const auth = require('../backend/middleware/auth');
    const sessions = require('../backend/models/auth-sessions-repository');
    const platformDb = require('../backend/models/platform-db');
    const app = express();
    app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await db.closeDatabase();
        await pool.closeAll();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    const target = { channel: 'weixin', kind: 'user', id: 'same-id' };
    async function insert(id, owner, status, targets = [target]) {
        await schedules.ensureSchema();
        await db.run(`INSERT INTO dragon_claw_schedules
            (id, owner, instruction, kind, status, timezone, session_id, last_reply, targets_json, last_push_json, created_at, updated_at)
            VALUES (?, ?, ?, 'once', ?, 'Africa/Cairo', 'private-session', 'private-answer', ?, ?, ?, ?)`,
        [id, owner, `Instruction ${id}`, status, typeof targets === 'string' ? targets : JSON.stringify(targets),
            JSON.stringify({ at: '2026-10-25T12:00:00Z', results: [{ ...target, ok: false, error: 'delivery failed' }, { channel: 'welink', kind: 'group', id: 'private-other-target', ok: true }] }),
            '2026-10-25T12:00:00Z', '2026-10-25T12:00:00Z']);
    }
    await runWithTenant('default', async () => {
        for (const status of ['active', 'running', 'done', 'cancelled', 'failed']) await insert(status, 'owner-a', status);
        await insert('other-owner', 'owner-b', 'active');
        await insert('welink-only', 'owner-a', 'active', [{ ...target, channel: 'welink' }]);
        await insert('different-kind', 'owner-a', 'active', [{ ...target, kind: 'group' }]);
        await insert('different-id', 'owner-a', 'active', [{ ...target, id: 'same-id-other' }]);
        await insert('malformed', 'owner-a', 'active', '{broken json');
        await insert('non-object-target', 'owner-a', 'active', '["broken",1,null]');
    });
    await runWithTenant('another', () => insert('other-tenant', 'owner-a', 'active'));
    await sessions.saveSession('test-schedule-viewer', 'owner-a', 'user', Date.now() + 60000, 'default');
    await sessions.saveSession('test-schedule-admin', 'admin', 'admin', Date.now() + 60000, 'default');
    await sessions.saveSession('test-schedule-other-tenant', 'owner-a', 'user', Date.now() + 60000, 'another');
    const base = `http://127.0.0.1:${server.address().port}/api/channels`;
    const read = (route, token) => fetch(base + route, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const route = '/weixin/threads/user/same-id/schedules';
    assert.equal((await read(route)).status, 401);
    const own = await (await read(route, 'test-schedule-viewer')).json();
    assert.deepEqual(own.items.map(item => item.id).sort(), ['active', 'cancelled', 'done', 'failed', 'running']);
    assert.deepEqual(new Set(own.items.map(item => item.status)), new Set(['active', 'running', 'done', 'cancelled', 'failed']));
    assert.equal(own.items[0].lastPush.ok, false);
    assert.equal(JSON.stringify(own).includes('private-'), false, 'no other recipients, private session or answer is exposed');
    assert.equal((await (await read(route, 'test-schedule-admin')).json()).items.length, 6);
    assert.deepEqual((await (await read(route, 'test-schedule-other-tenant')).json()).items.map(item => item.id), ['other-tenant']);
    assert.deepEqual((await (await read('/welink/threads/user/same-id/schedules', 'test-schedule-viewer')).json()).items.map(item => item.id), ['welink-only']);
    assert.equal((await read('/weixin/threads/room/same-id/schedules', 'test-schedule-admin')).status, 400);
    assert.deepEqual((await (await read('/weixin/threads/user/missing/schedules', 'test-schedule-admin')).json()).items, []);
    await runWithTenant('default', async () => {
        for (let index = 0; index < 201; index++) await insert(`bulk-${index}`, 'owner-a', 'done', [{ ...target, id: 'many' }]);
    });
    const many = await (await read('/weixin/threads/user/many/schedules', 'test-schedule-viewer')).json();
    assert.equal(many.items.length, 200);
    assert.equal(many.truncated, true, 'large histories are bounded and explicitly marked');
});
