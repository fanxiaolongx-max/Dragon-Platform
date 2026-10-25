const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'meeting-latest-month-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'reports');
const db = require('../backend/models/app-db');
const pool = require('../backend/models/tenant-sqlite-pool');
const { runWithTenant } = require('../backend/models/tenant-context');
const repo = require('../backend/models/meeting-snapshots-repository');
const routes = require('../backend/routes/meeting-snapshots');
const { collectMeetingData } = require('../backend/models/static-snapshot-data');

test.after(async () => {
    await db.closeDatabase();
    await pool.closeAll();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

const person = { staffId: 'T99101', name: '测试人员' };
const attendee = attendance => ({ account: person.staffId, name: person.name, attendance });

async function save(id, meetingDate, attendance, updatedAt, extra = {}) {
    const snapshot = await repo.saveSnapshot({
        id, title: id, meetingDate,
        summary: { attendees: attendance ? [attendee(attendance)] : [], ...extra },
        payload: { sheets: [] }
    });
    if (updatedAt) {
        // This database is in the test's temporary directory, never the installed data directory.
        await db.run('UPDATE meeting_attendance_snapshots SET created_at = ?, updated_at = ? WHERE id = ?',
            [updatedAt, updatedAt, id]);
    }
    return snapshot;
}

async function checkBoth() {
    const single = await repo.checkPersonAttendance(person);
    const batch = (await repo.batchCheckAttendance([person]))[`${person.staffId}|${person.name}`];
    assert.deepEqual(batch, single, 'single and batch APIs must apply the same snapshot policy');
    return batch;
}

test('latest saved version wins per year/month, regardless of meeting day, title or ID', () =>
    runWithTenant('corrected', async () => {
        await save('z-old-september', '2026-09-30', 'Delay', '2026-10-01 09:00:00');
        await save('a-new-september', '2026-09-01', 'Attend on Time', '2026-10-02 09:00:00');
        await save('august', '2026-08-01', 'Absent', '2026-10-03 09:00:00');
        await save('previous-year', '2025-09-01', 'Delay', '2026-10-04 09:00:00');
        const result = await checkBoth();
        assert.equal(result.totalMeetingsChecked, 3);
        assert.equal(result.cleanCount, 1);
        assert.equal(result.anomalyCount, 2);
        assert.deepEqual(result.records.map(r => r.snapshotId).sort(), ['a-new-september', 'august', 'previous-year']);
        assert.equal(result.anomalies.some(r => r.snapshotId.includes('september')), false);
        assert.equal((await repo.listSnapshots()).length, 4, 'history retains every saved version');
    }));

test('newest snapshot retains all sessions and reports each anomaly only once', () =>
    runWithTenant('sessions', async () => {
        const sessions = [
            { ...attendee('Delay'), sessionName: '第一场', date: '2026-09-05' },
            { ...attendee('Absent'), sessionName: '第二场', date: '2026-09-22' }
        ];
        await save('old', '2026-09-22', 'Absent', '2026-10-01 09:00:00', { sessionAttendees: sessions });
        await save('new', '2026-09-22', 'Absent', '2026-10-02 09:00:00', { sessionAttendees: sessions });
        const result = await checkBoth();
        assert.equal(result.anomalyCount, 2);
        assert.equal(result.totalMeetingsChecked, 2);
        assert.deepEqual(result.anomalies.map(r => [r.snapshotId, r.sessionName, r.meetingDate]), [
            ['new', '第一场', '2026-09-05'], ['new', '第二场', '2026-09-22']
        ]);
        const exported = await collectMeetingData();
        assert.equal(exported.snapshots.length, 2);
        const exportedCheck = Object.values(exported.attendance).find(r => r.found);
        assert.equal(exportedCheck.anomalyCount, 2, 'static exports also use latest monthly attendance');
        assert.ok(exportedCheck.records.every(r => r.snapshotId === 'new'));
    }));

test('latest snapshot with missing employee or empty attendance never falls back to old anomalies', () =>
    runWithTenant('removed', async () => {
        await save('old', '2026-09-22', 'Absent', '2026-10-01 09:00:00');
        await save('new', '2026-09-22', '', '2026-10-02 09:00:00', {
            attendees: [{ account: 'OTHER99102', name: '其他人员', attendance: 'Delay' }]
        });
        assert.equal((await checkBoth()).found, false);
        await save('empty', '2026-09-22', '', '2026-10-03 09:00:00');
        const result = await checkBoth();
        assert.equal(result.hasAnomaly, false);
        assert.equal(result.anomalyCount, 0);
        assert.deepEqual(result.records, []);
    }));

test('equal legacy timestamps use insertion order rather than random snapshot IDs', () =>
    runWithTenant('ties', async () => {
        await save('z-first', '2026-09-30', 'Absent', '2026-10-01 09:00:00');
        await save('a-last', '2026-09-01', 'Attend on Time', '2026-10-01 09:00:00');
        const result = await checkBoth();
        assert.equal(result.anomalyCount, 0);
        assert.deepEqual(result.records.map(r => r.snapshotId), ['a-last']);
    }));

test('saving a correction to an existing snapshot makes its data authoritative', () =>
    runWithTenant('updated', async () => {
        await save('first', '2026-09-30', 'Absent', '2026-01-01 09:00:00');
        await save('second', '2026-09-01', 'Delay', '2026-01-02 09:00:00');
        const corrected = await save('first', '2026-09-30', 'Attend on Time');
        assert.match(corrected.updatedAt, /\.\d{3}$/);
        const result = await checkBoth();
        assert.equal(result.anomalyCount, 0);
        assert.deepEqual(result.records.map(r => r.snapshotId), ['first']);
    }));

test('monthly version selection is tenant isolated', async () => {
    await runWithTenant('tenant-a', () => save('same', '2026-09-22', 'Absent', '2026-10-01 09:00:00'));
    await runWithTenant('tenant-b', () => save('same', '2026-09-22', 'Attend on Time', '2026-10-02 09:00:00'));
    await runWithTenant('tenant-a', async () => assert.equal((await checkBoth()).anomalyCount, 1));
    await runWithTenant('tenant-b', async () => assert.equal((await checkBoth()).anomalyCount, 0));
});

test('HTTP batch and single checks agree, while the history API keeps old versions', () =>
    runWithTenant('http', async () => {
        await save('old', '2026-09-22', 'Absent', '2026-10-01 09:00:00');
        await save('new', '2026-09-22', 'Attend on Time', '2026-10-02 09:00:00');
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => runWithTenant('http', next));
        app.use('/api/meeting-snapshots', routes);
        const server = await new Promise(resolve => {
            const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
        });
        const base = `http://127.0.0.1:${server.address().port}/api/meeting-snapshots`;
        try {
            const singleResponse = await fetch(`${base}/attendance-check?staffId=${person.staffId}&name=${encodeURIComponent(person.name)}`);
            const batchResponse = await fetch(`${base}/batch-attendance-check`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persons: [person] })
            });
            assert.equal(singleResponse.status, 200);
            assert.equal(batchResponse.status, 200);
            const single = await singleResponse.json();
            const batch = await batchResponse.json();
            assert.equal(single.hasAnomaly, false);
            assert.equal(single.cleanCount, 1);
            assert.deepEqual(batch.results[`${person.staffId}|${person.name}`], single.data);
            const history = await (await fetch(base)).json();
            assert.equal(history.count, 2);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    }));
