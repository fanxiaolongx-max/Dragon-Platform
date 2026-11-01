// One route for both schemas. Configuration stays tenant-scoped and credentials never reach the browser.
const crypto=require('crypto');
const runtime=require('./runtime');
const tenant=require('../tenant-context');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
function mode(app){return runtime.readState(app.slug,app.tenantId)?.dataEnvironment==='remote'?'remote':'local';}
async function remoteConfig(){
 const config=await require('../digital-human/config-repository').getConfig();
 if(!config?.enabled)throw fail('未对接数字人基座：请先在「全局设置 › 频道对接 › 数字人」配置并启用');
 const missing=[];
 if(!config.businessDatasourceName)missing.push('业务库');
 if(!config.appSchema)missing.push('应用 Schema');
 if(!config.appDatasourceId||!config.appUuid)missing.push('应用身份');
 if(missing.length)throw fail(`数字人基座配置未完善（缺少 ${missing.join('、')}）：请在「全局设置 › 频道对接 › 数字人」完成配置`);
 return config;
}
async function describe(app){
 let remoteReady=false,remoteReason='';
 try{await remoteConfig();remoteReady=true;}catch(err){remoteReason=err.message||'未对接数字人基座';}
 return {revision:runtime.readState(app.slug,app.tenantId)?.dataEnvironmentRevision||0,mode:mode(app),switchable:true,remoteReady,remoteReason,local:{application:'app',business:'netcare',storage:'tenant',schemaFidelity:'441 表、12105 字段的本地结构快照；未与远端 DDL 逐字段核对'},remote:{configured:remoteReady,reason:remoteReason}};
}
function assertAdmin(app,headers){
 const user=String(headers['x-platform-user']||''),role=String(headers['x-platform-role']||''),id=String(headers['x-platform-tenant']||''),at=String(headers['x-platform-timestamp']||''),sig=String(headers['x-platform-signature']||'');
 const state=runtime.readState(app.slug,app.tenantId);
 const expected=crypto.createHmac('sha256',state.secret).update(`${user}\n${role}\n${id}\n${at}`).digest('hex');
 if(role!=='admin'||id!==app.tenantId||!at||!Number.isFinite(Number(at))||Math.abs(Date.now()-Number(at))>60000||!/^[a-f0-9]{64}$/.test(sig)||sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw fail('切换数据环境需要平台管理员身份',403);
}
async function change(app,value,headers,request){
 assertAdmin(app,headers);
 if(!['local','remote'].includes(value))throw fail('无效的数据环境',400);
 if(value==='remote'){
  const config=await remoteConfig();const client=require('../digital-human/base-client');
  await client.queryPage('SELECT 1 AS ok',{scope:'app',config,limit:1});
  await client.queryPage('SELECT 1 AS ok',{scope:'business',config,limit:1});
 }
 if(request?.aborted)throw fail('切换请求已断开，未更改环境',499);
 tenant.runWithTenant(app.tenantId,()=>runtime.updateState(app.slug,{dataEnvironment:value,dataEnvironmentRevision:(runtime.readState(app.slug,app.tenantId)?.dataEnvironmentRevision||0)+1}));
 return describe(app);
}
module.exports={mode,remoteConfig,describe,change};
