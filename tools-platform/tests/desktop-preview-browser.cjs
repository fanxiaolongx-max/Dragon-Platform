// node_modules/.bin/electron tests/desktop-preview-browser.cjs
// 只使用本地模拟站点；不连接公司认证服务。
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-preview-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
const extensionsStatePath = path.join(temp, 'extensions.json');
fs.writeFileSync(extensionsStatePath, JSON.stringify({ imported: [], disabled: ['auto:icpm', 'bundled:chrome-capture-pro', 'bundled:overseas-salary-calculator'] }));
const { createPromoStack } = require('../desktop-promo/promo-stack');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let stack, server, iframeServer;
async function until(fn) {
    for (let i = 0; i < 100; i++) { if (await fn()) return; await wait(50); }
    throw new Error('Timed out: ' + fn);
}
const listen = web => new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
const evaluate = (wc, fn) => wc.executeJavaScript(`(${fn})()`);
app.whenReady().then(async () => {
    const nested = express();
    nested.get('/', (_, res) => res.send('<html><body style="margin:0"><div style="width:2000px;height:1200px;background:#cfeafa">Nested scroll area</div></body></html>'));
    iframeServer = await listen(nested);
    const nestedUrl = `http://127.0.0.1:${iframeServer.address().port}`;
    const web = express();
    web.get('/', (_, res) => res.send(`<!doctype html><html><body style="margin:0;background:#eaf7f5">
        <header style="height:90px;background:#087e8b;color:white;font:32px sans-serif">Desktop overview</header>
        <main style="width:1600px;display:flex;justify-content:space-between"><div>LEFT</div><div>RIGHT</div></main>
        <div style="width:100%;height:140px;overflow:scroll"><div style="width:2400px;height:300px;background:#fce6a0">Inner scrollbar</div></div>
        <iframe src="${nestedUrl}" style="width:100%;height:450px;border:0"></iframe>
        <input id="input" value="preserved"><script>setTimeout(() => {const frame=document.createElement('iframe');frame.src='${nestedUrl}';document.body.append(frame)},400)</script>
        </body></html>`));
    server = await listen(web);
    const url = `http://127.0.0.1:${server.address().port}/`;
    stack = createPromoStack({ statePath: path.join(temp, 'stack.json'), extensionsStatePath });
    stack.sync({ desktopStack: true, maxLinks: 1, links: [{ id: 'fixture', enabled: true, name: 'Preview fixture', url }] });
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.getBrowserViews()[0].webContents;
    await until(() => evaluate(wc, () => document.querySelectorAll('iframe').length === 2));
    await until(async () => {
        const values = await Promise.all(wc.mainFrame.framesInSubtree.map(frame => frame.executeJavaScript('!!document.getElementById("tools-desktop-preview-scrollbars")')));
        return values.length === 3 && values.every(Boolean);
    });
    assert.equal(win.isResizable(), false);
    assert.ok(await evaluate(wc, () => innerWidth >= 1600), 'renders a desktop viewport rather than squeezing the site into a narrow viewport');
    assert.equal(await evaluate(wc, () => getComputedStyle(document.querySelector('main')).width), '1600px');
    for (const frame of wc.mainFrame.framesInSubtree) {
        assert.equal(await frame.executeJavaScript('getComputedStyle(document.body).overflow'), 'hidden');
        assert.equal(await frame.executeJavaScript('getComputedStyle(document.body,"::-webkit-scrollbar").display'), 'none');
    }
    await wait(250);
    fs.writeFileSync(path.join(temp, 'preview.png'), (await wc.capturePage()).toPNG());
    assert.ok(await stack.frame('fixture'), 'homepage live frame remains available');
    stack.handleAction(win.webContents, 'expand');
    const dragon = BrowserWindow.getAllWindows().find(item => item !== win);
    await until(() => evaluate(wc, () => !document.getElementById('tools-desktop-preview-scrollbars')));
    assert.equal(wc.getZoomFactor(), 1);
    for (const frame of wc.mainFrame.framesInSubtree) assert.equal(await frame.executeJavaScript('!!document.getElementById("tools-desktop-preview-scrollbars")'), false);
    assert.equal(await evaluate(wc, () => getComputedStyle(document.body).overflow), 'visible');
    await evaluate(wc, () => { document.querySelector('#input').value = 'kept after collapse'; });
    stack.handleAction(dragon.webContents, 'minimize');
    await until(() => evaluate(wc, () => !!document.getElementById('tools-desktop-preview-scrollbars')));
    assert.equal(await evaluate(wc, () => document.querySelector('#input').value), 'kept after collapse');
    // 脚本入口复用 Dragon 大窗，新建标签；关闭大窗后恢复预览。
    stack.putSiteScript({ origin: new URL(url).origin, url, name: 'Fixture', code: 'window.fixtureScript = true' });
    const tool = BrowserWindow.getAllWindows().find(item => item !== win);
    assert.equal(tool, dragon);
    const toolContents = tool.getBrowserViews()[0].webContents;
    await until(() => evaluate(toolContents, () => !!document.querySelector('#input')));
    assert.equal(await evaluate(toolContents, () => !!document.getElementById('tools-desktop-preview-scrollbars')), false);
    assert.equal(toolContents.getZoomFactor(), 1);
    stack.handleAction(tool.webContents, 'close');
    await until(() => evaluate(wc, () => !!document.getElementById('tools-desktop-preview-scrollbars')));
    assert.ok(await evaluate(wc, () => innerWidth >= 1600));
    await new Promise(resolve => { wc.once('did-finish-load', resolve); wc.reload(); });
    await until(() => evaluate(wc, () => !!document.getElementById('tools-desktop-preview-scrollbars')));
    console.log('PASS: desktop viewport fit, nested/cross-origin/late iframe scrollbars, expand/collapse restoration, preserved form, homepage capture, same-origin tool isolation and reload. Screenshot: ' + path.join(temp, 'preview.png'));
}).then(async () => { stack?.destroy(); server?.close(); iframeServer?.close(); await wait(200); app.quit(); }).catch(error => {
    console.error(error); stack?.destroy(); server?.close(); iframeServer?.close(); app.exit(1);
});
