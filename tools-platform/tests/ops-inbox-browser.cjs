/* Run: node_modules/.bin/electron tests/ops-inbox-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-ops-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server, failSend = false, failRefresh = false, canSend = true, holdManual = false, releaseManual;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`Browser evaluation failed: ${code}`, { cause: error }); });
async function until(check, label) { for (let n = 0; n < 180; n++) { if (await check()) return; await wait(25); } throw new Error(`Timed out: ${label}`); }
const GROUP = { channel: 'welink', kind: 'group', id: 'group-a', name: '运营一群' };
const ALICE = { channel: 'weixin', kind: 'user', id: 'alice', name: 'Alice' };
const key = target => `${target.channel}|${target.kind}|${target.id}`;
const histories = new Map([[key(GROUP), []], [key(ALICE), []]]);
let messageId = 0;
function append(target, content, source = '') { histories.get(key(target)).push({ id: String(++messageId), role: 'model', content, sessionId: `session-${key(target)}`, createdAt: '2026-10-25T08:00:00Z', ...(source ? { push: { source } } : {}) }); }
append(GROUP, 'WeLink 原有对话'); append(ALICE, '微信原有对话');
const draft = (id, targets = [GROUP]) => ({ id, targets, planName: `运营草稿 ${id}`, content: `消息正文 ${id}`, status: 'draft', createdAt: '2026-10-25T07:30:00Z' });
const longContent = Array.from({ length: 30 }, (_, index) => `${index + 1}. 月报亮点：核对完整正文和收件对象后发送。`).join('\n') + '\nhttps://example.test/' + 'long-message-link/'.repeat(30);
let drafts = [draft('broadcast', [GROUP, ALICE]), draft('wechat', [ALICE])].map(item => ({ ...item, content: longContent }));
const manualCalls = [], opsCalls = [];
const active = () => evaluate('HomeWelinkThreads.active()');
const open = target => evaluate(`HomeWelinkThreads.open(${JSON.stringify(target)});void 0`);
const review = () => evaluate('ToolsOpsInbox.open()');
const fillManual = text => evaluate(`(()=>{const input=document.querySelector('[data-wl-compose]');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const bot = async () => { await evaluate('document.querySelector("[data-wl-role=bot]").click()'); await until(() => evaluate('!!document.querySelector("[data-wl-compose]")'), 'Bot composer after role switch'); };
async function checkReviewLayout() {
    const layout = await evaluate(`(() => {
        const panel = document.querySelector('.ops-inbox-panel');
        const preview = panel.querySelector('.ops-preview');
        const bounds = panel.getBoundingClientRect();
        const thread = dcThread.getBoundingClientRect();
        return {
            centered: Math.abs(bounds.left + bounds.right - thread.left - thread.right) < 2,
            contained: bounds.left >= thread.left && bounds.right <= thread.right,
            threadScrolls: dcThread.scrollHeight > dcThread.clientHeight,
            nestedScrollers: [panel, ...panel.querySelectorAll('*')].filter(node => /^(auto|scroll)$/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).map(node => node.className),
            fullPreview: preview.clientHeight > 260 && preview.scrollHeight <= preview.clientHeight + 1,
            wrapsLinks: preview.scrollWidth <= preview.clientWidth + 1,
            pageFits: document.documentElement.scrollWidth <= innerWidth
        };
    })()`);
    assert.deepEqual(layout, { centered: true, contained: true, threadScrolls: true, nestedScrollers: [], fullPreview: true, wrapsLinks: true, pageFits: true }, 'review is centered in its conversation and long messages use only the conversation scrollbar');
}
app.whenReady().then(async () => {
    const web = express(); web.use(express.json());
    const storage = `<script>localStorage.setItem('tools_user','admin');localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_token','test');</script>`;
    web.get('/', (req, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        html = html.replace('</body>', `${storage}<script src="/js/shared/i18n.js"></script><script src="/js/home/home-mode.js"></script><script src="/js/home/dragon-claw.js"></script><script src="/js/home/welink-threads.js"></script><script src="/js/shared/ops-inbox.js"></script>${req.query.promos ? '<script src="/js/home/promo-video.js"></script>' : ''}</body>`);
        res.type('html').send(html);
    });
    web.get('/tool', (_, res) => res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>其他工具${storage}<script src="/js/shared/ops-inbox.js"></script></body></html>`));
    web.get('/api/ai/models', (_, res) => res.json({ models: [] }));
    web.get('/api/ai/sessions', (_, res) => res.json({ items: [] }));
    web.get('/api/channels/available', (_, res) => res.json({ items: [{ id: 'welink' }, { id: 'weixin' }] }));
    web.get('/api/channels/:channel/threads', (req, res) => res.json({ items: [GROUP, ALICE].filter(item => item.channel === req.params.channel).map(item => ({ ...item, messageCount: histories.get(key(item)).length })) }));
    web.get('/api/channels/:channel/threads/:kind/:id/messages', (req, res) => {
        const target = [GROUP, ALICE].find(item => key(item) === key(req.params)) || req.params;
        res.json({ thread: target, items: histories.get(key(target)) || [], segments: [], hasMore: false, canSend: canSend && !(target.channel === 'weixin' && target.kind === 'group') });
    });
    web.get('/api/channels/:channel/threads/:kind/:id/followups', (_, res) => res.json({ items: [], canManage: true }));
    web.get('/api/channels/ops/pending', (req, res) => {
        if (failRefresh) return res.status(503).json({ error: 'network unavailable' });
        const offset = Number(req.query.offset) || 0;
        res.json({ canManage: true, items: drafts.slice(offset, offset + 20), total: drafts.length, hasMore: offset + 20 < drafts.length, offset });
    });
    web.put('/api/channels/ops/runs/:id', (req, res) => {
        const item = drafts.find(item => item.id === req.params.id);
        if (req.body.expectedContent !== item.content) return res.status(409).json({ error: '草稿已被修改' });
        item.content = req.body.content; res.json(item);
    });
    web.post('/api/channels/ops/runs/:id/send', async (req, res) => {
        opsCalls.push(req.body); await wait(80);
        if (failSend) return res.status(503).json({ error: '连接暂不可用' });
        const item = drafts.find(item => item.id === req.params.id);
        if (req.body.expectedContent !== item.content) return res.status(409).json({ error: '草稿已被修改' });
        item.targets.forEach(target => append(target, req.body.content, `ops:${item.planName}`));
        drafts = drafts.filter(entry => entry.id !== item.id);
        res.json({ ...item, status: 'sent' });
    });
    web.post('/api/channels/:channel/push', async (req, res) => {
        manualCalls.push({ channel: req.params.channel, ...req.body });
        if (holdManual) await new Promise(resolve => { releaseManual = resolve; }); else await wait(100);
        if (!canSend) return res.status(403).json({ error: '无发送权限' });
        const target = { channel: req.params.channel, ...req.body.targets[0] };
        if (failSend) return res.json({ ok: false, results: [{ ...target, ok: false, error: '连接暂不可用' }] });
        append(target, req.body.text, 'manual-bot:admin');
        res.json({ ok: true, sent: 1, results: [{ ...target, ok: true }] });
    });
    web.get('/api/platform-promotions', (_, res) => res.json({ videos: ['rfc', 'incentive', 'eos', 'guide'].map(id => ({ id, enabled: false })), links: [{ id: 'demo', enabled: true, name: '推广信息', url: 'https://example.test/' }] }));
    web.get('/api/platform-promotions/desktop', (_, res) => res.json({ available: false }));
    web.get('/api/asset-version', (_, res) => res.json({ version: 'test' }));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3 && !/status of (503|409|404)/.test(message)) errors.push(message); });
    await win.loadURL(base);
    await until(() => evaluate('document.querySelector(".ops-home-inbox:not([hidden])")?.getBoundingClientRect().height>=30'), 'compact home reminder');
    assert.equal(await evaluate('document.querySelectorAll(".ops-card,.ops-inbox-panel").length'), 0);
    await wait(180); fs.writeFileSync(path.join(temp, 'home.png'), (await win.webContents.capturePage()).toPNG());
    await review();
    assert.equal((await active()).channel, 'welink');
    assert.equal((await active()).id, GROUP.id);
    assert.equal(await evaluate('dcThread.textContent.includes("WeLink 原有对话")'), true, 'reminder opens the actual WeLink conversation');
    assert.equal(await evaluate('document.querySelectorAll(".ops-card").length'), 1, 'only drafts addressing this conversation are displayed');
    assert.equal(await evaluate('document.querySelector(".ops-recipients").textContent.includes("Alice")'), true, 'broadcast lists every recipient');
    await checkReviewLayout();
    await wait(180); fs.writeFileSync(path.join(temp, 'welink-draft.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(1366, 768);
    await review();
    await checkReviewLayout();
    await wait(180);
    fs.writeFileSync(path.join(temp, 'welink-laptop.png'), (await win.webContents.capturePage()).toPNG());
    win.setContentSize(1440, 950);
    assert.equal(await evaluate('document.body.classList.contains("ops-reviewing")'), false, 'no separate confirmation conversation');
    await until(() => evaluate('!!document.querySelector("[data-wl-role=bot]")'), 'Bot role switch');
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-compose]").length'), 0, 'role switch is explicit');
    await bot(); await fillManual('WeLink 手动消息');
    await evaluate('document.querySelector("[data-wl-send]").click();document.querySelector("[data-wl-send]").click()');
    await until(() => evaluate('dcThread.textContent.includes("WeLink 手动消息")'), 'manual message appears in WeLink timeline');
    assert.equal(manualCalls.length, 1);
    assert.deepEqual(manualCalls[0].targets, [{ kind: 'group', id: GROUP.id }]);
    assert.equal(manualCalls[0].source, 'manual-bot');
    assert.equal(await evaluate('dcThread.textContent.includes("手动运营")'), true);
    await evaluate('document.querySelector("[data-ops-inbox-action=edit]").click();let edit=document.querySelector("[data-ops-edit]");edit.value="运营草稿修改保留";edit.dispatchEvent(new Event("input",{bubbles:true}));edit.setSelectionRange(2,5)');
    append(GROUP, '收到新的群消息');
    await evaluate('HomeWelinkThreads.refresh()');
    assert.equal(await evaluate('document.querySelector("[data-ops-edit]").value'), '运营草稿修改保留');
    assert.equal(await evaluate('document.querySelector("[data-ops-edit]").selectionStart'), 2);
    await evaluate('ToolsOpsInbox.refresh()');
    assert.equal(await evaluate('document.activeElement===document.querySelector("[data-ops-edit]")'), true, 'background refresh preserves editing focus');
    failRefresh = true; await evaluate('ToolsOpsInbox.refresh()'); failRefresh = false;
    assert.equal(await evaluate('document.querySelector("[data-ops-edit]").value'), '运营草稿修改保留');
    await evaluate('document.querySelector("[data-ops-inbox-action=save]").click()');
    await until(() => drafts[0].content === '运营草稿修改保留', 'saved draft is not sent');
    assert.equal(opsCalls.length, 0);
    await until(() => evaluate('!document.querySelector("[data-ops-inbox-action=send]").disabled'), 'draft unlocked');
    await evaluate('document.querySelector("[data-ops-inbox-action=send]").click()');
    await until(() => drafts.length === 1, 'broadcast sent');
    assert.equal(histories.get(key(ALICE)).some(item => item.content === '运营草稿修改保留'), true);
    assert.equal((await active()).channel, 'welink', 'sending does not leave the actual channel conversation');
    await until(() => evaluate('!!document.querySelector("[data-ops-thread]")'), 'pending conversation selector');
    await evaluate(`let choice=document.querySelector('[data-ops-thread]');choice.value=${JSON.stringify(JSON.stringify([ALICE.channel, ALICE.kind, ALICE.id]))};choice.dispatchEvent(new Event('change',{bubbles:true}));`);
    await until(async () => (await active())?.channel === 'weixin' && await evaluate('!!document.querySelector("[data-ops-card=wechat]")'), 'next pending draft opens WeChat');
    assert.equal(await evaluate('dcThread.textContent.includes("微信原有对话")'), true);
    await bot(); await fillManual('微信手动消息');
    failSend = true;
    await evaluate('document.querySelector("[data-wl-send]").click()');
    await until(() => evaluate('!!document.querySelector(".wl-send-feedback.is-error")'), 'failure feedback');
    assert.equal(await evaluate('document.querySelector("[data-wl-compose]").value'), '微信手动消息');
    failSend = false;
    await evaluate('document.querySelector("[data-wl-send]").click()');
    await until(() => evaluate('dcThread.textContent.includes("微信手动消息")'), 'manual WeChat send');
    assert.equal(manualCalls.at(-1).channel, 'weixin');
    assert.deepEqual(manualCalls.at(-1).targets, [{ kind: 'user', id: ALICE.id }]);
    await fillManual('微信未发送草稿');
    await open(GROUP); await until(() => evaluate('!!document.querySelector("[data-wl-role=bot]")'), 'WeLink reopened');
    await bot(); await fillManual('群聊未发送草稿');
    await open(ALICE); await until(() => evaluate('!!document.querySelector("[data-wl-role=bot]")'), 'WeChat reopened');
    await bot();
    assert.equal(await evaluate('document.querySelector("[data-wl-compose]").value'), '微信未发送草稿', 'composer text is isolated by conversation');
    // 请求进行中切换会话，不把原消息发给新对象，也不清除新对象的正文。
    await open(GROUP); await until(() => evaluate('!!document.querySelector("[data-wl-role=bot]")'), 'WeLink for race'); await bot();
    holdManual = true;
    await evaluate('document.querySelector("[data-wl-send]").click()');
    await until(() => Boolean(releaseManual), 'manual send held');
    await open(ALICE); await until(() => evaluate('!!document.querySelector("[data-wl-role=bot]")'), 'switch during send'); await bot();
    releaseManual(); holdManual = false;
    await until(() => evaluate('!document.querySelector("[data-wl-send]").disabled'), 'send lock released');
    assert.equal(manualCalls.at(-1).channel, 'welink');
    assert.equal(await evaluate('document.querySelector("[data-wl-compose]").value'), '微信未发送草稿');
    assert.equal(histories.get(key(ALICE)).some(item => item.content === '群聊未发送草稿'), false);
    canSend = false; await evaluate('HomeWelinkThreads.refresh()');
    assert.equal(await evaluate('document.querySelectorAll("[data-wl-role],[data-wl-compose]").length'), 0, 'revoked permission returns to view only');
    canSend = true; await evaluate('HomeWelinkThreads.refresh()');
    await bot();
    win.setContentSize(390, 844);
    await evaluate('document.documentElement.dataset.theme="light";ToolsI18n.setLanguage("en-US")');
    await evaluate('document.querySelector("[data-wl-role=view]").click()');
    await review();
    await checkReviewLayout();
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
    await wait(180);
    fs.writeFileSync(path.join(temp, 'wechat-mobile.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-ops-inbox-action=send]").click()');
    await until(() => drafts.length === 0, 'last draft sent');
    await until(() => evaluate('document.querySelectorAll(".ops-inbox-panel").length===0'), 'empty draft panel disappears');
    assert.equal((await active()).channel, 'weixin');
    assert.equal(await evaluate('document.body.classList.contains("dc-external-view")'), true, 'channel remains open after last confirmation');
    assert.equal(await evaluate('document.querySelector(".ops-inbox-banner").hidden'), true);
    await evaluate('DragonClaw.newChat()');
    assert.equal(await evaluate('dcInput.disabled'), false);
    assert.equal(await evaluate('document.querySelectorAll(".wl-readonly").length'), 0);

    drafts = Array.from({ length: 23 }, (_, index) => draft(`page-${index}`));
    await win.loadURL(`${base}/tool`);
    await until(() => evaluate('!!document.querySelector(".ops-inbox-banner:not([hidden])")'), 'global reminder');
    await evaluate('document.querySelector("[data-ops-inbox-action=review]").click()');
    await until(() => evaluate('!!document.querySelector("[data-ops-card=page-0]")'), 'global reminder routes into actual WeLink conversation');
    assert.equal((await active()).id, GROUP.id);
    assert.equal(await evaluate('document.querySelectorAll(".ops-card").length'), 20);
    await evaluate('document.querySelector("[data-ops-inbox-action=next]").click()');
    await until(() => evaluate('document.querySelectorAll(".ops-card").length===3'), 'older drafts accessible');
    drafts = []; await evaluate('ToolsOpsInbox.refresh()');
    assert.equal((await active()).id, GROUP.id);
    // 租户切换清除旧会话与尚未发送的正文。
    await bot(); await fillManual('旧租户正文');
    await evaluate('localStorage.setItem("tools_tenant_id","other");window.dispatchEvent(new StorageEvent("storage",{key:"tools_tenant_id"}));');
    assert.equal(await active(), null);
    await open(GROUP); await until(() => evaluate('!!document.querySelector("[data-wl-role=bot]")'), 'new tenant thread'); await bot();
    assert.equal(await evaluate('document.querySelector("[data-wl-compose]").value'), '');
    await win.loadURL(`${base}/?promos=1`);
    await until(() => evaluate('!!document.querySelector("#nrvFloat:not([hidden])")'), 'promotion ready');
    drafts = [draft('promo-check')];
    await evaluate('ToolsOpsInbox.refresh()');
    await until(() => evaluate('getComputedStyle(nrvStack).visibility==="hidden"'), 'pending work hides promotions');
    drafts = []; await evaluate('ToolsOpsInbox.refresh()');
    await until(() => evaluate('getComputedStyle(nrvStack).visibility==="visible"'), 'promotion restores after pending work');
    assert.deepEqual(errors, []);
    console.log(`Channel operations browser checks passed. Screenshots: ${temp}`);
}).catch(async error => { console.error(error); if (win) console.error(await evaluate('document.querySelector(".wl-readonly")?.outerHTML')); process.exitCode = 1; }).finally(() => { win?.destroy(); server?.close(); app.exit(process.exitCode || 0); });
