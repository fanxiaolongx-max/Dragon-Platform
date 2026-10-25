const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-manual-ops-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const auth = require('../backend/middleware/auth');
const sessions = require('../backend/models/auth-sessions-repository');
const targets = require('../backend/models/channels/channel-targets-repository');
const welinkConfig = require('../backend/models/channels/welink-config-repository');
const weixinConfig = require('../backend/models/channels/weixin-config-repository');
const welink = require('../backend/models/channels/welink-bridge-service');
const weixin = require('../backend/models/channels/weixin-bridge-service');
const calls = [];
for (const [channel, service] of [['welink', welink], ['weixin', weixin]]) service.push = async (tenantId, input) => {
    calls.push({ tenantId, channel, ...input });
    return { ok: true, sent: 1, failed: 0, results: input.targets.map(target => ({ ...target, name: target.id, ok: true })) };
};
const app = express();
app.use(express.json());
app.use('/api', auth.checkAuth, tenantMiddleware);
const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
const end = serverSource.indexOf('\n});', begin) + 4;
vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
app.use('/api/channels', require('../backend/routes/channels'));
const as = (token, method, url) => request(app)[method](`/api/channels/${url}`).set('Authorization', `Bearer ${token}`);
test.before(async () => {
    fs.mkdirSync(path.join(sandbox, 'data', 'tenants', 'other'), { recursive: true });
    for (const [token, role, tenant] of [['admin-test', 'admin', 'default'], ['viewer-test', 'readonly', 'default'], ['other-test', 'admin', 'other']]) await sessions.saveSession(token, token, role, Date.now() + 60000, tenant);
    await runWithTenant('default', async () => {
        for (const [channel, kind, id] of [['welink', 'group', 'team'], ['weixin', 'user', 'alice']]) {
            const toolSessionId = `${channel}-session`;
            await targets.upsertSession(channel, { toolSessionId, kind, targetId: id, title: id });
            await targets.touchTarget(channel, { toolSessionId, kind, id, displayName: id });
        }
    });
});
test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    await require('../backend/models/platform-db').closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('thread send capability follows the existing admin, allowed-user scope and WeChat target rules', async () => {
    await request(app).get('/api/channels/welink/threads/group/team/messages').expect(401);
    assert.equal((await as('admin-test', 'get', 'welink/threads/group/team/messages')).body.canSend, true);
    assert.equal((await as('viewer-test', 'get', 'welink/threads/group/team/messages')).body.canSend, false);
    await as('viewer-test', 'post', 'welink/push').send({ text: 'blocked', targets: [{ kind: 'group', id: 'team' }], source: 'manual-bot' }).expect(403);
    assert.equal(calls.length, 0);
    await runWithTenant('default', () => welinkConfig.saveConfig({ push: { allowUserPush: true, defaultTargets: [{ kind: 'group', id: 'team' }] } }));
    assert.equal((await as('viewer-test', 'get', 'welink/threads/group/team/messages')).body.canSend, true);
    assert.equal((await as('viewer-test', 'get', 'welink/threads/group/other/messages')).body.canSend, false);
    await as('viewer-test', 'post', 'welink/push').send({ text: 'blocked', targets: [{ kind: 'group', id: 'other' }], source: 'manual-bot' }).expect(403);
    assert.equal((await as('admin-test', 'get', 'weixin/threads/user/alice/messages')).body.canSend, true);
    assert.equal((await as('admin-test', 'get', 'weixin/threads/group/team/messages')).body.canSend, false);
    await runWithTenant('default', () => weixinConfig.saveConfig({ push: { allowUserPush: true, defaultTargets: [{ kind: 'user', id: 'alice' }] } }));
    assert.equal((await as('viewer-test', 'get', 'weixin/threads/user/alice/messages')).body.canSend, true);
});

test('manual sends reach the requested conversation, use the authenticated actor and persist as Bot messages', async () => {
    await as('admin-test', 'post', 'welink/push').send({ text: 'no implicit targets', source: 'manual-bot' }).expect(400);
    await as('admin-test', 'post', 'welink/push').send({ text: 'no bulk target', source: 'manual-bot', targets: [{ kind: 'group', id: 'team' }, { kind: 'group', id: 'other' }] }).expect(400);
    await as('admin-test', 'post', 'weixin/push').send({ text: 'no WeChat groups', source: 'manual-bot', targets: [{ kind: 'group', id: 'team' }] }).expect(400);
    for (const [channel, kind, id, token] of [['welink', 'group', 'team', 'viewer-test'], ['weixin', 'user', 'alice', 'admin-test']]) {
        const text = `手动运营 ${channel}`;
        await as(token, 'post', `${channel}/push`).send({ text, targets: [{ kind, id }], source: 'manual-bot', username: 'forged-user' }).expect(200);
        assert.equal(calls.at(-1).tenantId, 'default');
        assert.deepEqual(calls.at(-1).targets, [{ kind, id }]);
        assert.equal(calls.at(-1).source, `manual-bot:${token}`);
        const page = (await as(token, 'get', `${channel}/threads/${kind}/${id}/messages`)).body;
        const message = page.items.find(item => item.content === text);
        assert.ok(message, 'sent content appears in the actual channel conversation');
        assert.equal(message.role, 'model');
        assert.equal(message.push.source, `manual-bot:${token}`);
        const otherTenant = (await as('other-test', 'get', `${channel}/threads/${kind}/${id}/messages`)).body;
        assert.equal(otherTenant.items.length, 0, 'manual messages never leak into another tenant');
    }
});
