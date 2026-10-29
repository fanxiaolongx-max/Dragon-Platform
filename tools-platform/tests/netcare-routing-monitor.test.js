const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const dir=__dirname+'/../backend/builtin-tools/f12-to-extension/',route=require(dir+'netcare-routing.js')(),monitor=require(dir+'netcare-monitor.js')(),packer=require(dir+'packer-core.js');
const origins=route.origins,order='NC20260910100017',code=fs.readFileSync(dir+'netcare-rfc-word.js','utf8');
const pageCode = require('./helpers/netcare-page');
const pkg=packer.buildPackage({name:'RFC',version:'1.0.17',description:'test',matches:origins.map(o=>o+'/p/netcare/index.html*').concat('https://*.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/PublishLiteView.html*').join('\n'),world:'MAIN',allFrames:true,manualLaunch:true,includePopup:true,runAt:'document_idle',license:{enabled:false},code});
function harness(){const values={},notifications=[],injections=[],callbacks=[],events={},timers=[],created=[],tabs=new Map([[1,{id:1,url:origins[0]+'/p/netcare/index.html'}]]);
 const chrome={runtime:{id:'ext',onInstalled:{addListener(){}},onMessage:{addListener:fn=>callbacks.push(fn)}},storage:{local:{get:async keys=>{if(keys==null)return structuredClone(values);return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,values[k]&&structuredClone(values[k])]));},set:async data=>Object.assign(values,structuredClone(data)),remove:async key=>{for(const k of Array.isArray(key)?key:[key])delete values[k];}}},tabs:{create:async details=>{created.push(details);const tab={id:100+created.length,...details};tabs.set(tab.id,tab);return tab;},get:async id=>{if(!tabs.has(id))throw Error('closed');return {...tabs.get(id)};},sendMessage:async(id,m)=>{notifications.push({id,...structuredClone(m)});return {ok:true};},onCreated:{addListener:fn=>events.created=fn},onUpdated:{addListener:fn=>events.updated=fn},onRemoved:{addListener:fn=>{events.removed=fn;}}},webNavigation:{onCreatedNavigationTarget:{addListener:fn=>events.target=fn}},scripting:{executeScript:async settings=>{injections.push(settings);if(settings.func)return [{result:route.urlOrder(tabs.get(settings.target.tabId).url)===settings.args[0]}];return [{}];}}};
 const context={chrome,URL,URLSearchParams,Promise,crypto,structuredClone,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};vm.runInNewContext(pkg.files['background.js'],context);
 const send=(type,id,tabId=1,data={})=>new Promise(resolve=>callbacks.forEach(fn=>fn({type,id,order,batchId:123,...data},{id:'ext',tab:{id:tabId},frameId:0,url:tabs.get(tabId).url},resolve)));
 const drain=async()=>{for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve));};
 return {chrome,values,notifications,injections,events,tabs,send,drain,timers,created,context};
}
test('routing only permits three native origins and parses exact RFCs in URLs and hash routes',()=>{
 for(const origin of origins){assert.equal(route.validPage(origin+'/p/netcare/index.html#/rfc?orderid='+order),true);assert.equal(route.urlOrder(origin+'/rfc/network_tuning/view.html?order_id='+order),order);}
 for(const value of ['http://netcare.huawei.com/p/netcare/index.html','https://netcare.huawei.com.evil.example/p/netcare/index.html','https://user:secret@netcare.huawei.com/p/netcare/index.html','https://netcare.huawei.com:8443/p/netcare/index.html',origins[0]+'/other'])assert.equal(route.validPage(value),false);
 assert.equal(route.urlOrder(origins[0]+'/p/netcare/index.html?id=garbage'),'');
 assert.equal(route.urlOrder(origins[0]+'/p/netcare/index.html?DOCID='+order),order);
 assert.equal(route.urlOrder(origins[0]+'/p/netcare/index.html?docId='+order+'#/rfc?orderid=NC20260910100018'),'!ambiguous');
});
test('concurrent searches from one source correlate targets by RFC, not the first armed job',async()=>{
 const h=harness(),first=crypto.randomUUID(),second=crypto.randomUUID(),other='NC20260910100018';
 await h.send('TP_RFC_ROUTE_ARM',first);await h.send('TP_RFC_ROUTE_ARM',second,1,{order:other});
 h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+other});h.events.created({id:2,openerTabId:1});await h.drain();
 assert.equal(h.values.netcareRouteJobs[first].phase,'searching');assert.equal(h.values.netcareRouteJobs[second].currentTabId,2);
 h.tabs.set(3,{id:3,url:origins[1]+'/p/netcare/index.html?orderid='+order});h.events.created({id:3,openerTabId:1});await h.drain();assert.equal(h.values.netcareRouteJobs[first].currentTabId,3);
});
test('delayed SPA content retries only pending candidates and binds injection to the checked document',async()=>{
 const h=harness(),id=crypto.randomUUID();let ready=false;const execute=h.chrome.scripting.executeScript;
 h.chrome.scripting.executeScript=async settings=>settings.func?(h.injections.push(settings),[{result:ready,documentId:'native-doc'}]):execute(settings);
 await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html'});h.events.created({id:2,openerTabId:1});await h.drain();assert.equal(h.injections.filter(i=>i.files).length,0);assert.equal(h.timers.length,1);
 ready=true;h.timers.shift()();await h.drain();assert.equal(h.values.netcareRouteJobs[id].currentTabId,2);assert.deepEqual(Array.from(h.injections.find(i=>i.files).target.documentIds),['native-doc']);
});
test('a stop received during injection prevents launch; a target navigating after probe is not adopted',async()=>{
 const h=harness(),id=crypto.randomUUID();let cancel;
 const execute=h.chrome.scripting.executeScript;h.chrome.scripting.executeScript=async settings=>{const value=await execute(settings);if(settings.files?.includes('netcare-online-relay.js'))cancel=h.send('TP_RFC_ROUTE_CANCEL',id);return value;};
 await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.created({id:2,openerTabId:1});await h.drain();await cancel;
 assert.equal(h.values.netcareRouteJobs[id].phase,'cancelled');assert.equal(h.notifications.some(m=>m.type==='TP_RFC_ROUTE_LAUNCH'),false);
 const other=harness(),otherId=crypto.randomUUID(),next=other.chrome.scripting.executeScript;await other.send('TP_RFC_ROUTE_ARM',otherId);other.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});other.chrome.scripting.executeScript=async settings=>{const result=await next(settings);if(settings.func)other.tabs.get(2).url='https://example.com';return result;};other.events.created({id:2,openerTabId:1});await other.drain();assert.equal(other.injections.some(i=>i.files),false);
});
test('all six cross-region directions adopt only matching native tabs and preserve root batch and owner',async()=>{
 for(const from of origins)for(const to of origins.filter(o=>o!==from)){
  const h=harness(),id=crypto.randomUUID();h.tabs.get(1).url=from+'/p/netcare/index.html';assert.equal((await h.send('TP_RFC_ROUTE_ARM',id)).ok,true);
  h.tabs.set(2,{id:2,url:to+'/p/netcare/index.html#/detail?orderid='+order});h.events.created({id:2,openerTabId:1});await h.drain();
  assert.equal(h.values.netcareRouteJobs[id].currentTabId,2);assert.equal(h.values['netcareRouteTab:2'].rootTabId,1);assert.equal(h.values['netcareRouteTab:2'].batchId,123);assert.equal(h.values.netcareCurrentBatch,undefined);
  assert.ok(h.injections.some(i=>i.world==='MAIN'&&i.files.includes('netcare-monitor.js')));assert.ok(h.notifications.some(m=>m.id===1&&m.type==='TP_RFC_ROUTE_EVENT'&&m.data.kind==='assigned'));
  assert.equal((await h.send('TP_RFC_ROUTE_PROGRESS',id,2,{text:'Reading Word'})).ok,true);assert.equal((await h.send('TP_RFC_ROUTE_RESULT',id,2,{ok:true,value:'Saved Word'})).ok,true);assert.ok(h.notifications.some(m=>m.id===1&&m.data?.kind==='result'&&m.data.ok));
 }
});
test('noopener navigation targets are associated through webNavigation; unrelated RFCs, tabs and sites are ignored',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);
 for(const [tabId,sourceTabId,url] of [[2,99,origins[2]+'/p/netcare/index.html?orderid='+order],[3,1,origins[2]+'/p/netcare/index.html?orderid=NC20260910100018'],[4,1,'https://evil.example/?orderid='+order]]){h.tabs.set(tabId,{id:tabId,url});h.events.target({tabId,sourceTabId,url});}
 await h.drain();assert.equal(h.injections.filter(i=>i.files).length,0);
 h.tabs.set(5,{id:5,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.target({tabId:5,sourceTabId:1});await h.drain();assert.equal(h.values.netcareRouteJobs[id].currentTabId,5);
});
test('about:blank targets can load later; redirect loops and cancelled jobs cannot start more automation',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:'about:blank'});h.events.created({id:2,openerTabId:1});await h.drain();assert.equal(h.injections.length,0);
 h.tabs.get(2).url=origins[2]+'/p/netcare/index.html?docId='+order;h.events.updated(2,{url:h.tabs.get(2).url});await h.drain();assert.equal(h.values.netcareRouteJobs[id].currentTabId,2);
 await h.send('TP_RFC_ROUTE_ARM',id,2);h.tabs.set(3,{id:3,url:origins[0]+'/p/netcare/index.html?orderid='+order});h.events.created({id:3,openerTabId:2});await h.drain();assert.equal(h.values.netcareRouteJobs[id].phase,'failed');assert.ok(h.notifications.some(m=>m.data?.error?.includes('loop')));
 const h2=harness(),next=crypto.randomUUID();await h2.send('TP_RFC_ROUTE_ARM',next);await h2.send('TP_RFC_ROUTE_CANCEL',next);h2.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h2.events.created({id:2,openerTabId:1});await h2.drain();assert.equal(h2.injections.length,0);
});
test('only the current delegated tab can report results; closing it fails the root workflow',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.created({id:2,openerTabId:1});await h.drain();
 assert.equal((await h.send('TP_RFC_ROUTE_RESULT',id,1,{ok:true})).ok,false);h.events.removed(2);await h.drain();assert.equal(h.values.netcareRouteJobs[id].phase,'failed');assert.ok(h.notifications.some(m=>m.data?.error?.includes('closed')));
});
test('performance samples reject invalid values and minute peaks never sum shared tab heap',()=>{
 const sample={tabId:1,rootTabId:1,role:'main',at:Date.now(),heap:100,heapLimit:1000,busy:20,lag:10,hidden:false,origin:origins[0]};assert.equal(monitor.sanitize({...sample,hidden:true}).lag,null);
 for(const changes of [{heap:-1},{busy:101},{lag:Infinity},{role:'system'},{tabId:'1'},{order:'evil'}])assert.throws(()=>monitor.sanitize({...sample,...changes}));
 const first=monitor.rollup(null,sample),second=monitor.rollup(first,{...sample,heap:110,busy:15}),third=monitor.rollup(second,{...sample,role:'online',heap:200,busy:30});assert.equal(third.mainHeap,110);assert.equal(third.otherHeap,200);assert.equal(third.busy,30);
 const points=[{at:60000,heap:1},{at:120000,heap:2},{at:240000,heap:3},{at:300000,heap:null},{at:360000,heap:4}];assert.deepEqual(monitor.segments(points,'heap',0,400000).map(a=>a.length),[2,1,1]);assert.equal(monitor.segments(points,'heap',150000,250000).length,1);
});
test('monitor sampler excludes hidden throttling, records unsupported APIs as unavailable and stops cleanly',async()=>{
 let now=0,tick,visibility;const sent=[],context={performance:{now:()=>now,memory:{usedJSHeapSize:100,jsHeapSizeLimit:1000}},document:{hidden:false,addEventListener:(_,fn)=>visibility=fn,removeEventListener(){}},setInterval:fn=>{tick=fn;return 1;},clearInterval(){},Promise};vm.runInNewContext(pkg.files['netcare-monitor.js'],context);
 const sampler=context.createNetcareMonitor().sample({send:async m=>sent.push(m)});await new Promise(resolve=>setImmediate(resolve));assert.equal(sent[0].busy,null);now=6000;await tick();assert.equal(sent.at(-1).lag,1000);context.document.hidden=true;now=60000;visibility();await tick();assert.equal(sent.at(-1).lag,null);context.document.hidden=false;now=70000;visibility();now=75000;await tick();assert.equal(sent.at(-1).lag,0);sampler.stop();const count=sent.length;await tick();assert.equal(sent.length,count);
});

test('delegated native details open online solutions owned by the original root and original batch',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:origins[2]+'/rfc/network_tuning/view.html#/rfc?orderid='+order});h.events.created({id:2,openerTabId:1});await h.drain();
 h.values.netcareCurrentBatch={started:9999};h.values['netcareRunStarted:'+order]=9999;
 const url='https://de.kdp.gts.huawei.com/ows1/static/editor/IdpLiteView/OwsPage.html?docId='+order+'&order_id='+order;
 assert.equal((await h.send('TP_RFC_OPEN_ONLINE',id,2,{url})).ok,true);assert.equal(h.created[0].openerTabId,2);assert.equal(h.values['netcareOwnedTab:101'].openerTabId,1);assert.equal(h.values['netcareOwnedTab:101'].batchId,123);assert.equal(h.values['netcareOwnedTab:101'].generationAt,h.values.netcareRouteJobs[id].started);
 h.tabs.get(2).url=origins[2]+'/rfc/network_tuning/view.html?orderid=NC20260910100018';assert.equal((await h.send('TP_RFC_OPEN_ONLINE',id,2,{url})).ok,false);assert.equal(h.created.length,1);
});
test('performance background derives source and scope from ownership, ignoring page-supplied identities',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.created({id:2,openerTabId:1});await h.drain();
 let received;h.context.tpNetcareArtifactCache.metric=async m=>{received=m;return true;};
 const reply=await h.send('TP_RFC_ARTIFACT_REQUEST',id,2,{action:'metric',metric:{rootTabId:77,tabId:888,role:'main',origin:'https://evil.example',order:'evil',heap:100,busy:10,lag:0,hidden:true}});
 assert.equal(reply.ok,true);assert.equal(received.rootTabId,1);assert.equal(received.tabId,2);assert.equal(received.role,'route');assert.equal(received.origin,origins[2]);assert.equal(received.order,order);assert.equal(received.heap,100);
});
test('navigation permission and monitor components are confined to NetCare packages',()=>{
 assert.ok(pkg.manifest.permissions.includes('webNavigation'));
 const generic=packer.buildPackage({name:'Generic',version:'1.0.0',description:'test',matches:origins[0]+'/*',world:'MAIN',allFrames:false,manualLaunch:true,includePopup:true,license:{enabled:false},code:'console.log("Generic")'});
 assert.equal(generic.manifest.permissions.includes('webNavigation'),false);assert.equal(generic.files['netcare-monitor.js'],undefined);
});

test('native detail parsing rejects conflicting URL orders and supports mixed-case keys',()=>{
 const context={URL,URLSearchParams,location:new URL('https://example.com'),window:{}};vm.runInNewContext(pageCode,context);
 assert.equal(context.netcareNativeOrder(origins[2]+'/rfc/network_tuning/view.html?Order_ID='+order),order);
 assert.equal(context.netcareNativeOrder(origins[2]+'/rfc/network_tuning/view.html?docId='+order+'#/rfc?orderid=NC20260910100018'),'!ambiguous');
});

test('routing and online relay support opcenter portal and forward TP_RFC_ROUTE_ARM',async()=>{
 for(const origin of origins){
  assert.equal(route.validPage(origin+'/opcenter/ioc/index.html#/'),true);
 }
 const relayCode=pkg.files['netcare-online-relay.js'];
 assert.ok(relayCode,'netcare-online-relay.js must be present in package');
 const windowListeners=[];
 let chromeMessageSent=null;
 const mockWindow={
  addEventListener(event,fn){if(event==='message')windowListeners.push(fn);},
  removeEventListener(){},
  postMessage(data,origin){postedMessages.push({data,origin});}
 };
 const postedMessages=[];
 const context={
  window:mockWindow,
  location:new URL(origins[0]+'/opcenter/ioc/index.html#/'),
  document:{documentElement:{dataset:{}}},
  chrome:{
   runtime:{
    sendMessage:async(msg)=>{chromeMessageSent=msg;return {ok:true,data:{jobId:'job-123'}};},
    onMessage:{addListener(){},removeListener(){}}
   },
   storage:{local:{get:async()=>({}),set:async()=>{}},onChanged:{addListener(){},removeListener(){}}}
  },
  URL,URLSearchParams,Promise,Set,Map
 };
 mockWindow.top=mockWindow;
 vm.runInNewContext(relayCode,context);
 assert.ok(windowListeners.length>0,'window message listener should be registered');
 const requestId=crypto.randomUUID(),id=crypto.randomUUID();
 for(const listener of windowListeners){
  listener({source:mockWindow,origin:origins[0],data:{source:'TP_RFC_ROUTE_ARM',id,order,requestId,batchId:123}});
 }
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(chromeMessageSent,'chrome.runtime.sendMessage should be called');
 assert.equal(chromeMessageSent.type,'TP_RFC_ROUTE_ARM');
 assert.equal(chromeMessageSent.order,order);
 const reply=postedMessages.find(m=>m.data?.source==='TP_RFC_ROUTE_REPLY');
 assert.ok(reply,'TP_RFC_ROUTE_REPLY should be posted back to window');
 assert.equal(reply.data.requestId,requestId);
 assert.equal(reply.data.ok,true);
 const url=origins[2]+'/p/netcare/index.html?orderid='+order;
 for(const listener of windowListeners)listener({source:mockWindow,origin:origins[0],data:{source:'TP_RFC_ROUTE_OPEN',id,order,url,requestId:crypto.randomUUID()}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(chromeMessageSent.type,'TP_RFC_ROUTE_OPEN');assert.equal(chromeMessageSent.url,url);
});

test('German station nested SPA hash route is parsed and routed successfully',async()=>{
 const deUrl=origins[2]+'/p/netcare/index.html#/iframe/iframe-page/%2Fp%2Frfc%2Fnetwork_tuning%2Fdist%2Findex.html%23%2Frfc%2Fbasic-info%3Forderid='+order+'&title='+order+'&title_en='+order;
 assert.equal(route.validPage(deUrl),true);
 assert.equal(route.urlOrder(deUrl),order);
 const context={URL,URLSearchParams,location:new URL('https://example.com'),window:{}};
 vm.runInNewContext(pageCode,context);
 assert.equal(context.netcareNativeOrder(deUrl),order);

 const h=harness(),id=crypto.randomUUID();
 h.tabs.get(1).url=origins[1]+'/p/netcare/index.html#/home';
 assert.equal((await h.send('TP_RFC_ROUTE_ARM',id)).ok,true);
 h.tabs.set(2,{id:2,url:deUrl});
 h.events.created({id:2,openerTabId:1});
 await h.drain();
 assert.equal(h.values.netcareRouteJobs[id].currentTabId,2);
 assert.equal(h.values['netcareRouteTab:2'].rootTabId,1);
 assert.ok(h.injections.some(i=>i.world==='MAIN'&&i.files.includes('content.js')));
 assert.ok(h.notifications.some(m=>m.type==='TP_RFC_ROUTE_LAUNCH'&&m.data.order===order));
});


test('new cross-region tabs without opener or navigation-target events continue by a unique exact RFC',async()=>{
 for(const from of origins)for(const to of origins.filter(o=>o!==from)){
  const h=harness(),id=crypto.randomUUID();h.tabs.get(1).url=from+'/p/netcare/index.html';await h.send('TP_RFC_ROUTE_ARM',id);
  const url=to+'/p/netcare/index.html#/iframe/iframe-page/%2Fp%2Frfc%2Fnetwork_tuning%2Fdist%2Findex.html%23%2Frfc%2Fbasic-info%3Forderid='+order+'&title='+order;
  h.tabs.set(2,{id:2,url});h.events.created({id:2});await h.drain();
  assert.equal(h.values.netcareRouteJobs[id].currentTabId,2);assert.equal(h.values['netcareRouteTab:2'].rootTabId,1);
  assert.ok(h.notifications.some(m=>m.id===2&&m.type==='TP_RFC_ROUTE_LAUNCH'));
 }
});
test('new source-less about:blank tabs are tracked through delayed target URL updates',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);
 h.tabs.set(2,{id:2,url:'about:blank'});h.events.created({id:2});await h.drain();assert.equal(h.injections.length,0);
 h.tabs.get(2).url=origins[2]+'/p/netcare/index.html?orderid='+order;h.events.updated(2,{url:h.tabs.get(2).url});await h.drain();
 assert.equal(h.values.netcareRouteJobs[id].currentTabId,2);
});
test('source-less fallback refuses old tabs, unknown RFCs, same-region pages, foreign sites, conflicting orders and ambiguous jobs',async()=>{
 const h=harness(),id=crypto.randomUUID();await h.send('TP_RFC_ROUTE_ARM',id);
 h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.updated(2,{status:'complete'});
 for(const [tabId,url]of [[3,origins[2]+'/p/netcare/index.html'],[4,origins[2]+'/p/netcare/index.html?orderid=NC20260910100018'],[5,origins[0]+'/p/netcare/index.html?orderid='+order],[6,'https://evil.example/?orderid='+order],[7,origins[2]+'/p/netcare/index.html?orderid='+order+'#/?id=NC20260910100018']]){
  h.tabs.set(tabId,{id:tabId,url});h.events.created({id:tabId});
 }
 await h.drain();assert.equal(h.injections.filter(i=>i.files).length,0);
 const other=harness(),first=crypto.randomUUID(),second=crypto.randomUUID();await other.send('TP_RFC_ROUTE_ARM',first);await other.send('TP_RFC_ROUTE_ARM',second);
 other.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});other.events.created({id:2});await other.drain();
 assert.equal(other.injections.filter(i=>i.files).length,0);assert.equal(other.values.netcareRouteJobs[first].phase,'searching');assert.equal(other.values.netcareRouteJobs[second].phase,'searching');
});
test('source-less fallback does not adopt tabs created before arming or after cancellation',async()=>{
 const h=harness(),id=crypto.randomUUID();h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.created({id:2});await h.drain();
 await h.send('TP_RFC_ROUTE_ARM',id);h.events.updated(2,{status:'complete'});await h.drain();assert.equal(h.injections.length,0);
 await h.send('TP_RFC_ROUTE_CANCEL',id);h.tabs.set(3,{id:3,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.created({id:3});await h.drain();assert.equal(h.injections.length,0);
});

test('active search forwards only exact native cross-region opens and restores the original opener',()=>{
 const context={URL,URLSearchParams,location:new URL(origins[0]),window:{}};vm.runInNewContext(pageCode,context);
 const opened=[],forwarded=[],native=function(...args){opened.push({receiver:this,args});return 'native-window';};
 const win={location:new URL(origins[0]+'/p/netcare/index.html'),open:native};
 const restore=context.netcareSearchRedirects(win,order,url=>forwarded.push(url));
 const target=origins[2]+'/p/netcare/index.html#/iframe/iframe-page/%2Fp%2Frfc%2Fnetwork_tuning%2Fdist%2Findex.html%23%2Frfc%2Fbasic-info%3Forderid='+order;
 assert.equal(win.open(target,'_blank'),null);assert.equal(win.open(target,'_blank'),null);assert.deepEqual(forwarded,[target]);
 for(const url of [origins[0]+'/p/netcare/index.html?orderid='+order,origins[2]+'/p/netcare/index.html?orderid=NC20260910100018','https://evil.example/?orderid='+order,'http://netcare-de.gts.huawei.com/p/netcare/index.html?orderid='+order,'https://user:secret@netcare-de.gts.huawei.com/p/netcare/index.html?orderid='+order,origins[2]+'/other?orderid='+order,target+'&docid=NC20260910100018'])assert.equal(win.open(url,'_blank','noopener'),'native-window');
 assert.equal(opened.length,7);assert.ok(opened.every(item=>item.receiver===win&&item.args[1]==='_blank'&&item.args[2]==='noopener'));
 restore();assert.equal(win.open,native);
 const restoreAgain=context.netcareSearchRedirects(win,order,()=>{}),replacement=()=>{};win.open=replacement;restoreAgain();assert.equal(win.open,replacement);
});
test('native redirect requests create and launch the exact target tab under the root workflow',async()=>{
 const h=harness(),id=crypto.randomUUID(),url=origins[2]+'/p/netcare/index.html?orderid='+order;
 await h.send('TP_RFC_ROUTE_ARM',id);assert.equal((await h.send('TP_RFC_ROUTE_OPEN',id,1,{url})).ok,true);await h.drain();
 assert.deepEqual(structuredClone(h.created),[{url,active:false,openerTabId:1}]);assert.equal(h.values.netcareRouteJobs[id].currentTabId,101);
 assert.equal(h.values['netcareRouteTab:101'].rootTabId,1);assert.ok(h.notifications.some(m=>m.id===101&&m.type==='TP_RFC_ROUTE_LAUNCH'));
 assert.equal((await h.send('TP_RFC_ROUTE_OPEN',id,1,{url})).ok,false);assert.equal(h.created.length,1);
});
test('native redirect requests reject foreign owners, invalid destinations, expired and stopped jobs',async()=>{
 const h=harness(),id=crypto.randomUUID(),url=origins[2]+'/p/netcare/index.html?orderid='+order;
 await h.send('TP_RFC_ROUTE_ARM',id);h.tabs.set(2,{id:2,url:origins[0]+'/p/netcare/index.html'});
 assert.equal((await h.send('TP_RFC_ROUTE_OPEN',id,2,{url})).ok,false);
 for(const target of ['https://example.com/?orderid='+order,origins[0]+'/p/netcare/index.html?orderid='+order,origins[2]+'/p/netcare/index.html?orderid=NC20260910100018',url+'#/?docid=NC20260910100018'])assert.equal((await h.send('TP_RFC_ROUTE_OPEN',id,1,{url:target})).ok,false);
 h.values.netcareRouteJobs[id].expires=Date.now()-1;assert.equal((await h.send('TP_RFC_ROUTE_OPEN',id,1,{url})).ok,false);
 await h.send('TP_RFC_ROUTE_ARM',id);await h.send('TP_RFC_ROUTE_CANCEL',id);assert.equal((await h.send('TP_RFC_ROUTE_OPEN',id,1,{url})).ok,false);assert.equal(h.created.length,0);
});


test('NE cross-region handoff retains the prefix and rejects an NC RFC with identical digits', async () => {
 const h=harness(),id=crypto.randomUUID(),enterprise=order.replace(/^NC/,'NE');
 assert.equal((await h.send('TP_RFC_ROUTE_ARM',id,1,{order:enterprise})).ok,true);
 h.tabs.set(2,{id:2,url:origins[2]+'/p/netcare/index.html?orderid='+order});h.events.created({id:2,openerTabId:1});await h.drain();
 assert.equal(h.values.netcareRouteJobs[id].phase,'searching');
 h.tabs.set(3,{id:3,url:origins[2]+'/p/netcare/index.html#/detail?orderid='+enterprise});h.events.created({id:3,openerTabId:1});await h.drain();
 assert.equal(h.values.netcareRouteJobs[id].currentTabId,3);
 assert.ok(h.notifications.some(m=>m.type==='TP_RFC_ROUTE_LAUNCH'&&m.data.order===enterprise));
 assert.equal(route.urlOrder(origins[0]+'/p/netcare/index.html?docId=D'+enterprise),enterprise);
 assert.equal(route.urlOrder(origins[0]+'/p/netcare/index.html?docId='+enterprise+'#/?orderid='+order),'!ambiguous');
 const sample=monitor.sanitize({tabId:3,rootTabId:1,role:'online',at:Date.now(),order:enterprise});
 assert.equal(sample.order,enterprise);
});
