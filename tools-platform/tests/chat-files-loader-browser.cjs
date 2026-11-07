// node_modules/.bin/electron tests/chat-files-loader-browser.cjs
// Actual home/navbar loading, with isolated storage and mocked APIs/CDN cache.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('../backend/node_modules/express');
const { createFrontendHtmlSender, fileHash } = require('../backend/models/asset-versioning');
const frontend = path.join(__dirname, '../frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-files-loader-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
let win, server;
const requests = [];
const evaluate = source => win.webContents.executeJavaScript(source, true);
async function until(source) {
    for (let i = 0; i < 150; i++) {
        if (await evaluate(source)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Timed out: ' + source);
}
app.whenReady().then(async () => {
    const web = express();
    web.get('/', (_, res) => createFrontendHtmlSender(frontend)(res, 'index.html'));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture', role: 'admin', tenantId: 'default' }));
    web.get('/api/tenants', (_, res) => res.json({ tenants: [{ id: 'default', name: '默认租户' }], activeTenantId: 'default' }));
    web.get('/api/asset-version', (req, res) => {
        const version = fileHash(path.join(frontend, req.query.path));
        // Vary response time to exercise dependency ordering and duplicate calls.
        setTimeout(() => res.json({ version }), 80);
    });
    web.get('/js/shared/chat-files.js', (req, res, next) => {
        requests.push(req.originalUrl);
        if (!req.query.v) return res.type('js').send('window.ChatFiles={staleFixture:true};');
        next();
    });
    web.get('/js/shared/ai-assistant.js', (req, res, next) => {
        requests.push(req.originalUrl);
        next();
    });
    web.get('/api/agent-files/stat', (_, res) => res.json({ size: 100 }));
    web.get(['/api/custom-tools', '/api/friend-links', '/api/recent-nav', '/api/upload/history'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [], models: [], profiles: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1100, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const base = 'http://127.0.0.1:' + server.address().port;
    await win.loadURL(base + '/login.html');
    await evaluate(`localStorage.setItem('tools_token','fixture');localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_tenant_id','default')`);
    await win.loadURL(base);
    await until('typeof ensureToolsAIAssistantScript === "function"');
    await evaluate('Promise.all([ensureToolsAIAssistantScript(),ensureToolsAIAssistantScript()]).then(()=>true)');
    assert.deepEqual(requests, ['/js/shared/chat-files.js?v=' + fileHash(path.join(frontend, 'js/shared/chat-files.js')), '/js/shared/ai-assistant.js?v=' + fileHash(path.join(frontend, 'js/shared/ai-assistant.js'))], 'auto/manual calls share one versioned, ordered load');
    await evaluate(`{
        const reply=document.createElement('div');reply.id='loadedReply';reply.className='dc-msg dc-msg--ai';
        reply.innerHTML=ToolsAIAssistant.renderMarkdown('原因：\\n在\\n[CODE0](/tmp/conversation-list.js)\\n的\\n[CODE1](/tmp/conversation-list.js)\\n中。\\n\\n修复：\\n- 在\\n[CODE2](/tmp/desktop-agents.test.js)\\n中更新。');
        document.body.append(reply);
    }`);
    await until('loadedReply.querySelectorAll(".ai-file-chip--compact").length===3');
    assert.equal(await evaluate('[...loadedReply.querySelectorAll(".ai-file-chip-icon")].every(icon=>getComputedStyle(icon).display==="none")'), true);
    assert.deepEqual(await evaluate('[...loadedReply.querySelectorAll(".ai-file-chip-name")].map(link=>link.textContent)'), ['conversation-list.js', 'conversation-list.js', 'desktop-agents.test.js']);
    console.log('PASS: actual home loader bypasses stale CDN address, preserves dependency order, avoids duplicate loads and renders compact filenames');
    win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); win?.destroy(); server?.close(); app.exit(1); });
