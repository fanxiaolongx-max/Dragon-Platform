/* Per-cell live execution stages and optional, page-local diagnostic records. */
(function(){
    'use strict';
    const KEY='air-dev-mode',LIMIT=40;
    const read=()=>{try{return localStorage.getItem(KEY)==='1';}catch(_){return false;}};
    let enabled=read(),seq=0;
    const traces=new Map(),listeners=new Set(),progressListeners=new Set(),active=new Map();
    // Never record authentication headers. Also redact credentials embedded in user text and tool results.
    function safe(value){
        if(Array.isArray(value))return value.map(safe);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)/i.test(key)?'[REDACTED]':safe(item)]));
        if(typeof value!=='string')return value;
        return value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,'[REDACTED]')
            .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi,'[REDACTED]')
            .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,'[REDACTED]')
            .replace(/((?:["']?(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi,'$1[REDACTED]');
    }
    const changed=cellId=>listeners.forEach(listener=>{try{listener(cellId);}catch(_){}});
    const progressChanged=cellId=>progressListeners.forEach(listener=>{try{listener(cellId);}catch(_){}});
    function add(cellId,item){
        if(!cellId)return null;
        const list=traces.get(cellId)||[],entry={id:'t'+(++seq),at:new Date().toISOString(),...safe(item)};list.push(entry);
        if(list.length>LIMIT)list.splice(0,list.length-LIMIT);traces.set(cellId,list);changed(cellId);return entry;
    }
    async function post(cellId,label,path,body){
        const record=enabled,started=Date.now(),run={stage:'connecting',name:'',started};
        active.set(cellId,run);progressChanged(cellId);
        const entry=record?add(cellId,{kind:'call',label,path,method:'POST',request:{...body,_stream:true,_debug:true},status:'running',ms:0,steps:[]}):null;
        const onEvent=event=>{
            if(active.get(cellId)!==run)return;
            if(entry&&event.requestId)entry.requestId=event.requestId;
            if(event.type==='progress'){Object.assign(run,event);progressChanged(cellId);}
            if(event.type==='trace'&&entry){const step=safe(event.step),index=entry.steps.findIndex(item=>item.id===step.id);if(index<0)entry.steps.push(step);else entry.steps[index]=step;entry.ms=Date.now()-started;changed(cellId);}
            if(event.type==='complete'&&entry)Object.assign(entry,{requestId:event.requestId,httpStatus:event.status});
        };
        try{
            const reply=await API.post(path,{...body,_stream:true,...(record?{_debug:true}:{})},{onEvent});
            const steps=reply?._trace,request=reply?._request;
            if(reply&&typeof reply==='object'){delete reply._trace;delete reply._request;}
            if(entry)Object.assign(entry,{status:'success',ms:Date.now()-started,steps:Array.isArray(steps)?steps:entry.steps,request:request??entry.request,response:safe(reply),result:pretty(safe(reply))});
            return reply;
        }catch(error){
            if(entry)Object.assign(entry,{status:'error',ms:Date.now()-started,steps:Array.isArray(error.body?._trace)?error.body._trace:entry.steps,request:error.body?._request??entry.request,response:safe(error.body??null),httpStatus:error.status,error:safe(error.message||String(error))});
            throw error;
        }finally{
            if(entry)changed(cellId);
            if(active.get(cellId)===run){active.delete(cellId);progressChanged(cellId);}
        }
    }
    async function local(cellId,stage,work){
        const run={stage};active.set(cellId,run);progressChanged(cellId);
        try{return await work();}finally{if(active.get(cellId)===run){active.delete(cellId);progressChanged(cellId);}}
    }
    const pretty=value=>{if(value===undefined)return '（无 / none）';if(typeof value==='string'){try{return JSON.stringify(JSON.parse(value),null,2);}catch(_){return value;}}return JSON.stringify(value,null,2);};
    function note(cellId,label,text,{error=false}={}){if(enabled)add(cellId,{kind:'note',label,text:String(text||''),error});}
    function setEnabled(value){enabled=!!value;try{localStorage.setItem(KEY,enabled?'1':'0');}catch(_){}changed(null);}
    function emptyResult(value){const rows=Array.isArray(value)?value:[value?.sample,value?.metrics,value?.datasets,value?.chapters].find(Array.isArray);return !!rows&&!rows.length;}
    function stepText(step){
        if(step.kind==='ai')return [`【发送给模型】${step.tools?.length?'（可用工具：'+step.tools.join('、')+'）':''}`,`— 系统提示词 —\n${step.system||''}`,`— 消息 —\n${pretty(step.messages||'')}`,`【模型返回】${step.ms!==undefined?`（${(step.ms/1000).toFixed(1)} 秒）`:''}`,step.error?`出错：${step.error}`:(step.reply||'（空）')+(step.toolCalls?`\n— 要调用的工具 —\n${pretty(step.toolCalls)}`:'')].join('\n\n');
        if(step.kind==='tool')return `【工具】${step.name} · ${step.status||'success'}${step.ms!==undefined?' · '+step.ms+'ms':''}\n— 实际参数 / Request —\n${pretty(step.args)}\n— 实际返回 / Response —\n${pretty(step.result)}${step.modelTruncated?'\n— 传给模型的结果（已截断 / truncated）—\n'+step.modelResult:''}${step.error?'\n— 错误 / Error —\n'+step.error:''}`;
        if(step.kind==='retry')return `【要求模型重试】\n${step.text||''}`;
        return pretty(step);
    }
    function entryText(entry){
        if(entry.kind==='note')return `${entry.label}\n${entry.text}`;
        return [`${entry.label}  ${entry.method||'POST'} ${entry.path}  ${(entry.ms/1000).toFixed(1)} 秒 · ${entry.status||''}\nRequest ID: ${entry.requestId||'—'}\nHTTP: ${entry.httpStatus||'—'}`,`【实际请求 / Request】\n${pretty(entry.request)}`,...entry.steps.map(stepText),`【实际返回 / Response】\n${pretty(entry.response)}`,entry.error?`【请求失败】${entry.error}`:''].join('\n\n────────\n\n');
    }
    const toolNames={list_sources:['读取导入表目录','Reading imported tables'],describe_sheet:['读取工作表样本','Reading sheet samples'],list_metrics:['查询指标','Looking up metrics'],list_datasets:['读取数据集目录','Reading dataset catalog'],describe_dataset:['读取数据集样本','Reading dataset samples'],list_report_cells:['读取月报大纲','Reading report outline'],search_tool_data:['搜索工具数据','Searching tool data']};
    function progressText(cellId,en=false){
        const run=active.get(cellId);if(!run)return '';
        const stages={connecting:['正在连接服务','Connecting'],received:['服务已接收请求','Request received'],model:['等待模型响应','Waiting for model response'],model_done:['模型已返回，处理结果','Processing model response'],tool_done:[run.status==='error'?'工具调用失败，交回模型处理':'工具已返回，继续分析',run.status==='error'?'Tool failed; returning to model':'Tool returned; continuing analysis'],retry:['正在修正并重试','Correcting and retrying'],sandbox:['计算数据并渲染格子','Computing and rendering cell'],data:['读取配方数据','Reading recipe data'],image:['等待绘图模型返回','Waiting for image generation']};
        const label=run.stage==='tool'?(toolNames[run.name]||[run.name,run.name]):(stages[run.stage]||[run.stage,run.stage]);
        return label[en?1:0];
    }
    function exportLog(cellId,context={}){
        if(!enabled)return;
        const content={format:'aiops-report-diagnostics',version:1,activeStage:active.get(cellId)?.stage||null,exportedAt:new Date().toISOString(),cellId,context:safe({page:window.location?.pathname||'',...context}),retention:{perCell:LIMIT,pageOnly:true},entries:safe(traces.get(cellId)||[])};
        const blob=new Blob([JSON.stringify(content,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
        link.href=url;link.download='aiops-report-'+String(cellId).replace(/[^a-z0-9_-]/gi,'_')+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        return content;
    }
    window.AiReportTrace={post,local,note,list:cellId=>traces.get(cellId)||[],enabled:()=>enabled,setEnabled,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},subscribeProgress:fn=>{progressListeners.add(fn);return ()=>progressListeners.delete(fn);},progressText,exportLog,pretty,emptyResult,stepText,entryText,clear:cellId=>{traces.delete(cellId);changed(cellId);}};
})();
