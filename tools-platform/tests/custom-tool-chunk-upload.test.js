const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-chunk-test-'));
process.env.TOOLS_DATA_DIR = temp;
const uploads = require('../backend/models/custom-tool-chunk-upload');
const repo = require('../backend/models/custom-tools-repository');
const db = require('../backend/models/app-db');
const { runWithTenant } = require('../backend/models/tenant-context');
const createRouter = require('../backend/routes/custom-tool-chunk-upload');

test.after(async () => { await db.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true }); });

function makeSession(payload, shaOverride) {
    const bytes = Buffer.from(JSON.stringify(payload));
    const key = crypto.randomBytes(32);
    const encryptedKey = crypto.publicEncrypt({ key: crypto.createPublicKey({ key: Buffer.from(uploads.getPublicKey(), 'base64'), type: 'spki', format: 'der' }), oaepHash: 'sha256' }, key).toString('base64');
    const session = uploads.start({ totalBytes: bytes.length, totalChunks: Math.ceil(bytes.length / uploads.CHUNK_BYTES),
        sha256: shaOverride || crypto.createHash('sha256').update(bytes).digest('hex'), encryptedKey, importRequestId: payload.importRequestId }, 'admin');
    function chunk(index) {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(Buffer.from(`${session.uploadId}:${index}:${session.totalChunks}`));
        const plain = bytes.subarray(index * uploads.CHUNK_BYTES, (index + 1) * uploads.CHUNK_BYTES);
        return { index, iv: iv.toString('base64'), ciphertext: Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString('base64') };
    }
    return { ...session, chunk };
}

test('encrypted chunks authenticate content, reject missing blocks and isolate tenants/users', async () => {
    const payload = { importRequestId: '1'.repeat(32), name: 'Chunk test', htmlContent: '<html>' + 'x'.repeat(600000) + '</html>' };
    const session = makeSession(payload);
    const block = session.chunk(0);
    assert.ok(Buffer.byteLength(JSON.stringify(block)) + 65536 < 1000000);
    assert.throws(() => runWithTenant('other', () => uploads.receive(session.uploadId, block, 'admin')), /会话不存在/);
    assert.throws(() => uploads.receive(session.uploadId, block, 'other-user'), /会话不存在/);
    const tampered = { ...block, ciphertext: Buffer.alloc(uploads.CHUNK_BYTES + 16).toString('base64') };
    assert.throws(() => uploads.receive(session.uploadId, tampered, 'admin'), /解密或完整性/);
    assert.throws(() => uploads.receive(session.uploadId, { ...block, index: 99 }, 'admin'), /序号/);
    assert.throws(() => uploads.receive(session.uploadId, { ...block, padding: 'x'.repeat(900000) }, 'admin'), /大小限制/);
    uploads.receive(session.uploadId, block, 'admin');
    assert.equal(uploads.receive(session.uploadId, block, 'admin').receivedChunks, 1);
    await assert.rejects(uploads.complete(session.uploadId, 'admin', repo.createTool), /尚未全部接收/);
    uploads.receive(session.uploadId, session.chunk(1), 'admin');
    const tool = await uploads.complete(session.uploadId, 'admin', repo.createTool);
    const repeat = await uploads.complete(session.uploadId, 'admin', repo.createTool);
    assert.equal(repeat.slug, tool.slug);
    assert.equal((await repo.createTool(payload)).slug, tool.slug);
    assert.equal(fs.readFileSync(path.join(temp, 'custom-tools', tool.slug, 'index.html'), 'utf8'), payload.htmlContent);
    await assert.rejects(repo.createTool({ ...payload, name: 'Changed' }), /其他内容/);
    // The same operation id is independent in another tenant.
    await runWithTenant('other', async () => {
        const otherTool = await repo.createTool(payload);
        assert.ok(fs.existsSync(path.join(temp, 'tenants/other/custom-tools', otherTool.slug, 'index.html')));
    });
    uploads.cancel(session.uploadId, 'admin');
    assert.throws(() => uploads.receive(session.uploadId, block, 'admin'), /会话不存在/);
});

test('chunk routes require admin permissions', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { username: 'reader', role: 'user' }; next(); });
    app.use(createRouter(repo.createTool));
    assert.equal((await request(app).get('/key')).status, 403);
    assert.equal((await request(app).post('/start').send({})).status, 403);
});

test('chunk completion validates the whole payload and imports ZIP assets', async () => {
    const payload = { importRequestId: '2'.repeat(32), name: 'Bad checksum', htmlContent: '<html>test</html>' };
    const bad = makeSession(payload, '0'.repeat(64));
    uploads.receive(bad.uploadId, bad.chunk(0), 'admin');
    await assert.rejects(uploads.complete(bad.uploadId, 'admin', repo.createTool), /文件校验失败/);
    assert.throws(() => uploads.receive(bad.uploadId, bad.chunk(0), 'admin'), /会话不存在/);
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('index.html', '<html><script src="app.js"></script></html>');
    zip.file('app.js', 'window.chunkZipReady = true;');
    const zipped = makeSession({ importRequestId: '3'.repeat(32), name: 'ZIP chunks', archiveBase64: await zip.generateAsync({ type: 'base64' }) });
    uploads.receive(zipped.uploadId, zipped.chunk(0), 'admin');
    const tool = await uploads.complete(zipped.uploadId, 'admin', repo.createTool);
    assert.equal(fs.readFileSync(path.join(temp, 'custom-tools', tool.slug, 'app.js'), 'utf8'), 'window.chunkZipReady = true;');
    uploads.cancel(zipped.uploadId, 'admin');
});

test('expired upload sessions remove scratch files and require a fresh upload', () => {
    const session = makeSession({ importRequestId: '4'.repeat(32), name: 'Expired', htmlContent: '<html>test</html>' });
    uploads.receive(session.uploadId, session.chunk(0), 'admin');
    const dir = path.join(temp, 'tmp/encrypted-tool-imports', session.uploadId);
    assert.ok(fs.existsSync(dir));
    const now = Date.now;
    try {
        Date.now = () => now() + 16 * 60 * 1000;
        assert.throws(() => uploads.receive(session.uploadId, session.chunk(0), 'admin'), /会话不存在或已过期/);
        assert.equal(fs.existsSync(dir), false);
    } finally { Date.now = now; }
});

test('a transient import failure can retry completion without uploading the chunks again', async () => {
    const payload = { importRequestId: '5'.repeat(32), name: 'Retry completion', htmlContent: '<html>retry</html>' };
    const session = makeSession(payload);
    uploads.receive(session.uploadId, session.chunk(0), 'admin');
    await assert.rejects(uploads.complete(session.uploadId, 'admin', async () => {
        throw Object.assign(new Error('Database temporarily busy'), { status: 503 });
    }), /temporarily busy/);
    const tool = await uploads.complete(session.uploadId, 'admin', repo.createTool);
    assert.equal(tool.name, payload.name);
    uploads.cancel(session.uploadId, 'admin');
});

test('browser fallback imports a 10.5 MB HTML with sub-1MB encrypted requests and retries a lost chunk reply', async () => {
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, _res, next) => { req.user = { username: 'admin', role: 'admin' }; next(); });
    // Simulate a gateway rejecting the direct request.
    app.post('/api/custom-tools', (_req, res) => res.status(413).json({ error: 'gateway limit' }));
    app.use('/api/custom-tools/import-upload', createRouter(repo.createTool));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const logs = [];
    const bodies = [];
    let lostReply = false;
    const context = {
        window: {}, document: { documentElement: { lang: 'zh' } }, TextEncoder, Uint8Array,
        crypto: crypto.webcrypto, atob, btoa, performance, setTimeout, clearTimeout, AbortController,
        getAuthHeaders: () => ({ 'Content-Type': 'application/json' }),
        handleResponse: async res => { const body = await res.json(); if (!res.ok) throw Object.assign(new Error(body.error), { status: res.status }); return body; },
        fetch: async (url, options) => {
            if (url.includes('/import-upload/')) {
                const size = Buffer.byteLength(options.body || '') + Buffer.byteLength(JSON.stringify(options.headers) + url + options.method) + 65536;
                assert.ok(size < 1000000, `wire envelope ${size}`);
                bodies.push(size);
            }
            const response = await fetch(origin + url, options);
            if (url.endsWith('/chunk') && !lostReply) { lostReply = true; await response.arrayBuffer(); throw new TypeError('lost reply'); }
            return response;
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/custom-tool-upload.js'), 'utf8'), context);
    try {
        const htmlContent = '<html>' + 'x'.repeat(Math.round(10.5 * 1024 * 1024)) + '</html>';
        const result = await context.window.CustomToolUpload.upload({ name: 'Browser chunk test', htmlContent }, { onProgress: entry => logs.push(entry) });
        assert.equal(result.success, true);
        assert.equal(fs.readFileSync(path.join(temp, 'custom-tools', result.tool.slug, 'index.html'), 'utf8'), htmlContent);
        assert.ok(bodies.length > 20);
        assert.ok(logs.some(entry => entry.message.includes('重试')));
        assert.equal(logs.at(-1).percent, 100);
        assert.ok(logs.every(entry => !entry.message.includes('<html>')));
    } finally { await new Promise(resolve => server.close(resolve)); }
});
