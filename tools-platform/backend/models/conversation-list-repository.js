// Per-account presentation state, isolated by the tenant-aware SQLite connection.
const db=require('./app-db'),chat=require('./ai-chat-repository');
const {redactText}=require('./ai-sensitive-data');
const ready=new WeakMap(),sources=new Set(['mine','welink','weixin','desktop:codex','desktop:claudecode','desktop:antigravity']);
async function ensure(){const connection=db.getDatabase();if(!ready.has(connection))ready.set(connection,db.run(`CREATE TABLE IF NOT EXISTS conversation_list_preferences(
 owner TEXT NOT NULL,source TEXT NOT NULL,item_id TEXT NOT NULL,pinned INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(owner,source,item_id))`).catch(e=>{ready.delete(connection);throw e}));return ready.get(connection)}
const invalid=()=>Object.assign(new Error('对话列表设置无效'),{statusCode:400});
async function list(owner){await ensure();return db.all('SELECT source,item_id AS id,pinned,archived,hidden,title FROM conversation_list_preferences WHERE owner=?',[owner])}
async function save(owner,input={}){
 const {source,id}=input;if(!owner||!sources.has(source)||typeof id!=='string'||!id.trim()||id.length>300||/[\x00-\x1f]/.test(id))throw invalid();
 const keys=['pinned','archived','hidden','title'];if(Object.keys(input).some(k=>!['source','id',...keys].includes(k)))throw invalid();
 for(const key of keys){if(input[key]!==undefined&&(key==='title'?typeof input[key]!=='string'||input[key].length>160:typeof input[key]!=='boolean'))throw invalid()}
 if(source==='mine'&&!await chat.assertSessionOwner(id,owner))throw Object.assign(new Error('会话不存在'),{statusCode:404});
 await ensure();
 // Only supplied columns are updated, so simultaneous independent actions do not
 // overwrite one another through a stale read/merge/write cycle.
 const fields=keys.filter(k=>input[k]!==undefined);if(!fields.length)throw invalid();
 const values=fields.map(k=>k==='title'?redactText(input[k].trim()):Number(input[k]));
 await db.run(`INSERT INTO conversation_list_preferences(owner,source,item_id,${fields.join(',')}) VALUES(?,?,?,${fields.map(()=>'?').join(',')}) ON CONFLICT(owner,source,item_id) DO UPDATE SET ${fields.map(k=>`${k}=excluded.${k}`).join(',')},updated_at=CURRENT_TIMESTAMP`,[owner,source,id,...values]);
 return db.get('SELECT source,item_id AS id,pinned,archived,hidden,title FROM conversation_list_preferences WHERE owner=? AND source=? AND item_id=?',[owner,source,id]);
}
module.exports={list,save};
