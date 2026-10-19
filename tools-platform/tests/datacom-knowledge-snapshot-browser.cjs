// node_modules/.bin/electron tests/datacom-knowledge-snapshot-browser.cjs
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-snapshot-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server;
const requests = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn) {
    for (let i = 0; i < 200; i++) {
        if (await evaluate(fn)) return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Timed out: ' + fn);
}

app.whenReady().then(async () => {
    // 用 Node 创建隔离测试数据库和导出物，避免 Electron 与 Node 原生模块 ABI 的差异。
    execFileSync('node', ['-e', `
        const fs = require('fs'), path = require('path');
        const temp = process.env.DATACOM_TEST_DIR;
        const repo = require('./backend/models/datacom-knowledge-repository');
        const snapshot = require('./backend/models/datacom-knowledge-snapshot');
        (async () => {
            await repo.createArticles([{id:'browser-article', title:'浏览器快照文章', categoryId:'ospf-basics', bodyMd:'# 正文标题\\n浏览器正文检索 needle-browser\\n\\n\`\`\`mermaid\\nflowchart TD\\n A --> B\\n\`\`\`'}], 'test');
            fs.writeFileSync(path.join(temp, 'single.html'), await snapshot.buildSnapshot('default'));
            const output = await snapshot.buildPagesSnapshot('default');
            const root = path.join(temp, 'pages'); fs.mkdirSync(root);
            fs.writeFileSync(path.join(root, 'index.html'), output.html);
            for (const [name, content] of output.files) {const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
            await require('./backend/models/tenant-sqlite-pool').closeAll();
            await require('./backend/models/app-db').closeDatabase();
        })().catch(error=>{console.error(error);process.exit(1)});
    `], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DATACOM_TEST_DIR: temp, TOOLS_DATA_DIR: path.join(temp, 'data'), TOOLS_REPORT_DATA_DIR: path.join(temp, 'reports') }
    });
    const web = express();
    web.use('/project/datacom-protocol-expert', express.static(path.join(temp, 'pages')));
    server = await new Promise(resolve => { const server = web.listen(0, '127.0.0.1', () => resolve(server)); });
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        if (details.url.startsWith('http')) requests.push(details.url);
        callback({ cancel: false });
    });
    win = new BrowserWindow({ show: false, width: 1350, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    for (const mode of ['pages', 'single']) {
        const start = requests.length;
        if (mode === 'pages') await win.loadURL(`http://127.0.0.1:${server.address().port}/project/datacom-protocol-expert/index.html`);
        else await win.loadFile(path.join(temp, 'single.html'));
        await until(() => !!document.querySelector('.dk-hero'));
        assert.equal(await evaluate(() => document.querySelectorAll('[data-action="new-article"],[data-action="import"],[data-action="manage"]').length), 0);
        await evaluate(() => { const input = document.querySelector('#searchInput'); input.value = 'needle-browser'; input.dispatchEvent(new Event('input')); });
        await until(() => document.querySelector('#searchResults')?.textContent.includes('浏览器快照文章'));
        await evaluate(() => { location.hash = '#/a/browser-article'; });
        await until(() => document.querySelector('#articleBody')?.textContent.includes('needle-browser'));
        await until(() => !!document.querySelector('#articleBody .dk-mermaid svg'));
        assert.equal(await evaluate(() => document.querySelectorAll('[data-action="edit"],[data-action="history"]').length), 0);
        await evaluate(() => document.querySelector('#themeBtn').click());
        assert.equal(await evaluate(() => document.documentElement.dataset.theme), 'light');
        await evaluate(() => { location.hash = '#/lab/prefix-matcher'; });
        await until(() => !!document.querySelector('#labHost input'));
        await evaluate(() => { location.hash = '#/labs'; });
        await until(() => document.querySelectorAll('.dk-lab-card.is-lesson').length > 0);
        await evaluate(() => { location.hash = document.querySelector('.dk-lab-card.is-lesson').getAttribute('href'); });
        await until(() => !!document.querySelector('#labHost .dk-diagram'));
        win.setSize(390, 844);
        await evaluate(() => document.querySelector('#navToggle').click());
        assert.equal(await evaluate(() => document.body.classList.contains('is-nav-open')), true);
        win.setSize(1350, 900);
        const modeRequests = requests.slice(start);
        assert.equal(modeRequests.some(url => url.includes('/api/')), false, JSON.stringify(modeRequests));
        if (mode === 'single') assert.deepEqual(modeRequests, [], 'single HTML must work without HTTP requests');
        console.log(`${mode}: catalog, full-text search, article, Mermaid, teaching/interactive labs, readonly controls, theme and mobile navigation passed`);
    }
}).then(() => { process.exitCode = 0; }).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (win) win.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode);
});
