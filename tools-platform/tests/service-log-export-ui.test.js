const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
const methods = new Set(['exportServiceRuntimeLogs', 'renderServiceRuntimeLogShell']);
const script = acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(node => {
    const left = node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left;
    return left?.object?.name === 'window' && methods.has(left.property.name);
}).map(node => source.slice(node.start, node.end)).join('\n');
function fixture() {
    const nodes = Object.fromEntries(['serviceRuntimeLogExportStatus', 'serviceRuntimeLogStartDate', 'serviceRuntimeLogEndDate', 'serviceStatusContent', 'serviceStatusRange'].map(id => [id, { value: '', textContent: '', innerHTML: '' }]));
    const buttons = [{ disabled: false }, { disabled: false }];
    const requests = [], downloads = [];
    let language = 'zh';
    const context = {
        window: { setTimeout() {}, toggleServiceRuntimeLogPolling() {} },
        document: {
            getElementById: id => nodes[id], querySelectorAll: () => buttons,
            body: { appendChild() {} },
            createElement: () => ({ click() { downloads.push(this.download); }, remove() {} })
        },
        Date, URLSearchParams, URL: { createObjectURL: () => 'blob:logs', revokeObjectURL() {} },
        localStorage: { getItem: () => 'test-token' },
        serviceStatusBi: (zh, en) => language === 'zh' ? zh : en,
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, headers: { get: () => 'application/zip' }, blob: async () => ({}) };
        }
    };
    vm.runInNewContext(script, context);
    return { context, nodes, buttons, requests, downloads, language: value => { language = value; } };
}

test('export controls render in Chinese and English and range validation prevents a request', async () => {
    const f = fixture();
    f.context.window.renderServiceRuntimeLogShell();
    assert.match(f.nodes.serviceStatusContent.innerHTML, /导出当天 ZIP/);
    f.language('en'); f.context.window.renderServiceRuntimeLogShell();
    assert.match(f.nodes.serviceStatusContent.innerHTML, /Export date range ZIP/);
    await f.context.window.exportServiceRuntimeLogs(false);
    assert.equal(f.requests.length, 0);
    assert.match(f.nodes.serviceRuntimeLogExportStatus.textContent, /valid start and end/);
});

test('range ZIP carries auth and local day boundaries, ignores search filters and saves download', async () => {
    const f = fixture();
    f.nodes.serviceRuntimeLogStartDate.value = '2026-11-01';
    f.nodes.serviceRuntimeLogEndDate.value = '2026-11-02';
    await f.context.window.exportServiceRuntimeLogs(false);
    const request = f.requests[0], params = new URL(request.url, 'http://local').searchParams;
    assert.equal(params.get('startDate'), '2026-11-01');
    assert.equal(params.get('endDate'), '2026-11-02');
    assert.equal(Number(params.get('startOffset')), new Date('2026-11-01T00:00:00').getTimezoneOffset());
    assert.equal(Number(params.get('endOffset')), new Date('2026-11-03T00:00:00').getTimezoneOffset());
    assert.equal(params.has('q'), false); assert.equal(params.has('levels'), false);
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.equal(request.options.credentials, 'same-origin');
    assert.deepEqual(f.downloads, ['service-logs-2026-11-01_2026-11-02.zip']);
    assert.ok(f.buttons.every(button => !button.disabled));
});

test('today uses local calendar and errors restore the buttons without downloading', async () => {
    const f = fixture();
    await f.context.window.exportServiceRuntimeLogs(true);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(new URL(f.requests[0].url, 'http://local').searchParams.get('startDate'), today);
    f.context.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
    await f.context.window.exportServiceRuntimeLogs(true);
    assert.match(f.nodes.serviceRuntimeLogExportStatus.textContent, /forbidden/);
    assert.equal(f.downloads.length, 1); assert.ok(f.buttons.every(button => !button.disabled));
});
