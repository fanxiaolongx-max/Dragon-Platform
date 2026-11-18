const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-claw-shared-conv-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware, runWithTenant } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const authUsers = require('../backend/models/auth-users-repository');
const chat = require('../backend/models/ai-chat-repository');
const shared = require('../backend/models/shared-conversations');
const artifacts = require('../backend/models/agent-artifacts');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');
const controlDb = require('../backend/models/control-db');

test('a conversation shared across team accounts syncs context both ways without touching the other team database', async t => {
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    // 真实的上游写操作门禁：普通团队账号也要能调用共享接口
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/shared-conversations', require('../backend/routes/shared-conversations'));
    app.use('/api/ai', require('../backend/routes/ai'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        await controlDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    await authUsers.ensureReady();
    for (const user of ['alice', 'bob', 'carol']) {
        await authUsers.createUser({ username: user, role: 'admin', passwordHash: 'x', tenantId: user, displayName: user.toUpperCase() });
        await authSessions.saveSession(`tok-${user}`, user, 'admin', Date.now() + 60000, user);
    }
    const base = `http://127.0.0.1:${server.address().port}/api/shared-conversations`;
    const call = async (user, method, url, body) => {
        const res = await fetch(`${base}${url}`, { method, headers: { Authorization: `Bearer tok-${user}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json() };
    };

    // Alice 在自己团队里有一段带附件的对话
    const aliceUpload = await artifacts.saveUpload('alice::alice', { originalname: 'spec.md', buffer: Buffer.from('# secret spec') });
    const aliceSession = await runWithTenant('alice', async () => {
        const id = await chat.addMessage({ owner: 'alice', pagePath: '/', role: 'user', content: `看看这个文件 [spec.md](<${aliceUpload.path}>)` });
        await chat.addMessage({ sessionId: id, owner: 'alice', pagePath: '/', role: 'model', content: '好的，规格已阅读。' });
        return id;
    });

    // 账号搜索不含自己；未知账号拒绝
    const accounts = await call('alice', 'GET', '/accounts');
    assert.deepEqual(accounts.body.items.map(item => item.username).filter(name => name !== 'admin'), ['bob', 'carol']);
    assert.equal((await call('alice', 'POST', `/session/${aliceSession}/invite`, { usernames: ['nobody'] })).status, 400);
    // 别人的对话不能共享
    assert.equal((await call('bob', 'POST', `/session/${aliceSession}/prepare`, {})).status, 404);

    // 常用群组 + 邀请
    const group = await call('alice', 'POST', '/groups', { name: '北美组', members: ['carol', 'alice'] });
    assert.deepEqual(group.body.item.members, ['carol']);
    const invited = await call('alice', 'POST', `/session/${aliceSession}/invite`, { title: '规格评审', usernames: ['bob'], groupIds: [group.body.item.id] });
    assert.equal(invited.status, 200);
    assert.deepEqual(invited.body.invited.sort(), ['bob', 'carol']);
    assert.match(invited.body.share.link, /^\/\?share=/);
    const recent = await call('alice', 'GET', '/recent');
    assert.ok(recent.body.users.some(item => item.username === 'bob'));
    assert.equal(recent.body.groups[0].name, '北美组');

    // Bob 收到邀请并接受：自己团队里出现一份完整的本地副本，附件复制进 Bob 自己的附件目录
    const inbox = await call('bob', 'GET', '/inbox');
    assert.equal(inbox.body.items.length, 1);
    assert.equal(inbox.body.items[0].title, '规格评审');
    assert.equal(inbox.body.items[0].messageCount, 2);
    const accepted = await call('bob', 'POST', `/invites/${inbox.body.items[0].shareId}/respond`, { action: 'accept' });
    assert.equal(accepted.body.status, 'accepted');
    const bobSession = accepted.body.sessionId;
    const bobMessages = await runWithTenant('bob', () => chat.listMessages(bobSession, { owner: 'bob' }));
    assert.equal(bobMessages.length, 2);
    assert.equal(bobMessages[0].events.find(event => event.type === 'shared_author').author, 'alice');
    const copied = /\(<([^>]+)>\)/.exec(bobMessages[0].content)[1];
    assert.ok(artifacts.ownsFile('bob::bob', copied), 'attachment must live in Bob\'s own upload dir');
    assert.equal(fs.readFileSync(copied, 'utf8'), '# secret spec');
    assert.ok(!bobMessages[0].content.includes(aliceUpload.path));
    // Alice 的团队库里没有 Bob 的会话；Bob 的库里也没有 Alice 的原会话
    assert.equal(await runWithTenant('alice', () => chat.getSession(bobSession)), undefined);
    assert.equal(await runWithTenant('bob', () => chat.getSession(aliceSession)), undefined);

    // Bob 接着聊（在 Bob 的团队里执行），Alice 同步后看到 Bob 的提问与回答，并标注账号
    await runWithTenant('bob', async () => {
        await chat.addMessage({ sessionId: bobSession, owner: 'bob', pagePath: '/', role: 'user', content: 'Bob 的补充问题' });
        await chat.addMessage({ sessionId: bobSession, owner: 'bob', pagePath: '/', role: 'model', content: 'Bob 侧 AI 的回答' });
    });
    assert.equal((await call('bob', 'POST', `/session/${bobSession}/sync`)).body.result.pushed, 2);
    const mineBefore = await call('alice', 'GET', '/mine');
    assert.equal(mineBefore.body.items[0].unread, 2);
    assert.equal((await call('alice', 'POST', `/session/${aliceSession}/sync`)).body.result.pulled, 2);
    const aliceMessages = await runWithTenant('alice', () => chat.listMessages(aliceSession, { owner: 'alice' }));
    assert.deepEqual(aliceMessages.map(item => item.content).slice(-2), ['Bob 的补充问题', 'Bob 侧 AI 的回答']);
    assert.equal(shared.authorOf(aliceMessages.at(-2).events).name, 'BOB');
    // 重复同步不产生重复消息，拉回来的副本也不会被再推回去
    assert.equal((await call('alice', 'POST', `/session/${aliceSession}/sync`)).body.result.pushed, 0);
    assert.equal((await call('bob', 'POST', `/session/${bobSession}/sync`)).body.result.pulled, 0);

    // Carol 通过链接加入：先成为待接受邀请，忽略后仍可通过链接再次进入
    await call('carol', 'POST', `/invites/${inbox.body.items[0].shareId}/respond`, { action: 'ignore' });
    assert.equal((await call('carol', 'GET', '/inbox')).body.items.length, 0);
    const token = invited.body.share.link.split('share=')[1];
    const joined = await call('carol', 'POST', `/link/${token}`);
    assert.equal(joined.body.status, 'pending');
    assert.equal(joined.body.invite.title, '规格评审');
    assert.equal((await call('carol', 'POST', '/link/not-a-token')).status, 404);

    // 侧栏的共享对话列表
    const bobMine = await call('bob', 'GET', '/mine');
    assert.equal(bobMine.body.items[0].sessionId, bobSession);
    assert.equal(bobMine.body.items[0].ownerName, 'ALICE');

    // 别人的本地对话 id 不能拿来同步或退出
    assert.equal((await call('carol', 'POST', `/session/${bobSession}/sync`)).body.result, null);
    assert.equal((await call('carol', 'POST', `/session/${bobSession}/leave`)).status, 404);

    // Bob 删除本地副本 = 退出共享；Alice 停止共享后不再同步
    await call('bob', 'POST', `/session/${bobSession}/leave`);
    assert.equal((await call('bob', 'GET', '/mine')).body.items.length, 0);
    assert.deepEqual((await call('alice', 'POST', `/session/${aliceSession}/leave`)).body, { closed: true });
    assert.equal((await call('carol', 'POST', `/link/${token}`)).status, 409);
});

test('a logged-out visit to a share link keeps only a well-formed token through the login redirect', async () => {
    const redirects = [];
    const res = { redirect: target => redirects.push(target) };
    await auth.checkHtmlAuth({ headers: {}, query: { share: 'AbC_123-xyz9' } }, res, () => {});
    await auth.checkHtmlAuth({ headers: {}, query: { share: '../evil?x=1' } }, res, () => {});
    await auth.checkHtmlAuth({ headers: {}, query: {} }, res, () => {});
    assert.deepEqual(redirects, ['/login.html?share=AbC_123-xyz9', '/login.html', '/login.html']);
});
