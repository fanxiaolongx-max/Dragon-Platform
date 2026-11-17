/* Verify report dropdown single-line layout (no wrapped months/titles) and persistent default report UX. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-report-dropdown-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});

let win;
let server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn, label = 'condition', ...args) {
    for (let i = 0; i < 250; i++) {
        if (await evaluate(fn, ...args)) return;
        await wait(40);
    }
    throw new Error('Timed out: ' + label);
}

app.whenReady().then(async () => {
    const reports = require('../backend/models/ai-report-repository');
    const seeded = [];
    for (const [name, month] of [
        ['护网与网络安全月报', '2026-09'],
        ['交互月报模型验收 2026-11-05', '2026-09'],
        ['表头拖动回归验收 2026-11-05', '2026-09'],
        ['层级缩放与表格验收 2026-11-05', '2026-09'],
        ['边界与八向缩放验收 2026-11-05', '2026-10']
    ]) {
        seeded.push(await reports.save({ name, reportMonth: month, chapters: [{ title: '概览', cells: [] }] }, 'tester'));
        await wait(15);
    }
    const targetDefault = seeded[0];

    const web = express();
    web.use(express.json({ limit: '10mb' }));
    web.get(/^\/js\/shared\/platform-(?:core|dialogs|settings-controller|alerts|services|tool-updates|runtime)\.js$/, (_, res) => res.type('js').send(''));
    web.use((req, _res, next) => { req.user = { username: 'tester', role: 'admin' }; next(); });
    web.use('/api/ai-report', require('../backend/routes/ai-report'));
    web.use(express.static(path.join(__dirname, '../frontend')));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });

    win = new BrowserWindow({ show: false, width: 1280, height: 860, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', (_, level, message) => { if (level >= 3) console.error('Renderer:', message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/pages/ai-report.html`);
    await until(() => !document.body.classList.contains('air-booting') && !document.getElementById('platformStartup') && !!AiReportApp.state.doc?.id, 'initial boot');

    // Without a default, newest saved report loads first.
    assert.equal(await evaluate(() => AiReportApp.state.doc.name), '边界与八向缩放验收 2026-11-05');

    // Open dropdown and verify every title & month pill sits cleanly on a single horizontal line.
    const beforeMetrics = await evaluate(() => {
        const menu = document.querySelector('.air-report-menu');
        menu.open = true;
        const panel = menu.querySelector('.air-menu-panel').getBoundingClientRect();
        const rows = [...document.querySelectorAll('#airReportList .air-report-row')].map(row => {
            const title = row.querySelector('.air-report-title').getBoundingClientRect();
            const month = row.querySelector('.air-month-tag').getBoundingClientRect();
            const pin = row.querySelector('.air-report-pin').getBoundingClientRect();
            return {
                name: row.querySelector('.air-report-title').textContent,
                titleH: Math.round(title.height),
                monthH: Math.round(month.height),
                sameLine: Math.abs(title.top - month.top) < 8 && Math.abs(month.top - pin.top) < 8,
                noOverlap: title.right <= month.left && month.right <= pin.left
            };
        });
        return { panelW: Math.round(panel.width), rows };
    });
    assert.ok(beforeMetrics.panelW >= 340, `Expected wide panel >=340px, got ${beforeMetrics.panelW}`);
    assert.equal(beforeMetrics.rows.length, 5);
    for (const row of beforeMetrics.rows) {
        assert.ok(row.titleH <= 24, `Title wrapped for ${row.name}: height=${row.titleH}`);
        assert.ok(row.monthH <= 24, `Month wrapped for ${row.name}: height=${row.monthH}`);
        assert.equal(row.sameLine, true, `Row misaligned for ${row.name}`);
        assert.equal(row.noOverlap, true, `Row elements overlapped for ${row.name}`);
    }

    // Click inline star button for 护网与网络安全月报 while menu stays open.
    await evaluate(id => document.querySelector(`[data-set-default="${id}"]`).click(), targetDefault.id);
    await until(id => document.querySelector(`[data-set-default="${id}"]`)?.getAttribute('aria-pressed') === 'true', 'inline default set', targetDefault.id);
    await wait(80);
    const screenshotPath = '/Users/dragon/.gemini/antigravity/brain/2ebb7a64-0ca4-4c81-be84-4877e5b58992/scratch/air-dropdown-default.png';
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, (await win.webContents.capturePage()).toPNG());

    // Reload and verify 护网与网络安全月报 opens automatically with default summary badge and clean Saved state.
    await win.reload();
    await until(() => !document.body.classList.contains('air-booting') && !document.getElementById('platformStartup') && !!AiReportApp.state.doc?.id, 'reload opens default');
    const afterReload = await evaluate(() => ({
        name: AiReportApp.state.doc.name,
        isDefault: AiReportApp.state.doc.isDefault,
        badgeHidden: document.getElementById('airReportDefaultFlag').hidden,
        badgeText: document.getElementById('airReportDefaultFlag').textContent,
        status: document.getElementById('airStatus').textContent,
        toggleText: document.getElementById('airToggleDefault').textContent
    }));
    assert.equal(afterReload.name, '护网与网络安全月报');
    assert.equal(afterReload.isDefault, true);
    assert.equal(afterReload.badgeHidden, false);
    assert.match(afterReload.badgeText, /默认/);
    assert.equal(afterReload.status, '已保存');
    assert.match(afterReload.toggleText, /取消默认/);

    // Clear default via dropdown action button and confirm reload falls back to newest report.
    await evaluate(() => document.getElementById('airToggleDefault').click());
    await until(() => document.getElementById('airReportDefaultFlag').hidden === true, 'cleared default');
    await win.reload();
    await until(() => !document.body.classList.contains('air-booting') && !document.getElementById('platformStartup') && !!AiReportApp.state.doc?.id, 'reload fallback');
    assert.equal(await evaluate(() => AiReportApp.state.doc.name), '边界与八向缩放验收 2026-11-05');

    console.log('PASS: AI report dropdown keeps single-line layout without wrapping and default report persists cleanly across reloads.', screenshotPath);
}).catch(error => {
    process.exitCode = 1;
    console.error(error);
}).finally(async () => {
    win?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/tenant-sqlite-pool').closeAll();
    app.exit(process.exitCode || 0);
});
