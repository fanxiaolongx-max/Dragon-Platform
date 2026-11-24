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
const mappingColsCache = new Map();

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
    mappingColsCache.clear();
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
    operator: /^(t[12]_?operator(?:_code|_id)?|operator_code|carrier_code|hq_cust_category_code|top_cust_category_code|acctcust_hq_code|acctcust_branch_code|region_custcatg_code|subsidiary_custcatg_code|lv2_branch_custcatg_code|t[12]_?cust(?:_code)?)$/i,
    customer: /^(customer_number|cust_account_num|customer_code)$/i,
    bg: /^(bg|belongs_to_bg|bg_type_name)$/i
};

const OPERATOR_MAP_TABLES = ['cs_nc_comm_customer_d_list', 'cs_nc_comm_customer_d_list_dim', 'common_data_customer_dlvy_org'];
const REP_MAP_TABLES = ['common_data_rep'];
const COUNTRY_MAP_TABLES = ['common_data_customer_rel_country_relation'];
const OPERATOR_NAME_COL_RE = /(?:operator|carrier|hq_cust_category|top_cust_category|acctcust_hq|acctcust_branch|region_custcatg|subsidiary_custcatg|lv2_branch_custcatg|mergered_cust|cust_category).*name|^operator_cn$|^operator_en$/i;
const CUSTOMER_NAME_COL_RE = /(?:mergered_cust|customer|cust).*name/i;
const REP_NAME_COL_RE = /(?:region|rep_?office|office|rep).*name/i;
const OPAQUE_CODE_RE = /^(?:\d{3,}|[a-z]{0,3}\d{4,})$/i;
const IGNORE_CODE_RE = /^(?:others|unknown|snull|null|源为空|source is null|n\/a|empty|-999999)$/i;
const MAX_RESOLVE_CODES = 60;

// 运营商 / 客户 / 地代维表候选字段映射（运行时按 information_schema.COLUMNS 真实列名动态过滤，不猜不存在的列）
const OPERATOR_COL_SPECS = [
    { code: 'hq_cust_category_code', cn: ['hq_cust_category_cn_name'], en: ['hq_cust_category_en_name'] },
    { code: 'top_cust_category_code', cn: ['top_cust_category_cn_name'], en: ['top_cust_category_en_name'] },
    { code: 'acctcust_hq_code', cn: ['acctcust_hq_cn_name'], en: ['acctcust_hq_en_name'] },
    { code: 'acctcust_branch_code', cn: ['acctcust_branch_cn_name'], en: ['acctcust_branch_en_name'] },
    { code: 'region_custcatg_code', cn: ['region_custcatg_cn_name'], en: ['region_custcatg_en_name'] },
    { code: 'subsidiary_custcatg_code', cn: ['subsidiary_custcatg_cn_name'], en: ['subsidiary_custcatg_en_name'] },
    { code: 'lv2_branch_custcatg_code', cn: ['lv2_branch_custcatg_cn_name'], en: ['lv2_branch_custcatg_en_name'] },
];
const CUSTOMER_COL_SPECS = [
    { code: 'cust_account_num', cn: ['mergered_cust_name', 'cust_name', 'customer_name'], en: ['mergered_cust_en_name', 'cust_en_name', 'customer_en_name'], groupCn: ['hq_cust_category_cn_name'], groupEn: ['hq_cust_category_en_name'] },
    { code: 'customer_number', cn: ['mergered_cust_name', 'customer_name', 'cust_name'], en: ['mergered_cust_en_name', 'customer_en_name'], groupCn: ['hq_cust_category_cn_name'], groupEn: ['hq_cust_category_en_name'] },
];
const REP_COL_SPECS = [
    { code: 'dept_code', cn: ['rep_name_cn', 'rep_short_name_cn', 'dept_name_cn', 'region_name_cn', 'name_cn'], en: ['rep_name_en', 'rep_short_name_en', 'dept_name_en', 'region_name_en', 'name_en'] },
    { code: 'repoffice_code', cn: ['rep_name_cn', 'repoffice_name_cn', 'rep_short_name_cn'], en: ['rep_name_en', 'repoffice_name_en'] },
    { code: 'region_code', cn: ['region_name_cn', 'rep_name_cn'], en: ['region_name_en', 'rep_name_en'] },
];

/** 检查当前业务库实际存在且非空的公共编码映射表（复用表目录缓存；在线时只认库里真实存在的表） */
async function availableMappingTables(scope = 'business') {
    if (scope !== 'business') return { operator: [], rep: [], country: [] };
    try {
        const result = await listTables({ scope });
        const usable = new Set(
            (result.tables || [])
                .filter(t => !t.hidden && !t.empty && (result.live ? t.status === 'live' : t.status !== 'missing'))
                .map(t => String(t.name || '').toLowerCase())
        );
        return {
            operator: OPERATOR_MAP_TABLES.filter(t => usable.has(t)),
            rep: REP_MAP_TABLES.filter(t => usable.has(t)),
            country: COUNTRY_MAP_TABLES.filter(t => usable.has(t)),
        };
    } catch {
        return { operator: [], rep: [], country: [] };
    }
}

function collectOpaqueCodes(rows, colNames) {
    const codes = [];
    const seen = new Set();
    const limitRows = Math.min(rows.length, 200);
    for (let i = 0; i < limitRows && codes.length < MAX_RESOLVE_CODES; i += 1) {
        const row = rows[i];
        if (!row || typeof row !== 'object') continue;
        for (const col of colNames) {
            const v = String(row[col] ?? '').trim();
            if (!v || IGNORE_CODE_RE.test(v) || !OPAQUE_CODE_RE.test(v) || seen.has(v)) continue;
            seen.add(v);
            codes.push(v);
            if (codes.length >= MAX_RESOLVE_CODES) break;
        }
    }
    return codes;
}

const cleanLabel = (v) => {
    const s = String(v ?? '').trim();
    return s && !SENTINELS.has(s) && !IGNORE_CODE_RE.test(s) ? s : '';
};

function formatResolvedLabel({ cn, en, groupCn, groupEn }) {
    const main = cn && en && cn.toLowerCase() !== en.toLowerCase() ? `${cn} / ${en}` : (cn || en);
    const group = groupCn && groupEn && groupCn.toLowerCase() !== groupEn.toLowerCase() ? `${groupCn} / ${groupEn}` : (groupCn || groupEn);
    if (main && group && !main.includes(groupCn || group)) return `${main}（${group}）`;
    return main || group || '';
}

async function getMappingTableColumns(config, scope, tableName) {
    const key = `${cacheKey(config, scope)}|cols|${tableName}`;
    const cached = mappingColsCache.get(key);
    if (cached && Date.now() - cached.at <= CACHE_TTL_MS) return cached.cols;
    const cols = await columnNames(config, scope, tableName);
    mappingColsCache.set(key, { at: Date.now(), cols });
    return cols;
}

function activeSpecsForTable(cols, specs, preferredCodeCols = []) {
    const colMap = new Map(cols.map(c => [String(c).toLowerCase(), String(c)]));
    const pickFirst = (list = []) => list.map(n => colMap.get(n.toLowerCase())).find(Boolean) || '';
    const prefSet = new Set(preferredCodeCols.map(c => String(c).toLowerCase()));
    const matched = [];
    for (const spec of specs) {
        const code = colMap.get(spec.code.toLowerCase());
        if (!code) continue;
        const cn = pickFirst(spec.cn);
        const en = pickFirst(spec.en);
        const groupCn = pickFirst(spec.groupCn);
        const groupEn = pickFirst(spec.groupEn);
        if (!cn && !en && !groupCn && !groupEn) continue;
        matched.push({ code, cn, en, groupCn, groupEn, preferred: prefSet.has(spec.code.toLowerCase()) });
    }
    return matched.sort((a, b) => Number(b.preferred) - Number(a.preferred));
}

async function lookupCodesInTable({ tableName, codes, specs, preferredCodeCols, getCols, runQuery, tableSqlRef }) {
    const cols = await getCols(tableName).catch(() => []);
    if (!cols.length) return { resolved: new Map(), matchedCol: '', verifiedCols: [] };
    const active = activeSpecsForTable(cols, specs, preferredCodeCols);
    const verifiedCols = [...new Set(active.flatMap(s => [s.code, s.cn, s.en, s.groupCn, s.groupEn].filter(Boolean)))].slice(0, 10);
    if (!active.length) return { resolved: new Map(), matchedCol: '', verifiedCols };

    const resolved = new Map();
    const pending = new Set(codes);
    const matchedCols = [];
    for (const spec of active.slice(0, 3)) {
        if (!pending.size) break;
        const targetCodes = [...pending];
        const selectParts = [
            `${client.ident(spec.code)} AS \`__code\``,
            ...(spec.cn ? [`${client.ident(spec.cn)} AS \`__cn\``] : []),
            ...(spec.en ? [`${client.ident(spec.en)} AS \`__en\``] : []),
            ...(spec.groupCn ? [`${client.ident(spec.groupCn)} AS \`__gcn\``] : []),
            ...(spec.groupEn ? [`${client.ident(spec.groupEn)} AS \`__gen\``] : []),
        ];
        const sql = `SELECT DISTINCT ${selectParts.join(', ')} FROM ${tableSqlRef(tableName)} WHERE ${client.ident(spec.code)} IN (${targetCodes.map(client.quote).join(', ')}) LIMIT ${Math.min(250, Math.max(50, targetCodes.length * 4))}`;
        const rows = await runQuery(sql).catch(() => []);
        let hit = false;
        for (const r of rows) {
            const code = String(pick(r, '__code') ?? '').trim();
            if (!code || !pending.has(code)) continue;
            const label = formatResolvedLabel({
                cn: cleanLabel(pick(r, '__cn')),
                en: cleanLabel(pick(r, '__en')),
                groupCn: cleanLabel(pick(r, '__gcn')),
                groupEn: cleanLabel(pick(r, '__gen')),
            });
            if (!label) continue;
            resolved.set(code, label);
            pending.delete(code);
            hit = true;
        }
        if (hit) matchedCols.push(spec.code);
    }
    return { resolved, matchedCol: matchedCols.join('/'), verifiedCols };
}

/** 查询结果里出现纯运营商/地代编码列但缺名称列时，仅在对应映射表确实存在时给出自动提示 */
function codeMappingHintForRows(rows, mapTables, verifiedColsByTable = null) {
    if (!Array.isArray(rows) || !rows.length || !mapTables) return '';
    const cols = Object.keys(rows[0] || {});
    if (!cols.length) return '';
    const hints = [];

    const opCodeCols = cols.filter((c) => ROLE_RULES.operator.test(c) && collectOpaqueCodes(rows, [c]).length > 0);
    const hasOpNameCol = cols.some((c) => OPERATOR_NAME_COL_RE.test(c) || /^(?:operator_name|carrier_name|cust_name|customer_name|name_cn|name_en)$/i.test(c));
    if (opCodeCols.length && !hasOpNameCol && Array.isArray(mapTables.operator) && mapTables.operator.length) {
        const primary = mapTables.operator[0];
        const fallback = mapTables.operator.slice(1);
        const verified = verifiedColsByTable?.[primary];
        const colTip = verified?.length
            ? `已核实可用列：${verified.join('、')}`
            : 't1_operator_code 可直接按 hq_cust_category_code 匹配 hq_cust_category_cn_name / hq_cust_category_en_name，客户明细可按 customer_number = cust_account_num 关联';
        hints.push(`提示：结果中的 ${opCodeCols.join('、')} 是纯运营商编码，用户不易辨认；当前库存在运营商/客户映射表 ${primary}${fallback.length ? `（备选 ${fallback.join('、')}）` : ''}（${colTip}），请用轻量 IN 查询把编码翻译成可读名称再展示（例如「名称（编码）」），不要只输出纯编码。`);
    }

    const repCodeCols = cols.filter((c) => (ROLE_RULES.region.test(c) || ROLE_RULES.office.test(c)) && collectOpaqueCodes(rows, [c]).length > 0);
    const hasRepNameCol = cols.some((c) => REP_NAME_COL_RE.test(c));
    if (repCodeCols.length && !hasRepNameCol && Array.isArray(mapTables.rep) && mapTables.rep.length) {
        const repTable = mapTables.rep[0];
        const verified = verifiedColsByTable?.[repTable];
        const colTip = verified?.length ? `已核实可用列：${verified.join('、')}` : 'dept_code 映射 rep_name_cn / rep_short_name_cn / rep_name_en';
        hints.push(`提示：结果中的 ${repCodeCols.join('、')} 是地区部/代表处编码；当前库存在 ${repTable}（${colTip}），请补全可读名称后再展示。`);
    }
    return hints.join('\n');
}

/**
 * 服务端实时编码解析（每次按当次结果中的编码实时 IN 查维表，不缓存名称值以保证始终最新；仅缓存维表列名 10 分钟）。
 * - 命中映射：直接把「编码 → 中文/英文可读名称」附在工具结果末尾，模型零额外 SQL 即可输出可读名称；
 * - 未命中或维表不含直接编码列：自动退回携带已核实列名的轻量提示；
 * - 维表不存在或查询异常：静默跳过，绝不影响主查询。
 */
async function resolveCodeMappingsForRows(rows, { scope = 'business', mapTables = null, getCols = null, runQuery = null } = {}) {
    if (scope !== 'business' || !Array.isArray(rows) || !rows.length) return '';
    try {
        const cols = Object.keys(rows[0] || {});
        if (!cols.length) return '';

        const opCodeCols = cols.filter((c) => ROLE_RULES.operator.test(c));
        const hasOpNameCol = cols.some((c) => OPERATOR_NAME_COL_RE.test(c) || /^(?:operator_name|carrier_name|cust_name|customer_name|name_cn|name_en)$/i.test(c));
        const opCodes = !hasOpNameCol && opCodeCols.length ? collectOpaqueCodes(rows, opCodeCols) : [];

        const custCodeCols = cols.filter((c) => ROLE_RULES.customer.test(c));
        const hasCustNameCol = cols.some((c) => CUSTOMER_NAME_COL_RE.test(c));
        const custCodes = !hasCustNameCol && custCodeCols.length ? collectOpaqueCodes(rows, custCodeCols) : [];

        const repCodeCols = cols.filter((c) => ROLE_RULES.region.test(c) || ROLE_RULES.office.test(c));
        const hasRepNameCol = cols.some((c) => REP_NAME_COL_RE.test(c));
        const repCodes = !hasRepNameCol && repCodeCols.length ? collectOpaqueCodes(rows, repCodeCols) : [];

        if (!opCodes.length && !custCodes.length && !repCodes.length) return '';

        const tables = mapTables || await availableMappingTables(scope);
        const needOp = opCodes.length > 0 && Array.isArray(tables?.operator) && tables.operator.length > 0;
        const needCust = custCodes.length > 0 && Array.isArray(tables?.operator) && tables.operator.length > 0;
        const needRep = repCodes.length > 0 && Array.isArray(tables?.rep) && tables.rep.length > 0;
        if (!needOp && !needCust && !needRep) return '';

        let config = null;
        if (!getCols || !runQuery) {
            config = await liveConfig().catch(() => null);
            if (!config) return codeMappingHintForRows(rows, tables);
        }
        const fetchCols = getCols || ((t) => getMappingTableColumns(config, scope, t));
        const execQuery = runQuery || ((sql) => client.queryPage(sql, { scope, limit: 250, config }).then(r => r.rows || []));
        const tableSqlRef = (t) => (config ? tableRef(config, scope, t) : client.ident(t));

        const sections = [];
        const verifiedColsByTable = {};

        const renderSection = (title, source, codes, resolved, verifiedCols) => {
            if (!resolved.size) return false;
            const lines = [`【实时编码名称映射（${title}，来源 ${source}；已实时查出，展示时请直接使用可读名称如「名称（编码）」，无需再重复查维表或 describe）】`];
            for (const code of codes) {
                if (resolved.has(code)) lines.push(`- ${code}: ${resolved.get(code)}`);
            }
            const missing = codes.filter(c => !resolved.has(c));
            if (missing.length) {
                lines.push(`注：编码 ${missing.slice(0, 15).join('、')}${missing.length > 15 ? ` 等 ${missing.length} 个` : ''} 未在 ${source} 命中${verifiedCols.length ? `（该表可用列：${verifiedCols.join('、')}）` : ''}。`);
            }
            sections.push(lines.join('\n'));
            return true;
        };

        if (needOp) {
            const primary = tables.operator[0];
            const res = await lookupCodesInTable({
                tableName: primary, codes: opCodes, specs: OPERATOR_COL_SPECS, preferredCodeCols: opCodeCols,
                getCols: fetchCols, runQuery: execQuery, tableSqlRef,
            });
            if (res.verifiedCols.length) verifiedColsByTable[primary] = res.verifiedCols;
            if (!renderSection(`运营商 ${opCodeCols.join('/')}`, `${primary}.${res.matchedCol || 'hq_cust_category_code'}`, opCodes, res.resolved, res.verifiedCols)) {
                const fallbackHint = codeMappingHintForRows(rows, { operator: tables.operator, rep: [], country: [] }, verifiedColsByTable);
                if (fallbackHint) sections.push(fallbackHint);
            }
        }

        if (needCust) {
            const primary = tables.operator[0];
            const res = await lookupCodesInTable({
                tableName: primary, codes: custCodes, specs: CUSTOMER_COL_SPECS, preferredCodeCols: custCodeCols,
                getCols: fetchCols, runQuery: execQuery, tableSqlRef,
            });
            if (res.verifiedCols.length) verifiedColsByTable[primary] = res.verifiedCols;
            renderSection(`客户 ${custCodeCols.join('/')}`, `${primary}.${res.matchedCol || 'cust_account_num'}`, custCodes, res.resolved, res.verifiedCols);
        }

        if (needRep) {
            const repTable = tables.rep[0];
            const res = await lookupCodesInTable({
                tableName: repTable, codes: repCodes, specs: REP_COL_SPECS, preferredCodeCols: repCodeCols,
                getCols: fetchCols, runQuery: execQuery, tableSqlRef,
            });
            if (res.verifiedCols.length) verifiedColsByTable[repTable] = res.verifiedCols;
            if (!renderSection(`地区部/代表处 ${repCodeCols.join('/')}`, `${repTable}.${res.matchedCol || 'dept_code'}`, repCodes, res.resolved, res.verifiedCols)) {
                const fallbackHint = codeMappingHintForRows(rows, { operator: [], rep: tables.rep, country: [] }, verifiedColsByTable);
                if (fallbackHint) sections.push(fallbackHint);
            }
        }

        return sections.join('\n');
    } catch {
        return '';
    }
}

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
    const mapTables = scope === 'business' ? await availableMappingTables('business') : null;
    const suggest = role => fields.find(field => field.role === role)?.name || '';
    return {
        scope, schema, name, note, seed: base,
        columns: fields,
        sample: sample.rows,
        suggestions: { timeField: suggest('time'), regionField: suggest('region'), officeField: suggest('office'), operatorField: suggest('operator') },
        hints: hintsOf(name, fields, base, mapTables)
    };
}

function hintsOf(name, fields, base, mapTables = null) {
    const hints = [];
    const lowerName = String(name || '').toLowerCase();
    if (/_\d{1,2}$/.test(name)) hints.push('分区表：同族 _0/_1（或 _01~_12）可能是轮换表或分区，合并取数前先确认哪张是当前有效数据，避免重复计数。');
    const epoch = fields.filter(field => field.kinds.includes('epoch-ms')).map(field => field.name);
    if (epoch.length) hints.push(`毫秒时间戳字段：${epoch.slice(0, 6).join('、')}，取数时需换算成日期。`);
    const iso = fields.filter(field => field.kinds.includes('iso-datetime')).length;
    const plain = fields.filter(field => field.kinds.includes('datetime')).length;
    if (iso && plain) hints.push('同表同时存在 “T” 分隔与空格分隔两种日期格式，按时间过滤时注意格式。');
    const sentinels = fields.filter(field => field.sentinels.length);
    if (sentinels.length) hints.push(`占位值：${sentinels.slice(0, 5).map(field => `${field.name}=${field.sentinels.join('/')}`).join('，')}，统计时通常要排除。`);
    const repFields = fields.filter(field => field.role === 'region' || field.role === 'office').map(field => field.name);
    const hasRepName = fields.some(field => REP_NAME_COL_RE.test(field.name));
    if (repFields.length && !hasRepName && !REP_MAP_TABLES.includes(lowerName)) {
        const repTable = mapTables?.rep?.[0] || (mapTables === null ? 'common_data_rep' : '');
        if (repTable) hints.push(`区域 / 代表处字段（${repFields.join('、')}）是编码，展示前请关联 ${repTable}（dept_code 映射中英文名称）。`);
    }
    const opFields = fields.filter(field => field.role === 'operator').map(field => field.name);
    const custFields = fields.filter(field => field.role === 'customer').map(field => field.name);
    const hasOpName = fields.some(field => OPERATOR_NAME_COL_RE.test(field.name));
    if (opFields.length && !hasOpName && !OPERATOR_MAP_TABLES.includes(lowerName)) {
        const availOp = mapTables ? (mapTables.operator || []) : OPERATOR_MAP_TABLES;
        if (availOp.length) {
            const primary = availOp[0];
            const fallback = availOp.slice(1);
            const joinHint = custFields.length
                ? `t1_operator_code 直接对应 ${primary}.hq_cust_category_code（取 hq_cust_category_cn_name / hq_cust_category_en_name，毫秒级单表 IN 查）；客户明细才需 ${custFields[0]} = cust_account_num`
                : `可直接按 ${primary}.hq_cust_category_code 查 hq_cust_category_cn_name / hq_cust_category_en_name`;
            hints.push(`运营商字段（${opFields.join('、')}）是纯编码，用户看不懂数字代码；按运营商维度统计后查询工具会自动实时附带中英文名称映射（来源 ${primary}${fallback.length ? `，备选 ${fallback.join('、')}` : ''}，${joinHint}），直接使用映射以“名称（编码）”展示即可，无需大表 JOIN 或重复 describe；Others 仅在用户明确要求拆分时再按 customer_number 下钻。`);
        }
    }
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

module.exports = { listTables, describeTable, queryTable, countRows, buildSelect, saveNote, getNote, listNotes, invalidate, inferGrain, inferCategory, familyOf, profile, hintsOf, availableMappingTables, codeMappingHintForRows, resolveCodeMappingsForRows, SEED_COUNT: seed.count };
