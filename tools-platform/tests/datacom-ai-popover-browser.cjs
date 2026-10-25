// Isolated public fixture + fake NDJSON; no AI provider calls or tenant databases.
// node_modules/.bin/electron tests/datacom-ai-popover-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '../backend/builtin-tools/datacom-protocol-expert');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'datacom-ai-popover-'));
app.setPath('userData', path.join(temp, 'profile'));
const seed = require(path.join(root, 'knowledge-seed.json'));
const article = { ...seed.articles[0], id: 'popover-regression', title: '浮窗布局验证', visuals: [], tags: [], keyPoints: [], aiFields: [],
    bodyMd: '# 浮窗布局验证\n\n## 报文检查\n\n```text\nR1 -> R2：发送报文\n核对邻居状态\n检查区域属性\n检查接口计时器\n检查认证方式\n最后观察重传\n```' };
let win, server, calls = [], saved = [], liveTimers = new Set();
const errors = [];
const evaluate = (fn, ...args) => win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
    for (let i = 0; i < 250; i++) { if (await evaluate(fn)) return; await wait(30); }
    throw Error('Timed out: ' + fn);
}
async function shot(name) {
    if (!process.env.DATACOM_AI_SHOTS) return;
    fs.mkdirSync(process.env.DATACOM_AI_SHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.DATACOM_AI_SHOTS, name + '.png'), (await win.webContents.capturePage()).toPNG());
}
async function open() {
    await evaluate(() => document.querySelector('[data-block-ai="qa"][data-kind="code"]').click());
    await until(() => !!document.querySelector('.dk-ai-pop textarea'));
    await wait(220);
}
async function geometry() {
    return evaluate(() => {
        const pop = document.querySelector('.dk-ai-pop'), q = pop.querySelector('.dk-ai-quote'), context = pop.querySelector('.dk-ai-context');
        const out = pop.querySelector('.dk-ai-output'), input = pop.querySelector('textarea'), button = pop.querySelector('.dk-ai-ask button');
        const r = pop.getBoundingClientRect();
        return { quote: q.getBoundingClientRect().height, context: context.getBoundingClientRect().height,
            width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
            input: input.getBoundingClientRect().height, button: button.getBoundingClientRect().height, inputBottom: input.getBoundingClientRect().bottom, buttonBottom: button.getBoundingClientRect().bottom,
            scroll: out.scrollHeight, client: out.clientHeight, backdrop: getComputedStyle(pop).backdropFilter };
    });
}
app.whenReady().then(async () => {
    const web = express(); web.use(express.json());
    web.get('/api/datacom-knowledge', (_req, res) => res.json({ ...seed, articles: [article], canWrite: false, tenantId: 'fixture', username: 'test' }));
    web.get('/api/datacom-knowledge/articles/:id', (_req, res) => res.json({ article }));
    web.get('/api/datacom-knowledge/ai/status', (_req, res) => res.json({ available: true }));
    web.get('/api/datacom-knowledge/annotations', (_req, res) => res.json({ annotations: saved }));
    web.post('/api/datacom-knowledge/ai/ask', (req, res) => {
        calls.push(req.body); res.set('Content-Type', 'application/x-ndjson');
        let i = 0, answer = '';
        const timer = setInterval(() => {
            const text = `\n\n**第 ${++i} 步：检查邻接条件。** 先确认双方的参数一致，再观察报文的发送和确认。长回答应在下方独立滚动，引用与提问输入保持可见。`;
            answer += text; res.write(JSON.stringify({ type: 'delta', text }) + '\n');
            if (i === 24) {
                clearInterval(timer); liveTimers.delete(timer);
                const previous = saved.find(x => x.id === req.body.annotationId);
                const annotation = { id: previous?.id || 'popover-answer', articleId: article.id, kind: 'qa', anchor: req.body.anchor,
                    quote: req.body.quote, title: '报文检查与常见问题', brief: '一段用于验证流式布局的长回答。',
                    turns: [...(previous?.turns || []), { q: req.body.question, a: answer }], createdBy: 'test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                saved = [annotation]; res.end(JSON.stringify({ type: 'done', annotation }) + '\n');
            }
        }, 70);
        liveTimers.add(timer); res.on('close', () => { clearInterval(timer); liveTimers.delete(timer); });
    });
    web.use(express.static(root));
    server = await new Promise(resolve => { const s = web.listen(0, '127.0.0.1', () => resolve(s)); });
    win = new BrowserWindow({ show: false, width: 1500, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !message.includes('Content-Security-Policy')) errors.push(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html#/a/${article.id}`);
    await until(() => !!document.querySelector('[data-block-ai="qa"][data-kind="code"]'));
    await evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await open();
    const initial = await geometry();
    assert.equal(initial.width, 680); assert.equal(initial.height, 620);
    assert.equal(initial.input, 36); assert.equal(initial.button, 36); assert.notEqual(initial.backdrop, 'none');
    await evaluate(() => {
        const input = document.querySelector('.dk-ai-pop textarea'); input.value = '为什么会卡在 ExStart？';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
    });
    await until(() => document.querySelector('.dk-ai-output')?.scrollHeight > 1000);
    const streaming = await geometry();
    assert.equal(streaming.quote, initial.quote); assert.equal(streaming.context, initial.context);
    await evaluate(() => { document.querySelector('.dk-ai-output').scrollTop = 0; }); await wait(250);
    assert.equal(await evaluate(() => document.querySelector('.dk-ai-output').scrollTop), 0, 'reading earlier content must not be forced to the end');
    await until(() => !!document.querySelector('.dk-ai-pop .dk-ai-foot:not([hidden]) [data-open]'));
    const done = await geometry();
    assert.equal(calls.length, 1, 'keyboard shortcut must not duplicate requests');
    assert.equal(done.quote, initial.quote); assert.equal(done.context, initial.context);
    assert.ok(done.scroll > done.client); assert.equal(await evaluate(() => !!document.querySelector('.dk-ai-pop [data-follow]')), false);
    // The entire top region stays still when only the answer is scrolled.
    await evaluate(() => { document.querySelector('.dk-ai-output').scrollTop = 800; });
    assert.equal((await geometry()).quote, initial.quote);
    await shot('light-long-answer');
    const handle = await evaluate(() => { const r = document.querySelector('[data-pop-resize]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(handle.x), y: Math.round(handle.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(handle.x + 120), y: Math.round(handle.y + 80) });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(handle.x + 120), y: Math.round(handle.y + 80), button: 'left', clickCount: 1 });
    await wait(100);
    const resized = await geometry(); assert.ok(resized.width > done.width + 80); assert.ok(resized.height > done.height + 40);
    await evaluate(() => document.querySelector('.dk-ai-pop [data-open]').click());
    assert.equal(await evaluate(() => !!document.querySelector('.dk-ai-pop')), false);
    assert.equal(await evaluate(() => document.querySelector('#aiPanel').hidden), false);
    assert.equal(await evaluate(() => document.querySelector('#aiPanel [data-item="popover-answer"]').classList.contains('is-open')), true);
    await open();
    await evaluate(() => { const i = document.querySelector('.dk-ai-pop textarea'); i.value = '再举个例子'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })); });
    await wait(100); assert.equal(calls.length, 1, 'IME confirmation must not send a question');
    await evaluate(() => document.querySelector('.dk-ai-pop textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })));
    await until(() => !!document.querySelector('.dk-ai-pop .dk-ai-foot:not([hidden]) [data-open]'));
    assert.equal(calls.length, 2);
    await evaluate(() => { document.querySelector('.dk-ai-pop textarea').value = '继续解释'; document.querySelector('.dk-ai-ask').requestSubmit(); });
    await until(() => !!document.querySelector('.dk-ai-pop .dk-ai-foot:not([hidden]) [data-open]'));
    assert.equal(calls.length, 3); assert.equal(calls[2].annotationId, 'popover-answer');
    await evaluate(() => document.querySelector('.dk-ai-pop [data-open]').click());
    assert.equal(await evaluate(() => !!document.querySelector('.dk-ai-pop')), false, 'also close when sidebar was already open');
    await open();
    await evaluate(() => { document.documentElement.dataset.theme = 'dark'; document.querySelector('.dk-ai-pop textarea').value = '保留我的问题原文'; document.querySelector('#langBtn').click(); });
    await wait(100);
    assert.equal(await evaluate(() => document.querySelector('.dk-ai-pop [data-pop-resize]').getAttribute('aria-label')), 'Resize the AI question window');
    assert.equal(await evaluate(() => document.querySelector('.dk-ai-pop textarea').getAttribute('aria-label')), 'Ask a question or follow up');
    assert.equal(await evaluate(() => document.querySelector('.dk-ai-pop textarea').value), '保留我的问题原文', 'language switch must preserve typed input');
    await evaluate(() => document.querySelector('.dk-ai-ask').requestSubmit());
    await until(() => !!document.querySelector('.dk-ai-pop .dk-ai-foot:not([hidden]) [data-open]'));
    assert.equal(calls[3].language, 'en');
    assert.equal(await evaluate(() => document.querySelector('.dk-ai-panel-ask textarea').placeholder), 'Ask about this article, or select text in the article to ask…');
    assert.equal(await evaluate(() => document.querySelector('.dk-ai-ask button').textContent), 'Send');
    await shot('dark-english');
    for (const size of [[390, 700], [740, 360]]) {
        win.setSize(...size); await wait(200);
        const g = await geometry();
        const viewport = await evaluate(() => ({ w: innerWidth, h: innerHeight }));
        assert.ok(g.left >= 11 && g.top >= 11 && g.right <= viewport.w - 11 && g.bottom <= viewport.h - 11, JSON.stringify({ g, viewport }));
        assert.equal(g.input, 36); assert.equal(g.button, 36);
        assert.ok(g.inputBottom < g.bottom && g.buttonBottom < g.bottom, 'input and send remain visible');
        assert.ok(g.client > 40 && g.scroll > g.client, 'long answer keeps its own scroll area on narrow/short screens');
        await shot(`viewport-${size.join('x')}`);
    }
    win.setSize(1800, 1000); await wait(250);
    await evaluate(() => { document.querySelector('.dk-ai-pop [data-close]').click(); });
    await until(() => !!document.querySelector('.dk-ai-item.is-open .dk-ai-item-actions'));
    const panelCheck = await evaluate(() => {
        const list = document.querySelector('.dk-ai-list'), card = list.querySelector('.dk-ai-item');
        const header = document.querySelector('.dk-ai-head').getBoundingClientRect().top;
        list.scrollTop = list.scrollHeight;
        const actions = card.querySelector('.dk-ai-item-actions').getBoundingClientRect(), r = list.getBoundingClientRect();
        return { scroll: list.scrollHeight, client: list.clientHeight, card: card.clientHeight, content: card.scrollHeight,
            actionsBottom: actions.bottom, bottom: r.bottom, top: r.top, actionsTop: actions.top,
            header, headerAfter: document.querySelector('.dk-ai-head').getBoundingClientRect().top };
    });
    assert.ok(panelCheck.scroll > panelCheck.client + 1000, JSON.stringify(panelCheck));
    assert.ok(panelCheck.content <= panelCheck.card + 2, 'expanded card must not clip its answer');
    assert.ok(panelCheck.actionsBottom <= panelCheck.bottom && panelCheck.actionsTop >= panelCheck.top, 'bottom actions reachable');
    assert.equal(panelCheck.header, panelCheck.headerAfter);
    await shot('sidebar-long-answer-bottom');
    await evaluate(() => { document.querySelector('#aiPanelBtn').click(); }); await wait(400);
    const tocBefore = await evaluate(() => { const r = document.querySelector('.dk-toc-resize').getBoundingClientRect(); return { x: r.x + 7, y: r.y + 20, w: document.querySelector('#articleToc').getBoundingClientRect().width }; });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(tocBefore.x), y: Math.round(tocBefore.y), button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(tocBefore.x - 80), y: Math.round(tocBefore.y) });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(tocBefore.x - 80), y: Math.round(tocBefore.y), button: 'left', clickCount: 1 });
    await wait(150);
    const tocWidth = await evaluate(() => document.querySelector('#articleToc').getBoundingClientRect().width);
    assert.ok(tocWidth > tocBefore.w + 60, JSON.stringify({tocBefore, tocWidth}));
    await win.reload(); await until(() => !!document.querySelector('.dk-toc-resize')); await wait(200);
    assert.equal(await evaluate(() => document.querySelector('#articleToc').getBoundingClientRect().width), tocWidth, 'TOC width survives reload');
    await evaluate(() => document.querySelector('#aiPanelBtn').click()); await wait(400);
    assert.ok(await evaluate(() => document.querySelector('.dk-article').getBoundingClientRect().width >= 320), 'AI sidebar leaves readable article width');
    await shot('toc-resizable-with-sidebar');
    win.setSize(740, 700); await wait(200);
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('#articleToc')).display), 'none');
    assert.ok(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
    assert.deepEqual(errors, []);
    console.log('AI popover: stable context during long streams, independent scroll, compact input, pointer resize, IME/shortcuts, duplicate-send guard, follow-up, sidebar transfer, English, themes and narrow viewports passed.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
    for (const timer of liveTimers) clearInterval(timer);
    win?.destroy(); server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
