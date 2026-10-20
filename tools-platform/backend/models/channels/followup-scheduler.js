// 跟进任务提醒调度：每分钟检查各租户到期的任务，在任务所在的群/单聊里 @ 相关人推送提醒。
// - 下次提醒时间持久化在库里，服务重启后按计划继续；停机期间错过的提醒只补发一次；
// - 认领时先把 next_remind_at 推进到下一次，同一任务不会被重复发送；发送失败 10 分钟后重试；
// - 频道未启用、未连接或关闭了跟进功能的租户跳过，任务保持到期状态，连上后再发。
const { runWithTenant } = require('../tenant-context');
const repo = require('./channel-followups-repository');
const schedule = require('./followup-schedule');
const configRepo = require('./welink-config-repository');
const { URGENCY_LABEL, assigneeText, formatTime } = require('./followup-agent');

const TICK_MS = 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const BATCH = 20;
let timer = null;
let running = false;

function mentionLine(assignees) {
    const names = (assignees || []).map(item => `@${item.name || item.account}`);
    return names.length ? names.join(' ') : '';
}

/** 提醒文案：标题、提醒人、详情摘要、最新进展、本次要跟进的内容。 */
function reminderText(task, calendar) {
    const lines = [];
    const mention = mentionLine(task.assignees);
    lines.push(`⏰ **跟进提醒 · ${task.title}**${mention ? `\n${mention}` : ''}`);
    const detail = String(task.detail || '').trim();
    if (detail) lines.push(`**任务**：${detail.length > 400 ? `${detail.slice(0, 400)}…` : detail}`);
    lines.push(`**当前进展**：${task.progress || '暂无更新'}`);
    if (task.nextRemindNote) lines.push(`**本次跟进**：${task.nextRemindNote}`);
    if (task.dueAt) lines.push(`**截止**：${formatTime(task.dueAt, calendar)}`);
    lines.push(`请 @我 回复最新进度；完成后说「完成」即可关闭任务。（第 ${task.remindCount + 1} 次提醒 · 紧急度 ${URGENCY_LABEL[task.urgency] || task.urgency} · ${task.frequency}）`);
    return lines.join('\n\n').slice(0, 7800);
}

async function remindTask(task, calendar, push) {
    const next = schedule.nextReminder(task, new Date(), calendar);
    if (!(await repo.claimReminder(task, next.toISOString()))) return { skipped: true };
    const text = reminderText(task, calendar);
    const count = task.remindCount + 1;
    try {
        const result = await push({ channel: task.channel, text, targets: [{ kind: task.conversation.kind, id: task.conversation.id }], trigger: 'scheduled', source: `followup:${task.id}` });
        if (!result?.sent) throw new Error(result?.results?.[0]?.error || '推送未成功');
        await repo.recordReminder(task.id, { text, sent: true, count, limitReached: task.maxReminders > 0 && count >= task.maxReminders });
        return { sent: true };
    } catch (error) {
        await repo.recordReminder(task.id, { sent: false, error: error.message, retryAt: new Date(Date.now() + RETRY_MS).toISOString() });
        return { sent: false, error: error.message };
    }
}

/** 处理一个租户的到期任务。push 默认走频道公共推送（测试可注入）。 */
async function runTenant(tenantId, { push, now = new Date() } = {}) {
    return runWithTenant(tenantId, async () => {
        const config = await configRepo.getConfig();
        if (!config.enabled || !config.followup.enabled) return { checked: 0, sent: 0 };
        const send = push || (options => require('./index').push(options));
        const due = await repo.listDue(now.toISOString(), BATCH);
        let sent = 0;
        for (const task of due) {
            const result = await remindTask(task, config.followup.calendar, send);
            if (result.sent) sent += 1;
        }
        return { checked: due.length, sent };
    });
}

async function tick(listTenantIds) {
    if (running) return;
    running = true;
    try {
        const ids = new Set(['default']);
        try { (await listTenantIds()).forEach(id => id && ids.add(id)); } catch { /* 只处理默认租户 */ }
        for (const tenantId of ids) {
            try {
                await runTenant(tenantId);
            } catch (error) {
                console.warn(`[Followup] 租户 ${tenantId} 提醒处理失败：${error.message}`);
            }
        }
    } finally {
        running = false;
    }
}

function start(listTenantIds) {
    if (timer) return;
    timer = setInterval(() => { tick(listTenantIds); }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
    setTimeout(() => tick(listTenantIds), 15 * 1000).unref?.();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

/** 平台工作区「立即提醒」：不改变原有频率，只额外发送一次。 */
async function remindNow(id, push = options => require('./index').push(options)) {
    const task = await repo.getTask(id);
    if (!task) throw Object.assign(new Error('跟进任务不存在'), { statusCode: 404, code: 'FOLLOWUP_NOT_FOUND' });
    if (task.status !== 'open') throw Object.assign(new Error('只有跟进中的任务可以提醒'), { statusCode: 400, code: 'FOLLOWUP_NOT_OPEN' });
    const config = await configRepo.getConfig();
    const text = reminderText(task, config.followup.calendar);
    const result = await push({ channel: task.channel, text, targets: [{ kind: task.conversation.kind, id: task.conversation.id }], trigger: 'system', source: `followup:${task.id}` });
    if (!result?.sent) throw Object.assign(new Error(result?.results?.[0]?.error || '推送未成功'), { statusCode: 502, code: 'FOLLOWUP_PUSH_FAILED' });
    const { run } = require('../app-db');
    const at = new Date().toISOString();
    await run('UPDATE channel_followups SET remind_count = remind_count + 1, last_reminded_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    await repo.recordReminder(id, { text, sent: true, count: task.remindCount + 1 });
    return repo.getTask(id);
}

module.exports = { start, stop, tick, runTenant, remindNow, reminderText, assigneeText };
