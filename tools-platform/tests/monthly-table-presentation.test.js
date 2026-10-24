const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'table-presentation-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'report');
const P=require('../frontend/js/monthly-designer/table-presentation'),E=require('../frontend/js/monthly-designer/document-engine'),repo=require('../backend/models/import-source-repository'),saved=require('../backend/models/source-presentation-repository'),{runWithTenant}=require('../backend/models/tenant-context');
test.after(async()=>{await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();});
const rules={nameMappings:[{kind:'column',field:'',from:'客户',to:'网络'},{kind:'row',field:'客户',from:'East',to:'东部'}],hiddenColumns:['待办'],hiddenRows:[{field:'客户',value:'West'}],marks:[{scope:'cell',field:'客户',value:'East',column:'金额',background:'#fef3c7',color:'#b91c1c'}]};
async function source(name='统计_2026年09月.xlsx',sheetName='Sheet1'){
 const batch=await repo.createBatch({targetMonth:9}),file=await repo.saveFile(batch.id,{originalname:name,buffer:Buffer.from('fixture')});await repo.saveSheets(file.id,[{name:sheetName,headers:['客户','金额','待办'],rows:[{客户:'East',金额:2,待办:3},{客户:'West',金额:5,待办:8}]}]);return (await repo.catalog()).files.find(item=>item.id===file.id);
}
test('display rules validate keyed rows and columns, colors, and report serialization',()=>{
 assert.deepEqual(P.validate(rules),rules);for(const bad of [{...rules,hiddenColumns:['x','x']},{...rules,hiddenRows:[{index:2}]},{...rules,marks:[{scope:'cell',column:'金额',field:'客户',value:'East',background:'red'}]},{...rules,marks:[...rules.marks,rules.marks[0]]}])assert.throws(()=>P.validate(bad));
 const doc=E.defaults(),block=doc.sections[0].blocks[0];block.tablePresentation={sourceKey:'key',rules};block.nameMappings=rules.nameMappings;assert.deepEqual(E.normalize(doc).sections[0].blocks[0].tablePresentation.rules,rules);
 assert.equal(P.scope({kind:'original',name:'统计_2026年09月.xlsx'},'Sheet1'),P.scope({kind:'structured',name:'统计_2026年10月.csv'},'Sheet1'));
 assert.notEqual(P.scope({kind:'original',name:'统计_2026年09月.xlsx'},'Sheet1'),P.scope({kind:'original',name:'其他_2026年10月.csv'},'Sheet1'));
});
test('saved rules follow the same source and sheet in later imports, preserve raw tables and history, and reject stale writes',async()=>{
 const file=await source(),sheet=file.sheets[0],first=await saved.read(sheet.id);assert.deepEqual(first.rules,P.empty());
 const value=await saved.save(sheet.id,{revision:first.revision,rules});assert.ok(value.revision);await assert.rejects(saved.save(sheet.id,{revision:first.revision,rules:P.empty()}),error=>error.status===409);
 const next=await source('统计_2026年10月.xlsx');assert.deepEqual((await saved.read(next.sheets[0].id)).rules,rules);
 const another=await source('其他_2026年10月.xlsx');assert.deepEqual((await saved.read(another.sheets[0].id)).rules,P.empty());
 const otherSheet=await source('统计_2026年10月.xlsx','明细');assert.deepEqual((await saved.read(otherSheet.sheets[0].id)).rules,P.empty());
 const original=await repo.getSheet(sheet.id);assert.deepEqual(original.headers,['客户','金额','待办']);assert.equal(original.rows[1].客户,'West');
 const report=E.defaults();report.sections[0].blocks[0].tablePresentation={sourceKey:first.key,rules};const stored=await repo.saveDocument(report);
 await saved.save(sheet.id,{revision:value.revision,rules:P.empty()});assert.deepEqual((await repo.getDocument(stored.id)).document.sections[0].blocks[0].tablePresentation.rules,rules);
 await runWithTenant('presentation-other',async()=>{await assert.rejects(saved.read(sheet.id),error=>error.status===404);const local=await source();assert.deepEqual((await saved.read(local.sheets[0].id)).rules,P.empty());});
});
test('presentation API requires an admin for updates and resolves sources within the active tenant',async t=>{
 const express=require('express'),app=express();app.use(express.json());app.use((req,res,next)=>runWithTenant(req.headers['x-test-tenant']||'default',()=>{req.user={role:req.headers['x-test-role']||'user'};next();}));app.use('/api/upload',require('../backend/routes/import-sources'));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const file=await source('API.xlsx'),url=`http://127.0.0.1:${server.address().port}/api/upload/source-sheets/${file.sheets[0].id}/presentation`,initial=await (await fetch(url)).json();assert.equal(initial.canWrite,false);
 const options={method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:initial.revision,rules})};assert.equal((await fetch(url,options)).status,403);
 options.headers['x-test-role']='admin';assert.equal((await fetch(url,options)).status,200);assert.equal((await fetch(url,options)).status,409);assert.equal((await fetch(url,{headers:{'x-test-tenant':'presentation-other'}})).status,404);
});
