// Isolated real Electron renderer: no account probes, login or business data.
const {app,BrowserWindow,ipcMain,nativeTheme}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'quota-sidebar-preview-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,peek;const messages=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=expression=>win.webContents.executeJavaScript(expression,true);
async function until(expression){for(let n=0;n<100;n++){if(await evaluate(expression))return;await wait(30);}throw Error(expression);}
setTimeout(()=>app.exit(1),30000).unref();
app.whenReady().then(async()=>{
    ipcMain.handle('pet-get-language',()=> 'zh-CN');
    for(const name of ['pet-quota-panel-ready','pet-quota-panel-hide','pet-quota-panel-menu','pet-quota-panel-dock','pet-quota-panel-drag','pet-open-quota-trends','pet-quota-panel-peek','pet-quota-panel-collapse','pet-quota-peek-ready','pet-quota-peek-hold'])ipcMain.on(name,(_event,data)=>messages.push({name,data}));
    nativeTheme.themeSource='dark';
    const options={show:true,focusable:false,frame:false,transparent:true,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}};
    win=new BrowserWindow({...options,width:360,height:64});
    await win.loadFile(path.join(__dirname,'../desktop-pet/quota-panel.html'));
    win.webContents.send('pet-quota-panel-config',{mode:'top',autoHide:false,expanded:false,orientation:'horizontal'});
    await until('document.querySelectorAll(".quota-cell").length===6');
    const provider=(id,a,b,label,tier)=>({status:'live',updatedAt:Date.now(),membership:{label,tier,premium:true},groups:[{id,windows:[{id:'5h',remainingPercent:a,resetsAt:Date.now()+7200000},{id:'weekly',remainingPercent:b,resetsAt:Date.now()+172800000}]}]});
    const quotas={codex:provider('codex',82,61,'Plus','plus'),claudecode:provider('claudecode',17,45,'Max','max'),antigravity:provider('gemini',94,73,'Ultra','ultra')};
    win.webContents.send('pet-quota-update',quotas);
    await until('document.querySelector(".quota-value").textContent.includes("82")');
    assert.equal(await evaluate('Array.from(document.images).filter(e=>e.classList.contains("provider-icon")).every(e=>e.complete&&e.naturalWidth>0)'),true,'all provider artwork loaded');
    await evaluate('window.originalCell=document.querySelector(".quota-cell");void 0');
    win.webContents.send('pet-quota-update',quotas);await wait(30);
    assert.equal(await evaluate('window.originalCell===document.querySelector(".quota-cell")'),true,'refresh preserves interactive nodes');
    async function checkLayout(width,height,config,file) {
        win.setContentSize(width,height);
        win.webContents.send('pet-quota-panel-config',{autoHide:false,expanded:false,collapsed:false,...config});await wait(300);
        assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight'),true,file+' viewport');
        const overflow=await evaluate('Array.from(document.querySelectorAll(".quota-row,.quota-cell,.provider-name")).filter(e=>e.getClientRects().length&&(e.scrollHeight>e.clientHeight||e.scrollWidth>e.clientWidth)).map(e=>({class:e.className,text:e.textContent,width:e.clientWidth,scroll:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}))');assert.deepEqual(overflow,[],file+' cells '+JSON.stringify(overflow));
        assert.equal(await evaluate('Array.from(document.querySelectorAll(".quota-cell,#panelMenu,#panelHide")).filter(e=>e.getClientRects().length).every(e=>{const b=e.getBoundingClientRect();return b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight})'),true,file+' controls');
        const rect=await evaluate('(()=>{const b=document.querySelector(".quota-panel").getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom}})()');
        assert.deepEqual(rect,{x:0,y:0,right:width,bottom:height},file+' zero surface inset');
        fs.writeFileSync(path.join(temp,file+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    await checkLayout(360,64,{mode:'top',orientation:'horizontal'},'compact-top-zh');
    await evaluate('document.querySelector(".quota-cell").click();document.getElementById("panelMenu").click();document.getElementById("panelHide").click()');
    await wait(30);assert.deepEqual(messages.find(m=>m.name==='pet-open-quota-trends').data,{provider:'codex',groupId:'codex',windowId:'5h'});
    assert.ok(messages.some(m=>m.name==='pet-quota-panel-menu'));assert.ok(messages.some(m=>m.name==='pet-quota-panel-hide'));
    await win.webContents.debugger.attach('1.3');
    for(const params of [{type:'mousePressed',x:13,y:27,button:'left',clickCount:1},{type:'mouseMoved',x:18,y:30,button:'left',buttons:1},{type:'mouseReleased',x:18,y:30,button:'left',clickCount:1}])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',params);
    await wait(60);assert.ok(messages.some(m=>m.name==='pet-quota-panel-drag'&&m.data==='start'));assert.ok(messages.some(m=>m.name==='pet-quota-panel-drag'&&m.data==='end'));
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:70,y:30});await wait(140);
    assert.ok(messages.some(m=>m.name==='pet-quota-panel-peek'&&m.data==='codex'),'hover requests provider peek');
    await win.webContents.debugger.detach();
    await evaluate('PetI18n.setLanguage("en-US")');await until('document.getElementById("panelHide").getAttribute("aria-label")==="Hide quota tray"');
    await checkLayout(360,64,{mode:'bottom',orientation:'horizontal'},'compact-bottom-en');
    await checkLayout(68,248,{mode:'right',orientation:'vertical'},'compact-right-en');
    await evaluate('PetI18n.setLanguage("zh-CN")');
    await checkLayout(68,248,{mode:'left',orientation:'vertical'},'compact-left-zh');
    await checkLayout(286,426,{mode:'free',expanded:true,orientation:'vertical'},'detail-zh');
    await checkLayout(240,64,{mode:'top',orientation:'horizontal'},'compact-narrow');
    nativeTheme.themeSource='light';
    await checkLayout(360,64,{mode:'top',orientation:'horizontal'},'compact-light');
    // Auto-hide completion -> a six-pixel native hit area -> edge reveal IPC.
    await evaluate('document.body.dispatchEvent(new PointerEvent("pointerleave"))');
    win.webContents.send('pet-quota-panel-config',{autoHide:true,mode:'top',expanded:false,collapsed:false});
    await wait(1800);assert.ok(messages.some(m=>m.name==='pet-quota-panel-collapse'&&m.data===true));
    win.setContentSize(360,6);win.webContents.send('pet-quota-panel-config',{collapsed:true});await wait(50);
    assert.equal(await evaluate('document.body.classList.contains("collapsed")'),true);
    assert.equal(await evaluate('document.getElementById("edgeSensor").getBoundingClientRect().height'),6);
    fs.writeFileSync(path.join(temp,'collapsed-top.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate('document.getElementById("edgeSensor").dispatchEvent(new PointerEvent("pointerenter"))');await wait(30);
    assert.ok(messages.some(m=>m.name==='pet-quota-panel-collapse'&&m.data===false));
    await checkLayout(360,64,{mode:'top',orientation:'horizontal'},'restored-top');
    win.webContents.send('pet-quota-update',{codex:{status:'cached',groups:[{id:'codex',windows:[{id:'5h',remainingPercent:60}]}]},claudecode:{status:'signed_out'},antigravity:{status:'offline'}});
    await until('document.querySelector(".quota-row.cached")&&document.querySelectorAll(".quota-cell.unknown").length===5');
    assert.match(await evaluate('document.querySelector(".claudecode").getAttribute("aria-label")'),/未登录/);
    // The same renderer has a dedicated single-provider peek mode.
    peek=new BrowserWindow({...options,width:312,height:234});
    await peek.loadFile(path.join(__dirname,'../desktop-pet/quota-panel.html'),{query:{peek:'1'}});
    for(const side of ['top','right','bottom','left']) {
        peek.webContents.send('pet-quota-peek-config',{provider:'codex',group:'gemini',side,pointer:100});
        peek.webContents.send('pet-quota-update',quotas);peek.webContents.send('pet-quota-peek-visible',true);await wait(300);
        assert.equal(await peek.webContents.executeJavaScript('document.querySelectorAll("#peekQuotas .quota-cell").length'),2);
        assert.match(await peek.webContents.executeJavaScript('document.getElementById("peekPlan").textContent'),/Plus/);
        assert.equal(await peek.webContents.executeJavaScript('Array.from(document.querySelectorAll("#peekQuotas .quota-cell,.peek-footer,.peek-top,.peek-status")).every(e=>e.scrollWidth<=e.clientWidth&&e.scrollHeight<=e.clientHeight)'),true,'peek '+side+' no clipping');
        fs.writeFileSync(path.join(temp,'peek-light-'+side+'.png'),(await peek.webContents.capturePage()).toPNG());
    }
    nativeTheme.themeSource='dark';await wait(100);
    fs.writeFileSync(path.join(temp,'peek-dark.png'),(await peek.webContents.capturePage()).toPNG());
    await peek.webContents.executeJavaScript('PetI18n.setLanguage("en-US");document.querySelector("#peekQuotas .quota-cell").click()');await wait(40);
    assert.match(await peek.webContents.executeJavaScript('document.getElementById("peekHint").textContent'),/history/);
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".quota-panel")).transitionDuration'),'0s');
    await win.webContents.debugger.detach();
    console.log('PASS: all edges, zero inset, native six-pixel collapse/reveal, hover peeks, persistent DOM, dragging, history, Chinese/English, light/dark, small screen and reduced motion. Preview: '+temp);
    peek.destroy();win.destroy();app.exit(0);
}).catch(error=>{console.error(error);peek?.destroy();win?.destroy();app.exit(1);});
