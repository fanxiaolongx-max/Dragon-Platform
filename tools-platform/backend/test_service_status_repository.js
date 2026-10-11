const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-service-status-'));
process.env.TOOLS_DATA_DIR = tempDir;

const repo = require('./models/service-status-repository');
const runtimeConsole = require('./logger/daily-file-console');
const { closeDatabase } = require('./models/app-db');
const { runWithTenant } = require('./models/tenant-context');

async function main() {
    const dateAt = daysAgo => {
        const date = new Date();
        date.setUTCHours(10, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - daysAgo);
        return date;
    };
    const dayKey = daysAgo => dateAt(daysAgo).toISOString().slice(0, 10);
    assert.strictEqual(repo.resolveService('/api/health').id, 'core');
    assert.strictEqual(repo.resolveService('/api/uiv/scripts').id, 'automation');
    assert.strictEqual(repo.resolveService('/api/custom-tools').id, 'tools');
    assert.strictEqual(repo.resolveService('/api/ai/chat').id, 'ai');
    assert.strictEqual(repo.shouldTrackRequest('OPTIONS', '/api/health'), false);
    assert.strictEqual(repo.shouldTrackRequest('GET', '/api/platform-metrics/service-status?days=90'), false);
    assert.strictEqual(repo.shouldTrackRequest('GET', '/api/platform-metrics/service-status/failures'), false);
    assert.strictEqual(repo.shouldTrackRequest('GET', '/api/platform-metrics/service-status/logs'), false);
    assert.ok(runtimeConsole.captureSourceLocation().includes('backend/test_service_status_repository.js:'));
    assert.ok(runtimeConsole.formatConsoleDetail([{ password: 'plain-text', nested: { apiKey: 'abc' } }]).includes('[REDACTED]'));
    assert.ok(!runtimeConsole.formatConsoleDetail(['Authorization: Bearer abc.def']).includes('abc.def'));

    const now = Date.now();
    assert.strictEqual(repo.summarizeLicenseStatus({ enabled: false }, now).state, 'not-applicable');
    assert.strictEqual(repo.summarizeLicenseStatus({ enabled: true, valid: true, trustedNow: now, expiresAt: now + 8 * 86400000 }, now).state, 'operational');
    assert.strictEqual(repo.summarizeLicenseStatus({ enabled: true, valid: true, trustedNow: now, expiresAt: now + 6 * 86400000 }, now).state, 'degraded');
    assert.strictEqual(repo.summarizeLicenseStatus({ enabled: true, valid: true, trustedNow: now, expiresAt: now + 23 * 3600000 }, now).state, 'incident');
    assert.strictEqual(repo.summarizeLicenseStatus({ enabled: true, valid: false, reasonCode: 'REVOKED', trustedNow: now, expiresAt: now + 30 * 86400000 }, now).state, 'incident');

    await repo.trackRequest({ method: 'GET', pathname: '/api/health', statusCode: 200, durationMs: 12, timestamp: dateAt(2) });
    await repo.trackRequest({
        method: 'GET', pathname: '/api/health?probe=missing', statusCode: 404, durationMs: 18, timestamp: dateAt(1),
        requestId: 'req_client_error', requestBody: {}, responseBody: { error: 'not found' }
    });
    await repo.trackRequest({
        method: 'POST', pathname: '/api/ai/chat', statusCode: 503, durationMs: 140, timestamp: dateAt(0),
        requestId: 'req_server_error', requestBody: { prompt: 'hello' }, responseBody: { error: 'provider unavailable' }
    });
    await repo.trackRequest({ method: 'GET', pathname: '/api/custom-tools', statusCode: 200, durationMs: 22, timestamp: dateAt(0) });

    const history = await repo.getHistory(30);
    assert.strictEqual(history.days, 30);
    assert.strictEqual(history.services.length, repo.SERVICE_DEFINITIONS.length);
    const core = history.services.find(service => service.id === 'core');
    const ai = history.services.find(service => service.id === 'ai');
    const tools = history.services.find(service => service.id === 'tools');
    assert.strictEqual(core.history.find(day => day.date === dayKey(2)).state, 'operational');
    assert.strictEqual(core.history.find(day => day.date === dayKey(1)).state, 'degraded');
    assert.strictEqual(ai.history.find(day => day.date === dayKey(0)).state, 'incident');
    assert.strictEqual(tools.history.find(day => day.date === dayKey(0)).state, 'operational');
    assert.strictEqual(history.overall.requests, 4);
    assert.strictEqual(history.overall.successes, 2);
    assert.strictEqual(history.overall.clientErrors, 1);
    assert.strictEqual(history.overall.serverErrors, 1);
    assert.strictEqual(history.overall.availability, 75);
    assert.strictEqual(history.overall.currentState, 'operational');
    assert.strictEqual(history.overall.partialIssue, true);
    assert.deepStrictEqual(history.overall.incidentServices, ['ai']);

    const failures = await repo.getFailures({ limit: 10 });
    assert.strictEqual(failures.failures.length, 2);
    assert.strictEqual(failures.failures[0].requestId, 'req_server_error');
    assert.strictEqual(failures.failures[0].statusCode, 503);
    assert.strictEqual(JSON.parse(failures.failures[0].responseBody).error, 'provider unavailable');
    const clientFailures = await repo.getFailures({ serviceKey: 'core', date: dayKey(1), statusClass: '4xx' });
    assert.strictEqual(clientFailures.failures.length, 1);
    assert.strictEqual(clientFailures.failures[0].path, '/api/health?probe=missing');

    await repo.recordRuntimeLog({ timestamp: dateAt(0), level: 'INFO', source: 'backend/server.js:request-logger', detail: 'GET /api/health → HTTP 200 · 12ms', requestId: 'req_log_health', statusCode: 200, durationMs: 12 });
    await repo.recordRuntimeLog({ timestamp: dateAt(0), level: 'ERROR', source: 'backend/routes/ai.js:chat', detail: 'POST /api/ai/chat → HTTP 503 · 140ms', requestId: 'req_log_ai', statusCode: 503, durationMs: 140 });
    await repo.recordRuntimeLog({ timestamp: dateAt(0), level: 'DEBUG', source: 'backend/models/backup.js:42', detail: 'backup scan complete' });
    await repo.recordRuntimeLog({ timestamp: dateAt(0), level: 'WARN', source: 'backend/models/backup.js:51', detail: 'backup target unavailable' });
    const runtimeLogs = await repo.getRuntimeLogs({ q: 'ai/chat', level: 'ERROR', page: 1, pageSize: 10 });
    assert.strictEqual(runtimeLogs.total, 1);
    assert.strictEqual(runtimeLogs.logs[0].requestId, 'req_log_ai');
    assert.strictEqual(runtimeLogs.logs[0].source, 'backend/routes/ai.js:chat');
    const selectedLevels = await repo.getRuntimeLogs({ levels: 'DEBUG,WARN', page: 1, pageSize: 10 });
    assert.strictEqual(selectedLevels.total, 2);
    assert.deepStrictEqual(new Set(selectedLevels.logs.map(log => log.level)), new Set(['DEBUG', 'WARN']));
    assert.ok(selectedLevels.logs.every(log => log.statusCode === null && log.durationMs === null));
    await runWithTenant('tenant-log-isolation', async () => {
        await repo.recordRuntimeLog({ timestamp: dateAt(0), level: 'LOG', source: 'backend/tenant-task.js:9', detail: 'tenant-only-log' });
        const tenantLogs = await repo.getRuntimeLogs({ q: 'tenant-only-log' });
        assert.strictEqual(tenantLogs.total, 1);
    });
    const defaultTenantLogs = await repo.getRuntimeLogs({ q: 'tenant-only-log' });
    assert.strictEqual(defaultTenantLogs.total, 0);

    const fallback = await repo.getHistory(365);
    assert.strictEqual(fallback.days, 90);
    console.log('service status repository tests passed');
}

main()
    .then(closeDatabase)
    .then(() => fs.rmSync(tempDir, { recursive: true, force: true }))
    .catch(async error => {
        console.error(error);
        try { await closeDatabase(); } catch (_) {}
        fs.rmSync(tempDir, { recursive: true, force: true });
        process.exit(1);
    });
