const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'channel-watchdog-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const { runWithTenant, getTenantId, tenantMiddleware, DEFAULT_TENANT_ID } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const welinkConfigRepo = require('../backend/models/channels/welink-config-repository');
const weixinConfigRepo = require('../backend/models/channels/weixin-config-repository');
const welink = require('../backend/models/channels/welink-bridge-service');
const weixin = require('../backend/models/channels/weixin-bridge-service');
const channelWatchdog = require('../backend/models/channels/channel-watchdog');
const serviceStatusRepo = require('../backend/models/service-status-repository');

test('channel watchdog: inspects disabled and unconfigured channels cleanly', async () => {
    channelWatchdog.resetForTests();
    const summary = await channelWatchdog.inspectNow();
    assert.equal(summary.enabled, true);
    assert.ok(summary.checkCount >= 1);
    assert.ok(Array.isArray(summary.channels));

    const welinkItem = summary.channels.find(c => c.id === 'welink');
    assert.ok(welinkItem);
    assert.equal(welinkItem.name, 'WeLink');
    assert.equal(welinkItem.enabled, false);
    assert.equal(welinkItem.status, 'disabled');

    const weixinItem = summary.channels.find(c => c.id === 'weixin');
    assert.ok(weixinItem);
    assert.equal(weixinItem.name, '微信');
    assert.equal(weixinItem.enabled, false);
});

test('channel watchdog: tracks operational WeLink channel and WebSocket heartbeat', async () => {
    channelWatchdog.resetForTests();
    await runWithTenant(DEFAULT_TENANT_ID, async () => {
        await welinkConfigRepo.saveConfig({
            enabled: true,
            channel: 'GDEclaw',
            environment: 'prod',
            ak: 'test-ak',
            sk: 'test-sk'
        });
    });

    const summary = await channelWatchdog.inspectNow();
    const welinkItem = summary.channels.find(c => c.id === 'welink');
    assert.ok(welinkItem);
    assert.equal(welinkItem.enabled, true);
    assert.equal(welinkItem.configured, true);
    assert.equal(welinkItem.channel, 'GDEclaw');
    assert.equal(welinkItem.heartbeat.type, 'WebSocket Keepalive');
});

test('service-status repository includes channels service definition', async () => {
    const channelService = serviceStatusRepo.SERVICE_DEFINITIONS.find(s => s.id === 'channels');
    assert.ok(channelService);
    assert.equal(channelService.name, '频道对接服务');
    assert.ok(channelService.prefixes.includes('/api/channels'));

    const resolved = serviceStatusRepo.resolveService('/api/channels/welink/status');
    assert.equal(resolved.id, 'channels');
});

test('channel watchdog: tenant caches, recovery metadata and API responses stay isolated', async t => {
    channelWatchdog.resetForTests();
    t.after(() => channelWatchdog.resetForTests());
    const inspected = [];
    let recovered = false;
    const heartbeat = '2026-10-25T10:00:00.000Z';
    t.mock.method(welinkConfigRepo, 'getConfig', async () => {
        inspected.push(getTenantId());
        return getTenantId() === 'alpha'
            ? { enabled: true, channel: 'alpha-channel', ak: 'test', sk: 'test' }
            : { enabled: false };
    });
    t.mock.method(weixinConfigRepo, 'getConfig', async () => ({ enabled: false }));
    t.mock.method(welink, 'getStatus', async () => ({ connected: recovered, runtime: { state: recovered ? 'ready' : 'failed' } }));
    t.mock.method(welink, 'getDiagnostics', async () => ({ runtime: { lastHeartbeatAt: heartbeat } }));
    t.mock.method(welink, 'restart', async () => { recovered = true; });
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);

    await runWithTenant('alpha', () => channelWatchdog.inspectTenantNow());
    now += 30000;
    const alpha = await runWithTenant('alpha', () => channelWatchdog.inspectTenantNow());
    assert.equal(alpha.autoRecoveryCount, 1);
    assert.ok(alpha.lastRecoveryAt);
    assert.equal(alpha.overallHealth, 'operational');
    const beta = await runWithTenant('beta', () => channelWatchdog.getWatchdogSummary());
    assert.equal(beta.channels.length, 2);
    assert.ok(beta.channels.every(item => item.tenantId === 'beta'));
    assert.equal(beta.checkCount, 1);
    assert.equal(beta.autoRecoveryCount, 0);
    assert.equal(beta.lastRecoveryAt, null);
    assert.equal(beta.overallHealth, 'no-channels');
    assert.strictEqual(await runWithTenant('alpha', () => channelWatchdog.getWatchdogSummary()), alpha);

    const express = require('express');
    const request = require('supertest');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { role: 'admin', tenantId: 'beta' }; next(); });
    app.use(tenantMiddleware);
    app.use('/metrics', require('../backend/routes/platform-metrics'));
    t.mock.method(serviceStatusRepo, 'getHistory', async () => ({}));
    const license = require('../backend/routes/desktop-license-local');
    t.mock.method(license, 'getStatus', () => ({}));
    inspected.length = 0;
    for (const response of [
        await request(app).get('/metrics/service-status?tenantId=alpha').expect(200),
        await request(app).post('/metrics/service-status/channels/inspect').send({ tenantId: 'alpha' }).expect(200)
    ]) {
        const summary = response.body.channels?.channels ? response.body.channels : response.body;
        assert.equal(summary.channels.length, 2);
        assert.ok(summary.channels.every(item => item.tenantId === 'beta'));
        assert.equal(summary.autoRecoveryCount, 0);
        assert.equal(summary.lastRecoveryAt, null);
        assert.equal(summary.overallHealth, 'no-channels');
    }
    assert.deepEqual(inspected, ['beta'], 'manual inspection touches only the session tenant');
    assert.strictEqual(await channelWatchdog.getWatchdogSummary('alpha'), alpha);
});

test('channel watchdog: background inspections cover all tenants while summaries remain scoped', async t => {
    channelWatchdog.resetForTests();
    t.after(() => channelWatchdog.resetForTests());
    t.mock.method(global, 'setTimeout', () => null);
    t.mock.method(global, 'setInterval', () => null);
    t.mock.method(welinkConfigRepo, 'getConfig', async () => ({ enabled: false }));
    t.mock.method(weixinConfigRepo, 'getConfig', async () => ({ enabled: true, token: 'test' }));
    t.mock.method(weixin, 'getStatus', async tenantId => ({
        connected: tenantId === 'alpha',
        runtime: { state: tenantId === 'alpha' ? 'ready' : 'failed', failureReason: 'test disconnect' },
        lastPollAt: '2026-10-25T10:00:00.000Z'
    }));
    t.mock.method(weixin, 'getDiagnostics', async () => ({ runtime: {} }));
    channelWatchdog.start(async () => ['alpha', 'beta']);
    const all = await channelWatchdog.inspectNow();
    assert.equal(all.channels.length, 6);
    for (const tenantId of ['default', 'alpha', 'beta']) {
        const summary = await runWithTenant(tenantId, () => channelWatchdog.getWatchdogSummary());
        assert.equal(summary.channels.length, 2);
        assert.ok(summary.channels.every(item => item.tenantId === tenantId));
        const weixinItem = summary.channels.find(item => item.id === 'weixin');
        assert.equal(weixinItem.heartbeat.healthy, tenantId === 'alpha');
        assert.equal(summary.overallHealth, tenantId === 'alpha' ? 'operational' : 'incident');
    }
});

test('channel watchdog: concurrent requests share only their own tenant inspection', async t => {
    channelWatchdog.resetForTests();
    t.after(() => channelWatchdog.resetForTests());
    let releaseAlpha;
    const gate = new Promise(resolve => { releaseAlpha = resolve; });
    const calls = [];
    t.mock.method(welinkConfigRepo, 'getConfig', async () => {
        const tenantId = getTenantId();
        calls.push(tenantId);
        if (tenantId === 'alpha') await gate;
        return { enabled: false };
    });
    t.mock.method(weixinConfigRepo, 'getConfig', async () => ({ enabled: false }));
    const first = runWithTenant('alpha', () => channelWatchdog.inspectTenantNow());
    const second = runWithTenant('alpha', () => channelWatchdog.inspectTenantNow());
    const beta = await runWithTenant('beta', () => channelWatchdog.getWatchdogSummary());
    assert.ok(beta.channels.every(item => item.tenantId === 'beta'));
    releaseAlpha();
    const [a, b] = await Promise.all([first, second]);
    assert.strictEqual(a, b);
    assert.ok(a.channels.every(item => item.tenantId === 'alpha'));
    assert.deepEqual(calls, ['alpha', 'beta']);
});
