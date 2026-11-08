const test=require('node:test'),assert=require('node:assert/strict');
const {createAndSend,receipt,composerText}=require('../backend/models/desktop-agents/new-conversation');
const id='11111111-1111-4111-8111-111111111111',fresh='22222222-2222-4222-8222-222222222222',prompt='[DragonTAC:test] new native group question';
function driverFixture(provider,{wrong=false,draft=false,text=prompt,collapseParagraphs=false,titledNewHeading=false}={}){
 let opened=false,pasted=false;const calls=[];
 const driver=async(_provider,command,arg)=>{calls.push({command,arg});if(command==='status')return{trusted:true,running:true};if(command==='prepare')return{previous:'com.example.front'};if(command==='restore')return{ok:true};if(command==='snapshot')return {windowTitle:opened?'Codex':'Existing desktop task',elements:[{role:'AXHeading',title:titledNewHeading?(opened?'新建会话':'Existing desktop task'):'',desc:titledNewHeading?'':opened?'':'Existing desktop task'},{role:'AXTextArea',value:opened?(wrong?'unrelated input':provider==='codex'||pasted?(collapseParagraphs?composerText(text):text):''):draft?'unsent draft':''}]};if(command==='press'){opened=true;return{previous:'com.example.front'};}if(command==='paste'){pasted=true;return{previous:'com.example.front'};}if(command==='submit-text')return{ok:true};throw Error(command);};
 return{calls,driver,open:async uri=>{opened=true;const u=new URL(uri);assert.equal(u.hostname,'threads');assert.equal(u.pathname,'/new');assert.equal(u.searchParams.get('prompt'),text);},readRows:async()=>draft?[]:[{id,title:'Existing desktop task'}],readReceipt:async()=>({id:fresh,status:'accepted'}),wait:async()=>{},platform:'darwin'};
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

test('Codex accessibility paragraph merging preserves all text and still rejects changed content',async()=>{
 const text='[DragonTAC:test]\n\nGroup rules\n\n\nUser question\n\n';
 const d=driverFixture('codex',{text,collapseParagraphs:true});
 assert.equal((await createAndSend('codex',text,d)).status,'accepted');
 assert.equal(d.calls.find(c=>c.command==='submit-text').arg.text,text,'original text is sent, only comparison is normalized');
 const bad=driverFixture('codex',{text,wrong:true});await assert.rejects(createAndSend('codex',text,bad),{code:'DESKTOP_TARGET_UNCONFIRMED'});
 assert.equal(bad.calls.some(c=>c.command==='submit-text'),false);
 const r=await receipt('codex',[{id}],text,{readRows:async()=>[{id:fresh}],readTranscript:async()=>({items:[{role:'user',content:composerText(text)}]}),wait:async()=>{}});assert.equal(r.id,fresh);
});
test('Claude recognizes the real titled New conversation heading even when both old parsed headings are empty',async()=>{
 const d=driverFixture('claudecode',{titledNewHeading:true});await createAndSend('claudecode',prompt,d);
 assert.equal(d.calls.filter(c=>c.command==='paste').length,1);assert.equal(d.calls.filter(c=>c.command==='submit-text').length,1);
});
test('Claude Code tab already on its untitled 新会话 page is confirmed as the new composer, an unchanged named session is not',async()=>{
 const stay=heading=>{const calls=[];return{calls,driver:async(_p,command,arg)=>{calls.push({command,arg});if(command==='status')return{trusted:true,running:true};if(command==='prepare')return{previous:'com.example.front'};if(command==='restore')return{ok:true};if(command==='snapshot')return{windowTitle:'Claude',elements:[{role:'AXHeading',title:'',desc:heading},{role:'AXTextArea',value:'\n'}]};if(command==='press'||command==='paste')return{previous:'com.example.front'};if(command==='submit-text')return{ok:true};throw Error(command);},readRows:async()=>[{id,title:'Existing desktop task'}],readReceipt:async()=>({id:fresh,status:'accepted'}),wait:async()=>{},platform:'darwin'};};
 const blank=stay('新会话');assert.equal((await createAndSend('claudecode',prompt,blank)).status,'accepted');
 assert.equal(blank.calls.filter(c=>c.command==='paste').length,1);assert.equal(blank.calls.filter(c=>c.command==='submit-text').length,1);
 const old=stay('Existing desktop task');await assert.rejects(createAndSend('claudecode',prompt,old),{code:'DESKTOP_TARGET_UNCONFIRMED'});
 assert.equal(old.calls.some(c=>c.command==='paste'||c.command==='submit-text'),false);
});

test('Claude creation prepares its controls before reading drafts and preserves the pre-activation foreground',async()=>{
 const d=driverFixture('claudecode'),original=d.driver;let ready=false;
 d.driver=async(provider,command,arg)=>{
  if(command==='prepare'){ready=true;d.calls.push({command,arg});return {previous:'com.google.Chrome'};}
  if(command==='snapshot')assert(ready,'Must prepare before reading an existing or new-task draft');
  return original(provider,command,arg);
 };
 assert.equal((await createAndSend('claudecode',prompt,d)).status,'accepted');
 assert.equal(d.calls.find(c=>c.command==='submit-text').arg.previous,'com.google.Chrome');
});

test('Claude preparation does not allow overwriting a new-task draft and restores foreground on failure',async()=>{
 const d=driverFixture('claudecode',{draft:true});
 await assert.rejects(createAndSend('claudecode',prompt,d),{code:'DESKTOP_DRAFT'});
 assert(!d.calls.some(c=>['press','paste','submit-text'].includes(c.command)));
 assert.equal(d.calls.at(-1).command,'restore');assert.equal(d.calls.at(-1).arg.previous,'com.example.front');
});


test('new Codex and Claude conversations select the requested model before the first message',async()=>{
 for(const provider of ['codex','claudecode']){
  const d=driverFixture(provider),original=d.driver;
  d.driver=async(p,command,arg)=>command==='set-model'?(d.calls.push({command,arg}),{ok:true}):original(p,command,arg);
  await createAndSend(provider,prompt,{...d,model:'fixture-model'});
  const at=d.calls.findIndex(c=>c.command==='set-model');assert(at>=0);assert.equal(d.calls[at].arg.model,'fixture-model');assert(at<d.calls.findIndex(c=>c.command==='submit-text'));
  const fail=driverFixture(provider);let submitted=false;
  const driver=fail.driver;fail.driver=async(p,command,arg)=>{if(command==='set-model')throw Object.assign(Error('unavailable'),{code:'DESKTOP_MODEL_UNAVAILABLE'});if(command==='submit-text')submitted=true;return driver(p,command,arg);};
  await assert.rejects(createAndSend(provider,prompt,{...fail,model:'missing'}),{code:'DESKTOP_MODEL_UNAVAILABLE'});assert.equal(submitted,false);
 }
});
