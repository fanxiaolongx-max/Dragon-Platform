const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
const variables = new Set(['serviceStatusDays', 'serviceStatusView', 'serviceStatusTimer', 'serviceStatusRequestSeq', 'serviceStatusRequestPending']);
const methods = new Set(['setServiceStatusView', 'closeServiceStatusModal', 'startServiceStatusPolling', 'clearServiceStatusPolling', 'loadServiceStatusHistory', 'setServiceStatusDays']);
const script = acorn.parse(source, { ecmaVersion: 'latest' }).body.filter(node => {
    if (node.type === 'VariableDeclaration') return node.declarations.some(item => variables.has(item.id.name));
    const left = node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression' && node.expression.left;
    return left?.object?.name === 'window' && methods.has(left.property.name);
}).map(node => source.slice(node.start, node.end)).join('\n');

function fixture() {
    const timers = new Map();
    const requests = [];
    const modal = { style: { display: 'flex' } };
    const content = { innerHTML: 'initial', scrollTop: 0 };
    const range = { innerHTML: '' };
    const nodes = { serviceStatusModal: modal, serviceStatusContent: content, serviceStatusRange: range };
    let timerId = 0;
    const context = vm.createContext({
        document: { hidden: false, getElementById: id => nodes[id], body: { classList: { remove() {} } } },
        window: {
            setInterval(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
            clearInterval(id) { timers.delete(id); },
            clearServiceRuntimeLogPolling() {},
            renderServiceRuntimeLogShell() { content.innerHTML = 'runtime logs'; },
            loadServiceRuntimeLogs() {}
        },
        canInspectServiceFailures: () => true,
        serviceStatusBi: zh => zh,
        navEscape: value => String(value),
        ensureServiceStatusModal: () => modal,
        renderServiceStatusHistory(data) { content.innerHTML = data.state; content.scrollTop = 0; },
        serviceStatusRequest(url) {
            return new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
        }
    });
    vm.runInContext(script, context);
    return { context, timers, requests, modal, content, window: context.window, tick: () => [...timers.values()][0]?.callback() };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('overview updates automatically without a loading flash or scroll jump', async () => {
    const f = fixture();
    f.window.setServiceStatusView('overview');
    assert.equal(f.timers.size, 1);
    assert.equal([...f.timers.values()][0].ms, 5000);
    f.requests[0].resolve({ state: 'connecting' });
    await settle();
    f.content.scrollTop = 420;
    f.tick();
    assert.equal(f.content.innerHTML, 'connecting');
    assert.equal(f.content.scrollTop, 420);
    f.requests[1].resolve({ state: 'connected' });
    await settle();
    assert.equal(f.content.innerHTML, 'connected');
    assert.equal(f.content.scrollTop, 420);
});

test('hidden pages and outstanding requests do not create polling traffic', async () => {
    const f = fixture();
    f.window.setServiceStatusView('overview');
    f.tick();
    f.tick();
    assert.equal(f.requests.length, 1);
    f.requests[0].resolve({ state: 'connected' });
    await settle();
    f.context.document.hidden = true;
    f.tick();
    assert.equal(f.requests.length, 1);
    f.context.document.hidden = false;
    f.tick();
    assert.equal(f.requests.length, 2);
    f.tick();
    assert.equal(f.requests.length, 2);
    f.requests[1].reject(new Error('offline'));
    await settle();
    assert.equal(f.content.innerHTML, 'connected', 'a failed background request preserves the last display');
    f.tick();
    assert.equal(f.requests.length, 3, 'polling recovers on the next tick');
    f.requests[2].resolve({ state: 'recovered' });
    await settle();
    assert.equal(f.content.innerHTML, 'recovered');
});

test('switching to logs or closing stops the timer and ignores late overview results', async () => {
    const f = fixture();
    f.window.setServiceStatusView('overview');
    f.window.setServiceStatusView('logs');
    assert.equal(f.timers.size, 0);
    f.requests[0].resolve({ state: 'stale overview' });
    await settle();
    assert.equal(f.content.innerHTML, 'runtime logs');
    f.window.setServiceStatusView('overview');
    f.window.setServiceStatusView('overview');
    assert.equal(f.timers.size, 1, 'reopening does not duplicate timers');
    f.window.closeServiceStatusModal();
    assert.equal(f.timers.size, 0);
    const before = f.content.innerHTML;
    f.requests[1].resolve({ state: 'older overview' });
    f.requests[2].resolve({ state: 'closed overview' });
    await settle();
    assert.equal(f.content.innerHTML, before);
    assert.equal(f.modal.style.display, 'none');
});

test('changing the history range discards an older automatic refresh response', async () => {
    const f = fixture();
    f.window.setServiceStatusView('overview');
    f.requests[0].resolve({ state: '90 days' });
    await settle();
    f.tick();
    f.window.setServiceStatusDays(30);
    assert.match(f.requests[2].url, /days=30$/);
    f.requests[2].resolve({ state: '30 days' });
    await settle();
    f.requests[1].resolve({ state: 'stale 90 days' });
    await settle();
    assert.equal(f.content.innerHTML, '30 days');
});
