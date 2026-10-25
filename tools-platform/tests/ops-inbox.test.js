const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-inbox-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const repo = require('../backend/models/channels/ops-repository');
const service = require('../backend/models/channels/ops-service');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const sessions = require('../backend/models/auth-sessions-repository');
const { checkAuth, requireAdmin } = require('../backend/middleware/auth');
const channels = require('../backend/models/channels');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const target = { channel: 'welink', kind: 'group', id: 'ops-one' };
const pushes = [];
channels.push = async input => {
    pushes.push(input);
    await new Promise(resolve => setTimeout(resolve, 25));
    return { results: [{ ok: true, name: '运营一群' }] };
};
const app = express();
app.use(express.json());
app.use('/api', checkAuth, tenantMiddleware, (req, res, next) => req.method === 'GET' ? next() : requireAdmin(req, res, next));
app.use('/api/channels', require('../backend/routes/channels'));
const auth = (token, verb, url) => request(app)[verb](`/api/channels/ops${url}`).set('Authorization', `Bearer ${token}`);

test.before(async () => {
    fs.mkdirSync(path.join(sandbox, 'data', 'tenants', 'other'), { recursive: true });
    for (const [token, role, tenant] of [['admin-test', 'admin', 'default'], ['viewer-test', 'readonly', 'default'], ['other-test', 'admin', 'other']]) {
        await sessions.saveSession(token, token, role, Date.now() + 60000, tenant);
    }
});
test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    await platformDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('pending inbox finds older drafts, counts and pages drafts only, enforces login and tenant boundaries', async () => {
    await runWithTenant('default', async () => {
        await repo.saveGroup({ ...target, name: '运营一群' });
        for (let index = 0; index < 25; index++) {
            await repo.createRun({ planName: `草稿 ${index}`, status: 'draft', content: `text ${index}`, targets: [target] });
        }
        for (let index = 0; index < 45; index++) await repo.createRun({ status: 'sent', content: 'recent sent history' });
    });
    await request(app).get('/api/channels/ops/pending').expect(401);
    const first = (await auth('admin-test', 'get', '/pending?limit=20')).body;
    const second = (await auth('admin-test', 'get', '/pending?limit=20&offset=20')).body;
    assert.equal(first.total, 25);
    assert.equal(first.items.length, 20);
    assert.equal(first.hasMore, true);
    assert.equal(second.items.length, 5);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 25);
    assert.ok(first.items.every(item => item.status === 'draft' && item.targets[0].name === '运营一群'));
    const viewer = (await auth('viewer-test', 'get', '/pending')).body;
    assert.deepEqual(viewer, { canManage: false, items: [], total: 0, hasMore: false, offset: 0 });
    assert.equal((await auth('other-test', 'get', '/pending')).body.total, 0);
    const id = first.items[0].id;
    await auth('viewer-test', 'post', `/runs/${id}/send`).send({ content: 'no' }).expect(403);
    await auth('other-test', 'post', `/runs/${id}/send`).send({ content: 'no' }).expect(404);
    await auth('admin-test', 'put', `/runs/${id}`).send({ content: '编辑后的草稿', expectedContent: first.items[0].content }).expect(200);
    await auth('admin-test', 'post', `/runs/${id}/send`).send({ content: '过时的正文', expectedContent: first.items[0].content }).expect(409);
    assert.equal(pushes.length, 0);
    const sent = await auth('admin-test', 'post', `/runs/${id}/send`).send({ content: '最终正文', expectedContent: '编辑后的草稿' }).expect(200);
    assert.equal(sent.body.status, 'sent');
    assert.equal(pushes[0].text, '最终正文');
    assert.equal((await auth('admin-test', 'get', '/pending')).body.total, 24);
});

test('simultaneous confirmations claim a draft once and reject edits or discard during delivery', () => runWithTenant('default', async () => {
    const item = await repo.createRun({ status: 'draft', content: 'one send', targets: [target] });
    const before = pushes.length;
    const results = await Promise.allSettled([service.sendRun(item.id), service.sendRun(item.id)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(pushes.length - before, 1);
    assert.equal((await repo.getRun(item.id)).status, 'sent');
    const locked = await repo.createRun({ status: 'draft', content: 'locked', targets: [target] });
    assert.equal(await repo.changeDraft(locked.id, { status: 'sending', expectedContent: locked.content }), true);
    await assert.rejects(service.updateDraft(locked.id, 'changed'), /只有草稿/);
    await assert.rejects(service.discardRun(locked.id), /只有草稿/);
    await assert.rejects(service.sendRun(locked.id), /只有草稿/);
}));

test('served tools include the shared inbox once; offline exports do not', () => {
    const { injectLanguageRuntime } = require('../backend/models/custom-tool-i18n-service');
    const html = '<html><body>tool</body></html>';
    const served = injectLanguageRuntime(html, 'test');
    assert.equal((served.match(/src="\/js\/shared\/ops-inbox.js"/g) || []).length, 1);
    assert.equal((injectLanguageRuntime(served, 'test').match(/src="\/js\/shared\/ops-inbox.js"/g) || []).length, 1);
    assert.doesNotMatch(injectLanguageRuntime(html, 'test', { standalone: true, inlineRuntime: true }), /src="\/js\/shared\/ops-inbox/);
});
