// Per-account presentation state, isolated by the tenant-aware SQLite connection.
const db=require('./app-db'),chat=require('./ai-chat-repository');
const {redactText}=require('./ai-sensitive-data');
const ready=new WeakMap(),sources=new Set(['mine','welink','weixin','desktop:codex','desktop:claudecode','desktop:antigravity','desktop:workbuddy']);
async function ensure(){const connection=db.getDatabase();if(!ready.has(connection))ready.set(connection,(async()=>{await db.run(`CREATE TABLE IF NOT EXISTS conversation_list_preferences(
 owner TEXT NOT NULL,source TEXT NOT NULL,item_id TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(owner,source,item_id))`);
 const columns=await db.all('PRAGMA table_info(conversation_list_preferences)');
 if(!columns.some(column=>column.name==='pin_order'))await db.run('ALTER TABLE conversation_list_preferences ADD COLUMN pin_order INTEGER');
 })().catch(e=>{ready.delete(connection);throw e}));return ready.get(connection)}
const invalid=()=>Object.assign(new Error('对话列表设置无效'),{statusCode:400});
async function list(owner){await ensure();return db.all('SELECT source,item_id AS id,pinned,archived,hidden,title,pin_order FROM conversation_list_preferences WHERE owner=?',[owner])}
async function save(owner,input={}){
 const {source,id}=input;if(!owner||!sources.has(source)||typeof id!=='string'||!id.trim()||id.length>300||/[\x00-\x1f]/.test(id))throw invalid();
 const keys=['pinned','archived','hidden','title'];if(Object.keys(input).some(k=>!['source','id',...keys].includes(k)))throw invalid();
 for(const key of keys){if(input[key]!==undefined&&(key==='title'?typeof input[key]!=='string'||input[key].length>160:typeof input[key]!=='boolean'))throw invalid()}
 const isExternalId = id.startsWith('desktop:') || id.startsWith('weixin:') || id.startsWith('welink:');
 if(source==='mine'&&!isExternalId&&!await chat.assertSessionOwner(id,owner))throw Object.assign(new Error('会话不存在'),{statusCode:404});
 await ensure();
 // Only supplied columns are updated, so simultaneous independent actions do not
 // overwrite one another through a stale read/merge/write cycle.
 const fields=keys.filter(k=>input[k]!==undefined);if(!fields.length)throw invalid();
 const values=fields.map(k=>k==='title'?redactText(input[k].trim()):Number(input[k]));
 await db.run(`INSERT INTO conversation_list_preferences(owner,source,item_id,${fields.join(',')}) VALUES(?,?,?,${fields.map(()=>'?').join(',')}) ON CONFLICT(owner,source,item_id) DO UPDATE SET ${fields.map(k=>`${k}=excluded.${k}`).join(',')},updated_at=CURRENT_TIMESTAMP`,[owner,source,id,...values]);
 return db.get('SELECT source,item_id AS id,pinned,archived,hidden,title,pin_order FROM conversation_list_preferences WHERE owner=? AND source=? AND item_id=?',[owner,source,id]);
}
async function reorder(owner,input={}){
 const {source,order}=input;
 if(!owner||!sources.has(source)||Object.keys(input).some(k=>!['source','order'].includes(k))||!Array.isArray(order)||order.length<2||order.length>1000||order.some(id=>typeof id!=='string'||!id.trim()||id.length>300||/[\x00-\x1f]/.test(id))||new Set(order).size!==order.length)throw invalid();
 await ensure();
 const rows=await db.all('SELECT item_id FROM conversation_list_preferences WHERE owner=? AND source=? AND pinned=1 AND archived=0 AND hidden=0 ORDER BY pin_order IS NULL,pin_order,updated_at DESC,item_id',[owner,source]);
 const ids=new Set(rows.map(row=>row.item_id));if(order.some(id=>!ids.has(id)))throw invalid();
 // Keep filtered-out pins in their existing slots. One statement commits the order atomically.
 const selected=new Set(order);let index=0;
 const merged=rows.map(row=>selected.has(row.item_id)?order[index++]:row.item_id);
 await db.run(`UPDATE conversation_list_preferences SET pin_order=CASE item_id ${merged.map(()=> 'WHEN ? THEN ?').join(' ')} END WHERE owner=? AND source=? AND pinned=1 AND archived=0 AND hidden=0 AND item_id IN (${merged.map(()=>'?').join(',')})`,[...merged.flatMap((id,i)=>[id,i]),owner,source,...merged]);
 return list(owner);
}
module.exports={list,save,reorder};
