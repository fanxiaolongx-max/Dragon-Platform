const crypto = require('node:crypto');
const path = require('node:path');
const { run, get, all } = require('./app-db');
const { getDataDir } = require('./tenant-context');
const { getConnection } = require('./tenant-sqlite-pool');
const {linkMetric,resolveMetricSource}=require('./import-metric-lineage');
const ready = new Map();
const id = () => crypto.randomUUID();
const json = value => JSON.stringify(value);
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function normalizeFileName(value) {
    const name=String(value || '');
    if (!/[^\x00-\x7f]/.test(name) || [...name].some(char=>char.codePointAt(0)>255)) return name;
    const bytes=Buffer.from(name,'latin1');const decoded=bytes.toString('utf8');
    return !decoded.includes('\ufffd') && Buffer.from(decoded,'utf8').equals(bytes) ? decoded : name;
}
async function ensureReady() {
    const key = getDataDir();
    if (!ready.has(key)) ready.set(key, (async () => {
        await run(`CREATE TABLE IF NOT EXISTS import_source_batches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT NOT NULL, target_month INTEGER)`);
        await run(`CREATE TABLE IF NOT EXISTS import_source_files (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_source_batches(id), name TEXT NOT NULL, source_key TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, original_blob BLOB NOT NULL, parse_status TEXT NOT NULL DEFAULT 'pending', parse_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS import_source_sheets (id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES import_source_files(id), name TEXT NOT NULL, headers_json TEXT NOT NULL, rows_json TEXT NOT NULL, row_count INTEGER NOT NULL, UNIQUE(file_id,name))`);
        await run(`CREATE TABLE IF NOT EXISTS import_source_snapshots (id TEXT PRIMARY KEY, batch_id TEXT REFERENCES import_source_batches(id), captured_at TEXT NOT NULL, target_month INTEGER, payload_json TEXT NOT NULL)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_import_source_files_batch ON import_source_files(batch_id,created_at)`);
        await run(`CREATE INDEX IF NOT EXISTS idx_import_source_snapshot_time ON import_source_snapshots(captured_at)`);
        await run(`CREATE TABLE IF NOT EXISTS monthly_logos (id TEXT PRIMARY KEY, name TEXT NOT NULL, image_blob BLOB NOT NULL, created_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS monthly_data_format_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, rules_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS monthly_mapping_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, rules_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS monthly_component_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, rules_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS monthly_documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS import_source_settings (id INTEGER PRIMARY KEY CHECK(id=1), upload_originals INTEGER NOT NULL DEFAULT 1 CHECK(upload_originals IN (0,1)))`);
        await run(`CREATE TABLE IF NOT EXISTS source_table_rules (type_key TEXT PRIMARY KEY, rules_json TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    })().catch(error => { ready.delete(key); throw error; }));
    await ready.get(key);
}
function sourceKey(name) { return name.replace(/\.[^.]+$/, '').replace(/(Latest).*/i, '$1').replace(/\s*\(\d+\)$/, '').replace(/20\d{2}[-_]\d{2}[-_]\d{2}/g, '{date}'); }
async function getImportSettings() {
    await ensureReady();
    const row = await get('SELECT upload_originals FROM import_source_settings WHERE id=1');
    return { uploadOriginals: row ? row.upload_originals === 1 : true };
}
async function saveImportSettings(settings) {
    if (typeof settings?.uploadOriginals !== 'boolean') fail('uploadOriginals must be a boolean');
    await ensureReady();
    await run('INSERT INTO import_source_settings (id,upload_originals) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET upload_originals=excluded.upload_originals', [settings.uploadOriginals ? 1 : 0]);
    return getImportSettings();
}
async function requireOriginalUploads() {
    if (!(await getImportSettings()).uploadOriginals) fail('Original data uploads are disabled in Data Import settings', 409);
}
async function createBatch({ source = 'manual', targetMonth } = {}) {
    await requireOriginalUploads();
    await ensureReady(); const batch = { id:id(), createdAt:new Date().toISOString(), source:String(source).slice(0,60), targetMonth:Number(targetMonth) || null };
    if (batch.targetMonth && (!Number.isInteger(batch.targetMonth) || batch.targetMonth < 1 || batch.targetMonth > 12)) fail('Invalid target month');
    await run('INSERT INTO import_source_batches (id,created_at,source,target_month) VALUES (?,?,?,?)', [batch.id,batch.createdAt,batch.source,batch.targetMonth]);
    return batch;
}
async function saveFile(batchId, file, kind = 'original') {
    await requireOriginalUploads();
    await ensureReady(); if (!await get('SELECT id FROM import_source_batches WHERE id=?',[batchId])) fail('Import batch not found',404);
    const name = path.basename((file.originalName ? String(file.originalName) : normalizeFileName(file.originalname || file.name || 'table.csv')).replace(/\\/g,'/')).slice(0,200);
    if (!/\.(csv|xlsx|xls)$/i.test(name)) fail('Only CSV/XLS/XLSX tables are supported');
    const buffer = file.buffer; if (!Buffer.isBuffer(buffer)) fail('Original file is missing');
    const item = {id:id(),batchId,name,sourceKey:sourceKey(name),kind,size:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),createdAt:new Date().toISOString()};
    await run(`INSERT INTO import_source_files (id,batch_id,name,source_key,kind,size,sha256,original_blob,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,[item.id,batchId,name,item.sourceKey,kind,item.size,item.sha256,buffer,item.createdAt]);
    return item;
}
function validateSheets(sheets) {
    if (!Array.isArray(sheets) || sheets.length > 200) fail('Invalid worksheets');
    const names = new Set();
    return sheets.map(sheet => {
        if (!sheet || typeof sheet.name !== 'string' || !sheet.name || sheet.name.length > 200 || names.has(sheet.name) || !Array.isArray(sheet.headers) || sheet.headers.length > 2000 || sheet.headers.some(v => typeof v !== 'string' || v.length > 2000) || !Array.isArray(sheet.rows)) fail('Invalid worksheet');
        names.add(sheet.name);
        if (sheet.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('Invalid table rows');
        return sheet;
    });
}
async function saveSheets(fileId, sheets, parseError = '') {
    await ensureReady(); if (!await get('SELECT id FROM import_source_files WHERE id=?',[fileId])) fail('Source file not found',404);
    const valid = validateSheets(sheets);
    const file=await getFile(fileId),rules=await getTableRules(file);
    // Sheets are immutable after successful parsing; a retry may safely repeat the request.
    const current = await get('SELECT parse_status FROM import_source_files WHERE id=?',[fileId]);
    if (current.parse_status === 'ready') return;
    const transformed=valid.map(sheet=>tableRules.apply(sheet,rules.rules));
    for (const sheet of transformed) await run(`INSERT INTO import_source_sheets (id,file_id,name,headers_json,rows_json,row_count) VALUES (?,?,?,?,?,?) ON CONFLICT(file_id,name) DO UPDATE SET headers_json=excluded.headers_json,rows_json=excluded.rows_json,row_count=excluded.row_count`,[id(),fileId,sheet.name,json(sheet.headers),json(sheet.rows),sheet.rows.length]);
    await run('UPDATE import_source_files SET parse_status=?, parse_error=? WHERE id=?',[parseError?'error':'ready',String(parseError).slice(0,500),fileId]);
}
async function getFile(fileId, original = false) {
    if(String(fileId).startsWith('ms-'))return require('./meeting-source-tables').getFile(fileId,original);
    if(String(fileId).startsWith('ts-'))return require('./topic-source-tables').getFile(fileId,original);
    await ensureReady(); const file=await get(`SELECT id,batch_id,name,source_key,kind,size,sha256,parse_status,parse_error${original?',original_blob':''} FROM import_source_files WHERE id=?`,[fileId]);
    return file ? {...file,name:normalizeFileName(file.name),source_key:normalizeFileName(file.source_key)} : file;
}
async function registerSnapshot(snapshot, { allowMissingBatch = false } = {}) {
    await ensureReady();
    let batchId = snapshot.sourceBatchId || null;
    if (batchId && !await get('SELECT id FROM import_source_batches WHERE id=?',[batchId])) {
        if (!allowMissingBatch) fail('Snapshot import batch not found in this tenant');
        batchId = null; // A report-only restore may contain metrics without the original archive.
    }
    const files = batchId ? (await all('SELECT id,name FROM import_source_files WHERE batch_id=?',[batchId])).map(file=>({...file,name:normalizeFileName(file.name)})) : [];
    const sourceSections = (Array.isArray(snapshot.sourceSections) ? snapshot.sourceSections : []).map(section => ({ ...section, fileIds:files.filter(file => (section.sourceFiles || []).includes(file.name)).map(file => file.id) }));
    const metrics = (Array.isArray(snapshot.topMetrics)?snapshot.topMetrics:[]).map((metric,index) => linkMetric({...metric,key:metric.key || `legacy:${metric.label || index}`},sourceSections,files,snapshot.files||[],normalizeFileName));
    const payload = { id:snapshot.id, timestamp:snapshot.timestamp, sourceBatchId:batchId, files:snapshot.files || [], topMetrics:metrics, sourceSections, expiringTickets:snapshot.expiringTickets || [] };
    await run(`INSERT INTO import_source_snapshots (id,batch_id,captured_at,target_month,payload_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET batch_id=excluded.batch_id,captured_at=excluded.captured_at,target_month=excluded.target_month,payload_json=excluded.payload_json`,[snapshot.id,batchId,snapshot.timestamp || new Date().toISOString(),snapshot.selectedTargetMonth || null,json(payload)]);
    return payload;
}
async function catalog(options = {}) {
    // Virtual directories can be requested independently; a slow source must not hold originals.
    if(['topic','meeting'].includes(options.stage)){
        const started=Date.now(),result=await require('./'+(options.stage==='topic'?'topic':'meeting')+'-source-tables').catalog(options);
        return require('./source-category-repository').annotate({...result,snapshots:[],diagnostics:{stages:[{stage:options.stage,count:result.files.length,durationMs:Date.now()-started}],errors:result.errors||[]}});
    }
    const since=options.since||null,params=since?[since]:[],where=column=>since?` WHERE julianday(${column}) >= julianday(?)`:"";
    const errors=[],stages=[],started=Date.now();let stageStart=started;const mark=(stage,count)=>{stages.push({stage,count,durationMs:Date.now()-stageStart});stageStart=Date.now();};
    await ensureReady();
    const batches = await all(`SELECT id,created_at,source,target_month FROM import_source_batches${where('created_at')} ORDER BY created_at DESC,rowid DESC`,params);
    const files = (await all(`SELECT id,batch_id,name,source_key,kind,size,sha256,parse_status,parse_error,created_at FROM import_source_files${where('created_at')} ORDER BY created_at DESC,rowid DESC`,params)).map(file=>({...file,name:normalizeFileName(file.name),source_key:normalizeFileName(file.source_key),source_key_aliases:[file.source_key]}));
    const sheets = await all(`SELECT id,file_id,name,headers_json,row_count FROM import_source_sheets${since?' WHERE file_id IN (SELECT id FROM import_source_files'+where('created_at')+')':''} ORDER BY rowid`,params);mark('originals',files.length);
    const snapshots = await all(`SELECT id,batch_id,captured_at,target_month,payload_json FROM import_source_snapshots${where('captured_at')} ORDER BY captured_at DESC,rowid DESC`,params);
    if(since){const linkedIds=[...new Set([...files,...snapshots].map(item=>item.batch_id).filter(id=>id&&!batches.some(batch=>batch.id===id)))];for(const id of linkedIds){const batch=await get('SELECT id,created_at,source,target_month FROM import_source_batches WHERE id=?',[id]);if(batch)batches.push(batch);}}
    // Load lightweight identities for complete referenced batches even when the visible directory is date-limited.
    const lineageFiles=since?(await all('SELECT id,batch_id,name FROM import_source_files WHERE batch_id IN (SELECT batch_id FROM import_source_snapshots WHERE julianday(captured_at)>=julianday(?))',params)).map(file=>({...file,name:normalizeFileName(file.name)})):files;
    const archived = snapshots.map(row => {try{
        const payload=JSON.parse(row.payload_json);if(!Array.isArray(payload.sourceSections)||!Array.isArray(payload.topMetrics))throw new Error('Invalid snapshot');
        const batchFiles=lineageFiles.filter(file=>file.batch_id===row.batch_id);
        const linked=names=>batchFiles.filter(file=>(names||[]).map(normalizeFileName).includes(file.name)).map(file=>file.id);
        const sections=payload.sourceSections.map(section=>({...section,fileIds:linked(section.sourceFiles)}));
        return {...row,kind:'extraction',payload_json:undefined,metrics:payload.topMetrics.map(metric=>({...linkMetric(metric,sections,batchFiles,payload.files||[],normalizeFileName),sourceSelections:undefined})),sections:sections.map(section=>({key:section.key,title:section.title,fileIds:section.fileIds,headers:section.headers,rowCount:section.rows?.length || 0}))};
        }catch(_){errors.push({stage:'extraction',id:row.id,code:'INVALID_SNAPSHOT'});return null;}
    }).filter(Boolean);
    mark('extraction',archived.length);const savedReports = await reportMetrics(files, archived,options);mark('assessment',savedReports.length);
    const virtual=async stage=>{if(options.stage==='core')return {files:[],batches:[]};try{const result=await require('./'+stage+'-source-tables').catalog(options);errors.push(...(result.errors||[]));mark(stage,result.files.length);return result;}catch(_){errors.push({stage,code:'SOURCE_DIRECTORY_FAILED'});return {files:[],batches:[]};}};
    const [topicSources,meetingSources]=await Promise.all([virtual('topic'),virtual('meeting')]);
    const latest=new Map();for(const snapshot of archived){const key=JSON.stringify([snapshot.batch_id,snapshot.target_month]);if(!latest.has(key)||snapshotTime(snapshot.captured_at)>snapshotTime(latest.get(key).captured_at))latest.set(key,snapshot);}
    const fileMetrics=[...latest.values()].flatMap(snapshot=>snapshot.metrics.flatMap(metric=>[metric,...(metric.subMetrics||[]).map(child=>({...child,label:`${metric.label} / ${child.category}`}))].map(item=>({...item,sourceBatchId:snapshot.batch_id}))));
    return require('./source-category-repository').annotate({ diagnostics:{stages,errors,elapsedMs:Date.now()-started,since},batches:[...batches,...topicSources.batches,...meetingSources.batches], files:[...files.map(file => {
        const dutyLabels = (file.kind === 'duty_roster' || file.source_key === '夜间运维值班表') ? ['夜间运维值班表', '值班人次'] : [];
        const related=fileMetrics.filter(metric=>metric.fileIds.includes(file.id)),unresolvedMetricCount=fileMetrics.filter(metric=>metric.sourceBatchId===file.batch_id&&metric.sourceLinkStatus==='unresolved').length;
        const metricSourceState=related.some(metric=>metric.rule?.scope==='all'||metric.sourceSectionKeys?.length>1)?'cross':related.length?'single':unresolvedMetricCount?'unconfirmed':'original';
        return {...file,metricSourceState,unresolvedMetricCount,metricLabels:[...new Set([...dutyLabels,...fileMetrics.filter(metric=>metric.fileIds.includes(file.id)).map(metric=>metric.label).filter(Boolean)])],sheets:sheets.filter(sheet=>sheet.file_id===file.id).flatMap(sheet=>{try{const headers=JSON.parse(sheet.headers_json);if(!Array.isArray(headers))throw new Error();return [{id:sheet.id,name:sheet.name,headers,rowCount:sheet.row_count}];}catch(_){errors.push({stage:'originals',id:sheet.id,code:'INVALID_HEADERS'});return [];}})};
    }),...topicSources.files,...meetingSources.files], snapshots:[...archived,...savedReports].sort((a,b)=>snapshotTime(b.captured_at)-snapshotTime(a.captured_at)) });
}
function snapshotTime(value) { const text=String(value||'');return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)?text.replace(' ','T')+'Z':text)||0; }
// Read saved assessment results as-is; never apply current SLA targets to history.
async function reportMetrics(files, archived,options={}) {
    const connection=getConnection('report.db','report');
    const query=(sql,params=[])=>new Promise((resolve,reject)=>connection.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
    const schema=await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ReportSnapshots','ReportMetricData')");
    if(schema.length!==2)return [];
    const reports=await query(`SELECT snapshot_id,month,created_at,raw_data_json FROM ReportSnapshots${options.since?' WHERE julianday(created_at)>=julianday(?)':''} ORDER BY id DESC`,options.since?[options.since]:[]);
    const metrics=await query(`SELECT snapshot_id,month,cat_name,metric_label,raw_val,target_val,gap,earned_score,is_failing FROM ReportMetricData${options.since?' WHERE snapshot_id IN (SELECT snapshot_id FROM ReportSnapshots WHERE julianday(created_at)>=julianday(?))':''}`,options.since?[options.since]:[]);
    const seen=new Set();const result=[];
    for(const report of reports){const identity=`${report.snapshot_id}@@${report.month}`;if(seen.has(identity))continue;seen.add(identity);
        let raw={};try{raw=JSON.parse(report.raw_data_json||'{}');}catch(_){}
        const source=archived.find(snapshot=>snapshot.id===report.snapshot_id);
        const rows=metrics.filter(row=>row.snapshot_id===report.snapshot_id&&(row.month===report.month||row.month===null));
        if(!rows.length)continue;
        result.push({id:`assessment:${identity}`,kind:'assessment',batch_id:raw.sourceBatchId||source?.batch_id||null,sourceImportId:report.snapshot_id,sourceSnapshotId:source?.id||'',captured_at:report.created_at,target_month:report.month,sections:source?.sections||[],metrics:rows.map(row=>{
            const candidates=(raw.topMetrics||[]).filter(metric=>metric.label===row.metric_label);const original=candidates.length===1?candidates[0]:null;
            const linked=source?.metrics.filter(metric=>metric.label===row.metric_label)||[];const extracted=linked.length===1?linked[0]:null;
            const lineage=extracted||(original?resolveMetricSource(original,raw.sourceSections||[],files.filter(file=>file.batch_id===(raw.sourceBatchId||source?.batch_id)),raw.files||[],normalizeFileName):{fileIds:[],sourceSectionKeys:[],sourceLinkStatus:'unresolved'});
            return {key:`assessment:${row.cat_name}:${row.metric_label}`,label:`${row.cat_name} / ${row.metric_label}`,value:row.raw_val,savedTarget:row.target_val,gap:row.gap,isWarn:row.is_failing===1,earnedScore:row.earned_score,sourceMetricKey:original?.key||extracted?.key||'',sourceSection:original?.sourceSection||extracted?.sourceSection||'',rule:original?.rule||extracted?.rule||null,fileIds:lineage.fileIds,sourceSectionKeys:lineage.sourceSectionKeys,sourceLinkStatus:lineage.sourceLinkStatus};
        })});
    }return result;
}
async function getSheet(sheetId) {
    if(String(sheetId).startsWith('ms-'))return require('./meeting-source-tables').getSheet(sheetId);
    if(String(sheetId).startsWith('ts-'))return require('./topic-source-tables').getSheet(sheetId);
    await ensureReady(); const row = await get('SELECT id,file_id,name,headers_json,rows_json FROM import_source_sheets WHERE id=?',[sheetId]);
    return row ? {id:row.id,fileId:row.file_id,name:row.name,headers:JSON.parse(row.headers_json),rows:JSON.parse(row.rows_json)} : null;
}
const tableRules=require('../../frontend/js/monthly-designer/source-table-rules');
async function getTableRules(file,{legacy=true}={}){
    await ensureReady();const typeKey=tableRules.typeKey({...file,source_key:normalizeFileName(file.source_key),name:normalizeFileName(file.name)});
    let row=await get('SELECT rules_json FROM source_table_rules WHERE type_key=?',[typeKey]);
    // Older archives used Latin-1-decoded Chinese source keys. Recover their rules without rewriting the archive.
    if(!row&&legacy)row=(await all('SELECT type_key,rules_json FROM source_table_rules ORDER BY updated_at DESC')).find(item=>tableRules.typeKey({source_key:normalizeFileName(item.type_key)})===typeKey);
    return {typeKey,rules:row?JSON.parse(row.rules_json):[]};
}
async function sheetEditor(sheetId){
    const table=await getSheet(sheetId);if(!table)fail('Worksheet not found',404);
    const file=await getFile(table.fileId||table.file_id);if(!file)fail('Source file not found',404);
    const editable=!!await get('SELECT id FROM import_source_sheets WHERE id=?',[sheetId]);
    return {table,file:{id:file.id,name:file.name},editable,...await getTableRules(file),revision:crypto.createHash('sha256').update(json([table.headers,table.rows])).digest('hex')};
}
async function updateSheet(sheetId,input){
    if(input?.confirmed!==true)fail('Confirm source table changes');
    const state=await sheetEditor(sheetId);if(!state.editable)fail('This snapshot is read-only',409);
    if(input.revision!==state.revision)fail('Source changed; reopen the preview',409);
    let rules;try{rules=tableRules.validate(input.rules);}catch(error){fail(error.message);}
    let table;try{table=Array.isArray(input.operations)?tableRules.applyOperations(state.table,input.operations):{name:state.table.name,headers:input.headers,rows:input.rows};}catch(error){fail(error.message);}
    // Saving reusable header rules must also update this sheet, even for older clients
    // that submitted only the rules. Value replacements are never implicitly replayed.
    const headersApplied=Array.isArray(input.operations)&&input.operations.some(op=>op?.kind==='rules'&&Array.isArray(op.rules)&&op.rules.some(rule=>rule.kind==='header'))||json(table.headers)!==json(state.table.headers);
    if(input.saveRules===true&&!headersApplied)try{table=tableRules.apply(table,rules.filter(rule=>rule.kind==='header'));}catch(error){fail(error.message);}
    table=validateSheets([{...table,name:state.table.name}])[0];
    if(new Set(table.headers).size!==table.headers.length||table.headers.some(h=>!h.trim()))fail('Headers must be unique and nonempty');
    const oldHeaders=json(state.table.headers),oldRows=json(state.table.rows);
    const result=await run('UPDATE import_source_sheets SET headers_json=?,rows_json=?,row_count=? WHERE id=? AND headers_json=? AND rows_json=?',[json(table.headers),json(table.rows),table.rows.length,sheetId,oldHeaders,oldRows]);
    if(!result.changes)fail('Source changed; reopen the preview',409);
    if(input.saveRules===true)await run('INSERT INTO source_table_rules (type_key,rules_json,updated_at) VALUES (?,?,?) ON CONFLICT(type_key) DO UPDATE SET rules_json=excluded.rules_json,updated_at=excluded.updated_at',[state.typeKey,json(rules),new Date().toISOString()]);
    return sheetEditor(sheetId);
}
async function getSection(snapshotId, key) {
    await ensureReady(); const row=await get('SELECT payload_json FROM import_source_snapshots WHERE id=?',[snapshotId]);
    return row ? JSON.parse(row.payload_json).sourceSections.find(section=>section.key===key) || null : null;
}
async function getArchivedSnapshot(snapshotId) {
    await ensureReady();const row=await get('SELECT payload_json,target_month FROM import_source_snapshots WHERE id=?',[snapshotId]);
    if(!row)return null;const snapshot=JSON.parse(row.payload_json);
    return {...snapshot,selectedTargetMonth:row.target_month,files:(snapshot.files||[]).map(normalizeFileName),sourceSections:snapshot.sourceSections.map(section=>({...section,sourceFiles:(section.sourceFiles||[]).map(normalizeFileName)}))};
}
async function getMetricTable(snapshotId, metricKey) {
    await ensureReady();const row=await get('SELECT payload_json FROM import_source_snapshots WHERE id=?',[snapshotId]);
    if(!row)return null;const snapshot=JSON.parse(row.payload_json);const metric=snapshot.topMetrics.find(metric=>metric.key===metricKey);if(!metric)return null;
    const selections=Array.isArray(metric.sourceSelections)?metric.sourceSelections:[];
    const sections=snapshot.sourceSections;
    const result=[];const headers=new Set();
    for(const selection of selections){const section=sections.find(section=>section.key===selection.sectionKey);if(!section)continue;section.headers.forEach(header=>headers.add(header));for(const index of selection.indexes||[])if(Number.isInteger(index)&&index>=0&&index<section.rows.length)result.push(section.rows[index]);}
    return {headers:[...headers],rows:result,title:metric.label,hasSelections:Array.isArray(metric.sourceSelections)};
}
// Table and validator names are internal constants, never request parameters.
const presetTypes={component:{table:'monthly_component_presets',module:'templates'},mapping:{table:'monthly_mapping_presets',module:'name-mappings'},dataFormat:{table:'monthly_data_format_presets',module:'data-formats'}};
async function listPresets(type){await ensureReady();return (await all(`SELECT * FROM ${presetTypes[type].table} ORDER BY updated_at DESC,id`)).map(row=>({...row,rules:JSON.parse(row.rules_json),rules_json:undefined}));}
async function savePreset(type,input,presetId){
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>200)fail('Invalid preset name');
    const config=presetTypes[type];try{const validator=require('../../frontend/js/monthly-designer/'+config.module);if(type==='component'){input={...input,rules:validator.normalize(input.rules)};if(input.rules.document.sections.length!==1||input.rules.document.sections[0].blocks.length!==1)fail('A component preset requires exactly one component');}else validator.validate(input.rules);}catch(error){fail(error.message);}
    if(presetId&&!/^[\w-]{1,80}$/.test(presetId))fail('Invalid preset ID');
    await ensureReady();if(presetId&&!await get(`SELECT id FROM ${config.table} WHERE id=?`,[presetId]))fail('Preset not found',404);
    const key=presetId||id(),now=new Date().toISOString(),name=input.name.trim();
    await run(`INSERT INTO ${config.table} (id,name,rules_json,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,rules_json=excluded.rules_json,updated_at=excluded.updated_at`,[key,name,json(input.rules),now,now]);
    return {id:key,name,rules:input.rules,updated_at:now};
}
async function deletePreset(type,presetId){await ensureReady();const table=presetTypes[type].table;if(!await get(`SELECT id FROM ${table} WHERE id=?`,[presetId]))fail('Preset not found',404);await run(`DELETE FROM ${table} WHERE id=?`,[presetId]);return {success:true};}
const listComponentPresets=()=>listPresets('component'),saveComponentPreset=(input,id)=>savePreset('component',input,id),deleteComponentPreset=id=>deletePreset('component',id);
const listMappingPresets=()=>listPresets('mapping'),saveMappingPreset=(input,id)=>savePreset('mapping',input,id),deleteMappingPreset=id=>deletePreset('mapping',id);
const listDataFormatPresets=()=>listPresets('dataFormat'),saveDataFormatPreset=(input,id)=>savePreset('dataFormat',input,id),deleteDataFormatPreset=id=>deletePreset('dataFormat',id);
async function listDocuments() { await ensureReady(); return all('SELECT id,name,created_at,updated_at FROM monthly_documents ORDER BY updated_at DESC,rowid DESC'); }
const documentRevision = payload => crypto.createHash('sha256').update(payload).digest('hex');
async function getDocument(documentId) { await ensureReady(); const row=await get('SELECT * FROM monthly_documents WHERE id=?',[documentId]); return row ? {...row,revision:documentRevision(row.payload_json),document:JSON.parse(row.payload_json),payload_json:undefined} : null; }
function saveConflict(){const error=new Error('Monthly report changed since it was opened');error.status=409;error.code='MONTHLY_SAVE_CONFLICT';throw error;}
async function saveDocumentUnlocked(document, options={}) {
    await ensureReady();
    const engine=require('../../frontend/js/monthly-designer/document-engine');
    document=engine.prepareMonthlySave(document);
    const previous=document.id?await getDocument(document.id):null;
    if(Object.hasOwn(options,'expectedRevision')&&document.id&&options.expectedRevision!==(previous?.revision??null))saveConflict();
    const month=engine.documentMonth(document);
    const documentId=previous&&month&&engine.documentMonth(previous.document)!==month?id():document.id||id();
    document=engine.nextSaveVersion(document,documentId===previous?.id?previous.document:null);
    const now=new Date().toISOString();
    const payload=json({...document,id:documentId});
    if(previous&&documentId===previous.id&&Object.hasOwn(options,'expectedRevision')){
        const row=await get('SELECT payload_json FROM monthly_documents WHERE id=?',[documentId]);
        if(!row||documentRevision(row.payload_json)!==previous.revision)saveConflict();
        const result=await run('UPDATE monthly_documents SET name=?,payload_json=?,updated_at=? WHERE id=? AND payload_json=?',[document.name,payload,now,documentId,row.payload_json]);
        if(!result.changes)saveConflict();
    }else await run(`INSERT INTO monthly_documents (id,name,payload_json,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,[documentId,document.name,payload,now,now]);
    return getDocument(documentId);
}
async function deleteDocuments(input) {
    if(!Array.isArray(input)||!input.length||input.length>500||input.some(value=>typeof value!=='string'||!(/^[\w-]{1,80}$/).test(value)))fail('Select between 1 and 500 valid monthly document IDs',400);
    const ids=[...new Set(input)],key=getDataDir();
    const pending=(documentSaves.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
        await ensureReady();const placeholders=ids.map(()=>'?').join(',');
        const existing=await all(`SELECT id FROM monthly_documents WHERE id IN (${placeholders})`,ids);
        await run(`DELETE FROM monthly_documents WHERE id IN (${placeholders})`,ids);
        return {success:true,deletedIds:existing.map(row=>row.id),deletedCount:existing.length};
    });
    documentSaves.set(key,pending);try{return await pending;}finally{if(documentSaves.get(key)===pending)documentSaves.delete(key);}
}
async function listLogos(){await ensureReady();return all('SELECT id,name,created_at FROM monthly_logos ORDER BY created_at DESC,rowid DESC');}
async function getLogo(logoId){await ensureReady();return get('SELECT * FROM monthly_logos WHERE id=?',[logoId]);}
async function saveLogo(file){
    const bytes=file?.buffer;
    if(!Buffer.isBuffer(bytes)||bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('Invalid PNG logo',400);
    await ensureReady();const logoId=id(),name=normalizeFileName(file.originalname||'Logo').slice(0,200),time=new Date().toISOString();
    await run('INSERT INTO monthly_logos (id,name,image_blob,created_at) VALUES (?,?,?,?)',[logoId,name,bytes,time]);
    return {id:logoId,name,created_at:time};
}
const documentSaves=new Map();
async function saveDocument(document,options={}){
    const key=getDataDir(),pending=(documentSaves.get(key)||Promise.resolve()).catch(()=>{}).then(()=>saveDocumentUnlocked(document,options));
    documentSaves.set(key,pending);
    try{return await pending;}finally{if(documentSaves.get(key)===pending)documentSaves.delete(key);}
}
// Count file metadata in one query; never read original blobs or worksheet rows.
async function rangeCounts(days=0,period=''){
    await ensureReady();
    const ranges=[...new Set([7,30,90,180,365,0,days])];
    if(period){
        const rules=require('../../frontend/js/monthly-designer/source-rules');
        // Filename/month metadata uses the same precedence as the library; no blobs or sheets.
        const files=await all("SELECT f.name,f.created_at,f.batch_id,b.target_month,b.created_at AS batch_created_at,julianday('now')-julianday(f.created_at) AS age_days FROM import_source_files f LEFT JOIN import_source_batches b ON b.id=f.batch_id");
        const matched=files.filter(file=>rules.fileMonth({...file,name:normalizeFileName(file.name)},{batches:[{id:file.batch_id,target_month:file.target_month,created_at:file.batch_created_at}]})===period);
        return {capturedAt:new Date().toISOString(),period,counts:ranges.map(day=>({days:day,count:matched.filter(file=>!day||file.age_days!==null&&file.age_days<=day).length}))};
    }
    const row=await get('SELECT '+ranges.map((day,index)=>day?`COALESCE(SUM(CASE WHEN julianday(created_at)>=julianday('now')-? THEN 1 ELSE 0 END),0) AS n${index}`:`COUNT(*) AS n${index}`).join(', ')+' FROM import_source_files',ranges.filter(Boolean));
    return {capturedAt:new Date().toISOString(),counts:ranges.map((day,index)=>({days:day,count:row['n'+index]}))};
}
module.exports={rangeCounts,normalizeFileName,getTableRules,sheetEditor,updateSheet,listComponentPresets,saveComponentPreset,deleteComponentPreset,listDataFormatPresets,saveDataFormatPreset,deleteDataFormatPreset,listMappingPresets,saveMappingPreset,deleteMappingPreset,listLogos,getLogo,saveLogo,ensureReady,getImportSettings,saveImportSettings,createBatch,saveFile,saveSheets,getFile,registerSnapshot,catalog,getSheet,getSection,getArchivedSnapshot,getMetricTable,listDocuments,getDocument,saveDocument,deleteDocuments};
