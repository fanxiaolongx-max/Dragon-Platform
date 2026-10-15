const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-claw-chat-owner-route-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const express = require('../backend/node_modules/express');
const auth = require('../backend/middleware/auth');
const { tenantMiddleware } = require('../backend/models/tenant-context');
const authSessions = require('../backend/models/auth-sessions-repository');
const chat = require('../backend/models/ai-chat-repository');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const router = require('../backend/routes/ai');
const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const platformDb = require('../backend/models/platform-db');

test('real chat endpoints isolate histories and reject foreign session IDs before calling a model', async t => {
    const originalSettings = settings.getRuntimeSettings;
    const originalSecrets = settings.getRedactionSecrets;
    const originalClient = provider.createClient;
    let modelCalls = 0;
    settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true });
    settings.getRedactionSecrets = async () => [];
    provider.createClient = () => { modelCalls++; throw new Error('this test must never contact a model'); };
    const app = express();
    app.use(express.json());
    app.use('/api', auth.checkAuth, tenantMiddleware);
    // 使用 server.js 的真实上游权限中间件，防止只测试 router 而漏掉普通账号聊天入口。
    const serverSource = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
    const begin = serverSource.indexOf("app.use('/api', (req, res, next) => {");
    const end = serverSource.indexOf('\n});', begin) + 4;
    vm.runInNewContext(serverSource.slice(begin, end), { app, requireAdmin: auth.requireAdmin });
    app.use('/api/ai', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        settings.getRuntimeSettings = originalSettings;
        settings.getRedactionSecrets = originalSecrets;
        provider.createClient = originalClient;
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await pool.closeAll();
        await appDb.closeDatabase();
        await platformDb.closeDatabase();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    for (const user of ['alice', 'bob']) await authSessions.saveSession(`synthetic-${user}`, user, 'viewer', Date.now() + 60000, 'default');
    const id = await chat.addMessage({ owner: 'alice', pagePath: '/', role: 'user', content: 'Alice private text' });
    const url = `http://127.0.0.1:${server.address().port}/api/ai`;
    const headers = { Authorization: 'Bearer synthetic-bob', 'Content-Type': 'application/json' };
    const mine = await (await fetch(`${url}/sessions?pagePath=%2F`, { headers })).json();
    assert.deepEqual(mine.items, []);
    const archive = await (await fetch(`${url}/sessions-archive`, { headers })).json();
    assert.equal(archive.total, 0);
    const foreign = await fetch(`${url}/sessions/${id}/messages`, { headers });
    assert.equal(foreign.status, 403);
    assert.equal(JSON.stringify(await foreign.json()).includes('Alice private text'), false);
    const append = await fetch(`${url}/chat`, { method: 'POST', headers, body: JSON.stringify({ sessionId: id, pagePath: '/', messages: [{ role: 'user', content: 'intrusion' }] }) });
    assert.equal(append.status, 403);
    assert.equal((await append.json()).code, 'AI_SESSION_FORBIDDEN');
    assert.equal(modelCalls, 0);
    assert.equal((await chat.listMessages(id, { owner: 'alice' })).length, 1);
    const own = await fetch(`${url}/sessions/${id}/messages`, { headers: { Authorization: 'Bearer synthetic-alice' } });
    assert.equal(own.status, 200);
    assert.equal((await own.json()).items[0].content, 'Alice private text');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(sandbox, 'workspace-')));
    fs.writeFileSync(path.join(root, 'readme.txt'), 'workspace content');
    let turnCalls = 0;
    provider.createClient = () => ({ model: 'mock', generateText: async () => ++turnCalls === 1
        ? { toolCalls: [{ id: 'read-one', name: 'read_file', args: { path: 'readme.txt' } }] }
        : { text: 'Read completed', toolCalls: [] } });
    const completed = await fetch(`${url}/chat`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer synthetic-alice' }, body: JSON.stringify({
        agent: 'dragon-claw-home', stream: true, pagePath: '/', messages: [{ role: 'user', content: 'read the file' }],
        workspace: { root, agentSessionId: 'http-recovery-agent', permissionMode: 'full' }
    }) });
    assert.equal(completed.status, 200);
    const events = (await completed.text()).trim().split('\n').map(line => JSON.parse(line));
    const done = events.find(event => event.type === 'done');
    assert.ok(done, JSON.stringify(events));
    assert.equal(turnCalls, 2);
    const messages = await chat.listMessages(done.sessionId, { owner: 'alice' });
    assert.equal(messages.length, 2, 'checkpoints and the final route response update one pair of messages');
    assert.match(messages[1].content, /Read completed/);
    assert.equal(messages[1].events.some(event => event.type === 'tool_result'), true);
    assert.equal((await chat.listMessages(done.sessionId, { owner: 'alice' })).length, 2);
});
