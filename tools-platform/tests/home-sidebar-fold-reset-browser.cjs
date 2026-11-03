// Run: node_modules/.bin/electron tests/home-composer-browser.cjs
// Full home renderer, mocked APIs, isolated profile; no model calls or runtime data writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-composer-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
let win, server, prefs = { lastDirectory: '', recentDirectories: ['/fixture/privacy-policy', '/fixture/reports'], permissionMode: 'ask' };
let rejectPermission = false, enhanceMode = 'normal', enhanceCalls = [], sessionPages = 0;
const stamp='2026-11-03T12:00:00Z';
const task=id=>({id:'task-'+id,title:'Task '+id,firstQuestion:'Task '+id,updatedAt:stamp,messageCount:2});
const project=(root,id)=>({id:'project-'+root+'-'+id,title:'Project chat '+root+' '+id,firstQuestion:'Project chat '+root+' '+id,updatedAt:stamp,messageCount:2,agent:{root:'/fixture/project-'+String(root).padStart(2,'0')}});
const firstPage=[...Array.from({length:12},(_,id)=>task(id)),...Array.from({length:28},(_,root)=>project(root,0))];
const secondPage=[...Array.from({length:20},(_,id)=>task(id+12)),...Array.from({length:20},(_,id)=>project(0,id+1))];
const latePage=Array.from({length:5},(_,id)=>task(id+32));
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
    web.get('/api/ai/sessions',(req,res)=>{
        const offset=Number(req.query.offset)||0;
        if(offset)sessionPages++;
        const items=offset===40?secondPage:offset===80?latePage:firstPage;
        setTimeout(()=>res.json({items}),offset===80?300:0);
    });
    web.get('/api/ai/skills', (_, res) => res.json({ items: [{ id: 'research-check', name: '研究依据核对', nameEn: 'Research check', description: '核对结论与依据', descriptionEn: 'Review research evidence' }] }));
    web.get(['/api/friend-links','/api/recent-nav','/api/upload/history'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);

    await until('!!document.querySelector("[data-batch-scope=tasks] .v2-list-expand")&&!!document.querySelector("[data-batch-scope=spaces]")');
    await evaluate(`window.fixtureScope=key=>[...homeChatList.querySelectorAll('[data-batch-scope]')].find(node=>node.dataset.batchScope===key);window.fixtureExpand=key=>fixtureScope(key).querySelector(':scope > .v2-list-expand')?.click();window.fixtureToggle=key=>homeChatList.querySelector('[data-chat-section='+key+']').click();true;`);
    const rows=scope=>evaluate(`fixtureScope(${JSON.stringify(scope)}).querySelectorAll(':scope > .conversation-list-row:not([hidden])').length`);
    const projects=()=>evaluate('fixtureScope("spaces").querySelectorAll(":scope > .home-chat-project:not([hidden])").length');
    assert.equal(await rows('tasks'),6);assert.equal(await projects(),5);
    await evaluate('fixtureExpand("tasks");fixtureExpand("tasks")');
    await until('homeChatList.querySelectorAll(".conversation-list-row").length===80');
    assert.equal(sessionPages,1);
    const projectScope='project:/fixture/project-00';
    await evaluate(`fixtureExpand('spaces');fixtureExpand('spaces');fixtureExpand('spaces');fixtureExpand(${JSON.stringify(projectScope)});fixtureExpand(${JSON.stringify(projectScope)});`);
    assert.equal(await projects(),20);assert.equal(await rows(projectScope),18);
    // Closing one child manually is part of its old state; top-level reset restores the defaults.
    await evaluate(`homeChatList.querySelectorAll('[data-project-toggle]')[1].click();fixtureToggle('spaces');fixtureToggle('spaces');`);
    assert.equal(await projects(),5);assert.equal(await rows(projectScope),6);
    assert.equal(await evaluate('homeChatList.querySelectorAll(".home-chat-project.is-collapsed").length'),0);
    assert.equal(await rows('tasks'),18,'resetting spaces preserves the independent task expansion');
    // More than one expand/collapse cycle always returns to the initial limit.
    for(let cycle=0;cycle<3;cycle++){
        await evaluate(`fixtureExpand('spaces');fixtureExpand('spaces');fixtureExpand(${JSON.stringify(projectScope)});fixtureExpand(${JSON.stringify(projectScope)});fixtureExpand(${JSON.stringify(projectScope)});fixtureToggle('spaces');fixtureToggle('spaces');`);
        assert.equal(await projects(),5);assert.equal(await rows(projectScope),6);
    }
    // An in-flight remote page may populate the cache, but cannot reopen the displayed batch.
    await evaluate('fixtureExpand("tasks");fixtureExpand("tasks");fixtureExpand("tasks");fixtureExpand("tasks");fixtureToggle("tasks");fixtureToggle("tasks")');
    assert.equal(await rows('tasks'),6);
    await until('homeChatList.querySelectorAll(".conversation-list-row").length===85');
    assert.equal(sessionPages,2);assert.equal(await rows('tasks'),6);
    assert.equal(await projects(),5);assert.equal(await rows(projectScope),6);
    // The shared reset is also used by outer channel/category folding; it resets scoped and flat counters.
    await evaluate(`fixtureExpand('tasks');fixtureExpand('spaces');fixtureExpand(${JSON.stringify(projectScope)});HomeConversationList.reset(homeChatList)`);
    assert.equal(await rows('tasks'),6);assert.equal(await projects(),5);assert.equal(await rows(projectScope),6);
    await evaluate('window.dispatchEvent(new CustomEvent("home:conversation-list-changed",{detail:{source:"mine"}}))');
    assert.equal(await rows('tasks'),6);assert.equal(await projects(),5);assert.equal(await rows(projectScope),6);
    assert.equal(await evaluate('!!document.querySelector(".v2-group-head[data-group=mine]")'),false,'tasks and spaces have no outer conversation category');
    await evaluate(`window.originalSource=HomeWelinkThreads.source;window.fixtureSource='weixin';HomeWelinkThreads.source=()=>fixtureSource;window.fixtureMarker=document.createElement('span');document.querySelector('.home-panel-view[data-home-panel=chat]').append(fixtureMarker);true`);
    await until('!!document.querySelector(".v2-group-head[data-group=weixin]")');
    await evaluate('document.querySelector(".v2-group-head[data-group=weixin]").click()');
    await until('!!document.querySelector(".v2-groups-collapsed")');
    await evaluate(`fixtureSource='mine';fixtureMarker.remove();true`);
    await until('!document.querySelector(".v2-group-head")&&!document.querySelector(".v2-groups-collapsed")');
    assert.equal(await evaluate('getComputedStyle(homeChatList).display!=="none"'),true,'returning from a folded channel leaves tasks/spaces visible');
    await evaluate('HomeWelinkThreads.source=originalSource;true');
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    console.log('PASS: repeated task/space folding resets every descendant batch and project fold state; independent categories remain expanded; delayed remote pages and list refreshes preserve reset; shared reset clears scoped counters.');
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
