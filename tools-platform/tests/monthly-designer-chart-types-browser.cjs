/* Run: node_modules/.bin/electron tests/monthly-designer-chart-types-browser.cjs */
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-chart-types-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));
const repo=require('../backend/models/import-source-repository');const engine=require('../frontend/js/monthly-designer/document-engine');const {runWithTenant}=require('../backend/models/tenant-context');
let win,server,activeTenant='default';const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function until(fn){for(let i=0;i<120;i++){if(await evaluate(fn))return;await wait(50);}throw new Error('Page initialization timed out');}
app.whenReady().then(async()=>{
 const files=['2026年09月','2026年10月'].map((month,i)=>({id:'file'+i,name:'高危命令拦截_'+month+'.csv',batch_id:'batch',source_key:'source'+i,parse_status:'ready',created_at:'2026-10-10T12:38:28Z',size:100,kind:'structured',sheets:[{id:'sheet'+i,name:'Sheet1',headers:['客户','拦截数','其它数值'],rowCount:4}]}));
 const tables=files.map((file,i)=>({headers:file.sheets[0].headers,rows:[{客户:'Orange',拦截数:i?17:8,其它数值:2},{客户:'Telecom',拦截数:i?'':28,其它数值:-4},{客户:'Zero',拦截数:i?6:0,其它数值:1},{客户:'【总计】',拦截数:100,其它数值:7}]}));
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));web.use((req,res,next)=>runWithTenant(activeTenant,next));web.get('/api/upload/source-catalog',(_,res)=>res.json({files,snapshots:[],batches:[{id:'batch',created_at:'2026-10-10T12:38:28Z',target_month:9}]}));web.get('/api/upload/source-sheets/:id',(req,res)=>res.json(tables[Number(req.params.id.slice(-1))]));web.use('/api/upload',require('../backend/routes/import-sources'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:false,width:1450,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(message.startsWith('Uncaught'))console.error('Renderer:',message);});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 const report=engine.defaults();const chart=engine.block('chart');report.sections[0].blocks=[chart];await evaluate(doc=>MonthlyDesigner.applyDocument(doc),report);await until(()=>!!document.querySelector('[data-chart-add]'));
 for(let i=0;i<2;i++){await evaluate(i=>{const select=document.querySelector('[data-chart-add]');select.value=JSON.stringify({fileId:'file'+i,sheetId:'sheet'+i});select.dispatchEvent(new Event('change',{bubbles:true}));},i);await wait(150);await until(()=>document.querySelectorAll('.chart-series').length===MonthlyDesigner.getDocument().sections[0].blocks[0].chart.series?.length&&!!document.querySelector('.grouped-chart'));}

 const choose=async(name,value)=>{await evaluate((name,value)=>{const select=document.querySelector(`[data-chart-option="${name}"]`);select.value=String(value);select.dispatchEvent(new Event('change',{bubbles:true}));},name,value);await wait(80);};
 const bindings=await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.series);
 for(const type of ['bar','line','area','pie','donut','column']){
   await choose('type',type);await until(()=>!!document.querySelector('.document-chart'));
   assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.series),bindings);
   assert.equal(await evaluate(()=>document.querySelector('[data-chart-option="type"]').value),type);
   if(type==='column'||type==='bar')assert.equal(await evaluate(()=>document.querySelectorAll('[data-chart-bar]').length),5);
   if(type==='bar')assert.ok(await evaluate(()=>Array.from(document.querySelectorAll('[data-chart-bar]')).every(rect=>Number(rect.getAttribute('height'))<20)));
   if(type==='line'||type==='area'){
     assert.equal(await evaluate(()=>document.querySelectorAll('[data-chart-point]').length),5);assert.equal(await evaluate(()=>document.querySelectorAll('[data-chart-line]').length),3); // Missing Telecom breaks the second line; zero is still a point.
     if(type==='area')assert.equal(await evaluate(()=>document.querySelectorAll('[data-chart-area]').length),3);
   }
   if(type==='pie'||type==='donut'){
     assert.equal(await evaluate(()=>document.querySelectorAll('[data-chart-slice]').length),2);assert.equal(await evaluate(()=>Array.from(document.querySelectorAll('[data-chart-slice]')).reduce((sum,path)=>sum+Number(path.dataset.chartValue),0)),36);
     await choose('pieSeries',1);assert.equal(await evaluate(()=>Array.from(document.querySelectorAll('[data-chart-slice]')).reduce((sum,path)=>sum+Number(path.dataset.chartValue),0)),23);
     if(type==='donut')assert.equal(await evaluate(()=>document.querySelector('[data-chart-total]').textContent),'23');
     await choose('pieSeries',0);
   }
   if(type!=='column'){
     await evaluate(()=>document.querySelector('.document-chart').scrollIntoView({block:'center'}));await wait(60);
     const rect=await evaluate(()=>{const rect=document.querySelector('.document-chart').getBoundingClientRect();return {x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)};});
     fs.writeFileSync(path.join(temp,type+'-preview.png'),(await win.webContents.capturePage(rect)).toPNG());
   }
 }
 // Share charts select one month and do not silently convert negative values to positive shares.
 await evaluate(()=>{const doc=MonthlyDesigner.getDocument();doc.sections[0].blocks[0].chart.type='pie';doc.sections[0].blocks[0].chart.series[0].y='其它数值';MonthlyDesigner.applyDocument(doc);});await until(()=>document.querySelector('.chart-empty')?.textContent.includes('负数'));
 await choose('type','line');await until(()=>!!document.querySelector('.line-chart'));assert.ok(await evaluate(()=>document.querySelector('[data-chart-point="1-0"] title').textContent.includes('-4')));
 // Legacy single-source cards can also switch presentations, retaining source bindings and grouping.
 const legacy=engine.defaults(),single=engine.block('chart');single.binding={kind:'file',mode:'pinned',fileId:'file0',sheetName:'Sheet1'};single.chart={x:'客户',y:'拦截数',aggregation:'sum'};legacy.sections[0].blocks=[single];
 await evaluate(doc=>MonthlyDesigner.applyDocument(doc),legacy);await until(()=>!!document.querySelector('.document-chart'));
 assert.equal(await evaluate(()=>document.querySelector('[data-chart-option="type"]').value),'bar');await choose('type','line');await until(()=>!!document.querySelector('.line-chart'));assert.equal(await evaluate(()=>document.querySelectorAll('[data-chart-point]').length),3);
 await choose('type','donut');await until(()=>!!document.querySelector('.donut-chart'));assert.equal(await evaluate(()=>document.querySelector('[data-chart-total]').textContent),'36');
 const savedBinding=await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].binding);
 await evaluate(()=>document.querySelector('[data-action="save"]').click());await until(()=>document.getElementById('designerStatus').textContent.includes('成功保存'));await win.reload();await until(()=>!!document.querySelector('.donut-chart'));
 assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].binding),savedBinding);assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.type),'donut');assert.ok(await evaluate(()=>document.querySelector('.chart-bindings').hidden));
 // All exported formats retain the selected presentation without editor controls.
 await evaluate(()=>document.querySelector('[data-chart-toggle]').click());
 for(const [action,extension] of [['html','html'],['image','png'],['pdf','pdf']]){
   const downloaded=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_,item)=>{const target=path.join(temp,'donut.'+extension);item.setSavePath(target);item.once('done',(_,state)=>state==='completed'?resolve(target):reject(new Error(state)));}));
   await evaluate(action=>document.querySelector(`[data-action="${action}"]`).click(),action);const bytes=fs.readFileSync(await downloaded);assert.ok(bytes.length>1000);
   if(action==='html'){const html=bytes.toString();assert.ok(html.includes('donut-chart'));assert.ok(!html.includes('data-chart-option='));assert.ok(html.includes('36'));}
   if(action==='pdf')assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);
 }
 // A one-category chart remains a complete ring, while a zero-only share chart explains why it cannot draw.
 await evaluate(()=>{const doc=MonthlyDesigner.getDocument();doc.sections[0].blocks[0].filters=[{column:'客户',op:'eq',value:'Orange'}];MonthlyDesigner.applyDocument(doc);});await until(()=>document.querySelectorAll('[data-chart-slice]').length===1);assert.equal(await evaluate(()=>document.querySelector('[data-chart-total]').textContent),'8');
 await evaluate(()=>{const doc=MonthlyDesigner.getDocument();doc.sections[0].blocks[0].filters=[{column:'客户',op:'eq',value:'Zero'}];MonthlyDesigner.applyDocument(doc);});await until(()=>document.querySelector('.chart-empty')?.textContent.includes('大于 0'));
 console.log('Six chart presentations retain bindings, distinguish months, preserve zero and missing points, reject negative shares, support legacy sources, save/reload and export HTML / PNG / single-page PDF.');console.log('Chart previews',temp);
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
