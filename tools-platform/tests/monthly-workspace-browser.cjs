/* Run with: node_modules/.bin/electron tests/monthly-workspace-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monthly-workspace-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
const ticket = { title: '整改', _slaDays: 10, data: { network_name: 'EG-Egypt ET', ticket_id: 'ET-1' } };
const raw = JSON.stringify({ timestamp:'2026-09-24T10:00:00Z', month:9, topMetrics:[], expiringTickets:[
    ticket,
    { ...ticket, data:{ network_name:'EG-Egypt Orange', ticket_id:'ORG-1' } },
    { ...ticket, data:{ network_name:'EG-Egypt Vodafone', ticket_id:'VDF-1' } },
    { ...ticket, data:{ network_name:'EG-Egypt Telecom', ticket_id:'TE-1' } }
] });
const latest = { created_at:'2026-09-24T10:00:00Z', raw_data_json:raw, metrics:[{ cat_name:'ET', metric_label:'RC', is_failing:1, raw_val:'80%', target_val:'90%' }], cat_scores:[{ cat_name:'ET', base_score:90, manual_score:0, final_score:90 }] };
const trends = [{ date:'2026-09-24', created_at:latest.created_at, raw_data_json:raw, compliance_rate:80, passed_metrics:0, total_metrics:1, cat_scores:{ ET:90 } }];
let server;
let win;
let msgHtmlHasChart = false;
let msgHtmlHasBothLanguages = false;
let msgHtmlHasSubtleHighlight = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(fn, ...args) { return win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true); }
async function until(fn) { for (let i=0;i<120;i++) { if (await evaluate(fn)) return; await wait(50); } throw new Error(`Timeout: ${fn}`); }
async function downloadClick(selector) {
    const done = new Promise((resolve, reject) => {
        win.webContents.session.once('will-download', (_, item) => {
            const target = path.join(temp, item.getFilename());
            item.setSavePath(target);
            item.once('done', (_, status) => status === 'completed' ? resolve(target) : reject(new Error(status)));
        });
    });
    await evaluate(value => document.querySelector(value).click(), selector);
    return Promise.race([done, wait(30000).then(() => { throw new Error(`Download timeout: ${selector}`); })]);
}

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json({ limit:'40mb' }));
    web.get('/pages/monthly.html', (_, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/pages/monthly.html'), 'utf8');
        html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js', '/vendor/echarts.min.js')
            .replace('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', '/js/shared/html2canvas.min.js')
            .replace('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', '/js/shared/jspdf.umd.min.js');
        res.type('html').send(html);
    });
    web.get('/vendor/echarts.min.js', (_, res) => res.sendFile(path.join(root, 'backend/builtin-tools/pr/vendor/echarts.min.js')));
    web.get('/js/shared/navbar.js', (_, res) => res.type('js').send(''));
    web.get('/api/db/monthly_report_data', (_, res) => res.json({ trends, latest_snapshot:latest }));
    web.get('/api/db/config/monthly_report_titles', (_, res) => res.json({ zh:'测试月报', en:'Test Monthly Report' }));
    web.get('/api/db/config/welink_policy_v2', (_, res) => res.json({ networkMappings:{} }));
    web.get('/api/sla/config', (_, res) => res.json({ targets:{}, prefs:{} }));
    web.get('/api/sla/categories', (_, res) => res.json(['ET','ORG','VDF','TE']));
    web.get('/api/sla/groups', (_, res) => res.json([]));
    web.post('/api/report-msg/export', (req, _, next) => {
        const html = req.body?.html || '';
        msgHtmlHasChart = /data:image\/jpeg;base64,/.test(html);
        msgHtmlHasBothLanguages = html.includes('Edited summary') && html.includes('Test Monthly Report');
        msgHtmlHasSubtleHighlight = /background-color:rgba\(234, 88, 12, 0\.055\)/.test(html) || /background-color:rgb\(253, 246, 241\)/.test(html);
        next();
    });
    web.use('/api/report-msg', require('../backend/routes/report-msg'));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show:false, width:1450, height:1100, webPreferences:{ contextIsolation:true, nodeIntegration:false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/pages/monthly.html`);
    await until(() => !document.getElementById('monthlyWorkspaceActions').hidden);
    assert.equal(await evaluate(() => document.querySelectorAll('.monthly-actions-row').length), 3);
    assert.equal(await evaluate(() => document.getElementById('export-daily-bundle-btn').closest('.monthly-actions-row').querySelector('[data-monthly-group]').textContent), '下载与交付');
    assert.deepEqual(await evaluate(() => [
        document.querySelector('[data-action="bold"]').getBoundingClientRect().height,
        document.getElementById('monthlyColorLabel').getBoundingClientRect().height,
        document.querySelector('[data-action="pdf"]').getBoundingClientRect().height,
        document.getElementById('export-daily-bundle-btn').getBoundingClientRect().height
    ]), [38,38,38,38]);
    const initial = await evaluate(() => window.MonthlyWorkspace.collectProject());
    assert.equal(initial.fileType, 'standard-monthly-project');
    assert.equal(initial.report.trends[0].date, '2026-09-24');
    assert.equal(await evaluate(() => document.querySelector('.monthly-ticket-lines li').classList.contains('is-imminent')), true);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.monthly-ticket-lines li.is-imminent')).boxShadow), 'none');
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.monthly-ticket-lines li.is-imminent')).fontWeight), '600');
    assert.equal(await evaluate(() => document.querySelectorAll('.monthly-ticket-network-group').length), 4);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.monthly-ticket-grid')).gridTemplateColumns.split(' ').length), 4);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelectorAll('.monthly-ticket-network-group')[0]).borderLeftWidth), '0px');
    await evaluate(() => {
        window.currentLang = 'en';
        window.MonthlyReportBridge.render();
        const intro = document.querySelector('.monthly-ticket-intro p');
        intro.innerHTML = 'The following tickets require immediate action: <small>（单号后数字：旧中文说明）</small>';
        intro.dispatchEvent(new Event('input', { bubbles:true }));
        window.MonthlyReportBridge.render();
    });
    assert.match(await evaluate(() => document.querySelector('.monthly-ticket-days-legend').textContent), /positive = days left/);
    assert.doesNotMatch(await evaluate(() => document.querySelector('.monthly-ticket-intro p').textContent), /旧中文说明/);
    await evaluate(() => { window.currentLang = 'zh'; window.MonthlyReportBridge.render(); });
    await evaluate(() => {
        const intro = document.querySelector('.monthly-ticket-intro p');
        const range = document.createRange();
        range.selectNodeContents(intro);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    });
    await until(() => !document.getElementById('monthlySelectionToolbar').hidden);
    await evaluate(() => document.querySelector('#monthlySelectionToolbar [data-format="italic"]').click());
    await evaluate(() => document.querySelector('#monthlySelectionToolbar [data-color="#1d4ed8"]').click());
    assert.match(await evaluate(() => document.querySelector('.monthly-ticket-intro p').innerHTML), /<i>|<em>|font-style/);
    assert.match(await evaluate(() => document.querySelector('.monthly-ticket-intro p').innerHTML), /color[:=]/);
    await evaluate(() => window.MonthlyReportBridge.render());
    assert.match(await evaluate(() => document.querySelector('.monthly-ticket-intro p').innerHTML), /color:/);
    await evaluate(() => {
        const el = document.querySelector('#summary-content [data-monthly-edit-key]');
        el.innerHTML = '<strong>Edited summary</strong>';
        el.dispatchEvent(new Event('input', { bubbles:true }));
        window.MonthlyReportBridge.render();
    });
    assert.match(await evaluate(() => document.querySelector('#summary-content').textContent), /Edited summary/);
    const project = await evaluate(() => window.MonthlyWorkspace.collectProject());
    await evaluate(() => { localStorage.setItem('tools_tenant_id','another-tenant'); window.MonthlyReportBridge.render(); });
    assert.doesNotMatch(await evaluate(() => document.querySelector('#summary-content').textContent), /Edited summary/);
    await evaluate(() => { localStorage.setItem('tools_tenant_id','default'); window.MonthlyReportBridge.render(); });
    assert.match(await evaluate(() => document.querySelector('#summary-content').textContent), /Edited summary/);
    await evaluate(() => {
        const other = structuredClone(window.MonthlyReportBridge.getState());
        other.trends[0].date = '2026-08-24';
        window.MonthlyReportBridge.applyState(other);
    });
    assert.doesNotMatch(await evaluate(() => document.querySelector('#summary-content').textContent), /Edited summary/);
    await evaluate(data => window.MonthlyWorkspace.applyProject(data), project);
    await evaluate(() => { document.querySelector('[data-action="reset-month"]').click(); });
    assert.doesNotMatch(await evaluate(() => document.querySelector('#summary-content').textContent), /Edited summary/);
    await evaluate(data => window.MonthlyWorkspace.applyProject(data), project);
    assert.match(await evaluate(() => document.querySelector('#summary-content').textContent), /Edited summary/);
    assert.equal(await evaluate(() => document.querySelector('#monthlySourcePanel').hidden), false);
    await evaluate(() => document.querySelector('[data-action="toggle-time"]').click());
    assert.equal(await evaluate(() => document.querySelector('#monthlySourcePanel').hidden), true);
    assert.equal(await evaluate(() => window.MonthlyWorkspace.collectProject().settings.sourceTimeHidden), true);
    await evaluate(() => {
        document.querySelector('[data-action="config"]').click();
    });
    assert.equal(await evaluate(() => {
        const rect = document.getElementById('monthlyWorkspaceDialog').getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - document.documentElement.clientWidth / 2) < 2 && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 2;
    }), true);
    assert.equal(await evaluate(() => document.getElementById('monthlyNetworkMappingText').getBoundingClientRect().right <= document.getElementById('monthlyWorkspaceDialog').getBoundingClientRect().right), true);
    await evaluate(() => {
        document.getElementById('monthlyWarningDays').value = '5';
        document.getElementById('monthlyNetworkMappingText').value = 'EG-Egypt ET = ET';
        document.getElementById('monthlyConfigSave').click();
    });
    assert.equal(await evaluate(() => window.MonthlyWorkspace.getWarningDays()), 5);
    assert.equal(await evaluate(() => document.querySelector('.monthly-ticket-lines li').classList.contains('is-imminent')), false);
    await evaluate(() => {
        document.querySelector('[data-action="config"]').click();
        document.getElementById('monthlyWarningDays').value = '10';
        document.getElementById('monthlyConfigSave').click();
    });
    const png = await downloadClick('[data-png="zh"]');
    assert.equal(fs.readFileSync(png).subarray(1,4).toString(), 'PNG');
    const englishPng = await downloadClick('[data-png="en"]');
    const bilingualPng = await downloadClick('[data-png="both"]');
    const pngHeight = file => fs.readFileSync(file).readUInt32BE(20);
    assert.ok(pngHeight(bilingualPng) > pngHeight(png));
    assert.ok(pngHeight(bilingualPng) > pngHeight(englishPng));
    const allPngs = [];
    let downloadIndex = 0;
    const allDone = new Promise((resolve, reject) => {
        const onDownload = (_, item) => {
            const target = path.join(temp, `all-${downloadIndex++}-${item.getFilename()}`);
            item.setSavePath(target);
            item.once('done', (_, status) => {
                if (status !== 'completed') return reject(new Error(status));
                allPngs.push(target);
                if (allPngs.length === 3) { win.webContents.session.removeListener('will-download', onDownload); resolve(); }
            });
        };
        win.webContents.session.on('will-download', onDownload);
    });
    await evaluate(() => document.querySelector('[data-png="all"]').click());
    await Promise.race([allDone, wait(30000).then(() => { throw new Error('Download all PNG timeout'); })]);
    assert.equal(allPngs.length, 3);
    const html = await downloadClick('[data-action="html"]');
    const htmlContent = fs.readFileSync(html, 'utf8');
    assert.match(htmlContent, /Edited summary/);
    assert.match(htmlContent, /English Report|Test Monthly Report/);
    assert.match(htmlContent, /positive = days left/);
    assert.match(htmlContent, /monthly-ticket-lines li\.is-imminent \{ background: rgba\(234, 88, 12, 0\.055\)/);
    const xlsx = await downloadClick('[data-action="excel"]');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(xlsx);
    assert.deepEqual(workbook.worksheets.map(ws => ws.name), ['中文月报','English Report','Source Data']);
    assert.ok(workbook.worksheets[0].getImages().length >= 2);
    assert.ok(workbook.worksheets[1].getImages().length >= 2);
    assert.ok(workbook.worksheets[0].getColumn(1).values.some(value => value?.richText?.some(run => run.font?.italic)));
    assert.ok(workbook.worksheets[0].getColumn(1).values.some((value, index) => String(value).includes('ET-1') && workbook.worksheets[0].getCell(index, 1).fill?.fgColor?.argb === 'FFFDF6F1'));
    const pdf = await downloadClick('[data-action="pdf"]');
    assert.equal(fs.readFileSync(pdf).subarray(0,4).toString(), '%PDF');
    await evaluate(() => { window.AppDialog.prompt = async () => 'Smoke snapshot'; document.querySelector('[data-action="save-snapshot"]').click(); });
    await until(async () => (await window.ReportSnapshotDiff.Store.listSnapshots({ toolKey:'standard-monthly-report:default' })).some(item => item.name === 'Smoke snapshot'));
    await evaluate(() => document.querySelector('[data-action="snapshots"]').click());
    await until(() => !!document.querySelector('.monthly-snapshot-manager .report-snapshot-mgr-dialog'));
    assert.equal(await evaluate(() => document.querySelectorAll('.report-snapshot-item-actions button').length), 4);
    assert.equal(await evaluate(() => [...document.querySelectorAll('.report-snapshot-item-actions button')].every(button => getComputedStyle(button).height === '36px')), true);
    assert.equal(await evaluate(() => {
        const info = document.querySelector('.report-snapshot-item-info').getBoundingClientRect();
        const actions = document.querySelector('.report-snapshot-item-actions').getBoundingClientRect();
        return info.right < actions.left && actions.right <= document.querySelector('.report-snapshot-item').getBoundingClientRect().right;
    }), true);
    await evaluate(() => document.getElementById('smCloseBtn').click());
    await evaluate(() => document.querySelector('[data-action="diff"]').click());
    await until(() => !!document.getElementById('reportDiffModalOverlay'));
    assert.match(await evaluate(() => document.getElementById('rdBaselineSelect').textContent), /Smoke snapshot/);
    await evaluate(() => document.getElementById('rdCloseBtn').click());
    const msg = await downloadClick('[data-action="msg"]');
    assert.equal(path.extname(msg), '.msg');
    assert.ok(fs.statSync(msg).size > 1000);
    assert.equal(msgHtmlHasChart, true);
    assert.equal(msgHtmlHasBothLanguages, true);
    assert.match(await evaluate(() => document.querySelector('#monthlyMsgProgress .monthly-msg-log').textContent), /HTML 正文：.*附件编码：.*请求总量：/);
    assert.match(await evaluate(() => document.querySelector('#monthlyMsgProgress .monthly-msg-log').textContent), /服务端响应：HTTP 200/);
    assert.equal(await evaluate(() => document.querySelector('#monthlyMsgProgress .monthly-msg-done').disabled), false);
    await evaluate(() => document.querySelector('#monthlyMsgProgress .monthly-msg-done').click());
    assert.equal(msgHtmlHasSubtleHighlight, true);
    win.setSize(600, 900);
    await evaluate(() => document.documentElement.setAttribute('data-theme','dark'));
    await until(() => getComputedStyle(document.querySelector('.monthly-ticket-grid')).gridTemplateColumns.split(' ').length === 2);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.monthly-ticket-grid')).gridTemplateColumns.split(' ').length), 2);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelectorAll('.monthly-ticket-network-group')[2]).borderLeftWidth), '0px');
    assert.equal(await evaluate(() => getComputedStyle(document.querySelectorAll('.monthly-ticket-network-group')[3]).borderLeftWidth), '1px');
    assert.equal(await evaluate(() => getComputedStyle(document.getElementById('monthlyWorkspaceActions')).display), 'grid');
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('[data-action="pdf"]')).color), 'rgb(226, 232, 240)');
    await evaluate(() => document.querySelector('[data-action="config"]').click());
    assert.equal(await evaluate(() => getComputedStyle(document.getElementById('monthlyWorkspaceDialog')).backgroundColor), 'rgb(30, 41, 59)');
    await evaluate(() => document.getElementById('monthlyConfigClose').click());
    win.setSize(380, 900);
    await until(() => getComputedStyle(document.querySelector('.monthly-ticket-grid')).gridTemplateColumns.split(' ').length === 1);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.monthly-ticket-grid')).gridTemplateColumns.split(' ').length), 1);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.monthly-actions-buttons')).gridTemplateColumns.split(' ').length), 2);
    assert.equal(await evaluate(() => document.getElementById('monthlyWorkspaceActions').scrollWidth <= document.getElementById('monthlyWorkspaceActions').clientWidth + 1), true);
    await evaluate(() => document.querySelector('[data-action="snapshots"]').click());
    await until(() => !!document.querySelector('.monthly-snapshot-manager .report-snapshot-mgr-dialog'));
    assert.equal(await evaluate(() => {
        const card = document.querySelector('.report-snapshot-item').getBoundingClientRect();
        const actions = document.querySelector('.report-snapshot-item-actions').getBoundingClientRect();
        return actions.left >= card.left && actions.right <= card.right && actions.top > document.querySelector('.report-snapshot-item-info').getBoundingClientRect().top;
    }), true);
    await evaluate(() => document.getElementById('smCloseBtn').click());
    await evaluate(() => document.querySelector('[data-action="config"]').click());
    assert.equal(await evaluate(() => {
        const rect = document.getElementById('monthlyWorkspaceDialog').getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    }), true);
    await evaluate(() => document.getElementById('monthlyConfigClose').click());
    console.log('Monthly workspace browser smoke test passed.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (win && !win.isDestroyed()) win.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    app.quit();
});
