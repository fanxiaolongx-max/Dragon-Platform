const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/uivf12/copy.js'), 'utf8');
const runtimeSource = source.slice(source.indexOf('function installFloatingCaptureTheme('), source.indexOf('function wrapMasterScriptWithFloatingLauncher('));

function fixture({ saved, platformTheme = 'dark', actualPlatformTheme, language = 'zh-CN', shadow = true, denied = false } = {}) {
    const storage = new Map(saved ? [['uivf12-capture-theme-v1', saved]] : []);
    const host = { attrs: {}, style: {}, setAttribute(key, value) { this.attrs[key] = value; } };
    const nodes = [], handlers = {};
    let button, languageButton;
    const actions = {
        querySelector: () => button,
        insertBefore(node) { button = node; }
    };
    const root = {
        ...(shadow ? { host } : host),
        querySelector: selector => selector === '.head-actions' ? actions : languageButton,
        appendChild: node => nodes.push(node),
        addEventListener: (event, handler) => { handlers[event] = handler; }
    };
    const document = {
        documentElement: { dataset: { theme: platformTheme, platformTheme: actualPlatformTheme }, lang: language },
        createElement: () => ({ attrs: {}, events: {}, setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(event, fn) { this.events[event] = fn; } })
    };
    const localStorage = {
        getItem: key => { if (denied) throw new Error('blocked'); return storage.get(key); },
        setItem: (key, value) => { if (denied) throw new Error('blocked'); storage.set(key, value); }
    };
    const install = vm.runInNewContext(`(${runtimeSource.trim()})`, { document, localStorage });
    install(root);
    return { host: shadow ? host : root, root, document, button, storage, nodes, install, setLanguage(text) { languageButton = { textContent: text }; handlers.click({ target: { closest: () => languageButton } }); } };
}

test('floating theme toggles without changing the target site and restores the saved preference', () => {
    const f = fixture();
    assert.equal(f.host.attrs['data-uiv-capture-theme'], 'dark');
    f.button.events.click();
    assert.equal(f.host.attrs['data-uiv-capture-theme'], 'light');
    assert.equal(f.button.attrs['aria-pressed'], 'true');
    assert.equal(f.storage.get('uivf12-capture-theme-v1'), 'light');
    assert.equal(f.document.documentElement.dataset.theme, 'dark');
    assert.equal(fixture({ saved: f.storage.get('uivf12-capture-theme-v1') }).host.attrs['data-uiv-capture-theme'], 'light');
    f.button.events.click();
    assert.equal(f.host.style.colorScheme, 'dark');
    f.install(f.root);
    assert.equal(f.nodes.length, 1, 'reinstall must not add another stylesheet or button');
});

test('storage denial and invalid preferences retain a working toggle; simulator inherits the platform default', () => {
    assert.equal(fixture({ actualPlatformTheme: 'light' }).host.attrs['data-uiv-capture-theme'], 'light', 'platform theme takes precedence over legacy data-theme');
    for (const shadow of [true, false]) {
        const f = fixture({ denied: true, platformTheme: 'light', shadow });
        assert.equal(f.host.attrs['data-uiv-capture-theme'], 'light');
        assert.doesNotThrow(() => f.button.events.click());
        assert.equal(f.host.attrs['data-uiv-capture-theme'], 'dark');
        assert.match(f.nodes[0].textContent, shadow ? /:host\(\[data-uiv-capture-theme="light"\]\)/ : /\[data-uiv-capture-theme="light"\] \.nc-card/);
    }
    assert.equal(fixture({ saved: 'invalid' }).host.attrs['data-uiv-capture-theme'], 'dark');
});

test('theme controls follow NetCare and DataFab language changes and cover analytical surfaces', () => {
    const f = fixture({ language: 'en-US' });
    assert.equal(f.button.textContent, '☀ Light');
    f.setLanguage('EN');
    assert.equal(f.button.textContent, '☀ 亮色');
    f.setLanguage('中');
    assert.equal(f.button.attrs['aria-label'], 'Switch to light mode');
    for (const selector of ['.nc-plan-input', '.nc-progress-note', '.nc-eos-sticky-item', '.nc-eos-card.nc-eos-fullscreen', '.nc-sr-chart-title', '.judgment-danger', '.close-choice-card']) assert.ok(f.nodes[0].textContent.includes(selector));
});

test('copied floating scripts embed a standalone theme runtime and simulator uses the same installer', () => {
    const context = vm.createContext({ window: {} });
    vm.runInContext(source.slice(source.indexOf('function installFloatingCaptureTheme('), source.indexOf('function buildAndCopyMasterScript(')), context);
    const script = vm.runInContext('wrapMasterScriptWithFloatingLauncher("", {siteName:"Test",taskCount:0})', context);
    assert.doesNotThrow(() => new vm.Script(script));
    assert.match(script, /const installFloatingThemeRuntime = function installFloatingCaptureTheme/);
    assert.match(script, /installFloatingThemeRuntime\(root\)/);
    assert.match(source.slice(source.indexOf('function openTopicFloatingSimulator('), source.indexOf('function getFloatingSlaRuleDefaults(')), /installFloatingCaptureTheme\(root\)/);
});
