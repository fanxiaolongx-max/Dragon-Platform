const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monthly-import-range-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'report');
const repo=require('../backend/models/import-source-repository'),db=require('../backend/models/app-db'),{runWithTenant}=require('../backend/models/tenant-context'),range=require('../frontend/js/monthly-designer/import-range');
test.after(async()=>{await db.closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();});
test('discrete stops preserve saved custom ranges and represent all history last',()=>{assert.deepEqual(range.stops(12),[7,12,30,90,180,365,0]);assert.deepEqual(range.stops(0),[7,30,90,180,365,0]);assert.deepEqual(range.stops(36500),[7,30,90,180,365,36500,0]);});
test('metadata counts use import time, include versions, support custom days and isolate tenants',async()=>{
 const batch=await repo.createBatch();for(const age of [1,10,60,200,500]){const file=await repo.saveFile(batch.id,{name:'same.csv',buffer:Buffer.from('data')});await db.run("UPDATE import_source_files SET created_at=datetime('now',?) WHERE id=?",['-'+age+' days',file.id]);}
 assert.deepEqual((await repo.rangeCounts(12)).counts.map(item=>[item.days,item.count]),[[7,1],[30,2],[90,3],[180,3],[365,4],[0,5],[12,2]]);
 await runWithTenant('range-other',async()=>{assert.ok((await repo.rangeCounts()).counts.every(item=>item.count===0));});
});
test('range count API validates input and returns no raw file contents',async t=>{
 const express=require('express'),app=express();app.use('/api/upload',require('../backend/routes/import-sources'));const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});t.after(()=>new Promise(resolve=>server.close(resolve)));const url=`http://127.0.0.1:${server.address().port}/api/upload/source-range-counts`;
 const response=await fetch(url+'?days=12');assert.equal(response.status,200);const data=await response.json();assert.deepEqual(Object.keys(data).sort(),['capturedAt','counts']);assert.equal(data.counts.find(item=>item.days===12).count,2);for(const days of ['-1','1.5','NaN','36501'])assert.equal((await fetch(url+'?days='+days)).status,400);
});
