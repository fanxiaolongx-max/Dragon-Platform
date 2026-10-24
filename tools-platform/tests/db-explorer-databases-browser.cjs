// Run: node_modules/.bin/electron tests/db-explorer-databases-browser.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'db-explorer-browser-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
let win, server;
let delayTables = false;
let delayRows = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
const execute = (db, sql) => new Promise((resolve, reject) => db.run(sql, err => err ? reject(err) : resolve()));
async function until(fn) {
    for (let i = 0; i < 150; i++) {
        if (await evaluate(fn)) return;
        await wait(40);
    }
    throw new Error('Timed out: ' + fn);
}

app.whenReady().then(async () => {
    await appDb.run('CREATE TABLE tools_marker (value TEXT)');
    await appDb.run("INSERT INTO tools_marker VALUES ('tools-value')");
    await require('../backend/models/sla-prefs-repository').ensureReady();
    await require('../backend/models/sla-targets-repository').getTargets();
    await require('../backend/models/sla-groups-repository').ensureReady();
    await require('../backend/models/sla-categories-repository').ensureReady();
    await require('../backend/models/sla-snapshots-repository').listSnapshots();
    await require('../backend/models/import-source-repository').ensureReady();
    await execute(pool.getConnection('report.db', 'report'), 'CREATE TABLE report_marker (value TEXT)');
    await execute(pool.getConnection('report.db', 'report'), "INSERT INTO report_marker VALUES ('report-value')");
    await execute(pool.getConnection('requirements.db'), 'CREATE TABLE requirement_marker (value TEXT)');
    const web = express();
    web.use(express.json());
    web.use((req, _res, next) => { req.user = { role: 'admin' }; next(); });
    web.get('/js/shared/navbar.js', (_req, res) => res.type('js').send(''));
    web.use('/api/db-explorer', async (req, _res, next) => {
        if (req.query.database === 'report' && ((delayTables && req.path === '/catalog') || (delayRows && req.path.startsWith('/tables/')))) await wait(200);
        next();
    });
    web.use('/api/db-explorer', require('../backend/routes/db-explorer'));
    web.use(express.static(path.join(__dirname, '../frontend')));
    server = await new Promise(resolve => {
        const server = web.listen(0, '127.0.0.1', () => resolve(server));
    });
    win = new BrowserWindow({ show: false, width: 1450, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const base = `http://127.0.0.1:${server.address().port}`;
    nativeTheme.themeSource = 'dark';
    await win.loadURL(base + '/pages/db-explorer.html');
    await until(() => document.getElementById('database-select').options.length === 3 && !document.getElementById('btn-execute-sql').disabled);
    assert.equal(await evaluate(() => selectedDatabase), 'tools');
    assert.equal(await evaluate(() => document.documentElement.dataset.explorerTheme), 'light', 'fresh page defaults to light even on a dark OS');
    assert.equal(await evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(243, 245, 248)');
    assert.equal(await evaluate(() => {
        const editor = document.getElementById('sql-input');
        const style = getComputedStyle(editor);
        const expected = 2 * parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        return editor.rows === 2 && Math.abs(editor.getBoundingClientRect().height - expected) < 2 && style.resize === 'vertical';
    }), true, 'SQL editor starts at two lines and remains vertically resizable');
    await evaluate(() => { document.getElementById('sql-input').style.height = '160px'; });
    assert.equal(await evaluate(() => document.getElementById('sql-input').getBoundingClientRect().height), 160);
    await evaluate(() => { document.getElementById('sql-input').style.height = ''; });
    assert.match(await evaluate(() => document.getElementById('database-context').textContent), /tools\.db/);
    assert.match(await evaluate(() => document.getElementById('database-description').textContent), /SLA/);
    assert.equal(await evaluate(() => {
        const first = document.querySelector('.explorer-primary-nav').getBoundingClientRect();
        const second = document.querySelector('.explorer-sidebar').getBoundingClientRect();
        const work = document.querySelector('.explorer-workspace').getBoundingClientRect();
        return first.right <= second.left && second.right <= work.left && second.bottom <= innerHeight;
    }), true, 'two separate menu columns to the left of the workspace');
    assert.equal(await evaluate(() => document.querySelectorAll('.nav-module:not([hidden])').length), 1);
    assert.equal(await evaluate(() => [...document.querySelectorAll('.preset-pill[data-tables]')].find(button => button.dataset.tables === 'sla_prefs').disabled), false);
    const tableCount = await evaluate(() => document.getElementById('table-select').options.length - 1);
    assert.ok(tableCount > 12);
    assert.equal(await evaluate(() => document.querySelectorAll('.table-catalog-item').length), tableCount, 'all tables, not just the first twelve');
    assert.equal(await evaluate(() => [...document.querySelectorAll('.table-catalog-item')].every(button => button.querySelector('small').textContent.length > 5)), true);
    await evaluate(() => {
        document.querySelector('[data-target-module="tables"]').click();
        const search = document.getElementById('table-search');
        search.value = '指标目标';
        search.dispatchEvent(new Event('input'));
    });
    assert.equal(await evaluate(() => document.querySelectorAll('.table-catalog-item').length), 1);
    assert.equal(await evaluate(() => document.querySelector('.table-catalog-item').dataset.table), 'sla_targets');
    await evaluate(() => {
        const search = document.getElementById('table-search');
        search.value = '';
        search.dispatchEvent(new Event('input'));
        document.querySelector('[data-log-days="7"]').click();
    });
    assert.equal(await evaluate(() => document.getElementById('workspace-logs').hidden), false);
    assert.equal(await evaluate(() => document.querySelector('.primary-module.active').dataset.targetModule), 'logs');
    assert.equal(await evaluate(() => (new Date(document.getElementById('log-to-date').value) - new Date(document.getElementById('log-from-date').value)) / 86400000), 6);
    await evaluate(() => document.querySelector('[data-target-module="sql"]').click());
    assert.equal(await evaluate(() => document.getElementById('workspace-sql').hidden), false);
    await evaluate(() => {
        const search = document.getElementById('sql-example-search');
        search.value = 'sla_prefs';
        search.dispatchEvent(new Event('input'));
    });
    assert.equal(await evaluate(() => document.querySelectorAll('.preset-pill:not([hidden])').length), 1);

    await evaluate(() => {
        const select = document.getElementById('database-select');
        select.value = 'report';
        select.dispatchEvent(new Event('change'));
    });
    await until(() => !document.getElementById('btn-execute-sql').disabled && document.getElementById('table-select').options.length === 2);
    assert.equal(await evaluate(() => document.getElementById('table-select').options[1].value), 'report_marker');
    assert.match(await evaluate(() => document.getElementById('sql-input').placeholder), /report_marker/);
    assert.equal(await evaluate(() => document.querySelector('.preset-pill[data-tables="sla_prefs"]').disabled), true);
    assert.equal(await evaluate(() => document.querySelector('.table-catalog-item').dataset.table), 'report_marker');
    await evaluate(() => { document.getElementById('sql-input').value = 'SELECT * FROM report_marker'; executeCustomSql(); });
    await until(() => !document.getElementById('btn-execute-sql').disabled);
    assert.match(await evaluate(() => document.getElementById('sql-results-area').textContent), /report-value/);
    await evaluate(() => document.querySelector('.table-catalog-item').click());
    await until(() => document.getElementById('table-schema-view').textContent.includes('CREATE TABLE'));
    assert.equal(await evaluate(() => document.getElementById('workspace-tables').hidden), false);
    assert.equal(await evaluate(() => document.getElementById('workspace-sql').hidden), true);
    assert.equal(await evaluate(() => document.getElementById('table-schema-tab').getAttribute('aria-selected')), 'true');
    assert.doesNotMatch(await evaluate(() => document.getElementById('table-body').textContent), /report-value/);
    await evaluate(() => document.getElementById('table-data-tab').click());
    await until(() => document.getElementById('table-body').textContent.includes('report-value'));
    await until(() => document.getElementById('table-content-area').style.display === 'block');
    assert.match(await evaluate(() => document.getElementById('table-body').textContent), /report-value/);
    await evaluate(() => switchDatabase('tools'));
    assert.equal(await evaluate(() => document.getElementById('sql-input').value), '');
    assert.equal(await evaluate(() => document.getElementById('sql-results-area').textContent), '');
    assert.equal(await evaluate(() => _currentSqlResults.length), 0);
    assert.equal(await evaluate(() => document.getElementById('table-content-area').style.display), 'none');

    // A slower previous database must never replace the newer table list.
    delayTables = true;
    await evaluate(async () => { await Promise.all([switchDatabase('report'), switchDatabase('requirements')]); });
    assert.equal(await evaluate(() => document.getElementById('database-select').value), 'requirements');
    assert.equal(await evaluate(() => document.getElementById('table-select').options[1].value), 'requirement_marker');
    delayTables = false;
    await evaluate(() => switchDatabase('report'));
    delayRows = true;
    await evaluate(async () => {
        document.getElementById('table-select').value = 'report_marker';
        await Promise.all([loadTableData(true), switchDatabase('tools')]);
    });
    assert.equal(await evaluate(() => document.getElementById('table-body').textContent), '');
    assert.equal(await evaluate(() => document.getElementById('table-content-area').style.display), 'none');
    delayRows = false;

    // Switching and shortcut labels remain usable in both languages/themes/sizes.
    for (const lang of ['zh', 'en']) {
        await evaluate(lang => applyLanguage(lang), lang);
        assert.match(await evaluate(() => document.getElementById('database-select').selectedOptions[0].textContent), lang === 'en' ? /Tools/ : /工具/);
        for (const theme of ['light', 'dark']) {
            nativeTheme.themeSource = theme === 'light' ? 'dark' : 'light';
            await evaluate(theme => {
                const select = document.getElementById('explorer-theme');
                select.value = theme;
                select.dispatchEvent(new Event('change'));
            }, theme);
            assert.equal(await evaluate(() => document.documentElement.dataset.explorerTheme), theme);
            assert.equal(await evaluate(() => getComputedStyle(document.body).backgroundColor), theme === 'light' ? 'rgb(243, 245, 248)' : 'rgb(16, 23, 34)');
            for (const width of [1450, 390]) {
                win.setContentSize(width, 1000);
                await wait(50);
                assert.equal(await evaluate(() => {
                    const select = document.getElementById('database-select').getBoundingClientRect();
                    return select.left >= 0 && select.right <= innerWidth && select.width > 100;
                }), true, `${lang}/${theme}/${width}: database selector overflow`);
            }
        }
    }
    await win.loadURL(base + '/pages/db-explorer.html?database=report');
    await until(() => selectedDatabase === 'report' && !document.getElementById('btn-execute-sql').disabled);
    assert.equal(await evaluate(() => document.documentElement.dataset.explorerTheme), 'dark', 'explicit theme choice persists after reload');
    assert.equal(await evaluate(() => document.getElementById('table-select').options[1].value), 'report_marker');
    if (process.env.DB_EXPLORER_SCREENSHOT) {
        win.setContentSize(1450, 1000);
        nativeTheme.themeSource = 'light';
        await evaluate(() => applyLanguage('zh'));
        await evaluate(() => ExplorerWorkspace.setTheme('light'));
        await evaluate(() => switchDatabase('tools'));
        await evaluate(() => { ExplorerWorkspace.openEditor(); document.getElementById('sql-input').value = 'SELECT id, timestamp, updated_at FROM sla_snapshots\nORDER BY timestamp DESC LIMIT 20;'; executeCustomSql(); });
        await until(() => !document.getElementById('btn-execute-sql').disabled);
        await wait(200);
        fs.writeFileSync(process.env.DB_EXPLORER_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    }
    console.log('PASS: database selector, table browsing, shortcuts, SQL routing, result clearing, stale requests, localization, themes and narrow Electron layout');
}).catch(err => {
    console.error(err);
    process.exitCode = 1;
}).finally(async () => {
    win?.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
