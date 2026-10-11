const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../frontend/js/monthly-designer/request-client');
test('requests time out and abort even when the transport never resolves',async()=>{
 let signal;const client=create({fetch:(_url,options)=>{signal=options.signal;return new Promise(()=>{});},parse:res=>res});const start=Date.now();await assert.rejects(client.request('/stalled',{}, {timeoutMs:30,timeoutMessage:'stalled request'}),error=>error.name==='TimeoutError'&&error.message==='stalled request');assert.ok(Date.now()-start<1000);assert.equal(signal.aborted,true);
});
test('timeout covers response-body parsing, successful responses clear deadlines and errors are retained',async()=>{
 const client=create({fetch:async()=>({ok:true}),parse:()=>new Promise(()=>{})});await assert.rejects(client.request('/body',{}, {timeoutMs:20}),error=>error.name==='TimeoutError');const good=create({fetch:async()=>({value:3}),parse:async res=>res.value});assert.equal(await good.request('/good',{}, {timeoutMs:20}),3);const bad=create({fetch:async()=>{throw new Error('HTTP failure');},parse:res=>res});await assert.rejects(bad.request('/bad'),/HTTP failure/);
});
test('stopping initialization cancels pending reads without interrupting server saves',async()=>{
 let reads=0,resolveSave;const client=create({fetch:(url,options)=>options.method==='POST'?new Promise(resolve=>{resolveSave=resolve;}):new Promise(()=>{reads++;}),parse:res=>res});const read=client.request('/catalog'),save=client.request('/save',{method:'POST'});await Promise.resolve();assert.equal(reads,1);client.cancelReads('Cancelled by user');await assert.rejects(read,error=>error.name==='AbortError');resolveSave({saved:true});assert.deepEqual(await save,{saved:true});
});
test('bounded worksheet reads release slots after timeout, external abort cancels queued reads, and unrelated reads continue',async()=>{
 let running=0,max=0;const started=[];const client=create({readConcurrency:1,fetch:async(url,options)=>{started.push(url);running++;max=Math.max(max,running);if(url==='/slow'){options.signal.addEventListener('abort',()=>running--);return new Promise(()=>{});}running--;return url;},parse:value=>value});
 const slow=client.request('/slow',{}, {queued:true,timeoutMs:30});const controller=new AbortController();const queued=client.request('/queued',{signal:controller.signal},{queued:true});const good=client.request('/good',{}, {queued:true});await Promise.resolve();controller.abort();await assert.rejects(queued,error=>error.name==='AbortError');await assert.rejects(slow,error=>error.name==='TimeoutError');assert.equal(await good,'/good');assert.equal(max,1);assert.deepEqual(started,['/slow','/good']);
});
test('selective cancellation stops one source request without cancelling another or writes',async()=>{
 const client=create({fetch:url=>url==='/bad'?new Promise(()=>{}):Promise.resolve(url),parse:value=>value});const bad=client.request('/bad');const good=client.request('/good');await Promise.resolve();client.cancelReads('source stopped',url=>url==='/bad');await assert.rejects(bad,/source stopped/);assert.equal(await good,'/good');
});
