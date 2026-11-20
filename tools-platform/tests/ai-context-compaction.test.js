const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-context-compact-')));
process.env.TOOLS_DATA_DIR = path.join(temp, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'report');
const chat = require('../backend/models/ai-chat-repository');
const compact = require('../backend/models/ai-context-compaction').compact;
const manager = require('../backend/models/agent-run-manager');
const transcripts = require('../backend/models/agent-transcript-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const db = require('../backend/models/app-db'), pool = require('../backend/models/tenant-sqlite-pool');
test.after(async () => { await pool.closeAll(); await db.closeDatabase(); fs.rmSync(temp,{recursive:true,force:true}); });

async function seed() {
    const id = await chat.getOrCreateSession({owner:'alice',pagePath:'/',pageTitle:'Dragon Claw'});
    for(let i=0;i<3;i++) {
        await chat.addMessage({sessionId:id,owner:'alice',role:'user',content:`question ${i} ${'context '.repeat(180)}`});
        await chat.addMessage({sessionId:id,owner:'alice',role:'model',content:`answer ${i} ${'evidence '.repeat(180)}`});
    }
    return id;
}

test('manual compaction keeps all messages but sends only summary + newest pair, without repeated summary calls',async()=>{
    const sessionId=await seed(); let calls=0;
    const client={generateText:async options=>{calls++;assert.equal(options.tools,undefined);assert.match(options.prompt,/question 0/);return {text:'Goals and confirmed facts; next action: verify latest evidence.'};}};
    const result=await compact({sessionId,owner:'alice',client});
    assert.equal(result.performed,true); assert.ok(result.afterChars<result.beforeChars);
    assert.equal((await chat.listMessages(sessionId,{owner:'alice'})).length,6);
    assert.equal((await chat.getRecentMessagesForContext(sessionId)).length,2);
    assert.match((await chat.getSession(sessionId)).summary,/Goals/);
    assert.equal((await compact({sessionId,owner:'alice',client})).performed,false);
    assert.equal(calls,1);
    await assert.rejects(compact({sessionId,owner:'bob',client}),{code:'AI_SESSION_FORBIDDEN'});
    await runWithTenant('second-tenant',async()=>assert.rejects(compact({sessionId,owner:'alice',client}),{code:'AI_SESSION_NOT_FOUND'}));
    await runWithTenant('second-tenant',async()=>{
        const own=await seed();
        assert.equal((await compact({sessionId:own,owner:'alice',client:{generateText:async()=>({text:'Named tenant handoff summary.'})}})).performed,true);
        assert.match((await chat.getSession(own)).summary,/Named tenant/);
        assert.equal((await chat.listMessages(own,{owner:'alice'})).length,6);
    });
});

test('empty, failed, aborted or concurrently changed summaries never replace the previous context',async()=>{
    const sessionId=await seed(), controller=new AbortController();
    await assert.rejects(compact({sessionId,owner:'alice',client:{generateText:async()=>({text:''})}}),{code:'AI_COMPACTION_EMPTY'});
    await assert.rejects(compact({sessionId,owner:'alice',client:{generateText:async()=>{throw new Error('provider unavailable');}}}),/provider unavailable/);
    await assert.rejects(compact({sessionId,owner:'alice',signal:controller.signal,client:{generateText:async()=>{controller.abort();return {text:'short'};}}}),{name:'AbortError'});
    await assert.rejects(compact({sessionId,owner:'alice',client:{generateText:async()=>{
        await chat.addMessage({sessionId,owner:'alice',role:'user',content:'new input during summary'});return {text:'short summary'};
    }}}),{code:'AI_CHAT_CHANGED'});
    assert.equal((await chat.getSession(sessionId)).summary,'');
    assert.equal((await chat.listMessages(sessionId,{owner:'alice'})).length,7);
});

test('agent compaction survives restore and continuation, keeps the recent tool pair/signature and all undo/archive data',async()=>{
    const root=path.join(temp,'project');fs.mkdirSync(root);
    const sessionId=await chat.getOrCreateSession({owner:'alice',pagePath:'/',pageTitle:'Dragon Claw'});
    const user={username:'alice',role:'admin'};
    const agent=manager.ensureSession({agentSessionId:'compact-agent-session',user,tenantId:'default',root,permissionMode:'full'});
    for(let turn=0;turn<3;turn++){
        let step=0;
        await manager.runAgentTurn({session:agent,chatSessionId:sessionId,systemInstruction:'',historyMessages:[{role:'user',content:`task ${turn} ${'details '.repeat(180)}`}],write(){},signal:new AbortController().signal,
            client:{model:'mock',generateText:async()=>++step===1?{toolCalls:[{id:`call-${turn}`,name:turn===0?'write_file':'read_file',args:turn===0?{path:'note.txt',content:'keep undo'}:{path:'note.txt'},thoughtSignature:'opaque-signature'}]}:{text:`done ${turn} ${'evidence '.repeat(180)}`}}});
    }
    const before=agent.transcript.length,changes=agent.changeLog.summary();
    const result=await compact({sessionId,owner:'alice',agentSession:agent,client:{generateText:async options=>{assert.match(options.prompt,/write_file/);return {text:'Created note.txt successfully. Read checks passed; continue the last task.'};}}});
    assert.equal(result.performed,true);assert.ok(agent.transcript.length<before);
    assert.deepEqual(agent.changeLog.summary(),changes);
    assert.equal(agent.permissionMode,'full');
    manager._internal.sessions.delete(agent.id);
    const restored=await manager.restoreSession(agent.id,user,'default',root);
    assert.deepEqual(restored.transcript,agent.transcript);
    assert.equal(restored.transcript.find(entry=>entry.toolCalls)?.toolCalls[0].thoughtSignature,'opaque-signature');
    assert.deepEqual(restored.changeLog.summary(),changes);
    assert.equal((await chat.listMessages(sessionId,{owner:'alice'})).length,6);
    assert.equal((await transcripts.listTurns({agentSessionId:agent.id,owner:agent.owner,root})).length,3);
    await manager.runAgentTurn({session:restored,chatSessionId:sessionId,systemInstruction:'',historyMessages:[{role:'user',content:'continue'}],write(){},signal:new AbortController().signal,
        client:{model:'mock',generateText:async options=>{assert.match(JSON.stringify(options.messages),/Created note.txt successfully/);return {text:'continued'};}}});
    assert.match(JSON.stringify((await transcripts.load(agent.id)).transcript),/Created note.txt successfully/);
    assert.equal((await chat.listMessages(sessionId,{owner:'alice'})).length,8);
});

test('before rolling compression a turn still sees all 21 unsummarized short messages', async () => {
    const route = require('../backend/routes/ai');
    const id = await chat.getOrCreateSession({ owner: 'history-gap', pagePath: '/' });
    for (let i = 0; i < 21; i++) {
        await chat.addMessage({ sessionId: id, owner: 'history-gap', role: i % 2 ? 'model' : 'user', content: i ? String(i) : '仅统计关闭工单' });
    }
    const messages = await route.buildEffectiveMessages({ sessionId: id, lastMessage: { role: 'user', content: '恢复月报' } });
    assert.equal(messages[0].content, '仅统计关闭工单');
});

test('topic checkpoints survive switches and scoped follow-ups', () => {
    const { summaryForTurn, topicQuery } = require('../backend/models/agent-topic-context');
    const notes = '## SLA 月报\n关闭 128 张；是否达标待核实 [m1]\n## 催办邮件\n草稿已完成 [m2]';
    assert.equal(summaryForTurn(notes, '回到 SLA 月报'), notes.split('\n## 催办')[0]);
    assert.doesNotMatch(summaryForTurn(notes, '写催办邮件'), /128/);
    assert.equal(summaryForTurn(notes, '翻译一个词'), '');
    assert.equal(topicQuery('继续', [{ role: 'user', content: '写催办邮件' }]), '写催办邮件');
    assert.equal(summaryForTurn('旧版摘要', '继续'), '旧版摘要');
});

test('keeps the exact user scope with its task when a generated summary omits it', () => {
    const { retainUserConstraints, summaryForTurn } = require('../backend/models/agent-topic-context');
    const notes = '## 邮件\n带伞\n## 月报\n已关闭12张，待处理3张';
    const quote = '青禾组月报仅统计已关闭的工单';
    const saved = retainUserConstraints(notes, [{ role: 'user', id: 'm1', content: quote }]);
    assert.match(summaryForTurn(saved, '月报'), /用户原话依据：\[m1\] 青禾组月报仅统计已关闭的工单/);
    assert.doesNotMatch(summaryForTurn(saved, '邮件'), /青禾/);
    assert.equal(retainUserConstraints(notes, [], saved), saved);
});

test('repeated continuations keep the last substantive user topic', () => {
    const { topicQuery, retainUserConstraints } = require('../backend/models/agent-topic-context');
    const history = ['整理展览通知', '继续', '接着来'].map(content => ({ role: 'user', content }));
    for (const followup of ['继续吧', '请继续', 'go on please']) assert.equal(topicQuery(followup, history), '整理展览通知');
    assert.equal(topicQuery('继续翻译这句话', history), '继续翻译这句话');
    assert.equal(retainUserConstraints('摘要', [{ role: 'model', content: '用户原话依据：已批准' }]), '摘要');
});

test('switching isolates a new task; returning restores prior turns and later continuations without the detour', () => {
    const { activeTopicRows, startsIndependentTopic } = require('../backend/models/agent-topic-context');
    const u = content => ({ role: 'user', content });
    const old = [u('月报只统计关闭工单'), { role: 'model', content: '共有12张。' }];
    const change = u('换个话题，草拟一封邮件');
    const back = u('回到刚才的月报');
    assert.deepEqual(activeTopicRows(old, change.content), []);
    const both = [...old, change, { role: 'model', content: '邮件草稿' }];
    assert.deepEqual(activeTopicRows(both, '继续'), both.slice(2));
    assert.deepEqual(activeTopicRows(both, back.content), old);
    assert.deepEqual(activeTopicRows([...both, back], '继续'), [...old, back]);
    assert.deepEqual(activeTopicRows(both, '换回原来的话题'), old);
    assert.equal(startsIndependentTopic('换个话题，但沿用刚才的表格'), false);
});

test('evidence checks source lines, owner, chat and boundary and ignores assistant guesses', async () => {
    const { lookup } = require('../backend/models/agent-history-evidence');
    const owner = 'evidence-test';
    const sessionId = await chat.addMessage({ owner, role: 'user', content: '查迁移任务' });
    const original = Array.from({ length: 260 }, (_, i) => i === 128 ? '专用核验回执 RZ-6804，状态已核实。' : '批次清点中').join('\n');
    await transcripts.saveTurn({ runId:'evidence-run', agentSessionId:'evidence-agent', owner:'default::'+owner,root:'/demo',
        status:'done', recovery:{ chatSessionId:sessionId,chatOwner:owner }, transcript:[
            {role:'user',content:'核对迁移记录'}, {role:'tool',toolResults:[{id:'probe',name:'read_file',content:original}]},
            {role:'model',content:'专用核验回执 m7'}] });
    const opts = {sessionId,username:owner,question:'请给出专用核验回执编号'};
    assert.match(await lookup(opts), /probe:129.*RZ-6804/);
    assert.doesNotMatch(await lookup(opts), /回执 m7/);
    await assert.rejects(lookup({...opts, username:'other'}));
    const other = await chat.addMessage({owner,role:'user',content:'另一个对话'});
    assert.doesNotMatch(await lookup({...opts,sessionId:other}), /RZ-6804/);
    await chat.addMessage({owner, sessionId,role:'user',content:'换个话题，处理快递'});
    const boundary = (await chat.getRecentMessagesForContext(sessionId)).at(-1).id;
    assert.doesNotMatch(await lookup({...opts,sinceId:boundary}), /RZ-6804/);
    for (const code of ['K-75','K-82']) await chat.addMessage({owner,sessionId,role:'user',content:'物流回执 '+code});
    const ambiguous = await lookup({...opts,question:'物流回执是多少？',sinceId:boundary});
    assert.match(ambiguous,/K-75/); assert.match(ambiguous,/K-82/);
    assert.equal(await lookup({...opts,question:'翻译蓝色'}),'');
});

test('retrieval distinguishes named projects and leaves an unseen project without a value', async () => {
    const {lookup} = require('../backend/models/agent-history-evidence');
    const username='project-probe';
    const sessionId=await chat.addMessage({owner:username,role:'user',content:'海棠项目回执 HT-17'});
    await chat.addMessage({sessionId,owner:username,role:'user',content:'银杏项目回执 YX-53'});
    const ask = name => lookup({username,sessionId,question:'请问'+name+'项目的回执编号是什么'});
    assert.match(await ask('海棠'),/HT-17/);
    assert.doesNotMatch(await ask('海棠'),/YX-53/);
    assert.doesNotMatch(await ask('长松'),/YX-53|HT-17/);
});

test('returning to a topic repeatedly restores its original scope and its subsequent corrections', () => {
    const {activeTopicRows} = require('../backend/models/agent-topic-context');
    const rows = ['海棠月报分母12', '换个话题，写邮件', '回到海棠月报', '更正，分母是11', '换个话题，翻译诗歌'].map(content=>({role:'user',content}));
    assert.deepEqual(activeTopicRows(rows, '回到海棠月报'), [rows[0],rows[2],rows[3]]);
});

test('scoped artifact recall reads a spilled middle line and rejects a result from another chat', async () => {
    const artifacts = require('../backend/models/agent-artifacts');
    const {lookup} = require('../backend/models/agent-history-evidence');
    const username = 'spill-check';
    const sessionId = await chat.addMessage({owner:username,role:'user',content:'核对归档'});
    const owner = 'default::' + username;
    const data = Array.from({length:901}, (_,i) => i === 451 ? '取件回执 PC-6031 已确认' : '系统记录：此批次已完成同步。').join('\n');
    const saved = await artifacts.spill({owner,sessionId,callId:'probe',toolName:'search',content:data});
    assert.ok(saved.artifact);
    const events = [{type:'tool_result',ok:true,callId:'probe',artifact:saved.artifact}];
    await chat.addMessage({owner:username,sessionId,role:'model',content:'处理完毕',events});
    assert.match(await lookup({username,sessionId,question:'取件回执是什么'}), /probe:452.*PC-6031/);
    const other = await chat.addMessage({owner:username,role:'user',content:'另一个任务'});
    await chat.addMessage({owner:username,sessionId:other,role:'model',content:'完成',events});
    assert.doesNotMatch(await lookup({username,sessionId:other,question:'取件回执是什么'}), /PC-6031/);
});

test('recalls an early multi-megabyte result after 20 newer archives for a similar project', async () => {
    const artifacts = require('../backend/models/agent-artifacts');
    const { lookup } = require('../backend/models/agent-history-evidence');
    const username = 'archive-stress';
    const sessionId = await chat.addMessage({owner: username, role: 'user', content: '核对测试批次'});
    const append = async (id, content) => {
        const { artifact } = await artifacts.spill({owner: 'default::' + username, sessionId, callId: id, content});
        await chat.addMessage({owner: username, sessionId, role: 'model', content: '完成',
            events: [{type: 'tool_result', ok: true, callId: id, artifact}]});
        return artifact;
    };
    const side = '同步状态正常。'.repeat(18) + '\n';
    const big = await append('early', side.repeat(4000) + '琥珀项目回执 HP-7052\n' + side.repeat(4000));
    assert.ok(big.size > 2 * 1024 * 1024);
    assert.doesNotMatch(JSON.stringify(big.refs), /HP-7052/);
    for (let i = 0; i < 20; i++) await append('later-' + i, side.repeat(80) + '云杉项目回执 YS-' + i);
    const ask = project => lookup({username, sessionId, question: project + '项目的回执是什么'});
    const result = await ask('琥珀');
    assert.match(result, /early:4001.*HP-7052/);
    assert.doesNotMatch(result, /YS-/);
    assert.doesNotMatch(await ask('红杉'), /HP-7052|YS-/);
});

test('vague follow-ups select an established project or present only candidate names', () => {
    const { summaryForTurn } = require('../backend/models/agent-topic-context');
    const summary = '## 海棠项目\n预算12万\n## 紫藤项目\n预算6万';
    const q = '刚才那个项目预算多少';
    assert.equal(summaryForTurn(summary, q, [{role:'user',content:'先看紫藤项目'}]), '## 紫藤项目\n预算6万');
    for (const rows of [[], [{role:'user',content:'海棠和紫藤一起看'}]]) {
        const result = summaryForTurn(summary, q, rows);
        assert.match(result, /海棠.*紫藤/);
        assert.doesNotMatch(result, /12万|6万/);
    }
});

test('retains the original and latest user budget after more revisions than the recent evidence window', async () => {
    const {lookup} = require('../backend/models/agent-history-evidence');
    const username = 'revision-test';
    const sessionId = await chat.addMessage({owner:username, role:'user', content:'青禾项目预算为35万元'});
    for (let i=0;i<15;i++) await chat.addMessage({owner:username,sessionId,role:'user',content:'青禾项目预算更正为'+(20+i)+'万元'});
    await chat.addMessage({owner:username,sessionId,role:'user',content:'云杉项目预算更正为88万元'});
    const result = await lookup({sessionId,username,question:'青禾项目最初和现在的预算是多少？'});
    assert.match(result,/35万元/);
    assert.match(result,/34万元/);
    assert.doesNotMatch(result,/88万元/);
    assert.equal(await lookup({sessionId,username,question:'写一个预算模板'}), '');
});
