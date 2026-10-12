const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'f12-home-shortcuts-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const repo = require('../backend/models/nav-settings-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const tenantPool = require('../backend/models/tenant-sqlite-pool');
const toolDir = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const presets = require(path.join(toolDir, 'builtin-catalog'));
const packer = require(path.join(toolDir, 'packer-core'));
const JSZip = require('../backend/node_modules/jszip');

test('shortcut configuration supports unlimited ordered items and strips unsafe fields', () => {
    const shortcuts = Array.from({ length: 140 }, (_, i) => ({ scriptId: `server:script-${i}`, target: i % 2 ? 'local' : 'store', code: 'ignored' }));
    shortcuts.push(null, { scriptId: '../../file' }, { scriptId: 'builtin:__proto__/file' }, { scriptId: 'builtin:netcare-rfc-word', target: 'other' });
    const normalized = repo.normalizeSettings({ f12QuickDownloads: shortcuts });
    assert.equal(normalized.f12QuickDownloads.length, 141);
    assert.deepEqual(normalized.f12QuickDownloads[0], { scriptId: 'server:script-0', target: 'store' });
    assert.deepEqual(normalized.f12QuickDownloads[139], { scriptId: 'server:script-139', target: 'local' });
    assert.equal(normalized.f12QuickDownloads[140].target, 'store');
    assert.deepEqual(repo.mergeDefaultSettingsPreservingCustomTools(normalized).f12QuickDownloads, normalized.f12QuickDownloads);
});

test('shortcut persistence stays tenant isolated and old clients preserve configured shortcuts', async t => {
    t.after(async () => {
        await appDb.closeDatabase();
        await tenantPool.closeAll();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    const shortcut = { scriptId: 'builtin:netcare-rfc-word', target: 'local' };
    await repo.saveSettings({ f12QuickDownloads: [shortcut] });
    await repo.saveSettings({ primaryIds: ['home'] });
    assert.deepEqual((await repo.getSettings()).f12QuickDownloads, [shortcut]);
    await runWithTenant('shortcut-other', async () => {
        assert.deepEqual((await repo.getSettings()).f12QuickDownloads, []);
        await repo.saveSettings({ f12QuickDownloads: [{ scriptId: 'server:tenant-script', target: 'store' }] });
    });
    assert.deepEqual((await repo.getSettings()).f12QuickDownloads, [shortcut]);
    await repo.saveSettings({ f12QuickDownloads: [] });
    assert.deepEqual((await repo.getSettings()).f12QuickDownloads, []);
    assert.equal((await runWithTenant('shortcut-other', () => repo.getSettings())).f12QuickDownloads[0].scriptId, 'server:tenant-script');
});

const html = fs.readFileSync(path.join(toolDir, 'index.html'), 'utf8');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');

async function packagePage(scriptId, target, quick = true, failure = '') {
    const elements = new Map(), requests = [], replies = [], saved = [], listeners = new Map();
    function element(id) {
        if (!elements.has(id)) elements.set(id, {
            value: '', checked: false, disabled: false, dataset: {}, innerHTML: '', textContent: '',
            classList: { add() {}, remove() {}, replace() {} }, addEventListener() {}, replaceChildren() {}, append() {}
        });
        return elements.get(id);
    }
    element('extLicense').checked = true;
    element('extPackageTarget').value = target;
    const server = { id: 'custom-one', name: 'Custom Script', code: 'console.log("custom")', matches: 'https://example.org/*', world: 'ISOLATED', manualLaunch: true, includePopup: true, optionalPermissions: ['downloads'] };
    const context = {
        URL, URLSearchParams, console, setTimeout() {}, clearTimeout() {}, Blob,
        localStorage: { getItem() { return ''; } },
        location: new URL('http://localhost/custom-tools/f12-to-extension/index.html?' + new URLSearchParams({ quickPack: '1', scriptId, target, requestId: 'test-request' })),
        document: { getElementById: element, querySelectorAll(selector) {
            const inputs = ['downloads', 'tabs', 'activeTab', 'alarms'].map(permission => {
                const input = element('permission-' + permission); input.dataset.extraPermission = permission; return input;
            });
            return selector.includes(':checked') ? inputs.filter(input => input.checked) : inputs;
        }, createElement() { return element('dynamic'); } },
        F12BuiltinScripts: presets, F12ExtensionPacker: packer, JSZip,
        createTPExamVault: require(path.join(toolDir, 'exam-vault')),
        TPExamStoreGuide: { mount() {}, setVisible() {}, matchesScript() { return false; } },
        TPNetcareStoreGuide: { mount() {}, setVisible() {}, matchesScript() { return false; } },
        saveAs: (blob, filename) => saved.push({ blob, filename }),
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (failure && String(url).includes(failure)) return { ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) };
            if (String(url).includes('license-config')) return { ok: true, json: async () => ({ publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'test-x', y: 'test-y' }, manifestKey: Buffer.alloc(162, 7).toString('base64') }) };
            if (String(url).endsWith('/scripts')) return { ok: true, json: async () => ({ scripts: [server] }) };
            if (String(url).includes('/version/')) return { ok: true, json: async () => ({ previousVersion: '1.0.4', nextVersion: '1.0.5', allocatedVersion: '1.0.5' }) };
            const filename = String(url).replace(/^\.\//, '').split('?')[0];
            const contents = fs.readFileSync(path.join(toolDir, filename));
            return { ok: true, text: async () => contents.toString(), blob: async () => contents };
        }
    };
    context.window = { location: context.location, addEventListener: (type, callback) => listeners.set(type, callback), parent: { postMessage: (data, origin) => replies.push({ data, origin }) } };
    if (!quick) context.window.parent = context.window;
    vm.createContext(context);
    vm.runInContext(inline, context);
    if (quick) await listeners.get('DOMContentLoaded')();
    else {
        if (scriptId.startsWith('server:')) await vm.runInContext('refreshServerScripts()', context);
        await vm.runInContext(`loadSelectedScript(${JSON.stringify(scriptId)})`, context);
        await vm.runInContext('packExtension()', context);
    }
    return { requests, replies, saved, elements };
}

for (const scriptId of ['netcare-rfc-word', 'ppo-traffic-autofill', 'server:custom-one']) {
    for (const target of ['local', 'store']) {
        test(`home shortcut produces the same package as the packer: ${scriptId}, ${target}`, async () => {
            const quick = await packagePage(scriptId, target);
            assert.equal(quick.replies.length, 1, JSON.stringify(quick.replies));
            const result = quick.replies[0].data;
            assert.equal(result.ok, true, result.error);
            assert.equal(result.requestId, 'test-request');
            assert.equal(quick.replies[0].origin, 'http://localhost');
            assert.ok(result.blob.size > 0);
            assert.match(result.filename, target === 'local' ? /-v1\.0\.5-local\.zip$/ : /-v1\.0\.5-edge-store\.zip$/);
            assert.equal(quick.requests.filter(request => request.url.endsWith('/reserve')).length, 1);
            const ordinary = await packagePage(scriptId, target, false);
            assert.equal(ordinary.saved[0].filename, result.filename);
            const readZip = async blob => JSZip.loadAsync(await blob.arrayBuffer());
            const zipped = await readZip(result.blob), manual = await readZip(ordinary.saved[0].blob);
            assert.deepEqual(Object.keys(zipped.files), Object.keys(manual.files));
            for (const name of Object.keys(zipped.files)) {
                if (zipped.files[name].dir) continue;
                assert.deepEqual(await zipped.file(name).async('nodebuffer'), await manual.file(name).async('nodebuffer'), name);
            }
            const manifest = JSON.parse(await zipped.file('manifest.json').async('string'));
            assert.equal(manifest.version, '1.0.5');
            assert.equal(!!manifest.key, target === 'local');
            if (scriptId === 'netcare-rfc-word') {
                assert.ok(zipped.file('netcare-capture.js'));
                assert.ok(manifest.permissions.includes('activeTab'));
                assert.ok(manifest.permissions.includes('storage'));
            }
        });
    }
}

test('invalid shortcut selections and permission failures return errors without downloading', async () => {
    for (const [id, target, failure] of [['../../file', 'local', ''], ['__proto__', 'store', ''], ['netcare-rfc-word', 'invalid', ''], ['netcare-rfc-word', 'local', 'license-config']]) {
        const result = await packagePage(id, target, true, failure);
        assert.equal(result.replies[0].data.ok, false);
        assert.equal(result.saved.length, 0);
        assert.equal(result.requests.filter(request => request.url.endsWith('/reserve')).length, 0);
    }
});
