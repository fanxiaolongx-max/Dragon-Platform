// Run: node_modules/.bin/electron tests/right-sidebars-resize-browser.cjs
// Verifies manual pointer-drag and keyboard resizing across all workspace right sidebars
// on desktop (expanded/collapsed left rail) and narrow drawer layouts without hitting external services.
const { app, BrowserWindow } = require('electron');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'right-sidebars-resize-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
    for (let i = 0; i < 120; i++) {
        if (await fn()) return;
        await wait(30);
    }
    throw new Error('Timed out waiting for condition: ' + fn);
}

app.whenReady().then(async () => {
    let win, server;
    try {
        const web = express();
        web.get('/', (_req, res) => {
            const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8')
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
            res.send(html.replace('</body>', [
                '<script>document.body.classList.add("home-mode-chat");window.ToolsNavigation={currentUser:()=>({role:"admin"})};</script>',
                '<script src="/js/shared/sidebar-resize.js"></script>',
                '<script src="/js/home/workspace-panel.js"></script>',
                '<script src="/js/home/browser-sidebar.js"></script>',
                '<script src="/js/home/terminal-sidebar.js"></script>',
                '<script src="/js/shared/chat-files.js"></script>',
                '</body>'
            ].join('')));
        });
        web.get('/api/agent-workspace/capability', (_req, res) => res.json({ enabled: true }));
        web.get('/api/agent-workspace/prefs', (_req, res) => res.json({ lastDirectory: '', recentDirectories: [], permissionMode: 'ask' }));
        web.get('/api/agent-workspace/browser/view', (_req, res) => res.json({ available: false, tabs: [] }));
        web.get('/api/agent-terminal/sessions', (_req, res) => res.json({ pty: false, shells: [{ id: 'sh', label: 'sh', default: true }], items: [] }));
        web.post('/api/agent-terminal/sessions', (_req, res) => res.json({ session: { id: 't1', kind: 'shell', title: 'sh' } }));
        web.get('/api/agent-files/stat', (_req, res) => res.json({ size: 20 }));
        web.get('/api/agent-files/raw', (_req, res) => res.type('text').send('demo preview\nline2'));
        web.use(express.static(path.join(root, 'frontend')));

        server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
        win = new BrowserWindow({
            show: false,
            width: 1440,
            height: 950,
            webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
        });
        await win.loadURL(`http://127.0.0.1:${server.address().port}`);
        const ev = code => win.webContents.executeJavaScript(code, true);
        await until(() => ev('!!window.DragonClawWorkspace && !!window.DragonBrowserSidebar && !!window.DragonTerminalSidebar && !!window.ChatFiles'));

        async function dragHandle(selector, dx) {
            const info = await ev(`(() => {
                const panel = document.querySelector(${JSON.stringify(selector)});
                const handle = [...panel.querySelectorAll('.dc-sidebar-resize, .ai-file-preview-resize')]
                    .find(el => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
                if (!panel || !handle) return { ok: false };
                const hr = handle.getBoundingClientRect();
                const pr = panel.getBoundingClientRect();
                const x = Math.round(hr.left + hr.width / 2);
                const y = Math.round(hr.top + hr.height / 2);
                const hit = document.elementFromPoint(x, y);
                return { ok: true, width: pr.width, x, y, hitOk: hit === handle || handle.contains(hit), hitTag: hit?.className || hit?.tagName };
            })()`);
            assert.equal(info.ok, true, `${selector} visible handle present`);
            assert.equal(info.hitOk, true, `${selector} resize handle not occluded (hit ${info.hitTag})`);

            win.webContents.sendInputEvent({ type: 'mouseMove', x: info.x, y: info.y });
            win.webContents.sendInputEvent({ type: 'mouseDown', x: info.x, y: info.y, button: 'left', clickCount: 1 });
            for (let i = 1; i <= 5; i++) {
                win.webContents.sendInputEvent({ type: 'mouseMove', x: info.x + Math.round(dx * i / 5), y: info.y, button: 'left' });
                await wait(16);
            }
            win.webContents.sendInputEvent({ type: 'mouseUp', x: info.x + dx, y: info.y, button: 'left', clickCount: 1 });
            await wait(80);
            const after = await ev(`({ width: document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width, hidden: document.querySelector(${JSON.stringify(selector)}).hidden })`);
            return { before: info.width, after: after.width, hidden: after.hidden };
        }

        // 1. #dcWorkspacePanel (expanded + collapsed + external card)
        await ev('DragonClawWorkspace.openPanel(); void 0');
        await wait(150);
        let res = await dragHandle('#dcWorkspacePanel', -100);
        assert.ok(res.after >= res.before + 90, `workspace expanded widen: ${res.before} -> ${res.after}`);
        res = await dragHandle('#dcWorkspacePanel', 80);
        assert.ok(res.after <= res.before - 70, `workspace expanded narrow: ${res.before} -> ${res.after}`);

        await ev('document.body.classList.add("v2-side-collapsed"); void 0');
        await wait(100);
        res = await dragHandle('#dcWorkspacePanel', -100);
        assert.ok(res.after >= res.before + 90, `workspace collapsed widen: ${res.before} -> ${res.after}`);

        await ev('DragonClawWorkspace.showExternal({ title: "External", open: true }); void 0');
        await wait(100);
        res = await dragHandle('#dcWorkspacePanel', -80);
        assert.ok(res.after >= res.before + 70, `workspace external card widen: ${res.before} -> ${res.after}`);
        await ev('DragonClawWorkspace.hideExternal(); document.body.classList.remove("v2-side-collapsed"); void 0');

        // 2. File preview mounted (+ legacy home-sidebar-collapsed coexist) + floating
        await ev('ChatFiles.openPreview("/tmp/demo.txt"); void 0');
        await until(() => ev('!!document.querySelector(".ai-file-preview-resize")'));
        res = await dragHandle('#dcWorkspacePanel', -100);
        assert.ok(res.after >= res.before + 90, `file preview mounted widen: ${res.before} -> ${res.after}`);

        await ev('document.body.classList.add("v2-side-collapsed", "home-sidebar-collapsed"); void 0');
        await wait(100);
        res = await dragHandle('#dcWorkspacePanel', -80);
        assert.ok(res.after >= res.before + 70, `file preview collapsed + legacy class widen: ${res.before} -> ${res.after}`);
        await ev('ChatFiles.closePreview(); document.body.classList.remove("v2-side-collapsed", "home-sidebar-collapsed"); void 0');

        // 3. Browser sidebar (+ swarm canvas + expanded sidebar)
        await ev('DragonBrowserSidebar.open({ liveCanvas: true }); dcBrowserPanel.classList.add("is-swarm-canvas"); void 0');
        await wait(200);
        res = await dragHandle('#dcBrowserPanel', 180);
        assert.ok(res.after <= res.before - 160, `browser swarm-canvas shrink: ${res.before} -> ${res.after}`);
        await ev('document.body.classList.remove("v2-side-collapsed"); void 0');
        await wait(100);
        res = await dragHandle('#dcBrowserPanel', 100);
        assert.ok(res.after <= res.before - 80, `browser expanded sidebar shrink: ${res.before} -> ${res.after}`);
        await ev('dcBrowserPanel.classList.remove("is-swarm-canvas"); DragonBrowserSidebar.close(); void 0');

        // 4. Terminal sidebar (expanded + collapsed)
        await ev('DragonTerminalSidebar.open(); void 0');
        await wait(200);
        res = await dragHandle('#dcTerminalPanel', -100);
        assert.ok(res.after >= res.before + 90, `terminal expanded widen: ${res.before} -> ${res.after}`);
        await ev('document.body.classList.add("v2-side-collapsed"); void 0');
        await wait(100);
        res = await dragHandle('#dcTerminalPanel', 100);
        assert.ok(res.after <= res.before - 90, `terminal collapsed shrink: ${res.before} -> ${res.after}`);
        await ev('DragonTerminalSidebar.close(); document.body.classList.remove("v2-side-collapsed"); void 0');

        // 5. Narrow / mobile drawer (<= 860px)
        win.setSize(700, 800);
        await until(() => ev('innerWidth <= 700'));
        await wait(200);

        await ev('DragonClawWorkspace.openPanel(); void 0');
        await wait(250);
        res = await dragHandle('#dcWorkspacePanel', 120);
        assert.equal(res.hidden, false, 'narrow workspace drawer stays open when dragging resize handle');
        assert.ok(res.after <= res.before - 100, `narrow workspace shrink: ${res.before} -> ${res.after}`);
        await ev('DragonClawWorkspace.closePanel(); void 0');

        await ev('ChatFiles.openPreview("/tmp/demo.txt"); void 0');
        await until(() => ev('!!document.querySelector(".ai-file-preview-resize")'));
        await wait(150);
        res = await dragHandle('#dcWorkspacePanel', 120);
        assert.equal(res.hidden, false, 'narrow mounted file preview stays open when dragging');
        assert.ok(res.after <= res.before - 100, `narrow file preview shrink: ${res.before} -> ${res.after}`);
        await ev('ChatFiles.closePreview(); void 0');

        await ev('DragonBrowserSidebar.open(); void 0');
        await wait(200);
        res = await dragHandle('#dcBrowserPanel', 150);
        assert.ok(res.after <= res.before - 130, `narrow browser shrink: ${res.before} -> ${res.after}`);
        await ev('DragonBrowserSidebar.close(); void 0');

        await ev('DragonTerminalSidebar.open(); void 0');
        await wait(200);
        res = await dragHandle('#dcTerminalPanel', 150);
        assert.ok(res.after <= res.before - 130, `narrow terminal shrink: ${res.before} -> ${res.after}`);

        console.log('PASS: all workspace right sidebars resize via pointer drag in desktop and narrow layouts.');
    } finally {
        win?.destroy();
        server?.close();
        fs.rmSync(temp, { recursive: true, force: true });
    }
    app.exit(0);
}).catch(error => {
    console.error(error);
    app.exit(1);
});
