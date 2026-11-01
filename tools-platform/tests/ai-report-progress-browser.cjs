// Real page + streaming backend; all AI and tool results are isolated fixtures.
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ai-report-progress-'));
process.env.TOOLS_DATA_DIR=path.join(temp,'tools');process.env.TOOLS_REPORT_DATA_DIR=path.join(temp,'reports');app.setPath('userData',path.join(temp,'profile'));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
let modelGate=deferred(),toolGate=deferred(),toolMode='empty',win,server;
const long='完整返回内容'.repeat(6000);
require('../backend/models/ai-settings-repository').getRuntimeSettings=async()=>({hasApiKey:true,keyLooksValid:true});
require('../backend/models/ai-provider-client').createClient=()=>({generateChat:async({messages})=>{
    if(!messages.some(m=>m.role==='tool')){await modelGate.promise;return {text:'',toolCalls:[{id:'call-1',name:'list_sources',args:{month:'2026-10'}}]};}
    return {text:JSON.stringify({type:'answer',text:'已检查数据来源'}),toolCalls:[]};
}});
require('../backend/models/ai-report-data').listSources=async()=>{await toolGate.promise;if(toolMode==='error')throw Error('Fixture tool failed');return toolMode==='empty'?[]:[{name:'样本表',text:long,password:'fixture-private'}];};
const wait=ms=>new Promise(r=>setTimeout(r,ms)),ev=fn=>win.webContents.executeJavaScript(`(${fn.toString()})()`,true);
async function until(fn){for(let i=0;i<200;i++){if(await ev(fn))return;await wait(25);}throw Error('Timeout: '+fn);}
setTimeout(()=>{console.error('Progress fixture timeout');app.exit(1);},60000).unref();
app.whenReady().then(async()=>{
    const web=express();web.use(express.json({limit:'50mb'}));web.get('/js/shared/navbar.js',(_,res)=>res.type('js').send(''));
    web.use((req,_res,next)=>{req.user={username:'tester',role:'admin'};req.requestId='ui-fixture-request';next();});web.use('/api/ai-report',require('../backend/routes/ai-report'));web.use(express.static(path.join(__dirname,'../frontend')));
    server=await new Promise(r=>{const s=web.listen(0,'127.0.0.1',()=>r(s));});
    win=new BrowserWindow({show:false,width:1920,height:1080,webPreferences:{backgroundThrottling:false}});
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/pages/ai-report.html');
    await until(()=>!document.body.classList.contains('air-booting')&&!!document.querySelector('[data-ask]'));
    await until(()=>!document.getElementById('platformStartup'));
    await ev(()=>{const form=document.querySelector('[data-ask]');form.querySelector('textarea').value='有哪些数据';form.requestSubmit();});
    await until(()=>document.querySelector('[data-live-progress]')?.textContent.includes('等待模型响应'));
    assert.equal(await ev(()=>!!document.querySelector('[data-dev-export]')),false);
    win.webContents.invalidate();await wait(600);
    fs.writeFileSync(path.join(temp,'progress.png'),(await win.webContents.capturePage()).toPNG());
    modelGate.resolve();await until(()=>document.querySelector('[data-live-progress]')?.textContent.includes('读取导入表目录'));
    toolGate.resolve();await until(()=>!AiReportApp.state.busy.size);
    assert.equal(await ev(()=>AiReportTrace.list(AiReportApp.state.selected).length),0);
    await ev(()=>document.querySelector('[data-dev-toggle]').click());
    assert.equal(await ev(()=>!!document.querySelector('[data-dev-export]')),true);
    async function turn(mode){
        toolMode=mode;modelGate=deferred();toolGate=deferred();
        await ev(()=>{const form=document.querySelector('.air-chat-form');form.querySelector('textarea').value='再检查一次';form.requestSubmit();});
        await until(()=>document.querySelector('[data-live-progress]')?.textContent.includes('等待模型响应'));
        modelGate.resolve();await until(()=>document.querySelector('[data-live-progress]')?.textContent.includes('读取导入表目录'));
        // Expand a live call and preserve its expansion when tool results arrive.
        await ev(()=>{const last=[...document.querySelectorAll('.air-dev-entry')].at(-1);last.open=true;});
        await wait(30);toolGate.resolve();await until(()=>!AiReportApp.state.busy.size);
        assert.equal(await ev(()=>[...document.querySelectorAll('.air-dev-entry')].at(-1).open),true);
    }
    await turn('empty');
    assert.equal(await ev(()=>{const step=AiReportTrace.list(AiReportApp.state.selected).at(-1).steps.find(s=>s.kind==='tool');return step.status==='success'&&Array.isArray(step.result)&&!step.result.length;}),true);
    await turn('long');
    const full=await ev(()=>{const call=AiReportTrace.list(AiReportApp.state.selected).at(-1),tool=call.steps.find(s=>s.kind==='tool');return {length:tool.result[0].text.length,truncated:tool.modelTruncated,secret:tool.result[0].password,request:call.request.message,response:call.response.text,id:call.requestId};});
    assert.equal(full.length,long.length);assert.equal(full.truncated,true);assert.equal(full.secret,'[REDACTED]');assert.equal(full.request,'再检查一次');assert.equal(full.response,'已检查数据来源');assert.equal(full.id,'ui-fixture-request');
    await ev(()=>document.querySelectorAll('.air-dev-entry').forEach(entry=>{entry.open=true;entry.querySelectorAll('.air-dev-step').forEach(s=>{s.open=true;});}));
    assert.match(await ev(()=>document.querySelector('.air-dev').textContent),/请求参数[\s\S]*实际返回/);
    await wait(100);
    await ev(()=>{const entry=[...document.querySelectorAll('.air-dev-entry')].at(-1);entry.open=true;entry.querySelectorAll('.air-dev-step').forEach(s=>{s.open=true;});});
    await wait(100);
    fs.writeFileSync(path.join(temp,'call-log.png'),(await win.webContents.capturePage()).toPNG());
    const download=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{const target=path.join(temp,item.getFilename());item.setSavePath(target);item.once('done',(_e,status)=>status==='completed'?resolve(target):reject(Error(status)));}));
    await ev(()=>document.querySelector('[data-dev-export]').click());
    const log=JSON.parse(fs.readFileSync(await download,'utf8'));assert.equal(log.format,'aiops-report-diagnostics');assert.equal(log.entries.length,2);assert.doesNotMatch(JSON.stringify(log),/fixture-private/);assert.equal(log.context.month,await ev(()=>AiReportApp.state.doc.reportMonth));
    await turn('error');
    assert.equal(await ev(()=>AiReportTrace.list(AiReportApp.state.selected).at(-1).steps.some(s=>s.kind==='tool'&&s.status==='error'&&s.error==='Fixture tool failed')),true);
    await ev(()=>document.querySelector('[data-dev-toggle]').click());
    assert.equal(await ev(()=>!!document.querySelector('[data-dev-export]')),false);
    // English labels and a narrow Electron container.
    await ev(()=>document.querySelector('[data-air=language]').click());await ev(()=>document.querySelector('[data-dev-toggle]').click());
    assert.equal(await ev(()=>document.querySelector('[data-dev-export]').textContent),'Export log');
    win.setContentSize(390,844);await wait(100);
    assert.equal(await ev(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await ev(()=>{const r=document.querySelector('[data-dev-export]').getBoundingClientRect();return r.right<=innerWidth&&r.left>=0;}),true);
    await ev(()=>document.getElementById('airChat').scrollIntoView({block:'start'}));
    win.webContents.invalidate();await wait(150);fs.writeFileSync(path.join(temp,'narrow-en.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS: real live stages with logging off/on, empty/success/error tool records, full payloads, redaction, JSON download, expansion persistence, English and narrow screens. Preview: '+temp);
}).catch(async error=>{console.error(error);if(win)fs.writeFileSync(path.join(temp,'failure.png'),(await win.webContents.capturePage()).toPNG());process.exitCode=1;}).finally(async()=>{win?.destroy();if(server)await new Promise(r=>server.close(r));await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll();app.exit(process.exitCode||0);});
