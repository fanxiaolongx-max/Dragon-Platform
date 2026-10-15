const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const sqlite3 = require('sqlite3').verbose();

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-warehouse-backup-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const backupRepo = require('../backend/models/global-backup-repository');
const pool = require('../backend/models/tenant-sqlite-pool');
const { getDataDir, runWithTenant } = require('../backend/models/tenant-context');
const filename = 'ezscan-warehouse.db';

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}

function get(db, sql) {
    return new Promise((resolve, reject) => db.get(sql, (error, row) => error ? reject(error) : resolve(row)));
}

function close(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function readSnapshot(filePath) {
    const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY);
    try {
        return await get(db, 'SELECT value FROM warehouse_backup_probe WHERE id = 1');
    } finally {
        await close(db);
    }
}

async function seedWarehouse(tenantId, value) {
    await runWithTenant(tenantId, async () => {
        const db = pool.getConnection(filename);
        await run(db, 'PRAGMA wal_autocheckpoint = 0');
        await run(db, 'CREATE TABLE warehouse_backup_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        await run(db, 'INSERT INTO warehouse_backup_probe VALUES (1, ?)', [value]);
    });
}

test.after(async () => {
    await pool.closeAll();
    await require('../backend/models/app-db').closeDatabase();
    await require('../backend/models/platform-db').closeDatabase();
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('global backup does not create a warehouse database for an unused tenant', async () => {
    await runWithTenant('unused-warehouse', async () => {
        const source = path.join(getDataDir(), filename);
        assert.equal(fs.existsSync(source), false);
        const backup = await backupRepo.createBackup({ reason: 'warehouse-absent', skipCapacityPrune: true });
        const zip = await JSZip.loadAsync(fs.readFileSync(backupRepo.getBackupPath(backup.name)));
        assert.equal(zip.file(`primary_data/${filename}`), null);
        assert.equal(fs.existsSync(source), false);
    });
});

test('global backup restores committed warehouse WAL data and keeps tenant databases isolated', async () => {
    await seedWarehouse('warehouse-a', 'tenant-a-backed-up');
    await seedWarehouse('warehouse-b', 'tenant-b-live');
    await seedWarehouse('default', 'default-live');

    await runWithTenant('warehouse-a', async () => {
        const source = path.join(getDataDir(), filename);
        assert.ok(fs.statSync(`${source}-wal`).size > 32, 'fixture must contain committed WAL pages');
        const backup = await backupRepo.createBackup({ reason: 'warehouse-wal', skipCapacityPrune: true });
        const zipPath = backupRepo.getBackupPath(backup.name);
        const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
        assert.ok(zip.file(`primary_data/${filename}`));
        assert.equal(zip.file(`primary_data/${filename}-wal`), null);
        assert.equal(zip.file(`primary_data/${filename}-shm`), null);
        assert.equal(Object.keys(zip.files).some(name => name.includes('/tenants/')), false);
        const extracted = path.join(sandbox, 'warehouse-snapshot.db');
        fs.writeFileSync(extracted, await zip.file(`primary_data/${filename}`).async('nodebuffer'));
        assert.deepEqual(await readSnapshot(extracted), { value: 'tenant-a-backed-up' });

        const archivedFiles = Object.values(zip.files).filter(entry => !entry.dir && entry.name !== 'manifest.json');
        assert.equal(backup.manifest.totalFiles, archivedFiles.length);
        let archivedBytes = 0;
        for (const entry of archivedFiles) archivedBytes += (await entry.async('nodebuffer')).length;
        assert.equal(backup.manifest.totalBytes, archivedBytes);

        await run(pool.getConnection(filename), "UPDATE warehouse_backup_probe SET value = 'tenant-a-after-backup'");
        const restored = await backupRepo.restoreFromZip(zipPath, {
            skipSafetyBackup: true,
            onProgress(progress) {
                if (progress.stage === 'database-closed') {
                    // Simulate leftover sidecars after all live handles close.
                    fs.writeFileSync(`${source}-wal`, 'stale WAL');
                    fs.writeFileSync(`${source}-shm`, 'stale SHM');
                }
            }
        });
        assert.equal(restored.success, true);
        assert.equal(fs.existsSync(`${source}-wal`), false);
        assert.equal(fs.existsSync(`${source}-shm`), false);
        assert.deepEqual(await get(pool.getConnection(filename), 'SELECT value FROM warehouse_backup_probe WHERE id = 1'), { value: 'tenant-a-backed-up' });
    });

    for (const [tenantId, value] of [['warehouse-b', 'tenant-b-live'], ['default', 'default-live']]) {
        await runWithTenant(tenantId, async () => {
            assert.deepEqual(await get(pool.getConnection(filename), 'SELECT value FROM warehouse_backup_probe WHERE id = 1'), { value });
        });
    }
});
