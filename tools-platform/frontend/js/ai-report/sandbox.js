/* Runs AI-written recipe code (compute + render) in a Worker inside an opaque-origin sandbox iframe.
   CSP blocks every network request; the iframe is removed after each run, which also stops runaway code. */
(function(){
    'use strict';
    const TIMEOUT_MS=8000;
    let kitSource=null;
    // The page's own <script> tag carries the content-versioned URL (?v=hash); fetching the bare path could return a
    // copy cached by the browser or a CDN from before the kit gained helpers (kit.nav "is not a function").
    const kitUrl=()=>document.querySelector('script[src*="/js/ai-report/render-kit.js"]')?.getAttribute('src')||'/js/ai-report/render-kit.js';
    const loadKit=()=>kitSource||=fetch(kitUrl(),{cache:'no-cache'}).then(response=>{if(!response.ok)throw new Error('Render kit unavailable');return response.text();}).catch(error=>{kitSource=null;throw error;});
    const WORKER=`for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','indexedDB','caches','BroadcastChannel'])try{self[name]=undefined;}catch(_){}
// Numbers must come from the data: random values would quietly fabricate a report.
Math.random=()=>{throw new Error('配方不能使用 Math.random 等随机数，数字必须从数据中计算');};
// Rows given to render are watched: a field read on every row of a list but present on none means compute and render
// disagree on names (shown as empty or 0 otherwise), so the recipe fails and goes back to the AI with the real field names.
const OPTIONAL=new Set(['$tone','$tones','toJSON','then','constructor','valueOf','toString','length','unit','delta','tone','color','align','format','title','html','choices','children','note','no','anchor']);
// All-zero output from non-zero input almost always means nothing matched (wrong key, label or column), so it is
// treated as a failure unless the recipe says the zeros are real.
function numbersIn(value,out=[],depth=0){
  if(out.length>=2000||depth>6)return out;
  if(typeof value==='number'&&Number.isFinite(value))out.push(value);
  else if(typeof value==='string'&&/^-?\\d+(\\.\\d+)?%?$/.test(value.trim()))out.push(parseFloat(value));
  else if(value&&typeof value==='object')for(const item of Object.values(value)){numbersIn(item,out,depth+1);if(out.length>=2000)break;}
  return out;
}
// Empty lists from input that has rows usually mean the filter, a field name or the source itself is wrong.
function arraysIn(value,out=[],depth=0){
  if(depth>6||!value||typeof value!=='object')return out;
  if(Array.isArray(value))out.push(value);
  for(const item of Object.values(value))arraysIn(item,out,depth+1);
  return out;
}
const hasRows=input=>Object.values(input||{}).some(source=>source&&typeof source==='object'&&((Array.isArray(source.rows)&&source.rows.length>0)||(Array.isArray(source.metrics)&&source.metrics.length>0)||(Array.isArray(source.chapters)&&source.chapters.some(chapter=>(chapter.cells||[]).some(cell=>cell.summary)))));
function sameExtremes(text){
  const word='A-Za-z0-9\\u4e00-\\u9fa5',high=/[高好优多大]/;
  // "TE 表现最高" / "ET回传率最高" (item first) and "回传率最优为ET" (item after).
  const before=new RegExp('(?<!['+word+'])(['+word+']{1,12}?)( *(?:表现|的[^，。,；;]{0,8})?)最([高好优多大低差少小])','g');
  const after=new RegExp('(['+word+']{0,8}?)最([高好优多大低差少小])(?:的是|为|是) *(['+word+']{1,12}?)(?=[(（ ，,。；;、]|$)','g');
  for(const sentence of text.split(/[。；;\\n]/)){
    const claims=[...[...sentence.matchAll(before)].map(match=>({item:match[1],measure:match[2].trim(),high:high.test(match[3]),at:match.index})),...[...sentence.matchAll(after)].map(match=>({item:match[3],measure:match[1],high:high.test(match[2]),at:match.index}))].sort((a,b)=>a.at-b.at);
    for(const first of claims)for(const later of claims)if(later.at>first.at&&later.item===first.item&&later.high!==first.high&&(later.measure===first.measure||!later.measure))return first.item;
  }
  return '';
}
// Metric values read by a name that does not exist this month (typos, names never listed): remembered for the error.
function watchValues(input){
  const misses=[];
  for(const source of Object.values(input||{}))if(source&&source.values&&typeof source.values==='object'&&!Array.isArray(source.values))
    source.values=new Proxy(source.values,{get(target,key,receiver){if(typeof key==='string'&&!(key in target)&&!OPTIONAL.has(key)&&!misses.includes(key))misses.push(key);return Reflect.get(target,key,receiver);}});
  return misses;
}
function watchRows(root){
  const lists=[];
  const wrap=(value,depth)=>{
    if(depth>5||!value||typeof value!=='object')return value;
    if(Array.isArray(value)){
      const rows=value.filter(item=>item&&typeof item==='object'&&!Array.isArray(item));
      if(!rows.length||rows.length<value.length)return value.map(item=>wrap(item,depth+1));
      const entry={size:rows.length,keys:new Set(rows.flatMap(row=>Object.keys(row))),reads:new Map()};lists.push(entry);
      return value.map(row=>new Proxy(wrapObject(row,depth+1),{get(target,key,receiver){if(typeof key==='string'&&!(key in target)&&!OPTIONAL.has(key))entry.reads.set(key,(entry.reads.get(key)||0)+1);return Reflect.get(target,key,receiver);}}));
    }
    return wrapObject(value,depth);
  };
  const wrapObject=(object,depth)=>{const copy={};for(const [key,item] of Object.entries(object))copy[key]=wrap(item,depth+1);return copy;};
  const value=wrap(root,0);
  return {value,missing:()=>lists.flatMap(entry=>[...entry.reads].filter(([key,count])=>count>=entry.size&&!entry.keys.has(key)).map(([key])=>({key,has:[...entry.keys]})))};
}
self.onmessage=event=>{const job=event.data;try{
if(/示例值|示例数据|模拟数据|模拟计算|假数据/.test(job.compute))throw new Error('compute 里用了示例或模拟数据，数字必须从真实数据算出。请用工具重新找到真正的数据来源（导入表、指标 list_metrics 或数据集）；确实找不到就返回 {missing:true, message}。');
const misses=watchValues(job.input);
const compute=new Function(job.compute+'\\n;return compute;')(),render=new Function(job.render+'\\n;return render;')();
if(typeof compute!=='function'||typeof render!=='function')throw new Error('Recipe must define compute and render');
const raw=compute(job.input);const result=raw===undefined?null:JSON.parse(JSON.stringify(raw));
// values['TE'] when the metric is "TOPN 风险 / TE": a half-written name hidden behind "|| 0" shows a chart of zeros.
if(!(result&&result.missing)){const labels=Object.values(job.input||{}).flatMap(source=>source&&source.values&&typeof source.values==='object'?Object.keys(source.values):[]);
const listed=new Set(Object.values(job.input||{}).flatMap(source=>source&&Array.isArray(source.metrics)?source.metrics.map(metric=>metric&&metric.label):[]));
const related=label=>label.split(' / ').some(part=>listed.has(part))?0:1;
const partial=misses.map(name=>({name,full:labels.filter(label=>label.split(' / ').includes(name)).sort((a,b)=>related(a)-related(b)).slice(0,4)})).filter(item=>item.full.length);
if(partial.length)throw new Error('按不完整的指标名称取值：'+partial.map(item=>'「'+item.name+'」不存在，实际名称是「'+item.full.join('」「')+'」').join('；')+'。指标要用 list_metrics 返回的完整名称取值，并写进指标源的 names；取不到时不要用 || 0 掩盖。');}
// "missing" is the platform's no-data flag: a list or object under that name hides the whole cell.
if(result&&typeof result==='object'&&'missing' in result&&typeof result.missing!=='boolean')throw new Error('compute 返回的 missing 字段是平台保留的“本月没有数据”标记，只能是 true/false；运营商缺数据的列表请改名（如 noData）。');
// "事故增量" showing this month's count with the real increment tucked into delta: the value must be the difference.
const rows=[];(function walk(value,depth){if(depth>5||!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value)walk(item,depth+1);return;}rows.push(value);for(const item of Object.values(value))walk(item,depth+1);})(result,0);
const misplaced=rows.find(row=>{const name=String(row.name??row.label??row.metric??row.title??'');return /增量|差值/.test(name)&&typeof row.value==='number'&&typeof row.delta==='number'&&row.value!==row.delta;});
if(misplaced)throw new Error('「'+String(misplaced.name??misplaced.label??misplaced.metric??misplaced.title)+'」是计算型指标，value 必须是算出来的差值本身（这里差值是 '+misplaced.delta+'，value 却是 '+misplaced.value+'，像是本月原值）。请把差值放进 value，这一行不再需要 delta。');
const produced=numbersIn(result);
if(produced.length>=2&&produced.every(value=>value===0)&&!(result&&result.zeroConfirmed===true)&&numbersIn(job.input).some(value=>value!==0))throw new Error('计算结果里的数字全部是 0，但输入数据中有非零数值，很可能匹配条件写错了（例如用指标名称 label 的文字去匹配 key，或字段名、列名写得不一致）。请检查 compute；如果全部为 0 确实正确，在返回结果里加上 zeroConfirmed: true。');
const lists=arraysIn(result);
if(!produced.length&&lists.length&&lists.every(list=>!list.length)&&!(result&&(result.missing||result.emptyConfirmed===true))&&hasRows(job.input))throw new Error('计算结果是空的（列表里没有任何数据），但输入数据里有内容，很可能筛选条件、字段名写错，或数据来源选错了。请用工具核对来源和列名；如果本月确实没有符合条件的数据，在返回结果里加上 emptyConfirmed: true。');
const watch=watchRows(result);self.AiReportKit._resetWidgets();const html=render(watch.value,self.AiReportKit);const missing=watch.missing();
if(missing.length)throw new Error('展示代码读取了计算结果里不存在的字段：'+missing.map(item=>item.key+'（这一组数据实际只有：'+item.has.join('、')+'）').join('；')+'。compute 输出的字段名必须和 render 读取的完全一致。');
// "TE 最高，TE 最低": a tie (often everything equal) read as a ranking. Within a sentence, the same item called both
// highest and lowest for the same measure sends the recipe back to handle ties.
const contradiction=sameExtremes(String(html??'').replace(/<[^>]*>/g,' '));
// "undefined%", "NaN" or "[object Object]" in the content means a value was never found or computed.
const shown=String(html??'').replace(/<[^>]*>/g,' ');
// "&lt;strong&gt;…" on screen: HTML was handed to a helper as plain text (kit.list/kit.text escape strings).
if(/&lt;\\/?(?:a|ul|ol|li|strong|b|span|div|p|br|table|tr|td)(?:\\s[^<>]{0,300}?)?\\/?&gt;/i.test(shown))throw new Error('展示内容里出现了被当成文字的 HTML 标签（如 &lt;strong&gt;）：kit.list、kit.text、kit.table 的单元格都会把字符串当文字处理；表格要标红请在行里加 $tone 为 bad，或 $tones 里把列 key 设为 bad。要放 HTML 时 kit.list 的每一项写成 {html:"…"}，或者直接拼接 HTML 字符串返回。');
if(/\\bundefined\\b|\\bNaN\\b|\\[object Object\\]|\\bnull%|（null|\\(null/.test(shown))throw new Error('展示内容里出现了 undefined / NaN：'+(misses.length?'读取了本月不存在的指标「'+misses.slice(0,4).join('」「')+'」（名称必须和 list_metrics 返回的完全一致，并写进这个指标源的 names）':'有值没有算出来，请检查 compute 返回的字段和 render 读取的是否一致')+'。');
// The platform already shows the AI summary at the top of the cell; sentences written by render would repeat it.
if(job.summary&&!(result&&result.missing)){const prose=String(html??'').replace(/<table[\\s\\S]*?<\\/table>/gi,' ').replace(/<[^>]*>/g,' ').match(/[^。！？!?]{12,}[。！？!?]/g)||[];
if(prose.length)throw new Error('这个配方有 narrative，平台已经在格子顶部显示总结，render 里又写了总结句（“'+prose[0].slice(0,30)+'…”），会出现两段总结。请二选一：要么删掉 render 里的总结句只保留 narrative，要么把 narrative 设为 null、由 render 把总结写在提示词要求的位置。');}
if(contradiction)throw new Error('文字里把 '+contradiction+' 同时说成最高和最低：数值并列或全部相等时不能这样写。请用 kit.extremes 找最高最低（它会处理并列），全部相等时写“均为 X、持平”，并列时列出所有名称。');
const widgets=JSON.parse(JSON.stringify(self.AiReportKit._takeWidgets()));
// "95%" handed to a chart draws nothing: metrics[].value is the raw text, the numbers are in values / targets.
const textual=[];for(const widget of widgets){const series=widget&&widget.spec&&widget.spec.option&&widget.spec.option.series;for(const item of Array.isArray(series)?series:series?[series]:[])for(const point of Array.isArray(item&&item.data)?item.data:[]){const value=point&&typeof point==='object'&&!Array.isArray(point)?point.value:point;if(typeof value==='string'&&/[%≥≤]/.test(value)&&textual.length<3)textual.push(value);}}
if(textual.length)throw new Error('图表数据是文字（如「'+textual.join('」「')+'」），图表画不出来。指标源的 metrics[].value / target 是原始文字，数字要从 input.m1.values[名称] 和 input.m1.targets[名称] 取（已转成数字，如 95）。');
// "**100%**" on screen: Markdown bold glued into HTML instead of kit.text (which turns **x** into bold) or <strong>.
if(/\\*\\*[^*\\s][^*]{0,40}\\*\\*/.test(shown))throw new Error('展示内容里出现了 Markdown 的 **加粗** 符号：自己拼接的 HTML 里加粗要写 <strong>…</strong>；只有 kit.text 会把 **x** 转成加粗。');
// "最优为，最差为": a ranking sentence whose names came out empty (comparisons on text, or nothing matched).
const blank=shown.match(/(最优|最差|最高|最低|最好|最多|最少)(为|是)\\s*[，。；、,;]/);
if(blank)throw new Error('文字里「'+blank[0]+'」后面是空的：拼句子用的名称没有算出来（常见原因是拿 "95%" 这样的文字比较大小）。请改用 input 里的数字计算，或用 kit.extremes。');
postMessage({ok:true,result,html:String(html??''),widgets});
}catch(error){postMessage({ok:false,error:String(error&&error.message||error)});}};`;
    function frameDocument(source){
        const csp="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; img-src 'none'";
        return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><script>
const source=${JSON.stringify(source)};let worker=null;
addEventListener('message',event=>{if(event.source!==parent||!event.data||!event.data.job)return;
worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
worker.onmessage=message=>parent.postMessage({runId:event.data.runId,...message.data},'*');
worker.onerror=error=>{error.preventDefault();parent.postMessage({runId:event.data.runId,ok:false,error:error.message||'Recipe failed'},'*');};
worker.postMessage(event.data.job);});
parent.postMessage({ready:true},'*');<\/script>`;
    }
    async function run(job,{timeout=TIMEOUT_MS}={}){
        const source=(await loadKit())+'\n'+WORKER,runId=Math.random().toString(36).slice(2);
        const frame=document.createElement('iframe');
        frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
        frame.style.cssText='position:absolute;width:0;height:0;border:0;visibility:hidden';
        return new Promise((resolve,reject)=>{
            const finish=(error,value)=>{clearTimeout(timer);removeEventListener('message',listen);frame.remove();error?reject(error):resolve(value);};
            const timer=setTimeout(()=>finish(new Error('配方运行超时（超过 '+Math.round(timeout/1000)+' 秒）')),timeout);
            function listen(event){
                if(event.source!==frame.contentWindow||!event.data)return;
                if(event.data.ready){frame.contentWindow.postMessage({runId,job:{compute:job.compute,render:job.render,input:job.input,summary:!!job.summary}},'*');return;}
                if(event.data.runId!==runId)return;
                event.data.ok?finish(null,{result:event.data.result,html:event.data.html,widgets:event.data.widgets||[]}):finish(new Error(event.data.error||'配方运行失败'));
            }
            addEventListener('message',listen);
            frame.srcdoc=frameDocument(source);document.body.append(frame);
        });
    }
    window.AiReportSandbox={run};
})();
