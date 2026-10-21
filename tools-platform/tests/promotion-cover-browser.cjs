// node_modules/.bin/electron tests/promotion-cover-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-cover-'));
app.setPath('userData', path.join(temp, 'profile'));
const frontend = path.join(__dirname, '../frontend');
let config = { maxLinks: 3, rotateSeconds: 30, desktopStack: false, defaultsWritable: false, videos: ['rfc', 'incentive', 'eos', 'guide'].map(id => ({ id, enabled: false })), links: [
    { ...JSON.parse(fs.readFileSync(path.join(__dirname, '../backend/platform-promotions-defaults.json'))).links[0], builtin: true, enabled: true }
] };
let win, server, saves = 0;
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
    for (let n = 0; n < 120; n++) { if (await evaluate(fn)) return; await wait(25); }
    throw new Error('Timed out: ' + fn);
}
app.whenReady().then(async () => {
    const web = express();
    web.use(express.json({ limit: '2mb' }));
    web.get('/api/platform-promotions', (_, res) => res.json(config));
    web.put('/api/platform-promotions', (req, res) => { saves++; config = req.body; res.json(config); });
    web.get('/api/platform-promotions/stats', (_, res) => res.json({ items: [], totalClicks: 0, totalUsers: 0 }));
    web.get('/api/platform-promotions/desktop', (_, res) => res.json({ available: false }));
    web.get(['/', '/settings'], (req, res) => res.type('html').send(`<!doctype html><html lang="zh-CN" data-theme="dark"><head>
        <link rel="stylesheet" href="/css/home-promo-video.css"><style>body{background:#101d32;font-family:Arial;margin:0}#settings{margin:24px;max-width:900px}*{box-sizing:border-box}</style>
        <script>localStorage.setItem('tools_lang','zh-CN')</script><script src="/js/shared/i18n.js"></script></head><body>
        ${req.path === '/settings' ? '<main id="settings"></main><script src="/js/shared/promotion-settings.js"></script><script>ToolsPromotionSettings.render(document.getElementById("settings"))</script>' : '<script src="/js/home/promo-video.js"></script>'}
        </body></html>`));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ width: 1200, height: 920, show: false, webPreferences: { backgroundThrottling: false } });
    win.webContents.on('console-message', (_event, _level, message) => { if (/Error|error/.test(message)) console.log(message); });
    await win.loadURL(base);
    await until(() => !!document.querySelector('.has-link-image .nrv-link-image')?.naturalWidth);
    assert.equal(await evaluate(() => document.querySelector('.nrv-link-frame').hidden), true, 'cover is not presented as a live desktop frame');
    await wait(500);
    const box = await evaluate(() => {
        const r = document.querySelector('#nrvFloat').getBoundingClientRect();
        return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    });
    fs.writeFileSync('/tmp/netcare-promotion-cover.png', (await win.webContents.capturePage(box)).toPNG());
    for (const [width, theme, language] of [[1200, 'dark', 'zh-CN'], [390, 'light', 'en-US']]) {
        win.setSize(width, 920);
        await win.loadURL(base + '/settings');
        await until(() => !!document.querySelector('[data-action="edit-cover"]'));
        await evaluate(async (theme, language) => {
            document.documentElement.dataset.theme = theme;
            window.ToolsI18n.setLanguage(language);
            await ToolsPromotionSettings.render(document.getElementById('settings'));
            document.querySelector('[data-action="edit-cover"]').click();
        }, theme, language);
        assert.equal(await evaluate(() => !!document.querySelector('[data-edit="name"]')), false, 'built-in cover can be edited without editing its target');
        await evaluate(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 2000; canvas.height = 1125;
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#28a4c4'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'cover.png', { type: 'image/png' }));
            const input = document.querySelector('[data-cover-file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await until(() => document.querySelector('[data-cover-preview]')?.getAttribute('src')?.startsWith('data:image/jpeg;base64,'));
        assert.ok(await evaluate(() => document.querySelector('[data-cover-preview]').naturalWidth <= 1440), 'local image is resized');
        assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'settings fit narrow screens');
        await evaluate(() => { document.querySelector('[data-action="apply-edit"]').click(); document.querySelector('[data-action="save"]').click(); });
        await until(() => !!document.querySelector('.npp-alert.ok'));
        assert.match(config.links[0].coverImage, /^data:image\/jpeg;base64,/);
    }
    assert.equal(saves, 2);
    await win.loadURL(base);
    await until(() => document.querySelector('.nrv-link-image')?.naturalWidth === 1440);
    await evaluate(() => window.dispatchEvent(new CustomEvent('tools:platform-promotions-changed', { detail: { videos: [], links: [{ id: 'netcare', enabled: true, name: 'NetCare', url: 'https://netcare.huawei.com/', coverImage: '/missing.jpg' }] } })));
    await until(() => !document.querySelector('#nrvFloat').classList.contains('has-link-image'));
    assert.equal(await evaluate(() => document.querySelector('.nrv-link-image').hidden), true, 'failed image falls back to readable gradient');
    config = { ...config, videos: ['rfc', 'incentive', 'eos', 'guide'].map(id => ({ id, enabled: true })), links: [...config.links, { id: 'second', enabled: true, name: 'Second link', url: 'https://second.example/' }] };
    await evaluate(() => localStorage.removeItem('tools.home.promotions.rotation'));
    const cycle = [];
    for (let i = 0; i < 6; i++) {
        await win.loadURL(base);
        await until(() => !!document.querySelector('#nrvFloat') && !document.querySelector('#nrvFloat').hidden);
        const selected = await evaluate(() => {
            const state = JSON.parse(localStorage.getItem('tools.home.promotions.rotation'));
            return { key: state.last, linkVisible: !document.querySelector('#nrvFloat .nrv-link').hidden, inBanners: !!document.querySelector('.nrv-banner[data-promo="' + state.last + '"]') };
        });
        if (i === 0) assert.equal(selected.key, 'link:netcare', 'the first normal homepage visit prefers a link');
        assert.equal(selected.linkVisible, selected.key.startsWith('link:'));
        assert.equal(selected.inBanners, false);
        cycle.push(selected.key);
    }
    assert.deepEqual(cycle.sort(), ['rfc', 'incentive', 'eos', 'guide', 'link:netcare', 'link:second'].sort(), 'normal homepage refreshes cycle through every enabled video and link');
    console.log('Promotion covers: default SVG, editable built-ins, local upload/resize, save/reload, bilingual narrow layout and image failure fallback passed.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close();
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
