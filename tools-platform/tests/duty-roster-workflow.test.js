const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'duty-roster-browser-'));
process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');
process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');

const express = require('express');
const appDb = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const dutyRepo = require('../backend/models/duty-roster-repository');
const importRepo = require('../backend/models/import-source-repository');

test('Duty roster page full workflow test', async t => {
    await dutyRepo.ensureReady();
    await importRepo.ensureReady();

    // 1. 验证示例数据生成
    const sample = dutyRepo.getSampleDutyRoster('2026-08');
    assert.equal(sample.month, '2026-08');
    assert.equal(sample.weeks[0].days[0].dayLabel, 'Sun');
    assert.equal(sample.weeks[0].days[5].dayLabel, 'Fri');
    assert.equal(sample.weeks[0].days[5].isWeekend, true);
    assert.equal(sample.weeks[0].days[6].dayLabel, 'Sat');
    assert.equal(sample.weeks[0].days[6].isWeekend, true);

    // 2. 验证保存到数据库
    const saveRes = await dutyRepo.saveDutyRoster(sample);
    assert.equal(saveRes.month, '2026-08');
    assert.equal(saveRes.totalCount, 353);

    // 3. 验证再次查询
    const loaded = await dutyRepo.getDutyRoster('2026-08');
    assert.equal(loaded.month, '2026-08');
    assert.equal(loaded.totalCount, 353);
    assert.equal(loaded.rows.length, 7);
    assert.equal(loaded.rows[0].Period, 'Sun');
    assert.equal(loaded.rows[5].Period, 'Fri');
    assert.equal(loaded.rows[6].Period, 'Sat');

    // 4. 验证月报资料库同步
    const catalog = await importRepo.catalog();
    const matchFile = catalog.files.find(f => f.source_key === '夜间运维值班表');
    assert.ok(matchFile, '夜间运维值班表 must be in catalog.files');
    assert.ok(matchFile.metricLabels.includes('夜间运维值班表'));
    assert.ok(matchFile.metricLabels.includes('值班人次'));
    assert.equal(matchFile.sheets[0].name, '夜间运维值班表');
    assert.equal(matchFile.sheets[0].rowCount, 8); // 7天 + 1合计

    // 5. 验证下一个月（2026-09）的分周自动调整
    const sepSample = dutyRepo.buildDutyRosterTable('2026-09');
    assert.equal(sepSample.month, '2026-09');
    // 2026-09 应该是 5 周
    assert.equal(sepSample.weeks[0].key, '8/30/2026-9/5/2026');
    assert.equal(sepSample.rows[0].Period, 'Sun');
    assert.equal(sepSample.rows[5].Period, 'Fri');
    assert.equal(sepSample.rows[6].Period, 'Sat');
});

test.after(async () => {
    await appDb.closeDatabase();
    await pool.closeAll();
    fs.rmSync(temp, { recursive: true, force: true });
});
