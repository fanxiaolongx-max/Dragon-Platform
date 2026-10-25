const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-ms4xb66s', 'index.html'),
    'utf8'
);
const toolScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function createToolRuntime(savedRules = null) {
    const elements = new Map();
    function element(id) {
        if (elements.has(id)) return elements.get(id);
        const classes = new Set();
        const value = {
            id,
            value: '',
            checked: false,
            disabled: false,
            hidden: false,
            innerHTML: '',
            textContent: '',
            style: {},
            dataset: {},
            classList: {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
                contains: name => classes.has(name)
            },
            addEventListener() {},
            appendChild() {},
            remove() {},
            setAttribute() {},
            scrollIntoView() {},
            getBoundingClientRect() { return { width: 100, height: 40, left: 0, top: 0, bottom: 40 }; },
            getContext() { return {}; }
        };
        elements.set(id, value);
        return value;
    }

    const storage = new Map();
    if (savedRules) storage.set('nightAllowanceRulesV1', JSON.stringify(savedRules));
    const document = {
        getElementById: element,
        createElement: () => element('created'),
        querySelectorAll() { return []; },
        querySelector() { return null; },
        body: { classList: element('body').classList }
    };
    const context = {
        console,
        document,
        alert() {},
        requestAnimationFrame() {},
        setTimeout() {},
        clearTimeout() {},
        structuredClone,
        innerWidth: 1200,
        innerHeight: 800,
        localStorage: {
            getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value),
            removeItem: key => storage.delete(key)
        },
        window: { XLSX: null, devicePixelRatio: 1, addEventListener() {}, scrollTo() {} }
    };
    vm.createContext(context);
    vm.runInContext(toolScript, context);
    return { context, element, storage };
}

function evaluate(runtime, source) {
    return JSON.parse(JSON.stringify(vm.runInContext(source, runtime.context)));
}

test('incentive defaults use the revised amounts and all-day operation scope', () => {
    assert.match(page, /feeLow:50,feeMedium:180,feeHigh:280,feeFatal:600/);
    assert.match(page, /nightOnly:false,verifyMode:'time'/);
    assert.match(page, /id="nightOnly" type="checkbox"/);
    assert.match(page, /操作时间：全天/);
    assert.match(page, /if\(enabled&&fillNightRange\)\{\$\('nightStart'\)\.value='22:00';\$\('nightEnd'\)\.value='06:00'/);
    assert.match(page, /if\(nightOnly\)nightOk=/);
});

test('operator rows are split into WX and non-WX scopes with non-WX selected by default', () => {
    assert.match(page, /activeOperatorGroup='nonwx'/);
    assert.match(page, /function operatorGroup\(person\)\{return clean\(person\)\.toLowerCase\(\)\.includes\('wx'\)\?'wx':'nonwx'\}/);
    assert.match(page, /data-operator-group="nonwx"[^>]*>非 WX 操作人/);
    assert.match(page, /data-operator-group="wx"[^>]*>WX 操作人/);
    assert.match(page, /const groupRows=validRows\.filter\(operatorMatchesGroup\)/);
    assert.match(page, /return operatorMatchesGroup\(r\)&&inQuick/);
    assert.match(page, /activeOperatorGroup==='wx'\?'WX':'非WX'/);
});

test('attendance warning and processing list follow the current incentive filters and rule modes', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
        validRows = [
          {__person:'A100',__name:'甲',__bu:'NIS',__customer:'ET',__attr:'FME',__level:'High',__fee:280,__rank:3,__date:'2026-09-02',__start:new Date(2026,8,2),__operatorGroup:'nonwx'},
          {__person:'A100',__name:'甲',__bu:'NIS',__customer:'ET',__attr:'FME',__level:'Low',__fee:50,__rank:1,__date:'2026-09-02',__start:new Date(2026,8,2),__operatorGroup:'nonwx'},
          {__person:'A200',__name:'乙',__bu:'Wireless',__customer:'Orange',__attr:'TE',__level:'Low',__fee:50,__rank:1,__date:'2026-08-02',__start:new Date(2026,7,2),__operatorGroup:'nonwx'},
          {__person:'WX300',__name:'丙',__bu:'NIS',__customer:'ET',__attr:'FME',__level:'High',__fee:280,__rank:3,__date:'2026-09-02',__start:new Date(2026,8,2),__operatorGroup:'wx'}
        ];
        rawRows=validRows.map(r=>({complete_operator:r.__person,'当地开始时间':r.__date+' 23:00'}));
        attendanceResults = new Map(['a100','a200','wx300'].map(id=>[id,{hasAnomaly:true,anomalies:[{type:'absent',attendance:'Absent',actualDate:id==='a200'?'2026-08-10':'2026-09-10'}]}]));
        $('periodSourceMode').value='start';
        $('filterMonth').value='09';
        $('filterBU').value='NIS';
        updateAttendanceAnomalyAlert();
        const narrowed = currentAttendanceAnomalies.map(a=>({id:a.staffId,fee:a.totalFee,orders:a.orderCount}));
        $('dedupMode').value='none';
        updateAttendanceAnomalyAlert();
        const noDedup = currentAttendanceAnomalies.map(a=>({id:a.staffId,fee:a.totalFee,orders:a.orderCount}));
        activeOperatorGroup='wx';
        updateAttendanceAnomalyAlert();
        const wx = currentAttendanceAnomalies.map(a=>a.staffId);
        $('filterPerson').value='no match';
        updateAttendanceAnomalyAlert();
        ({narrowed,noDedup,wx,hidden:$('attendanceAnomalyAlert').hidden});
    `);
    assert.deepEqual(result, {
        narrowed: [{ id: 'A100', fee: 280, orders: 1 }],
        noDedup: [{ id: 'A100', fee: 330, orders: 2 }],
        wx: ['WX300'],
        hidden: true
    });
});

test('nighttime calculation rejects daytime rows when one endpoint is missing', () => {
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [
        { task_status: 'completed', complete_operator: 'A100', '当地开始时间': '2026-09-01 10:00', operate_level: 'Low' },
        { task_status: 'completed', complete_operator: 'WX100', '当地开始时间': '2026-09-01 23:00', operate_level: 'Medium' }
    ];
    const result = evaluate(runtime, `
        $('nightOnly').checked=true;
        rawRows=fixtureRows;
        recalculate();
        ({valid:validRows.map(r=>r.__person),excluded:excludedRows.map(r=>r.__person)});
    `);
    assert.deepEqual(result, { valid: ['WX100'], excluded: ['A100'] });
});

test('operator identification falls back from an empty preferred field', () => {
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [{
        task_status: 'completed',
        complete_operator: '',
        '方案实施人工号': 'WX900',
        '当地开始时间': '2026-09-01 10:00',
        operate_level: 'High'
    }];
    const result = evaluate(runtime, `
        rawRows=fixtureRows;
        recalculate();
        activeOperatorGroup='wx';
        ({person:validRows[0].__person,group:validRows[0].__operatorGroup,count:filtered().length});
    `);
    assert.deepEqual(result, { person: 'WX900', group: 'wx', count: 1 });
});

test('legacy saved rules retain custom amounts and preserve their nighttime behavior', () => {
    const runtime = createToolRuntime({
        feeLow: 111,
        feeMedium: 222,
        feeHigh: 333,
        feeFatal: 444,
        nightStart: '21:00',
        nightEnd: '05:00',
        verifyMode: 'time',
        personField: 'complete_operator'
    });
    const values = evaluate(runtime, `({rules:getRuleValues(),saved:JSON.parse(localStorage.getItem(RULE_STORAGE_KEY))})`);
    assert.deepEqual(values.rules, {
        rulesVersion: 2,
        feeLow: 111,
        feeMedium: 222,
        feeHigh: 333,
        feeFatal: 444,
        nightStart: '21:00',
        nightEnd: '05:00',
        nightOnly: true,
        verifyMode: 'time',
        personField: 'complete_operator'
    });
    assert.equal(values.saved.rulesVersion, 2);
    assert.equal(values.saved.nightOnly, true);
});

test('legacy default amounts migrate to the revised defaults', () => {
    const runtime = createToolRuntime({
        feeLow: 100,
        feeMedium: 200,
        feeHigh: 300,
        feeFatal: 400,
        nightStart: '22:00',
        nightEnd: '06:00',
        verifyMode: 'warn',
        personField: 'complete_operator'
    });
    const values = evaluate(runtime, 'getRuleValues()');
    assert.deepEqual(
        [values.feeLow, values.feeMedium, values.feeHigh, values.feeFatal],
        [50, 180, 280, 600]
    );
    assert.equal(values.nightOnly, true);
});

test('WeLink script includes every imported WX and non-WX ID once, login check, result file and summary', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[{complete_operator:'00197735'},{complete_operator:'WX100'},{complete_operator:'00197735'}];
      const script=buildWelinkScript(allImportedPeople());
      ({ids:allImportedPeople(),script});
    `);
    assert.deepEqual(result.ids, ['00197735', 'WX100']);
    assert.match(result.script, /welink-cli auth login/);
    assert.match(result.script, /welink-cli auth status/);
    assert.match(result.script, /User Token:\\s\*valid/);
    assert.match(result.script, /welink-cli search person --text "00197735"/);
    assert.match(result.script, /welink-cli search person --text "WX100"/);
    assert.match(result.script, /Invoke-Item -LiteralPath \$outputFile/);
    assert.match(result.script, /完成：成功查询/);
});

test('WeLink output joins by query or returned employee number and nonpayment rules cover both groups', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      const output='welink-cli search person --text "00197735"\\n'+JSON.stringify({data:[{employeeNumber:'00197735',deptName:'Finance'}]})+'\\nwelink-cli search person --text "WX100"\\n'+JSON.stringify({search_cli_person:{data:[{employeeNumber:'WX100',deptName:'Finance'}]}});
      installWelinkPeople(parseWelinkPeople(output));
      rawRows=[
        {task_status:'completed',complete_operator:'00197735','当地开始时间':'2026-09-01 23:00',operate_level:'High',BU1:'NIS'},
        {task_status:'completed',complete_operator:'WX100','当地开始时间':'2026-09-01 23:00',operate_level:'Low',BU1:'NIS'}
      ];
      nonpaymentRules=[{field:'welink:deptName',mode:'equals',value:'Finance'}];
      recalculate();
      ({parsed:parseWelinkPeople(output).length,matched:allImportedPeople().map(personFieldValue),hits:ruleHitPeople(nonpaymentRules[0]).map(r=>r.__person),paid:dedupRows.length,details:calcDetailRows.map(r=>r.__ignoreReason)});
    `);
    assert.deepEqual(result.parsed, 2);
    assert.deepEqual(result.matched, ['Finance', 'Finance']);
    assert.deepEqual(result.hits, ['00197735', 'WX100']);
    assert.equal(result.paid, 0);
    assert.ok(result.details.every(reason => reason.includes('不发放规则')));
});

test('queried employee ID wins when WeLink returns a changed or colliding employee number', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      const output='welink-cli search person --text "OLD100"\\n'+JSON.stringify({data:[{employeeNumber:'NEW200',deptName:'Original person'}]})+'\\nwelink-cli search person --text "NEW200"\\n'+JSON.stringify({data:[{employeeNumber:'NEW300',deptName:'Other person'}]});
      installWelinkPeople(parseWelinkPeople(output));
      ({old:welinkFor('OLD100')?.deptName,newId:welinkFor('NEW200')?.deptName,returned:welinkFor('NEW300')?.deptName});
    `);
    assert.deepEqual(result, { old: 'Original person', newId: 'Other person', returned: 'Other person' });
});

test('changed employee ID badge appears in personnel tables only for a changed queried ID', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      installWelinkPeople([
        {__queryEmpNo:'OLD100',employeeNumber:'NEW200',deptName:'Finance'},
        {__queryEmpNo:'KEEP300',employeeNumber:'KEEP300',deptName:'Operations'}
      ],false);
      rawRows=[
        {task_status:'completed',complete_operator:'OLD100','当地开始时间':'2026-09-01 23:00',operate_level:'High'},
        {task_status:'completed',complete_operator:'KEEP300','当地开始时间':'2026-09-01 23:00',operate_level:'Low'}
      ];
      recalculate();
      currentView='person';render();
      const personnel=$('tableWrap').innerHTML;
      currentView='detail';render();
      ({old:changedEmployeeId('OLD100'),returned:changedEmployeeId('NEW200'),same:changedEmployeeId('KEEP300'),personnel,detail:$('tableWrap').innerHTML});
    `);
    assert.equal(result.old, 'NEW200');
    assert.equal(result.returned, '');
    assert.equal(result.same, '');
    assert.match(result.personnel, /OLD100.*工号有变更/);
    assert.match(result.personnel, /查询工号：OLD100；WeLink 返回工号：NEW200/);
    assert.match(result.detail, /OLD100.*工号有变更/);
    assert.equal((result.personnel.match(/工号有变更/g) || []).length, 1);
});

test('one name initial before a numeric or WX ID does not count as an employee ID change', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      installWelinkPeople([
        {__queryEmpNo:'a00824176',employeeNumber:'00824176',deptName:'Finance'},
        {__queryEmpNo:'mWX1459632',employeeNumber:'WX1459632',deptName:'Operations'},
        {__queryEmpNo:'a00824177',employeeNumber:'00824178',deptName:'Finance'},
        {__queryEmpNo:'aa00824176',employeeNumber:'00824176',deptName:'Finance'}
      ],false);
      ({numeric:changedEmployeeId('a00824176'),wx:changedEmployeeId('mWX1459632'),actualChange:changedEmployeeId('a00824177'),doublePrefix:changedEmployeeId('aa00824176')});
    `);
    assert.deepEqual(result, { numeric: '', wx: '', actualChange: '00824178', doublePrefix: '00824176' });
});

test('successful empty WeLink search is marked as suspected departure and can be reviewed', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      const empty={search_cli_person:{code:'200',data:[],l1Department:[],message:'success',pagination:null},'verify-sign':{code:'200',message:'verify success!'}};
      const failed={search_cli_person:{code:'500',data:[],message:'server error'}};
      const output='welink-cli search person --text "OLD100"\\n'+JSON.stringify(empty)+'\\nwelink-cli search person --text "BAD200"\\n'+JSON.stringify(failed);
      const people=parseWelinkPeople(output);
      installWelinkPeople(people,false);
      rawRows=[{task_status:'completed',complete_operator:'OLD100','当地开始时间':'2026-09-01 23:00',operate_level:'High'}];
      recalculate();
      currentView='person';render();
      const renderedTable=$('tableWrap').innerHTML;
      showSuspectedDepartedDetails();
      ({people,department:personFieldValue('OLD100'),count:suspectedDepartedPeople().length,label:$('welinkDepartedCount').textContent,table:renderedTable,details:$('welinkDepartedTable').innerHTML});
    `);
    assert.equal(result.people.length, 1);
    assert.equal(result.people[0].__queryEmpNo, 'OLD100');
    assert.equal(result.department, '疑似已离职');
    assert.equal(result.count, 1);
    assert.equal(result.label, '疑似已离职：1 人');
    assert.match(result.table, /possible-departed-value[^>]*>疑似已离职/);
    assert.match(result.details, /OLD100/);
    assert.doesNotMatch(result.details, /BAD200/);
});

test('a later populated response clears a suspected departure for the same queried ID', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      installWelinkPeople([
        {__queryEmpNo:'A100',__suspectedDeparted:true,deptName:'疑似已离职'},
        {__queryEmpNo:'A100',employeeNumber:'A100',deptName:'Finance'}
      ],false);
      ({department:personFieldValue('A100'),suspected:suspectedDepartedPeople().length});
    `);
    assert.deepEqual(result, { department: 'Finance', suspected: 0 });
});

test('single pasted empty JSON uses an explicitly entered query ID', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      const empty=JSON.stringify({search_cli_person:{code:'200',data:[],message:'success'}});
      ({without:parseWelinkPeople(empty).length,withId:parseWelinkPeople(empty,'00197735'),ambiguous:parseWelinkPeople(empty+'\\n'+empty,'00197735').length});
    `);
    assert.equal(result.without, 0);
    assert.equal(result.withId.length, 1);
    assert.equal(result.withId[0].__queryEmpNo, '00197735');
    assert.equal(result.ambiguous, 0);
});

test('a source-column rule blocks a person across all of their valid rows', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High',BU1:'Special'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-02 23:00',operate_level:'Low',BU1:'Normal'},
        {task_status:'completed',complete_operator:'WX200','当地开始时间':'2026-09-02 23:00',operate_level:'Low',BU1:'Normal'}
      ];
      nonpaymentRules=[{field:'source:BU1',mode:'contains',value:'spec'}];
      recalculate();
      ({paid:dedupRows.map(r=>r.__person),blocked:calcDetailRows.filter(r=>r.__blacklisted).map(r=>r.__person),hits:ruleHitPeople(nonpaymentRules[0]).length});
    `);
    assert.deepEqual(result, { paid: ['WX200'], blocked: ['A100', 'A100'], hits: 1 });
});

test('new snapshots restore WeLink flags, display field, nonpayment rules and view modes; old snapshots clear absent fields', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[{task_status:'completed',complete_operator:'WX100','当地开始时间':'2026-09-01 23:00',operate_level:'High'}];
      installWelinkPeople([{__queryEmpNo:'WX100',__suspectedDeparted:true,deptName:'疑似已离职'}],false);
      nonpaymentRules=[{field:'welink:deptName',mode:'equals',value:'疑似已离职'}];
      welinkDisplayField='departmentName';
      $('dedupMode').value='none';$('blacklistMode').value='disabled';$('periodSourceMode').value='start';activeOperatorGroup='wx';
      recalculate();
      const saved=buildIncentiveSnapshotPayload('测试','2026-09');
      installWelinkPeople([],false);nonpaymentRules=[];welinkDisplayField='deptName';
      restoreIncentiveSnapshot(saved);
      const restored={people:suspectedDepartedPeople().length,field:welinkDisplayField,rules:nonpaymentRules.length,dedup:$('dedupMode').value,blacklist:$('blacklistMode').value,period:$('periodSourceMode').value,group:activeOperatorGroup};
      restoreIncentiveSnapshot({title:'旧快照',payload:{rawRows:saved.payload.rawRows}});
      ({stored:saved.payload.welinkPeople.length,restored,legacy:{people:welinkPeople.size,rules:nonpaymentRules.length,field:welinkDisplayField}});
    `);
    assert.equal(result.stored, 1);
    assert.deepEqual(result.restored, { people: 1, field: 'departmentName', rules: 1, dedup: 'none', blacklist: 'disabled', period: 'start', group: 'wx' });
    assert.deepEqual(result.legacy, { people: 0, rules: 0, field: 'deptName' });
});

test('editing a nonpayment rule reuses parsed rows and attendance results without another attendance request', () => {
    const runtime = createToolRuntime();
    runtime.context.fetchCount = 0;
    runtime.context.fetch = () => {
        runtime.context.fetchCount++;
        return Promise.resolve({ ok: true, json: async () => ({ results: {} }) });
    };
    const result = evaluate(runtime, `
      rawRows=[
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High',BU1:'Excluded'},
        {task_status:'completed',complete_operator:'A200','当地开始时间':'2026-09-01 23:00',operate_level:'Low',BU1:'Included'}
      ];
      recalculate();
      const parsed=validRows,requestCount=fetchCount,version=attendanceCheckVersion;
      attendanceResults=new Map([['a200',{hasAnomaly:true,anomalies:[]}]]);
      nonpaymentRules=[{field:'source:BU1',mode:'equals',value:''}];
      changeNonpaymentRule(0,{value:'Excluded'});
      ({sameParsed:parsed===validRows,requestsBefore:requestCount,requestsAfter:fetchCount,versionBefore:version,versionAfter:attendanceCheckVersion,attendanceKept:attendanceResults.has('a200'),paid:dedupRows.map(r=>r.__person)});
    `);
    assert.deepEqual(result, { sameParsed: true, requestsBefore: 1, requestsAfter: 1, versionBefore: 1, versionAfter: 1, attendanceKept: true, paid: ['A200'] });
});

test('blacklist deductions apply only to the selected imported month and use deduplicated amounts', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:05',operate_level:'Low'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-10-01 23:00',operate_level:'Low'},
        {task_status:'completed',complete_operator:'A200','当地开始时间':'2026-09-01 23:00',operate_level:'Low'}
      ];
      blacklistDraft=[{staffId:'a100',name:'甲',month:'2026-09',reason:'违规操作',source:'手工录入'}];
      saveBlacklist();recalculate();
      const summary=blacklistDeductionRows();
      const paid=filtered().map(r=>({id:r.__person,month:incentiveMonth(r),fee:r.__fee}));
      const reasons=filteredCalcDetails().filter(r=>r.__person==='A100').map(r=>({month:incentiveMonth(r),reason:r.__ignoreReason}));
      $('dedupMode').value='none';const rawDeduction=blacklistDeductionRows()[0]['扣减激励（元）'];
      $('blacklistMode').value='disabled';
      ({paid,reasons,summary,rawDeduction,disabled:{deductions:blacklistDeductionRows().length,amount:filtered().reduce((s,r)=>s+r.__fee,0)}});
    `);
    assert.deepEqual(result.paid, [{ id: 'A200', month: '2026-09', fee: 50 }, { id: 'A100', month: '2026-10', fee: 50 }]);
    assert.deepEqual(result.reasons, [{ month: '2026-09', reason: '违规操作' }, { month: '2026-09', reason: '违规操作' }, { month: '2026-10', reason: '' }]);
    assert.equal(result.summary[0]['扣减激励（元）'], 280);
    assert.equal(result.summary[0]['扣减后激励（元）'], 0);
    assert.equal(result.rawDeduction, 330);
    assert.deepEqual(result.disabled, { deductions: 0, amount: 430 });
});

test('month validation rejects out-of-scope and missing months atomically, including template imports', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[{complete_operator:'00123456','当地开始时间':'2026-09-01 23:00',年份:2026,月份:10}];
      $('periodSourceMode').value='imported';
      blacklistDraft=[{staffId:'00123456',month:'2026-10',reason:'有效原因'}];saveBlacklist();
      const errors=[];
      for(const month of ['', '2026-09','2025-10']){try{importBlacklistRows([{'工号':'00123456','扣减月份':month,'扣减原因':'测试'}])}catch(e){errors.push(e.message)}}
      try{importBlacklistRows([{'工号':'00123456','扣减月份':'2026-10','扣减原因':''}])}catch(e){errors.push(e.message)}
      const importedMonths=importedIncentiveMonths();$('periodSourceMode').value='start';
      ({errors,draftCount:blacklistDraft.length,savedCount:incentiveBlacklist.size,importedMonths,startMonths:importedIncentiveMonths()});
    `);
    assert.equal(result.errors.length, 4);
    assert.equal(result.draftCount, 1);
    assert.equal(result.savedCount, 1);
    assert.deepEqual(result.importedMonths, ['2026-10']);
    assert.deepEqual(result.startMonths, ['2026-09']);
});

test('negative event import uses published events, imported months and unique employee IDs with original reasons', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[{complete_operator:'m00123456','当地开始时间':'2026-09-01 23:00'}, {complete_operator:'WX123456','当地开始时间':'2026-10-01 23:00'}];
      const ruleSnapshot={svcModule:'操作',subModule:'执行',desc:'违反操作规范'};
      const records=[
        {id:'ok',staffId:'00123456',date:'2026-09-12',status:'published',remark:'未按方案执行',personSnapshot:{name:'甲'},ruleSnapshot},
        {id:'wx',staffId:'mWX123456',date:'2026-10-02',status:'published',ruleSnapshot},
        {id:'draft',staffId:'00123456',date:'2026-09-12',status:'draft',ruleSnapshot},
        {id:'outside',staffId:'00123456',date:'2026-08-12',status:'published',ruleSnapshot},
        {id:'lastYear',staffId:'00123456',date:'2025-09-12',status:'published',ruleSnapshot},
        {id:'unknown',staffId:'999999',date:'2026-09-12',status:'published',personSnapshot:{name:'甲'},ruleSnapshot}
      ];
      const candidates=buildNegativeEventCandidates({records});
      const combined=blacklistMap([...candidates,...candidates]);
      rawRows.push({complete_operator:'00123456','当地开始时间':'2026-09-01 23:00'});
      ({candidates,deduplicated:combined.size,ambiguous:buildNegativeEventCandidates({records}).map(x=>x.sourceId)});
    `);
    assert.deepEqual(result.candidates.map(x => x.sourceId), ['ok', 'wx']);
    assert.equal(result.candidates[0].staffId, 'm00123456');
    assert.equal(result.candidates[0].month, '2026-09');
    assert.equal(result.candidates[0].eventDate, '2026-09-12');
    assert.match(result.candidates[0].reason, /违反操作规范；未按方案执行/);
    assert.equal(result.deduplicated, 2);
    assert.deepEqual(result.ambiguous, ['wx']);
});

test('structured snapshots preserve deduction reasons and do not fabricate payment when all rows are blacklisted', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[{task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High'}];
      incentiveBlacklist=blacklistMap([{staffId:'A100',month:'2026-09',reason:'事件原因',source:'负向事件管理',sourceId:'event1',eventDate:'2026-09-02'}]);
      recalculate();const snapshot=buildIncentiveSnapshotPayload('月度','2026-09');
      incentiveBlacklist=new Map();restoreIncentiveSnapshot(snapshot);
      const restored={entries:[...incentiveBlacklist.values()],paid:dedupRows.length,summary:snapshot.payload.personnelSummary,deductions:blacklistDeductionRows()};
      restoreIncentiveSnapshot({title:'旧快照',payload:{rawRows:snapshot.payload.rawRows,blacklistText:'A100, 历史原因'}});
      const legacy={paid:dedupRows.length,month:[...incentiveBlacklist.values()][0].month};
      restoreIncentiveSnapshot({title:'无名单快照',payload:{rawRows:snapshot.payload.rawRows}});
      ({restored,legacy,cleared:incentiveBlacklist.size});
    `);
    assert.equal(result.restored.entries[0].sourceId, 'event1');
    assert.equal(result.restored.entries[0].reason, '事件原因');
    assert.equal(result.restored.paid, 0);
    assert.deepEqual(result.restored.summary, []);
    assert.equal(result.restored.deductions[0]['扣减激励（元）'], 280);
    assert.deepEqual(result.legacy, { paid: 1, month: '' });
    assert.equal(result.cleared, 0);
});

test('attendance preview and deductions are grouped by meeting month and automatically enter the shared blacklist', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:05',operate_level:'Low'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-10-01 23:00',operate_level:'Low'}
      ];recalculate();
      const sept={snapshotId:'meeting-1',meetingTitle:'质量例会',sessionName:'第一场',actualDate:'2026-09-22',attendance:'Absent',type:'absent'};
      const oct={snapshotId:'meeting-1',meetingTitle:'质量例会',sessionName:'第二场',actualDate:'2026-10-02',attendance:'Delay',type:'delay',attendanceTime:'10:15'};
      attendanceResults=new Map([['a100',{hasAnomaly:true,anomalies:[sept,oct,{...sept,actualDate:'2026-08-22'}]}]]);
      updateAttendanceAnomalyAlert();
      const preview=currentAttendanceAnomalies.map(x=>({month:x.month,fee:x.totalFee,count:x.orderCount,meetings:x.anomalies.length}));
      document.querySelectorAll=selector=>selector==='.anomaly-row-cb'?[{checked:true,disabled:false,dataset:{idx:'0'}}]:[];
      showToast=()=>{};applyAnomaliesToBlacklist();
      const entries=[...incentiveBlacklist.values()];
      const after={paid:filtered().map(r=>incentiveMonth(r)),deduction:blacklistDeductionRows()[0],editorOpen:$('blacklistModal').classList.contains('show'),draftCount:blacklistDraft.length};
      const stored=JSON.parse(localStorage.getItem(BLACKLIST_STORAGE_KEY));
      incentiveBlacklist=blacklistMap([...entries,attendanceBlacklistEntry({staffId:'A100',name:''},sept)]);
      ({preview,entries,after,storedCount:stored.length,repeatedCount:incentiveBlacklist.size});
    `);
    assert.deepEqual(result.preview, [{ month: '2026-09', fee: 280, count: 1, meetings: 1 }, { month: '2026-10', fee: 50, count: 1, meetings: 1 }]);
    assert.equal(result.entries[0].month, '2026-09');
    assert.equal(result.entries[0].eventDate, '2026-09-22');
    assert.match(result.entries[0].reason, /2026-09-22《质量例会》【第一场】：缺席/);
    assert.deepEqual(result.after.paid, ['2026-10']);
    assert.equal(result.after.deduction['扣减激励（元）'], 280);
    assert.match(result.after.deduction['扣减原因'], /质量例会/);
    assert.equal(result.after.editorOpen, true);
    assert.equal(result.after.draftCount, 1);
    assert.equal(result.storedCount, 1);
    assert.equal(result.repeatedCount, 1);
});

test('attendance preview shows the full monthly deduction behind filters and never guesses an unknown meeting month', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High',BU1:'NIS'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-02 23:00',operate_level:'Low',BU1:'Other'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-10-01 23:00',operate_level:'Low',BU1:'NIS'}
      ];recalculate();$('filterBU').value='NIS';
      attendanceResults=new Map([['a100',{hasAnomaly:true,anomalies:[
        {snapshotId:'sept',title:'9月例会',actualDate:'2026-09-22',attendance:'Fake',type:'delay'},
        {snapshotId:'invalid',title:'未定日期会议',actualDate:'2026-02-30',attendance:'Absent'},
        {snapshotId:'outside',title:'旧会议',actualDate:'2025-09-22',attendance:'Absent'}
      ]}]]);updateAttendanceAnomalyAlert();
      const preview=currentAttendanceAnomalies.map(x=>({month:x.month,fee:x.totalFee,deductible:x.deductible}));
      const badgeSept=Boolean(getPersonAttendanceAnomaly('A100','', '2026-09')),badgeOct=Boolean(getPersonAttendanceAnomaly('A100','','2026-10'));
      const fakeReason=attendanceDeductionReason(currentAttendanceAnomalies[0].anomalies[0]);
      const entry=attendanceBlacklistEntry(currentAttendanceAnomalies[0],currentAttendanceAnomalies[0].anomalies[0]);
      let monthError='';try{validateBlacklistEntries([{...entry,month:'2026-10'}])}catch(e){monthError=e.message}
      ({preview,badgeSept,badgeOct,fakeReason,monthError});
    `);
    assert.deepEqual(result.preview, [{ month: '2026-09', fee: 330, deductible: true }, { month: '', fee: 0, deductible: false }]);
    assert.equal(result.badgeSept, true);
    assert.equal(result.badgeOct, false);
    assert.match(result.fakeReason, /虚假签到/);
    assert.match(result.monthError, /会议发生月份一致/);
});

test('personnel summary separates pending attendance warnings from applied deductions and restores payment when disabled', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      rawRows=[
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-09-01 23:00',operate_level:'High'},
        {task_status:'completed',complete_operator:'A100','当地开始时间':'2026-08-01 23:00',operate_level:'Low'},
        {task_status:'completed',complete_operator:'A200','当地开始时间':'2026-09-01 23:00',operate_level:'Low'}
      ];$('periodType').value='month';recalculate();
      attendanceResults=new Map([['a100',{hasAnomaly:true,anomalies:[{snapshotId:'meeting-1',title:'质量例会',actualDate:'2026-09-22',attendance:'Absent',type:'absent'}]}]]);
      render();openAttendanceAnomalyModal();
      const pending=getPersonnelPeriodSummaryData().find(x=>x.person==='A100'&&x.p==='2026-09');
      const pendingState={deducted:pending.isDeducted,reason:pending.deductionReason,money:pending.money,warning:Boolean(pending.anom),blacklist:incentiveBlacklist.size};
      document.querySelectorAll=selector=>selector==='.anomaly-row-cb'?[{checked:true,disabled:false,dataset:{idx:'0'}}]:[];showToast=()=>{};
      applyAnomaliesToBlacklist();
      const applied=getPersonnelPeriodSummaryData().find(x=>x.person==='A100'&&x.p==='2026-09');
      const appliedState={deducted:applied.isDeducted,reason:applied.deductionReason,money:applied.money};
      $('periodType').value='quarter';const quarter=getPersonnelPeriodSummaryData().find(x=>x.person==='A100');
      const partial={deducted:quarter.isDeducted,amount:quarter.deductedMoney,money:quarter.money,total:getPersonnelPeriodSummaryData().reduce((s,x)=>s+x.money,0),paid:filtered().reduce((s,r)=>s+r.__fee,0)};
      $('periodType').value='month';$('blacklistMode').value='disabled';render();
      const disabled=getPersonnelPeriodSummaryData().find(x=>x.person==='A100'&&x.p==='2026-09');
      ({pendingState,appliedState,partial,disabled:{deducted:disabled.isDeducted,reason:disabled.deductionReason,money:disabled.money}});
    `);
    assert.deepEqual(result.pendingState, { deducted: false, reason: '', money: 280, warning: true, blacklist: 0 });
    assert.equal(result.appliedState.deducted, true);
    assert.equal(result.appliedState.money, 0);
    assert.match(result.appliedState.reason, /考勤：2026-09-22《质量例会》：缺席/);
    assert.deepEqual(result.partial, { deducted: true, amount: 280, money: 50, total: 100, paid: 100 });
    assert.deepEqual(result.disabled, { deducted: false, reason: '', money: 280 });
});

test('reason cells show a short escaped preview with the complete reason in a collapsible body', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
      const full='会议考勤异常：2026-09-22《季度质量例会》：缺席（Absent）；签到时间：10:02；'+ '<img src=x onerror=alert(1)>'+'补充说明'.repeat(30);
      ({html:deductionReasonCell(full),empty:deductionReasonCell(''),simple:attendanceDeductionReason({actualDate:'2026-09-22',title:'质量例会',attendance:'Delay',type:'delay',attendanceTime:'10:02'})});
    `);
    assert.match(result.html, /<details class="deduction-reason">/);
    assert.match(result.html, /reason-expand/);
    assert.match(result.html, /reason-collapse/);
    assert.match(result.html, /deduction-reason-full/);
    assert.match(result.html, /&lt;img/);
    assert.doesNotMatch(result.html, /<img/);
    assert.equal(result.empty, '—');
    assert.equal(result.simple, '考勤：2026-09-22《质量例会》：迟到');
});
