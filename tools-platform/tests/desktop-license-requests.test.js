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
    const app = express();
    app.use(express.json());
    app.use('/api/public/desktop-license', require('../backend/routes/desktop-license-public'));
    app.use('/api/desktop-licenses', (req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; next(); }, require('../backend/routes/desktop-license-admin'));
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
    const response = await fetch(`${adminUrl}${pathname}`, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
}

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
