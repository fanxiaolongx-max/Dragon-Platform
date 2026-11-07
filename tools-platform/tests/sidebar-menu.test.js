const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebar-menu-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
const db = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');
const repo = require('../backend/models/sidebar-menu-repository');
const { writeKV } = require('../backend/models/kv-store');
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
    if (req.headers['x-user']) req.user = { username: req.headers['x-user'], role: 'readonly' };
    runWithTenant(req.headers['x-tenant'] || 'default', next);
});
app.use('/api/sidebar-menu', require('../backend/routes/sidebar-menu'));
test.after(async () => { await db.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); });

test('sidebar menus are saved for the authenticated account inside its tenant and survive reopening SQLite', async () => {
    await request(app).get('/api/sidebar-menu').expect(401);
    const original = repo.defaults();
    const layout = { primary: ['requirements', 'skillHub'], more: ['library', 'channels', 'schedule', 'opsDrafts', 'links', 'promotions'] };
    await request(app).put('/api/sidebar-menu').set('x-user', 'alice').send(layout).expect(200, layout);
    await request(app).get('/api/sidebar-menu').set('x-user', 'bob').expect(200, original);
    await request(app).get('/api/sidebar-menu').set('x-user', 'alice').set('x-tenant', 'other').expect(200, original);
    await db.closeDatabase();
    await request(app).get('/api/sidebar-menu').set('x-user', 'alice').expect(200, layout);
    await request(app).put('/api/sidebar-menu').set('x-user', 'alice').send({ ...layout, username: 'bob' }).expect(400);
    await request(app).put('/api/sidebar-menu').set('x-user', 'alice').send({ primary: ['newChat'], more: [] }).expect(400);
    await request(app).put('/api/sidebar-menu').set('x-user', 'alice').send({ primary: [...layout.primary, 'library'], more: layout.more }).expect(400);
    await request(app).get('/api/sidebar-menu').set('x-user', 'alice').expect(200, layout);
    await request(app).put('/api/sidebar-menu').set('x-user', 'alice').send(original).expect(200, original);
});

test('older layouts discard removed entries and keep newly available entries reachable', async () => {
    await writeKV('sidebar_menu', 'legacy', { primary: ['schedule', 'removed', 'schedule'], more: ['skillHub'] });
    const layout = await repo.getLayout('legacy');
    assert.deepEqual(layout.primary, ['schedule']);
    assert.equal(new Set([...layout.primary, ...layout.more]).size, 8);
    assert.deepEqual([...layout.primary, ...layout.more].sort(), [...repo.defaults().primary, ...repo.defaults().more].sort());
});

test('the normal API middleware permits personal sidebar writes for non-admin users', () => {
    const source = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    assert.ok(source.includes("req.method === 'PUT' && req.path === '/sidebar-menu'"));
    assert.ok(source.indexOf("app.use('/api', tenantMiddleware)") < source.indexOf("req.path === '/sidebar-menu'"));
});
