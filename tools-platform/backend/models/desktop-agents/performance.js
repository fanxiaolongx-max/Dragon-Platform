'use strict';
// Aggregate only explicit usage/timing facts. Log-boundary durations are not decode times.
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timestamp=value=>finite(value)?(value<1e11?value*1000:value):typeof value==='string'?Date.parse(value):NaN;
function aggregate(items=[],turns=[],usageRecords=[]){
    const unique=new Map();let serial=0;
    for(const item of [...(items||[]),{rounds:usageRecords||[]}])for(const round of item.rounds||[]){
        const key=round.requestId?`${round.usageSource||''}:${round.requestId}`:`unknown:${serial++}`;unique.set(key,round);
    }
    const rounds=[...unique.values()];const reportedModels=rounds.map(round=>round.model).filter(model=>typeof model==='string'&&model),models=[...new Set(reportedModels)];let input=0,output=0,reasoning=0,cached=0,cacheInput=0,cacheCalls=0,decodeTokens=0,decodeMs=0,decodeCalls=0;
    let observedFirstTextTotal=0,observedFirstTextSamples=0;
    let requestTtftTotal=0,requestTtftSamples=0,nativeStreamMs=0,nativeStreamTokens=0,nativeStreamCalls=0,observedStreamMs=0,observedStreamTokens=0,observedStreamCalls=0;
    let estimatedStreamMs=0,estimatedStreamTokens=0,estimatedStreamCalls=0,estimatedTtftTotal=0,estimatedTtftSamples=0;
    const byTurn=new Map();
    for(const round of rounds){
        const i=count(round.inputTokens),o=count(round.outputTokens),c=count(round.cachedInputTokens),r=count(round.reasoningOutputTokens);
        if(round.firstTextSource==='workbuddy-native-sdk-log'&&finite(round.observedFirstTextMs)&&round.observedFirstTextMs>=0){observedFirstTextTotal+=round.observedFirstTextMs;observedFirstTextSamples++;}
        if(round.timingSource==='native-metadata'&&!round.timingEstimated){
            if(finite(round.ttftMs)&&round.ttftMs>=0){requestTtftTotal+=round.ttftMs;requestTtftSamples++;}
            if(finite(round.nativeStreamMs)&&round.nativeStreamMs>0&&count(round.nativeStreamTokens)>0){if(round.nativeStreamScope==='visible-output-observed'){observedStreamMs+=round.nativeStreamMs;observedStreamTokens+=round.nativeStreamTokens;observedStreamCalls++;}else{nativeStreamMs+=round.nativeStreamMs;nativeStreamTokens+=round.nativeStreamTokens;nativeStreamCalls++;}}
        }
        if(round.timingSource==='workbuddy-jsonl-events'&&round.timingEstimated){
            if(finite(round.ttftMs)&&round.ttftMs>=0){estimatedTtftTotal+=round.ttftMs;estimatedTtftSamples++;}
            if(finite(round.generationMs)&&round.generationMs>0&&o>0){estimatedStreamMs+=round.generationMs;estimatedStreamTokens+=o;estimatedStreamCalls++;}
        }
        input+=i||0;output+=o||0;reasoning+=r||0;
        if(i!==null&&i>0&&c!==null&&c<=i){cached+=c;cacheInput+=i;cacheCalls++;}
        if(round.turnId&&i!==null&&o!==null)byTurn.set(round.turnId,(byTurn.get(round.turnId)||0)+i+o);
        // A stream timer and an output count with matching scope are required.
        const visible=count(round.visibleOutputTokens),n=visible??(r===0?o:null);
        if(round.timingSource==='request-stream'&&!round.timingEstimated&&finite(round.ttftMs)&&round.ttftMs>=0&&finite(round.generationMs)&&round.generationMs>0&&n>1){decodeTokens+=n-1;decodeMs+=round.generationMs;decodeCalls++;}
    }
    const observed=new Map();
    for(const turn of turns||[]){
        const start=timestamp(turn.startedAt),end=finite(turn.durationMs)&&turn.durationMs>0?start+turn.durationMs:timestamp(turn.endedAt);
        if(turn.id&&Number.isFinite(start)&&Number.isFinite(end)&&end>start&&byTurn.has(turn.id))observed.set(turn.id,{...turn,start,end});
    }
    const completed=new Map([...observed].filter(([,turn])=>turn.usageComplete===true));
    let wallMs=0,windowStart=null,windowEnd=null,processingTokens=0,ttftTotal=0,ttftSamples=0;
    for(const turn of [...completed.values()].sort((a,b)=>a.start-b.start)){
        processingTokens+=byTurn.get(turn.id);
        if(windowStart===null){windowStart=turn.start;windowEnd=turn.end;}
        else if(turn.start<=windowEnd)windowEnd=Math.max(windowEnd,turn.end);
        else{wallMs+=windowEnd-windowStart;windowStart=turn.start;windowEnd=turn.end;}
    }
    if(windowStart!==null)wallMs+=windowEnd-windowStart;
    for(const turn of observed.values())if(finite(turn.ttftMs)&&turn.ttftMs>=0&&turn.ttftMs<=turn.end-turn.start){ttftTotal+=turn.ttftMs;ttftSamples++;}
    return {scope:'loaded-desktop-log',calls:rounds.length,models,latestModel:reportedModels.at(-1)||null,inputTokens:input,outputTokens:output,reasoningOutputTokens:reasoning,
        cachedInputTokens:cacheCalls?cached:null,cacheInputTokens:cacheInput,cacheCalls,cacheReadRatio:cacheInput>0?cached/cacheInput:null,
        observedFirstTextMs:observedFirstTextSamples?observedFirstTextTotal/observedFirstTextSamples:null,observedFirstTextSamples,
        requestTtftMs:requestTtftSamples?requestTtftTotal/requestTtftSamples:null,requestTtftSamples,
        nativeStreamTps:nativeStreamMs>0?nativeStreamTokens*1000/nativeStreamMs:observedStreamMs>0?observedStreamTokens*1000/observedStreamMs:null,nativeStreamCalls:nativeStreamCalls||observedStreamCalls,nativeStreamObserved:!nativeStreamCalls&&observedStreamCalls>0,
        turnTtftMs:ttftSamples?ttftTotal/ttftSamples:null,ttftSamples,
        decodeTps:decodeMs>0?decodeTokens/(decodeMs/1000):null,decodeCalls,
        estimatedTps:decodeMs===0&&estimatedStreamMs>0?estimatedStreamTokens/(estimatedStreamMs/1000):null,estimatedCalls:decodeCalls?0:estimatedStreamCalls,
        estimatedTtftMs:!ttftSamples&&estimatedTtftSamples>0?estimatedTtftTotal/estimatedTtftSamples:null,
        processingTps:wallMs>0?processingTokens/(wallMs/1000):null,processingTokens,wallMs,completedTurns:completed.size};
}
// WorkBuddy normalizes usage under providerData, including tool-call events.
function workbuddyUsage(event){
    if(!event||event.isSidechain)return null;
    const p=event.providerData||{},u=p.usage||{},raw=p.rawUsage||{},m=event.message?.usage||{};
    const first=(...values)=>values.find(value=>count(value)!==null)??null;
    const details=(value,key)=>{const values=(Array.isArray(value)?value:[value]).filter(item=>item&&count(item[key])!==null).map(item=>item[key]);return values.length?values.reduce((a,b)=>a+b,0):null;};
    const output=first(u.outputTokens,raw.completion_tokens,raw.output_tokens,m.output_tokens);
    let input=first(u.inputTokens,raw.prompt_tokens);
    if(input===null&&count(raw.input_tokens)!==null)input=raw.input_tokens+(first(raw.cache_read_input_tokens)??0)+(first(raw.cache_creation_input_tokens)??0);
    // WorkBuddy's compatibility message.usage reports inclusive input when total matches.
    if(input===null&&count(m.input_tokens)!==null&&output!==null&&count(m.total_tokens)!==null){
        if(m.total_tokens===m.input_tokens+output)input=m.input_tokens;
        else if(m.total_tokens===m.input_tokens+(first(m.cache_read_input_tokens)??0)+(first(m.cache_creation_input_tokens)??0)+output)input=m.total_tokens-output;
    }
    if(input===null||output===null)return null;
    const requestId=p.messageId||(p.conversationRequestId&&Number.isInteger(p.stepSeq)?p.conversationRequestId+':'+p.stepSeq:event.message?.id||event.id);
    if(typeof requestId!=='string'||!requestId||requestId.length>500)return null;
    const cached=first(details(u.inputTokensDetails,'cached_tokens'),raw.prompt_tokens_details?.cached_tokens,raw.prompt_cache_hit_tokens,m.cache_read_input_tokens,raw.cache_read_input_tokens,raw.cached_tokens);
    const reasoning=first(details(u.outputTokensDetails,'reasoning_tokens'),raw.completion_tokens_details?.reasoning_tokens,raw.completion_thinking_tokens);
    return {requestId,providerRequestId:typeof p.requestId==='string'?p.requestId:typeof raw.request_id==='string'?raw.request_id:null,turnId:typeof p.conversationRequestId==='string'?p.conversationRequestId:null,usageSource:'workbuddy-provider-usage',model:typeof p.model==='string'?p.model:typeof p.requestModelName==='string'?p.requestModelName:typeof event.message?.model==='string'?event.message.model:'',
        inputTokens:input,outputTokens:output,cachedInputTokens:cached,reasoningOutputTokens:reasoning!==null&&reasoning<=output?reasoning:null,
        timingSource:'usage-only',timingEstimated:false,ttftMs:null,generationMs:null,tps:null};
}
module.exports={aggregate,workbuddyUsage};
