const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-chunks-'));
process.env.TOOLS_DATA_DIR = sandbox;
const db = require('../backend/models/app-db');
const repo = require('../backend/models/topic-snapshots-repository');
const router = require('../backend/routes/topic-snapshots');
const createChunkRouter = require('../backend/routes/custom-tool-chunk-upload');
const { requireAdmin } = require('../backend/middleware/auth');
const { runWithTenant } = require('../backend/models/tenant-context');

let server, origin;
test.before(async () => {
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use((req, res, next) => {
        req.user = { username: req.get('x-test-user') || 'admin', role: req.get('x-test-role') || 'admin' };
        runWithTenant(req.get('x-test-tenant') || 'default', () => req.method === 'GET' ? next() : requireAdmin(req, res, next));
    });
    app.use('/api/topic-snapshots', router);
    app.use('/api/custom-tools/import-upload', createChunkRouter(() => { throw new Error('Wrong importer reached'); }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

function client({ role = 'admin', gateway403 = false } = {}) {
    const calls = [], logs = [];
    const context = { window: {}, document: { documentElement: { lang: 'zh' } }, crypto: crypto.webcrypto,
        TextEncoder, Uint8Array, atob, btoa, performance, AbortController, setTimeout, clearTimeout,
        getAuthHeaders: () => ({ 'Content-Type': 'application/json', 'x-test-role': role }),
        handleResponse: async res => {
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body });
            return body;
        },
        fetch: async (url, options) => {
            calls.push({ url, options });
            if (url.includes('/import-upload/')) {
                assert.ok(Buffer.byteLength(options.body || '') + Buffer.byteLength(JSON.stringify(options.headers) + url) + 65536 < 1000000);
            }
            if (gateway403 && url === '/api/topic-snapshots') return new Response('<html>Gateway rejected request</html>', { status: 403 });
            return fetch(origin + url, options);
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/custom-tool-upload.js'), 'utf8'), context);
    return { calls, logs, upload: (payload, chunkAboveBytes = 800000) => context.window.EncryptedChunkUpload.upload(payload,
        { endpoint: '/api/topic-snapshots', chunkAboveBytes, onProgress: entry => logs.push(entry) }) };
}

function snapshot(platform) {
    return { schema: 'uivf12-topic-snapshot', version: 1, platform,
        capturedAt: '2026-10-01T09:00:00.000Z', exportedAt: '2026-10-01T10:00:00.000Z',
        data: platform === 'netcare'
            ? { certificate: [], eosProduct: [], eosVersion: [], change: { rows: [] }, interception: { rows: [] }, sr: { summary: [], monthly: [] } }
            : { months: [], detail: [] },
        // Include multibyte text to exercise byte-based splitting and decoding.
        note: '专题 JSON 数据。'.repeat(65000) };
}

test('large NetCare/DataFab JSON uses encrypted chunks first and preserves original response and data', async () => {
    for (const platform of ['netcare', 'datafab']) {
        const data = snapshot(platform);
        const browser = client();
        const result = await browser.upload({ snapshot: data });
        assert.equal(browser.calls[0].url, '/api/topic-snapshots/import-upload/key');
        assert.equal(result.created, true);
        assert.equal(result.item.platform, platform);
        assert.ok(result.message);
        assert.equal((await repo.getSnapshot(result.item.id)).snapshot.note, data.note);
        const repeated = await browser.upload({ snapshot: data });
        assert.equal(repeated.created, false);
        assert.equal(repeated.item.id, result.item.id);
        assert.equal(browser.logs.at(-1).percent, 100);

        const chunk = browser.calls.find(call => call.url.endsWith('/chunk'));
        const replay = await fetch(origin + chunk.url.replace('/topic-snapshots/', '/custom-tools/'), chunk.options);
        assert.equal(replay.status, 404); // Cannot feed a topic session to another importer.
        for (const headers of [{ 'x-test-tenant': 'other' }, { 'x-test-user': 'another-admin' }]) {
            const denied = await fetch(origin + chunk.url, { ...chunk.options, headers: { ...chunk.options.headers, ...headers } });
            assert.equal(denied.status, 404);
        }
    }
});

test('opaque gateway 403 switches to chunks; real permission 403 remains a permission error', async () => {
    const browser = client({ gateway403: true });
    const result = await browser.upload({ snapshot: snapshot('netcare') }, Infinity);
    assert.equal(result.item.platform, 'netcare');
    assert.ok(browser.calls.some(call => call.url.endsWith('/chunk')));
    const denied = client({ role: 'user' });
    await assert.rejects(denied.upload({ snapshot: { ...snapshot('netcare'), note: '' } }), error => error.status === 403 && /权限不足/.test(error.message));
    assert.equal(denied.calls.length, 1);
    const largeDenied = client({ role: 'user' });
    await assert.rejects(largeDenied.upload({ snapshot: snapshot('netcare') }), error => error.status === 403);
    assert.equal(largeDenied.calls.length, 1);
});

test('merged topic payload still uses the original snapshot validation', async () => {
    const browser = client();
    await assert.rejects(browser.upload({ snapshot: { ...snapshot('datafab'), schema: 'invalid' } }),
        error => error.status === 400 && error.body.code === 'INVALID_TOPIC_SNAPSHOT');
});
