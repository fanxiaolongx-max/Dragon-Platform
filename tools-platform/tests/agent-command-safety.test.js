const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-command-safety-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const { assessCommand } = require('../backend/models/agent-command-guard');
const tools = require('../backend/models/agent-tools-service');
const manager = require('../backend/models/agent-run-manager');
const { AgentChangeLog } = require('../backend/models/agent-change-log');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

test.after(async () => {
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const IS_WIN = process.platform === 'win32';
const admin = { username: 'admin', role: 'admin' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
let counter = 0;
const sessionId = () => `safety-${process.pid}-${counter += 1}`;

function gitRepo(name) {
    const repo = path.join(sandbox, name);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, 'clean.txt'), 'clean\n');
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'committed\n');
    fs.writeFileSync(path.join(repo, 'gone.txt'), 'will be deleted\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'edited by the user before the command\n');
    return repo;
}

test('commands that reach outside the folder, the home directory or secret files are flagged', () => {
    const root = '/Users/someone/project';
    const flagged = ['cat ../other/file.txt', 'cat ~/.ssh/id_rsa', 'ls /etc', 'cat .env', 'cat config/.env.local', 'echo $HOME', 'cd .. && ls', 'rm -rf /'];
    for (const command of flagged) assert.equal(assessCommand(command, root, { platform: 'darwin', home: '/Users/someone' }).risky, true, command);
    const safe = ['npm test', 'git status --short', 'echo hi > /dev/null', 'node /usr/local/bin/tool', 'cp a /tmp/b', 'grep -r foo src/ --include=*.js', 'ls ./sub/../file', 'curl https://example.com/a/../b'];
    for (const command of safe) assert.equal(assessCommand(command, root, { platform: 'darwin', home: '/Users/someone' }).risky, false, command);
    const win = assessCommand('type C:\\Users\\someone\\secret.txt', 'C:\\work\\project', { platform: 'win32', home: 'C:\\Users\\someone' });
    assert.equal(win.risky, true);
    assert.match(win.reasons[0], /工作目录之外/);
});

test('risky commands always ask, even in full access or after "always allow"', () => {
    const root = gitRepo('classify');
    const session = manager.ensureSession({ agentSessionId: sessionId(), user: admin, tenantId: 'default', root, permissionMode: 'full' });
    assert.equal(manager.classifyDecision(session, 'run_command', { command: 'npm test' }), 'allow');
    assert.equal(manager.classifyDecision(session, 'run_command', { command: 'cat ../secrets.txt' }), 'ask');
    session.alwaysAllow.add('run_command');
    assert.equal(manager.classifyDecision(session, 'run_command', { command: 'cat .env' }), 'ask');
    assert.equal(manager.classifyDecision(session, 'run_command', { command: 'ls' }), 'allow');
});

test('file changes made by a command in a git repo are recorded and can be undone', { skip: IS_WIN }, async () => {
    const repo = gitRepo('tracked');
    const ctx = { root: repo, changeLog: new AgentChangeLog(repo), signal: new AbortController().signal };
    const result = await tools.execute(ctx, 'run_command', { command: "printf 'by command\\n' > clean.txt && printf 'more\\n' >> dirty.txt && printf 'new\\n' > created.txt && rm gone.txt" });
    assert.equal(result.isError, false, result.content);
    assert.match(result.content, /命令改动了 4 个文件/);
    const byPath = Object.fromEntries(ctx.changeLog.summary().map(item => [item.path, item]));
    assert.deepEqual(Object.keys(byPath).sort(), ['clean.txt', 'created.txt', 'dirty.txt', 'gone.txt']);
    assert.ok(Object.values(byPath).every(item => item.source === 'command' && item.revertible), JSON.stringify(byPath));
    assert.equal(byPath['created.txt'].kind, 'create');
    assert.equal(byPath['gone.txt'].kind, 'delete');
    for (const file of Object.keys(byPath)) ctx.changeLog.revert(file);
    assert.equal(fs.readFileSync(path.join(repo, 'clean.txt'), 'utf8'), 'clean\n');
    assert.equal(fs.readFileSync(path.join(repo, 'dirty.txt'), 'utf8'), 'edited by the user before the command\n', 'restored to the pre-command state, not to HEAD');
    assert.equal(fs.existsSync(path.join(repo, 'created.txt')), false);
    assert.equal(fs.readFileSync(path.join(repo, 'gone.txt'), 'utf8'), 'will be deleted\n');
    const quiet = await tools.execute(ctx, 'run_command', { command: 'git status --short > /dev/null' });
    assert.equal(quiet.changes, undefined, 'read-only commands record nothing');
});

test('commands in a plain folder are tracked too', { skip: IS_WIN }, async () => {
    const root = path.join(sandbox, 'plain');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
    const ctx = { root, changeLog: new AgentChangeLog(root), signal: new AbortController().signal };
    await tools.execute(ctx, 'run_command', { command: "printf 'two\\n' > a.txt" });
    const entry = ctx.changeLog.summary().find(item => item.path === 'a.txt');
    assert.equal(entry.revertible, true);
    ctx.changeLog.revert('a.txt');
    assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one\n');
});

test('undo snapshots survive a restart and undo refuses to overwrite later edits unless forced', async () => {
    const repo = gitRepo('persist');
    const id = sessionId();
    const session = manager.ensureSession({ agentSessionId: id, user: admin, tenantId: 'default', root: repo, permissionMode: 'full' });
    const client = {
        model: 'm',
        calls: 0,
        async generateText() {
            this.calls += 1;
            if (this.calls === 1) return { text: '', toolCalls: [{ id: 'e1', name: 'edit_file', args: { path: 'clean.txt', oldString: 'clean', newString: 'agent edit' } }], usage: {} };
            return { text: 'done', toolCalls: [], usage: {} };
        }
    };
    await manager.runAgentTurn({ session, client, systemInstruction: 'S', historyMessages: [{ role: 'user', content: 'edit' }], write: () => {}, signal: new AbortController().signal });
    manager._internal.sessions.delete(id); // 模拟重启

    const restored = await manager.restoreSession(id, admin, 'default', session.root);
    assert.ok(restored, 'session rebuilt from the database');
    const entry = restored.changeLog.summary().find(item => item.path === 'clean.txt');
    assert.equal(entry.revertible, true);

    fs.appendFileSync(path.join(repo, 'clean.txt'), 'edited by hand afterwards\n');
    assert.throws(() => restored.changeLog.revert('clean.txt'), error => error.code === 'AGENT_CHANGE_CONFLICT' && error.statusCode === 409);
    restored.changeLog.revert('clean.txt', { force: true });
    assert.equal(fs.readFileSync(path.join(repo, 'clean.txt'), 'utf8'), 'clean\n');
    const other = { username: 'other', role: 'admin' };
    await assert.rejects(manager.restoreSession(id, other, 'default', session.root), error => error.code === 'AGENT_SESSION_FORBIDDEN');
    manager._internal.sessions.delete(id);
    assert.equal(await manager.restoreSession(id, other, 'default', session.root), null, 'another user cannot rebuild it from the database');
});
