// Real home/login pages against local fixtures; never calls a business service.
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-spotlight-dismiss-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
const frontend = path.join(__dirname, '../frontend');
let win, otherWindow, server, acceptLogin = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn, description) {
    for (let n = 0; n < 200; n++) {
        if (await evaluate(fn)) return;
        await wait(25);
    }
    throw new Error('Timed out: ' + description);
}
setTimeout(() => app.exit(1), 45000).unref();

app.whenReady().then(async () => {
    const web = express();
    web.get('/', (_, res) => res.type('html').send(fs.readFileSync(path.join(frontend, 'index.html'), 'utf8').replace(/<head>/, `<head><script>
        localStorage.setItem('tools_role','admin');localStorage.setItem('tools_user','fixture-admin');
        localStorage.setItem('tools_token','fixture-session');localStorage.setItem('tools_tenant_id','default');
        localStorage.setItem('tools_lang','zh-CN');
    </script>`)));
    web.get('/pages/login.html', (_, res) => res.type('html').send(fs.readFileSync(path.join(frontend, 'pages/login.html'), 'utf8').replace(/@import url\([^;]+;/g, '')));
    web.post('/api/auth/login', (_, res) => acceptLogin
        ? res.json({ success: true, token: 'new-fixture-session', username: 'fixture-admin', role: 'admin', tenantId: 'default' })
        : res.status(401).json({ error: 'Fixture login rejected' }));
    web.get('/api/custom-tools', (_, res) => res.json([{ slug: 'fixture', name: '测试工具', nameEn: 'Fixture tool', icon: '🧰', description: 'Fixture', filePath: '/custom-tools/fixture/index.html', builtIn: true }]));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture-admin', role: 'admin', tenantId: 'default' }));
    web.get('/api/tenants', (_, res) => res.json({ tenants: [{ id: 'default', name: '默认租户' }], activeTenantId: 'default' }));
    web.get('/api/custom-tools/builtin-sync/preview', (_, res) => res.json({ pending: [], tools: [] }));
    web.get('/api/platform-promotions', (_, res) => res.json({ videos: [], links: [], desktopStack: false }));
    web.get(['/api/upload/history', '/api/friend-links', '/api/recent-nav'], (_, res) => res.json([]));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [] }));
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.use('/api', (_, res) => res.json({}));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(origin);
    await until(() => !!document.querySelector('[data-spot-dismiss]'), 'recommendation and close button');
    for (const [width, height, theme, language] of [[1440, 1000, 'dark', 'zh-CN'], [390, 844, 'light', 'en-US']]) {
        nativeTheme.themeSource = theme;
        win.setSize(width, height);
        await evaluate(lang => window.ToolsI18n.setLanguage(lang), language);
        await wait(150);
        const close = await evaluate(() => {
            const button = document.querySelector('[data-spot-dismiss]');
            button.scrollIntoView({ block: 'center', behavior: 'instant' });
            button.focus();
            const a = button.getBoundingClientRect(), b = dcSpotlight.getBoundingClientRect();
            const actions = document.querySelector('.dc-spot-actions').getBoundingClientRect();
            return { label: button.getAttribute('aria-label'), inside: a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom, clear: a.bottom <= actions.top || a.left >= actions.right, fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 };
        });
        assert.ok(close.label.includes(language === 'zh-CN' ? '本次登录' : 'sign in again'));
        assert.ok(close.inside && close.clear && close.fits, JSON.stringify(close));
        fs.writeFileSync(path.join(temp, `spotlight-${width}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    }
    otherWindow = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await otherWindow.loadURL(origin);
    await evaluate(() => {
        document.querySelector('[data-spot-step="1"]').click();
        document.querySelector('[data-spot-dismiss]').click();
    });
    await wait(450);
    assert.equal(await evaluate(() => dcSpotlight.hidden && !dcSpotlight.children.length), true, 'pending rotation cannot undo dismissal');
    assert.equal(await otherWindow.webContents.executeJavaScript('dcSpotlight.hidden'), true, 'another open page also hides recommendations');
    await evaluate(() => { window.DragonClaw.newChat(); window.ToolsI18n.setLanguage('zh-CN'); window.HomeMode.set('tools'); window.HomeMode.set('chat'); });
    assert.equal(await evaluate(() => dcSpotlight.hidden), true, 'new chats, mode and language changes retain dismissal');
    await win.loadURL(origin);
    await until(() => !!document.querySelector('#toolsGrid [data-tool-slug="fixture"]'), 'home reloaded');
    assert.equal(await evaluate(() => dcSpotlight.hidden), true, 'reload retains dismissal');
    await otherWindow.loadURL(origin);
    assert.equal(await otherWindow.webContents.executeJavaScript('dcSpotlight.hidden'), true, 'newly opened pages retain dismissal');
    await win.loadURL(origin + '/pages/login.html');
    await evaluate(() => { document.getElementById('username').value = 'fixture-admin'; document.getElementById('password').value = 'fixture-password'; document.getElementById('loginBtn').click(); });
    await until(() => document.getElementById('error-msg')?.textContent === 'Fixture login rejected', 'failed login');
    assert.equal(await evaluate(() => localStorage.getItem('dragon_claw_spotlight_dismissed')), '1', 'failed login must not reset dismissal');
    acceptLogin = true;
    await evaluate(() => document.getElementById('loginBtn').click());
    await until(() => !!document.querySelector('[data-spot-dismiss]') && !document.getElementById('dcSpotlight').hidden, 'recommendations return after successful login');
    assert.equal(await evaluate(() => localStorage.getItem('dragon_claw_spotlight_dismissed')), null);
    assert.equal(await otherWindow.webContents.executeJavaScript('dcSpotlight.hidden'), false, 'successful login restores other open pages');
    console.log('PASS: close button, desktop/mobile languages, pending carousel, cross-page dismissal, reload, failed login and successful login reset. Screenshots: ' + temp);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); otherWindow?.destroy(); server?.closeAllConnections(); server?.close();
    app.exit(process.exitCode || 0);
});
