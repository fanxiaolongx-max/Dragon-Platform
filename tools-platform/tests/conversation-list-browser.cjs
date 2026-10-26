// All conversation sources and actions below are isolated fixtures.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'conversation-lists-ui-'));
app.setPath('userData',temp);app.disableHardwareAcceleration();let win,server,failSave=false;
const dates=[0,4,10,40].map(age=>new Date(Date.now()-age*86400000).toISOString());
const mine=dates.map((date,i)=>({id:'mine-'+i,firstQuestion:'Personal chat '+i,updatedAt:date}));
const threads=dates.map((date,i)=>({id:'channel-'+i,kind:'group',name:'Channel chat '+i,lastActiveAt:date,messageCount:2,tasks:{open:0},lastMessage:'Last message preview'}));
const native=['codex','claudecode','antigravity'].flatMap((provider,p)=>dates.map((date,i)=>({provider,id:`11111111-1111-4111-8111-${String(p*10+i).padStart(12,'0')}`,title:provider+' chat '+i,updatedAt:date})));
const preferences=[{source:'mine',id:'mine-1',pinned:1,archived:0,hidden:0,title:''}],mutations=[],deleted=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms)),ev=s=>win.webContents.executeJavaScript(s,true);
async function until(s){for(let n=0;n<180;n++){if(await ev(`Boolean(${s})`))return;await wait(20)}throw Error('Timeout: '+s)}
async function context(selector){await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).closest('.conversation-list-row');r.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:1250,clientY:890}));})()`);await until('document.querySelector(".conversation-context-menu")');}
async function choose(action){await ev(`document.querySelector('[data-conversation-action="${action}"]').click()`);await wait(100);}
setTimeout(()=>{console.error('Conversation list fixture timed out');app.exit(1)},60000).unref();
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());web.get('/',(_,res)=>{let html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');const setup=`<script>localStorage.setItem('tools_user','alice');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_tenant_id','default');localStorage.setItem('tools_lang','zh-CN');window.__confirm=true;window.AppDialog={confirm:async()=>window.__confirm,prompt:async()=> 'Renamed chat',alert:async message=>window.__error=message};</script>`;res.type('html').send(html.replace('</body>',setup+['shared/i18n','home/home-mode','home/conversation-list','home/dragon-claw','home/welink-threads','home/desktop-agents'].map(s=>`<script src="/js/${s}.js"></script>`).join('')+'</body>'))});
 web.get('/api/ai/conversation-list',(_,res)=>res.json({items:preferences}));
 web.put('/api/ai/conversation-list',(req,res)=>{if(failSave)return res.status(503).json({error:'Save unavailable'});mutations.push(req.body);let p=preferences.find(p=>p.source===req.body.source&&p.id===req.body.id);if(!p){p={pinned:0,archived:0,hidden:0,title:'',source:req.body.source,id:req.body.id};preferences.push(p)}Object.assign(p,req.body);res.json({item:p})});
 web.get('/api/ai/models',(_,res)=>res.json({models:[]}));web.get('/api/ai/sessions',(req,res)=>res.json({items:mine.filter(i=>!req.query.query||i.firstQuestion.includes(req.query.query))}));
 web.delete('/api/ai/sessions/:id',(req,res)=>{deleted.push(req.params.id);mine.splice(mine.findIndex(i=>i.id===req.params.id),1);res.json({deleted:true})});
 web.get('/api/channels/available',(_,res)=>res.json({items:[{id:'welink'},{id:'weixin'}]}));web.get('/api/channels/:channel/threads',(req,res)=>res.json({items:threads.filter(i=>!req.query.q||i.name.includes(req.query.q))}));
 web.get('/api/desktop-agents/settings',(_,res)=>res.json({owned:true,settings:{enabled:true,allowSend:true,autoSync:false,syncSeconds:20}}));
 const providers=['codex','claudecode','antigravity'].map(id=>({id,enabled:true,connected:true,canSend:true,reason:'Native fixture'}));
 web.get('/api/desktop-agents/sessions',(_,res)=>res.json({items:native,providers,syncedAt:new Date().toISOString()}));
 web.post('/api/desktop-agents/sync',(_,res)=>res.json({items:native,providers,syncedAt:new Date().toISOString()}));
 web.get('/api/desktop-agents/:provider/sessions/:id/messages',(req,res)=>res.json({session:native.find(i=>i.id===req.params.id),items:[{id:'u1',role:'user',content:'Native user'},{id:'a1',role:'assistant',content:'Native reply'}],canSend:true,busy:false}));
 web.use(express.static(path.join(root,'frontend')));server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s))});
 win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:'+server.address().port);
 await until('document.querySelectorAll("#homeChatList .conversation-list-more").length===4');await until('document.querySelector("#homeChatList .home-chat-group")?.textContent==="置顶"');
 assert.equal(await ev('!!document.querySelector("[data-chat-delete]")'),false,'inline trash buttons removed');
 assert.deepEqual(await ev('[...document.querySelectorAll("#homeChatList .home-chat-group")].map(e=>e.textContent)'),['置顶','最近','7 天前','一个月前']);
 assert.equal(await ev('getComputedStyle(document.querySelector("#homeChatList .home-chat-meta")).opacity'),'0');
 const point=await ev('(()=>{const r=document.querySelector("#homeChatList .home-chat-title").getBoundingClientRect();return {x:Math.round(r.x+15),y:Math.round(r.y+5)}})()');win.webContents.sendInputEvent({type:'mouseMove',...point});await wait(350);
 assert.equal(await ev('getComputedStyle(document.querySelector("#homeChatList .home-chat-meta")).opacity'),'1');assert.equal(await ev('getComputedStyle(document.querySelector("#homeChatList .conversation-list-more")).visibility'),'hidden');
 await wait(1950);await until('Number(getComputedStyle(document.querySelector("#homeChatList .conversation-list-more")).opacity)>.5');assert.equal(await ev('getComputedStyle(document.querySelector("#homeChatList .home-chat-meta")).opacity'),'0');
 await ev('document.querySelector("#homeChatList .conversation-list-more").click()');await until('document.querySelector(".conversation-context-menu")');assert.equal(await ev('document.querySelector(".conversation-context-menu").textContent.includes("取消置顶")'),true);
 await choose('pin');await until('document.querySelector("#homeChatList .home-chat-group")?.textContent==="最近"');
 win.webContents.sendInputEvent({type:'mouseMove',x:900,y:40});await wait(250);
 assert.equal(await ev('getComputedStyle(document.querySelector("#homeChatList .conversation-list-more")).visibility'),'hidden');
 await ev('document.querySelector("#homeChatList [data-chat-index]").dispatchEvent(new KeyboardEvent("keydown",{key:"F10",shiftKey:true,bubbles:true,cancelable:true}))');await until('document.querySelector(".conversation-context-menu")');
 await ev('document.querySelector(".conversation-context-menu").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');assert.equal(await ev('!!document.querySelector(".conversation-context-menu")'),false);

 await context('#homeChatList [data-chat-index="0"]');assert.equal(await ev('(()=>{const r=document.querySelector(".conversation-context-menu").getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight})()'),true,'menu clamps to viewport');await choose('archive');
 await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===3');await ev('document.querySelector("#homeChatList").previousElementSibling.querySelector("[data-conversation-view=archived]").click()');await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===1');
 await context('#homeChatList [data-chat-index="0"]');assert.equal(await ev('document.querySelector("[data-conversation-action=archive]").textContent.includes("取消归档")'),true);await choose('archive');await ev('document.querySelector("#homeChatList").previousElementSibling.querySelector("[data-conversation-view=active]").click()');
 await context('#homeChatList [data-chat-index="2"]');await choose('rename');await until('document.querySelector("#homeChatList").textContent.includes("Renamed chat")');
 await ev('homeChatSearch.value="Renamed";homeChatSearch.dispatchEvent(new Event("input",{bubbles:true}))');await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===1');
 await ev('homeChatSearch.value="";homeChatSearch.dispatchEvent(new Event("input",{bubbles:true}))');await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===4');

 await context('#homeChatList [data-chat-index="2"]');await choose('remove');await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===3');assert.deepEqual(deleted,['mine-2']);
 await ev('document.querySelector("[data-chat-source=welink]").click()');await until('document.querySelectorAll("#homeWelinkList .conversation-list-row").length===4');
 assert.deepEqual(await ev('[...document.querySelectorAll("#homeWelinkList .home-chat-group")].map(e=>e.textContent)'),['最近','3 天前','7 天前','一个月前']);
 await context('#homeWelinkList [data-wl-thread="1"]');await choose('pin');await until('document.querySelector("#homeWelinkList .home-chat-group").textContent==="置顶"');
 await context('#homeWelinkList [data-wl-thread="2"]');await choose('remove');await until('document.querySelectorAll("#homeWelinkList .conversation-list-row").length===3');assert.equal(mutations.at(-1).hidden,true);assert.equal(mutations.at(-1).source,'welink');
 await ev('document.querySelector("[data-chat-source=agents]").click()');await until('document.querySelectorAll(".desktop-agent-list .conversation-list-row").length===4');
 assert.deepEqual(await ev('[...document.querySelectorAll(".desktop-agent-list .home-chat-group")].map(e=>e.textContent)'),['最近','3 天前','7 天前','一个月前']);
 const heights=await ev('[...document.querySelectorAll(".desktop-agent-chat")].map(e=>e.getBoundingClientRect().height)');assert.ok(heights.every(h=>h===30),'native times never create a second row');
 await context('.desktop-agent-chat');await choose('archive');await until('document.querySelectorAll(".desktop-agent-list .conversation-list-row").length===3');assert.equal(mutations.at(-1).source,'desktop:codex');
 await ev('document.querySelector("[data-desktop-sync]").click()');await wait(100);assert.equal(await ev('document.querySelectorAll(".desktop-agent-list .conversation-list-row").length'),3,'sync does not resurrect archived entries');
 failSave=true;await context('.desktop-agent-chat');await choose('pin');await until('window.__error==="Save unavailable"');assert.equal(await ev('document.querySelector(".desktop-agent-list .home-chat-group").textContent'),'3 天前');failSave=false;
 await ev('ToolsI18n.setLanguage("en-US")');await until('document.querySelector(".desktop-agent-list .home-chat-group").textContent==="3+ days ago"');await context('.desktop-agent-chat');assert.match(await ev('document.querySelector(".conversation-context-menu").textContent'),/Rename.*Pin.*Archive.*Delete/);
 fs.writeFileSync(path.join(temp,'conversation-menu.png'),(await win.webContents.capturePage()).toPNG());await ev('HomeConversationList.close()');
 await ev('document.documentElement.dataset.theme="light";document.body.classList.add("light-theme")');await context('.desktop-agent-chat');
 assert.equal(await ev('getComputedStyle(document.querySelector(".conversation-context-menu")).backgroundColor'),'rgb(255, 255, 255)');
 await ev('HomeConversationList.close()');
 await win.loadURL('http://127.0.0.1:'+server.address().port);await until('document.querySelectorAll("#homeChatList .conversation-list-row").length===3');await ev('document.querySelector("[data-chat-source=welink]").click()');await until('document.querySelector("#homeWelinkList .home-chat-group")?.textContent==="置顶"');assert.equal(await ev('document.querySelectorAll("#homeWelinkList .conversation-list-row").length'),3,'pins and removals survive reload');
 win.setContentSize(390,844);await wait(100);assert.equal(await ev('document.documentElement.scrollWidth<=innerWidth'),true);
 console.log('PASS: coarse groups across all sources, delayed ellipsis, hover-only single-line times, pin/rename/archive/restore/delete, safe external removal, persistence, failures, English and narrow screens. Preview: '+temp);win.destroy();server.close();app.exit(0);
}).catch(e=>{console.error(e);win?.destroy();server?.close();app.exit(1)});
