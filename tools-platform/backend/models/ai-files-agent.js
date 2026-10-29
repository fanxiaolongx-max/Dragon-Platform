// 首页对话的附件：用户在对话里上传的文件，存在本人附件目录（agent-artifacts.uploadDir），只读。
// 不选工作目录时，用 read_file / read_document / query_data / diff_files 读取这些附件（用完整路径）；
// 管理员的数据库对话带上同一组工具，其他账号没有别的工具时走这里的 runTurn。工具循环用 agent-loop。
const toolsService = require('./agent-tools-service');
const agentLoop = require('./agent-loop');
const { redactText } = require('./ai-sensitive-data');
const path = require('path');

const FILE_TOOLS = ['read_file', 'read_document', 'query_data', 'diff_files'];

function describeSize(bytes) {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * 附件工具集：{ definitions, names, prompt, execute }；没有附件时返回 null。
 * @param {object} ctx { owner（租户::账号）, uploads（本人附件的完整路径）, sensitiveValues, signal }
 */
function toolset(ctx) {
    const uploads = Array.isArray(ctx.uploads) ? ctx.uploads : [];
    if (!uploads.length || !ctx.owner) return null;
    const names = new Set(FILE_TOOLS);
    const definitions = toolsService.definitions({ readOnly: true }).filter(tool => names.has(tool.name));
    const fs = require('fs');
    const lines = uploads.map(file => {
        const size = (() => { try { return describeSize(fs.statSync(file).size); } catch (_error) { return ''; } })();
        return `- ${path.basename(file)}${size ? `（${size}）` : ''}：${file}`;
    });
    const prompt = `
**对话附件**（用户上传的文件，只读）：
${lines.join('\n')}
读取附件时 path 填上面的完整路径：Excel / CSV / Word / PPT 用 read_document，统计、筛选、汇总表格用 query_data（比自己数行或心算准确），纯文本用 read_file，比较两份文件用 diff_files。回答以文件实际内容为准。`;
    // 没有工作目录：只能按完整路径读本人的附件和大结果文件
    const fileCtx = { readOnly: true, sensitiveValues: ctx.sensitiveValues || [], signal: ctx.signal, artifactOwner: ctx.owner, fullResults: true };
    return {
        definitions, names, prompt,
        execute: (name, args) => toolsService.execute(fileCtx, name, args)
    };
}

/**
 * 只有附件工具的一轮回复（非管理员、或没有其他工具的首页对话）。
 * @returns {Promise<{text, usage, toolLog}>}
 */
async function runTurn({ client, systemInstruction, messages, ctx, signal, onDelta, onEvent, maxOutputTokens, temperature, model, extras = null }) {
    const files = toolset({ ...ctx, signal });
    if (!files) throw Object.assign(new Error('没有可读取的附件'), { code: 'AGENT_UPLOAD_MISSING' });
    const sensitiveValues = ctx.sensitiveValues || [];
    const result = await agentLoop.runToolLoop({
        extras, // 附加工具组：浏览器、MCP（管理员的首页对话）
        client, model, systemPrompt: redactText(`${systemInstruction}\n${files.prompt}`, { secrets: sensitiveValues }), messages, tools: files.definitions,
        write: event => (event.type === 'delta' ? onDelta?.(event.delta) : onEvent?.(event)),
        signal, maxOutputTokens, temperature, sensitiveValues, task: String(messages.at(-1)?.content || ''), callIdPrefix: 'files',
        artifactOwner: ctx.owner, artifactSession: ctx.chatSessionId || 'home',
        executeCall: async (call, { start }) => {
            start();
            return files.names.has(call.name) ? files.execute(call.name, call.args) : { content: '当前对话不提供该工具', summary: '工具不可用', isError: true };
        },
        toolsUnsupported: () => ({ note: '当前模型不支持工具调用，无法读取附件内容。请说明需要切换支持工具调用的模型，不要编造附件内容。' })
    });
    return { text: result.text, usage: result.usage, toolLog: result.toolLog, ...(result.toolsUnsupported ? { toolsUnsupported: true } : {}) };
}

module.exports = { FILE_TOOLS, toolset, runTurn };
