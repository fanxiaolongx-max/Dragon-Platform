const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
// unix socket 路径有 104 字节上限：用短临时目录
const root = fs.mkdtempSync('/tmp/cxd-');
process.env.CODEX_HOME = root;
const { WebSocketServer } = require('../backend/node_modules/ws');
const daemon = require('../backend/models/desktop-agents/codex-daemon');
const ipc = require('../backend/models/desktop-agents/codex-ipc');
const ID = '11111111-1111-4111-8111-111111111111';
let server, calls = [], thread = { type: 'idle' }, turn = { id: 't1', status: 'completed' };
test.before(async () => {
    fs.mkdirSync(path.dirname(daemon.socketPath()), { recursive: true });
    server = http.createServer();
    const wss = new WebSocketServer({ server, path: '/rpc' });
    wss.on('connection', ws => ws.on('message', raw => {
        const m = JSON.parse(raw);
        if (m.id == null) return;
        calls.push(m);
        const reply = result => ws.send(JSON.stringify({ id: m.id, result }));
        // 服务端主动请求（审批）不能被当成响应
        if (m.method === 'turn/start') ws.send(JSON.stringify({ id: m.id, method: 'item/commandExecution/requestApproval', params: {} }));
        if (m.method === 'initialize') return reply({ userAgent: 'test' });
        if (m.method === 'thread/read') return reply({ thread: { id: ID, status: thread } });
        if (m.method === 'thread/resume') return m.params.threadId === ID ? reply({ thread: { id: ID, status: thread } }) : ws.send(JSON.stringify({ id: m.id, error: { code: -32600, message: 'thread not found' } }));
        if (m.method === 'thread/turns/list') return reply({ data: [turn], nextCursor: null });
        if (m.method === 'turn/start') return reply({ turn: { id: 'new-turn', status: 'inProgress' } });
        if (m.method === 'turn/steer') return reply({ turnId: m.params.expectedTurnId });
        reply({});
    }));
    await new Promise(r => server.listen(daemon.socketPath(), r));
});
test.after(async () => { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
test('daemon socket wins over the removed desktop IPC and reports status', async () => {
    assert.equal(daemon.exists(), true);
    assert.equal((await ipc.available()).mode, 'daemon');
    thread = { type: 'notLoaded' };
    assert.equal((await ipc.read(ID)).threadRuntimeStatus.type, 'idle');
    thread = { type: 'active', activeFlags: [] };
    assert.equal((await ipc.read(ID)).threadRuntimeStatus.type, 'active');
    thread = { type: 'idle' };
});
test('send resumes the thread, refuses a running turn and passes model + request id', async () => {
    turn = { id: 't1', status: 'inProgress' };
    calls = [];
    await assert.rejects(ipc.send(ID, 'busy', 'req-0'), e => e.code === 'DESKTOP_BUSY');
    assert.ok(!calls.some(c => c.method === 'turn/start'));
    turn = { id: 't1', status: 'completed' };
    calls = [];
    const answer = await ipc.send(ID, 'hello', 'req-1', 'gpt-x');
    assert.equal(answer.result.turn.id, 'new-turn');
    assert.deepEqual(calls.map(c => c.method), ['initialize', 'thread/resume', 'thread/turns/list', 'turn/start']);
    const start = calls.at(-1).params;
    assert.equal(start.clientUserMessageId, 'req-1');
    assert.equal(start.model, 'gpt-x');
    assert.equal(start.input[0].text, 'hello');
    await assert.rejects(ipc.send('22222222-2222-4222-8222-222222222222', 'x', 'req-2'), e => e.code === 'DESKTOP_UNAVAILABLE');
});
test('steer targets the active turn and refuses when the turn has ended', async () => {
    turn = { id: 't9', status: 'completed' };
    await assert.rejects(ipc.steer(ID, 'late', 'req-3'), e => e.code === 'DESKTOP_IDLE');
    turn = { id: 't9', status: 'inProgress' };
    calls = [];
    const answer = await ipc.steer(ID, 'nudge', 'req-4');
    assert.equal(answer.result.turnId, 't9');
    assert.equal(calls.at(-1).params.expectedTurnId, 't9');
});
