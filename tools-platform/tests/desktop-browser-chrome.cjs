// node_modules/.bin/electron --disable-gpu tests/desktop-browser-chrome.cjs
// 真实 Electron 交互，全部使用临时配置、本地页面和临时下载目录。
const { app, BrowserWindow, ipcMain, Menu, nativeTheme, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-chrome-'));
app.setPath('userData', path.join(temp, 'profile'));
fs.mkdirSync(path.join(temp, 'Downloads')); app.setPath('downloads', path.join(temp, 'Downloads'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {}); // 测试会销毁并重建整个浏览器配置。
const { createPromoStack, PARTITION } = require('../desktop-promo/promo-stack');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (wc, fn, ...args) => wc.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`);
const ui = (fn, ...args) => evaluate(win.webContents, fn, ...args);
const page = () => win.getBrowserViews()[0].webContents;
const order = () => ui(() => [...document.querySelectorAll('.tab')].map(node => node.dataset.id));
const key = (keyCode, modifiers = ['control']) => page().sendInputEvent({ type: 'keyDown', keyCode, modifiers });
let stack, server, win, language = 'zh-CN';
async function until(fn) {
    for (let i = 0; i < 160; i++) { if (await fn()) return; await wait(40); }
    throw new Error('Timed out: ' + fn);
}
const errors = [];
const timeout = setTimeout(() => { console.error('Chrome test timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
    const web = express();
    web.get(['/one', '/two', '/three'], (req, res) => res.send(`<title>${req.path}</title><h1>Project ${req.path}</h1><p>Dragon Dragon Dragon</p><input id="value" value="initial">`));
    web.get('/file', (_req, res) => {
        res.set({ 'Content-Disposition': 'attachment; filename="project.txt"', 'Content-Length': String(64 * 1024 * 80), 'Content-Type': 'application/octet-stream' });
        let sent = 0;
        const timer = setInterval(() => { res.write(Buffer.alloc(64 * 1024, 65)); if (++sent === 80) { clearInterval(timer); res.end(); } }, 40);
        res.on('close', () => clearInterval(timer));
    });
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const extensionsStatePath = path.join(temp, 'extensions.json');
    fs.writeFileSync(extensionsStatePath, JSON.stringify({ imported: [], disabled: ['auto:icpm', 'bundled:chrome-capture-pro', 'bundled:overseas-salary-calculator'] }));
    stack = createPromoStack({ statePath: path.join(temp, 'stack.json'), extensionsStatePath, getLanguage: () => language });
    ipcMain.on('promo-card:action', (event, action, payload) => stack.handleAction(event.sender, action, payload));
    await stack.init();
    for (const suffix of ['/one', '/two', '/three']) stack.open({ name: suffix, url: base + suffix });
    win = BrowserWindow.getAllWindows()[0];
    win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    await until(() => order().then(items => items.length === 3));
    await until(() => evaluate(page(), () => !!document.querySelector('#value')));
    await evaluate(page(), () => { document.querySelector('#value').value = 'kept'; });
    const initial = await order(), contents = page();

    // 真实鼠标事件覆盖品牌文字、标签列表空白和两行标题栏间隙。
    win.focus(); win.webContents.focus();
    await ui(() => document.addEventListener('pointerdown', event => { window.testPointer = { id: event.pointerId, x: event.screenX, y: event.screenY }; }));
    for (const [x, y] of [[20, 14], [450, 1], [4, 50]]) {
        const before = win.getBounds();
        await ui(() => { window.testPointer = null; });
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await until(() => ui(() => !!window.testPointer));
        // Electron 28 sendInputEvent 的 screenX/Y 恒为 0，补发全局坐标移动。
        await ui(() => document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: window.testPointer.id, screenX: window.testPointer.x + 30, screenY: window.testPointer.y + 20, buttons: 1 })));
        await until(() => win.getBounds().x !== before.x);
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await wait(60);
        assert.equal(win.getBounds().x, before.x + 30); assert.equal(win.getBounds().y, before.y + 20);
    }
    for (const maximized of [true, false]) {
        win.webContents.sendInputEvent({ type: 'mouseDown', x: 20, y: 14, button: 'left', clickCount: 2 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: 20, y: 14, button: 'left', clickCount: 2 });
        await until(() => win.isMaximized() === maximized);
    }
    // 标签拖动改变主进程顺序；状态刷新不回跳，页面实例和输入保持。
    const points = await ui(() => [...document.querySelectorAll('.tab')].map(node => { const b = node.getBoundingClientRect(); return { x: Math.round(b.left + 35), y: Math.round(b.top + 12) }; }));
    win.webContents.sendInputEvent({ type: 'mouseDown', ...points[0], button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: points[2].x + 100, y: points[0].y, modifiers: ['leftButtonDown'] });
    await wait(150);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: points[2].x + 100, y: points[0].y, button: 'left', clickCount: 1 });
    await until(() => order().then(ids => ids[2] === initial[0]));
    stack.languageChanged(); await wait(60);
    assert.deepEqual(await order(), [initial[1], initial[2], initial[0]]);
    assert.equal(page(), contents); assert.equal(await evaluate(contents, () => document.querySelector('#value').value), 'kept');
    stack.handleAction(contents, 'tab-move', { id: initial[0], beforeId: initial[1] });
    stack.handleAction(win.webContents, 'tab-move', { id: initial[0], beforeId: 'unknown' });
    await wait(60); assert.deepEqual(await order(), [initial[1], initial[2], initial[0]]);
    console.log('Checked real titlebar dragging, double-click maximize/restore, tab sorting and IPC boundary.');

    // 真实 Ctrl+滚轮、快捷键和显示比例同步。
    contents.focus();
    contents.sendInputEvent({ type: 'mouseWheel', x: 100, y: 100, deltaY: 120, modifiers: ['control'], canScroll: true });
    await until(() => Math.abs(contents.getZoomFactor() - 1) > .01);
    await until(() => ui(() => !document.querySelector('#zoomBtn').hidden));
    key('0'); await until(() => Math.abs(contents.getZoomFactor() - 1) < .001);
    key('+'); await until(() => contents.getZoomFactor() > 1);
    await ui(() => document.querySelector('#zoomBtn').click()); await until(() => Math.abs(contents.getZoomFactor() - 1) < .001);
    key('F'); await until(() => ui(() => !document.querySelector('#findBar').hidden));
    await ui(() => { const input = document.querySelector('#findInput'); input.focus(); input.value = 'Dragon'; input.dispatchEvent(new Event('input')); });
    await until(() => ui(() => document.querySelector('#findCount').textContent === '1/3'));
    await ui(() => document.querySelector('#findNext').click());
    await until(() => ui(() => document.querySelector('#findCount').textContent === '2/3'));
    await ui(() => document.querySelector('#findClose').click());
    await until(() => win.getBrowserViews()[0].getBounds().y === 74);
    contents.focus(); key('D'); await until(() => ui(() => document.querySelector('#bookmarkBtn').dataset.saved === 'true'));
    key('H'); await until(() => ui(() => document.querySelector('#chromePanel').dataset.panel === 'history' && document.querySelector('#panelItems').textContent.includes('/three')));
    assert.equal(win.getBrowserViews()[0].getBounds().y, 314);
    await ui(() => document.querySelector('#panelClose').click());

    let template; const originalBuild = Menu.buildFromTemplate;
    Menu.buildFromTemplate = value => { template = value; return { popup() {} }; };
    try { stack.handleAction(win.webContents, 'tab-menu', initial[2]); }
    finally { Menu.buildFromTemplate = originalBuild; }
    template.find(item => item.label === '复制标签页').click();
    await until(() => order().then(ids => ids.length === 4));
    await until(() => page().getURL() === base + '/three');
    key('W'); await until(() => order().then(ids => ids.length === 3));
    key('T', ['control', 'shift']); await until(() => order().then(ids => ids.length === 4));
    await until(() => page().getURL() === base + '/three');
    console.log('Checked Ctrl+wheel, zoom shortcuts, find matches, bookmarks, history, duplicate and reopen.');

    // 下载自动提示、进度、暂停继续、完成、取消；临时目录内真实写文件。
    const downloadsSession = session.fromPartition(PARTITION);
    let item;
    downloadsSession.once('will-download', (_event, value) => { item = value; });
    page().downloadURL(base + '/file');
    await until(() => ui(() => document.querySelector('#chromePanel').dataset.panel === 'downloads' && !!document.querySelector('progress')));
    await until(() => ui(() => document.querySelector('progress').value > 0));
    await ui(() => { window.pauseButton = [...document.querySelectorAll('#panelItems button')].find(button => button.textContent === '暂停'); });
    await wait(350);
    assert.equal(await ui(() => window.pauseButton === [...document.querySelectorAll('#panelItems button')].find(button => button.textContent === '暂停')), true, 'progress updates preserve the controls and keyboard focus');
    await ui(() => [...document.querySelectorAll('#panelItems button')].find(button => button.textContent === '暂停').click());
    await until(() => item.isPaused());
    await until(() => ui(() => document.querySelector('#panelItems').textContent.includes('已暂停')));
    await ui(() => [...document.querySelectorAll('#panelItems button')].find(button => button.textContent === '继续').click());
    await until(() => !item.isPaused());
    await ui(() => document.querySelector('#panelClose').click());
    await until(() => ui(() => !document.querySelector('#downloadNotice').hidden && document.querySelector('#noticeText').textContent.includes('下载完成')));
    await ui(() => document.querySelector('#noticeView').click());
    await until(() => ui(() => document.querySelector('#panelItems').textContent.includes('下载完成')));
    assert.equal(fs.statSync(path.join(temp, 'Downloads/project.txt')).size, 64 * 1024 * 80);
    assert.equal(await ui(() => [...document.querySelectorAll('#panelItems button')].some(button => button.textContent === '打开文件')), true);
    page().downloadURL(base + '/file');
    await until(() => ui(() => !!document.querySelector('progress')));
    await ui(() => [...document.querySelectorAll('#panelItems button')].find(button => button.textContent === '取消').click());
    await until(() => ui(() => document.querySelector('#panelItems').textContent.includes('已取消')));

    // 窄窗双语、深浅色，带完整下载面板；检查内容与窗口边界。
    win.setSize(640, 520);
    for (const [lang, theme] of [['zh-CN', 'dark'], ['en-US', 'light']]) {
        language = lang; nativeTheme.themeSource = theme; stack.languageChanged(); await wait(160);
        assert.equal(await ui(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await ui(() => document.querySelector('#closeBtn').getBoundingClientRect().right <= innerWidth), true);
        fs.writeFileSync(path.join(temp, theme + '.png'), (await win.webContents.capturePage({ x: 0, y: 0, width: 640, height: 314 })).toPNG());
    }
    assert.deepEqual(errors, []);
    // 整个浏览器配置重建后，收藏、历史和已完成下载仍存在。
    stack.destroy(); await wait(250);
    stack = createPromoStack({ statePath: path.join(temp, 'stack.json'), extensionsStatePath, getLanguage: () => language });
    await stack.init(); stack.open({ name: 'restored', url: base + '/three' });
    win = BrowserWindow.getAllWindows()[0];
    await until(() => ui(() => document.querySelector('#bookmarkBtn').dataset.saved === 'true'));
    stack.handleAction(win.webContents, 'downloads');
    await until(() => ui(() => document.querySelector('#panelItems').textContent.includes('Completed')));
    console.log('PASS: browser chrome, downloads lifecycle, SQLite restart persistence and bilingual 640px dark/light panels. Screenshots: ' + temp);
}).then(async () => { clearTimeout(timeout); stack?.destroy(); server?.close(); await wait(200); app.quit(); }).catch(error => {
    console.error(error); clearTimeout(timeout); stack?.destroy(); server?.close(); app.exit(1);
});
