// Run: ./node_modules/.bin/electron tests/conversation-rail-sidebar-drag-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-rail-drag-'));
app.setPath('userData', path.join(temp, 'profile'));

let win, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);

async function runDragAndAssert(resizerRect, send) {
    await evaluate(`(() => {
        window.__dragSamples = [];
        const resizer = document.getElementById('homeSidebarResizer');
        const rail = document.querySelector('.conversation-rail');
        const preview = document.querySelector('.conversation-rail-preview');
        const thread = document.getElementById('dcThread');
        const record = kind => window.__dragSamples.push({
            kind,
            threadLeft: thread.getBoundingClientRect().left,
            railLeft: rail.getBoundingClientRect().left,
            railRight: rail.getBoundingClientRect().right,
            previewHidden: preview.hidden,
            previewLeft: preview.hidden ? null : preview.getBoundingClientRect().left
        });
        window.__onDragMove = () => {
            record('pointermove');
            requestAnimationFrame(() => record('raf'));
        };
        resizer.addEventListener('pointermove', window.__onDragMove);
        window.__dragRO = new ResizeObserver(() => record('resize'));
        window.__dragRO.observe(thread);
    })()`);

    const x = Math.round(resizerRect.x + resizerRect.width / 2);
    const y = Math.round(resizerRect.y + resizerRect.height / 2);
    await send({ type: 'mouseMoved', x, y });
    await send({ type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let dx = 12; dx <= 168; dx += 12) {
        await send({ type: 'mouseMoved', x: x + dx, y, button: 'left', buttons: 1 });
        await wait(10);
    }
    const midSamples = await evaluate(`(() => {
        const resizer = document.getElementById('homeSidebarResizer');
        resizer.removeEventListener('pointermove', window.__onDragMove);
        window.__dragRO.disconnect();
        return window.__dragSamples;
    })()`);
    await send({ type: 'mouseReleased', x: x + 168, y, button: 'left', buttons: 0, clickCount: 1 });

    const moves = midSamples.filter(s => s.kind === 'pointermove');
    assert.ok(moves.length >= 10, `expected >= 10 pointermove samples, got ${moves.length}`);
    assert.ok(moves.at(-1).threadLeft - moves[0].threadLeft >= 120, 'expected sidebar drag to shift #dcThread right');
    for (const sample of midSamples) {
        assert.ok(Math.abs(sample.railLeft - (sample.threadLeft + 3)) < 1,
            `${sample.kind}: rail (${sample.railLeft}) should match thread+3 (${sample.threadLeft + 3})`);
        if (!sample.previewHidden) {
            assert.ok(sample.previewLeft >= sample.railRight + 8,
                `${sample.kind}: preview (${sample.previewLeft}) should track moved rail (${sample.railRight})`);
        }
    }
}

app.whenReady().then(async () => {
    const web = express();
    web.get('/', (req, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
        html = html.replace(/<body\b[^>]*>/, tag => `${tag}<script>
            localStorage.setItem('tools_token', 'test-token');
            localStorage.setItem('tools_user', 'alice');
            localStorage.setItem('tools_tenant_id', 'default');
            localStorage.setItem('home_sidebar_mode', 'expanded');
            localStorage.setItem('tools_lang', 'zh-CN');
        </script>`);
        res.type('html').send(html);
    });
    web.use('/api', (req, res) => res.json({}));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const l = web.listen(0, '127.0.0.1', () => resolve(l)); });

    win = new BrowserWindow({
        show: false,
        width: 1440,
        height: 900,
        webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await wait(500);

    await evaluate(`
        document.body.classList.add('dc-chatting');
        document.getElementById('dcThread').innerHTML = Array.from({ length: 4 }, (_, i) =>
            '<div class="dc-msg dc-msg--user"><div class="dc-msg-body">Question ' + i + '</div></div>' +
            '<div class="dc-msg dc-msg--ai"><div class="dc-msg-body">Answer ' + i + '</div></div>'
        ).join('');
    `);
    await wait(250);

    win.webContents.debugger.attach('1.3');
    const send = params => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', params);

    const rect1 = await evaluate(`document.getElementById('homeSidebarResizer').getBoundingClientRect().toJSON()`);
    await runDragAndAssert(rect1, send);

    await evaluate(`
        localStorage.removeItem('home_sidebar_widths');
        document.getElementById('homeSidebarResizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        document.body.classList.add('dc-workspace-open');
    `);
    await wait(100);
    const rect2 = await evaluate(`document.getElementById('homeSidebarResizer').getBoundingClientRect().toJSON()`);
    await runDragAndAssert(rect2, send);

    // Also verify ResizeObserver-only width shift updates rail & visible preview in the same frame before rAF.
    const roPreview = await evaluate(`new Promise(resolve => {
        const rail = document.querySelector('.conversation-rail');
        const preview = document.querySelector('.conversation-rail-preview');
        const thread = document.getElementById('dcThread');
        rail.querySelector('button').focus();
        const ro = new ResizeObserver(() => {
            ro.disconnect();
            resolve({
                threadLeft: thread.getBoundingClientRect().left,
                railLeft: rail.getBoundingClientRect().left,
                railRight: rail.getBoundingClientRect().right,
                previewHidden: preview.hidden,
                previewLeft: preview.getBoundingClientRect().left
            });
        });
        ro.observe(thread);
        document.documentElement.style.setProperty('--v2-side-width', '360px');
    })`);
    assert.ok(Math.abs(roPreview.railLeft - (roPreview.threadLeft + 3)) < 1);
    assert.equal(roPreview.previewHidden, false);
    assert.ok(roPreview.previewLeft >= roPreview.railRight + 8);

    console.log('PASS: conversation rail and preview follow sidebar drag on every frame without waiting for mouseup');
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    win?.destroy();
    server?.closeAllConnections();
    server?.close();
    fs.rmSync(temp, { recursive: true, force: true });
    app.exit(process.exitCode || 0);
});
