const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const JSZip = require('jszip');

// All business databases and packager files used here live under this isolated root.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-python-repository-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');
const appDb = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');
const repositoryPath = path.join(__dirname, '../backend/models/python-script-repository.js');
const routePath = path.join(__dirname, '../backend/routes/python-updater.js');
const sourceFiles = [
    'universal_shell.py', 'core_script.py', 'version.json', 'updater_config.json',
    'requirements.txt', 'build_exe.bat', 'build_exe.py', 'smoke_test.py', 'run_launcher.bat', 'README.md',
    'tests/fixtures/excel_smoke.xls'
];
let fixtureCount = 0;

test.after(async () => {
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function loadModule(filename, overrides = {}, moduleDir = path.dirname(filename)) {
    const module = { exports: {} };
    const nativeRequire = createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        module, exports: module.exports, __dirname: moduleDir,
        require: name => Object.hasOwn(overrides, name) ? overrides[name] : nativeRequire(name)
    }, { filename });
    return module.exports;
}

function createFixture({ complete = true } = {}) {
    const id = `fixture-${++fixtureCount}`;
    const root = path.join(sandbox, id);
    const packagerDir = path.join(root, 'python-packager');
    if (complete) {
        fs.mkdirSync(packagerDir, { recursive: true });
        for (const filename of sourceFiles) {
            fs.mkdirSync(path.dirname(path.join(packagerDir, filename)), { recursive: true });
            fs.writeFileSync(path.join(packagerDir, filename), `# fixture ${filename}\n`);
        }
        fs.writeFileSync(path.join(packagerDir, 'core_script.py'), '__version__ = "1.1.1"\nprint("bundled code")\n');
        fs.writeFileSync(path.join(packagerDir, 'version.json'), JSON.stringify({
            name: '打包版抽查工具', version: '1.1.1', description: '最新源码描述',
            changelog: '修复 Windows 运行', author: '发布管理员', sha256: 'metadata does not replace the actual code hash'
        }));
    }
    const repo = loadModule(repositoryPath, {}, path.join(root, 'tools-platform/backend/models'));
    return { id, repo, packagerDir, run: callback => runWithTenant(id, callback) };
}

test('new tenant scripts and version snapshots use the packaged metadata and actual code hash', async () => {
    const fixture = createFixture();
    await fixture.run(async () => {
        const script = await fixture.repo.getScript('pr-audit-sampler');
        assert.equal(script.name, '打包版抽查工具');
        assert.equal(script.current_version, '1.1.1');
        assert.equal(script.description, '最新源码描述');
        assert.equal(script.code, fs.readFileSync(path.join(fixture.packagerDir, 'core_script.py'), 'utf8'));
        const history = await fixture.repo.listVersions(script.id);
        assert.equal(history.length, 1);
        assert.equal(history[0].version, '1.1.1');
        assert.equal(history[0].changelog, '修复 Windows 运行');
        assert.equal(history[0].author, '发布管理员');
        assert.equal(history[0].sha256, crypto.createHash('sha256').update(script.code).digest('hex'));
    });
});

test('initialization preserves an existing tenant script and its version history after source updates', async () => {
    const fixture = createFixture();
    await fixture.run(async () => {
        await fixture.repo.ensureReady();
        await fixture.repo.saveScript({ id: 'pr-audit-sampler', name: '用户自定义抽查', code: 'print("user data")\n', version: '9.0.0' });
        const historyBefore = await fixture.repo.listVersions('pr-audit-sampler');
        fs.writeFileSync(path.join(fixture.packagerDir, 'core_script.py'), 'print("new release")\n');
        fs.writeFileSync(path.join(fixture.packagerDir, 'version.json'), '{"version":"2.0.0","name":"新发布"}');
        await fixture.repo.ensureReady();
        const script = await fixture.repo.getScript('pr-audit-sampler');
        assert.equal(script.name, '用户自定义抽查');
        assert.equal(script.current_version, '9.0.0');
        assert.equal(script.code, 'print("user data")\n');
        assert.deepEqual(await fixture.repo.listVersions('pr-audit-sampler'), historyBefore);
    });
});

test('exported source includes the build entry, smoke test, and Python tests without runtime files', async () => {
    const fixture = createFixture();
    const testDir = path.join(fixture.packagerDir, 'tests');
    fs.mkdirSync(path.join(testDir, '__pycache__'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test_packaging.py'), 'print("test fixture")\n');
    fs.writeFileSync(path.join(testDir, 'nested/test_nested.py'), 'print("nested fixture")\n');
    fs.writeFileSync(path.join(testDir, '__pycache__/cached.py'), 'cached source');
    fs.writeFileSync(path.join(testDir, 'secret.txt'), 'not a source file');
    fs.mkdirSync(path.join(fixture.packagerDir, 'data'));
    fs.writeFileSync(path.join(fixture.packagerDir, 'data/user.json'), 'runtime data');

    const zip = await JSZip.loadAsync(await fixture.repo.exportUniversalShellZip());
    for (const filename of sourceFiles) assert.ok(zip.file(filename), `${filename} is required for the exported build`);
    assert.equal(await zip.file('build_exe.py').async('string'), '# fixture build_exe.py\n');
    assert.ok(zip.file('tests/test_packaging.py'));
    assert.ok(zip.file('tests/nested/test_nested.py'));
    assert.equal(zip.file('tests/__pycache__/cached.py'), null);
    assert.equal(zip.file('tests/secret.txt'), null);
    assert.equal(zip.file('data/user.json'), null);
});

test('source export rejects missing directories and required files instead of producing incomplete ZIPs', async () => {
    const missingDirectory = createFixture({ complete: false });
    await assert.rejects(() => missingDirectory.repo.exportUniversalShellZip(), error => {
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /完整项目源码/);
        return true;
    });
    assert.equal(fs.existsSync(missingDirectory.packagerDir), false);

    const missingFile = createFixture();
    fs.unlinkSync(path.join(missingFile.packagerDir, 'smoke_test.py'));
    await assert.rejects(() => missingFile.repo.exportUniversalShellZip(), error => {
        assert.equal(error.statusCode, 503);
        assert.match(error.message, /smoke_test\.py/);
        return true;
    });
});

test('named tenant publication is forbidden and leaves the shared source unchanged', async () => {
    const fixture = createFixture();
    const beforeCore = fs.readFileSync(path.join(fixture.packagerDir, 'core_script.py'));
    const beforeVersion = fs.readFileSync(path.join(fixture.packagerDir, 'version.json'));
    await assert.rejects(() => fixture.run(() => fixture.repo.syncToPackagerRepo('pr-audit-sampler', 'print("cross-tenant")\n')), error => {
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /切换到默认租户/);
        return true;
    });
    assert.deepEqual(fs.readFileSync(path.join(fixture.packagerDir, 'core_script.py')), beforeCore);
    assert.deepEqual(fs.readFileSync(path.join(fixture.packagerDir, 'version.json')), beforeVersion);
});

test('default tenant publication normalizes Windows line endings and hashes the exact written bytes', async () => {
    const fixture = createFixture();
    const code = '__version__ = "1.2.0"\r\nprint("Windows import")\r\n';
    const result = await runWithTenant('default', () => fixture.repo.syncToPackagerRepo('pr-audit-sampler', code, { version: '1.2.0' }));
    const written = fs.readFileSync(path.join(fixture.packagerDir, 'core_script.py'));
    assert.equal(written.toString(), code.replace(/\r\n/g, '\n'));
    const metadata = JSON.parse(fs.readFileSync(path.join(fixture.packagerDir, 'version.json'), 'utf8'));
    assert.equal(metadata.version, '1.2.0');
    assert.equal(metadata.sha256, crypto.createHash('sha256').update(written).digest('hex'));
    assert.equal(result.sha256, metadata.sha256);
});

test('default tenant publication reports unavailable source without creating a partial directory', async () => {
    const fixture = createFixture({ complete: false });
    await assert.rejects(() => runWithTenant('default', () => fixture.repo.syncToPackagerRepo('pr-audit-sampler', 'print("new core")\n')), error => {
        assert.equal(error.statusCode, 503);
        return true;
    });
    assert.equal(fs.existsSync(fixture.packagerDir), false);
});

test('updater routes preserve publication and source-availability HTTP status codes', async () => {
    const handlers = new Map();
    const router = {
        get: (route, handler) => handlers.set(`GET ${route}`, handler),
        post: (route, handler) => handlers.set(`POST ${route}`, handler)
    };
    const errorWithStatus = statusCode => Object.assign(new Error('操作不可用'), { statusCode });
    loadModule(routePath, {
        express: { Router: () => router },
        '../models/python-script-repository': {
            syncToPackagerRepo: async () => { throw errorWithStatus(403); },
            exportUniversalShellZip: async () => { throw errorWithStatus(503); }
        },
        '../middleware/auth': { requireAdmin() {} }
    });
    for (const [key, expectedStatus] of [['POST /sync-repo', 403], ['GET /export-shell', 503]]) {
        const response = { status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } };
        await handlers.get(key)({ body: { code: 'print("valid request")\n' } }, response);
        assert.equal(response.statusCode, expectedStatus);
        assert.equal(response.body.error, '操作不可用');
    }
    const invalidResponse = { status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; } };
    await handlers.get('POST /sync-repo')({ body: { code: 42 } }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
});
