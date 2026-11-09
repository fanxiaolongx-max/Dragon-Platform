// node_modules/.bin/electron tests/login-cinema-gating-browser.cjs
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

let currentMediaEnabled = false;

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());

    web.get(['/', '/login', '/pages/login.html'], (req, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/pages/login.html'), 'utf8')
            .replace(/@import url\([^;]+;/g, '');
        res.type('html').send(html);
    });

    web.get('/api/app-version', (_, res) => res.json({ name: 'Dragon Platform', version: '1.0.530' }));
    web.get('/api/platform-identity', (_, res) => res.json({
        platformName: 'Dragon 工具平台',
        platformNameEn: 'Dragon Platform',
        mediaEnabled: currentMediaEnabled
    }));
    web.get('/api/media/public/status', (_, res) => res.json({
        success: true,
        enabled: currentMediaEnabled
    }));
    web.get('/api/desktop-license/status', (_, res) => res.json({ enabled: false, valid: true }));
    web.use(express.static(path.join(root, 'frontend')));

    const server = http.createServer(web);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    win.webContents.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const evaluate = code => win.webContents.executeJavaScript(code);
    const until = async (expr, desc, maxMs = 5000) => {
        const start = Date.now();
        while (Date.now() - start < maxMs) {
            if (await evaluate(expr)) return;
            await new Promise(r => setTimeout(r, 50));
        }
        throw new Error(`Timeout waiting for ${desc}`);
    };

    // --- 1. 媒体功能停用状态（默认 v2 UI） ---
    currentMediaEnabled = false;
    await win.webContents.session.clearStorageData();
    await win.loadURL(origin + '/login');
    await until('!!document.getElementById("loginPanel")', 'login panel ready');
    // 等待 platform-identity 完成
    await new Promise(r => setTimeout(r, 200));

    const stateDisabledV2 = await evaluate(`({
        mediaAttr: document.documentElement.getAttribute('data-media-enabled'),
        btnCinemaDisplay: getComputedStyle(document.querySelector('.btn-cinema')).display,
        footerCinemaDisplay: getComputedStyle(document.querySelector('.footer-cinema-link')).display,
        footerCinemaDividerDisplay: getComputedStyle(document.querySelector('.footer-cinema-divider')).display,
        footerGameDisplay: getComputedStyle(document.querySelector('.footer-game-link')).display
    })`);

    assert.equal(stateDisabledV2.mediaAttr, null, 'data-media-enabled should not be set when disabled');
    assert.equal(stateDisabledV2.btnCinemaDisplay, 'none', 'btn-cinema is hidden when media is disabled');
    assert.equal(stateDisabledV2.footerCinemaDisplay, 'none', 'footer-cinema-link is hidden when media is disabled');
    assert.equal(stateDisabledV2.footerCinemaDividerDisplay, 'none', 'footer-cinema-divider is hidden when media is disabled');
    assert.notEqual(stateDisabledV2.footerGameDisplay, 'none', 'footer-game-link remains visible');

    // --- 2. 媒体功能启用状态（v2 UI） ---
    currentMediaEnabled = true;
    await win.loadURL(origin + '/login');
    await until('!!document.getElementById("loginPanel")', 'login panel ready');
    await until('document.documentElement.getAttribute("data-media-enabled") === "true"', 'media enabled attribute applied');

    const stateEnabledV2 = await evaluate(`({
        mediaAttr: document.documentElement.getAttribute('data-media-enabled'),
        btnCinemaDisplay: getComputedStyle(document.querySelector('.btn-cinema')).display,
        footerCinemaDisplay: getComputedStyle(document.querySelector('.footer-cinema-link')).display,
        footerCinemaDividerDisplay: getComputedStyle(document.querySelector('.footer-cinema-divider')).display
    })`);

    assert.equal(stateEnabledV2.mediaAttr, 'true', 'data-media-enabled is true when media is enabled');
    assert.equal(stateEnabledV2.btnCinemaDisplay, 'none', 'Big btn-cinema stays hidden under v2');
    assert.notEqual(stateEnabledV2.footerCinemaDisplay, 'none', 'footer-cinema-link is visible under v2 when media is enabled');
    assert.notEqual(stateEnabledV2.footerCinemaDividerDisplay, 'none', 'footer-cinema-divider is visible under v2 when media is enabled');

    // --- 3. 媒体功能启用状态（v1 UI） ---
    await win.loadURL(origin + '/login?ui=v1');
    await until('!!document.getElementById("loginPanel")', 'login panel ready');
    await until('document.documentElement.getAttribute("data-media-enabled") === "true"', 'media enabled attribute applied');

    const stateEnabledV1 = await evaluate(`({
        btnCinemaDisplay: getComputedStyle(document.querySelector('.btn-cinema')).display,
        footerCinemaDisplay: getComputedStyle(document.querySelector('.footer-cinema-link')).display
    })`);

    assert.notEqual(stateEnabledV1.btnCinemaDisplay, 'none', 'Big btn-cinema is visible under v1 when media is enabled');
    assert.equal(stateEnabledV1.footerCinemaDisplay, 'none', 'footer-cinema-link is hidden under v1');

    // --- 4. 媒体功能停用状态（v1 UI） ---
    currentMediaEnabled = false;
    await win.loadURL(origin + '/login?ui=v1');
    await until('!!document.getElementById("loginPanel")', 'login panel ready');
    await new Promise(r => setTimeout(r, 200));

    const stateDisabledV1 = await evaluate(`({
        btnCinemaDisplay: getComputedStyle(document.querySelector('.btn-cinema')).display,
        footerCinemaDisplay: getComputedStyle(document.querySelector('.footer-cinema-link')).display
    })`);

    assert.equal(stateDisabledV1.btnCinemaDisplay, 'none', 'Big btn-cinema is hidden under v1 when media is disabled');
    assert.equal(stateDisabledV1.footerCinemaDisplay, 'none', 'footer-cinema-link is hidden under v1');

    // --- 5. 桌面模式（无论 v1 还是 v2 均隐藏） ---
    currentMediaEnabled = true;
    await win.loadURL(origin + '/login?ui=v2');
    await until('!!document.getElementById("loginPanel")', 'login panel ready');
    await evaluate(`document.documentElement.setAttribute('data-desktop', 'true')`);

    const stateDesktop = await evaluate(`({
        btnCinemaDisplay: getComputedStyle(document.querySelector('.btn-cinema')).display,
        footerCinemaDisplay: getComputedStyle(document.querySelector('.footer-cinema-link')).display
    })`);

    assert.equal(stateDesktop.btnCinemaDisplay, 'none', 'Desktop mode hides btn-cinema');
    assert.equal(stateDesktop.footerCinemaDisplay, 'none', 'Desktop mode hides footer-cinema-link');

    console.log('PASS: Login cinema gating verified across v1/v2, enabled/disabled and desktop states!');
    server.close();
    app.quit();
});
