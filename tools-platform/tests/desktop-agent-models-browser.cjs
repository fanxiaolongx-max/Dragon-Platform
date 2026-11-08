// Real composer/connector/model UI with isolated fixture APIs. No desktop is contacted.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'agent-models-ui-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
const names={codex:'Codex',claudecode:'Claude Code',antigravity:'Antigravity',workbuddy:'WorkBuddy'},providers=Object.keys(names),ids=Object.fromEntries(providers.map((p,i)=>[p,`${i+1}1111111-1111-4111-8111-111111111111`]));
let win,server,jobNumber=0;const sessions=[],preferences={},messages={},creates=[],sends=[],runs=[],groupSettings=new Map(),jobs=new Map();
const capabilities={enabled:true,owner:'admin',autoSync:true,syncSeconds:20,recentLimit:60,allowSend:true,claudeAutomation:true,providers:Object.fromEntries(providers.map(p=>[p,true]))};
const states=providers.map(id=>({id,enabled:true,connected:true,canSend:true,canRead:true}));
const ev=s=>win.webContents.executeJavaScript(s,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(s){for(let i=0;i<200;i++){if(await ev(`Boolean(${s})`))return;await wait(25);}throw Error('Timed out: '+s);}
setTimeout(()=>{console.error('Models UI timeout');app.exit(1);},60000).unref();
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 web.get('/',(_q,r)=>{let html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<html ', '<html data-ui="v2" ');const scripts=['/js/shared/i18n.js','/js/home/home-mode.js','/js/home/workspace-panel.js','/js/home/dragon-claw.js','/js/home/welink-threads.js','/js/home/desktop-agents.js','/js/home/agent-discussion.js','/js/home/desktop-agent-models.js'];r.type('html').send(html.replace('</body>',`<script>localStorage.setItem('tools_user','admin');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_token','fixture');localStorage.setItem('tools_tenant_id','default');</script>`+scripts.map(src=>`<script src="${src}"></script>`).join('')+'</body>'));});
 web.get('/api/desktop-agents/settings',(_q,r)=>r.json({owned:true,settings:capabilities}));
 web.get('/api/desktop-agents/sessions',(_q,r)=>r.json({providers:states,items:sessions,syncedAt:new Date().toISOString()}));
 web.post('/api/desktop-agents/sync',(_q,r)=>r.json({providers:states,items:sessions,syncedAt:new Date().toISOString()}));
 web.get('/api/desktop-agents/:provider/models',(q,r)=>r.json({models:['a','b'].map(id=>({id:q.params.provider+'-'+id,name:names[q.params.provider]+' '+id.toUpperCase()}))}));
 web.post('/api/desktop-agents/:provider/new',(q,r)=>{const p=q.params.provider,id=ids[p];creates.push({provider:p,...q.body});preferences[id]=q.body.model||'';if(!sessions.some(s=>s.id===id))sessions.push({id,provider:p,title:p+' native task',updatedAt:new Date().toISOString()});messages[id]=[{role:'user',content:q.body.text},{role:'assistant',content:'Native fixture answer'}];r.status(202).json({id,status:'accepted'});});
 web.get('/api/desktop-agents/:provider/sessions/:id/messages',(q,r)=>r.json({items:messages[q.params.id]||[],available:true,busy:false,canSend:true,selectedModel:preferences[q.params.id]||'',session:sessions.find(s=>s.id===q.params.id)}));
 web.post('/api/desktop-agents/:provider/sessions/:id/messages',(q,r)=>{sends.push({provider:q.params.provider,...q.body});messages[q.params.id].push({role:'user',content:q.body.text});r.status(202).json({status:'accepted'});});
 web.put('/api/desktop-agents/:provider/sessions/:id/model',(q,r)=>{preferences[q.params.id]=q.body.model;r.json({selectedModel:q.body.model});});
 web.get('/api/desktop-agents/discussions/:id',(q,r)=>r.json({settings:groupSettings.get(q.params.id)||null}));
 web.put('/api/desktop-agents/discussions/:id',(q,r)=>{const settings={...groupSettings.get(q.params.id),models:q.body.models};groupSettings.set(q.params.id,settings);r.json({settings});});
 web.post('/api/desktop-agents/discussion-runs',(q,r)=>{runs.push(q.body);const id='job-'+(++jobNumber),sessionId=q.body.sessionId||'group-1',settings={version:2,mode:'group',providers:q.body.providers,models:q.body.models,bindings:{}};groupSettings.set(sessionId,settings);const job={id,sessionId,status:'done',settings,reports:q.body.providers.map(p=>({provider:p,agent:names[p],status:'done',text:'Group answer',round:1}))};jobs.set(id,job);r.status(202).json(job);});
 web.get('/api/ai/models',(_q,r)=>r.json({models:[{id:'platform-only',name:'Platform API model',provider:'openai'}],defaultId:'platform-only'}));
 web.get('/api/ai/sessions',(_q,r)=>r.json({items:[]}));web.get('/api/channels/available',(_q,r)=>r.json({items:[]}));web.get('/api/asset-version',(_q,r)=>r.json({version:'fixture'}));web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 win=new BrowserWindow({show:false,width:1440,height:950,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadURL('http://127.0.0.1:'+server.address().port);await until('!!window.HomeDesktopModels&&!!window.HomeAgentDiscussion&&!!window.HomeDesktopAgents');
 await ev('HomeAgentDiscussion.refreshAvailability(true)');await until('!document.querySelector("[data-connector=codex]").disabled');
 assert.equal(await ev('dcModel.dataset.modelId'),'platform-only');
 await ev('document.querySelector("[data-connector=codex]").click()');
 await until('document.querySelectorAll("[data-native-provider=codex]").length===3');
 assert.equal(await ev('dcModelMenu.textContent.includes("Platform API model")'),false);
 assert.equal(await ev('document.querySelectorAll("#dcModelMenu .dc-native-model-heading,#dcModelMenu [data-native-retry],#dcModelMenu .dc-model-option-desc").length'),0,'single-agent menu omits provider headings, repeated names and refresh buttons');
 await ev('document.querySelector("[data-native-model=codex-a]").click()');await until('HomeDesktopModels.forProvider("codex")==="codex-a"');
 await ev('document.querySelector("[data-native-model=codex-b]").click()');await until('HomeDesktopModels.forProvider("codex")==="codex-b"');
 assert.equal(await ev('document.querySelectorAll("[data-native-provider=codex][aria-selected=true]").length'),1);
 await ev('dcInput.value="Start chosen Codex";dcInput.dispatchEvent(new Event("input",{bubbles:true}));dcSend.click()');
 await until('dcThread.textContent.includes("Native fixture answer")');assert.equal(creates[0].model,'codex-b');
 assert.equal(await ev('dcModel.hidden'),false,'native session retains the right-hand model picker');
 assert.equal(await ev('(()=>{const m=dcModelBtn.getBoundingClientRect(),v=dcVoice.getBoundingClientRect();return v.left-m.right>=0&&v.left-m.right<=16})()'),true,'existing native session keeps the model picker beside voice on the right');
 await ev('document.querySelector("[data-native-model=codex-a]").click()');await until(`HomeDesktopModels.forProvider('codex')==='codex-a'`);
 assert.equal(preferences[ids.codex],'codex-a');
 await ev('dcInput.value="Switch existing model";dcInput.dispatchEvent(new Event("input",{bubbles:true}));dcSend.click()');
 await until('dcThread.textContent.includes("Switch existing model")');assert.equal(sends.at(-1).model,'codex-a');
 await ev('HomeDesktopAgents.open(HomeDesktopAgents.getItems().find(s=>s.provider==="codex"))');await until('HomeDesktopModels.forProvider("codex")==="codex-a"');
 // Every provider supports new and existing sessions, plus explicit native default.
 for(const p of ['claudecode','antigravity','workbuddy']){
  await ev(`DragonClaw.newChat();document.querySelector('[data-connector=${p}]').click()`);
  await until(`document.querySelectorAll('[data-native-provider=${p}]').length===3`);
  await ev(`document.querySelector('[data-native-model=${p}-a]').click()`);await until(`HomeDesktopModels.forProvider('${p}')==='${p}-a'`);
  await ev(`dcInput.value='New ${p}';dcInput.dispatchEvent(new Event('input',{bubbles:true}));dcSend.click()`);await until(`!!HomeDesktopAgents.activeSession()&&HomeDesktopAgents.activeSession().provider==='${p}'&&!dcInput.disabled`);
  assert.equal(creates.at(-1).model,p+'-a');
  await ev(`document.querySelector('[data-native-model=${p}-b]').click()`);await until(`HomeDesktopModels.forProvider('${p}')==='${p}-b'`);
  await ev(`dcInput.value='Next ${p}';dcInput.dispatchEvent(new Event('input',{bubbles:true}));dcSend.click()`);await until(`dcThread.textContent.includes('Next ${p}')`);assert.equal(sends.at(-1).model,p+'-b');
  await ev(`document.querySelector('[data-native-provider=${p}][data-native-model=""]').click()`);await until(`HomeDesktopModels.forProvider('${p}')===''`);
  assert.equal(preferences[ids[p]],'');
  assert.equal(await ev('(()=>{const m=dcModelBtn.getBoundingClientRect(),v=dcVoice.getBoundingClientRect();return v.left-m.right>=0&&v.left-m.right<=16})()'),true,'native default stays beside voice for '+p);
  if(p==='antigravity')for(const width of [390,1440,1920])for(const theme of ['light','dark']){
   win.setContentSize(width,950);await ev(`document.documentElement.dataset.theme='${theme}'`);await wait(100);
   assert.equal(await ev('(()=>{const m=dcModelBtn.getBoundingClientRect(),v=dcVoice.getBoundingClientRect(),s=dcSend.getBoundingClientRect();return v.left-m.right>=0&&v.left-m.right<=16&&s.left-v.right>=0&&s.left-v.right<=16})()'),true,'existing Antigravity default aligns right at '+width+' '+theme);
   await ev('dcModelBtn.click()');await wait(80);
   assert.equal(await ev('(()=>{const r=dcModelMenu.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1})()'),true,'existing native model menu stays within viewport');
   fs.writeFileSync(path.join(temp,`existing-model-${width}-${theme}.png`),(await win.webContents.capturePage()).toPNG());
   await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));dcModelMenu.hidden=true');
  }

 }
 await ev('DragonClaw.newChat()');
 for(const p of providers)await ev(`document.querySelector('[data-connector=${p}]').click()`);
 await until('document.querySelectorAll("[data-native-model]").length===12');
 await ev('document.querySelector("[data-native-model=codex-a]").click()');await until('HomeDesktopModels.forProvider("codex")==="codex-a"');
 await ev('document.querySelector("[data-native-model=workbuddy-b]").click()');await until('HomeDesktopModels.forProvider("workbuddy")==="workbuddy-b"');
 assert.equal(await ev('document.querySelector("[role=listbox][aria-multiselectable=true]")!==null'),true);
 assert.equal(await ev('document.querySelectorAll("[data-native-model][aria-selected=true]").length'),4,'one selection including default for each member');
 for(const width of [390,1440])for(const theme of ['light','dark']){
  win.setContentSize(width,950);await ev(`document.documentElement.dataset.ui='v2';document.documentElement.dataset.theme='${theme}';DragonClawWorkspace.closePanel();dcModelBtn.click()`);await wait(200);
  assert.equal(await ev('dcModelName.getBoundingClientRect().width>=45'),true,'model identity stays readable beside the connector');
  assert.equal(await ev('(()=>{const m=dcModelBtn.getBoundingClientRect(),v=dcVoice.getBoundingClientRect();return v.left-m.right<=16})()'),true,'model button sits directly beside voice and send without a stretched blank area');
  assert.equal(await ev('document.querySelectorAll("[data-native-retry]").length'),0,'groups also omit refresh buttons');
  assert.equal(await ev('(()=>{const r=dcModelMenu.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&r.top>=-1&&r.bottom<=innerHeight+1})()'),true,'model menu stays on screen');
  fs.writeFileSync(path.join(temp,`models-${width}-${theme}.png`),(await win.webContents.capturePage()).toPNG());await ev('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));dcModelMenu.hidden=true');
 }
 await ev('dcInput.value="Group first round";dcInput.dispatchEvent(new Event("input",{bubbles:true}));dcSend.click()');await until('dcThread.textContent.includes("Group answer")');
 assert.deepEqual(runs[0].models,{codex:'codex-a',claudecode:'',antigravity:'',workbuddy:'workbuddy-b'});
 await ev('document.querySelector("[data-native-model=claudecode-b]").click()');await until('HomeDesktopModels.forProvider("claudecode")==="claudecode-b"');
 assert.equal(groupSettings.get('group-1').models.claudecode,'claudecode-b');
 await ev('dcInput.value="Group second round";dcInput.dispatchEvent(new Event("input",{bubbles:true}));dcSend.click()');await until('HomeDesktopModels.forProvider("claudecode")==="claudecode-b"&&dcThread.textContent.includes("Group second round")');
 while(runs.length<2)await wait(20);
 assert.equal(runs.at(-1).models.claudecode,'claudecode-b');assert.equal(runs.at(-1).sessionId,'group-1');
 await ev('HomeAgentDiscussion.activateSession("group-1",{group:true})');await until('HomeDesktopModels.forProvider("workbuddy")==="workbuddy-b"');
 await ev('DragonClaw.newChat()');await until('dcModel.dataset.modelId==="platform-only"');
 assert.equal(await ev('document.querySelectorAll("[data-native-model]").length'),0,'platform picker returns after deselecting native connectors');
 console.log('PASS: four providers, native defaults, new/existing switches, per-family group choices, reload and narrow light/dark menus. '+temp);win.destroy();server.close();app.exit(0);
}).catch(e=>{console.error(e);win?.destroy();server?.close();app.exit(1);});
