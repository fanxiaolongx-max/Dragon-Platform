/* Run: node_modules/.bin/electron tests/home-chat-loading-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-chat-loading-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server;
const pending = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(check, label) {
    for (let n = 0; n < 150; n++) {
        if (await check()) return;
        await wait(20);
    }
    throw new Error(`Timed out: ${label}`);
}
const sessions = ['slow', 'fast', 'failed'].map(id => ({ id, firstQuestion: id, updatedAt: '2026-10-20T10:00:00Z', messageCount: 30 }));
const messages = id => Array.from({ length: 30 }, (_, index) => ({
    id: `${id}-${index}`, role: index % 2 ? 'model' : 'user', content: `${id} message ${index}\n`.repeat(index % 2 ? 20 : 1), created_at: '2026-10-20 10:00:00'
}));
const openMine = id => evaluate(`document.querySelector('[data-chat-index="${sessions.findIndex(item => item.id === id)}"]').click()`);
const openWelink = id => evaluate(`HomeWelinkThreads.open({kind:'group',id:${JSON.stringify(id)},name:'WeLink test'});void 0`);
async function release(key, data, status = 200) {
    await until(() => pending.has(key), `request ${key}`);
    const response = pending.get(key);
    pending.delete(key);
    response.status(status).json(data);
}
async function skeleton() {
    assert.equal(await evaluate("dcThread.getAttribute('aria-busy')"), 'true');
    assert.equal(await evaluate("!!dcThread.querySelector('.dc-history-skeleton')"), true);
    assert.equal(await evaluate("getComputedStyle(dcDatacomPromo).display"), 'none');
    assert.equal(await evaluate('dcInput.disabled'), true);
}
app.whenReady().then(async () => {
    const web = express();
    web.get('/', (_, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, tag => tag.includes('id="homeModeBootstrap"') || /src="\/js\/(?:home\/(?:home-mode|dragon-claw|welink-threads)|shared\/i18n)\.js"/.test(tag) ? tag : '');
        html = html.replace(/<body\b[^>]*>/, tag => `${tag}<script>
            localStorage.setItem('tools_user','chat-test');
            localStorage.setItem('tools_lang','zh-CN');
            window.DragonClawWorkspace={resetSession(){},resumeWorkspace:async()=>{},hideExternal(){}};
        </script>`);
        res.type('html').send(html);
    });
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: sessions }));
    web.get('/api/ai/sessions/:id/messages', (req, res) => pending.set(req.params.id, res));
    web.get('/api/channels/welink/threads', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/welink/threads/group/:id/:kind', (req, res) => pending.set(`${req.params.id}-${req.params.kind}`, res));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3 && !message.includes('status of 503')) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => evaluate("document.querySelectorAll('[data-chat-index]').length===3"), 'personal history list');
    assert.notEqual(await evaluate('getComputedStyle(dcDatacomPromo).display'), 'none');
    await openMine('slow');
    await skeleton();
    await wait(80);
    fs.writeFileSync(path.join(temp, 'skeleton.png'), (await win.webContents.capturePage()).toPNG());
    await openMine('fast');
    await release('fast', { items: messages('fast'), hasMore: false });
    await until(() => evaluate("dcThread.querySelectorAll('.dc-msg').length===30"), 'render personal history');
    assert.equal(await evaluate("dcThread.hasAttribute('aria-busy')"), false);
    assert.equal(await evaluate('dcInput.disabled'), false);
    assert.ok(await evaluate('dcThread.scrollHeight-dcThread.scrollTop-dcThread.clientHeight<5'), 'History opens at the bottom');
    await release('slow', { items: messages('slow') });
    await wait(60);
    assert.equal(await evaluate("dcThread.textContent.includes('slow message')"), false, 'Older request cannot replace newer chat');
    assert.ok(await evaluate("Math.abs(document.querySelector('.dc-chat-head').getBoundingClientRect().top-dragonClaw.getBoundingClientRect().top)<2"), 'Header settles at the top without an ad gap');

    await openMine('failed');
    await release('failed', {}, 503);
    await until(() => evaluate("!!dcThread.querySelector('[data-dc-session-retry]')"), 'failure retry');
    assert.equal(await evaluate("dcThread.hasAttribute('aria-busy')"), false);
    await evaluate("dcThread.querySelector('[data-dc-session-retry]').click()");
    await skeleton();
    await evaluate("localStorage.removeItem('dragon_claw_last_chat');DragonClaw.newChat()");
    await release('failed', { items: messages('failed') });
    await wait(40);
    assert.equal(await evaluate("document.body.classList.contains('dc-chatting')"), false, 'New chat cancels an in-flight restore');
    assert.notEqual(await evaluate('getComputedStyle(dcDatacomPromo).display'), 'none');

    await openWelink('wl');
    await skeleton();
    await release('wl-messages', { items: messages('welink').map(item => ({ ...item, sessionId: 'segment', createdAt: '2026-10-20T10:00:00Z' })), segments: [{ aiSessionId: 'segment' }] });
    await until(() => evaluate("dcThread.querySelectorAll('.wl-msg').length===30"), 'WeLink renders before follow-ups');
    assert.equal(await evaluate("dcThread.hasAttribute('aria-busy')"), false);
    assert.ok(pending.has('wl-followups'), 'Follow-ups are still pending when messages become readable');
    assert.equal(await evaluate("dcThread.querySelector('.wl-divider').nextElementSibling.classList.contains('wl-msg')"), true, 'Context divider remains ahead of its messages');
    await release('wl-followups', { items: [] });
    await openMine('slow');
    await skeleton();
    await openWelink('other');
    await release('slow', { items: messages('slow') });
    await wait(40);
    await skeleton();
    assert.equal(await evaluate("document.body.classList.contains('dc-external-view')"), true, 'Switching source cancels personal restore');
    await release('other-messages', { items: [], segments: [] });
    await release('other-followups', { items: [] });
    await until(() => evaluate("!dcThread.hasAttribute('aria-busy')"), 'empty WeLink history');

    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    win.setSize(390, 844);
    await evaluate("localStorage.removeItem('dragon_claw_last_chat');document.documentElement.dataset.theme='light';ToolsI18n.setLanguage('en-US');DragonClaw.newChat()");
    await openMine('fast');
    await skeleton();
    assert.equal(await evaluate("getComputedStyle(dcThread.querySelector('.dc-history-skeleton')).animationName"), 'none');
    assert.equal(await evaluate("dcThread.querySelector('[role=status]').getAttribute('aria-label')"), 'Loading…');
    assert.ok(await evaluate("dcThread.scrollWidth<=dcThread.clientWidth+1"), 'Skeleton fits a narrow viewport');
    assert.ok(await evaluate("document.querySelector('.dc-chat-title').getBoundingClientRect().right<=document.querySelector('.dc-chat-actions').getBoundingClientRect().left"), 'English header title does not overlap buttons');
    await release('fast', { items: messages('mobile') });
    await until(() => evaluate("!dcThread.hasAttribute('aria-busy')"), 'mobile history');
    fs.writeFileSync(path.join(temp, 'mobile.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log(`PASS: immediate skeleton, header/ad layout, 30-message rendering, stale responses, retry, new chat/source cancellation, independent WeLink follow-ups, divider order, mobile, English, reduced motion. Previews: ${temp}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode || 0);
});
