// Run: node_modules/.bin/electron tests/home-composer-browser.cjs
// Composer alignment audit: HOME_COMPOSER_DOCK_AUDIT=1 node_modules/.bin/electron tests/home-composer-browser.cjs
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
        localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_token','fixture-session');localStorage.setItem('tools_lang','zh-CN');
        window.fixtureIntervals=[];const originalInterval=window.setInterval;window.setInterval=(fn,delay,...args)=>{if(delay>=10000)fixtureIntervals.push({fn,delay});return originalInterval(fn,delay,...args)};
        window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
    </script>`)));
    web.get('/api/ai/speech', (_,res)=>res.json(process.env.HOME_VOICE_PREVIEW?{enabled:true,source:{id:'gemini',label:'Gemini · gemini-3.1-flash-lite'}}:{enabled:false,error:'语音未配置'}));
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
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await until('!!window.HomeComposer&&!!document.querySelector(".dc-permission-picker")&&!!document.querySelector(".v2-suggest-item")&&!!window.HomePromoPlayer');
    if(process.env.HOME_VOICE_PREVIEW){
        await evaluate(`window.voiceAudio=new AudioContext();const oscillator=voiceAudio.createOscillator(),destination=voiceAudio.createMediaStreamDestination();oscillator.connect(destination);oscillator.start();Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>destination.stream.clone()},configurable:true});`);
        for(const width of [1440,390])for(const external of [false,true]){
            win.setContentSize(width,950);await wait(180);
            await evaluate(`DragonClaw.exitExternal();${external?"DragonClaw.enterExternal({owner:'voice-fixture',composer:{canSend:true,placeholder:'WorkBuddy'}})":""};dcInput.value='测试，测试。';dcInput.dispatchEvent(new Event('input',{bubbles:true}));`);
            await until('!dcVoice.disabled');const before=await evaluate('dcComposer.getBoundingClientRect().height');await evaluate('dcVoice.click()');await until('dcVoice.classList.contains("is-recording")');
            assert.equal(await evaluate('document.querySelectorAll(".chat-voice-session").length'),0,'recording never adds a prompt panel');
            assert.ok(Math.abs(await evaluate('dcComposer.getBoundingClientRect().height')-before)<2,'recording does not increase composer height');
            assert.equal(await evaluate('document.querySelector(".chat-voice-source").textContent.includes("Gemini")'),true);
            const rect=await evaluate('(()=>{const r=dcVoice.getBoundingClientRect();return{left:r.left,right:r.right,width:innerWidth}})()');assert.ok(rect.left>=0&&rect.right<=rect.width);
            assert.equal(await evaluate('dcVoice.dataset.voiceSource'), 'gemini');
            assert.equal(await evaluate('getComputedStyle(dcVoice,"::before").content'), '""');
            assert.ok(await evaluate('document.querySelector(".chat-voice-source").getBoundingClientRect().width')<=1,'source text takes no visible row space');
            await capture(`voice-compact-${width}-${external?'external':'normal'}`);await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
        }
        assert.deepEqual(await evaluate('fixtureErrors'),[]);win.destroy();server.close();console.log('PASS: compact recording button, source halo, stable composer height, 390/1440px and ordinary/external chats. '+temp);app.exit(0);return;
    }
    if (process.env.HOME_COMPOSER_DOCK_AUDIT) {
        for (const mode of ['model', 'no-model', 'external']) {
            await evaluate(`DragonClaw.exitExternal();${mode === 'external' ? "DragonClaw.enterExternal({owner:'workbuddy-fixture',composer:{canSend:true,placeholder:'WorkBuddy running'}})" : `dcModel.hidden=${mode === 'no-model'}`};void 0`);
            for (const width of [1440, 390]) for (const theme of ['light', 'dark']) for (const text of ['', '1']) {
                win.setContentSize(width, 1000);
                await until(`innerWidth===${width}`);
                await evaluate(`document.documentElement.dataset.theme='${theme}';dcInput.value=${JSON.stringify(text)};dcInput.dispatchEvent(new Event('input',{bubbles:true}));`);
                const geometry = await evaluate(`(()=>{
                    const voice=dcVoice.getBoundingClientRect(),send=dcSend.getBoundingClientRect(),enhance=dcEnhance.getBoundingClientRect();
                    const bar=document.querySelector('.dc-composer-bar').getBoundingClientRect();
                    const voiceStart=voice.left;
                    return {voiceGap:send.left-voice.right,enhanceGap:voiceStart-enhance.right,rightGap:bar.right-send.right,
                        gap:parseFloat(getComputedStyle(document.querySelector('.dc-composer-bar')).columnGap),
                        enhanceHidden:dcEnhance.hidden,modelHidden:dcModel.hidden};
                })()`);
                const context = JSON.stringify({mode,width,theme,text,geometry});
                assert.ok(Math.abs(geometry.voiceGap-geometry.gap)<1, 'voice stays beside send: '+context);
                assert.ok(Math.abs(geometry.rightGap)<1, 'send stays at the right edge: '+context);
                assert.equal(geometry.enhanceHidden,!text,'enhancement follows input: '+context);
                if (mode !== 'model' && text) assert.ok(Math.abs(geometry.enhanceGap-geometry.gap)<1,'enhancement stays beside voice controls: '+context);
                if (mode === 'external' && width === 1440 && theme === 'light') await capture(text ? 'external-filled-docked' : 'external-empty-docked');
            }
        }
        assert.deepEqual(await evaluate('fixtureErrors'), []);
        console.log('PASS: enhancement, voice and send stay together at the right edge for normal, model-free and external sessions, empty/filled drafts, light/dark and 1440/390px. Screenshots: '+temp);
        win.destroy(); server.close(); app.exit(0); return;
    }
    await evaluate(`document.getAnimations().forEach(a=>{try{a.finish()}catch{}})`);
    assert.equal(await evaluate('dcModelName.textContent'), models[0].name);
    await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===40');
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),6);
    assert.equal(await evaluate('getComputedStyle(homeChatList).overflowY'),'visible');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".conversation-list-toolbar")).display'),'none');
    await evaluate('document.querySelector("#homeChatList .v2-list-expand").click()');
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),12);
    await evaluate('document.querySelector("[data-chat-section=tasks]").click()');
    await until('document.querySelector("[data-chat-section=tasks]").getAttribute("aria-expanded")==="false"');
    assert.equal(await evaluate('document.querySelector("#homeChatList .home-chat-title").textContent'),'研究依据核对 Skill');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#homeChatList .home-chat-section-body")).display'),'none');
    await evaluate('document.querySelector("[data-chat-section=tasks]").click()');
    await until('document.querySelector("[data-chat-section=tasks]").getAttribute("aria-expanded")==="true"');
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),6,'top-level collapse resets expansion');
    await evaluate('for(let i=0;i<4;i++)document.querySelector("[data-chat-section=tasks]").click()');
    assert.equal(await evaluate('document.querySelector("[data-chat-section=tasks]").getAttribute("aria-expanded")'),'true');
    await evaluate(`document.querySelector('#homeChatList .conversation-list-row').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:400}));`);
    assert.equal(await evaluate('document.querySelectorAll(".conversation-context-menu [role=menuitem]").length'),4);
    await evaluate('HomeConversationList.close()');
    assert.equal(sessionPages,0,'scrolling and initial expansion never fetch extra pages');
    await evaluate('for(let i=0;i<6;i++)document.querySelector("#homeChatList .v2-list-expand").click()');
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),40);
    await evaluate('document.querySelector("#homeChatList .v2-list-expand").click()');
    await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===55');
    assert.equal(sessionPages,1);
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),46);
    await evaluate('window.dispatchEvent(new CustomEvent("home:conversation-list-changed",{detail:{source:"mine"}}))');
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),46,'list refresh preserves expansion');
    await evaluate('HomeConversationList.setFilter({status:"pinned"});HomeConversationList.setFilter({status:"all"})');
    assert.equal(await evaluate('document.querySelectorAll("#homeChatList .conversation-list-row:not([hidden])").length'),6);

    assert.equal(await evaluate(`!document.querySelector('.home-main').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`),true);
    assert.equal(await evaluate(`dcInput.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`),true);
    await evaluate('homeSidebarResizer.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
    assert.equal(await evaluate('Math.round(homeSidebar.getBoundingClientRect().width)'),256);
    await evaluate('homeSidebarResizer.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    assert.equal(await evaluate('Math.round(homeSidebar.getBoundingClientRect().width)'),240);
    await evaluate(`document.querySelector('.v2-suggest-item').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));`);
    assert.equal(await evaluate('dcInput.value'), '');
    assert.equal(await evaluate('dcInput.placeholder===document.querySelector(".v2-suggest-item").dataset.fill'),true);
    assert.equal(await evaluate('dcSend.disabled'),true,'hover preview is not a sendable draft');
    await evaluate(`document.querySelector('.v2-suggest').dispatchEvent(new PointerEvent('pointerleave'));`);
    assert.equal(await evaluate('dcInput.classList.contains("is-prompt-preview")'),false);

    win.webContents.debugger.attach('1.3');
    const divider = await evaluate('homeSidebarResizer.getBoundingClientRect().toJSON()');
    const x = Math.round(divider.x + divider.width/2), y = Math.round(divider.y + divider.height/2);
    const mouse = params => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',params);
    await mouse({type:'mouseMoved',x,y});
    await wait(180);
    assert.ok(await evaluate('parseFloat(getComputedStyle(homeSidebarResizer,"::after").height)>800'),'resize glow spans the sidebar');
    assert.notEqual(await evaluate('getComputedStyle(homeSidebarResizer,"::after").boxShadow'),'none');
    await mouse({type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    await mouse({type:'mouseMoved',x:x+64,y,button:'left',buttons:1});
    await mouse({type:'mouseReleased',x:x+64,y,button:'left',buttons:0,clickCount:1});
    assert.equal(await evaluate('Math.round(homeSidebar.getBoundingClientRect().width)'),304);
    await evaluate('homeSidebarResizer.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}))');
    win.webContents.debugger.detach();
    const alignment = await evaluate(`(()=>{const left=s=>document.querySelector(s).getBoundingClientRect().left;return {nav:left('.v2-nav-item .v2-ico'),heading:left('.home-chat-category-chevron'),title:left('.home-chat-title')}})()`);
    assert.ok(Math.abs(alignment.heading-alignment.nav)<1);
    assert.ok(Math.abs(alignment.title-alignment.nav)<1);
    await capture('sidebar-expanded-light');
    await evaluate(`document.querySelector('.v2-suggest-item').click()`);
    assert.ok(await evaluate('dcInput.value.length>40'));
    const appearance = await evaluate(`(()=>{const style=getComputedStyle(dcInput),bar=document.querySelector('.dc-composer-bar').getBoundingClientRect(),surface=document.querySelector('.dc-composer-surface').getBoundingClientRect(),context=dcWorkspaceChip.getBoundingClientRect();return {outline:style.outlineStyle,border:style.borderWidth,barBottom:bar.bottom,surfaceBottom:surface.bottom,contextBottom:context.bottom}})()`);
    assert.equal(appearance.outline, 'none'); assert.equal(appearance.border, '0px');
    assert.ok(appearance.barBottom<=appearance.surfaceBottom); assert.ok(appearance.contextBottom>appearance.surfaceBottom);
    await capture('recent-filled-light');
    const previewBox = await evaluate(`(()=>{const surface=document.querySelector('.dc-composer-surface').getBoundingClientRect(),context=dcWorkspaceChip.getBoundingClientRect();return {x:Math.floor(surface.x-12),y:Math.floor(surface.y-12),width:Math.ceil(surface.width+24),height:Math.ceil(context.bottom-surface.y+24)}})()`);
    fs.writeFileSync(path.join(temp,'composer-filled-preview.png'),(await win.webContents.capturePage(previewBox)).toPNG());
    assert.equal(await evaluate('dcEnhance.hidden'), false);
    assert.equal(await evaluate('!!dcModelBtn.querySelector("[data-model-family=deepseek]")'), true);
    await evaluate(`window.originalDraft=dcInput.value;dcEnhance.click()`);
    assert.equal(await evaluate('dcEnhance.getAttribute("aria-busy")'), 'true');
    await until('dcEnhance.getAttribute("aria-busy")==="false"&&dcInput.value!==originalDraft');
    assert.equal(enhanceCalls.at(-1).modelId,models[0].id);
    assert.equal(await evaluate('document.body.classList.contains("dc-chatting")'),false,'enhancement never submits a chat');
    assert.equal(await evaluate('dcEnhance.getAttribute("aria-label")'),'恢复原文');
    await evaluate('dcEnhance.click()');
    assert.equal(await evaluate('dcInput.value===originalDraft'),true);
    enhanceMode='error'; await evaluate('dcEnhance.click()');await until('dcEnhance.getAttribute("aria-busy")==="false"');
    assert.equal(await evaluate('dcInput.value===originalDraft'),true,'failed requests preserve the original');
    enhanceMode='slow';await evaluate('dcEnhance.click();dcInput.value+=" 手工补充";dcInput.dispatchEvent(new Event("input",{bubbles:true}));');
    await wait(280);assert.equal(await evaluate('dcInput.value===originalDraft+" 手工补充"'),true,'late rewrites never overwrite edits');
    enhanceMode='normal';await evaluate('dcInput.value=originalDraft;dcInput.dispatchEvent(new Event("input",{bubbles:true}));window.voiceRequests=0;Object.defineProperty(navigator,"mediaDevices",{value:{getUserMedia:()=>{voiceRequests++;return Promise.reject(new Error("Unexpected microphone request"))}},configurable:true});dcVoice.click();');
    assert.equal(await evaluate('voiceRequests'),0,'unconfigured speech service does not request microphone access');
    await evaluate('dcModelBtn.click()');
    assert.equal(await evaluate('dcModelMenu.hidden'), false);
    assert.equal(await evaluate('dcModelMenu.textContent.includes("Aragon")'), false);
    assert.equal(await evaluate('dcModelMenu.textContent.includes("anthropic")'), true);
    await capture('model-picker-light');
    await evaluate(`document.querySelector('[data-dc-configure-model]').click()`);
    await until('!!document.getElementById("navAiModel")');
    assert.equal(await evaluate('document.activeElement.id'),'navAiModel','shortcut opens the actual existing model configuration');
    assert.equal(await evaluate('dcInput.value===originalDraft'),true,'settings preserves the draft');
    await evaluate('closeNavSettingsModal()');
    assert.equal(await evaluate('document.activeElement===dcModelBtn'),true);
    await evaluate('dcModelBtn.click()');
    await evaluate(`document.querySelector('[data-dc-model="profile:other"]').click()`);
    assert.equal(await evaluate('dcModelName.textContent'), models[1].name);
    await evaluate('dcAttach.click()');
    assert.equal(await evaluate('dcAttachMenu.hidden'), false);
    assert.equal(await evaluate('dcAttach.getAttribute("aria-expanded")'), 'true');
    await capture('context-menu-light');
    const beforeSkillMenu = await evaluate('dcInput.value');
    await evaluate(`document.querySelector('[data-composer-action="skills"]').click()`);
    await until('!!document.querySelector("[data-composer-skill]")');
    assert.equal(await evaluate('dcInput.value'), beforeSkillMenu);
    assert.equal(await evaluate('dcSkillMenu.hidden'), true);
    await evaluate(`document.querySelector('[data-composer-skill]').click()`);
    assert.equal(await evaluate('dcInput.value.includes("@research-check")'), true);
    await evaluate(`document.querySelector('.dc-directory-picker summary').click()`);
    await until('document.querySelector(".dc-directory-picker").open');
    assert.equal(await evaluate('document.querySelectorAll(".dc-context-recents button").length'), 2);
    await evaluate(`const field=document.querySelector('[data-wsp-recent-search]');field.value='reports';field.dispatchEvent(new Event('input',{bubbles:true}));`);
    assert.equal(await evaluate('document.querySelectorAll(".dc-context-recents button:not([hidden])").length'), 1);
    await capture('workspace-menu-light');
    await evaluate(`document.querySelector('.dc-permission-picker summary').click()`);
    await until('document.querySelector(".dc-permission-picker").open');
    assert.equal(await evaluate('document.querySelector(".dc-directory-picker").open'), false);
    // A footer popover must paint above the writing surface, not behind it.
    assert.equal(await evaluate(`(()=>{const b=document.querySelector('.dc-permission-picker [data-wsp-mode="full"]'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`), true);
    await capture('permission-menu-light');
    await evaluate(`document.querySelector('.dc-permission-picker [data-wsp-mode="full"]').click()`);
    await until('document.querySelector(".dc-permission-picker").classList.contains("is-full")');
    assert.equal(prefs.permissionMode, 'full');
    rejectPermission = true;
    await evaluate(`document.querySelector('.dc-permission-picker summary').click();document.querySelector('.dc-permission-picker [data-wsp-mode="ask"]').click()`);
    await until('document.querySelector(".dc-permission-picker").classList.contains("is-full")');
    await until('dcWorkspaceChip.getAttribute("aria-busy")!=="true"');
    rejectPermission = false;
    // Close confirmation remains fully visible; closing for this visit survives a rotation tick.
    await evaluate(`document.querySelector('#nrvFloat [data-act="close"]').click()`);
    const dialog = await evaluate(`(()=>{const ask=document.querySelector('.nrv-ask'),r=ask.getBoundingClientRect();return {height:r.height,scroll:ask.scrollHeight,client:ask.clientHeight,top:r.top,bottom:r.bottom,windowHeight:innerHeight,text:ask.textContent}})()`);
    assert.ok(dialog.top>=0&&dialog.bottom<=dialog.windowHeight); assert.ok(dialog.scroll<=dialog.client+1); assert.ok(dialog.text.includes('更多'));
    await capture('promo-close-light');
    await evaluate(`document.querySelector('#nrvFloat [data-act="once"]').click();fixtureIntervals.find(item=>item.delay===15000).fn();`);
    assert.equal(await evaluate('nrvFloat.hidden'), true);
    await evaluate(`document.querySelector('[data-v2-flyout="more"]').click()`);
    assert.equal(await evaluate('!!document.querySelector("[data-v2-do=promotions]")'), true);
    await evaluate(`document.querySelector('[data-v2-do="promotions"]').click()`);
    assert.equal(await evaluate('nrvFloat.hidden'), false);
    await evaluate(`document.querySelector('#nrvFloat [data-act="close"]').click();document.querySelector('#nrvFloat [data-act="forever"]').click();fixtureIntervals.find(item=>item.delay===15000).fn();`);
    assert.equal(await evaluate('nrvFloat.hidden'), true);
    assert.equal(await evaluate('localStorage.getItem("tools.home.promoVideos.dismissed")'), 'v2');
    for (const [width, theme, language] of [[1440,'dark','zh-CN'],[390,'light','en-US']]) {
        win.setContentSize(width, 1000); await until(`innerWidth===${width}`);
        await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}');if(innerWidth<860)document.body.classList.add('v2-side-collapsed');dcInput.focus();dcInput.dispatchEvent(new Event('input',{bubbles:true}));`);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
        assert.ok(await evaluate('dcSend.getBoundingClientRect().right<=innerWidth'));
        await capture(`filled-${width}-${theme}`);
        await evaluate('dcModelBtn.click()');
        const box = await evaluate(`(()=>{const r=dcModelMenu.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
        assert.ok(box.left>=0&&box.right<=box.width&&box.top>=0&&box.bottom<=box.height, JSON.stringify(box));
        await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    }
    assert.deepEqual(await evaluate('fixtureErrors'), []);
    console.log('PASS: sidebar batches/collapse/alignment/context menu/pointer resize and glow/ghost preview; real full-home init; prompt enhancement/undo/failure/edit cancellation; reserved voice without permission; model icons/switch/settings shortcut; recent fill; plus/Skill menu; workspace search; permission popover and failure rollback; promo close layout, visit/persistent dismissal, manual reopen; dark/light, English and 390px. Screenshots: '+temp);
    win.destroy(); server.close(); app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
