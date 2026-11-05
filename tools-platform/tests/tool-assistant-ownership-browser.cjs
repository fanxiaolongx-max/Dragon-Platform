// ./node_modules/.bin/electron tests/tool-assistant-ownership-browser.cjs
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-assistant-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
let win, server; const chats = [];
const evaluate = code => win.webContents.executeJavaScript(code, true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(code) { for (let n = 0; n < 200; n++) { if (await evaluate(code)) return; await wait(25); } throw Error('Timeout: ' + code); }
const watchdog = setTimeout(() => { console.error('Assistant ownership test timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
    const web = express(); web.use(express.json());
    const assistant = '<script src="/js/shared/ai-assistant.js"></script>';
    web.get('/', (_, res) => res.send(`<!doctype html><html data-ui="v2"><head><title>Home</title></head><body><main class="home-main"></main><script>window.HomeWorkspace={getTools:()=>[{href:'/tool',title:'Tool'}]};localStorage.setItem('tools_token','fixture');</script><script src="/js/home/tool-frame.js"></script>${assistant}</body></html>`));
    web.get('/tool', (_, res) => res.send(`<!doctype html><html><head><title>Tool</title></head><body><div class="page-content">Tool-specific content</div>
        <div role="dialog" aria-modal="true" hidden id="fixtureModal" style="position:fixed;inset:0;background:white">
        <p>Foreground dialog</p><input type="password" value="fixture-password"><p hidden>hidden detail</p></div>${assistant}</body></html>`));
    web.get('/late', (_, res) => res.send(`<!doctype html><html><head><title>Late</title></head><body>Late component<script>setTimeout(()=>{const s=document.createElement('script');s.src='/js/shared/ai-assistant.js';document.body.append(s)},200)</script></body></html>`));
    web.get('/plain', (_, res) => res.send('<!doctype html><html><head><title>Plain</title></head><body>No tool assistant</body></html>'));
    const capturePage = fs.readFileSync(path.join(root, 'frontend/pages/uivf12.html'), 'utf8');
    const analysisDialogs = capturePage.slice(capturePage.indexOf('<div id="scriptAnalysisModal"'), capturePage.indexOf('<div id="uivAiAdapterOverlay"'));
    web.get('/capture-analysis', (_, res) => res.send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>数据抓取</title>
        <link rel="stylesheet" href="/css/uivf12.css"></head><body id="uiv-page">
        <p>Underlying capture workspace</p>${analysisDialogs}
        <script>window.API={getSourceMode:()=> 'auto', get:async()=>({scripts:[{
            id:'ops-capture', name:'订单抓取脚本', category:'运营分类',
            url:'https://example.test/?opaque=private-url-value', payload:'{"pageSize":50}', configOptions:{isPagination:true}
        }]})};</script><script src="/js/uivf12/analysis.js"></script>${assistant}</body></html>`));
    web.get('/dense', (_, res) => res.send(`<!doctype html><title>Long table</title>
        <style>body{font:12px monospace}td{padding:2px}.outside{margin-top:900px}</style>
        <table><thead><tr><th>Service</th><th>Details</th></tr></thead><tbody>
        ${Array.from({ length: 26 }, (_, index) => `<tr><td>${index === 25 ? 'Zephyr' : 'Service-' + index}</td><td>${index === 25 ? 'Target details' : 'Ordinary unrelated information '.repeat(7)}</td></tr>`).join('')}
        </tbody></table><p class="outside">Offscreen-only marker</p>${assistant}`));
    web.get('/hosted', (_, res) => res.send(`<!doctype html><html><head><title>Host shell</title></head><body>
        <iframe class="custom-tool-frame" style="width:95vw;height:95vh" src="/launcher"></iframe>${assistant}</body></html>`));
    web.get('/launcher', (_, res) => res.send('<!doctype html><html><head><title>AiOps fixture</title><link rel="stylesheet" href="/css/hosted-app-launcher.css"></head><body data-hosted-app="fixture"><script src="/js/hosted-app-launcher.js"></script></body></html>'));
    web.get('/private-runtime', (_, res) => res.send('<!doctype html><p>Sandboxed runtime content</p>'));
    web.get('/api/hosted-apps/fixture/launch', (_, res) => res.json({ app: { status: 'running', isAdmin: true, name: 'AiOps fixture', entryUrl: '/private-runtime' } }));
    web.get('/api/hosted-apps/fixture/editor/git/status', (_, res) => res.json({ status: { branch: 'main', clean: true } }));
    web.get('/api/hosted-apps/fixture/editor/tree', (_, res) => res.json({ tree: ['short.py', 'long.py', '.env'].map(name => ({ name, path: name, isDir: false })) }));
    web.get('/api/hosted-apps/fixture/editor/file', (req, res) => {
        const name = req.query.path;
        const content = name === 'long.py' ? Array.from({ length: 600 }, (_, i) => `def function_${i + 1}(): return ${i + 1}`).join('\n')
            : name === '.env' ? 'UNLABELED=excluded-file-value' : 'def preview(): return "initial-buffer"';
        res.json({ file: { path: name, name, content } });
    });
    web.post('/api/ai/chat', (req, res) => { chats.push(req.body); res.json({ reply: 'Fixture reply' }); });
    web.get('/api/ai/proactive-alerts', (_, res) => res.json({ items: [] }));
    web.get('/api/ai/suggestions', (_, res) => res.json({ items: [] }));
    web.use(express.static(path.join(root, 'frontend')));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(base);
    await until('!!window.ToolsAIAssistant');
    assert.equal(await evaluate('document.querySelectorAll(".ai-fab").length'), 1);
    await evaluate('HomeToolFrame.open("/tool")');
    await until('document.body.classList.contains("v2-tool-has-assistant")');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".ai-fab")).display'), 'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".ai-panel")).display'), 'none');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".ai-proactive-alert")).display'), 'none');
    assert.notEqual(await evaluate('(()=>{const f=document.querySelector("iframe");return f.contentWindow.getComputedStyle(f.contentDocument.querySelector(".ai-fab")).display})()'), 'none');
    await evaluate('ToolsAIAssistant.open()');
    assert.equal(chats.at(-1).pagePath, '/tool', 'host API opens the tool assistant with tool context');
    assert.match(chats.at(-1).context, /Tool-specific content/);
    await evaluate('document.querySelector("iframe").contentDocument.getElementById("fixtureModal").hidden = false');
    await evaluate('ToolsAIAssistant.ask("Explain the dialog")');
    assert.match(chats.at(-1).context, /Foreground dialog/);
    assert.doesNotMatch(chats.at(-1).context, /Tool-specific content|fixture-password|hidden detail|Fixture reply/);
    assert.equal(await evaluate('document.querySelector("iframe").contentDocument.querySelector(".ai-panel").classList.contains("open")'), true);
    await evaluate('HomeToolFrame.close()');
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".ai-fab")).display'), 'none');
    await evaluate('HomeToolFrame.open("/late")');
    await until('document.body.classList.contains("v2-tool-has-assistant")');
    await evaluate('document.querySelector("iframe").contentWindow.location.replace("/plain");void 0');
    await until('document.querySelector("iframe").contentDocument?.title==="Plain"&&!document.body.classList.contains("v2-tool-has-assistant")');
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".ai-fab")).display'), 'none', 'tools without assistant retain host fallback');
    await evaluate('ToolsAIAssistant.open()');
    assert.equal(chats.at(-1).pagePath, '/plain');
    assert.match(chats.at(-1).context, /No tool assistant/);
    await evaluate('HomeToolFrame.open("/hosted")');
    const launcher = 'document.querySelector("#v2ToolFrame iframe").contentDocument?.querySelector(".custom-tool-frame")?.contentDocument';
    await until(`!${launcher}?.getElementById("haBar")?.hidden && !!${launcher}?.querySelector(".ha-frame")`);
    await evaluate('ToolsAIAssistant.open()');
    assert.match(chats.at(-1).context, /Embedded page content is unavailable/);
    assert.doesNotMatch(chats.at(-1).context, /Sandboxed runtime content/);
    await evaluate(`${launcher}.querySelector('[data-action="ide"]').click()`);
    await until(`!!${launcher}.querySelector('[data-tree-path="short.py"]')`);
    await evaluate(`${launcher}.querySelector('[data-tree-path="short.py"]').click()`);
    await until(`${launcher}.getElementById("haIdeTextarea").value.includes("initial-buffer") && ${launcher}.getElementById("haIdeLoading").hidden`);
    await evaluate(`(() => { const editor = ${launcher}.getElementById("haIdeTextarea"); editor.value = 'def preview(): return "edited-buffer"'; editor.dispatchEvent(new Event("input")); })()`);
    await evaluate('ToolsAIAssistant.ask("Explain preview")');
    assert.equal(chats.at(-1).pageTitle, 'AiOps fixture');
    assert.equal(chats.at(-1).pagePath, '/hosted');
    assert.equal(chats.at(-1).currentView, true);
    assert.match(chats.at(-1).context, /short\.py.*Unsaved/);
    assert.match(chats.at(-1).context, /edited-buffer/);
    assert.doesNotMatch(chats.at(-1).context, /initial-buffer|Sandboxed runtime content|Fixture reply/);
    await evaluate(`${launcher}.querySelector('[data-tree-path="long.py"]').click()`);
    await until(`${launcher}.getElementById("haIdeTextarea").value.includes("function_600") && ${launcher}.getElementById("haIdeLoading").hidden`);
    await evaluate('ToolsAIAssistant.ask("Explain line 480")');
    assert.match(chats.at(-1).context, /function_480/);
    assert.doesNotMatch(chats.at(-1).context, /edited-buffer|function_1\(\)/);
    await evaluate(`${launcher}.querySelector('[data-tree-path=".env"]').click()`);
    await until(`${launcher}.getElementById("haIdeTextarea").value.includes("UNLABELED") && ${launcher}.getElementById("haIdeLoading").hidden`);
    await evaluate('ToolsAIAssistant.ask("Explain this file")');
    assert.match(chats.at(-1).context, /Active file type was excluded/);
    assert.doesNotMatch(chats.at(-1).context, /excluded-file-value/);
    await win.loadURL(base + '/tool');
    await until('!!window.ToolsAIAssistant');
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".ai-fab")).display'), 'none', 'standalone tool keeps its assistant');
    await evaluate('new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="/js/shared/ai-assistant.js";s.onload=()=>resolve(true);s.onerror=reject;document.body.append(s)})');
    assert.equal(await evaluate('document.querySelectorAll(".ai-fab").length'), 1, 'repeated script loading is idempotent');
    assert.equal(await evaluate('document.querySelectorAll(".ai-panel").length'), 1);
    await evaluate(`(() => {
        const dialog = document.createElement('dialog');
        dialog.innerHTML = '<h2>Native outer dialog</h2>';
        dialog.id = 'nativeOuter';
        document.body.appendChild(dialog);
        dialog.showModal();
    })()`);
    await until('document.querySelector("#nativeOuter > .ai-fab") !== null');
    await evaluate(`(() => {
        const dialog = document.createElement('dialog');
        dialog.innerHTML = '<h2>Native nested dialog</h2><input type="text" value="private-edit-value">';
        dialog.id = 'nativeNested';
        document.body.appendChild(dialog);
        dialog.showModal();
    })()`);
    await until('document.querySelector("#nativeNested > .ai-fab") !== null');
    await evaluate('ToolsAIAssistant.ask("Explain the dialog")');
    assert.match(chats.at(-1).context, /Native nested dialog/);
    assert.doesNotMatch(chats.at(-1).context, /Native outer dialog|Tool-specific content|private-edit-value/);
    await evaluate('document.querySelector("#nativeNested").remove()');
    await until('document.querySelector("#nativeOuter > .ai-fab") !== null');
    await evaluate('document.querySelector("#nativeOuter").close()');
    await until('document.querySelector("body > .ai-fab") !== null');

    await win.loadURL(base + '/capture-analysis');
    await evaluate('UIVScriptAnalysis.open()');
    assert.equal(await evaluate(`(() => {
        const bounds = document.querySelector('.ai-fab').getBoundingClientRect();
        return !!document.elementFromPoint(bounds.left + 8, bounds.top + 8)?.closest('.ai-fab');
    })()`), true, 'the script analysis window leaves the assistant clickable');
    await evaluate('ToolsAIAssistant.open()');
    assert.match(chats.at(-1).context, /脚本仓库分析/);
    assert.match(chats.at(-1).context, /订单抓取脚本/);
    assert.doesNotMatch(chats.at(-1).context, /Underlying capture workspace|private-url-value/);
    await evaluate('document.querySelector(".script-analysis-action.saveas").click()');
    await until('document.querySelector("#scriptAnalysisMiniDialog.open") !== null');
    await evaluate('ToolsAIAssistant.ask("这个另存为弹窗有什么用？")');
    assert.match(chats.at(-1).context, /为当前脚本副本命名并选择保存分类/);
    assert.doesNotMatch(chats.at(-1).context, /脚本仓库分析|订单抓取脚本_副本|private-url-value/);
    await evaluate('UIVScriptAnalysis.cancelDialog()');

    await win.loadURL(base + '/dense');
    await evaluate('ToolsAIAssistant.ask("Explain Zephyr")');
    assert.match(chats.at(-1).context, /Service \| Details/);
    assert.match(chats.at(-1).context, /Zephyr \| Target details/);
    assert.match(chats.at(-1).context, /Excerpt from the current view/);
    assert.doesNotMatch(chats.at(-1).context, /Offscreen-only marker/);
    console.log('PASS: tool ownership, visible content, nested modals, script analysis, question-relevant rows, and IDE context');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { clearTimeout(watchdog); win?.destroy(); server?.close(); app.exit(process.exitCode || 0); });
