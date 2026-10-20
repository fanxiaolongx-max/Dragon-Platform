const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createSiteScriptStore } = require('../desktop-promo/site-scripts');
const { displayName, compareVersions, scanInstalledBrowserExtensions } = require('../desktop-promo/browser-extensions');

test('extension metadata helpers load without an Electron binary in a plain Node process', () => {
    const modulePath = require.resolve('../desktop-promo/browser-extensions');
    execFileSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict');
        const Module = require('node:module');
        const originalLoad = Module._load;
        Module._load = function(id, ...args) {
            if (id === 'electron') throw new Error('Electron binary unavailable in CI');
            return originalLoad.call(this, id, ...args);
        };
        const extensions = require(${JSON.stringify(modulePath)});
        assert.equal(extensions.displayName('/fixture', { name: 'Fixture' }), 'Fixture');
        assert.ok(extensions.compareVersions('1.10.0', '1.9.0') > 0);
        assert.equal(typeof extensions.scanInstalledBrowserExtensions, 'function');
        assert.throws(() => extensions.createExtensionManager({ session: {} }), /Electron binary unavailable in CI/);
    `], { stdio: 'pipe' });
});

test('floating script store keeps one script per site and never lists the code', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-site-scripts-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'scripts.json');
    const store = createSiteScriptStore(file);
    store.put({ origin: 'https://w3.example.com/some/path', name: 'W3', url: 'https://w3.example.com/home', code: 'console.log(1)' });
    store.put({ origin: 'https://w3.example.com', name: 'W3', url: 'https://w3.example.com/home', code: 'console.log(2)' });
    assert.equal(store.list().length, 1);
    assert.equal('code' in store.list()[0], false);
    assert.equal(createSiteScriptStore(file).get('https://w3.example.com').code, 'console.log(2)', 'persists across restarts');
    assert.throws(() => store.put({ origin: 'https://a.example', url: 'https://b.example/', code: 'x' }), /属于该站点/);
    assert.throws(() => store.put({ origin: 'file:///etc', code: 'x' }), /http/);
    assert.throws(() => store.put({ origin: 'https://a.example', code: '  ' }), /为空/);
});

test('extension names resolve __MSG__ placeholders and versions compare numerically', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-ext-name-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, '_locales', 'zh_CN'), { recursive: true });
    fs.writeFileSync(path.join(dir, '_locales', 'zh_CN', 'messages.json'), JSON.stringify({ AppName: { message: '公司登录助手' } }));
    assert.equal(displayName(dir, { name: '__MSG_appName__', default_locale: 'zh_CN' }), '公司登录助手');
    assert.equal(displayName(dir, { name: 'Plain' }), 'Plain');
    assert.ok(compareVersions('1.10.0', '1.9.3') > 0);
    assert.equal(compareVersions('2.0', '2.0.0'), 0);
});

test('installed Chrome extensions are found with their newest version', { skip: process.platform === 'win32' }, t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-ext-home-'));
    const previous = process.env.HOME;
    process.env.HOME = home;
    t.after(() => { if (previous === undefined) delete process.env.HOME; else process.env.HOME = previous; fs.rmSync(home, { recursive: true, force: true }); });
    const userData = process.platform === 'darwin' ? path.join(home, 'Library/Application Support/Google/Chrome') : path.join(home, '.config/google-chrome');
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    for (const version of ['1.9.0', '1.10.0']) {
        const dir = path.join(userData, 'Default', 'Extensions', id, version);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Corp SSO', version }));
    }
    const found = scanInstalledBrowserExtensions();
    assert.equal(found.length, 1);
    assert.equal(found[0].key, `chrome:${id}`);
    assert.equal(found[0].version, '1.10.0');
    assert.equal(found[0].name, 'Corp SSO');
});
