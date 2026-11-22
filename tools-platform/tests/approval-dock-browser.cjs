// Run with node_modules/.bin/electron tests/approval-dock-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');

const frontend = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../frontend');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'approval-dock-')));
app.whenReady().then(async () => {
    const web = express();
    const page = fs.readFileSync(path.join(frontend, 'index.html'), 'utf8')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
        .replace('home-mode-chat home-booting', 'home-mode-chat dc-chatting v2-side-collapsed')
        .replace('</body>', '<script src="/js/home/todo-dock.js"></script><script src="/js/home/workspace-panel.js"></script></body>');
    web.get('/', (_, res) => res.type('html').send(page));
    web.get('/api/*', (_, res) => res.json({}));
    web.use(express.static(frontend));
    const server = await new Promise(resolve => {
        const listener = web.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const win = new BrowserWindow({ show: false, width: 540, height: 640 });
    try {
        await win.loadURL('http://127.0.0.1:' + server.address().port);
        const result = await win.webContents.executeJavaScript(`(async () => {
            const thread = document.getElementById('dcThread');
            const message = document.createElement('div');
            message.innerHTML = '<div class="dc-msg-main"></div>';
            thread.append(message);
            const event = { type: 'approval', id: 'fixture', callId: 'command', tool: 'run_command', preview: { command: 'echo test' } };
            const workspace = window.DragonClawWorkspace;
            const plan = [{ content: 'test', status: 'in_progress' }];
            DragonClawTodoDock.update(message, plan, null);
            const head = document.querySelector('.dc-todo-dock-head');
            workspace.handleEvent(message, event);
            await Promise.resolve();
            const folded = head.getAttribute('aria-expanded') === 'false';
            workspace.handleEvent(message, { ...event, callId: 'parallel' });
            workspace.handleEvent(message, { type: 'approval_result', callId: 'parallel', decision: 'allow' });
            await Promise.resolve();
            const stillFolded = head.getAttribute('aria-expanded') === 'false';
            const dock = document.getElementById('dcApprovalDock');
            const card = dock.querySelector('.dc-approval');
            message.appendChild(document.createElement('pre')).textContent = 'streaming\\n'.repeat(300);
            thread.scrollTop = thread.scrollHeight;
            const box = card.getBoundingClientRect();
            const pinned = box.top >= 0 && box.bottom <= document.getElementById('dcComposer').getBoundingClientRect().top + 1 && box.height > 0;
            workspace.handleEvent(message, { type: 'approval_result', callId: 'command', decision: 'deny' });
            await Promise.resolve();
            const reopened = head.getAttribute('aria-expanded') === 'true';
            head.click();
            const settled = message.contains(card) && card.classList.contains('is-deny') && !dock.childElementCount;
            workspace.handleEvent(message, { ...event, callId: 'next' });
            message.remove();
            await Promise.resolve();
            const cleared = !dock.childElementCount;
            thread.append(message);
            workspace.replayEvents(message, [event]);
            return { pinned, settled, cleared, folded, stillFolded, reopened, staysClosed: head.getAttribute('aria-expanded') === 'false', history: !dock.childElementCount };
        })()`);
        assert.deepEqual(result, { pinned: true, settled: true, cleared: true, folded: true, stillFolded: true, reopened: true, staysClosed: true, history: true });
        console.log('PASS: pending approval stays above composer during streaming and returns to history.');
    } finally {
        win.destroy();
        server.close();
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
