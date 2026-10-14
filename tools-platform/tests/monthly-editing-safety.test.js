const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-editing-safety-'));
process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const repo=require('../backend/models/import-source-repository'),drafts=require('../backend/models/monthly-draft-repository'),engine=require('../frontend/js/monthly-designer/document-engine'),review=require('../frontend/js/monthly-designer/month-review'),mappings=require('../frontend/js/monthly-designer/name-mappings'),{runWithTenant}=require('../backend/models/tenant-context');
test.after(async()=>{await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();fs.rmSync(temp,{recursive:true,force:true});});
test('optimistic save rejects stale windows, deleted reports and stale cross-month copies',async()=>{
 const first=await repo.saveDocument(engine.prepareMonthlySave(engine.defaults(),'2026-09'));
 assert.match(first.revision,/^[a-f0-9]{64}$/);assert.equal((await repo.getDocument(first.id)).revision,first.revision);
 const outcomes=await Promise.allSettled([repo.saveDocument({...first.document,subtitle:engine.bilingual('A')},{expectedRevision:first.revision}),repo.saveDocument({...first.document,subtitle:engine.bilingual('B')},{expectedRevision:first.revision})]);
 assert.equal(outcomes.filter(item=>item.status==='fulfilled').length,1);const rejected=outcomes.find(item=>item.status==='rejected');assert.equal(rejected.reason.status,409);assert.equal(rejected.reason.code,'MONTHLY_SAVE_CONFLICT');
 const second=await repo.getDocument(first.id);assert.equal(second.document.saveCount,2);
 await assert.rejects(repo.saveDocument(engine.prepareMonthlySave(first.document,'2026-10'),{expectedRevision:first.revision}),{code:'MONTHLY_SAVE_CONFLICT'});
 const october=await repo.saveDocument(engine.prepareMonthlySave(second.document,'2026-10'),{expectedRevision:second.revision});assert.notEqual(october.id,first.id);assert.equal(october.document.saveCount,1);
 await repo.deleteDocuments([first.id]);await assert.rejects(repo.saveDocument(second.document,{expectedRevision:second.revision}),{code:'MONTHLY_SAVE_CONFLICT'});assert.equal(await repo.getDocument(first.id),null);
});
test('drafts do not change report number and isolate accounts, windows and tenants',async()=>{
 const stored=await repo.saveDocument(engine.prepareMonthlySave(engine.defaults(),'2026-08'));
 const document={...stored.document,subtitle:engine.bilingual('未正式保存')};
 await drafts.save('alice','window-a',{document,baseRevision:stored.revision});await drafts.save('alice','window-b',{document:{...document,subtitle:engine.bilingual('另一窗口')},baseRevision:stored.revision});
 assert.equal((await drafts.list('alice')).length,2);assert.deepEqual(await drafts.list('bob'),[]);await assert.rejects(drafts.read('bob','window-a'),{status:404});await drafts.remove('bob','window-a');assert.equal((await drafts.read('alice','window-a')).document.subtitle.zh,'未正式保存');
 assert.equal((await repo.getDocument(stored.id)).document.saveCount,1);assert.equal((await repo.getDocument(stored.id)).revision,stored.revision);
 await runWithTenant('draft-other',async()=>{assert.deepEqual(await drafts.list('alice'),[]);await assert.rejects(drafts.read('alice','window-a'),{status:404});await drafts.save('alice','window-a',{document,baseRevision:null});await drafts.remove('alice','window-a');assert.deepEqual(await drafts.list('alice'),[]);});
 assert.equal((await drafts.list('alice')).length,2);await drafts.remove('alice','window-a');assert.equal((await drafts.list('alice')).length,1);
});
test('month review locates old date phrases in both languages, including mixed dynamic text',()=>{
 const doc=engine.defaults(),block=doc.sections[0].blocks[0];block.text={zh:'9月完成 [[@metric:test]] 项，截至月底关闭。19月不应识别。',en:'September report; last month actions.'};block.title.zh='风险';
 doc.monthReview={from:'2026-09',to:'2026-10'};assert.equal(require('../frontend/js/monthly-designer/templates').capture(doc).document.monthReview,undefined);
 const items=review.findings(doc,'2026-09','2026-10').filter(item=>item.id===block.id&&item.key==='text');assert.equal(items.length,2);assert.equal(items[0].matches[0].text,'9月');assert.ok(items[0].matches.some(item=>item.text==='截至月底'));assert.ok(!items[0].matches.some(item=>item.text==='19月'));assert.equal(items[1].matches[0].text,'September');assert.equal(review.findings(doc,'2026-09','2026-09').length,0);
 block.text.zh='[[@metric:2026-09]]';block.text.en='';assert.equal(review.findings(doc,'2026-09','2026-10').filter(item=>item.id===block.id&&item.key==='text').length,0);
});
test('name candidates put visible fields and filtered rows first without truncating source rows',()=>{
 const source={headers:['隐藏列','客户','金额'],rows:Array.from({length:1501},(_,i)=>({客户:'客户'+i}))},visible={headers:['客户','金额'],rows:[{客户:'客户1500'}],displayed:true};
 assert.deepEqual(mappings.candidates([source,visible],{kind:'column'}).map(item=>item.value),['客户','金额','隐藏列']);
 const rows=mappings.candidates([source,visible],{kind:'row',field:'客户'});assert.equal(rows.length,1501);assert.deepEqual(rows[0],{value:'客户1500',displayed:true});
});
test('routes enforce draft ownership and return a stable conflict code',async()=>{
 const express=require('express'),web=express();web.use(express.json());web.use((req,res,next)=>{req.user={username:req.get('X-Test-User')||'alice',role:req.get('X-Test-Role')||'admin'};next();});web.use('/api/upload',require('../backend/routes/import-sources'));
 const server=await new Promise(resolve=>{const server=web.listen(0,'127.0.0.1',()=>resolve(server));});const origin='http://127.0.0.1:'+server.address().port;
 const request=(url,method='GET',body,headers={})=>fetch(origin+'/api/upload/'+url,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});
 try{
  const stored=await repo.saveDocument(engine.defaults());const fresh=await request('monthly-documents/'+stored.id);assert.equal(fresh.headers.get('cache-control'),'no-store');
  const payload={document:stored.document,baseRevision:stored.revision};assert.equal((await request('monthly-drafts/route-draft','PUT',payload)).status,200);assert.equal((await request('monthly-drafts/route-draft','GET',undefined,{'X-Test-User':'bob'})).status,404);assert.equal((await request('monthly-drafts/route-draft','PUT',payload,{'X-Test-Role':'user'})).status,403);
  assert.equal((await request('monthly-documents','POST',stored.document,{'X-Monthly-Base-Revision':stored.revision})).status,200);
  const conflict=await request('monthly-documents','POST',stored.document,{'X-Monthly-Base-Revision':stored.revision});assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'MONTHLY_SAVE_CONFLICT');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
