// 让频道消息（如 WeLink）走与首页 Dragon Claw 完全相同的对话链路：
// 构造虚拟 req/res 调用 routes/ai.js 的 handleChatRequest，逐行解析 NDJSON 事件回调给调用方。
// WeLink 入站消息复核访问名单后使用完整工作区工具；其他频道和后台生成保持原权限。
// 对话归属：单聊为「welink:<账号>」；群聊为「welink-group:<群 ID>」，群里任何人 @助手 都接着同一个群对话。
const { EventEmitter } = require('events');
const { getTenantId } = require('../tenant-context');

const CHANNEL_LABELS = { welink: 'WeLink', weixin: '微信', ops: '运营' };
const MAX_THINKING_CHARS = 24000;
const MAX_LIVE_CONTENT_CHARS = 120000;
const FINISHED_TURN_TTL_MS = 20000;

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

/**
 * 判断发送人账号是否属于超级管理员（本人或配置的特权管理员名单）：
 * 1. 微信渠道：匹配当前 Bot 扫码绑定的 ownerUserId，或在 config.superAdmins 中配置的 ID；
 * 2. WeLink 渠道：匹配在 config.superAdmins 中配置的工号，或当前本机已启用的 welink-cli 登录工号（authStatus().uid）。
 * 在单聊中：超级管理员直接获得宿主机完整工作区权限；
 * 在群聊或单聊中：超级管理员均可通过助理调用 welink-cli 查询任意群聊、任意单聊内容（普通群成员仅限查询本群内容）。
 */
async function isSuperAdminUser(channel, account) {
    if (!account) return false;
    const actor = String(account).trim().toLowerCase();
    if (!actor) return false;
    try {
        if (channel === 'weixin') {
            const config = await require('./weixin-config-repository').getConfig().catch(() => null);
            if (!config) return false;
            const ownerId = String(config.ownerUserId || '').trim().toLowerCase();
            if (ownerId && actor === ownerId) return true;
            const admins = (config.superAdmins || []).map(a => String(a).trim().toLowerCase());
            return admins.includes(actor);
        }
        if (channel === 'welink') {
            const config = await require('./welink-config-repository').getConfig().catch(() => null);
            const admins = (config?.superAdmins || []).map(a => String(a).trim().toLowerCase());
            if (admins.includes(actor)) return true;
            // 自动感知已启用的 welink-cli 本机登录 UID
            const cliRunner = require('./welink-cli-runner');
            if (cliRunner && typeof cliRunner.readConfig === 'function' && cliRunner.readConfig()?.enabled && typeof cliRunner.authStatus === 'function') {
                const status = await cliRunner.authStatus().catch(() => null);
                const cliUid = String(status?.uid || '').trim().toLowerCase();
                if (cliUid && actor === cliUid) return true;
            }
        }
    } catch (_err) {
        // 出错安全回退
    }
    return false;
}

async function isSuperAdminAccount(channel, conversation, account) {
    if (!conversation || conversation.kind !== 'user' || !account) return false;
    return isSuperAdminUser(channel, account);
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
// 正在回复的频道会话（tenant::channel:kind:id → 进行中的轮数）与实时流状态，供侧栏转圈和实时瀑布流订阅
const activeTurns = new Map();
const liveTurns = new Map();
const liveSubscribers = new Map();
let turnSeq = 0;

function liveThreadKey(channel, kind, id, tenantId = getTenantId()) {
    return `${tenantId || 'default'}::${channel}:${kind || 'user'}:${id}`;
}

function busyThreads(channel, tenantId = getTenantId()) {
    const prefix = `${tenantId || 'default'}::${channel}:`;
    return new Set([...activeTurns.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
}

function compactMetrics(round) {
    if (!round || typeof round !== 'object') return null;
    const out = {};
    for (const key of ['index', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningOutputTokens', 'visibleOutputTokens', 'decodeTokens', 'ms', 'ttftMs', 'turnTtftMs', 'generationMs', 'tps']) {
        if (typeof round[key] === 'number' && Number.isFinite(round[key]) && round[key] >= 0) out[key] = round[key];
    }
    out.model = typeof round.model === 'string' ? round.model.slice(0, 200) : '';
    out.timingSource = ['request-stream', 'buffered', 'log-boundary', 'usage-only'].includes(round.timingSource) ? round.timingSource : '';
    out.estimated = round.estimated === true;
    out.timingEstimated = round.timingEstimated === true;
    return out;
}

function closeActiveThinking(turn) {
    if (!turn || !turn.thinkingActive) return;
    turn.thinkingMs += Math.max(0, Date.now() - turn.thinkingSince);
    turn.thinkingActive = false;
    turn.thinkingSince = 0;
    turn.thinkingGap = true;
}

function appendThinkingDelta(turn, delta) {
    const text = String(delta || '');
    if (!text) return;
    if (turn.thinkingGap && turn.thinkingChunks.length) {
        turn.thinkingChunks.push({ sep: true });
    }
    turn.thinkingGap = false;
    if (turn.thinkingChars < MAX_THINKING_CHARS) {
        const room = MAX_THINKING_CHARS - turn.thinkingChars;
        const slice = text.slice(0, room);
        turn.thinkingChars += slice.length;
        const last = turn.thinkingChunks.at(-1);
        if (last && !last.sep) last.text += slice;
        else turn.thinkingChunks.push({ text: slice });
    }
    if (!turn.thinkingActive) {
        turn.thinkingActive = true;
        turn.thinkingSince = Date.now();
    }
}

function snapshotLiveTurn(turn) {
    if (!turn) return null;
    const thinkingMs = turn.thinkingMs + (turn.thinkingActive && turn.thinkingSince ? Math.max(0, Date.now() - turn.thinkingSince) : 0);
    return {
        turnId: turn.turnId,
        channel: turn.channel,
        kind: turn.kind,
        id: turn.id,
        sessionId: turn.sessionId,
        sender: turn.sender,
        userText: turn.userText,
        startedAt: turn.startedAt,
        thinkingChunks: turn.thinkingChunks.map(item => (item.sep ? { sep: true } : { text: item.text })),
        thinkingMs,
        thinkingActive: Boolean(turn.thinkingActive),
        statusText: turn.statusText,
        tools: turn.tools.map(item => ({ ...item })),
        compactions: turn.compactions.map(item => ({ ...item })),
        content: turn.content,
        modelName: turn.modelName,
        usage: turn.usage ? { ...turn.usage } : null,
        rounds: turn.rounds.map(item => ({ ...item })),
        done: Boolean(turn.done),
        error: turn.error || ''
    };
}

function broadcastLive(key, payload) {
    const subs = liveSubscribers.get(key);
    if (!subs?.size) return;
    for (const listener of [...subs]) {
        try {
            listener(payload);
        } catch {
            subs.delete(listener);
        }
    }
}

function createLiveTurn({ threadKey, channel, kind, id, sessionId = '', account = '', text = '' }) {
    const existing = liveTurns.get(threadKey);
    if (existing?.cleanupTimer) clearTimeout(existing.cleanupTimer);
    const turn = {
        turnId: `ch-${Date.now()}-${++turnSeq}`,
        threadKey,
        channel,
        kind: kind || 'user',
        id,
        sessionId: sessionId || '',
        sender: String(account || ''),
        userText: String(text || ''),
        startedAt: Date.now(),
        thinkingChunks: [],
        thinkingChars: 0,
        thinkingMs: 0,
        thinkingSince: 0,
        thinkingActive: false,
        thinkingGap: false,
        statusText: '',
        tools: [],
        compactions: [],
        content: '',
        modelName: '',
        usage: null,
        rounds: [],
        done: false,
        error: '',
        cleanupTimer: null
    };
    liveTurns.set(threadKey, turn);
    broadcastLive(threadKey, { type: 'turn_start', turn: snapshotLiveTurn(turn) });
    return turn;
}

function formatLiveStatusText(status) {
    if (typeof status === 'string') return status.trim();
    if (!status || typeof status !== 'object') return '';
    if (status.kind === 'context-compression') {
        return status.phase === 'start' ? '正在整理较早对话上下文…' : '';
    }
    if (status.kind === 'code-analysis-retry') return '正在调整解析范围并重试…';
    if (typeof status.text === 'string') return status.text.trim();
    if (typeof status.message === 'string') return status.message.trim();
    return '';
}

function recordAndBroadcastLiveEvent(turn, event) {
    if (!turn || !event || typeof event !== 'object') return;
    const turnId = turn.turnId;
    if (event.type === 'start') {
        if (event.sessionId) turn.sessionId = String(event.sessionId);
        broadcastLive(turn.threadKey, { type: 'start', turnId, sessionId: turn.sessionId });
        return;
    }
    if (event.type === 'thinking') {
        const delta = String(event.delta || '');
        if (!delta) return;
        appendThinkingDelta(turn, delta);
        broadcastLive(turn.threadKey, { type: 'thinking', turnId, delta });
        return;
    }
    if (event.type === 'status') {
        turn.statusText = formatLiveStatusText(event.status);
        broadcastLive(turn.threadKey, { type: 'status', turnId, status: turn.statusText });
        return;
    }
    if (event.type === 'compaction') {
        closeActiveThinking(turn);
        const item = {
            type: 'compaction',
            turnId,
            phase: String(event.phase || ''),
            summarized: Number(event.summarized) || 0,
            beforeTokens: Number(event.beforeTokens) || 0,
            afterTokens: Number(event.afterTokens) || 0,
            error: event.error ? String(event.error).slice(0, 200) : ''
        };
        turn.compactions.push(item);
        broadcastLive(turn.threadKey, item);
        return;
    }
    if (event.type === 'tool_start') {
        closeActiveThinking(turn);
        const toolEvent = { type: 'tool_start', turnId, callId: String(event.callId || ''), tool: String(event.tool || '') };
        turn.tools.push({ ...toolEvent, finished: false });
        broadcastLive(turn.threadKey, toolEvent);
        return;
    }
    if (event.type === 'tool_result') {
        closeActiveThinking(turn);
        const callId = String(event.callId || '');
        const tool = String(event.tool || '');
        const ok = event.ok !== false;
        const durationMs = Number(event.durationMs) || 0;
        const existing = turn.tools.find(item => item.callId === callId);
        if (existing) Object.assign(existing, { ok, durationMs, finished: true });
        else turn.tools.push({ type: 'tool_result', callId, tool, ok, durationMs, finished: true });
        broadcastLive(turn.threadKey, { type: 'tool_result', turnId, callId, tool, ok, durationMs });
        return;
    }
    if (event.type === 'model_round') {
        const round = compactMetrics(event.round);
        if (round) {
            turn.rounds.push(round);
            broadcastLive(turn.threadKey, { type: 'model_round', turnId, round });
        }
        return;
    }
    if (event.type === 'delta') {
        closeActiveThinking(turn);
        const delta = String(event.delta || '');
        if (!delta) return;
        if (turn.content.length < MAX_LIVE_CONTENT_CHARS) {
            turn.content += delta.slice(0, MAX_LIVE_CONTENT_CHARS - turn.content.length);
        }
        broadcastLive(turn.threadKey, { type: 'delta', turnId, delta });
        return;
    }
    if (event.type === 'done') {
        closeActiveThinking(turn);
        turn.done = true;
        if (typeof event.reply === 'string' && event.reply) {
            turn.content = event.reply.slice(0, MAX_LIVE_CONTENT_CHARS);
        }
        if (event.sessionId) turn.sessionId = String(event.sessionId);
        turn.modelName = typeof event.model?.name === 'string' ? event.model.name : (typeof event.modelName === 'string' ? event.modelName : '');
        if (event.usage && typeof event.usage === 'object') {
            turn.usage = { inputTokens: Number(event.usage.inputTokens) || 0, outputTokens: Number(event.usage.outputTokens) || 0 };
        }
        if (Array.isArray(event.rounds) && event.rounds.length) {
            turn.rounds = event.rounds.map(compactMetrics).filter(Boolean);
        }
        broadcastLive(turn.threadKey, {
            type: 'done',
            turnId,
            sessionId: turn.sessionId,
            reply: turn.content,
            modelName: turn.modelName,
            usage: turn.usage,
            rounds: turn.rounds
        });
        return;
    }
    if (event.type === 'error' || (event.type === 'http-json' && Number(event.status) >= 400)) {
        closeActiveThinking(turn);
        turn.done = true;
        turn.error = String(event.error || event.body?.error || (event.status ? `HTTP ${event.status}` : '回复失败'));
        broadcastLive(turn.threadKey, { type: 'error', turnId, error: turn.error });
    }
}

function finalizeLiveTurn(turn) {
    if (!turn) return;
    if (!turn.done) {
        closeActiveThinking(turn);
        turn.done = true;
        turn.error = turn.error || '已停止生成';
        broadcastLive(turn.threadKey, { type: 'error', turnId: turn.turnId, error: turn.error });
    }
    if (turn.cleanupTimer) clearTimeout(turn.cleanupTimer);
    turn.cleanupTimer = setTimeout(() => {
        if (liveTurns.get(turn.threadKey) === turn) liveTurns.delete(turn.threadKey);
    }, FINISHED_TURN_TTL_MS);
    turn.cleanupTimer.unref?.();
}

function getLiveTurnSnapshot(channel, kind, id, tenantId = getTenantId()) {
    return snapshotLiveTurn(liveTurns.get(liveThreadKey(channel, kind, id, tenantId)) || null);
}

function subscribeLiveTurn(channel, kind, id, listener, tenantId = getTenantId()) {
    const key = liveThreadKey(channel, kind, id, tenantId);
    let set = liveSubscribers.get(key);
    if (!set) {
        set = new Set();
        liveSubscribers.set(key, set);
    }
    set.add(listener);
    return () => {
        const cur = liveSubscribers.get(key);
        if (!cur) return;
        cur.delete(listener);
        if (!cur.size) liveSubscribers.delete(key);
    };
}

async function runTurn(options) {
    const { channel, conversation, persist = true } = options;
    const key = persist !== false && conversation?.id ? liveThreadKey(channel, conversation.kind || 'user', conversation.id) : '';
    if (!key) return runTurnInner(options);
    activeTurns.set(key, (activeTurns.get(key) || 0) + 1);
    const liveTurn = createLiveTurn({
        threadKey: key,
        channel,
        kind: conversation.kind || 'user',
        id: conversation.id,
        sessionId: options.aiSessionId || '',
        account: options.account || '',
        text: options.text || ''
    });
    const wrappedOptions = {
        ...options,
        onEvent: event => {
            recordAndBroadcastLiveEvent(liveTurn, event);
            options.onEvent?.(event);
        }
    };
    try { return await runTurnInner(wrappedOptions); }
    finally {
        finalizeLiveTurn(liveTurn);
        const left = (activeTurns.get(key) || 1) - 1;
        if (left > 0) activeTurns.set(key, left);
        else activeTurns.delete(key);
    }
}
async function runTurnInner({ channel, account, conversation, toolSessionId, text, aiSessionId, modelId, contextNote, persist = true, signal, onEvent }) {
    const user = conversation ? conversationUser(channel, conversation, account) : channelUser(channel, account);
    let sessionId = await usableSessionId(aiSessionId, user.username);
    const isSuperAdminSender = await isSuperAdminUser(channel, account);
    const isSuperAdmin = Boolean(conversation && conversation.kind === 'user' && isSuperAdminSender);
    const fullAccess = (channel === 'welink' && persist !== false && Boolean(conversation?.id)) || isSuperAdmin;
    if (fullAccess) {
        if (channel === 'welink') {
            const access = require('./welink-access');
            const config = await require('./welink-config-repository').getConfig();
            const verdict = access.checkInbound(config.access, { kind: conversation.kind, groupId: conversation.kind === 'group' ? conversation.id : '', senderAccount: String(account || '') });
            if (!account || !verdict.allowed) {
                onEvent({ type: 'error', error: account ? access.describeDenial(verdict) : '无法识别 WeLink 发送人' });
                return;
            }
        }
        // 仅在服务端桥接中授权，保留原频道归属；HTTP body 无法授予此身份。
        user.role = 'admin';
        user.isSuper = isSuperAdmin;
        sessionId = await require('../ai-chat-repository').getOrCreateSession({ sessionId, owner: user.username, pagePath: `/channels/${channel}`, pageTitle: `${CHANNEL_LABELS[channel] || channel} 频道` });
    }
    if (persist !== false && conversation && !signal?.aborted) {
        // 回复「批准 / 拒绝 1234」：结算推送到本会话的 Dragon Claw 审批（「需要你」收件箱）
        const inboxReply = require('../agent-approval-inbox').handleReply({ channel, conversation, actor: String(account || ''), text });
        if (inboxReply) {
            await replyDirectly({ channel, user, sessionId, text, reply: inboxReply, account, conversation, onEvent });
            return;
        }
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
        channelTurn: conversation ? { channel, conversation, toolSessionId: toolSessionId || '', actor: String(account || ''), fullAccess, isSuperAdmin, isSuperAdminSender } : null,
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

module.exports = { runTurn, busyThreads, getLiveTurnSnapshot, subscribeLiveTurn, channelUser, conversationUser, createVirtualResponse, isSuperAdminUser, isSuperAdminAccount };
