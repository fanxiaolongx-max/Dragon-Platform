const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { createSiteScriptStore } = require('../desktop-promo/site-scripts');
const { createExtensionManager, displayName, compareVersions, scanInstalledBrowserExtensions, selectIcpmExtension, compatibilityWarnings } = require('../desktop-promo/browser-extensions');

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

test('ICPM defaults select one latest extension, preserve manual choice and respect opt-out', () => {
    const chrome = { key: 'chrome:a', browser: 'Chrome', name: 'ICPM插件', version: '3.0.1.13' };
    const edge = { key: 'edge:b', browser: 'Edge', name: 'ICPM插件', version: '3.0.1.13' };
    const other = { key: 'edge:c', browser: 'Edge', name: 'Other plugin', version: '99' };
    assert.equal(selectIcpmExtension([edge, other, chrome], [], []).key, chrome.key);
    assert.equal(selectIcpmExtension([chrome, { ...edge, version: '3.0.2' }], [], []).key, edge.key);
    assert.equal(selectIcpmExtension([chrome], [edge], []), null);
    assert.equal(selectIcpmExtension([chrome, edge], [], ['auto:icpm']), null);
    assert.equal(selectIcpmExtension([other], [], []), null);
    assert.equal(selectIcpmExtension([edge], [], []).key, edge.key);
    assert.deepEqual(compatibilityWarnings({ permissions: ['storage', 'nativeMessaging'] }), ['nativeMessaging']);
    assert.deepEqual(compatibilityWarnings({ optional_permissions: ['nativeMessaging'] }), ['nativeMessaging']);
    assert.deepEqual(compatibilityWarnings({}), []);
});

test('ICPM selection survives restart, switching unloads the other copy and opting out stays off', { skip: process.platform === 'win32' }, async t => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-icpm-'));
    const previousHome = process.env.HOME;
    process.env.HOME = temp;
    t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; fs.rmSync(temp, { recursive: true, force: true }); });
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    const rootFor = browser => process.platform === 'darwin'
        ? path.join(temp, 'Library/Application Support', browser === 'Chrome' ? 'Google/Chrome' : 'Microsoft Edge')
        : path.join(temp, '.config', browser === 'Chrome' ? 'google-chrome' : 'microsoft-edge');
    for (const browser of ['Chrome', 'Edge']) {
        const dir = path.join(rootFor(browser), 'Default/Extensions', id, '3.0.1.13');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: 'ICPM插件', version: '3.0.1.13', manifest_version: 2, permissions: ['nativeMessaging'] }));
    }
    const calls = [], removed = [];
    const session = {
        async loadExtension(dir) { calls.push(dir); return { id: dir }; },
        removeExtension(id) { removed.push(id); }
    };
    const Module = require('node:module');
    const originalLoad = Module._load;
    function manager() {
        Module._load = function(name, ...args) {
            return name === 'electron' ? { app: { getPath: () => temp } } : originalLoad.call(this, name, ...args);
        };
        try { return createExtensionManager({ session, statePath: path.join(temp, 'state.json') }); }
        finally { Module._load = originalLoad; }
    }
    let instance = manager();
    await instance.init();
    assert.equal(instance.imported().length, 1);
    assert.match(instance.imported()[0].key, /^chrome:/);
    assert.deepEqual(instance.imported()[0].info.warnings, ['nativeMessaging']);
    const chromeDir = calls.find(dir => dir.includes('Default/Extensions'));
    const edge = instance.scanInstalledBrowserExtensions().find(item => item.browser === 'Edge');
    await instance.toggleBrowserExtension(edge, true);
    assert.ok(removed.includes(chromeDir));
    assert.deepEqual(instance.imported().map(item => item.key), [edge.key]);
    instance = manager(); await instance.init();
    assert.deepEqual(instance.imported().map(item => item.key), [edge.key]);
    await instance.toggleBrowserExtension(edge, false);
    instance = manager(); await instance.init();
    assert.deepEqual(instance.imported(), []);
    await instance.toggleBrowserExtension(edge, true);
    instance = manager(); await instance.init();
    assert.deepEqual(instance.imported().map(item => item.key), [edge.key]);
});
