// Isolated full settings modal: column geometry, themes, languages, narrow screens, permission action.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),express=require('express');
const root=path.join(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'agent-tools-settings-'));
app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();
let win,server,manage=true,writes=[];
const groups=[
 {id:'always',label:'工作区文件与命令',mode:'always',enabled:true,tools:['read_file','search','write_file','edit_file','run_command'].map((name,i)=>({name,kindLabel:i===4?'命令':'只读',summary:'在工作目录中按文本或正则搜索文件内容，返回文件、行号和内容。',tokens:134+i,calls:9+i,failures:i===4?16:0,enabled:true}))},
 {id:'database',label:'平台数据库',mode:'deferred',enabled:true,tools:['list_databases','database_schema','read_database_table','insert_database_row','update_database_rows','delete_database_rows'].map((name,i)=>({name,kindLabel:i<3?'只读':'写入',summary:i===0?'列出当前租户的平台 SQLite（标识如 platform:tools.db、platform:report.db，指向平台管理的数据库）和所选工作目录中的 SQLite 数据库。':'管理员向 SQLite 业务表新增、修改或删除数据，支持结构化 filters 和 values 参数。',tokens:73+i*30,calls:i*7,failures:i===3?2:0,enabled:true}))},
 {id:'uiv',label:'UIVF12 抓取脚本仓库',mode:'deferred',enabled:false,tools:[{name:'list_uiv_scripts_with_an_extremely_long_tool_identifier',kindLabel:'外部 / 发送',summary:'读取已配置脚本与页面规则。',tokens:111,calls:10,failures:0,enabled:true}]}
];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ev=code=>win.webContents.executeJavaScript(code,true);
async function until(code){for(let i=0;i<180;i++){if(await ev(code))return;await wait(25);}throw Error('Timeout: '+code);}
const timeout=setTimeout(()=>{console.error('Settings fixture timed out');app.exit(1)},60000);
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());
 web.get('/',(_,res)=>res.type('html').send(fs.readFileSync(path.join(root,'frontend/index.html'),'utf8').replace('<head>',`<head><script>localStorage.setItem('tools_token','fixture');localStorage.setItem('tools_user','fixture');localStorage.setItem('tools_role','admin');localStorage.setItem('tools_tenant_id','default');</script>`)));
 web.get('/api/auth/me',(_,res)=>res.json({username:'fixture',role:'admin',tenantId:'default'}));
 web.get('/api/agent-mcp/servers',(_,res)=>res.json({servers:[],manage:false}));
 web.get('/api/agent-mcp/catalog',(_,res)=>res.json({groups,manage}));
 web.patch('/api/agent-mcp/catalog/access',(req,res)=>{writes.push(req.body);res.json({ok:true});});
 web.get('/api/agent-mcp/danger-rules',(_,res)=>res.json({categories:[],rules:[],manage:false}));
 web.get('/api/agent-mcp/tool-guides',(_,res)=>res.json({items:[],total:0,ready:0,stale:0,missing:0,manage:false}));
 web.get('/api/ai/models',(_,res)=>res.json({models:[]}));
 web.get('/api/desktop-agents/settings',(_,res)=>res.json({settings:{enabled:false}}));
 web.get(['/api/friend-links','/api/recent-nav','/api/custom-tools'],(_,res)=>res.json([]));
 web.use('/api',(_,res)=>res.json({items:[]}));web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s));});
 win=new BrowserWindow({show:false,width:1508,height:900,webPreferences:{backgroundThrottling:false}});
 await win.loadURL('http://127.0.0.1:'+server.address().port);
 await until('typeof openNavSettingsModal==="function"');await ev('openNavSettingsModal();switchNavSettingsTab("agentTools");void 0');
 await until('document.querySelectorAll(".nat-catalog .nat-table").length===3');
 async function check(){
  const g=await ev(`(()=>{const tables=[...document.querySelectorAll('.nat-catalog .nat-table')];return {
   columns:tables.map(t=>[...t.rows[0].cells].map(c=>Math.round(c.getBoundingClientRect().left-t.getBoundingClientRect().left))),
   labels:[...document.querySelectorAll('.nat-access')].map(n=>({h:n.getBoundingClientRect().height,scroll:n.scrollWidth,width:n.clientWidth})),
   overflow:navSettingsContent.scrollWidth-navSettingsContent.clientWidth,
   numbers:[...document.querySelectorAll('.nat-catalog th.nat-num')].map(n=>getComputedStyle(n).textAlign),
   wrappers:[...document.querySelectorAll('.nat-catalog .nat-table-wrap')].map(n=>({width:n.clientWidth,scroll:n.scrollWidth}))
  }})()`);
  assert.deepEqual(g.columns[0],g.columns[1]);assert.deepEqual(g.columns[1],g.columns[2]);
  assert.ok(g.labels.every(n=>n.h<=21&&n.scroll<=n.width+1),JSON.stringify(g.labels));
  assert.ok(g.overflow<=2,JSON.stringify(g));assert.ok(g.numbers.every(n=>n==='right'));
  return g;
 }
 await check();
 await ev(`document.querySelector('[data-access-id="search"]').click()`);await until('!!document.querySelector(".nat-notice")');
 assert.deepEqual(writes,[{scope:'tool',id:'search',enabled:false}]);
 assert.equal(await ev(`document.querySelector('[data-access-id="list_uiv_scripts_with_an_extremely_long_tool_identifier"]').disabled`),true);
 for(const language of ['zh-CN','en-US'])for(const theme of ['light','dark']){
  await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};window.ToolsI18n={getLanguage:()=>${JSON.stringify(language)}};ToolsAgentToolsSettings.render(navSettingsContent);void 0`);
  await until('document.querySelectorAll(".nat-catalog .nat-table").length===3');await check();
 }
 await ev(`document.documentElement.dataset.theme='light';document.documentElement.dataset.platformTheme='light';window.ToolsI18n={getLanguage:()=> 'zh-CN'};ToolsAgentToolsSettings.render(navSettingsContent);void 0`);
 await until('document.querySelectorAll(".nat-catalog .nat-table").length===3');
 await ev(`document.querySelector('.nat-catalog').scrollIntoView({block:'start'});void 0`);
 await wait(300);
 const screenshot=path.join(temp,'catalog-light.png');fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());console.log('Screenshot:',screenshot);
 for(const [width,height] of [[390,844],[768,640]]){win.setContentSize(width,height);await wait(100);const g=await check();assert.ok(g.wrappers.every(n=>n.scroll>n.width),'narrow tables scroll inside their cards');}
 manage=false;await ev('ToolsAgentToolsSettings.render(navSettingsContent);void 0');await until('!!document.querySelector(".nat-catalog.is-readonly")');
 assert.equal(await ev('document.querySelectorAll(".nat-access").length'),0);await check();
 console.log('PASS settings catalog: aligned columns, single-line access, numeric headers, permission action, English/Chinese, light/dark, narrow overflow and read-only view');
 clearTimeout(timeout);win.destroy();await new Promise(r=>server.close(r));app.exit(0);
}).catch(error=>{console.error(error);clearTimeout(timeout);win?.destroy();server?.close();app.exit(1);});
