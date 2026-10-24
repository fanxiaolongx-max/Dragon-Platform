const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-explorer-databases-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const platformDb = require('../backend/models/platform-db');
const { runWithTenant, getDataDir, getReportDataDir } = require('../backend/models/tenant-context');
const databases = require('../backend/models/db-explorer-databases');

const execute = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, err => err ? reject(err) : resolve()));

test('database selection covers runtime databases and preserves tenant and file boundaries', async t => {
    const express = require('express');
    const web = express();
    web.use(express.json());
    web.use((req, _res, next) => runWithTenant(req.headers['x-test-tenant'] || 'default', () => {
        req.user = { role: req.headers['x-test-role'] || 'admin' };
        next();
    }));
    web.use('/api/db-explorer', require('../backend/routes/db-explorer'));
    const server = await new Promise(resolve => {
        const server = web.listen(0, '127.0.0.1', () => resolve(server));
    });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        await appDb.closeDatabase();
        await pool.closeAll();
        await platformDb.closeDatabase();
        fs.rmSync(temp, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}/api/db-explorer`;
    const get = async (endpoint, tenant = 'default') => {
        const response = await fetch(base + endpoint, { headers: { 'x-test-tenant': tenant } });
        return { status: response.status, data: await response.json() };
    };
    const post = async (sql, database, tenant = 'default', endpoint = '/query') => {
        const response = await fetch(base + endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-tenant': tenant },
            body: JSON.stringify({ sql, ...(database === undefined ? {} : { database }) })
        });
        return { status: response.status, data: await response.json() };
    };
    const files = ['tools.db', 'report.db', 'requirements.db', 'ai-knowledge.db', 'chat-history.db', 'datacom-knowledge.db', 'ezscan-warehouse.db'];
    for (const tenant of ['default', 'acme', 'other']) {
        await runWithTenant(tenant, async () => {
            for (const filename of files) {
                const db = filename === 'tools.db' ? appDb.getDatabase() : pool.getConnection(filename, filename === 'report.db' ? 'report' : 'data');
                await execute(db, 'CREATE TABLE explorer_marker (value TEXT)');
                await execute(db, 'INSERT INTO explorer_marker VALUES (?)', [`${tenant}:${filename}`]);
            }
        });
    }
    // An obsolete report.db in the data directory must never shadow the active
    // report database in TOOLS_REPORT_DATA_DIR.
    await execute(pool.getConnection('report.db'), 'CREATE TABLE obsolete_report (value TEXT)');
    // Only direct runtime SQLite files are discoverable, including future modules.
    await execute(pool.getConnection('extra.sqlite'), 'CREATE TABLE extra_table (value TEXT)');
    fs.writeFileSync(path.join(getDataDir(), 'tools.backup.db'), 'backup');
    fs.mkdirSync(path.join(getDataDir(), 'backups'), { recursive: true });
    fs.writeFileSync(path.join(getDataDir(), 'backups', 'archived.db'), 'backup');
    fs.symlinkSync(path.join(getDataDir('other'), 'tools.db'), path.join(getDataDir(), 'foreign.sqlite'));

    const listing = await get('/databases');
    assert.equal(listing.status, 200);
    assert.equal(listing.data.defaultDatabase, 'tools');
    assert.deepEqual(listing.data.databases.map(item => item.id), [
        'tools', 'report', 'requirements', 'ai-knowledge', 'chat-history', 'datacom-knowledge', 'ezscan-warehouse', 'data:extra.sqlite'
    ]);
    assert.ok(listing.data.databases.every(item => !('file' in item)));
    assert.ok(listing.data.databases.every(item => item.description && item.descriptionEn));
    assert.match(listing.data.databases.find(item => item.id === 'tools').description, /SLA/);
    assert.match(listing.data.databases.find(item => item.id === 'data:extra.sqlite').description, /未登记/);
    for (const item of listing.data.databases.slice(0, 7)) {
        const result = await post('SELECT value FROM explorer_marker;', item.id);
        assert.equal(result.status, 200);
        assert.equal(result.data.database, item.id);
        assert.deepEqual(result.data.results[0].rows, [{ value: `default:${item.name}` }]);
        const tables = await get(`/tables?database=${item.id}`);
        assert.equal(tables.status, 200);
        assert.ok(tables.data.includes('explorer_marker'));
        assert.ok(!tables.data.includes('obsolete_report'));
        const catalog = await get(`/catalog?database=${item.id}`);
        assert.equal(catalog.status, 200);
        assert.equal(catalog.data.database, item.id);
        assert.deepEqual(catalog.data.tables.map(table => table.name), tables.data);
        assert.ok(catalog.data.tables.every(table => table.description && table.descriptionEn && table.categoryLabel && table.categoryLabelEn));
        const detail = await get(`/tables/explorer_marker?database=${item.id}`);
        assert.equal(detail.status, 200);
        assert.equal(detail.data.database, item.id);
        assert.equal(detail.data.total, 1);
    }
    assert.equal((await post('SELECT value FROM explorer_marker;')).data.results[0].rows[0].value, 'default:tools.db');
    assert.equal((await post('SELECT value FROM explorer_marker;', 'report', 'default', '/sql')).data.results[0].rows[0].value, 'default:report.db');

    const named = await get('/databases', 'acme');
    assert.ok(named.data.databases.some(item => item.id === 'platform' && item.scope === 'platform' && item.tenantId === null));
    assert.ok(!named.data.databases.some(item => item.id === 'data:extra.sqlite'));
    for (const item of named.data.databases.filter(item => item.id !== 'platform')) {
        const result = await post('SELECT value FROM explorer_marker;', item.id, 'acme');
        assert.deepEqual(result.data.results[0].rows, [{ value: `acme:${item.name}` }]);
    }
    assert.equal((await post('SELECT value FROM explorer_marker;', 'platform', 'acme')).data.results[0].rows[0].value, 'default:tools.db');
    const changes = await post("UPDATE explorer_marker SET value='edited-report';", 'report', 'acme');
    assert.equal(changes.data.results[0].changes, 1);
    assert.equal((await post('SELECT value FROM explorer_marker;', 'tools', 'acme')).data.results[0].rows[0].value, 'acme:tools.db');
    assert.equal((await post('SELECT value FROM explorer_marker;', 'report', 'other')).data.results[0].rows[0].value, 'other:report.db');

    for (const invalid of ['../other/tools.db', path.join(getDataDir('other'), 'tools.db'), 'data:foreign.sqlite', 'missing', 'data:tools.backup.db']) {
        assert.equal((await post('SELECT 1;', invalid)).status, 404);
    }
    assert.equal((await post('SELECT 1;', {})).status, 400);
    assert.equal((await post('SELECT 1;', 'tools', 'default', '/query?database=report')).status, 400);
    for (const endpoint of ['/databases', '/catalog?database=report', '/tables?database=report', '/tables/explorer_marker?database=report']) {
        assert.equal((await fetch(base + endpoint, { headers: { 'x-test-role': 'member' } })).status, 403);
    }
    const forbidden = await fetch(base + '/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-role': 'member' },
        body: JSON.stringify({ sql: 'SELECT 1;', database: 'report' })
    });
    assert.equal(forbidden.status, 403);
    assert.equal((await post("ATTACH DATABASE ':memory:' AS outside;", 'tools')).status, 400);
    const destination = path.join(temp, 'vacuum-export.db');
    assert.equal((await post(`VACUUM INTO '${destination}';`, 'report')).status, 400);
    assert.equal(fs.existsSync(destination), false);

    await execute(pool.getConnection('quoted.sqlite'), 'CREATE TABLE "quoted""table" ("x<>" TEXT)');
    const quoted = await get('/tables/' + encodeURIComponent('quoted"table') + '?database=' + encodeURIComponent('data:quoted.sqlite'));
    assert.equal(quoted.status, 200);
    assert.equal(quoted.data.schema[0].name, 'x<>');
    assert.match(quoted.data.createSql, /CREATE TABLE/);
    const extra = pool.getConnection('extra.sqlite');
    await execute(extra, 'CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    await execute(extra, "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id), payload TEXT NOT NULL DEFAULT 'empty')");
    await execute(extra, 'CREATE INDEX child_parent ON child(parent_id)');
    await execute(extra, 'INSERT INTO parent VALUES (1)');
    await execute(extra, "INSERT INTO child VALUES (1, 1, 'stored-content')");
    const schemaOnly = await get('/tables/child?database=data:extra.sqlite&view=schema');
    assert.equal(schemaOnly.status, 200);
    assert.equal(schemaOnly.data.total, 1);
    assert.equal(schemaOnly.data.view, 'schema');
    assert.deepEqual(schemaOnly.data.rows, []);
    assert.equal(schemaOnly.data.schema.find(column => column.name === 'payload').notnull, 1);
    assert.equal(schemaOnly.data.indexes[0].columns[0].name, 'parent_id');
    assert.equal(schemaOnly.data.foreignKeys[0].table, 'parent');
    assert.equal((await get('/tables/child?database=data:extra.sqlite')).data.rows[0].payload, 'stored-content');
    assert.equal((await get('/catalog?database=missing')).status, 404);
    const missingFile = path.join(getDataDir(), 'deleted.sqlite');
    fs.writeFileSync(missingFile, '');
    assert.ok(databases.listDatabases().some(item => item.id === 'data:deleted.sqlite'));
    fs.unlinkSync(missingFile);
    assert.equal((await get('/tables?database=data:deleted.sqlite')).status, 404);
    assert.equal(fs.existsSync(missingFile), false);
    const emptyNames = ['app.db', 'database.sqlite', 'platform.sqlite', 'sla.db', 'uiv_repository.db', 'uiv_scripts.db'];
    for (const name of emptyNames) fs.writeFileSync(path.join(getDataDir(), name), '');
    const withEmpty = await get('/databases');
    for (const name of emptyNames) {
        const item = withEmpty.data.databases.find(item => item.id === `data:${name}`);
        assert.equal(item.kind, 'empty');
        assert.match(item.label, /空数据库/);
        assert.match(item.description, /0 字节/);
        assert.deepEqual((await get('/catalog?database=' + encodeURIComponent(item.id))).data.tables, []);
        assert.deepEqual((await get('/tables?database=' + encodeURIComponent(item.id))).data, []);
        assert.equal(fs.statSync(path.join(getDataDir(), name)).size, 0, 'browsing an empty file must not initialize it');
    }
    assert.notEqual(getReportDataDir(), getDataDir());
});
