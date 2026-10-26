// Mechanical extraction only: reuse the exact runtime atlas normalization.
// node_modules/.bin/electron scripts/prepare-dragon-pet.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'dragon-atlas-'));
app.setPath('userData',path.join(temporary,'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:false,webSecurity:false}});
  await win.loadFile(path.join(__dirname,'../desktop-pet/pet.html'));
  const frames=await win.webContents.executeJavaScript(`DragonArtwork.load(function(){}).then(function(a){return {idle:a.front[0],wave:a.wave[2],walk:a.walk[2],think:a.states[0],dragged:a.states[2],pat:a.states[7],sleep:a.states[6]};})`);
  for(const [name,data] of Object.entries(frames)) {
    if(!data?.startsWith('data:image/png;base64,'))throw new Error('Missing frame: '+name);
    fs.writeFileSync(path.join(__dirname,'../desktop-pet/assets/dragon',name+'.png'),Buffer.from(data.split(',')[1],'base64'));
  }
  console.log('Prepared seven static Dragon pose assets from the 2D atlases.');
  win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
