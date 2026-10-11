/* Run: node_modules/.bin/electron tests/monthly-designer-month-browser.cjs */
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-month-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));
const repo=require('../backend/models/import-source-repository');const engine=require('../frontend/js/monthly-designer/document-engine');const {runWithTenant}=require('../backend/models/tenant-context');
let win,server,activeTenant='default';const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function until(fn){for(let i=0;i<120;i++){if(await evaluate(fn))return;await wait(50);}throw new Error('Page initialization timed out');}
app.whenReady().then(async()=>{
 const first=await repo.saveDocument({...engine.defaults(),name:'First report'});await wait(20);await repo.saveDocument({...engine.defaults(),name:'Later created report'});await wait(20);
 const latest=await repo.saveDocument({...first.document,name:'Most recently saved report',title:{zh:'最近保存的月报',en:'Latest saved report'},navRows:3});
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));web.use((req,res,next)=>runWithTenant(activeTenant,next));web.get('/api/upload/source-catalog',(_,res)=>res.json({files:[],snapshots:[],batches:[{id:'oct',created_at:'2026-10-10T12:38:28Z',target_month:9},{id:'sep',created_at:'2026-09-03T11:46:18Z',target_month:8}]}));web.use('/api/upload',require('../backend/routes/import-sources'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:false,width:1450,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 const value=label=>evaluate(label=>MonthlyDesigner.getDocument().meta.find(item=>item.label.zh===label).value.zh,label);
 assert.equal(await value('报告时间'),'2026-10-10');assert.equal(await value('数据月份'),'2026-09');
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 const september=await evaluate(()=>MonthlyDesigner.getDocument());assert.match(september.name,/-2026-09$/);assert.equal(september.saveCount,1);assert.match(await value('报告编号'),/-V1\.0$/);assert.notEqual(september.id,latest.id);
 await evaluate(()=>{const select=document.getElementById('libraryTargetPeriod');select.value='2026-08';select.dispatchEvent(new Event('change'));});
 assert.equal(await value('报告时间'),'2026-09-03');assert.equal(await value('数据月份'),'2026-08');
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 const august=await evaluate(()=>MonthlyDesigner.getDocument());assert.match(august.name,/-2026-08$/);assert.notEqual(august.id,september.id);assert.equal((await repo.getDocument(september.id)).name,september.name);
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().id),august.id);
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().saveCount),2);assert.match(await value('报告编号'),/-V2\.0$/);
 const names=await evaluate(()=>Array.from(document.getElementById('documentList').options).map(option=>option.textContent));assert.ok(names.includes(september.name));assert.ok(names.includes(august.name));
 console.log('Report date/source-month correction, month suffix, cross-month preservation, same-month update and saved-report picker passed.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
