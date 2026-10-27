// 数字人基座 REST API 客户端：平台访问 NetCare 业务库与应用 schema 的唯一出入口。
// 对应参考工程 app/db.py 的 API-Q1~Q4，直接请求基座，不经过 FastAPI：
//   POST {apiBase}/query     业务库 {datasourceName, sql, limit}（只读）；应用 schema {datasourceId, schema, sql, limit}
//   POST {apiBase}/execute   应用 schema 写（INSERT / UPDATE / DELETE），带身份头
//   GET  {apiBase}/query/datasources               数据源列表（连通性检查）
//   GET  {apiBase}/query/find-table-datasource?table=  按表名反查业务库组
// 约束：单页最多 1000 行（自动 LIMIT/OFFSET 分页）；不走系统代理；基座自签证书默认不校验；禁止 DDL；业务库只读。
const http = require('http');
const https = require('https');
const configRepo = require('./config-repository');

const PAGE_SIZE = 1000;
const RAW_PREVIEW_CHARS = 4000;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const agents = new Map();

function dhError(code, message, extra = {}) {
    return Object.assign(new Error(message), { code, statusCode: extra.statusCode || 502, ...extra });
}

function agentFor(url, verifySsl) {
    const key = `${url.protocol}|${verifySsl ? 1 : 0}`;
    if (!agents.has(key)) {
        agents.set(key, url.protocol === 'https:'
            ? new https.Agent({ keepAlive: true, maxSockets: 20, rejectUnauthorized: Boolean(verifySsl) })
            : new http.Agent({ keepAlive: true, maxSockets: 20 }));
    }
    return agents.get(key);
}

// 身份头：线上由基座 sitecustomize 注入，平台直连时自己带上（参考工程 x-app-id / x-app-level）
function identityHeaders(config) {
    const headers = {};
    if (config.appUuid) headers['x-app-id'] = config.appUuid;
    if (config.appLevel) headers['x-app-level'] = config.appLevel;
    return headers;
}

/** 发一次 HTTP 请求，返回 { status, json, text, durationMs }；网络错误、超时抛 DH_NETWORK / DH_TIMEOUT。 */
function send(config, { method = 'GET', path, query, body, signal }) {
    const url = new URL(`${configRepo.apiBase(config)}${path}`);
    for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const lib = url.protocol === 'https:' ? https : http;
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const req = lib.request(url, {
            method,
            agent: agentFor(url, config.verifySsl),
            timeout: config.timeoutSec * 1000,
            headers: {
                Accept: 'application/json',
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
                ...identityHeaders(config)
            }
        }, res => {
            const chunks = [];
            let size = 0;
            res.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_RESPONSE_BYTES) {
                    req.destroy(dhError('DH_RESPONSE_TOO_LARGE', '基座返回的数据过大，请缩小查询范围'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = text ? JSON.parse(text) : null; } catch { json = null; }
                resolve({ status: res.statusCode, json, text, durationMs: Date.now() - startedAt });
            });
            res.on('error', reject);
        });
        const onAbort = () => req.destroy(dhError('DH_ABORTED', '请求已取消', { statusCode: 499 }));
        if (signal) {
            if (signal.aborted) return onAbort();
            signal.addEventListener('abort', onAbort, { once: true });
        }
        req.on('timeout', () => req.destroy(dhError('DH_TIMEOUT', `基座请求超时（${config.timeoutSec} 秒）`, { statusCode: 504 })));
        req.on('error', error => {
            if (error.code && String(error.code).startsWith('DH_')) return reject(error);
            const hint = error.code === 'ENOTFOUND' ? '（域名解析失败：请确认当前网络能访问内网基座）'
                : /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '') ? '（证书校验失败：基座为自签证书时请关闭「校验 SSL 证书」）' : '';
            reject(dhError('DH_NETWORK', `无法连接基座：${error.message}${hint}`, { cause: error.code }));
        });
        req.on('close', () => signal?.removeEventListener?.('abort', onAbort));
        if (payload) req.write(payload);
        req.end();
    });
}

const preview = value => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return String(text ?? '').slice(0, RAW_PREVIEW_CHARS);
};

// 基座响应结构未在文档中固定，按常见形态兼容：{code,message,data}、{success,data}、data.rows/records/list、直接数组；
// rows 为二维数组时按 columns 还原成对象。
function firstArray(json) {
    const data = json?.data;
    const candidates = [json, data, data?.rows, data?.records, data?.list, data?.data, data?.result, data?.items, json?.rows, json?.result, json?.records, json?.list];
    return candidates.find(Array.isArray) || null;
}

function columnNames(json) {
    const list = [json?.data?.columns, json?.columns, json?.data?.columnNames, json?.data?.fields].find(Array.isArray);
    return list ? list.map(item => (typeof item === 'string' ? item : item?.name || item?.label || item?.columnName || '')) : null;
}

function failureOf(response) {
    const { status, json, text } = response;
    const code = json?.code ?? json?.status;
    const businessFailed = json && (json.success === false
        || (code !== undefined && code !== null && !['0', '200', 'success', 'ok', 'SUCCESS', 'OK'].includes(String(code))));
    if (status >= 200 && status < 300 && !businessFailed) return null;
    const message = json?.message || json?.msg || json?.error || json?.detail || (typeof text === 'string' ? text.slice(0, 300) : '') || `HTTP ${status}`;
    return dhError('DH_BASE_ERROR', `基座返回错误：${typeof message === 'string' ? message : JSON.stringify(message)}`, { httpStatus: status, raw: preview(json ?? text) });
}

function parseRows(response) {
    const failure = failureOf(response);
    if (failure) throw failure;
    if (response.json === null) throw dhError('DH_BAD_RESPONSE', '基座返回的不是 JSON', { raw: preview(response.text) });
    const list = firstArray(response.json);
    if (!list) throw dhError('DH_BAD_RESPONSE', '没有在基座返回中找到结果行', { raw: preview(response.json) });
    const columns = columnNames(response.json);
    const rows = list.map(item => {
        if (Array.isArray(item) && columns) return Object.fromEntries(columns.map((name, index) => [name || `col_${index + 1}`, item[index]]));
        return item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item };
    });
    const total = Number(response.json?.total ?? response.json?.data?.total);
    return { rows, total: Number.isFinite(total) ? total : null };
}

function affectedOf(json) {
    const data = json?.data;
    const value = [data?.affectedRows, data?.affected_rows, data?.rowCount, data?.count, json?.affectedRows, json?.affected_rows, typeof data === 'number' ? data : undefined]
        .find(item => item !== undefined && item !== null && Number.isFinite(Number(item)));
    return value === undefined ? null : Number(value);
}

// ── SQL 守卫 ─────────────────────────────────────────
// 去掉字符串字面量与注释后再判断关键字，避免把值里的单词当成语句。
function skeleton(sql) {
    return String(sql || '')
        .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/`[^`]*`/g, '``')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(--|#)[^\n]*/g, ' ');
}

function singleStatement(sql) {
    const text = String(sql || '').trim().replace(/;\s*$/, '');
    if (!text) throw dhError('DH_SQL_EMPTY', 'SQL 不能为空', { statusCode: 400 });
    if (text.length > 20000) throw dhError('DH_SQL_TOO_LONG', 'SQL 过长', { statusCode: 400 });
    if (skeleton(text).includes(';')) throw dhError('DH_SQL_MULTI', '一次只能执行一条 SQL', { statusCode: 400 });
    return text;
}

const READ_START_RE = /^\s*\(?\s*(select|with|show|desc|describe|explain)\b/i;
const WRITE_WORD_RE = /\b(insert|update|delete|replace|merge|create|alter|drop|truncate|rename|grant|revoke|call|lock|unlock|load|handler|set|into\s+outfile|into\s+dumpfile|for\s+update)\b/i;
const DDL_WORD_RE = /\b(create|alter|drop|truncate|rename|grant|revoke|call|lock|unlock|load|handler)\b/i;

/** 只读 SQL：单条，SELECT / WITH / SHOW / DESC / EXPLAIN 开头，不含写入关键字。 */
function assertReadOnly(sql) {
    const text = singleStatement(sql);
    const bare = skeleton(text);
    if (!READ_START_RE.test(bare)) throw dhError('DH_SQL_NOT_READ', '只允许查询语句（SELECT / WITH / SHOW / DESC / EXPLAIN）', { statusCode: 400 });
    const word = WRITE_WORD_RE.exec(bare);
    if (word) throw dhError('DH_SQL_NOT_READ', `查询语句不能包含 ${word[1].toUpperCase()}`, { statusCode: 400 });
    return text;
}

/** 应用 schema 写 SQL：单条 INSERT / UPDATE / DELETE；UPDATE / DELETE 必须带 WHERE；禁止 DDL（基座也不支持）。 */
function assertAppWrite(sql) {
    const text = singleStatement(sql);
    const bare = skeleton(text);
    const kind = /^\s*(insert|update|delete)\b/i.exec(bare)?.[1]?.toLowerCase();
    if (!kind) throw dhError('DH_SQL_NOT_WRITE', '应用库写操作只支持 INSERT / UPDATE / DELETE', { statusCode: 400 });
    if (DDL_WORD_RE.test(bare)) throw dhError('DH_SQL_DDL', '基座 API 不支持建表/改表等 DDL，请交 DBA 执行', { statusCode: 400 });
    if (kind !== 'insert' && !/\bwhere\b/i.test(bare)) throw dhError('DH_SQL_NO_WHERE', `${kind.toUpperCase()} 必须带 WHERE 条件`, { statusCode: 400 });
    return { sql: text, kind };
}

function hasTopLevelLimit(sql) {
    // 只看最后一段（括号外）的 LIMIT，子查询里的 LIMIT 不算
    const bare = skeleton(sql);
    let depth = 0;
    let outer = '';
    for (const char of bare) {
        if (char === '(') depth += 1;
        else if (char === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0) outer += char;
    }
    return /\blimit\s+\d+/i.test(outer);
}

// ── 基座调用 ─────────────────────────────────────────
async function resolveConfig(config) {
    const resolved = config || await configRepo.getConfig();
    if (!resolved.enabled && !config) throw dhError('DH_DISABLED', '数字人对接未启用：请到「全局设置 › 频道对接 › 数字人」导入配置并启用', { statusCode: 409 });
    return resolved;
}

function scopeBody(config, scope) {
    if (scope === 'app') {
        if (!configRepo.appReady(config)) throw dhError('DH_APP_NOT_CONFIGURED', '应用库未配置：缺少 APP_DATASOURCE_ID 或 APP_SCHEMA', { statusCode: 409 });
        return { datasourceId: /^\d+$/.test(config.appDatasourceId) ? Number(config.appDatasourceId) : config.appDatasourceId, schema: config.appSchema };
    }
    return { datasourceName: config.businessDatasourceName };
}

/** 单页查询（≤1000 行）。scope：business（业务库，只读）| app（应用 schema）。 */
async function queryPage(sql, { scope = 'business', limit = PAGE_SIZE, config, signal, raw = false } = {}) {
    const resolved = await resolveConfig(config);
    const text = assertReadOnly(sql);
    const size = Math.min(PAGE_SIZE, Math.max(1, Number(limit) || PAGE_SIZE));
    const response = await send(resolved, { method: 'POST', path: '/query', body: { ...scopeBody(resolved, scope), sql: text, limit: size }, signal });
    const parsed = parseRows(response);
    return { ...parsed, durationMs: response.durationMs, ...(raw ? { raw: preview(response.json) } : {}) };
}

/**
 * 自动分页查询：SQL 自带顶层 LIMIT 时只取一页；否则追加 LIMIT/OFFSET 循环，直到不足一页或达到 maxRows。
 * 没有 ORDER BY 时各页顺序由数据库决定，跨页可能重复或遗漏，需要完整结果时请带 ORDER BY。
 */
async function queryAll(sql, { scope = 'business', maxRows, config, signal } = {}) {
    const resolved = await resolveConfig(config);
    const text = assertReadOnly(sql);
    const cap = Math.min(resolved.maxRows, Math.max(1, Number(maxRows) || resolved.maxRows));
    const startedAt = Date.now();
    if (hasTopLevelLimit(text) || !/^\s*\(?\s*(select|with)\b/i.test(skeleton(text))) {
        const page = await queryPage(text, { scope, config: resolved, signal });
        return { rows: page.rows.slice(0, cap), truncated: page.rows.length > cap, pages: 1, durationMs: Date.now() - startedAt };
    }
    const rows = [];
    let pages = 0;
    while (rows.length < cap) {
        const size = Math.min(PAGE_SIZE, cap - rows.length);
        const page = await queryPage(`${text} LIMIT ${size} OFFSET ${rows.length}`, { scope, limit: size, config: resolved, signal });
        pages += 1;
        rows.push(...page.rows);
        if (page.rows.length < size) return { rows, truncated: false, pages, durationMs: Date.now() - startedAt };
    }
    return { rows, truncated: true, pages, durationMs: Date.now() - startedAt };
}

/** 应用 schema 写入（INSERT / UPDATE / DELETE）。基座不回传自增 id，调用方按业务键反查。 */
async function executeApp(sql, { config, signal } = {}) {
    const resolved = await resolveConfig(config);
    const checked = assertAppWrite(sql);
    if (!resolved.appUuid) throw dhError('DH_APP_IDENTITY', '应用库写操作需要应用身份（APP_UUID）', { statusCode: 409 });
    const response = await send(resolved, { method: 'POST', path: '/execute', body: { ...scopeBody(resolved, 'app'), sql: checked.sql }, signal });
    const failure = failureOf(response);
    if (failure) throw failure;
    return { kind: checked.kind, affectedRows: affectedOf(response.json), durationMs: response.durationMs, raw: preview(response.json) };
}

async function listDatasources({ config, signal } = {}) {
    const resolved = await resolveConfig(config);
    const response = await send(resolved, { method: 'GET', path: '/query/datasources', signal });
    const failure = failureOf(response);
    if (failure) throw failure;
    return { items: firstArray(response.json) || [], durationMs: response.durationMs, raw: preview(response.json ?? response.text) };
}

async function findTableDatasource(table, { config, signal } = {}) {
    const resolved = await resolveConfig(config);
    const response = await send(resolved, { method: 'GET', path: '/query/find-table-datasource', query: { table }, signal });
    const failure = failureOf(response);
    if (failure) throw failure;
    return { data: response.json?.data ?? response.json, durationMs: response.durationMs };
}

/**
 * 连通性测试：数据源列表 → 业务库 SELECT 1 → 业务库表数 → 应用库 SELECT 1。每步独立记录，失败不影响后续步骤。
 * 用传入的（可能未保存的）配置执行，便于导入后先测再保存。
 */
async function testConnection(config, { signal } = {}) {
    const steps = [];
    const step = async (id, label, fn) => {
        const startedAt = Date.now();
        try {
            const detail = await fn();
            steps.push({ id, label, ok: true, durationMs: Date.now() - startedAt, ...detail });
        } catch (error) {
            steps.push({ id, label, ok: false, durationMs: Date.now() - startedAt, error: error.message, code: error.code || '', raw: error.raw || '' });
        }
    };
    const resolved = { ...config, enabled: true };
    await step('datasources', '数据源列表', async () => {
        const result = await listDatasources({ config: resolved, signal });
        return { summary: `返回 ${result.items.length} 个数据源`, raw: result.raw };
    });
    await step('business', '业务库查询', async () => {
        const result = await queryPage('SELECT 1 AS ok', { scope: 'business', limit: 1, config: resolved, signal, raw: true });
        return { summary: `SELECT 1 返回 ${result.rows.length} 行`, raw: result.raw };
    });
    await step('business-tables', '业务库表清单', async () => {
        const result = await queryPage(`SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ${quote(resolved.businessSchema)}`, { scope: 'business', limit: 1, config: resolved, signal });
        const first = result.rows[0] || {};
        return { summary: `${resolved.businessSchema} 库共有 ${Object.values(first)[0] ?? '?'} 张表` };
    });
    if (configRepo.appReady(resolved)) {
        await step('app', '应用库查询', async () => {
            const result = await queryPage('SELECT 1 AS ok', { scope: 'app', limit: 1, config: resolved, signal, raw: true });
            return { summary: `应用 schema ${resolved.appSchema} 可查询（${result.rows.length} 行）`, raw: result.raw };
        });
    } else {
        steps.push({ id: 'app', label: '应用库查询', ok: false, skipped: true, error: '未配置 APP_DATASOURCE_ID / APP_SCHEMA，已跳过' });
    }
    return { at: new Date().toISOString(), ok: steps.every(item => item.ok || item.skipped), steps };
}

// ── SQL 字面量 / 标识符 ──────────────────────────────
function quote(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? '1' : '0';
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function ident(name) {
    const text = String(name || '');
    if (!/^[A-Za-z0-9_一-龥$-]{1,128}$/.test(text) || /^\d/.test(text)) throw dhError('DH_BAD_IDENT', `不支持的表名或字段名：${text.slice(0, 80)}`, { statusCode: 400 });
    return `\`${text}\``;
}

module.exports = {
    PAGE_SIZE, send, parseRows, affectedOf, failureOf,
    assertReadOnly, assertAppWrite, hasTopLevelLimit,
    queryPage, queryAll, executeApp, listDatasources, findTableDatasource, testConnection,
    quote, ident, dhError
};
