const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./store');
const registry = require('./desktop-license-registry');
const { decodeMachineCode, isMachineId } = require('./desktop-machine-code');

const TOKEN_PREFIX = 'DSKL1';
// v2：License 绑定设备指纹，载荷必含 machineId 与有效期；v1 通用 License 不再签发也不再通过校验
const TOKEN_VERSION = 2;
const ATTESTATION_PREFIX = 'DSKT1';
const KEY_FILE = process.env.DESKTOP_LICENSE_SIGNING_KEY_FILE
    || path.join(DATA_DIR, 'desktop-license-signing-key.json');

function encode(value) {
    return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
}

function ensureSigningKeys() {
    if (fs.existsSync(KEY_FILE)) {
        const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
        if (saved.privateKeyPem && saved.publicKeyPem) return saved;
    }
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const saved = {
        algorithm: 'ECDSA_P256_SHA256',
        createdAt: new Date().toISOString(),
        privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
        publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' })
    };
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, `${JSON.stringify(saved, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch (_) {}
    return saved;
}

function getPublicKeyJwk() {
    return crypto.createPublicKey(ensureSigningKeys().publicKeyPem).export({ format: 'jwk' });
}

function sign(prefix, payload) {
    const payloadPart = encode(payload);
    const signature = crypto.sign('sha256', Buffer.from(payloadPart), {
        key: ensureSigningKeys().privateKeyPem,
        dsaEncoding: 'ieee-p1363'
    }).toString('base64url');
    return `${prefix}.${payloadPart}.${signature}`;
}

function verifyToken(token) {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return { valid: false, reasonCode: 'INVALID_FORMAT' };
    try {
        const signatureValid = crypto.verify('sha256', Buffer.from(parts[1]), {
            key: ensureSigningKeys().publicKeyPem,
            dsaEncoding: 'ieee-p1363'
        }, Buffer.from(parts[2], 'base64url'));
        if (!signatureValid) return { valid: false, reasonCode: 'INVALID_SIGNATURE' };
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (!payload || payload.productId !== registry.PRODUCT_ID
            || typeof payload.licenseId !== 'string' || !Number.isFinite(payload.issuedAt)) {
            return { valid: false, reasonCode: 'INVALID_FORMAT' };
        }
        if (payload.version !== TOKEN_VERSION || !isMachineId(payload.machineId)) {
            return { valid: false, reasonCode: 'LEGACY_LICENSE' };
        }
        if (!Number.isFinite(payload.notBefore) || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= payload.notBefore) {
            return { valid: false, reasonCode: 'INVALID_FORMAT' };
        }
        return { valid: true, payload };
    } catch (_) {
        return { valid: false, reasonCode: 'VERIFICATION_FAILED' };
    }
}

const MACHINE_CODE_ERRORS = {
    MACHINE_CODE_REQUIRED: '请填写用户提供的机器码',
    MACHINE_CODE_CHECKSUM: '机器码校验失败，可能复制不完整或被改动，请让用户重新复制',
    MACHINE_CODE_INVALID: '机器码格式无效（应以 DPMC1. 开头）'
};

function requireMachine(machineCode) {
    const decoded = decodeMachineCode(machineCode);
    if (!decoded.valid) throw new Error(MACHINE_CODE_ERRORS[decoded.reasonCode] || '机器码无效');
    return decoded;
}

function machineRecord(decoded) {
    return {
        machineId: decoded.machineId,
        machineCode: decoded.code,
        host: decoded.host,
        platform: decoded.platform,
        arch: decoded.arch,
        source: decoded.source
    };
}

function issue({ label, days = 30, expiresAt, machineCode } = {}) {
    const machine = requireMachine(machineCode);
    const issuedAt = Date.now();
    const notBefore = issuedAt - 60000;
    let finalExpiresAt = Number(expiresAt);
    if (!Number.isFinite(finalExpiresAt)) {
        const safeDays = Math.max(1, Math.min(3650, Number.parseInt(days, 10) || 30));
        finalExpiresAt = issuedAt + safeDays * 86400000;
    }
    if (finalExpiresAt <= issuedAt) throw new Error('到期时间必须晚于当前时间');
    const licenseId = crypto.randomUUID();
    const payload = {
        version: TOKEN_VERSION,
        licenseId,
        productId: registry.PRODUCT_ID,
        machineId: machine.machineId,
        issuedAt,
        notBefore,
        expiresAt: finalExpiresAt
    };
    const token = sign(TOKEN_PREFIX, payload);
    const record = registry.createRecord({ licenseId, label, token, notBefore, expiresAt: finalExpiresAt, machine: machineRecord(machine) });
    return { token, payload, record, publicKeyJwk: getPublicKeyJwk() };
}

function renew(licenseId, options = {}) {
    const current = registry.getRecord(licenseId);
    if (!current) throw new Error('未找到 License 记录');
    // 填了新机器码即为换绑；旧版未绑定设备的记录续期时必须提供机器码
    const rebind = Boolean(String(options.machineCode || '').trim());
    if (!rebind && !(current.machine && isMachineId(current.machine.machineId))) {
        throw new Error('该 License 为旧版通用授权，续期时必须填写用户的机器码以绑定设备');
    }
    const machine = rebind ? machineRecord(requireMachine(options.machineCode)) : current.machine;
    const issuedAt = Date.now();
    const notBefore = issuedAt - 60000;
    const expiresAt = registry.calculateRenewedExpiry(current, options);
    const payload = {
        version: TOKEN_VERSION,
        licenseId: current.licenseId,
        productId: registry.PRODUCT_ID,
        machineId: machine.machineId,
        issuedAt,
        notBefore,
        expiresAt
    };
    const token = sign(TOKEN_PREFIX, payload);
    const record = registry.replaceTokenForRenewal(licenseId, { token, notBefore, expiresAt, machine, rebind });
    return { token, payload, record, publicKeyJwk: getPublicKeyJwk() };
}

function inspectMachineCode(machineCode) {
    const decoded = decodeMachineCode(machineCode);
    if (!decoded.valid) return { valid: false, reasonCode: decoded.reasonCode, error: MACHINE_CODE_ERRORS[decoded.reasonCode] || '机器码无效' };
    const boundTo = registry.listRecords().filter(item => item.machine && item.machine.machineId === decoded.machineId && item.status !== 'archived')
        .map(item => ({ licenseId: item.licenseId, label: item.label, status: item.status, expiresAt: item.expiresAt }));
    return { ...decoded, boundTo };
}

function signAttestation(payload) {
    return sign(ATTESTATION_PREFIX, payload);
}

module.exports = {
    ATTESTATION_PREFIX,
    KEY_FILE,
    TOKEN_PREFIX,
    ensureSigningKeys,
    getPublicKeyJwk,
    TOKEN_VERSION,
    inspectMachineCode,
    issue,
    renew,
    signAttestation,
    verifyToken
};
