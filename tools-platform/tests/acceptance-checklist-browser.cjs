/* Run: node_modules/.bin/electron tests/acceptance-checklist-browser.cjs */
'use strict';
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const { buildStandalone } = require('../scripts/package-acceptance-checklist');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-checklist-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
async function until(fn) {
    for (let i = 0; i < 200; i++) { if (await run(fn)) return; await wait(25); }
    throw new Error(`Timed out: ${fn}`);
}
async function interceptDownloads() {
    await run(() => {
        window.downloads = [];
        URL.createObjectURL = blob => { window.downloads.push(blob); return 'blob:fixture'; };
        HTMLAnchorElement.prototype.click = function () {};
        window.confirm = () => true;
    });
}
async function lastDownload() {
    return Buffer.from(await run(async () => Array.from(new Uint8Array(await downloads.at(-1).arrayBuffer()))));
}
app.whenReady().then(async () => {
    const web = express();
    web.use(express.static(path.join(__dirname, '../backend/builtin-tools/acceptance-checklist')));
    web.get('/integrated.html', (_req, res) => res.type('html').send(require('../backend/models/custom-tool-i18n-service').injectLanguageRuntime(fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/acceptance-checklist/index.html'), 'utf8'), 'acceptance-checklist', { inlineRuntime: true })));
    web.get('/standalone.html', (_req, res) => res.type('html').send(buildStandalone()));
    server = await new Promise(resolve => { const instance = web.listen(0, '127.0.0.1', () => resolve(instance)); });
    nativeTheme.themeSource = 'light';
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    const failures = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) failures.push(message); });
    const url = `http://127.0.0.1:${server.address().port}`;
    await win.loadURL(url);
    await until(() => !document.querySelector('main').inert && document.querySelectorAll('#rows tr').length === 4);
    assert.match(await run(() => document.querySelector('#weight-total').textContent), /100%/);
    assert.deepEqual(await run(() => [...document.querySelectorAll('select')].map(n => n.value)), Array(4).fill('pending'));
    await run(() => {
        const input = document.querySelector('#reviewer'); input.value = '测试验收人'; input.dispatchEvent(new Event('input'));
        const result = document.querySelector('select'); result.value = 'pass'; result.dispatchEvent(new Event('change'));
        const qty = document.querySelector('[data-field="actual"]'); qty.value = '1'; qty.dispatchEvent(new Event('input'));
        const note = document.querySelector('[data-field="notes"]'); note.value = '=1+1 <img src=x onerror=alert(1)>'; note.dispatchEvent(new Event('input'));
        // Generate six actual PNG files through the same File input change flow as the UI.
        const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#23846f'; ctx.fillRect(0, 0, 120, 80);
        const bytes = Uint8Array.from(atob(canvas.toDataURL().split(',')[1]), c => c.charCodeAt(0));
        const transfer = new DataTransfer();
        for (let i = 0; i < 6; i++) transfer.items.add(new File([bytes], `evidence-${i}.png`, { type: 'image/png' }));
        const file = document.querySelector('.upload input'); file.files = transfer.files; file.dispatchEvent(new Event('change'));
    });
    await until(() => document.querySelectorAll('.thumbnail').length === 6 && document.querySelector('#save-status').textContent === '已保存到浏览器');
    await win.loadURL(url);
    await until(() => !document.querySelector('main').inert);
    assert.equal(await run(() => document.querySelector('#reviewer').value), '测试验收人');
    assert.equal(await run(() => document.querySelector('select').value), 'pass');
    assert.equal(await run(() => document.querySelectorAll('.thumbnail').length), 6);
    await run(() => document.querySelector('.thumbnail').click());
    assert.equal(await run(() => document.querySelector('dialog').open), true);
    await run(() => document.querySelector('dialog').close()); await wait(100);
    fs.writeFileSync(path.join(temp, 'desktop-light.png'), (await win.webContents.capturePage()).toPNG());
    await interceptDownloads();
    await run(() => document.querySelector('#backup').click());
    const backup = await lastDownload();
    assert.equal(JSON.parse(backup).rows[0].images.length, 6);
    await run(() => document.querySelector('#export').click());
    await until(() => document.querySelector('#message').textContent.includes('Excel 已导出'));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await lastDownload());
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.getCell('F9').value, '通过');
    assert.equal(sheet.getCell('E9').value, 1);
    assert.equal(sheet.getCell('H9').value, '=1+1 <img src=x onerror=alert(1)>');
    assert.equal(sheet.getCell('H9').type, ExcelJS.ValueType.String, 'user text never becomes a formula');
    assert.equal(sheet.getImages().length, 6);
    assert.equal(workbook.model.media.length, 6);
    assert.ok(sheet.getRow(9).height <= 409, 'six images fit within Excel row height limit');
    assert.match(sheet.getCell('F9').dataValidation.formulae[0], /有条件通过/);
    assert.equal(workbook.worksheets.length, 2);
    const anchors = sheet.getImages().map(img => img.range.tl);
    assert.ok(anchors[1].nativeColOff > anchors[0].nativeColOff);
    assert.ok(anchors[2].nativeRowOff > anchors[0].nativeRowOff);
    await run(() => document.querySelector('#language-toggle').click());
    assert.equal(await run(() => document.documentElement.lang), 'en');
    assert.equal(await run(() => document.querySelector('select').selectedOptions[0].textContent), 'Passed');
    nativeTheme.themeSource = 'dark'; win.setSize(390, 800); await wait(100);
    assert.equal(await run(() => document.documentElement.scrollWidth <= innerWidth), true, 'only table scrolls horizontally');
    assert.equal(await run(() => getComputedStyle(document.body).color), 'rgb(224, 232, 242)');
    fs.writeFileSync(path.join(temp, 'mobile-dark.png'), (await win.webContents.capturePage()).toPNG());
    // Restore a genuine backup, then ensure malformed backups leave the existing table unchanged.
    await run(() => document.querySelector('#add').click());
    assert.equal(await run(() => document.querySelectorAll('#rows tr').length), 5);
    await win.webContents.executeJavaScript(`(() => { const transfer = new DataTransfer(); transfer.items.add(new File([${JSON.stringify(backup.toString())}], 'backup.json', {type:'application/json'})); const input = document.querySelector('#restore-file'); input.files = transfer.files; input.dispatchEvent(new Event('change')); })()`);
    await until(() => document.querySelectorAll('#rows tr').length === 4 && document.querySelector('#message').textContent === 'Backup restored.');
    await run(() => {
        const transfer = new DataTransfer(); transfer.items.add(new File(['{"version":1,"rows":[]}'], 'bad.json', { type: 'application/json' }));
        const input = document.querySelector('#restore-file'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
    });
    await until(() => document.querySelector('#message').textContent.includes('Invalid'));
    assert.equal(await run(() => document.querySelectorAll('.thumbnail').length), 6);
    await win.loadURL(`${url}/integrated.html`);
    await until(() => !document.querySelector('main').inert && typeof ToolsCustomI18n !== 'undefined');
    await run(() => ToolsCustomI18n.setLanguage('en'));
    await until(() => document.querySelector('select').selectedOptions[0].textContent === 'Passed');
    assert.equal(await run(() => document.querySelector('#language-toggle').textContent), '中文', 'platform language syncs native control');
    // Deliverable runs entirely from an embedded, single-file HTML document.
    const standalone = buildStandalone();
    assert.doesNotMatch(standalone, /<script src=|<link rel="stylesheet"/);
    assert.doesNotMatch(standalone, /<script[^>]*src="https?:/);
    const standaloneFile = path.join(temp, 'standalone.html'); fs.writeFileSync(standaloneFile, standalone);
    await win.loadFile(standaloneFile);
    await until(() => !document.querySelector('main').inert && document.querySelectorAll('#rows tr').length === 4);
    assert.equal(await run(() => typeof ExcelJS.Workbook), 'function');
    await interceptDownloads();
    await run(() => document.querySelector('#export').click());
    await until(() => document.querySelector('#message').textContent.includes('Excel 已导出'));
    assert.ok((await lastDownload()).length > 5000);
    assert.deepEqual(failures, []);
    console.log(`Acceptance checklist: persistence, 6 images, Excel, backup / restore, language, dark mobile, offline HTML passed. Screenshots: ${temp}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { win?.destroy(); server?.close(); app.quit(); });
