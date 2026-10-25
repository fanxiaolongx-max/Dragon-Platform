const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const page = fs.readFileSync(
    path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-ms4xb66s', 'index.html'),
    'utf8'
);
const toolScript = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function createToolRuntime() {
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
    const documentElement = { lang: 'zh-CN' };
    const document = {
        documentElement,
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
    return { context };
}

function evaluate(runtime, code) {
    return vm.runInContext(code, runtime.context);
}

test('new header and format parses staff IDs, names, levels and TE/TK network domains', () => {
    const runtime = createToolRuntime();
    
    // 用户提供的 3 行新表示例数据 + 1行运营商测试数据
    runtime.context.fixtureRows = [
        {
            "变更单号/Change Number": "NE20260928000727",
            "RFC级别/RFC Level": "High",
            "操作级别/Operation Level": "High",
            "操作类型/Operation Type": "Software Upgrade",
            "实施任务单号/Implementation Task No": "TE20260930000347",
            "标题/title": "OceanStor_Dorado patch upgrade",
            "创建时间/Create Time": "2026-09-30 11:07:00",
            "任务完成时间/Task Complete Time": "2026-09-30 12:01:35",
            "变更单状态/RFC Status": "Closed",
            "ICT场景/ICT Scenario": "EBG",
            "BU/Service Type": "CS",
            "是否核心网元/Key NE": "否",
            "地区部/Region": "北部非洲地区部",
            "代表处/Rep. Office": "埃及代表处",
            "客户名称/Customer Name": "Signal Department of MOD.ARE",
            "建单人/Creator": "Islam Atia Saber 84389359",
            "实施人/Oprator": "Islam Atia Saber 84389359",
            "操作单状态/Operate Progress": "已完成"
        },
        {
            "变更单号/Change Number": "NE20260922000871",
            "RFC级别/RFC Level": "Medium",
            "操作级别/Operation Level": "Medium",
            "操作类型/Operation Type": "Hardware Replacement",
            "实施任务单号/Implementation Task No": "TE20260929000574",
            "标题/title": "ACUD-ONT Replacement",
            "创建时间/Create Time": "2026-09-29 11:24:53",
            "任务完成时间/Task Complete Time": "2026-09-29 14:39:49",
            "变更单状态/RFC Status": "Closed",
            "ICT场景/ICT Scenario": "EBG",
            "BU/Service Type": "CS",
            "是否核心网元/Key NE": "否",
            "地区部/Region": "北部非洲地区部",
            "代表处/Rep. Office": "埃及代表处",
            "客户名称/Customer Name": "Administrative Capital for Urban Development (ACUD)",
            "建单人/Creator": "MAHMOUD EMAD 00965968",
            "实施人/Oprator": "Omar Essameldin Hamad 84414086",
            "操作单状态/Operate Progress": "已完成"
        },
        {
            "变更单号/Change Number": "NE20260917000658",
            "RFC级别/RFC Level": "High",
            "操作级别/Operation Level": "High",
            "操作类型/Operation Type": "Software Upgrade",
            "实施任务单号/Implementation Task No": "TE20260929000498",
            "标题/title": "OceanStor Pacific Series Disk Firmware upgrade",
            "创建时间/Create Time": "2026-09-29 09:13:00",
            "任务完成时间/Task Complete Time": "2026-09-29 13:13:00",
            "变更单状态/RFC Status": "Closed",
            "ICT场景/ICT Scenario": "EBG",
            "BU/Service Type": "CS",
            "是否核心网元/Key NE": "否",
            "地区部/Region": "北部非洲地区部",
            "代表处/Rep. Office": "埃及代表处",
            "客户名称/Customer Name": "Signal Department of MOD.ARE",
            "建单人/Creator": "Islam Atia Saber 84389359",
            "实施人/Oprator": "Islam Atia Saber 84389359",
            "操作单状态/Operate Progress": "已完成"
        },
        {
            // 增加一条运营商单子 (TK 开头, NC 开头)
            "变更单号/Change Number": "NC20260920000123",
            "操作级别/Operation Level": "High",
            "实施任务单号/Implementation Task No": "TK20260930000888",
            "任务完成时间/Task Complete Time": "2026-09-30 23:30:00",
            "实施人/Oprator": "Carrier Engineer 00199999",
            "操作单状态/Operate Progress": "已完成"
        }
    ];

    const result = evaluate(runtime, `
        rawRows = fixtureRows;
        recalculate();
        const vRows = validRows.map(r => ({
            task: r.__task,
            changeNo: r.__changeNo,
            person: r.__person,
            name: r.__name,
            level: r.__level,
            fee: r.__fee,
            netDomain: r.__netDomain,
            date: r.__date
        }));
        const allFiltered = validRows.filter(operatorMatchesGroup).length;
        
        activeNetworkDomain = 'enterprise';
        const entFiltered = validRows.filter(operatorMatchesGroup).length;
        
        activeNetworkDomain = 'carrier';
        const carFiltered = validRows.filter(operatorMatchesGroup).length;
        
        const months = JSON.parse(JSON.stringify(importedIncentiveMonths()));
        
        ({
            totalValid: validRows.length,
            rows: vRows,
            allFiltered,
            entFiltered,
            carFiltered,
            months
        });
    `);

    // 1. 验证有效行解析数量：默认全天模式下 4 条均应解析成功
    assert.strictEqual(result.totalValid, 4, '全部 4 行记录都应被解析为有效行');

    // 2. 验证工号与姓名拆分、等级金额、TE/TK领域
    const row1 = result.rows.find(r => r.task === 'TE20260930000347');
    assert.strictEqual(row1.person, '84389359', '应提取出纯数字工号');
    assert.strictEqual(row1.name, 'Islam Atia Saber', '应提取出英文姓名');
    assert.strictEqual(row1.level, 'High');
    assert.strictEqual(row1.fee, 280, 'High 等级应对应默认 280 元');
    assert.strictEqual(row1.netDomain, 'enterprise', 'TE单号应被归类为 enterprise (企业网)');

    const row2 = result.rows.find(r => r.task === 'TE20260929000574');
    assert.strictEqual(row2.person, '84414086');
    assert.strictEqual(row2.name, 'Omar Essameldin Hamad');
    assert.strictEqual(row2.level, 'Medium');
    assert.strictEqual(row2.fee, 180, 'Medium 等级应对应默认 180 元');

    const row4 = result.rows.find(r => r.task === 'TK20260930000888');
    assert.strictEqual(row4.person, '00199999');
    assert.strictEqual(row4.netDomain, 'carrier', 'TK/NC单号应被归类为 carrier (运营商)');

    // 3. 验证网络业务类别筛选
    assert.strictEqual(result.allFiltered, 4, '全网络应为 4 条');
    assert.strictEqual(result.entFiltered, 3, '企业网筛选应为 3 条');
    assert.strictEqual(result.carFiltered, 1, '运营商筛选应为 1 条');

    // 4. 验证操作归属月份以任务完成时间为基准
    assert.deepEqual(result.months, ['2026-09'], '任务完成时间为2026-09-30，所属月份应为2026-09');
});

test('nighttime calculation uses Task Complete Time for new tables', () => {
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [
        {
            '变更单号/Change Number': 'NE20260928000727',
            '操作级别/Operation Level': 'High',
            '实施任务单号/Implementation Task No': 'TE20260930000347',
            '创建时间/Create Time': '2026-09-30 11:07:00',
            '任务完成时间/Task Complete Time': '2026-09-30 12:01:35', // 白天完成
            '实施人/Oprator': 'Islam Atia Saber 84389359',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '变更单号/Change Number': 'NE20260928000728',
            '操作级别/Operation Level': 'High',
            '实施任务单号/Implementation Task No': 'TE20260930000348',
            '创建时间/Create Time': '2026-09-30 21:00:00',
            '任务完成时间/Task Complete Time': '2026-09-30 23:45:00', // 夜间完成 (22:00-06:00)
            '实施人/Oprator': 'Night Engineer 84389360',
            '操作单状态/Operate Progress': '已完成'
        }
    ];

    const result = evaluate(runtime, `
        $('nightOnly').checked = true;
        $('verifyMode').value = 'time';
        rawRows = fixtureRows;
        recalculate();
        ({
            validPersons: validRows.map(r => r.__person),
            excludedPersons: excludedRows.map(r => r.__person),
            excludedReason: excludedRows[0]?.__reason
        });
    `);

    assert.equal(result.validPersons.length, 1);
    assert.equal(result.validPersons[0], '84389360');
    assert.equal(result.excludedPersons.length, 1);
    assert.equal(result.excludedPersons[0], '84389359');
    assert.ok(result.excludedReason.includes('非夜间操作') || result.excludedReason.includes('时间不满足'));
});

test('operator scope and network domain counts link dynamically', () => {
    const runtime = createToolRuntime();
    const rows = [];
    // 70 条非 WX 企业网
    for (let i = 0; i < 70; i++) {
        rows.push({
            '实施人/Oprator': `Engineer ${1000 + i}`,
            '实施任务单号/Implementation Task No': `TE20260901${String(i).padStart(4, '0')}`,
            '操作级别/Operation Level': 'High',
            '操作单状态/Operate Progress': '已完成',
            '任务完成时间/Task Complete Time': '2026-09-30 23:00:00'
        });
    }
    // 908 条非 WX 运营商
    for (let i = 0; i < 908; i++) {
        rows.push({
            '实施人/Oprator': `Engineer ${2000 + i}`,
            '实施任务单号/Implementation Task No': `TK20260901${String(i).padStart(4, '0')}`,
            '操作级别/Operation Level': 'High',
            '操作单状态/Operate Progress': '已完成',
            '任务完成时间/Task Complete Time': '2026-09-30 23:00:00'
        });
    }
    // 16 条 WX 企业网
    for (let i = 0; i < 16; i++) {
        rows.push({
            '实施人/Oprator': `WXEngineer WX${3000 + i}`,
            '实施任务单号/Implementation Task No': `TE20260902${String(i).padStart(4, '0')}`,
            '操作级别/Operation Level': 'High',
            '操作单状态/Operate Progress': '已完成',
            '任务完成时间/Task Complete Time': '2026-09-30 23:00:00'
        });
    }
    // 151 条 WX 运营商
    for (let i = 0; i < 151; i++) {
        rows.push({
            '实施人/Oprator': `WXEngineer WX${4000 + i}`,
            '实施任务单号/Implementation Task No': `TK20260902${String(i).padStart(4, '0')}`,
            '操作级别/Operation Level': 'High',
            '操作单状态/Operate Progress': '已完成',
            '任务完成时间/Task Complete Time': '2026-09-30 23:00:00'
        });
    }

    runtime.context.fixtureRows = rows;
    const res = evaluate(runtime, `
        rawRows = fixtureRows;
        recalculate();
        
        // 1. 默认状态：nonwx + all
        syncOperatorGroupCounts();
        const state1 = {
            nonWx: Number($('nonWxCount').textContent),
            wx: Number($('wxCount').textContent),
            netAll: Number($('netDomainAllCount').textContent),
            ent: Number($('enterpriseCount').textContent),
            car: Number($('carrierCount').textContent)
        };
        
        // 2. 切换为 wx
        activeOperatorGroup = 'wx';
        syncOperatorGroupCounts();
        const state2 = {
            nonWx: Number($('nonWxCount').textContent),
            wx: Number($('wxCount').textContent),
            netAll: Number($('netDomainAllCount').textContent),
            ent: Number($('enterpriseCount').textContent),
            car: Number($('carrierCount').textContent)
        };
        
        // 3. 切换为 enterprise
        activeNetworkDomain = 'enterprise';
        activeOperatorGroup = 'nonwx';
        syncOperatorGroupCounts();
        const state3 = {
            nonWx: Number($('nonWxCount').textContent),
            wx: Number($('wxCount').textContent),
            netAll: Number($('netDomainAllCount').textContent),
            ent: Number($('enterpriseCount').textContent),
            car: Number($('carrierCount').textContent)
        };
        
        ({ state1, state2, state3 });
    `);

    // 状态 1：非 WX 下业务网络应显示 978 = 70 + 908
    assert.equal(res.state1.nonWx, 978);
    assert.equal(res.state1.wx, 167);
    assert.equal(res.state1.netAll, 978);
    assert.equal(res.state1.ent, 70);
    assert.equal(res.state1.car, 908);

    // 状态 2：WX 下业务网络应显示 167 = 16 + 151
    assert.equal(res.state2.netAll, 167);
    assert.equal(res.state2.ent, 16);
    assert.equal(res.state2.car, 151);

    // 状态 3：企业网下统计类别应显示 70 和 16
    assert.equal(res.state3.nonWx, 70);
    assert.equal(res.state3.wx, 16);
    assert.equal(res.state3.ent, 70);
});

test('Orange Egypt row uses Task Complete Time and displays 按完成时间 without 字段非夜间', () => {
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [
        {
            '实施任务单号/Implementation Task No': 'TK20260929006211',
            '操作级别/Operation Level': 'High',
            '操作类型/Operation Type': 'Software Upgrade',
            '标题/title': 'Software Upgrade at NE8000 M8 at New Giza BNG Site.',
            '任务完成时间/Task Complete Time': '2026-09-30 02:53:12',
            'BU/Service Type': 'NIS',
            '客户名称/Customer Name': 'Orange Egypt for Telecommunications',
            '实施人/Oprator': 'Khaled Hamza ElAfry 00491464',
            '操作单状态/Operate Progress': '已完成'
        }
    ];

    const result = evaluate(runtime, `
        rawRows = fixtureRows;
        recalculate();
        const row = validRows[0];
        
        let renderedHtml = '';
        table = function(headers, data) {
            renderedHtml = JSON.stringify(data);
        };
        renderDetail(calcDetailRows);
        
        ({
            person: row.__person,
            name: row.__name,
            customer: row.__customer,
            byTime: row.__byTime,
            hasOpField: row.__hasOpField,
            fee: row.__fee,
            renderedHtml
        });
    `);

    assert.equal(result.person, '00491464');
    assert.equal(result.name, 'Khaled Hamza ElAfry');
    assert.equal(result.customer, 'Orange Egypt for Telecommunications');
    assert.equal(result.byTime, true, '02:53:12 应为夜间时间确认');
    assert.equal(result.hasOpField, false, '新表无操作时间段列，hasOpField 应为 false');
    assert.equal(result.fee, 280);
    assert.ok(result.renderedHtml.includes('按完成时间'), '明细表中应显示 按完成时间');
    assert.ok(!result.renderedHtml.includes('字段非夜间'), '明细表中绝不应出现 字段非夜间');
});

test('import sample popover has larger dimensions, language toggle and unchanged table content', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-ms4xb66s', 'index.html'), 'utf8');
    
    // 1. Popover CSS dimensions
    assert.ok(html.includes('width:min(940px,96vw)'), 'Popover width should be at least min(940px,96vw)');
    assert.ok(html.includes('max-height:600px'), 'Popover max-height should be 600px');
    assert.ok(html.includes('max-height:460px'), 'Scroll area max-height should be 460px');

    // 2. Language switch in popover header
    assert.ok(html.includes('id="popoverLangZh"'), 'Should have Chinese toggle button');
    assert.ok(html.includes('id="popoverLangEn"'), 'Should have English toggle button');
    assert.ok(html.includes('sample-lang-switch'), 'Should have language switch container');

    // 3. Table column headers have IDs for dynamic translation
    assert.ok(html.includes('id="thSampleElem"'), 'Key elements header should have id');
    assert.ok(html.includes('id="thSampleNew"'), 'New header column should have id');
    assert.ok(html.includes('id="thSampleOld"'), 'Old header column should have id');
    assert.ok(html.includes('id="thSampleRule"'), 'Rules header should have id');
    assert.ok(html.includes('id="thSampleData"'), 'Sample data header should have id');

    // 4. Sample table content (rows) are strictly preserved
    assert.ok(html.includes('实施人/Oprator'), 'Should keep 实施人/Oprator');
    assert.ok(html.includes('Islam Atia Saber 84389359'), 'Should keep Islam Atia Saber sample');
    assert.ok(html.includes('TE20260930000347'), 'Should keep TE ticket sample');
    assert.ok(html.includes('TK20260930000123'), 'Should keep TK ticket sample');
    assert.ok(html.includes('NE20260928000727'), 'Should keep NE change no sample');
    assert.ok(html.includes('Signal Department of MOD.ARE'), 'Should keep MOD.ARE customer sample');
});

test('personnel period summary removes customer/attribute, splits level counts, and tracks deduction reasons', () => {
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [
        {
            '实施任务单号/Implementation Task No': 'TE20260930000347',
            '操作级别/Operation Level': 'High',
            '操作类型/Operation Type': 'Software Upgrade',
            '任务完成时间/Task Complete Time': '2026-09-30 02:00:00',
            'BU/Service Type': 'CS',
            '客户名称/Customer Name': 'Signal Department of MOD.ARE',
            '实施人/Oprator': 'Islam Atia Saber 84389359',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '实施任务单号/Implementation Task No': 'TE20260929000574',
            '操作级别/Operation Level': 'Medium',
            '操作类型/Operation Type': 'Hardware Replacement',
            '任务完成时间/Task Complete Time': '2026-09-29 03:00:00',
            'BU/Service Type': 'CS',
            '客户名称/Customer Name': 'Administrative Capital (ACUD)',
            '实施人/Oprator': 'Omar Essameldin Hamad 84414086',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '实施任务单号/Implementation Task No': 'TE20260928000111',
            '操作级别/Operation Level': 'Low',
            '操作类型/Operation Type': 'Inspection',
            '任务完成时间/Task Complete Time': '2026-09-28 01:00:00',
            'BU/Service Type': 'CS',
            '客户名称/Customer Name': 'Administrative Capital (ACUD)',
            '实施人/Oprator': 'Omar Essameldin Hamad 84414086',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '实施任务单号/Implementation Task No': 'TK20260929006211',
            '操作级别/Operation Level': 'High',
            '操作类型/Operation Type': 'Software Upgrade',
            '任务完成时间/Task Complete Time': '2026-09-29 02:00:00',
            'BU/Service Type': 'NIS',
            '客户名称/Customer Name': 'Orange Egypt for Telecommunications',
            '实施人/Oprator': 'Khaled Hamza ElAfry 00491464',
            '操作单状态/Operate Progress': '已完成'
        }
    ];

    const result = evaluate(runtime, `
        rawRows = fixtureRows;
        // 把 Omar 放入黑名单（模拟会议考勤缺勤扣除）
        blacklistDraft = [{ staffId: '84414086', name: 'Omar Essameldin Hamad', month: '2026-09', reason: '质量例会缺勤扣除', source: '会议考勤', eventDate: '2026-09-22' }];
        saveBlacklist();
        recalculate();

        let tableHeaders = [];
        let tableRows = [];
        table = function(headers, rows) {
            tableHeaders = headers;
            tableRows = rows;
        };

        renderPerson(filtered());
        const summaryData = getPersonnelPeriodSummaryData();

        ({
            tableHeaders,
            tableRows,
            summaryData
        });
    `);

    // 1. 验证表头中客户和人员属性已移除，增加了 BG 列，等级分布拆分为 Fatal单数、High单数、Medium单数、Low单数，增加了是否扣除激励和扣除原因
    assert.ok(result.tableHeaders.includes('BG'), '表头应包含 BG 列');
    assert.ok(!result.tableHeaders.includes('客户'), '表头中不应包含 客户 列');
    assert.ok(!result.tableHeaders.includes('人员属性'), '表头中不应包含 人员属性 列');
    assert.ok(result.tableHeaders.includes('Fatal单数'), '表头应包含 Fatal单数 列');
    assert.ok(result.tableHeaders.includes('High单数'), '表头应包含 High单数 列');
    assert.ok(result.tableHeaders.includes('Medium单数'), '表头应包含 Medium单数 列');
    assert.ok(result.tableHeaders.includes('Low单数'), '表头应包含 Low单数 列');
    assert.ok(result.tableHeaders.includes('是否扣除激励'), '表头应包含 是否扣除激励 列');
    assert.ok(result.tableHeaders.includes('扣除原因'), '表头应包含 扣除原因 列');

    // 2. 验证数据中正常人员（Islam）和扣除人员（Omar）及运营商人员（Khaled）的 BG 与数据
    const islam = result.summaryData.find(x => x.person === '84389359');
    assert.ok(islam, 'Islam 应在汇总数据中');
    assert.equal(islam.bg, 'EBG', 'Islam 的实施单为 TE 开头，BG 应为 EBG');
    assert.equal(islam.highCount, 1);
    assert.equal(islam.mediumCount, 0);
    assert.equal(islam.isDeducted, false);
    assert.equal(islam.deductionReason, '');
    assert.equal(islam.money, 280);

    const omar = result.summaryData.find(x => x.person === '84414086');
    assert.ok(omar, 'Omar 虽然被黑名单扣除，但也应在汇总数据中展示');
    assert.equal(omar.bg, 'EBG', 'Omar 的实施单为 TE 开头，BG 应为 EBG');
    assert.equal(omar.highCount, 0);
    assert.equal(omar.mediumCount, 1);
    assert.equal(omar.lowCount, 1);
    assert.equal(omar.isDeducted, true, 'Omar 应被标记为扣除激励');
    assert.ok(omar.deductionReason.includes('质量例会缺勤扣除'), 'Omar 扣除原因应包含会议考勤原因');
    assert.equal(omar.money, 0, 'Omar 扣除后激励应为 0');

    const khaled = result.summaryData.find(x => x.person === '00491464');
    assert.ok(khaled, 'Khaled 应在汇总数据中');
    assert.equal(khaled.bg, 'CNBG', 'Khaled 的实施单为 TK 开头，BG 应为 CNBG');
});

test('exportCurrent produces 3 sheets including personnel period summary with deduction columns and supports full English export', () => {
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [
        {
            '实施任务单号/Implementation Task No': 'TE20260930000347',
            '操作级别/Operation Level': 'High',
            '操作类型/Operation Type': 'Software Upgrade',
            '任务完成时间/Task Complete Time': '2026-09-30 02:00:00',
            'BU/Service Type': 'CS',
            '客户名称/Customer Name': 'Signal Department of MOD.ARE',
            '实施人/Oprator': 'Islam Atia Saber 84389359',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '实施任务单号/Implementation Task No': 'TK20260929000574',
            '操作级别/Operation Level': 'Medium',
            '操作类型/Operation Type': 'Hardware Replacement',
            '任务完成时间/Task Complete Time': '2026-09-29 03:00:00',
            'BU/Service Type': 'CS',
            '客户名称/Customer Name': 'Administrative Capital (ACUD)',
            '实施人/Oprator': 'Omar Essameldin Hamad 84414086',
            '操作单状态/Operate Progress': '已完成'
        }
    ];

    const result = evaluate(runtime, `
        rawRows = fixtureRows;
        blacklistDraft = [{ staffId: '84414086', name: 'Omar Essameldin Hamad', month: '2026-09', reason: '负向事件通报', source: '负向事件管理' }];
        saveBlacklist();
        recalculate();

        const savedWorkbooks = [];
        window.XLSX = XLSX = {
            utils: {
                json_to_sheet: (data) => ({ '!ref': 'A1:H10' }),
                aoa_to_sheet: (rows) => {
                    const sheet = { '!ref': 'A1:M' + rows.length, _rows: rows };
                    rows.forEach((r, ri) => {
                        r.forEach((v, ci) => {
                            sheet[window.XLSX.utils.encode_cell({ r: ri, c: ci })] = { v };
                        });
                    });
                    return sheet;
                },
                decode_range: (ref) => ({ s: { r: 0, c: 0 }, e: { r: 5, c: 8 } }),
                encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
                encode_range: (range) => 'A1:M10',
                book_new: () => ({ SheetNames: [], Sheets: {} }),
                book_append_sheet: (wb, ws, name) => {
                    wb.SheetNames.push(name);
                    wb.Sheets[name] = ws;
                }
            },
            writeFile: (wb, filename, opts) => {
                savedWorkbooks.push({ wb, filename, opts });
            }
        };

        // 1. 中文模式导出
        document.documentElement.lang = 'zh-CN';
        exportCurrent();

        // 2. 英文模式导出
        document.documentElement.lang = 'en-US';
        exportCurrent();

        ({
            savedWorkbooks
        });
    `);

    assert.equal(result.savedWorkbooks.length, 2);

    // 检查中文导出
    const zhWb = result.savedWorkbooks[0];
    assert.deepEqual(zhWb.wb.SheetNames, ['当前计算结果', '人员周期汇总', '黑名单扣减明细']);
    assert.ok(zhWb.filename.startsWith('埃及代表处夜间操作激励统计结果_'));
    const zhSummarySheet = zhWb.wb.Sheets['人员周期汇总'];
    const zhHeaders = zhSummarySheet._rows[0];
    assert.ok(zhHeaders.includes('Fatal单数'));
    assert.ok(zhHeaders.includes('High单数'));
    assert.ok(zhHeaders.includes('Medium单数'));
    assert.ok(zhHeaders.includes('Low单数'));
    assert.ok(zhHeaders.includes('是否扣除激励'));
    assert.ok(zhHeaders.includes('扣除原因'));
    assert.ok(zhHeaders.includes('BG'), 'Excel 中文表头应包含 BG 列');
    assert.ok(!zhHeaders.includes('客户'));
    assert.ok(!zhHeaders.includes('人员属性'));

    const zhBgCol = zhHeaders.indexOf('BG');
    const zhIslamRow = zhSummarySheet._rows.find(r => r[1] === '84389359');
    const zhOmarRow = zhSummarySheet._rows.find(r => r[1] === '84414086');
    assert.equal(zhIslamRow[zhBgCol], 'EBG', 'Islam 的单号为 TE 开头，Excel 中 BG 应为 EBG');
    assert.equal(zhOmarRow[zhBgCol], 'CNBG', 'Omar 的单号为 TK 开头，Excel 中 BG 应为 CNBG');

    // 检查英文导出
    const enWb = result.savedWorkbooks[1];
    assert.deepEqual(enWb.wb.SheetNames, ['Operation_Details', 'Personnel_Summary', 'Deduction_Details']);
    assert.ok(enWb.filename.startsWith('Egypt_Night_Operation_Incentive_Results_'));
    const enSummarySheet = enWb.wb.Sheets['Personnel_Summary'];
    const enHeaders = enSummarySheet._rows[0];
    assert.ok(enHeaders.includes('BG'), 'Excel 英文表头应包含 BG 列');
    assert.ok(enHeaders.includes('Fatal Count'));
    assert.ok(enHeaders.includes('High Count'));
    assert.ok(enHeaders.includes('Medium Count'));
    assert.ok(enHeaders.includes('Low Count'));
    assert.ok(enHeaders.includes('Incentive Deducted'));
    assert.ok(enHeaders.includes('Deduction Reason'));
    assert.ok(!enHeaders.includes('Customer'));
    assert.ok(!enHeaders.includes('Staff Attribute'));

    // 检查英文状态下的扣除标记和翻译
    const enBgCol = enHeaders.indexOf('BG');
    const deductedIdx = enHeaders.indexOf('Incentive Deducted');
    const reasonIdx = enHeaders.indexOf('Deduction Reason');
    const moneyIdx = enHeaders.indexOf('Total Incentive (CNY)');
    const idChangeIdx = enHeaders.indexOf('ID Change');
    const departureIdx = enHeaders.indexOf('Departure Status');

    assert.ok(idChangeIdx >= 0, 'Should have ID Change column in English sheet');
    assert.ok(departureIdx >= 0, 'Should have Departure Status column in English sheet');

    const enOmarRow = enSummarySheet._rows.find(r => r[1] === '84414086');
    assert.ok(enOmarRow, 'Omar row must be in English sheet');
    assert.equal(enOmarRow[enBgCol], 'CNBG', 'Omar 的单号为 TK 开头，英文 Excel 中 BG 应为 CNBG');
    assert.equal(enOmarRow[deductedIdx], 'Yes', 'Omar should have Incentive Deducted = Yes');
    assert.ok(enOmarRow[reasonIdx].includes('Negative Event'), 'Deduction reason should be translated to English');
    assert.equal(enOmarRow[moneyIdx], 0, 'Omar incentive should be 0');

    const enIslamRow = enSummarySheet._rows.find(r => r[1] === '84389359');
    assert.ok(enIslamRow, 'Islam row must be in English sheet');
    assert.equal(enIslamRow[enBgCol], 'EBG', 'Islam 的单号为 TE 开头，英文 Excel 中 BG 应为 EBG');
    assert.equal(enIslamRow[deductedIdx], 'No', 'Islam should have Incentive Deducted = No');
    assert.equal(enIslamRow[reasonIdx], '—');
    assert.equal(enIslamRow[moneyIdx], 280);
});

test('personnel period summary is first tab and displays WeLink departure and ID change status in UI and Excel', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-ms4xb66s', 'index.html'), 'utf8');

    // 1. Verify tab order in HTML: person tab is before dimension tab
    const personTabIdx = html.indexOf('data-view="person"');
    const dimensionTabIdx = html.indexOf('data-view="dimension"');
    assert.ok(personTabIdx < dimensionTabIdx, 'Person summary tab must appear before dimension tab');

    // 2. Test runtime default view and WeLink integration
    const runtime = createToolRuntime();
    runtime.context.fixtureRows = [
        {
            '实施任务单号/Implementation Task No': 'TE20260930000347',
            '操作级别/Operation Level': 'High',
            '任务完成时间/Task Complete Time': '2026-09-30 02:00:00',
            'BU/Service Type': 'CS',
            '实施人/Oprator': 'A100',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '实施任务单号/Implementation Task No': 'TK20260929000574',
            '操作级别/Operation Level': 'Medium',
            '任务完成时间/Task Complete Time': '2026-09-29 03:00:00',
            'BU/Service Type': 'CS',
            '实施人/Oprator': 'B200',
            '操作单状态/Operate Progress': '已完成'
        },
        {
            '实施任务单号/Implementation Task No': 'TE20260928000111',
            '操作级别/Operation Level': 'Low',
            '任务完成时间/Task Complete Time': '2026-09-28 01:00:00',
            'BU/Service Type': 'CS',
            '实施人/Oprator': 'C300',
            '操作单状态/Operate Progress': '已完成'
        }
    ];

    const result = evaluate(runtime, `
        rawRows = fixtureRows;
        recalculate();
        const initialView = currentView;

        // 模拟导入 WeLink 查询结果：
        // A100: 正常在职，工号变更为 00197735
        // B200: 疑似已离职（__suspectedDeparted: true）
        // C300: 正常在职，无工号变更
        installWelinkPeople([
            { __queryEmpNo: 'A100', employeeNumber: '00197735', deptName: 'IT Department' },
            { __queryEmpNo: 'B200', __suspectedDeparted: true, deptName: '' },
            { __queryEmpNo: 'C300', employeeNumber: 'C300', deptName: 'Network Ops' }
        ], false);

        let tableHeaders = [];
        let tableRows = [];
        table = function(headers, rows) {
            tableHeaders = headers;
            tableRows = rows;
        };

        render();
        const uiHeaders = tableHeaders; const uiTableHtml = JSON.stringify(tableRows);
        const summaryData = getPersonnelPeriodSummaryData();

        // 导出 Excel 并验证 Sheet 2 内容
        const savedWorkbooks = [];
        window.XLSX = {
            utils: {
                json_to_sheet: (data) => ({ '!ref': 'A1:H10' }),
                aoa_to_sheet: (rows) => ({ '!ref': 'A1:M' + rows.length, _rows: rows }),
                decode_range: (ref) => ({ s: { r: 0, c: 0 }, e: { r: 5, c: 8 } }),
                encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
                encode_range: (range) => 'A1:M10',
                book_new: () => ({ SheetNames: [], Sheets: {} }),
                book_append_sheet: (wb, ws, name) => {
                    wb.SheetNames.push(name);
                    wb.Sheets[name] = ws;
                }
            },
            writeFile: (wb, filename, opts) => {
                savedWorkbooks.push({ wb, filename, opts });
            }
        };

        exportCurrent();

        ({
            initialView,
            currentView,
            uiHeaders, uiTableHtml,
            summaryData,
            excelSheet2: savedWorkbooks[0].wb.Sheets['人员周期汇总']
        });
    `);

    // 1. 验证默认视图为 person
    assert.equal(result.initialView, 'person', 'Initial default view must be person');
    assert.equal(result.currentView, 'person', 'Current view after render must remain person');

    // 2. 验证 UI 表格中操作人列包含 工号有变更 和 疑似已离职 状态标签，WeLink列包含离职状态
    assert.ok(result.uiTableHtml.includes('工号有变更'), 'UI 操作人列应包含 工号有变更 标签');
    assert.ok(result.uiTableHtml.includes('疑似已离职'), 'UI 操作人列与WeLink列应包含 疑似已离职 标签');

    // 3. 验证数据中是否离职和工号变更字段
    const a100 = result.summaryData.find(x => x.person === 'A100');
    assert.ok(a100.changeText.includes('00197735'), 'A100 应识别出换工号至 00197735');
    assert.equal(a100.departureText, '在职', 'A100 应为在职');

    const b200 = result.summaryData.find(x => x.person === 'B200');
    assert.equal(b200.changeText, '—', 'B200 无换工号');
    assert.equal(b200.departureText, '疑似已离职', 'B200 应标记为疑似已离职');

    const c300 = result.summaryData.find(x => x.person === 'C300');
    assert.equal(c300.changeText, '—', 'C300 无换工号');
    assert.equal(c300.departureText, '在职', 'C300 应为在职');

    // 4. 验证导出的 Excel 人员周期汇总 Sheet
    const excelRows = result.excelSheet2._rows;
    const excelHeaders = excelRows[0];
    const idChangeCol = excelHeaders.indexOf('工号变更');
    const departureCol = excelHeaders.indexOf('是否离职');
    assert.ok(idChangeCol >= 0, 'Excel 表头必须包含 工号变更 列');
    assert.ok(departureCol >= 0, 'Excel 表头必须包含 是否离职 列');

    const excelA100 = excelRows.find(r => r[1] === 'A100');
    assert.ok(excelA100[idChangeCol].includes('00197735'), 'Excel 中 A100 应显示换工号信息');
    assert.equal(excelA100[departureCol], '在职', 'Excel 中 A100 应显示在职');

    const excelB200 = excelRows.find(r => r[1] === 'B200');
    assert.equal(excelB200[departureCol], '疑似已离职', 'Excel 中 B200 应显示疑似已离职');
});

test('welink tools bar compression, auto-collapse after welink import, and manual toggle', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-ms4xb66s', 'index.html'), 'utf8');

    // 1. Verify CSS styles for .person-tools and margin to quick-row
    assert.ok(html.includes('.person-tools{display:flex;gap:8px;align-items:center;margin-top:10px;margin-bottom:14px;'), 'Must have margin-bottom:14px to separate from quick-row');
    assert.ok(html.includes('overflow-x:auto'), 'Should support horizontal scrolling on one row');
    assert.ok(html.includes('filterCollapsibleSection'), 'Should have collapsible section wrapper');
    assert.ok(html.includes('filterCollapsedBar'), 'Should have collapsed summary bar');

    // 2. Test runtime behavior: initial expanded, auto-collapse on installWelinkPeople, and manual toggle
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
        const initialCollapsed = isFilterSectionCollapsed;
        const initialDisplay = $('filterCollapsibleSection').style.display;
        const initialBtnText = $('toggleFilterSectionBtn').textContent;

        // 导入 WeLink 数据
        installWelinkPeople([
            { __queryEmpNo: '00197735', employeeNumber: '00197735', deptName: 'IT Department' }
        ]);

        const afterImportCollapsed = isFilterSectionCollapsed;
        const afterImportDisplay = $('filterCollapsibleSection').style.display;
        const afterImportBarDisplay = $('filterCollapsedBar').style.display;
        const afterImportBtnText = $('toggleFilterSectionBtn').textContent;
        const afterImportSummary = $('filterCollapsedSummary').textContent;

        // 手动展开
        toggleFilterCollapse();
        const manualExpandedCollapsed = isFilterSectionCollapsed;
        const manualExpandedDisplay = $('filterCollapsibleSection').style.display;
        const manualExpandedBarDisplay = $('filterCollapsedBar').style.display;
        const manualExpandedBtnText = $('toggleFilterSectionBtn').textContent;

        // 手动折叠
        toggleFilterCollapse();
        const manualCollapsedState = isFilterSectionCollapsed;

        ({
            initialCollapsed,
            initialDisplay,
            initialBtnText,
            afterImportCollapsed,
            afterImportDisplay,
            afterImportBarDisplay,
            afterImportBtnText,
            afterImportSummary,
            manualExpandedCollapsed,
            manualExpandedDisplay,
            manualExpandedBarDisplay,
            manualExpandedBtnText,
            manualCollapsedState
        });
    `);

    // 初始状态未折叠
    assert.equal(result.initialCollapsed, false);
    assert.ok(!result.initialDisplay, 'Initial display should be empty/unset');
    assert.equal(result.initialBtnText, '▲ 折叠筛选');

    // 导入 WeLink 后自动折叠
    assert.equal(result.afterImportCollapsed, true);
    assert.equal(result.afterImportDisplay, 'none');
    assert.equal(result.afterImportBarDisplay, 'flex');
    assert.equal(result.afterImportBtnText, '▼ 展开筛选');
    assert.ok(result.afterImportSummary.includes('WeLink 已关联 1 人'));

    // 手动展开
    assert.equal(result.manualExpandedCollapsed, false);
    assert.equal(result.manualExpandedDisplay, '');
    assert.equal(result.manualExpandedBarDisplay, 'none');
    assert.equal(result.manualExpandedBtnText, '▲ 折叠筛选');

    // 手动再次折叠
    assert.equal(result.manualCollapsedState, true);
});

test('blacklist deduction panel auto-collapses after blacklist save and follows filter collapse toggle', () => {
    const runtime = createToolRuntime();
    const result = evaluate(runtime, `
        rawRows = [
            { task_status: 'completed', complete_operator: 'm00123456', '当地开始时间': '2026-09-01 23:00', operate_level: 'High' }
        ];
        recalculate();
        const initialDisplay = $('blacklistDeductionPanel').style.display;

        // 保存黑名单
        blacklistDraft = [
            { staffId: 'm00123456', name: '测试员工', month: '2026-09', reason: '人工核查', source: '手工录入' }
        ];
        saveBlacklist();
        applyPaymentRules();

        const afterSaveCollapsed = isFilterSectionCollapsed;
        const afterSaveDeductionDisplay = $('blacklistDeductionPanel').style.display;
        const afterSaveBtnText = $('toggleFilterSectionBtn').textContent;
        const afterSaveSummary = $('filterCollapsedSummary').textContent;

        // 手动展开筛选
        toggleFilterCollapse();
        const manualExpandedCollapsed = isFilterSectionCollapsed;
        const manualExpandedDeductionDisplay = $('blacklistDeductionPanel').style.display;
        const manualExpandedBtnText = $('toggleFilterSectionBtn').textContent;

        // 手动再次折叠
        toggleFilterCollapse();
        const manualCollapsedState = isFilterSectionCollapsed;
        const manualCollapsedDeductionDisplay = $('blacklistDeductionPanel').style.display;
        const manualCollapsedBtnText = $('toggleFilterSectionBtn').textContent;

        ({
            initialDisplay,
            afterSaveCollapsed,
            afterSaveDeductionDisplay,
            afterSaveBtnText,
            afterSaveSummary,
            manualExpandedCollapsed,
            manualExpandedDeductionDisplay,
            manualExpandedBtnText,
            manualCollapsedState,
            manualCollapsedDeductionDisplay,
            manualCollapsedBtnText
        });
    `);

    // 保存黑名单后自动折叠，不自动展开显示
    assert.equal(result.afterSaveCollapsed, true);
    assert.equal(result.afterSaveDeductionDisplay, 'none');
    assert.equal(result.afterSaveBtnText, '▼ 展开筛选');
    assert.ok(result.afterSaveSummary.includes('黑名单扣减明细已折叠'));

    // 跟随展开
    assert.equal(result.manualExpandedCollapsed, false);
    assert.equal(result.manualExpandedDeductionDisplay, '');
    assert.equal(result.manualExpandedBtnText, '▲ 折叠筛选');

    // 跟随折叠
    assert.equal(result.manualCollapsedState, true);
    assert.equal(result.manualCollapsedDeductionDisplay, 'none');
    assert.equal(result.manualCollapsedBtnText, '▼ 展开筛选');
});
