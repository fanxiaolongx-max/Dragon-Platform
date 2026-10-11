(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyRequestClient=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    function create({fetch,parse}){
        const pending=new Set();
        async function request(url,options={},config={}){
            const controller=new AbortController(),method=options.method||'GET';let timer,rejectRequest;
            const interrupted=new Promise((_,reject)=>{rejectRequest=reject;});
            const stop=error=>{rejectRequest(error);controller.abort();};
            const entry={method,stop};pending.add(entry);
            timer=setTimeout(()=>{const error=new Error(config.timeoutMessage||'Request timed out: '+url);error.name='TimeoutError';stop(error);},config.timeoutMs??15000);
            try{return await Promise.race([Promise.resolve().then(()=>fetch(url,{...options,signal:controller.signal})).then(res=>parse(res,{method,path:url})),interrupted]);}
            finally{clearTimeout(timer);pending.delete(entry);}
        }
        function cancelReads(message='Loading cancelled'){
            for(const entry of pending)if(entry.method==='GET'){const error=new Error(message);error.name='AbortError';entry.stop(error);}
        }
        return {request,cancelReads};
    }
    return {create};
});
