const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
    const state = {}, writes = [], cache = new Map();
    const content = { innerHTML: '', querySelectorAll: () => [] };
    const elements = {
        'sticky-bar-content': content,
        'btn-expand-metrics': { style: {} },
        'btn-target-config': { style: {} },
        slaTargetMonthSelect: { dataset: { ready: 'true' }, value: '10' }
    };
    const window = { AppState: state, GlobalTargets: {}, GlobalMetrics: {} };
    const ctx = vm.createContext({
        window, AppState: state, Blob, Intl, console: { log() {}, info() {}, warn() {}, error() {} },
        document: {
            getElementById: id => elements[id] || null,
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {}
        },
        API: { post: async (url, body) => writes.push(JSON.parse(JSON.stringify(body))) },
        localStorage: { getItem: key => cache.get(key) || null, setItem: (key, val) => cache.set(key, val) },
        SLAT: key => key, escapeHTML: text => String(text), showToast() {},
        metricRuleRowMatches: () => true, metricRuleCellMatches: () => true,
        setTimeout
    });
    for (const file of ['upload.js', 'metrics.js']) {
        vm.runInContext(fs.readFileSync(require.resolve('../frontend/js/sla/' + file), 'utf8'), ctx);
    }
    return { window, state, ctx, content, writes, elements };
}

test('all 50 calculated metrics and children reach the snapshot even when sticky DOM has no items', async () => {
    const f = fixture();
    for (let i = 0; i < 50; i++) {
        const sec = 'other_' + i;
        f.state[sec] = {
            globalData: [{ value: i }], sourceFiles: [sec + '.csv'], orderedHeaders: ['value'],
            customMetrics: [{ id: 'm', label: '指标:' + i, type: 'extract', colZ: 'value',
                subMetrics: [{ id: 'sub', category: 'TE:区域', type: 'extract', colZ: 'value' }] }]
        };
        f.window.GlobalTargets[sec + '_m'] = { 9: 0, 10: 100, type: 'gte', isPercent: false };
    }
    vm.runInContext('evaluateAllMetrics()', f.ctx);
    assert.equal(Object.keys(f.window.GlobalMetrics).length, 50);
    // Simulate a stale/unavailable view; capture must use calculated values, including zero.
    await vm.runInContext("captureAndUploadSnapshot(['all.csv'], {source:'uivf12'})", f.ctx);
    const snap = f.writes[0];
    assert.equal(snap.topMetrics.length, 50);
    assert.equal(snap.importSource, 'uivf12');
    assert.equal(snap.selectedTargetMonth, 10);
    assert.equal(snap.topMetrics[0].label, '指标:0');
    assert.equal(snap.topMetrics[0].value, '0');
    assert.equal(snap.topMetrics[0].subMetrics[0].category, 'TE:区域');
    assert.equal(snap.topMetrics[0].subMetrics[0].value, '0');
    for (const metric of snap.topMetrics) {
        assert.equal(metric.savedTarget, 100);
        assert.equal(metric.isWarn, true);
        assert.match(metric.gap, /^差 /);
        assert.equal(metric.sourceFiles.length, 1);
    }
});

test('snapshot recalculates after all sources are ready and applies the selected month and zero targets', async () => {
    const f = fixture();
    f.state.one = { globalData: [{ value: 5 }], sourceFiles: ['one.csv'], customMetrics: [
        { id: 'm', label: '数量', type: 'extract', colZ: 'value' },
        { id: 'empty', label: '缺失值', type: 'extract', colZ: 'absent' }
    ] };
    f.window.GlobalTargets.one_m = { 9: 100, 10: 0, type: 'lte', isPercent: false };
    vm.runInContext('evaluateAllMetrics()', f.ctx);
    f.state.one.globalData[0].value = 8;
    await vm.runInContext("captureAndUploadSnapshot(['one.csv'])", f.ctx);
    const metric = f.writes[0].topMetrics.find(m => m.key === 'one_m');
    assert.equal(metric.value, '8');
    assert.equal(metric.savedTarget, 0);
    assert.equal(metric.isWarn, true);
    assert.equal(metric.gap, '超 8');
    assert.equal(f.writes[0].topMetrics.find(m => m.key === 'one_empty').value, '--');
});
