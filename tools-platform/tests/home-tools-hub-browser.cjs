// Run: node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Featured stability audit: HOME_FEATURED_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Sidebar height audit: HOME_SIDEBAR_HEIGHT_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Scan popup audit: HOME_SCAN_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Message navigation audit: HOME_MESSAGES_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Wheel audit: HOME_SCROLL_AUDIT=1 DESKTOP_DRAG_AUDIT=1 DRAG_PLATFORM=darwin node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Desktop drag audit: DESKTOP_DRAG_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Full home renderer, mocked APIs, isolated profile; no model calls or runtime data writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-composer-'));
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
        ${process.env.DESKTOP_DRAG_AUDIT ? `window.DragonWindow={getState:async()=>({platform:'${process.env.DRAG_PLATFORM || 'win32'}'}),onState:()=>{}};` : ''}
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
    web.get('/api/ai/sessions', (req, res) => { if(Number(req.query.offset)>0)sessionPages++;res.json({ items: Array.from({length:55},(_,index)=>({ id: 'recent-fixture-'+index, title: '研究依据核对 Skill', messageCount: 2, firstQuestion:'创建研究依据核对 Skill，检查结论与依据是否对应、口径是否一致，缺依据如何标注；交付一个含名称、说明、触发条件和步骤的 SKILL.md，不安装。',updatedAt:'2026-11-02T09:00:00Z' })).slice(Number(req.query.offset)||0,(Number(req.query.offset)||0)+(Number(req.query.limit)||40)) }); });
    web.get('/api/ai/skills', (_, res) => res.json({ items: [{ id: 'research-check', name: '研究依据核对', nameEn: 'Research check', description: '核对结论与依据', descriptionEn: 'Review research evidence' }] }));
    web.get(['/api/friend-links','/api/recent-nav','/api/upload/history'], (_, res) => res.json([]));
    if (process.env.HOME_SCAN_AUDIT) {
        web.get('/api/channels/welink-cli/status', (_, res) => res.json({ install: { available: true }, auth: { loggedIn: true } }));
        web.get('/api/channels/weixin/status', (_, res) => res.json({ connected: true, bot: { id: 'fixture' } }));
        web.post('/api/channels/welink-cli/login', (_, res) => res.type('application/x-ndjson').send(JSON.stringify({ type: 'event', event: { type: 'expired' } })+'\n'));
        web.post('/api/channels/weixin/qrcode-auth', (_, res) => res.type('application/x-ndjson').send(JSON.stringify({ type: 'expired' })+'\n'));
    }
    web.get('/api/alert-center/events', (_, res) => setTimeout(() => res.json({ events: [] }), process.env.HOME_MESSAGES_AUDIT ? 200 : 0));
    web.get('/scroll-fixture', (_, res) => res.send('<!doctype html><title>Scrollable tool</title><div style="height:4000px">Tool content</div>'));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    if (process.env.HOME_SCROLL_AUDIT) win.webContents.on('console-message', (_, level, message) => { if(level>=2)console.error(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);

    await until('window.HomeSkillHub&&document.querySelector("[data-v2-mode=tools]")&&document.getElementById("v2SkillHub")');
    if (process.env.HOME_FEATURED_AUDIT) {
        await evaluate(`window.HomeWorkspace.getTools=()=>Array.from({length:6},(_,i)=>({id:'fixture-'+i,title:'Fixture '+i,href:'/fixture/'+i,group:i<3?'A':'B'}));void 0`);
        for (const width of [1440,600]) {
            win.setContentSize(width,1000);
            await evaluate(`document.body.classList.add('v2-side-collapsed');HomeSkillHub.open('tools')`);
            await wait(200);
            const snapshot=()=>evaluate(`(()=>{const f=document.querySelector('.v2-hub-featured');return {hidden:f.hidden,keys:[...f.querySelectorAll('[data-hub-key]')].map(el=>el.dataset.hubKey),top:document.querySelector('.v2-hub-bar').getBoundingClientRect().top}})()`);
            const initial=await snapshot();assert.equal(initial.hidden,false);
            const check=async()=>assert.deepEqual(await snapshot(),initial,'shortcuts and category position remain stable at '+width+'px');
            for(const category of ['A','B','all']) {
                await evaluate(`document.querySelector('[data-hub-cat="${category}"]').click()`);
                await check();
                assert.equal(await evaluate(`document.querySelectorAll('.v2-hub-grid [data-hub-key]').length`), category==='all'?6:3, 'category still filters results');
            }
            await evaluate(`document.querySelector('[data-hub-do="mine"]').click()`);
            await check();assert.equal(await evaluate(`document.querySelectorAll('.v2-hub-grid [data-hub-key]').length`),0,'favorites only changes results');
            await evaluate(`document.querySelector('[data-hub-do="mine"]').click();document.querySelector('.v2-hub-search input').value='unmatched fixture';document.querySelector('.v2-hub-search input').dispatchEvent(new Event('input',{bubbles:true}))`);
            await check();assert.equal(await evaluate(`document.querySelectorAll('.v2-hub-grid [data-hub-key]').length`),0,'empty search only changes results');
            await evaluate('HomeSkillHub.close()');
        }
        assert.deepEqual(await evaluate('fixtureErrors'),[]);
        console.log('PASS: featured shortcuts and category bar remain stable across category/favorites/empty search filters at 1440/600px; result filtering preserved.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_SIDEBAR_HEIGHT_AUDIT) {
        for (const width of [1920, 1000, 600]) {
            win.setContentSize(width, 883);
            for (const theme of ['light', 'dark']) {
                for (const workspace of [false, true]) {
                    await evaluate(`document.documentElement.dataset.theme='${theme}';document.body.classList.remove('v2-side-collapsed');document.body.classList.toggle('dc-chatting',${width>860});document.body.classList.toggle('dc-workspace-open',${workspace});window.scrollTo(0,0)`);
                    await wait(50);
                    const geometry=await evaluate(`(()=>{
                        const side=document.getElementById('homeSidebar'),r=side.getBoundingClientRect(),u=document.querySelector('.v2-userbar').getBoundingClientRect();
                        return {top:r.top,bottom:r.bottom,userBottom:u.bottom,viewport:innerHeight,height:getComputedStyle(side).height,hit:!!document.elementFromPoint(r.left+10,innerHeight-2)?.closest('#homeSidebar')};
                    })()`);
                    assert.ok(Math.abs(geometry.bottom-geometry.viewport)<1, `sidebar fills viewport, width=${width}, workspace=${workspace}, theme=${theme}: `+JSON.stringify(geometry));
                    if(width>860)assert.ok(Math.abs(geometry.userBottom-geometry.viewport)<1, 'user bar stays at viewport bottom: '+JSON.stringify({width,workspace,theme,...geometry}));
                    if(width>860)assert.equal(geometry.hit,true,'bottom-left pixel belongs to sidebar');
                }
            }
        }
        console.log('PASS: sidebar covers viewport bottom at 1920/1000/600px, desktop user bar stays at bottom, workspace open/closed, light/dark.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_SCAN_AUDIT) {
        const isOpen = () => evaluate(`document.querySelector('.v2-scan').classList.contains('is-open') && document.getElementById('v2ScanBtn').getAttribute('aria-expanded')==='true'`);
        await evaluate(`document.getElementById('v2ScanBtn').dispatchEvent(new MouseEvent('mouseenter'))`);
        assert.equal(await isOpen(), true, 'hover opens scan dialog');
        await until(`!!document.querySelector('[data-scan-action="relogin-welink"]')`);
        await evaluate(`document.getElementById('v2ScanBtn').click()`);
        assert.equal(await isOpen(), true, 'click after hover keeps dialog open');
        for (const tab of ['weixin', 'welink', 'weixin']) {
            await evaluate(`document.querySelector('[data-scan-tab="${tab}"]').click()`);
            assert.equal(await isOpen(), true, tab+' tab remains open after synchronous DOM replacement');
            await until(`!!document.querySelector('[data-scan-action="relogin-${tab}"]')`);
            assert.equal(await evaluate(`document.querySelector('[data-scan-tab="${tab}"]').getAttribute('aria-selected')`), 'true');
            await evaluate(`document.querySelector('[data-scan-action="relogin-${tab}"]').click()`);
            assert.equal(await isOpen(), true, tab+' refresh keeps dialog open');
            await wait(100);
            assert.equal(await isOpen(), true, tab+' asynchronous response keeps dialog open');
        }
        await evaluate(`document.getElementById('v2ScanBtn').dispatchEvent(new MouseEvent('mouseleave'))`);
        assert.equal(await isOpen(), true, 'moving away does not dismiss');
        await evaluate('document.body.click()');assert.equal(await isOpen(), false, 'outside click closes');
        await evaluate(`document.getElementById('v2ScanBtn').click()`);assert.equal(await isOpen(), true, 'click can reopen');
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await isOpen(), false, 'Escape closes');
        await evaluate(`document.getElementById('v2ScanBtn').dispatchEvent(new MouseEvent('mouseenter'))`);assert.equal(await isOpen(), true, 'hover reopens');
        await evaluate(`document.getElementById('v2DiscoverBtn').click()`);assert.equal(await isOpen(), false, 'another menu closes scan dialog');
        await wait(150);
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: scan hover opens; click, WeChat/WeLink tabs and refresh remain open; outside click, Escape and other menu dismiss.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_MESSAGES_AUDIT) {
        const isOpen = () => evaluate(`document.body.classList.contains('v2-messages-open') || document.querySelector('.v2-messages')?.classList.contains('is-open')`);
        const open = async () => {
            await evaluate(`document.getElementById('v2AlertBtn').click()`);
            assert.equal(await isOpen(), true, 'bell opens message center');
        };
        await open();
        await evaluate(`document.querySelector('[data-msg-filter="unread"]').click()`);
        assert.equal(await isOpen(), true, 'message filter keeps center open');
        await evaluate(`document.getElementById('v2AlertBtn').click()`);
        assert.equal(await isOpen(), true, 'bell remains usable while open');
        for (const selector of ['[data-v2-action="newChat"]', '[data-v2-action="skillHub"]', '[data-v2-flyout="more"]', '#v2DiscoverBtn']) {
            await open();
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
            assert.equal(await isOpen(), false, selector+' dismisses messages');
        }
        await evaluate(`window.fixtureLibraryCalls=0;window.openToolsKnowledgeGraph=()=>{fixtureLibraryCalls++;window.fixtureLibrarySawMessages=document.body.classList.contains('v2-messages-open')};void 0`);
        await open();
        await evaluate(`document.querySelector('[data-v2-action="library"]').click()`);
        assert.equal(await isOpen(), false, 'library dismisses messages without a mode change');
        assert.equal(await evaluate('fixtureLibraryCalls'), 1, 'library action still runs');
        assert.equal(await evaluate('fixtureLibrarySawMessages'), false, 'messages close before destination opens');
        await until(`!!document.querySelector('.home-chat-open')`);
        await open();
        await evaluate(`document.querySelector('.home-chat-open').addEventListener('click',e=>e.stopImmediatePropagation(),{once:true});document.querySelector('.home-chat-open').click()`);
        assert.equal(await isOpen(), false, 'conversation click dismisses even when list stops bubbling');
        for (const action of ["HomeSkillHub.open('tools')", "HomeToolFrame.open('/scroll-fixture')"]) {
            await open();await evaluate(action);
            assert.equal(await isOpen(), false, action+' dismisses messages via navigation event');
        }
        await open();await evaluate(`document.querySelector('[data-msg-close]').click()`);
        assert.equal(await isOpen(), false, 'close button still works');
        await wait(350);
        assert.equal(await isOpen(), false, 'pending message fetch cannot reopen the center');
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: message center closes on sidebar menus, library, conversations and hub/tool navigation; filters, bell and close button preserved.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_SCROLL_AUDIT) {
        win.show();win.focus();
        // Use Chromium wheel input, not dispatchEvent (which cannot trigger native scrolling).
        async function wheelAt(x, y, deltaY) {
            win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
            await wait(50);
            win.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY, canScroll: true });
            await wait(650);
        }
        for (const [width, theme, language] of [[1440, 'light', 'zh-CN'], [600, 'dark', 'en-US']]) {
            win.setContentSize(width, 800);
            await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}');document.body.classList.add('v2-side-collapsed')`);
            for (const chatting of [false, true]) {
                await evaluate(`document.body.classList.toggle('dc-chatting',${chatting})`);
                for (const tab of ['skills', 'plugins', 'tools']) {
                    await evaluate(`HomeSkillHub.open('${tab}')`);
                    await wait(250);
                    await evaluate(`
                        document.querySelector('#v2SkillHub').insertAdjacentHTML('beforeend','<div class="v2-hub-cards scroll-fixture">'+Array.from({length:60},(_,i)=>'<div class="v2-hub-card">Fixture '+i+'</div>').join('')+'</div>');`);
                    await wait(80);
                    const point = await evaluate(`(()=>{const r=document.querySelector('.home-main').getBoundingClientRect();return {x:r.right-20,y:400}})()`);
                    await wheelAt(point.x, point.y, -560);
                    assert.ok(await evaluate(`document.querySelector('.home-main').scrollTop>0 || document.scrollingElement.scrollTop>0`), `${tab} scrolls down: ${width}px, chatting=${chatting}`);
                    // Scroll to the end with wheel input and verify the last card can be reached.
                    await wheelAt(point.x, point.y, -50000);
                    assert.ok(await evaluate(`(()=>{const r=document.querySelector('#v2SkillHub .scroll-fixture').lastElementChild.getBoundingClientRect();return r.bottom<=innerHeight && r.bottom>0})()`), `${tab} last card is visible`);
                    await wheelAt(point.x, point.y, 50000);
                    assert.equal(await evaluate(`document.querySelector('.home-main').scrollTop + document.scrollingElement.scrollTop`), 0);
                    await evaluate('HomeSkillHub.close()');
                }
            }
        }
        // A tool iframe owns its scroll; the host remains fixed. Then return to chat.
        await evaluate(`HomeToolFrame.open('/scroll-fixture')`);
        await until(`document.querySelector('.v2-tool-frame-view')?.contentDocument?.title==='Scrollable tool'`);
        const point = await evaluate(`(()=>{const r=document.querySelector('.v2-tool-frame-view').getBoundingClientRect();return {x:r.right-20,y:r.top+150}})()`);
        await wheelAt(point.x, point.y, -600);
        assert.ok(await evaluate(`document.querySelector('.v2-tool-frame-view').contentDocument.scrollingElement.scrollTop>0`), 'embedded tool scrolls');
        assert.equal(await evaluate(`getComputedStyle(document.querySelector('.home-main')).overflowY`), 'hidden');
        await evaluate(`HomeToolFrame.close();document.body.classList.add('dc-chatting');document.querySelector('.dc-thread').innerHTML='<div style="height:4000px">Messages</div>'`);
        const threadPoint=await evaluate(`(()=>{const r=document.querySelector('.dc-thread').getBoundingClientRect();return {x:r.right-20,y:r.top+60}})()`);
        await wheelAt(threadPoint.x, threadPoint.y, -600);
        assert.ok(await evaluate(`document.querySelector('.dc-thread').scrollTop>0`), 'chat scrolls after closing hub/tool');
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: wheel scrolling up/down to last card in all hub tabs, landing/chat states, wide/narrow, light/dark, Chinese/English; embedded tool and return to chat. '+temp);
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.DESKTOP_DRAG_AUDIT) {
        await until('!!document.querySelector(".desktop-drag-hub")');
        const region = selector => evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue('-webkit-app-region')`);
        for (const width of [1440, 1000, 600]) {
            win.setSize(width,900);
            for (const collapsed of [false,true]) {
                await evaluate(`document.body.classList.toggle('v2-side-collapsed',${collapsed})`);
                for (const tab of ['skills','plugins','tools']) {
                    await evaluate(`HomeSkillHub.open('${tab}')`);
                    await wait(50);
                    assert.equal(await region('.desktop-drag-hub'),'drag');
                    const bounds=await evaluate(`(()=>{const strip=document.querySelector('.desktop-drag-hub'),r=strip.getBoundingClientRect(),h=document.querySelector('.v2-hub-top').getBoundingClientRect();return {hit:document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)===strip,bottom:r.bottom,headerTop:h.top}})()`);
                    assert.ok(bounds.hit,tab+' title gutter receives pointer at '+width);
                    assert.ok(bounds.bottom<=bounds.headerTop,tab+' drag gutter does not cover the header');
                    assert.equal(await region('.v2-hub-search input'),'no-drag');
                    assert.equal(await region('[data-hub-tab]'),'no-drag');
                    assert.equal(await region('[data-hub-do="addMenu"]'),'no-drag');
                    if(!collapsed)assert.ok(await evaluate(`(()=>{const b=document.querySelector('#v2SideToggle'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.top+1))})()`),'sidebar button upper edge remains clickable');
                }
            }
        }
        await evaluate('HomeSkillHub.close()');
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".desktop-drag-hub")).display'),'none');
        await evaluate(`HomeToolFrame.open('/pages/sla.html')`);
        await until('document.body.classList.contains("v2-tool-open")');
        assert.equal(await region('.v2-tool-frame-bar'),'drag');
        assert.equal(await region('.v2-tool-frame-btn'),'no-drag');
        await evaluate('HomeToolFrame.close();document.body.classList.add("dc-chatting")');
        assert.equal(await region('.dc-chat-head'),'drag');
        await capture('desktop-drag');
        console.log('PASS: desktop hub drag gutters for skills/plugins/tools at 1440/1000/600px, expanded/collapsed sidebar; controls excluded; tool and chat headers draggable. '+temp);
        win.destroy();server.close();app.exit(0);return;
    }
    const assertTools=async()=>{
        await until('HomeSkillHub.isOpen()&&HomeSkillHub.tab()==="tools"');
        assert.equal(await evaluate('document.body.classList.contains("home-mode-chat")'),true);
        assert.equal(await evaluate('document.body.classList.contains("home-mode-tools")'),false);
        assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-home-panel=tools]")).display'),'none');
        assert.equal(await evaluate('getComputedStyle(toolsGrid).display'),'none');
        assert.equal(await evaluate('document.querySelectorAll("#v2SkillHub").length'),1);
        assert.equal(await evaluate('document.querySelector("[data-v2-action=skillHub]").classList.contains("is-active")'),true);
    };
    await evaluate('window.fixtureHub=document.getElementById("v2SkillHub");document.querySelector("[data-v2-mode=tools]").click()');
    await assertTools();
    await until('document.querySelectorAll("#v2SkillHub .v2-hub-card").length>0');
    assert.equal(await evaluate('location.hash'),'#tools');
    const fromTop=await evaluate('[...document.querySelectorAll("#v2SkillHub .v2-hub-card")].map(node=>node.dataset.hubKey)');
    await capture('top-tools-light');
    await evaluate('HomeMode.set("chat")');assert.equal(await evaluate('HomeSkillHub.isOpen()'),false);assert.equal(await evaluate('location.hash'),'');
    await evaluate('document.querySelector("[data-v2-action=skillHub]").click();document.querySelector("[data-hub-tab=tools]").click()');
    await assertTools();
    assert.equal(await evaluate('document.getElementById("v2SkillHub")===fixtureHub'),true,'both entries use the same live hub');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#v2SkillHub .v2-hub-card")].map(node=>node.dataset.hubKey)'),fromTop);
    await evaluate('document.querySelector("[data-hub-tab=skills]").click();document.querySelector(".v2-hub-search input").value="unmatched fixture";document.querySelector(".v2-hub-search input").dispatchEvent(new Event("input",{bubbles:true}));HomeMode.set("tools")');
    await assertTools();assert.equal(await evaluate('document.querySelector(".v2-hub-search input").value'),'','entering Tools clears filters from Skills');
    await evaluate('HomeMode.set("chat");window.dispatchEvent(new Event("home:show-tools"))');await assertTools();
    await evaluate('document.querySelector("[data-v2-action=newChat]").click()');assert.equal(await evaluate('HomeSkillHub.isOpen()'),false);
    await win.loadURL(`http://127.0.0.1:${server.address().port}/#tools`);await assertTools();
    await evaluate('location.hash=""');await until('!HomeSkillHub.isOpen()');
    await evaluate('location.hash="tools"');await assertTools();
    await evaluate('HomeSkillHub.close()');assert.equal(await evaluate('location.hash'),'');
    for(const [width,theme,language] of [[1440,'dark','zh-CN'],[390,'light','en-US']]){
        win.setContentSize(width,1000);await wait(100);
        await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}');HomeMode.set('tools')`);
        if(width===390)await evaluate('document.getElementById("v2SideToggle").click()');
        await assertTools();assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
        await capture('tools-hub-'+width+'-'+theme);
    }
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?ui=v1#tools`);
    await until('window.HomeMode');assert.equal(await evaluate('document.body.classList.contains("home-mode-tools")'),true,'classic layout keeps its existing tool navigation');
    assert.equal(await evaluate('!!document.getElementById("v2SkillHub")'),false);
    console.log('PASS: top Tools and sidebar Tools share one live hub and card list; no legacy category sidebar/grid; explicit tab reset; old Browse Tools event; direct #tools reload/hash navigation; return to chat; themes/English/390px; classic layout preserved. Previews: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
