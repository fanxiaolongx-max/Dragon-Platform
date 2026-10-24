/* Shared visual and explicit startup tasks; never estimates network progress by time. */
(function(){
 'use strict';
 function feather(screen){

 const body='M45 157 C3 128 14 58 62 35 C85 24 117 12 146 13 C155 44 142 83 114 112 C95 133 72 146 45 157Z';
 const barbs=Array.from({length:36},(_,i)=>{const f=i/35,x=46+99*f,y=153-139*f,w=Math.sin(Math.PI*f)*40,j=Math.sin(i*1.7)*2;return `<path d="M${x} ${y} Q${x-w*.6} ${y-7} ${x-w} ${y-24+j} M${x} ${y} Q${x+w*.55} ${y+2} ${x+w*.78} ${y+16+j}"/>`;}).join('');
 screen.querySelector('[data-startup-feather]').innerHTML=`<svg viewBox="0 0 180 205" aria-hidden="true"><defs><linearGradient id="bootFeather" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".48" stop-color="#ecf3f8"/><stop offset="1" stop-color="#9db5c9"/></linearGradient><linearGradient id="bootQuill"><stop stop-color="#d8c6a1"/><stop offset="1" stop-color="#fffdf5"/></linearGradient><clipPath id="bootFeatherClip"><path d="${body}"/></clipPath></defs><path d="${body}" fill="url(#bootFeather)" stroke="#a9bccb" stroke-width=".65"/><g clip-path="url(#bootFeatherClip)" stroke="#708da5" stroke-opacity=".42" stroke-width=".55" fill="none">${barbs}</g><path d="M29 189 Q76 91 146 13" fill="none" stroke="url(#bootQuill)" stroke-width="2.3" stroke-linecap="round"/><path d="M46 156 Q93 120 121 95" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".7"/></svg>`;
 }
 const pages={
  uivf12:{title:['数据抓取','Data capture'],tasks:[['repository','加载脚本仓库','Load script repository']]},
  sla:{title:['数据导入','Data import'],tasks:[['meta','读取数据来源','Read data sources'],['rules','加载指标规则','Load metric rules'],['targets','加载预警目标','Load warning targets'],['categories','加载业务分类','Load categories'],['workspace','恢复数据工作区','Restore workspace']]},
  report:{title:['报表看板','Reports'],tasks:[['data','加载快照与报表配置','Load snapshots and report settings']]},
  monthly:{title:['AI 月报','AI report'],tasks:[['list','读取月报列表','Load report list'],['report','打开月报与格子内容','Open the report and its cells']]},
  expedite:{title:['一键催办','Reminders'],tasks:[['data','加载快照与催办数据','Load snapshot and reminder data'],['policy','加载分发策略','Load distribution policy'],['categories','加载业务分类','Load categories']]},
  bigscreen:{title:['大屏看板','Dashboard'],tasks:[['title','加载看板标题','Load dashboard title'],['contact','加载联系信息','Load contact information'],['data','加载趋势与指标','Load trends and metrics']]}
 };
 function create(page){
  const config=pages[page];if(!config)return;
  const screen=document.createElement('section');screen.id='platformStartup';screen.className='startup-screen';screen.setAttribute('aria-labelledby','platformStartupTitle');
  screen.innerHTML='<div class="startup-card"><div class="startup-art" aria-hidden="true"><div class="startup-halo"></div><div class="startup-feather" data-startup-feather></div></div><p class="startup-eyebrow">TOOLS PLATFORM</p><h2 id="platformStartupTitle"></h2><p class="startup-message" role="status" aria-live="polite"></p><div class="startup-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div><div class="startup-progress-label"><span></span><strong>0%</strong></div><details class="startup-details"><summary></summary><ul></ul></details><div class="startup-actions"><button type="button" data-startup-continue></button><button type="button" data-startup-retry hidden></button></div></div>';
  document.body.classList.add('platform-booting');document.body.prepend(screen);feather(screen);
  const tasks=new Map([...config.tasks,['render','整理页面与字体','Prepare layout and fonts']].map(([key,zh,en])=>[key,{zh,en,state:'waiting',error:''}]));
  const tr=(zh,en)=>window.ToolsI18n?.getLanguage()==='en-US'?en:zh;
  let closed=false,finishing=false,slow=false,fatal='',bar=null;const started=performance.now();
  const resize=new ResizeObserver(position),mutation=new MutationObserver(position);
  function position(){if(closed)return;const nav=document.getElementById('app-navbar');if(nav&&nav!==bar){bar=nav;resize.observe(nav);}screen.style.setProperty('--startup-top',Math.max(0,nav?.getBoundingClientRect().bottom||parseFloat(getComputedStyle(document.body).getPropertyValue('--navbar-h'))||60)+'px');}
  function paint(){
   if(closed)return;const settled=[...tasks.values()].filter(task=>['ready','error'].includes(task.state)).length,percent=Math.floor(settled/tasks.size*100);
   screen.style.setProperty('--startup-progress',percent+'%');screen.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(percent));screen.querySelector('[role=progressbar]').setAttribute('aria-label',tr('页面加载进度（按步骤）','Page loading progress (by step)'));
   screen.querySelector('.startup-progress-label span').textContent=tr(`${settled} / ${tasks.size} 个步骤`,`${settled} / ${tasks.size} steps`);screen.querySelector('.startup-progress-label strong').textContent=percent+'%';
   screen.querySelector('h2').textContent=fatal?tr('页面加载未完成','Page loading is incomplete'):tr('正在准备'+config.title[0],'Preparing '+config.title[1]);
   const loading=[...tasks.values()].find(task=>task.state==='loading');screen.querySelector('.startup-message').textContent=fatal|| (loading?tr(loading.zh,loading.en)+'…':tr('连接服务器，准备页面…','Connecting to the server and preparing the page…'));
   screen.querySelector('summary').textContent=tr('加载详情','Loading details');screen.querySelector('[data-startup-continue]').textContent=tr(fatal?'进入页面':'停止等待',fatal?'Open page':'Stop waiting');screen.querySelector('[data-startup-retry]').textContent=tr('重新加载','Reload');
   screen.querySelector('ul').replaceChildren(...[...tasks.values()].map(task=>{const li=document.createElement('li'),label=document.createElement('span'),state=document.createElement('small');li.dataset.state=task.state;label.textContent=tr(task.zh,task.en);state.textContent=task.state==='ready'?tr('完成','Ready'):task.state==='error'?tr('未能加载','Unavailable'):task.state==='loading'?tr('正在加载','Loading'):tr('等待','Waiting');li.title=task.error;li.append(label,state);return li;}));
  }
  function step(key,state='ready'){if(closed)return;const task=tasks.get(key);if(!task||task.state==='error')return;task.state=state;paint();}
  function issue(key,error){if(closed)return;const task=tasks.get(key);if(task){task.state='error';task.error=String(error?.message||error||tr('请求未完成','Request incomplete'));}paint();}
  async function run(key,work){step(key,'loading');try{const result=await work();step(key);return result;}catch(error){issue(key,error);throw error;}}
  function dismiss(){if(closed)return;closed=true;clearTimeout(watchdog);resize.disconnect();mutation.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position);window.removeEventListener('tools:languagechange',paint);document.body.classList.remove('platform-booting');screen.inert=true;screen.setAttribute('aria-hidden','true');screen.classList.add('startup-leaving');setTimeout(()=>screen.remove(),matchMedia('(prefers-reduced-motion: reduce)').matches?0:300);}
  function fail(error){if(closed)return;fatal=String(error?.message||error||tr('请查看加载详情或重试。','Check loading details or retry.'));screen.dataset.state='error';screen.querySelector('[data-startup-retry]').hidden=false;screen.querySelector('details').open=true;paint();}
  async function finish(){
   if(closed||finishing)return;finishing=true;
   try{await run('render',async()=>{await document.fonts?.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
    const failed=[...tasks.values()].find(task=>task.state==='error');if(failed||fatal&&!slow){fail(fatal||failed.error);return;}fatal='';
    // Briefly retain the completed surface for a smooth reveal on very fast local loads.
    const remaining=Math.max(0,350-(performance.now()-started));setTimeout(dismiss,remaining);
   }catch(error){fail(error);}
  }
  const watchdog=setTimeout(()=>{slow=true;fail(tr('加载时间较长。可查看加载详情、继续等待，或进入页面。','Loading is taking longer. Check the details, keep waiting, or open the page.'));},30000);
  screen.querySelector('[data-startup-continue]').onclick=dismiss;screen.querySelector('[data-startup-retry]').onclick=()=>location.reload();
  window.addEventListener('resize',position);window.addEventListener('scroll',position,{passive:true});window.addEventListener('tools:languagechange',paint);mutation.observe(document.body,{childList:true});position();paint();
  window.addEventListener('error',event=>{if(closed)return;const src=event.target?.src||event.filename||'';if(src.includes('/js/')&&!src.includes('/js/shared/navbar'))fail(tr('页面脚本未能启动，请重新加载。','A page script could not start. Reload the page.'));},{capture:true});
  return {run,step,issue,finish,fail,dismiss};
 }
 window.ToolsStartup={feather,create};const page=document.currentScript?.dataset.startupPage;if(page)window.ToolsPageStartup=create(page);
})();
