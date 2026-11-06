const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('tool-menu: resolveTarget resolves slug across id, key, href, and fallback custom tool registry', () => {
    const code = fs.readFileSync(path.join(__dirname, '../frontend/js/home/tool-menu.js'), 'utf8');

    const mockCustomTools = [
        { slug: 'ai-101', name: 'AI 101', nameEn: 'AI 101 Fundamentals', href: '/tools/ai-101' }
    ];

    const context = {
        console,
        window: {
            __homeCustomTools: mockCustomTools,
            ToolsI18n: { getLanguage: () => 'zh-CN' },
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        document: {
            documentElement: { lang: 'zh-CN', dataset: {} },
            body: { classList: { contains: () => false }, querySelector: () => null },
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        localStorage: { getItem: () => 'admin' },
        location: new URL('https://platform.test/'),
        URL
    };
    context.window.document = context.document;
    context.window.window = context.window;
    context.window.location = context.location;

    vm.createContext(context);
    vm.runInContext(code, context);

    const resolveTarget = context.window.HomeToolMenu.resolveTarget;

    // 1. item with id: 'tools/ai-101' (no leading slash)
    const target1 = resolveTarget({
        item: { id: 'tools/ai-101', title: 'AI 101', href: '/tools/ai-101' }
    });
    assert.equal(target1.slug, 'ai-101');
    assert.equal(target1.isCustom, true);

    // 2. item with id: 'custom:ai-101'
    const target2 = resolveTarget({
        item: { id: 'custom:ai-101', key: 'tool:custom:ai-101', title: 'AI 101', href: '/tools/ai-101' }
    });
    assert.equal(target2.slug, 'ai-101');
    assert.equal(target2.isCustom, true);

    // 3. iframe href '/custom-tools/ai-101/index.html'
    const target3 = resolveTarget({
        href: '/custom-tools/ai-101/index.html',
        title: 'AI 101'
    });
    assert.equal(target3.slug, 'ai-101');
    assert.equal(target3.isCustom, true);
});

test('home-page: update tool modal locks name inputs and disallows editing tool names', () => {
    const homePageJs = fs.readFileSync(path.join(__dirname, '../frontend/js/home/home-page.js'), 'utf8');

    // 1. Verifies that nameInput and nameEnInput are made readOnly and given is-locked class
    assert.ok(homePageJs.includes('nameInput.readOnly = true'), 'nameInput must be marked readOnly in update mode');
    assert.ok(homePageJs.includes("nameInput.classList.add('is-locked')"), 'nameInput must have is-locked class');
    assert.ok(homePageJs.includes('nameEnInput.readOnly = true'), 'nameEnInput must be marked readOnly in update mode');
    assert.ok(homePageJs.includes("nameEnInput.classList.add('is-locked')"), 'nameEnInput must have is-locked class');

    // 2. Verifies that updateSelectedFile does NOT overwrite name if currentUpdateTarget is present
    assert.ok(homePageJs.includes('if (!currentUpdateTarget) {'), 'updateSelectedFile must skip auto-naming in update mode');

    // 3. Verifies that generateAiMetadata does NOT overwrite name if currentUpdateTarget is present
    assert.ok(homePageJs.includes('if (!currentUpdateTarget) {\n                        if (nameInput.value === baseline.name && metadata.name) nameInput.value = metadata.name;'), 'generateAiMetadata must skip setting name in update mode');

    // 4. Verifies resetImportForm unlocks name inputs
    assert.ok(homePageJs.includes('nameInput.readOnly = false'), 'resetImportForm must unlock nameInput');
    assert.ok(homePageJs.includes('nameEnInput.readOnly = false'), 'resetImportForm must unlock nameEnInput');

    // 5. Verifies locked hint is unhidden
    assert.ok(homePageJs.includes('lockedHintEl.hidden = false'), 'Locked notice should be shown in update mode');
});

test('home-theme.css & home-page.css: is-locked input styles and locked hint styles are defined', () => {
    const themeCss = fs.readFileSync(path.join(__dirname, '../frontend/css/home-theme.css'), 'utf8');
    const homeCss = fs.readFileSync(path.join(__dirname, '../frontend/css/home-page.css'), 'utf8');

    assert.ok(themeCss.includes('.tool-import-locked-hint'), 'home-theme.css should style .tool-import-locked-hint');
    assert.ok(themeCss.includes('.is-locked'), 'home-theme.css should style .is-locked');
    assert.ok(homeCss.includes('.tool-import-locked-hint'), 'home-page.css should style .tool-import-locked-hint');
    assert.ok(homeCss.includes('.is-locked'), 'home-page.css should style .is-locked');
});
