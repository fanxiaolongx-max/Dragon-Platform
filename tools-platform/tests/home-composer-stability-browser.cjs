// Run: node_modules/.bin/electron tests/home-composer-stability-browser.cjs
// Full home renderer, mocked APIs, isolated profile; no model calls or runtime data writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-composer-stability-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
let win, server, prefs = { lastDirectory: '', recentDirectories: ['/fixture/privacy-policy', '/fixture/reports'], permissionMode: 'ask' };
let rejectPermission = false, enhanceMode = 'normal', enhanceCalls = [], sessionPages = 0;
const models = [{ id: 'profile:main', name: 'DeepSeek-V4.1-Flash', provider: 'openai-compatible', description: '主连接' }, { id: 'profile:other', name: 'claude-sonnet-4-20250514', provider: 'anthropic', description: '备用连接' }];
const evaluate = code => win.webContents.executeJavaScript(code, true);
const until = code => evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${code})resolve();else if(++n>250)reject(new Error(${JSON.stringify(code)}));else setTimeout(poll,20)};poll()})`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(name) { await wait(220); fs.writeFileSync(path.join(temp, name+'.png'), (await win.webContents.capturePage()).toPNG()); }
setTimeout(() => app.exit(1), 60000).unref();
app.whenReady().then(async () => {
    const web = express(); web.use(express.json());
    web.get('/', (_, res) => res.type('html').send(fs.readFileSync(path.join(frontend, 'index.html'), 'utf8').replace('<head>', `<head><script>
        localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_token','fixture-session');localStorage.setItem('tools_lang','zh-CN');
        window.fixtureIntervals=[];const originalInterval=window.setInterval;window.setInterval=(fn,delay,...args)=>{if(delay>=10000)fixtureIntervals.push({fn,delay});return originalInterval(fn,delay,...args)};
        window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
    </script>`)));
    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture', role: 'admin', tenantId: 'default' }));
    web.get('/api/app-version', (_, res) => res.json({ version: 'fixture' }));
    web.get('/api/tenants', (_, res) => res.json({ tenants: [{ id: 'default', name: '默认租户' }], activeTenantId: 'default' }));
    web.get('/api/platform-promotions', (_, res) => res.json({ desktopStack: false, rotateSeconds: 15, maxLinks: 3, videos: ['rfc','incentive','eos','guide','aiMonthly','welinkCli','welinkSdk','digitalHuman'].map(id=>({id,enabled:false})), links: [{ id: 'fixture', name: '平台功能介绍', nameEn: 'Platform guide', description: '查看平台使用指南', badge: '资讯', enabled: true, url: 'https://example.test/guide', color: 'teal' }] }));
    web.get('/api/agent-workspace/capability', (_, res) => res.json({ enabled: true, homeDir: '/fixture' }));
    web.get('/api/agent-workspace/prefs', (_, res) => res.json(prefs));
    web.put('/api/agent-workspace/prefs', (req, res) => { if (rejectPermission) return res.status(500).json({ error: 'fixture save failure' }); prefs = { ...prefs, ...req.body }; res.json(prefs); });
    web.get('/api/agent-workspace/suggest', (_, res) => res.json({ exists: true, isDir: true, groups: [] }));
    web.get('/api/ai-settings', (_, res) => res.json({ activeProfileId: 'main', profiles: models.map((model,index)=>({ id: index?'other':'main', name: model.description, model: model.name, provider: model.provider, category: 'chat', isActive: !index, hasApiKey: true, keyLooksValid: true, maskedApiKey: '****', maxOutputTokens: 2048, temperature: .7 })) }));
    web.post('/api/ai/enhance-prompt', (req, res) => { enhanceCalls.push(req.body); if (enhanceMode==='error') return res.status(503).json({code:'AI_PROMPT_FAILED',error:'fixture enhancement failure'});const delay=enhanceMode==='slow'?220:60;setTimeout(()=>{if(!res.destroyed)res.json({prompt:req.body.text+' 明确输出步骤与验证结果。'})},delay); });
    web.get('/api/ai/models', (_, res) => res.json({ models, defaultId: models[0].id, mode: 'direct' }));
    web.get('/api/ai/sessions', (req, res) => { if(Number(req.query.offset)>0)sessionPages++;res.json({ items: Array.from({length:55},(_,index)=>({ id: 'recent-fixture-'+index, title: '研究依据核对 Skill', messageCount: 2, firstQuestion:'创建研究依据核对 Skill，检查结论与依据是否对应、口径是否一致，缺依据如何标注；交付一个含名称、说明、触发条件和步骤的 SKILL.md，不安装。'+index,updatedAt:'2026-11-02T09:00:00Z' })).slice(Number(req.query.offset)||0,(Number(req.query.offset)||0)+(Number(req.query.limit)||40)) }); });
    web.post('/api/ai/uploads', (_,res)=>res.json({files:[{name:'notes.txt',path:'/fixture/uploads/notes.txt',size:14}]}));
    web.get('/api/ai/skills', (_, res) => res.json({ items: [{ id: 'research-check', name: '研究依据核对', nameEn: 'Research check', description: '核对结论与依据', descriptionEn: 'Review research evidence' }] }));
    web.get(['/api/friend-links','/api/recent-nav','/api/upload/history'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until('!!window.HomeComposer&&!!document.querySelector(".dc-permission-picker")&&!!document.querySelector(".v2-suggest-item")&&!!window.HomePromoPlayer');

    await evaluate(`document.getAnimations().forEach(a=>{try{a.finish()}catch{}})`);await wait(250);
    const rects=()=>evaluate(`(()=>{const box=id=>{const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {input:box('#dcInput'),form:box('#dcComposer'),surface:box('.dc-composer-surface'),scrollX,scrollY,mainScroll:document.querySelector('.home-main').scrollTop,owners:[document.documentElement,document.body,document.querySelector('.home-content'),document.querySelector('.home-main')].map(n=>({name:n.className||n.tagName,width:n.getBoundingClientRect().width,client:n.clientWidth,offset:n.offsetWidth,scroll:n.scrollHeight,height:n.clientHeight,overflow:getComputedStyle(n).overflowY,gutter:getComputedStyle(n).scrollbarGutter}))}})()`);
    function same(actual,expected,label){for(const key of ['input','form','surface'])for(const dim of ['x','y','width','height'])assert.ok(Math.abs(actual[key][dim]-expected[key][dim])<.6,`${label}: ${key}.${dim} changed from ${expected[key][dim]} to ${actual[key][dim]} ${JSON.stringify({before:expected.owners,after:actual.owners})}`);assert.equal(actual.scrollX,expected.scrollX,label+' horizontal page scroll');assert.equal(actual.scrollY,expected.scrollY,label+' vertical page scroll');assert.equal(actual.mainScroll,expected.mainScroll,label+' main scroll');}
    for(const [width,height,lang,theme]of [[1440,1000,'zh-CN','light'],[1000,760,'en-US','dark'],[390,844,'zh-CN','light']]){
        win.setContentSize(width,height);
        await evaluate(`HomeComposer.close();ToolsI18n.setLanguage(${JSON.stringify(lang)});document.documentElement.dataset.theme=${JSON.stringify(theme)};document.body.classList.add('v2-side-collapsed');dcInput.value='';dcInput.dispatchEvent(new Event('input',{bubbles:true}));window.scrollTo(0,30);true`);await wait(300);
        const before=await rects();
        for(const scene of ['analysis','monthly','expedite','script','graph','schedule']){
            await evaluate(`document.querySelector('[data-scene=${scene}]').click()`);await wait(100);same(await rects(),before,scene+' on '+width);
            await evaluate(`document.querySelector('[data-scene=${scene}]').click()`);await wait(100);same(await rects(),before,scene+' off '+width);
        }
        const long='创建一个完整的研究依据核对流程，检查结论与依据是否对应、口径是否一致，附两条示例。'.repeat(15);
        await evaluate(`window.originalPrompt=document.querySelector('.v2-suggest-item').dataset.fill;document.querySelector('.v2-suggest-item').dataset.fill=${JSON.stringify(long)};document.querySelector('.v2-suggest-item').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));true`);await wait(80);
        assert.equal(await evaluate('dcInput.value'),'');assert.equal(await evaluate('dcInput.placeholder'),long);same(await rects(),before,'long hover '+width);
        await evaluate(`document.querySelector('.v2-suggest').dispatchEvent(new PointerEvent('pointerleave'))`);same(await rects(),before,'hover leave '+width);
        const point=await evaluate(`(()=>{const r=document.querySelector('.v2-suggest-item').getBoundingClientRect();return {x:Math.round(r.x+30),y:Math.round(r.y+r.height/2)}})()`);
        win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await wait(100);same(await rects(),before,'fill long draft '+width);
        assert.equal(await evaluate('dcInput.value'),long);assert.ok(await evaluate('dcInput.scrollHeight>dcInput.clientHeight'),'long text remains readable by internal scrolling');
        await evaluate(`dcInput.scrollTop=dcInput.scrollHeight;true`);assert.ok(await evaluate('dcInput.scrollTop>0'));
        await evaluate(`dcInput.value='';dcInput.dispatchEvent(new Event('input',{bubbles:true}));true`);same(await rects(),before,'clear draft '+width);
        for(const code of ["dcAttach.click()","HomeComposer.close()","document.querySelector('[data-tac-start]').click()","document.querySelector('[data-tac-start]').click()","dcModelBtn.click()","dcModelBtn.click()","document.querySelector('.dc-permission-picker summary').click()","document.querySelector('.dc-permission-picker summary').click()"]){await evaluate(code);await wait(160);same(await rects(),before,code+' '+width);if(code.includes('data-tac-start'))assert.equal(await evaluate(`(()=>{const menu=document.querySelector('.dc-connector-popover');if(menu.hidden)return true;const r=menu.getBoundingClientRect();return r.top>=0&&r.left>=0&&r.bottom<=innerHeight&&r.right<=innerWidth})()`),true,'connector menu stays within viewport');}
        await capture('stable-'+width+'-'+theme);
        await evaluate(`document.querySelector('.v2-suggest-item').dataset.fill=originalPrompt;true`);
    }
    // Sending a conversation still uses the existing expandable conversation composer.
    await evaluate(`document.body.classList.add('dc-chatting');dcInput.value=('line'+String.fromCharCode(10)).repeat(15);dcInput.dispatchEvent(new Event('input',{bubbles:true}));true`);
    assert.ok(await evaluate('dcInput.getBoundingClientRect().height>76'));
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    console.log('PASS: stable homepage composer position/size and page scroll for six scene toggles, long hover/fill/clear, menus, light/dark/English/mobile; conversation resizing preserved. Screenshots: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
