const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-tac-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const repo = require('../backend/models/dragon-tac/repository');
const agents = require('../backend/models/dragon-tac/executors');
const browser = require('../backend/models/dragon-tac/browser');
const commands = require('../backend/models/dragon-tac/commands');
const service = require('../backend/models/dragon-tac/service');
const bridge = require('../backend/models/channels/dragon-claw-channel-bridge');
const originalCaps = agents.capabilities;
const originalReadiness = agents.readiness;
const originalSchedule = service.schedule;
const scheduled = [];
const cap = () => ({ browser: true, agents: [{ id: 'codex', name: 'Codex', available: true }, { id: 'claude', name: 'Claude Code', available: true }] });
agents.capabilities = cap;
agents.readiness = async () => agents.capabilities();
service.schedule = id => scheduled.push(id);
const inTenant = fn => runWithTenant('default', fn);
const ctx = actor => ({ channel: 'weixin', conversation: { kind: 'user', id: actor }, actor });
const page = { url: 'https://example.com/', title: 'Example Domain', text: 'Example Domain is a domain for documentation. api_key=not-for-the-model-secret', mode: 'chromium-rendered' };
async function make(actor) { const c = ctx(actor); const job = await service.propose(c, '打开 https://example.com 分析内容'); return { c, job }; }
async function turn(c, text) { const events = []; await bridge.runTurn({ channel: c.channel, conversation: c.conversation, account: c.actor, text, onEvent: e => events.push(e) }); return events; }
test.after(async () => {
    agents.capabilities = originalCaps; agents.readiness = originalReadiness; service.schedule = originalSchedule;
    await db.closeDatabase(); await pool.closeAll(); await require('../backend/models/platform-db').closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('only explicit webpage requests and confirmation commands enter DragonTAC', () => {
    assert.equal(commands.intent('@工具平台 打开 https://example.com 并分析内容').action, 'propose');
    assert.equal(commands.intent('@埃及CS工具平台打开 https://example.com 并分析内容').action, 'propose');
    for (const text of ['好', '你好', '解释如何打开 https://example.com', '> 打开 https://example.com\n解释这句话', '每天9点打开 https://example.com']) assert.equal(commands.intent(text), null, text);
    assert.equal(commands.intent('确认升级 tac_0123456789abcdef').action, 'approve');
});

test('real channel bridge asks first, binds consent to original actor and conversation, and schedules only once', async () => inTenant(async () => {
    const c = { ...ctx('consent-owner'), channel: 'welink', conversation: { kind: 'group', id: 'group-a' } };
    const initial = await turn(c, '打开 https://example.com 并分析页面');
    const proposal = initial.find(e => e.type === 'tac');
    assert.ok(proposal);
    assert.match(initial.find(e => e.type === 'done').reply, /是否上升到 DragonTAC/);
    assert.equal((await repo.getJob(proposal.id)).status, 'awaiting_approval');
    assert.equal(scheduled.length, 0);
    const intruder = await turn({ ...c, actor: 'another-member' }, `确认升级 ${proposal.id}`);
    assert.match(intruder.find(e => e.type === 'done').reply, /不是当前会话中由你发起/);
    assert.equal((await repo.getJob(proposal.id)).status, 'awaiting_approval');
    const accepted = await turn(c, `确认升级 ${proposal.id}`);
    assert.equal(accepted.find(e => e.type === 'tac').status, 'queued');
    await turn(c, `确认升级 ${proposal.id}`);
    assert.deepEqual(scheduled, [proposal.id]);
    await assert.rejects(service.approve(proposal.id, { ...c, conversation: { kind: 'group', id: 'other' } }), /不是当前会话/);
    await service.cancel(proposal.id, c);
}));

test('approved task reads once, runs frozen members in sequence, redacts inputs and sends only to the original conversation', async () => inTenant(async () => {
    const { c, job } = await make('execution');
    await service.approve(job.id, c);
    let reads = 0; const calls = [], pushed = [];
    agents.capabilities = () => ({ ...cap(), agents: [...cap().agents, { id: 'antigravity', name: 'Antigravity', available: true }] });
    const result = await service.execute(job.id, {
        readPage: async () => { reads++; return page; },
        runAgent: async (id, prompt) => { calls.push(id); assert.doesNotMatch(prompt, /not-for-the-model-secret/); if (id === 'claude') assert.match(prompt, /codex grounded result/); return `${id} grounded result`; },
        push: async input => { pushed.push(input); return { sent: 1 }; }
    });
    agents.capabilities = cap;
    assert.equal(result.status, 'done');
    assert.equal(reads, 1); assert.deepEqual(calls, ['codex', 'claude']);
    assert.equal(pushed.length, 1); assert.deepEqual(pushed[0].targets, [{ kind: 'user', id: 'execution' }]);
    assert.equal(pushed[0].channel, 'weixin'); assert.match(pushed[0].text, /官方 CLI/);
    assert.deepEqual(await service.execute(job.id), { skipped: true });
}));

test('cancellation aborts a running read, prevents delivery, and interrupted recovery does not replay approved work', async () => inTenant(async () => {
    const { c, job } = await make('cancel-running'); await service.approve(job.id, c);
    let ready; const started = new Promise(resolve => ready = resolve); let sent = 0;
    const running = service.execute(job.id, { readPage: (_url, { signal }) => new Promise((_, reject) => { ready(); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }), push: async () => { sent++; return { sent: 1 }; } });
    await started; await service.cancel(job.id, c); await running;
    assert.equal((await repo.getJob(job.id)).status, 'cancelled'); assert.equal(sent, 0);
    const next = await make('restart'); await service.approve(next.job.id, next.c);
    await service.recover(); assert.equal((await repo.getJob(next.job.id)).status, 'queued', 'fresh work is not mistaken for old work');
    await db.run('UPDATE dragon_tac_jobs SET updated_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', next.job.id]);
    await service.recover(); assert.equal((await repo.getJob(next.job.id)).status, 'failed');
    assert.match((await repo.getJob(next.job.id)).error, /重启/);
}));

test('partial agent failures and delivery failures remain visible; no fake multi-agent success', async () => inTenant(async () => {
    const { c, job } = await make('partial'); await service.approve(job.id, c);
    await service.execute(job.id, { readPage: async () => page, runAgent: async id => { if (id === 'claude') throw new Error('not authenticated'); return 'grounded answer'; }, push: async () => ({ sent: 0, results: [{ error: 'offline' }] }) });
    const saved = await repo.getJob(job.id);
    assert.equal(saved.status, 'done'); assert.equal(saved.reports[1].status, 'failed'); assert.match(saved.result, /部分成员未完成/); assert.equal(saved.deliveryError, 'offline');
    const other = await make('all-fail'); await service.approve(other.job.id, other.c);
    await service.execute(other.job.id, { readPage: async () => page, runAgent: async () => { throw new Error('login required'); }, push: async () => ({ sent: 1 }) });
    assert.equal((await repo.getJob(other.job.id)).status, 'failed');
}));

test('tenant, actor, thread and expiry boundaries are enforced', async () => inTenant(async () => {
    const { c, job } = await make('isolation');
    assert.equal(await runWithTenant('other', () => repo.getJob(job.id)), null);
    assert.deepEqual(await repo.list({ channel: 'welink', kind: 'user', id: c.actor }), []);
    await db.run('UPDATE dragon_tac_jobs SET created_at = ? WHERE id = ?', ['2000-01-01T00:00:00.000Z', job.id]);
    await assert.rejects(service.approve(job.id, c), /过期/);
    assert.equal((await repo.getJob(job.id)).status, 'expired');
    for (let i = 0; i < 3; i++) await make('limited');
    await assert.rejects(make('limited'), /已有 3 项/);
}));

test('browser accepts only credential-free public URLs; CLI parsers reject reported failures', async () => {
    for (const url of ['file:///etc/passwd', 'https://u:p@example.com/', 'https://example.com/?access_token=secret']) assert.throws(() => browser.normalizeUrl(url));
    for (const url of ['http://127.0.0.1', 'http://[::1]', 'http://10.0.0.1', 'http://169.254.169.254', 'http://localhost', 'http://host.internal']) await assert.rejects(browser.assertPublic(url));
    assert.equal(browser.normalizeUrl('https://example.com/#part'), 'https://example.com/');
    assert.throws(() => agents.parseOutput('codex', '{"type":"turn.failed"}'), /失败/);
    assert.throws(() => agents.parseOutput('claude', '{"is_error":true}'), /失败/);
    assert.ok(agents.argsFor('codex').includes('read-only'));
    assert.deepEqual(agents.argsFor('claude').slice(2, 4), ['--tools', '']);
});

test('HUD MCP discovery distinguishes layout tools from actual task dispatch', async () => {
    const file = path.join(sandbox, 'fake-hud');
    fs.writeFileSync(file, `#!${process.execPath}\nconst rl=require('readline').createInterface({input:process.stdin});rl.on('line',line=>{const x=JSON.parse(line);if(x.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}}}}));if(x.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'get_hud'},{name:'draft_hud'}]}}));});\n`);
    fs.chmodSync(file, 0o755);
    const before = process.env.TOOLS_DRAGON_TAC_HUD; process.env.TOOLS_DRAGON_TAC_HUD = file;
    try { const result = await require('../backend/models/dragon-tac/hud').inspect(); assert.equal(result.connected, true); assert.equal(result.dispatch, false); assert.deepEqual(result.tools, ['get_hud', 'draft_hud']); }
    finally { if (before === undefined) delete process.env.TOOLS_DRAGON_TAC_HUD; else process.env.TOOLS_DRAGON_TAC_HUD = before; }
});

test('channel task API is tenant-scoped and capability diagnostics require admin', async t => {
    const express = require('../backend/node_modules/express'); const auth = require('../backend/middleware/auth');
    const app = express(); app.use(express.json()); app.use('/api', auth.checkAuth, tenantMiddleware);
    app.use('/api/channels', require('../backend/routes/channels')); app.use('/api/dragon-tac', require('../backend/routes/dragon-tac'));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const sessions = require('../backend/models/auth-sessions-repository');
    for (const [id, role, tenant] of [['tac-user','user','default'],['tac-admin','admin','default'],['tac-other','admin','other']]) await sessions.saveSession(id, id, role, Date.now()+60000, tenant);
    const get = (route, token) => fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await get('dragon-tac/capabilities','tac-user')).status,403);
    assert.equal((await get('dragon-tac/capabilities','tac-admin')).status,200);
    const jobs = await (await get('channels/weixin/threads/user/execution/tac','tac-user')).json(); assert.ok(jobs.items.length);
    assert.deepEqual((await (await get('channels/weixin/threads/user/execution/tac','tac-other')).json()).items,[]);
});
