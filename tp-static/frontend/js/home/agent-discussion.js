(function(){
 'use strict';
 const API='/api/desktop-agents';
 // 桌面 Agent 成员表：新增桌面连接器只需加在这里；DragonTAC 默认全员即这里的全部成员
 const DESKTOP_AGENTS={codex:'Codex',claudecode:'Claude Code',antigravity:'Antigravity',workbuddy:'WorkBuddy'},DESKTOP_IDS=Object.keys(DESKTOP_AGENTS);
 let enabled=false,locked=false,modeSaving=false,root,epoch=0,currentSessionId=null,activeJob=null,tracking=null,identity='',availabilityRevision=0,availabilityRequest=null,weixinDisabled=false;
 let selectedModels={};
 let availability={available:false,reason:'checking'};
 const readiness=Object.fromEntries([...DESKTOP_IDS,'weixin','welink-cli','welink','netcare'].map(id=>[id,{ready:false,reason:'checking'}]));

 // 连接器勾选状态：桌面 Agent 可多选（1 个为单聊，2 个及以上为多 Agent 协同讨论）；
 // 微信、两类 WeLink 和 NetCare 各自为独立场景，与桌面 Agent 互斥。
 const connectors = {
   ...Object.fromEntries(DESKTOP_IDS.map(id => [id, false])),
   weixin: false,
   welink: false,
   'welink-cli': false,
   netcare: false
 };

 const TOOL_SKILLS={'welink-cli':'welink-office',netcare:'netcare-data'};
 const L=(zh,en)=>/^en/.test(window.ToolsI18n?.getLanguage?.()||localStorage.getItem('tools_lang')||'')?en:zh;
 const who=()=>['tools_user','tools_tenant_id','tools_token'].map(k=>localStorage.getItem(k)||sessionStorage.getItem(k)||'').join('|');
 async function request(method,url,body){
   const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');
   const r=await fetch(API+url,{method,cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const d=await r.json();
   if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);
   return d;
 }

 function unavailableReason(){
   return ({
     checking:L('正在检查桌面 Agent 连接…','Checking desktop agent connections…'),
     disabled:L('请先在全局设置中启用桌面 Agent','Enable Desktop Agents in global settings first'),
     readonly:L('请先在全局设置中允许网页发送消息','Allow Web replies in global settings first'),
     offline:L('没有可发送消息的桌面 Agent，请检查客户端和连接设置','No desktop agent can send messages. Check the clients and connection settings.'),
     error:L('无法确认桌面 Agent 连接，请检查全局设置','Could not verify desktop agents. Check global settings.')
   })[availability.reason]||availability.reason;
 }

 async function refreshAvailability(force=false){
  if(availabilityRequest&&!force)return availabilityRequest;
  const version=++availabilityRevision,account=who();
  const pending=(async()=>{
   const next=Object.fromEntries(Object.keys(connectors).filter(id=>!TOOL_SKILLS[id]).map(id=>[id,{ready:false,reason:'offline'}]));
   // CLI authentication can be slow. It must not delay desktop agents or SDK channels.
   const tools=Promise.allSettled(Object.keys(TOOL_SKILLS).map(async id=>{
    let status={ready:false,reason:'error'};
    try{
     const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');
     const response=await fetch('/api/ai/connector-status?id='+encodeURIComponent(id),{cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token}});
     if(!response.ok)throw Error('Connector unavailable');
     const data=await response.json(),item=(data.items||[]).find(item=>item.id===id);
     if(item)status={ready:item.ready===true,reason:item.reason||''};
    }catch{/* Disabled until its status can be verified. */}
    if(version===availabilityRevision&&account===who()){readiness[id]=status;render();}
   }));
   const [desktop,channels]=await Promise.allSettled([
    (async()=>{const data=await request('GET','/settings');return {data,sessions:data.owned&&data.settings?.enabled?await request('GET','/sessions'):{providers:[]}};})(),
    (async()=>{const token=localStorage.getItem('tools_token')||sessionStorage.getItem('tools_token');const response=await fetch('/api/channels/available',{cache:'no-store',credentials:'same-origin',headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('Channels unavailable');return response.json();})()
   ]);
   if(desktop.status==='fulfilled'){
    const {data,sessions}=desktop.value,cfg=data.settings;
    for(const id of DESKTOP_IDS){
     const p=(sessions.providers||[]).find(item=>item.id===id);
     const reason=!data.owned||!cfg?.enabled||!cfg.providers?.[id]?'disabled':!cfg.allowSend||id==='claudecode'&&!cfg.claudeAutomation?'readonly':!p?.enabled||!p.connected?'offline':!p.canSend?'readonly':'';
     next[id]={ready:!reason,reason,detail:p?.reason||''};
    }
   }else for(const id of DESKTOP_IDS)next[id]={ready:false,reason:'error'};
   if(channels.status==='fulfilled'){
    weixinDisabled=Boolean(channels.value?.network?.weixinDisabled||channels.value?.summary?.weixin?.disabledByIntranet);
    for(const id of ['weixin','welink']){
     const channel=(channels.value.items||[]).find(item=>item.id===id);
     const ready=(id==='weixin'&&weixinDisabled)?false:(channel?.connected===true&&channel.health?.reason!=='readonly'&&channel.health?.reason!=='disabled');
     next[id]={ready,reason:(id==='weixin'&&weixinDisabled)?'disabled':(ready?'':'offline')};
    }
    if(weixinDisabled)connectors.weixin=false;
   }
   if(version===availabilityRevision&&account===who()){
    Object.assign(readiness,next);
    availability={available:DESKTOP_IDS.some(id=>next[id].ready),reason:'offline'};
    render();
   }
   await tools;
  })();
  availabilityRequest=pending;
  try{await pending;}finally{if(availabilityRequest===pending)availabilityRequest=null;}
 }

 function getSelectedAgents(){
   return DESKTOP_IDS.filter(k => connectors[k]);
 }

 function getSelectedConnector(){
   if(connectors.weixin) return 'weixin';
   if(connectors.welink) return 'welink';
   for(const id of Object.keys(TOOL_SKILLS))if(connectors[id])return id;
   const agents = getSelectedAgents();
   if(agents.length === 1) return 'desktop:' + agents[0];
   if(agents.length > 1) return 'discussion';
   return 'none';
 }

 function setSelection(keys){
  for(const key of Object.keys(connectors))connectors[key]=keys.includes(key);
  enabled=getSelectedAgents().length>1;
 }
 function updateConnectors(key,checked){
  if(locked||modeSaving||!Object.hasOwn(connectors,key)||checked&&!readiness[key].ready){render();return;}
  if(checked&&['weixin','welink',...Object.keys(TOOL_SKILLS)].includes(key))setSelection([key]);
  else{
   if(checked)for(const id of ['weixin','welink',...Object.keys(TOOL_SKILLS)])connectors[id]=false;
   connectors[key]=checked;enabled=getSelectedAgents().length>1;
  }
  // Draft configuration only. Opening or creating a native session happens on Send.
  render();
 }
 function bindExternal(key){
  ++epoch;currentSessionId=null;activeJob=null;modeSaving=false;
  setSelection(Object.hasOwn(connectors,key)?[key]:[]);locked=true;render();
 }
 function lock(){locked=true;render();}
 function validateSelection(){
  if(locked)return;
  const unavailable=Object.keys(connectors).find(key=>connectors[key]&&!readiness[key].ready);
  if(unavailable)throw Error(connectorName(unavailable)+' · '+L('连接器尚未就绪，请检查连接或取消勾选','Connector is unavailable. Check its connection or deselect it.'));
 }

 const providerNames=DESKTOP_AGENTS;

 const connectorName=key=>providerNames[key]||({weixin:L('微信','WeChat'),welink:L('WeLink 助手','WeLink Assistant'),'welink-cli':L('WeLink 官方','WeLink Official'),netcare:L('数字人 NetCare','NetCare Digital Human')})[key]||key;

 const NETCARE_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 3v3M8 14h.01M16 14h.01M9 17h6" stroke-linecap="round"/></svg>';
 const WX_SVG = `<svg viewBox="0 0 24 24"><path d="M9.5 4C5.36 4 2 6.91 2 10.5c0 1.93.9 3.68 2.34 4.88-.13.62-.51 2.05-.62 2.45-.16.58.26.47.53.33.45-.24 2.1-1.39 2.53-1.68.73.22 1.48.32 2.22.32h.5c-.13-.42-.2-.86-.2-1.3 0-3.31 3.13-6 7-6 .17 0 .33 0 .5.02C16.14 6.27 13.06 4 9.5 4zm-2.25 4a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5zm3.75 3.5c-3.31 0-6 2.24-6 5s2.69 5 6 5c.61 0 1.22-.08 1.8-.25.35.24 1.7 1.17 2.07 1.36.22.11.56.2.43-.27-.09-.33-.4-1.48-.5-1.98 1.18-.97 1.9-2.39 1.9-3.86 0-2.76-2.69-5-6-5zm-1.75 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm3.75 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>`;
 const WL_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93V19h-2v-2.07c-2.83-.48-5-2.94-5-5.93 0-3.31 2.69-6 6-6s6 2.69 6 6c0 2.99-2.17 5.45-5 5.93zM12 8c-2.21 0-4 1.79-4 4 0 1.86 1.28 3.41 3 3.86V8.14C11.67 8.05 11.83 8 12 8zm1 7.86c1.72-.45 3-2 3-3.86 0-2.21-1.79-4-4-4-.17 0-.33.05-.5.09v7.72c.17.03.33.05.5.05z"/></svg>`;
 const CONNECTOR_ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="6" cy="6" r="3"/><circle cx="14" cy="6" r="3"/><circle cx="10" cy="14" r="3"/><path d="M8.5 7.5l-1 4m5-4l1 4M9 6h2"/></svg>`;

 function renderAvatars(){
   const agents = getSelectedAgents();
   const avatarsEl = root?.querySelector('.dc-connector-avatars');
   if(!avatarsEl) return;

   if(connectors.weixin){
     avatarsEl.innerHTML = `<span class="dc-connector-avatar-stack"><span class="dc-connector-circle dc-circle-wx">${WX_SVG}</span></span>`;
   } else if(connectors.netcare){
     avatarsEl.innerHTML = `<span class="dc-connector-avatar-stack"><span class="dc-connector-circle dc-circle-netcare">${NETCARE_SVG}</span></span>`;
   } else if(connectors.welink||connectors['welink-cli']){
     avatarsEl.innerHTML = `<span class="dc-connector-avatar-stack"><span class="dc-connector-circle dc-circle-wl">${WL_SVG}</span></span>`;
   } else if(agents.length > 0){
     avatarsEl.innerHTML = `<span class="dc-connector-avatar-stack">${agents.map(a => `<img src="./tp-static/frontend/assets/desktop-agents/${a}.png" class="dc-connector-circle" alt="${providerNames[a]||a}">`).join('')}</span>`;
   } else {
     avatarsEl.innerHTML = `<span class="dc-connector-circle dc-circle-default">${CONNECTOR_ICON}</span>`;
   }
 }

 function connectorReason(key){
  const reason=readiness[key].reason;
  return ({tenant:L('仅默认工作区管理员可使用本人 WeLink','Personal WeLink is available to administrators only'),forbidden:L('仅管理员可使用此连接器','Only admins can use this connector'),'not-installed':L('请先安装 WeLink CLI','Install WeLink CLI first'),login:L('请先在设置中登录本人 WeLink','Sign in to your personal WeLink account in settings'),unconfigured:L('请先完成数字人基座配置','Configure the digital human base first'),untested:L('请先在设置中测试连接并通过','Run a successful connection test in settings first'),checking:L('正在检查连接…','Checking connection…'),disabled:L('尚未启用，请检查连接器设置','Not enabled. Check connector settings.'),readonly:L('未获得发送权限，请检查连接器设置','Sending is not permitted. Check connector settings.'),offline:L('连接尚未就绪，请检查客户端和网络','Not connected. Check the client and network.'),error:L('无法确认连接状态，请重试','Could not verify the connection. Try again.')})[reason]||L('连接器未就绪','Connector is unavailable');
 }

 function render(){
  queueMicrotask(()=>window.DragonClaw?.refreshModelPicker?.());
  if(!root)return;
  renderAvatars();

  const button=root.querySelector('[data-tac-start]');
  if(!button) return;
  button.disabled = false;
  button.dataset.available = String(availability.available);
  button.setAttribute('aria-pressed', String(enabled));
  button.title = locked ? L('此对话已绑定连接器；新建对话后可重新选择','Connectors are fixed for this conversation. Start a new chat to change them.') : L('选择下一段新对话使用的智能体或渠道','Choose agents or a channel for your new conversation');
  button.setAttribute('aria-label', button.title);

  const label=root.querySelector('.dc-connector-label');
  const agents=getSelectedAgents();

  if(connectors.weixin) label.textContent = L('微信','WeChat');
  else if(connectors.welink||connectors['welink-cli']||connectors.netcare) label.textContent = connectorName(getSelectedConnector());
  else if(agents.length === 1) label.textContent = providerNames[agents[0]] || agents[0];
  else if(enabled || agents.length > 1) label.textContent = L('连接器 · 讨论组','Connectors · Agent group');
  else label.textContent = L('连接器','Connectors');

  // 更新 popover 里的开关状态
  const popover = root.querySelector('.dc-connector-popover');
  if(popover){
    Object.keys(connectors).forEach(key => {
      const input = popover.querySelector(`input[data-connector="${key}"]`);
      if(input){
        input.setAttribute('aria-label',connectorName(key));
        const name=input.closest('.dc-connector-item').querySelector('.dc-connector-item-name');
        name.textContent=connectorName(key);
        const detail=input.closest('.dc-connector-item').querySelector('[data-connector-description]');
        if(detail)detail.textContent=key==='welink-cli'?L('本人账号 · 消息、会议与邮件','Personal account · messages, meetings and mail'):key==='welink'?L('智能助手 · 渠道会话','Assistant · channel conversations'):L('数字人基座 · NetCare 只读查询','Digital human base · read-only NetCare data');
        input.checked=Boolean(connectors[key]);input.disabled=locked||modeSaving||(!readiness[key].ready&&!connectors[key]);
        const row=input.closest('.dc-connector-item');
        row.classList.toggle('is-unavailable',!readiness[key].ready&&!locked);
        row.title=locked?L('对话已开始，连接器不可修改','Conversation started; connectors cannot be changed'):readiness[key].ready?L('已就绪','Ready'):connectorReason(key);
      }
    });
  }

  const note=root.querySelector('[data-connector-note]');
  if(note)note.textContent=locked?L('本对话已绑定连接器；新建对话可重新选择','Bound to this conversation. Start a new chat to change connectors.'):L('仅预选新对话 · 发送后固定','Choose for your new chat · fixed after sending');
  const hint=root.querySelector('[data-tac-hint]');
  if(hint){
    hint.textContent=enabled&&availability.available?(locked?L('本对话固定为讨论组','Agent group for this conversation'):L('发送前可取消 · 首次发送新建桌面对话','Turn off before sending · new desktop chats on first send')):'';
  }

  const resume=root.querySelector('[data-tac-resume]');
  if(resume){
    const following=tracking?.revision===epoch&&tracking.account===who();
    resume.hidden=following||!activeJob||!['queued','running'].includes(activeJob.status);
    resume.textContent=L('恢复查看进度','Resume viewing progress');
    resume.title=L('重新连接此轮讨论，查看最新进度和回复','Reconnect to this discussion to view the latest progress and replies');
  }
  positionPopover();
 }

 function positionPopover(){
   const popover=root?.querySelector('.dc-connector-popover');
   if(!popover||popover.hidden)return;
   const button=root.querySelector('.dc-connector-btn').getBoundingClientRect();
   const parent=popover.offsetParent;
   if(!parent)return;
   const origin=parent.getBoundingClientRect(),pad=12;
   const above=button.top-pad-8,below=innerHeight-button.bottom-pad-8;
   const down=popover.offsetHeight>above&&below>above;
   popover.dataset.placement=down?'below':'above';
   const x=Math.max(pad,Math.min(button.left,innerWidth-popover.offsetWidth-pad));
   const y=Math.max(pad,Math.min(down?button.bottom+8:button.top-popover.offsetHeight-8,innerHeight-popover.offsetHeight-pad));
   popover.style.bottom='auto';
   popover.style.left=(x-origin.left-parent.clientLeft+parent.scrollLeft)+'px';
   popover.style.top=(y-origin.top-parent.clientTop+parent.scrollTop)+'px';
 }

 function togglePopover(force){
   const popover = root.querySelector('.dc-connector-popover');
   if(!popover) return;
   const btn = root.querySelector('.dc-connector-btn');
   const show = typeof force === 'boolean' ? force : popover.hidden;
   popover.hidden = !show;
   btn.setAttribute('aria-expanded', String(show));
   if(show){
    window.HomeComposer?.close?.();window.DragonClawSkills?.closeSuggestions?.();
    document.querySelectorAll('#dcWorkspaceChip details[open]').forEach(node=>node.open=false);
    positionPopover();refreshAvailability(true);
   }
 }

 function publishGroup(){
   window.dispatchEvent(new CustomEvent('home:agent-discussion-changed',{detail:{sessionId:currentSessionId,mode:'group'}}));
 }

 async function activateSession(id,{group=false,connector=''}={}){
  const revision=++epoch,account=who();
  currentSessionId=id;activeJob=null;selectedModels={};setSelection(id&&TOOL_SKILLS[connector]?[connector]:[]);enabled=Boolean(id&&group);
  locked=Boolean(id);modeSaving=false;render();
  if(!id||!root||TOOL_SKILLS[connector]&&!group)return;
  try{
   const data=await request('GET','/discussions/'+encodeURIComponent(id));
   if(revision!==epoch||account!==who())return;
   enabled=group||(data.settings?.mode==='group'&&data.settings?.version===2);
   activeJob=data.activeRun||null;selectedModels=data.settings?.models||{};
   if(enabled){
    const providers=data.settings?.providers||activeJob?.settings?.providers||activeJob?.reports?.map(r=>r.provider||Object.keys(providerNames).find(key=>providerNames[key]===r.agent))||Object.keys(data.settings?.bindings||{});
    setSelection(providers);enabled=true;
   }
   render();
  }catch{/* An unavailable metadata endpoint never unlocks established conversations. */}
 }

 function handles(){
   return Boolean(root && enabled);
 }

 function validate(text){
  if(modeSaving)throw Error(L('请等待连接器模式保存完成','Wait for connector mode to save'));
  validateSelection();
  window.HomeDesktopModels?.validate?.();
  if(enabled&&!getSelectedAgents().length)throw Error(L('无法确认本对话绑定的连接器，请重新打开历史对话','Could not confirm the bound connectors. Reopen this conversation.'));
  const unavailable=getSelectedAgents().find(id=>!readiness[id].ready);
  if(unavailable)throw Error(providerNames[unavailable]+' · '+L('连接器未就绪，请检查连接设置','Connector is unavailable. Check connection settings.'));
  if(!availability.available)throw Error(unavailableReason());
  if(activeJob&&['queued','running'].includes(activeJob.status))throw Error(L('讨论仍在进行，请点击「恢复查看进度」','The discussion is still running. Choose Resume viewing progress.'));
  if(!text.trim()||text.length>4000)throw Error(L('请输入问题，最多 4000 字','Enter a question of up to 4000 characters'));
 }

 function format(job){
  const states={pending:['等待加入','Waiting to join'],creating:['正在新建专用桌面对话…','Creating a fresh desktop conversation…'],sending:['正在发送…','Sending…'],waiting:['正在思考…','Thinking…'],unavailable:['暂不可用','Unavailable'],failed:['未完成','Failed'],unknown:['结果未确认，请检查原客户端','Unconfirmed; check the desktop client'],skipped:['已跳过','Skipped']};
  return(job.status==='cancelled'?L('已停止后续讨论，已提交的桌面任务可能仍在运行。\n\n','Further discussion stopped; submitted desktop work may still run.\n\n'):'')+(job.reports||[]).map(r=>`### ${r.agent}\n\n${r.status==='done'?r.text:L(...(states[r.status]||['已中断','Interrupted']))}${r.error?'\n\n'+r.error:''}`).join('\n\n');
 }

 const reportViews=new WeakMap();
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
  reports.forEach((report,index)=>{
   const provider=providerOf(report),name=providerNames[provider]||report.agent||L('连接器','Connector');
   let row=view.rows[index];
   if(!row){
     const node=document.createElement('article');node.className='dc-tac-report';
     const avatar=document.createElement('img');avatar.className='dc-tac-report-avatar';
     const main=document.createElement('div'),heading=document.createElement('div'),content=document.createElement('div');
     heading.className='dc-tac-report-name';content.className='dc-tac-report-body';
     main.append(heading,content);node.append(avatar,main);body.append(node);
     row={node,avatar,heading,content,html:''};view.rows[index]=row;
   }
   row.node.dataset.provider=provider;
   row.avatar.src=providerNames[provider]?`./tp-static/frontend/assets/desktop-agents/${provider}.png`:'./tp-static/frontend/assets/logo.png';
   row.avatar.alt=name;
   row.heading.textContent=name;
   const continued=index>0&&provider&&providerOf(reports[index-1])===provider;
   row.node.classList.toggle('is-continuation',Boolean(continued));
   const markdown=format({reports:[report]}).replace(/^### [^\n]*\n\n/,'');
   const html=renderMarkdown(markdown);
   if(html!==row.html){row.content.innerHTML=html;row.html=html;}
  });
  while(view.rows.length>reports.length)view.rows.pop().node.remove();
 }

 async function run({text,sessionId,resumeJob,signal,onStarted,onUpdate}){
  const account=who(),revision=epoch;
  let job;
  const follower={account,revision};tracking=follower;render();
  const stop=()=>{if(job&&account===who())request('POST','/discussion-runs/'+job.id+'/cancel',{}).then(result=>{if(account===who()&&revision===epoch&&currentSessionId===result.sessionId&&activeJob?.id===result.id){activeJob=null;render();}}).catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try{
   if(!resumeJob){
     await refreshAvailability(true);
     if(account!==who())throw Error('Account changed');
     signal.throwIfAborted();
     if(revision!==epoch)throw new DOMException('Stopped','AbortError');
     const unavailable=getSelectedAgents().find(id=>!readiness[id].ready);
     if(unavailable)throw Error(providerNames[unavailable]+' · '+L('连接器未就绪','Connector is unavailable'));
     locked=true;render();
   }
   const selectedAgents = getSelectedAgents();
   const providers = selectedAgents;
   if(!resumeJob&&!providers.length)throw Error(L('请先选择已就绪的连接器','Select an available connector first'));
   job=resumeJob?await request('GET','/discussion-runs/'+encodeURIComponent(resumeJob.id)):await request('POST','/discussion-runs',{text,sessionId,providers,models:window.HomeDesktopModels?.values?.()||{},requestId:crypto.randomUUID()});
   if(account!==who())throw Error('Account changed');if(signal.aborted||revision!==epoch){stop();throw new DOMException('Stopped','AbortError');}
   currentSessionId=job.sessionId;selectedModels=job.settings?.models||selectedModels;enabled=true;locked=true;activeJob=job;publishGroup();onStarted(job);onUpdate(job);render();
   while(['queued','running'].includes(job.status)){
     await new Promise(resolve=>setTimeout(resolve,1000));
     signal.throwIfAborted();
     if(account!==who())throw Error('Account changed');
     if(revision!==epoch)throw new DOMException('Stopped','AbortError');
     job=await request('GET','/discussion-runs/'+job.id);
     signal.throwIfAborted();
     if(account!==who())throw Error('Account changed');
     if(revision!==epoch)throw new DOMException('Stopped','AbortError');
     activeJob=job;onUpdate(job);
   }
   activeJob=null;render();return job;
  }finally{
    signal.removeEventListener('abort',stop);
    if(tracking===follower){tracking=null;render();}
  }
 }

 function buildMarkup(){
   return `
     <button type="button" class="dc-connector-btn" data-tac-start aria-haspopup="true" aria-expanded="false">
       <span class="dc-connector-avatars"></span>
       <span class="dc-connector-label">${L('连接器','Connectors')}</span>
     </button>
     <button type="button" data-tac-resume hidden></button>
     <div class="dc-connector-popover" role="dialog" hidden>
       <div class="dc-connector-list">
${DESKTOP_IDS.map(id=>`         <div class="dc-connector-item" data-key="${id}">
           <div class="dc-connector-item-main">
             <img src="./tp-static/frontend/assets/desktop-agents/${id}.png" class="dc-connector-item-ico" alt="${DESKTOP_AGENTS[id]}">
             <span class="dc-connector-item-name">${DESKTOP_AGENTS[id]}</span>
           </div>
           <label class="dc-switch">
             <input type="checkbox" data-connector="${id}">
             <span class="dc-switch-track"><span class="dc-switch-thumb"></span></span>
           </label>
         </div>`).join('\n')}
         ${weixinDisabled ? '' : `<div class="dc-connector-item" data-key="weixin">
           <div class="dc-connector-item-main">
             <span class="dc-connector-item-ico dc-circle-wx">${WX_SVG}</span>
             <span class="dc-connector-item-name">${L('微信','WeChat')}</span>
           </div>
           <label class="dc-switch">
             <input type="checkbox" data-connector="weixin">
             <span class="dc-switch-track"><span class="dc-switch-thumb"></span></span>
           </label>
         </div>`}
         ${['welink-cli','welink','netcare'].map(key=>`<div class="dc-connector-item" data-key="${key}">
           <div class="dc-connector-item-main">
             <span class="dc-connector-item-ico ${key==='netcare'?'dc-circle-netcare':'dc-circle-wl'}">${key==='netcare'?NETCARE_SVG:WL_SVG}</span>
             <span class="dc-connector-item-copy"><span class="dc-connector-item-name">${connectorName(key)}</span><small data-connector-description></small></span>
           </div>
           <label class="dc-switch"><input type="checkbox" data-connector="${key}"><span class="dc-switch-track"><span class="dc-switch-thumb"></span></span></label>
         </div>`).join('')}
       </div>
       <div class="dc-connector-note" data-connector-note></div>
       <div class="dc-connector-divider"></div>
       <button type="button" class="dc-connector-manage">
         <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4h4v4M16 4l-7 7M14 11v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/></svg>
         <span>${L('管理连接器','Manage connectors')}</span>
       </button>
     </div>
   `;
 }

 function init(){
  if(localStorage.getItem('tools_role')!=='admin')return;
  const bar=document.querySelector('#dcComposer .dc-composer-bar');if(!bar)return;
  identity=who();
  root=document.createElement('span');
  root.className='dc-connector-control dc-agent-group';
  root.innerHTML=buildMarkup();
  bar.prepend(root);

  const btn = root.querySelector('.dc-connector-btn');
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    togglePopover();
  });

  const popover = root.querySelector('.dc-connector-popover');
  popover.addEventListener('click', (e)=>{
    e.stopPropagation();
    if(e.target.closest('.dc-connector-manage')){
      togglePopover(false);
      window.openNavSettingsModal?.();
      window.switchNavSettingsTab?.('desktopAgents');
    }
  });

  popover.addEventListener('change', (e)=>{
    const input = e.target.closest('input[data-connector]');
    if(input){
      updateConnectors(input.dataset.connector, input.checked);
    }
  });

  document.addEventListener('pointerdown', (e)=>{
    if(root && !root.contains(e.target)){
      togglePopover(false);
    }
  });

  root.querySelector('[data-tac-resume]')?.addEventListener('click',()=>{
    if(activeJob)window.dispatchEvent(new CustomEvent('home:resume-agent-discussion',{detail:activeJob}));
  });

  render();
  refreshAvailability();

  window.addEventListener('tools:desktop-agent-settings-changed',()=>{
    availability={available:false,reason:'checking'};
    for(const key of Object.keys(readiness))readiness[key]={ready:false,reason:'checking'};
    render();
    refreshAvailability(true);
  });
  window.addEventListener('tools:languagechange',render);
  window.addEventListener('storage',()=>{
    if(identity!==who()){
      identity=who();
      availability={available:false,reason:'checking'};
      for(const key of Object.keys(readiness))readiness[key]={ready:false,reason:'checking'};
      activateSession(null);
      refreshAvailability(true);
    }
  });
  const timer=setInterval(()=>{if(document.visibilityState==='visible')refreshAvailability();},30000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshAvailability(true);});
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
  window.addEventListener('resize',positionPopover);
  document.addEventListener('scroll',positionPopover,true);
 }

 window.HomeAgentDiscussion={
   modelContext:()=>{const providers=getSelectedAgents();return providers.length?{key:currentSessionId?'group:'+currentSessionId:'draft',providers,models:currentSessionId?selectedModels:undefined,save:currentSessionId?async values=>{const id=currentSessionId;const data=await request('PUT','/discussions/'+encodeURIComponent(id),{models:values});if(currentSessionId===id)selectedModels=data.settings?.models||values;}:null}:null;},
   handles,
   validate,
   run,
   format,
   renderReports,
   decorateMessage,
   groupMessages,
   activateSession,
   bindExternal,
   lock,
   validateSelection,
   refreshAvailability,
   isLocked:()=>locked,
   openPicker: () => togglePopover(true),
   closePicker: () => togglePopover(false),
   isPickerOpen: () => Boolean(root && !root.querySelector('.dc-connector-popover').hidden),
   getConnectors: () => ({ ...connectors }),
   getSelectedConnector,
   homeConnector:()=>Object.hasOwn(TOOL_SKILLS,getSelectedConnector())?getSelectedConnector():'',
   isAgentMention:id=>(enabled||getSelectedAgents().length>1)&&[...DESKTOP_IDS,'claude','connector','dragontac','tac'].includes(id.toLowerCase())
 };

 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
