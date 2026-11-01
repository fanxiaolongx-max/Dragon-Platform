// node_modules/.bin/electron tests/desktop-pet-taotao-browser.cjs
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {PNG}=require('pngjs');
const { createVisitor } = require('../desktop-pet/taotao-visit');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'taotao-egg-'));
const output = process.env.TAOTAO_PREVIEW_DIR || temporary;
fs.mkdirSync(output, {recursive:true});
app.setPath('userData', path.join(temporary,'profile')); app.disableHardwareAcceleration();
let dragon, visitorWindow, visitor, now=0, tick;
const errors=[];
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const evaluate = (win, code) => win.webContents.executeJavaScript(code,true);
async function until(fn) { for(let i=0;i<150;i++){if(await fn())return;await wait(30);}throw Error('Timed out'); }
async function capture(name) { fs.writeFileSync(path.join(output,name+'.png'),(await visitorWindow.webContents.capturePage()).toPNG()); }
setTimeout(()=>app.exit(1),45000).unref();
app.whenReady().then(async()=>{
  const area=screen.getPrimaryDisplay().workArea;
  const bounds=screen.getPrimaryDisplay().bounds;
  dragon=new BrowserWindow({x:area.x+area.width-280,y:area.y+area.height-340,width:240,height:320,
    show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
  function TrackedWindow(options){visitorWindow=new BrowserWindow(options);visitorWindow.webContents.on('console-message',(_e,level,message)=>{if(level>=2&&!message.includes('Electron Security Warning'))errors.push(message);});return visitorWindow;}
  // Reserve space on the right like a side Dock; departure must still reach
  // the physical display boundary rather than stopping at that work-area edge.
  const visitorScreen={getDisplayMatching(rect){const d=screen.getDisplayMatching(rect);return{...d,workArea:{...d.workArea,width:d.workArea.width-80}};},getPrimaryDisplay:()=>screen.getPrimaryDisplay()};
  visitor=createVisitor({BrowserWindow:TrackedWindow,screen:visitorScreen,getPet:()=>dragon,getLanguage:()=> 'zh-CN',
    now:()=>now,schedule(fn){tick=fn;return 1;},cancel(){tick=null;}});
  let requests=0, ordinary=0;
  ipcMain.on('pet-toggle-chat',()=>ordinary++);
  ipcMain.handle('pet-get-language',()=> 'zh-CN');
  ipcMain.handle('pet-get-stories',()=> []);
  ipcMain.on('pet-taotao-surprise',(event,rect)=>{
    assert.equal(event.sender,dragon.webContents);requests++;visitor.start(rect);
  });
  ipcMain.on('pet-taotao-ready',event=>visitor.ready(event.sender));
  ipcMain.on('pet-taotao-failed',()=>{throw Error('Visitor assets failed');});
  await dragon.loadFile(path.join(__dirname,'../desktop-pet/pet.html'));
  dragon.showInactive();
  await until(()=>evaluate(dragon,`document.querySelector('.gpet-img').src.startsWith('data:image/png')`));
  await evaluate(dragon,`localStorage.setItem('gemini-pet-config',JSON.stringify({soundVol:0,typingOn:false,gravityOn:false,randomMotionOn:false,proactiveStoriesOn:false}));`);
  await new Promise(resolve=>{dragon.webContents.once('did-finish-load',resolve);dragon.reload();});
  await until(()=>evaluate(dragon,`!!window.GeminiPetInstance && document.querySelector('.gpet-img').src.startsWith('data:image/png')`));
  const clicks=count=>evaluate(dragon,`(function(){for(var i=0;i<${count};i++){
    var r=document.querySelector('.gpet-img').getBoundingClientRect();
    var p={bubbles:true,pointerId:1,pointerType:'mouse',button:0,clientX:r.left+r.width*.5,clientY:r.top+r.height*.6,screenX:1000+r.left+r.width*.5,screenY:1000+r.top+r.height*.6};
    document.dispatchEvent(new PointerEvent('pointerdown',p));document.dispatchEvent(new PointerEvent('pointerup',p));
  }})()`);
  await clicks(10);await wait(50);assert.equal(requests,0,'ten clicks are ordinary interactions');assert.equal(ordinary,10);
  // A cancelled pointer clears a nearly completed sequence.
  await evaluate(dragon,`(function(){var r=document.querySelector('.gpet-img').getBoundingClientRect();var p={bubbles:true,pointerId:1,pointerType:'mouse',button:0,clientX:r.left+r.width*.5,clientY:r.top+r.height*.6};document.dispatchEvent(new PointerEvent('pointerdown',p));document.dispatchEvent(new PointerEvent('pointercancel',p));})()`);
  await clicks(10);await wait(50);assert.equal(requests,0,'cancelled gestures reset the streak');
  await clicks(1);await until(()=>requests===1 && visitorWindow?.isVisible());
  assert.equal(visitorWindow.isFocusable(),false);assert.notEqual(BrowserWindow.getFocusedWindow(),visitorWindow);
  await visitorWindow.webContents.debugger.attach('1.3');
  await visitorWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
  await wait(500);await capture('taotao-hello-zh');
  assert.match(await evaluate(visitorWindow,`document.querySelector('.speech').textContent`),/Dragon.*屏幕/);
  await clicks(30);await wait(50);assert.equal(requests,1,'fast clicks during a visit cannot spam visitors');
  now=9999;tick();assert.equal(await evaluate(visitorWindow,`document.querySelector('.visitor').dataset.phase`),'greeting');
  now=10000;tick();await until(()=>evaluate(visitorWindow,`document.querySelector('.visitor').dataset.phase==='leaving'`));
  const runningFrame=await evaluate(visitorWindow,`document.querySelector('.sprite').src`);
  await until(async()=>await evaluate(visitorWindow,`document.querySelector('.sprite').src`)!==runningFrame);
  const start=visitorWindow.getBounds();now=11050;tick();await wait(40);
  assert.notEqual(visitorWindow.getBounds().x,start.x);
  assert.equal(visitorWindow.getBounds().x+visitorWindow.getBounds().width,bounds.x+bounds.width,'native window touches physical right edge before sprite exits');
  assert.equal(await evaluate(visitorWindow,`getComputedStyle(document.querySelector('.visitor')).getPropertyValue('--exit')`),'0');
  await capture('taotao-at-right-edge');
  now=11499;tick();await wait(60);await capture('taotao-fully-out');
  const blank=PNG.sync.read((await visitorWindow.webContents.capturePage()).toPNG());
  assert.equal(blank.data.some((v,i)=>i%4===3&&v>8),false,'no artwork disappears early or remains visible before the peek');
  now=11800;tick();await until(()=>evaluate(visitorWindow,`document.querySelector('.visitor').dataset.phase==='peek'`));
  const initialPeek=await evaluate(visitorWindow,`({x:document.querySelector('.peek-sprite').getBoundingClientRect().left,y:document.querySelector('.peek-sprite').getBoundingClientRect().top})`);
  await wait(200);await capture('taotao-peek-entering');
  await wait(450);await capture('taotao-byebye');
  assert.equal(await evaluate(visitorWindow,`document.querySelector('.speech').textContent`),'byebye 👋');
  assert.equal(await evaluate(visitorWindow,`getComputedStyle(document.querySelector('.portrait')).display`),'none','farewell never crops a standing bear from below');
  const settledPeek=await evaluate(visitorWindow,`({x:document.querySelector('.peek-sprite').getBoundingClientRect().left,y:document.querySelector('.peek-sprite').getBoundingClientRect().top,right:document.querySelector('.peek-sprite').getBoundingClientRect().right})`);
  assert.ok(initialPeek.x-settledPeek.x>120,'head enters horizontally from outside right edge');
  assert.ok(Math.abs(initialPeek.y-settledPeek.y)<35,'head does not rise from the bottom');
  assert.ok(settledPeek.right>visitorWindow.getBounds().width,'screen edge occludes neck and paw');
  assert.equal(visitorWindow.getBounds().x+visitorWindow.getBounds().width,bounds.x+bounds.width,'farewell stays at physical monitor edge, beyond the reserved Dock area');
  now=14300;tick();await wait(520);await capture('taotao-peek-retracted');
  assert.ok(await evaluate(visitorWindow,`document.querySelector('.peek-sprite').getBoundingClientRect().left>=innerWidth`),'head retreats horizontally behind the same screen edge');
  await visitorWindow.webContents.debugger.detach();
  now=14800;tick();assert.equal(visitorWindow.isDestroyed(),true);assert.equal(tick,null);
  // Fresh visit checks English, dark styling and reduced motion without waiting in real time.
  now=31000;assert.equal(visitor.start(),true);await until(()=>visitorWindow.isVisible());
  visitorWindow.webContents.send('pet-language-change','en-US');
  await visitorWindow.webContents.debugger.attach('1.3');
  await visitorWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[
    {name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait(100);await capture('taotao-hello-en-dark');
  assert.match(await evaluate(visitorWindow,`document.querySelector('.speech').textContent`),/other side of the screen/);
  assert.equal(await evaluate(visitorWindow,`getComputedStyle(document.querySelector('.portrait')).animationName`),'none');
  const frame=await evaluate(visitorWindow,`document.querySelector('.sprite').src`);await wait(400);
  assert.equal(await evaluate(visitorWindow,`document.querySelector('.sprite').src`),frame);
  assert.equal(await evaluate(visitorWindow,`document.documentElement.scrollWidth<=innerWidth`),true);
  await visitorWindow.webContents.debugger.detach();
  visitor.close();assert.equal(visitorWindow.isDestroyed(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: real Dragon streak/cooldown, physical right edge beyond side Dock, synchronized full exit, sideways head peek/retraction, cleanup, English dark/reduced motion. Screenshots: '+output);
  dragon.destroy();app.quit();
}).catch(error=>{console.error(error);if(visitor)visitor.close();app.exit(1);});
