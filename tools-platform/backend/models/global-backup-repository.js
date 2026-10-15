const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const sqlite3 = require('sqlite3').verbose();

const { getDataDir } = require('./store');
const { getReportDataDir } = require('./report-store');
const { DEFAULT_TENANT_ID, getTenantId, runWithTenant } = require('./tenant-context');
const { readKV, writeKV } = require('./kv-store');

function getBackupDir() {
    return getTenantId() === DEFAULT_TENANT_ID ? path.join(getDataDir(), '../backups') : path.join(getDataDir(), 'backups');
}
function getRestoreTmpDir() {
    return getTenantId() === DEFAULT_TENANT_ID ? path.join(getDataDir(), '../tmp/restores') : path.join(getDataDir(), 'tmp/restores');
}
const BACKUP_VERSION = 3; // v3 adds tenant identity and a lean tenant-scoped payload
const SCHEDULE_KV_CATEGORY = 'global_backup';
const SCHEDULE_KV_KEY = 'auto_schedule';
const AUTO_BACKUP_REASON = 'scheduled-auto';
const DEFAULT_SCHEDULE_SETTINGS = {
    enabled: true,
    time: '02:00',
    retentionDays: 90,
    maxTotalSizeGB: 10,
    lastRunAt: null,
    lastSuccessAt: null,
    lastBackupName: '',
    lastError: ''
};

const schedulerTimers = new Map();
const schedulerRunning = new Set();

const REPORT_OWNED_FILES = ['report.db', 'report.db-wal', 'report.db-shm'];
const WAREHOUSE_DATABASE_FILE = 'ezscan-warehouse.db';
const PRIMARY_SQLITE_SIDECARS = ['tools.db-wal', 'tools.db-shm', `${WAREHOUSE_DATABASE_FILE}-wal`, `${WAREHOUSE_DATABASE_FILE}-shm`];
// Chat history is intentionally managed outside the platform-wide backup lifecycle.
// Preserve the live tenant copy during restore and never include it in backup archives.
const CHAT_HISTORY_FILES = ['chat-history.db', 'chat-history.db-wal', 'chat-history.db-shm'];
const CONTROL_PLANE_TABLES = ['auth_users', 'tenants', 'user_tenants', 'auth_sessions'];
// `tenants` is a sibling workspace collection when operating on the legacy
// default tenant. A backup/restore for one tenant must never absorb or replace it.
const PRIMARY_PRESERVED_DIRS = ['images', 'slide-library', 'tenants'];
// Operational history, caches and temporary imports are not business source
// data. Excluding these also prevents a backup from recursively carrying older
// backup copies and large abandoned upload files.
const PRIMARY_OPERATIONAL_DIRS = ['backups', 'tmp', 'quarantine', 'runtime'];
const DEFAULT_MACHINE_FILES = [
    'desktop-license-registry.json',
    'desktop-license-signing-key.json',
    'f12-extension-identities.json',
    'f12-extension-versions.json',
    'f12-license-registry.json',
    'f12-license-signing-key.json'
];
function getPrimaryPreservedNames() {
    return [
        ...PRIMARY_PRESERVED_DIRS,
        ...PRIMARY_OPERATIONAL_DIRS,
        ...CHAT_HISTORY_FILES,
        ...(getTenantId() === DEFAULT_TENANT_ID ? DEFAULT_MACHINE_FILES : [])
    ];
}
function hasSplitReportData() { return path.resolve(getReportDataDir()) !== path.resolve(getDataDir()); }
function getDataTargets() {
    const targets = [{
        id: 'primary_data',
        absPath: getDataDir(),
        relPath: process.env.TOOLS_DATA_DIR ? 'data' : 'backend/data',
        excludeTopLevel: [
            ...getPrimaryPreservedNames(),
            ...PRIMARY_SQLITE_SIDECARS,
            ...(hasSplitReportData() ? REPORT_OWNED_FILES : [])
        ]
    }];
    if (hasSplitReportData()) targets.push({ id: 'report_data', absPath: getReportDataDir(), relPath: 'data（不含 images）', includeTopLevel: REPORT_OWNED_FILES });
    return targets;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function safeName(name) {
    return String(name || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function timestampForFile() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function reportProgress(options, stage, message, detail = null, level = 'info') {
    if (!options || typeof options.onProgress !== 'function') return;
    try {
        options.onProgress({ stage, message, detail, level, timestamp: new Date().toISOString() });
    } catch (err) {
        console.warn('[GLOBAL BACKUP] Progress reporter failed:', err.message);
    }
}

async function snapshotTenantControlPlane() {
    const tenantDb = getTenantId() === DEFAULT_TENANT_ID ? require('./platform-db') : require('./app-db');
    const placeholders = CONTROL_PLANE_TABLES.map(() => '?').join(',');
    const schema = await tenantDb.all(`SELECT type,name,tbl_name,sql FROM sqlite_master
        WHERE sql IS NOT NULL AND (name IN (${placeholders}) OR tbl_name IN (${placeholders}))
        ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END`, [...CONTROL_PLANE_TABLES, ...CONTROL_PLANE_TABLES]);
    const existing = new Set(schema.filter(item => item.type === 'table').map(item => item.name));
    const rows = {};
    for (const table of CONTROL_PLANE_TABLES) {
        if (existing.has(table)) rows[table] = await tenantDb.all(`SELECT * FROM "${table}"`);
    }
    return { schema, rows };
}

function sqliteRun(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
}

function sqliteClose(db) {
    return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function restoreTenantControlPlane(snapshot) {
    if (!snapshot) return false;
    const dbPath = path.join(getDataDir(), 'tools.db');
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);
    try {
        await sqliteRun(db, 'PRAGMA foreign_keys = OFF');
        await sqliteRun(db, 'BEGIN IMMEDIATE');
        try {
            for (const table of [...CONTROL_PLANE_TABLES].reverse()) {
                await sqliteRun(db, `DROP TABLE IF EXISTS "${table}"`);
            }
            for (const item of snapshot.schema.filter(entry => entry.type === 'table')) {
                await sqliteRun(db, item.sql);
            }
            for (const table of CONTROL_PLANE_TABLES) {
                const rows = snapshot.rows[table] || [];
                for (const row of rows) {
                    const columns = Object.keys(row);
                    if (!columns.length) continue;
                    const names = columns.map(name => `"${name}"`).join(',');
                    const placeholders = columns.map(() => '?').join(',');
                    await sqliteRun(db, `INSERT INTO "${table}" (${names}) VALUES (${placeholders})`, columns.map(name => row[name]));
                }
            }
            for (const item of snapshot.schema.filter(entry => entry.type !== 'table')) {
                await sqliteRun(db, item.sql);
            }
            await sqliteRun(db, 'COMMIT');
        } catch (error) {
            await sqliteRun(db, 'ROLLBACK').catch(() => {});
            throw error;
        }
        return true;
    } finally {
        await sqliteClose(db);
    }
}

function countFilesAndBytes(dir, options = {}) {
    const result = { files: 0, bytes: 0 };
    if (!fs.existsSync(dir)) return result;
    const excludedNames = new Set(options.excludeNames || []);
    const includedNames = options.includeNames ? new Set(options.includeNames) : null;
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        entries.forEach(entry => {
            const fullPath = path.join(current, entry.name);
            const relative = path.relative(dir, fullPath);
            const topLevelName = relative.split(path.sep)[0];
            if (excludedNames.has(topLevelName)) return;
            if (includedNames && !includedNames.has(topLevelName)) return;
            if (entry.isDirectory()) {
                stack.push(fullPath);
            } else if (entry.isFile()) {
                const stat = fs.statSync(fullPath);
                result.files += 1;
                result.bytes += stat.size;
            }
        });
    }
    return result;
}

function getManifest(reason = 'manual', tenant = null, databaseSnapshots = []) {
    const targets = getDataTargets().map(target => {
        const absPath = target.absPath;
        const snapshots = databaseSnapshots.filter(snapshot => snapshot.targetId === target.id);
        const stats = countFilesAndBytes(absPath, {
            excludeNames: [
                ...(target.excludeTopLevel || []),
                ...(target.id === 'primary_data' ? [WAREHOUSE_DATABASE_FILE] : [])
            ],
            includeNames: target.includeTopLevel || null
        });
        snapshots.forEach(snapshot => {
            stats.files += 1;
            stats.bytes += fs.statSync(snapshot.filePath).size;
        });
        return {
            id: target.id,
            path: target.id,
            relPath: target.relPath || target.id,
            excluded: target.excludeTopLevel || [],
            included: target.includeTopLevel || null,
            exists: fs.existsSync(absPath),
            ...stats
        };
    });
    return {
        type: 'tools-platform-global-backup',
        version: BACKUP_VERSION,
        scope: 'single-tenant',
        tenantId: getTenantId(),
        tenantName: tenant?.name || getTenantId(),
        includesAllTenants: false,
        createdAt: new Date().toISOString(),
        reason,
        targets,
        totalFiles: targets.reduce((sum, item) => sum + item.files, 0),
        totalBytes: targets.reduce((sum, item) => sum + item.bytes, 0)
    };
}

function getReasonFromBackupName(name) {
    const match = String(name || '').match(/^tools-platform-backup_[^_]+_(.+)\.zip$/);
    return match ? match[1] : '';
}

function getBackupTriggerType(reason) {
    if (String(reason || '').startsWith('remote-sync-request')) return 'remote-sync-request';
    if (String(reason || '').startsWith('pre-restore')) return 'pre-restore';
    if (String(reason || '').startsWith(AUTO_BACKUP_REASON)) return 'scheduled-auto';
    return 'manual';
}

function normalizeScheduleSettings(raw = {}) {
    const timeRaw = String(raw.time || DEFAULT_SCHEDULE_SETTINGS.time).trim();
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeRaw) ? timeRaw : DEFAULT_SCHEDULE_SETTINGS.time;
    const retentionDays = Math.max(1, Math.min(3650, parseInt(raw.retentionDays, 10) || DEFAULT_SCHEDULE_SETTINGS.retentionDays));
    const parsedMaxTotalSizeGB = Number(raw.maxTotalSizeGB);
    const maxTotalSizeGB = Number.isFinite(parsedMaxTotalSizeGB)
        ? Math.max(0.1, Math.min(10240, parsedMaxTotalSizeGB))
        : DEFAULT_SCHEDULE_SETTINGS.maxTotalSizeGB;
    return {
        ...DEFAULT_SCHEDULE_SETTINGS,
        ...raw,
        enabled: raw.enabled !== false,
        time,
        retentionDays,
        maxTotalSizeGB,
        lastRunAt: raw.lastRunAt || null,
        lastSuccessAt: raw.lastSuccessAt || null,
        lastBackupName: raw.lastBackupName || '',
        lastError: raw.lastError || ''
    };
}

function listBackups() {
    ensureDir(getBackupDir());
    return fs.readdirSync(getBackupDir())
        .filter(name => name.endsWith('.zip'))
        .map(name => {
            const filePath = path.join(getBackupDir(), name);
            const stat = fs.statSync(filePath);
            const reason = getReasonFromBackupName(name);
            return {
                name,
                reason,
                triggerType: getBackupTriggerType(reason),
                size: stat.size,
                createdAt: stat.birthtime.toISOString(),
                modifiedAt: stat.mtime.toISOString()
            };
        })
        .filter(item => item.size > 0)
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function getBackupPath(name) {
    const cleaned = safeName(name);
    const fullPath = path.join(getBackupDir(), cleaned);
    if (!fullPath.startsWith(getBackupDir() + path.sep)) {
        throw new Error('非法备份文件名');
    }
    if (!fs.existsSync(fullPath)) {
        const err = new Error('备份文件不存在');
        err.statusCode = 404;
        throw err;
    }
    return fullPath;
}

function toZipPath(relPath) {
    return relPath.split(path.sep).join('/');
}

function assertSafeZipEntryName(entryName) {
    const normalized = String(entryName || '').replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
        throw new Error(`备份包包含非法路径：${entryName}`);
    }
    if (normalized.split('/').some(part => part === '..')) {
        throw new Error(`备份包包含目录穿越路径：${entryName}`);
    }
    return normalized;
}

function getSafeExtractPath(extractDir, entryName) {
    const safeName = assertSafeZipEntryName(entryName);
    const targetPath = path.resolve(extractDir, ...safeName.split('/'));
    const root = path.resolve(extractDir);
    if (targetPath !== root && !targetPath.startsWith(root + path.sep)) {
        throw new Error(`备份包包含非法解压路径：${entryName}`);
    }
    return targetPath;
}

function normalizeRestoreError(err, targetPath) {
    if (err && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        const friendly = new Error(`恢复失败：Windows 正在占用数据文件，无法写入 ${targetPath}。请先停止 tools-platform 服务后重试，或恢复成功后立即重启服务。原始错误：${err.message}`);
        friendly.code = err.code;
        return friendly;
    }
    return err;
}

function isTargetPathExcluded(target, absPath) {
    const excluded = new Set(target.excludeTopLevel || []);
    const included = target.includeTopLevel ? new Set(target.includeTopLevel) : null;
    if (!excluded.size && !included) return false;
    const relative = path.relative(target.absPath, absPath);
    if (!relative || relative.startsWith('..')) return false;
    const topLevelName = relative.split(path.sep)[0];
    if (excluded.has(topLevelName)) return true;
    return !!(included && !included.has(topLevelName));
}

function addPathToZip(zip, absPath, relPath, target) {
    if (!fs.existsSync(absPath)) return;
    if (isTargetPathExcluded(target, absPath)) return;
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
        const entries = fs.readdirSync(absPath, { withFileTypes: true });
        entries.forEach(entry => {
            addPathToZip(zip, path.join(absPath, entry.name), path.join(relPath, entry.name), target);
        });
        return;
    }
    if (stat.isFile()) {
        zip.file(toZipPath(relPath), fs.readFileSync(absPath));
    }
}

async function writeZip(outputPath, manifest, databaseSnapshots = []) {
    const zip = new JSZip();
    getDataTargets().forEach(target => {
        const absPath = target.absPath;
        if (fs.existsSync(absPath)) {
            // Warehouse data is copied only from its coherent SQLite snapshot.
            // Reading the live main file alone could omit committed WAL pages.
            const zipTarget = target.id === 'primary_data'
                ? { ...target, excludeTopLevel: [...target.excludeTopLevel, WAREHOUSE_DATABASE_FILE] }
                : target;
            addPathToZip(zip, absPath, target.id, zipTarget);
        }
    });
    databaseSnapshots.forEach(snapshot => {
        zip.file(`${snapshot.targetId}/${snapshot.filename}`, fs.readFileSync(snapshot.filePath));
    });
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    const content = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
    });
    fs.writeFileSync(outputPath, content);
}

async function extractZip(zipPath, extractDir) {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const entries = Object.values(zip.files);
    for (const entry of entries) {
        const targetPath = getSafeExtractPath(extractDir, entry.name);
        if (entry.dir) {
            ensureDir(targetPath);
        } else {
            ensureDir(path.dirname(targetPath));
            fs.writeFileSync(targetPath, await entry.async('nodebuffer'));
        }
    }
}

function closeSqliteDatabase(label, closeFn) {
    if (typeof closeFn !== 'function') return Promise.resolve({ label, skipped: true });
    return closeFn()
        .then(() => ({ label, closed: true }))
        .catch(err => {
            if (err && err.code === 'SQLITE_MISUSE') return { label, alreadyClosed: true };
            throw err;
        });
}

async function closeRuntimeDatabases() {
    const appDb = require('./app-db');
    const tenantSqlitePool = require('./tenant-sqlite-pool');
    const reportRoute = require('../routes/db');
    const externalMetricsRepo = require('./external-metrics-repository');
    const requirementsRoute = require('../routes/requirements');
    const results = [];
    results.push(await closeSqliteDatabase('tools.db', appDb.closeDatabase));
    results.push(await closeSqliteDatabase('report.db', reportRoute.closeDatabase));
    results.push(await closeSqliteDatabase('external metrics report.db', externalMetricsRepo.closeDatabase));
    results.push(await closeSqliteDatabase('requirements.db', requirementsRoute.closeDatabase));
    results.push(await closeSqliteDatabase('tenant sqlite pools', tenantSqlitePool.closeAll));
    if (getTenantId() === DEFAULT_TENANT_ID) {
        const platformDb = require('./platform-db');
        results.push(await closeSqliteDatabase('platform tools.db', platformDb.closeDatabase));
    }
    return results;
}

async function createBackup(options = {}) {
    ensureDir(getBackupDir());
    const reason = options.reason || 'manual';
    const filename = `tools-platform-backup_${timestampForFile()}_${safeName(reason)}.zip`;
    const outputPath = path.join(getBackupDir(), filename);
    reportProgress(options, 'checkpoint', '正在固化 SQLite WAL 数据');
    const appDb = require('./app-db');
    const checkpoint = await appDb.all('PRAGMA wal_checkpoint(TRUNCATE)');
    const checkpointState = checkpoint && checkpoint[0];
    if (checkpointState && Number(checkpointState.busy || 0) > 0) {
        throw new Error('SQLite WAL 正在被占用，已取消本次备份以避免生成不完整快照');
    }
    reportProgress(options, 'checkpoint-ready', 'SQLite WAL 已安全写入主数据库', checkpointState || null, 'success');
    let snapshotDir = null;
    try {
        const databaseSnapshots = [];
        // Do not open or create a warehouse database for tenants that have
        // never used the tool. Existing databases get an online SQLite copy.
        if (fs.existsSync(path.join(getDataDir(), WAREHOUSE_DATABASE_FILE))) {
            ensureDir(getRestoreTmpDir());
            snapshotDir = fs.mkdtempSync(path.join(getRestoreTmpDir(), 'backup-snapshot-'));
            const filePath = path.join(snapshotDir, WAREHOUSE_DATABASE_FILE);
            const created = await require('./ezscan-warehouse-repository').createDatabaseBackup(filePath);
            if (created) databaseSnapshots.push({ targetId: 'primary_data', filename: WAREHOUSE_DATABASE_FILE, filePath });
        }
        reportProgress(options, 'scan', '正在扫描备份数据目录');
        const tenant = await require('./tenants-repository').getTenantById(getTenantId()).catch(() => null);
        const manifest = getManifest(reason, tenant, databaseSnapshots);
        reportProgress(options, 'manifest', `已生成清单：${manifest.totalFiles} 个文件，${manifest.totalBytes} 字节`, {
            targets: manifest.targets.map(item => ({ id: item.id, files: item.files, bytes: item.bytes }))
        });
        reportProgress(options, 'compress', '正在压缩备份数据');
        await writeZip(outputPath, manifest, databaseSnapshots);
        const stat = fs.statSync(outputPath);
        let capacityCleanup = null;
        if (options.skipCapacityPrune !== true) {
            const settings = await getScheduleSettings();
            capacityCleanup = pruneBackupsByCapacity(settings.maxTotalSizeGB, { protectNames: [filename] });
            if (capacityCleanup.removedCount) {
                reportProgress(options, 'capacity-cleanup', `容量上限清理了 ${capacityCleanup.removedCount} 个旧备份`, {
                    removed: capacityCleanup.removed,
                    totalBytes: capacityCleanup.totalBytes,
                    maxTotalBytes: capacityCleanup.maxTotalBytes
                }, 'warn');
            }
        }
        reportProgress(options, 'backup-ready', `备份包生成完成：${filename}`, { size: stat.size }, 'success');
        return {
            name: filename,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
            modifiedAt: stat.mtime.toISOString(),
            manifest,
            capacityCleanup
        };
    } catch (err) {
        fs.rmSync(outputPath, { force: true });
        reportProgress(options, 'backup-error', `备份生成失败：${err.message}`, null, 'error');
        throw err;
    } finally {
        if (snapshotDir) removeRestoreDirBestEffort(snapshotDir);
    }
}

function pruneScheduledBackups(retentionDays = DEFAULT_SCHEDULE_SETTINGS.retentionDays) {
    ensureDir(getBackupDir());
    const days = Math.max(1, Math.min(3650, parseInt(retentionDays, 10) || DEFAULT_SCHEDULE_SETTINGS.retentionDays));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const removed = [];
    listBackups().forEach(item => {
        if (item.triggerType !== 'scheduled-auto') return;
        const modifiedAt = new Date(item.modifiedAt || item.createdAt).getTime();
        if (!Number.isFinite(modifiedAt) || modifiedAt >= cutoff) return;
        try {
            const filePath = getBackupPath(item.name);
            fs.rmSync(filePath, { force: true });
            removed.push(item.name);
        } catch (err) {
            console.warn('[GLOBAL BACKUP] Failed to prune scheduled backup:', item.name, err.message);
        }
    });
    return { retentionDays: days, removedCount: removed.length, removed };
}

function pruneBackupsByCapacity(maxTotalSizeGB = DEFAULT_SCHEDULE_SETTINGS.maxTotalSizeGB, options = {}) {
    ensureDir(getBackupDir());
    const parsed = Number(maxTotalSizeGB);
    const normalizedGB = Number.isFinite(parsed)
        ? Math.max(0.1, Math.min(10240, parsed))
        : DEFAULT_SCHEDULE_SETTINGS.maxTotalSizeGB;
    const maxTotalBytes = Math.floor(normalizedGB * 1024 * 1024 * 1024);
    const protectedNames = new Set(options.protectNames || []);
    const backups = listBackups();
    let totalBytes = backups.reduce((sum, item) => sum + item.size, 0);
    const removed = [];

    // listBackups is newest-first. Delete from the oldest end while keeping at
    // least one valid recovery point and never deleting the backup just made.
    for (let index = backups.length - 1; index >= 0 && totalBytes > maxTotalBytes; index -= 1) {
        const item = backups[index];
        if (backups.length - removed.length <= 1 || protectedNames.has(item.name)) continue;
        try {
            fs.rmSync(getBackupPath(item.name), { force: true });
            totalBytes -= item.size;
            removed.push(item.name);
        } catch (err) {
            console.warn('[GLOBAL BACKUP] Failed to prune backup by capacity:', item.name, err.message);
        }
    }
    return {
        maxTotalSizeGB: normalizedGB,
        maxTotalBytes,
        totalBytes: Math.max(0, totalBytes),
        capacityExceeded: totalBytes > maxTotalBytes,
        removedCount: removed.length,
        removed
    };
}

async function getScheduleSettings() {
    return normalizeScheduleSettings(await readKV(SCHEDULE_KV_CATEGORY, SCHEDULE_KV_KEY, DEFAULT_SCHEDULE_SETTINGS));
}

async function saveScheduleSettings(nextSettings = {}) {
    const current = await getScheduleSettings();
    const normalized = normalizeScheduleSettings({ ...current, ...nextSettings });
    await writeKV(SCHEDULE_KV_CATEGORY, SCHEDULE_KV_KEY, normalized);
    const capacityCleanup = pruneBackupsByCapacity(normalized.maxTotalSizeGB);
    scheduleNextAutoBackup(normalized);
    return { ...getScheduleStatus(normalized), capacityCleanup };
}

function getNextRunAt(settings = normalizeScheduleSettings()) {
    const normalized = normalizeScheduleSettings(settings);
    const [hour, minute] = normalized.time.split(':').map(Number);
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next.getTime() <= Date.now()) {
        next.setDate(next.getDate() + 1);
    }
    return next;
}

function getScheduleStatus(settings = normalizeScheduleSettings()) {
    const tenantId = getTenantId();
    const normalized = normalizeScheduleSettings(settings);
    const backups = listBackups();
    const currentTotalBytes = backups.reduce((sum, item) => sum + item.size, 0);
    const maxTotalBytes = Math.floor(normalized.maxTotalSizeGB * 1024 * 1024 * 1024);
    return {
        ...normalized,
        nextRunAt: normalized.enabled ? getNextRunAt(normalized).toISOString() : null,
        running: schedulerRunning.has(tenantId),
        currentTotalBytes,
        maxTotalBytes,
        capacityExceeded: currentTotalBytes > maxTotalBytes
    };
}

function clearAutoBackupTimer() {
    const tenantId = getTenantId();
    const timer = schedulerTimers.get(tenantId);
    if (timer) {
        clearTimeout(timer);
        schedulerTimers.delete(tenantId);
    }
}

function stopAutoBackupScheduler(tenantId = getTenantId()) {
    const timer = schedulerTimers.get(tenantId);
    if (!timer) return false;
    clearTimeout(timer);
    schedulerTimers.delete(tenantId);
    return true;
}

function scheduleNextAutoBackup(settings = normalizeScheduleSettings()) {
    clearAutoBackupTimer();
    const normalized = normalizeScheduleSettings(settings);
    if (!normalized.enabled) {
        console.log('[GLOBAL BACKUP] Scheduled backup disabled.');
        return;
    }
    const nextRunAt = getNextRunAt(normalized);
    const delay = Math.max(1000, nextRunAt.getTime() - Date.now());
    const tenantId = getTenantId();
    const timer = setTimeout(() => {
        runScheduledBackup({ source: 'timer' }).catch(err => {
            console.error('[GLOBAL BACKUP] Scheduled backup failed:', err);
        });
    }, delay);
    schedulerTimers.set(tenantId, timer);
    if (timer.unref) timer.unref();
    console.log(`[GLOBAL BACKUP] Tenant ${tenantId} next scheduled backup: ${nextRunAt.toLocaleString('zh-CN', { hour12: false })}`);
}

async function runScheduledBackup(options = {}) {
    const tenantId = getTenantId();
    if (schedulerRunning.has(tenantId)) {
        const settings = await getScheduleSettings();
        return { skipped: true, reason: 'already-running', schedule: getScheduleStatus(settings) };
    }
    schedulerRunning.add(tenantId);
    const settings = await getScheduleSettings();
    const startedAt = new Date().toISOString();
    let nextSettings = { ...settings, lastRunAt: startedAt, lastError: '' };
    try {
        const backup = await createBackup({ reason: options.reason || AUTO_BACKUP_REASON });
        const retentionCleanup = pruneScheduledBackups(settings.retentionDays);
        const capacityCleanup = pruneBackupsByCapacity(settings.maxTotalSizeGB, { protectNames: [backup.name] });
        nextSettings = {
            ...nextSettings,
            lastSuccessAt: new Date().toISOString(),
            lastBackupName: backup.name,
            lastError: ''
        };
        await writeKV(SCHEDULE_KV_CATEGORY, SCHEDULE_KV_KEY, normalizeScheduleSettings(nextSettings));
        return { success: true, backup, cleanup: { retention: retentionCleanup, capacity: capacityCleanup }, schedule: getScheduleStatus(nextSettings) };
    } catch (err) {
        nextSettings = { ...nextSettings, lastError: err.message || String(err) };
        await writeKV(SCHEDULE_KV_CATEGORY, SCHEDULE_KV_KEY, normalizeScheduleSettings(nextSettings));
        throw err;
    } finally {
        schedulerRunning.delete(tenantId);
        if (options.reschedule !== false) {
            scheduleNextAutoBackup(await getScheduleSettings());
        }
    }
}

async function startAutoBackupScheduler() {
    const tenants = await require('./tenants-repository').listTenantsForUser('', 'admin');
    const statuses = [];
    for (const tenant of tenants) {
        statuses.push(await runWithTenant(tenant.id, async () => {
            const settings = await getScheduleSettings();
            pruneBackupsByCapacity(settings.maxTotalSizeGB);
            scheduleNextAutoBackup(settings);
            return { tenantId: tenant.id, ...getScheduleStatus(settings) };
        }));
    }
    return statuses;
}

async function startTenantAutoBackupScheduler(tenantId) {
    return runWithTenant(tenantId, async () => {
        const settings = await getScheduleSettings();
        pruneBackupsByCapacity(settings.maxTotalSizeGB);
        scheduleNextAutoBackup(settings);
        return { tenantId, ...getScheduleStatus(settings) };
    });
}

function removeRestoreDirBestEffort(extractDir, options = {}) {
    if (!extractDir || !fs.existsSync(extractDir)) return true;
    try {
        fs.rmSync(extractDir, {
            recursive: true,
            force: true,
            maxRetries: 8,
            retryDelay: 150
        });
        return true;
    } catch (err) {
        console.warn(`[GLOBAL BACKUP] Restore data completed, but temporary directory cleanup was delayed: ${extractDir}`, err.message);
        if (options.scheduleRetry !== false) {
            const retryTimer = setTimeout(() => {
                removeRestoreDirBestEffort(extractDir, { scheduleRetry: false });
            }, 2000);
            if (retryTimer.unref) retryTimer.unref();
        }
        return false;
    }
}

async function extractBackup(zipPath) {
    ensureDir(getRestoreTmpDir());
    const extractId = `restore_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const extractDir = path.join(getRestoreTmpDir(), extractId);
    ensureDir(extractDir);

    try {
        await extractZip(zipPath, extractDir);

        const manifestPath = path.join(extractDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('备份包缺少 manifest.json，已拒绝恢复。');
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.type !== 'tools-platform-global-backup' || ![2, BACKUP_VERSION].includes(Number(manifest.version))) {
            throw new Error('备份包类型或版本不匹配，已拒绝恢复。');
        }
        return { extractDir, manifest };
    } catch (err) {
        removeRestoreDirBestEffort(extractDir);
        throw err;
    }
}

function syncDirRecursive(src, dest, options = {}) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    const excludedNames = new Set(options.excludeNames || []);
    const srcEntries = fs.readdirSync(src, { withFileTypes: true })
        .filter(entry => !excludedNames.has(entry.name));
    const srcNames = new Set(srcEntries.map(entry => entry.name));

    srcEntries.forEach(entry => {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        try {
            if (entry.isDirectory()) {
                syncDirRecursive(srcPath, destPath);
            } else if (entry.isFile()) {
                fs.copyFileSync(srcPath, destPath);
            }
        } catch (err) {
            throw normalizeRestoreError(err, destPath);
        }
    });

    if (!fs.existsSync(dest)) return;
    fs.readdirSync(dest, { withFileTypes: true }).forEach(entry => {
        if (excludedNames.has(entry.name)) return;
        if (srcNames.has(entry.name)) return;
        const extraPath = path.join(dest, entry.name);
        try {
            fs.rmSync(extraPath, { recursive: true, force: true });
        } catch (err) {
            throw normalizeRestoreError(err, extraPath);
        }
    });
}

function syncOwnedFiles(src, dest, fileNames) {
    ensureDir(dest);
    fileNames.forEach(name => {
        const srcPath = path.join(src, name);
        const destPath = path.join(dest, name);
        try {
            if (fs.existsSync(srcPath) && fs.statSync(srcPath).isFile()) {
                fs.copyFileSync(srcPath, destPath);
            } else if (fs.existsSync(destPath)) {
                fs.rmSync(destPath, { force: true });
            }
        } catch (err) {
            throw normalizeRestoreError(err, destPath);
        }
    });
}

async function restoreFromZip(zipPath, options = {}) {
    reportProgress(options, 'restore-start', '开始恢复备份', { source: path.basename(zipPath) });
    reportProgress(options, 'extract', '正在校验并解压备份包');
    const { extractDir, manifest } = await extractBackup(zipPath);
    try {
        const currentTenantId = getTenantId();
        // Version 2 packages created before tenant metadata existed belong to
        // the legacy default tenant. Cross-tenant restore always needs an
        // explicit administrator override after the first safe rejection.
        const backupTenantId = String(manifest.tenantId || DEFAULT_TENANT_ID).trim().toLowerCase();
        const tenantMismatch = backupTenantId !== currentTenantId;
        const currentTenant = await require('./tenants-repository').getTenantById(currentTenantId).catch(() => null);
        const backupTenant = await require('./tenants-repository').getTenantById(backupTenantId).catch(() => null);
        const backupTenantName = String(manifest.tenantName || backupTenant?.name || backupTenantId).trim();
        const currentTenantName = String(currentTenant?.name || currentTenantId).trim();
        if (tenantMismatch && options.forceCrossTenant !== true) {
            const error = new Error(`备份包属于租户“${backupTenantId}”，当前租户为“${currentTenantId}”。为避免跨租户覆盖，已拒绝恢复。`);
            error.statusCode = 409;
            error.code = 'BACKUP_TENANT_MISMATCH';
            error.backupTenantId = backupTenantId;
            error.backupTenantName = backupTenantName;
            error.currentTenantId = currentTenantId;
            error.currentTenantName = currentTenantName;
            throw error;
        }
        reportProgress(options, 'manifest-verified', `备份清单校验通过（版本 ${manifest.version}，来源租户 ${backupTenantId}${tenantMismatch ? `，强制恢复到 ${currentTenantId}` : ''}）`, {
            tenantId: backupTenantId,
            currentTenantId,
            forcedCrossTenant: tenantMismatch,
            targets: (manifest.targets || []).map(item => item.id)
        }, tenantMismatch ? 'warn' : 'success');
        reportProgress(options, 'safety-backup', '正在生成恢复前安全备份');
        const safetyBackup = options.skipSafetyBackup ? null : await createBackup({
            reason: 'pre-restore',
            skipCapacityPrune: true,
            onProgress: options.onProgress
        });
        const controlPlaneSnapshot = await snapshotTenantControlPlane();
        reportProgress(options, 'database-close', '正在安全关闭 SQLite 数据库连接');
        const closedDatabases = await closeRuntimeDatabases();
        reportProgress(options, 'database-closed', 'SQLite 数据库连接已关闭', { closedDatabases }, 'success');
        const restoredTargets = [];
        const missingTargets = [];
        const primarySrc = path.join(extractDir, 'primary_data');
        const reportSrc = path.join(extractDir, 'report_data');
        const hasPrimary = fs.existsSync(primarySrc);
        const hasReport = fs.existsSync(reportSrc);
        const manifestPrimary = (manifest.targets || []).find(target => target.id === 'primary_data') || {};
        const packageUsesUnifiedData = manifestPrimary.relPath === 'data';

        if (hasPrimary) {
            reportProgress(options, 'primary-restore', '正在恢复主业务数据 primary_data');
            // These directories are intentionally outside global backups.
            // Preserve the server's current copies instead of deleting them
            // while synchronizing a restored primary_data snapshot.
            const primaryExcludes = new Set(getPrimaryPreservedNames());
            if (hasSplitReportData() || hasReport || !packageUsesUnifiedData) {
                REPORT_OWNED_FILES.forEach(name => primaryExcludes.add(name));
            }
            syncDirRecursive(primarySrc, getDataDir(), { excludeNames: Array.from(primaryExcludes) });
            if (controlPlaneSnapshot) {
                await restoreTenantControlPlane(controlPlaneSnapshot);
                reportProgress(options, 'control-plane-preserved', '账号、Session 与租户登记表结构及数据已保留当前版本', null, 'success');
            }
            restoredTargets.push('primary_data');
            reportProgress(options, 'primary-restored', '主业务数据恢复完成', null, 'success');
        } else {
            missingTargets.push('primary_data');
            reportProgress(options, 'primary-missing', '备份包缺少 primary_data，已保留现有主数据', null, 'warn');
        }

        if (hasReport) {
            reportProgress(options, 'report-restore', '正在恢复报表数据库 report_data/report.db');
            syncOwnedFiles(reportSrc, getReportDataDir(), REPORT_OWNED_FILES);
            restoredTargets.push('report_data');
            reportProgress(options, 'report-restored', '报表数据库恢复完成', null, 'success');
        } else if (hasSplitReportData() && packageUsesUnifiedData && hasPrimary) {
            // Windows backups store report.db inside primary_data. Split it back
            // into the dedicated report directory when restoring on Mac/PM2.
            syncOwnedFiles(primarySrc, getReportDataDir(), REPORT_OWNED_FILES);
            restoredTargets.push('report_data:from-primary_data');
            reportProgress(options, 'report-remapped', '已将 Windows 统一目录中的报表库映射到独立报表目录', null, 'success');
        } else if (hasSplitReportData() || !packageUsesUnifiedData) {
            // Old Mac backups did not contain report_data. Preserve the current
            // report database and make the partial restore explicit.
            missingTargets.push('report_data');
            reportProgress(options, 'report-missing', '备份包缺少可用报表库，已保留现有报表数据', null, 'warn');
        }
        reportProgress(options, 'restore-complete', '全部数据恢复步骤已完成，等待服务重启', {
            restoredTargets,
            missingTargets
        }, missingTargets.length ? 'warn' : 'success');
        return {
            success: true,
            restoredAt: new Date().toISOString(),
            manifest,
            safetyBackup,
            closedDatabases,
            restoredTargets,
            missingTargets,
            partialRestore: missingTargets.length > 0,
            forcedCrossTenant: tenantMismatch,
            sourceTenant: { id: backupTenantId, name: backupTenantName },
            targetTenant: { id: currentTenantId, name: currentTenantName },
            needsRestart: true
        };
    } finally {
        // Cleanup is secondary to a successful restore. Windows Defender or
        // indexing can briefly hold extracted files and cause ENOTEMPTY/EPERM.
        // Retry without turning a completed restore into a failed operation.
        const cleaned = removeRestoreDirBestEffort(extractDir);
        reportProgress(options, 'cleanup', cleaned ? '临时解压目录清理完成' : '临时目录正在后台延迟清理', null, cleaned ? 'success' : 'warn');
    }
}

function deleteBackup(name) {
    const filePath = getBackupPath(name);
    fs.rmSync(filePath, { force: true });
    return { success: true, name };
}

module.exports = {
    get BACKUP_DIR() { return getBackupDir(); },
    get DATA_TARGETS() { return getDataTargets(); },
    getBackupDir,
    getDataTargets,
    createBackup,
    listBackups,
    getBackupPath,
    restoreFromZip,
    deleteBackup,
    getScheduleSettings,
    saveScheduleSettings,
    getScheduleStatus,
    runScheduledBackup,
    startAutoBackupScheduler,
    startTenantAutoBackupScheduler,
    stopAutoBackupScheduler,
    pruneScheduledBackups,
    pruneBackupsByCapacity
};
