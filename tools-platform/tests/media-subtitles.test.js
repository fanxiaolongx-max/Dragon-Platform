const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-subtitles-'));
process.env.TOOLS_MEDIA_DIR = path.join(sandbox, 'media');
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_DISABLE_FEINIU_SYNC = '1';
const { shooterHash, parseSubtitle, mergeBilingual, buildTracks, toVtt, searchShooter, getSubtitles, readLimitedBody, isPublicAddress } = require('../backend/models/media-subtitles');
const { router, createCategoryPinRecord } = require('../backend/routes/media');
const { runWithTenant } = require('../backend/models/tenant-context');
const { closeDatabase } = require('../backend/models/app-db');
const express = require('express');
const request = require('supertest');
test.after(async () => { await closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });

test('电影指纹使用四个 4K 区块，拒绝不完整的 Range', async () => {
    const data = crypto.randomBytes(30000);
    const offsets = [];
    const result = await shooterHash(data.length, async (offset, length) => {
        offsets.push(offset);
        assert.equal(length, 4096);
        return data.subarray(offset, offset + length);
    });
    assert.deepEqual(offsets, [4096, 20000, 10000, 21808]);
    assert.equal(result, offsets.map(offset => crypto.createHash('md5').update(data.subarray(offset, offset + 4096)).digest('hex')).join(';'));
    await assert.rejects(shooterHash(10000, async () => Buffer.alloc(1)), /Incomplete/);
    assert.equal(await shooterHash(20, () => assert.fail()), '');
});

test('解析 SRT / VTT、时间偏移、重叠对白并移除字幕标记', () => {
    const cues = parseSubtitle(Buffer.from('1\r\n00:00:01,200 --> 00:00:03,400\r\n<b>你好</b>\r\nHello &amp; welcome\r\n\r\n2\r\n00:00:02,000 --> 00:00:02,800\r\n第二句'), 'srt', -1500);
    assert.deepEqual(cues[0], { start: 0, end: 1900, text: '你好\nHello & welcome' });
    assert.equal(cues.length, 2);
    const vtt = toVtt(cues);
    assert.ok(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.900'));
    assert.match(vtt, /Hello &amp; welcome/);
    assert.deepEqual(parseSubtitle(Buffer.from(vtt), 'vtt'), cues);
    assert.deepEqual(parseSubtitle(Buffer.from('<html>Not subtitles</html>'), 'srt'), []);
});

test('ASS 双语文本、百分秒、绘图过滤和中文 UTF16 / GB18030 解码', () => {
    const ass = '[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.20,0:00:03.45,Default,{\\an8}你好\\NHello, world\nDialogue: 0,0:00:01.20,0:00:03.45,Default,{\\p1}m 0 0 l 1 1';
    assert.deepEqual(parseSubtitle(Buffer.from(ass), 'ass'), [{ start: 1200, end: 3450, text: '你好\nHello, world' }]);
    const srt = '1\n00:00:00,000 --> 00:00:01,000\n你好';
    assert.equal(parseSubtitle(Buffer.concat([Buffer.from([255, 254]), Buffer.from(srt, 'utf16le')]), 'srt')[0].text, '你好');
    const gb = Buffer.concat([Buffer.from('1\n00:00:00,000 --> 00:00:01,000\n'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3])]);
    assert.equal(parseSubtitle(gb, 'srt')[0].text, '你好');
});

test('双语合成按时间边界保留重叠和空白，不改变对白时间', () => {
    const zh = [{ start: 1000, end: 3000, text: '你好' }, { start: 4000, end: 5000, text: '再见' }];
    const en = [{ start: 1200, end: 3200, text: 'Hello' }];
    assert.deepEqual(mergeBilingual(zh, en), [
        { start: 1000, end: 1200, text: '你好' }, { start: 1200, end: 3000, text: '你好\nHello' },
        { start: 3000, end: 3200, text: 'Hello' }, { start: 4000, end: 5000, text: '再见' }
    ]);
    const tracks = buildTracks([{ language: 'zh', cues: zh }, { language: 'en', cues: en }]);
    assert.deepEqual(tracks.map(track => track.language), ['bilingual', 'zh', 'en']);
    assert.deepEqual(buildTracks([{ language: 'zh', cues: en }]).map(track => track.language), ['en']);
    assert.deepEqual(buildTracks([{ language: 'zh', cues: [{ start: 0, end: 2000, text: '你好\nHello there' }] }]).map(track => track.language), ['bilingual']);
});

test('同时查询中英文，保留 Delay，并跳过不支持的字幕格式', async () => {
    const languages = [];
    const downloads = [];
    const tracks = await searchShooter({
        size: 20000, readRange: async () => Buffer.alloc(4096), fileName: '电影.mp4',
        fetchImpl: async (url, options) => {
            assert.equal(url, 'https://www.shooter.cn/api/subapi.php');
            assert.equal(options.body.get('pathinfo'), '电影.mp4');
            const language = options.body.get('lang'); languages.push(language);
            return new Response(JSON.stringify([{ Delay: 300, Files: [
                { Ext: 'zip', Link: 'https://example.com/skip.zip' }, { Ext: 'srt', Link: `https://example.com/${language}.srt` }
            ] }]));
        },
        download: async url => { downloads.push(url); return Buffer.from(`1\n00:00:01,000 --> 00:00:03,000\n${url.includes('chn') ? '你好' : 'Hello'}`); }
    });
    assert.deepEqual(languages.sort(), ['chn', 'eng']);
    assert.equal(downloads.length, 2);
    assert.deepEqual(tracks.map(track => track.language), ['bilingual', 'zh', 'en']);
    assert.match(tracks[0].vtt, /00:00:01.300 --> 00:00:03.300/);
});

test('未收录、单语言故障及超限响应安全降级', async () => {
    const base = { size: 10000, readRange: async () => Buffer.alloc(4096), fileName: 'test.mp4' };
    assert.deepEqual(await searchShooter({ ...base, fetchImpl: async () => new Response(Buffer.from([255])) }), []);
    const tracks = await searchShooter({ ...base, fetchImpl: async (_, options) => {
        if (options.body.get('lang') === 'chn') throw new Error('offline');
        return new Response(JSON.stringify([{ Files: [{ Ext: 'srt', Link: 'https://example.com/en.srt' }] }]));
    }, download: async () => Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHello') });
    assert.equal(tracks[0].language, 'en');
    await assert.rejects(readLimitedBody(new Response('long'), 3), /too large/);
    await assert.rejects(searchShooter({ ...base, fetchImpl: async () => { throw new Error('offline'); } }), /unavailable/);
});

test('缓存合并并发请求、缓存空结果，失败不会影响调用方', async () => {
    let count = 0;
    const load = async () => { count++; await new Promise(resolve => setTimeout(resolve, 10)); return [{ language: 'en', vtt: 'WEBVTT\n' }]; };
    const values = await Promise.all([getSubtitles('test-cache', load), getSubtitles('test-cache', load)]);
    assert.equal(count, 1);
    assert.deepEqual(values[0], values[1]);
    assert.deepEqual(await getSubtitles('test-cache', () => assert.fail()), values[0]);
    assert.deepEqual(await getSubtitles('test-failure', () => { throw new Error('offline'); }), []);
    assert.deepEqual(await getSubtitles('test-failure', () => assert.fail()), []);
});

test('字幕下载拒绝内网、回环和 IPv4 映射 IPv6 地址', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1']) assert.equal(isPublicAddress(ip), false, ip);
    assert.equal(isPublicAddress('1.1.1.1'), true);
    assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
});

test('公开字幕 API 限定目录清单、PIN 权限和租户缓存边界', async () => {
    const pinCategory = { id: 'locked', name: 'Locked', folder: 'locked', protected: true, ...createCategoryPinRecord('1234') };
    fs.mkdirSync(path.join(process.env.TOOLS_MEDIA_DIR, 'locked'), { recursive: true });
    fs.writeFileSync(path.join(process.env.TOOLS_MEDIA_DIR, 'film.mp4'), Buffer.alloc(30000));
    fs.writeFileSync(path.join(process.env.TOOLS_MEDIA_DIR, 'locked/hidden.mp4'), Buffer.alloc(30000));
    fs.writeFileSync(path.join(process.env.TOOLS_MEDIA_DIR, 'media-manifest.json'), JSON.stringify({ categories: [{ id: 'all', folder: '' }, pinCategory], videos: {} }));
    const web = express(); web.use(express.json());
    web.use((req, _res, next) => runWithTenant(req.headers['x-test-tenant'] || 'default', next));
    web.use('/api/media', router);
    const original = global.fetch;
    let searches = 0;
    global.fetch = async () => { searches++; return new Response(Buffer.from([255])); };
    try {
        await request(web).get('/api/media/public/subtitles/unknown.mp4').expect(404);
        await request(web).get('/api/media/public/subtitles/locked___hidden.mp4').expect(403);
        assert.equal(searches, 0);
        const unlocked = await request(web).post('/api/media/public/unlock').send({ category: 'locked', pin: '1234' }).expect(200);
        await request(web).get('/api/media/public/subtitles/locked___hidden.mp4').query({ access: unlocked.body.access }).expect(200);
        assert.equal(searches, 2);
        await request(web).get('/api/media/public/subtitles/locked___hidden.mp4').expect(403);
        await request(web).get('/api/media/public/subtitles/film.mp4').expect(200);
        await request(web).get('/api/media/public/subtitles/film.mp4').expect(200);
        assert.equal(searches, 4);
        await request(web).get('/api/media/public/subtitles/film.mp4').set('x-test-tenant', 'named').expect(200);
        assert.equal(searches, 6);
    } finally { global.fetch = original; }
});

test('飞牛从原始 Range 读取指纹，媒体凭据不会发送给字幕源，拒绝完整视频响应', async () => {
    const routePath = require.resolve('../backend/routes/media');
    const feiniuModule = require.cache[require.resolve('../backend/models/feiniu-service')];
    const originalExports = feiniuModule.exports;
    const originalRoute = require.cache[routePath];
    const originalFetch = global.fetch;
    let mediaGuid = 'remote-file';
    const media = Buffer.alloc(30000);
    const rangeRequests = [];
    let providerRequests = 0;
    feiniuModule.exports = {
        ...originalExports,
        getCachedFeiniuCatalog: () => ({ categories: [], videos: [{ id: `feiniu___${mediaGuid}`, source: 'feiniu', feiniuGuid: mediaGuid, feiniuMediaGuid: mediaGuid, fileName: 'movie.mp4', fileSize: 0 }] }),
        resolveFeiniuPlayback: async () => ({ origin: 'https://media.example', token: 'fixture-token', streamMeta: { mediaGuid, fileSize: 0, fileName: 'movie.mp4' } })
    };
    try {
        delete require.cache[routePath];
        const isolatedRouter = require(routePath).router;
        const web = express(); web.use('/api/media', isolatedRouter);
        global.fetch = async (url, options) => {
            if (url.startsWith('https://media.example/')) {
                assert.equal(options.headers.authorization, 'fixture-token');
                rangeRequests.push(options.headers.Range);
                if (mediaGuid === 'unsupported-range') return new Response('full video', { status: 200 });
                const [, start, end] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
                return new Response(media.subarray(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${media.length}` } });
            }
            providerRequests++;
            assert.equal(options.headers.authorization, undefined);
            assert.equal(options.headers.Cookie, undefined);
            assert.equal(options.body.get('pathinfo'), 'movie.mp4');
            return new Response(Buffer.from([255]));
        };
        await request(web).get('/api/media/public/subtitles/feiniu___remote-file').expect(200);
        assert.deepEqual(rangeRequests, ['bytes=0-0', 'bytes=4096-8191', 'bytes=20000-24095', 'bytes=10000-14095', 'bytes=21808-25903']);
        assert.equal(providerRequests, 2);
        mediaGuid = 'unsupported-range';
        const result = await request(web).get('/api/media/public/subtitles/feiniu___unsupported-range').expect(200);
        assert.deepEqual(result.body.tracks, []);
        assert.equal(providerRequests, 2);
    } finally {
        feiniuModule.exports = originalExports;
        require.cache[routePath] = originalRoute;
        global.fetch = originalFetch;
    }
});
