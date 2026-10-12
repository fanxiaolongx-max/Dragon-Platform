const {Worker}=require('node:worker_threads'),path=require('node:path'),crypto=require('node:crypto');
const {get,all}=require('./app-db'),{getDataDir}=require('./tenant-context');
const sessions=new Map(),starts=new Map(),operations=new Set();const MAX_SESSIONS=2,TTL=120000,MAX_ORIGINAL_BYTES=16*1024*1024,MAX_TABLE_BYTES=64*1024*1024;
function fail(message,status=400,code='SOURCE_SEARCH_ERROR'){const error=new Error(message);Object.assign(error,{status,code});throw error;}
function close(session){session.cancelled=true;clearTimeout(session.timer);sessions.delete(session.id);session.reject?.(Object.assign(new Error('Search cancelled'),{name:'AbortError'}));session.worker?.terminate().catch(()=>{});}
function workerCall(session,message){
 if(session.cancelled)throw Object.assign(new Error('Search cancelled'),{name:'AbortError'});
 if(!session.worker){const worker=session.worker=new Worker(path.join(__dirname,'../workers/source-content-search-worker.js'),{resourceLimits:{maxOldGenerationSizeMb:256}});worker.unref();worker.on('error',()=>{if(session.worker!==worker)return;session.reject?.(new Error('Search worker failed'));session.worker=null;});worker.on('exit',()=>{if(session.worker===worker){session.reject?.(new Error('Search worker stopped'));session.worker=null;}});}
 const worker=session.worker;
 return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),timer=setTimeout(()=>{worker.terminate().catch(()=>{});finish(new Error('Search step timed out'));},6000);const finish=(error,result)=>{clearTimeout(timer);worker.removeListener('message',receive);session.reject=null;error?reject(error):resolve(result);};const receive=result=>{if(result.id===id)finish(result.error?new Error(result.error):null,result);};session.reject=error=>finish(error);worker.on('message',receive);worker.postMessage({...message,id});});
}
async function prepareFile(session){
 const repo=require('./import-source-repository'),id=session.files[session.fileIndex];if(id.startsWith('ms-')||id.startsWith('ts-')){
  const meeting=id.startsWith('ms-'),provider=require(meeting?'./meeting-source-tables':'./topic-source-tables'),parsed=provider.parseId(id);if(!parsed||parsed.index!==null)return null;
  const stamp=await get(meeting?'SELECT id,updated_at FROM meeting_attendance_snapshots WHERE id=?':'SELECT id,updated_at FROM topic_snapshots WHERE id=?',[parsed.snapshotId]);if(!stamp)return null;const snapshotKey=JSON.stringify([meeting,stamp.id,stamp.updated_at]);
  const row=session.snapshotCache?.key===snapshotKey?session.snapshotCache.row:await get(meeting?'SELECT id,title,meeting_date,created_at,updated_at,summary_json,CASE WHEN length(CAST(payload_json AS BLOB))<=? THEN payload_json END AS payload_json FROM meeting_attendance_snapshots WHERE id=?':'SELECT id,name,platform,captured_at,exported_at,imported_at,created_at,updated_at,summary_json,period_label,payload_bytes,CASE WHEN length(CAST(payload_json AS BLOB))<=? THEN payload_json END AS payload_json FROM topic_snapshots WHERE id=?',[MAX_TABLE_BYTES,parsed.snapshotId]);
  if(!row)return null;if(!row.payload_json){session.warnings.push({fileId:id,code:'TABLE_TOO_LARGE'});return null;}
  const source=await workerCall(session,{type:'virtual-meta',virtualType:meeting?'meeting':'topic',parsed,cacheKey:snapshotKey,row:session.worker&&session.virtualWorkerCacheKey===snapshotKey?{...row,payload_json:undefined}:row});session.snapshotCache={key:snapshotKey,row};session.virtualWorkerCacheKey=snapshotKey;if(!source.file)return null;return {...source,rules:(await repo.getTableRules(source.file,{legacy:false})).rules,physical:null};
 }session.snapshotCache=null;session.virtualWorkerCacheKey=null;const file=await repo.getFile(id);if(!file)return null;
 const physical=await get('SELECT id,length(original_blob) AS bytes FROM import_source_files WHERE id=?',[id]);
 const sheets=physical?await all('SELECT id,name FROM import_source_sheets WHERE file_id=? ORDER BY rowid',[id]):file.sheets||[];
 const rules=(await repo.getTableRules(file,{legacy:false})).rules;
 return {file,sheets,rules,physical,originalSent:false};
}
async function loadTable(session){
 const repo=require('./import-source-repository');if(!session.file)session.file=await prepareFile(session);const source=session.file;
 if(!source||!source.sheets.length)return false;const sheet=source.sheets[session.sheetIndex];if(!sheet)return false;
 let table,original;
 if(source.physical){
  const meta=await get('SELECT name,headers_json FROM import_source_sheets WHERE id=?',[sheet.id]);if(!meta)return false;const probe=await workerCall(session,{type:'probe',name:meta.name,headers:meta.headers_json,query:session.query});if(probe.hit)return {hit:probe.hit};
  const size=await get('SELECT length(CAST(headers_json AS BLOB))+length(CAST(rows_json AS BLOB)) AS bytes FROM import_source_sheets WHERE id=?',[sheet.id]);if(!size||size.bytes>MAX_TABLE_BYTES){session.warnings.push({fileId:source.file.id,code:'TABLE_TOO_LARGE'});return false;}
  table=await get('SELECT name,headers_json AS headers,rows_json AS rows FROM import_source_sheets WHERE id=?',[sheet.id]);
  if(!source.originalSent){source.originalSent=true;if(source.physical.bytes<=MAX_ORIGINAL_BYTES)original=(await get('SELECT original_blob FROM import_source_files WHERE id=?',[source.file.id])).original_blob;else session.warnings.push({fileId:source.file.id,code:'ORIGINAL_TOO_LARGE'});}
 }else{const loaded=await workerCall(session,{type:'virtual-load',fileId:source.file.id,sheetId:sheet.id,query:session.query,rules:source.rules});if(loaded.tooLarge){session.warnings.push({fileId:source.file.id,code:'TABLE_TOO_LARGE'});return false;}if(!loaded.loaded)return false;session.loaded=true;return true;}
 let loaded;const message={type:'load',fileId:source.file.id,sheetIndex:session.sheetIndex,query:session.query,...table,original,rules:source.rules};
 try{loaded=await workerCall(session,message);}catch(error){if(error.name==='AbortError'||!original)throw error;session.worker?.terminate().catch(()=>{});session.worker=null;session.warnings.push({fileId:source.file.id,code:'ORIGINAL_SEARCH_FAILED'});loaded=await workerCall(session,{...message,original:undefined});}
 if(loaded.originalError)session.warnings.push({fileId:source.file.id,code:loaded.originalError==='ORIGINAL_ARCHIVE_LIMIT'?'ORIGINAL_ARCHIVE_LIMIT':'ORIGINAL_PARSE_FAILED'});session.loaded=true;return true;
}
function advance(session,file=false){session.loaded=false;session.sheetIndex++;if(file||!session.file||session.sheetIndex>=session.file.sheets.length){session.fileIndex++;session.sheetIndex=0;session.file=null;}}
async function performSearch(input,owner,signal){
 const tenant=getDataDir(),now=Date.now();for(const item of sessions.values())if(now-item.lastAt>TTL)close(item);
 let session;
 if(input.cursor){if(typeof input.cursor!=='string'||input.cursor.length>80)fail('Invalid search cursor');session=sessions.get(input.cursor);if(input.cancel==='1'){if(session&&session.tenant===tenant&&session.owner===owner)close(session);return {cancelled:true};}if(!session||session.tenant!==tenant||session.owner!==owner)fail('Search expired; start again',410,'SOURCE_SEARCH_EXPIRED');}
 else{
  const query=String(input.q||'').trim();if([...query].length<1||query.length>120)fail('Search needs 1–120 characters');let files;try{files=JSON.parse(input.files||'');}catch(_){fail('Invalid search scope');}
  if(!Array.isArray(files)||!files.length||files.length>128||JSON.stringify(files).length>6000||files.some(id=>typeof id!=='string'||!id||id.length>500))fail('Search scope must contain up to 128 file IDs');
  const startKey=tenant+'|'+owner;for(const [key,time] of starts)if(now-time>TTL)starts.delete(key);if(now-(starts.get(startKey)||0)<400)fail('Please wait before starting another search',429,'SOURCE_SEARCH_BUSY');starts.set(startKey,now);
  for(const item of sessions.values())if(item.tenant===tenant&&item.owner===owner)close(item);
  await require('./import-source-repository').ensureReady();if(sessions.size>=MAX_SESSIONS)fail('Deep search is busy; retry shortly',429,'SOURCE_SEARCH_BUSY');session={id:crypto.randomUUID(),tenant,owner,query,files:[...new Set(files)],fileIndex:0,sheetIndex:0,file:null,loaded:false,lastAt:0,warnings:[],scannedRows:0};sessions.set(session.id,session);
 }
 if(session.busy||Date.now()-session.lastAt<180)fail('Please wait before loading more',429,'SOURCE_SEARCH_BUSY');session.busy=true;session.lastAt=Date.now();const abort=()=>close(session);signal?.addEventListener('abort',abort,{once:true});
 const results=[],warningStart=session.warnings.length,started=Date.now(),rowStart=session.scannedRows;
 try{
  for(let steps=0;steps<32&&results.length<6&&session.scannedRows-rowStart<48000&&Date.now()-started<650&&session.fileIndex<session.files.length;steps++){
   if(signal?.aborted)throw Object.assign(new Error('Search cancelled'),{name:'AbortError'});
   try{
    if(!session.loaded){const loaded=await loadTable(session);if(loaded?.hit){results.push({fileId:session.files[session.fileIndex],sheetId:session.file.sheets[session.sheetIndex].id,...loaded.hit});advance(session,true);continue;}if(!loaded){if(session.file&&!session.file.sheets.length)session.warnings.push({fileId:session.files[session.fileIndex],code:'NO_PARSED_SHEETS'});advance(session);continue;}}
    const result=await workerCall(session,{type:'scan'});session.scannedRows+=result.scannedRows;
    if(result.hit){results.push({fileId:session.files[session.fileIndex],sheetId:session.file.sheets[session.sheetIndex].id,...result.hit});advance(session,true);}
    else if(result.done)advance(session);
   }catch(error){if(error.name==='AbortError')throw error;session.warnings.push({fileId:session.files[session.fileIndex],code:'TABLE_SEARCH_FAILED'});session.worker?.terminate().catch(()=>{});session.worker=null;advance(session,true);}
  }
  const done=session.fileIndex>=session.files.length,result={results,cursor:done?null:session.id,done,scannedFiles:session.fileIndex,totalFiles:session.files.length,scannedRows:session.scannedRows,warnings:session.warnings.slice(warningStart)};if(done)close(session);return result;
 }catch(error){if(error.name==='AbortError')close(session);throw error;}finally{session.busy=false;signal?.removeEventListener('abort',abort);if(sessions.has(session.id)){clearTimeout(session.timer);session.timer=setTimeout(()=>close(session),TTL);session.timer.unref();}}
}
function search(...args){const operation=performSearch(...args);operations.add(operation);operation.then(()=>operations.delete(operation),()=>operations.delete(operation));return operation;}
module.exports={search,closeAll:async()=>{for(const item of sessions.values())close(item);starts.clear();await Promise.allSettled([...operations]);}};
