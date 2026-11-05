const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
function runtime(href = 'https://platform.test/', embedded = false) {
    const handlers = {}, opened = [], redirects = [], classes = new Set();
    const doc = { nodeType: 9, querySelectorAll: () => [], addEventListener: (type, fn) => handlers[type] = fn, documentElement: { classList: { add: value => classes.add(value), contains: value => classes.has(value) } }, head: { append() {} }, createElement: () => ({}) };
    const location = new URL(href); location.assign = value => redirects.push(value); location.replace = value => redirects.push(value);
    const win = { open: (...args) => opened.push(args) }; win.top = embedded ? { document: { documentElement: { classList: { contains: () => embedded === 'clean' } } } } : win;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/tool-navigation.js'), 'utf8'), { window: win, document: doc, location, URL, MutationObserver: class { observe() {} } });
    return { api: win.ToolsNavigation, win, handlers, opened, redirects, classes };
}
test('registered core and all bundled tool windows are clean; shell URLs remain separate', () => {
    const { api } = runtime();
    const core = ['uivf12', 'sla', 'report', 'expedite', 'monthly', 'monthly/legacy', 'bigscreen', 'topic-analysis', 'requirements', 'frt', 'praudit', 'duty-roster', 'cinema', 'storage', 'db-explorer', 'netcare-explorer', 'python-updater'];
    for (const name of core) {
        const clean = new URL(api.toolUrl('/' + name + '?month=09#chart'), 'https://platform.test');
        assert.equal(clean.searchParams.get('standalone'), '1'); assert.equal(clean.hash, '#chart');
        assert.equal(new URL(api.shellUrl(clean.href), clean).searchParams.get('app'), '/' + name + '?month=09#chart');
    }
    for (const slug of fs.readdirSync(path.join(__dirname, '../backend/builtin-tools'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)) {
        assert.equal(api.toolUrl('/tools/' + slug), '/tools/' + slug + '?standalone=1');
        assert.equal(api.toolUrl('/custom-tools/' + slug + '/index.html?_t=12&script=a%26b#item'), '/tools/' + slug + '?script=a%26b&standalone=1#item');
    }
    assert.equal(api.toolUrl('/?app=%2Fmonthly'), '/monthly?standalone=1');
});
test('direct old routes migrate to shell; clean windows and embeds never redirect or loop', () => {
    assert.deepEqual(runtime('https://platform.test/monthly?month=9#cell').redirects, ['/?app=%2Fmonthly%3Fmonth%3D9%23cell']);
    assert.deepEqual(runtime('https://platform.test/monthly?standalone=1').redirects, []);
    assert.ok(runtime('https://platform.test/monthly?standalone=1').classes.has('is-clean-tool'));
    assert.deepEqual(runtime('https://platform.test/monthly', true).redirects, []);
    assert.deepEqual(runtime('https://platform.test/?app=%2Fmonthly').redirects, []);
    assert.ok(runtime('https://platform.test/custom-tools/demo/subpage.html', 'clean').classes.has('is-clean-tool'), 'nested documents inherit the clean window policy');
});
test('downloads, runners, external pages and attachments retain their purpose', () => {
    const { api, win, opened } = runtime();
    for (const href of ['https://external.test/report', '/api/files/a.pdf', '/custom-tools/demo/manual.pdf', 'blob:https://platform.test/id', '#chart', '/pages/uivision-runner-local.html#run', 'about:blank']) assert.equal(api.toolUrl(href), href);
    win.open('/sla?targetMonth=9', '_blank', 'noopener');
    assert.deepEqual(opened[0], ['/sla?targetMonth=9&standalone=1', '_blank', 'noopener']);
});
test('modified clicks are clean; ordinary clicks still embed after a context menu', () => {
    const { handlers, win } = runtime(); let href = '/report?month=9#row', embedded = '', closedPop = false;
    win.HomeV2 = { closePop: () => { closedPop = true; } };
    const link = { target: '', matches: () => true, hasAttribute: () => false, getAttribute: () => href, setAttribute: (_, value) => { href = value; } };
    handlers.contextmenu({ target: { closest: () => link } }); assert.equal(href, '/report?month=9&standalone=1#row');
    win.HomeToolFrame = { open: path => { embedded = path; return true; } };
    handlers.click({ button: 0, target: { closest: () => link }, preventDefault() {}, stopPropagation() {} }); assert.equal(embedded, '/report?month=9#row');
    assert.equal(closedPop, true, 'opening a tool closes any active popover');
    href = '/report'; link.hasAttribute = () => true;
    handlers.pointerdown({ button: 0, metaKey: true, target: { closest: () => link } }); assert.equal(href, '/report');
});
test('same-tab tool links retain a clean window instead of rebuilding the home shell', () => {
    const { handlers, redirects } = runtime('https://platform.test/sla?standalone=1');
    const link = { target: '', hasAttribute: () => false, getAttribute: () => '/monthly?month=9#cell' };
    handlers.click({ button: 0, target: { closest: () => link }, preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(redirects, ['/monthly?month=9&standalone=1#cell']);
});
