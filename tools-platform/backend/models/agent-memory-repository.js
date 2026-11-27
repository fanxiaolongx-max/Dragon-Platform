// Dragon Claw 长期记忆：用户让智能体记住的偏好与约定，按账号保存在租户库 agent_memories，跨对话有效。
// 每次对话把本人的记忆放进系统提示；模型用 memory 工具增删改。内容写入前脱敏，并拒绝明显的凭据。
const { run, get, all, getDatabase } = require('./app-db');
const { redactText } = require('./ai-sensitive-data');

const { terms, topicScore } = require('./agent-topic-context');

const MAX_CHARS = 500;
const MAX_ITEMS = 100;
const PROMPT_CHARS = 4000;

const readyByDb = new WeakMap();
function ensureReady() {
    const dbKey = getDatabase();
    let initPromise = readyByDb.get(dbKey);
    if (!initPromise) {
        initPromise = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS agent_memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            const columns = await all('PRAGMA table_info(agent_memories)');
            if (!columns.some(column => column.name === 'topic')) {
                await run("ALTER TABLE agent_memories ADD COLUMN topic TEXT NOT NULL DEFAULT ''").catch(error => {
                    if (!/duplicate column name/i.test(error.message)) throw error;
                });
            }
            if (!columns.some(column => column.name === 'trace')) {
                await run("ALTER TABLE agent_memories ADD COLUMN trace TEXT NOT NULL DEFAULT '{}'").catch(error => {
                    if (!/duplicate column name/i.test(error.message)) throw error;
                });
            }
            await run('CREATE INDEX IF NOT EXISTS idx_agent_memories_owner ON agent_memories(owner, id)');
        })();
        readyByDb.set(dbKey, initPromise);
        initPromise.catch(() => readyByDb.delete(dbKey));
    }
    return initPromise;
}

function memoryError(code, message) {
    return Object.assign(new Error(message), { code });
}

async function list(owner) {
    if (!owner) return [];
    await ensureReady();
    return all('SELECT id, content, topic, updated_at AS updatedAt FROM agent_memories WHERE owner = ? ORDER BY id', [owner]);
}

function cleanContent(ctx, value) {
    const content = redactText(String(value || '').replace(/\s+/g, ' ').trim(), { secrets: ctx.sensitiveValues || [] });
    if (!content) throw memoryError('AGENT_ARGS', '缺少 content');
    if (content.length > MAX_CHARS) throw memoryError('AGENT_ARGS', `记忆内容最多 ${MAX_CHARS} 字，请精简成一句话`);
    return content;
}

async function owned(owner, id) {
    const row = await get('SELECT id, content, topic, trace FROM agent_memories WHERE owner = ? AND id = ?', [owner, Math.floor(Number(id))]);
    if (!row) throw memoryError('AGENT_NOT_FOUND', `没有编号为 ${id} 的记忆`);
    return row;
}

function cleanTopic(ctx, value) {
    if (!value) return '';
    const topic = cleanContent(ctx, value);
    if (topic.length > 100) throw memoryError('AGENT_ARGS', '适用主题最多 100 字');
    return topic;
}

function nextTrace(previous, source, isUpdate) {
    const version = (previous?.version || (isUpdate ? 1 : 0)) + 1;
    const entry = { version };
    if (source?.sessionId && source?.messageId) {
        entry.sessionId = source.sessionId;
        entry.messageId = source.messageId;
    }
    return { version, entries: [...(previous?.entries || []), entry].slice(-8) };
}

function memoryRequest(question) {
    return /记住|长期(?:记忆|偏好|约定)|记忆.{0,8}(?:出处|来源|修改|删除)|忘掉.{0,15}(?:偏好|记忆)|remember (?:this|that)|memory source/i.test(String(question || ''));
}

function temporaryOnly(text = '') {
    return /不(?:要|用)?(?:存入|保存|记入|更新|修改)(?:到)?长期记忆/.test(text)
        || (/(?:仅限|仅|只限|只在|只对)?(?:这期|本期|这次|本次|本轮|这一期).{0,12}(?:不要|不用|不加|例外|临时)|仅(?:本次|这次|本轮)|this (?:time|issue) only/i.test(text)
            && !/以后|从今|今后|永久|从现在起|from now on/i.test(text));
}

async function describeSource(ctx, row) {
    if (ctx.sharedMemoryTurn) return '请在个人对话查看记忆出处。';
    const trace = JSON.parse(row.trace || '{}');
    if (!trace.entries?.length) return '旧记忆未记录来源。';
    const shared = require('./shared-conversations');
    const tenantId = require('./tenant-context').getTenantId();
    if (ctx.chatSessionId && await shared.shareForSession({tenantId, username:ctx.username, sessionId:ctx.chatSessionId})) {
        return '请在个人对话查看记忆出处。';
    }
    const result = [];
    for (const entry of trace.entries) {
        const { sessionId, messageId } = entry;
        let note = '未记录来源';
        if (sessionId && messageId) {
            const revoked = await shared.isRevokedSession({tenantId, username:ctx.username, sessionId});
            const message = !revoked && await get(`SELECT m.content,m.created_at FROM ai_chat_messages m
                JOIN ai_chat_sessions s ON s.id=m.session_id WHERE s.owner=? AND s.id=? AND m.id=? AND m.role='user'`,
                [ctx.username, sessionId, messageId]);
            note = message ? { sessionId, messageId, time: message.created_at, quote: redactText(message.content, {secrets:ctx.sensitiveValues || []}).slice(0,300) }
                : '来源已删除或不可访问';
        }
        result.push({ version: entry.version, current: entry.version === trace.version, source: note });
    }
    return JSON.stringify({ version:trace.version, recordedChanges:trace.version - 1, note:'首次创建不计为修改', versions:result });
}

const format = rows => rows.map(row => `[${row.id}] ${row.content}${row.topic ? `（适用：${row.topic}）` : ''}`).join('\n');

async function execute(ctx, args = {}) {
    const owner = String(ctx.username || '');
    if (!owner) throw memoryError('AGENT_MEMORY_UNAVAILABLE', '当前对话无法确定账号，不能使用长期记忆');
    await ensureReady();
    const action = String(args.action || '');
    if (action === 'source') {
        const row = await owned(owner, args.id);
        return { content: await describeSource(ctx, row), summary: '记忆出处' };
    }
    if (['add','update'].includes(action) && temporaryOnly(ctx.currentUserMessage)) {
        return { content: '仅本轮采用，长期记忆未变更。', summary: '本轮例外' };
    }
    if (action === 'list') {
        const rows = await list(owner);
        return { content: rows.length ? format(rows) : '还没有长期记忆。', summary: `${rows.length} 条记忆` };
    }
    if (action === 'add') {
        const content = cleanContent(ctx, args.content);
        const topic = cleanTopic(ctx, args.topic);
        const result = await run(`INSERT INTO agent_memories (owner, content, topic, trace)
            SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM agent_memories WHERE owner=? AND content=? AND topic=?)
            AND (SELECT count(*) FROM agent_memories WHERE owner=?) < ?`,
            [owner, content, topic, JSON.stringify(nextTrace(null, ctx.memorySource, false)), owner, content, topic, owner, MAX_ITEMS]);
        if (!result.changes) {
            const same = await get('SELECT id FROM agent_memories WHERE owner=? AND content=? AND topic=?', [owner, content, topic]);
            if (same) return { content: `已有相同的记忆 [${same.id}]，未重复保存。`, summary: `已有 [${same.id}]` };
            throw memoryError('AGENT_MEMORY_FULL', `记忆已满 ${MAX_ITEMS} 条：请先合并或删除不再需要的记忆`);
        }
        return { content: `已记住 [${result.lastID}]：${content}`, summary: `新增记忆 [${result.lastID}]` };
    }
    if (action === 'update') {
        const row = await owned(owner, args.id);
        const content = cleanContent(ctx, args.content);
        const topic = cleanTopic(ctx, args.topic ?? row.topic);
        if (content !== row.content || topic !== row.topic) {
            const trace = nextTrace(JSON.parse(row.trace), ctx.memorySource, true);
            const changed = await run('UPDATE agent_memories SET content=?, topic=?, trace=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner=? AND trace=?',
                [content, topic, JSON.stringify(trace), row.id, owner, row.trace]);
            if (!changed.changes) throw memoryError('AGENT_MEMORY_CONFLICT', '记忆已变化，请重新查看当前内容。');
        }
        return { content: `已更新 [${row.id}]：${content}`, summary: `更新记忆 [${row.id}]` };
    }
    if (action === 'delete') {
        const row = await owned(owner, args.id);
        await run('DELETE FROM agent_memories WHERE id = ? AND owner = ?', [row.id, owner]);
        return { content: `已删除 [${row.id}]：${row.content}`, summary: `删除记忆 [${row.id}]` };
    }
    throw memoryError('AGENT_ARGS', 'action 只能是 add / update / delete / list');
}

/** 审批卡：写明要记住 / 修改 / 删除的内容 */
async function preview(ctx, args = {}) {
    const owner = String(ctx.username || '');
    await ensureReady();
    const label = { add: '记住', update: '修改记忆', delete: '删除记忆' }[args.action] || String(args.action || '');
    const fields = [{ label: '操作', value: label }];
    if (args.action === 'update' || args.action === 'delete') fields.push({ label: '原内容', value: `[${args.id}] ${(await owned(owner, args.id)).content}` });
    if (args.action === 'add' || args.action === 'update') fields.push({ label: '内容', value: cleanContent(ctx, args.content) });
    if (args.topic) fields.push({ label: '适用范围', value: cleanTopic(ctx, args.topic) });
    return { title: '长期记忆', fields };
}

/** 系统提示里的记忆段落；没有记忆时返回空串 */
async function promptFor(owner, question = null) {
    const rows = await list(owner).catch(() => []);
    const words = terms(question);
    const query = String(question ?? '').normalize('NFKC').toLowerCase();
    const ranked = rows.map(row => {
        // 旧记录缺少主题：从正文匹配，保留常见的全局语言偏好。
        const general = row.topic === '*' || (!row.topic && /^(?:默认|始终|总是|请一直)(?:使用|用)?(?:中文|英文|简体中文)(?:回复|回答)/.test(row.content));
        const topic = (row.topic || '').trim().normalize('NFKC').toLowerCase();
        // 专名可能被分成几个单字，分词前先保留整段中文主题的字面命中。
        const exact = topic.length >= 2 && /\p{Script=Han}/u.test(topic) && query.includes(topic);
        const score = general || question === null ? 1 : (exact ? 100 : 0) + topicScore(row.topic || row.content, words) * 2;
        return { row, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score
        || b.row.updatedAt.localeCompare(a.row.updatedAt) || b.row.id - a.row.id);
    let text = '';
    for (const { row } of ranked) {
        const line = format([row]);
        if (text.length + line.length + 1 <= PROMPT_CHARS) text += line + '\n';
    }
    const guidance = memoryRequest(question) ? '\n用户询问个人记忆时，直接使用 memory 工具。查出处用 source 和已有编号（缺编号先 list）；要求保存、更正或忘记时以实际写入结果为准，不用业务库或命令行查个人记忆。\n' : '';
    return guidance + (text ? `\n**长期记忆**（仅在适用时采用；当前用户要求优先。可用 memory list 管理全部记忆）：\n${text}` : '');
}

module.exports = { execute, preview, list, promptFor, memoryRequest, MAX_ITEMS };
