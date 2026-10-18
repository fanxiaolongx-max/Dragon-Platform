const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-identity-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const repo = require('../backend/models/nav-settings-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');

test('platform names are isolated by tenant and survive older clients and navigation resets', async t => {
    t.after(async () => {
        await appDb.closeDatabase();
        await pool.closeAll();
        fs.rmSync(sandbox, { recursive: true, force: true });
    });
    const { getUsageVideoFooter } = require('../backend/models/platform-usage-video');
    assert.match(await getUsageVideoFooter('平台怎么使用？', 'zh-CN'), /jx.huawei.com/);
    await repo.saveSettings({ platformGuideVideoUrl: 'https://example.com/guide' });
    await repo.saveSettings({ primaryIds: ['home'] });
    assert.match(await getUsageVideoFooter('How do I use Dragon Claw?', 'en-US'), /Watch.*example.com/);
    assert.equal(await getUsageVideoFooter('写一个排序算法', 'zh-CN'), '');
    assert.equal(repo.mergeDefaultSettingsPreservingCustomTools(await repo.getSettings()).platformGuideVideoUrl, 'https://example.com/guide');
    await runWithTenant('video-other', async () => {
        assert.match((await repo.getSettings()).platformGuideVideoUrl, /jx.huawei.com/);
        await repo.saveSettings({ platformGuideVideoUrl: '' });
        assert.equal(await getUsageVideoFooter('平台使用指南', 'zh-CN'), '');
    });
    assert.equal((await repo.getSettings()).platformGuideVideoUrl, 'https://example.com/guide');
    for (const value of ['javascript:alert(1)', 'https://user:password@example.com', 'invalid']) {
        assert.equal(repo.normalizeSettings({ platformGuideVideoUrl: value }).platformGuideVideoUrl, '');
    }
    const defaultName = repo.getDefaultPlatformName();
    assert.equal((await repo.getSettings()).platformName, defaultName);
    await repo.saveSettings({ platformName: '  埃及运营平台  ' });
    await repo.saveSettings({ primaryIds: ['home'] });
    assert.equal((await repo.getSettings()).platformName, '埃及运营平台');
    assert.equal(repo.mergeDefaultSettingsPreservingCustomTools(await repo.getSettings()).platformName, '埃及运营平台');
    await runWithTenant('brand-other', async () => {
        assert.equal((await repo.getSettings()).platformName, defaultName);
        await repo.saveSettings({ platformName: 'Other Operations' });
    });
    assert.equal((await repo.getSettings()).platformName, '埃及运营平台');
    await repo.saveSettings({ platformName: '' });
    assert.equal((await repo.getSettings()).platformName, defaultName);
    assert.equal((await runWithTenant('brand-other', () => repo.getSettings())).platformName, 'Other Operations');
});

test('legacy, invalid, blank and oversized names have stable defaults and limits', () => {
    const defaultName = repo.getDefaultPlatformName();
    for (const platformName of [undefined, null, {}, '   ', '\n\t']) {
        assert.equal(repo.normalizeSettings({ platformName }).platformName, defaultName);
    }
    assert.equal(repo.normalizeSettings({ platformName: 'A\nB\u007f' }).platformName, 'AB');
    assert.equal(repo.normalizeSettings({ platformName: 'a'.repeat(100) }).platformName.length, 80);
});

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
function fixture() {
    const nodes = [{}, {}], images = new Map([['navBrandLogo', {}], ['homeHeroLogo', {}]]);
    const document = {
        title: 'Tools Platform - 工具中台',
        querySelectorAll: () => nodes,
        getElementById: id => images.get(id),
        querySelector: () => ({})
    };
    const context = { document, navState: { settings: { platformName: '运营 <中心>' } }, MutationObserver: class { observe() {} } };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('let platformTitleOriginal'), source.indexOf('function getAllNavItems()')), context);
    return { context, document, nodes, images };
}

test('branding updates safe text and titles, preserves page names and handles language changes and reverting', () => {
    const { context, document, nodes, images } = fixture();
    context.applyPlatformIdentity();
    assert.equal(nodes[0].textContent, '运营 <中心>');
    assert.equal(images.get('homeHeroLogo').alt, '运营 <中心>');
    assert.equal(document.title, '运营 <中心> - 工具中台');
    document.title = 'Reports - Tools Platform';
    context.applyPlatformTitle();
    assert.equal(document.title, 'Reports - 运营 <中心>');
    context.navState.settings.platformName = 'Tools Platform';
    context.applyPlatformIdentity();
    assert.equal(document.title, 'Reports - Tools Platform');
    context.navState.settings.platformName = 'Another';
    context.applyPlatformIdentity();
    assert.equal(document.title, 'Reports - Another');
    document.title = 'Standalone report';
    context.applyPlatformTitle();
    assert.equal(document.title, 'Standalone report');
    document.title = '图特工具平台 - 工具中台';
    context.applyPlatformTitle();
    assert.equal(document.title, 'Another - 工具中台');
});

test('frontend index.html static title does not contain legacy names like EG CS HUB', () => {
    const html = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
    const match = html.match(/<title>([^<]+)<\/title>/);
    assert.ok(match, 'index.html should have a title tag');
    assert.ok(!match[1].includes('EG CS HUB'), 'index.html static title must not contain EG CS HUB');
    assert.ok(match[1].includes('图特工具平台'), 'index.html static title should contain 图特工具平台');
});

test('failed name saves keep the prior branding and release the save button', async () => {
    const { context, document } = fixture();
    const controls = {
        platformNameInput: { value: 'New Name' }, platformNameSaveBtn: { disabled: false }, platformNameSaveStatus: {}
    };
    document.getElementById = id => controls[id];
    Object.assign(context, {
        window: {}, clearTimeout, navT: key => key, getAuthHeaderForNav: () => ({}),
        fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'Admin required' }) })
    });
    const start = source.indexOf('window.savePlatformName =');
    vm.runInContext(source.slice(start, source.indexOf('window.handleLogoFileSelect =', start)), context);
    await context.window.savePlatformName();
    assert.equal(context.navState.settings.platformName, '运营 <中心>');
    assert.equal(controls.platformNameSaveBtn.disabled, false);
    assert.match(controls.platformNameSaveStatus.textContent, /Admin required/);
});

test('successful name save applies canonical server value and keeps other settings', async () => {
    const { context, document } = fixture();
    const controls = {
        platformNameInput: { value: '  New Name  ' }, platformNameSaveBtn: { disabled: false }, platformNameSaveStatus: {}
    };
    const originalGet = document.getElementById;
    document.getElementById = id => controls[id] || originalGet(id);
    let payload, cached = false, applied = false;
    context.navState.settings.primaryIds = ['home'];
    Object.assign(context, {
        window: {}, clearTimeout, navT: key => key, getAuthHeaderForNav: () => ({}),
        normalizeNavSettings: data => data,
        writeNavigationBootstrapCache: () => { cached = true; },
        renderNavLinksFromState: () => { applied = true; context.applyPlatformIdentity(); },
        fetch: async (_url, options) => {
            payload = JSON.parse(options.body);
            return { ok: true, json: async () => payload };
        }
    });
    const start = source.indexOf('window.savePlatformName =');
    vm.runInContext(source.slice(start, source.indexOf('window.handleLogoFileSelect =', start)), context);
    await context.window.savePlatformName();
    assert.equal(payload.platformName, 'New Name');
    assert.deepEqual(payload.primaryIds, ['home']);
    assert.equal(document.title, 'New Name - 工具中台');
    assert.equal(controls.platformNameInput.value, 'New Name');
    assert.ok(cached && applied);
    assert.equal(controls.platformNameSaveBtn.disabled, false);
});

test('login page synchronizes platform name, page title, logo and preserves branding across logout', async () => {
    const loginHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/login.html'), 'utf8');
    assert.ok(loginHtml.includes('data-platform-name'), 'login.html must include data-platform-name attribute');
    assert.ok(loginHtml.includes('id="loginBrandLogo"'), 'login.html must include id="loginBrandLogo"');
    assert.ok(loginHtml.includes('loadPlatformIdentity()'), 'login.html must invoke loadPlatformIdentity()');

    const store = new Map([['tools_platform_name', '先锋运维中台']]);
    const localStorage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
        clear: () => store.clear(),
        key: i => Array.from(store.keys())[i],
        get length() { return store.size; }
    };
    const brandNode = { textContent: 'Tools Platform', title: '' };
    const brandLogo = { src: '/assets/logo.png', alt: '' };
    const document = {
        title: '登录 - Tools Platform',
        querySelectorAll: selector => selector.includes('data-platform-name') ? [brandNode] : [],
        getElementById: id => id === 'loginBrandLogo' ? brandLogo : (id === 'loginBrandName' ? brandNode : null)
    };
    let currentLang = 'zh-CN';
    const ToolsI18n = {
        getLanguage: () => currentLang,
        t: key => key === 'login.pageTitle' ? (currentLang === 'en-US' ? 'Sign In - Tools Platform' : '登录 - Tools Platform') : key
    };

    const context = {
        document, localStorage, window: { ToolsI18n }, console,
        fetch: async url => {
            if (url === '/api/nav-settings') {
                return { ok: true, json: async () => ({ platformName: '埃及维护运营中心' }) };
            }
            if (url === '/api/platform-logo/status') {
                return { ok: true, json: async () => ({ ok: true, logoUrl: '/assets/logo.png?t=999' }) };
            }
            return { ok: false };
        }
    };
    vm.createContext(context);
    const scriptStart = loginHtml.indexOf('let currentPlatformName =');
    const scriptEnd = loginHtml.indexOf('function updateLoginLanguageUI()');
    vm.runInContext(loginHtml.slice(scriptStart, scriptEnd), context);

    await context.loadPlatformIdentity();
    assert.equal(brandNode.textContent, '埃及维护运营中心');
    assert.equal(brandLogo.alt, '埃及维护运营中心');
    assert.equal(brandLogo.src, '/assets/logo.png?t=999');
    assert.equal(document.title, '登录 - 埃及维护运营中心');
    assert.equal(localStorage.getItem('tools_platform_name'), '埃及维护运营中心');

    currentLang = 'en-US';
    context.updateLoginTitle();
    assert.equal(document.title, 'Sign In - 埃及维护运营中心');

    assert.ok(source.includes("key === 'tools_platform_name'"), 'doLogout must preserve tools_platform_name');
});

test('saving platform name in local environment auto-syncs to defaults/platform-identity.json', async () => {
    const configPath = path.join(__dirname, '../backend/defaults/platform-identity.json');
    assert.ok(fs.existsSync(configPath));
    const original = fs.readFileSync(configPath, 'utf8');
    const prevDataDir = process.env.TOOLS_DATA_DIR;
    delete process.env.TOOLS_DATA_DIR;
    try {
        await repo.saveSettings({ platformName: 'Auto Synced Brand' });
        const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(updated.platformName, 'Auto Synced Brand');
    } finally {
        fs.writeFileSync(configPath, original, 'utf8');
        process.env.TOOLS_DATA_DIR = prevDataDir;
        await repo.saveSettings({ platformName: repo.getDefaultPlatformName() });
    }
});

test('three-tier platform names and login slogan persist, normalize and flip order based on language', async () => {
    const defaultIdentity = repo.getDefaultPlatformIdentity();
    assert.equal(defaultIdentity.platformNameZh, 'Dragon 工具平台');
    assert.equal(defaultIdentity.platformNameEn, 'Dragon Platform');
    assert.equal(defaultIdentity.platformSubtitle, '埃及 CS 工具与知识中心');
    assert.ok(defaultIdentity.platformSlogan.includes('图特之羽'));

    await repo.saveSettings({
        platformNameZh: '智慧之翼中台',
        platformNameEn: 'Wing of Wisdom',
        platformSubtitle: '数字化协同枢纽',
        platformSubtitleEn: 'Digital Synergy Hub',
        platformSlogan: '“探寻智慧，连接万物。”',
        platformSloganEn: '“Seeking wisdom, connecting all.”'
    });
    const current = await repo.getSettings();
    assert.equal(current.platformNameZh, '智慧之翼中台');
    assert.equal(current.platformNameEn, 'Wing of Wisdom');
    assert.equal(current.platformSubtitle, '数字化协同枢纽');
    assert.equal(current.platformSubtitleEn, 'Digital Synergy Hub');
    assert.equal(current.platformSlogan, '“探寻智慧，连接万物。”');
    assert.equal(current.platformSloganEn, '“Seeking wisdom, connecting all.”');

    // Test frontend dual-language switching and slogan placement in login.html
    const loginHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/login.html'), 'utf8');
    assert.ok(loginHtml.includes('id="loginSloganWrap"'), 'login.html must have slogan container');
    assert.ok(loginHtml.includes('id="loginSloganPrimary"'), 'login.html must have primary slogan');
    assert.ok(loginHtml.includes('id="loginSloganSecondary"'), 'login.html must have secondary slogan');
    assert.ok(loginHtml.indexOf('class="footer-links"') < loginHtml.indexOf('id="loginSloganWrap"'),
        'login slogan must be placed below the privacy policy and terms footer links');

    // Clean up
    await repo.saveSettings({
        platformNameZh: defaultIdentity.platformNameZh,
        platformNameEn: defaultIdentity.platformNameEn,
        platformSubtitle: defaultIdentity.platformSubtitle,
        platformSubtitleEn: defaultIdentity.platformSubtitleEn,
        platformSlogan: defaultIdentity.platformSlogan,
        platformSloganEn: defaultIdentity.platformSloganEn,
        platformName: defaultIdentity.platformName
    });
});

test('sub-title is hidden when matching main title and auto-heals accidental English overwrite', () => {
    // 1. Backend repository heals accidental English overwrite of platformNameZh
    const healed = repo.normalizeSettings({
        platformName: 'Thoth Platform',
        platformNameZh: 'Thoth Platform',
        platformNameEn: 'Thoth Platform'
    });
    assert.equal(healed.platformNameZh, 'Dragon 工具平台', 'Accidental Thoth Platform in platformNameZh must heal to default Chinese name');
    assert.equal(healed.platformNameEn, 'Thoth Platform');

    // 2. Frontend login.html suppresses duplicate sub-title
    const loginHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/login.html'), 'utf8');
    const brandNode = { textContent: '', title: '' };
    const subNode = { textContent: 'Initial', style: { display: '' } };
    const subtitleNode = { textContent: '' };
    const sloganP1 = { textContent: '' };
    const sloganP2 = { textContent: '' };
    const brandLogo = { alt: '' };
    const document = {
        title: '',
        querySelectorAll: selector => selector.includes('data-platform-name') ? [brandNode] : [],
        getElementById: id => {
            if (id === 'loginBrandSub') return subNode;
            if (id === 'loginBrandSubtitle') return subtitleNode;
            if (id === 'loginSloganPrimary') return sloganP1;
            if (id === 'loginSloganSecondary') return sloganP2;
            if (id === 'loginBrandLogo') return brandLogo;
            return null;
        }
    };
    let currentLang = 'zh-CN';
    const ToolsI18n = {
        getLanguage: () => currentLang,
        t: key => key === 'login.pageTitle' ? (currentLang === 'en-US' ? 'Sign In - Tools Platform' : '登录 - Tools Platform') : key
    };
    const context = {
        document, localStorage: { getItem: () => null, setItem: () => {} }, window: { ToolsI18n }, console
    };
    vm.createContext(context);
    const scriptStart = loginHtml.indexOf('let currentPlatformName =');
    const scriptEnd = loginHtml.indexOf('function updateLoginLanguageUI()');
    vm.runInContext(loginHtml.slice(scriptStart, scriptEnd), context);

    // Test A: Normal distinct names (Chinese mode)
    context.applyLoginPlatformIdentity({
        platformNameZh: '图特工具平台',
        platformNameEn: 'Thoth Platform'
    });
    assert.equal(brandNode.textContent, '图特工具平台');
    assert.equal(subNode.textContent, 'Thoth Platform');
    assert.equal(subNode.style.display, '');

    // Test B: Switch to English mode
    currentLang = 'en-US';
    context.renderLoginIdentityUI();
    assert.equal(brandNode.textContent, 'Thoth Platform');
    assert.equal(subNode.textContent, '图特工具平台');
    assert.equal(subNode.style.display, '');

    // Test C: When passed accidental duplicate Thoth Platform data, it heals Chinese name
    context.applyLoginPlatformIdentity({
        platformName: 'Thoth Platform',
        platformNameZh: 'Thoth Platform',
        platformNameEn: 'Thoth Platform'
    });
    // In English mode:
    context.renderLoginIdentityUI();
    assert.equal(brandNode.textContent, 'Thoth Platform');
    assert.equal(subNode.textContent, 'Dragon 工具平台');
    assert.equal(subNode.style.display, '');

    // Test D: When user explicitly sets identical names for both Chinese and English, sub-title must be hidden
    context.applyLoginPlatformIdentity({
        platformName: 'CustomBrand',
        platformNameZh: 'CustomBrand',
        platformNameEn: 'CustomBrand'
    });
    // In English mode:
    context.renderLoginIdentityUI();
    assert.equal(brandNode.textContent, 'CustomBrand');
    assert.equal(subNode.style.display, 'none', 'Duplicate sub-title must be hidden in English mode');

    // In Chinese mode:
    currentLang = 'zh-CN';
    context.renderLoginIdentityUI();
    assert.equal(brandNode.textContent, 'CustomBrand');
    assert.equal(subNode.style.display, 'none', 'Duplicate sub-title must be hidden in Chinese mode');
});

test('public platform-identity and logo status endpoints allow unauthenticated access for login page', async () => {
    const { checkAuth } = require('../backend/middleware/auth');
    let logoNextCalled = false;
    const mockReq = { method: 'GET', path: '/platform-logo/status', headers: {} };
    const mockRes = {
        status(code) { this.statusCode = code; return this; },
        json(data) { this.data = data; return this; }
    };
    await checkAuth(mockReq, mockRes, () => { logoNextCalled = true; });
    assert.equal(logoNextCalled, true, 'GET /platform-logo/status should bypass auth');

    // Also verify login.html fetches /api/platform-identity
    const loginHtml = fs.readFileSync(path.join(__dirname, '../frontend/pages/login.html'), 'utf8');
    assert.ok(loginHtml.includes('/api/platform-identity'), 'login.html must fetch unauthenticated /api/platform-identity');
});


