const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-agent-pr-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const prService = require('../backend/models/agent-pr-service');
const manager = require('../backend/models/agent-run-manager');
const tools = require('../backend/models/agent-tools-service');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');

const IS_WIN = process.platform === 'win32';
const user = { username: 'admin', role: 'admin' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).toString().trim();
let hasGit = true;
try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { hasGit = false; }

// 假 gh：auth status 返回 0，pr create 打印一个 PR 地址，其余打印版本
const binDir = path.join(sandbox, 'bin');
fs.mkdirSync(binDir, { recursive: true });
if (IS_WIN) {
    fs.writeFileSync(path.join(binDir, 'gh.cmd'), '@echo off\r\nif "%1"=="--version" echo gh version 9.9.9-test\r\nif "%1"=="auth" exit /b 0\r\nif "%1"=="pr" echo https://github.com/example/repo/pull/42\r\nexit /b 0\r\n');
} else {
    fs.writeFileSync(path.join(binDir, 'gh'), '#!/bin/sh\ncase "$1" in\n  --version) echo "gh version 9.9.9-test";;\n  auth) exit 0;;\n  pr) echo "Creating pull request for $4 into main" >&2; echo "https://github.com/example/repo/pull/42";;\nesac\nexit 0\n', { mode: 0o755 });
}
const originalPath = process.env.PATH;

function makeRepo(name) {
    const repo = path.join(sandbox, name);
    const bare = path.join(sandbox, `${name}.git`);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 't@x');
    git(repo, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'README.md'), 'Hello\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    git(sandbox, 'init', '-q', '--bare', bare);
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    return { repo, bare };
}

test.before(() => { process.env.PATH = `${binDir}${path.delimiter}${originalPath}`; });
test.after(async () => {
    process.env.PATH = originalPath;
    await tenantPool.closeAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('buildPlan quotes arguments, sanitizes the branch and only stages session files', () => {
    const changes = [{ path: 'src/a b.js', kind: 'modify' }, { path: 'docs/new.md', kind: 'create' }, { path: 'moved.txt', kind: 'rename', from: 'old.txt' }];
    const plan = prService.buildPlan({ changes, title: "Fix it's \"quoted\"\nsecond line", body: '', branch: ' feat/My Branch..x ' });
    assert.equal(plan.branch, 'feat/My-Branch.x');
    assert.deepEqual(plan.paths, ['src/a b.js', 'docs/new.md', 'old.txt', 'moved.txt']);
    assert.deepEqual(plan.steps.map(item => item.step), ['branch', 'add', 'commit', 'push', 'create']);
    assert.equal(plan.title, 'Fix it\'s "quoted" second line');
    const add = plan.steps[1].command;
    assert.match(add, IS_WIN ? /git add -A -- "src\/a b\.js" docs\/new\.md old\.txt moved\.txt/ : /git add -A -- 'src\/a b\.js' docs\/new\.md old\.txt moved\.txt/);
    assert.match(plan.steps[4].command, /^gh pr create --head feat\/My-Branch\.x --title /);
    assert.match(plan.body, /- src\/a b\.js/);
    assert.throws(() => prService.buildPlan({ changes, title: '   ' }), /标题/);
    assert.throws(() => prService.buildPlan({ changes: [], title: 'x' }), /改动/);
    assert.match(prService.suggestBranchName([{ path: 'src/Index.js' }]), /^dragon-claw\/\d{8}-\d{4}-index$/);
    assert.equal(prService.sanitizeBranch('', 'fallback'), 'fallback');
    assert.equal(prService.quoteArg(IS_WIN ? 'a"b' : "a'b"), IS_WIN ? '"a""b"' : "'a'\\''b'");
    assert.equal(prService.extractPrUrl('done\nhttps://github.com/o/r/pull/7\n'), 'https://github.com/o/r/pull/7');
});

test('preflight distinguishes non-git, missing remote and ready repositories', async t => {
    if (!hasGit) return t.skip('git not installed');
    const plain = fs.mkdtempSync(path.join(sandbox, 'plain-'));
    const notGit = await prService.preflight(plain, { changes: [{ path: 'a' }] });
    assert.deepEqual([notGit.ok, notGit.reason, notGit.isGit, notGit.hasGh], [false, 'NOT_GIT', false, true]);

    const { repo } = makeRepo('ready');
    const ready = await prService.preflight(repo, { changes: [{ path: 'README.md' }] });
    assert.deepEqual([ready.ok, ready.reason, ready.branch, ready.hasRemote, ready.ghAuth], [true, 'OK', 'main', true, true]);
    assert.equal(ready.ghVersion, '9.9.9-test');
    assert.equal(ready.ghCommand, 'gh', 'gh found on PATH is referenced by its short name');
    const noChanges = await prService.preflight(repo, { changes: [] });
    assert.equal(noChanges.reason, 'NO_CHANGES');

    git(repo, 'remote', 'remove', 'origin');
    const noRemote = await prService.preflight(repo, { changes: [{ path: 'README.md' }] });
    assert.equal(noRemote.reason, 'NO_REMOTE');

    process.env.PATH = originalPath.split(path.delimiter).filter(dir => !fs.existsSync(path.join(dir, IS_WIN ? 'gh.exe' : 'gh'))).join(path.delimiter);
    const savedCandidates = prService._internal.GH_CANDIDATES.splice(0);
    try {
        const noGh = await prService.preflight(repo, { changes: [{ path: 'README.md' }] });
        assert.deepEqual([noGh.reason, noGh.hasGh], ['NO_GH', false]);
    } finally {
        prService._internal.GH_CANDIDATES.push(...savedCandidates);
        process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
    }
});

test('runPrFlow commits only the session changes, pushes, calls gh and reports the PR url', async t => {
    if (!hasGit) return t.skip('git not installed');
    const { repo, bare } = makeRepo('flow');
    const session = manager.ensureSession({ agentSessionId: 'pr-flow-session-1', user, tenantId: 'default', root: repo, permissionMode: 'full' });
    const ctx = { root: session.root, changeLog: session.changeLog, signal: new AbortController().signal };
    await tools.execute(ctx, 'edit_file', { path: 'README.md', oldString: 'Hello', newString: 'Hi' });
    await tools.execute(ctx, 'write_file', { path: 'notes/todo.md', content: '- a\n' });
    fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'not from this session\n');
    fs.writeFileSync(path.join(repo, 'staged.txt'), 'the user staged this earlier\n');
    git(repo, 'add', 'staged.txt');

    const changes = session.changeLog.summary();
    const plan = prService.buildPlan({ changes, title: 'Session edits', body: 'body text', branch: 'dragon-claw/test-flow' });
    const events = [];
    const run = manager.beginRun(session, event => events.push(event), new AbortController().signal);
    let result;
    try {
        result = await prService.runPrFlow({ session, run, plan, write: run.write, signal: run.signal, classify: manager.classifyDecision, requestApproval: manager.requestApproval });
    } finally {
        run.end();
    }
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.url, 'https://github.com/example/repo/pull/42');
    assert.equal(result.branch, 'dragon-claw/test-flow');
    assert.deepEqual(events.filter(event => event.type === 'pr_step' && event.status === 'done').map(event => event.step), ['branch', 'add', 'commit', 'push', 'create']);
    assert.equal(events.some(event => event.type === 'approval'), false, 'full mode never prompts');
    assert.equal(events.filter(event => event.type === 'tool_start').length, 5);
    assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'dragon-claw/test-flow');
    assert.equal(git(repo, 'show', '--stat', '--format=%s', 'HEAD').split('\n')[0], 'Session edits');
    const committed = git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n');
    assert.deepEqual(committed.sort(), ['README.md', 'notes/todo.md']);
    assert.match(git(repo, 'status', '--porcelain'), /\?\? unrelated\.txt/, 'files outside the session stay uncommitted');
    assert.match(git(repo, 'status', '--porcelain'), /^A  staged\.txt$/m, 'a file the user staged beforehand stays staged and is not committed');
    assert.equal(git(bare, 'rev-parse', 'refs/heads/dragon-claw/test-flow'), git(repo, 'rev-parse', 'HEAD'), 'branch was pushed');
    assert.equal(manager.readGitBranch(repo), 'dragon-claw/test-flow');
});

test('runPrFlow asks per step in ask mode, stops when denied and surfaces failures', async t => {
    if (!hasGit) return t.skip('git not installed');
    const { repo } = makeRepo('deny');
    const session = manager.ensureSession({ agentSessionId: 'pr-flow-session-2', user, tenantId: 'default', root: repo, permissionMode: 'ask' });
    const ctx = { root: session.root, changeLog: session.changeLog, signal: new AbortController().signal };
    await tools.execute(ctx, 'edit_file', { path: 'README.md', oldString: 'Hello', newString: 'Yo' });
    const plan = prService.buildPlan({ changes: session.changeLog.summary(), title: 'Denied', branch: 'dragon-claw/denied' });

    const events = [];
    const run = manager.beginRun(session, event => events.push(event), new AbortController().signal);
    const flow = prService.runPrFlow({ session, run, plan, write: run.write, signal: run.signal, classify: manager.classifyDecision, requestApproval: manager.requestApproval });
    const first = await waitFor(() => events.find(event => event.type === 'approval'));
    assert.equal(first.tool, 'run_command');
    assert.match(first.preview.command, /git checkout -b dragon-claw\/denied/);
    manager.resolveApproval(first.id, 'allow', user, 'default');
    const second = await waitFor(() => events.filter(event => event.type === 'approval')[1]);
    assert.match(second.preview.command, /git add -A -- README\.md/);
    manager.resolveApproval(second.id, 'deny', user, 'default');
    const result = await flow;
    run.end();
    assert.deepEqual([result.ok, result.failedStep, result.reason], [false, 'add', 'denied']);
    assert.equal(events.filter(event => event.type === 'pr_step' && event.status === 'denied').length, 1);
    assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'dragon-claw/denied', 'first step ran before the denial');
    assert.equal(git(repo, 'diff', '--cached', '--name-only'), '', 'nothing staged after denial');
    assert.equal(git(repo, 'diff', '--name-only'), 'README.md');

    // 分支已存在 → 第一步失败并停止；「总是允许」后不再询问
    git(repo, 'checkout', '-q', 'main');
    const again = prService.buildPlan({ changes: session.changeLog.summary(), title: 'Again', branch: 'dragon-claw/denied' });
    const events2 = [];
    const run2 = manager.beginRun(session, event => events2.push(event), new AbortController().signal);
    const flow2 = prService.runPrFlow({ session, run: run2, plan: again, write: run2.write, signal: run2.signal, classify: manager.classifyDecision, requestApproval: manager.requestApproval });
    const approval = await waitFor(() => events2.find(event => event.type === 'approval'));
    manager.resolveApproval(approval.id, 'always', user, 'default');
    const failed = await flow2;
    run2.end();
    assert.deepEqual([failed.ok, failed.failedStep, failed.reason], [false, 'branch', 'failed']);
    const failedStep = events2.find(event => event.type === 'pr_step' && event.status === 'failed');
    assert.match(failedStep.output, /already exists/i);
    assert.equal(session.alwaysAllow.has('run_command'), true);
    assert.equal(manager.classifyDecision(session, 'run_command'), 'allow');
});

async function waitFor(check, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        const value = check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('timed out waiting for condition');
}
