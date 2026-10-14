/* Correlates native, allowlisted cross-region tabs with the RFC search that opened them. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createNetcareRouting=factory;})(typeof globalThis!=='undefined'?globalThis:this,function createNetcareRouting(){
  const origins=['https://netcare-ae.gts.huawei.com','https://netcare.huawei.com','https://netcare-de.gts.huawei.com'];
  const validOrder=value=>/^NC\d{14}$/.test(value||''),uuid=value=>/^[a-f0-9-]{36}$/.test(value||'');
  function validPage(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&origins.includes(u.origin)&&(u.pathname==='/p/netcare/index.html'||u.pathname.startsWith('/rfc/network_tuning/')||u.pathname.startsWith('/p/rfc/')||u.pathname.startsWith('/opcenter/'));}catch{return false;}}
  function urlOrder(value){try{const raw=String(value||''),decoded=decodeURIComponent(raw);const u=new URL(raw);const queries=[u.searchParams,new URLSearchParams(u.hash.replace(/^#/,'').split('?')[1]||''),new URLSearchParams(decoded.replace(/^[^?]*\?/,''))];const found=new Set();for(const q of queries)for(const [key,val] of q)if(['orderid','order_id','docid','id'].includes(key.toLowerCase())){const normVal=/^D?NC\d{14}$/i.test(val)?val.replace(/^D/i,'').toUpperCase():val;if(validOrder(normVal))found.add(normVal);}for(const m of (raw+' '+decoded).matchAll(/(?:orderid|order_id|docid|id)=D?(NC\d{14})/gi))found.add(m[1].toUpperCase());if(found.size>1)return '!ambiguous';if(found.size)return [...found][0];}catch{}return '';}
  // Runs inside the native target page. No service calls or credentials are inspected.
  function probe(order){
    const fromUrl=value=>{try{const raw=String(value||''),decoded=decodeURIComponent(raw);const u=new URL(raw,location.href);const found=new Set();for(const params of [u.searchParams,new URLSearchParams(u.hash.replace(/^#/,'').split('?')[1]||''),new URLSearchParams(decoded.replace(/^[^?]*\?/,''))])for(const [key,val] of params)if(['orderid','order_id','docid','id'].includes(key.toLowerCase())){const normVal=/^D?NC\d{14}$/i.test(val)?val.replace(/^D/i,'').toUpperCase():val;if(/^NC\d{14}$/.test(normVal))found.add(normVal);}for(const m of (raw+' '+decoded).matchAll(/(?:orderid|order_id|docid|id)=D?(NC\d{14})/gi))found.add(m[1].toUpperCase());if(found.size>1)return '!ambiguous';if(found.size)return [...found][0];}catch{}return '';};
    const explicit=fromUrl(location.href);if(explicit)return explicit===order;
    for(const frame of document.querySelectorAll('iframe')){try{const u=new URL(frame.src,location.href);if(u.origin!==location.origin||(!u.pathname.startsWith('/rfc/network_tuning/')&&!u.pathname.startsWith('/p/rfc/')&&!u.pathname.startsWith('/opcenter/')))continue;const found=fromUrl(u.href);if(found)return found===order;}catch{}}
    return [...document.querySelectorAll('input')].some(input=>input.value===order);
  }
  function background(){
    let chain=Promise.resolve();const retries=new Set(),stopSignals=new Map();
    const stopped=job=>stopSignals.get(job.id+':'+job.order)?.has(job.rootTabId)||stopSignals.get(job.id+':'+job.order)?.has(job.currentTabId);
    const retry=tabId=>{if(retries.has(tabId))return;retries.add(tabId);setTimeout(()=>{retries.delete(tabId);inspect(tabId).catch(()=>{});},1500);};
    const serial=fn=>{const result=chain.then(fn);chain=result.catch(()=>{});return result;};
    const read=async()=>{const data=await chrome.storage.local.get('netcareRouteJobs');return data.netcareRouteJobs||{};};
    const save=async jobs=>{const now=Date.now();for(const [id,j] of Object.entries(jobs))if(now-j.started>86400000)delete jobs[id];const all=Object.values(jobs).sort((a,b)=>a.started-b.started);for(const j of all.slice(0,Math.max(0,all.length-200)))delete jobs[j.id];await chrome.storage.local.set({netcareRouteJobs:jobs});};
    const notify=async(job,event)=>{const data={jobId:job.id,order:job.order,batchId:job.batchId,origin:job.targetOrigin||job.rootOrigin,...event};await Promise.allSettled([...new Set([job.rootTabId,...job.parents||[]])].map(tabId=>chrome.tabs.sendMessage(tabId,{type:'TP_RFC_ROUTE_EVENT',data})));};
    async function candidate(tabId,sourceTabId){return serial(async()=>{const jobs=await read();let changed=false;for(const job of Object.values(jobs).filter(j=>(sourceTabId===null||j.searchTabId===sourceTabId)&&j.phase==='searching'&&j.expires>Date.now())){job.candidates??=[];const existing=job.candidates.find(c=>c.tabId===tabId);if(existing&&sourceTabId!==null){existing.sourceTabId=sourceTabId;changed=true;}if(!existing){job.candidates.push({tabId,sourceTabId});job.candidates=job.candidates.slice(-20);changed=true;}}if(changed)await save(jobs);});}
    async function inspect(tabId){return serial(async()=>{
      const jobs=await read(),pending=Object.values(jobs).filter(j=>j.phase==='searching'&&j.expires>Date.now()&&j.candidates?.some(c=>c.tabId===tabId));if(!pending.length)return;
      let tab;try{tab=await chrome.tabs.get(tabId);}catch{return;}if(!validPage(tab.url))return;const explicit=urlOrder(tab.url),eligible=pending.filter(j=>{const c=j.candidates.find(c=>c.tabId===tabId);return c.sourceTabId===null?validOrder(explicit)&&explicit===j.order&&new URL(tab.url).origin!==j.sourceOrigin:(!explicit||explicit===j.order);});if(!eligible.length)return;
      let job,documentId;const matches=[];try{for(const possible of eligible){const checks=await chrome.scripting.executeScript({target:{tabId,allFrames:false},world:'ISOLATED',func:probe,args:[possible.order]});if(checks[0]?.result===true)matches.push({job:possible,documentId:checks[0].documentId});}}catch{retry(tabId);return;}
      if(matches.length!==1){retry(tabId);return;}({job,documentId}=matches[0]);
      // The native SPA can navigate while its order is being checked. Bind injection to
      // that document and recheck the tab rather than launch against a stale URL.
      let current;try{current=await chrome.tabs.get(tabId);await chrome.tabs.get(job.rootTabId);}catch{return;}
      if(current.url!==tab.url||stopped(job)){if(current.url!==tab.url)retry(tabId);return;}
      const target=documentId?{tabId,documentIds:[documentId]}:{tabId,allFrames:false};
      const targetOrigin=new URL(tab.url).origin,from=job.searchTabId,association=job.candidates.find(c=>c.tabId===tabId)?.sourceTabId===null?'fresh-tab-exact-order':'native-source';
      if(job.visited.includes(targetOrigin)||job.visited.length>=3){job.phase='failed';job.error='跨区域跳转形成循环，已停止自动操作 / Cross-region redirect loop; stopped';await save(jobs);await notify(job,{kind:'result',ok:false,error:job.error});return;}
      job.visited.push(targetOrigin);job.parents=[...new Set([...(job.parents||[]),from])];job.currentTabId=tabId;job.searchTabId=null;job.phase='working';job.targetOrigin=targetOrigin;job.candidates=[];
      await chrome.storage.local.set({['netcareRouteTab:'+tabId]:{jobId:job.id,order:job.order,rootTabId:job.rootTabId,batchId:job.batchId,generationAt:job.started},['netcareRunStarted:'+job.order]:job.started});await save(jobs);
      await netcareBackgroundLog({order:job.order,generationAt:job.started,batchId:job.batchId,category:'system',action:'region.handoff',message:'继续处理跨区域方案 / Continue cross-region RFC',data:{from:job.sourceOrigin,to:targetOrigin,tabId,rootTabId:job.rootTabId,association}});
      await notify(job,{kind:'assigned',targetTabId:tabId,url:tab.url});
      try{
        await chrome.scripting.executeScript({target,world:'ISOLATED',files:['netcare-online-relay.js']});
        if(stopped(job))return;
        await chrome.scripting.executeScript({target,world:'MAIN',files:['netcare-language.js','netcare-pip.js','netcare-capture.js','netcare-controls.js','netcare-monitor.js','content.js']});
        if(stopped(job))return;
        const latest=await chrome.tabs.get(tabId);await chrome.tabs.get(job.rootTabId);if(latest.url!==tab.url)throw Error('Target navigated');
        await chrome.tabs.sendMessage(tabId,{type:'TP_RFC_ROUTE_LAUNCH',data:{jobId:job.id,order:job.order,batchId:job.batchId,generationAt:job.started}});
      }catch{job.phase='failed';job.error='目标站点连接失败，请确认登录及扩展网站权限 / Target site connection failed; check login and extension site access';await save(jobs);await notify(job,{kind:'result',ok:false,error:job.error});}
    });}
    chrome.tabs?.onCreated?.addListener(tab=>{candidate(tab.id,Number.isInteger(tab.openerTabId)&&tab.openerTabId>0?tab.openerTabId:null).then(()=>inspect(tab.id)).catch(()=>{});});
    chrome.webNavigation?.onCreatedNavigationTarget?.addListener(event=>candidate(event.tabId,event.sourceTabId).then(()=>inspect(event.tabId)).catch(()=>{}));
    chrome.tabs?.onUpdated?.addListener((tabId,change)=>{if(change.url||change.status==='complete')inspect(tabId).catch(()=>{});});
    chrome.tabs?.onRemoved?.addListener(tabId=>{serial(async()=>{const jobs=await read();for(const job of Object.values(jobs)){
      if(job.rootTabId===tabId&&['searching','working'].includes(job.phase)){job.phase='cancelled';if(job.currentTabId!==tabId)chrome.tabs.sendMessage(job.currentTabId,{type:'TP_RFC_ROUTE_CANCEL',data:{jobId:job.id}}).catch(()=>{});}
      else if(job.currentTabId===tabId&&['searching','working'].includes(job.phase)){job.phase='failed';await notify(job,{kind:'result',ok:false,error:'目标站点页签已关闭 / Target site tab closed'});}
    }await save(jobs);await chrome.storage.local.remove('netcareRouteTab:'+tabId);}).catch(()=>{});});
    chrome.runtime.onMessage.addListener((message,sender,reply)=>{
      if(!['TP_RFC_ROUTE_ARM','TP_RFC_ROUTE_OPEN','TP_RFC_ROUTE_LOCAL','TP_RFC_ROUTE_CANCEL','TP_RFC_ROUTE_PROGRESS','TP_RFC_ROUTE_RESULT','TP_RFC_ROUTE_RESUME'].includes(message?.type))return;
      // Let a valid owner's stop interrupt an in-flight injection without waiting
      // behind the serialized storage work. Ownership is checked against the job.
      if(message.type==='TP_RFC_ROUTE_CANCEL'&&sender.id===chrome.runtime.id&&sender.frameId===0&&sender.tab?.id&&validPage(sender.url)&&uuid(message.id)&&validOrder(message.order)){
        const key=message.id+':'+message.order;if(!stopSignals.has(key))stopSignals.set(key,new Set());stopSignals.get(key).add(sender.tab.id);
      }
      serial(async()=>{try{
        if(sender.id!==chrome.runtime.id||sender.frameId!==0||!sender.tab?.id||!validPage(sender.url)||!uuid(message.id)||!validOrder(message.order))throw Error('Invalid route source');
        const jobs=await read();let job=jobs[message.id];
        if(message.type==='TP_RFC_ROUTE_ARM'){
          if(job){if(job.currentTabId!==sender.tab.id||job.order!==message.order||['failed','cancelled','done'].includes(job.phase))throw Error('Invalid route owner');}
          else{job={id:message.id,order:message.order,rootTabId:sender.tab.id,currentTabId:sender.tab.id,rootOrigin:new URL(sender.url).origin,started:Date.now(),batchId:Number(message.batchId)||Date.now(),visited:[new URL(sender.url).origin],parents:[]};jobs[job.id]=job;await chrome.storage.local.remove('netcareRouteTab:'+sender.tab.id);}
          job.redirectTabId=null;job.searchTabId=sender.tab.id;job.sourceOrigin=new URL(sender.url).origin;job.phase='searching';job.expires=Date.now()+60000;job.candidates=[];await save(jobs);await netcareBackgroundLog({order:job.order,batchId:job.batchId,generationAt:job.started,category:'system',action:'region.search.armed',message:'已监听原生搜索的跨区域标签 / Listening for native cross-region search tabs',data:{tabId:sender.tab.id,origin:job.sourceOrigin,expires:job.expires}});reply({ok:true,data:{jobId:job.id}});return;
        }
        if(!job||job.order!==message.order)throw Error('Route expired');
        if(message.type==='TP_RFC_ROUTE_OPEN'){
          if(job.phase!=='searching'||job.searchTabId!==sender.tab.id||!validPage(message.url)||urlOrder(message.url)!==job.order||new URL(message.url).origin===job.sourceOrigin)throw Error('Invalid native redirect');
          if(job.expires<=Date.now()||stopped(job))throw Error('Route expired');
          if(job.redirectTabId){reply({ok:true,data:{tabId:job.redirectTabId}});return;}
          const tab=await chrome.tabs.create({url:message.url,active:false,openerTabId:sender.tab.id});
          job.redirectTabId=tab.id;job.candidates??=[];job.candidates.push({tabId:tab.id,sourceTabId:sender.tab.id});await save(jobs);
          await netcareBackgroundLog({order:job.order,batchId:job.batchId,generationAt:job.started,category:'system',action:'region.tab.created',message:'已打开网站指定的目标区域标签 / Opened the native target-region tab',data:{tabId:tab.id,origin:new URL(message.url).origin}});
          reply({ok:true,data:{tabId:tab.id}});Promise.resolve().then(()=>inspect(tab.id)).catch(()=>{});return;
        }
        if(message.type==='TP_RFC_ROUTE_CANCEL'){
          if(job.rootTabId!==sender.tab.id&&job.currentTabId!==sender.tab.id)throw Error('Invalid cancel owner');job.phase='cancelled';await save(jobs);if(job.currentTabId!==sender.tab.id)await chrome.tabs.sendMessage(job.currentTabId,{type:'TP_RFC_ROUTE_CANCEL',data:{jobId:job.id}}).catch(()=>{});await notify(job,{kind:'result',ok:false,error:'已停止跨区域流程 / Cross-region workflow stopped'});reply({ok:true});return;
        }
        if(job.currentTabId!==sender.tab.id)throw Error('Invalid target owner');
        if(message.type==='TP_RFC_ROUTE_RESUME'){reply({ok:true,data:job.phase==='working'?{jobId:job.id,order:job.order,batchId:job.batchId,generationAt:job.started}:null});return;}
        if(message.type==='TP_RFC_ROUTE_LOCAL'){job.searchTabId=null;job.phase='working';await save(jobs);reply({ok:true});return;}
        if(['done','cancelled','failed'].includes(job.phase)){reply({ok:false,error:'Route already finished'});return;}
        if(message.type==='TP_RFC_ROUTE_RESULT'){job.phase=message.ok?'done':'failed';await save(jobs);await notify(job,{kind:'result',ok:message.ok===true,value:String(message.value||'').slice(0,2000),error:String(message.error||'').slice(0,1000)});}
        else await notify(job,{kind:'progress',text:netcareRedactText(String(message.text||'').slice(0,2000))});
        reply({ok:true});
      }catch(e){reply({ok:false,error:e.message});}finally{if(message.type==='TP_RFC_ROUTE_CANCEL')stopSignals.delete(message.id+':'+message.order);}});return true;
    });
  }
  return {origins,validPage,urlOrder,probe,background};
});
