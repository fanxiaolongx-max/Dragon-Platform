const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

const meetingRepo = require('../backend/models/meeting-snapshots-repository');
const incentiveRepo = require('../backend/models/operation-incentive-snapshots-repository');
const deptRepo = require('../backend/models/department-reward-penalty-repository');
const meetingRoutes = require('../backend/routes/meeting-snapshots');
const incentiveRoutes = require('../backend/routes/operation-incentive-snapshots');
const deptRoutes = require('../backend/routes/department-reward-penalty');
const { normalizeStaffId } = require('../backend/models/staff-id-normalization');

test('snapshot roster IDs remove one import prefix and preserve the WX family', () => {
    assert.equal(normalizeStaffId('a00824176'), '00824176');
    assert.equal(normalizeStaffId('m00665597'), '00665597');
    assert.equal(normalizeStaffId('mWX1459632'), 'WX1459632');
    assert.equal(normalizeStaffId('yWX1232731'), 'WX1232731');
    assert.equal(normalizeStaffId('WX1459632'), 'WX1459632');
    assert.equal(normalizeStaffId('T8801'), 'T8801');
});

test('multi-session snapshot exposes each meeting to attendance queries without duplicating roster', async (t) => {
    await meetingRepo.ensureReady();
    const id = `snap_multi_query_${Date.now()}`;
    await meetingRepo.saveSnapshot({
        id,
        title: '多场次会议考勤',
        meetingDate: '2026-09-22',
        summary: {
            attendees: [{ account: 'T99101', name: '跨场次测试人员', attendance: 'Attend on Time', bu: 'NIS' }],
            sessionAttendees: [
                { account: 'T99101', name: '跨场次测试人员', sessionName: '第一场', date: '2026-09-22', attendance: 'Attend on Time', bu: 'NIS' },
                { account: 'T99101', name: '跨场次测试人员', sessionName: '第二场', date: '2026-09-29', attendance: 'Absent', bu: 'NIS' }
            ]
        },
        payload: { sheets: [] }
    });
    t.after(() => meetingRepo.deleteSnapshot(id));

    const single = await meetingRepo.checkPersonAttendance({ staffId: 'T99101' });
    const singleRecords = single.records.filter(item => item.snapshotId === id);
    assert.equal(single.hasRecords, true);
    assert.equal(singleRecords.length, 2);
    assert.equal(singleRecords.find(item => item.sessionName === '第二场').type, 'absent');
    assert.equal(singleRecords.find(item => item.sessionName === '第二场').meetingDate, '2026-09-29');
    assert.equal(singleRecords[0].meetingTitle, '多场次会议考勤');

    const batch = await meetingRepo.batchCheckAttendance([{ staffId: 'T99101' }]);
    const batchRecords = batch['T99101|'].records.filter(item => item.snapshotId === id);
    assert.equal(batchRecords.length, 2);
    assert.equal(batch['T99101|'].hasRecords, true);
    assert.equal(batchRecords.filter(item => item.type === 'absent').length, 1);

    const roster = await meetingRepo.extractRoster();
    assert.equal(roster.filter(item => item.name === '跨场次测试人员').length, 1);
});

test('Cross-tool attendance check & roster extraction integration test', async (t) => {
    await meetingRepo.ensureReady();
    await incentiveRepo.ensureReady();

    const timestamp = Date.now();
    const testMeetingSnapId = `snap_cross_test_meeting_${timestamp}`;
    const testIncentiveSnapId = `snap_cross_test_inc_${timestamp}`;

    // 1. Create a test meeting snapshot with attendees and anomalies in summary
    const meetingSnapshot = {
        id: testMeetingSnapId,
        title: '测试会议考勤快照-跨工具联调',
        meetingDate: '2026-09-22',
        summary: {
            totalAttendees: 3,
            attendees: [
                { account: 'T8801', staffId: 'T8801', name: '王强', customerGroup: 'ET', businessUnit: 'NIS', role: 'TL', attendance: 'Absent' },
                { account: 'T8802', staffId: 'T8802', name: '李芳', customerGroup: 'Orange', businessUnit: 'Wireless', role: 'STAFF', attendance: 'Delay' },
                { account: 'T8803', staffId: 'T8803', name: '张伟', customerGroup: 'ET', businessUnit: 'NIS', role: 'STAFF', attendance: 'Attend on Time' }
            ],
            anomalies: [
                { account: 'T8801', staffId: 'T8801', name: '王强', type: 'absent', attendance: 'Absent', bu: 'NIS', group: 'ET', role: 'TL' },
                { account: 'T8802', staffId: 'T8802', name: '李芳', type: 'delay', attendance: 'Delay', bu: 'Wireless', group: 'Orange', role: 'STAFF' }
            ]
        },
        payload: {
            sheets: [],
            customerMappings: [],
            attendanceRules: { onTime: '10:00', fake: '11:00' }
        }
    };

    // 2. Create a test operation incentive snapshot with rawRows
    const incentiveSnapshot = {
        id: testIncentiveSnapId,
        title: '测试操作激励快照-跨工具联调',
        period: '2026-09',
        summary: {
            totalPeople: 2,
            topPeople: [
                { name: '王强', bu: 'NIS', count: 10, amount: 2800 },
                { name: '赵云', bu: 'Wireless', count: 8, amount: 2000 }
            ]
        },
        payload: {
            rawRows: [
                { task_id: 'WO-8801', complete_operator: '王强 (T8801)', BU1: 'NIS', operate_level: 'High' },
                { task_id: 'WO-8802', complete_operator: '赵云 (T8804)', BU1: 'Wireless', operate_level: 'Medium' }
            ]
        }
    };

    await meetingRepo.saveSnapshot(meetingSnapshot);
    await incentiveRepo.saveSnapshot(incentiveSnapshot);

    t.after(async () => {
        try {
            await meetingRepo.deleteSnapshot(testMeetingSnapId);
        } catch (_) {}
        try {
            await incentiveRepo.deleteSnapshot(testIncentiveSnapId);
        } catch (_) {}
    });

    // Subtest 1: Repository - checkPersonAttendance
    await t.test('meetingRepo.checkPersonAttendance correctly identifies absent, delay, clean, and not-found', async () => {
        // T8801: Absent anomaly
        const resAbsent = await meetingRepo.checkPersonAttendance({ staffId: 'T8801', name: '王强' });
        assert.equal(resAbsent.found, true);
        assert.equal(resAbsent.hasAnomaly, true);
        assert.ok(resAbsent.anomalies.some(a => a.type === 'absent'));

        // T8802: Delay anomaly by name
        const resDelay = await meetingRepo.checkPersonAttendance({ name: '李芳' });
        assert.equal(resDelay.found, true);
        assert.equal(resDelay.hasAnomaly, true);
        assert.ok(resDelay.anomalies.some(a => a.type === 'delay'));

        // T8803: Clean attendance (attend on time)
        const resClean = await meetingRepo.checkPersonAttendance({ staffId: 'T8803' });
        assert.equal(resClean.found, true);
        assert.equal(resClean.hasAnomaly, false);
        assert.ok(resClean.totalMeetingsChecked >= 1);

        // Unknown person
        const resUnknown = await meetingRepo.checkPersonAttendance({ staffId: 'T9999_NON_EXIST', name: '无此人' });
        assert.equal(resUnknown.found, false);
        assert.equal(resUnknown.hasAnomaly, false);
    });

    // Subtest 2: Repository - batchCheckAttendance
    await t.test('meetingRepo.batchCheckAttendance returns batched results for multiple persons', async () => {
        const batch = await meetingRepo.batchCheckAttendance([
            { staffId: 'T8801', name: '王强' },
            { staffId: 'T8803', name: '张伟' },
            { staffId: 'UNKNOWN_999' }
        ]);

        const entries = Object.values(batch);
        assert.equal(entries.length, 3);
        assert.equal(batch['T8801|王强'].hasAnomaly, true);
        assert.equal(batch['T8803|张伟'].hasAnomaly, false);
        assert.equal(batch['T8803|张伟'].found, true);
        assert.equal(batch['UNKNOWN_999|'].found, false);
    });

    // Subtest 3: Repository - extractRoster from meeting & incentive
    await t.test('extractRoster aggregates roster candidates from meeting and incentive snapshots', async () => {
        const meetingRoster = await meetingRepo.extractRoster();
        assert.ok(Array.isArray(meetingRoster));
        const foundWang = meetingRoster.find(r => r.staffId === 'T8801' || r.name === '王强');
        assert.ok(foundWang, 'Meeting roster should contain 王强');
        assert.equal(foundWang.customerGroup, 'ET');
        assert.equal(foundWang.businessUnit, 'NIS');
        assert.equal(foundWang.role, 'TL');
        assert.equal(foundWang.source, 'meeting');

        const incentiveRoster = await incentiveRepo.extractRoster();
        assert.ok(Array.isArray(incentiveRoster));
        const foundZhao = incentiveRoster.find(r => r.name === '赵云' || r.staffId === 'T8804');
        assert.ok(foundZhao, 'Incentive roster should contain 赵云');
        assert.equal(foundZhao.source, 'incentive');
    });

    // Subtest 4: HTTP API Endpoints
    await t.test('HTTP endpoints for cross-tool attendance check and roster extraction respond as expected', async () => {
        const app = express();
        app.use(express.json());
        app.use('/api/meeting-snapshots', meetingRoutes);
        app.use('/api/operation-incentive-snapshots', incentiveRoutes);

        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, resolve));
        const port = server.address().port;
        const meetingBase = `http://127.0.0.1:${port}/api/meeting-snapshots`;
        const incBase = `http://127.0.0.1:${port}/api/operation-incentive-snapshots`;

        try {
            // GET /attendance-check
            const res1 = await fetch(`${meetingBase}/attendance-check?staffId=T8801`);
            assert.equal(res1.status, 200);
            const data1 = await res1.json();
            assert.equal(data1.found, true);
            assert.equal(data1.hasRecords, true);
            assert.equal(data1.hasAnomaly, true);

            // POST /batch-attendance-check
            const res2 = await fetch(`${meetingBase}/batch-attendance-check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    persons: [{ staffId: 'T8801' }, { staffId: 'T8803' }]
                })
            });
            assert.equal(res2.status, 200);
            const data2 = await res2.json();
            assert.equal(Object.keys(data2.results).length, 2);

            // GET /extract-roster (meeting)
            const res3 = await fetch(`${meetingBase}/extract-roster`);
            assert.equal(res3.status, 200);
            const data3 = await res3.json();
            assert.equal(data3.success, true);
            assert.ok(data3.roster.some(r => r.name === '王强'));

            // GET /extract-roster (incentive)
            const res4 = await fetch(`${incBase}/extract-roster`);
            assert.equal(res4.status, 200);
            const data4 = await res4.json();
            assert.equal(data4.success, true);
            assert.ok(data4.roster.some(r => r.name === '赵云'));
        } finally {
            server.close();
        }
    });

    // Subtest 5: Runtime copies may lag source until an administrator applies a managed update.
    await t.test('All 4 integrated tools have versioned sources and managed runtime copies', async () => {
        const tools = ['tool-msf5b7nn', 'reward-program', 'tool-ms4xb66s', 'department-reward-penalty'];
        // Runtime copies only exist on an installed instance; clean checkouts (CI) verify sources only.
        const hasRuntime = fs.existsSync(path.join(__dirname, '..', 'backend', 'data', 'custom-tools'));
        for (const tool of tools) {
            const builtinPath = path.join(__dirname, '..', 'backend', 'builtin-tools', tool, 'index.html');
            const customPath = path.join(__dirname, '..', 'backend', 'data', 'custom-tools', tool, 'index.html');
            assert.ok(fs.existsSync(builtinPath), `builtin tool ${tool} exists`);
            assert.ok(fs.statSync(builtinPath).size > 0, `builtin tool ${tool} is nonempty`);
            if (!hasRuntime) continue;
            assert.ok(fs.existsSync(customPath), `custom tool ${tool} exists`);
            const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(customPath), '.tool-manifest.json'), 'utf8'));
            assert.equal(manifest.system?.managedBy, 'tools-platform', `runtime tool ${tool} is managed`);
        }
    });

    // Subtest 6: Critical UI elements and integration triggers present
    await t.test('Integrated tools contain all required UI hooks, dialogs, and verification logic', async () => {
        // tool-msf5b7nn
        const meetingHtml = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-msf5b7nn', 'index.html'), 'utf8');
        assert.ok(meetingHtml.includes('attendees,') || meetingHtml.includes('attendees:'), 'tool-msf5b7nn must save attendees in snapshot summary');
        assert.ok(meetingHtml.includes('anomalies,') || meetingHtml.includes('anomalies:'), 'tool-msf5b7nn must save anomalies in snapshot summary');

        // reward-program
        const rewardHtml = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'reward-program', 'index.html'), 'utf8');
        assert.ok(rewardHtml.includes('checkPersonAttendanceStatus'), 'reward-program must include checkPersonAttendanceStatus');
        assert.ok(rewardHtml.includes('att-badge'), 'reward-program must include att-badge styles');
        assert.ok(rewardHtml.includes('att-check-indicator'), 'reward-program must include att-check-indicator');

        // tool-ms4xb66s
        const incHtml = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'tool-ms4xb66s', 'index.html'), 'utf8');
        assert.ok(incHtml.includes('attendanceAnomalyModal'), 'tool-ms4xb66s must include attendanceAnomalyModal');
        assert.ok(incHtml.includes('attendanceAnomalyAlert'), 'tool-ms4xb66s must include attendanceAnomalyAlert');
        assert.ok(incHtml.includes('applyAnomaliesToBlacklist'), 'tool-ms4xb66s must include applyAnomaliesToBlacklist');

        // department-reward-penalty
        const deptHtml = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'department-reward-penalty', 'index.html'), 'utf8');
        assert.ok(deptHtml.includes('checkStaffAttendance'), 'department-reward-penalty must include checkStaffAttendance');
        assert.ok(deptHtml.includes('btn-extract-roster'), 'department-reward-penalty must include btn-extract-roster');
        assert.ok(deptHtml.includes('snapshot-roster-dialog'), 'department-reward-penalty must include snapshot-roster-dialog');
        assert.ok(deptHtml.includes('openSnapshotRosterDialog'), 'department-reward-penalty must include openSnapshotRosterDialog');
        assert.ok(deptHtml.includes('confirmImportSnapshotRoster'), 'department-reward-penalty must include confirmImportSnapshotRoster');
        assert.ok(deptHtml.includes('snapshot-mappings-dialog'), 'department-reward-penalty must include snapshot-mappings-dialog');
        assert.ok(deptHtml.includes('extract-mapping-hint-banner'), 'department-reward-penalty must include extract-mapping-hint-banner');
        assert.ok(deptHtml.includes('btn-open-snapshot-mappings'), 'department-reward-penalty must include btn-open-snapshot-mappings');
        assert.ok(deptHtml.includes('resolveMappedRole'), 'department-reward-penalty must include resolveMappedRole');
        assert.ok(deptHtml.includes('resolveMappedCustomerGroup'), 'department-reward-penalty must include resolveMappedCustomerGroup');
    });

    // Subtest 7: Snapshot field mapping configuration & role/customer extraction
    await t.test('department-reward-penalty snapshot mappings API supports GET and PUT persistence', async () => {
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { username: 'test-admin', role: 'admin', tenantId: 'default' };
            next();
        });
        app.use('/api/department-reward-penalty', deptRoutes);

        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, resolve));
        const port = server.address().port;
        const deptBase = `http://127.0.0.1:${port}/api/department-reward-penalty`;

        try {
            // GET /snapshot-mappings
            const resGet = await fetch(`${deptBase}/snapshot-mappings`);
            assert.equal(resGet.status, 200);
            const mappings = await resGet.json();
            assert.ok(Array.isArray(mappings.roles));
            assert.ok(Array.isArray(mappings.customerGroups));
            assert.ok(Array.isArray(mappings.businessUnits));
            assert.ok(mappings.roles.some(m => m.scanned === 'Solution Developer' && m.target === 'TD'));
            assert.ok(mappings.businessUnits.some(m => m.scanned === '软件' && m.target === 'Software'));

            // PUT /snapshot-mappings
            const newMappings = {
                roles: [
                    ...mappings.roles,
                    { scanned: 'Core Engineer', target: 'FME' }
                ],
                customerGroups: [
                    ...mappings.customerGroups,
                    { scanned: 'Zain KSA', target: 'Zain' }
                ],
                businessUnits: [
                    ...mappings.businessUnits,
                    { scanned: '安全', target: 'SEC' }
                ]
            };
            const resPut = await fetch(`${deptBase}/snapshot-mappings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newMappings)
            });
            assert.equal(resPut.status, 200);
            const putResult = await resPut.json();
            assert.equal(putResult.success, true);
            assert.ok(putResult.mappings.roles.some(m => m.scanned === 'Core Engineer' && m.target === 'FME'));
            assert.ok(putResult.mappings.customerGroups.some(m => m.scanned === 'Zain KSA' && m.target === 'Zain'));
            assert.ok(putResult.mappings.businessUnits.some(m => m.scanned === '安全' && m.target === 'SEC'));

            // Verify persistence via GET
            const resVerify = await fetch(`${deptBase}/snapshot-mappings`);
            const verified = await resVerify.json();
            assert.ok(verified.roles.some(m => m.scanned === 'Core Engineer'));
            assert.ok(verified.customerGroups.some(m => m.scanned === 'Zain KSA'));
            assert.ok(verified.businessUnits.some(m => m.scanned === '安全' && m.target === 'SEC'));
        } finally {
            server.close();
        }
    });

    // Subtest 8: Meeting snapshot sheet parsing extracts paired roles and customer group columns
    await t.test('meetingRepo parses complex sheets with paired roles and customer groups', async () => {
        const sheetSnapId = `snap_sheet_test_${Date.now()}`;
        const sheetSnap = {
            id: sheetSnapId,
            title: 'RFC与QR考勤快照测试',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 0,
                attendees: [],
                anomalies: []
            },
            payload: {
                sheets: [
                    {
                        sheetName: 'RFC记录',
                        category: 'rfc',
                        headers: ['RFC单号', '客户群/Customer Group', 'Solution Developer', 'Owner', 'BU'],
                        rows: [
                            ['RFC-1001', 'VF', '赵敏 (T8810)', '张无忌 (T8811)', 'Wireless']
                        ]
                    },
                    {
                        sheetName: 'QR记录',
                        category: 'qr',
                        headers: ['QR单号', 'Customer', 'Apply Fullname', 'Apply AccountID', 'TD Fullname', 'TD', 'Service Type'],
                        rows: [
                            ['QR-2001', 'Orange', '周芷若', 'T8812', '宋青书', 'T8813', 'Core']
                        ]
                    }
                ]
            }
        };

        await meetingRepo.saveSnapshot(sheetSnap);
        try {
            const roster = await meetingRepo.extractRoster();
            const zhaoMin = roster.find(r => r.staffId === 'T8810' || r.name === '赵敏');
            assert.ok(zhaoMin, 'Should extract 赵敏 from RFC sheet');
            assert.equal(zhaoMin.role, 'Solution Developer');
            assert.equal(zhaoMin.customerGroup, 'VF');
            assert.equal(zhaoMin.businessUnit, 'Wireless');

            const zhouZhiruo = roster.find(r => r.staffId === 'T8812' || r.name === '周芷若');
            assert.ok(zhouZhiruo, 'Should extract 周芷若 from QR sheet');
            assert.equal(zhouZhiruo.role, '申请人');
            assert.equal(zhouZhiruo.customerGroup, 'Orange');
            assert.equal(zhouZhiruo.businessUnit, 'Core');
        } finally {
            await meetingRepo.deleteSnapshot(sheetSnapId);
        }
    });

    await t.test('meetingRepo and incentiveRepo handle fuzzy ID merging (mWX vs WX), PM BU to PMO, total-row filtering, and multi-column customer groups', async () => {
        const testMeetingSnapId = 'meet_test_fuzzy_' + Date.now();
        const testSheetSnapId = 'meet_test_sheet_' + Date.now();
        const testIncentiveSnapId = 'inc_test_fuzzy_' + Date.now();

        const meetingSnap = {
            id: testMeetingSnapId,
            title: '测试模糊工号快照',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 3,
                attendees: [
                    { account: 'mWX1350434', name: '王五', role: 'Originator', bu: 'IT', customerGroup: 'VDF' },
                    { account: 'WX9999', name: '李六PM', role: 'PM', bu: '', customerGroup: 'Etisalat' },
                    { account: '总计', name: '总计', role: '', bu: '', customerGroup: '' }
                ],
                anomalies: []
            },
            payload: { sheets: [] }
        };

        const sheetSnap = {
            id: testSheetSnapId,
            title: '测试多列客户群Sheet快照',
            meetingDate: '2026-09-23',
            summary: {},
            payload: {
                sheets: [
                    {
                        sheetName: '多列客户群测试',
                        category: 'rfc',
                        headers: ['RFC单号', '客户网络/Network Name', '客户组织/Customer Org', 'Solution Developer', 'PM'],
                        rows: [
                            ['RFC-2001', 'Network-Vodafone', 'Org-Wireless', '陈友谅 (WX1122)', '韩林儿 (WX3344)']
                        ]
                    }
                ]
            }
        };

        const incentiveSnap = {
            id: testIncentiveSnapId,
            title: '测试操作激励客户群来源快照',
            period: '2026-09',
            summary: {
                topPeople: [
                    { person: 'WX1350434', name: '王五', bu: 'IT', customerGroup: 'VDF', role: 'FME' },
                    { person: '合计', name: '合计', bu: '', customerGroup: '' }
                ]
            },
            payload: {
                rawRows: [
                    {
                        complete_operator: 'WX1350434',
                        name: '王五',
                        __bu: 'IT',
                        __customer: 'VDF',
                        '客户名称': '周期交叉客户A',
                        '客户': '计算明细客户B'
                    },
                    {
                        complete_operator: 'WX5566',
                        name: '明细员工',
                        __bu: 'Core',
                        '客户': '埃及专网'
                    },
                    {
                        complete_operator: '总计',
                        name: '总计',
                        __bu: 'All'
                    }
                ]
            }
        };

        await meetingRepo.saveSnapshot(meetingSnap);
        await meetingRepo.saveSnapshot(sheetSnap);
        await incentiveRepo.saveSnapshot(incentiveSnap);

        try {
            // 1. Meeting roster tests
            const meetingRoster = await meetingRepo.extractRoster();
            
            // Total row must be excluded
            assert.ok(!meetingRoster.some(r => r.staffId === '总计' || r.name === '总计'), 'Total row should be ignored');

            // PM role should automatically have BU = PMO
            const pmPerson = meetingRoster.find(r => r.name === '李六PM' || r.staffId === 'WX9999');
            assert.ok(pmPerson, 'PM person should be extracted');
            assert.equal(pmPerson.bu, 'PMO', 'PM role must have BU auto-assigned to PMO');

            // Multi-column customer group fallback: 客户网络/Network Name should be extracted
            const devPerson = meetingRoster.find(r => r.staffId === 'WX1122' || r.name === '陈友谅');
            assert.ok(devPerson, 'Should extract 陈友谅 from RFC sheet');
            assert.equal(devPerson.customerGroup, 'Network-Vodafone', 'Should extract customer group from 客户网络/Network Name column');

            // Sheet PM should also have BU = PMO
            const sheetPm = meetingRoster.find(r => r.staffId === 'WX3344' || r.name === '韩林儿');
            assert.ok(sheetPm, 'Should extract 韩林儿 from RFC sheet');
            assert.equal(sheetPm.bu, 'PMO', 'Sheet PM role must have BU auto-assigned to PMO');

            // 2. Incentive roster tests
            const incRoster = await incentiveRepo.extractRoster();

            // Total row must be excluded
            assert.ok(!incRoster.some(r => r.staffId === '总计' || r.name === '总计' || r.staffId === '合计'), 'Incentive total row should be ignored');

            // Customer extracted from 计算明细 '客户' column
            const detailPerson = incRoster.find(r => r.staffId === 'WX5566' || r.name === '明细员工');
            assert.ok(detailPerson, 'Should extract 明细员工');
            assert.equal(detailPerson.customerGroup, '埃及专网', 'Should extract customer from 计算明细 客户 column');

            // 3. Verify fuzzy matching between mWX1350434 and WX1350434
            const attResult = await meetingRepo.checkPersonAttendance({ staffId: 'WX1350434', name: '王五' });
            assert.ok(attResult.found, 'checkPersonAttendance should find 王五 even when snapshot has mWX1350434');

            // 4. Verify department-reward-penalty UI contains editing controls
            const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
            assert.ok(deptHtml.includes('data-edit-role-idx'), 'UI must contain data-edit-role-idx for editing role mappings');
            assert.ok(deptHtml.includes('data-edit-group-idx'), 'UI must contain data-edit-group-idx for editing customer group mappings');
            assert.ok(deptHtml.includes('btn-cancel-edit-role-mapping'), 'UI must contain btn-cancel-edit-role-mapping');
            assert.ok(deptHtml.includes('btn-cancel-edit-group-mapping'), 'UI must contain btn-cancel-edit-group-mapping');
        } finally {
            await meetingRepo.deleteSnapshot(testMeetingSnapId);
            await meetingRepo.deleteSnapshot(testSheetSnapId);
            await incentiveRepo.deleteSnapshot(testIncentiveSnapId);
        }
    });

    // Subtest 10: Multi-customer groups, multi-roles, singular BU (PM->PMO), and employment category filtering
    await t.test('Multi-customerGroup association, multi-role association, singular BU (PM->PMO), and employment category filtering (自有/租赁/合作)', async () => {
        const testMeetingSnapId = 'meet_test_multi_' + Date.now();
        const testIncentiveSnapId = 'inc_test_multi_' + Date.now();

        const meetingSnap = {
            id: testMeetingSnapId,
            title: '测试多客户群多角色快照',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 2,
                attendees: [
                    { account: 'WX2001', name: '李多群', role: 'TD, Solution Developer', bu: 'Wireless', customerGroup: 'Orange, VDF' },
                    { account: 'WX2002', name: '张项目', role: 'PM', bu: '', customerGroup: 'Vodafone' }
                ],
                anomalies: []
            },
            payload: {
                sheets: [
                    {
                        sheetName: 'RFC记录',
                        category: 'rfc',
                        headers: ['RFC单号', '客户群/Customer Group', 'Solution Developer', 'PM', 'Owner'],
                        rows: [
                            ['RFC-9001', 'VDF', '李多群 (WX2001)', '张项目 (WX2002)', '无线负责人']
                        ]
                    }
                ]
            }
        };

        const incentiveSnap = {
            id: testIncentiveSnapId,
            title: '测试用工性质过滤与多客户群快照',
            period: '2026-09',
            summary: {
                topPeople: [
                    { person: 'WX2001', name: '李多群', bu: 'Wireless', customerGroup: 'STC', role: '自有' },
                    { person: 'WX2003', name: '孙外包', bu: 'Core', customerGroup: 'Etisalat', role: '租赁' }
                ]
            },
            payload: {
                rawRows: [
                    {
                        complete_operator: 'WX2001',
                        name: '李多群',
                        __bu: 'Wireless',
                        __customer: 'STC',
                        '员工分类': '自有',
                        '客户名称': 'STC'
                    },
                    {
                        complete_operator: 'WX2003',
                        name: '孙外包',
                        __bu: 'Core',
                        '客户': 'Etisalat',
                        '用工性质': '租赁'
                    }
                ]
            }
        };

        await meetingRepo.saveSnapshot(meetingSnap);
        await incentiveRepo.saveSnapshot(incentiveSnap);

        try {
            // 1. Meeting roster: verify multi-groups and multi-roles
            const meetingRoster = await meetingRepo.extractRoster();
            const liPerson = meetingRoster.find(r => r.staffId === 'WX2001' || r.name === '李多群');
            assert.ok(liPerson, 'Should find 李多群 in meeting roster');
            assert.ok(Array.isArray(liPerson.customerGroups), 'customerGroups should be an array');
            assert.ok(liPerson.customerGroups.includes('Orange'), 'customerGroups should include Orange');
            assert.ok(liPerson.customerGroups.includes('VDF'), 'customerGroups should include VDF');
            assert.ok(Array.isArray(liPerson.roles), 'roles should be an array');
            assert.ok(liPerson.roles.includes('TD'), 'roles should include TD');
            assert.ok(liPerson.roles.includes('Solution Developer'), 'roles should include Solution Developer');

            // PM role should auto assign BU to PMO
            const zhangPerson = meetingRoster.find(r => r.staffId === 'WX2002' || r.name === '张项目');
            assert.ok(zhangPerson, 'Should find 张项目 in meeting roster');
            assert.equal(zhangPerson.bu, 'PMO', 'PM role must have BU = PMO');
            assert.equal(zhangPerson.businessUnit, 'PMO');

            // 2. Incentive roster: verify employment categories filtered out and fallback to FME
            const incRoster = await incentiveRepo.extractRoster();
            const sunPerson = incRoster.find(r => r.staffId === 'WX2003' || r.name === '孙外包');
            assert.ok(sunPerson, 'Should find 孙外包 in incentive roster');
            // '租赁' must NOT be in roles
            assert.ok(!sunPerson.roles.includes('租赁'), 'Employment category 租赁 must not be in roles');
            assert.ok(sunPerson.roles.includes('FME'), 'Fallback role should be FME');

            const liIncPerson = incRoster.find(r => r.staffId === 'WX2001' || r.name === '李多群');
            assert.ok(liIncPerson, 'Should find 李多群 in incentive roster');
            assert.ok(!liIncPerson.roles.includes('自有'), 'Employment category 自有 must not be in roles');

            // 3. Department reward & penalty HTML assertions
            const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
            assert.ok(deptHtml.includes('width:min(980px,calc(100vw - 32px))'), 'Snapshot mappings dialog must be widened');
            assert.ok(deptHtml.includes('table-layout:fixed'), 'Mapping tables must have table-layout: fixed');
            assert.ok(deptHtml.includes('extract-add-group-select'), 'Roster dialog must have extract-add-group-select');
            assert.ok(deptHtml.includes('extract-add-role-select'), 'Roster dialog must have extract-add-role-select');
            assert.ok(deptHtml.includes('btn-remove-cand-group'), 'Roster dialog must have btn-remove-cand-group');
            assert.ok(deptHtml.includes('btn-remove-cand-role'), 'Roster dialog must have btn-remove-cand-role');
            assert.ok(deptHtml.includes('function clean('), 'clean helper must be defined for mapping inputs');
            assert.ok(deptHtml.includes('addRoleMappingFromInput'), 'addRoleMappingFromInput must be defined');
            assert.ok(deptHtml.includes('addGroupMappingFromInput'), 'addGroupMappingFromInput must be defined');
        } finally {
            await meetingRepo.deleteSnapshot(testMeetingSnapId);
            await incentiveRepo.deleteSnapshot(testIncentiveSnapId);
        }
    });

    // Subtest 11: BU field mapping configuration (增删改), editable/deletable built-in BU rules, and extraction integration
    await t.test('BU field mapping configuration: CRUD support, built-in rules editable/deletable, and extraction matching (软件 -> Software)', async () => {
        // 1. Verify default snapshot mappings contain businessUnits
        const defaultMappings = await deptRepo.getSnapshotMappings();
        assert.ok(Array.isArray(defaultMappings.businessUnits), 'defaultMappings.businessUnits must be an array');
        assert.ok(defaultMappings.businessUnits.length >= 5, 'defaultMappings.businessUnits must have at least 5 built-in rules');
        const swRule = defaultMappings.businessUnits.find(b => b.scanned === '软件');
        assert.ok(swRule, 'Must contain built-in BU rule for 软件');
        assert.equal(swRule.target, 'Software', '软件 rule target should be Software');

        // 2. Edit built-in BU rule (edit '软件' -> 'Software-DEV')
        // Add new custom rule ({ scanned: '测试部', target: 'QA' })
        // Delete a built-in rule (delete '传输' rule)
        const updatedBUs = defaultMappings.businessUnits
            .filter(b => b.scanned !== '传输')
            .map(b => b.scanned === '软件' ? { scanned: '软件', target: 'Software-DEV' } : b);
        updatedBUs.push({ scanned: '测试部', target: 'QA' });

        const saveRes = await deptRepo.saveSnapshotMappings({
            roles: defaultMappings.roles,
            customerGroups: defaultMappings.customerGroups,
            businessUnits: updatedBUs
        });

        assert.ok(Array.isArray(saveRes.businessUnits));
        const savedSw = saveRes.businessUnits.find(b => b.scanned === '软件');
        assert.ok(savedSw);
        assert.equal(savedSw.target, 'Software-DEV', 'Software BU mapping must be editable');
        const savedQa = saveRes.businessUnits.find(b => b.scanned === '测试部');
        assert.ok(savedQa, 'New BU mapping must be addable');
        assert.equal(savedQa.target, 'QA');
        const savedTrans = saveRes.businessUnits.find(b => b.scanned === '传输');
        assert.equal(savedTrans, undefined, 'Built-in 传输 BU mapping must be deletable');

        // Verify re-reading from database
        const reRead = await deptRepo.getSnapshotMappings();
        assert.equal(reRead.businessUnits.find(b => b.scanned === '软件')?.target, 'Software-DEV');
        assert.equal(reRead.businessUnits.find(b => b.scanned === '传输'), undefined);

        // Reset back to original defaults
        await deptRepo.saveSnapshotMappings({
            roles: defaultMappings.roles,
            customerGroups: defaultMappings.customerGroups,
            businessUnits: defaultMappings.businessUnits
        });

        // 3. UI elements verification in index.html
        const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
        assert.ok(deptHtml.includes('id="tab-btn-map-bus"'), 'UI must contain tab-btn-map-bus');
        assert.ok(deptHtml.includes('id="mapping-panel-bus"'), 'UI must contain mapping-panel-bus');
        assert.ok(deptHtml.includes('id="table-bu-mappings-tbody"'), 'UI must contain table-bu-mappings-tbody');
        assert.ok(deptHtml.includes('id="count-bu-mappings"'), 'UI must contain count-bu-mappings');
        assert.ok(deptHtml.includes('id="input-map-bu-scanned"'), 'UI must contain input-map-bu-scanned');
        assert.ok(deptHtml.includes('id="select-map-bu-target"'), 'UI must contain select-map-bu-target');
        assert.ok(deptHtml.includes('id="btn-add-bu-mapping"'), 'UI must contain btn-add-bu-mapping');
        assert.ok(deptHtml.includes('id="btn-cancel-edit-bu-mapping"'), 'UI must contain btn-cancel-edit-bu-mapping');
        assert.ok(deptHtml.includes('id="unmapped-bus-quick-chips"'), 'UI must contain unmapped-bus-quick-chips');
        assert.ok(deptHtml.includes('resolveMappedBusinessUnit'), 'UI must define resolveMappedBusinessUnit');
        assert.ok(deptHtml.includes('addBuMappingFromInput'), 'UI must define addBuMappingFromInput');
        assert.ok(deptHtml.includes('cancelEditBuMapping'), 'UI must define cancelEditBuMapping');
        assert.ok(deptHtml.includes('data-edit-bu-idx'), 'UI must contain data-edit-bu-idx click listener');
        assert.ok(deptHtml.includes('data-del-bu-idx'), 'UI must contain data-del-bu-idx click listener');
        assert.ok(deptHtml.includes('data-fill-scanned-bu'), 'UI must contain data-fill-scanned-bu click listener');
        assert.ok(deptHtml.includes('data-open-mapping-bu'), 'UI must contain data-open-mapping-bu click listener');

        // 4. Meeting and Incentive snapshot extraction with BU mapping
        const testSnapId = 'meet_test_bu_map_' + Date.now();
        const meetingSnap = {
            id: testSnapId,
            title: '测试BU映射快照',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 2,
                attendees: [
                    { account: 'WX3001', name: '陈软件', role: 'TD', bu: '软件', customerGroup: 'Orange' },
                    { account: 'WX3002', name: '周无线', role: 'TE', businessUnit: '无线', customerGroup: 'VDF' }
                ],
                anomalies: []
            },
            payload: { sheets: [] }
        };
        await meetingRepo.saveSnapshot(meetingSnap);
        try {
            const roster = await meetingRepo.extractRoster();
            const chen = roster.find(r => r.staffId === 'WX3001' || r.name === '陈软件');
            assert.ok(chen, 'Should find 陈软件');
            assert.equal(chen.bu, '软件');
            assert.equal(chen.businessUnit, '软件');

            const zhou = roster.find(r => r.staffId === 'WX3002' || r.name === '周无线');
            assert.ok(zhou, 'Should find 周无线');
            assert.equal(zhou.bu, '无线');
            assert.equal(zhou.businessUnit, '无线');
        } finally {
            await meetingRepo.deleteSnapshot(testSnapId);
        }
    });

    // Subtest 12: Accurate deduplication across snapshots with parenthesized names & mutually exclusive tab statistics
    await t.test('Snapshots and UI accurately deduplicate personnel with parenthesized names, aliases, and consistent tab statistics', async () => {
        const snapId1 = 'snap_dedup_test_1_' + Date.now();
        const snapId2 = 'snap_dedup_test_2_' + Date.now();

        const snap1 = {
            id: snapId1,
            title: '去重测试快照1',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 2,
                attendees: [
                    { account: 'mWX9901', name: '孙悟空 (TL)', role: 'TD', bu: 'IT', customerGroup: 'Zain' },
                    { account: 'WX9902', name: '猪八戒', role: 'FME', bu: 'Core', customerGroup: 'ET' }
                ],
                anomalies: []
            },
            payload: { sheets: [] }
        };
        const snap2 = {
            id: snapId2,
            title: '去重测试快照2',
            meetingDate: '2026-09-24',
            summary: {
                totalAttendees: 1,
                attendees: [
                    { account: 'WX9901', name: '孙悟空', role: 'PM', bu: 'PMO', customerGroup: 'Orange' }
                ],
                anomalies: []
            },
            payload: { sheets: [] }
        };

        await meetingRepo.saveSnapshot(snap1);
        await meetingRepo.saveSnapshot(snap2);

        try {
            const roster = await meetingRepo.extractRoster();
            const sunList = roster.filter(r => r.staffId === 'WX9901' || r.name === '孙悟空');
            assert.equal(sunList.length, 1, '孙悟空 with mWX9901 and WX9901, and with (TL) in name must be deduplicated into 1 person');
            assert.equal(sunList[0].staffId, 'WX9901', 'Canonical ID should be WX9901');
            assert.equal(sunList[0].name, '孙悟空', 'Canonical name should prefer cleaner Chinese name without parentheses');
            assert.ok(sunList[0].roles.includes('TD') && sunList[0].roles.includes('PM'), 'Roles should accumulate across snapshots');
            assert.equal(sunList[0].bu, 'PMO', 'PM role forces PMO');
            assert.ok(sunList[0].customerGroups.includes('Zain') && sunList[0].customerGroups.includes('Orange'), 'Customer groups should accumulate');

            // Verify UI contains both tab and updated deduplication logic
            const deptHtml = fs.readFileSync(path.join(__dirname, '..', 'backend', 'builtin-tools', 'department-reward-penalty', 'index.html'), 'utf8');
            assert.ok(deptHtml.includes('data-extract-source="both"'), 'UI must contain 双快照共有 tab');
            assert.ok(deptHtml.includes('id="extract-count-both"'), 'UI must contain extract-count-both span');
            assert.ok(deptHtml.includes('preferCanonicalName'), 'UI must define preferCanonicalName');
            assert.ok(deptHtml.includes('convergedMap'), 'UI must execute final convergence deduplication');
        } finally {
            await meetingRepo.deleteSnapshot(snapId1);
            await meetingRepo.deleteSnapshot(snapId2);
        }
    });

    await t.test('Automatic filtering of order/ticket numbers and staff IDs exceeding 10 characters (e.g. QR20260610000307)', async () => {
        const snapIdOrder = `snap_test_order_filtering_${Date.now()}`;
        const orderSnap = {
            id: snapIdOrder,
            title: '单号过滤测试快照',
            meetingDate: '2026-09-24',
            summary: {
                totalAttendees: 3,
                attendees: [
                    // 1. Pure order number mistakenly treated as ID and name
                    { account: 'QR20260610000307', staffId: 'QR20260610000307', name: 'QR20260610000307', role: 'TD', bu: 'NIS', customerGroup: 'ET' },
                    // 2. Real name but mistakenly attached order number as staffId
                    { account: 'QR20260610000307', staffId: 'QR20260610000307', name: '诸葛亮', role: 'TD', bu: 'NIS', customerGroup: 'ET' },
                    // 3. Normal 10-char legitimate staff ID (e.g. mWX1350434)
                    { account: 'mWX1350434', staffId: 'mWX1350434', name: '周瑜', role: 'FME', bu: 'Wireless', customerGroup: 'Orange' }
                ],
                anomalies: []
            },
            payload: { sheets: [] }
        };

        await meetingRepo.saveSnapshot(orderSnap);
        try {
            const roster = await meetingRepo.extractRoster();
            // 1. Pure QR20260610000307 row must be filtered out completely
            const qrEntry = roster.find(r => r.staffId === 'QR20260610000307' || r.name === 'QR20260610000307');
            assert.equal(qrEntry, undefined, 'Pure ticket numbers like QR20260610000307 must be completely filtered out');

            // 2. 诸葛亮 should be kept, but invalid QR... staffId stripped
            const zhuge = roster.find(r => r.name === '诸葛亮');
            assert.ok(zhuge, 'Person with valid name must be retained');
            assert.equal(zhuge.staffId, '', 'Invalid ticket staffId exceeding 10 characters must be stripped');

            // 3. 周瑜 with mWX1350434 (exactly 10 chars) must NOT be filtered
            const zhou = roster.find(r => r.name === '周瑜');
            assert.ok(zhou, 'Person with valid 10-char staff ID must be retained');
            assert.equal(zhou.staffId, 'WX1350434', 'Legitimate 10-char staff ID must be retained without its import prefix');
        } finally {
            await meetingRepo.deleteSnapshot(snapIdOrder);
        }
    });

    await t.test('Roster extraction strictly uses "三类合并人员备用名单", splits multi-person cells, deduplicates same names, and provides source traces', async () => {
        const testMeetId = 'meet_strict_' + Date.now();
        const testIncId = 'inc_strict_' + Date.now();

        // 1. Meeting snapshot: has summary.attendees (三类合并人员备用名单) AND raw RFC sheet with extra dirty data
        // Under the new rule, ONLY summary.attendees should be extracted; raw RFC sheet MUST be ignored.
        const meetingSnap = {
            id: testMeetId,
            title: '2026-06 会议考勤快照',
            meetingDate: '2026-06-15',
            summary: {
                totalAttendees: 2,
                attendees: [
                    { account: '00909378', name: 'Mahmoud Elnaggar', role: 'TD', bu: 'Wireless', customerGroup: 'Orange' },
                    { account: '', name: 'SameName NoId', role: 'FME', bu: 'IT', customerGroup: 'VDF' }
                ],
                anomalies: []
            },
            payload: {
                sheets: [
                    {
                        sheetName: 'RFC原始明细',
                        category: 'rfc',
                        headers: ['RFC单号', 'Solution Developer'],
                        rows: [
                            ['RFC-9999', 'DirtyRawPerson (WX99999)']
                        ]
                    }
                ]
            }
        };

        // 2. Incentive snapshot: has semicolon-concatenated multi-person cell and same-name person with staffId
        const incentiveSnap = {
            id: testIncId,
            title: '2026-06 操作激励快照',
            period: '2026-06',
            payload: {
                rawRows: [
                    {
                        '操作人': 'Mahmoud Elnaggar 00909378;Ibrahim Youssef 00823621;Mohamed Abuelazm 00593179',
                        __bu: 'Core',
                        '客户名称': 'ET'
                    },
                    {
                        '操作人': 'SameName NoId 00112233',
                        __bu: 'IT',
                        '客户名称': 'VDF'
                    }
                ]
            }
        };

        await meetingRepo.saveSnapshot(meetingSnap);
        await incentiveRepo.saveSnapshot(incentiveSnap);

        try {
            // Test 1: Meeting repo strictly ignores raw RFC sheet when combined list is present
            const meetRoster = await meetingRepo.extractRoster();
            assert.ok(!meetRoster.some(r => r.name === 'DirtyRawPerson' || r.staffId === 'WX99999'), 'Meeting repo must NOT scan raw RFC sheets when combined list is present');
            const mahmoudMeet = meetRoster.find(r => r.staffId === '00909378');
            assert.ok(mahmoudMeet, 'Mahmoud Elnaggar should be in meeting roster');
            assert.ok(mahmoudMeet.sourceTraces && mahmoudMeet.sourceTraces.length > 0, 'Should have sourceTraces');
            assert.equal(mahmoudMeet.sourceTraces[0].sheetName, '三类合并人员备用名单');

            // Test 2: Incentive repo splits semicolon-separated multi-person cells
            const incRoster = await incentiveRepo.extractRoster();
            const ibrahim = incRoster.find(r => r.staffId === '00823621');
            assert.ok(ibrahim, 'Ibrahim Youssef should be split out with staffId 00823621');
            assert.equal(ibrahim.name, 'Ibrahim Youssef');
            assert.ok(ibrahim.sourceTraces && ibrahim.sourceTraces.length > 0);
            assert.equal(ibrahim.sourceTraces[0].rowNumber, 1);
            assert.equal(ibrahim.sourceTraces[0].field, '操作人');

            const mohamed = incRoster.find(r => r.staffId === '00593179');
            assert.ok(mohamed, 'Mohamed Abuelazm should be split out with staffId 00593179');
            assert.equal(mohamed.name, 'Mohamed Abuelazm');

            // Test 3: Same-name deduplication & staffId retention
            const sameNamePerson = incRoster.find(r => r.name === 'SameName NoId');
            assert.ok(sameNamePerson, 'SameName NoId should exist');
            assert.equal(sameNamePerson.staffId, '00112233', 'Should retain non-empty staffId');

            // Test 4: Frontend UI has source-trace-badge, formatSourceTraceTooltip, and splitAndParsePeople
            const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
            assert.ok(deptHtml.includes('formatSourceTraceTooltip'), 'UI must define formatSourceTraceTooltip');
            assert.ok(deptHtml.includes('source-trace-badge'), 'UI must render source-trace-badge');
            assert.ok(deptHtml.includes('splitAndParsePeople'), 'UI must define splitAndParsePeople');
        } finally {
            await meetingRepo.deleteSnapshot(testMeetId);
            await incentiveRepo.deleteSnapshot(testIncId);
        }
    });

    // Subtest 15: Operation incentive strictly extracts from "人员周期汇总", assigns FME/TE dual roles, maps 4 key columns, and strips alphanumeric staff IDs from names
    await t.test('Operation incentive snapshot strictly extracts from "人员周期汇总", assigns FME & TE dual roles, maps 4 key columns, and strips letter-prefixed IDs from foreign/Chinese names', async () => {
        const testSnapId = 'inc_strict_period_summary_' + Date.now();
        const incentiveSnap = {
            id: testSnapId,
            title: '2026-09 操作激励汇总测试快照',
            period: '2026-09',
            payload: {
                sheets: [
                    {
                        sheetName: '人员周期汇总',
                        headers: ['周期', '操作人', '姓名', 'BU1 / 部门', '客户', '人员属性', '计费天数', '激励合计（元）'],
                        rows: [
                            ['2026-09', '00909378', 'Mahmoud Elnaggar 00909378', '无线网络交付部', '埃及专网', '全职', 22, 3500],
                            ['2026-09', 'a84237671', 'Atef Nagah Elsayed Ahmed Elewa a84237671', 'NIS交付部', 'Orange', '外协', 20, 2800],
                            ['2026-09', 'yWX1232731', 'Mostafa Orabi yWX1232731', 'IT交付部', 'Vodafone', '全职', 21, 3100],
                            ['2026-09', 'mWX1350434', '张三(mWX1350434)', '核心网部', 'Etisalat', '全职', 22, 4000]
                        ]
                    },
                    {
                        sheetName: '计算明细',
                        headers: ['工号', '姓名', '工单号', '金额'],
                        rows: [
                            ['WX999999', 'IgnoredRawDetailPerson', 'WO-9999', 500]
                        ]
                    }
                ]
            }
        };

        await incentiveRepo.saveSnapshot(incentiveSnap);

        try {
            const roster = await incentiveRepo.extractRoster();

            // 1. Raw sheet "计算明细" MUST be completely ignored
            assert.ok(!roster.some(r => r.name === 'IgnoredRawDetailPerson' || r.staffId === 'WX999999'), 'Raw sheets like 计算明细 must be ignored');

            // 2. All 4 people from "人员周期汇总" must be extracted with both FME and TE roles
            const mahmoud = roster.find(r => r.staffId === '00909378');
            assert.ok(mahmoud, 'Mahmoud Elnaggar should be extracted');
            assert.equal(mahmoud.name, 'Mahmoud Elnaggar', 'Numeric staff ID 00909378 should be cleanly stripped from name without damage');
            assert.equal(mahmoud.bu, '无线网络交付部');
            assert.equal(mahmoud.customerGroup, '埃及专网');
            assert.ok(mahmoud.roles.includes('FME') && mahmoud.roles.includes('TE'), 'Must have both FME and TE roles');

            const atef = roster.find(r => r.staffId === '84237671');
            assert.ok(atef, 'Atef Nagah Elsayed Ahmed Elewa should be extracted');
            assert.equal(atef.name, 'Atef Nagah Elsayed Ahmed Elewa', 'Letter-prefixed ID a84237671 should be cleanly stripped from long foreign name');
            assert.equal(atef.bu, 'NIS交付部');
            assert.equal(atef.customerGroup, 'Orange');
            assert.ok(atef.roles.includes('FME') && atef.roles.includes('TE'), 'Must have both FME and TE roles');

            const mostafa = roster.find(r => r.staffId === 'WX1232731');
            assert.ok(mostafa, 'Mostafa Orabi should be extracted');
            assert.equal(mostafa.name, 'Mostafa Orabi', 'Letter-prefixed ID yWX1232731 should be cleanly stripped');
            assert.equal(mostafa.bu, 'IT交付部');
            assert.equal(mostafa.customerGroup, 'Vodafone');
            assert.ok(mostafa.roles.includes('FME') && mostafa.roles.includes('TE'), 'Must have both FME and TE roles');

            const zhang = roster.find(r => r.staffId === 'WX1350434');
            assert.ok(zhang, '张三 should be extracted');
            assert.equal(zhang.name, '张三', 'Parenthesized ID mWX1350434 should be cleanly stripped from Chinese name');
            assert.equal(zhang.bu, '核心网部');
            assert.equal(zhang.customerGroup, 'Etisalat');
            assert.ok(zhang.roles.includes('FME') && zhang.roles.includes('TE'), 'Must have both FME and TE roles');

            // 3. UI checks: tool-ms4xb66s produces personnelPeriodSummary and department-reward-penalty assigns dual roles
            const ms4Html = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/tool-ms4xb66s/index.html'), 'utf-8');
            assert.ok(ms4Html.includes('personnelPeriodSummary'), 'tool-ms4xb66s must build personnelPeriodSummary sheet');
            assert.ok(ms4Html.includes('人员周期汇总'), 'tool-ms4xb66s must reference 人员周期汇总');

            const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
            assert.ok(deptHtml.includes("['FME', 'TE'].forEach"), 'department-reward-penalty must assign FME and TE roles to incentive source');
        } finally {
            await incentiveRepo.deleteSnapshot(testSnapId);
        }
    });

    await t.test('Real name is directly used and unconditionally preserved against staffId overwrite (e.g. Ahmed Helmy vs a00824176)', async () => {
        const testSnapId = `snap_test_helmy_${Date.now()}`;
        const snap = {
            id: testSnapId,
            title: '2023-05 埃及夜间操作激励核算',
            period: '2023-05',
            summary: {
                totalPeople: 1,
                totalAmount: 540,
                personnelSummary: [
                    {
                        '周期': '2023-05',
                        '操作人': 'a00824176',
                        '姓名': 'Ahmed Helmy',
                        'BU1 / 部门': 'NIS',
                        '客户': 'Telecom Egypt',
                        '人员属性': '自有',
                        '计费天数': 2,
                        '等级分布': 'Medium:2',
                        '激励合计（元）': 360
                    },
                    {
                        '周期': '2023-04',
                        '操作人': 'a00824176',
                        '姓名': 'Ahmed Helmy',
                        'BU1 / 部门': 'NIS',
                        '客户': 'Telecom Egypt',
                        '人员属性': '自有',
                        '计费天数': 1,
                        '等级分布': 'Medium:1',
                        '激励合计（元）': 180
                    }
                ]
            },
            payload: {
                sheets: [
                    {
                        sheetName: '人员周期汇总',
                        headers: ['周期', '操作人', '姓名', 'BU1 / 部门', '客户', '人员属性', '计费天数', '等级分布', '激励合计（元）'],
                        rows: [
                            ['2023-05', 'a00824176', 'Ahmed Helmy', 'NIS', 'Telecom Egypt', '自有', 2, 'Medium:2', 360],
                            ['2023-04', 'a00824176', 'Ahmed Helmy', 'NIS', 'Telecom Egypt', '自有', 1, 'Medium:1', 180]
                        ]
                    }
                ]
            }
        };

        await incentiveRepo.saveSnapshot(snap);

        try {
            const roster = await incentiveRepo.extractRoster();
            const helmy = roster.find(r => r.staffId === '00824176');
            assert.ok(helmy, 'a00824176 must be extracted as 00824176');
            assert.equal(helmy.name, 'Ahmed Helmy', 'Real name Ahmed Helmy must be directly used and not overwritten by staffId a00824176');
            assert.equal(helmy.bu, 'NIS');
            assert.equal(helmy.customerGroup, 'Telecom Egypt');
            assert.ok(helmy.roles.includes('FME') && helmy.roles.includes('TE'), 'Must have FME and TE dual roles');

            // Verify tool-ms4xb66s builds 等级分布 in sheet headers
            const ms4Html = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/tool-ms4xb66s/index.html'), 'utf-8');
            assert.ok(ms4Html.includes("'等级分布'"), 'tool-ms4xb66s must include 等级分布 in personnelPeriodSummary and sheet headers');

            // Verify department-reward-penalty preferCanonicalName logic prioritizes real name over staffId token
            const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
            assert.ok(deptHtml.includes('isStaffIdToken(s1)'), 'preferCanonicalName in department-reward-penalty must test for staff ID tokens');
            assert.ok(deptHtml.includes('words1.length > words2.length'), 'preferCanonicalName in department-reward-penalty must prefer multi-word foreign full names');
        } finally {
            await incentiveRepo.deleteSnapshot(testSnapId);
        }
    });

    await t.test('Meeting roster extraction enriches roles (TD/PM/etc.) and customer groups from QR/RFC/WFM sheets (e.g. mWX1459632 with TD role and ORG customer group)', async () => {
        const testSnapId = `snap_qr_enrich_test_${Date.now()}`;
        const meetingSnap = {
            id: testSnapId,
            title: '2026-09 会议考勤快照-角色与客户群富化测试',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 2,
                attendees: [
                    {
                        account: 'mWX1459632',
                        staffId: 'mWX1459632',
                        name: 'mWX1459632',
                        bu: 'NIS',
                        customerGroup: 'ORG',
                        role: '',
                        attendance: 'Absent'
                    },
                    {
                        account: '00909378',
                        staffId: '00909378',
                        name: 'Mahmoud Elnaggar',
                        bu: 'Wireless',
                        customerGroup: 'EG-Egypt Orange',
                        role: '',
                        attendance: 'Attend on Time'
                    }
                ],
                anomalies: []
            },
            payload: {
                sheets: [
                    {
                        sheetName: 'QR 相关记录',
                        category: 'qr',
                        headers: ['#', '来源文件', 'Sheet', '匹配角色', 'Task ID', 'Apply Accountid', 'Apply Fullname', 'Td', 'Td Fullname', 'Customer Group', 'BU'],
                        rows: [
                            ['1', 'QR_20260923.xlsx', 'QR', 'TD', 'TASK-101', 'a00112233', 'Applicant Name', 'm00909378;mWX1459632', 'Mahmoud Elnaggar 00909378;mWX1459632', 'ORG', 'NIS'],
                            ['2', 'QR_20260923.xlsx', 'QR', 'TD', 'TASK-102', 'a00112233', 'Applicant Name', '00909378', 'Mahmoud Elnaggar', 'EG-Egypt Orange', 'Wireless'],
                            ['3', 'QR_20260923.xlsx', 'QR', 'TD', 'TASK-103', 'a00999999', 'Ghost Not In Combined', 'a00999999', 'Ghost', 'ORG', 'NIS']
                        ]
                    }
                ]
            }
        };

        await meetingRepo.saveSnapshot(meetingSnap);

        try {
            const roster = await meetingRepo.extractRoster();
            const person = roster.find(r => r.staffId === 'WX1459632');
            assert.ok(person, 'mWX1459632 must be in meeting roster');
            assert.equal(person.name, '', 'An ID placeholder must not become a real name');
            assert.equal(person.customerGroup, 'ORG', 'Customer group must be preserved as ORG');
            assert.ok(person.customerGroups.includes('ORG'), 'customerGroups array must contain ORG');
            assert.ok(person.roles.includes('TD'), 'Role must be enriched from QR table as TD');
            assert.equal(person.bu, 'NIS', 'BU must be NIS');

            // Source traces must show both combined list and QR sheet
            assert.ok(person.sourceTraces && person.sourceTraces.length >= 2, 'Should have traces from both combined list and QR sheet');
            assert.ok(person.sourceTraces.some(t => t.sheetName === '三类合并人员备用名单'));
            assert.ok(person.sourceTraces.some(t => t.sheetName === 'QR 相关记录' && t.field.includes('TD')));

            // Ghost person from raw sheet not in combined list must NOT be added
            const ghost = roster.find(r => r.staffId === 'a00999999' || r.name === 'Ghost Not In Combined');
            assert.equal(ghost, undefined, 'Persons only in raw QR sheet but not in combined list must not be added to roster');

            // Verify department-reward-penalty mappings and heuristic resolution
            const deptHtml = fs.readFileSync(path.join(__dirname, '../backend/builtin-tools/department-reward-penalty/index.html'), 'utf-8');
            assert.ok(deptHtml.includes("scanned: 'ORG', target: 'Orange'"), 'DEFAULT_SNAPSHOT_MAPPINGS must include ORG -> Orange mapping');
            assert.ok(deptHtml.includes("isOrange = s === 'org'"), 'resolveMappedCustomerGroup must include isOrange heuristic');

            const mappings = await deptRepo.getSnapshotMappings();
            assert.ok(mappings.customerGroups.some(m => m.scanned.toLowerCase() === 'org'), 'Saved snapshot mappings must include ORG');
        } finally {
            await meetingRepo.deleteSnapshot(testSnapId);
        }
    });

    await t.test('QR table multi-person semicolon cells extract real names by stripping m prefix (e.g. m00665597 -> Mostafa Orabi, mWX1459632 -> Ahmed Hassan)', async () => {
        const testSnapId = `snap_qr_nameless_m_strip_${Date.now()}`;
        const meetingSnap = {
            id: testSnapId,
            title: '2026-09 会议考勤快照-QR多人员分号去m姓名提取测试',
            meetingDate: '2026-09-23',
            summary: {
                totalAttendees: 2,
                attendees: [
                    {
                        account: 'm00665597',
                        staffId: 'm00665597',
                        name: '', // 没有真实姓名
                        bu: 'NIS',
                        customerGroup: 'Orange',
                        role: '',
                        attendance: 'Absent'
                    },
                    {
                        account: 'mWX1459632',
                        staffId: 'mWX1459632',
                        name: 'mWX1459632', // 姓名为工号自身占位
                        bu: 'NIS',
                        customerGroup: 'ORG',
                        role: '',
                        attendance: 'Attend on Time'
                    }
                ],
                anomalies: [
                    {
                        account: 'm00665597',
                        staffId: 'm00665597',
                        name: '',
                        type: 'absent',
                        attendance: 'Absent'
                    }
                ]
            },
            payload: {
                sheets: [
                    {
                        sheetName: 'QR 相关记录',
                        category: 'qr',
                        headers: ['#', '来源文件', 'Sheet', '匹配角色', 'Task ID', 'Apply Accountid', 'Apply Fullname', 'Td', 'Td Fullname', 'Customer Group', 'BU'],
                        rows: [
                            // 行1: Td Fullname 包含分号隔开的多人员："Mahmoud Elnaggar 00909378;Mostafa Orabi 00665597"
                            ['1', 'QR_20260923.xlsx', 'QR', 'TD', 'TASK-201', 'a00112233', 'Applicant', '00909378;00665597', 'Mahmoud Elnaggar 00909378;Mostafa Orabi 00665597', 'Orange', 'NIS'],
                            // 行2: Td Fullname 包含 "Amr Khaled 00888888;Ahmed Hassan WX1459632"
                            ['2', 'QR_20260923.xlsx', 'QR', 'TD', 'TASK-202', 'a00112233', 'Applicant', '00888888;WX1459632', 'Amr Khaled 00888888;Ahmed Hassan WX1459632', 'ORG', 'NIS']
                        ]
                    }
                ]
            }
        };

        await meetingRepo.saveSnapshot(meetingSnap);

        try {
            const roster = await meetingRepo.extractRoster();

            // 1. 验证 m00665597 成功提取出真实姓名 Mostafa Orabi，且工号规范化为 00665597
            const orabi = roster.find(r => r.staffId === '00665597' || r.account === '00665597' || r.staffId === 'm00665597');
            assert.ok(orabi, '00665597 must be found in roster');
            assert.equal(orabi.name, 'Mostafa Orabi', 'Must extract real name Mostafa Orabi from multi-person semicolon Td Fullname cell');
            assert.equal(orabi.staffId, '00665597', 'Staff ID must prefer non-m prefix 00665597');
            assert.ok(orabi.roles.includes('TD'), 'Role must be enriched as TD');
            assert.ok(orabi.sourceTraces.some(t => t.sheetName === 'QR 相关记录' && t.field.includes('TD')), 'Source traces must record QR TD trace');

            // 2. 验证 mWX1459632 成功提取出真实姓名 Ahmed Hassan，且工号规范化为 WX1459632
            const hassan = roster.find(r => r.staffId === 'WX1459632' || r.account === 'WX1459632' || r.staffId === 'mWX1459632');
            assert.ok(hassan, 'WX1459632 must be found in roster');
            assert.equal(hassan.name, 'Ahmed Hassan', 'Must extract real name Ahmed Hassan for mWX1459632');
            assert.equal(hassan.staffId, 'WX1459632', 'Staff ID must prefer non-m prefix WX1459632');
            assert.ok(hassan.roles.includes('TD'), 'Role must be enriched as TD');

            // 3. 验证 checkPersonAttendance 通过姓名或工号均可精准核验
            const checkByName = await meetingRepo.checkPersonAttendance({ name: 'Mostafa Orabi' });
            assert.equal(checkByName.found, true);
            assert.equal(checkByName.hasAnomaly, true);
            assert.equal(checkByName.records[0].name, 'Mostafa Orabi');

            const checkByMId = await meetingRepo.checkPersonAttendance({ staffId: 'm00665597' });
            assert.equal(checkByMId.found, true);
            assert.equal(checkByMId.records[0].name, 'Mostafa Orabi');

            const checkByNonMId = await meetingRepo.checkPersonAttendance({ staffId: '00665597' });
            assert.equal(checkByNonMId.found, true);
            assert.equal(checkByNonMId.records[0].name, 'Mostafa Orabi');

            // 4. 验证 preferCanonicalStaffId 算法在各种带 m 前缀场景下的一致性
            assert.equal(meetingRepo.preferCanonicalStaffId('m00665597', '00665597'), '00665597');
            assert.equal(meetingRepo.preferCanonicalStaffId('00665597', 'm00665597'), '00665597');
            assert.equal(meetingRepo.preferCanonicalStaffId('mWX1459632', 'WX1459632'), 'WX1459632');
            assert.equal(meetingRepo.preferCanonicalStaffId('WX1459632', 'mWX1459632'), 'WX1459632');
            assert.equal(incentiveRepo.preferCanonicalStaffId('m00665597', '00665597'), '00665597');
            assert.equal(incentiveRepo.preferCanonicalStaffId('mWX1459632', 'WX1459632'), 'WX1459632');
        } finally {
            await meetingRepo.deleteSnapshot(testSnapId);
        }
    });
});
