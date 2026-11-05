const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'conversation-list-'));process.env.TOOLS_DATA_DIR=path.join(temp,'data');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');
const repo=require('../backend/models/conversation-list-repository'),chat=require('../backend/models/ai-chat-repository'),db=require('../backend/models/app-db'),{runWithTenant}=require('../backend/models/tenant-context');
test('list preferences persist independent fields and enforce owner, source and tenant boundaries',async t=>{
 t.after(async()=>{await db.closeDatabase();fs.rmSync(temp,{recursive:true,force:true})});
 const id=await chat.addMessage({owner:'alice',role:'user',content:'question'});
 await repo.save('alice',{source:'mine',id,pinned:true,title:'My title'});await repo.save('alice',{source:'mine',id,archived:true});
 const saved=(await repo.list('alice'))[0];assert.equal(saved.pinned,1);assert.equal(saved.archived,1);assert.equal(saved.title,'My title');
 await assert.rejects(repo.save('bob',{source:'mine',id,pinned:true}),e=>e.statusCode===403);
 for(const source of ['welink','weixin','desktop:codex','desktop:claudecode','desktop:antigravity'])await repo.save('alice',{source,id:'same',hidden:true});
 assert.equal((await repo.list('alice')).length,6);assert.deepEqual(await repo.list('bob'),[]);
 await runWithTenant('list-isolated',async()=>{assert.deepEqual(await repo.list('alice'),[]);await repo.save('alice',{source:'weixin',id:'same',pinned:true});});
 assert.equal((await repo.list('alice')).find(p=>p.source==='weixin').pinned,0);
 for(const patch of [{source:'unknown',id:'x',pinned:true},{source:'weixin',id:'x',pinned:'true'},{source:'weixin',id:'x',owner:'bob',hidden:true},{source:'weixin',id:'x',title:'x'.repeat(161)}])await assert.rejects(repo.save('alice',patch),e=>e.statusCode===400);
 assert.equal(await chat.deleteSession(id,{owner:'alice'}),true);assert.equal((await repo.list('alice')).some(p=>p.source==='mine'),false,'deleting an owned chat removes its metadata too');
});
test('coarse groups cover calendar day boundaries and keep pins, archives, titles and invalid dates distinct',()=>{
 const listeners={},storage={getItem:k=>k==='tools_lang'?'en-US':null},window={addEventListener(){},ToolsI18n:{getLanguage:()=> 'en-US'}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/home/conversation-list.js'),'utf8'),{window,localStorage:storage,sessionStorage:storage,document:{readyState:'loading',addEventListener:(k,f)=>listeners[k]=f},Date,Map,WeakMap,Set,CustomEvent:class{}});
 const {bucket}=window.HomeConversationList,now=new Date(2026,9,26,12);
 for(const [age,label]of [[0,'recent'],[2,'recent'],[3,'three'],[6,'three'],[7,'week'],[29,'week'],[30,'month'],[300,'month']]){const date=new Date(2026,9,26-age,23);assert.equal(bucket(date.toISOString(),now),label)}
 assert.equal(bucket(null,now),'unknown');assert.equal(bucket('broken',now),'unknown');
});
test('Antigravity sidebar timestamps provide real coarse group dates instead of synchronization time',()=>{
 const {sidebarTime}=require('../backend/models/desktop-agents/antigravity-cdp'),now=Date.UTC(2026,9,26,12);
 assert.equal(sidebarTime('4d',now),new Date(now-4*86400000).toISOString());assert.equal(sidebarTime('1mo',now),new Date(now-30*86400000).toISOString());assert.equal(sidebarTime('Yesterday',now),new Date(now-86400000).toISOString());assert.equal(sidebarTime('unknown',now),null);
});
test('Antigravity local sqlite backfill enriches missing sidebar times for active and unread chats',async t=>{
 const sqlite3=require('sqlite3');
 const {antigravityTimestamps}=require('../backend/models/desktop-agents/catalog');
 const agDir=fs.mkdtempSync(path.join(os.tmpdir(),'ag-test-'));
 t.after(()=>fs.rmSync(agDir,{recursive:true,force:true}));
 process.env.ANTIGRAVITY_APP_DATA_DIR=agDir;
 t.after(()=>delete process.env.ANTIGRAVITY_APP_DATA_DIR);
 const dbPath=path.join(agDir,'conversation_summaries.db');
 const db=new sqlite3.Database(dbPath);
 await new Promise((res,rej)=>db.run('CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, last_modified_time TEXT, last_user_input_time TEXT)',err=>err?rej(err):res()));
 await new Promise((res,rej)=>db.run("INSERT INTO conversation_summaries VALUES ('c1', '2026-10-26 20:00:00.000000+00:00', '2026-10-26 19:50:00.000000+00:00')",err=>err?rej(err):res()));
 await new Promise(res=>db.close(res));
 const map=await antigravityTimestamps(['c1','c2']);
 assert.equal(map.get('c1'),'2026-10-26T20:00:00.000Z');
 assert.equal(map.has('c2'),false);
});

test('source filters combine with status and time across unified, desktop and channel lists',()=>{
 const events={},storage={getItem:()=>null};
 let channels=[{id:'weixin',label:'微信'},{id:'welink',label:'WeLink'}],providers=[{id:'codex',label:'Codex'}];
 const window={addEventListener:(name,fn)=>events[name]=fn,dispatchEvent(){},HomeDesktopAgents:{enabledProviders:()=>providers},HomeWelinkThreads:{channels:()=>channels}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/home/conversation-list.js'),'utf8'),{window,localStorage:storage,sessionStorage:storage,document:{readyState:'loading',addEventListener(){}},Date,Map,WeakMap,Set,CustomEvent:class{}});
 const api=window.HomeConversationList,now=new Date().toISOString(),item={_sourceType:'codex',cwd:'/workspace',updatedAt:now};
 assert.deepEqual(Array.from(api.getSources(),s=>s.id),['mine','codex','weixin','welink']);
 api.setFilter({source:'codex',status:'workspace',time:'today'});
 assert.equal(api.passesFilter(item,{},{}),true);
 assert.equal(api.passesFilter({...item,_sourceType:'mine'},{},{}),false);
 assert.equal(api.passesFilter({...item,cwd:''},{},{}),false);
 assert.equal(api.passesFilter({...item,updatedAt:'2000-01-01T00:00:00Z'},{},{}),false);
 api.setFilter({status:'all',time:'all'});
 assert.equal(api.passesFilter({}, {}, {source:'desktop:codex'}),true);
 api.setFilter({source:'disabled-provider'});assert.equal(api.getFilter().source,'codex');
 providers=[];events['home:desktop-agents-ready']();assert.equal(api.getFilter().source,'all');
 api.setFilter({source:'weixin',status:'group'});
 assert.equal(api.passesFilter({kind:'group'},{},{source:'weixin'}),true);
 assert.equal(api.passesFilter({kind:'group',channel:'welink'},{},{source:'mine'}),false);
 channels=[{id:'welink'}];events['tools:channels-updated']();assert.equal(api.getFilter().source,'all');
 assert.equal(api.getFilter().status,'group');
});
