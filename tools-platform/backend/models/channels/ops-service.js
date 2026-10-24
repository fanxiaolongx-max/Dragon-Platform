// 自动化运营：按计划生成运营内容并推送到运营群组。
//   生成：模板模式替换变量；AI 模式交给 Dragon Claw（带运营规范、群画像与素材，可自行查只读指标数据）。
//   发送：计划的 sendMode=auto 到点直接推送；draft 先存草稿，确认后（平台页面或 Dragon Claw）再推送。
//   测试：生成后只推给指定的测试对象（例如管理员自己的微信），不计入正式记录。
// 调度器每分钟检查各租户到期的计划；next_run_at 先推进再执行，避免重复发送。
const { runWithTenant } = require('../tenant-context');
const opsRepo = require('./ops-repository');
const opsSchedule = require('./ops-schedule');
const materials = require('./ops-materials');
const targetsRepo = require('./channel-targets-repository');
const followupSchedule = require('./followup-schedule');

const TICK_MS = 60 * 1000;
const BATCH = 10;
const GENERATE_TIMEOUT_MS = 3 * 60 * 1000;
const CHANNEL_LABELS = { welink: 'WeLink', weixin: '微信' };
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
let timer = null;
let ticking = false;

function serviceError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

async function calendar() {
    try {
        return (await require('./welink-config-repository').getConfig()).followup.calendar;
    } catch {
        return followupSchedule.DEFAULT_CALENDAR;
    }
}

/** 推送对象补上显示名与运营群画像。 */
async function describeTargets(targets) {
    const items = [];
    for (const target of targets) {
        const [stored, group] = await Promise.all([
            targetsRepo.getTarget(target.channel, target.kind, target.id).catch(() => null),
            opsRepo.getGroup(target.channel, target.kind, target.id).catch(() => null)
        ]);
        items.push({ ...target, name: group?.name && group.name !== target.id ? group.name : (stored?.name || target.id), profile: group?.profile || '' });
    }
    return items;
}

function dateParts(cal) {
    const now = new Date();
    const parts = followupSchedule.zoneParts(now, cal.timezone);
    return { date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`, weekday: WEEKDAYS[parts.weekday] };
}

function renderTemplate(template, vars) {
    return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, name) => (vars[name.toLowerCase()] ?? match));
}

function templateVars({ targets, found, cal }) {
    const { date, weekday } = dateParts(cal);
    const features = found.features || [];
    const highlight = found.highlights?.[0] || {};
    return {
        highlight_title: highlight.title || '',
        highlight: highlight.value || '',
        highlight_pain: highlight.pain || '',
        highlight_howto: highlight.howTo || '',
        highlight_link: found.highlightTopic?.link || '',
        highlights: (found.highlights || []).map(item => `- ${item.title}：${item.value}`).join('\n'),
        angle: found.angle?.name || '',
        date,
        weekday,
        group: targets.map(item => item.name).join('、'),
        video_title: found.video?.title || '',
        video_link: found.video?.link || '',
        video_desc: found.video?.description || '',
        feature: features[0]?.summary || '',
        features: features.map(item => `- ${item.summary}（${item.date}）`).join('\n'),
        platform_url: found.settings.publicBaseUrl || ''
    };
}

function aiContext({ plan, targets, found }) {
    const lines = [
        '你现在是平台的「群运营助手」，负责为运营群组撰写一条将要推送到群里的运营消息。',
        '',
        '【运营规范（必须遵守）】',
        found.settings.styleGuide,
        '',
        '【推送对象】',
        ...targets.map(item => `- ${CHANNEL_LABELS[item.channel] || item.channel}${item.kind === 'group' ? '群' : '联系人'}「${item.name}」${item.profile ? `：${item.profile}` : ''}`)
    ];
    if (found.settings.publicBaseUrl) lines.push('', `【平台访问地址】${found.settings.publicBaseUrl}（介绍功能时可拼接页面路径给出完整链接）`);
    if (found.highlights?.length) {
        lines.push('', `【功能亮点（${found.highlightTopic?.name || ''}，本次随机抽取，只介绍这些）】`);
        found.highlights.forEach((item, index) => lines.push(`${index + 1}. ${item.title}`, `   以前的麻烦：${item.pain}`, `   现在的做法：${item.value}`, `   怎么用：${item.howTo}`));
        if (found.highlightTopic?.link) lines.push(`入口链接：${found.highlightTopic.link}`);
        if (found.highlightTopic?.summary) lines.push(`（背景：${found.highlightTopic.summary}）`);
    }
    if (found.angle) lines.push('', `【运营角度：${found.angle.name}】${found.angle.guide}`);
    if (found.features.length) {
        lines.push('', '【平台近期新功能（来自开发提交记录，英文摘要，请用通俗中文介绍，挑最有价值的 1~2 个）】', ...found.features.map(item => `- ${item.date} ${item.scope ? `[${item.scope}] ` : ''}${item.summary}`));
    }
    if (found.video) {
        lines.push('', '【今日视频（必须在消息中附上链接）】', `标题：${found.video.title}`, `分类：${found.video.category}`, `简介：${found.video.description}`, `链接：${found.video.link}`);
    }
    if (found.chat) lines.push('', '【群里近期的对话与跟进（可呼应，但不要泄露与本群无关的信息）】', found.chat);
    if ((plan.sources || []).includes('metrics')) lines.push('', '【数据】需要时请查询平台只读指标/报表数据，引用数字须注明数据时间，不得编造。');
    return lines.join('\n');
}

/** 用 Dragon Claw 生成消息正文（不写入聊天记录）。 */
async function generateWithAi({ plan, targets, found }) {
    const bridge = require('./dragon-claw-channel-bridge');
    let streamed = '';
    let finalText = '';
    let failure = '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);
    try {
        await bridge.runTurn({
            channel: 'ops',
            account: `plan-${plan.id || 'preview'}`,
            conversation: null,
            text: `${plan.prompt}\n\n请直接输出要发到群里的消息正文（Markdown），不要解释你的写作过程，不要加「以下是消息」之类的前后缀。`,
            contextNote: aiContext({ plan, targets, found }),
            persist: false,
            signal: controller.signal,
            onEvent: event => {
                if (event.type === 'delta' && event.delta) streamed += event.delta;
                else if (event.type === 'done') finalText = String(event.reply || streamed);
                else if (event.type === 'error') failure = String(event.error || 'AI 生成失败');
                else if (event.type === 'http-json' && event.status >= 400) failure = String(event.body?.error || `AI 生成失败（HTTP ${event.status}）`);
            }
        });
    } finally {
        clearTimeout(timeout);
    }
    if (controller.signal.aborted) throw serviceError('OPS_GENERATE_TIMEOUT', 'AI 生成超时');
    if (failure) throw serviceError('OPS_GENERATE_FAILED', failure, 502);
    const text = String(finalText || streamed).trim();
    if (!text) throw serviceError('OPS_GENERATE_EMPTY', 'AI 没有生成内容');
    return text;
}

/** 生成一次内容，返回正文与素材标记（不保存、不发送）。 */
async function generate(plan) {
    const cal = await calendar();
    const targets = await describeTargets(plan.targets);
    const found = await materials.collect(plan, targets);
    let content = plan.contentMode === 'template'
        ? renderTemplate(plan.template, templateVars({ targets, found, cal })).trim()
        : await generateWithAi({ plan, targets, found });
    if (found.video?.link && !content.includes(found.video.link)) content += `\n\n🎬 ${found.video.title}：${found.video.link}`;
    if (!content) throw serviceError('OPS_GENERATE_EMPTY', '生成的内容为空，请检查模板');
    return {
        content,
        meta: {
            videoId: found.video?.id || '',
            videoTitle: found.video?.title || '',
            features: found.features.length,
            highlightIds: (found.highlights || []).map(item => item.id),
            highlightTitles: (found.highlights || []).map(item => item.title),
            angle: found.angle?.id || ''
        }
    };
}

/** 按计划推送一条已生成的内容到各推送对象（逐个推送，分别记录结果）。 */
async function deliver(content, targets, { trigger = 'system', source = '' } = {}) {
    const channels = require('./index');
    const results = [];
    for (const target of targets) {
        try {
            const result = await channels.push({ channel: target.channel, text: content, targets: [{ kind: target.kind, id: target.id }], trigger, source });
            const item = result.results[0] || {};
            results.push({ channel: target.channel, kind: target.kind, id: target.id, name: item.name || target.id, ok: Boolean(item.ok), error: item.error || '' });
        } catch (error) {
            results.push({ channel: target.channel, kind: target.kind, id: target.id, name: target.id, ok: false, error: error.message });
        }
    }
    return results;
}

function runStatus(results) {
    const sent = results.filter(item => item.ok).length;
    if (!sent) return 'failed';
    return sent === results.length ? 'sent' : 'partial';
}

/**
 * 执行一次计划。
 * @param {string} planId
 * @param {object} options
 * @param {'schedule'|'manual'|'test'} [options.trigger]
 * @param {'plan'|'draft'|'send'} [options.mode] plan=按计划的发送方式；draft=只出草稿；send=生成后直接发送
 * @param {Array} [options.testTargets] trigger=test 时推送的对象（不发到计划的群）
 */
async function runPlan(planId, { trigger = 'manual', mode = 'draft', testTargets = [], actor = '' } = {}) {
    const plan = await opsRepo.getPlan(planId);
    if (!plan) throw serviceError('OPS_PLAN_NOT_FOUND', '运营计划不存在', 404);
    const targets = trigger === 'test' ? opsRepo.normalizeTargets(testTargets) : plan.targets;
    if (!targets.length) throw serviceError('OPS_TARGET_INVALID', trigger === 'test' ? '请指定测试推送对象' : '计划没有推送对象');
    let runRecord = await opsRepo.createRun({ planId: plan.id, planName: plan.name, trigger, status: 'generating', targets, createdBy: actor });
    let generated;
    try {
        generated = await generate(plan);
    } catch (error) {
        return opsRepo.updateRun(runRecord.id, { status: 'failed', error: error.message });
    }
    runRecord = await opsRepo.updateRun(runRecord.id, { status: 'draft', content: generated.content, meta: generated.meta });
    const send = trigger === 'test' || mode === 'send' || (mode === 'plan' && plan.sendMode === 'auto');
    return send ? sendRun(runRecord.id, { actor, trigger: trigger === 'schedule' ? 'scheduled' : 'system' }) : runRecord;
}

/** 推送草稿；content 传入时先替换正文（确认前修改过）。 */
async function sendRun(runId, { content, actor = '', trigger = 'system' } = {}) {
    let record = await opsRepo.getRun(runId);
    if (!record) throw serviceError('OPS_RUN_NOT_FOUND', '运营记录不存在', 404);
    if (record.status !== 'draft') throw serviceError('OPS_RUN_NOT_DRAFT', `只有草稿可以发送（当前状态：${record.status}）`);
    if (content !== undefined) {
        const text = String(content || '').trim();
        if (!text) throw serviceError('OPS_RUN_EMPTY', '消息内容不能为空');
        record = await opsRepo.updateRun(runId, { content: text });
    }
    // 来源前缀 ops / ops-test：频道时间线据此标注「运营推送 / 测试推送」
    const prefix = record.trigger === 'test' ? 'ops-test' : 'ops';
    const results = await deliver(record.content, record.targets, { trigger, source: `${prefix}:${record.planName || record.planId}${actor ? ` @${actor}` : ''}` });
    const status = runStatus(results);
    return opsRepo.updateRun(runId, { status, results, sentAt: new Date().toISOString(), error: status === 'sent' ? '' : results.filter(item => !item.ok).map(item => `${item.name}：${item.error}`).join('；') });
}

async function updateDraft(runId, content) {
    const record = await opsRepo.getRun(runId);
    if (!record) throw serviceError('OPS_RUN_NOT_FOUND', '运营记录不存在', 404);
    if (record.status !== 'draft') throw serviceError('OPS_RUN_NOT_DRAFT', '只有草稿可以修改');
    const text = String(content || '').trim();
    if (!text) throw serviceError('OPS_RUN_EMPTY', '消息内容不能为空');
    return opsRepo.updateRun(runId, { content: text });
}

async function discardRun(runId) {
    const record = await opsRepo.getRun(runId);
    if (!record) throw serviceError('OPS_RUN_NOT_FOUND', '运营记录不存在', 404);
    if (record.status !== 'draft') throw serviceError('OPS_RUN_NOT_DRAFT', '只有草稿可以作废');
    return opsRepo.updateRun(runId, { status: 'discarded' });
}

async function savePlan(input, actor = '') {
    return opsRepo.savePlan(input, { actor, calendar: await calendar() });
}

/** 用内置模板新建计划：模板提供提示词/素材/定时，overrides 覆盖其中任意字段（targets 必填）。 */
async function createFromPreset(presetId, overrides = {}, actor = '') {
    const preset = require('./ops-library').getPreset(presetId);
    if (!preset) throw serviceError('OPS_PRESET_NOT_FOUND', `内置模板不存在：${presetId}`, 404);
    const { id, description, ...fields } = preset;
    return savePlan({
        ...fields,
        ...overrides,
        options: { ...(fields.options || {}), ...(overrides.options || {}) },
        schedule: overrides.schedule || fields.schedule,
        enabled: overrides.enabled === true
    }, actor);
}

/** 运营群的互动要求：频道收到该群消息时拼进 Dragon Claw 的上下文。 */
async function interactionNote(channel, kind, id) {
    if (!channel || !kind || !id) return '';
    const group = await opsRepo.getGroup(channel, kind, id).catch(() => null);
    if (!group?.enabled) return '';
    const settings = await opsRepo.getSettings();
    return [
        `这是运营${kind === 'group' ? '群' : '对象'}「${group.name}」。${group.profile ? `群画像：${group.profile}。` : ''}`,
        group.interactionPrompt ? `互动要求：${group.interactionPrompt}` : '互动要求：热情回应成员的提问与回复，鼓励大家试用平台功能，适度活跃气氛。',
        `运营话术规范：\n${settings.styleGuide}`
    ].join('\n');
}

// ── 调度 ─────────────────────────────────────────────────

async function runTenant(tenantId, { now = new Date() } = {}) {
    return runWithTenant(tenantId, async () => {
        const due = await opsRepo.listDuePlans(now.toISOString(), BATCH);
        if (!due.length) return { checked: 0, ran: 0 };
        const cal = await calendar();
        let ran = 0;
        for (const plan of due) {
            const next = opsSchedule.nextRun(plan.schedule, now, cal);
            if (!(await opsRepo.claimPlanRun(plan, next ? next.toISOString() : null))) continue;
            try {
                await runPlan(plan.id, { trigger: 'schedule', mode: 'plan', actor: 'scheduler' });
                ran += 1;
            } catch (error) {
                console.warn(`[Ops] 计划 ${plan.name} 执行失败：${error.message}`);
            }
        }
        return { checked: due.length, ran };
    });
}

async function tick(listTenantIds) {
    if (ticking) return;
    ticking = true;
    try {
        const ids = new Set(['default']);
        try { (await listTenantIds()).forEach(id => id && ids.add(id)); } catch { /* 只处理默认租户 */ }
        for (const tenantId of ids) {
            try {
                await runTenant(tenantId);
            } catch (error) {
                console.warn(`[Ops] 租户 ${tenantId} 运营调度失败：${error.message}`);
            }
        }
    } finally {
        ticking = false;
    }
}

function start(listTenantIds) {
    if (timer) return;
    timer = setInterval(() => { tick(listTenantIds); }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    generate,
    runPlan,
    sendRun,
    updateDraft,
    discardRun,
    savePlan,
    createFromPreset,
    interactionNote,
    renderTemplate,
    runTenant,
    tick,
    start,
    stop
};
