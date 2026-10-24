// 频道对话的跟进任务能力：给 WeLink 等频道里的 Dragon Claw 一组只作用于「当前群/单聊」的工具，
// 用户说「记一下 / 后边跟进 / 提醒某人」时由模型调用 followup_create，回复进度或「完成」时调用 update / close。
// 工具只能读写本会话的跟进任务，不开放平台其他写能力；模型不支持函数调用时退回普通回复。
const repo = require('./channel-followups-repository');
const schedule = require('./followup-schedule');

const MAX_STEPS = 6;
const URGENCY_LABEL = { low: '低', normal: '普通', high: '高', urgent: '紧急' };
const STATUS_LABEL = { open: '跟进中', paused: '已暂停', done: '已完成', cancelled: '已取消' };

const ASSIGNEE_SCHEMA = {
    type: 'array',
    description: '需要提醒的人；从消息中提取姓名与工号/账号（如「刘一然 00964704」→ name=刘一然, account=00964704）。没有明确指定时留空，提醒会发给群里所有相关人',
    items: { type: 'object', properties: { name: { type: 'string' }, account: { type: 'string' } } }
};
const SCHEDULE_PROPS = {
    urgency: { type: 'string', description: '紧急度 low | normal | high | urgent。用户没说时根据内容判断：影响生产/客户、领导关注、当天必须完成 → urgent；本周内 → high；一般遗留事项 → normal；不着急 → low' },
    scheduleMode: { type: 'string', description: 'auto（默认，按紧急度：紧急每 2 小时、高每天、普通每 2 个工作日、低每周）| interval（固定间隔，需 intervalMinutes）| random（随机间隔，用 randomMinMinutes / randomMaxMinutes）' },
    intervalMinutes: { type: 'integer', description: 'interval 模式的间隔分钟数，例如每天 = 1440、每 3 小时 = 180' },
    randomMinMinutes: { type: 'integer', description: 'random 模式的最短间隔分钟' },
    randomMaxMinutes: { type: 'integer', description: 'random 模式的最长间隔分钟' },
    allowOffHours: { type: 'boolean', description: '是否允许在非工作日（周五、周六）跟进；紧急任务默认允许' },
    inMinutes: { type: 'integer', description: '相对当前时间多少分钟后首次提醒（例如用户说“2分钟后”填 2，“半小时后”填 30）。有明确相对时长时优先填此项，避免时区与夏令时换算偏差' },
    nextRemindAt: { type: 'string', description: '用户指定了具体绝对时刻（如「明天下午 3 点提醒」）时填 ISO 8601 时间（需带当前时区偏移）' },
    nextRemindNote: { type: 'string', description: '下次提醒时要跟进/追问的具体内容，一句话' }
};

function definitions() {
    return [
        {
            name: 'followup_create',
            description: '在当前群聊/单聊中记录一个需要后续跟进的任务，平台会按频率自动在本群 @ 提醒相关人。用户说「记一下」「帮我跟进」「提醒某人」「遗留任务」等时调用。先查看系统提示中本会话已有的任务，避免重复创建同一件事。',
            parameters: {
                type: 'object',
                properties: {
                    title: { type: 'string', description: '任务标题，简短明确，如「修改“上报事故”海报」' },
                    detail: { type: 'string', description: '任务详情与讨论要点（Markdown），保留提出人、时间与关键建议' },
                    assignees: ASSIGNEE_SCHEMA,
                    dueAt: { type: 'string', description: '截止时间（ISO 8601），没有则省略' },
                    ...SCHEDULE_PROPS,
                    firstRemindAt: { type: 'string', description: '第一次提醒时间（ISO 8601，需带当前时区偏移）；相对时间如“2分钟后”请直接填 inMinutes；省略时按频率自动计算' }
                },
                required: ['title']
            }
        },
        {
            name: 'followup_list',
            description: '列出当前群聊/单聊的跟进任务及最近流水。用户问「有哪些待跟进」「进度怎样」时调用。',
            parameters: {
                type: 'object',
                properties: { includeClosed: { type: 'boolean', description: '是否包含已完成/已取消的任务' } }
            }
        },
        {
            name: 'followup_update',
            description: '更新当前会话中某个跟进任务：记录进度、修改提醒人、频率、紧急度、下次提醒时间或内容。用户汇报进展但尚未完成时调用（填 progress）。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: '任务 ID（见系统提示中的任务列表）' },
                    progress: { type: 'string', description: '本次进展说明' },
                    title: { type: 'string' },
                    detail: { type: 'string' },
                    assignees: ASSIGNEE_SCHEMA,
                    dueAt: { type: 'string' },
                    pause: { type: 'boolean', description: 'true 暂停提醒，false 恢复提醒' },
                    ...SCHEDULE_PROPS
                },
                required: ['id']
            }
        },
        {
            name: 'followup_close',
            description: '关闭当前会话中的跟进任务：任务已完成（status=done）或不再需要（status=cancelled）。提出人或被提醒人说「完成了」「搞定」「不用跟了」时调用。',
            parameters: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: '任务 ID' },
                    status: { type: 'string', description: 'done 或 cancelled，默认 done' },
                    note: { type: 'string', description: '关闭说明，例如最终结果' }
                },
                required: ['id']
            }
        }
    ];
}

function formatTime(iso, calendar) {
    if (!iso) return '—';
    return schedule.describeNow(new Date(iso), calendar).replace(/（.*）$/, '');
}

function assigneeText(list) {
    return (list || []).map(item => `${item.name || item.account}${item.account && item.name ? `(${item.account})` : ''}`).join('、') || '未指定';
}

function taskLine(task, calendar) {
    return `- [${task.id}] ${task.title}｜${STATUS_LABEL[task.status]}｜紧急度 ${URGENCY_LABEL[task.urgency] || task.urgency}｜提醒 ${assigneeText(task.assignees)}｜${task.frequency}｜下次提醒 ${task.status === 'open' ? formatTime(task.nextRemindAt, calendar) : '—'}｜已提醒 ${task.remindCount} 次${task.progress ? `｜最新进展：${task.progress.slice(0, 120)}` : ''}`;
}

/** 系统提示补充：本会话已有任务 + 使用规则。 */
async function buildPrompt(ctx, calendar) {
    const tasks = await repo.listTasks(ctx.channel, { kind: ctx.conversation.kind, id: ctx.conversation.id, statuses: ['open', 'paused'], limit: 30 });
    const closed = await repo.listTasks(ctx.channel, { kind: ctx.conversation.kind, id: ctx.conversation.id, statuses: ['done', 'cancelled'], limit: 5 });
    const now = new Date();
    return `
**跟进任务（本会话的持久记忆）**
你可以使用 followup_* 工具在平台中持久保存当前${ctx.conversation.kind === 'group' ? '群聊' : '单聊'}的跟进任务，平台会按频率自动在本会话里 @ 相关人提醒，任务进展在平台工作区可见。
- 当前时间：${schedule.describeNow(now, calendar)}。当前时刻 ISO 格式参考：${schedule.formatZoneIso(now, calendar?.timezone)}。工作日历：周日至周四 ${calendar?.workStart || '09:00'}–${calendar?.workEnd || '18:00'}；紧急任务也可在周五/周六 ${calendar?.urgentStart || '09:00'}–${calendar?.urgentEnd || '21:00'} 跟进。
- 用户要求在相对时长后提醒（如“N分钟后/半小时后/2小时后”）时，必须优先在 followup_create 填 inMinutes（如 inMinutes=2），避免手动计算绝对时区时间的偏差。
- 当前发言人账号：${ctx.actor || '未知'}。
- 用户要求记录/跟进/提醒时必须调用 followup_create 真正保存，不要只在回复里写“已记录”；用户描述了频率就按描述设置，没描述就根据紧急程度判断（scheduleMode=auto）。
- 有人汇报进展时用 followup_update 记录 progress；提出人或被提醒人表示已完成/不用跟进时用 followup_close。
- 保存成功后，用简洁的 Markdown 回复：任务、提醒谁、频率与下次提醒时间、任务 ID；不要再说“仅本次对话有效”或“无法跨会话跟进”。
${tasks.length ? `本会话进行中的任务：\n${tasks.map(task => taskLine(task, calendar)).join('\n')}` : '本会话暂无进行中的跟进任务。'}
${closed.length ? `最近关闭的任务：\n${closed.map(task => taskLine(task, calendar)).join('\n')}` : ''}`;
}

function sameConversation(task, ctx) {
    return task && task.channel === ctx.channel && task.conversation.kind === ctx.conversation.kind && task.conversation.id === ctx.conversation.id;
}

async function ownTask(ctx, id) {
    const task = await repo.getTask(id);
    if (!sameConversation(task, ctx)) throw Object.assign(new Error(`本会话中没有任务 ${id}`), { code: 'FOLLOWUP_NOT_FOUND' });
    return task;
}

function taskResult(task, calendar, extra = '') {
    return JSON.stringify({
        ok: true,
        task: {
            id: task.id,
            title: task.title,
            status: STATUS_LABEL[task.status],
            urgency: URGENCY_LABEL[task.urgency],
            assignees: assigneeText(task.assignees),
            frequency: task.frequency,
            nextRemindAt: task.status === 'open' ? formatTime(task.nextRemindAt, calendar) : null,
            nextRemindNote: task.nextRemindNote || null,
            progress: task.progress || null,
            remindCount: task.remindCount
        },
        ...(extra ? { note: extra } : {})
    });
}

/**
 * 执行一个跟进工具。返回 { content, summary, isError, event }，event 用于随回复入库与界面展示。
 */
async function execute(ctx, name, args = {}, calendar) {
    const input = args && typeof args === 'object' ? args : {};
    try {
        if (name === 'followup_create') {
            const existing = (await repo.listTasks(ctx.channel, { kind: ctx.conversation.kind, id: ctx.conversation.id, statuses: ['open', 'paused'], limit: 50 }))
                .find(task => task.title.trim() === String(input.title || '').trim());
            if (existing) return { content: taskResult(existing, calendar, '同名任务已存在，未重复创建；如需修改请用 followup_update'), summary: `已存在：${existing.title}`, event: { type: 'followup', action: 'exists', id: existing.id, title: existing.title } };
            const task = await repo.createTask({ ...input, nextRemindAt: undefined, firstRemindAt: input.firstRemindAt || input.nextRemindAt, sourceText: ctx.userText }, ctx, calendar);
            return { content: taskResult(task, calendar), summary: `已创建：${task.title}`, event: { type: 'followup', action: 'created', id: task.id, title: task.title } };
        }
        if (name === 'followup_list') {
            const statuses = input.includeClosed ? null : ['open', 'paused'];
            const tasks = await repo.listTasks(ctx.channel, { kind: ctx.conversation.kind, id: ctx.conversation.id, statuses, limit: 30 });
            const detailed = [];
            for (const task of tasks.slice(0, 10)) {
                const events = await repo.listEvents(task.id, { limit: 5 });
                detailed.push({ ...JSON.parse(taskResult(task, calendar)).task, detail: task.detail.slice(0, 600), recent: events.map(event => `${formatTime(event.createdAt, calendar)} ${event.type} ${event.note}`.slice(0, 200)) });
            }
            return { content: JSON.stringify({ ok: true, count: tasks.length, tasks: detailed }), summary: `${tasks.length} 个任务` };
        }
        if (name === 'followup_update') {
            const task = await ownTask(ctx, input.id);
            const { id, pause, ...patch } = input;
            let updated = await repo.updateTask(task.id, patch, { actor: ctx.actor, calendar });
            if (pause === true) updated = await repo.setStatus(task.id, 'paused', { actor: ctx.actor, calendar });
            if (pause === false && updated.status === 'paused') updated = await repo.setStatus(task.id, 'open', { actor: ctx.actor, calendar });
            return { content: taskResult(updated, calendar), summary: `已更新：${updated.title}`, event: { type: 'followup', action: patch.progress ? 'progress' : 'updated', id: updated.id, title: updated.title } };
        }
        if (name === 'followup_close') {
            const task = await ownTask(ctx, input.id);
            const status = input.status === 'cancelled' ? 'cancelled' : 'done';
            const closed = await repo.setStatus(task.id, status, { actor: ctx.actor, note: input.note || '', calendar });
            return { content: taskResult(closed, calendar), summary: `已${status === 'done' ? '完成' : '取消'}：${closed.title}`, event: { type: 'followup', action: status, id: closed.id, title: closed.title } };
        }
        return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: error.message, isError: true };
    }
}

/**
 * 带跟进工具的一轮回复。
 * @returns {Promise<{text, usage, toolLog, events}>}
 */
async function runTurn({ client, systemInstruction, messages, ctx, calendar, signal, onDelta, maxOutputTokens, temperature }) {
    const tools = definitions();
    const history = messages.map(item => ({ ...item }));
    const usage = { promptTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const toolLog = [];
    const events = [];
    let activeClient = client;
    for (let step = 1; step <= MAX_STEPS; step += 1) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        let result;
        try {
            result = await activeClient.generateText({ systemInstruction, messages: history, tools, maxOutputTokens, temperature, signal, onDelta });
        } catch (error) {
            // 模型/网关不支持函数调用：退回普通回复，跟进任务不可用但对话照常
            if (step === 1 && error?.code === 'AI_TOOLS_UNSUPPORTED') {
                result = await activeClient.generateText({ systemInstruction: `${systemInstruction}\n\n（当前模型不支持工具调用，跟进任务暂不可保存；如用户要求记录任务，请说明需要管理员切换支持函数调用的模型。）`, messages: history, maxOutputTokens, temperature, signal, onDelta });
                return { text: result.text || '', usage: result.usage || usage, toolLog, events, toolsUnsupported: true };
            }
            throw error;
        }
        if (result.providerClient) activeClient = result.providerClient;
        usage.promptTokens = Number(result.usage?.promptTokens || 0);
        usage.inputTokens += Number(result.usage?.promptTokens || 0);
        usage.outputTokens += Number(result.usage?.outputTokens || 0);
        usage.totalTokens += Number(result.usage?.totalTokens || 0);
        const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
        if (!calls.length) return { text: result.text || '', usage, toolLog, events };
        if (result.text && onDelta) onDelta('\n\n');
        history.push({ role: 'model', content: result.text || '', toolCalls: calls });
        const toolResults = [];
        for (const call of calls) {
            const outcome = await execute(ctx, call.name, call.args, calendar);
            toolLog.push({ tool: call.name, ok: !outcome.isError, summary: outcome.summary });
            if (outcome.event) events.push(outcome.event);
            toolResults.push({ id: call.id, name: call.name, content: outcome.content, isError: Boolean(outcome.isError) });
        }
        history.push({ role: 'tool', toolResults });
    }
    const text = '已达到单轮最大工具调用步数，请再发一条消息继续。';
    onDelta?.(text);
    return { text, usage, toolLog, events };
}

module.exports = { definitions, buildPrompt, execute, runTurn, URGENCY_LABEL, STATUS_LABEL, assigneeText, formatTime };
