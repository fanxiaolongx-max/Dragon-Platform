// 查自己的历史对话：把当前账号在平台上的 AI 对话当作一个只读“库”，让模型按关键词搜、按会话翻。
// 安全边界：
// - 只认 ai_chat_sessions.owner = 当前账号；会话号不是自己的直接拒绝（assertSessionOwner）；
// - 已被移出 / 已停止的共享对话副本不出现（与侧栏 /session 列表一致）；
// - 只返回问题和回答正文，不带工具参数 / 结果、附件内容和工作目录路径；正文经 redactText 脱敏并截断；
// - 频道对话（微信 / WeLink 群里）不加载：群里其他人能看到回复。
const chat = require('./ai-chat-repository');
const { all, get } = require('./app-db');
const { redactText } = require('./ai-sensitive-data');
const { runWithTenant } = require('./tenant-context');
const { conversationTitle } = require('./conversation-title');

const MESSAGE_CHARS = 3000;
const PAGE_BUDGET = 24000;
const SNIPPET_RADIUS = 80;

const DEFINITIONS = [
    {
        name: 'search_my_conversations',
        description: '搜索当前用户自己在平台上的历史 AI 对话（只含本人的会话和本人参与的共享对话）。用户问“我之前问过/聊过……”“上次那个结论是什么”“找一下以前关于 X 的对话”时用。query 为关键词（空格分隔，全部命中才算），不传则按最近更新列出会话；可用 since/until（YYYY-MM-DD）限定时间。返回会话 id、标题、时间和命中的片段，需要全文再用 read_my_conversation。',
        parameters: { type: 'object', properties: {
            query: { type: 'string', description: '关键词，空格分隔；不传则列出最近的会话' },
            since: { type: 'string', description: '起始日期 YYYY-MM-DD，可选' },
            until: { type: 'string', description: '截止日期 YYYY-MM-DD（含当天），可选' },
            limit: { type: 'integer', description: '最多返回几个会话，默认 10，上限 30' },
            offset: { type: 'integer', description: '翻页偏移，默认 0' }
        } }
    },
    {
        name: 'read_my_conversation',
        description: '读取当前用户自己的某个历史对话的消息（问题与回答正文，不含工具细节）。sessionId 取自 search_my_conversations。默认返回最近 20 条；继续往前翻传上一页返回的 before；传 query 时只返回含关键词的消息。',
        parameters: { type: 'object', properties: {
            sessionId: { type: 'string' },
            query: { type: 'string', description: '只看含这些关键词的消息（空格分隔，全部命中），可选' },
            limit: { type: 'integer', description: '条数，默认 20，上限 50' },
            before: { type: 'string', description: '翻页游标：上一页返回的 before' }
        }, required: ['sessionId'] }
    }
];

const splitOwner = owner => {
    const text = String(owner || '');
    const at = text.indexOf('::');
    return at < 0 ? { tenantId: '', username: text } : { tenantId: text.slice(0, at), username: text.slice(at + 2) };
};
const terms = query => [...new Set(String(query || '').toLowerCase().split(/\s+/).map(word => word.trim()).filter(Boolean))].slice(0, 8);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…（已截断，共 ${text.length} 字）` : text);
const day = value => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '');

function snippet(content, words) {
    const text = String(content || '').replace(/\s+/g, ' ');
    const lower = text.toLowerCase();
    const hit = words.map(word => lower.indexOf(word)).filter(index => index >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, hit - SNIPPET_RADIUS);
    return `${start ? '…' : ''}${text.slice(start, hit + SNIPPET_RADIUS * 2)}${hit + SNIPPET_RADIUS * 2 < text.length ? '…' : ''}`;
}

async function revokedIds(tenantId, username) {
    try {
        const ids = await require('./shared-conversations').purgeRevokedForUser({ tenantId, username });
        return Array.isArray(ids) ? ids.filter(Boolean) : [];
    } catch (_error) {
        return [];
    }
}

async function searchConversations({ tenantId, username, secrets = [] }, args = {}) {
    await chat.ensureReady();
    const words = terms(args.query);
    const limit = Math.max(1, Math.min(Number(args.limit) || 10, 30));
    const offset = Math.max(0, Number(args.offset) || 0);
    const excluded = await revokedIds(tenantId, username);
    const where = ['s.owner = ?', 'EXISTS (SELECT 1 FROM ai_chat_messages e WHERE e.session_id = s.id)'];
    const params = [username];
    if (excluded.length) { where.push(`s.id NOT IN (${excluded.map(() => '?').join(',')})`); params.push(...excluded); }
    if (day(args.since)) { where.push('date(s.updated_at) >= ?'); params.push(day(args.since)); }
    if (day(args.until)) { where.push('date(s.created_at) <= ?'); params.push(day(args.until)); }
    // 每个关键词都要在标题或某条消息里出现
    for (const word of words) {
        where.push("(instr(lower(s.auto_title), ?) > 0 OR EXISTS (SELECT 1 FROM ai_chat_messages q WHERE q.session_id = s.id AND q.role IN ('user','model') AND instr(lower(q.content), ?) > 0))");
        params.push(word, word);
    }
    const sql = `SELECT s.id, s.auto_title, s.page_path, s.page_title, s.created_at, s.updated_at,
            (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id) AS message_count,
            (SELECT content FROM ai_chat_messages f WHERE f.session_id = s.id AND f.role = 'user' ORDER BY f.created_at, f.rowid LIMIT 1) AS first_question
        FROM ai_chat_sessions s WHERE ${where.join(' AND ')}
        ORDER BY s.updated_at DESC, s.rowid DESC LIMIT ? OFFSET ?`;
    const rows = await all(sql, [...params, limit + 1, offset]);
    const hasMore = rows.length > limit;
    const sessions = [];
    for (const row of rows.slice(0, limit)) {
        const item = {
            sessionId: row.id,
            title: redactText(row.auto_title || conversationTitle(row.first_question || ''), { secrets }),
            page: row.page_path === '/' ? 'Dragon Claw' : (row.page_title || row.page_path),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            messages: Number(row.message_count) || 0
        };
        if (words.length) {
            const hits = await all(`SELECT id, role, content, created_at FROM ai_chat_messages
                WHERE session_id = ? AND role IN ('user','model') AND (${words.map(() => 'instr(lower(content), ?) > 0').join(' OR ')})
                ORDER BY created_at, rowid LIMIT 3`, [row.id, ...words]);
            item.matches = hits.map(hit => ({ messageId: hit.id, role: hit.role === 'model' ? 'assistant' : 'user', at: hit.created_at, text: redactText(snippet(hit.content, words), { secrets }) }));
        } else {
            item.firstQuestion = redactText(String(row.first_question || '').replace(/\s+/g, ' ').slice(0, 160), { secrets });
        }
        sessions.push(item);
    }
    return { sessions, hasMore, nextOffset: hasMore ? offset + limit : null, ...(sessions.length ? {} : { note: words.length ? '没有找到含这些关键词的对话，可以换个说法或少用几个词' : '还没有历史对话' }) };
}

async function readConversation({ tenantId, username, currentSessionId, secrets = [] }, args = {}) {
    const sessionId = String(args.sessionId || '').trim();
    if (!sessionId) throw Object.assign(new Error('缺少 sessionId'), { code: 'BAD_REQUEST' });
    if ((await revokedIds(tenantId, username)).includes(sessionId)) throw Object.assign(new Error('这个共享对话已不再对你开放'), { code: 'AI_SESSION_FORBIDDEN' });
    const owned = await chat.assertSessionOwner(sessionId, username);
    if (!owned) throw Object.assign(new Error('没有这个对话'), { code: 'NOT_FOUND' });
    const session = await get('SELECT auto_title, created_at, updated_at FROM ai_chat_sessions WHERE id = ?', [sessionId]);
    const words = terms(args.query);
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 50));
    let items, hasMore, total;
    if (words.length) {
        const rows = await all(`SELECT id, role, content, created_at, rowid AS seq FROM ai_chat_messages
            WHERE session_id = ? AND role IN ('user','model') AND ${words.map(() => 'instr(lower(content), ?) > 0').join(' AND ')}
            ORDER BY created_at, rowid`, [sessionId, ...words]);
        total = rows.length;
        const cursor = args.before ? rows.findIndex(row => row.id === String(args.before)) : rows.length;
        const end = cursor < 0 ? rows.length : cursor;
        items = rows.slice(Math.max(0, end - limit), end);
        hasMore = end - limit > 0;
    } else {
        const page = await chat.listMessagesPage(sessionId, { owner: username, limit, before: String(args.before || '') });
        items = page.items.filter(item => item.role === 'user' || item.role === 'model');
        hasMore = page.hasMore;
        total = page.total;
    }
    let budget = PAGE_BUDGET;
    const messages = [];
    // 预算从最新往前扣：最近的消息优先保留完整
    for (const item of [...items].reverse()) {
        const text = clip(redactText(String(item.content || ''), { secrets }), Math.max(200, Math.min(MESSAGE_CHARS, budget)));
        budget -= text.length;
        messages.unshift({ messageId: item.id, role: item.role === 'model' ? 'assistant' : 'user', at: item.created_at, text });
        if (budget <= 0) { hasMore = true; break; }
    }
    return {
        sessionId,
        title: redactText(session?.auto_title || '', { secrets }),
        isCurrentConversation: sessionId === currentSessionId,
        totalMessages: total,
        messages,
        hasMore,
        before: hasMore && messages.length ? messages[0].messageId : null
    };
}

/** 附加工具组：owner 为 租户::账号；currentSessionId 用于标出“就是当前这个对话” */
function toolset({ owner, currentSessionId = '', sensitiveValues = [] }) {
    const { tenantId, username } = splitOwner(owner);
    const ctx = { tenantId, username, currentSessionId, secrets: sensitiveValues };
    const scoped = fn => (tenantId ? runWithTenant(tenantId, fn) : fn());
    return {
        id: 'my_conversations',
        label: '我的历史对话：按关键词搜索、翻看当前用户自己以前的 AI 对话（只读，只含本人的）',
        definitions: DEFINITIONS,
        kindOf: () => 'read',
        preview: async () => ({}),
        alwaysKey: name => name,
        async execute(call) {
            const args = call.args && typeof call.args === 'object' ? call.args : {};
            try {
                if (!username) throw Object.assign(new Error('没有登录账号，不能查历史对话'), { code: 'AI_SESSION_FORBIDDEN' });
                if (call.name === 'search_my_conversations') {
                    const result = await scoped(() => searchConversations(ctx, args));
                    return { content: JSON.stringify(result), summary: result.sessions.length ? `找到 ${result.sessions.length} 个对话${result.hasMore ? '（还有更多）' : ''}` : '没有找到' };
                }
                const result = await scoped(() => readConversation(ctx, args));
                return { content: JSON.stringify(result), summary: `${result.title || '对话'} · ${result.messages.length} 条${result.hasMore ? '（还有更早的）' : ''}` };
            } catch (error) {
                const message = error.code === 'AI_SESSION_FORBIDDEN' ? '只能查看你自己的对话' : error.message;
                return { content: `错误（${error.code || 'ERROR'}）：${message}`, summary: String(message || '').slice(0, 120), isError: true };
            }
        }
    };
}

module.exports = { toolset, searchConversations, readConversation, DEFINITIONS };
