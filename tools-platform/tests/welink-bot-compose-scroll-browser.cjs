/* Run: node_modules/.bin/electron tests/welink-bot-compose-scroll-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'welink-bot-scroll-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(check, label) {
    for (let n = 0; n < 150; n++) {
        if (await check()) return;
        await wait(20);
    }
    throw new Error(`Timed out: ${label}`);
}
const items = Array.from({ length: 30 }, (_, index) => ({
    id: `wl-${index}`, role: index % 2 ? 'model' : 'user', content: `message ${index}\n`.repeat(index % 2 ? 6 : 1), sessionId: 'segment', createdAt: '2026-10-20T10:00:00Z'
}));
const gap = () => evaluate('dcThread.scrollHeight-dcThread.scrollTop-dcThread.clientHeight');
// 最后一条消息底边不能被底部面板盖住
const lastVisible = (selector = '.wl-msg') => evaluate("[...dcThread.querySelectorAll('" + selector + "')].pop().getBoundingClientRect().bottom<=dcThread.getBoundingClientRect().bottom+1");
async function switchRole(role) {
    const before = await evaluate('dcThread.scrollTop');
    await evaluate(`document.querySelector('[data-wl-role="${role}"]').click()`);
    const samples = [];
    for (let n = 0; n < 50; n++) { samples.push(await evaluate('dcThread.scrollTop')); await wait(15); }
    const after = await evaluate('dcThread.scrollTop');
    // 取一个介于起止之间的中间帧，证明是动画而不是瞬移
    const middle = samples.find(top => top !== before && top !== after) ?? after;
    return { before, middle, after };
}
app.whenReady().then(async () => {
    const web = express();
    web.get('/', (_, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
        html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, tag => tag.includes('id="homeModeBootstrap"') || /src="\/js\/(?:home\/(?:home-mode|dragon-claw|welink-threads)|shared\/i18n)\.js"/.test(tag) ? tag : '');
        html = html.replace(/<body\b[^>]*>/, tag => `${tag}<script>
            localStorage.setItem('tools_user','scroll-test');
            localStorage.setItem('tools_lang','zh-CN');
            window.DragonClawWorkspace={resetSession(){},resumeWorkspace:async()=>{},hideExternal(){}};
        </script>`);
        res.type('html').send(html);
    });
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [{ id: 'mine', firstQuestion: 'mine', updatedAt: '2026-10-20T10:00:00Z', messageCount: 30 }] }));
    web.get('/api/ai/sessions/:id/messages', (_, res) => res.json({ items: items.map(item => ({ id: item.id, role: item.role, content: item.content, created_at: '2026-10-20 10:00:00' })), hasMore: false }));
    web.get('/api/channels/welink/threads', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/welink/threads/group/:id/messages', (_, res) => res.json({ items, segments: [{ aiSessionId: 'segment' }], canSend: true }));
    web.get('/api/channels/welink/threads/group/:id/followups', (_, res) => res.json({ items: [] }));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1280, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await until(() => evaluate('!!window.HomeWelinkThreads&&!!document.querySelector("[data-chat-index]")'), 'modules and history list');

    // 普通对话：输入换行使输入框增高/降低时，对话区跟着上移/回落
    await evaluate("document.querySelector('[data-chat-index]').click()");
    await until(() => evaluate("dcThread.querySelectorAll('.dc-msg').length===30&&!dcThread.hasAttribute('aria-busy')"), 'personal history');
    await wait(100);
    assert.ok(await gap() < 5, 'Personal chat opens at the bottom');
    const top0 = await evaluate('dcThread.scrollTop');
    await evaluate("dcInput.value='a\\nb\\nc\\nd\\ne\\nf';dcInput.dispatchEvent(new Event('input',{bubbles:true}))");
    await wait(80);
    assert.ok(await evaluate('dcThread.scrollTop') - top0 > 40, 'Timeline moves up as the input grows');
    assert.ok(await gap() < 5 && await lastVisible('.dc-msg'), 'Latest message stays visible above the taller input');
    await evaluate("dcInput.value='';dcInput.dispatchEvent(new Event('input',{bubbles:true}))");
    await wait(80);
    assert.ok(Math.abs(await evaluate('dcThread.scrollTop') - top0) < 5 && await gap() < 5, 'Timeline settles back when the input shrinks');
    await evaluate('dcThread.scrollTop=dcThread.scrollHeight-dcThread.clientHeight-300');
    await wait(50);
    await evaluate("dcInput.value='a\\nb\\nc\\nd';dcInput.dispatchEvent(new Event('input',{bubbles:true}))");
    await wait(80);
    assert.ok(Math.abs(await gap() - 300) < 5, 'Reading position is kept while the input grows');
    await evaluate("dcInput.value='';dcInput.dispatchEvent(new Event('input',{bubbles:true}))");

    await evaluate("HomeWelinkThreads.open({kind:'group',id:'g1',name:'WeLink test'});void 0");
    await until(() => evaluate("dcThread.querySelectorAll('.wl-msg').length===30&&!!document.querySelector('[data-wl-role=bot]')"), 'thread with role switch');
    await wait(100);
    assert.ok(await gap() < 5, 'Thread opens at the bottom');

    const toBot = await switchRole('bot');
    assert.ok(await evaluate("!!document.querySelector('[data-wl-compose]')"), 'Composer is shown');
    assert.ok(toBot.after - toBot.before > 60, `Timeline moves up with the taller panel (${toBot.before} → ${toBot.after})`);
    assert.ok(toBot.middle > toBot.before && toBot.middle < toBot.after, `Movement is animated (${toBot.before} → ${toBot.middle} → ${toBot.after})`);
    assert.ok(await gap() < 5, 'Still pinned to the bottom in bot mode');
    assert.ok(await lastVisible(), 'Latest message is not covered by the composer');
    fs.writeFileSync(path.join(temp, 'bot.png'), (await win.webContents.capturePage()).toPNG());

    const toView = await switchRole('view');
    assert.ok(toView.after < toView.before, 'Timeline settles back when the panel shrinks');
    assert.ok(await gap() < 5, 'Bottom stays pinned after switching back');

    // 用户往上翻阅时，切换身份应保持当前阅读位置相对底部不变
    await evaluate('dcThread.scrollTop=dcThread.scrollHeight-dcThread.clientHeight-300');
    await wait(50);
    await switchRole('bot');
    assert.ok(Math.abs(await gap() - 300) < 5, 'Reading position is kept relative to the bottom');
    await evaluate("const t=document.querySelector('[data-wl-compose]');t.style.height='170px'");
    await wait(80);
    assert.ok(Math.abs(await gap() - 300) < 5, 'Resizing the textarea keeps the position');

    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate('dcThread.scrollTop=dcThread.scrollHeight');
    await switchRole('view');
    const reduced = await switchRole('bot');
    assert.equal(reduced.middle, reduced.after, 'Reduced motion jumps without animation');
    assert.ok(await gap() < 5 && await lastVisible(), 'Reduced motion still pins the latest message');
    assert.deepEqual(errors, []);
    console.log(`PASS: personal input grows/shrinks with timeline, bot composer pushes the timeline up smoothly, restores on view, keeps reading position, textarea resize, reduced motion. Preview: ${temp}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    win?.destroy(); server?.closeAllConnections(); server?.close(); app.exit(process.exitCode || 0);
});
