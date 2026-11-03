// node_modules/.bin/electron tests/desktop-download-banner-browser.cjs
// 真实渲染的下载横幅：完成后自动消失且不再冒出来；出现向左加速滑入、消失向右加速滑出；重新下载能再次出现。
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'download-banner-'));
app.setPath('userData', path.join(temp, 'profile'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => app.exit(1), 30000).unref();
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL('data:text/html,<!doctype html><meta charset="utf-8"><body></body>');
    const evaluate = code => win.webContents.executeJavaScript(code, true);
    // Stub the preload bridge, then load the real script.
    await evaluate(`window.DragonDownload={onEvent:fn=>{window.__emit=fn}};void 0`);
    await evaluate(fs.readFileSync(path.join(__dirname, '../frontend/js/shared/desktop-download-manager.js'), 'utf8') + ';void 0');
    const banner = () => evaluate(`(()=>{const b=document.querySelector('.desktop-dl-banner');if(!b)return null;const s=getComputedStyle(b);return {hidden:b.hidden,display:s.display,opacity:+s.opacity,anim:s.animationName,timing:s.transitionTimingFunction,x:new DOMMatrix(s.transform).m41}})()`);
    const emit = event => evaluate(`window.__emit(${JSON.stringify(event)});void 0`);

    await emit({ type: 'started', id: 'a', filename: 'report.pdf', savePath: '/tmp/report.pdf', totalBytes: 1000 });
    let b = await banner();
    assert.equal(b.display, 'flex');assert.equal(b.anim, 'desktopDlBannerIn');
    await wait(120);
    const mid = (await banner()).x;
    assert.ok(mid > 0, 'enters from the right (still right of its resting place mid-animation): ' + mid);
    await wait(500);
    assert.equal((await banner()).x, 0, 'settles in place');
    await emit({ type: 'progress', id: 'a', totalBytes: 1000, receivedBytes: 500, percent: 50, state: 'progressing' });
    await emit({ type: 'completed', id: 'a', savePath: '/tmp/report.pdf', totalBytes: 1000, receivedBytes: 1000, percent: 100, state: 'completed' });
    // Auto-dismiss after 4s: slides right with an accelerating (ease-in) curve, then stays gone.
    await wait(4100);
    b = await banner();
    assert.match(b.timing, /cubic-bezier\(0\.55, 0, 1, 0\.45\)/, 'exit accelerates to the right');
    assert.ok(b.x > 0, 'moving right while hiding: ' + b.x);
    await wait(700);
    b = await banner();
    assert.equal(b.hidden, true);assert.equal(b.display, 'none', 'stays hidden after the exit animation');
    await wait(1500);
    assert.equal((await banner()).display, 'none', 'does not reappear');
    // A new download brings it back with the entrance animation.
    await emit({ type: 'started', id: 'b', filename: 'data.xlsx', savePath: '/tmp/data.xlsx', totalBytes: 10 });
    b = await banner();
    assert.equal(b.display, 'flex');assert.equal(b.hidden, false);
    // Closing while finished hides it the same way.
    await emit({ type: 'completed', id: 'b', savePath: '/tmp/data.xlsx', totalBytes: 10, receivedBytes: 10, percent: 100, state: 'completed' });
    await wait(600);
    await evaluate(`document.querySelector('#desktopDlCloseBtn').click();void 0`);
    await wait(600);
    assert.equal((await banner()).display, 'none', 'close button hides it for good');
    console.log('PASS: download banner slides in from the right, auto-dismisses 4s after completion by accelerating off to the right, stays hidden, and returns for the next download.');
    win.destroy();app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
