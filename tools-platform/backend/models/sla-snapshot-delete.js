const sqlite3 = require('sqlite3');
const crypto = require('node:crypto');
const { getDbPath, get, all } = require('./app-db');
const sources = require('./import-source-repository');

function fail(message, status) {
    throw Object.assign(new Error(message), { status, code: 'SNAPSHOT_DELETE_ERROR' });
}
function query(connection, method, sql, params = []) {
    return new Promise((resolve, reject) => connection[method](sql, params, function(error, rows) {
        if (error) reject(error);
        else resolve(method === 'run' ? { changes: this.changes } : rows);
    }));
}
async function plan(id, read = get, list = all) {
    const row = await read('SELECT payload_json,updated_at FROM sla_snapshots WHERE id=?', [id]);
    if (!row) fail('Snapshot not found', 404);
    const snapshot = JSON.parse(row.payload_json);
    const directory = await read('SELECT batch_id FROM import_source_snapshots WHERE id=?', [id]);
    const batchId = snapshot.sourceBatchId || directory?.batch_id || null;
    // Batch membership is the explicit archive association; never match filenames in other batches.
    const files = batchId ? await list(`SELECT f.id,f.name,f.kind,f.size,f.sha256,f.created_at,f.parse_status,
        (SELECT COUNT(*) FROM import_source_sheets s WHERE s.file_id=f.id) AS sheetCount
        FROM import_source_files f WHERE f.batch_id=? ORDER BY f.created_at DESC,f.id`, [batchId]) : [];
    const shared = batchId ? await list(`SELECT id FROM import_source_snapshots WHERE batch_id=? AND id<>?
        UNION SELECT id FROM sla_snapshots WHERE id<>? AND
        CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.sourceBatchId') END=?`,
        [batchId, id, id, batchId]) : [];
    const previewToken = crypto.createHash('sha256').update(JSON.stringify([
        getDbPath(), id, row.payload_json, row.updated_at, files, shared
    ])).digest('hex');
    return { snapshotId: id, files, totalBytes: files.reduce((total, file) => total + Number(file.size), 0),
        sharedSnapshotCount: shared.length, previewToken };
}
async function preview(id) {
    await require('./sla-snapshots-repository').ensureReady();
    await sources.ensureReady();
    return plan(id);
}
async function remove(id, options = {}) {
    if (options.deleteOriginals !== undefined && typeof options.deleteOriginals !== 'boolean') fail('Invalid deletion mode', 400);
    if (options.deleteOriginals && (options.confirmed !== true || typeof options.previewToken !== 'string')) fail('Review and confirm the original file list first', 400);
    await require('./sla-snapshots-repository').ensureReady();
    await sources.ensureReady();
    // A private, tenant-aware connection keeps this transaction isolated from concurrent app queries.
    const connection = await new Promise((resolve, reject) => {
        const handle = new sqlite3.Database(getDbPath(), error => error ? reject(error) : resolve(handle));
    });
    try {
        await query(connection, 'run', 'PRAGMA busy_timeout=5000');
        await query(connection, 'run', 'PRAGMA foreign_keys=ON');
        await query(connection, 'run', 'BEGIN IMMEDIATE');
        const impact = await plan(id, (sql, params) => query(connection, 'get', sql, params), (sql, params) => query(connection, 'all', sql, params));
        if (options.deleteOriginals && options.previewToken !== impact.previewToken) fail('Original files changed; review the deletion list again', 409);
        await query(connection, 'run', 'DELETE FROM sla_snapshots WHERE id=?', [id]);
        await query(connection, 'run', 'DELETE FROM import_source_snapshots WHERE id=?', [id]);
        if (options.deleteOriginals) for (const file of impact.files) {
            await query(connection, 'run', 'DELETE FROM import_source_sheets WHERE file_id=?', [file.id]);
            await query(connection, 'run', 'DELETE FROM import_source_files WHERE id=?', [file.id]);
        }
        await query(connection, 'run', 'COMMIT');
        return { success: true, deletedOriginals: options.deleteOriginals ? impact.files.length : 0,
            deletedBytes: options.deleteOriginals ? impact.totalBytes : 0 };
    } catch (error) {
        await query(connection, 'run', 'ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await new Promise((resolve, reject) => connection.close(error => error ? reject(error) : resolve()));
    }
}
module.exports = { preview, remove };
