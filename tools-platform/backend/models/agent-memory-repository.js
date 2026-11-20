// Dragon Claw 长期记忆：用户让智能体记住的偏好与约定，按账号保存在租户库 agent_memories，跨对话有效。
// 每次对话把本人的记忆放进系统提示；模型用 memory 工具增删改。内容写入前脱敏，并拒绝明显的凭据。
const { run, get, all, getDatabase } = require('./app-db');
const { redactText } = require('./ai-sensitive-data');

const { terms, topicScore } = require('./agent-topic-context');

const MAX_CHARS = 500;
const MAX_ITEMS = 100;
const PROMPT_CHARS = 4000;
const CREDENTIAL_RE = /(密码|口令|password|passwd|pwd|api[_\s-]?key|secret|token|cookie|authorization)\s*[:：=]/i;

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
    if (CREDENTIAL_RE.test(content)) throw memoryError('AGENT_MEMORY_SECRET', '记忆里不能保存密码、密钥、Token 等凭据');
    return content;
}

async function owned(owner, id) {
    const row = await get('SELECT id, content, topic FROM agent_memories WHERE owner = ? AND id = ?', [owner, Math.floor(Number(id))]);
    if (!row) throw memoryError('AGENT_NOT_FOUND', `没有编号为 ${id} 的记忆`);
    return row;
}

function cleanTopic(ctx, value) {
    if (!value) return '';
    const topic = cleanContent(ctx, value);
    if (topic.length > 100) throw memoryError('AGENT_ARGS', '适用主题最多 100 字');
    return topic;
}

const format = rows => rows.map(row => `[${row.id}] ${row.content}${row.topic ? `（适用：${row.topic}）` : ''}`).join('\n');

async function execute(ctx, args = {}) {
    const owner = String(ctx.username || '');
    if (!owner) throw memoryError('AGENT_MEMORY_UNAVAILABLE', '当前对话无法确定账号，不能使用长期记忆');
    await ensureReady();
    const action = String(args.action || '');
    if (action === 'list') {
        const rows = await list(owner);
        return { content: rows.length ? format(rows) : '还没有长期记忆。', summary: `${rows.length} 条记忆` };
    }
    if (action === 'add') {
        const content = cleanContent(ctx, args.content);
        const topic = cleanTopic(ctx, args.topic);
        const rows = await list(owner);
        const same = rows.find(row => row.content === content && row.topic === topic);
        if (same) return { content: `已有相同的记忆 [${same.id}]，未重复保存。`, summary: `已有 [${same.id}]` };
        if (rows.length >= MAX_ITEMS) throw memoryError('AGENT_MEMORY_FULL', `记忆已满 ${MAX_ITEMS} 条：请先合并或删除不再需要的记忆`);
        const result = await run('INSERT INTO agent_memories (owner, content, topic) VALUES (?, ?, ?)', [owner, content, topic]);
        return { content: `已记住 [${result.lastID}]：${content}`, summary: `新增记忆 [${result.lastID}]` };
    }
    if (action === 'update') {
        const row = await owned(owner, args.id);
        const content = cleanContent(ctx, args.content);
        await run('UPDATE agent_memories SET content = ?, topic = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ?', [content, cleanTopic(ctx, args.topic ?? row.topic), row.id, owner]);
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
    return text ? `\n**长期记忆**（仅在适用时采用；当前用户要求优先。可用 memory list 管理全部记忆）：\n${text}` : '';
}

module.exports = { execute, preview, list, promptFor, MAX_ITEMS };
