const test = require('node:test');
const assert = require('node:assert/strict');
const {
    findMatchedMetricLabels,
    buildProactiveAlertCandidates,
    buildProactiveTaskCandidates,
    enrichProactiveAlertWithDeepContext,
    generateRuleBasedDeepAnalysis,
    normalizeProactiveAiAnalysis
} = require('../backend/models/ai-report-analysis-service');

test('proactive analysis rejects token-limited responses even with sentence punctuation', () => {
    const text = 'ET 当前完成率为11%，低于50%的目标，需结合历史快照与其他客户群核对变化并优先推进整改。';
    for (const finishReason of ['length', 'MAX_TOKENS', 'max_output_tokens']) {
        assert.throws(() => normalizeProactiveAiAnalysis({ text, finishReason }), /未完整生成/);
    }
});

test('proactive analysis rejects title-only and unfinished responses without finish metadata', () => {
    for (const text of ['', '收编2025 (ET)*:', 'ET 当前完成率为11%，低于50%的目标。结合其他客户群与历史快照，本月需要优先关注的主要原因是']) {
        assert.throws(() => normalizeProactiveAiAnalysis({ text }), /内容不完整/);
    }
});

test('proactive analysis preserves complete Chinese and English output without slicing sentences', () => {
    const text = 'ET 当前完成率为11%，低于50%的目标，需核对历史快照并优先安排整改。'.repeat(10);
    assert.ok(text.length > 320);
    for (const finishReason of ['STOP', 'end_turn', 'stop_sequence', undefined]) {
        assert.equal(normalizeProactiveAiAnalysis({ text, finishReason }), text);
    }
    const english = 'ET is below target. Review the previous snapshot and assign an owner to close the largest gap.';
    assert.equal(normalizeProactiveAiAnalysis({ text: english, finishReason: 'stop' }), english);
});

test('matches a uniquely identifying shortened Chinese metric name', () => {
    const labels = ['存储整改', '路由器', '重疾EOS预案覆盖率'];

    assert.deepEqual(
        findMatchedMetricLabels(labels, '6 月存储的指标如何，和 7 月比怎么样'),
        ['存储整改']
    );
});

test('does not guess from a generic Chinese metric fragment', () => {
    const labels = ['存储整改', '整改确认及执行逾期'];

    assert.deepEqual(findMatchedMetricLabels(labels, '整改怎么样'), []);
});

test('prefers the most specific uniquely matched metric name', () => {
    const labels = ['预案', '重疾EOS预案覆盖率'];

    assert.deepEqual(findMatchedMetricLabels(labels, '重疾预案最近怎么样'), ['重疾EOS预案覆盖率']);
    assert.deepEqual(findMatchedMetricLabels(labels, '预案覆盖情况'), ['重疾EOS预案覆盖率']);
});

test('honors an explicit year for year-suffixed metric families', () => {
    const labels = ['重急EOS收编2025', '重急EOS收编2026'];

    assert.deepEqual(findMatchedMetricLabels(labels, '重急EOS收编2026怎么样'), ['重急EOS收编2026']);
    assert.deepEqual(findMatchedMetricLabels(labels, '重急EOS收编怎么样'), labels);
});

test('does not silently choose one metric for an ambiguous shorthand', () => {
    const labels = ['全量EOS-产品', '全量EOS-版本', '重急EOS'];

    assert.deepEqual(findMatchedMetricLabels(labels, 'EOS怎么样'), []);
    assert.deepEqual(findMatchedMetricLabels(labels, '全量EOS版本怎么样'), ['全量EOS-版本']);
});

test('keeps overlapping metric names when the user explicitly lists them', () => {
    const labels = ['日志回传', '日志回传备案', '日志稽查'];

    assert.deepEqual(
        findMatchedMetricLabels(labels, '日志回传、日志回传备案、日志稽查这三个指标当前值怎么样'),
        labels
    );
    assert.deepEqual(findMatchedMetricLabels(labels, '日志回传备案当前值怎么样'), ['日志回传备案']);
});

test('ranks proactive KPI alerts by business weight and gap', () => {
    const candidates = buildProactiveAlertCandidates([
        { cat_name: 'TE', metric_label: '收入', weight: 5, target_val: '≥10', raw_val: '6', gap: '4', is_failing: 1 },
        { cat_name: 'ORG', metric_label: '过保订单', weight: 8, target_val: '≥5', raw_val: '3', gap: '2', is_failing: 1 },
        { cat_name: 'ET', metric_label: '收入', weight: 5, target_val: '≥10', raw_val: '9', gap: '1', is_failing: 1 },
        { cat_name: 'VDF', metric_label: '质量', weight: 10, target_val: '≥95%', raw_val: '99%', gap: '', is_failing: 0 }
    ], 2);

    assert.equal(candidates.length, 2);
    assert.deepEqual(candidates.map(item => `${item.customerGroup}/${item.metric}`), ['ORG/过保订单', 'TE/收入']);
    assert.equal(candidates[0].target, '≥5');
    assert.equal(Object.hasOwn(candidates[0], 'priority'), false);
});

test('deduplicates proactive KPI alert candidates and requires a customer group', () => {
    const candidates = buildProactiveAlertCandidates([
        { cat_name: 'TE', metric_label: '收入', weight: 5, is_failing: 1 },
        { cat_name: 'ORG', metric_label: '收入', weight: 4, is_failing: 1 },
        { cat_name: '', metric_label: '收入', weight: 9, is_failing: 1 }
    ]);

    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].customerGroup, 'TE');
});

test('prioritizes imported KPI alerts over higher-weight manual metrics', () => {
    const candidates = buildProactiveAlertCandidates([
        { cat_name: 'TE', metric_label: '手动收入', weight: 20, gap: '9', is_failing: 1, is_manual: true },
        { cat_name: 'ORG', metric_label: '导入日志', weight: 1, gap: '1', is_failing: 1, is_manual: false }
    ]);

    assert.equal(candidates[0].metric, '导入日志');
    assert.equal(candidates[0].sourceType, 'imported');
    assert.equal(candidates[1].sourceType, 'manual');
});

test('aggregates tasks due in the next 7 days without exposing ticket ids', () => {
    const candidates = buildProactiveTaskCandidates([
        { collection: 'risk', title: '风险合集', _slaDays: 2, data: { task_id: 'SECRET-1', fullname: '张三' } },
        { collection: 'risk', title: '风险合集', _slaDays: 6, data: { task_id: 'SECRET-2', fullname: '张三' } },
        { collection: 'risk', title: '风险合集', _slaDays: 8, data: { task_id: 'SECRET-3', fullname: '张三' } },
        { collection: 'sr', title: 'SR 合集', _slaDays: -1, data: { sr_num: 'SECRET-4', cur_assignee: '李四' } },
        { collection: 'rectification', title: '', _slaDays: 1, data: {} }
    ]);

    assert.deepEqual(candidates, [
        { kind: 'task', owner: '未明确负责人', taskType: '整改', count: 1, dueWindowDays: 7, nearestDays: 1, customerGroup: '未明确负责人', metric: '整改类临期任务', actual: '1个', target: '7天内处理' },
        { kind: 'task', owner: '张三', taskType: '风险', count: 2, dueWindowDays: 7, nearestDays: 2, customerGroup: '张三', metric: '风险类临期任务', actual: '2个', target: '7天内处理' }
    ]);
    assert.doesNotMatch(JSON.stringify(candidates), /SECRET-/);
});

test('generateRuleBasedDeepAnalysis generates structured trend, attribution, and advice', () => {
    const kpiContext = {
        kpiDetails: [{
            kind: 'kpi',
            metric: '整改',
            customerGroup: 'ET',
            actual: '79%',
            target: '≥ 80%',
            gap: '1%',
            onlyFailingGroup: true,
            allGroups: [
                { customerGroup: 'ET', actual: '79%', isFailing: true },
                { customerGroup: 'ORG', actual: '82%', isFailing: false },
                { customerGroup: 'TE', actual: '99%', isFailing: false }
            ],
            passingGroups: [
                { customerGroup: 'ORG', actual: '82%' },
                { customerGroup: 'TE', actual: '99%' }
            ],
            failingGroups: [
                { customerGroup: 'ET', actual: '79%' }
            ],
            history: {
                prevVal: '66%',
                delta: 13,
                continuousFailing: true
            }
        }],
        taskDetails: []
    };

    const text = generateRuleBasedDeepAnalysis(kpiContext, 'zh');
    assert.match(text, /【趋势对比】/);
    assert.match(text, /环比回升13%/);
    assert.match(text, /【归因分析】/);
    assert.match(text, /ET为唯一落后短板/);
    assert.match(text, /【跟进建议】/);

    const taskContext = {
        kpiDetails: [],
        taskDetails: [{
            kind: 'task',
            owner: '张三',
            taskType: '风险',
            count: 2,
            nearestDays: 1,
            productLines: ['Cloud Core Network'],
            prevCount: 1
        }]
    };

    const taskText = generateRuleBasedDeepAnalysis(taskContext, 'zh');
    assert.match(taskText, /【临期诊断】/);
    assert.match(taskText, /最紧急任务仅剩1天/);
    assert.match(taskText, /【快照对比】/);
    assert.match(taskText, /新增1个/);
});
