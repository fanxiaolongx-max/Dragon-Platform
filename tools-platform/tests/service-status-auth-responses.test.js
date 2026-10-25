const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'service-status-auth-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const appDb = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');
const repo = require('../backend/models/service-status-repository');
const timestamp = new Date();
const date = timestamp.toISOString().slice(0, 10);

function track(statusCode, responseBody, pathname = '/api/version') {
    return repo.trackRequest({ method: 'GET', pathname, statusCode, responseBody, durationMs: 5, timestamp });
}

test.after(async () => {
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('expected login responses are counted separately without degrading service health', async () => {
    await runWithTenant('auth-only', async () => {
        await track(401, { error: '请先登录', code: 'AUTH_REQUIRED' });
        await track(401, JSON.stringify({ error: '登录已过期，请重新登录', code: 'AUTH_EXPIRED' }));
        const history = await repo.getHistory(30);
        const core = history.services.find(service => service.id === 'core');
        assert.equal(core.currentState, 'operational');
        assert.equal(core.history.at(-1).clientErrors, 0);
        assert.equal(core.history.at(-1).expectedAuthResponses, 2);
        assert.equal(history.overall.requests, 2);
        assert.equal(history.overall.successes, 0, 'auth challenges are not reported as successful business requests');
        assert.equal(history.overall.clientErrors, 0);
        assert.equal(history.overall.expectedAuthResponses, 2);
        assert.equal(history.overall.availability, 100);
        assert.deepEqual(history.overall.degradedServices, []);
        const details = await repo.getFailures({ date });
        assert.deepEqual(details.failures, []);
        assert.equal(details.excludedAuthResponses, 2);
        const records = await appDb.all('SELECT status_code, expected_auth, response_body FROM service_status_failures');
        assert.equal(records.length, 2, 'original redacted diagnostics are retained');
        assert.ok(records.every(row => row.status_code === 401 && row.expected_auth === 1));
    });
});

test('ordinary 401, invalid bodies, business 4xx and 5xx remain failures', async () => {
    await runWithTenant('real-errors', async () => {
        await track(200, {});
        await track(401, { code: 'AUTH_REQUIRED' });
        await track(401, { code: 'AUTH_EXPIRED' });
        for (const [status, body] of [
            [400, { code: 'AUTH_REQUIRED' }],
            [403, { code: 'AUTH_REQUIRED' }],
            [404, {}],
            [401, { code: 'UPSTREAM_AUTH_FAILED' }],
            [401, 'invalid JSON'],
            [401, null],
            [500, { code: 'AUTH_REQUIRED' }]
        ]) await track(status, body);
        const history = await repo.getHistory(30);
        assert.equal(history.overall.requests, 10);
        assert.equal(history.overall.successes, 1);
        assert.equal(history.overall.clientErrors, 6);
        assert.equal(history.overall.serverErrors, 1);
        assert.equal(history.overall.expectedAuthResponses, 2);
        assert.equal(history.services.find(service => service.id === 'core').currentState, 'incident');
        const all = await repo.getFailures({ date, limit: 100 });
        assert.equal(all.failures.length, 7);
        assert.equal(all.excludedAuthResponses, 2);
        const client = await repo.getFailures({ date, serviceKey: 'core', statusClass: '4xx', limit: 100 });
        assert.equal(client.failures.length, 6);
        assert.equal(client.excludedAuthResponses, 2);
        const server = await repo.getFailures({ date, statusClass: '5xx' });
        assert.equal(server.failures.length, 1);
        assert.equal(server.excludedAuthResponses, 0);
        assert.equal((await repo.getFailures({ date, limit: 1 })).failures.length, 1);
    });
});

test('new auth totals remain excluded after detailed records are pruned', async () => {
    await runWithTenant('pruned-details', async () => {
        await track(401, { code: 'AUTH_REQUIRED' });
        await track(401, { code: 'AUTH_EXPIRED' });
        await appDb.run('DELETE FROM service_status_failures');
        const history = await repo.getHistory(30);
        assert.equal(history.overall.clientErrors, 0);
        assert.equal(history.overall.expectedAuthResponses, 2);
        assert.equal(history.services.find(service => service.id === 'core').currentState, 'operational');
    });
});

test('old schemas migrate idempotently and retained historic auth details are excluded without rewriting rows', async () => {
    await runWithTenant('legacy', async () => {
        await appDb.run(`CREATE TABLE service_status_daily (
            service_key TEXT NOT NULL, status_date TEXT NOT NULL,
            request_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
            client_error_count INTEGER NOT NULL DEFAULT 0, server_error_count INTEGER NOT NULL DEFAULT 0,
            total_duration_ms INTEGER NOT NULL DEFAULT 0, max_duration_ms INTEGER NOT NULL DEFAULT 0,
            last_status_code INTEGER, last_request_at TEXT NOT NULL,
            PRIMARY KEY (service_key, status_date)
        )`);
        await appDb.run(`CREATE TABLE service_status_failures (
            id INTEGER PRIMARY KEY AUTOINCREMENT, service_key TEXT NOT NULL, request_at TEXT NOT NULL,
            request_id TEXT, method TEXT NOT NULL, request_path TEXT NOT NULL,
            status_code INTEGER NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0,
            request_body TEXT, response_body TEXT
        )`);
        for (const [serviceKey, count, successes] of [['core', 1, 0], ['data', 4, 1]]) {
            await appDb.run(`INSERT INTO service_status_daily
                (service_key, status_date, request_count, success_count, client_error_count, last_request_at)
                VALUES (?, ?, ?, ?, ?, ?)`, [serviceKey, date, count, successes, count - successes, timestamp.toISOString()]);
        }
        for (const [serviceKey, status, body] of [
            ['core', 401, { code: 'AUTH_REQUIRED' }],
            ['data', 401, { code: 'AUTH_EXPIRED' }],
            ['data', 401, { code: 'UPSTREAM_AUTH_FAILED' }],
            ['data', 400, { error: 'bad input' }]
        ]) await appDb.run(`INSERT INTO service_status_failures
            (service_key, request_at, method, request_path, status_code, response_body)
            VALUES (?, ?, 'GET', '/api/legacy', ?, ?)`, [serviceKey, timestamp.toISOString(), status, JSON.stringify(body)]);

        const history = await repo.getHistory(30);
        assert.equal(history.overall.clientErrors, 2);
        assert.equal(history.overall.expectedAuthResponses, 2);
        assert.equal(history.services.find(service => service.id === 'core').currentState, 'operational');
        assert.equal(history.services.find(service => service.id === 'data').currentState, 'degraded');
        assert.equal((await repo.getFailures({ serviceKey: 'core' })).failures.length, 0);
        assert.equal((await appDb.get("SELECT client_error_count FROM service_status_daily WHERE service_key = 'core'")).client_error_count, 1);
        assert.equal((await appDb.get('SELECT COUNT(*) AS count FROM service_status_failures')).count, 4);

        await track(401, { code: 'AUTH_EXPIRED' }, '/api/db/query');
        const mixed = await repo.getHistory(30);
        assert.equal(mixed.overall.clientErrors, 2, 'new and legacy auth counters are not subtracted twice');
        assert.equal(mixed.overall.expectedAuthResponses, 3);
        assert.equal((await repo.getFailures({ serviceKey: 'data' })).excludedAuthResponses, 2);

        delete require.cache[require.resolve('../backend/models/service-status-repository')];
        const restarted = require('../backend/models/service-status-repository');
        await restarted.ensureReady();
        await restarted.ensureReady();
        assert.equal((await restarted.getHistory(30)).overall.clientErrors, 2);
    });
});

test('auth exclusions and failure lists are isolated by the current tenant', async () => {
    await runWithTenant('tenant-a', async () => {
        await track(401, { code: 'AUTH_REQUIRED' });
        await track(401, { code: 'AUTH_EXPIRED' });
    });
    await runWithTenant('tenant-b', async () => {
        await track(404, { error: 'missing' });
        const history = await repo.getHistory(30);
        assert.equal(history.overall.requests, 1);
        assert.equal(history.overall.clientErrors, 1);
        assert.equal(history.overall.expectedAuthResponses, 0);
        const failures = await repo.getFailures({ date });
        assert.equal(failures.failures.length, 1);
        assert.equal(failures.excludedAuthResponses, 0);
    });
    await runWithTenant('tenant-a', async () => {
        const history = await repo.getHistory(30);
        assert.equal(history.overall.clientErrors, 0);
        assert.equal(history.overall.expectedAuthResponses, 2);
        assert.equal((await repo.getFailures()).failures.length, 0);
    });
});
