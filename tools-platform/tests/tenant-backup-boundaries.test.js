const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const sqlite3 = require('sqlite3').verbose();

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-platform-tenant-backup-'));
process.env.TOOLS_DATA_DIR = path.join(sandbox, 'data');
process.env.TOOLS_REPORT_DATA_DIR = path.join(sandbox, 'report-data');

const backupRepo = require('../backend/models/global-backup-repository');
const remoteRepo = require('../backend/models/remote-backup-sync-repository');
const { getDataDir, runWithTenant } = require('../backend/models/tenant-context');

test.after(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
});

test('tenant backup excludes operational history, caches, browser profiles, temporary imports, and sibling tenants', () => {
    const target = backupRepo.DATA_TARGETS.find(item => item.id === 'primary_data');
    for (const name of [
        'backups', 'tmp', 'quarantine', 'runtime', 'cache', 'agent-browser',
        'images', 'slide-library', 'tenants',
        'chat-history.db', 'chat-history.db-wal', 'chat-history.db-shm'
    ]) {
        assert.equal(target.excludeTopLevel.includes(name), true, `${name} should be excluded`);
    }
});

test('backup capacity pruning removes oldest packages and preserves the newest recovery point', async () => {
    await runWithTenant('capacity-test', async () => {
        const backupDir = backupRepo.getBackupDir();
        fs.mkdirSync(backupDir, { recursive: true });
        const names = ['oldest.zip', 'middle.zip', 'newest.zip'];
        names.forEach((name, index) => {
            const filePath = path.join(backupDir, name);
            fs.writeFileSync(filePath, '');
            fs.truncateSync(filePath, 60 * 1024 * 1024);
            const timestamp = new Date(Date.now() - (names.length - index) * 60_000);
            fs.utimesSync(filePath, timestamp, timestamp);
        });

        const cleanup = backupRepo.pruneBackupsByCapacity(0.1, { protectNames: ['newest.zip'] });
        assert.equal(cleanup.removedCount, 2);
        assert.equal(cleanup.capacityExceeded, false);
        assert.equal(fs.existsSync(path.join(backupDir, 'newest.zip')), true);
        assert.equal(fs.existsSync(path.join(backupDir, 'oldest.zip')), false);
        assert.equal(fs.existsSync(path.join(backupDir, 'middle.zip')), false);
    });
});

test('restore rejects a backup created for a different tenant before replacing data', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
        type: 'tools-platform-global-backup',
        version: 2,
        scope: 'single-tenant',
        tenantId: 'tenant-a',
        includesAllTenants: false,
        targets: []
    }));
    const zipPath = path.join(sandbox, 'tenant-a.zip');
    fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    await assert.rejects(
        () => runWithTenant('tenant-b', () => backupRepo.restoreFromZip(zipPath, { skipSafetyBackup: true })),
        /备份包属于租户“tenant-a”.*当前租户为“tenant-b”.*拒绝恢复/
    );
    assert.equal(fs.existsSync(path.join(getDataDir('tenant-b'), 'tools.db')), false);

    const forced = await runWithTenant('tenant-b', () => backupRepo.restoreFromZip(zipPath, {
        skipSafetyBackup: true,
        forceCrossTenant: true
    }));
    assert.equal(forced.forcedCrossTenant, true);
    assert.deepEqual(forced.sourceTenant, { id: 'tenant-a', name: 'tenant-a' });
    assert.deepEqual(forced.targetTenant, { id: 'tenant-b', name: 'tenant-b' });
});

test('remote backup switches to the same tenant before listing or restoring backups', async () => {
    const settingsDir = path.join(process.env.TOOLS_DATA_DIR, '../runtime');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'remote_backup_sync_settings.json'), JSON.stringify({
        enabled: true,
        baseUrl: 'https://remote.example',
        username: 'backup-admin',
        password: 'secret',
        compareBeforeRestore: true,
        createRemoteBackupBeforePull: false,
        autoRestore: false
    }));

    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        if (String(url).endsWith('/api/auth/login')) {
            return { ok: true, json: async () => ({ token: 'remote-token' }) };
        }
        if (String(url).endsWith('/api/tenants/switch')) {
            return { ok: true, json: async () => ({ success: true, tenantId: 'acme' }) };
        }
        if (String(url).endsWith('/api/global-backup/list')) {
            return { ok: true, json: async () => ({ backups: [] }) };
        }
        throw new Error(`Unexpected request: ${url}`);
    };

    try {
        const result = await runWithTenant('acme', () => remoteRepo.pullRemoteBackup({
            restore: false,
            force: true,
            createRemoteBackupBeforePull: false
        }));
        assert.equal(result.restored, false);
        assert.equal(calls[1].url, 'https://remote.example/api/tenants/switch');
        assert.deepEqual(JSON.parse(calls[1].options.body), { tenantId: 'acme' });
        assert.equal(calls[1].options.headers.Authorization, 'Bearer remote-token');
        assert.equal(calls[2].url, 'https://remote.example/api/global-backup/list');
    } finally {
        global.fetch = originalFetch;
    }
});

function sqliteGet(dbPath, sql, params = []) {
    const db = new sqlite3.Database(dbPath);
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => {
        db.close(() => error ? reject(error) : resolve(row));
    }));
}

test('restoring the default tenant preserves the live account and tenant control plane', async () => {
    const platformDb = require('../backend/models/platform-db');
    const appDb = require('../backend/models/app-db');
    await platformDb.run('CREATE TABLE IF NOT EXISTS auth_users (username TEXT PRIMARY KEY, role TEXT NOT NULL, password_hash TEXT NOT NULL)');
    await platformDb.run('CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT NOT NULL, expires_at INTEGER NOT NULL, active_tenant_id TEXT NOT NULL)');
    await platformDb.run('CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT \'\', status TEXT NOT NULL)');
    await appDb.run('CREATE TABLE IF NOT EXISTS tenant_restore_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    await platformDb.run("INSERT INTO auth_users VALUES ('old-admin','admin','old-hash')");
    await platformDb.run("INSERT OR REPLACE INTO tenants (id,name,description,status) VALUES ('default','Old Default','','active')");
    await appDb.run("INSERT INTO tenant_restore_probe VALUES (1,'backup-business')");

    const backup = await backupRepo.createBackup({ reason: 'control-plane-test' });
    await platformDb.run("ALTER TABLE auth_users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
    await platformDb.run('DELETE FROM auth_users');
    await platformDb.run("INSERT INTO auth_users (username,role,password_hash,display_name) VALUES ('live-admin','admin','live-hash','Live Admin')");
    await platformDb.run("UPDATE tenants SET name='Live Default' WHERE id='default'");
    await appDb.run("UPDATE tenant_restore_probe SET value='live-business' WHERE id=1");

    await backupRepo.restoreFromZip(backupRepo.getBackupPath(backup.name), { skipSafetyBackup: true });

    const dbPath = path.join(process.env.TOOLS_DATA_DIR, 'tools.db');
    assert.deepEqual(await sqliteGet(dbPath, 'SELECT username,password_hash,display_name FROM auth_users'), { username: 'live-admin', password_hash: 'live-hash', display_name: 'Live Admin' });
    assert.deepEqual(await sqliteGet(dbPath, "SELECT name FROM tenants WHERE id='default'"), { name: 'Live Default' });
    assert.deepEqual(await sqliteGet(dbPath, 'SELECT value FROM tenant_restore_probe WHERE id=1'), { value: 'backup-business' });
});

test('streaming backup handles UTF-8 filenames, empty files, excludes cache/agent-browser, and prunes stale snapshots', async () => {
    await runWithTenant('stream-test', async () => {
        const dataDir = getDataDir();
        fs.mkdirSync(path.join(dataDir, 'custom-tools/中文工具'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'cache/home-videos'), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'agent-browser/profile-1'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'custom-tools/中文工具/说明.txt'), '你好 streaming zip!');
        fs.writeFileSync(path.join(dataDir, 'custom-tools/中文工具/empty.txt'), '');
        fs.writeFileSync(path.join(dataDir, 'cache/home-videos/chunk.bin'), 'large-video-cache');
        fs.writeFileSync(path.join(dataDir, 'agent-browser/profile-1/Cookies'), 'browser-cache');

        const backup = await backupRepo.createBackup({ reason: 'streaming-verify', skipCapacityPrune: true });
        const zipPath = backupRepo.getBackupPath(backup.name);
        const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
        assert.equal(await zip.file('primary_data/custom-tools/中文工具/说明.txt').async('string'), '你好 streaming zip!');
        assert.equal(await zip.file('primary_data/custom-tools/中文工具/empty.txt').async('string'), '');
        assert.equal(zip.file('primary_data/cache/home-videos/chunk.bin'), null);
        assert.equal(zip.file('primary_data/agent-browser/profile-1/Cookies'), null);

        if (process.platform !== 'win32') {
            require('child_process').execFileSync('unzip', ['-t', zipPath], { stdio: 'ignore' });
        }

        const staleDir = path.join(dataDir, 'tmp/restores/backup-snapshot-stale');
        fs.mkdirSync(staleDir, { recursive: true });
        const oldTime = new Date(Date.now() - 8 * 3600 * 1000);
        fs.utimesSync(staleDir, oldTime, oldTime);
        assert.equal(backupRepo.pruneStaleBackupSnapshots(), 1);
        assert.equal(fs.existsSync(staleDir), false);
    });
});
