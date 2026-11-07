// 本地完整首页、小屏尺寸与隔离配置；不调用模型或连接真实桌面会话。
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'home-mobile-sidebar-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=code=>win.webContents.executeJavaScript(code,true);
async function until(code){for(let i=0;i<180;i++){if(await evaluate(code))return;await wait(30)}throw Error('Timeout '+code)}
const timeout=setTimeout(()=>{console.error('Mobile sidebar test timed out');app.exit(1)},60000);
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 web.get('/',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace('<head>',`<head><script>
 localStorage.setItem('tools_token','fixture');localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_tenant_id','default');
 if(!localStorage.getItem('tools_v2_side'))localStorage.setItem('tools_v2_side','open');
 </script>`)));
 web.get('/api/auth/me',(_req,res)=>res.json({username:'fixture',role:'admin',tenantId:'default'}));
 web.get('/api/tenants',(_req,res)=>res.json({tenants:[{id:'default',name:'Default'}],activeTenantId:'default'}));
 web.get('/api/app-version',(_req,res)=>res.json({version:'fixture'}));
 web.get('/api/desktop-agents/settings',(_req,res)=>res.json({owned:true,settings:{enabled:false}}));
 web.get('/api/agent-workspace/capability',(_req,res)=>res.json({enabled:false}));
 web.get('/api/ai/models',(_req,res)=>res.json({models:[{id:'fixture',name:'Fixture model',provider:'openai-compatible'}],defaultId:'fixture',mode:'direct'}));
 web.get('/api/ai/sessions',(_req,res)=>res.json({items:Array.from({length:30},(_,i)=>({id:'chat-'+i,title:'Mobile chat '+i,updatedAt:new Date().toISOString(),messageCount:2}))}));
 web.get('/api/ai/sessions/:id/messages',(_req,res)=>res.json({items:[{id:'user',role:'user',content:'A mobile question'},{id:'answer',role:'model',content:'Mobile conversation is visible.'}],hasMore:false}));
 web.get('/api/platform-promotions',(_req,res)=>res.json({desktopStack:false,links:[],videos:[]}));
 web.get(['/api/friend-links','/api/recent-nav','/api/upload/history'],(_req,res)=>res.json([]));
 web.use('/api',(_req,res)=>res.json({items:[]}));web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 win=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadURL(base);await until('!!window.HomeV2&&!!document.querySelector("[data-chat-index]")');
 assert.equal(await evaluate('getComputedStyle(homeSidebar).display'),'none','mobile starts closed despite desktop open preference');
 assert.equal(await evaluate('localStorage.getItem("tools_v2_side")'),'open');
 const openDrawer=async()=>{await evaluate('document.querySelector("[data-v2-float=toggle]").click()');await until('document.body.classList.contains("v2-mobile-side-open")');};
 const assertGeometry=async()=>{
  const g=await evaluate('(()=>{const s=homeSidebar.getBoundingClientRect(),f=document.querySelector(".v2-userbar").getBoundingClientRect(),p=document.querySelector(".home-panel").getBoundingClientRect(),m=document.querySelector(".home-main").getBoundingClientRect();return {sideWidth:s.width,sideBottom:s.bottom,footerBottom:f.bottom,footerTop:f.top,panelHeight:p.height,mainLeft:m.left,mainRight:m.right,w:innerWidth,h:innerHeight}})()');
  assert.ok(g.sideWidth<=g.w-55,JSON.stringify(g));assert.ok(Math.abs(g.sideBottom-g.h)<2,JSON.stringify(g));
  assert.ok(Math.abs(g.footerBottom-g.h)<2&&g.footerTop>g.h-100,JSON.stringify(g));assert.ok(g.panelHeight>40,JSON.stringify(g));
  assert.ok(g.mainLeft>=-1&&g.mainRight<=g.w+1,JSON.stringify(g));
 };
 await openDrawer();await assertGeometry();
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".home-panel")).display'),'flex');
 await evaluate('document.querySelector(".v2-mobile-side-backdrop").click()');await until('getComputedStyle(homeSidebar).display==="none"');
 await openDrawer();await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');assert.equal(await evaluate('document.body.classList.contains("v2-mobile-side-open")'),false);
 await openDrawer();await evaluate('document.querySelector("[data-chat-index]").click()');
 await until('dcThread.textContent.includes("Mobile conversation is visible")');
 assert.equal(await evaluate('getComputedStyle(homeSidebar).display'),'none','selecting a chat closes drawer');
 const chat=await evaluate('(()=>{const r=dcInput.getBoundingClientRect(),m=document.querySelector(".home-main").getBoundingClientRect();return {bottom:r.bottom,left:m.left,right:m.right,w:innerWidth,h:innerHeight}})()');
 assert.ok(chat.bottom<=chat.h+1&&chat.left>=-1&&chat.right<=chat.w+1,JSON.stringify(chat));
 fs.writeFileSync(path.join(temp,'mobile-conversation.png'),(await win.webContents.capturePage()).toPNG());
 await evaluate('window.dispatchEvent(new CustomEvent("dragon-claw:browser-update",{detail:{tool:"browser_navigate"}}))');
 assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false,'AI browser does not cover mobile chat automatically');
 await evaluate('dcBrowserToggle.click()');await until('DragonBrowserSidebar.isOpen()');
 await evaluate('document.querySelector(".home-main").dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}))');
 assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false,'mobile browser drawer closes outside');
 assert.equal(await evaluate('document.body.classList.contains("v2-mobile-side-open")'),false,'closing browser does not restore a persistent mobile menu');

 await openDrawer();await evaluate('document.querySelector("[data-v2-action=newChat]").click()');assert.equal(await evaluate('document.body.classList.contains("v2-mobile-side-open")'),false,'new chat closes drawer');
 await openDrawer();await win.loadURL(base);await until('!!window.HomeV2');assert.equal(await evaluate('getComputedStyle(homeSidebar).display'),'none','reload does not retain temporary drawer');
 for(const [width,height] of [[430,760],[844,390]]){win.setContentSize(width,height);await wait(120);await openDrawer();await assertGeometry();await evaluate('document.querySelector(".v2-mobile-side-backdrop").click()');}
 win.setContentSize(1440,950);await wait(150);assert.equal(await evaluate('HomeV2.isSideCollapsed()'),false,'desktop open preference restored');
 await evaluate('DragonBrowserSidebar.open()');await until('DragonBrowserSidebar.isOpen()');
 win.setContentSize(390,844);await wait(150);assert.equal(await evaluate('getComputedStyle(homeSidebar).display'),'none','entering mobile closes navigation');
 assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false,'desktop browser closes when entering a mobile viewport');
 await openDrawer();await evaluate('window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))');assert.equal(await evaluate('getComputedStyle(homeSidebar).display'),'none','bfcache restore closes drawer');
 await evaluate('localStorage.setItem("tools_lang","en");window.dispatchEvent(new Event("tools:languagechange"));document.documentElement.dataset.theme="dark"');
 await openDrawer();await assertGeometry();
 assert.equal(await evaluate('localStorage.getItem("tools_v2_side")'),'open','mobile interactions never overwrite desktop preference');
 await wait(200);fs.writeFileSync(path.join(temp,'mobile-sidebar.png'),(await win.webContents.capturePage()).toPNG());
 await evaluate('document.querySelector(".v2-mobile-side-backdrop").click()');await wait(100);fs.writeFileSync(path.join(temp,'mobile-chat.png'),(await win.webContents.capturePage()).toPNG());
 win.destroy();server.close();clearTimeout(timeout);console.log('PASS: mobile default closed, temporary drawer, list scrolling, bottom controls, outside/Escape/selection close, chat visibility, reload, landscape, desktop preference and bfcache. '+temp);app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
