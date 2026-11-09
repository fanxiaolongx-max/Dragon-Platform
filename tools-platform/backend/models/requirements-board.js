const fs = require('node:fs');
const { databasePath, getConnection, openExistingConnection } = require('./tenant-sqlite-pool');
const { DEFAULT_TENANT_ID, runWithTenant } = require('./tenant-context');

const FILE = 'requirements.db';
const ready = new WeakMap();
const inBoard = task => runWithTenant(DEFAULT_TENANT_ID, task);

function queries(db) {
    return {
        get: (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row))),
        all: (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (err, rows) => err ? reject(err) : resolve(rows))),
        run: (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function (err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        }))
    };
}

async function board() {
    const db = inBoard(() => getConnection(FILE));
    const query = queries(db);
    if (!ready.has(db)) {
        const pending = (async () => {
            await query.run(`CREATE TABLE IF NOT EXISTS Requirements (
                id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, description TEXT, status TEXT, creator TEXT, assignee TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            const columns = new Set((await query.all('PRAGMA table_info(Requirements)')).map(row => row.name));
            if (!columns.has('category')) await query.run('ALTER TABLE Requirements ADD COLUMN category TEXT');
            if (!columns.has('urgent')) await query.run('ALTER TABLE Requirements ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0');
            if (!columns.has('skill_publication')) await query.run('ALTER TABLE Requirements ADD COLUMN skill_publication TEXT');
            if (!columns.has('images')) await query.run("ALTER TABLE Requirements ADD COLUMN images TEXT NOT NULL DEFAULT '[]'");
            await query.run(`CREATE TABLE IF NOT EXISTS RequirementLogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, req_id INTEGER, old_status TEXT, new_status TEXT,
                remark TEXT, operator TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            await query.run('CREATE TABLE IF NOT EXISTS RequirementImports (tenant TEXT, legacy_id INTEGER, PRIMARY KEY (tenant, legacy_id))');
        })();
        ready.set(db, pending);
        pending.catch(() => ready.delete(db));
    }
    await ready.get(db);
    return query;
}

async function transaction(task) {
    await board();
    const db = await inBoard(() => openExistingConnection(FILE));
    db.configure('busyTimeout', 5000);
    const query = queries(db);
    try {
        await query.run('BEGIN IMMEDIATE');
        const result = await task(query);
        await query.run('COMMIT');
        return result;
    } catch (error) {
        await query.run('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        await new Promise(resolve => db.close(resolve));
    }
}

// Preserve tenant databases and old rows. The import receipt also prevents a
// removed public request from reappearing after a server restart.
async function importTenantRequirements(tenantId) {
    if (tenantId === DEFAULT_TENANT_ID || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(tenantId)) return;
    const source = await runWithTenant(tenantId, async () => {
        if (!fs.existsSync(databasePath(FILE))) return null;
        const db = await openExistingConnection(FILE);
        try {
            const query = queries(db);
            const tables = new Set((await query.all("SELECT name FROM sqlite_master WHERE type = 'table'")).map(row => row.name));
            if (!tables.has('Requirements')) return null;
            return {
                items: await query.all('SELECT * FROM Requirements ORDER BY id'),
                logs: tables.has('RequirementLogs') ? await query.all('SELECT * FROM RequirementLogs ORDER BY id') : []
            };
        } finally {
            await new Promise(resolve => db.close(resolve));
        }
    });
    if (!source?.items.length) return;
    const logsById = new Map();
    for (const log of source.logs) {
        if (!logsById.has(log.req_id)) logsById.set(log.req_id, []);
        logsById.get(log.req_id).push(log);
    }
    await transaction(async query => {
        const imported = new Set((await query.all('SELECT legacy_id FROM RequirementImports WHERE tenant = ?', [tenantId])).map(row => row.legacy_id));
        for (const item of source.items) {
            if (imported.has(item.id)) continue;
            const { id } = await query.run(
                'INSERT INTO Requirements (title, description, category, status, creator, assignee, urgent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [item.title, item.description, item.category || '未分类', item.status, item.creator, item.assignee, item.urgent || 0, item.created_at, item.updated_at]
            );
            for (const log of logsById.get(item.id) || []) {
                await query.run('INSERT INTO RequirementLogs (req_id, old_status, new_status, remark, operator, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, log.old_status, log.new_status, log.remark, log.operator, log.created_at]);
            }
            await query.run('INSERT INTO RequirementImports (tenant, legacy_id) VALUES (?, ?)', [tenantId, item.id]);
        }
    });
}

module.exports = { board, transaction, importTenantRequirements };
