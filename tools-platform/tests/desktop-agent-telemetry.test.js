const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const root=require('node:fs').mkdtempSync(path.join(os.tmpdir(),'agent-telemetry-'));
process.env.TOOLS_DATA_DIR=path.join(root,'data');process.env.TOOLS_DESKTOP_AGENT_HOME=path.join(root,'home');
const timing=require('../backend/models/desktop-agents/telemetry');
const db=require('../backend/models/app-db'),platform=require('../backend/models/platform-db');
const repo=require('../backend/models/desktop-agents/repository'),{runWithTenant}=require('../backend/models/tenant-context');
const attrs=o=>Object.entries(o).map(([key,value])=>({key,value:typeof value==='string'?{stringValue:value}:typeof value==='boolean'?{boolValue:value}:{doubleValue:value}}));
const span=(service,name,a)=>({resourceSpans:[{resource:{attributes:attrs({'service.name':service})},scopeSpans:[{spans:[{name,startTimeUnixNano:'1000000000',endTimeUnixNano:'4000000000',attributes:attrs(a)}]}]}]});
const fixture=()=>span('claude-code','claude_code.llm_request',{'session.id':'session-1',request_id:'req-1',input_tokens:100,cache_read_tokens:900,cache_creation_tokens:10,output_tokens:200,ttft_ms:1000,duration_ms:3000,attempt:1,success:true,user_prompt:'secret-must-not-survive'});
test.after(async()=>{await db.closeDatabase();await platform.closeDatabase?.();await fs.rm(root,{recursive:true,force:true});});
test('Claude telemetry keeps explicit timings and cache-inclusive counts, dropping contents',()=>{
 const records=timing.parseTelemetry(fixture());assert.equal(records.length,1);assert.equal(records[0].ttftMs,1000);assert.equal(records[0].durationMs,3000);assert.equal(records[0].inputTokens,1010);assert.equal(JSON.stringify(records).includes('secret'),false);
 const unknown=timing.parseTelemetry(span('unknown','random',{'session.id':'s',request_id:'r',ttft_ms:100}));assert.equal(unknown.length,0);
});
test('Codex streams correlate exact response IDs and do not use processing durations as decode time',()=>{
 const log=(kind,time,extra={})=>({resourceLogs:[{resource:{attributes:attrs({'service.name':'codex_cli_rs'})},scopeLogs:[{logRecords:[{timeUnixNano:time,attributes:attrs({'conversation.id':'codex-session',response_id:'response-1',kind,duration_ms:999999,...extra})}]}]}]});
 assert.equal(timing.parseTelemetry(log('response.output_text.delta','1000000000')).length,0);
 const r=timing.parseTelemetry(log('response.completed','3000000000',{output_tokens:200}))[0];assert.equal(r.nativeStreamMs,2000);assert.equal(r.nativeStreamTokens,200);assert.equal(r.ttftMs,undefined);
 assert.equal(timing.parseTelemetry(log('response.completed','4000000000',{output_tokens:200})).length,0,'a completed stream is consumed once');
});
function vi(n){n=BigInt(n);const bytes=[];do{const b=Number(n&127n);n>>=7n;bytes.push(b|(n?128:0));}while(n);return Buffer.from(bytes);}
const bytes=(field,value)=>Buffer.concat([vi(field*8+2),vi(value.length),value]);
const text=(field,value)=>bytes(field,Buffer.from(value));
const kv=(key,value)=>bytes(1,Buffer.concat([text(1,key),bytes(2,typeof value==='number'?Buffer.concat([vi(3*8),vi(value)]):text(1,value))]));
test('WorkBuddy OTLP protobuf traces are decoded without retaining arbitrary payloads',()=>{
 const resource=kv('service.name','codebuddy-code');
 const pairs={'gen_ai.session.id':'wb-session','gen_ai.response.id':'wb-request',first_token_ms:250,input_tokens:100,output_tokens:20,user_prompt:'never-store'};
 const spanBody=Buffer.concat([text(5,'generation'),...Object.entries(pairs).map(([k,v])=>{const packed=kv(k,v);const length=Number(packed[1]);return bytes(9,packed.subarray(2,2+length));})]);
 const wire=bytes(1,Buffer.concat([bytes(1,resource),bytes(2,bytes(2,spanBody))]));
 const decoded=timing.decodeTraceProtobuf(wire),records=timing.parseTelemetry(decoded);
 assert.equal(records.length,1);assert.equal(records[0].provider,'workbuddy');assert.equal(records[0].ttftMs,250);assert.equal(JSON.stringify(records).includes('never-store'),false);
});
test('loopback collector rejects browser-origin requests and accepts bounded OTLP JSON',async()=>{
 const received=[];const server=timing.createCollector(r=>received.push(...r));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const base='http://127.0.0.1:'+server.address().port;
  const post=(headers,body=fixture(),url='/v1/traces')=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post({Origin:'https://elsewhere.example'})).status,403);assert.equal((await post({'Content-Type':'text/plain'})).status,415);assert.equal((await post({},fixture(),'/unrelated')).status,403);
  assert.equal((await post({})).status,200);assert.equal(received.length,1);assert.equal(received[0].requestId,'req-1');
 }finally{await new Promise(r=>server.close(r));}
});
test('stored timings match provider request IDs and remain isolated by account and tenant',async()=>{
 await runWithTenant('default',async()=>{
  await repo.save('alice',{enabled:true});await timing.save('alice',timing.parseTelemetry(fixture()));
  const content={items:[{rounds:[{requestId:'claude-message',providerRequestId:'req-1',inputTokens:1010,outputTokens:200,tps:null}]}]};
  const d=await timing.enrich('alice','claudecode','local_session-1',content),r=d.items[0].rounds[0];assert.equal(r.ttftMs,1000);assert.equal(r.nativeStreamTps,100);assert.equal(r.tps,null);
  const wrong=await timing.enrich('alice','claudecode','another-session',content);assert.equal(wrong.items[0].rounds[0].ttftMs,undefined);
  await assert.rejects(timing.enrich('bob','claudecode','session-1',content));
 });
 await runWithTenant('other',async()=>{await assert.rejects(timing.enrich('alice','claudecode','session-1',{items:[]}));});
});
test('native configuration setup preserves existing settings and telemetry destinations',async()=>{
 const home=path.join(root,'config-home');for(const d of ['.claude','.workbuddy','.codex'])await fs.mkdir(path.join(home,d),{recursive:true});
 await fs.writeFile(path.join(home,'.claude/settings.json'),JSON.stringify({env:{EXISTING:'keep'},model:'preserve'}));
 await fs.writeFile(path.join(home,'.workbuddy/settings.json'),JSON.stringify({env:{OTEL_EXPORTER_OTLP_ENDPOINT:'https://already.example'},model:'preserve'}));
 await fs.writeFile(path.join(home,'.codex/config.toml'),'model = "preserve"\n');
 const {configure}=require('../scripts/configure-desktop-timing');const first=await configure({home,port:14319});assert.equal(first.find(x=>x.agent==='claudecode').changed,true);assert.equal(first.find(x=>x.agent==='workbuddy').changed,false);
 const c=JSON.parse(await fs.readFile(path.join(home,'.claude/settings.json'),'utf8'));assert.equal(c.env.EXISTING,'keep');assert.equal(c.model,'preserve');assert.equal(c.env.OTEL_LOG_USER_PROMPTS,'0');assert.equal(c.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,'http://127.0.0.1:14319/v1/traces');
 const second=await configure({home,port:14319});assert.equal(second.some(x=>x.changed),false,'repeated setup is idempotent');
});
