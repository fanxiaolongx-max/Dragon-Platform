// 托管应用的数据接口，请求/响应形态与数字人基座 REST（/api/dh/query、/api/dh/execute）兼容：
// - 应用库（datasourceId=app + schema=应用 UUID）：每个应用独立的 SQLite，可增删改，也可建表；禁止 ATTACH/PRAGMA 等越界语句。
// - 平台库（datasourceName=platform:<库名>）：只读，执行前用 EXPLAIN 核对实际读取的表与列，账号/会话/凭据表和敏感列一律拒绝。
// - NetCare 业务库（datasourceName=基座业务库组名）：经平台已配置的数字人基座只读转发。
// 应用凭 URL 中的数据令牌识别，令牌只注入应用进程环境变量；经 Cloudflare 等转发进来的请求一律拒绝。
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const tenant = require('../tenant-context');
const databases = require('../agent-database-service');

const MAX_ROWS = 1000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const STATEMENT_TIMEOUT_MS = 15000;
const APP_DB_MAX_PAGES = 262144; // 4 KB 页 × 262144 ≈ 1 GB
const appDatabases = new Map(); // `${tenant}/${slug}` → Promise<sqlite3.Database>
const buckets = new Map();

const fail = (message, code = 'HOSTED_DATA_INVALID', status = 400) => Object.assign(new Error(message), { code, status });

// SQLite 查询占用 Node 的 libuv 线程池（默认 4 个线程，平台自身的文件和数据库操作也用它）。
// 托管应用的语句全局最多同时执行 2 条、每个应用 1 条，至少留一半线程给平台；排队过长直接拒绝。
const MAX_RUNNING = 2;
const MAX_QUEUED = 40;
let running = 0;
const queue = [];
const runningByApp = new Map();

function acquire(appKey) {
    return new Promise((resolve, reject) => {
        const tryStart = () => {
            if (running >= MAX_RUNNING || (runningByApp.get(appKey) || 0) >= 1) return false;
            running += 1;
            runningByApp.set(appKey, (runningByApp.get(appKey) || 0) + 1);
            resolve(() => {
                running -= 1;
                const left = (runningByApp.get(appKey) || 1) - 1;
                if (left) runningByApp.set(appKey, left); else runningByApp.delete(appKey);
                for (let index = 0; index < queue.length; index++) {
                    if (queue[index]()) { queue.splice(index, 1); break; }
                }
            });
            return true;
        };
        if (tryStart()) return;
        if (queue.length >= MAX_QUEUED) return reject(fail('数据接口繁忙，请稍后重试', 'HOSTED_DATA_BUSY', 429));
        queue.push(tryStart);
    });
}

async function limited(app, task, request) {
    const release = await acquire(`${app.tenantId}/${app.slug}`);
    try {
        // 排队期间应用已断开（例如它自己的请求超时），不再执行这条语句
        if (request?.aborted) throw fail('请求方已断开，语句未执行', 'HOSTED_DATA_ABORTED', 499);
        return await task();
    } finally { release(); }
}

// ── SQL 守卫（去掉字面量与注释后再判断关键字）──────────────────
function skeleton(sql) {
    return String(sql || '')
        .replace(/'(?:[^']|'')*'/g, "''")
        .replace(/"(?:[^"]|"")*"/g, '""')
        .replace(/`[^`]*`/g, '``')
        .replace(/\[[^\]]*\]/g, '[]')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\n]*/g, ' ');
}

function singleStatement(sql) {
    const text = String(sql || '').trim().replace(/;\s*$/, '');
    if (!text) throw fail('sql 不能为空');
    if (text.length > 100000) throw fail('SQL 过长');
    if (skeleton(text).includes(';')) throw fail('一次只能执行一条 SQL');
    return text;
}

const READ_RE = /^\s*\(?\s*(select|with|values)\b/i;
const ESCAPE_RE = /\b(attach|detach|pragma|vacuum|reindex|load_extension|readfile|writefile|fts3_tokenizer)\b/i;

function assertRead(sql) {
    const text = singleStatement(sql);
    const bare = skeleton(text);
    if (!READ_RE.test(bare)) throw fail('查询接口只接受 SELECT / WITH 语句；写入请调用 /execute');
    if (ESCAPE_RE.test(bare)) throw fail(`查询语句不能包含 ${ESCAPE_RE.exec(bare)[1].toUpperCase()}`);
    return text;
}

function assertAppWrite(sql) {
    const text = singleStatement(sql);
    const bare = skeleton(text);
    const kind = /^\s*(insert|update|delete|replace|create|alter|drop|with)\b/i.exec(bare)?.[1]?.toLowerCase();
    if (!kind) throw fail('写入接口支持 INSERT / UPDATE / DELETE / REPLACE，以及在应用库内 CREATE / ALTER / DROP');
    if (ESCAPE_RE.test(bare)) throw fail(`不能执行 ${ESCAPE_RE.exec(bare)[1].toUpperCase()}：应用只能操作自己的库`);
    if (/\bcreate\s+virtual\b/i.test(bare)) throw fail('不支持创建虚拟表');
    return { sql: text, kind };
}

// ── 连接 ─────────────────────────────────────────────
function open(file, mode) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(file, mode, error => error ? reject(error) : resolve(db));
    });
}
const allOf = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const runOf = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
    if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID });
}));

async function withTimeout(db, task) {
    const timer = setTimeout(() => db.interrupt(), STATEMENT_TIMEOUT_MS);
    try { return await task(); } catch (error) {
        if (error && error.code === 'SQLITE_INTERRUPT') throw fail(`SQL 执行超过 ${STATEMENT_TIMEOUT_MS / 1000} 秒，已中止`, 'HOSTED_DATA_TIMEOUT', 408);
        throw error;
    } finally { clearTimeout(timer); }
}

function appDatabase(tenantId, slug) {
    const key = `${tenantId}/${slug}`;
    if (!appDatabases.has(key)) {
        const promise = (async () => {
            const file = tenant.runWithTenant(tenantId, () => require('./runtime').paths(slug, tenantId).db);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const db = await open(file, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
            db.configure('busyTimeout', 5000);
            await allOf(db, 'PRAGMA journal_mode = WAL');
            await allOf(db, 'PRAGMA foreign_keys = ON');
            await allOf(db, 'PRAGMA trusted_schema = OFF');
            await allOf(db, `PRAGMA max_page_count = ${APP_DB_MAX_PAGES}`);
            return db;
        })();
        promise.catch(() => appDatabases.delete(key));
        appDatabases.set(key, promise);
    }
    return appDatabases.get(key);
}

async function closeAppDatabase(tenantId, slug) {
    const key = `${tenantId}/${slug}`;
    const pending = appDatabases.get(key);
    appDatabases.delete(key);
    if (!pending) return;
    try {
        const db = await pending;
        await new Promise(resolve => db.close(() => resolve()));
    } catch (_error) { /* 未打开成功 */ }
}

/** 应用包自带的初始化脚本（db/init.sqlite.sql）：只作用于应用自己的库，多语句执行，同样禁止 ATTACH 等越界语句。 */
async function applyInitSql(tenantId, slug, sql) {
    const bare = skeleton(sql);
    if (ESCAPE_RE.test(bare)) throw fail(`初始化脚本不能包含 ${ESCAPE_RE.exec(bare)[1].toUpperCase()}`);
    if (/\bcreate\s+virtual\b/i.test(bare)) throw fail('初始化脚本不支持创建虚拟表');
    const db = await appDatabase(tenantId, slug);
    await withTimeout(db, () => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve())));
}

function normalizeRows(rows) {
    let bytes = 0;
    return rows.map(row => {
        const next = {};
        for (const [key, value] of Object.entries(row)) next[key] = Buffer.isBuffer(value) ? value.toString('base64') : value;
        bytes += JSON.stringify(next).length;
        if (bytes > MAX_RESPONSE_BYTES) throw fail('查询结果超过 16 MB，请缩小范围或分页', 'HOSTED_DATA_TOO_LARGE', 413);
        return next;
    });
}

function limitOf(value) {
    return Math.min(MAX_ROWS, Math.max(1, Math.floor(Number(value)) || MAX_ROWS));
}

// 用分批 step 取数，超过上限即停止，避免把整张大表搬进内存
function eachRows(db, sql, limit) {
    return new Promise((resolve, reject) => {
        const statement = db.prepare(sql, error => { if (error) reject(error); });
        const rows = [];
        const next = () => statement.get((error, row) => {
            if (error) { statement.finalize(); reject(error); return; }
            if (!row || rows.length >= limit) { statement.finalize(() => resolve({ rows, truncated: Boolean(row) })); return; }
            rows.push(row);
            next();
        });
        next();
    });
}

// ── 应用库 ───────────────────────────────────────────
async function queryApp(app, sql, limit) {
    const text = assertRead(sql);
    const db = await appDatabase(app.tenantId, app.slug);
    return withTimeout(db, async () => {
        const { rows, truncated } = await eachRows(db, text, limitOf(limit));
        return { rows: normalizeRows(rows), truncated };
    });
}

async function executeApp(app, sql) {
    const checked = assertAppWrite(sql);
    const db = await appDatabase(app.tenantId, app.slug);
    return withTimeout(db, async () => {
        const result = await runOf(db, checked.sql);
        return { kind: checked.kind, affectedRows: result.changes, lastInsertId: checked.kind === 'insert' || checked.kind === 'replace' ? result.lastID : null };
    });
}

// ── 平台库（只读 + EXPLAIN 核对访问对象）─────────────────────
const PROTECTED_DATABASES = new Set(['chat-history.db']);

function platformFile(name) {
    const id = String(name || '').replace(/^platform:/i, '').toLowerCase();
    if (PROTECTED_DATABASES.has(id)) throw fail('该平台库不对托管应用开放', 'HOSTED_DATA_FORBIDDEN', 403);
    const item = databases.platformFiles().find(entry => entry.id.slice('platform:'.length).toLowerCase() === id);
    if (!item) throw fail(`平台库不存在：${name}；可调用 /query/datasources 查看可用数据源`, 'HOSTED_DATA_NOT_FOUND', 404);
    return item;
}

/** 解析 EXPLAIN 字节码，列出实际打开的表/索引与读取的列；任何写入、虚拟表或附加库都拒绝。 */
async function assertSafeReadPlan(db, sql) {
    const ops = await allOf(db, `EXPLAIN ${sql}`);
    const master = await allOf(db, "SELECT type, name, tbl_name, rootpage FROM sqlite_master WHERE rootpage > 0");
    const byRoot = new Map(master.map(row => [row.rootpage, row]));
    const cursors = new Map();
    const columnCache = new Map();
    const columnsOf = async (kind, name) => {
        const key = `${kind}:${name}`;
        if (!columnCache.has(key)) {
            const rows = kind === 'table'
                ? await allOf(db, `PRAGMA table_xinfo("${name.replace(/"/g, '""')}")`)
                : await allOf(db, `PRAGMA index_xinfo("${name.replace(/"/g, '""')}")`);
            columnCache.set(key, rows);
        }
        return columnCache.get(key);
    };
    for (const op of ops) {
        const opcode = op.opcode;
        if (['OpenWrite', 'VOpen', 'VFilter', 'VUpdate', 'VCreate', 'VDestroy', 'Destroy', 'Clear', 'CreateBtree', 'ParseSchema', 'Vacuum', 'Expire'].includes(opcode)) {
            throw fail(`查询包含不允许的操作（${opcode}）`, 'HOSTED_DATA_FORBIDDEN', 403);
        }
        if ((opcode === 'Function' || opcode === 'PureFunc') && /^(load_extension|readfile|writefile|fts3_tokenizer)\b/i.test(String(op.p4 || ''))) {
            throw fail('查询包含不允许的函数', 'HOSTED_DATA_FORBIDDEN', 403);
        }
        if (opcode === 'OpenRead' || opcode === 'ReopenIdx') {
            if (Number(op.p3) !== 0) throw fail('只能读取主库，不能访问附加库或临时库', 'HOSTED_DATA_FORBIDDEN', 403);
            const object = Number(op.p2) === 1 ? { type: 'table', name: 'sqlite_master', tbl_name: 'sqlite_master' } : byRoot.get(Number(op.p2));
            if (!object) throw fail('无法确认查询访问的数据表，已拒绝', 'HOSTED_DATA_FORBIDDEN', 403);
            if (databases.PRIVATE_TABLE.test(object.tbl_name)) throw fail(`表 ${object.tbl_name} 不对托管应用开放（账号、会话、凭据或内部状态）`, 'HOSTED_DATA_FORBIDDEN', 403);
            cursors.set(op.p1, object);
        }
        if (opcode === 'Column') {
            const object = cursors.get(op.p1);
            if (!object) continue; // 临时排序表等派生游标，其来源列已在打开原表时核对
            const columns = await columnsOf(object.type === 'index' ? 'index' : 'table', object.name);
            const column = object.type === 'index' ? columns.find(row => Number(row.seqno) === Number(op.p2)) : columns[Number(op.p2)];
            if (column?.name && databases.PRIVATE_COLUMN.test(column.name)) {
                throw fail(`列 ${object.tbl_name}.${column.name} 属于敏感字段，不对托管应用开放；请显式列出需要的列，不要使用 *`, 'HOSTED_DATA_FORBIDDEN', 403);
            }
        }
    }
}

async function queryPlatform(name, sql, limit) {
    const text = assertRead(sql);
    const item = platformFile(name);
    const db = await open(item.file, sqlite3.OPEN_READONLY);
    try {
        db.configure('busyTimeout', 5000);
        await allOf(db, 'PRAGMA query_only = ON');
        await allOf(db, 'PRAGMA trusted_schema = OFF');
        return await withTimeout(db, async () => {
            await assertSafeReadPlan(db, text);
            const { rows, truncated } = await eachRows(db, text, limitOf(limit));
            return { rows: normalizeRows(rows), truncated };
        });
    } finally {
        await new Promise(resolve => db.close(() => resolve()));
    }
}

async function platformTables(item) {
    const db = await open(item.file, sqlite3.OPEN_READONLY);
    try {
        const rows = await allOf(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name LIMIT 2000");
        return rows.map(row => row.name).filter(name => !databases.PRIVATE_TABLE.test(name));
    } finally {
        await new Promise(resolve => db.close(() => resolve()));
    }
}

// ── NetCare 基座只读转发 ───────────────────────────────
async function netcareConfig() {
    try {
        const config = await require('../digital-human/config-repository').getConfig();
        return config && config.enabled && config.businessDatasourceName ? config : null;
    } catch (_error) {
        return null;
    }
}

let cachedNetcareName = '';
function datasourceNames() {
    return { netcareName: cachedNetcareName };
}

async function refreshNetcareName() {
    const config = await netcareConfig();
    cachedNetcareName = config ? config.businessDatasourceName : '';
    return cachedNetcareName;
}

async function queryNetcare(sql, limit) {
    const config = await netcareConfig();
    if (!config) throw fail('NetCare 基座未启用：请管理员在「全局设置 › 频道对接 › 数字人」导入并启用基座配置', 'HOSTED_DATA_NETCARE_DISABLED', 409);
    const page = await require('../digital-human/base-client').queryPage(sql, { scope: 'business', limit: limitOf(limit), config });
    return { rows: page.rows, truncated: false };
}

// ── 路由处理 ─────────────────────────────────────────
function rateLimit(key) {
    const now = Date.now();
    const bucket = buckets.get(key) || { tokens: 40, at: now };
    bucket.tokens = Math.min(40, bucket.tokens + ((now - bucket.at) / 1000) * 20);
    bucket.at = now;
    if (bucket.tokens < 1) throw fail('请求过于频繁，请稍后重试', 'HOSTED_DATA_RATE_LIMIT', 429);
    bucket.tokens -= 1;
    buckets.set(key, bucket);
}

function isApp(app, body) {
    const hasApp = body.datasourceId !== undefined || body.schema !== undefined;
    if (!hasApp) return false;
    if (String(body.datasourceId ?? 'app') !== 'app' || (body.schema !== undefined && String(body.schema) !== app.uuid)) {
        throw fail('只能访问本应用的应用库（datasourceId=app，schema=APP_SCHEMA）', 'HOSTED_DATA_FORBIDDEN', 403);
    }
    return true;
}

function query(app, body = {}, request) {
    return limited(app, () => runQuery(app, body), request);
}

async function runQuery(app, body = {}) {
    const { sql, limit } = body;
    if (isApp(app, body)) return queryApp(app, sql, limit);
    const name = String(body.datasourceName || '');
    if (!name) throw fail('请提供 datasourceName（业务库）或 datasourceId + schema（应用库）');
    if (/^platform:/i.test(name)) return queryPlatform(name, sql, limit);
    const netcare = await refreshNetcareName();
    if (name === netcare || name.toLowerCase() === 'netcare') return queryNetcare(sql, limit);
    throw fail(`未知数据源：${name}；可调用 /query/datasources 查看`, 'HOSTED_DATA_NOT_FOUND', 404);
}

function execute(app, body = {}, request) {
    return limited(app, () => runExecute(app, body), request);
}

async function runExecute(app, body = {}) {
    if (body.datasourceName && !isApp(app, body)) throw fail('业务库只读，写操作只能作用于本应用的应用库', 'HOSTED_DATA_FORBIDDEN', 403);
    if (!isApp(app, { datasourceId: body.datasourceId ?? 'app', schema: body.schema })) throw fail('请提供 datasourceId=app');
    return executeApp(app, body.sql);
}

async function listDatasources(app) {
    const items = [{ id: 'app', name: '应用库', type: 'APP_CUSTOM', schema: app.uuid, writable: true }];
    for (const item of databases.platformFiles()) {
        const name = item.id.slice('platform:'.length);
        if (PROTECTED_DATABASES.has(name.toLowerCase())) continue;
        items.push({ name: item.id, type: 'PLATFORM_READONLY', writable: false });
    }
    const netcare = await refreshNetcareName();
    if (netcare) items.push({ name: netcare, type: 'NETCARE_READONLY', writable: false });
    return items;
}

async function findTableDatasource(app, table) {
    const name = String(table || '').trim();
    if (!/^[\w$\-一-龥]{1,128}$/.test(name)) throw fail('table 参数无效');
    const hits = [];
    for (const item of databases.platformFiles()) {
        if (PROTECTED_DATABASES.has(item.id.slice('platform:'.length).toLowerCase())) continue;
        try {
            if ((await platformTables(item)).some(entry => entry.toLowerCase() === name.toLowerCase())) hits.push({ datasourceName: item.id, type: 'PLATFORM_READONLY' });
        } catch (_error) { /* 库暂不可读 */ }
    }
    const config = await netcareConfig();
    if (config) {
        try {
            const result = await require('../digital-human/base-client').findTableDatasource(name, { config });
            if (result.data) hits.push({ datasourceName: config.businessDatasourceName, type: 'NETCARE_READONLY', detail: result.data });
        } catch (_error) { /* 基座不可达时只返回平台库结果 */ }
    }
    return hits;
}

const ok = (res, data, extra = {}) => res.json({ code: 200, success: true, message: 'success', data, ...extra });

function sendError(res, error) {
    const status = error.status || (error.statusCode >= 400 ? error.statusCode : 0) || (/SQLITE_/.test(error.code || '') ? 400 : 500);
    const message = /SQLITE_/.test(error.code || '') ? `SQL 执行失败：${String(error.message).replace(/^SQLITE_\w+:\s*/, '')}` : error.message || '数据接口异常';
    res.status(status).json({ code: status, success: false, message, errorCode: error.code || 'HOSTED_DATA_ERROR' });
}

// 只接受本机直连：隧道/反向代理转发进来的请求带有转发头，一律拒绝
function isDirectLoopback(req) {
    const address = String(req.socket?.remoteAddress || '');
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false;
    return !['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'cf-ray', 'true-client-ip'].some(name => req.headers[name] !== undefined);
}

/** Express 路由：挂在 /hosted-api，路径 /:token/dh/{query,execute,query/datasources,query/find-table-datasource}。 */
function createRouter() {
    const express = require('express');
    const router = express.Router();
    router.use('/:token/dh', express.json({ limit: '2mb' }), (req, res, next) => {
        if (!isDirectLoopback(req)) return res.status(404).end();
        const found = require('./runtime').resolveDataToken(req.params.token);
        if (!found) return res.status(401).json({ code: 401, success: false, message: '应用令牌无效' });
        tenant.runWithTenant(found.tenantId, () => {
            const state = require('./runtime').readState(found.slug, found.tenantId);
            if (!state) return res.status(401).json({ code: 401, success: false, message: '应用不存在' });
            try { rateLimit(`${found.tenantId}/${found.slug}`); } catch (error) { return sendError(res, error); }
            req.hostedApp = { tenantId: found.tenantId, slug: found.slug, uuid: state.uuid };
            req.hostedRequest = { aborted: false };
            res.on('close', () => { if (!res.writableFinished) req.hostedRequest.aborted = true; });
            next();
        });
    });
    const wrap = handler => (req, res) => tenant.runWithTenant(req.hostedApp.tenantId, async () => {
        try { await handler(req, res); } catch (error) { sendError(res, error); }
    });
    router.get('/:token/dh/query/datasources', wrap(async (req, res) => ok(res, await listDatasources(req.hostedApp))));
    router.get('/:token/dh/query/find-table-datasource', wrap(async (req, res) => ok(res, await findTableDatasource(req.hostedApp, req.query.table))));
    router.post('/:token/dh/query', wrap(async (req, res) => {
        const result = await query(req.hostedApp, req.body || {}, req.hostedRequest);
        ok(res, result.rows, { total: result.rows.length, truncated: result.truncated });
    }));
    router.post('/:token/dh/execute', wrap(async (req, res) => {
        const result = await execute(req.hostedApp, req.body || {}, req.hostedRequest);
        ok(res, { affectedRows: result.affectedRows, lastInsertId: result.lastInsertId }, { affectedRows: result.affectedRows });
    }));
    router.use('/:token/dh', (_req, res) => res.status(404).json({ code: 404, success: false, message: '接口不存在' }));
    return router;
}

module.exports = { createRouter, query, execute, applyInitSql, listDatasources, findTableDatasource, closeAppDatabase, datasourceNames, refreshNetcareName,
    assertRead, assertAppWrite, assertSafeReadPlan, isDirectLoopback };
