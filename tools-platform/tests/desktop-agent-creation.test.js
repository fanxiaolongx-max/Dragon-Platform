const test=require('node:test'),assert=require('node:assert/strict');
const {createAndSend,receipt}=require('../backend/models/desktop-agents/new-conversation');
const id='11111111-1111-4111-8111-111111111111',fresh='22222222-2222-4222-8222-222222222222',prompt='[DragonTAC:test] new native group question';
function driverFixture(provider,{wrong=false,draft=false}={}){
 let opened=false,pasted=false;const calls=[];
 const driver=async(_provider,command,arg)=>{calls.push({command,arg});if(command==='status')return{trusted:true,running:true};if(command==='snapshot')return {windowTitle:opened?'Codex':'Existing desktop task',elements:[{role:'AXHeading',title:'',desc:opened?'':'Existing desktop task'},{role:'AXTextArea',value:opened?(wrong?'unrelated input':provider==='codex'||pasted?prompt:''):draft?'unsent draft':''}]};if(command==='press'){opened=true;return{previous:'com.example.front'};}if(command==='paste'){pasted=true;return{previous:'com.example.front'};}if(command==='submit-text')return{ok:true};throw Error(command);};
 return{calls,driver,open:async uri=>{opened=true;const u=new URL(uri);assert.equal(u.hostname,'threads');assert.equal(u.pathname,'/new');assert.equal(u.searchParams.get('prompt'),prompt);},readRows:async()=>draft?[]:[{id,title:'Existing desktop task'}],readReceipt:async()=>({id:fresh,status:'accepted'}),wait:async()=>{},platform:'darwin'};
}
test('Codex creation uses a new native route and submits only the exact prepared question',async()=>{
 const d=driverFixture('codex');assert.deepEqual(await createAndSend('codex',prompt,d),{id:fresh,status:'accepted'});assert.equal(d.calls.filter(c=>c.command==='submit-text').length,1);assert.equal(d.calls.find(c=>c.command==='submit-text').arg.text,prompt);assert.equal(d.calls.some(c=>c.command==='paste'),false);
});
test('Claude creation uses native New, verifies an empty new composer and checks text again before submitting',async()=>{
 const d=driverFixture('claudecode');await createAndSend('claudecode',prompt,d);assert.equal(d.calls.find(c=>c.command==='press').arg.title,'新建');assert.equal(d.calls.find(c=>c.command==='paste').arg.text,prompt);assert.equal(d.calls.filter(c=>c.command==='submit-text').length,1);
});
test('wrong composer, unsubmitted new-task draft and unsupported platforms fail before submitting',async()=>{
 const wrong=driverFixture('codex',{wrong:true});await assert.rejects(createAndSend('codex',prompt,wrong),e=>e.code==='DESKTOP_TARGET_UNCONFIRMED');assert.equal(wrong.calls.some(c=>c.command==='submit-text'),false);
 const draft=driverFixture('codex',{draft:true});await assert.rejects(createAndSend('codex',prompt,draft),e=>e.code==='DESKTOP_DRAFT');assert.equal(draft.calls.some(c=>c.command==='submit-text'),false);
 await assert.rejects(createAndSend('codex',prompt,{platform:'win32'}),e=>e.code==='DESKTOP_UNAVAILABLE');
 await assert.rejects(createAndSend('codex',prompt,{platform:'darwin',driver:async()=>({trusted:false,running:true})}),e=>e.code==='AX_PERMISSION'&&e.message.includes('PM2'));
 await assert.rejects(createAndSend('codex',prompt,{platform:'darwin',driver:async()=>({trusted:true,running:false})}),e=>e.code==='DESKTOP_UNAVAILABLE'&&e.message.includes('未运行'));
});
test('a submitted but unconfirmed creation is never retried or replaced with a recent conversation',async()=>{
 const d=driverFixture('codex');d.readReceipt=async()=>{throw Object.assign(Error('unconfirmed'),{code:'DELIVERY_UNKNOWN'});};await assert.rejects(createAndSend('codex',prompt,d),e=>e.code==='DELIVERY_UNKNOWN');assert.equal(d.calls.filter(c=>c.command==='submit-text').length,1);
});
test('creation receipt requires a newly created ID, exact question and allows native newline normalization',async()=>{
 const result=await receipt('codex',[{id}],prompt,{readRows:async()=>[{id},{id:fresh}],readTranscript:async()=>({items:[{role:'user',content:prompt+'\r\n'}]}),wait:async()=>{}});assert.equal(result.id,fresh);
 await assert.rejects(receipt('codex',[{id}],prompt,{readRows:async()=>[{id}],readTranscript:async()=>{throw Error('old task must not be read');},wait:async()=>{}}),e=>e.code==='DELIVERY_UNKNOWN');
});
