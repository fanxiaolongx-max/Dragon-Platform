// node_modules/.bin/electron tests/ezscan-warehouse-e2e.cjs
'use strict';
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezscan-warehouse-e2e-'));
const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'ezscan-warehouse-screenshots-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {}); // Finish asynchronous cleanup before exiting with the test result.
const repo = require('../backend/models/ezscan-warehouse-repository');
const pool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');
const root = path.join(__dirname, '..');
const route = '/api/custom-tools/tool-mv9strpn/warehouse';
let server, puts = 0, exitCode = 0;
const windows = [], errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (win, fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true)
    .catch(error => { throw new Error(`${error.message}\nBrowser operation: ${fn}\nRenderer errors: ${errors.join('\n')}`); });
async function until(win, condition) {
    for (let i = 0; i < 200; i++) {
        if (await evaluate(win, condition)) return;
        await wait(40);
    }
    throw new Error('Browser condition timed out: ' + condition);
}
async function flush(win) {
    assert.equal(await evaluate(win, () => storage.flush()), true);
    await until(win, () => !storage.getStatus().pending && !storage.getStatus().saving);
}
async function click(win, selector) {
    await evaluate(win, selector => {
        const el = document.querySelector(selector);
        if (!el || el.disabled) throw new Error('Missing or disabled control: ' + selector);
        el.click();
    }, selector);
}
async function fields(win, values) {
    await evaluate(win, values => {
        for (const [name, value] of Object.entries(values)) {
            const field = document.querySelector('#masterForm').elements.namedItem(name);
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, values);
}
async function createMaster(win, module, values) {
    assert.equal(await evaluate(win, name => navigate(name), module), true);
    await click(win, '[data-action="new"]');
    await fields(win, values);
    await click(win, '[data-action="saveMaster"]');
    await flush(win);
    assert.equal(await evaluate(win, () => document.querySelector('#formError')?.textContent || ''), '');
}
async function openWindow(base, partition, viewer = false) {
    const win = new BrowserWindow({ show: false, width: 1380, height: 950,
        webPreferences: { contextIsolation: true, nodeIntegration: false, partition } });
    windows.push(win);
    if (viewer) await win.webContents.session.cookies.set({ url: base, name: 'warehouse_e2e_viewer', value: '1' });
    win.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
    await win.loadURL(base + '/warehouse');
    await until(win, () => typeof storage !== 'undefined' && storage.getStatus().loaded && !storage.getStatus().loading);
    await evaluate(win, () => { window.confirm = () => true; });
    return win;
}

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json({ limit: '25mb' }));
    // Authentication has separate route tests; this fixture keeps real tenant
    // context, validation, optimistic concurrency and SQLite persistence.
    web.use(route, (req, _res, next) => {
        req.user = { username: 'e2e-user', role: req.headers.cookie?.includes('warehouse_e2e_viewer=1') ? 'user' : 'admin', tenantId: 'default' };
        if (req.method === 'PUT') puts++;
        runWithTenant('default', next);
    }, require('../backend/routes/ezscan-warehouse'));
    web.get('/warehouse', (_req, res) => res.type('html').send(require('../backend/models/custom-tool-i18n-service').injectLanguageRuntime(
        fs.readFileSync(path.join(root, 'backend/builtin-tools/tool-mv9strpn/index.html'), 'utf8'), 'tool-mv9strpn', { inlineRuntime: true }
    )));
    web.use('/js', express.static(path.join(root, 'frontend/js')));
    web.use('/css', express.static(path.join(root, 'frontend/css')));
    web.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message, code: error.code }));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    nativeTheme.themeSource = 'light';
    const first = await openWindow(base, 'warehouse-e2e-first');
    await wait(700);
    assert.equal(puts, 0, 'Empty server load must not automatically seed or save business data');
    assert.equal((await repo.loadState()).data, null);
    await createMaster(first, '仓库设置', { code: 'WH-E2E', name: '服务器验证仓', manager: '仓管员', enabled: '启用' });
    await createMaster(first, '货品档案', { code: 'P-E2E', name: '跨设备测试货品', unit: '件', category: '其他', price: '12.5', min: '2' });
    assert.equal(await evaluate(first, () => navigate('其他入库单')), true);
    await click(first, '[data-action="new"]');
    await click(first, '[data-action="addLine"]');
    await click(first, '[name="pickProduct"]');
    await click(first, '[data-action="confirmProducts"]');
    await evaluate(first, () => {
        const qty = document.querySelector('[data-line-key="qty"]');
        qty.value = '7';
        qty.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush(first);
    assert.equal((await repo.loadState()).data.docs[0].status, '草稿');
    await click(first, '[data-action="submitDoc"]');
    await flush(first);
    await click(first, '[data-action="approveDoc"]');
    await flush(first);
    const saved = await repo.loadState();
    assert.equal(saved.data.docs[0].status, '已审核');
    assert.equal(saved.data.docs[0].lines[0].qty, 7);
    assert.equal(await evaluate(first, () => navigate('总货品库存')), true);
    await flush(first);
    assert.equal(await evaluate(first, () => stockRows()[0].qty), 7);
    await wait(3600); // Let the completed save paint and the transient action toast expire.
    fs.writeFileSync(path.join(screenshots, 'warehouse-light.png'), (await first.webContents.capturePage()).toPNG());
    nativeTheme.themeSource = 'dark';
    first.setContentSize(480, 900);
    await wait(150);
    fs.writeFileSync(path.join(screenshots, 'warehouse-dark-narrow.png'), (await first.webContents.capturePage()).toPNG());
    assert.equal(await evaluate(first, () => navigate('货品档案')), true);
    await flush(first);
    const revision = (await repo.loadState()).revision;
    const second = await openWindow(base, 'warehouse-e2e-second');
    assert.equal(await evaluate(second, () => stockRows()[0].qty), 7);
    assert.equal(await evaluate(second, () => db.docs[0].status), '已审核');
    assert.deepEqual(await evaluate(second, () => Object.keys(localStorage)), []);
    assert.equal((await repo.loadState()).revision, revision, 'A new browser must read without rewriting state');
    await pool.closeAll();
    await first.loadURL(base + '/warehouse');
    await until(first, () => storage.getStatus().loaded);
    assert.equal(await evaluate(first, () => db.products[0].code), 'P-E2E');
    assert.equal(await evaluate(first, () => stockRows()[0].qty), 7);
    for (const win of [first, second]) {
        await evaluate(win, () => navigate('货品档案'));
        await click(win, '[data-action="edit"]');
    }
    await fields(first, { name: '第一个窗口已保存' });
    await click(first, '[data-action="saveMaster"]');
    await flush(first);
    await fields(second, { name: '第二个窗口未保存' });
    await click(second, '[data-action="saveMaster"]');
    await until(second, () => storage.getStatus().conflict);
    assert.equal(await evaluate(second, () => writable()), false);
    assert.equal((await repo.loadState()).data.products[0].name, '第一个窗口已保存');
    assert.deepEqual(await evaluate(first, () => Object.keys(localStorage)), []);
    const beforeReadOnly = puts;
    const viewer = await openWindow(base, 'warehouse-e2e-viewer', true);
    await evaluate(viewer, () => { navigate('总货品库存'); navigate('仓库设置'); closeTabs('all'); });
    await wait(600);
    assert.equal(await evaluate(viewer, () => storage.getStatus().canWrite), false);
    assert.equal(puts, beforeReadOnly, 'Read-only navigation and tab operations must not write server data');

    await evaluate(first, () => { window.confirm = () => true; window.downloads = []; window.download = (name, text, type) => downloads.push({ name, text: String(text), type }); });
    await click(first, '#migrationEntry');
    assert.match(await evaluate(first, () => document.querySelector('.modal-body').textContent), /当前浏览器未检测到旧版数据/);
    assert.match(await evaluate(first, () => document.querySelector('.modal-body').textContent), /localhost.*127\.0\.0\.1/);
    assert.equal(await evaluate(first, () => document.querySelector('[data-action="migrateLegacy"]').disabled), true);
    await evaluate(first, () => { document.getElementById('legacyJson').value = '{invalid'; return importLegacyText(); });
    assert.ok(await evaluate(first, () => document.getElementById('migrationError').textContent.length > 0));
    await evaluate(first, () => closeModal());

    // Test every screen and detail with actual records from the server generator.
    await evaluate(first, () => modifySamples('add'));
    await flush(first);
    const sampleCount = (await repo.loadState()).data.docs.length;
    assert.equal(sampleCount, 43);
    const allPages = await evaluate(first, () => {
        const visited = [];
        for (const name of ['首页', '业务流程图', ...MODULES]) {
            if (!navigate(name) || document.querySelector('#app h1')?.textContent !== name) throw Error('Page failed: ' + name);
            if (CONFIG[name]) {
                const row = db[CONFIG[name].key][0];
                if (row) { viewRecord(row.id); if (!document.getElementById('modalMask')) throw Error('Missing detail: ' + name); closeModal(); }
            } else if (DOCS.includes(name)) {
                const row = db.docs.find(doc => doc.type === name);
                showDoc(row.id);
                if (!document.querySelector('#lineTable')) throw Error('Missing document form: ' + name);
            }
            visited.push(name);
        }
        return visited;
    });
    assert.equal(allPages.length, 28);
    // Every document type must apply and reverse its own stock effects.
    await evaluate(first, () => {
        for (const type of DOCS) {
            const doc = db.docs.find(row => row.sampleTag && row.type === type && row.status === '草稿');
            showDoc(doc.id);
            if (docValidation(doc)) throw Error(type + ': ' + docValidation(doc));
            const before = stockMap();
            setStatus('submitDoc');
            if (doc.status !== '已提交') throw Error(type + ' did not submit');
            setStatus('approveDoc');
            if (doc.status !== '已审核') throw Error(type + ' did not approve');
            const expected = new Map(before);
            const changes = {'其他入库单':[3,4],'采购入库单':[3,4],'生产入库单':[3,4],'退货入库单':[3,4],'盘盈入库单':[3,4],'采购收货单':[3,4],'其他出库单':[-3,-4],'领料出库单':[-3,-4],'销售发货单':[-3,-4],'库存调拨单':[-3,-4],'形态转换单':[-3,-4]};
            doc.lines.forEach((line, i) => {
                const key = line.product + '|' + doc.warehouse;
                if (type === '盘点单') expected.set(key, [210,211][i]);
                else if (changes[type]) expected.set(key, before.get(key) + changes[type][i]);
                if (type === '库存调拨单') {
                    const target = line.product + '|' + doc.target;
                    expected.set(target, before.get(target) + [3,4][i]);
                }
            });
            if (type === '形态转换单') {
                const target = doc.lines[0].targetProduct + '|' + doc.warehouse;
                expected.set(target, before.get(target) + 5);
            }
            for (const [key, qty] of expected) if (Math.abs(stockMap().get(key) - qty) > 1e-7) throw Error(type + ' stock effect mismatch');
            setStatus('unapproveDoc');
            if (doc.status !== '草稿') throw Error(type + ' did not reverse');
            for (const [key, qty] of before) if (Math.abs(stockMap().get(key) - qty) > 1e-7) throw Error(type + ' reverse mismatch');
        }
    });
    await flush(first);
    assert.equal((await repo.loadState()).data.docs.length, sampleCount);

    await evaluate(first, () => {
        const order = db.docs.find(row => row.sampleTag && row.type === '采购订单' && row.status === '已审核');
        showDoc(order.id); executeOrder();
        const child = currentDoc();
        if (child.sourceId !== order.id || !document.querySelector('[data-doc="partner"]').disabled) throw Error('Order linkage is not protected');
        showDoc(order.id); executeOrder();
        if (currentDoc().id !== child.id || db.docs.filter(row => row.sourceId === order.id).length !== 1) throw Error('Duplicate execution document created');
        setStatus('submitDoc'); setStatus('approveDoc');
        if (child.status !== '已审核' || !db.payables.some(bill => bill.docId === child.id)) throw Error('Execution approval did not create its linked bill');
        showDoc(order.id); setStatus('unapproveDoc');
        if (order.status !== '已审核') throw Error('Order with execution document was reversed');
        showDoc(child.id); setStatus('unapproveDoc');
        if (!deleteRecord(child.id)) throw Error('Reversed execution draft could not be deleted');
        const outbound = db.docs.find(row => row.sampleTag && row.type === '其他出库单' && row.status === '草稿');
        showDoc(outbound.id);
        const qty = outbound.lines[0].qty; outbound.lines[0].qty = 1000000;
        const before = JSON.stringify([...stockMap()]);
        setStatus('submitDoc'); setStatus('approveDoc');
        if (outbound.status !== '已提交' || before !== JSON.stringify([...stockMap()])) throw Error('Negative-stock approval was allowed');
        setStatus('withdrawDoc'); outbound.lines[0].qty = qty;
        generateSN();
        if (outbound.lines[0].sn.length !== qty) throw Error('Serial generation failed');
        const input = document.querySelector('[data-line-key="qty"]'); input.value = String(qty + 1); updateDocumentInput(input);
        if (outbound.lines[0].sn.length) throw Error('Quantity edit left stale serial numbers');
        outbound.lines[0].qty = qty; persist();
    });
    await flush(first);
    await evaluate(first, async () => {
        const doc = db.docs.find(row => row.sampleTag && row.type === '其他入库单' && row.status === '草稿');
        showDoc(doc.id);
        const before = doc.lines.length;
        const product = db.products.find(row => row.sampleTag);
        const csv = '货品编码,数量\n' + product.code + ',2';
        await importLinesFile(new File([csv], 'minimal.csv', { type: 'text/csv' }));
        if (doc.lines.length !== before + 1 || doc.lines.at(-1).price !== product.price) throw Error('CSV optional defaults failed');
        action('removeLine', doc.lines.at(-1).id);
        if (doc.lines.length !== before) throw Error('Removing imported line failed');
        const raw = JSON.stringify(db);
        let rejectedCrossTenant = false;
        try { validateRestoredState({ ...db, _serverStorage: { tenantId: 'other-tenant' } }); }
        catch (_) { rejectedCrossTenant = true; }
        if (!rejectedCrossTenant) throw Error('Cross-tenant JSON restore was not rejected');
        window.confirm = () => false;
        await restoreFile(new File([raw], 'cancelled-restore.json', { type: 'application/json' }));
        if (JSON.stringify(db) !== raw) throw Error('Cancelled restore modified records');
        window.confirm = () => true;
        backup();
        const saved = JSON.parse(downloads.at(-1).text);
        if (!saved._serverStorage || saved.schema !== 3) throw Error('JSON backup does not include storage metadata');
        if (referenceError('products', product.id) === '') throw Error('Referenced product deletion is not protected');
    });
    await flush(first);

    await evaluate(first, () => {
        navigate('月度出入库统计');
        const rows = monthlyRows();
        if (rows.some(row => !row.code || !row.unit)) throw Error('Monthly data mixes products or units');
        action('monthHistory', rows[0].id);
        if (filtered(movementRows()).some(row => row.code !== rows[0].code)) throw Error('Monthly drilldown lost product filter');
        navigate('PDA扫码记录');
        filterWarehouse = db.warehouses.find(row => row.sampleTag && row.enabled === '启用').id;
        render();
        if (!exportRows.length || exportRows.some(row => row.warehouse !== filterWarehouse)) throw Error('PDA warehouse filtering failed');
        resetFilters();
        navigate('应收账款');
        const bill = db.receivables.find(row => row.sampleTag && row.paid === 0 && !row.docId);
        settle(bill.id);
        document.querySelector('#settleAmount').value = '25.05';
        return confirmSettle(bill.id);
    });
    await flush(first);
    await evaluate(first, () => {
        const bill = db.receivables.find(row => row.sampleTag && row.paid === 25.05);
        if (!bill || bill.payments.length !== 1) throw Error('Payment was not persisted');
        settle(bill.id); undoSettle(bill.id); closeModal();
        if (bill.paid !== 0 || bill.payments.length !== 0) throw Error('Payment reversal failed');
        navigate('条码标签打印');
        const product = db.products.find(row => row.sampleTag);
        previewLabels(product.id);
        if (!document.querySelector('.barcode-label svg')) throw Error('Barcode preview missing');
        closeModal();
        const text = '货品编码,数量,单价,实盘数量,目标货品编码,目标数量\n"' + product.code + '",2,1,0,,0';
        if (parseCSV(text)[1][0] !== product.code) throw Error('CSV quote parsing failed');
    });
    await flush(first);

    // Theme override beats the OS preference; active and pinned tabs keep contrast.
    nativeTheme.themeSource = 'dark';
    for (const [mode, expected] of [['light', 'light'], ['dark', 'dark'], ['system', 'dark']]) {
        await evaluate(first, mode => {
            const control = document.getElementById('warehouseTheme'); control.value = mode;
            control.dispatchEvent(new Event('change', { bubbles: true })); navigate('首页');
        }, mode);
        await wait(80);
        assert.equal(await evaluate(first, () => document.documentElement.dataset.warehouseTheme), expected);
        if (expected === 'dark') {
            const contrast = await evaluate(first, () => {
                const tab = document.querySelector('.top-tab.active');
                const color = getComputedStyle(tab.querySelector('.tab-label')).color.match(/[\d.]+/g).slice(0, 3).map(Number);
                const bg = getComputedStyle(tab).backgroundColor.match(/[\d.]+/g).slice(0, 3).map(Number);
                const luminance = rgb => rgb.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
                return (Math.max(luminance(color), luminance(bg)) + 0.05) / (Math.min(luminance(color), luminance(bg)) + 0.05);
            });
            assert.ok(contrast >= 4.5, 'Active/pinned home tab contrast must be readable: ' + contrast);
        }
    }
    nativeTheme.themeSource = 'light'; await wait(80);
    assert.equal(await evaluate(first, () => document.documentElement.dataset.warehouseTheme), 'light');
    await evaluate(first, () => ToolsCustomI18n.setLanguage('en'));
    await wait(80);
    await evaluate(first, () => {
        navigate('其他入库单'); action('list');
        const filter = document.querySelector('#filterStatus');
        filter.value = '已提交';
        if (filter.value !== '已提交') throw Error('Translation changed a business enum');
        navigate('仓库设置'); editMaster();
    });
    await wait(80);
    assert.equal(await evaluate(first, () => document.querySelector('#masterForm [name="enabled"]').value), '启用');
    assert.equal(await evaluate(first, () => document.querySelector('#warehouseTheme option[value="dark"]').textContent), 'Dark');
    await evaluate(first, () => { closeModal(); ToolsCustomI18n.setLanguage('zh'); navigate('首页'); });
    await wait(80);
    await evaluate(first, () => { document.getElementById('warehouseTheme').value = 'dark'; document.getElementById('warehouseTheme').dispatchEvent(new Event('change')); });
    const themed = await openWindow(base, 'warehouse-e2e-first');
    assert.equal(await evaluate(themed, () => document.documentElement.dataset.warehouseTheme), 'dark', 'Theme override persists when opening another window');
    await wait(100);
    fs.writeFileSync(path.join(screenshots, 'warehouse-dark-tabs.png'), (await first.webContents.capturePage()).toPNG());
    first.setContentSize(480, 900); await wait(100);
    await evaluate(first, () => migrationPanel()); await wait(100);
    fs.writeFileSync(path.join(screenshots, 'warehouse-migration-dark-mobile.png'), (await first.webContents.capturePage()).toPNG());
    await evaluate(first, () => closeModal());
    await evaluate(first, () => modifySamples('remove'));
    await flush(first);
    assert.equal((await repo.loadState()).data.docs.length, 1, 'Cleaning sample data preserves pre-existing records');
    assert.equal(await evaluate(first, () => localStorage.getItem(KEY)), null, 'No business data is stored in localStorage');
    assert.deepEqual(errors, []);
    console.log('PASS: 28 pages/details, all 14 document approval/reversal flows, migration diagnostics, sample add/cleanup, financial settlement/reversal, reports/drilldown, barcode preview, CSV, three theme modes and dark-tab contrast, persistence and concurrent-save protection.');
    console.log('Screenshots: ' + screenshots);
}).catch(error => { console.error(error); exitCode = 1; }).finally(async () => {
    windows.forEach(win => win.destroy());
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(exitCode);
});
