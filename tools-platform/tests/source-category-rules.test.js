const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'category-rules-'));
process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const rules=require('../frontend/js/monthly-designer/source-category-rules'),view=require('../frontend/js/monthly-designer/catalog-view');
const repo=require('../backend/models/import-source-repository'),categories=require('../backend/models/source-category-repository'),db=require('../backend/models/app-db'),pool=require('../backend/models/tenant-sqlite-pool'),{runWithTenant}=require('../backend/models/tenant-context');
test.after(async()=>{await db.closeDatabase();await pool.closeAll();fs.rmSync(temp,{recursive:true,force:true});});
const create=async(name,kind='original')=>{const batch=await repo.createBatch();const file=await repo.saveFile(batch.id,{name,buffer:Buffer.from('name,value\nA,1')},kind);await repo.saveSheets(file.id,[{name:'Sheet1',headers:['name','value'],rows:[{name:'A',value:1}]}]);return file;};
test('only the redline statistics family receives the built-in exception',()=>{
 for(const name of ['PBI_自动抓取-红线人员工单统计_维护红线资源_Latest.csv','红线人员工单统计_维护红线资源_2026年09月.xlsx','红线人员工单统计.csv']){assert.equal(view.fileCategory({name}),'metrics');assert.equal(view.isExpiringTicketFile({name}),false);}
 for(const name of ['人员工单.csv','红线人员工单统计_其它资源.csv','巡检详单.csv'])assert.equal(view.fileCategory({name}),'tickets');
 assert.equal(rules.category({name:'普通.csv',metricLabels:['指标']}),'metrics');assert.equal(rules.category({name:'普通.csv'}),'raw');
 assert.equal(rules.category({name:'人员工单.csv',library_category:'raw'}),'raw');
});
test('stable identities join original and structured copies across months without collapsing different qualifiers or virtual kinds',()=>{
 const original=rules.identity({name:'PBI_自动抓取-人员工单_Latest_2026年09月.csv',kind:'original'});
 assert.deepEqual(rules.identity({name:'人员工单_2026-10.xlsx',kind:'structured'}),original);
 assert.deepEqual(rules.identity({name:'人员工单_2026年10月 (1).csv'}),original);
 assert.notEqual(rules.identity({name:'人员工单_Latest_CN.csv'}).key,rules.identity({name:'人员工单_Latest_Global.csv'}).key);
 assert.notEqual(rules.identity({name:'人员工单_其它资源.csv'}).key,original.key);
 assert.equal(rules.identity({name:'快照一',source_key:'会议考勤:online',kind:'meeting_attendance'}).key,rules.identity({name:'快照二',source_key:'会议考勤:online',kind:'meeting_attendance'}).key);
 assert.notEqual(rules.identity({name:'快照',source_key:'会议考勤:online',kind:'topic_monthly'}).key,rules.identity({name:'快照',source_key:'会议考勤:online',kind:'meeting_attendance'}).key);
});
test('corrections persist in tenant SQLite, apply to future imports, restore defaults and never change original rows',async()=>{
 const red=await create('PBI_自动抓取-红线人员工单统计_维护红线资源_Latest.csv');
 assert.equal((await repo.catalog({stage:'core'})).files.find(f=>f.id===red.id).library_category_rule.mode,'builtin');
 const file=await create('人员工单_2026年09月.csv');await categories.save(file.id,'metrics');
 const future=await create('PBI_自动抓取-人员工单_Latest_2026年10月.csv','structured'),other=await create('人员工单_其它资源.csv');
 let catalog=await repo.catalog({stage:'core'});
 for(const id of [file.id,future.id]){const f=catalog.files.find(f=>f.id===id);assert.equal(f.library_category,'metrics');assert.equal(f.library_category_rule.mode,'manual');}
 assert.equal(rules.category(catalog.files.find(f=>f.id===other.id)),'tickets');
 assert.equal((await repo.getFile(file.id,true)).original_blob.toString(),'name,value\nA,1');
 await runWithTenant('category-other',async()=>{const own=await create(file.name);assert.equal(rules.category((await repo.catalog({stage:'core'})).files[0]),'tickets');await assert.rejects(categories.save(file.id,'raw'),e=>e.status===404);await categories.save(own.id,'raw');});
 assert.equal((await repo.catalog({stage:'core'})).files.find(f=>f.id===file.id).library_category,'metrics');
 await categories.save(file.id,null);catalog=await repo.catalog({stage:'core'});assert.equal(rules.category(catalog.files.find(f=>f.id===future.id)),'tickets');
 await categories.save(red.id,'raw');assert.equal((await repo.catalog({stage:'core'})).files.find(f=>f.id===red.id).library_category,'raw');await categories.save(red.id,null);assert.equal((await repo.catalog({stage:'core'})).files.find(f=>f.id===red.id).library_category,'metrics');
 await assert.rejects(categories.save(file.id,'invalid'),e=>e.status===400);await assert.rejects(categories.save(file.id,undefined),e=>e.status===400);
});
test('category API enforces administrator permissions and tenant boundaries',async t=>{
 const express=require('express'),web=express();web.use(express.json());web.use((req,res,next)=>{req.user={role:req.headers['x-role']||'user'};runWithTenant(req.headers['x-tenant']||'default',next);});web.use('/api/upload',require('../backend/routes/import-sources'));
 const server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s));});t.after(()=>new Promise(r=>server.close(r)));const file=await create('API 工单.csv'),base=`http://127.0.0.1:${server.address().port}/api/upload/source-files/${file.id}/category`;
 const put=(body,headers={})=>fetch(base,{method:'PUT',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await put({category:'raw'})).status,403);assert.equal((await put({category:'raw'},{'x-role':'admin','x-tenant':'category-other'})).status,404);assert.equal((await put({category:'invalid'},{'x-role':'admin'})).status,400);assert.equal((await put({category:'raw'},{'x-role':'admin'})).status,200);assert.equal((await put({category:null},{'x-role':'admin'})).status,200);
});
