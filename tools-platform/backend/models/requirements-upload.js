const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getDataDir, getTenantId } = require('./tenant-context');

const MAX_BODY_BYTES = 800000;
const MAX_CHUNK_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const TTL = 15 * 60 * 1000;
const sessions = new Map();

function fail(message, status = 400) {
    throw Object.assign(new Error(message), { status, code: 'REQUIREMENT_UPLOAD_INVALID' });
}

function removeFiles(session) {
    try { fs.rmSync(session.dir, { recursive: true, force: true }); }
    catch (_) { console.warn('[requirements-upload] 临时分块清理失败，将在后续清理时重试'); }
}

function cleanup() {
    for (const session of sessions.values()) {
        if (!session.processing && session.expiresAt < Date.now()) {
            removeFiles(session);
            sessions.delete(session.id);
        }
    }
}
setInterval(cleanup, 60000).unref();

function authorizeTarget(target, user) {
    if (target.method === 'PUT' && user.role !== 'admin') fail('没有权限，提交后仅管理员可修改需求信息', 403);
}

function getSession(id, user) {
    cleanup();
    const session = sessions.get(id);
    if (!session || session.tenant !== getTenantId() || session.owner !== user.username) {
        fail('需求上传会话不存在或已过期，请重新提交', 404);
    }
    authorizeTarget(session.target, user);
    session.expiresAt = Date.now() + TTL;
    return session;
}

function checkBody(body) {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) fail('分块请求正文超过 800,000 字节', 413);
}

function start(body, user) {
    checkBody(body);
    cleanup();
    const { method, requirementId, totalBytes, totalChunks, sha256 } = body;
    if (!['POST', 'PUT'].includes(method)
        || (method === 'PUT' && (!Number.isSafeInteger(requirementId) || requirementId <= 0))
        || (method === 'POST' && requirementId != null)
        || !Number.isSafeInteger(totalBytes) || totalBytes <= 0 || totalBytes > MAX_TOTAL_BYTES
        || !Number.isInteger(totalChunks) || totalChunks <= 0 || totalChunks > 256 || totalChunks > totalBytes
        || totalBytes > totalChunks * MAX_CHUNK_BYTES || !/^[a-f0-9]{64}$/.test(sha256 || '')) {
        fail('需求分块上传参数无效或总大小超过 50 MB');
    }
    const target = { method, requirementId, path: method === 'POST' ? '/api/requirements' : `/api/requirements/${requirementId}` };
    authorizeTarget(target, user);
    const active = [...sessions.values()].filter(session => !session.completed);
    if (active.length >= 32 || active.filter(session => session.tenant === getTenantId() && session.owner === user.username).length >= 3) {
        fail('未完成的需求上传过多，请稍后重试', 429);
    }
    if (sessions.size >= 256) {
        const completed = [...sessions.values()].find(session => session.completed);
        if (completed) { removeFiles(completed); sessions.delete(completed.id); }
    }
    const root = path.join(getDataDir(), 'tmp/encrypted-requirement-uploads');
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    // Only generated, expired scratch directories from this feature in the current tenant.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name) || sessions.has(entry.name)) continue;
        const stale = path.join(root, entry.name);
        if (fs.statSync(stale).mtimeMs < Date.now() - TTL) fs.rmSync(stale, { recursive: true, force: true });
    }
    const id = crypto.randomBytes(16).toString('hex');
    const dir = path.join(root, id);
    fs.mkdirSync(dir, { mode: 0o700 });
    sessions.set(id, {
        id, dir, target, tenant: getTenantId(), owner: user.username,
        totalBytes, totalChunks, sha256, chunks: new Map(), receivedBytes: 0, expiresAt: Date.now() + TTL
    });
    return { uploadId: id };
}

function receive(id, body, user) {
    checkBody(body);
    const session = getSession(id, user);
    if (session.promise) fail('需求上传已经完成或正在保存', 409);
    const { index, data } = body;
    if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks || typeof data !== 'string') fail('分块参数无效');
    const bytes = Buffer.from(data, 'utf8');
    if (!bytes.length || bytes.length > MAX_CHUNK_BYTES) fail('分块大小无效');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    if (session.chunks.has(index)) {
        if (session.chunks.get(index).hash !== hash) fail('重复分块内容不一致', 409);
    } else {
        if (session.receivedBytes + bytes.length > session.totalBytes) fail('分块总大小不一致');
        fs.writeFileSync(path.join(session.dir, `${index}.part`), bytes, { mode: 0o600 });
        session.chunks.set(index, { hash, size: bytes.length });
        session.receivedBytes += bytes.length;
    }
    return { receivedChunks: session.chunks.size };
}

async function complete(id, user, save) {
    const session = getSession(id, user);
    if (session.promise) return session.promise; // A lost response can retry without another database write.
    if (session.chunks.size !== session.totalChunks) fail('需求分块尚未全部接收', 409);
    session.processing = true;
    session.promise = (async () => {
        const bytes = Buffer.concat(Array.from({ length: session.totalChunks }, (_, index) => fs.readFileSync(path.join(session.dir, `${index}.part`))));
        if (bytes.length !== session.totalBytes || crypto.createHash('sha256').update(bytes).digest('hex') !== session.sha256) fail('需求整包校验失败');
        let envelope;
        try { envelope = JSON.parse(bytes.toString('utf8')); } catch (_) { fail('需求上传内容格式无效'); }
        if (!envelope || Object.keys(envelope).length !== 1 || !envelope.encryptedPayload) fail('需求上传必须使用加密数据');
        const result = await save(envelope, session.target);
        session.completed = true;
        session.processing = false;
        session.expiresAt = Date.now() + TTL;
        session.chunks.clear();
        removeFiles(session);
        return result;
    })().catch(error => {
        session.processing = false;
        session.completed = true;
        session.chunks.clear();
        removeFiles(session);
        // Do not repeat a database operation after an ambiguous failure.
        // Validation failures are also retained so completion retries have the same outcome.
        throw error;
    });
    return session.promise;
}

function cancel(id, user) {
    const session = getSession(id, user);
    if (session.processing) fail('需求正在保存', 409);
    if (session.completed) return; // Keep the receipt available for safe completion retries.
    removeFiles(session);
    sessions.delete(id);
}

module.exports = { start, receive, complete, cancel, cleanup, MAX_BODY_BYTES, MAX_CHUNK_BYTES };
