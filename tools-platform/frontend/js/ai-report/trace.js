/* Developer mode for the cell chat: when it is on, AI requests ask the server for their trace (prompts sent, model
   replies, tool calls, retries) and local steps (sandbox errors, compile attempts) are logged next to them. Traces
   live in memory for this page only; the switch is remembered per browser. */
(function(){
    'use strict';
    const KEY='air-dev-mode',LIMIT=40;
    const read=()=>{try{return localStorage.getItem(KEY)==='1';}catch(_){return false;}};
    let enabled=read(),seq=0;
    const traces=new Map(),listeners=new Set();
    const changed=cellId=>listeners.forEach(listener=>{try{listener(cellId);}catch(_){}});
    function add(cellId,item){
        if(!cellId)return null;
        const list=traces.get(cellId)||[];const entry={id:'t'+(++seq),at:new Date().toISOString(),...item};list.push(entry);
        if(list.length>LIMIT)list.splice(0,list.length-LIMIT);traces.set(cellId,list);changed(cellId);return entry;
    }
    // An AI request: in developer mode the server returns _trace beside the answer (also on errors), kept as one group.
    async function post(cellId,label,path,body){
        if(!enabled)return API.post(path,body);
        const started=Date.now();
        try{
            const reply=await API.post(path,{...body,_debug:true});
            const steps=reply&&typeof reply==='object'?reply._trace:null;if(reply&&typeof reply==='object')delete reply._trace;
            add(cellId,{kind:'call',label,path,ms:Date.now()-started,steps:Array.isArray(steps)?steps:[],result:summarize(reply)});
            return reply;
        }catch(error){
            add(cellId,{kind:'call',label,path,ms:Date.now()-started,steps:Array.isArray(error.body?._trace)?error.body._trace:[],error:error.message||String(error)});
            throw error;
        }
    }
    const summarize=reply=>{try{const text=JSON.stringify(reply,null,1);return text.length>20000?text.slice(0,20000)+'\n…':text;}catch(_){return '';}};
    // Steps that happen in the page (runs in the sandbox, retries, failures); recorded only in developer mode.
    function note(cellId,label,text,{error=false}={}){if(enabled)add(cellId,{kind:'note',label,text:String(text||''),error});}
    function setEnabled(value){enabled=!!value;try{localStorage.setItem(KEY,enabled?'1':'0');}catch(_){}changed(null);}
    // Plain text of one recorded item, for copying and the full-screen viewer.
    function stepText(step){
        if(step.kind==='ai')return [`【发送给模型】${step.tools?.length?'（可用工具：'+step.tools.join('、')+'）':''}`,`— 系统提示词 —\n${step.system||''}`,`— 消息 —\n${step.messages||''}`,`【模型返回】${step.ms?`（${(step.ms/1000).toFixed(1)} 秒）`:''}`,step.error?`出错：${step.error}`:(step.reply||'（空）')+(step.toolCalls?`\n— 要调用的工具 —\n${step.toolCalls}`:'')].join('\n\n');
        if(step.kind==='tool')return `【工具】${step.name}\n— 参数 —\n${step.args||''}\n— 结果 —\n${step.result||''}`;
        if(step.kind==='retry')return `【要求模型重试】\n${step.text||''}`;
        return JSON.stringify(step,null,1);
    }
    function entryText(entry){
        if(entry.kind==='note')return `${entry.label}\n${entry.text}`;
        return [`${entry.label}  ${entry.path}  ${(entry.ms/1000).toFixed(1)} 秒`,...entry.steps.map(stepText),entry.error?`【请求失败】${entry.error}`:`【接口返回】\n${entry.result||''}`].join('\n\n────────\n\n');
    }
    window.AiReportTrace={post,note,list:cellId=>traces.get(cellId)||[],enabled:()=>enabled,setEnabled,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},stepText,entryText,clear:cellId=>{traces.delete(cellId);changed(cellId);}};
})();
