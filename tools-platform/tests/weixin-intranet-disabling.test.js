const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wx-intranet-test-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const welinkNetwork = require('../backend/models/channels/welink-network');
const configRepo = require('../backend/models/channels/weixin-config-repository');
const service = require('../backend/models/channels/weixin-bridge-service');
const watchdog = require('../backend/models/channels/channel-watchdog');

const inTenant = fn => runWithTenant('default', fn);

test.after(async () => {
    delete process.env.HUAWEI_INTRANET;
    delete process.env.DISABLE_WEIXIN;
    delete process.env.DISABLE_WEIXIN_ON_INTRANET;
    welinkNetwork.setOverridesForTest();
    await service.stopAll();
    await appDb.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('welinkNetwork: 华为内网环境与环境变量能精确判定并自动禁用微信', async () => {
    // 1. 模拟在内网环境下
    welinkNetwork.setOverridesForTest({
        lookup: async () => ({ address: '10.0.0.1' }),
        connect: async () => {}
    });
    delete process.env.HUAWEI_INTRANET;
    const netOn = await welinkNetwork.checkIntranet({ refresh: true });
    assert.equal(netOn.intranet, true);
    const wxOn = await welinkNetwork.isWeixinDisabled({ refresh: true });
    assert.equal(wxOn.disabled, true);
    assert.equal(wxOn.intranet, true);
    assert.equal(wxOn.reason, 'INTRANET_DISABLED');
    assert.match(wxOn.hint, /华为内网/);

    // 2. 模拟外网环境下
    welinkNetwork.setOverridesForTest({
        lookup: async () => { throw new Error('ENOTFOUND'); }
    });
    const netOff = await welinkNetwork.checkIntranet({ refresh: true });
    assert.equal(netOff.intranet, false);
    const wxOff = await welinkNetwork.isWeixinDisabled({ refresh: true });
    assert.equal(wxOff.disabled, false);

    // 3. 环境变量 HUAWEI_INTRANET=1 强制内网
    process.env.HUAWEI_INTRANET = '1';
    welinkNetwork.setOverridesForTest();
    const forcedNet = await welinkNetwork.checkIntranet({ refresh: true });
    assert.equal(forcedNet.intranet, true);
    assert.equal((await welinkNetwork.isWeixinDisabled({ refresh: true })).disabled, true);

    // 4. 环境变量 DISABLE_WEIXIN_ON_INTRANET=false 允许在外网覆盖
    process.env.DISABLE_WEIXIN_ON_INTRANET = 'false';
    assert.equal((await welinkNetwork.isWeixinDisabled({ refresh: true })).disabled, false);
    delete process.env.DISABLE_WEIXIN_ON_INTRANET;

    // 5. 环境变量 DISABLE_WEIXIN=1 强制禁用
    process.env.HUAWEI_INTRANET = '0';
    process.env.DISABLE_WEIXIN = '1';
    const forceDisabled = await welinkNetwork.isWeixinDisabled({ refresh: true });
    assert.equal(forceDisabled.disabled, true);
    assert.equal(forceDisabled.reason, 'ENV_DISABLED');

    delete process.env.DISABLE_WEIXIN;
    delete process.env.HUAWEI_INTRANET;
});

test('weixin-bridge-service: 华为内网下自动阻断长轮询、扫码、连接、推送与连通性测试', async () => {
    process.env.HUAWEI_INTRANET = '1';
    welinkNetwork.setOverridesForTest();

    await inTenant(async () => {
        await configRepo.saveConfig({ enabled: true, token: 'test-token', botId: 'bot-1' });

        // 状态读取：自动标记 disabledByIntranet 且 enabled 为 false
        const status = await service.getStatus('default');
        assert.equal(status.disabledByIntranet, true);
        assert.equal(status.enabled, false);
        assert.equal(status.configEnabled, true);
        assert.equal(status.connected, false);
        assert.equal(status.runtime.state, 'idle');
        assert.match(status.disabledHint, /华为内网/);

        // 手动连接：抛出 WEIXIN_DISABLED_ON_INTRANET 异常
        await assert.rejects(async () => {
            await service.connect('default');
        }, { code: 'WEIXIN_DISABLED_ON_INTRANET' });

        // 扫码登录：抛出 WEIXIN_DISABLED_ON_INTRANET 异常
        await assert.rejects(async () => {
            await service.runQrAuth('default');
        }, { code: 'WEIXIN_DISABLED_ON_INTRANET' });

        // 主动推送：抛出 WEIXIN_DISABLED_ON_INTRANET 异常
        await assert.rejects(async () => {
            await service.push('default', { text: '测试', targets: [{ kind: 'user', id: 'u1' }] });
        }, { code: 'WEIXIN_DISABLED_ON_INTRANET' });

        // 连通性测试：返回失败且包含内网原因
        const testRes = await service.testConnection('default');
        assert.equal(testRes.ok, false);
        assert.equal(testRes.steps[0].key, 'intranet');
        assert.match(testRes.steps[0].detail, /华为内网/);

        // 自动启动：跳过且不抛出未捕获错误
        await service.autoStartAll(async () => ['default']);
        const afterAuto = await service.getStatus('default');
        assert.equal(afterAuto.connected, false);
    });

    delete process.env.HUAWEI_INTRANET;
});

test('channel-watchdog: 华为内网下看门狗识别内网禁用，不触发自愈重连', async () => {
    process.env.HUAWEI_INTRANET = '1';
    welinkNetwork.setOverridesForTest();

    await inTenant(async () => {
        await configRepo.saveConfig({ enabled: true, token: 'test-token', botId: 'bot-1' });
        const summary = await watchdog.inspectTenantNow('default');
        const res = summary.channels.find(ch => ch.id === 'weixin');
        assert.ok(res);
        assert.equal(res.disabledByIntranet, true);
        assert.equal(res.enabled, false);
        assert.equal(res.state, 'disabled');
        assert.equal(res.stateLabel, '内网已禁用');
        assert.match(res.hint, /华为内网/);
    });

    delete process.env.HUAWEI_INTRANET;
});

test('channels 路由：内网环境下 /available 过滤微信，/qrcode-auth 拒绝，配置保存强制为禁用', async () => {
    process.env.HUAWEI_INTRANET = '1';
    welinkNetwork.setOverridesForTest();

    const express = require('express');
    const http = require('node:http');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { username: 'admin', role: 'admin', isSuper: true };
        runWithTenant('default', next);
    });
    app.use('/api/channels', require('../backend/routes/channels'));
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api/channels`;

    try {
        // 1. /api/channels/available 接口
        const availRes = await fetch(`${base}/available`);
        assert.equal(availRes.status, 200);
        const availData = await availRes.json();
        assert.equal(availData.network?.weixinDisabled, true);
        assert.equal(availData.summary?.weixin?.disabledByIntranet, true);
        assert.equal(availData.summary?.weixin?.enabled, false);
        assert.ok(!availData.items.some(item => item.id === 'weixin'), 'available 列表中不得包含已禁用的微信');

        // 2. /api/channels/weixin/qrcode-auth 扫码登录接口
        const qrRes = await fetch(`${base}/weixin/qrcode-auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        });
        const qrLines = (await qrRes.text()).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
        assert.equal(qrLines[0].type, 'error');
        assert.equal(qrLines[0].code, 'WEIXIN_DISABLED_ON_INTRANET');
        assert.match(qrLines[0].error, /华为内网/);

        // 3. PUT /api/channels/weixin/config 保存配置尝试开启 enabled
        const saveRes = await fetch(`${base}/weixin/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: true, botAgent: 'TestAgent' })
        });
        assert.equal(saveRes.status, 200);
        const savedData = await saveRes.json();
        assert.equal(savedData.config.enabled, false, '内网环境下保存配置强制 enabled: false');
        assert.equal(savedData.status.disabledByIntranet, true);
    } finally {
        server.close();
        delete process.env.HUAWEI_INTRANET;
    }
});
