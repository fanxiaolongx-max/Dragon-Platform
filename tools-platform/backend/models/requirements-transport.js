const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { getTenantId } = require('./tenant-context');

const VERSION = 1;
// Base64 expands ciphertext by 4/3; keep the envelope inside the existing 50 MB JSON limit.
const MAX_PLAINTEXT_BYTES = Math.floor((50 * 1024 * 1024 - 4096) * 3 / 4) - 16;
let keys;

function fail(code = 'REQUIREMENT_TRANSPORT_INVALID', status = 400) {
    const message = code === 'REQUIREMENT_TRANSPORT_KEY_CHANGED'
        ? '服务器加密密钥已更新，请重新提交需求'
        : '需求加密数据校验失败，请重新提交';
    throw Object.assign(new Error(message), { code, status });
}

function getKeys() {
    if (!keys) {
        const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        keys = {
            privateKey: pair.privateKey,
            publicKey: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
            keyId: crypto.randomBytes(16).toString('hex')
        };
    }
    return keys;
}

function contextFor(user) {
    return JSON.stringify([getTenantId(), user.username]);
}

function getPublicConfig(user) {
    const { publicKey, keyId } = getKeys();
    return { version: VERSION, publicKey, keyId, context: contextFor(user), maxPlaintextBytes: MAX_PLAINTEXT_BYTES };
}

function decode(value, min, max = min) {
    if (typeof value !== 'string' || value.length > 4 * Math.ceil(max / 3)
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail();
    const result = Buffer.from(value, 'base64');
    if (result.length < min || result.length > max || result.toString('base64') !== value) fail();
    return result;
}

function decrypt(body, { user, method, path }) {
    if (!body || !Object.hasOwn(body, 'encryptedPayload')) return body; // Older clients remain compatible.
    if (Object.keys(body).length !== 1) fail();
    const envelope = body.encryptedPayload;
    if (!envelope || envelope.version !== VERSION) fail();
    const pair = getKeys();
    if (envelope.keyId !== pair.keyId) fail('REQUIREMENT_TRANSPORT_KEY_CHANGED', 409);
    const encryptedKey = decode(envelope.encryptedKey, 256);
    const iv = decode(envelope.iv, 12);
    const ciphertext = decode(envelope.ciphertext, 17, MAX_PLAINTEXT_BYTES + 16);
    let aesKey;
    let plaintext;
    try {
        aesKey = crypto.privateDecrypt({ key: pair.privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, encryptedKey);
        if (aesKey.length !== 32) fail();
        const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
        decipher.setAAD(Buffer.from(JSON.stringify([VERSION, method, path, contextFor(user)])));
        decipher.setAuthTag(ciphertext.subarray(-16));
        plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
        const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.hasOwn(payload, 'encryptedPayload')) fail();
        for (const field of ['title', 'description', 'category', 'status', 'assignee', 'remark']) {
            if (payload[field] !== undefined && typeof payload[field] !== 'string') fail();
        }
        return payload;
    } catch (_) {
        fail();
    } finally {
        aesKey?.fill(0);
        plaintext?.fill(0);
    }
}

module.exports = { getPublicConfig, decrypt };
