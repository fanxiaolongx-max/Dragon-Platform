// 让频道消息（如 WeLink）走与首页 Dragon Claw 完全相同的对话链路：
// 构造虚拟 req/res 调用 routes/ai.js 的 handleChatRequest，逐行解析 NDJSON 事件回调给调用方。
// 频道用户以「welink:<账号>」身份、非管理员角色对话，不开启工作区，因此只有只读的平台知识与数据能力。
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

function channelUser(channel, account) {
    const id = String(account || 'anonymous').replace(/[^\w.@-]/g, '_').slice(0, 80) || 'anonymous';
    return { username: `${channel}:${id}`, role: 'user' };
}

/**
 * 执行一轮 Dragon Claw 对话。
 * @param {object} options
 * @param {string} options.channel 频道标识（welink）
 * @param {string} options.account 发送人账号
 * @param {string} options.text 用户消息
 * @param {string} [options.aiSessionId] 已绑定的平台对话会话（多轮上下文）
 * @param {string} [options.modelId] 对话模型映射 ID
 * @param {string} [options.contextNote] 附加上下文说明
 * @param {AbortSignal} [options.signal]
 * @param {(event:object)=>void} options.onEvent delta / status / done / error / http-json / start
 * @returns {Promise<void>} 本轮结束（含出错）时 resolve
 */
async function runTurn({ channel, account, text, aiSessionId, modelId, contextNote, signal, onEvent }) {
    const aiRouter = require('../../routes/ai');
    if (typeof aiRouter.handleChatRequest !== 'function') throw new Error('Dragon Claw 对话入口不可用');
    const res = createVirtualResponse(onEvent);
    const req = {
        method: 'POST',
        path: '/chat',
        headers: {},
        user: channelUser(channel, account),
        get: () => '',
        body: {
            messages: [{ role: 'user', content: String(text || '') }],
            context: contextNote || '',
            pageTitle: `${channel === 'welink' ? 'WeLink' : channel} 频道`,
            pagePath: `/channels/${channel}`,
            sessionId: aiSessionId || undefined,
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

module.exports = { runTurn, channelUser, createVirtualResponse };
