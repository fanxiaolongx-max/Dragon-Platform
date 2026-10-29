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
            if (next.thinking && options.onReasoning) options.onReasoning(next.thinking);
            if (next.text && options.onDelta) options.onDelta(next.text);
            return { text: next.text || '', toolCalls: next.toolCalls || [], finishReason: next.finishReason || '', usage: next.usage || { promptTokens: 100, outputTokens: 10, totalTokens: 110 } };
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
    assert.deepEqual(client.calls[0].tools.map(item => item.name), ['list_directory', 'read_file', 'search', 'list_databases', 'database_schema', 'read_database_table', 'write_file', 'edit_file', 'delete_path', 'rename_path', 'run_command', 'tool_search'],
        'only the core tools and tool_search are sent up front; load_skill needs a skill catalog');
    assert.match(client.calls[0].systemInstruction, /按需工具[\s\S]*insert_database_row/, 'deferred tools are listed by name');
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

    // 步数用完时不带工具再问一次，让模型总结进展
    const capped = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'auto' });
    const summaryClient = scriptedClient([...Array.from({ length: manager.MAX_STEPS }, (_, index) => ({ toolCalls: [{ id: `s${index}`, name: 'list_directory', args: {} }] })), { text: '已列出目录，还差汇总。' }]);
    const summarized = await manager.runAgentTurn({ session: capped, client: summaryClient, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'loop' }], write: () => {}, signal: new AbortController().signal });
    assert.equal(summaryClient.calls.at(-1).toolChoice, 'none');
    assert.match(summarized.text, /^已列出目录，还差汇总。[\s\S]*回复“继续”/);

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
    assert.equal(scaled.parts.free + scaled.parts.reserve, 128000 - 400);
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
    assert.deepEqual(client.calls[0].tools.map(item => item.name).sort(), ['database_schema', 'list_databases', 'list_directory', 'read_database_table', 'read_file', 'search', 'tool_search']);
    assert.doesNotMatch(client.calls[0].systemInstruction, /insert_database_row|welink_send_message/, 'write tools are not even listed for read-only accounts');
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

test('workspace chats get the dedicated skill tools (@netcare-data / @ops-group / @welink-office) without approval prompts for read-only queries', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const client = scriptedClient([
        { toolCalls: [{ id: 'n1', name: 'netcare_tables', args: { keyword: 'risk' } }] },
        { text: 'ok' }
    ]);
    const { events, write } = collector();
    await manager.runAgentTurn({ session, client, write, signal: new AbortController().signal,
        systemInstruction: 'SYS\n### @netcare-data\n...\n### @ops-group\n...\n### @welink-office\n...', historyMessages: [{ role: 'user', content: '查 NetCare' }] });
    const names = client.calls[0].tools.map(tool => tool.name);
    for (const name of ['netcare_tables', 'netcare_sql', 'ops_overview', 'ops_save_plan', 'welink_query']) assert.ok(names.includes(name), `${name} offered`);
    assert.ok(names.includes('read_file'), 'workspace tools still offered');
    assert.equal(events.some(event => event.type === 'approval'), false, 'read-only NetCare query is not gated by approval');
    const result = events.find(event => event.type === 'tool_result' && event.callId === 'n1');
    assert.ok(result, 'NetCare tool executed (it reports the base status when not configured)');

    const plain = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const plainClient = scriptedClient([{ text: 'hi' }]);
    await manager.runAgentTurn({ session: plain, client: plainClient, systemInstruction: 'SYS', historyMessages: [{ role: 'user', content: 'hi' }], write: () => {}, signal: new AbortController().signal });
    assert.equal(plainClient.calls[0].tools.some(tool => /^(netcare|ops)_/.test(tool.name)), false, 'skill tools only when the skill is loaded');
});

test('chats without a folder use a hidden per-account scratch workspace that is never shown to the model or the user', async () => {
    const scratch = manager.ensureScratchSession({ user, tenantId: 'default', chatSessionId: 'chat-1' });
    assert.equal(scratch.scratch, true);
    assert.equal(scratch.permissionMode, 'auto');
    assert.ok(scratch.root.startsWith(fs.realpathSync(os.tmpdir())) && fs.statSync(scratch.root).isDirectory());
    assert.equal(manager.ensureScratchSession({ user, tenantId: 'default', chatSessionId: 'chat-1' }).id, scratch.id, 'same chat reuses its agent session');
    const other = manager.ensureScratchSession({ user, tenantId: 'default', chatSessionId: 'chat-2' });
    assert.notEqual(other.id, scratch.id);
    assert.equal(other.root, scratch.root, 'files persist across chats of the same account');
    assert.notEqual(manager.ensureScratchSession({ user: { username: 'bob', role: 'admin' }, tenantId: 'default', chatSessionId: 'chat-1' }).root, scratch.root);
    const client = scriptedClient([{ text: 'done' }]);
    await manager.runAgentTurn({ session: scratch, client, systemInstruction: 'SYS', historyMessages: [{ role: 'user', content: 'hi' }], write: () => {}, signal: new AbortController().signal });
    assert.equal(client.calls[0].systemInstruction.includes(scratch.root), false, 'scratch path is not given to the model');
    assert.match(client.calls[0].systemInstruction, /临时目录/);
});

test('tool_search loads deferred tools for the rest of the session, appended after the existing ones; approvals still apply', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const client = scriptedClient([
        { toolCalls: [{ id: 's1', name: 'tool_search', args: { select: ['database'] } }] },
        { toolCalls: [{ id: 's2', name: 'tool_search', args: { query: '脚本' } }] },
        { toolCalls: [{ id: 's3', name: 'tool_search', args: { select: ['welink-channel'] } }] },
        { toolCalls: [{ id: 'w1', name: 'welink_send_message', args: { text: 'hi' } }] },
        { text: 'ok' }
    ]);
    const { events, write } = collector();
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '发条消息' }], write, signal: new AbortController().signal });
    const approval = await waitFor(() => events.find(event => event.type === 'approval'));
    assert.equal(approval.tool, 'welink_send_message', 'a tool loaded on demand still asks before sending');
    manager.resolveApproval(approval.id, 'deny', user, 'default');
    const result = await turn;
    const names = index => client.calls[index].tools.map(item => item.name);
    assert.equal(names(0).includes('insert_database_row'), false);
    assert.deepEqual(names(1).slice(0, names(0).length), names(0), 'the earlier part of the tool list is unchanged, so the prompt cache still hits');
    assert.ok(['list_databases', 'database_schema', 'insert_database_row', 'delete_database_rows'].every(name => names(1).includes(name)));
    assert.match(client.calls[1].messages.at(-1).toolResults[0].content, /### insert_database_row[\s\S]*参数：/, 'the search result carries the full schema');
    assert.ok(names(2).some(name => /_uiv_/.test(name)), 'keyword search loads matching tools');
    assert.equal(result.denied, 1);
    assert.equal(result.context.tools.loaded, names(4).length);
    assert.ok(result.context.tools.deferred > 0 && result.context.tools.deferredTokens > 0);

    const next = scriptedClient([{ text: 'again' }]);
    await manager.runAgentTurn({ session, client: next, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'again' }], write: () => {}, signal: new AbortController().signal });
    assert.ok(next.calls[0].tools.some(item => item.name === 'insert_database_row'), 'loaded tools stay loaded in the next turn');
});

test('read-only accounts cannot load write tools; a deferred tool called directly runs through the normal checks and gets loaded', async () => {
    const viewer = { username: 'viewer2', role: 'viewer' };
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user: viewer, tenantId: 'default', root, permissionMode: 'full' });
    const client = scriptedClient([
        { toolCalls: [{ id: 'r1', name: 'tool_search', args: { select: ['insert_database_row', 'welink_send_message'] } }] },
        { toolCalls: [{ id: 'r2', name: 'insert_database_row', args: {} }, { id: 'r3', name: 'list_uiv_categories', args: {} }] },
        { text: 'ok' }
    ]);
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'x' }], write: () => {}, signal: new AbortController().signal });
    assert.match(client.calls[1].messages.at(-1).toolResults[0].content, /无权使用/);
    assert.equal(client.calls[1].tools.some(item => item.name === 'insert_database_row'), false);
    const [insert, list] = client.calls[2].messages.at(-1).toolResults;
    assert.match(insert.content, /只读/);
    assert.doesNotMatch(list.content, /只读|拒绝|未知工具/, 'a read tool called without loading still runs');
    const loaded = client.calls[2].tools.map(item => item.name);
    assert.ok(loaded.includes('list_uiv_categories') && loaded.includes('read_uiv_script'), 'calling one deferred tool loads its whole group');
    assert.equal(loaded.some(name => ['insert_database_row', 'save_uiv_script'].includes(name)), false, 'but never write tools for a read-only account');
    assert.equal(result.denied, 1);
});

test('load_skill loads a catalog skill and its tools; ops writes and pushes go through approval cards', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const catalog = [{ id: 'netcare-data' }, { id: 'ops-group' }, { id: 'data-check' }];
    const client = scriptedClient([
        { toolCalls: [{ id: 'k1', name: 'load_skill', args: { id: '@netcare-data' } }, { id: 'k2', name: 'load_skill', args: { id: 'ops-group' } }, { id: 'k3', name: 'load_skill', args: { id: 'no-such-skill' } }] },
        { toolCalls: [{ id: 'o1', name: 'ops_overview', args: {} }, { id: 'o2', name: 'ops_save_settings', args: { styleGuide: '只发周报' } }] },
        { text: 'ok' }
    ]);
    const { events, write } = collector();
    const turn = manager.runAgentTurn({ session, client, systemInstruction: 'S', skillCatalog: catalog, historyMessages: [{ role: 'user', content: '配置运营' }], write, signal: new AbortController().signal });
    const approval = await waitFor(() => events.find(event => event.type === 'approval'));
    assert.equal(approval.tool, 'ops_save_settings', 'reading the overview needs no approval; saving the style guide does');
    assert.match(approval.preview.title, /运营 · 保存运营规范/);
    assert.deepEqual(approval.preview.fields, [{ label: '运营规范', value: '只发周报' }]);
    manager.resolveApproval(approval.id, 'deny', user, 'default');
    const result = await turn;
    assert.equal(result.denied, 1);
    assert.ok(client.calls[0].tools.some(item => item.name === 'load_skill'));
    const [netcare, ops, missing] = client.calls[1].messages.at(-1).toolResults;
    assert.match(netcare.content, /### @netcare-data[\s\S]*已加载工具：.*netcare_tables/);
    assert.match(ops.content, /### @ops-group[\s\S]*已加载工具：.*ops_send_draft/);
    assert.equal(missing.isError, true);
    const names = client.calls[1].tools.map(item => item.name);
    assert.ok(names.includes('netcare_sql') && names.includes('ops_save_plan'), 'skill tools attach after load_skill');
    const [overview, saved] = client.calls[2].messages.at(-1).toolResults;
    assert.equal(overview.isError, false);
    assert.match(saved.content, /用户拒绝/);
    assert.notEqual((await require('../backend/models/channels/ops-repository').getSettings()).styleGuide, '只发周报', 'a denied ops write changes nothing');

    // 下一轮仍保留模型自行加载的技能工具；用户选择 @data-check 时数据库工具从第一步就带上
    const next = scriptedClient([{ text: 'again' }]);
    await manager.runAgentTurn({ session, client: next, systemInstruction: 'S', skillCatalog: catalog, skillIds: ['data-check'], historyMessages: [{ role: 'user', content: 'again' }], write: () => {}, signal: new AbortController().signal });
    const nextNames = next.calls[0].tools.map(item => item.name);
    assert.ok(nextNames.includes('netcare_tables'));
    assert.ok(nextNames.includes('read_database_table'));
});

test('an empty reply after tool calls is nudged instead of ending the turn, and a truncated answer is continued', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const client = scriptedClient([
        { toolCalls: [{ id: 'e1', name: 'read_file', args: { path: 'README.md' } }], thinking: '先读文件' },
        { text: '' },
        { text: '结论第一段，', finishReason: 'length' },
        { text: '第二段。' }
    ]);
    const { events, write } = collector();
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '读一下' }], write, signal: new AbortController().signal });
    assert.equal(result.text, '结论第一段，第二段。');
    assert.match(client.calls[2].messages.at(-1).content, /上一条回复是空的/);
    assert.match(client.calls[3].messages.at(-1).content, /截断/);
    assert.equal(client.calls[3].messages.at(-2).content, '结论第一段，');
    assert.ok(events.some(event => event.type === 'status' && /继续/.test(event.status)));
    assert.equal(session.transcript.filter(item => item.role === 'user').length, 1, 'nudges are not saved into the transcript');
    assert.deepEqual(events.filter(event => event.type === 'thinking').map(event => event.delta), ['先读文件'], 'reasoning is streamed for display only');
    assert.equal(JSON.stringify(session.transcript).includes('先读文件'), false);

    // 一个字都没写就碰到上限（推理耗尽）：调高输出上限再试；连续空回复最多提示两次
    const thinking = scriptedClient([{ text: '', finishReason: 'max_tokens' }, { text: '', finishReason: '' }, { text: '' }, { text: '' }]);
    const plain = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const empty = await manager.runAgentTurn({ session: plain, client: thinking, systemInstruction: 'S', maxOutputTokens: 2048, historyMessages: [{ role: 'user', content: 'x' }], write: () => {}, signal: new AbortController().signal });
    assert.equal(thinking.calls[1].maxOutputTokens, 8192);
    assert.equal(thinking.calls.length, 4);
    assert.equal(empty.text, '');
});

test('a large tool result is saved whole to the owner\'s file; the context keeps the head, tail and path, and read_file can page through it', async () => {
    const artifacts = require('../backend/models/agent-artifacts');
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const command = `node -e "for (let i = 0; i < 3000; i++) console.log('line ' + i)"`;
    const client = scriptedClient([
        { toolCalls: [{ id: 'big1', name: 'run_command', args: { command } }] },
        { text: 'need the middle' },
    ]);
    const { events, write } = collector();
    await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'run' }], write, signal: new AbortController().signal });
    const sent = client.calls[1].messages.at(-1).toolResults[0].content;
    const result = events.find(event => event.type === 'tool_result' && event.callId === 'big1');
    assert.ok(result.artifact?.path, 'the event carries the saved file for the file card');
    assert.ok(sent.length < 6000, 'only the head and tail stay in context');
    assert.match(sent, /line 0[\s\S]*完整内容已保存到[\s\S]*line 2999/);
    assert.ok(sent.includes(result.artifact.path));
    assert.ok(artifacts.belongsTo(session.owner, result.artifact.path));
    assert.match(fs.readFileSync(result.artifact.path, 'utf8'), /line 1500\n/, 'the middle is kept in the file');

    const reader = scriptedClient([
        { toolCalls: [{ id: 'r1', name: 'read_file', args: { path: result.artifact.path, startLine: 1501, limit: 2 } }] },
        { text: 'ok' }
    ]);
    await manager.runAgentTurn({ session, client: reader, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'read' }], write: () => {}, signal: new AbortController().signal });
    assert.match(reader.calls[1].messages.at(-1).toolResults[0].content, /1501│line 1499\n1502│line 1500/);

    const other = manager.ensureSession({ agentSessionId: newSessionId(), user: { username: 'mallory', role: 'admin' }, tenantId: 'default', root, permissionMode: 'full' });
    const snoop = scriptedClient([{ toolCalls: [{ id: 'm1', name: 'read_file', args: { path: result.artifact.path } }] }, { text: 'no' }]);
    await manager.runAgentTurn({ session: other, client: snoop, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'peek' }], write: () => {}, signal: new AbortController().signal });
    assert.equal(snoop.calls[1].messages.at(-1).toolResults[0].isError, true, 'another account cannot read it');
});

test('the chat-log export includes every agent turn with full tool calls, and only for the owner', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const client = scriptedClient([{ toolCalls: [{ id: 'x1', name: 'read_file', args: { path: 'README.md' } }] }, { text: 'done' }]);
    await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'read' }], write: () => {}, signal: new AbortController().signal });
    const exported = await transcriptRepo.exportSession({ agentSessionId: session.id, owner: session.owner });
    assert.equal(exported.turns.length, 1);
    assert.equal(exported.turns[0].status, 'completed');
    assert.deepEqual(exported.turns[0].transcript.map(item => item.role), ['user', 'model', 'tool', 'model']);
    assert.equal(exported.turns[0].transcript[1].toolCalls[0].name, 'read_file');
    assert.equal(exported.permissionMode, 'full');
    assert.equal(await transcriptRepo.exportSession({ agentSessionId: session.id, owner: 'default::someone-else' }), null);

    // 同一个智能体会话被另一个对话复用时，按对话过滤轮次
    const chatOther = await require('../backend/models/ai-chat-repository').getOrCreateSession({ owner: 'admin', pagePath: '/', pageTitle: 'other' });
    const other = scriptedClient([{ text: 'other chat' }]);
    await manager.runAgentTurn({ session, client: other, chatSessionId: chatOther, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'hi' }], write: () => {}, signal: new AbortController().signal });
    assert.equal((await transcriptRepo.exportSession({ agentSessionId: session.id, owner: session.owner })).turns.length, 2);
    assert.equal((await transcriptRepo.exportSession({ agentSessionId: session.id, owner: session.owner, chatSessionId: chatOther })).turns.length, 2, 'turns without a chat id are kept');
    assert.deepEqual((await transcriptRepo.exportSession({ agentSessionId: session.id, owner: session.owner, chatSessionId: 'chat-x' })).turns.map(turn => turn.transcript[0].content), ['read']);
});

// 小窗口下连续读大文件：到触发线时自动把较早步骤整理成摘要
function compactingClient({ steps, windowTokens, summary = '摘要：已逐个读取 big.txt，内容是重复的 x。' }) {
    const calls = [];
    const summaries = [];
    let step = 0;
    return {
        model: 'mock-model', settings: { contextWindowTokens: windowTokens }, calls, summaries,
        async generateText(options) {
            if (options.prompt) { summaries.push(options.prompt); return { text: summary, usage: {} }; }
            calls.push({ ...options, messages: [...options.messages] });
            step += 1;
            if (step <= steps) return { text: '', toolCalls: [{ id: `r${step}`, name: 'read_file', args: { path: 'big.txt' } }], usage: { promptTokens: 0 } };
            return { text: '全部读完。', toolCalls: [], usage: { promptTokens: 0 } };
        }
    };
}

test('a long run compacts earlier steps into a summary at the threshold, keeps tool pairs intact, and the compacted context survives a restart', async () => {
    fs.writeFileSync(path.join(root, 'big.txt'), `${'x'.repeat(100)}\n`.repeat(60));
    const id = newSessionId();
    const session = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    const client = compactingClient({ steps: 14, windowTokens: 30000 });
    const { events, write } = collector();
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '把 big.txt 读 14 遍' }], write, signal: new AbortController().signal });
    assert.equal(result.text, '全部读完。');
    const done = events.find(event => event.type === 'compaction' && event.phase === 'done');
    assert.ok(done, 'compaction ran');
    assert.ok(done.afterTokens < done.beforeTokens);
    assert.equal(events.filter(event => event.type === 'compaction' && event.phase === 'done').length, 1, 'one compaction leaves enough headroom; it does not re-trigger every step');
    assert.ok(done.afterTokens < contextStats.compactThreshold(30000, 2048) * 0.85);
    assert.match(client.summaries[0], /当前任务（用户原话[^）]*）：把 big\.txt 读 14 遍/);
    const after = client.calls.find(call => String(call.messages[0].content).startsWith(transcriptRepo.COMPACTED_HEADER));
    assert.ok(after, 'the request after compaction starts with the summary');
    assert.match(after.messages[0].content, /摘要：已逐个读取[\s\S]*当前任务（用户原话）：把 big\.txt 读 14 遍/);
    for (const call of client.calls) {
        call.messages.forEach((message, index) => {
            if (message.role !== 'tool') return;
            const previous = call.messages[index - 1];
            assert.deepEqual(previous?.toolCalls?.map(item => item.id), message.toolResults.map(item => item.id), 'every tool result follows its own call');
        });
    }
    assert.equal(events.some(event => event.type === 'status' && /移出模型上下文/.test(event.status)), false, 'no whole-turn dropping was needed');
    assert.ok(String(session.transcript[0].content).startsWith(transcriptRepo.COMPACTED_HEADER), 'the saved context is the compacted one');
    const archived = await transcriptRepo.exportSession({ agentSessionId: id, owner: session.owner });
    assert.equal(archived.turns[0].transcript.filter(entry => entry.role === 'tool').length, 14, 'the turn archive keeps every step');

    // 重启后恢复：仍是压缩后的上下文，不会用轮次档案拼回原文
    manager._internal.sessions.delete(id);
    const revived = manager.ensureSession({ agentSessionId: id, user, tenantId: 'default', root, permissionMode: 'full' });
    const next = scriptedClient([{ text: 'ok' }]);
    await manager.runAgentTurn({ session: revived, client: next, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '把 big.txt 读 14 遍' }, { role: 'model', content: '全部读完。' }, { role: 'user', content: '然后呢' }], write: () => {}, signal: new AbortController().signal });
    assert.ok(String(next.calls[0].messages[0].content).startsWith(transcriptRepo.COMPACTED_HEADER));
    assert.equal(next.calls[0].messages.at(-1).content, '然后呢');
});

test('when the summary fails, the run falls back to dropping whole turns and still finishes', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    const client = compactingClient({ steps: 14, windowTokens: 30000, summary: '' });
    const { events, write } = collector();
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '读很多遍' }], write, signal: new AbortController().signal });
    assert.equal(result.text, '全部读完。');
    assert.ok(events.some(event => event.type === 'compaction' && event.phase === 'failed'));
    assert.equal(events.filter(event => event.type === 'compaction' && event.phase === 'start').length, 1, 'no retry storm after a failure');
});

test('a tool name passed to run_command is answered without an approval card, and the tool gets loaded', async () => {
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'ask' });
    const client = scriptedClient([{ toolCalls: [{ id: 'm1', name: 'run_command', args: { command: 'list_uiv_scripts' } }] }, { text: 'ok' }]);
    const { events, write } = collector();
    await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '看看脚本' }], write, signal: new AbortController().signal });
    assert.equal(events.some(event => event.type === 'approval'), false);
    assert.match(client.calls[1].messages.at(-1).toolResults[0].content, /list_uiv_scripts 是工具名，不是 Shell 命令/);
    assert.ok(client.calls[1].tools.some(item => item.name === 'list_uiv_scripts'));
});

test('steps that each call several tools in parallel still compact instead of failing with a context error', async () => {
    fs.writeFileSync(path.join(root, 'big.txt'), `${'x'.repeat(100)}\n`.repeat(60));
    const session = manager.ensureSession({ agentSessionId: newSessionId(), user, tenantId: 'default', root, permissionMode: 'full' });
    let step = 0;
    const client = {
        model: 'mock-model', settings: { contextWindowTokens: 30000 }, calls: [],
        async generateText(options) {
            if (options.prompt) return { text: '摘要：已读完前几段，未见 ERROR。', usage: {} };
            this.calls.push(options.messages.length);
            step += 1;
            if (step <= 6) return { text: '', toolCalls: Array.from({ length: 5 }, (_, index) => ({ id: `p${step}_${index}`, name: 'read_file', args: { path: 'big.txt' } })), usage: {} };
            return { text: '读完了。', toolCalls: [], usage: {} };
        }
    };
    const { events, write } = collector();
    const result = await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: '并行读很多段' }], write, signal: new AbortController().signal });
    assert.equal(result.text, '读完了。');
    assert.ok(events.some(event => event.type === 'compaction' && event.phase === 'done'), 'compaction ran even though the latest step alone is large');
});

test('a summary cut off by a reasoning model is retried once with a larger output limit', async () => {
    const compaction = require('../backend/models/ai-context-compaction');
    const limits = [];
    const client = { async generateText(options) { limits.push(options.maxOutputTokens); return limits.length === 1 ? { text: '摘要写到一半', finishReason: 'length' } : { text: '完整摘要', finishReason: 'stop' }; } };
    assert.equal(await compaction.summarize({ client, entries: [{ role: 'user', content: 'x' }] }), '完整摘要');
    assert.deepEqual(limits, [4096, 8192]);
});

test('the summary input lists every parallel tool result and pulls error lines out of the middle of long results', async () => {
    const compaction = require('../backend/models/ai-context-compaction');
    let prompt = '';
    const client = { async generateText(options) { prompt = options.prompt; return { text: '摘要', finishReason: 'stop' }; } };
    const page = index => Array.from({ length: 80 }, (_, line) => (index === 3 && line === 40 ? 'ERROR order-sync: upstream timeout (batch=7731)' : `INFO batch ${index * 80 + line} ok`)).join('\n');
    await compaction.summarize({ client, maxChars: 8000, entries: [
        { role: 'user', content: '分段读日志' },
        { role: 'model', content: '', toolCalls: Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, name: 'read_file', args: { startLine: index * 80 + 1 } })) },
        { role: 'tool', toolResults: Array.from({ length: 5 }, (_, index) => ({ id: `r${index}`, name: 'read_file', content: page(index) })) }
    ] });
    for (let index = 0; index < 5; index++) assert.match(prompt, new RegExp(`工具结果 read_file#r${index} 成功`));
    assert.match(prompt, /关键行：\n {2}! ERROR order-sync: upstream timeout \(batch=7731\)/);
});
