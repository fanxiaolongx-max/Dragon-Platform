// Render current product components with synthetic responses; never opens production or user databases.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),express=require(process.env.TOOLS_PLATFORM_ROOT+'/node_modules/express');
const root=process.env.TOOLS_PLATFORM_ROOT, out=process.env.VIDEO_WORK_DIR;
app.setPath('userData',path.join(out,'capture-profile'));
let win,server;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const config={enabled:true,environment:'prod',gatewayUrl:'',channel:'demo-channel',toolVersion:'1.0.0',ak:'',sk:'',sdkPath:'',replyEngine:'dragon-claw',modelId:'',slashCommandsEnabled:true,access:{users:{mode:'whitelist',whitelist:['demo-user'],blacklist:[]},groups:{mode:'whitelist',whitelist:['demo-group'],blacklist:[]}},push:{defaultTargets:[],allowUserPush:false},followup:{enabled:true,calendar:{timezone:'Asia/Shanghai',weekdays:[1,2,3,4,5],workStart:'09:00',workEnd:'18:00'}}};
app.whenReady().then(async()=>{
 const web=express();
 web.get('/capture',(_,res)=>res.send(`<!doctype html><meta charset=utf-8><link rel=stylesheet href=/css/shared.css><style>body{margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#182d46}header{background:#172a44;color:white;padding:20px 32px;font-size:24px}main{margin:20px auto;width:1190px;background:white;border:1px solid #cdd6e2;border-radius:15px;padding:24px}#demo{font-size:14px} .nch{max-width:100%}</style><header>Dragon 工具平台　/　全局设置　/　频道对接</header><main id=demo></main><script src=/js/shared/channel-settings.js></script><script>ToolsChannelSettings.render(document.querySelector('#demo'));</script>`));
 web.get('/api/channels/welink/config',(_,res)=>res.json(config));
 web.get('/api/channels/welink/status',(_,res)=>res.json({enabled:true,connected:true,configured:true,sdk:{available:true,source:'builtin',version:'演示',packageDir:'平台内置 SDK'},runtime:{state:'ready'},summary:{users:1,groups:1,pushableUsers:0,pushableGroups:0},assistantInfo:{name:'运营助手 · 本地演示'}}));
 web.get('/api/channels/welink-cli/status',(_,res)=>res.json({config:{enabled:true,allowWrite:false,env:'prod',downloadDir:'办公附件目录',email:''},install:{available:true,version:'演示',entry:'welink-cli'},auth:{loggedIn:true,text:'演示账户已授权'}}));
 web.get('/api/ai/models',(_,res)=>res.json({items:[{id:'demo',name:'已配置模型'}]}));
 web.get('/api/digital-human/config',(_,res)=>res.json({config:{enabled:true,baseQueryUrl:'https://base.example/digital-human/api/dh/query',businessDatasourceName:'演示业务库',businessSchema:'netcare',appSchema:'demo_app',appUuid:'',appLevel:'',appName:'本地演示',timeoutSec:30,maxRows:50000},defaults:{}}));
 web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));
 web.get('/api/digital-human/tables',(_,res)=>res.json({live:true,schema:'netcare',fetchedAt:'2026-10-28T08:00:00Z',stats:{total:3,withData:2,empty:1,isNew:1,named:3,verified:1,missing:0},tables:[{name:'demo_risk_records',nameCn:'风险记录（示例）',category:'风险',module:'运营',grain:'明细',rows:5,columns:4,verified:true,exists:true},{name:'demo_region_dim',nameCn:'区域维表（示例）',category:'公共基础表',grain:'维表',rows:3,columns:2,exists:true},{name:'demo_new_tasks',nameCn:'新增任务（示例）',category:'任务',grain:'明细',rows:0,columns:4,isNew:true,exists:true}]}));
 web.get('/api/digital-human/tables/demo_risk_records',(_,res)=>res.json({scope:'business',schema:'netcare',name:'demo_risk_records',note:{nameCn:'风险记录（示例）',timeField:'report_date',regionField:'region',verified:true},columns:[['record_id','记录编号','', 'R-01'],['report_date','报告日期','time','2026-10-01'],['region','区域','region','示例区域 A'],['risk_level','风险等级','','高']].map(([name,comment,role,value])=>({name,comment,role,dataType:'varchar',columnType:'varchar(64)',sampleFilled:5,sampleTotal:5,kinds:['text'],sentinels:[],examples:[value]})),sample:[{record_id:'R-01',report_date:'2026-10-01',region:'示例区域 A',risk_level:'高'}],suggestions:{timeField:'report_date',regionField:'region'},hints:['本地合成示例：正式统计前请核对日期、区域与数据粒度。']}));
 web.get('/api/*',(_,res)=>res.json({items:[]}));
 web.use(express.static(path.join(root,'frontend')));
 server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s))});
 const base=`http://127.0.0.1:${server.address().port}`;
 win=new BrowserWindow({show:false,width:1400,height:1000,webPreferences:{nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 await win.loadURL(base+'/capture');await wait(1000);
 fs.mkdirSync(path.join(out,'ui'),{recursive:true});
 async function shot(name){await wait(150);fs.writeFileSync(path.join(out,'ui',name+'.png'),(await win.webContents.capturePage()).toPNG());console.log('Captured current product UI:',name)}
 await shot('welink-sdk');
 await win.webContents.executeJavaScript(`document.querySelector('[data-role="welink-cli"]')?.scrollIntoView()`);
 // CLI module shares the real channel settings stylesheet, but gets the entire viewport for readable capture.
 await win.webContents.executeJavaScript(`(async()=>{if(!window.ToolsWelinkCli){await new Promise(r=>{let s=document.createElement('script');s.src='/js/shared/welink-cli-settings.js';s.onload=r;document.head.append(s)})}document.querySelector('#demo').innerHTML='<section class="nch-card" id="cli"></section>';ToolsWelinkCli.render(document.querySelector('#cli'));window.scrollTo(0,0)})()`);
 await wait(350);await shot('welink-cli');
 await win.webContents.executeJavaScript(`(async()=>{await new Promise(r=>{let s=document.createElement('script');s.src='/js/shared/digital-human-settings.js';s.onload=r;document.head.append(s)});await ToolsDigitalHuman.render(document.querySelector('#demo'));window.scrollTo(0,0)})()`);
 await shot('digital-human');
 await win.loadURL(base+'/pages/netcare-explorer.html');await wait(400);await win.webContents.executeJavaScript(`document.querySelector('[data-nx-table="demo_risk_records"]').click()`);await wait(250);await win.webContents.executeJavaScript(`document.querySelector('[data-nx-tab="fields"]').click()`);await shot('netcare-explorer');
 const report=path.join(root,'docs/images/readme/shots/ai-report-cells.jpg');fs.copyFileSync(report,path.join(out,'ui/ai-monthly.jpg'));
}).catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{win?.destroy();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));app.exit(process.exitCode||0)});
