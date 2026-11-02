// 让频道消息（如 WeLink）走与首页 Dragon Claw 完全相同的对话链路：
// 构造虚拟 req/res 调用 routes/ai.js 的 handleChatRequest，逐行解析 NDJSON 事件回调给调用方。
// WeLink 入站消息复核访问名单后使用完整工作区工具；其他频道和后台生成保持原权限。
// 对话归属：单聊为「welink:<账号>」；群聊为「welink-group:<群 ID>」，群里任何人 @助手 都接着同一个群对话。
const { EventEmitter } = require('events');

const CHANNEL_LABELS = { welink: 'WeLink', weixin: '微信', ops: '运营' };

function createVirtualResponse(onEvent) {
    const res = new EventEmitter();
    let buffer = '';
    res.statusCode = 200;
    res.destroyed = false;
    res.writableEnded = false;
    res.headersSent = false;
    res.status = code => { res.statusCode = code; return res; };
    res.setHeader = () => res;
    res.flushHeaders = () => { res.headersSent = true; };
    const flushLines = final => {
        const lines = buffer.split('\n');
        buffer = final ? '' : lines.pop();
        lines.filter(line => line.trim()).forEach(line => {
            try {
                onEvent(JSON.parse(line));
            } catch {
                // 非 JSON 行忽略
            }
        });
    };
    res.write = chunk => {
        buffer += String(chunk);
        flushLines(false);
        return true;
    };
    res.end = chunk => {
        if (chunk) buffer += String(chunk);
        flushLines(true);
        res.writableEnded = true;
        res.emit('finish');
        return res;
    };
    res.json = body => {
        onEvent({ type: 'http-json', status: res.statusCode, body });
        res.writableEnded = true;
        res.emit('finish');
        return res;
    };
    res.abort = () => {
        if (res.writableEnded) return;
        res.destroyed = true;
        res.emit('close');
    };
    return res;
}

function safeId(value) {
    return String(value || 'anonymous').replace(/[^\w.@-]/g, '_').slice(0, 80) || 'anonymous';
}

function channelUser(channel, account) {
    return { username: `${channel}:${safeId(account)}`, role: 'user' };
}

/** 对话归属的平台用户：群聊按群，单聊按人。 */
function conversationUser(channel, conversation = {}, account = '') {
    if (conversation.kind === 'group' && conversation.id) return { username: `${channel}-group:${safeId(conversation.id)}`, role: 'user' };
    return channelUser(channel, account || conversation.id);
}

/**
 * 已绑定的平台对话是否仍可由该归属继续：升级前的群会话归属于第一个发言人，
 * 换成按群归属后不能续写（会被拒绝），此时开启新的对话段落。
 */
async function usableSessionId(aiSessionId, owner) {
    if (!aiSessionId) return '';
    try {
        const { get } = require('../app-db');
        const row = await get('SELECT owner FROM ai_chat_sessions WHERE id = ?', [aiSessionId]);
        return !row || row.owner === owner ? aiSessionId : '';
    } catch {
        return aiSessionId;
    }
}

/** 不经 AI 直接回复一条（如确认挂起的操作），并记入该会话的聊天记录 */
async function replyDirectly({ channel, user, sessionId, text, reply, account, conversation, onEvent }) {
    const chat = require('../ai-chat-repository');
    const pagePath = `/channels/${channel}`;
    const pageTitle = `${CHANNEL_LABELS[channel] || channel} 频道`;
    let savedId = sessionId;
    try {
        savedId = await chat.getOrCreateSession({ owner: user.username, sessionId: sessionId || undefined, pagePath, pageTitle });
        await chat.addMessage({ owner: user.username, sessionId: savedId, pagePath, pageTitle, role: 'user', content: String(text), events: [{ type: 'channel', channel, kind: conversation.kind, sender: String(account || '') }] });
        await chat.addMessage({ owner: user.username, sessionId: savedId, pagePath, pageTitle, role: 'model', content: reply });
    } catch {
        console.warn('[ChannelBridge] Failed to save the confirmation chat history');
    }
    onEvent({ type: 'start', sessionId: savedId });
    onEvent({ type: 'delta', delta: reply });
    onEvent({ type: 'done', reply, sessionId: savedId, tokens: 0, usage: { inputTokens: 0, outputTokens: 0 } });
}

/**
 * 执行一轮 Dragon Claw 对话。
 * @param {object} options
 * @param {string} options.channel 频道标识（welink）
 * @param {string} options.account 发送人账号
 * @param {{kind:'group'|'user', id:string}} [options.conversation] 所在会话（群 ID 或单聊对方账号）
 * @param {string} [options.toolSessionId] SDK 会话 ID
 * @param {string} options.text 用户消息
 * @param {string} [options.aiSessionId] 已绑定的平台对话会话（多轮上下文）
 * @param {string} [options.modelId] 对话模型映射 ID
 * @param {string} [options.contextNote] 附加上下文说明
 * @param {boolean} [options.persist=true] 是否保存到聊天记录（运营内容生成等后台调用传 false）
 * @param {AbortSignal} [options.signal]
 * @param {(event:object)=>void} options.onEvent delta / status / done / error / http-json / start
 * @returns {Promise<void>} 本轮结束（含出错）时 resolve
 */
// 正在回复的频道会话（channel:kind:id → 进行中的轮数），供侧栏对话列表显示转圈
const activeTurns = new Map();
function busyThreads(channel) {
    const prefix = `${channel}:`;
    return new Set([...activeTurns.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
}
async function runTurn(options) {
    const { channel, conversation, persist = true } = options;
    const key = persist !== false && conversation?.id ? `${channel}:${conversation.kind || 'user'}:${conversation.id}` : '';
    if (!key) return runTurnInner(options);
    activeTurns.set(key, (activeTurns.get(key) || 0) + 1);
    try { return await runTurnInner(options); }
    finally {
        const left = (activeTurns.get(key) || 1) - 1;
        if (left > 0) activeTurns.set(key, left);
        else activeTurns.delete(key);
    }
}
async function runTurnInner({ channel, account, conversation, toolSessionId, text, aiSessionId, modelId, contextNote, persist = true, signal, onEvent }) {
    const user = conversation ? conversationUser(channel, conversation, account) : channelUser(channel, account);
    let sessionId = await usableSessionId(aiSessionId, user.username);
    const fullAccess = channel === 'welink' && persist !== false && Boolean(conversation?.id);
    if (fullAccess) {
        const access = require('./welink-access');
        const config = await require('./welink-config-repository').getConfig();
        const verdict = access.checkInbound(config.access, { kind: conversation.kind, groupId: conversation.kind === 'group' ? conversation.id : '', senderAccount: String(account || '') });
        if (!account || !verdict.allowed) {
            onEvent({ type: 'error', error: account ? access.describeDenial(verdict) : '无法识别 WeLink 发送人' });
            return;
        }
        // 仅在服务端桥接中授权，保留原频道归属；HTTP body 无法授予此身份。
        user.role = 'admin';
        sessionId = await require('../ai-chat-repository').getOrCreateSession({ sessionId, owner: user.username, pagePath: '/channels/welink', pageTitle: 'WeLink 频道' });
    }
    if (persist !== false && conversation && !signal?.aborted) {
        // 回复「确认 1234」/「取消」：执行或放弃上一轮挂起的操作（频道里显示不了审批卡）
        const confirmed = await require('./channel-pending-actions').handleReply({ channel, conversation, actor: String(account || ''), text });
        if (confirmed) {
            await replyDirectly({ channel, user, sessionId, text, reply: confirmed, account, conversation, onEvent });
            return;
        }
        const handled = await require('./channel-schedule-commands').handle({ channel, conversation, actor: account, toolSessionId, text, aiSessionId: sessionId, modelId, onEvent });
        if (handled) return;
        const tacIntent = require('../dragon-tac/commands').intent(text);
        const ownBrowser = fullAccess && tacIntent?.action === 'propose' && !/DragonTAC/i.test(text) && Boolean(require('../agent-browser').available());
        if (!ownBrowser && await require('../dragon-tac/commands').handle({ channel, conversation, actor: account, text, aiSessionId: sessionId, onEvent })) return;
    }
    const aiRouter = require('../../routes/ai');
    if (typeof aiRouter.handleChatRequest !== 'function') throw new Error('Dragon Claw 对话入口不可用');
    const res = createVirtualResponse(onEvent);
    const req = {
        method: 'POST',
        path: '/chat',
        headers: {},
        user,
        channelTurn: conversation ? { channel, conversation, toolSessionId: toolSessionId || '', actor: String(account || ''), fullAccess } : null,
        get: () => '',
        body: {
            messages: [{ role: 'user', content: String(text || '') }],
            context: `${contextNote || ''}${conversation ? '\n定时请求只有系统实际保存并返回任务编号才算创建成功。未获得工具或系统成功结果时，不得声称已设置、已预约、已取消或会在未来提醒；请用户提供明确时间和内容，或使用 /schedule 时间 指令。持续跟进任务仅在 followup_* 工具返回成功后才能确认已记录。' : ''}`,
            pageTitle: `${CHANNEL_LABELS[channel] || channel} 频道`,
            pagePath: `/channels/${channel}`,
            sessionId: sessionId || undefined,
            persist: persist !== false,
            stream: true,
            agent: 'dragon-claw-home',
            uiLanguage: 'zh-CN',
            ...(modelId ? { modelId } : {})
        }
    };
    if (signal) {
        if (signal.aborted) res.abort();
        else signal.addEventListener('abort', () => res.abort(), { once: true });
    }
    await aiRouter.handleChatRequest(req, res);
}

module.exports = { runTurn, busyThreads, channelUser, conversationUser, createVirtualResponse };
