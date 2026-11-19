const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const corePath = path.join(__dirname, '../frontend/js/shared/platform-core.js');
const coreSource = fs.readFileSync(corePath, 'utf8');

function extractBannerBlock() {
    const start = coreSource.indexOf('function ensureViewingTeamBannerStyle()');
    const end = coreSource.indexOf('function activeTenantName()');
    assert.ok(start > 0 && end > start, 'viewing team banner block must exist in platform-core.js');
    return coreSource.slice(start, end);
}

function makeElement(tag = 'div') {
    const attrs = new Map();
    const classes = new Set();
    let html = '';
    const node = {
        tagName: tag.toUpperCase(),
        id: '',
        disabled: false,
        title: '',
        style: {},
        children: [],
        listeners: new Map(),
        setAttribute(k, v) { attrs.set(k, String(v)); },
        getAttribute(k) { return attrs.get(k); },
        removeAttribute(k) { attrs.delete(k); },
        get classList() {
            return {
                add: (...names) => names.forEach(n => classes.add(n)),
                remove: (...names) => names.forEach(n => classes.delete(n)),
                contains: n => classes.has(n)
            };
        },
        set innerHTML(v) {
            html = String(v);
            if (html.includes('nav-viewing-btn')) {
                const btn = makeElement('button');
                btn.className = 'nav-viewing-btn';
                node.children = [btn];
            }
        },
        get innerHTML() { return html; },
        querySelector(sel) {
            if (sel === '.nav-viewing-btn') return node.children[0] || null;
            return null;
        },
        addEventListener(type, fn) { node.listeners.set(type, fn); },
        appendChild(child) { node.children.push(child); return child; },
        getBoundingClientRect() { return { width: 224, height: 40 }; },
        get offsetWidth() { return 224; },
        remove() { node._removed = true; }
    };
    return node;
}

test('viewing team banner morphs capsule to 40px spinner on click, deduplicates clicks, and restores on failure', async () => {
    const byId = new Map();
    const body = makeElement('body');
    const head = makeElement('head');
    head.appendChild = child => { if (child.id) byId.set(child.id, child); return child; };
    body.appendChild = child => { if (child.id) byId.set(child.id, child); return child; };
    const document = {
        head,
        body,
        documentElement: head,
        createElement: tag => makeElement(tag),
        getElementById: id => byId.get(id) || null
    };

    let fetchCalls = 0;
    let resolveFetch;
    const alerts = [];
    const storage = new Map([['tools_tenant_id', 'team-a']]);
    const localStorage = {
        getItem: k => storage.get(k) ?? null,
        setItem: (k, v) => storage.set(k, String(v))
    };
    const location = { href: '/tools/demo' };
    const context = {
        document,
        window: {
            ToolsI18n: { getLanguage: () => 'zh-CN' },
            AppDialog: { alert: async msg => { alerts.push(msg); } },
            location
        },
        localStorage,
        navState: { viewingTeam: { id: 'team-a', name: '测试团队' }, homeTenantId: 'default' },
        navEscape: v => String(v ?? ''),
        getAuthHeaderForNav: () => ({}),
        switchTenantBrowserState: () => {},
        fetch: async () => {
            fetchCalls += 1;
            return new Promise(resolve => { resolveFetch = resolve; });
        }
    };
    context.window.window = context.window;

    vm.runInNewContext(extractBannerBlock(), context);
    context.renderViewingTeamBanner();

    const style = byId.get('navViewingTeamBannerStyle');
    assert.ok(style, 'banner style injected');
    assert.match(style.textContent || '', /navViewingSpin/, 'spinner keyframes present');

    const bar = byId.get('navViewingTeamBanner');
    assert.ok(bar, 'banner rendered');
    assert.match(bar.innerHTML, /nav-viewing-spinner/);
    const btn = bar.querySelector('.nav-viewing-btn');
    assert.ok(btn);

    const clickPromise = btn.listeners.get('click')();
    assert.equal(bar.classList.contains('is-switching'), true, 'morphs into switching spinner immediately');
    assert.equal(bar.style.width, '40px', 'shrinks capsule smoothly to 40px circle');
    assert.equal(bar.getAttribute('aria-busy'), 'true');
    assert.equal(btn.disabled, true);

    await btn.listeners.get('click')();
    assert.equal(fetchCalls, 1, 'ignores duplicate clicks while switching');

    resolveFetch({ ok: false, json: async () => ({ error: '测试切换失败' }) });
    await clickPromise;
    assert.equal(bar.classList.contains('is-switching'), false, 'restores capsule when switch fails');
    assert.equal(bar.style.width, '', 'clears inline width');
    assert.equal(btn.disabled, false);
    assert.deepEqual(alerts, ['测试切换失败']);

    let resolveOk;
    context.fetch = () => new Promise(resolve => { resolveOk = resolve; });
    const okPromise = btn.listeners.get('click')();
    assert.equal(bar.classList.contains('is-switching'), true);
    resolveOk({ ok: true, json: async () => ({ ok: true }) });
    await okPromise;
    assert.equal(location.href, '/', 'navigates home on success while keeping spinner visible');
    assert.equal(bar.classList.contains('is-switching'), true, 'keeps spinner during page navigation');
});
