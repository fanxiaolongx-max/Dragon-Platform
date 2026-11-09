// 平台控制库（data/platform/control.db）：账号、会话、团队（租户）登记、平台公共模型、审计日志。
// 与任何团队的业务库分开存放——默认团队（超级管理员空间）的业务库 data/tools.db 以前同时保存这些表，
// 首次打开时复制过来（复制前用 VACUUM INTO 备份 tools.db）。旧表保留不删：回滚到旧版本时旧代码仍能登录，
// 否则旧代码会以为没有账号而重建 admin/admin123。团队空间的库里从来没有这些表。
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { initializeSqliteConnection } = require('./sqlite-connection-initializer');

const CONTROL_TABLES = ['auth_users', 'auth_sessions', 'tenants', 'user_tenants'];

let state = null;

function baseDataDir() {
    return require('./tenant-context').BASE_DATA_DIR;
}

function controlDbPath() {
    return path.join(baseDataDir(), 'platform', 'control.db');
}

function rawRun(db, sql, params = []) {
    return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) {
        error ? reject(error) : resolve({ lastID: this.lastID, changes: this.changes });
    }));
}
function rawGet(db, sql, params = []) {
    return new Promise((resolve, reject) => db.get(sql, params, (error, row) => error ? reject(error) : resolve(row)));
}
function rawAll(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
}

/** 把旧版 data/tools.db 里的控制表搬进控制库；控制库已有同名表数据时不覆盖。 */
async function migrateLegacyTables(db) {
    const legacyFile = path.join(baseDataDir(), 'tools.db');
    if (!fs.existsSync(legacyFile)) return;
    await rawRun(db, 'ATTACH DATABASE ? AS legacy', [legacyFile]);
    try {
        const legacyTables = await rawAll(db, `SELECT name, sql FROM legacy.sqlite_master WHERE type='table' AND name IN (${CONTROL_TABLES.map(() => '?').join(',')})`, CONTROL_TABLES);
        if (!legacyTables.length) return;
        // 已迁移过（控制库里已有账号）：旧表只是回滚用的旧副本，不再复制
        const migrated = await rawGet(db, `SELECT name FROM main.sqlite_master WHERE type='table' AND name='auth_users'`);
        if (migrated && (await rawGet(db, 'SELECT COUNT(*) AS count FROM main.auth_users')).count > 0) return;
        const backupDir = path.join(baseDataDir(), 'backups', 'control-plane-migration');
        fs.mkdirSync(backupDir, { recursive: true });
        const backupFile = path.join(backupDir, `tools-before-control-db-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
        await rawRun(db, 'VACUUM legacy INTO ?', [backupFile]);
        await rawRun(db, 'BEGIN IMMEDIATE');
        try {
            for (const table of legacyTables) {
                const exists = await rawGet(db, `SELECT name FROM main.sqlite_master WHERE type='table' AND name=?`, [table.name]);
                if (!exists) await rawRun(db, table.sql.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS main.'));
                const count = await rawGet(db, `SELECT COUNT(*) AS count FROM main."${table.name}"`);
                if (!count.count) {
                    const legacyCols = (await rawAll(db, `PRAGMA legacy.table_info("${table.name}")`)).map(col => col.name);
                    const mainCols = new Set((await rawAll(db, `PRAGMA main.table_info("${table.name}")`)).map(col => col.name));
                    const cols = legacyCols.filter(col => mainCols.has(col)).map(col => `"${col}"`).join(',');
                    await rawRun(db, `INSERT INTO main."${table.name}" (${cols}) SELECT ${cols} FROM legacy."${table.name}"`);
                }
            }
            await rawRun(db, 'COMMIT');
            console.log(`[control-db] 已把账号/会话/团队表从 tools.db 复制到控制库（旧表保留以便回滚），原库备份：${backupFile}`);
        } catch (error) {
            await rawRun(db, 'ROLLBACK').catch(() => {});
            throw error;
        }
    } finally {
        await rawRun(db, 'DETACH DATABASE legacy').catch(() => {});
    }
}

function open() {
    if (state) return state;
    const file = controlDbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new sqlite3.Database(file);
    db.configure('busyTimeout', 5000);
    const ready = initializeSqliteConnection(db).then(() => migrateLegacyTables(db));
    const opened = { db, ready, file };
    // 打开或迁移失败（磁盘忙、被占用等）时不缓存这次失败：记日志、关闭连接，下次访问重新打开
    ready.catch(error => {
        console.error(`[control-db] 打开平台控制库失败：${error.message || error}`);
        if (state === opened) state = null;
        db.close(() => {});
    });
    state = opened;
    return state;
}

async function run(sql, params = []) {
    const { db, ready } = open();
    await ready;
    return rawRun(db, sql, params);
}
async function get(sql, params = []) {
    const { db, ready } = open();
    await ready;
    return rawGet(db, sql, params);
}
async function all(sql, params = []) {
    const { db, ready } = open();
    await ready;
    return rawAll(db, sql, params);
}

async function closeDatabase() {
    if (!state) return;
    const { db, ready } = state;
    state = null;
    await Promise.allSettled([ready]);
    await new Promise((resolve, reject) => db.close(error => error && error.code !== 'SQLITE_MISUSE' ? reject(error) : resolve()));
}

module.exports = {
    CONTROL_TABLES,
    all,
    closeDatabase,
    get,
    run,
    get DB_PATH() { return controlDbPath(); }
};
