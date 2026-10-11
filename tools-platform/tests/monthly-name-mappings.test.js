const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-mappings-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const repo=require('../backend/models/import-source-repository'),mappings=require('../frontend/js/monthly-designer/name-mappings'),engine=require('../frontend/js/monthly-designer/document-engine'),{runWithTenant}=require('../backend/models/tenant-context');
const rules=[{kind:'column',from:'network_name',to:'客户网络',field:''},{kind:'row',from:'EG-Egypt Orange',to:'Orange',field:'network_name'}];
test.after(async()=>{await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();});
test('mapping preserves original data and rejects incomplete, duplicate or oversized rules',()=>{
 assert.equal(mappings.label('network_name',rules,'column'),'客户网络');assert.equal(mappings.label('EG-Egypt Orange',rules,'row','network_name'),'Orange');assert.equal(mappings.label('EG-Egypt Orange',rules,'row','Other'),'EG-Egypt Orange');assert.equal(mappings.columnLabel('2026-09 · network_name · 求和',rules),'2026-09 · 客户网络 · 求和');
 for(const bad of [[{kind:'column',from:'',to:'x'}],[...rules,rules[0]],Array(201).fill(rules[0])])assert.throws(()=>mappings.validate(bad));
 const doc=engine.defaults(),block=doc.sections[0].blocks[0];block.nameMappings=rules;block.mappingPresetId='mapping-test';assert.deepEqual(engine.normalize(doc).sections[0].blocks[0].nameMappings,rules);block.nameMappings=[{kind:'column',from:'x',to:''}];assert.throws(()=>engine.normalize(doc));
});
test('reusable presets are independent of month and retained when a monthly document is saved or source preset deleted',async()=>{
 const preset=await repo.saveMappingPreset({name:'通用客户名称',rules});const doc=engine.defaults();doc.sections[0].blocks[0].nameMappings=rules;doc.sections[0].blocks[0].mappingPresetId=preset.id;const saved=await repo.saveDocument(doc);
 assert.deepEqual((await repo.getDocument(saved.id)).document.sections[0].blocks[0].nameMappings,rules);
 await repo.saveMappingPreset({name:'客户名称更新',rules:rules.slice(0,1)},preset.id);assert.equal((await repo.listMappingPresets())[0].name,'客户名称更新');assert.deepEqual((await repo.getDocument(saved.id)).document.sections[0].blocks[0].nameMappings,rules,'Updating reusable preset does not silently rewrite history');
 await runWithTenant('other-mapping-tenant',async()=>{assert.deepEqual(await repo.listMappingPresets(),[]);await assert.rejects(repo.saveMappingPreset({name:'foreign',rules},preset.id),error=>error.status===404);await assert.rejects(repo.deleteMappingPreset(preset.id),error=>error.status===404);});
 await repo.deleteMappingPreset(preset.id);assert.deepEqual((await repo.getDocument(saved.id)).document.sections[0].blocks[0].nameMappings,rules);
});
test('mapping APIs validate input and preserve tenant isolation',async t=>{
 const express=require('express'),web=express();web.use(express.json());web.use((req,res,next)=>runWithTenant(req.headers['x-test-tenant']||'default',next));web.use('/api/upload',require('../backend/routes/import-sources'));const server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}/api/upload/monthly-mapping-presets`,options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'API preset',rules})};
 const saved=await (await fetch(base,options)).json();assert.ok(saved.id);assert.equal((await (await fetch(base)).json()).length,1);assert.deepEqual(await (await fetch(base,{headers:{'x-test-tenant':'other-mapping-tenant'}})).json(),[]);
 assert.equal((await fetch(base,{...options,body:JSON.stringify({name:'bad',rules:[{kind:'column',from:'x',to:''}]})})).status,400);assert.equal((await fetch(base+'/'+saved.id,{...options,method:'PUT',headers:{...options.headers,'x-test-tenant':'other-mapping-tenant'}})).status,404);
});
