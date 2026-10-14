const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = require('../backend/models/monthly-snapshots-repository');
const diffModule = require('../frontend/js/shared/report-snapshot-diff');

test('ReportDiffEngine tokenizes Chinese characters and Western words correctly', () => {
    const Engine = diffModule.Engine;
    const tokens = Engine.tokenize('本月退网 238 套 OptiX OSN 3500 设备');
    assert.deepEqual(tokens, [
        '本', '月', '退', '网', ' ', '238', ' ', '套', ' ', 'OptiX', ' ', 'OSN', ' ', '3500', ' ', '设', '备'
    ]);
});

test('ReportDiffEngine diffText correctly identifies additions and deletions', () => {
    const Engine = diffModule.Engine;
    const res = Engine.diffText('本月退网 238 套', '本月退网 245 套');
    assert.equal(res.hasDiff, true);
    assert.match(res.baselineHtml, /<del class="report-diff-del">238<\/del>/);
    assert.match(res.targetHtml, /<ins class="report-diff-ins">245<\/ins>/);
});

test('ReportDiffEngine diffText returns hasDiff=false when texts are identical', () => {
    const Engine = diffModule.Engine;
    const res = Engine.diffText('进度正常推进中。', '进度正常推进中。');
    assert.equal(res.hasDiff, false);
    assert.equal(res.changesCount, 0);
});

test('ReportDiffEngine diffStyles detects color, bold, and highlight differences', () => {
    const Engine = diffModule.Engine;
    
    // 1. Color diff
    const elA = { style: { color: '#000000' } };
    const elB = { style: { color: '#ef4444' } };
    const colorDiff = Engine.diffStyles(elA, elB);
    assert.equal(colorDiff.hasDiff, true);
    assert.equal(colorDiff.items[0].type, 'color');
    assert.match(colorDiff.items[0].label, /红色/);

    // 2. Bold diff
    const elPlain = { tagName: 'SPAN', style: {} };
    const elBold = { tagName: 'STRONG', style: { fontWeight: 'bold' } };
    const boldDiff = Engine.diffStyles(elPlain, elBold);
    assert.equal(boldDiff.hasDiff, true);
    assert.equal(boldDiff.items[0].type, 'bold');
    assert.equal(boldDiff.items[0].after, true);

    // 3. Highlight diff
    const elNoHighlight = { tagName: 'SPAN', style: {} };
    const elHighlight = { tagName: 'MARK', style: { backgroundColor: '#fef08a' } };
    const hlDiff = Engine.diffStyles(elNoHighlight, elHighlight);
    assert.equal(hlDiff.hasDiff, true);
    assert.equal(hlDiff.items[0].type, 'highlight');
});

test('ReportDiffEngine parseNumber correctly parses numbers and percentages', () => {
    const Engine = diffModule.Engine;
    assert.deepEqual(Engine.parseNumber('50.4%'), { num: 50.4, isPercent: true });
    assert.deepEqual(Engine.parseNumber('238'), { num: 238, isPercent: false });
    assert.deepEqual(Engine.parseNumber('+15'), { num: 15, isPercent: false });
    assert.deepEqual(Engine.parseNumber('-3.5%'), { num: -3.5, isPercent: true });
    assert.equal(Engine.parseNumber('N/A'), null);
});

test('monthly-snapshots-repository performs complete CRUD on SQLite database', async () => {
    await repo.ensureReady();

    const testId = `test_snap_${Date.now()}`;
    const testSnapshot = {
        id: testId,
        toolKey: 'test-tool',
        topicKey: 'test-topic',
        month: '2026-03',
        name: '2026-03 测试快照',
        summary: { rowCount: 42, author: 'tester' },
        payload: {
            projectData: { month: '2026-03', rows: [1, 2, 3] },
            htmlContent: '<div>测试报表内容</div>'
        }
    };

    // 1. Create
    const saved = await repo.saveSnapshot(testSnapshot);
    assert.equal(saved.id, testId);
    assert.equal(saved.name, '2026-03 测试快照');
    assert.equal(saved.summary.rowCount, 42);
    assert.equal(saved.payload.htmlContent, '<div>测试报表内容</div>');

    // 2. List
    const list = await repo.listSnapshots({ toolKey: 'test-tool', topicKey: 'test-topic' });
    assert.ok(list.length >= 1);
    const found = list.find(s => s.id === testId);
    assert.ok(found);
    assert.equal(found.name, '2026-03 测试快照');

    // 3. Get
    const fetched = await repo.getSnapshot(testId);
    assert.ok(fetched);
    assert.equal(fetched.name, '2026-03 测试快照');
    assert.deepEqual(fetched.payload.projectData.rows, [1, 2, 3]);

    // 4. Rename
    const renamed = await repo.renameSnapshot(testId, '2026-03 终稿快照');
    assert.equal(renamed.name, '2026-03 终稿快照');

    // 5. Delete
    const deleted = await repo.deleteSnapshot(testId);
    assert.equal(deleted, true);

    const checkNull = await repo.getSnapshot(testId);
    assert.equal(checkNull, null);
});

test('topic-analysis.html integrates snapshot and diff controls and scripts', () => {
    const htmlPath = path.join(__dirname, '../frontend/pages/topic-analysis.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.match(html, /href="\/css\/report-snapshot-diff\.css/);
    assert.match(html, /src="\/js\/shared\/report-snapshot-diff\.js/);
    assert.match(html, /id="eosSaveSnapshotBtn"/);
    assert.match(html, /id="eosManageSnapshotsBtn"/);
    assert.match(html, /id="eosDiffBtn"/);
});

test('esn-check index.html integrates snapshot and diff controls and scripts with exact parity', () => {
    const builtinPath = path.join(__dirname, '../backend/builtin-tools/esn-check/index.html');
    const dataPath = path.join(__dirname, '../backend/data/custom-tools/esn-check/index.html');

    const builtinHtml = fs.readFileSync(builtinPath, 'utf8');

    // Exact parity with the installed runtime copy (absent on clean checkouts such as CI)
    if (fs.existsSync(dataPath)) {
        assert.equal(builtinHtml, fs.readFileSync(dataPath, 'utf8'), 'builtin-tools and data/custom-tools esn-check index.html must be identical');
    }

    // Assets & buttons
    assert.match(builtinHtml, /href="\/css\/report-snapshot-diff\.css/);
    assert.match(builtinHtml, /src="\/js\/shared\/report-snapshot-diff\.js/);
    assert.match(builtinHtml, /id="report-save-snapshot"/);
    assert.match(builtinHtml, /id="report-manage-snapshots"/);
    assert.match(builtinHtml, /id="report-diff-btn"/);
});

test('report-snapshot-diff guarantees table borders and sheet classes in diff panes', () => {
    const cssPath = path.join(__dirname, '../frontend/css/report-snapshot-diff.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Table structure and borders
    assert.match(css, /\.report-diff-pane\s+table[\s\S]*border-collapse:\s*collapse/);
    assert.match(css, /\.report-diff-pane\s+th[\s\S]*border:\s*1px\s+solid/);
    assert.match(css, /\.report-diff-pane\s+td[\s\S]*border:\s*1px\s+solid/);
    assert.match(css, /td\.report-diff-cell-modified/);

    const jsPath = path.join(__dirname, '../frontend/js/shared/report-snapshot-diff.js');
    const js = fs.readFileSync(jsPath, 'utf8');

    // Pane sheet container classes for styling scope inheritance
    assert.match(js, /class="[^"]*report-diff-sheet-content[^"]*report-sheet[^"]*topic-report-sheet[^"]*"\s+id="rdLeftSheet"/);
    assert.match(js, /class="[^"]*report-diff-sheet-content[^"]*report-sheet[^"]*topic-report-sheet[^"]*"\s+id="rdRightSheet"/);
});

