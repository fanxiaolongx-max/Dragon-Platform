// 工作区 SQLite 工具：结构化增删改查，禁止任意 SQL、控制面表、跨租户运行库及凭据字段。
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const guard = require('./agent-path-guard');
const tenant = require('./tenant-context');
const pool = require('./tenant-sqlite-pool');
const { redactValue, containsSensitiveText, REDACTED } = require('./ai-sensitive-data');

const EXT = /\.(?:db|sqlite|sqlite3)$/i;
const PRIVATE_TABLE = /^(?:hosted_adc_|sqlite_|auth_|ai_(?!(?:report_|knowledge_|usage_))|agent_|audit_|desktop_license|desktop_agent_(?:settings|host_bindings)|snapshot_portal_keys|tenants?(?:_|$)|users?(?:_|$)|sessions?(?:_|$)|credentials?(?:_|$)|secrets?(?:_|$)|oauth|settings$)/i;
const PRIVATE_COLUMN = /(?:password|passwd|pwd|secret|token|cookie|authorization|credential|private.?key|api.?key|thought.?signature)/i;
const quote = name => `"${String(name).replace(/"/g, '""')}"`;
const fail = message => Object.assign(new Error(message), { code: 'AGENT_DATABASE_FORBIDDEN' });

function canonical(file) { return fs.realpathSync(file); }

// 与 tenant-sqlite-pool 中 scope='report' 打开的库保持一致；其余平台库都在数据目录。
const REPORT_SCOPED = ['report.db'];
const SKIPPED_FILE = /backup|before|corrupt|repaired|archive|restore|\.bak|\.old|\.tmp/i;

/**
 * 平台运行库按平台实际打开的位置解析，标识为 platform:<文件名>，与部署方式无关：
 * - 网页版默认租户：报表库在 TOOLS_REPORT_DATA_DIR（仓库 data/），其余在 TOOLS_DATA_DIR（backend/data/）；
 * - 桌面版、命名租户：两者同一目录。
 * 不在平台读取位置的同名文件（如数据目录里的旧 report.db 空壳）和 0 字节占位文件不列出，避免读到空库。
 */
function platformFiles() {
    const dataDir = tenant.getDataDir();
    const reportDir = tenant.getReportDataDir();
    const items = [];
    const add = (dir, name) => {
        const file = path.join(dir, name);
        let stat;
        try { stat = fs.statSync(file); } catch (_error) { return; }
        if (!stat.isFile() || stat.size === 0 || fs.lstatSync(file).isSymbolicLink()) return;
        if (path.dirname(canonical(file)) !== canonical(dir)) return;
        items.push({ id: `platform:${name}`, file: canonical(file), size: stat.size, source: 'platform' });
    };
    if (fs.existsSync(dataDir)) {
        for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
            if (!entry.isFile() || !EXT.test(entry.name) || SKIPPED_FILE.test(entry.name)) continue;
            if (REPORT_SCOPED.includes(entry.name.toLowerCase())) continue;
            add(dataDir, entry.name);
        }
    }
    REPORT_SCOPED.forEach(name => add(reportDir, name));
    return items.filter((item, index) => items.findIndex(other => other.file === item.file) === index);
}

// 兼容旧标识 platform:data/<名> 与 platform:report/<名>（历史转录、模型沿用旧写法）：统一按文件名解析到平台实际使用的库。
function platformName(id) {
    return String(id).slice('platform:'.length).replace(/^(?:data|report)\//i, '').toLowerCase();
}

function formatSize(bytes) {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
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
        const name = platformName(id);
        const item = platformFiles().find(entry => entry.id.slice('platform:'.length).toLowerCase() === name);
        if (!item) throw fail('数据库不属于当前租户，或不存在；请先调用 list_databases');
        if (name === 'chat-history.db' && ctx.readOnly !== false) throw fail('聊天记录数据库仅对管理员开放');
        return item.file;
    }
    if (!String(id).startsWith('local:')) throw fail('请使用 list_databases 返回的数据库标识');
    if (!ctx.root) throw fail('访问本地 SQLite 前请先选择工作目录；当前对话可直接访问当前租户的平台数据库');
    const file = canonical(guard.resolveInsideRoot(ctx.root, String(id).slice(6)));
    checkLocal(file);
    if (!EXT.test(file) || !fs.statSync(file).isFile()) throw fail('仅支持工作目录内的 SQLite 文件');
    return file;
}

async function withDatabase(ctx, id, callback, writable = false) {
    if (writable && ctx.readOnly !== false) throw fail('数据库写入仅对管理员开放');
    if (ctx.signal?.aborted) throw Object.assign(new Error('任务已中止'), { name: 'AbortError' });
    const file = databaseFile(ctx, id);
    const db = writable && String(id).startsWith('platform:')
        ? await pool.openExistingConnection(path.basename(file), REPORT_SCOPED.includes(path.basename(file)) ? 'report' : 'data')
        : await new Promise((resolve, reject) => {
            const connection = new sqlite3.Database(file, writable ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(connection));
        });
    db.configure('busyTimeout', 5000);
    const timer = setTimeout(() => db.interrupt(), 5000);
    const onAbort = () => db.interrupt();
    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
    const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (error) {
        if (error) reject(error);
        else resolve({ changes: this.changes, lastID: this.lastID });
    }));
    try {
        if (!writable) await all('PRAGMA query_only = ON');
        await all('PRAGMA foreign_keys = ON');
        await all('PRAGMA trusted_schema = OFF');
        return await callback(all, run);
    } finally {
        clearTimeout(timer);
        ctx.signal?.removeEventListener('abort', onAbort);
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
    const items = platformFiles().filter(item => ctx.readOnly === false || item.id !== 'platform:chat-history.db')
        .map(({ id, source, size }) => ({ id, source, size: formatSize(size), writable: ctx.readOnly === false }));
    if (!ctx.root) return { databases: items, incomplete: false, hint: '已列出当前租户实际使用的平台数据库；无需选择工作目录。访问其他本地 SQLite 请先选择其所在工作目录。' };
    // path 只用于工作目录内的子目录；模型误传 platform:/local: 标识时按工作目录根扫描，不报 ENOENT
    const scanPath = /^(?:platform|local):/i.test(String(args.path || '')) ? '.' : (args.path || '.');
    const root = guard.resolveInsideRoot(ctx.root, scanPath);
    const queue = [{ dir: root, depth: 0 }];
    let visited = 0;
    let incomplete = false;
    while (queue.length && visited < 10000 && items.length < 100) {
        const { dir, depth } = queue.shift();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            if (dir === root) throw error;
            incomplete = true; // 子目录无权限等：跳过，不影响平台库与其他目录
            continue;
        }
        for (const entry of entries) {
            if (++visited > 10000 || items.length >= 100) { incomplete = true; break; }
            if (entry.isSymbolicLink()) continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory() && !guard.isIgnoredDirName(entry.name)) {
                if (depth < 3) queue.push({ dir: file, depth: depth + 1 });
                else incomplete = true;
            } else if (entry.isFile() && EXT.test(entry.name)) {
                let size = 0;
                try { checkLocal(canonical(file)); size = fs.statSync(file).size; } catch (_error) { continue; }
                if (size === 0) continue;
                items.push({ id: `local:${guard.toDisplayPath(ctx.root, file)}`, source: 'local', size: formatSize(size), writable: ctx.readOnly === false });
            }
        }
    }
    return { databases: items, incomplete: incomplete || queue.length > 0, hint: '平台库标识形如 platform:report.db（报表/月报指标）、platform:tools.db（工具业务数据），始终指向当前租户实际使用的库；本地扫描最多四层，path 只接受工作目录内的子目录。' };
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
        // 空结果明确说明原因：模型曾把空表误判成「权限受限 / 未入库」
        const empty = safeRows.length ? undefined
            : args.filter ? '没有匹配筛选条件的行（表本身可能有数据，可换筛选值或去掉 filter）'
                : offset > 0 ? '已超出表的行数，没有更多数据'
                    : '该表当前为 0 行，是真实的空表，不是权限限制；请确认 list_databases 返回的库标识是否正确';
        return { database: args.database, table: args.table, columns: selected, omittedColumns: available.length - selected.length,
            rows: safeRows, offset, nextOffset: hasMore ? offset + safeRows.length : null, readOnly: true, writable: ctx.readOnly === false, ...(empty ? { empty } : {}),
            note: '凭据字段、账号/会话表不对 AI 开放；单格最多 1000 字符，BLOB 省略。分页期间数据库变更可能影响结果顺序。' };
    });
}

function scalar(value) {
    return value === null || typeof value === 'string' || typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value));
}

async function mutationPlan(all, args, ctx, { scriptContent = false } = {}) {
    if (!['insert', 'update', 'delete'].includes(args.operation)) throw fail('operation 必须为 insert、update 或 delete');
    const available = await columns(all, args.table);
    const names = new Set(available.map(row => row.name));
    let values = args.values;
    let entries = [];
    if (args.operation !== 'delete') {
        if (typeof values === 'string') {
            try { values = JSON.parse(values); } catch (_error) { throw fail('values 必须为有效的 JSON 对象字符串'); }
        }
        if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail('values 必须是列名到值的对象');
        entries = Object.entries(values);
        if (!entries.length || entries.some(([name, value]) => !names.has(name) || !scalar(value))) throw fail('写入列不存在、属于敏感字段，或值不是 SQLite 标量（JSON 请先序列化为字符串）');
        if (Buffer.byteLength(JSON.stringify(values)) > 1024 * 1024) throw fail('单次写入不能超过 1MB');
        if (entries.some(([name, value]) => !(scriptContent && ['payload_json', 'url', 'name', 'category'].includes(name))
            && typeof value === 'string' && containsSensitiveText(value, { secrets: ctx.sensitiveValues }))) throw fail('禁止通过 AI 工具写入凭据内容');
        if (entries.some(([name, value]) => !(scriptContent && name === 'name')
            && /^(?:key|key_name|name|setting|setting_name|config_key)$/i.test(name) && PRIVATE_COLUMN.test(String(value)))) throw fail('禁止修改凭据配置项');
    }
    const filters = args.filters === undefined ? [] : args.filters;
    if (!Array.isArray(filters) || filters.length > 16) throw fail('filters 必须是最多 16 个条件的数组');
    const params = [];
    const clauses = filters.map(filter => {
        if (!filter || !names.has(filter.column) || !['eq', 'contains', 'is_null'].includes(filter.op)
            || (filter.op !== 'is_null' && !scalar(filter.value))) throw fail('筛选列不存在、敏感，或筛选条件无效');
        if (filter.op === 'is_null') return `${quote(filter.column)} IS NULL`;
        if (filter.value === null) {
            if (filter.op !== 'eq') throw fail('null 值仅支持 eq 筛选');
            return `${quote(filter.column)} IS NULL`;
        }
        params.push(filter.value);
        return filter.op === 'eq' ? `${quote(filter.column)} = ?` : `instr(CAST(${quote(filter.column)} AS TEXT), ?) > 0`;
    });
    if (args.operation === 'insert' && filters.length) throw fail('insert 不接受筛选条件');
    if (args.operation !== 'insert' && !filters.length && args.allowAllRows !== true) throw fail('更新或删除必须提供 filters；操作整表需显式传 allowAllRows=true');
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const maxAffectedRows = args.maxAffectedRows === undefined ? 1000 : args.maxAffectedRows;
    if (!Number.isSafeInteger(maxAffectedRows) || maxAffectedRows < 1) throw fail('maxAffectedRows 必须为正整数');
    // Hidden side effects could bypass protected tables/fields. Refuse them
    // rather than trying to parse arbitrary trigger SQL.
    const triggers = await all("SELECT tbl_name FROM sqlite_master WHERE type = 'trigger'");
    const cascades = [];
    for (const row of await all("SELECT name, sql FROM sqlite_master WHERE type = 'table'")) {
        if (!/^CREATE\s+TABLE\b/i.test(row.sql || '')) continue;
        for (const fk of await all(`PRAGMA foreign_key_list(${quote(row.name)})`)) {
            cascades.push({ parent: String(fk.table).toLowerCase(), child: row.name, column: fk.from,
                delete: fk.on_delete, update: fk.on_update });
        }
    }
    const affectedTables = new Set([`${args.operation}:${args.table.toLowerCase()}`]);
    for (const item of affectedTables) {
        const colon = item.indexOf(':');
        const operation = item.slice(0, colon), name = item.slice(colon + 1);
        if (triggers.some(row => row.tbl_name.toLowerCase() === name)) throw fail('目标表或级联表含触发器，无法确认写入边界；请使用对应业务 API');
        for (const edge of cascades.filter(edge => edge.parent === name && ['CASCADE', 'SET NULL', 'SET DEFAULT'].includes(edge[operation]))) {
            if (PRIVATE_TABLE.test(edge.child) || PRIVATE_COLUMN.test(edge.column)) throw fail('此操作可能级联修改受保护数据，请使用对应业务 API');
            const nextOperation = operation === 'delete' && edge.delete === 'CASCADE' ? 'delete' : 'update';
            affectedTables.add(`${nextOperation}:${edge.child.toLowerCase()}`);
        }
    }
    const matchedRows = args.operation === 'insert' ? 1 : (await all(`SELECT count(*) AS n FROM ${quote(args.table)}${where}`, params))[0].n;
    if (matchedRows > maxAffectedRows) throw fail(`匹配 ${matchedRows} 行，超过 maxAffectedRows=${maxAffectedRows}；请收窄筛选或显式提高上限`);
    // Generic key/value tables may hide secrets in an otherwise ordinary value
    // column. Never let a broad filter overwrite or delete those rows.
    const keys = available.filter(row => /^(?:key|key_name|name|setting|setting_name|config_key)$/i.test(row.name));
    if (args.operation !== 'insert' && keys.length && !scriptContent) {
        for (let offset = 0; offset < matchedRows; offset += 500) {
            const fields = keys.map(row => `substr(CAST(${quote(row.name)} AS TEXT), 1, 120)`);
            const rows = await all(`SELECT ${fields.join(', ')} FROM ${quote(args.table)}${where} LIMIT 500 OFFSET ?`, [...params, offset]);
            if (rows.some(row => Object.values(row).some(value => PRIVATE_COLUMN.test(String(value))))) throw fail('匹配行包含凭据配置项，请收窄筛选');
        }
    }
    let sql;
    let bindings;
    if (args.operation === 'insert') {
        sql = `INSERT INTO ${quote(args.table)} (${entries.map(([name]) => quote(name)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`;
        bindings = entries.map(([, value]) => value);
    } else if (args.operation === 'update') {
        sql = `UPDATE ${quote(args.table)} SET ${entries.map(([name]) => `${quote(name)} = ?`).join(', ')}${where}`;
        bindings = [...entries.map(([, value]) => value), ...params];
    } else {
        sql = `DELETE FROM ${quote(args.table)}${where}`;
        bindings = params;
    }
    return { sql, bindings, matchedRows, maxAffectedRows };
}

async function previewWrite(ctx, args) {
    if (ctx.readOnly !== false) throw fail('数据库写入仅对管理员开放');
    return withDatabase(ctx, args.database, async all => {
        const plan = await mutationPlan(all, args, ctx);
        return { path: `${args.database} / ${args.table}`, diff: JSON.stringify({ operation: args.operation,
            matchedRows: plan.matchedRows, maxAffectedRows: plan.maxAffectedRows, values: args.values, filters: args.filters,
            allowAllRows: args.allowAllRows === true, note: '预览行数以执行时重新校验为准；数据库修改不支持文件撤销。' }, null, 2) };
    });
}

async function writeTable(ctx, args, internalOptions = {}) {
    // 仅脚本专用服务传入第三参数；模型传在 args 中的同名字段无效。
    // 脚本是可执行业务内容，允许包含鉴权逻辑和原有凭据；其余库/表的凭据保护保持不变。
    const scriptContent = internalOptions.scriptContent === true && args.table === 'uiv_scripts'
        && /^platform:(?:(?:data|report)\/)?tools\.db$/i.test(String(args.database));
    return withDatabase(ctx, args.database, async (all, run) => {
        await run('BEGIN IMMEDIATE');
        try {
            const plan = await mutationPlan(all, args, ctx, { scriptContent });
            const result = await run(plan.sql, plan.bindings);
            if (result.changes > plan.maxAffectedRows) throw fail('实际修改行数超过上限，已回滚');
            if (ctx.signal?.aborted) throw Object.assign(new Error('任务已中止，写入已回滚'), { name: 'AbortError' });
            await run('COMMIT');
            return { database: args.database, table: args.table, operation: args.operation, changes: result.changes,
                ...(args.operation === 'insert' ? { lastID: result.lastID } : {}),
                note: '修改已提交；changes 为直接受影响行数，外键级联遵循数据库约束。数据库修改不支持文件撤销。' };
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    }, true);
}

// 专用工具的多语句原子写入（如分类改名同步脚本），复用写连接与中止/超时保护。
async function transaction(ctx, id, callback) {
    return withDatabase(ctx, id, async (all, run) => {
        await run('BEGIN IMMEDIATE');
        try {
            const result = await callback(all, run);
            if (ctx.signal?.aborted) throw Object.assign(new Error('任务已中止，写入已回滚'), { name: 'AbortError' });
            await run('COMMIT');
            return result;
        } catch (error) {
            await run('ROLLBACK').catch(() => {});
            throw error;
        }
    }, true);
}

module.exports = { listDatabases, schema, readTable, previewWrite, writeTable, transaction, platformFiles, PRIVATE_TABLE, PRIVATE_COLUMN };
