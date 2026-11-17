// 快照明细行去重存储：两张快照表、多份快照共享同一份压缩数据；读出来与原来完全一致；
// 旧快照可逐条转换；没人引用的数据块会被回收；导出备份包是完整数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-row-store-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report');
process.env.SNAPSHOT_ROWS_COMPACT_DELAY_MS = String(24 * 3600 * 1000); // 测试里手动触发转换
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const snapshots = require('../backend/models/sla-snapshots-repository');
const sources = require('../backend/models/import-source-repository');
const rowStore = require('../backend/models/snapshot-row-store');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const rows = (n, tag = '') => Array.from({ length: n }, (_, i) => ({ id: `T${i}`, name: `系统部${i % 4}${tag}`, note: 'x'.repeat(80), 'a,"b"': i }));
const snapshot = (id, timestamp, sections) => ({
    id, timestamp, files: ['risk.csv'], topMetrics: [{ key: 'k', label: '闭环率', value: '97%' }], expiringTickets: [{ id: 1 }],
    sourceSections: sections.map(([key, data]) => ({ key, title: key, headers: Object.keys(data[0] || {}), sourceFiles: [`${key}.csv`], rows: data }))
});
const raw = (table, id) => appDb.get(`SELECT payload_json FROM ${table} WHERE id=?`, [id]).then(row => JSON.parse(row.payload_json));

test('two snapshot tables and repeated daily snapshots share one compressed copy, and read back unchanged', () => runWithTenant('default', async () => {
    const big = rows(400), small = rows(3);
    const day1 = snapshot('day1', '2026-11-16T08:00:00.000Z', [['risk', big], ['other_a', small]]);
    const day2 = snapshot('day2', '2026-11-17T08:00:00.000Z', [['risk', big], ['other_a', rows(3, '改')]]);
    await snapshots.addSnapshot(day1);
    await snapshots.addSnapshot(day2);

    const stored = await raw('sla_snapshots', 'day1');
    assert.equal(stored.sourceSections[0].rows, undefined, 'detail rows are not stored inline');
    assert.equal(stored.sourceSections[0].rowCount, 400);
    assert.equal((await raw('import_source_snapshots', 'day1')).sourceSections[0].rowsRef, stored.sourceSections[0].rowsRef, 'both tables point at the same data');
    const blobs = await appDb.all('SELECT row_count, length(data) AS bytes, raw_bytes FROM snapshot_row_blobs ORDER BY row_count DESC');
    assert.deepEqual(blobs.map(b => b.row_count), [400, 3, 3], 'the unchanged 400-row table is stored once for two days and two tables');
    assert.ok(blobs[0].bytes * 5 < blobs[0].raw_bytes, `compressed ${blobs[0].bytes} vs ${blobs[0].raw_bytes}`);

    const list = (await snapshots.listSnapshots({})).items;
    assert.deepEqual(list.map(item => item.id), ['day2', 'day1']);
    assert.deepEqual(list[1].sourceSections, day1.sourceSections.map(section => ({ ...section })), 'full view returns exactly what was saved');
    assert.deepEqual((await snapshots.getLatestSnapshot()).sourceSections[1].rows, rows(3, '改'));
    const summary = (await snapshots.listSnapshots({ view: 'summary' })).items[0];
    assert.deepEqual([summary.sourceSections, summary.sourceSectionsCount], [undefined, 2]);

    // 月报资料库读取单张表、指标溯源和归档体积
    assert.deepEqual((await sources.getSection('day1', 'risk')).rows, big);
    assert.deepEqual((await sources.getArchivedSnapshot('day2')).sourceSections[0].rows, big);
    const bytes = await sources.getSnapshotArchiveBytes('day1', null);
    assert.ok(bytes > Buffer.byteLength(JSON.stringify(big)), 'archive size still counts the full rows');
    await assert.rejects(snapshots.getLatestSnapshot({ demoBudget: 1000 }), /预算/, 'demo budget is checked against the restored size');

    // 规则刷新只改指标：明细引用保持不变
    await snapshots.updateSnapshot('day2', { topMetrics: [{ key: 'k', label: '闭环率', value: '98%' }] });
    const updated = (await snapshots.listSnapshots({})).items[0];
    assert.equal(updated.topMetrics[0].value, '98%');
    assert.deepEqual(updated.sourceSections[0].rows, big);
}));

test('old inline snapshots are converted one by one after verifying, and unreferenced data is collected', () => runWithTenant('default', async () => {
    const legacy = snapshot('legacy', '2026-11-10T08:00:00.000Z', [['risk', rows(50, '旧')]]);
    await appDb.run('INSERT INTO sla_snapshots (id, timestamp, payload_json) VALUES (?,?,?)', [legacy.id, legacy.timestamp, JSON.stringify(legacy)]);
    assert.deepEqual((await snapshots.listSnapshots({})).items.find(item => item.id === 'legacy').sourceSections, legacy.sourceSections, 'inline snapshots still read as before');

    const result = await rowStore.compact({ pauseMs: 0 });
    assert.equal(result.converted, 1);
    assert.equal((await raw('sla_snapshots', 'legacy')).sourceSections[0].rows, undefined);
    assert.deepEqual((await snapshots.listSnapshots({})).items.find(item => item.id === 'legacy').sourceSections, legacy.sourceSections);
    assert.equal((await rowStore.compact({ pauseMs: 0 })).converted, 0, 'repeatable');

    // 删除 day1 后它独有的那份数据没人引用了；刚写入的不回收，过了保护期才回收
    await snapshots.deleteSnapshot('day1');
    const before = (await appDb.get('SELECT COUNT(*) AS n FROM snapshot_row_blobs')).n;
    assert.equal(await rowStore.collectGarbage(), 0, 'nothing younger than the grace period is removed');
    const removed = await rowStore.collectGarbage({ graceMs: -1 });
    assert.equal(removed, 1, 'only the small table that day1 alone used');
    assert.equal((await appDb.get('SELECT COUNT(*) AS n FROM snapshot_row_blobs')).n, before - 1);
    assert.deepEqual((await snapshots.getLatestSnapshot()).sourceSections[0].rows, rows(400), 'shared data is kept');
}));

test('a missing data block degrades to empty rows instead of breaking the list', () => runWithTenant('default', async () => {
    const restored = await rowStore.hydrate({ sourceSections: [{ key: 'x', rowsRef: 'f'.repeat(64), rowCount: 3 }] });
    assert.deepEqual([restored.sourceSections[0].rows, restored.sourceSections[0].rowsMissing], [[], true]);
}));
