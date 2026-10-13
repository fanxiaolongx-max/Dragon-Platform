const test=require('node:test'),assert=require('node:assert/strict');
const base='../backend/builtin-tools/f12-to-extension/',capture=require(base+'netcare-capture.js')(),controls=require(base+'netcare-controls.js')(),pip=require(base+'netcare-pip.js')();
const topic={number:'3.4',title:'Test and Verification'},shot={kind:'text',topic};
const region=(text='3.4 Test and Verification')=>({querySelector:()=>({textContent:text}),querySelectorAll:()=>[],getBoundingClientRect:()=>({width:600,height:400}),isConnected:true});
const doc=articles=>({querySelectorAll:selector=>selector==='article'?articles:[]});
test('live screenshot retries re-locate changed DOM and report earlier failures',async()=>{
 let tries=0;const a=region(),b=region(),d={querySelectorAll:s=>s==='article'?(tries===0?[a]:[b]):[]},events=[];
 const result=await capture.capture(d,shot,{signal:new AbortController().signal,sleep:async()=>{},attempt:a=>events.push(a),render:async el=>{if(++tries===1){assert.equal(el,a);throw Error('canvas failure');}assert.equal(el,b);return ['png'];}});
 assert.equal(result.method,'live');assert.equal(result.attempts.length,1);assert.equal(result.attempts[0].message,'canvas failure');assert.deepEqual(result.attempts[0].bounds,{width:600,height:400,connected:true});assert.equal(events.at(-1).ok,true);
});
test('unrendered chapters activate a unique native directory entry then retry',async()=>{
 let loaded=false,clicked=0;const a=region(),node={textContent:'3.4 Test and Verification',closest:()=>null,getBoundingClientRect:()=>({width:120}),click(){loaded=true;clicked++;}};
 const d={querySelectorAll:s=>s==='article'?(loaded?[a]:[]):[node]};const result=await capture.capture(d,shot,{signal:new AbortController().signal,sleep:async()=>{},render:async el=>{assert.equal(el,a);return ['png'];}});
 assert.equal(clicked,1);assert.equal(result.method,'live');assert.equal(result.attempts.length,0);
});
test('wrong numbers or titles never pass the original-region locator; ambiguous headings are refused',()=>{
 assert.equal(capture.locate(doc([region('3.3 Test and Verification')]),shot),null);
 assert.equal(capture.locate(doc([region('3.4 Changeback')]),shot),null);
 assert.throws(()=>capture.locate(doc([region(),region()]),shot),e=>e.code==='AMBIGUOUS_REGION');
 const foreign={getAttribute:()=>'/file.txt',closest:()=>null};assert.equal(capture.locate({querySelectorAll:s=>s==='article'?[]:[foreign]},{...shot,kind:'attachments',file:{href:'/file.txt'}}),null);
});
test('duplicate directory entries cannot cause navigation to another section',()=>{
 let clicked=0;const entry={textContent:'Test and Verification',closest:()=>null,getBoundingClientRect:()=>({width:30}),click:()=>clicked++};assert.equal(capture.navigate({querySelectorAll:()=>[entry,entry]},topic),false);assert.equal(clicked,0);
});
test('exhausted capture reports all retry stages and fallback failure without hiding the error',async()=>{
 let renders=0;await assert.rejects(capture.capture(doc([]),shot,{signal:new AbortController().signal,sleep:async()=>{},render:async()=>renders++}),e=>{assert.equal(e.code,'CAPTURE_FAILED');assert.equal(e.attempts.length,4);assert.equal(e.attempts.at(-1).code,'NO_NATIVE_XML');return true;});assert.equal(renders,0);
});
test('abort stops retries and never reconstructs or renders after stopping',async()=>{
 const c=new AbortController();let calls=0;await assert.rejects(capture.capture(doc([region()]),shot,{signal:c.signal,sleep:async()=>{},render:async()=>{calls++;c.abort();throw Error('stopped');}}));assert.equal(calls,1);
});
test('collector DTOs strip arbitrary attributes and reject active elements, unsafe types and oversized trees',()=>{
 const tree={tag:'section',key:'one',onclick:'unsafe',children:[{tag:'button',key:'b',href:'https://other',children:[{text:'Scan'}]}]};const parsed=controls.validate({version:'v',at:1,tree});assert.equal(parsed.tree.onclick,undefined);assert.equal(parsed.tree.children[0].href,undefined);
 for(const node of [{tag:'script',key:'s'},{tag:'input',key:'x',type:'password'},{tag:'div',key:'x',children:[{text:'x'.repeat(60001)}]}])assert.throws(()=>controls.validate({version:'v',at:1,tree:node}));
 assert.throws(()=>controls.validate({version:'v',at:1,tree:{tag:'div',key:'x',children:Array.from({length:2201},()=>({text:'x'}))}}));
});
test('collector commands allow only typed controls and bounded values',()=>{
 assert.deepEqual(controls.command({version:'v',key:'b',action:'click',html:'unsafe'}),{version:'v',key:'b',action:'click'});
 for(const input of [{action:'eval',value:'code'},{action:'input',value:'x'.repeat(301)},{action:'check',value:'true'},{action:'toggle',value:null}])assert.throws(()=>controls.command({version:'v',key:'b',...input}));
});
test('source controls reject stale generations, disabled nodes and foreign roots, then dispose',()=>{
 let clicks=0;const section={nodeType:1,tagName:'SECTION',childNodes:[],isConnected:true,getAttribute:()=>null,getRootNode:()=>root},button={nodeType:1,tagName:'BUTTON',childNodes:[],isConnected:true,getAttribute:()=>null,getRootNode:()=>root,dispatchEvent:()=>clicks++};section.childNodes=[button];const root={querySelector:s=>s==='section'?section:null};const source=controls.source(root),snapshot=source.snapshot(),key=snapshot.tree.children[0].key,valid={version:snapshot.version,key,action:'click'};
 source.execute(valid);assert.equal(clicks,1);assert.throws(()=>source.execute({...valid,version:'stale'}));button.disabled=true;assert.throws(()=>source.execute(valid));button.disabled=false;button.getRootNode=()=>({});assert.throws(()=>source.execute(valid));button.getRootNode=()=>root;source.close();assert.throws(()=>source.execute(valid));assert.equal(source.snapshot().closed,true);
});
test('columns align preview and live panel while preview-only tiling supports ten RFCs',()=>{
 const boxes=pip.columnsLayout(10,900,650);assert.equal(boxes.length,10);for(const [i,b]of boxes.entries()){assert.equal(b.y,0);assert.equal(b.width/b.height,1.6);assert.ok(b.panelHeight>b.height);if(i)assert.ok(b.x>boxes[i-1].x+boxes[i-1].width);}
 for(const [w,h]of [[300,400],[1200,850]])for(const [iw,ih]of [[1600,900],[600,1600]]){const b=pip.viewerSize(iw,ih,w,h);assert.ok(b.width<=w-32);assert.ok(b.height<=h-32);}
});
test('evidence and preview render queues serialize and recover after a renderer fails',async()=>{
 const source={},events=[];let release;const first=pip.withRenderLock(source,async()=>{events.push('first');await new Promise(r=>release=r);throw Error('render failed');});const second=pip.withRenderLock(source,async()=>events.push('second'));await new Promise(r=>setImmediate(r));assert.deepEqual(events,['first']);release();await assert.rejects(first);await second;assert.deepEqual(events,['first','second']);
});
test('source edits and details preserve state with a monotonically increasing snapshot revision',()=>{
 const nodes=[],root={querySelector:s=>s==='section'?section:null},section={nodeType:1,tagName:'SECTION',childNodes:nodes,isConnected:true,getAttribute:()=>null,getRootNode:()=>root};const events=[];
 for(const [tag,type,value]of [['INPUT','text','old'],['INPUT','checkbox',''],['DETAILS',null,'']])nodes.push({nodeType:1,tagName:tag,type,value,checked:false,open:false,childNodes:[],isConnected:true,getAttribute:()=>null,getRootNode:()=>root,dispatchEvent:event=>events.push(event.type)});
 const source=controls.source(root),first=source.snapshot();const edit=source.execute({version:first.version,key:first.tree.children[0].key,action:'input',value:'new.docx'});assert.equal(nodes[0].value,'new.docx');assert.deepEqual(events,['input','change']);assert.ok(edit.revision>first.revision);
 source.execute({version:first.version,key:first.tree.children[1].key,action:'check',value:true});assert.equal(nodes[1].checked,true);source.execute({version:first.version,key:first.tree.children[2].key,action:'toggle',value:true});assert.equal(nodes[2].open,true);source.close();assert.equal(source.snapshot().dialog,null);
});
test('fallback refuses retained XML whose section heading belongs to another chapter',()=>{
 const parser=global.DOMParser;global.DOMParser=class{parseFromString(){return {querySelector:()=>({querySelector:()=>({textContent:'3.5 Changeback'})})};}};
 try{assert.throws(()=>capture.reconstruct({}, {topic:{...topic,xml:'<article>wrong</article>'},kind:'text'}),e=>e.code==='NATIVE_SECTION_MISMATCH');}finally{if(parser)global.DOMParser=parser;else delete global.DOMParser;}
});
test('nested native DIV/P/SPAN directory entries click the unique leaf without confusing siblings',()=>{
 let clicked=0;const leaf={textContent:'3.4 Test and Verification',closest:()=>null,getBoundingClientRect:()=>({width:30}),click:()=>clicked++};
 const parent={...leaf,click:()=>assert.fail('parent must not be clicked'),contains:n=>n===leaf};
 const d={querySelectorAll:selector=>selector.includes('#NavigationTree')?[parent,leaf]:[]};
 assert.equal(capture.navigate(d,topic),true);assert.equal(clicked,1);
 const duplicate={...leaf};assert.equal(capture.navigate({querySelectorAll:()=>[parent,leaf,duplicate]},topic),false);assert.equal(clicked,1);
});
test('delayed native navigation waits for content and layout to settle instead of capturing an initial shell',async()=>{
 let polls=0,clicked=0;const a=region();a.innerHTML='loading';
 const node={textContent:'3.4 Test and Verification',closest:()=>null,getBoundingClientRect:()=>({width:30}),click:()=>clicked++};
 const d={querySelectorAll:s=>s==='article'?(polls>=2?[a]:[]):[node]};
 const result=await capture.capture(d,shot,{signal:new AbortController().signal,sleep:async()=>{polls++;if(polls===4)a.innerHTML='complete content';},render:async el=>{assert.equal(el.innerHTML,'complete content');assert.ok(polls>=6);return ['png'];}});
 assert.equal(result.method,'live');assert.equal(clicked,1);
});
test('scroll-triggered virtualization replaces the node before rendering and the new node is captured',async()=>{
 const a=region(),b=region();let current=a,rendered;
 a.scrollIntoView=()=>{a.isConnected=false;current=b;};
 const d={querySelectorAll:s=>s==='article'?[current]:[]};
 const result=await capture.capture(d,shot,{signal:new AbortController().signal,sleep:async()=>{},render:async el=>{rendered=el;return ['png'];}});
 assert.equal(result.method,'live');assert.equal(rendered,b);
});
test('a node removed during renderer work retries against the current chapter instead of accepting stale evidence',async()=>{
 const a=region(),b=region();let current=a,calls=0;
 const d={querySelectorAll:s=>s==='article'?[current]:[]};
 const result=await capture.capture(d,shot,{signal:new AbortController().signal,sleep:async()=>{},render:async el=>{calls++;if(calls===1){assert.equal(el,a);a.isConnected=false;current=b;}else assert.equal(el,b);return ['png'];}});
 assert.equal(calls,2);assert.equal(result.method,'live');assert.equal(result.attempts[0].code,'REGION_REPLACED');
});
test('unsettled layout has a bounded wait and preserves a detailed failure for each retry',async()=>{
 const a=region();let polls=0,renders=0;
 await assert.rejects(capture.capture(doc([a]),shot,{signal:new AbortController().signal,sleep:async()=>{a.innerHTML=String(++polls);},render:async()=>renders++}),e=>e.code==='CAPTURE_FAILED'&&e.attempts.slice(0,3).every(a=>a.code==='REGION_NOT_STABLE'));
 assert.equal(renders,0);assert.ok(polls<100);
});
test('treepanel collapsed ancestors are opened before the exact target and lazy live capture',async()=>{
 let rootOpened=false,childOpened=false,targetClicked=false,polls=0;const navigation=[];
 const entry=(text,click)=>({textContent:text,closest:()=>null,getBoundingClientRect:()=>({width:70}),click});
 const root=entry('3 Operation Steps for Change',()=>rootOpened=true),parent=entry('3.4 Test and Verification',()=>childOpened=true),target=entry('3.4.1 Verification Details',()=>targetClicked=true);
 const a=region('3.4.1 Verification Details↵');
 const d={querySelectorAll:selector=>selector==='article'?(targetClicked&&polls>=4?[a]:[]):selector.includes('#treepanel')?[root,...(rootOpened&&polls>=1?[parent]:[]),...(childOpened&&polls>=2?[target]:[])]:[]};
 const result=await capture.capture(d,{kind:'text',topic:{number:'3.4.1',title:'Verification Details'}},{signal:new AbortController().signal,sleep:async()=>polls++,navigation:event=>navigation.push(event),render:async el=>{assert.equal(el,a);assert.equal(targetClicked,true);return ['png'];}});
 assert.equal(result.method,'live');assert.deepEqual(navigation.map(n=>n.action),['ancestor.click','ancestor.click','target.click']);assert.deepEqual(navigation.map(n=>n.number),['3','3.4','3.4.1']);
});
test('collapsed directory wait is bounded and diagnoses a missing target after the parent click',async()=>{
 const events=[];let clicks=0,polls=0;
 const root={textContent:'3 Operation Steps for Change',closest:()=>null,getBoundingClientRect:()=>({width:70}),click:()=>clicks++};
 const found=await capture.reveal({querySelectorAll:()=>[root]},topic,new AbortController().signal,async()=>polls++,event=>events.push(event));
 assert.equal(found,false);assert.equal(clicks,1);assert.equal(polls,40);assert.equal(events.at(-1).action,'target.timeout');
});
test('a numbered directory entry with the wrong number is not clicked by title fallback',()=>{
 let clicks=0;const wrong={textContent:'3.3 Test and Verification',closest:()=>null,getBoundingClientRect:()=>({width:30}),click:()=>clicks++};
 assert.equal(capture.navigate({querySelectorAll:()=>[wrong]},topic),false);assert.equal(clicks,0);
});
test('progressive virtual scroll mounts target chapter when directory only clicked parent or tree entry is absent',async()=>{
 const early=region('3.1 Preparation'),targetRegion=region('3.4 Test and Verification');
 let scrollTop=0,scrollEvents=0;
 const scroller={clientHeight:600,scrollHeight:4000,get scrollTop(){return scrollTop;},set scrollTop(v){scrollTop=v;},scrollTo({top}){scrollTop=top;},dispatchEvent(){scrollEvents++;}};
 const d={scrollingElement:scroller,querySelectorAll:selector=>selector==='article'?(scrollTop>=800?[early,targetRegion]:[early]):[]};
 const result=await capture.capture(d,shot,{signal:new AbortController().signal,sleep:async()=>{},render:async el=>{assert.equal(el,targetRegion);return ['png'];}});
 assert.equal(result.method,'live');assert.ok(scrollTop>=800);assert.ok(scrollEvents>=2);
});

