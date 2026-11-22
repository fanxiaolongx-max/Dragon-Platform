const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

let server;
const root = path.resolve(__dirname, '..');

function serve() {
    return new Promise((resolve) => {
        server = http.createServer((req, res) => {
            let reqPath = req.url.split('?')[0];
            if (reqPath === '/') reqPath = '/index.html';
            let filePath = path.join(root, 'frontend', reqPath);
            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end();
                return;
            }
            const ext = path.extname(filePath);
            const mimeTypes = {
                '.html': 'text/html',
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.json': 'application/json',
                '.png': 'image/png',
                '.jpg': 'image/jpeg'
            };
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
            res.end(fs.readFileSync(filePath));
        });
        server.listen(0, '127.0.0.1', () => {
            resolve(server.address().port);
        });
    });
}

app.whenReady().then(async () => {
    const port = await serve();
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.webContents.on('console-message', (e, level, msg) => console.log('Renderer:', msg));
    await win.loadURL(`http://127.0.0.1:${port}/index.html`);

    async function evaluate(fnStr) {
        return await win.webContents.executeJavaScript(fnStr);
    }

    // Wait for DOM and enter chat mode
    await evaluate(`new Promise(res => {
        if (document.readyState === 'complete') res();
        else window.addEventListener('DOMContentLoaded', () => res());
    })`);

    await evaluate(`
        document.documentElement.classList.add('platform-home');
        document.body.classList.add('dc-chatting');
        const wsToggle = document.getElementById('dcWorkspaceToggle');
        if (wsToggle) wsToggle.hidden = false;
    `);

    await new Promise(r => setTimeout(r, 200));

    // In wide mode (1400px), buttons should be on a single row
    const wideInfo = await evaluate(`(() => {
        const actions = document.querySelector('.dc-chat-actions');
        const btns = Array.from(actions.querySelectorAll('.dc-ghost-btn'));
        const labels = Array.from(actions.querySelectorAll('.dc-btn-label'));
        const visibleBtns = btns.filter(b => b.offsetWidth > 0 && b.offsetHeight > 0);
        const firstTop = visibleBtns[0].getBoundingClientRect().top;
        const allSameRow = visibleBtns.every(b => Math.abs(b.getBoundingClientRect().top - firstTop) < 4);
        return {
            allSameRow,
            actionsHeight: actions.getBoundingClientRect().height,
            visibleLabels: labels.filter(l => window.getComputedStyle(l).opacity !== '0' && l.offsetWidth > 0).length
        };
    })()`);

    console.log('Wide mode info:', wideInfo);
    assert.ok(wideInfo.allSameRow, 'Wide mode buttons are all in a single row');
    assert.ok(wideInfo.actionsHeight <= 45, 'Actions container does not wrap in wide mode');
    assert.ok(wideInfo.visibleLabels >= 5, 'Action buttons display text labels in wide mode');

    // Simulate squeezed condition:
    // 1. Squeeze window down (simulating right sidebar opened taking 50% width)
    win.setSize(760, 800);
    await evaluate(`
        document.body.classList.add('dc-workspace-open');
        document.querySelector('.dc-chat-head').classList.add('is-squeezed');
        document.querySelector('.dc-chat-actions').classList.add('is-squeezed');
    `);
    await new Promise(r => setTimeout(r, 350));

    const squeezedInfo = await evaluate(`(() => {
        const actions = document.querySelector('.dc-chat-actions');
        const btns = Array.from(actions.querySelectorAll('.dc-ghost-btn'));
        const visibleBtns = btns.filter(b => b.offsetWidth > 0 && b.offsetHeight > 0);
        const labels = Array.from(actions.querySelectorAll('.dc-btn-label'));
        const firstTop = visibleBtns[0].getBoundingClientRect().top;
        const allSameRow = visibleBtns.every(b => Math.abs(b.getBoundingClientRect().top - firstTop) < 4);
        const iconWidths = visibleBtns.map(b => b.getBoundingClientRect().width);
        return {
            allSameRow,
            actionsHeight: actions.getBoundingClientRect().height,
            maxIconWidth: Math.max(...iconWidths),
            visibleLabels: labels.filter(l => window.getComputedStyle(l).opacity !== '0' && l.offsetWidth > 0).length
        };
    })()`);

    console.log('Squeezed mode info:', squeezedInfo);
    assert.ok(squeezedInfo.allSameRow, 'Squeezed buttons MUST all remain in a single row');
    assert.ok(squeezedInfo.actionsHeight <= 36, `Actions container height is compact (${squeezedInfo.actionsHeight}px) and never wraps`);
    assert.equal(squeezedInfo.visibleLabels, 0, 'In squeezed mode, labels must be completely hidden (0 visible)');
    assert.ok(squeezedInfo.maxIconWidth <= 34, `Buttons collapse into compact square icon buttons (max width ${squeezedInfo.maxIconWidth}px)`);

    console.log('PASS: Chat actions smoothly collapse into elegant icon buttons without wrapping under squeeze conditions!');
    win.destroy();
    server.close();
    app.exit(0);
}).catch(err => {
    console.error(err);
    if (server) server.close();
    process.exit(1);
});
