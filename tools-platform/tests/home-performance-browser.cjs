// node_modules/.bin/electron tests/home-performance-browser.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-performance-'));
app.setPath('userData', path.join(temp, 'profile'));
const frontend = path.join(__dirname, '../frontend');
const tools = [{ slug: 'fixture', name: '测试工具', nameEn: 'Fixture', icon: '🧰', description: 'Fixture tool', filePath: '/custom-tools/fixture/index.html', builtIn: true }];
let win, server, directoryRequests = 0, previewRequests = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn, description) {
    for (let n = 0; n < 200; n++) {
        if (await evaluate(fn)) return;
        await wait(25);
    }
    throw new Error('Timed out: ' + description);
}

app.whenReady().then(async () => {
    const web = express();
    web.get('/', (_, res) => {
        const html = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8').replace(/<head>/, `<head><script>
            localStorage.setItem('tools_role','admin');localStorage.setItem('tools_user','fixture-admin');
            localStorage.setItem('tools_token','fixture-session');localStorage.setItem('tools_tenant_id','default');
            localStorage.setItem('tools_lang','zh-CN');
        </script>`);
        res.type('html').send(html);
    });
    web.get('/api/custom-tools', async (_, res) => { directoryRequests++; await wait(180); res.json(tools); });
    web.get('/api/app-version', (_, res) => res.json({ version: 'fixture-1' }));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture-admin', role: 'admin', tenantId: 'default' }));
    web.get('/api/tenants', (_, res) => res.json({ tenants: [{ id: 'default', name: '默认租户' }], activeTenantId: 'default' }));
    web.get('/api/custom-tools/builtin-sync/preview', (_, res) => { previewRequests++; res.json({ pending: [], tools: [] }); });
    web.get('/api/platform-promotions', (_, res) => res.json({ videos: [], links: [], desktopStack: false }));
    web.get(['/api/upload/history', '/api/friend-links', '/api/recent-nav'], (_, res) => res.json([]));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [] }));
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.use('/api', (_, res) => res.json({}));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until(() => !!document.querySelector('#toolsGrid [data-tool-slug="fixture"]') && !!document.querySelector('.dc-spot-progress span'), 'home tool cards and spotlight');
    assert.equal(directoryRequests, 1, 'navbar, update metadata and home cards should share one directory request');
    await evaluate(() => checkBuiltinToolsSync());
    await evaluate(() => checkBuiltinToolsSync());
    assert.equal(previewRequests, 1, 'clean automatic check should be reused');
    await evaluate(() => API.get('/api/custom-tools'));
    assert.equal(directoryRequests, 2, 'explicit later directory refresh remains fresh');

    // Use the real CSS animation clock; layout width must remain constant as visual progress grows.
    const progress = await evaluate(() => {
        const bar = document.querySelector('.dc-spot-progress span');
        const animation = bar.getAnimations()[0];
        animation.pause();
        const samples = [0, 3250, 6400].map(time => {
            animation.currentTime = time;
            return { width: bar.offsetWidth, scale: new DOMMatrixReadOnly(getComputedStyle(bar).transform).a };
        });
        return { duration: animation.effect.getTiming().duration, samples };
    });
    assert.equal(progress.duration, 6500);
    assert.equal(progress.samples[0].width, progress.samples[2].width);
    assert.ok(progress.samples[0].scale < .01 && Math.abs(progress.samples[1].scale - .5) < .01 && progress.samples[2].scale > .98);
    const rotated = await evaluate(async () => {
        const card = document.querySelector('.dc-spot-card');
        const before = card.innerHTML;
        const animation = document.querySelector('.dc-spot-progress span').getAnimations()[0];
        animation.finish();
        await new Promise(resolve => setTimeout(resolve, 500));
        return before !== document.querySelector('.dc-spot-card').innerHTML;
    });
    assert.equal(rotated, true, 'animationend must still advance the recommendation');
    const pause = await evaluate(() => {
        const button = document.querySelector('[data-spot-step]');
        button.focus();
        const paused = getComputedStyle(document.querySelector('.dc-spot-progress span')).animationPlayState;
        button.blur();
        const resumed = getComputedStyle(document.querySelector('.dc-spot-progress span')).animationPlayState;
        return { paused, resumed };
    });
    assert.deepEqual(pause, { paused: 'paused', resumed: 'running' }, 'focus must pause and resume rotation');
    for (const [width, height, theme, lang] of [[1440, 1000, 'dark', 'zh-CN'], [390, 844, 'light', 'en-US']]) {
        nativeTheme.themeSource = theme;
        win.setSize(width, height);
        await evaluate(language => window.ToolsI18n.setLanguage(language), lang);
        await wait(100);
        const sizes = await evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(sizes.scroll <= sizes.client + 1, JSON.stringify({ width, theme, sizes }));
        fs.writeFileSync(`/tmp/home-performance-${width}-${theme}.png`, (await win.webContents.capturePage()).toPNG());
    }
    console.log('Full home: 3 tool-directory consumers share 1 request; clean checks reuse their result; explicit refresh, 6.5s visual progress, rotation and desktop/mobile languages pass.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close();
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
