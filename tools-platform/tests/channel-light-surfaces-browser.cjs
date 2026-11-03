// node_modules/.bin/electron --disable-gpu tests/channel-light-surfaces-browser.cjs
// Real shared styles and license script; isolated HTTP fixtures, no business data writes.
const {app,BrowserWindow,nativeTheme}=require('electron');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'channel-light-surfaces-'));app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server,license='active';
const evaluate=code=>win.webContents.executeJavaScript(code);
const until=async code=>{for(let i=0;i<120;i++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,25))}throw Error('Timed out: '+code)};
const statuses=['open','paused','done','cancelled'];
const mark=(s)=>`<span class="wl-status is-${s}">${s}</span>`;
const fixture=`<!doctype html><html data-ui="v2"><head><meta charset="utf-8">
<link rel="stylesheet" href="/css/shared.css"><link rel="stylesheet" href="/css/dragon-claw.css"><link rel="stylesheet" href="/css/welink-threads.css"><link rel="stylesheet" href="/css/home-v2.css">
<style>body{margin:0!important;display:block!important;background:#fff;padding:24px!important;font:13px/1.6 system-ui;color:#202b38}.samples{max-width:1200px;margin:auto}.sample-columns{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:24px}.sample-panel{min-width:0}h1{font-size:20px}html[data-theme=dark] body{background:#101827;color:#e2e8f0}.wl-stage{margin-bottom:18px}.sample-actions{margin:12px 0}.wl-task{margin-bottom:10px}@media(max-width:700px){body{padding:12px!important}.sample-columns{grid-template-columns:minmax(0,1fr)}}</style></head>
<body><main class="samples"><h1>WeLink · 会话与跟进</h1>
<div class="wl-stage is-stage-1"><div class="wl-stage-info"><b class="wl-stage-title" data-check>上线评审与遗留跟进</b>${mark('open')}</div><div class="wl-track"><div class="wl-track-line"><div class="wl-track-fill" style="--wl-fill:50%"></div></div>${['开始','进行中','完成'].map((t,i)=>`<span class="wl-node is-${['first','middle','last'][i]} ${i===0?'is-past':i===1?'is-current':''}"><i class="wl-dot">${i===0?'✓':''}</i><b class="wl-node-label" data-check>${t}</b><small data-check>11月3日</small></span>`).join('')}</div><div class="wl-stage-actions"><span class="wl-stage-pager"><button data-check>‹</button>1 / 4<button data-check>›</button></span><button class="wl-stage-detail" data-check>详情</button></div></div>
<div class="sample-columns"><section><div class="wl-banner"><span><b data-check>WeLink 质量运营群</b><small data-check>5 条消息 · 当前会话</small></span></div><p>请核对上线计划，提醒相关负责人反馈最新进展。</p>
<div class="wl-chips"><button class="wl-chip" data-check>已记录跟进任务</button><button class="wl-chip is-done" data-check>已完成</button><button class="wl-chip is-cancelled" data-check>已取消</button></div>
<div class="wl-readonly" style="display:flex"><div class="wl-conversation-controls"><span class="wl-readonly-text" data-check>使用 Bot 身份回复当前会话</span><div class="wl-role-switch"><button aria-pressed="false" data-check>本人</button><button aria-pressed="true" data-check>Bot</button></div></div><form class="wl-manual-form"><textarea aria-label="回复" data-check>核对完成，等待确认后发送。</textarea><div class="wl-manual-actions"><small data-check>消息将发送到当前会话</small><button type="button" data-check>发送</button></div><p class="wl-send-feedback is-error" data-check>连接暂不可用，请稍后重试</p></form></div></section>
<aside class="sample-panel"><header class="wl-section-head"><b data-check>提醒任务</b><span data-check>4 项</span></header><div class="wl-schedule-filters"><button aria-pressed="true" data-check>全部 4</button><button data-check>待执行 1</button></div><details class="wl-scheduled" open><summary><span class="wl-scheduled-copy"><b data-check>评审会议前提醒</b><small data-check>每天 09:00 · 推送到此会话</small></span><span class="wl-scheduled-status is-running" data-check>执行中</span></summary><div class="wl-scheduled-detail"><dl class="wl-rows"><dt data-check>对象</dt><dd data-check>质量运营群</dd></dl><p class="wl-scheduled-error" data-check>最近一次推送失败</p><p class="wl-scheduled-delivery" data-check>消息已送达</p></div></details>
<section class="wl-followups"><header class="wl-section-head"><b data-check>跟进与记忆</b><span data-check>4 项</span></header>${statuses.map((s,i)=>`<details class="wl-task is-${s}" open><summary><b class="wl-task-title" data-check>${['提交上线评审材料','等待业务负责人确认','归档评审结论','停止重复提醒'][i]}</b>${mark(s)}</summary><dl class="wl-rows"><dt data-check>提出人</dt><dd data-check><span class="wl-person" data-check>负责人</span></dd><dt data-check>最新进展</dt><dd data-check>材料已提交，等待核对。<span class="wl-note" data-check>11月3日 10:30</span></dd><dt data-check>紧急度</dt><dd>${['low','normal','high','urgent'].map(t=>`<span class="wl-urgency-tag is-${t}" data-check>${t}</span>`).join('')}</dd></dl><details class="wl-sub" open><summary data-check>跟进记录</summary><ol class="wl-timeline"><li class="is-created"><i></i><div><b data-check>创建任务</b><time data-check>11月3日</time><p data-check>记录负责人和截止时间</p></div></li></ol></details><div class="wl-actions"><button class="wl-act is-primary" data-check>记录进展</button><button class="wl-act is-quiet" data-check>暂停</button><select class="wl-urgency" data-check><option>普通</option></select></div></details>`).join('')}</section></aside></div></main><script src="/js/shared/desktop-license-badge.js"></script></body></html>`;
app.whenReady().then(async()=>{
 const web=express();web.get('/',(_,res)=>res.type('html').send(fixture));web.get('/api/desktop-license/status',(_,res)=>res.json({enabled:true,valid:license!=='invalid',expiresAt:Date.now()+(license==='urgent'?3600000:(license==='warning'?2:30)*86400000),trustedNow:Date.now(),licenseId:'fixture',reasonCode:'EXPIRED'}));web.use(express.static(path.join(__dirname,'../frontend')));server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s))});
 win=new BrowserWindow({show:false,width:1400,height:1100,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 nativeTheme.themeSource='dark';await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until('!!document.getElementById("desktop-license-badge")');
 for(const theme of ['default','light','dark']){
  await evaluate(`document.documentElement.${theme==='default'?'removeAttribute("data-theme")':`setAttribute('data-theme','${theme}')`}`);
  await new Promise(r=>setTimeout(r,250));
  const failures=await evaluate(`(()=>{
   const rgb=v=>(v.match(/[\\d.]+/g)||[]).map(Number),blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
   function bg(e){if(!e)return [255,255,255];return blend(rgb(getComputedStyle(e).backgroundColor),bg(e.parentElement))}
   const lum=a=>a.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
   return [...document.querySelectorAll('[data-check]')].map(e=>{const b=bg(e),f=blend(rgb(getComputedStyle(e).color),b),a=lum(f),c=lum(b);return {class:e.className,color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor,text:e.textContent.trim().slice(0,30),ratio:(Math.max(a,c)+.05)/(Math.min(a,c)+.05)}}).filter(x=>x.ratio<4.5);
  })()`);
  if(failures.length) console.error(JSON.stringify({theme,failures},null,2)); assert.deepEqual(failures,[],theme+' text contrast >=4.5:1');
  fs.writeFileSync(path.join(temp,theme+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 const badge=await evaluate(`(()=>{const e=document.getElementById('desktop-license-badge'),r=e.getBoundingClientRect(),c=getComputedStyle(e);return {left:r.left,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,bg:c.backgroundColor}})()`);
 assert.ok(badge.left>badge.w/2&&badge.right<=badge.w&&badge.bottom<=badge.h,'license sits at bottom-right');assert.equal(badge.bg,'rgba(241, 247, 244, 0.8)');
 win.setSize(390,1100);await evaluate(`document.documentElement.dataset.theme='light'`);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,'narrow layout fits');
 fs.writeFileSync(path.join(temp,'mobile.png'),(await win.webContents.capturePage()).toPNG());
 for(license of ['warning','urgent','invalid']){
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await until('!!document.getElementById("desktop-license-badge")');
  const state=await evaluate(`(()=>{const e=document.getElementById('desktop-license-badge');return {text:e.textContent,bg:e.style.background,color:e.style.color}})()`);
  assert.ok(state.text.length>0);
  assert.equal(state.color,license==='warning'?'rgb(133, 77, 14)':'rgb(153, 27, 27)');
  assert.equal(state.bg,license==='warning'?'rgba(255, 251, 235, 0.9)':'rgba(254, 242, 242, 0.9)');
 }
 win.destroy();server.close();console.log('PASS: channel surfaces contrast, default light under OS dark, explicit dark, mobile, and license positioning/states. Screenshots: '+temp);app.exit(0);
}).catch(e=>{console.error(e);win?.destroy();server?.close();app.exit(1)});
