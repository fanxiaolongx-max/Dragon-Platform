// node_modules/.bin/electron tests/incentive-blacklist-browser.cjs
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),express=require('express');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'incentive-blacklist-browser-'));
process.env.TOOLS_DATA_DIR=path.join(temp,'data');app.setPath('userData',path.join(temp,'profile'));app.on('window-all-closed',()=>{});
const root=path.join(__dirname,'..'),i18n=require('../backend/models/custom-tool-i18n-service');
let win,server;const errors=[];
const run=source=>win.webContents.executeJavaScript(source,true);
app.whenReady().then(async()=>{
  try{
    const web=express();web.use(express.json());
    const events={records:[
      {id:'e1',staffId:'00123456',date:'2026-09-12',status:'published',ruleSnapshot:{desc:'未按方案执行'},remark:'操作遗漏',personSnapshot:{name:'测试员工'}},
      {id:'e2',staffId:'00123456',date:'2026-08-12',status:'published',ruleSnapshot:{desc:'旧月份事件'}}
    ]};
    web.get('/api/department-reward-penalty/',(req,res)=>res.json(events));
    web.post('/api/meeting-snapshots/batch-attendance-check',(req,res)=>res.json({results:{}}));
    web.use('/js',express.static(path.join(root,'frontend/js')));
    web.get('/',(req,res)=>res.send(i18n.injectLanguageRuntime(fs.readFileSync(path.join(root,'backend/builtin-tools/tool-ms4xb66s/index.html'),'utf8'),'tool-ms4xb66s')));
    server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener))});
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message)});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await run(`window.exportsCaptured=[];window.alertsCaptured=[];XLSX.writeFile=(wb,name)=>{exportsCaptured.push({wb,name})};uiAlert=message=>alertsCaptured.push(message);showToast=()=>{};
      rawRows=[{task_status:'completed',complete_operator:'m00123456','当地开始时间':'2026-09-01 23:00',operate_level:'High'},
      {task_status:'completed',complete_operator:'m00123456','当地开始时间':'2026-09-01 23:05',operate_level:'Low'},
      {task_status:'completed',complete_operator:'m00123456','当地开始时间':'2026-10-01 23:00',operate_level:'Low'}];
      sourceWorksheet=XLSX.utils.json_to_sheet(rawRows);sourceSheetName='源数据';sourceFileName='fixture.xlsx';
      recalculate();$('topActions').classList.add('show');$('contentStage').classList.remove('locked');$('importGate').classList.add('gate-hidden');
      $('topBlacklistBtn').click();$('addBlacklistRowBtn').click();`);
    const months=await run(`[...document.querySelector('[data-field="month"]').options].map(x=>x.value)`);
    assert.deepEqual(months,['','2026-09','2026-10']);
    await run(`for(const [field,value] of Object.entries({staffId:'m00123456',name:'测试员工',reason:'人工核查',month:'2026-09'})){const input=document.querySelector('[data-field="'+field+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))} $('saveBlacklistBtn').click();`);
    assert.equal(await run(`Number($('sMoney').textContent)`),50);
    assert.match(await run(`$('blacklistDeductionTable').textContent`),/人工核查/);
    await run(`$('exportBtn').click()`);
    let exported=await run(`(()=>{const {wb}=exportsCaptured.at(-1),reread=XLSX.read(XLSX.write(wb,{type:'array',bookType:'xlsx'}),{type:'array'});return {rows:XLSX.utils.sheet_to_json(reread.Sheets['源数据']),deductions:XLSX.utils.sheet_to_json(reread.Sheets['黑名单扣减明细'])}})()`);
    assert.equal(exported.rows.length,3);assert.equal(exported.rows[0]['本行激励（元）'],0);assert.equal(exported.rows[0]['扣减原因'],'人工核查');
    assert.equal(exported.rows[2]['本行激励（元）'],50);assert.equal(exported.deductions[0]['扣减激励（元）'],280);
    await run(`$('topBlacklistBtn').click();$('downloadBlacklistTemplateBtn').click()`);
    assert.deepEqual(await run(`XLSX.utils.sheet_to_json(exportsCaptured.at(-1).wb.Sheets['填写说明'],{header:1}).slice(1,3)`),[['2026-09'],['2026-10']]);
    // Actual file input import; preserve ID text and reject a whole batch with an out-of-range month.
    await run(`(async()=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['工号','姓名','扣减月份','扣减原因'],['m00123456','测试员工','2026-10','模板原因']]),'黑名单');const file=new File([XLSX.write(wb,{type:'array',bookType:'xlsx'})],'blacklist.xlsx');await $('blacklistFileInput').onchange({target:{files:[file],value:'x'}})})()`);
    assert.equal(await run(`blacklistDraft.length`),2);
    await run(`$('saveBlacklistBtn').click();$('exportBtn').click()`);
    assert.equal(await run(`Number($('sMoney').textContent)`),0);
    assert.equal(await run(`XLSX.utils.sheet_to_json(exportsCaptured.at(-1).wb.Sheets['黑名单扣减明细']).length`),2,'All-blocked results still export');
    await run(`$('topBlacklistBtn').click();document.querySelector('[data-blacklist-remove="1"]').click();$('saveBlacklistBtn').click()`);
    assert.equal(await run(`Number($('sMoney').textContent)`),50,'Deleting an entry restores only its month');
    await run(`$('topBlacklistBtn').click();loadNegativeEvents()`);
    assert.equal(await run(`negativeEventCandidates.length`),1);
    assert.match(await run(`$('negativeEventsRows').textContent`),/2026-09-12.*2026-09.*未按方案执行；操作遗漏/);
    await run(`document.querySelector('[data-negative-index]').checked=true;$('addNegativeEventsBtn').click();$('saveBlacklistBtn').click()`);
    assert.equal(await run(`Number($('sMoney').textContent)`),50);
    await run(`$('topBlacklistBtn').click();loadNegativeEvents()`);
    await run(`document.querySelector('[data-negative-index]').checked=true;$('addNegativeEventsBtn').click()`);
    assert.equal(await run(`blacklistDraft.length`),2,'Reimporting an event does not duplicate it');
    // Template validation is atomic.
    assert.match(await run(`(()=>{try{importBlacklistRows([{'工号':'m00123456','扣减月份':'2026-08','扣减原因':'禁止跨月'}])}catch(e){return e.message}})()`),/本次导入月份/);
    assert.equal(await run(`blacklistDraft.length`),2);
    // Monthly attendance preview, selection and automatic unified blacklist management.
    await run(`restoreIncentiveSnapshot({title:'考勤月份核算',payload:{rawRows}});attendanceCheckVersion++;
      attendanceResults=new Map([['m00123456',{hasAnomaly:true,anomalies:[
        {snapshotId:'meeting-a',meetingTitle:'质量月度例会',sessionName:'九月场',actualDate:'2026-09-22',attendance:'Absent',type:'absent'},
        {snapshotId:'meeting-a',meetingTitle:'质量月度例会',sessionName:'十月场',actualDate:'2026-10-02',attendance:'Delay',type:'delay'},
        {snapshotId:'unknown',meetingTitle:'待补日期会议',attendance:'Absent',type:'absent'}
      ]}]]);updateAttendanceAnomalyAlert();$('attendanceAnomalyBtn').click();`);
    assert.deepEqual(await run(`currentAttendanceAnomalies.map(x=>({month:x.month,fee:x.totalFee,deductible:x.deductible}))`),[
      {month:'2026-09',fee:280,deductible:true},{month:'2026-10',fee:50,deductible:true},{month:'',fee:0,deductible:false}
    ]);
    assert.equal(await run(`document.querySelectorAll('.anomaly-row-cb:disabled').length`),1);
    await run(`document.querySelector('.anomaly-row-cb[data-idx="1"]').checked=false;updateAnomalySelectionSummary();$('confirmAddToBlacklistBtn').click()`);
    assert.equal(await run(`Number($('sMoney').textContent)`),50);
    assert.equal(await run(`$('blacklistModal').classList.contains('show')`),true);
    assert.equal(await run(`$('blacklistRows').querySelectorAll('tr').length`),1);
    assert.match(await run(`document.querySelector('[data-field="reason"]').value`),/2026-09-22《质量月度例会》【九月场】：缺席/);
    assert.deepEqual(await run(`[...document.querySelector('[data-field="month"]').options].map(o=>o.value)`),['','2026-09']);
    await run(`$('exportBtn').click()`);
    const attendanceExport=await run(`(()=>{const wb=exportsCaptured.at(-1).wb;return XLSX.utils.sheet_to_json(wb.Sheets['黑名单扣减明细'])})()`);
    assert.equal(attendanceExport[0]['扣减月份'],'2026-09');assert.equal(attendanceExport[0]['扣减激励（元）'],280);
    assert.match(attendanceExport[0]['扣减原因'],/2026-09-22.*质量月度例会.*九月场.*缺席/);
    const editorSize=await run(`(()=>{const modal=$('blacklistModal').querySelector('.rule-modal-card').getBoundingClientRect(),input=document.querySelector('[data-field="reason"]').getBoundingClientRect();return {wide:modal.width>=1300,tall:modal.height>=850,textareaHeight:input.height,textareaWidth:input.width}})()`);
    assert.equal(editorSize.wide,true);assert.equal(editorSize.tall,true);assert.ok(editorSize.textareaHeight>=90);assert.ok(editorSize.textareaWidth>=400);
    if(process.env.INCENTIVE_SCREENSHOT_PATH){await run(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);fs.writeFileSync(process.env.INCENTIVE_SCREENSHOT_PATH,(await win.webContents.capturePage()).toPNG())}
    // English and narrow-screen layout, using the same language event as the platform shell.
    await run(`window.dispatchEvent(new MessageEvent('message',{origin:location.origin,data:{type:'tools-platform-language',lang:'en-US'}}))`);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(await run(`$('importNegativeEventsBtn').textContent`),'Import from Negative Events');
    win.setSize(420,800);await new Promise(resolve=>setTimeout(resolve,100));
    const layout=await run(`(()=>{const modal=$('blacklistModal').querySelector('.rule-modal-card').getBoundingClientRect(),table=$('blacklistRows').closest('.table-wrap');return {modalInside:modal.left>=0&&modal.right<=innerWidth,scrolls:table.scrollWidth>table.clientWidth}})()`);
    assert.deepEqual(layout,{modalInside:true,scrolls:true});
    await run(`document.documentElement.dataset.theme='dark'`);
    assert.deepEqual(await run(`(()=>{const input=document.querySelector('[data-field="reason"]'),style=getComputedStyle(input);return {background:style.backgroundColor,color:style.color}})()`),{background:'rgb(24, 34, 48)',color:'rgb(228, 231, 236)'});
    await run(`document.documentElement.dataset.theme='light'`);
    assert.equal(await run(`getComputedStyle(document.querySelector('[data-field="reason"]')).backgroundColor`),'rgb(255, 255, 255)');
    assert.deepEqual(errors,[]);
    console.log('PASS: table CRUD, month limits, event preview/import, template file input, all-blocked XLSX export, monthly attendance deduction and reason export, enlarged editor, English, light/dark themes and narrow Electron layout');
  }catch(error){console.error(error);process.exitCode=1}
  finally{if(win)win.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0)}
});
