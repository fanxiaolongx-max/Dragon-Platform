const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'data-environment-'));process.env.TOOLS_DATA_DIR=dir;process.env.TOOLS_REPORT_DATA_DIR=dir;
const tenant=require('../backend/models/tenant-context'),runtime=require('../backend/models/hosted-apps/runtime'),data=require('../backend/models/hosted-apps/data-api'),env=require('../backend/models/hosted-apps/data-environment'),configRepo=require('../backend/models/digital-human/config-repository'),client=require('../backend/models/digital-human/base-client');
const originalConfig=configRepo.getConfig,originalQuery=client.queryPage,originalSend=client.send;
test.after(async()=>{configRepo.getConfig=originalConfig;client.queryPage=originalQuery;client.send=originalSend;for(const t of ['default','acme'])await data.closeAppDatabase(t,'env-fixture');fs.rmSync(dir,{recursive:true,force:true});});
const apps={};
test('both schemas route together; remote errors never fall back; environment is tenant scoped',async()=>{
 const inspected={files:[['main.py',Buffer.from('app=None')]],config:{entry:'main:app',databaseContract:'digital-human'}};
 configRepo.getConfig=async()=>({enabled:true,businessDatasourceName:'remote-business',appSchema:'remote-schema',appDatasourceId:'2',appUuid:'remote-identity'});
 for(const id of ['default','acme'])await tenant.runWithTenant(id,async()=>{
  const state=runtime.createApp('env-fixture',inspected);apps[id]={slug:'env-fixture',tenantId:id,uuid:state.uuid};
  await data.applyInitSql(id,'env-fixture','CREATE TABLE entries(id INTEGER PRIMARY KEY,value TEXT);');
  await data.execute(apps[id],{datasourceId:'app',sql:"INSERT INTO entries(value) VALUES('local')"});
 });
 const sqlite=require('sqlite3');await new Promise((resolve,reject)=>{const db=new sqlite.Database(path.join(dir,'report.db'));db.exec("CREATE TABLE netcare_rows(id INTEGER,value TEXT);INSERT INTO netcare_rows VALUES(1,'mock');",e=>db.close(()=>e?reject(e):resolve()));});
 const calls=[];client.queryPage=async(sql,o)=>{calls.push(o.scope);return {rows:[{value:'remote'}]};};
 client.send=async(c,o)=>{calls.push('write');assert.equal(o.body.schema,'remote-schema');assert.equal(typeof o.body.sql,'string');return {status:200,json:{code:0,data:{affectedRows:1}}};};
 await tenant.runWithTenant('default',async()=>{
  assert.equal((await data.query(apps.default,{datasourceName:'netcare',sql:'SELECT COUNT(*) AS n FROM clb_major_incidents_sr_dwd'})).rows[0].n,12);
  const a=apps.default,state=runtime.readState(a.slug),at=String(Date.now()),user='admin',role='admin';
  const signature=crypto.createHmac('sha256',state.secret).update(`${user}\n${role}\ndefault\n${at}`).digest('hex');
  const headers={'x-platform-user':user,'x-platform-role':role,'x-platform-tenant':'default','x-platform-timestamp':at,'x-platform-signature':signature};
  await assert.rejects(()=>env.change(a,'remote',{}),/管理员/);
  await env.change(a,'remote',headers);calls.length=0;
  assert.equal((await data.query(a,{datasourceId:'app',sql:'SELECT value FROM entries'})).rows[0].value,'remote');
  await data.query(a,{datasourceName:'netcare',sql:'SELECT 1'});
  await data.execute(a,{datasourceId:'app',sql:"UPDATE entries SET value='remote' WHERE id=1"});
  assert.deepEqual(calls,['app','business','write']);
  client.queryPage=async()=>{throw Error('remote unavailable');};
  await assert.rejects(()=>data.query(a,{datasourceId:'app',sql:'SELECT * FROM entries'}),/remote unavailable/);
  await env.change(a,'local',headers);
  assert.equal((await data.query(a,{datasourceId:'app',sql:'SELECT value FROM entries'})).rows[0].value,'local');
 });
 assert.equal(env.mode(apps.acme),'local');
});
