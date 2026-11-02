// node_modules/.bin/electron tests/bigscreen-snapshot-browser.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { render } = require('../backend/models/bigscreen-snapshot');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bigscreen-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
app.whenReady().then(async () => {
    const latest = { snapshot_id: 'browser-snapshot', month: '202610', total_score: 89, cat_scores: [], metrics: [], previous_metrics: [] };
    const data = {
        '/api/db/monthly_report_data': { trends: [{ date: '2026-10-01', total_score: 89, cat_scores: {}, compliance_rate: 95 }], latest_snapshot: latest },
        latestByDate: { '2026-10-01': latest },
        '/api/db/snapshots': [{ snapshot_id: latest.snapshot_id, month: latest.month }],
        '/api/db/config/bigscreen_title': {},
        '/api/db/config/bigscreen_contact_info': {},
        '/api/db/config/bigscreen_owners': { items: [] },
        '/api/sla/config': { prefs: { i18nMap: {} } }
    };
    const file = path.join(temp, 'index.html');
    fs.writeFileSync(file, render(data));
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    const remote = [];
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
        if (/^https?:/.test(details.url)) remote.push(details.url);
        callback({ cancel: /^https?:/.test(details.url) });
    });
    await win.loadFile(file);
    const read = () => win.webContents.executeJavaScript(`({title:document.getElementById('bigscreenTitle').textContent,subtitle:document.getElementById('bigscreenSubtitle').textContent,chart:!!echarts.getInstanceByDom(document.getElementById('trendChart')),lang:ToolsI18n.getLanguage()})`);
    const zh = await read();
    assert.match(zh.subtitle, /browser-snapshot/);
    assert.ok(zh.chart);
    await win.webContents.executeJavaScript('ToolsI18n.toggleLanguage()');
    const en = await read();
    assert.notEqual(en.title, zh.title);
    assert.notEqual(en.subtitle, zh.subtitle);
    assert.equal(remote.length, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: offline bigscreen renders data/charts and switches Chinese/English without network requests');
    win.destroy();
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
