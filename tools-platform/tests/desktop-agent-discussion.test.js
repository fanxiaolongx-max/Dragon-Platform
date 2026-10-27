const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tac-group-'));process.env.TOOLS_DATA_DIR=path.join(root,'data');
const db=require('../backend/models/app-db'),chat=require('../backend/models/ai-chat-repository'),host=require('../backend/models/desktop-agents/repository'),desktop=require('../backend/models/desktop-agents/service'),groups=require('../backend/models/desktop-agents/discussion');
const {runWithTenant}=require('../backend/models/tenant-context');
const start=(extra={})=>groups.start('alice',{text:'Discuss the interface',requestId:crypto.randomUUID(),...extra});
const created=[];
const create=async(provider,text)=>{const id=(provider==='claudecode'?'local_':'')+crypto.randomUUID();created.push({provider,id,text});return{id,status:'accepted'};};
const finish=job=>groups.execute('alice',job.id,{create,send:async()=>({status:'accepted'}),wait:async(_o,p)=>p+' native response'});
test.before(()=>host.save('alice',{enabled:true,allowSend:true,claudeAutomation:true}));
test.after(async()=>{await db.closeDatabase();await require('../backend/models/platform-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();fs.rmSync(root,{recursive:true,force:true});});
test('selecting DragonTAC always means one group, with no manual binding or routing modes',()=>{
 for(const mode of ['off','parallel','cycle','random','group']){const cfg=groups.config({mode,rounds:99,bindings:{codex:'an-existing-business-conversation'}});assert.equal(cfg.mode,'group');assert.equal(cfg.version,2);assert.deepEqual(cfg.bindings,{});}
});
test('the first message creates all three fresh desktop conversations and keeps the original platform conversation',async()=>{
 const sessionId=await chat.addMessage({owner:'alice',pagePath:'/',pageTitle:'Existing',role:'user',content:'Earlier constraints'}),requestId=crypto.randomUUID();
 const job=await start({sessionId,requestId,settings:{bindings:{codex:crypto.randomUUID()}}});assert.equal(job.sessionId,sessionId);assert.equal(job.reports.length,3);assert.ok(job.reports.every(r=>!r.nativeId));
 assert.equal((await start({sessionId,requestId})).id,job.id);assert.equal((await groups.current('alice',sessionId)).id,job.id);
 const before=created.length,done=await finish(job);assert.equal(done.status,'done');assert.equal(created.length-before,3);assert.ok(created.slice(before).every(r=>r.text.includes('Earlier constraints')));assert.ok(created[before+1].text.includes('codex native response'),'members see actual completed opinions');
 const cfg=await groups.settings('alice',sessionId);assert.equal(Object.keys(cfg.bindings).length,3);for(const row of created.slice(before))assert.equal(cfg.bindings[row.provider],row.id);
 assert.equal((await chat.listOwnedSessions({owner:'alice',pagePath:'/'})).find(row=>row.id===sessionId).discussionMode,'group','list exposes persisted group markers');
 assert.deepEqual(await chat.listOwnedSessions({owner:'bob',pagePath:'/'}),[],'group markers remain owner scoped');
 const history=await chat.listMessages(sessionId,{owner:'alice'});assert.equal(history.filter(m=>m.content==='Discuss the interface').length,1);for(const name of ['Codex','Claude Code','Antigravity'])assert.ok(history.some(m=>m.role==='model'&&m.content.includes(name)));
 assert.equal(await groups.current('alice',sessionId),null);await finish(job);assert.equal(created.length-before,3,'completed jobs are not dispatched again');
});
test('enabling an existing chat persists group mode and cannot be changed back through settings',async()=>{
 const id=await chat.addMessage({owner:'alice',role:'user',content:'Ordinary chat before enabling the group'});
 assert.equal((await chat.listOwnedSessions({owner:'alice',pagePath:'/'})).find(row=>row.id===id).discussionMode,null);
 await groups.saveSettings('alice',id,{mode:'group'});
 assert.equal((await chat.listOwnedSessions({owner:'alice',pagePath:'/'})).find(row=>row.id===id).discussionMode,'group');
 await groups.saveSettings('alice',id,{mode:'off'});
 assert.equal((await groups.settings('alice',id)).mode,'group');
 assert.equal((await chat.listMessages(id,{owner:'alice'})).length,1,'choosing a mode does not send or rewrite messages');
});
test('later turns reuse only the group-created native IDs; a new group creates new IDs',async()=>{
 const first=await start();await finish(first);const bindings=(await groups.settings('alice',first.sessionId)).bindings;
 const next=await start({sessionId:first.sessionId}),sent=[];
 await groups.execute('alice',next.id,{create:async()=>{throw Error('must not create again');},send:async(_o,provider,id)=>{sent.push({provider,id});return{status:'accepted'};},wait:async()=> 'follow-up reply'});
 assert.equal(sent.length,3);for(const row of sent)assert.equal(row.id,bindings[row.provider]);
 const fresh=await start();await finish(fresh);const newBindings=(await groups.settings('alice',fresh.sessionId)).bindings;for(const provider of Object.keys(bindings))assert.notEqual(bindings[provider],newBindings[provider]);
});
test('an unavailable or unconfirmed member never causes a fallback into an old chat or blocks the remaining members',async()=>{
 const job=await start(),calls=[];const done=await groups.execute('alice',job.id,{create:async(provider,text)=>{calls.push(provider);if(provider==='codex')throw Object.assign(Error('new conversation not confirmed'),{status:504});return create(provider,text);},send:async()=>{throw Error('must not reuse a recent chat');},wait:async()=> 'member answer'});
 assert.equal(done.status,'done');assert.equal(done.reports[0].status,'unknown');assert.deepEqual(calls,['codex','claudecode','antigravity']);
 const failed=await start();await groups.execute('alice',failed.id,{create:async()=>{throw Error('desktop offline');},wait:async()=>{throw Error('must not wait');}});assert.equal((await groups.get('alice',failed.id)).status,'failed');
});
test('ownership, tenant isolation, one active group turn and credential boundaries are enforced',async()=>{
 const job=await start();await assert.rejects(start({sessionId:job.sessionId}),e=>e.status===409);await assert.rejects(groups.get('bob',job.id),e=>e.status===404);await assert.rejects(groups.saveSettings('bob',job.sessionId,{}),e=>e.statusCode===403);
 await runWithTenant('other',()=>assert.rejects(groups.get('alice',job.id),e=>e.status===404));await assert.rejects(start({text:'password="do-not-send"'}));await finish(job);
 await host.save('alice',{allowSend:false});await assert.rejects(start(),e=>e.status===409);await host.save('alice',{allowSend:true});
});
test('stopping a group prevents creation of later members without claiming to stop native work',async()=>{
 const job=await start();let ready,count=0;const started=new Promise(r=>ready=r);
 const run=groups.execute('alice',job.id,{create:async(provider,text)=>{count++;return create(provider,text);},wait:async(_o,_p,_id,_text,{signal})=>{ready();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 await started;await groups.cancel('alice',job.id);assert.equal((await run).status,'cancelled');assert.equal(count,1);assert.ok((await chat.listMessages(job.sessionId,{owner:'alice'})).some(m=>m.content.includes('原客户端停止')));
});
test('native completion is correlated to the exact user prompt, not progress or an unrelated next turn',async()=>{
 const prompt='specific group prompt';let polls=0;
 const answer=await desktop.waitForReply('alice','codex','id',prompt,{pollDelay:1,timeoutMs:300,read:async()=>({items:[{role:'user',content:prompt},{role:'assistant',channel:'commentary',content:'working'},{role:'assistant',channel:'final',content:'final reply'}]}),runtime:async()=>({threadRuntimeStatus:{type:++polls===1?'active':'idle'}})});assert.equal(answer,'final reply');assert.equal(polls,2);
 const multiline='[DragonTAC:line-break-test]\n\nQuestion\n\n';
 assert.equal(await desktop.waitForReply('alice','codex','id',multiline,{pollDelay:1,timeoutMs:300,read:async()=>({items:[{role:'user',content:'[DragonTAC:line-break-test]\nQuestion'},{role:'assistant',channel:'final',content:'matched paragraph rendering'}]}),runtime:async()=>({threadRuntimeStatus:{type:'idle'}})}),'matched paragraph rendering');
 await assert.rejects(desktop.waitForReply('alice','codex','id',prompt,{read:async()=>({items:[{role:'user',content:prompt},{role:'user',content:'a new question'}]})}),/另一条用户消息/);
});
test('interrupted group creation is not replayed after a server restart',async()=>{
 const job=await start();await db.closeDatabase();const interrupted=await groups.get('alice',job.id);assert.equal(interrupted.status,'interrupted');assert.equal(interrupted.reports[0].status,'unknown');let sends=0;await groups.execute('alice',job.id,{create:async()=>{sends++;}});assert.equal(sends,0);
});
