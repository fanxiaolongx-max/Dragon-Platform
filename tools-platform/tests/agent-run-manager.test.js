const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-run-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const manager = require('../backend/models/agent-run-manager');
const contextStats = require('../backend/models/agent-context-stats');
const transcriptRepo = require('../backend/models/agent-transcript-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const root = path.join(sandbox, 'repo');
fs.mkdirSync(path.join(root, '.git'), { recursive: true });
fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
fs.writeFileSync(path.join(root, 'README.md'), 'Hello\n');
const user = { username: 'admin', role: 'admin' };
let counter = 0;
const newSessionId = () => `session-${process.pid}-${counter += 1}`;

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

// 脚本化客户端：每次 generateText 弹出一个预设结果
function scriptedClient(script) {
    const calls = [];
    return {
        model: 'mock-model',
        calls,
        async generateText(options) {
            calls.push({ ...options, messages: [...(options.messages || [])] }); // 运行中消息数组会继续追加，按调用时刻快照
            const next = script.shift();
            if (!next) throw new Error('script exhausted');
            if (next.text && options.onDelta) options.onDelta(next.text);
            return { text: next.text || '', toolCalls: next.toolCalls || [], usage: next.usage || { promptTokens: 100, outputTokens: 10, totalTokens: 110 } };
        }
    };
}

function collector() {
    const events = [];
    return { events, write: event => events.push(event) };
}

test('ask mode blocks on approval, allow executes, and "always" skips later prompts', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const client = scriptedClient([
        { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'README.md' } }] },
        { toolCalls: [{ id: 'c2', name: 'edit_file', args: { path: 'README.md', oldString: 'Hello', newString: 'Hi' } }] },
        { toolCalls: [{ id: 'c3', name: 'edit_file', args: { path: 'README.md', oldString: 'Hi', newString: 'Hey' } }] },
        { text: 'Done.' }
    ]);
    const { events, write } = collector();
    const controller = new AbortController();
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'SYS', historyMessages: [{ role: 'user', content: 'edit' }], write, signal: controller.signal });

    // 等待第一个审批事件出现
    const approval = await waitFor(() => events.find(event => event.type === 'approval'));
    assert.equal(approval.tool, 'edit_file');
    assert.match(approval.preview.diff, /-Hello\n\+Hi/);
    assert.equal(events.filter(event => event.type === 'tool_result').length, 1, 'read_file ran without approval');
    assert.throws(() => manager.resolveApproval(approval.id, 'allow', { username: 'someone-else' }, 'default'), /无权/);
    manager.resolveApproval(approval.id, 'always', user, 'default');

    const result = await turn;
    assert.equal(result.text, 'Done.');
    assert.equal(result.toolCallCount, 3);
    assert.equal(result.denied, 0);
    assert.equal(events.filter(event => event.type === 'approval').length, 1, 'second edit auto-approved after "always"');
    assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'Hey\n');
    assert.deepEqual(result.changes.map(item => [item.path, item.kind, item.added, item.removed]), [['README.md', 'modify', 1, 1]]);
    assert.equal(result.gitBranch, 'feature/x');
    assert.equal(result.context.parts.free > 0, true);
    assert.equal(result.context.source, 'provider');
    assert.match(client.calls[0].systemInstruction, /根目录：/);
    assert.match(client.calls[0].systemInstruction, /README\.md/);
    assert.equal(client.calls[0].tools.length, 16);
    assert.equal(client.calls[1].messages.at(-1).role, 'tool');
    assert.equal(session.transcript.length > 0, true);
    session.changeLog.revert('README.md');
});

test('denied and out-of-root operations become tool errors; full mode never prompts', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const client = scriptedClient([
        { toolCalls: [{ id: 'c1', name: 'run_command', args: { command: 'echo hi' } }, { id: 'c2', name: 'write_file', args: { path: '../out.txt', content: 'x' } }] },
        { text: 'ok' }
    ]);
    const { events, write } = collector();
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'SYS', historyMessages: [{ role: 'user', content: 'go' }], write, signal: new AbortController().signal });
    const approval = await waitFor(() => events.find(event => event.type === 'approval'));
    assert.equal(approval.preview.command, 'echo hi');
    manager.resolveApproval(approval.id, 'deny', user, 'default');
    const result = await turn;
    assert.equal(result.denied, 1);
    const toolMessage = client.calls[1].messages.at(-1);
    assert.match(toolMessage.toolResults[0].content, /拒绝/);
    assert.match(toolMessage.toolResults[1].content, /超出工作目录/);
    assert.equal(events.filter(event => event.type === 'approval').length, 1, 'out-of-root write never asks');

    const fullSession = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const fullClient = scriptedClient([{ toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'tmp.txt', content: 'x' } }] }, { text: 'done' }]);
    const full = collector();
    const fullResult = await manager.runAgentTurn({ session: fullSession, client: fullClient, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'w' }], write: full.write, signal: new AbortController().signal });
    assert.equal(full.events.some(event => event.type === 'approval'), false);
    assert.equal(fullResult.changes[0].kind, 'create');
    fullSession.changeLog.revert('tmp.txt');
});

test('abort rejects pending approvals, cleans up the run and surfaces AbortError', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const client = scriptedClient([{ toolCalls: [{ id: 'c1', name: 'delete_path', args: { path: 'README.md' } }] }]);
    const { events, write } = collector();
    const controller = new AbortController();
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'rm' }], write, signal: controller.signal });
    const approval = await waitFor(() => events.find(event => event.type === 'approval'));
    assert.equal(manager.stats().pendingApprovals, 1);
    controller.abort();
    await assert.rejects(turn, error => error.name === 'AbortError');
    assert.equal(manager.stats().pendingApprovals, 0);
    assert.equal(manager.stats().runs, 0);
    assert.equal(session.activeRun, null);
    assert.throws(() => manager.resolveApproval(approval.id, 'allow', user, 'default'), /过期|不存在/);
    assert.equal(fs.existsSync(path.join(root, 'README.md')), true);
});

test('step cap, busy session and permission helpers', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'auto' });
    const script = Array.from({ length: manager.MAX_STEPS + 2 }, (_, index) => ({ toolCalls: [{ id: `c${index}`, name: 'list_directory', args: {} }] }));
    const client = scriptedClient(script);
    const { write } = collector();
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'loop' }], write, signal: new AbortController().signal });
    assert.equal(result.steps, manager.MAX_STEPS);
    assert.match(result.text, /最大工具调用步数/);

    assert.equal(manager.classifyDecision(session, 'edit_file'), 'allow', 'auto mode writes freely');
    assert.equal(manager.classifyDecision(session, 'run_command'), 'ask');
    assert.equal(manager.classifyDecision(session, 'delete_path'), 'ask');
    assert.equal(manager.classifyDecision(session, 'insert_database_row'), 'allow');
    assert.equal(manager.classifyDecision(session, 'update_database_rows'), 'allow');
    assert.equal(manager.classifyDecision(session, 'delete_database_rows'), 'ask');
    assert.equal(manager.classifyDecision(session, 'unknown_tool'), 'deny');
    assert.throws(() => manager.ensureSession({ agentSessionId: 'short', user, tenantId: 'default', root }), /无效/);
    assert.throws(() => manager.ensureSession({ agentSessionId: session.id, user: { username: 'other' }, tenantId: 'default', root }), /无权/);
    assert.equal(manager.getSession(session.id, user, 'default'), session);
    assert.equal(manager.getSession('missing-session-id', user, 'default'), null);
});

test('database edits run through real approvals and full access commits CRUD without prompts', async () => {
    const sqlite3 = require('../backend/node_modules/sqlite3');
    const file = path.join(root, 'agent-edits.db');
    const db = await new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(file, error => error ? reject(error) : resolve(connection));
    });
    await new Promise((resolve, reject) => db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT)', error => error ? reject(error) : resolve()));
    await new Promise(resolve => db.close(resolve));
    const target = { database: 'local:agent-edits.db', table: 'items' };
    const service = require('../backend/models/agent-database-service');
    const read = () => service.readTable({ root: fs.realpathSync(root) }, target);
    const askSession = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const askEvents = collector();
    const askClient = scriptedClient([
        { toolCalls: [{ id: 'insert', name: 'insert_database_row', args: { ...target, values: '{"id":1,"title":"first"}' } }] }, { text: 'saved' }
    ]);
    const turn = manager.runAgentTurn({ session: askSession, client: askClient, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'insert' }], write: askEvents.write });
    const approval = await waitFor(() => askEvents.events.find(event => event.type === 'approval'));
    assert.equal(JSON.parse(approval.preview.diff).matchedRows, 1);
    assert.equal((await read()).rows.length, 0);
    manager.resolveApproval(approval.id, 'allow', user, 'default');
    assert.equal((await turn).denied, 0);
    assert.equal((await read()).rows[0].title, 'first');
    const fullSession = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const fullEvents = collector();
    const fullClient = scriptedClient([
        { toolCalls: [{ id: 'update', name: 'update_database_rows', args: { ...target, values: '{"title":"second"}', filters: [{ column: 'id', op: 'eq', value: '1' }] } }] },
        { toolCalls: [{ id: 'delete', name: 'delete_database_rows', args: { ...target, filters: [{ column: 'title', op: 'eq', value: 'second' }] } }] },
        { text: 'done' }
    ]);
    const result = await manager.runAgentTurn({ session: fullSession, client: fullClient, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'update then delete' }], write: fullEvents.write });
    assert.equal(fullEvents.events.some(event => event.type === 'approval'), false);
    assert.equal(result.toolLog.every(item => item.ok), true);
    assert.equal((await read()).rows.length, 0);
    assert.match(fullClient.calls[0].systemInstruction, /insert_database_row/);
    assert.equal(fullSession.changeLog.summary().length, 0, 'database commits are not advertised as reversible file edits');
});

test('tool transcript survives a restart of the run manager for the same agentSessionId', async () => {
    const id = newSessionId();
    const session = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    const first = scriptedClient([
        { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'README.md' } }] },
        { text: 'README says Hello.' }
    ]);
    const { write } = collector();
    await manager.runAgentTurn({ session, client: first, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'read it' }], write, signal: new AbortController().signal });
    assert.equal(session.turnCount, 1);
    const saved = await transcriptRepo.load(id);
    assert.equal(saved.root, session.root);
    assert.equal(saved.turnCount, 1);
    assert.deepEqual(saved.transcript.map(item => item.role), ['user', 'model', 'tool', 'model'], 'each turn is stored with its user message');
    assert.equal(saved.transcript[0].content, 'read it');
    assert.equal(saved.transcript[1].toolCalls[0].name, 'read_file');
    assert.match(saved.transcript[2].toolResults[0].content, /Hello/);

    // 模拟重启：内存会话清空，同一 agentSessionId 再来一轮
    manager._internal.sessions.delete(id);
    const revived = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    assert.equal(revived.transcript.length, 0, 'not loaded until a turn runs');
    const second = scriptedClient([{ text: 'Still remember.' }]);
    await manager.runAgentTurn({ session: revived, client: second, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'read it' }, { role: 'model', content: 'README says Hello.' }, { role: 'user', content: 'what did you do?' }], write, signal: new AbortController().signal });
    const sent = second.calls[0].messages;
    assert.deepEqual(sent.map(item => item.role), ['user', 'model', 'tool', 'model', 'user'], 'the stored turn replaces its text-only copy, so the tool call follows its user message');
    assert.equal(sent[0].content, 'read it');
    assert.equal(sent[1].toolCalls[0].name, 'read_file');
    assert.equal(revived.turnCount, 2);
    assert.equal((await transcriptRepo.load(id)).turnCount, 2);

    // 换根目录后旧转录作废
    manager._internal.sessions.delete(id);
    const otherRoot = path.join(sandbox, 'other');
    fs.mkdirSync(otherRoot, { recursive: true });
    const moved = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root: otherRoot, permissionMode: 'full' });
    const third = scriptedClient([{ text: 'fresh' }]);
    await manager.runAgentTurn({ session: moved, client: third, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'hi' }], write, signal: new AbortController().signal });
    assert.deepEqual(third.calls[0].messages.map(item => item.role), ['user'], 'transcript from another root is not reused');
    assert.equal((await transcriptRepo.load(id)).root, fs.realpathSync(otherRoot));

    // 规范化：第一个用户消息之前的条目（旧格式 / 残缺的一轮）丢弃，按整轮裁剪超长内容
    const normalized = transcriptRepo.normalizeTranscript([{ role: 'tool', toolResults: [{ id: 'x', name: 'read_file', content: 'orphan' }] }, { role: 'model', content: 'ok' }, { role: 'user', content: 'q' }, { role: 'model', content: 'a' }]);
    assert.deepEqual(normalized, [{ role: 'user', content: 'q' }, { role: 'model', content: 'a' }]);
    assert.deepEqual(transcriptRepo.normalizeTranscript([{ role: 'model', content: 'legacy without user turns' }]), []);
    const huge = Array.from({ length: 10 }, (_, index) => [{ role: 'user', content: `q${index}` }, { role: 'model', content: `${index}:${'x'.repeat(400 * 1024)}` }]).flat();
    const trimmed = transcriptRepo.normalizeTranscript(huge);
    assert.ok(trimmed.length < 20 && trimmed.length > 0);
    assert.equal(trimmed[0].role, 'user', 'trimming never splits a turn');
    assert.ok(Buffer.byteLength(JSON.stringify(trimmed)) <= transcriptRepo.MAX_JSON_BYTES);
    assert.equal(trimmed.at(-1).content[0], '9', 'oldest turns are dropped first');
});

test('context stats scale estimates to provider prompt tokens', () => {
    const estimate = contextStats.build({ model: 'claude-x', systemPrompt: 'a'.repeat(350), directoryContext: 'b'.repeat(700), messages: [{ role: 'user', content: 'c'.repeat(35) }], tools: [] });
    assert.equal(estimate.windowTokens, 200000);
    assert.equal(estimate.source, 'estimate');
    assert.equal(estimate.parts.system, 100);
    assert.equal(estimate.parts.directory, 200);
    const scaled = contextStats.build({ model: 'gpt-4o', systemPrompt: 'a'.repeat(350), directoryContext: 'b'.repeat(350), providerPromptTokens: 400 });
    assert.equal(scaled.source, 'provider');
    assert.equal(scaled.usedTokens, 400);
    assert.equal(scaled.parts.free, 128000 - 400);
    assert.equal(contextStats.windowFor('gemini-2.5-pro'), 1000000);
});

test('context budgets remove whole old turns, preserve pairs and keep the source history intact', () => {
    const calls = [{ id: 'c1', name: 'read_file', args: { path: 'x' }, thoughtSignature: 'keep-signature' }];
    const history = [{ role: 'user', content: 'old '.repeat(5000) }, { role: 'model', content: 'answer' }, { role: 'user', content: 'current' },
        { role: 'model', content: '', toolCalls: calls }, { role: 'tool', toolResults: [{ id: 'c1', name: 'read_file', content: 'x'.repeat(10000) }] }];
    const before = JSON.stringify(history);
    const fitted = contextStats.fitMessages({ model: 'gpt-4', messages: history });
    assert.equal(fitted.droppedTurns, 1);
    assert.equal(fitted.messages[0].content, 'current');
    assert.deepEqual(fitted.messages[1].toolCalls, calls);
    assert.equal(fitted.messages[2].toolResults[0].id, 'c1');
    assert.equal(JSON.stringify(history), before);
    assert.throws(() => contextStats.fitMessages({ model: 'gpt-4', messages: [{ role: 'user', content: '大'.repeat(20000) }] }), { code: 'AGENT_CONTEXT_LIMIT' });
});

test('model failures preserve completed tool results in the restart context and complete turn archive', async () => {
    const id = newSessionId();
    const session = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    const client = scriptedClient([{ toolCalls: [{ id: 'failed-read', name: 'read_file', args: { path: 'README.md' }, thoughtSignature: 'failed-signature' }] }]);
    await assert.rejects(manager.runAgentTurn({ session, client, systemInstruction: '', historyMessages: [{ role: 'user', content: 'read before failure' }], write: () => {}, signal: new AbortController().signal }), /script exhausted/);
    manager._internal.sessions.delete(id);
    const restored = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root });
    await manager.hydrateSession(restored);
    assert.equal(restored.transcript[1].toolCalls[0].thoughtSignature, 'failed-signature');
    assert.match(restored.transcript[2].toolResults[0].content, /README/);
    const archive = await transcriptRepo.listTurns({ agentSessionId: id, owner: 'default::admin', root: session.root });
    assert.equal(archive[0].status, 'failed');
    assert.equal(archive[0].transcript[2].toolResults[0].id, 'failed-read');
    await assert.rejects(transcriptRepo.listTurns({ agentSessionId: id, owner: 'default::other', root }), { code: 'AGENT_SESSION_FORBIDDEN' });
});

test('complete turn archives retain steps beyond the model transcript entry cap', async () => {
    const id = newSessionId();
    const transcript = Array.from({ length: 100 }, (_, i) => [{ role: 'user', content: `question-${i}` }, { role: 'model', content: `answer-${i}` }]).flat();
    await transcriptRepo.saveTurn({ runId: 'large-archive', agentSessionId: id, owner: 'default::admin', root, transcript, status: 'completed' });
    const [archive] = await transcriptRepo.listTurns({ agentSessionId: id, owner: 'default::admin', root });
    assert.equal(archive.transcript.length, 200);
    assert.equal(transcriptRepo.normalizeTranscript(transcript).length <= transcriptRepo.MAX_ENTRIES, true);
    assert.equal(archive.transcript[0].content, 'question-0');
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

test('transcript normalization keeps Gemini thought signatures so a restart can replay tool calls', () => {
    const normalized = transcriptRepo.normalizeTranscript([
        { role: 'user', content: 'edit' },
        { role: 'model', content: '', toolCalls: [{ id: 'read_file:0', name: 'read_file', args: { path: 'a' }, thoughtSignature: 'sig-xyz' }, { id: 'x:1', name: 'list_directory', args: {} }] },
        { role: 'tool', toolResults: [{ id: 'read_file:0', name: 'read_file', content: 'ok' }, { id: 'x:1', name: 'list_directory', content: 'ok' }] }
    ]);
    const model = normalized.find(entry => entry.role === 'model');
    assert.equal(model.toolCalls[0].thoughtSignature, 'sig-xyz');
    assert.equal('thoughtSignature' in model.toolCalls[1], false);
});

test('a second workspace turn sends each tool call right after its own user message', async () => {
    const id = newSessionId();
    const session = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    const { write } = collector();
    const first = scriptedClient([
        { toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'README.md' } }] },
        { text: 'Changed it.' }
    ]);
    await manager.runAgentTurn({ session, client: first, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'earlier chat' }, { role: 'model', content: 'plain answer' }, { role: 'user', content: 'edit README' }], write, signal: new AbortController().signal });
    const second = scriptedClient([
        { toolCalls: [{ id: 'c2', name: 'read_file', args: { path: 'README.md' } }] },
        { text: 'Again.' }
    ]);
    await manager.runAgentTurn({
        session,
        client: second,
        systemInstruction: 'S',
        historyMessages: [
            { role: 'user', content: 'earlier chat' }, { role: 'model', content: 'plain answer' },
            { role: 'user', content: 'edit README' }, { role: 'model', content: 'Changed it.' },
            { role: 'user', content: 'edit it again' }
        ],
        write,
        signal: new AbortController().signal
    });
    const sent = second.calls[0].messages;
    assert.deepEqual(sent.map(item => item.toolCalls ? 'model:call' : item.role), ['user', 'model', 'user', 'model:call', 'tool', 'model', 'user']);
    assert.equal(sent[0].content, 'earlier chat', 'older text-only history is kept');
    assert.equal(sent[2].content, 'edit README');
    sent.forEach((item, index) => {
        if (item.toolCalls) assert.ok(['user', 'tool'].includes(sent[index - 1].role), `tool call at ${index} follows ${sent[index - 1].role}`);
    });
    assert.deepEqual(session.transcript.filter(item => item.role === 'user').map(item => item.content), ['edit README', 'edit it again']);
});

test('history from a new chat after a restart is appended after the stored turns', () => {
    const transcript = [{ role: 'user', content: 'edit README' }, { role: 'model', content: '', toolCalls: [{ id: 'a', name: 'read_file', args: {} }] }, { role: 'tool', toolResults: [{ id: 'a', name: 'read_file', content: 'ok' }] }, { role: 'model', content: 'done' }];
    const merged = transcriptRepo.mergeHistoryWithTranscript([{ role: 'user', content: 'what did you change?' }], transcript);
    assert.deepEqual(merged.map(item => item.role), ['user', 'model', 'tool', 'model', 'user']);
    assert.equal(merged.at(-1).content, 'what did you change?');
    assert.deepEqual(transcriptRepo.mergeHistoryWithTranscript([{ role: 'user', content: 'hi' }], []), [{ role: 'user', content: 'hi' }]);
});

test('the last turn context is persisted with the transcript and restored on hydrate', async () => {
    const id = newSessionId();
    const session = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    const { write } = collector();
    const result = await manager.runAgentTurn({ session, client: scriptedClient([{ text: 'hi', usage: { promptTokens: 2000, outputTokens: 5, totalTokens: 2005 } }]), systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'hello' }], write, signal: new AbortController().signal });
    const saved = await transcriptRepo.load(id);
    assert.deepEqual(saved.context, result.context);
    manager._internal.sessions.delete(id);
    const state = await manager.loadSessionState(id, user, 'default', session.root);
    assert.deepEqual(state.context, result.context);
    assert.equal(state.turnCount, 1);
    const elsewhere = await manager.loadSessionState(id, user, 'default', path.join(sandbox, 'elsewhere'));
    assert.equal(elsewhere.context, null, 'context is scoped to the same root');
});

test('non-admin accounts are read-only in the workspace: write tools are not offered and calls are refused', async () => {
    const viewer = { username: 'viewer', role: 'viewer' };
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user: viewer, tenantId: 'default', root, permissionMode: 'full' });
    assert.equal(session.readOnly, true);
    const client = scriptedClient([
        { toolCalls: [{ id: 'w1', name: 'write_file', args: { path: 'blocked.txt', content: 'x' } }] },
        { text: 'ok' }
    ]);
    const { events, write } = collector();
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'write it' }], write, signal: new AbortController().signal });
    assert.deepEqual(client.calls[0].tools.map(item => item.name).sort(), ['database_schema', 'list_databases', 'list_directory', 'read_database_table', 'read_file', 'search']);
    assert.equal(fs.existsSync(path.join(root, 'blocked.txt')), false);
    assert.equal(result.denied, 1);
    assert.equal(events.some(event => event.type === 'approval'), false, 'read-only refusals never prompt');
    assert.match(client.calls[1].messages.at(-1).toolResults[0].content, /只读/);
    assert.match(client.calls[0].systemInstruction, /只读/);
    const admin = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    assert.equal(admin.readOnly, false);
});

test('transcripts are saved per tenant database, including a tenant opened later', async () => {
    const { runWithTenant } = require('../backend/models/tenant-context');
    const entry = [{ role: 'user', content: 'q' }, { role: 'model', content: 'a' }];
    await runWithTenant('default', () => transcriptRepo.save({ agentSessionId: 'tenant-a-0001', owner: 'default::admin', root, transcript: entry, turnCount: 1 }));
    await runWithTenant('tenant-two', () => transcriptRepo.save({ agentSessionId: 'tenant-b-0001', owner: 'tenant-two::admin', root, transcript: entry, turnCount: 1 }));
    const fromB = await runWithTenant('tenant-two', () => transcriptRepo.load('tenant-b-0001'));
    assert.equal(fromB.turnCount, 1);
    assert.equal(await runWithTenant('tenant-two', () => transcriptRepo.load('tenant-a-0001')), null, 'tenants stay isolated');

    // 对话历史同理：另一个租户首次使用时也要建表
    const aiChatRepo = require('../backend/models/ai-chat-repository');
    await runWithTenant('default', () => aiChatRepo.getOrCreateSession({ pagePath: '/', pageTitle: 'a' }));
    const sessionB = await runWithTenant('tenant-three', () => aiChatRepo.getOrCreateSession({ pagePath: '/', pageTitle: 'b' }));
    await runWithTenant('tenant-three', () => aiChatRepo.addMessage({ sessionId: sessionB, pagePath: '/', pageTitle: 'b', role: 'user', content: 'hi' }));
    assert.equal((await runWithTenant('tenant-three', () => aiChatRepo.listMessages(sessionB))).length, 1);
});
