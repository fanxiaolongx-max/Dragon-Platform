const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-claw-safety-regressions-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const tools = require('../backend/models/agent-tools-service');
const tracker = require('../backend/models/agent-command-tracker');
const { AgentChangeLog, MAX_SNAPSHOT_BYTES } = require('../backend/models/agent-change-log');
const manager = require('../backend/models/agent-run-manager');
const transcripts = require('../backend/models/agent-transcript-repository');
const chat = require('../backend/models/ai-chat-repository');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const changesRepo = require('../backend/models/agent-change-repository');
const workspaceChanges = require('../backend/models/agent-workspace-changes');
const { redactText, redactValue } = require('../backend/models/ai-sensitive-data');
const pr = require('../backend/models/agent-pr-service');
let sequence = 0;

test.after(async () => {
    await pool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function project() {
    const root = path.join(sandbox, `project-${++sequence}`);
    fs.mkdirSync(root);
    return { root, changeLog: new AgentChangeLog(root), signal: new AbortController().signal };
}
function git(root, ...args) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();
}

test('unavailable original Git content never turns an existing large file into a removable create', async () => {
    const ctx = project();
    git(ctx.root, 'init', '-q');
    const file = path.join(ctx.root, 'large.txt');
    fs.writeFileSync(file, Buffer.alloc(MAX_SNAPSHOT_BYTES + 2048, 65));
    git(ctx.root, 'add', 'large.txt');
    git(ctx.root, 'commit', '-qm', 'initial');
    const before = await tracker.captureBefore(ctx.root);
    fs.appendFileSync(file, 'x');
    const changes = await tracker.detectAfter(ctx.root, before);
    for (const item of changes) ctx.changeLog.recordExternal(item.display, item.abs, item);
    assert.equal(ctx.changeLog.summary()[0].kind, 'modify');
    assert.equal(ctx.changeLog.summary()[0].revertible, false);
    assert.throws(() => ctx.changeLog.revert('large.txt'), { code: 'AGENT_CHANGE_NOT_REVERTIBLE' });
    assert.equal(fs.statSync(file).size, MAX_SNAPSHOT_BYTES + 2049);
});

test('command snapshots use the pre-command revision even when the command commits its changes', async () => {
    const ctx = project();
    git(ctx.root, 'init', '-q');
    fs.writeFileSync(path.join(ctx.root, 'a.txt'), 'before\n');
    git(ctx.root, 'add', 'a.txt');
    git(ctx.root, 'commit', '-qm', 'initial');
    const before = await tracker.captureBefore(ctx.root);
    fs.writeFileSync(path.join(ctx.root, 'a.txt'), 'after\n');
    // A command may update HEAD and leave a dirty file; its original must still come from the old revision.
    git(ctx.root, 'commit', '-qam', 'command commit');
    fs.appendFileSync(path.join(ctx.root, 'a.txt'), 'extra\n');
    const changes = await tracker.detectAfter(ctx.root, before);
    assert.equal(changes[0].original.toString(), 'before\n');
});

test('rename undo preserves later work at the original path and handles composed changes', async t => {
    await t.test('original path recreated by the user is a conflict', async () => {
        const ctx = project();
        fs.writeFileSync(path.join(ctx.root, 'old.txt'), 'original\n');
        await tools.execute(ctx, 'rename_path', { from: 'old.txt', to: 'new.txt' });
        fs.writeFileSync(path.join(ctx.root, 'old.txt'), 'later user work\n');
        assert.throws(() => ctx.changeLog.revert('new.txt'), { code: 'AGENT_CHANGE_CONFLICT' });
        assert.equal(fs.readFileSync(path.join(ctx.root, 'old.txt'), 'utf8'), 'later user work\n');
        assert.equal(fs.readFileSync(path.join(ctx.root, 'new.txt'), 'utf8'), 'original\n');
    });
    await t.test('create then rename undoes to no file', async () => {
        const ctx = project();
        await tools.execute(ctx, 'write_file', { path: 'old.txt', content: 'new\n' });
        await tools.execute(ctx, 'rename_path', { from: 'old.txt', to: 'new.txt' });
        ctx.changeLog.revert('new.txt');
        assert.equal(fs.existsSync(path.join(ctx.root, 'old.txt')), false);
        assert.equal(fs.existsSync(path.join(ctx.root, 'new.txt')), false);
    });
    await t.test('rename then edit, delete or restart retains the original path', async () => {
        for (const action of ['edit_file', 'delete_path']) {
            const ctx = project();
            fs.writeFileSync(path.join(ctx.root, 'old.txt'), 'original\n');
            await tools.execute(ctx, 'rename_path', { from: 'old.txt', to: 'mid.txt' });
            await tools.execute(ctx, 'rename_path', { from: 'mid.txt', to: 'new.txt' });
            await tools.execute(ctx, action, { path: 'new.txt', oldString: 'original', newString: 'changed' });
            const restored = AgentChangeLog.fromRecords(ctx.root, ctx.changeLog.toRecords());
            restored.revert('new.txt');
            assert.equal(fs.readFileSync(path.join(ctx.root, 'old.txt'), 'utf8'), 'original\n');
            assert.equal(fs.existsSync(path.join(ctx.root, 'new.txt')), false);
            assert.equal(fs.existsSync(path.join(ctx.root, 'mid.txt')), false);
        }
    });
});

test('a cold agent session cannot take over another user persisted session ID', async () => {
    const ctx = project();
    const id = 'cold-owner-regression';
    await transcripts.save({ agentSessionId: id, owner: 'default::alice', root: ctx.root, transcript: [{ role: 'user', content: 'private' }, { role: 'model', content: 'answer' }], turnCount: 1 });
    const bob = { username: 'bob', role: 'viewer' };
    const session = manager.ensureSession({ agentSessionId: id, user: bob, tenantId: 'default', root: ctx.root });
    let called = false;
    for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(manager.runAgentTurn({ session, client: { generateText: async () => { called = true; return { text: 'wrong' }; } }, systemInstruction: '', historyMessages: [{ role: 'user', content: 'hello' }], write: () => {}, signal: ctx.signal }), { code: 'AGENT_SESSION_FORBIDDEN' });
        assert.equal(session.activeRun, null);
    }
    assert.equal(called, false);
    assert.equal((await transcripts.load(id)).owner, 'default::alice');
    await assert.rejects(transcripts.save({ agentSessionId: id, owner: 'default::bob', root: ctx.root, transcript: [], turnCount: 0 }), { code: 'AGENT_SESSION_FORBIDDEN' });
});

test('chat lists, reads, writes and archive operations enforce ownership', async () => {
    const id = await chat.addMessage({ owner: 'alice', pagePath: '/', role: 'user', content: 'alice private message' });
    assert.deepEqual(await chat.listSessions({ owner: 'bob', pagePath: '/' }), []);
    assert.equal((await chat.listArchivedSessions({ owner: 'bob' })).total, 0);
    await assert.rejects(chat.listMessages(id, { owner: 'bob' }), { code: 'AI_SESSION_FORBIDDEN' });
    await assert.rejects(chat.addMessage({ sessionId: id, owner: 'bob', pagePath: '/', content: 'intrusion' }), { code: 'AI_SESSION_FORBIDDEN' });
    await assert.rejects(chat.setSessionArchived(id, true, { owner: 'bob' }), { code: 'AI_SESSION_FORBIDDEN' });
    assert.equal((await chat.listMessages(id, { owner: 'alice' })).length, 1);
    const legacy = await chat.addMessage({ pagePath: '/', content: 'legacy shared' });
    await assert.rejects(chat.getOrCreateSession({ sessionId: legacy, owner: 'bob', pagePath: '/' }), { code: 'AI_SESSION_FORBIDDEN' });
    await chat.recordQuestion({ owner: 'alice', pagePath: '/', question: 'Alice confidential workflow' });
    assert.equal((await chat.listSuggestions({ owner: 'bob', pagePath: '/' })).some(item => item.question.includes('confidential')), false);
    assert.equal((await chat.listSuggestions({ owner: 'alice', pagePath: '/' })).some(item => item.question.includes('confidential')), true);
});

test('credential filtering is idempotent and preserves opaque model signatures', () => {
    const text = 'apiKey="synthetic-key"\nPASSWORD=synthetic-password\nAuthorization: Bearer synthetic-token\nCookie: a=secret; b=other\npostgres://test:synthetic-password@localhost/db';
    const safe = redactText(text);
    for (const secret of ['synthetic-key', 'synthetic-password', 'synthetic-token', 'a=secret', 'b=other']) assert.equal(safe.includes(secret), false);
    assert.equal(redactText(safe), safe);
    const structured = redactValue({ apiKey: 'sensitive', nested: { password_hash: 'hash' }, thoughtSignature: 'opaque-signature' });
    assert.equal(structured.apiKey, '[REDACTED]');
    assert.equal(structured.nested.password_hash, '[REDACTED]');
    assert.equal(structured.thoughtSignature, 'opaque-signature');
});

test('file tools block credential aliases and redact config reads, search, previews and diffs', async () => {
    const ctx = project();
    fs.writeFileSync(path.join(ctx.root, '.env'), 'API_KEY=synthetic-env-value\n');
    if (process.platform !== 'win32') {
        fs.symlinkSync('.env', path.join(ctx.root, 'alias.txt'));
        assert.equal((await tools.execute(ctx, 'read_file', { path: 'alias.txt' })).isError, true);
    }
    assert.equal((await tools.execute(ctx, 'edit_file', { path: '.env', oldString: 'API_KEY', newString: 'TOKEN' })).isError, true);
    fs.writeFileSync(path.join(ctx.root, 'config.json'), '{"apiKey":"synthetic-config-value","name":"before"}\n');
    const read = await tools.execute(ctx, 'read_file', { path: 'config.json' });
    const search = await tools.execute(ctx, 'search', { query: 'apiKey' });
    const preview = await tools.preview(ctx, 'edit_file', { path: 'config.json', oldString: 'before', newString: 'after' });
    const edited = await tools.execute(ctx, 'edit_file', { path: 'config.json', oldString: 'before', newString: 'after' });
    for (const value of [read, search, preview, edited, ctx.changeLog.diff('config.json')]) assert.equal(JSON.stringify(value).includes('synthetic-config-value'), false);
    assert.equal(fs.readFileSync(path.join(ctx.root, 'config.json'), 'utf8').includes('synthetic-config-value'), true, 'masking only affects observations, not the real file');
    const records = ctx.changeLog.toRecords();
    assert.equal(records[0].original, null, 'credential content is not written as a plaintext snapshot BLOB');
    assert.equal(AgentChangeLog.fromRecords(ctx.root, records).summary()[0].revertible, false);
});

test('known runtime keys are removed from unlabelled command output before the next model request', async () => {
    const ctx = project();
    const secret = 'synthetic-runtime-key-without-a-label';
    fs.writeFileSync(path.join(ctx.root, 'emit.js'), `process.stdout.write(${JSON.stringify(secret)});`);
    const session = manager.ensureSession({ agentSessionId: `redaction-${++sequence}`, user: { username: 'admin', role: 'admin' }, tenantId: 'default', root: ctx.root, permissionMode: 'full' });
    const events = [];
    let calls = 0;
    const client = { generateText: async options => {
        if (++calls === 1) return { toolCalls: [{ id: 'emit', name: 'run_command', args: { command: `"${process.execPath}" emit.js` } }] };
        assert.equal(JSON.stringify(options.messages).includes(secret), false);
        return { text: 'done' };
    } };
    await manager.runAgentTurn({ session, client, sensitiveValues: [secret], systemInstruction: '', historyMessages: [{ role: 'user', content: 'run it' }], write: event => {
        events.push(event);
        if (event.type === 'approval') manager.resolveApproval(event.id, 'allow', { username: 'admin', role: 'admin' }, 'default');
    }, signal: ctx.signal });
    assert.equal(JSON.stringify(events).includes(secret), false);
    assert.equal(JSON.stringify(await transcripts.load(session.id)).includes(secret), false);
});

test('snapshot replacement rolls back completely and refuses a different owner', async () => {
    const record = { path: 'keep.txt', meta: { originalExists: true }, original: Buffer.from('keep') };
    const values = { agentSessionId: 'atomic-snapshot-test', owner: 'default::alice', root: sandbox };
    await changesRepo.save({ ...values, records: [record] });
    await appDb.run("CREATE TRIGGER reject_test_snapshot BEFORE INSERT ON agent_change_snapshots WHEN NEW.path = 'fail.txt' BEGIN SELECT RAISE(ABORT, 'synthetic insert failure'); END");
    try {
        await assert.rejects(changesRepo.save({ ...values, records: [record, { ...record, path: 'fail.txt' }] }), /synthetic insert failure/);
        const saved = await changesRepo.load(values.agentSessionId);
        assert.deepEqual(saved.records.map(item => item.path), ['keep.txt']);
        await assert.rejects(changesRepo.save({ ...values, owner: 'default::bob', records: [] }), { code: 'AGENT_SESSION_FORBIDDEN' });
    } finally { await appDb.run('DROP TRIGGER reject_test_snapshot'); }
});

test('read-only Git inspection does not execute repository fsmonitor or diff helpers', { skip: process.platform === 'win32' }, async () => {
    const ctx = project();
    git(ctx.root, 'init', '-q');
    fs.writeFileSync(path.join(ctx.root, 'a.txt'), 'before');
    git(ctx.root, 'add', 'a.txt');
    git(ctx.root, 'commit', '-qm', 'initial');
    const hook = path.join(ctx.root, 'hook.sh');
    const marker = path.join(ctx.root, 'executed');
    fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    git(ctx.root, 'config', 'core.fsmonitor', hook);
    git(ctx.root, 'config', 'diff.external', hook);
    fs.writeFileSync(path.join(ctx.root, 'a.txt'), 'after');
    assert.equal((await workspaceChanges.listChanges(ctx.root)).git, true);
    assert.match((await workspaceChanges.diff(ctx.root, 'a.txt')).text, /after/);
    assert.equal(fs.existsSync(marker), false);
});

test('PR literal paths cannot expand to unrelated staged files', { skip: process.platform === 'win32' }, async () => {
    const ctx = project();
    git(ctx.root, 'init', '-q');
    fs.writeFileSync(path.join(ctx.root, 'base.txt'), 'base');
    git(ctx.root, 'add', 'base.txt');
    git(ctx.root, 'commit', '-qm', 'initial');
    fs.writeFileSync(path.join(ctx.root, 'user.txt'), 'user work');
    git(ctx.root, 'add', 'user.txt');
    fs.writeFileSync(path.join(ctx.root, ':(glob)*'), 'agent work');
    const plan = pr.buildPlan({ changes: [{ path: ':(glob)*', kind: 'create' }], title: 'literal path', branch: 'dragon-claw/literal-test' });
    for (const step of plan.steps.slice(0, 3)) {
        const result = await tools.execute(ctx, 'run_command', { command: step.command });
        assert.equal(result.isError, false, result.content);
    }
    assert.equal(git(ctx.root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), ':(glob)*');
    assert.equal(git(ctx.root, 'diff', '--cached', '--name-only'), 'user.txt');
});

test('automatic PR creation refuses a file containing earlier user changes before changing branches', async () => {
    const ctx = project();
    git(ctx.root, 'init', '-q');
    fs.writeFileSync(path.join(ctx.root, 'a.txt'), 'initial\n');
    git(ctx.root, 'add', 'a.txt');
    git(ctx.root, 'commit', '-qm', 'initial');
    const branch = git(ctx.root, 'branch', '--show-current');
    fs.appendFileSync(path.join(ctx.root, 'a.txt'), 'user work\n');
    await tools.execute(ctx, 'edit_file', { path: 'a.txt', oldString: 'initial', newString: 'agent change' });
    const plan = pr.buildPlan({ changes: ctx.changeLog.summary(), title: 'avoid user changes', branch: 'dragon-claw/blocked' });
    await assert.rejects(pr.runPrFlow({ session: ctx, plan }), { code: 'AGENT_PR_PREEXISTING_CHANGES' });
    assert.equal(git(ctx.root, 'branch', '--show-current'), branch);
    assert.match(fs.readFileSync(path.join(ctx.root, 'a.txt'), 'utf8'), /user work/);
});
