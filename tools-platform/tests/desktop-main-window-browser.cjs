// node_modules/.bin/electron --disable-gpu tests/desktop-main-window-browser.cjs
// 桌面端主窗口（desktop-main-window.js + frontend/js/shared/desktop-window.js）：Windows 外观（左上角三个按钮）、
// 拖动区、最大化 / 还原 / 最小化、关闭隐藏到托盘、浏览器快捷键无效、站外链接不在窗口内打开。全部用临时配置与本地页面。
process.env.TOOLS_DESKTOP_WIN_CHROME = '1';
const electron = require('electron');
const { app } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-main-window-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const opened = [];
electron.shell.openExternal = async url => { opened.push(url); };   // 不真的打开系统浏览器
const { createMainWindowController } = require('../desktop-main-window');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
    for (let i = 0; i < 200; i++) { if (await fn()) return; await wait(40); }
    throw new Error('Timed out: ' + label);
}
const timeout = setTimeout(() => { console.error('Main window test timed out'); app.exit(1); }, 60000);
let quitting = false;

app.whenReady().then(async () => {
    const web = express();
    const frontend = path.join(__dirname, '../frontend');
    const page = title => `<!doctype html><html data-ui="v2" lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
        <link rel="stylesheet" href="/css/home-v2.css"></head>
        <body><aside class="home-sidebar" style="position:fixed;left:0;top:0;bottom:0;width:240px;background:#f7f7f8">
        <div class="v2-side-top"><div class="v2-side-tools"><button class="v2-icon-btn" id="sideBtn">▤</button></div></div></aside>
        <main style="margin-left:240px;padding:60px"><h1 id="title">${title}</h1><input id="field" value="text"><a id="out" href="https://example.com/">out</a></main>
        <script src="/js/shared/desktop-window.js"></script></body></html>`;
    web.get('/', (_req, res) => res.send(page('home')));
    web.get('/second', (_req, res) => res.send(page('second')));
    web.use(express.static(frontend));
    const server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/`;

    const controller = createMainWindowController({
        getBaseUrl: () => base,
        getIconPath: () => path.join(frontend, 'assets/icon-windows.png'),
        statePath: path.join(temp, 'main-window-state.json'),
        isQuitting: () => quitting,
        preloadPath: path.join(__dirname, '../electron-preload.js')
    });
    controller.registerIpc();
    assert.equal(controller.open('/'), true);
    const win = () => controller.window;
    await until(() => win() && win().isVisible() && !win().webContents.isLoading(), 'window shown');
    const js = code => win().webContents.executeJavaScript(code);
    await until(() => js('!!document.querySelector(".desktop-controls")'), 'controls rendered');

    // 外观：Windows 外观的三个按钮、拖动区与可点区域
    assert.deepEqual(await js('[...document.querySelectorAll(".desktop-controls button")].map(b => b.dataset.act)'), ['close', 'minimize', 'maximize']);
    assert.equal(await js('document.documentElement.classList.contains("desktop-win")'), true);
    assert.equal(await js('getComputedStyle(document.querySelector(".v2-side-tools")).webkitAppRegion || getComputedStyle(document.querySelector(".v2-side-tools")).getPropertyValue("-webkit-app-region")'), 'drag');
    assert.equal(await js('getComputedStyle(document.getElementById("sideBtn")).getPropertyValue("-webkit-app-region")'), 'no-drag');
    assert.equal(await js('getComputedStyle(document.querySelector(".desktop-controls")).getPropertyValue("-webkit-app-region")'), 'no-drag');
    for (const mode of ['', 'dc-chatting', 'v2-hub-open', 'v2-tool-open']) {
        const region = await js(`(() => { document.body.className=${JSON.stringify(mode)};
            const strip=document.querySelector('.desktop-drag');
            return {display:getComputedStyle(strip).display,region:getComputedStyle(strip).getPropertyValue('-webkit-app-region'),hit:document.elementFromPoint(innerWidth/2,8)===strip}; })()`);
        assert.notEqual(region.display, 'none', mode+' keeps its top drag strip');
        assert.equal(region.region,'drag');
        assert.equal(region.hit,true,mode+' top strip stays above page content');
    }
    await js('document.body.className=""');
    const rect = await js('JSON.stringify(document.querySelector(".desktop-controls").getBoundingClientRect())');
    const box = JSON.parse(rect);
    assert.ok(box.left < 30 && box.top < 40, `controls at top-left: ${rect}`);
    assert.ok(await js('document.querySelector(".v2-side-tools").getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector(".v2-side-tools")).paddingLeft) > document.querySelector(".desktop-controls").getBoundingClientRect().right'), 'sidebar tools leave room for the buttons');
    const shot = await win().webContents.capturePage();
    fs.writeFileSync(path.join(temp, 'main-window.png'), shot.toPNG());

    // 最大化 / 还原（按钮图标与提示跟着变）、最小化
    await js('document.querySelector("[data-act=maximize]").click()');
    await until(() => win().isMaximized(), 'maximized');
    await until(() => js('document.querySelector("[data-act=maximize]").title === "还原"'), 'restore label');
    await js('document.querySelector("[data-act=maximize]").click()');
    await until(() => !win().isMaximized(), 'restored');
    await until(() => js('document.querySelector("[data-act=maximize]").title === "最大化"'), 'maximize label');
    await js('document.querySelector("[data-act=minimize]").click()');
    await until(() => win().isMinimized(), 'minimized');
    win().restore();
    await until(() => !win().isMinimized(), 'restored from minimize');

    // 浏览器快捷键无效：刷新 / 开发者工具
    await js('window.__marker = 42');
    for (const [keyCode, modifiers] of [['R', ['control']], ['F5', []], ['I', ['control', 'shift']], ['F12', []]]) {
        win().webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        win().webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }
    await wait(400);
    assert.equal(await js('window.__marker'), 42, 'page was not reloaded');
    assert.equal(win().webContents.isDevToolsOpened(), false);

    // 站外链接：不在窗口内跳转，交给系统浏览器
    await js('document.getElementById("out").click()');
    await until(() => opened.includes('https://example.com/'), 'external link handed to system browser');
    assert.equal(new URL(win().webContents.getURL()).origin, new URL(base).origin);

    // 关闭 = 隐藏到托盘；再次打开回到窗口并显示指定页面
    await js('document.querySelector("[data-act=close]").click()');
    await until(() => !win().isVisible(), 'hidden on close');
    assert.ok(controller.window, 'window kept alive in tray');
    controller.open('/second');
    await until(() => win().isVisible() && js('document.getElementById("title")?.textContent === "second"'), 'reopened on second page');

    // 位置与大小记下来
    await wait(600);
    const saved = JSON.parse(fs.readFileSync(path.join(temp, 'main-window-state.json'), 'utf8'));
    assert.ok(saved.bounds && saved.bounds.width >= 900);

    quitting = true;
    controller.destroy();
    server.close();
    clearTimeout(timeout);
    console.log(`desktop main window ok — screenshot: ${path.join(temp, 'main-window.png')}`);
    app.exit(0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
