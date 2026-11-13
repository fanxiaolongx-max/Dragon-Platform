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
 assert.equal(api.passesFilter({...item,cwd:'/tmp/dragon-claw-scratch/5926f323fced0775'},{},{}),false);
 assert.equal(api.passesFilter({...item,agent:{root:'/data/scratch/abc'}},{},{}),false);
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

test('third-party desktop agents and channel chats notice users on rename attempt without network error', async () => {
 const alerts = [];
 let promptCalled = false, requestCalled = false;
 const window = {
  addEventListener() {},
  dispatchEvent() {},
  AppDialog: {
   alert: async (msg, opts) => { alerts.push({ msg, opts }); },
   prompt: async () => { promptCalled = true; return 'New Title'; }
  },
  fetch: async () => { requestCalled = true; return { ok: true, json: async () => ({}) }; }
 };
 const storage = { getItem: k => k === 'tools_user' ? 'alice' : null };
 const mockDoc = {
  readyState: 'complete',
  documentElement: { dataset: {} },
  addEventListener: () => {},
  createElement: () => ({ addEventListener() {}, setAttribute() {}, append() {}, before() {} }),
  body: { append() {} }
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/home/conversation-list.js'), 'utf8'), {
  window, fetch: window.fetch, localStorage: storage, sessionStorage: storage, document: mockDoc, Date, Map, WeakMap, Set, CustomEvent: class {}
 });
 const api = window.HomeConversationList;
 requestCalled = false;

 // 1. 测试三方 Agent 会话（如 antigravity）触发重命名
 const agentItem = { id: 'session-123', _sourceType: 'antigravity', title: '增强 DragonClaw页面上下文问答' };
 const config = { source: 'mine', items: [agentItem], id: s => s.id, title: s => s.title };
 await api._action(config, agentItem, 'rename');
 assert.equal(alerts.length, 1);
 assert.match(alerts[0].msg, /第三方 Agent 对话名称由原客户端管理，暂不支持重命名/);
 assert.equal(promptCalled, false);
 assert.equal(requestCalled, false);

 // 2. 测试外部频道会话（如 weixin）触发重命名
 const channelItem = { id: 'wx-123', _sourceType: 'weixin', title: '客户技术支持群' };
 await api._action(config, channelItem, 'rename');
 assert.equal(alerts.length, 2);
 assert.match(alerts[1].msg, /外部频道对话名称由原客户端管理，暂不支持重命名/);
 assert.equal(promptCalled, false);
 assert.equal(requestCalled, false);

 // 3. 测试平台原生 Dragon Claw 会话触发重命名
 const mineItem = { id: 'chat-999', _sourceType: 'mine', title: '平台数据排查' };
 await api._action(config, mineItem, 'rename');
 assert.equal(promptCalled, true);
 assert.equal(requestCalled, true);
});

test('timestamp parser treats SQLite UTC string consistently with ISO strings across midnight boundaries', () => {
 const window = { addEventListener() {}, dispatchEvent() {} };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../frontend/js/home/conversation-list.js'), 'utf8'), {
  window, localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
  document: { readyState: 'complete', documentElement: { dataset: {} }, addEventListener: () => {} },
  Date, Map, WeakMap, Set, CustomEvent: class {}
 });
 const { stamp } = window.HomeConversationList;
 // 模拟场景：
 // 对话 A: 昨天 21:50 UTC (本地 23:50，三方 Agent ISO 格式)
 // 对话 B: 今天 22:42 UTC (本地 00:42，SQLite CURRENT_TIMESTAMP 格式 "YYYY-MM-DD HH:MM:SS")
 const agentIsoTime = '2026-11-05T21:50:22.885Z';
 const sqliteUtcTime = '2026-11-05 22:42:21';
 const timeA = stamp(agentIsoTime);
 const timeB = stamp(sqliteUtcTime);
 assert.equal(Number.isNaN(timeA), false);
 assert.equal(Number.isNaN(timeB), false);
 // 对话 B (22:42 UTC) 应比 对话 A (21:50 UTC) 更新
 assert.ok(timeB > timeA, `Expected ${sqliteUtcTime} (${timeB}) to be newer than ${agentIsoTime} (${timeA})`);
});

test('Antigravity local storage catalog reads conversation list, busy status, and full transcript with usage rounds without invented decode timing', async t => {
 const sqlite3 = require('sqlite3');
 const { antigravity, antigravityBusyIds, antigravityTranscript } = require('../backend/models/desktop-agents/catalog');
 const agDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-local-'));
 t.after(() => fs.rmSync(agDir, { recursive: true, force: true }));
 process.env.ANTIGRAVITY_APP_DATA_DIR = agDir;
 t.after(() => delete process.env.ANTIGRAVITY_APP_DATA_DIR);

 const convId = '11111111-2222-3333-4444-555555555555';
 const subId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const nowIso = new Date().toISOString();
 const dbPath = path.join(agDir, 'conversation_summaries.db');
 const db = new sqlite3.Database(dbPath);
 await new Promise((res, rej) => db.run(
  'CREATE TABLE conversation_summaries (conversation_id TEXT PRIMARY KEY, title TEXT, preview TEXT, status TEXT, last_modified_time TEXT, last_user_input_time TEXT, workspace_uris TEXT, parent_conversation_id TEXT, killed INTEGER, not_fully_idle INTEGER)',
  err => err ? rej(err) : res()
 ));
 await new Promise((res, rej) => db.run(
  `INSERT INTO conversation_summaries VALUES ('${convId}', '优化右侧工作区面板', '预览文本', 'CASCADE_RUN_STATUS_RUNNING', '${nowIso}', '${nowIso}', '["file:///Volumes/512G/project"]', '', 0, 1)`,
  err => err ? rej(err) : res()
 ));
 await new Promise((res, rej) => db.run(
  `INSERT INTO conversation_summaries VALUES ('${subId}', 'Subagent task', '', 'CASCADE_RUN_STATUS_IDLE', '${nowIso}', '${nowIso}', '[]', '${convId}', 0, 0)`,
  err => err ? rej(err) : res()
 ));
 await new Promise(res => db.close(res));

 const logDir = path.join(agDir, 'brain', convId, '.system_generated', 'logs');
 const mediaDir = path.join(agDir, 'brain', convId, '.user_uploaded');
 fs.mkdirSync(logDir, { recursive: true });
 fs.mkdirSync(mediaDir, { recursive: true });
 const imgPath = path.join(mediaDir, 'shot.png');
 fs.writeFileSync(imgPath, 'png');
 const steps = [
  { step_index: 1, type: 'USER_INPUT', created_at: '2026-11-07T12:00:00Z', content: '<USER_REQUEST>\n检查这段代码\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed `Model Selection` from Gemini 3.0 Flash to Gemini 3.1 Pro (High).\n</USER_SETTINGS_CHANGE>', media: [{ mime_type: 'image/png', uri: imgPath }] },
  { step_index: 2, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-07T12:00:01Z', thinking: '先读取文件', input_tokens: 1000, cache_read_tokens: 500, output_tokens: 200, tool_calls: [{ name: 'read_file' }] },
  { step_index: 3, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-07T12:00:05Z', content: '已经修复完成。', input_tokens: 1600, cache_read_tokens: 400, output_tokens: 100 }
 ];
 fs.writeFileSync(path.join(logDir, 'transcript_full.jsonl'), steps.map(s => JSON.stringify(s)).join('\n') + '\n');

 const list = await antigravity(10);
 assert.equal(list.length, 1);
 assert.equal(list[0].id, convId);
 assert.equal(list[0].title, '优化右侧工作区面板');
 assert.equal(list[0].cwd, '/Volumes/512G/project');

 const busy = await antigravityBusyIds();
 assert.deepEqual([...busy], [convId]);

 const res = await antigravityTranscript(list[0]);
 assert.equal(res.available, true);
 const messages = res.items;
 assert.equal(messages.length, 2);
 assert.equal(messages[0].role, 'user');
 assert.equal(messages[0].content, '检查这段代码');
 assert.equal(messages[0].attachments.length, 1);
 assert.equal(messages[1].role, 'assistant');
 assert.equal(messages[1].content, '已经修复完成。');
 assert.equal(messages[1].rounds.length, 2);
 assert.equal(messages[1].rounds[0].model, 'Gemini 3.1 Pro (High)');
 assert.equal(messages[1].rounds[0].inputTokens, 1500);
 assert.equal(messages[1].rounds[0].outputTokens, 200);
 assert.equal(messages[1].rounds[0].tps, null);
 assert.equal(messages[1].rounds[0].timingEstimated, true);
 assert.equal(messages[1].rounds[0].cachedInputTokens, 500);
});
