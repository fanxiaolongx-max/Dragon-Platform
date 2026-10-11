const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const engine = require('../frontend/js/shared/topic-monthly-engine');
const { netcare, datafab } = require('./fixtures/topic-monthly');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'monthly-engine-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const repo = require('../backend/models/topic-snapshots-repository');
const sources = require('../backend/models/import-source-repository');
const appDb = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => { await appDb.closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });
const section = (report, id) => report.sections.find(item => item.id === id);

test('six topics use distinct business metrics and saved rates without double counting', () => {
    const snapshot = netcare();
    const before = JSON.stringify(snapshot);
    const certificate = engine.build(snapshot, 'certificate');
    assert.equal(section(certificate, 'overview').rows[0].pending, 20);
    assert.equal(section(certificate, 'overview').rows[0].rate, 60);
    assert.equal(section(certificate, 'priorities').rows[0].task_id, 'C1');
    const change = engine.build(snapshot, 'change');
    assert.equal(change.month, '2026-08');
    assert.equal(section(change, 'overview').rows[0].count, 300);
    assert.equal(section(change, 'overview').rows[1].count, 400);
    assert.equal(section(change, 'overview').rows[1].rate, 97.5);
    assert.equal(section(change, 'overview').rows[0].yoy, 50);
    assert.equal(section(change, 'trend').rows[1].count, null);
    const interception = engine.build(snapshot, 'interception');
    assert.equal(section(interception, 'overview').rows[0].count, 40);
    assert.equal(section(interception, 'overview').rows[0].yoy, null);
    const sr = engine.build(snapshot, 'sr');
    assert.equal(section(sr, 'overview').rows[0].rate, 95);
    assert.equal(section(sr, 'overview').rows[1].rate, 99);
    assert.equal(section(sr, 'overview').rows[1].count, 110);
    assert.equal(JSON.stringify(snapshot), before, 'report generation must not mutate snapshots');
    const filing = engine.build(datafab(), 'filing');
    assert.deepEqual(section(filing, 'reasons').rows, [{ label: '客户限制', count: 2, share: 100 }]);
    assert.equal(section(filing, 'overview').rows[0].recorded, 20);
    assert.equal(filing.detailSheets[1].rows.length, 5, 'raw detail must retain excluded records');
    const returned = engine.build(datafab(), 'return');
    assert.equal(section(returned, 'products').rows[0].returnRate, 90);
    assert.match(returned.overview[0].zh, /95%/);
});

test('zero and missing denominators, rates and targets are not silently treated as success', () => {
    const snapshot = datafab();
    snapshot.data.months[1].required = 0;
    delete snapshot.settings.targets;
    const report = engine.build(snapshot, 'return');
    assert.equal(section(report, 'overview').rows[0].returnRate, null);
    assert.match(report.overview[0].zh, /暂无完整数据/);
    const missing = netcare();
    delete missing.data.change.rows[0].operation_success_rate;
    assert.equal(section(engine.build(missing, 'change'), 'overview').rows[1].rate, null);
});

test('storage preserves legacy EOS keys while separating topics, months and tenants', () => {
    assert.equal(engine.storageKey('eos', 'monthly-copy', 'default', 'monthly', '2026-09'), 'topic-eos:monthly-copy:v1:default:month:monthly:2026-09');
    const keys = new Set();
    for (const topic of engine.list) for (const tenant of ['default', 'second']) for (const month of ['2026-08', '2026-09']) keys.add(engine.storageKey(topic.key, 'monthly-copy', tenant, 'monthly', month));
    assert.equal(keys.size, 28);
});

test('generic offline projects round trip and reject invalid topic/shape before import', () => {
    const project = { fileType: 'topic-monthly-project', schemaVersion: 1, topicKey: 'change', month: '2026-08', reportData: engine.build(netcare(), 'change') };
    assert.equal(engine.validateProject(JSON.parse(JSON.stringify(project))), 'change');
    assert.throws(() => engine.validateProject({ ...project, topicKey: 'sr' }));
    assert.throws(() => engine.validateProject({ ...project, month: '2026-13' }));
    project.reportData.sections[0].id = '" onclick="alert(1)';
    assert.throws(() => engine.validateProject(project));
});

test('monthly API selects last import by topic period, preserves EOS and isolates tenants', async () => {
    const first = await repo.saveSnapshot(netcare());
    await repo.saveSnapshot(datafab());
    assert.deepEqual((await repo.getMonthlyReport('change')).months, ['2026-08']);
    assert.deepEqual((await repo.getMonthlyReport('sr')).months, ['2026-09']);
    for (const key of ['certificate', 'change', 'interception', 'sr', 'return', 'filing']) assert.equal((await repo.getMonthlyReport(key)).report.topicKey, key);
    assert.deepEqual(await repo.getMonthlyReport('eos'), await repo.getEosMonthlyReport());
    const olderCapture = netcare();
    olderCapture.capturedAt = '2026-09-01T00:00:00.000Z';
    olderCapture.data.change.rows[1].task_count = 310;
    const last = await repo.saveSnapshot(olderCapture);
    const result = await repo.getMonthlyReport('change', '2026-08');
    assert.notEqual(first.item.id, last.item.id);
    assert.equal(result.report.snapshot.id, last.item.id);
    assert.equal(section(result.report, 'overview').rows[0].count, 310);
    assert.equal((await repo.getMonthlyReport('change', '2026-07')).report, null);
    await assert.rejects(repo.getMonthlyReport('not-a-topic'), /不支持/);
    await assert.rejects(repo.getMonthlyReport('change', '2026-13'), /月份/);
    await runWithTenant('another', async () => {
        assert.deepEqual(await repo.getMonthlyReport('change'), { months: [], report: null });
        await repo.saveSnapshot(datafab());
        assert.equal((await repo.getMonthlyReport('filing')).report.topicKey, 'filing');
        assert.equal((await repo.getMonthlyReport('certificate')).report, null);
    });
    const empty = netcare(); empty.data.certificate = [];
    await repo.saveSnapshot(empty);
    assert.equal((await repo.getMonthlyReport('certificate')).report, null, 'latest empty snapshot must not expose old data');
});

test('HTTP monthly endpoint returns SQLite reports, empty months and structured validation errors', async t => {
    const express = require('express');
    const web = express();
    web.use('/api/topic-snapshots', require('../backend/routes/topic-snapshots'));
    const server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/topic-snapshots/monthly-report`;
    const response = await fetch(`${base}?topic=sr`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Data-Source'), 'sqlite');
    assert.equal((await response.json()).report.topicKey, 'sr');
    const invalid = await fetch(`${base}?topic=bad`);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'INVALID_TOPIC_SNAPSHOT');
    const empty = await fetch(`${base}?topic=sr&month=2025-01`);
    assert.equal((await empty.json()).report, null);
});

test('percentages in topic monthly reports and source tables are rounded to at most 2 decimal places at source', async () => {
    const snapshot = netcare();
    // CNBG count 4248 vs prior 6144 => yoy -30.859375 => -30.86
    // EBG count 210 vs prior 196 => yoy 7.142857142857142 => 7.14
    // Operation success rate 99.52357142857143% => 99.52%
    snapshot.data.change.rows = [
        { scope: 'CNBG', year: 2026, month: 8, task_count: 4248, rollback_count: 0, high_core_total_count: 0, operation_success_rate: 100 },
        { scope: 'CNBG', year: 2025, month: 8, task_count: 6144, rollback_count: 0, high_core_total_count: 0, operation_success_rate: 100 },
        { scope: 'EBG', year: 2026, month: 8, task_count: 210, rollback_count: 0, high_core_total_count: 0, operation_success_rate: 0.9952357142857143 },
        { scope: 'EBG', year: 2025, month: 8, task_count: 196, rollback_count: 0, high_core_total_count: 0, operation_success_rate: 100 }
    ];
    const report = engine.build(snapshot, 'change');
    const scopes = section(report, 'scopes').rows;
    const cnbg = scopes.find(r => r.label === 'CNBG');
    const ebg = scopes.find(r => r.label === 'EBG');
    assert.equal(cnbg.yoy, -30.86);
    assert.equal(cnbg.rate, 100);
    assert.equal(ebg.yoy, 7.14);
    assert.equal(ebg.rate, 99.52);

    const saved = await repo.saveSnapshot(snapshot);
    const catalog = await sources.catalog();
    const changeFile = catalog.files.find(f => f.topic_key === 'change' && f.source_snapshot_id === saved.item.id);
    const scopeSheet = changeFile.sheets.find(s => s.name.includes('分业务范围'));
    const sheetData = await sources.getSheet(scopeSheet.id);
    const cnbgRow = sheetData.rows.find(r => r['范围'] === 'CNBG');
    const ebgRow = sheetData.rows.find(r => r['范围'] === 'EBG');
    assert.equal(cnbgRow['同比（%）'], -30.86);
    assert.equal(cnbgRow['操作成功率（%）'], 100);
    assert.equal(ebgRow['同比（%）'], 7.14);
    assert.equal(ebgRow['操作成功率（%）'], 99.52);
});

