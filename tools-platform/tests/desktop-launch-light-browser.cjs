// Real file:// desktop pages with an isolated profile and mocked licensing IPC.
const {app,BrowserWindow,nativeTheme}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-light-')),root=path.join(__dirname,'..');
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
const preload=path.join(temp,'fixture.cjs');
fs.writeFileSync(preload,`const {contextBridge}=require('electron');let progress;
contextBridge.exposeInMainWorld('DesktopLicense',{getState:async()=>({valid:false,reasonCode:'LICENSE_REQUIRED',machine:{host:'Fixture Computer',platform:'win32',source:'win32',machineCode:'DMC1.fixture-machine-code'}}),readClipboard:()=> 'DSKL1.fixture.signature',writeClipboard:()=>true,onProgress:cb=>progress=cb,activate:async()=>{for(const [stage,percent]of [['PARSE_TOKEN',25],['CHECK_SIGNATURE',50],['CONNECT_SERVER',75],['FINALIZE',100]])progress?.({stage,percent});return {valid:false,reasonCode:'INVALID_SIGNATURE'}},quit:()=>{},requestInfo:async()=>({onlineAvailable:true}),submitRequest:async()=>({ok:true,request:{status:'pending',id:'fixture-request'}}),refreshRequest:async()=>({request:{status:'rejected',reason:'Fixture rejection'}}),cancelRequest:async()=>({ok:true}),onRequestUpdate:()=>{}});`);
let win;const wait=ms=>new Promise(r=>setTimeout(r,ms));
const run=code=>win.webContents.executeJavaScript(code,true);
const capture=async name=>{await wait(120);fs.writeFileSync(path.join(temp,name+'.png'),(await win.webContents.capturePage()).toPNG())};
app.whenReady().then(async()=>{
 nativeTheme.themeSource='dark'; // Pages must remain light even when the operating system requests dark.
 win=new BrowserWindow({show:false,width:620,height:340,useContentSize:true,frame:false,webPreferences:{sandbox:true,contextIsolation:true,preload}});
 await win.loadFile(path.join(root,'frontend/pages/startup.html'),{query:{snapshot:'1'}});await run('document.fonts.ready');
 assert.equal(await run('getComputedStyle(document.documentElement).colorScheme'),'light');
 await capture('startup');
 const bmp=require('../backend/models/platform-logo-image').decodeBmp(fs.readFileSync(path.join(root,'frontend/assets/portable-splash.bmp')));
 const index=(300*620+580)*4;assert.ok(bmp.data[index]>220&&bmp.data[index+1]>220,'portable first frame is also light');
 await win.loadFile(path.join(root,'frontend/pages/startup.html'));await wait(280);
 await run(`setStartupProgress({percent:65,title:'正在加载核心服务',detail:'准备本地数据与工作空间',stage:'阶段 2/2 · 服务加载'})`);await capture('startup-progress');
 await run(`setStartupProgress({percent:65,error:true,title:'启动失败',detail:'测试错误提示',stage:'请重试'})`);await capture('startup-error');
 win.setContentSize(1040,700);await win.loadFile(path.join(root,'frontend/pages/desktop-license-activation.html'));await wait(150);
 assert.equal(await run('getComputedStyle(document.documentElement).colorScheme'),'light');
 assert.equal(await run('getComputedStyle(document.body).backgroundColor'),'rgb(246, 247, 249)');
 await capture('license-zh');
 const hover=await run(`(()=>{const r=document.getElementById('btn-quit').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...hover});await wait(200);
 assert.equal(await run('getComputedStyle(document.getElementById("btn-quit")).color'),'rgb(32, 37, 44)','secondary button remains legible on hover');
 for(const [width,height,language]of [[1040,700,'en'],[900,600,'zh'],[560,650,'en']]){
  win.setContentSize(width,height);await run(`document.getElementById('lang-btn-${language}').click()`);await wait(120);
  assert.ok(await run('document.documentElement.scrollWidth<=innerWidth'),'no horizontal clipping');
  assert.ok(await run(`(()=>{const r=document.getElementById('btn-activate').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`));
  await capture('license-'+width+'-'+language);
 }
 win.setContentSize(1040,700);await run(`document.getElementById('lang-btn-zh').click();document.getElementById('btn-paste').click();document.getElementById('license-token').focus();true`);await capture('license-focus');
 await run(`document.getElementById('btn-activate').click()`);await wait(180);assert.ok(await run('document.getElementById("status-box").classList.contains("error")'));await capture('license-error');
 await run(`document.getElementById('request-name').value='测试申请人';document.getElementById('btn-request').click();true`);await wait(120);await capture('license-pending');
 console.log('PASS desktop startup/BMP and license light palette, OS dark, bilingual 1040/900/560px, progress/error/focus/request states. Screenshots: '+temp);win.destroy();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();app.exit(1)});
setTimeout(()=>app.exit(1),30000).unref();
