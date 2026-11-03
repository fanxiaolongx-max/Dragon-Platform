const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'workspace-theme-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const web=express();web.get('/',(_q,r)=>r.type('html').send(`<!doctype html><html data-ui="v2" data-theme="dark"><head><meta charset="utf-8">${['shared','workspace-panel','welink-threads','home-v2','home-theme'].map(s=>'<link rel="stylesheet" href="/css/'+s+'.css">').join('')}<style>body{margin:0;padding:32px;font:13px system-ui}.panel{width:340px;max-width:100%;padding:16px;background:var(--v2-bg);box-sizing:border-box}.wl-section-head{margin-bottom:16px}</style></head><body><aside class="panel"><header class="wl-section-head"><b>会话任务</b><span>4 项</span></header><p class="wl-scheduled-hint">向当前会话推送结果的任务</p><div class="wl-schedule-filters"><button aria-pressed="true">全部 <span>4</span></button><button>待执行 <span>1</span></button><button>需关注 <span>1</span></button><button>已结束 <span>2</span></button></div>${['running','done','failed','cancelled'].map((s,i)=>'<details class="wl-scheduled"><summary><span class="wl-scheduled-copy"><b>提醒任务 '+(i+1)+'</b><small>上次执行 · 11/03 07:37</small></span><span class="wl-scheduled-status is-'+s+'">'+['执行中','已完成','失败','已取消'][i]+'</span></summary></details>').join('')}</aside></body></html>`));web.use(express.static(path.join(root,'frontend')));
 const server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s))});const win=new BrowserWindow({show:false,width:440,height:760});const run=s=>win.webContents.executeJavaScript(s);
 try{await win.loadURL('http://127.0.0.1:'+server.address().port);
  for(const theme of ['dark','light']){
   await run(`document.documentElement.dataset.theme='${theme}'`);await new Promise(r=>setTimeout(r,350));
   const info=await run(`(()=>{const card=document.querySelector('.wl-scheduled'),title=card.querySelector('b');return {background:getComputedStyle(card).backgroundColor,text:getComputedStyle(title).color,button:getComputedStyle(document.querySelector('.wl-schedule-filters button:not([aria-pressed])')).backgroundColor}})()`);
   assert.equal(info.background,theme==='dark'?'rgb(26, 29, 35)':'rgb(255, 255, 255)');
   assert.equal(info.text,theme==='dark'?'rgb(230, 232, 235)':'rgb(31, 35, 40)');
   assert.equal(info.button,theme==='dark'?'rgb(21, 24, 29)':'rgb(247, 247, 248)');
   assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
   await run(`document.querySelector('.wl-scheduled').open=true`);
   fs.writeFileSync(path.join(temp,theme+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  console.log('PASS workspace task card, filters and four status themes. Screenshots: '+temp);
 }finally{win.destroy();server.close();app.quit()}
}).catch(e=>{console.error(e);app.exit(1)});
