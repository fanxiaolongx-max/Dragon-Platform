/* Low-cost page health samples. JS heap and long-task occupancy are not extension process RAM/CPU. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory;else root.createNetcareMonitor=factory;})(typeof globalThis!=='undefined'?globalThis:this,function createNetcareMonitor(){
  const DAY=86400000;
  const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  function sanitize(value){
    if(!value||!Number.isInteger(value.tabId)||!Number.isInteger(value.rootTabId)||!['main','route','online'].includes(value.role)||!finite(value.at,1,Date.now()+10000))throw Error('Invalid performance sample');
    for(const [key,max] of [['heap',1e12],['heapLimit',1e12],['busy',100],['lag',3600000]])if(value[key]!=null&&!finite(value[key],0,max))throw Error('Invalid performance '+key);
    if(value.order&&!/^N[CE]\d{14}$/.test(value.order))throw Error('Invalid performance RFC');
    return {tabId:value.tabId,rootTabId:value.rootTabId,role:value.role,order:value.order||'',at:value.at,heap:value.heap??null,heapLimit:value.heapLimit??null,busy:value.busy??null,lag:value.hidden?null:value.lag??null,hidden:value.hidden===true,origin:String(value.origin||'').slice(0,100)};
  }
  const max=(a,b)=>a==null?b:b==null?a:Math.max(a,b);
  function rollup(previous,value){
    const at=Math.floor(value.at/60000)*60000,row=previous||{id:'minute:'+value.rootTabId+':'+at,rootTabId:value.rootTabId,at,mainHeap:null,otherHeap:null,busy:null,lag:null};
    return {...row,[value.role==='main'?'mainHeap':'otherHeap']:max(row[value.role==='main'?'mainHeap':'otherHeap'],value.heap),busy:max(row.busy,value.busy),lag:max(row.lag,value.lag)};
  }
  function segments(points,key,from,to){
    const result=[];let last=-Infinity;
    for(const p of points.filter(p=>p.at>=from&&p.at<=to).sort((a,b)=>a.at-b.at)){
      if(!finite(p[key],0,1e12)){last=-Infinity;continue;}if(p.at-last>90000)result.push([]);result.at(-1).push({at:p.at,value:p[key]});last=p.at;
    }return result;
  }
  function sample(options){
    let stopped=false,busy=false,last=performance.now(),longTasks=[],observer;
    try{if(PerformanceObserver.supportedEntryTypes?.includes('longtask')){observer=new PerformanceObserver(list=>{longTasks.push(...list.getEntries().map(e=>({start:e.startTime,end:e.startTime+e.duration})));longTasks=longTasks.slice(-1000);});observer.observe({type:'longtask',buffered:false});}}catch{}
    const tick=async()=>{
      if(stopped)return;const now=performance.now(),elapsed=Math.max(1,now-last),start=last;last=now;if(busy)return;
      const occupied=longTasks.reduce((n,e)=>n+Math.max(0,Math.min(now,e.end)-Math.max(start,e.start)),0);longTasks=longTasks.filter(e=>e.end>now);
      const heap=performance.memory,metric={heap:Number.isFinite(heap?.usedJSHeapSize)?heap.usedJSHeapSize:null,heapLimit:Number.isFinite(heap?.jsHeapSizeLimit)?heap.jsHeapSizeLimit:null,busy:observer?Math.min(100,occupied/elapsed*100):null,lag:document.hidden?null:Math.max(0,elapsed-5000),hidden:document.hidden};
      busy=true;try{await options.send(metric);}catch{}finally{busy=false;}
    };
    const reset=()=>{last=performance.now();longTasks=[];};document.addEventListener('visibilitychange',reset);
    const timer=setInterval(tick,5000);tick();
    return {stop(){stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',reset);observer?.disconnect();longTasks=[];}};
  }
  function mount(options){
    const root=options.root,$=id=>root.querySelector('#'+id);let language='zh',visible=false,stopped=false,loading=false,data={points:[],latest:[]},timer;
    const tr=(zh,en)=>language==='en'?en:zh,mb=n=>n==null?'—':(n/1048576).toFixed(1)+' MB';
    function plot(svg,key,maxValue,color){
      const to=Date.now(),span=Number($('performanceRange').value)*60000,from=to-span,pieces=segments(data.points,key,from,to),all=pieces.flat(),maximum=maxValue||Math.max(1,...all.map(p=>p.value))*1.12,w=Math.max(320,svg.clientWidth||720),h=150,left=54,right=12,top=12,bottom=30,ns='http://www.w3.org/2000/svg';svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
      const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);if(text!=null)el.textContent=text;svg.append(el);return el;};
      const x=at=>left+(at-from)/span*(w-left-right),y=value=>h-bottom-value/maximum*(h-top-bottom);
      for(let i=0;i<=4;i++){const value=maximum*i/4,py=y(value);add('line',{x1:left,x2:w-right,y1:py,y2:py,stroke:'currentColor',opacity:'.12'});add('text',{x:left-8,y:py+4,'text-anchor':'end',fill:'currentColor','font-size':10},maxValue?Math.round(value)+'%':(value/1048576).toFixed(0));}
      for(let i=0;i<=4;i++){const at=from+span*i/4;add('text',{x:x(at),y:h-8,'text-anchor':i===0?'start':i===4?'end':'middle',fill:'currentColor','font-size':10},new Date(at).toLocaleTimeString(language==='en'?'en-GB':'zh-CN',{hour:'2-digit',minute:'2-digit'}));}
      for(const part of pieces){add('path',{d:part.map((p,i)=>(i?'L':'M')+x(p.at).toFixed(1)+','+y(p.value).toFixed(1)).join(' '),fill:'none',stroke:color,'stroke-width':2.5,'stroke-linejoin':'round'});for(const p of part){const dot=add('circle',{cx:x(p.at),cy:y(p.value),r:part.length===1?3:2,fill:color});const title=document.createElementNS(ns,'title');title.textContent=new Date(p.at).toLocaleString(language==='en'?'en-GB':'zh-CN')+' · '+(maxValue?p.value.toFixed(1)+'%':mb(p.value));dot.append(title);}}
      if(!all.length)add('text',{x:w/2,y:h/2,'text-anchor':'middle',fill:'currentColor','font-size':12},tr('暂无采样数据','No samples yet'));
    }
    function render(){
      const main=data.latest.find(p=>p.role==='main'),latest=data.latest.filter(p=>Date.now()-p.at<120000),peak=latest.reduce((n,p)=>max(n,p.busy),null),lag=latest.filter(p=>!p.hidden).reduce((n,p)=>max(n,p.lag),null);
      $('performanceHeap').textContent=mb(main&&Date.now()-main.at<120000?main.heap:null);$('performanceBusy').textContent=peak==null?'—':peak.toFixed(1)+'%';$('performanceLag').textContent=lag==null?'—':Math.round(lag)+' ms';$('performanceCpu').textContent=tr('独立 CPU：不可获取','Extension CPU: unavailable');
      $('performanceStatus').textContent=tr('每 5 秒采样；趋势显示每分钟峰值。只保存最近 24 小时，未采样时段留空。','Samples every 5 seconds; charts show minute peaks. Retains 24 hours; unsampled periods stay blank.');
      const warning=data.latest.some(p=>!p.closed&&!p.discarded&&!p.hidden&&Date.now()-p.at>120000)||latest.some(p=>p.busy>=40||!p.hidden&&p.lag>=1500||p.heapLimit&&p.heap/p.heapLimit>=.8);$('performanceWarning').hidden=!warning;$('performanceWarning').textContent=tr('页面压力较高或前台采样已中断。可降低并发、暂停画中画，并检查采样状态及原网站。','High page load or a foreground sampling gap. Reduce concurrency, pause previews and check sample status and the original site.');
      plot($('performanceMemoryChart'),$('performanceMemoryScope').value,null,'#4388ee');plot($('performanceCpuChart'),'busy',100,'#e3a34b');
      const body=$('performanceSources');body.replaceChildren();
      for(const p of data.latest){const row=document.createElement('tr'),old=Date.now()-p.at>120000;for(const value of [p.order||tr('主页面','Main page'),(()=>{try{return new URL(p.origin).hostname;}catch{return '—';}})(),mb(p.heap),p.busy==null?'—':p.busy.toFixed(1)+'%',p.lag==null?'—':Math.round(p.lag)+' ms',p.closed?tr('已关闭','Closed'):p.discarded?tr('浏览器已休眠','Discarded'):old?tr('采样暂停或无心跳','Paused / no heartbeat'):p.hidden?tr('后台（可能节流）','Background (may throttle)'):tr('采样中','Sampling'),new Date(p.at).toLocaleTimeString(language==='en'?'en-GB':'zh-CN')]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}row.classList.toggle('metric-stale',old||p.closed);body.append(row);}
    }
    async function refresh(){if(stopped||!visible||document.hidden||loading)return;loading=true;try{data=await options.read();render();}catch(e){$('performanceStatus').textContent=e.message;}finally{loading=false;}}
    $('performanceRange').onchange=$('performanceMemoryScope').onchange=()=>render();$('performanceRefresh').onclick=refresh;timer=setInterval(refresh,5000);
    return {show(value){visible=value;if(visible)refresh();},language(value){language=value==='en'?'en':'zh';if(visible)render();},stop(){stopped=true;clearInterval(timer);}};
  }
  return {DAY,sanitize,rollup,segments,sample,mount};
});
