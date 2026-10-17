const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 签发会写密钥文件与台账：全部指向临时目录，绝不触碰 backend/data 下的正式数据
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-license-binding-'));
process.env.DESKTOP_LICENSE_SIGNING_KEY_FILE = path.join(sandbox, 'signing-key.json');
process.env.DESKTOP_LICENSE_REGISTRY_FILE = path.join(sandbox, 'registry.json');

// 在线校验用到的可信时间服务替换为本地时钟，测试不访问外网
const trustedTimePath = require.resolve('../backend/models/f12-trusted-time-service');
require.cache[trustedTimePath] = {
    id: trustedTimePath, filename: trustedTimePath, loaded: true,
    exports: { getTrustedTime: async () => ({ now: Date.now(), source: 'test', sampleCount: 1 }) }
};

const express = require('express');
const { encodeMachineCode, decodeMachineCode } = require('../backend/models/desktop-machine-code');
const { getDesktopMachineIdentity, fingerprintOf, normalizeId } = require('../desktop-machine-id');
const authority = require('../backend/models/desktop-license-authority');
const registry = require('../backend/models/desktop-license-registry');
const { createDesktopLicenseClient } = require('../desktop-license-client');

const MACHINE_A = { machineId: 'a1'.repeat(16), host: 'ZHANG-PC', platform: 'win32', arch: 'x64', source: 'win32' };
const MACHINE_B = { machineId: 'b2'.repeat(16), host: 'LI-LAPTOP', platform: 'darwin', arch: 'arm64', source: 'darwin' };
const codeOf = machine => encodeMachineCode(machine);

function makeClient(machine, validationUrl = 'http://127.0.0.1:9/validate', dir = fs.mkdtempSync(path.join(sandbox, 'client-'))) {
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
        version: 1, productId: 'tools-platform-desktop', validationUrl, publicKeyJwk: authority.getPublicKeyJwk()
    }));
    const client = createDesktopLicenseClient({
        configPath, statePath: path.join(dir, 'state.json'), publicStatusPath: path.join(dir, 'status.json'), machineIdentity: machine
    });
    return { client, dir };
}

function signRaw(payload) {
    const key = JSON.parse(fs.readFileSync(process.env.DESKTOP_LICENSE_SIGNING_KEY_FILE, 'utf8')).privateKeyPem;
    const part = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('sha256', Buffer.from(part), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `DSKL1.${part}.${sig}`;
}

test('机器码：编码/解码往返，截断或改动会被校验位发现', () => {
    const code = codeOf(MACHINE_A);
    assert.match(code, /^DPMC1\.[-_A-Za-z0-9]+\.[a-f0-9]{6}$/);
    const decoded = decodeMachineCode(`  ${code.slice(0, 20)}\n${code.slice(20)}  `); // 复制时混入换行/空格也能识别
    assert.equal(decoded.valid, true);
    assert.equal(decoded.machineId, MACHINE_A.machineId);
    assert.equal(decoded.host, 'ZHANG-PC');
    assert.equal(decodeMachineCode(code.slice(0, -1) + (code.endsWith('0') ? '1' : '0')).reasonCode, 'MACHINE_CODE_CHECKSUM');
    assert.equal(decodeMachineCode(code.slice(0, 30)).reasonCode, 'MACHINE_CODE_INVALID');
    assert.equal(decodeMachineCode('').reasonCode, 'MACHINE_CODE_REQUIRED');
    assert.equal(decodeMachineCode('DSKL1.abc.def').reasonCode, 'MACHINE_CODE_INVALID');
});

test('设备指纹：由多项标识共同决定，过滤占位 UUID，本机可现场采集', async () => {
    const a = fingerprintOf('win32', [['machine-guid', 'guid-1'], ['smbios-uuid', 'uuid-1']]);
    assert.match(a, /^[a-f0-9]{32}$/);
    assert.notEqual(a, fingerprintOf('win32', [['machine-guid', 'guid-1'], ['smbios-uuid', 'uuid-2']]), '整盘克隆到另一块主板时指纹不同');
    assert.notEqual(a, fingerprintOf('win32', [['machine-guid', 'guid-2'], ['smbios-uuid', 'uuid-1']]));
    assert.equal(normalizeId('03000200-0400-0500-0006-000700080009'), '');
    assert.equal(normalizeId('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'), '');
    const identity = await getDesktopMachineIdentity({ fallbackDir: sandbox });
    assert.match(identity.machineId, /^[a-f0-9]{32}$/);
    assert.equal(decodeMachineCode(identity.machineCode).machineId, identity.machineId);
    const again = await getDesktopMachineIdentity({ fallbackDir: sandbox });
    assert.equal(again.machineId, identity.machineId, '同一台机器重复采集结果稳定');
});

test('签发：必须提供有效机器码，生成 v2 设备绑定 License', () => {
    assert.throws(() => authority.issue({ label: '无机器码', days: 30 }), /机器码/);
    assert.throws(() => authority.issue({ label: '坏机器码', days: 30, machineCode: 'DPMC1.xx.yy' }), /机器码/);
    const issued = authority.issue({ label: '张三-办公电脑', days: 30, machineCode: codeOf(MACHINE_A) });
    assert.equal(issued.payload.version, 2);
    assert.equal(issued.payload.machineId, MACHINE_A.machineId);
    assert.equal(issued.record.machine.machineId, MACHINE_A.machineId);
    assert.equal(issued.record.machine.host, 'ZHANG-PC');
    const inspected = authority.inspectMachineCode(codeOf(MACHINE_A));
    assert.equal(inspected.boundTo.length >= 1, true, '签发前预览可提示该设备已绑定的 License');
});

test('离线校验：本机通过；换到其他设备、旧版通用 License、篡改载荷均被拒绝', async () => {
    const issued = authority.issue({ label: '离线校验', days: 30, machineCode: codeOf(MACHINE_A) });
    const onA = makeClient(MACHINE_A);
    const ok = await onA.client.validate(issued.token);
    assert.equal(ok.valid, true);
    assert.equal(ok.online, false, '授权服务器不可达时走本地离线校验');

    const onB = makeClient(MACHINE_B);
    assert.equal((await onB.client.validate(issued.token)).reasonCode, 'MACHINE_MISMATCH');

    // 把已激活机器的整个状态目录拷到另一台机器：存储的 License 同样失效
    const copied = makeClient(MACHINE_B, undefined, onA.dir);
    assert.equal((await copied.client.validateStored()).reasonCode, 'MACHINE_MISMATCH');

    const now = Date.now();
    const legacy = signRaw({ version: 1, licenseId: crypto.randomUUID(), productId: 'tools-platform-desktop', issuedAt: now, notBefore: now - 1000, expiresAt: now + 86400000 });
    assert.equal((await onA.client.validate(legacy)).reasonCode, 'LEGACY_LICENSE');

    const [prefix, payloadPart, signature] = issued.token.split('.');
    const forged = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
    forged.machineId = MACHINE_B.machineId;
    const tampered = `${prefix}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;
    assert.equal((await onB.client.validate(tampered)).reasonCode, 'INVALID_SIGNATURE', '改写载荷里的指纹会破坏签名');

    const noMachine = makeClient(null);
    assert.equal((await noMachine.client.validate(issued.token)).reasonCode, 'MACHINE_UNAVAILABLE');
});

test('台账校验：载荷、台账、客户端上报指纹必须一致；旧版未绑定记录拒绝', () => {
    const issued = authority.issue({ label: '台账', days: 30, machineCode: codeOf(MACHINE_A) });
    assert.equal(registry.checkPayload(issued.payload, Date.now(), issued.token, MACHINE_A.machineId).valid, true);
    assert.equal(registry.checkPayload(issued.payload, Date.now(), issued.token, MACHINE_B.machineId).reasonCode, 'MACHINE_MISMATCH');
    assert.equal(registry.checkPayload(issued.payload, Date.now(), issued.token, '').reasonCode, 'MACHINE_MISMATCH');
    const legacyRecord = registry.createRecord({ licenseId: crypto.randomUUID(), label: '旧版', token: 'x', notBefore: Date.now() - 1000, expiresAt: Date.now() + 86400000 });
    assert.equal(registry.checkPayload({ productId: 'tools-platform-desktop', licenseId: legacyRecord.licenseId, machineId: MACHINE_A.machineId }, Date.now(), 'x', MACHINE_A.machineId).reasonCode, 'LEGACY_LICENSE');
    assert.throws(() => authority.renew(legacyRecord.licenseId, { days: 30 }), /机器码/);
    const bound = authority.renew(legacyRecord.licenseId, { days: 30, machineCode: codeOf(MACHINE_B) });
    assert.equal(bound.record.machine.machineId, MACHINE_B.machineId, '旧版记录续期时绑定设备');
});

test('续期与换绑：续期保持原设备；换绑后旧设备上的密钥立即作废', () => {
    const issued = authority.issue({ label: '换绑', days: 30, machineCode: codeOf(MACHINE_A) });
    const renewed = authority.renew(issued.record.licenseId, { days: 7 });
    assert.equal(renewed.payload.machineId, MACHINE_A.machineId);
    assert.equal(registry.checkPayload(issued.payload, Date.now(), issued.token, MACHINE_A.machineId).valid, true, '同设备续期后旧密钥仍可用到原到期时间');

    const rebound = authority.renew(issued.record.licenseId, { days: 30, machineCode: codeOf(MACHINE_B) });
    assert.equal(rebound.payload.machineId, MACHINE_B.machineId);
    assert.equal(rebound.record.bindingHistory.length, 1);
    assert.equal(registry.checkPayload(rebound.payload, Date.now(), rebound.token, MACHINE_B.machineId).valid, true);
    assert.equal(registry.checkPayload(issued.payload, Date.now(), issued.token, MACHINE_A.machineId).valid, false, '换绑后原设备密钥失效');
    assert.equal(registry.checkPayload(renewed.payload, Date.now(), renewed.token, MACHINE_A.machineId).valid, false);
});

test('在线校验全链路：服务端核对设备指纹并签发绑定本机的凭证', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/public/desktop-license', require('../backend/routes/desktop-license-public'));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/public/desktop-license/validate`;
        const issued = authority.issue({ label: '在线', days: 30, machineCode: codeOf(MACHINE_A) });
        const onA = makeClient(MACHINE_A, url);
        const result = await onA.client.validate(issued.token);
        assert.equal(result.valid, true);
        assert.equal(result.online, true);

        // 服务端拒绝：客户端上报的指纹与绑定设备不符（即使有人绕过了本地检查）
        const response = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: issued.token, productId: 'tools-platform-desktop', nonce: crypto.randomBytes(18).toString('base64url'), machineId: MACHINE_B.machineId })
        });
        const body = await response.json();
        const attestation = JSON.parse(Buffer.from(body.attestation.split('.')[1], 'base64url').toString('utf8'));
        assert.equal(attestation.valid, false);
        assert.equal(attestation.reasonCode, 'MACHINE_MISMATCH');

        registry.setStatus(issued.record.licenseId, 'revoked', '测试吊销');
        assert.equal((await onA.client.validate(issued.token)).reasonCode, 'REVOKED');
    } finally {
        server.close();
    }
});

test('打包：设备指纹模块随桌面版发布，机器码解析模块不被排除', () => {
    const { build } = require('../package.json');
    assert.ok(build.files.includes('desktop-machine-id.js'));
    assert.ok(!build.files.some(entry => entry.includes('desktop-machine-code')), '签发端与客户端共用的机器码模块必须打包');
    const main = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
    assert.match(main, /await ensureDesktopMachineIdentity\(\);\s*desktopLicenseStatus = await desktopLicenseClient\.validateStored\(\)/, '授权判断前必须先完成设备指纹采集');
});

test('License 签发页不再使用浏览器原生弹窗，统一走 AppDialog / 页内提示', () => {
    const page = fs.readFileSync(path.join(__dirname, '../frontend/pages/desktop-license-admin.html'), 'utf8');
    const scripts = (page.match(/<script>([\s\S]*?)<\/script>/g) || []).join('\n');
    assert.doesNotMatch(scripts, /(?<![\w.$])(?:window\.)?(?:alert|confirm|prompt)\s*\(/, '签发页脚本中不应再调用原生 alert/confirm/prompt');
    assert.match(page, /<script src="\/js\/shared\/app-dialog\.js"><\/script>/);
    const dialog = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/app-dialog.js'), 'utf8');
    assert.match(dialog, /window\.AppDialog = \{/);
    assert.match(dialog, /typeof window\.showNavbarConfirm === 'function'/, '平台页面复用导航栏弹窗，保持全站风格一致');
});
