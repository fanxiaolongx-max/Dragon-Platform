const {run,get,all}=require('./app-db');
const {getDataDir}=require('./tenant-context');
const cleanupJobs=new Map();
const crypto=require('node:crypto');
const content=require('../../frontend/js/monthly-designer/draft-content');
const version=payload=>crypto.createHash('sha256').update(payload).digest('hex');
const digest=document=>crypto.createHash('sha256').update(content.signature(document)).digest('hex');
const engine=require('../../frontend/js/monthly-designer/document-engine');

async function ready(){
    await require('./import-source-repository').ensureReady();
    await run(`CREATE TABLE IF NOT EXISTS monthly_document_drafts (
        id TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, report_month TEXT NOT NULL,
        base_revision TEXT, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(owner,id))`);
    await run(`CREATE TABLE IF NOT EXISTS monthly_draft_history (id TEXT NOT NULL, owner TEXT NOT NULL, original_id TEXT NOT NULL, name TEXT NOT NULL, report_month TEXT NOT NULL, base_revision TEXT, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT NOT NULL, PRIMARY KEY(owner,id))`);
}
function invalid(message,status=400){const error=new Error(message);error.status=status;throw error;}
function check(owner,id){
    if(typeof owner!=='string'||!owner||owner.length>200)invalid('Authentication required',401);
    if(id!==undefined&&(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id)))invalid('Invalid draft ID');
}
async function list(owner,options={}){
    check(owner);await ready();
    if(options.archived)return (await all('SELECT id,name,report_month,updated_at,archived_at FROM monthly_draft_history WHERE owner=? ORDER BY updated_at DESC,id',[owner])).map(row=>({...row,reportKey:content.reportKey({name:row.name,reportMonth:row.report_month}),duplicateCount:1,archived:true}));
    const rows=await all('SELECT id,name,report_month,base_revision,updated_at FROM monthly_document_drafts WHERE owner=? ORDER BY updated_at DESC,id',[owner]),formal=new Map(),unique=new Map();
    for(const row of rows){
        const stored=await get('SELECT payload_json FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,row.id]);if(!stored)continue;
        const document=JSON.parse(stored.payload_json),hash=digest(document),reportKey=content.reportKey(document);
        if(document.id&&!formal.has(document.id)){const saved=await get('SELECT payload_json FROM monthly_documents WHERE id=?',[document.id]);formal.set(document.id,saved?digest(JSON.parse(saved.payload_json)):null);}
        if(document.id&&formal.get(document.id)===hash)continue;
        const key=JSON.stringify([reportKey,row.base_revision,hash]);
        if(unique.has(key)){unique.get(key).duplicateCount++;continue;}
        const {base_revision,...metadata}=row;unique.set(key,{...metadata,reportKey,duplicateCount:1});
    }
    return [...unique.values()];
}
async function read(owner,id){check(owner,id);await ready();const row=await get('SELECT * FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,id])||await get('SELECT * FROM monthly_draft_history WHERE owner=? AND id=?',[owner,id]);if(!row)invalid('Draft not found',404);return {id:row.id,baseRevision:row.base_revision,updated_at:row.updated_at,version:version(row.payload_json),document:JSON.parse(row.payload_json)};}
async function save(owner,id,input){
    check(owner,id);
    if(input?.baseRevision!==null&&(typeof input?.baseRevision!=='string'||!/^[a-f0-9]{64}$/.test(input.baseRevision)))invalid('Invalid base revision');
    const document=engine.normalize(input.document),payload=JSON.stringify(document);
    if(Buffer.byteLength(payload)>16*1024*1024)invalid('Draft too large',413);
    await ready();
    if(document.id){const formal=await get('SELECT payload_json FROM monthly_documents WHERE id=?',[document.id]);if(formal&&digest(JSON.parse(formal.payload_json))===digest(document))return {id,unchanged:true};}
    const previous=await get('SELECT payload_json,base_revision,updated_at FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,id]);
    if(previous&&previous.base_revision===input.baseRevision&&digest(JSON.parse(previous.payload_json))===digest(document))return {id,updated_at:previous.updated_at,version:version(previous.payload_json)};
    const now=new Date().toISOString();
    await run(`INSERT INTO monthly_document_drafts (id,owner,name,report_month,base_revision,payload_json,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,report_month=excluded.report_month,base_revision=excluded.base_revision,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
        [id,owner,document.name,engine.documentMonth(document),input.baseRevision,payload,now]);
    return {id,updated_at:now,version:version(payload)};
}
async function remove(owner,id,options={}){
    check(owner,id);await ready();
    if(options.updatedAt!==undefined&&options.updatedAt!==null&&(typeof options.updatedAt!=='string'||options.updatedAt.length>80))invalid('Invalid draft timestamp');
    if(options.version!==undefined&&options.version!==null&&(typeof options.version!=='string'||!/^[a-f0-9]{64}$/.test(options.version)))invalid('Invalid draft version');
    const row=await get('SELECT payload_json,base_revision,updated_at FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,id]);
    if(!row){const archived=await get('SELECT payload_json FROM monthly_draft_history WHERE owner=? AND id=?',[owner,id]);if(archived&&(!options.version||version(archived.payload_json)===options.version))await run('DELETE FROM monthly_draft_history WHERE owner=? AND id=? AND payload_json=?',[owner,id,archived.payload_json]);return {success:true};}
    if(options.version&&version(row.payload_json)!==options.version||options.updatedAt&&row.updated_at!==options.updatedAt)return {success:true};
    const hash=digest(JSON.parse(row.payload_json)),candidates=await all('SELECT id FROM monthly_document_drafts WHERE owner=?',[owner]);
    for(const candidate of candidates){const value=await get('SELECT payload_json,base_revision,updated_at FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,candidate.id]);
        if(value&&value.base_revision===row.base_revision&&digest(JSON.parse(value.payload_json))===hash)await run('DELETE FROM monthly_document_drafts WHERE owner=? AND id=? AND payload_json=? AND updated_at=?',[owner,candidate.id,value.payload_json,value.updated_at]);
    }
    return {success:true};
}

async function cleanupUnlocked(owner,input={}){
    check(owner);await ready();
    const mode=input.mode||'safe',protectedIds=input.protectedIds||[];
    if(!['safe','older'].includes(mode)||!Array.isArray(protectedIds)||protectedIds.length>100||protectedIds.some(id=>typeof id!=='string'||!/^[-\w]{1,80}$/.test(id)))invalid('Invalid cleanup request');
    const rows=await all('SELECT id,name,report_month,base_revision,updated_at FROM monthly_document_drafts WHERE owner=? ORDER BY updated_at DESC,id',[owner]),formal=new Map(),seen=new Set(),reports=new Set();let removed=0,archived=0;
    for(const row of rows){
        const stored=await get('SELECT payload_json FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,row.id]);if(!stored)continue;
        const document=JSON.parse(stored.payload_json),hash=digest(document),key=content.reportKey(document),duplicate=JSON.stringify([key,row.base_revision,hash]);
        if(document.id&&!formal.has(document.id)){const saved=await get('SELECT payload_json FROM monthly_documents WHERE id=?',[document.id]);formal.set(document.id,saved?digest(JSON.parse(saved.payload_json)):null);}
        const redundant=document.id&&formal.get(document.id)===hash||seen.has(duplicate),old=reports.has(key);seen.add(duplicate);if(!redundant)reports.add(key);
        if(protectedIds.includes(row.id))continue;
        if(!redundant&&!(mode==='older'&&old))continue;
        if(!redundant){
            const archiveId='history-'+crypto.randomUUID();
            await run(`INSERT INTO monthly_draft_history (id,owner,original_id,name,report_month,base_revision,payload_json,updated_at,archived_at)
                SELECT ?,owner,id,name,report_month,base_revision,payload_json,updated_at,? FROM monthly_document_drafts WHERE owner=? AND id=? AND payload_json=? AND updated_at=?`,[archiveId,new Date().toISOString(),owner,row.id,stored.payload_json,row.updated_at]);
        }
        const result=await run('DELETE FROM monthly_document_drafts WHERE owner=? AND id=? AND payload_json=? AND updated_at=?',[owner,row.id,stored.payload_json,row.updated_at]);
        if(redundant)removed+=result.changes;else archived+=result.changes;
    }
    return {success:true,removed,archived};
}
async function cleanup(owner,input={}){
    check(owner);const key=JSON.stringify([getDataDir(),owner]);
    const pending=(cleanupJobs.get(key)||Promise.resolve()).catch(()=>{}).then(()=>cleanupUnlocked(owner,input));cleanupJobs.set(key,pending);
    try{return await pending;}finally{if(cleanupJobs.get(key)===pending)cleanupJobs.delete(key);}
}
module.exports={list,read,save,remove,cleanup};
