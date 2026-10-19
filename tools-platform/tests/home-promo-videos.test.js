const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const express = require('express');
const picomatch = require('picomatch');
const { createPromoVideoMiddleware, parseRange } = require('../backend/models/home-promo-videos');
const { checkManifest } = require('../scripts/prepare-home-promo-videos');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const chunkSize = 32768;
const bytes = crypto.randomBytes(chunkSize * 3 + 71);
const name = 'platform-guide-hd.mp4';
const asset = { size: bytes.length, sha256: digest(bytes), chunks: [] };
for (let start = 0; start < bytes.length; start += chunkSize) asset.chunks.push(digest(bytes.subarray(start, start + chunkSize)));
const manifest = { baseUrl: 'https://example.test/videos', chunkSize, assets: { [name]: asset } };
const urlPath = `/assets/promotions/${name}`;

async function fixture(t, options = {}) {
    const cacheDir = options.cacheDir || await fs.mkdtemp(path.join(os.tmpdir(), 'home-promo-test-'));
    const requests = [];
    const fetchImpl = options.fetchImpl || (async (url, init) => {
        requests.push({ url, range: init.headers.Range });
        const range = parseRange(init.headers.Range, bytes.length);
        return new Response(bytes.subarray(range.start, range.end + 1), { status: 206,
            headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } });
    });
    const middleware = createPromoVideoMiddleware({ manifest, cacheDir, localDir: null, fetchImpl, background: false, ...options });
    const app = express();
    app.use(middleware);
    app.use((_req, res) => res.status(404).end());
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
        await middleware.waitForIdle();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        if (!options.cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
    });
    return { cacheDir, requests, middleware, get: (headers = {}, route = urlPath, method = 'GET') => fetch(base + route, { method, headers }) };
}

test('all 16 source videos match the frozen manifest and have fast-start metadata; only these are excluded from desktop builds', () => {
    const catalog = checkManifest();
    const { build } = require('../package.json');
    const excluded = picomatch(build.files.filter(item => item.startsWith('!')).map(item => item.slice(1)), { dot: true });
    assert.equal(Object.keys(catalog.assets).length, 16);
    for (const file of Object.keys(catalog.assets)) assert.ok(excluded(`frontend/assets/promotions/${file}`), file);
    assert.equal(excluded('frontend/assets/promotions/future-guide.mp4'), false);
    assert.equal(excluded('frontend/assets/promotions/eos-report-guide-en-poster.jpg'), false);
    assert.equal(excluded('frontend/assets/promotions/eos-report-guide-poster.jpg'), false);
    assert.equal(excluded('frontend/assets/promotions/platform-guide-poster.jpg'), false);
});

test('suffix, bounded, open-ended and unsatisfiable ranges', () => {
    assert.deepEqual(parseRange('bytes=20-999', 100), { start: 20, end: 99, partial: true });
    assert.deepEqual(parseRange('bytes=-12', 100), { start: 88, end: 99, partial: true });
    assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99, partial: true });
    for (const header of ['bytes=100-', 'bytes=4-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=NaN-']) assert.equal(parseRange(header, 100), null, header);
});

test('HEAD, 304, invalid ranges and unregistered assets do not initiate any download', async t => {
    const app = await fixture(t);
    const head = await app.get({}, urlPath, 'HEAD');
    assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(bytes.length));
    const invalid = await app.get({ Range: 'bytes=999999-' });
    assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.length}`);
    assert.equal((await app.get({ 'If-None-Match': `"${asset.sha256}"` })).status, 304);
    assert.equal((await app.get({}, '/assets/promotions/future-guide.mp4')).status, 404);
    assert.equal((await app.get({}, '/assets/promotions/constructor')).status, 404);
    assert.equal(app.requests.length, 0);
});

test('EOS can stream from a separate release without moving the original video sources', async t => {
    const eosName = 'eos-report-guide-hd.mp4';
    const eosUrl = `https://example.test/eos-release/${eosName}`;
    const app = await fixture(t, { manifest: { ...manifest, assets: { ...manifest.assets, [eosName]: { ...asset, url: eosUrl } } } });
    const eos = await app.get({ Range: 'bytes=0-20' }, `/assets/promotions/${eosName}`);
    assert.equal(eos.status, 206);
    assert.deepEqual(Buffer.from(await eos.arrayBuffer()), bytes.subarray(0, 21));
    assert.equal(app.requests[0].url, eosUrl);
    // A different chunk forces a request for the original video source.
    const original = await app.get({ Range: `bytes=${chunkSize}-${chunkSize + 20}` });
    assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes.subarray(chunkSize, chunkSize + 21));
    assert.equal(app.requests[1].url, `${manifest.baseUrl}/${name}`);
});

test('arbitrary seek across chunks returns exact bytes, range metadata and reusable disk chunks', async t => {
    const app = await fixture(t);
    const response = await app.get({ Range: `bytes=${chunkSize - 11}-${chunkSize + 23}` });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-range'), `bytes ${chunkSize - 11}-${chunkSize + 23}/${bytes.length}`);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(chunkSize - 11, chunkSize + 24));
    assert.equal(app.requests.length, 2);
    const again = await app.get({ Range: 'bytes=0-20' });
    assert.deepEqual(Buffer.from(await again.arrayBuffer()), bytes.subarray(0, 21));
    assert.equal(app.requests.length, 2);
});

test('first bytes reach the player while later chunks are still downloading', async t => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const app = await fixture(t, { fetchImpl: async (_url, init) => {
        const range = parseRange(init.headers.Range, bytes.length);
        if (range.start > 0) await gate;
        return new Response(bytes.subarray(range.start, range.end + 1), { status: 206,
            headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } });
    } });
    const response = await app.get();
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.ok(first.value.length > 0 && first.value.length <= chunkSize);
    assert.deepEqual(Buffer.from(first.value), bytes.subarray(0, first.value.length));
    release();
    const received = [Buffer.from(first.value)];
    while (true) { const part = await reader.read(); if (part.done) break; received.push(Buffer.from(part.value)); }
    assert.deepEqual(Buffer.concat(received), bytes);
});

test('a requested version finishes caching in background and a fresh process can serve it offline', async t => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'home-promo-offline-'));
    t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
    const first = await fixture(t, { cacheDir, background: true });
    const peek = await first.get({ Range: 'bytes=0-1' });
    assert.deepEqual(Buffer.from(await peek.arrayBuffer()), bytes.subarray(0, 2));
    await first.middleware.waitForIdle();
    assert.equal(first.requests.length, asset.chunks.length);
    const offline = await fixture(t, { cacheDir, fetchImpl: async () => { throw new Error('Offline'); } });
    const response = await offline.get();
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const suffix = await offline.get({ Range: 'bytes=-20' });
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-20));
});

test('parallel requests share each in-flight chunk', async t => {
    const app = await fixture(t);
    const responses = await Promise.all(Array.from({ length: 8 }, () => app.get({ Range: 'bytes=1-99' })));
    for (const response of responses) assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(1, 100));
    assert.equal(app.requests.length, 1);
});

test('corrupt disk chunks are repaired and chunks from different content versions are isolated', async t => {
    const app = await fixture(t);
    await fs.mkdir(path.join(app.cacheDir, asset.sha256), { recursive: true });
    await fs.writeFile(path.join(app.cacheDir, asset.sha256, '0.chunk'), 'corrupt');
    await fs.mkdir(path.join(app.cacheDir, 'old-version'), { recursive: true });
    await fs.writeFile(path.join(app.cacheDir, 'old-version', '0.chunk'), 'old');
    const response = await app.get({ Range: 'bytes=0-10' });
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(0, 11));
    assert.equal(app.requests.length, 1);
    assert.deepEqual(await fs.readFile(path.join(app.cacheDir, asset.sha256, '0.chunk')), bytes.subarray(0, chunkSize));
    assert.equal(await fs.readFile(path.join(app.cacheDir, 'old-version', '0.chunk'), 'utf8'), 'old');
});

test('wrong range responses, truncated data and checksum mismatch fail without caching; retry can recover', async t => {
    for (const failure of ['whole-file', 'wrong-range', 'truncated', 'checksum']) {
        let failed = true;
        const app = await fixture(t, { fetchImpl: async (_url, init) => {
            const range = parseRange(init.headers.Range, bytes.length);
            const chunk = bytes.subarray(range.start, range.end + 1);
            if (!failed) return new Response(chunk, { status: 206, headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } });
            return new Response(failure === 'truncated' ? chunk.subarray(1) : failure === 'checksum' ? Buffer.alloc(chunk.length) : chunk,
                { status: failure === 'whole-file' ? 200 : 206,
                    headers: { 'Content-Range': failure === 'wrong-range' ? 'bytes 1-3/9' : `bytes ${range.start}-${range.end}/${bytes.length}` } });
        } });
        const response = await app.get({ Range: 'bytes=0-10' });
        assert.equal(response.status, 502, failure);
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.equal((await response.json()).code, 'PROMO_VIDEO_UNAVAILABLE');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('content-range'), null);
        assert.deepEqual(await fs.readdir(app.cacheDir), []);
        failed = false;
        const retry = await app.get({ Range: 'bytes=0-10' });
        assert.equal(retry.status, 206);
        assert.deepEqual(Buffer.from(await retry.arrayBuffer()), bytes.subarray(0, 11));
    }
});

test('stalled remote download times out and releases the slot', async t => {
    const app = await fixture(t, { timeoutMs: 30, fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }) });
    assert.equal((await app.get({ Range: 'bytes=0-10' })).status, 502);
    assert.equal((await app.get({ Range: 'bytes=0-10' })).status, 502);
});

test('If-Range version mismatch sends current complete representation', async t => {
    const app = await fixture(t);
    const response = await app.get({ Range: 'bytes=0-10', 'If-Range': '"old"' });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-range'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('expired GitHub redirect URLs are refreshed without persisting signed URLs', async t => {
    const urls = [];
    const app = await fixture(t, { fetchImpl: async (url, init) => {
        urls.push(url);
        if (url.includes('signed.test')) return new Response('Expired', { status: 403 });
        const range = parseRange(init.headers.Range, bytes.length);
        const response = new Response(bytes.subarray(range.start, range.end + 1), { status: 206,
            headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } });
        Object.defineProperty(response, 'url', { value: 'https://signed.test/temporary-url' });
        return response;
    } });
    await (await app.get({ Range: 'bytes=0-10' })).arrayBuffer();
    await (await app.get({ Range: `bytes=${chunkSize}-${chunkSize + 10}` })).arrayBuffer();
    assert.deepEqual(urls, [`${manifest.baseUrl}/${name}`, 'https://signed.test/temporary-url', `${manifest.baseUrl}/${name}`]);
    assert.ok((await fs.readdir(path.join(app.cacheDir, asset.sha256))).every(file => /^\d+\.chunk$/.test(file)));
});

test('download concurrency remains bounded across independent chunks', async t => {
    let active = 0, maximum = 0;
    const app = await fixture(t, { concurrency: 2, fetchImpl: async (_url, init) => {
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 15));
        const range = parseRange(init.headers.Range, bytes.length);
        active--;
        return new Response(bytes.subarray(range.start, range.end + 1), { status: 206,
            headers: { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}` } });
    } });
    await Promise.all(asset.chunks.map(async (_, index) => {
        const response = await app.get({ Range: `bytes=${index * chunkSize}-${index * chunkSize}` });
        await response.arrayBuffer();
    }));
    assert.equal(maximum, 2);
});
