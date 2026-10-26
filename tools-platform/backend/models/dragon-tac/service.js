const repo = require('./repository');
const browser = require('./browser');
const agents = require('./executors');
const { runWithTenant, getTenantId } = require('../tenant-context');
const { redactText } = require('../ai-sensitive-data');
const active = new Map();
const queue = [];
let inFlight = 0;
function owns(job, ctx) { return job && job.channel === ctx.channel && job.kind === ctx.conversation.kind && job.conversationId === ctx.conversation.id && job.actor === ctx.actor; }
function error(message, code = 'TAC_INVALID', statusCode = 400) { return Object.assign(new Error(message), { code, statusCode }); }
async function propose(ctx, text) {
    const urls = String(text).match(/https?:\/\/[^\s<>"'）)\]]+/g) || [];
    if (urls.length !== 1) throw error('首个 DragonTAC 示例一次分析一个公开网页，请提供一个完整网址');
    const url = browser.normalizeUrl(urls[0].replace(/[，。；;！？!]+$/, ''));
    const cap = await agents.readiness();
    if (cap.enabled === false) throw error('管理员已关闭 DragonTAC 升级入口', 'TAC_DISABLED');
    const available = cap.agents.filter(agent => agent.available);
    if (!cap.browser || !available.length) throw error('尚未准备好网页分析执行器：需在运行平台的机器配置浏览器及至少一个已登录的 Agent CLI', 'TAC_UNAVAILABLE');
    return repo.create(ctx, { url, instruction: redactText(text).slice(0, 2000), reports: available.map(agent => ({ id: agent.id, agent: agent.name, status: 'pending' })) });
}
async function approve(id, ctx) {
    const job = await repo.getJob(id);
    if (!owns(job, ctx)) throw error('这不是当前会话中由你发起的升级请求', 'TAC_NOT_FOUND', 404);
    if (Date.now() - Date.parse(job.createdAt) > 15 * 60000) { await repo.transition(id, 'awaiting_approval', 'expired'); throw error('升级确认已过期，请重新发起'); }
    const queued = await repo.transition(id, 'awaiting_approval', 'queued', { approvedAt: new Date().toISOString() });
    if (!queued) throw error('该请求已经处理，请查看 DragonTAC 状态，不会重复执行');
    return queued;
}
async function cancel(id, ctx) {
    const job = await repo.getJob(id);
    if (!owns(job, ctx)) throw error('这不是当前会话中由你发起的升级请求', 'TAC_NOT_FOUND', 404);
    const changed = await repo.transition(id, ['awaiting_approval', 'queued', 'running'], 'cancelled');
    if (!changed) throw error('当前任务已结束');
    active.get(`${getTenantId()}:${id}`)?.abort();
    return changed;
}
async function execute(id, { readPage = browser.readPage, runAgent = agents.runAgent, push = input => require('../channels').push(input) } = {}) {
    const key = `${getTenantId()}:${id}`;
    const controller = new AbortController();
    const job = await repo.transition(id, 'queued', 'running');
    if (!job) return { skipped: true };
    active.set(key, controller);
    const reports = [];
    try {
        const page = await readPage(job.url, { signal: controller.signal });
        const selected = job.reports.map(report => ({ id: report.id, name: report.agent }));
        let prior = '';
        for (const member of selected) {
            if (controller.signal.aborted) break;
            const report = { agent: member.name, status: 'running' };
            reports.push(report);
            if (!(await repo.transition(id, 'running', 'running', { reports }))) return { cancelled: true };
            try {
                const text = await runAgent(member.id, agents.promptFor(job, page, prior), { signal: controller.signal });
                Object.assign(report, { status: 'done', text }); prior = text;
            } catch (e) { Object.assign(report, { status: 'failed', error: redactText(e.message).slice(0, 500) }); }
            if (!(await repo.transition(id, 'running', 'running', { reports }))) return { cancelled: true };
        }
        const succeeded = reports.filter(report => report.status === 'done');
        if (!succeeded.length) throw new Error(reports.map(report => report.error).join('；') || '没有可用的 Agent 完成分析');
        const result = `DragonTAC 网页分析完成\n任务编号：${id}\n来源：${page.url}\n执行：公开网页浏览器快照 → ${reports.map(r => `${r.agent}（${r.status === 'done' ? '已完成' : '失败'}）`).join(' → ')}\n通道：官方 CLI；Agent HUD 未承担任务派发\n\n${succeeded.at(-1).text}${reports.some(r => r.status === 'failed') ? '\n\n部分成员未完成，请在工作区查看原因。' : ''}`;
        const done = await repo.transition(id, 'running', 'done', { reports, result });
        if (done) await deliver(done, result, push);
        return done;
    } catch (e) {
        const message = redactText(e.message).slice(0, 1000);
        const failed = await repo.transition(id, 'running', 'failed', { reports, error: message });
        if (failed) await deliver(failed, `DragonTAC 未完成\n任务编号：${id}\n原因：${message}`, push);
        return failed;
    } finally { active.delete(key); }
}
async function deliver(job, text, push) {
    try {
        if (job.channel === 'web') {
            await require('../ai-chat-repository').addMessage({ owner: job.actor, sessionId: job.sessionId, pagePath: '/', pageTitle: 'DragonTAC', role: 'model', content: text, events: [{ type: 'tac', id: job.id, status: job.status }] });
        } else {
            const result = await push({ channel: job.channel, targets: [{ kind: job.kind, id: job.conversationId }], text: text.slice(0, 7500), trigger: 'system', source: `dragon-tac:${job.id}` });
            if (!result?.sent) throw new Error(result?.results?.[0]?.error || '回传未成功');
        }
    } catch (e) { await repo.transition(job.id, job.status, job.status, { deliveryError: redactText(e.message).slice(0, 500) }); }
}
function schedule(id) {
    queue.push({ tenant: getTenantId(), id });
    setImmediate(pump);
}
function pump() {
    while (inFlight < 2 && queue.length) {
        const job = queue.shift(); inFlight++;
        runWithTenant(job.tenant, () => execute(job.id)).catch(e => console.warn('[DragonTAC] 执行失败:', e.code || 'ERROR')).finally(() => { inFlight--; pump(); });
    }
}
async function recover() {
    for (const job of await repo.interrupted()) await repo.transition(job.id, ['queued','running'], 'failed', { error: '平台服务在执行期间重启；为避免重复派发，请重新确认一个新请求' });
}
module.exports = { propose, approve, cancel, execute, schedule, recover, owns, capabilities: agents.readiness };
