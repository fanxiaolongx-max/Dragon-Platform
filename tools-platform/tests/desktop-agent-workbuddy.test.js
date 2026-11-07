const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-workbuddy-'));
const home = path.join(root, 'home');
process.env.TOOLS_DESKTOP_AGENT_HOME = home;
delete process.env.WORKBUDDY_CONFIG_DIR;
delete process.env.CODEBUDDY_API_KEY;
const sqlite3 = require('../backend/node_modules/sqlite3');
const wb = require('../backend/models/desktop-agents/workbuddy');
const GUI = '33333333-3333-4333-8333-333333333333', CLI = '44444444-4444-4444-8444-444444444444', GONE = '55555555-5555-4555-8555-555555555555';
const cwd = path.join(root, 'project.app');
const projects = path.join(home, '.workbuddy/projects'), dir = path.join(projects, wb.projectSlug(cwd));
const transcript = path.join(dir, GUI + '.jsonl');
const line = x => JSON.stringify(x) + '\n';
const query = text => [{ type: 'input_text', text: `<system-reminder data-role="user-context">\n<user_info>OS</user_info>\n</system-reminder>\n<user_query>${text}</user_query>` }];
// 假 CLI：按 CODEBUDDY_CONFIG_DIR/projects 写入（经软链落到桌面端会话目录），模拟登录失败
const fake = path.join(root, 'codebuddy');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs=require('fs'),path=require('path');let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
 const args=process.argv.slice(2),id=args[args.indexOf('--resume')>=0?args.indexOf('--resume')+1:args.indexOf('--session-id')+1];
 if(input.includes('needs-login')){console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Authentication required. Please use /login command to sign in to your account'}]}}));process.exit(1);}
 const slug=process.env.FAKE_CWD.replace(/^\\/+/,'').replace(/[\\/:.]+/g,'-'),file=path.join(process.env.CODEBUDDY_CONFIG_DIR,'projects',slug,id+'.jsonl');
 fs.mkdirSync(path.dirname(file),{recursive:true});
 fs.appendFileSync(file,JSON.stringify({type:'message',role:'user',timestamp:Date.now(),cwd:process.env.FAKE_CWD,content:[{type:'input_text',text:input}]})+'\\n');
 fs.writeFileSync(path.join(path.dirname(file),'..','..','args.json'),JSON.stringify(args));
 console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'ok'}]}}));
 fs.appendFileSync(file,JSON.stringify({type:'message',role:'assistant',timestamp:Date.now()+1,content:[{type:'output_text',text:'CLI answer'}]})+'\\n');
});
`, { mode: 0o755 });
process.env.TOOLS_WORKBUDDY_CLI = fake;
process.env.FAKE_CWD = cwd;

test.before(async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(transcript, [
        { type: 'session-meta', sessionId: GUI, timestamp: 1793000000000 },
        { type: 'message', role: 'user', timestamp: 1793000001000, content: query('第一个问题') },
        { type: 'reasoning', timestamp: 1793000002000, rawContent: [{ type: 'reasoning_text', text: 'private reasoning' }] },
        { type: 'function_call', timestamp: 1793000003000, name: 'Bash' },
        { type: 'function_call_result', timestamp: 1793000004000, output: { text: 'private tool output' } },
        { type: 'message', role: 'assistant', timestamp: 1793000005000, content: [{ type: 'output_text', text: '桌面回答' }] }
    ].map(line).join(''));
    fs.writeFileSync(path.join(dir, CLI + '.jsonl'), line({ type: 'ai-title', aiTitle: 'CLI 会话', cwd }) + line({ type: 'message', role: 'user', timestamp: 1793000009000, cwd, content: [{ type: 'input_text', text: 'hi' }] }));
    fs.writeFileSync(path.join(dir, GONE + '.jsonl'), line({ type: 'message', role: 'user', cwd, content: [{ type: 'input_text', text: 'deleted' }] }));
    const db = new sqlite3.Database(path.join(home, '.workbuddy/workbuddy.db'));
    await new Promise((resolve, reject) => db.serialize(() => {
        db.run('CREATE TABLE sessions(id TEXT,cwd TEXT,title TEXT,custom_title TEXT,status TEXT,created_at INTEGER,updated_at INTEGER,last_activity_at INTEGER,deleted_at INTEGER,is_background_automation INTEGER,permission_mode TEXT,transport TEXT)');
        db.run("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,NULL,0,'fullAccess','local')", [GUI, cwd, '原标题', '桌面标题', 'completed', 1, 1793000005000, 1793000005000]);
        db.run("INSERT INTO sessions VALUES(?,?,?,NULL,'completed',1,1,1,1793000000000,0,'','local')", [GONE, cwd, '已删除'], e => db.close(() => e ? reject(e) : resolve()));
    }));
});

test('lists desktop sessions and CLI-only transcripts, never deleted ones', async () => {
    const rows = await wb.list(20);
    assert.deepEqual(rows.map(r => r.id).sort(), [GUI, CLI].sort());
    assert.equal(rows.find(r => r.id === GUI).title, '桌面标题');
    assert.equal(rows.find(r => r.id === CLI).title, 'CLI 会话');
    assert.equal(rows.find(r => r.id === CLI).source, 'desktop-cli');
});

test('transcript shows only the user query and visible replies', async () => {
    const [row] = (await wb.list(20)).filter(r => r.id === GUI);
    const { items, busy } = await wb.transcript(row);
    assert.deepEqual(items.map(i => [i.role, i.content]), [['user', '第一个问题'], ['assistant', '桌面回答']]);
    assert.equal(busy, false);
    assert.doesNotMatch(JSON.stringify(items), /private|system-reminder/);
});

test('sends through the CLI on the same session via the shared projects link', async () => {
    const [row] = (await wb.list(20)).filter(r => r.id === GUI);
    await wb.send(row, '继续');
    const link = path.join(home, '.workbuddy-connector/projects');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    const args = JSON.parse(fs.readFileSync(path.join(home, '.workbuddy-connector/args.json'), 'utf8'));
    assert.deepEqual(args.slice(args.indexOf('--resume'), args.indexOf('--resume') + 2), ['--resume', GUI]);
    assert.equal(args[args.indexOf('--permission-mode') + 1], 'bypassPermissions');
    for (let n = 0; n < 50 && wb.running.has(GUI); n++) await new Promise(r => setTimeout(r, 20));
    const { items } = await wb.transcript(row);
    assert.deepEqual(items.slice(-2).map(i => i.content), ['继续', 'CLI answer']);
});

test('reports a missing CLI login instead of silently failing', async () => {
    const [row] = (await wb.list(20)).filter(r => r.id === GUI);
    await assert.rejects(wb.send(row, 'needs-login'), e => e.code === 'NOT_LOGGED_IN' && /\/login/.test(e.message));
});

test('status explains the send route and missing login', async () => {
    const state = await wb.status([]);
    assert.equal(state.canSend, true);
    assert.match(state.reason, /未检测到 CLI 登录/);
});

test('syncs WorkBuddy upload blobs and explicitly presented artifacts, never arbitrary tool paths', async () => {
    const file = path.join(dir, 'attachments.jsonl');
    const image = path.join(home, '.workbuddy/blobs/ab/image.png');
    const result = path.join(cwd, 'result.png'), report = path.join(cwd, 'report.pdf');
    const present = (files, status = 'completed') => ({ type: 'function_call_result', name: 'present_files', status, output: [{ type: 'input_text', text: JSON.stringify({ type: 'present_files_result', files }) }] });
    const blob = { type: 'image_blob_ref', blob_path: image, original_filename: 'Clipboard_Screenshot.png' };
    const events = [
        { type: 'message', role: 'user', content: [...query('@image#1:Clipboard_Screenshot.png 用这个改'), blob, blob] },
        { type: 'function_call', name: 'ViewImage', arguments: { image_path: '/tmp/private-tool.png' } },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '处理中' }] },
        present([result, result, report, 'relative.png', 'https://example.com/x.png', '/tmp/bad\nfile.png']),
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '做好了' }] },
        { type: 'message', role: 'user', content: [blob] },
        present(['/tmp/failed.png'], 'failed'),
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '再看一下' }] },
        present(['/tmp/stale.png']),
        { type: 'message', role: 'user', content: query('换个话题') },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '新回答' }] },
        { type: 'message', isSidechain: true, role: 'assistant', content: [blob] }
    ];
    fs.writeFileSync(file, events.map(line).join(''));
    const { items } = await wb.transcript({ id: GUI, file, status: 'completed' });
    assert.equal(items.length, 7);
    assert.equal(items[0].content, '用这个改');
    assert.deepEqual(items[0].attachments, [{ path: image, name: 'Clipboard_Screenshot.png' }]);
    assert.equal(items[1].attachments, undefined);
    assert.deepEqual(items[2].attachments.map(f => f.path), [result, report]);
    assert.equal(items[3].content, '');
    assert.equal(items[3].attachments[0].name, 'Clipboard_Screenshot.png');
    assert.equal(items[4].attachments, undefined);
    assert.equal(items[6].attachments, undefined, 'presentation does not leak into another turn');
});

test('keeps successful WorkBuddy widgets between visible replies and ignores failed, sidechain and stale results', async () => {
    const file = path.join(dir, 'widgets.jsonl');
    const html = '<div style="color: red">工作区预览</div>';
    const call = (callId, extra = {}) => ({ type: 'function_call', name: 'show_widget', callId, arguments: JSON.stringify({ title: '面板', widget_code: html }), ...extra });
    const result = (callId, extra = {}) => ({ type: 'function_call_result', name: 'show_widget', callId, status: 'completed', output: [{ type: 'input_text', text: JSON.stringify({ type: 'visualizer_show_widget_result', success: true, widget_code: 'escaped result must not replace original HTML' }) }], ...extra });
    const message = (role, text) => ({ type: 'message', role, content: [{ type: 'text', text }] });
    fs.writeFileSync(file, [message('assistant', '先看样子'), call('ok'), result('ok'), result('ok'), message('assistant', '后续说明'),
        call('failed'), result('failed', { status: 'failed' }), call('side', { isSidechain: true }), result('side'),
        call('side-result'), result('side-result', { isSidechain: true }), call('stale'), message('user', '换话题'), result('stale'),
        call('invalid', { arguments: '{' }), result('invalid'), call('oversize', { arguments: JSON.stringify({ widget_code: 'x'.repeat(200001) }) }), result('oversize')
    ].map(line).join(''));
    const { items } = await wb.transcript({ id: GUI, file, status: 'completed' });
    assert.deepEqual(items.map(i => i.widget ? 'widget' : i.content), ['先看样子', 'widget', '后续说明', '换话题']);
    assert.deepEqual(items[1].widget, { title: '面板', html });
    assert.equal(items[1].id, 'widget:ok');
});

test('accurately identifies busy state when WorkBuddy is working, streaming, or running tools', async () => {
    assert.ok(wb.BUSY_STATUS.has('working'));
    assert.ok(wb.BUSY_STATUS.has('running'));
    assert.ok(wb.BUSY_STATUS.has('in_progress'));

    const workingId = '66666666-6666-4666-8666-666666666666';
    const workingFile = path.join(dir, workingId + '.jsonl');
    const now = Date.now();

    // 1. 模拟 WorkBuddy 输出还未完成，中间经过了工具调用且有部分助手输出
    fs.writeFileSync(workingFile, [
        { type: 'message', role: 'user', timestamp: now - 30000, content: query('帮我批量修改文件') },
        { type: 'message', role: 'assistant', timestamp: now - 25000, content: [{ type: 'output_text', text: '开始处理，先跑第一步...' }] },
        { type: 'function_call', name: 'Bash', timestamp: now - 20000 },
        { type: 'function_call_result', name: 'Bash', status: 'completed', timestamp: now - 15000, output: { text: 'ok' } },
        { type: 'reasoning', timestamp: now - 10000, rawContent: [{ type: 'reasoning_text', text: 'thinking next step' }] }
    ].map(line).join(''));

    // 数据库中记录为 working
    const db = new sqlite3.Database(path.join(home, '.workbuddy/workbuddy.db'));
    await new Promise((resolve, reject) => db.run(
        "INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,NULL,0,'','local')",
        [workingId, cwd, '批量处理任务', null, 'working', now - 30000, now, now - 10000],
        e => db.close(() => e ? reject(e) : resolve())
    ));

    // 即使传入的 session 对象 status 为空或过时，transcript 也能从 db 与 jsonl 识别出 busy: true
    const activeResult = await wb.transcript({ id: workingId, cwd, file: workingFile, status: '' });
    assert.equal(activeResult.busy, true);
    assert.ok(activeResult.busySince);

    // 2. 模拟工具调用刚完成，处于推理中且尚未写回数据库（通过 jsonl 尾部近期事件识别）
    const toolRunningId = '77777777-7777-4777-8777-777777777777';
    const toolRunningFile = path.join(dir, toolRunningId + '.jsonl');
    fs.writeFileSync(toolRunningFile, [
        { type: 'message', role: 'user', timestamp: now - 20000, content: query('执行脚本') },
        { type: 'message', role: 'assistant', timestamp: now - 15000, content: [{ type: 'output_text', text: '正在跑脚本' }] },
        { type: 'function_call', name: 'Bash', timestamp: now - 5000 }
    ].map(line).join(''));

    const toolResult = await wb.transcript({ id: toolRunningId, cwd, file: toolRunningFile, status: 'completed' });
    assert.equal(toolResult.busy, true);

    // 3. 模拟完成后的会话：数据库为 completed，且最后一条为 completed assistant 消息
    const completedId = '88888888-8888-4888-8888-888888888888';
    const completedFile = path.join(dir, completedId + '.jsonl');
    fs.writeFileSync(completedFile, [
        { type: 'message', role: 'user', timestamp: now - 60000, content: query('完成了吗') },
        { type: 'message', role: 'assistant', status: 'completed', timestamp: now - 50000, content: [{ type: 'output_text', text: '全部完成！' }] }
    ].map(line).join(''));

    const doneResult = await wb.transcript({ id: completedId, cwd, file: completedFile, status: 'completed' });
    assert.equal(doneResult.busy, false);
});

test('ongoing WorkBuddy calls expose usage even when no new visible assistant message is written',async()=>{
 const id='77777777-7777-4777-8777-777777777777',file=path.join(dir,id+'.jsonl'),timestamp=Date.now();
 const usage={type:'function_call',id:'tool-block',timestamp:timestamp+1,name:'fixture-tool',providerData:{messageId:'native-call',model:'workbuddy-fixture',usage:{requests:1,inputTokens:1000,outputTokens:100,inputTokensDetails:[{cached_tokens:900}]}}};
 fs.writeFileSync(file,line({type:'message',role:'user',timestamp,content:query('fixture question')})+line(usage)+line({...usage,id:'duplicate-block',timestamp:timestamp+2}));
 const d=await wb.transcript({id,file,status:'running'});assert.equal(d.busy,true);assert.equal(d.items.length,1);assert.equal(d.modelUsage.length,1);
 let p=require('../backend/models/desktop-agents/performance').aggregate(d.items,d.performanceTurns,d.modelUsage);assert.equal(p.calls,1);assert.equal(p.inputTokens,1000);assert.equal(p.cacheReadRatio,.9);
 fs.appendFileSync(file,line({...usage,id:'second-block',timestamp:timestamp+3,providerData:{...usage.providerData,messageId:'next-native-call'}}));
 const next=await wb.transcript({id,file,status:'running'});p=require('../backend/models/desktop-agents/performance').aggregate(next.items,next.performanceTurns,next.modelUsage);assert.equal(p.calls,2);assert.equal(p.outputTokens,200);assert.equal(p.decodeTps,null);
});

test('WorkBuddy reply footers retain usage for their own user turn without double counting the session',async()=>{
 const id='99999999-9999-4999-8999-999999999999',file=path.join(dir,id+'.jsonl'),timestamp=Date.now();
 const usage=(key,n)=>({type:'function_call',timestamp,providerData:{messageId:key,model:'fixture',usage:{inputTokens:n,outputTokens:10}}});
 const user=()=>({type:'message',role:'user',timestamp,content:query('question')});
 const reply=()=>({type:'message',role:'assistant',timestamp,content:[{type:'output_text',text:'answer'}]});
 fs.writeFileSync(file,[user(),usage('call1',100),reply(),user(),usage('call2',200),reply()].map(line).join(''));
 const result=await wb.transcript({id,file,status:'completed'});
 assert.equal(result.items[1].rounds[0].inputTokens,100);
 assert.equal(result.items[3].rounds[0].inputTokens,200);
 const metrics=require('../backend/models/desktop-agents/performance').aggregate(result.items,[],result.modelUsage);
 assert.equal(metrics.calls,2);assert.equal(metrics.inputTokens,300);
});
