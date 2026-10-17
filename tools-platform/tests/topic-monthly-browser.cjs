/* Run with: node_modules/.bin/electron tests/topic-monthly-browser.cjs
 * Uses an isolated Electron profile, synthetic API data and a temporary output folder.
 */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const engine = require('../frontend/js/shared/topic-monthly-engine');
const { netcare, datafab } = require('./fixtures/topic-monthly');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'topic-monthly-browser-'));
app.setPath('userData', path.join(temporary, 'profile'));
const metadata = { id: 'fixture', name: 'Synthetic browser fixture', capturedAt: '2026-09-22T09:00:00.000Z', importedAt: '2026-09-22T10:00:00.000Z' };
const report = key => ({ ...engine.build(['return', 'filing'].includes(key) ? datafab() : netcare(), key), snapshot: metadata });
let server; let win;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(fn, ...args) { return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true); }
async function until(fn) {
    for (let i = 0; i < 100; i++) { if (await win.webContents.executeJavaScript(`Boolean((${fn.toString()})())`)) return; await delay(50); }
    throw new Error('Timed out: ' + fn.toString());
}
async function select(key) {
    await evaluate(value => { const el = document.getElementById('monthlyTopic'); el.value = value; el.dispatchEvent(new Event('change')); }, key);
    await until(() => !document.getElementById('eosDownloadExcel').disabled && document.querySelector('#eosMonthlyReport .topic-report-title'));
}
async function download(button, action) {
    const done = new Promise((resolve, reject) => {
        win.webContents.session.once('will-download', (_, item) => {
            const target = path.join(temporary, item.getFilename());
            item.setSavePath(target);
            item.once('done', (_, state) => state === 'completed' ? resolve(target) : reject(new Error(state)));
        });
    });
    if (action) await evaluate(action); else await evaluate(id => document.getElementById(id).click(), button);
    const file = await Promise.race([done, delay(30000).then(async () => { throw new Error('Download timeout: ' + button + ' ' + await evaluate(() => window.__lastAlert || '')); })]);
    await until(() => !document.getElementById('monthlyTopic').disabled);
    return file;
}
async function importProject(project, name) {
    await evaluate((data, filename) => {
        const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(data)], filename, { type: 'application/json' }));
        const input = document.getElementById('eosProjectFileInput'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
    }, project, name);
    await until(() => !!document.querySelector('.topic-imported-badge'));
}

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json({ limit: '45mb' }));
    web.get('/js/shared/navbar.js', (_, res) => res.type('js').send('/* navigation excluded from this focused test */'));
    web.get('/api/topic-snapshots', async (_, res) => { await delay(150); res.json({ items: [], total: 0 }); });
    web.get('/api/topic-snapshots/mapping-config', (_, res) => res.json({ config: null }));
    web.put('/api/topic-snapshots/mapping-config', (_, res) => res.json({ success: true }));
    web.get('/api/topic-snapshots/eos-monthly-report', (_, res) => res.json({ months: [], report: null }));
    web.get('/api/topic-snapshots/monthly-report', async (req, res) => {
        if (req.query.month === '2026-01') return res.json({ months: ['2026-01'], report: null });
        if (req.query.topic === 'change') await delay(150);
        res.json({ months: [report(req.query.topic).month], report: report(req.query.topic) });
    });
    web.get('/api/topic-snapshots/fixture', (_, res) => res.json({ item: { ...metadata, snapshot: netcare() } }));
    web.get('/api/ai-settings', (_, res) => res.json({ hasApiKey: false }));
    web.use('/api/report-msg', require('../backend/routes/report-msg'));
    web.use(express.static(path.join(__dirname, '../frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/pages/topic-analysis.html`);
    await evaluate(() => { window.AppDialog.alert = async message => { window.__lastAlert = message; }; });
    await until(() => !!document.querySelector('#eosMonthlyReport .topic-report-title'));
    const eosDefault = await evaluate(() => document.getElementById('eosMonthlyReport').textContent);
    await evaluate(() => {
        const el = document.querySelector('#eosMonthlyReport .topic-report-title');
        el.innerHTML = 'EOS persistent custom title'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    for (const key of ['certificate', 'change', 'interception', 'sr', 'return', 'filing']) {
        await select(key);
        assert.equal(await evaluate(() => document.querySelectorAll('#eosMonthlyReport table').length > 1), true, key);
        assert.equal(await evaluate(() => [...document.querySelectorAll('.topic-fixed-progress')].every(el => getComputedStyle(el).display === 'none')), true);
        assert.equal(await evaluate(() => document.getElementById('eosMonthlyReportEn').textContent.includes('Monthly Report')), true);
    }
    await select('certificate');
    await evaluate(() => {
        const el = document.querySelector('#eosMonthlyReport .topic-report-title'); el.innerHTML = '<strong>Certificate custom title</strong>'; el.dispatchEvent(new Event('input', { bubbles: true }));
        const cell = document.querySelector('#eosMonthlyReport [data-monthly-table="actions"] tbody td'); cell.textContent = 'Owner Alice'; cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await evaluate(() => document.querySelectorAll('#eosMonthlyReportEn .topic-en-needs-sync').length > 0), true);
    await select('eos');
    assert.equal(await evaluate(() => document.querySelector('#eosMonthlyReport .topic-report-title').textContent), 'EOS persistent custom title');
    assert.equal(await evaluate(() => document.querySelector('.topic-fixed-progress').hidden), false);
    const eosProjectPath = await download('eosExportProjectBtn');
    const eosProject = JSON.parse(fs.readFileSync(eosProjectPath, 'utf8'));
    assert.equal(eosProject.fileType, 'topic-eos-monthly-project');
    const eosWorkbookPath = await download('eosDownloadExcel');
    const eosWorkbook = new ExcelJS.Workbook(); await eosWorkbook.xlsx.readFile(eosWorkbookPath);
    assert.equal(eosWorkbook.worksheets.length, 4);
    assert.equal(eosWorkbook.worksheets[0].name, 'EOS收编进展月报');
    await select('certificate');
    assert.equal(await evaluate(() => document.querySelector('#eosMonthlyReport .topic-report-title').textContent), 'Certificate custom title');
    const exported = JSON.parse(fs.readFileSync(await download('eosExportProjectBtn'), 'utf8'));
    assert.equal(exported.topicKey, 'certificate');
    assert.match(exported.copyPreferences.monthly['copy-0'], /Certificate custom title/);
    await select('sr');
    await evaluate(() => document.getElementById('refreshButton').click());
    await importProject(exported, 'certificate.json');
    await delay(250);
    assert.equal(await evaluate(() => !!document.querySelector('.topic-imported-badge')), true, 'late refresh must not replace an imported project');
    assert.equal(await evaluate(() => document.getElementById('monthlyTopic').value), 'certificate');
    assert.equal(await evaluate(() => document.querySelector('#eosMonthlyReport .topic-report-title').textContent), 'Certificate custom title');
    assert.equal(await evaluate(() => document.querySelector('#eosMonthlyReport [data-monthly-table="actions"] tbody td').textContent), 'Owner Alice');
    const htmlFile = await download('eosDownloadHtml');
    const html = fs.readFileSync(htmlFile, 'utf8');
    assert.match(html, /Certificate custom title/);
    assert.doesNotMatch(html, /EOS产品风险处置流程/);
    const xlsx = await download('eosDownloadExcel');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(xlsx);
    assert.equal(workbook.worksheets[0].name, '专题进展月报');
    assert.equal(workbook.worksheets.length, 2);
    assert.match(JSON.stringify(workbook.worksheets[0].model), /Owner Alice/);
    assert.doesNotMatch(JSON.stringify(workbook.worksheets[0].model), /EOS产品风险处置流程/);
    const png = await download('PNG', () => document.querySelector('[data-png-scope="cn"]').click());
    assert.equal(fs.readFileSync(png).subarray(1, 4).toString(), 'PNG');
    const pdf = await download('eosDownloadPdf');
    assert.equal(fs.readFileSync(pdf).subarray(0, 4).toString(), '%PDF');
    const msg = await download('eosDownloadMsg');
    assert.equal(fs.readFileSync(msg).subarray(0, 4).toString('hex'), 'd0cf11e0');
    await evaluate(() => document.getElementById('tpMsgExportDoneBtn')?.click());
    delete eosProject.topicKey;
    delete eosProject.preTranslatePreferences;
    eosProject.copyPreferences.fixed['copy-0'] = 'Imported fixed EOS heading';
    await importProject(eosProject, 'legacy.eos.json');
    assert.equal(await evaluate(() => document.getElementById('monthlyTopic').value), 'eos');
    assert.equal(await evaluate(() => document.querySelector('#eosMonthlyReport .topic-report-title').textContent), 'EOS persistent custom title');
    assert.equal(await evaluate(() => document.querySelector('[data-eos-copy-scope="fixed"][data-eos-copy-key="copy-0"]').textContent), 'Imported fixed EOS heading');
    await evaluate(() => document.getElementById('eosCopyResetMonth').click());
    assert.equal(await evaluate(() => document.getElementById('eosMonthlyReport').textContent), eosDefault);
    // Out-of-order request: month refresh for change must not overwrite SR.
    await select('change');
    await evaluate(() => { document.getElementById('eosMonthlyMonth').dispatchEvent(new Event('change')); const el = document.getElementById('monthlyTopic'); el.value = 'sr'; el.dispatchEvent(new Event('change')); });
    await delay(300);
    assert.equal(await evaluate(() => document.querySelector('#eosMonthlyReport .topic-report-title').textContent.includes('SR')), true);
    // Empty data is explicit and exports unavailable.
    await evaluate(() => { const month = document.getElementById('eosMonthlyMonth'); month.add(new Option('2026-01', '2026-01')); month.value = '2026-01'; month.dispatchEvent(new Event('change')); });
    await until(() => document.getElementById('eosMonthlyReport').textContent.includes('暂无此专题数据'));
    assert.equal(await evaluate(() => document.getElementById('eosDownloadExcel').disabled), true);
    await select('filing');
    fs.writeFileSync(path.join(temporary, 'desktop.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(() => document.getElementById('themeToggleButton').click());
    win.setSize(430, 932);
    await evaluate(() => document.querySelector('.topic-monthly-panel').scrollIntoView());
    await delay(100);
    assert.equal(await evaluate(() => document.getElementById('monthlyTopic').getBoundingClientRect().width <= window.innerWidth), true);
    fs.writeFileSync(path.join(temporary, 'mobile-dark.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('PASS: 7-topic switching, isolated edits, bilingual sync, legacy/new projects, all 5 exports, EOS workbook, race/empty states, dark/narrow layouts.');
    console.log('Synthetic test outputs: ' + temporary);
    win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); if (win) win.destroy(); if (server) server.close(); app.exit(1); });
