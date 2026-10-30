(function(){
 'use strict';
 const API='/api/desktop-agents';let enabled=false,locked=false,modeSaving=false,root,epoch=0,currentSessionId=null,activeJob=null,tracking=null,identity='',availabilityRevision=0,availabilityRequest=null;
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
  if(!root)return;const button=root.querySelector('[data-tac-start]');button.textContent=enabled?'DragonTAC · '+L('讨论组','Agent group'):'DragonTAC';button.setAttribute('aria-pressed',String(enabled));button.disabled=!availability.available||locked||modeSaving;button.dataset.available=String(availability.available);
  button.title=!availability.available?unavailableReason():locked?L('此对话已固定为 DragonTAC 讨论组；请新建对话使用普通模式','This conversation is locked to DragonTAC. Start a new chat for ordinary mode'):modeSaving?L('正在保存讨论组模式…','Saving agent group mode…'):enabled?L('取消讨论组模式，保留当前草稿','Turn off the agent group and keep your draft'):L('开启桌面 Agent 讨论组','Turn on the desktop agent group');
  button.setAttribute('aria-label',button.title);
  const hint=root.querySelector('small');hint.textContent=enabled&&availability.available?(locked?L('本对话固定为讨论组','Agent group for this conversation'):L('发送前可取消 · 首次发送新建桌面对话','Turn off before sending · new desktop chats on first send')):'';
  const following=tracking?.revision===epoch&&tracking.account===who();
  const resume=root.querySelector('[data-tac-resume]');resume.hidden=following||!activeJob||!['queued','running'].includes(activeJob.status);resume.textContent=L('恢复查看进度','Resume viewing progress');resume.title=L('重新连接此轮讨论，查看最新进度和回复','Reconnect to this discussion to view the latest progress and replies');
 }
 function publishGroup(){window.dispatchEvent(new CustomEvent('home:agent-discussion-changed',{detail:{sessionId:currentSessionId,mode:'group'}}));}
 async function startGroup(){
  if(!availability.available||locked||modeSaving)return;
  epoch++; // A delayed history lookup must not undo an explicit toggle.
  if(enabled&&!window.DragonClaw?.isExternal?.()){enabled=false;render();document.getElementById('dcInput')?.focus();return;}
  const input=document.getElementById('dcInput'),draft=input?.value||'';
  if(window.DragonClaw?.isExternal?.())window.DragonClaw?.newChat?.();
  window.HomeWelinkThreads?.setSource?.('mine');window.HomeMode?.set?.('chat');enabled=true;render();
  if(input){input.value=draft;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
  const id=window.DragonClaw?.currentSessionId?.()||currentSessionId;
  if(id){const revision=epoch,account=who();modeSaving=true;render();try{
    await request('PUT','/discussions/'+encodeURIComponent(id),{mode:'group'});
    if(revision!==epoch||account!==who())return;currentSessionId=id;locked=true;publishGroup();
   }catch(error){if(revision===epoch&&account===who()){enabled=false;window.DragonClawText?.toast?.(error.message);}}
   finally{if(revision===epoch){modeSaving=false;render();}}
  }
 }
 async function activateSession(id,{group=false}={}){const revision=++epoch;currentSessionId=id;activeJob=null;enabled=Boolean(id&&group);locked=enabled;modeSaving=false;render();if(!id||!root)return;
  try{const data=await request('GET','/discussions/'+encodeURIComponent(id));if(revision!==epoch||identity!==who())return;enabled=group||(data.settings?.mode==='group'&&data.settings?.version===2);locked=enabled;activeJob=data.activeRun||null;render();}catch{/* Preserve a known group lock even when its metadata request fails. */}
 }
 function handles(){return !!root&&enabled;}
 function validate(text){if(modeSaving)throw Error(L('请等待讨论组模式保存完成','Wait for agent group mode to save'));if(!availability.available)throw Error(unavailableReason());if(activeJob&&['queued','running'].includes(activeJob.status))throw Error(L('讨论仍在进行，请点击「恢复查看进度」','The group is still working. Choose Resume viewing progress.'));if(!text.trim()||text.length>4000)throw Error(L('请输入问题，最多 4000 字','Enter a question of up to 4000 characters'));}
 function format(job){const states={pending:['等待加入','Waiting to join'],creating:['正在新建专用桌面对话…','Creating a fresh desktop conversation…'],sending:['正在发送…','Sending…'],waiting:['正在思考…','Thinking…'],unavailable:['暂不可用','Unavailable'],failed:['未完成','Failed'],unknown:['结果未确认，请检查原客户端','Unconfirmed; check the desktop client'],skipped:['已跳过','Skipped']};return(job.status==='cancelled'?L('已停止后续讨论，已提交的桌面任务可能仍在运行。\n\n','Further discussion stopped; submitted desktop work may still run.\n\n'):'')+(job.reports||[]).map(r=>`### ${r.agent}\n\n${r.status==='done'?r.text:L(...(states[r.status]||['已中断','Interrupted']))}${r.error?'\n\n'+r.error:''}`).join('\n\n');}
 const providerNames={codex:'Codex',claudecode:'Claude Code',antigravity:'Antigravity'},reportViews=new WeakMap();
 const providerOf=report=>report.provider||Object.keys(providerNames).find(id=>providerNames[id]===report.agent)||'';
 function decorateMessage(message,provider){
  if(!providerNames[provider])return;
  message.dataset.dcProvider=provider;message.classList.add('dc-provider-message');
  const avatar=message.querySelector('.dc-msg-avatar');if(avatar){avatar.src=`./tp-static/frontend/assets/desktop-agents/${provider}.png`;avatar.alt=providerNames[provider];}
 }
 function groupMessages(container){
  const rows=[...container.children].filter(node=>node.classList.contains('dc-msg'));
  rows.forEach((node,i)=>{const provider=node.dataset.dcProvider;if(!provider)return;
   node.classList.toggle('desktop-agent-cont',rows[i-1]?.dataset.dcProvider===provider);
   node.classList.toggle('is-continued',rows[i+1]?.dataset.dcProvider===provider);
  });
 }
 function renderReports(message,job,renderMarkdown){
  message.classList.add('dc-tac-message');const body=message.querySelector('.dc-msg-body');
  let view=reportViews.get(body);if(!view){body.replaceChildren();view={rows:[]};reportViews.set(body,view);}
  const reports=job.reports||[];
  reports.forEach((report,index)=>{const provider=providerOf(report),name=providerNames[provider]||report.agent||'DragonTAC';
   let row=view.rows[index];if(!row){const node=document.createElement('article');node.className='dc-tac-report';
    const avatar=document.createElement('img');avatar.className='dc-tac-report-avatar';
    const main=document.createElement('div'),heading=document.createElement('div'),content=document.createElement('div');heading.className='dc-tac-report-name';content.className='dc-tac-report-body';main.append(heading,content);node.append(avatar,main);body.append(node);row={node,avatar,heading,content,html:''};view.rows[index]=row;
   }
   row.node.dataset.provider=provider;row.avatar.src=providerNames[provider]?`./tp-static/frontend/assets/desktop-agents/${provider}.png`:'./tp-static/frontend/assets/dragon-claw-avatar.jpg';row.avatar.alt=name;row.heading.textContent=name;
   const continued=index>0&&provider&&providerOf(reports[index-1])===provider;row.node.classList.toggle('is-continuation',Boolean(continued));
   const markdown=format({reports:[report]}).replace(/^### [^\n]*\n\n/,'');const html=renderMarkdown(markdown);
   if(html!==row.html){row.content.innerHTML=html;row.html=html;}
  });
  while(view.rows.length>reports.length)view.rows.pop().node.remove();
 }
 async function run({text,sessionId,resumeJob,signal,onStarted,onUpdate}){
  const account=who(),revision=epoch;let job;
  const follower={account,revision};tracking=follower;render();
  const stop=()=>{if(job&&account===who())request('POST','/discussion-runs/'+job.id+'/cancel',{}).then(result=>{if(account===who()&&revision===epoch&&currentSessionId===result.sessionId&&activeJob?.id===result.id){activeJob=null;render();}}).catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try{
   if(!resumeJob){await refreshAvailability(true);if(account!==who())throw Error('Account changed');signal.throwIfAborted();if(revision!==epoch)throw new DOMException('Stopped','AbortError');if(!availability.available)throw Error(unavailableReason());}
   job=resumeJob?await request('GET','/discussion-runs/'+encodeURIComponent(resumeJob.id)):await request('POST','/discussion-runs',{text,sessionId,requestId:crypto.randomUUID()});
   if(account!==who())throw Error('Account changed');if(signal.aborted||revision!==epoch){stop();throw new DOMException('Stopped','AbortError');}
   currentSessionId=job.sessionId;enabled=true;locked=true;activeJob=job;publishGroup();onStarted(job);onUpdate(job);render();
   while(['queued','running'].includes(job.status)){await new Promise(resolve=>setTimeout(resolve,1000));signal.throwIfAborted();if(account!==who())throw Error('Account changed');if(revision!==epoch)throw new DOMException('Stopped','AbortError');job=await request('GET','/discussion-runs/'+job.id);signal.throwIfAborted();if(account!==who())throw Error('Account changed');if(revision!==epoch)throw new DOMException('Stopped','AbortError');activeJob=job;onUpdate(job);}
   activeJob=null;render();return job;
  }finally{signal.removeEventListener('abort',stop);if(tracking===follower){tracking=null;render();}}
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
 window.HomeAgentDiscussion={handles,validate,run,format,renderReports,decorateMessage,groupMessages,activateSession,isAgentMention:id=>enabled&&['codex','claude','claudecode','antigravity','dragontac','tac'].includes(id.toLowerCase())};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
