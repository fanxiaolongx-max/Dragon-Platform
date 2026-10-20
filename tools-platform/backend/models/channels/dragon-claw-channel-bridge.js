// 让频道消息（如 WeLink）走与首页 Dragon Claw 完全相同的对话链路：
// 构造虚拟 req/res 调用 routes/ai.js 的 handleChatRequest，逐行解析 NDJSON 事件回调给调用方。
// 频道用户以非管理员角色对话，不开启工作区，因此只有只读的平台知识与数据能力，外加本会话的跟进任务工具。
// 对话归属：单聊为「welink:<账号>」；群聊为「welink-group:<群 ID>」，群里任何人 @助手 都接着同一个群对话。
const { EventEmitter } = require('events');

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
 * @param {AbortSignal} [options.signal]
 * @param {(event:object)=>void} options.onEvent delta / status / done / error / http-json / start
 * @returns {Promise<void>} 本轮结束（含出错）时 resolve
 */
async function runTurn({ channel, account, conversation, toolSessionId, text, aiSessionId, modelId, contextNote, signal, onEvent }) {
    const aiRouter = require('../../routes/ai');
    if (typeof aiRouter.handleChatRequest !== 'function') throw new Error('Dragon Claw 对话入口不可用');
    const res = createVirtualResponse(onEvent);
    const user = conversation ? conversationUser(channel, conversation, account) : channelUser(channel, account);
    const sessionId = await usableSessionId(aiSessionId, user.username);
    const req = {
        method: 'POST',
        path: '/chat',
        headers: {},
        user,
        channelTurn: conversation ? { channel, conversation, toolSessionId: toolSessionId || '', actor: String(account || '') } : null,
        get: () => '',
        body: {
            messages: [{ role: 'user', content: String(text || '') }],
            context: contextNote || '',
            pageTitle: `${channel === 'welink' ? 'WeLink' : channel} 频道`,
            pagePath: `/channels/${channel}`,
            sessionId: sessionId || undefined,
            persist: true,
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

module.exports = { runTurn, channelUser, conversationUser, createVirtualResponse };
