// 内网直连共享（lan-share）：本进程当主持节点，测试里直接用 HTTP 模拟另一台电脑上的成员节点。
// 多节点（接任选举、换地址、收回主持）的端到端流程需要多个独立进程，见 docs/lan-share.md 的手工验证步骤。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dragon-claw-lan-share-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
process.env.LAN_SHARE = '1';
process.env.LAN_SHARE_ADDRESS = '127.0.0.1';
process.env.LAN_SHARE_HEARTBEAT_MS = '60000';
const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware, runWithTenant } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const authUsers = require('../backend/models/auth-users-repository');
const chat = require('../backend/models/ai-chat-repository');
const shared = require('../backend/models/shared-conversations');
const lanShare = require('../backend/models/lan-share');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');
const controlDb = require('../backend/models/control-db');

test.after(async () => {
    lanShare.stopAll();
    shared._resetCache();
    await pool.closeAll();
    await appDb.closeDatabase();
    await platformDb.closeDatabase();
    await controlDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('lan links only accept intranet http addresses with a share id and token', () => {
    assert.deepEqual(lanShare.parseLink('http://10.1.2.3:3030/lan-share/shr_abc123?t=tok'), { hostUrl: 'http://10.1.2.3:3030', shareId: 'shr_abc123', token: 'tok' });
    assert.throws(() => lanShare.parseLink('http://8.8.8.8:3030/lan-share/shr_abc123?t=tok'), /内网地址/);
    assert.throws(() => lanShare.parseLink('https://10.1.2.3/lan-share/shr_abc123?t=tok'), /格式/);
    assert.throws(() => lanShare.parseLink('http://10.1.2.3:3030/lan-share/shr_abc123'), /格式/);
    assert.ok(lanShare.isPrivateIPv4('10.20.30.40') && lanShare.isPrivateIPv4('172.20.0.1') && !lanShare.isPrivateIPv4('172.32.0.1'));
});

test('a remote desktop joins with the link token, syncs both ways through the host and can be removed', async t => {
    const app = express();
    app.use(express.json());
    const peer = require('../backend/routes/lan-peer');
    app.use('/api/lan-peer', peer.api);
    app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/lan-share', require('../backend/routes/lan-share'));
    app.use('/api/shared-conversations', require('../backend/routes/shared-conversations'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    process.env.PORT = String(server.address().port);
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

    await authUsers.ensureReady();
    await authUsers.createUser({ username: 'alice', role: 'admin', passwordHash: 'x', tenantId: 'alice', displayName: '爱丽丝' });
    await authSessions.saveSession('tok-alice', 'alice', 'admin', Date.now() + 60000, 'alice');
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, url, body, headers = {}) => {
        const res = await fetch(`${base}${url}`, { method, headers: { Authorization: 'Bearer tok-alice', 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, body: await res.json().catch(() => ({})) };
    };

    const sessionId = await runWithTenant('alice', async () => {
        const id = await chat.addMessage({ owner: 'alice', pagePath: '/', role: 'user', content: '内网问题一' });
        await chat.addMessage({ sessionId: id, owner: 'alice', pagePath: '/', role: 'model', content: '内网回答一' });
        return id;
    });

    const info = await call('GET', `/api/lan-share/session/${sessionId}`);
    assert.equal(info.body.available, true);
    assert.equal(info.body.lan, null);
    const created = await call('POST', `/api/lan-share/session/${sessionId}/link`, { title: '内网评审' });
    assert.equal(created.status, 200);
    const lan = created.body.lan;
    assert.equal(lan.isHost, true);
    assert.match(lan.link, new RegExp(`^${base}/lan-share/shr_[\\w-]+\\?t=`));
    const { shareId, token } = lanShare.parseLink(lan.link);

    // 落地页预览：只认令牌
    assert.equal((await call('GET', `/api/lan-peer/${shareId}/preview?t=wrong`)).status, 404);
    assert.equal((await call('GET', `/api/lan-peer/${shareId}/preview?t=${token}`)).body.title, '内网评审');

    // 远端节点加入：错误令牌拒绝；正确令牌拿到成员表（含主持）
    const remote = { peerId: 'pc_remote01', key: 'remote-secret-key', username: 'bob', name: '鲍勃', url: 'http://127.0.0.1:1' };
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/join`, { ...remote, token: 'nope' })).status, 403);
    const joined = await call('POST', `/api/lan-peer/${shareId}/join`, { ...remote, token });
    assert.equal(joined.status, 200);
    assert.deepEqual(joined.body.state.members.map(member => [member.peerId === remote.peerId ? 'remote' : 'host', member.joinOrder]), [['host', 0], ['remote', 1]]);
    const peerHeaders = { 'x-lan-peer': remote.peerId, 'x-lan-key': remote.key };
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/heartbeat`, { url: remote.url }, { ...peerHeaders, 'x-lan-key': 'bad' })).status, 403);
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/heartbeat`, { url: remote.url }, peerHeaders)).status, 200);

    // 远端拉取主持的历史：带全局 origin，作者改写成 lan:<主持节点>:<账号>
    const log = await call('GET', `/api/lan-peer/${shareId}/log?after=0`, undefined, peerHeaders);
    assert.deepEqual(log.body.rows.map(row => row.content), ['内网问题一', '内网回答一']);
    assert.ok(log.body.rows.every(row => /^pc_[\w-]+:\d+$/.test(row.origin) && row.author.startsWith('lan:') && row.author.endsWith(':alice')));

    // 远端追加消息（重复提交去重），主持本人的对话里出现并标注远端名字
    const rows = [{ origin: `${remote.peerId}:7`, author: `lan:${remote.peerId}:bob`, authorName: '鲍勃', role: 'user', content: '来自另一台电脑', events: [] }];
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/append`, { rows }, peerHeaders)).body.accepted, 1);
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/append`, { rows }, peerHeaders)).body.accepted, 0);
    await call('POST', `/api/shared-conversations/session/${sessionId}/sync`);
    const messages = await runWithTenant('alice', () => chat.listMessages(sessionId, { owner: 'alice' }));
    assert.equal(messages.length, 3);
    assert.equal(messages[2].content, '来自另一台电脑');
    assert.equal(shared.authorOf(messages[2].events).name, '鲍勃');
    // 再拉取时远端自己的消息仍带原 origin，远端据此跳过
    const again = await call('GET', `/api/lan-peer/${shareId}/log?after=${log.body.last}`, undefined, peerHeaders);
    assert.equal(again.body.rows[0].origin, `${remote.peerId}:7`);

    // 成员条：远端成员显示名字
    const detail = await call('GET', `/api/shared-conversations/session/${sessionId}`);
    assert.ok(detail.body.share.members.some(member => member.username === `lan:${remote.peerId}` && member.name === '鲍勃'));

    // 发起者移除远端成员：令牌轮换，远端再请求被拒
    await call('POST', `/api/shared-conversations/session/${sessionId}/remove`, { username: `lan:${remote.peerId}` });
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/heartbeat`, {}, peerHeaders)).body.code, 'LAN_REMOVED');
    const rotated = await call('GET', `/api/lan-share/session/${sessionId}`);
    assert.notEqual(lanShare.parseLink(rotated.body.lan.link).token, token);
    assert.equal((await call('POST', `/api/lan-peer/${shareId}/join`, { ...remote, token: lanShare.parseLink(rotated.body.lan.link).token })).body.code, 'LAN_REMOVED');
});

test('peer endpoints are disabled outside the desktop runtime', async t => {
    const previous = process.env.LAN_SHARE;
    process.env.LAN_SHARE = '0';
    t.after(() => { process.env.LAN_SHARE = previous; });
    const app = express();
    app.use('/api/lan-peer', require('../backend/routes/lan-peer').api);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/lan-peer/shr_x1234/state`);
    assert.equal(res.status, 404);
    assert.equal((await lanShare.availability()).available, false);
});
