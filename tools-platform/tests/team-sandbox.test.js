// 团队边界与命令沙箱：工作目录只能在团队空间内；团队账号的命令读不到服务器其他目录、写不出团队空间，但能联网。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'team-sandbox-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
fs.mkdirSync(process.env.TOOLS_DATA_DIR, { recursive: true });

const tenant = require('../backend/models/tenant-context');
const boundary = require('../backend/models/team-boundary');
const sandbox = require('../backend/models/tenant-sandbox');
const runManager = require('../backend/models/agent-run-manager');
const tools = require('../backend/models/agent-tools-service');

const team = { username: 'east', role: 'admin', isSuper: false };
const superAdmin = { username: 'admin', role: 'admin', isSuper: true };

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('team accounts are confined to their own workspace', () => {
    assert.equal(boundary.isConfined(team, 'east'), true);
    assert.equal(boundary.isConfined(superAdmin, 'east'), false, 'super admin troubleshooting a team is not confined');
    assert.equal(boundary.isConfined({ username: 'x', role: 'admin' }, 'default'), false);

    const workspace = boundary.workspaceRoot('east');
    fs.mkdirSync(path.join(workspace, 'proj'), { recursive: true });
    assert.equal(boundary.resolveUserPath(team, 'east', '~'), workspace);
    assert.equal(boundary.resolveUserPath(team, 'east', 'proj'), path.join(workspace, 'proj'));
    assert.doesNotThrow(() => boundary.assertAllowed(team, 'east', path.join(workspace, 'proj')));
    for (const outside of [os.homedir(), tenant.getDataDir('east'), boundary.workspaceRoot('west'), path.join(workspace, '..', 'home', '..', '..')]) {
        assert.throws(() => boundary.assertAllowed(team, 'east', outside), { code: 'TEAM_BOUNDARY' }, outside);
    }
    // 软链接逃逸
    fs.symlinkSync(os.homedir(), path.join(workspace, 'escape'));
    assert.throws(() => boundary.assertAllowed(team, 'east', path.join(workspace, 'escape')), { code: 'TEAM_BOUNDARY' });

    assert.throws(() => runManager.ensureSession({ agentSessionId: 'sess-outside-1', user: team, tenantId: 'east', root: os.homedir() }), { code: 'TEAM_BOUNDARY' });
    const session = runManager.ensureSession({ agentSessionId: 'sess-inside-1', user: team, tenantId: 'east', root: path.join(workspace, 'proj'), permissionMode: 'full' });
    assert.equal(session.confined, true);
    // 团队没选目录的对话：默认就在团队工作目录里，可以跑命令
    const teamDefault = runManager.ensureTeamDefaultSession({ user: team, tenantId: 'east', chatSessionId: 'c0' });
    assert.equal(teamDefault.root, workspace);
    assert.equal(teamDefault.confined, true);
    assert.equal(teamDefault.teamDefault, true);
    const scratch = runManager.ensureScratchSession({ user: team, tenantId: 'east', chatSessionId: 'c1' });
    assert.ok(boundary.isAllowedPath('east', scratch.root), 'scratch space stays inside the team');
});

test('file tools stay inside the team even with full access', async () => {
    const root = path.join(boundary.workspaceRoot('east'), 'proj');
    const ctx = { root, permissionMode: 'full', confined: true, tenantId: 'east', sensitiveValues: [] };
    const outside = await tools.execute(ctx, 'read_file', { path: path.join(process.env.TOOLS_DATA_DIR, 'tenants', 'east', 'tools.db') });
    assert.equal(outside.isError, true);
    const free = await tools.execute({ ...ctx, confined: false }, 'list_directory', { path: os.tmpdir() });
    assert.notEqual(free.isError, true, 'unconfined full access may leave the root');
});

test('commands run inside the team sandbox', { skip: !sandbox.status().available && `sandbox unavailable: ${sandbox.status().reason}` }, async () => {
    const root = path.join(boundary.workspaceRoot('east'), 'proj');
    boundary.workspaceRoot('west');
    const ctx = { root, permissionMode: 'full', confined: true, tenantId: 'east', sensitiveValues: [], fullResults: true };
    const run = async command => (await tools.execute(ctx, 'run_command', { command })).content;

    assert.match(await run('echo hi > a.txt && cat a.txt && echo "$HOME"'), new RegExp(`hi[\\s\\S]*${tenant.getHomeDir('east').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(await run('echo cfg > "$HOME/.cfg" && cat "$HOME/.cfg"'), /cfg/);
    assert.doesNotMatch(await run(`cat "${path.join(__dirname, '..', 'package.json')}"`), /"name"/, 'project source is unreadable');
    assert.doesNotMatch(await run(`ls "${tenant.getDataDir('east')}"`), /tools\.db/, 'team database directory is unreadable');
    assert.doesNotMatch(await run(`cat "${path.join(tenant.getDataDir('east'), 'tools.db')}" 2>&1`), /SQLite format/, 'team database is unreadable');
    await run(`echo x > "${path.join(boundary.workspaceRoot('west'), 'x.txt')}"`);
    assert.equal(fs.existsSync(path.join(boundary.workspaceRoot('west'), 'x.txt')), false, 'cannot write into another team');
    fs.writeFileSync(path.join(boundary.workspaceRoot('west'), 'secret.txt'), 'WEST-SECRET');
    assert.doesNotMatch(await run(`ls "${boundary.workspaceRoot('west')}"; cat "${path.join(boundary.workspaceRoot('west'), 'secret.txt')}"`), /WEST-SECRET/, 'other teams are neither listable nor readable');
    assert.doesNotMatch(await run(`cd "${boundary.workspaceRoot('west')}" 2>/dev/null; echo "NOW=$(pwd)"`), /NOW=[^\n]*tenants\/west/, 'cannot change into another team');
    const outsideFile = path.join(os.tmpdir(), `team-sandbox-escape-${process.pid}.txt`);
    await run(`echo x > "${outsideFile}"`);
    assert.equal(fs.existsSync(outsideFile), false, 'cannot write outside the team');
    // 服务端对团队仓库的 git 也在沙箱里：仓库配置里的命令跑不出团队空间
    const marker = path.join(os.tmpdir(), `team-sandbox-git-${process.pid}.txt`);
    await run(`git init -q repo && git -C repo config core.fsmonitor "touch ${marker}"`);
    await new Promise(resolve => sandbox.execFileAware('git', ['status'], { cwd: path.join(root, 'repo') }, () => resolve()));
    assert.equal(fs.existsSync(marker), false, 'repo-controlled git config cannot escape');
});
