// Full page with scripted AI replies and isolated data; no real model or business database.
const {app,BrowserWindow}=require('electron'),express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'report-presentation-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));app.on('window-all-closed',()=>{});app.disableHardwareAcceleration();
let win,server,summaries=0,narratives=0,visual=false,layout=false,layoutCompiles=0;
const recipe={sources:[{id:'s1',kind:'metrics',names:['存量']}],compute:'function compute(input){return {total:input.s1.values["存量"]};}',render:'function render(result,kit){return kit.kpi([{label:"存量",value:result.total}]);}',narrative:null};
require('../backend/models/ai-settings-repository').getRuntimeSettings=async()=>({hasApiKey:true,keyLooksValid:true});
require('../backend/models/ai-provider-client').createClient=()=>({generateChat:async({systemInstruction:s})=>{
 let reply={conflict:false};
 if(s.includes('格子助手'))reply={type:'ready',text:'按这个格子的最新展示要求生成。'};
 else if(layout&&s.includes('把下面这段关于月报格子的对话'))reply={prompt:'取指标存量，表格和柱状图左右并排，左图60%、右表40%。\n【格子内部布局】chart 宽 100%；table 宽 100%。'};
 else if(layout&&s.includes('编译成一个可以每月重复运行的配方')){layoutCompiles++;reply={type:'recipe',recipe:{...recipe,render:'function render(r,kit){const chart={id:"chart",width:60,html:kit.chart({xAxis:{type:"category",data:["TE"]},yAxis:{type:"value"},series:[{type:"bar",data:[r.total]}]})},table={id:"table",width:40,html:kit.table([{name:"TE",value:r.total}],{columns:[{key:"name",label:"运营商"},{key:"value",label:"存量"}]})};return kit.layout('+(layoutCompiles===1?'[[chart],[table]]':'[[chart,table]]')+');}'}};}
 else if(s.includes('把下面这段关于月报格子的对话')){summaries++;reply={prompt:visual||summaries===1?'取指标存量。指标卡展示：显示存量。':'取指标存量，按报告月份计算，仅显示一句话总结。'};}
 else if(s.includes('编译成一个可以每月重复运行的配方'))reply={type:'recipe',recipe};
 else if(s.includes('为月报格子写总结')){narratives++;reply={zh:narratives===1?'当前存量 894 个。需要关注存量。':'当前存量 894 个。',en:narratives===1?'The total is 894. Monitor the total.':'The total is 894.'};}
 return {text:JSON.stringify(reply),toolCalls:[]};
}});
const data=require('../backend/models/ai-report-data');data.unknownSources=async()=>[];data.recipeInput=async()=>({input:{s1:{values:{'存量':894}}},missing:[]});
const wait=ms=>new Promise(r=>setTimeout(r,ms)),ev=code=>win.webContents.executeJavaScript(code,true);
async function until(code){for(let i=0;i<300;i++){if(await ev(code))return;await wait(20);}throw Error('Timeout '+code);}
app.whenReady().then(async()=>{
 const web=express();web.use(express.json());web.get('/js/shared/navbar.js',(_q,r)=>r.type('js').send(''));web.use((q,_r,n)=>{q.user={username:'fixture',role:'admin'};n();});web.use('/api/ai-report',require('../backend/routes/ai-report'));web.use(express.static(path.join(__dirname,'../frontend')));
 server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s));});win=new BrowserWindow({show:false,width:1920,height:1080,webPreferences:{backgroundThrottling:false}});await win.loadURL('http://127.0.0.1:'+server.address().port+'/pages/ai-report.html');
 await until('window.AiReportApp?.state.doc&&!document.body.classList.contains("air-booting")');
 await ev(`(()=>{const form=document.querySelector('[data-ask]');form.querySelector('textarea').value='只呈现一句话，不需要图表和指标卡';form.requestSubmit();})()`);
 await until('!AiReportApp.state.busy.size&&!!document.querySelector(".air-narrative")');
 assert.equal(summaries,2,'stale card instruction was corrected');assert.equal(narratives,2,'two-sentence response was corrected');
 assert.equal(await ev('document.querySelectorAll(".air-output .kit-kpi,.air-output table,.air-output canvas").length'),0);
 assert.equal(await ev('document.querySelector(".air-narrative").textContent'),'当前存量 894 个。');
 assert.equal(await ev('AiReportApp.state.doc.chapters[0].cells[0].output.result.total'),894);
 win.webContents.invalidate();await wait(150);fs.writeFileSync(path.join(temp,'text-only.png'),(await win.webContents.capturePage()).toPNG());
 visual=true;await ev(`(()=>{const form=document.querySelector('.air-chat-form');form.querySelector('textarea').value='改成指标卡，显示存量';form.requestSubmit();})()`);
 await until('!AiReportApp.state.busy.size&&!!document.querySelector(".air-output .kit-kpi")');
 assert.equal(await ev('!!document.querySelector(".air-narrative")'),false);assert.equal(await ev('AiReportApp.state.doc.chapters[0].cells[0].output.result.total'),894);
 layout=true;
 await ev(`(()=>{const cell=AiReportApp.state.doc.chapters[0].cells[0];cell.layout={chart:{width:100,height:138},table:{width:100}};cell.prompt+='\\n【格子内部布局】chart 宽 100%、高 138px；table 宽 100%。';const form=document.querySelector('.air-chat-form');form.querySelector('textarea').value='表格和柱状图左右分布';form.requestSubmit();})()`);
 await until('!AiReportApp.state.busy.size&&!!document.querySelector(".kit-row .kit-widget-chart")');
 assert.equal(layoutCompiles,2,'vertical recipe must be retried');
 assert.deepEqual(await ev('AiReportApp.state.doc.chapters[0].cells[0].layout'),{});
 assert.doesNotMatch(await ev('AiReportApp.state.doc.chapters[0].cells[0].prompt'),/【格子内部布局】/);
 assert.equal(await ev(`(()=>{const chart=document.querySelector('[data-slot="chart"]'),table=document.querySelector('[data-slot="table"]');return chart.parentElement===table.parentElement&&Math.abs(chart.getBoundingClientRect().top-table.getBoundingClientRect().top)<2;})()`),true);
 // An explicit horizontal row reports overflow without silently wrapping; defaults still wrap.
 assert.deepEqual(await ev(`(()=>{const cell=document.querySelector('[data-cell]'),output=cell.querySelector('.air-output'),table=output.querySelector('table'),row=table.closest('.kit-row');table.style.minWidth='900px';AiReportLayout.fitRows(document.querySelector('#airReport'));const explicit={wrapped:row.classList.contains('is-wrapped'),issue:!!cell.dataset.layoutIssue};output.removeAttribute('data-horizontal');AiReportLayout.fitRows(document.querySelector('#airReport'));return {explicit,defaultWrapped:row.classList.contains('is-wrapped')};})()`),{explicit:{wrapped:false,issue:true},defaultWrapped:true});
 console.log('PASS: presentation constraints, layout revision clears old sizes, vertical recipe retry, horizontal overflow check, and default wrapping. Preview: '+temp);
}).catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(r=>server.close(r));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
