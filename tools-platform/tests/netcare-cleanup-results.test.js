const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const dir='backend/builtin-tools/f12-to-extension/',pageCode=require('./helpers/netcare-page');
const packer=fs.readFileSync(dir+'packer-core.js','utf8');
function context(){const ctx=vm.createContext({});vm.runInContext(packer.slice(packer.indexOf('  function netcareAuditStorageTask('),packer.indexOf('  function netcareAuditSummaryBackground(')),ctx);return ctx;}
test('bundle cleanup prunes stale current summaries, keeps cached or protected bundles and respects retention',()=>{
 const ctx=context(),now=Date.now(),records=[{order:'missing',bundleFilename:'a.zip',at:new Date(now-3*86400000).toISOString()},{order:'protected',bundleFilename:'b.zip',at:new Date(now-3*86400000).toISOString()},{order:'recent',bundleFilename:'c.zip',at:new Date(now).toISOString()}],files=[{order:'protected',name:'b.zip'}];
 assert.deepEqual(Array.from(ctx.netcarePruneMissingBundles(records,files,0,now),r=>r.order),['protected']);
 assert.deepEqual(Array.from(ctx.netcarePruneMissingBundles(records,files,1,now),r=>r.order),['protected','recent']);
 assert.equal(records.length,3);
});
test('publishing and cleaning result summaries serialize to avoid overwriting a new audit result',async()=>{
 const ctx=context(),events=[];let release;
 const cleanup=ctx.netcareAuditStorageTask(async()=>{events.push('cleanup starts');await new Promise(r=>release=r);events.push('cleanup finishes');});
 const publish=ctx.netcareAuditStorageTask(async()=>events.push('publish'));
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['cleanup starts']);release();await Promise.all([cleanup,publish]);assert.deepEqual(events,['cleanup starts','cleanup finishes','publish']);
 const failure=ctx.netcareAuditStorageTask(async()=>{throw Error('failed');});await assert.rejects(failure);
 await ctx.netcareAuditStorageTask(async()=>events.push('recovered'));assert.equal(events.at(-1),'recovered');
});
test('remaining summaries cannot claim that an export bundle exists solely because another RFC has a ZIP',()=>{
 const code=fs.readFileSync(dir+'netcare-rfc-word.js','utf8'),ctx={URL,URLSearchParams,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(pageCode,ctx);
 const records=[{order:'a',bundleFilename:'a.zip'},{order:'b',bundleFilename:'b.zip'}];
 assert.deepEqual(Array.from(ctx.netcareAuditMissingBundles(records,[{order:'b',name:'a.zip'},{order:'b',name:'b.zip'}]),r=>r.order),['a']);
 assert.equal(ctx.netcareAuditMissingBundles(records,[{order:'a',name:'a.zip'},{order:'b',name:'b.zip'}]).length,0);
 assert.equal(ctx.netcareAuditMissingBundles([{order:'legacy',wordFilename:'legacy.docx'}],[]).length,1);
});
