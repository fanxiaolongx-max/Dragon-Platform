const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'import-source-'));process.env.TOOLS_DATA_DIR=path.join(sandbox,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(sandbox,'reports');
const appDb=require('../backend/models/app-db');const pool=require('../backend/models/tenant-sqlite-pool');const {runWithTenant}=require('../backend/models/tenant-context');const repo=require('../backend/models/import-source-repository');const snapshots=require('../backend/models/sla-snapshots-repository');const engine=require('../frontend/js/monthly-designer/document-engine');
test.after(async()=>{await appDb.closeDatabase();await pool.closeAll();fs.rmSync(sandbox,{recursive:true,force:true});});
test('original bytes and all sheets survive without rules, parsing failures and snapshot deletion',async()=>{
 const batch=await repo.createBatch({targetMonth:9});const bytes=Buffer.from('\ufeffx,y\r\n"a,b",0\r\n');const file=await repo.saveFile(batch.id,{name:'unknown.csv',buffer:bytes});assert.deepEqual((await repo.getFile(file.id,true)).original_blob,bytes);
 await repo.saveSheets(file.id,[{name:'Sheet1',headers:['x','y'],rows:[{x:'a,b',y:0}]},{name:'Sheet2',headers:['name'],rows:[]}]);
 const catalog=await repo.catalog();assert.equal(catalog.files[0].sheets.length,2);assert.equal(catalog.snapshots.length,0);assert.equal((await repo.getSheet(catalog.files[0].sheets[0].id)).rows[0].y,0);
 const broken=await repo.saveFile(batch.id,{name:'broken.xls',buffer:Buffer.from('broken')});await repo.saveSheets(broken.id,[],'Invalid workbook');assert.equal((await repo.getFile(broken.id)).parse_status,'error');assert.deepEqual((await repo.getFile(broken.id,true)).original_blob,Buffer.from('broken'));
 const snapshot=await snapshots.addSnapshot({id:'no-rule',timestamp:'2026-09-01T10:00:00Z',sourceBatchId:batch.id,files:['unknown.csv'],topMetrics:[]});await snapshots.deleteSnapshot(snapshot.id);assert.equal((await repo.catalog()).snapshots.length,0);assert.deepEqual((await repo.getFile(file.id,true)).original_blob,bytes);
});
test('metric lineage freezes original files, rules and matched cleaned rows; latest bindings follow reimport',async()=>{
 const first=await repo.createBatch();const file=await repo.saveFile(first.id,{name:'Risk_Latest_2026-09.csv',buffer:Buffer.from('a\n1')});await repo.saveSheets(file.id,[{name:'Raw',headers:['a'],rows:[{a:1},{a:2}]}]);
 const snapshot={id:'metrics-first',timestamp:'2026-09-02T10:00:00Z',sourceBatchId:first.id,files:[file.name],sourceSections:[{key:'risk',title:'Risks',headers:['a'],sourceFiles:[file.name],rows:[{a:1},{a:2}]}],topMetrics:[{key:'risk_count',label:'Risk count',value:1,sourceSection:'risk',rule:{type:'count'},sourceSelections:[{sectionKey:'risk',indexes:[0]}]}]};await snapshots.addSnapshot(snapshot);
 let catalog=await repo.catalog();const metric=catalog.snapshots[0].metrics[0];assert.deepEqual(metric.fileIds,[file.id]);assert.equal(metric.rule.type,'count');assert.deepEqual((await repo.getMetricTable(snapshot.id,'risk_count')).rows,[{a:1}]);
 const next=await repo.createBatch();const second=await repo.saveFile(next.id,{name:'Risk_Latest_2026-10.csv',buffer:Buffer.from('a\n9')});await snapshots.addSnapshot({...snapshot,id:'metrics-second',timestamp:'2026-10-02T10:00:00Z',sourceBatchId:next.id,files:[second.name],sourceSections:[{...snapshot.sourceSections[0],sourceFiles:[second.name]}],topMetrics:[{...snapshot.topMetrics[0],value:9}]});catalog=await repo.catalog();
 assert.equal(engine.resolve({kind:'metric',mode:'latest',metricKey:'risk_count'},catalog).metric.value,9);assert.equal(engine.resolve({kind:'metric',mode:'pinned',metricKey:'risk_count',snapshotId:snapshot.id},catalog).metric.value,1);assert.deepEqual(catalog.snapshots.find(s=>s.id===snapshot.id).metrics[0].fileIds,[file.id]);
});
test('source originals, snapshots and monthly documents are tenant isolated',async()=>{
 const batch=(await repo.catalog()).batches[0];const file=(await repo.catalog()).files[0];const document=engine.defaults();const stored=await repo.saveDocument(document);
 await runWithTenant('second',async()=>{assert.equal(await repo.getFile(file.id,true),undefined);assert.equal(await repo.getDocument(stored.id),null);assert.deepEqual((await repo.catalog()).files,[]);await assert.rejects(repo.saveFile(batch.id,{name:'wrong.csv',buffer:Buffer.from('wrong')}),/batch not found/);await assert.rejects(snapshots.addSnapshot({id:'wrong',sourceBatchId:batch.id}),/tenant/);const own=await repo.createBatch();await repo.saveFile(own.id,{name:'second.csv',buffer:Buffer.from('second')});await repo.saveDocument({...document,name:'Second'});});
 assert.equal((await repo.getDocument(stored.id)).document.name,document.name);assert.equal((await repo.catalog()).files.some(file=>file.name==='second.csv'),false);
});
test('source HTTP endpoints preserve download bytes and reject cross-tenant access and invalid documents',async t=>{
 const express=require('express');const web=express();web.use(express.json({limit:'10mb'}));web.use((req,res,next)=>runWithTenant(req.headers['x-test-tenant']||'default',next));web.use('/api/upload',require('../backend/routes/import-sources'));const server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}/api/upload`;
 const batch=await (await fetch(base+'/source-batches',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();const body=new FormData();body.append('file',new Blob(['exact source\r\n']), 'source.csv');const response=await fetch(`${base}/source-batches/${batch.id}/files`,{method:'POST',body});assert.equal(response.status,200);const file=await response.json();assert.equal(await (await fetch(`${base}/source-files/${file.id}/download`)).text(),'exact source\r\n');assert.equal((await fetch(`${base}/source-files/${file.id}/download`,{headers:{'x-test-tenant':'second'}})).status,404);
 await snapshots.addSnapshot({id:'http-review',sourceBatchId:batch.id,selectedTargetMonth:9,sourceSections:[{key:'sr',mode:'sr',schemaHash:'saved-schema',sourceFiles:['source.csv'],rules:[{id:'count',type:'count'}]}]});
 const archived=await (await fetch(base+'/source-snapshots/http-review')).json();assert.equal(archived.selectedTargetMonth,9);assert.equal(archived.sourceSections[0].mode,'sr');assert.equal(archived.sourceSections[0].schemaHash,'saved-schema');assert.equal(archived.sourceSections[0].rules[0].id,'count');assert.equal((await fetch(base+'/source-snapshots/http-review',{headers:{'x-test-tenant':'second'}})).status,404);
 assert.equal((await fetch(base+'/monthly-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,name:'bad'})})).status,400);
});

test('catalog references saved assessment metrics with original targets and keeps extraction bindings separate',async()=>{
 const connection=pool.getConnection('report.db','report');const run=(sql,params=[])=>new Promise((resolve,reject)=>connection.run(sql,params,error=>error?reject(error):resolve()));
 await run('CREATE TABLE IF NOT EXISTS ReportSnapshots (id INTEGER PRIMARY KEY, snapshot_id TEXT, month INTEGER, created_at TEXT, raw_data_json TEXT)');
 await run('CREATE TABLE IF NOT EXISTS ReportMetricData (snapshot_id TEXT, month INTEGER, cat_name TEXT, metric_label TEXT, raw_val TEXT, target_val TEXT, gap TEXT, earned_score REAL, is_failing INTEGER)');
 await run('INSERT INTO ReportSnapshots VALUES (1,?,?,?,?)',['metrics-second',10,'2026-10-02 11:00:00',JSON.stringify({topMetrics:[{label:'Risk count',key:'risk_count',sourceSection:'risk',sourceFiles:[]} ]})]);
 await run('INSERT INTO ReportMetricData VALUES (?,?,?,?,?,?,?,?,?)',['metrics-second',10,'A','Risk count','9','12','3',0,1]);
 const catalog=await repo.catalog();const assessment=engine.resolve({kind:'metric',mode:'latest',metricKey:'assessment:A:Risk count'},catalog);
 assert.equal(assessment.metric.value,'9');assert.equal(assessment.metric.savedTarget,'12');assert.equal(assessment.metric.earnedScore,0);
 assert.equal(engine.resolve({kind:'metric',mode:'latest',metricKey:'risk_count',sectionKey:'risk'},catalog).metric.value,9);
 await runWithTenant('empty-tenant',async()=>assert.equal((await repo.catalog()).snapshots.length,0));
});

test('original upload switch defaults on, persists per tenant and leaves snapshots and existing archives usable',async()=>{
 assert.deepEqual(await repo.getImportSettings(),{uploadOriginals:true});
 const batch=await repo.createBatch();const file=await repo.saveFile(batch.id,{name:'retained.csv',buffer:Buffer.from('all months')});
 await repo.saveImportSettings({uploadOriginals:false});assert.deepEqual(await repo.getImportSettings(),{uploadOriginals:false});
 await assert.rejects(repo.createBatch(),error=>error.status===409);
 await assert.rejects(repo.saveFile(batch.id,{name:'blocked.csv',buffer:Buffer.from('blocked')}),error=>error.status===409);
 assert.equal((await repo.getFile(file.id,true)).original_blob.toString(),'all months');
 await snapshots.addSnapshot({id:'uploads-off',timestamp:'2026-10-03T10:00:00Z',sourceBatchId:null,topMetrics:[{key:'count',value:7}]});
 assert.equal((await repo.catalog()).snapshots.find(s=>s.id==='uploads-off').metrics[0].value,7);
 await runWithTenant('settings-other',async()=>{assert.deepEqual(await repo.getImportSettings(),{uploadOriginals:true});await repo.createBatch();});
 assert.equal((await repo.getImportSettings()).uploadOriginals,false);
 await assert.rejects(repo.saveImportSettings({uploadOriginals:'false'}),error=>error.status===400);
 await repo.saveImportSettings({uploadOriginals:true});await repo.createBatch();
});

test('multipart Chinese filenames and legacy Latin-1 names retain metric links without rewriting old stored rows',async t=>{
 const express=require('express');const web=express();web.use(express.json());web.use('/api/upload',require('../backend/routes/import-sources'));const server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}/api/upload`;
 const batch=await repo.createBatch({targetMonth:9});const name='PBI_自动抓取-风险详单_Latest.csv';const form=new FormData();form.append('file',new Blob(['network,count\r\n中文,0\r\n']),name);
 const response=await fetch(`${base}/source-batches/${batch.id}/files`,{method:'POST',body:form});assert.equal(response.status,200);const file=await response.json();assert.equal(file.name,name);
 const legacy=Buffer.from(name,'utf8').toString('latin1');await appDb.run('UPDATE import_source_files SET name=?,source_key=? WHERE id=?',[legacy,legacy.replace('.csv',''),file.id]);
 await snapshots.addSnapshot({id:'chinese-lineage',timestamp:'2026-10-10T09:00:00Z',sourceBatchId:batch.id,files:[name],sourceSections:[{key:'risk',sourceFiles:[name],headers:['count'],rows:[{count:0}]}],topMetrics:[{key:'risk-chinese',label:'TOPN 风险',sourceSection:'risk',sourceFiles:[name],value:0}]});
 // Simulate an old archive saved before filename normalization: its links were empty.
 const stored=await appDb.get('SELECT payload_json FROM import_source_snapshots WHERE id=?',['chinese-lineage']);const payload=JSON.parse(stored.payload_json);payload.topMetrics[0].fileIds=[];payload.sourceSections[0].fileIds=[];await appDb.run('UPDATE import_source_snapshots SET payload_json=? WHERE id=?',[JSON.stringify(payload),'chinese-lineage']);
 const catalog=await repo.catalog();const recovered=catalog.files.find(f=>f.id===file.id);assert.equal(recovered.name,name);assert.deepEqual(recovered.metricLabels,['TOPN 风险']);assert.deepEqual(catalog.snapshots.find(s=>s.id==='chinese-lineage').metrics[0].fileIds,[file.id]);assert.equal((await repo.getFile(file.id)).name,name);assert.equal((await appDb.get('SELECT name FROM import_source_files WHERE id=?',[file.id])).name,legacy);
 const download=await fetch(`${base}/source-files/${file.id}/download`);assert.match(download.headers.get('content-disposition'),/%E8%87%AA/);assert.equal(await download.text(),'network,count\r\n中文,0\r\n');
 const explicit=new FormData();explicit.append('file',new Blob(['x\n1']),name);explicit.append('kind','original');explicit.append('originalName',name);assert.equal((await (await fetch(`${base}/source-batches/${batch.id}/files`,{method:'POST',body:explicit})).json()).name,name);
});

test('monthly saves carry target-month names, update same month and preserve previous months and legacy reports',async()=>{
 const september=await repo.saveDocument(engine.prepareMonthlySave(engine.defaults(),'2026-09'));
 assert.match(september.name,/-2026-09$/);
 const october=await repo.saveDocument(engine.prepareMonthlySave(september.document,'2026-10'));
 assert.notEqual(october.id,september.id);assert.match(october.name,/-2026-10$/);
 assert.equal((await repo.getDocument(september.id)).name,september.name);
 const updated=await repo.saveDocument({...october.document,subtitle:{zh:'本月修改',en:'Updated'}});
 assert.equal(updated.id,october.id);assert.equal(updated.name,october.name);
 const legacy=await repo.saveDocument(engine.defaults());
 const migrated=await repo.saveDocument(engine.prepareMonthlySave(legacy.document,'2026-09'));
 assert.notEqual(migrated.id,legacy.id);assert.equal((await repo.getDocument(legacy.id)).name,legacy.name);
 await runWithTenant('month-isolation',async()=>{assert.equal(await repo.getDocument(september.id),null);const own=await repo.saveDocument(engine.prepareMonthlySave({...september.document},'2026-10'));assert.equal(own.name,'护网与网络安全月报-2026-10');});
});


test('successful report saves advance versions independently per month and serialize concurrent saves',async()=>{
 const first=await repo.saveDocument(engine.prepareMonthlySave(engine.defaults(),'2026-07'));
 const number=report=>report.meta.find(item=>item.label.zh==='报告编号').value.zh;
 assert.equal(first.document.saveCount,1);assert.equal(number(first.document),'EGY-CS-202607-V1.0');
 const second=await repo.saveDocument(first.document);assert.equal(second.document.saveCount,2);assert.equal(number(second.document),'EGY-CS-202607-V2.0');
 const [third,fourth]=await Promise.all([repo.saveDocument(first.document),repo.saveDocument(first.document)]);assert.equal(third.document.saveCount,3);assert.equal(fourth.document.saveCount,4);
 const next=await repo.saveDocument(engine.prepareMonthlySave(fourth.document,'2026-08'));assert.equal(next.document.saveCount,1);assert.equal(number(next.document),'EGY-CS-202608-V1.0');assert.equal((await repo.getDocument(first.id)).document.saveCount,4);
});

test('monthly logo library preserves multiple PNG uploads and tenant boundaries',async()=>{
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZLsAAAAASUVORK5CYII=','base64');
 const first=await repo.saveLogo({originalname:'Logo A.png',buffer:image});const second=await repo.saveLogo({originalname:'Logo B.png',buffer:image});assert.notEqual(first.id,second.id);assert.ok((await repo.listLogos()).some(item=>item.id===first.id));assert.deepEqual((await repo.getLogo(first.id)).image_blob,image);
 const report=engine.defaults();report.logo='/api/upload/monthly-logos/'+second.id+'/image';assert.equal(engine.normalize(report).logo,report.logo);
 await assert.rejects(repo.saveLogo({originalname:'unsafe.svg',buffer:Buffer.from('<svg/>')}),/Invalid PNG/);
 await runWithTenant('other-logo-tenant',async()=>{assert.equal(await repo.getLogo(first.id),undefined);assert.deepEqual(await repo.listLogos(),[]);});
});

test('legacy broad links recover from snapshot evidence without writes; library search uses latest rules per batch',async()=>{
 const batch=await repo.createBatch({targetMonth:9});const wfm=await repo.saveFile(batch.id,{name:'WFM-lineage.csv',buffer:Buffer.from('operation\n10')}),sr=await repo.saveFile(batch.id,{name:'SR-lineage.csv',buffer:Buffer.from('issues\n3')});const pending=await repo.saveFile(batch.id,{name:'Unconfigured-lineage.csv',buffer:Buffer.from('name\nA')});const names=[wfm.name,sr.name,pending.name];
 const payload={id:'legacy-broad-links',files:names,sourceSections:[{key:'wfm',sourceFiles:[wfm.name],headers:['operation'],rules:[{id:'operation',label:'本年操作量'}],rows:[{operation:10}]},{key:'sr',sourceFiles:[sr.name],headers:['issues'],rules:[{id:'issues',label:'SR数量'}],rows:[{issues:3}]}],topMetrics:[{key:'wfm_operation',label:'本年操作量',value:10,sourceFiles:names,fileIds:[wfm.id,sr.id],rule:{id:'operation',subMetrics:[{category:'TE',sourceSecId:'sr'}]},subMetrics:[{category:'TE',value:3}]},{key:'sr_issues',label:'SR数量',value:3,sourceFiles:names,fileIds:[wfm.id,sr.id]},{key:'unknown',label:'IBMS',value:'100%',sourceFiles:names,fileIds:[wfm.id,sr.id]}]};
 const appDb=require('../backend/models/app-db'),original=JSON.stringify(payload);await appDb.run('INSERT INTO import_source_snapshots (id,batch_id,captured_at,target_month,payload_json) VALUES (?,?,?,?,?)',[payload.id,batch.id,'2026-10-10T00:00:00Z',9,original]);
 let catalog=await repo.catalog({stage:'core'});const saved=catalog.snapshots.find(s=>s.id===payload.id);assert.deepEqual(saved.metrics[0].fileIds,[wfm.id]);assert.deepEqual(saved.metrics[0].subMetrics[0].fileIds,[sr.id]);assert.deepEqual(saved.metrics[1].fileIds,[sr.id]);assert.deepEqual(saved.metrics[2].fileIds,[]);assert.equal(saved.metrics[2].value,'100%');assert.equal(catalog.files.find(f=>f.id===wfm.id).metricSourceState,'single');assert.equal(catalog.files.find(f=>f.id===pending.id).metricSourceState,'unconfirmed');assert.equal(catalog.files.find(f=>f.id===pending.id).unresolvedMetricCount,1);assert.deepEqual(catalog.files.find(f=>f.id===wfm.id).metricLabels,['本年操作量']);assert.deepEqual(catalog.files.find(f=>f.id===sr.id).metricLabels,['本年操作量 / TE','SR数量']);assert.equal((await appDb.get('SELECT payload_json FROM import_source_snapshots WHERE id=?',[payload.id])).payload_json,original);
 // A date-limited catalog still knows all files in a linked batch; it must not mistake the one visible file for a single-file import.
 await appDb.run('UPDATE import_source_files SET created_at=? WHERE id=?',['2026-10-09T00:00:00Z',wfm.id]);await appDb.run('UPDATE import_source_files SET created_at=? WHERE id=?',['2026-10-10T00:00:00Z',sr.id]);const recent=await repo.catalog({stage:'core',since:'2026-10-10T00:00:00Z'});assert.deepEqual(recent.snapshots.find(s=>s.id===payload.id).metrics[2].fileIds,[]);
 await snapshots.addSnapshot({id:'precise-new-rules',timestamp:'2026-10-12T00:00:00Z',sourceBatchId:batch.id,selectedTargetMonth:9,files:names,sourceSections:payload.sourceSections,topMetrics:[{key:'sr_issues',label:'SR新数量',value:3,sourceLinkVersion:2,sourceSectionKeys:['sr']}]});catalog=await repo.catalog({stage:'core'});assert.deepEqual(catalog.files.find(f=>f.id===wfm.id).metricLabels,[]);assert.deepEqual(catalog.files.find(f=>f.id===sr.id).metricLabels,['SR新数量']);assert.equal(catalog.snapshots.find(s=>s.id===payload.id).metrics[0].value,10);
});
