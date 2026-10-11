const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-source-tables-'));process.env.TOOLS_DATA_DIR = path.join(temp, 'tools');process.env.TOOLS_REPORT_DATA_DIR = path.join(temp, 'reports');
const meetings = require('../backend/models/meeting-snapshots-repository'), sources = require('../backend/models/import-source-repository'), adapter = require('../backend/models/meeting-source-tables'), { runWithTenant } = require('../backend/models/tenant-context');
const payload = { attendanceRules: { orderWindowMonths: 1, minSessionRecords: 1 }, sheets: [
 { category: 'qr', fileName: 'QR.xlsx', sheetName: 'Orders', headers: ['Task ID', 'Create Time', '客户', '金额'], rows: [['QR202608060001', '2026-01-01', 'A', 12], ['QR202608040002', '2026-09-01', 'B', 13], ['unknown', '2026-09-04', 'C', 14], ['unknown', '', 'D', 15], ['QR202604010003', '2026-09-01', 'E', 16]] },
 { category: 'rfc', fileName: 'RFC.xlsx', headers: ['作业单号/Ticket ID', '创建时间/Create Time'], rows: [['NC202609030001', '2026-01-01'], ['NC202605010001', '2026-09-01']] },
 { category: 'wfm', fileName: 'WFM.xlsx', headers: ['实施任务单号/Implementation Task No', 'Task Create Time'], rows: [['TK202608200001', '2026-01-01'], ['TE202605010002', '2026-09-01']] },
 { category: 'offline', fileName: 'Checkin.xlsx', headers: ['工号', '签到时间'], rows: [['a1', '2026-10-01 01:00:00'], ['a2', '2026-10-01 10:00:00'], ['a3', '2026-09-05 15:00:00'], ['a4', 'bad']] },
 { category: 'online', fileName: 'Online.xlsx', headers: ['user_id', 'join_time'], rows: [['b1', '2026-09-05 09:00:00'], ['b2', '2026-10-01 09:00:00'], ['b3', '2026-08-01 09:00:00']] }
] };
test.after(async () => { await require('../backend/models/app-db').closeDatabase();await require('../backend/models/tenant-sqlite-pool').closeAll(); });
let snapshotId;
test('complete original sheets remain stored; all five categories expose prefiltered month-scoped rows', async () => {
 const saved = await meetings.saveSnapshot({ title: 'Monthly attendance', meetingDate: '2026-09-05', summary: { sessions: [{ date: '2026-09-05' }, { date: '2026-10-01' }] }, payload });snapshotId = saved.id;
 const catalog = await sources.catalog(), files = catalog.files.filter(file => file.kind === 'meeting_attendance' && file.target_period === '2026-09');assert.equal(files.length, 5);
 const byCategory = Object.fromEntries(files.map(file => [file.category, file]));
 const qr = await sources.getSheet(byCategory.qr.sheets[0].id);assert.deepEqual(qr.rows.map(row => row['客户']), ['A', 'C', 'D']);assert.equal(qr.rows[0]['金额'], 12);assert.equal(byCategory.qr.filter_scope, '2026-08-05～2026-09-05');
 assert.equal((await sources.getSheet(byCategory.rfc.sheets[0].id)).rows.length, 1);assert.equal((await sources.getSheet(byCategory.wfm.sheets[0].id)).rows.length, 1);
 assert.deepEqual((await sources.getSheet(byCategory.offline.sheets[0].id)).rows.map(row => row['工号']), ['a1', 'a3']);assert.equal(byCategory.offline.unknown_date_rows, 1);
 assert.deepEqual((await sources.getSheet(byCategory.online.sheets[0].id)).rows.map(row => row.user_id), ['b1']);
 const october = catalog.files.find(file => file.category === 'offline' && file.target_period === '2026-10');assert.deepEqual((await sources.getSheet(october.sheets[0].id)).rows.map(row => row['工号']), ['a2']);
 assert.deepEqual((await meetings.getSnapshot(snapshotId)).payload.sheets, payload.sheets);
 await runWithTenant('isolated-meeting', async () => { assert.equal((await sources.catalog()).files.length, 0);assert.equal(await sources.getSheet(qr.id), null);assert.equal(await sources.getFile(byCategory.qr.id, true), null); });
});
test('window clamps month-end, unions distinct meetings without filling gaps, supports all-time setting and old snapshots', async () => {
 assert.equal(adapter.windowStart('2026-03-31', 1), '2026-02-28');
 const saved = await meetings.saveSnapshot({ title: 'Separate meetings', meetingDate: '2026-09-05', summary: { sessions: [{ date: '2026-09-05' }, { date: '2026-09-25' }] }, payload: { attendanceRules: { orderWindowMonths: 0 }, sheets: [payload.sheets[0]] } });
 let catalog = await sources.catalog(), file = catalog.files.find(file => file.source_snapshot_id === saved.id && file.target_period === '2026-09');assert.equal((await sources.getSheet(file.sheets[0].id)).rows.length, 5);
 const historic = await meetings.saveSnapshot({ title: 'Historical', meetingDate: '2020-09-02', payload: { sheets: [{ category: 'online', fileName: '2020-09-02.xlsx', headers: ['join_time'], rows: [['2020-09-02 10:00:00']] }] } });
 catalog = await sources.catalog();file = catalog.files.find(file => file.source_snapshot_id === historic.id);assert.equal(file.target_period, '2020-09');
 assert.equal(await sources.getSheet(file.id + '-s999'), null);
});
test('download endpoints return the filtered workbook and remain tenant-isolated', async t => {
 const express = require('express'), web = express();web.use((req, res, next) => runWithTenant(req.headers['x-test-tenant'] || 'default', next));web.use('/api/upload', require('../backend/routes/import-sources'));
 const server = await new Promise(resolve => { const listener = web.listen(0, '127.0.0.1', () => resolve(listener)); });t.after(() => new Promise(resolve => server.close(resolve)));
 const base = `http://127.0.0.1:${server.address().port}/api/upload`, catalog = await (await fetch(base + '/source-catalog')).json(), file = catalog.files.find(file => file.source_snapshot_id === snapshotId && file.category === 'qr' && file.target_period === '2026-09');
 const response = await fetch(base + '/source-files/' + encodeURIComponent(file.id) + '/download');assert.equal(response.status, 200);const ExcelJS = require('../backend/node_modules/exceljs'), workbook = new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));assert.equal(workbook.worksheets[0].rowCount, 4);assert.equal(workbook.worksheets[0].getCell(2, 4).value, 12);
 assert.equal((await fetch(base + '/source-sheets/' + encodeURIComponent(file.sheets[0].id), { headers: { 'x-test-tenant': 'isolated-meeting' } })).status, 404);
});
