const { run, get, all } = require('./app-db');
const crypto = require('node:crypto');

let initPromise = null;

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS duty_rosters (
                    id TEXT PRIMARY KEY,
                    month TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL DEFAULT '夜间运维值班表',
                    weeks_json TEXT NOT NULL,
                    roster_json TEXT NOT NULL,
                    summary_text TEXT DEFAULT '',
                    total_count INTEGER DEFAULT 0,
                    monthly_count INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await run(`
                CREATE INDEX IF NOT EXISTS idx_duty_rosters_month
                ON duty_rosters(month)
            `);
            const countRow = await get('SELECT count(*) as cnt FROM duty_rosters');
            if (!countRow || countRow.cnt === 0) {
                try {
                    const sample = getSampleDutyRoster('2026-08');
                    const weeksJson = JSON.stringify(sample.weeks);
                    const rosterJson = JSON.stringify({
                        cells: sample.cells,
                        grid: sample.grid,
                        totalCount: sample.totalCount,
                        monthlyCount: sample.monthlyCount,
                        summaryText: sample.summaryText
                    });
                    const now = new Date().toISOString();
                    await run(`
                        INSERT INTO duty_rosters (
                            id, month, title, weeks_json, roster_json, summary_text, total_count, monthly_count, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        'duty_roster_2026-08',
                        '2026-08',
                        sample.title,
                        weeksJson,
                        rosterJson,
                        sample.summaryText,
                        sample.totalCount,
                        sample.monthlyCount,
                        now,
                        now
                    ]);
                    await syncToImportSources(sample);
                } catch (e) {
                    console.warn('[DUTY ROSTER] Auto-seed failed:', e);
                }
            }
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

/**
 * 计算目标月份对应的埃及自然周划分（周日开始，周六结束）
 * @param {number} year 年份，如 2026
 * @param {number} month 月份，1-12
 * @returns {Array} 周分段数组
 */
function calculateEgyptWeeks(year, month) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
        throw new Error('Invalid year or month for duty roster');
    }

    // 目标月份第 1 天
    const firstDay = new Date(Date.UTC(y, m - 1, 1));
    // 目标月份最后 1 天
    const lastDay = new Date(Date.UTC(y, m, 0));

    // JS Date: 0 is Sunday, 1 is Monday, ..., 6 is Saturday
    // 埃及周从周日开始，若第 1 天不是周日，则往前推到所在周的周日
    const startDayOfWeek = firstDay.getUTCDay(); // 0(Sun) - 6(Sat)
    const firstSunday = new Date(Date.UTC(y, m - 1, 1 - startDayOfWeek));

    const weeks = [];
    let currentSunday = new Date(firstSunday.getTime());

    const formatDate = d => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;

    // 循环直到覆盖到目标月最后一天所在的周
    while (currentSunday <= lastDay) {
        const currentSaturday = new Date(currentSunday.getTime() + 6 * 86400000);
        const key = `${formatDate(currentSunday)}-${formatDate(currentSaturday)}`;

        const days = [];
        for (let i = 0; i < 7; i++) {
            const dayDate = new Date(currentSunday.getTime() + i * 86400000);
            const inMonth = (dayDate.getUTCMonth() + 1 === m) && (dayDate.getUTCFullYear() === y);
            days.push({
                dateStr: dayDate.toISOString().slice(0, 10),
                month: dayDate.getUTCMonth() + 1,
                day: dayDate.getUTCDate(),
                year: dayDate.getUTCFullYear(),
                weekdayIndex: i, // 0: Sun, 1: Mon, ..., 5: Fri (weekend), 6: Sat (weekend)
                dayLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i],
                isWeekend: i === 5 || i === 6, // 埃及周末：周五和周六
                inTargetMonth: inMonth
            });
        }

        weeks.push({
            key,
            label: key,
            start: currentSunday.toISOString().slice(0, 10),
            end: currentSaturday.toISOString().slice(0, 10),
            days
        });

        currentSunday = new Date(currentSunday.getTime() + 7 * 86400000);
    }

    return weeks;
}

/**
 * 埃及标准工作日与周末垂直轴（纵轴）：从周日开始，到周五、周六结尾
 */
const EGYPT_WEEKDAYS = [
    { key: 'Sun', labelZh: '周日', labelEn: 'Sun', isWeekend: false },
    { key: 'Mon', labelZh: '周一', labelEn: 'Mon', isWeekend: false },
    { key: 'Tue', labelZh: '周二', labelEn: 'Tue', isWeekend: false },
    { key: 'Wed', labelZh: '周三', labelEn: 'Wed', isWeekend: false },
    { key: 'Thu', labelZh: '周四', labelEn: 'Thu', isWeekend: false },
    { key: 'Fri', labelZh: '周五', labelEn: 'Fri', isWeekend: true },
    { key: 'Sat', labelZh: '周六', labelEn: 'Sat', isWeekend: true }
];

/**
 * 构建默认空值班表或从已有数据恢复表格结构
 */
function buildDutyRosterTable(monthStr, existing = null) {
    const match = String(monthStr || '').match(/^(\d{4})-(0?[1-9]|1[0-2])$/);
    if (!match) throw new Error('Invalid month format, expected YYYY-MM');
    const year = Number(match[1]);
    const month = Number(match[2]);
    const normalizedMonth = `${year}-${String(month).padStart(2, '0')}`;

    const weeks = calculateEgyptWeeks(year, month);
    const cells = existing?.cells || {};
    const grid = existing?.grid || {};

    // 默认示例人员库（可供参考示例填充）
    const sampleNames = [
        'xuxiaotian', 'Pu Hai', 'Hou Xiaolei', 'Zheng chuang', 'zhangxiongfei',
        'hejinyao', 'Zhang Xuejun', 'Zhang Jun', 'Ma lin', 'hejinyao',
        'gaolei', 'Li ning', 'Wang lichao', 'Zhang haitao', 'yangxiang',
        'zengyueming', 'Xu Wei', 'Chenyin', 'Liu jiang', 'gaolei',
        'Xu mingrui', 'Zhukang', 'Tang jiapeng', 'wangxiaoshuan', 'zengyueming',
        'Zhao shuangyi', 'luojian', 'Yuan xichen', 'haorunjun', 'Huang Leisheng',
        'libaokang', 'Liu Shaokui', 'Zhao shuangyi', 'Zhao zhanxi', 'libaokang'
    ];

    // 构建行
    const rows = EGYPT_WEEKDAYS.map((wd, dayIdx) => {
        const rowObj = { Period: wd.key };
        weeks.forEach((w, wIdx) => {
            const dayMeta = w.days[dayIdx];
            const dateStr = dayMeta.dateStr;
            let val = cells[dateStr] ?? grid[w.key]?.[wd.key] ?? '';
            rowObj[w.key] = val;
        });
        return rowObj;
    });

    // 计算当月出勤人次（仅统计落在目标月份内的非空单元格）
    let monthlyCount = 0;
    weeks.forEach(w => {
        w.days.forEach(d => {
            if (d.inTargetMonth) {
                const dayKey = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekdayIndex];
                const val = cells[d.dateStr] || grid[w.key]?.[dayKey];
                if (val && String(val).trim()) monthlyCount++;
            }
        });
    });

    const totalDaysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const annualTotal = Number(existing?.totalCount || existing?.total_count || 353);

    const summaryText = existing?.summaryText || existing?.summary_text ||
        `In Total: ${annualTotal}, ${monthlyCount || totalDaysInMonth}*Person-times for Night Operation On-duty`;

    return {
        month: normalizedMonth,
        title: existing?.title || '夜间运维值班表',
        weeks,
        weekdays: EGYPT_WEEKDAYS,
        rows,
        cells,
        grid,
        totalCount: annualTotal,
        monthlyCount: monthlyCount || (existing?.monthlyCount ?? existing?.monthly_count ?? totalDaysInMonth),
        summaryText
    };
}

/**
 * 生成参考图示的默认示例值班表
 */
function getSampleDutyRoster(monthStr = '2026-08') {
    const table = buildDutyRosterTable(monthStr);
    const sampleGrid = {
        // 参考图片人员对应
        Sun: ['libaokang', 'Liu Shaokui', 'Zhao shuangyi', 'Zhao zhanxi', 'libaokang', 'Liu Shaokui'],
        Mon: ['xuxiaotian', 'Pu Hai', 'Hou Xiaolei', 'Zheng chuang', 'zhangxiongfei', 'Pu Hai'],
        Tue: ['hejinyao', 'Zhang Xuejun', 'Zhang Jun', 'Ma lin', 'hejinyao', 'Zhang Xuejun'],
        Wed: ['gaolei', 'Li ning', 'Wang lichao', 'Zhang haitao', 'yangxiang', 'Li ning'],
        Thu: ['zengyueming', 'Xu Wei', 'Chenyin', 'Liu jiang', 'gaolei', 'Xu Wei'],
        Fri: ['Xu mingrui', 'Zhukang', 'Tang jiapeng', 'wangxiaoshuan', 'zengyueming', 'Zhukang'],
        Sat: ['Zhao shuangyi', 'luojian', 'Yuan xichen', 'haorunjun', 'Huang Leisheng', 'luojian']
    };

    const cells = {};
    const grid = {};

    table.weeks.forEach((w, wIdx) => {
        grid[w.key] = {};
        w.days.forEach(d => {
            const dayKey = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekdayIndex];
            const name = sampleGrid[dayKey][wIdx % sampleGrid[dayKey].length];
            grid[w.key][dayKey] = name;
            cells[d.dateStr] = name;
        });
    });

    return buildDutyRosterTable(monthStr, {
        cells,
        grid,
        totalCount: 353,
        summaryText: 'In Total: 353, 31*Person-times for Night Operation On-duty'
    });
}

/**
 * 查询指定月份的值班表（若无则返回动态计算的空模板）
 */
async function getDutyRoster(monthStr) {
    await ensureReady();
    const match = String(monthStr || '').match(/^(\d{4})-(0?[1-9]|1[0-2])$/);
    if (!match) throw new Error('Invalid month format, expected YYYY-MM');
    const normalizedMonth = `${match[1]}-${String(match[2]).padStart(2, '0')}`;

    const row = await get('SELECT * FROM duty_rosters WHERE month = ?', [normalizedMonth]);
    if (!row) {
        return {
            ...buildDutyRosterTable(normalizedMonth),
            isSaved: false
        };
    }

    try {
        const rosterData = JSON.parse(row.roster_json);
        return {
            ...buildDutyRosterTable(normalizedMonth, {
                ...rosterData,
                title: row.title,
                totalCount: row.total_count,
                monthlyCount: row.monthly_count,
                summaryText: row.summary_text
            }),
            isSaved: true
        };
    } catch (_) {
        return {
            ...buildDutyRosterTable(normalizedMonth),
            isSaved: false
        };
    }
}

/**
 * 列出所有已保存的值班表月份
 */
async function listDutyRosters() {
    await ensureReady();
    const rows = await all('SELECT month, title, total_count, monthly_count, summary_text, updated_at FROM duty_rosters ORDER BY updated_at DESC, month DESC');
    return rows.map(r => ({
        month: r.month,
        title: r.title,
        totalCount: r.total_count,
        monthlyCount: r.monthly_count,
        summaryText: r.summary_text,
        updatedAt: r.updated_at
    }));
}

/**
 * 同步将值班表注册到 import_source 数据仓库中，使其在月报编辑器的“指标与关键数据表”中直接可见与调用
 */
async function syncToImportSources(payload) {
    const importRepo = require('./import-source-repository');
    await importRepo.ensureReady();

    const monthMatch = payload.month.match(/^(\d{4})-(0?[1-9]|1[0-2])$/);
    const monthNum = monthMatch ? Number(monthMatch[2]) : null;
    const yearNum = monthMatch ? Number(monthMatch[1]) : 2026;

    // 1. 查找或创建该目标月份对应的导入批次
    let batch = await get('SELECT id FROM import_source_batches WHERE target_month = ? AND source = "duty_roster" LIMIT 1', [monthNum]);
    if (!batch) {
        const batchId = crypto.randomUUID();
        const now = new Date(Date.UTC(yearNum, monthNum ? monthNum - 1 : 0, 1)).toISOString();
        await run(
            'INSERT INTO import_source_batches (id, created_at, source, target_month) VALUES (?, ?, ?, ?)',
            [batchId, now, 'duty_roster', monthNum]
        );
        batch = { id: batchId };
    }

    // 2. 构造 CSV 文本和工作表数据
    const headers = ['Period', ...payload.weeks.map(w => w.key)];
    const rows = payload.rows.map(r => {
        const out = { Period: r.Period };
        payload.weeks.forEach(w => {
            out[w.key] = r[w.key] || '';
        });
        return out;
    });

    // 追加合计行（便于表格直接查看合计）
    rows.push({
        Period: 'In Total',
        [payload.weeks[0].key]: payload.summaryText
    });

    // 转换成 CSV 文本作为原始文件存档
    const csvLines = [headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',')];
    rows.forEach(r => {
        csvLines.push(headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
    });
    const csvBuffer = Buffer.from(csvLines.join('\r\n'), 'utf8');

    const fileId = `duty_roster_file_${payload.month}`;
    const fileName = `夜间运维值班表_${payload.month}.xlsx`;
    const sourceKey = '夜间运维值班表';
    const sha256 = crypto.createHash('sha256').update(csvBuffer).digest('hex');
    const nowIso = new Date().toISOString();

    // 3. 写入/更新 import_source_files
    await run(`
        INSERT INTO import_source_files (
            id, batch_id, name, source_key, kind, size, sha256, original_blob, parse_status, parse_error, created_at
        ) VALUES (?, ?, ?, ?, 'duty_roster', ?, ?, ?, 'ready', '', ?)
        ON CONFLICT(id) DO UPDATE SET
            batch_id = excluded.batch_id,
            name = excluded.name,
            size = excluded.size,
            sha256 = excluded.sha256,
            original_blob = excluded.original_blob,
            parse_status = 'ready',
            created_at = excluded.created_at
    `, [fileId, batch.id, fileName, sourceKey, csvBuffer.length, sha256, csvBuffer, nowIso]);

    // 4. 写入/更新 import_source_sheets
    const sheetId = `duty_roster_sheet_${payload.month}`;
    await run(`
        INSERT INTO import_source_sheets (
            id, file_id, name, headers_json, rows_json, row_count
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_id, name) DO UPDATE SET
            headers_json = excluded.headers_json,
            rows_json = excluded.rows_json,
            row_count = excluded.row_count
    `, [sheetId, fileId, '夜间运维值班表', JSON.stringify(headers), JSON.stringify(rows), rows.length]);

    // 5. 注册提取快照，建立与 '夜间运维值班表' 指标的强绑定，确保在资料库“指标与关键数据表”中列出
    const snapshotId = `duty_roster_snapshot_${payload.month}`;
    const payloadJson = JSON.stringify({
        id: snapshotId,
        timestamp: nowIso,
        sourceBatchId: batch.id,
        files: [fileName],
        topMetrics: [
            {
                key: 'duty_roster:table',
                label: '夜间运维值班表',
                value: String(payload.monthlyCount || 31),
                fileIds: [fileId]
            },
            {
                key: 'duty_roster:person_times',
                label: '值班人次',
                value: String(payload.monthlyCount || 31),
                fileIds: [fileId]
            }
        ],
        sourceSections: [
            {
                key: 'duty_roster',
                title: '夜间运维值班表',
                headers,
                rows,
                sourceFiles: [fileName],
                fileIds: [fileId]
            }
        ],
        expiringTickets: []
    });

    await run(`
        INSERT INTO import_source_snapshots (
            id, batch_id, captured_at, target_month, payload_json
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            batch_id = excluded.batch_id,
            captured_at = excluded.captured_at,
            target_month = excluded.target_month,
            payload_json = excluded.payload_json
    `, [snapshotId, batch.id, nowIso, monthNum, payloadJson]);

    return { fileId, sheetId, snapshotId };
}

/**
 * 保存值班表并同步到服务端资料库
 */
async function saveDutyRoster(data) {
    await ensureReady();
    const month = String(data.month || '').trim();
    if (!/^\d{4}-(0?[1-9]|1[0-2])$/.test(month)) {
        throw new Error('Valid target month (YYYY-MM) is required');
    }

    const table = buildDutyRosterTable(month, data);
    const rosterId = `duty_roster_${table.month}`;
    const now = new Date().toISOString();

    const weeksJson = JSON.stringify(table.weeks);
    const rosterJson = JSON.stringify({
        cells: data.cells || table.cells,
        grid: data.grid || table.grid,
        totalCount: table.totalCount,
        monthlyCount: table.monthlyCount,
        summaryText: table.summaryText
    });

    await run(`
        INSERT INTO duty_rosters (
            id, month, title, weeks_json, roster_json, summary_text, total_count, monthly_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(month) DO UPDATE SET
            title = excluded.title,
            weeks_json = excluded.weeks_json,
            roster_json = excluded.roster_json,
            summary_text = excluded.summary_text,
            total_count = excluded.total_count,
            monthly_count = excluded.monthly_count,
            updated_at = excluded.updated_at
    `, [
        rosterId,
        table.month,
        table.title,
        weeksJson,
        rosterJson,
        table.summaryText,
        table.totalCount,
        table.monthlyCount,
        now,
        now
    ]);

    // 同步到月报编辑器数据资料库
    let syncResult = null;
    try {
        syncResult = await syncToImportSources(table);
    } catch (err) {
        console.error('[DUTY ROSTER] Sync to import sources failed:', err);
    }

    return {
        ...table,
        syncResult
    };
}

module.exports = {
    ensureReady,
    calculateEgyptWeeks,
    EGYPT_WEEKDAYS,
    buildDutyRosterTable,
    getSampleDutyRoster,
    getDutyRoster,
    listDutyRosters,
    saveDutyRoster,
    syncToImportSources
};
