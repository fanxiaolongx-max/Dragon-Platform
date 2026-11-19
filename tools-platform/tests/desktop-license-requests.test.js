const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 全部指向临时目录：平台库、签发密钥、台账都不触碰 backend/data 下的正式数据
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-license-requests-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.DESKTOP_LICENSE_SIGNING_KEY_FILE = path.join(sandbox, 'signing-key.json');
process.env.DESKTOP_LICENSE_REGISTRY_FILE = path.join(sandbox, 'registry.json');

const trustedTimePath = require.resolve('../backend/models/f12-trusted-time-service');
require.cache[trustedTimePath] = {
    id: trustedTimePath, filename: trustedTimePath, loaded: true,
    exports: { getTrustedTime: async () => ({ now: Date.now(), source: 'test', sampleCount: 1 }) }
};

const express = require('express');
const { checkAuth } = require('../backend/middleware/auth');
const usersRepo = require('../backend/models/auth-users-repository');
const sessionsRepo = require('../backend/models/auth-sessions-repository');
const { runWithTenant, tenantMiddleware } = require('../backend/models/tenant-context');
const desktopLicenseAdmin = require('../backend/routes/desktop-license-admin');
const { createFrontendHtmlMiddleware } = require('../backend/models/asset-versioning');
const authority = require('../backend/models/desktop-license-authority');
const registry = require('../backend/models/desktop-license-registry');
const { encodeMachineCode } = require('../backend/models/desktop-machine-code');
const { createDesktopLicenseClient } = require('../desktop-license-client');

const MACHINE_A = { machineId: 'c3'.repeat(16), host: 'WANG-PC', platform: 'win32', arch: 'x64', source: 'win32' };
const MACHINE_B = { machineId: 'd4'.repeat(16), host: 'ZHAO-MAC', platform: 'darwin', arch: 'arm64', source: 'darwin' };
MACHINE_A.machineCode = encodeMachineCode(MACHINE_A);
MACHINE_B.machineCode = encodeMachineCode(MACHINE_B);

let server;
let baseUrl;
let adminUrl;

test.before(async () => {
    const accounts = [
        { username: 'license-super', role: 'admin', tenantId: 'default', isSuper: true },
        { username: 'license-default-admin', role: 'admin', tenantId: 'default' },
        { username: 'license-team-admin', role: 'admin', tenantId: 'license-team' },
        { username: 'license-viewer', role: 'viewer', tenantId: 'default' }
    ];
    for (const account of accounts) {
        await usersRepo.createUser({ ...account, passwordHash: 'fixture' });
        await sessionsRepo.saveSession(account.username, account.username, account.role, Date.now() + 60000, account.tenantId);
    }
    await sessionsRepo.saveSession('license-orphan', 'license-orphan', 'admin', Date.now() + 60000);

    const app = express();
    const publicDir = path.join(__dirname, '../frontend');
    app.use(express.json());
    app.use(desktopLicenseAdmin.pageRouter);
    app.use(createFrontendHtmlMiddleware(publicDir));
    app.use(express.static(publicDir, { index: false }));
    app.use('/api/public/desktop-license', require('../backend/routes/desktop-license-public'));
    app.use('/api', checkAuth, tenantMiddleware);
    app.use('/api/desktop-licenses', desktopLicenseAdmin);
    app.use('/api/friend-links', require('../backend/routes/friend-links'));
    app.use('/api/db-explorer', require('../backend/routes/db-explorer'));
    app.use('/api/global-backup', require('../backend/routes/global-backup'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    adminUrl = `${baseUrl}/api/desktop-licenses`;
});

test.after(() => server && server.close());

// 模拟一台桌面机：同一个 dir 再次创建 client 即「重启软件」
function desktop(machine, dir = fs.mkdtempSync(path.join(sandbox, 'desktop-'))) {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        version: 1, productId: 'tools-platform-desktop',
        validationUrl: `${baseUrl}/api/public/desktop-license/validate`, publicKeyJwk: authority.getPublicKeyJwk()
    }));
    const client = createDesktopLicenseClient({
        configPath, statePath: path.join(dir, 'state.json'), publicStatusPath: path.join(dir, 'status.json'),
        requestStatePath: path.join(dir, 'request.json'), machineIdentity: machine
    });
    return { client, dir };
}

async function admin(pathname, body) {
    const headers = { Authorization: 'Bearer license-super', 'Content-Type': 'application/json' };
    const response = await fetch(`${adminUrl}${pathname}`, body === undefined ? { headers } : {
        method: 'POST', headers, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
}

test('只有当前超级管理员账号能打开管理页、读取台账或操作 License', async () => {
    const pages = ['/desktop-license-admin', '/desktop-license-admin.html', '/pages/desktop-license-admin.html'];
    const actions = ['/issue', '/machine-code/inspect', '/requests/example/approve', '/requests/example/reject',
        '/example/renew', '/example/revoke', '/example/restore', '/example/archive'];
    for (const page of pages) {
        const response = await fetch(baseUrl + page, { redirect: 'manual' });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get('location'), '/login.html');
    }
    assert.equal((await fetch(adminUrl)).status, 401);

    for (const username of ['license-default-admin', 'license-team-admin', 'license-viewer', 'license-orphan']) {
        const headers = { Cookie: `tools_token=${username}`, 'Content-Type': 'application/json' };
        for (const page of pages) {
            assert.equal((await fetch(baseUrl + page, { headers })).status, 403, `${username} GET ${page}`);
            assert.equal((await fetch(baseUrl + page, { method: 'HEAD', headers })).status, 403, `${username} HEAD ${page}`);
        }
        assert.equal((await fetch(baseUrl + '/pages/%64esktop-license-admin.html', { headers })).status, 404);
        for (const pathname of ['', '/requests', ...actions]) {
            const options = actions.includes(pathname) ? { headers, method: 'POST', body: '{}' } : { headers };
            const response = await fetch(adminUrl + pathname, options);
            assert.equal(response.status, 403, `${username} ${pathname}`);
            assert.equal((await response.json()).code, 'SUPER_ADMIN_REQUIRED');
        }
        for (const pathname of ['/api/db-explorer/tables/desktop_license_requests', '/api/global-backup/list']) {
            assert.equal((await fetch(baseUrl + pathname, { headers })).status, 403, `${username} GET ${pathname}`);
        }
    }

    await sessionsRepo.setActiveTenant('license-super', 'license-team');
    for (const page of pages) {
        const response = await fetch(baseUrl + page, { headers: { Cookie: 'tools_token=license-super' } });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.match(await response.text(), /授权中枢控制台/);
    }
    assert.ok(Array.isArray((await admin('')).licenses));
});

test('友情链接只向超级管理员返回 License 入口，并过滤旧配置中的入口', async () => {
    const { writeKV } = require('../backend/models/kv-store');
    const { CONFIG_SCHEMA_VERSION } = require('../backend/models/friend-links-repository');
    const links = [
        { id: 'license', name: '旧入口', url: 'https://example.com/desktop-license-admin' },
        { id: 'alias', name: '旧别名', url: 'https://example.com/pages/%64esktop-license-admin.html' },
        { id: 'ordinary', name: '普通链接', url: 'https://example.com/' }
    ];
    for (const tenant of ['default', 'license-team']) {
        await runWithTenant(tenant, () => writeKV('sys', 'friend_links_config', { links, schemaVersion: CONFIG_SCHEMA_VERSION }));
    }
    const url = baseUrl + '/api/friend-links';
    for (const username of ['license-default-admin', 'license-team-admin', 'license-viewer', 'license-super']) {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${username}` } });
        assert.equal(response.status, 200);
        const snapshot = await response.json();
        assert.deepEqual(snapshot.links.map(link => link.id), ['ordinary']);
        assert.equal(snapshot.licenseAdminUrl, username === 'license-super' ? '/desktop-license-admin' : undefined);
    }
});

test('在线申请全流程：提交 → 重启后恢复申请 → 管理员一键审批（改有效期）→ 自动激活', async () => {
    const first = desktop(MACHINE_A);
    assert.equal(await first.client.probeRequestService(), true, '授权服务器可连通时显示在线申请');
    const submitted = await first.client.submitLicenseRequest({ applicantName: '王五', applicantNote: '运维部', clientVersion: '1.0.416' });
    assert.equal(submitted.status, 'pending');
    assert.equal(submitted.secret, undefined, '轮询凭据不暴露给界面');
    assert.ok(fs.existsSync(path.join(first.dir, 'request.json')), '申请状态保存在本地');

    // 管理员还没审批：本次查询仍为待审批
    assert.equal((await first.client.pollLicenseRequest()).request.status, 'pending');

    // 重启软件：从本地恢复申请状态
    const restarted = desktop(MACHINE_A, first.dir);
    const resumed = restarted.client.getLicenseRequest();
    assert.equal(resumed.requestId, submitted.requestId);
    assert.equal(resumed.applicantName, '王五');

    const pending = (await admin('/requests')).requests;
    const mine = pending.find(item => item.requestId === submitted.requestId);
    assert.ok(mine);
    assert.equal(mine.machine.host, 'WANG-PC');
    assert.equal(mine.applicantNote, '运维部');
    assert.equal(mine.existingLicense, null);

    const approved = await admin(`/requests/${submitted.requestId}/approve`, { days: 7, label: '王五-运维' });
    assert.equal(approved.renewed, false);
    assert.equal(approved.record.machine.machineId, MACHINE_A.machineId);
    const days = (approved.record.expiresAt - Date.now()) / 86400000;
    assert.ok(days > 6.9 && days <= 7, '有效期按管理员修改的 7 天签发');

    const done = await restarted.client.pollLicenseRequest();
    assert.equal(done.request.status, 'activated');
    assert.equal(done.license.valid, true, '取回 License 后自动完成激活');
    assert.equal(restarted.client.getLicenseRequest(), null, '激活后清除本地申请状态');
    assert.equal((await restarted.client.validateStored()).valid, true, '再次启动直接通过授权');
});

test('重复提交复用同一申请并轮换凭据；凭据或设备不符时查不到申请', async () => {
    const a = desktop(MACHINE_B);
    const first = await a.client.submitLicenseRequest({ applicantName: '赵六' });
    const oldState = JSON.parse(fs.readFileSync(path.join(a.dir, 'request.json'), 'utf8'));
    const second = await a.client.submitLicenseRequest({ applicantName: '赵六', applicantNote: '补充说明' });
    assert.equal(second.requestId, first.requestId, '同一设备只保留一条待审批申请');
    const list = (await admin('/requests')).requests.filter(item => item.machine.machineId === MACHINE_B.machineId && item.status === 'pending');
    assert.equal(list.length, 1);
    assert.equal(list[0].applicantNote, '补充说明');

    const stale = await fetch(`${baseUrl}/api/public/desktop-license/requests/${first.requestId}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: oldState.secret, machineId: MACHINE_B.machineId })
    });
    assert.equal(stale.status, 404, '旧凭据失效');
    const current = JSON.parse(fs.readFileSync(path.join(a.dir, 'request.json'), 'utf8'));
    const wrongMachine = await fetch(`${baseUrl}/api/public/desktop-license/requests/${first.requestId}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: current.secret, machineId: MACHINE_A.machineId })
    });
    assert.equal(wrongMachine.status, 404, '凭据正确但设备指纹不符同样查不到');

    // 申请文件被拷到另一台电脑：指纹不同，客户端直接丢弃
    const copied = desktop(MACHINE_A, a.dir);
    assert.equal(copied.client.getLicenseRequest(), null);
});

test('拒绝后显示原因并可重新提交；撤回后服务端标记为已撤回', async () => {
    const machine = { machineId: 'e5'.repeat(16), host: 'TEMP-PC', platform: 'linux', arch: 'x64', source: 'linux' };
    machine.machineCode = encodeMachineCode(machine);
    const box = desktop(machine);
    const submitted = await box.client.submitLicenseRequest({ applicantName: '临时用户' });
    await admin(`/requests/${submitted.requestId}/reject`, { reason: '请先走 OA 审批' });
    const rejected = await box.client.pollLicenseRequest();
    assert.equal(rejected.request.status, 'rejected');
    assert.equal(rejected.request.rejectReason, '请先走 OA 审批');
    await assert.rejects(admin(`/requests/${submitted.requestId}/approve`, {}), /已处理/);

    const again = await box.client.submitLicenseRequest({ applicantName: '临时用户' });
    assert.notEqual(again.requestId, submitted.requestId, '被拒后重新提交生成新申请');
    await box.client.cancelLicenseRequest();
    assert.equal(box.client.getLicenseRequest(), null);
    const all = (await admin('/requests?status=all')).requests;
    assert.equal(all.find(item => item.requestId === again.requestId).status, 'cancelled');
});

test('该设备已有 License 时一键审批为续期原记录，不重复建档', async () => {
    const machine = { machineId: 'f6'.repeat(16), host: 'RENEW-PC', platform: 'win32', arch: 'x64', source: 'win32' };
    machine.machineCode = encodeMachineCode(machine);
    const issued = authority.issue({ label: '续期测试', days: 1, machineCode: machine.machineCode });
    const before = registry.listRecords().length;
    const box = desktop(machine);
    const submitted = await box.client.submitLicenseRequest({ applicantName: '续期用户' });
    const pending = (await admin('/requests')).requests.find(item => item.requestId === submitted.requestId);
    assert.equal(pending.existingLicense.licenseId, issued.record.licenseId, '审批界面提示将续期已有 License');
    const approved = await admin(`/requests/${submitted.requestId}/approve`, {});
    assert.equal(approved.renewed, true);
    assert.equal(approved.record.licenseId, issued.record.licenseId);
    assert.equal(registry.listRecords().length, before);
    assert.ok(approved.record.expiresAt > issued.record.expiresAt + 28 * 86400000, '默认在原到期基础上续 30 天');
    assert.equal((await box.client.pollLicenseRequest()).license.valid, true);
});

test('公开接口校验输入：机器码无效、缺申请人、产品不符均拒绝', async () => {
    const post = body => fetch(`${baseUrl}/api/public/desktop-license/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ productId: 'tools-platform-desktop', machineCode: 'DPMC1.bad.000000', applicantName: 'x' })).status, 400);
    assert.equal((await post({ productId: 'tools-platform-desktop', machineCode: MACHINE_A.machineCode, applicantName: '  ' })).status, 400);
    assert.equal((await post({ productId: 'other', machineCode: MACHINE_A.machineCode, applicantName: 'x' })).status, 400);
});

test('桌面端启动时恢复申请并在批准后免弹窗激活；申请记录模块不随桌面版打包', () => {
    const main = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
    assert.match(main, /if \(desktopLicenseClient\.getLicenseRequest\(\)\) \{\s*const result = await pollLicenseRequestOnce\(\)/);
    assert.match(main, /if \(result && result\.license && result\.license\.valid\) return true;/);
    assert.match(main, /const interval = licenseWindow && !licenseWindow\.isDestroyed\(\) \? 15000 : 60000;/);
    const { build } = require('../package.json');
    assert.ok(build.files.includes('!backend/models/desktop-license-requests-repository.js'));
});

test('桌面端网络请求可走注入的 fetch（Electron net.fetch 遵循系统代理），探测失败时记录原因', async () => {
    const calls = [];
    const box = desktop(MACHINE_A);
    const configPath = path.join(box.dir, 'config.json');
    const viaProxy = createDesktopLicenseClient({
        configPath, statePath: path.join(box.dir, 's.json'), publicStatusPath: path.join(box.dir, 'p.json'),
        requestStatePath: path.join(box.dir, 'r.json'), machineIdentity: MACHINE_A,
        fetchImpl: (url, init) => { calls.push(url); return fetch(url, init); }
    });
    assert.equal(await viaProxy.probeRequestService(), true);
    assert.ok(calls.some(url => url.endsWith('/api/public/desktop-license/ping')), '探测请求经由注入的 fetch 发出');

    const broken = createDesktopLicenseClient({
        configPath, statePath: path.join(box.dir, 's2.json'), publicStatusPath: path.join(box.dir, 'p2.json'),
        machineIdentity: MACHINE_A, fetchImpl: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); }
    });
    assert.equal(await broken.probeRequestService(), false);
    assert.match(broken.getLastProbeError(), /ENOTFOUND/);

    const main = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
    assert.match(main, /fetchImpl: \(url, init\) => net\.fetch\(url, init\)/, '桌面端主进程使用 net.fetch');
    const page = fs.readFileSync(path.join(__dirname, '../frontend/pages/desktop-license-activation.html'), 'utf8');
    assert.match(page, /id="btn-request-retry"/, '离线时可手动重新检测');
    assert.match(page, /requestOnline === false && !pending/, '离线时自动重试');
});
