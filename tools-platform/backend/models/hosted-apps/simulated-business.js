// Synthetic rows only. Never copies tenant business records or mutates their report.db.
const fs=require('fs'),path=require('path'),sqlite=require('sqlite3');
const tenant=require('../tenant-context');
const schema=require('./simulation-schema.json');
const pending=new Map(),q=s=>'"'+String(s).replace(/"/g,'""')+'"';
function ensure(tenantId){
 const file=path.join(tenant.getDataDir(tenantId),'hosted-simulated-business.db');
 if(!pending.has(file))pending.set(file,(async()=>{
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=await new Promise((resolve,reject)=>{const d=new sqlite.Database(file,e=>e?reject(e):resolve(d));});
  const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
  const get=sql=>new Promise((resolve,reject)=>db.get(sql,(e,r)=>e?reject(e):resolve(r)));
  try{
   await run('BEGIN IMMEDIATE');
   for(const [name,columns]of Object.entries(schema.tables)){
    await run(`CREATE TABLE IF NOT EXISTS ${q(name)} (${columns.map(c=>q(c.name)+' '+(/^[a-z0-9_(), ]+$/i.test(c.type)?c.type:'TEXT')).join(',')})`);
    if((await get(`SELECT COUNT(*) AS n FROM ${q(name)}`)).n)continue;
    for(let offset=0;offset<3;offset++)for(let operator=0;operator<4;operator++){
     const date=new Date();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-offset);
     const month=date.toISOString().slice(0,7);
     const values=columns.map(c=>{
      const n=c.name.toLowerCase();
      if(/month|period/.test(n))return /code|yyyymm/.test(n)?month.replace('-',''):month;
      if(/date|time/.test(n))return month+'-01 00:00:00';
      if(/operator|carrier/.test(n))return ['TE','ORG','ET','VDF'][operator];
      if(/int|real|numeric|decimal|double|float/i.test(c.type))return operator+1+offset*4;
      if(/(^id$|_id$)/.test(n))return String(operator+1+offset*4);
      return '模拟-'+(operator+1);
     });
     await run(`INSERT INTO ${q(name)} VALUES (${columns.map(()=>'?').join(',')})`,values);
    }
   }
   await run('COMMIT');
  }catch(e){await run('ROLLBACK').catch(()=>{});throw e;}
  finally{await new Promise(resolve=>db.close(resolve));}
  return file;
 })().catch(e=>{pending.delete(file);throw e;}));
 return pending.get(file);
}
module.exports={ensure};
