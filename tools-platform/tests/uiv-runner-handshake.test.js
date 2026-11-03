const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/uivf12/runner.js'), 'utf8');
function fixture() {
    const events = {}, timers = new Map(); let id = 0, sent = 0;
    const status = { textContent: '', classList: { add() {}, remove() {} } };
    const retry = { hidden: true, addEventListener: (_event, fn) => { retry.click = fn; } };
    const window = { addEventListener: (event, fn) => { events[event] = fn; }, dispatchEvent: () => { sent++; } };
    vm.runInNewContext(source, {
        window, document: { documentElement: { lang: 'zh-CN' }, getElementById: key => key === 'status' ? status : retry },
        setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: key => timers.delete(key),
        CustomEvent: function (name, options) { this.type = name; this.detail = options.detail; }
    });
    function tick(ms) { for (const [key, timer] of [...timers]) if (timer.ms === ms) { timers.delete(key); timer.fn(); } }
    window.UIVRunner.start({ Commands: [] });
    return { status, retry, events, timers, tick, sent: () => sent };
}
test('missing extension times out visibly, retries only on user action and accepts a late acknowledgement', () => {
    const f = fixture(); f.tick(500);
    assert.equal(f.sent(), 1); f.tick(12000);
    assert.equal(f.retry.hidden, false); assert.match(f.status.textContent, /未收到插件响应/);
    assert.equal(f.sent(), 1, 'no automatic duplicate execution');
    f.retry.click(); assert.equal(f.sent(), 2);
    f.events.kantuInvokeSuccess();
    assert.equal(f.retry.hidden, true); assert.equal(f.timers.size, 0);
    assert.match(f.status.textContent, /已接收宏/);
    f.retry.click(); assert.equal(f.sent(), 2, 'accepted macros cannot be run twice from this page');
});
