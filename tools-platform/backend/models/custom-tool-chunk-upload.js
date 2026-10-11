const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getDataDir, getTenantId } = require('./tenant-context');

const CHUNK_BYTES = 512 * 1024;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_REQUEST_BYTES = 850000; // Leave >100 KB for HTTP headers below decimal 1 MB.
const TTL = 15 * 60 * 1000;
const sessions = new Map();
let keyPair;
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function getPublicKey() {
    if (!keyPair) keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return keyPair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}
function discard(session) {
    fs.rmSync(session.dir, { recursive: true, force: true });
    session.key.fill(0);
    sessions.delete(session.id);
}
function cleanup() {
    for (const session of sessions.values()) {
        if (!session.completing && session.expiresAt < Date.now()) discard(session);
    }
}
const timer = setInterval(cleanup, 60000);
timer.unref();
function getSession(id, owner, scope = 'tools') {
    cleanup();
    const session = sessions.get(id);
    if (!session || session.tenant !== getTenantId() || session.owner !== owner || session.scope !== scope) fail('上传会话不存在或已过期，请重新上传', 404);
    return session;
}
function decode(value, length) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail('分块编码无效');
    const buffer = Buffer.from(value, 'base64');
    if (length && buffer.length !== length) fail('分块长度无效');
    return buffer;
}
function start(body, owner, scope = 'tools') {
    cleanup();
    const { totalBytes, totalChunks, sha256, importRequestId } = body;
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > MAX_BYTES
        || totalChunks !== Math.ceil(totalBytes / CHUNK_BYTES)
        || !/^[a-f0-9]{64}$/.test(sha256 || '') || !/^[a-f0-9]{32}$/.test(importRequestId || '')) fail('分块上传参数无效或超过 50 MB');
    const active = [...sessions.values()].filter(s => !s.promise || s.completing);
    const owned = active.filter(s => s.tenant === getTenantId() && s.owner === owner);
    if (owned.length >= 3 || active.length >= 32) fail('未完成上传过多，请稍后重试', 429);
    if (sessions.size >= 256) {
        const completed = [...sessions.values()].find(s => s.promise && !s.completing);
        if (completed) discard(completed);
    }
    getPublicKey();
    let key;
    try {
        key = crypto.privateDecrypt({ key: keyPair.privateKey, oaepHash: 'sha256', padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, decode(body.encryptedKey, 256));
    } catch (_error) { fail('上传密钥校验失败'); }
    if (key.length !== 32) fail('上传密钥长度无效');
    const root = path.join(getDataDir(), scope === 'topics' ? 'tmp/encrypted-topic-imports' : 'tmp/encrypted-tool-imports');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    // Restarted processes no longer hold these keys. Remove only expired,
    // generated directories in the current tenant's upload scratch space.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name) || sessions.has(entry.name)) continue;
        const oldDir = path.join(root, entry.name);
        if (fs.statSync(oldDir).mtimeMs < Date.now() - TTL) fs.rmSync(oldDir, { recursive: true, force: true });
    }
    const id = crypto.randomBytes(16).toString('hex');
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { mode: 0o700 });
    sessions.set(id, { id, dir, key, owner, scope, tenant: getTenantId(), totalBytes, totalChunks,
        sha256, importRequestId, received: new Map(), expiresAt: Date.now() + TTL });
    return { uploadId: id, chunkBytes: CHUNK_BYTES, totalChunks };
}
function receive(id, body, owner, scope = 'tools') {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_REQUEST_BYTES) fail('分块请求超过大小限制', 413);
    const session = getSession(id, owner, scope);
    if (session.completing) fail('上传正在合并', 409);
    const index = body.index;
    if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) fail('分块序号无效');
    const encrypted = decode(body.ciphertext);
    const expectedSize = Math.min(CHUNK_BYTES, session.totalBytes - index * CHUNK_BYTES);
    if (encrypted.length !== expectedSize + 16) fail('分块大小不匹配');
    let plain;
    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', session.key, decode(body.iv, 12));
        decipher.setAAD(Buffer.from(`${id}:${index}:${session.totalChunks}`));
        decipher.setAuthTag(encrypted.subarray(-16));
        plain = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
    } catch (_error) { fail('分块解密或完整性校验失败'); }
    const hash = crypto.createHash('sha256').update(plain).digest('hex');
    if (session.received.has(index) && session.received.get(index) !== hash) fail('重复分块内容不一致', 409);
    if (!session.received.has(index)) {
        fs.writeFileSync(path.join(session.dir, `${index}.part`), plain, { mode: 0o600 });
        session.received.set(index, hash);
    }
    session.expiresAt = Date.now() + TTL;
    return { receivedChunks: session.received.size, totalChunks: session.totalChunks };
}
async function complete(id, owner, importTool, scope = 'tools') {
    const session = getSession(id, owner, scope);
    if (session.promise) return session.promise;
    if (session.received.size !== session.totalChunks) fail('分块尚未全部接收', 409);
    session.completing = true;
    session.promise = (async () => {
        const data = Buffer.concat(Array.from({ length: session.totalChunks }, (_, index) => fs.readFileSync(path.join(session.dir, `${index}.part`))));
        if (data.length !== session.totalBytes || crypto.createHash('sha256').update(data).digest('hex') !== session.sha256) fail('合并后的文件校验失败');
        let payload;
        try { payload = JSON.parse(data.toString('utf8')); } catch (_error) { fail('上传内容格式无效'); }
        if (payload.importRequestId !== session.importRequestId) fail('导入请求标识不一致');
        const tool = await importTool(payload);
        // Keep the result briefly so a lost completion response can be retried.
        fs.rmSync(session.dir, { recursive: true, force: true });
        session.key.fill(0);
        session.completing = false;
        session.expiresAt = Date.now() + TTL;
        return tool;
    })().catch(error => {
        if (!error.status || error.status >= 500) {
            // Retain verified blocks for retryable database/service failures.
            session.promise = null;
            session.completing = false;
            session.expiresAt = Date.now() + TTL;
        } else {
            discard(session);
        }
        throw error;
    });
    return session.promise;
}
function cancel(id, owner, scope = 'tools') {
    const session = getSession(id, owner, scope);
    if (session.completing) fail('上传正在合并', 409);
    discard(session);
}
module.exports = { getPublicKey, start, receive, complete, cancel, CHUNK_BYTES, MAX_REQUEST_BYTES };
