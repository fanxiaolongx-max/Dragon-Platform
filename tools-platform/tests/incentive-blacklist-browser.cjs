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
    web.use('/css',express.static(path.join(root,'frontend/css')));
    web.get('/',(req,res)=>res.send(i18n.injectLanguageRuntime(fs.readFileSync(path.join(root,'backend/builtin-tools/tool-ms4xb66s/index.html'),'utf8'),'tool-ms4xb66s')));
    server=await new Promise(resolve=>{const listener=web.listen(0,'127.0.0.1',()=>resolve(listener))});
    win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message)});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    await run(`endTour();window.exportsCaptured=[];window.alertsCaptured=[];window.downloadBlobs=[];XLSX.writeFile=(wb,name)=>exportsCaptured.push({wb,name});uiAlert=message=>alertsCaptured.push(message);showToast=()=>{};
      const createURL=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{downloadBlobs.push(blob);return createURL(blob)};HTMLAnchorElement.prototype.click=function(){};
      rawRows=[['A100','2026-07-01','High'],['A100','2026-08-01','Medium'],['A100','2026-09-01','Fatal'],['A200','2026-09-01','High'],['A300','2026-07-01','Low'],['A300','2026-08-01','Low'],['A300','2026-09-01','Low']].map(([id,date,level])=>({task_status:'completed',complete_operator:id,'当地开始时间':date+' 23:00',operate_level:level}));
      sourceWorksheet=XLSX.utils.json_to_sheet(rawRows);sourceSheetName='源数据';sourceFileName='fixture.xlsx';
      resetAllFiltersForNewFile();recalculate();$('topActions').classList.add('show');$('contentStage').classList.remove('locked');$('importGate').classList.add('gate-hidden');
      $('topBlacklistBtn').click();$('addBlacklistRowBtn').click();`);
    assert.equal(await run(`document.querySelector('[data-field="month"]')===null`),true);
    await run(`$('downloadBlacklistTemplateBtn').click()`);
    assert.deepEqual(await run(`XLSX.utils.sheet_to_json(exportsCaptured.at(-1).wb.Sheets['黑名单'],{header:1})[0]`),['工号','姓名','扣减原因','来源']);
    // Actual Excel file import without a deduction month, keeping employee IDs as text.
    await run(`(async()=>{blacklistDraft=[];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['工号','姓名','扣减原因'],['00123456','测试人员','重复异常']]),'黑名单');const file=new File([XLSX.write(wb,{type:'array',bookType:'xlsx'})],'blacklist.xlsx');await $('blacklistFileInput').onchange({target:{files:[file],value:'x'}})})()`);
    assert.deepEqual(await run(`blacklistDraft.map(x=>({id:x.staffId,scope:x.scope,month:x.month}))`),[{id:'00123456',scope:'person',month:''}]);
    await run(`$('closeBlacklistModal').click();blacklistDraft=[];
      attendanceResults=new Map([
        ['a100',{hasAnomaly:true,anomalies:[{actualDate:'2026-07-10',attendance:'Delay',title:'来源文件名.xlsx'},{actualDate:'2026-09-10',attendance:'Fake',title:'不应导出的文件名.xlsx'},{actualDate:'2026-07-20',attendance:'Absent'}]}],
        ['a200',{hasAnomaly:true,anomalies:[{actualDate:'2026-09-10',attendance:'Fake'},{actualDate:'2026-09-20',attendance:'Absent'},{actualDate:'2026-06-10',attendance:'Delay'},{attendance:'Absent'}]}],
        ['a300',{hasAnomaly:true,anomalies:['07','08','09'].map(month=>({actualDate:'2026-'+month+'-10',attendance:'Absent'}))}]
      ]);render();$('attendanceAnomalyBtn').click();`);
    assert.deepEqual(await run(`currentAttendanceAnomalies.map(x=>({id:x.staffId,months:x.months.length,fee:x.totalFee}))`),[{id:'A100',months:2,fee:353},{id:'A300',months:3,fee:50}]);
    assert.equal(await run(`document.querySelectorAll('.anomaly-row-cb').length`),2);
    assert.equal(await run(`getPersonAttendanceAnomaly('A200','')===null`),true);
    assert.match(await run(`$('attendanceAnomalyTableBody').textContent`),/虚假考勤/);
    assert.doesNotMatch(await run(`$('attendanceAnomalyTableBody').textContent`),/文件名|xlsx/);
    assert.equal(await run(`Number(getComputedStyle(document.querySelector('.anomaly-chip.false-attendance')).fontWeight)>=700`),true);
    // Read the actual generated .xlsx through ExcelJS, including persisted font styles.
    await run(`exportAttendanceAnomalyExcel()`);
    const attendance=await run(`(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(await downloadBlobs.at(-1).arrayBuffer());return wb.worksheets.map(ws=>{const rows=[];ws.eachRow((row,n)=>{if(n>1)rows.push({values:row.values.slice(1),bold:row.getCell(ws.columnCount).font?.bold||false})});return {name:ws.name,rows}})})()`);
    assert.equal(attendance[0].rows.length,2);
    assert.equal(attendance[0].rows[0].bold,true);
    assert.ok(attendance[1].rows.some(row=>row.values.at(-1).includes('虚假考勤')&&row.bold));
    assert.doesNotMatch(JSON.stringify(attendance),/文件名|xlsx/);
    await run(`window.dispatchEvent(new MessageEvent('message',{origin:location.origin,data:{type:'tools-platform-language',lang:'en-US'}}))`);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.match(await run(`$('attendanceAnomalyTableBody').textContent`),/False attendance/);
    await run(`exportAttendanceAnomalyExcel()`);
    const english=await run(`(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(await downloadBlobs.at(-1).arrayBuffer());const rows=[];wb.worksheets[0].eachRow((r,n)=>rows.push({values:r.values.slice(1),bold:r.getCell(8).font?.bold||false}));return {name:wb.worksheets[0].name,rows}})()`);
    assert.equal(english.name,'Attendance_Summary');assert.match(JSON.stringify(english),/False attendance/);assert.equal(english.rows[1].bold,true);
    assert.doesNotMatch(JSON.stringify(english),/[\u3400-\u9fff]/);
    await run(`window.dispatchEvent(new MessageEvent('message',{origin:location.origin,data:{type:'tools-platform-language',lang:'zh-CN'}}))`);
    await new Promise(resolve=>setTimeout(resolve,100));
    await run(`$('confirmAddToBlacklistBtn').click()`);
    assert.equal(await run(`incentiveBlacklist.size`),2);
    assert.equal(await run(`Number($('sMoney').textContent.replaceAll(',',''))`),1087);
    assert.equal(await run(`currentAttendanceAnomalies.length`),0);
    assert.equal(await run(`document.querySelector('[data-field="month"]')===null`),true);
    assert.match(await run(`$('blacklistRows').textContent`),/虚假考勤/);
    await run(`$('closeBlacklistModal').click();exportCurrent()`);
    const results=await run(`(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(await downloadBlobs.at(-1).arrayBuffer());return ['人员周期汇总','人员季度汇总'].map(name=>{const ws=wb.getWorksheet(name),headers=ws.getRow(1).values.slice(1),amountCol=headers.indexOf('扣减后激励（元）')+1,reasonCol=headers.indexOf('扣除原因')+1;let total=0,fakeBold=0;ws.eachRow((r,n)=>{if(n>1){total+=r.getCell(amountCol).value||0;if(String(r.getCell(reasonCol).value).includes('虚假考勤')&&r.getCell(reasonCol).font?.bold)fakeBold++}});return {headers,total,fakeBold}})})()`);
    assert.equal(results[0].total,1087);assert.equal(results[1].total,1087);assert.ok(results.every(x=>x.fakeBold>0));assert.deepEqual(results[0].headers,results[1].headers);
    await run(`exportCurrent(true)`);
    const englishResults=await run(`(async()=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(await downloadBlobs.at(-1).arrayBuffer());const ws=wb.getWorksheet('Personnel_Quarterly'),headers=ws.getRow(1).values.slice(1),col=headers.indexOf('Deduction Reason')+1;const reason=ws.getRow(2).getCell(col);return {text:reason.value,bold:reason.font?.bold}})()`);
    assert.match(englishResults.text,/False attendance/);assert.equal(englishResults.bold,true);assert.doesNotMatch(englishResults.text,/[\u3400-\u9fff]/);
    // Repeated reasons do not repeat the average deduction; switching off takes effect immediately.
    await run(`incentiveBlacklist=blacklistMap([...incentiveBlacklist.values(),{staffId:'A100',scope:'person',reason:'另一条原因'}]);applyPaymentRules()`);
    assert.equal(await run(`Number($('sMoney').textContent.replaceAll(',',''))`),1087);
    await run(`$('deductionMode').value='full';$('deductionMode').onchange()`);
    assert.equal(await run(`Number($('sMoney').textContent)`),280);
    await run(`$('deductionMode').value='average';$('deductionMode').onchange();$('blacklistMode').value='disabled';$('blacklistMode').onchange()`);
    assert.equal(await run(`Number($('sMoney').textContent.replaceAll(',',''))`),1490);
    // Narrow Electron viewport keeps both table views scrollable.
    win.setSize(420,800);await new Promise(resolve=>setTimeout(resolve,100));
    await run(`document.querySelector('[data-view="personQuarter"]').click()`);
    assert.equal(await run(`$('tableWrap').scrollWidth>$('tableWrap').clientWidth`),true);
    assert.deepEqual(errors,[]);assert.deepEqual(await run(`alertsCaptured`),[]);
    console.log('PASS: month-free blacklist import, two/three-month eligibility, single-month exclusion, unique-person average deduction, concise bilingual reasons, bold false-attendance UI and actual XLSX fonts, monthly/quarterly totals, immediate toggle, narrow Electron layout');
  }catch(error){console.error(error);process.exitCode=1}
  finally{if(win)win.destroy();if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0)}
});
