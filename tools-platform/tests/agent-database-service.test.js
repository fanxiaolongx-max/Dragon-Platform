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

const adminCtx = { ...ctx, readOnly: false };
const eq = (column, value) => ({ column, op: 'eq', value });

test('admin tools perform real insert, update, delete and read back the committed rows', async () => {
    await create(path.join(root, 'edits.db'), 'CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT UNIQUE, amount REAL);');
    const target = { database: 'local:edits.db', table: 'items' };
    const inserted = await tools.execute(adminCtx, 'insert_database_row', { ...target, values: JSON.stringify({ label: "O'Reilly; DROP TABLE items; --", amount: 4.5 }) });
    assert.equal(inserted.isError, undefined);
    const id = JSON.parse(inserted.content).lastID;
    assert.equal(JSON.parse(inserted.content).changes, 1);
    const preview = await tools.preview(adminCtx, 'update_database_rows', { ...target, values: '{"amount":7}', filters: [eq('id', id)] });
    assert.equal(JSON.parse(preview.diff).matchedRows, 1);
    assert.equal((await service.readTable(ctx, target)).rows[0].amount, 4.5, 'preview does not write');
    const updated = await tools.execute(adminCtx, 'update_database_rows', { ...target, values: '{"amount":7}', filters: [eq('id', id)] });
    assert.equal(JSON.parse(updated.content).changes, 1);
    assert.equal((await service.readTable(ctx, target)).rows[0].amount, 7);
    await service.writeTable(adminCtx, { ...target, operation: 'update', values: { amount: null }, filters: [eq('id', id)] });
    assert.equal((await service.writeTable(adminCtx, { ...target, operation: 'update', values: { amount: 9 }, filters: [{ column: 'amount', op: 'is_null' }] })).changes, 1);
    const deleted = await tools.execute(adminCtx, 'delete_database_rows', { ...target, filters: [eq('id', id)] });
    assert.equal(JSON.parse(deleted.content).changes, 1);
    assert.deepEqual((await service.readTable(ctx, target)).rows, []);
});

test('writes fail closed for non-admin contexts, sensitive data, malformed input and unbounded edits', async () => {
    await create(path.join(root, 'guarded.db'), `CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT, api_token TEXT);
        INSERT INTO items VALUES (1, 'one', 'hidden'); INSERT INTO items VALUES (2, 'two', 'hidden');
        CREATE TABLE config (key_name TEXT, value TEXT); INSERT INTO config VALUES ('api_key', 'hidden');
        CREATE TABLE auth_users (id INTEGER PRIMARY KEY, password TEXT);`);
    const target = { database: 'local:guarded.db', table: 'items', operation: 'update', values: { label: 'changed' }, filters: [eq('id', 1)] };
    for (const context of [ctx, { ...ctx, readOnly: true }]) {
        await assert.rejects(service.writeTable(context, target), { code: 'AGENT_DATABASE_FORBIDDEN' });
    }
    for (const args of [
        { filters: [] }, { filters: null }, { filters: [eq('id; DROP TABLE items', 1)] },
        { values: { api_token: 'replace' } }, { values: { label: 'unlabelled-runtime-key-value' } },
        { values: { label: '{"password":"hidden"}' } }, { values: { label: { nested: true } } },
        { values: '{broken' }, { values: 'null' }, { table: 'auth_users' },
        { table: 'items; DROP TABLE items' }, { operation: 'arbitrary' },
        { allowAllRows: true, filters: [], maxAffectedRows: 1 },
        { table: 'config', values: { value: 'changed' }, filters: [eq('key_name', 'api_key')] },
        { operation: 'insert', filters: [], table: 'config', values: { key_name: 'access_token', value: 'changed' } }
    ]) await assert.rejects(service.writeTable(adminCtx, { ...target, ...args }), { code: 'AGENT_DATABASE_FORBIDDEN' });
    assert.deepEqual((await service.readTable(ctx, target)).rows.map(row => row.label), ['one', 'two']);
    const changed = await service.writeTable(adminCtx, { ...target, filters: [], allowAllRows: true, maxAffectedRows: 2 });
    assert.equal(changed.changes, 2);
    assert.equal((await service.writeTable(adminCtx, { ...target, values: { label: 'missing' }, filters: [eq('id', 99)] })).changes, 0);
    for (const name of ['insert_database_row', 'update_database_rows', 'delete_database_rows']) {
        assert.equal(tools.definitions({ readOnly: true }).some(tool => tool.name === name), false);
        assert.equal((await tools.execute({ ...ctx, readOnly: true }, name, target)).isError, true);
    }
});

test('writes use live tenant database paths and never alter another tenant or stale report shells', async () => {
    for (const id of ['default', 'other']) {
        await create(path.join(tenant.getDataDir(id), 'write-test.db'), `CREATE TABLE records (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO records VALUES (1, '${id}');`);
    }
    for (const id of ['other', 'default', 'other']) await tenant.runWithTenant(id, async () => {
        await service.writeTable(adminCtx, { database: 'platform:write-test.db', table: 'records', operation: 'update', values: { label: `${id}-edited` }, filters: [eq('id', 1)] });
        assert.equal((await service.readTable(adminCtx, { database: 'platform:write-test.db', table: 'records' })).rows[0].label, `${id}-edited`);
    });
    await tenant.runWithTenant('default', async () => {
        assert.equal((await service.readTable(adminCtx, { database: 'platform:write-test.db', table: 'records' })).rows[0].label, 'default-edited');
        const result = await service.writeTable(adminCtx, { database: 'platform:report.db', table: 'ReportMetricData', operation: 'update', values: { raw_val: '97%' }, filters: [eq('metric_label', '整改完成率')] });
        assert.equal(result.changes, 1, 'uses configured report directory rather than stale data/report.db');
        assert.equal((await service.readTable(ctx, { database: 'platform:report.db', table: 'ReportMetricData' })).rows[0].raw_val, '97%');
    });
    await assert.rejects(service.writeTable({ ...adminCtx, root: sandbox }, { database: 'local:runtime/tenants/other/write-test.db', table: 'records', operation: 'delete', allowAllRows: true }), { code: 'AGENT_DATABASE_FORBIDDEN' });
});

test('AI business tables and admin chat-history databases are available without exposing credentials', async () => {
    await create(path.join(tenant.getDataDir('default'), 'ai-business.db'), `CREATE TABLE ai_report_documents (id INTEGER PRIMARY KEY, title TEXT);
        CREATE TABLE ai_knowledge_documents (id INTEGER PRIMARY KEY, title TEXT); CREATE TABLE ai_chat_sessions (id TEXT);`);
    await create(path.join(tenant.getDataDir('default'), 'chat-history.db'), 'CREATE TABLE chat_messages (id INTEGER PRIMARY KEY, body TEXT);');
    await tenant.runWithTenant('default', async () => {
        const schema = await service.schema(adminCtx, { database: 'platform:ai-business.db' });
        assert.deepEqual(schema.tables, ['ai_knowledge_documents', 'ai_report_documents']);
        for (const table of schema.tables) assert.equal((await service.writeTable(adminCtx, { database: 'platform:ai-business.db', table, operation: 'insert', values: { title: 'business' } })).changes, 1);
        assert.equal((await service.listDatabases(adminCtx)).databases.some(row => row.id === 'platform:chat-history.db' && row.writable), true);
        assert.equal((await service.listDatabases(ctx)).databases.some(row => row.id === 'platform:chat-history.db'), false);
        await assert.rejects(service.readTable(ctx, { database: 'platform:chat-history.db', table: 'chat_messages' }), { code: 'AGENT_DATABASE_FORBIDDEN' });
        assert.equal((await service.writeTable(adminCtx, { database: 'platform:chat-history.db', table: 'chat_messages', operation: 'insert', values: { body: 'hello' } })).changes, 1);
    });
});

test('constraints roll back failed changes and protected trigger/cascade side effects are refused', async () => {
    await create(path.join(root, 'constraints.db'), `CREATE TABLE parent (id INTEGER PRIMARY KEY);
        INSERT INTO parent VALUES (1); INSERT INTO parent VALUES (2);
        CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id)); INSERT INTO child VALUES (1, 1);
        CREATE TABLE guarded (id INTEGER PRIMARY KEY); INSERT INTO guarded VALUES (1);
        CREATE TABLE auth_users (id INTEGER PRIMARY KEY, password TEXT);
        CREATE TRIGGER unsafe AFTER DELETE ON guarded BEGIN INSERT INTO auth_users VALUES (1, 'hidden'); END;
        CREATE TABLE cascade_root (id INTEGER PRIMARY KEY); INSERT INTO cascade_root VALUES (1);
        CREATE TABLE bridge (id INTEGER PRIMARY KEY REFERENCES cascade_root(id) ON DELETE CASCADE); INSERT INTO bridge VALUES (1);
        CREATE TABLE auth_children (id INTEGER PRIMARY KEY REFERENCES bridge(id) ON DELETE CASCADE); INSERT INTO auth_children VALUES (1);
        CREATE TABLE nullable_root (id INTEGER PRIMARY KEY); INSERT INTO nullable_root VALUES (1);
        CREATE TABLE nullable_bridge (id INTEGER PRIMARY KEY, ref INTEGER UNIQUE REFERENCES nullable_root(id) ON DELETE SET NULL); INSERT INTO nullable_bridge VALUES (1, 1);
        CREATE TABLE auth_nullable (id INTEGER PRIMARY KEY, ref INTEGER REFERENCES nullable_bridge(ref) ON UPDATE CASCADE); INSERT INTO auth_nullable VALUES (1, 1);`);
    const target = { database: 'local:constraints.db', table: 'parent', operation: 'delete', allowAllRows: true };
    await assert.rejects(service.writeTable(adminCtx, target), /FOREIGN KEY/);
    assert.equal((await service.readTable(ctx, target)).rows.length, 2, 'entire failed delete is rolled back');
    for (const table of ['guarded', 'cascade_root', 'nullable_root']) {
        await assert.rejects(service.writeTable(adminCtx, { ...target, table }), { code: 'AGENT_DATABASE_FORBIDDEN' });
        assert.equal((await service.readTable(ctx, { ...target, table })).rows.length, 1);
    }
    assert.equal((await service.writeTable(adminCtx, { ...target, table: 'parent', operation: 'insert', values: { id: 3 } })).changes, 1, 'unrelated triggers do not block business writes');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.writeTable({ ...adminCtx, signal: controller.signal }, target), { name: 'AbortError' });
});
