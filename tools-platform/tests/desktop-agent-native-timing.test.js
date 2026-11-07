const test=require('node:test'),assert=require('node:assert/strict');
const {durationMs,enrichAntigravity}=require('../backend/models/desktop-agents/native-timing');
const {aggregate}=require('../backend/models/desktop-agents/performance');
test('protobuf durations preserve nanosecond precision and reject invalid input',()=>{
 assert.ok(Math.abs(durationMs('1.234567890s')-1234.56789)<1e-9);
 assert.equal(durationMs({seconds:'2',nanos:500000000}),2500);
 for(const value of [null,'bad','-1s',{nanos:1000000000}])assert.equal(durationMs(value),null);
});
test('Antigravity joins native timings only to the exact matching planner step and counters',()=>{
 const round={requestId:'session:12',usageSource:'antigravity-planner',inputTokens:1000,outputTokens:200,cachedInputTokens:900,timingSource:'log-boundary',timingEstimated:true,ttftMs:null,tps:null};
 const content={items:[{rounds:[round]}],modelUsage:[round]};
 const data=[{steps:[11,12],input:'100',cache:'900',output:'200',thinking:'50',ttft:'2s',stream:'0.5s'}];
 const result=enrichAntigravity(content,data),r=result.items[0].rounds[0];
 assert.equal(r.ttftMs,2000);assert.equal(r.nativeStreamTps,400);assert.equal(r.reasoningOutputTokens,50);
 assert.equal(r.tps,null,'native output stream rate is not mislabeled as visible decode TPS');
 const metrics=aggregate(result.items,[],result.modelUsage);
 assert.equal(metrics.calls,1);assert.equal(metrics.requestTtftMs,2000);assert.equal(metrics.nativeStreamTps,400);assert.equal(metrics.nativeStreamCalls,1);assert.equal(metrics.decodeTps,null);
 assert.equal(enrichAntigravity(content,[{...data[0],output:'201'}]).items[0].rounds[0].ttftMs,null);
 assert.equal(enrichAntigravity(content,[data[0],data[0]]).items[0].rounds[0].ttftMs,null,'ambiguous mapping is refused');
});
test('native timing can expose TTFT without fabricating a rate from a zero or missing stream duration',()=>{
 const round={requestId:'s:4',inputTokens:10,outputTokens:1};
 const r=enrichAntigravity({items:[{rounds:[round]}]},[{steps:[4],input:10,cache:0,output:1,ttft:'0.2s',stream:'0s'}]).items[0].rounds[0];
 assert.equal(r.ttftMs,200);assert.equal(r.nativeStreamTps,null);
});
test('WorkBuddy native text observations require exact conversation/request association and do not invent TPS',async()=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
 const {workbuddyFirstText,enrichWorkbuddy}=require('../backend/models/desktop-agents/native-timing');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wb-native-timing-'));
 try{
  const id='11111111-1111-4111-8111-111111111111',start=Date.parse('2026-11-07T10:00:00Z');
  const log=(conversationId,input,at)=>`[${at}] [info] event `+JSON.stringify({conversationId,input,requestId:'turn-a',messageId:'native-message'});
  const text=[log('other','agent_message_chunk','2026-11-07T10:00:00Z'),log(id,'tool_call','2026-11-07T10:00:01Z'),log(id,'agent_message_chunk','2026-11-07T10:00:02Z'),log(id,'agent_message_chunk','2026-11-07T10:00:03Z')].join('\n');
  assert.equal(workbuddyFirstText(text,id).get('turn-a'),start+2000);
  const file=path.join(root,'logs/2026-11-07/sdk/conversations',id+'.log');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,text);
  const rounds=[{requestId:'a',turnId:'turn-a',inputTokens:100,outputTokens:10},{requestId:'b',turnId:'turn-a',inputTokens:200,outputTokens:20}];
  const d=await enrichWorkbuddy({items:[{rounds}],modelUsage:rounds},id,new Map([['turn-a',start]]),root);
  assert.equal(d.items[0].rounds[0].observedFirstTextMs,2000);
  assert.equal(d.items[0].rounds[1].observedFirstTextMs,undefined);
  const metrics=aggregate(d.items,[],d.modelUsage);
  assert.equal(metrics.observedFirstTextSamples,1);assert.equal(metrics.observedFirstTextMs,2000);
  assert.equal(metrics.decodeTps,null);assert.equal(metrics.requestTtftMs,null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('Codex observed text rates require exact turn/text identity and known text-only usage',()=>{
 const timing=require('../backend/models/desktop-agents/codex-timing');
 const round={turnId:'turn-a',requestId:'response-a',outputTokens:200,reasoningOutputTokens:40,outputHasTools:false,tps:null};
 const content={items:[{content:'final answer',rounds:[round]}]};
 const native=[{turnId:'turn-a',textHash:timing.hash('final answer'),streamMs:1000}];
 const d=timing.enrich(content,native),r=d.items[0].rounds[0];assert.equal(r.nativeStreamTokens,160);assert.equal(r.nativeStreamTps,160);assert.equal(r.tps,null);assert.equal(r.nativeStreamScope,'visible-output-observed');
 assert.equal(timing.enrich(content,[{...native[0],textHash:timing.hash('different')}]).items[0].rounds[0].nativeStreamTps,undefined);
 assert.equal(timing.enrich({...content,items:[{...content.items[0],rounds:[{...round,outputHasTools:true}]}]},native).items[0].rounds[0].nativeStreamTps,undefined);
 assert.equal(timing.enrich(content,[native[0],native[0]]).items[0].rounds[0].nativeStreamTps,undefined);
});
