const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-database-tools-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'runtime');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const sqlite3 = require('../backend/node_modules/sqlite3');
const tenant = require('../backend/models/tenant-context');
const service = require('../backend/models/agent-database-service');
const tools = require('../backend/models/agent-tools-service');
const root = path.join(sandbox, 'project');
fs.mkdirSync(root);
const ctx = { root, sensitiveValues: ['unlabelled-runtime-key-value'] };

async function create(file, sql) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = await new Promise((resolve, reject) => { const connection = new sqlite3.Database(file, error => error ? reject(error) : resolve(connection)); });
    await new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
    await new Promise(resolve => db.close(resolve));
}

test.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('platform database IDs always resolve inside the current tenant, even after another tenant opens', async () => {
    for (const id of ['default', 'other']) {
        const dir = tenant.getDataDir(id);
        await create(path.join(dir, 'tools.db'), `CREATE TABLE items (id INTEGER, label TEXT); INSERT INTO items VALUES (1, '${id} only'); CREATE TABLE auth_users (password TEXT); INSERT INTO auth_users VALUES ('never-return-this');`);
    }
    for (const id of ['default', 'other', 'default']) await tenant.runWithTenant(id, async () => {
        const listed = await service.listDatabases(ctx);
        assert.equal(listed.databases.some(item => item.id === 'platform:data/tools.db'), true);
        assert.equal(JSON.stringify(listed).includes('never-return'), false);
        const schema = await service.schema(ctx, { database: 'platform:data/tools.db' });
        assert.deepEqual(schema.tables, ['items']);
        const result = await service.readTable(ctx, { database: 'platform:data/tools.db', table: 'items' });
        assert.equal(result.rows[0].label, `${id} only`);
        await assert.rejects(service.readTable(ctx, { database: 'platform:data/tools.db', table: 'auth_users' }), { code: 'AGENT_DATABASE_FORBIDDEN' });
    });
});

test('local SQLite reads exclude credentials and views and use parameterized structured filters', async () => {
    await create(path.join(root, 'local.db'), `CREATE TABLE records (id INTEGER, label TEXT, api_token TEXT, payload TEXT);
        INSERT INTO records VALUES (1, 'normal', 'never-return-column', '{"password":"never-return-json"}');
        INSERT INTO records VALUES (2, 'unlabelled-runtime-key-value', 'also-hidden', 'ordinary');
        CREATE TABLE settings_values (key_name TEXT, value TEXT);
        INSERT INTO settings_values VALUES ('api_key', 'never-return-key-value');
        CREATE TABLE auth_users (id INTEGER, password TEXT);
        INSERT INTO auth_users VALUES (3, 'never-return-auth');
        CREATE VIEW disguised AS SELECT password AS label FROM auth_users;`);
    const listed = await service.listDatabases(ctx);
    assert.equal(listed.databases.some(item => item.id === 'local:local.db'), true);
    const schema = await service.schema(ctx, { database: 'local:local.db', table: 'records' });
    assert.deepEqual(schema.columns.map(item => item.name), ['id', 'label', 'payload']);
    const result = await service.readTable(ctx, { database: 'local:local.db', table: 'records', limit: 1 });
    assert.equal(result.nextOffset, 1);
    assert.equal(JSON.stringify(result).includes('never-return'), false);
    const second = await service.readTable(ctx, { database: 'local:local.db', table: 'records', offset: 1 });
    assert.equal(second.rows[0].label, '[REDACTED]');
    assert.equal(second.nextOffset, null);
    const keyValue = await service.readTable(ctx, { database: 'local:local.db', table: 'settings_values', columns: ['value'] });
    assert.equal(keyValue.rows[0].value, '[REDACTED]', 'omitting key_name from requested columns cannot bypass credential filtering');
    const empty = await service.readTable(ctx, { database: 'local:local.db', table: 'records', filter: { column: 'label', op: 'eq', value: "' OR 1=1 --" } });
    assert.deepEqual(empty.rows, []);
    for (const args of [{ table: 'disguised' }, { table: 'records; DROP TABLE records' }, { table: 'records', columns: ['api_token'] }, { table: 'records', columns: ['(SELECT password FROM auth_users)'] }]) {
        await assert.rejects(service.readTable(ctx, { database: 'local:local.db', ...args }), { code: 'AGENT_DATABASE_FORBIDDEN' });
    }
    assert.equal((await service.readTable(ctx, { database: 'local:local.db', table: 'records' })).rows.length, 2);
});

test('local paths cannot reach outside the workspace or access platform runtime databases', async () => {
    await assert.rejects(service.schema({ root: sandbox }, { database: 'local:runtime/tenants/other/tools.db' }), { code: 'AGENT_DATABASE_FORBIDDEN' });
    await assert.rejects(service.schema(ctx, { database: 'local:../runtime/tools.db' }), { code: 'AGENT_PATH_OUTSIDE' });
    const result = await tools.execute(ctx, 'read_database_table', { database: 'local:local.db', table: 'auth_users' });
    assert.equal(result.isError, true);
    assert.equal(result.content.includes('never-return'), false);
    assert.equal(tools.definitions({ readOnly: true }).some(tool => tool.name === 'read_database_table'), true);
});

test('database pagination stays below the generic tool cap and marks oversized cells', async () => {
    const fields = Array.from({ length: 16 }, (_, index) => `c${index} TEXT`).join(', ');
    const values = Array.from({ length: 16 }, () => `'${'x'.repeat(2000)}'`).join(', ');
    await create(path.join(root, 'wide.db'), `CREATE TABLE wide (${fields}); INSERT INTO wide VALUES (${values}); INSERT INTO wide VALUES (${values});`);
    const result = await tools.execute(ctx, 'read_database_table', { database: 'local:wide.db', table: 'wide' });
    assert.equal(result.isError, undefined);
    assert.equal(result.truncated, false);
    const data = JSON.parse(result.content);
    assert.equal(data.rows.length, 1);
    assert.equal(data.nextOffset, 1);
    assert.match(data.rows[0].c0, /cell truncated/);
});
