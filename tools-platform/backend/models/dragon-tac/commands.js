const service = require('./service');
const repo = require('./repository');
const chat = require('../ai-chat-repository');
function intent(input) {
    let text = String(input || '').split('\n').filter(line => !/^\s*>/.test(line)).join('\n').trim();
    text = text.replace(/^@[^\s@]+?(?=(?:打开|读取|浏览|分析|总结))/, '');
    text = text.replace(/^@[^\s@]+\s+/, '');
    let match = /^(?:确认|同意)(?:升级|上升)(?:到)?\s*(?:DragonTAC)?\s*(tac_[a-f0-9]{16})?[。！!]?$/i.exec(text);
    if (match) return { action: 'approve', id: match[1] || '' };
    match = /^(?:取消|停止)\s*(?:DragonTAC\s*)?(tac_[a-f0-9]{16})[。！!]?$/i.exec(text);
    if (match) return { action: 'cancel', id: match[1] };
    if (/^(?:查看\s*)?DragonTAC(?:\s*状态)?(?:\s+tac_[a-f0-9]{16})?\s*$/i.test(text)) return { action: 'list' };
    if (/^(?:解释|如何|怎么|为什么|举例|示例)/.test(text) || /(?:定时|分钟后|小时后|每天|每周|明天)/.test(text)) return null;
    return /https?:\/\//i.test(text) && /打开|读取|网页|浏览|分析|总结|DragonTAC/i.test(text) ? { action: 'propose', text } : null;
}
async function handle({ channel, conversation, account, actor = account, text, aiSessionId, onEvent }) {
    const command = intent(text);
    if (!command) return false;
    const owner = channel === 'web' ? actor : require('../channels/dragon-claw-channel-bridge').conversationUser(channel, conversation, actor).username;
    const pagePath = channel === 'web' ? '/' : `/channels/${channel}`;
    const sessionId = await chat.getOrCreateSession({ owner, sessionId: aiSessionId || undefined, pagePath, pageTitle: 'DragonTAC' });
    const ctx = { channel, conversation, actor, sessionId };
    let reply, event, queued;
    try {
        if (command.action === 'propose') {
            const job = await service.propose(ctx, command.text);
            const members = job.reports.map(report => report.agent).join(' → ');
            const unavailable = (await service.capabilities()).agents.filter(agent => !agent.available).map(agent => `${agent.name}：${agent.reason}`).join('；');
            reply = `这个网页需要实际打开并读取。是否上升到 DragonTAC 支持？\n\n网址：${job.url}\n计划：浏览器读取公开网页 → ${members} 分析/复核 → 回传本会话。\n执行通道：官方 CLI；当前未通过 Agent HUD 派发。不会继承个人浏览器登录态。${unavailable ? `\n未参与：${unavailable}` : ''}\n\n任务编号：${job.id}\n如同意，请在 15 分钟内回复「确认升级 ${job.id}」。确认前不会打开网页或调用外部 Agent；取消请回复「取消 ${job.id}」。`;
            event = { type: 'tac', id: job.id, status: job.status };
        } else if (command.action === 'approve') {
            let id = command.id;
            if (!id) {
                const pending = (await repo.list({ channel, kind: conversation.kind, id: conversation.id, actor })).filter(job => job.status === 'awaiting_approval');
                if (pending.length !== 1) throw new Error('请带上要确认的 DragonTAC 任务编号，避免升级错任务');
                id = pending[0].id;
            }
            queued = await service.approve(id, ctx);
            reply = `已确认升级到 DragonTAC，任务已排队。\n任务编号：${id}\n完成或失败都会回传本会话；可发送“DragonTAC 状态”查看。`;
            event = { type: 'tac', id, status: 'queued' };
        } else if (command.action === 'cancel') {
            const job = await service.cancel(command.id, ctx);
            reply = `已取消 DragonTAC 任务：${job.id}`;
        } else {
            const items = await repo.list({ channel, kind: conversation.kind, id: conversation.id, actor });
            reply = items.length ? items.slice(0, 10).map(job => `${job.id}｜${job.status}\n${job.result || job.error || job.url}${job.deliveryError ? `\n回传失败：${job.deliveryError}` : ''}`).join('\n\n').slice(0, 12000) : '当前会话还没有你发起的 DragonTAC 请求。';
        }
    } catch (e) { reply = `DragonTAC 未执行：${e.message}`; }
    try {
        await chat.addMessage({ owner, sessionId, pagePath, pageTitle: 'DragonTAC', role: 'user', content: require('../ai-sensitive-data').redactText(text), events: [{ type: 'channel', channel, sender: actor, kind: conversation.kind }] });
        await chat.addMessage({ owner, sessionId, pagePath, pageTitle: 'DragonTAC', role: 'model', content: reply, events: event ? [event] : [] });
    } catch { console.warn('[DragonTAC] 历史保存失败；以实际任务状态为准'); }
    onEvent({ type: 'start', sessionId });
    if (event) onEvent(event);
    onEvent({ type: 'delta', delta: reply });
    onEvent({ type: 'done', sessionId, reply, tokens: 0 });
    if (queued) service.schedule(queued.id);
    return true;
}
module.exports = { intent, handle };
