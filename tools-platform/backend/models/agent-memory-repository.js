// Dragon Claw 长期记忆：用户让智能体记住的偏好与约定，按账号保存在租户库 agent_memories，跨对话有效。
// 每次对话把本人的记忆放进系统提示；模型用 memory 工具增删改。内容写入前脱敏，并拒绝明显的凭据。
const { run, get, all, getDatabase } = require('./app-db');
const { redactText } = require('./ai-sensitive-data');

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
    return all('SELECT id, content, updated_at AS updatedAt FROM agent_memories WHERE owner = ? ORDER BY id', [owner]);
}

function cleanContent(ctx, value) {
    const content = redactText(String(value || '').replace(/\s+/g, ' ').trim(), { secrets: ctx.sensitiveValues || [] });
    if (!content) throw memoryError('AGENT_ARGS', '缺少 content');
    if (content.length > MAX_CHARS) throw memoryError('AGENT_ARGS', `记忆内容最多 ${MAX_CHARS} 字，请精简成一句话`);
    if (CREDENTIAL_RE.test(content)) throw memoryError('AGENT_MEMORY_SECRET', '记忆里不能保存密码、密钥、Token 等凭据');
    return content;
}

async function owned(owner, id) {
    const row = await get('SELECT id, content FROM agent_memories WHERE owner = ? AND id = ?', [owner, Math.floor(Number(id))]);
    if (!row) throw memoryError('AGENT_NOT_FOUND', `没有编号为 ${id} 的记忆`);
    return row;
}

const format = rows => rows.map(row => `[${row.id}] ${row.content}`).join('\n');

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
        const rows = await list(owner);
        const same = rows.find(row => row.content === content);
        if (same) return { content: `已有相同的记忆 [${same.id}]，未重复保存。`, summary: `已有 [${same.id}]` };
        if (rows.length >= MAX_ITEMS) throw memoryError('AGENT_MEMORY_FULL', `记忆已满 ${MAX_ITEMS} 条：请先合并或删除不再需要的记忆`);
        const result = await run('INSERT INTO agent_memories (owner, content) VALUES (?, ?)', [owner, content]);
        return { content: `已记住 [${result.lastID}]：${content}`, summary: `新增记忆 [${result.lastID}]` };
    }
    if (action === 'update') {
        const row = await owned(owner, args.id);
        const content = cleanContent(ctx, args.content);
        await run('UPDATE agent_memories SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ?', [content, row.id, owner]);
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
    return { title: '长期记忆', fields };
}

/** 系统提示里的记忆段落；没有记忆时返回空串 */
async function promptFor(owner) {
    const rows = await list(owner).catch(() => []);
    if (!rows.length) return '';
    let text = format(rows);
    if (text.length > PROMPT_CHARS) text = `${text.slice(0, PROMPT_CHARS)}\n…（还有更多，用 memory 的 list 查看）`;
    return `\n**长期记忆**（用户之前让你记住的偏好与约定，跨对话有效；与用户当前的明确要求冲突时以当前要求为准；需要修改或删除时用 memory 工具）：\n${text}\n`;
}

module.exports = { execute, preview, list, promptFor, MAX_ITEMS };
