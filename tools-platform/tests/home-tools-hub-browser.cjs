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
    web.get('/api/ai/sessions', (req, res) => { if(Number(req.query.offset)>0)sessionPages++;res.json({ items: Array.from({length:55},(_,index)=>({ id: 'recent-fixture-'+index, title: '研究依据核对 Skill', messageCount: 2, firstQuestion:'创建研究依据核对 Skill，检查结论与依据是否对应、口径是否一致，缺依据如何标注；交付一个含名称、说明、触发条件和步骤的 SKILL.md，不安装。',updatedAt:'2026-11-02T09:00:00Z' })).slice(Number(req.query.offset)||0,(Number(req.query.offset)||0)+(Number(req.query.limit)||40)) }); });
    web.get('/api/ai/skills', (_, res) => res.json({ items: [{ id: 'research-check', name: '研究依据核对', nameEn: 'Research check', description: '核对结论与依据', descriptionEn: 'Review research evidence' }] }));
    web.get(['/api/friend-links','/api/recent-nav','/api/upload/history'], (_, res) => res.json([]));
    web.use('/api', (_, res) => res.json({ items: [] }));
    web.use(express.static(frontend));
    server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });
    win = new BrowserWindow({ show: false, width: 1440, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);

    await until('window.HomeSkillHub&&document.querySelector("[data-v2-mode=tools]")&&document.getElementById("v2SkillHub")');
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
