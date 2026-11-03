// Actual homepage HTML/CSS with an isolated import dialog; no uploads or APIs.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tool-import-theme-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const web=express();web.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<html','<html data-ui="v2"').replace('<body','<body class="home-mode-chat"')));web.use(express.static(path.join(root,'frontend')));
 const server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s))});
 const win=new BrowserWindow({show:false,width:1440,height:950});const run=s=>win.webContents.executeJavaScript(s);
 try{
  await win.loadURL('http://127.0.0.1:'+server.address().port);
  await run(`document.querySelector('#customToolImportModal').classList.add('open')`);
  for(const [name,w,h,theme] of [['light',1440,950,'light'],['dark',1440,950,'dark'],['mobile',390,700,'light'],['short',900,600,'light']]){
   win.setSize(w,h);await run(`document.documentElement.dataset.theme='${theme}'`);await new Promise(r=>setTimeout(r,350));
   const info=await run(`(()=>{const m=document.querySelector('#customToolImportModal'),d=m.querySelector('.tool-import-dialog'),r=d.getBoundingClientRect(),s=getComputedStyle(d);return {width:r.width,left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,color:getComputedStyle(m.querySelector('h2')).color,bg:s.backgroundColor,blur:s.backdropFilter,overlay:getComputedStyle(m).backgroundColor,scroll:m.querySelector('form').scrollHeight>m.querySelector('form').clientHeight}})()`);
   assert.ok(info.width<=560&&info.left>=0&&info.right<=info.w&&info.top>=10&&info.bottom<=info.h,'dialog fits '+name);
   assert.equal(info.color,theme==='dark'?'rgb(230, 232, 235)':'rgb(31, 35, 40)','title follows theme');
   assert.match(info.blur,/blur\(24px\)/,'glass panel blurs backdrop');
   assert.match(info.overlay,/0\.16|0\.24/,'light overlay leaves homepage visible');
   await run(`document.querySelector('#customToolImportForm').scrollTop=10000`);
   assert.ok(await run(`(()=>{const b=document.querySelector('#customToolImportSubmit').getBoundingClientRect();return b.bottom<=innerHeight&&b.top>=0})()`),'submit stays reachable');
   await run(`document.querySelector('#customToolImportForm').scrollTop=0`);
   fs.writeFileSync(path.join(temp,name+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  console.log('PASS import dialog themes, glass, compact size, narrow and short viewports. Screenshots: '+temp);
 }finally{win.destroy();server.close();app.quit()}
}).catch(e=>{console.error(e);app.exit(1)});
