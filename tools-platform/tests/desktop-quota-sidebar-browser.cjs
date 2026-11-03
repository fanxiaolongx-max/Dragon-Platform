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
    for(const name of ['pet-quota-panel-ready','pet-quota-panel-hide','pet-quota-panel-menu','pet-quota-panel-dock','pet-quota-panel-drag','pet-open-quota-trends','pet-quota-panel-peek','pet-quota-panel-collapse','pet-quota-peek-ready','pet-quota-peek-hold','pet-quota-panel-hit'])ipcMain.on(name,(_event,data)=>messages.push({name,data}));
    nativeTheme.themeSource='dark';
    const options={show:true,focusable:false,frame:false,transparent:true,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}};
    win=new BrowserWindow({...options,width:404,height:40});
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
        // The surface hangs from the top edge; 12px shoulders + 10px halo on each side, 10px halo below.
        assert.deepEqual(rect,{x:22,y:0,right:width-22,bottom:height-10},file+' notch surface');
        assert.match(await evaluate('getComputedStyle(document.querySelector(".quota-panel"),"::before").width+getComputedStyle(document.querySelector(".quota-panel")).borderTopLeftRadius+"/"+getComputedStyle(document.querySelector(".quota-panel")).borderBottomLeftRadius'),config.expanded?/^12px0px\/20px$/:/^12px0px\/14px$/,file+' notch shape');
        fs.writeFileSync(path.join(temp,file+'.png'),(await win.webContents.capturePage()).toPNG());
    }
    await checkLayout(404,40,{mode:'top',orientation:'horizontal'},'compact-top-zh');
    await evaluate('document.querySelector(".quota-cell").click();document.getElementById("panelMenu").click();document.getElementById("panelHide").click()');
    await wait(30);assert.deepEqual(messages.find(m=>m.name==='pet-open-quota-trends').data,{provider:'codex',groupId:'codex',windowId:'5h'});
    assert.ok(messages.some(m=>m.name==='pet-quota-panel-menu'));assert.ok(messages.some(m=>m.name==='pet-quota-panel-hide'));
    await win.webContents.debugger.attach('1.3');
    for(const params of [{type:'mousePressed',x:30,y:15,button:'left',clickCount:1},{type:'mouseMoved',x:36,y:15,button:'left',buttons:1},{type:'mouseReleased',x:36,y:15,button:'left',clickCount:1}])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',params);
    await wait(60);assert.ok(messages.some(m=>m.name==='pet-quota-panel-drag'&&m.data==='start'));assert.ok(messages.some(m=>m.name==='pet-quota-panel-drag'&&m.data==='end'));
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:92,y:15});await wait(140);
    assert.ok(messages.some(m=>m.name==='pet-quota-panel-peek'&&m.data==='codex'),'hover requests provider peek');
    await win.webContents.debugger.detach();
    await evaluate('PetI18n.setLanguage("en-US")');await until('document.getElementById("panelHide").getAttribute("aria-label")==="Hide quota tray"');
    await checkLayout(404,40,{mode:'top',orientation:'horizontal'},'compact-top-en');
    await evaluate('PetI18n.setLanguage("zh-CN")');
    await checkLayout(330,436,{mode:'top',expanded:true,orientation:'horizontal'},'detail-zh');
    await checkLayout(284,40,{mode:'top',orientation:'horizontal'},'compact-narrow');
    nativeTheme.themeSource='light';
    await checkLayout(404,40,{mode:'top',orientation:'horizontal'},'compact-light');
    // Breathing halo around the sides and bottom, animated, behind the notch.
    const glow=await evaluate('(()=>{const g=document.getElementById("notchGlow"),s=getComputedStyle(g),r=g.getBoundingClientRect(),p=document.querySelector(".quota-panel").getBoundingClientRect();return {anim:s.animationName,blur:s.filter,left:r.left<p.left,right:r.right>p.right,below:r.bottom>p.bottom,top:r.top,z:+s.zIndex}})()');
    assert.match(glow.anim,/notch-flow/);assert.match(glow.anim,/notch-breathe/);assert.match(glow.blur,/blur/);
    assert.ok(glow.left&&glow.right&&glow.below&&glow.top===0&&glow.z===0,'halo wraps the sides and bottom '+JSON.stringify(glow));
    // The appearance setting overrides the system: forced dark on a light system, forced light on a dark one, then auto follows.
    const surface=()=>evaluate('getComputedStyle(document.documentElement).getPropertyValue("--surface").trim()');
    win.webContents.send('pet-quota-panel-config',{theme:'dark'});await wait(80);
    assert.equal(await surface(),'#101113');
    fs.writeFileSync(path.join(temp,'compact-forced-dark.png'),(await win.webContents.capturePage()).toPNG());
    win.webContents.send('pet-quota-panel-config',{theme:'auto'});await wait(80);
    assert.equal(await surface(),'#f5f5f6','auto follows the light system');
    nativeTheme.themeSource='dark';await wait(80);
    assert.equal(await surface(),'#101113','auto follows the dark system');
    win.webContents.send('pet-quota-panel-config',{theme:'light'});await wait(80);
    assert.equal(await surface(),'#f5f5f6','forced light on a dark system');
    win.webContents.send('pet-quota-panel-config',{theme:'auto'});nativeTheme.themeSource='light';await wait(80);
    // Pointer over the halo margin keeps the window click-through; over the notch it captures.
    messages.length=0;
    await win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:200,y:35});await wait(40);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:200,y:15});await wait(40);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:15});await wait(40);
    await win.webContents.debugger.detach();
    assert.deepEqual(messages.filter(m=>m.name==='pet-quota-panel-hit').map(m=>m.data),[false,true,false],'halo below: release; notch: capture; halo at the side: release');
    // Auto-hide completion -> a six-pixel native hit area -> edge reveal IPC.
    await evaluate('document.querySelector(".quota-panel").dispatchEvent(new PointerEvent("pointerleave"))');
    win.webContents.send('pet-quota-panel-config',{autoHide:true,mode:'top',expanded:false,collapsed:false});
    await wait(1800);assert.ok(messages.some(m=>m.name==='pet-quota-panel-collapse'&&m.data===true));
    win.setContentSize(404,6);win.webContents.send('pet-quota-panel-config',{collapsed:true});await wait(50);
    assert.equal(await evaluate('document.body.classList.contains("collapsed")'),true);
    assert.equal(await evaluate('document.getElementById("edgeSensor").getBoundingClientRect().height'),6);
    fs.writeFileSync(path.join(temp,'collapsed-top.png'),(await win.webContents.capturePage()).toPNG());
    await evaluate('document.getElementById("edgeSensor").dispatchEvent(new PointerEvent("pointerenter"))');await wait(30);
    assert.ok(messages.some(m=>m.name==='pet-quota-panel-collapse'&&m.data===false));
    await checkLayout(404,40,{mode:'top',orientation:'horizontal'},'restored-top');
    win.webContents.send('pet-quota-update',{codex:{status:'cached',groups:[{id:'codex',windows:[{id:'5h',remainingPercent:60}]}]},claudecode:{status:'signed_out'},antigravity:{status:'offline'}});
    await until('document.querySelector(".quota-row.cached")&&document.querySelectorAll(".quota-cell.unknown").length===5');
    assert.match(await evaluate('document.querySelector(".claudecode").getAttribute("aria-label")'),/未登录/);
    // The same renderer has a dedicated single-provider peek mode.
    peek=new BrowserWindow({...options,width:312,height:234});
    await peek.loadFile(path.join(__dirname,'../desktop-pet/quota-panel.html'),{query:{peek:'1'}});
    for(const side of ['top']) {
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
    console.log('PASS: top notch shape, menu-bar height with weekly hairline bars, breathing halo with click-through margin, system/light/dark appearance, native six-pixel collapse/reveal, hover peeks, persistent DOM, dragging, history, Chinese/English, light/dark, small screen and reduced motion. Preview: '+temp);
    peek.destroy();win.destroy();app.exit(0);
}).catch(error=>{console.error(error);peek?.destroy();win?.destroy();app.exit(1);});
