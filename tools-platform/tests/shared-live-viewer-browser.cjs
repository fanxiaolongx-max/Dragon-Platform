// Run: node_modules/.bin/electron tests/shared-live-viewer-browser.cjs
// 共享对话实时围观（围观端）：真实的 dragon-claw.js + shared-conversations.js，/live 与历史接口由脚本模拟。
// 覆盖：实时提问 / 回答上屏、输入框锁定、结束后用落库消息替换（不重复）、断线解锁并重连、追流不重复、revoked 不再重连。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-live-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
setTimeout(() => { console.error('Shared live UI timed out'); app.exit(1); }, 60000).unref();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = read('frontend/index.html'), start = home.indexOf('<section class="dc"');
const section = home.slice(start, home.indexOf('</section>', start) + 10);
let win, server;
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);

app.whenReady().then(async () => {
    server = http.createServer((req, res) => {
        if (req.url.startsWith('/js/shared/pinyin-search.js')) { res.setHeader('Content-Type', 'text/javascript'); return res.end(read('frontend/js/shared/pinyin-search.js')); }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<style>${read('frontend/css/dragon-claw.css')}body{margin:0;font-family:system-ui}.dc{--navbar-h:0px;margin:20px}</style>${section}`);
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const rendererErrors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3) { rendererErrors.push(message); console.error('Renderer:', message); } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        localStorage.setItem('tools_token', 't');
        localStorage.setItem('tools_user', 'bob');
        window.locale = 'zh-CN';
        window.ToolsI18n = { getLanguage: () => locale };
        window.HomeWorkspace = { getTools: () => [] };
        window.ToolsAIAssistant = { requestStreamingChat: async () => ({ reply: '' }) };
        const author = { type: 'shared_author', author: 'alice', name: 'ALICE' };
        window.author = author;
        window.history_ = [
            { id: 'm1', role: 'user', content: '最早的问题', events: [], created_at: '2026-11-22T10:00:00Z' },
            { id: 'm2', role: 'model', content: '最早的回答', events: [], created_at: '2026-11-22T10:00:01Z' }
        ];
        window.liveCalls = 0; window.syncCalls = 0; window.lives = [];
        window.activeTurn = null;
        const enc = new TextEncoder();
        window.pushLive = event => lives.at(-1).ctl.enqueue(enc.encode(JSON.stringify(event) + '\\n'));
        window.closeLive = () => lives.at(-1).ctl.close();
        const json = (data, status = 200) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
        window.fetch = (url, options = {}) => {
            const u = String(url);
            if (u.endsWith('/api/shared-conversations/inbox')) return json({ items: [], skillRequests: [] });
            if (u.endsWith('/api/shared-conversations/mine')) return json({ items: [{ sessionId: 'S1', shareId: 'sh1', status: 'active', title: '共享评审', owner: 'alice', ownerName: 'ALICE', unread: 0, members: [{ username: 'alice', name: 'ALICE', role: 'owner', status: 'accepted' }, { username: 'bob', name: 'BOB', role: 'member', status: 'accepted' }] }] });
            if (u.endsWith('/api/shared-conversations/session/S1/live')) {
                liveCalls++;
                let ctl;
                const body = new ReadableStream({ start(c) { ctl = c; } });
                options.signal?.addEventListener('abort', () => { try { ctl.error(new DOMException('aborted', 'AbortError')); } catch {} });
                lives.push({ ctl });
                return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } }));
            }
            if (u.endsWith('/api/shared-conversations/session/S1/sync')) { syncCalls++; return json({ result: { shareId: 'sh1', pushed: 0, pulled: 0, closed: false, activeTurn } }); }
            if (u.includes('/api/shared-conversations/session/S1')) return json({ share: null });
            if (u.includes('/api/ai/sessions/S1/messages')) return json({ items: history_, hasMore: false });
            return json({ items: [], models: [] });
        };
        ${read('frontend/js/home/dragon-claw.js')}
        ${read('frontend/js/home/shared-conversations.js')}
        void 0;
    `);
    const waitFor = (expression, label = expression) => win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})resolve();else if(++n>300)reject(new Error(${JSON.stringify(label)}));else setTimeout(poll,20)};poll()})`);
    const thread = () => evaluate(() => {
        const nodes = [...document.querySelectorAll('#dcThread .dc-msg')];
        return nodes.map(node => ({ role: node.classList.contains('dc-msg--user') ? 'user' : 'ai', live: node.dataset.shcLive || '', text: node.querySelector('.dc-msg-body')?.textContent.trim() || '' }));
    });

    // 打开共享对话：历史渲染完后连上 /live
    await waitFor("window.HomeSharedConversations?.isShared?.('S1')", 'share list loaded');
    await evaluate(() => window.DragonClaw.openChat({ id: 'S1', title: '共享评审' }));
    await waitFor('liveCalls === 1', 'live connected after history renders');
    await waitFor("document.querySelectorAll('#dcThread .dc-msg').length === 2", 'history rendered');
    await pushLive();

    async function pushLive(event = { type: 'idle' }) { await evaluate(new Function(`pushLive(${JSON.stringify(event)})`)); }

    // Alice 开始提问：提问与实时回答上屏，输入框锁定并提示
    await pushLive({ type: 'stream_start', by: 'alice', name: 'ALICE', question: '新的问题', text: '', events: [] });
    await waitFor("document.querySelector('[data-shc-live=\"ai\"]') && document.querySelector('.dc-shared-busy-bar')", 'live bubble + busy bar');
    await pushLive({ type: 'delta', by: 'alice', delta: '第一段，' });
    await pushLive({ type: 'tool_start', by: 'alice', callId: 'c1', tool: 'read_file' });
    await pushLive({ type: 'delta', by: 'alice', delta: '第二段' });
    await waitFor("document.querySelector('[data-shc-live=\"ai\"] .dc-msg-body').textContent.includes('第一段，第二段')", 'deltas painted');
    let rows = await thread();
    assert.deepEqual(rows.slice(-2).map(row => [row.role, row.live]), [['user', 'user'], ['ai', 'ai']]);
    assert.equal(rows.at(-2).text, '新的问题');
    const locked = await evaluate(() => { const input = document.getElementById('dcInput'); input.value = '我也想问'; input.dispatchEvent(new Event('input', { bubbles: true })); return { disabled: document.getElementById('dcSend').disabled, placeholder: input.placeholder, bar: document.querySelector('.dc-shared-busy-bar').textContent }; });
    assert.equal(locked.disabled, true, 'send is locked while another member is asking');
    assert.match(locked.placeholder, /ALICE 正在提问/);
    assert.match(locked.bar, /ALICE/);

    // 这一轮结束：落库消息替换实时气泡，问题和回答都只出现一次；输入框解锁
    await evaluate(() => {
        history_.push({ id: 'm3', role: 'user', content: '新的问题', events: [author], created_at: '2026-11-22T10:01:00Z' });
        history_.push({ id: 'm4', role: 'model', content: '第一段，第二段。完整版', events: [author], created_at: '2026-11-22T10:01:05Z' });
    });
    await pushLive({ type: 'stream_finish', by: 'alice', text: '第一段，第二段。完整版' });
    await pushLive({ type: 'turn_ended', by: 'alice' });
    await waitFor("!document.querySelector('[data-shc-live]') && document.querySelectorAll('#dcThread .dc-msg').length === 4", 'live bubbles replaced by stored messages');
    rows = await thread();
    assert.deepEqual(rows.map(row => row.text.replace(/\s+/g, '')), ['最早的问题', '最早的回答', '新的问题', '第一段，第二段。完整版']);
    assert.equal(await evaluate(() => document.querySelector('.dc-shared-busy-bar')), null);
    assert.equal(await evaluate(() => document.getElementById('dcSend').disabled), false, 'send unlocked after the turn');

    // 断线：本地“有人在提问”立即解锁，并自动重连；重连后的追流只画一遍已生成的内容
    await pushLive({ type: 'stream_start', by: 'alice', name: 'ALICE', question: '第三个问题', text: '', events: [] });
    await waitFor("document.querySelector('.dc-shared-busy-bar')", 'busy again');
    await evaluate(() => closeLive());
    await waitFor("!document.querySelector('.dc-shared-busy-bar')", 'unlocked after disconnect');
    await waitFor('liveCalls === 2', 'reconnected after disconnect');
    await pushLive({ type: 'catchup', by: 'alice', name: 'ALICE', question: '第三个问题', text: '已生成的部分', events: [{ type: 'tool_start', callId: 'c2', tool: 'query_data' }] });
    await pushLive({ type: 'catchup', by: 'alice', name: 'ALICE', question: '第三个问题', text: '已生成的部分', events: [] });
    await waitFor("document.querySelector('[data-shc-live=\"ai\"] .dc-msg-body')?.textContent.includes('已生成的部分')", 'catch-up painted');
    rows = await thread();
    assert.equal(rows.filter(row => row.live === 'ai').length, 1);
    assert.equal(rows.find(row => row.live === 'ai').text, '已生成的部分', 'catch-up text is not duplicated');
    assert.equal(rows.filter(row => row.text === '第三个问题').length, 1, 'question shown once');

    // 被移出共享：收到 revoked 后不再重连
    await pushLive({ type: 'revoked' });
    await evaluate(() => closeLive());
    await new Promise(resolve => setTimeout(resolve, 3600));
    assert.equal(await evaluate(() => liveCalls), 2, 'no reconnect after revoked');

    assert.deepEqual(rendererErrors.filter(message => !/favicon|Failed to load resource/.test(message)), [], 'no renderer errors');
    console.log('shared live viewer UI ok');
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
