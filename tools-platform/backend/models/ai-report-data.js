// Data access for AI report cells: per-month source tables, extracted metrics and other tools' data.
const repo = require('./import-source-repository');
const rules = require('../../frontend/js/monthly-designer/source-rules');
const toolData = require('./ai-tool-data-service');
const customToolsRepo = require('./custom-tools-repository');
const datasets = require('./ai-report-datasets');
const parser = require('./source-sheet-parser');
const targetsRepo = require('./sla-targets-repository');

const SAMPLE_ROWS = 30;
const MAX_ROWS = 50000;

const toNumber = value => { const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[,%\s]/g, '')); return value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(number) ? null : number; };
const sourceKey = file => rules.identity(rules.tableName(file.source_key || file.name));
const monthStart = (month, offset = 0) => rules.shift(month, offset) + '-01T00:00:00Z';

// Imports for a report month usually land in that month or the next, so read from the month before onward.
// An import whose browser-side parsing never finished leaves archived originals without sheets; parse those on
// first use so the month's newest import is usable instead of showing up as missing data.
async function catalogFrom(month, offset = 0) {
    if (!rules.validMonth(month)) {
        const error = new Error('A valid report month (YYYY-MM) is required');
        error.status = 400;
        throw error;
    }
    const since = monthStart(month, offset - 1);
    const catalog = await repo.catalog({ since });
    const unparsed = catalog.files.filter(file => file.parse_status === 'pending' && !(file.sheets || []).length && ['original', 'structured'].includes(file.kind || 'original'));
    if (!unparsed.length) return catalog;
    let parsed = false;
    for (const file of unparsed) parsed = (await parser.parsePending(file.id)) || parsed;
    return parsed ? repo.catalog({ since }) : catalog;
}

function currentFiles(catalog, month) {
    return rules.libraryGroups(catalog, month).flatMap(group => group.files);
}

function describeFile(file) {
    return {
        fileId: file.id,
        name: file.name,
        sourceKey: sourceKey(file),
        kind: file.kind || 'original',
        category: file.library_category || '',
        createdAt: file.created_at,
        parseStatus: file.parse_status || 'ready',
        ...(file.parse_error ? { parseError: file.parse_error } : {}),
        sheets: (file.sheets || []).map(sheet => ({ sheetId: sheet.id, name: sheet.name, headers: sheet.headers || [], rowCount: sheet.rowCount || 0 }))
    };
}

async function listSources(month) {
    const catalog = await catalogFrom(month);
    return currentFiles(catalog, month).map(describeFile);
}

async function describeSheet(sheetId) {
    const sheet = await repo.getSheet(String(sheetId || ''));
    if (!sheet) {
        const error = new Error('Sheet not found');
        error.status = 404;
        throw error;
    }
    return { sheetId: sheet.id, name: sheet.name, headers: sheet.headers, rowCount: sheet.rows.length, sample: sheet.rows.slice(0, SAMPLE_ROWS) };
}

function metricMonthList(catalog, month) {
    const latest = new Map();
    for (const snapshot of catalog.snapshots || []) {
        if (rules.snapshotMonth(snapshot, catalog) !== month) continue;
        for (const metric of snapshot.metrics || []) {
            const entries = [metric, ...(metric.subMetrics || []).map(child => ({ ...child, key: `${metric.key}/${child.category}`, label: `${metric.label} / ${child.category}` }))];
            for (const entry of entries) {
                if (!entry.key || latest.has(entry.key)) continue; // snapshots arrive newest first
                latest.set(entry.key, { key: entry.key, label: entry.label || entry.key, value: entry.value ?? null, target: entry.target ?? null, origin: snapshot.kind || 'extraction', capturedAt: snapshot.captured_at });
            }
        }
    }
    return [...latest.values()];
}

// Names of every metric key seen in the catalog, across months.
function metricNames(catalog) {
    const names = new Map();
    for (const snapshot of catalog.snapshots || []) for (const metric of snapshot.metrics || []) {
        if (metric.key && !names.has(metric.key)) names.set(metric.key, metric.label || metric.key);
        for (const child of metric.subMetrics || []) { const key = `${metric.key}/${child.category}`; if (!names.has(key)) names.set(key, `${metric.label} / ${child.category}`); }
    }
    return names;
}

// Metric keys can change between months (an old "legacy:事故" became "other_…" when extraction rules were rebuilt)
// while names stay, so metrics are found by name; a key missing from a month is translated through its name.
function pickMetrics(catalog, month, source, names, book) {
    const metrics = withTargets(metricMonthList(catalog, month), month, book), byKey = new Map(metrics.map(metric => [metric.key, metric])), byName = new Map();
    for (const metric of metrics) if (!byName.has(metric.label)) byName.set(metric.label, metric);
    if (!source.names.length && !source.keys.length) {
        const targets = Object.fromEntries(metrics.filter(metric => metric.targetValue !== undefined).map(metric => [metric.label, metric.targetValue]));
        const rules = Object.fromEntries(metrics.filter(metric => metric.targetRule).map(metric => [metric.label, metric.targetRule]));
        return { chosen: metrics, values: Object.fromEntries(metrics.flatMap(metric => [[metric.key, toNumber(metric.value)], [metric.label, toNumber(metric.value)]])), targets, rules, absent: [] };
    }
    const chosen = [], values = {}, absent = [];
    const take = (wanted, metric) => { if (!metric) { absent.push(wanted); return; } chosen.push(metric); values[wanted] = toNumber(metric.value); };
    for (const name of source.names) take(name, byName.get(name));
    for (const key of source.keys) take(key, byKey.get(key) || byName.get(names.get(key)));
    // Every other metric of the month is readable by name too: a recipe that lists "路由器 / TE…" but also reads
    // "路由器" gets the value instead of undefined.
    for (const metric of metrics) if (!(metric.label in values)) values[metric.label] = toNumber(metric.value);
    // targets / rules: name → target number and 'gte' (at least) or 'lte' (at most), for "met or not" and gaps.
    const targets = {}, rules = {};
    for (const metric of metrics) if (metric.targetValue !== undefined) { targets[metric.label] = metric.targetValue; if (metric.targetRule) rules[metric.label] = metric.targetRule; }
    for (const key of source.keys) { const metric = byKey.get(key) || byName.get(names.get(key)); if (metric?.targetValue !== undefined) { targets[key] = metric.targetValue; if (metric.targetRule) rules[key] = metric.targetRule; } }
    return { chosen, values, targets, rules, absent };
}

// Targets live in the warning-target settings (per metric key, per month number, with a direction), not in the
// snapshots. A metric finds its target by key, or by name when its key changed; per-operator parts ("路由器 / TE",
// "TE / 路由器") use the metric's target.
async function targetBook() {
    const { items = {} } = await targetsRepo.getTargets().catch(() => ({ items: {} }));
    const byKey = new Map(Object.entries(items)), byName = new Map();
    for (const target of byKey.values()) if (target?.label && !byName.has(target.label)) byName.set(target.label, target);
    return { byKey, byName };
}
function withTargets(metrics, month, book) {
    const monthNumber = Number(String(month).slice(5));
    return metrics.map(metric => {
        if (metric.target !== null && metric.target !== undefined && metric.target !== '') return metric;
        const assessed = metric.key.startsWith('assessment:'), name = assessed ? metric.label.split(' / ').pop() : metric.label.split(' / ')[0];
        const target = book.byKey.get(metric.key.split('/')[0]) || book.byName.get(name), value = toNumber(target?.[monthNumber]);
        if (value === null) return metric;
        const rule = ['gte', 'lte'].includes(target.type) ? target.type : '';
        return { ...metric, target: `${rule === 'gte' ? '≥ ' : rule === 'lte' ? '≤ ' : ''}${value}${target.isPercent ? '%' : ''}`, targetValue: value, targetRule: rule };
    });
}

async function listMetrics(month) {
    const [catalog, book] = await Promise.all([catalogFrom(month), targetBook()]);
    return withTargets(metricMonthList(catalog, month), month, book);
}

// What the AI sees of the metrics: one short line per metric ("名称 = 值（目标 …）"), searchable by name. The full
// records (keys, origins, timestamps) are four times larger and got cut off, hiding metrics late in the list.
const METRIC_TEXT_LIMIT = 12000;
async function findMetrics(month, query = '') {
    const all = await listMetrics(month), words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const matches = words.length ? all.filter(metric => words.every(word => metric.label.toLowerCase().includes(word))) : all;
    const lines = [];
    let size = 0;
    for (const metric of matches) {
        const line = `${metric.label} = ${metric.value ?? '—'}${metric.target !== null && metric.target !== undefined && metric.target !== '' ? `（目标 ${metric.target}）` : ''}`;
        if (size + line.length > METRIC_TEXT_LIMIT) break;
        lines.push(line);
        size += line.length + 4;
    }
    const hidden = matches.length - lines.length;
    return {
        month,
        total: all.length,
        ...(words.length ? { query, found: matches.length } : {}),
        note: '名称就是取数用的名称（recipe 的 names）；“名称 / TE”这类是按运营商等拆分的分项，“TE / 名称”是考核结果。' + (hidden ? `还有 ${hidden} 条没列出，请用 query 按名称搜索。` : ''),
        metrics: lines
    };
}

async function searchToolData(question) {
    const tools = await customToolsRepo.listTools().catch(() => []);
    const result = await toolData.analyzeQuestion(`${question} 本月 数据`, {});
    return {
        tools: result.tools || [],
        available: tools.slice(0, 80).map(tool => ({ slug: tool.slug, name: tool.name })),
        text: result.prompt || '没有找到相关工具数据。'
    };
}

function findSheet(files, match) {
    const wanted = match.sourceKey || rules.identity(rules.tableName(match.tableName));
    const candidates = files.filter(file => sourceKey(file) === wanted && (!match.kind || (file.kind || 'original') === match.kind));
    for (const file of candidates) {
        const sheets = file.sheets || [];
        const sheet = match.sheetName ? sheets.find(item => item.name === match.sheetName) : sheets[0];
        if (sheet) return { file, sheet };
    }
    return null;
}

// Resolves every recipe source for a report month and returns the compute input.
async function recipeInput(month, sources = []) {
    const offsets = sources.map(source => Number(source.monthOffset) || 0);
    const catalog = await catalogFrom(month, Math.min(0, ...offsets)), names = metricNames(catalog), book = sources.some(source => source.kind === 'metrics') ? await targetBook() : { byKey: new Map(), byName: new Map() };
    const input = {};
    const missing = [];
    const toolContext = [];
    for (const source of sources) {
        const sourceMonth = rules.shift(month, Number(source.monthOffset) || 0);
        if (source.kind === 'sheet') {
            const found = findSheet(currentFiles(catalog, sourceMonth), source.match || {});
            if (!found) { missing.push({ id: source.id, label: source.label, month: sourceMonth }); input[source.id] = null; continue; }
            const sheet = await repo.getSheet(found.sheet.id);
            input[source.id] = { month: sourceMonth, file: found.file.name, sheet: sheet.name, headers: sheet.headers, rows: sheet.rows.slice(0, MAX_ROWS) };
        } else if (source.kind === 'metrics') {
            // values: name (or key) → number ('95%' → 95), so recipes look metrics up instead of parsing text.
            const { chosen, values, targets, rules, absent } = pickMetrics(catalog, sourceMonth, source, names, book);
            if (!chosen.length || absent.length) missing.push({ id: source.id, label: absent.length && chosen.length ? `${source.label || source.id}（${absent.join('、')}）` : source.label, month: sourceMonth });
            input[source.id] = { month: sourceMonth, metrics: chosen, values, targets, rules };
        } else if (source.kind === 'dataset') {
            const dataset = await datasets.readDataset(source.dataset, sourceMonth);
            if (!dataset) { missing.push({ id: source.id, label: source.label, month: sourceMonth }); input[source.id] = null; continue; }
            input[source.id] = { month: sourceMonth, source: dataset.source, name: dataset.name, period: dataset.period, headers: dataset.headers, rows: dataset.rows };
        } else if (source.kind === 'tool') {
            const data = await searchToolData(source.question || source.label);
            toolContext.push(`【${source.label || source.slug}】\n${data.text}`.slice(0, 8000));
        }
    }
    return { input, missing, toolContext: toolContext.join('\n\n') };
}

// Sources a recipe names that do not exist at all (as opposed to having no data this month): made-up table keys,
// metric keys or dataset ids. Recent months count, so a table that simply skipped this month is not reported.
async function unknownSources(month, sources = []) {
    const unknown = [];
    const sheets = sources.filter(source => source.kind === 'sheet'), metrics = sources.filter(source => source.kind === 'metrics' && (source.keys.length || source.names.length)), sets = sources.filter(source => source.kind === 'dataset');
    if (sheets.length || metrics.length) {
        const offsets = sources.map(source => Number(source.monthOffset) || 0), catalog = await catalogFrom(month, Math.min(0, ...offsets) - 2);
        const keys = new Set(catalog.files.map(sourceKey));
        for (const source of sheets) {
            const wanted = source.match?.sourceKey || rules.identity(rules.tableName(source.match?.tableName || ''));
            if (!keys.has(wanted)) unknown.push(`导入表 ${source.label || source.id}（sourceKey: ${wanted || '空'}）`);
        }
        // Keys from any recent month count (they are translated by name), and so do names.
        const names = metricNames(catalog), labels = new Set(names.values());
        for (const source of metrics) {
            const missing = [...source.keys.filter(key => !names.has(key)), ...source.names.filter(name => !labels.has(name))];
            if (missing.length) unknown.push(`指标 ${missing.slice(0, 6).join('、')}`);
        }
    }
    if (sets.length) {
        const ids = new Set((await datasets.listDatasets(month)).datasets.map(item => item.id));
        for (const source of sets) if (!ids.has(source.dataset)) unknown.push(`数据集 ${source.label || source.id}（id: ${source.dataset || '空'}）`);
    }
    return unknown;
}

async function describeDataset(id, month) {
    const dataset = await datasets.readDataset(String(id || ''), month, { sample: 30 });
    if (!dataset) {
        const error = new Error('Dataset not found for this month');
        error.status = 404;
        throw error;
    }
    return { ...dataset, sample: dataset.rows, rows: undefined };
}

module.exports = { listSources, describeSheet, listMetrics, findMetrics, searchToolData, recipeInput, unknownSources, sourceKey, listDatasets: datasets.listDatasets, describeDataset };
