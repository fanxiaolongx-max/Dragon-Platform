const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-workspace-route-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const express = require('../backend/node_modules/express');
const router = require('../backend/routes/agent-workspace');
const manager = require('../backend/models/agent-run-manager');
const prefsRepo = require('../backend/models/agent-workspace-repository');
const transcriptRepo = require('../backend/models/agent-transcript-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');

const projects = path.join(sandbox, 'projects');
fs.mkdirSync(path.join(projects, 'alpha', '.git'), { recursive: true });
fs.writeFileSync(path.join(projects, 'alpha', '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.mkdirSync(path.join(projects, 'alps'), { recursive: true });
fs.mkdirSync(path.join(projects, 'beta'), { recursive: true });
fs.mkdirSync(path.join(projects, '.hidden'), { recursive: true });
fs.writeFileSync(path.join(projects, 'notes.txt'), 'file, not dir');

let server;
let base;
test.before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const role = req.headers['x-test-role'];
        if (role) req.user = { username: req.headers['x-test-user'] || 'viewer', role };
        Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: req.headers['x-test-remote'] ? '192.0.2.1' : '127.0.0.1' });
        runWithTenant('default', () => next());
    });
    app.use(router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    server?.close();
    await tenantPool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const call = (method, url, { body, headers = {} } = {}) => fetch(`${base}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
});
const viewerLocal = { 'x-test-role': 'viewer' };
const viewerRemote = { 'x-test-role': 'viewer', 'x-test-remote': '1' };
const adminRemote = { 'x-test-role': 'admin', 'x-test-user': 'admin', 'x-test-remote': '1' };
// 同一个本机用户名、管理员角色：写操作（撤销、创建 PR、写文件）只对管理员开放
const ownerAdmin = { 'x-test-role': 'admin', 'x-test-user': 'viewer' };

test('gate: loopback viewers and remote admins pass, remote viewers and anonymous do not', async () => {
    assert.equal((await call('GET', '/prefs')).status, 401);
    assert.equal((await call('GET', '/prefs', { headers: viewerRemote })).status, 403);
    assert.equal((await call('GET', '/prefs', { headers: viewerLocal })).status, 200);
    assert.equal((await call('GET', '/prefs', { headers: adminRemote })).status, 200);
    assert.equal((await call('GET', '/prefs', { headers: { ...viewerLocal, origin: 'https://evil.example' } })).status, 403);

    const disabled = await (await call('GET', '/capability', { headers: viewerRemote })).json();
    assert.deepEqual([disabled.enabled, disabled.reason], [false, 'REMOTE_VIEWER']);
    const enabled = await (await call('GET', '/capability', { headers: viewerLocal })).json();
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.homeDir, os.homedir());

    process.env.TOOLS_AGENT_WORKSPACE = 'admin-only';
    try {
        assert.equal((await call('GET', '/prefs', { headers: viewerLocal })).status, 403);
        assert.equal((await call('GET', '/prefs', { headers: adminRemote })).status, 200);
    } finally {
        delete process.env.TOOLS_AGENT_WORKSPACE;
    }
});

test('suggest splits input into parent + prefix and lists directories only', async () => {
    const partial = await (await call('GET', `/suggest?input=${encodeURIComponent(path.join(projects, 'al'))}`, { headers: viewerLocal })).json();
    assert.equal(partial.parent, projects);
    assert.equal(partial.prefix, 'al');
    assert.equal(partial.exists, false);
    assert.deepEqual(partial.groups[0].entries.map(item => item.name), ['alpha', 'alps']);
    assert.equal(partial.groups[0].entries[0].isGit, true);

    const full = await (await call('GET', `/suggest?input=${encodeURIComponent(projects + path.sep)}`, { headers: viewerLocal })).json();
    assert.equal(full.parent, projects);
    assert.equal(full.prefix, '');
    assert.deepEqual(full.groups[0].entries.map(item => item.name), ['alpha', 'alps', 'beta'], 'files and hidden dirs are skipped');

    const hidden = await (await call('GET', `/suggest?input=${encodeURIComponent(projects + path.sep)}&showHidden=true`, { headers: viewerLocal })).json();
    assert.ok(hidden.groups[0].entries.some(item => item.name === '.hidden'));

    const exact = await (await call('GET', `/suggest?input=${encodeURIComponent(path.join(projects, 'alpha'))}`, { headers: viewerLocal })).json();
    assert.equal(exact.exists, true);
    assert.equal(exact.isDir, true);
    assert.equal(exact.isGit, true);

    const missingParent = await (await call('GET', `/suggest?input=${encodeURIComponent(path.join(sandbox, 'nope', 'x'))}`, { headers: viewerLocal })).json();
    assert.deepEqual(missingParent.groups[0].entries, []);
    assert.equal(missingParent.error, 'ENOENT');

    const empty = await (await call('GET', '/suggest?input=', { headers: viewerLocal })).json();
    assert.deepEqual(empty.groups.map(group => group.label), ['home', 'root']);
    assert.equal(empty.parent, os.homedir());

    const tilde = await (await call('GET', `/suggest?input=${encodeURIComponent('~/')}`, { headers: viewerLocal })).json();
    assert.equal(tilde.parent, os.homedir());
});

test('pr endpoints need a live session and report preflight reasons', async () => {
    const none = await (await call('GET', '/pr/missing-session-id/preflight', { headers: viewerLocal })).json();
    assert.deepEqual([none.ok, none.reason], [false, 'NO_SESSION']);
    assert.equal((await call('POST', '/pr/missing-session-id', { headers: ownerAdmin, body: { title: 'x' } })).status, 404);

    const user = { username: 'viewer', role: 'admin' };
    const session = manager.ensureSession({ agentSessionId: 'route-pr-session-1', user, tenantId: 'default', root: path.join(projects, 'beta'), permissionMode: 'ask' });
    const notGit = await (await call('GET', `/pr/${session.id}/preflight`, { headers: viewerLocal })).json();
    assert.equal(notGit.ok, false);
    assert.ok(['NOT_GIT', 'NO_GIT'].includes(notGit.reason), notGit.reason);
    const blocked = await call('POST', `/pr/${session.id}`, { headers: ownerAdmin, body: { title: 'x' } });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).code, /^AGENT_PR_/);
    assert.equal((await call('GET', `/pr/${session.id}/preflight`, { headers: adminRemote })).status, 403, 'other users cannot touch the session');
});

test('select validates the directory, remembers it per user and prefs round-trip', async () => {
    const bad = await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'notes.txt') } });
    assert.equal(bad.status, 400);
    const missing = await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'zzz') } });
    assert.equal(missing.status, 400);

    const ok = await (await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'alpha') } })).json();
    assert.equal(ok.root, fs.realpathSync(path.join(projects, 'alpha')));
    assert.equal(ok.gitBranch, 'main');
    assert.equal(ok.name, 'alpha');
    await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'beta') } });
    const prefs = await (await call('GET', '/prefs', { headers: viewerLocal })).json();
    assert.equal(prefs.lastDirectory, fs.realpathSync(path.join(projects, 'beta')));
    assert.deepEqual(prefs.recentDirectories.map(item => path.basename(item)), ['beta', 'alpha']);
    assert.equal(prefs.permissionMode, 'ask');

    const updated = await (await call('PUT', '/prefs', { headers: viewerLocal, body: { permissionMode: 'auto' } })).json();
    assert.equal(updated.permissionMode, 'auto');
    const invalid = await (await call('PUT', '/prefs', { headers: viewerLocal, body: { permissionMode: 'god' } })).json();
    assert.equal(invalid.permissionMode, 'ask');

    const otherUser = await (await call('GET', '/prefs', { headers: adminRemote })).json();
    assert.equal(otherUser.lastDirectory, '', 'prefs are per user');

    const forgotten = await (await call('POST', '/forget', { headers: viewerLocal, body: { path: prefs.lastDirectory } })).json();
    assert.equal(forgotten.lastDirectory, '');
    assert.deepEqual(forgotten.recentDirectories.map(item => path.basename(item)), ['alpha']);
    assert.deepEqual(await runWithTenant('default', () => prefsRepo.getPrefs('viewer')), forgotten);
});

test('approvals and changes endpoints check existence and ownership', async () => {
    assert.equal((await call('POST', '/approvals/nope', { headers: viewerLocal, body: { decision: 'allow' } })).status, 403);
    assert.equal((await call('POST', '/approvals/nope', { headers: ownerAdmin, body: { decision: 'allow' } })).status, 404);

    const sessionId = 'route-session-0001';
    const user = { username: 'viewer', role: 'admin' };
    const session = manager.ensureSession({ agentSessionId: sessionId, user, tenantId: 'default', root: path.join(projects, 'alpha'), permissionMode: 'ask' });
    const events = [];
    const controller = new AbortController();
    const client = { model: 'm', generateText: async () => ({ text: '', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'a.txt', content: 'hello\n' } }], usage: {} }) };
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'x' }], write: event => events.push(event), signal: controller.signal });
    const approval = await waitFor(() => events.find(event => event.type === 'approval'));

    assert.equal((await call('POST', `/approvals/${approval.id}`, { headers: adminRemote, body: { decision: 'allow' } })).status, 403, 'another user cannot approve');
    assert.equal((await call('POST', `/approvals/${approval.id}`, { headers: viewerLocal, body: { decision: 'allow' } })).status, 403, 'a demoted owner cannot approve an old admin request');
    const allowed = await call('POST', `/approvals/${approval.id}`, { headers: ownerAdmin, body: { decision: 'allow' } });
    assert.equal(allowed.status, 200);
    // 第二次 generateText 返回文本结束循环
    client.generateText = async () => ({ text: 'done', toolCalls: [], usage: {} });
    await turn;

    const changes = await (await call('GET', `/changes/${sessionId}`, { headers: viewerLocal })).json();
    assert.deepEqual(changes.changes.map(item => [item.path, item.kind]), [['a.txt', 'create']]);
    const diff = await (await call('GET', `/changes/${sessionId}?path=a.txt`, { headers: viewerLocal })).json();
    assert.match(diff.diff.text, /\+hello/);
    assert.equal((await call('GET', `/changes/${sessionId}`, { headers: adminRemote })).status, 403);
    assert.equal((await call('GET', `/changes/${sessionId}?path=missing.txt`, { headers: viewerLocal })).status, 404);

    const reverted = await (await call('POST', `/changes/${sessionId}/revert`, { headers: ownerAdmin, body: { path: 'a.txt' } })).json();
    assert.deepEqual(reverted.changes, []);
    assert.equal(fs.existsSync(path.join(projects, 'alpha', 'a.txt')), false);
    assert.equal((await call('POST', '/changes/unknown-session-id/revert', { headers: ownerAdmin, body: { path: 'a.txt' } })).status, 404);
});

test('complete transcript API is paged and checks the current tenant and account', async () => {
    const root = fs.realpathSync(path.join(projects, 'alpha'));
    await runWithTenant('default', () => transcriptRepo.saveTurn({ runId: 'api-archive', agentSessionId: 'api-archive-session', owner: 'default::viewer', root,
        transcript: [{ role: 'user', content: 'private request' }, { role: 'model', content: 'private answer' }], status: 'completed' }));
    const query = `?root=${encodeURIComponent(root)}&limit=1`;
    const mine = await call('GET', `/transcripts/api-archive-session${query}`, { headers: viewerLocal });
    assert.equal(mine.status, 200);
    assert.equal((await mine.json()).items[0].transcript[0].content, 'private request');
    assert.equal((await call('GET', `/transcripts/api-archive-session${query}`, { headers: adminRemote })).status, 403);
    assert.deepEqual((await (await call('GET', `/transcripts/api-archive-session${query}&offset=1`, { headers: viewerLocal })).json()).items, []);
});

test('select returns the latest agentSessionId per owner and root so a fresh tab resumes the transcript', async () => {
    const alpha = fs.realpathSync(path.join(projects, 'alpha'));
    const beta = fs.realpathSync(path.join(projects, 'beta'));
    const earlier = [
        { role: 'user', content: 'list it' },
        { role: 'model', content: '', toolCalls: [{ id: 't1', name: 'list_directory', args: { path: '.' } }] },
        { role: 'tool', toolResults: [{ id: 't1', name: 'list_directory', content: 'a.txt' }] },
        { role: 'model', content: 'listed' }
    ];
    await runWithTenant('default', async () => {
        await transcriptRepo.save({ agentSessionId: 'resume-old-0001', owner: 'default::viewer', root: alpha, transcript: earlier, turnCount: 1 });
        await transcriptRepo.save({ agentSessionId: 'resume-new-0002', owner: 'default::viewer', root: alpha, transcript: earlier, turnCount: 2 });
        await transcriptRepo.save({ agentSessionId: 'resume-beta-0003', owner: 'default::viewer', root: beta, transcript: earlier, turnCount: 1 });
        await transcriptRepo.save({ agentSessionId: 'resume-admin-0004', owner: 'default::admin', root: alpha, transcript: earlier, turnCount: 1 });
        await transcriptRepo.save({ agentSessionId: 'resume-empty-0005', owner: 'default::viewer', root: alpha, transcript: [], turnCount: 0 });
    });

    const viewerAlpha = await (await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'alpha') } })).json();
    assert.equal(viewerAlpha.agentSessionId, 'resume-new-0002', 'newest non-empty transcript wins');
    const viewerBeta = await (await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'beta') } })).json();
    assert.equal(viewerBeta.agentSessionId, 'resume-beta-0003', 'scoped by root');
    const adminAlpha = await (await call('POST', '/select', { headers: adminRemote, body: { path: path.join(projects, 'alpha') } })).json();
    assert.equal(adminAlpha.agentSessionId, 'resume-admin-0004', 'scoped by owner');
    const none = await (await call('POST', '/select', { headers: viewerLocal, body: { path: path.join(projects, 'alps') } })).json();
    assert.equal(none.agentSessionId, '');

    // 模拟重启后的新标签页：内存里没有该会话，沿用 /select 给的 id，模型应收到上次的工具消息
    const user = { username: 'viewer', role: 'viewer' };
    const session = manager.ensureSession({ agentSessionId: viewerAlpha.agentSessionId, user, tenantId: 'default', root: viewerAlpha.root, permissionMode: 'ask' });
    await runWithTenant('default', () => manager.hydrateSession(session));
    let seen = null;
    const client = { model: 'm', generateText: async ({ messages }) => { seen = messages; return { text: 'ok', toolCalls: [], usage: {} }; } };
    await runWithTenant('default', () => manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'again' }], write: () => {}, signal: new AbortController().signal }));
    assert.equal(seen.filter(item => item.role === 'tool').length, 1);
    assert.ok(seen.some(item => (item.toolCalls || []).some(call => call.id === 't1')));
});

async function waitFor(check, timeoutMs = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('timed out waiting for condition');
}

test('state and changes work by root after a restart, with saved context and live git changes', async () => {
    const { execFileSync } = require('node:child_process');
    const gamma = path.join(projects, 'gamma');
    fs.mkdirSync(gamma, { recursive: true });
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    execFileSync('git', ['init', '-q'], { cwd: gamma, env });
    fs.writeFileSync(path.join(gamma, 'README.md'), 'Hello\n');
    execFileSync('git', ['add', '-A'], { cwd: gamma, env });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: gamma, env });
    fs.writeFileSync(path.join(gamma, 'README.md'), 'Hello by hand\n');
    const root = fs.realpathSync(gamma);
    const context = { usedTokens: 1500, windowTokens: 128000, parts: { messages: 100, directory: 50, system: 1000, tools: 350, free: 126500 }, source: 'provider' };
    await runWithTenant('default', () => transcriptRepo.save({ agentSessionId: 'state-gamma-0001', owner: 'default::viewer', root, transcript: [{ role: 'user', content: 'q' }, { role: 'model', content: 'a' }], turnCount: 3, context }));

    const state = await (await call('GET', `/state/state-gamma-0001?root=${encodeURIComponent(gamma)}`, { headers: viewerLocal })).json();
    assert.deepEqual(state.context, context, 'context of the last turn is restored');
    assert.equal(state.turnCount, 3);
    assert.equal(state.git, true);
    assert.deepEqual(state.changes.map(item => [item.path, item.source]), [['README.md', 'git']], 'a manual edit shows up without any agent session in memory');

    const other = await call('GET', `/state/state-gamma-0001?root=${encodeURIComponent(gamma)}`, { headers: adminRemote });
    assert.equal(other.status, 403, 'another user cannot open this session');

    const listed = await (await call('GET', `/changes/not-in-memory-0001?root=${encodeURIComponent(gamma)}`, { headers: viewerLocal })).json();
    assert.deepEqual(listed.changes.map(item => item.path), ['README.md']);
    const diff = await (await call('GET', `/changes/not-in-memory-0001?root=${encodeURIComponent(gamma)}&path=README.md`, { headers: viewerLocal })).json();
    assert.match(diff.diff.text, /^\+Hello by hand$/m);
    assert.equal((await call('GET', `/state/x-0001?root=${encodeURIComponent(path.join(projects, 'missing'))}`, { headers: viewerLocal })).status, 400);
    assert.deepEqual(await (await call('GET', '/changes/not-in-memory-0001', { headers: viewerLocal })).json(), { changes: [], diff: null, git: false });
});

test('read-only accounts see readOnly capability and cannot revert or create PRs', async () => {
    const viewerCap = await (await call('GET', '/capability', { headers: viewerLocal })).json();
    assert.equal(viewerCap.readOnly, true);
    const adminCap = await (await call('GET', '/capability', { headers: adminRemote })).json();
    assert.equal(adminCap.readOnly, false);
    const revert = await call('POST', '/changes/any-session-0001/revert', { headers: viewerLocal, body: { path: 'a.txt' } });
    assert.equal(revert.status, 403);
    assert.equal((await revert.json()).code, 'AGENT_READ_ONLY');
    assert.equal((await call('POST', '/pr/any-session-0001', { headers: viewerLocal, body: { title: 't' } })).status, 403);
});
