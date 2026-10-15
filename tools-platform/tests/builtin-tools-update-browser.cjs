/* Run: node_modules/.bin/electron tests/builtin-tools-update-browser.cjs */
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-progress-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server, stream, applyRequests = 0, previewRequests = 0, lastBody;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
async function until(fn) {
    for (let i = 0; i < 150; i++) { if (await evaluate(fn)) return; await wait(20); }
    throw new Error(`Timed out: ${fn}`);
}
const pending = ['sample', 'second'].map(slug => ({ slug, name: `示例 ${slug}`, icon: '🧩', status: 'update',
    recommended: true, fingerprint: slug, counts: { modified: 1 }, oldBytes: 100, newBytes: 200,
    changes: [{ path: 'index.html', type: 'modified', oldSize: 100, newSize: 200 }] }));
const send = event => stream.write(`${JSON.stringify(event)}\n`);

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    web.get('/', (_req, res) => res.type('html').send('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/shared.css"><body><h1>Update fixture</h1><script src="/fixture.js"></script>'));
    web.get('/shared.css', (_req, res) => res.sendFile(path.join(__dirname, '../frontend/css/shared.css')));
    web.get('/fixture.js', (_req, res) => {
        const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/navbar.js'), 'utf8');
        const section = source.slice(source.indexOf('let builtinToolsSyncChecking ='), source.indexOf('let pageScrollbarIdleTimer;'));
        res.type('js').send(`let lastBuiltinToolsSyncPreview; window.language='zh-CN';
            function navLocaleText(zh,en){return window.language==='en-US'?en:zh;}
            function navEscape(value){const node=document.createElement('span');node.textContent=String(value||'');return node.innerHTML;}
            function getAuthHeaderForNav(){return {};}
            const API={get:async url=>(await fetch(url)).json()};
            window.fixturePreview=${JSON.stringify({ pending })};
            window.ticks=0;setInterval(()=>window.ticks++,10);
            ${section}`);
    });
    web.get('/api/custom-tools/builtin-sync/preview', (_req, res) => { previewRequests++; res.json({ pending }); });
    web.post('/api/custom-tools/builtin-sync/apply-stream', (req, res) => {
        applyRequests++; lastBody = req.body; stream = res;
        res.setHeader('Content-Type', 'application/x-ndjson'); res.flushHeaders();
        send({ type: 'progress', stage: 'validating', checked: 0, completed: 0, total: 2 });
    });
    server = await new Promise(resolve => { const instance = web.listen(0, '127.0.0.1', () => resolve(instance)); });
    nativeTheme.themeSource = 'light';
    win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => typeof openBuiltinToolsSyncModal === 'function');
    await evaluate(() => openBuiltinToolsSyncModal(fixturePreview));
    assert.equal(await evaluate(() => document.querySelectorAll('.builtin-sync-file-row').length), 0, 'diff rows are lazy');
    await evaluate(() => { document.querySelector('details').open = true; });
    await until(() => document.querySelectorAll('.builtin-sync-file-row').length === 1);
    await evaluate(() => document.querySelector('.builtin-sync-apply').click());
    await until(() => document.querySelector('.builtin-sync-progress')?.hidden === false);
    assert.equal(applyRequests, 1);
    assert.deepEqual(lastBody.applySlugs, ['sample', 'second']);
    assert.equal(await evaluate(() => [...document.querySelectorAll('#builtinToolsSyncModal button, #builtinToolsSyncModal input')].every(node => node.disabled)), true);
    await evaluate(() => { document.querySelector('.builtin-sync-apply').click(); closeBuiltinToolsSyncModal(); openBuiltinToolsSyncModal(fixturePreview); });
    assert.equal(applyRequests, 1, 'no duplicate submission');
    assert.equal(await evaluate(() => document.querySelectorAll('#builtinToolsSyncModal').length), 1);
    const ticks = await evaluate(() => window.ticks);
    send({ type: 'progress', stage: 'copying', slug: 'sample', completed: 0, total: 2, filesCompleted: 1, filesTotal: 4 });
    await until(() => document.querySelector('.builtin-sync-progress-label').textContent.includes('1/4'));
    assert.ok(await evaluate(() => window.ticks) > ticks, 'UI timers remain active');
    const percent = await evaluate(() => Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')));
    assert.ok(percent > 0 && percent < 100);
    assert.match(await evaluate(() => document.querySelector('.builtin-sync-progress-detail').textContent), /sample/);
    const screenshot = path.join(temp, 'progress-light.png');
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());

    await evaluate(() => { window.language = 'en-US'; renderBuiltinToolsSyncProgress(document.getElementById('builtinToolsSyncModal'), {}); });
    assert.match(await evaluate(() => document.querySelector('.builtin-sync-progress-label').textContent), /Copying application files/);
    nativeTheme.themeSource = 'dark';
    win.setSize(390, 760);
    await wait(150);
    const layout = await evaluate(() => {
        const modal = document.querySelector('.builtin-sync-window').getBoundingClientRect();
        const footer = document.querySelector('.builtin-sync-footer').getBoundingClientRect();
        const bar = document.querySelector('.builtin-sync-progress-track').getBoundingClientRect();
        return { left: modal.left, right: modal.right, viewport: innerWidth, footerBottom: footer.bottom,
            height: innerHeight, barWidth: bar.width, dark: getComputedStyle(document.querySelector('.builtin-sync-window')).backgroundColor };
    });
    assert.ok(layout.left >= 0 && layout.right <= layout.viewport && layout.footerBottom <= layout.height);
    assert.ok(layout.barWidth > 200);
    assert.equal(layout.dark, 'rgb(24, 35, 53)');
    fs.writeFileSync(path.join(temp, 'progress-dark-mobile.png'), (await win.webContents.capturePage()).toPNG());
    const errorBytes = Buffer.from(JSON.stringify({ type: 'error', error: 'Fixture failure 测试', status: 409 }));
    const split = errorBytes.indexOf(Buffer.from('测试')) + 1;
    stream.write(errorBytes.subarray(0, split));
    await wait(30);
    stream.end(errorBytes.subarray(split));
    await until(() => document.querySelector('.builtin-sync-apply').textContent === 'Check Again');
    assert.match(await evaluate(() => document.querySelector('.builtin-sync-result').textContent), /Fixture failure/);
    assert.match(await evaluate(() => document.querySelector('.builtin-sync-result').textContent), /测试/);
    assert.equal(await evaluate(() => document.querySelector('.builtin-sync-progress').classList.contains('is-error')), true);
    await evaluate(() => document.querySelector('.builtin-sync-apply').click());
    await until(() => document.querySelector('.builtin-sync-progress')?.hidden === true);
    assert.equal(previewRequests, 1);
    assert.equal(applyRequests, 1, 'checking after failure only fetches a new preview');

    await evaluate(() => document.querySelector('.builtin-sync-apply').click());
    await until(() => document.getElementById('builtinToolsSyncModal').dataset.applying === '1');
    while (applyRequests < 2) await wait(10);
    send({ type: 'result', data: { installed: [], adopted: [], updated: [], skipped: ['sample', 'second'], invalid: [] } }); stream.end();
    await until(() => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '100');
    await until(() => !document.getElementById('builtinToolsSyncModal'));

    await evaluate(() => openBuiltinToolsSyncModal(fixturePreview));
    await evaluate(() => document.querySelector('.builtin-sync-apply').click());
    while (applyRequests < 3) await wait(10);
    stream.end();
    await until(() => document.querySelector('.builtin-sync-result')?.textContent.includes('server may still be updating'));
    assert.equal(await evaluate(() => document.querySelector('.builtin-sync-apply').disabled), false);
    console.log(`Built-in update UI passed: live progress, lazy diffs, duplicate protection, responsive/dark layouts, bilingual progress, recovery and completion. Screenshots: ${temp}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode || 0);
});
