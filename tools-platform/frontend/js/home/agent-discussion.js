(function(){
 'use strict';
 const API='/api/desktop-agents';let enabled=false,root,epoch=0,currentSessionId=null,activeJob=null,identity='',availabilityRevision=0,availabilityRequest=null;
 let availability={available:false,reason:'checking'};
 const L=(zh,en)=>/^en/.test(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'')?en:zh;
 const who=()=>['tools_user','tools_tenant_id','tools_token'].map(k=>localStorage.getItem(k)||sessionStorage.getItem(k)||'').join('|');
 async function request(method,url,body){const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');const r=await fetch(API+url,{method,cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;}
 function unavailableReason(){return ({checking:L('正在检查桌面 Agent 连接…','Checking desktop agent connections…'),disabled:L('请先在全局设置中启用桌面 Agent','Enable Desktop Agents in global settings first'),readonly:L('请先在全局设置中允许网页发送消息','Allow Web replies in global settings first'),offline:L('没有可发送消息的桌面 Agent，请检查客户端和连接设置','No desktop agent can send messages. Check the clients and connection settings.'),error:L('无法确认桌面 Agent 连接，请检查全局设置','Could not verify desktop agents. Check global settings.')})[availability.reason]||availability.reason;}
 async function refreshAvailability(force=false){
  if(availabilityRequest&&!force)return availabilityRequest;
  const version=++availabilityRevision,account=who();
  const pending=(async()=>{let next;
   try{const data=await request('GET','/settings'),cfg=data.settings;
    if(!data.owned||!cfg?.enabled)next={available:false,reason:'disabled'};
    else if(!cfg.allowSend)next={available:false,reason:'readonly'};
    else if(!Object.values(cfg.providers||{}).some(Boolean))next={available:false,reason:'offline'};
    else{const sessions=await request('GET','/sessions');const usable=(sessions.providers||[]).some(p=>cfg.providers[p.id]&&p.enabled&&p.connected&&p.canSend&&(p.id!=='claudecode'||cfg.claudeAutomation));next={available:usable,reason:usable?'':'offline'};}
   }catch{next={available:false,reason:'error'};}
   if(version===availabilityRevision&&account===who()){availability=next;render();}
  })();
  availabilityRequest=pending;
  try{await pending;}finally{if(availabilityRequest===pending)availabilityRequest=null;}
 }
 function render(){
  if(!root)return;const button=root.querySelector('[data-tac-start]');button.textContent=enabled?'DragonTAC · '+L('讨论组','Agent group'):'DragonTAC';button.setAttribute('aria-pressed',String(enabled));button.disabled=!availability.available;
  button.title=availability.available?(enabled?L('取消讨论组模式，保留当前草稿','Turn off the agent group and keep your draft'):L('开启桌面 Agent 讨论组，再次点击可取消','Turn on the desktop agent group; click again to turn it off')):unavailableReason();
  button.setAttribute('aria-label',button.title);
  const hint=root.querySelector('small');hint.textContent=enabled&&availability.available?L('再次点击取消 · 首次发送新建桌面对话','Click again to turn off · new desktop chats on first send'):'';
  const resume=root.querySelector('[data-tac-resume]');resume.hidden=!activeJob||!['queued','running'].includes(activeJob.status);resume.textContent=L('查看讨论','View discussion');
 }
 function startGroup(){
  if(!availability.available)return;
  epoch++; // A delayed history lookup must not undo an explicit toggle.
  if(enabled&&!window.DragonClaw?.isExternal?.()){enabled=false;render();document.getElementById('dcInput')?.focus();return;}
  const input=document.getElementById('dcInput'),draft=input?.value||'';
  if(window.DragonClaw?.isExternal?.())window.DragonClaw?.newChat?.();
  window.HomeWelinkThreads?.setSource?.('mine');window.HomeMode?.set?.('chat');enabled=true;render();
  if(input){input.value=draft;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
 }
 async function activateSession(id){const revision=++epoch;currentSessionId=id;activeJob=null;enabled=false;render();if(!id||!root)return;
  try{const data=await request('GET','/discussions/'+encodeURIComponent(id));if(revision!==epoch||identity!==who())return;enabled=data.settings?.mode==='group'&&data.settings?.version===2;activeJob=data.activeRun||null;render();}catch{/* Keep ordinary history readable when the desktop connection is disabled. */}
 }
 function handles(){return !!root&&enabled;}
 function validate(text){if(!availability.available)throw Error(unavailableReason());if(activeJob&&['queued','running'].includes(activeJob.status))throw Error(L('讨论仍在进行，请点击「查看讨论」','The group is still working. Choose View discussion.'));if(!text.trim()||text.length>4000)throw Error(L('请输入问题，最多 4000 字','Enter a question of up to 4000 characters'));}
 function format(job){const states={pending:['等待加入','Waiting to join'],creating:['正在新建专用桌面对话…','Creating a fresh desktop conversation…'],sending:['正在发送…','Sending…'],waiting:['正在思考…','Thinking…'],unavailable:['暂不可用','Unavailable'],failed:['未完成','Failed'],unknown:['结果未确认，请检查原客户端','Unconfirmed; check the desktop client'],skipped:['已跳过','Skipped']};return(job.status==='cancelled'?L('已停止后续讨论，已提交的桌面任务可能仍在运行。\n\n','Further discussion stopped; submitted desktop work may still run.\n\n'):'')+(job.reports||[]).map(r=>`### ${r.agent}\n\n${r.status==='done'?r.text:L(...(states[r.status]||['已中断','Interrupted']))}${r.error?'\n\n'+r.error:''}`).join('\n\n');}
 async function run({text,sessionId,resumeJob,signal,onStarted,onUpdate}){
  const account=who(),revision=epoch;let job;
  const stop=()=>{if(job&&account===who())request('POST','/discussion-runs/'+job.id+'/cancel',{}).then(result=>{if(account===who()&&currentSessionId===result.sessionId){activeJob=null;render();}}).catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try{
   if(!resumeJob){await refreshAvailability(true);if(account!==who())throw Error('Account changed');signal.throwIfAborted();if(revision!==epoch)throw new DOMException('Stopped','AbortError');if(!availability.available)throw Error(unavailableReason());}
   job=resumeJob?await request('GET','/discussion-runs/'+encodeURIComponent(resumeJob.id)):await request('POST','/discussion-runs',{text,sessionId,requestId:crypto.randomUUID()});
   if(account!==who())throw Error('Account changed');if(signal.aborted||revision!==epoch){stop();throw new DOMException('Stopped','AbortError');}
   currentSessionId=job.sessionId;activeJob=job;onStarted(job);onUpdate(job);render();
   while(['queued','running'].includes(job.status)){await new Promise(resolve=>setTimeout(resolve,1000));signal.throwIfAborted();if(account!==who())throw Error('Account changed');job=await request('GET','/discussion-runs/'+job.id);signal.throwIfAborted();activeJob=job;onUpdate(job);}
   activeJob=null;render();return job;
  }finally{signal.removeEventListener('abort',stop);}
 }
 function init(){if(localStorage.getItem('tools_role')!=='admin')return;const bar=document.querySelector('#dcComposer .dc-composer-bar');if(!bar)return;identity=who();root=document.createElement('span');root.className='dc-agent-group';root.innerHTML='<button type="button" data-tac-start aria-pressed="false">DragonTAC</button><small></small><button type="button" data-tac-resume hidden></button>';bar.prepend(root);
  root.querySelector('[data-tac-start]').addEventListener('click',startGroup);root.querySelector('[data-tac-resume]').addEventListener('click',()=>{if(activeJob)window.dispatchEvent(new CustomEvent('home:resume-agent-discussion',{detail:activeJob}));});render();
  refreshAvailability();
  window.addEventListener('tools:desktop-agent-settings-changed',()=>{availability={available:false,reason:'checking'};render();refreshAvailability(true);});
  window.addEventListener('tools:languagechange',render);window.addEventListener('storage',()=>{if(identity!==who()){identity=who();availability={available:false,reason:'checking'};activateSession(null);refreshAvailability(true);}});
  const timer=setInterval(()=>{if(document.visibilityState==='visible')refreshAvailability();},30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshAvailability(true);});
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
 }
 window.HomeAgentDiscussion={handles,validate,run,format,activateSession,isAgentMention:id=>enabled&&['codex','claude','claudecode','antigravity','dragontac','tac'].includes(id.toLowerCase())};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
