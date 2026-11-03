// Run: node_modules/.bin/electron tests/home-composer-menu-browser.cjs
// Full home renderer, mocked APIs, isolated profile; no model calls or runtime data writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-single-workspace-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
let win, server, prefs = { lastDirectory: '', recentDirectories: ['/fixture/privacy-policy', '/fixture/reports'], permissionMode: 'ask' };
let switches=0,listed=0,serverWorkspace='legacy';
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
        if(!localStorage.getItem('tools_tenant_id'))localStorage.setItem('tools_tenant_id','legacy');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_token','fixture-session');localStorage.setItem('tools_lang','zh-CN');
        window.fixtureIntervals=[];const originalInterval=window.setInterval;window.setInterval=(fn,delay,...args)=>{if(delay>=10000)fixtureIntervals.push({fn,delay});return originalInterval(fn,delay,...args)};
        window.fixtureErrors=[];window.addEventListener('error',e=>fixtureErrors.push(e.message));window.addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));
    </script>`)));
    web.get('/api/custom-tools', (_, res) => res.json([]));
    web.get('/api/auth/me', (_, res) => res.json({ username: 'fixture', role: 'admin', tenantId: serverWorkspace }));
    web.get('/api/app-version', (_, res) => res.json({ version: 'fixture' }));
    web.get('/api/tenants',(_,res)=>{listed++;res.json({tenants:[],activeTenantId:serverWorkspace})});
    web.post('/api/tenants/switch',(req,res)=>{assert.equal(req.body.tenantId,'default');switches++;serverWorkspace='default';res.json({success:true,tenantId:'default'})});
    web.get('/api/platform-promotions', (_, res) => res.json({ desktopStack: false, rotateSeconds: 15, maxLinks: 3, videos: ['rfc','incentive','eos','guide','aiMonthly','welinkCli','welinkSdk','digitalHuman'].map(id=>({id,enabled:false})), links: [{ id: 'fixture', name: '平台功能介绍', nameEn: 'Platform guide', description: '查看平台使用指南', badge: '资讯', enabled: true, url: 'https://example.test/guide', color: 'teal' }] }));
    web.get('/api/agent-workspace/capability', (_, res) => res.json({ enabled: true, homeDir: '/fixture' }));
    web.get('/api/agent-workspace/prefs', (_, res) => res.json(prefs));
    web.put('/api/agent-workspace/prefs', (req, res) => { if (rejectPermission) return res.status(500).json({ error: 'fixture save failure' }); prefs = { ...prefs, ...req.body }; res.json(prefs); });
    web.get('/api/agent-workspace/suggest', (_, res) => res.json({ exists: true, isDir: true, groups: [] }));
    web.get('/api/ai-settings', (_, res) => res.json({ activeProfileId: 'main', profiles: models.map((model,index)=>({ id: index?'other':'main', name: model.description, model: model.name, provider: model.provider, category: 'chat', isActive: !index, hasApiKey: true, keyLooksValid: true, maskedApiKey: '****', maxOutputTokens: 2048, temperature: .7 })) }));
    web.post('/api/ai/enhance-prompt', (req, res) => { enhanceCalls.push(req.body); if (enhanceMode==='error') return res.status(503).json({code:'AI_PROMPT_FAILED',error:'fixture enhancement failure'});const delay=enhanceMode==='slow'?220:60;setTimeout(()=>{if(!res.destroyed)res.json({prompt:req.body.text+' 明确输出步骤与验证结果。'})},delay); });
    web.get('/api/ai/models', (_, res) => res.json({ models, defaultId: models[0].id, mode: 'direct' }));
    web.get('/api/ai/sessions', (req, res) => { if(Number(req.query.offset)>0)sessionPages++;res.json({ items: Array.from({length:55},(_,index)=>({ id: 'recent-fixture-'+index, title: '研究依据核对 Skill', messageCount: 2, firstQuestion:'创建研究依据核对 Skill，检查结论与依据是否对应、口径是否一致，缺依据如何标注；交付一个含名称、说明、触发条件和步骤的 SKILL.md，不安装。',updatedAt:'2026-11-02T09:00:00Z' })).slice(Number(req.query.offset)||0,(Number(req.query.offset)||0)+(Number(req.query.limit)||40)) }); });
    web.post('/api/ai/uploads', (_,res)=>res.json({files:[{name:'notes.txt',path:'/fixture/uploads/notes.txt',size:14}]}));
    web.get('/api/ai/skills', (_, res) => res.json({ items: [{ id: 'research-check', name: '研究依据核对', nameEn: 'Research check', description: '核对结论与依据', descriptionEn: 'Review research evidence' }] }));
    web.get(['/api/friend-links','/api/recent-nav','/api/upload/history'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await wait(1200); // Allow the legacy-session redirect to finish before renderer polling.
    await until('!!window.HomeComposer&&!!document.querySelector(".dc-permission-picker")&&!!document.querySelector(".v2-suggest-item")&&!!window.HomePromoPlayer');

    await until('localStorage.getItem("tools_tenant_id")==="default"');await wait(250);
    assert.equal(switches,1,'an existing non-default login is moved through the backend session API');assert.equal(listed,0,'no tenant catalogue requests');
    assert.equal(await evaluate('typeof window.switchActiveTenant'), 'undefined');
    assert.equal(await evaluate('!!document.querySelector(".nav-tenant-switcher,#navTenantMenu,#navActiveTenantName")'),false);
    await evaluate('openNavSettingsModal();true');await until('!!document.querySelector(".nav-settings-tab[data-tab=accounts]")');
    assert.equal(await evaluate('!!document.querySelector(".nav-settings-tab[data-tab=tenants]")'),false);
    await evaluate('switchNavSettingsTab("tenants");true');await wait(100);
    assert.equal(await evaluate('navState.settingsTab'),'accounts','removed bookmarked tabs fall back safely');
    assert.equal(await evaluate('typeof window.createTenantInfo'), 'undefined');
    for(const language of ['zh-CN','en-US']){
      await evaluate(`ToolsI18n.setLanguage('${language}');switchNavSettingsTab('initialize');true`);await wait(180);
      assert.equal(await evaluate('/租户|\\btenants?\\b/i.test(document.getElementById("navSettingsModal").innerText)'),false,'settings contain no tenant terminology');
    }
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    console.log('PASS single default workspace: verified legacy session switch, no catalogue/switcher/admin actions, safe old-tab fallback, bilingual initialization settings.');
    win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
