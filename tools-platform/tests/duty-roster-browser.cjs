const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-roster-browser-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
app.setPath('userData', path.join(temp, 'profile'));

const root = path.join(__dirname, '..');
let server, win;
const errors = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);

async function until(fn) {
    for (let i = 0; i < 200; i++) {
        if (await evaluate(fn)) return;
        await wait(50);
    }
    throw new Error(`Timeout: ${fn}`);
}

app.whenReady().then(async () => {
    try {
        const web = express();
        web.use(express.json());
        web.use('/api/duty-roster', require('../backend/routes/duty-roster'));
        web.use(express.static(path.join(root, 'frontend')));

        server = await new Promise(resolve => {
            const listener = web.listen(0, '127.0.0.1', () => resolve(listener));
        });
        const base = `http://127.0.0.1:${server.address().port}`;

        win = new BrowserWindow({
            show: false,
            width: 1300,
            height: 900,
            webPreferences: { contextIsolation: false, nodeIntegration: false }
        });

        win.webContents.on('console-message', (_, level, message) => {
            console.log(`[Browser Console L${level}]`, message);
            if (level === 3) errors.push(message);
        });

        // 1. 加载页面
        await win.loadURL(`${base}/pages/duty-roster.html?month=2026-08`);
        await until(() => !!document.querySelector('#rosterTable tr'));

        console.log('Page loaded successfully');

        // 2. 检查默认中文或全局语言
        const periodHeader = await evaluate(() => document.querySelector('#rosterTable th')?.textContent);
        console.log('Initial Period Header:', periodHeader);
        assert.ok(periodHeader.includes('时间段') || periodHeader.includes('Period'));

        // 3. 测试点击「⏮️ 引入上月」
        console.log('Testing "引入上月" button...');
        await evaluate(() => document.querySelector('#importPrevBtn').click());
        await wait(600);

        // 检查单元格是否被填入内容
        const cellInputs = await evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('.cell-input'));
            return inputs.map(i => i.value).filter(Boolean);
        });
        console.log(`Filled ${cellInputs.length} cells after clicking 引入上月`);
        assert.ok(cellInputs.length > 0, 'Cells should be filled after importing');

        // 4. 测试全局语言切换
        console.log('Testing language switch...');
        await evaluate(() => {
            if (window.ToolsI18n) {
                window.ToolsI18n.setLanguage('en-US');
            }
        });
        await wait(300);

        const periodHeaderEn = await evaluate(() => document.querySelector('#rosterTable th')?.textContent);
        console.log('Period Header in en-US:', periodHeaderEn);
        assert.equal(periodHeaderEn.trim(), 'Period');

        const sunRowEn = await evaluate(() => document.querySelectorAll('#rosterTable tr td.cell-weekday')[0]?.textContent);
        console.log('Sun row label in en-US:', sunRowEn);
        assert.equal(sunRowEn.trim(), 'Sun');

        const friRowEn = await evaluate(() => document.querySelectorAll('#rosterTable tr td.cell-weekday')[5]?.textContent);
        console.log('Fri row label in en-US:', friRowEn);
        assert.equal(friRowEn.trim(), 'Fri');

        // 切换回中文
        await evaluate(() => {
            if (window.ToolsI18n) {
                window.ToolsI18n.setLanguage('zh-CN');
            }
        });
        await wait(300);

        const periodHeaderZh = await evaluate(() => document.querySelector('#rosterTable th')?.textContent);
        console.log('Period Header in zh-CN:', periodHeaderZh);
        assert.equal(periodHeaderZh.trim(), '时间段');

        const sunRowZh = await evaluate(() => document.querySelectorAll('#rosterTable tr td.cell-weekday')[0]?.textContent);
        console.log('Sun row label in zh-CN:', sunRowZh);
        assert.equal(sunRowZh.trim(), '周日');

        const friRowZh = await evaluate(() => document.querySelectorAll('#rosterTable tr td.cell-weekday')[5]?.textContent);
        console.log('Fri row label in zh-CN:', friRowZh);
        assert.equal(friRowZh.trim(), '周五');

        // 5. 验证周末文字标识不显示，但行依然保持 row-weekend 高亮
        const weekendBadgeCount = await evaluate(() => document.querySelectorAll('.weekend-badge, .duty-weekend-tag').length);
        console.log('Weekend badge element count:', weekendBadgeCount);
        assert.equal(weekendBadgeCount, 0, 'No weekend text badges should be displayed');

        const fridayHasClass = await evaluate(() => document.querySelectorAll('#rosterTable tbody tr')[5].classList.contains('row-weekend'));
        assert.equal(fridayHasClass, true, 'Friday row must retain row-weekend highlight');

        // 6. 验证工具栏上没有冗余的语言切换按钮
        const redundantLangBtn = await evaluate(() => !!document.getElementById('langToggleBtn'));
        assert.equal(redundantLangBtn, false, 'Redundant langToggleBtn should not exist in toolbar');

        // 7. 测试保存后在无 URL 参数直接打开页面时，自动呈现最近编辑的月份
        console.log('Testing default open without query param...');
        await evaluate(() => document.querySelector('#saveBtn').click());
        await wait(600);

        await win.loadURL(`${base}/pages/duty-roster.html`);
        await until(() => !!document.querySelector('#rosterTable tr'));
        const autoLoadedMonth = await evaluate(() => document.querySelector('#targetMonth')?.value);
        console.log('Auto loaded default month without URL param:', autoLoadedMonth);
        assert.ok(/^\d{4}-\d{2}$/.test(autoLoadedMonth), 'Auto loaded month should be valid YYYY-MM');
        assert.equal(autoLoadedMonth, '2026-08', 'Should present recently saved/edited month');

        console.log('All browser verification tests passed cleanly!');
        if (server) server.close();
        app.exit(0);
    } catch (err) {
        console.error('Test failed:', err);
        if (server) server.close();
        app.exit(1);
    }
});
