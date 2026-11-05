// node_modules/.bin/electron tests/desktop-datacom-surface-browser.cjs
const { app, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createMainWindowController } = require('../desktop-main-window');
const { createFrontendHtmlSender, injectPlatformTheme } = require('../backend/models/asset-versioning');
const { injectLanguageRuntime } = require('../backend/models/custom-tool-i18n-service');

if (process.platform !== 'darwin') app.exit(0);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-datacom-surface-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
shell.openExternal = async () => {};
const watchdog = setTimeout(() => { console.error('Datacom surface test timed out'); app.exit(1); }, 30000);
const slug = 'datacom-protocol-expert';
const toolUrl = '/tools/' + slug;
const toolAssets = '/custom-tools/' + slug;
const frontend = path.resolve(__dirname, '../frontend');
const assets = path.resolve(__dirname, '../backend/builtin-tools', slug);
const seed = require(path.join(assets, 'knowledge-seed.json'));

async function until(predicate, label) {
    for (let i = 0; i < 250; i++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error('Timed out: ' + label);
}

app.whenReady().then(async () => {
    const web = express();
    const send = createFrontendHtmlSender(frontend);
    let releaseCatalog;
    const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
    let catalogRequested = false;
    web.get('/', (_req, res) => {
        res.cookie('fixture', 'session');
        res.send(`<!doctype html><html data-ui="v2"><link rel="stylesheet" href="/css/home-skill-hub.css">
            <style>*{box-sizing:border-box}</style>
            <body style="margin:0;display:grid;grid-template-columns:240px 1fr">
            <aside id="homeSidebar"><button id="session">Another chat</button></aside>
            <main class="home-main"><button id="open">Open tool</button></main><script src="/js/home/tool-frame.js"></script>
            <script>
                localStorage.setItem('tools_token', 'fixture');
                document.querySelector('#open').onclick = () => HomeToolFrame.open('${toolUrl}');
                document.querySelector('#session').onclick = () => { window.chatSwitched = true; };
            </script></body></html>`);
    });
    web.get(toolUrl, (_req, res) => send(res, 'pages/custom-tool.html'));
    web.get(toolAssets + '/index.html', (_req, res) => {
        const html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
        res.type('html').send(injectPlatformTheme(injectLanguageRuntime(html, slug), { toolPath: toolAssets }));
    });
    web.use(toolAssets, express.static(assets));
    web.get('/api/custom-tools', (_req, res) => res.json([{ slug, name: '数通协议专家', filePath: toolAssets + '/index.html' }]));
    web.get('/api/auth/me', (_req, res) => res.json({ username: 'fixture', role: 'admin' }));
    web.get('/api/department-reward-penalty/snapshot/settings', (_req, res) => res.json({}));
    web.get('/api/datacom-knowledge', async (req, res) => {
        if (!req.headers.cookie?.includes('fixture=session')) return res.sendStatus(401);
        catalogRequested = true;
        await catalogGate;
        res.json({ ...seed, canWrite: true, tenantId: 'default', username: 'fixture' });
    });
    web.use('/api', (_req, res) => res.json({}));
    web.use(express.static(frontend));
    const server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const controller = createMainWindowController({
        getBaseUrl: () => 'http://127.0.0.1:' + server.address().port,
        getIconPath: () => undefined,
        statePath: path.join(temp, 'window.json'),
        isQuitting: () => true,
        preloadPath: path.resolve(__dirname, '../electron-preload.js')
    });
    controller.registerIpc();
    controller.open('/');
    const win = controller.window;
    const js = code => win.webContents.executeJavaScript(code);
    await until(() => !win.webContents.isLoading() && js('!!window.HomeToolFrame'), 'home ready');
    await js("document.querySelector('#open').click()");
    await until(() => catalogRequested, 'catalog requested with same session');
    assert.equal(await js("!document.querySelector('.v2-tool-skeleton').hidden"), true);
    assert.equal(win.getBrowserViews().length, 0, 'skeleton stays visible until the tool reports readiness');
    releaseCatalog();
    await until(() => win.getBrowserViews().length === 1, 'tool attached');
    const view = win.getBrowserViews()[0];
    const contents = view.webContents;
    assert.notEqual(contents.getOSProcessId(), win.webContents.getOSProcessId(), 'tool renders in its own process');
    assert.equal(view.getBounds().x, 240);
    assert.equal(view.getBounds().y, 48);
    assert.equal(await contents.executeJavaScript("!!document.querySelector('iframe.custom-tool-frame').contentDocument.querySelector('.dk-hero')"), true);
    await until(() => contents.executeJavaScript("!!document.querySelector('iframe.custom-tool-frame').contentDocument.querySelector('.dk-domain-grid')"), 'deferred details');

    await js("document.body.insertAdjacentHTML('beforeend', '<div class=\"v2-pop is-open\" id=\"overlay\"></div>')");
    await until(() => win.getBrowserViews().length === 0, 'host overlay can cover the tool');
    await js("document.querySelector('#overlay').remove()");
    await until(() => win.getBrowserViews()[0] === view, 'same view restored after overlay');

    await contents.executeJavaScript(`setTimeout(() => {
        function spin() { queueMicrotask(spin); }
        spin();
    }, 50); void 0;`);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await js("document.querySelector('#session').click(); window.chatSwitched"), true, 'chat can be switched during a tool hang');
    await until(() => contents.isDestroyed(), 'closing tool destroys the blocked renderer');

    await js("document.querySelector('#open').click()");
    await until(() => win.getBrowserViews().length === 1, 'tool reopens');
    const blocked = win.getBrowserViews()[0].webContents;
    await blocked.executeJavaScript('setTimeout(() => { for (;;) {} }, 50); void 0;');
    await until(() => js("document.querySelector('.v2-tool-surface [role=status]').textContent.includes('无响应')"), 'host watchdog shows recovery UI');
    assert.equal(win.getBrowserViews().length, 0);
    assert.equal(blocked.isDestroyed(), true);
    await js("document.querySelector('.v2-tool-surface button').click()");
    await until(() => win.getBrowserViews().length === 1, 'retry loads a new tool');
    assert.notEqual(win.getBrowserViews()[0].webContents, blocked);
    assert.equal(await js('window.chatSwitched'), true, 'retry preserves the shell');

    controller.destroy();
    server.close();
    clearTimeout(watchdog);
    console.log('PASS: skeleton, progressive content, isolated renderer, chat during hang, watchdog and retry');
    app.exit(0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
