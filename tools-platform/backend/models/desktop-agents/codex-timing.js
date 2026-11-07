'use strict';
const {DesktopIPC}=require('./codex-ipc');
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(String(value).replace(/\r\n/g,'\n').trim()).digest('hex');
const memo=new Map();
async function read(id){
 const previous=memo.get(id);if(previous&&Date.now()-previous.at<15000)return previous.promise;
 const promise=(async()=>{const ipc=new DesktopIPC(undefined,1500);let owner;try{await ipc.initialize();owner=await ipc.owner(id);const state=await ipc.snapshot(id,owner);const rows=[];
  for(const turn of Object.values(state.turnHistory?.history?.entitiesByKey||{}))for(const item of turn.items||[]){
   if(item.type!=='agentMessage'||!['final','final_answer'].includes(item.phase)||typeof item.text!=='string')continue;
   const start=item.startedAtMs??turn.aeonAssistantMessageStartedAtMsById?.[item.id],end=item.completedAtMs??turn.agentMessageCompletedAtMsById?.[item.id];
   if(typeof start!=='number'||typeof end!=='number'||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
   rows.push({turnId:turn.turnId,textHash:hash(item.text),streamMs:end-start});
  }return rows;
 }finally{if(owner)ipc.follow(id,owner,false);ipc.close();}})().catch(()=>[]);
 memo.set(id,{at:Date.now(),promise});if(memo.size>40)memo.delete(memo.keys().next().value);return promise;
}
function enrich(content,metadata){return {...content,items:(content.items||[]).map(item=>{
 if(!item.rounds?.length)return item;
 const last=item.rounds.at(-1);if(last.nativeStreamTps>0)return item;const matches=metadata.filter(t=>t.turnId===last.turnId&&t.textHash===hash(item.content));
 if(matches.length!==1||last.outputHasTools!==false||!Number.isSafeInteger(last.reasoningOutputTokens)||last.reasoningOutputTokens<0||last.reasoningOutputTokens>=last.outputTokens)return item;
 const tokens=last.outputTokens-last.reasoningOutputTokens,ms=matches[0].streamMs;
 if(!(ms>0&&ms<86400000))return item;
 const round={...last,nativeStreamMs:ms,nativeStreamTokens:tokens,nativeStreamTps:tokens*1000/ms,nativeStreamScope:'visible-output-observed',timingSource:'native-metadata',timingEstimated:false};
 return {...item,rounds:[...item.rounds.slice(0,-1),round]};
})};}
module.exports={read,enrich,hash};
