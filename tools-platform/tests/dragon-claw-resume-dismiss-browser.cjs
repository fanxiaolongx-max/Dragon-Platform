// Real page reloads, isolated browser storage and fixture APIs; no user conversations.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'resume-dismiss-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
setTimeout(()=>{console.error('Resume test timed out');app.exit(1)},40000).unref();
app.whenReady().then(async()=>{
 const web=express();
 web.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>',`<script>
 if(!localStorage.getItem('fixture')){localStorage.setItem('fixture','1');localStorage.setItem('tools_user','admin');localStorage.setItem('tools_token','fixture');localStorage.setItem('dragon_claw_last_chat',JSON.stringify({sessionId:'s1',user:'admin',updatedAt:1}));}
 window.ToolsI18n={getLanguage:()=>localStorage.getItem('testLang')||'zh-CN'};window.HomeWorkspace={getTools:()=>[]};
 </script><script src="/js/home/dragon-claw.js"></script></body>`)));
 web.get('/api/ai/sessions/:id/messages',(_q,r)=>r.json({items:[{id:'u1',role:'user',content:'上次的问题',created_at:'2026-11-03 10:00:00'},{id:'m1',role:'model',content:'回答',created_at:'2026-11-03 10:00:01'}],total:2}));
 web.use('/api',(_q,r)=>r.json({items:[],models:[]}));web.use(express.static(path.join(root,'frontend')));
 const server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s))});
 const win=new BrowserWindow({show:false,width:1200,height:900});
 const run=s=>win.webContents.executeJavaScript(s);
 async function until(s){for(let n=0;n<100;n++){if(await run(s))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timeout: '+s)}
 const visible='document.querySelector("#dcResume")?.hidden === false';
 async function reload(){await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload()});await until('!!document.querySelector("#dcResume")');await new Promise(r=>setTimeout(r,80))}
 try{
  await win.loadURL('http://127.0.0.1:'+server.address().port);await until(visible);
  assert.equal(await run('document.querySelector("[data-dc-resume-dismiss]").getAttribute("aria-label")'),'关闭此提示');
  await run('document.querySelector("[data-dc-resume-dismiss]").click()');assert.equal(await run(visible),false);
  await reload();assert.equal(await run(visible),false,'dismiss survives reload');
  await run(`localStorage.setItem('dragon_claw_last_chat',JSON.stringify({sessionId:'s2',user:'admin',updatedAt:2}));window.dispatchEvent(new Event('tools:languagechange'))`);
  await until(visible);
  for(let n=1;n<=3;n++){await reload();if(n<3)await until(visible);else assert.equal(await run(visible),false,'third consecutive reload dismisses');}
  await reload();assert.equal(await run(visible),false,'auto dismissal persists');
  await run(`localStorage.setItem('dragon_claw_last_chat',JSON.stringify({sessionId:'s2',user:'admin',updatedAt:3}));localStorage.setItem('testLang','en-US');window.dispatchEvent(new Event('tools:languagechange'))`);
  await until(visible);assert.equal(await run('document.querySelector("[data-dc-resume-dismiss]").getAttribute("aria-label")'),'Dismiss this reminder');
  // Re-renders do not consume reloads or re-show a manually dismissed revision.
  await run(`window.dispatchEvent(new Event('tools:languagechange'));window.dispatchEvent(new Event('tools:languagechange'))`);await until(visible);
  await run('document.querySelector("[data-dc-resume-dismiss]").click();window.dispatchEvent(new Event("tools:languagechange"))');
  await new Promise(r=>setTimeout(r,100));assert.equal(await run(visible),false);
  console.log('PASS resume close persistence, new conversation/activity, three reloads, language and repeated renders.');
 }finally{win.destroy();server.close();app.quit()}
}).catch(e=>{console.error(e);app.exit(1)});
