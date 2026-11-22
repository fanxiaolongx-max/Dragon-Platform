const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alert-pages-'));
process.env.TOOLS_DATA_DIR = dir;
const repo = require('../backend/models/alert-center-repository');
const db = require('../backend/models/app-db');

test('warning pages retain their boundary across inserts and marking the cursor read', async () => {
    await repo.listEvents();
    const insert = (id, severity) => db.run(
        'INSERT INTO alert_center_events (id, title, severity, created_at) VALUES (?, ?, ?, ?)',
        [id, id, severity, '2026-11-20 12:00:00']
    );
    await insert('old', 'warn');
    await insert('middle', 'error');
    await insert('info', 'info');
    const options = { status: 'unread', warningsOnly: true, limit: 1 };
    const [first] = await repo.listEvents(options);
    assert.equal(first.id, 'middle');
    await repo.markRead([first.id]);
    await insert('new', 'critical');
    assert.deepEqual((await repo.listEvents({ ...options, before: first.id })).map(row => row.id), ['old']);
});
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
