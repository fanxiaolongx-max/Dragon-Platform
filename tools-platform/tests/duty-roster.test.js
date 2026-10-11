const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-roster-test-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');

const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');
const dutyRepo = require('../backend/models/duty-roster-repository');
const importRepo = require('../backend/models/import-source-repository');
const catalogView = require('../frontend/js/monthly-designer/catalog-view');

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('Egypt week calculation correctly starts on Sunday and ends on Saturday, with Fri and Sat marked as weekends', () => {
    // 2026-08: 8月1日是周六
    const weeksAug = dutyRepo.calculateEgyptWeeks(2026, 8);
    assert.ok(weeksAug.length >= 5);

    // 第一周从 7/26/2026（周日）开始，到 8/1/2026（周六）结束
    const firstWeek = weeksAug[0];
    assert.equal(firstWeek.days[0].dayLabel, 'Sun');
    assert.equal(firstWeek.days[0].weekdayIndex, 0);
    assert.equal(firstWeek.days[0].isWeekend, false);

    assert.equal(firstWeek.days[5].dayLabel, 'Fri');
    assert.equal(firstWeek.days[5].weekdayIndex, 5);
    assert.equal(firstWeek.days[5].isWeekend, true); // 埃及周末

    assert.equal(firstWeek.days[6].dayLabel, 'Sat');
    assert.equal(firstWeek.days[6].weekdayIndex, 6);
    assert.equal(firstWeek.days[6].isWeekend, true); // 埃及周末

    assert.equal(firstWeek.key, '7/26/2026-8/1/2026');

    // 统计所有属于8月份的日期，必须严格为 31 天
    let augDays = 0;
    weeksAug.forEach(w => {
        w.days.forEach(d => {
            if (d.inTargetMonth) augDays++;
        });
    });
    assert.equal(augDays, 31);

    // 验证 2026-09
    const weeksSep = dutyRepo.calculateEgyptWeeks(2026, 9);
    let sepDays = 0;
    weeksSep.forEach(w => {
        w.days.forEach(d => {
            if (d.inTargetMonth) sepDays++;
        });
    });
    assert.equal(sepDays, 30);
});

test('Duty roster persistence in SQLite and sync to import sources catalog', async () => {
    await dutyRepo.ensureReady();
    await importRepo.ensureReady();

    // 1. 获取示例值班表并保存
    const sample = dutyRepo.getSampleDutyRoster('2026-08');
    assert.equal(sample.month, '2026-08');
    assert.equal(sample.weekdays.length, 7);
    assert.equal(sample.weekdays[0].key, 'Sun');
    assert.equal(sample.weekdays[5].key, 'Fri');
    assert.equal(sample.weekdays[5].isWeekend, true);
    assert.equal(sample.weekdays[6].key, 'Sat');
    assert.equal(sample.weekdays[6].isWeekend, true);

    const saved = await dutyRepo.saveDutyRoster(sample);
    assert.equal(saved.month, '2026-08');
    assert.ok(saved.syncResult);
    assert.ok(saved.syncResult.fileId);

    // 2. 从数据库重新读取
    const loaded = await dutyRepo.getDutyRoster('2026-08');
    assert.equal(loaded.month, '2026-08');
    assert.equal(loaded.totalCount, 353);
    assert.equal(loaded.rows.length, 7);
    assert.equal(loaded.rows[0].Period, 'Sun');
    assert.equal(loaded.rows[5].Period, 'Fri');
    assert.equal(loaded.rows[6].Period, 'Sat');

    // 3. 验证 import-source-repository 的 catalog()
    const catalog = await importRepo.catalog();
    const dutyFile = catalog.files.find(f => f.source_key === '夜间运维值班表' || f.kind === 'duty_roster');
    assert.ok(dutyFile, 'Duty roster file must exist in catalog');
    assert.ok(dutyFile.metricLabels.includes('夜间运维值班表'), 'Must have 夜间运维值班表 metric label');
    assert.ok(dutyFile.metricLabels.includes('值班人次'), 'Must have 值班人次 metric label');

    // 4. 验证 catalogView 分类逻辑
    assert.equal(catalogView.isExpiringTicketFile(dutyFile), false, 'Must not be expiring ticket file');
    assert.equal(catalogView.hasExtractedMetrics(dutyFile, catalog.files), true, 'Must have extracted metrics to be in 指标与关键数据表');

    const sorted = catalogView.sortPriorityFiles([dutyFile]);
    assert.equal(sorted[0].id, dutyFile.id);
});

test('Duty roster HTTP endpoints work correctly', async t => {
    const express = require('express');
    const web = express();
    web.use(express.json());
    web.use('/api/duty-roster', require('../backend/routes/duty-roster'));

    const server = await new Promise(resolve => {
        const listener = web.listen(0, '127.0.0.1', () => resolve(listener));
    });
    t.after(() => new Promise(resolve => server.close(resolve)));

    const base = `http://127.0.0.1:${server.address().port}/api/duty-roster`;

    // 1. GET /api/duty-roster?month=2026-09 动态获取空表分周
    const resGet = await fetch(`${base}?month=2026-09`);
    assert.equal(resGet.status, 200);
    const dataGet = await resGet.json();
    assert.equal(dataGet.month, '2026-09');
    assert.ok(dataGet.weeks.length >= 5);
    assert.equal(dataGet.rows.length, 7);
    assert.equal(dataGet.rows[0].Period, 'Sun');

    // 2. GET /api/duty-roster/sample?month=2026-09 获取带示例排班
    const resSample = await fetch(`${base}/sample?month=2026-09`);
    assert.equal(resSample.status, 200);
    const dataSample = await resSample.json();
    assert.equal(dataSample.month, '2026-09');
    assert.equal(dataSample.totalCount, 353);

    // 3. POST /api/duty-roster 保存排班
    const resPost = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataSample)
    });
    assert.equal(resPost.status, 200);
    const dataPost = await resPost.json();
    assert.equal(dataPost.success, true);
    assert.equal(dataPost.data.month, '2026-09');

    // 4. GET /api/duty-roster/list 检查清单
    const resList = await fetch(`${base}/list`);
    const list = await resList.json();
    assert.ok(list.some(item => item.month === '2026-09'));

    // 5. 验证 isSaved 字段
    const resSavedCheck = await fetch(`${base}?month=2026-09`);
    const savedData = await resSavedCheck.json();
    assert.equal(savedData.isSaved, true, 'Saved month must return isSaved: true');

    const resUnsavedCheck = await fetch(`${base}?month=2025-11`);
    const unsavedData = await resUnsavedCheck.json();
    assert.equal(unsavedData.isSaved, false, 'Unsaved month must return isSaved: false');

    // 6. 验证 /recent 接口与不带 month 参数时自动返回最近编辑月份
    const resRecent = await fetch(`${base}/recent`);
    const dataRecent = await resRecent.json();
    assert.equal(dataRecent.recentMonth, '2026-09');
    assert.ok(dataRecent.calendarMonth);

    const resDefault = await fetch(base);
    const dataDefault = await resDefault.json();
    assert.equal(dataDefault.month, '2026-09');
});

test('Duty roster previous month import and cross-week mapping logic', () => {
    // 模拟从 2026-07 (上月) 导入至 2026-08 (本月)
    const prevMonth = '2026-07';
    const currentMonth = '2026-08';

    const prevSample = dutyRepo.getSampleDutyRoster(prevMonth);
    const currTable = dutyRepo.buildDutyRosterTable(currentMonth);

    assert.ok(prevSample.weeks.length >= 4);
    assert.ok(currTable.weeks.length >= 5);

    // 提取上月排班名单
    const weekdaysMeta = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const prevOrdered = [];
    prevSample.weeks.forEach(w => {
        w.days.forEach(d => {
            const dayKey = weekdaysMeta[d.weekdayIndex];
            const val = prevSample.grid[w.key]?.[dayKey];
            if (val) prevOrdered.push(val);
        });
    });
    assert.ok(prevOrdered.length > 20, 'Previous month must have scheduled names');

    // 模拟前端引入算法
    const newGrid = {};
    const newCells = {};
    let filledShifts = 0;
    let cycleIndex = 0;

    currTable.weeks.forEach((w, wIdx) => {
        newGrid[w.key] = {};
        w.days.forEach(d => {
            const dayKey = weekdaysMeta[d.weekdayIndex];
            const mappedWeek = prevSample.weeks[wIdx % prevSample.weeks.length];
            let val = prevSample.grid[mappedWeek.key]?.[dayKey] || '';
            if (!val && prevOrdered.length > 0) {
                val = prevOrdered[cycleIndex % prevOrdered.length];
                cycleIndex++;
            }
            if (val) {
                newCells[d.dateStr] = val;
                newGrid[w.key][dayKey] = val;
                if (d.inTargetMonth) filledShifts++;
            }
        });
    });

    // 8月有31天，因此当月出勤必须完整覆盖31天
    assert.equal(filledShifts, 31, 'Imported roster must cover all 31 days of August');
    assert.equal(Object.keys(newGrid).length, currTable.weeks.length);
});

