// node_modules/.bin/electron tests/ezscan-warehouse-theme-browser.cjs
'use strict';
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const auditContrast = require('./helpers/ezscan-contrast-audit.cjs');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-theme-'));
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-contrast-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
const domain = require('../frontend/js/ezscan-warehouse-domain');
const repo = require('../backend/models/ezscan-warehouse-repository');
const pool = require('../backend/models/tenant-sqlite-pool');
const root = path.join(__dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server, exitCode = 0;
const reports = [], errors = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function check(name, scope = 'body', screenshot = false, keepFocus = false) {
    if (!keepFocus) await evaluate(() => document.activeElement?.blur());
    await wait(35);
    const report = await evaluate(auditContrast, scope);
    reports.push({ name, ...report });
    if (screenshot) fs.writeFileSync(path.join(artifacts, name + '.png'), (await win.webContents.capturePage()).toPNG());
    const scrollable = await evaluate(selector => {
        const root = document.querySelector(selector);
        return [...root.querySelectorAll('*')].filter(node => {
            const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
            return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 &&
                ((/(auto|scroll)/.test(css.overflowY) && node.scrollHeight > node.clientHeight + 2) ||
                 (/(auto|scroll)/.test(css.overflowX) && node.scrollWidth > node.clientWidth + 2));
        }).map((node, i) => {
            node.dataset.contrastScroll = String(i);
            return { index: i, left: node.scrollLeft, top: node.scrollTop };
        });
    }, scope);
    for (const item of scrollable) {
        await evaluate(item => {
            const node = document.querySelector('[data-contrast-scroll="' + item.index + '"]');
            node.scrollTop = node.scrollHeight; node.scrollLeft = node.scrollWidth;
        }, item);
        await wait(20);
        reports.push({ name: name + '-scroll-' + item.index, ...await evaluate(auditContrast, scope) });
        await evaluate(item => {
            const node = document.querySelector('[data-contrast-scroll="' + item.index + '"]');
            node.scrollTop = item.top; node.scrollLeft = item.left; delete node.dataset.contrastScroll;
        }, item);
    }
}
async function hover(selector) {
    const point = await evaluate(selector => {
        const node = document.querySelector(selector); if (!node) throw Error('Missing hover target: ' + selector);
        const box = node.getBoundingClientRect(); return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    }, selector);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
    await wait(35);
}
app.whenReady().then(async () => {
    await repo.saveState(domain.appendSamples(domain.emptyState()).data, 0);
    const web = express();
    web.use(express.json({ limit: '25mb' }));
    web.use('/api/custom-tools/tool-mv9strpn/warehouse', (req, _res, next) => {
        req.user = { username: 'theme-audit', role: 'admin' }; next();
    }, require('../backend/routes/ezscan-warehouse'));
    web.use('/js', express.static(path.join(root, 'frontend/js')));
    web.use('/css', express.static(path.join(root, 'frontend/css')));
    web.get('/', (_req, res) => res.type('html').send(require('../backend/models/custom-tool-i18n-service').injectLanguageRuntime(fs.readFileSync(path.join(root, 'backend/builtin-tools/tool-mv9strpn/index.html'), 'utf8'), 'tool-mv9strpn', { inlineRuntime: true })));
    server = await new Promise(resolve => { const instance = web.listen(0, '127.0.0.1', () => resolve(instance)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true } });
    win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    for (let i = 0; i < 200; i++) {
        if (await evaluate(() => typeof storage !== 'undefined' && storage.getStatus().loaded)) break;
        if (i === 199) throw Error('Warehouse did not load');
        await wait(20);
    }
    await evaluate(() => { window.confirm = () => true; window.print = () => {}; });
    for (const theme of ['dark', 'light']) {
        nativeTheme.themeSource = theme;
        await evaluate(theme => { const el = document.getElementById('warehouseTheme'); el.value = theme; el.dispatchEvent(new Event('change')); }, theme);
        const pages = await evaluate(() => ['首页', '业务流程图', ...MODULES]);
        for (const name of pages) {
            await evaluate(name => { closeModal(); closeTabPopup(false); navigate(name); }, name);
            await check(theme + '-page-' + name);
            if (await evaluate(name => Boolean(CONFIG[name]), name)) {
                await evaluate(name => viewRecord(db[CONFIG[name].key][0].id), name);
                await check(theme + '-detail-' + name, '#modalMask');
                await evaluate(name => { closeModal(); editMaster(db[CONFIG[name].key][0].id); }, name);
                await check(theme + '-edit-' + name, '#modalMask');
                await evaluate(() => closeModal());
            } else if (await evaluate(name => DOCS.includes(name), name)) {
                for (const status of ['草稿', '已审核']) {
                    await evaluate(({ name, status }) => showDoc(db.docs.find(row => row.type === name && row.status === status).id), { name, status });
                    await check(theme + '-form-' + name + '-' + status);
                }
            }
        }
        await evaluate(() => { navigate('首页'); closeTabs('all'); openTabPopup(); });
        await check(theme + '-tabs-home-only', '#tabPopup', true);
        await evaluate(() => document.getElementById('tabSearch').focus());
        await check(theme + '-tabs-search-focus', '#tabPopup', true, true);
        await evaluate(() => document.querySelector('.tab-menu-action:not(:disabled)').focus());
        await check(theme + '-tabs-command-focus', '#tabPopup', false, true);
        await hover('.tab-search-item.current'); await check(theme + '-tabs-current-hover', '#tabPopup');
        await hover('.tab-menu-action:not(:disabled)'); await check(theme + '-tabs-command-hover', '#tabPopup');
        await evaluate(() => { const el = document.getElementById('tabSearch'); el.value = '入库'; renderTabSearch(el.value); });
        await check(theme + '-tabs-search', '#tabPopup');
        await hover('.tab-search-item:not(.current)'); await check(theme + '-tabs-result-hover', '#tabPopup');
        await evaluate(() => renderTabSearch('NO_SUCH_PAGE')); await check(theme + '-tabs-empty', '#tabPopup');
        await evaluate(() => { closeTabPopup(false); navigate('货品档案'); navigate('仓库设置'); openTabPopup(); });
        await check(theme + '-tabs-enabled', '#tabPopup', true);
        await evaluate(() => { closeTabPopup(false); tabSettings(); }); await check(theme + '-tab-settings', '#modalMask');
        await evaluate(() => document.getElementById('tabLimitSetting').focus()); await check(theme + '-tab-settings-focus', '#modalMask', false, true);
        await evaluate(() => { closeModal(); migrationPanel(); }); await check(theme + '-migration', '#modalMask', true);
        await evaluate(() => { closeModal(); dataPanel(); }); await check(theme + '-data-backup', '#modalMask');
        await evaluate(() => { closeModal(); navigate('其他入库单'); showDoc(db.docs.find(row => row.type === '其他入库单' && row.status === '草稿').id); pickProducts(); });
        await check(theme + '-product-picker', '#modalMask');
        await evaluate(() => document.getElementById('pickQ').focus()); await check(theme + '-product-picker-focus', '#modalMask', false, true);
        await evaluate(() => { closeModal(); navigate('应收账款'); settle(db.receivables[0].id); document.getElementById('settleError').textContent = '金额不能超过账单余额'; });
        await check(theme + '-settlement-error', '#modalMask');
        await evaluate(() => { closeModal(); navigate('总货品库存'); opening(stockRows()[0].id); }); await check(theme + '-opening', '#modalMask');
        await evaluate(() => { closeModal(); navigate('条码标签打印'); previewLabels(db.products[0].id); }); await check(theme + '-barcode-paper', '#modalMask');
        await evaluate(() => { closeModal(); navigate('其他入库单'); action('list'); });
        await evaluate(() => document.querySelector('tbody tr[data-row]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 380 })));
        await check(theme + '-context-menu', '#contextMenu'); await hover('#contextMenu button'); await check(theme + '-context-hover', '#contextMenu');
        await evaluate(() => { document.getElementById('contextMenu').remove(); navigate('货品档案'); selected.add(exportRows[0].id); render(); });
        await check(theme + '-table-selected'); await hover('.list-table tbody tr'); await check(theme + '-table-hover');
        await evaluate(() => { navigate('首页'); storeError = '服务器暂时不可用，请重试保存'; updateStatus(); }); await check(theme + '-save-error');
        await evaluate(() => { storeError = ''; blockedStorage = true; updateStatus(); navigate('其他入库单'); }); await check(theme + '-readonly');
        await evaluate(() => { blockedStorage = false; updateStatus(); navigate('首页'); });
        await evaluate(() => showToast('操作完成，当前数据已保存')); await check(theme + '-toast', '#toast');
        await hover('#sidebar .leaf-item:not(.active)'); await check(theme + '-sidebar-leaf-hover');
        await hover('#sidebar .nav-title'); await check(theme + '-sidebar-group-hover');
        await hover('#sidebar .sub-folder-title'); await check(theme + '-sidebar-folder-hover');
        await evaluate(() => navigate('其他入库单'));
        await hover('.toolbar .btn-orange'); await check(theme + '-primary-action-hover');
        await hover('.toolbar .btn-danger:not(:disabled)'); await check(theme + '-danger-action-hover');
        win.setContentSize(480, 900); await wait(50);
        await evaluate(() => openTabPopup()); await check(theme + '-tabs-mobile', '#tabPopup', true);
        await evaluate(() => { closeTabPopup(false); migrationPanel(); }); await check(theme + '-migration-mobile', '#modalMask');
        await evaluate(() => closeModal()); win.setContentSize(1440, 1000); await wait(30);
    }
    fs.writeFileSync(path.join(artifacts, 'contrast-report.json'), JSON.stringify(reports, null, 2));
    const failures = reports.flatMap(report => report.failures.map(failure => ({ name: report.name, ...failure })));
    console.log(JSON.stringify({ states: reports.length, measurements: reports.reduce((n, row) => n + row.measured, 0), failures: failures.length, artifacts }));
    console.log(JSON.stringify(failures.slice(0, 35), null, 2));
    assert.deepEqual(errors, []);
    assert.equal(failures.length, 0, 'Some visible text falls below its contrast threshold; see contrast-report.json');
}).catch(error => { console.error(error); exitCode = 1; }).finally(async () => {
    win?.destroy(); if (server) await new Promise(resolve => server.close(resolve));
    await pool.closeAll(); fs.rmSync(temp, { recursive: true, force: true }); app.exit(exitCode);
});
