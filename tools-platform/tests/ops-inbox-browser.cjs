/* Run: node_modules/.bin/electron tests/ops-inbox-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-inbox-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server, failed = false, failRefresh = false, pendingResponse, holdRefresh = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(check, label) {
    for (let index = 0; index < 150; index++) { if (await check()) return; await wait(25); }
    throw new Error(`Timed out: ${label}`);
}
const makeDraft = (id, content = '大家好，今日功能亮点：一键生成月报。\n点击平台即可查看详情。') => ({ id, planName: `AI 月报 · ${id}`, content, status: 'draft', targets: [{ channel: 'welink', kind: 'group', id: 'group-a', name: '运营一群' }], createdAt: '2026-10-25T07:30:00Z' });
let drafts = [makeDraft('first'), makeDraft('second')];
const calls = [];
function reply(req, res) {
    const offset = Number(req.query.offset) || 0;
    res.json({ canManage: true, total: drafts.length, items: drafts.slice(offset, offset + 20), hasMore: offset + 20 < drafts.length, offset });
}
app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    const bootstrap = `<script>
        localStorage.setItem('tools_user','admin');localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_token','test');
        window.ToolsI18n={getLanguage:()=>localStorage.getItem('tools_lang')||'zh-CN',register(){}};
        window.HomeMode={set:()=>document.body.classList.add('home-mode-chat')};
    </script><script src="/js/shared/ops-inbox.js"></script>`;
    web.get('/', (_, res) => {
        let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        html = html.replace('<body class="home-mode-chat">', '<body class="home-mode-chat dc-chatting">');
        html = html.replace('</body>', `<script>dcThread.innerHTML='<p id="existing-message">已有对话保持原位</p>';</script>${bootstrap}</body>`);
        res.type('html').send(html);
    });
    web.get('/tool', (_, res) => res.type('html').send(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><h1>其他工具</h1><button id="work-button">当前操作</button>${bootstrap}</body></html>`));
    web.get('/priority', (_, res) => res.type('html').send(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/home-promo-video.css"></head><body><h1>工具与待办优先级</h1>${bootstrap}<script src="/js/home/promo-video.js"></script></body></html>`));
    web.get('/api/platform-promotions', (_, res) => res.json({ videos: ['rfc', 'incentive', 'eos', 'guide'].map(id => ({ id, enabled: false })), links: [{ id: 'demo', enabled: true, name: '推广信息', url: 'https://example.test/' }], maxLinks: 3 }));
    web.get('/api/platform-promotions/desktop', (_, res) => res.json({ available: false }));
    web.get('/frame', (_, res) => res.type('html').send(`<!doctype html><html><body><script src="/js/shared/ops-inbox.js"></script></body></html>`));
    web.get('/api/asset-version', (_, res) => res.json({ version: 'test-hash' }));
    web.get('/api/channels/ops/pending', (req, res) => {
        if (holdRefresh) { pendingResponse = { req, res }; return; }
        if (failRefresh) return res.status(503).json({ error: 'network unavailable' });
        reply(req, res);
    });
    web.put('/api/channels/ops/runs/:id', (req, res) => {
        const item = drafts.find(item => item.id === req.params.id);
        if (item.content !== req.body.expectedContent) return res.status(409).json({ error: '草稿已被修改或处理，请刷新后核对' });
        calls.push({ kind: 'save', ...req.body });
        item.content = req.body.content;
        res.json(item);
    });
    web.post('/api/channels/ops/runs/:id/send', async (req, res) => {
        calls.push({ kind: 'send', ...req.body });
        await wait(120);
        if (failed) return res.status(503).json({ error: '连接暂不可用' });
        const item = drafts.find(item => item.id === req.params.id);
        drafts = drafts.filter(entry => entry.id !== item.id);
        res.json({ ...item, content: req.body.content, status: 'sent' });
    });
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (_, level, message) => { if (level === 3 && !/status of (503|409|404)/.test(message)) errors.push(message); });
    await win.loadURL(base);
    await until(() => evaluate('!!document.querySelector(".ops-card")'), 'home cards');
    assert.equal(await evaluate('document.querySelector(".ops-home-inbox").open'), true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".ops-inbox-banner")).display'), 'none');
    assert.equal(await evaluate('document.getElementById("existing-message").textContent'), '已有对话保持原位');
    await evaluate('ToolsOpsInbox.open()');
    await evaluate('document.querySelector("[data-ops-card=first] [data-ops-inbox-action=edit]").click();let edit=document.querySelector("[data-ops-edit=first]");edit.value="修改后准备发送的正文";edit.dispatchEvent(new Event("input",{bubbles:true}));');
    await evaluate('ToolsOpsInbox.refresh()');
    assert.equal(await evaluate('document.querySelector("[data-ops-edit=first]").value'), '修改后准备发送的正文');
    failRefresh = true;
    await evaluate('ToolsOpsInbox.refresh()');
    assert.equal(await evaluate('document.querySelector("[data-ops-edit=first]").value'), '修改后准备发送的正文');
    failRefresh = false;
    await evaluate('document.querySelector("[data-ops-card=first] [data-ops-inbox-action=save]").click()');
    await until(() => calls.some(call => call.kind === 'save'), 'save request');
    await until(() => evaluate('document.querySelector(".ops-feedback").textContent.includes("修改已保存")'), 'save feedback');
    assert.equal(drafts[0].content, '修改后准备发送的正文');
    assert.equal(calls.filter(call => call.kind === 'send').length, 0);
    await evaluate('document.querySelector("[data-ops-card=first] [data-ops-inbox-action=send]").click();document.querySelector("[data-ops-card=first] [data-ops-inbox-action=send]").click()');
    await until(() => drafts.length === 1, 'draft sent');
    await until(() => evaluate('document.querySelectorAll(".ops-card").length===1'), 'sent card removed');
    assert.equal(calls.filter(call => call.kind === 'send').length, 1);
    assert.equal(calls.find(call => call.kind === 'send').content, '修改后准备发送的正文');
    assert.equal(await evaluate('document.getElementById("existing-message").textContent'), '已有对话保持原位');
    fs.writeFileSync(path.join(temp, 'home-dark.png'), (await win.webContents.capturePage()).toPNG());

    await win.loadURL(`${base}/tool`);
    await until(() => evaluate('!!document.querySelector(".ops-inbox-banner:not([hidden])")'), 'tool banner');
    await wait(600);
    fs.writeFileSync(path.join(temp, 'tool-banner.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-ops-inbox-action=review]").click()');
    assert.equal(await evaluate('document.querySelector("dialog").open'), true);
    failed = true;
    await evaluate('document.querySelector("[data-ops-inbox-action=send]").click()');
    await until(() => evaluate('document.querySelector(".ops-feedback").textContent.includes("连接暂不可用")'), 'failed send feedback');
    assert.equal(await evaluate('document.querySelectorAll(".ops-card").length'), 1);
    failed = false;
    // 其他标签页改正文时，本地编辑保留，并要求核对最新正文。
    await evaluate('document.querySelector("[data-ops-inbox-action=edit]").click();let edit=document.querySelector("[data-ops-edit]");edit.value="本地编辑保留";edit.dispatchEvent(new Event("input",{bubbles:true}));');
    drafts[0].content = '另一个标签页更新的正文';
    await evaluate('ToolsOpsInbox.refresh()');
    assert.equal(await evaluate('document.querySelector("[data-ops-edit]").value'), '本地编辑保留');
    assert.equal(await evaluate('document.querySelector("[data-ops-inbox-action=send]").disabled'), true);
    await evaluate('document.querySelector("[data-ops-inbox-action=latest]").click()');
    assert.equal(await evaluate('document.querySelector("[data-ops-edit]").value'), '另一个标签页更新的正文');

    win.setContentSize(390, 844);
    await evaluate('localStorage.setItem("tools_lang","en-US");window.dispatchEvent(new Event("tools:languagechange"))');
    assert.equal(await evaluate('document.querySelector(".ops-inbox-heading h3").textContent'), 'Messages to review');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
    fs.writeFileSync(path.join(temp, 'tool-light-mobile.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate('document.querySelector("[data-ops-inbox-action=close]").click();document.querySelector("[data-ops-inbox-action=mute]").click()');
    assert.equal(await evaluate('document.querySelector(".ops-inbox-banner").hidden'), true);
    await win.loadURL(`${base}/tool`);
    await until(() => evaluate('document.querySelectorAll(".ops-card").length===1'), 'dismissed inbox after navigation');
    assert.equal(await evaluate('document.querySelector(".ops-inbox-banner").hidden'), true);
    drafts.unshift(makeDraft('new'));
    await evaluate('ToolsOpsInbox.refresh()');
    assert.equal(await evaluate('document.querySelector(".ops-inbox-banner").hidden'), false);
    // 翻页可处理被运行历史挤出的旧草稿。
    drafts = Array.from({ length: 23 }, (_, index) => makeDraft(`page-${index}`));
    await evaluate('ToolsOpsInbox.refresh();');
    await evaluate('document.querySelector("[data-ops-inbox-action=review]").click();document.querySelector("[data-ops-inbox-action=next]").click()');
    await until(() => evaluate('document.querySelectorAll(".ops-card").length===3'), 'second page');
    await evaluate('document.querySelector("[data-ops-inbox-action=prev]").click()');
    await until(() => evaluate('document.querySelectorAll(".ops-card").length===20'), 'first page');

    // 旧租户请求的迟到响应不能恢复旧草稿。
    holdRefresh = true;
    await evaluate('ToolsOpsInbox.refresh();void 0');
    await until(() => Boolean(pendingResponse), 'held request');
    const stale = pendingResponse;
    holdRefresh = false;
    drafts = [];
    await evaluate('localStorage.setItem("tools_tenant_id","other");window.dispatchEvent(new StorageEvent("storage",{key:"tools_tenant_id"}));');
    await until(() => evaluate('document.querySelector(".ops-inbox-banner").hidden'), 'tenant reset');
    stale.res.json({ canManage: true, total: 1, items: [makeDraft('old-tenant')], hasMore: false });
    await wait(100);
    assert.equal(await evaluate('document.querySelector(".ops-inbox-banner").hidden'), true);
    assert.equal(await evaluate('document.body.textContent.includes("old-tenant")'), false);
    await evaluate('let frame=document.createElement("iframe");frame.src="/frame";document.body.append(frame)');
    await until(() => evaluate('!!document.querySelector("iframe").contentDocument?.body'), 'iframe');
    assert.equal(await evaluate('!!document.querySelector("iframe").contentDocument.querySelector(".ops-inbox-banner")'), false);
    // 多条待办只占一个横幅；推广自动避让，清空后恢复先前的展开/收起状态。
    await win.loadURL(`${base}/priority`);
    await until(() => evaluate('!!document.querySelector("#nrvFloat:not([hidden])")'), 'promotions initially visible');
    const promotionVisibility = () => evaluate('getComputedStyle(document.querySelector("#nrvStack")).visibility');
    assert.equal(await promotionVisibility(), 'visible');
    drafts = Array.from({ length: 25 }, (_, index) => makeDraft(`priority-${index}`));
    await evaluate('ToolsOpsInbox.refresh()');
    await until(async () => await promotionVisibility() === 'hidden', 'promotions yield to pending messages');
    assert.equal(await evaluate('document.querySelectorAll(".ops-inbox-banner").length'), 1);
    assert.equal(await evaluate('document.querySelector(".ops-banner-copy b").textContent.includes("25")'), true);
    assert.equal(await evaluate('document.querySelector("#nrvStack").inert && document.querySelector("#nrvTab").inert'), true);
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#nrvTab")).visibility'), 'hidden');
    await evaluate('ToolsOpsInbox.open()');
    assert.equal(await evaluate('document.querySelectorAll(".ops-card").length'), 20);
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".ops-card")).every((card,index,cards)=>!index||card.getBoundingClientRect().top>=cards[index-1].getBoundingClientRect().bottom)'), true);
    await evaluate('document.querySelector("[data-ops-inbox-action=close]").click();document.querySelector("[data-ops-inbox-action=mute]").click()');
    assert.equal(await promotionVisibility(), 'hidden', 'dismissing the banner does not bring promotions over pending work');
    drafts = [];
    await evaluate('ToolsOpsInbox.refresh()');
    await until(async () => await promotionVisibility() === 'visible', 'promotions restored after last draft');
    assert.equal(await evaluate('document.querySelector("#nrvStack").inert'), false);
    await evaluate('document.body.dispatchEvent(new Event("pointerdown",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("#nrvStack").classList.contains("is-tucked")'), true);
    drafts = [makeDraft('priority-new')];
    await evaluate('ToolsOpsInbox.refresh()');
    await until(() => evaluate('getComputedStyle(document.querySelector("#nrvTab")).visibility==="hidden"'), 'tucked promotion tab also hidden');
    drafts = [];
    await evaluate('ToolsOpsInbox.refresh()');
    await until(() => evaluate('getComputedStyle(document.querySelector("#nrvTab")).visibility==="visible"'), 'original tucked tab restored');
    assert.equal(await evaluate('document.querySelector("#nrvStack").classList.contains("is-tucked")'), true);
    assert.deepEqual(errors, []);
    console.log(`Ops inbox browser checks passed. Screenshots: ${temp}`);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { win?.destroy(); server?.close(); app.exit(process.exitCode || 0); });
