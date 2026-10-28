// Run: node_modules/.bin/electron tests/dragon-claw-message-fold-browser.cjs
// Real home renderer and CSS, isolated profile and scripted responses; no model calls.
const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-fold-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
setTimeout(() => app.exit(1), 45000).unref();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = read('frontend/index.html'), start = home.indexOf('<section class="dc"');
const section = home.slice(start, home.indexOf('</section>', start) + 10);
let win, server, historyItems = [];
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
const until = expression => win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})resolve();else if(++n>150)reject(new Error(${JSON.stringify(expression)}));else setTimeout(poll,20)};poll()})`);
async function boot() {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        localStorage.setItem('tools_token','fixture');localStorage.setItem('tools_user','fold-test');
        window.calls=[];window.copied=[];window.locale='zh-CN';
        window.ToolsI18n={getLanguage:()=>locale};window.HomeWorkspace={getTools:()=>[]};
        window.ToolsAIAssistant={requestStreamingChat:async(payload,handlers)=>{
            calls.push(JSON.parse(JSON.stringify(payload)));handlers.onEvent({type:'start',sessionId:'fold-chat'});
            handlers.onDelta('Answer');return {sessionId:'fold-chat',reply:'Answer'};
        }};
        Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>copied.push(text)},configurable:true});
        window.sendText=text=>{const input=document.getElementById('dcInput');input.value=text;input.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('dcComposer').requestSubmit();};
        ${read('frontend/js/home/dragon-claw.js')}
        void 0;
    `);
}
app.whenReady().then(async () => {
    server = http.createServer((req, res) => {
        res.setHeader('Content-Type', req.url.startsWith('/api/') ? 'application/json' : 'text/html; charset=utf-8');
        res.end(req.url.startsWith('/api/') ? JSON.stringify({ models: [], items: req.url.includes('/messages?') ? historyItems : [] }) :
            `<style>${read('frontend/css/dragon-claw.css')}body{background:#101b30;margin:0;font-family:system-ui}.dc{--navbar-h:0px;margin:20px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await boot();
    await evaluate(() => sendText('一条短消息'));
    await until('calls.length===1&&!document.querySelector(".dc-composer.is-generating")&&!document.querySelector(".dc-msg--user.is-collapsed")');
    assert.equal(await evaluate(() => document.querySelector('[data-dc-message-toggle]').hidden), true);
    await evaluate(() => { window.longText = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行：这是很长的原始问题，包含代码 <script>alert(1)</script> 和上下文。`).join('\n'); sendText(longText); });
    await until('calls.length===2&&!document.querySelectorAll("[data-dc-message-toggle]")[1].hidden');
    const inspect = () => {
        const message = document.querySelectorAll('.dc-msg--user')[1], body = message.querySelector('.dc-msg-body'), button = message.querySelector('[data-dc-message-toggle]');
        return { collapsed: message.classList.contains('is-collapsed'), height: body.clientHeight, fullHeight: body.scrollHeight, text: body.textContent, label: button.textContent, expanded: button.getAttribute('aria-expanded'), controls: button.getAttribute('aria-controls') === body.id, scripts: body.querySelectorAll('script').length };
    };
    let info = await evaluate(inspect);
    assert.equal(info.collapsed, true); assert.ok(info.height < 170); assert.ok(info.fullHeight > 600);
    assert.equal(info.label, '展开全文'); assert.equal(info.expanded, 'false'); assert.equal(info.controls, true); assert.equal(info.scripts, 0);
    assert.equal(await evaluate(() => calls[1].messages.at(-1).content === longText), true);
    await evaluate(() => document.querySelectorAll('[data-dc-message-toggle]')[1].click());
    info = await evaluate(inspect); assert.equal(info.expanded, 'true'); assert.equal(info.label, '收起全文'); assert.equal(info.height, info.fullHeight);
    await evaluate(() => { locale = 'en-US'; window.dispatchEvent(new Event('tools:languagechange')); });
    assert.equal((await evaluate(inspect)).label, 'Show less');
    await evaluate(() => document.querySelectorAll('[data-dc-message-toggle]')[1].click());
    assert.equal((await evaluate(inspect)).label, 'Show more');
    await evaluate(() => document.querySelectorAll('.dc-msg--user')[1].querySelector('[data-dc-copy]').click());
    assert.equal(await evaluate(() => copied[0] === longText), true);
    await evaluate(() => document.querySelectorAll('.dc-msg--user')[1].querySelector('[data-dc-retry]').click());
    await until('calls.length===3&&!document.querySelector(".dc-composer.is-generating")');
    assert.equal(await evaluate(() => calls[2].messages.at(-1).content === longText), true);
    await evaluate(() => document.querySelectorAll('[data-dc-message-toggle]')[1].click());
    assert.equal(await evaluate(() => document.querySelectorAll('[data-dc-message-toggle]')[2].getAttribute('aria-expanded')), 'false', 'messages fold independently');
    await evaluate(() => sendText('用于检查窄屏自动折叠。'.repeat(12)));
    await until('calls.length===4&&!document.querySelector(".dc-composer.is-generating")&&!document.querySelectorAll(".dc-msg--user")[3].classList.contains("is-collapsed")');
    win.setContentSize(390, 800);
    await until('innerWidth===390&&document.querySelectorAll(".dc-msg--user")[3].classList.contains("is-collapsed")');
    assert.equal((await evaluate(inspect)).expanded, 'true', 'resize preserves a manual expansion');
    await evaluate(() => document.querySelectorAll('[data-dc-message-toggle]')[1].click());
    assert.ok((await evaluate(inspect)).height < 170);
    fs.writeFileSync(path.join(temp, 'folded-mobile.png'), (await win.webContents.capturePage()).toPNG());
    assert.equal(await evaluate(() => document.getElementById('dcThread').scrollWidth <= document.getElementById('dcThread').clientWidth), true);
    nativeTheme.themeSource = 'light';
    await evaluate(() => { document.documentElement.dataset.theme = 'light'; document.body.classList.add('light-theme'); });
    assert.equal(await evaluate(() => getComputedStyle(document.querySelectorAll('[data-dc-message-toggle]')[1]).display !== 'none'), true);
    historyItems = [{ id: 'one', role: 'user', content: await evaluate(() => longText) }, { id: 'two', role: 'model', content: 'History answer' }];
    win.setContentSize(1000, 800);
    await until('document.querySelectorAll("[data-dc-message-toggle]")[3].hidden');
    await boot();
    await until('document.querySelector("[data-dc-resume]")');
    await evaluate(() => document.querySelector('[data-dc-resume]').click());
    await until('document.querySelector(".dc-msg--history.dc-msg--user.is-collapsed")&&!document.querySelector("[data-dc-message-toggle]").hidden');
    assert.equal(await evaluate(() => document.querySelector('.dc-msg--user .dc-msg-body').textContent), historyItems[0].content);
    fs.writeFileSync(path.join(temp, 'folded-history.png'), (await win.webContents.capturePage()).toPNG());
    await evaluate(() => document.querySelector('[data-dc-message-toggle]').click());
    assert.equal(await evaluate(() => document.querySelector('[data-dc-message-toggle]').getAttribute('aria-expanded')), 'true');
    console.log('PASS: six-line folding, expand/collapse, complete request/copy/retry, safe text, independent messages, language switch, narrow window, responsive folding, manual state across resize, light mode and restored history. Preview: ' + temp);
    win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); win?.destroy(); server?.close(); app.exit(1); });
