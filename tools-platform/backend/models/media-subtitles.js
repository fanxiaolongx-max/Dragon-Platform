const crypto = require('crypto');
const dns = require('dns').promises;
const https = require('https');
const net = require('net');

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CUES = 20000;
const CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map();
const pending = new Map();
let cacheBytes = 0;

// Subtitle URLs come from the provider, never from the browser. Pin public DNS
// answers for each request and revalidate redirects before downloading.
function isPublicAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
            (a === 198 && (b === 18 || b === 19)));
    }
    // Only globally routable IPv6 unicast; mapped IPv4 and local ranges fail closed.
    return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}

async function downloadSubtitle(rawUrl, redirects = 0) {
    const url = new URL(rawUrl);
    if (url.protocol === 'http:' && (url.hostname === 'shooter.cn' || url.hostname.endsWith('.shooter.cn'))) url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new Error('Invalid subtitle URL');
    }
    const records = await dns.lookup(url.hostname, { all: true });
    if (!records.length || records.some(record => !isPublicAddress(record.address))) throw new Error('Invalid subtitle host');
    const pinned = records[0];
    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            agent: false,
            lookup: (_hostname, options, callback) => callback(null, options?.all ? [pinned] : pinned.address, pinned.family),
            headers: { 'User-Agent': 'ToolsCinema/1.0', 'Accept-Encoding': 'identity' },
            signal: AbortSignal.timeout(10000)
        }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                if (redirects >= 3 || !response.headers.location) return reject(new Error('Invalid subtitle redirect'));
                return resolve(downloadSubtitle(new URL(response.headers.location, url).href, redirects + 1));
            }
            if (response.statusCode !== 200 || Number(response.headers['content-length']) > MAX_BYTES) {
                response.destroy();
                return reject(new Error('Subtitle download failed'));
            }
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_BYTES) response.destroy(new Error('Subtitle too large'));
                else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });
        request.on('error', reject);
    });
}

async function shooterHash(size, readRange) {
    if (!Number.isSafeInteger(size) || size < 8192) return '';
    const hashes = [];
    for (const offset of [4096, Math.floor(size / 3) * 2, Math.floor(size / 3), size - 8192]) {
        const data = await readRange(offset, 4096);
        if (data.length !== 4096) throw new Error('Incomplete media range');
        hashes.push(crypto.createHash('md5').update(data).digest('hex'));
    }
    return hashes.join(';');
}

function decodeSubtitle(buffer) {
    if (buffer.length > MAX_BYTES) throw new Error('Subtitle too large');
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
    if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch (_) { return new TextDecoder('gb18030').decode(buffer); }
}

function cueTime(value) {
    const match = String(value).trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return NaN;
    return ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4].padEnd(3, '0'));
}

function plainCue(value) {
    return value.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim();
}

function parseSubtitle(buffer, extension, delay = 0) {
    const text = decodeSubtitle(buffer).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const cues = [];
    function add(startValue, endValue, raw) {
        const start = Math.max(0, cueTime(startValue) + delay);
        const end = cueTime(endValue) + delay;
        const content = plainCue(raw);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start && content && cues.length < MAX_CUES) {
            cues.push({ start, end, text: content.slice(0, 4000) });
        }
    }
    if (['ass', 'ssa'].includes(extension.toLowerCase())) {
        let columns = [];
        let events = false;
        for (const line of text.split('\n')) {
            if (/^\[/.test(line)) events = /^\[Events\]/i.test(line);
            if (!events) continue;
            if (/^Format:/i.test(line)) columns = line.slice(line.indexOf(':') + 1).split(',').map(item => item.trim().toLowerCase());
            if (!/^Dialogue:/i.test(line) || !columns.length || columns.at(-1) !== 'text') continue;
            const fields = line.slice(line.indexOf(':') + 1).trim().split(',');
            const content = fields.slice(columns.length - 1).join(',');
            // ASS vector drawings are not dialogue.
            if (/\{[^}]*\\p[1-9]/i.test(content)) continue;
            add(fields[columns.indexOf('start')], fields[columns.indexOf('end')], content);
        }
    } else {
        for (const block of text.split(/\n\s*\n/)) {
            const lines = block.trim().split('\n');
            if (/^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
            const index = lines.findIndex(line => line.includes('-->'));
            if (index < 0) continue;
            const [start, rest] = lines[index].split('-->');
            add(start, rest.trim().split(/\s/)[0], lines.slice(index + 1).join('\n'));
        }
    }
    return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}

function timestamp(ms) {
    const value = Math.round(ms);
    return `${String(Math.floor(value / 3600000)).padStart(2, '0')}:${String(Math.floor(value / 60000) % 60).padStart(2, '0')}:${String(Math.floor(value / 1000) % 60).padStart(2, '0')}.${String(value % 1000).padStart(3, '0')}`;
}

function toVtt(cues) {
    return 'WEBVTT\n\n' + cues.map(cue => `${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`).join('\n');
}

function mergeBilingual(chinese, english) {
    const events = new Map();
    const add = (time, event) => {
        if (!events.has(time)) events.set(time, []);
        events.get(time).push(event);
    };
    for (const [language, cues] of [['zh', chinese], ['en', english]]) {
        cues.forEach(cue => {
            add(cue.start, { language, cue, active: true });
            add(cue.end, { language, cue, active: false });
        });
    }
    const active = { zh: new Set(), en: new Set() };
    const times = [...events.keys()].sort((a, b) => a - b);
    const output = [];
    times.forEach((time, index) => {
        for (const event of events.get(time)) {
            if (event.active) active[event.language].add(event.cue);
            else active[event.language].delete(event.cue);
        }
        const text = [...new Set([...active.zh, ...active.en].map(cue => cue.text))].join('\n');
        if (!text || index === times.length - 1) return;
        const previous = output.at(-1);
        if (previous?.text === text && previous.end === time) previous.end = times[index + 1];
        else output.push({ start: time, end: times[index + 1], text });
    });
    return output;
}

function buildTracks(results) {
    const tracks = new Map();
    for (const result of results) {
        if (!result.cues.length) continue;
        const sampledCues = result.cues.slice(0, 300);
        const sample = sampledCues.map(cue => cue.text).join('\n');
        const hasChinese = /[\u3400-\u9fff]/.test(sample);
        const hasEnglish = /[a-zA-Z]{3,}/.test(sample);
        const englishLines = sampledCues.filter(cue => cue.text.split('\n').some(line =>
            !/[\u3400-\u9fff]/.test(line) && /[a-zA-Z]{2,}/.test(line))).length;
        const bilingual = englishLines >= Math.max(1, Math.ceil(sampledCues.length / 4));
        // Do not mislabel an English fallback returned by the Chinese query.
        const language = hasChinese ? (bilingual ? 'bilingual' : 'zh') : (hasEnglish ? 'en' : result.language);
        if (!tracks.has(language)) tracks.set(language, result.cues);
    }
    if (!tracks.has('bilingual') && tracks.has('zh') && tracks.has('en')) {
        tracks.set('bilingual', mergeBilingual(tracks.get('zh'), tracks.get('en')));
    }
    return ['bilingual', 'zh', 'en'].filter(language => tracks.has(language))
        .map(language => ({ language, vtt: toVtt(tracks.get(language)) }));
}

async function searchShooter({ size, readRange, fileName, fetchImpl = fetch, download = downloadSubtitle }) {
    const hash = await shooterHash(size, readRange);
    if (!hash) return [];
    const downloaded = new Map();
    const outcomes = await Promise.allSettled(['zh', 'en'].map(async language => {
        const body = new URLSearchParams({ filehash: hash, pathinfo: fileName, format: 'json', lang: language === 'zh' ? 'chn' : 'eng' });
        const response = await fetchImpl('https://www.shooter.cn/api/subapi.php', {
            method: 'POST', body, signal: AbortSignal.timeout(10000), redirect: 'error',
            headers: { 'User-Agent': 'ToolsCinema/1.0' }
        });
        if (!response.ok) throw new Error('Subtitle search failed');
        const bytes = await readLimitedBody(response, 256 * 1024);
        if (bytes.length === 1 && bytes[0] === 0xff) return null;
        const entries = JSON.parse(bytes.toString('utf8'));
        if (!Array.isArray(entries)) return null;
        for (const entry of entries.slice(0, 3)) {
            for (const file of (Array.isArray(entry.Files) ? entry.Files : []).slice(0, 4)) {
                if (!/^(srt|ass|ssa|vtt)$/i.test(file.Ext || '') || !file.Link) continue;
                try {
                    if (!downloaded.has(file.Link)) downloaded.set(file.Link, download(file.Link));
                    const raw = await downloaded.get(file.Link);
                    const delay = Math.max(-3600000, Math.min(3600000, Number(entry.Delay) || 0));
                    const cues = parseSubtitle(raw, file.Ext, delay);
                    if (cues.length) return { language, cues };
                } catch (_) { /* Try the next supported subtitle file. */ }
            }
        }
        return null;
    }));
    if (outcomes.every(item => item.status === 'rejected')) throw new Error('Subtitle provider unavailable');
    return buildTracks(outcomes.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value));
}

async function readLimitedBody(response, limit) {
    if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new Error('Response too large');
    }
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) throw new Error('Response too large');
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function getSubtitles(key, load) {
    const now = Date.now();
    for (const [cachedKey, entry] of cache) {
        if (entry.expires <= now) { cache.delete(cachedKey); cacheBytes -= entry.bytes; }
    }
    if (cache.has(key)) return cache.get(key).tracks;
    if (pending.has(key)) return pending.get(key);
    // Public cinema requests must not create an unbounded download queue.
    if (pending.size >= 2) return [];
    const task = (async () => {
        let tracks = [];
        let ttl = 5 * 60000;
        try { tracks = await load(); if (tracks.length) ttl = 6 * 3600000; }
        catch (_) { ttl = 60000; }
        const bytes = Buffer.byteLength(JSON.stringify(tracks));
        if (bytes <= CACHE_BYTES) {
            while (cache.size && (cache.size >= 128 || cacheBytes + bytes > CACHE_BYTES)) {
                const oldest = cache.keys().next().value;
                cacheBytes -= cache.get(oldest).bytes;
                cache.delete(oldest);
            }
            cache.set(key, { tracks, bytes, expires: Date.now() + ttl });
            cacheBytes += bytes;
        }
        return tracks;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
}

module.exports = { getSubtitles, searchShooter, shooterHash, parseSubtitle, buildTracks, mergeBilingual, toVtt, readLimitedBody, isPublicAddress };
