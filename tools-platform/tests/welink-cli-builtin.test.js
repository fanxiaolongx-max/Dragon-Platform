const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'welink-cli-builtin-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');

const runner = require('../backend/models/channels/welink-cli-runner');
const network = require('../backend/models/channels/welink-network');
const builtinDir = path.join(__dirname, '../backend/vendor/@welink/welink-cli');

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

function withPlatform(platform, fn) {
    const original = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: platform });
    return Promise.resolve().then(fn).finally(() => Object.defineProperty(process, 'platform', original));
}

test('the official Windows package is bundled in backend/vendor', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(builtinDir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, '@welink/welink-cli');
    assert.deepEqual(pkg.os, ['win32']);
    assert.ok(fs.statSync(path.join(builtinDir, 'welink-cli.exe')).size > 1024 * 1024);
    assert.ok(fs.existsSync(path.join(builtinDir, pkg.bin['welink-cli'])));
    const build = require('../package.json').build;
    assert.ok(build.files.includes('backend/**/*') && build.asarUnpack.includes('backend/vendor/**/*'), 'shipped unpacked so the exe can be spawned');
    assert.ok(build.mac.files.includes('!backend/vendor/@welink/welink-cli/welink-cli.exe'), 'mac builds leave out the Windows exe');
});

test('Windows uses the bundled exe directly without a configured path or system node', async () => {
    runner.setOverridesForTest({ configFile: path.join(sandbox, 'none.json') });
    await withPlatform('win32', async () => {
        const install = await runner.detect({ refresh: true });
        assert.equal(install.available, true);
        assert.equal(install.source, 'builtin');
        assert.equal(install.direct, true);
        assert.equal(install.entry, path.join(builtinDir, 'welink-cli.exe'));
        assert.equal(install.version, '1.0.16');
    });
});

test('other platforms find the bundle but report Windows-only instead of trying to run it', async () => {
    runner.setOverridesForTest({ configFile: path.join(sandbox, 'none.json') });
    await withPlatform('darwin', async () => {
        const install = await runner.detect({ refresh: true });
        assert.equal(install.available, false);
        assert.equal(install.unsupported, true);
        assert.match(install.hint, /仅支持 Windows/);
        await assert.rejects(runner.run(['auth', 'status']), error => error.code === 'WELINK_CLI_NOT_FOUND' || /Windows/.test(error.message));
    });
});

test('intranet check needs both DNS and a TCP connection to the WeLink intranet host, and caches the result', async () => {
    let lookups = 0;
    network.setOverridesForTest({ lookup: async () => { lookups += 1; throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); } });
    const off = await network.checkIntranet();
    assert.equal(off.intranet, false);
    assert.equal(off.host, 'open.inner.welink.huawei.com');
    assert.equal(off.reason, 'ENOTFOUND');
    assert.match(off.hint, /仅限华为内网/);
    await network.checkIntranet();
    assert.equal(lookups, 1, 'cached');
    await network.checkIntranet({ refresh: true });
    assert.equal(lookups, 2, 'refresh skips the cache');

    network.setOverridesForTest({ lookup: async () => ({ address: '10.0.0.1' }), connect: async () => { throw Object.assign(new Error('t'), { code: 'CONNECT_TIMEOUT' }); } });
    assert.equal((await network.checkIntranet()).intranet, false, 'resolvable but unreachable is still off the intranet');

    let target = null;
    network.setOverridesForTest({ lookup: async () => ({ address: '10.0.0.1' }), connect: async (address, port) => { target = `${address}:${port}`; } });
    const on = await network.checkIntranet();
    assert.equal(on.intranet, true);
    assert.equal(on.hint, undefined);
    assert.equal(target, '10.0.0.1:443');
    network.setOverridesForTest();
});

test('off the intranet, status reports the restriction without probing WeLink PC and login is refused', async () => {
    const http = require('http');
    const express = require('../backend/node_modules/express');
    const { runWithTenant } = require('../backend/models/tenant-context');
    let spawned = 0;
    runner.setOverridesForTest({ configFile: path.join(sandbox, 'none.json'), install: { available: true, source: 'builtin', entry: 'x', version: '1.0.16' }, node: { get command() { spawned += 1; return 'false'; }, env: {} } });
    network.setOverridesForTest({ lookup: async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('default', next); });
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/channels/welink-cli`;
    try {
        const status = await (await fetch(`${base}/status?auth=1`)).json();
        assert.equal(status.network.intranet, false);
        assert.match(status.network.hint, /仅限华为内网/);
        assert.equal(status.auth, undefined);
        const lines = (await (await fetch(`${base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text()).trim().split('\n').map(line => JSON.parse(line));
        assert.equal(lines.length, 1);
        assert.equal(lines[0].type, 'error');
        assert.equal(lines[0].code, 'WELINK_CLI_EXTRANET');
        assert.equal(lines[0].network.intranet, false);
        assert.equal(spawned, 0, 'the CLI never started');
    } finally {
        await new Promise(resolve => server.close(resolve));
        network.setOverridesForTest();
        runner.setOverridesForTest();
    }
});

test('the WeLink assistant SDK is bundled and its QR authorization is refused off the intranet', async () => {
    const pkgDir = path.join(__dirname, '../backend/vendor/@wecode/bridge-runtime-sdk');
    assert.equal(JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).name, '@wecode/bridge-runtime-sdk');
    const sdkLoader = require('../backend/models/channels/welink-sdk-loader');
    const detected = await sdkLoader.detect();
    assert.equal(detected.source, 'builtin');
    const sdk = await sdkLoader.load({});
    assert.equal(typeof sdk.qrcodeAuth.run, 'function');
    assert.equal(typeof sdk.createBridgeRuntime, 'function');

    const http = require('http');
    const express = require('../backend/node_modules/express');
    const { runWithTenant } = require('../backend/models/tenant-context');
    network.setOverridesForTest({ lookup: async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); } });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('default', next); });
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    try {
        const text = await (await fetch(`http://127.0.0.1:${server.address().port}/api/channels/welink/qrcode-auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).text();
        const lines = text.trim().split('\n').map(line => JSON.parse(line));
        assert.equal(lines.length, 1);
        assert.equal(lines[0].code, 'WELINK_EXTRANET');
        assert.match(lines[0].error, /WeLink 助理扫码授权仅限华为内网/);
    } finally {
        await new Promise(resolve => server.close(resolve));
        network.setOverridesForTest();
    }
});
