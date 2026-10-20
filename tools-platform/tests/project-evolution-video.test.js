const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { createFrontendHtmlSender, createFrontendHtmlMiddleware } = require('../backend/models/asset-versioning');

const root = path.resolve(__dirname, '..');
const frontend = path.join(root, 'frontend');
const serverSource = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
// Exercise the actual HTML entry guard without opening business databases.
const guardSource = serverSource.slice(serverSource.indexOf('const PUBLIC_HTML_PATHS'), serverSource.indexOf('\napp.use((req, res, next) => {', serverSource.indexOf('const PUBLIC_HTML_PATHS')));
const shouldProtectHtmlEntry = vm.runInNewContext(`${guardSource}\nshouldProtectHtmlEntry;`, { path });

test('login opens the evolution player in a separate window without requesting the MP4', () => {
    const login = fs.readFileSync(path.join(frontend, 'pages/login.html'), 'utf8');
    const link = login.match(/<a class="login-evolution-link"[^>]+>/)?.[0];
    assert.ok(link);
    assert.match(link, /href="\/project-evolution"/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
    assert.ok(login.indexOf('class="login-evolution-link"') > login.indexOf('id="loginPanel"'));
    assert.ok(login.indexOf('class="login-evolution-link"') > login.indexOf('class="footer-links"'));
    assert.doesNotMatch(login, /project-evolution-galaxy-hd\.mp4|<video\b/);
    const dictionary = login.match(/const\s+LOGIN_I18N\s*=\s*(\{[\s\S]*?\n\s*\});/)[1];
    const translations = vm.runInNewContext(`(${dictionary})`);
    for (const language of ['zh-CN', 'en-US']) {
        for (const key of ['login.evolutionTitle', 'login.evolutionAria']) assert.ok(translations[language][key]);
    }
});

test('anonymous users can open evolution player aliases while internal pages remain protected', async t => {
    const app = express();
    app.use((req, res, next) => shouldProtectHtmlEntry(req) ? res.status(401).end() : next());
    app.use(createFrontendHtmlMiddleware(frontend));
    const send = createFrontendHtmlSender(frontend);
    const registered = serverSource.match(/app\.get\(\['\/project-evolution', '\/project-evolution\.html'\], \(req, res\) => \{\s*sendFrontendHtml\(res, 'pages\/project-evolution\.html'\);\s*\}\);/);
    assert.ok(registered, 'Friendly aliases must serve the public player');
    app.get(['/project-evolution', '/project-evolution.html'], (_req, res) => send(res, 'pages/project-evolution.html'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const url of ['/project-evolution', '/project-evolution.html', '/pages/project-evolution.html']) {
        const response = await fetch(base + url);
        assert.equal(response.status, 200, url);
        const html = await response.text();
        assert.match(html, /id="evolutionVideo"/);
        assert.match(html, /project-evolution\.js\?v=[0-9a-f]+/);
    }
    for (const url of ['/', '/pages/report.html', '/project-evolution/private']) assert.equal((await fetch(base + url)).status, 401, url);
});

test('player reports blocked autoplay and allows failed downloads to be retried', async () => {
    const handlers = {};
    function element() { return { hidden: true, textContent: '', addEventListener: (name, action) => { handlers[name] = action; } }; }
    const videoEvents = {};
    const video = { ...element(), error: null, loads: 0, plays: 0,
        append(source) { this.source = source; },
        addEventListener: (name, action) => { videoEvents[name] = action; },
        load() { this.loads++; },
        play() { this.plays++; return Promise.reject({ name: 'NotAllowedError' }); }
    };
    const status = element(), label = element(), action = element();
    let retry;
    action.addEventListener = (_name, callback) => { retry = callback; };
    const elements = { evolutionVideo: video, evolutionStatus: status, evolutionStatusText: label, evolutionAction: action, evolutionLanguage: element() };
    const context = { document: { getElementById: id => elements[id], createElement: () => ({}) }, window: { addEventListener() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(frontend, 'js/project-evolution.js'), 'utf8'), context);
    await Promise.resolve();
    assert.equal(video.source.src, '/assets/promotions/project-evolution-galaxy-hd.mp4');
    assert.equal(video.source.type, 'video/mp4');
    assert.equal(video.src, undefined, 'A video src attribute overrides the typed source and breaks Safari Release playback');
    assert.equal(status.hidden, false);
    assert.equal(action.textContent, '播放');
    videoEvents.loadstart();
    videoEvents.waiting();
    videoEvents.canplay();
    assert.equal(action.hidden, false, 'Loading events must not hide the autoplay permission prompt');
    assert.equal(action.textContent, '播放');
    videoEvents.error();
    assert.equal(action.textContent, '重试');
    video.play = function () { this.plays++; return Promise.resolve(); };
    retry();
    assert.equal(video.loads, 2);
    videoEvents.playing();
    assert.equal(status.hidden, true);
});
