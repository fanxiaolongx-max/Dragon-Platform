// node_modules/.bin/electron tests/snapshot-portal-browser.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const express = require('express');
const ROOT = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
let server, win;
const failures = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn, count = 300) {
    for (let i = 0; i < count; i++) { if (await evaluate(fn)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error(`Timed out: ${fn}\n${await evaluate(() => document.body.innerText.slice(0, 1500))}\n${JSON.stringify(failures.slice(-10))}`);
}
app.whenReady().then(async () => {
    execFileSync('node', ['-e', `
        const fs=require('fs'),path=require('path');
        const root=process.env.PORTAL_TEST_DIR;
        (async()=>{
            const tools=require('./backend/models/custom-tools-repository');
            await require('./backend/models/platform-promotions-repository').saveConfig({maxLinks:2,rotateSeconds:10,links:[{id:'portal-link',name:'静态推广链接',nameEn:'Static promotion link',url:'https://promotion.example/landing',coverImage:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='}]});
            await tools.createTool({slug:'demo-tool',name:'已发布工具',nameEn:'Published tool',htmlContent:'<!doctype html><html><head><title>Demo</title></head><body><h1 id="publishedDemo">Published private snapshot</h1></body></html>'});
            await tools.createTool({slug:'private-tool',name:'未发布工具',nameEn:'Unpublished tool',htmlContent:'<!doctype html><html><head></head><body>Never published</body></html>'});
            const checkout=path.join(root,'site');fs.mkdirSync(checkout);
            const files=new Map([['demo-tool/index.html','<!doctype html><html><head></head><body><h1 id="publishedDemo">Published private snapshot</h1></body></html>']]);
            files.set('demo-tool/data/chunked.json',JSON.stringify({value:'汉'.repeat(3*1024*1024)}));
            const datacom=await require('./backend/models/datacom-knowledge-snapshot').buildPagesSnapshot('default');
            files.set('datacom-protocol-expert/index.html',datacom.html);for(const [name,content] of datacom.files)files.set('datacom-protocol-expert/'+name,content);
            await require('./backend/models/snapshot-portal').buildPortal(checkout,[{slug:'demo-tool',name:'已发布工具',href:'./demo-tool/index.html'},{slug:'datacom-protocol-expert',name:'数通协议专家',href:'./datacom-protocol-expert/index.html'}],files);
            await require('./backend/models/app-db').closeDatabase();await require('./backend/models/platform-db').closeDatabase();await require('./backend/models/tenant-sqlite-pool').closeAll();
        })().catch(e=>{console.error(e);process.exit(1)});
    `], { cwd: ROOT, env: { ...process.env, PORTAL_TEST_DIR: temp, TOOLS_DATA_DIR: path.join(temp, 'data'), TOOLS_REPORT_DATA_DIR: path.join(temp, 'reports'), INITIAL_ADMIN_USERNAME: 'portal-admin', INITIAL_ADMIN_PASSWORD: 'Portal-password-2026!' } });
    const workerPath = path.join(temp, 'site/tp-static-sw.js');
    const newWorker = fs.readFileSync(workerPath, 'utf8');
    // 模拟已经安装的旧版 worker：能读普通密文，但还不认识 parts 分片。
    fs.writeFileSync(workerPath, newWorker.replace('file.parts || [file]', '[file]').replace('Snapshot verification failed', 'LEGACY verification failed'));
    const web = express();
    web.use('/project', express.static(path.join(temp, 'site')));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/project/`;
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) failures.push(message.slice(0, 300)); });
    await win.loadURL(base);
    await until(() => !!document.getElementById('loginBtn'));
    assert.equal(new URL(win.webContents.getURL()).pathname, '/project/login.html');
    await evaluate(() => { document.getElementById('username').value = 'portal-admin'; document.getElementById('password').value = 'wrong'; document.getElementById('loginBtn').click(); });
    await until(() => !!document.getElementById('error-msg').textContent);
    await until(() => !document.getElementById('loginBtn').disabled);
    await evaluate(() => { document.getElementById('password').value = 'Portal-password-2026!'; document.getElementById('loginBtn').click(); });
    await until(() => !!document.getElementById('toolsGrid'), 500);
    await until(() => document.querySelectorAll('[data-custom-tool-card]').length === 3);
    await until(() => !!document.querySelector('#nrvStack'));
    await until(() => document.querySelector('#nav-resource-version-display')?.textContent.includes('在线测试版'));
    assert.equal(await evaluate(() => document.querySelector('#nav-resource-version-display').textContent), `v${require('../package.json').version} · 在线测试版`);
    await until(() => !!document.querySelector('.nrv-banner[data-promo="link:portal-link"]'));
    await evaluate(() => document.querySelector('.nrv-banner[data-promo="link:netcare"]').click());
    await until(() => !!document.querySelector('.nrv-link-image')?.naturalWidth);
    assert.ok(await evaluate(() => document.querySelector('.nrv-link-image').src.includes('/project/tp-static/frontend/assets/promotions/')), 'local cover resolves within a Pages project path');
    await evaluate(() => document.querySelector('.nrv-banner[data-promo="link:portal-link"]').click());
    await until(() => document.querySelector('.nrv-link-image')?.src.startsWith('data:image/png;') && !!document.querySelector('.nrv-link-image').naturalWidth);
    const opened = await evaluate(() => {
        const originalOpen = window.open, calls = [];
        window.open = () => ({ location: { href: 'about:blank', replace: url => calls.push(url) }, focus() {} });
        try { document.querySelector('#nrvFloat .nrv-link').click(); } finally { window.open = originalOpen; }
        return calls;
    });
    assert.deepEqual(opened, ['https://promotion.example/landing']);
    await evaluate(async () => { const res = await fetch('/api/platform-promotions/clicks', { method: 'POST', body: '{}' }); return res.json(); });
    assert.equal(await evaluate(() => !!document.getElementById('staticPermissionNotice')), false, 'opening promotions does not report a read-only permission error');
    assert.equal(await evaluate(async () => (await fetch('/api/platform-promotions', { method: 'PUT', body: '{}' })).status), 403, 'promotion config stays read-only');
    await evaluate(() => document.getElementById('staticPermissionNotice')?.remove());
    await evaluate(() => document.querySelector('.nrv-banner[data-video="rfc"]').click());
    assert.equal(await evaluate(() => !!document.getElementById('homeSidebar') && !!document.getElementById('statsBar') && !!document.getElementById('homePromotions')), true);
    assert.equal(await evaluate(() => document.querySelector('#dcDatacomPromo .dc-feature-new')?.textContent), 'NEW');
    await evaluate(() => document.getElementById('builtinToolsCompareBtn').click());
    await until(() => document.body.textContent.includes('无权限，请联系管理员添加'));
    assert.equal(await evaluate(() => !!document.getElementById('builtinToolsSyncModal')), false, 'read-only exports cannot offer a forced tool replacement');
    if (process.env.PORTAL_CHAT_SCREENSHOT) {
        await new Promise(resolve => setTimeout(resolve, 3200));
        fs.writeFileSync(process.env.PORTAL_CHAT_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
        win.setSize(390, 844);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.equal(await evaluate(() => { const a = document.getElementById('dcDatacomPromo'); return a.scrollWidth <= a.clientWidth + 1 && a.getBoundingClientRect().right <= innerWidth; }), true);
        assert.equal(await evaluate(() => { const a = document.getElementById('dcDatacomPromo'), r = a.getBoundingClientRect(); return a.contains(document.elementFromPoint(r.right - 10, r.top + r.height / 2)); }), true, 'mobile video widget must not cover the promotion link');
        fs.writeFileSync(process.env.PORTAL_CHAT_SCREENSHOT.replace('.png', '-mobile.png'), (await win.webContents.capturePage()).toPNG());
        await evaluate(() => document.body.classList.add('dc-chatting'));
        assert.equal(await evaluate(() => document.getElementById('dcDatacomPromo').getBoundingClientRect().bottom <= document.querySelector('.dc-chat-head').getBoundingClientRect().top + 1), true, 'the link also fits above the active conversation toolbar');
        await evaluate(() => document.body.classList.remove('dc-chatting'));
        win.setSize(1440, 1000);
    }
    await evaluate(() => document.getElementById('dcDatacomPromo').click());
    await until(() => !!document.querySelector('.dk-hero'));
    assert.equal(new URL(win.webContents.getURL()).pathname, '/project/datacom-protocol-expert/index.html');
    await win.loadURL(base + 'index.html');
    await until(() => document.querySelectorAll('[data-custom-tool-card]').length === 3);
    await evaluate(() => window.HomeMode.set('tools'));
    await evaluate(() => document.querySelector('[data-tool-slug="private-tool"]').click());
    await until(() => document.body.textContent.includes('无权限，请联系管理员添加'));
    assert.ok(['/project/', '/project/index.html'].includes(new URL(win.webContents.getURL()).pathname));
    await evaluate(() => window.ToolsI18n.setLanguage('en-US'));
    await until(() => document.querySelector('#nav-resource-version-display')?.textContent.includes('Online test version'));
    await until(() => document.querySelector('#dcDatacomPromo strong')?.textContent === 'Datacom Protocol Expert');
    await until(() => document.querySelector('[data-tool-slug="demo-tool"]')?.textContent.includes('Published tool'));
    const video = await evaluate(() => [...document.querySelectorAll('#nrvStack video source')].map(v => v.src).filter(Boolean));
    assert.equal(await evaluate(() => [...document.querySelectorAll('#nrvStack video, #nrvDialog video')].every(v => !v.hasAttribute('src') && v.querySelector('source')?.type === 'video/mp4')), true);
    assert.ok(video.every(url => url.startsWith('https://github.com/fanxiaolongx-max/Dragon-Platform-Media/')));
    if (process.env.PORTAL_REMOTE_VIDEOS === '1') {
        for (const lang of ['zh-CN', 'en-US']) {
            await evaluate(lang => window.ToolsI18n.setLanguage(lang), lang);
            for (const key of ['rfc', 'incentive', 'eos', 'guide']) {
                await evaluate(key => document.querySelector(`.nrv-banner[data-video="${key}"]`)?.click(), key);
                await until(() => document.querySelector('#nrvFloat video').readyState >= 1);
                await evaluate(async () => { const v = document.querySelector('#nrvFloat video'); v.muted = true; await v.play(); });
                await until(() => document.querySelector('#nrvFloat video').currentTime > 0.15);
                await evaluate(() => document.querySelector('#nrvFloat video').click());
                await until(() => document.querySelector('#nrvDialog[open] video')?.readyState >= 1);
                await evaluate(async () => { const v = document.querySelector('#nrvDialog video'); v.muted = true; await v.play(); });
                await until(() => document.querySelector('#nrvDialog video').currentTime > 0.15);
                const sources = await evaluate(() => [document.querySelector('#nrvFloat video').currentSrc, document.querySelector('#nrvDialog video').currentSrc]);
                assert.ok(sources.every(url => url.includes('Dragon-Platform-Media/releases/download/')));
                if (lang === 'en-US') assert.ok(sources.every(url => /-en(?:-hd)?\.mp4/.test(url)));
                await evaluate(() => document.querySelector('.nrv-dialog-close').click());
                console.log(`${lang} ${key}: mini and HD real playback passed`);
            }
        }
        await win.loadURL(base + 'project-evolution.html');
        await until(() => document.querySelector('#evolutionVideo')?.readyState >= 1);
        await evaluate(async () => { const v = document.querySelector('#evolutionVideo'); v.muted = true; await v.play(); });
        await until(() => document.querySelector('#evolutionVideo').currentTime > 0.15);
        console.log('project evolution: real playback passed');
        await win.loadURL(base + 'index.html#tools');
        await until(() => !!document.querySelector('[data-tool-slug="demo-tool"]'));
    }
    // 发布新版 worker，延迟安装以捕获“注册已返回，但新版尚未激活”的升级竞态。
    fs.writeFileSync(workerPath, newWorker + '\nself.addEventListener("install", e => e.waitUntil(new Promise(r => setTimeout(r, 400))));');
    await win.loadURL(base + 'index.html');
    await until(() => !!document.getElementById('toolsGrid'));
    assert.equal(await evaluate(async () => { const r=await fetch('./demo-tool/data/chunked.json');if(!r.ok)throw Error('Upgrade response '+r.status+': '+await r.text());return (await r.json()).value.length; }), 3 * 1024 * 1024, 'an already signed-in client waits for the updated multipart worker');
    await evaluate(() => window.HomeMode.set('tools'));
    await until(() => Number(getComputedStyle(document.querySelector('.tool-card')).opacity) > 0.9);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (process.env.PORTAL_SCREENSHOT) fs.writeFileSync(process.env.PORTAL_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
    const request = await evaluate(async () => (await fetch('/api/custom-tools', { method: 'POST', body: '{}' })).status);
    assert.equal(request, 403);
    await evaluate(() => document.querySelector('[data-tool-slug="demo-tool"]').click());
    await until(() => !!document.getElementById('publishedDemo'));
    assert.equal(new URL(win.webContents.getURL()).pathname, '/project/demo-tool/index.html');
    assert.equal(await evaluate(async () => (await (await fetch('./data/chunked.json')).json()).value.length), 3 * 1024 * 1024, 'multipart payload is reassembled and decrypted completely');
    await win.loadURL(base + 'datacom-protocol-expert/index.html');
    await until(() => !!document.querySelector('.dk-hero'));
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('ServiceWorker.enable');
    await win.webContents.debugger.sendCommand('ServiceWorker.stopAllWorkers');
    win.webContents.debugger.detach();
    const recovered = await evaluate(async () => { const res = await fetch('./data/knowledge.json'); return res.ok && (await res.json()).articles.length > 0; });
    assert.equal(recovered, true, 'tool resource decryption recovers after the service worker is stopped');
    await win.loadURL(base + 'index.html');
    await until(() => !!document.getElementById('toolsGrid'));
    await evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }); });
    await until(() => !!document.getElementById('loginBtn'));
    await win.loadURL(base + 'demo-tool/index.html');
    await until(() => !!document.getElementById('loginBtn'));
    assert.equal(await evaluate(() => document.getElementById('publishedDemo') === null), true);
    console.log('original login/home, wrong password, shared tool access, direct-link protection, logout, bilingual cards, permissions and remote videos passed');
}).then(() => { process.exitCode = 0; }).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (win) win.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode);
});
