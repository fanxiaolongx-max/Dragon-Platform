/* Quick rules use the existing SLA preferences store and extraction snapshots. */
const crypto=require('node:crypto');
const {get,run,all}=require('./app-db');
const {getDataDir}=require('./tenant-context');
const pending=new Map();
async function serialize(sourceKey,work){
 const key=JSON.stringify([getDataDir(),sourceKey]),job=(pending.get(key)||Promise.resolve()).catch(()=>{}).then(work);
 pending.set(key,job);try{return await job;}finally{if(pending.get(key)===job)pending.delete(key);}
}
const sources=require('./import-source-repository');
const prefs=require('./sla-prefs-repository');
const extraction=require('../../frontend/js/shared/metric-extraction');
const sourceRules=require('../../frontend/js/monthly-designer/source-rules');
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,status=400)=>{const error=new Error(message);error.status=status;throw error;};
function identity(file,sheetName){return {sourceKey:sourceRules.identity(file.source_key||file.name),sourceKind:file.kind||'original',sheetName};}
function prefKey(source){return 'sla_prefs_monthly_'+hash(source).slice(0,24);}
function normalizeRule(input,headers,sourceSecId){
 if(!input||typeof input!=='object')fail('Invalid extraction rule');
 const text=(value,max)=>{if(typeof value!=='string'||value.length>max)fail('Invalid rule text');return value.trim();};
 const label=text(input.label,160);if(!label)fail('请输入指标名称 / Enter a metric name');
 const colZ=text(input.colZ,2000);if(!headers.includes(colZ))fail('取值列不存在 / Value column not found');
 if(!Array.isArray(input.conditions)||input.conditions.length<1||input.conditions.length>12)fail('请设置 1–12 个条件 / Set 1–12 conditions');
 const conditions=input.conditions.map(item=>{const column=text(item?.column,2000),value=text(item?.value,2000);if(!headers.includes(column)||!value)fail('条件列或条件值无效 / Invalid condition');return {column,value};});
 if(!['and','or'].includes(input.filterLogic)||!['first','sum','avg','min','max','count'].includes(input.aggregation))fail('Invalid calculation method');
 if(typeof input.id!=='string'||!/^m_[\w-]{8,80}$/.test(input.id))fail('Invalid rule ID');
 return {id:input.id,type:'extract_multi',label,colX:conditions[0].column,valY:conditions[0].value,colZ,valK:'',conditions:conditions.slice(1),aggregation:input.aggregation,filterLogic:input.filterLogic,scope:'current',sourceSecId,color:'#2563eb',createdFrom:'monthly-designer'};
}
async function context(sheetId){
 const state=await sources.sheetEditor(sheetId),file=await sources.getFile(state.file.id),source=identity(file,state.table.name),key=prefKey(source);
 return {state,file,source,key};
}
async function createSnapshot(file,table,pref){
 const rules=(pref.customMetrics||[]).filter(rule=>rule&&rule.id),source=pref._sourceMeta.quickMetricSource,secId=pref._sourceMeta.secId;
 if(!rules.length)return;
 const batch=file.batch_id?await get('SELECT * FROM import_source_batches WHERE id=?',[file.batch_id]):null;
 const period=sourceRules.fileMonth(file,{batches:batch?[batch]:[]});
 // A changed rule produces a new result version; saved report references stay frozen.
 const revision=hash([table.headers,table.rows,rules]),snapshotId='quick-'+hash([file.id,source.sheetName]).slice(0,24)+'-'+revision.slice(0,24);
 if(await get('SELECT id FROM import_source_snapshots WHERE id=?',[snapshotId]))return snapshotId;
 const results=rules.map(rule=>{const fields=[rule.colX,rule.colZ,...extraction.conditions(rule).map(item=>item.column)].filter(Boolean),missingColumns=fields.filter(field=>!table.headers.includes(field));return missingColumns.length?{value:'--',indexes:[],matchedCount:0,numericCount:0,missingColumns}:extraction.evaluate(table.rows,rule);});
 const selected=[...new Set(results.flatMap(result=>result.indexes))].sort((a,b)=>a-b),positions=new Map(selected.map((index,pos)=>[index,pos]));
 const topMetrics=rules.map((rule,index)=>({key:secId+'_'+rule.id,label:rule.label,value:results[index].value,color:rule.color||'#2563eb',rule,sourceSection:secId,sourceFiles:[file.name],sourceSelections:[{sectionKey:secId,indexes:results[index].indexes.map(i=>positions.get(i))}],matchedCount:results[index].matchedCount,...(results[index].missingColumns?{missingColumns:results[index].missingColumns}:{})}));
 await sources.registerSnapshot({id:snapshotId,timestamp:new Date().toISOString(),sourceBatchId:file.batch_id||null,selectedTargetMonth:period?Number(period.slice(5)):batch?.target_month,target_period:period,quickMetricFileId:file.id,files:[file.name],topMetrics,sourceSections:[{key:secId,title:pref._sourceMeta.title,headers:table.headers,rows:selected.map(index=>table.rows[index]),sourceFiles:[file.name],rules,sheetName:table.name}]},{allowMissingBatch:true});
 return snapshotId;
}
async function save(sheetId,input){const {key}=await context(sheetId);return serialize(key,()=>saveRule(sheetId,input));}
async function saveRule(sheetId,input){
 const {state,file,source,key}=await context(sheetId);
 if(input?.revision!==state.revision)fail('原始表已更新，请重新打开预览 / Source changed; reopen the preview',409);
 const secId=key.replace(/^sla_prefs_/,''),rule=normalizeRule(input.rule,state.table.headers,secId);
 await prefs.ensureReady();
 let saved;
 // Compare-and-swap appends without overwriting another user's edits to this source.
 for(let attempt=0;attempt<5;attempt++){
  const row=await get('SELECT payload_json FROM sla_prefs WHERE pref_key=?',[key]),old=row?JSON.parse(row.payload_json):{};
  const existing=(old.customMetrics||[]).find(item=>item.id===rule.id);
  if(existing){if(hash(existing)!==hash(rule))fail('规则已存在且已变化，请刷新 / Rule changed; refresh before retrying',409);saved=old;break;}
  if((old.customMetrics||[]).some(item=>item.label===rule.label))fail('此表已有同名指标，请换一个名称 / A metric with this name already exists for this table',409);
  saved={...old,orderedHeaders:state.table.headers,customMetrics:[...(old.customMetrics||[]),rule],_sourceMeta:{...old._sourceMeta,secId,mode:'other',title:file.name+' · '+state.table.name,schemaHash:key,sourceFiles:[file.name],quickMetricSource:source,createdFrom:'monthly-designer'}};
  const payload=JSON.stringify(saved),result=row?await run('UPDATE sla_prefs SET payload_json=?,updated_at=CURRENT_TIMESTAMP WHERE pref_key=? AND payload_json=?',[payload,key,row.payload_json]):await run("INSERT OR IGNORE INTO sla_prefs (pref_key,pref_kind,payload_json) VALUES (?,'schema',?)",[key,payload]);
  if(result.changes)break;
  saved=null;
 }
 if(!saved)fail('规则同时被更新，请重试 / Rules changed concurrently; retry',409);
 const snapshotId=await createSnapshot(file,state.table,saved);
 return {success:true,prefKey:key,rule,metricKey:secId+'_'+rule.id,snapshotId,...extraction.evaluate(state.table.rows,rule),indexes:undefined};
}
async function applyToFile(fileId){
 const file=await sources.getFile(fileId);if(!file||file.parse_status!=='ready')return;
 await prefs.ensureReady();
 const rows=await all("SELECT payload_json FROM sla_prefs WHERE pref_key LIKE 'sla_prefs_monthly_%'");
 for(const row of rows){const pref=JSON.parse(row.payload_json),source=pref?._sourceMeta?.quickMetricSource;if(!source)continue;
  const current=identity(file,source.sheetName);if(hash(current)!==hash(source))continue;
  const sheet=await get('SELECT id FROM import_source_sheets WHERE file_id=? AND name=?',[fileId,source.sheetName]);if(sheet)await serialize(prefKey(source),async()=>{const latest=await get('SELECT payload_json FROM sla_prefs WHERE pref_key=?',[prefKey(source)]);if(latest)await createSnapshot(file,await sources.getSheet(sheet.id),JSON.parse(latest.payload_json));});
 }
}
module.exports={save,applyToFile,normalizeRule,identity};
