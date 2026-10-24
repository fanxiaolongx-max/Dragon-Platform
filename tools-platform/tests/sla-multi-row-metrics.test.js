const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const eventsPath = path.join(__dirname, '..', 'frontend', 'js', 'sla', 'events.js');
const source = fs.readFileSync(eventsPath, 'utf8');
const start = source.indexOf('function getMetricRuleConditions');
const end = source.indexOf('function buildMetricConditionFieldOptions');

assert.ok(start >= 0 && end > start, 'metric rule helper functions should remain extractable');

const helpers = vm.runInNewContext(`(() => {
    ${source.slice(start, end)}
    return { metricRuleRowMatches, parseMetricNumericValue, aggregateMetricRowValues };
})()`, { window: { MetricExtraction: require('../frontend/js/shared/metric-extraction') } });

test('legacy and single-row rules keep AND condition behavior', () => {
    const rule = {
        type: 'extract',
        colX: 'region',
        valY: 'North',
        filterLogic: 'or',
        conditions: [{ column: 'status', value: 'Done' }]
    };

    assert.equal(helpers.metricRuleRowMatches({ region: 'North', status: 'Open' }, rule), false);
    assert.equal(helpers.metricRuleRowMatches({ region: 'North', status: 'Done' }, rule), true);
});

test('multi-row OR matches the primary condition or any advanced condition', () => {
    const rule = {
        type: 'extract_multi',
        colX: 'region',
        valY: 'North',
        filterLogic: 'or',
        conditions: [
            { column: 'team', value: 'Core' },
            { column: 'status', value: '[空]' }
        ]
    };

    assert.equal(helpers.metricRuleRowMatches({ region: 'North', team: 'Edge', status: 'Open' }, rule), true);
    assert.equal(helpers.metricRuleRowMatches({ region: 'North', team: 'Core', status: 'Open' }, rule), true);
    assert.equal(helpers.metricRuleRowMatches({ region: 'North', team: 'Edge', status: '' }, rule), true);
    assert.equal(helpers.metricRuleRowMatches({ region: 'South', team: 'Core', status: 'Open' }, rule), true);
    assert.equal(helpers.metricRuleRowMatches({ region: 'South', team: 'Edge', status: '' }, rule), true);
    assert.equal(helpers.metricRuleRowMatches({ region: 'South', team: 'Edge', status: 'Open' }, rule), false);
});

test('multi-row rules without advanced conditions only require the primary condition', () => {
    const rule = { type: 'extract_multi', colX: 'region', valY: 'North', filterLogic: 'or', conditions: [] };
    assert.equal(helpers.metricRuleRowMatches({ region: 'North' }, rule), true);
    assert.equal(helpers.metricRuleRowMatches({ region: 'South' }, rule), false);
});

test('multi-row aggregation defaults to sum and supports common calculations', () => {
    const rows = [{ amount: '1,200.5' }, { amount: 99.5 }, { amount: '' }, { amount: 'not a number' }];
    const rule = { colZ: 'amount' };

    assert.equal(helpers.aggregateMetricRowValues(rows, rule), 1300);
    assert.equal(helpers.aggregateMetricRowValues(rows, { ...rule, aggregation: 'avg' }), 650);
    assert.equal(helpers.aggregateMetricRowValues(rows, { ...rule, aggregation: 'max' }), 1200.5);
    assert.equal(helpers.aggregateMetricRowValues(rows, { ...rule, aggregation: 'min' }), 99.5);
    assert.equal(helpers.aggregateMetricRowValues(rows, { ...rule, aggregation: 'count' }), 2);
});

test('multi-row aggregation preserves percentage units and handles empty numeric results', () => {
    const rule = { colZ: 'rate', aggregation: 'sum' };
    assert.equal(helpers.aggregateMetricRowValues([{ rate: '12.5%' }, { rate: '7.5%' }], rule), '20%');
    assert.equal(helpers.aggregateMetricRowValues([{ rate: '-' }, { rate: null }], rule), '--');
});

test('evaluateAllMetrics respects scope: single-table isolation by default and cross-table aggregation when scope === "all"', () => {
    const metricsPath = path.join(__dirname, '..', 'frontend', 'js', 'sla', 'metrics.js');
    const metricsSource = fs.readFileSync(metricsPath, 'utf8');

    const context = {
        window: {},
        AppState: {
            sec1: {
                title: 'Table 1',
                globalData: [
                    { name: 'Alpha', status: 'OK', val: 10 },
                    { name: 'Beta', status: 'Fail', val: 20 }
                ],
                customMetrics: []
            },
            sec2: {
                title: 'Table 2',
                globalData: [
                    { name: 'Gamma', status: 'OK', val: 30 },
                    { name: 'Delta', status: 'OK', val: 40 }
                ],
                customMetrics: []
            }
        },
        getMetricRuleDisplayLabel: (rule) => rule.label,
        metricRuleRowMatches: helpers.metricRuleRowMatches,
        aggregateMetricRowValues: helpers.aggregateMetricRowValues,
        renderTopStickyBar: () => {},
        localStorage: { getItem: () => null, setItem: () => {} },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} }
    };

    vm.createContext(context);
    vm.runInContext(metricsSource, context);
    context.renderTopStickyBar = () => {};

    // Rule 1: default scope (undefined) in sec1 -> only aggregates sec1 (10 + 20 = 30)
    const ruleDefault = {
        id: 'r_default',
        label: 'Default Scope Sum',
        type: 'extract_multi',
        colZ: 'val',
        aggregation: 'sum'
    };

    // Rule 2: scope === 'all' in sec1 -> aggregates sec1 + sec2 (10 + 20 + 30 + 40 = 100)
    const ruleAll = {
        id: 'r_all',
        label: 'Cross Table Sum',
        type: 'extract_multi',
        colZ: 'val',
        aggregation: 'sum',
        scope: 'all'
    };

    // Rule 3: scope === 'all' single extract searching for row only present in sec2
    const ruleExtractCross = {
        id: 'r_extract_cross',
        label: 'Cross Extract',
        type: 'extract',
        colX: 'name',
        valY: 'Gamma',
        colZ: 'val',
        scope: 'all'
    };

    // Rule 4: scope === 'current' single extract searching for row only present in sec2 -> should be '--'
    const ruleExtractLocal = {
        id: 'r_extract_local',
        label: 'Local Extract',
        type: 'extract',
        colX: 'name',
        valY: 'Gamma',
        colZ: 'val',
        scope: 'current'
    };

    // Rule 5: scope === 'all' count
    const ruleCountAll = {
        id: 'r_count_all',
        label: 'Cross Count OK',
        type: 'count',
        colZ: 'status',
        valK: 'OK',
        scope: 'all'
    };

    // Rule 6: scope === 'current' count
    const ruleCountLocal = {
        id: 'r_count_local',
        label: 'Local Count OK',
        type: 'count',
        colZ: 'status',
        valK: 'OK',
        scope: 'current'
    };

    // Rule with sub-metrics: testing inheritance and explicit override
    const ruleWithSubs = {
        id: 'r_subs',
        label: 'Rule with Subs',
        type: 'extract_multi',
        colZ: 'val',
        aggregation: 'sum',
        scope: 'all',
        subMetrics: [
            { id: 'sub_inherited', label: 'Inherited Cross', type: 'extract_multi', colZ: 'val', aggregation: 'sum' },
            { id: 'sub_explicit_local', label: 'Explicit Local', type: 'extract_multi', colZ: 'val', aggregation: 'sum', scope: 'current' }
        ]
    };

    context.AppState.sec1.customMetrics = [
        ruleDefault,
        ruleAll,
        ruleExtractCross,
        ruleExtractLocal,
        ruleCountAll,
        ruleCountLocal,
        ruleWithSubs
    ];

    context.evaluateAllMetrics();

    const m = context.window.GlobalMetrics;
    assert.equal(m['sec1_r_default'].value, 30, 'Default scope must isolate to current section');
    assert.equal(m['sec1_r_all'].value, 100, 'Cross-table scope must aggregate all active sections');
    assert.equal(m['sec1_r_extract_cross'].value, 30, 'Cross-table extract should find value from other section');
    assert.equal(m['sec1_r_extract_local'].value, '--', 'Local extract must not look into other section');
    assert.equal(m['sec1_r_count_all'].value, 3, 'Cross-table count should sum OK across both tables');
    assert.equal(m['sec1_r_count_local'].value, 1, 'Local count should only count OK in sec1');

    // Check sub-metrics
    const subs = m['sec1_r_subs'].subMetrics;
    assert.equal(subs[0].value, 100, 'Sub-metric without scope inherits parent cross-table scope');
    assert.equal(subs[1].value, 30, 'Sub-metric with scope="current" stays isolated to local table');
});
