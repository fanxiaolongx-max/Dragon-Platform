const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const dir=__dirname+'/../backend/builtin-tools/f12-to-extension/',create=require(dir+'netcare-pip.js'),packer=require(dir+'packer-core.js'),code=fs.readFileSync(dir+'netcare-rfc-word.js','utf8');
const pageCode = require('./helpers/netcare-page');
const opts={name:'RFC',version:'1.0.16',description:'test',matches:'https://netcare-ae.gts.huawei.com/p/netcare/index.html*\nhttps://netcare-de.gts.huawei.com/p/netcare/index.html*\nhttps://netcare.huawei.com/p/netcare/index.html*\nhttps://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*',world:'MAIN',allFrames:true,manualLaunch:false,includePopup:false,runAt:'document_idle',license:{enabled:false},code};
const pkg=packer.buildPackage(opts),order='NC20260901000947',online='https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId='+order+'&order_id='+order;
const jpeg='data:image/jpeg;base64,/9j/AA==';
function harness(enabled=true){
 const data={netcareExtractionSettings:{pipBetaEnabled:enabled},'netcareOwnedTab:10':{order,openerTabId:1,created:1,generationAt:12,batchId:13},'netcareOwnedTab:11':{order,openerTabId:2},['netcareWordName:'+order]:'RFC.docx'},calls=[],callbacks=[];
 const tabs=new Map([[10,{id:10,url:online}],[11,{id:11,url:online}]]);
 const chrome={runtime:{id:'extension',onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async keys=>keys==null?{...data}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]))}},tabs:{get:async id=>{calls.push(['get',id]);if(!tabs.has(id))throw Error('closed');return tabs.get(id);},sendMessage:async(id,m,o)=>{calls.push(['frame',id,m,o]);return {ok:true,data:{image:jpeg,at:Date.now(),scrollTop:0,maxScroll:1000}};},update:async(id,o)=>{calls.push(['focus',id,o]);return tabs.get(id);}}};
 vm.runInNewContext(pkg.files['background.js'],{URL,chrome});
 const sender={id:'extension',frameId:0,tab:{id:1},url:'https://netcare.huawei.com/p/netcare/index.html'};
 const send=(action,extra={},source=sender)=>new Promise(reply=>callbacks[4]({type:'TP_RFC_PIP_REQUEST',id:crypto.randomUUID(),action,tabId:10,order,...extra},source,reply));
 return {data,calls,tabs,chrome,send,sender};
}
test('Preview defaults on, persists through rules export/import, validates booleans and packages all MAIN entry points',()=>{
 const context={URL,URLSearchParams,TextEncoder,Uint8Array,DataView,Blob,location:new URL('https://unrelated.example'),window:{}};vm.runInNewContext(pageCode,context);
 const settings=context.netcareDefaultSettings();assert.equal(settings.pipBetaEnabled,true);
 settings.pipBetaEnabled=false;assert.equal(context.netcareImportSettings(context.netcareExportSettings(settings)).pipBetaEnabled,false);
 assert.throws(()=>context.netcareNormalizeSettings({...settings,pipBetaEnabled:'true'}));
 const legacy={...settings};delete legacy.pipBetaEnabled;assert.equal(context.netcareNormalizeSettings(legacy).pipBetaEnabled,true);
 assert.ok(pkg.files['netcare-pip.js']);for(const c of pkg.manifest.content_scripts.filter(c=>c.world==='MAIN'))assert.ok(c.js.includes('netcare-pip.js'));
 for(const [name,source] of Object.entries(pkg.files).filter(([name])=>name.endsWith('.js')))assert.doesNotThrow(()=>new vm.Script(source),name);
 assert.ok(!pkg.manifest.permissions.includes('tabCapture'));
});
test('preview geometry preserves ratio, fits narrow workspaces and places ten cards without overlap',()=>{
 const p=create();for(const width of [50,240,420,1200])for(const desired of [-1,160,300,900]){const s=p.size(desired,width);assert.ok(s.width<=width);assert.equal(s.width/s.height,1.6);}
 for(const w of [240,600,1200]){const boxes=p.layout(10,w,600);assert.equal(boxes.length,10);for(const [i,a] of boxes.entries()){assert.ok(a.x+a.width<=w+.01);assert.ok(Math.abs(a.width/a.height-1.6)<.00001);for(const b of boxes.slice(i+1))assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}}
 assert.deepEqual(p.layout(0,300,200),[]);assert.ok(p.validImage(jpeg));for(const x of ['https://example.com/image.jpg','data:image/svg+xml;base64,AA==',jpeg+'!','data:image/jpeg;base64,'+'A'.repeat(900000)])assert.equal(p.validImage(x),false);
});
test('disabled previews make no tab calls; ownership survives worker restart and only lists current opener',async()=>{
 const off=harness(false);assert.equal((await off.send('list')).ok,false);assert.deepEqual(off.calls,[]);
 const h=harness();const list=await h.send('list');assert.equal(list.ok,true);assert.deepEqual(Array.from(list.data,t=>t.tabId),[10]);assert.equal(list.data[0].generationAt,12);assert.equal(list.data[0].title,'RFC.docx');assert.equal((await h.send('frame')).ok,true);assert.equal(h.calls.filter(c=>c[0]==='focus').length,0);
 h.tabs.delete(10);assert.equal((await h.send('list')).data.length,0);assert.equal((await h.send('frame')).ok,false);
});
test('wrong origin, frame, opener, RFC or navigated target cannot capture or activate another tab',async()=>{
 const h=harness();for(const sender of [{...h.sender,id:'other'},{...h.sender,frameId:1},{...h.sender,tab:{id:2}},{...h.sender,url:'https://unrelated.example/'}])assert.equal((await h.send('frame',{},sender)).ok,false);
 assert.equal((await h.send('frame',{tabId:11})).ok,false);assert.equal((await h.send('frame',{order:'NC20260901000948'})).ok,false);h.tabs.get(10).url='https://example.com';assert.equal((await h.send('focus')).ok,false);assert.ok(!h.calls.some(c=>c[0]==='frame'||c[0]==='focus'));
});
test('capture clamps scrolling, targets top frame and rejects invalid or navigated image replies; focus is explicit',async()=>{
 const h=harness();assert.equal((await h.send('frame',{delta:99999,large:true})).ok,true);const call=h.calls.find(c=>c[0]==='frame');assert.equal(call[2].delta,2000);assert.equal(call[2].large,true);assert.equal(call[3].frameId,0);assert.equal((await h.send('focus')).ok,true);assert.equal(h.calls.filter(c=>c[0]==='focus').length,1);
 h.chrome.tabs.sendMessage=async()=>({ok:true,data:{image:'data:image/svg+xml;base64,AA==',at:Date.now(),scrollTop:0,maxScroll:10}});assert.equal((await h.send('frame')).ok,false);
 h.chrome.tabs.sendMessage=async()=>{h.tabs.get(10).url='https://unrelated.example';return {ok:true,data:{image:jpeg,at:Date.now(),scrollTop:0,maxScroll:10}};};assert.equal((await h.send('frame')).ok,false);
});
test('renderer reads the native iframe, caps image size, disposes canvas and avoids persisting images',async()=>{
 const p=create(),scroll={scrollTop:80,scrollHeight:2400,clientHeight:800},doc={body:{textContent:'Native online solution sufficiently loaded'},getElementById:()=>null,scrollingElement:scroll,querySelector:()=>null};const win={innerWidth:1280,innerHeight:800,scrollY:80,document:doc};doc.defaultView=win;
 const canvas={width:1280,height:800,toDataURL:()=>jpeg};let opts;
 const data=await p.capture({document:{getElementById:()=>({contentWindow:win})}},{delta:99999,large:true},async(body,o)=>{opts=o;assert.equal(body,doc.body);const password={value:'private'},clone={getElementById:()=>({remove(){}}),querySelectorAll:()=>[password]};o.onclone(clone);assert.equal(password.value,'');return canvas;});
 assert.equal(data.scrollTop,1600);assert.equal(data.maxScroll,1600);assert.equal(opts.scale,1);assert.equal(opts.logging,false);assert.equal(opts.allowTaint,false);assert.equal(canvas.width,0);assert.equal(canvas.height,0);
 await assert.rejects(p.capture({document:{getElementById:()=>({contentWindow:null})}}, {},()=>{}),/loading/);
 const bad={width:20,height:20,toDataURL:()=> 'data:image/jpeg;base64,'+'A'.repeat(900000)};await assert.rejects(p.capture(win,{},async()=>bad),/too large/);assert.equal(bad.width,0);
});
test('collector bridge accepts only extension-background capture and matches own window, origin, RFC and request',async()=>{
 const callbacks=[],events=new Map(),posted=[],window={addEventListener:(type,fn)=>{if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener:(type,fn)=>events.get(type)?.delete(fn),postMessage:m=>posted.push(m)};window.top=window;
 const chrome={runtime:{id:'extension',onMessage:{addListener:fn=>callbacks.push(fn),removeListener(){}},sendMessage:async()=>({})}};
 vm.runInNewContext(pkg.files['netcare-collector-bridge.js'],{window,location:new URL(online),chrome,URL,setTimeout,clearTimeout});
 let result;const id=crypto.randomUUID();assert.equal(callbacks[0]({type:'TP_RFC_PIP_CAPTURE',id,order},{id:'extension'},r=>result=r),true);
 const emit=(source,origin,data)=>[...events.get('message')].forEach(fn=>fn({source,origin,data}));const message={source:'TP_RFC_PIP_CAPTURE_RESULT',id,order,ok:true,data:{image:jpeg}};
 emit({},new URL(online).origin,message);emit(window,'https://other.example',message);emit(window,new URL(online).origin,{...message,id:crypto.randomUUID()});assert.equal(result,undefined);
 emit(window,new URL(online).origin,message);assert.equal(result.ok,true);assert.equal(events.get('message').size,1);
 callbacks[0]({type:'TP_RFC_PIP_CAPTURE',id,order},{id:'extension',tab:{id:10}},r=>result=r);assert.equal(result.ok,false);window.__tpRfcCollectorBridgeCleanup();assert.equal(events.get('message').size,0);
});
test('preview concurrency is bounded and recovers after a capture fails',async()=>{
 const h=harness();for(const id of [11,12]){h.data['netcareOwnedTab:'+id]={order,openerTabId:1};h.tabs.set(id,{id,url:online});}
 const pending=[];h.chrome.tabs.sendMessage=async()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 const a=h.send('frame'),b=h.send('frame',{tabId:11});while(pending.length<2)await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await h.send('frame',{tabId:12})).ok,false);assert.equal((await h.send('frame')).ok,false);
 pending[0].reject(Error('render failed'));pending[1].resolve({ok:true,data:{image:jpeg,at:Date.now(),scrollTop:0,maxScroll:10}});assert.equal((await a).ok,false);assert.equal((await b).ok,true);
 const next=h.send('frame',{tabId:12});while(pending.length<3)await new Promise(resolve=>setImmediate(resolve));pending[2].resolve({ok:true,data:{image:jpeg,at:Date.now(),scrollTop:0,maxScroll:10}});assert.equal((await next).ok,true);
});

test('live collector commands route only to owned tabs and validate both commands and inert responses',async()=>{
 const h=harness(),data={version:'generation',at:Date.now(),tree:{tag:'section',key:'s',children:[{tag:'button',key:'scan',children:[{text:'Scan'}]}]}};
 h.chrome.tabs.sendMessage=async(id,m,o)=>{h.calls.push(['panel',id,m,o]);return {ok:true,data};};
 assert.equal((await h.send('panel')).ok,true);const command={version:'generation',key:'scan',action:'click'};assert.equal((await h.send('control',{command})).ok,true);
 const call=h.calls.find(c=>c[0]==='panel'&&c[2].action==='control');assert.equal(call[2].type,'TP_RFC_COLLECTOR_REQUEST');assert.deepEqual({...call[2].command},command);assert.equal(call[3].frameId,0);
 assert.equal((await h.send('control',{command:{...command,action:'eval'}})).ok,false);assert.equal((await h.send('panel',{tabId:11})).ok,false);
 h.chrome.tabs.sendMessage=async()=>({ok:true,data:{...data,tree:{tag:'script',key:'x',children:[]}}});assert.equal((await h.send('panel')).ok,false);
});
test('preview frames carry bounded content dimensions for adaptive modal sizing',async()=>{
 const h=harness();h.chrome.tabs.sendMessage=async()=>({ok:true,data:{image:jpeg,width:1280,height:800,at:1,scrollTop:0,maxScroll:100}});const r=await h.send('frame');assert.equal(r.data.width,1280);assert.equal(r.data.height,800);
 h.chrome.tabs.sendMessage=async()=>({ok:true,data:{image:jpeg,width:100000,height:800,at:1,scrollTop:0,maxScroll:100}});assert.equal((await h.send('frame')).data.width,undefined);
});
test('failed preview renderer removes newly created clone containers and preserves existing containers',async()=>{
 const existing={remove:()=>{throw Error('must preserve');}},created={removed:false,remove(){this.removed=true;}},nodes=[existing],doc={body:{},getElementById:()=>null,querySelector:()=>null,querySelectorAll:s=>s==='iframe.html2canvas-container'?nodes:[],scrollingElement:{scrollTop:0,scrollHeight:800,clientHeight:800}};const w={document:doc,innerWidth:1000,innerHeight:800};doc.defaultView=w;
 await assert.rejects(create().capture(w,{},async()=>{nodes.push(created);throw Error('render failure');}),/render failure/);assert.equal(created.removed,true);
});
