const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigscreen-static-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const snapshots = require('../backend/models/bigscreen-snapshot');
const publishing = require('../backend/models/snapshot-publish-service');

test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});
test('bigscreen publishing is opt-in and persists independent public access across updates', async () => {
    assert.ok(publishing.providers.has('bigscreen'));
    assert.equal((await publishing.getToolSettings('bigscreen')).enabled, false);
    await publishing.saveToolSettings('bigscreen', { enabled: true, publicAccess: true });
    await publishing.saveToolSettings('bigscreen', { enabled: false });
    const settings = (await publishing.getSettings()).tools.find(item => item.toolSlug === 'bigscreen');
    assert.equal(settings.publicAccess, true);
    assert.equal(settings.enabled, false);
    await publishing.saveToolSettings('bigscreen', { enabled: true, publicAccess: false });
    assert.equal((await publishing.getToolSettings('bigscreen')).publicAccess, false);
});
test('standalone dashboard keeps bilingual rendering, charts, captured data and offline range queries', async () => {
    const data = {
        '/api/db/monthly_report_data': { trends: [{ date: '2026-10-01' }, { date: '2026-10-02' }], latest_snapshot: { total_score: 90 } },
        latestByDate: { '2026-10-01': { total_score: 75 } },
        '/api/sla/config': { prefs: { i18nMap: { '质量': 'Quality' } } }
    };
    const html = snapshots.render(data);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+rel="stylesheet"/);
    assert.match(html, /Quality/);
    assert.match(html, /ToolsI18n.toggleLanguage/);
    assert.match(html, /<option selected value="all"/);
    const sources = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
    for (const source of sources) new vm.Script(source);
    const context = { window: {}, URL };
    vm.runInNewContext(sources[0], context);
    const result = await context.window.API.get('/api/db/monthly_report_data?startDate=2026-10-01&endDate=2026-10-01');
    assert.equal(result.trends.length, 1);
    assert.equal(result.latest_snapshot.total_score, 75);
    await assert.rejects(context.window.API.post('/api/db/config/bigscreen_title', {}), /Read-only/);
});
test('single and Pages builders use the current tenant report readers', async () => {
    const data = await snapshots.collect();
    assert.deepEqual(data['/api/db/monthly_report_data'].trends, []);
    const output = await publishing.providers.get('bigscreen').buildPagesSnapshot('default');
    assert.ok(output.files instanceof Map);
    assert.match(output.html, /latest_snapshot/);
});
test('dashboard public access and selection remain tenant isolated', async () => {
    const { runWithTenant } = require('../backend/models/tenant-context');
    await runWithTenant('dashboard-a', () => publishing.saveToolSettings('bigscreen', { enabled: true, publicAccess: true }));
    await runWithTenant('dashboard-b', async () => {
        assert.equal((await publishing.getToolSettings('bigscreen')).enabled, false);
        await publishing.saveToolSettings('bigscreen', { enabled: true, publicAccess: false });
    });
    await runWithTenant('dashboard-a', async () => assert.equal((await publishing.getToolSettings('bigscreen')).publicAccess, true));
    await runWithTenant('dashboard-b', async () => assert.equal((await publishing.getToolSettings('bigscreen')).publicAccess, false));
});
test('captured dashboard preserves saved report scores, title, owners and translation map', async () => {
    const connection = require('../backend/models/tenant-sqlite-pool').getConnection('report.db', 'report');
    const run = (sql, params) => new Promise((resolve, reject) => connection.run(sql, params, error => error ? reject(error) : resolve()));
    await run('INSERT INTO ReportSnapshots(snapshot_id,month,created_at,standard_total_score,raw_data_json) VALUES (?,?,?,?,?)', ['saved-dashboard', 202610, '2026-10-01 10:00:00', 87.5, '{}']);
    await run('INSERT INTO PlatformConfig(key_name,value_json) VALUES (?,?)', ['bigscreen_title', JSON.stringify({ zh: '当前标题', en: 'Current title' })]);
    await run('INSERT INTO PlatformConfig(key_name,value_json) VALUES (?,?)', ['bigscreen_owners', JSON.stringify({ items: [{ name: 'Owner A', bu: 'Core' }] })]);
    const data = await snapshots.collect();
    assert.equal(data['/api/db/monthly_report_data'].latest_snapshot.total_score, 87.5);
    assert.equal(data.latestByDate['2026-10-01'].total_score, 87.5);
    assert.equal(data['/api/db/config/bigscreen_title'].en, 'Current title');
    assert.equal(data['/api/db/config/bigscreen_owners'].items[0].name, 'Owner A');
});
test('dashboard export reads report data from its tenant only', async () => {
    const pool = require('../backend/models/tenant-sqlite-pool');
    const { runWithTenant } = require('../backend/models/tenant-context');
    const source = pool.getConnection('report.db', 'report');
    const schema = await new Promise((resolve, reject) => source.all("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('ReportSnapshots','ReportCategoryScores','ReportMetricData','PlatformConfig')", (error, rows) => error ? reject(error) : resolve(rows.map(row => row.sql).join(';'))));
    await runWithTenant('dashboard-a', async () => {
        const connection = pool.getConnection('report.db', 'report');
        await new Promise((resolve, reject) => connection.exec(schema, error => error ? reject(error) : resolve()));
        await new Promise((resolve, reject) => connection.run("INSERT INTO ReportSnapshots(snapshot_id,month,created_at,standard_total_score) VALUES ('tenant-a-only',202610,'2026-10-02',64)", error => error ? reject(error) : resolve()));
        const data = await snapshots.collect();
        assert.equal(data['/api/db/monthly_report_data'].latest_snapshot.snapshot_id, 'tenant-a-only');
        assert.equal(data['/api/db/monthly_report_data'].latest_snapshot.total_score, 64);
        assert.doesNotMatch(JSON.stringify(data), /saved-dashboard|Current title|Owner A/);
    });
    const original = await snapshots.collect();
    assert.equal(original['/api/db/monthly_report_data'].latest_snapshot.snapshot_id, 'saved-dashboard');
    assert.doesNotMatch(JSON.stringify(original), /tenant-a-only/);
});
