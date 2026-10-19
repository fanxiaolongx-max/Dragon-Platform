const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../home-promo-videos.json');

let desktopFetch;
function configurePromoVideoFetch(fetchImpl) { desktopFetch = fetchImpl; }
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function waitForDrain(res) {
    return new Promise(resolve => {
        const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
        res.once('drain', done);
        res.once('close', done);
    });
}

function parseRange(header, size) {
    if (!header) return { start: 0, end: size - 1, partial: false };
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2])) return null;
    const suffix = !match[1];
    const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
    const end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || (suffix && Number(match[2]) === 0)) return null;
    return { start, end, partial: true };
}

function createDownloadQueue(limit) {
    let active = 0;
    const queue = [];
    function pump() {
        while (active < limit && queue.length) {
            const task = queue.shift();
            active++;
            Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => { active--; pump(); });
        }
    }
    return (run, foreground) => new Promise((resolve, reject) => {
        const task = { run, resolve, reject };
        // Foreground playback/seek takes precedence over background completion.
        if (foreground) queue.unshift(task); else queue.push(task);
        pump();
    });
}

function createPromoVideoMiddleware(options = {}) {
    const catalog = options.manifest || manifest;
    const env = options.env || process.env;
    const root = options.root || path.resolve(__dirname, '../..');
    const cacheDir = options.cacheDir || env.TOOLS_PROMO_CACHE_DIR
        || path.join(env.TOOLS_DATA_DIR || path.join(root, 'backend/data'), 'cache/home-videos');
    const localDir = options.localDir === undefined ? path.join(root, 'frontend/assets/promotions') : options.localDir;
    const preferLocal = options.preferLocal === undefined ? env.TOOLS_DESKTOP_RUNTIME !== '1' : options.preferLocal;
    const fetchImpl = options.fetchImpl || ((url, init) => (desktopFetch || globalThis.fetch)(url, init));
    const runDownload = createDownloadQueue(options.concurrency || 3);
    const pending = new Map();
    const warming = new Map();
    const resolvedUrls = new Map();
    const timeoutMs = options.timeoutMs || 30000;

    function chunkPath(asset, index) {
        // Shared public product videos only; never store tenant/user media here.
        return path.join(cacheDir, asset.sha256, `${index}.chunk`);
    }
    async function cachedChunk(asset, index) {
        try {
            const bytes = await fsp.readFile(chunkPath(asset, index));
            if (sha256(bytes) === asset.chunks[index]) return bytes;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        return null;
    }
    async function downloadChunk(name, asset, index) {
        const start = index * catalog.chunkSize;
        const end = Math.min(asset.size - 1, start + catalog.chunkSize - 1);
        const original = asset.url || `${catalog.baseUrl}/${encodeURIComponent(name)}`;
        const cachedUrl = resolvedUrls.get(name);
        const url = cachedUrl && cachedUrl.until > Date.now() ? cachedUrl.url : original;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetchImpl(url, {
                headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
                signal: controller.signal, redirect: 'follow', credentials: 'omit'
            });
            if (url !== original && !response.ok) {
                await response.body?.cancel();
                resolvedUrls.delete(name);
                response = await fetchImpl(original, {
                    headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
                    signal: controller.signal, redirect: 'follow', credentials: 'omit'
                });
            }
            if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${asset.size}`) {
                throw new Error('Video source did not return the requested byte range');
            }
            const parts = [];
            let length = 0;
            for await (const part of response.body) {
                length += part.length;
                if (length > end - start + 1) throw new Error('Video chunk exceeds its expected size');
                parts.push(Buffer.from(part));
            }
            const bytes = Buffer.concat(parts);
            if (bytes.length !== end - start + 1 || sha256(bytes) !== asset.chunks[index]) {
                throw new Error('Video chunk failed integrity verification');
            }
            if (response.url && response.url !== original) resolvedUrls.set(name, { url: response.url, until: Date.now() + 300000 });
            const target = chunkPath(asset, index);
            const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
            try {
                await fsp.mkdir(path.dirname(target), { recursive: true });
                await fsp.writeFile(temporary, bytes);
                await fsp.rename(temporary, target);
            } finally { await fsp.rm(temporary, { force: true }); }
            return bytes;
        } catch (error) {
            // Also abort a stalled/invalid response body; never log signed URLs.
            controller.abort();
            throw error;
        } finally { clearTimeout(timer); }
    }
    async function getChunk(name, asset, index, foreground = true) {
        const existing = await cachedChunk(asset, index);
        if (existing) return existing;
        const key = `${asset.sha256}:${index}`;
        if (!pending.has(key)) {
            const job = runDownload(() => downloadChunk(name, asset, index), foreground)
                .finally(() => pending.delete(key));
            pending.set(key, job);
        }
        return pending.get(key);
    }
    function warm(name, asset) {
        if (options.background === false || warming.has(name)) return;
        const job = (async () => {
            for (let index = 0; index < asset.chunks.length; index++) await getChunk(name, asset, index, false);
        })().catch(() => { /* Playback reports its own failure. A later request can resume missing chunks. */ })
            .finally(() => warming.delete(name));
        warming.set(name, job);
    }

    const middleware = async (req, res, next) => {
        const match = /^\/assets\/promotions\/([a-z0-9-]+\.mp4)$/.exec(req.path);
        const name = match?.[1];
        const asset = name && Object.hasOwn(catalog.assets, name) ? catalog.assets[name] : null;
        if (!asset || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        if (preferLocal && localDir && fs.existsSync(path.join(localDir, name))) {
            return res.sendFile(path.join(localDir, name), error => { if (error) next(error); });
        }
        const etag = `"${asset.sha256}"`;
        res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4',
            'Cache-Control': 'public, max-age=0, must-revalidate', ETag: etag });
        if (req.headers['if-none-match'] === etag) return res.status(304).end();
        // If-Range mismatch means send the complete current representation.
        const range = parseRange(req.headers['if-range'] && req.headers['if-range'] !== etag ? null : req.headers.range, asset.size);
        if (!range) return res.status(416).set('Content-Range', `bytes */${asset.size}`).end();
        res.status(range.partial ? 206 : 200);
        res.set('Content-Length', String(range.end - range.start + 1));
        if (range.partial) res.set('Content-Range', `bytes ${range.start}-${range.end}/${asset.size}`);
        if (req.method === 'HEAD') return res.end();
        try {
            const first = Math.floor(range.start / catalog.chunkSize);
            const last = Math.floor(range.end / catalog.chunkSize);
            for (let index = first; index <= last; index++) {
                if (res.destroyed) return;
                const bytes = await getChunk(name, asset, index);
                if (res.destroyed) return;
                const offset = index * catalog.chunkSize;
                const slice = bytes.subarray(Math.max(0, range.start - offset), Math.min(bytes.length, range.end - offset + 1));
                if (!res.write(slice)) {
                    await waitForDrain(res);
                    if (res.destroyed) return;
                }
                // Only the requested version is completed in the background.
                if (index === first) warm(name, asset);
            }
            res.end();
        } catch (_) {
            if (res.destroyed) return;
            if (res.headersSent) return res.destroy();
            res.removeHeader('Content-Range');
            res.removeHeader('Content-Length');
            res.removeHeader('ETag');
            res.set('Cache-Control', 'no-store').type('json').status(502).json({ success: false,
                code: 'PROMO_VIDEO_UNAVAILABLE', error: 'Video is temporarily unavailable', requestId: req.requestId });
        }
    };
    middleware.waitForIdle = async () => { while (warming.size || pending.size) await Promise.allSettled([...warming.values(), ...pending.values()]); };
    return middleware;
}

module.exports = { configurePromoVideoFetch, createPromoVideoMiddleware, parseRange };
