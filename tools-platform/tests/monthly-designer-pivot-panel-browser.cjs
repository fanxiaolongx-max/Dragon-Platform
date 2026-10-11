/* Run: node_modules/.bin/electron tests/monthly-designer-pivot-panel-browser.cjs */
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-pivot-panel-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));
const repo=require('../backend/models/import-source-repository');const engine=require('../frontend/js/monthly-designer/document-engine');const {runWithTenant}=require('../backend/models/tenant-context');
let win,server,activeTenant='default';const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evaluate=(fn,...args)=>win.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`,true);
async function until(fn){for(let i=0;i<120;i++){if(await evaluate(fn))return;await wait(50);}throw new Error('Page initialization timed out');}
app.whenReady().then(async()=>{
 const files=[{id:'file0',name:'业务统计_2026年09月.csv',created_at:'2026-10-10T12:38:28Z',batch_id:'batch',kind:'structured',sheets:[{id:'sheet0',name:'Sheet1',headers:['服务类型','区域','金额','负责人'],rowCount:4}]},{id:'file1',name:'业务统计_2026年10月.csv',created_at:'2026-10-10T12:38:28Z',batch_id:'batch',kind:'structured',sheets:[{id:'sheet1',name:'Sheet1',headers:['服务类型','区域','金额','负责人'],rowCount:2}]}];
 const tables=[{headers:files[0].sheets[0].headers,rows:[{服务类型:'Cloud',区域:'East',金额:10,负责人:'alice'},{服务类型:'Cloud',区域:'East',金额:20,负责人:'bob'},{服务类型:'Network',区域:'West',金额:0,负责人:'alice'},{服务类型:'【总计】',区域:'',金额:30}]},{headers:files[1].sheets[0].headers,rows:[{服务类型:'Cloud',区域:'East',金额:30,负责人:'alice'},{服务类型:'Network',区域:'West',金额:6,负责人:'bob'}]}];
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(`const fab=document.createElement('div');fab.className='ai-fab';fab.setAttribute('tabindex','0');document.body.append(fab);const topButton=document.createElement('button');topButton.id='globalBackToTop';topButton.className='visible';document.body.append(topButton);const globalStyle=document.createElement('style');globalStyle.textContent='.ai-fab,#globalBackToTop.visible{display:block;position:fixed;right:22px;bottom:24px;z-index:10050;width:40px;height:40px}';document.head.append(globalStyle);`));web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));web.use((req,res,next)=>runWithTenant(activeTenant,next));web.get('/api/upload/source-catalog',(_,res)=>res.json({files,snapshots:[],batches:[{id:'batch',created_at:'2026-10-10T12:38:28Z',target_month:9}]}));web.get('/api/upload/source-sheets/:id',(req,res)=>res.json(tables[Number(req.params.id.slice(-1))]));web.use('/api/upload',require('../backend/routes/import-sources'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:false,width:2200,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(message.startsWith('Uncaught'))console.error('Renderer:',message);});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);

 assert.deepEqual(await evaluate(()=>['.ai-fab','#globalBackToTop'].map(selector=>getComputedStyle(document.querySelector(selector)).display)),['none','none']);
 // The hiding rule is limited to this editor, even when global CSS loads later.
 await evaluate(()=>document.body.classList.remove('monthly-designer-page'));
 assert.deepEqual(await evaluate(()=>['.ai-fab','#globalBackToTop'].map(selector=>getComputedStyle(document.querySelector(selector)).display)),['block','block']);
 await evaluate(()=>document.body.classList.add('monthly-designer-page'));

 const fresh=engine.defaults();fresh.sections[0].blocks=[];await evaluate(doc=>MonthlyDesigner.applyDocument(doc),fresh);
 const change=async(selector,value)=>{await evaluate((selector,value)=>{const input=document.querySelector(selector);if(!input)throw new Error('Missing '+selector);if(input.type==='checkbox')input.checked=value;else input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},selector,value);await wait(150);};
 await evaluate(()=>document.querySelector('[data-file-id="file0"]').open=true);
 assert.equal(await evaluate(()=>document.querySelectorAll('#sourceLibrary .source-field-columns, #sourceLibrary .chart-source-rows, #sourceLibrary [data-row-name-column]').length),0);
 assert.ok(await evaluate(()=>Array.from(document.querySelectorAll('#sourceLibrary [data-chart-field]')).every(el=>JSON.parse(el.dataset.chartField).kind==='table')));
 const before=await evaluate(()=>{const r=document.getElementById('monthlyDocument').getBoundingClientRect();return {x:r.x,width:r.width};});
 await change('[data-pivot-select-source*="sheet0"]',true);await until(()=>!document.getElementById('pivotFieldsPanel').hidden);
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks.length),1);
 assert.deepEqual(await evaluate(()=>{const r=document.getElementById('monthlyDocument').getBoundingClientRect();return {x:r.x,width:r.width};}),before);
 const layout=await evaluate(()=>{const r=document.getElementById('monthlyDocument').getBoundingClientRect(),p=document.getElementById('pivotFieldsPanel').getBoundingClientRect();return {reportRight:r.right,left:p.left,right:p.right,viewport:innerWidth,below:document.getElementById('pivotFieldsPanel').classList.contains('pivot-panel-below')};});
 assert.equal(layout.below,false,JSON.stringify(layout));assert.ok(layout.left>=layout.reportRight+10);assert.ok(layout.right<=layout.viewport-10);
 assert.equal(await evaluate(()=>document.querySelectorAll('#monthlyDocument .pivot-bindings, #monthlyDocument [data-chart-toggle], #monthlyDocument [data-pivot-add]').length),0);
 // First selection is one undo step, including the new card, and can be made again.
 await evaluate(()=>document.querySelector('[data-action="undo"]').click());await wait(100);assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks.length),0);
 await change('[data-pivot-select-source*="sheet0"]',true);await change('[data-pivot-select-source*="sheet1"]',true);
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks.length),1);assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.sources.length),2);

 // Exercise actual Chromium drag negotiation; direct synthetic drop events bypass
 // effectAllowed/dropEffect and previously hid the copy-versus-move failure.
 win.webContents.debugger.attach('1.3');
 const listDrop=async(field,role)=>{
  assert.equal(await evaluate(field=>document.querySelector('[data-pane-check="'+field+'"]').checked,field),false);
  const points=await evaluate((field,role)=>{const source=document.querySelector('[data-pane-field="'+field+'"]');source.scrollIntoView({block:'nearest'});const target=document.querySelector('[data-pane-role="'+role+'"] .pane-role-drop');target.scrollIntoView({block:'nearest'});const s=source.querySelector('span').getBoundingClientRect(),d=target.getBoundingClientRect();window.fieldDragTrace=[];const panel=document.getElementById('pivotFieldsPanel');panel.addEventListener('dragstart',event=>window.fieldDragTrace.push({type:'start',allowed:event.dataTransfer.effectAllowed}),{once:true});panel.addEventListener('drop',event=>window.fieldDragTrace.push({type:'drop',effect:event.dataTransfer.dropEffect}),{once:true});if(!window.fieldDragOverTrace){panel.addEventListener('dragover',event=>{if(event.target.closest('[data-pane-role]'))window.fieldDragTrace.push({type:'over',effect:event.dataTransfer.dropEffect});});window.fieldDragOverTrace=true;}return {x:s.x+s.width/2,y:s.y+s.height/2,tx:d.x+d.width/2,ty:d.y+d.height/2};},field,role);
  let dragData;const intercept=(_event,method,params)=>{if(method==='Input.dragIntercepted')dragData=params.data;};win.webContents.debugger.on('message',intercept);
  try{
   await win.webContents.debugger.sendCommand('Input.setInterceptDrags',{enabled:true});
   await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x,y:points.y});
   await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',x:points.x,y:points.y,button:'left',buttons:1,clickCount:1});
   await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.x+12,y:points.y+12,button:'left',buttons:1});
   await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.tx,y:points.ty,button:'left',buttons:1});
   for(let i=0;i<40&&!dragData;i++)await wait(25);
   assert.ok(dragData,'Chromium should start the field-list drag');assert.equal(dragData.dragOperationsMask,1,'Field-list drag permits copying');
   for(const type of ['dragEnter','dragOver','drop'])await win.webContents.debugger.sendCommand('Input.dispatchDragEvent',{type,x:points.tx,y:points.ty,data:dragData});
   await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',x:points.tx,y:points.ty,button:'left',buttons:0,clickCount:1});
   await evaluate(()=>MonthlyDesigner.whenRendered());
   assert.ok(await evaluate(()=>window.fieldDragTrace.some(event=>event.type==='over'&&event.effect==='copy')),'Dragover should accept the source copy operation: '+JSON.stringify({field,role,points,dragData,trace:await evaluate(()=>window.fieldDragTrace),status:await evaluate(()=>document.getElementById('designerStatus').textContent)}));
   assert.equal(await evaluate(field=>document.querySelector('[data-pane-check="'+field+'"]').checked,field),true,'Dropped field is automatically checked');
   assert.ok(await evaluate((role,field)=>{const pivot=MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot;return pivot[role].some(item=>(typeof item==='string'?item:item.field)===field);},role,field));
  }finally{win.webContents.debugger.removeListener('message',intercept);await win.webContents.debugger.sendCommand('Input.setInterceptDrags',{enabled:false});}
 };
 await listDrop('区域','rows');await listDrop('金额','values');await listDrop('服务类型','columns');await listDrop('负责人','filters');
 win.webContents.debugger.detach();
 // Removing the final placement clears its field-list checkbox.
 await evaluate(()=>document.querySelector('[data-pane-remove="columns"]').click());await evaluate(()=>MonthlyDesigner.whenRendered());assert.equal(await evaluate(()=>document.querySelector('[data-pane-check="服务类型"]').checked),false);
 await evaluate(()=>document.querySelector('[data-pane-remove="filters"]').click());await evaluate(()=>MonthlyDesigner.whenRendered());assert.equal(await evaluate(()=>document.querySelector('[data-pane-check="负责人"]').checked),false);

 assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.rows),['区域']);assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.values[0].aggregation),'sum');
 const drop=async(role,payload,index)=>{await evaluate((role,payload,index)=>{const transfer=new DataTransfer();transfer.setData('application/x-monthly-field',JSON.stringify(payload));const zone=document.querySelector('#pivotFieldsPanel [data-pane-role="'+role+'"]'),target=index==null?zone:zone.querySelector('[data-pane-index="'+index+'"]');target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));},role,payload,index);await wait(150);};
 await drop('columns',{kind:'pivot-field',column:'__monthly_source'});
 assert.ok(await evaluate(()=>document.querySelector('#monthlyDocument .pivot-table tbody').textContent.includes('East3030')));
 await change('#pivotFieldsPanel [data-pane-role="values"] [data-pivot-value="aggregation"]','average');
 assert.ok(await evaluate(()=>document.querySelector('#monthlyDocument .pivot-table tbody').textContent.includes('East1530')));
 await drop('filters',{kind:'pivot-field',column:'区域'});await evaluate(()=>document.querySelector('#pivotFieldsPanel [data-pane-settings]').click());await change('#pivotFieldsPanel [data-pivot-filter=op]','eq');await change('#pivotFieldsPanel [data-pivot-filter=value]','West');assert.equal(await evaluate(()=>document.querySelectorAll('#monthlyDocument .pivot-table tbody tr').length),1);
 await evaluate(()=>document.querySelector('#pivotFieldsPanel [data-pane-settings]').click());await change('#pivotFieldsPanel [data-pivot-filter="op"]','eq');await change('#pivotFieldsPanel [data-pivot-filter="value"]','East');
 assert.ok(await evaluate(()=>document.querySelector('#monthlyDocument .pivot-table tbody').textContent.includes('East1530')));
 await evaluate(()=>document.querySelector('#pivotFieldsPanel [data-pane-remove="filters"]').click());await wait(100);
 await drop('rows',{kind:'pivot-field',column:'服务类型'});const id=await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].id);
 await drop('rows',{kind:'pivot-placement',blockId:id,role:'rows',index:1},0);assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.rows),['服务类型','区域']);
 await drop('columns',{kind:'pivot-placement',blockId:id,role:'rows',index:0});assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.columns),['__monthly_source','服务类型']);
 await change('#pivotFieldsPanel [data-pane-check="服务类型"]',false);assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.columns),['__monthly_source']);
 await evaluate(()=>{const input=document.querySelector('[data-pane-search]');input.value='金额';input.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await evaluate(()=>document.querySelectorAll('#pivotFieldsPanel [data-pane-field]:not([hidden])').length),1);
 await evaluate(()=>{const input=document.querySelector('[data-pane-search]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.pane-advanced').open=false;document.getElementById('pivotFieldsPanel').scrollTop=0;window.scrollTo(0,0);});await wait(100);fs.writeFileSync(path.join(temp,'right-field-panel.png'),(await win.webContents.capturePage()).toPNG());
 const config=await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot);
 await evaluate(()=>document.querySelector('[data-action="save"]').click());await until(()=>document.getElementById('designerStatus').textContent.includes('成功保存'));await win.reload();await until(()=>!!document.querySelector('.pivot-table'));
 assert.deepEqual(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot),config);assert.equal(await evaluate(()=>document.querySelectorAll('#monthlyDocument .pivot-bindings, #sourceLibrary .source-field-columns, #sourceLibrary .chart-source-rows').length),0);
 await evaluate(()=>document.querySelector('#monthlyDocument [data-open-pivot]').click());await until(()=>!document.getElementById('pivotFieldsPanel').hidden);
 await change('[data-pivot-select-source*="sheet1"]',false);assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].chart.pivot.sources.length),1);await change('[data-pivot-select-source*="sheet1"]',true);
 const exported=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_,item)=>{const target=path.join(temp,'panel.html');item.setSavePath(target);item.once('done',(_,state)=>state==='completed'?resolve(target):reject(new Error(state)));}));await evaluate(()=>document.querySelector('[data-action="html"]').click());const output=fs.readFileSync(await exported,'utf8');assert.ok(output.includes('pivot-table'));assert.ok(!output.includes('pivotFieldsPanel'));assert.ok(!output.includes('data-pane-check'));
 // A smaller viewport uses a panel below the document without overlaying or shrinking it.
 win.setSize(900,900);await wait(150);const narrowBefore=await evaluate(()=>{const r=document.getElementById('monthlyDocument').getBoundingClientRect();return {x:r.x,width:r.width};});
 const narrow=await evaluate(()=>{const r=document.getElementById('monthlyDocument').getBoundingClientRect(),p=document.getElementById('pivotFieldsPanel').getBoundingClientRect();return {bottom:r.bottom,top:p.top,below:document.getElementById('pivotFieldsPanel').classList.contains('pivot-panel-below')};});assert.equal(narrow.below,true);assert.ok(narrow.top>=narrow.bottom+10);
 await evaluate(()=>document.querySelector('[data-pane-close]').click());assert.deepEqual(await evaluate(()=>{const r=document.getElementById('monthlyDocument').getBoundingClientRect();return {x:r.x,width:r.width};}),narrowBefore);
 await evaluate(()=>{document.documentElement.dataset.theme='dark';document.querySelector('[data-action=language]').click();});await wait(100);await evaluate(()=>document.querySelector('#monthlyDocument [data-open-pivot]').click());await until(()=>document.querySelector('.pivot-panel-head strong').textContent==='Pivot fields');assert.ok(await evaluate(()=>getComputedStyle(document.getElementById('pivotFieldsPanel')).backgroundColor==='rgb(30, 41, 59)'));
 assert.deepEqual(await evaluate(()=>['.ai-fab','#globalBackToTop'].map(selector=>getComputedStyle(document.querySelector(selector)).display)),['none','none']);
 console.log('Native unchecked field-list drags into all four roles auto-check; floating editor buttons hidden; right blank-area panel preserves report width/position; multi-source selections, table-only library and report-only results, four draggable roles, reordering, averages, row filters, undo, saved preferences and clean export pass.');console.log('Panel preview',temp);
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
