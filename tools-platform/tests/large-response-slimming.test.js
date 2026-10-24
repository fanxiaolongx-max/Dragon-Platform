// 大响应瘦身：列表 / 趋势接口只下发页面实际用到的字段，完整内容仍由详情接口提供。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'large-response-slimming-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const slaRepo = require('../backend/models/sla-snapshots-repository');
const { runWithTenant } = require('../backend/models/tenant-context');

const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; runWithTenant('default', next); });
app.use('/api/sla', require('../backend/routes/sla'));
app.use('/api/db', require('../backend/routes/db'));
app.use('/api/requirements', require('../backend/routes/requirements'));

const sourceSections = [{ key: 'rfc', title: 'RFC', rows: Array.from({ length: 200 }, (_, index) => ({ id: index, text: 'x'.repeat(200) })) }];
const snapshotPayload = (id, timestamp, month) => ({
    id, timestamp, month, selectedTargetMonth: month,
    topMetrics: [{ label: '整改完成率', value: '96%', target: '≥ 90%' }],
    expiringTickets: [{ data: { ticket_id: `T-${id}` } }],
    manualAdjustData: { note: 'kept' },
    specialMetricAlerts: [{ label: 'alert' }],
    sourceSections
});

const exec = (sql, params = []) => new Promise((resolve, reject) => pool.getConnection('report.db', 'report').run(sql, params, error => error ? reject(error) : resolve()));
const execReq = (sql, params = []) => new Promise((resolve, reject) => pool.getConnection('requirements.db').run(sql, params, error => error ? reject(error) : resolve()));

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('SLA snapshot summary view drops detail rows but keeps identity, metrics and counts', () => runWithTenant('default', async () => {
    await slaRepo.addSnapshot(snapshotPayload('s1', '2026-10-01T10:00:00Z', 10));
    const full = await request(app).get('/api/sla/snapshots');
    const summary = await request(app).get('/api/sla/snapshots?view=summary');
    assert.equal(full.status, 200); assert.equal(summary.status, 200);
    assert.equal(full.body[0].sourceSections.length, 1, 'the default view is unchanged for existing callers');
    const item = summary.body[0];
    assert.equal(item.id, 's1');
    assert.equal('sourceSections' in item || 'expiringTickets' in item, false);
    assert.deepEqual([item.sourceSectionsCount, item.expiringTicketsCount, item.summaryView], [1, 1, true]);
    assert.deepEqual(item.topMetrics, full.body[0].topMetrics);
    assert.equal(summary.headers['x-data-source'], 'sqlite', 'the SLA page badge still gets its data source');
    assert.ok(JSON.stringify(summary.body).length * 5 < JSON.stringify(full.body).length);
}));

test('monthly report trends carry only chart fields; the latest snapshot keeps everything but source rows', () => runWithTenant('default', async () => {
    await new Promise(resolve => setTimeout(resolve, 50)); // routes/db.js 建表在模块加载时排队执行
    for (const [index, day] of ['2026-10-01', '2026-10-02'].entries()) {
        const id = `snap-${index}`;
        await exec('INSERT INTO ReportSnapshots (snapshot_id, month, created_at, standard_total_score, raw_data_json) VALUES (?, ?, ?, ?, ?)',
            [id, 10, `${day} 08:00:00`, 90 + index, JSON.stringify(snapshotPayload(id, `${day}T08:00:00Z`, 10))]);
        await exec('INSERT INTO ReportMetricData (snapshot_id, cat_name, metric_label, is_failing, month) VALUES (?, ?, ?, ?, ?)', [id, 'TE', '整改完成率', 0, 10]);
    }
    const res = await request(app).get('/api/db/monthly_report_data');
    assert.equal(res.status, 200);
    assert.equal(res.body.trends.length, 2);
    for (const trend of res.body.trends) {
        const raw = JSON.parse(trend.raw_data_json);
        assert.deepEqual(Object.keys(raw).sort(), ['month', 'selectedTargetMonth', 'timestamp', 'topMetrics']);
        assert.equal(raw.topMetrics[0].label, '整改完成率');
    }
    const latest = JSON.parse(res.body.latest_snapshot.raw_data_json);
    assert.equal('sourceSections' in latest, false);
    assert.equal(latest.sourceSectionsCount, 1);
    for (const key of ['topMetrics', 'expiringTickets', 'manualAdjustData', 'specialMetricAlerts', 'timestamp', 'month']) assert.ok(key in latest, key);
    assert.ok(JSON.stringify(res.body).length < 20000, 'two days of 40 KB snapshots no longer ship their source rows');
}));

test('requirements list clips long descriptions while the detail API returns the full text', () => runWithTenant('default', async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    const long = '日志'.repeat(5000);
    await execReq("INSERT INTO Requirements (title, description, status, creator, category) VALUES ('长需求', ?, '提交', 'admin', 'F12')", [long]);
    await execReq("INSERT INTO Requirements (title, description, status, creator, category) VALUES ('短需求', '简短描述', '提交', 'admin', 'F12')");
    const list = await request(app).get('/api/requirements');
    assert.equal(list.status, 200);
    const longItem = list.body.find(item => item.title === '长需求');
    const shortItem = list.body.find(item => item.title === '短需求');
    assert.deepEqual([longItem.description.length, longItem.description_truncated], [300, true]);
    assert.deepEqual([shortItem.description, 'description_truncated' in shortItem], ['简短描述', false]);
    const detail = await request(app).get(`/api/requirements/${longItem.id}`);
    assert.equal(detail.body.description, long);
}));
