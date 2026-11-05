const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const worker = require('../backend/scripts/factory-reset-worker');

function readAdmin(dbPath) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
        db.get('SELECT username, role, password_hash FROM auth_users', (error, row) => {
            db.close();
            error ? reject(error) : resolve(row);
        });
    });
}

test('factory reset archives all live data and preserves administrator and license files', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-factory-reset-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const dataDir = path.join(root, 'live-data');
    const reportDataDir = path.join(root, 'live-report');
    const archiveDir = path.join(root, 'archives', 'reset-1');
    const planPath = path.join(root, 'pending.json');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(reportDataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'business.json'), 'old business data');
    fs.writeFileSync(path.join(dataDir, 'first-run-defaults.json'), JSON.stringify({ decision: 'skip' }));
    fs.writeFileSync(path.join(dataDir, 'f12-license-registry.json'), '{"license":true}');
    fs.writeFileSync(path.join(reportDataDir, 'report.db'), 'old report data');
    fs.writeFileSync(planPath, JSON.stringify({
        parentPid: 99999999,
        dataDir,
        reportDataDir,
        archiveDir,
        admin: { username: 'owner', role: 'admin', passwordHash: 'kept-hash' }
    }));

    await worker.run(planPath);

    assert.equal(fs.existsSync(path.join(dataDir, 'business.json')), false);
    assert.equal(fs.existsSync(path.join(dataDir, 'first-run-defaults.json')), false, 'reset restores the pending quick-start choice');
    assert.equal(JSON.parse(fs.readFileSync(path.join(archiveDir, 'primary-data', 'first-run-defaults.json'), 'utf8')).decision, 'skip');
    assert.equal(fs.readFileSync(path.join(dataDir, 'f12-license-registry.json'), 'utf8'), '{"license":true}');
    assert.equal(fs.readFileSync(path.join(archiveDir, 'primary-data', 'business.json'), 'utf8'), 'old business data');
    assert.equal(fs.readFileSync(path.join(archiveDir, 'report-data', 'report.db'), 'utf8'), 'old report data');
    assert.deepEqual(await readAdmin(path.join(dataDir, 'tools.db')), {
        username: 'owner', role: 'admin', password_hash: 'kept-hash'
    });
    assert.equal(fs.existsSync(planPath), false);
});
