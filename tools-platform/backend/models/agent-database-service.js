// 工作区 SQLite 观察工具：结构化查询，禁止任意 SQL、控制面表、跨租户运行库及凭据字段。
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const guard = require('./agent-path-guard');
const tenant = require('./tenant-context');
const { redactValue, REDACTED } = require('./ai-sensitive-data');

const EXT = /\.(?:db|sqlite|sqlite3)$/i;
const PRIVATE_TABLE = /^(?:sqlite_|auth_|ai_|agent_|audit_|desktop_license|tenants?(?:_|$)|users?(?:_|$)|sessions?(?:_|$)|credentials?(?:_|$)|secrets?(?:_|$)|oauth|settings$)/i;
const PRIVATE_COLUMN = /(?:password|passwd|pwd|secret|token|cookie|authorization|credential|private.?key|api.?key|thought.?signature)/i;
const quote = name => `"${String(name).replace(/"/g, '""')}"`;
const fail = message => Object.assign(new Error(message), { code: 'AGENT_DATABASE_FORBIDDEN' });

function canonical(file) { return fs.realpathSync(file); }

function platformFiles() {
    const candidates = [];
    for (const [scope, dir] of [['data', tenant.getDataDir()], ['report', tenant.getReportDataDir()]]) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isFile() || !EXT.test(entry.name) || /backup|before|corrupt|repaired|chat-history/i.test(entry.name)) continue;
            const file = path.join(dir, entry.name);
            candidates.push({ id: `platform:${scope}/${entry.name}`, file: canonical(file), source: 'platform' });
        }
    }
    return candidates.filter((item, index) => candidates.findIndex(other => other.file === item.file) === index);
}

function checkLocal(file) {
    // 平台运行库必须通过当前租户目录解析，不能通过用户选的项目根目录绕开租户边界。
    for (const base of [tenant.BASE_DATA_DIR, tenant.BASE_REPORT_DATA_DIR]) {
        if (fs.existsSync(base) && guard.isInside(canonical(base), file)) throw fail('平台运行数据库请使用 platform: 标识读取当前租户，不能经本地路径访问');
    }
    guard.assertNotSecretFile(file);
}

function databaseFile(ctx, id) {
    if (String(id).startsWith('platform:')) {
        const item = platformFiles().find(entry => entry.id === id);
        if (!item) throw fail('数据库不属于当前租户，或不存在；请先调用 list_databases');
        return item.file;
    }
    if (!String(id).startsWith('local:')) throw fail('请使用 list_databases 返回的数据库标识');
    const file = canonical(guard.resolveInsideRoot(ctx.root, String(id).slice(6)));
    checkLocal(file);
    if (!EXT.test(file) || !fs.statSync(file).isFile()) throw fail('仅支持工作目录内的 SQLite 文件');
    return file;
}

async function withDatabase(ctx, id, callback) {
    const file = databaseFile(ctx, id);
    const db = await new Promise((resolve, reject) => {
        const connection = new sqlite3.Database(file, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(connection));
    });
    const timer = setTimeout(() => db.interrupt(), 5000);
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
    try {
        await all('PRAGMA query_only = ON');
        await all('PRAGMA trusted_schema = OFF');
        return await callback(all);
    } finally {
        clearTimeout(timer);
        await new Promise(resolve => db.close(() => resolve()));
    }
}

async function tables(all) {
    const rows = await all("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name LIMIT 2000");
    return rows.filter(row => !PRIVATE_TABLE.test(row.name) && /^CREATE\s+TABLE\b/i.test(row.sql || ''));
}

async function columns(all, table) {
    if (!(await tables(all)).some(row => row.name === table)) throw fail('该表不可供 AI 读取（不存在、凭据/会话表、视图或虚拟表）');
    const rows = await all(`PRAGMA table_info(${quote(table)})`);
    return rows.filter(row => !PRIVATE_COLUMN.test(row.name));
}

async function listDatabases(ctx, args = {}) {
    const items = platformFiles().map(({ id, source }) => ({ id, source }));
    const root = guard.resolveInsideRoot(ctx.root, args.path || '.');
    const queue = [{ dir: root, depth: 0 }];
    let visited = 0;
    let incomplete = false;
    while (queue.length && visited < 10000 && items.length < 100) {
        const { dir, depth } = queue.shift();
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (++visited > 10000 || items.length >= 100) { incomplete = true; break; }
            if (entry.isSymbolicLink()) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory() && !guard.isIgnoredDirName(entry.name)) {
                if (depth < 3) queue.push({ dir: file, depth: depth + 1 });
                else incomplete = true;
            } else if (entry.isFile() && EXT.test(entry.name)) {
                try { checkLocal(canonical(file)); } catch (_error) { continue; }
                items.push({ id: `local:${guard.toDisplayPath(ctx.root, file)}`, source: 'local' });
            }
        }
    }
    return { databases: items, incomplete: incomplete || queue.length > 0, hint: '本地扫描最多四层，可用 path 指定更深子目录；平台标识始终指向当前租户。' };
}

async function schema(ctx, args) {
    return withDatabase(ctx, args.database, async all => args.table
        ? { database: args.database, table: args.table, columns: (await columns(all, args.table)).map(row => ({ name: row.name, type: row.type, primaryKey: Boolean(row.pk) })) }
        : { database: args.database, tables: (await tables(all)).map(row => row.name) });
}

async function readTable(ctx, args) {
    return withDatabase(ctx, args.database, async all => {
        const available = await columns(all, args.table);
        const selected = Array.isArray(args.columns) && args.columns.length ? args.columns : available.slice(0, 16).map(row => row.name);
        if (!selected.length || selected.length > 16 || selected.some(name => !available.some(row => row.name === name))) throw fail('列不存在、属于敏感字段，或超过单次 16 列上限');
        const params = [];
        let where = '';
        if (args.filter) {
            if (!selected.includes(args.filter.column) || !['eq', 'contains'].includes(args.filter.op)) throw fail('筛选仅支持本次所选列的 eq / contains');
            if (!['string', 'number', 'boolean'].includes(typeof args.filter.value)) throw fail('筛选值必须为字符串、数字或布尔值');
            where = args.filter.op === 'eq' ? ` WHERE ${quote(args.filter.column)} = ?` : ` WHERE instr(CAST(${quote(args.filter.column)} AS TEXT), ?) > 0`;
            params.push(args.filter.value);
        }
        const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit)) || 20));
        const offset = Math.max(0, Math.floor(Number(args.offset)) || 0);
        // 不把任意大 BLOB/长文本搬进 Node 内存；每个值有明确截断提示。
        const fields = selected.map(name => `CASE WHEN typeof(${quote(name)}) = 'blob' THEN '[BLOB omitted]' WHEN typeof(${quote(name)}) = 'text' AND length(${quote(name)}) > 1000 THEN substr(${quote(name)}, 1, 1000) || '…[cell truncated]' ELSE ${quote(name)} END AS ${quote(name)}`);
        const keyFields = available.filter(row => /^(?:key|key_name|name|setting|setting_name|config_key)$/i.test(row.name));
        keyFields.forEach((row, index) => fields.push(`substr(CAST(${quote(row.name)} AS TEXT), 1, 120) AS ${quote(`__agent_key_hint_${index}`)}`));
        const rows = await all(`SELECT ${fields.join(', ')} FROM ${quote(args.table)}${where} LIMIT ? OFFSET ?`, [...params, limit + 1, offset]);
        const safeRows = [];
        for (const row of rows.slice(0, limit)) {
            // key/value 风格配置即使凭据藏在通用 value 列，也不返回原文。
            const sensitiveKeyRow = keyFields.some((_item, index) => PRIVATE_COLUMN.test(row[`__agent_key_hint_${index}`] || ''));
            const values = Object.fromEntries(selected.map(key => [key, row[key]]));
            const safe = sensitiveKeyRow ? Object.fromEntries(selected.map(key => [key, REDACTED])) : redactValue(values, { secrets: ctx.sensitiveValues });
            if (safeRows.length && JSON.stringify([...safeRows, safe]).length > 18000) break;
            safeRows.push(safe);
        }
        const hasMore = rows.length > safeRows.length;
        return { database: args.database, table: args.table, columns: selected, omittedColumns: available.length - selected.length,
            rows: safeRows, offset, nextOffset: hasMore ? offset + safeRows.length : null, readOnly: true,
            note: '凭据字段、账号/会话表不对 AI 开放；单格最多 1000 字符，BLOB 省略。分页期间数据库变更可能影响结果顺序。' };
    });
}

module.exports = { listDatabases, schema, readTable };
