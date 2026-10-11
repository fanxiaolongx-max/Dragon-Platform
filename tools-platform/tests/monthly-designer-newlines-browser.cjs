/* Run: node_modules/.bin/electron tests/monthly-designer-inline-browser.cjs */
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
 const report=engine.defaults();await evaluate(doc=>MonthlyDesigner.applyDocument(doc),report);
 await evaluate(()=>{const field=document.querySelector('.document-block-text [contenteditable]');field.focus();const range=document.createRange();range.selectNodeContents(field);getSelection().removeAllRanges();getSelection().addRange(range);const dt=new DataTransfer();dt.setData('text/plain','首段\n\n1. 第一项\n2. 第二项');field.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));});
 assert.equal(await evaluate(()=>MonthlyRichText.read(document.querySelector('.document-block-text [contenteditable]')).map(run=>run.text).join('')),'首段\n\n1. 第一项\n2. 第二项');
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].text.zh),'首段\n\n1. 第一项\n2. 第二项');
 const savedId=await evaluate(()=>MonthlyDesigner.getDocument().id);assert.equal((await repo.getDocument(savedId)).document.sections[0].blocks[0].text.zh,'首段\n\n1. 第一项\n2. 第二项');
 await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 assert.equal(await evaluate(()=>MonthlyRichText.read(document.querySelector('.document-block-text [contenteditable]')).map(run=>run.text).join('')),'首段\n\n1. 第一项\n2. 第二项');
 const cases=[['a<div>b</div>','a\nb'],['<div>a</div><div><br></div><div>b</div>','a\n\nb'],['a<br><br>b','a\n\nb'],['<p>a</p><p>b</p>','a\nb'],['<div>a</div>b','a\nb'],['<span style="color:#2563eb">a</span><div><b>b</b></div>','a\nb']];
 for(const [html,text] of cases)assert.equal(await evaluate(html=>{const element=document.createElement('div');element.innerHTML=html;return MonthlyRichText.read(element).map(run=>run.text).join('');},html),text);
 console.log('Pasted multiline text and empty paragraphs survive input, SQLite save, reload and styled DOM serialization.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
