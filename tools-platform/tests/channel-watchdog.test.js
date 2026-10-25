const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'channel-watchdog-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const { runWithTenant, DEFAULT_TENANT_ID } = require('../backend/models/tenant-context');
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
