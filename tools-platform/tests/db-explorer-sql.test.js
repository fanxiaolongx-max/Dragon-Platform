const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-explorer-test-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');

const pool = require('../backend/models/tenant-sqlite-pool');
const appDb = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});

test('db-explorer SQL query and execute endpoint supports arbitrary statements with admin auth', async t => {
    const express = require('express');
    const web = express();
    web.use(express.json());
    web.use((req, res, next) => {
        runWithTenant(req.headers['x-test-tenant'] || 'default', () => {
            req.user = { role: req.headers['x-test-role'] || 'admin' };
            next();
        });
    });
    web.use('/api/db-explorer', require('../backend/routes/db-explorer'));

    const server = await new Promise(r => { const s = web.listen(0, '127.0.0.1', () => r(s)); });
    t.after(() => new Promise(r => server.close(r)));
    const base = 'http://127.0.0.1:' + server.address().port;

    // Ensure sla_targets and sla_groups tables exist in the test db
    await require('../backend/models/sla-targets-repository').getTargets();
    await require('../backend/models/sla-groups-repository').listGroups();

    const postQuery = (body, headers = {}) => fetch(base + '/api/db-explorer/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });

    const postSql = (body, headers = {}) => fetch(base + '/api/db-explorer/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });

    // 1. Non-admin is forbidden
    const forbiddenRes = await postQuery({ sql: 'SELECT 1;' }, { 'x-test-role': 'member' });
    assert.equal(forbiddenRes.status, 403);

    // 2. Empty SQL is rejected with 400
    const emptyRes = await postQuery({ sql: '' });
    assert.equal(emptyRes.status, 400);
    const emptyJson = await emptyRes.json();
    assert.match(emptyJson.error, /不能为空/);

    // 3. SELECT * FROM sla_targets; works
    const targetsRes = await postQuery({ sql: 'SELECT * FROM sla_targets;' });
    assert.equal(targetsRes.status, 200);
    const targetsJson = await targetsRes.json();
    assert.equal(targetsJson.success, true);
    assert.equal(targetsJson.results.length, 1);
    assert.equal(targetsJson.results[0].type, 'query');
    assert.equal(targetsJson.results[0].verb, 'SELECT');
    assert.ok(Array.isArray(targetsJson.results[0].rows));

    // 4. SELECT * FROM sla_groups; works
    const groupsRes = await postQuery({ sql: 'SELECT * FROM sla_groups;' });
    assert.equal(groupsRes.status, 200);
    const groupsJson = await groupsRes.json();
    assert.equal(groupsJson.success, true);
    assert.equal(groupsJson.results[0].type, 'query');

    // 5. Multiple statements (DDL, DML, Query)
    const multiSql = `
        CREATE TEMPORARY TABLE test_custom_exec (id INT, val TEXT);
        INSERT INTO test_custom_exec VALUES (1, 'apple'), (2, 'banana');
        UPDATE test_custom_exec SET val = 'cherry' WHERE id = 1;
        SELECT * FROM test_custom_exec ORDER BY id ASC;
    `;
    const multiRes = await postQuery({ sql: multiSql });
    assert.equal(multiRes.status, 200);
    const multiJson = await multiRes.json();
    assert.equal(multiJson.success, true);
    assert.equal(multiJson.results.length, 4);

    // Statement 1: CREATE
    assert.equal(multiJson.results[0].type, 'execute');
    assert.equal(multiJson.results[0].verb, 'CREATE');

    // Statement 2: INSERT
    assert.equal(multiJson.results[1].type, 'execute');
    assert.equal(multiJson.results[1].verb, 'INSERT');
    assert.equal(multiJson.results[1].changes, 2);

    // Statement 3: UPDATE
    assert.equal(multiJson.results[2].type, 'execute');
    assert.equal(multiJson.results[2].verb, 'UPDATE');
    assert.equal(multiJson.results[2].changes, 1);

    // Statement 4: SELECT
    assert.equal(multiJson.results[3].type, 'query');
    assert.equal(multiJson.results[3].rowCount, 2);
    assert.deepEqual(multiJson.results[3].rows, [
        { id: 1, val: 'cherry' },
        { id: 2, val: 'banana' }
    ]);

    // 6. SQL syntax error returns 400 with details
    const errRes = await postQuery({ sql: 'SELECT * FROM non_existent_table_xyz;' });
    assert.equal(errRes.status, 400);
    const errJson = await errRes.json();
    assert.match(errJson.error, /no such table/i);
    assert.equal(errJson.statementIndex, 1);

    // 7. /api/db-explorer/sql alias works
    const aliasRes = await postSql({ sql: 'SELECT 42 as answer;' });
    assert.equal(aliasRes.status, 200);
    const aliasJson = await aliasRes.json();
    assert.equal(aliasJson.results[0].rows[0].answer, 42);

    // Execute the actual page examples against schemas initialized by repositories.
    // This catches stale table/column names without duplicating the schema in tests.
    await require('../backend/models/sla-prefs-repository').ensureReady();
    await require('../backend/models/sla-categories-repository').ensureReady();
    await require('../backend/models/sla-rule-templates-repository').getTemplate('test');
    await require('../backend/models/import-source-repository').ensureReady();
    await require('../backend/models/ai-report-repository').list();
    await require('../backend/models/monthly-snapshots-repository').ensureReady();
    await require('../backend/models/sla-snapshots-repository').replaceSnapshots([
        { id: 'z-old', timestamp: '2026-09-01T00:00:00Z' },
        { id: 'a-new', timestamp: '2026-10-01T00:00:00Z' }
    ]);
    const page = fs.readFileSync(path.join(__dirname, '../frontend/pages/db-explorer.html'), 'utf8');
    const examples = [...page.matchAll(/class="preset-pill"[^>]*data-sql="([^"]+)"/g)];
    assert.ok(examples.length >= 18, 'common table queries are present');
    for (const [, encoded] of examples) {
        const sql = encoded.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
        const response = await postQuery({ sql });
        const result = await response.json();
        assert.equal(response.status, 200, `${sql}: ${result.error || ''}`);
        assert.equal(result.results[0].type, 'query');
        if (/FROM sla_snapshots\b/.test(sql)) {
            assert.deepEqual(result.results[0].rows.map(row => row.id), ['a-new', 'z-old']);
        }
    }
});
