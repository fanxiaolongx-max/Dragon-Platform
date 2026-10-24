const crypto=require('node:crypto');
const {run,get}=require('./app-db');
const {getDataDir}=require('./tenant-context');
const rules=require('../../frontend/js/monthly-designer/table-presentation');
const ready=new Map();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,code:'SOURCE_PRESENTATION_ERROR'});};
async function ensureReady(){
 const key=getDataDir();
 if(!ready.has(key))ready.set(key,run('CREATE TABLE IF NOT EXISTS source_presentation_rules (source_key TEXT PRIMARY KEY, rules_json TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL)').catch(error=>{ready.delete(key);throw error;}));
 await ready.get(key);
}
async function identity(sheetId){
 const repo=require('./import-source-repository');await repo.ensureReady();
 // Archived sheet identity needs no original blob or worksheet rows.
 let sheet=await get('SELECT file_id AS fileId,name FROM import_source_sheets WHERE id=?',[sheetId]);
 if(!sheet&&/^(ms|ts)-/.test(String(sheetId)))sheet=await repo.getSheet(sheetId);
 if(!sheet)fail('Worksheet not found',404);
 const file=await repo.getFile(sheet.fileId);if(!file)fail('Source file not found',404);
 const key=rules.scope(file,sheet.name);if(key.length>4500)fail('Invalid source identity');
 return {key,sheetName:sheet.name,fileId:sheet.fileId};
}
async function read(sheetId){
 const source=await identity(sheetId);await ensureReady();
 const row=await get('SELECT rules_json,revision,updated_at FROM source_presentation_rules WHERE source_key=?',[source.key]);
 return {...source,rules:row?JSON.parse(row.rules_json):rules.empty(),revision:row?.revision||'',updatedAt:row?.updated_at||null};
}
async function save(sheetId,input){
 let value;try{value=rules.validate(input?.rules);}catch(error){fail(error.message);}
 if(typeof input.revision!=='string'||input.revision.length>80)fail('Invalid presentation revision');
 const source=await identity(sheetId);await ensureReady();
 const revision=crypto.randomUUID(),now=new Date().toISOString(),json=JSON.stringify(value);
 const result=input.revision?await run('UPDATE source_presentation_rules SET rules_json=?,revision=?,updated_at=? WHERE source_key=? AND revision=?',[json,revision,now,source.key,input.revision]):await run('INSERT OR IGNORE INTO source_presentation_rules (source_key,rules_json,revision,updated_at) VALUES (?,?,?,?)',[source.key,json,revision,now]);
 if(!result.changes)fail('Display rules changed. Reload the latest rules before editing.',409);
 return {...source,rules:value,revision,updatedAt:now};
}
module.exports={read,save,ensureReady};
