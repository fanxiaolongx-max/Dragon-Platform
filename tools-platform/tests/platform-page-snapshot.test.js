const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-page-snapshot-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const pages = require('../backend/models/platform-page-snapshot');
const publishing = require('../backend/models/snapshot-publish-service');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});
test('platform demos capture latest tenant data, scripts and saved documents in all formats', async () => {
    await require('../backend/models/uiv-scripts-repository').replaceAllScripts([{ id: 'demo-script', name: '示例抓取', url: 'https://demo.example.com/capture', category: '默认分类', code: 'const password="do-not-publish-this-secret"; console.log("demo");' }]);
    const distribution = require('../backend/models/tool-distribution');
    assert.doesNotMatch(JSON.stringify(await pages.collect('uivf12')), /demo-script/);
    await distribution.setEntryAccess('cap:float:https://demo.example.com', true);
    const sla = require('../backend/models/sla-snapshots-repository');
    await sla.addSnapshot({ id: 'old-import', timestamp: '2026-09-01T10:00:00Z', topMetrics: [] });
    await sla.addSnapshot({ id: 'latest-import', timestamp: '2026-10-01T10:00:00Z', topMetrics: [{ label: '演示指标', val: 98, value: 98, category: 'TE', isFailing: false }], expiringTickets: [], files: Array.from({ length: 20 }, (_, index) => 'demo-' + index + '.xlsx') });
    require('../backend/routes/db');
    const reportDb = require('../backend/models/tenant-sqlite-pool').getConnection('report.db', 'report');
    const sql = (query, params = []) => new Promise((resolve, reject) => reportDb.serialize(() => reportDb.run(query, params, error => error ? reject(error) : resolve())));
    await sql('INSERT INTO ReportSnapshots(snapshot_id,month,created_at,standard_total_score,raw_data_json) VALUES (?,?,?,?,?)', ['latest-import', 10, '2026-10-01 10:00:00', 87.5, JSON.stringify((await sla.getLatestSnapshot()))]);
    await require('../backend/models/topic-snapshots-repository').saveSnapshot({ schema: 'uivf12-topic-snapshot', version: 1, platform: 'netcare', capturedAt: '2026-10-01T10:00:00Z', exportedAt: '2026-10-01T10:00:00Z', data: { certificate: [{ need_reduce_cnt: 10, reduced_cnt: 6 }], eosProduct: [], eosVersion: [], change: { rows: [] }, interception: { rows: [] }, sr: { summary: [], monthly: [] } } });
    await require('../backend/models/ai-report-repository').save({ name: 'Demo monthly report', reportMonth: '2026-10', chapters: [] });
    await require('../backend/models/slide-design-repository').createProject({ name: 'Saved demo slides', deckHtml: '<h1>演示胶片 / Demo slides</h1>' });
    const dir = process.env.PLATFORM_DEMO_FIXTURE_DIR;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    for (const slug of Object.keys(pages.MODULES)) {
        const data = await pages.collect(slug);
        if (slug === 'uivf12') {
            assert.match(JSON.stringify(data), /demo-script/);
            assert.doesNotMatch(JSON.stringify(data), /do-not-publish-this-secret/);
        }
        if (['sla', 'report', 'expedite'].includes(slug)) assert.deepEqual(data.responses['/api/sla/snapshots'].map(row => row.id), ['latest-import']);
        if (slug === 'monthly') assert.equal(data.responses['/api/ai-report/documents'][0].name, 'Demo monthly report');
        const html = pages.render(slug, data);
        assert.match(html, /Read-only demo/);
        assert.equal(/<script[^>]+src="|<link[^>]+rel="stylesheet"/.test(html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g, '')), false, slug + ' has no external scripts or styles');
        for (const source of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(source[1], { filename: slug });
        if (dir) fs.writeFileSync(path.join(dir, slug + '.html'), html);
        await publishing.saveToolSettings(slug, { enabled: true, publicAccess: true });
        assert.equal((await publishing.getToolSettings(slug)).publicAccess, true);
        assert.equal((await publishing.getSettings()).tools.find(item => item.toolSlug === slug).platformPage, true);
    }
    const bundle = await pages.buildPagesSnapshot('monthly');
    assert.ok(bundle.files.has('legacy.html'));
    assert.match(bundle.files.get('legacy.html'), /87.5/);
    assert.match(bundle.html, /href="\.\/legacy.html"/);
    assert.match(bundle.files.get('legacy.html'), /monthly_report_data/);
    if (dir) fs.writeFileSync(path.join(dir, 'legacy.html'), bundle.files.get('legacy.html'));
});
test('public settings and saved slide projects are isolated across tenants', async () => {
    await runWithTenant('demo-other', async () => {
        assert.deepEqual((await pages.collect('network_safety_meeting_summary')).responses.projects, []);
        assert.equal(Boolean((await publishing.getToolSettings('monthly')).publicAccess), false);
        await require('../backend/models/slide-design-repository').createProject({ name: 'Other tenant only' });
    });
    const main = await pages.collect('network_safety_meeting_summary');
    assert.deepEqual(main.responses.projects.map(row => row.name), ['Saved demo slides']);
});
test('offline adapter serves captured query variants and refuses every write and live request', async () => {
    const adapt = require('../frontend/js/static-portal/platform-demo');
    let requests = 0;
    const window = { fetch: async () => { requests++; } };
    vm.runInNewContext('(' + adapt + ')(data,"sla",{})', { window, data: { responses: { '/api/sla/snapshots': [{ id: 'latest' }] } }, URL, URLSearchParams, Response, document: { addEventListener() {} } });
    assert.equal((await (await window.fetch('/api/sla/snapshots?mode=sqlite')).json())[0].id, 'latest');
    assert.equal((await window.fetch('/api/sla/snapshots', { method: 'DELETE' })).status, 403);
    assert.equal((await window.fetch('https://remote.invalid/api/secret')).status, 404);
    assert.equal(requests, 0);
});

test('automated slide demos keep only the newest deck, then fall back to an empty page', async () => {
    await runWithTenant('demo-fallback', async () => {
        const repo = require('../backend/models/slide-design-repository');
        const slug = 'network_safety_meeting_summary';
        const oversized = 'x'.repeat(require('../backend/models/snapshot-size-policy').HEAVY_BYTES);
        await repo.createProject({ name: 'Old oversized deck', deckHtml: oversized });
        await repo.createProject({ name: 'Newest small deck', deckHtml: '<h1>Newest slide</h1>' });
        const latest = await publishing.estimateToolSnapshot('demo-fallback', slug, 'pages', true);
        assert.equal(latest.demoLevel, 'latest');
        assert.equal(latest.isHeavy, false);
        await repo.createProject({ name: 'Newest oversized deck', deckHtml: oversized });
        const empty = await publishing.estimateToolSnapshot('demo-fallback', slug, 'pages', true);
        assert.equal(empty.demoLevel, 'empty');
        assert.equal(empty.isHeavy, false);
        const html = (await pages.buildPagesSnapshot(slug, { demoLevel: 'empty' })).html;
        assert.match(html, /Read-only demo/);
        assert.doesNotMatch(html, /Newest slide|oversized deck/);
    });
});
