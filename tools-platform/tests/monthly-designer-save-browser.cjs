/* Run: node_modules/.bin/electron tests/monthly-designer-save-browser.cjs */
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-save-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));
const repo=require('../backend/models/import-source-repository');const engine=require('../frontend/js/monthly-designer/document-engine');const {runWithTenant}=require('../backend/models/tenant-context');
let win,server,activeTenant='default',failSave=false,failList=false,posts=0;const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function until(fn){for(let i=0;i<120;i++){if(await evaluate(fn))return;await wait(50);}throw new Error('Page initialization timed out');}
app.whenReady().then(async()=>{
 const first=await repo.saveDocument({...engine.defaults(),name:'First report'});await wait(20);await repo.saveDocument({...engine.defaults(),name:'Later created report'});await wait(20);
 const latest=await repo.saveDocument({...first.document,name:'Most recently saved report',title:{zh:'最近保存的月报',en:'Latest saved report'},navRows:3});
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));web.use((req,res,next)=>runWithTenant(activeTenant,next));web.post('/api/upload/monthly-documents',async(req,res,next)=>{posts++;await wait(120);if(failSave)return res.status(503).json({error:'测试保存失败'});next();});web.get('/api/upload/monthly-documents',(req,res,next)=>{if(failList)return res.status(503).json({error:'测试列表失败'});next();});web.use('/api/upload',require('../backend/routes/import-sources'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:true,width:1450,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 win.show();win.focus();await wait(150);
 const point=await evaluate(()=>{const el=document.querySelector('.document-meta-value');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();const edit=el.querySelector('[contenteditable]');return {x:Math.round(r.x+r.width*.7),y:Math.round(r.y+r.height-6),width:edit.getBoundingClientRect().width,available:r.width};});
 assert.ok(point.width>point.available*.7,'Blank editable occupies the value area');
 win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});await wait(80);
 assert.equal(await evaluate(()=>document.activeElement.parentElement.className),'document-meta-value');
 await evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.activeElement);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});
 await win.webContents.insertText('直接填写部门');await wait(100);

 await evaluate(()=>document.querySelector('[data-action=save]').click());
 assert.equal(await evaluate(()=>document.querySelector('[data-action=save]').disabled),true);
 await evaluate(()=>document.querySelector('[data-action=save]').click());
 await until(()=>!document.querySelector('[data-action=save]').disabled);
 assert.equal(posts,1,'Duplicate saves blocked');
 assert.match(await evaluate(()=>document.getElementById('globalToast').textContent),/成功保存/);
 assert.equal((await repo.getDocument(latest.id)).document.meta[0].value.zh,'直接填写部门');
 const version=await evaluate(()=>MonthlyDesigner.getDocument().saveCount);
 failSave=true;
 await evaluate(()=>{const edit=document.querySelector('.document-meta-value [contenteditable]');edit.focus();edit.textContent='失败后保留修改';document.querySelector('[data-action=save]').click();});
 await until(()=>!document.querySelector('[data-action=save]').disabled);
 assert.match(await evaluate(()=>document.getElementById('globalToast').textContent),/保存失败/);
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().meta[0].value.zh),'失败后保留修改');
 assert.equal((await repo.getDocument(latest.id)).document.meta[0].value.zh,'直接填写部门');
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().saveCount),version,'Failed save does not advance version');
 failSave=false;failList=true;
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 assert.match(await evaluate(()=>document.getElementById('globalToast').textContent),/成功保存/);
 assert.match(await evaluate(()=>document.getElementById('designerStatus').textContent),/列表刷新失败/);
 assert.equal((await repo.getDocument(latest.id)).document.meta[0].value.zh,'失败后保留修改');
 assert.equal(await evaluate(()=>document.getElementById('monthlyDocument').inert),false);
 console.log('Metadata blank-area click and typing, persisted save, duplicate prevention, failure recovery and list-refresh failure feedback passed.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
