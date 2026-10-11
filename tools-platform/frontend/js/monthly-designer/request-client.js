(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyRequestClient=api;})(typeof window==='object'?window:globalThis,function(){
    'use strict';
    function create({fetch,parse,readConcurrency=4}){
        const pending=new Set(),queue=[];let active=0;
        const drain=()=>{while(active<readConcurrency&&queue.length){const item=queue.shift();if(item.cancelled)continue;active++;item.start();}};
        async function request(url,options={},config={}){
            const controller=new AbortController(),method=options.method||'GET';let timer,rejectRequest,externalAbort,release;
            const interrupted=new Promise((_,reject)=>{rejectRequest=reject;});
            const stop=error=>{rejectRequest(error);controller.abort();};
            const entry={method,url,stop};pending.add(entry);
            const abort=()=>{const error=new Error('Loading cancelled');error.name='AbortError';stop(error);};
            if(options.signal){externalAbort=abort;options.signal.addEventListener('abort',externalAbort,{once:true});if(options.signal.aborted)abort();}
            const work=async()=>{
                if(controller.signal.aborted)return interrupted;
                timer=setTimeout(()=>{const error=new Error(config.timeoutMessage||'Request timed out: '+url);error.name='TimeoutError';stop(error);},config.timeoutMs??15000);
                return Promise.race([Promise.resolve().then(()=>fetch(url,{...options,signal:controller.signal})).then(res=>{config.onResponse?.(res);return parse(res,{method,path:url});}),interrupted]);
            };
            try{
                if(method!=='GET'||!config.queued)return await work();
                const ticket={cancelled:false,start:null};
                const turn=new Promise(resolve=>{ticket.start=()=>{release=()=>{active--;drain();};resolve();};queue.push(ticket);drain();});
                try{await Promise.race([turn,interrupted]);return await work();}finally{ticket.cancelled=true;const index=queue.indexOf(ticket);if(index>=0)queue.splice(index,1);}
            }finally{clearTimeout(timer);pending.delete(entry);if(externalAbort)options.signal.removeEventListener('abort',externalAbort);release?.();}
        }
        function cancelReads(message='Loading cancelled',matches=()=>true){
            for(const entry of pending)if(entry.method==='GET'&&matches(entry.url)){const error=new Error(message);error.name='AbortError';entry.stop(error);}
        }
        return {request,cancelReads};
    }
    return {create};
});
