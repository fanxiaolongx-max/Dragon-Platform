/* Cross-page invalidation carries a timestamp only; all values are read through tenant APIs. */
(function(){
 'use strict';
 const key=()=> 'monthly-metrics-updated:'+(localStorage.getItem('tools_tenant_id')||'default');
 function notify(){try{localStorage.setItem(key(),Date.now()+':'+Math.random().toString(36).slice(2));}catch(_){}window.dispatchEvent(new Event('monthly:metrics-updated'));}
 function subscribe(callback){const same=()=>callback(),other=event=>{if(event.key===key())callback();};window.addEventListener('monthly:metrics-updated',same);window.addEventListener('storage',other);return ()=>{window.removeEventListener('monthly:metrics-updated',same);window.removeEventListener('storage',other);};}
 window.MonthlyMetricUpdates={notify,subscribe};
})();
