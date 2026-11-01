const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-report-trace-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const express = require('express');
const settings = require('../backend/models/ai-settings-repository');
const provider = require('../backend/models/ai-provider-client');
const data = require('../backend/models/ai-report-data');
settings.getRuntimeSettings = async () => ({ hasApiKey: true, keyLooksValid: true });
let client;
provider.createClient = () => client;
const router = require('../backend/routes/ai-report');
let server, base;
test.before(async () => {
    const app = express(); app.use(express.json());
    app.use((req,res,next) => { req.requestId = 'fixture-request'; next(); });
    app.use('/api/ai-report',router);
    server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
    base = 'http://127.0.0.1:'+server.address().port;
});
test.after(async () => { await new Promise(resolve=>server.close(resolve)); await require('../backend/models/app-db').closeDatabase(); await require('../backend/models/tenant-sqlite-pool').closeAll(); });
const request = body => fetch(base+'/api/ai-report/cell/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:'2026-10',message:'查询数据',...body})});

test('real stream stages arrive before completion, with full, empty and failed tool exchanges', async () => {
    let release;
    const gate = new Promise(resolve => { release=resolve; });
    const long = '样本'.repeat(30000);
    data.listSources = async () => [];
    data.describeSheet = async () => ({ sample:[{text:long,password:'private-fixture'}] });
    data.describeDataset = async () => { throw new Error('Dataset unavailable'); };
    let calls=0;
    client={generateChat:async()=>{
        if(++calls===1){await gate; return {text:'',toolCalls:[{id:'c1',name:'list_sources',args:{}},{id:'c2',name:'describe_sheet',args:{sheetId:'s1'}},{id:'c3',name:'describe_dataset',args:{id:'missing'}}]};}
        return {text:JSON.stringify({type:'answer',text:'已检查'}),toolCalls:[]};
    }};
    const response=await request({_stream:true,_debug:true});
    assert.match(response.headers.get('Content-Type'),/ndjson/);
    assert.equal(response.headers.get('X-Accel-Buffering'),'no');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',events=[];
    async function read(){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split('\n');buffer=lines.pop();events.push(...lines.filter(Boolean).map(JSON.parse));return done;}
    while(!events.some(e=>e.type==='progress'&&e.stage==='model'))await read();
    assert.equal(events.some(e=>e.type==='result'),false,'the model is still waiting at the gate');
    release();while(!await read()){}
    const result=events.find(e=>e.type==='result');assert.equal(result.requestId,'fixture-request');assert.equal(result.status,200);
    assert.equal(result.body.type,'answer');
    const steps=result.body._trace.filter(s=>s.kind==='tool');assert.equal(steps.length,3);
    assert.deepEqual(steps[0].result,[]);assert.equal(steps[0].status,'success');
    assert.equal(steps[1].args.sheetId,'s1');assert.equal(steps[1].result.sample[0].text,long,'actual return is not truncated at the model limit');
    assert.equal(steps[1].modelTruncated,true);assert.equal(steps[1].result.sample[0].password,'[REDACTED]');
    assert.equal(steps[2].status,'error');assert.match(steps[2].result.error,/unavailable/);
    assert.equal(events.filter(e=>e.type==='progress'&&e.stage==='tool').length,3);
    assert.equal(events.filter(e=>e.type==='trace'&&e.step.kind==='tool'&&e.step.status!=='running').length,3);
    assert.doesNotMatch(JSON.stringify(events),/private-fixture/);
});

test('progress works with logging off; JSON callers and validation errors retain their contract', async () => {
    client={generateChat:async()=>({text:JSON.stringify({type:'answer',text:'正常'}),toolCalls:[]})};
    const streamed=(await (await request({_stream:true})).text()).trim().split('\n').map(JSON.parse);
    assert.ok(streamed.some(e=>e.type==='progress'&&e.stage==='model'));
    assert.equal(streamed.some(e=>e.type==='trace'),false);
    assert.equal('_trace' in streamed.at(-1).body,false);
    const plain=await request({});assert.match(plain.headers.get('Content-Type'),/application\/json/);assert.equal((await plain.json()).type,'answer');
    const bad=(await (await request({_stream:true,_debug:true,month:'bad',password:'not-for-logs'})).text()).trim().split('\n').map(JSON.parse).at(-1);
    assert.equal(bad.status,400);assert.ok(bad.body.error);assert.equal(bad.body._request.password,'[REDACTED]');
});

test('client keeps partial records on transport errors, exports structured redacted diagnostics, and scopes concurrent cells', async () => {
    let mode='success',release;
    const context={localStorage:{getItem:()=>null,setItem(){}},window:{},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout:fn=>fn(),document:{body:{append(){}},createElement:()=>({click(){},remove(){}})},API:{post:async(_path,body,{onEvent})=>{
        onEvent({type:'progress',stage:'model'});
        if(body.hold)await new Promise(resolve=>{release=resolve;});
        onEvent({type:'trace',step:{id:'s1',kind:'tool',name:'list_metrics',args:{},status:'success',result:[]}});
        if(mode==='error')throw new Error('Connection interrupted');
        onEvent({type:'complete',requestId:'client-req',status:200});
        return {type:'answer',text:'完成'};
    }}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/js/ai-report/trace.js'),'utf8'),context);
    const trace=context.window.AiReportTrace;trace.setEnabled(true);
    const first=trace.post('a','Chat','/api/ai-report/cell/chat',{hold:true,password:'hidden',message:'token=hidden'});
    await trace.post('b','Chat','/api/ai-report/cell/chat',{});
    assert.match(trace.progressText('a'),/等待模型/);assert.equal(trace.progressText('b'),'');release();await first;
    const exported=trace.exportLog('a',{month:'2026-10'});assert.equal(exported.entries[0].requestId,'client-req');assert.equal(exported.entries[0].request.password,'[REDACTED]');assert.doesNotMatch(JSON.stringify(exported),/hidden/);
    mode='error';await assert.rejects(trace.post('c','Chat','/api/ai-report/cell/chat',{}),/interrupted/);
    assert.equal(trace.list('c')[0].steps.length,1);assert.equal(trace.list('c')[0].status,'error');assert.equal(trace.progressText('c'),'');
    trace.setEnabled(false);assert.equal(trace.exportLog('a'),undefined);await assert.rejects(trace.post('d','Chat','/api/ai-report/cell/chat',{}));assert.equal(trace.list('d').length,0);
});

test('shared API parses split UTF-8 frames, preserves streamed errors, and refuses missing final results', async () => {
    let content,headers={'Content-Type':'application/x-ndjson'};
    const source=fs.readFileSync(path.join(__dirname,'../frontend/js/shared/api.js'),'utf8').split('// 页面版本徽标统一显示平台发布版本')[0];
    const context={window:{location:{origin:'http://fixture',pathname:'/pages/ai-report.html'},addEventListener(){}},document:{},localStorage:{getItem:()=>null,removeItem(){}},Response,TextDecoder,URLSearchParams,fetch:async()=>{
        const bytes=new TextEncoder().encode(content);
        return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers});
    }};
    vm.runInNewContext(source,context);const api=context.window.API,events=[];
    content=JSON.stringify({type:'progress',stage:'model'})+'\n'+JSON.stringify({type:'result',status:200,requestId:'split',body:{text:'中文完整'}})+'\n';
    const result=await api.post('/api/ai-report/cell/chat',{}, {onEvent:e=>events.push(e)});
    assert.equal(result.text,'中文完整');assert.equal(events[0].stage,'model');assert.equal(events[1].requestId,'split');
    content=JSON.stringify({type:'result',status:400,body:{error:'Bad month',_trace:[{kind:'tool',status:'error'}]}})+'\n';
    await assert.rejects(api.post('/api/ai-report/cell/chat',{}),error=>error.status===400&&error.body._trace.length===1);
    content=JSON.stringify({type:'progress',stage:'model'})+'\n';
    await assert.rejects(api.post('/api/ai-report/cell/chat',{}),/未收到最终结果/);
    headers={'Content-Type':'application/json'};content=JSON.stringify({text:'legacy JSON'});
    assert.equal((await api.post('/api/ai-report/cell/chat',{})).text,'legacy JSON');
});
