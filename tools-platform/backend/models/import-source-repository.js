const crypto = require('node:crypto');
const path = require('node:path');
const { run, get, all } = require('./app-db');
const { getDataDir } = require('./tenant-context');
const { getConnection } = require('./tenant-sqlite-pool');
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
        await run(`CREATE TABLE IF NOT EXISTS monthly_documents (id TEXT PRIMARY KEY, name TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        await run(`CREATE TABLE IF NOT EXISTS import_source_settings (id INTEGER PRIMARY KEY CHECK(id=1), upload_originals INTEGER NOT NULL DEFAULT 1 CHECK(upload_originals IN (0,1)))`);
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
    // Sheets are immutable after successful parsing; a retry may safely repeat the request.
    const current = await get('SELECT parse_status FROM import_source_files WHERE id=?',[fileId]);
    if (current.parse_status === 'ready') return;
    for (const sheet of valid) await run(`INSERT INTO import_source_sheets (id,file_id,name,headers_json,rows_json,row_count) VALUES (?,?,?,?,?,?) ON CONFLICT(file_id,name) DO UPDATE SET headers_json=excluded.headers_json,rows_json=excluded.rows_json,row_count=excluded.row_count`,[id(),fileId,sheet.name,json(sheet.headers),json(sheet.rows),sheet.rows.length]);
    await run('UPDATE import_source_files SET parse_status=?, parse_error=? WHERE id=?',[parseError?'error':'ready',String(parseError).slice(0,500),fileId]);
}
async function getFile(fileId, original = false) {
    if(String(fileId).startsWith('ms-'))return require('./meeting-source-tables').getFile(fileId,original);
    if(String(fileId).startsWith('ts-'))return require('./topic-source-tables').getFile(fileId,original);
    await ensureReady(); const file=await get(`SELECT id,batch_id,name,source_key,kind,size,sha256,parse_status,parse_error${original?',original_blob':''} FROM import_source_files WHERE id=?`,[fileId]);
    return file ? {...file,name:normalizeFileName(file.name)} : file;
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
    const metrics = (Array.isArray(snapshot.topMetrics)?snapshot.topMetrics:[]).map((metric,index) => {
        const section = sourceSections.find(section => section.key === metric.sourceSection);
        const names = metric.sourceFiles || section?.sourceFiles || snapshot.files || [];
        return { ...metric, key:metric.key || `legacy:${metric.label || index}`, fileIds:files.filter(file => names.includes(file.name)).map(file => file.id) };
    });
    const payload = { id:snapshot.id, timestamp:snapshot.timestamp, sourceBatchId:batchId, files:snapshot.files || [], topMetrics:metrics, sourceSections, expiringTickets:snapshot.expiringTickets || [] };
    await run(`INSERT INTO import_source_snapshots (id,batch_id,captured_at,target_month,payload_json) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET batch_id=excluded.batch_id,captured_at=excluded.captured_at,target_month=excluded.target_month,payload_json=excluded.payload_json`,[snapshot.id,batchId,snapshot.timestamp || new Date().toISOString(),snapshot.selectedTargetMonth || null,json(payload)]);
    return payload;
}
async function catalog() {
    await ensureReady();
    const batches = await all('SELECT id,created_at,source,target_month FROM import_source_batches ORDER BY created_at DESC,rowid DESC');
    const files = (await all('SELECT id,batch_id,name,source_key,kind,size,sha256,parse_status,parse_error,created_at FROM import_source_files ORDER BY created_at DESC,rowid DESC')).map(file=>({...file,name:normalizeFileName(file.name),source_key:normalizeFileName(file.source_key),source_key_aliases:[file.source_key]}));
    const sheets = await all('SELECT id,file_id,name,headers_json,row_count FROM import_source_sheets ORDER BY rowid');
    const snapshots = await all('SELECT id,batch_id,captured_at,target_month,payload_json FROM import_source_snapshots ORDER BY captured_at DESC,rowid DESC');
    const archived = snapshots.map(row => {
        const payload=JSON.parse(row.payload_json);
        const linked=(names,ids=[])=>[...new Set([...ids,...files.filter(file=>file.batch_id===row.batch_id&&(names||[]).map(normalizeFileName).includes(file.name)).map(file=>file.id)])];
        const sections=payload.sourceSections.map(section=>({...section,fileIds:linked(section.sourceFiles,section.fileIds)}));
        return {...row,kind:'extraction',payload_json:undefined,metrics:payload.topMetrics.map(metric=>({...metric,fileIds:linked(metric.sourceFiles || sections.find(section=>section.key===metric.sourceSection)?.sourceFiles || payload.files,metric.fileIds),sourceSelections:undefined})),sections:sections.map(section=>({key:section.key,title:section.title,fileIds:section.fileIds,headers:section.headers,rowCount:section.rows?.length || 0}))};
    });
    const savedReports = await reportMetrics(files, archived);
    const topicSources=await require('./topic-source-tables').catalog();
    const meetingSources=await require('./meeting-source-tables').catalog();
    return { batches:[...batches,...topicSources.batches,...meetingSources.batches], files:[...files.map(file => {
        const dutyLabels = (file.kind === 'duty_roster' || file.source_key === '夜间运维值班表') ? ['夜间运维值班表', '值班人次'] : [];
        return {...file,metricLabels:[...new Set([...dutyLabels,...archived.flatMap(snapshot=>snapshot.metrics.filter(metric=>metric.fileIds.includes(file.id)).map(metric=>metric.label)).filter(Boolean)])],sheets:sheets.filter(sheet=>sheet.file_id===file.id).map(sheet=>({id:sheet.id,name:sheet.name,headers:JSON.parse(sheet.headers_json),rowCount:sheet.row_count}))};
    }),...topicSources.files,...meetingSources.files], snapshots:[...archived,...savedReports].sort((a,b)=>snapshotTime(b.captured_at)-snapshotTime(a.captured_at)) };
}
function snapshotTime(value) { const text=String(value||'');return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)?text.replace(' ','T')+'Z':text)||0; }
// Read saved assessment results as-is; never apply current SLA targets to history.
async function reportMetrics(files, archived) {
    const connection=getConnection('report.db','report');
    const query=(sql,params=[])=>new Promise((resolve,reject)=>connection.all(sql,params,(error,rows)=>error?reject(error):resolve(rows)));
    const schema=await query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('ReportSnapshots','ReportMetricData')");
    if(schema.length!==2)return [];
    const reports=await query('SELECT snapshot_id,month,created_at,raw_data_json FROM ReportSnapshots ORDER BY id DESC');
    const metrics=await query('SELECT snapshot_id,month,cat_name,metric_label,raw_val,target_val,gap,earned_score,is_failing FROM ReportMetricData');
    const seen=new Set();const result=[];
    for(const report of reports){const identity=`${report.snapshot_id}@@${report.month}`;if(seen.has(identity))continue;seen.add(identity);
        let raw={};try{raw=JSON.parse(report.raw_data_json||'{}');}catch(_){}
        const source=archived.find(snapshot=>snapshot.id===report.snapshot_id);
        const rows=metrics.filter(row=>row.snapshot_id===report.snapshot_id&&(row.month===report.month||row.month===null));
        if(!rows.length)continue;
        result.push({id:`assessment:${identity}`,kind:'assessment',batch_id:raw.sourceBatchId||source?.batch_id||null,sourceImportId:report.snapshot_id,sourceSnapshotId:source?.id||'',captured_at:report.created_at,target_month:report.month,sections:source?.sections||[],metrics:rows.map(row=>{
            const candidates=(raw.topMetrics||[]).filter(metric=>metric.label===row.metric_label);const original=candidates.length===1?candidates[0]:null;
            const linked=source?.metrics.filter(metric=>metric.label===row.metric_label)||[];const extracted=linked.length===1?linked[0]:null;
            return {key:`assessment:${row.cat_name}:${row.metric_label}`,label:`${row.cat_name} / ${row.metric_label}`,value:row.raw_val,savedTarget:row.target_val,gap:row.gap,isWarn:row.is_failing===1,earnedScore:row.earned_score,sourceMetricKey:original?.key||extracted?.key||'',sourceSection:original?.sourceSection||extracted?.sourceSection||'',rule:original?.rule||extracted?.rule||null,fileIds:extracted?.fileIds|| (original?files.filter(file=>file.batch_id===(raw.sourceBatchId||source?.batch_id)&&(original.sourceFiles||raw.files||[]).map(normalizeFileName).includes(file.name)).map(file=>file.id):[])};
        })});
    }return result;
}
async function getSheet(sheetId) {
    if(String(sheetId).startsWith('ms-'))return require('./meeting-source-tables').getSheet(sheetId);
    if(String(sheetId).startsWith('ts-'))return require('./topic-source-tables').getSheet(sheetId);
    await ensureReady(); const row = await get('SELECT id,file_id,name,headers_json,rows_json FROM import_source_sheets WHERE id=?',[sheetId]);
    return row ? {id:row.id,fileId:row.file_id,name:row.name,headers:JSON.parse(row.headers_json),rows:JSON.parse(row.rows_json)} : null;
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
const presetTypes={mapping:{table:'monthly_mapping_presets',module:'name-mappings'},dataFormat:{table:'monthly_data_format_presets',module:'data-formats'}};
async function listPresets(type){await ensureReady();return (await all(`SELECT * FROM ${presetTypes[type].table} ORDER BY updated_at DESC,id`)).map(row=>({...row,rules:JSON.parse(row.rules_json),rules_json:undefined}));}
async function savePreset(type,input,presetId){
    if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>200)fail('Invalid preset name');
    const config=presetTypes[type];try{require('../../frontend/js/monthly-designer/'+config.module).validate(input.rules);}catch(error){fail(error.message);}
    if(presetId&&!/^[\w-]{1,80}$/.test(presetId))fail('Invalid preset ID');
    await ensureReady();if(presetId&&!await get(`SELECT id FROM ${config.table} WHERE id=?`,[presetId]))fail('Preset not found',404);
    const key=presetId||id(),now=new Date().toISOString(),name=input.name.trim();
    await run(`INSERT INTO ${config.table} (id,name,rules_json,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,rules_json=excluded.rules_json,updated_at=excluded.updated_at`,[key,name,json(input.rules),now,now]);
    return {id:key,name,rules:input.rules,updated_at:now};
}
async function deletePreset(type,presetId){await ensureReady();const table=presetTypes[type].table;if(!await get(`SELECT id FROM ${table} WHERE id=?`,[presetId]))fail('Preset not found',404);await run(`DELETE FROM ${table} WHERE id=?`,[presetId]);return {success:true};}
const listMappingPresets=()=>listPresets('mapping'),saveMappingPreset=(input,id)=>savePreset('mapping',input,id),deleteMappingPreset=id=>deletePreset('mapping',id);
const listDataFormatPresets=()=>listPresets('dataFormat'),saveDataFormatPreset=(input,id)=>savePreset('dataFormat',input,id),deleteDataFormatPreset=id=>deletePreset('dataFormat',id);
async function listDocuments() { await ensureReady(); return all('SELECT id,name,created_at,updated_at FROM monthly_documents ORDER BY updated_at DESC,rowid DESC'); }
async function getDocument(documentId) { await ensureReady(); const row=await get('SELECT * FROM monthly_documents WHERE id=?',[documentId]); return row ? {...row,document:JSON.parse(row.payload_json),payload_json:undefined} : null; }
async function saveDocumentUnlocked(document) {
    await ensureReady();
    const engine=require('../../frontend/js/monthly-designer/document-engine');
    document=engine.prepareMonthlySave(document);
    const previous=document.id?await getDocument(document.id):null;
    const month=engine.documentMonth(document);
    const documentId=previous&&month&&engine.documentMonth(previous.document)!==month?id():document.id||id();
    document=engine.nextSaveVersion(document,documentId===previous?.id?previous.document:null);
    const now=new Date().toISOString();
    await run(`INSERT INTO monthly_documents (id,name,payload_json,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,[documentId,document.name,json({...document,id:documentId}),now,now]);
    return getDocument(documentId);
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
async function saveDocument(document){
    const key=getDataDir(),pending=(documentSaves.get(key)||Promise.resolve()).catch(()=>{}).then(()=>saveDocumentUnlocked(document));
    documentSaves.set(key,pending);
    try{return await pending;}finally{if(documentSaves.get(key)===pending)documentSaves.delete(key);}
}
module.exports={listDataFormatPresets,saveDataFormatPreset,deleteDataFormatPreset,listMappingPresets,saveMappingPreset,deleteMappingPreset,listLogos,getLogo,saveLogo,ensureReady,getImportSettings,saveImportSettings,createBatch,saveFile,saveSheets,getFile,registerSnapshot,catalog,getSheet,getSection,getArchivedSnapshot,getMetricTable,listDocuments,getDocument,saveDocument};
