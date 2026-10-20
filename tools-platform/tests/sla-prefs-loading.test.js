const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(get) {
    const state = { one: { schemaHash: 'sla_prefs_other_one', orderedHeaders: ['value'], customMetrics: [] } };
    const window = {};
    const ctx = vm.createContext({ window, AppState: state, API: { get, getSourceMode: () => 'auto' }, setTimeout: fn => fn() });
    vm.runInContext(fs.readFileSync(require.resolve('../frontend/js/sla/prefs.js'), 'utf8'), ctx);
    return { state, load: () => window.SLAPrefs.loadPrefs('one') };
}

test('transient preference failures retry instead of silently dropping configured metrics', async () => {
    let calls = 0;
    const rules = [{ id: 'm_one', label: '数字证书' }];
    const f = fixture(async () => {
        if (++calls < 3) throw new Error('HTTP 503');
        return { customMetrics: rules };
    });
    await f.load();
    assert.equal(calls, 3);
    assert.equal(f.state.one.hasSavedPrefs, true);
    assert.deepEqual(f.state.one.customMetrics, rules);
});

test('exhausted preference retries reject the import rather than produce an incomplete success snapshot', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; throw new Error('HTTP 503'); });
    await assert.rejects(f.load(), /HTTP 503/);
    assert.equal(calls, 3);
});

test('a successful null response still allows genuinely unconfigured tables to import', async () => {
    let calls = 0;
    const f = fixture(async () => { calls++; return null; });
    await f.load();
    assert.equal(calls, 1);
    assert.equal(f.state.one.hasSavedPrefs, false);
    assert.equal(f.state.one.customMetrics.length, 0);
});
