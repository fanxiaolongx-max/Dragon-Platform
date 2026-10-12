const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-data-formats-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const formats=require('../frontend/js/monthly-designer/data-formats'),repo=require('../backend/models/import-source-repository'),engine=require('../frontend/js/monthly-designer/document-engine'),{runWithTenant}=require('../backend/models/tenant-context');
const rule={scope:'column',target:'完成率',field:'',format:'percent',decimals:2,thousands:false,zeroAsBlank:false};
test.after(async()=>{await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();});
test('precision, percent scaling, existing percent, rounding, zeros, separators and nonnumeric values',()=>{
 assert.equal(formats.format(0.993328885923949,rule),'99.33%');assert.equal(formats.format('99.328%',rule),'99.33%');assert.equal(formats.format('99.328％',{...rule,format:'percentValue'}),'99.33%');assert.equal(formats.format(99.328,{...rule,format:'percentValue'}),'99.33%');assert.equal(formats.format(1.005,{...rule,format:'number'}),'1.01');assert.equal(formats.format(-.0001,{...rule,format:'number'}),'0.00');assert.equal(formats.format('1,234.56789',{...rule,format:'number',thousands:true}),'1,234.57');assert.equal(formats.format(0,{...rule,zeroAsBlank:true}),'');assert.equal(formats.format(-.125,{...rule,decimals:1}),'-12.5%');assert.equal(formats.format(.123456789,{...rule,format:'number',decimals:8}),'0.12345679');
 for(const value of ['2026-09-05','2026-09','East','',null,'1,2','Infinity','123abc'])assert.equal(formats.numeric(value),null);
 assert.equal(formats.format(1e308,rule),'1e+308');assert.equal(formats.numeric('1e-3').value,.001);
});
test('row rules override column/all rules; original fields, precision limits and duplicate rules validate',()=>{
 const row={...rule,scope:'row',target:'West',field:'区域',format:'number',decimals:3},all={...rule,scope:'all',target:'',format:'number'};assert.equal(formats.ruleFor([all,rule,row],'2026-09 · 完成率 · 求和',new Map([['区域','West']])),row);assert.equal(formats.ruleFor([all,rule,row],'完成率',new Map()),rule);assert.equal(formats.ruleFor([all],'区域',new Map(),true),null);
 for(const rules of [[{...rule,decimals:-1}],[{...rule,decimals:9}],[{...rule,decimals:1.2}],[{...rule,target:''}],[rule,rule],Array(201).fill(rule)])assert.throws(()=>formats.validate(rules));
 const doc=engine.defaults();doc.sections[0].blocks[0].dataFormats=[rule];doc.sections[0].blocks[0].dataFormatPresetId='valid-id';assert.equal(engine.normalize(doc).sections[0].blocks[0].dataFormats[0].decimals,2);
});
test('independent server format presets reuse across months, do not rewrite history and retain tenant boundaries',async()=>{
 const preset=await repo.saveDataFormatPreset({name:'常用数值格式',rules:[rule]});assert.equal((await repo.listDataFormatPresets()).length,1);assert.equal((await repo.listMappingPresets()).length,0);
 const doc=engine.defaults();doc.sections[0].blocks[0].dataFormats=[rule];doc.sections[0].blocks[0].dataFormatPresetId=preset.id;const saved=await repo.saveDocument(doc);await repo.saveDataFormatPreset({name:'更新格式',rules:[{...rule,decimals:1}]},preset.id);assert.equal((await repo.getDocument(saved.id)).document.sections[0].blocks[0].dataFormats[0].decimals,2);
 await runWithTenant('format-other',async()=>{assert.deepEqual(await repo.listDataFormatPresets(),[]);await assert.rejects(repo.saveDataFormatPreset({name:'foreign',rules:[rule]},preset.id),error=>error.status===404);await assert.rejects(repo.deleteDataFormatPreset(preset.id),error=>error.status===404);});await repo.deleteDataFormatPreset(preset.id);assert.equal((await repo.getDocument(saved.id)).document.sections[0].blocks[0].dataFormats[0].decimals,2);
});
test('format API rejects invalid rules and isolates tenant operations',async t=>{
 const express=require('express'),web=express();web.use(express.json());web.use((req,res,next)=>runWithTenant(req.headers['x-test-tenant']||'default',next));web.use('/api/upload',require('../backend/routes/import-sources'));const server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}/api/upload/monthly-data-format-presets`,options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'API',rules:[rule]})};const response=await fetch(base,options);assert.equal(response.status,200);const saved=await response.json();assert.equal((await (await fetch(base)).json()).length,1);assert.equal((await fetch(base,{...options,body:JSON.stringify({name:'bad',rules:[{...rule,decimals:99}]})})).status,400);assert.equal((await fetch(base+'/'+saved.id,{...options,method:'PUT',headers:{...options.headers,'x-test-tenant':'format-other'}})).status,404);
});

test('numeric choices exclude text-only columns and rows and reject invalid local targets',()=>{const F=formats;
 const tables=[{headers:['客户','金额','比例','备注'],rows:[{客户:'A',金额:0,比例:'25%',备注:'处理中'},{客户:'B',金额:'',比例:'',备注:'无数值'}]}];
 assert.deepEqual(F.numericFields(tables),['金额','比例']);assert.deepEqual(F.numericRowNames(tables,'客户'),['A']);
 const rule={scope:'column',target:'金额',field:'',format:'number',decimals:2,thousands:false,zeroAsBlank:false};assert.doesNotThrow(()=>F.validateContext([rule],tables));
 assert.throws(()=>F.validateContext([{...rule,target:'备注'}],tables),/no numeric values/);assert.throws(()=>F.validateContext([{...rule,scope:'row',field:'客户',target:'B'}],tables),/no numeric values/);
 assert.equal(F.format('处理中',rule),'处理中');assert.equal(F.format('25%',{...rule,format:'percent'}),'25.00%');
});
