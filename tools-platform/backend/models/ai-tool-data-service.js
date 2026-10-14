const fs = require('fs');
const path = require('path');
const customToolsRepo = require('./custom-tools-repository');
const customSnapshotsRepo = require('./custom-tools-snapshots-repository');

// Dragon Claw「工具数据」只读检索：根据问题匹配平台工具，读取它保存在服务端的业务数据
// （通用快照表、通用状态 KV、各工具专用库），以及前端随问题附带的浏览器本地数据，
// 压缩成“记录数 + 字段 + 分布 + 汇总 + 少量样例”的摘要交给模型，原始数据不直接发送。

const TOOL_CONTEXT_MAX_CHARS = 12000;
const TOTAL_CONTEXT_MAX_CHARS = 20000;
const MAX_MATCHED_TOOLS = 2;
const MAX_PROFILE_ROWS = 20000;
const ID_FIELD_RE = /序号|编号|工号|学号|单号|账号|卡号|电话|手机|\bid\b|\bno\b|s\/n|number|code|编码/i;
const ADAPTER_CACHE_MS = 5 * 60 * 1000;
const DATA_INTENT_RE = /多少|几[个次人笔条天]|统计|数据|人次|人数|次数|总[数计共额]|一共|合计|汇总|平均|趋势|对比|比较|分布|排名|最[多少高低]|上个?月|本月|这个月|当月|上周|本周|最近|最新|\d{1,2}\s*月|\d{4}[-/.年]|明细|名单|记录|快照|情况|分析|top|how many|count|total|sum|average|trend|last month|this month|data|records?|snapshot/i;

// ── 工具匹配 ─────────────────────────────────────
function normalize(value) {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9㐀-鿿]+/g, '');
}

function bigrams(value) {
    const text = normalize(value);
    const set = new Set();
    for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2));
    return set;
}

function coreName(name) {
    return String(name || '').replace(/[（(][^）)]*[）)]/g, '').replace(/工具$/, '').trim();
}

function scoreTool(tool, question) {
    const q = normalize(question);
    if (!q) return 0;
    const names = [tool.name, coreName(tool.name)].map(normalize).filter(name => name.length >= 2);
    if (names.some(name => q.includes(name))) return 1;
    const nameEn = normalize(tool.nameEn);
    if (nameEn.length >= 4 && q.includes(nameEn)) return 0.95;
    const nameGrams = bigrams(coreName(tool.name) || tool.name);
    const questionGrams = bigrams(question);
    let shared = 0;
    nameGrams.forEach(gram => { if (questionGrams.has(gram)) shared += 1; });
    let score = nameGrams.size && shared >= 2 ? shared / nameGrams.size : 0;
    if (shared < 3 && score < 0.6) score *= 0.5;
    const tagHits = (Array.isArray(tool.tags) ? tool.tags : [])
        .map(normalize)
        .filter(tag => tag.length >= 3 && q.includes(tag)).length;
    return Math.min(1, score + Math.min(0.4, tagHits * 0.2));
}

function matchTools(question, tools, { preferSlug = '', limit = MAX_MATCHED_TOOLS } = {}) {
    return tools
        .map(tool => ({ tool, score: tool.slug === preferSlug ? 1.5 : scoreTool(tool, question) }))
        .filter(item => item.score >= 0.45)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

// ── 时间范围 ─────────────────────────────────────
function pad(value) {
    return String(value).padStart(2, '0');
}

function monthWindow(year, month, label) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}`, label };
}

function parseWindow(question, now = new Date()) {
    const text = String(question || '');
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (/上个?月|last month/i.test(text)) {
        const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
        return monthWindow(prev[0], prev[1], '上个月');
    }
    if (/本月|这个月|当月|this month/i.test(text)) return monthWindow(year, month, '本月');
    let match = text.match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*月?/);
    if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return monthWindow(Number(match[1]), Number(match[2]), `${match[1]}年${Number(match[2])}月`);
    match = text.match(/(?:^|[^\d])(\d{1,2})\s*月份?/);
    if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) {
        const target = Number(match[1]);
        const targetYear = target > month ? year - 1 : year;
        return monthWindow(targetYear, target, `${targetYear}年${target}月`);
    }
    return null;
}

function overlaps(period, window) {
    if (!period || !window) return false;
    return period.start <= window.end && period.end >= window.start;
}

const DATE_SRC = '(20\\d{2})[-/.年](\\d{1,2})[-/.月](\\d{1,2})日?';
const DATE_RE = new RegExp(DATE_SRC, 'g');
const RANGE_RE = new RegExp(`${DATE_SRC}\\s*(?:至|到|~|～|—|–|-{1,2}|to)\\s*${DATE_SRC}`);
const META_TIME_KEY_RE = /saved|created|updated|timestamp|time$|时间$/i;

// 从快照摘要/名称中提取数据期间：优先“A 至 B”明确范围；其次摘要中除保存/创建时间外的日期；再次名称中的“2026年9月”。
function periodFrom(...values) {
    for (const value of values) {
        const text = typeof value === 'string' ? value : JSON.stringify(value || '');
        const range = text.match(RANGE_RE);
        if (range) return { start: `${range[1]}-${pad(range[2])}-${pad(range[3])}`, end: `${range[4]}-${pad(range[5])}-${pad(range[6])}` };
    }
    for (const value of values) {
        const text = isPlainObject(value)
            ? Object.entries(value).filter(([key]) => !META_TIME_KEY_RE.test(key)).map(([, v]) => JSON.stringify(v)).join(' ')
            : String(value || '');
        const dates = [...text.matchAll(DATE_RE)].map(m => `${m[1]}-${pad(m[2])}-${pad(m[3])}`).sort();
        if (dates.length >= 2) return { start: dates[0], end: dates[dates.length - 1] };
    }
    for (const value of values) {
        const text = typeof value === 'string' ? value : '';
        const match = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
        if (match) return monthWindow(Number(match[1]), Number(match[2]));
    }
    return null;
}

// ── 通用数据摘要 ─────────────────────────────────
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function truncate(value, max = 60) {
    const raw = value && typeof value === 'object' ? JSON.stringify(value) : value;
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

function toDateKey(value, fieldName = '') {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && /日期|时间|date|time/i.test(fieldName) && value > 30000 && value < 70000) {
        const date = new Date(Math.round((value - 25569) * 86400000));
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    }
    const match = String(value).match(/^\s*(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    return match ? `${match[1]}-${pad(match[2])}-${pad(match[3])}` : null;
}

function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value ?? '').replace(/[,\s]/g, '');
    return /^[-+]?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
}

function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// 统一成对象行：对象数组原样；二维数组配合同级 headers；以日期为键的对象视为按日表。
function toRows(value, headers) {
    if (Array.isArray(value)) {
        if (!value.length) return [];
        if (value.every(isPlainObject)) return value;
        if (value.every(Array.isArray)) {
            const keys = Array.isArray(headers) && headers.length ? headers.map((h, i) => String(h || `列${i + 1}`)) : value[0].map((_, i) => `列${i + 1}`);
            return value.map(row => Object.fromEntries(keys.map((key, i) => [key, row[i]])));
        }
        return null;
    }
    if (isPlainObject(value)) {
        const keys = Object.keys(value);
        if (keys.length >= 3 && keys.every(key => toDateKey(key)) && Object.values(value).every(isPlainObject)) {
            return keys.sort().map(key => ({ 日期: key, ...value[key] }));
        }
    }
    return null;
}

const TOTAL_ROW_RE = /^(?:合计|总计|小计|汇总|共计|总和|total|grand total|subtotal|sum)$/i;

function isTotalRow(row) {
    return Object.values(row).some(value => typeof value === 'string' && TOTAL_ROW_RE.test(value.trim()));
}

function profileTable(allRows, label, budget) {
    // 表内“合计/总计”行单独列出、不参与统计，否则合计会被重复累加。
    const totalRows = allRows.filter(isTotalRow);
    const rows = totalRows.length ? allRows.filter(row => !isTotalRow(row)) : allRows;
    const lines = [`${label}：${rows.length} 行${totalRows.length ? `（另有 ${totalRows.length} 行表内合计，未计入下方统计）` : ''}`];
    const sample = rows.slice(0, MAX_PROFILE_ROWS);
    const fields = [...new Set(sample.slice(0, 300).flatMap(row => Object.keys(row)))].slice(0, 40);
    lines.push(`  字段：${fields.join('、')}`);
    for (const field of fields) {
        if (lines.join('\n').length > budget) break;
        const values = sample.map(row => row[field]).filter(value => value !== null && value !== undefined && String(value).trim() !== '');
        if (!values.length) continue;
        const dates = values.map(value => toDateKey(value, field)).filter(Boolean);
        if (dates.length >= values.length * 0.8) {
            const days = new Map();
            dates.forEach(day => days.set(day, (days.get(day) || 0) + 1));
            const sorted = [...days.keys()].sort();
            const byMonth = sorted.length > 40;
            const buckets = new Map();
            sorted.forEach(day => {
                const key = byMonth ? day.slice(0, 7) : day;
                buckets.set(key, (buckets.get(key) || 0) + days.get(day));
            });
            lines.push(`  ${field}：${sorted[0]} 至 ${sorted[sorted.length - 1]}，按${byMonth ? '月' : '日'}行数 ${[...buckets].map(([k, v]) => `${k}=${v}`).join(', ')}`);
            continue;
        }
        const numbers = values.map(toNumber).filter(value => value !== null);
        // 序号、工号、编号等标识字段求和没有意义，只报不同取值数。
        if (ID_FIELD_RE.test(field) && numbers.length >= values.length * 0.8) {
            lines.push(`  ${field}：${new Set(values.map(String)).size} 个不同编号`);
            continue;
        }
        if (numbers.length >= values.length * 0.8) {
            const sum = numbers.reduce((a, b) => a + b, 0);
            lines.push(`  ${field}：合计 ${formatNumber(sum)}，平均 ${formatNumber(sum / numbers.length)}，最小 ${formatNumber(Math.min(...numbers))}，最大 ${formatNumber(Math.max(...numbers))}`);
            continue;
        }
        const counts = new Map();
        values.forEach(value => {
            const key = truncate(value, 40);
            counts.set(key, (counts.get(key) || 0) + 1);
        });
        if (counts.size <= 40) {
            const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12);
            lines.push(`  ${field}：${counts.size} 种取值，${top.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        } else {
            lines.push(`  ${field}：${counts.size} 种不同取值`);
        }
    }
    totalRows.slice(0, 3).forEach(row => {
        lines.push(`  表内合计行：${fields.map(field => `${field}=${truncate(row[field], 30)}`).join('; ')}`);
    });
    if (rows.length <= 40) {
        lines.push(`  全部行：${rows.map(row => fields.map(field => `${field}=${truncate(row[field], 30)}`).join('; ')).join(' | ')}`);
    } else {
        lines.push(`  样例：${rows.slice(0, 2).map(row => fields.slice(0, 12).map(field => `${field}=${truncate(row[field], 24)}`).join('; ')).join(' | ')}`);
    }
    return lines.join('\n').slice(0, budget);
}

function digestValue(value, label = '数据', budget = TOOL_CONTEXT_MAX_CHARS, depth = 0) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return `${label}：${truncate(value, 200)}`;
    const rows = toRows(value);
    if (rows && rows.length) return profileTable(rows, label, budget);
    if (Array.isArray(value)) {
        if (!value.length) return `${label}：空列表`;
        return `${label}：${value.length} 项，${truncate(value.slice(0, 20).map(item => (typeof item === 'object' ? JSON.stringify(item) : item)).join('、'), 400)}`;
    }
    const parts = [];
    const scalars = [];
    // 小的汇总表优先、大的原始明细靠后，预算不足时先保住结果类数据。
    const sizeOf = child => (Array.isArray(child) ? child.length : isPlainObject(child) ? Object.keys(child).length : 0);
    const keys = Object.keys(value).sort((a, b) => sizeOf(value[a]) - sizeOf(value[b]));
    let used = 0;
    for (const key of keys) {
        if (used > budget) break;
        const child = value[key];
        const childLabel = depth ? `${label}.${key}` : key;
        if (child === null || typeof child !== 'object') {
            scalars.push(`${key}=${truncate(child, 80)}`);
            continue;
        }
        const remaining = Math.max(600, budget - used);
        let part = '';
        if (Array.isArray(child) && child.length && child.every(Array.isArray) && Array.isArray(value.headers)) {
            part = profileTable(toRows(child, value.headers), childLabel, remaining);
        } else if (key === 'headers' && Array.isArray(child) && keys.some(other => Array.isArray(value[other]) && value[other].every?.(Array.isArray))) {
            continue;
        } else if (depth < 3) {
            part = digestValue(child, childLabel, remaining, depth + 1);
        }
        if (part) {
            parts.push(part);
            used += part.length + 1;
        }
    }
    const head = scalars.length ? `${label}：${scalars.slice(0, 30).join('; ')}` : '';
    return [head, ...parts].filter(Boolean).join('\n').slice(0, budget);
}

// ── 数据来源适配器 ───────────────────────────────
const adapterCache = new Map();

function toolSourceText(slug) {
    const cached = adapterCache.get(slug);
    if (cached && Date.now() - cached.at < ADAPTER_CACHE_MS) return cached.text;
    let text = '';
    try {
        const dir = path.join(customToolsRepo.getCustomToolsDir(), slug);
        const walk = (current, depth) => {
            if (depth > 2 || text.length > 3_000_000) return;
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) walk(full, depth + 1);
                else if (/\.(html?|js)$/i.test(entry.name) && !/\.min\.js$/i.test(entry.name)) text += fs.readFileSync(full, 'utf8');
            }
        };
        walk(dir, 0);
    } catch {
        text = '';
    }
    adapterCache.set(slug, { at: Date.now(), text });
    return text;
}

// 工具通过哪些专用 API 保存数据（扫描工具源码得出，无需逐个配置）。
function detectDedicatedSources(slug) {
    const text = toolSourceText(slug);
    const has = api => text.includes(api);
    const own = [];
    if (has('/api/department-reward-penalty')) own.push('department-reward-penalty');
    if (has('/api/reward-program')) own.push('reward-program');
    if (has('/api/surveys')) own.push('surveys');
    if (own.length) return own;
    const shared = [];
    if (has('/api/meeting-snapshots')) shared.push('meeting-snapshots');
    if (has('/api/operation-incentive-snapshots')) shared.push('operation-incentive-snapshots');
    return shared;
}

async function readCustomSnapshots(tool, window) {
    const list = await customSnapshotsRepo.listSnapshots(tool.slug);
    if (!list.length) return null;
    const items = list.map(item => ({ ...item, period: periodFrom(item.summary, item.name) }));
    const overview = items.slice(0, 15).map(item => `- ${item.name}｜数据期间 ${item.period ? `${item.period.start} 至 ${item.period.end}` : '未标注'}｜保存于 ${item.timestamp}｜摘要 ${item.summary ? truncate(JSON.stringify(item.summary), 400) : '无'}`);
    const selected = window ? items.filter(item => overlaps(item.period, window)).slice(0, 2) : items.slice(0, 1);
    const details = [];
    for (const item of selected) {
        const full = await customSnapshotsRepo.getSnapshot(tool.slug, item.id);
        if (full?.payload) details.push(digestValue(full.payload, `快照「${item.name}」明细摘要`, selected.length > 1 ? 5000 : 9500));
    }
    return {
        kind: 'custom-snapshots',
        label: '工具快照',
        count: list.length,
        selected: selected.map(item => ({ name: item.name, period: item.period, timestamp: item.timestamp })),
        text: [`[工具快照] 共 ${list.length} 个：`, ...overview,
            window && !selected.length ? `（没有覆盖 ${window.start} 至 ${window.end} 的快照）` : '',
            ...details].filter(Boolean).join('\n')
    };
}

async function readToolState(tool) {
    const state = await customToolsRepo.getToolState(tool.slug);
    const data = state?.data;
    if (!state?.updatedAt || !data || (isPlainObject(data) && !Object.keys(data).length)) return null;
    const history = (state.snapshots || []).slice(0, 10).map(item => `${item.createdAt}（${item.reason}）`).join('、');
    return {
        kind: 'tool-state',
        label: '工具状态',
        count: 1,
        selected: [{ name: '当前数据', timestamp: state.updatedAt }],
        text: [`[工具状态] 最近保存 ${state.updatedAt}${history ? `；历史版本：${history}` : ''}`, digestValue(data, '当前数据', 6000)].join('\n')
    };
}

async function readDedicated(source, window) {
    if (source === 'meeting-snapshots' || source === 'operation-incentive-snapshots') {
        const repo = require(source === 'meeting-snapshots' ? './meeting-snapshots-repository' : './operation-incentive-snapshots-repository');
        const list = await repo.listSnapshots(window ? { startDate: window.start, endDate: window.end } : {});
        const rows = (Array.isArray(list) ? list : list?.items || []).slice(0, 60)
            .map(({ payload, payload_json: _payloadJson, ...rest }) => rest);
        return {
            kind: source,
            label: source === 'meeting-snapshots' ? '会议考勤快照' : '操作激励快照',
            count: rows.length,
            selected: [],
            text: digestValue(rows, `[${source === 'meeting-snapshots' ? '会议考勤快照' : '操作激励快照'}${window ? ` ${window.start}~${window.end}` : ''}]`, 6000)
        };
    }
    if (source === 'department-reward-penalty') {
        const state = await require('./department-reward-penalty-repository').list();
        const { snapshotMappings, ...data } = state || {};
        return { kind: source, label: '负向事件数据', count: (data.records || []).length, selected: [], text: digestValue(data, '[负向事件数据]', 6000) };
    }
    if (source === 'reward-program') {
        const apps = await require('./reward-program-repository').listApplications('', true);
        return { kind: source, label: '奖励申报数据', count: apps.length, selected: [], text: digestValue(apps, '[奖励申报]', 6000) };
    }
    if (source === 'surveys') {
        const repo = require('./survey-repository');
        const [templates, submissions] = await Promise.all([repo.listTemplates(), repo.listAllSubmissions()]);
        return {
            kind: source,
            label: '问卷数据',
            count: submissions.length,
            selected: [],
            text: [digestValue(templates.map(item => ({ id: item.id, title: item.title || item.name, createdAt: item.createdAt })), '[问卷模板]', 1500), digestValue(submissions, '[问卷提交]', 4500)].join('\n')
        };
    }
    return null;
}

function readClientData(tool, clientToolData) {
    const entries = (Array.isArray(clientToolData) ? clientToolData : [])
        .filter(item => item && item.slug === tool.slug && typeof item.key === 'string' && !SECRET_KEY_RE.test(item.key))
        .slice(0, 6);
    if (!entries.length) return null;
    const text = entries.map(item => {
        let value = item.value;
        try { value = JSON.parse(item.value); } catch { /* 非 JSON 文本按原样摘要 */ }
        return digestValue(value, `[浏览器本地 ${truncate(item.key, 60)}]`, 3000);
    }).join('\n');
    return { kind: 'browser-local', label: '浏览器本地数据', count: entries.length, selected: entries.map(item => ({ name: item.key })), text };
}

async function collectToolData(tool, window, clientToolData) {
    const tasks = [
        readCustomSnapshots(tool, window),
        readToolState(tool),
        ...detectDedicatedSources(tool.slug).map(source => readDedicated(source, window))
    ];
    const settled = await Promise.allSettled(tasks);
    settled.filter(item => item.status === 'rejected').forEach(item => console.warn('[AI] tool data source skipped:', item.reason?.message || item.reason));
    const sources = settled.filter(item => item.status === 'fulfilled' && item.value).map(item => item.value);
    const client = readClientData(tool, clientToolData);
    if (client) sources.push(client);
    return sources;
}

async function analyzeQuestion(question, { contextQuestion = '', toolSlug = '', clientToolData = [], now = new Date() } = {}) {
    const combined = [contextQuestion, question].filter(Boolean).join('\n');
    const preferSlug = String(toolSlug || '').replace(/^custom:/, '');
    if (!DATA_INTENT_RE.test(combined)) return { performed: false, tools: [], prompt: '' };
    const tools = await customToolsRepo.listTools();
    const candidates = matchTools(combined, tools, { preferSlug, limit: MAX_MATCHED_TOOLS + 2 });
    if (!candidates.length) return { performed: true, tools: [], prompt: '' };
    const window = parseWindow(question, now) || parseWindow(contextQuestion, now);
    const collected = [];
    for (const { tool, score } of candidates) {
        collected.push({ tool, score, sources: await collectToolData(tool, window, clientToolData) });
    }
    // 名称相近的多个工具中，优先有业务数据的；都没有数据时保留最相关的一个用于说明。
    const withData = collected.filter(item => item.sources.length);
    const results = (withData.length ? withData : collected.slice(0, 1)).slice(0, MAX_MATCHED_TOOLS);
    let prompt = window ? `问题时间范围：${window.start} 至 ${window.end}（${window.label}）\n` : '问题未指定时间范围：默认使用最新数据\n';
    for (const { tool, sources } of results) {
        const block = [
            `【工具】${tool.name}（${tool.href}）`,
            sources.length ? sources.map(source => source.text).join('\n') : '该工具在服务端没有保存业务数据（可能只在用户浏览器中处理），无法读取。'
        ].join('\n');
        prompt += `${block.slice(0, TOOL_CONTEXT_MAX_CHARS)}\n\n`;
    }
    return {
        performed: true,
        window,
        tools: results.map(({ tool, score, sources }) => ({
            slug: tool.slug,
            name: tool.name,
            href: tool.href,
            score: Number(score.toFixed(2)),
            sources: sources.map(({ kind, label, count, selected }) => ({ kind, label, count, selected }))
        })),
        prompt: prompt.slice(0, TOTAL_CONTEXT_MAX_CHARS)
    };
}

// 前端读取浏览器本地数据所需：各工具源码中出现的 localStorage 键名（排除语言、主题、分页等界面偏好）。
// 凭据类键名一律不读取、不发送给模型。
const SECRET_KEY_RE = /secret|token|passw|credential|auth|api_?key|private/i;
const UI_PREF_KEY_RE = /lang|language|theme|page_?size|sidebar|collapsed|expanded|seen|intro|faves|_view$|view$|filters?_?pagination|analytics_open|template/i;
function listLocalStorageKeys(tools) {
    const result = {};
    for (const tool of tools) {
        const text = toolSourceText(tool.slug);
        const keys = new Set();
        const candidates = [
            ...[...text.matchAll(/localStorage\.(?:getItem|setItem)\(\s*(['"`])([^'"`$]{2,80})\1/g)].map(match => match[2]),
            // 常见写法：const STORAGE_KEY = '...'; localStorage.setItem(STORAGE_KEY, ...)
            ...(text.includes('localStorage')
                ? [...text.matchAll(/(?:const|let|var)\s+[A-Za-z_$]*(?:KEY|Key|key)[A-Za-z_$]*\s*=\s*(['"`])([^'"`$\s]{3,80})\1/g)].map(match => match[2])
                : [])
        ];
        candidates.forEach(key => {
            if (key.length >= 4 && !/^tools_/.test(key) && !UI_PREF_KEY_RE.test(key) && !SECRET_KEY_RE.test(key)) keys.add(key);
        });
        if (keys.size) result[tool.slug] = [...keys].slice(0, 12);
    }
    return result;
}

module.exports = {
    analyzeQuestion,
    digestValue,
    listLocalStorageKeys,
    matchTools,
    parseWindow,
    periodFrom,
    scoreTool
};
