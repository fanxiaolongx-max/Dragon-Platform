/* Independent directory requests. Successful groups remain usable when another fails. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MonthlyCatalogLoader=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const groups=['core','topic','meeting'];
 const groupOf=file=>file.kind==='meeting_attendance'?'meeting':file.kind==='topic_monthly'?'topic':'core';
 function combine(parts){const merge=key=>[...new Map(parts.flatMap(part=>part[key]||[]).map(item=>[item.id,item])).values()];return {files:merge('files'),snapshots:merge('snapshots'),batches:merge('batches'),diagnostics:{stages:parts.flatMap(part=>part.diagnostics?.stages||[]),errors:parts.flatMap(part=>part.diagnostics?.errors||[])}};}
 async function load({request,days=0,history=false,meetingFileIds=[],previous,onProgress=()=>{},onEvent=()=>{},signal,retryGroups=groups}){
  const parts=new Map(),failed=[];
  for(const group of groups)if(previous){parts.set(group,{files:previous.files.filter(file=>groupOf(file)===group),snapshots:group==='core'?previous.snapshots:[],batches:previous.batches});}
  await Promise.all(retryGroups.map(async group=>{
   const url='/api/upload/source-catalog?days='+days+'&stage='+group+(group==='meeting'?'&meetingHistory='+(history?'1':'0')+(meetingFileIds.length?'&meetingFiles='+encodeURIComponent(JSON.stringify(meetingFileIds)):''):'');
   onEvent({group,state:'loading',url});
   try{
    const data=await request(url,{timeoutMs:60000,signal,onResponse:response=>onEvent({group,state:'response',status:response.status,requestId:response.headers.get('X-Request-ID')||''})});
    if(!data||['files','snapshots','batches'].some(key=>!Array.isArray(data[key])))throw new Error('Invalid directory response');
    parts.set(group,data);onEvent({group,state:'ready',count:data.files.length,stages:data.diagnostics?.stages||[],errors:data.diagnostics?.errors||[]});
   }catch(error){
    failed.push(group);onEvent({group,state:'error',message:error.message});
    if(previous)parts.set(group,{files:previous.files.filter(file=>groupOf(file)===group),snapshots:group==='core'?previous.snapshots:[],batches:previous.batches});
   }
   onProgress({...combine([...parts.values()]),failedGroups:[...failed]});
  }));
  if(signal?.aborted){const error=new Error('Loading cancelled');error.name='AbortError';throw error;}
  if(failed.length===groups.length){const error=new Error('All source directories failed');error.failedGroups=failed;throw error;}
  return {...combine([...parts.values()]),failedGroups:failed};
 }
 return {load,combine,groupOf,groups};
});
