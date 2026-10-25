const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const script = read('frontend/js/shared/platform-title.js');

function fixture(values = {}, blocked = false) {
    const store = new Map(Object.entries(values));
    const title = { dataset: { platformPageTitle: '工具中台', platformPageTitleEn: 'Tool Hub' } };
    const document = { title: '工具中台', querySelector: () => title };
    const context = {
        document, window: {},
        localStorage: { getItem(key) { if (blocked) throw new Error('Storage blocked'); return store.get(key) ?? null; } }
    };
    vm.createContext(context);
    vm.runInContext(script, context);
    return { context, document, store };
}

test('first-paint title uses the cached brand in the saved language and supports legacy caches', () => {
    const identity = JSON.stringify({ platformNameZh: '自定义运营中心', platformNameEn: 'Custom Operations' });
    for (const [language, expected] of [['zh-CN', '自定义运营中心 - 工具中台'], ['en-US', 'Custom Operations - Tool Hub']]) {
        const { document } = fixture({ tools_platform_identity: identity, tools_lang: language });
        assert.equal(document.title, expected);
    }
    assert.equal(fixture({ tools_platform_name: '旧版缓存名称' }).document.title, '旧版缓存名称 - 工具中台');
});

test('missing, broken and inaccessible caches show a neutral page title', () => {
    assert.equal(fixture().document.title, '工具中台');
    assert.equal(fixture({ tools_platform_identity: '{bad json' }).document.title, '工具中台');
    assert.equal(fixture({}, true).document.title, '工具中台');
    assert.equal(fixture({ tools_lang: 'en-US' }).document.title, 'Tool Hub');
});

test('live navigation settings replace a cached custom name and language changes preserve the page suffix', () => {
    const { context, document } = fixture({ tools_platform_identity: JSON.stringify({ platformName: 'Previous custom brand' }) });
    assert.equal(document.title, 'Previous custom brand - 工具中台');
    let language = 'zh-CN';
    context.window.ToolsI18n = { getLanguage: () => language };
    context.navState = { settings: { platformNameZh: '新平台 <中心>', platformNameEn: 'New Platform' } };
    const navbar = read('frontend/js/shared/navbar.js');
    vm.runInContext(navbar.slice(navbar.indexOf('let platformTitleOriginal'), navbar.indexOf('function applyPlatformIdentity()')), context);
    context.applyPlatformTitle();
    assert.equal(document.title, '新平台 <中心> - 工具中台');
    language = 'en-US';
    context.applyPlatformTitle();
    assert.equal(document.title, 'New Platform - Tool Hub');
    context.navState.settings.platformNameEn = 'Renamed Again';
    context.applyPlatformTitle();
    context.applyPlatformTitle();
    assert.equal(document.title, 'Renamed Again - Tool Hub');
});

test('unmarked page titles retain their existing navbar title behavior', () => {
    const { context, document } = fixture();
    document.title = 'Reports - Tools Platform';
    document.querySelector = () => null;
    assert.equal(context.window.ToolsPlatformTitle.apply({ platformName: 'Custom' }), false);
    assert.equal(document.title, 'Reports - Tools Platform');
});
