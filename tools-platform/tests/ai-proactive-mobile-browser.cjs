// Run: node_modules/.bin/electron tests/ai-proactive-mobile-browser.cjs
// Isolated Chromium layout check of the production reminder CSS, markup and positioning function.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict'), acorn = require('acorn');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-proactive-mobile-'));
app.setPath('userData', path.join(temp, 'profile'));
const source = fs.readFileSync(path.join(__dirname, '../frontend/js/shared/ai-assistant.js'), 'utf8');
const body = acorn.parse(source, { ecmaVersion: 'latest' }).body[0].expression.callee.body.body;
const css = body.find(node => node.type === 'ExpressionStatement' && node.expression.left?.object?.name === 'style').expression.right.quasis[0].value.cooked;
const markup = body.find(node => node.type === 'ExpressionStatement' && node.expression.left?.object?.name === 'proactiveAlert' && node.expression.left?.property?.name === 'innerHTML').expression.right.quasis[0].value.cooked;
const functions = body.filter(node => node.type === 'FunctionDeclaration' && ['positionProactiveAlert', 'revealProactiveAiText'].includes(node.id.name)).map(node => source.slice(node.start, node.end)).join('\n');
let win;
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`, true);
app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, useContentSize: true, width: 393, height: 740, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const html = `<meta charset="utf-8"><style>${css}body{margin:0;background:#101b30;font-family:system-ui}.ai-proactive-alert,.ai-proactive-alert *{animation:none!important;transition:none!important}.ai-proactive-alert{transform:none!important}.ai-proactive-alert-ai-char{opacity:1;transform:none}.ai-fab{bottom:70px}h2,p{margin:24px;color:#b8c5dc}</style><h2>Dragon Claw</h2><p>手机端主动提醒预览</p><div class="ai-fab">Dragon Claw</div><div class="ai-proactive-alert show">${markup}</div>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await win.webContents.executeJavaScript(`
        const fab=document.querySelector('.ai-fab'),proactiveAlert=document.querySelector('.ai-proactive-alert');
        const originalViewport=window.visualViewport, originalMatchMedia=window.matchMedia.bind(window);
        window.mockViewport=null;window.coarse=false;
        Object.defineProperty(window,'visualViewport',{get:()=>window.mockViewport||originalViewport});
        window.matchMedia=query=>query==='(pointer: coarse)'?{matches:window.coarse}:originalMatchMedia(query);
        proactiveAlert.querySelector('.ai-proactive-alert-kicker-label').textContent='近 7 天临期任务';
        proactiveAlert.querySelector('.ai-proactive-alert-text').textContent='Ahmed Sameh Salah 84399984 最近 7 天有 1 个整改单类临期任务，请尽快安排处理。';
        ${functions}
        window.positionAlert=positionProactiveAlert;
        window.addAnalysis=()=>{proactiveAlert.classList.add('ai-deep-analyzed');revealProactiveAiText('本期预警显示，北部非洲地区部 Cloud Core Network 产品线出现 1 条整改单积压，较上期快照属于新增短板风险。请核对相关责任人与处理进展，优先安排整改。'.repeat(8));positionProactiveAlert()};
        window.addEventListener('resize',positionProactiveAlert);
        positionProactiveAlert();void 0;
    `);
    const check = async (width, height, coarse = true) => {
        win.setContentSize(width, height);
        await win.webContents.executeJavaScript(`coarse=${coarse};window.coarse=${coarse};positionAlert()`);
        const bounds = await evaluate(() => {
            const card=document.querySelector('.ai-proactive-alert'),r=card.getBoundingClientRect(),v=visualViewport;
            const close=card.querySelector('.ai-proactive-alert-close').getBoundingClientRect();
            return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,compact:card.dataset.compact,
                view:{left:v.offsetLeft,top:v.offsetTop,width:v.width,height:v.height},closeVisible:close.right<=r.right&&close.top>=r.top,
                fullText:card.querySelector('.ai-proactive-alert-ai-text').textContent.length};
        });
        const v=bounds.view;
        assert.ok(bounds.left>=v.left+11 && bounds.right<=v.left+v.width-11,JSON.stringify(bounds));
        assert.ok(bounds.top>=v.top+11 && bounds.bottom<=v.top+v.height-11,JSON.stringify(bounds));
        assert.equal(bounds.closeVisible,true);
        if(width<=600||coarse&&height<=500){assert.equal(bounds.compact,'true');assert.ok(bounds.width<=320&&bounds.height<=281);}
        else {assert.equal(bounds.compact,'false');assert.equal(bounds.width,360);}
        return bounds;
    };
    await check(393,740);
    await evaluate(() => addAnalysis());
    const initial=await check(393,740);
    assert.ok(initial.fullText>500,'the preview does not discard the full analysis');
    await evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    fs.writeFileSync(path.join(temp,'portrait.png'),(await win.webContents.capturePage()).toPNG());
    for(const size of [[320,568],[375,667],[430,850],[844,390]])await check(...size);
    await evaluate(() => { document.querySelector('.ai-proactive-alert').dataset.theme='graph'; });
    await check(393,740);
    await evaluate(() => { window.mockViewport={width:320,height:320,offsetLeft:30,offsetTop:100}; });
    const keyboard=await check(430,740);
    assert.ok(keyboard.fullText===initial.fullText);
    await evaluate(() => {window.mockViewport=null;document.querySelector('.ai-proactive-alert').dataset.theme='light';});
    await check(1280,900,false);
    await evaluate(() => {document.querySelector('.ai-fab').style.top='12px';document.querySelector('.ai-fab').style.bottom='auto';});
    await check(1280,900,false);
    assert.equal(await evaluate(() => document.querySelector('.ai-proactive-alert').dataset.placement),'below');
    process.stdout.write(`PASS: 320/375/393/430px portrait, touch landscape, long analysis, light/dark, reduced visual viewport/offset, close access and desktop placement. Screenshot: ${temp}/portrait.png\n`);
    win.destroy();app.exit(0);
}).catch(error=>{console.error(error);if(win&&!win.isDestroyed())win.destroy();app.exit(1);});
