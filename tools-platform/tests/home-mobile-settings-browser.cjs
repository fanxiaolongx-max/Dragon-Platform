// 本地完整首页、小屏尺寸与隔离配置；不调用模型或连接真实桌面会话。
const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'home-mobile-settings-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server,writes=0;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=code=>win.webContents.executeJavaScript(code,true);
async function until(code){for(let i=0;i<180;i++){if(await evaluate(code))return;await wait(30)}throw Error('Timeout '+code+'; content: '+await evaluate('document.getElementById("navSettingsContent")?.textContent'))}
const timeout=setTimeout(()=>{console.error('Mobile settings test timed out');app.exit(1)},60000);
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 web.use((req,res,next)=>{if(req.method!=='GET'&&/^\/api\/(nav-settings|ai-settings|media)/.test(req.path))writes++;next()});
 web.get('/api/ai-settings',(_req,res)=>res.json({activeProfileId:'main',profiles:[{id:'main',name:'Fixture connection',provider:'openai-compatible',category:'chat',model:'fixture-model',apiBaseUrl:'https://example.test/v1',maxOutputTokens:2000,temperature:.7,hasApiKey:false}]}));
 web.get('/api/media/admin/overview',(_req,res)=>res.json({totalVideos:0,totalCategories:0,totalSizeFormatted:'0 MB',disk:{freeGb:10},feiniu:{enabled:false}}));
 web.get('/api/media/admin/videos',(_req,res)=>res.json({data:[],categories:[]}));
 web.get('/api/auth/security/settings',(_req,res)=>res.json({enabled:true,sessionMaxAgeHours:168,loginPolicies:[{count:5,windowMinutes:10,lockMinutes:30,severity:'warning',enabled:true}]}));
 web.get('/api/auth/security/locks',(_req,res)=>res.json([]));
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
 web.get('/api/custom-tools',(_req,res)=>res.json([]));
 web.use('/api',(_req,res)=>res.json({items:[]}));web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 win=new BrowserWindow({show:false,width:390,height:844,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(level>=3)console.error('Renderer:',message)});
 await win.loadURL(base);await until('!!window.HomeV2&&!!document.querySelector("[data-chat-index]")');
 assert.equal(await evaluate('getComputedStyle(homeSidebar).display'),'none','mobile starts closed despite desktop open preference');
 assert.equal(await evaluate('localStorage.getItem("tools_v2_side")'),'open');
 const geometry=async()=>{
  const g=await evaluate('(()=>{const m=document.getElementById("navSettingsModal"),w=m.querySelector(".nav-settings-window").getBoundingClientRect(),b=m.querySelector(".nav-settings-close").getBoundingClientRect(),c=navSettingsContent.getBoundingClientRect(),n=navSettingsMobileSection.getBoundingClientRect();return {left:w.left,right:w.right,top:w.top,bottom:w.bottom,closeRight:b.right,closeTop:b.top,closeWidth:b.width,contentBottom:c.bottom,contentTop:c.top,selectWidth:n.width,overflow:navSettingsContent.scrollWidth-navSettingsContent.clientWidth,width:innerWidth,height:innerHeight,transform:getComputedStyle(m.querySelector(".nav-settings-window")).transform}})()');
  assert.ok(g.left>=-1&&g.right<=g.width+1&&g.top>=-1&&g.bottom<=g.height+1,JSON.stringify(g));
  assert.ok(g.closeWidth>=40&&g.closeRight<=g.width&&g.closeTop>=g.top,JSON.stringify(g));
  assert.ok(g.contentBottom<=g.bottom+1&&g.contentTop<g.contentBottom,JSON.stringify(g));
  assert.ok(g.selectWidth>100&&g.overflow<=2,JSON.stringify(g));assert.equal(g.transform,'none');
 };
 await evaluate('openNavSettingsModal();void 0');
 await until('!!document.querySelector(".nav-settings-row")&&!!document.getElementById("navSettingsMobileSection")');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-settings-sidebar")).display'),'none');
 assert.ok(await evaluate('navSettingsMobileSection.options.length>20'));
 await geometry();
 await evaluate('navSettingsMobileSection.value="ai";navSettingsMobileSection.dispatchEvent(new Event("change",{bubbles:true}))');
 await until('!!document.getElementById("navAiProfileName")');await geometry();
 assert.equal(await evaluate('getComputedStyle(navAiProfileName).fontSize'),'16px');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-ai-grid")).gridTemplateColumns.split(" ").length'),1);
 await evaluate('switchNavSettingsTab("media")');await until('!!document.querySelector(".nav-media-feiniu-fields")');await geometry();
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-media-feiniu-fields")).gridTemplateColumns.split(" ").length'),1);
 await evaluate('switchNavSettingsTab("security")');await until('!!document.getElementById("navSecuritySessionHours")');await geometry();
 for(const [width,height] of [[320,640],[430,760],[768,540],[844,390]]){
  win.setContentSize(width,height);await wait(100);await evaluate('switchNavSettingsTab("primary")');await geometry();
 }
 // 模拟软键盘缩短可见区域；真实 iPhone Safari 仍需人工检查。
 win.setContentSize(390,844);await wait(100);
 await evaluate('closeNavSettingsModal();window.originalViewport=window.visualViewport;window.mockViewport=new EventTarget();mockViewport.height=420;mockViewport.offsetTop=10;Object.defineProperty(window,"visualViewport",{configurable:true,value:mockViewport});openNavSettingsModal();void 0');
 await until('navSettingsModal.style.getPropertyValue("--nav-settings-viewport-h")==="420px"');
 const keyboard=await evaluate('(()=>{const r=document.querySelector(".nav-settings-window").getBoundingClientRect();return {top:r.top,bottom:r.bottom}})()');
 assert.ok(keyboard.top>=9&&keyboard.bottom<=431,JSON.stringify(keyboard));
 await evaluate('mockViewport.height=360;mockViewport.dispatchEvent(new Event("resize"))');
 assert.equal(await evaluate('Math.round(document.querySelector(".nav-settings-window").getBoundingClientRect().height)'),360);
 await evaluate('closeNavSettingsModal();mockViewport.height=500;mockViewport.dispatchEvent(new Event("resize"))');
 assert.equal(await evaluate('navSettingsModal.style.getPropertyValue("--nav-settings-viewport-h")'),'360px','closing removes viewport listeners');
 await evaluate('Object.defineProperty(window,"visualViewport",{configurable:true,value:originalViewport});openNavSettingsModal();void 0');
 await evaluate('document.querySelector(".nav-settings-close").click()');assert.equal(await evaluate('document.body.classList.contains("nav-settings-open")'),false);
 win.setContentSize(1280,900);await wait(100);await evaluate('openNavSettingsModal();void 0');
 assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".nav-settings-sidebar")).display'),'none','desktop keeps category sidebar');
 assert.equal(await evaluate('getComputedStyle(document.querySelector(".nav-settings-mobile-nav")).display'),'none');
 await evaluate('switchNavSettingsTab("ai")');await until('!!document.getElementById("navAiProfileName")');
 assert.equal(await evaluate('navSettingsMobileSection.value'),'ai','programmatic navigation also syncs category picker');
 await evaluate('closeNavSettingsModal();localStorage.setItem("tools_lang","en-US");window.dispatchEvent(new Event("tools:languagechange"));document.documentElement.dataset.theme="dark"');
 win.setContentSize(390,844);await wait(100);await evaluate('openNavSettingsModal();void 0');await geometry();
 await wait(200);fs.writeFileSync(path.join(temp,'mobile-settings.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(writes,0,'viewing and switching settings never submits changes');
 win.destroy();server.close();clearTimeout(timeout);console.log('PASS: full mobile settings, native category picker, primary/AI/media/security layouts, compact readable inputs, 320-844px widths, keyboard viewport, close cleanup and desktop fallback. '+temp);app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
