const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-turn-rewind-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
process.env.TOOLS_AGENT_BROWSER = 'off';

const manager = require('../backend/models/agent-run-manager');
const changeRepo = require('../backend/models/agent-change-repository');
const chatRepo = require('../backend/models/ai-chat-repository');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const root = path.join(sandbox, 'repo');
fs.mkdirSync(root, { recursive: true });
const user = { username: 'admin', role: 'admin' };
const usage = { promptTokens: 100, outputTokens: 10, totalTokens: 110 };
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function turn(session, calls, seen) {
    const script = [{ toolCalls: calls }, { text: 'ok' }];
    const client = { model: 'mock', async generateText(options) { seen?.push(options); const next = script.shift(); return { text: next.text || '', toolCalls: next.toolCalls || [], usage }; } };
    return manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'go' }], write: () => {}, signal: new AbortController().signal });
}

test('rewinding to before a turn restores the files from that turn on and keeps earlier turns', async () => {
    fs.writeFileSync(path.join(root, 'README.md'), 'v0\n');
    const session = manager.ensureSession({ agentSessionId: `rewind-${process.pid}`, user, tenantId: 'default', root, permissionMode: 'full' });
    const first = await turn(session, [
        { id: 'a', name: 'edit_file', args: { path: 'README.md', oldString: 'v0', newString: 'v1' } },
        { id: 'b', name: 'write_file', args: { path: 'one.txt', content: 'one' } }
    ]);
    const second = await turn(session, [
        { id: 'c', name: 'edit_file', args: { path: 'README.md', oldString: 'v1', newString: 'v2' } },
        { id: 'd', name: 'write_file', args: { path: 'two.txt', content: 'two' } },
        { id: 'e', name: 'run_command', args: { command: 'echo three > three.txt' } }
    ]);
    assert.equal(read('README.md'), 'v2\n');
    const runs = await changeRepo.listCheckpointRuns(session.id, session.owner);
    assert.deepEqual(runs.map(item => [item.runId, item.files]), [[first.runId, 2], [second.runId, 3]]);

    const back = await manager.rewindToBefore(session, second.runId);
    assert.deepEqual(back.restored.sort(), ['README.md', 'three.txt', 'two.txt']);
    assert.equal(read('README.md'), 'v1\n', 'the earlier turn is kept');
    assert.equal(fs.existsSync(path.join(root, 'two.txt')), false);
    assert.equal(fs.existsSync(path.join(root, 'three.txt')), false, 'files a command created are removed too');
    assert.equal(read('one.txt'), 'one');
    assert.deepEqual((await changeRepo.listCheckpointRuns(session.id, session.owner)).map(item => item.runId), [first.runId]);
    assert.deepEqual(session.changeLog.summary().map(item => item.path).sort(), ['README.md', 'one.txt']);

    // 下一轮告诉模型文件已回退
    const seen = [];
    await turn(session, [{ id: 'f', name: 'read_file', args: { path: 'README.md' } }], seen);
    assert.match(seen[0].systemInstruction, /回退到了之前某一轮开始前的状态[\s\S]*README\.md/);

    await manager.rewindToBefore(session, first.runId);
    assert.equal(read('README.md'), 'v0\n');
    assert.equal(fs.existsSync(path.join(root, 'one.txt')), false);
    assert.equal(session.changeLog.summary().length, 0, 'back to the start of the session: nothing left to undo');
    await assert.rejects(manager.rewindToBefore(session, first.runId), { code: 'AGENT_CHECKPOINT_NOT_FOUND' });
});

test('a turn with no end record is flagged as interrupted so the chat can offer to continue', async () => {
    const owner = 'admin';
    const sessionId = await chatRepo.getOrCreateSession({ owner, pagePath: '/', pageTitle: 'home' });
    await chatRepo.upsertAgentTurn({ sessionId, owner, runId: 'run-crashed', agentSessionId: 'agent-x', root, transcript: [{ role: 'user', content: 'q' }], content: 'half', final: false });
    await chatRepo.upsertAgentTurn({ sessionId, owner, runId: 'run-done', agentSessionId: 'agent-x', root, transcript: [{ role: 'user', content: 'q2' }], content: 'all', final: true });
    const page = await chatRepo.listMessagesPage(sessionId, { limit: 10 });
    const byId = Object.fromEntries(page.items.map(item => [item.id, item]));
    assert.equal(byId['agent_run-crashed_model'].interrupted, true);
    assert.equal(byId['agent_run-done_model'].interrupted, undefined);
    assert.equal(byId['agent_run-crashed_user'].interrupted, undefined);
    assert.equal('agent_final' in byId['agent_run-done_model'], false);
});
