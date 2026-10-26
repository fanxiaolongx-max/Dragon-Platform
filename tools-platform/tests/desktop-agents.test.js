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
let server, httpServer, posts = 0, busy = false;
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
                    response.result = { result: { turn: { id: 'native-turn' } } };
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
