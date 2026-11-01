// Dragon Claw 子智能体（task 工具）：主智能体把一件调研类的事交给一个独立上下文的子智能体，只把结论带回来。
// - 子智能体只能用只读工具（读文件、搜索、查表、网页搜索等），不能写、不能执行命令，所以不会弹审批卡；
// - 有自己的消息历史和步数上限，大范围搜索的中间结果不进主对话上下文；
// - 同一步里派出的多个子智能体并行执行（见 agent-loop 的并行批次）；
// - 每个子智能体有一个随机的可爱名字、图标和颜色，界面按 subagent 事件显示成一张可展开的卡片。
const MAX_STEPS = 20;
const RESULT_CHARS = 12000;
const PREVIEW_CHARS = 4000;

const DEFINITION = {
    name: 'task',
    description: '派一个子智能体去完成一件独立的调研任务，它只把结论带回来：适合大范围搜代码 / 文档、对比多个文件或资料、查清某个逻辑在哪里等会产生大量中间结果的工作，主对话上下文不会被撑满。'
        + '子智能体只能用只读工具（读文件、搜索、查表、网页搜索等），不能修改文件、不能执行命令；它看不到当前对话，prompt 里要写清楚背景、要查什么、结论要包含什么。'
        + '互不相关的几件调研可以在同一步里同时派出多个子智能体并行执行。简单的一两次读取直接用工具，不要派子智能体。',
    parameters: {
        type: 'object',
        properties: {
            description: { type: 'string', description: '3–12 个字的任务标题，如「查找审批流程入口」' },
            prompt: { type: 'string', description: '交给子智能体的完整说明：背景、要查什么、在哪些范围找、结论的格式' }
        },
        required: ['description', 'prompt']
    }
};

// 名字、图标、颜色：一轮里按顺序取，不重复；颜色彼此区分明显
const CREW = [
    { name: '翻垃圾浣熊', emoji: '🦝' }, { name: '熬夜猫头鹰', emoji: '🦉' }, { name: '八爪翻页侠', emoji: '🐙' }, { name: '刺猬检索员', emoji: '🦔' },
    { name: '考古霸王龙', emoji: '🦖' }, { name: '囤货松鼠', emoji: '🐿️' }, { name: '海獭档案员', emoji: '🦦' }, { name: '呱呱情报员', emoji: '🐸' },
    { name: '单脚火烈鸟', emoji: '🦩' }, { name: '摸鱼侦探', emoji: '🐟' }, { name: '树懒加急组', emoji: '🦥' }, { name: '企鹅快递员', emoji: '🐧' },
    { name: '熊猫调研员', emoji: '🐼' }, { name: '狐狸放大镜', emoji: '🦊' }, { name: '勤劳小蜜蜂', emoji: '🐝' }, { name: '稳健蜗牛', emoji: '🐌' },
    { name: '骆驼背书包', emoji: '🐫' }, { name: '螃蟹横着查', emoji: '🦀' }, { name: '鹦鹉复读机', emoji: '🦜' }, { name: '水母漂流记', emoji: '🪼' }
];
const COLORS = ['#f472b6', '#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#a3e635', '#e879f9'];

/** 一轮对话的子智能体名册：随机起点，之后依次取，名字和颜色都不重复（超过名册长度再循环） */
function roster(random = Math.random) {
    const start = Math.floor(random() * CREW.length);
    const colorStart = Math.floor(random() * COLORS.length);
    let index = 0;
    return () => {
        const crew = CREW[(start + index * 7) % CREW.length]; // 步长 7 与 20 互质：走完一圈才重复
        const color = COLORS[(colorStart + index) % COLORS.length];
        index += 1;
        return { ...crew, color };
    };
}

const SYSTEM_PROMPT = `你是 Dragon Claw 派出的子智能体，负责独立完成一项只读的调研任务，然后把结论交回给主智能体。
- 只能使用提供给你的只读工具；不能修改文件、执行命令或改数据。需要修改的地方写进结论，由主智能体处理。
- 先规划查找范围，再用搜索、列目录、读文件等工具核实，不要凭印象回答；能并行的读取可以在同一步里一起调用。
- 结论要具体：给出文件路径（含行号）、关键代码或数据、你的判断依据；没查到的如实说明查过哪些地方。
- 结论用简洁的 Markdown，不超过 1500 字；不要寒暄，也不要复述任务本身。`;

/**
 * 执行一个子智能体。
 * @param {object} options
 * @param {object} options.call 主智能体的 task 调用 { id, args }
 * @param {object} options.identity 名册里取到的 { name, emoji, color }
 * @param {Function} options.tools () => 只读工具定义
 * @param {Function} options.executeCall 主预设的 executeCall（子智能体只会调用只读工具）
 * @param {Function} options.isReadOnly (name, args) => 是否只读工具
 * @param {Function} options.write 主运行的事件出口
 */
async function run({ call, identity, client, model, tools, executeCall, isReadOnly, write, signal, maxOutputTokens, temperature, sensitiveValues = [], artifactOwner = '', artifactSession = '', root = '', eventFields = {} }) {
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    const description = String(args.description || '').trim().slice(0, 40) || '子任务';
    const prompt = String(args.prompt || '').trim().slice(0, 20000);
    const id = call.id;
    const started = Date.now();
    const base = { type: 'subagent', ...eventFields, id, ...identity, description };
    if (!prompt) return { content: 'task 需要 prompt：写清楚要子智能体查什么', summary: '缺少任务说明', isError: true };
    write({ ...base, phase: 'start', prompt: prompt.slice(0, 2000) });
    let toolCount = 0;
    // 子智能体的工具事件改成 subagent/tool 事件，挂在卡片里，不进主对话的工具行
    const nestedWrite = event => {
        if (event.type === 'tool_start') {
            toolCount += 1;
            write({ ...base, phase: 'tool', callId: event.callId, tool: event.tool, args: event.args, state: 'running' });
        } else if (event.type === 'tool_result') {
            write({ ...base, phase: 'tool', callId: event.callId, tool: event.tool, state: event.ok ? 'done' : 'failed', summary: event.summary, durationMs: event.durationMs });
        } else if (event.type === 'status') {
            write({ ...base, phase: 'status', status: event.status });
        }
    };
    const agentLoop = require('./agent-loop');
    try {
        const result = await agentLoop.runToolLoop({
            client, model, systemPrompt: `${SYSTEM_PROMPT}${root ? `\n\n工作目录：${root}（文件工具的路径相对它）` : ''}`,
            messages: [{ role: 'user', content: prompt }],
            tools, write: nestedWrite, signal, maxOutputTokens, temperature, sensitiveValues, task: prompt, maxSteps: MAX_STEPS,
            callIdPrefix: `${id}-sub`, artifactOwner, artifactSession, root, builtins: ['calculate'],
            executeCall: async (subCall, ctx) => {
                if (!isReadOnly(subCall.name, subCall.args)) {
                    return { content: `子智能体只能使用只读工具，${subCall.name} 不可用。需要修改的内容请写进结论。`, summary: '子智能体只读', isError: true };
                }
                return executeCall(subCall, ctx);
            }
        });
        const text = String(result.text || '').trim() || '（子智能体没有给出结论）';
        const durationMs = Date.now() - started;
        const tokens = Number(result.usage?.totalTokens || 0);
        write({ ...base, phase: 'done', ok: true, durationMs, toolCount, tokens, result: text.slice(0, PREVIEW_CHARS), truncated: text.length > PREVIEW_CHARS });
        return {
            content: `子智能体「${identity.name}」完成了「${description}」（${toolCount} 次工具调用）。结论：\n${text.slice(0, RESULT_CHARS)}${text.length > RESULT_CHARS ? '\n…（结论过长已截断）' : ''}`,
            summary: `${identity.emoji} ${identity.name} · ${description}`,
            usage: result.usage,
            silentRow: true
        };
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') {
            write({ ...base, phase: 'done', ok: false, aborted: true, durationMs: Date.now() - started, toolCount });
            throw error;
        }
        const message = String(error.message || error).slice(0, 300);
        write({ ...base, phase: 'done', ok: false, error: message, durationMs: Date.now() - started, toolCount });
        return { content: `子智能体「${identity.name}」执行失败：${message}`, summary: `${identity.name} 失败`, isError: true, silentRow: true };
    }
}

module.exports = { DEFINITION, MAX_STEPS, CREW, COLORS, roster, run };
