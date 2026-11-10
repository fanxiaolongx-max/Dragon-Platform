// node_modules/.bin/electron tests/browser-sidebar-browser.cjs
// 本地测试页与临时用户目录，不访问外站或业务数据库。
const { app, BrowserWindow, ipcMain, nativeImage, Menu, shell } = require('electron');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict'), express = require('express');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-sidebar-'));
app.setPath('userData', path.join(temp, 'profile')); app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i=0;i<120;i++) { if(await fn()) return; await wait(40); } throw Error('Timed out '+fn); }
let host, server, stack, workspaceEnabled = false, viewReads = 0, mobilePage = false;
const timeout=setTimeout(()=>{console.error('Timeout');app.exit(1);},60000);
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 let remoteTabs=[],remoteActive=null,remoteManual=false,remoteSequence=0,remoteNarrow=false,remoteAI=false,remoteHandoff=false,remoteTypingSlow=false,remoteText='',remoteTabDelay=0;const remoteCalls=[];let streamFrames=0,streamCloses=0,uploadedFiles=[],remoteDownloads=[];
 web.get('/',(_req,res)=>{
  let html=fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<html ','<html data-ui="v2" data-theme="light" ');
  res.send(html.replace('</body>','<script>document.body.classList.add("home-mode-chat");</script><script src="/js/shared/sidebar-resize.js"></script><script src="/js/home/workspace-panel.js"></script><script src="/js/home/browser-sidebar.js"></script><script src="/js/shared/chat-files.js"></script><script src="/js/home/tool-frame.js"></script></body>'));
 });
 web.get('/api/agent-workspace/capability',(_req,res)=>res.json({enabled:workspaceEnabled}));
 web.get('/api/agent-workspace/browser/view',(_req,res)=>{
  viewReads++;const current=remoteTabs.find(tab=>tab.id===remoteActive),width=mobilePage?375:1280,height=800;
  res.json({available:!!current,tabs:remoteTabs,activeId:remoteActive,title:current?.title,url:current?.url,frameId:'fixture-frame',viewport:{width,height},downloads:remoteDownloads,layout:remoteNarrow?{preferredWidth:480}:null,upload:{id:'chooser-fixture',multiple:true},operator:{active:remoteAI,handoff:remoteHandoff,cursor:remoteAI?{x:.4,y:.3,at:Date.now()}:null},manual:{active:remoteManual},image:current?nativeImage.createFromBitmap(Buffer.alloc(width*height*4,255),{width,height}).toDataURL():undefined});
 });
 web.get('/api/agent-workspace/browser/stream',(req,res)=>{
  res.set({'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});res.flushHeaders();
  const frame=()=>{const current=remoteTabs.find(tab=>tab.id===remoteActive);streamFrames++;res.write(JSON.stringify({available:!!current,tabs:remoteTabs,activeId:remoteActive,title:current?.title,url:current?.url,frameId:'fixture-frame',viewport:{width:mobilePage?375:1280,height:800},downloads:remoteDownloads,layout:remoteNarrow?{preferredWidth:480}:null,operator:{active:remoteAI,handoff:remoteHandoff,cursor:remoteAI?{x:.4,y:.3,at:Date.now()}:null},manual:{active:remoteManual},upload:{id:'chooser-fixture',multiple:true},image:current?nativeImage.createFromBitmap(Buffer.alloc(200*125*4,255),{width:200,height:125}).toDataURL():undefined})+'\n');};
  const timer=setInterval(frame,150);res.on('close',()=>{streamCloses++;clearInterval(timer);});
 });
 web.post('/api/agent-workspace/browser/upload',require('multer')({storage:require('multer').memoryStorage()}).array('files'),(req,res)=>{uploadedFiles.push(...req.files);res.json({files:req.files.map(file=>({name:file.originalname,size:file.size}))});});
 web.post('/api/agent-workspace/browser/control',async(req,res)=>{
  const {action}=req.body;remoteCalls.push(req.body);if(action==='new-tab'&&remoteTabDelay)await wait(remoteTabDelay);
  if(action==='release'){remoteManual=false;remoteHandoff=false;}else {if(action==='takeover'&&remoteAI)remoteHandoff=true;remoteManual=true;}
  if(action==='open'||action==='new-tab'){
   let current=remoteTabs.find(tab=>tab.id===remoteActive);
   if(!current||action==='new-tab'){current={id:'remote-'+(++remoteSequence),title:'Shared browser',url:'about:blank'};remoteTabs.push(current);remoteActive=current.id;}
   if(action==='open')current.url=req.body.url;
  }
  if(action==='select-tab')remoteActive=req.body.tabId;
  if(action==='close-tab'){remoteTabs=remoteTabs.filter(tab=>tab.id!==req.body.tabId);if(remoteActive===req.body.tabId)remoteActive=remoteTabs.at(-1)?.id||null;}
  if(action==='type')remoteText=(req.body.replace?'':remoteText)+req.body.text;if(action==='key'&&req.body.key==='Backspace')remoteText=remoteText.slice(0,-1);
  if(remoteTypingSlow&&['type','key'].includes(action))await wait(100);
  res.json({tabId:remoteActive,mode:remoteManual?'manual':'ai',...(['acquire','takeover','open','new-tab'].includes(action)?{token:'fixture-manual-token'}:{})});
 });
 web.get('/api/agent-workspace/prefs',(_req,res)=>res.json({lastDirectory:'',recentDirectories:[],permissionMode:'ask'}));
 web.get('/api/agent-workspace/browser/downloads/export-fixture',(req,res)=>req.headers.authorization==='Bearer test-download-token'?res.type('application/octet-stream').send('<h1>Web export</h1>'):res.sendStatus(401));
 web.get('/sla', (req,res)=>{if(!String(req.headers.cookie||'').includes('tools_token=main-fixture-session'))return res.redirect('/login.html');res.send('<title>Import fixture</title><div id=import-ready>Import</div>');});
 web.get('/site',(req,res)=>res.send('<title>Local browser fixture</title><input id="value" value="initial"><a href="/second">next</a><input id="native-file" type="file"><input id="native-range" type="range" min="0" max="100" value="0" style="display:block;width:300px">'));
 web.get('/narrow',(_req,res)=>res.send('<title>Narrow menu</title><main style="max-width:440px;margin:auto"><h1>Lunch menu</h1>'+Array.from({length:18},(_,i)=>'<p>Dish '+i+' — restaurant menu with fresh ingredients, soup, sandwiches and salads.</p>').join('')+'</main>'));
 web.get('/download',(_req,res)=>res.attachment('dragon-toolbar-fixture.txt').send('sidebar download fixture'));
 web.get('/second',(_req,res)=>res.send('<title>Second fixture</title><p>second</p>'));
 web.get('/api/agent-files/stat',(_req,res)=>res.json({size:30}));
 web.get('/api/agent-files/raw',(_req,res)=>res.type('text').send('file preview fixture'));
 web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 const base=`http://127.0.0.1:${server.address().port}`;
 const makeHost=async(desktop)=>{
  host=new BrowserWindow({show:false,width:1440,height:950,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,...(desktop?{preload:path.join(root,'electron-preload.js')}:{})}});
  host.webContents.on('console-message',(_event,level,message)=>{if(level>=3)console.error('Renderer:',message)});
  await host.loadURL(base);await until(()=>host.webContents.executeJavaScript('!!window.DragonBrowserSidebar&&!!document.querySelector(".wsp-card--external")'));return host;
 };
 const evaluate=code=>host.webContents.executeJavaScript(code,true).catch(error=>{throw Error(error.message+'\nWhile evaluating: '+code)});
 await makeHost(false);
 await evaluate('DragonClawWorkspace.showExternal({title:"Agent",open:true});void 0');
 const original=await evaluate('dcWorkspacePanel.getBoundingClientRect().width');
 await evaluate('dcWorkspacePanel.querySelector(".dc-sidebar-resize").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
 assert.ok(await evaluate(`dcWorkspacePanel.getBoundingClientRect().width>=${original+39}`));
 const workspaceWidth=await evaluate('dcWorkspacePanel.getBoundingClientRect().width');
 await evaluate('localStorage.setItem("tools_v2_side","open");dcBrowserToggle.click()');
 await until(()=>evaluate('dcBrowserPanel.getBoundingClientRect().width>800'));
 assert.equal(await evaluate('dcWorkspacePanel.hidden'),true);
 assert.equal(await evaluate('document.body.classList.contains("v2-side-collapsed")'),true);
 assert.equal(await evaluate('!!document.querySelector(".dc-browser-modes, .dc-browser-surface iframe")'),false,'one browser with no separate embedded session');
 assert.equal(await evaluate('document.querySelectorAll(".dc-browser-tabbar [data-browser=new-tab]").length'),1,'only the plus button creates a new tab before any pages exist');
 const automaticWidth=await evaluate('dcBrowserPanel.getBoundingClientRect().width');
 await evaluate('dcBrowserPanel.querySelector(".dc-sidebar-resize").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');
 const manualWidth=await evaluate('dcBrowserPanel.getBoundingClientRect().width');assert.ok(manualWidth<automaticWidth-30);
 await evaluate('DragonBrowserSidebar.open()');await wait(80);assert.equal(await evaluate('dcBrowserPanel.getBoundingClientRect().width'),manualWidth);
 await evaluate('DragonBrowserSidebar.close()');assert.equal(await evaluate('document.body.classList.contains("v2-side-collapsed")'),false);
 await evaluate('DragonBrowserSidebar.open()');await until(()=>evaluate(`dcBrowserPanel.getBoundingClientRect().width>${manualWidth+30}`));
 await evaluate(`document.querySelector('.dc-browser-address input').value=${JSON.stringify(base+'/site')};document.querySelector('.dc-browser-address').requestSubmit()`);
 await until(()=>evaluate('!document.querySelector(".dc-browser-agent-view img").hidden&&!document.querySelector(".dc-browser-operator button").disabled'));
 assert.equal(remoteManual,true,'typing an address starts the same controlled browser without asking AI first');
 await evaluate('window.fixtureExternal=[];window.open=(...args)=>{fixtureExternal.push(args);return null;};document.querySelector("[data-browser=external]").click()');
 assert.deepEqual(await evaluate('fixtureExternal[0]'),[base+'/site','_blank','noopener,noreferrer']);
 assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),true,'opening in a new web tab preserves the sidebar');

 const webSurfaceBefore=await evaluate('JSON.stringify(document.querySelector(".dc-browser-surface").getBoundingClientRect().toJSON())');
 await evaluate('document.querySelector("[data-browser=more]").click()');assert.equal(await evaluate('document.querySelector(".dc-browser-popup").hidden'),false);
 assert.equal(await evaluate('JSON.stringify(document.querySelector(".dc-browser-surface").getBoundingClientRect().toJSON())'),webSurfaceBefore,'floating menu does not move or resize the web page');
 assert.equal(await evaluate('document.querySelector(".dc-browser-popup [data-browser=find-open]").disabled'),true,'web does not pretend native find is available');
 await wait(100);fs.writeFileSync(path.join(temp,'web-floating-menu.png'),(await host.webContents.capturePage()).toPNG());
 await evaluate('document.querySelector(".dc-browser-popup [data-browser=dismiss-menu]").click()');
 await wait(100);fs.writeFileSync(path.join(temp,'web-toolbar.png'),(await host.webContents.capturePage()).toPNG());
 remoteDownloads=[{id:'export-fixture',name:'导出.html',state:'progressing',received:0}];
 await until(()=>evaluate('!!document.querySelector("[data-browser=downloads].has-downloads")'));
 await evaluate('document.querySelector(".dc-browser-toolbar-actions [data-browser=downloads]").click()');
 assert.equal(await evaluate('!!document.querySelector("[data-download-action=save]")'),false);
 remoteDownloads[0].state='completed';
 await until(()=>evaluate('!!document.querySelector("[data-download-action=save]")'));
 const savedExport=path.join(temp,'web-export.html');
 const downloadCompleted=new Promise((resolve,reject)=>host.webContents.session.once('will-download',(_event,item)=>{
  assert.equal(item.getFilename(),'导出.html');
  item.setSavePath(savedExport);
  item.once('done',(_event,state)=>state==='completed'?resolve():reject(Error(state)));
 }));
 await evaluate('sessionStorage.setItem("tools_token","test-download-token");document.querySelector("[data-download-action=save]").click()');
 await downloadCompleted;
 assert.equal(fs.readFileSync(savedExport,'utf8'),'<h1>Web export</h1>');
 await evaluate('sessionStorage.removeItem("tools_token");document.querySelector(".dc-browser-popup [data-browser=dismiss-menu]").click()');

 assert.equal(await evaluate('document.querySelector(".dc-browser-control").hidden'),true,'page input tools stay collapsed by default');
 assert.equal(await evaluate('document.querySelector(".dc-browser-operator").hidden'),true,'ordinary browsing has no AI handback banner');
 await evaluate('document.querySelector("[data-browser=keyboard]").click()');
 assert.equal(await evaluate('document.querySelector(".dc-browser-control").hidden'),false);
 await evaluate('document.querySelector(".dc-browser-agent-view img").dispatchEvent(new MouseEvent("click",{bubbles:true,clientX:document.querySelector(".dc-browser-agent-view img").getBoundingClientRect().left+100,clientY:document.querySelector(".dc-browser-agent-view img").getBoundingClientRect().top+30}))');
 await until(()=>remoteCalls.some(call=>call.action==='click'));
 assert.ok(remoteCalls.find(call=>call.action==='click').x>=0&&remoteCalls.find(call=>call.action==='click').x<=1);
 await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 await evaluate('document.querySelector("[data-remote-text]").value="Manual input";document.querySelector("[data-browser=send-text]").click()');
 await until(()=>remoteCalls.some(call=>call.action==='type'));
 await until(()=>evaluate('document.querySelector("[data-remote-text]").value===""&&!document.querySelector(".dc-browser-operator button").disabled'));
 assert.equal(remoteCalls.find(call=>call.action==='type').text,'Manual input');
 await wait(200);remoteText='';remoteTypingSlow=true;const typingReads=viewReads,typingCalls=remoteCalls.length;
 await evaluate(`(()=>{const image=document.querySelector('.dc-browser-agent-view img');for(const key of '123456789abcdefghij')image.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));image.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));image.dispatchEvent(new KeyboardEvent('keydown',{key:'X',bubbles:true,cancelable:true}));})()`);
 await until(()=>remoteText==='123456789abcdefghiX');await wait(150);remoteTypingSlow=false;
 assert.ok(remoteCalls.slice(typingCalls).filter(call=>call.action==='type').length<=3,'rapid keys are batched without dropping characters');
 assert.ok(viewReads-typingReads<=1,'typing uses continuous frames instead of requesting a full screenshot per key');

 await evaluate('document.querySelector("[data-browser=remote-enter]").click()');await until(()=>remoteCalls.some(call=>call.action==='key'&&call.key==='Enter'));
 await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 await until(()=>streamFrames>1);
 const dragPoint=await evaluate('(()=>{const r=document.querySelector(".dc-browser-agent-view img").getBoundingClientRect();return{x:Math.round(r.left+30),y:Math.round(r.top+25)}})()');
 host.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...dragPoint});
 await until(()=>remoteCalls.some(call=>call.action==='pointer'&&call.phase==='down'));
 host.webContents.sendInputEvent({type:'mouseMove',x:dragPoint.x+50,y:dragPoint.y+15,modifiers:['leftButtonDown']});
 await until(()=>remoteCalls.some(call=>call.action==='pointer'&&call.phase==='move'));
 host.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:dragPoint.x+80,y:dragPoint.y+20});
 await until(()=>remoteCalls.some(call=>call.action==='pointer'&&call.phase==='up'));
 await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 await evaluate(`(()=>{const input=document.querySelector('[data-local-files]'),dt=new DataTransfer();dt.items.add(new File(['phone file fixture'],'phone.txt',{type:'text/plain'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await until(()=>uploadedFiles.length===1);assert.equal(uploadedFiles[0].buffer.toString(),'phone file fixture');
 await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 remoteNarrow=true;
 await until(()=>evaluate('dcBrowserPanel.getBoundingClientRect().width<=500'));
 const narrowWidth=await evaluate('dcBrowserPanel.getBoundingClientRect().width');
 await evaluate('dcBrowserPanel.querySelector(".dc-sidebar-resize").dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft",bubbles:true}))');
 await wait(400);assert.ok(await evaluate('dcBrowserPanel.getBoundingClientRect().width')>narrowWidth+30,'content measurement preserves manual width');remoteNarrow=false;
 remoteTabDelay=400;await evaluate('window.originalFirstTab=document.querySelector("[data-tab=remote-1]").closest(".dc-browser-tab");document.querySelector("[data-browser=new-tab]").click()');
 assert.equal(await evaluate('!!document.querySelector(".dc-browser-tab.is-pending")'),true,'click immediately paints a tab before a slow backend reply');
 assert.ok(await evaluate('document.querySelector(".dc-browser-tab.is-pending").getAnimations().length')>0,'new tab has an opening animation');
 await until(()=>remoteTabs.length===2);await until(()=>evaluate('!document.querySelector(".dc-browser-tab.is-pending")'));remoteTabDelay=0;
 assert.equal(await evaluate('window.originalFirstTab===document.querySelector("[data-tab=remote-1]").closest(".dc-browser-tab")'),true,'unchanged tabs retain DOM identity and focus');
 await until(()=>evaluate('document.querySelector(".dc-browser-surface").classList.contains("is-empty")'));
 for(const theme of ['light','dark']){await evaluate(`document.documentElement.dataset.theme='${theme}'`);await wait(50);const colors=await evaluate('({surface:getComputedStyle(document.querySelector(".dc-browser-surface")).backgroundColor,platform:getComputedStyle(dcBrowserPanel).backgroundColor,imageHidden:document.querySelector(".dc-browser-agent-view img").hidden})');assert.equal(colors.surface,colors.platform);assert.equal(colors.imageHidden,true,'blank tab does not display a dark remote screenshot');}
 await evaluate('document.documentElement.dataset.theme="light"');

 await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 await evaluate('document.querySelector("[data-tab=remote-1]").click()');await until(()=>remoteActive==='remote-1');
 await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 await evaluate('document.querySelector(".dc-browser-operator button").click()');await until(()=>!remoteManual);
 await until(()=>evaluate('document.querySelector(".dc-browser-control").hidden'));
 assert.equal(await evaluate('document.querySelector(".dc-browser-address input").value'),base+'/site','handing back preserves the page');
 await evaluate('DragonClawWorkspace.showExternal({title:"Other chat",open:true});void 0');assert.equal(await evaluate('dcBrowserPanel.hidden'),true);
 await evaluate('ChatFiles.openPreview("/tmp/a.md");void 0');await until(()=>evaluate('!!document.querySelector(".ai-file-preview pre")'));
 await evaluate('dcBrowserToggle.click()');assert.equal(await evaluate('!!document.querySelector(".ai-file-preview")'),false);
 const beforeHistory=viewReads;
 await evaluate('DragonBrowserSidebar.close();window.fixtureReply=document.createElement("div");fixtureReply.innerHTML="<div class=dc-msg-main><div class=dc-msg-body></div></div>";document.body.append(fixtureReply);void 0');
 const emit=(id,ok,replay=false)=>evaluate(`DragonClawWorkspace.${replay?'replayEvents':'handleEvent'}(fixtureReply,${replay?JSON.stringify([{type:'tool_start',tool:'browser_navigate',callId:id,args:{url:base}},{type:'tool_result',tool:'browser_navigate',callId:id,ok}]):JSON.stringify({type:'tool_start',tool:'browser_navigate',callId:id,args:{url:base}})});${replay?'':`DragonClawWorkspace.handleEvent(fixtureReply,${JSON.stringify({type:'tool_result',tool:'browser_navigate',callId:id,ok})})`};void 0`);
 await emit('history',true,true);await wait(50);assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false);
 await emit('failed',false);await wait(50);assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false);
 await emit('opened',true);await until(()=>evaluate('DragonBrowserSidebar.isOpen()'));
 mobilePage=true;await evaluate('document.querySelector("[data-browser=reload]").click()');await until(()=>evaluate('document.querySelector(".dc-browser-agent-view img").naturalWidth===375&&dcBrowserPanel.getBoundingClientRect().width<500'));mobilePage=false;
 host.setSize(700,900);await wait(150);assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false);
 await emit('mobile-no-popup',true);assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false);
 await evaluate('dcBrowserToggle.click()');await until(()=>evaluate('DragonBrowserSidebar.isOpen()'));assert.ok(await evaluate('dcBrowserPanel.getBoundingClientRect().width<=innerWidth-31'));
 host.setSize(390,844);await wait(100);await until(()=>evaluate('!document.querySelector(".dc-browser-operator button").disabled'));
 await evaluate('document.querySelector(".dc-browser-agent-view img").click()');await until(()=>remoteManual);
 await evaluate('document.querySelector("[data-browser=more]").click();document.querySelector(".dc-browser-popup [data-browser=keyboard]").click()');await until(()=>evaluate('!document.querySelector(".dc-browser-control").hidden&&!document.querySelector(".dc-browser-operator button").disabled'));
 const mobileMenu=await evaluate('(()=>{const r=document.querySelector(".dc-browser-popup").getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,width:innerWidth}})()');assert.ok(mobileMenu.left>=0&&mobileMenu.right<=mobileMenu.width&&mobileMenu.top>40,JSON.stringify(mobileMenu));
 await wait(200);fs.writeFileSync(path.join(temp,'mobile-browser-control.png'),(await host.webContents.capturePage()).toPNG());
 await wait(5400);await until(()=>!remoteManual);assert.equal(await evaluate('document.querySelector(".dc-browser-control").hidden'),true,'five idle seconds return control automatically');
 remoteAI=true;await until(()=>evaluate('!document.querySelector(".dc-browser-ai-pointer").hidden'));
 const clicksBefore=remoteCalls.filter(call=>call.action==='click').length;
 await evaluate('document.querySelector(".dc-browser-agent-view img").click()');assert.equal(remoteCalls.filter(call=>call.action==='click').length,clicksBefore,'AI-owned click is blocked until stop');
 assert.equal(await evaluate('document.querySelector(".dc-browser-operator").hidden'),false);
 await evaluate('document.querySelector("[data-browser=stop-and-control]").click()');await until(()=>remoteManual);assert.ok(remoteCalls.some(call=>call.action==='takeover'));
 remoteAI=false;await evaluate('DragonBrowserSidebar.close()');await until(()=>!remoteManual);
 await evaluate('localStorage.setItem("tools_lang","en");window.dispatchEvent(new Event("tools:languagechange"))');assert.equal(await evaluate('dcBrowserToggle.textContent'),'Browser');
 workspaceEnabled=true;host.setSize(1440,950);await host.loadURL(base);await until(()=>evaluate('DragonClawWorkspace.isEnabled()'));
 await evaluate('DragonClawWorkspace.openPanel()');assert.equal(Math.round(await evaluate('dcWorkspacePanel.getBoundingClientRect().width')),Math.round(workspaceWidth));
 workspaceEnabled=false;host.destroy();
 const readingEvents=[];
 app.setPath('downloads',path.join(temp,'downloads'));
 const {createPromoStack}=require('../desktop-promo/promo-stack');
 const extensionsStatePath=path.join(temp,'extensions.json');
 fs.writeFileSync(extensionsStatePath,JSON.stringify({imported:[],disabled:['auto:icpm','bundled:chrome-capture-pro','bundled:overseas-salary-calculator']}));
 stack=createPromoStack({statePath:path.join(temp,'stack.json'),extensionsStatePath,getSidebarHost:()=>host,getAppBaseUrl:()=>base});
 require('../desktop-browser-sidebar').registerBrowserSidebar({ipcMain,getWindow:()=>host,getBaseUrl:()=>base,browser:stack,onReadingChange:active=>readingEvents.push(active)});
 const externalOpens=[],originalExternal=shell.openExternal;shell.openExternal=async url=>{externalOpens.push(url);};
 const nativeMenus=[],originalBuild=Menu.buildFromTemplate;
 Menu.buildFromTemplate=template=>({popup:options=>nativeMenus.push({template,options})});
 const nativeItem=expression=>nativeMenus.at(-1)?.template.find(item=>expression.test(item.label||''));
 await makeHost(true);
 await host.webContents.session.cookies.set({url:base,name:'tools_token',value:'main-fixture-session',httpOnly:true,sameSite:'lax'});
 // Launch from an embedded tool without entering a historical conversation.
 await evaluate(`HomeToolFrame.open('/site');void 0`);
 await until(()=>evaluate('!!document.querySelector("#v2ToolFrame iframe").contentDocument?.querySelector("#value")'));
 await evaluate('document.querySelector("#v2ToolFrame iframe").contentDocument.querySelector("#value").value="tool-state"');
 const toolUrl=await evaluate('location.href');
 assert.equal(await evaluate('document.querySelector("[data-frame-act=browser]").hidden'),false);
 assert.equal(await evaluate('dcBrowserPanel.hidden'),true);
 const batch=await stack.runUivMacro({Name:'Embedded tool batch',Commands:[{Command:'open',Target:base+'/site'}]});
 assert.equal(batch.success,true);
 await until(async()=>await evaluate('!dcBrowserPanel.hidden')&&host.getBrowserViews().length===1);
 assert.equal(await evaluate('location.href'),toolUrl,'batch reveal preserves the tool page');
 assert.equal(await evaluate('document.querySelector("#v2ToolFrame iframe").contentDocument.querySelector("#value").value'),'tool-state');
 assert.equal(await evaluate('document.querySelector("[data-frame-act=browser]").getAttribute("aria-pressed")'),'true');
 assert.ok(await evaluate('document.querySelector("#v2ToolFrame").getBoundingClientRect().right<=dcBrowserPanel.getBoundingClientRect().left+1'),'tool and browser are side by side');
 await evaluate('document.querySelector("[data-frame-act=browser]").click()');
 await until(()=>host.getBrowserViews().length===0);
 await evaluate('document.querySelector("[data-frame-act=browser]").click()');
 await until(()=>host.getBrowserViews().length===1);
 assert.equal(await evaluate('document.querySelector("#v2ToolFrame iframe").contentDocument.querySelector("#value").value'),'tool-state');
 await evaluate('localStorage.setItem("tools_lang","en-US");window.dispatchEvent(new Event("tools:languagechange"))');
 assert.equal(await evaluate('document.querySelector("[data-frame-act=browser]").textContent'),'Browser');
 // Reserve the full-height resize strip outside the native page bounds.
 const strip=await evaluate(`(()=>{const h=dcBrowserPanel.querySelector('.dc-sidebar-resize').getBoundingClientRect(),s=document.querySelector('.dc-browser-surface').getBoundingClientRect();return{x:Math.round(h.left+4),y:Math.round(s.top+s.height*.6),right:h.right,width:dcBrowserPanel.getBoundingClientRect().width};})()`);
 assert.ok(host.getBrowserViews()[0].getBounds().x>=Math.floor(strip.right),'native page leaves the lower resize strip exposed');
 host.webContents.sendInputEvent({type:'mouseDown',x:strip.x,y:strip.y,button:'left',clickCount:1});
 await wait(50);
 host.webContents.sendInputEvent({type:'mouseMove',x:strip.x+80,y:strip.y,button:'left'});
 await wait(50);
 host.webContents.sendInputEvent({type:'mouseUp',x:strip.x+80,y:strip.y,button:'left',clickCount:1});
 await until(()=>evaluate(`dcBrowserPanel.getBoundingClientRect().width<${strip.width-50}`));
 await until(()=>host.getBrowserViews().length===1);
 // Completion opens the SLA tool in the main frame's existing authenticated session.
 const capturePage=host.getBrowserViews()[0].webContents;
 const importHref='/sla?uivImportSession='+'a'.repeat(32)+'&uivImportToken='+'b'.repeat(32)+'&autoImport=1&targetMonth=7';
 const captureTabs=await evaluate('document.querySelectorAll(".dc-browser-tab").length');
 await capturePage.executeJavaScript(`window.open(${JSON.stringify(base+importHref)},'_blank','noopener');void 0`);
 await until(()=>evaluate('!!document.querySelector("#v2ToolFrame iframe").contentDocument?.querySelector("#import-ready")'));
 assert.equal(await evaluate('document.querySelector("#v2ToolFrame iframe").contentWindow.location.search'),importHref.slice(4),'import parameters and target month reach the existing tool');
 assert.equal(await evaluate('DragonBrowserSidebar.isOpen()'),false,'capture browser closes its sidebar for the import tool');
 assert.equal(await evaluate('document.querySelectorAll(".dc-browser-tab").length'),captureTabs,'import creates no Dragon browser tab');
 assert.equal(capturePage.isDestroyed(),false,'capture results are retained');
 await evaluate('document.querySelector("[data-frame-act=browser]").click()');
 await until(()=>host.getBrowserViews().some(view=>view.webContents===capturePage));
 await evaluate(`window.dispatchEvent(new CustomEvent('home:tool-frame',{detail:{open:true,browserAllowed:false}}))`);
 host.webContents.send('dragon-browser:reveal');await wait(80);
 assert.equal(await evaluate('dcBrowserPanel.hidden'),true,'native tool surfaces remain suspended');
 await evaluate('HomeToolFrame.close();DragonBrowserSidebar.close();void 0');
 await evaluate('DragonBrowserSidebar.open()');
 await until(()=>host.getBrowserViews().length===1);
 assert.equal(readingEvents.at(-1),true,'desktop browser enables native quota reading mode');
 const wc=host.getBrowserViews()[0].webContents;
 await wc.loadURL('about:blank');
 for(const theme of ['dark','light']){await evaluate(`document.documentElement.dataset.theme='${theme}'`);await until(()=>wc.executeJavaScript(`getComputedStyle(document.documentElement).backgroundColor===${JSON.stringify(theme==='dark'?'rgb(16, 17, 20)':'rgb(255, 255, 255)')}`));}

 await evaluate(`document.querySelector('.dc-browser-address input').value=${JSON.stringify(base+'/site')};document.querySelector('.dc-browser-address').requestSubmit()`);
 await until(()=>wc.getURL().endsWith('/site')&&!wc.isLoading());
 await wc.executeJavaScript('document.querySelector("#value").value="kept"');
 // Native dropdowns overlay the original page, without detaching or resizing its BrowserView.
 const nativeViewportBefore=await wc.executeJavaScript('JSON.stringify({width:innerWidth,height:innerHeight})');
 const nativeSurfaceBefore=await evaluate('JSON.stringify(document.querySelector(".dc-browser-surface").getBoundingClientRect().toJSON())');
 await evaluate('document.querySelector("[data-browser=more]").click()');await until(()=>nativeItem(/^(打印…|Print…)$/));
 assert.equal(await evaluate('document.querySelector(".dc-browser-popup").hidden'),true,'desktop uses native dropdowns above the real page');
 assert.equal(await evaluate('JSON.stringify(document.querySelector(".dc-browser-surface").getBoundingClientRect().toJSON())'),nativeSurfaceBefore);
 assert.equal(await wc.executeJavaScript('JSON.stringify({width:innerWidth,height:innerHeight})'),nativeViewportBefore);
 assert.equal(host.getBrowserViews().length,1);
 nativeItem(/^(放大|Zoom in)$/).click();await until(()=>wc.getZoomFactor()>1);
 nativeItem(/^(重置缩放|Reset zoom)/).click();await until(()=>wc.getZoomFactor()===1);
 nativeItem(/^(在页面中查找|Find in page)$/).click();await until(()=>evaluate('!document.querySelector(".dc-browser-find").hidden'));
 await evaluate('document.querySelector("[data-find-input]").value="next";document.querySelector("[data-find-input]").dispatchEvent(new Event("input"))');
 await until(()=>evaluate('document.querySelector("[data-find-count]").textContent.endsWith(" / 1")'));
 await evaluate('document.querySelector("[data-browser=find-close]").click()');await until(()=>evaluate('document.querySelector(".dc-browser-find").hidden'));
 wc.emit('before-input-event',{preventDefault(){}},{type:'keyDown',control:true,key:'f'});await until(()=>evaluate('!document.querySelector(".dc-browser-find").hidden'));assert.equal(host.getBrowserViews().length,1,'find shortcut keeps the page docked');await evaluate('document.querySelector("[data-browser=find-close]").click()');
 wc.downloadURL(base+'/download');await until(()=>fs.existsSync(path.join(temp,'downloads','dragon-toolbar-fixture.txt')));
 assert.equal(fs.readFileSync(path.join(temp,'downloads','dragon-toolbar-fixture.txt'),'utf8'),'sidebar download fixture');
 await evaluate('document.querySelector("[data-browser=downloads]").click()');await until(()=>nativeItem(/已完成|Completed/));
 await evaluate('document.querySelector("[data-browser=extensions]").click()');await until(()=>nativeItem(/本浏览器已加载的插件|Extensions in this browser/));
 // Mount the actual shared Windows caption controls, including max/fullscreen state changes.
 ipcMain.handle('desktop-window:get-state',()=>({platform:'win32',maximized:false,fullscreen:false,focused:true}));
 await evaluate('(()=>{const script=document.createElement("script");script.src="/js/shared/desktop-window.js";document.body.append(script)})()');
 await until(()=>evaluate('!!document.querySelector(".desktop-controls")&&document.documentElement.classList.contains("desktop-win")'));
 for(const maximized of [false,true]){
  host.webContents.send('desktop-window:state',{platform:'win32',maximized,fullscreen:false,focused:true});await wait(120);
  const geometry=await evaluate('(()=>{const caption=document.querySelector(".desktop-controls").getBoundingClientRect();return{bottom:caption.bottom,browserTop:Math.min(...[...document.querySelectorAll(".dc-browser-head button,.dc-browser-address button")].filter(b=>b.getClientRects().length).map(b=>b.getBoundingClientRect().top)),surfaceTop:document.querySelector(".dc-browser-surface").getBoundingClientRect().top}})()');
  assert.ok(geometry.browserTop>=geometry.bottom+6,JSON.stringify(geometry));
 }
 await wait(150);fs.writeFileSync(path.join(temp,'windows-browser-toolbar.png'),(await host.webContents.capturePage()).toPNG());
 host.webContents.send('desktop-window:state',{platform:'win32',maximized:false,fullscreen:true,focused:true});await wait(120);
 assert.equal(await evaluate('document.querySelector(".desktop-controls").getClientRects().length'),0);
 assert.equal(await evaluate('getComputedStyle(dcBrowserPanel).paddingTop'),'0px');
 host.webContents.send('desktop-window:state',{platform:'win32',maximized:false,fullscreen:false,focused:true});await wait(120);
 await evaluate('document.documentElement.dataset.theme="dark";document.querySelector("[data-browser=more]").click()');await wait(150);
 fs.writeFileSync(path.join(temp,'windows-browser-menu-dark.png'),(await host.webContents.capturePage()).toPNG());
 await evaluate('document.documentElement.dataset.theme="light"');

 console.log('Checked sidebar menus, download, find, zoom and Windows caption separation.');
 // 同一个原生 BrowserView 的文件控件与滑块，无需远程截图输入桥。
 console.log('Starting native slider and upload checks.');wc.debugger.attach('1.3');await wc.debugger.sendCommand('Page.enable');await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:true});
 host.setIgnoreMouseEvents(true);host.showInactive();await wait(120); // Render native controls without stealing focus or receiving physical mouse input.
 await wc.executeJavaScript('window.nativeMouse=[];for(const type of ["mousedown","mousemove","mouseup"])document.addEventListener(type,e=>nativeMouse.push({type:e.type,id:e.target.id,x:e.clientX,y:e.clientY}));');
 const slider=await wc.executeJavaScript('(()=>{const r=document.getElementById("native-range").getBoundingClientRect();return{x:r.left+8,y:r.top+r.height/2}})()');
 await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...slider});
 await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...slider,button:'left',buttons:1,clickCount:1});
 for(let i=1;i<=15;i++){await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:slider.x+250*i/15,y:slider.y,button:'left',buttons:1});await wait(16);}
 await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:slider.x+250,y:slider.y,button:'left',buttons:0,clickCount:1});
 await wait(100);assert.ok(Number(await wc.executeJavaScript('document.getElementById("native-range").value'))>75,await wc.executeJavaScript('JSON.stringify({value:document.getElementById("native-range").value,events:nativeMouse})'));host.hide();
 let chooser;const onChooser=(_event,method,params)=>{if(method==='Page.fileChooserOpened')chooser=params;};wc.debugger.on('message',onChooser);
 await wc.executeJavaScript('document.getElementById("native-file").click()',true);await until(()=>chooser);
 const localFile=path.join(temp,'native-upload.txt');fs.writeFileSync(localFile,'native browser file');
 await wc.debugger.sendCommand('DOM.setFileInputFiles',{backendNodeId:chooser.backendNodeId,files:[localFile]});
 assert.equal(await wc.executeJavaScript('document.getElementById("native-file").files[0].text()'),'native browser file');
 await wc.debugger.sendCommand('Page.setInterceptFileChooserDialog',{enabled:false});wc.debugger.off('message',onChooser);
 wc.debugger.detach();
 console.log('Checked native slider and file upload.');
 const oldId=wc.id;
 const bounds=host.getBrowserViews()[0].getBounds();
 const dom=await evaluate('(()=>{const r=document.querySelector(".dc-browser-surface").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
 assert.ok(Math.abs(bounds.x-dom.x)<2&&Math.abs(bounds.width-dom.width)<2,'native bounds follow sidebar');
 await evaluate('DragonBrowserSidebar.close()');await until(()=>host.getBrowserViews().length===0);
 assert.equal(readingEvents.at(-1),false,'desktop close restores native quota reading mode');
 await evaluate('DragonBrowserSidebar.open()');await until(()=>host.getBrowserViews().length===1);
 assert.equal(host.getBrowserViews()[0].webContents.id,oldId);
 assert.equal(await wc.executeJavaScript('document.querySelector("#value").value'),'kept','same page survives close/reopen');
 await evaluate('DragonClawWorkspace.showExternal({title:"Agent",open:true});void 0');await until(()=>host.getBrowserViews().length===0);
 // AI 使用的实际 openAgentPage 入口自动展示新标签，并保持可控制的 webContents。
 const agent=await stack.openAgentPage({url:base+'/second'});
 await until(()=>host.getBrowserViews()[0]?.webContents.id===agent.webContents.id);
 assert.equal(await evaluate('dcWorkspacePanel.hidden'),true);
 const handle=await evaluate('(()=>{const r=dcBrowserPanel.querySelector(".dc-sidebar-resize").getBoundingClientRect();return {x:Math.round(r.x+3),y:Math.round(r.y+100)}})()');
 host.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...handle});
 await until(()=>host.getBrowserViews().length===0);
 host.webContents.sendInputEvent({type:'mouseMove',modifiers:['leftButtonDown'],x:handle.x-80,y:handle.y});
 await wait(100);
 host.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:handle.x-80,y:handle.y});
 await until(()=>host.getBrowserViews().length===1);
 // 模态框显示时原生网页必须让出覆盖层。
 await evaluate('(()=>{const d=document.createElement("div");d.id="modal-fixture";d.setAttribute("aria-modal","true");document.body.append(d)})()');
 await until(()=>host.getBrowserViews().length===0);
 await evaluate('document.getElementById("modal-fixture").remove()');await until(()=>host.getBrowserViews().length===1);
 assert.equal(await evaluate('document.querySelector("[data-browser=popout]")'),null,'there is no separate Dragon window button');
 const pageCountBeforeExternal=BrowserWindow.getAllWindows().length;
 await evaluate('document.querySelector("[data-browser=external]").click()');await until(()=>externalOpens.includes(base+'/second'));
 assert.equal(BrowserWindow.getAllWindows().length,pageCountBeforeExternal,'external opening never creates a Dragon window');
 assert.ok(host.getBrowserViews().some(view=>view.webContents.id===agent.webContents.id),'original native page stays in the sidebar');
 await wait(500);fs.writeFileSync(path.join(temp,'sidebar.png'),(await host.webContents.capturePage()).toPNG());
 assert.equal(await agent.webContents.executeJavaScript('document.body.textContent'), 'second');
 await agent.webContents.loadURL(base+'/narrow');
 await until(()=>evaluate('dcBrowserPanel.getBoundingClientRect().width<=600'));
 const nativeNarrow=await evaluate('dcBrowserPanel.getBoundingClientRect().width');await wait(2700);
 assert.equal(await evaluate('dcBrowserPanel.getBoundingClientRect().width'),nativeNarrow,'native narrow content does not oscillate after resizing');
 // Login promotion sync creates sidebar tabs, no floating promotion cards or independent browser windows.
 const existingTabs=await evaluate('document.querySelectorAll(".dc-browser-tab").length'),windowsBefore=BrowserWindow.getAllWindows().length;
 const promotionConfig={desktopStack:true,maxLinks:2,rotateSeconds:60,links:[{id:'promo-one',name:'Promotion one',enabled:true,url:base+'/site'},{id:'promo-two',name:'Promotion two',enabled:true,url:base+'/second'}]};
 stack.sync(promotionConfig);await until(()=>evaluate(`document.querySelectorAll(".dc-browser-tab").length===${existingTabs+2}`));
 assert.equal(BrowserWindow.getAllWindows().length,windowsBefore,'promotions create no floating card windows');assert.equal(stack.status().items.length,2);
 stack.sync(promotionConfig);await wait(200);assert.equal(await evaluate('document.querySelectorAll(".dc-browser-tab").length'),existingTabs+2,'repeated login/settings sync does not duplicate tabs');
 stack.setPaused(true);await until(()=>evaluate(`document.querySelectorAll(".dc-browser-tab").length===${existingTabs}`));assert.equal(agent.webContents.isDestroyed(),false,'pausing promotion leaves user and AI pages intact');
 // Old renderer popout requests also open the default browser without detaching a page.
 const beforeLegacy=externalOpens.length;stack.popoutBrowser();await until(()=>externalOpens.length===beforeLegacy+1);assert.equal(host.getBrowserViews().length,1);
 const routed=await stack.openAgentPage({url:base+'/site',name:'Automatic browser entry'});await until(()=>host.getBrowserViews().some(view=>view.webContents===routed.webContents));
 const independent=BrowserWindow.getAllWindows().filter(window=>window!==host&&window.isVisible()&&window.getBrowserViews().length);assert.equal(independent.length,0,'no automatic standalone Dragon window');
 stack.open({name:'Clicked promotion',url:base+'/second'});await until(()=>host.getBrowserViews()[0]?.webContents.getURL().endsWith('/second'));
 shell.openExternal=originalExternal;Menu.buildFromTemplate=originalBuild;stack.destroy();host.destroy();server.close();clearTimeout(timeout);await wait(500);console.log('PASS: unified browser, manual input, tabs, handback, workspace resize, panel switching, mobile, desktop docking, preserved page state, AI opens, drag, modal occlusion and external browser opening. '+temp);app.exit(0);
}).catch(e=>{console.error(e);stack?.destroy();host?.destroy();server?.close();app.exit(1)});
