// Real slide editor with mocked AI responses; isolated profile, no live AI or user data writes.
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const root=path.join(__dirname,'..'),tool=path.join(root,'backend/builtin-tools/network_safety_meeting_summary');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'slide-copilot-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server;const transforms=[],generations=[],structured=[];let failTransform=false,emptyTransform=false;
const evaluate=code=>win.webContents.executeJavaScript(code,true);
const until=code=>evaluate(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${code})resolve();else if(++n>250)reject(Error(${JSON.stringify(code)}));else setTimeout(poll,20)};poll()})`);
app.whenReady().then(async()=>{
 const web=express();web.use(express.json({limit:'2mb'}));
 web.get('/tool/',(_,res)=>res.type('html').send(fs.readFileSync(path.join(tool,'index.html'),'utf8').replace(/<script\b[^>]*src="https:[^>]*><\/script>/g,'').replace('<head>',`<head><script>window.tailwind={};window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));localStorage.setItem('tools_token','fixture');</script>`)));
 web.post('/api/ai/ppt-transform-text',(req,res)=>{transforms.push(req.body);if(failTransform)return res.status(503).json({error:'fixture AI unavailable'});res.json({results:emptyTransform?[]:req.body.items.map(item=>({id:item.id,text:(req.body.action==='translate_en'?'English ':req.body.action==='translate_zh'?'中文 ':'润色 ')+item.id}))});});
 web.post('/api/ai/ppt-copilot',(req,res)=>{generations.push(req.body);res.json({reply:JSON.stringify([{id:'fixture-generated',layout:'custom',html:'<div class="slide-pad"><h1 class="editable">Generated title</h1><p class="editable">Generated content</p></div>'}])});});
 web.post('/api/ai/ppt-copilot-actions',(req,res)=>{structured.push(req.body);res.json({actions:[{type:'setText',target:req.body.context.components[0].id,value:'Changed component'}],summary:'fixture modified'});});
 web.use('/api',(_,res)=>res.json({items:[],projects:[],settings:{}}));
 web.use('/tool',express.static(tool));web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{backgroundThrottling:false}});
 await win.loadURL(`http://127.0.0.1:${server.address().port}/tool/`);
 await until('document.querySelector("#deck .slide-wrap.is-active .vision-text")');
 const click=action=>evaluate(`document.querySelector('.ai-shortcut-btn[data-action="${action}"]').click()`);
 const chat=()=>evaluate('document.getElementById("aiChatWindow").textContent');
 const clear=()=>evaluate(`document.querySelector('#deck .slide-wrap.is-active .slide').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1}));document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,button:0,pointerId:1}));`);
 const select=selector=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});document.querySelector('[data-layer-id="'+el.dataset.pptElementId+'"]').click()})()`);
 console.log('1. Whole-page translation and polish preserve template geometry and pictures');
 const geometry=await evaluate(`[...document.querySelectorAll('#deck .vision-element')].map(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height,src:el.getAttribute('src')}))`);
 for(const action of ['translate_en','translate_zh','polish']){
  await click(action);await until(`document.getElementById('aiChatWindow').textContent.includes('${action==='polish'?'润色文字':action==='translate_en'?'翻译为英文':'翻译为中文'}完成')`);
  assert.equal(transforms.at(-1).action,action);assert.ok(transforms.at(-1).items.length>10);
 }
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('#deck .vision-element')].map(el=>({left:el.style.left,top:el.style.top,width:el.style.width,height:el.style.height,src:el.getAttribute('src')}))`),geometry);
 console.log('2. Selected text, selected image, AI failure and empty results give accurate feedback');
 await select('#deck .vision-text');await click('translate_en');await until(`!document.querySelector('[id^="ai-loading-"]')`);
 assert.equal(transforms.at(-1).items.length,1,'selection translates only its text');
 await select('#deck .vision-visual');const requests=transforms.length;await click('translate_en');
 assert.equal(transforms.length,requests);assert.match(await chat(),/未发现|没有可/);
 await clear();failTransform=true;await click('translate_en');await until(`document.getElementById('aiChatWindow').textContent.includes('fixture AI unavailable')`);failTransform=false;
 emptyTransform=true;await click('translate_en');await until(`!document.querySelector('[id^="ai-loading-"]')`);assert.match((await chat()).split('🌐 请将当前页面翻译为英文').at(-1),/失败/);emptyTransform=false;
 console.log('3. Every remaining shortcut responds through its intended path');
 for(const action of ['to_metric','to_comparison','to_process','style_dark','style_light','to_quote']){
  const before=generations.length;await click(action);await until(`!document.querySelector('[id^="ai-loading-"]')`);assert.equal(generations.length,before+1,action);
 }
 for(const action of ['modify_selected','layout_page','fix_layout','unify_deck']){
  const before=await chat();await click(action);assert.notEqual(await chat(),before,action+' must show feedback');
 }
 console.log('4. Structured page and selection edits execute their returned changes');
 for(const action of ['modify_selected','layout_page']){
  if(action==='modify_selected')await select('#deck .slide-wrap.is-active .editable');else await clear();
  await evaluate(`document.getElementById('aiInput').value='修改标题文字'`);
  const before=structured.length;await click(action);await until(`!document.querySelector('[id^="ai-component-loading-"]')`);
  assert.equal(structured.length,before+1,action);
  assert.equal(structured.at(-1).context.scope,action==='modify_selected'?'single':'page');
  assert.match(await evaluate(`document.querySelector('#deck .slide-wrap.is-active').textContent`),/Changed component/);
 }
 assert.deepEqual(await evaluate('fixtureErrors'),[]);
 console.log('PASS slide Copilot: translations, polish, all 13 shortcuts, selection scope, template preservation and failure feedback.');
 win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
setTimeout(()=>app.exit(1),45000).unref();
