const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repo = require('../backend/models/meeting-snapshots-repository');

test('meeting-snapshots-repository performs complete CRUD and filtering on SQLite database', async () => {
    await repo.ensureReady();

    const testId = `snap_test_${Date.now()}`;
    const testSnapshot = {
        id: testId,
        title: '2026-09-22 埃及网安例会考勤分析',
        meetingDate: '2026-09-22',
        summary: {
            sheetCount: 5,
            totalRows: 1250,
            totalAttendees: 180,
            onTimeRate: '92.5%',
            counts: {
                Absent: 10,
                'Attend on Time': 160,
                Delay: 8,
                'Fake Attendance': 2
            },
            byBu: {
                NIS: { total: 100, Absent: 5, 'Attend on Time': 90, Delay: 4, 'Fake Attendance': 1 },
                Wireless: { total: 80, Absent: 5, 'Attend on Time': 70, Delay: 4, 'Fake Attendance': 1 }
            }
        },
        payload: {
            version: 1,
            sheets: [
                { id: 's1', category: 'qr', fileName: 'QR_20260922.xlsx', headers: ['Task ID', 'Apply Accountid'], rows: [['QR001', 'U1001']] }
            ],
            customerMappings: [{ from: 'Orange', to: 'ORG' }],
            attendanceRules: { onTime: '10:00', fake: '11:00' },
            exemptions: [{ name: 'liqiyan', account: '' }]
        }
    };

    // 1. Create
    const saved = await repo.saveSnapshot(testSnapshot);
    assert.equal(saved.id, testId);
    assert.equal(saved.title, '2026-09-22 埃及网安例会考勤分析');
    assert.equal(saved.meetingDate, '2026-09-22');
    assert.equal(saved.summary.totalAttendees, 180);
    assert.equal(saved.summary.onTimeRate, '92.5%');
    assert.equal(saved.payload.sheets.length, 1);

    // 2. List (default: omits payload)
    const list = await repo.listSnapshots({ search: '网安例会' });
    assert.ok(list.length >= 1);
    const found = list.find(s => s.id === testId);
    assert.ok(found, 'Should find the created snapshot in list');
    assert.equal(found.title, '2026-09-22 埃及网安例会考勤分析');
    assert.equal(found.meeting_date, '2026-09-22');
    assert.equal(found.summary.totalAttendees, 180);
    assert.equal(found.payload, undefined, 'List should omit payload by default');

    // 3. List with date filtering
    const listDateMatch = await repo.listSnapshots({ startDate: '2026-09-01', endDate: '2026-09-30' });
    assert.ok(listDateMatch.some(s => s.id === testId));

    const listDateMismatch = await repo.listSnapshots({ startDate: '2026-10-01' });
    assert.ok(!listDateMismatch.some(s => s.id === testId));

    // 4. Get by ID (includes payload)
    const fetched = await repo.getSnapshot(testId);
    assert.ok(fetched);
    assert.equal(fetched.id, testId);
    assert.equal(fetched.title, '2026-09-22 埃及网安例会考勤分析');
    assert.equal(fetched.payload.version, 1);
    assert.equal(fetched.payload.sheets[0].fileName, 'QR_20260922.xlsx');
    assert.deepEqual(fetched.payload.customerMappings, [{ from: 'Orange', to: 'ORG' }]);

    // 5. Rename
    const renamed = await repo.renameSnapshot(testId, '2026-09-22 埃及网安例会终版考勤分析');
    assert.equal(renamed.title, '2026-09-22 埃及网安例会终版考勤分析');
    const checkRenamed = await repo.getSnapshot(testId);
    assert.equal(checkRenamed.title, '2026-09-22 埃及网安例会终版考勤分析');

    // 6. Delete
    const deleted = await repo.deleteSnapshot(testId);
    assert.equal(deleted, true);
    const checkDeleted = await repo.getSnapshot(testId);
    assert.equal(checkDeleted, null);
});

test('bundled tool-msf5b7nn index.html embeds snapshot UI controls', () => {
    const builtinPath = path.join(__dirname, '../backend/builtin-tools/tool-msf5b7nn/index.html');

    const builtinHtml = fs.readFileSync(builtinPath, 'utf8');

    // Top buttons
    assert.match(builtinHtml, /id="saveSnapshotBtn"/);
    assert.match(builtinHtml, /id="manageSnapshotsBtn"/);

    // Modals
    assert.match(builtinHtml, /id="saveSnapshotModal"/);
    assert.match(builtinHtml, /id="snapTitleInput"/);
    assert.match(builtinHtml, /id="snapDateInput"/);
    assert.match(builtinHtml, /id="saveSnapshotSubmitBtn"/);

    assert.match(builtinHtml, /id="snapshotModal"/);
    assert.match(builtinHtml, /id="smSearchInput"/);
    assert.match(builtinHtml, /id="smImportBtn"/);
    assert.match(builtinHtml, /id="smNewSnapshotBtn"/);
    assert.match(builtinHtml, /id="smListContainer"/);
});

function loadSandboxTool(minSessionRecords = 1) {
    const htmlPath = path.resolve(__dirname, '../backend/builtin-tools/tool-msf5b7nn/index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Script block should exist in index.html');
    const scriptContent = scriptMatch[1];

    const mockStorage = new Map();
    const mockLocalStorage = {
        getItem: key => mockStorage.get(key) || null,
        setItem: (key, val) => mockStorage.set(key, String(val)),
        removeItem: key => mockStorage.delete(key),
        clear: () => mockStorage.clear()
    };
    const mockSessionStorage = {
        getItem: key => mockStorage.get('session:' + key) || null,
        setItem: (key, val) => mockStorage.set('session:' + key, String(val)),
        removeItem: key => mockStorage.delete('session:' + key),
        clear: () => mockStorage.clear()
    };

    const mockElement = {
        classList: { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false },
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {},
        setAttribute: () => {},
        style: {},
        innerHTML: '',
        textContent: '',
        value: ''
    };

    const sandbox = {
        console,
        Date,
        Math,
        Number,
        String,
        Set,
        Map,
        Array,
        RegExp,
        Intl,
        JSON,
        setTimeout: () => {},
        clearTimeout: () => {},
        requestAnimationFrame: cb => cb(),
        localStorage: mockLocalStorage,
        sessionStorage: mockSessionStorage,
        document: {
            documentElement: { lang: 'zh-CN' },
            title: '',
            querySelector: () => mockElement,
            querySelectorAll: () => [],
            createElement: () => ({ ...mockElement }),
            addEventListener: () => {}
        },
        window: {}
    };
    sandbox.window = sandbox;

    vm.runInNewContext(scriptContent, sandbox);
    const api = sandbox.window.__meetingAttendance;
    if (minSessionRecords !== null) api.state.attendanceRules.minSessionRecords = minSessionRecords;
    return api;
}

test('person search follows the selected meeting and labels each order window', () => {
    const api = loadSandboxTool();
    api.state.attendanceRules.orderWindowMonths = 1;
    api.state.personSearch.query = 'U10001';
    api.state.sheets = [
        { id: 'qr', category: 'qr', fileName: 'QR.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID', 'Apply Accountid', 'Apply Fullname', 'Create Time'], rows: [
              ['QR20260715A', 'U10001', 'Alice', '2026-07-15 09:00:00'],
              ['QR20260915B', 'U10001', 'Alice', '2026-09-15 09:00:00'],
              ['QR20260415C', 'U10001', 'Alice', '2026-04-15 09:00:00']
          ] },
        { id: 'july', category: 'offline', fileName: '2026-07-28 现场签到.xlsx', sheetName: 'Sheet1',
          headers: ['工号', '姓名', '签到时间'], rows: [['U10001', 'Alice', '2026-07-28 14:45:00']] },
        { id: 'september', category: 'offline', fileName: '2026-09-22 现场签到.xlsx', sheetName: 'Sheet1',
          headers: ['工号', '姓名', '签到时间'], rows: [['U10001', 'Alice', '2026-09-22 14:45:00']] }
    ];
    const ids = new Set(['U10001']);
    const sessions = api.getMeetingSessions();
    assert.equal(sessions.length, 2);

    api.state.selectedSession = sessions[0].name;
    assert.deepEqual(Array.from(api.searchRequiredRows('qr', 'alice', ids), row => row.ticketDate), ['2026-07-15']);
    assert.deepEqual(Array.from(api.searchAttendanceRows('offline', 'alice', ids), row => row.fileName), ['2026-07-28 现场签到.xlsx']);
    assert.match(api.renderSearchDetailCard('qr', 'QR', api.searchRequiredRows('qr', 'alice', ids)), /6-7月窗口内/);

    api.state.selectedSession = sessions[1].name;
    assert.deepEqual(Array.from(api.searchRequiredRows('qr', 'alice', ids), row => row.ticketDate), ['2026-09-15']);
    assert.deepEqual(Array.from(api.searchAttendanceRows('offline', 'alice', ids), row => row.fileName), ['2026-09-22 现场签到.xlsx']);
    assert.match(api.renderSearchDetailCard('qr', 'QR', api.searchRequiredRows('qr', 'alice', ids)), /8-9月窗口内/);

    api.state.selectedSession = 'all';
    assert.equal(api.searchRequiredRows('qr', 'alice', ids).length, 3);
    assert.equal(api.searchAttendanceRows('offline', 'alice', ids).length, 2);
    assert.equal(api.formatSearchWindowMonths(api.getWindowDateRange('2027-01-28', 1)), '2026年12月-2027年1月');
});

test('business coverage warning compares each source category with every meeting window', () => {
    const api = loadSandboxTool();
    api.state.attendanceRules.orderWindowMonths = 1;
    api.state.sheets = [
        { id: 'july', category: 'offline', fileName: '2026-07-28 现场签到.xlsx', sheetName: '签到',
          headers: ['工号', '姓名', '签到时间'], rows: [['U10001', 'Alice', '2026-07-28 14:45:00'], ['U10002', 'Bob', '']] },
        { id: 'september', category: 'online', fileName: '2026-09-22 在线会议.xlsx', sheetName: '参会',
          headers: ['meeting_title', 'user_id', 'join_time'], rows: [['Sept meeting', 'U10001', '2026-09-22 09:45:00']] },
        { id: 'qr', category: 'qr', fileName: 'QR-all.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID', 'Create Time'], rows: [['QR20260628A', ''], ['QR20260922B', '']] },
        { id: 'rfc', category: 'rfc', fileName: 'RFC-July.xlsx', sheetName: 'Sheet1',
          headers: ['作业单号/Ticket ID', '创建时间/Create Time'], rows: [['RFC20260701A', ''], ['RFC20260720B', '']] },
        { id: 'wfm', category: 'wfm', fileName: 'WFM-unknown.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID', 'Task Create Time'], rows: [['unparsed', 'unparsed']] }
    ];
    const report = api.buildBusinessCoverageReport();
    assert.equal(report.sessions.length, 2);
    assert.equal(report.hasWarning, true);
    const offline = report.attendanceCategories.find(x => x.category === 'offline').sheets[0];
    const online = report.attendanceCategories.find(x => x.category === 'online').sheets[0];
    assert.equal(report.attendanceCategories.find(x => x.category === 'offline').comparisonMissingMonths.join(','), '2026-09');
    assert.equal(report.attendanceCategories.find(x => x.category === 'online').comparisonMissingMonths.join(','), '2026-07');
    assert.equal(new Date(offline.startMs).toISOString().slice(0, 10), '2026-07-28');
    assert.equal(offline.datedRows, 1, 'a file name must not supply a missing check-in date');
    assert.equal(offline.totalRows, 2);
    assert.equal(new Date(online.startMs).toISOString().slice(0, 10), '2026-09-22');
    assert.equal(online.datedRows, 1);
    const qr = report.categories.find(x => x.category === 'qr');
    const rfc = report.categories.find(x => x.category === 'rfc');
    const wfm = report.categories.find(x => x.category === 'wfm');
    assert.equal(qr.gaps.length, 0, 'a recognized span across both windows does not warn');
    assert.equal(qr.missingMonths.join(','), '2026-07,2026-08', 'intervening months without records must be visible even when date endpoints span the windows');
    assert.equal(qr.sheets[0].missingMonths.join(','), '2026-07,2026-08');
    assert.equal(rfc.sheets[0].datedRows, 2);
    assert.equal(new Date(rfc.startMs).toISOString().slice(0, 10), '2026-07-01');
    assert.equal(new Date(rfc.endMs).toISOString().slice(0, 10), '2026-07-20');
    assert.equal(rfc.gaps.length, 2);
    assert.equal(rfc.gaps[0].windowRange.startDateStr, '2026-06-28');
    assert.equal(rfc.gaps[1].windowRange.startDateStr, '2026-08-22');
    assert.equal(wfm.sheets[0].datedRows, 0);
    assert.equal(wfm.gaps.length, 2);
});

test('coverage sheets sort by recognized date and category gaps use all sheets together', () => {
    const api = loadSandboxTool();
    api.state.sheets = [
        { id: 'meeting', category: 'online', fileName: 'Meeting.xlsx', sheetName: 'Join',
          headers: ['meeting_title', 'user_id', 'join_time'], rows: [['July meeting', 'U10001', '2026-07-28 09:00:00']] },
        { id: 'september', category: 'qr', fileName: 'September.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID'], rows: [['QR20260903A']] },
        { id: 'undated', category: 'qr', fileName: 'Unknown.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID'], rows: [['unknown']] },
        { id: 'mixed', category: 'qr', fileName: 'June-September.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID'], rows: [['QR20260620A'], ['QR20260901B']] },
        { id: 'august', category: 'qr', fileName: 'August.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID'], rows: [['QR20260810A']] }
    ];
    const qr = api.buildBusinessCoverageReport().categories.find(item => item.category === 'qr');
    assert.equal(qr.sheets.map(sheet => sheet.fileName).join(','), 'June-September.xlsx,August.xlsx,September.xlsx,Unknown.xlsx');
    assert.equal(qr.sheets[0].missingMonths.join(','), '2026-07,2026-08');
    assert.equal(qr.missingMonths.join(','), '2026-07', 'August is covered by another QR sheet');
    assert.equal(api.buildBusinessCoverageReport().attendanceCategories.find(item => item.category === 'online').comparisonMissingMonths.length, 0, 'a missing optional attendance source must not create comparison warnings');
});

test('on-site and online month comparison uses Cairo-adjusted check-in dates', () => {
    const api = loadSandboxTool();
    api.state.sheets = [
        { id: 'onsite', category: 'offline', fileName: 'On-site.xlsx', sheetName: 'Scan',
          headers: ['工号', '签到时间'], rows: [['U10001', '2026-08-01 00:30:00']] },
        { id: 'remote', category: 'online', fileName: 'Online.xlsx', sheetName: 'Join',
          headers: ['user_id', 'join_time'], rows: [['U10002', '2026-07-31 19:30:00']] }
    ];
    const [onsite, remote] = api.buildBusinessCoverageReport().attendanceCategories;
    assert.equal(onsite.observedMonths.join(','), '2026-07');
    assert.equal(remote.observedMonths.join(','), '2026-07');
    assert.equal(onsite.comparisonMissingMonths.length, 0);
    assert.equal(remote.comparisonMissingMonths.length, 0);
});

test('meeting cards flag the attendance source missing in that meeting month', async () => {
    const api = loadSandboxTool();
    api.state.sheets = [
        { id: 'july', category: 'offline', fileName: 'July onsite.xlsx', sheetName: 'Scan',
          headers: ['工号', '签到时间'], rows: [['U10001', '2026-07-28 14:45:00']] },
        { id: 'september', category: 'online', fileName: 'September online.xlsx', sheetName: 'Join',
          headers: ['meeting_title', 'user_id', 'join_time'], rows: [['September meeting', 'U10002', '2026-09-22 09:45:00']] }
    ];
    const cache = await api.ensurePeopleCache();
    assert.equal(cache.sessions.length, 2);
    const cards = api.renderMultiSessionOverview(cache.sessions, cache);
    assert.equal((cards.match(/class="session-card coverage-warning"/g) || []).length, 2);
    assert.match(cards, /在线会议数据疑似缺失/);
    assert.match(cards, /现场签到数据疑似缺失/);
    assert.ok(cards.indexOf('在线会议数据疑似缺失') < cards.indexOf('现场签到数据疑似缺失'), 'July card flags online data; September card flags on-site data');

    api.state.sheets.push(
        { id: 'july-online', category: 'online', fileName: 'July online.xlsx', sheetName: 'Join',
          headers: ['meeting_title', 'user_id', 'join_time'], rows: [['July meeting', 'U10001', '2026-07-28 09:45:00']] },
        { id: 'september-onsite', category: 'offline', fileName: 'September onsite.xlsx', sheetName: 'Scan',
          headers: ['工号', '签到时间'], rows: [['U10002', '2026-09-22 14:45:00']] }
    );
    api.invalidatePeopleCache();
    const covered = await api.ensurePeopleCache();
    assert.doesNotMatch(api.renderMultiSessionOverview(covered.sessions, covered), /session-card coverage-warning/);
});

test('QR, RFC, and WFM people lists show ticket dates while attendance waits for a meeting', async () => {
    const api = loadSandboxTool();
    assert.equal(api.classifySheet({ name: 'Sheet1', headers: ['Task ID', '工号', '姓名', '签到时间'], rows: [['TK20260804A', 'U10003', 'Charlie', '2026-08-04 23:10:00']] }), 'wfm', 'a WFM export must not be mistaken for meeting check-in data');
    assert.equal(api.classifySheet({ name: 'Sheet1', headers: ['作业单号/Ticket ID', 'Owner'], rows: [['NE20260716A', 'Bob U10002']] }), 'rfc');
    assert.equal(api.classifySheet({ name: 'Sheet1', headers: ['实施任务单号/Implementation Task No', 'FME Name'], rows: [['TE-20260804A', 'Charlie U10003']] }), 'wfm');
    assert.equal(api.classifySheet({ name: 'Sheet1', headers: ['作业单号/Ticket ID', '实施任务单号/Implementation Task No'], rows: [['NE20260716A', 'TE20260804A']] }), 'wfm', 'an implementation task takes precedence over its linked RFC');
    api.state.attendanceRules.orderWindowMonths = 0;
    api.state.attendanceRules.meetingDate = '2026-08-05';
    api.state.sheets = [
        { id: 'qr', category: 'qr', fileName: 'QR.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID', 'Apply Accountid', 'Apply Fullname', 'Create Time'],
          rows: [['QR20260715A', 'U10001', 'Alice', '2026-07-15 09:10:00']] },
        { id: 'rfc', category: 'rfc', fileName: 'RFC.xlsx', sheetName: 'Sheet1',
          headers: ['作业单号/Ticket ID', 'Owner', '创建时间/Create Time'],
          rows: [['NE20260716A', 'Bob U10002', '2026-07-16 11:20:00']] },
        { id: 'wfm', category: 'wfm', fileName: 'WFM.xlsx', sheetName: 'Sheet1',
          headers: ['Task ID', 'FME Name', 'Task Create Time', '任务结束时间'],
          rows: [['TE20260804A', 'Charlie U10003', '2026-08-04 23:10:00', '2026-08-05 03:00:00']] }
    ];
    assert.equal(api.isNightWfmTask(api.state.sheets[2], api.state.sheets[2].rows[0], '2026-08-05').isNight, true);
    const sources = [api.extractQrPeople(), api.extractRfcPeople(), api.extractWfmPeople()];
    for (const [index, ticketDate, createTime] of [
        [0, '2026-07-15', '2026-07-15 09:10:00'],
        [1, '2026-07-16', '2026-07-16 11:20:00'],
        [2, '2026-08-04', '2026-08-04 23:10:00']
    ]) {
        assert.ok(sources[index].some(person => person.ticketDates.includes(ticketDate)));
        assert.ok(sources[index].some(person => person.createTimes.includes(createTime)));
        const card = api.renderPeopleCard(['qr', 'rfc', 'wfm'][index], 'Source people', sources[index]);
        assert.match(card, /工单号日期/);
        assert.match(card, /原表创建时间/);
        assert.ok(card.includes(ticketDate));
        assert.ok(card.includes(createTime));
    }
    const businessOnly = api.extractAllPeople();
    assert.ok(businessOnly.every(person => person.attendance === 'Not Evaluated' && !person.attendanceMethod));
    assert.ok(api.extractWfmPeople().every(person => !person.isNightWfmExempt));
    const pendingWfmSearch = api.searchRequiredRows('wfm', 'charlie', new Set(['U10003']));
    assert.equal(pendingWfmSearch.length, 1);
    assert.equal(pendingWfmSearch[0].isNightWfm, false);
    assert.deepEqual(Array.from(api.buildAnalysisTables(businessOnly).summary[0]), ['Meeting Session', 'BU', 'Total People', 'Awaiting Check-in Data']);
    assert.doesNotMatch(api.renderCombinedPeopleCard(businessOnly), /🌙 前夜WFM豁免/);
    await assert.rejects(api.buildSnapshotPayload('仅业务表', '2026-08-05'), /请先导入现场签到或在线入会表/);
    api.state.sheets[0].rows.push(['QR20260415A', 'U10004', 'Older Order', '2026-04-15 09:00:00']);
    api.state.attendanceRules.orderWindowMonths = 1;
    api.invalidatePeopleCache();
    const pendingWithWindow = api.extractAllPeople();
    assert.equal(pendingWithWindow.find(person => person.account === 'U10004').attendance, 'Not Evaluated', 'an old business order is not discarded before a meeting is imported');
    api.state.sheets = [api.state.sheets[2]];
    const onlyWfm = api.extractAllPeople();
    assert.equal(onlyWfm.length, 1);
    assert.equal(onlyWfm[0].attendance, 'Not Evaluated');
    assert.equal(onlyWfm[0].attendanceMethod, '');
    assert.equal(onlyWfm[0].attendanceTime, '', 'a WFM task timestamp is never a check-in timestamp');
    api.state.sheets.push({ id: 'meeting', category: 'offline', fileName: '2026-08-05 现场签到.xlsx', sheetName: 'Sheet1',
        headers: ['工号', '姓名', '签到时间'], rows: [['U90001', 'Other Attendee', '2026-08-05 10:00:00']] });
    api.invalidatePeopleCache();
    const afterMeetingImport = await api.ensurePeopleCache();
    assert.equal(afterMeetingImport.all.find(person => person.account === 'U10003').attendanceMethod, '前夜WFM豁免');
    assert.equal(afterMeetingImport.wfm.some(person => person.isNightWfmExempt), true);
});

test('buildSnapshotPayload and restoreMeetingSnapshot handle state serialization and restoration', async () => {
    const api = loadSandboxTool();

    // Prepare mock state in tool
    api.state.sheets = [
        {
            id: 'sheet_1',
            category: 'qr',
            fileName: 'QR_Attendance_2026-09-22.xlsx',
            sheetName: 'Sheet1',
            headers: ['Task ID', 'Apply Accountid', 'Apply Fullname', 'BU', 'Customer Group'],
            rows: [
                ['QR1001', 'U90001', 'Test Engineer', 'NIS', 'ET']
            ],
            visibleColumns: [0, 1, 2, 3, 4],
            page: 1,
            order: 1
        },
        {
            id: 'sheet_2',
            category: 'offline',
            fileName: 'Offline_Scan_2026-09-22.xlsx',
            sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'],
            rows: [
                ['U90001', 'Test Engineer', '2026-09-22 10:30:00']
            ],
            visibleColumns: [0, 1, 2],
            page: 1,
            order: 2
        }
    ];

    // 1. Build Snapshot Payload
    const snapshot = await api.buildSnapshotPayload('2026-09-22 自动测试快照', '2026-09-22');
    assert.equal(snapshot.title, '2026-09-22 自动测试快照');
    assert.equal(snapshot.meetingDate, '2026-09-22');
    assert.equal(snapshot.summary.sheetCount, 2);
    assert.equal(snapshot.summary.totalRows, 2);
    assert.equal(snapshot.summary.totalAttendees, 1);
    assert.equal(snapshot.summary.counts['Attend on Time'], 1);
    assert.equal(snapshot.summary.onTimeRate, '100.0%');
    assert.equal(snapshot.payload.sheets.length, 2);

    // 2. Clear state
    api.state.sheets = [];
    assert.equal(api.state.sheets.length, 0);

    // 3. Restore Snapshot
    api.restoreMeetingSnapshot(snapshot);
    assert.equal(api.state.sheets.length, 2);
    assert.equal(api.state.sheets[0].fileName, 'QR_Attendance_2026-09-22.xlsx');
    assert.equal(api.state.sheets[0].rows[0][0], 'QR1001');
    assert.equal(api.state.sheets[1].category, 'offline');
    assert.equal(api.state.active, 'people');
});

test('multi-meeting session detection, per-session switching, and matrix comparison', async () => {
    const api = loadSandboxTool();

    // Import QR roster (baseline people)
    api.state.sheets = [
        {
            id: 'sheet_qr',
            category: 'qr',
            fileName: 'QR_Baseline.xlsx',
            sheetName: 'Sheet1',
            headers: ['BU', 'Customer Group', 'Apply Full Name', 'Apply Account ID', 'TD Full Name', 'TD'],
            rows: [
                ['Software', 'ET', 'Alice User', 'U10001', 'Bob TD', 'U10002']
            ],
            visibleColumns: [0, 1, 2, 3, 4, 5],
            page: 1,
            order: 1
        },
        // Session 1 Offline Scan
        {
            id: 'sheet_sess1_offline',
            category: 'offline',
            fileName: '2026-09-22 网安例会_签到.xlsx',
            sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'],
            rows: [
                ['U10001', 'Alice User', '2026-09-22 10:30:00'],
                ['U10002', 'Bob TD', '2026-09-22 18:30:00']
            ],
            visibleColumns: [0, 1, 2],
            page: 1,
            order: 2
        },
        // Session 2 Offline Scan
        {
            id: 'sheet_sess2_offline',
            category: 'offline',
            fileName: '2026-09-29 网安例会_签到.xlsx',
            sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'],
            rows: [
                ['U10001', 'Alice User', '2026-09-29 10:30:00']
            ],
            visibleColumns: [0, 1, 2],
            page: 1,
            order: 3
        }
    ];

    // 1. Session Title Normalization
    assert.equal(api.cleanSessionTitle('2026-09-22 网安例会_签到.xlsx'), '2026-09-22 网安例会');
    assert.equal(api.cleanSessionTitle('2026-09-22 网安例会_入会记录.xlsx'), '2026-09-22 网安例会');
    assert.equal(api.cleanSessionTitle('2026-09-29 网安例会-现场签到.xlsx'), '2026-09-29 网安例会');

    // 2. Discover sessions
    const sessions = api.getMeetingSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].name, '2026-09-22 网安例会');
    assert.equal(sessions[1].name, '2026-09-29 网安例会');
    assert.deepEqual(Array.from(api.getSessionDisplayLabels(sessions)), ['2026-09-22-现场签到', '2026-09-29-现场签到']);
    assert.deepEqual(Array.from(api.getSessionDisplayLabels([
        { name: '上午长文件名', date: '2026-09-22', offlineSheets: 1, onlineSheets: 0 },
        { name: '下午长文件名', date: '2026-09-22', offlineSheets: 1, onlineSheets: 0 }
    ])), ['2026-09-22-现场签到', '2026-09-22-现场签到 · 2']);
    const switcher = api.renderSessionSwitcher(sessions, sessions[0].name);
    assert.match(switcher, /2026-09-22-现场签到/);
    assert.match(switcher, /data-session="2026-09-22 网安例会"/);

    // 3. Process people cache
    const cache = await api.ensurePeopleCache();
    assert.equal(cache.sessions.length, 2);
    assert.equal(cache.all.length, 2);

    const alice = cache.all.find(p => p.account === 'U10001');
    const bob = cache.all.find(p => p.account === 'U10002');
    assert.ok(alice, 'Alice should be in cache');
    assert.ok(bob, 'Bob should be in cache');

    // Alice attended both sessions on-time -> 全勤 (全准时)
    assert.equal(alice.sessionRecords['2026-09-22 网安例会'].attendance, 'Attend on Time');
    assert.equal(alice.sessionRecords['2026-09-29 网安例会'].attendance, 'Attend on Time');
    assert.match(alice.multiSessionStatus, /全勤/);

    // Bob only attended session 1 -> 部分出席
    assert.notEqual(bob.sessionRecords['2026-09-22 网安例会'].attendance, 'Absent');
    assert.equal(bob.sessionRecords['2026-09-29 网安例会'].attendance, 'Absent');
    assert.equal(bob.sessionRecords['2026-09-22 网安例会'].attendance, 'Fake Attendance');
    assert.match(bob.multiSessionStatus, /全部缺席/);
    const snapshot = await api.buildSnapshotPayload('多场次考勤测试', '2026-09-22');
    const bobSessions = snapshot.summary.sessionAttendees.filter(p => p.account === 'U10002');
    assert.equal(bobSessions.length, 2);
    assert.equal(bobSessions.find(p => p.date === '2026-09-29').attendance, 'Absent');

    // 4. Session-specific row mapping
    const sess1Rows = api.getSessionPeopleRows(cache.all, '2026-09-22 网安例会');
    const sess1Alice = sess1Rows.find(p => p.account === 'U10001');
    assert.equal(sess1Alice.attendance, 'Attend on Time');

    const sess2Rows = api.getSessionPeopleRows(cache.all, '2026-09-29 网安例会');
    const sess2Bob = sess2Rows.find(p => p.account === 'U10002');
    assert.equal(sess2Bob.attendance, 'Absent');

    // 5. Multi-session export tables
    const tables = api.buildAnalysisTables(cache.all);
    assert.ok(tables.multiMatrix, 'Multi-session matrix table should be generated');
    assert.equal(tables.multiMatrix[0][4], '2026-09-22 网安例会');
    assert.equal(tables.multiMatrix[0][5], '2026-09-29 网安例会');
    assert.equal(tables.multiMatrix[0][6], 'Overall Status');

    // 6. Test fallback when only attendance files imported without QR/RFC/WFM
    api.state.sheets = [
        {
            id: 'offline_1',
            category: 'offline',
            fileName: '会议A_签到.xlsx',
            sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间', 'BU'],
            rows: [
                ['U88801', 'Charlie Standalone', '2026-09-22 10:30:00', 'IT-BU']
            ],
            visibleColumns: [0, 1, 2, 3],
            page: 1,
            order: 1
        }
    ];
    api.invalidatePeopleCache();
    const sourcePeople = api.extractAttendanceSourcePeople();
    assert.equal(sourcePeople.length, 1);
    assert.equal(sourcePeople[0].account, 'U88801');
    assert.equal(sourcePeople[0].name, 'Charlie Standalone');

    const fallbackAll = api.extractAllPeople([], [], [], new Map());
    assert.equal(fallbackAll.length, 1);
    assert.equal(fallbackAll[0].account, 'U88801');
});

test('on-site and online records at the same meeting time form one session', async () => {
    const api = loadSandboxTool();
    api.state.sheets = [
        {
            id: 'on_site', category: 'offline', fileName: '2026-09-22 现场扫码.xlsx', sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'], rows: [
                ['U10001', 'On-site Only', '2026-09-22 14:45:00'],
                ['U10003', 'Both Sources', '2026-09-22 14:55:00']
            ]
        },
        {
            id: 'online', category: 'online', fileName: 'meeting.xlsx', sheetName: '入会记录',
            headers: ['meeting_title', 'user_id', 'name', 'join_time'], rows: [
                ['Weekly Quality Meeting', 'U10002', 'Online Only', '2026-09-22 09:50:00'],
                ['Weekly Quality Meeting', 'U10003', 'Both Sources', '2026-09-22 09:40:00']
            ]
        },
        {
            id: 'later', category: 'offline', fileName: '2026-09-22 Late Workshop.xlsx', sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'], rows: [
                ['U10004', 'Later Attendee', '2026-09-22 20:00:00']
            ]
        }
    ];

    const sessions = api.getMeetingSessions();
    assert.equal(sessions.length, 2, 'a different meeting later the same day stays separate');
    const combined = sessions.find(session => session.offlineSheets === 1 && session.onlineSheets === 1);
    assert.ok(combined, 'on-site and online sheets should merge');
    assert.equal(combined.rowCount, 4);
    assert.ok(api.getSessionDisplayLabels(sessions).includes('2026-09-22-现场/在线签到'));

    const cache = await api.ensurePeopleCache();
    for (const account of ['U10001', 'U10002', 'U10003']) {
        const person = cache.all.find(item => item.account === account);
        assert.equal(person.sessionRecords[combined.name].attendance, 'Attend on Time', account);
    }
    assert.equal(cache.sessionStats[combined.name].total, 3);
    assert.equal(cache.all.find(item => item.account === 'U10004').sessionRecords[combined.name].required, false);
    assert.equal(cache.all.find(item => item.account === 'U10003').sessionRecords[combined.name].attendanceMethod, '线上会议');
});

test('same-day on-site sheets merge into one session and card hover lists every source sheet', async () => {
    const api = loadSandboxTool(null);
    const headers = ['工号', '姓名', '签到时间'];
    const firstRows = Array.from({ length: 5 }, (_, i) => [`U8000${i}`, `Person ${i}`, '2026-07-28 14:45:00']);
    const secondRows = Array.from({ length: 5 }, (_, i) => [`U8000${i ? i + 4 : 0}`, `Other ${i}`, '2026-07-28 14:50:00']);
    api.state.sheets = [
        { id: 'first', category: 'offline', fileName: '2026-07-28 现场签到A.xlsx', sheetName: '签到一', headers, rows: firstRows },
        { id: 'second', category: 'offline', fileName: '2026-07-28 现场签到B.xlsx', sheetName: '签到二', headers, rows: secondRows },
        { id: 'later', category: 'offline', fileName: '2026-07-28 晚间活动.xlsx', sheetName: '签到三', headers,
          rows: Array.from({ length: 10 }, (_, i) => [`U9000${i}`, `Later ${i}`, '2026-07-28 20:30:00']) },
        { id: 'duplicate', category: 'offline', fileName: '复制的现场签到A.xlsx', sheetName: '复制表', headers, rows: firstRows.map(row => [...row]) }
    ];
    api.removeDuplicateSheets();
    assert.equal(api.state.sheets.length, 3, 'identical sheet content is skipped');
    const sessions = api.getMeetingSessions();
    assert.equal(sessions.length, 2, 'later same-day meeting stays separate');
    const combined = sessions.find(s => s.offlineSheets === 2);
    assert.ok(combined, 'two nearby on-site sheets should form one session');
    assert.equal(combined.rowCount, 10);
    assert.deepEqual(Array.from(combined.sourceSheets, s => `${s.fileName} / ${s.sheetName}`), [
        '2026-07-28 现场签到A.xlsx / 签到一', '2026-07-28 现场签到B.xlsx / 签到二'
    ]);
    const cache = await api.ensurePeopleCache();
    assert.equal(cache.sessionStats[combined.name].total, 9, 'overlapping employee is counted once');
    const cards = api.renderMultiSessionOverview(cache.sessions, cache);
    assert.match(cards, /session-card-source-tooltip/);
    assert.match(cards, /2026-07-28 现场签到A\.xlsx/);
    assert.match(cards, /2026-07-28 现场签到B\.xlsx/);
    assert.match(cards, /签到一/);
    assert.match(cards, /签到二/);
});

test('distinct meeting titles in one sheet remain separate even when times are close', () => {
    const api = loadSandboxTool(1);
    api.state.sheets = [{
        id: 'online-multiple', category: 'online', fileName: '2026-07-28 入会记录.xlsx', sheetName: '入会记录',
        headers: ['meeting_title', 'user_id', 'name', 'join_time'],
        rows: [
            ['质量例会', 'U81001', 'First', '2026-07-28 09:00:00'],
            ['项目培训', 'U81002', 'Second', '2026-07-28 09:30:00']
        ]
    }];
    assert.equal(api.getMeetingSessions().length, 2);
});

test('session tabs, cards, comparison columns, export, and snapshots follow meeting time', async () => {
    const api = loadSandboxTool(1);
    const sheet = (id, date, time, name) => ({
        id, category: 'offline', fileName: `${date} ${name}.xlsx`, sheetName: 'Sheet1', sessionName: name,
        headers: ['工号', '姓名', '签到时间'], rows: [[`U${id}`, name, `${date} ${time}`]]
    });
    api.state.sheets = [
        sheet('late', '2026-09-22', '14:45:00', '九月下旬'),
        sheet('afternoon', '2026-09-01', '20:45:00', '九月上旬下午'),
        sheet('morning', '2026-09-01', '14:45:00', '九月上旬上午')
    ];
    const sessions = api.getMeetingSessions();
    assert.deepEqual(Array.from(sessions, s => s.name), ['九月上旬上午', '九月上旬下午', '九月下旬']);
    assert.ok(sessions[0].timeMinute < sessions[1].timeMinute);
    const labels = Array.from(api.getSessionDisplayLabels(sessions));
    const ordered = html => {
        let previous = -1;
        for (const label of labels) {
            const index = html.indexOf(label, previous + 1);
            assert.ok(index > previous, `Missing or out-of-order session label: ${label}`);
            previous = index;
        }
    };
    ordered(api.renderSessionSwitcher(sessions, 'all'));
    const cache = await api.ensurePeopleCache();
    const cards = api.renderMultiSessionOverview(cache.sessions, cache);
    ordered(cards);
    assert.equal((cards.match(/class="session-card-month"/g) || []).length, 3);
    assert.match(cards, /session-card-month[^>]*>9月<\/span>/);
    ordered(api.renderMultiSessionBuTable(cache.sessions, cache.all));
    ordered(api.renderMultiSessionMatrixCard(cache.sessions, cache.all));
    const tables = api.buildAnalysisTables(cache.all);
    assert.deepEqual(Array.from(tables.multiMatrix[0].slice(4, 7)), Array.from(sessions, s => s.name));
    const snapshot = await api.buildSnapshotPayload('排序测试', '2026-09-01');
    assert.deepEqual(Array.from(snapshot.summary.sessions, s => s.name), Array.from(sessions, s => s.name));
});

test('each session counts only its own required roster and cross-session full attendance', async () => {
    const api = loadSandboxTool();
    api.state.attendanceRules.orderWindowMonths = 1;
    api.state.mandatoryAttendees = [{ name: 'Manual Required', account: 'U70003', bu: 'NIS' }];
    api.state.sheets = [
        {
            id: 'qr', category: 'qr', fileName: 'QR.xlsx', sheetName: 'Sheet1',
            headers: ['Task ID', 'Create Time', 'Apply Fullname', 'Apply Accountid', 'BU'],
            rows: [
                ['QR20260620000001', '2026-06-20 10:00:00', 'Old Required', 'U70001', 'NIS'],
                ['QR20260910000001', '2026-09-10 10:00:00', 'New Required', 'U70002', 'NIS']
            ]
        },
        {
            id: 'rfc', category: 'rfc', fileName: 'RFC.xlsx', sheetName: 'Sheet1',
            headers: ['Ticket ID', 'Create Time', 'Originator', 'BU'],
            rows: [['NC20260621000001', '2026-06-21 10:00:00', 'RFC Required U70004', 'NIS']]
        },
        {
            id: 'wfm', category: 'wfm', fileName: 'WFM.xlsx', sheetName: 'Sheet1',
            headers: ['Task ID', 'Task Create Time', 'FME Name', 'BU'],
            rows: [['TK20260910000001', '2026-09-10 10:00:00', 'WFM Required U70005', 'NIS']]
        },
        {
            id: 'july', category: 'offline', fileName: '2026-07-01 现场签到.xlsx', sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'], rows: [
                ['U70001', 'Old Required', '2026-07-01 14:45:00'],
                ['U70004', 'RFC Required', '2026-07-01 14:45:00'],
                ['U70003', 'Manual Required', '2026-07-01 14:45:00']
            ]
        },
        {
            id: 'september', category: 'offline', fileName: '2026-09-22 现场签到.xlsx', sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'], rows: [
                ['U70002', 'New Required', '2026-09-22 14:45:00']
            ]
        }
    ];
    const cache = await api.ensurePeopleCache();
    const july = cache.sessions.find(s => s.date === '2026-07-01');
    const september = cache.sessions.find(s => s.date === '2026-09-22');
    assert.equal(cache.sessionStats[july.name].total, 3);
    assert.equal(cache.sessionStats[september.name].total, 3);
    assert.equal(api.getSessionPeopleRows(cache.all, july.name).length, 3);
    assert.equal(api.getSessionPeopleRows(cache.all, september.name).length, 3);
    assert.equal(cache.all.find(p => p.account === 'U70001').sessionRecords[september.name].required, false);
    assert.equal(cache.all.find(p => p.account === 'U70002').sessionRecords[july.name].required, false);
    assert.equal(cache.all.find(p => p.account === 'U70003').sessionRecords[september.name].attendance, 'Absent');
    const html = api.renderMultiSessionBuTable(cache.sessions, cache.all);
    assert.match(html, /应出席人数/);
    assert.match(html, /总全勤率/);
    assert.match(html, /100\.0% <small>\(3\/3\)<\/small>/);
    assert.match(html, /33\.3% <small>\(1\/3\)<\/small>/);
    assert.match(html, /60\.0% <small>\(3\/5\)<\/small>/);
    const overview = api.renderMultiSessionOverview(cache.sessions, cache);
    assert.match(overview, /QR 1 · RFC 1 · WFM 0/);
    assert.match(overview, /QR 1 · RFC 0 · WFM 1/);
    const snapshot = await api.buildSnapshotPayload('跨场次应出席', '2026-07-01');
    assert.equal(snapshot.summary.sessionAttendees.length, 6);
    assert.equal(snapshot.summary.sessionAttendees.filter(p => p.attendance === 'Absent').length, 2);
});

test('minimum check-in records excludes small sessions and follows the saved threshold', async () => {
    const api = loadSandboxTool(null);
    assert.equal(api.DEFAULT_ATTENDANCE_RULES.minSessionRecords, 10);
    assert.equal(api.state.attendanceRules.minSessionRecords, 10);
    api.state.sheets = [
        {
            id: 'low-offline', category: 'offline', fileName: '2026-09-01 现场.xlsx', sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'],
            rows: Array.from({ length: 5 }, (_, i) => [`L1000${i}`, `Low ${i}`, '2026-09-01 14:45:00'])
        },
        {
            id: 'low-online', category: 'online', fileName: 'online.xlsx', sheetName: '入会记录',
            headers: ['meeting_title', 'user_id', 'name', 'join_time'],
            rows: Array.from({ length: 4 }, (_, i) => ['September Meeting', `O1000${i}`, `Online ${i}`, '2026-09-01 09:45:00'])
        },
        {
            id: 'high-offline', category: 'offline', fileName: '2026-09-22 现场.xlsx', sheetName: 'Sheet1',
            headers: ['工号', '姓名', '签到时间'],
            rows: Array.from({ length: 10 }, (_, i) => [`H1000${i}`, `High ${i}`, '2026-09-22 14:45:00'])
        }
    ];
    assert.equal(api.getIgnoredMeetingSessions().length, 1);
    assert.equal(api.getIgnoredMeetingSessions()[0].rowCount, 9);
    assert.equal(api.getMeetingSessions().length, 1);
    assert.equal(api.getMeetingSessions()[0].rowCount, 10);
    assert.deepEqual(Array.from(api.getAllMeetingDates()), ['2026-09-22']);
    assert.equal(api.buildAttendanceIndex().has('l10000'), false);
    const cache = await api.ensurePeopleCache();
    assert.equal(cache.all.length, 10);
    const snapshot = await api.buildSnapshotPayload('最低记录数测试', '2026-09-22');
    assert.equal(snapshot.payload.attendanceRules.minSessionRecords, 10);
    assert.equal(snapshot.summary.attendees.length, 10);

    api.state.attendanceRules.minSessionRecords = 9;
    api.invalidatePeopleCache();
    assert.equal(api.getMeetingSessions().length, 2);
    assert.equal(api.getIgnoredMeetingSessions().length, 0);
    const expanded = await api.ensurePeopleCache();
    assert.equal(expanded.all.length, 19);

    api.state.attendanceRules.minSessionRecords = 11;
    api.invalidatePeopleCache();
    assert.equal(api.getMeetingSessions().length, 0);
    assert.equal(api.buildAttendanceIndex().size, 0);
    await assert.rejects(api.buildSnapshotPayload('无有效场次', '2026-09-22'), /最少签到记录数/);

    const legacy = { ...snapshot, payload: { ...snapshot.payload, attendanceRules: { ...snapshot.payload.attendanceRules } } };
    delete legacy.payload.attendanceRules.minSessionRecords;
    api.restoreMeetingSnapshot(legacy);
    assert.equal(api.state.attendanceRules.minSessionRecords, 10);
});

test('meeting-snapshots REST API routes respond correctly to GET, POST, PUT, DELETE', async () => {
    const express = require('express');
    const meetingRoutes = require('../backend/routes/meeting-snapshots');
    const app = express();
    app.use(express.json());
    app.use('/api/meeting-snapshots', meetingRoutes);

    const server = app.listen(0);
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api/meeting-snapshots`;
    let rostersGetData;

    try {
        // 1. POST /api/meeting-snapshots
        const postRes = await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'HTTP Route Test Snapshot',
                meetingDate: '2026-09-22',
                summary: { totalAttendees: 50 },
                payload: { sheets: [] }
            })
        });
        assert.equal(postRes.status, 201);
        const postData = await postRes.json();
        assert.equal(postData.success, true);
        const newId = postData.data.id;
        assert.ok(newId);

        // 2. GET /api/meeting-snapshots (list)
        const listRes = await fetch(`${base}?search=HTTP+Route`);
        assert.equal(listRes.status, 200);
        const listData = await listRes.json();
        assert.equal(listData.success, true);
        assert.ok(listData.data.some(s => s.id === newId));

        // 3. GET /api/meeting-snapshots/:id (detail)
        const getRes = await fetch(`${base}/${newId}`);
        assert.equal(getRes.status, 200);
        const getData = await getRes.json();
        assert.equal(getData.success, true);
        assert.equal(getData.data.title, 'HTTP Route Test Snapshot');

        // 4. PUT /api/meeting-snapshots/:id (rename)
        const putRes = await fetch(`${base}/${newId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'HTTP Renamed Snapshot' })
        });
        assert.equal(putRes.status, 200);
        const putData = await putRes.json();
        assert.equal(putData.success, true);
        assert.equal(putData.data.title, 'HTTP Renamed Snapshot');

        // 5. DELETE /api/meeting-snapshots/:id
        const delRes = await fetch(`${base}/${newId}`, { method: 'DELETE' });
        assert.equal(delRes.status, 200);
        const delData = await delRes.json();
        assert.equal(delData.success, true);

        // Verify deleted
        const checkRes = await fetch(`${base}/${newId}`);
        assert.equal(checkRes.status, 404);

        // 6. GET /api/meeting-snapshots/settings/rosters
        const rostersGetRes = await fetch(`${base}/settings/rosters`);
        assert.equal(rostersGetRes.status, 200);
        rostersGetData = await rostersGetRes.json();
        assert.equal(rostersGetData.success, true);
        assert.ok(Array.isArray(rostersGetData.data.mandatoryAttendees));
        assert.ok(Array.isArray(rostersGetData.data.exemptions));

        // 7. PUT /api/meeting-snapshots/settings/rosters
        const rostersPutRes = await fetch(`${base}/settings/rosters`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mandatoryAttendees: [
                    { name: 'IntegrationMan', account: 'u_int_man', bu: 'BU_Int', customer: 'Cust_Int', role: '其他必选' }
                ],
                exemptions: [
                    { name: 'IntegrationExempt', account: 'u_int_ex' }
                ]
            })
        });
        assert.equal(rostersPutRes.status, 200);
        const rostersPutData = await rostersPutRes.json();
        assert.equal(rostersPutData.success, true);
        assert.equal(rostersPutData.data.mandatoryAttendees.length, 1);
        assert.equal(rostersPutData.data.mandatoryAttendees[0].account, 'u_int_man');
        assert.equal(rostersPutData.data.exemptions.length, 1);
        assert.equal(rostersPutData.data.exemptions[0].account, 'u_int_ex');
        assert.ok(rostersPutData.data.updatedAt);
    } finally {
        const cleanMandatory = (rostersGetData?.data?.mandatoryAttendees || []).filter(p => p.account !== 'u_int_man');
        const cleanExemptions = (rostersGetData?.data?.exemptions || []).filter(p => p.account !== 'u_int_ex');
        await fetch(`${base}/settings/rosters`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                mandatoryAttendees: cleanMandatory,
                exemptions: cleanExemptions
            })
        }).catch(() => {});
        server.close();
    }
});
