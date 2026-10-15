// 人员 / 群组黑白名单与会话类型识别（纯函数，便于测试）。
//
// 规则：消息必须同时通过「人员规则」和（群聊时）「群组规则」。
// - 所有人：不限制；仅白名单：只有名单内可用；黑名单：名单内禁止。
// - 主动推送同样遵守：推给人员看人员规则，推给群组看群组规则。

const GROUP_HINT_RE = /group|room|team|multi|crowd|chatroom|qun|群/i;

function text(value) {
    return value == null ? '' : String(value).trim();
}

/**
 * 从 SDK 输入中识别会话：单聊还是群聊、发送人账号、群 ID。
 * 群聊识别依据 platformExtParam.businessSessionType / businessSessionDomain 的语义关键字，
 * 原始字段保存在会话 ext 中，便于在「诊断」里核对实际报文。
 */
function resolveConversation(input = {}, storedSession = null) {
    const platform = input.extParameters?.platformExtParam || storedSession?.ext?.platformExtParam || {};
    const sessionType = text(platform.businessSessionType);
    const sessionDomain = text(platform.businessSessionDomain);
    const businessSessionId = text(platform.businessSessionId);
    const senderAccount = text(input.context?.sendUserAccount) || text(storedSession?.senderAccount);
    const isGroup = Boolean(businessSessionId) && (GROUP_HINT_RE.test(sessionType) || GROUP_HINT_RE.test(sessionDomain));
    return {
        kind: isGroup ? 'group' : 'user',
        senderAccount,
        groupId: isGroup ? businessSessionId : '',
        assistantAccount: text(input.context?.assistantAccount),
        raw: { businessSessionType: sessionType, businessSessionDomain: sessionDomain, businessSessionId }
    };
}

function evaluateRule(rule = {}, id) {
    const mode = rule.mode || 'all';
    if (mode === 'whitelist') {
        if (!id) return { allowed: false, reason: 'unknown_identity' };
        return (rule.whitelist || []).includes(id) ? { allowed: true } : { allowed: false, reason: 'not_whitelisted' };
    }
    if (mode === 'blacklist' && id && (rule.blacklist || []).includes(id)) return { allowed: false, reason: 'blacklisted' };
    return { allowed: true };
}

/** 入站消息权限判断。 */
function checkInbound(access = {}, conversation = {}) {
    const user = evaluateRule(access.users, conversation.senderAccount);
    if (!user.allowed) return { allowed: false, scope: 'user', reason: user.reason };
    if (conversation.kind === 'group') {
        const group = evaluateRule(access.groups, conversation.groupId);
        if (!group.allowed) return { allowed: false, scope: 'group', reason: group.reason };
    }
    return { allowed: true };
}

/** 主动推送目标权限判断。 */
function checkTarget(access = {}, target = {}) {
    const rule = target.kind === 'group' ? access.groups : access.users;
    const result = evaluateRule(rule, target.id);
    return result.allowed ? { allowed: true } : { allowed: false, scope: target.kind, reason: result.reason };
}

const REASON_TEXT = {
    unknown_identity: '无法识别身份',
    not_whitelisted: '不在白名单',
    blacklisted: '在黑名单中'
};

function describeDenial(result) {
    if (!result || result.allowed) return '';
    return `${result.scope === 'group' ? '群组' : '人员'}${REASON_TEXT[result.reason] || '被禁止'}`;
}

module.exports = { resolveConversation, checkInbound, checkTarget, describeDenial };
