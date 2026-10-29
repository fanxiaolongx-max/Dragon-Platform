// node_modules/.bin/electron --disable-gpu tests/desktop-downloads-browser.cjs
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-download-browser-'));
const downloads = path.join(temp, 'Downloads');
fs.mkdirSync(downloads);
app.setPath('userData', path.join(temp, 'profile'));
app.setPath('downloads', downloads);
app.disableHardwareAcceleration();
const { createPromoStack, PARTITION } = require('../desktop-promo/promo-stack');
let stack, server;
const timeout = setTimeout(() => { console.error('Download test timed out'); app.exit(1); }, 20000);
app.whenReady().then(async () => {
    const extensionsStatePath = path.join(temp, 'extensions.json');
    fs.writeFileSync(extensionsStatePath, JSON.stringify({ imported: [], disabled: ['auto:icpm', 'bundled:chrome-capture-pro', 'bundled:overseas-salary-calculator'] }));
    const web = express();
    web.get('/', (_, res) => res.send('<title>Downloads fixture</title>Downloads fixture'));
    web.get('/file', (req, res) => {
        res.setHeader('Content-Disposition', 'attachment; filename="report.txt"');
        res.type('text/plain').send('download-' + req.query.id);
    });
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    stack = createPromoStack({ statePath: path.join(temp, 'state.json'), extensionsStatePath });
    await stack.init();
    const promoSession = session.fromPartition(PARTITION);
    const observed = [];
    promoSession.on('will-download', (_event, item) => {
        assert.equal(path.dirname(item.getSavePath()), downloads, 'save path is set synchronously, so no save dialog is needed');
        observed.push(new Promise((resolve, reject) => item.once('done', (_event, state) => {
            if (state === 'completed') resolve(item.getSavePath()); else reject(new Error('Download ' + state));
        })));
    });
    fs.writeFileSync(path.join(downloads, 'report.txt'), 'keep existing');
    stack.openInBrowser({ id: 'fixture', name: 'Downloads fixture', url: base });
    const win = BrowserWindow.getAllWindows()[0];
    const wc = win.getBrowserViews()[0].webContents;
    await new Promise(resolve => wc.once('did-finish-load', resolve));
    wc.downloadURL(base + '/file?id=one');
    wc.downloadURL(base + '/file?id=two');
    for (let i = 0; observed.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(observed.length, 2);
    const paths = await Promise.all(observed);
    assert.equal(new Set(paths).size, 2);
    assert.equal(fs.readFileSync(path.join(downloads, 'report.txt'), 'utf8'), 'keep existing');
    assert.deepEqual(paths.map(file => fs.readFileSync(file, 'utf8')).sort(), ['download-one', 'download-two']);
    assert.deepEqual(paths.map(file => path.basename(file)).sort(), ['report (1).txt', 'report (2).txt']);
    await wc.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['blob download'])); a.download = '材料.zip'; a.click(); })()`);
    for (let i = 0; observed.length < 3 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(observed.length, 3);
    const blobPath = await observed[2];
    assert.equal(path.basename(blobPath), '材料.zip');
    assert.equal(fs.readFileSync(blobPath, 'utf8'), 'blob download');
    console.log('PASS: real HTTP and Blob downloads use system Downloads without a save dialog; concurrent duplicate names do not overwrite existing files.');
}).then(() => { clearTimeout(timeout); stack?.destroy(); server?.close(); app.quit(); }).catch(error => {
    console.error(error); clearTimeout(timeout); stack?.destroy(); server?.close(); app.exit(1);
});
