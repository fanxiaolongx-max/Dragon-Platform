// 首页普通对话的数据库工具：无需工作目录，不开放文件、Shell 或频道工具。工具循环用 agent-loop（与工作区同一套引擎）。
const toolsService = require('./agent-tools-service');
const agentLoop = require('./agent-loop');
const { redactText, redactValue } = require('./ai-sensitive-data');
const scriptService = require('./agent-script-service');
const filesAgent = require('./ai-files-agent');

const TOOL_NAMES = new Set(['list_databases', 'database_schema', 'read_database_table',
    'insert_database_row', 'update_database_rows', 'delete_database_rows',
    'list_uiv_scripts', 'list_uiv_categories', 'read_uiv_script', 'save_uiv_script', 'move_uiv_script', 'delete_uiv_script', 'manage_uiv_category', 'memory']);

const PROMPT = `
**当前对话的数据库能力**
当前账号是管理员，首页普通对话已提供当前租户全部平台业务 SQLite 的增删改查工具，无需选择工作目录。
本条权限说明和工具列表优先于历史摘要、旧回复中“只有只读权限”的说法；不要沿用旧权限结论。
先 list_databases，再 database_schema / read_database_table 确认库、表结构和目标行；必须使用工具实际返回的库标识。
管理员明确要求修改时，直接用 insert_database_row / update_database_rows / delete_database_rows 执行并重新查询验证，不能只给 SQL 或让用户自行操作。没有修改请求时不得自行写入。
UIVF12 脚本仓库必须使用专用脚本工具，不能直接写 uiv_scripts 单列；脚本移动分类用 move_uiv_script，分类目录的新建/改名/删除用 manage_uiv_category，站点迁移用 save_uiv_script 的 targetSite，并保留地区/代表处筛选。
filters 精确定位；整表操作需要用户明确要求该范围，并显式设置 allowAllRows=true 和 maxAffectedRows。
脚本内容写入允许鉴权逻辑与原有凭据，服务端复制/重建保留完整原文，读取给模型/日志仍脱敏。不要沿用旧对话的“CSRF 占位符禁止克隆”结论。修复不代表删除授权；同名时按 suggestedCall 原位 rebuild，不能先删后建或交付空框架。
查询结果 readOnly=true 只说明这次读取没有写入；writable 才是数据库写权限，不得据此误报整个会话只读。
事实依据本轮实时工具结果；写入前的检索摘要不能作为修改后状态。只有工具返回提交成功才能声称已修改；错误如实说明。
历史报表保留入库口径，除非用户明确要求，不用当前规则重算。数据库提交不能通过文件撤销回滚。
账号、会话、租户控制面、凭据及其他租户数据仍不开放。其他本地 SQLite 需要先选择工作目录；当前工具不支持 MySQL/PostgreSQL 等外部数据库连接，也不提供任意 SQL 或 DDL。`;

/**
 * ctx.owner（租户::账号）与 ctx.chatSessionId 用于把大结果存成本人文件；不给时结果按原上限截断。ctx.username 用于长期记忆，ctx.uploads 是对话里的附件。
 * @returns {Promise<{text, usage, toolLog, toolsUnsupported?}>}
 */
async function runTurn({ client, systemInstruction, messages, ctx, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null, vision = null }) {
    if (ctx.readOnly !== false) throw Object.assign(new Error('数据库写入仅对管理员开放'), { code: 'AGENT_DATABASE_FORBIDDEN' });
    // 对话里上传过附件时，带上只读的附件工具（read_file / read_document / query_data / diff_files）
    const files = filesAgent.toolset({ ...ctx, signal });
    const tools = [...toolsService.definitions().filter(tool => TOOL_NAMES.has(tool.name)), ...(files ? files.definitions : [])];
    const sensitiveValues = ctx.sensitiveValues || [];
    // 普通对话不接受客户端提供的文件根目录或其他执行上下文。
    const toolCtx = { readOnly: false, sensitiveValues, signal, fullResults: Boolean(ctx.owner), username: ctx.username || '',
        currentUserMessage: messages.at(-1)?.content || '', userMessages: messages.filter(item => item.role === 'user').map(item => item.content) };
    const safe = value => redactValue(value, { secrets: sensitiveValues });
    let scriptNudged = false;
    const result = await agentLoop.runToolLoop({
        extras, // 附加工具组：浏览器、MCP（管理员的首页对话）
        vision, // 看图：view_image 与工具取得的图片
        client, model, systemPrompt: redactText(`${systemInstruction}\n${PROMPT}${files ? files.prompt : ''}`, { secrets: sensitiveValues }), messages, tools,
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, sensitiveValues, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'database',
        artifactOwner: ctx.owner || '', artifactSession: ctx.chatSessionId || 'home',
        executeCall: async (call, { start }) => {
            const args = safe(call.args && typeof call.args === 'object' ? call.args : {});
            start({ args });
            if (files?.names.has(call.name)) return files.execute(call.name, args);
            const outcome = TOOL_NAMES.has(call.name)
                ? await toolsService.execute(toolCtx, call.name, args)
                : { content: '当前对话不提供该工具', summary: '工具不可用', isError: true };
            return { ...outcome, output: String(outcome.content || '').slice(0, toolsService.LIMITS.resultChars) };
        },
        review: ({ text, toolLog }) => {
            if (scriptNudged || !systemInstruction.includes('### @script-data')
                || !scriptService.shouldContinue({ question: messages.at(-1)?.content, text, toolLog })) return null;
            scriptNudged = true;
            return { nudge: '（执行提示：本轮缺少与结论对应的提交或回读依据。请先用专用工具读取真实状态，按用户最新范围完成必要修改并核对；不要只说建议入库，也不要无依据声称已还原/已完成。缺少信息或工具拒绝时如实说明。）' };
        },
        toolsUnsupported: () => ({ note: '当前模型不支持工具调用，本轮无法读取或修改数据库。请说明需切换支持工具调用的模型，不得声称已执行。' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = { runTurn };
