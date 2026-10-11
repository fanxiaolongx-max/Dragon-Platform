// Read-only, month-scoped worksheets over complete tenant meeting snapshots.
const meetings = require('./meeting-snapshots-repository');
const sourceTime = require('../../frontend/js/monthly-designer/source-rules').time;
const labels = { qr: 'QR', rfc: 'RFC', wfm: 'WFM', offline: '现场签到', online: '在线参会' };
const normalize = value => String(value ?? '').replace(/^\uFEFF/, '').trim();
const headerKey = value => normalize(value).replace(/\s+/g, ' ').replace(/\s*\/\s*/g, '/').toLowerCase();
function at(sheet, row, ...aliases) {
    for (const alias of aliases) {
        const index = sheet.headers.findIndex(header => headerKey(header) === headerKey(alias));
        if (index >= 0) return normalize(row[index]);
    }
    return '';
}
function dateText(value) {
    const text = normalize(value);
    const match = text.match(/(?:^|[^0-9])(20\d{2})[-_/.年](0?[1-9]|1[0-2])[-_/.月](0?[1-9]|[12]\d|3[01])日?(?:[^0-9]|$)/) || text.match(/(?:^|[^0-9])(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : '';
}
function rawOrderDate(sheet, row) {
    const ticket = at(sheet, row, ...(sheet.category === 'rfc' ? ['作业单号/Ticket ID', '作业单号', 'Ticket ID', 'Task ID'] : sheet.category === 'wfm' ? ['Task ID', '实施任务单号/Implementation Task No', '实施任务单号', 'Implementation Task No', '实施任务单', '任务单号', 'Task No'] : ['Task ID', '任务单号', 'Task No']));
    const match = ticket.match(/(?:[A-Za-z_-]{0,10})?(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/i) || ticket.match(/\b(20\d{2})[-/._](0?[1-9]|1[0-2])[-/._](0?[1-9]|[12]\d|3[01])\b/);
    if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    return dateText(at(sheet, row, ...(sheet.category === 'wfm' ? ['Task Create Time', 'Create Time', '创建时间/Create Time', '创建时间'] : sheet.category === 'rfc' ? ['创建时间/Create Time', '创建时间', 'Create Time'] : ['Create Time', '创建时间/Create Time', '创建时间'])));
}
function rawAttendanceDate(sheet, row) {
    const text = at(sheet, row, sheet.category === 'offline' ? '签到时间' : 'join_time');
    if (sheet.category !== 'offline') return dateText(text);
    const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/), reverse = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    const time = text.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
    if (!(match || reverse) || !time) return dateText(text);
    let hour = Number(time[1]);const minute = Number(time[2]), ampm = (time[3] || '').toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return dateText(text);
    const year = Number(match ? match[1] : reverse[3]), month = Number(match ? match[2] : reverse[2]), day = Number(match ? match[3] : reverse[1]);
    const instant = new Date(Date.UTC(year, month - 1, day, hour, minute) - 8 * 3600000);
    const parts = Object.fromEntries(cairoDateFormat.formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
// Reuse the formatter and per-row dates during repeated month/category passes.
const cairoDateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'});
const dateCaches=new WeakMap(),payloadSizes=new WeakMap();
function rowDate(sheet,row,read){let byReader=dateCaches.get(sheet);if(!byReader){byReader=new Map();dateCaches.set(sheet,byReader);}let cache=byReader.get(read);if(!cache){cache=new WeakMap();byReader.set(read,cache);}if(!cache.has(row))cache.set(row,read(sheet,row));return cache.get(row);}
function orderDate(sheet,row){return rowDate(sheet,row,rawOrderDate);}
function attendanceDate(sheet,row){return rowDate(sheet,row,rawAttendanceDate);}
function payloadSize(item){if(!payloadSizes.has(item))payloadSizes.set(item,Buffer.byteLength(JSON.stringify(item.payload)));return payloadSizes.get(item);}
function meetingDates(item, sheets) {
    if (Array.isArray(item.summary?.sessions) && item.summary.sessions.length) return [...new Set(item.summary.sessions.map(session => dateText(session.date)).filter(Boolean))];
    // Old snapshots saved session details only for multiple sessions. Preserve the
    // tool's explicit-name/file date, then dominant attendance-date precedence.
    const dates = sheets.filter(sheet => ['offline', 'online'].includes(sheet.category)).map(sheet => {
        const explicit = dateText(sheet.sessionName) || dateText(sheet.fileName) || dateText(sheet.sheetName);
        if (explicit) return explicit;
        const counts = new Map();for (const row of sheet.rows) { const date = attendanceDate(sheet, row);if (date) counts.set(date, (counts.get(date) || 0) + 1); }
        return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    }).filter(Boolean);
    return [...new Set(dates.length ? dates : [dateText(item.payload?.attendanceRules?.meetingDate) || dateText(item.meetingDate)])].filter(Boolean);
}
function windowStart(date, months) {
    const [year, month, day] = date.split('-').map(Number), first = new Date(Date.UTC(year, month - 1 - months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(day, lastDay));return first.toISOString().slice(0, 10);
}
const encodeId = value => Buffer.from(value).toString('base64url');
function parseId(value) {
    const match = String(value || '').match(/^ms-([\w-]+)-(\d{4}-\d{2})-(qr|rfc|wfm|offline|online)(?:-s(\d+))?$/);
    if (!match || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(match[2])) return null;
    return { snapshotId: Buffer.from(match[1], 'base64url').toString(), period: match[2], category: match[3], index: match[4] === undefined ? null : Number(match[4]) };
}
function tables(item, period, category, metadataOnly=false) {
    const sheets = (Array.isArray(item.payload?.sheets) ? item.payload.sheets : []).filter(sheet => labels[sheet.category] && Array.isArray(sheet.headers) && Array.isArray(sheet.rows));
    const dates = meetingDates(item, sheets).filter(date => date.startsWith(period));
    const months = item.payload?.attendanceRules?.orderWindowMonths ?? 1;
    const unrestricted = months === 'all' || Number(months) === 0;
    const windows = dates.map(date => ({ start: unrestricted ? '' : windowStart(date, Number(months) > 0 ? Number(months) : 1), end: date }));
    const id = `ms-${encodeId(item.id)}-${period}-${category}`, batchId = `ms-${encodeId(item.id)}-${period}`;
    let unknownCount = 0, originalRowCount = 0;
    const output = sheets.map((sheet, index) => {
        if (sheet.category !== category) return null;
        originalRowCount += sheet.rows.length;
        const rows = sheet.rows.filter(row => {
            const date = ['offline', 'online'].includes(category) ? attendanceDate(sheet, row) : orderDate(sheet, row);
            if (!date) { unknownCount++; return !['offline', 'online'].includes(category) && windows.length > 0; }
            return ['offline', 'online'].includes(category) || !windows.length ? date.startsWith(period) : windows.some(window => !window.start || (date >= window.start && date <= window.end));
        });
        // Duplicate/blank source headings remain distinct in object-backed sheets.
        const used = new Set(), headers = sheet.headers.map((header, i) => { const base = normalize(header) || `Column ${i + 1}`;let name = base, suffix = 2;while (used.has(name)) name = `${base} (${suffix++})`;used.add(name);return name; });
        return { id: `${id}-s${index}`, fileId: id, name: `${sheet.sheetName || 'Sheet'} · ${index + 1}`, headers, rowCount:rows.length, rows: metadataOnly?[]:rows.map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? null]))) };
    }).filter(Boolean);
    if (!output.some(sheet => sheet.rowCount)) return null;
    const filterScope = ['offline', 'online'].includes(category) ? `${period} · ${category === 'offline' ? '北京时间转开罗日期' : '入会日期'}` : windows.length ? unrestricted ? `${period}会议 · 工单不限日期（沿用考勤规则）` : windows.map(window => `${window.start}～${window.end}`).join(' / ') : `${period} · 工单日期（本月无会议）`;
    const created = item.updatedAt || item.createdAt;
    return { batch: { id: batchId, created_at: created, source: 'meeting_attendance', target_month: Number(period.slice(5)), target_period: period }, file: { id, batch_id: batchId, name: `会议考勤-${labels[category]}-${period}-${item.id}.xlsx`, source_key: `会议考勤:${category}`, kind: 'meeting_attendance', size: payloadSize(item), created_at: created, target_period: period, source_snapshot_id: item.id, snapshot_title: item.title, category, filter_scope: filterScope, unknown_date_rows: unknownCount, unknown_dates_retained: !['offline', 'online'].includes(category) && windows.length > 0, original_row_count: originalRowCount, parse_status: 'ready', parse_error: '', metricLabels: [labels[category]] }, sheets: output };
}
const meetingCatalogCache = new Map();
async function catalog(options={}) {
    const files = [], batches = new Map(), errors=[];
    const currentKeys = new Set();
    const tenantId = (require('./tenant-context').getTenantId) ? require('./tenant-context').getTenantId() : 'default';
    // Pick by import/update time, not meeting business date. Load payload only for selected versions.
    let versions=await meetings.listSnapshots({since:options.since});
    if(options.latestOnly){
        const required=new Set((options.meetingFileIds||[]).map(id=>parseId(id)?.snapshotId).filter(Boolean));
        versions.sort((a,b)=>sourceTime(b.updatedAt||b.createdAt)-sourceTime(a.updatedAt||a.createdAt)||String(b.id).localeCompare(String(a.id)));
        const latest=versions[0]?.id;versions=versions.filter(item=>item.id===latest||required.has(item.id));
    }
    for (const version of versions) {
        const item=await meetings.getSnapshot(version.id);if(!item)continue;
        await new Promise(resolve=>setImmediate(resolve));
        try{
        if(!item.payload||!Array.isArray(item.payload.sheets))throw new Error('Invalid source payload');
        const cacheKey = `${tenantId}:${item.id}:${item.updatedAt || item.createdAt}`;
        currentKeys.add(cacheKey);
        let cached = meetingCatalogCache.get(cacheKey);
        if (!cached) {
            const sheets = (Array.isArray(item.payload?.sheets) ? item.payload.sheets : []).filter(sheet => labels[sheet.category] && Array.isArray(sheet.headers) && Array.isArray(sheet.rows));
            const periods = new Set(meetingDates(item, sheets).map(date => date.slice(0, 7)));
            for (const sheet of sheets) for (const row of sheet.rows) { const date = ['offline', 'online'].includes(sheet.category) ? attendanceDate(sheet, row) : orderDate(sheet, row);if (date) periods.add(date.slice(0, 7)); }
            const itemBatches = [], itemFiles = [];
            for (const period of periods) for (const category of Object.keys(labels)) {
                const source = tables(item, period, category,true);if (!source) continue;
                itemBatches.push(source.batch);
                itemFiles.push({ ...source.file, sheets: source.sheets.map(sheet => ({ id: sheet.id, name: sheet.name, headers: sheet.headers, rowCount: sheet.rowCount })) });
            }
            cached = { batches: itemBatches, files: itemFiles };
            meetingCatalogCache.set(cacheKey, cached);
        }
        for (const b of cached.batches) batches.set(b.id, b);
        for (const f of cached.files) files.push(f);
        }catch(_){errors.push({stage:"meeting",id:item.id,code:"INVALID_MEETING_SOURCE"});}
    }
    for (const k of meetingCatalogCache.keys()) if (!options.since && k.startsWith(tenantId + ':') && !currentKeys.has(k)) meetingCatalogCache.delete(k);
    return { files, batches: [...batches.values()],errors };
}
async function source(value) { const parsed = parseId(value);if (!parsed) return null;const item = await meetings.getSnapshot(parsed.snapshotId);return item ? { ...tables(item, parsed.period, parsed.category), index: parsed.index } : null; }
async function getSheet(value) { const result = await source(value);return result?.sheets?.find(sheet => sheet.id === value) || null; }
async function getFile(value, original = false) {
    const result = await source(value);if (!result?.file || result.index !== null) return null;
    if (!original) return result.file;
    const ExcelJS = require('exceljs'), workbook = new ExcelJS.Workbook();
    result.sheets.forEach((sheet, i) => { const target = workbook.addWorksheet(`${sheet.name.replace(/[\\/?*\[\]:]/g, ' ').slice(0, 25)}-${i + 1}`);target.addRow(sheet.headers);for (const row of sheet.rows) target.addRow(sheet.headers.map(header => row[header]));target.getRow(1).font = { bold: true }; });
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());return { ...result.file, size: bytes.length, original_blob: bytes };
}
module.exports = { catalog, getFile, getSheet, orderDate, attendanceDate, windowStart };
