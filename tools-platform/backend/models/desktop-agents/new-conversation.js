// Native desktop creation. Never resumes an unrelated recent conversation or
// substitutes a CLI model. A new native UUID and its exact user receipt are required.
const {execFile}=require('node:child_process');
const catalog=require('./catalog'),claude=require('./claude-desktop'),ag=require('./antigravity-cdp');
const {composerText}=require('./composer-text');
const names={codex:'Codex',claudecode:'Claude Code',antigravity:'Antigravity'};
const failure=(code,message)=>Object.assign(new Error(message),{code,status:code==='DELIVERY_UNKNOWN'?504:409});
// Accessibility text can merge blank paragraphs; compare all actual lines and
// characters while allowing only repeated blank-line presentation differences.
function isNewClaudeComposer(snapshot,state,previous){
 const newHeading=(snapshot.elements||[]).some(e=>e.role==='AXHeading'&&/^(?:新建会话|新会话|新对话|New conversation|New session|New chat)$/i.test(e.title||e.desc||''));
 return newHeading||Boolean(previous.current&&!state.current);
}
let uiTail=Promise.resolve();
function exclusive(run){const pending=uiTail.then(run,run);uiTail=pending.catch(()=>{});return pending;}
function exec(file,args,options={}){return new Promise((resolve,reject)=>execFile(file,args,{timeout:20000,maxBuffer:16*1024*1024,...options},(error,stdout)=>error?reject(failure('DESKTOP_UNAVAILABLE','桌面创建命令未完成')):resolve(stdout)));}
async function ui(provider,command,argument){
 const value=JSON.parse(await exec(await claude.helper(),argument?[command,JSON.stringify(argument)]:[command],{env:{...process.env,DRAGON_AX_APP:provider==='codex'?'codex':'claude'}}));
 if(!value.ok)throw failure(value.code||'DESKTOP_UNAVAILABLE',String(value.error||'桌面操作失败').replaceAll('Claude',names[provider]));
 return value;
}
async function nativeRows(provider){return provider==='codex'?catalog.codex(200):catalog.claude(200);}
async function receipt(provider,before,text,{readRows=nativeRows,readTranscript=catalog.transcript,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const previous=new Set(before.map(s=>s.id));
 for(let n=0;n<60;n++){
  for(const row of await readRows(provider)){if(previous.has(row.id))continue;const transcript=await readTranscript(row).catch(()=>({items:[]}));if(transcript.items.some(m=>m.role==='user'&&composerText(m.content)===composerText(text)))return {id:row.id,status:'accepted'};}
  await wait(250);
 }
 throw failure('DELIVERY_UNKNOWN','已操作新建，但未确认新的原生会话与消息回执；请检查桌面，不会重试或改用旧会话');
}
async function createAndSend(provider,text,{driver=ui,readRows=nativeRows,readReceipt=receipt,open=uri=>exec('/usr/bin/open',['-g',uri]),wait=ms=>new Promise(r=>setTimeout(r,ms)),platform=process.platform}={}){
 if(provider==='antigravity')return ag.createAndSend(text);
 if(!['codex','claudecode'].includes(provider))throw failure('DESKTOP_UNAVAILABLE','未知桌面成员');
 if(platform!=='darwin')throw failure('DESKTOP_UNAVAILABLE',names[provider]+' 自动建桌面对话目前需要 macOS 桌面连接器');
 return exclusive(async()=>{
  const status=await driver(provider,'status');
  if(!status.trusted)throw failure('AX_PERMISSION',names[provider]+' 自动新建需要辅助功能权限：请在 macOS“系统设置 → 隐私与安全性 → 辅助功能”中允许运行平台服务的程序（PM2 使用的 node）');
  if(!status.running)throw failure('DESKTOP_UNAVAILABLE',names[provider]+' 桌面客户端未运行，请先打开客户端');
  const before=await readRows(provider),snapshot=await driver(provider,'snapshot'),view=claude.parse(snapshot);
  // Refuse overwriting an unsubmitted new-task draft. Drafts in existing named
  // conversations are retained by the desktop client's own New action.
  const existing=provider==='codex'?before.some(r=>r.title===snapshot.windowTitle):before.some(r=>r.title===view.current);
  const samePreparedDraft=view.composers.length===1&&composerText(view.composers[0])===composerText(text);
  if(!existing&&view.composers.some(t=>t.trim())&&!samePreparedDraft)throw failure('DESKTOP_DRAFT',names[provider]+' 的新会话输入框已有草稿，请先保存；不会覆盖');
  let previous='';
  if(provider==='codex'){
   const uri=new URL('codex://threads/new');uri.searchParams.set('mode','codex');uri.searchParams.set('prompt',text);
   await open(uri.toString());
  }else{
   const focus=await driver(provider,'press',{title:'新建'});previous=focus.previous||'';
  }
  let ready=false;
  for(let n=0;n<60;n++){
   await wait(150);const current=await driver(provider,'snapshot'),state=claude.parse(current);
   if(state.composers.length!==1)continue;
   if(provider==='codex'&&composerText(state.composers[0])===composerText(text)){ready=true;break;}
   if(provider==='claudecode'&&isNewClaudeComposer(current,state,view)&&!state.composers[0].trim()&&!state.busy){await driver(provider,'paste',{text});ready=true;break;}
  }
  if(!ready)throw failure('DESKTOP_TARGET_UNCONFIRMED',names[provider]+' 未打开可确认的新会话，消息尚未发送');
  await driver(provider,'submit-text',{text,...(previous?{previous}:{})});
  return readReceipt(provider,before,text);
 });
}
module.exports={createAndSend,ui,receipt,composerText};
