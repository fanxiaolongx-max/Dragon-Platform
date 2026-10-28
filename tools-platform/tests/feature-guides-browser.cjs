// Actual local media playback, translated entry labels and narrow-screen access; no accounts or production data.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),express=require('express');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'feature-guides-'));app.setPath('userData',path.join(tmp,'profile'));
const guides={aiMonthly:'ai-monthly-guide',welinkCli:'welink-cli-guide',welinkSdk:'welink-sdk-guide',digitalHuman:'digital-human-guide'};
const all=['rfc','incentive','eos','guide',...Object.keys(guides)];let win,server;
const ev=(f,...a)=>win.webContents.executeJavaScript(`(${f.toString()})(...${JSON.stringify(a)})`,true),wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(f){for(let i=0;i<200;i++){if(await ev(f))return;await wait(25)}throw Error('Timeout '+f)}
app.whenReady().then(async()=>{
 const web=express();web.get('/api/platform-promotions',(_,r)=>r.json({videos:all.map(id=>({id,enabled:true})),links:[],maxLinks:3,rotateSeconds:30,desktopStack:false}));web.get('/api/platform-promotions/desktop',(_,r)=>r.json({available:false}));
 web.get('/',(_,r)=>r.send(`<!doctype html><html lang="zh-CN" data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="/css/home-promo-video.css"><style>body{margin:0;background:#eef3f8;font:18px Arial}main{padding:30px;max-width:700px}</style><script>localStorage.setItem('tools_lang','zh-CN')</script><script src="/js/shared/i18n.js"></script><main><h1>四项功能视频 · 播放验证</h1><p>真实成片、本地播放，不调用业务服务。</p></main><script src="/js/home/promo-video.js"></script></html>`));
 web.use(express.static(path.join(__dirname,'../frontend')));server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s))});win=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{backgroundThrottling:false}});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/`);await until(()=>!!document.querySelector('#nrvFloat'));
 for(const lang of ['zh-CN','en-US']){
  await ev(lang=>window.ToolsI18n.setLanguage(lang),lang);
  for(const [key,file]of Object.entries(guides)){
   await ev(key=>document.querySelector(`.nrv-banner[data-video="${key}"]`)?.click(),key);
   await until(()=>document.querySelector('#nrvFloat video').readyState>=1);
   const src=await ev(()=>document.querySelector('#nrvFloat video').currentSrc);assert.ok(src.includes(file+'.mp4'),src);assert.ok(!src.includes('-en.mp4'));
   await ev(async()=>{const v=document.querySelector('#nrvFloat video');v.muted=true;await v.play()});await until(()=>document.querySelector('#nrvFloat video').currentTime>.15);
   await ev(()=>document.querySelector('#nrvFloat video').click());await until(()=>document.querySelector('#nrvDialog[open] video')?.readyState>=1);
   const hd=await ev(()=>{const v=document.querySelector('#nrvDialog video');return {src:v.currentSrc,w:v.videoWidth,h:v.videoHeight,d:v.duration,title:document.querySelector('#nrvDialog').textContent}});assert.ok(hd.src.includes(file+'-hd.mp4'));assert.equal(hd.w,1920);assert.equal(hd.h,1080);assert.ok(hd.d>120);
   if(lang==='en-US')assert.match(hd.title,/Mandarin/);
   await ev(async()=>{const v=document.querySelector('#nrvDialog video');v.muted=true;await v.play()});await until(()=>document.querySelector('#nrvDialog video').currentTime>.15);
   await ev(()=>document.querySelector('#nrvDialog .nrv-dialog-close').click());await until(()=>!document.querySelector('#nrvDialog[open]'));
  }
 }
 win.setSize(390,520);await wait(200);
 const bounds=await ev(()=>{const b=document.querySelector('.nrv-banners');b.scrollTop=b.scrollHeight;const last=b.lastElementChild.getBoundingClientRect(),r=b.getBoundingClientRect();return {top:r.top,bottom:r.bottom,vh:innerHeight,last:last.bottom,width:document.documentElement.scrollWidth,vw:innerWidth}});assert.ok(bounds.bottom<=bounds.vh&&bounds.last<=bounds.bottom+2,JSON.stringify(bounds));assert.ok(bounds.width<=bounds.vw);
 await wait(200);
 if(process.env.FEATURE_VIDEO_SHOTS){fs.mkdirSync(process.env.FEATURE_VIDEO_SHOTS,{recursive:true});fs.writeFileSync(path.join(process.env.FEATURE_VIDEO_SHOTS,'home-narrow.png'),(await win.webContents.capturePage()).toPNG())}
 console.log('Four feature guides: 720p/1080p real playback, Mandarin fallback in English UI, and scrollable narrow entry list passed.');
}).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{win?.destroy();server?.closeAllConnections();server?.close();fs.rmSync(tmp,{recursive:true,force:true});app.exit(process.exitCode||0)});
