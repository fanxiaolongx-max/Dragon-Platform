// Isolated group UI; all desktop responses are fixtures, no business message is sent.
const {app,BrowserWindow}=require('electron');const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tac-group-ui-')),root=path.join(__dirname,'..');app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server,hold=false,cancelled=0,nativeCalls=0,ordinaryCalls=0;const requests=[],jobs=new Map();
const evaluate=s=>win.webContents.executeJavaScript(s,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(s){for(let i=0;i<180;i++){if(await evaluate(`Boolean(${s})`))return;await wait(30);}throw Error(s);}
setTimeout(()=>app.exit(1),45000).unref();
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 web.get('/',(_q,r)=>{const html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');r.type('html').send(html.replace('</body>',`<script>localStorage.setItem('tools_user','admin');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_token','fixture');</script>`+['/js/shared/i18n.js','/js/home/home-mode.js','/js/home/dragon-claw.js','/js/home/agent-discussion.js'].map(src=>`<script src="${src}"></script>`).join('')+'</body>'));});
 web.post('/api/desktop-agents/discussion-runs',(q,r)=>{requests.push(q.body);const job={id:q.body.requestId,sessionId:q.body.sessionId||'chat_fresh_group',status:'running',reports:['Codex','Claude Code','Antigravity'].map(agent=>({agent,round:1,status:'creating'}))};jobs.set(job.id,job);r.status(202).json(job);});
 web.get('/api/desktop-agents/discussion-runs/:id',(q,r)=>{const job=jobs.get(q.params.id);if(!hold){job.status='done';for(const row of job.reports){row.status='done';row.text=row.agent+' group reply';}}r.json(job);});
 web.post('/api/desktop-agents/discussion-runs/:id/cancel',(q,r)=>{cancelled++;const job=jobs.get(q.params.id);job.status='cancelled';r.json(job);});
 web.get('/api/desktop-agents/discussions/:id',(_q,r)=>r.json({settings:{mode:'group',version:2,bindings:{}},activeRun:null}));
 web.post('/api/ai/chat',(_q,r)=>{ordinaryCalls++;r.status(500).json({error:'No model fallback'});});web.get('/api/ai/models',(_q,r)=>r.json({models:[]}));web.get('/api/ai/sessions',(_q,r)=>r.json({items:[]}));web.get('/api/asset-version',(_q,r)=>r.json({version:'fixture'}));web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});win=new BrowserWindow({show:false,width:1400,height:960,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:'+server.address().port);await until('document.querySelector("[data-tac-start]")');
 assert.equal(await evaluate('document.querySelectorAll("[data-discussion-mode],[data-discussion-binding],.dc-agent-discussion").length'),0,'no modes or conversation picker');
 await evaluate("DragonClaw.enterExternal({owner:'desktop-agent',composer:{canSend:true,draft:'Discuss this draft in a fresh group',send:async()=>{window.__nativeCalls=(window.__nativeCalls||0)+1;return true;}}});document.querySelector('.dc-tac-entry').click();");
 assert.equal(await evaluate('DragonClaw.isExternal()'),false);assert.equal(await evaluate('dcInput.value'),'Discuss this draft in a fresh group');assert.equal(await evaluate('document.querySelector("[data-tac-start]").getAttribute("aria-pressed")'),'true');
 await evaluate('dcComposer.requestSubmit()');await until('dcThread.textContent.includes("Codex group reply")&&dcThread.textContent.includes("Claude Code group reply")&&dcThread.textContent.includes("Antigravity group reply")');await wait(60);
 assert.equal(requests.length,1);assert.equal(requests[0].settings,undefined);assert.equal(requests[0].sessionId,null);assert.equal(await evaluate('window.__nativeCalls||0'),0);assert.equal(ordinaryCalls,0);
 await evaluate("dcInput.value='Continue the group discussion';dcInput.dispatchEvent(new Event('input',{bubbles:true}));dcComposer.requestSubmit();");await until('document.querySelectorAll(".dc-msg--user").length===2');await wait(1200);assert.equal(requests[1].sessionId,'chat_fresh_group');
 hold=true;await evaluate("dcInput.value='Third question';dcInput.dispatchEvent(new Event('input',{bubbles:true}));dcComposer.requestSubmit();");await until('dcThread.textContent.includes("正在新建专用")');await evaluate('dcSend.click()');await until('dcThread.textContent.includes("已停止后续")');await wait(80);assert.equal(cancelled,1);
 await evaluate('DragonClaw.newChat()');assert.equal(await evaluate('HomeAgentDiscussion.handles("Question")'),false);await evaluate("HomeAgentDiscussion.activateSession('chat_fresh_group')");assert.equal(await evaluate('HomeAgentDiscussion.handles("Question")'),true);
 await evaluate('ToolsI18n.setLanguage("en-US")');assert.match(await evaluate('document.querySelector("[data-tac-start]").textContent'),/Agent group/);
 win.setContentSize(390,844);await wait(100);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 console.log('PASS: one-click fresh group, no selectors or modes, native-view handoff, draft preservation, three authors, same chat continuation, stop, history restore, English and mobile');win.destroy();server.close();app.exit(0);
}).catch(e=>{console.error(e);win?.destroy();server?.close();app.exit(1);});
