const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createMockDomEnvironment(navigatorOverrides = {}, storageInitial = {}) {
    const storage = new Map(Object.entries(storageInitial));
    const listeners = new Map();

    const mockDocument = {
        documentElement: { lang: 'zh-CN' },
        title: '',
        elements: [],
        getElementById(id) {
            return this.elements.find(el => el.id === id) || null;
        },
        querySelectorAll(selector) {
            if (selector === '[data-i18n]') {
                return this.elements.filter(el => el.dataset && 'i18n' in el.dataset);
            }
            if (selector === '[data-i18n-html]') {
                return this.elements.filter(el => el.dataset && 'i18nHtml' in el.dataset);
            }
            if (selector === '[data-i18n-title]') {
                return this.elements.filter(el => el.dataset && 'i18nTitle' in el.dataset);
            }
            if (selector === '[data-i18n-placeholder]') {
                return this.elements.filter(el => el.dataset && 'i18nPlaceholder' in el.dataset);
            }
            if (selector === '[data-i18n-value]') {
                return this.elements.filter(el => el.dataset && 'i18nValue' in el.dataset);
            }
            if (selector === '[data-i18n-aria-label]') {
                return this.elements.filter(el => el.dataset && 'i18nAriaLabel' in el.dataset);
            }
            return [];
        }
    };

    const mockWindow = {
        document: mockDocument,
        location: { hostname: 'localhost', href: 'http://localhost:3000' },
        navigator: {
            languages: ['zh-CN', 'zh'],
            language: 'zh-CN',
            ...navigatorOverrides
        },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, val) { storage.set(key, String(val)); },
            removeItem(key) { storage.delete(key); },
            clear() { storage.clear(); }
        },
        addEventListener(event, handler) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event).push(handler);
        },
        dispatchEvent(event) {
            const list = listeners.get(event.type) || [];
            list.forEach(fn => fn(event));
        },
        CustomEvent: class {
            constructor(type, options = {}) {
                this.type = type;
                this.detail = options.detail;
            }
        }
    };

    return { mockWindow, mockDocument, storage };
}

test('i18n detects browser language automatically when no saved language exists', () => {
    const i18nCode = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/i18n.js'), 'utf8');

    // 1. English browser locale defaults to en-US
    {
        const { mockWindow } = createMockDomEnvironment({
            languages: ['en-US', 'en'],
            language: 'en-US'
        });
        const ctx = vm.createContext({
            window: mockWindow,
            document: mockWindow.document,
            navigator: mockWindow.navigator,
            localStorage: mockWindow.localStorage,
            CustomEvent: mockWindow.CustomEvent
        });
        vm.runInContext(i18nCode, ctx);
        assert.equal(mockWindow.ToolsI18n.getLanguage(), 'en-US');
    }

    // 2. Chinese browser locale defaults to zh-CN
    {
        const { mockWindow } = createMockDomEnvironment({
            languages: ['zh-CN', 'zh', 'en'],
            language: 'zh-CN'
        });
        const ctx = vm.createContext({
            window: mockWindow,
            document: mockWindow.document,
            navigator: mockWindow.navigator,
            localStorage: mockWindow.localStorage,
            CustomEvent: mockWindow.CustomEvent
        });
        vm.runInContext(i18nCode, ctx);
        assert.equal(mockWindow.ToolsI18n.getLanguage(), 'zh-CN');
    }

    // 3. Other non-Chinese browser locale (e.g. French, Japanese) defaults to en-US
    {
        const { mockWindow } = createMockDomEnvironment({
            languages: ['fr-FR', 'fr'],
            language: 'fr-FR'
        });
        const ctx = vm.createContext({
            window: mockWindow,
            document: mockWindow.document,
            navigator: mockWindow.navigator,
            localStorage: mockWindow.localStorage,
            CustomEvent: mockWindow.CustomEvent
        });
        vm.runInContext(i18nCode, ctx);
        assert.equal(mockWindow.ToolsI18n.getLanguage(), 'en-US');
    }

    // 4. Stored preference overrides browser locale
    {
        const { mockWindow } = createMockDomEnvironment({
            languages: ['en-US', 'en'],
            language: 'en-US'
        }, {
            tools_lang: 'zh-CN'
        });
        const ctx = vm.createContext({
            window: mockWindow,
            document: mockWindow.document,
            navigator: mockWindow.navigator,
            localStorage: mockWindow.localStorage,
            CustomEvent: mockWindow.CustomEvent
        });
        vm.runInContext(i18nCode, ctx);
        assert.equal(mockWindow.ToolsI18n.getLanguage(), 'zh-CN');
    }
});

test('login.html contains valid i18n structure and translations', () => {
    const loginHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/login.html'), 'utf8');

    // Has i18n.js script inclusion
    assert.match(loginHtml, /<script src="\/js\/shared\/i18n\.js/);

    // Has language toggle button
    assert.match(loginHtml, /id="loginLangBtn"/);
    assert.match(loginHtml, /id="loginLangCurrent"/);
    assert.match(loginHtml, /toggleLoginLanguage\(\)/);

    // Has data-i18n bindings
    assert.match(loginHtml, /data-i18n="login\.subtitle"/);
    assert.match(loginHtml, /data-i18n="login\.usernameLabel"/);
    assert.match(loginHtml, /data-i18n-placeholder="login\.usernamePlaceholder"/);
    assert.match(loginHtml, /data-i18n="login\.passwordLabel"/);
    assert.match(loginHtml, /data-i18n-placeholder="login\.passwordPlaceholder"/);
    assert.match(loginHtml, /data-i18n="login\.submit"/);
    assert.match(loginHtml, /data-i18n="login\.playGame"/);
    assert.match(loginHtml, /data-i18n="login\.cinema"/);
    assert.match(loginHtml, /data-i18n="login\.privacy"/);
    assert.match(loginHtml, /data-i18n="login\.terms"/);

    // Extracts LOGIN_I18N dictionary from login.html
    const dictMatch = loginHtml.match(/const\s+LOGIN_I18N\s*=\s*(\{[\s\S]*?\n\s*\});/);
    assert.ok(dictMatch, 'LOGIN_I18N definition found');
    const loginDict = eval(`(() => (${dictMatch[1]}))()`);

    assert.ok(loginDict['zh-CN'], 'zh-CN dictionary exists');
    assert.ok(loginDict['en-US'], 'en-US dictionary exists');

    const expectedKeys = [
        'login.pageTitle',
        'login.subtitle',
        'login.usernameLabel',
        'login.usernamePlaceholder',
        'login.passwordLabel',
        'login.passwordPlaceholder',
        'login.submit',
        'login.submitting',
        'login.success',
        'login.failed',
        'login.emptyFields',
        'login.playGame',
        'login.cinema',
        'login.privacy',
        'login.terms',
        'login.exitGame',
        'login.close',
        'login.privacyTitle',
        'login.termsTitle'
    ];

    for (const key of expectedKeys) {
        assert.ok(loginDict['zh-CN'][key], `zh-CN has ${key}`);
        assert.ok(loginDict['en-US'][key], `en-US has ${key}`);
        assert.notEqual(loginDict['zh-CN'][key], loginDict['en-US'][key], `Translations differ for ${key}`);
    }
});

test('navbar.js builtin tools sync modal helpers support English and Chinese', () => {
    const navbarCode = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');

    // Extract helper functions including formatBuiltinToolBytes
    const helpersMatch = navbarCode.match(/(function formatBuiltinToolBytes[\s\S]*?)(function closeBuiltinToolsSyncModal)/);
    assert.ok(helpersMatch, 'Helper functions found in navbar.js');

    const helpersCode = `
        function navLocaleText(zh, en) {
            return window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
        }
        function navEscape(s) { return String(s || ''); }
        ${helpersMatch[1]}
    `;

    // 1. In English mode
    {
        let currentLang = 'en-US';
        const ctx = vm.createContext({
            window: {
                ToolsI18n: { getLanguage: () => currentLang }
            }
        });
        vm.runInContext(helpersCode, ctx);

        const statusMeta = ctx.builtinToolStatusMeta('missing');
        assert.equal(statusMeta.label, 'New System Tool');
        assert.equal(ctx.builtinToolStatusMeta('update').label, 'Content Differs');
        assert.equal(ctx.builtinToolStatusMeta('adopt').label, 'Adopt Identical Version');
        assert.equal(ctx.builtinToolStatusMeta('conflict').label, 'Name Conflict');

        assert.equal(ctx.builtinToolChangeLabel('added'), 'Added');
        assert.equal(ctx.builtinToolChangeLabel('modified'), 'Modified');
        assert.equal(ctx.builtinToolChangeLabel('removed'), 'Deleted');
        assert.equal(ctx.builtinToolChangeLabel('preserved'), 'Preserved');
        assert.equal(ctx.builtinToolChangeLabel('unchanged'), 'Unchanged');

        const diffHtml = ctx.renderBuiltinToolDiff({
            changes: [{ type: 'modified', path: 'index.html', oldSize: 100, newSize: 200 }],
            counts: { modified: 1, unchanged: 2 }
        });
        assert.match(diffHtml, />Modified</);
        assert.match(diffHtml, /2 identical file\(s\) omitted/);
    }

    // 2. In Chinese mode
    {
        let currentLang = 'zh-CN';
        const ctx = vm.createContext({
            window: {
                ToolsI18n: { getLanguage: () => currentLang }
            }
        });
        vm.runInContext(helpersCode, ctx);

        assert.equal(ctx.builtinToolStatusMeta('missing').label, '新增系统工具');
        assert.equal(ctx.builtinToolStatusMeta('update').label, '内容有差异');
        assert.equal(ctx.builtinToolChangeLabel('added'), '新增');
        assert.equal(ctx.builtinToolChangeLabel('modified'), '修改');

        const diffHtml = ctx.renderBuiltinToolDiff({
            changes: [{ type: 'modified', path: 'index.html', oldSize: 100, newSize: 200 }],
            counts: { modified: 1, unchanged: 2 }
        });
        assert.match(diffHtml, />修改</);
        assert.match(diffHtml, /2 个相同文件不会重复说明/);
    }
});
