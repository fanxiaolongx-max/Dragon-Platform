// node_modules/.bin/electron --disable-gpu tests/uiv-runtime-browser.cjs
// Isolated page fixtures and browser profile; never opens enterprise sites.
const { app, BrowserWindow, webContents, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express');
const { runMacro, prepareMacro } = require('../desktop-promo/uiv-batch-runner');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'uiv-runtime-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let server, win;
const timeout = setTimeout(() => app.exit(1), 55000);
app.whenReady().then(async () => {
    const web = express();
    const frontend = path.join(__dirname, '../frontend');
    const source = fs.readFileSync(path.join(frontend, 'js/uivf12/copy.js'), 'utf8');
    web.get('/copy-fixture.js', (_req, res) => res.type('js').send(source.slice(0, source.lastIndexOf("document.addEventListener('DOMContentLoaded'"))));
    web.get('/', (_req, res) => res.send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/css/shared.css"><link rel="stylesheet" href="/css/uivf12.css"></head><body id="uiv-page" class="uiv-light-theme"><script>window.showToast=()=>{};window.UIVT=k=>k;window.API={get:async url=>url.includes('desktop')?{available:false}:{scripts:[{id:'1',name:'Demo',category:'Demo',url:location.origin+'/fixture',code:'return 1;',consoleCode:'return 1;'}],categories:['Demo']}};</script><script src="/copy-fixture.js"></script></body></html>`));
    web.get('/fixture', (_req, res) => res.send('<!doctype html><html><body><h1>Local capture fixture</h1></body></html>'));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const value = web.listen(0, '127.0.0.1', () => resolve(value)); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const evaluate = code => win.webContents.executeJavaScript(code);
    await win.loadURL(origin);
    await evaluate('UIVCopy.openUivBatchCategoryFilter()');
    const schedule = await evaluate(`({background:getComputedStyle(document.getElementById('uiv-batch-schedule-interval')).backgroundColor,color:getComputedStyle(document.querySelector('.uiv-batch-schedule strong')).color})`);
    assert.equal(schedule.background, 'rgb(255, 255, 255)');
    fs.writeFileSync(path.join(temp, 'settings-light.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('UIVCopy.closeUivBatchCategoryFilter(); UIVCopy.openSiteConsoleScriptPicker()');
    const light = await evaluate(`getComputedStyle(document.querySelector('.uiv-site-script-dialog')).backgroundColor`);
    assert.equal(light, 'rgb(255, 255, 255)');
    fs.writeFileSync(path.join(temp, 'picker-light.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(`document.body.classList.remove('uiv-light-theme')`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.uiv-site-script-dialog')).backgroundColor`), 'rgb(15, 23, 42)');
    win.setSize(390, 800);
    await evaluate(`document.body.classList.add('uiv-light-theme')`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
    fs.writeFileSync(path.join(temp, 'picker-mobile.png'), (await win.webContents.capturePage()).toPNG());
    // Use the real generated macro, with a deterministic local login probe and
    // shortened pauses. Exercise scripts, recorder, audit, progress and completion.
    const macro = await evaluate(`UIVCopy.buildUivBatchMacro([{id:'1',name:'Local',url:location.origin+'/fixture',code:'window.__captured = await (await fetch("/fixture")).text(); return "captured";'}], 'Fixture', {speed:4})`);
    prepareMacro(macro);
    const loginVariables = macro.Commands.filter(c => c.Command === 'executeScript' && /^uivLoginOk_site_/.test(c.Value));
    for (const c of loginVariables) c.Target = 'return JSON.stringify({ok:true});';
    // The control UI and recorder expect browser APIs, so this is run in Electron,
    // rather than mocked DOM. The fixture has no downloads or report data.
    const execution = runMacro(macro, { webContents: win.webContents }, { wait: async () => {} });
    await execution;
    assert.ok((await evaluate('window.__captured')).includes('Local capture fixture'));
    assert.equal(await evaluate('!!document.getElementById("uivf12-completion-dialog")'), true);
    // Both timeout and immediate acknowledgement paths in the shared handshake.
    await win.loadURL(origin + '/fixture');
    await evaluate(`document.body.innerHTML='<div id="status"></div><button id="retry" hidden>Retry</button>';`);
    await evaluate(fs.readFileSync(path.join(frontend, 'js/uivf12/runner.js'), 'utf8'));
    await evaluate(`window.addEventListener('kantuSaveAndRunMacro',()=>window.dispatchEvent(new Event('kantuInvokeSuccess')));UIVRunner.start({Commands:[]})`);
    await new Promise(resolve => setTimeout(resolve, 650));
    assert.ok((await evaluate('document.getElementById("status").textContent')).includes('已接收宏'));
    const { createPromoStack, PARTITION } = require('../desktop-promo/promo-stack');
    const stack = createPromoStack({ statePath: path.join(temp, 'promo-state.json') });
    try {
        const result = await stack.runUivMacro({ Commands: [
            { Command: 'open', Target: origin + '/fixture' },
            { Command: 'executeScript', Target: 'window.__nativeLaunchVerified = true;' }
        ] });
        assert.equal(result.mode, 'desktop-native');
        let launched = false;
        for (let attempt = 0; attempt < 100 && !launched; attempt++) {
            for (const contents of webContents.getAllWebContents()) {
                if (contents.session === session.fromPartition(PARTITION) && contents.getURL() === origin + '/fixture') {
                    launched = !!(await contents.executeJavaScript('window.__nativeLaunchVerified'));
                }
            }
            if (!launched) await new Promise(resolve => setTimeout(resolve, 30));
        }
        assert.equal(launched, true, 'desktop controller launches the native batch in the persistent Dragon browser session');
    } finally { stack.destroy(); }
    console.log('PASS: generated batch execution, light/dark/mobile dialogs, settings, and extension acknowledgement. Screenshots: ' + temp);
    clearTimeout(timeout); win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); clearTimeout(timeout); win?.destroy(); server?.close(); app.exit(1); });
