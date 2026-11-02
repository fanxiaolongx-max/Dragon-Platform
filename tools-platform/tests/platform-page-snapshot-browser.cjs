// Generate fixtures with PLATFORM_DEMO_FIXTURE_DIR=/tmp/platform-demo-fixtures node --test tests/platform-page-snapshot.test.js
// Then: node_modules/.bin/electron tests/platform-page-snapshot-browser.cjs /tmp/platform-demo-fixtures
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
    for (const slug of ['uivf12', 'sla', 'report', 'expedite', 'monthly', 'legacy', 'topic-analysis', 'network_safety_meeting_summary']) {
        const win = new BrowserWindow({ show: false, width: 1440, height: 1000 });
        const errors = [], remote = [];
        win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
        win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
            if (/^https?:/.test(details.url)) remote.push(details.url);
            callback({ cancel: /^https?:/.test(details.url) });
        });
        await win.loadFile(path.join(dir, slug + '.html'));
        await new Promise(resolve => setTimeout(resolve, 1200));
        const result = await win.webContents.executeJavaScript(`({text:document.body.innerText,readonly:!!document.getElementById('tp-demo-nav'),legacy:document.getElementById('airLegacyReport')?.textContent})`);
        assert.ok(result.readonly, slug);
        if (slug === 'uivf12') assert.match(await win.webContents.executeJavaScript("document.querySelector('.script-item')?.textContent || ''"), /示例抓取/);
        if (slug === 'sla') assert.match(result.text, /演示指标/);
        if (slug === 'monthly') { assert.match(result.text, /Demo monthly report/); assert.match(result.legacy, /旧月报|Classic/); }
        if (slug === 'network_safety_meeting_summary') assert.match(result.text, /Saved demo slides/);
        await win.webContents.executeJavaScript("window.ToolsI18n?.setLanguage('en-US')");
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(await win.webContents.executeJavaScript("window.ToolsI18n?.getLanguage() || 'en-US'"), 'en-US', slug + ': language switch');
        win.setSize(390, 844);
        await win.webContents.executeJavaScript("document.documentElement.dataset.theme='light'");
        assert.deepEqual(errors, [], slug + ': console errors');
        assert.deepEqual(remote, [], slug + ': network dependencies');
        await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(dir, slug + '.png'), image.toPNG()));
        console.log('PASS', slug);
        win.destroy();
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
