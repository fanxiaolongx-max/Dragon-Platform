const test=require('node:test'),assert=require('node:assert/strict');
const {aggregate}=require('../backend/models/desktop-agents/performance');
const items=rounds=>[{role:'assistant',rounds}];
test('long cached input never inflates decode speed; boundary timings stay unavailable',()=>{
 const p=aggregate(items([{inputTokens:26800000,outputTokens:1200,cachedInputTokens:25460000,tps:17000,ms:77,generationMs:77,timingSource:'log-boundary',timingEstimated:true}]));
 assert.equal(p.decodeTps,null);assert.equal(p.processingTps,null);assert.equal(p.turnTtftMs,null);assert.equal(p.cacheReadRatio,.95);assert.equal(p.outputTokens,1200);
});
test('stream measurements use post-first-token output and duration weighting, excluding reasoning or missing timings',()=>{
 const p=aggregate(items([{inputTokens:1e6,outputTokens:101,reasoningOutputTokens:0,ttftMs:1000,generationMs:1000,timingSource:'request-stream'},
 {inputTokens:2e6,outputTokens:401,reasoningOutputTokens:0,ttftMs:500,generationMs:2000,timingSource:'request-stream'},
 {inputTokens:0,outputTokens:900,reasoningOutputTokens:800,ttftMs:500,generationMs:1000,timingSource:'request-stream'}]));
 assert.equal(p.decodeCalls,2);assert.ok(Math.abs(p.decodeTps-500/3)<1e-9);
});
test('cache missing is not zero; cache writes are not hits; duplicate request usage is not summed',()=>{
 const p=aggregate(items([{requestId:'a',usageSource:'native',inputTokens:100,outputTokens:1,cachedInputTokens:10},
 {requestId:'a',usageSource:'native',inputTokens:100,outputTokens:2,cachedInputTokens:80},
 {inputTokens:10000,outputTokens:10}, {inputTokens:100,outputTokens:5,cachedInputTokens:0,cacheWriteTokens:100},
 {inputTokens:10,outputTokens:1,cachedInputTokens:20}]));
 assert.equal(p.calls,4);assert.equal(p.cacheCalls,2);assert.equal(p.cacheReadRatio,.4);assert.equal(p.outputTokens,18);
});
test('processing throughput merges overlapping completed windows; first-token latency keeps turn scope',()=>{
 const p=aggregate(items([{turnId:'a',inputTokens:900,outputTokens:100},{turnId:'b',inputTokens:1800,outputTokens:200},{turnId:'partial',inputTokens:1e6,outputTokens:1}]),
 [{id:'a',startedAt:1700000000,durationMs:10000,usageComplete:true,ttftMs:0},
 {id:'b',startedAt:1700000005,durationMs:10000,usageComplete:true,ttftMs:1000},
 {id:'partial',startedAt:1700000020,durationMs:10000,usageComplete:false,ttftMs:2000}]);
 assert.equal(p.wallMs,15000);assert.equal(p.processingTokens,3000);assert.equal(p.processingTps,200);assert.equal(p.completedTurns,2);
 assert.equal(p.ttftSamples,3);assert.equal(p.turnTtftMs,1000);
});
test('missing reports and invalid clock/counter values never become measured zero rates',()=>{
 const p=aggregate(items([{inputTokens:10,outputTokens:1,cachedInputTokens:null},{turnId:'bad',inputTokens:10,outputTokens:1}]),[{id:'bad',startedAt:null,endedAt:null,ttftMs:null,usageComplete:true}]);
 assert.equal(p.cacheReadRatio,null);assert.equal(p.decodeTps,null);assert.equal(p.processingTps,null);assert.equal(p.turnTtftMs,null);
});

test('WorkBuddy reads usage from tool calls and prioritizes canonical cache details over placeholder zeros',()=>{
 const {workbuddyUsage}=require('../backend/models/desktop-agents/performance');
 const e={type:'function_call',id:'block-1',providerData:{messageId:'response-1',conversationRequestId:'turn-1',stepSeq:1,model:'fixture-model',usage:{requests:1,inputTokens:31833,outputTokens:603,inputTokensDetails:[{cached_tokens:8768}],outputTokensDetails:[{reasoning_tokens:455}]},rawUsage:{prompt_tokens:31833,completion_tokens:603,cache_read_input_tokens:0,cached_tokens:0,prompt_cache_hit_tokens:8768}}};
 const round=workbuddyUsage(e);assert.equal(round.inputTokens,31833);assert.equal(round.outputTokens,603);assert.equal(round.cachedInputTokens,8768);assert.equal(round.reasoningOutputTokens,455);
 const p=aggregate([],[],[round,{...round,outputTokens:604}]);assert.equal(p.calls,1);assert.equal(p.outputTokens,604);assert.equal(p.latestModel,'fixture-model');assert.equal(p.decodeTps,null);assert.equal(p.turnTtftMs,null);assert.equal(p.processingTps,null);
 assert.equal(workbuddyUsage({...e,isSidechain:true}),null);
 assert.equal(workbuddyUsage({type:'function_call',id:'no-usage'}),null);
});
test('WorkBuddy missing cache is unavailable and Anthropic raw input excludes no cached tokens',()=>{
 const {workbuddyUsage}=require('../backend/models/desktop-agents/performance');
 const raw=workbuddyUsage({id:'a',providerData:{rawUsage:{input_tokens:100,cache_read_input_tokens:900,cache_creation_input_tokens:100,output_tokens:10}}});
 assert.equal(raw.inputTokens,1100);assert.equal(raw.cachedInputTokens,900);
 const noCache=workbuddyUsage({id:'b',providerData:{usage:{inputTokens:100,outputTokens:10}}});assert.equal(noCache.cachedInputTokens,null);
 const compatible=workbuddyUsage({id:'c',message:{usage:{input_tokens:1000,output_tokens:100,total_tokens:1100,cache_read_input_tokens:900}}});assert.equal(compatible.inputTokens,1000);
});
