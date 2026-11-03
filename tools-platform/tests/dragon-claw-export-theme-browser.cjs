// node_modules/.bin/electron --disable-gpu tests/dragon-claw-export-theme-browser.cjs
// Render the actual exported HTML from disk; no live service or business data is required.
const {app,BrowserWindow,nativeTheme}=require('electron');
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chat-export-theme-'));app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
let server,source,offline;
const root=path.join(__dirname,'..'),frontend=path.join(root,'frontend');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const styles=fs.readFileSync(path.join(frontend,'index.html'),'utf8').match(/<link\b[^>]*rel="stylesheet"[^>]*>/g).join('\n');
const fixture=`<!doctype html><html lang="zh-CN" data-ui="v2"><head><meta charset="utf-8">${styles}</head><body class="home-page home-mode-chat dc-chatting"><div class="home-layout"><main id="homeMain" class="home-main"><section id="dragonClaw" class="dc"><header class="dc-chat-head"><img class="dc-chat-avatar" src="/assets/logo.png"><span class="dc-chat-badge">WeLink</span></header><div class="dc-thread" id="dcThread">
<div class="wl-banner"><span><b>质量运营群</b><small>测试会话</small></span></div>
<article class="dc-msg dc-msg--user dc-msg--history is-collapsed"><div class="dc-msg-main"><div class="dc-msg-body">核对本月风险数据 ${'请保留完整内容。'.repeat(30)}</div><button data-dc-message-toggle>展开全文</button></div></article>
<article class="dc-msg dc-msg--ai dc-msg--history wl-msg dc-provider-message"><div class="dc-msg-main"><div class="dc-msg-body"><h2>数据核对结果</h2><p>这是正常正文，<strong>关键结论</strong>应当清晰。</p><ul><li>按已保存的月份口径查询。</li></ul><blockquote>引用也保持可读。</blockquote><p><code>snapshot_id</code> 与 <a href="https://example.com/">来源链接</a></p><pre><code>SELECT score FROM snapshots;</code></pre><div class="ai-table-wrap"><table class="ai-markdown-table"><thead><tr><th>指标</th><th>状态</th></tr></thead><tbody><tr><td>风险项</td><td>已核对</td></tr></tbody></table></div></div><span class="dc-msg-speed">20 tok/s</span><div class="wl-chips"><button class="wl-chip is-done">跟进已完成</button></div></div></article></div></section></main></div><script src="/js/home/dragon-claw-export.js"></script></body></html>`;
const js=(win,code)=>win.webContents.executeJavaScript(code);
const colors=win=>js(win,`(()=>{const c=s=>getComputedStyle(document.querySelector(s));return {bg:c('body').backgroundColor,head:c('.dc-chat-head').backgroundColor,body:c('.dc-msg--ai .dc-msg-body').color,user:c('.dc-msg--user .dc-msg-body').color,quote:c('blockquote').color,table:c('.dc-msg-body td').color,code:c('pre code').color,history:c('.dc-msg--history').opacity,mask:c('.dc-msg--user .dc-msg-body').maskImage,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
const errors=[];
app.whenReady().then(async()=>{
 const web=express();web.get('/',(_,res)=>res.type('html').send(fixture));web.use(express.static(frontend));server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s))});
 source=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 offline=new BrowserWindow({show:false,width:1280,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 offline.webContents.on('console-message',(_,level,message)=>{if(level===3)errors.push(message)});
 await source.loadURL(`http://127.0.0.1:${server.address().port}`);
 for(const theme of ['default','light','dark']){
  nativeTheme.themeSource=theme==='dark'?'light':'dark'; // OS preference must not change the exported platform theme.
  await js(source,`document.documentElement.${theme==='default'?'removeAttribute("data-theme")':`setAttribute('data-theme','${theme}')`};document.querySelector('.dc-msg--ai').dcRounds=[{index:1,model:'fixture-model',inputTokens:100,outputTokens:40,ms:2000,generationMs:1800,tps:22}];`);
  const current=await colors(source);
  const result=await js(source,`DragonClawExport.buildHtml({thread:document.getElementById('dcThread')})`);
  assert.match(result.html, /data-ui="v2"/);assert.match(result.html,/id="dragonClaw"/);assert.match(result.html,/id="homeMain"/);
  assert.match(result.html,/模型调用统计/,'existing export statistics are preserved');assert.doesNotMatch(result.html,/data-dc-message-toggle/);
  assert.doesNotMatch(result.html,/<link\b[^>]*rel="stylesheet"/);
  const file=path.join(temp,theme+'.html');fs.writeFileSync(file,result.html);
  await offline.loadFile(file);await wait(150);
  const exported=await colors(offline);
  assert.equal(exported.body,current.body,theme+' assistant ink');assert.equal(exported.user,current.user,theme+' user ink');
  for(const key of ['quote','table','code'])assert.equal(exported[key],current[key],theme+' '+key);
  assert.equal(exported.history,'1');assert.equal(exported.mask,'none','collapsed source is fully readable in export');assert.equal(exported.overflow,false);
  if(theme!=='dark'){assert.equal(exported.bg,'rgb(255, 255, 255)');assert.equal(exported.head,current.head);assert.equal(exported.body,'rgb(25, 29, 36)')}
  else assert.equal(exported.bg,'rgb(15, 17, 21)');
  fs.writeFileSync(path.join(temp,theme+'.png'),(await offline.webContents.capturePage()).toPNG());
 }
 // Shut the fixture server down before opening the file again: the snapshot is self-contained.
 await new Promise(r=>server.close(r));server=null;
 await offline.loadFile(path.join(temp,'light.html'));await wait(100);assert.equal((await colors(offline)).body,'rgb(25, 29, 36)');
 offline.setSize(390,1000);await wait(100);assert.equal((await colors(offline)).overflow,false,'offline mobile layout fits');
 fs.writeFileSync(path.join(temp,'mobile.png'),(await offline.webContents.capturePage()).toPNG());
 assert.deepEqual(errors,[]);console.log('PASS: current theme and reading ink, Markdown, channel chips, stats, expanded history, offline and mobile. Screenshots: '+temp);source.destroy();offline.destroy();app.exit(0);
}).catch(e=>{console.error(e);source?.destroy();offline?.destroy();server?.close();app.exit(1)});
