// node_modules/.bin/electron --disable-gpu tests/dining-wechat-snapshot-browser.cjs
const { app, BrowserWindow, nativeTheme } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { injectLanguageRuntime } = require('../backend/models/custom-tool-i18n-service');
const XLSX = require('../frontend/js/shared/xlsx.full.min.js');

const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dining-wechat-snapshot-'));
const slug = 'tool-dining-card-wechat';
const date = '2026-10-29';
const snapshot = (id, type) => ({
    id,
    name: id,
    payload: {
        wechatData: {
            loaded: true,
            files: [{ fileName: '微信账单.csv', details: [{ '交易类型': type || '收入', '金额(元)': 35, '餐别': '早餐' }] }],
            records: [{ cairoDate: date, meal: '早餐', category: '非自有-微信', amount: 35, ...(type && { transactionType: type }) }],
            aggregatedByDate: {
                [date]: {
                    breakfastOwn: 0, breakfastNonOwn: 1, lunchOwn: 0, lunchNonOwn: 0,
                    dinnerOwn: 0, dinnerNonOwn: 0, unknownOwn: 0, unknownNonOwn: 0,
                    totalOwn: 0, totalNonOwn: 1, total: 1
                }
            }
        }
    }
});

app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
let server, win;
app.whenReady().then(async () => {
    nativeTheme.themeSource = 'dark';
    const verified = snapshot('verified', '二维码收款');
    const legacy = snapshot('legacy');
    const items = [verified, legacy];
    const html = fs.readFileSync(path.join(root, 'backend/builtin-tools', slug, 'index.html'), 'utf8')
        .replace(/https:\/\/cdn.sheetjs.com\/[^"]+/, '/xlsx.js')
        .replace(/https:\/\/cdn.jsdelivr.net\/npm\/chart.js[^"]+/, '/chart.js');
    const web = express();
    web.get('/', (_, res) => res.type('html').send(injectLanguageRuntime(html, slug)));
    web.get('/xlsx.js', (_, res) => res.sendFile(path.join(root, 'frontend/js/shared/xlsx.full.min.js')));
    web.get('/chart.js', (_, res) => res.type('js').send('window.Chart = class { destroy() {} };'));
    web.get('/js/shared/custom-tool-i18n-runtime.js', (_, res) => res.sendFile(path.join(root, 'frontend/js/shared/custom-tool-i18n-runtime.js')));
    web.get('/api/custom-tools/:slug/snapshots', (_, res) => res.json({ success: true, items }));
    web.get('/api/custom-tools/:slug/snapshots/:id', (req, res) => res.json({
        success: true, item: items.find(item => item.id === req.params.id)
    }));
    web.post('/api/custom-tools/:slug/snapshots', express.json(), (req, res) => {
        items.push(req.body);
        res.status(201).json({ success: true, item: req.body });
    });
    await new Promise(resolve => { server = web.listen(0, '127.0.0.1', resolve); });
    win = new BrowserWindow({ show: false, width: 430, height: 850 });
    await win.loadURL('http://127.0.0.1:' + server.address().port);
    const exported = path.join(temp, 'transfers.xlsx');
    const downloaded = new Promise(resolve => win.webContents.session.once('will-download', (_, item) => {
        item.setSavePath(exported);
        item.once('done', (_, state) => resolve(state));
    }));
    const result = await win.webContents.executeJavaScript(`(${async () => {
        const byId = id => document.getElementById(id);
        const waitFor = async predicate => {
            for (let i = 0; i < 120; i++) {
                if (predicate()) return;
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            throw new Error('Timed out waiting for the snapshot UI');
        };
        const restore = async (id, name = id) => {
            byId('sidebarHistoryBtn').click();
            const button = () => document.querySelector('.restore-snap-btn[data-id="' + id + '"]');
            await waitFor(button);
            button().click();
            await waitFor(() => byId('activeSnapshotTitle').textContent === name &&
                !byId('restoreProgressModal').classList.contains('show'));
        };

        window.alert = message => { window.lastAlert = message; };
        await restore('verified');
        const verifiedTotal = byId('resultDesc').textContent;
        const verifiedDaily = byId('wechatTableBody').querySelector('td:last-child').textContent;
        const showTransfers = () => document.querySelector('[data-tab="transfers"]').click();
        showTransfers();
        const noSavedTransfers = byId('wechatTransfersEmpty').textContent;
        await restore('legacy');
        const legacyHidden = byId('resultArea').style.display === 'none';
        const notice = byId('wechatLegacyNotice');
        byId('exportWechatStandaloneBtn').click();
        const exportAlert = window.lastAlert;
        window.ToolsCustomI18n.setLanguage('en');
        await waitFor(() => notice.textContent.includes('Reimport the original WeChat bill'));
        const noticeVisible = !notice.hidden;
        window.ToolsCustomI18n.setLanguage('zh');
        const excelTime = (hour, minute, second = 0) => Date.UTC(2026, 9, 29, hour, minute, second) / 86400000 + 25569;
        const bill = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([
            ['交易时间', '交易类型', '交易对方', '收/支', '金额(元)'],
            [excelTime(15, 59, 8), '转账', '补款人', '收入', 35],
            [excelTime(16, 0), '转账', '收款人', '支出', 105.50],
            [excelTime(16, 1), '二维码收款', '扫码人', '收入', 35]
        ]);
        sheet.A2.z = 'm/d/yy';
        sheet.A3.z = sheet.A4.z = 'yyyy/m/d hh:mm:ss';
        XLSX.utils.book_append_sheet(bill, sheet, '微信账单');
        const data = new DataTransfer();
        data.items.add(new File([XLSX.write(bill, { bookType: 'xlsx', type: 'array' })], '微信账单.xlsx'));
        const input = byId('wechatFileInput');
        input.files = data.files;
        input.dispatchEvent(new Event('change'));
        const exportButton = byId('exportWechatTransfersBtn');
        await waitFor(() => !exportButton.disabled);
        const transferTotal = [...byId('wechatTransfersSummary').querySelectorAll('tbody tr:last-child td')].map(td => td.textContent);
        const importedDiningTotal = byId('resultDesc').textContent;
        const detailCount = byId('wechatTransfersDetails').querySelectorAll('tbody tr').length;
        const fitsWindow = document.documentElement.scrollWidth <= innerWidth;
        window.ToolsCustomI18n.setLanguage('en');
        await waitFor(() => byId('viewTransfers').querySelector('h2').textContent === 'WeChat Transfers');
        window.ToolsCustomI18n.setLanguage('zh');
        exportButton.click();
        await waitFor(() => !document.body.classList.contains('import-locked'));
        byId('sidebarSaveBtn').click();
        const savedName = '转账验证快照';
        byId('snapshotNameInput').value = savedName;
        byId('confirmSaveSnapshotBtn').click();
        await waitFor(() => !byId('saveSnapshotModal').classList.contains('show'));
        const { items } = await fetch('/api/custom-tools/tool-dining-card-wechat/snapshots').then(res => res.json());
        const saved = items.find(item => item.name === savedName);
        byId('clearWechatBtn').click();
        await restore(saved.id, savedName);
        const restoredTransferCount = byId('wechatTransfersDetails').querySelectorAll('tbody tr').length;
        return { verifiedTotal, verifiedDaily, legacyHidden, noticeVisible, exportAlert, noSavedTransfers, transferTotal, importedDiningTotal, detailCount, fitsWindow, restoredTransferCount };
    }})()`);
    assert.match(result.verifiedTotal, /总匹配记录：1 条/);
    assert.equal(result.verifiedDaily, '1');
    assert.equal(result.legacyHidden, true);
    assert.equal(result.noticeVisible, true);
    assert.match(result.exportAlert, /没有微信就餐统计数据可导出/);
    assert.match(result.noSavedTransfers, /此快照未保存转账记录/);
    assert.match(result.importedDiningTotal, /总匹配记录：1 条/);
    assert.deepEqual(result.transferTotal, ['总计', '2', '35.00', '105.50', '0.00']);
    assert.equal(result.detailCount, 2);
    assert.equal(result.restoredTransferCount, 2);
    assert.equal(result.fitsWindow, true);
    const downloadTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Excel download timed out')), 5000));
    assert.equal(await Promise.race([downloaded, downloadTimeout]), 'completed');
    const workbook = XLSX.read(fs.readFileSync(exported), { type: 'buffer' });
    assert.deepEqual(workbook.SheetNames, ['每日转账汇总', '转账明细']);
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets['转账明细']).map(row => row['金额（元）']), [105.5, 35]);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['每日转账汇总']).at(-1)['转账笔数'], 2);
    console.log('PASS: legacy snapshot protection, separate transfers and dining totals, Excel export, narrow layout and bilingual notice.');
    win.destroy();
    server.close();
    app.exit(0);
}).catch(error => {
    console.error(error);
    win?.destroy();
    server?.close();
    app.exit(1);
});
