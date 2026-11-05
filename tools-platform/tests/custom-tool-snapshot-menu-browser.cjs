// Actual shared shell, isolated profile and mocked tools/APIs. No live downloads or publishing.
const {app,BrowserWindow,nativeTheme}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'snapshot-menu-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server;
const run=code=>win.webContents.executeJavaScript(code,true);
const until=code=>run(`new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(${code})resolve();else if(++n>250)reject(Error(${JSON.stringify(code)}));else setTimeout(poll,20)};poll()})`);
const shell=code=>run(`(()=>{const s=document.querySelector('#shell')?.contentWindow||window;return s.eval(${JSON.stringify(code)})})()`);
app.whenReady().then(async()=>{
 const web=express();
 web.get('/host',(_,res)=>res.type('html').send(`<!doctype html><style>body{margin:0}#side{position:fixed;left:0;top:0;bottom:0;width:296px;background:#eee}#shell{position:fixed;left:296px;top:55px;width:calc(100% - 296px);height:calc(100% - 55px);border:0}</style><button id="side">Sidebar</button><iframe id="shell" src="/tools/slide?embedded=1"></iframe>`));
 web.get('/tools/:slug',(_,res)=>res.type('html').send(fs.readFileSync(path.join(root,'frontend/pages/custom-tool.html'),'utf8').replace(/<script\b[^>]*src="[^"]+"[^>]*><\/script>/g,'').replace('<head>',`<head><script>localStorage.setItem('tools_lang','zh-CN');window.fixtureErrors=[];addEventListener('error',e=>fixtureErrors.push(e.message));addEventListener('unhandledrejection',e=>fixtureErrors.push(String(e.reason)));window.showToast=()=>{};window.startSnapshotPublish=o=>window.fixturePublished=o;window.openSnapshotPublishProgress=id=>window.fixtureJob=id;if(new URLSearchParams(location.search).has('embedded'))document.documentElement.classList.add('is-embedded-tool');</script><style>:root{--navbar-h:0px}</style>`)));
 web.get('/api/custom-tools',(_,res)=>res.json(['slide','other'].map(slug=>({slug,name:slug,icon:'🧩',filePath:'/content'}))));
 web.get('/api/department-reward-penalty/snapshot/settings',(_,res)=>res.json({tools:['slide','other'].map(toolSlug=>({toolSlug}))}));
 web.get('/api/department-reward-penalty/snapshot/jobs',(_,res)=>res.json([{id:'job-1',stage:'Fixture success',status:'success',createdAt:new Date().toISOString(),toolSlug:'slide'}]));
 web.get('/content',(_,res)=>res.type('html').send('<!doctype html><button id="content">Tool content</button><iframe id="nested" src="/nested"></iframe>'));
 web.get('/nested',(_,res)=>res.send('<!doctype html><button id="deep">Nested content</button>'));
 web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{backgroundThrottling:false}});
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const [url,width,theme] of [['/host',1440,'light'],['/host',640,'dark'],['/tools/other',390,'light'],['/tools/slide',1100,'dark']]){
  nativeTheme.themeSource=theme;win.setSize(width,800);await win.loadURL(base+url);
  await until(`(()=>{const d=document.querySelector('#shell')?.contentDocument||document;return d.querySelector('.custom-tool-frame')?.contentDocument?.querySelector('#nested')?.contentDocument?.querySelector('#deep')&&!d.querySelector('#downloadReadonlyWrap').hidden})()`);
  assert.equal(await shell('document.getElementById("openRawTool").getAttribute("href")'),'/?app='+encodeURIComponent(new URL(url,base).pathname.startsWith('/tools/')?new URL(url,base).pathname+new URL(url,base).search:'/tools/slide?embedded=1'));
  for(const name of ['downloadReadonly','publishReadonly']){
   const open=()=>shell(`document.getElementById('${name}Tool').click()`);
   const hidden=()=>shell(`document.getElementById('${name}Menu').hidden`);
   await open();
   const bounds=await shell(`(()=>{const m=document.getElementById('${name}Menu'),b=document.getElementById('${name}Tool'),r=m.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,expanded:b.getAttribute('aria-expanded'),hit:m.contains(document.elementFromPoint(r.left+10,r.top+10))}})()`);
   assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.bottom<=bounds.height,JSON.stringify({url,width,name,bounds}));
   assert.equal(bounds.hit,true,'menu is visible and hit-testable inside its frame');assert.equal(bounds.expanded,'true');
   await shell(`document.querySelector('.custom-tool-head').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);assert.equal(await hidden(),true,'shell outside click');
   await open();await shell(`document.querySelector('.custom-tool-frame').contentDocument.getElementById('content').click()`);assert.equal(await hidden(),true,'tool iframe outside click');
   await open();await shell(`document.querySelector('.custom-tool-frame').contentDocument.querySelector('#nested').contentDocument.getElementById('deep').click()`);assert.equal(await hidden(),true,'nested iframe outside click');
   await open();await shell(`document.querySelector('.custom-tool-frame').contentDocument.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await hidden(),true,'Escape inside tool iframe');
   if(url==='/host'){
    await open();await run(`document.getElementById('side').click()`);assert.equal(await hidden(),true,'platform sidebar click');
   }
   await open();await open();assert.equal(await hidden(),true,'same trigger toggles closed');
  }
  await shell(`document.getElementById('downloadReadonlyTool').click();document.getElementById('publishReadonlyTool').click()`);
  assert.equal(await shell(`document.getElementById('downloadReadonlyMenu').hidden`),true,'menus remain mutually exclusive');
  await shell(`document.querySelector('[data-snapshot-publish="force"]').click()`);
  assert.equal(await shell('fixturePublished.force'),true,'publish option preserves action');
  assert.equal(await shell(`document.getElementById('publishReadonlyMenu').hidden`),true);
  await shell(`window.downloadSnapshot=format=>{window.fixtureFormat=format;closeSnapshotMenus()};document.getElementById('downloadReadonlyTool').click();document.querySelector('[data-snapshot-download="pages"]').click()`);
  assert.equal(await shell('fixtureFormat'),'pages','download option preserves format');
  if(url==='/host'&&width===1440){
   await shell(`document.getElementById('publishReadonlyTool').click();document.querySelector('[data-snapshot-publish="logs"]').click()`);
   await until(`document.querySelector('#shell').contentDocument.querySelector('[data-snapshot-job]')`);
   await shell(`document.querySelector('[data-snapshot-job]').click()`);assert.equal(await shell('fixtureJob'),'job-1');
   await shell(`document.getElementById('downloadReadonlyTool').focus();document.getElementById('downloadReadonlyTool').click()`);
   assert.equal(await shell(`document.getElementById('downloadReadonlyMenu').hidden`),false);
   await shell(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
   fs.writeFileSync(path.join(temp,'embedded-menu.png'),(await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(await shell('fixtureErrors'),[]);
 }
 console.log('PASS snapshot menus: host sidebar, shell/tool/nested-frame outside clicks, Escape, toggle, bounds, actions, logs, narrow/wide, light/dark, shared tool shells. Preview: '+temp);
 win.destroy();server.close();app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1)});
setTimeout(()=>app.exit(1),45000).unref();
