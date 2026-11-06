// Run: node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Requirements embed audit: HOME_REQUIREMENTS_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Featured stability audit: HOME_FEATURED_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Sidebar height audit: HOME_SIDEBAR_HEIGHT_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Workspace scope audit: HOME_WORKSPACE_SCOPE_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Collapsed sidebar peek audit: HOME_SIDE_PEEK_AUDIT=1 [HOME_SIDE_PEEK_SHOT=/path/prefix] [DESKTOP_DRAG_AUDIT=1 DRAG_PLATFORM=darwin|win32] node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Scan popup audit: HOME_SCAN_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Message navigation audit: HOME_MESSAGES_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Dialog return audit: HOME_DIALOG_RETURN_AUDIT=1 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
// Desktop right-edge audit: HOME_WINDOW_EDGE_AUDIT=1 DESKTOP_DRAG_AUDIT=1 DRAG_PLATFORM=darwin|win32 node_modules/.bin/electron tests/home-tools-hub-browser.cjs
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
let rejectPermission = false, enhanceMode = 'normal', enhanceCalls = [], sessionPages = 0, scanExtranet = false, welinkLogins = 0;
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
    web.get('/requirements', (_, res) => res.type('html').send(require('../backend/models/asset-versioning').injectPlatformTheme(fs.readFileSync(path.join(frontend,'pages/requirements.html'),'utf8'),{toolPath:'pages/requirements.html'})));
    web.get('/api/requirements', (_, res) => res.json([]));
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
        web.get('/api/channels/welink-cli/status', (_, res) => res.json(scanExtranet
            ? { install: { available: true }, network: { intranet: false, host: 'open.inner.welink.huawei.com' } }
            : { install: { available: true }, network: { intranet: true }, auth: { loggedIn: true } }));
        web.get('/api/channels/weixin/status', (_, res) => res.json({ connected: true, bot: { id: 'fixture' } }));
        web.post('/api/channels/welink-cli/login', (_, res) => (welinkLogins++, res).type('application/x-ndjson').send(JSON.stringify({ type: 'event', event: { type: 'expired' } })+'\n'));
        web.get('/api/channels/welink/status', (_, res) => res.json({ enabled: true, configured: true, connected: true, channelName: 'GDEClaw', sdk: { available: true }, assistantInfo: { name: '平台助理', desc: '运营助手' } }));
        web.post('/api/channels/welink/qrcode-auth', (_, res) => res.type('application/x-ndjson').send(scanExtranet
            ? JSON.stringify({ type: 'error', code: 'WELINK_EXTRANET', error: 'WeLink 助理扫码授权仅限华为内网使用。' })+'\n'
            : JSON.stringify({ type: 'snapshot', snapshot: { type: 'qrcode_generated', qrcode: 'q1', display: { qrcode: 'q1', weUrl: 'https://welink.example/qr/q1', pcUrl: '' } } })+'\n'));
        web.post('/api/channels/weixin/qrcode-auth', (_, res) => res.type('application/x-ndjson').send(JSON.stringify({ type: 'expired' })+'\n'));
    }
    web.get('/api/alert-center/events', (_, res) => setTimeout(() => res.json({ events: [] }), process.env.HOME_MESSAGES_AUDIT ? 200 : 0));
    web.get('/scroll-fixture', (_, res) => res.send('<!doctype html><title>Scrollable tool</title><div style="height:4000px">Tool content</div>'));
    if(process.env.HOME_TOOL_EXTERNAL_AUDIT)web.get(['/uivf12','/monthly','/report','/sla','/expedite','/bigscreen','/topic-analysis','/tools/external-fixture'],(_,res)=>res.send(require('../backend/models/asset-versioning').injectPlatformTheme('<!doctype html><head><title>Tool fixture</title><link rel="stylesheet" href="/css/shared.css"></head><body><div id="navbar-container"></div><main id="fixture-tool">Tool content</main><script src="/js/shared/navbar.js"></script></body>',{toolPath:'pages/report.html'})));
    if(process.env.HOME_TOOL_EXTERNAL_AUDIT)web.get('/custom-tools/external-fixture/index.html',(_,res)=>res.send(require('../backend/models/asset-versioning').injectPlatformTheme('<!doctype html><head></head><a id=rawReport href="/report?month=9#row" target="_blank">Report</a>',{toolPath:'custom-tools/external-fixture/index.html'})));
    if (process.env.HOME_MARKET_THEME_AUDIT) {
        web.get('/api/custom-tools/market/settings', (_,res)=>res.json({githubEnabled:true,sources:[{id:'fixture',name:'Fixture',url:'https://example.test/catalog.json',enabled:true}]}));
        web.get('/api/custom-tools/market/preview-stream', (_,res)=>res.type('application/x-ndjson').send(JSON.stringify({type:'result',data:{sources:[{enabled:true}],trust:{state:'unsigned'},tools:['update','missing','conflict','unchanged','incompatible'].map((status,i)=>({slug:'fixture-'+i,name:['在线验收表','聊天记录中心','数通协议专家','负向事件管理','版本不兼容'][i],nameEn:'Tool '+i,description:'工具说明与版本信息',icon:'🧩',status,recommended:status==='update',fingerprint:'abcdef1234567890',selectedSource:'market',minPlatformVersion:'1.0.0'}))}})+'\n'));
    }
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    if (process.env.HOME_SCROLL_AUDIT) win.webContents.on('console-message', (_, level, message) => { if(level>=2)console.error(message); });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);

    await until('window.HomeSkillHub&&document.querySelector("[data-v2-mode=tools]")&&document.getElementById("v2SkillHub")');
    if(process.env.HOME_TOOL_EXTERNAL_AUDIT){
        let opened='';win.webContents.setWindowOpenHandler(({url})=>{opened=url;return {action:'deny'};});
        const base=`http://127.0.0.1:${server.address().port}`;
        for(const href of ['/uivf12','/monthly','/report?month=2026-09#detail','/sla','/expedite','/bigscreen','/topic-analysis','/tools/external-fixture?name=a%26b#chart','/requirements']){
            await evaluate(`HomeToolFrame.open(${JSON.stringify(href)});void 0`);
            await until(`document.querySelector('.v2-tool-frame-view').contentDocument?.readyState==='complete'&&document.querySelector('.v2-tool-frame-view').contentWindow.location.pathname===${JSON.stringify(href.split(/[?#]/)[0])}`);
            opened='';await evaluate(`document.querySelector('[data-frame-act="external"]').click()`);
            for(let i=0;i<100&&!opened;i++)await wait(10);
            const expected=new URL(href,base);expected.searchParams.set('standalone','1');assert.equal(opened,expected.href);
            const popup=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
            try{
                await popup.loadURL(opened);
                for(let i=0;i<200;i++){if(await popup.webContents.executeJavaScript(`document.documentElement.classList.contains('is-clean-tool')&&!!document.querySelector('#app-navbar')`))break;await wait(20);}
                const result=await popup.webContents.executeJavaScript(`({url:location.href,nav:getComputedStyle(document.querySelector('#app-navbar')).display,sidebar:!!document.querySelector('#homeSidebar'),fab:document.querySelector('.ai-fab')?getComputedStyle(document.querySelector('.ai-fab')).display:'none'})`);
                assert.equal(result.url,expected.href);assert.equal(result.nav,'none');assert.equal(result.sidebar,false);assert.equal(result.fab,'none');
            }finally{popup.destroy();}
        }
        assert.equal(await evaluate(`ToolsNavigation.toolUrl('https://example.test/report')`),'https://example.test/report');
        assert.equal(await evaluate(`ToolsNavigation.toolUrl('/?app=%2Fmonthly')`),'/monthly?standalone=1');
        await win.loadURL(base+'/monthly?month=9#row');await until('HomeToolFrame?.isOpen()&&document.querySelector(".v2-tool-frame-view")?.contentWindow.location.pathname==="/monthly"');
        assert.equal(await evaluate('new URLSearchParams(location.search).get("app")'),'/monthly?month=9#row');
        await win.loadURL(base+'/custom-tools/external-fixture/index.html?standalone=1');await until('window.ToolsNavigation?.installed');
        assert.equal(await evaluate('document.getElementById("rawReport").getAttribute("href")'),'/report?month=9&standalone=1#row');
        console.log('PASS: nine clean tool windows without platform navbar/sidebar/assistant, direct old URL migration, raw custom-tool links, query and hash.');win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_TOOL_RETURN_AUDIT) {
        await evaluate(`HomeWorkspace.getTools=()=>Array.from({length:80},(_,i)=>({id:'return-'+i,title:'Return fixture '+i,href:'/scroll-fixture?tool='+i,group:'Fixture'}));HomeMode.set('tools');void 0`);
        await evaluate(`document.querySelector('[data-hub-cat="Fixture"]').click();document.querySelector('[data-hub-sort="name"]').click();const input=document.querySelector('.v2-hub-search input');input.value='Return fixture';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.home-main').scrollTop=450;window.returnScroll=document.querySelector('.home-main').scrollTop;`);
        assert.ok(await evaluate('returnScroll>0'));
        const snapshot=()=>evaluate(`({query:document.querySelector('.v2-hub-search input').value,keys:[...document.querySelectorAll('.v2-hub-grid [data-hub-key]')].map(el=>el.dataset.hubKey),scroll:document.querySelector('.home-main').scrollTop})`);
        const before=await snapshot();
        const openTool=async()=>{
            await evaluate(`document.querySelector('.v2-hub-grid a').click()`);
            await until(`HomeToolFrame.isOpen()&&document.querySelector('.v2-tool-frame-view').contentDocument?.title==='Scrollable tool'`);
        };
        await openTool();
        assert.equal(await evaluate('HomeSkillHub.isOpen()'),false);
        await evaluate(`document.querySelector('[data-frame-act="close"]').click()`);
        assert.equal(await evaluate('HomeSkillHub.isOpen()'),true);
        assert.equal(await evaluate('location.hash'),'#tools');
        assert.deepEqual(await snapshot(),before,'close restores category, query, sort and scroll');
        await openTool();
        await evaluate(`HomeToolFrame.open('/scroll-fixture?tool=second');HomeToolFrame.close()`);
        assert.deepEqual(await snapshot(),before,'switching tools keeps the original return destination');
        await openTool();
        await evaluate('history.back()');
        await until('!HomeToolFrame.isOpen()&&HomeSkillHub.isOpen()');
        assert.deepEqual(await snapshot(),before,'browser back restores the tool menu');
        await evaluate('history.forward()');
        await until('HomeToolFrame.isOpen()');
        await evaluate('HomeToolFrame.close()');
        assert.equal(await evaluate('HomeSkillHub.isOpen()'),true);
        await openTool();
        await evaluate(`document.querySelector('[data-v2-action="newChat"]').click()`);
        assert.equal(await evaluate('HomeToolFrame.isOpen()||HomeSkillHub.isOpen()'),false,'explicit sidebar navigation does not reopen the origin');
        await evaluate(`HomeToolFrame.open('/scroll-fixture?from=chat');HomeToolFrame.close()`);
        assert.equal(await evaluate('HomeSkillHub.isOpen()'),false,'opening from chat returns to chat');
        assert.deepEqual(await evaluate('fixtureErrors'),[]);
        console.log('PASS: tool close returns to origin with filters and scroll; chained tools, browser back/forward, chat entry and explicit sidebar navigation.');
        win.destroy();server.close();app.exit(0);return;
    }
    if(process.env.HOME_TOOL_EXTERNAL_AUDIT)web.get('/custom-tools/external-fixture/index.html',(_,res)=>res.send(require('../backend/models/asset-versioning').injectPlatformTheme('<!doctype html><head></head><a id=rawReport href="/report?month=9#row" target="_blank">Report</a>',{toolPath:'custom-tools/external-fixture/index.html'})));
    if (process.env.HOME_MARKET_THEME_AUDIT) {
        for (const [width,theme,lang] of [[1440,'light','zh-CN'],[1440,'dark','en-US'],[390,'light','zh-CN'],[390,'dark','en-US']]) {
            win.setContentSize(width,900);
            await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${lang}');HomeSkillHub.open('tools');document.getElementById('toolMarketBtn').click();void 0`);
            await until(`document.querySelectorAll('#toolMarketList .tool-market-card').length===5`);
            const state=await evaluate(`(()=>{const modal=document.getElementById('toolMarketModal'),dialog=modal.querySelector('.tool-market-dialog'),r=dialog.getBoundingClientRect();
                return {bg:getComputedStyle(dialog).backgroundColor,title:getComputedStyle(document.querySelector('#toolMarketTitle')).color,
                    opacity:getComputedStyle(modal.querySelector('.is-dimmed')).opacity,scheme:getComputedStyle(modal.querySelector('input')).colorScheme,
                    fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()`);
            assert.equal(state.bg,'rgb(255, 255, 255)');assert.equal(state.title,'rgb(36, 36, 36)');assert.equal(state.opacity,'1');assert.equal(state.fits,true);
            await evaluate(`document.getElementById('toolMarketSettingsBtn').click();void 0`);
            await until(`!!document.querySelector('#toolMarketSources .source-url')`);
            assert.equal(await evaluate(`getComputedStyle(document.querySelector('#toolMarketSources .source-url')).backgroundColor`),'rgb(255, 255, 255)');
            await evaluate(`document.getElementById('toolMarketHelpBtn').click();void 0`);
            await capture('market-'+width+'-'+theme);
            await evaluate(`document.getElementById('toolMarketClose').click();void 0`);
            assert.equal(await evaluate('HomeSkillHub.isOpen()'),true);
        }
        console.log('PASS: market cards/statuses/settings stay light monochrome, readable and in viewport; Chinese/English, light/dark platform, 1440/390px; source page retained. Screenshots: '+temp);
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_WINDOW_EDGE_AUDIT) {
        await until('document.documentElement.classList.contains("is-desktop-app")');
        for (const [width, height] of [[1440, 844], [1000, 640]]) {
            win.setContentSize(width, height);
            for (const theme of ['light', 'dark']) {
                await win.loadURL(`http://127.0.0.1:${server.address().port}/?welcome=updated&version=fixture&from=previous`);
                await until(`window.HomeSkillHub&&document.documentElement.classList.contains('is-desktop-app')&&!!document.querySelector('.tools-dialog-overlay')`);
                await evaluate(`document.documentElement.dataset.theme='${theme}';HomeSkillHub.close();HomeToolFrame.close();HomeMode.set('chat');
                    document.querySelector('#fixtureLongPage')?.remove();document.querySelector('.home-main').insertAdjacentHTML('beforeend','<div id="fixtureLongPage" style="height:1600px"></div>');void 0`);
                await wait(100);
                const geometry = await evaluate(`({viewport:innerWidth,content:document.documentElement.clientWidth,body:document.body.getBoundingClientRect().right,
                    scrollHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,ui:document.documentElement.dataset.ui,
                    scheme:getComputedStyle(document.documentElement).scrollbarWidth,classes:document.documentElement.className,
                    desktopStyle:document.querySelector('#desktopWindowStyles').textContent.includes('scrollbar-width: none !important')})`);
                assert.equal(geometry.content, geometry.viewport, 'desktop root has no reserved right gutter: '+JSON.stringify({width,height,theme,...geometry}));
                assert.ok(Math.abs(geometry.body-geometry.viewport)<1, 'body reaches right edge');
                await evaluate(`window.scrollTo(0,150);void 0`);
                assert.ok(await evaluate('scrollY>0'), 'long welcome pages still scroll');
                await evaluate(`window.scrollTo(0,0);void 0`);
                assert.equal(await evaluate(`document.querySelector('.tools-dialog-overlay').getBoundingClientRect().right`), await evaluate('innerWidth'), 'startup dialog overlay reaches right edge');
                await capture('edge-'+(process.env.DRAG_PLATFORM||'win32')+'-'+theme+'-'+width);
                await evaluate(`document.querySelector('.tools-dialog-close').click();document.querySelector('#fixtureLongPage').remove();void 0`);
            }
        }
        console.log('PASS: desktop '+process.env.DRAG_PLATFORM+' has no right scrollbar gutter, startup overlay reaches the edge, long pages still scroll; light/dark at 1440/1000px. Screenshots: '+temp);
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_DIALOG_RETURN_AUDIT) {
        const pageState = () => evaluate(`({hub:HomeSkillHub.isOpen(),tab:HomeSkillHub.tab(),tool:HomeToolFrame.isOpen(),url:location.href,query:document.querySelector('.v2-hub-search input')?.value,scroll:document.querySelector('.home-main').scrollTop,frameState:document.querySelector('.v2-tool-frame-view')?.contentWindow?.fixtureValue})`);
        const dialogs = [
            ['market', 'toolMarketModal', '#toolMarketClose'],
            ['importTool', 'customToolImportModal', '#customToolImportCancel'],
            ['compare', 'builtinToolsSyncModal', '.builtin-sync-close']
        ];
        for (const width of [1440, 860, 600, 390]) for (const language of ['zh-CN', 'en-US']) {
            win.setContentSize(width,900);
            await evaluate(`document.body.classList.add('v2-side-collapsed');ToolsI18n.setLanguage('${language}');HomeSkillHub.open('tools');document.querySelector('[data-hub-do="addMenu"]').click();void 0`);
            const menu = await evaluate(`(()=>{const item=document.querySelector('#v2SkillHub [data-v2-do="market"]'),range=document.createRange();range.selectNodeContents(item.lastElementChild);
                const rect=item.parentElement.getBoundingClientRect();return {lines:range.getClientRects().length,left:rect.left,right:rect.right,viewport:innerWidth};})()`);
            assert.equal(menu.lines,1,'single-line menu at '+width+'px / '+language);
            assert.ok(menu.left>=0&&menu.right<=menu.viewport,'menu remains in view: '+JSON.stringify(menu));
            await evaluate('HomeSkillHub.close()');
        }
        for (const [width, theme, language] of [[1440, 'light', 'zh-CN'], [390, 'dark', 'en-US']]) {
            win.setContentSize(width, 900);
            await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}');document.body.classList.add('v2-side-collapsed')`);
            for (const source of ['home', 'tools', 'skills', 'plugins', 'frame']) {
                await evaluate(`HomeV2.closePop();HomeToolFrame.close();HomeMode.set('chat');${source === 'frame' ? "HomeToolFrame.open('/scroll-fixture')" : source !== 'home' ? `HomeSkillHub.open('${source}')` : ''}`);
                if (source === 'frame') {
                    await until(`document.querySelector('.v2-tool-frame-view')?.contentDocument?.title==='Scrollable tool'`);
                    await evaluate(`document.querySelector('.v2-tool-frame-view').contentWindow.fixtureValue='keep tool state'`);
                }
                // Keep filter and scroll state as well as the selected page.
                if (['tools', 'skills', 'plugins'].includes(source)) await evaluate(`document.querySelector('.v2-hub-search input').value='fixture filter';document.querySelector('.v2-hub-search input').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#v2SkillHub').insertAdjacentHTML('beforeend','<div style="height:2000px"></div>');document.querySelector('.home-main').scrollTop=125`);
                const before = await pageState();
                for (const [action, modal, close] of dialogs) {
                    if (source === 'tools') {
                        await evaluate(`document.querySelector('[data-hub-do="addMenu"]').click()`);
                        assert.equal(await evaluate(`document.querySelector('#v2SkillHub [data-v2-do="market"]').textContent.trim()`), language === 'zh-CN' ? '查找工具（工具市场）' : 'Find tools (market)');
                        const menuGeometry = await evaluate(`(()=>{const item=document.querySelector('#v2SkillHub [data-v2-do="market"]'),range=document.createRange();
                            range.selectNodeContents(item.lastElementChild);const menu=item.parentElement.getBoundingClientRect();
                            return {lines:range.getClientRects().length,left:menu.left,right:menu.right,viewport:innerWidth,overflow:item.scrollWidth>item.clientWidth};})()`);
                        assert.equal(menuGeometry.lines,1,'market label stays on one line: '+JSON.stringify(menuGeometry));
                        assert.equal(menuGeometry.overflow,false,'market label stays inside the menu');
                        assert.ok(menuGeometry.left>=0&&menuGeometry.right<=menuGeometry.viewport,'menu fits viewport: '+JSON.stringify(menuGeometry));
                        await evaluate(`document.querySelector('#v2SkillHub [data-v2-do="${action}"]').click()`);
                    } else if (action !== 'compare') {
                        await evaluate(`document.getElementById('v2DiscoverBtn').click();document.querySelector('.v2-discover [data-v2-do="${action}"]').click()`);
                    } else await evaluate(`document.getElementById('builtinToolsCompareBtn').click()`);
                    await until(`!!document.getElementById('${modal}') && getComputedStyle(document.getElementById('${modal}')).display!=='none'`);
                    assert.deepEqual(await pageState(), before, `${source}/${action} preserves the source while open (${width}px)`);
                    if (action === 'market') await until(`!document.getElementById('toolMarketRefresh').disabled`);
                    await evaluate(`document.querySelector('${close}').click()`);
                    await until(`!document.getElementById('${modal}') || getComputedStyle(document.getElementById('${modal}')).display==='none'`);
                    assert.deepEqual(await pageState(), before, `${source}/${action} returns to its source (${width}px)`);
                }
                // More/account menus are overlays too, including when opened over an embedded tool.
                for (const selector of ['[data-v2-flyout="more"]', '#v2UserBtn']) {
                    await evaluate(`document.querySelector('${selector}').click()`);
                    assert.deepEqual(await pageState(), before, `${source}/${selector} keeps the source`);
                    await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
                    assert.deepEqual(await pageState(), before, `${source}/${selector} Escape keeps the source`);
                }
            }
        }
        // Escape is handled before existing dialog listeners can hide/remove the overlay.
        await evaluate(`HomeToolFrame.close();HomeMode.set('tools')`);
        for (const closer of ['#customToolImportClose', '#customToolImportModal']) {
            const before = await pageState();
            await evaluate(`document.getElementById('customToolUploadBtn').click();document.querySelector('${closer}').click()`);
            assert.equal(await evaluate(`document.getElementById('customToolImportModal').classList.contains('open')`), false);
            assert.deepEqual(await pageState(), before, closer+' keeps the hub');
        }
        for (const opener of [
            `document.getElementById('customToolUploadBtn').click()`,
            `window.openServiceStatusModal()`,
            `void AppDialog.confirm('Fixture confirmation')`,
            `document.getElementById('v2AlertBtn').click()`,
            `document.getElementById('v2DiscoverBtn').click()`,
            `document.querySelector('[data-hub-do="addMenu"]').click()`
        ]) {
            const before = await pageState();
            await evaluate(opener);
            await wait(50);
            await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
            assert.deepEqual(await pageState(), before, 'Escape preserves the hub behind '+opener);
            await wait(180);
        }
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        assert.equal(await evaluate('HomeSkillHub.isOpen()'), false, 'Escape still leaves the hub when no overlay is open');
        // Real navigation must still leave the source page.
        await evaluate(`HomeMode.set('tools');document.querySelector('[data-v2-action="newChat"]').click()`);
        assert.equal(await evaluate('HomeSkillHub.isOpen()'), false);
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: market/upload/compare preserve home, every hub tab, embedded tool, URL, filters and scroll; Escape closes overlays without leaving the hub; real navigation still works; 1440/390px, Chinese/English, light/dark.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_REQUIREMENTS_AUDIT) {
        // Catalog-independent entries must embed even before asynchronous navigation loads.
        await evaluate(`HomeWorkspace.getTools=()=>[];window.getAllNavItems=()=>[];void 0`);
        assert.equal(await evaluate(`HomeToolFrame.isToolUrl('/requirements?from=menu')`),true);
        assert.equal(await evaluate(`HomeToolFrame.isToolUrl('/pages/requirements.html')`),true);
        assert.equal(await evaluate(`HomeToolFrame.isToolUrl('https://example.test/requirements')`),false);
        await evaluate(`document.querySelector('[data-v2-flyout="more"]').click()`);
        await until(`!!document.querySelector('.v2-flyout [data-v2-do="requirements"]')`);
        await evaluate(`document.querySelector('.v2-flyout [data-v2-do="requirements"]').click()`);
        const check=async()=>{
            await wait(100); // Let a queued close/reopen navigation leave the previous document.
            await until(`(()=>{const f=document.querySelector('.v2-tool-frame-view'),d=f?.contentDocument;return HomeToolFrame.isOpen() && d?.readyState==='complete' && d.documentElement.classList.contains('is-embedded-tool') && d.querySelector('#app-navbar') && d.querySelector('.req-header h1')})()`);
            const state=await evaluate(`(()=>{const f=document.querySelector('.v2-tool-frame-view'),d=f.contentDocument;return {host:location.pathname,app:new URLSearchParams(location.search).get('app'),nav:f.contentWindow.getComputedStyle(d.querySelector('#app-navbar')).display,title:d.querySelector('.req-header h1').textContent}})()`);
            assert.equal(state.host,'/','host remains the new homepage');
            assert.equal(state.app,'/requirements');
            assert.equal(state.nav,'none','old navbar hidden in real requirements page');
            assert.ok(state.title.includes('需求管理广场'));
        };
        await check();
        await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until(`!!window.HomeToolFrame`);await check();
        await evaluate(`HomeToolFrame.close();document.body.insertAdjacentHTML('beforeend','<a id="fixtureRequirements" href="/requirements">Requirements</a>');document.getElementById('fixtureRequirements').click()`);
        await check();
        assert.deepEqual(await evaluate('fixtureErrors'),[]);
        console.log('PASS: Requirements menu and anchor embed without catalog data; real page hides legacy navbar; host stays on homepage; reload restores embedded page.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_FEATURED_AUDIT) {
        await evaluate(`window.HomeWorkspace.getTools=()=>Array.from({length:6},(_,i)=>({id:'fixture-'+i,title:'Fixture '+i,href:'/tools/fixture-'+i,group:i<3?'A':'B'}));void 0`);
        for (const width of [1440,600]) {
            win.setContentSize(width,1000);
            await evaluate(`document.body.classList.add('v2-side-collapsed');HomeSkillHub.open('tools')`);
            await wait(200);
            const snapshot=()=>evaluate(`(()=>{const f=document.querySelector('.v2-hub-featured');return {hidden:f.hidden,keys:[...f.querySelectorAll('[data-hub-key]')].map(el=>el.dataset.hubKey),top:document.querySelector('.v2-hub-bar').getBoundingClientRect().top}})()`);
            const initial=await snapshot();assert.equal(initial.hidden,false);
            const check=async()=>assert.deepEqual(await snapshot(),initial,'shortcuts and category position remain stable at '+width+'px');
            for (const region of ['featured', 'grid']) {
                await evaluate(`document.querySelector('.v2-hub-${region} [data-hub-act="more"] svg').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));void 0`);
                assert.equal(await evaluate('HomeToolMenu.isOpen() && !HomeToolFrame.isOpen()'),true,'clicking the icon opens the card menu without navigating');
                await evaluate('HomeToolMenu.close()');
            }
            for(const category of ['A','B','all']) {
                await evaluate(`document.querySelector('[data-hub-cat="${category}"]').click()`);
                await check();
                assert.equal(await evaluate(`document.querySelectorAll('.v2-hub-grid [data-hub-key]').length`), category==='all'?6:3, 'category still filters results');
            }
            await evaluate(`document.querySelector('[data-hub-do="mine"]').click()`);
            await check();assert.equal(await evaluate(`document.querySelectorAll('.v2-hub-grid [data-hub-key]').length`),0,'favorites only changes results');
            assert.equal(await evaluate(`document.querySelector('[data-hub-cat="all"] em').textContent`),'0','category count reflects the favorites filter');
            await evaluate(`document.querySelector('[data-hub-do="mine"]').click();document.querySelector('.v2-hub-search input').value='unmatched fixture';document.querySelector('.v2-hub-search input').dispatchEvent(new Event('input',{bubbles:true}))`);
            await check();assert.equal(await evaluate(`document.querySelectorAll('.v2-hub-grid [data-hub-key]').length`),0,'empty search only changes results');
            assert.equal(await evaluate(`document.querySelector('[data-hub-cat="all"] em').textContent`),'0','category count reflects the search filter');
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
    if (process.env.HOME_WORKSPACE_SCOPE_AUDIT) {
        // The right workspace belongs to the conversation: hidden on the skills hub / tool pages
        // (including a channel card borrowing the panel), back with the same content in chat.
        win.setContentSize(1440, 900);await wait(60);
        await until('window.DragonClawWorkspace && document.getElementById("dcWorkspacePanel")');
        await evaluate(`document.body.classList.add('dc-chatting');(()=>{const body=DragonClawWorkspace.showExternal({title:'会话任务',meta:'3',open:true});body.innerHTML='<p id="fixtureExternal">定时任务</p>'})();void 0`);
        await wait(120);
        const state = () => evaluate(`(()=>{const p=document.getElementById('dcWorkspacePanel');const cols=getComputedStyle(document.querySelector('.home-content.home-workspace')).gridTemplateColumns.split(' ').length;return {open:document.body.classList.contains('dc-workspace-open'),hidden:p.hidden,visible:p.getClientRects().length>0,cols,external:!!document.getElementById('fixtureExternal')}})()`);
        let ws = await state();
        assert.ok(ws.open && ws.visible && ws.cols === 3 && ws.external, 'chat shows the borrowed workspace '+JSON.stringify(ws));
        await evaluate(`HomeSkillHub.open('tools')`);await wait(200);
        ws = await state();
        assert.ok(!ws.open && ws.hidden && !ws.visible && ws.cols === 2, 'skills hub hides the workspace '+JSON.stringify(ws));
        if (process.env.HOME_WORKSPACE_SCOPE_SHOT) fs.writeFileSync(process.env.HOME_WORKSPACE_SCOPE_SHOT, (await win.webContents.capturePage()).toPNG());
        await evaluate('HomeSkillHub.close()');await wait(200);
        ws = await state();
        assert.ok(ws.open && ws.visible && ws.cols === 3 && ws.external, 'back in chat the same workspace returns '+JSON.stringify(ws));
        // Tool pages behave the same way.
        await evaluate(`window.dispatchEvent(new CustomEvent('home:tool-frame',{detail:{open:true}}))`);await wait(80);
        assert.equal((await state()).visible, false, 'tool page hides the workspace');
        await evaluate(`window.dispatchEvent(new CustomEvent('home:tool-frame',{detail:{open:false}}))`);await wait(80);
        assert.equal((await state()).visible, true, 'closing the tool brings it back');
        // Toggling while hidden keeps the user's state: closing in chat stays closed after the hub.
        await evaluate(`DragonClawWorkspace.hideExternal();void 0`);await wait(80);
        assert.equal((await state()).visible, false, 'releasing the borrowed card closes it');
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: the right workspace shows only in conversation: hidden on the skills hub and tool pages (even when a channel card borrows it), restored with the same content in chat.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_SIDE_PEEK_AUDIT) {
        const shot = async name => { if (process.env.HOME_SIDE_PEEK_SHOT) fs.writeFileSync(`${process.env.HOME_SIDE_PEEK_SHOT}-${name}.png`, (await win.webContents.capturePage()).toPNG()); };
        const macDesktop = Boolean(process.env.DESKTOP_DRAG_AUDIT) && process.env.DRAG_PLATFORM === 'darwin';
        const winDesktop = Boolean(process.env.DESKTOP_DRAG_AUDIT) && !macDesktop;
        if (process.env.DESKTOP_DRAG_AUDIT) await until(`document.documentElement.classList.contains('${macDesktop ? 'desktop-mac' : 'desktop-win'}')`);
        win.setContentSize(1280, 820);await wait(60);
        const rect = sel => evaluate(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {left:Math.round(r.left),top:Math.round(r.top),width:Math.round(r.width),right:Math.round(r.right)}})()`);
        const geo = () => evaluate(`(()=>{const side=document.getElementById('homeSidebar'),s=getComputedStyle(side),r=side.getBoundingClientRect(),f=document.querySelector('.v2-side-float');
            return {peek:document.body.classList.contains('v2-side-peek'),collapsed:document.body.classList.contains('v2-side-collapsed'),sideVisible:s.visibility==='visible'&&s.display!=='none',sideLeft:Math.round(r.left),sideWidth:Math.round(r.width),
                mainLeft:Math.round(document.querySelector('.home-main').getBoundingClientRect().left),mainWidth:Math.round(document.querySelector('.home-main').getBoundingClientRect().width),float:getComputedStyle(f).display!=='none',floatButtons:f.querySelectorAll('button').length,
                newChatOpacity:+getComputedStyle(f.querySelector('[data-v2-float="newChat"]')).opacity}})()`);
        // The expanded sidebar's own toggle sits first in its top row.
        const expandedToggle = await rect('#v2SideToggle');
        // Click collapse with the real mouse and keep the pointer there: the floating toggle appears
        // under it, but the sidebar must disappear right away (no accidental peek).
        await win.webContents.debugger.attach('1.3');
        const mouse = async (type, x, y) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...(type === 'mouseMoved' ? { button: 'none' } : {}) });
        const cx = expandedToggle.left + 14, cy = expandedToggle.top + 14;
        await mouse('mouseMoved', cx, cy);await wait(80);
        await mouse('mousePressed', cx, cy);await mouse('mouseReleased', cx, cy);
        await wait(80);await mouse('mouseMoved', cx + 1, cy);await wait(500);
        let g = await geo();
        assert.ok(g.collapsed && !g.peek && !g.sideVisible, 'clicking collapse hides the sidebar immediately '+JSON.stringify(g));
        // Moving away and back onto the button peeks as usual.
        await mouse('mouseMoved', 600, 400);await wait(450);
        await mouse('mouseMoved', cx, cy);await wait(420);
        assert.equal((await geo()).peek, true, 'hovering again slides it in');
        await mouse('mouseMoved', 900, 500);await wait(700);
        assert.equal((await geo()).peek, false, 'and out again');
        await win.webContents.debugger.detach();
        g = await geo();
        assert.ok(g.collapsed && !g.sideVisible && g.mainLeft === 0 && g.mainWidth >= 1270 && g.float && g.floatButtons === 2, 'collapsed: sidebar fully hidden, content full width, two floating buttons '+JSON.stringify(g));
        const floatToggle = await rect('.v2-side-float [data-v2-float="toggle"]');
        const floatNewRect = await rect('.v2-side-float [data-v2-float="newChat"]');
        assert.equal(floatToggle.width, winDesktop ? 36 : 32, 'comfortable targets');
        assert.ok(floatNewRect.left - floatToggle.right >= 8, 'buttons spaced apart to avoid mis-clicks '+JSON.stringify({floatToggle,floatNewRect}));
        if (!winDesktop) assert.deepEqual([floatToggle.left, floatToggle.top], [expandedToggle.left, expandedToggle.top], 'floating toggle sits exactly where the sidebar toggle was');
        if (macDesktop) assert.ok(floatToggle.left >= 76, 'clear of the traffic lights');
        if (winDesktop) {
            assert.equal(floatToggle.left, 12);
            assert.equal(floatToggle.top, 6);
        }
        await shot('collapsed');
        // Hover: the sidebar slides in as an overlay; content does not move.
        await evaluate(`document.querySelector('.v2-side-float [data-v2-float="toggle"]').dispatchEvent(new MouseEvent('mouseenter'))`);
        await wait(420);
        g = await geo();
        assert.ok(g.peek && g.sideVisible && g.sideLeft === 0 && g.sideWidth > 200 && g.mainLeft === 0 && g.mainWidth >= 1270 && g.newChatOpacity === 0, 'peek overlay '+JSON.stringify(g));
        const peekToggle = await rect('#v2SideToggle');
        if (!winDesktop) assert.deepEqual([peekToggle.left, peekToggle.top], [floatToggle.left, floatToggle.top], 'peeked sidebar toggle lines up under the floating one');
        assert.equal(await evaluate(`document.querySelector('.v2-float-tip').classList.contains('is-open')`), true, 'tooltip shows on hover');
        assert.match(await evaluate(`document.querySelector('.v2-float-tip').textContent`), /展开侧栏(⌘B|Ctrl\+B)/);
        await shot('peek');
        // Leaving the button (not onto the sidebar) slides it back.
        await evaluate(`document.querySelector('.v2-side-float [data-v2-float="toggle"]').dispatchEvent(new MouseEvent('mouseleave'))`);
        await wait(700);
        g = await geo();
        assert.ok(!g.peek && !g.sideVisible, 'peek ends after the pointer leaves '+JSON.stringify(g));
        // A menu opened from the peeked sidebar keeps it out until the menu closes.
        await evaluate(`document.querySelector('.v2-side-float [data-v2-float="toggle"]').dispatchEvent(new MouseEvent('mouseenter'))`);await wait(400);
        await evaluate(`document.getElementById('v2UserBtn').click()`);await wait(60);
        await evaluate(`document.getElementById('homeSidebar').dispatchEvent(new MouseEvent('mouseleave'))`);await wait(700);
        assert.equal((await geo()).peek, true, 'kept while a menu from the sidebar is open');
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await wait(700);
        assert.equal((await geo()).peek, false, 'Escape closes the menu and the peek');
        await evaluate(`document.body.classList.add('dc-chatting');void 0`);await wait(80);
        const head = await evaluate(`(()=>{const h=document.querySelector('.dc-chat-head');const first=[...h.children].find(c=>c.getClientRects().length);const f=document.querySelector('.v2-side-float').getBoundingClientRect();return {headLeft:first?first.getBoundingClientRect().left:null,floatRight:f.right}})()`);
        assert.ok(head.headLeft >= head.floatRight + 8, 'chat title starts after the buttons '+JSON.stringify(head));
        await shot('chat');
        await evaluate(`document.body.classList.remove('dc-chatting');void 0`);
        // New chat from any screen.
        await evaluate(`document.querySelector('.v2-nav-item[data-v2-action="skillHub"]').click()`);await wait(400);
        await shot('hub');
        // Headers clear the floating buttons: the hub starts below them, the chat title to their right.
        const clear = await evaluate(`(()=>{const f=document.querySelector('.v2-side-float').getBoundingClientRect();const tabs=document.querySelector('.v2-hub-top').getBoundingClientRect();return {floatBottom:f.bottom,floatRight:f.right,hubTop:tabs.top}})()`);
        assert.ok(clear.hubTop >= clear.floatBottom + 8, 'hub content below the buttons '+JSON.stringify(clear));
        await evaluate(`document.querySelector('.v2-side-float [data-v2-float="newChat"]').click()`);await wait(150);
        assert.equal(await evaluate(`document.querySelector('.v2-nav-item[data-v2-action="newChat"]').classList.contains('is-active')`), true, 'new chat from the floating button');
        // Clicking the floating toggle restores the docked sidebar.
        await evaluate(`document.querySelector('.v2-side-float [data-v2-float="toggle"]').click()`);await wait(350);
        g = await geo();
        assert.ok(!g.collapsed && g.sideVisible && g.mainLeft >= 200 && !g.float, 'restored '+JSON.stringify(g));
        // ⌘B / Ctrl+B toggles.
        const key = `new KeyboardEvent('keydown',{key:'b',metaKey:true,bubbles:true})`;
        await evaluate(`document.dispatchEvent(${key})`);await wait(80);
        assert.equal((await geo()).collapsed, true, 'shortcut collapses');
        await evaluate(`document.dispatchEvent(${key})`);await wait(80);
        assert.equal((await geo()).collapsed, false, 'shortcut restores');
        if (process.env.DESKTOP_DRAG_AUDIT) {
            // Global settings clears the window controls (Mac traffic lights / Windows caption buttons).
            await evaluate(`window.openNavSettingsModal?.();void 0`);
            await until(`getComputedStyle(document.getElementById('navSettingsModal')||document.body).display==='flex'`);
            const box = await evaluate(`(()=>{const r=document.querySelector('.nav-settings-window').getBoundingClientRect();return {top:r.top,bottom:r.bottom,viewport:innerHeight}})()`);
            assert.ok(box.top >= 40 && box.bottom <= box.viewport - 20, 'settings window below the window controls '+JSON.stringify(box));
            await evaluate(`document.getElementById('navSettingsModal').style.display='none';void 0`);
        }
        // Narrow windows: collapsed sidebar is hidden, buttons remain, no hover peek.
        await evaluate(`document.dispatchEvent(${key})`);
        win.setContentSize(700, 820);await wait(150);
        await evaluate(`document.querySelector('.v2-side-float [data-v2-float="toggle"]').dispatchEvent(new MouseEvent('mouseenter'))`);await wait(200);
        g = await geo();
        assert.ok(g.float && !g.peek && !g.sideVisible, 'narrow: no peek '+JSON.stringify(g));
        win.setContentSize(1280, 820);await wait(100);
        await evaluate(`document.dispatchEvent(${key})`);
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: collapsing hides the sidebar behind two top-left buttons (toggle aligned with the docked toggle'+(macDesktop?', clear of Mac traffic lights':'')+'); hovering slides it in as an overlay with a tooltip and shortcut, leaving slides it out, open menus keep it, click or the shortcut restores it, new chat works anywhere, narrow windows do not peek.');
        win.destroy();server.close();app.exit(0);return;
    }
    if (process.env.HOME_SCAN_AUDIT) {
        const isOpen = () => evaluate(`document.querySelector('.v2-scan').classList.contains('is-open') && document.getElementById('v2ScanBtn').getAttribute('aria-expanded')==='true'`);
        await evaluate(`document.getElementById('v2ScanBtn').dispatchEvent(new MouseEvent('mouseenter'))`);
        await wait(360);
        assert.equal(await isOpen(), true, 'hover opens scan dialog');
        await until(`!!document.querySelector('[data-scan-action="relogin-welink"]')`);
        await evaluate(`document.getElementById('v2ScanBtn').click()`);
        assert.equal(await isOpen(), false, 'click toggles dialog closed');
        await evaluate(`document.getElementById('v2ScanBtn').click()`);
        assert.equal(await isOpen(), true, 'click toggles dialog open');
        assert.equal(await evaluate(`document.querySelectorAll('.v2-scan [data-scan-tab]').length`), 3, 'three scan entries');
        for (const tab of ['weixin', 'welinkbot', 'welink', 'weixin']) {
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
        assert.equal(await isOpen(), true, 'immediately leaving does not dismiss (debounce delay)');
        await wait(320);
        assert.equal(await isOpen(), false, 'delayed leave auto-dismisses');
        await evaluate(`document.getElementById('v2ScanBtn').click()`);assert.equal(await isOpen(), true, 'click can reopen');
        await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await isOpen(), false, 'Escape closes');
        await evaluate(`document.getElementById('v2ScanBtn').dispatchEvent(new MouseEvent('mouseenter'))`);
        await wait(360);
        assert.equal(await isOpen(), true, 'hover reopens');
        await evaluate(`document.getElementById('v2DiscoverBtn').click()`);assert.equal(await isOpen(), false, 'another menu closes scan dialog');
        // WeLink 助理：已对接时显示助理信息；刷新后出二维码
        await evaluate(`document.getElementById('v2ScanBtn').click()`);
        await evaluate(`document.querySelector('[data-scan-tab="welinkbot"]').click()`);
        await until(`!!document.querySelector('[data-scan-action="relogin-welinkbot"]')`);
        assert.match(await evaluate(`document.querySelector('.v2-scan').textContent`), /平台助理/);
        await evaluate(`document.querySelector('[data-scan-action="relogin-welinkbot"]').click()`);
        await until(`!!document.querySelector('.v2-scan .v2-scan-qr-box svg')`);
        assert.match(await evaluate(`document.querySelector('.v2-scan').textContent`), /Channel GDEClaw/);
        if (process.env.HOME_SCAN_SHOT) fs.writeFileSync(process.env.HOME_SCAN_SHOT.replace(/\.png$/, '-bot.png'), (await win.webContents.capturePage()).toPNG());
        scanExtranet = true;
        await evaluate(`document.querySelector('[data-scan-action="relogin-welinkbot"]').click()`);
        await until(`!!document.querySelector('.v2-scan') && /仅限内网使用/.test(document.querySelector('.v2-scan').textContent)`);
        scanExtranet = false;
        await evaluate('document.body.click()');
        // 外网：只显示「仅限内网使用」与重新检测，不自动发起扫码
        scanExtranet = true;const loginsBefore = welinkLogins;
        await evaluate(`document.querySelector('[data-scan-tab="welink"]').click()`);
        await evaluate(`document.getElementById('v2ScanBtn').dispatchEvent(new MouseEvent('mouseenter'))`);
        await wait(360);
        await until(`!!document.querySelector('[data-scan-action="recheck-welink"]')`);
        assert.match(await evaluate(`document.querySelector('.v2-scan').textContent`), /仅限内网使用/);
        assert.equal(await evaluate(`!!document.querySelector('.v2-scan [data-scan-action="relogin-welink"]')`), false);
        await evaluate(`document.querySelector('[data-scan-action="recheck-welink"]').click()`);await wait(150);
        await until(`!!document.querySelector('[data-scan-action="recheck-welink"]')`);
        assert.equal(welinkLogins, loginsBefore, 'no QR login is attempted off the intranet');
        if (process.env.HOME_SCAN_SHOT) fs.writeFileSync(process.env.HOME_SCAN_SHOT, (await win.webContents.capturePage()).toPNG());
        await wait(150);
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: scan hover opens; click, WeChat/WeLink tabs and refresh remain open; outside click, Escape and other menu dismiss; WeLink assistant shows its bot, a GDEClaw QR and the intranet notice; off the intranet WeLink shows the intranet-only notice without starting a QR login.');
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
    await until('window.HomeSkillHub?.isOpen()');
    assert.equal(await evaluate('document.documentElement.dataset.ui'),'v2','old ui=v1 links migrate to the new layout');
    assert.equal(await evaluate('localStorage.getItem("tools_home_ui")'),'v2');
    assert.equal(await evaluate('!!document.querySelector("[data-v2-do=classic]")'),false);
    console.log('PASS: shared tools hub, filters, navigation, themes/English/390px, and migration of legacy layout links. Previews: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
