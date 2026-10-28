const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const read = file => fs.readFileSync(path.join(__dirname, '../frontend', file), 'utf8');
function storage(values = {}) {
    const data = new Map(Object.entries(values));
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
}
function apiPage() {
    const calls = [];
    const context = {
        window: { location: { origin: 'https://platform.test', pathname: '/' }, addEventListener() {} },
        localStorage: storage({ tools_user: 'admin', tools_token: 'session-a', tools_tenant_id: 'default' }),
        fetch: (url, options) => new Promise(resolve => calls.push({ url, options, resolve })), console
    };
    vm.createContext(context);
    vm.runInContext(read('js/shared/api.js').split('// 页面版本徽标统一显示')[0], context);
    const respond = (index, body, status = 200) => calls[index].resolve({
        ok: status === 200, status, json: async () => body,
        headers: { get: () => null, entries: () => [] }
    });
    return { context, calls, api: context.window.API, respond };
}

test('concurrent tool directory consumers share transport but not mutable results; later reads are fresh', async () => {
    const page = apiPage();
    const consumers = Array.from({ length: 3 }, () => page.api.get('/api/custom-tools'));
    assert.equal(page.calls.length, 1);
    page.respond(0, [{ slug: 'one' }]);
    const [a, b, c] = await Promise.all(consumers);
    a[0].slug = 'changed';
    assert.equal(b[0].slug, 'one');
    assert.equal(c[0].slug, 'one');
    const refreshed = page.api.get('/api/custom-tools');
    assert.equal(page.calls.length, 2);
    page.respond(1, [{ slug: 'new' }]);
    assert.equal((await refreshed)[0].slug, 'new');
});

test('in-flight directory reads are isolated by tenant, account and session', async () => {
    const page = apiPage();
    const reads = [page.api.get('/api/custom-tools')];
    for (const [key, value] of [['tools_tenant_id', 'other'], ['tools_user', 'alice'], ['tools_token', 'session-b']]) {
        page.context.localStorage.setItem(key, value);
        reads.push(page.api.get('/api/custom-tools'));
    }
    assert.equal(page.calls.length, 4);
    reads.forEach((_, index) => page.respond(index, [{ slug: String(index) }]));
    assert.deepEqual((await Promise.all(reads)).map(items => items[0].slug), ['0', '1', '2', '3']);
});

test('failed directory reads can retry and a successful tool write invalidates pending reuse', async () => {
    const page = apiPage();
    const failed = page.api.get('/api/custom-tools');
    page.respond(0, { error: 'Temporary failure' }, 503);
    await assert.rejects(failed, /Temporary failure/);
    const old = page.api.get('/api/custom-tools');
    const write = page.api.patch('/api/custom-tools/one/name', { name: 'renamed' });
    page.respond(2, { success: true });
    await write;
    const fresh = page.api.get('/api/custom-tools');
    assert.equal(page.calls.length, 4);
    page.respond(1, [{ slug: 'old' }]);
    await old;
    const shared = page.api.get('/api/custom-tools');
    assert.equal(page.calls.length, 4, 'old cleanup must not remove the newer in-flight request');
    page.respond(3, [{ slug: 'fresh' }]);
    assert.equal((await fresh)[0].slug, 'fresh');
    assert.equal((await shared)[0].slug, 'fresh');
});

test('a failed shared directory request still applies fresh navigation settings and retains existing tools', async () => {
    const source = read('js/shared/navbar.js');
    const context = {
        navState: { settings: {}, customTools: [{ slug: 'existing' }] },
        fetch: async () => ({ ok: true, json: async () => ({ primaryIds: ['home'] }) }),
        API: { get: async () => { throw new Error('offline'); } },
        getAuthHeaderForNav: () => ({}), normalizeNavSettings: value => value,
        writeNavigationBootstrapCache() {}, notifyRequirementPageCategoriesChanged() {}, renderNavLinksFromState() {},
        loadRecentNavTools: async () => {}, loadFavoriteNavTools: async () => {}, trackCurrentPageAsRecentNavTool() {},
        document: { getElementById: () => null }, console
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('async function loadNavigationData()'), source.indexOf('function activeTenantName()')), context);
    await context.loadNavigationData();
    assert.equal(context.navState.settings.primaryIds[0], 'home');
    assert.equal(context.navState.customTools[0].slug, 'existing');
});

function syncPage(sessionStorage = storage()) {
    const source = read('js/shared/navbar.js');
    let count = 0, now = 1000000, version = '1';
    const context = {
        window: { ToolsAppVersion: { get: async () => version } },
        localStorage: storage({ tools_role: 'admin', tools_user: 'admin', tools_tenant_id: 'default' }),
        sessionStorage, document: { getElementById: () => null },
        isBuiltinToolsSyncSnoozedToday: () => false, builtinToolsSyncChecking: false,
        Date: { now: () => now }, console, notices: 0,
        openBuiltinToolsSyncModal: () => { context.notices++; },
        API: { get: async () => { count++; return { pending: [] }; } }
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('const BUILTIN_SYNC_CHECK_TTL_MS'), source.indexOf('let pageScrollbarIdleTimer')), context);
    return { context, run: () => context.checkBuiltinToolsSync(), count: () => count, advance: ms => { now += ms; }, version: value => { version = value; } };
}

test('automatic clean checks survive navigation, expire after five minutes and isolate tenant/account/version', async () => {
    const session = storage();
    const page = syncPage(session);
    await page.run(); await page.run();
    assert.equal(page.count(), 1);
    const nextPage = syncPage(session);
    await nextPage.run();
    assert.equal(nextPage.count(), 0);
    page.advance(5 * 60 * 1000);
    await page.run();
    assert.equal(page.count(), 2);
    for (const [key, value] of [['tools_tenant_id', 'other'], ['tools_user', 'alice']]) {
        page.context.localStorage.setItem(key, value);
        await page.run();
    }
    page.version('2'); await page.run();
    assert.equal(page.count(), 5);
});

test('pending updates and failures are never cached; concurrent automatic checks do not overlap', async () => {
    const page = syncPage();
    let release, count = 0;
    page.context.API.get = () => { count++; return new Promise(resolve => { release = resolve; }); };
    const first = page.run();
    await Promise.resolve(); await Promise.resolve();
    await page.run();
    assert.equal(count, 1);
    release({ pending: [{ slug: 'update' }] }); await first;
    assert.equal(page.context.notices, 1);
    page.context.API.get = async () => { count++; throw new Error('offline'); };
    page.context.console = { warn() {} };
    await page.run(); await page.run();
    assert.equal(count, 3);
    assert.equal(page.context.builtinToolsSyncChecking, false);
});

test('automatic check storage/version failures do not prevent scanning; manual path bypasses cooldown', async () => {
    const page = syncPage({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
    await page.run(); await page.run();
    page.version(''); await page.run();
    page.context.window.ToolsAppVersion.get = async () => { throw new Error('offline'); };
    await page.run();
    assert.equal(page.count(), 4);
    const source = read('js/shared/navbar.js');
    const ast = acorn.parse(source, { ecmaVersion: 'latest' });
    const manual = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'fetchBuiltinToolsPreviewWithProgress');
    assert.ok(manual, 'manual comparison loader exists');
    const urls = [];
    page.context.fetch = async url => { urls.push(url); return { ok: false }; };
    page.context.getAuthHeaderForNav = () => ({});
    page.context.API.get = async url => { urls.push(url); return { pending: [{ slug: 'latest' }] }; };
    vm.runInContext(source.slice(manual.start, manual.end), page.context);
    const result = await page.context.fetchBuiltinToolsPreviewWithProgress(() => {});
    assert.equal(result.pending[0].slug, 'latest');
    assert.deepEqual(urls, ['/api/custom-tools/builtin-sync/preview-stream?manual=1', '/api/custom-tools/builtin-sync/preview?manual=1']);
});
