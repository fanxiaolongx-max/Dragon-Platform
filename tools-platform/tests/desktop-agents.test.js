const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-agents-'));
process.env.TOOLS_DATA_DIR = path.join(root, 'data');
process.env.TOOLS_DESKTOP_AGENT_HOME = path.join(root, 'home');
process.env.CODEX_HOME = path.join(root, 'home/.codex');
const db = require('../backend/models/app-db'), platform = require('../backend/models/platform-db'), pool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');
const catalog = require('../backend/models/desktop-agents/catalog'), repo = require('../backend/models/desktop-agents/repository'), service = require('../backend/models/desktop-agents/service'), ipc = require('../backend/models/desktop-agents/codex-ipc');
const sqlite3 = require('../backend/node_modules/sqlite3');
const express = require('../backend/node_modules/express'), request = require('supertest');
const ID = '11111111-1111-4111-8111-111111111111', CID = '22222222-2222-4222-8222-222222222222';
const transcript = path.join(process.env.CODEX_HOME, 'sessions/2026/10/26/rollout.jsonl');
const app = express();
app.use(express.json());
app.use((req, res, next) => { if (req.headers['x-user'])
    req.user = { username: req.headers['x-user'], role: req.headers['x-role'] || 'admin' }; runWithTenant(req.headers['x-tenant'] || 'default', next); });
app.use('/api/desktop-agents', require('../backend/routes/desktop-agents'));
function auth(verb, url, user = 'alice', tenant = 'default') { return request(httpServer)[verb]('/api/desktop-agents' + url).set('x-user', user).set('x-tenant', tenant); }
let server, httpServer, posts = 0, busy = false, steers = 0, startTask = false;
function frame(x) { const data = Buffer.from(JSON.stringify(x)), h = Buffer.alloc(4); h.writeUInt32LE(data.length); return Buffer.concat([h, data]); }
test.before(async () => {
    httpServer = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.mkdirSync(path.dirname(ipc.socketPath()), { recursive: true });
    fs.writeFileSync(transcript, [{ type: 'response_item', timestamp: '2026-10-26T09:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A real user question' }] } }, { type: 'response_item', payload: { type: 'function_call_output', output: 'private tool payload' } }, {type:'response_item',payload:{type:'message',role:'assistant',channel:'analysis',content:[{type:'output_text',text:'private analysis payload'}]}}, { type: 'response_item', timestamp: '2026-10-26T09:01:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'password="do-not-expose-this" Answer' }] } }].map(JSON.stringify).join('\n') + '\n');
    const native = new sqlite3.Database(path.join(process.env.CODEX_HOME, 'state_5.sqlite'));
    await new Promise((resolve, reject) => native.serialize(() => { native.run('CREATE TABLE threads(id TEXT,title TEXT,updated_at INTEGER,created_at INTEGER,rollout_path TEXT,cwd TEXT,source TEXT,archived INTEGER)'); native.run('INSERT INTO threads VALUES(?,?,?,?,?,?,?,0)', [ID, 'raw first prompt', 1793000000, 1793000000, transcript, root, 'vscode'], e => native.close(() => e ? reject(e) : resolve())); }));
    fs.writeFileSync(path.join(process.env.CODEX_HOME, 'session_index.jsonl'), JSON.stringify({ id: ID, thread_name: 'Native Codex title' }) + '\n');
    const metadata = path.join(process.env.TOOLS_DESKTOP_AGENT_HOME, 'Library/Application Support/Claude/claude-code-sessions/org/account');
    fs.mkdirSync(metadata, { recursive: true });
    fs.writeFileSync(path.join(metadata, 'local_' + CID + '.json'), JSON.stringify({ sessionId: 'local_' + CID, cliSessionId: CID, title: 'Native Claude title', lastActivityAt: 1793000000000, cwd: root }));
    const project = path.join(process.env.TOOLS_DESKTOP_AGENT_HOME, '.claude/projects/project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, CID + '.jsonl'), JSON.stringify({ uuid: 'm1', type: 'user', timestamp: '2026-10-26T09:00:00Z', message: { role: 'user', content: 'Claude desktop message' } }) + '\n');
    server = net.createServer(socket => {
        let buffer = Buffer.alloc(0);
        const send = x => { const bytes = frame(x); socket.write(bytes.subarray(0, 2)); setImmediate(() => { if (!socket.destroyed)
            socket.write(bytes.subarray(2)); }); };
        socket.on('error', () => { });
        socket.on('data', data => {
            buffer = Buffer.concat([buffer, data]);
            while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
                const n = buffer.readUInt32LE(0), m = JSON.parse(buffer.subarray(4, n + 4));
                buffer = buffer.subarray(n + 4);
                if (m.type === 'broadcast' && m.params?.following) {
                    send({ type: 'broadcast', method: 'thread-stream-state-changed', sourceClientId: 'desktop-owner', version: 11, params: { hostId: 'local', conversationId: m.params.conversationId, change: { type: 'snapshot', conversationState: { turns: [], threadRuntimeStatus: { type: busy ? 'active' : 'idle' } } } } });
                    continue;
                }
                if (m.type !== 'request')
                    continue;
                const response = { type: 'response', requestId: m.requestId, resultType: 'success', result: {} };
                if (m.method === 'initialize')
                    response.result = { clientId: 'dragon-test-client' };
                if (m.method === 'thread-owner-discovery')
                    response.handledByClientId = 'desktop-owner';
                if (m.method === 'thread-follower-start-turn') {
                    posts++;
                    assert.equal(m.version, 2);
                    assert.equal(m.params.conversationId, ID);
                    const text = m.params.turnStart.request.input[0].text;
                    fs.appendFileSync(transcript, JSON.stringify({ type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }) + '\n');
                    if (startTask)
                        fs.appendFileSync(transcript, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'task_started' } }) + '\n');
                    response.result = { result: { turn: { id: 'native-turn' } } };
                }
                if (m.method === 'thread-follower-steer-turn') {
                    steers++;
                    assert.equal(m.version, 1);
                    assert.equal(m.params.conversationId, ID);
                    assert.equal(m.params.restoreMessage.id, m.params.clientUserMessageId);
                    fs.appendFileSync(transcript, JSON.stringify({ type: 'response_item', timestamp: new Date().toISOString(), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: m.params.input[0].text }] } }) + '\n');
                    response.result = { result: { turnId: 'native-turn' } };
                }
                send(response);
            }
        });
    });
    await new Promise(resolve => server.listen(ipc.socketPath(), resolve));
});
test.after(async () => { await new Promise(resolve => httpServer.close(resolve)); await new Promise(resolve => server.close(resolve)); await db.closeDatabase(); await pool.closeAll(); await platform.closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); });
test('native catalogs retain exact titles, map Claude desktop IDs and expose only conversation text', async () => {
    const codex = await catalog.codex(20), claude = await catalog.claude(20);
    assert.equal(codex[0].title, 'Native Codex title');
    assert.equal(claude[0].id, 'local_' + CID);
    const history = await catalog.transcript(codex[0]);
    assert.equal(history.items.length, 2);
    assert.equal(history.items[0].content, 'A real user question');
    assert.doesNotMatch(JSON.stringify(history), /do-not-expose-this|private tool payload|private analysis payload/);
    assert.equal((await catalog.transcript(claude[0])).items[0].content, 'Claude desktop message');
    await assert.rejects(catalog.transcript({ ...codex[0], file: path.join(root, 'outside.jsonl') }));
});
test('desktop IPC handles framed messages and refuses a paginated active thread without starting a turn', async () => {
    const snapshot = await ipc.read(ID);
    assert.equal(snapshot.threadRuntimeStatus.type, 'idle');
    const before = posts;
    busy = true;
    await assert.rejects(ipc.send(ID, 'no interrupt', '33333333-3333-4333-8333-333333333333'), e => e.code === 'DESKTOP_BUSY');
    busy = false;
    assert.equal(posts, before);
});
test('connection needs an admin and explicit setup, and binds a host to one owner and tenant', async () => {
    await request(httpServer).get('/api/desktop-agents/settings').expect(403);
    await auth('get', '/settings').set('x-role', 'readonly').expect(403);
    await auth('get', '/sessions').expect(409);
    await auth('put', '/settings').send({ enabled: true, providers: { codex: true, claudecode: true, antigravity: false } }).expect(200);
    const list = (await auth('get', '/sessions').expect(200)).body;
    assert.equal(list.items.length, 2);
    assert.ok(list.items.every(x => !x.file && !x.cwd && !x.nativeId && !x.metadataFile));
    assert.equal(list.providers.find(p => p.id === 'claudecode').canSend, false);
    await auth('post', `/claudecode/sessions/local_${CID}/messages`).send({ text: 'Unsupported send', requestId: '99999999-9999-4999-8999-999999999999' }).expect(409);
    await auth('get', '/sessions', 'bob').expect(403);
    await auth('put', '/settings', 'alice', 'other').send({ enabled: true }).expect(403);
    assert.equal((await auth('get', '/settings', 'alice', 'other').expect(200)).body.owned, false);
    await auth('get', `/codex/sessions/${CID}/messages`).expect(404);
    await auth('get', '/unknown/sessions/not-a-session/messages').expect(400);
});
test('Web send reaches the same native desktop ID, requires a transcript receipt, and is idempotent', async () => {
    const id = '44444444-4444-4444-8444-444444444444', text = 'Native desktop roundtrip';
    const sent = (await auth('post', `/codex/sessions/${ID}/messages`).send({ text, requestId: id }).expect(202)).body;
    assert.equal(sent.status, 'accepted');
    assert.equal(posts, 1);
    await auth('post', `/codex/sessions/${ID}/messages`).send({ text, requestId: id }).expect(202);
    assert.equal(posts, 1);
    const messages = (await auth('get', `/codex/sessions/${ID}/messages`).expect(200)).body;
    assert.equal(messages.items.at(-1).content, text);
    await auth('post', `/codex/sessions/${ID}/messages`).send({ text: 'password="do-not-send-me"', requestId: '55555555-5555-4555-8555-555555555555' }).expect(400);
    assert.equal(posts, 1);
    await auth('post', `/codex/sessions/${ID}/messages`, 'bob').send({ text: 'not yours', requestId: '66666666-6666-4666-8666-666666666666' }).expect(403);
});
test('uncertain delivery is retained and a repeated request never silently resends', async () => {
    const original = ipc.send;
    let calls = 0;
    ipc.send = async () => { calls++; throw Object.assign(Error('confirmation missing'), { code: 'DESKTOP_TIMEOUT' }); };
    try {
        const body = { text: 'Uncertain desktop delivery', requestId: '77777777-7777-4777-8777-777777777777' };
        await auth('post', `/codex/sessions/${ID}/messages`).send(body).expect(504);
        const again = (await auth('post', `/codex/sessions/${ID}/messages`).send(body).expect(202)).body;
        assert.equal(again.status, 'unknown');
        assert.equal(calls, 1);
    }
    finally {
        ipc.send = original;
    }
});
const until = async (check, ms = 9000) => { const end = Date.now() + ms; while (Date.now() < end) {
    if (await check())
        return;
    await new Promise(r => setTimeout(r, 100));
} throw Error('Timed out waiting for queue'); };
const event = type => fs.appendFileSync(transcript, JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type } }) + '\n');
test('desktop wrappers are shown as the text the user typed and the running turn is detected', async () => {
    assert.equal(catalog.userText('<send_user_message_question_reply>\n[{"questionItemId":"q","question":"Which?","answer":"Use one chat"}]\n</send_user_message_question_reply>'), 'Use one chat');
    assert.equal(catalog.userText('# Files mentioned by the user:\n\n## a.png: /tmp/a.png\n\n## My request:\nWhy?\n\n<image name=[Image #1] path="/tmp/a.png">\n</image>'), 'Why?\n\n[图片 #1]');
    assert.equal(catalog.userText('<wake reason="mention">\n<message from="human">/schedule a &amp; b</message>\n</wake>'), '/schedule a & b');
    assert.equal(catalog.userText('<task-notification>x</task-notification>'), '');
    assert.equal(catalog.userText('plain text \n'), 'plain text \n');
    const [row] = await catalog.codex(20);
    event('task_started');
    assert.equal((await catalog.transcript(row)).busy, true);
    event('task_complete');
    assert.equal((await catalog.transcript(row)).busy, false);
});
test('a Claude turn stays running after end_turn until the stop hooks finish', async () => {
    const native = '55555555-5555-4555-8555-555555555555', file = path.join(process.env.TOOLS_DESKTOP_AGENT_HOME, '.claude/projects/project', native + '.jsonl');
    const row = { provider: 'claudecode', nativeId: native }, now = Date.now(), at = ms => new Date(now + ms).toISOString();
    const write = events => fs.writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const prompt = { type: 'user', timestamp: at(-5000), message: { role: 'user', content: 'Do it' } };
    const answer = (ms) => ({ type: 'assistant', timestamp: at(ms), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] } });
    try {
        write([prompt, answer(-1000)]);
        assert.equal((await catalog.transcript(row)).busy, true, 'hooks still running');
        write([prompt, answer(-1000), { type: 'system', subtype: 'stop_hook_summary', timestamp: at(-500) }]);
        assert.equal((await catalog.transcript(row)).busy, false);
        write([{ ...prompt, timestamp: at(-120000) }, answer(-90000)]);
        assert.equal((await catalog.transcript(row)).busy, false, 'sessions without hooks settle after a minute');
    }
    finally {
        fs.rmSync(file, { force: true });
    }
});
test('steer joins only a running Codex turn; other agents and idle turns are refused', async () => {
    await auth('post', `/antigravity/sessions/33333333-3333-4333-8333-333333333333/messages`).send({ text: 'steer', requestId: 'a1111111-1111-4111-8111-111111111111', mode: 'steer' }).expect(400);
    busy = true;
    try {
        await auth('post', `/codex/sessions/${ID}/messages`).send({ text: 'plain while busy', requestId: 'a2222222-2222-4222-8222-222222222222' }).expect(409);
        const sent = (await auth('post', `/codex/sessions/${ID}/messages`).send({ text: 'Steer the running turn', requestId: 'a3333333-3333-4333-8333-333333333333', mode: 'steer' }).expect(202)).body;
        assert.equal(sent.status, 'accepted');
        assert.equal(steers, 1);
    }
    finally {
        busy = false;
    }
    await auth('post', `/codex/sessions/${ID}/messages`).send({ text: 'steer idle', requestId: 'a4444444-4444-4444-8444-444444444444', mode: 'steer' }).expect(409);
    assert.equal(steers, 1);
});
test('queued messages wait for the running turn, go out one at a time and can be cancelled', async () => {
    const start = posts, path_ = `/codex/sessions/${ID}`;
    event('task_started');
    startTask = true;
    try {
        assert.equal((await auth('post', path_ + '/messages').send({ text: 'Queued first', requestId: 'b1111111-1111-4111-8111-111111111111', mode: 'queue' }).expect(202)).body.status, 'queued');
        await auth('post', path_ + '/messages').send({ text: 'Queued second', requestId: 'b2222222-2222-4222-8222-222222222222', mode: 'queue' }).expect(202);
        await auth('post', path_ + '/messages').send({ text: 'Queued third', requestId: 'b3333333-3333-4333-8333-333333333333', mode: 'queue' }).expect(202);
        await auth('delete', path_ + '/queue/b3333333-3333-4333-8333-333333333333').expect(200);
        assert.deepEqual((await auth('get', path_ + '/messages').expect(200)).body.queue.map(q => q.text), ['Queued first', 'Queued second']);
        await new Promise(r => setTimeout(r, 2500));
        assert.equal(posts, start, 'nothing is sent while the turn runs');
        event('task_complete');
        await until(() => posts === start + 1);
        await new Promise(r => setTimeout(r, 2500));
        assert.equal(posts, start + 1, 'the second waits for the turn the first one started');
        event('task_complete');
        await until(() => posts === start + 2);
        const body = (await auth('get', path_ + '/messages').expect(200)).body;
        assert.deepEqual(body.queue, []);
        assert.deepEqual(body.items.filter(m => m.role === 'user').slice(-2).map(m => m.content), ['Queued first', 'Queued second']);
    }
    finally {
        startTask = false;
        event('task_complete');
    }
});
test('Claude UI automation is opt-in, needs a transcript receipt and refuses same-titled sessions', async () => {
    const claude = require('../backend/models/desktop-agents/claude-desktop'), original = { status: claude.status, send: claude.send };
    const claudeFile = path.join(process.env.TOOLS_DESKTOP_AGENT_HOME, '.claude/projects/project', CID + '.jsonl');
    const sentTo = [];
    claude.status = async cfg => ({ canSend: Boolean(cfg.claudeAutomation), reason: cfg.claudeAutomation ? 'automation' : 'read-only' });
    claude.send = async (row, text) => { sentTo.push(row.title); fs.appendFileSync(claudeFile, JSON.stringify({ uuid: 'c' + sentTo.length, type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: text } }) + '\n'); };
    try {
        const url = `/claudecode/sessions/local_${CID}/messages`;
        await auth('post', '/sync').expect(200);
        await auth('post', url).send({ text: 'Before opt-in', requestId: 'c1111111-1111-4111-8111-111111111111' }).expect(409);
        await auth('put', '/settings').send({ claudeAutomation: true }).expect(200);
        assert.equal((await auth('get', url).expect(200)).body.canSend, true);
        assert.equal((await auth('post', url).send({ text: 'Hello from the Web', requestId: 'c2222222-2222-4222-8222-222222222222' }).expect(202)).body.status, 'accepted');
        assert.deepEqual(sentTo, ['Native Claude title']);
        assert.equal((await auth('get', url).expect(200)).body.items.at(-1).content, 'Hello from the Web');
        await auth('post', url).send({ text: 'Steer Claude', requestId: 'c3333333-3333-4333-8333-333333333333', mode: 'steer' }).expect(400);
        const twin = path.join(process.env.TOOLS_DESKTOP_AGENT_HOME, 'Library/Application Support/Claude/claude-code-sessions/org/account/local_33333333-3333-4333-8333-333333333333.json');
        fs.writeFileSync(twin, JSON.stringify({ sessionId: 'local_33333333-3333-4333-8333-333333333333', cliSessionId: '33333333-3333-4333-8333-333333333333', title: 'Native Claude title', lastActivityAt: 1792000000000 }));
        try {
            await auth('post', '/sync').expect(200);
            assert.match((await auth('post', url).send({ text: 'Ambiguous', requestId: 'c4444444-4444-4444-8444-444444444444' }).expect(409)).body.error, /同名会话/);
            assert.equal(sentTo.length, 1);
        }
        finally {
            fs.rmSync(twin);
            await auth('post', '/sync').expect(200);
        }
    }
    finally {
        Object.assign(claude, original);
        await auth('put', '/settings').send({ claudeAutomation: false }).expect(200);
    }
});
test('New chat creates a native session once and never retries an unconfirmed creation', async () => {
    const mod = require('../backend/models/desktop-agents/new-conversation'), original = mod.createAndSend, calls = [];
    mod.createAndSend = async (provider, text) => { calls.push([provider, text]); if (text === 'unsure') throw Object.assign(Error('未确认'), { code: 'DELIVERY_UNKNOWN' }); return { id: '66666666-6666-4666-8666-666666666666', status: 'accepted' }; };
    try {
        const body = { text: ' Start a new task ', requestId: 'd1111111-1111-4111-8111-111111111111' };
        const created = (await auth('post', '/codex/new').send(body).expect(202)).body;
        assert.equal(created.status, 'accepted');
        assert.equal(created.id, '66666666-6666-4666-8666-666666666666');
        assert.deepEqual(calls, [['codex', 'Start a new task']]);
        await auth('post', '/codex/new').send(body).expect(202);
        assert.equal(calls.length, 1, 'a repeated request is not created twice');
        await auth('post', '/claudecode/new').send({ text: 'read-only', requestId: 'd2222222-2222-4222-8222-222222222222' }).expect(409);
        await auth('post', '/codex/new').send({ text: 'password="nope-nope"', requestId: 'd3333333-3333-4333-8333-333333333333' }).expect(400);
        const unsure = { text: 'unsure', requestId: 'd4444444-4444-4444-8444-444444444444' };
        await auth('post', '/codex/new').send(unsure).expect(504);
        assert.equal((await auth('post', '/codex/new').send(unsure).expect(202)).body.status, 'unknown');
        assert.equal(calls.length, 2);
    }
    finally {
        mod.createAndSend = original;
    }
});
test('disabling sends keeps history readable; disconnect releases the desktop and revokes old access', async () => {
    await auth('put', '/settings').send({ allowSend: false }).expect(200);
    await auth('get', `/codex/sessions/${ID}/messages`).expect(200);
    await auth('post', `/codex/sessions/${ID}/messages`).send({ text: 'disabled', requestId: '88888888-8888-4888-8888-888888888888' }).expect(409);
    await auth('put', '/settings').send({ enabled: false }).expect(200);
    await auth('get', '/sessions').expect(409);
    await auth('put', '/settings', 'bob', 'other').send({ enabled: true, providers: { codex: false, claudecode: false, antigravity: false } }).expect(200);
    await auth('put', '/settings', 'alice').send({ enabled: true }).expect(403);
    await runWithTenant('other', async () => assert.equal((await repo.settings()).owner, 'bob'));
});
