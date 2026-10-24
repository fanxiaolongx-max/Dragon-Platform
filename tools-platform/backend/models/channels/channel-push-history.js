// 主动推送写入对话记录：推送成功后，把消息作为助手消息追加到该群/人当前的平台对话里。
// - 首页频道时间线（WeLink / 微信）能看到推送，并标注来源（运营计划、测试推送、手动推送等）；
// - 成员随后 @助手 回复时，Dragon Claw 的上下文里有刚推送的内容，互动能接得上。
// 该群/人还没有平台对话时新建一段，并绑定到推送使用的频道会话，后续对话接着这一段。
const aiChatRepo = require('../ai-chat-repository');
const { get } = require('../app-db');
const targetsRepo = require('./channel-targets-repository');
const followupsRepo = require('./channel-followups-repository');
const bridge = require('./dragon-claw-channel-bridge');

const CHANNEL_LABELS = { welink: 'WeLink', weixin: '微信' };

async function currentSessionId(channel, toolSessionId, owner) {
    if (!toolSessionId) return '';
    const session = await targetsRepo.getSession(channel, toolSessionId);
    if (!session?.aiSessionId) return '';
    // 只续写归属于该群/人的对话（与频道对话桥的归属规则一致）
    const row = await get('SELECT owner FROM ai_chat_sessions WHERE id = ?', [session.aiSessionId]).catch(() => null);
    return row && (!row.owner || row.owner === owner) ? session.aiSessionId : '';
}

/**
 * @param {string} channel welink | weixin
 * @param {{kind:'user'|'group', id:string}} target
 * @param {string} text 推送正文
 * @param {{trigger?:string, source?:string}} meta
 */
async function record(channel, target, text, { trigger = 'system', source = '' } = {}) {
    const conversation = { kind: target.kind === 'group' ? 'group' : 'user', id: target.id };
    const owner = bridge.conversationUser(channel, conversation, target.id).username;
    const stored = await targetsRepo.getTarget(channel, conversation.kind, conversation.id);
    const toolSessionId = stored?.toolSessionId || '';
    const sessionId = await currentSessionId(channel, toolSessionId, owner);
    const savedId = await aiChatRepo.addMessage({
        sessionId: sessionId || undefined,
        owner,
        pagePath: `/channels/${channel}`,
        pageTitle: `${CHANNEL_LABELS[channel] || channel} 频道`,
        role: 'model',
        content: String(text || ''),
        events: [{ type: 'push', trigger, source: String(source || '').slice(0, 200) }]
    });
    if (savedId !== sessionId) {
        if (toolSessionId) await targetsRepo.bindAiSession(channel, toolSessionId, savedId);
        await followupsRepo.addSegment(channel, { ...conversation, toolSessionId, aiSessionId: savedId });
    }
    return savedId;
}

/** 把一次推送结果里成功的目标逐个记入对话；失败只打日志，不影响推送结果。 */
async function recordResults(channel, text, result, meta) {
    for (const item of result?.results || []) {
        if (!item.ok) continue;
        try {
            await record(channel, { kind: item.kind, id: item.id }, text, meta);
        } catch (error) {
            console.warn(`[Channels] 推送记录写入对话失败（${channel} ${item.kind}:${item.id}）：${error.message}`);
        }
    }
}

module.exports = { record, recordResults };
