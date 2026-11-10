// 托管 Python 应用「开放给全员」：团队账号能用、能只读查看状态和代码，不能启停、修改，也看不到密钥。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const express = require('express');
const request = require('supertest');
const JSZip = require('jszip');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-sharing-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_BUILTIN_TOOLS_DIR = path.join(temp, 'builtins');
const tenant = require('../backend/models/tenant-context');
const repo = require('../backend/models/custom-tools-repository');
const runtime = require('../backend/models/hosted-apps/runtime');
const service = require('../backend/models/hosted-apps/service');
const appPackage = require('../backend/models/hosted-apps/package');
const proxy = require('../backend/models/hosted-apps/proxy');
const editor = require('../backend/models/hosted-apps/editor-service');

const admin = { username: 'admin', role: 'admin', isSuper: true, tenantId: 'default' };
const member = { username: 'alice', role: 'admin', isSuper: false, tenantId: 'alice' };
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use((req, _res, next) => {
    req.user = req.get('x-admin') === '1' ? admin : member;
    tenant.runWithTenant(req.user.tenantId, next);
});
app.use('/api/custom-tools', require('../backend/routes/custom-tools'));
app.use('/api/hosted-apps', require('../backend/routes/hosted-apps'));
const asAdmin = req => req.set('x-admin', '1');
const SLUG = 'shared-app';
const api = suffix => `/api/hosted-apps/${SLUG}${suffix}`;

async function zipOf(files) {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    return zip.generateAsync({ type: 'nodebuffer' });
}
const pythonZip = () => zipOf({ 'requirements.txt': 'uvicorn', 'app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n', '.env': 'API_KEY=top-secret\n', '.env.example': 'API_KEY=\n', 'certs/server.pem': 'PRIVATE' });

test.before(async () => {
    await tenant.runWithTenant('default', async () => {
        const inspected = await appPackage.inspectArchive(await pythonZip());
        const tool = await repo.createTool({ slug: SLUG, name: 'Shared App', htmlContent: service.launcherHtml(SLUG, 'Shared App') });
        assert.equal(tool.slug, SLUG);
        runtime.createApp(SLUG, inspected, { name: 'Shared App' });
        runtime.updateState(SLUG, { status: 'stopped', desired: 'stopped', env: { TOKEN: 'env-secret' }, gitRemote: 'https://bot:ghp_secret@github.com/acme/app.git' });
        const code = runtime.paths(SLUG).code;
        // 包检查可能不带 .env，直接落盘保证用例有密钥文件可测
        fs.writeFileSync(path.join(code, '.env'), 'API_KEY=top-secret\n');
        fs.mkdirSync(path.join(code, 'certs'), { recursive: true });
        fs.writeFileSync(path.join(code, 'certs', 'server.pem'), 'PRIVATE');
        fs.writeFileSync(path.join(code, '.gitignore'), '');
        const git = (...args) => execFileSync('git', args, { cwd: code, stdio: 'pipe' });
        git('init', '-q'); git('add', '-A', '-f');
        git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init with secrets');
    });
});

test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('team accounts cannot import Python app packages; super admin space still can reach the importer', async () => {
    const payload = { name: 'Evil', archiveName: 'evil.zip', archiveBase64: (await pythonZip()).toString('base64') };
    const denied = await request(app).post('/api/custom-tools').send(payload).expect(403);
    assert.match(denied.body.error, /超级管理员/);
    assert.deepEqual(await tenant.runWithTenant('alice', () => runtime.listApps()), [], 'nothing was created or started in the team space');
});

test('an unshared hosted app is invisible and unreachable for team accounts', async () => {
    assert.deepEqual((await request(app).get('/api/custom-tools')).body, []);
    for (const suffix of ['/launch', '/status', '/editor/tree', '/config']) await request(app).get(api(suffix)).expect(403);
});

test('sharing gives every team account the entry, use and read-only inspection — without secrets', async () => {
    await request(app).patch(`/api/custom-tools/${SLUG}/distribution`).send({ sharedAccess: true }).expect(403);
    await asAdmin(request(app).patch(`/api/custom-tools/${SLUG}/distribution`)).send({ sharedAccess: true }).expect(200);

    const listed = (await request(app).get('/api/custom-tools')).body;
    assert.equal(listed.length, 1, 'shared hosted apps appear without an install step');
    assert.equal(listed[0].hostedApp, true);
    assert.equal(listed[0].shared, true);

    const marketTools = (await request(app).get('/api/custom-tools/market/platform')).body.tools;
    const marketApp = marketTools.find(t => t.slug === SLUG);
    assert.ok(marketApp, 'shared hosted app is present in market');
    assert.equal(marketApp.hostedApp, true);
    assert.equal(marketApp.installed, true, 'shared hosted app is treated as already installed/added');

    const launch = (await request(app).get(api('/launch')).expect(200)).body.app;
    assert.equal(launch.isAdmin, false);
    assert.equal(launch.canView, true);
    assert.equal(launch.status, 'stopped');
    assert.equal(launch.entryUrl, undefined, 'viewers never trigger install or start');
    assert.equal(runtime.isActive(SLUG, 'default'), false);
    assert.ok(!('port' in launch) && !('pid' in launch));

    const status = (await request(app).get(api('/status')).expect(200)).body.app;
    assert.ok(!('port' in status) && !('pid' in status));

    const flat = items => items.flatMap(item => item.isDir ? [item.path, ...flat(item.children)] : [item.path]);
    const tree = flat((await request(app).get(api('/editor/tree')).expect(200)).body.tree);
    assert.ok(tree.includes('app/main.py') && tree.includes('.env.example'));
    assert.ok(!tree.includes('.env') && !tree.includes('certs/server.pem'));
    assert.ok(flat((await asAdmin(request(app).get(api('/editor/tree')))).body.tree).includes('.env'), 'super admin still sees everything');

    assert.match((await request(app).get(api('/editor/file')).query({ path: 'app/main.py' }).expect(200)).body.file.content, /FastAPI/);
    for (const secret of ['.env', 'certs/server.pem', './.env', 'app/../.env']) await request(app).get(api('/editor/file')).query({ path: secret }).expect(403);
    await request(app).get(api('/editor/file')).query({ path: '../state.json' }).expect(403);

    const config = (await request(app).get(api('/config')).expect(200)).body;
    assert.deepEqual(config.env, {});
    assert.equal((await asAdmin(request(app).get(api('/config')))).body.env.TOKEN, 'env-secret');

    const git = (await request(app).get(api('/editor/git/status')).expect(200)).body.status;
    assert.ok(!JSON.stringify(git).includes('ghp_secret'), 'remote credentials are stripped');
    const history = (await request(app).get(api('/editor/git/history')).expect(200)).body.history;
    assert.equal(history.length, 1);
    const diff = (await request(app).get(api('/editor/git/diff')).query({ commit: history[0].hash }).expect(200)).body.diff;
    assert.match(diff, /FastAPI/);
    assert.ok(!diff.includes('top-secret') && !diff.includes('PRIVATE'), 'secret files are left out of diffs');
    await request(app).get(api('/editor/git/diff')).query({ commit: history[0].hash, file: '.env' }).expect(403);
    await request(app).get(api('/editor/git/diff')).query({ commit: '--output=/tmp/x' }).expect(400);
});

test('every operation that changes or exposes the running app stays super admin only', async () => {
    const denied = [
        ['post', '/start'], ['post', '/stop'], ['post', '/restart'], ['post', '/reinstall'], ['post', '/package'], ['post', '/preview'],
        ['put', '/config'], ['get', '/logs'], ['get', '/logs/dates'], ['get', '/logs/export'], ['get', '/database-script'], ['post', '/database-script'],
        ['put', '/editor/file'], ['post', '/editor/create'], ['post', '/editor/delete'], ['post', '/editor/rename'],
        ['post', '/editor/git/commit'], ['post', '/editor/git/revert'], ['post', '/editor/git/remote'], ['post', '/editor/git/push'], ['post', '/editor/git/pull']
    ];
    for (const [method, suffix] of denied) {
        const response = await request(app)[method](api(suffix)).send({ path: 'app/main.py', content: 'hacked', remoteUrl: 'https://evil', commitHash: 'abc1234' });
        assert.equal(response.status, 403, `${method.toUpperCase()} ${suffix}`);
    }
    await request(app).get('/api/hosted-apps/settings').expect(403);
    await request(app).put('/api/hosted-apps/settings').send({}).expect(403);
    await request(app).post('/api/hosted-apps/preview').send({}).expect(403);
    const code = await tenant.runWithTenant('default', () => fs.readFileSync(path.join(runtime.paths(SLUG).code, 'app', 'main.py'), 'utf8'));
    assert.match(code, /FastAPI/);

    // 团队账号不能借「更新」「导出」「删除」动到应用本体
    await request(app).get(`/api/custom-tools/${SLUG}/export`).expect(403);
    await request(app).post('/api/custom-tools').send({ updateSlug: SLUG, htmlContent: '<html><body>fork</body></html>' }).expect(403);
    await request(app).patch(`/api/custom-tools/${SLUG}/name`).send({ name: 'Mine' }).expect(403);
    assert.equal((await request(app).get('/api/custom-tools')).body[0].name, 'Shared App');
    await request(app).delete(`/api/custom-tools/${SLUG}`).expect(200); // 只是从自己的首页隐藏
    assert.equal(await tenant.runWithTenant('default', () => runtime.exists(SLUG)), true);
    await request(app).get(api('/launch')).expect(403);
});

test('access links for viewers carry the member role and their own team', () => {
    const { token } = proxy.issueToken({ tenantId: 'default', slug: SLUG, username: 'alice', role: 'readonly', userTenantId: 'alice' });
    const claims = proxy.verifyToken(token);
    assert.deepEqual([claims.t, claims.ut, claims.r], ['default', 'alice', 'readonly']);
    const headers = proxy.forwardHeaders({ headers: { 'x-platform-user-tenant': 'default', cookie: 'a=b' }, socket: {} }, { port: 1, prefix: '/apps/x', claims, secret: 's3' });
    assert.equal(headers['x-platform-tenant'], 'default');
    assert.equal(headers['x-platform-user-tenant'], 'alice', 'a client cannot spoof its team');
    const expected = require('node:crypto').createHmac('sha256', 's3').update(`alice\nreadonly\ndefault\nalice\n${headers['x-platform-timestamp']}`).digest('hex');
    assert.equal(headers['x-platform-team-signature'], expected);
    const own = proxy.forwardHeaders({ headers: {}, socket: {} }, { port: 1, prefix: '/apps/x', claims: { t: 'default', u: 'admin', r: 'admin' }, secret: 's3' });
    assert.equal(own['x-platform-user-tenant'], 'default');
    assert.equal(editor.isSecretPath('config/.env.production'), true);
    assert.equal(editor.isSecretPath('.env.example'), false);
});

test('revoking sharing closes everything again', async () => {
    await asAdmin(request(app).patch(`/api/custom-tools/${SLUG}/distribution`)).send({ sharedAccess: false }).expect(200);
    for (const suffix of ['/launch', '/status', '/editor/tree', '/editor/file?path=app/main.py']) await request(app).get(api(suffix)).expect(403);
});
