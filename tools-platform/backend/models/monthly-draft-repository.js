const {run,get,all}=require('./app-db');
const engine=require('../../frontend/js/monthly-designer/document-engine');

async function ready(){
    await require('./import-source-repository').ensureReady();
    await run(`CREATE TABLE IF NOT EXISTS monthly_document_drafts (
        id TEXT NOT NULL, owner TEXT NOT NULL, name TEXT NOT NULL, report_month TEXT NOT NULL,
        base_revision TEXT, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(owner,id))`);
}
function invalid(message,status=400){const error=new Error(message);error.status=status;throw error;}
function check(owner,id){
    if(typeof owner!=='string'||!owner||owner.length>200)invalid('Authentication required',401);
    if(id!==undefined&&(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id)))invalid('Invalid draft ID');
}
async function list(owner){check(owner);await ready();return all('SELECT id,name,report_month,updated_at FROM monthly_document_drafts WHERE owner=? ORDER BY updated_at DESC',[owner]);}
async function read(owner,id){check(owner,id);await ready();const row=await get('SELECT * FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,id]);if(!row)invalid('Draft not found',404);return {id:row.id,baseRevision:row.base_revision,updated_at:row.updated_at,document:JSON.parse(row.payload_json)};}
async function save(owner,id,input){
    check(owner,id);
    if(input?.baseRevision!==null&&(typeof input?.baseRevision!=='string'||!/^[a-f0-9]{64}$/.test(input.baseRevision)))invalid('Invalid base revision');
    const document=engine.normalize(input.document),payload=JSON.stringify(document);
    if(Buffer.byteLength(payload)>16*1024*1024)invalid('Draft too large',413);
    await ready();const now=new Date().toISOString();
    await run(`INSERT INTO monthly_document_drafts (id,owner,name,report_month,base_revision,payload_json,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(owner,id) DO UPDATE SET name=excluded.name,report_month=excluded.report_month,base_revision=excluded.base_revision,payload_json=excluded.payload_json,updated_at=excluded.updated_at`,
        [id,owner,document.name,engine.documentMonth(document),input.baseRevision,payload,now]);
    return {id,updated_at:now};
}
async function remove(owner,id){check(owner,id);await ready();await run('DELETE FROM monthly_document_drafts WHERE owner=? AND id=?',[owner,id]);return {success:true};}
module.exports={list,read,save,remove};
