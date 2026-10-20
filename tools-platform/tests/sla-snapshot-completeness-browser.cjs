/* node_modules/.bin/electron tests/sla-snapshot-completeness-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sla-snapshot-complete-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
const snapshots = require('../backend/models/sla-snapshots-repository');
const prefsRepo = require('../backend/models/sla-prefs-repository');
const targetsRepo = require('../backend/models/sla-targets-repository');
let win, server;
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(...${JSON.stringify(args)})`, true);

function hash(text) {
    let value = 0;
    for (let i = 0; i < text.length; i++) value = ((value << 5) - value + text.charCodeAt(i)) | 0;
    return Math.abs(value).toString(36);
}

app.whenReady().then(async () => {
    const sources = [], prefs = {}, targets = {};
    for (let i = 0; i < 50; i++) {
        const stem = `PBI_自动抓取-测试指标${i}_Latest`, sec = 'other_' + hash(stem);
        sources.push({ name: stem + '_2026年10月.csv', rows: [
            { kind: 'total', value: String(i) },
            ...['TE', 'ORG', 'ET'].map(category => ({ kind: category, value: String(i + 1) }))
        ] });
        prefs['sla_prefs_' + sec] = { customMetrics: [{
            id: 'm_main', label: '指标:' + i, type: 'extract', colX: 'kind', valY: 'total', colZ: 'value',
            subMetrics: ['TE', 'ORG', 'ET'].map(category => ({ id: 'sub_' + category, category, type: 'extract', colX: 'kind', valY: category, colZ: 'value' }))
        }] };
        targets[sec + '_m_main'] = { label: '指标:' + i, type: 'gte', isPercent: false, 9: 0, 10: 100 };
    }
    await prefsRepo.replacePrefs(prefs);
    await targetsRepo.replaceTargets(targets);
    await require('../backend/models/import-source-repository').saveImportSettings({ uploadOriginals: false });

    const web = express();
    let permanentFailure = null;
    web.use(express.json({ limit: '50mb' }));
    web.get('/js/shared/navbar.js', (_, res) => res.type('js').send(''));
    // Eight initial rule requests fail transiently: the old code silently saved only 42 metrics.
    const failures = new Map(Object.keys(prefs).slice(0, 8).map(key => [key, 2]));
    web.get('/api/sla/prefs/:key', (req, res, next) => {
        if (req.params.key === permanentFailure) return res.status(503).json({ error: 'Rule service unavailable' });
        const remaining = failures.get(req.params.key) || 0;
        if (!remaining) return next();
        failures.set(req.params.key, remaining - 1);
        res.status(503).json({ error: 'Temporary rule loading failure' });
    });
    web.use('/api/upload', require('../backend/routes/upload'));
    web.use('/api/sla', require('../backend/routes/sla'));
    web.use('/api/uiv-auto-import', require('../backend/routes/uiv-auto-import'));
    web.use(express.static(path.join(__dirname, '../frontend')));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = 'http://127.0.0.1:' + server.address().port;
    const session = 'a'.repeat(32), token = 'b'.repeat(32);
    for (const source of sources) {
        const response = await fetch(`${base}/api/uiv-auto-import/${session}/datasets?token=${token}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(source)
        });
        assert.equal(response.ok, true);
    }
    win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(`${base}/pages/sla.html?uivImportSession=${session}&uivImportToken=${token}&targetMonth=10`);
    for (let i = 0; i < 200; i++) {
        if ((await snapshots.listSnapshots()).items.length) break;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    const auto = (await snapshots.listSnapshots()).items[0];
    assert.ok(auto, 'automatic import should save a snapshot');
    assert.equal(auto.importSource, 'uivf12');
    assert.equal(auto.files.length, 50);
    assert.equal(auto.topMetrics.length, 50);
    assert.equal(auto.topMetrics.reduce((n, m) => n + m.subMetrics.length, 0), 150);
    assert.ok(auto.topMetrics.every(m => m.savedTarget === 100 && m.isWarn));
    assert.ok(auto.topMetrics.every(m => m.value !== '--'));
    assert.equal(await evaluate(() => document.querySelectorAll('.sub-metrics-list.open').length), 0);
    // Import exactly the same rows as local CSV files and compare persisted results.
    await evaluate(async sources => {
        await SLAUpload.processBatchFiles(sources.map(source => new File([
            XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(source.rows))
        ], source.name, { type: 'text/csv' })));
    }, sources);
    const all = (await snapshots.listSnapshots()).items;
    assert.equal(all.length, 2);
    const manual = all.find(s => s.importSource === 'manual');
    const values = snap => snap.topMetrics.map(m => ({
        key: m.key, label: m.label, value: m.value, savedTarget: m.savedTarget, gap: m.gap, isWarn: m.isWarn,
        subMetrics: m.subMetrics
    })).sort((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(values(auto), values(manual));
    assert.deepEqual(all.find(s => s.id === auto.id), auto, 'manual import must preserve the automatic snapshot');
    assert.ok([...failures.values()].every(n => n === 0));
    permanentFailure = Object.keys(prefs)[0];
    await win.loadURL(`${base}/pages/sla.html?uivImportSession=${session}&uivImportToken=${token}&targetMonth=10`);
    for (let i = 0; i < 200; i++) {
        if (await evaluate(() => document.getElementById('main-wrapper')?.textContent.includes('自动导入失败'))) break;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(await evaluate(() => document.getElementById('main-wrapper').textContent.includes('自动导入失败')));
    assert.equal((await snapshots.listSnapshots()).items.length, 2, 'a persistent rule failure must not save a partial snapshot');
    console.log('PASS: despite eight transient rule failures, automatic and manual imports both persist 50 metrics, 150 collapsed children and October targets; original snapshot preserved.');
    console.log('PASS: persistent rule failures show an import error and do not create a partial snapshot.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    win?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    app.exit(process.exitCode || 0);
});
