// 原生 AI 输入遮罩独立于网页 DOM；临时用户目录、本地页面，不访问业务数据。
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'browser-operator-native-'));app.setPath('userData',path.join(temp,'profile'));process.env.TOOLS_DATA_DIR=path.join(temp,'data');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));const until=async fn=>{for(let i=0;i<180;i++){if(await fn())return;await wait(40);}throw Error('Timeout '+fn);};
let stack,host,server;const timeout=setTimeout(()=>app.exit(1),45000);
app.whenReady().then(async()=>{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<title>Native operator</title><button id="click" onclick="window.count=(window.count||0)+1">Click target</button><input id="entry">');});server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const extensions=path.join(temp,'extensions.json');fs.writeFileSync(extensions,JSON.stringify({imported:[],disabled:['auto:icpm','bundled:chrome-capture-pro','bundled:overseas-salary-calculator']}));
 stack=require('../desktop-promo/promo-stack').createPromoStack({statePath:path.join(temp,'stack.json'),extensionsStatePath:extensions});
 host=new BrowserWindow({show:false,width:1000,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true}});await host.loadURL('about:blank');stack.setBrowserSidebar(host);stack.setBrowserSidebarBounds({x:300,y:100,width:700,height:750});
 const browser=require('../backend/models/agent-browser');browser.configureDesktopBrowser({openPage:options=>stack.openAgentPage(options)});const owner='default::native-operator';
 assert.equal((await browser.execute({owner},'browser_navigate',{url:base})).isError,undefined);
 const state=browser._internal.owners.get(owner),page=state.tabs.get(state.active),wc=host.getBrowserViews()[0].webContents;
 const running=browser.execute({owner},'browser_wait',{timeoutMs:30000});await until(()=>host.getBrowserViews().length===2);
 const overlay=host.getBrowserViews().find(view=>view.webContents!==wc);await until(()=>overlay.webContents.getURL().endsWith('operator-overlay.html')&&!overlay.webContents.isLoading());
 await until(()=>overlay.webContents.executeJavaScript('document.querySelector(".browser-ai-presence").classList.contains("is-active")'));
 assert.equal(await overlay.webContents.executeJavaScript('document.querySelector("button").getAttribute("aria-label")'),'停止并接管');
 assert.equal(await overlay.webContents.executeJavaScript('getComputedStyle(document.querySelector(".browser-ai-orb")).width'),'48px','the shared animation stylesheet loads in the native overlay');
 host.show();app.focus({steal:true});host.focus();overlay.webContents.focus();await wait(120);
 const button=await overlay.webContents.executeJavaScript('(()=>{const r=document.querySelector("button").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
 overlay.webContents.sendInputEvent({type:'mouseDown',x:Math.round(button.x),y:Math.round(button.y),button:'left',clickCount:1});overlay.webContents.sendInputEvent({type:'mouseUp',x:Math.round(button.x),y:Math.round(button.y),button:'left',clickCount:1});
 await until(()=>state.manual?.autoIdleMs===5000&&host.getBrowserViews().length===1);
 assert.match((await running).content,/BROWSER_INTERRUPTED/);assert.equal(await wc.executeJavaScript('window.count||0'),0,'overlay action never clicks underlying webpage');
 // 用户自己的鼠标输入进入同一个真实页面，并延长空闲截止时间。
 wc.focus();const before=state.manual.touched;
 wc.sendInputEvent({type:'mouseMove',x:120,y:180});await until(()=>state.manual.touched>before);
 assert.equal(page.networkList().length,0,'manual input is not recorded for AI');
 host.hide();await wait(5400);assert.equal(state.manual,null,'native five-second lease expires without heartbeat');
 const snap=await browser.execute({owner},'browser_snapshot');const ref=snap.content.match(/\[(e\d+)\] button "Click target"/)[1];
 const click=browser.execute({owner},'browser_click',{ref});await until(()=>host.getBrowserViews().length===2);
 await click;assert.equal(await wc.executeJavaScript('window.count'),1,'AI CDP bypasses the user-input shield and clicks once');
 assert.equal(host.getBrowserViews().length,2,'the native overlay remains attached during the exit transition');
 await until(()=>overlay.webContents.executeJavaScript('document.querySelector("button").hidden&&!document.querySelector(".browser-ai-presence").classList.contains("is-active")'));
 await until(()=>host.getBrowserViews().length===1);
 browser.shutdownAll();stack.destroy();host.destroy();server.close();clearTimeout(timeout);console.log('PASS: native input shield, forced stop, real mouse activity, five-second handback and AI cursor/click.');app.exit(0);
}).catch(error=>{console.error(error);stack?.destroy();host?.destroy();server?.close();app.exit(1);});
