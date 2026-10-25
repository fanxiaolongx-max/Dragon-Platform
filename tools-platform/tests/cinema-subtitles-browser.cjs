// node_modules/.bin/electron tests/cinema-subtitles-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cinema-subtitle-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
const frontend = path.join(__dirname, '../frontend');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let win, server;
const errors = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
async function until(fn, description) {
    for (let attempt = 0; attempt < 160; attempt++) {
        if (await evaluate(fn)) return;
        await wait(25);
    }
    throw new Error('Timed out: ' + description);
}
app.whenReady().then(async () => {
    const generated = spawnSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=2[r];color=c=blue:s=320x180:d=3[b];[r][b]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(temp, 'fixture.mp4')]);
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const fixture = id => ({ id, title: id, src: '/fixture.mp4', category: 'film', duration: 5, fileName: `${id}.mp4`, poster: '', description: 'Subtitle fixture' });
    const tracks = [
        { language: 'bilingual', vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n你好\nHello\n' },
        { language: 'zh', vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n你好\n' },
        { language: 'en', vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\nHello\n' }
    ];
    const web = express();
    web.get('/cinema', (_, res) => res.sendFile(path.join(frontend, 'pages/cinema.html')));
    web.get('/fixture.mp4', (_, res) => res.sendFile(path.join(temp, 'fixture.mp4')));
    web.get('/api/public/videos', (_, res) => res.json({ success: true, data: [fixture('film-a'), fixture('film-b'), fixture('slow'), fixture('empty')], categories: [] }));
    web.get('/api/media/public/subtitles/:id', async (req, res) => {
        if (req.params.id === 'slow') await wait(500);
        res.json({ success: true, tracks: req.params.id === 'empty' ? [] : tracks });
    });
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('404')) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/cinema`);
    await until(() => document.querySelector('#mainVideo track')?.readyState === 2 && document.querySelector('#mainVideo').readyState >= 2, 'native subtitle load');
    assert.deepEqual(await evaluate(() => ({ mode: video.textTracks[0].mode, cues: video.textTracks[0].cues.length, text: video.textTracks[0].cues[0].text })), { mode: 'showing', cues: 1, text: '你好\nHello' });
    assert.equal(await evaluate(() => Array.from(video.textTracks).filter(track => track.mode === 'showing').length), 1);
    const lightPixel = () => {
        const pixel = document.querySelector('#playerAmbientGlow').getContext('2d').getImageData(24, 13, 1, 1).data;
        return Array.from(pixel).slice(0, 3);
    };
    assert.equal(await evaluate(() => document.querySelector('#ambientToggleBtn').getAttribute('aria-pressed')), 'true');
    await evaluate(async () => { await video.play(); });
    await until(() => document.querySelector('#playerAmbientGlow').getContext('2d').getImageData(24, 13, 1, 1).data[0] > 200, 'red scene backlight');
    await evaluate(() => video.pause());
    const red = await evaluate(lightPixel);
    assert.ok(red[0] > 200 && red[2] < 30, JSON.stringify(red));
    await evaluate(() => { videoBox.scrollIntoView({ block: 'center', behavior: 'instant' }); videoBox.classList.add('user-active'); });
    await wait(550);
    fs.writeFileSync('/tmp/cinema-ambient-on.png', (await win.webContents.capturePage()).toPNG());
    await evaluate(() => toggleAmbientLight());
    assert.equal(await evaluate(() => cinemaAmbientLight.timer), null, 'off stops frame updates');
    assert.equal(await evaluate(() => document.querySelector('#ambientToggleBtn').getAttribute('aria-pressed')), 'false');
    await wait(550);
    fs.writeFileSync('/tmp/cinema-ambient-off.png', (await win.webContents.capturePage()).toPNG());
    await evaluate(() => toggleAmbientLight());
    await evaluate(() => { video.currentTime = 3; });
    await until(() => video.currentTime >= 3 && !video.seeking, 'seek to blue scene');
    const blue = await evaluate(lightPixel);
    assert.ok(blue[2] > 200 && blue[0] < 30, JSON.stringify(blue));
    assert.equal(await evaluate(() => cinemaAmbientLight.timer), null, 'paused scene draws once without polling');
    await evaluate(async () => { await video.play(); });
    assert.equal(await evaluate(() => cinemaAmbientLight.timer !== null), true, 'playing scene schedules updates');
    await evaluate(() => { video.pause(); toggleAmbientLight(); });
    assert.equal(await evaluate(() => video.dataset.subtitleSize), 'small');
    await evaluate(() => { const select = document.querySelector('#subtitleSizeSelect'); select.value = 'large'; select.dispatchEvent(new Event('change')); });
    assert.equal(await evaluate(() => video.dataset.subtitleSize), 'large');
    assert.equal(await evaluate(() => localStorage.getItem('cinema_subtitle_size_v1')), 'large');
    await evaluate(() => { const select = document.querySelector('#subtitleSelect'); select.value = 'en'; select.dispatchEvent(new Event('change')); });
    await until(() => Array.from(video.textTracks).some(track => track.language === 'en' && track.mode === 'showing'), 'English mode');
    await evaluate(() => { const select = document.querySelector('#subtitleSelect'); select.value = 'off'; select.dispatchEvent(new Event('change')); selectVideo('film-b', false); });
    await until(() => document.querySelectorAll('#mainVideo track').length === 3 && document.querySelector('#mainVideo track')?.readyState === 2, 'next film subtitles');
    assert.equal(await evaluate(() => Array.from(video.textTracks).filter(track => track.mode === 'showing').length), 0, 'off persists across films');
    assert.equal(await evaluate(() => document.querySelector('#subtitleSizeSelect').value), 'large', 'size persists across films');
    await evaluate(() => { selectVideo('slow', false); selectVideo('empty', false); });
    await wait(650);
    assert.equal(await evaluate(() => document.querySelectorAll('#mainVideo track').length), 0, 'old result cannot attach to next film');
    assert.match(await evaluate(() => document.querySelector('#subtitleSelect option').textContent), /暂无字幕/);
    await evaluate(() => { localStorage.setItem('tools_lang', 'en'); window.dispatchEvent(new Event('tools:languagechange')); });
    assert.equal(await evaluate(() => document.querySelector('#subtitleSelect').getAttribute('aria-label')), 'Subtitles');
    assert.equal(await evaluate(() => document.querySelector('#subtitleSizeSelect').getAttribute('aria-label')), 'Subtitle size');
    await evaluate(() => { const select = document.querySelector('#subtitleSelect'); select.value = 'auto'; select.dispatchEvent(new Event('change')); selectVideo('film-a', false); });
    await until(() => video.textTracks[0]?.mode === 'showing' && video.textTracks[0]?.cues?.length, 'subtitle restore');
    await evaluate(() => { videoBox.scrollIntoView({ block: 'center', behavior: 'instant' }); videoBox.classList.add('user-active'); });
    fs.writeFileSync('/tmp/cinema-subtitles-desktop.png', (await win.webContents.capturePage()).toPNG());
    win.setSize(390, 844);
    await evaluate(() => { videoBox.scrollIntoView({ block: 'center', behavior: 'instant' }); videoBox.classList.add('user-active'); });
    await wait(150);
    const layout = await evaluate(() => {
        const select = document.querySelector('#subtitleSelect');
        const row = document.querySelector('.controls-row');
        const box = select.getBoundingClientRect();
        return { overflow: row.scrollWidth - row.clientWidth, visible: box.width > 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight };
    });
    assert.equal(layout.visible, true);
    assert.ok(layout.overflow <= 1, JSON.stringify(layout));
    const image = await win.webContents.capturePage();
    fs.writeFileSync('/tmp/cinema-subtitles-mobile.png', image.toPNG());
    await win.reload();
    await until(() => document.querySelector('#mainVideo track')?.readyState === 2, 'reload subtitles');
    assert.equal(await evaluate(() => document.querySelector('#ambientToggleBtn').getAttribute('aria-pressed')), 'false', 'ambient preference persists after reload');
    assert.equal(await evaluate(() => video.dataset.subtitleSize), 'large', 'size persists after reload');
    await evaluate(() => { const select = document.querySelector('#subtitleSizeSelect'); select.value = 'small'; select.dispatchEvent(new Event('change')); });
    assert.equal(await evaluate(() => video.dataset.subtitleSize), 'small');
    // Simulate media errors at the same event boundary used by real hls.js.
    await evaluate(() => {
        window.testHlsInstances = [];
        class TestHls {
            static Events = { ERROR: 'error' };
            static ErrorTypes = { MEDIA_ERROR: 'mediaError' };
            static isSupported() { return true; }
            constructor() { this.recoveries = 0; this.destroyed = false; window.testHlsInstances.push(this); }
            loadSource() {}
            attachMedia(element) { element.src = '/fixture.mp4'; }
            on(_event, handler) { this.handler = handler; }
            recoverMediaError() { this.recoveries++; }
            destroy() { this.destroyed = true; }
            fail() { this.handler('error', { fatal: true, type: 'mediaError' }); }
        }
        window.Hls = TestHls;
        for (const id of ['hls-one', 'hls-two']) allVideos.push({ id, title: id, src: '/fixture.mp4', hlsSrc: '/fixture.m3u8', needsTranscode: true, category: 'film' });
        selectVideo('hls-one', false);
    });
    await until(() => video.readyState >= 2, 'HLS media fixture');
    await evaluate(() => { video.pause(); video.currentTime = 2; window.testHlsInstances[0].fail(); });
    assert.deepEqual(await evaluate(() => ({ recoveries: window.testHlsInstances[0].recoveries, destroyed: window.testHlsInstances[0].destroyed, pitch: video.preservesPitch })), { recoveries: 1, destroyed: false, pitch: true });
    await evaluate(() => window.testHlsInstances[0].fail());
    await until(() => video.readyState >= 2 && Math.abs(video.currentTime - 2) < 0.1, 'fallback preserves playback position');
    assert.equal(await evaluate(() => window.testHlsInstances[0].destroyed), true);
    await evaluate(() => { selectVideo('hls-two', false); window.testHlsInstances[0].fail(); });
    assert.equal(await evaluate(() => window.testHlsInstances[1].destroyed), false, 'stale decoder error must not destroy the next film');
    assert.deepEqual(errors, []);
    console.log('PASS: native VTT, bilingual default, language/off/size persistence, stale request, unavailable state, English labels, mobile layout, bounded audio recovery, fallback position, stale decoder event, ambient frame colors, ambient off/paused scheduling, ambient preference');
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); }).finally(() => {
    if (server) server.close();
    if (win && !win.isDestroyed()) win.destroy();
    fs.rmSync(temp, { recursive: true, force: true });
});
