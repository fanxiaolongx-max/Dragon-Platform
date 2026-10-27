// NetCare 表目录：表清单不写死在代码里——每次从基座 information_schema 动态读取（新增表自动出现），
// 再叠加两层语义：
//   1. 种子：全表盘点 §7/§7.1 的 441 张表分类、同事中文备注与核实结论（netcare-table-seed.json，只读）
//   2. 标注：管理员在探查页核对后填写的中文名、模块、说明、时间/区域字段、已核对标记（tools.db 的 dh_table_notes，租户隔离）
// 基座不可达时退回种子清单并标记 offline，页面仍能查看已有标注。
const { run, all, get } = require('../app-db');
const { getTenantId } = require('../tenant-context');
const configRepo = require('./config-repository');
const client = require('./base-client');
const seed = require('./netcare-table-seed.json');

const CACHE_TTL_MS = 10 * 60 * 1000;
const SAMPLE_ROWS = 20;
const NOTE_FIELDS = ['nameCn', 'module', 'description', 'timeField', 'regionField', 'officeField', 'verified', 'hidden'];
const NOTE_COLUMNS = { nameCn: 'name_cn', module: 'module', description: 'description', timeField: 'time_field', regionField: 'region_field', officeField: 'office_field', verified: 'verified', hidden: 'hidden' };
const SENTINELS = new Set(['SNULL', '源为空', 'SOURCE IS NULL', '-999999', 'Unknown', 'empty', 'NULL', 'null', 'N/A']);
const OPS = { '=': '=', '!=': '!=', '<>': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=', like: 'LIKE', 'not like': 'NOT LIKE', in: 'IN', 'not in': 'NOT IN', 'is null': 'IS NULL', 'is not null': 'IS NOT NULL', between: 'BETWEEN' };
const AGGS = { count: 'COUNT', count_distinct: 'COUNT', sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' };
const cache = new Map();

// ── 规则推断（种子里没有的新表用；与全表盘点 analyze_full_db.py 同口径）──
const GRAIN_RULES = [
    [/_dws_snap$/, 'DWS快照'], [/_dwd_snap$/, 'DWD快照'], [/_snap(_\d+)?$/, '快照'],
    [/_dws_[01]$/, 'DWS分区(_0/_1)'], [/_dwd_[01]$/, 'DWD分区(_0/_1)'], [/_(d|day)_dws$/, '日粒度汇总'], [/_(d|day)_dwd$/, '日粒度明细'],
    [/_m_dwd$/, '月粒度明细'], [/_h_dw[ds]$/, '小时明细'], [/_dws$/, 'DWS汇总'], [/_dwd$/, 'DWD明细'], [/_ods$/, 'ODS源层'], [/_ga$/, '全量GA'],
    [/_derive(_dwd)?$/, '衍生'], [/_\d{1,2}$/, '分区'], [/_vi$/, '视图']
];
const CATEGORY_RULES = [
    [/^common_data_|_rel_|relation/, '公共基础表（维表/关联关系）'], [/major_incident/, '重大事件'], [/license/, 'License'],
    [/rectif/, '整改'], [/risk|eos/, '风险'], [/incident|notify|survey|event/, '事件/通知/调查'], [/(^|_)sr(_|$)|srvreq|problem/, '服务请求(问题单)'],
    [/task|rfc|work/, '任务/工单'], [/maintenance|health_check/, '维护/检修'], [/network|knet/, '网络'], [/account/, '账务'], [/change/, '变更'], [/^op_ioc_/, 'IOC运营']
];

function inferGrain(name) {
    return GRAIN_RULES.find(([re]) => re.test(name))?.[1] || '';
}

function inferCategory(name) {
    return CATEGORY_RULES.find(([re]) => re.test(name))?.[1] || '其他';
}

// 分区族：xxx_0 / xxx_1、xxx_01 ~ xxx_12 归为同一族，提醒取数时不要重复计数
function familyOf(name, names) {
    const match = /^(.*?)_(\d{1,2})$/.exec(name);
    if (!match) return '';
    const siblings = names.filter(other => other !== name && new RegExp(`^${match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{1,2}$`).test(other));
    return siblings.length ? match[1] : '';
}

// ── 标注存储 ─────────────────────────────────────────
const schemaReady = new WeakMap();
async function ensureSchema() {
    const db = require('../app-db').getDatabase();
    if (!schemaReady.has(db)) {
        const pending = run(`CREATE TABLE IF NOT EXISTS dh_table_notes (
            scope TEXT NOT NULL, name TEXT NOT NULL,
            name_cn TEXT DEFAULT '', module TEXT DEFAULT '', description TEXT DEFAULT '',
            time_field TEXT DEFAULT '', region_field TEXT DEFAULT '', office_field TEXT DEFAULT '',
            verified INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0,
            updated_by TEXT DEFAULT '', updated_at TEXT DEFAULT '',
            PRIMARY KEY (scope, name))`);
        schemaReady.set(db, pending);
        pending.catch(() => schemaReady.delete(db));
    }
    await schemaReady.get(db);
}

function noteFromRow(row) {
    if (!row) return null;
    return {
        nameCn: row.name_cn || '', module: row.module || '', description: row.description || '',
        timeField: row.time_field || '', regionField: row.region_field || '', officeField: row.office_field || '',
        verified: Boolean(row.verified), hidden: Boolean(row.hidden), updatedBy: row.updated_by || '', updatedAt: row.updated_at || ''
    };
}

async function listNotes(scope) {
    await ensureSchema();
    const rows = await all('SELECT * FROM dh_table_notes WHERE scope = ?', [scope]);
    return new Map(rows.map(row => [row.name, noteFromRow(row)]));
}

async function getNote(scope, name) {
    await ensureSchema();
    return noteFromRow(await get('SELECT * FROM dh_table_notes WHERE scope = ? AND name = ?', [scope, name]));
}

async function saveNote(scope, name, patch = {}, actor = '') {
    if (!['business', 'app'].includes(scope)) throw client.dhError('DH_BAD_SCOPE', '未知的数据范围', { statusCode: 400 });
    if (!/^[A-Za-z0-9_$\-]{1,128}$/.test(String(name || ''))) throw client.dhError('DH_BAD_IDENT', '表名不合法', { statusCode: 400 });
    const current = await getNote(scope, name) || {};
    const next = { ...current };
    for (const key of NOTE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
        next[key] = ['verified', 'hidden'].includes(key) ? Boolean(patch[key]) : String(patch[key] ?? '').trim().slice(0, key === 'description' ? 2000 : 200);
    }
    const values = NOTE_FIELDS.map(key => (['verified', 'hidden'].includes(key) ? (next[key] ? 1 : 0) : next[key] || ''));
    await run(`INSERT INTO dh_table_notes (scope, name, ${NOTE_FIELDS.map(key => NOTE_COLUMNS[key]).join(', ')}, updated_by, updated_at)
        VALUES (?, ?, ${NOTE_FIELDS.map(() => '?').join(', ')}, ?, ?)
        ON CONFLICT(scope, name) DO UPDATE SET ${NOTE_FIELDS.map(key => `${NOTE_COLUMNS[key]} = excluded.${NOTE_COLUMNS[key]}`).join(', ')}, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [scope, name, ...values, String(actor || '').slice(0, 80), new Date().toISOString()]);
    invalidate();
    return getNote(scope, name);
}

// ── 动态表清单 ───────────────────────────────────────
// 单表详情 / 查询要真正请求基座：未启用时直接说明，不去连默认的 beta 域名
async function liveConfig() {
    const config = await configRepo.getConfig();
    if (!config.enabled) throw client.dhError('DH_DISABLED', '数字人对接未启用：请到「全局设置 › 频道对接 › 数字人」导入配置并启用', { statusCode: 409 });
    return config;
}

function schemaOf(config, scope) {
    return scope === 'app' ? config.appSchema : config.businessSchema;
}

function cacheKey(config, scope) {
    return [getTenantId(), scope, configRepo.apiBase(config), schemaOf(config, scope), config.updatedAt].join('|');
}

function invalidate() {
    cache.clear();
}

async function fetchLiveTables(config, scope) {
    const schema = client.quote(schemaOf(config, scope));
    const [tables, columns] = await Promise.all([
        client.queryAll(`SELECT TABLE_NAME AS name, TABLE_COMMENT AS comment, TABLE_ROWS AS est_rows, TABLE_TYPE AS table_type, CREATE_TIME AS create_time, UPDATE_TIME AS update_time FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${schema} ORDER BY TABLE_NAME`, { scope, config }),
        client.queryAll(`SELECT TABLE_NAME AS name, COUNT(*) AS column_count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${schema} GROUP BY TABLE_NAME ORDER BY TABLE_NAME`, { scope, config })
    ]);
    const columnCount = new Map(columns.rows.map(row => [pick(row, 'name'), Number(pick(row, 'column_count')) || 0]));
    return tables.rows.map(row => {
        const name = String(pick(row, 'name') || '');
        return { name, comment: pick(row, 'comment') || '', rows: Number(pick(row, 'est_rows')) || 0, columns: columnCount.get(name) || 0, tableType: pick(row, 'table_type') || '', createTime: pick(row, 'create_time') || '', updateTime: pick(row, 'update_time') || '' };
    }).filter(item => item.name);
}

// information_schema 的列名大小写取决于数据库，按不区分大小写读取
function pick(row, key) {
    if (!row) return undefined;
    if (key in row) return row[key];
    const found = Object.keys(row).find(name => name.toLowerCase() === key.toLowerCase());
    return found ? row[found] : undefined;
}

/**
 * 表目录。scope：business | app。refresh 跳过 10 分钟缓存。
 * @returns {{ scope, schema, live: boolean, error?: string, fetchedAt, tables: object[], stats: object }}
 */
async function listTables({ scope = 'business', refresh = false } = {}) {
    const config = await configRepo.getConfig();
    const schema = schemaOf(config, scope);
    const key = cacheKey(config, scope);
    let liveResult = !refresh && cache.get(key);
    if (liveResult && Date.now() - liveResult.at > CACHE_TTL_MS) liveResult = null;
    if (!liveResult) {
        try {
            if (!config.enabled) throw client.dhError('DH_DISABLED', '数字人对接未启用');
            liveResult = { at: Date.now(), tables: await fetchLiveTables(config, scope) };
            cache.set(key, liveResult);
        } catch (error) {
            liveResult = { at: Date.now(), tables: null, error: error.message };
        }
    }
    const notes = await listNotes(scope);
    const seedTables = scope === 'business' ? seed.tables : {};
    const liveMap = new Map((liveResult.tables || []).map(item => [item.name, item]));
    // 在线：基座真实表 + 种子里有但库里已不存在的表（标 missing）；离线：种子 + 已标注的表
    const names = [...new Set(liveResult.tables
        ? [...liveMap.keys(), ...Object.keys(seedTables)]
        : [...Object.keys(seedTables), ...notes.keys()])].sort();
    const tables = names.map(name => {
        const live = liveMap.get(name);
        const base = seedTables[name] || null;
        const note = notes.get(name) || null;
        const rows = live ? live.rows : base?.rows || 0;
        return {
            name, scope,
            family: familyOf(name, names),
            nameCn: note?.nameCn || live?.comment || base?.nameCn || '',
            nameCnSource: note?.nameCn ? 'note' : live?.comment ? 'comment' : base?.nameCn ? 'seed' : '',
            module: note?.module || base?.module || '',
            category: base?.category || inferCategory(name),
            grain: base?.grain || inferGrain(name),
            comment: live?.comment || '',
            rows, columns: live ? live.columns : base?.columns || 0,
            empty: rows <= 0,
            status: !liveResult.tables ? 'offline' : live ? 'live' : 'missing',
            isNew: Boolean(live && scope === 'business' && !base),
            seedNote: base?.note || '', review: base?.review || '', seedNameCn: base?.nameCnOriginal || '',
            description: note?.description || '', timeField: note?.timeField || '', regionField: note?.regionField || '', officeField: note?.officeField || '',
            verified: Boolean(note?.verified), hidden: Boolean(note?.hidden), updatedBy: note?.updatedBy || '', updatedAt: note?.updatedAt || '',
            updateTime: live?.updateTime || ''
        };
    });
    const visible = tables.filter(item => !item.hidden);
    return {
        scope, schema, live: Boolean(liveResult.tables), ...(liveResult.error ? { error: liveResult.error } : {}),
        fetchedAt: new Date(liveResult.at).toISOString(), seedSource: scope === 'business' ? seed.source : '',
        tables,
        stats: {
            total: visible.length,
            withData: visible.filter(item => !item.empty && item.status !== 'missing').length,
            empty: visible.filter(item => item.empty && item.status !== 'missing').length,
            isNew: visible.filter(item => item.isNew).length,
            missing: visible.filter(item => item.status === 'missing').length,
            named: visible.filter(item => item.nameCn).length,
            verified: visible.filter(item => item.verified).length,
            hidden: tables.length - visible.length
        }
    };
}

// ── 单表详情 ─────────────────────────────────────────
const ROLE_RULES = {
    time: /^(period_month|period_date|period_ym|archive_ym|month|date|stat_date|create_time|createtime|create_date|update_time|close_time|closed_time|release_date|report_date|act_close_date|complete_time|change_time|[a-z_]*_(date|time|month))$/i,
    region: /^(region_code|customer_region|sub_region_id|regional_department|region_id)$/i,
    office: /^(repoffice_code|rep_office_code|office_code|customer_office|rep_office_id|representative_office|repoffice_id)$/i,
    bg: /^(bg|belongs_to_bg|bg_type_name)$/i
};

function valueKind(value) {
    if (value === null || value === undefined || value === '') return 'empty';
    if (typeof value === 'number') return /^1\d{12}$/.test(String(value)) ? 'epoch-ms' : 'number';
    const text = String(value);
    if (/^1\d{12}$/.test(text)) return 'epoch-ms';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return 'iso-datetime';
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) return 'datetime';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return 'date';
    if (/^\d{4}-\d{2}$/.test(text)) return 'year-month';
    if (/^-?\d+(\.\d+)?$/.test(text)) return 'number';
    return 'text';
}

// 字段画像（基于样例行）：空值、示例值、取值形态、占位值（SNULL / 源为空 / -999999 等）
function profile(columns, rows) {
    return columns.map(column => {
        const values = rows.map(row => pick(row, column.name));
        const filled = values.filter(value => value !== null && value !== undefined && value !== '');
        const kinds = [...new Set(filled.map(valueKind))];
        const sentinels = [...new Set(filled.map(String).filter(value => SENTINELS.has(value)))];
        const role = Object.entries(ROLE_RULES).find(([, re]) => re.test(column.name))?.[0] || '';
        return {
            ...column, role,
            sampleFilled: filled.length, sampleTotal: values.length,
            examples: [...new Set(filled.map(value => String(value).slice(0, 80)))].slice(0, 3),
            kinds, sentinels
        };
    });
}

async function describeTable(scope, name, { sampleRows = SAMPLE_ROWS } = {}) {
    const config = await liveConfig();
    const schema = schemaOf(config, scope);
    client.ident(name);
    const columnResult = await client.queryAll(`SELECT COLUMN_NAME AS name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, COLUMN_COMMENT AS comment, IS_NULLABLE AS nullable, COLUMN_KEY AS column_key, ORDINAL_POSITION AS position FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${client.quote(schema)} AND TABLE_NAME = ${client.quote(name)} ORDER BY ORDINAL_POSITION`, { scope, config });
    const columns = columnResult.rows.map(row => ({
        name: String(pick(row, 'name') || ''), dataType: pick(row, 'data_type') || '', columnType: pick(row, 'column_type') || '',
        comment: pick(row, 'comment') || '', nullable: pick(row, 'nullable') === 'YES', key: pick(row, 'column_key') || ''
    })).filter(item => item.name);
    if (!columns.length) throw client.dhError('DH_TABLE_NOT_FOUND', `${schema} 中没有表 ${name}`, { statusCode: 404 });
    const limit = Math.min(200, Math.max(0, Number(sampleRows) || 0));
    const sample = limit ? await client.queryPage(`SELECT * FROM ${tableRef(config, scope, name)} LIMIT ${limit}`, { scope, limit, config }) : { rows: [] };
    const fields = profile(columns, sample.rows);
    const note = await getNote(scope, name);
    const base = scope === 'business' ? seed.tables[name] || null : null;
    const suggest = role => fields.find(field => field.role === role)?.name || '';
    return {
        scope, schema, name, note, seed: base,
        columns: fields,
        sample: sample.rows,
        suggestions: { timeField: suggest('time'), regionField: suggest('region'), officeField: suggest('office') },
        hints: hintsOf(name, fields, base)
    };
}

function hintsOf(name, fields, base) {
    const hints = [];
    if (/_\d{1,2}$/.test(name)) hints.push('分区表：同族 _0/_1（或 _01~_12）可能是轮换表或分区，合并取数前先确认哪张是当前有效数据，避免重复计数。');
    const epoch = fields.filter(field => field.kinds.includes('epoch-ms')).map(field => field.name);
    if (epoch.length) hints.push(`毫秒时间戳字段：${epoch.slice(0, 6).join('、')}，取数时需换算成日期。`);
    const iso = fields.filter(field => field.kinds.includes('iso-datetime')).length;
    const plain = fields.filter(field => field.kinds.includes('datetime')).length;
    if (iso && plain) hints.push('同表同时存在 “T” 分隔与空格分隔两种日期格式，按时间过滤时注意格式。');
    const sentinels = fields.filter(field => field.sentinels.length);
    if (sentinels.length) hints.push(`占位值：${sentinels.slice(0, 5).map(field => `${field.name}=${field.sentinels.join('/')}`).join('，')}，统计时通常要排除。`);
    if (fields.some(field => field.role === 'region' || field.role === 'office')) hints.push('区域 / 代表处字段是编码，名称需关联 common_data_rep 等公共表。');
    if (base?.review) hints.push(base.review);
    return hints;
}

function tableRef(config, scope, name) {
    return scope === 'app' ? client.ident(name) : `${client.ident(config.businessSchema)}.${client.ident(name)}`;
}

// ── 结构化查询 ───────────────────────────────────────
/**
 * 按字段白名单拼 SELECT：表名、字段名必须真实存在（来自 information_schema），运算符 / 聚合走白名单，值统一转义。
 * spec: { table, columns[], filters[{column, op, value}], groupBy[], metrics[{agg, column, as}], orderBy, order, limit, offset }
 */
function buildSelect(config, scope, spec, knownColumns) {
    const known = new Map(knownColumns.map(name => [name.toLowerCase(), name]));
    const col = name => {
        const actual = known.get(String(name || '').toLowerCase());
        if (!actual) throw client.dhError('DH_UNKNOWN_COLUMN', `表中没有字段 ${String(name).slice(0, 80)}`, { statusCode: 400 });
        return client.ident(actual);
    };
    const groupBy = (Array.isArray(spec.groupBy) ? spec.groupBy : []).slice(0, 8).map(col);
    const metrics = (Array.isArray(spec.metrics) ? spec.metrics : []).slice(0, 8).map((metric, index) => {
        const agg = AGGS[String(metric?.agg || '').toLowerCase()];
        if (!agg) throw client.dhError('DH_BAD_AGG', `不支持的聚合：${metric?.agg}`, { statusCode: 400 });
        const alias = client.ident(String(metric.as || `${String(metric.agg).toLowerCase()}_${metric.column || 'rows'}`).replace(/[^A-Za-z0-9_一-龥]/g, '_').slice(0, 60) || `value_${index}`);
        if (agg === 'COUNT' && (!metric.column || metric.column === '*')) return `COUNT(*) AS ${alias}`;
        return `${agg}(${String(metric.agg).toLowerCase() === 'count_distinct' ? 'DISTINCT ' : ''}${col(metric.column)}) AS ${alias}`;
    });
    const aggregated = groupBy.length || metrics.length;
    const selected = aggregated ? [...groupBy, ...metrics] : (Array.isArray(spec.columns) && spec.columns.length ? spec.columns.slice(0, 120).map(col) : ['*']);
    if (!selected.length) selected.push('COUNT(*) AS `rows`');
    const where = (Array.isArray(spec.filters) ? spec.filters : []).slice(0, 20).map(filter => {
        const op = OPS[String(filter?.op || '=').toLowerCase().trim()];
        if (!op) throw client.dhError('DH_BAD_OP', `不支持的运算符：${filter?.op}`, { statusCode: 400 });
        const target = col(filter.column);
        if (op === 'IS NULL' || op === 'IS NOT NULL') return `${target} ${op}`;
        if (op === 'IN' || op === 'NOT IN') {
            const list = (Array.isArray(filter.value) ? filter.value : String(filter.value ?? '').split(',')).map(item => (typeof item === 'string' ? item.trim() : item)).filter(item => item !== '').slice(0, 500);
            if (!list.length) throw client.dhError('DH_BAD_FILTER', `${filter.column} 的 IN 条件为空`, { statusCode: 400 });
            return `${target} ${op} (${list.map(client.quote).join(', ')})`;
        }
        if (op === 'BETWEEN') {
            const [from, to] = Array.isArray(filter.value) ? filter.value : String(filter.value ?? '').split(',').map(item => item.trim());
            if (from === undefined || to === undefined) throw client.dhError('DH_BAD_FILTER', `${filter.column} 的 BETWEEN 需要两个值`, { statusCode: 400 });
            return `${target} BETWEEN ${client.quote(from)} AND ${client.quote(to)}`;
        }
        return `${target} ${op} ${client.quote(filter.value)}`;
    });
    // 分组 / 聚合时只能按分组字段或聚合别名排序（否则 ONLY_FULL_GROUP_BY 下报错）；不合法时退回第一个聚合
    const aliases = metrics.map(item => item.slice(item.lastIndexOf(' AS ') + 4));
    let orderTarget = '';
    if (spec.orderBy && !aggregated) orderTarget = col(spec.orderBy);
    else if (aggregated) {
        const wanted = spec.orderBy ? [...aliases, ...groupBy].find(item => item.toLowerCase() === `\`${String(spec.orderBy).toLowerCase()}\``) : '';
        orderTarget = wanted || aliases[0] || '';
    }
    const limit = Math.min(config.maxRows, Math.max(1, Number(spec.limit) || 200));
    const offset = Math.max(0, Number(spec.offset) || 0);
    return [
        `SELECT ${selected.join(', ')} FROM ${tableRef(config, scope, spec.table)}`,
        where.length ? `WHERE ${where.join(' AND ')}` : '',
        groupBy.length ? `GROUP BY ${groupBy.join(', ')}` : '',
        orderTarget ? `ORDER BY ${orderTarget} ${String(spec.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'}` : '',
        `LIMIT ${limit}${offset ? ` OFFSET ${offset}` : ''}`
    ].filter(Boolean).join(' ');
}

async function columnNames(config, scope, table) {
    const result = await client.queryAll(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${client.quote(schemaOf(config, scope))} AND TABLE_NAME = ${client.quote(table)} ORDER BY ORDINAL_POSITION`, { scope, config });
    const names = result.rows.map(row => String(pick(row, 'name') || '')).filter(Boolean);
    if (!names.length) throw client.dhError('DH_TABLE_NOT_FOUND', `${schemaOf(config, scope)} 中没有表 ${table}`, { statusCode: 404 });
    return names;
}

/** 结构化查询：返回 { sql, rows, truncated, durationMs }；超过 1000 行时按 LIMIT/OFFSET 分页取齐。 */
async function queryTable(scope, spec = {}) {
    const config = await liveConfig();
    client.ident(spec.table);
    const sql = buildSelect(config, scope, spec, await columnNames(config, scope, spec.table));
    const limit = Math.min(config.maxRows, Math.max(1, Number(spec.limit) || 200));
    const result = limit <= client.PAGE_SIZE && !spec.offset
        ? await client.queryPage(sql, { scope, limit, config }).then(page => ({ rows: page.rows, truncated: false, durationMs: page.durationMs }))
        : await pagedByOffset(config, scope, sql, limit, Number(spec.offset) || 0);
    return { sql, ...result };
}

// buildSelect 已带 LIMIT：超过一页时拆成多段 LIMIT/OFFSET 取
async function pagedByOffset(config, scope, sql, limit, offset) {
    const base = sql.replace(/ LIMIT \d+( OFFSET \d+)?$/, '');
    const rows = [];
    const startedAt = Date.now();
    while (rows.length < limit) {
        const size = Math.min(client.PAGE_SIZE, limit - rows.length);
        const page = await client.queryPage(`${base} LIMIT ${size} OFFSET ${offset + rows.length}`, { scope, limit: size, config });
        rows.push(...page.rows);
        if (page.rows.length < size) break;
    }
    return { rows, truncated: rows.length >= limit, durationMs: Date.now() - startedAt };
}

/** 精确行数（大表可能较慢，按需调用）。filters 同结构化查询。 */
async function countRows(scope, table, filters = []) {
    const result = await queryTable(scope, { table, filters, metrics: [{ agg: 'count', as: 'row_count' }], limit: 1 });
    return { sql: result.sql, count: Number(Object.values(result.rows[0] || {})[0]) || 0, durationMs: result.durationMs };
}

module.exports = { listTables, describeTable, queryTable, countRows, buildSelect, saveNote, getNote, listNotes, invalidate, inferGrain, inferCategory, familyOf, profile, SEED_COUNT: seed.count };
