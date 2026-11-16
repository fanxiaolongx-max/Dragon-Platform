// Run with: node_modules/.bin/electron tests/pinned-conversation-sort-browser.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'pin-sort-ui-'));
app.setPath('userData',temp);app.disableHardwareAcceleration();
let win,server,fail=false,mutations=[];
const preferences=['a','b','c','d','e','f','g','h'].map(id=>({source:'mine',id,pinned:1}));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ev=code=>win.webContents.executeJavaScript(code,true).catch(error=>{throw new Error(code,{cause:error});});
async function until(code){for(let i=0;i<100;i++){if(await ev(code))return;await wait(30);}throw Error('Timeout: '+code);}
async function point(id){return ev(`(()=>{const r=document.querySelector('[data-id="${id}"]').getBoundingClientRect();return {x:Math.round(r.left+60),y:Math.round(r.top+r.height/2),left:r.left};})()`);}
async function mouse(type,p){win.webContents.sendInputEvent({type,x:p.x,y:p.y,button:'left',clickCount:1});await wait(35);}
async function start(id){const p=await point(id);await mouse('mouseMove',p);await mouse('mouseDown',p);return p;}
async function drop(p){await mouse('mouseUp',p);await until(`!document.documentElement.classList.contains('is-conversation-dragging')`);await wait(30);}
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 web.get('/api/ai/conversation-list',(_,res)=>res.json({items:preferences}));
 web.put('/api/ai/conversation-list',(req,res)=>{
  if(fail)return res.status(503).json({error:'Save unavailable'});
  mutations.push(req.body);req.body.order.forEach((id,i)=>preferences.find(p=>p.id===id).pin_order=i);res.json({items:preferences});
 });
 web.get('/',(_,res)=>res.type('html').send(`<!doctype html><html><head><link rel="stylesheet" href="/css/home-mode.css"><style>
 body { margin:20px; background:#f7f7f9; color:#222; font:14px system-ui; } #list { width:260px; } [data-batch-scope] {display:grid;gap:2px;} .home-chat-item {height:34px;color:inherit;} .home-chat-open {border:0;background:transparent;color:inherit;text-align:left;height:34px;padding:8px;width:100%;} .conversation-list-toolbar {display:none;}
 </style></head><body><div id="list"></div><script>
 localStorage.setItem('tools_user','alice');window.AppDialog={alert:async msg=>window.lastError=msg};window.opens=0;
 </script><script src="/js/home/conversation-list.js"></script><script>
 const list=document.querySelector('#list'),items=${JSON.stringify(preferences.map(p=>({id:p.id})))};
 const config={source:'mine',items,id:item=>item.id,title:item=>item.id,date:()=> '2026-01-01',selector:'[data-index]',index:'index'};
 function render(){if(HomeConversationList.deferRender(list,render))return;window.renders=(window.renders||0)+1;
 const sorted=[...items].sort((a,b)=>HomeConversationList.comparePins(HomeConversationList.get('mine',a.id),HomeConversationList.get('mine',b.id)));
 list.innerHTML='<div data-batch-scope="pinned">'+sorted.map(item=>'<div class="home-chat-item" data-id="'+item.id+'" data-index="'+items.indexOf(item)+'"><button class="home-chat-open">📌 Conversation '+item.id+'</button></div>').join('')+'</div>';
 HomeConversationList.enhance(list,config);}
 list.addEventListener('click',e=>{if(e.target.closest('.home-chat-open'))window.opens++;});
 window.addEventListener('home:conversation-list-changed',render);render();
 </script></body></html>`));
 web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(resolve=>{const s=web.listen(0,'127.0.0.1',()=>resolve(s));});
 win=new BrowserWindow({show:false,width:640,height:700,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_,level,message)=>{if(level>=2)console.error(message);});
 await win.loadURL('http://127.0.0.1:'+server.address().port);await until(`document.querySelectorAll('.is-pinned').length===8`);
 let p=await start('a');await mouse('mouseUp',p);assert.equal(await ev('opens'),1,'normal click opens conversation');
 p=await start('a');const dest=await point('c');const move={x:p.x+150,y:dest.y};await mouse('mouseMove',move);
 assert.equal(await ev(`document.querySelector('[data-id="a"]').closest('.conversation-list-row').getBoundingClientRect().left`),p.left,'horizontal pointer motion never shifts row');
 assert.equal(await ev(`getComputedStyle(document.querySelector('[data-id="b"]').closest('.conversation-list-row')).transitionProperty`),'transform');
 const renders=await ev('renders');await ev('render()');assert.equal(await ev('renders'),renders,'refresh is deferred during drag');
 await drop(move);
 assert.deepEqual(mutations[0].order,['b','c','a','d','e','f','g','h'],'includes hidden batch rows');
 assert.equal(await ev('opens'),1,'drop never opens conversation');
 assert.equal(await ev(`document.querySelector('.conversation-list-row [data-id]').dataset.id`),'b');
 await win.reload();await until(`document.querySelector('.conversation-list-row [data-id]')?.dataset.id==='b'`);
 p=await start('b');const c=await point('c');await mouse('mouseMove',{x:p.x,y:c.y});
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await until(`!document.documentElement.classList.contains('is-conversation-dragging')`);
 await mouse('mouseUp',{x:p.x,y:c.y});assert.equal(mutations.length,1,'Escape cancels without saving');
 fail=true;p=await start('b');const a=await point('a');await mouse('mouseMove',{x:p.x+100,y:a.y});await drop({x:p.x+100,y:a.y});
 assert.equal(await ev('window.lastError'),'Save unavailable');assert.equal(await ev(`document.querySelector('.conversation-list-row [data-id]').dataset.id`),'b','failure restores saved order');
 console.log('PASS pinned sorting: vertical lock, sibling transitions, click suppression, hidden rows, reload, deferred refresh, Escape and failure rollback');
 win.destroy();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});app.exit(0);
}).catch(error=>{console.error(error);win?.destroy();server?.close();app.exit(1);});
