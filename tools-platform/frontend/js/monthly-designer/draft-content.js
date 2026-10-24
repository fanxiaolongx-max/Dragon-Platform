/* Recovery compares report content, excluding library browsing and generated save numbers. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyDraftContent=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function signature(document){
  const copy=JSON.parse(JSON.stringify(document));delete copy.libraryPrefs;delete copy.saveCount;
  for(const field of copy.meta||[])if(field.autoFill==='number'){field.value={zh:'@generated-report-number',en:'@generated-report-number'};for(const runs of Object.values(field.fieldRuns?.value||{}))for(const run of runs)run.text='@generated-report-number';}
  const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
  return JSON.stringify(stable(copy));
 }
 function reportKey(document){return JSON.stringify([String(document.name||'').trim()||document.id||'',document.reportMonth||'']);}
 return {signature,reportKey};
});
