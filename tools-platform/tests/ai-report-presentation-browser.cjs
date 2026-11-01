// Full page with scripted AI replies and isolated data; no real model or business database.
const {app,BrowserWindow}=require('electron'),express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'report-presentation-'));process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));app.on('window-all-closed',()=>{});app.disableHardwareAcceleration();
let win,server,summaries=0,narratives=0,visual=false;
const recipe={sources:[{id:'s1',kind:'metrics',names:['存量']}],compute:'function compute(input){return {total:input.s1.values["存量"]};}',render:'function render(result,kit){return kit.kpi([{label:"存量",value:result.total}]);}',narrative:null};
require('../backend/models/ai-settings-repository').getRuntimeSettings=async()=>({hasApiKey:true,keyLooksValid:true});
require('../backend/models/ai-provider-client').createClient=()=>({generateChat:async({systemInstruction:s})=>{
 let reply={conflict:false};
 if(s.includes('格子助手'))reply={type:'ready',text:'按这个格子的最新展示要求生成。'};
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
 console.log('PASS: stale prompt correction, data-preserving text-only output, one-sentence validation, and restoring KPI presentation. Preview: '+temp);
}).catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(r=>server.close(r));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
