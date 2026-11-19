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

test.after(async () => {
    shared._resetCache();
    await pool.closeAll();
    await appDb.closeDatabase();
    await platformDb.closeDatabase();
    await controlDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

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
    await authUsers.createUser({ username: 'lisi', role: 'admin', passwordHash: 'x', tenantId: 'lisi', displayName: '李四' });
    assert.deepEqual((await call('alice', 'GET', '/accounts?q=ls')).body.items.map(item => item.username), ['lisi'], 'pinyin initials match the display name');
    assert.deepEqual((await call('alice', 'GET', '/accounts?q=car')).body.items.map(item => item.username), ['carol']);
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

    // Bob 删除本地副本 = 退出共享；Alice 停止共享后不再出现在双方「共享对话」列表中
    await call('bob', 'POST', `/session/${bobSession}/leave`);
    assert.equal((await call('bob', 'GET', '/mine')).body.items.length, 0);
    assert.deepEqual((await call('alice', 'POST', `/session/${aliceSession}/leave`)).body, { closed: true });
    assert.equal((await call('alice', 'GET', '/mine')).body.items.length, 0, 'closed share must be removed from initiator /mine list');
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

test('shared workspace deliverables, tool artifacts, images and buildEffectiveMessages sync safely to recipients', async t => {
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/shared-conversations', require('../backend/routes/shared-conversations'));
    app.use('/api/agent-files', require('../backend/routes/agent-files'));
    app.use('/api/workspace', require('../backend/routes/agent-workspace'));
    const aiRouter = require('../backend/routes/ai');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });

    await authUsers.ensureReady();
    for (const user of ['alice2', 'bob2']) {
        await authUsers.createUser({ username: user, role: 'admin', passwordHash: 'x', tenantId: user, displayName: `${user.toUpperCase()}Name` });
        await authSessions.saveSession(`tok-${user}`, user, 'admin', Date.now() + 60000, user);
    }

    const aliceWs = path.join(sandbox, 'alice2-ws');
    fs.mkdirSync(aliceWs, { recursive: true });
    const htmlPath = path.join(aliceWs, 'monthly_report_202605.html');
    fs.writeFileSync(htmlPath, '<!doctype html><html><body>Old BG</body></html>', 'utf8');
    fs.writeFileSync(path.join(aliceWs, 'notes.md'), '# Release Notes', 'utf8');
    fs.writeFileSync(path.join(aliceWs, '.env'), 'SECRET=topsecret', 'utf8');
    const imgPath = path.join(aliceWs, 'preview.png');
    fs.writeFileSync(imgPath, Buffer.from('PNGDATA'));
    const artifact = await artifacts.spill({
        owner: 'alice2::alice2',
        sessionId: 'sess-alice2',
        callId: 'call_big',
        toolName: 'read_database_table',
        content: 'row\n'.repeat(3000)
    });

    const aliceSession = await runWithTenant('alice2', async () => {
        const id = await chat.addMessage({ owner: 'alice2', pagePath: '/', role: 'user', content: '生成月报 HTML，并附上 [notes.md](notes.md) 和 [secret](.env)' });
        await chat.setSessionAgent(id, { agentSessionId: 'ag-alice2-ws1', root: aliceWs, owner: 'alice2' });
        await chat.addMessage({
            sessionId: id,
            owner: 'alice2',
            pagePath: '/',
            role: 'model',
            content: '已生成 `monthly_report_202605.html`。\n\n（本轮调用工具 2 次：`read_database_table`、`write_file`）',
            events: [
                { type: 'tool_start', callId: 'c1', tool: 'read_database_table', args: { table: 'metrics' } },
                { type: 'tool_result', callId: 'c1', tool: 'read_database_table', ok: true, artifact: { path: artifact.artifact.path, lines: artifact.artifact.lines }, images: [imgPath] },
                { type: 'tool_start', callId: 'c2', tool: 'write_file', args: { path: 'monthly_report_202605.html' } },
                { type: 'tool_result', callId: 'c2', tool: 'write_file', ok: true, summary: 'monthly_report_202605.html +1 -0' }
            ]
        });
        return id;
    });

    const base = `http://127.0.0.1:${server.address().port}/api`;
    const apiJson = async (user, method, url, body) => {
        const res = await fetch(`${base}${url}`, { method, headers: { Authorization: `Bearer tok-${user}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json() };
    };
    const inv = await apiJson('alice2', 'POST', `/shared-conversations/session/${aliceSession}/invite`, { title: '月报评审', usernames: ['bob2'] });
    assert.equal(inv.status, 200);
    const bobInbox = await apiJson('bob2', 'GET', '/shared-conversations/inbox');
    const acc = await apiJson('bob2', 'POST', `/shared-conversations/invites/${bobInbox.body.items[0].shareId}/respond`, { action: 'accept' });
    const bobSession = acc.body.sessionId;

    const bobMsgs = await runWithTenant('bob2', () => chat.listMessages(bobSession, { owner: 'bob2' }));
    assert.equal(bobMsgs.length, 2);
    // .env secret must NEVER be relinked or copied
    assert.ok(!bobMsgs[0].content.includes('SECRET=topsecret'));
    const notesLink = /\(<([^>]+)>\)/.exec(bobMsgs[0].content);
    assert.ok(notesLink, 'relative markdown workspace link is relinked to recipient copy');
    assert.ok(artifacts.ownsFile('bob2::bob2', notesLink[1]));
    assert.equal(fs.readFileSync(notesLink[1], 'utf8'), '# Release Notes');

    const writeStart = bobMsgs[1].events.find(e => e.type === 'tool_start' && e.tool === 'write_file');
    assert.equal(writeStart.args.path, 'monthly_report_202605.html', 'keeps readable display path');
    assert.ok(writeStart.sharedPath && artifacts.ownsFile('bob2::bob2', writeStart.sharedPath), 'copies generated HTML for recipient');
    assert.ok(fs.readFileSync(writeStart.sharedPath, 'utf8').includes('Old BG'));

    const artRes = bobMsgs[1].events.find(e => e.type === 'tool_result' && e.tool === 'read_database_table');
    assert.ok(artifacts.ownsFile('bob2::bob2', artRes.artifact.path));
    assert.ok(artifacts.ownsFile('bob2::bob2', artRes.images[0]));

    // Bob can view synced generated HTML via both /api/workspace/file (even with empty root) and /api/agent-files/raw
    const wsView = await fetch(`${base}/workspace/file/shared?root=&path=${encodeURIComponent(writeStart.sharedPath)}`, { headers: { Authorization: 'Bearer tok-bob2' } });
    assert.equal(wsView.status, 200);
    assert.match((await wsView.json()).content, /Old BG/);
    const rawArt = await fetch(`${base}/agent-files/raw?path=${encodeURIComponent(artRes.artifact.path)}`, { headers: { Authorization: 'Bearer tok-bob2' } });
    assert.equal(rawArt.status, 200);
    // Alice's original artifact remains forbidden to Bob
    const origForbidden = await fetch(`${base}/agent-files/raw?path=${encodeURIComponent(artifact.artifact.path)}`, { headers: { Authorization: 'Bearer tok-bob2' } });
    assert.equal(origForbidden.status, 403);

    // Context passed to LLM attributes both user & model turns with participant username+name, sanitizes tool footer, and surfaces synced file paths
    const effective = await runWithTenant('bob2', () => aiRouter.buildEffectiveMessages({
        sessionId: bobSession,
        incomingMessages: [],
        lastMessage: { role: 'user', content: '这个html帮我继续优化 背景不好看' },
        ownerKey: 'bob2::bob2'
    }));
    assert.match(effective[0].content, /ALICE2Name \(alice2\)/);
    assert.match(effective[0].content, /notes\.md ->/);
    assert.match(effective[1].content, /共享对话成员 ALICE2Name \(alice2\) 收到的 AI 回复/);
    assert.doesNotMatch(effective[1].content, /（本轮调用工具/);
    assert.match(effective[1].content, /monthly_report_202605\.html ->/);
    assert.equal(effective[2].content, '这个html帮我继续优化 背景不好看');
});

test('shared conversation missing skills/tools awareness, owner approval grant, conflicts, and public promotion cleanup', async t => {
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/shared-conversations', require('../backend/routes/shared-conversations'));
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));

    const skillsStore = require('../backend/models/agent-skills-store');
    const toolDistribution = require('../backend/models/tool-distribution');
    const { DEFAULT_TENANT_ID } = require('../backend/models/tenant-context');

    await authUsers.ensureReady();
    await runWithTenant(DEFAULT_TENANT_ID, async () => {
        await authUsers.createUser({ username: 'alice3', role: 'admin', displayName: 'Alice3', passwordHash: 'x', tenantId: 'alice3' });
        await authUsers.createUser({ username: 'bob3', role: 'user', displayName: 'Bob3', passwordHash: 'x', tenantId: 'bob3' });
        await authUsers.createUser({ username: 'carol3', role: 'user', displayName: 'Carol3', passwordHash: 'x', tenantId: 'carol3' });
        await authSessions.saveSession('tok-alice3', 'alice3', 'admin', Date.now() + 60000, 'alice3');
        await authSessions.saveSession('tok-bob3', 'bob3', 'user', Date.now() + 60000, 'bob3');
        await authSessions.saveSession('tok-carol3', 'carol3', 'user', Date.now() + 60000, 'carol3');
    });

    await runWithTenant('alice3', async () => {
        await skillsStore.createFromMarkdown('---\nid: alice-priv-skill\nname: Alice私有分析\ndescription: Alice only skill\n---\nAlways greet Alice team.', {
            user: { username: 'alice3', role: 'admin', tenantId: 'alice3' },
            createdBy: 'alice3'
        });
        await skillsStore.createFromMarkdown('---\nid: conflict-skill\nname: Alice版本规则\ndescription: Alice conflict skill\n---\nUse Alice rule body v1.', {
            user: { username: 'alice3', role: 'admin', tenantId: 'alice3' },
            createdBy: 'alice3'
        });
    });
    await runWithTenant('bob3', async () => {
        await skillsStore.createFromMarkdown('---\nid: conflict-skill\nname: Bob本地规则\ndescription: Bob own custom skill\n---\nKeep Bob local custom skill intact.', {
            user: { username: 'bob3', role: 'user', tenantId: 'bob3' },
            createdBy: 'bob3'
        });
    });

    const aliceSession = await runWithTenant('alice3', async () => {
        const id = await chat.addMessage({ owner: 'alice3', pagePath: '/', role: 'user', content: '请用 @alice-priv-skill 和 @conflict-skill 检查数据，并写入库' });
        await chat.addMessage({
            sessionId: id,
            owner: 'alice3',
            pagePath: '/',
            role: 'model',
            content: '已完成检查。\n\n（本轮调用工具 1 次：`insert_database_row`）',
            events: [
                { type: 'skills', skills: ['alice-priv-skill', 'conflict-skill'] },
                { type: 'tool_start', callId: 't_ins', tool: 'insert_database_row', args: { table: 'metrics' } }
            ]
        });
        return id;
    });

    const base = `http://127.0.0.1:${server.address().port}/api`;
    const apiJson = async (user, method, url, body) => {
        const res = await fetch(`${base}${url}`, { method, headers: { Authorization: `Bearer tok-${user}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json() };
    };

    const inv = await apiJson('alice3', 'POST', `/shared-conversations/session/${aliceSession}/invite`, { title: '跨团队排障', usernames: ['bob3', 'carol3'] });
    assert.equal(inv.status, 200);

    // Bob accepts first; Carol hasn't accepted yet (late joiner test)
    const bobInbox = await apiJson('bob3', 'GET', '/shared-conversations/inbox');
    const bobAccept = await apiJson('bob3', 'POST', `/shared-conversations/invites/${bobInbox.body.items[0].shareId}/respond`, { action: 'accept' });
    const bobSession = bobAccept.body.sessionId;

    // Missing capabilities detected for Bob: alice-priv-skill (Bob already owns an unrelated local conflict-skill) & restricted admin tool
    const bobDetail = await apiJson('bob3', 'GET', `/shared-conversations/session/${bobSession}`);
    assert.equal(bobDetail.status, 200);
    const missingSkillIds = bobDetail.body.share.missingCapabilities.skills.map(s => s.id);
    assert.ok(missingSkillIds.includes('alice-priv-skill'));
    assert.ok(bobDetail.body.share.missingCapabilities.tools.some(t => t.name === 'insert_database_row'));

    // Bob requests authorization for alice-priv-skill (deduped on second call)
    const req1 = await apiJson('bob3', 'POST', `/shared-conversations/session/${bobSession}/skill-requests`, { skillId: 'alice-priv-skill' });
    assert.equal(req1.status, 200);
    assert.equal(req1.body.request.status, 'pending');
    const req1Dup = await apiJson('bob3', 'POST', `/shared-conversations/session/${bobSession}/skill-requests`, { skillId: 'alice-priv-skill' });
    assert.equal(req1Dup.status, 200);
    assert.equal(req1Dup.body.deduplicated, true);

    // Non-owner cannot approve
    const forbiddenApprove = await apiJson('bob3', 'POST', `/shared-conversations/skill-requests/${req1.body.request.id}/respond`, { action: 'approve' });
    assert.equal(forbiddenApprove.status, 403);

    // Alice sees approval card in inbox AND in session pendingSkillRequests
    const aliceInbox = await apiJson('alice3', 'GET', '/shared-conversations/inbox');
    assert.equal(aliceInbox.body.skillRequests.length, 1);
    assert.equal(aliceInbox.body.skillRequests[0].skillId, 'alice-priv-skill');
    const aliceSessionDetail = await apiJson('alice3', 'GET', `/shared-conversations/session/${aliceSession}`);
    assert.equal(aliceSessionDetail.body.share.pendingSkillRequests.length, 1);

    // Alice approves alice-priv-skill -> Bob immediately receives imported skill (NOT globally public!)
    const approved1 = await apiJson('alice3', 'POST', `/shared-conversations/skill-requests/${req1.body.request.id}/respond`, { action: 'approve' });
    assert.equal(approved1.status, 200);
    assert.equal(approved1.body.status, 'approved');

    const bobSkillsAfter = await runWithTenant('bob3', () => skillsStore.listForUser({ username: 'bob3', role: 'user', tenantId: 'bob3' }));
    const bobGranted = bobSkillsAfter.find(s => s.id === 'alice-priv-skill');
    assert.ok(bobGranted && bobGranted.sharedGrant === true);
    assert.equal(await toolDistribution.hasEntryAccess('skill:alice-priv-skill'), false, 'must NOT open to all employees');

    // Carol accepts LATER -> automatically receives alice-priv-skill, and sees conflict-skill is still missing for Carol
    const carolInbox = await apiJson('carol3', 'GET', '/shared-conversations/inbox');
    const carolAccept = await apiJson('carol3', 'POST', `/shared-conversations/invites/${carolInbox.body.items[0].shareId}/respond`, { action: 'accept' });
    const carolSession = carolAccept.body.sessionId;
    const carolSkills = await runWithTenant('carol3', () => skillsStore.listForUser({ username: 'carol3', role: 'user', tenantId: 'carol3' }));
    assert.ok(carolSkills.some(s => s.id === 'alice-priv-skill' && s.sharedGrant === true), 'late joiner automatically receives approved share skill');

    // Conflict scenario: Carol lacks `conflict-skill` and requests it; Bob already has his own `conflict-skill` -> Alice approves -> Carol gets `conflict-skill`, Bob gets alias without overwriting Bob's local copy
    const reqConflict = await apiJson('carol3', 'POST', `/shared-conversations/session/${carolSession}/skill-requests`, { skillId: 'conflict-skill' });
    assert.equal(reqConflict.status, 200);
    const approvedConflict = await apiJson('alice3', 'POST', `/shared-conversations/skill-requests/${reqConflict.body.request.id}/respond`, { action: 'approve' });
    assert.equal(approvedConflict.status, 200);

    const bobAfterConflict = await apiJson('bob3', 'GET', `/shared-conversations/session/${bobSession}`);
    const aliasId = bobAfterConflict.body.share.skillAliases['conflict-skill'];
    assert.ok(aliasId && aliasId !== 'conflict-skill', `expected non-colliding alias for conflict-skill, got ${aliasId}`);
    const bobOriginal = await runWithTenant('bob3', () => skillsStore.getSkill('conflict-skill'));
    assert.match(bobOriginal.body, /Keep Bob local custom skill intact/);
    const bobLoadedViaAlias = await runWithTenant('bob3', () => skillsStore.loadAll('run @conflict-skill', {
        user: { username: 'bob3', role: 'user', tenantId: 'bob3' },
        aliases: bobAfterConflict.body.share.skillAliases
    }));
    assert.ok(bobLoadedViaAlias.selected.some(s => s.id === aliasId), 'loadAll resolves shared alias when @conflict-skill is invoked');

    // Subsequent 「全员开放」 scenario:
    // 1) Bob locally customizes his granted `alice-priv-skill`
    // 2) Carol keeps her granted `alice-priv-skill` unmodified
    // 3) Platform publishes `alice-priv-skill` and enables shared access
    await runWithTenant('bob3', () => skillsStore.createFromMarkdown('---\nid: alice-priv-skill\nname: Alice私有分析(Bob本地魔改)\ndescription: Modified locally\n---\nBob customized granted body.', {
        user: { username: 'bob3', role: 'user', tenantId: 'bob3' },
        createdBy: 'bob3',
        overwrite: true
    }));
    await runWithTenant(DEFAULT_TENANT_ID, async () => {
        await skillsStore.createFromMarkdown('---\nid: alice-priv-skill\nname: 官方全员版Alice分析\ndescription: Public version\n---\nOfficial public version.', {
            createdBy: 'admin',
            overwrite: true
        });
        await toolDistribution.setEntryAccess('skill:alice-priv-skill', true);
    });

    const carolPublicView = await runWithTenant('carol3', () => skillsStore.listForUser({ username: 'carol3', role: 'user', tenantId: 'carol3' }));
    const carolMatches = carolPublicView.filter(s => s.id === 'alice-priv-skill');
    assert.equal(carolMatches.length, 1, 'unmodified granted copy yields to newly-public platform skill with zero duplicates');
    assert.equal(carolMatches[0].sharedAccess, true);
    assert.equal(carolMatches[0].shared, true);

    const bobConflictView = await runWithTenant('bob3', () => skillsStore.listForUser({ username: 'bob3', role: 'user', tenantId: 'bob3' }));
    const bobMatches = bobConflictView.filter(s => s.id === 'alice-priv-skill');
    assert.equal(bobMatches.length, 1);
    assert.equal(bobMatches[0].sharedGrantConflict, 'local_modified_vs_public');
});

test('shared workspace auto-mounts originator dir, saves uploads there, isolates shell via sandbox_task, and revokes access on stop', async t => {
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/shared-conversations', require('../backend/routes/shared-conversations'));
    app.use('/api/ai', require('../backend/routes/ai'));
    app.use('/api/agent-workspace', require('../backend/routes/agent-workspace'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });

    await authUsers.ensureReady();
    await authUsers.createUser({ username: 'alice4', role: 'admin', passwordHash: 'x', tenantId: 'alice4', displayName: 'Alice4' });
    await authUsers.createUser({ username: 'bob4', role: 'admin', passwordHash: 'x', tenantId: 'bob4', displayName: 'Bob4' });
    await authSessions.saveSession('tok-alice4', 'alice4', 'admin', Date.now() + 60000, 'alice4');
    await authSessions.saveSession('tok-bob4', 'bob4', 'admin', Date.now() + 60000, 'bob4');

    const base = `http://127.0.0.1:${server.address().port}/api`;
    const apiJson = async (who, method, p, body) => {
        const res = await fetch(`${base}${p}`, {
            method,
            headers: { Authorization: `Bearer tok-${who}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        return { status: res.status, body: await res.json() };
    };

    // Unsafe roots must never be shared; safe project dir is allowed
    const vaultDir = path.join(process.env.TOOLS_DATA_DIR, 'vault', 'secret-box');
    fs.mkdirSync(vaultDir, { recursive: true });
    assert.equal(shared.isShareableWorkspaceRoot('/'), false);
    assert.equal(shared.isShareableWorkspaceRoot(vaultDir), false);

    const originDir = path.join(sandbox, 'alice4-project');
    fs.mkdirSync(originDir, { recursive: true });
    fs.writeFileSync(path.join(originDir, 'report.txt'), 'initial-shared-content\n', 'utf8');
    fs.writeFileSync(path.join(originDir, '.env'), 'SECRET_TOKEN=must-never-copy\n', 'utf8');

    const aliceSession = await runWithTenant('alice4', async () => {
        const id = await chat.addMessage({ owner: 'alice4', pagePath: '/', role: 'user', content: '看看工作区报告' });
        await chat.addMessage({ sessionId: id, owner: 'alice4', pagePath: '/', role: 'model', content: '工作区已准备好' });
        await chat.setSessionAgent(id, { agentSessionId: 'alice4-agent-001', root: originDir, owner: 'alice4' });
        return id;
    });

    const inviteRes = await apiJson('alice4', 'POST', `/shared-conversations/session/${aliceSession}/invite`, {
        title: '共享工作区协作',
        usernames: ['bob4']
    });
    assert.equal(inviteRes.status, 200);
    assert.equal(inviteRes.body.share.sharedWorkspace.enabled, true);
    assert.equal(inviteRes.body.share.sharedWorkspace.folderName, 'alice4-project');
    assert.ok(inviteRes.body.share.sharedWorkspace.virtualRoot.startsWith('shared-ws://'));
    // Must not expose raw host path in share descriptor
    assert.equal('root' in inviteRes.body.share.sharedWorkspace, false);

    const bobInbox = await apiJson('bob4', 'GET', '/shared-conversations/inbox');
    const acceptRes = await apiJson('bob4', 'POST', `/shared-conversations/invites/${bobInbox.body.items[0].shareId}/respond`, { action: 'accept' });
    assert.equal(acceptRes.status, 200);
    const bobSession = acceptRes.body.sessionId;
    const shareId = acceptRes.body.share.id;
    assert.equal(acceptRes.body.share.sharedWorkspace.isOwner, false);
    assert.equal(acceptRes.body.share.sharedWorkspace.canRunCommand, false);
    assert.equal(acceptRes.body.share.sharedWorkspace.virtualRoot, `shared-ws://${shareId}`);

    // Recipient workspace session mounts originDir with direct run_command disabled
    const runManager = require('../backend/models/agent-run-manager');
    const toolRegistry = require('../backend/models/agent-tool-registry');
    const bobUser = { username: 'bob4', role: 'admin', tenantId: 'bob4' };
    const sharedSession = runManager.ensureSharedWorkspaceSession({
        shareId,
        originOwner: 'alice4',
        originOwnerTenant: 'alice4',
        originRoot: originDir,
        folderName: 'alice4-project',
        user: bobUser,
        tenantId: 'bob4'
    });
    assert.equal(sharedSession.disableRunCommand, true);
    assert.equal(sharedSession.confined, true);
    const reg = await runWithTenant('bob4', () => toolRegistry.create({ session: sharedSession, user: bobUser }));
    assert.equal(reg.allowed('run_command'), false, 'run_command must be disabled on non-owner registry');
    assert.equal(reg.definitions().some(d => d.name === 'run_command'), false);
    assert.equal(reg.allowed('write_file'), true, 'write_file allowed for collaborative edits');

    // Upload by Bob saves directly into originator originDir/shared-uploads/
    const form = new FormData();
    form.append('sessionId', bobSession);
    form.append('expectSharedWorkspace', '1');
    form.append('files', new Blob(['uploaded by bob\n'], { type: 'text/plain' }), 'bob-note.txt');
    const upRes = await fetch(`${base}/ai/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer tok-bob4` },
        body: form
    });
    const upBody = await upRes.json();
    assert.equal(upRes.status, 200, JSON.stringify(upBody));
    assert.match(upBody.files[0].workspacePath, /^shared-uploads\/bob-note\.txt$/);
    assert.equal(fs.readFileSync(path.join(originDir, 'shared-uploads', 'bob-note.txt'), 'utf8'), 'uploaded by bob\n');

    // Bob can preview files in originDir via virtualRoot (and secrets like .env remain blocked)
    const fileOk = await apiJson('bob4', 'GET', `/agent-workspace/file/shws?root=${encodeURIComponent(`shared-ws://${shareId}`)}&path=${encodeURIComponent('shared-uploads/bob-note.txt')}`);
    assert.equal(fileOk.status, 200);
    assert.equal(fileOk.body.content, 'uploaded by bob\n');

    const secretBlocked = await apiJson('bob4', 'GET', `/agent-workspace/file/shws?root=${encodeURIComponent(`shared-ws://${shareId}`)}&path=${encodeURIComponent('.env')}`);
    assert.equal(secretBlocked.status, 403);

    // sandbox_task allocates Bob's own isolated timedScratchRoot, stages safe files (skipping .env), runs run_command, and syncs new output back to originDir
    const sandboxSubagent = require('../backend/models/agent-sandbox-subagent');
    const subEvents = [];
    let step = 0;
    const mockClient = {
        model: 'mock-model',
        settings: { contextWindowTokens: 32000 },
        async generateText() {
            step += 1;
            if (step === 1) {
                return {
                    text: '',
                    toolCalls: [{ id: 'tc1', name: 'run_command', args: { command: 'test ! -f .env && cat report.txt && printf "from-sandbox\\n" > sandbox-output.txt' } }],
                    usage: { inputTokens: 10, outputTokens: 5 }
                };
            }
            return { text: '沙箱测试与产物生成完成', toolCalls: [], usage: { inputTokens: 12, outputTokens: 8 } };
        }
    };
    const sbResult = await runWithTenant('bob4', () => sandboxSubagent.run({
        call: { id: 'sb-1', args: { description: '运行沙箱命令', prompt: '校验 .env 未拷贝并生成 sandbox-output.txt' } },
        originRoot: originDir,
        user: bobUser,
        tenantId: 'bob4',
        chatSessionId: bobSession,
        parentSession: sharedSession,
        client: mockClient,
        model: 'mock-model',
        write: evt => subEvents.push(evt),
        allocateRoot: runManager.timedScratchRoot
    }));
    assert.equal(Boolean(sbResult.isError), false);
    assert.ok(sbResult.syncedOutputs.includes('sandbox-output.txt'));
    assert.equal(fs.readFileSync(path.join(originDir, 'sandbox-output.txt'), 'utf8'), 'from-sandbox\n');
    assert.ok(subEvents.some(e => e.type === 'subagent' && e.phase === 'done' && e.ok === true));

    // Originator stops sharing -> immediate revocation for workspace file access, uploads, and session check
    const stopRes = await apiJson('alice4', 'POST', `/shared-conversations/session/${aliceSession}/leave`);
    assert.equal(stopRes.status, 200);
    assert.equal(stopRes.body.closed, true);

    const revokedFile = await apiJson('bob4', 'GET', `/agent-workspace/file/shws?root=${encodeURIComponent(`shared-ws://${shareId}`)}&path=report.txt`);
    assert.equal(revokedFile.status, 403);
    assert.equal(revokedFile.body.code, 'SHARE_WORKSPACE_REVOKED');

    const formAfterStop = new FormData();
    formAfterStop.append('sessionId', bobSession);
    formAfterStop.append('expectSharedWorkspace', '1');
    formAfterStop.append('files', new Blob(['blocked'], { type: 'text/plain' }), 'late.txt');
    const upBlocked = await fetch(`${base}/ai/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer tok-bob4` },
        body: formAfterStop
    });
    assert.equal(upBlocked.status, 403);
    assert.equal(fs.existsSync(path.join(originDir, 'shared-uploads', 'late.txt')), false);

    // Non-owner copy is revoked and removed from normal session list, while initiator keeps their own session
    const bobListAfterStop = await apiJson('bob4', 'GET', '/ai/sessions?mine=1&pagePath=%2F');
    assert.equal(bobListAfterStop.status, 200);
    assert.equal(bobListAfterStop.body.items.some(item => item.id === bobSession), false);
    const bobSyncAfterStop = await apiJson('bob4', 'POST', `/shared-conversations/session/${bobSession}/sync`);
    assert.equal(bobSyncAfterStop.body.result.closed, true);
    assert.equal(bobSyncAfterStop.body.result.revoked, true);
    const bobPrepareAfterStop = await apiJson('bob4', 'POST', `/shared-conversations/session/${bobSession}/prepare`, {});
    assert.equal(bobPrepareAfterStop.status, 409);
    assert.equal(bobPrepareAfterStop.body.code, 'SHARE_REVOKED');
    const aliceListAfterStop = await apiJson('alice4', 'GET', '/ai/sessions?mine=1&pagePath=%2F');
    assert.equal(aliceListAfterStop.body.items.some(item => item.id === aliceSession), true);
});

test('stopping or removing a shared conversation revokes non-owner copies including pre-existing closed rows', async t => {
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
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
    });

    await authUsers.ensureReady();
    for (const u of ['alice5', 'bob5']) {
        await authUsers.createUser({ username: u, role: 'admin', passwordHash: 'x', tenantId: u, displayName: u });
        await authSessions.saveSession(`tok-${u}`, u, 'admin', Date.now() + 60000, u);
    }
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const apiJson = async (who, method, p, body) => {
        const res = await fetch(`${base}${p}`, {
            method,
            headers: { Authorization: `Bearer tok-${who}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
        return { status: res.status, body: await res.json() };
    };

    const aliceSession = await runWithTenant('alice5', async () => {
        const id = await chat.addMessage({ owner: 'alice5', pagePath: '/', role: 'user', content: '内部指标分析' });
        await chat.addMessage({ sessionId: id, owner: 'alice5', pagePath: '/', role: 'model', content: '已完成指标汇总' });
        return id;
    });
    const inv = await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/invite`, { title: '内部指标分析', usernames: ['bob5'] });
    assert.equal(inv.status, 200);
    const bobInbox = await apiJson('bob5', 'GET', '/shared-conversations/inbox');
    const acc = await apiJson('bob5', 'POST', `/shared-conversations/invites/${bobInbox.body.items[0].shareId}/respond`, { action: 'accept' });
    const bobSession = acc.body.sessionId;
    const shareId = acc.body.share.id;

    // Simulate legacy pre-fix state: share closed directly in control-db while recipient still had local copy & accepted status
    await controlDb.run("UPDATE shared_conversations SET status = 'closed' WHERE id = ?", [shareId]);
    assert.ok(await runWithTenant('bob5', () => chat.getSession(bobSession)), 'precondition: legacy copy lingers in tenant db');

    const bobMineSessions = await apiJson('bob5', 'GET', '/ai/sessions?mine=1&pagePath=%2F');
    assert.equal(bobMineSessions.status, 200);
    assert.equal(bobMineSessions.body.items.some(item => item.id === bobSession), false, 'legacy closed shared copy must be swept and hidden');
    assert.equal(await runWithTenant('bob5', () => chat.getSession(bobSession)), undefined);
    const bobMsgs = await apiJson('bob5', 'GET', `/ai/sessions/${bobSession}/messages`);
    assert.equal(bobMsgs.status, 404);
    assert.equal(bobMsgs.body.code, 'SHARE_REVOKED');
    // Initiator reactivates share and later removes Bob -> Bob's new copy is also purged
    const prep = await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/prepare`, {});
    assert.equal(prep.status, 200);
    const inv2 = await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/invite`, { usernames: ['bob5'] });
    assert.equal(inv2.status, 200);
    const bobInbox2 = await apiJson('bob5', 'GET', '/shared-conversations/inbox');
    const acc2 = await apiJson('bob5', 'POST', `/shared-conversations/invites/${bobInbox2.body.items[0].shareId}/respond`, { action: 'accept' });
    const bobSession2 = acc2.body.sessionId;
    assert.notEqual(bobSession2, bobSession);
    await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/remove`, { username: 'bob5' });
    const bobListAfterRemove = await apiJson('bob5', 'GET', '/ai/sessions?mine=1&pagePath=%2F');
    assert.equal(bobListAfterRemove.body.items.some(item => item.id === bobSession2), false);

    // Non-owner deleting local copy leaves share without affecting owner; owner deleting origin session closes share & purges remaining members
    await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/prepare`, {});
    await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/invite`, { usernames: ['bob5'] });
    const bobInbox3 = await apiJson('bob5', 'GET', '/shared-conversations/inbox');
    const bobAcc3 = await apiJson('bob5', 'POST', `/shared-conversations/invites/${bobInbox3.body.items[0].shareId}/respond`, { action: 'accept' });
    const bobSession3 = bobAcc3.body.sessionId;
    const bobDel = await apiJson('bob5', 'DELETE', `/ai/sessions/${bobSession3}`);
    assert.equal(bobDel.status, 200);
    assert.equal((await apiJson('bob5', 'GET', '/shared-conversations/mine')).body.items.length, 0);
    const aliceStill = await apiJson('alice5', 'GET', `/ai/sessions/${aliceSession}/messages`);
    assert.equal(aliceStill.status, 200, 'owner session stays intact after member deletes local copy');

    // Now re-invite Bob, then Alice (owner) deletes her origin session -> share closes and Bob copy is purged
    await apiJson('alice5', 'POST', `/shared-conversations/session/${aliceSession}/invite`, { usernames: ['bob5'] });
    const bobInbox4 = await apiJson('bob5', 'GET', '/shared-conversations/inbox');
    const bobAcc4 = await apiJson('bob5', 'POST', `/shared-conversations/invites/${bobInbox4.body.items[0].shareId}/respond`, { action: 'accept' });
    const bobSession4 = bobAcc4.body.sessionId;
    const aliceDel = await apiJson('alice5', 'DELETE', `/ai/sessions/${aliceSession}`);
    assert.equal(aliceDel.status, 200);
    assert.equal(await runWithTenant('bob5', () => chat.getSession(bobSession4)), undefined, 'owner deleting origin session sweeps member copy');
    assert.equal((await apiJson('bob5', 'GET', '/shared-conversations/mine')).body.items.length, 0);
});
