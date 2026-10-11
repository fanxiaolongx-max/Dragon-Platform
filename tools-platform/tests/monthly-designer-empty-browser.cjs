/* Run: node_modules/.bin/electron tests/monthly-designer-empty-browser.cjs */
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-inline-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));
const repo=require('../backend/models/import-source-repository');const engine=require('../frontend/js/monthly-designer/document-engine');const {runWithTenant}=require('../backend/models/tenant-context');
let win,server,activeTenant='default',metricValue=10;const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function until(fn){for(let i=0;i<120;i++){if(await evaluate(fn))return;await wait(50);}throw new Error('Page initialization timed out');}
app.whenReady().then(async()=>{
 const first=await repo.saveDocument({...engine.defaults(),name:'First report'});await wait(20);await repo.saveDocument({...engine.defaults(),name:'Later created report'});await wait(20);
 const latest=await repo.saveDocument({...first.document,name:'Most recently saved report',title:{zh:'最近保存的月报',en:'Latest saved report'},navRows:3});
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));web.use((req,res,next)=>runWithTenant(activeTenant,next));web.get('/api/upload/source-catalog',(_,res)=>res.json({files:[],snapshots:[{id:'metrics',captured_at:'2026-10-10T12:38:28Z',target_month:9,kind:'extraction',metrics:[{key:'risk',label:'风险',value:metricValue,subMetrics:[{category:'TE',value:2}]}],sections:[]}],batches:[{id:'oct',created_at:'2026-10-10T12:38:28Z',target_month:9},{id:'sep',created_at:'2026-09-03T11:46:18Z',target_month:8}]}));web.use('/api/upload',require('../backend/routes/import-sources'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:false,width:1450,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 const report=engine.defaults();const base=report.sections[0].blocks[0];base.text.zh='非空正文';base.title.zh='';
 const titleOnly=JSON.parse(JSON.stringify(base));titleOnly.id='title-only';titleOnly.title.zh='只有标题';titleOnly.text.zh='';titleOnly.heightUnits=4;
 const blank=JSON.parse(JSON.stringify(titleOnly));blank.id='blank';blank.title.zh='';
 report.sections[0].blocks=[base,titleOnly,blank];
 await evaluate(doc=>MonthlyDesigner.applyDocument(doc),report);
 // Deleting formatted content commonly leaves a BR or empty B/DIV in contenteditable.
 for(const html of ['<br>','<div><b><br></b></div>','<span> </span>']){
  await evaluate(html=>{const field=document.querySelector('[data-card-id="title-only"] h3 .document-edit');field.innerHTML=html;field.dispatchEvent(new Event('input',{bubbles:true}));},html);
  assert.ok(await evaluate(()=>document.querySelector('[data-card-id="title-only"] h3 .document-edit').hasAttribute('data-empty')));
  assert.match(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="title-only"] h3 .document-edit'),'::before').content),/内容标题/);
 }
 await evaluate(()=>{const title=document.querySelector('[data-card-id="title-only"] h3 .document-edit');title.textContent='只有标题';title.dispatchEvent(new Event('input',{bubbles:true}));title.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));const text=document.querySelector('[data-card-id="title-only"] .document-block-text .document-edit');text.innerHTML='<b><br></b>';text.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.match(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="title-only"] .document-block-text .document-edit'),'::before').content),/点击填写正文/);
 assert.notEqual(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="blank"]')).display),'none');
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 // Verify the same output styles under the print media used by PDF.
 await win.webContents.debugger.attach('1.3');await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:'print'});
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="blank"]')).display),'none');
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('.document-block h3')).display),'none');
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="title-only"] .document-block-text')).display),'none');
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="title-only"]')).minHeight),'0px');
 const pdf=await win.webContents.printToPDF({printBackground:true});assert.ok(pdf.length>1000);
 await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{media:''});win.webContents.debugger.detach();
 const exported=path.join(temp,'empty-output.html');const downloaded=new Promise(resolve=>win.webContents.session.once('will-download',(_,item)=>{item.setSavePath(exported);item.once('done',resolve);}));
 await evaluate(()=>document.querySelector('[data-action=html]').click());await downloaded;
 await win.loadFile(exported);
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="blank"]')).display),'none');
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('.document-block h3')).display),'none');
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('[data-card-id="title-only"] .document-block-text')).display),'none');
 assert.ok(await evaluate(()=>document.querySelector('.document-block-text').textContent.includes('非空正文')));
 console.log('Empty titles, bodies, cards and sections collapse in HTML/print/PDF; deletion placeholders return and persist after save/reload.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
