const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-base-contract-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const tenant = require('../backend/models/tenant-context');
const runtime = require('../backend/models/hosted-apps/runtime');
const data = require('../backend/models/hosted-apps/data-api');
const deployment = require('../backend/models/hosted-apps/schema-deployment');
const appPackage = require('../backend/models/hosted-apps/package');
const JSZip = require('jszip');
const slug = 'base-fixture';
const apps = {};

test.after(async () => {
    for (const id of ['default', 'acme']) await data.closeAppDatabase(id, slug);
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('strict manifest persists, startup never creates tables, and deployment requires an explicit current hash', async () => {
    const zip = new JSZip();
    zip.file('requirements.txt', 'uvicorn'); zip.file('main.py', 'app = None');
    zip.file('platform-app.json', JSON.stringify({ name: 'Fixture', entry: 'main:app', databaseContract: 'digital-human' }));
    zip.file('db/init.sqlite.sql', 'CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, value TEXT);');
    zip.file('db/upgrade.sqlite.sql', 'CREATE TABLE IF NOT EXISTS cells(id INTEGER PRIMARY KEY);');
    const inspected = await appPackage.inspectArchive(await zip.generateAsync({ type: 'nodebuffer' }));
    assert.equal(inspected.config.databaseContract, 'digital-human');
    for (const id of ['default', 'acme']) await tenant.runWithTenant(id, async () => {
        const state = runtime.createApp(slug, inspected);
        apps[id] = { tenantId: id, slug, uuid: state.uuid };
        await runtime.applyStartupSql({ slug, tenantId: id }, state);
        assert.equal(fs.existsSync(runtime.paths(slug).db), false, 'startup must not provision the database');
        const info = deployment.inspect(slug, 'init');
        await assert.rejects(() => deployment.apply(slug, 'init', 'stale'), error => error.code === 'HOSTED_SCHEMA_CHANGED');
        assert.equal(fs.existsSync(runtime.paths(slug).db), false);
        await assert.rejects(() => data.execute(apps[id], { datasourceId: 'app', sql: 'CREATE TABLE bypass(id)' }), /部署脚本/);
        await deployment.apply(slug, 'init', info.hash);
        assert.equal((await deployment.apply(slug, 'init', info.hash)).skipped, true);
    });
    zip.file('platform-app.json', JSON.stringify({ entry: 'main:app', databaseContract: 'unknown' }));
    await assert.rejects(() => zip.generateAsync({ type: 'nodebuffer' }).then(appPackage.inspectArchive), /databaseContract/);
});

test('strict runtime allows only bounded DML, returns no generated id, and isolates app schemas and tenants', async () => {
    for (const id of ['default', 'acme']) {
        const app = apps[id], body = sql => ({ datasourceId: 'app', schema: app.uuid, sql });
        const result = await data.execute(app, body(`INSERT INTO reports(id,value) VALUES(1,'${id}')`));
        assert.equal(result.affectedRows, 1); assert.equal('lastInsertId' in result, false);
        for (const sql of ['DROP TABLE reports', 'REPLACE INTO reports VALUES(1,2)', 'WITH x AS(SELECT 1) DELETE FROM reports', 'DELETE FROM reports', "UPDATE reports SET value='WHERE'", 'UPDATE reports SET value=(SELECT 1 WHERE 1=1)']) {
            await assert.rejects(() => data.execute(app, body(sql)), /基座契约/);
        }
        await data.execute(app, body("UPDATE reports SET value=value WHERE id=1"));
        await assert.rejects(() => data.query(app, body('WITH x AS(SELECT 1) DELETE FROM reports WHERE id=1')), /只读/);
        await assert.rejects(() => data.execute(app, { datasourceName: 'netcare', sql: 'DELETE FROM reports WHERE id=1' }), /业务库只读/);
        await assert.rejects(() => data.execute(app, { ...body('DELETE FROM reports WHERE id=1'), schema: apps[id === 'default' ? 'acme' : 'default'].uuid }), /本应用/);
        assert.equal((await data.query(app, body('SELECT value FROM reports'))).rows[0].value, id);
        await assert.rejects(() => data.query(app, { datasourceName: 'platform:report.db', sql: 'SELECT 1' }), /真实基座数据源/);
        const env = tenant.runWithTenant(id, () => runtime.appEnv(slug, runtime.readState(slug), 5600, ''));
        assert.equal(env.BUSINESS_DATASOURCE_NAME, 'netcare');
        assert.equal(env.PLATFORM_APP_DATABASE_CONTRACT, 'digital-human');
    }
});

test('explicit upgrade retains rows, failures roll back, and deployment never crosses tenants', async () => {
    await tenant.runWithTenant('acme', async () => {
        const info = deployment.inspect(slug, 'upgrade');
        await deployment.apply(slug, 'upgrade', info.hash);
        const file = path.join(runtime.paths(slug).code, 'db/upgrade.sqlite.sql');
        fs.writeFileSync(file, 'CREATE TABLE rollback_fixture(id); INSERT INTO missing_table VALUES(1);');
        const changed = deployment.inspect(slug, 'upgrade');
        await assert.rejects(() => deployment.apply(slug, 'upgrade', changed.hash), /missing_table/);
        const rows = await data.query(apps.acme, { datasourceId: 'app', sql: "SELECT name FROM sqlite_master WHERE name='rollback_fixture'" });
        assert.deepEqual(rows.rows, []);
        assert.equal((await data.query(apps.acme, { datasourceId: 'app', sql: 'SELECT value FROM reports' })).rows[0].value, 'acme');
    });
    await assert.rejects(() => data.query(apps.default, { datasourceId: 'app', sql: 'SELECT * FROM cells' }), /no such table/);
    await tenant.runWithTenant('default', async () => {
        const file = path.join(runtime.paths(slug).code, 'db/upgrade.sqlite.sql');
        fs.unlinkSync(file); fs.symlinkSync(path.join(sandbox, 'outside.sql'), file);
        fs.writeFileSync(path.join(sandbox, 'outside.sql'), 'CREATE TABLE outside(id);');
        assert.throws(() => deployment.inspect(slug, 'upgrade'), /普通文件/);
    });
});

test('strict REST replies carry business errors in code and never expose generated ids', async () => {
    const express = require('express'), web = express(); web.use(express.json());
    web.use('/hosted-api', data.createRouter());
    const server = await new Promise(resolve => { const server = web.listen(0, '127.0.0.1', () => resolve(server)); });
    try {
        const state=runtime.readState(slug);
        const url=`http://127.0.0.1:${server.address().port}/hosted-api/${state.dataToken}/dh`;
        const post=(route,sql)=>fetch(url+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({datasourceId:'app',schema:state.uuid,sql})});
        const failure=await post('/execute','CREATE TABLE forbidden(id)');
        assert.equal(failure.status,200); assert.equal((await failure.json()).code,400);
        const missing=await post('/query','SELECT * FROM not_deployed');
        assert.equal(missing.status,200); assert.equal((await missing.json()).code,500);
        const inserted=await post('/execute',"INSERT INTO reports(id,value) VALUES(2,'REST')");
        const result=await inserted.json(); assert.equal(result.code,0); assert.equal('lastInsertId' in result.data,false);
    } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('schema deployment routes require administrator access for both preview and execution', async () => {
    const express = require('express'), web = express(); web.use(express.json());
    web.use((req, _res, next) => { req.user = { role: req.headers['x-fixture-role'] || 'user' }; tenant.runWithTenant('default', next); });
    web.use('/api/hosted-apps', require('../backend/routes/hosted-apps'));
    const server = await new Promise(resolve => { const server = web.listen(0, '127.0.0.1', () => resolve(server)); });
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/hosted-apps/${slug}/database-script`;
        assert.equal((await fetch(url + '?kind=init')).status, 403);
        assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
        const response = await fetch(url + '?kind=init', { headers: { 'x-fixture-role': 'admin' } });
        assert.equal(response.status, 200); const body = await response.json();
        assert.equal(body.script.applied, true); assert.equal(body.script.file, 'db/init.sqlite.sql');
        assert.equal('secret' in body, false);
        const config = await fetch(url.replace('/database-script', '/config'), { headers: { 'x-fixture-role': 'admin' } }).then(res => res.json());
        assert.equal(config.businessDatasource, 'netcare');
        assert(config.availableDatasources.every(name => !name.startsWith('platform:')));
    } finally { await new Promise(resolve => server.close(resolve)); }
});
