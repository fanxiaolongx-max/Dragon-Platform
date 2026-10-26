// node_modules/.bin/electron tests/dragon-pet-browser.cjs
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-pet-2d-'));
const output=process.env.DRAGON_PET_PREVIEW_DIR||temporary;fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(temporary,'profile'));app.disableHardwareAcceleration();

let win;const errors=[];const evaluate=code=>win.webContents.executeJavaScript(code,true);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(code){for(let n=0;n<160;n++){if(await evaluate(code))return;await wait(50);}throw Error('Timed out: '+code);}
setTimeout(()=>{console.error('Dragon UI timed out');app.exit(1);},60000).unref();
app.whenReady().then(async()=>{
  console.log('Electron ready');win=new BrowserWindow({width:600,height:720,show:true,backgroundColor:'#152932',webPreferences:{backgroundThrottling:false,nodeIntegration:false,contextIsolation:false,webSecurity:false}});
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2&&!message.includes('Electron Security Warning'))errors.push(message);});
  console.log('Loading pet');await win.loadFile(path.join(__dirname,'../desktop-pet/pet.html'));console.log('Pet loaded');
  await until('document.querySelector(".gpet-img").src.startsWith("data:image/png")');
  assert.equal(await evaluate(`document.querySelector('canvas.dragon-canvas')`),null,'2D mode has no WebGL renderer');
  const count=await evaluate(`DragonArtwork.load(function(){}).then(function(a){return ['idle','wave','walk','states'].map(function(k){return a[k].length;});})`);
  assert.deepEqual(count,[8,8,8,8]);
  await evaluate(`document.documentElement.style.setProperty('background','#152932','important');document.body.style.setProperty('background','#152932','important');GeminiPetInstance.setScale(2);`);
  await wait(150);
  const capture=async name=>fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());
  await capture('dragon-idle');
  await evaluate(`GeminiPetInstance.triggerRandomMotion('wave')`);await until(`document.querySelector('.gpet-img').dataset.motion==='wave'`);
  const wave=new Set();for(let i=0;i<5;i++){await wait(170);wave.add(await evaluate(`document.querySelector('.gpet-img').src`));}
  assert.ok(wave.size>=3,'greeting plays distinct hand-drawn frames');await capture('dragon-wave');
  await evaluate(`GeminiPetInstance.setWorkStateMode('dragged')`);await until(`document.querySelector('.gpet-img').dataset.motion==='dragged'`);
  const picked=await evaluate(`document.querySelector('.gpet-img').src`);await wait(650);
  assert.notEqual(await evaluate(`document.querySelector('.gpet-img').src`),picked,'dragged feet have alternating poses');await capture('dragon-dragged');
  await evaluate(`GeminiPetInstance.setWorkStateMode('working')`);await until(`document.querySelector('.gpet-img').dataset.motion==='think'`);await capture('dragon-think');
  await evaluate(`GeminiPetInstance.setWorkStateMode('idle');GeminiPetInstance.triggerRandomMotion('walk')`);await until(`document.querySelector('.gpet-img').dataset.motion==='walk'`);await wait(250);await capture('dragon-walk');
  await evaluate(`GeminiPetInstance.setWorkStateMode('idle');GeminiPetInstance.triggerRandomMotion('sleep')`);await until(`document.querySelector('.gpet-img').dataset.motion==='sleep'`);await wait(950);await capture('dragon-sleep');
  await win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait(120);const still=await evaluate(`document.querySelector('.gpet-img').src`);await evaluate(`GeminiPetInstance.triggerRandomMotion('wave')`);await wait(180);
  assert.equal(await evaluate(`document.querySelector('.gpet-img').src`),still,'reduced-motion disables idle playback');await win.webContents.debugger.detach();
  for(const mode of ['light','dark']){
    win.setSize(280,610);await win.loadFile(path.join(__dirname,'../desktop-pet/settings.html'));
    await win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:mode}]});
    await evaluate(`PetI18n.setLanguage('en-US')`);await wait(100);await capture('dragon-settings-'+mode);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true);
    await win.webContents.debugger.detach();
  }
  assert.deepEqual(errors,[]);
  console.log('32 Dragon sprites, wave/walk/sleep, drag interruption, reduced motion and bilingual light/dark settings passed. Screenshots: '+output);
  win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
