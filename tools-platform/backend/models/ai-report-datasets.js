// Dataset catalog for AI report cells: every platform module and custom tool that stores data is exposed as tables
// (arrays of records found in its JSON), resolved per report month. Columns that look like secrets are never exposed.
const rules = require('../../frontend/js/monthly-designer/source-rules');

const SECRET_KEY_RE = /secret|token|passw|credential|auth|api_?key|private|cookie/i;
const MAX_ROWS = 50000;
const MAX_DATASETS_PER_SOURCE = 16;
const MAX_DEPTH = 5;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = key => !SECRET_KEY_RE.test(String(key));

// First YYYY-MM found in the usual period fields, so snapshots can be matched to a report month.
function monthOf(item, fields = ['month', 'period', 'targetMonth', 'target_period', 'startDate', 'name', 'timestamp', 'capturedAt', 'createdAt']) {
    for (const field of fields) {
        const match = String(item?.[field] ?? '').match(/(20\d{2})[-_年/.]?(0[1-9]|1[0-2])(?!\d)/);
        if (match) return `${match[1]}-${match[2]}`;
    }
    return '';
}

// Rows keep scalar values and flatten one level of nested objects (a.b); nested arrays are left out.
function toRow(value, prefix = '') {
    const row = {};
    if (!isPlainObject(value)) return { value };
    for (const [key, item] of Object.entries(value)) {
        if (!safeKey(key)) continue;
        if (isPlainObject(item) && !prefix) Object.assign(row, toRow(item, key + '.'));
        else if (!Array.isArray(item) && !isPlainObject(item)) row[prefix + key] = item;
    }
    return row;
}

// Walks a JSON value and returns every array of records, plus maps of records ({TE:{…}, ORG:{…}}) as keyed rows.
function findTables(value, path = '', depth = 0, found = []) {
    if (found.length >= MAX_DATASETS_PER_SOURCE || depth > MAX_DEPTH || value === null || typeof value !== 'object') return found;
    if (Array.isArray(value)) {
        const records = value.filter(isPlainObject);
        if (records.length && records.length >= value.length * 0.6) found.push({ path: path || '(root)', rows: () => records.slice(0, MAX_ROWS).map(item => toRow(item)) });
        else value.slice(0, 3).forEach((item, index) => findTables(item, `${path}[${index}]`, depth + 1, found));
        return found;
    }
    const entries = Object.entries(value).filter(([key]) => safeKey(key));
    // Groups of same-shaped record lists keyed by date or name ({"2026-10-07":[…], …}) become one table with a group column.
    const groups = entries.filter(([, item]) => Array.isArray(item) && item.length && item.every(isPlainObject));
    if (groups.length >= 3 && groups.length >= entries.length * 0.8) {
        found.push({ path: path ? `${path}.*` : '*', rows: () => groups.flatMap(([key, list]) => list.map(item => ({ group: key, ...toRow(item) }))).slice(0, MAX_ROWS) });
        return found;
    }
    const objectValues = entries.filter(([, item]) => isPlainObject(item) && Object.keys(item).length >= 2);
    if (path && objectValues.length >= 2 && objectValues.length === entries.length) {
        found.push({ path, rows: () => objectValues.slice(0, MAX_ROWS).map(([key, item]) => ({ key, ...toRow(item) })) });
    }
    for (const [key, item] of entries) if (item && typeof item === 'object') findTables(item, path ? `${path}.${key}` : key, depth + 1, found);
    return found;
}

function columnsOf(rows) {
    const columns = new Set();
    for (const row of rows.slice(0, 200)) Object.keys(row).forEach(key => columns.add(key));
    return [...columns].slice(0, 80);
}

// Each connector lists its JSON documents for a month: { scope, name, period, value }.
const connectors = {
    sla: { label: 'SLA 导入快照', async documents(month) {
        const out = await require('./sla-snapshots-repository').listSnapshots({ includePayload: true });
        const list = Array.isArray(out) ? out : out?.items || [];
        const forMonth = list.filter(item => slaMonth(item) === month).sort((a, b) => rules.time(b.timestamp) - rules.time(a.timestamp));
        return forMonth.slice(0, 1).map(item => ({ scope: 'latest', name: `SLA 快照 ${item.timestamp}`, period: month, value: item }));
    } },
    frt: { label: 'FRT 快照', async documents(month) {
        const out = await require('./frt-snapshots-repository').listSnapshots({});
        const list = (Array.isArray(out) ? out : out?.items || []).filter(item => monthOf(item) === month);
        return list.slice(0, 1).map(item => ({ scope: 'latest', name: `FRT ${item.month || ''}`, period: month, value: item }));
    } },
    monthlySnapshots: { label: '月度快照', async documents(month) {
        const list = await require('./monthly-snapshots-repository').listSnapshots({ month, includePayload: true });
        return (Array.isArray(list) ? list : list?.items || []).map(item => ({ scope: `${item.toolKey}/${item.topicKey}`, name: item.name || item.toolKey, period: month, value: item.payload?.projectData || item.payload || item }));
    } },
    topic: { label: '专题分析快照', async documents(month) {
        const repo = require('./topic-snapshots-repository');
        const out = await repo.listSnapshots({});
        const list = (Array.isArray(out) ? out : out?.items || []).filter(item => monthOf(item) === month);
        const documents = [];
        for (const item of list.slice(0, 4)) {
            const full = await repo.getSnapshot(item.id).catch(() => null);
            documents.push({ scope: item.platform || item.id, name: item.name || item.platform, period: month, value: full?.payload || full || item });
        }
        return documents;
    } },
    meeting: { label: '会议考勤快照', async documents(month) { return periodSnapshots('./meeting-snapshots-repository', month); } },
    incentive: { label: '操作激励快照', async documents(month) { return periodSnapshots('./operation-incentive-snapshots-repository', month); } },
    duty: { label: '夜间值班表', async documents(month) {
        const roster = await require('./duty-roster-repository').getDutyRoster(month);
        return roster?.isSaved ? [{ scope: 'month', name: roster.title || `值班表 ${month}`, period: month, value: roster }] : [];
    } },
    rewardPenalty: { label: '部门奖惩（负向事件）', async documents() {
        const { snapshotMappings, ...state } = await require('./department-reward-penalty-repository').list() || {};
        return [{ scope: 'current', name: '负向事件数据', period: 'current', value: state }];
    } },
    rewardProgram: { label: '奖励申报', async documents() {
        return [{ scope: 'current', name: '奖励申报', period: 'current', value: { applications: await require('./reward-program-repository').listApplications('', true) } }];
    } },
    surveys: { label: '问卷', async documents() {
        const repo = require('./survey-repository');
        return [{ scope: 'current', name: '问卷提交', period: 'current', value: { submissions: await repo.listAllSubmissions() } }];
    } },
    tools: { label: '自定义工具', async documents(month) {
        const toolsRepo = require('./custom-tools-repository');
        const snapshotsRepo = require('./custom-tools-snapshots-repository');
        const documents = [];
        for (const tool of await toolsRepo.listTools()) {
            const state = await toolsRepo.getToolState(tool.slug).catch(() => null);
            if (state?.data && JSON.stringify(state.data).length > 2) documents.push({ scope: `${tool.slug}:state`, name: `${tool.name}（当前数据）`, period: 'current', value: state.data });
            const snapshots = await snapshotsRepo.listSnapshots(tool.slug).catch(() => []);
            const match = snapshots.find(item => monthOf({ name: item.name, summary: JSON.stringify(item.summary || '') }, ['name', 'summary']) === month);
            if (match) {
                const full = await snapshotsRepo.getSnapshot(tool.slug, match.id).catch(() => null);
                if (full?.payload) documents.push({ scope: `${tool.slug}:snapshot`, name: `${tool.name}（${month} 快照）`, period: month, value: full.payload });
            }
        }
        return documents;
    } }
};

function slaMonth(item) {
    const target = Number(item.selectedTargetMonth);
    if (!(target >= 1 && target <= 12)) return monthOf(item);
    const date = new Date(item.timestamp);
    const year = date.getUTCFullYear() - (target - (date.getUTCMonth() + 1) >= 6 ? 1 : 0);
    return `${year}-${String(target).padStart(2, '0')}`;
}

async function periodSnapshots(module, month) {
    const out = await require(module).listSnapshots({ includePayload: true });
    const list = (Array.isArray(out) ? out : out?.items || []).filter(item => monthOf(item) === month);
    return list.slice(0, 2).map(item => ({ scope: 'latest', name: item.name || item.period || month, period: month, value: item.payload || item }));
}

// One pass over every connector for a month; failures in one source never hide the others.
async function collect(month) {
    const tables = [];
    const errors = [];
    for (const [connector, { label, documents }] of Object.entries(connectors)) {
        try {
            for (const document of await documents(month)) {
                for (const table of findTables(document.value)) {
                    tables.push({ id: `${connector}|${document.scope}|${table.path}`, source: label, document: document.name, path: table.path, period: document.period, rows: table.rows });
                }
            }
        } catch (error) {
            errors.push({ source: label, error: error.message });
        }
    }
    return { tables, errors };
}

async function listDatasets(month) {
    const { tables, errors } = await collect(month);
    return {
        datasets: tables.map(table => {
            const rows = table.rows();
            return { id: table.id, source: table.source, name: `${table.document} · ${table.path}`, period: table.period, rowCount: rows.length, columns: columnsOf(rows).slice(0, 30) };
        }).filter(item => item.rowCount),
        unavailable: errors
    };
}

async function readDataset(id, month, { sample = 0 } = {}) {
    const { tables } = await collect(month);
    const table = tables.find(item => item.id === id);
    if (!table) return null;
    const rows = table.rows();
    return { id, month, source: table.source, name: `${table.document} · ${table.path}`, period: table.period, headers: columnsOf(rows), rowCount: rows.length, rows: sample ? rows.slice(0, sample) : rows };
}

module.exports = { listDatasets, readDataset, findTables, monthOf };
