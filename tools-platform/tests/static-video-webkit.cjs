// node tests/static-video-webkit.cjs
// macOS native WebKit + real GitHub Release responses (including octet-stream redirects).
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const express = require('express');
if (process.platform !== 'darwin') throw Error('This regression runner requires macOS WebKit');
const ROOT = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'static-video-webkit-'));
let server;
const suite = async function () {
    const report = value => window.webkit.messageHandlers.result.postMessage(value);
    const check = (value, message) => { if (!value) throw Error(message); };
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function until(fn, message) {
        for (let n = 0; n < 500; n++) { if (fn()) return; await wait(50); }
        throw Error(message);
    }
    const frame = document.createElement('iframe'); frame.width = 1280; frame.height = 850; document.body.append(frame);
    async function open(url) {
        await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = reject; frame.src = url; });
        return frame.contentWindow;
    }
    async function play(video, name, seek = false) {
        check(!video.hasAttribute('src') && video.querySelector('source')?.type === 'video/mp4', name + ': missing typed source');
        check(video.getAttribute('crossorigin') === null, name + ': unexpected CORS requirement');
        video.muted = true;
        await video.play();
        await until(() => video.currentTime > 0.15 && video.readyState >= 2, name + ': playback did not advance');
        check(video.duration > 60, name + ': invalid metadata');
        if (seek) { video.pause(); video.currentTime = 20; await until(() => !video.seeking && video.readyState >= 2, name + ': seek failed'); await video.play(); await until(() => video.currentTime > 20.15, name + ': seek playback failed'); }
        video.pause(); report(name + ': metadata, playback' + (seek ? ' and seek' : '') + ' passed');
    }
    try {
        let win = await open('/site/project-evolution.html');
        await play(win.document.querySelector('#evolutionVideo'), 'project evolution', true);
        win = await open('/home.html');
        await until(() => !!win.document.querySelector('#nrvStack'), 'home not initialized');
        for (const lang of ['zh-CN', 'en-US']) {
            win.ToolsI18n.setLanguage(lang);
            for (const key of ['rfc', 'incentive', 'eos', 'guide']) {
                win.document.querySelector(`.nrv-banner[data-video="${key}"]`)?.click();
                let video = win.document.querySelector('#nrvFloat video');
                await play(video, lang + ' ' + key + ' mini');
                if (lang === 'en-US') check(video.currentSrc.includes('-en.mp4'), 'English mini source');
                video.click();
                await until(() => !!win.document.querySelector('#nrvDialog[open]'), 'HD did not open');
                video = win.document.querySelector('#nrvDialog video');
                await play(video, lang + ' ' + key + ' HD');
                if (lang === 'en-US') check(video.currentSrc.includes('-en-hd.mp4'), 'English HD source');
                win.document.querySelector('.nrv-dialog-close').click();
            }
        }
        // Source errors do not bubble. Verify capture listeners preserve retry UI after this change.
        const broken = win.document.querySelector('#nrvFloat video source');
        broken.src = '/missing-video.mp4'; const mini = broken.parentElement; mini.load();
        await until(() => !win.document.querySelector('#nrvFloat .nrv-load-status button').hidden, 'source error did not show retry');
        report('home typed-source errors retain retry UI');
        win = await open('/datacom/index.html');
        await until(() => !!win.document.querySelector('.dk-hero'), 'datacom not initialized');
        win.localStorage.setItem('dk_video_autoplay', 'off');
        for (const id of ['ospf-fsm', 'ospf-router-id', 'ospf-router-types']) {
            win.location.hash = '#/a/' + id;
            await until(() => win.document.querySelector('#articleVideo video source')?.src.includes('/' + id + '.mp4'), 'note source missing: ' + id);
            await play(win.document.querySelector('#articleVideo video'), id + ' mini', true);
            win.document.querySelector('.dk-video-hd').click();
            await play(win.document.querySelector('.dk-video-dialog video'), id + ' HD');
            win.document.querySelector('.dk-video-dialog header button').click();
        }
        report('TEST_DONE');
    } catch (error) { report('TEST_FAILED: ' + error.message); }
};
(async () => {
    execFileSync(process.execPath, ['-e', `
        const fs=require('fs'),path=require('path');
        (async()=>{
            const root=process.env.WEBKIT_TEST_DIR;
            const site=path.join(root,'site');fs.mkdirSync(site);
            await require('./backend/models/snapshot-portal').buildPortal(site,[],new Map());
            const output=await require('./backend/models/datacom-knowledge-snapshot').buildPagesSnapshot('default');
            const files=new Map([['index.html',output.html],...output.files]);
            for(const [name,bytes] of files){const file=path.join(root,'datacom',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
            await require('./backend/models/app-db').closeDatabase();await require('./backend/models/platform-db').closeDatabase();await require('./backend/models/tenant-sqlite-pool').closeAll();
        })().catch(e=>{console.error(e);process.exit(1)});
    `], { cwd: ROOT, env: { ...process.env, WEBKIT_TEST_DIR: temp, TOOLS_DATA_DIR: path.join(temp, 'data'), TOOLS_REPORT_DATA_DIR: path.join(temp, 'reports'), INITIAL_ADMIN_USERNAME: 'webkit-fixture', INITIAL_ADMIN_PASSWORD: 'Webkit-fixture-2026!' } });
    const web = express();
    web.get('/', (_req, res) => res.type('html').send('<!doctype html><body><script>(' + suite.toString() + ')();</script>'));
    web.get('/home.html', (_req, res) => res.type('html').send('<!doctype html><body><script src="/site/tp-static/frontend/js/shared/i18n.js"></script><script src="/site/tp-static/frontend/js/home/promo-video.js"></script><script src="/site/tp-static/frontend/js/home/promo-video-status.js"></script>'));
    web.use(express.static(temp));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    const child = spawn('xcrun', ['swift', path.join(__dirname, 'helpers/webkit-video.swift'), `http://127.0.0.1:${server.address().port}/`], { stdio: 'inherit' });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('WebKit regression failed: ' + code))); });
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(temp, { recursive: true, force: true });
});
