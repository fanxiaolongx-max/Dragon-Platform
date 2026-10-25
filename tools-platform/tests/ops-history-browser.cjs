/* Run: node_modules/.bin/electron tests/ops-history-browser.cjs */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-history-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
let win, server, failPage = false, holdPage = false, releasePage;
const saved = [];
const target = { channel: 'weixin', kind: 'user', id: 'alice', name: 'Alice' };
let records = Array.from({ length: 45 }, (_, index) => ({
    id: `run-${index}`, planId: 'plan-one', planName: `运营记录 ${index}`,
    trigger: 'schedule', status: index === 0 ? 'draft' : 'sent', content: `正文 ${index}`,
    createdAt: '2026-10-25T10:00:00Z', sentAt: index ? '2026-10-25T10:01:00Z' : null,
    targets: [target], results: [], meta: {}
}));
const plan = { id: 'plan-one', name: '每日运营', enabled: true, targets: [target], contentMode: 'template',
    template: '消息模板', sources: [], options: {}, schedule: { type: 'daily', times: ['09:30'], weekdays: [], workdaysOnly: true },
    scheduleText: '每天 09:30', sendMode: 'draft' };
const page = (value, size = 20) => {
    const totalPages = Math.max(1, Math.ceil(records.length / size));
    const current = Math.min(totalPages, Math.max(1, Number(value) || 1));
    return { items: records.slice((current - 1) * size, current * size), page: current, pageSize: size, total: records.length, totalPages };
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function until(code) {
    for (let index = 0; index < 150; index++) { if (await evaluate(code)) return; await wait(20); }
    throw new Error(`Timed out: ${code}`);
}
const current = n => until(`document.querySelector('[data-ops-runs-page]')?.value === '${n}' && document.querySelector('[data-role="ops-runs"]')?.getAttribute('aria-busy') === 'false'`);
const count = () => evaluate(`document.querySelectorAll('[data-role="ops-runs"] > .nch-access-col').length`);
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (selector, value) => evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); field.value = ${JSON.stringify(value)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const jump = n => evaluate(`(() => { const select = document.querySelector('[data-ops-runs-page]'); select.value = '${n}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);

app.whenReady().then(async () => {
    const web = express();
    web.use(express.json());
    const channelSource = fs.readFileSync(path.join(root, 'frontend/js/shared/channel-settings.js'), 'utf8');
    const style = channelSource.match(/style\.textContent = `([\s\S]*?)`;/)[1];
    web.get('/', (_, res) => res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/shared.css"><style>${style}</style><body style="margin:0;padding:12px"><main class="nch" id="root"></main><script>window.ToolsI18n={getLanguage:()=>window.language||'zh-CN'};window.showToast=text=>window.lastToast=text;</script><script src="/js/shared/channel-ops-settings.js"></script><script>ToolsChannelOps.render(document.getElementById('root'));</script>`));
    web.get('/api/channels/ops/overview', (req, res) => {
        const { items: runs, ...runsPagination } = page(req.query.runPage);
        res.json({ settings: { styleGuide: '规范', publicBaseUrl: '' }, groups: [{ ...target, profile: '', interactionPrompt: '' }], plans: [plan], runs, runsPagination, draftCounts: { 'plan-one': 1 } });
    });
    web.get('/api/channels/ops/library', (_, res) => res.json({ topics: [], angles: [], presets: [] }));
    web.get('/api/channels/ops/runs', async (req, res) => {
        if (holdPage) { holdPage = false; await new Promise(resolve => { releasePage = resolve; }); }
        if (failPage) return res.status(503).json({ error: 'network unavailable' });
        res.json(page(req.query.page));
    });
    web.put('/api/channels/ops/runs/:id', (req, res) => {
        saved.push({ id: req.params.id, content: req.body.content });
        const run = records.find(item => item.id === req.params.id);
        run.content = req.body.content;
        res.json(run);
    });
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}`);
    await current(1);
    assert.equal(await count(), 20);
    assert.equal(await evaluate(`document.querySelector('[data-ops-action="runs-page"][data-page="0"]').disabled`), true);
    await fill('[data-ops-field="styleGuide"]', '尚未保存的规范');
    await fill('[data-ops-group-field="profile"]', '尚未保存的画像');
    await fill('[data-ops-draft="run-0"]', '翻页后保留的正文');
    await click('[data-ops-action="new-plan"]');
    // 打开编辑器后再次输入，翻页只应替换记录卡片。
    await fill('[data-ops-plan="name"]', '尚未保存的计划');
    await fill('[data-ops-field="styleGuide"]', '尚未保存的规范');
    await fill('[data-ops-group-field="profile"]', '尚未保存的画像');
    await click('[data-ops-action="runs-page"][data-page="2"]');
    await current(2);
    assert.equal(await count(), 20);
    assert.equal(await evaluate(`document.querySelector('[data-ops-field="styleGuide"]').value`), '尚未保存的规范');
    assert.equal(await evaluate(`document.querySelector('[data-ops-group-field="profile"]').value`), '尚未保存的画像');
    assert.equal(await evaluate(`document.querySelector('[data-ops-plan="name"]').value`), '尚未保存的计划');
    await click('[data-ops-action="toggle-run"][data-id="run-20"]');
    assert.equal(await evaluate(`document.querySelector('[data-role="ops-runs"]').textContent.includes('正文 20')`), true);
    await click('[data-ops-action="runs-page"][data-page="3"]');
    await current(3);
    assert.equal(await count(), 5);
    assert.equal(await evaluate(`document.querySelector('[data-ops-action="runs-page"][data-page="4"]').disabled`), true);
    failPage = true;
    await click('[data-ops-action="refresh-runs"]');
    await until(`window.lastToast === 'network unavailable'`);
    await current(3);
    assert.equal(await count(), 5);
    failPage = false;
    await jump(1);
    await current(1);
    assert.equal(await evaluate(`document.querySelector('[data-ops-draft="run-0"]').value`), '翻页后保留的正文');
    await click('[data-ops-action="save-draft"][data-id="run-0"]');
    await until(`document.querySelector('[data-ops-action="save-draft"]').disabled === false`);
    assert.deepEqual(saved, [{ id: 'run-0', content: '翻页后保留的正文' }]);
    await jump(3);
    await current(3);
    records = records.slice(0, 35);
    await click('[data-ops-action="refresh-runs"]');
    await current(2);
    assert.equal(await count(), 15, 'refresh clamps a page removed by cleanup');

    holdPage = true;
    await jump(2);
    while (!releasePage) await wait(10);
    await evaluate(`ToolsChannelOps.render(document.getElementById('root'))`);
    await current(1);
    releasePage();
    await wait(100);
    await current(1);
    records = [];
    await click('[data-ops-action="refresh-runs"]');
    await current(1);
    assert.equal(await count(), 0);
    assert.equal(await evaluate(`document.querySelector('[data-role="ops-runs-pagination"]').textContent.includes('共 0 条')`), true);

    for (const width of [1300, 390]) {
        win.setSize(width, 900);
        for (const language of ['zh-CN', 'en-US']) {
            await evaluate(`window.language = '${language}'; ToolsChannelOps.render(document.getElementById('root'));`);
            await current(1);
            assert.equal(await evaluate(`(() => { const section = document.querySelector('[data-role="ops-runs"]'); return section.scrollWidth > section.clientWidth + 1; })()`), false);
        }
    }
    console.log('PASS ops history: pages, totals, draft/form preservation, save, failure recovery, page clamp, stale response, empty state, desktop/mobile and translations');
    server.close();
    app.exit(0);
}).catch(error => { console.error(error); server?.close(); app.exit(1); });
