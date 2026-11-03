const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'requirements-mono-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
const fixture=['提交','需求接受','需求实现中','需求完成','验收完成','需求评价','已拒绝'].map((status,i)=>({id:i+1,title:['优化全平台的 Agent 协作体验','完善数据导入质量检查','新增月报预览与导出'][i%3],description:'统一交互体验，完善异常提示，并支持在不同主题与设备下使用。',category:i%2?'数据导入(SLA)':'全局通用',urgent:i===0,status,creator:'admin',assignee:i%2?'dragon':'',created_at:'2026-11-03 09:00:00',updated_at:'2026-11-03 09:00:00'}));
app.whenReady().then(async()=>{
 const web=express();web.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(path.join(root,'frontend/pages/requirements.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('</body>',`<script>window.API={get:async()=>${JSON.stringify(fixture)}};</script><script src="/js/requirements.js"></script></body>`)));
 web.use(express.static(path.join(root,'frontend')));const server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s))});const win=new BrowserWindow({show:false,width:1440,height:1050});
 const run=s=>win.webContents.executeJavaScript(s);
 try{
  await win.loadURL('http://127.0.0.1:'+server.address().port);
  for(const [name,w,h,theme,language] of [['light',1440,1050,'light','zh'],['dark',1440,1050,'dark','zh'],['english',1440,1050,'light','en'],['mobile',390,844,'light','zh']]){
   win.setSize(w,h);await run(`document.documentElement.dataset.platformTheme='${theme}';applyReqLanguage('${language}');`);await new Promise(r=>setTimeout(r,300));
   assert.equal(await run('document.querySelectorAll(".req-card").length'),7);
   assert.equal(await run('document.querySelectorAll(".stat-card-icon svg").length'),5);
   const colors=await run(`(()=>{const sels=['body','.req-card-urgent','.urgent-badge','.req-header','.req-stat-card','.req-stats-right','.req-mini-dot','.req-mini-label','.stat-flow-item u'];return sels.flatMap(s=>{const el=document.querySelector(s),v=getComputedStyle(el);return [v.color,v.backgroundColor,v.borderTopColor]})})()`);
   for(const value of colors){const nums=value.match(/[\d.]+/g)?.map(Number);if(nums&&nums.length>=3&&nums[3]!==0)assert.ok(Math.max(...nums.slice(0,3))-Math.min(...nums.slice(0,3))<=12,'neutral palette: '+value);}
   assert.equal(await run('getComputedStyle(document.querySelector(".req-card-urgent")).backgroundImage'),'none');
   fs.writeFileSync(path.join(temp,name+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  await run(`ReqApp.openCreateModal()`);assert.equal(await run('getComputedStyle(document.querySelector("#reqModal")).display'),'flex');
  console.log('PASS requirements neutral palette, outline icons, all stages, emergency, languages and modal. Screenshots: '+temp);
 }finally{win.destroy();server.close();app.quit()}
}).catch(e=>{console.error(e);app.exit(1)});
