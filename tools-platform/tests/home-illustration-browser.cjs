// Static homepage layout: actual HTML/CSS, no business APIs or messages.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'home-art-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const web=express();
 web.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<html','<html data-ui="v2"').replace('<body','<body class="home-mode-chat"')));
 web.use(express.static(path.join(root,'frontend')));
 const server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 const win=new BrowserWindow({show:false,width:1440,height:950});
 try{
  await win.loadURL('http://127.0.0.1:'+server.address().port);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
  const run=s=>win.webContents.executeJavaScript(s);
  await run(`document.querySelector('.v2-agent-illustration img').decode()`);
  await run(`document.querySelector('#v2Avatar').innerHTML='<img src="/assets/logo.png" alt="">';document.querySelector('#v2Avatar img').decode()`);
  assert.equal(await run(`(()=>{const a=document.querySelector('#v2Avatar').getBoundingClientRect(),i=document.querySelector('#v2Avatar img').getBoundingClientRect();return i.top>=a.top+1&&i.height<=a.height*1.26})()`),true,'avatar has headroom and reduced magnification');
  await run(`(async()=>{
    const list=document.querySelector('#homeChatList');
    for(const text of ['1+1=3对吗','这个页面是啥','你可以自动创建SKILL吗 我想做一个搜索思科等通信厂商新闻的SKILL','用 Web 搜索查一下 Node.js 26 什么时候进入 LTS，附上出处链接']){
      const b=document.createElement('button');b.dataset.question=text;list.append(b);
    }
    window.testRecentQuestions = [...list.querySelectorAll('[data-question]')].map(b=>b.dataset.question);
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => String(url).startsWith('/api/ai/sessions?')
      ? Promise.resolve(new Response(JSON.stringify({items:window.testRecentQuestions.map(firstQuestion=>({firstQuestion}))}), {status:200}))
      : originalFetch(url, options);
    const script=document.createElement('script');script.src='/js/home/home-v2.js';
    await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.body.append(script)});
  })()`);
  await run(`document.querySelector('.v2-mascot').decode()`);

  const gaze = () => run(`document.querySelector('.v2-mascot-pupil').getAttribute('transform')`);
  const move = (x,y,type='mouse') => run(`document.dispatchEvent(new PointerEvent('pointermove',{clientX:${x},clientY:${y},pointerType:'${type}'}))`);
  const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
  await move(0,0);await pause(900);
  const leftGaze=await gaze();
  assert.ok(Number(leftGaze.match(/translate\(([-.\d]+)/)[1])<0,'pupils look left');
  await move(1440,950);await pause(1000);
  const rightGaze=await gaze(),offsets=rightGaze.match(/translate\(([-.\d]+) ([-.\d]+)/).slice(1).map(Number);
  assert.ok(offsets[0]>0&&offsets[0]<=20&&offsets[1]>0&&offsets[1]<=14,'pupils follow right/down within subtle bounds');
  assert.equal(await run(`getComputedStyle(document.querySelector('.v2-mascot-eyes')).pointerEvents`),'none');
  assert.equal(await run(`(()=>{const a=document.querySelector('.v2-mascot').getBoundingClientRect(),b=document.querySelector('.v2-mascot-eyes').getBoundingClientRect();return Math.abs(a.top-b.top)<.1&&a.width===b.width&&Math.abs(a.height-b.height)<.1})()`),true,'eye layer aligns with original image');
  assert.equal(await run(`new Promise(resolve=>{const start=performance.now();function check(){if(Number(document.querySelector('.v2-mascot-lid').getAttribute('opacity'))>.8)return resolve(true);if(performance.now()-start>8000)return resolve(false);requestAnimationFrame(check)}check()})`),true,'random blink closes eyes');
  await pause(350);
  await run(`document.documentElement.dispatchEvent(new PointerEvent('pointerleave'))`);await pause(1300);
  assert.ok(Math.abs(Number((await gaze()).match(/translate\(([-.\d]+)/)[1]))<.2,'leaving page relaxes gaze');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(50);
  assert.equal(await run(`getComputedStyle(document.querySelector('.v2-mascot-eyes')).visibility`),'hidden','reduced motion preserves static original');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});await pause(50);

  for(const [name,w,h,theme] of [['wide',1440,950,'light'],['dark',1440,950,'dark'],['mobile',390,844,'light']]){
   win.setSize(w,h);await run(`document.documentElement.dataset.theme='${theme}';document.body.classList.toggle('v2-side-collapsed',${w<860})`);
   await new Promise(r=>setTimeout(r,350));
   const box=await run(`(()=>{const a=document.querySelector('.v2-agent-illustration').getBoundingClientRect(),c=document.querySelector('#dcComposer').getBoundingClientRect();const s=document.querySelector('.v2-suggest').getBoundingClientRect();return {left:a.left,right:a.right,top:a.top,bottom:a.bottom,composerBottom:c.bottom,width:innerWidth,suggestTop:s.top,suggestBottom:s.bottom}})()`);
   assert.ok(box.top>=box.composerBottom,'artwork stays below input');
   assert.ok(box.top>=box.suggestTop && box.bottom<=box.suggestBottom+1,'artwork stays inside suggestions');
   assert.ok(box.left>=0&&box.right<=box.width,'artwork fits viewport');
   assert.equal(await run(`(()=>{const m=document.querySelector('.v2-mascot'),a=m.getBoundingClientRect(),c=document.querySelector('#dcComposer').getBoundingClientRect();return m.parentElement.id==='dcComposer'&&Math.abs(a.bottom-c.top)<=4&&a.right<c.right-10&&a.top<c.top})()`),true,'mascot paws rest on input border');
   if(theme==='dark')assert.equal(await run(`getComputedStyle(document.querySelector('#dragonClaw')).backgroundImage`),'none','dark welcome page uses platform background instead of legacy blue panel');
   const shot=await win.webContents.capturePage();
   // Compare both sides of the image's top-left edge (blank in this artwork).
   const bitmap=shot.toBitmap(),size=shot.getSize();
   const pixel=(x,y)=>[...bitmap.subarray((Math.floor(y)*size.width+Math.floor(x))*4,(Math.floor(y)*size.width+Math.floor(x))*4+3)];
   const inside=pixel(box.left+3,box.top+3),outside=pixel(box.left-3,box.top+3);
   assert.ok(inside.every((c,i)=>Math.abs(c-outside[i])<=1),'artwork background blends into '+name+' page');
   fs.writeFileSync(path.join(temp,name+'.png'),shot.toPNG());
   assert.equal(await run(`getComputedStyle(document.querySelector('.v2-suggest-item')).maskImage`),'none','short suggestions remain clear');
   assert.match(await run(`getComputedStyle(document.querySelector('.v2-suggest-item.is-fading')).maskImage`),/linear-gradient/,'long overlapping suggestions fade towards their end');
   await run(`document.querySelector('.v2-suggest-item.is-fading').focus()`);
   assert.equal(await run(`getComputedStyle(document.querySelector('.v2-suggest-item.is-fading')).maskImage`),'none','keyboard focus restores full contrast');
   await run(`document.activeElement.blur()`);
  }
  await run(`window.ToolsI18n={getLanguage:()=>window.testLanguage||'en-US'};window.dispatchEvent(new Event('tools:languagechange'))`);
  const suggestions=()=>run(`[...document.querySelectorAll('.v2-suggest-item')].map(b=>b.dataset.fill)`);
  const defaults=await suggestions();
  assert.equal(defaults.length,4,'no English history gives four capability suggestions');
  assert.ok(defaults.every(text=>!/[\u3400-\u9fff]/.test(text)),'English mode excludes Chinese history');
  assert.ok(defaults.some(text=>text.includes('Python'))&&defaults.some(text=>text.startsWith('/schedule')));
  await run(`document.querySelector('.v2-suggest-item').click()`);
  assert.equal(await run(`document.querySelector('#dcInput').value`),defaults[0],'default suggestion fills input in English');
  await run(`window.testRecentQuestions.push('Check the latest SLA import');window.dispatchEvent(new Event('tools:languagechange'))`);
  await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(await suggestions(),['Check the latest SLA import'],'matching English history replaces defaults');
  await run(`window.testLanguage='zh-CN';window.dispatchEvent(new Event('tools:languagechange'))`);
  assert.ok((await suggestions()).every(text=>/[\u3400-\u9fff]/.test(text)),'switching back restores Chinese history');
  await run(`document.body.classList.add('dc-chatting')`);
  assert.equal(await run(`getComputedStyle(document.querySelector('.v2-agent-illustration')).display`),'none');
  assert.equal(await run(`getComputedStyle(document.querySelector('.v2-mascot')).display`),'none');
  assert.equal(await run(`getComputedStyle(document.querySelector('.v2-mascot-eyes')).display`),'none','eye animation hides in conversation');
  console.log('PASS homepage artwork layout and mascot animation. Screenshots: '+temp);
 }finally{win.destroy();server.close();app.quit();}
}).catch(e=>{console.error(e);app.exit(1)});
