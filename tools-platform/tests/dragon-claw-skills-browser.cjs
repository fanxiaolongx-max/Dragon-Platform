// Run: node_modules/.bin/electron tests/dragon-claw-skills-browser.cjs
// Real home section + full production scripts; temporary browser profile, scripted model transport.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), assert = require('node:assert/strict');
const skills = require('../backend/models/agent-skills');
const root = path.join(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-skills-browser-'));
app.setPath('userData', path.join(temp, 'profile'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = read('frontend/index.html');
const sectionStart = home.indexOf('<section class="dc"');
const section = home.slice(sectionStart, home.indexOf('</section>', sectionStart) + 10);
const css = read('frontend/css/dragon-claw.css') + read('frontend/css/dragon-claw-skills.css');
let win, server, failures = 1;
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
app.whenReady().then(async () => {
    server = http.createServer((req, res) => {
        if (req.url === '/api/ai/skills') {
            res.writeHead(failures-- > 0 ? 503 : 200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ items: skills.list() }));
        }
        if (req.url.startsWith('/api/')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ items: [], models: [] })); }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<style>${css}body{margin:0;background:#0b1426;font-family:system-ui}.dc{margin:20px;--navbar-h:0px}.dc-composer{max-width:760px}.dc-quick,.dc-scroll-hint{display:none}</style>${section}`);
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    win = new BrowserWindow({ show: false, width: 1050, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await win.webContents.executeJavaScript(`
        window.locale='zh-CN'; window.calls=[];
        window.ToolsI18n={getLanguage:()=>locale};
        window.HomeWorkspace={getTools:()=>[]};
        window.DragonClawWorkspace={getWorkspacePayload:()=>null,resetSession(){},handleEvent(){}};
        window.ToolsAIAssistant={requestStreamingChat:async(payload,handlers)=>{
            calls.push(payload);
            handlers.onEvent({type:'start',sessionId:'skill-test-chat',skills:[{id:'write-doc'}]});
            handlers.onDelta('Document draft'); return {sessionId:'skill-test-chat',reply:'Document draft'};
        }};
        window.typeText=text=>{const input=document.getElementById('dcInput');input.value=text;input.focus();input.setSelectionRange(text.length,text.length);input.dispatchEvent(new Event('input',{bubbles:true}));};
        window.press=(key,isComposing=false)=>document.getElementById('dcInput').dispatchEvent(new KeyboardEvent('keydown',{key,isComposing,bubbles:true,cancelable:true}));
        ${read('frontend/js/home/dragon-claw.js')}
        ${read('frontend/js/home/dragon-claw-skills.js')}
        void 0;
    `);
    const waitFor = expression => win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${expression})resolve();else if(++n>100)reject(new Error('Timeout: '+${JSON.stringify(expression)}));else setTimeout(poll,20)};poll()})`);
    await evaluate(() => typeText('@'));
    await waitFor("document.getElementById('dcSkillMenu').textContent.includes('加载失败')");
    await evaluate(() => document.querySelector('#dcSkillMenu [role="button"]').click());
    await waitFor("document.querySelectorAll('[data-skill-index]').length===5");
    assert.equal(await evaluate(() => document.querySelectorAll('#dcSkillMenu small').length), 4);
    assert.equal(await evaluate(() => document.getElementById('dcInput').getAttribute('aria-activedescendant')), 'dcSkillOption0');
    await evaluate(() => { press('ArrowDown'); press('Enter'); });
    assert.equal(await evaluate(() => document.getElementById('dcInput').value), '@debug ');
    assert.equal(await evaluate(() => calls.length), 0, 'Enter selects a Skill without sending a chat');
    await evaluate(() => typeText('先看看 @代码'));
    assert.equal(await evaluate(() => document.querySelectorAll('[data-skill-index]').length), 1);
    await evaluate(() => press('Tab'));
    assert.equal(await evaluate(() => document.getElementById('dcInput').value), '先看看 @code-review ');
    await evaluate(() => { typeText('@文档'); document.querySelector('[data-skill-index]').click(); });
    assert.equal(await evaluate(() => document.getElementById('dcInput').value), '@write-doc ', 'mouse selection inserts the chosen Skill');
    await evaluate(() => typeText('mail@example.com'));
    assert.equal(await evaluate(() => document.getElementById('dcSkillMenu').hidden), true);
    await evaluate(() => { typeText('@'); press('Escape'); });
    assert.equal(await evaluate(() => document.getElementById('dcSkillMenu').hidden), true);
    await evaluate(() => { typeText('@'); document.getElementById('dcInput').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})); press('Enter',true); });
    assert.equal(await evaluate(() => document.getElementById('dcInput').value), '@');
    await evaluate(() => document.getElementById('dcInput').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    assert.equal(await evaluate(() => document.querySelectorAll('[data-skill-index]').length), 5);
    await evaluate(() => typeText('/'));
    assert.equal(await evaluate(() => document.getElementById('dcInput').getAttribute('aria-expanded')), 'true');
    assert.equal(await evaluate(() => document.getElementById('dcInput').getAttribute('aria-activedescendant')), 'dcSlashOpt0');
    await evaluate(() => { press('ArrowDown'); press('Tab'); });
    assert.equal(await evaluate(() => document.getElementById('dcInput').value), '/new ', 'existing slash keyboard selection remains intact');
    await evaluate(() => { typeText('@write'); press('Tab'); document.getElementById('dcInput').value += '写一个交接说明'; press('Enter'); });
    await waitFor("calls.length===1 && !!document.querySelector('.dc-skill-used') && !document.querySelector('.dc-activity')");
    assert.match(await evaluate(() => calls[0].messages.at(-1).content), /^@write-doc /);
    assert.match(await evaluate(() => document.querySelector('.dc-skill-used').textContent), /@write-doc/);
    // 加载过的 Skill 变成输入框上方的标签，本对话后续消息继续带上；用户消息里的 @id 高亮
    await waitFor("!document.querySelector('.dc-skill-chips').hidden");
    assert.match(await evaluate(() => document.querySelector('.dc-skill-chips').textContent), /@write-doc · 编写文档/);
    assert.equal(await evaluate(() => document.querySelector('.dc-msg--user .dc-skill-mention')?.textContent), '@write-doc');
    await evaluate(() => { typeText('继续补充故障定位一节'); press('Enter'); });
    await waitFor("calls.length===2 && document.querySelectorAll('.dc-msg--ai .dc-msg-tools').length===2");
    assert.deepEqual(await evaluate(() => calls[1].skills), ['write-doc'], 'a kept Skill is sent with later messages');
    await evaluate(() => typeText('@code-reveiw 看看'));
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(temp,'skills-chips.png'),image.toPNG()));
    // 中文紧贴的 @id 也高亮；写错名字时输入框下方提示
    await evaluate(() => typeText('请用@write-doc写'));
    assert.equal(await evaluate(() => document.querySelector('.dc-skill-discover').classList.contains('is-warn')), false);
    await evaluate(() => typeText('@code-reveiw 看看'));
    assert.match(await evaluate(() => document.querySelector('.dc-skill-discover.is-warn')?.textContent || ''), /@code-reveiw/);
    await evaluate(() => typeText(''));
    assert.equal(await evaluate(() => document.querySelector('.dc-skill-discover').classList.contains('is-warn')), false);
    // × 与空输入框退格都能停用
    await evaluate(() => document.querySelector('[data-skill-remove="write-doc"]').click());
    assert.equal(await evaluate(() => document.querySelector('.dc-skill-chips').hidden), true);
    await evaluate(() => { typeText('@write-doc 再来一版'); press('Enter'); });
    await waitFor("calls.length===3 && document.querySelectorAll('.dc-msg--ai .dc-msg-tools').length===3 && !document.querySelector('.dc-skill-chips').hidden");
    await evaluate(() => { typeText(''); press('Backspace'); });
    assert.equal(await evaluate(() => document.querySelector('.dc-skill-chips').hidden), true);
    // 需要工作目录的 Skill：报错旁直接给出「选择工作目录」
    await evaluate(() => {
        window.DragonClawWorkspace.openPicker = () => { window.pickerOpened = true; };
        window.ToolsAIAssistant.requestStreamingChat = async () => { throw Object.assign(new Error('请先选择工作目录，再使用 @debug。'), { code: 'SKILL_WORKSPACE_REQUIRED' }); };
        typeText('@debug 查一下'); press('Enter');
    });
    await waitFor("!!document.querySelector('[data-dc-pick-dir]')");
    assert.doesNotMatch(await evaluate(() => document.querySelector('.dc-msg--ai:last-child').textContent), /AI 思考时出现异常/);
    await evaluate(() => document.querySelector('[data-dc-pick-dir]').click());
    assert.equal(await evaluate(() => window.pickerOpened), true);
    await evaluate(() => { typeText('@'); locale='en-US'; window.dispatchEvent(new Event('tools:languagechange')); });
    assert.match(await evaluate(() => document.getElementById('dcSkillMenu').textContent), /Built-in Skills/);
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(temp,'skills-dark.png'),image.toPNG()));
    win.setSize(430, 800);
    await evaluate(() => { document.documentElement.dataset.theme='light'; typeText('@'); });
    const bounds = await evaluate(() => { const rect=document.getElementById('dcSkillMenu').getBoundingClientRect(); return {left:rect.left,right:rect.right,width:innerWidth,bg:getComputedStyle(document.getElementById('dcSkillMenu')).backgroundColor}; });
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, JSON.stringify(bounds));
    assert.equal(bounds.bg, 'rgb(255, 255, 255)');
    await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(temp,'skills-light-narrow.png'),image.toPNG()));
    process.stdout.write(`PASS: actual home scripts, @ search, kept Skill chips, mention highlight, unknown warning, workspace prompt, keyboard/click selection, retry, IME, slash coexistence, model payload, loaded badge, English, narrow/light. Screenshots: ${temp}\n`);
    win.destroy(); server.close(); app.exit(0);
}).catch(error => { console.error(error); if(win&&!win.isDestroyed())win.destroy(); server?.close(); app.exit(1); });
