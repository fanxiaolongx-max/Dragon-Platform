// Dragon Claw 的工具循环引擎：工作区、首页数据库对话、@netcare-data / @welink-office / @ops-group、频道跟进任务共用这一套。
// 引擎负责：逐步调用模型、思考过程与工具事件、回答被截断时续写、空回复提示、自动压缩、上下文裁剪、大结果存文件、
// 单轮步数用完时不带工具总结。各场景（预设）只提供系统提示、工具集合和 executeCall（含各自的审批规则）。
const toolsService = require('./agent-tools-service');
const artifacts = require('./agent-artifacts');
const compaction = require('./ai-context-compaction');
const contextStats = require('./agent-context-stats');
const transcriptRepo = require('./agent-transcript-repository');
const toolkit = require('./agent-toolkit');
const { redactText, redactValue } = require('./ai-sensitive-data');

// 单轮工具步数上限只防失控；到上限时让模型不带工具总结进展，而不是直接截断（参考 Claude Code / Codex 的做法）
const MAX_STEPS = 60;
// 回答被输出上限截断时自动续写的次数；模型返回空回复时提示它继续的次数
const MAX_CONTINUATIONS = 3;
const MAX_EMPTY_NUDGES = 2;
const TRUNCATED_RE = /^(length|max_tokens|max_output_tokens)$/i;
// 自动压缩：上下文到触发线（agent-context-stats.compactThreshold）时把较早内容整理成摘要；最近约 25% 窗口的步骤保留原文
const MAX_COMPACTIONS = 6;
const COMPACT_KEEP_RATIO = 0.25;
const RETRY_OUTPUT_TOKENS = 8192;

// 没有文件工具的场景：出现大结果文件后补上这个只能读本人结果文件的 read_file
const ARTIFACT_READER = {
    name: 'read_file',
    description: '按行读取本轮保存的大工具结果文件（工具结果里给出的完整路径）。默认从第 1 行读 400 行，单次最多 2000 行；按返回提示用 startLine 继续分段读取。只能读取这些结果文件。',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: '工具结果里给出的完整文件路径' },
            startLine: { type: 'integer', description: '起始行（从 1 开始），默认 1' },
            limit: { type: 'integer', description: '读取行数，默认 400，最多 2000' }
        },
        required: ['path']
    }
};

// 引擎自带、所有场景通用的工具：任务清单、向用户提问、精确计算（都不碰文件和数据）
const BUILTIN_DEFINITIONS = {
    update_plan: {
        name: 'update_plan',
        description: '任务清单：需要 3 步以上的任务，先列出步骤，之后每完成一步就更新状态（界面会显示进度）。每次传完整清单；同一时间最多一项 in_progress。简单问答不用。',
        parameters: {
            type: 'object',
            properties: {
                items: { type: 'array', description: '完整清单，最多 20 项', items: { type: 'object', properties: { content: { type: 'string', description: '一句话的步骤' }, status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] } }, required: ['content', 'status'] } }
            },
            required: ['items']
        }
    },
    ask_user: {
        name: 'ask_user',
        description: '遇到必须由用户决定、无法从上下文或常识判断的问题时，向用户提一个问题并给出 2–6 个选项，本轮随即结束，等用户回复后再继续。能自己查到或有合理默认值的事不要问。',
        parameters: {
            type: 'object',
            properties: {
                question: { type: 'string', description: '问题，一句话' },
                options: { type: 'array', items: { type: 'string' }, description: '2–6 个简短选项，推荐项放第一个' }
            },
            required: ['question', 'options']
        }
    },
    calculate: {
        name: 'calculate',
        description: '精确计算，不要心算：四则运算、乘方、百分比 percent(部分,整体)、增减幅 change_percent(旧,新)、sum/avg/median/min/max、round(x,位数)；日期 days_between(a,b)、add_days(d,n)、add_months(d,n)、workdays_between(a,b,休息日)（首尾两天都算）、add_workdays(d,n,休息日)（d 之后第 n 个工作日）、weekday(d)、today()。日期写 "YYYY-MM-DD"；休息日默认 "sat,sun"，可写 "fri,sat"。',
        parameters: {
            type: 'object',
            properties: {
                expression: { type: 'string', description: '如 (1250-980)/980*100 或 workdays_between("2026-10-01","2026-10-31")' },
                expressions: { type: 'array', items: { type: 'string' }, description: '一次算多个，最多 50 个' }
            }
        }
    }
};
// 看图：只在传了 vision（agent-vision.forTurn）时提供
BUILTIN_DEFINITIONS.view_image = {
    name: 'view_image',
    description: '看一张图片：用户上传的图片、浏览器截图（工具结果里给出的完整路径），或工作目录里的图片（png / jpg / webp / gif）。当前模型能看图时图片会直接附给你；不能看图时由看图模型识别成文字返回，question 写你想从图里了解什么。',
    parameters: { type: 'object', properties: { path: { type: 'string' }, question: { type: 'string', description: '想从图里了解什么（可选）' } }, required: ['path'] }
};
const BUILTINS = Object.keys(BUILTIN_DEFINITIONS);
const KEEP_IMAGE_MESSAGES = 2; // 只保留最近两次工具取得的图片，较早的换成文字说明
const PLAN_STATUS = new Set(['pending', 'in_progress', 'completed']);

function planText(plan) {
    return plan.map(item => `${item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]'} ${item.content}`).join('\n');
}

function abortError() {
    return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

function previewArgs(args) {
    const text = JSON.stringify(args || {});
    return text.length > 2000 ? JSON.parse(JSON.stringify(args, (key, value) => typeof value === 'string' && value.length > 400 ? `${value.slice(0, 400)}…` : value)) : args;
}

// ── 自动压缩 ─────────────────────────────────────────────
/**
 * 从后往前找切分点：只在一步的开头切（用户消息，或带工具调用的模型消息），工具调用与结果不拆开；
 * 执行提示等临时消息不作切分点。最近的部分保留原文（不超过 keepTokens，至少保留最后一步）。
 */
function compactionCut(messages, keepTokens, ephemeral) {
    const boundaries = [];
    messages.forEach((message, index) => {
        if (index > 0 && !ephemeral.has(message) && (message.role === 'user' || (message.role === 'model' && message.toolCalls?.length))) boundaries.push(index);
    });
    if (!boundaries.length) return 0;
    let cut = boundaries[boundaries.length - 1];
    for (let index = boundaries.length - 2; index >= 0; index -= 1) {
        if (contextStats.estimateRequest('', [], messages.slice(boundaries[index])) > keepTokens) break;
        cut = boundaries[index];
    }
    return cut;
}

/**
 * 规划一次压缩：保留的最近步骤按「触发线以下的余量」定（扣除系统提示和工具说明这部分固定占用），尽量压到明显低于触发线，
 * 免得下一步又触发。能压缩的内容不到窗口 10%、或压完省下不到窗口 5% 时不值得再调用一次模型，返回 null 交给整轮裁剪。
 * 最近一步本身就很大（一步里并行调用多个工具）时照样压缩较早部分，不能因此直接落到裁剪报错。
 */
function planCompaction(messages, { windowTokens, threshold, baseTokens, usedTokens, ephemeral }) {
    const keepTokens = Math.max(0, Math.min(windowTokens * COMPACT_KEEP_RATIO, (threshold - baseTokens) * 0.4));
    const cut = compactionCut(messages, keepTokens, ephemeral);
    const older = messages.slice(0, cut).filter(message => !ephemeral.has(message));
    if (!older.length || contextStats.estimateRequest('', [], older) < windowTokens * 0.1) return null;
    const recent = messages.slice(cut);
    const SUMMARY_TOKENS = 3000; // 真实模型的摘要常接近 4000 字上限
    if (usedTokens - (baseTokens + SUMMARY_TOKENS + contextStats.estimateRequest('', [], recent)) < windowTokens * 0.05) return null;
    return { older, recent };
}

/** 较早部分整理成摘要，替换为一条（或一问一答两条）压缩记录；失败时抛错，由调用方退回整轮裁剪 */
async function compactMessages({ client, plan, task, windowTokens, sensitiveValues, signal }) {
    const { older, recent } = plan;
    const summary = await compaction.summarize({ client, entries: older, task, secrets: sensitiveValues, signal, maxChars: Math.min(60000, Math.floor(windowTokens * 1.5)) });
    const header = transcriptRepo.COMPACTED_HEADER;
    // 保留部分以用户消息开头时用一问一答；以工具步骤开头时合成一条用户消息，写明当前任务，让模型的工具调用仍紧跟用户回合
    const prefix = recent[0]?.role === 'user'
        ? [{ role: 'user', content: header }, { role: 'model', content: summary }]
        : [{ role: 'user', content: `${header}\n\n${summary}\n\n当前任务（用户原话）：${task}\n\n请接着上面的进度继续。` }];
    return { messages: [...prefix, ...recent], summarized: older.length };
}

// ── 工具循环 ─────────────────────────────────────────────
/**
 * 执行一轮对话（可能包含多步工具调用）。
 * @param {object} options
 * @param {Function|Array} options.tools 每步调用前取一次（工作区按需加载的工具会变化）
 * @param {Function} options.executeCall (call, { callId, step, start }) => outcome { content, summary, isError, truncated?, output?, declined? }；
 *   start({ tool, args }) 发出工具行，预设可提前调用（如审批通过后）；declined=true 时不出工具行
 * @param {Function} [options.write] 流事件：delta / thinking / status / compaction / tool_start / tool_result 及预设自己的事件
 * @param {object} [options.eventFields] 附在 tool_start / tool_result 上的字段（如 runId）
 * @param {string} [options.artifactOwner] 设了才把大结果存成本人文件（租户::账号）
 * @param {Function} [options.spillable] (name) => 该工具的结果是否参与存文件，默认全部
 * @param {object} [options.vision] 看图能力（agent-vision.forTurn）：提供 view_image，能看图时把工具取得的图片附给模型
 * @param {string} [options.root] 工作目录（view_image 可读其中的图片）
 * @param {object} [options.extras] 附加工具组（agent-extra-tools.forChat）：浏览器、MCP 等，按需加载并自带审批
 * @param {string[]} [options.builtins] 引擎自带的工具：update_plan / ask_user / calculate，默认全部
 * @param {number} [options.maxEmptyNudges] 空回复时提示的次数（最后一次不带工具），默认 2
 * @param {Function} [options.review] ({ text, toolLog }) => null | { nudge, keepReply }：模型给出最终回答前的检查，返回提示时继续一步
 * @param {Function} [options.fallback] ({ messages, toolLog }) => 文本：重试后仍是空回答时的兜底
 * @param {Function} [options.toolsUnsupported] () => { note } | { text }：模型不支持工具调用时的退路；不设则直接抛错
 * @param {Function} [options.onToolCalls] (modelMessage, toolMessage) 模型发出工具调用后、执行前
 * @param {Function} [options.afterCall] (call, outcome) 每个工具执行完、结果已记入后
 * @returns {{ text, usage, lastUsage, steps, toolCallCount, toolLog, messages, tools, compacted, toolsUnsupported? }}
 */
async function runToolLoop({
    client, model = '', systemPrompt, messages: initialMessages, tools: toolSource = [], executeCall, write: emit,
    signal, maxOutputTokens, temperature, sensitiveValues = [], task = '', maxSteps = MAX_STEPS, callIdPrefix = 'call',
    eventFields = {}, artifactOwner = '', artifactSession = '', spillable = () => true, maxEmptyNudges = MAX_EMPTY_NUDGES, builtins = BUILTINS, extras = null, vision = null, root = '',
    review, fallback, toolsUnsupported, onToolCalls, afterCall
}) {
    const secrets = { secrets: sensitiveValues };
    if (extras?.prompt) systemPrompt = `${systemPrompt}${extras.prompt}`;
    const write = event => emit?.(redactValue(event, secrets));
    let activeClient = client;
    let messages = redactValue(initialMessages.map(item => ({ ...item })), secrets);
    const usage = { promptTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0 }; // inputTokens：各步输入之和，用于展示本轮实际消耗
    let lastUsage = null; // 最后一步的上下文占用（含缓存命中），上下文面板以它为准
    const windowOf = () => Number(activeClient?.settings?.contextWindowTokens || client?.settings?.contextWindowTokens || 0);
    const modelName = () => model || activeClient?.model;
    let readerEnabled = false;
    const builtinTools = builtins.filter(name => BUILTIN_DEFINITIONS[name] && (name !== 'view_image' || vision)).map(name => BUILTIN_DEFINITIONS[name]);
    const builtinNames = new Set(builtinTools.map(tool => tool.name));
    // 自带工具放最前面、固定不变，后面按需加载的工具往末尾追加，提示缓存才能继续命中
    const currentTools = () => {
        const list = [...builtinTools, ...(typeof toolSource === 'function' ? toolSource() : toolSource), ...(extras ? extras.definitions() : [])];
        return readerEnabled && !list.some(tool => tool.name === 'read_file') ? [...list, ARTIFACT_READER] : list;
    };
    let plan = [];
    let question = null;
    const pendingImages = [];
    // view_image 能读的图片：本人的附件与结果文件（含浏览器截图），以及工作目录里的图片
    const resolveImage = target => {
        const file = String(target || '');
        if (require('path').isAbsolute(file) && artifacts.ownsFile(artifactOwner, file)) return file;
        if (root) return require('./agent-path-guard').resolveInsideRoot(root, file);
        throw Object.assign(new Error('只能看本人上传的图片、浏览器截图或工作目录里的图片（用工具结果里给出的完整路径）'), { code: 'VISION_PATH' });
    };
    const runBuiltin = async call => {
        const args = call.args && typeof call.args === 'object' ? call.args : {};
        if (call.name === 'view_image') {
            try {
                const image = require('./agent-vision').loadImage(resolveImage(args.path));
                const file = resolveImage(args.path);
                if (vision.capable) return { content: `图片「${image.name}」已附在下一条消息里，请直接看图。`, summary: `看图 ${image.name}`, images: [image], previewPaths: [file] };
                const text = await vision.describe([image], { question: String(args.question || '') });
                return { content: `（当前对话模型不能直接看图，以下是看图模型对「${image.name}」的识别结果）\n${text}`, summary: `看图模型识别 ${image.name}`, previewPaths: [file] };
            } catch (error) {
                return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: String(error.message || '').slice(0, 120), isError: true };
            }
        }
        if (call.name === 'calculate') {
            try { return toolkit.calculate(args); } catch (error) { return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: error.message, isError: true }; }
        }
        if (call.name === 'update_plan') {
            const items = (Array.isArray(args.items) ? args.items : []).slice(0, 20)
                .map(item => ({ content: String(item?.content || '').trim().slice(0, 200), status: PLAN_STATUS.has(item?.status) ? item.status : 'pending' }))
                .filter(item => item.content);
            if (!items.length) return { content: 'items 不能为空', summary: '清单为空', isError: true, silent: true };
            if (items.filter(item => item.status === 'in_progress').length > 1) return { content: '同一时间最多一项 in_progress，请修正后重新提交完整清单', summary: '清单状态有误', isError: true, silent: true };
            plan = items;
            write({ type: 'plan', items });
            const done = items.filter(item => item.status === 'completed').length;
            return { content: `任务清单已更新（完成 ${done}/${items.length}）。`, summary: `任务清单 ${done}/${items.length}`, silent: true };
        }
        if (call.name === 'ask_user') {
            const text = String(args.question || '').trim().slice(0, 500);
            const options = (Array.isArray(args.options) ? args.options : []).map(item => String(item || '').trim().slice(0, 100)).filter(Boolean).slice(0, 6);
            if (!text || options.length < 2) return { content: '需要 question 和 2–6 个 options', summary: '问题不完整', isError: true, silent: true };
            question = { question: text, options };
            write({ type: 'question', question: text, options });
            return { content: '问题已发给用户，本轮到此结束，等用户回复后再继续。', summary: '已向用户提问', silent: true };
        }
        return null;
    };
    const ownReader = name => name === 'read_file' && readerEnabled && !(typeof toolSource === 'function' ? toolSource() : toolSource).some(tool => tool.name === 'read_file');
    const collect = result => {
        usage.promptTokens = Number(result.usage?.promptTokens || 0);
        usage.inputTokens += Number(result.usage?.promptTokens || 0);
        usage.outputTokens += Number(result.usage?.outputTokens || 0);
        usage.totalTokens += Number(result.usage?.totalTokens || 0);
        usage.cachedTokens += Number(result.usage?.cachedTokens || 0);
        const contextTokens = Number(result.usage?.contextPromptTokens || result.usage?.promptTokens || 0);
        if (contextTokens) lastUsage = { promptTokens: contextTokens, cachedTokens: Number(result.usage?.cachedTokens || 0), cacheWriteTokens: Number(result.usage?.cacheWriteTokens || 0) };
    };
    let tools = currentTools();
    let steps = 0;
    let toolCallCount = 0;
    let finalText = '';
    const toolLog = [];
    let partialText = ''; // 被输出上限截断的回答，续写后拼接
    let continuations = 0;
    let emptyNudges = 0;
    let stepMaxOutput = maxOutputTokens;
    let toolChoice;
    const ephemeral = new WeakSet(); // 执行提示、续写用的半截回答：只发给模型，不进转录、不作压缩切分点
    const pushEphemeral = (...items) => {
        items.forEach(item => ephemeral.add(item));
        messages.push(...items);
    };
    let compactions = 0;
    let compactFailed = false;
    let compacted = false;

    for (steps = 1; steps <= maxSteps; steps += 1) {
        if (signal?.aborted) throw abortError();
        tools = currentTools(); // 上一步用 tool_search / load_skill 加载的工具追加在末尾
        // 只保留最近两条带图片的执行消息，较早的图片换成文字说明，免得每一步都重复发送
        const withImages = messages.filter(message => ephemeral.has(message) && message.images?.length);
        withImages.slice(0, -KEEP_IMAGE_MESSAGES).forEach(message => { delete message.images; message.content = `${message.content}（图片已移出上下文，需要时可再用 view_image 查看）`; });
        // 上下文到触发线：先把较早内容整理成摘要；摘要失败才由下面的整轮裁剪兜底
        const windowTokens = contextStats.windowFor(modelName(), windowOf());
        const usedTokens = Math.max(contextStats.estimateRequest(systemPrompt, tools, messages), Number(lastUsage?.promptTokens || 0));
        const threshold = contextStats.compactThreshold(windowTokens, maxOutputTokens);
        const compactPlan = !compactFailed && compactions < MAX_COMPACTIONS && usedTokens >= threshold
            ? planCompaction(messages, { windowTokens, threshold, usedTokens, baseTokens: contextStats.estimateRequest(systemPrompt, tools, []), ephemeral }) : null;
        if (compactPlan) {
            compactions += 1;
            write({ type: 'compaction', phase: 'start', usedTokens, windowTokens });
            try {
                const result = await compactMessages({ client: activeClient, plan: compactPlan, task: plan.length ? `${task}\n\n当前任务清单：\n${planText(plan)}` : task, windowTokens, sensitiveValues, signal });
                messages = result.messages;
                compacted = true;
                lastUsage = null; // 上一步的用量是压缩前的，不能再拿来判断
                write({ type: 'compaction', phase: 'done', summarized: result.summarized, beforeTokens: usedTokens, afterTokens: contextStats.estimateRequest(systemPrompt, tools, messages), windowTokens });
            } catch (error) {
                if (signal?.aborted || error?.name === 'AbortError') throw error;
                compactFailed = true;
                write({ type: 'compaction', phase: 'failed', error: redactText(String(error.message || error), secrets) });
            }
        }
        const fitted = contextStats.fitMessages({ model: modelName(), contextWindow: windowOf(), systemPrompt, messages, tools, maxOutputTokens });
        messages = fitted.messages;
        if (fitted.droppedTurns) write({ type: 'status', status: `较早的 ${fitted.droppedTurns} 轮已移出模型上下文，完整记录仍保留在会话档案中。` });
        let result;
        try {
            result = await activeClient.generateText({
                systemInstruction: systemPrompt,
                messages,
                tools,
                ...(toolChoice ? { toolChoice } : {}),
                maxOutputTokens: stepMaxOutput,
                temperature,
                signal,
                onDelta: delta => write({ type: 'delta', delta }),
                onReasoning: delta => write({ type: 'thinking', delta })
            });
        } catch (error) {
            // 模型 / 网关不支持函数调用：按预设退回不带工具的普通回复
            if (steps !== 1 || error?.code !== 'AI_TOOLS_UNSUPPORTED' || !toolsUnsupported) throw error;
            const fallbackPlan = toolsUnsupported() || {};
            if (fallbackPlan.text !== undefined) return { text: fallbackPlan.text, usage, lastUsage, steps: 1, toolCallCount, toolLog, messages, tools, compacted, toolsUnsupported: true };
            // 不带工具的普通回复：客户端有 generateChat 时用它（不会再带上工具说明）
            const plainCall = typeof activeClient.generateChat === 'function' ? activeClient.generateChat.bind(activeClient) : activeClient.generateText.bind(activeClient);
            const plain = await plainCall({ systemInstruction: `${systemPrompt}\n\n${fallbackPlan.note || ''}`, messages, maxOutputTokens, temperature, signal,
                onDelta: delta => write({ type: 'delta', delta }), onReasoning: delta => write({ type: 'thinking', delta }) });
            collect(plain);
            return { text: redactText(String(plain.text || ''), secrets), usage, lastUsage, steps: 1, toolCallCount, toolLog, messages, tools, compacted, toolsUnsupported: true };
        }
        if (result.providerClient) activeClient = result.providerClient;
        collect(result);
        toolChoice = undefined;
        const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
        if (!toolCalls.length) {
            const text = String(result.text || '');
            // 回答写到一半碰到输出上限：保留已写部分，请模型从断点接着写；推理就耗尽了上限、一个字没写时，调高上限再试
            if (TRUNCATED_RE.test(String(result.finishReason || '')) && continuations < MAX_CONTINUATIONS) {
                continuations += 1;
                if (text.trim()) {
                    partialText += text;
                    pushEphemeral({ role: 'model', content: text }, { role: 'user', content: '（执行提示：上一条回复因输出长度上限被截断。请从断点处直接接着写，不要重复已写内容，也不要重新开头。）' });
                } else {
                    stepMaxOutput = Math.max(Number(stepMaxOutput) || 2048, RETRY_OUTPUT_TOKENS);
                }
                write({ type: 'status', status: '回答超出单次输出上限，正在接着生成…' });
                continue;
            }
            // 工具调用之后模型给了空回复：提示它根据已有结果作答或继续调用工具，不把空白当成最终回答；
            // 最后一次提示时不再给工具、放宽输出上限（思考型模型可能把额度全用在思考上）
            if (!text.trim() && !partialText && emptyNudges < maxEmptyNudges) {
                emptyNudges += 1;
                if (emptyNudges === maxEmptyNudges && toolLog.length) {
                    toolChoice = 'none';
                    stepMaxOutput = Math.max(Number(stepMaxOutput) || 2048, RETRY_OUTPUT_TOKENS);
                    pushEphemeral({ role: 'user', content: '（执行提示：上一次回复仍为空。请不要再调用工具，少思考，直接根据上面的工具结果用简洁的语言回答用户的问题。）' });
                } else {
                    pushEphemeral({ role: 'user', content: '（执行提示：你上一条回复是空的。请根据上面的工具结果直接回答用户的问题；如果还需要查询，就继续调用工具。）' });
                }
                write({ type: 'status', status: '模型没有给出回答，正在提示它继续…' });
                continue;
            }
            const check = !partialText && review ? review({ text, toolLog }) : null;
            if (check?.nudge) {
                if (check.keepReply === false) pushEphemeral({ role: 'user', content: check.nudge });
                else pushEphemeral({ role: 'model', content: text }, { role: 'user', content: check.nudge });
                write({ type: 'delta', delta: '\n\n' });
                continue;
            }
            finalText = partialText + text;
            if (!finalText.trim() && toolLog.length && fallback) {
                finalText = String(fallback({ messages, toolLog }) || '');
                if (finalText) write({ type: 'delta', delta: finalText });
            }
            finalText = redactText(finalText, secrets);
            break;
        }
        if (result.text) write({ type: 'delta', delta: '\n\n' });
        const modelMessage = { role: 'model', content: result.text || '', toolCalls };
        messages.push(modelMessage);
        const toolResults = [];
        const toolMessage = { role: 'tool', toolResults };
        await onToolCalls?.(modelMessage, toolMessage);
        for (const [index, call] of toolCalls.entries()) {
            toolCallCount += 1;
            const callId = call.id || `${callIdPrefix}-${steps}-${index}`;
            let startedAt = Date.now();
            let shown = null;
            const start = ({ tool, args } = {}) => {
                if (shown) return;
                shown = tool || call.name;
                startedAt = Date.now();
                write({ type: 'tool_start', ...eventFields, callId, tool: shown, args: args === undefined ? previewArgs(call.args) : args });
            };
            let outcome = builtinNames.has(call.name) ? await runBuiltin(call)
                : extras?.handles(call.name) ? await extras.execute(call, { callId, start })
                : ownReader(call.name) ? await readArtifact(call, { owner: artifactOwner, sensitiveValues, start })
                    : await executeCall(call, { callId, step: steps, start });
            outcome = outcome || { content: '工具没有返回结果', summary: '无结果', isError: true };
            if (!outcome.declined && !outcome.silent) start();
            if (outcome.images?.length) pendingImages.push(...outcome.images);
            // 浏览器截图等带图片文件的结果：能看图时一并附上，不能看图时提示可用 view_image 识别
            for (const file of outcome.imagePaths || []) {
                if (vision?.capable) {
                    try { pendingImages.push(require('./agent-vision').loadImage(file)); } catch (_error) { /* 读不了就只留路径 */ }
                }
            }
            if (outcome.imagePaths?.length && vision) {
                let note = '（截图已附在下一条消息里，可以直接看。）';
                // 对话模型看不到图：截图交给看图模型识别一次，结果附在工具结果里，免得模型凭页面文字去猜样式
                if (!vision.capable) {
                    try {
                        const shots = outcome.imagePaths.slice(0, 2).map(file => require('./agent-vision').loadImage(file));
                        note = `（当前对话模型不能直接看图，以下是看图模型对截图的识别结果）\n${String(await vision.describe(shots, { question: '页面的配色、版式与主要内容' })).slice(0, 6000)}`;
                    } catch (error) {
                        note = `（当前对话模型不能直接看图，看图模型也没能识别：${error.message}）`;
                    }
                }
                outcome = { ...outcome, content: `${outcome.content}\n${note}` };
            }
            const { images: _images, ...plainOutcome } = outcome;
            outcome = plainOutcome;
            const durationMs = Date.now() - startedAt;
            // 大结果完整存成本人的文件，上下文只留开头、结尾和路径（read_file 分页结果除外）
            let artifact = null;
            const content = typeof outcome.content === 'string' ? redactText(outcome.content, secrets) : outcome.content;
            outcome = { ...outcome, content };
            if (artifactOwner && typeof content === 'string' && call.name !== 'read_file' && spillable(call.name)) {
                const spilled = await artifacts.spill({ owner: artifactOwner, sessionId: artifactSession || 'chat', callId, toolName: call.name, content });
                artifact = spilled.artifact;
                if (artifact) {
                    outcome = { ...outcome, content: spilled.content, truncated: true };
                    readerEnabled = true;
                }
            }
            if (!outcome.declined && !outcome.silent) {
                // 截图、看过的图片：界面在工具行下显示缩略图，点击看大图（随会话记录入库，历史里也能看）
                const previews = [...(outcome.imagePaths || []), ...(outcome.previewPaths || [])].slice(0, 4);
                write({ type: 'tool_result', ...eventFields, callId, tool: shown, ok: !outcome.isError, summary: String(outcome.summary || '').slice(0, 200), truncated: Boolean(outcome.truncated), durationMs,
                    ...(outcome.output ? { output: outcome.output } : {}), ...(artifact ? { artifact } : {}), ...(previews.length ? { images: previews } : {}) });
            }
            // 任务清单、提问这类不出工具行的调用不计入工具记录（回复末尾的工具摘要、调用次数）
            if (outcome.silent) toolCallCount -= 1;
            else require('./agent-tool-usage').record(call.name, !outcome.isError); // 工具清单里的调用次数
            if (!outcome.silent) toolLog.push({ tool: call.name, ok: !outcome.isError, summary: String(outcome.summary || '').slice(0, 120) });
            toolResults.push({ id: call.id, name: call.name, content: outcome.content, isError: Boolean(outcome.isError) });
            await afterCall?.(call, outcome);
            if (signal?.aborted) throw abortError();
        }
        messages.push(toolMessage);
        // 工具取得的图片（view_image、浏览器截图）：模型能看图时作为下一条消息附上；只发给模型，不进转录
        if (vision?.capable && pendingImages.length) {
            const shown = pendingImages.splice(0);
            pushEphemeral({ role: 'user', content: `（以下是刚才工具取得的图片：${shown.map(image => image.name).join('、')}）`, images: shown.map(({ mimeType, data }) => ({ mimeType, data })) });
        }
        pendingImages.length = 0;
        // ask_user：把问题和选项写成回复正文（频道、历史记录里也能看到），本轮结束，等用户回答
        if (question) {
            const text = `${question.question}\n\n${question.options.map((option, index) => `${index + 1}. ${option}`).join('\n')}`;
            write({ type: 'delta', delta: text });
            // 提问前模型写的说明已经流式输出过，记录里一并保留
            const lead = String(result.text || '').trim();
            finalText = redactText(lead ? `${lead}\n\n${text}` : text, secrets);
            break;
        }
    }
    if (!finalText && steps > maxSteps) {
        // 步数用完：不带工具再问一次，让模型总结已完成的部分和剩下的步骤，用户回复“继续”即可接着做
        const notice = `\n\n（已达到单轮最大工具调用步数 ${maxSteps}，回复“继续”可接着处理。）`;
        let summary = '';
        try {
            const closing = await activeClient.generateText({
                systemInstruction: systemPrompt,
                messages: [...messages, { role: 'user', content: `（执行提示：本轮工具调用已达上限 ${maxSteps} 步，不能再调用工具。请根据已有结果回答用户：已经查明或完成了什么、还差哪些步骤。）` }],
                tools, toolChoice: 'none', maxOutputTokens, temperature, signal,
                onDelta: delta => write({ type: 'delta', delta })
            });
            collect(closing);
            summary = String(closing.text || '');
        } catch (error) {
            if (signal?.aborted) throw error;
        }
        finalText = redactText(`${partialText}${summary}`.trim() + notice, secrets);
        write({ type: 'delta', delta: notice });
    }
    return {
        text: finalText,
        usage,
        lastUsage,
        steps: Math.min(steps, maxSteps),
        toolCallCount,
        toolLog,
        messages,
        nonEphemeral: messages.filter(message => !ephemeral.has(message)),
        tools,
        compacted,
        plan,
        question,
        client: activeClient
    };
}

/** 没有文件工具的场景读取本人的大结果文件 */
async function readArtifact(call, { owner, sensitiveValues, start }) {
    start();
    const target = String(call.args?.path || '');
    if (!owner || !require('path').isAbsolute(target) || !artifacts.belongsTo(owner, target)) {
        return { content: '只能读取本轮工具结果里给出的结果文件路径', summary: '路径不是结果文件', isError: true };
    }
    return toolsService.execute({ artifactOwner: owner, sensitiveValues }, 'read_file', { path: target, startLine: call.args?.startLine, limit: call.args?.limit });
}

module.exports = { MAX_STEPS, BUILTIN_DEFINITIONS, runToolLoop, previewArgs, compactionCut, planCompaction, compactMessages };
