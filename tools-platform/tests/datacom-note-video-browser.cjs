// node_modules/.bin/electron tests/datacom-note-video-browser.cjs [--remote]
// 默认以不同端口模拟无 CORS 响应头的媒体站；--remote 另验证真实 GitHub Release。
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const express = require('express');
const ROOT = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-video-browser-'));
const remote = process.argv.includes('--remote');
const release = 'https://github.com/fanxiaolongx-max/Dragon-Platform-Media/releases/download/';
app.setPath('userData', path.join(temp, 'profile'));
let win;
const servers = [], requests = [], responses = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
    for (let i = 0; i < 400; i++) {
        if (await evaluate(fn)) return;
        await wait(50);
    }
    const state = await evaluate(() => [...document.querySelectorAll('video')].map(v => ({
        src: v.currentSrc, ready: v.readyState, error: v.error?.message, duration: v.duration
    })));
    throw new Error(`Timed out: ${fn}\n${JSON.stringify(state)}`);
}
async function listen(web) {
    const server = await new Promise(resolve => { const server = web.listen(0, '127.0.0.1', () => resolve(server)); });
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
}

app.whenReady().then(async () => {
    execFileSync('node', ['-e', `
        const fs=require('fs'),path=require('path'),snapshot=require('./backend/models/datacom-knowledge-snapshot');
        (async()=>{
            const output=await snapshot.buildPagesSnapshot('default'),root=path.join(process.env.DATACOM_TEST_DIR,'pages');
            fs.mkdirSync(root);fs.writeFileSync(path.join(root,'index.html'),output.html);
            for(const [name,content] of output.files){const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
            fs.writeFileSync(path.join(process.env.DATACOM_TEST_DIR,'single.html'),await snapshot.buildSnapshot('default'));
            await require('./backend/models/tenant-sqlite-pool').closeAll();await require('./backend/models/app-db').closeDatabase();
        })().catch(e=>{console.error(e);process.exit(1)});
    `], { cwd: ROOT, env: { ...process.env, DATACOM_TEST_DIR: temp, TOOLS_DATA_DIR: path.join(temp, 'data'), TOOLS_REPORT_DATA_DIR: path.join(temp, 'reports') } });
    const mediaRoot = path.join(ROOT, 'frontend/assets/promotions/datacom');
    const media = express();
    media.use(express.static(mediaRoot));
    const mediaBase = await listen(media);
    const web = express();
    web.use('/project/datacom-protocol-expert', express.static(path.join(temp, 'pages')));
    web.use('/custom-tools/datacom-protocol-expert', express.static(path.join(ROOT, 'backend/builtin-tools/datacom-protocol-expert')));
    web.use('/assets/promotions/datacom', express.static(mediaRoot));
    const data = JSON.parse(fs.readFileSync(path.join(temp, 'pages/data/knowledge.json')));
    web.get('/api/datacom-knowledge', (_req, res) => res.json({ ...data, canWrite: false, tenantId: 'default', username: 'test' }));
    web.get('/api/datacom-knowledge/articles/:id', (req, res) => res.json({ article: data.articles.find(a => a.id === req.params.id) }));
    web.get('/api/datacom-knowledge/annotations', (_req, res) => res.json({ annotations: [] }));
    const base = await listen(web);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        requests.push(details.url);
        if (!remote && details.url.startsWith(release)) {
            return callback({ redirectURL: `${mediaBase}/${new URL(details.url).pathname.split('/').pop()}` });
        }
        callback({});
    });
    session.defaultSession.webRequest.onCompleted(details => {
        if (details.resourceType === 'media') responses.push({ url: details.url, status: details.statusCode });
    });
    win = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    for (const mode of ['pages', 'single', 'platform']) {
        const start = requests.length;
        if (mode === 'single') await win.loadFile(path.join(temp, 'single.html'));
        else await win.loadURL(base + (mode === 'pages' ? '/project/datacom-protocol-expert/index.html' : '/custom-tools/datacom-protocol-expert/index.html'));
        await until(() => !!document.querySelector('.dk-hero'));
        await evaluate(() => { localStorage.setItem('dk_video_autoplay', 'off'); location.hash = '#/a/ospf-fsm'; });
        await until(() => document.querySelector('#articleVideo video')?.readyState >= 1);
        const source = await evaluate(() => {
            const v = document.querySelector('#articleVideo video');
            return { src: v.src, poster: v.poster, crossOrigin: v.getAttribute('crossorigin'), duration: v.duration };
        });
        assert.equal(source.crossOrigin, null, 'plain video playback must not require CORS permission');
        assert.ok(source.duration > 100);
        assert.ok(source.src.startsWith(mode === 'platform' ? base + '/assets/promotions/datacom/' : release));
        assert.ok(source.poster.startsWith(mode === 'single' ? 'data:image/jpeg;base64,' : base + '/'));
        await evaluate(async () => { const v = document.querySelector('#articleVideo video'); v.muted = true; await v.play(); });
        await until(() => document.querySelector('#articleVideo video').currentTime > 0.15);
        await evaluate(() => { const v = document.querySelector('#articleVideo video'); v.pause(); v.currentTime = 20; });
        await until(() => { const v = document.querySelector('#articleVideo video'); return !v.seeking && v.currentTime >= 20 && v.readyState >= 2; });
        await evaluate(() => document.querySelector('.dk-video-hd').click());
        await until(() => document.querySelector('.dk-video-dialog video')?.readyState >= 1);
        const hdSource = await evaluate(() => document.querySelector('.dk-video-dialog video').src);
        assert.ok(hdSource.includes('ospf-fsm-hd.mp4'));
        assert.ok(hdSource.startsWith(mode === 'platform' ? base + '/assets/promotions/datacom/' : release));
        await evaluate(async () => { const v = document.querySelector('.dk-video-dialog video'); v.muted = true; await v.play(); });
        await until(() => { const v = document.querySelector('.dk-video-dialog video'); return !v.paused && v.currentTime > 20.15; });
        await evaluate(() => document.querySelector('.dk-video-dialog header button').click());
        const outgoing = requests.slice(start);
        if (mode === 'platform') assert.equal(outgoing.some(url => url.startsWith(release)), false);
        else assert.equal(outgoing.some(url => url.includes('/api/') || url.includes('/assets/promotions/datacom/')), false, JSON.stringify(outgoing));
        await evaluate(() => { location.hash = '#/a/ospf-router-id'; });
        await until(() => !!document.querySelector('#articleVideo[hidden]'));
        console.log(`${mode}: metadata, inline playback, seeking, HD playback, poster and original platform URL selection passed`);
    }
    console.log(`Media response statuses (${remote ? 'real GitHub Release' : 'cross-origin fixture without CORS headers'}):`, [...new Set(responses.map(r => r.status))]);
}).then(() => { process.exitCode = 0; }).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (win) win.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode);
});
