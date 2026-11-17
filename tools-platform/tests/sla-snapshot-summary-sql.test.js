// 快照摘要列表在 SQLite 里去掉明细，不在 JS 里整份解析全部快照（桌面端后端跑在应用主进程里，
// 50 份数 MB 的快照会让内存涨到 GB 级、整个应用卡住）。结果必须和原来逐份解析再裁剪的一致。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'sla-snapshot-summary-sql-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const repo = require('../backend/models/sla-snapshots-repository');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const legacySummary = snapshot => {
    const summary = { ...snapshot };
    for (const key of ['sourceSections', 'expiringTickets']) {
        if (Array.isArray(summary[key])) summary[`${key}Count`] = summary[key].length;
        delete summary[key];
    }
    summary.summaryView = true;
    return summary;
};

test('summary rows equal the old per-snapshot trimming, including snapshots without detail arrays', () => runWithTenant('default', async () => {
    const full = {
        id: 'full', timestamp: '2026-11-17T09:00:00.000Z', selectedTargetMonth: 11, files: ['a.csv'],
        topMetrics: [{ key: 'm', value: '96%', subMetrics: [{ category: 'x', value: '1' }] }],
        sourceSections: [{ key: 'risk', rows: [{ a: '中文 "引号"' }, { a: 2 }], sourceFiles: ['a.csv'] }],
        expiringTickets: [{ id: 1 }, { id: 2 }, { id: 3 }],
        manualAdjustData: { note: 'kept' }
    };
    const bare = { id: 'bare', timestamp: '2026-11-16T09:00:00.000Z', topMetrics: [], sourceSections: 'not-an-array' };
    await repo.addSnapshot(full);
    await repo.addSnapshot(bare);

    const { items } = await repo.listSnapshots({ view: 'summary' });
    assert.deepEqual(items, [legacySummary(full), legacySummary(bare)]);
    assert.deepEqual(JSON.stringify(items[0]), JSON.stringify(legacySummary(full)), 'same key order as before');

    // 只更新这一份；其余快照不动
    const updated = await repo.updateSnapshot('full', { topMetrics: [{ key: 'm', value: '97%' }] });
    assert.equal(updated.topMetrics[0].value, '97%');
    assert.equal(updated.sourceSections[0].rows.length, 2, 'patch keeps the stored detail rows');
    const after = (await repo.listSnapshots({})).items;
    assert.deepEqual(after.map(item => [item.id, item.topMetrics[0]?.value]), [['full', '97%'], ['bare', undefined]]);
    assert.equal(await repo.updateSnapshot('missing', {}), null);
}));
