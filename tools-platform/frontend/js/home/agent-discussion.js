(function(){
 'use strict';
 const API='/api/desktop-agents';let enabled=false,root,headerButton,epoch=0,currentSessionId=null,activeJob=null,identity='';
 const L=(zh,en)=>/^en/.test(window.ToolsI18n?.getLanguage?.()||'')?en:zh;
 const who=()=>['tools_user','tools_tenant_id','tools_token'].map(k=>localStorage.getItem(k)||sessionStorage.getItem(k)||'').join('|');
 async function request(method,url,body){const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');const r=await fetch(API+url,{method,cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);return d;}
 function render(){
  if(!root)return;for(const button of [root.querySelector('[data-tac-start]'),headerButton]){if(!button)continue;button.textContent=enabled?'DragonTAC · '+L('讨论组','Agent group'):'DragonTAC';button.setAttribute('aria-pressed',String(enabled));button.title=L('开启 Codex、Claude Code、Antigravity 讨论组，自动新建各家桌面对话','Start an agent group with fresh native desktop conversations');}
  const hint=root.querySelector('small');hint.textContent=enabled?L('首次发送自动为三家新建会话','Fresh conversations are created on first send'):'';
  const resume=root.querySelector('[data-tac-resume]');resume.hidden=!activeJob||!['queued','running'].includes(activeJob.status);resume.textContent=L('查看讨论','View discussion');
 }
 function startGroup(){
  if(enabled&&!window.DragonClaw?.isExternal?.()){document.getElementById('dcInput')?.focus();return;}
  const input=document.getElementById('dcInput'),draft=input?.value||'';
  window.DragonClaw?.newChat?.();window.HomeWelinkThreads?.setSource?.('mine');window.HomeMode?.set?.('chat');enabled=true;render();
  if(input){input.value=draft;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
 }
 async function activateSession(id){const revision=++epoch;currentSessionId=id;activeJob=null;enabled=false;render();if(!id||!root)return;
  try{const data=await request('GET','/discussions/'+encodeURIComponent(id));if(revision!==epoch||identity!==who())return;enabled=data.settings?.mode==='group'&&data.settings?.version===2;activeJob=data.activeRun||null;render();}catch{/* Keep ordinary history readable when the desktop connection is disabled. */}
 }
 function handles(){return !!root&&enabled;}
 function validate(text){if(activeJob&&['queued','running'].includes(activeJob.status))throw Error(L('讨论仍在进行，请点击「查看讨论」','The group is still working. Choose View discussion.'));if(!text.trim()||text.length>4000)throw Error(L('请输入问题，最多 4000 字','Enter a question of up to 4000 characters'));}
 function format(job){const states={pending:['等待加入','Waiting to join'],creating:['正在新建专用桌面对话…','Creating a fresh desktop conversation…'],sending:['正在发送…','Sending…'],waiting:['正在思考…','Thinking…'],unavailable:['暂不可用','Unavailable'],failed:['未完成','Failed'],unknown:['结果未确认，请检查原客户端','Unconfirmed; check the desktop client'],skipped:['已跳过','Skipped']};return(job.status==='cancelled'?L('已停止后续讨论，已提交的桌面任务可能仍在运行。\n\n','Further discussion stopped; submitted desktop work may still run.\n\n'):'')+(job.reports||[]).map(r=>`### ${r.agent}\n\n${r.status==='done'?r.text:L(...(states[r.status]||['已中断','Interrupted']))}${r.error?'\n\n'+r.error:''}`).join('\n\n');}
 async function run({text,sessionId,resumeJob,signal,onStarted,onUpdate}){
  const account=who(),revision=epoch;let job;
  const stop=()=>{if(job&&account===who())request('POST','/discussion-runs/'+job.id+'/cancel',{}).then(result=>{if(account===who()&&currentSessionId===result.sessionId){activeJob=null;render();}}).catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try{
   job=resumeJob?await request('GET','/discussion-runs/'+encodeURIComponent(resumeJob.id)):await request('POST','/discussion-runs',{text,sessionId,requestId:crypto.randomUUID()});
   if(account!==who())throw Error('Account changed');if(signal.aborted||revision!==epoch){stop();throw new DOMException('Stopped','AbortError');}
   currentSessionId=job.sessionId;activeJob=job;onStarted(job);onUpdate(job);render();
   while(['queued','running'].includes(job.status)){await new Promise(resolve=>setTimeout(resolve,1000));signal.throwIfAborted();if(account!==who())throw Error('Account changed');job=await request('GET','/discussion-runs/'+job.id);signal.throwIfAborted();activeJob=job;onUpdate(job);}
   activeJob=null;render();return job;
  }finally{signal.removeEventListener('abort',stop);}
 }
 function init(){if(localStorage.getItem('tools_role')!=='admin')return;const bar=document.querySelector('#dcComposer .dc-composer-bar');if(!bar)return;identity=who();root=document.createElement('span');root.className='dc-agent-group';root.innerHTML='<button type="button" data-tac-start aria-pressed="false">DragonTAC</button><small></small><button type="button" data-tac-resume hidden></button>';bar.prepend(root);
  const actions=document.querySelector('.dc-chat-actions');if(actions){headerButton=document.createElement('button');headerButton.type='button';headerButton.className='dc-ghost-btn dc-tac-entry';headerButton.addEventListener('click',startGroup);actions.prepend(headerButton);}
  root.querySelector('[data-tac-start]').addEventListener('click',startGroup);root.querySelector('[data-tac-resume]').addEventListener('click',()=>{if(activeJob)window.dispatchEvent(new CustomEvent('home:resume-agent-discussion',{detail:activeJob}));});render();
  window.addEventListener('tools:languagechange',render);window.addEventListener('storage',()=>{if(identity!==who()){identity=who();activateSession(null);}});
 }
 window.HomeAgentDiscussion={handles,validate,run,format,activateSession,isAgentMention:id=>enabled&&['codex','claude','claudecode','antigravity','dragontac','tac'].includes(id.toLowerCase())};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
