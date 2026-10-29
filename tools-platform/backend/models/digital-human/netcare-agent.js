// @netcare-data Skill 的工具：管理员在首页 Dragon Claw（普通对话，不选工作目录）里经数字人基座只读查询 NetCare。
// netcare_tables / netcare_describe / netcare_query / netcare_sql 全部只读，直接执行；应用库写入不开放给模型。
// 工具循环用 agent-loop（与工作区同一套引擎）。
const configRepo = require('./config-repository');
const client = require('./base-client');
const catalog = require('./table-catalog');
const agentLoop = require('../agent-loop');

const SKILL_ID = 'netcare-data';
const RESULT_CHARS = 24 * 1024;
const MAX_MODEL_ROWS = 500;
const TOOL_NAMES = ['netcare_tables', 'netcare_describe', 'netcare_query', 'netcare_sql'];

const SCOPE_PROPERTY = { type: 'string', enum: ['business', 'app'], description: 'business=NetCare 业务库（默认，只读）；app=本应用 schema' };

function definitions() {
    return [{
        name: 'netcare_tables',
        description: '在 NetCare 表目录中找表：返回表名、中文名、模块、类别、粒度、估算行数、是否已核对、标注说明。关键词匹配表名 / 中文名 / 模块 / 说明。',
        parameters: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '关键词，如 风险、license、rectify、整改；可空格分隔多个（任一命中）' },
                category: { type: 'string', description: '类别，如 风险、整改、任务/工单、网络、IOC运营' },
                onlyWithData: { type: 'boolean', description: '只看有数据的表，默认 true' },
                scope: SCOPE_PROPERTY,
                limit: { type: 'integer', description: '最多返回条数，默认 40，上限 120' }
            }
        }
    }, {
        name: 'netcare_describe',
        description: '查看一张表的字段（名称、类型、注释、识别出的时间/地区部/代表处字段、取值形态、占位值）、标注、取数提示和几行样例。',
        parameters: {
            type: 'object',
            properties: {
                table: { type: 'string', description: '表名（不带库名）' },
                scope: SCOPE_PROPERTY,
                sampleRows: { type: 'integer', description: '样例行数，默认 5，上限 20' }
            },
            required: ['table']
        }
    }, {
        name: 'netcare_query',
        description: '对一张表做结构化只读查询：选择字段、AND 过滤、分组、聚合（count/count_distinct/sum/avg/min/max）、排序、限制行数。字段名必须是真实字段。统计请用 metrics + groupBy 在库里聚合。',
        parameters: {
            type: 'object',
            properties: {
                table: { type: 'string', description: '表名（不带库名）' },
                scope: SCOPE_PROPERTY,
                columns: { type: 'array', items: { type: 'string' }, description: '返回字段；有分组/聚合时忽略' },
                filters: {
                    type: 'array',
                    description: '过滤条件（AND）',
                    items: {
                        type: 'object',
                        properties: {
                            column: { type: 'string' },
                            op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'like', 'not like', 'in', 'not in', 'between', 'is null', 'is not null'] },
                            value: { description: '值；in/not in 传数组；between 传 [起, 止]；like 用 % 通配' }
                        },
                        required: ['column', 'op']
                    }
                },
                groupBy: { type: 'array', items: { type: 'string' }, description: '分组字段' },
                metrics: {
                    type: 'array',
                    description: '聚合',
                    items: {
                        type: 'object',
                        properties: {
                            agg: { type: 'string', enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] },
                            column: { type: 'string', description: 'count 可省略（COUNT(*)）' },
                            as: { type: 'string', description: '结果列名' }
                        },
                        required: ['agg']
                    }
                },
                orderBy: { type: 'string', description: '排序字段或聚合别名' },
                order: { type: 'string', enum: ['asc', 'desc'] },
                limit: { type: 'integer', description: `返回行数，默认 100，上限 ${MAX_MODEL_ROWS}` }
            },
            required: ['table']
        }
    }, {
        name: 'netcare_sql',
        description: '执行一条只读 SQL（SELECT / WITH），用于多表关联等 netcare_query 做不到的查询。业务表写 netcare.表名；应用 schema（scope=app）表名不带库名。务必带 LIMIT 或聚合。',
        parameters: {
            type: 'object',
            properties: {
                sql: { type: 'string', description: '单条只读 SQL' },
                scope: SCOPE_PROPERTY,
                maxRows: { type: 'integer', description: `最多返回行数，默认 200，上限 ${MAX_MODEL_ROWS}` }
            },
            required: ['sql']
        }
    }];
}

const clampInt = (value, min, max, fallback) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const scopeOf = value => (value === 'app' ? 'app' : 'business');

// 结果按字符预算截断：先保证列名与前几行，超出时注明还有多少行没给模型
function rowsText(rows, { sql, truncated } = {}) {
    const lines = [];
    if (sql) lines.push(`SQL: ${sql}`);
    lines.push(`共 ${rows.length} 行${truncated ? '（已达上限，结果被截断）' : ''}`);
    let used = lines.join('\n').length;
    let shown = 0;
    for (const row of rows) {
        const line = JSON.stringify(row);
        if (used + line.length + 1 > RESULT_CHARS) break;
        lines.push(line);
        used += line.length + 1;
        shown += 1;
    }
    if (shown < rows.length) lines.push(`…另有 ${rows.length - shown} 行未展示（结果过长），请缩小范围或改用聚合`);
    return lines.join('\n');
}

async function findTables(args) {
    const scope = scopeOf(args.scope);
    const result = await catalog.listTables({ scope });
    const words = String(args.keyword || '').toLowerCase().split(/\s+/).filter(Boolean);
    const category = String(args.category || '').trim();
    const onlyWithData = args.onlyWithData !== false;
    const limit = clampInt(args.limit, 1, 120, 40);
    const matched = result.tables.filter(table => {
        if (table.hidden) return false;
        if (onlyWithData && (table.empty || table.status === 'missing')) return false;
        if (category && !table.category.includes(category)) return false;
        if (!words.length) return true;
        const text = `${table.name} ${table.nameCn} ${table.module} ${table.category} ${table.description}`.toLowerCase();
        return words.some(word => text.includes(word));
    }).sort((a, b) => Number(b.verified) - Number(a.verified) || Number(Boolean(b.nameCn)) - Number(Boolean(a.nameCn)) || b.rows - a.rows);
    const lines = [
        `${result.live ? `实时目录（${result.schema}）` : `基座不可达，以下为全表盘点种子清单（${result.error || ''}）`}：匹配 ${matched.length} 张${matched.length > limit ? `，显示前 ${limit} 张` : ''}`,
        '表名 | 中文名 | 模块 | 类别 | 粒度 | 估算行数 | 已核对 | 说明'
    ];
    for (const table of matched.slice(0, limit)) {
        lines.push([table.name, table.nameCn || '-', table.module || '-', table.category || '-', table.grain || '-', table.rows, table.verified ? '是' : '否', (table.description || table.review || '').slice(0, 80) || '-'].join(' | ') + (table.family ? `（分区族 ${table.family}）` : ''));
    }
    return { content: lines.join('\n'), summary: `找到 ${matched.length} 张表` };
}

async function describe(args) {
    const scope = scopeOf(args.scope);
    const detail = await catalog.describeTable(scope, String(args.table || ''), { sampleRows: clampInt(args.sampleRows, 0, 20, 5) });
    const note = detail.note || {};
    const lines = [`表 ${detail.schema}.${detail.name}${note.nameCn || detail.seed?.nameCn ? `（${note.nameCn || detail.seed?.nameCn}）` : ''}，${detail.columns.length} 个字段`];
    if (note.description) lines.push(`标注说明：${note.description}`);
    if (note.timeField || note.regionField || note.officeField) lines.push(`标注字段：时间=${note.timeField || '-'}，地区部=${note.regionField || '-'}，代表处=${note.officeField || '-'}${note.verified ? '（已核对）' : ''}`);
    else lines.push(`建议字段：时间=${detail.suggestions.timeField || '-'}，地区部=${detail.suggestions.regionField || '-'}，代表处=${detail.suggestions.officeField || '-'}`);
    if (detail.hints.length) lines.push(`提示：${detail.hints.join('；')}`);
    lines.push('字段 | 类型 | 注释 | 识别 | 形态 | 占位值 | 示例');
    for (const column of detail.columns) {
        lines.push([column.name, column.columnType || column.dataType, column.comment || '-', column.role || '-', column.kinds.join('/') || '-', column.sentinels.join('/') || '-', column.examples.join(' ; ').slice(0, 120) || '-'].join(' | '));
    }
    if (detail.sample.length) {
        lines.push(`样例 ${detail.sample.length} 行：`);
        for (const row of detail.sample) lines.push(JSON.stringify(row).slice(0, 1500));
    }
    let content = lines.join('\n');
    if (content.length > RESULT_CHARS) content = `${content.slice(0, RESULT_CHARS)}\n…（已截断）`;
    return { content, summary: `${detail.name}：${detail.columns.length} 个字段` };
}

async function query(args) {
    const scope = scopeOf(args.scope);
    const result = await catalog.queryTable(scope, { ...args, limit: clampInt(args.limit, 1, MAX_MODEL_ROWS, 100) });
    return { content: rowsText(result.rows, result), summary: `${args.table}：${result.rows.length} 行` };
}

async function sql(args) {
    const scope = scopeOf(args.scope);
    const result = await client.queryAll(args.sql, { scope, maxRows: clampInt(args.maxRows, 1, MAX_MODEL_ROWS, 200) });
    return { content: rowsText(result.rows, { sql: String(args.sql).slice(0, 600), truncated: result.truncated }), summary: `SQL：${result.rows.length} 行` };
}

const HANDLERS = { netcare_tables: findTables, netcare_describe: describe, netcare_query: query, netcare_sql: sql };

async function execute(name, args = {}) {
    const handler = HANDLERS[name];
    if (!handler) return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    try {
        const config = await configRepo.getConfig();
        if (!config.enabled) throw client.dhError('DH_DISABLED', '数字人对接未启用：请到「全局设置 › 频道对接 › 数字人」导入配置并启用');
        return await handler(args && typeof args === 'object' ? args : {});
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
    }
}

function describeCall(name, args = {}) {
    if (name === 'netcare_tables') return [args.keyword, args.category].filter(Boolean).join(' / ') || '全部';
    if (name === 'netcare_sql') return String(args.sql || '').replace(/\s+/g, ' ').slice(0, 160);
    return `${args.scope === 'app' ? 'app.' : ''}${args.table || ''}`;
}

async function buildPrompt() {
    const config = await configRepo.getConfig();
    const lines = ['', '【NetCare 数据工具（@netcare-data）】'];
    if (!config.enabled) {
        lines.push('数字人对接尚未启用。请告诉用户到「全局设置 › 频道对接 › 数字人」粘贴配置导入、测试连接并启用。');
        return lines.join('\n');
    }
    lines.push(
        `用 netcare_tables / netcare_describe / netcare_query / netcare_sql 经数字人基座只读查询 NetCare 业务库（${config.businessSchema}）${configRepo.appReady(config) ? '与本应用 schema' : ''}。结果以工具返回为准，不要编造表名、字段或数字。`,
        `今天是 ${new Date().toLocaleDateString('sv-SE')}（平台服务器本地时间）。`,
        '先找表、看字段再查询；统计用聚合在库里算；回答时说明所用表、条件、时间范围和是否全量，并附 SQL 摘要。',
        '需要查询时在本轮直接调用工具，不要只回复「请稍等 / 正在查询」就结束。'
    );
    return lines.join('\n');
}

const PROMISE_ONLY_RE = /请稍等|稍等|稍候|正在(为你|帮你|通过|查询|搜索|拉取|获取|调用)|我来(帮你|为你)?(查|搜|看|拉)|马上(帮你|为你)?(查|搜)/;

/**
 * 带 netcare_* 只读工具的一轮回复：工具循环用 agent-loop（与工作区同一套引擎，含续写、空回复提示、自动压缩）。
 * @returns {Promise<{text, usage, toolLog}>}
 */
async function runTurn({ client: aiClient, systemInstruction, messages, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null }) {
    let nudged = false;
    const result = await agentLoop.runToolLoop({
        extras, // 附加工具组：浏览器、MCP（管理员的首页对话）
        client: aiClient, model, systemPrompt: systemInstruction, messages, tools: definitions(),
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'netcare',
        maxEmptyNudges: 1, // 查询结果出来后回复为空：直接不带工具、放宽额度再问一次
        executeCall: async (call, { start }) => {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            start({ tool: TOOL_NAMES.includes(call.name) ? call.name : 'netcare_query', args: { command: describeCall(call.name, args) } });
            const outcome = await execute(call.name, args);
            return { ...outcome, ...(outcome.isError ? { output: String(outcome.content || '').slice(0, 2000) } : {}) };
        },
        // 模型只说「请稍等 / 正在查询」却没有调用工具：补一次提示，让它真正去查
        review: ({ text, toolLog }) => {
            if (nudged || toolLog.length || text.length >= 400 || !PROMISE_ONLY_RE.test(text)) return null;
            nudged = true;
            return { nudge: '（系统提示：请现在直接调用工具执行，拿到结果后再回答，不要只描述将要做什么。）' };
        },
        toolsUnsupported: () => ({ note: '（当前模型不支持工具调用，NetCare 查询暂不可用；请说明需要管理员切换支持函数调用的模型。）' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = { SKILL_ID, TOOL_NAMES, definitions, execute, buildPrompt, runTurn, rowsText };
