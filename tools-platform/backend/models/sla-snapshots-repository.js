const { run, get, all } = require('./app-db');
const { randomUUID } = require('node:crypto');
const { getDataDir, getTenantId, runWithTenant } = require('./tenant-context');
const rowStore = require('./snapshot-row-store');
const sources = require('./import-source-repository');
const { checkDemoSize } = require('./snapshot-size-policy');

const MAX_SNAPSHOTS = 50;

const initPromises = new Map();

function normalizeSnapshots(items) {
    return Array.isArray(items) ? items : [];
}

async function replaceSnapshotsInDbRaw(items) {
    // 明细行先写进去重表（事务外），快照里只留引用
    const stored = [];
    for (const item of items) stored.push(await rowStore.dehydrate(item));
    await run('BEGIN TRANSACTION');
    try {
        await run('DELETE FROM sla_snapshots');
        for (const item of stored) {
            await run(
                `INSERT OR REPLACE INTO sla_snapshots (id, timestamp, payload_json, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                    item.id,
                    item.timestamp || '',
                    JSON.stringify(item)
                ]
            );
        }
        await run('COMMIT');
    } catch (err) {
        await run('ROLLBACK').catch(() => {});
        throw err;
    }
}

async function ensureReady() {
    const key = getDataDir();
    let initPromise = initPromises.get(key);
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS sla_snapshots (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 旧快照里内嵌的明细行：启动后在后台逐条转成去重存储（每个租户一次）
            const tenantId = getTenantId();
            const timer = setTimeout(() => runWithTenant(tenantId, () => rowStore.compact())
                .then(summary => { if (summary.converted || summary.failed) console.log('[snapshot-rows] 旧快照转换：', JSON.stringify(summary)); })
                .then(() => runWithTenant(tenantId, () => rowStore.collectGarbage()))
                .catch(error => console.warn('[snapshot-rows] 旧快照转换失败：', error.message)), Number(process.env.SNAPSHOT_ROWS_COMPACT_DELAY_MS ?? 90_000));
            timer.unref?.();
        })().catch(err => {
            initPromises.delete(key);
            throw err;
        });
        initPromises.set(key, initPromise);
    }

    return initPromise;
}

async function listFromDb(options={}) {
    await ensureReady();
    const rows = await all(`
        SELECT payload_json
        FROM sla_snapshots
        ${options.since?'WHERE julianday(timestamp)>=julianday(?)':''}
        ORDER BY timestamp DESC, id DESC
    `,options.since?[options.since]:[]);
    return rowStore.hydrateAll(rows.map(row => JSON.parse(row.payload_json)));
}

// 摘要视图：去掉明细数据（sourceSections 表格行、到期工单），保留标识、时间、汇总与指标，只需元数据的页面不必下载整份快照
const HEAVY_SNAPSHOT_KEYS = ['sourceSections', 'expiringTickets'];
function summarizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const summary = { ...snapshot };
    for (const key of HEAVY_SNAPSHOT_KEYS) {
        if (Array.isArray(summary[key])) summary[`${key}Count`] = summary[key].length;
        delete summary[key];
    }
    summary.summaryView = true;
    return summary;
}

// 摘要在 SQLite 里去掉明细再取出：桌面端后端跑在应用主进程里，在 JS 里整份解析
// 最多 50 份、每份数 MB 的快照会让内存涨到 GB 级并卡住整个应用。
async function listSnapshotSummariesFromDb(options={}) {
    await ensureReady();
    const rows = await all(`
        SELECT json_remove(payload_json, '$.sourceSections', '$.expiringTickets') AS payload_json,
               CASE json_type(payload_json, '$.sourceSections') WHEN 'array' THEN json_array_length(payload_json, '$.sourceSections') END AS sourceSectionsCount,
               CASE json_type(payload_json, '$.expiringTickets') WHEN 'array' THEN json_array_length(payload_json, '$.expiringTickets') END AS expiringTicketsCount
        FROM sla_snapshots
        ${options.since?'WHERE julianday(timestamp)>=julianday(?)':''}
        ORDER BY timestamp DESC, id DESC
    `,options.since?[options.since]:[]);
    return rows.map(row => {
        const summary = JSON.parse(row.payload_json);
        if (row.sourceSectionsCount !== null && row.sourceSectionsCount !== undefined) summary.sourceSectionsCount = row.sourceSectionsCount;
        if (row.expiringTicketsCount !== null && row.expiringTicketsCount !== undefined) summary.expiringTicketsCount = row.expiringTicketsCount;
        summary.summaryView = true;
        return summary;
    });
}

async function listSnapshots(options={}) {
    if (options.view === 'summary') {
        try { return { items: await listSnapshotSummariesFromDb(options), source: 'sqlite' }; }
        catch (err) { console.warn('[sla-snapshots] SQL summary failed, falling back:', err.message); }
    }
    const items = await listFromDb(options);
    return { items: options.view === 'summary' ? items.map(summarizeSnapshot) : items, source: 'sqlite' };
}

async function getLatestSnapshot({ demoBudget } = {}) {
    // Schema initialization is tenant-specific, even if another tenant has
    // already initialized this module in the same server process.
    await run(`CREATE TABLE IF NOT EXISTS sla_snapshots (
        id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, payload_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    const row = demoBudget
        ? await get(`SELECT CASE WHEN length(CAST(payload_json AS BLOB)) < ? THEN payload_json END AS payload_json,
                length(CAST(payload_json AS BLOB)) AS payload_bytes
            FROM sla_snapshots ORDER BY timestamp DESC, id DESC LIMIT 1`, [demoBudget])
        : await get('SELECT payload_json FROM sla_snapshots ORDER BY timestamp DESC, id DESC LIMIT 1');
    if (!row) return null;
    checkDemoSize(row.payload_bytes, demoBudget);
    const payload = JSON.parse(row.payload_json);
    // 去重后载荷里只有引用：预算按还原后的大小算
    if (demoBudget) checkDemoSize(Number(row.payload_bytes || 0) + await rowStore.referencedRawBytes(payload), demoBudget);
    return rowStore.hydrate(payload);
}

async function upsertSnapshotInDb(item) {
    await ensureReady();
    const stored = await rowStore.dehydrate(item);
    await run(
        `INSERT INTO sla_snapshots (id, timestamp, payload_json, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
            timestamp = excluded.timestamp,
            payload_json = excluded.payload_json,
            updated_at = CURRENT_TIMESTAMP`,
        [stored.id, stored.timestamp || '', JSON.stringify(stored)]
    );
}

async function trimDbSnapshots() {
    await ensureReady();
    await run(`
        DELETE FROM sla_snapshots
        WHERE id NOT IN (
            SELECT id
            FROM sla_snapshots
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
        )
    `, [MAX_SNAPSHOTS]);
    scheduleRowGarbageCollection();
}

function scheduleRowGarbageCollection() {
    const tenantId = getTenantId();
    rowStore.scheduleGarbageCollection(tenantId, fn => runWithTenant(tenantId, fn));
}

async function addSnapshot(payload) {
    const item = { ...payload, id: payload?.id || randomUUID() };

    await sources.registerSnapshot(item);
    await upsertSnapshotInDb(item);
    await trimDbSnapshots();

    return item;
}

async function deleteSnapshot(id, options = {}) {
    const result = await require('./sla-snapshot-delete').remove(id, options);
    scheduleRowGarbageCollection();
    return result;
}

async function updateSnapshot(id, patch) {
    // 只读这一份，不把全部快照都解析一遍
    await ensureReady();
    const row = await get('SELECT payload_json FROM sla_snapshots WHERE id = ?', [id]);
    if (!row) return null;

    const item = { ...await rowStore.hydrate(JSON.parse(row.payload_json)), ...patch };

    await sources.registerSnapshot(item);
    await upsertSnapshotInDb(item);

    return item;
}

async function replaceSnapshots(items) {
    const normalized = items || [];
    await ensureReady();
    await replaceSnapshotsInDbRaw(normalized);
    return normalized;
}

function getSnapshotTime(item) {
    const time = Date.parse(item && item.timestamp);
    return Number.isFinite(time) ? time : 0;
}

function getSnapshotDateKey(item) {
    const time = getSnapshotTime(item);
    if (!time) return '';
    return new Date(time).toISOString().slice(0, 10);
}

function compareSnapshotsDesc(a, b) {
    const timeDiff = getSnapshotTime(b) - getSnapshotTime(a);
    if (timeDiff) return timeDiff;
    return String(b && b.id || '').localeCompare(String(a && a.id || ''));
}

function planSnapshotCleanup(items, { days = 30, mode = 'dedupe-recent', now = Date.now() } = {}) {
    const safeDays = Math.max(1, Math.min(3650, parseInt(days, 10) || 30));
    const safeMode = ['latest-only', 'retain-days', 'dedupe-recent'].includes(mode)
        ? mode
        : 'dedupe-recent';
    const cutoffTime = Number(now) - safeDays * 24 * 60 * 60 * 1000;
    const snapshots = normalizeSnapshots(items).slice().sort(compareSnapshotsDesc);
    const latestSnapshot = snapshots.find(item => getSnapshotTime(item) > 0) || snapshots[0] || null;
    const latestByDate = new Map();

    snapshots.forEach(item => {
        const time = getSnapshotTime(item);
        if (!time) return;
        if (safeMode !== 'latest-only' && safeMode !== 'dedupe-recent' && time < cutoffTime) return;
        if (safeMode === 'dedupe-recent' && time < cutoffTime) return;
        const key = getSnapshotDateKey(item);
        const current = latestByDate.get(key);
        if (!current || getSnapshotTime(item) > getSnapshotTime(current)) {
            latestByDate.set(key, item);
        }
    });

    const keepIds = new Set();
    if (safeMode === 'latest-only') {
        if (latestSnapshot) keepIds.add(latestSnapshot.id);
    } else {
        Array.from(latestByDate.values()).forEach(item => keepIds.add(item.id));
        // A stale data set must never be cleaned down to zero. Keep its newest
        // snapshot so the report dashboard can still open after retention cleanup.
        if (safeMode === 'retain-days' && latestSnapshot) keepIds.add(latestSnapshot.id);
    }

    const removed = [];
    const kept = [];

    snapshots.forEach(item => {
        const time = getSnapshotTime(item);
        const isLegacyProtected = safeMode === 'dedupe-recent' && (!time || time < cutoffTime);
        if (isLegacyProtected || keepIds.has(item.id)) {
            kept.push(item);
        } else {
            removed.push({
                id: item.id,
                timestamp: item.timestamp,
                date: getSnapshotDateKey(item),
                reason: !time
                    ? 'invalid-timestamp'
                    : safeMode === 'latest-only'
                        ? 'older-than-latest'
                        : time < cutoffTime
                            ? 'outside-retention'
                            : 'same-day-duplicate'
            });
        }
    });

    kept.sort(compareSnapshotsDesc);

    return {
        mode: safeMode,
        days: safeDays,
        cutoff: safeMode === 'latest-only' ? null : new Date(cutoffTime).toISOString(),
        beforeCount: snapshots.length,
        afterCount: kept.length,
        removedCount: removed.length,
        keptDailyCount: latestByDate.size,
        latestSnapshotId: latestSnapshot && latestSnapshot.id || null,
        invalidRemovedCount: removed.filter(item => item.reason === 'invalid-timestamp').length,
        kept,
        removed
    };
}

async function cleanupRedundantDailySnapshots({ days = 30, mode = 'dedupe-recent', dryRun = false } = {}) {
    const { items, source } = await listSnapshots();
    const plan = planSnapshotCleanup(items, { days, mode });

    if (!dryRun && plan.removed.length) {
        await replaceSnapshots(plan.kept);
    }

    return {
        source,
        dryRun: Boolean(dryRun),
        mode: plan.mode,
        days: plan.days,
        cutoff: plan.cutoff,
        beforeCount: plan.beforeCount,
        afterCount: plan.afterCount,
        removedCount: plan.removedCount,
        keptDailyCount: plan.keptDailyCount,
        latestSnapshotId: plan.latestSnapshotId,
        invalidRemovedCount: plan.invalidRemovedCount,
        removed: plan.removed
    };
}

module.exports = {
    MAX_SNAPSHOTS,
    ensureReady,
    listSnapshots,
    getLatestSnapshot,
    addSnapshot,
    deleteSnapshot,
    updateSnapshot,
    replaceSnapshots,
    planSnapshotCleanup,
    cleanupRedundantDailySnapshots
};
