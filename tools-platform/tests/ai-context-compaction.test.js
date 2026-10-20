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
