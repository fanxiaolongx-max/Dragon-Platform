const crypto = require('node:crypto');
const { run, get, all } = require('./app-db');
const { getTenantId } = require('./tenant-context');
const model = require('../../frontend/js/ai-report/report-model');

const MAX_PAYLOAD = 8 * 1024 * 1024;
const readyByTenant = new Map();

async function addColumnIfMissing(tableName, columnName, definition) {
    const columns = await all(`PRAGMA table_info(${tableName})`);
    if (!columns.some(column => column.name === columnName)) {
        await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

// Each tenant has its own database, so the table check is cached per tenant.
function ready() {
    const tenant = getTenantId();
    if (!readyByTenant.has(tenant)) {
        readyByTenant.set(tenant, (async () => {
            await run(`CREATE TABLE IF NOT EXISTS ai_report_documents (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, report_month TEXT NOT NULL,
                payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT,
                is_default INTEGER NOT NULL DEFAULT 0)`);
            await addColumnIfMissing('ai_report_documents', 'is_default', 'INTEGER NOT NULL DEFAULT 0');
        })().catch(error => { readyByTenant.delete(tenant); throw error; }));
    }
    return readyByTenant.get(tenant);
}

function notFound() {
    const error = new Error('Report not found');
    error.status = 404;
    return error;
}

function checkId(id) {
    if (typeof id !== 'string' || !/^[-\w]{1,80}$/.test(id)) {
        const error = new Error('Invalid report ID');
        error.status = 400;
        throw error;
    }
}

async function list() {
    await ready();
    const rows = await all(
        `SELECT id, name, report_month AS reportMonth, updated_at AS updatedAt, updated_by AS updatedBy, is_default AS isDefault
         FROM ai_report_documents
         ORDER BY is_default DESC, updated_at DESC, id`
    );
    return rows.map(row => ({ ...row, isDefault: Boolean(row.isDefault) }));
}

async function read(id) {
    checkId(id);
    await ready();
    const row = await get('SELECT payload_json, updated_at, is_default FROM ai_report_documents WHERE id = ?', [id]);
    if (!row) throw notFound();
    return { ...JSON.parse(row.payload_json), id, updatedAt: row.updated_at, isDefault: Boolean(row.is_default) };
}

// Saves are whole-document; the payload is normalized first so stored reports always match the model.
async function save(input, user = '') {
    const document = model.normalize(input);
    document.id ||= 'report-' + crypto.randomUUID();
    if (!document.reportMonth) {
        const error = new Error('Report month is required');
        error.status = 400;
        throw error;
    }
    const now = new Date().toISOString();
    document.updatedAt = now;
    const payload = JSON.stringify(document);
    if (Buffer.byteLength(payload) > MAX_PAYLOAD) {
        const error = new Error('Report is too large to save');
        error.status = 413;
        throw error;
    }
    await ready();
    await run(`INSERT INTO ai_report_documents (id, name, report_month, payload_json, created_at, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, report_month = excluded.report_month,
        payload_json = excluded.payload_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [document.id, document.name, document.reportMonth, payload, now, now, String(user || '').slice(0, 200)]);
    const savedRow = await get('SELECT is_default FROM ai_report_documents WHERE id = ?', [document.id]);
    return { ...document, isDefault: Boolean(savedRow?.is_default) };
}

async function setDefault(id, { isDefault = true } = {}) {
    checkId(id);
    await ready();
    const row = await get('SELECT id FROM ai_report_documents WHERE id = ?', [id]);
    if (!row) throw notFound();
    const nextDefault = Boolean(isDefault);
    if (nextDefault) {
        await run(
            'UPDATE ai_report_documents SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE id = ? OR is_default != 0',
            [id, id]
        );
    } else {
        await run('UPDATE ai_report_documents SET is_default = 0 WHERE id = ?', [id]);
    }
    return { id, isDefault: nextDefault };
}

async function remove(id) {
    checkId(id);
    await ready();
    const row = await get('SELECT id FROM ai_report_documents WHERE id = ?', [id]);
    if (!row) throw notFound();
    await run('DELETE FROM ai_report_documents WHERE id = ?', [id]);
    return { id, deleted: true };
}

module.exports = { list, read, save, setDefault, remove };
