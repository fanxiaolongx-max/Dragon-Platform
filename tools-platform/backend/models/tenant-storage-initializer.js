const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { initializeBuiltinTools } = require('./builtin-tools-sync');
const {
    BASE_DATA_DIR,
    BASE_REPORT_DATA_DIR,
    DEFAULT_TENANT_ID,
    ensureTenantDirs,
    getDataDir,
    getReportDataDir
} = require('./tenant-context');

const GLOBAL_TABLES = new Set(['auth_users', 'auth_sessions', 'tenants', 'user_tenants']);

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
}
function exec(db, sql) {
    return new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
}
function close(db) {
    return new Promise(resolve => db.close(() => resolve()));
}

async function cloneSchema(sourcePath, destinationPath, excludedTables = new Set()) {
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (!fs.existsSync(sourcePath)) {
        const empty = new sqlite3.Database(destinationPath);
        await close(empty);
        return;
    }
    const source = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY);
    const destination = new sqlite3.Database(destinationPath);
    try {
        const rows = await all(source, `SELECT type, name, tbl_name, sql FROM sqlite_master
            WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
            ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`);
        for (const row of rows) {
            if (excludedTables.has(row.name) || excludedTables.has(row.tbl_name)) continue;
            await exec(destination, row.sql);
        }
    } finally {
        await close(source);
        await close(destination);
    }
}

function emitProgress(onProgress, entry) {
    if (typeof onProgress !== 'function') return;
    try { onProgress(entry); } catch (error) {
        console.warn(`[tenants] 进度回调失败：${error.message}`);
    }
}

async function initializeTenantStorage(tenantId, onProgress) {
    if (tenantId === DEFAULT_TENANT_ID) return ensureTenantDirs(tenantId);
    const dataDir = getDataDir(tenantId);
    const reportDir = getReportDataDir(tenantId);
    if (fs.existsSync(dataDir)) throw new Error(`租户存储目录已存在：${tenantId}`);
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    const stagingDir = path.join(path.dirname(dataDir), `.creating-${tenantId}-${process.pid}-${Date.now()}`);
    try {
        fs.mkdirSync(stagingDir, { recursive: false });
        emitProgress(onProgress, { stage: 'storage-staging', percent: 12, message: '已创建隔离的临时工作区', messageEn: 'Created an isolated staging workspace' });
        emitProgress(onProgress, { stage: 'schema-tools', percent: 20, message: '正在初始化主业务数据库结构', messageEn: 'Initializing the main business database schema' });
        await cloneSchema(path.join(BASE_DATA_DIR, 'tools.db'), path.join(stagingDir, 'tools.db'), GLOBAL_TABLES);
        emitProgress(onProgress, { stage: 'schema-requirements', percent: 38, message: '正在初始化需求与协作数据库结构', messageEn: 'Initializing the requirements database schema' });
        await cloneSchema(path.join(BASE_DATA_DIR, 'requirements.db'), path.join(stagingDir, 'requirements.db'));
        emitProgress(onProgress, { stage: 'schema-ai', percent: 54, message: '正在初始化 AI 知识库结构', messageEn: 'Initializing the AI knowledge database schema' });
        await cloneSchema(path.join(BASE_DATA_DIR, 'ai-knowledge.db'), path.join(stagingDir, 'ai-knowledge.db'));
        emitProgress(onProgress, { stage: 'schema-report', percent: 68, message: '正在初始化报表与月报数据库结构', messageEn: 'Initializing the reporting database schema' });
        await cloneSchema(path.join(BASE_REPORT_DATA_DIR, 'report.db'), path.join(stagingDir, 'report.db'));
        emitProgress(onProgress, { stage: 'directories', percent: 78, message: '正在创建附件、图片与自定义工具目录', messageEn: 'Creating attachment, image, and custom-tool directories' });
        fs.mkdirSync(path.join(stagingDir, 'images'), { recursive: true });
        fs.mkdirSync(path.join(stagingDir, 'custom-tools'), { recursive: true });
        emitProgress(onProgress, { stage: 'builtin-tools', percent: 84, message: '正在安装租户系统内置工具', messageEn: 'Installing built-in tools for the tenant' });
        initializeBuiltinTools({
            sourceDir: process.env.TOOLS_BUILTIN_TOOLS_DIR ? path.resolve(process.env.TOOLS_BUILTIN_TOOLS_DIR) : path.join(__dirname, '../builtin-tools'),
            targetDir: path.join(stagingDir, 'custom-tools'),
            stateFile: path.join(stagingDir, 'builtin-tools-sync-decisions.json'),
            backupRoot: path.join(stagingDir, 'backups', 'builtin-tools')
        });
        emitProgress(onProgress, { stage: 'storage-commit', percent: 90, message: '正在原子提交租户数据目录', messageEn: 'Atomically committing the tenant data directory' });
        fs.renameSync(stagingDir, dataDir);
        emitProgress(onProgress, { stage: 'storage-ready', percent: 92, level: 'success', message: '租户独立存储已就绪', messageEn: 'Tenant-isolated storage is ready' });
        return { dataDir, reportDir };
    } catch (error) {
        emitProgress(onProgress, { stage: 'storage-rollback', percent: 100, level: 'error', message: `初始化失败，正在清理临时目录：${error.message}`, messageEn: `Initialization failed; cleaning the staging directory: ${error.message}` });
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

module.exports = { GLOBAL_TABLES, cloneSchema, initializeTenantStorage };
