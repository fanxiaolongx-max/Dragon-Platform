const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const runtimePath = path.join(projectRoot, 'frontend/js/uivf12/datafab-analysis.js');
const copyPath = path.join(projectRoot, 'frontend/js/uivf12/copy.js');
const pagePath = path.join(projectRoot, 'frontend/pages/uivf12.html');

test('DataFab log analysis runtime is self-contained and source-backed', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    const context = { window: {} };
    vm.runInNewContext(source, context);
    const runtimeSource = context.window.UIVDataFabAnalysis.getRuntimeSource();
    assert.doesNotThrow(() => new vm.Script(runtimeSource));
    assert.match(runtimeSource, /datafab-pro\.gtsdata\.huawei\.com/);
    assert.match(runtimeSource, /getAnswers/);
    assert.match(runtimeSource, /getValueTableSumData/);
    assert.match(runtimeSource, /业务比对日志回传完成量/);
    assert.match(runtimeSource, /需回传操作量/);
    assert.match(runtimeSource, /业务比对日志回传率/);
    assert.match(runtimeSource, /备案量/);
    assert.match(runtimeSource, /备案率/);
    assert.match(runtimeSource, /cell\.formula/);
});

test('DataFab dashboard separates return and filing semantics', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    assert.match(source, /targets: \{ returnRate: 95, recordRate: 25 \}/);
    assert.match(source, /excludePendingScore: true/);
    assert.match(source, /class="df-exclude-pending"/);
    assert.match(source, /isPendingScoreStatus/);
    assert.match(source, /applyDetailScope/);
    assert.match(source, /value >= target/);
    assert.match(source, /value <= target/);
    assert.match(source, /日志回传/);
    assert.match(source, /日志回传备案/);
    assert.match(source, /function lineChart/);
    assert.match(source, /function volumeChart/);
    assert.match(source, /function productLineSection/);
    assert.match(source, /function detailTable/);
    assert.match(source, /function detailColumns/);
    assert.match(source, /rows\.forEach\(row => Object\.keys/);
    assert.match(source, /pageRows = rows\.slice/);
    assert.match(source, /data-df-page-size/);
    assert.match(source, /data-df-page="prev"/);
    assert.match(source, /for \(let month = 1; month <= lastMonth; month\+\+\)/);
    assert.match(source, /PRODUCT_LINES/);
    assert.match(source, /maxRows: 1000/);
    assert.match(source, /pageSize: chartType === 'table' \? 100 : 50/);
    assert.match(source, /for \(let page = 1; page <= 5000; page\+\+\)/);
    assert.match(source, /if \(pageRows\.length < component\.pageSize\) break/);
    assert.doesNotMatch(source, /return rows\.slice/);
});

test('DataFab formula normalization preserves numerator, denominator, rates and product-line gaps', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    const start = source.indexOf('function num');
    const end = source.indexOf('async function fetchMonthSummary');
    assert.ok(start > 0 && end > start);
    const helpers = vm.runInNewContext(`(() => {
        const PRODUCT_LINES = [{ key: '光', labelZh: '光业务', labelEn: 'Optical' }];
        const settings = { excludeIct: true };
        const tr = (zh) => zh;
        ${source.slice(start, end)}
        return { normalizeMonth };
    })()`);
    const normalized = helpers.normalizeMonth({
        data: [{
            totalsData: { columns: {
                '业务比对日志回传完成量': { formula: 96, summing: 95 },
                '需回传操作量': { formula: 100 },
                '业务比对日志回传率': { formula: 0.96, average: 0.5 },
                '备案量': { formula: 20 },
                '备案率': { formula: 0.2 },
                '光_已回传': { formula: 45 },
                '光_需回传': { formula: 50 },
                '光_回传率': { formula: 0.9 }
            } }
        }]
    }, 2026, 8);
    assert.equal(normalized.required, 100);
    assert.equal(normalized.returned, 96);
    assert.equal(normalized.returnRate, 96);
    assert.equal(normalized.pending, 4);
    assert.equal(normalized.recorded, 20);
    assert.equal(normalized.recordRate, 20);
    assert.equal(normalized.productLines[0].pending, 5);
    assert.equal(normalized.productLines[0].rate, 90);
});

test('DataFab scope excludes ICT services and software from return denominator by default', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    const start = source.indexOf('function num');
    const end = source.indexOf('async function fetchMonthSummary');
    const helpers = vm.runInNewContext(`(() => {
        const PRODUCT_LINES = [
            { key: '无线', labelZh: '无线', labelEn: 'Wireless' },
            { key: 'ICT', labelZh: 'ICT服务与软件', labelEn: 'ICT Services & Software' }
        ];
        const settings = { excludeIct: true };
        const tr = (zh) => zh;
        ${source.slice(start, end)}
        return { normalizeMonth };
    })()`);
    const normalized = helpers.normalizeMonth({ data: [{ totalsData: { columns: {
        '需回传操作量': { formula: 100 },
        '业务比对日志回传完成量': { formula: 90 },
        '备案量': { formula: 18 },
        'ICT_需回传': { formula: 20 },
        'ICT_已回传': { formula: 10 }
    } } }] }, 2026, 9);
    assert.equal(normalized.required, 80);
    assert.equal(normalized.returned, 80);
    assert.equal(normalized.returnRate, 100);
    assert.equal(normalized.excludedIctRequired, 20);
});

test('DataFab filing insights group eligible detail by BU, customer, family and product', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    const start = source.indexOf('function isPendingScoreStatus');
    const end = source.indexOf('function xlsxXml');
    assert.ok(start > 0 && end > start);
    const helpers = vm.runInNewContext(`(() => {
        const settings = { excludeIct: true, excludePendingScore: true, language: 'zh', targets: { recordRate: 25 } };
        const tr = (zh) => zh;
        const smartValue = value => value;
        const fmt = (value, digits) => Number(value).toFixed(digits == null ? 0 : digits);
        const fmtRate = value => Number(value).toFixed(1) + '%';
        ${source.slice(start, end)}
        return { analyzeFilingRows, filingReminderSummary, isExcludedIctLine };
    })()`);
    const insight = helpers.analyzeFilingRows([
        { '任务单号': 'TASK-001', BU: 'BU-A', network_name: '网络甲', '账户名': '错误客户名', '客户名': '客户列甲', '操作人': '张三', '产品族': '族1', '产品': '产品A', '产品线': '无线', '备案原因': '客户窗口限制', '备注': '已沟通' },
        { BU: 'BU-A', top_cust_category_cn_name: '顶层客户乙', '操作人': '李四', '产品族': '族1', '产品': '产品B', '产品线': '无线', '备案原因': '' },
        { BU: 'BU-A', network_name: '网络待评', '操作人': '王五', '产品族': '族1', '产品': '产品D', '产品线': '无线', '评分任务状态': '待评分', '备案原因': '不应纳入' },
        { BU: 'BU-B', network_name: '网络丙', '操作人': '张三', '产品族': '族2', '产品': '产品C', '产品线': '光', '备案原因': '技术限制' },
        { BU: 'BU-B', network_name: '网络丙', '操作人': '张三', '产品族': '族2', '产品': '产品C', '产品线': '光', '备案原因': '技术限制' },
        { BU: 'BU-B', network_name: '网络丙', '操作人': '张三', '产品族': '族2', '产品': '产品C', '产品线': '光', '备案原因': '' },
        { BU: 'BU-X', '账户名': '客户丙', '产品族': '族X', '产品': '产品X', '产品线': 'ICT服务与软件', '备案原因': '例外' }
    ]);
    assert.equal(insight.total, 5);
    assert.equal(insight.filed, 3);
    assert.equal(insight.missing, 2);
    assert.equal(insight.noted, 1);
    assert.equal(insight.detail[0].taskNo, 'TASK-001');
    assert.equal(insight.dimensions.bu[0].label, 'BU-B');
    assert.equal(insight.dimensions.bu[0].filed, 2);
    assert.equal(insight.dimensions.customer.length, 3);
    assert.equal(insight.dimensions.customer[0].label, '网络丙');
    assert.equal(insight.reasons[0].label, '技术限制');
    assert.equal(insight.operators[0].label, '张三');
    assert.equal(insight.operators[0].count, 3);
    assert.equal(insight.operators[0].returned, 4);
    assert.equal(insight.operators[0].filingRate, 75);
    assert.equal(insight.operators[0].bu, 'BU-B / BU-A');
    assert.equal(insight.operators[0].customer, '网络丙 / 客户列甲');
    assert.equal(insight.operators[0].productLine, '光 / 无线');
    assert.equal(helpers.isExcludedIctLine('ICT Services & Software'), true);
    const reminder = helpers.filingReminderSummary(insight, { year: 2026, label: '09' });
    assert.equal(reminder.risk, true);
    assert.match(reminder.text, /2026-09共备案3笔/);
    assert.match(reminder.text, /张三 3笔（个人备案率75\.0%）/);
    assert.match(reminder.text, /产品线：光 \/ 无线/);
    assert.match(reminder.text, /高于25\.0%备案上限50\.0个百分点/);

    const explicitReturnStatus = helpers.analyzeFilingRows([
        { '操作人': '赵六', '回传状态': '已回传', '备案原因': '环境限制' },
        { '操作人': '赵六', '回传状态': '已回传', '备案原因': '' },
        { '操作人': '赵六', '回传状态': '待回传', '备案原因': '' }
    ]).operators[0];
    assert.equal(explicitReturnStatus.count, 1);
    assert.equal(explicitReturnStatus.returned, 2);
    assert.equal(explicitReturnStatus.filingRate, 50);
});

test('DataFab detail reconciliation removes pending-rating tasks from every total', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    const start = source.indexOf('function isPendingScoreStatus');
    const end = source.indexOf('function deltaClass');
    assert.ok(start > 0 && end > start);
    const helpers = vm.runInNewContext(`(() => {
        const settings = { excludeIct: true, excludePendingScore: true };
        const filingRow = row => row;
        const isExcludedIctLine = value => String(value).includes('ICT');
        ${source.slice(start, end)}
        return { applyDetailScope, isPendingScoreStatus };
    })()`);
    const scoped = helpers.applyDetailScope({
        required: 8, returned: 5, recorded: 3, productLines: [{ key: '无线', labelZh: '无线', labelEn: 'Wireless', required: 8, returned: 5 }]
    }, [
        { productLine: '无线', status: '待评分', reason: '待评也填了原因' },
        { productLine: '无线', status: '已完成', reason: '' },
        { productLine: 'ICT服务与软件', status: '已完成', reason: 'ICT原因' }
    ]);
    assert.equal(scoped.required, 7);
    assert.equal(scoped.returned, 5);
    assert.equal(scoped.recorded, 1);
    assert.equal(scoped.excludedPendingScore, 1);
    assert.equal(scoped.excludedPendingRecorded, 1);
    assert.equal(scoped.excludedIctRecorded, 1);
    assert.equal(scoped.productLines[0].required, 7);
    assert.equal(helpers.isPendingScoreStatus('待评分'), true);
});

test('DataFab Excel export contains overview, product-line and complete raw-detail sheets', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    assert.match(source, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
    assert.match(source, /function exportWorkbook/);
    assert.match(source, /tr\('专题概览', 'Overview'\)/);
    assert.match(source, /tr\('产品线分析', 'Product Lines'\)/);
    assert.match(source, /tr\('原始明细', 'Raw Detail'\)/);
    assert.match(source, /tr\('备案多维分析', 'Filing Analysis'\)/);
    assert.match(source, /tr\('备案原因备注', 'Filing Reasons'\)/);
    assert.match(source, /tr\('已回传数量', 'Returned Count'\)/);
    assert.match(source, /tr\('个人备案率', 'Personal Filing Rate'\)/);
    assert.match(source, /tr\('涉及产品线', 'Related Product Lines'\)/);
    assert.match(source, /tr\('任务单号', 'Task No\.'\)/);
    assert.match(source, /function filingReminderSummary/);
    assert.match(source, /data-df-copy-brief/);
    assert.match(source, /chartGrid\.insertAdjacentHTML\('beforebegin'/);
    assert.match(source, /styleRelId = sheets\.length \+ 1/);
    assert.match(source, /dashboardData\.detail\.forEach/);
    assert.match(source, /autoFilter:/);
    assert.match(source, /freezeRows:/);
    assert.match(source, /datafab-analysis\.js/);

    const helperStart = source.indexOf('function xlsxCrc32');
    const helperEnd = source.indexOf('function exportWorkbook');
    assert.ok(helperStart > 0 && helperEnd > helperStart);
    const helpers = vm.runInNewContext(`(() => {
        ${source.slice(helperStart, helperEnd)}
        return { createXlsxZip };
    })()`, { TextEncoder, Uint8Array });
    const archive = helpers.createXlsxZip({
        '[Content_Types].xml': '<Types/>',
        'xl/worksheets/sheet3.xml': '<worksheet/>'
    });
    assert.deepEqual(Array.from(archive.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
    assert.ok(new TextDecoder().decode(archive).includes('xl/worksheets/sheet3.xml'));
});

test('DataFab insights preserve all fetched months in JSON review snapshots', () => {
    const source = fs.readFileSync(runtimePath, 'utf8');
    assert.match(source, /schema: 'uivf12-topic-snapshot'/);
    assert.match(source, /platform: 'datafab'/);
    assert.match(source, /function downloadTopicSnapshot/);
    assert.match(source, /function importTopicSnapshot/);
    assert.match(source, /const detailsByMonth = \{\}/);
    assert.match(source, /detailsByMonth\[String\(month\)\] = result\[1\]/);
    assert.match(source, /dashboardData = \{ months, detail, detailsByMonth \}/);
    assert.match(source, /回顾模式/);
    assert.match(source, /全年原始明细/);
    assert.match(source, /点击“刷新专题”返回实时模式/);
});

test('floating launcher installs DataFab insights only on the DataFab origin', () => {
    const copy = fs.readFileSync(copyPath, 'utf8');
    const page = fs.readFileSync(pagePath, 'utf8');
    assert.match(copy, /expectedOrigin === 'https:\/\/datafab-pro\.gtsdata\.huawei\.com'/);
    assert.match(copy, /UIVDataFabAnalysis\.getRuntimeSource/);
    assert.match(copy, /installDataFabAnalysisRuntime/);
    assert.match(copy, /dataFabController = installDataFabAnalysisRuntime/);
    assert.match(copy, /dataFabController\.destroy/);
    assert.match(copy, /dataFabController\.showCsv/);
    assert.match(page, /datafab-analysis\.js"/);
    assert.match(page, /copy\.js"/);
});
