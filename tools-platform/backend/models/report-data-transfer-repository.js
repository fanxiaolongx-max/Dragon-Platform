const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const appDb = require('./app-db');
const { databasePath, getConnection } = require('./tenant-sqlite-pool');
const { getReportDataDir, getTenantId } = require('./tenant-context');

const PACKAGE_TYPE = 'tools-platform-report-data-backup';
const PACKAGE_VERSION = 1;
const MAX_ROWS_PER_TABLE = 2_000_000;

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
        error ? reject(error) : resolve({ changes: this.changes, lastID: this.lastID });
    }));
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

async function ensureSchemas() {
    await appDb.run(`CREATE TABLE IF NOT EXISTS sla_snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const reportDb = getConnection('report.db', 'report');
    await dbRun(reportDb, `CREATE TABLE IF NOT EXISTS ReportSnapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT,
        month INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        stored_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        standard_total_score REAL,
        raw_data_json TEXT,
        image_path TEXT,
        excel_path TEXT
    )`);
    await dbRun(reportDb, `CREATE TABLE IF NOT EXISTS ReportCategoryScores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT,
        month INTEGER,
        cat_name TEXT,
        base_score REAL,
        manual_score REAL,
        final_score REAL
    )`);
    await dbRun(reportDb, `CREATE TABLE IF NOT EXISTS ReportMetricData (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id TEXT,
        month INTEGER,
        cat_name TEXT,
        metric_label TEXT,
        weight REAL,
        target_val TEXT,
        raw_val TEXT,
        num_val REAL,
        is_failing INTEGER,
        gap TEXT,
        earned_score REAL,
        proportional_scoring INTEGER,
        completion_ratio REAL
    )`);
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function attachmentNameFromApiPath(value) {
    const prefix = '/api/db/images/';
    if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
    const decoded = decodeURIComponent(value.slice(prefix.length));
    if (!decoded || decoded !== path.basename(decoded) || decoded.includes('..')) return null;
    return decoded;
}

function collectAttachmentNamesFromValue(value, names, seen = new Set()) {
    if (typeof value === 'string') {
        const name = attachmentNameFromApiPath(value);
        if (name) names.add(name);
        return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
        value.forEach(item => collectAttachmentNamesFromValue(item, names, seen));
        return;
    }
    Object.values(value).forEach(item => collectAttachmentNamesFromValue(item, names, seen));
}

function collectAttachmentNamesFromJson(text, names) {
    if (typeof text !== 'string' || !text.trim()) return;
    try {
        collectAttachmentNamesFromValue(JSON.parse(text), names);
    } catch (_) {
        // Invalid JSON is validated elsewhere; attachment discovery should remain best-effort.
    }
}

async function collectData() {
    await ensureSchemas();
    const reportDb = getConnection('report.db', 'report');
    const [snapshotRows, reportSnapshots, categoryScores, metricData] = await Promise.all([
        appDb.all('SELECT id, timestamp, payload_json, updated_at FROM sla_snapshots ORDER BY timestamp, id'),
        dbAll(reportDb, 'SELECT snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json, image_path, excel_path FROM ReportSnapshots ORDER BY id'),
        dbAll(reportDb, 'SELECT snapshot_id, month, cat_name, base_score, manual_score, final_score FROM ReportCategoryScores ORDER BY id'),
        dbAll(reportDb, 'SELECT snapshot_id, month, cat_name, metric_label, weight, target_val, raw_val, num_val, is_failing, gap, earned_score, proportional_scoring, completion_ratio FROM ReportMetricData ORDER BY id')
    ]);
    // 导出包要能独立使用：去重存储的明细行还原回快照里
    const rowStore = require('./snapshot-row-store');
    const memo = new Map();
    for (const row of snapshotRows) {
        try { row.payload_json = JSON.stringify(await rowStore.hydrate(JSON.parse(row.payload_json), memo)); } catch (_) { /* 非法 JSON 原样导出 */ }
    }
    return {
        slaSnapshots: snapshotRows,
        reportSnapshots,
        reportCategoryScores: categoryScores,
        reportMetricData: metricData
    };
}

async function createBackupPackage() {
    const data = await collectData();
    const zip = new JSZip();
    const attachmentNames = new Set();
    data.reportSnapshots.forEach(row => {
        // Full-report screenshots and generated Excel files are derived output.
        // Do not move them between sites; only preserve evidence files referenced
        // by the source JSON, whose binary content cannot be regenerated.
        row.image_path = null;
        row.excel_path = null;
        collectAttachmentNamesFromJson(row.raw_data_json, attachmentNames);
    });
    data.slaSnapshots.forEach(row => collectAttachmentNamesFromJson(row.payload_json, attachmentNames));
    const dataText = JSON.stringify(data);

    const imagesDir = path.join(getReportDataDir(), 'images');
    const includedAttachments = [];
    for (const name of attachmentNames) {
        const filePath = path.join(imagesDir, name);
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
        const content = fs.readFileSync(filePath);
        zip.file(`report-files/${name}`, content);
        includedAttachments.push({ name, sha256: sha256(content), size: content.length });
    }

    const manifest = {
        type: PACKAGE_TYPE,
        version: PACKAGE_VERSION,
        createdAt: new Date().toISOString(),
        sourceTenantId: getTenantId(),
        scope: ['sla_snapshots', 'ReportSnapshots', 'ReportCategoryScores', 'ReportMetricData'],
        counts: {
            slaSnapshots: data.slaSnapshots.length,
            reportSnapshots: data.reportSnapshots.length,
            reportCategoryScores: data.reportCategoryScores.length,
            reportMetricData: data.reportMetricData.length,
            attachments: includedAttachments.length
        },
        dataSha256: sha256(dataText),
        attachments: includedAttachments
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('data.json', dataText);
    return {
        buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }),
        manifest
    };
}

function assertArray(data, key) {
    if (!Array.isArray(data[key])) throw new Error(`备份包缺少有效的 ${key} 数据`);
    if (data[key].length > MAX_ROWS_PER_TABLE) throw new Error(`${key} 数据量超出安全上限`);
}

function validateData(data) {
    if (!data || typeof data !== 'object') throw new Error('备份数据格式无效');
    ['slaSnapshots', 'reportSnapshots', 'reportCategoryScores', 'reportMetricData'].forEach(key => assertArray(data, key));
    data.slaSnapshots.forEach(row => {
        if (!row || typeof row.id !== 'string' || !row.id.trim()) throw new Error('SLA 快照 ID 无效');
        if (typeof row.payload_json !== 'string') throw new Error(`SLA 快照 ${row.id} 缺少有效内容`);
        JSON.parse(row.payload_json);
    });
    data.reportSnapshots.forEach(row => {
        if (!row || typeof row.snapshot_id !== 'string' || !row.snapshot_id.trim()) throw new Error('入库快照 ID 无效');
    });
    [...data.reportCategoryScores, ...data.reportMetricData].forEach(row => {
        if (!row || typeof row.snapshot_id !== 'string' || !row.snapshot_id.trim()) throw new Error('入库明细的快照 ID 无效');
    });
    return data;
}

async function readBackupPackage(input) {
    const buffer = Buffer.isBuffer(input) ? input : fs.readFileSync(input);
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const manifestFile = zip.file('manifest.json');
    const dataFile = zip.file('data.json');
    if (!manifestFile || !dataFile) throw new Error('不是有效的报表数据备份包');
    const manifest = JSON.parse(await manifestFile.async('string'));
    if (manifest.type !== PACKAGE_TYPE || manifest.version !== PACKAGE_VERSION) throw new Error('备份包类型或版本不受支持');
    const dataText = await dataFile.async('string');
    if (manifest.dataSha256 !== sha256(dataText)) throw new Error('备份数据完整性校验失败');
    return { zip, manifest, data: validateData(JSON.parse(dataText)) };
}

function naturalKey(row) {
    return `${row.snapshot_id}\u0000${row.month === null || row.month === undefined ? '' : row.month}`;
}

async function restoreRows(data, mode) {
    const safeMode = mode === 'replace' ? 'replace' : 'merge';
    await ensureSchemas();
    const toolsDb = appDb.getDatabase();
    const reportPath = databasePath('report.db', 'report');
    const alias = 'report_data_transfer';
    const attached = await dbAll(toolsDb, 'PRAGMA database_list');
    if (attached.some(row => row.name === alias)) await dbRun(toolsDb, `DETACH DATABASE ${alias}`);
    await dbRun(toolsDb, `ATTACH DATABASE ? AS ${alias}`, [reportPath]);

    try {
        await dbRun(toolsDb, 'BEGIN IMMEDIATE TRANSACTION');
        if (safeMode === 'replace') {
            await dbRun(toolsDb, 'DELETE FROM sla_snapshots');
            await dbRun(toolsDb, `DELETE FROM ${alias}.ReportMetricData`);
            await dbRun(toolsDb, `DELETE FROM ${alias}.ReportCategoryScores`);
            await dbRun(toolsDb, `DELETE FROM ${alias}.ReportSnapshots`);
        } else {
            const keys = [...new Set([
                ...data.reportSnapshots,
                ...data.reportCategoryScores,
                ...data.reportMetricData
            ].map(naturalKey))];
            for (const key of keys) {
                const [snapshotId, monthText] = key.split('\u0000');
                const month = monthText === '' ? null : Number(monthText);
                const params = [snapshotId, month, month];
                const where = 'snapshot_id = ? AND (month = ? OR (month IS NULL AND ? IS NULL))';
                await dbRun(toolsDb, `DELETE FROM ${alias}.ReportMetricData WHERE ${where}`, params);
                await dbRun(toolsDb, `DELETE FROM ${alias}.ReportCategoryScores WHERE ${where}`, params);
                await dbRun(toolsDb, `DELETE FROM ${alias}.ReportSnapshots WHERE ${where}`, params);
            }
        }

        for (const row of data.slaSnapshots) {
            await dbRun(toolsDb, `INSERT INTO sla_snapshots (id, timestamp, payload_json, updated_at)
                VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
                ON CONFLICT(id) DO UPDATE SET timestamp=excluded.timestamp, payload_json=excluded.payload_json, updated_at=excluded.updated_at`,
            [row.id, row.timestamp || '', row.payload_json, row.updated_at || null]);
        }
        for (const row of data.reportSnapshots) {
            await dbRun(toolsDb, `INSERT INTO ${alias}.ReportSnapshots
                (snapshot_id, month, created_at, stored_at, standard_total_score, raw_data_json, image_path, excel_path)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.snapshot_id, row.month ?? null, row.created_at || null, row.stored_at || null, row.standard_total_score ?? null, row.raw_data_json ?? null, row.image_path ?? null, row.excel_path ?? null]);
        }
        for (const row of data.reportCategoryScores) {
            await dbRun(toolsDb, `INSERT INTO ${alias}.ReportCategoryScores
                (snapshot_id, month, cat_name, base_score, manual_score, final_score) VALUES (?, ?, ?, ?, ?, ?)`,
            [row.snapshot_id, row.month ?? null, row.cat_name ?? null, row.base_score ?? null, row.manual_score ?? null, row.final_score ?? null]);
        }
        for (const row of data.reportMetricData) {
            await dbRun(toolsDb, `INSERT INTO ${alias}.ReportMetricData
                (snapshot_id, month, cat_name, metric_label, weight, target_val, raw_val, num_val, is_failing, gap, earned_score, proportional_scoring, completion_ratio)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.snapshot_id, row.month ?? null, row.cat_name ?? null, row.metric_label ?? null, row.weight ?? null, row.target_val ?? null, row.raw_val ?? null, row.num_val ?? null, row.is_failing ? 1 : 0, row.gap ?? null, row.earned_score ?? null, row.proportional_scoring ? 1 : 0, row.completion_ratio ?? null]);
        }
        await dbRun(toolsDb, 'COMMIT');
    } catch (error) {
        await dbRun(toolsDb, 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await dbRun(toolsDb, `DETACH DATABASE ${alias}`).catch(() => {});
    }
    return safeMode;
}

async function restoreBackupPackage(input, { mode = 'merge' } = {}) {
    const { zip, manifest, data } = await readBackupPackage(input);
    const attachments = [];
    for (const descriptor of Array.isArray(manifest.attachments) ? manifest.attachments : []) {
        const name = typeof descriptor === 'string' ? descriptor : descriptor && descriptor.name;
        if (!name || name !== path.basename(name) || name.includes('..')) throw new Error('备份包附件名称无效');
        const entry = zip.file(`report-files/${name}`);
        if (!entry) throw new Error(`备份包缺少附件：${name}`);
        const content = await entry.async('nodebuffer');
        if (descriptor && descriptor.sha256 && descriptor.sha256 !== sha256(content)) {
            throw new Error(`附件完整性校验失败：${name}`);
        }
        attachments.push({ name, content });
    }
    const safeMode = await restoreRows(data, mode);
    const imagesDir = path.join(getReportDataDir(), 'images');
    fs.mkdirSync(imagesDir, { recursive: true });
    for (const attachment of attachments) {
        fs.writeFileSync(path.join(imagesDir, attachment.name), attachment.content);
    }
    return {
        success: true,
        mode: safeMode,
        sourceTenantId: manifest.sourceTenantId || '',
        counts: {
            slaSnapshots: data.slaSnapshots.length,
            reportSnapshots: data.reportSnapshots.length,
            reportCategoryScores: data.reportCategoryScores.length,
            reportMetricData: data.reportMetricData.length,
            attachments: attachments.length
        }
    };
}

module.exports = {
    PACKAGE_TYPE,
    PACKAGE_VERSION,
    collectData,
    createBackupPackage,
    readBackupPackage,
    restoreBackupPackage,
    restoreRows,
    validateData
};
