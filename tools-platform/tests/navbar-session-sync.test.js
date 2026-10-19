const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'shared', 'navbar.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const wanted = new Set(['syncNavUserSession', 'promptNavRelogin']);
const isolated = ast.body.filter(node => (node.type === 'FunctionDeclaration' && wanted.has(node.id.name))
    || (node.type === 'VariableDeclaration' && node.declarations.some(d => d.id.name === 'navReloginPrompted')))
    .map(node => source.slice(node.start, node.end)).join('\n');

function createPage({ local = {}, me = { status: 200, body: { username: 'admin', role: 'admin', tenantId: 'default' } }, confirm = true } = {}) {
    const store = new Map(Object.entries(local));
    const calls = { render: 0, prompts: [], chip: '' };
    const context = {
        localStorage: { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)) },
        sessionStorage: { getItem: () => null },
        fetch: async () => ({ ok: me.status === 200, status: me.status, json: async () => me.body }),
        renderNavbar() { calls.render += 1; },
        hasNavAuthToken: () => store.has('tools_token'),
        showNavbarConfirm: async options => { calls.prompts.push(options); return confirm; },
        navT: key => key,
        navEscape: value => String(value),
        activeTenantName: () => '默认租户',
        stopAlertCenterPolling() {},
        document: { querySelector: () => ({ set innerHTML(value) { calls.chip = value; } }) },
        window: { location: { pathname: '/', href: '/', replace(url) { this.href = url; } } }
    };
    vm.createContext(context);
    vm.runInContext(`${isolated}\nthis.sync = syncNavUserSession;`, context);
    return { context, store, calls };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('a role learned from the server re-renders the navbar so admin buttons appear', async () => {
    const page = createPage({ local: { tools_token: 't' } });
    await page.context.sync();
    await settle();
    assert.equal(page.calls.render, 1);
    assert.equal(page.store.get('tools_role'), 'admin');
    assert.equal(page.calls.prompts.length, 0);
});

test('an unchanged session only refreshes the user chip', async () => {
    const page = createPage({ local: { tools_token: 't', tools_role: 'admin', tools_user: 'admin' } });
    await page.context.sync();
    await settle();
    assert.equal(page.calls.render, 0);
    assert.match(page.calls.chip, /admin/);
});

test('a cookie-only session (no local token) asks once to sign in again and goes to the login page', async () => {
    const page = createPage();
    await page.context.sync();
    await settle();
    assert.equal(page.calls.prompts.length, 1);
    assert.equal(page.calls.prompts[0].confirmText, 'nav.relogin.confirm');
    assert.equal(page.context.window.location.href, '/login.html');
    await page.context.sync();
    await settle();
    assert.equal(page.calls.prompts.length, 1, 'the prompt is not repeated on the same page');
});

test('choosing later keeps the user on the page', async () => {
    const page = createPage({ confirm: false });
    await page.context.sync();
    await settle();
    assert.equal(page.calls.prompts.length, 1);
    assert.equal(page.context.window.location.href, '/');
});

test('an expired session still redirects to login without the re-login prompt', async () => {
    const page = createPage({ me: { status: 401, body: {} } });
    await page.context.sync();
    await settle();
    assert.equal(page.calls.prompts.length, 0);
    assert.equal(page.context.window.location.href, '/login.html');
});

test('both languages define the re-login texts', () => {
    for (const key of ['nav.relogin.title', 'nav.relogin.message', 'nav.relogin.hint', 'nav.relogin.confirm', 'nav.relogin.later']) {
        assert.equal(source.split(`'${key}':`).length - 1, 2, key);
    }
});

function preferencePage() {
    const store = new Map([
        ['tools_user', 'alice'], ['tools_token', 'test-session'], ['tools_tenant_id', 'default'],
        ['home_sidebar_width:default:alice:chat', '424'], ['home_sidebar_width:other:alice:tools', '368'],
        ['ordinary_pref', 'default-value']
    ]);
    const context = {
        localStorage: {
            get length() { return store.size; }, key: index => [...store.keys()][index] || null,
            getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)),
            removeItem: key => store.delete(key), clear: () => store.clear()
        },
        sessionStorage: { clear() {} }, console, fetch: async () => ({}), stopAlertCenterPolling() {},
        window: { location: { href: '/' } }, document: { cookie: '' }, NAV_BOOTSTRAP_CACHE_KEY: 'nav-cache'
    };
    const nodes = ast.body.filter(node =>
        (node.type === 'FunctionDeclaration' && node.id.name === 'switchTenantBrowserState')
        || (node.type === 'VariableDeclaration' && node.declarations.some(d => ['TENANT_BROWSER_STATE_PREFIX', 'TENANT_BROWSER_GLOBAL_KEYS'].includes(d.id.name)))
        || (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left.property?.name === 'doLogout'));
    vm.createContext(context);
    vm.runInContext(nodes.map(node => source.slice(node.start, node.end)).join('\n'), context);
    return { store, context };
}

test('logout preserves account-scoped sidebar widths while removing authentication state', async () => {
    const { context, store } = preferencePage();
    await context.window.doLogout();
    assert.equal(store.get('home_sidebar_width:default:alice:chat'), '424');
    assert.equal(store.get('home_sidebar_width:other:alice:tools'), '368');
    assert.equal(store.has('tools_token'), false);
    assert.equal(store.has('tools_user'), false);
    assert.equal(context.window.location.href, '/login.html');
});

test('tenant switching retains explicitly scoped sidebar widths and still switches ordinary browser state', () => {
    const { context, store } = preferencePage();
    vm.runInContext("switchTenantBrowserState('default', 'other')", context);
    assert.equal(store.get('home_sidebar_width:default:alice:chat'), '424');
    assert.equal(store.get('home_sidebar_width:other:alice:tools'), '368');
    assert.equal(store.has('ordinary_pref'), false);
    store.set('ordinary_pref', 'other-value');
    vm.runInContext("switchTenantBrowserState('other', 'default')", context);
    assert.equal(store.get('ordinary_pref'), 'default-value');
    assert.equal(store.get('home_sidebar_width:default:alice:chat'), '424');
});
