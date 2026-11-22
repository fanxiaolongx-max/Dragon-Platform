// SLA 指标规则的条件值批量维护：查找、预览（对照最近一次导入的数据算命中行数）、
// 应用（记录每处改动）、按改动记录回退。供 Dragon 对话工具与接口使用。
//
// 只改条件值（条件列 X 的值 Y、附加过滤条件的值、计数/占比的关键字 K），不改指标 ID、
// 列名和展示列，所以不会影响预警目标与历史快照。业务名称改过时推荐写别名
// [旧名]|[新名]（见 frontend/js/shared/metric-extraction.js），新旧数据都能命中。
const crypto = require('crypto');
const { run, get, all } = require('./app-db');
const prefsRepo = require('./sla-prefs-repository');
const extraction = require('../../frontend/js/shared/metric-extraction');

const FIELDS = ['valY', 'conditions', 'valK'];
const MAX_CHANGES = 500;

// 每个租户库各一张表；建表语句可重复执行，开销很小，所以每次调用前都执行一遍
async function ensureReady() {
    await run(`CREATE TABLE IF NOT EXISTS sla_metric_rule_changes (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        changes_json TEXT NOT NULL,
        revert_of TEXT,
        reverted_by TEXT
    )`);
}

function fail(message, code = 'SLA_RULE_EDIT_ERROR', status = 400) {
    throw Object.assign(new Error(message), { code, status });
}

/** sla_prefs 的键 → 页面里的表 ID（与 PUT /api/sla/prefs 清理孤儿目标时的规则一致） */
function sectionIdOf(prefKey) {
    const key = String(prefKey);
    if (key.startsWith('sla_prefs_other_')) return key.replace('sla_prefs_', '');
    for (const mode of ['rectification', 'risk', 'special', 'sr', 'vulnerability']) if (key.startsWith(`sla_prefs_${mode}`)) return mode;
    return key.replace('sla_prefs_', '');
}

function tableTitleOf(prefKey, payload) {
    const meta = payload && payload._sourceMeta;
    return String(meta?.title || meta?.baseName || meta?.fileName || sectionIdOf(prefKey));
}

/** 列出每一处条件值：主指标、子指标，各自的 valY / conditions[i].value / valK */
function listLocations(prefs) {
    const out = [];
    for (const [prefKey, payload] of Object.entries(prefs || {})) {
        if (!String(prefKey).startsWith('sla_prefs_') || !Array.isArray(payload?.customMetrics)) continue;
        const sectionId = sectionIdOf(prefKey), table = tableTitleOf(prefKey, payload);
        payload.customMetrics.forEach((metric, metricIndex) => {
            if (!metric || typeof metric !== 'object') return;
            const base = { prefKey, sectionId, table, metricId: metric.id || '', metricIndex, metricLabel: metric.label || '' };
            const add = (rule, sub, subIndex) => {
                const owner = { ...base, subIndex: sub ? subIndex : null, subId: sub ? (sub.id || '') : null, subCategory: sub ? (sub.category || '') : null, rule, parent: metric };
                if (rule.colX && rule.valY !== undefined && String(rule.valY).trim() !== '') out.push({ ...owner, field: 'valY', column: rule.colX, value: String(rule.valY) });
                (Array.isArray(rule.conditions) ? rule.conditions : []).forEach((condition, conditionIndex) => {
                    if (condition && condition.column && condition.value !== undefined && String(condition.value).trim() !== '') {
                        out.push({ ...owner, field: 'conditions', conditionIndex, column: condition.column, value: String(condition.value) });
                    }
                });
                if ((rule.type === 'count' || rule.type === 'ratio') && rule.valK !== undefined && String(rule.valK).trim() !== '') {
                    out.push({ ...owner, field: 'valK', column: rule.colZ || '', value: String(rule.valK) });
                }
            };
            add(metric, null, null);
            (Array.isArray(metric.subMetrics) ? metric.subMetrics : []).forEach((sub, subIndex) => { if (sub && typeof sub === 'object') add(sub, sub, subIndex); });
        });
    }
    return out;
}

function describe(loc) {
    const where = `${loc.table} / ${loc.metricLabel || loc.metricId}${loc.subCategory !== null ? ` / 子指标[${loc.subCategory || loc.subIndex}]` : ''}`;
    const field = loc.field === 'valY' ? `条件值(${loc.column})` : loc.field === 'valK' ? `关键字K(${loc.column})` : `过滤条件${loc.conditionIndex + 1}(${loc.column})`;
    return `${where} · ${field}`;
}

/** 定位一处条件值所在对象：按指标 ID、子指标 ID/分类找，顺序变了也能找到 */
function resolve(payload, loc) {
    const metrics = Array.isArray(payload?.customMetrics) ? payload.customMetrics : [];
    const metric = (loc.metricId && metrics.find(item => item && item.id === loc.metricId)) || (!loc.metricId ? metrics[loc.metricIndex] : null);
    if (!metric) return null;
    let rule = metric;
    if (loc.subIndex !== null && loc.subIndex !== undefined) {
        const subs = Array.isArray(metric.subMetrics) ? metric.subMetrics : [];
        if (loc.subId) rule = subs.find(item => item && item.id === loc.subId) || null;
        else if (subs[loc.subIndex]?.category === loc.subCategory) rule = subs[loc.subIndex];
        else {
            // 没有 ID 的旧子指标：顺序变了时按分类找，分类唯一才认
            const sameCategory = subs.filter(item => item && item.category === loc.subCategory);
            rule = sameCategory.length === 1 ? sameCategory[0] : null;
        }
        if (!rule) return null;
    }
    if (loc.field === 'conditions') {
        const condition = Array.isArray(rule.conditions) ? rule.conditions[loc.conditionIndex] : null;
        return condition && condition.column === loc.column ? { get: () => String(condition.value ?? ''), set: value => { condition.value = value; } } : null;
    }
    return { get: () => String(rule[loc.field] ?? ''), set: value => { rule[loc.field] = value; } };
}

// ── 最近一次导入的数据（用最近的快照里保存的各表行），用于评估改动能否命中 ──
async function latestSections() {
    const snapshot = await require('./sla-snapshots-repository').getLatestSnapshot().catch(() => null);
    const sections = new Map();
    for (const section of Array.isArray(snapshot?.sourceSections) ? snapshot.sourceSections : []) {
        if (section && Array.isArray(section.rows)) sections.set(section.key, section);
    }
    return { sections, timestamp: snapshot?.timestamp || null };
}

function rowsFor(loc, sections) {
    const rule = loc.rule, parent = loc.parent;
    const scope = rule.scope || (loc.subIndex !== null ? parent.scope : '');
    if (scope === 'all') return [...sections.values()].filter(section => !section.archiveSupplementary).flatMap(section => section.rows);
    const key = rule.sourceSecId || (loc.subIndex !== null ? parent.sourceSecId : '') || loc.sectionId;
    return sections.get(key)?.rows || null;
}

/** 这条规则（只看条件，不看取值）在给定数据里命中几行；valK 只在已命中的行里数 */
function matchCount(loc, rows, override) {
    if (!rows) return null;
    const rule = { ...loc.rule, type: loc.rule.type || loc.parent.type || 'extract' };
    if (override !== undefined) {
        if (loc.field === 'valY') rule.valY = override;
        else if (loc.field === 'valK') rule.valK = override;
        else rule.conditions = rule.conditions.map((condition, index) => (index === loc.conditionIndex ? { ...condition, value: override } : condition));
    }
    const matched = rows.filter(row => extraction.rowMatches(row, rule));
    if (loc.field === 'valK') return matched.filter(row => extraction.cellMatches(row[rule.colZ], rule.valK)).length;
    return matched.length;
}

/** 数据里这一列有、但同一指标下没有任何规则命中的取值：多半就是改了名的那个 */
function unmatchedValues(loc, rows, siblings) {
    if (!rows) return [];
    const values = new Set(rows.map(row => String(row?.[loc.column] ?? '').trim()).filter(Boolean));
    for (const value of [...values]) {
        if (siblings.some(item => extraction.cellMatches(value, item.value))) values.delete(value);
    }
    return [...values].slice(0, 12);
}

function publicLocation(loc) {
    return { prefKey: loc.prefKey, table: loc.table, metricId: loc.metricId, metricLabel: loc.metricLabel, subCategory: loc.subCategory, field: loc.field, conditionIndex: loc.conditionIndex, column: loc.column, value: loc.value, where: describe(loc) };
}

/**
 * 查找条件值。query 按表名、指标名、子指标分类、列名、条件值做包含匹配；
 * unmatched=true 只返回在最近一次导入里一行都没命中的条件（高亮不出来、取不到数的那些）。
 */
async function find({ query = '', unmatched = false, limit = 60 } = {}) {
    const prefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
    const locations = listLocations(prefs);
    const { sections, timestamp } = await latestSections();
    const q = String(query || '').trim().toLowerCase();
    const items = [];
    for (const loc of locations) {
        if (q && ![loc.table, loc.metricLabel, loc.subCategory, loc.column, loc.value, loc.prefKey].some(text => String(text ?? '').toLowerCase().includes(q))) continue;
        const rows = rowsFor(loc, sections);
        const count = matchCount(loc, rows);
        // 关键字 K 是计数口径（如「未完成=否」计 0 条是正常结果），不当作规则失效列出
        if (unmatched && (count !== 0 || loc.field === 'valK')) continue;
        const item = { ...publicLocation(loc), aliases: extraction.aliases(loc.value), matchedRows: count };
        if (count === 0 && loc.field !== 'valK') {
            const siblings = locations.filter(other => other.prefKey === loc.prefKey && other.metricId === loc.metricId && other.column === loc.column && other.field !== 'valK');
            item.unmatchedValuesInData = unmatchedValues(loc, rows, siblings);
        }
        items.push(item);
    }
    return { latestImportAt: timestamp, total: items.length, items: items.slice(0, Math.max(1, Math.min(Number(limit) || 60, 300))), truncated: items.length > limit };
}

function newValueFor(current, replacement) {
    const value = String(current);
    const from = String(replacement.from ?? '').trim();
    const aliases = extraction.aliases(value) || [value.trim()];
    if (Array.isArray(replacement.addAliases) && replacement.addAliases.length) {
        if (!aliases.includes(from)) return null;
        const added = replacement.addAliases.map(item => String(item ?? '').trim()).filter(Boolean);
        if (added.some(item => /[\[\]|]/.test(item) && !/^\[(?:空|非空)\]$/.test(item))) fail('别名里不能含有 [ ] 或 |');
        const next = extraction.formatAliases([...aliases, ...added]);
        return next === value ? null : next;
    }
    if (replacement.to === undefined || replacement.to === null) fail('每条替换需要 to 或 addAliases');
    const to = String(replacement.to);
    if (replacement.match === 'contains') return value.includes(from) && from ? value.split(from).join(to) : null;
    if (value.trim() !== from) return null;
    return to === value ? null : to;
}

/**
 * 按替换清单算出要改的每一处，并对照最近一次导入评估改动前后的命中行数。不写库。
 * replacements: [{ from, to } | { from, addAliases: [...] }]；match: 'exact'(默认，整串相等)|'contains'
 * 可选 prefKeys / metricLabels / fields 缩小范围。
 */
async function plan({ replacements = [], prefKeys = [], metricLabels = [], fields = FIELDS } = {}) {
    if (!Array.isArray(replacements) || !replacements.length) fail('replacements 不能为空');
    if (replacements.some(item => !String(item?.from ?? '').trim())) fail('每条替换都要有 from（原条件值）');
    const allowedFields = new Set((Array.isArray(fields) && fields.length ? fields : FIELDS).filter(field => FIELDS.includes(field)));
    const keyFilter = new Set((prefKeys || []).map(String)), labelFilter = (metricLabels || []).map(String).filter(Boolean);
    const prefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
    const { sections, timestamp } = await latestSections();
    const changes = [], warnings = [];
    for (const loc of listLocations(prefs)) {
        if (!allowedFields.has(loc.field)) continue;
        if (keyFilter.size && !keyFilter.has(loc.prefKey)) continue;
        if (labelFilter.length && !labelFilter.some(label => loc.metricLabel.includes(label))) continue;
        for (const replacement of replacements) {
            const to = newValueFor(loc.value, { ...replacement, match: replacement.match || 'exact' });
            if (to === null) continue;
            const rows = rowsFor(loc, sections);
            const change = { ...publicLocation(loc), subIndex: loc.subIndex, subId: loc.subId, metricIndex: loc.metricIndex, from: loc.value, to, matchedRowsBefore: matchCount(loc, rows), matchedRowsAfter: matchCount(loc, rows, to) };
            if (change.matchedRowsAfter === 0) warnings.push(`${change.where}：改成「${to}」后在最近一次导入里仍然一行都匹配不到`);
            else if (change.matchedRowsBefore !== null && change.matchedRowsAfter < change.matchedRowsBefore) warnings.push(`${change.where}：命中行数从 ${change.matchedRowsBefore} 减少到 ${change.matchedRowsAfter}`);
            changes.push(change);
            break;
        }
    }
    if (changes.length > MAX_CHANGES) fail(`一次最多改 ${MAX_CHANGES} 处，本次匹配到 ${changes.length} 处，请缩小范围`);
    const unusedFrom = replacements.map(item => String(item.from).trim()).filter(from => !changes.some(change => (extraction.aliases(change.from) || [change.from.trim()]).includes(from) || change.from.includes(from)));
    if (unusedFrom.length) warnings.push(`没有找到条件值：${unusedFrom.join('、')}`);
    return { latestImportAt: timestamp, changes, warnings };
}

const loadPrefs = async () => (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
const targetKeys = async () => new Set(Object.keys((await require('./sla-targets-repository').getTargets({ mode: 'auto' })).items || {}));

// ── 整条指标规则：读取、增 / 改 / 删（sla_read_metric_rules / sla_edit_metric_rules）──
// 与条件值修改共用改动记录和回退：每条记录保存改前 / 改后的完整指标对象；写入和回退都先核对当前对象
// 仍与记录里的“改前”一致，之后被别人改过的不覆盖、列为冲突。指标 ID 不能改（预警目标、历史快照靠它关联）。
const METRIC_TYPES = ['extract', 'extract_multi', 'count', 'ratio'];
const LOCKED_FIELDS = new Set(['id', 'sourceSecId']);
const MAX_METRIC_EDITS = 50;

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}
const sameMetric = (a, b) => canonical(a ?? null) === canonical(b ?? null);

function metricTables(prefs) {
    return Object.entries(prefs || {}).filter(([key, payload]) => String(key).startsWith('sla_prefs_') && payload && typeof payload === 'object')
        .map(([prefKey, payload]) => ({ prefKey, sectionId: sectionIdOf(prefKey), table: tableTitleOf(prefKey, payload), metrics: Array.isArray(payload.customMetrics) ? payload.customMetrics : [] }));
}

function sectionRows(metric, sectionId, sections) {
    if (!sections) return null;
    if (metric.scope === 'all') return [...sections.values()].filter((s) => !s.archiveSupplementary).flatMap((s) => s.rows);
    return sections.get(metric.sourceSecId || sectionId)?.rows || null;
}

/** 按最近一次导入估算这条指标会算出什么值、命中几行（只看主指标） */
function evaluateMetric(metric, sectionId, sections) {
    if (!metric) return null;
    const rows = sectionRows(metric, sectionId, sections);
    if (!rows) return { value: null, matchedRows: null };
    try {
        const result = extraction.evaluate(rows, { ...metric, type: metric.type || 'extract' });
        return { value: result.value, matchedRows: result.matchedCount };
    } catch (error) {
        return { value: null, matchedRows: null, error: error.message };
    }
}

/** 读整条规则：不传参数列出所有表和指标；传 prefKey / metricId / query 返回完整定义 */
async function readMetrics({ prefKey = '', metricId = '', query = '', limit = 20 } = {}) {
    const tables = metricTables(await loadPrefs());
    const q = String(query || '').trim().toLowerCase();
    if (!prefKey && !metricId && !q) {
        return { tables: tables.map((t) => ({ prefKey: t.prefKey, table: t.table, metrics: t.metrics.map((m) => ({ id: m?.id || '', label: m?.label || '', type: m?.type || 'extract', subMetrics: Array.isArray(m?.subMetrics) ? m.subMetrics.length : 0 })) })) };
    }
    const { sections, timestamp } = await latestSections();
    const items = [];
    for (const t of tables) {
        if (prefKey && t.prefKey !== prefKey) continue;
        for (const m of t.metrics) {
            if (!m || typeof m !== 'object') continue;
            if (metricId && m.id !== metricId) continue;
            if (q && ![t.table, m.label, m.colX, m.valY, m.colZ, ...(m.subMetrics || []).map((s) => s?.category)].some((v) => String(v ?? '').toLowerCase().includes(q))) continue;
            items.push({ prefKey: t.prefKey, table: t.table, metric: m, latest: evaluateMetric(m, t.sectionId, sections) });
        }
    }
    const max = Math.max(1, Math.min(Number(limit) || 20, 100));
    return { latestImportAt: timestamp, total: items.length, items: items.slice(0, max), truncated: items.length > max };
}

function validateMetric(metric, where) {
    if (!metric || typeof metric !== 'object' || Array.isArray(metric)) fail(`${where}：指标必须是对象`);
    if (!String(metric.label || '').trim()) fail(`${where}：label（指标名）不能为空`);
    if (metric.type !== undefined && !METRIC_TYPES.includes(metric.type)) fail(`${where}：type 只能是 ${METRIC_TYPES.join(' / ')}`);
    for (const key of Object.keys(metric)) if (key.startsWith('_')) fail(`${where}：不能写内部字段 ${key}`);
    const checkConditions = (rule, label) => {
        if (rule.conditions === undefined) return;
        if (!Array.isArray(rule.conditions) || rule.conditions.some((c) => !c || typeof c !== 'object' || !String(c.column || '').trim())) fail(`${label}：conditions 必须是 [{ column, value }] 数组`);
    };
    checkConditions(metric, where);
    if (metric.subMetrics !== undefined) {
        if (!Array.isArray(metric.subMetrics)) fail(`${where}：subMetrics 必须是数组`);
        metric.subMetrics.forEach((sub, i) => {
            if (!sub || typeof sub !== 'object') fail(`${where}：子指标 ${i + 1} 必须是对象`);
            if (sub.type !== undefined && !METRIC_TYPES.includes(sub.type)) fail(`${where}：子指标 ${i + 1} 的 type 不合法`);
            checkConditions(sub, `${where} / 子指标 ${i + 1}`);
        });
    }
    return metric;
}

function fieldDiff(before, after) {
    if (!before) return '新增';
    if (!after) return '删除';
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => canonical(before[k]) !== canonical(after[k]));
    return keys.length ? `改 ${keys.join('、')}` : '无变化';
}

const short = (value) => { const text = typeof value === 'string' ? value : JSON.stringify(value); return text === undefined ? '（无）' : text.length > 160 ? `${text.slice(0, 160)}…` : text; };

/**
 * 算出一组整条规则改动（不写库）。edits 每项：
 *   { op: 'update', prefKey, metricId, set: { 字段: 新值 }, unset: ['字段'] }
 *   { op: 'add', prefKey, metric: { label, type, colX, valY, colZ, ... } }   不传 id 时自动生成
 *   { op: 'remove', prefKey, metricId }
 */
async function planMetricEdits({ edits = [] } = {}) {
    if (!Array.isArray(edits) || !edits.length) fail('edits 不能为空');
    if (edits.length > MAX_METRIC_EDITS) fail(`一次最多改 ${MAX_METRIC_EDITS} 条规则`);
    const prefs = await loadPrefs();
    const work = clone(prefs);
    const { sections, timestamp } = await latestSections();
    const targets = await targetKeys().catch(() => new Set());
    const changes = [], warnings = [];
    for (const [i, edit] of edits.entries()) {
        const label = `第 ${i + 1} 项`;
        const prefKey = String(edit?.prefKey || '');
        const payload = work[prefKey];
        if (!prefKey.startsWith('sla_prefs_') || !payload || typeof payload !== 'object') fail(`${label}：没有这张表 ${prefKey || '（未填 prefKey）'}，先用 sla_read_metric_rules 查`);
        if (!Array.isArray(payload.customMetrics)) payload.customMetrics = [];
        const metrics = payload.customMetrics;
        const sectionId = sectionIdOf(prefKey), table = tableTitleOf(prefKey, payload);
        let before = null, after = null, position = metrics.length, metricId = String(edit.metricId || '');
        if (edit.op === 'add') {
            const metric = clone(edit.metric);
            validateMetric(metric, label);
            metric.id = String(metric.id || `m_${Date.now()}${i}`);
            if (metrics.some((m) => m?.id === metric.id)) fail(`${label}：指标 ID ${metric.id} 已存在`);
            metric.type = metric.type || 'extract';
            metric.scope = metric.scope || 'current';
            metric.sourceSecId = sectionId;
            metric.conditions = metric.conditions || [];
            metricId = metric.id;
            after = metric;
            metrics.push(metric);
        } else if (edit.op === 'update' || edit.op === 'remove') {
            position = metrics.findIndex((m) => m && m.id === metricId);
            if (!metricId || position < 0) fail(`${label}：表 ${table} 里没有指标 ${metricId || '（未填 metricId）'}`);
            before = clone(metrics[position]);
            if (edit.op === 'remove') {
                metrics.splice(position, 1);
                if (targets.has(`${sectionId}_${metricId}`)) warnings.push(`${table} / ${before.label}：这条指标配了预警目标，删除后目标会失效（页面下次保存规则时会清掉）`);
            } else {
                const set = edit.set && typeof edit.set === 'object' && !Array.isArray(edit.set) ? edit.set : {};
                const unset = Array.isArray(edit.unset) ? edit.unset.map(String) : [];
                for (const key of [...Object.keys(set), ...unset]) if (LOCKED_FIELDS.has(key)) fail(`${label}：${key} 不能改（预警目标和历史快照靠它关联）`);
                if (!Object.keys(set).length && !unset.length) fail(`${label}：update 需要 set 或 unset`);
                after = { ...clone(before), ...clone(set) };
                for (const key of unset) delete after[key];
                validateMetric(after, label);
                metrics[position] = after;
            }
        } else {
            fail(`${label}：op 只能是 add / update / remove`);
        }
        const name = (after || before).label || metricId;
        const evalBefore = evaluateMetric(before, sectionId, sections);
        const evalAfter = evaluateMetric(after, sectionId, sections);
        if (after && evalAfter && evalAfter.matchedRows === 0) warnings.push(`${table} / ${name}：改后在最近一次导入里一行都匹配不到`);
        const change = {
            kind: 'metric', prefKey, metricId, position, where: `${table} / ${name}`,
            before, after,
            from: before ? `${short(before.label)}（${fieldDiff(before, after)}）` : '（无）',
            to: after ? short(Object.fromEntries(Object.entries(after).filter(([k]) => !before || canonical(before[k]) !== canonical(after[k])))) : '（已删除）',
            valueBefore: evalBefore?.value ?? null, valueAfter: evalAfter?.value ?? null,
            matchedRowsBefore: evalBefore?.matchedRows ?? null, matchedRowsAfter: evalAfter?.matchedRows ?? null,
        };
        if (before && after && sameMetric(before, after)) { warnings.push(`${change.where}：没有变化，已跳过`); continue; }
        changes.push(change);
    }
    return { latestImportAt: timestamp, changes, warnings };
}

/** 把一条整条规则改动写进 prefs（内存里）：当前对象必须与记录的“改前”一致 */
function applyMetricItem(prefs, item) {
    const payload = prefs[item.prefKey];
    if (!payload || typeof payload !== 'object') return { reason: '这张表已不存在' };
    if (!Array.isArray(payload.customMetrics)) payload.customMetrics = [];
    const metrics = payload.customMetrics;
    const index = metrics.findIndex((m) => m && m.id === item.metricId);
    const current = index >= 0 ? metrics[index] : null;
    if (!sameMetric(current, item.before)) return { reason: current ? '这条规则之后又被改过' : '这条规则已不存在', current: current ? current.label : undefined };
    if (!item.after) metrics.splice(index, 1);
    else if (index >= 0) metrics[index] = clone(item.after);
    else metrics.splice(Math.min(Math.max(0, Number(item.position) || 0), metrics.length), 0, clone(item.after));
    return null;
}

const swapMetricItem = (item) => ({ ...item, before: item.after, after: item.before, from: item.to, to: item.from, valueBefore: item.valueAfter, valueAfter: item.valueBefore });

async function applyMetricEdits(args = {}, { actor = '', source = 'dragon-claw' } = {}) {
    const planned = await planMetricEdits(args);
    if (!planned.changes.length) return { ...planned, id: null, applied: [], conflicts: [] };
    const result = await write(planned.changes, { actor, source, summary: args.summary || `修改 ${planned.changes.length} 条指标规则` });
    return { ...planned, ...result };
}

async function recordConfigChange(actor, beforePrefs, afterPrefs, summary) {
    try {
        const targets = (await require('./sla-targets-repository').getTargets({ mode: 'auto' })).items;
        const groups = (await require('./sla-groups-repository').listGroups({ mode: 'auto' })).items;
        const req = { user: { username: actor }, method: 'AGENT', originalUrl: 'dragon-claw:sla-metric-rules', get: () => '' };
        await require('./config-change-monitor').recordSlaConfigChange({ req, action: summary, beforeTargets: targets, beforePrefs, beforeGroups: groups, afterTargets: targets, afterPrefs, afterGroups: groups });
    } catch (error) {
        console.warn('[sla-rule-editor] 记录配置变更失败：', error.message);
    }
}

/** 写入一组已定位的改动：每处先确认当前值仍是 from，再改；返回成功与冲突 */
async function write(items, { actor = '', source = 'dragon-claw', summary = '', revertOf = null } = {}) {
    await ensureReady();
    const prefs = (await prefsRepo.getPrefsObject({ mode: 'auto' })).items;
    const before = JSON.parse(JSON.stringify(prefs));
    const applied = [], conflicts = [], touched = new Set();
    for (const item of items) {
        if (item.kind === 'metric') {
            const conflict = applyMetricItem(prefs, item);
            if (conflict) { conflicts.push({ ...item, ...conflict }); continue; }
            applied.push(item);
            touched.add(item.prefKey);
            continue;
        }
        const target = prefs[item.prefKey] ? resolve(prefs[item.prefKey], item) : null;
        if (!target) { conflicts.push({ ...item, reason: '规则已不存在或位置变了' }); continue; }
        const current = target.get();
        if (current !== item.from) { conflicts.push({ ...item, current, reason: '当前值已被改过' }); continue; }
        target.set(item.to);
        applied.push(item);
        touched.add(item.prefKey);
    }
    if (!applied.length) return { id: null, applied, conflicts };
    for (const prefKey of touched) await prefsRepo.upsertPrefItem(prefKey, prefs[prefKey]);
    const id = `rc_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const text = summary || `修改 ${applied.length} 处指标条件值`;
    await run('INSERT INTO sla_metric_rule_changes (id, created_at, actor, source, summary, changes_json, revert_of) VALUES (?,?,?,?,?,?,?)',
        [id, new Date().toISOString(), String(actor), String(source), text.slice(0, 300), JSON.stringify(applied), revertOf]);
    if (revertOf) await run('UPDATE sla_metric_rule_changes SET reverted_by=? WHERE id=?', [id, revertOf]);
    const wholeRules = applied.some(item => item.kind === 'metric');
    await recordConfigChange(actor, before, prefs, revertOf ? (wholeRules ? '回退指标规则' : '回退指标条件值') : (wholeRules ? '修改指标规则' : '批量修改指标条件值'));
    return { id, applied, conflicts };
}

/** 预览后应用：重新按当前规则计算一遍（不信任预览时的旧数据），再逐处写入 */
async function apply(args = {}, { actor = '', source = 'dragon-claw' } = {}) {
    const planned = await plan(args);
    if (!planned.changes.length) return { ...planned, id: null, applied: [], conflicts: [] };
    const result = await write(planned.changes, { actor, source, summary: args.summary });
    return { ...planned, ...result };
}

async function listChanges({ limit = 20 } = {}) {
    await ensureReady();
    const rows = await all('SELECT id, created_at, actor, source, summary, changes_json, revert_of, reverted_by FROM sla_metric_rule_changes ORDER BY created_at DESC LIMIT ?', [Math.max(1, Math.min(Number(limit) || 20, 100))]);
    return rows.map(row => {
        const changes = JSON.parse(row.changes_json || '[]');
        return { id: row.id, createdAt: row.created_at, actor: row.actor, source: row.source, summary: row.summary, count: changes.length, revertOf: row.revert_of || null, revertedBy: row.reverted_by || null,
            changes: changes.slice(0, 30).map(change => ({ where: change.where, from: change.from, to: change.to })) };
    });
}

/** 回退一次改动：只把「当前值仍等于那次改后的值」的地方改回去；之后又被改过的地方列为冲突，不覆盖 */
async function revert(changeId, { actor = '', source = 'dragon-claw' } = {}) {
    await ensureReady();
    const row = await get('SELECT id, summary, changes_json, reverted_by FROM sla_metric_rule_changes WHERE id=?', [String(changeId)]);
    if (!row) fail('没有这条改动记录', 'SLA_RULE_CHANGE_NOT_FOUND', 404);
    if (row.reverted_by) fail(`这次改动已经回退过（回退记录 ${row.reverted_by}），要恢复可以回退那条回退记录`, 'SLA_RULE_CHANGE_REVERTED', 409);
    // 倒序回退：同一条规则连改几次时，要从最后一次往前撤
    const items = JSON.parse(row.changes_json || '[]').map(change => (change.kind === 'metric' ? swapMetricItem(change) : { ...change, from: change.to, to: change.from })).reverse();
    return write(items, { actor, source, summary: `回退：${row.summary}`, revertOf: row.id });
}

module.exports = { find, plan, apply, listChanges, revert, sectionIdOf, listLocations, ensureReady, readMetrics, planMetricEdits, applyMetricEdits };
