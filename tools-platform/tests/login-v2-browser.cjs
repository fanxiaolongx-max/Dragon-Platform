// node_modules/.bin/electron tests/login-v2-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'login-v2-test-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();

let win, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(`(() => eval(${JSON.stringify(code)}))()`, true);
const until = (code, desc) => evaluate(`new Promise((resolve, reject) => {
    let n = 0;
    const poll = () => {
        if (${code}) resolve();
        else if (++n > 200) reject(new Error('Timeout waiting for: ' + ${JSON.stringify(desc || code)}));
        else setTimeout(poll, 25);
    };
    poll();
})`);

setTimeout(() => {
    console.error('Test timed out after 45s');
    app.exit(1);
}, 45000).unref();

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());

    // Login page endpoint
    web.get(['/', '/login', '/pages/login.html'], (req, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/pages/login.html'), 'utf8')
            .replace(/@import url\([^;]+;/g, '');
        res.type('html').send(html);
    });

    web.get('/api/app-version', (_, res) => res.json({ name: 'Dragon Platform', version: '1.0.530' }));
    web.get('/api/platform-identity', (_, res) => res.json({ platformName: 'Dragon 工具平台', platformNameEn: 'Dragon Platform' }));
    web.get('/api/desktop-license/status', (_, res) => res.json({ enabled: false, valid: true }));
    web.post('/api/auth/login', (req, res) => {
        const { username, password } = req.body || {};
        if (username === 'admin' && password === 'admin123') {
            return res.json({
                success: true,
                token: 'tok_test_123',
                username: 'admin',
                role: 'admin',
                tenantId: 'default'
            });
        }
        res.status(401).json({ error: '账号或密码错误' });
    });
    web.use(express.static(path.join(root, 'frontend')));

    server = await new Promise(resolve => {
        const listener = web.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    // Note: use userAgent without 'Electron' so we can test both web and desktop modes
    win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });
    win.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // --- 1. Default load: v2 light theme ---
    await win.webContents.session.clearStorageData();
    await win.loadURL(origin + '/login');
    await until('!!document.getElementById("loginPanel")', 'login panel ready');

    const state1 = await evaluate(`({
        ui: document.documentElement.getAttribute('data-ui'),
        theme: document.documentElement.getAttribute('data-theme'),
        hasV2Head: !document.querySelector('.v2-login-head').hidden && getComputedStyle(document.querySelector('.v2-login-head')).display !== 'none',
        mascotSrc: document.querySelector('.v2-login-mascot')?.getAttribute('src'),
        brandTitle: document.querySelector('.v2-login-head h1')?.textContent,
        btnPlayGameDisplay: getComputedStyle(document.querySelector('.btn-play-game')).display,
        btnCinemaDisplay: getComputedStyle(document.querySelector('.btn-cinema')).display,
        footerEntertainmentDisplay: getComputedStyle(document.querySelector('.footer-entertainment-item')).display
    })`);

    assert.equal(state1.ui, 'v2', 'Default login page uses data-ui="v2"');
    assert.equal(state1.theme, 'light', 'Default login page uses data-theme="light"');
    assert.equal(state1.hasV2Head, true, 'v2 brand header is visible');
    assert.equal(state1.brandTitle, 'DragonClaw', 'Brand title is DragonClaw');
    assert.ok(state1.mascotSrc.includes('dragonclaw-mascot'), 'Cartoon dragon mascot is shown');
    assert.equal(state1.btnPlayGameDisplay, 'none', 'Big btn-play-game is hidden in v2');
    assert.equal(state1.btnCinemaDisplay, 'none', 'Big btn-cinema is hidden in v2');
    assert.notEqual(state1.footerEntertainmentDisplay, 'none', 'Footer entertainment items are visible on web');

    // --- 2. Mini-game toggle from footer link ---
    await evaluate(`document.querySelector('.footer-entertainment-item[data-i18n="login.playGame"]').click()`);
    assert.equal(await evaluate('document.getElementById("gameWrapper").classList.contains("active")'), true, 'Game wrapper opens');
    assert.ok(await evaluate('document.getElementById("gameIframe").getAttribute("src").includes("knight-dreams")'), 'Game iframe loaded');
    await evaluate(`document.querySelector('.btn-close-game').click()`);
    assert.equal(await evaluate('document.getElementById("gameWrapper").classList.contains("active")'), false, 'Game wrapper closes');

    // --- 3. Desktop mode hiding ---
    // Simulate desktop environment
    await evaluate(`document.documentElement.setAttribute('data-desktop', 'true')`);
    const stateDesktop = await evaluate(`({
        footerEntertainmentDisplay: getComputedStyle(document.querySelector('.footer-entertainment-item')).display,
        btnPlayGameDisplay: getComputedStyle(document.querySelector('.btn-play-game')).display
    })`);
    assert.equal(stateDesktop.footerEntertainmentDisplay, 'none', 'Desktop mode hides footer entertainment link');
    assert.equal(stateDesktop.btnPlayGameDisplay, 'none', 'Desktop mode hides card entertainment button');
    await evaluate(`document.documentElement.removeAttribute('data-desktop')`);

    // --- 4. Dark theme follows tools_theme ---
    await evaluate(`localStorage.setItem('tools_theme', 'dark')`);
    await win.loadURL(origin + '/login');
    await until('!!document.getElementById("loginPanel")');
    assert.equal(await evaluate('document.documentElement.getAttribute("data-theme")'), 'dark', 'Dark theme remembered and applied');

    // --- 5. Switch to v1 via ?ui=v1 and remember ---
    await win.loadURL(origin + '/login?ui=v1');
    await until('!!document.getElementById("loginPanel")');
    const stateV1 = await evaluate(`({
        ui: document.documentElement.getAttribute('data-ui'),
        savedUi: localStorage.getItem('tools_home_ui'),
        v2HeadDisplay: getComputedStyle(document.querySelector('.v2-login-head')).display,
        brandHeaderDisplay: getComputedStyle(document.querySelector('.login-brand-header')).display,
        btnPlayGameDisplay: getComputedStyle(document.querySelector('.btn-play-game')).display,
        footerEntertainmentDisplay: getComputedStyle(document.querySelector('.footer-entertainment-item')).display
    })`);
    assert.equal(stateV1.ui, null, 'v1 UI does not have data-ui="v2"');
    assert.equal(stateV1.savedUi, 'v1', 'Remembered ui=v1 in localStorage');
    assert.equal(stateV1.v2HeadDisplay, 'none', 'v2 head is hidden in v1');
    assert.notEqual(stateV1.brandHeaderDisplay, 'none', 'Original brand header is visible in v1');
    assert.notEqual(stateV1.btnPlayGameDisplay, 'none', 'Original big button is visible on web in v1');
    assert.equal(stateV1.footerEntertainmentDisplay, 'none', 'Footer entertainment is hidden in v1');

    // --- 6. Switch back to v2 via ?ui=v2 ---
    await win.loadURL(origin + '/login?ui=v2');
    await until('!!document.getElementById("loginPanel")');
    assert.equal(await evaluate('document.documentElement.getAttribute("data-ui")'), 'v2');
    assert.equal(await evaluate('localStorage.getItem("tools_home_ui")'), 'v2');

    // --- 7. Empty fields validation ---
    await evaluate(`document.getElementById('username').value = ''; document.getElementById('password').value = '';`);
    await evaluate(`document.getElementById('loginBtn').click()`);
    const emptyErr = await evaluate('document.getElementById("error-msg").textContent');
    assert.equal(emptyErr, '用户名和密码不能为空', 'Shows empty fields error');

    // --- 8. Failed login rejection ---
    await evaluate(`document.getElementById('username').value = 'admin'; document.getElementById('password').value = 'wrongpassword';`);
    await evaluate(`document.getElementById('loginBtn').click()`);
    await until('document.getElementById("error-msg").textContent.includes("错误")', 'error message populated');
    const failErr = await evaluate('document.getElementById("error-msg").textContent');
    assert.equal(failErr, '账号或密码错误', 'Shows rejection error');

    // --- 9. Successful login flow ---
    await evaluate(`document.getElementById('username').value = 'admin'; document.getElementById('password').value = 'admin123';`);
    await evaluate(`document.getElementById('loginBtn').click()`);
    await until('localStorage.getItem("tools_token") === "tok_test_123"', 'token saved in localStorage');
    assert.equal(await evaluate('localStorage.getItem("tools_user")'), 'admin');

    console.log('PASS: Login page v2 style, light/dark themes, desktop/web entertainment toggles, and login flow all verified!');
    server.close();
    app.quit();
});
