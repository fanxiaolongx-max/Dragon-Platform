const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-log-test-'));
process.env.TOOLS_DATA_DIR = path.join(tempDir, 'data');

const auditRepo = require('../backend/models/platform-audit-repository');
const controlDb = require('../backend/models/control-db');

test('clientIp extracts real IP from proxy headers in priority order', () => {
    // 1. Cloudflare header
    assert.equal(
        auditRepo.clientIp({ headers: { 'cf-connecting-ip': '203.0.113.195', 'x-forwarded-for': '127.0.0.1' }, socket: { remoteAddress: '::1' } }),
        '203.0.113.195'
    );

    // 2. X-Forwarded-For (multi-hop)
    assert.equal(
        auditRepo.clientIp({ headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.1' }, socket: { remoteAddress: '::1' } }),
        '198.51.100.42'
    );

    // 3. X-Real-IP
    assert.equal(
        auditRepo.clientIp({ headers: { 'x-real-ip': '198.51.100.99' }, socket: { remoteAddress: '::1' } }),
        '198.51.100.99'
    );

    // 4. IPv6-mapped IPv4 stripped
    assert.equal(
        auditRepo.clientIp({ ip: '::ffff:192.168.1.100', socket: { remoteAddress: '::1' } }),
        '192.168.1.100'
    );

    // 5. Direct socket remoteAddress fallback
    assert.equal(
        auditRepo.clientIp({ socket: { remoteAddress: '10.0.0.2' } }),
        '10.0.0.2'
    );
});

test('parseClientInfo classifies platforms, devices, and client versions accurately', () => {
    // iOS App via explicit headers
    const iosHeader = auditRepo.parseClientInfo({
        headers: {
            'x-client-platform': 'ios',
            'x-client-version': '1.0.614',
            'x-device-model': 'iPhone 16 Pro',
            'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)'
        }
    });
    assert.equal(iosHeader.platform, 'ios');
    assert.equal(iosHeader.device, 'iPhone 16 Pro');
    assert.equal(iosHeader.clientVersion, '1.0.614');

    // Android App via Ktor OkHttp
    const androidOkHttp = auditRepo.parseClientInfo({
        headers: {
            'user-agent': 'okhttp/4.12.0'
        }
    });
    assert.equal(androidOkHttp.platform, 'android');
    assert.equal(androidOkHttp.device, 'Android Device');
    assert.equal(androidOkHttp.clientVersion, 'OkHttp 4.12.0');

    // Ktor client iOS App
    const ktorIos = auditRepo.parseClientInfo({
        headers: {
            'user-agent': 'Ktor client',
            'accept-language': 'zh-Hans-CN,zh-CN;q=0.9',
            'accept-encoding': 'gzip, deflate, br'
        }
    });
    assert.equal(ktorIos.platform, 'ios');
    assert.equal(ktorIos.device, 'iPhone / iPad');
    assert.equal(ktorIos.clientVersion, 'Dragon Claw Mobile (v1.0)');

    // Ktor client Android App
    const ktorAndroid = auditRepo.parseClientInfo({
        headers: {
            'user-agent': 'Ktor client',
            'accept-encoding': 'gzip'
        }
    });
    assert.equal(ktorAndroid.platform, 'android');
    assert.equal(ktorAndroid.device, 'Android Device');
    assert.equal(ktorAndroid.clientVersion, 'Dragon Claw Mobile (v1.0)');

    // Desktop App (Electron)
    const electronUa = auditRepo.parseClientInfo({
        headers: {
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.186 Electron/32.2.0 Safari/537.36'
        }
    });
    assert.equal(electronUa.platform, 'desktop');
    assert.equal(electronUa.device, 'Mac (macOS 10.15.7)');
    assert.equal(electronUa.clientVersion, 'Electron v32.2.0');

    // PC Web (Windows Edge)
    const pcEdge = auditRepo.parseClientInfo({
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86'
        }
    });
    assert.equal(pcEdge.platform, 'web');
    assert.equal(pcEdge.device, 'Windows 10/11');
    assert.equal(pcEdge.clientVersion, 'Edge 131.0.2903.86');

    // Mobile Web (iPhone Safari)
    const mobileSafari = auditRepo.parseClientInfo({
        headers: {
            'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
        }
    });
    assert.equal(mobileSafari.platform, 'mobile_web');
    assert.equal(mobileSafari.device, 'iPhone (iOS 18.1)');
    assert.equal(mobileSafari.clientVersion, 'Safari 18.1');
});

test('platform_audit_log records and lists with pagination and platform filters', async t => {
    t.after(async () => {
        await controlDb.closeDatabase();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    await auditRepo.ensureReady();

    // 写入来自不同平台的审计记录
    const reqIos = {
        headers: { 'cf-connecting-ip': '1.1.1.1', 'x-client-platform': 'ios', 'x-client-version': '1.0.614', 'x-device-model': 'iPhone 16' },
        user: { username: 'admin' }
    };
    const reqAndroid = {
        headers: { 'x-forwarded-for': '2.2.2.2', 'user-agent': 'okhttp/4.12.0' },
        user: { username: 'user_android' }
    };
    const reqDesktop = {
        headers: { 'x-real-ip': '3.3.3.3', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Electron/32.2.0' },
        user: { username: 'admin' }
    };
    const reqWeb = {
        headers: { 'x-forwarded-for': '4.4.4.4', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0.0.0' },
        user: { username: 'user_web' }
    };

    await auditRepo.record(reqIos, { action: 'login', tenantId: 'default' });
    await auditRepo.record(reqAndroid, { action: 'login', tenantId: 'team_a' });
    await auditRepo.record(reqDesktop, { action: 'password_change', target: 'admin' });
    await auditRepo.record(reqWeb, { action: 'login_failed', detail: '密码错误' });

    // 1. 分页测试：总数 4 条，第 1 页每页 2 条
    const page1 = await auditRepo.list({ page: 1, limit: 2 });
    assert.equal(page1.total, 4);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.page, 1);
    assert.equal(page1.pageSize, 2);
    assert.equal(page1.items.length, 2);

    // 第 2 页
    const page2 = await auditRepo.list({ page: 2, limit: 2 });
    assert.equal(page2.page, 2);
    assert.equal(page2.items.length, 2);
    assert.notEqual(page1.items[0].id, page2.items[0].id);

    // 2. 平台筛选测试
    const iosList = await auditRepo.list({ platform: 'ios' });
    assert.equal(iosList.total, 1);
    assert.equal(iosList.items[0].platform, 'ios');
    assert.equal(iosList.items[0].ip, '1.1.1.1');
    assert.equal(iosList.items[0].device, 'iPhone 16');
    assert.equal(iosList.items[0].clientVersion, '1.0.614');

    const androidList = await auditRepo.list({ platform: 'android' });
    assert.equal(androidList.total, 1);
    assert.equal(androidList.items[0].platform, 'android');
    assert.equal(androidList.items[0].ip, '2.2.2.2');

    const desktopList = await auditRepo.list({ platform: 'desktop' });
    assert.equal(desktopList.total, 1);
    assert.equal(desktopList.items[0].platform, 'desktop');
    assert.equal(desktopList.items[0].ip, '3.3.3.3');

    // 3. 动作筛选测试
    const failedList = await auditRepo.list({ action: 'login_failed' });
    assert.equal(failedList.total, 1);
    assert.equal(failedList.items[0].detail, '密码错误');
    assert.equal(failedList.items[0].platform, 'web');
});
