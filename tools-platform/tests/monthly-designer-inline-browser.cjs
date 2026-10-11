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
 const report=engine.defaults();report.sections[0].blocks[0].text.zh='风险：';await evaluate(doc=>MonthlyDesigner.applyDocument(doc),report);
 await evaluate(()=>{const field=document.querySelector('.document-block-text [contenteditable]');field.focus();const range=document.createRange();range.selectNodeContents(field);range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range);field.dispatchEvent(new KeyboardEvent('keydown',{key:'@',bubbles:true,cancelable:true}));});
 assert.equal(await evaluate(()=>document.querySelector('.metric-mention-menu [data-source]').value),'extraction');
 await evaluate(()=>{const level=document.querySelector('.metric-mention-menu [data-level]');level.value='sub';level.dispatchEvent(new Event('change'));});assert.ok(await evaluate(()=>document.querySelector('.metric-mention-menu [data-category]').textContent.includes('TE')));
 await evaluate(()=>{const level=document.querySelector('.metric-mention-menu [data-level]');level.value='main';level.dispatchEvent(new Event('change'));const search=document.querySelector('.metric-mention-menu [data-search]');search.value='风险';search.dispatchEvent(new Event('input'));document.querySelector('.metric-mention-menu [data-key=risk]').click();});
 assert.match(await evaluate(()=>MonthlyDesigner.getDocument().sections[0].blocks[0].text.zh),/风险：\[\[@metric:risk\]\]/);assert.equal(await evaluate(()=>document.querySelector('.inline-metric').textContent),'10');
 metricValue=27;await evaluate(()=>MonthlyDesigner.refresh());assert.equal(await evaluate(()=>document.querySelector('.inline-metric').textContent),'27');
 await evaluate(()=>document.querySelector('[data-edit-logo]').click());await until(()=>Boolean(document.querySelector('.logo-gallery button')));
 for(const name of ['Logo A','Logo B']){
  await evaluate(async name=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const file=new File([blob],name+'.png',{type:'image/png'}),dt=new DataTransfer();dt.items.add(file);const input=document.querySelector('[data-upload-logo]');input.files=dt.files;input.dispatchEvent(new Event('change'));},name);
  await until(()=>document.querySelector('[data-upload-logo]')&&!document.querySelector('[data-upload-logo]').disabled);
 }
 assert.equal(await evaluate(()=>document.querySelectorAll('.logo-gallery button').length),3);
 await evaluate(()=>document.querySelectorAll('.logo-gallery button')[1].click());const logo=await evaluate(()=>MonthlyDesigner.getDocument().logo);assert.match(logo,/monthly-logos/);
 assert.equal(await evaluate(async url=>(await fetch(url)).headers.get('content-type'),logo),'image/png');
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 const saved=await repo.getDocument(await evaluate(()=>MonthlyDesigner.getDocument().id));assert.equal(saved.document.logo,logo);assert.match(saved.document.sections[0].blocks[0].text.zh,/@metric:risk/);
 const exported=path.join(temp,'report.html');const downloaded=new Promise(resolve=>win.webContents.session.once('will-download',(_,item)=>{item.setSavePath(exported);item.once('done',resolve);}));await evaluate(()=>document.querySelector('[data-action=html]').click());await downloaded;
 const html=fs.readFileSync(exported,'utf8');assert.match(html,/data:image\/png;base64/);assert.ok(await evaluate(html=>new DOMParser().parseFromString(html,'text/html').querySelector('.document-block-text').textContent.includes('风险：27'),html));assert.doesNotMatch(html,/\[\[@metric:risk\]\]/);
 // Presets are served independently; this fixture has no custom-tool HTML or route.
 for(const number of ['01','02','03','04']){
  await evaluate(number=>{const select=document.getElementById('logoSelect');select.value='/assets/monthly-logos/'+number+'.svg';select.dispatchEvent(new Event('change'));},number);
  assert.equal(await evaluate(()=>MonthlyDesigner.getDocument().logo),'/assets/monthly-logos/'+number+'.svg');
  assert.ok(await evaluate(async()=>{const image=document.querySelector('[data-edit-logo]');await image.decode();return image.naturalWidth>0;}));
 }
 await evaluate(()=>document.querySelector('[data-action=save]').click());await until(()=>!document.querySelector('[data-action=save]').disabled);
 await win.reload();await until(()=>window.MonthlyDesigner&&!document.getElementById('monthlyDocument').inert);
 assert.equal(await evaluate(()=>document.getElementById('logoSelect').value),'/assets/monthly-logos/04.svg');
 const presetExport=path.join(temp,'preset.html');const presetDownloaded=new Promise(resolve=>win.webContents.session.once('will-download',(_,item)=>{item.setSavePath(presetExport);item.once('done',resolve);}));
 await evaluate(()=>document.querySelector('[data-action=html]').click());await presetDownloaded;
 assert.match(fs.readFileSync(presetExport,'utf8'),/data:image\/svg\+xml;base64/);
 await evaluate(()=>{const select=document.getElementById('logoSelect');select.value='';select.dispatchEvent(new Event('change'));});
 assert.equal(await evaluate(()=>getComputedStyle(document.querySelector('[data-edit-logo]')).display),'none');
 await evaluate(()=>{const select=document.getElementById('logoSelect');select.value='gallery';select.dispatchEvent(new Event('change'));});
 await until(()=>Boolean(document.querySelector('.logo-gallery button')));
 assert.equal(await evaluate(()=>document.querySelectorAll('.logo-gallery button').length),3);
 await evaluate(()=>document.querySelector('[data-logo-close]').click());
 await evaluate(url=>{const doc=MonthlyDesigner.getDocument();doc.logo=url;return MonthlyDesigner.applyDocument(doc);},logo);
 assert.equal(await evaluate(()=>document.getElementById('logoSelect').value),logo);
 console.log('Four independent logo presets decode, switch, persist, embed in HTML; hidden logo and existing uploaded gallery remain available.');
 console.log('Hierarchical @ metric insertion, live refresh, multiple PNG uploads, gallery selection, saved references and embedded-logo HTML export passed.');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(resolve=>server.close(resolve));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
