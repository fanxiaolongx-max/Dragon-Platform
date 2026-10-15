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
        assert.equal(listed.databases.some(item => item.id === 'platform:tools.db'), true); // 旧标识 platform:data/tools.db 仍可读取（见下）
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

test('web layout: report.db resolves to the report directory, stale shells and 0-byte files are hidden', async () => {
    const dataDir = tenant.getDataDir('default');
    const reportDir = tenant.getReportDataDir('default');
    // 数据目录里的旧 report.db 只有表结构；报表目录里的才是平台实际使用的
    await create(path.join(dataDir, 'report.db'), 'CREATE TABLE ReportMetricData (metric_label TEXT, raw_val TEXT);');
    await create(path.join(reportDir, 'report.db'), "CREATE TABLE ReportMetricData (metric_label TEXT, raw_val TEXT); INSERT INTO ReportMetricData VALUES ('整改完成率', '96%');");
    // 报表目录里的旧 requirements.db 不是平台读取的位置
    await create(path.join(reportDir, 'requirements.db'), "CREATE TABLE Requirements (title TEXT); INSERT INTO Requirements VALUES ('stale copy');");
    await create(path.join(dataDir, 'requirements.db'), "CREATE TABLE Requirements (title TEXT); INSERT INTO Requirements VALUES ('live');");
    fs.writeFileSync(path.join(dataDir, 'sla.db'), '');
    await tenant.runWithTenant('default', async () => {
        const listed = await service.listDatabases(ctx);
        const ids = listed.databases.filter(item => item.source === 'platform').map(item => item.id).sort();
        assert.deepEqual(ids, ['platform:report.db', 'platform:requirements.db', 'platform:tools.db']);
        for (const id of ['platform:report.db', 'platform:data/report.db', 'platform:report/report.db']) {
            const result = await service.readTable(ctx, { database: id, table: 'ReportMetricData' });
            assert.equal(result.rows[0].raw_val, '96%', `${id} reads the live report database`);
        }
        assert.equal((await service.readTable(ctx, { database: 'platform:requirements.db', table: 'Requirements' })).rows[0].title, 'live');
        await assert.rejects(service.schema(ctx, { database: 'platform:sla.db' }), { code: 'AGENT_DATABASE_FORBIDDEN' });
        // 误把平台标识当 path 传入：不报 ENOENT，照常列出
        assert.ok((await service.listDatabases(ctx, { path: 'platform:data' })).databases.some(item => item.id === 'platform:report.db'));
    });
});

test('empty results say why instead of looking like a permission problem', async () => {
    await create(path.join(root, 'empty.db'), "CREATE TABLE things (id INTEGER, label TEXT); CREATE TABLE some (id INTEGER, label TEXT); INSERT INTO some VALUES (1, 'a');");
    const empty = await service.readTable(ctx, { database: 'local:empty.db', table: 'things' });
    assert.deepEqual(empty.rows, []);
    assert.match(empty.empty, /0 行/);
    const filtered = await service.readTable(ctx, { database: 'local:empty.db', table: 'some', filter: { column: 'label', op: 'eq', value: 'zzz' } });
    assert.match(filtered.empty, /筛选/);
    assert.equal((await service.readTable(ctx, { database: 'local:empty.db', table: 'some' })).empty, undefined);
});
