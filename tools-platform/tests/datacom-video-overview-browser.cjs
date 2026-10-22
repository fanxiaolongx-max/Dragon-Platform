// node_modules/.bin/electron tests/datacom-video-overview-browser.cjs
const { app, BrowserWindow, session, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { versionAssetUrls, fileHash } = require('../backend/models/asset-versioning');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-video-overview-'));
app.setPath('userData', path.join(temp, 'profile'));
const seed = require('../backend/builtin-tools/datacom-protocol-expert/knowledge-seed.json');
const videoManifest = require('../frontend/assets/promotions/datacom/manifest.json');
const videoCount = seed.articles.filter(article => Object.hasOwn(videoManifest, article.id)).length;
const data = { ...seed, articles: seed.articles.map(a => ({ ...a, revision: 1, bodyLength: a.bodyMd.length })) };
let win, server;
const requests = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn, ...args) {
    for (let i = 0; i < 250; i++) {
        if (await evaluate(fn, ...args)) return;
        await wait(40);
    }
    throw new Error('Timed out: ' + fn.toString());
}
app.whenReady().then(async () => {
    const web = express();
    const toolRoot = path.join(root, 'backend/builtin-tools/datacom-protocol-expert');
    web.get('/warm-module-cache', (_, res) => res.type('html').send('<script type="module">import "/custom-tools/datacom-protocol-expert/assets/note-video.js"; window.oldModuleCached = true;</script>'));
    // Reproduce an old browser/CDN cache entry that lacks the newly added export.
    web.get('/custom-tools/datacom-protocol-expert/assets/note-video.js', (req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        if (!req.query.v) return res.type('js').send('export function mountNoteVideo() {}');
        res.sendFile(path.join(toolRoot, 'assets/note-video.js'));
    });
    web.get('/custom-tools/datacom-protocol-expert/index.html', (_, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.type('html').send(versionAssetUrls(fs.readFileSync(path.join(toolRoot, 'index.html'), 'utf8'), { publicDir: path.join(root, 'frontend'), baseDir: toolRoot }));
    });
    web.get('/api/datacom-knowledge', (_, res) => res.json({ ...data, canWrite: false, tenantId: 'fixture', username: 'test' }));
    web.get('/api/datacom-knowledge/articles/:id', (req, res) => res.json({ article: data.articles.find(a => a.id === req.params.id) }));
    web.get('/api/datacom-knowledge/annotations', (_, res) => res.json({ annotations: [] }));
    web.use('/custom-tools/datacom-protocol-expert', express.static(path.join(root, 'backend/builtin-tools/datacom-protocol-expert')));
    web.use('/assets/promotions/datacom', express.static(path.join(root, 'frontend/assets/promotions/datacom')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => { requests.push(details.url); callback({}); });
    nativeTheme.themeSource = 'dark';
    win = new BrowserWindow({ show: false, width: 1720, height: 1100, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/warm-module-cache`);
    await until(() => window.oldModuleCached === true);
    await win.loadURL(`http://127.0.0.1:${server.address().port}/custom-tools/datacom-protocol-expert/index.html`);
    await until(count => document.querySelectorAll('[data-video-id]').length === count && !!document.querySelector('#homeVideos video'), Math.min(6, videoCount));
    await wait(300);
    assert.equal(await evaluate(() => document.querySelectorAll('.dk-nav-video').length), videoCount);
    assert.equal(await evaluate(() => !!document.querySelector('.dk-nav-link[href="#/a/ospf-auth"] .dk-nav-video')), false);
    assert.equal(requests.filter(url => /\.mp4(?:\?|$)/.test(url)).length, 0, 'overview must not preload video data');
    assert.equal(requests.filter(url => url.includes('/manifest.json')).length, 1, 'directory and overview must share their manifest');
    const hash = fileHash(path.join(toolRoot, 'assets/note-video.js'));
    assert.ok(requests.some(url => url.endsWith(`/assets/note-video.js?v=${hash}`)), 'current video module loads through its content version despite the stale unversioned cache entry');
    assert.equal(await evaluate(() => document.querySelector('#homeVideos').textContent.includes('1:60')), false);
    const position = await evaluate(() => {
        const content = document.querySelector('.dk-home-content').getBoundingClientRect();
        const videos = document.querySelector('#homeVideos').getBoundingClientRect();
        return { contentRight: content.right, videoLeft: videos.left };
    });
    assert.ok(position.videoLeft > position.contentRight, 'video classroom sits to the right on desktop');
    const coverage = await evaluate(() => [...document.querySelectorAll('.dk-cov-home .dk-cov-bar')].map(bar => [...bar.children].map(item => item.getBoundingClientRect().top)));
    assert.ok(coverage.every(tops => tops.every(top => Math.abs(top - tops[0]) < 1)), 'coverage segments stay on one line');
    fs.writeFileSync('/tmp/datacom-video-overview-desktop.png', (await win.webContents.capturePage()).toPNG());

    await evaluate(() => document.querySelector('#homeVideos .dk-video-play').click());
    await until(() => { const v = document.querySelector('#homeVideos video'); return !v.paused && v.currentTime > .1; });
    await evaluate(() => { const v = document.querySelector('#homeVideos video'); v.pause(); v.currentTime = 5; });
    await until(() => { const v = document.querySelector('#homeVideos video'); return !v.seeking && v.currentTime >= 5; });
    await evaluate(() => document.querySelector('#homeVideos .dk-video-hd').click());
    await until(() => document.querySelector('.dk-video-dialog video')?.currentTime >= 5);
    assert.equal(await evaluate(() => document.querySelector('#homeVideos video').paused), true);
    assert.equal(await evaluate(() => document.querySelector('.dk-video-dialog').contains(document.activeElement)), true);
    assert.match(await evaluate(() => document.querySelector('.dk-video-dialog video').currentSrc), /-hd\.mp4/);
    await evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(await evaluate(() => !!document.querySelector('.dk-video-dialog')), false);

    const oldId = await evaluate(() => document.querySelector('[data-video-id][aria-pressed="true"]').dataset.videoId);
    await evaluate(() => document.querySelector('[data-video-shuffle]').click());
    await until(() => !!document.querySelector('#homeVideos video'));
    assert.notEqual(await evaluate(() => document.querySelector('[data-video-id][aria-pressed="true"]').dataset.videoId), oldId);
    assert.equal(await evaluate(() => document.querySelector('#homeVideos video').paused), true, 'reshuffle must not autoplay');
    await evaluate(() => document.querySelectorAll('[data-video-id]')[1].click());
    await until(() => { const v = document.querySelector('#homeVideos video'); return !v.paused && v.currentTime > .1; });
    await evaluate(() => document.querySelector('#homeVideos .dk-video-hd').click());
    await until(() => !!document.querySelector('.dk-video-dialog'));
    await evaluate(() => { location.hash = '#/labs'; });
    await until(() => !!document.querySelector('.dk-lab-grid'));
    assert.equal(await evaluate(() => !!document.querySelector('.dk-video-dialog')), false, 'navigation releases the HD player');
    await evaluate(() => { location.hash = '#/'; });
    await until(() => !!document.querySelector('#homeVideos video'));
    await evaluate(() => document.querySelector('#themeBtn').click());
    assert.equal(await evaluate(() => document.documentElement.dataset.theme), 'light');
    fs.writeFileSync('/tmp/datacom-video-overview-light.png', (await win.webContents.capturePage()).toPNG());
    await evaluate(() => document.documentElement.style.setProperty('--nav-w', '580px'));
    win.setSize(1350, 1000);
    await wait(350);
    const stacked = await evaluate(() => {
        const video = document.querySelector('#homeVideos').getBoundingClientRect();
        const content = document.querySelector('.dk-home-content').getBoundingClientRect();
        return { videoBottom: video.bottom, contentTop: content.top, scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth };
    });
    assert.ok(stacked.videoBottom < stacked.contentTop, 'wide navigation switches classroom to a row above the content');
    assert.ok(stacked.scroll <= stacked.client + 1);
    await evaluate(() => document.documentElement.style.removeProperty('--nav-w'));
    for (const width of [1180, 860, 390]) {
        win.setSize(width, 1000);
        await wait(100);
        const size = await evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(size.scroll <= size.client + 1, JSON.stringify({ width, size }));
    }
    fs.writeFileSync('/tmp/datacom-video-overview-mobile.png', (await win.webContents.capturePage()).toPNG());
    const scrollStart = await evaluate(() => { window.scrollTo(0, document.querySelector('#homeVideos').getBoundingClientRect().top + window.scrollY - 110); return window.scrollY; });
    await wait(100);
    assert.ok(scrollStart > 0);
    fs.writeFileSync('/tmp/datacom-video-overview-mobile-classroom.png', (await win.webContents.capturePage()).toPNG());
    console.log(`Overview: ${videoCount} video badges, lazy media, shared manifest, inline/HD playback and seeking, shuffle, Escape/focus, route cleanup, light/dark and responsive layouts passed.`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close();
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
