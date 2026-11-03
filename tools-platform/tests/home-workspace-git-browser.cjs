// Run: node_modules/.bin/electron tests/home-composer-browser.cjs
// Full home renderer, mocked APIs, isolated profile; no model calls or runtime data writes.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), express = require('express');
const root = path.join(__dirname, '..'), frontend = path.join(root, 'frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'home-composer-'));
process.env.TOOLS_DATA_DIR=path.join(temp,'data');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const {execFileSync}=require('node:child_process');
const workspaceRoot=fs.realpathSync(temp),project=path.join(workspaceRoot,'reference-project');fs.mkdirSync(project);
const git=(...args)=>execFileSync('git',['-c','core.hooksPath='+os.devNull,...args],{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
git('init','-b','main');fs.writeFileSync(path.join(project,'README.md'),'fixture');git('add','README.md');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--no-gpg-sign','-m','Initial');git('branch','feature');
const workspaceRouter=require('../backend/routes/agent-workspace'),workspacePrefs=require('../backend/models/agent-workspace-repository'),{runWithTenant}=require('../backend/models/tenant-context');
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
    for(let index=0;index<7;index++){const directory=path.join(workspaceRoot,'past-'+String(index).padStart(2,'0'));fs.mkdirSync(directory);await runWithTenant('default',()=>workspacePrefs.rememberDirectory('fixture',directory));}
    await runWithTenant('default',()=>workspacePrefs.rememberDirectory('fixture',project));
    const web = express(); web.use(express.json());
    web.use('/api/agent-workspace',(req,res,next)=>{req.user={username:'fixture',role:'admin'};runWithTenant('default',next);},workspaceRouter);
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

    await until('window.DragonClawWorkspace&&document.querySelector(".dc-directory-picker")');
    assert.equal(await evaluate('DragonClawWorkspace.getRoot()'),'');
    await evaluate('document.querySelector(".dc-directory-picker summary").click()');
    assert.ok(await evaluate('document.querySelector("[data-wsp-action=create-workspace]").textContent.includes("新建工作空间")'));
    await evaluate(`DragonClawWorkspace.selectDirectory(${JSON.stringify(project)})`);
    await until('document.querySelector(".dc-branch-picker summary").textContent.includes("main")');
    assert.equal(await evaluate('document.body.classList.contains("dc-workspace-open")'),false,'selection does not automatically open the side panel');
    const initialSession=await evaluate('DragonClawWorkspace.getWorkspacePayload().agentSessionId');
    await evaluate('document.querySelector(".dc-directory-picker summary").click()');
    await capture('workspace-menu-light');
    assert.equal(await evaluate('document.querySelectorAll(".dc-context-recents [data-wsp-select]:not([hidden])").length'),4,'default recent list stays compact');
    await evaluate('document.querySelector("[data-wsp-recent-search]").value="past-00";document.querySelector("[data-wsp-recent-search]").dispatchEvent(new Event("input",{bubbles:true}));true');
    assert.equal(await evaluate('document.querySelectorAll(".dc-context-recents [data-wsp-select]:not([hidden])").length'),1,'search includes older recent entries');
    assert.equal(await evaluate('getComputedStyle(document.querySelector("[data-wsp-recent-search]")).outlineStyle'),'none','focus belongs to the complete search field');
    await evaluate('document.querySelector("[data-wsp-recent-search]").value="";document.querySelector("[data-wsp-recent-search]").dispatchEvent(new Event("input",{bubbles:true}));true');
    assert.equal(await evaluate('document.querySelectorAll(".dc-context-recents [data-wsp-select]:not([hidden])").length'),4);
    // Move the real anchor near the viewport top: the full menu should choose below.
    await evaluate(`document.body.style.paddingBottom='700px';document.querySelector('.dc-directory-picker').open=false;window.scrollBy(0,document.querySelector('.dc-directory-picker summary').getBoundingClientRect().top-100);true`);await wait(100);
    const beforeScroll=await evaluate('scrollY');
    await evaluate('document.querySelector(".dc-directory-picker summary").click()');await wait(100);
    assert.equal(await evaluate('document.querySelector(".dc-directory-picker .dc-context-menu").dataset.placement'),'below');
    assert.equal(await evaluate('scrollY'),beforeScroll,'opening does not scroll the page');
    assert.equal(await evaluate(`(()=>{const menu=document.querySelector('.dc-directory-picker .dc-context-menu'),r=menu.getBoundingClientRect(),input=document.querySelector('[data-wsp-recent-search]'),s=input.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&input.contains(document.elementFromPoint(s.x+20,s.y+15))})()`),true,'the search field is visible and hit-testable');
    await capture('workspace-menu-below');
    await evaluate(`document.querySelector('.dc-directory-picker').open=false;document.body.style.paddingBottom='';window.scrollTo(0,0);true`);

    await evaluate('document.querySelector(".dc-branch-picker summary").click()');
    await until('document.querySelector(".dc-branch-picker").open');
    await evaluate('document.querySelector("[data-wsp-branch-search]").value="fea";document.querySelector("[data-wsp-branch-search]").dispatchEvent(new Event("input",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("[data-wsp-branch=main]").hidden'),true);
    await capture('branch-menu-light');
    await evaluate('document.querySelector("[data-wsp-branch=feature]").click()');
    await until('document.querySelector(".dc-branch-picker summary").textContent.includes("feature")&&!document.querySelector("[data-wsp-action=new-worktree]").disabled');
    assert.equal(git('branch','--show-current'),'feature');
    assert.notEqual(await evaluate('DragonClawWorkspace.getWorkspacePayload().agentSessionId'),initialSession,'changing branch starts fresh workspace context');
    fs.writeFileSync(path.join(project,'local-only.txt'),'keep local changes');
    await evaluate('document.querySelector(".dc-branch-picker summary").click();document.querySelector("[data-wsp-branch=main]").click()');
    await until('dcToast.textContent.includes("未提交")');
    assert.equal(git('branch','--show-current'),'feature');assert.equal(fs.readFileSync(path.join(project,'local-only.txt'),'utf8'),'keep local changes');
    await evaluate('document.querySelector(".dc-worktree-picker summary").click()');
    await capture('worktree-menu-light');
    await evaluate('document.querySelector("[data-wsp-action=new-worktree]").click()');
    await until(`DragonClawWorkspace.getRoot()!==${JSON.stringify(project)}&&!!document.querySelector('.dc-worktree-check.is-checked')`);
    const worktreeRoot=await evaluate('DragonClawWorkspace.getRoot()');assert.equal(fs.existsSync(path.join(worktreeRoot,'local-only.txt')),false);assert.equal(git('branch','--show-current'),'feature');
    const toolbarRows=await evaluate('[...document.querySelectorAll("#dcWorkspaceChip details > summary")].map(node=>Math.round(node.getBoundingClientRect().top))');assert.equal(new Set(toolbarRows).size,1,'selected worktree controls share a single desktop row');
    await capture('worktree-selected-light');
    await evaluate('document.querySelector(".dc-worktree-picker summary").click()');
    await evaluate(`[...document.querySelectorAll('.dc-worktree-picker [data-wsp-select]')].find(button=>button.dataset.wspSelect===${JSON.stringify(project)}).click()`);
    await until(`DragonClawWorkspace.getRoot()===${JSON.stringify(project)}&&!document.querySelector('.dc-worktree-check.is-checked')`);
    const newDirectory=path.join(workspaceRoot,'new-workspace');
    await evaluate(`window.AppDialog.prompt=async()=>${JSON.stringify(newDirectory)};document.querySelector('[data-wsp-action=create-workspace]').click()`);
    await until(`DragonClawWorkspace.getRoot()===${JSON.stringify(newDirectory)}`);assert.equal(fs.statSync(newDirectory).isDirectory(),true);assert.equal(await evaluate('!!document.querySelector(".dc-branch-picker")'),false);
    await evaluate('document.querySelector("[data-wsp-action=clear]").click()');assert.equal(await evaluate('DragonClawWorkspace.getWorkspacePayload()'),null);
    await evaluate(`DragonClawWorkspace.selectDirectory(${JSON.stringify(project)})`);await until('!!document.querySelector(".dc-branch-picker")');
    for(const [width,theme,language] of [[1440,'dark','zh-CN'],[390,'light','en-US']]){
        win.setContentSize(width,1000);await wait(100);if(width===390)await evaluate('document.getElementById("v2SideToggle").click()');await evaluate(`document.documentElement.dataset.theme='${theme}';ToolsI18n.setLanguage('${language}')`);
        for(const selector of ['.dc-directory-picker','.dc-branch-picker','.dc-worktree-picker','.dc-permission-picker']){
            await evaluate(`document.querySelector('${selector} summary').click()`);await wait(50);
            const box=await evaluate(`(()=>{const r=document.querySelector('${selector} .dc-context-menu').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);
            assert.ok(box.left>=0&&box.right<=box.width&&box.top>=0&&box.bottom<=box.height,selector+JSON.stringify(box));
        }
        await capture('workspace-'+width+'-'+theme);
    }
    assert.deepEqual(await evaluate('fixtureErrors'),[]);
    console.log('PASS: full home with real temporary Git repositories/APIs; workspace creation/search/remove, branch search/switch and dirty protection, isolated worktree creation/switch, session reset, quiet sidebar behavior, themes/English/390px popover bounds. Previews: '+temp);
    win.destroy();server.close();app.exit(0);
}).catch(async error=>{console.error(error);if(win)console.log(await evaluate('({errors:fixtureErrors,root:DragonClawWorkspace.getRoot(),toast:dcToast.textContent})'));win?.destroy();server?.close();app.exit(1)});
