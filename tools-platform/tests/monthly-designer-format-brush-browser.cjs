/* Run: node_modules/.bin/electron tests/monthly-designer-format-brush-browser.cjs */
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
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:true,width:1450,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 const report=engine.defaults(),source=report.sections[0].blocks[0];source.text.zh='源格式';source.textRuns={zh:[{text:'源格式',style:{fontSize:18,color:'#b91c1c',background:'#fef3c7',bold:true,underline:true}}],en:[]};
 const target=JSON.parse(JSON.stringify(source));target.id='paint-target';target.text.zh='目标[[@metric:risk]]';target.textRuns={zh:[{text:target.text.zh,style:{fontSize:24,color:'#2563eb',background:'#dcfce7',bold:false,underline:false}}],en:[]};
 const plain=JSON.parse(JSON.stringify(source));plain.id='plain-source';plain.text.zh='普通文字';plain.textRuns={zh:[{text:plain.text.zh,style:{fontSize:10,color:'#203044',bold:false,underline:false}}],en:[]};
 source.title.zh='卡片标题';report.footer.zh='报告页脚';report.sections[0].blocks=[source,plain];report.sections[1].blocks=[target];await evaluate(doc=>MonthlyDesigner.applyDocument(doc),report);
 const select=async id=>{await evaluate(id=>{document.querySelector(`[data-card-id="${id}"] .document-block-text .document-edit`).focus();},id);await wait(150);await evaluate(id=>{const field=document.querySelector(`[data-card-id="${id}"] .document-block-text .document-edit`);field.focus();const range=document.createRange();range.selectNodeContents(field);getSelection().removeAllRanges();getSelection().addRange(range);},id);await wait(50);};
 const paint=async(sourceId,targetId)=>{await select(sourceId);await until(()=>Boolean(document.querySelector('.rich-text-toolbar:not([hidden])')));await evaluate(()=>document.querySelector('[data-format=brush]').click());assert.equal(await evaluate(()=>document.querySelector('[data-format=brush]').getAttribute('aria-pressed')),'true');await select(targetId);await evaluate(id=>document.querySelector(`[data-card-id="${id}"] .document-edit`).dispatchEvent(new PointerEvent('pointerup',{bubbles:true})),targetId);};
 await paint(source.id,target.id);
 let runs=await evaluate(()=>MonthlyDesigner.getDocument().sections[1].blocks[0].textRuns.zh);
 assert.ok(runs.every(run=>run.style.fontSize===18&&run.style.color==='#b91c1c'&&run.style.background==='#fef3c7'&&run.style.bold&&run.style.underline));
 assert.equal(runs.map(run=>run.text).join(''),target.text.zh);
 assert.equal(await evaluate(()=>document.querySelector('.inline-metric').textContent),'10');
 await paint(plain.id,target.id);runs=await evaluate(()=>MonthlyDesigner.getDocument().sections[1].blocks[0].textRuns.zh);
 assert.ok(runs.every(run=>run.style.fontSize===10&&run.style.color==='#203044'&&!run.style.bold&&!run.style.underline));
 assert.ok(await evaluate(()=>{const field=document.querySelector('[data-card-id="paint-target"] .document-edit');return [...field.querySelectorAll('span')].every(span=>getComputedStyle(span).fontSize==='10px');}));
 await select(source.id);await evaluate(()=>document.querySelector('[data-format=brush]').click());await evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(await evaluate(()=>document.getElementById('monthlyDocument').classList.contains('format-brush-active')),false);
 // Every editor field has the same toolbar and persists its own styles.
 const paths=['.document-masthead h1 .document-edit','.document-section-head h2 .document-edit','.document-block h3 .document-edit','.document-meta-value .document-edit','.document-meta-label .document-edit','.document-footer .document-edit'];
 for(const selector of paths){
  await evaluate(selector=>document.querySelector(selector).focus(),selector);await wait(150);
  await evaluate(selector=>{const field=document.querySelector(selector);field.focus();const range=document.createRange();range.selectNodeContents(field);getSelection().removeAllRanges();getSelection().addRange(range);},selector);await wait(60);
  await until(()=>Boolean(document.querySelector('.rich-text-toolbar:not([hidden])')));
  await evaluate(()=>{const size=document.querySelector('.rich-text-toolbar [data-size]');size.value='8';size.dispatchEvent(new Event('change'));document.querySelector('[data-color="#7e22ce"]').click();});
  assert.ok(await evaluate(selector=>{const field=document.querySelector(selector);return getComputedStyle(field.querySelector('span')).fontSize==='8px';},selector));
 }
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().title.zh),report.title.zh);
 assert.ok(await evaluate(()=>MonthlyDesigner.getDocument().meta[0].fieldRuns.value.zh.every(run=>run.style.color==='#7e22ce')));
 await select(source.id);await evaluate(()=>document.querySelector('[data-format=brush]').click());
 await evaluate(()=>{const field=document.querySelector('.document-masthead h1 .document-edit');field.focus();const range=document.createRange();range.selectNodeContents(field);getSelection().removeAllRanges();getSelection().addRange(range);field.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
 assert.ok(await evaluate(()=>MonthlyDesigner.getDocument().fieldRuns.title.zh.every(run=>run.style.fontSize===18&&run.style.bold)));
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 runs=await evaluate(()=>MonthlyDesigner.getDocument().sections[1].blocks[0].textRuns.zh);assert.ok(runs.every(run=>run.style.fontSize===10&&!run.style.bold&&!run.style.underline));assert.equal(runs.map(run=>run.text).join(''),target.text.zh);
 assert.ok(await evaluate(()=>MonthlyDesigner.getDocument().fieldRuns.title.zh.every(run=>run.style.fontSize===18&&run.style.bold)));
 assert.ok(await evaluate(()=>MonthlyDesigner.getDocument().meta[0].fieldRuns.value.zh.every(run=>run.style.fontSize===8)));
 const exported=path.join(temp,'fields.html');const downloaded=new Promise(resolve=>win.webContents.session.once('will-download',(_,item)=>{item.setSavePath(exported);item.once('done',resolve);}));await evaluate(()=>document.querySelector('[data-action=html]').click());await downloaded;
 const html=fs.readFileSync(exported,'utf8');assert.match(html,/font-size:18px/);assert.match(html,/font-size:8px/);assert.match(html,/#7e22ce/);
 console.log('All editable titles, metadata labels/values and footer support rich formatting and format painting, persisted save/reload and HTML export.');
 console.log('Format painter copies five formatting properties across modules, replaces nested styles, clears bold/underline, preserves metric tokens, cancels with Escape and persists after reload.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
