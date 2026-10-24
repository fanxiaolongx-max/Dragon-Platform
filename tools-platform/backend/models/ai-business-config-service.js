const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { getDataDir } = require('./store');
const { getReportDataDir } = require('./report-store');
const { getTenantId } = require('./tenant-context');

const getToolsDbPath = () => path.join(getDataDir(), 'tools.db');
const getReportDbPath = () => path.join(getReportDataDir(), 'report.db');
const MAX_RESULT_CONTENT = 5200;
const MAX_CANDIDATES = 900;
const CACHE_TTL_MS = 30 * 1000;

const STOP_TERMS = new Set([
    '这个', '那个', '怎么', '什么', '如何', '可以', '所有', '相关', '配置', '规则', '项目', '帮我', '一下',
    'the', 'and', 'for', 'with', 'this', 'that', 'config', 'configuration'
]);

const SCRIPT_INTENT_RE = /脚本|宏代码|console\s*code|uiv|ui\.vision|数据抓取|生成器|cpc|nid|adapter|login\s*probe/i;
const METRIC_INTENT_RE = /指标|子指标|目标|权重|达标|计分|分类|分组|sla|custommetrics|比例计分|超额得分|月度规则/i;
const PLATFORM_CONFIG_INTENT_RE = /平台配置|大屏|bigscreen|welink|月报标题|联系人|owner|运营配置/i;
const DICTIONARY_INTENT_RE = /翻译|英文|中文|双语|字典|i18n/i;
const TOOL_INTENT_RE = /自定义工具|html\s*工具|内置工具|自带工具|工具目录|custom\s*tool/i;
const FULL_TARGET_LIST_RE = /(?:全部|完整|所有|58\s*条).{0,16}(?:指标)?(?:目标|预警|规则).{0,10}(?:规则|配置|明细|列表|展开|列出)?|展开.{0,10}(?:全部|所有).{0,16}(?:目标|指标|规则)|58\s*条.{0,16}(?:规则|目标)/i;
const GENERAL_TARGET_QUERY_RE = /指标(?:的)?目标(?:值|规则|配置)?(?:都|分别|各自)?(?:是|为)?(?:多少|什么|哪些)|(?:各(?:个|项)?|每(?:个|项))指标.{0,8}目标|\b(?:all|each|every)\b.{0,35}\b(?:metric|indicator)s?\b.{0,25}\b(?:target|goal)s?\b|\b(?:target|goal)(?:\s+values?)?s?\b.{0,25}\b(?:all|each|every)\b.{0,20}\b(?:metric|indicator)s?\b/i;
const TERM_ALIASES = [
    [/催办/, ['expedite', 'expeditetemplate', 'expediteignorekeywords']],
    [/人工调整|手工调整|加减分/, ['manualadjust', 'manualadjustitems', 'manualadjustautofill']],
    [/字段映射|列配置|表格配置/, ['statusfields', 'columnwidths', 'visibleheaders']],
    [/比例计分/, ['proportionalscoring']],
    [/超额得分|超额计分/, ['overachievementscoring']],
    [/自定义指标|子指标/, ['custommetrics', 'submetrics']]
];

let cache = { signature: '', expiresAt: 0, documents: [], status: null };

function safeJson(value, fallback = null) {
    try {
        const parsed = JSON.parse(value || '');
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (_error) {
        return fallback;
    }
}

function redactSensitiveText(value) {
    return String(value || '')
        .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[PRIVATE KEY REDACTED]')
        .replace(/((?:api[_-]?key|password|passwd|secret|token|authorization)\s*[:=]\s*["'])([^"'\n]{6,})(["'])/gi, '$1[REDACTED]$3')
        .replace(/(bearer\s+)[a-z0-9._~+/-]{12,}/gi, '$1[REDACTED]');
}

function databaseSignature(filePath) {
    return [filePath, `${filePath}-wal`].map(candidate => {
        try {
            const stat = fs.statSync(candidate);
            return `${stat.size}:${Math.round(stat.mtimeMs)}`;
        } catch (_error) {
            return 'missing';
        }
    }).join(':');
}

function currentSignature() {
    return `${getTenantId()}|${getToolsDbPath()}|${databaseSignature(getToolsDbPath())}|${getReportDbPath()}|${databaseSignature(getReportDbPath())}`;
}

function openReadOnlyDatabase(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) return resolve(null);
        const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, error => error ? reject(error) : resolve(db));
    });
}

function dbAll(db, sql, params = []) {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
        db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
    });
}

async function dbAllOptional(db, sql, params = []) {
    try { return await dbAll(db, sql, params); }
    catch (error) {
        if (/no such table/i.test(String(error?.message || ''))) return [];
        throw error;
    }
}

function closeDatabase(db) {
    return new Promise(resolve => db ? db.close(() => resolve()) : resolve());
}

function extractTerms(question) {
    const text = String(question || '').toLowerCase();
    const terms = new Set();
    for (const token of text.match(/[a-z0-9_./%-]{2,}/g) || []) {
        if (!STOP_TERMS.has(token)) terms.add(token.slice(0, 64));
    }
    for (const sequence of text.match(/[\u3400-\u9fff]{2,}/g) || []) {
        if (sequence.length <= 14 && !STOP_TERMS.has(sequence)) terms.add(sequence);
        for (let width = 2; width <= Math.min(5, sequence.length); width += 1) {
            for (let index = 0; index <= sequence.length - width; index += 1) {
                const token = sequence.slice(index, index + width);
                if (!STOP_TERMS.has(token)) terms.add(token);
            }
        }
    }
    TERM_ALIASES.forEach(([pattern, aliases]) => {
        if (pattern.test(text)) aliases.forEach(alias => terms.add(alias));
    });
    // Chinese questions generate many overlapping n-grams. Keep enough terms so a
    // short but decisive metric name (for example “整改”) is not discarded by
    // longer conversational phrases such as “每个月要求的目标值是多少”.
    return [...terms].sort((a, b) => b.length - a.length).slice(0, 64);
}

function countOccurrences(text, term) {
    if (!term) return 0;
    let count = 0;
    let cursor = 0;
    while ((cursor = text.indexOf(term, cursor)) >= 0 && count < 10) {
        count += 1;
        cursor += term.length;
    }
    return count;
}

function compactJson(value, maxChars = 12000) {
    const json = JSON.stringify(value, null, 2);
    return redactSensitiveText(json.length > maxChars ? `${json.slice(0, maxChars)}\n…[truncated]` : json);
}

function relevantExcerpt(content, terms, maxChars = MAX_RESULT_CONTENT) {
    const safe = redactSensitiveText(content);
    if (safe.length <= maxChars) return safe;
    const lower = safe.toLowerCase();
    let bestIndex = -1;
    for (const term of terms) {
        const index = lower.indexOf(term);
        if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index;
    }
    if (bestIndex < 0) return `${safe.slice(0, maxChars)}\n…[truncated]`;
    const start = Math.max(0, bestIndex - Math.floor(maxChars * 0.28));
    const end = Math.min(safe.length, start + maxChars);
    return `${start > 0 ? '…\n' : ''}${safe.slice(start, end)}${end < safe.length ? '\n…[truncated]' : ''}`;
}

function makeDocument({ kind, source, title, updatedAt, content, keywords = '' }) {
    const safeContent = redactSensitiveText(content);
    return {
        kind,
        source,
        title: String(title || source),
        updatedAt: updatedAt || null,
        content: safeContent,
        searchText: `${title || ''}\n${source}\n${keywords}\n${safeContent}`.toLowerCase()
    };
}

function buildScriptDocuments(rows, categoryRows = []) {
    const documents = [];
    const catalog = [];
    rows.forEach(row => {
        const payload = safeJson(row.payload_json, {}) || {};
        const name = payload.name || row.name || row.id;
        const category = payload.category || row.category || '未分类';
        catalog.push(`${name}（${category}）`);
        const metadata = {
            id: row.id,
            name,
            category,
            url: payload.url || row.url || '',
            openUrl: payload.openUrl || '',
            generatorType: payload.generatorType || '',
            originalFileName: payload.originalFileName || '',
            configOptions: payload.configOptions || null,
            adapterConfig: payload.adapterConfig || null,
            loginProbeConfig: payload.loginProbeConfig || null
        };
        const codeParts = [payload.code, payload.consoleCode, typeof payload.payload === 'string' ? payload.payload : '']
            .filter(Boolean)
            .join('\n\n');
        documents.push(makeDocument({
            kind: 'uiv-script',
            source: `backend/data/tools.db:uiv_scripts#${row.id}`,
            title: `UIVF12 脚本：${name}`,
            updatedAt: row.updated_at || payload.updatedAt || null,
            keywords: `${category} ${payload.generatorType || ''}`,
            content: `脚本元数据：\n${compactJson(metadata, 5000)}${codeParts ? `\n\n脚本正文：\n${codeParts}` : ''}`
        }));
    });
    documents.push(makeDocument({
        kind: 'uiv-catalog',
        source: 'backend/data/tools.db:uiv_scripts',
        title: `UIVF12 脚本目录（${rows.length} 条）`,
        updatedAt: rows.map(row => row.updated_at).filter(Boolean).sort().pop() || null,
        content: `脚本分类：${categoryRows.map(row => row.name).join('、') || '无'}\n\n脚本：\n${catalog.join('\n')}`
    }));
    return documents;
}

function buildToolRegistryDocuments(rows) {
    const documents = rows.map(row => makeDocument({
        kind: 'tool-registry',
        source: `backend/data/tools.db:custom_tools#${row.slug}`,
        title: `HTML 工具：${row.name || row.slug}`,
        updatedAt: row.updated_at,
        keywords: `${row.slug} ${row.href || ''} ${row.tags_json || ''}`,
        content: compactJson({
            slug: row.slug,
            name: row.name,
            description: row.description,
            tags: safeJson(row.tags_json, []),
            href: row.href,
            filePath: row.file_path,
            publicAccess: Number(row.public_access || 0) === 1
        })
    }));
    if (rows.length) {
        documents.push(makeDocument({
            kind: 'tool-catalog',
            source: 'backend/data/tools.db:custom_tools',
            title: `HTML 工具注册目录（${rows.length} 个）`,
            updatedAt: rows.map(row => row.updated_at).filter(Boolean).sort().pop() || null,
            content: rows.map(row => `${row.name || row.slug} · ${row.slug} · ${row.public_access ? '公开' : '登录后访问'} · ${row.href || ''}`).join('\n')
        }));
    }
    return documents;
}

function buildMetricDocuments({ targets, groups, groupItems, prefs, categories, dictionaries }) {
    const documents = [];
    const groupCatalog = new Map(groups.map(row => [row.id, []]));
    const customMetricCatalog = [];
    groupItems.forEach(row => groupCatalog.get(row.group_id)?.push(row.item_name));
    groups.forEach(row => {
        documents.push(makeDocument({
            kind: 'metric-group',
            source: `backend/data/tools.db:sla_groups#${row.group_key}`,
            title: `指标分类：${row.name}`,
            updatedAt: row.updated_at,
            content: `分类键：${row.group_key}\n排序：${row.sort_order}\n指标：\n${(groupCatalog.get(row.id) || []).join('\n')}`
        }));
    });
    targets.forEach(row => {
        const extra = safeJson(row.extra_config_json, {}) || {};
        documents.push(makeDocument({
            kind: 'metric-target',
            source: `backend/data/tools.db:sla_targets#${row.target_key}`,
            title: `指标目标规则：${row.label || row.target_key}`,
            updatedAt: row.updated_at,
            keywords: `${row.target_key} ${row.target_type || ''}`,
            content: compactJson({
                targetKey: row.target_key,
                label: row.label,
                condition: row.target_type,
                weight: row.weight,
                autoFill: row.auto_fill === null ? null : row.auto_fill === 1,
                isPercent: row.is_percent === null ? null : row.is_percent === 1,
                exceedBy: row.exceed_by,
                bonus: row.bonus,
                monthlyAndCategoryRules: extra
            })
        }));
    });
    const allTargetRules = targets.map((row, index) => {
        const extra = safeJson(row.extra_config_json, {}) || {};
        const months = {};
        const extendedRules = {};
        Object.entries(extra).forEach(([key, value]) => {
            if (/^(?:[1-9]|1[0-2])$/.test(key)) months[key] = value;
            else extendedRules[key] = value;
        });
        return JSON.stringify({
            no: index + 1,
            record: row.target_key,
            label: row.label || row.target_key,
            condition: row.target_type,
            weight: row.weight,
            isPercent: row.is_percent === null ? null : row.is_percent === 1,
            autoFill: row.auto_fill === null ? null : row.auto_fill === 1,
            exceedBy: row.exceed_by,
            bonus: row.bonus,
            months,
            extendedRules,
            updatedAt: row.updated_at
        });
    });
    documents.push(makeDocument({
        kind: 'metric-target-all',
        source: 'backend/data/tools.db:sla_targets#all',
        title: `全部指标目标规则明细（${targets.length} 条）`,
        updatedAt: targets.map(row => row.updated_at).filter(Boolean).sort().pop() || null,
        keywords: '全部 完整 所有 展开 58条 指标 目标 预警 规则 明细',
        content: `记录总数：${targets.length}\n字段说明：months 为 1–12 月当前目标，缺失月份表示未配置；extendedRules 为客户群目标、比例计分等扩展规则。\n${allTargetRules.join('\n')}`
    }));
    prefs.forEach(row => {
        const payload = safeJson(row.payload_json, null);
        if (payload === null) return;
        const relatedConfig = Array.isArray(payload)
            ? payload
            : payload && typeof payload === 'object'
                ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'customMetrics'))
                : payload;
        const hasRelatedConfig = Array.isArray(relatedConfig)
            ? relatedConfig.length > 0
            : relatedConfig && typeof relatedConfig === 'object'
                ? Object.keys(relatedConfig).length > 0
                : relatedConfig !== '' && relatedConfig !== null && relatedConfig !== undefined;
        if (hasRelatedConfig) {
            documents.push(makeDocument({
                kind: 'sla-pref',
                source: `backend/data/tools.db:sla_prefs#${row.pref_key}`,
                title: `SLA 运营配置：${row.pref_key}`,
                updatedAt: row.updated_at,
                keywords: row.pref_kind,
                content: compactJson(relatedConfig, 10000)
            }));
        }
        (Array.isArray(payload.customMetrics) ? payload.customMetrics : []).forEach((metric, index) => {
            if (!metric || !metric.label) return;
            customMetricCatalog.push({
                label: metric.label,
                subMetrics: (Array.isArray(metric.subMetrics) ? metric.subMetrics : []).map(item => ({
                    category: item?.category || '',
                    label: item?.label || '',
                    sourceField: item?.colZ || '',
                    sourceValue: item?.valY || ''
                }))
            });
            documents.push(makeDocument({
                kind: 'custom-metric',
                source: `backend/data/tools.db:sla_prefs#${row.pref_key}.customMetrics[${index}]`,
                title: `自定义指标：${metric.label}`,
                updatedAt: row.updated_at,
                keywords: `${row.pref_key} ${(metric.subMetrics || []).map(item => item?.category || item?.label || '').join(' ')}`,
                content: compactJson(metric)
            }));
        });
    });
    documents.push(makeDocument({
        kind: 'metric-catalog',
        source: 'backend/data/tools.db:sla_groups,sla_group_items,sla_targets,sla_prefs,sla_categories',
        title: '当前指标规则配置总览',
        updatedAt: [...targets, ...groups, ...prefs].map(row => row.updated_at).filter(Boolean).sort().pop() || null,
        content: compactJson({
            categories: categories.map(row => row.name),
            groups: groups.map(row => ({
                name: row.name,
                key: row.group_key,
                metrics: groupCatalog.get(row.id) || []
            })),
            targetRuleCount: targets.length,
            customMetricCount: customMetricCatalog.length,
            customMetrics: customMetricCatalog
        })
    }));
    dictionaries.forEach(row => {
        documents.push(makeDocument({
            kind: 'dictionary',
            source: `backend/data/tools.db:sys_dictionaries#${row.dict_key}`,
            title: `指标字典：${row.dict_key}`,
            updatedAt: row.updated_at,
            content: `${row.dict_key} = ${row.dict_value}`
        }));
    });
    return documents;
}

function buildPlatformConfigDocuments(rows) {
    return rows.map(row => makeDocument({
        kind: 'platform-config',
        source: `data/report.db:PlatformConfig#${row.key_name}`,
        title: `报表平台配置：${row.key_name}`,
        updatedAt: row.updated_at,
        content: compactJson(safeJson(row.value_json, row.value_json), 18000)
    }));
}

async function loadDocuments() {
    const signature = currentSignature();
    if (cache.signature === signature && cache.expiresAt > Date.now()) return cache;
    const toolsDb = await openReadOnlyDatabase(getToolsDbPath());
    const reportDb = await openReadOnlyDatabase(getReportDbPath());
    try {
        const [scripts, scriptCategories, toolRegistry, targets, groups, groupItems, prefs, categories, dictionaries, platformConfig] = await Promise.all([
            dbAll(toolsDb, 'SELECT id, name, category, url, payload_json, updated_at FROM uiv_scripts ORDER BY updated_at DESC, rowid DESC'),
            dbAllOptional(toolsDb, 'SELECT name, created_at FROM uiv_categories ORDER BY rowid'),
            dbAllOptional(toolsDb, 'SELECT slug, name, description, tags_json, href, file_path, public_access, updated_at FROM custom_tools ORDER BY sort_order, slug'),
            dbAll(toolsDb, 'SELECT target_key, label, target_type, weight, auto_fill, is_percent, exceed_by, bonus, extra_config_json, updated_at FROM sla_targets ORDER BY label, target_key'),
            dbAll(toolsDb, 'SELECT id, group_key, name, sort_order, updated_at FROM sla_groups ORDER BY sort_order, id'),
            dbAll(toolsDb, 'SELECT group_id, item_name, item_sort_order FROM sla_group_items ORDER BY group_id, item_sort_order, id'),
            dbAll(toolsDb, 'SELECT pref_key, pref_kind, payload_json, updated_at FROM sla_prefs ORDER BY updated_at DESC'),
            dbAll(toolsDb, 'SELECT name, created_at FROM sla_categories ORDER BY rowid'),
            dbAll(toolsDb, "SELECT dict_key, dict_value, category, updated_at FROM sys_dictionaries WHERE category = 'i18n' ORDER BY dict_key"),
            dbAll(reportDb, 'SELECT key_name, value_json, updated_at FROM PlatformConfig ORDER BY key_name')
        ]);
        const documents = [
            ...buildScriptDocuments(scripts, scriptCategories),
            ...buildToolRegistryDocuments(toolRegistry),
            ...buildMetricDocuments({ targets, groups, groupItems, prefs, categories, dictionaries }),
            ...buildPlatformConfigDocuments(platformConfig)
        ].slice(0, MAX_CANDIDATES);
        const status = {
            source: 'backend/data/tools.db + data/report.db',
            readOnly: true,
            scriptCount: scripts.length,
            scriptCategoryCount: scriptCategories.length,
            htmlToolCount: toolRegistry.length,
            targetRuleCount: targets.length,
            metricGroupCount: groups.length,
            customMetricCount: documents.filter(item => item.kind === 'custom-metric').length,
            dictionaryCount: dictionaries.length,
            platformConfigCount: platformConfig.length,
            latestUpdatedAt: [...scripts, ...scriptCategories, ...toolRegistry, ...targets, ...groups, ...prefs, ...dictionaries, ...platformConfig]
                .map(row => row.updated_at).filter(Boolean).sort().pop() || null
        };
        cache = { signature, expiresAt: Date.now() + CACHE_TTL_MS, documents, status };
        return cache;
    } finally {
        await Promise.all([closeDatabase(toolsDb), closeDatabase(reportDb)]);
    }
}

function intentBoost(question, kind) {
    let score = 0;
    if (SCRIPT_INTENT_RE.test(question) && kind.startsWith('uiv-')) score += 45;
    if (METRIC_INTENT_RE.test(question) && ['metric-group', 'metric-target', 'custom-metric', 'metric-catalog'].includes(kind)) score += 45;
    if (PLATFORM_CONFIG_INTENT_RE.test(question) && kind === 'platform-config') score += 45;
    if (DICTIONARY_INTENT_RE.test(question) && kind === 'dictionary') score += 42;
    if (TOOL_INTENT_RE.test(question) && ['tool-registry', 'tool-catalog'].includes(kind)) score += 45;
    if (/目录|列表|多少|全部|有哪些/.test(question) && /catalog/.test(kind)) score += 24;
    return score;
}

function wantsFullTargetList(query, documents) {
    if (FULL_TARGET_LIST_RE.test(query) && (METRIC_INTENT_RE.test(query) || /58\s*条/.test(query))) return true;
    if (!GENERAL_TARGET_QUERY_RE.test(query)) return false;
    // “IBMS 指标目标值都是多少”仍是单项查询，不能被“都是多少”扩展成整个库。
    return !documents.some(item => {
        if (item.kind !== 'metric-target') return false;
        const name = item.title.replace(/^指标目标规则：/, '').trim().toLowerCase();
        const family = name.replace(/20\d{2}$/, '');
        return name.length >= 2 && (query.includes(name) || (family.length >= 2 && query.includes(family)));
    });
}

async function search(question, { limit = 7 } = {}) {
    const loaded = await loadDocuments();
    const query = String(question || '').toLowerCase();
    const terms = extractTerms(query);
    const broadIntent = SCRIPT_INTENT_RE.test(query) || METRIC_INTENT_RE.test(query) || GENERAL_TARGET_QUERY_RE.test(query) || PLATFORM_CONFIG_INTENT_RE.test(query) || DICTIONARY_INTENT_RE.test(query) || TOOL_INTENT_RE.test(query);
    if (!terms.length && !broadIntent) return { results: [], status: loaded.status };
    if (wantsFullTargetList(query, loaded.documents)) {
        const document = loaded.documents.find(item => item.kind === 'metric-target-all');
        if (document) {
            return {
                mode: 'full-target-list',
                results: [{
                    kind: document.kind,
                    source: document.source,
                    title: document.title,
                    updatedAt: document.updatedAt,
                    score: 1000,
                    content: document.content
                }],
                status: loaded.status
            };
        }
    }
    const ranked = loaded.documents.filter(document => document.kind !== 'metric-target-all').map(document => {
        let score = intentBoost(query, document.kind);
        if (['metric-target', 'custom-metric'].includes(document.kind)) {
            const metricName = document.title.replace(/^(?:指标目标规则|自定义指标)：/, '').trim().toLowerCase();
            const metricFamily = metricName.replace(/20\d{2}$/, '');
            // A metric label explicitly present in the question is much stronger
            // evidence than a broad catalog containing the same word.
            if (metricName.length >= 2 && query.includes(metricName)) score += 100;
            // Some dashboard indicators are stored as year-specific siblings
            // (for example “重急EOS收编2025/2026”), while users naturally ask
            // for the shared family name. Prefer those concrete siblings over a
            // shorter parent indicator such as “重急EOS”.
            else if (metricFamily !== metricName && metricFamily.length >= 2 && query.includes(metricFamily)) score += 180;
        }
        for (const term of terms) {
            score += countOccurrences(document.searchText, term) * Math.max(1, term.length / 2);
            if (document.title.toLowerCase().includes(term)) score += 12;
            if (document.source.toLowerCase().includes(term)) score += 7;
        }
        if (query.length >= 4 && document.searchText.includes(query)) score += 22;
        return { document, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 7, 10));
    const perKind = new Map();
    const results = [];
    for (const item of ranked) {
        const used = perKind.get(item.document.kind) || 0;
        if (used >= 4 && !item.document.kind.includes('catalog')) continue;
        results.push({
            kind: item.document.kind,
            source: item.document.source,
            title: item.document.title,
            updatedAt: item.document.updatedAt,
            score: Number(item.score.toFixed(2)),
            content: relevantExcerpt(item.document.content, terms)
        });
        perKind.set(item.document.kind, used + 1);
        if (results.length >= safeLimit) break;
    }
    return { results, status: loaded.status };
}

function formatResultsForPrompt(result) {
    const items = result?.results || [];
    if (!items.length) return '';
    return items.map((item, index) => [
        `[只读业务配置 ${index + 1}] ${item.title}`,
        `来源: ${item.source}${item.updatedAt ? `（更新时间 ${item.updatedAt}）` : ''}`,
        item.content
    ].join('\n')).join('\n\n');
}

function clearCache() {
    cache = { signature: '', expiresAt: 0, documents: [], status: null };
}

module.exports = {
    get TOOLS_DB_PATH() { return getToolsDbPath(); },
    get REPORT_DB_PATH() { return getReportDbPath(); },
    search,
    formatResultsForPrompt,
    clearCache
};
