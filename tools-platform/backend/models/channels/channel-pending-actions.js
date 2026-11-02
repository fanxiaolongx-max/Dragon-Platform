// 频道对话（微信、WeLink）里的「回复确认」：频道里显示不了审批卡，需要用户确认的操作（如保存技能）先挂起，
// 本轮回复末尾附上变更摘要和确认码；同一个人在同一个会话里回复「确认 1234」才执行，回复「取消」放弃。
// 只放内存：服务重启或超过 30 分钟未确认即失效，需要重新发起。
const crypto = require('crypto');
const { getTenantId, runWithTenant } = require('../tenant-context');

const TTL_MS = 30 * 60 * 1000;
const MAX_PENDING = 200;
const pending = new Map(); // id → { key, actor, code, title, preview, execute, createdAt, announced }

const CONFIRM_RE = /^(?:确认|确定|同意|允许|批准|确认保存|yes|y|ok|confirm|approve)\s*[：:#]?\s*(\d{4})?\s*[。.!！]?$/i;
const CANCEL_RE = /^(?:取消|拒绝|不要|算了|不用了?|no|n|cancel|deny)\s*[：:#]?\s*(\d{4})?\s*[。.!！]?$/i;

/** 会话键：频道 + 群 / 单聊 + 会话 id */
function keyOf(channel, conversation = {}) {
    return channel && conversation?.id ? `${getTenantId()}\n${channel}\n${conversation.kind || 'user'}\n${conversation.id}` : '';
}

function sweep() {
    const now = Date.now();
    for (const [id, item] of pending) if (now - item.createdAt > TTL_MS) pending.delete(id);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
}

function forKey(key, actor) {
    sweep();
    return [...pending.entries()].filter(([, item]) => item.key === key && item.actor === String(actor || ''));
}

/**
 * 挂起一个需要确认的操作，返回给模型的工具结果（说明还没执行、等用户回复）。
 * @param {object} input { channel, conversation, actor, title, preview, execute: () => Promise<outcome> }
 */
function defer({ channel, conversation, actor = '', title, preview = {}, execute }) {
    const key = keyOf(channel, conversation);
    if (!key || typeof execute !== 'function') return null;
    sweep();
    const taken = new Set([...pending.values()].filter(item => item.key === key).map(item => item.code));
    let code;
    do code = String(crypto.randomInt(1000, 10000)); while (taken.has(code));
    const tenantId = getTenantId();
    const executeInTenant = () => runWithTenant(tenantId, execute);
    pending.set(crypto.randomUUID(), { key, actor: String(actor || ''), code, title: String(title || '操作'), preview, execute: executeInTenant, createdAt: Date.now(), announced: false });
    return {
        content: `还没有执行：这是频道对话，显示不了审批卡。已把「${title}」挂起，回复末尾会自动附上变更摘要和确认码，用户回复「确认 ${code}」后才会执行，回复「取消」则放弃。不要说已经完成，也不要重复提交；简单告诉用户需要回复确认即可。`,
        summary: `等待用户回复「确认 ${code}」`
    };
}

function clip(text, max) {
    const value = String(text || '');
    return value.length > max ? `${value.slice(0, max)}\n…（共 ${value.length} 字，已截断）` : value;
}

/** 本轮新挂起的操作：附在回复末尾的确认说明（每个只附一次） */
function takeNote(channel, conversation, actor = '') {
    const items = forKey(keyOf(channel, conversation), actor).filter(([, item]) => !item.announced);
    if (!items.length) return '';
    const blocks = items.map(([, item]) => {
        item.announced = true;
        const diff = item.preview?.diff ? `\n\`\`\`diff\n${clip(item.preview.diff, 1500)}\n\`\`\`` : '';
        const where = item.preview?.path ? `\n${item.preview.path}` : '';
        return `**待确认：${item.title}**${where}${diff}\n回复「确认 ${item.code}」执行，回复「取消」放弃（30 分钟内有效）。`;
    });
    return `\n\n---\n${blocks.join('\n\n')}`;
}

/**
 * 用户的回复是否在确认 / 取消挂起的操作；是则执行并返回回复文本，否则返回 null（照常交给 AI）。
 */
async function handleReply({ channel, conversation, actor = '', text }) {
    const key = keyOf(channel, conversation);
    const message = String(text || '').trim();
    if (!key || message.length > 40) return null;
    const confirm = CONFIRM_RE.exec(message);
    const cancel = !confirm && CANCEL_RE.exec(message);
    if (!confirm && !cancel) return null;
    const items = forKey(key, actor);
    if (!items.length) return null;
    const code = (confirm || cancel)[1];
    const chosen = code ? items.filter(([, item]) => item.code === code) : items;
    if (!chosen.length) return `没有确认码为 ${code} 的待确认操作。当前待确认：${items.map(([, item]) => `「${item.title}」（${item.code}）`).join('、')}。`;
    if (cancel) {
        chosen.forEach(([id]) => pending.delete(id));
        return `已取消：${chosen.map(([, item]) => `「${item.title}」`).join('、')}，没有做任何修改。`;
    }
    // 不带确认码、却有多个待确认操作时，要求指明
    if (!code && chosen.length > 1) return `有 ${chosen.length} 个待确认操作，请回复带确认码的「确认 XXXX」：${chosen.map(([, item]) => `「${item.title}」（${item.code}）`).join('、')}。`;
    const [id, item] = chosen[0];
    pending.delete(id);
    try {
        const outcome = await item.execute();
        return outcome?.isError ? `⚠️ 「${item.title}」没有成功：${outcome.content || outcome.summary || '未知错误'}` : `✅ ${outcome?.content || `已完成「${item.title}」`}`;
    } catch (error) {
        return `⚠️ 「${item.title}」没有成功：${error.message || error}`;
    }
}

module.exports = { defer, takeNote, handleReply, keyOf, _internal: { pending, CONFIRM_RE, CANCEL_RE } };
