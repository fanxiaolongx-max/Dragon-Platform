// Native-window integration with synthetic cached quotas and a disposable profile.
const {app,BrowserWindow,ipcMain,Menu,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{EventEmitter}=require('node:events'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'quota-tray-native-'));
app.setPath('userData',path.join(temp,'profile'));
fs.mkdirSync(path.join(temp,'profile'),{recursive:true});
fs.writeFileSync(path.join(temp,'profile','desktop-pet-config.json'),JSON.stringify({scaleVersion:2,enabled:false,quotaStandalone:true,quotaPanelOn:true}));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label){for(let n=0;n<150;n++){if(await predicate())return;await wait(25);}throw Error(label);}
let manager;
setTimeout(()=>app.exit(1),20000).unref();
app.whenReady().then(async()=>{
    const file=path.join(__dirname,'../desktop-pet/pet-manager.js'),realRequire=createRequire(file),mod={exports:{}};
    const quotas={};
    for(const [provider,id,a,b] of [['codex','codex',82,61],['claudecode','claudecode',17,45],['antigravity','gemini',94,73]])quotas[provider]={status:'cached',groups:[{id,windows:[{id:'5h',remainingPercent:a},{id:'weekly',remainingPercent:b}]}]};
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{
        module:mod,exports:mod.exports,__dirname:path.dirname(file),process,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,
        require(name){
            if(name==='electron')return {app,BrowserWindow,ipcMain,Menu,screen};
            if(name.endsWith('desktop-language'))return {events:new EventEmitter(),getLanguage:()=> 'zh-CN'};
            if(name.endsWith('quota-detector'))return {detectAllQuotas:async()=>quotas};
            if(name.endsWith('pet-keyboard-hook'))return {startKeyboardHook(){},stopKeyboardHook(){}};
            return realRequire(name);
        }
    });
    manager=mod.exports;manager.initDesktopPet();
    await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('quota-panel.html')),'rail window');
    const rail=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('quota-panel.html'));
    await until(()=>rail.isVisible(),'rail ready');
    await until(async()=>await rail.webContents.executeJavaScript('document.querySelector(".quota-value").textContent.includes("82")'),'cached quotas rendered');
    const full=rail.getBounds(),display=screen.getDisplayMatching(full);
    assert.equal(full.height,64);assert.equal(full.y,process.platform==='darwin'?display.workArea.y:display.bounds.y);
    // Force the leave event instead of depending on the user's physical pointer.
    await rail.webContents.executeJavaScript('document.body.dispatchEvent(new PointerEvent("pointerleave"));void 0');
    await until(()=>rail.getBounds().height===6,'native collapse');
    assert.equal(rail.getBounds().y,full.y);
    await rail.webContents.executeJavaScript('document.getElementById("edgeSensor").dispatchEvent(new PointerEvent("pointerenter"));void 0');
    await until(()=>rail.getBounds().height===64,'native reveal');
    assert.deepEqual(rail.getBounds(),full);
    await rail.webContents.executeJavaScript('document.querySelector(".codex").dispatchEvent(new PointerEvent("pointerenter"));void 0');
    await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('peek=1')&&w.isVisible()),'native hover peek');
    const peek=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('peek=1'));
    assert.equal(peek.isFocused(),false);assert.deepEqual(rail.getBounds(),full);
    await peek.webContents.executeJavaScript('document.getElementById("quotaPeek").dispatchEvent(new PointerEvent("pointerenter"));void 0');
    await wait(1800);assert.deepEqual(rail.getBounds(),full,'hovering the peek keeps the rail expanded');
    await peek.webContents.executeJavaScript('document.getElementById("quotaPeek").dispatchEvent(new PointerEvent("pointerleave"));void 0');
    await until(()=>!peek.isVisible(),'peek closes after pointer departure');
    manager.setQuotaPanelEnabled(false);assert.equal(rail.isVisible(),false);
    assert.equal(peek.isVisible(),false);
    console.log('PASS: real Electron windows touch the system boundary; native auto-hide/reveal restores bounds; nonactivating hover peek keeps the rail stable and closes cleanly.');
    manager.cleanupDesktopPet();app.exit(0);
}).catch(error=>{console.error(error);manager?.cleanupDesktopPet();app.exit(1);});
