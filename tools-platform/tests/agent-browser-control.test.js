const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'agent-browser-control-'));
process.env.TOOLS_DATA_DIR=path.join(sandbox,'data');process.env.TOOLS_REPORT_DATA_DIR=path.join(sandbox,'reports');
const browser=require('../backend/models/agent-browser');
const owners=browser._internal.owners;
let server,base;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test.before(async()=>{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');if(req.url==='/narrow')return res.end('<main style="max-width:440px;margin:auto"><h1>Lunch menu</h1>'+Array.from({length:20},(_,i)=>'<p>Menu '+i+' — delicious restaurant dishes and fresh ingredients, including soup, salads and sandwiches.</p>').join('')+'</main>');res.end(`<title>${req.url.startsWith('/second')?'Second':'Shared browser'}</title><form action="/second"><input id="query" name="q"><button id="submit">Search</button></form><input type="password" id="private" placeholder="Password"><input id="api-key" placeholder="API Key"><a id="popup" href="/second" target="_blank">Popup</a><div style="height:1800px">Long page</div>`);});
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
 browser.shutdownAll();
 server?.close();
 for(let i=0;i<10;i++){
  await wait(150);
  try{fs.rmSync(sandbox,{recursive:true,force:true});break;}catch(_){}
 }
});

test('manual and AI share actual Chrome tabs; input, scroll, history and handing back preserve page state', {skip:!browser.findChrome()},async()=>{
 const owner='default::manual-fixture';
 const session=await browser.control(owner,{action:'open',url:base});
 assert.equal(session.mode,'manual');
 let state=owners.get(owner),page=state.tabs.get(state.active);
 assert.equal((await browser.execute({owner},'browser_snapshot')).isError,true,'AI browser tools yield during manual control');
 const send=(action,args={})=>browser.control(owner,{action,token:session.token,...args});
 const click=async id=>{
  const view=await browser.view(owner),box=await page.evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('click',{frameId:view.frameId,x:box.x/view.viewport.width,y:box.y/view.viewport.height});
 };
 await click('query');let view=await browser.view(owner);
 await send('type',{frameId:view.frameId,text:'shared text',replace:true});
 assert.equal(await page.evaluate('document.getElementById("query").value'),'shared text');
 await assert.rejects(send('click',{frameId:view.frameId,x:.5,y:.5}),error=>error.code==='BROWSER_VIEW_STALE','used frame cannot be blindly replayed');
 view=await browser.view(owner);await assert.rejects(send('click',{frameId:view.frameId,x:2,y:0}),error=>error.code==='BROWSER_CONTROL_INVALID');
 await click('private');view=await browser.view(owner);await send('type',{frameId:view.frameId,text:'fixture-password-only'});
 await click('api-key');view=await browser.view(owner);await send('type',{frameId:view.frameId,text:'fixture-api-secret-only'});
 assert.equal(page.networkList().length,0,'manual network input is not stored for AI network tools');
 await send('release');
 const snap=await browser.execute({owner},'browser_snapshot');assert.equal(snap.isError,undefined);assert.match(snap.content,/shared text/);assert.doesNotMatch(snap.content,/fixture-password-only|fixture-api-secret-only/,'credential field values do not enter AI snapshots');
 const resumed=await browser.control(owner,{action:'acquire'});session.token=resumed.token;
 await click('query');view=await browser.view(owner);await send('key',{frameId:view.frameId,key:'Enter'});
 for(let i=0;i<40;i++){await page.refreshInfo();if(page.url.includes('/second'))break;await wait(50);}
 assert.match(page.url,/second\?q=shared/);
 await send('back');for(let i=0;i<20;i++){await page.refreshInfo();if(new URL(page.url).pathname==='/')break;await wait(50);}assert.equal(new URL(page.url).pathname,'/');
 await send('forward');for(let i=0;i<20;i++){await page.refreshInfo();if(new URL(page.url).pathname==='/second'&&await page.evaluate('document.readyState==="complete"&&document.documentElement.scrollHeight>innerHeight'))break;await wait(50);}assert.equal(new URL(page.url).pathname,'/second');
 view=await browser.view(owner);await send('scroll',{frameId:view.frameId,x:.5,y:.5,deltaY:500});
 for(let i=0;i<20;i++){if(await page.evaluate('scrollY')>0)break;await wait(50);}
 assert.ok(await page.evaluate('scrollY')>0);
 const original=page.id;
 await send('open',{url:base});await click('popup');
 for(let i=0;i<40&&state.tabs.size<2;i++)await wait(50);
 assert.equal(state.tabs.size,2,'site links opening a new window become browser tabs');assert.notEqual(state.active,original);
 await send('close-tab',{tabId:state.active});assert.equal(state.active,original);
 await send('new-tab');assert.equal(state.tabs.size,2);
 await send('open',{url:base+'/second'});
 await send('select-tab',{tabId:original});assert.equal(state.active,original);
 await send('close-tab',{tabId:original});assert.equal(state.tabs.size,1);
 await send('release');
 assert.equal((await browser.view(owner)).manual.active,false);
});

test('browser control is scoped to the owner; rejects wrong tokens, stale pages and disallowed input',async()=>{
 const owner='default::fake-control';let inputs=0;
 const page={id:'page',url:base,title:'Fixture',refreshInfo:async()=>{},screenshot:async()=>Buffer.from('png'),evaluate:async()=>({width:800,height:600}),manualInput:async()=>{inputs++},setManualControl(){}};
 const state={active:page.id,tabs:new Map([[page.id,page]]),browser:{kind:'fake',pages:()=>[page],shutdown(){}}};owners.set(owner,state);
 const session=await browser.control(owner,{action:'acquire'}),view=await browser.view(owner),count=owners.size;
 await assert.rejects(browser.control('other::fake-control',{action:'click',token:session.token,frameId:view.frameId,x:0,y:0}),error=>error.code==='BROWSER_NO_TAB');assert.equal(owners.size,count);
 await assert.rejects(browser.control(owner,{action:'click',token:'wrong',frameId:view.frameId,x:0,y:0}),error=>error.code==='BROWSER_CONTROL_REQUIRED');
 await assert.rejects(browser.control(owner,{action:'key',token:session.token,frameId:view.frameId,key:'F12'}),error=>error.code==='BROWSER_CONTROL_INVALID');
 page.url=base+'/changed';await assert.rejects(browser.control(owner,{action:'click',token:session.token,frameId:view.frameId,x:0,y:0}),error=>error.code==='BROWSER_VIEW_STALE');
 assert.equal(inputs,0);
 state.manual.touched=Date.now()-6*60*1000;assert.equal((await browser.view(owner)).manual.active,false,'abandoned manual control expires');
 await assert.rejects(browser.control(owner,{action:'open',url:'file:///etc/passwd'}),error=>error.code==='BROWSER_CONTROL_INVALID');
 owners.delete(owner);
});

test('taking control waits for in-flight AI actions and blocks subsequent AI operations',async()=>{
 const owner='default::serialized-control';let unblock,started;
 const entered=new Promise(resolve=>{started=resolve});
 const page={id:'page',url:base,title:'Fixture',refreshInfo:async()=>{},scroll:async()=>{started();await new Promise(resolve=>{unblock=resolve})},setManualControl(){}};
 const state={active:page.id,tabs:new Map([[page.id,page]]),browser:{kind:'fake',pages:()=>[page],shutdown(){}}};owners.set(owner,state);
 const ai=browser.execute({owner},'browser_scroll',{direction:'down'});await entered;
 let acquired=false;const manual=browser.control(owner,{action:'acquire'}).then(result=>{acquired=true;return result});await wait(20);assert.equal(acquired,false);
 unblock();await ai;const session=await manual;assert.equal(acquired,true);
 assert.equal((await browser.execute({owner},'browser_navigate',{url:base})).isError,true);
 await browser.control(owner,{action:'release',token:session.token});owners.delete(owner);
});

test('manual uploads and HTML5/file dragging reach the actual shared Chrome page', {skip:!browser.findChrome()},async()=>{
 const owner='default::file-drag-fixture',session=await browser.control(owner,{action:'open',url:base});
 const state=owners.get(owner),page=state.tabs.get(state.active);
 await page.evaluate(`document.body.innerHTML='<input id="file" type="file" multiple><input id="range" type="range" min="0" max="100" value="0" style="width:300px;display:block"><div draggable="true" id="source" style="width:100px;height:60px;background:red">Drag</div><div id="target" style="width:300px;height:100px;background:gray;margin-left:200px">Drop</div>';window.received=[];document.getElementById('source').ondragstart=e=>e.dataTransfer.setData('text/plain','drag-value');document.getElementById('target').ondragover=e=>e.preventDefault();document.getElementById('target').ondrop=async e=>{e.preventDefault();window.received=[e.dataTransfer.getData('text/plain'),...await Promise.all([...e.dataTransfer.files].map(f=>f.text()))]};`);
 const frame=()=>browser.view(owner);
 const point=async(id,x=.5)=>page.evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:(r.left+r.width*${x})/innerWidth,y:(r.top+r.height/2)/innerHeight}})()`);
 const send=async(action,args={})=>{const view=await frame();return browser.control(owner,{action,token:session.token,frameId:view.frameId,...args});};
 await send('click',await point('file'));
 let view=await frame();assert.ok(view.upload?.id);assert.equal(view.upload.multiple,true);
 await assert.rejects(browser.control('other::file-drag-fixture',{action:'upload',token:session.token,frameId:view.frameId,chooserId:view.upload.id,_uploads:[{originalname:'test.txt',buffer:Buffer.from('not-shared')}]}),e=>e.code==='BROWSER_NO_TAB');
 const uploaded=await browser.control(owner,{action:'upload',token:session.token,frameId:view.frameId,chooserId:view.upload.id,_uploads:[{originalname:'测试.txt',buffer:Buffer.from('browser-upload-contents')},{originalname:'sample.pdf',buffer:Buffer.from('%PDF-fixture')}]});
 assert.equal(uploaded.files.length,2);assert.equal(uploaded.files[0].path,undefined,'server paths stay private');
 assert.deepEqual(await page.evaluate(`Promise.all([...document.getElementById('file').files].map(async f=>({name:f.name,text:await f.text()})))`),[{name:'测试.txt',text:'browser-upload-contents'},{name:'sample.pdf',text:'%PDF-fixture'}]);
 assert.equal((await frame()).upload,null,'chooser consumed');
 const a=await point('range',.02),b=await point('range',.95);
 await send('click',await point('range',.02));
 const pointerView=await frame(),pointerId='fixture-live-drag';
 const pointer=(phase,p)=>browser.control(owner,{action:'pointer',phase,pointerId,token:session.token,frameId:pointerView.frameId,...p});
 await pointer('down',a);await pointer('move',b);
 assert.ok(Number(await page.evaluate(`document.getElementById('range').value`))>80,'pointer moves update the page before release');
 await assert.rejects(browser.control(owner,{action:'pointer',phase:'move',pointerId:'wrong',token:session.token,...b}),e=>e.code==='BROWSER_VIEW_STALE');
 await pointer('up',b);
 const start=await point('source'),end=await point('target');
 const pv=await frame();
 const livePointer=(phase,p)=>browser.control(owner,{action:'pointer',phase,pointerId:'html5-live-drag',token:session.token,frameId:pv.frameId,...p});
 await livePointer('down',start);
 for(let i=1;i<=10;i++)await livePointer('move',{x:start.x+(end.x-start.x)*i/10,y:start.y+(end.y-start.y)*i/10});
 await livePointer('up',end);assert.deepEqual(await page.evaluate('window.received'),['drag-value'],'live HTML5 drag preserves transfer data');
 await send('file-drop',{...end,_uploads:[{originalname:'drop.txt',buffer:Buffer.from('dropped-file-contents')}]});
 for(let i=0;i<30;i++){if((await page.evaluate('window.received')).length>1)break;await wait(20);}
 assert.deepEqual(await page.evaluate('window.received'),['','dropped-file-contents']);
 const live=await browser.view(owner,true);assert.match(live.image,/^data:image\/jpeg;base64,/);
 assert.equal((await browser.execute({owner},'browser_snapshot')).isError,true);
 await browser.control(owner,{action:'release',token:session.token});
});


test('centered narrow content gets a readable viewport; desktop navigation restores the wide viewport', {skip:!browser.findChrome()},async()=>{
 const owner='default::layout-fixture',session=await browser.control(owner,{action:'open',url:base+'/narrow'});
 let view=await browser.view(owner);assert.ok(view.layout.preferredWidth>=360&&view.layout.preferredWidth<=600,JSON.stringify(view.layout));assert.equal(view.viewport.width,view.layout.preferredWidth);
 const width=view.layout.preferredWidth;const page=owners.get(owner).tabs.get(view.tabId);
 assert.ok(await page.evaluate('document.querySelector("main").getBoundingClientRect().width')>=400,'content keeps its readable CSS size');
 page.layoutMeasuredAt=0;view=await browser.view(owner);assert.equal(view.layout.preferredWidth,width,'subsequent measurements do not oscillate back to wide');
 await browser.control(owner,{action:'open',token:session.token,url:base});view=await browser.view(owner);assert.ok(view.viewport.width>1000);assert.equal(view.layout.preferredWidth,null);
 await browser.control(owner,{action:'release',token:session.token});
});


test('force takeover interrupts a running tool; input renews five seconds and queued AI reads resume after idle', {skip:!browser.findChrome()},async()=>{
 const owner='default::force-fixture',session=await browser.control(owner,{action:'open',url:base});await browser.control(owner,{action:'release',token:session.token});
 const ai=browser.execute({owner},'browser_wait',{timeoutMs:30000});await wait(40);
 assert.equal((await browser.view(owner)).operator.active,true,'views stay available during an AI operation');
 const started=Date.now(),taken=await browser.control(owner,{action:'takeover'});assert.ok(Date.now()-started<1200,'force stop does not wait for the AI timeout');
 const result=await ai;assert.equal(result.isError,true);assert.match(result.content,/BROWSER_INTERRUPTED/);
 const state=owners.get(owner);assert.equal(state.manual.autoIdleMs,5000);assert.equal((await browser.view(owner)).operator.handoff,true,'only an interrupted AI operation needs a handback banner');
 const touched=state.manual.touched;await wait(20);await browser.control(owner,{action:'heartbeat',token:taken.token});assert.equal(state.manual.touched,touched,'background heartbeat cannot extend user inactivity');
 await browser.control(owner,{action:'activity',token:taken.token});assert.ok(state.manual.touched>touched);
 let finished=false;const queued=browser.execute({owner},'browser_snapshot').then(value=>{finished=true;return value;});await wait(100);assert.equal(finished,false,'AI waits for automatic handback');
 state.manual.touched=Date.now()-5100;assert.equal((await browser.view(owner)).manual.active,false);
 const resumed=await queued;assert.equal(resumed.isError,undefined);assert.match(resumed.content,/Shared browser/);
});

test('ordinary browsing has no AI handback state and tabs can be reordered safely', {skip:!browser.findChrome()},async()=>{
 const owner='default::ordinary-toolbar',first=await browser.control(owner,{action:'open',url:base});
 const second=await browser.control(owner,{action:'new-tab',token:first.token});
 await browser.control(owner,{action:'takeover',token:first.token});
 assert.equal((await browser.view(owner)).operator.handoff,false);
 await browser.control(owner,{action:'move-tab',token:first.token,tabId:second.tabId,index:0});
 assert.equal((await browser.view(owner)).tabs[0].id,second.tabId);
 await assert.rejects(browser.control(owner,{action:'move-tab',token:first.token,tabId:second.tabId,index:999}),error=>error.code==='BROWSER_CONTROL_INVALID');
 await browser.control(owner,{action:'release',token:first.token});
});

test('successive keystrokes reuse a keyboard frame without screenshot round trips; stale coordinates and reloaded documents are rejected', {skip:!browser.findChrome()},async()=>{
 const owner='default::typing-pipeline',session=await browser.control(owner,{action:'open',url:base}),state=owners.get(owner),page=state.tabs.get(state.active);
 await page.evaluate('document.getElementById("query").focus()');const view=await browser.view(owner);
 for(const text of '123456789')await browser.control(owner,{action:'type',token:session.token,frameId:view.frameId,text});
 await browser.control(owner,{action:'key',token:session.token,frameId:view.frameId,key:'Backspace'});
 assert.equal(await page.evaluate('document.getElementById("query").value'),'12345678');
 await assert.rejects(browser.control(owner,{action:'click',token:session.token,frameId:view.frameId,x:.5,y:.5}),error=>error.code==='BROWSER_VIEW_STALE');
 // A same-URL document reload must not accept old queued text.
 await page.navigate(base);await assert.rejects(browser.control(owner,{action:'type',token:session.token,frameId:view.frameId,text:'must not be inserted'}),error=>error.code==='BROWSER_VIEW_STALE');
 assert.equal(await page.evaluate('document.getElementById("query").value'),'');await browser.control(owner,{action:'release',token:session.token});
});
