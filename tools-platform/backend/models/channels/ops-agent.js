// @ops-group Skill 的工具：管理员在首页 Dragon Claw（普通对话，不选工作目录）里配置、测试、检查与推送自动化运营。
// 写操作只作用于运营数据（运营群组、运营计划、运行记录、运营规范）；真正发到群里的只有 ops_send_draft，
// 且同一轮里刚生成的草稿不能直接发送——必须先在回复里给用户看过、下一条消息确认后才能发。
const opsRepo = require('./ops-repository');
const opsService = require('./ops-service');
const opsMaterials = require('./ops-materials');
const opsSchedule = require('./ops-schedule');
const opsLibrary = require('./ops-library');
const targetsRepo = require('./channel-targets-repository');

const SKILL_ID = 'ops-group';
const MAX_STEPS = 10;
const CHANNEL_LABELS = { welink: 'WeLink', weixin: '微信' };

const TARGET_SCHEMA = {
    type: 'object',
    properties: {
        channel: { type: 'string', description: 'welink 或 weixin' },
        kind: { type: 'string', description: 'group（群）或 user（联系人）；微信只能是 user' },
        id: { type: 'string', description: '来自 ops_list_targets 的 id' }
    },
    required: ['channel', 'kind', 'id']
};
const PLAN_PROPS = {
    id: { type: 'string', description: '修改已有计划时填计划 id；新建时不填' },
    presetId: { type: 'string', description: '新建时可指定内置模板 id（来自 ops_list_presets），模板提供提示词、素材与定时，其余传入字段会覆盖模板' },
    name: { type: 'string', description: '计划名称，如「每日小技巧」' },
    enabled: { type: 'boolean', description: '是否启用定时；新建时建议先 false，测试满意后再启用' },
    targets: { type: 'array', description: '推送对象（运营群组）', items: TARGET_SCHEMA },
    contentMode: { type: 'string', description: 'ai（Dragon Claw 按提示词生成，默认）或 template（固定模板 + 变量）' },
    prompt: { type: 'string', description: 'AI 模式的运营提示词：这条消息要讲什么、风格、长度、互动方式' },
    template: { type: 'string', description: '模板模式的正文，可用变量 {{date}} {{weekday}} {{group}} {{highlight_title}} {{highlight}} {{highlight_pain}} {{highlight_howto}} {{highlight_link}} {{highlights}} {{angle}} {{video_title}} {{video_link}} {{video_desc}} {{feature}} {{features}} {{platform_url}}' },
    sources: { type: 'array', description: '素材：highlights（内置功能亮点库随机抽取，如 AI 月报亮点）、features（平台新功能）、videos（媒体库小视频）、metrics（指标/报表，仅 AI 模式）、chat（群近期对话与跟进）', items: { type: 'string' } },
    options: {
        type: 'object',
        description: '素材选项',
        properties: {
            videoCategory: { type: 'string', description: '只从该媒体分类（名称或 id）挑视频，留空为全部公开分类' },
            featureDays: { type: 'integer', description: '新功能回看天数，默认 7' },
            highlightTopic: { type: 'string', description: '亮点专题，默认 ai-report（AI 月报）' },
            highlightCount: { type: 'integer', description: '每次抽几个亮点（1~5），默认 1' },
            angle: { type: 'string', description: '运营角度：random（每次随机）或 tip / pain / story / quiz / myth / challenge' }
        }
    },
    schedule: {
        type: 'object',
        description: '定时规则（工作日历时区，默认开罗时间）',
        properties: {
            type: { type: 'string', description: 'daily（每天/每个工作日）| weekly（每周几）| interval（每隔多少分钟）' },
            times: { type: 'array', items: { type: 'string' }, description: '发送时刻 HH:MM，可多个' },
            weekdays: { type: 'array', items: { type: 'integer' }, description: 'weekly 用：0=周日 … 6=周六' },
            workdaysOnly: { type: 'boolean', description: 'daily/interval：是否只在工作日（默认 true）' },
            intervalMinutes: { type: 'integer', description: 'interval 用：间隔分钟（最少 30）' }
        }
    },
    sendMode: { type: 'string', description: 'draft（到点生成草稿，确认后再发，默认）或 auto（到点自动发送）' }
};

function definitions() {
    return [
        { name: 'ops_overview', description: '查看自动化运营全貌：运营规范、平台访问地址、运营群组、运营计划（含下次运行时间）、待确认草稿。开始配置前先调用。', parameters: { type: 'object', properties: {} } },
        {
            name: 'ops_list_targets',
            description: '列出频道里与助理互动过的群/联系人，用于选择运营群组与推送对象。canPush=false 表示暂时无法推送。',
            parameters: { type: 'object', properties: { channel: { type: 'string', description: 'welink 或 weixin，默认全部' }, kind: { type: 'string', description: 'group 或 user' }, query: { type: 'string', description: '按名称/账号过滤' } } }
        },
        {
            name: 'ops_save_group',
            description: '把一个群/联系人标记为运营群组，或修改它的名称、群画像、互动人设。互动人设会用于群成员 @助手 时的回复风格。',
            parameters: {
                type: 'object',
                properties: {
                    ...TARGET_SCHEMA.properties,
                    name: { type: 'string', description: '显示名' },
                    profile: { type: 'string', description: '群画像：成员是谁、关注什么、负责哪些指标/区域' },
                    interactionPrompt: { type: 'string', description: '互动人设：群成员与助手对话时的语气、要鼓励的行为、可以发起的小活动' },
                    enabled: { type: 'boolean' }
                },
                required: ['channel', 'kind', 'id']
            }
        },
        { name: 'ops_list_presets', description: '列出内置运营计划模板（写好的运营提示词 + 素材 + 定时），以及亮点专题与运营角度。用户想快速开始或要「默认提示词」时先调用。', parameters: { type: 'object', properties: {} } },
        { name: 'ops_remove_group', description: '取消某个群的运营群组标记（不影响已有计划里的推送对象）。', parameters: { type: 'object', properties: TARGET_SCHEMA.properties, required: ['channel', 'kind', 'id'] } },
        { name: 'ops_save_plan', description: '新建或修改运营计划（修改时只传要改的字段）。返回计划详情与下次运行时间。', parameters: { type: 'object', properties: PLAN_PROPS } },
        { name: 'ops_delete_plan', description: '删除运营计划。只有用户在消息里明确要求删除时才调用，并设置 confirmed=true。', parameters: { type: 'object', properties: { id: { type: 'string' }, confirmed: { type: 'boolean' } }, required: ['id', 'confirmed'] } },
        { name: 'ops_preview', description: '按计划立即生成一条内容作为草稿（不发送），用于检查效果。返回草稿 id 与正文，必须把正文完整展示给用户。', parameters: { type: 'object', properties: { planId: { type: 'string' } }, required: ['planId'] } },
        {
            name: 'ops_test_send',
            description: '按计划生成内容并只推送给指定的测试对象（如用户自己的微信），不发到计划的群。只推给用户明确指定的测试对象。',
            parameters: { type: 'object', properties: { planId: { type: 'string' }, targets: { type: 'array', items: TARGET_SCHEMA } }, required: ['planId', 'targets'] }
        },
        { name: 'ops_update_draft', description: '修改草稿正文（发送前按用户意见调整）。', parameters: { type: 'object', properties: { runId: { type: 'string' }, content: { type: 'string' } }, required: ['runId', 'content'] } },
        {
            name: 'ops_send_draft',
            description: '把草稿推送到计划的运营群组（真实发送）。只有用户看过草稿正文并在消息里明确说「发送/确认推送」后才能调用；本轮刚生成的草稿不能发送。',
            parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] }
        },
        { name: 'ops_discard_draft', description: '作废一条草稿。', parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] } },
        { name: 'ops_list_runs', description: '查看运营推送记录（生成、草稿、发送结果），用于检查运行情况。', parameters: { type: 'object', properties: { planId: { type: 'string' }, status: { type: 'string', description: 'draft | sent | partial | failed | discarded' }, limit: { type: 'integer' } } } },
        {
            name: 'ops_materials',
            description: '查看可用素材：highlights（内置功能亮点库）、features（平台近期新功能）或 videos（媒体库可推送视频）。',
            parameters: { type: 'object', properties: { kind: { type: 'string', description: 'highlights、features 或 videos' }, topic: { type: 'string', description: 'highlights 的专题，默认 ai-report' }, days: { type: 'integer', description: 'features 回看天数' }, category: { type: 'string', description: 'videos 分类' } }, required: ['kind'] }
        },
        {
            name: 'ops_save_settings',
            description: '保存全局运营规范（所有计划生成内容、运营群互动都遵守）或平台对外访问地址（用于生成功能/视频链接）。修改规范前先用 ops_overview 读取现有内容，在其基础上调整。',
            parameters: { type: 'object', properties: { styleGuide: { type: 'string' }, publicBaseUrl: { type: 'string', description: '如 https://tools.example.com' } } }
        }
    ];
}

function planSummary(plan) {
    return {
        id: plan.id,
        name: plan.name,
        enabled: plan.enabled,
        targets: plan.targets.map(item => `${CHANNEL_LABELS[item.channel] || item.channel}${item.kind === 'group' ? '群' : '联系人'}:${item.id}`),
        contentMode: plan.contentMode,
        prompt: plan.prompt.slice(0, 800),
        template: plan.template.slice(0, 800),
        sources: plan.sources,
        options: plan.options,
        schedule: plan.scheduleText,
        sendMode: plan.sendMode === 'auto' ? '自动发送' : '先出草稿',
        nextRunAt: plan.nextRunAt,
        lastRunAt: plan.lastRunAt
    };
}

function runSummary(run, full = false) {
    return {
        id: run.id,
        plan: run.planName,
        trigger: run.trigger,
        status: run.status,
        createdAt: run.createdAt,
        sentAt: run.sentAt,
        content: full ? run.content : run.content.slice(0, 300),
        video: run.meta?.videoTitle || '',
        highlights: run.meta?.highlightTitles || [],
        angle: run.meta?.angle || '',
        results: run.results.map(item => `${item.name}：${item.ok ? '成功' : `失败（${item.error}）`}`),
        error: run.error
    };
}

// 工作区 Agent 里按类别走审批卡（与文件、数据库工具同一套权限模式）：write 改运营配置、destructive 删除、external 真实推送
const KINDS = {
    ops_overview: 'read', ops_list_targets: 'read', ops_list_presets: 'read', ops_list_runs: 'read', ops_materials: 'read',
    ops_save_group: 'write', ops_save_plan: 'write', ops_preview: 'write', ops_update_draft: 'write', ops_discard_draft: 'write', ops_save_settings: 'write',
    ops_remove_group: 'destructive', ops_delete_plan: 'destructive',
    ops_test_send: 'external', ops_send_draft: 'external'
};
const TITLES = {
    ops_save_group: '保存运营群组', ops_save_plan: '保存运营计划', ops_preview: '生成草稿（不发送）', ops_update_draft: '修改草稿', ops_discard_draft: '作废草稿',
    ops_save_settings: '保存运营规范', ops_remove_group: '取消运营群组', ops_delete_plan: '删除运营计划', ops_test_send: '测试推送', ops_send_draft: '推送草稿到运营群组'
};
const FIELD_LABELS = { channel: '频道', kind: '类型', id: 'ID', name: '名称', profile: '群画像', interactionPrompt: '互动人设', enabled: '启用', planId: '计划', runId: '草稿',
    content: '正文', styleGuide: '运营规范', publicBaseUrl: '访问地址', targets: '推送对象', confirmed: '已确认' };

function kindOf(name) { return KINDS[name] || null; }

const targetText = targets => (Array.isArray(targets) ? targets : []).map(item => `${CHANNEL_LABELS[item.channel] || item.channel || ''}${item.kind === 'group' ? '群' : '联系人'}:${item.id}`).join('、');

/** 审批卡内容：标题、影响说明和参数表；推送草稿时带上将要发出的正文和推送对象 */
async function preview(name, args = {}) {
    const input = args && typeof args === 'object' ? args : {};
    const fields = Object.entries(input).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => ({
        label: FIELD_LABELS[key] || key,
        value: key === 'targets' ? targetText(value) : (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 1200)
    }));
    let impact = KINDS[name] === 'external' ? '会真实发送消息' : KINDS[name] === 'destructive' ? '删除后不能撤销' : '修改自动化运营配置';
    if (name === 'ops_send_draft' && input.runId) {
        const run = await opsRepo.getRun(input.runId).catch(() => null);
        if (run) {
            impact = `会发送到：${targetText(run.targets) || '计划的运营群组'}`;
            fields.push({ label: '计划', value: run.planName }, { label: '正文', value: String(run.content || '').slice(0, 2000) });
        }
    }
    return { title: `运营 · ${TITLES[name] || name}`, impact, fields };
}

function ok(payload, summary, extra = {}) {
    return { content: JSON.stringify({ ok: true, ...payload }), summary, ...extra };
}

async function execute(ctx, name, args = {}) {
    const input = args && typeof args === 'object' ? args : {};
    try {
        if (name === 'ops_overview') {
            const [settings, groups, plans, drafts] = await Promise.all([opsRepo.getSettings(), opsRepo.listGroups(), opsRepo.listPlans(), opsRepo.listRuns({ status: 'draft', limit: 10 })]);
            return ok({
                settings: { styleGuide: settings.styleGuide, publicBaseUrl: settings.publicBaseUrl || '（未设置，链接将使用站内相对路径）' },
                groups: groups.map(item => ({ channel: item.channel, kind: item.kind, id: item.id, name: item.name, profile: item.profile, interactionPrompt: item.interactionPrompt, enabled: item.enabled })),
                plans: plans.map(planSummary),
                drafts: drafts.map(run => runSummary(run))
            }, `运营群组 ${groups.length} 个，计划 ${plans.length} 个，草稿 ${drafts.length} 条`);
        }
        if (name === 'ops_list_targets') {
            const channels = input.channel ? [input.channel] : opsRepo.CHANNELS;
            const rows = [];
            for (const channel of channels.filter(item => opsRepo.CHANNELS.includes(item))) {
                const items = await targetsRepo.listTargets(channel, { kind: input.kind, q: input.query, limit: 100 });
                const marked = new Set((await opsRepo.listGroups({ channel })).map(item => `${item.kind}:${item.id}`));
                items.forEach(item => rows.push({ channel, kind: item.kind, id: item.id, name: item.name, canPush: item.canPush && !(channel === 'weixin' && item.kind === 'group'), opsGroup: marked.has(`${item.kind}:${item.id}`), lastActiveAt: item.lastActiveAt }));
            }
            return ok({ items: rows.slice(0, 150) }, `频道对象 ${rows.length} 个`);
        }
        if (name === 'ops_save_group') {
            const group = await opsRepo.saveGroup(input);
            return ok({ group }, `运营群组：${group.name}`);
        }
        if (name === 'ops_remove_group') {
            const removed = await opsRepo.removeGroup(input.channel, input.kind, input.id);
            return ok({ removed }, removed ? '已取消运营群组' : '该对象不是运营群组');
        }
        if (name === 'ops_list_presets') {
            return ok({
                presets: opsLibrary.listPresets().map(item => ({ id: item.id, name: item.name, description: item.description, contentMode: item.contentMode, prompt: item.prompt || item.template, sources: item.sources, options: item.options, schedule: opsSchedule.describe(item.schedule) })),
                topics: opsLibrary.listTopics(),
                angles: opsLibrary.listAngles()
            }, `内置模板 ${opsLibrary.listPresets().length} 个`);
        }
        if (name === 'ops_save_plan') {
            if (input.presetId && !input.id) {
                const { presetId, ...overrides } = input;
                const created = await opsService.createFromPreset(presetId, overrides, ctx.actor);
                return ok({ plan: planSummary(created) }, `已按模板创建计划：${created.name}`);
            }
            const plan = await opsService.savePlan(input, ctx.actor);
            return ok({ plan: planSummary(plan) }, `${input.id ? '已修改' : '已创建'}计划：${plan.name}`);
        }
        if (name === 'ops_delete_plan') {
            if (input.confirmed !== true) return { content: '删除前需要用户明确确认，确认后设置 confirmed=true 再调用。', summary: '等待确认', isError: true };
            const deleted = await opsRepo.deletePlan(input.id);
            return ok({ deleted }, deleted ? '已删除计划' : '计划不存在');
        }
        if (name === 'ops_preview') {
            const run = await opsService.runPlan(input.planId, { trigger: 'manual', mode: 'draft', actor: ctx.actor });
            ctx.createdRunIds.add(run.id);
            if (run.status === 'failed') return { content: `生成失败：${run.error}`, summary: '生成失败', isError: true };
            return ok({ draft: runSummary(run, true), note: '这是草稿，尚未发送。请把正文完整展示给用户，询问是否需要修改或确认推送。' }, `已生成草稿 ${run.id}`);
        }
        if (name === 'ops_test_send') {
            const run = await opsService.runPlan(input.planId, { trigger: 'test', testTargets: input.targets, actor: ctx.actor });
            ctx.createdRunIds.add(run.id);
            return ok({ run: runSummary(run, true) }, `测试推送：${run.status}`, run.status === 'sent' ? {} : { isError: true });
        }
        if (name === 'ops_update_draft') {
            const run = await opsService.updateDraft(input.runId, input.content);
            return ok({ draft: runSummary(run, true) }, '已修改草稿');
        }
        if (name === 'ops_send_draft') {
            if (ctx.createdRunIds.has(input.runId)) {
                return { content: '这条草稿是本轮刚生成的，用户还没看过。请先把正文展示给用户，等用户在下一条消息里确认后再发送。', summary: '需用户先确认草稿', isError: true };
            }
            const run = await opsService.sendRun(input.runId, { actor: ctx.actor });
            return ok({ run: runSummary(run) }, `推送结果：${run.status}`, run.status === 'sent' ? {} : { isError: true });
        }
        if (name === 'ops_discard_draft') {
            const run = await opsService.discardRun(input.runId);
            return ok({ run: runSummary(run) }, '已作废草稿');
        }
        if (name === 'ops_list_runs') {
            const runs = await opsRepo.listRuns({ planId: input.planId, status: input.status, limit: Math.min(50, Number(input.limit) || 15) });
            return ok({ runs: runs.map(run => runSummary(run)) }, `运营记录 ${runs.length} 条`);
        }
        if (name === 'ops_materials') {
            if (input.kind === 'highlights') {
                const topic = opsLibrary.getTopic(input.topic || 'ai-report');
                return ok({ topic: topic ? { name: topic.name, entry: topic.entry, summary: topic.summary } : null, items: topic?.highlights || [] }, `亮点 ${topic?.highlights.length || 0} 个`);
            }
            if (input.kind === 'videos') {
                const items = opsMaterials.listVideos({ category: input.category, limit: 30 });
                return ok({ items }, `可推送视频 ${items.length} 个`);
            }
            const items = await opsMaterials.recentFeatures(Math.min(90, Math.max(1, Number(input.days) || 7)));
            return ok({ items }, `近期新功能 ${items.length} 条`);
        }
        if (name === 'ops_save_settings') {
            const settings = await opsRepo.saveSettings({ styleGuide: input.styleGuide, publicBaseUrl: input.publicBaseUrl });
            return ok({ settings }, '已保存运营规范');
        }
        return { content: `未知工具：${name}`, summary: '未知工具', isError: true };
    } catch (error) {
        return { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: error.message, isError: true };
    }
}

async function buildPrompt() {
    const [groups, plans, drafts] = await Promise.all([opsRepo.listGroups(), opsRepo.listPlans(), opsRepo.listRuns({ status: 'draft', limit: 5 })]);
    return [
        '',
        '【自动化运营工具（@ops-group）】',
        `当前有运营群组 ${groups.length} 个、运营计划 ${plans.length} 个、待确认草稿 ${drafts.length} 条。用 ops_* 工具查看与修改，配置细节以工具返回为准，不要凭记忆回答。`,
        `定时规则示例：${opsSchedule.describe({ type: 'daily', times: ['09:30'] })}；时间按平台工作日历时区。`,
        '只有工具返回成功后才能说已保存/已发送；真实推送前必须让用户看过正文并明确确认。'
    ].join('\n');
}

/**
 * 带运营工具的一轮回复（与跟进任务相同的工具循环）。
 * @returns {Promise<{text, usage, toolLog}>}
 */
async function runTurn({ client, systemInstruction, messages, ctx, signal, onDelta, maxOutputTokens, temperature }) {
    const tools = definitions();
    const history = messages.map(item => ({ ...item }));
    const usage = { promptTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    const toolLog = [];
    const turnCtx = { ...ctx, createdRunIds: new Set() };
    let activeClient = client;
    for (let step = 1; step <= MAX_STEPS; step += 1) {
        if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        let result;
        try {
            result = await activeClient.generateText({ systemInstruction, messages: history, tools, maxOutputTokens, temperature, signal, onDelta });
        } catch (error) {
            if (step === 1 && error?.code === 'AI_TOOLS_UNSUPPORTED') {
                result = await activeClient.generateText({ systemInstruction: `${systemInstruction}\n\n（当前模型不支持工具调用，运营配置暂不可用；请说明需要管理员切换支持函数调用的模型。）`, messages: history, maxOutputTokens, temperature, signal, onDelta });
                return { text: result.text || '', usage: result.usage || usage, toolLog, toolsUnsupported: true };
            }
            throw error;
        }
        if (result.providerClient) activeClient = result.providerClient;
        usage.promptTokens = Number(result.usage?.promptTokens || 0);
        usage.inputTokens += Number(result.usage?.promptTokens || 0);
        usage.outputTokens += Number(result.usage?.outputTokens || 0);
        usage.totalTokens += Number(result.usage?.totalTokens || 0);
        const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
        if (!calls.length) return { text: result.text || '', usage, toolLog };
        if (result.text && onDelta) onDelta('\n\n');
        history.push({ role: 'model', content: result.text || '', toolCalls: calls });
        const toolResults = [];
        for (const call of calls) {
            const outcome = await execute(turnCtx, call.name, call.args);
            toolLog.push({ tool: call.name, ok: !outcome.isError, summary: outcome.summary });
            toolResults.push({ id: call.id, name: call.name, content: outcome.content, isError: Boolean(outcome.isError) });
        }
        history.push({ role: 'tool', toolResults });
    }
    const text = '已达到单轮最大工具调用步数，请再发一条消息继续。';
    onDelta?.(text);
    return { text, usage, toolLog };
}

module.exports = { SKILL_ID, definitions, execute, kindOf, preview, buildPrompt, runTurn };
