// 频道内明确的定时请求直接解析、落库；不让模型用文字替代真正的预约。
const schedules = require('../dragon-claw-schedules');
const parser = require('../dragon-claw-schedule-parser');
const chat = require('../ai-chat-repository');

const STATUS = { active: '等待执行', running: '执行中', done: '已完成', cancelled: '已取消', failed: '失败' };

function intent(input, { channel } = {}) {
    let original = String(input || '').split('\n').filter(line => !/^\s*>/.test(line)).join('\n').trim();
    // WeLink 群聊用前置 @ 唤起助手；它不是时间或收件人，不能交给时间解析器。
    // 只去掉开头的提及，时间后的 @人员和提醒正文保持原样。
    if (channel === 'welink') original = original.replace(/^(?:@[^\s@]+\s+)+/u, '').trim();
    const cancel = /^(?:\/(?:schedule|remind)\s+(?:cancel|取消)|取消(?:这个|该)?(?:定时任务|定时提醒|提醒|任务)?)\s*(dcs_[a-z0-9]+)[。.!！]?$/i.exec(original);
    if (cancel) return { action: 'cancel', id: cancel[1] };
    if (/^(?:取消(?:刚才|刚刚|这个|该)?(?:的)?(?:定时任务|定时提醒|提醒|任务)|\/(?:schedule|remind)\s+(?:cancel|取消))\s*[。.!！]?$/i.test(original)) return { action: 'cancel', id: '' };
    if (/^\/(?:schedule|schedules|remind)\s*$/i.test(original) || /^(?:查看|列出|看看|我的|有哪些|有什么)?\s*(?:定时任务|定时提醒|提醒任务)(?:有哪些|列表|还有哪些)?[?？。]*$/.test(original)) return { action: 'list' };
    const slash = /^\/(?:schedule|schedules|remind)\s+([\s\S]+)$/i.exec(original);
    if (slash) return { action: 'create', text: slash[1] };
    if (/(?:跟进|催办|遗留任务)/.test(original)) return null;
    let text = original.replace(/^(?:(?:请|麻烦你?|帮我|你能|能不能|可以|设置(?:一个)?(?:定时任务|定时提醒|提醒)|预约|定时|在)\s*)+/, '').replace(/[吗呢吧?？。！!]+$/, '');
    // 「提醒我一分钟后睡觉」与「一分钟后提醒我睡觉」等价。
    const remindFirst = /^提醒(我|我们|大家)?\s*([\s\S]+)$/.exec(text);
    if (remindFirst) {
        try {
            const parsed = parser.parse(remindFirst[2]);
            const split = remindFirst[2].lastIndexOf(parsed.instruction);
            text = `${remindFirst[2].slice(0, split)} 提醒${remindFirst[1] || '我'}${parsed.instruction}`;
        } catch { /* 下方统一给出时间格式提示。 */ }
    }
    if (!/(?:提醒|叫我|通知|发送|发给|推送|汇总|生成|检查)/.test(text)) return null;
    // 示例、解释或历史讨论不视为预约指令。
    if (/^(?:解释|分析|如何|怎么|为什么|举例|示例|之前|上次|昨天)/.test(text)) return null;
    try {
        parser.parse(text);
        return { action: 'create', text };
    } catch {
        if (/(?:秒后|分钟后|小时后|明天|明早|明晚|今晚|后天|每天|每晚|每周|每隔|定时|\d[:：]\d)/.test(text)) return { action: 'create', text };
        return null;
    }
}

function formatTime(value, timezone) {
    return new Date(value).toLocaleString('zh-CN', { timeZone: timezone, hour12: false });
}

async function handle({ channel, conversation, actor, toolSessionId, text, aiSessionId, modelId, onEvent }) {
    if (!['welink', 'weixin'].includes(channel) || !conversation?.id) return false;
    const command = intent(text, { channel });
    if (!command) return false;
    const owner = require('./dragon-claw-channel-bridge').conversationUser(channel, conversation, actor).username;
    const pagePath = `/channels/${channel}`;
    const pageTitle = `${channel === 'weixin' ? '微信' : 'WeLink'} 频道`;
    const sessionId = await chat.getOrCreateSession({ owner, sessionId: aiSessionId || undefined, pagePath, pageTitle });
    let reply;
    let event = null;
    try {
        const config = await require('./welink-config-repository').getConfig();
        const timezone = config.followup.calendar.timezone;
        if (command.action === 'create') {
            const item = await schedules.createForChannel({ channel, conversation, actor, toolSessionId, text: command.text, sessionId, timezone, modelId });
            reply = `✅ 已创建定时任务：${item.instruction}\n\n执行时间：${formatTime(item.nextRunAt, item.timezone)}（${item.timezone}）\n规则：${item.description}\n将发送到当前会话。\n任务编号：${item.id}\n\n系统每分钟检查一次。可发送「定时任务」查看，或「取消定时任务 ${item.id}」取消。`;
            event = { type: 'schedule', action: 'created', id: item.id, instruction: item.instruction };
        } else {
            const { items } = await schedules.listForTarget({ channel, ...conversation, owner });
            if (command.action === 'cancel') {
                if (!command.id) throw Object.assign(new Error('请先发送“定时任务”查看编号，再发送“取消定时任务 dcs_编号”，避免误取消其他任务'), { code: 'SCHEDULE_ID_REQUIRED' });
                if (!items.some(item => item.id === command.id)) throw Object.assign(new Error('当前会话中没有这个由频道创建的任务'), { code: 'SCHEDULE_NOT_FOUND' });
                const item = await schedules.cancel(command.id, owner);
                reply = `已取消定时任务：${item.instruction}\n任务编号：${item.id}`;
                event = { type: 'schedule', action: 'cancelled', id: item.id };
            } else {
                reply = items.length ? `当前会话的定时任务：\n${items.slice(0, 20).map(item => `- ${item.id} ${item.instruction}｜${STATUS[item.status] || item.status}${item.nextRunAt ? `｜下次 ${formatTime(item.nextRunAt, item.timezone)}` : ''}`).join('\n')}` : '当前会话还没有由频道创建的定时任务。可以直接说「一分钟后提醒我睡觉」或「每天 9 点提醒我检查告警」。';
            }
        }
    } catch (error) {
        const action = { create: '创建', cancel: '取消', list: '读取' }[command.action];
        reply = `未${action}定时任务：${error.code ? error.message : '定时任务服务暂时不可用，请稍后重试'}。${command.action === 'create' ? '\n请写明时间和内容，例如「一分钟后提醒我睡觉」「每天 9 点提醒我检查告警」。' : ''}`;
    }
    try {
        await chat.addMessage({ owner, sessionId, pagePath, pageTitle, role: 'user', content: String(text), events: [{ type: 'channel', channel, kind: conversation.kind, sender: actor }] });
        await chat.addMessage({ owner, sessionId, pagePath, pageTitle, role: 'model', content: reply, events: event ? [event] : [] });
    } catch {
        // 任务已保存时，聊天记录失败不能把成功的预约误报为失败或诱导重复创建。
        console.warn('[ChannelSchedule] Failed to save the command chat history');
    }
    onEvent({ type: 'start', sessionId });
    if (event) onEvent(event);
    onEvent({ type: 'delta', delta: reply });
    onEvent({ type: 'done', reply, sessionId, tokens: 0, usage: { inputTokens: 0, outputTokens: 0 } });
    return true;
}

module.exports = { intent, handle };
