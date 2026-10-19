const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'requirements-transport-'));
process.env.TOOLS_DATA_DIR = temp;
const pool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');
const transport = require('../backend/models/requirements-transport');
const uploads = require('../backend/models/requirements-upload');
const router = require('../backend/routes/requirements');
const user = { username: 'admin', role: 'admin' };
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    if (!req.get('x-test-user')) return res.status(401).json({ error: 'Authentication required' });
    req.user = { username: req.get('x-test-user'), role: req.get('x-test-role') || 'admin' };
    next();
});
let loggedBody;
app.use((req, res, next) => {
    res.on('finish', () => { loggedBody = req.suppressBodyLog ? '[omitted]' : req.body; });
    next();
});
app.use('/api/requirements', router);
const call = (method, url, body, role = 'admin', username = 'admin') => {
    const req = request(app)[method](url).set('x-test-user', username).set('x-test-role', role);
    return body === undefined ? req : req.send(body);
};

function browser(getConfig = () => transport.getPublicConfig(user), overrides = {}) {
    const context = {
        window: { crypto: crypto.webcrypto, addEventListener() {} },
        document: { addEventListener() {} }, crypto: crypto.webcrypto,
        TextEncoder, Uint8Array, atob, btoa, setTimeout, clearTimeout,
        API: { get: async url => {
            assert.equal(url, '/api/requirements/transport-key');
            return getConfig();
        } },
        ...overrides
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/requirements.js'), 'utf8'), context);
    return vm.runInContext('ReqApp', context);
}

test.after(async () => { await pool.closeAll(); fs.rmSync(temp, { recursive: true, force: true }); });

test('browser encrypts all request fields; authenticated creation and admin editing preserve script text', async () => {
    assert.equal((await request(app).get('/api/requirements/transport-key')).status, 401);
    const client = browser(async () => {
        const response = await call('get', '/api/requirements/transport-key');
        assert.equal(response.status, 200);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.body.privateKey, undefined);
        return response.body;
    });
    const description = '<script>alert("需求😀")</script>\nSELECT * FROM Requirements;\n' + '代码示例'.repeat(150000);
    const payload = { title: '脚本反馈', description, category: '全局通用', urgent: true };
    const encrypted = await client.encryptPayload(payload, 'POST', '/api/requirements');
    const wire = JSON.stringify(encrypted);
    assert.ok(!wire.includes('<script>') && !wire.includes('代码示例') && !wire.includes('脚本反馈'));
    const created = await call('post', '/api/requirements', encrypted);
    assert.equal(created.status, 200);
    assert.equal(created.body.success, true);
    assert.equal(loggedBody, '[omitted]');
    const id = created.body.id;
    const stored = await call('get', `/api/requirements/${id}`);
    assert.equal(stored.body.description, description);
    assert.equal(stored.body.urgent, 1);
    const editPath = `/api/requirements/${id}`;
    const edit = await client.encryptPayload({ description: '<script>updated()</script>', remark: 'const x = "修复";' }, 'PUT', editPath);
    assert.equal((await call('put', editPath, edit)).status, 200);
    assert.equal(loggedBody, '[omitted]');
    const updated = (await call('get', editPath)).body;
    assert.equal(updated.description, '<script>updated()</script>');
    assert.equal(updated.logs.at(-1).remark, 'const x = "修复";');
    const reader = browser(() => transport.getPublicConfig({ username: 'reader' }));
    const readerEdit = await reader.encryptPayload({ description: 'unauthorized' }, 'PUT', editPath);
    assert.equal((await call('put', editPath, readerEdit, 'user', 'reader')).status, 403);
    const readerCreate = await reader.encryptPayload(payload, 'POST', '/api/requirements');
    assert.equal((await call('post', '/api/requirements', readerCreate, 'user', 'reader')).status, 200);
});

test('tampering, malformed envelopes, key changes and cross-context replay fail before storage', async () => {
    const countBefore = (await call('get', '/api/requirements')).body.length;
    const client = browser();
    const sealed = await client.encryptPayload({ title: 'valid', category: '全局通用', description: 'original' }, 'POST', '/api/requirements');
    const decrypt = body => transport.decrypt(body, { user, method: 'POST', path: '/api/requirements' });
    const mutate = changes => ({ encryptedPayload: { ...sealed.encryptedPayload, ...changes } });
    const cipher = Buffer.from(sealed.encryptedPayload.ciphertext, 'base64');
    cipher[0] ^= 1;
    for (const invalid of [
        mutate({ ciphertext: cipher.toString('base64') }), mutate({ iv: 'not-base64' }),
        mutate({ encryptedKey: 'AAAA' }), mutate({ version: 99 }), { encryptedPayload: null },
        { ...sealed, description: 'plaintext override' }, mutate({ ciphertext: 'A===' })
    ]) {
        const response = await call('post', '/api/requirements', invalid);
        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'REQUIREMENT_TRANSPORT_INVALID');
        assert.equal(loggedBody, '[omitted]');
    }
    const stale = await call('post', '/api/requirements', mutate({ keyId: 'old-key' }));
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'REQUIREMENT_TRANSPORT_KEY_CHANGED');
    assert.throws(() => runWithTenant('other', () => decrypt(sealed)), /校验失败/);
    assert.throws(() => transport.decrypt(sealed, { user: { username: 'other' }, method: 'POST', path: '/api/requirements' }), /校验失败/);
    assert.throws(() => transport.decrypt(sealed, { user, method: 'PUT', path: '/api/requirements/1' }), /校验失败/);
    assert.throws(() => transport.decrypt(sealed, { user, method: 'POST', path: '/api/requirements/2' }), /校验失败/);
    for (const payload of [[], null, { title: {} }, { description: [] }, { encryptedPayload: {} }]) {
        const invalid = await client.encryptPayload(payload, 'POST', '/api/requirements');
        assert.throws(() => decrypt(invalid), /校验失败/);
    }
    const foreign = await browser(() => runWithTenant('other', () => transport.getPublicConfig(user)))
        .encryptPayload({ title: 'foreign', category: '全局通用' }, 'POST', '/api/requirements');
    assert.throws(() => decrypt(foreign), /校验失败/);
    assert.equal((await call('get', '/api/requirements')).body.length, countBefore);
});

test('existing plain clients remain compatible; encrypted requests retain business validation', async () => {
    const result = await call('post', '/api/requirements', { title: 'legacy', category: '全局通用', description: 'compatible' });
    assert.equal(result.status, 200);
    const path = `/api/requirements/${result.body.id}`;
    assert.equal((await call('put', path, { description: 'legacy update' })).status, 200);
    assert.equal((await call('get', path)).body.description, 'legacy update');
    const invalid = await browser().encryptPayload({ title: '', category: '全局通用' }, 'POST', '/api/requirements');
    const response = await call('post', '/api/requirements', invalid);
    assert.equal(response.status, 400);
    assert.equal(response.body.error, '标题为必填项');
});

test('browser refuses insecure contexts and oversized payloads without a plaintext fallback', async () => {
    const client = browser(() => ({ ...transport.getPublicConfig(user), maxPlaintextBytes: 1 }));
    await assert.rejects(client.encryptPayload({ description: 'too big' }, 'POST', '/api/requirements'), /50 MB/);
    const context = { window: { crypto: {}, addEventListener() {} }, document: { addEventListener() {} } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/requirements.js'), 'utf8'), context);
    await assert.rejects(vm.runInContext('ReqApp.encryptPayload({}, "POST", "/api/requirements")', context), /HTTPS/);
});

function formElements() {
    return {
        reqTitleInput: { value: '前端提交流程' }, reqCategorySelect: { value: '全局通用' },
        reqDescInput: { value: '<script>example()</script> 中文😀' }, reqUrgentInput: { checked: true },
        reqStatusSelect: { value: '提交' }, reqAssigneeInput: { value: 'admin' }, reqRemarkInput: { value: 'const fix = true;' },
        btnSaveReq: { textContent: '保存', disabled: false }
    };
}

test('save action sends encrypted envelopes on both creation and editing', async () => {
    const elements = formElements();
    const writes = [];
    const notices = [];
    const api = {
        get: async () => transport.getPublicConfig(user),
        post: async (url, body) => {
            writes.push({ method: 'post', url, body });
            const response = await call('post', url, body);
            assert.equal(response.status, 200);
            return response.body;
        },
        put: async (url, body) => {
            writes.push({ method: 'put', url, body });
            assert.equal((await call('put', url, body)).status, 200);
        }
    };
    const client = browser(undefined, {
        document: { addEventListener() {}, getElementById: id => elements[id] },
        API: api, showToast: (...args) => notices.push(args)
    });
    let closed = 0;
    client.closeModal = () => closed++;
    client.loadRequirements = async () => {};
    await client.saveReq();
    const id = (await call('get', '/api/requirements')).body[0].id;
    client.currentReqId = id;
    elements.reqDescInput.value = '<script>updatedFromForm()</script>';
    await client.saveReq();
    assert.equal(writes.length, 2);
    assert.equal(writes[0].method, 'post');
    assert.equal(writes[1].method, 'put');
    assert.ok(writes.every(write => Object.keys(write.body).join() === 'encryptedPayload'));
    assert.equal((await call('get', `/api/requirements/${id}`)).body.description, elements.reqDescInput.value);
    assert.equal(elements.btnSaveReq.disabled, false);
    assert.equal(closed, 2);
    assert.ok(notices.every(([, type]) => type === 'success'));
});

test('failed encryption preserves the form and restores the save button without sending plaintext', async () => {
    const elements = formElements();
    let apiCalls = 0;
    const notices = [];
    const client = browser(undefined, {
        window: { crypto: {}, addEventListener() {} },
        document: { addEventListener() {}, getElementById: id => elements[id] },
        API: { get: async () => apiCalls++, post: async () => apiCalls++, put: async () => apiCalls++ },
        showToast: (...args) => notices.push(args)
    });
    client.closeModal = () => assert.fail('Failed submission must keep the form open');
    await client.saveReq();
    assert.equal(apiCalls, 0);
    assert.equal(elements.reqDescInput.value, '<script>example()</script> 中文😀');
    assert.equal(elements.btnSaveReq.disabled, false);
    assert.equal(elements.btnSaveReq.textContent, '保存');
    assert.equal(notices[0][1], 'error');
    assert.match(notices[0][0], /HTTPS/);
});

function chunkClient({ lostChunks = 0, lostCompletions = 0, rejectChunk = false, role = 'admin', username = 'admin' } = {}) {
    const wires = [];
    const headers = { 'Content-Type': 'application/json', 'x-test-user': username, 'x-test-role': role };
    const api = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (url, body) => {
        const size = Buffer.byteLength(body === undefined ? '' : JSON.stringify(body));
        const wireBytes = size + Buffer.byteLength(JSON.stringify(headers) + method.toUpperCase() + url) + 65536;
        assert.ok(size <= 800000 && wireBytes < 1000000, `Gateway envelope ${wireBytes} bytes`);
        wires.push({ method, url, size, dataSize: body?.data?.length, index: body?.index });
        if (url.endsWith('/chunk') && rejectChunk) throw Object.assign(new Error('No permission'), { status: 403, body: { error: 'Permission denied' } });
        const response = await call(method, url, body, role, username);
        if (response.status >= 400) throw Object.assign(new Error(response.body.error), { status: response.status, body: response.body });
        if (url.endsWith('/chunk') && lostChunks-- > 0) throw new TypeError('Lost chunk response');
        if (url.endsWith('/complete') && lostCompletions-- > 0) throw new TypeError('Lost completion response');
        return response.body;
    }]));
    return { client: browser(undefined, { API: api, getAuthHeaders: () => headers }), wires };
}

test('large encrypted create/edit requests use random sub-1MB chunks and safely retry lost replies', async () => {
    const before = (await call('get', '/api/requirements')).body.length;
    const { client, wires } = chunkClient({ lostChunks: 1, lostCompletions: 1 });
    const payload = { title: '随机分块', description: '<script>sample()</script>中文😀'.repeat(70000), category: '全局通用' };
    const progress = [];
    const result = await client.submitPayload(payload, 'POST', '/api/requirements', text => progress.push(text));
    assert.equal(result.success, true);
    assert.equal((await call('get', `/api/requirements/${result.id}`)).body.description, payload.description);
    assert.equal((await call('get', '/api/requirements')).body.length, before + 1);
    const chunks = wires.filter(wire => wire.url.endsWith('/chunk'));
    const uniqueChunks = chunks.filter((wire, index) => chunks.findIndex(item => item.index === wire.index) === index);
    assert.ok(uniqueChunks.length > 3);
    assert.ok(new Set(uniqueChunks.map(wire => wire.dataSize)).size > 2);
    assert.ok(uniqueChunks.slice(0, -1).every(wire => wire.dataSize >= 256 * 1024 && wire.dataSize <= 512 * 1024));
    assert.ok(uniqueChunks.at(-1).dataSize <= 512 * 1024);
    assert.equal(chunks.length, uniqueChunks.length + 1);
    assert.equal(wires.filter(wire => wire.url.endsWith('/complete')).length, 2);
    assert.ok(!wires.some(wire => wire.method === 'post' && wire.url === '/api/requirements'));
    assert.ok(progress.some(text => text.includes('上传分块')));
    const uploadId = wires.find(wire => wire.url.endsWith('/chunk')).url.split('/').at(-2);
    const scratch = path.join(temp, 'tmp/encrypted-requirement-uploads', uploadId);
    assert.equal(fs.existsSync(scratch), false);
    assert.equal((await call('post', `/api/requirements/uploads/${uploadId}/complete`, {})).body.id, result.id);
    assert.equal((await call('get', '/api/requirements')).body.length, before + 1);

    const editPath = `/api/requirements/${result.id}`;
    const updated = { ...payload, description: payload.description + '\nupdated', remark: '<script>remark()</script>' };
    await client.submitPayload(updated, 'PUT', editPath);
    const stored = (await call('get', editPath)).body;
    assert.equal(stored.description, updated.description);
    assert.equal(stored.logs.at(-1).remark, updated.remark);
});

test('after three lost completion responses the same form recovers the receipt without creating another requirement', async () => {
    const before = (await call('get', '/api/requirements')).body.length;
    const { client, wires } = chunkClient({ lostCompletions: 3, role: 'user', username: 'reader' });
    const payload = { title: '找回提交结果', category: '全局通用', description: 'x'.repeat(1100000) };
    await assert.rejects(client.submitPayload(payload, 'POST', '/api/requirements'), /Lost completion/);
    assert.equal((await call('get', '/api/requirements')).body.length, before + 1);
    assert.ok(client.pendingRequirementUpload);
    const starts = wires.filter(wire => wire.url.endsWith('/start')).length;
    const result = await client.submitPayload(payload, 'POST', '/api/requirements');
    assert.equal(result.success, true);
    assert.equal(wires.filter(wire => wire.url.endsWith('/start')).length, starts);
    assert.equal((await call('get', '/api/requirements')).body.length, before + 1);
    assert.equal(client.pendingRequirementUpload, null);
});

test('permanent chunk failures cancel scratch data and do not fall back to plaintext', async () => {
    const { client, wires } = chunkClient({ rejectChunk: true });
    const before = (await call('get', '/api/requirements')).body.length;
    await assert.rejects(client.submitPayload({ title: 'cancel', category: '全局通用', description: 'x'.repeat(1100000) }, 'POST', '/api/requirements'), /No permission/);
    assert.equal(wires.filter(wire => wire.url.endsWith('/chunk')).length, 1);
    assert.equal(wires.filter(wire => wire.method === 'delete').length, 1);
    assert.equal((await call('get', '/api/requirements')).body.length, before);
});

async function manualUpload(payload, { sha256, targetMethod = 'POST', requirementId = null } = {}) {
    const envelope = await browser().encryptPayload(payload, targetMethod, targetMethod === 'POST' ? '/api/requirements' : `/api/requirements/${requirementId}`);
    const serialized = JSON.stringify(envelope);
    const split = Math.floor(serialized.length / 2);
    const parts = [serialized.slice(0, split), serialized.slice(split)];
    const body = { method: targetMethod, requirementId, totalBytes: serialized.length, totalChunks: parts.length,
        sha256: sha256 || crypto.createHash('sha256').update(serialized).digest('hex') };
    const session = uploads.start(body, user);
    return { ...session, parts, body };
}

test('upload sessions isolate users and tenants, reject conflicting blocks, and enforce permissions before assembling', async () => {
    const session = await manualUpload({ title: 'test', category: '全局通用', description: 'script' });
    const block = { index: 0, data: session.parts[0] };
    assert.throws(() => runWithTenant('other', () => uploads.receive(session.uploadId, block, user)), /会话不存在/);
    assert.throws(() => uploads.receive(session.uploadId, block, { username: 'other', role: 'admin' }), /会话不存在/);
    await assert.rejects(uploads.complete(session.uploadId, user, () => assert.fail('Incomplete upload must not save')), /尚未全部接收/);
    uploads.receive(session.uploadId, block, user);
    uploads.receive(session.uploadId, block, user);
    assert.throws(() => uploads.receive(session.uploadId, { ...block, data: 'different' }, user), /内容不一致/);
    assert.throws(() => uploads.receive(session.uploadId, { ...block, index: 99 }, user), /参数无效/);
    assert.throws(() => uploads.receive(session.uploadId, { index: 1, data: 'x'.repeat(512 * 1024 + 1) }, user), /大小无效/);
    const oversize = await call('post', `/api/requirements/uploads/${session.uploadId}/chunk`, { index: 1, data: 'x'.repeat(800001) });
    assert.equal(oversize.status, 413);
    uploads.receive(session.uploadId, { index: 1, data: session.parts[1] }, user);
    let writes = 0;
    const save = async (envelope, target) => {
        writes++;
        assert.equal(transport.decrypt(envelope, { user, method: target.method, path: target.path }).description, 'script');
        return { success: true };
    };
    await Promise.all([uploads.complete(session.uploadId, user, save), uploads.complete(session.uploadId, user, save)]);
    assert.equal(writes, 1);
    const updateSession = await manualUpload({ description: 'new' }, { targetMethod: 'PUT', requirementId: 1 });
    assert.throws(() => uploads.start(updateSession.body, { username: 'reader', role: 'user' }), /没有权限/);
    assert.throws(() => uploads.receive(updateSession.uploadId, { index: 0, data: updateSession.parts[0] }, { username: 'admin', role: 'user' }), /没有权限/);
    uploads.cancel(updateSession.uploadId, user);
    assert.equal((await request(app).post('/api/requirements/uploads/start').send(session.body)).status, 401);
    assert.equal((await call('post', '/api/requirements/uploads/start', updateSession.body, 'user', 'reader')).status, 403);
});

test('bad checksums and plaintext assemblies never save; expired scratch files are removed', async () => {
    const session = await manualUpload({ title: 'bad checksum', category: '全局通用' }, { sha256: '0'.repeat(64) });
    session.parts.forEach((data, index) => uploads.receive(session.uploadId, { index, data }, user));
    await assert.rejects(uploads.complete(session.uploadId, user, () => assert.fail('Bad checksum must not save')), /整包校验失败/);
    assert.equal(fs.existsSync(path.join(temp, 'tmp/encrypted-requirement-uploads', session.uploadId)), false);
    const raw = JSON.stringify({ title: 'plaintext', category: '全局通用' });
    const plain = uploads.start({ method: 'POST', totalBytes: Buffer.byteLength(raw), totalChunks: 1, sha256: crypto.createHash('sha256').update(raw).digest('hex') }, user);
    uploads.receive(plain.uploadId, { index: 0, data: raw }, user);
    await assert.rejects(uploads.complete(plain.uploadId, user, () => assert.fail('Plaintext must not save')), /必须使用加密/);
    const expired = await manualUpload({ title: 'expired', category: '全局通用' });
    uploads.receive(expired.uploadId, { index: 0, data: expired.parts[0] }, user);
    const dir = path.join(temp, 'tmp/encrypted-requirement-uploads', expired.uploadId);
    assert.ok(fs.existsSync(dir));
    const now = Date.now;
    try {
        Date.now = () => now() + 16 * 60 * 1000;
        uploads.cleanup();
        assert.equal(fs.existsSync(dir), false);
        assert.throws(() => uploads.receive(expired.uploadId, { index: 1, data: expired.parts[1] }, user), /会话不存在或已过期/);
    } finally { Date.now = now; }
});
