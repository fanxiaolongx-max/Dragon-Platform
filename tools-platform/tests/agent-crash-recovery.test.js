const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dragon-crash-recovery-')));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const manager = require('../backend/models/agent-run-manager');
const transcripts = require('../backend/models/agent-transcript-repository');
const chat = require('../backend/models/ai-chat-repository');
const { runWithTenant } = require('../backend/models/tenant-context');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');

test.after(async () => { await pool.closeAll(); await appDb.closeDatabase(); fs.rmSync(sandbox, { recursive: true, force: true }); });

async function crashDuringTurn(name, gap = false, tenant = 'default') {
    const root = path.join(sandbox, name);
    fs.mkdirSync(root);
    const child = spawn(process.execPath, ['-e', `
        const manager=require('./backend/models/agent-run-manager'), tools=require('./backend/models/agent-tools-service');
        const chat=require('./backend/models/ai-chat-repository'), {runWithTenant}=require('./backend/models/tenant-context');
        runWithTenant(process.env.TEST_TENANT,async()=>{
            const id=await chat.getOrCreateSession({owner:'alice',pagePath:'/',pageTitle:'Dragon Claw'});
            const session=manager.ensureSession({agentSessionId:process.env.TEST_ID,user:{username:'alice',role:'admin'},tenantId:process.env.TEST_TENANT,root:process.env.TEST_ROOT,permissionMode:'full'});
            const ready=()=>process.stdout.write(JSON.stringify({chatId:id})+'\\n');
            if(process.env.TEST_GAP==='yes'){
                const execute=tools.execute;
                tools.execute=async(...args)=>{await execute(...args);ready();return new Promise(()=>{})};
            }
            let calls=0;
            await manager.runAgentTurn({session,chatSessionId:id,client:{model:'mock',generateText:async()=>{
                if(++calls===1)return {toolCalls:[{id:'write-once',name:'write_file',args:{path:'marker.txt',content:'exactly-once'}}]};
                ready();return new Promise(()=>{});
            }},systemInstruction:'',historyMessages:[{role:'user',content:'write the marker exactly once'}],write(){},signal:new AbortController().signal});
        }).catch(error=>{console.error(error);process.exit(1)});
        setInterval(()=>{},1000);
    `], { cwd: path.join(__dirname, '..'), env: { ...process.env, TEST_ID: name, TEST_ROOT: root, TEST_GAP: gap ? 'yes' : 'no', TEST_TENANT: tenant }, stdio: ['ignore', 'pipe', 'pipe'] });
    let payload;
    try {
        payload = await new Promise((resolve, reject) => {
            let buffer = '', errors = '';
            const timer = setTimeout(() => reject(new Error(`child checkpoint timeout: ${errors}`)), 10000);
            child.stdout.on('data', chunk => { buffer += chunk; const line = buffer.split('\n').find(item => item.startsWith('{"chatId"')); if (line) { clearTimeout(timer); resolve(JSON.parse(line)); } });
            child.stderr.on('data', chunk => { errors += chunk; });
            child.on('error', error => { clearTimeout(timer); reject(error); });
            child.on('exit', code => { clearTimeout(timer); if (!buffer.includes('chatId')) reject(new Error(`child exited ${code}: ${errors}`)); });
        });
    } finally {
        const exited = new Promise(resolve => child.once('exit', resolve));
        if (child.exitCode === null && !child.signalCode) { child.kill('SIGKILL'); await exited; }
    }
    return { root, chatId: payload.chatId, agentId: name };
}

test('SIGKILL after a completed tool restores context, undo and the first unfinished chat without repeating work', async () => {
    const fixture = await crashDuringTurn('crash-completed-step');
    assert.equal(fs.readFileSync(path.join(fixture.root, 'marker.txt'), 'utf8'), 'exactly-once');
    assert.equal(await manager.findLatestSessionId({ username: 'alice' }, 'default', fixture.root), fixture.agentId);
    const restored = await manager.restoreSession(fixture.agentId, { username: 'alice', role: 'admin' }, 'default', fixture.root);
    assert.ok(restored);
    const savedResult = restored.transcript.find(item => item.role === 'tool').toolResults[0];
    assert.equal(savedResult.isError, false);
    assert.match(savedResult.content, /marker.txt/);
    assert.equal(restored.changeLog.summary()[0].revertible, true);
    assert.equal((await chat.listOwnedSessions({ owner: 'alice', pagePath: '/' })).some(item => item.id === fixture.chatId), true);
    const rows = await chat.listMessages(fixture.chatId, { owner: 'alice' });
    assert.equal(rows.length, 2);
    assert.equal(rows[1].events.some(event => event.type === 'tool_result' && event.ok), true);
    assert.match(rows[1].content, /没有结束记录/);
    assert.equal((await chat.listMessages(fixture.chatId, { owner: 'alice' })).length, 2, 'recovery is idempotent');
    await manager.runAgentTurn({ session: restored, chatSessionId: fixture.chatId, client: { model: 'mock', generateText: async options => {
        assert.equal(options.messages.some(item => item.toolResults?.some(result => result.id === 'write-once')), true);
        return { text: 'The earlier write already completed; no second write is needed.' };
    } }, systemInstruction: '', historyMessages: [{ role: 'user', content: 'continue' }], write() {}, signal: new AbortController().signal });
    assert.equal((await chat.listMessages(fixture.chatId, { owner: 'alice' })).length, 4);
    assert.equal(fs.readFileSync(path.join(fixture.root, 'marker.txt'), 'utf8'), 'exactly-once');
});

test('SIGKILL between the file effect and result checkpoint restores a paired unknown result', async () => {
    const fixture = await crashDuringTurn('crash-effect-before-result', true);
    assert.equal(fs.existsSync(path.join(fixture.root, 'marker.txt')), true);
    const restored = await manager.restoreSession(fixture.agentId, { username: 'alice', role: 'admin' }, 'default', fixture.root);
    const result = restored.transcript.find(item => item.role === 'tool').toolResults[0];
    assert.equal(result.id, 'write-once');
    assert.equal(result.isError, true);
    assert.match(result.content, /操作状态未知/);
    assert.doesNotMatch(result.content, /^.*操作未执行/);
    const messages = await chat.listMessages(fixture.chatId, { owner: 'alice' });
    assert.equal(messages[1].events.some(event => event.type === 'tool_result' && /状态未知/.test(event.summary)), true);
});

test('crash recovery remains isolated in a tenant opened later and across user accounts', async () => {
    const fixture = await crashDuringTurn('tenant-crash-session', false, 'tenant-b');
    assert.equal(await transcripts.load(fixture.agentId), null);
    await runWithTenant('tenant-b', async () => {
        const saved = await transcripts.load(fixture.agentId);
        assert.equal(saved.owner, 'tenant-b::alice');
        await assert.rejects(chat.listMessages(fixture.chatId, { owner: 'bob' }), { code: 'AI_SESSION_FORBIDDEN' });
        assert.equal((await chat.listMessages(fixture.chatId, { owner: 'alice' })).length, 2);
    });
});
