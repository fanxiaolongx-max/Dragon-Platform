// 快照明细行的去重存储。
//
// 每次导入，同一批源表行会写进 sla_snapshots 和 import_source_snapshots 两张表，
// sla_snapshots 还保留最近 50 份；每天导入时大多数表内容并没有变化。这里把
// sourceSections[].rows 按内容（JSON 的 SHA-256）压缩后单独存一份，快照里只留
// { rowsRef, rowCount }：相同内容只存一次，压缩后约为原来的十分之一。
//
// 读快照时由仓储层调用 hydrate 还原 rows，接口返回的数据与以前完全一致；
// 旧快照（rows 仍内嵌）照常可读，后台 compact 逐条转换，转换前先校验能完整还原。
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { run, get, all } = require('./app-db');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const TABLE = 'snapshot_row_blobs';
const SNAPSHOT_TABLES = ['sla_snapshots', 'import_source_snapshots'];
const GC_GRACE_MS = 60 * 60 * 1000; // 刚写入、还没来得及写快照引用的数据块不回收
const QUERY_BATCH = 200;

// 每个租户库各一张表；建表语句可重复执行
async function ensureReady() {
    await run(`CREATE TABLE IF NOT EXISTS ${TABLE} (
        hash TEXT PRIMARY KEY,
        encoding TEXT NOT NULL DEFAULT 'gzip-json',
        data BLOB NOT NULL,
        row_count INTEGER NOT NULL,
        raw_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
    )`);
}

const hashOf = text => crypto.createHash('sha256').update(text).digest('hex');
const hasInlineRows = section => section && Array.isArray(section.rows) && section.rows.length > 0;
const sectionsOf = payload => (payload && Array.isArray(payload.sourceSections) ? payload.sourceSections : []);

/** 把明细行存进去重表，返回只带引用的新快照（不改传入对象） */
async function dehydrate(payload) {
    const sections = sectionsOf(payload);
    if (!sections.some(hasInlineRows)) return payload;
    await ensureReady();
    const next = [];
    for (const section of sections) {
        if (!hasInlineRows(section)) { next.push(section); continue; }
        const text = JSON.stringify(section.rows);
        const hash = hashOf(text);
        if (!await get(`SELECT 1 AS ok FROM ${TABLE} WHERE hash=?`, [hash])) {
            const data = await gzip(Buffer.from(text, 'utf8'));
            await run(`INSERT OR IGNORE INTO ${TABLE} (hash, encoding, data, row_count, raw_bytes, created_at) VALUES (?, 'gzip-json', ?, ?, ?, ?)`,
                [hash, data, section.rows.length, Buffer.byteLength(text, 'utf8'), new Date().toISOString()]);
        }
        const { rows: _rows, ...rest } = section;
        next.push({ ...rest, rowsRef: hash, rowCount: section.rows.length });
    }
    return { ...payload, sourceSections: next };
}

async function loadBlobs(hashes, memo) {
    const missing = [...new Set(hashes)].filter(hash => !memo.has(hash));
    if (!missing.length) return;
    await ensureReady();
    for (let i = 0; i < missing.length; i += QUERY_BATCH) {
        const batch = missing.slice(i, i + QUERY_BATCH);
        const rows = await all(`SELECT hash, data FROM ${TABLE} WHERE hash IN (${batch.map(() => '?').join(',')})`, batch);
        for (const row of rows) {
            const text = (await gunzip(row.data)).toString('utf8');
            memo.set(row.hash, text);
        }
    }
}

/**
 * 还原明细行。memo 可在一次请求内复用（多份快照引用同一份数据时只解压一次）。
 * 数据块缺失时 rows 为空并标记 rowsMissing，不抛错，避免一份坏数据拖垮整个列表。
 */
async function hydrate(payload, memo = new Map()) {
    const sections = sectionsOf(payload);
    const refs = sections.filter(section => section && section.rowsRef && !Array.isArray(section.rows)).map(section => section.rowsRef);
    if (!refs.length) return payload;
    await loadBlobs(refs, memo);
    return {
        ...payload,
        sourceSections: sections.map(section => {
            if (!section || !section.rowsRef || Array.isArray(section.rows)) return section;
            const text = memo.get(section.rowsRef);
            if (text === undefined) {
                console.warn('[snapshot-rows] 明细数据块缺失：', section.rowsRef);
                return { ...section, rows: [], rowsMissing: true };
            }
            const { rowsRef: _ref, rowCount: _count, ...rest } = section;
            return { ...rest, rows: JSON.parse(text) };
        })
    };
}

async function hydrateAll(payloads) {
    const memo = new Map();
    const out = [];
    for (const payload of payloads) out.push(await hydrate(payload, memo));
    return out;
}

/** 引用的数据块还原后的原始字节数（用于体积预算，去重后载荷本身已经很小） */
async function referencedRawBytes(payload) {
    const refs = [...new Set(sectionsOf(payload).map(section => section && section.rowsRef).filter(Boolean))];
    if (!refs.length) return 0;
    await ensureReady();
    const row = await get(`SELECT COALESCE(SUM(raw_bytes), 0) AS bytes FROM ${TABLE} WHERE hash IN (${refs.map(() => '?').join(',')})`, refs);
    return Number(row?.bytes || 0);
}

async function existingSnapshotTables() {
    const rows = await all(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${SNAPSHOT_TABLES.map(() => '?').join(',')})`, SNAPSHOT_TABLES);
    return rows.map(row => row.name);
}

/** 回收没有任何快照引用、且写入超过一小时的数据块 */
async function collectGarbage({ graceMs = GC_GRACE_MS } = {}) {
    await ensureReady();
    const tables = await existingSnapshotTables();
    const refs = tables.map(table => `SELECT json_extract(s.value, '$.rowsRef') AS hash FROM ${table} t, json_each(t.payload_json, '$.sourceSections') s
        WHERE json_valid(t.payload_json) AND json_type(t.payload_json, '$.sourceSections') = 'array' AND json_extract(s.value, '$.rowsRef') IS NOT NULL`).join(' UNION ');
    const cutoff = new Date(Date.now() - graceMs).toISOString();
    const result = await run(`DELETE FROM ${TABLE} WHERE created_at < ?${refs ? ` AND hash NOT IN (${refs})` : ''}`, [cutoff]);
    return result?.changes || 0;
}

const gcTimers = new Map();
/** 快照被裁剪、删除后稍后回收（同一租户短时间内的多次触发合并成一次） */
function scheduleGarbageCollection(key = 'default', runInTenant = fn => fn()) {
    if (gcTimers.has(key)) return;
    const timer = setTimeout(() => {
        gcTimers.delete(key);
        runInTenant(() => collectGarbage()).catch(error => console.warn('[snapshot-rows] 回收失败：', error.message));
    }, 30_000);
    timer.unref?.();
    gcTimers.set(key, timer);
}

/**
 * 把旧快照里内嵌的明细行逐条转成引用。每条先写数据块、校验能完整还原（哈希一致），
 * 再按原值条件更新（期间被别处改过就跳过），出错只跳过这一条。逐条之间让出事件循环，
 * 桌面端（后端跑在应用主进程里）不会因此卡住。
 */
async function compact({ pauseMs = 50, limit = Infinity } = {}) {
    await ensureReady();
    const summary = { converted: 0, skipped: 0, failed: 0 };
    for (const table of await existingSnapshotTables()) {
        const ids = await all(`SELECT id FROM ${table} WHERE json_valid(payload_json) AND EXISTS (
            SELECT 1 FROM json_each(payload_json, '$.sourceSections') s WHERE json_type(s.value, '$.rows') = 'array' AND json_array_length(s.value, '$.rows') > 0)`);
        for (const { id } of ids) {
            if (summary.converted >= limit) return summary;
            try {
                const row = await get(`SELECT payload_json FROM ${table} WHERE id=?`, [id]);
                if (!row) { summary.skipped++; continue; }
                const original = JSON.parse(row.payload_json);
                const compacted = await dehydrate(original);
                const restored = await hydrate(compacted);
                const same = sectionsOf(original).every((section, index) => !hasInlineRows(section)
                    || hashOf(JSON.stringify(restored.sourceSections[index].rows)) === hashOf(JSON.stringify(section.rows)));
                if (!same) { summary.failed++; continue; }
                const result = await run(`UPDATE ${table} SET payload_json=? WHERE id=? AND payload_json=?`, [JSON.stringify(compacted), id, row.payload_json]);
                if (result?.changes) summary.converted++; else summary.skipped++;
            } catch (error) {
                summary.failed++;
                console.warn(`[snapshot-rows] 转换 ${table}#${id} 失败：`, error.message);
            }
            await new Promise(resolve => setTimeout(resolve, pauseMs));
        }
    }
    return summary;
}

module.exports = { ensureReady, dehydrate, hydrate, hydrateAll, referencedRawBytes, collectGarbage, scheduleGarbageCollection, compact, TABLE };
