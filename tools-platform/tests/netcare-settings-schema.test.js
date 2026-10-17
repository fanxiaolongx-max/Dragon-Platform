const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '../backend/builtin-tools/f12-to-extension');
const packer = require(path.join(dir, 'packer-core.js'));
const code = fs.readFileSync(path.join(dir, 'netcare-rfc-word.js'), 'utf8');
const pageCode = require('./helpers/netcare-page');
const options = {
    name: 'NetCare RFC', version: '1.0.0', description: 'test', code, world: 'MAIN', allFrames: true, manualLaunch: true, runAt: 'document_idle',
    matches: 'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*'
};
const shared = ['netcareNormalizeSettings', 'netcareValidSettings', 'netcareDefaultSettings', 'netcareRedactText', 'netcareEffectiveSection', 'netcareAuditOwner', 'netcareAuditRule'];

function relay(pack) {
    const stored = {}, messages = [];let receive;
    const window = { addEventListener: (_t, fn) => { receive = fn; }, removeEventListener() {}, postMessage: m => messages.push(m) };window.top = window;
    const origin = 'https://netcare-de.gts.huawei.com';
    vm.runInNewContext(pack.files['netcare-online-relay.js'], { window, location: { origin }, chrome: { storage: { local: { set: async data => Object.assign(stored, data), get: async key => ({ [key]: stored[key] }) } } } });
    return { stored, messages, save: async settings => { receive({ source: window, origin, data: { source: 'TP_RFC_SETTINGS_SET', settings } }); await new Promise(resolve => setImmediate(resolve)); } };
}

test('settings schema and rule helpers are defined once, in netcare-settings.js', () => {
    const packerSource = fs.readFileSync(path.join(dir, 'packer-core.js'), 'utf8');
    for (const name of shared) {
        assert.doesNotMatch(code, new RegExp(`function ${name}\\(`), `page redefines ${name}`);
        assert.doesNotMatch(packerSource, new RegExp(`function ${name}\\(`), `packer redefines ${name}`);
    }
    const pack = packer.buildPackage(options), script = packer.netcareSettingsScript();
    assert.equal(pack.files['netcare-settings.js'], script);
    for (const file of ['netcare-online-relay.js', 'background.js', 'netcare-backup.js']) assert.ok(pack.files[file].includes(script), file);
    for (const content of pack.manifest.content_scripts.filter(c => c.world === 'MAIN')) {
        assert.ok(content.js.indexOf('netcare-settings.js') >= 0 && content.js.indexOf('netcare-settings.js') < content.js.indexOf('content.js'));
    }
    for (const [name, source] of Object.entries(pack.files)) if (name.endsWith('.js')) new vm.Script(source, { filename: name });
    // Re-injection by the popup re-runs the module in the same world.
    const ctx = {};vm.runInNewContext(script + script, ctx);
    for (const name of shared) assert.equal(typeof ctx[name], 'function', name);
});

test('a field added to the shared normalizer is stored by the background save with no other edit', async () => {
    const source = fs.readFileSync(path.join(dir, 'netcare-settings.js'), 'utf8');
    const extended = source.replace('return { autoSelectSanitizedPlan: value.autoSelectSanitizedPlan !== false,', 'return { futureOption: value.futureOption === true, autoSelectSanitizedPlan: value.autoSelectSanitizedPlan !== false,');
    assert.notEqual(extended, source);
    const sandbox = {};vm.runInNewContext(extended, sandbox);
    globalThis.createNetcareSettings = sandbox.createNetcareSettings;
    let pack;
    try { pack = packer.buildPackage(options); } finally { delete globalThis.createNetcareSettings; }
    const settings = sandbox.createNetcareSettings();
    const { stored, messages, save } = relay(pack);
    await save(JSON.parse(JSON.stringify(settings.netcareNormalizeSettings({ ...settings.netcareDefaultSettings(), futureOption: true }))));
    assert.equal(messages.at(-1).ok, true);
    assert.equal(stored.netcareExtractionSettings.futureOption, true);
});

test('background save keeps redaction and size bounds of the shared normalizer', async () => {
    const ctx = { URL, URLSearchParams, location: new URL('https://unrelated.example'), window: {} };vm.runInNewContext(pageCode, ctx);
    const { stored, messages, save } = relay(packer.buildPackage(options));
    const defaults = JSON.parse(JSON.stringify(ctx.netcareDefaultSettings()));
    const rule = { id: 'r'.repeat(80), name: 'token=abc123 rule', sectionNumber: '1.1', pattern: 'x', passSummary: 'Bearer sk-live', failSummary: 'fail', enabled: true };
    await save({ ...defaults, localRules: [rule], forbidden: 'must not persist' });
    const saved = stored.netcareExtractionSettings, [local] = saved.localRules;
    assert.equal(saved.forbidden, undefined);
    assert.equal(local.id.length, 60);
    assert.equal(local.name, 'token=[REDACTED] rule');
    assert.equal(local.passSummary, 'Bearer [REDACTED]');
    // The validator still rejects out-of-range input instead of normalizing it.
    const count = JSON.stringify(stored);
    await save({ ...defaults, intervalMs: 0 });
    assert.equal(messages.at(-1).ok, false);
    assert.equal(JSON.stringify(stored), count);
});
