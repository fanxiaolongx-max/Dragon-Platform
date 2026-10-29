const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-apps-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
fs.mkdirSync(process.env.TOOLS_DATA_DIR, { recursive: true });
const JSZip = require('jszip');
const sqlite3 = require('sqlite3');
const appPackage = require('../backend/models/hosted-apps/package');
const proxy = require('../backend/models/hosted-apps/proxy');
const dataApi = require('../backend/models/hosted-apps/data-api');
const runtime = require('../backend/models/hosted-apps/runtime');
const service = require('../backend/models/hosted-apps/service');
const tenant = require('../backend/models/tenant-context');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

async function zipOf(files) {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files)) zip.file(name, content);
    return zip.generateAsync({ type: 'nodebuffer' });
}

test('AiOps-style packages are recognized with their factory entry, nested root, version and offline wheels', async () => {
    const archive = await zipOf({
        'new_report_src/run.py': 'import uvicorn\nuvicorn.run("app.main:create_app", factory=True, host="0.0.0.0", port=5600)\n',
        'new_report_src/AiOps-Report.version': '1.0.1\n',
        'new_report_src/requirements.txt': 'fastapi\nuvicorn\n',
        'new_report_src/app/__init__.py': '',
        'new_report_src/app/main.py': 'from fastapi import FastAPI\n\ndef create_app():\n    return FastAPI()\n',
        'new_report_src/static/api_test.html': '<html></html>',
        'new_report_src/wheels/fastapi-0.1-py3-none-any.whl': 'x',
        'new_report_src/logs/report_2026-10-27.log': 'skip me',
        'new_report_src/app/__pycache__/main.cpython-313.pyc': 'skip me',
        '__MACOSX/._run.py': 'x'
    });
    const inspected = await appPackage.inspectArchive(archive);
    assert.equal(inspected.root, 'new_report_src');
    assert.deepEqual({ ...inspected.config, description: undefined }, { name: 'AiOps-Report', version: '1.0.1', entry: 'app.main:create_app', factory: true,
        interface: 'asgi', healthPath: '/', description: undefined });
    assert.equal(inspected.offlineWheels, 1);
    const names = inspected.files.map(([name]) => name);
    assert.ok(names.includes('static/api_test.html') && names.includes('run.py'));
    assert.ok(!names.some(name => name.startsWith('logs/') || name.endsWith('.pyc')), 'logs and caches are not hosted');
});

test('entry detection covers FastAPI instances, Flask (WSGI) and explicit manifests; unsafe or HTML-only packages are rejected', async () => {
    assert.deepEqual(appPackage.detectEntry(file => file === 'main.py' ? 'from fastapi import FastAPI\napi = FastAPI(title="x")\n' : ''),
        { entry: 'main:api', factory: false, interface: 'asgi' });
    assert.deepEqual(appPackage.detectEntry(file => file === 'app.py' ? 'from flask import Flask\napp = Flask(__name__)\n' : ''),
        { entry: 'app:app', factory: false, interface: 'wsgi' });
    const manifest = await appPackage.inspectArchive(await zipOf({ 'requirements.txt': 'uvicorn', 'platform-app.json': '{"entry":"svc.web:build","factory":true,"healthPath":"/api/healthz","name":"Svc"}', 'svc/web.py': '' }));
    assert.equal(manifest.config.entry, 'svc.web:build');
    assert.equal(manifest.config.healthPath, '/api/healthz');
    assert.equal(appPackage.looksLikePythonApp(['index.html', 'tools/requirements.txt', 'tools/main.py']), false, 'web tool with nested helper script stays an HTML tool');
    await assert.rejects(appPackage.inspectArchive(await zipOf({ 'requirements.txt': 'x', 'main.py': 'print(1)' })), /未找到应用入口/);
    await assert.rejects(appPackage.inspectArchive(await zipOf({ 'requirements.txt': 'x', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()', '_platform_host.py': '' })), /保留/);
    await assert.rejects(appPackage.inspectArchive(await zipOf({ 'requirements.txt': 'x', 'platform-app.json': '{"entry":"os:system; rm -rf /"}' })), /entry/);
    assert.equal(await service.isPythonPayload({ archiveBase64: (await zipOf({ 'index.html': '<html></html>' })).toString('base64'), archiveName: 'tool.zip' }), false);
    assert.equal(await service.isPythonPayload({ archiveBase64: (await zipOf({ 'requirements.txt': 'x', 'main.py': '' })).toString('base64'), archiveName: 'app.zip' }), true);
});

test('access tokens bind tenant, app and user, expire, and resist tampering; proxy helpers keep apps under their prefix', () => {
    const now = Date.now();
    const { token } = proxy.issueToken({ tenantId: 'default', slug: 'demo', username: 'alice', role: 'user' }, now);
    assert.deepEqual(proxy.verifyToken(token, now), { t: 'default', s: 'demo', u: 'alice', r: 'user', e: Math.floor(now / 1000) + 12 * 3600 });
    assert.equal(proxy.verifyToken(token, now + 13 * 3600 * 1000), null);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'default', s: 'demo', u: 'admin', r: 'admin', e: 9999999999 })).toString('base64url');
    assert.equal(proxy.verifyToken(`${forged}.${signature}`, now), null);
    assert.equal(proxy.verifyToken(`${payload}.${signature.slice(1)}x`, now), null);
    const prefix = '/apps/demo/~t.s';
    assert.equal(proxy.rewriteLocation('/docs', 5600, prefix, '/api/x'), `${prefix}/docs`);
    assert.equal(proxy.rewriteLocation('http://127.0.0.1:5600/api/healthz?a=1', 5600, prefix, '/'), `${prefix}/api/healthz?a=1`);
    assert.equal(proxy.rewriteLocation(`${prefix}/already`, 5600, prefix, '/'), `${prefix}/already`);
    assert.equal(proxy.rewriteLocation('https://example.com/out', 5600, prefix, '/'), 'https://example.com/out');
    assert.match(proxy.injectShim('<!doctype html><html><head><title>x</title></head></html>', prefix), /<head><script src="\/apps\/demo\/~t\.s\/__platform\/shim\.js"><\/script><title>/);
    assert.doesNotThrow(() => new Function(proxy.SHIM), 'shim is valid JavaScript');
    assert.match(proxy.SANDBOX, /^sandbox allow-scripts/);
    assert.doesNotMatch(proxy.SANDBOX, /allow-same-origin/);
});

test('SQL guards keep platform reads read-only and stop app writes from escaping their own database', async () => {
    assert.throws(() => dataApi.assertRead('DELETE FROM t'), /SELECT/);
    assert.throws(() => dataApi.assertRead('SELECT 1; DROP TABLE t'), /一条/);
    assert.throws(() => dataApi.assertRead("SELECT load_extension('x')"), /LOAD_EXTENSION/);
    assert.equal(dataApi.assertRead("SELECT ';' AS semi -- trailing comment"), "SELECT ';' AS semi -- trailing comment");
    assert.equal(dataApi.assertAppWrite('CREATE TABLE IF NOT EXISTS t (id INTEGER)').kind, 'create');
    assert.throws(() => dataApi.assertAppWrite("ATTACH DATABASE '/tmp/x.db' AS x"), /写入接口|ATTACH/);
    assert.throws(() => dataApi.assertAppWrite("CREATE TRIGGER x AFTER INSERT ON t BEGIN SELECT 1; END"), /一条/);
    assert.throws(() => dataApi.assertAppWrite('PRAGMA writable_schema = 1'), /写入接口/);
    assert.throws(() => dataApi.assertAppWrite('CREATE VIRTUAL TABLE v USING fts5(a)'), /虚拟表/);

    const file = path.join(sandbox, 'plan.db');
    const db = await new Promise((resolve, reject) => { const d = new sqlite3.Database(file, error => error ? reject(error) : resolve(d)); });
    await new Promise((resolve, reject) => db.exec(`CREATE TABLE users(name TEXT, password TEXT); CREATE TABLE orders(id INTEGER PRIMARY KEY, amount REAL, owner TEXT);
        CREATE TABLE api_keys_meta(id INTEGER, label TEXT, api_key TEXT); CREATE INDEX idx_owner ON orders(owner); CREATE VIEW v_users AS SELECT name FROM users;`, error => error ? reject(error) : resolve()));
    const plan = sql => dataApi.assertSafeReadPlan(db, sql);
    await plan('SELECT id, amount FROM orders WHERE owner = 1 ORDER BY amount');
    await plan('SELECT owner, count(*) FROM orders GROUP BY owner');
    await plan('SELECT id, label FROM api_keys_meta');
    await assert.rejects(plan('SELECT name FROM users'), /users/);
    await assert.rejects(plan('SELECT name FROM v_users'), /users/, 'views are expanded to their real tables');
    await assert.rejects(plan('SELECT id FROM orders WHERE owner IN (SELECT password FROM users)'), /users/);
    await assert.rejects(plan('SELECT * FROM api_keys_meta'), /api_key/);
    await assert.rejects(plan('SELECT sql FROM sqlite_master'), /sqlite_master/);
    await new Promise(resolve => db.close(resolve));

    assert.equal(dataApi.isDirectLoopback({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
    assert.equal(dataApi.isDirectLoopback({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': '1.2.3.4' } }), false, 'tunnelled requests are refused');
    assert.equal(dataApi.isDirectLoopback({ socket: { remoteAddress: '10.0.0.8' }, headers: {} }), false);
});

test('app processes get a scrubbed environment with only their own data credentials', () => {
    process.env.TOOLS_ADMIN_SECRET = 'must-not-leak';
    process.env.GEMINI_API_KEY = 'must-not-leak';
    const env = tenant.runWithTenant('default', () => runtime.appEnv('demo', { dataToken: 'tok', uuid: 'uuid-1', secret: 'app-secret', entry: 'app.main:app', factory: false, interface: 'asgi', name: 'Demo' }, 5601));
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.PORT, '5601');
    assert.match(env.BASE_QUERY_URL, /^http:\/\/127\.0\.0\.1:\d+\/hosted-api\/tok\/dh\/query$/);
    assert.equal(env.APP_SCHEMA, 'uuid-1');
    assert.equal(env.APP_DATASOURCE_ID, 'app');
    assert.equal(Object.values(env).includes('must-not-leak'), false);
    assert.equal(env.TOOLS_DATA_DIR, undefined);
    delete process.env.TOOLS_ADMIN_SECRET;
    delete process.env.GEMINI_API_KEY;
});

test('hosted apps keep their original package for download and never count as static tools for snapshot publishing', async () => {
    const archive = await zipOf({ 'kit/requirements.txt': 'uvicorn', 'kit/app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n', 'kit/static/index.html': '<html></html>' });
    const inspected = await appPackage.inspectArchive(archive);
    await tenant.runWithTenant('default', async () => {
        runtime.createApp('kit-app', inspected, { name: 'Kit' });
        const rebuilt = await runtime.packageArchive('kit-app');
        assert.equal(rebuilt.original, false, 'older imports without a saved package are rebuilt from code');
        const names = Object.keys((await JSZip.loadAsync(rebuilt.buffer)).files);
        assert.ok(names.includes('kit-app/app/main.py') && !names.some(name => name.endsWith('_platform_host.py')));
        runtime.savePackage('kit-app', archive, '我的应用 v1.zip');
        const original = await runtime.packageArchive('kit-app');
        assert.equal(original.original, true);
        assert.equal(original.filename, '我的应用 v1.zip');
        assert.ok(original.buffer.equals(archive), 'download returns the exact uploaded bytes');
        await runtime.removeApp('kit-app');
    });
    const launcher = path.join(sandbox, 'launcher', 'index.html');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, service.launcherHtml('kit-app', 'Kit'));
    assert.equal(service.isLauncherFile(launcher), true);
    fs.writeFileSync(path.join(sandbox, 'launcher', 'plain.html'), '<!doctype html><html><head><title>普通工具</title></head></html>');
    assert.equal(service.isLauncherFile(path.join(sandbox, 'launcher', 'plain.html')), false);
    assert.equal(service.isLauncherFile(path.join(sandbox, 'missing.html')), false);
});

test('built-in Python apps ship their package without .env and self-install on first open in other environments', async () => {
    const repo = require('../backend/models/custom-tools-repository');
    const files = { 'kit/requirements.txt': 'uvicorn', 'kit/app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n', 'kit/.env': 'BASE_QUERY_URL=https://secret.example\nTOKEN=abc', 'kit/.env.example': 'PORT=5600', 'kit/sub/.env.local': 'X=1' };
    await tenant.runWithTenant('default', async () => {
        runtime.createApp('bundle-src', await appPackage.inspectArchive(await zipOf(files)), { name: 'Bundle' });
        runtime.savePackage('bundle-src', await zipOf(files), 'kit.zip');
        const bundle = await service.packageForSource('bundle-src');
        const names = Object.keys((await JSZip.loadAsync(bundle.buffer)).files);
        assert.deepEqual(bundle.removed.sort(), ['kit/.env', 'kit/sub/.env.local']);
        assert.ok(names.includes('kit/.env.example') && !names.includes('kit/.env'));
        await runtime.removeApp('bundle-src');

        // 模拟新租户：内置同步把启动页和 hosted-app.zip 复制进工具目录，尚无托管应用
        const tool = await repo.createTool({ name: '内置应用', htmlContent: service.launcherHtml('x', '内置应用') });
        const toolDir = repo.getToolRootDir(tool.slug);
        fs.writeFileSync(path.join(toolDir, service.BUNDLED_PACKAGE), bundle.buffer);
        assert.equal(runtime.exists(tool.slug), false);
        const [first, second] = await Promise.all([service.ensureFromBundle(tool.slug), service.ensureFromBundle(tool.slug)]);
        assert.equal(first, true);
        assert.equal(second, true, 'concurrent opens share one bootstrap');
        const state = runtime.readState(tool.slug);
        assert.equal(state.entry, 'app.main:app');
        assert.equal(state.name, '内置应用');
        assert.match(state.bundleHash, /^[a-f0-9]{64}$/);
        assert.ok((await runtime.packageArchive(tool.slug)).original);
        assert.equal(await service.ensureFromBundle(tool.slug), false, 'unchanged bundle is not reinstalled');

        // 源码里的包更新：更新代码、保留应用库与密钥
        const secret = state.secret;
        const updated = await zipOf({ ...files, 'kit/app/main.py': 'from fastapi import FastAPI\napi = FastAPI()\n' });
        fs.writeFileSync(path.join(toolDir, service.BUNDLED_PACKAGE), updated);
        assert.equal(await service.ensureFromBundle(tool.slug), true);
        const after = runtime.readState(tool.slug);
        assert.equal(after.entry, 'app.main:api');
        assert.equal(after.secret, secret);
        await runtime.removeApp(tool.slug);
    });
});

test('opening an app whose install never started (fresh built-in bootstrap or interrupted install) starts it again', async () => {
    await tenant.runWithTenant('default', async () => {
        runtime.createApp('stalled-app', await appPackage.inspectArchive(await zipOf({ 'requirements.txt': 'uvicorn', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' })), { name: 'Stalled' });
        assert.equal(runtime.readState('stalled-app').status, 'installing');
        assert.equal(runtime.isActive('stalled-app'), false);
        const originalStart = runtime.start;
        let started = 0;
        runtime.start = async () => { started += 1; };
        try {
            await service.launch('stalled-app', { username: 'alice', role: 'admin' });
            assert.equal(started, 1, 'stalled install is restarted');
            runtime.updateState('stalled-app', { desired: 'stopped', status: 'installing' });
            await service.launch('stalled-app', { username: 'alice', role: 'admin' });
            assert.equal(started, 1, 'apps an admin stopped stay stopped');
        } finally {
            runtime.start = originalStart;
            await runtime.removeApp('stalled-app');
        }
    });
});
