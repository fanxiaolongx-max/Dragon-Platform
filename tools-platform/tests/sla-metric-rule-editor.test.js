// 指标条件值别名 [旧名]|[新名]，以及 Dragon 对话批量修改条件值：预览命中行数、应用、按处回退。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sla-metric-rule-editor-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const prefsRepo = require('../backend/models/sla-prefs-repository');
const snapshots = require('../backend/models/sla-snapshots-repository');
const editor = require('../backend/models/sla-metric-rule-editor');
const tools = require('../backend/models/agent-sla-rule-tools');
const extraction = require('../frontend/js/shared/metric-extraction');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('condition aliases: any alias matches; plain values, [空]/[非空] and literal bars keep their meaning', () => {
    const cases = [
        ['etisalat系统部', '[e&系统部]|[etisalat系统部]', true],
        ['e&系统部', '[e&系统部] | [etisalat系统部]', true],
        ['Orange系统部', '[e&系统部]|[etisalat系统部]', false],
        ['', '[空]|[已关闭]', true],
        ['x', '[非空]|[y]', true],
        ['a|b', 'a|b', true],
        ['[a]', '[a]', true],
        ['', '[空]', true],
        ['abc', '[非空]', true]
    ];
    for (const [cell, pattern, expected] of cases) assert.equal(extraction.cellMatches(cell, pattern), expected, `${cell} vs ${pattern}`);
    assert.equal(extraction.formatAliases(['e&系统部', 'etisalat系统部', 'e&系统部']), '[e&系统部]|[etisalat系统部]');
    assert.equal(extraction.formatAliases(['只有一个']), '只有一个');
    // 取数与高亮同一套逻辑：子指标用别名后能取到值
    const rows = [{ name: 'etisalat系统部', closed_rate: '1' }, { name: '汇总', closed_rate: '0.98' }];
    assert.equal(extraction.evaluate(rows, { type: 'extract', colX: 'name', valY: '[e&系统部]|[etisalat系统部]', colZ: 'closed_rate' }).value, '1');
});

const PREF_KEY = 'sla_prefs_other_eos';
const eosPrefs = () => ({
    visibleHeaders: ['name', 'closed_rate'],
    customMetrics: [
        { id: 'm_1', colX: 'name', valY: '汇总', colZ: 'closed_rate', label: '全量EOS-产品', subMetrics: [
            { category: 'TE', colX: 'name', valY: '虚拟系统部', colZ: 'closed_rate' },
            { category: 'ET', colX: 'name', valY: 'e&系统部', colZ: 'closed_rate' },
            { category: 'VDF', colX: 'name', valY: 'Vodafone系统部', colZ: 'closed_rate' }
        ] },
        { id: 'm_2', type: 'count', colX: 'name', valY: 'e&系统部', colZ: 'status', valK: '[非空]', label: 'ET 计数', conditions: [{ column: 'name', value: 'e&系统部' }] }
    ],
    _sourceMeta: { title: '产品EOS风险' }
});

async function seed() {
    await prefsRepo.upsertPrefItem(PREF_KEY, eosPrefs());
    await snapshots.addSnapshot({ id: 'snap-1', timestamp: '2026-11-17T08:00:00.000Z', topMetrics: [], sourceSections: [{ key: 'other_eos', rows: [
        { name: 'Vodafone系统部', closed_rate: '1', status: 'x' },
        { name: 'etisalat系统部', closed_rate: '1', status: 'x' },
        { name: '虚拟系统部', closed_rate: '0.9', status: '' },
        { name: '汇总', closed_rate: '0.97', status: '' }
    ] }] });
}

const currentMetrics = async () => (await prefsRepo.getPrefsObject({ mode: 'auto' })).items[PREF_KEY].customMetrics;

test('find lists zero-match conditions with the unmatched values from the latest import as candidates', () => runWithTenant('default', async () => {
    await seed();
    const result = await editor.find({ unmatched: true });
    const et = result.items.find(item => item.subCategory === 'ET');
    assert.equal(et.matchedRows, 0);
    assert.deepEqual(et.unmatchedValuesInData, ['etisalat系统部'], 'the renamed value is suggested, already-matched names are not');
    assert.ok(result.items.every(item => item.value === 'e&系统部'), 'only the stale value is reported');
    assert.equal(result.items.length, 3, 'sub-metric valY, count valY and its extra condition');
}));

test('adding an alias previews match counts, applies every location, and can be reverted per field', () => runWithTenant('default', async () => {
    const admin = { username: 'boss', role: 'admin' };
    const set = tools.toolset({ owner: 'default::boss', user: admin });
    const args = { replacements: [{ from: 'e&系统部', addAliases: ['etisalat系统部'] }], summary: '系统部改名' };

    const preview = await set.preview('sla_update_metric_conditions', args);
    assert.match(preview.path, /修改 3 处/);
    assert.match(preview.diff, /- e&系统部\n\+ \[e&系统部\]\|\[etisalat系统部\]\n  命中 0 → 1 行/);
    assert.equal(set.kindOf('sla_update_metric_conditions'), 'confirm', 'every write asks the user');
    assert.equal(set.kindOf('sla_find_metric_rules'), 'read');

    const applied = await set.execute({ name: 'sla_update_metric_conditions', args });
    assert.ok(!applied.isError, applied.content);
    const changeId = applied.content.match(/rc_[a-z0-9_]+/)[0];
    let metrics = await currentMetrics();
    assert.equal(metrics[0].subMetrics[1].valY, '[e&系统部]|[etisalat系统部]');
    assert.equal(metrics[1].conditions[0].value, '[e&系统部]|[etisalat系统部]');
    assert.equal(metrics[0].subMetrics[0].valY, '虚拟系统部', 'other sub-metrics untouched');
    assert.equal((await editor.find({ unmatched: true })).items.length, 0, 'nothing is left without a match');
    // 再加一次同样的别名不会重复改
    assert.equal((await editor.plan(args)).changes.length, 0);

    // 用户之后在页面上又改了其中一处：回退时不覆盖它
    const prefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items[PREF_KEY];
    prefs.customMetrics[1].valY = '手动改的';
    await prefsRepo.upsertPrefItem(PREF_KEY, prefs);

    const reverted = await set.execute({ name: 'sla_revert_metric_rule_change', args: { changeId } });
    assert.ok(!reverted.isError, reverted.content);
    assert.match(reverted.content, /已回退 2 处/);
    assert.match(reverted.content, /现在是「手动改的」/);
    metrics = await currentMetrics();
    assert.deepEqual([metrics[0].subMetrics[1].valY, metrics[1].valY, metrics[1].conditions[0].value], ['e&系统部', '手动改的', 'e&系统部']);

    const history = await editor.listChanges();
    assert.equal(history[0].revertOf, changeId);
    assert.equal(history[1].revertedBy, history[0].id);
    const again = await set.execute({ name: 'sla_revert_metric_rule_change', args: { changeId } });
    assert.ok(again.isError, 'a change is reverted only once');
    // 回退的回退 = 恢复
    const redo = await set.execute({ name: 'sla_revert_metric_rule_change', args: { changeId: history[0].id } });
    assert.ok(!redo.isError, redo.content);
    assert.equal((await currentMetrics())[0].subMetrics[1].valY, '[e&系统部]|[etisalat系统部]');
}));

test('plain replacement, scope filters, warnings and permissions', () => runWithTenant('default', async () => {
    await prefsRepo.upsertPrefItem(PREF_KEY, eosPrefs());
    const planned = await editor.plan({ replacements: [{ from: 'e&系统部', to: '不存在的名字' }, { from: '没有这个值', to: 'x' }], metricLabels: ['全量EOS'] });
    assert.equal(planned.changes.length, 1, 'metricLabels limits the scope');
    assert.ok(planned.warnings.some(text => /仍然一行都匹配不到/.test(text)));
    assert.ok(planned.warnings.some(text => /没有找到条件值：没有这个值/.test(text)));
    await assert.rejects(editor.plan({ replacements: [{ from: 'e&系统部', addAliases: ['坏[别名]'] }] }), /不能含有/);

    const viewer = tools.toolset({ owner: 'default::guest', user: { username: 'guest', role: 'readonly' } });
    const denied = await viewer.execute({ name: 'sla_find_metric_rules', args: {} });
    assert.ok(denied.isError);
    assert.equal(tools.isAdmin({ role: 'readonly' }), false);
    assert.equal(require('../backend/models/agent-tool-access').groupFor('sla_update_metric_conditions'), 'sla_rules', 'admins can switch the group off in tool settings');
}));
