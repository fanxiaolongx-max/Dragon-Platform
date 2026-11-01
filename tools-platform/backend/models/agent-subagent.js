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
    description: '派一个只读子智能体独立调研（大范围搜代码 / 文档、对比多份资料），只带回结论，不占主对话上下文；它看不到当前对话，prompt 要写清背景和要查什么。极其重要：当用户提出多个调研方向、多个问题或要求分头调研时，必须在同一回复中并行发起多次 task 工具调用（每个方向各派一个独立的子智能体同时去查），绝对不要把它们合并进同一个 task 中！同一步发出的多个 task 会完全并行执行。一两次简单读取直接用普通工具。',
    parameters: {
        type: 'object',
        properties: {
            description: { type: 'string', description: '3–12 字的任务标题' },
            prompt: { type: 'string', description: '完整说明：背景、要查什么、范围、结论格式' }
        },
        required: ['description', 'prompt']
    }
};

// 名字、图标、颜色：20 种经典恐龙角色，配上专属图标与龙族主题色；前缀融合性格脾气或正在做的事情，随机组合出可爱生动的角色
const DINOSAURS = [
    { species: '霸王龙', emoji: '🦖', color: '#f87171' },
    { species: '尖齿龙', emoji: '🦖', color: '#fb923c' },
    { species: '三角龙', emoji: '🦏', color: '#34d399' },
    { species: '腕龙', emoji: '🦕', color: '#60a5fa' },
    { species: '剑龙', emoji: '🦕', color: '#a3e635' },
    { species: '翼手龙', emoji: '🪽', color: '#38bdf8' },
    { species: '迅猛龙', emoji: '🦎', color: '#2dd4bf' },
    { species: '甲龙', emoji: '🐢', color: '#fbbf24' },
    { species: '雷龙', emoji: '🦕', color: '#818cf8' },
    { species: '棘龙', emoji: '🐊', color: '#10b981' },
    { species: '厚头龙', emoji: '🐏', color: '#f59e0b' },
    { species: '梁龙', emoji: '🦕', color: '#22d3ee' },
    { species: '始祖鸟', emoji: '🦤', color: '#f472b6' },
    { species: '沧龙', emoji: '🐬', color: '#06b6d4' },
    { species: '镰刀龙', emoji: '🐾', color: '#c084fc' },
    { species: '异特龙', emoji: '🦖', color: '#e11d48' },
    { species: '副栉龙', emoji: '🦕', color: '#4ade80' },
    { species: '恐爪龙', emoji: '🦅', color: '#e879f9' },
    { species: '蛇颈龙', emoji: '🐉', color: '#0ea5e9' },
    { species: '冥河龙', emoji: '🐲', color: '#f43f5e' }
];

const TRAITS = [
    '吃草的', '抑郁的', '暴躁的', '发呆的', '社恐的', '傲娇的', '话痨的', '胆小的', '贪吃的', '呆萌的',
    '佛系的', '沉思的', '亢奋的', '摆烂的', '困困的', '认真的', '迷茫的', '害羞的', '碎碎念的', '假装正经的',
    '叛逆的', '踩水坑的', '抓蝴蝶的', '啃骨头的', '晒太阳的', '追尾巴的', '磨爪子的', '堆沙堡的', '荡秋千的', '练嗓子的',
    '找妈妈的', '吐泡泡的', '藏零食的', '打哈欠的', '巡视领地的', '躲猫猫的', '数星星的', '翻跟头的', '照镜子的', '偷瞄四周的'
];

const CREW = DINOSAURS.map(d => ({ name: d.species, emoji: d.emoji, color: d.color }));
const COLORS = DINOSAURS.map(d => d.color);

/** 一轮对话的子智能体名册：随机起点，恐龙种类、性格/动作前缀与适配颜色在同一轮里互不重复 */
function roster(random = Math.random) {
    const dinoStart = Math.floor(random() * DINOSAURS.length);
    const traitStart = Math.floor(random() * TRAITS.length);
    let index = 0;
    return () => {
        const dino = DINOSAURS[(dinoStart + index * 7) % DINOSAURS.length]; // 7 与 20 互质：走完一圈 20 种恐龙不重复
        const trait = TRAITS[(traitStart + index * 13) % TRAITS.length];    // 13 与 40 互质：走完一圈 40 个性格动作不重复
        index += 1;
        return {
            name: `${trait}${dino.species}`,
            emoji: dino.emoji,
            color: dino.color
        };
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

module.exports = { DEFINITION, MAX_STEPS, DINOSAURS, TRAITS, CREW, COLORS, roster, run };
