/* Run: node_modules/.bin/electron tests/monthly-designer-mention-browser.cjs */
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
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));web.get('/api/sla/prefs/i18nMap',(_,res)=>res.json({}));web.get('/api/sla/categories',(_,res)=>res.json([]));web.use((req,res,next)=>runWithTenant(activeTenant,next));web.get('/api/upload/source-catalog',(_,res)=>res.json({files:[],snapshots:[{id:'metrics',captured_at:'2026-10-10T12:38:28Z',target_month:9,kind:'extraction',metrics:Array.from({length:6},(_,i)=>({key:'metric'+i,label:i===5?'指标5 · 本年操作量':'指标'+i,value:i,subMetrics:[{category:'TE',value:2}]})),sections:[]}],batches:[{id:'oct',created_at:'2026-10-10T12:38:28Z',target_month:9},{id:'sep',created_at:'2026-09-03T11:46:18Z',target_month:8}]}));web.use('/api/upload',require('../backend/routes/import-sources'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});win=new BrowserWindow({show:false,width:1450,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 const url=`http://127.0.0.1:${server.address().port}/pages/monthly-designer.html`;await win.loadURL(url);await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 const report=engine.defaults();report.sections[0].blocks[0].text.zh='测试';await evaluate(doc=>MonthlyDesigner.applyDocument(doc),report);
 const open=()=>evaluate(()=>{const field=document.querySelector('.document-block-text [contenteditable]');field.focus();const range=document.createRange();range.selectNodeContents(field);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);field.dispatchEvent(new KeyboardEvent('keydown',{key:'@',bubbles:true,cancelable:true}));});
 const keys=()=>evaluate(()=>Array.from(document.querySelectorAll('.metric-mention-menu [data-key]'),item=>item.dataset.key));
 await open();assert.deepEqual(await keys(),[]);
 assert.ok(await evaluate(()=>document.activeElement.matches('.metric-mention-menu [data-search]')));
 await evaluate(()=>{const search=document.querySelector('.metric-mention-menu [data-search]');search.value='   ';search.dispatchEvent(new Event('input'));});assert.deepEqual(await keys(),[]);
 await evaluate(()=>document.querySelector('.metric-mention-menu [data-close]').click());
 for(const key of ['metric0','metric1','metric2','metric3','metric1']){
  await open();await evaluate(key=>{const search=document.querySelector('.metric-mention-menu [data-search]');search.value='指标';search.dispatchEvent(new Event('input'));document.querySelector(`[data-key="${key}"]`).click();},key);
 }
 await open();assert.deepEqual(await keys(),['metric1','metric3','metric2']);
 await evaluate(()=>{const search=document.querySelector('.metric-mention-menu [data-search]');search.value='指标';search.dispatchEvent(new Event('input'));});assert.equal((await keys()).length,6);
 await evaluate(()=>{const search=document.querySelector('.metric-mention-menu [data-search]');search.value='';search.dispatchEvent(new Event('input'));});assert.deepEqual(await keys(),['metric1','metric3','metric2']);
 await evaluate(()=>{const source=document.querySelector('.metric-mention-menu [data-source]');source.value='assessment';source.dispatchEvent(new Event('change'));});assert.deepEqual(await keys(),[]);
 await evaluate(()=>{const source=document.querySelector('.metric-mention-menu [data-source]');source.value='extraction';source.dispatchEvent(new Event('change'));const level=document.querySelector('.metric-mention-menu [data-level]');level.value='sub';level.dispatchEvent(new Event('change'));});assert.deepEqual(await keys(),[]);
 assert.ok(await evaluate(()=>{const rect=document.querySelector('.metric-mention-menu').getBoundingClientRect();return rect.top>=8&&rect.bottom<=innerHeight-8;}));
 await evaluate(()=>document.querySelector('.metric-mention-menu [data-close]').click());
 const frozen=await evaluate(()=>MonthlyDesigner.getDocument());frozen.reportMonth='2026-09';frozen.dataRulesVersion=1;frozen.inlineData={month:'2026-09',files:[],batches:[],snapshots:[{id:'saved',kind:'extraction',target_month:9,captured_at:'2026-10-01T00:00:00Z',sections:[],metrics:[{key:'metric0',label:'指标0',value:99}]}]};
 frozen.sections[0].blocks[0].text={zh:'已保存 [[@metric:metric0]]',en:''};delete frozen.sections[0].blocks[0].textRuns;
 await evaluate(doc=>MonthlyDesigner.applyDocument(doc),frozen);await evaluate(()=>MonthlyDesigner.whenRendered());
 assert.equal(await evaluate(()=>document.querySelector('.document-block-text .inline-metric').textContent),'99');
 await open();await evaluate(()=>{const search=document.querySelector('.metric-mention-menu [data-search]');search.value='操作';search.dispatchEvent(new Event('input'));});assert.deepEqual(await keys(),['metric5']);
 assert.equal(await evaluate(()=>document.querySelector('.document-block-text .inline-metric').textContent),'99');
 await evaluate(()=>document.querySelector('.metric-mention-menu [data-key=metric5]').click());
 assert.ok(await evaluate(()=>[...document.querySelectorAll('.document-block-text .inline-metric')].some(el=>el.dataset.metricToken==='[[@metric:metric5]]'&&el.textContent==='5')));
 console.log('Saved inline snapshot does not restrict searches for newly imported metrics; searching 操作 and inserting 本年操作量 succeeds without visiting dashboard.');
 console.log('Empty and whitespace search shows no initial indicators; recent choices are unique, ordered and capped at 3; search and source/level filters work and menu stays onscreen.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
