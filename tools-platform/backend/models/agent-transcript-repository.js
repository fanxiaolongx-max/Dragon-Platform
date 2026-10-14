// Dragon Claw 工作区：智能体会话的工具调用转录持久化（租户库 agent_session_transcripts）。
// 转录 = 上几轮的 model(toolCalls) / tool(toolResults) / model(text) 消息，重启后同一 agentSessionId 仍能延续。
const { run, get } = require('./app-db');

const MAX_ENTRIES = 80; // 单轮最多 25 步（约 52 条），至少能完整保住一轮
const MAX_JSON_BYTES = 1.5 * 1024 * 1024;

// 每个租户是独立的数据库文件：建表要按数据库各做一次（只做一次会让第二个租户缺表）
const readyByDb = new Map();
const { getDbPath } = require('./app-db');

function ensureReady() {
    const dbKey = getDbPath();
    let initPromise = readyByDb.get(dbKey);
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS agent_session_transcripts (
                    agent_session_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL DEFAULT '',
                    root TEXT NOT NULL DEFAULT '',
                    permission_mode TEXT NOT NULL DEFAULT 'ask',
                    transcript TEXT NOT NULL DEFAULT '[]',
                    turn_count INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // 上一轮结束时的上下文占用（JSON），恢复对话时右侧「上下文」直接显示
            await run("ALTER TABLE agent_session_transcripts ADD COLUMN context TEXT NOT NULL DEFAULT ''").catch(error => {
                if (!/duplicate column/i.test(String(error && error.message))) throw error;
            });
            await run('CREATE INDEX IF NOT EXISTS idx_agent_session_transcripts_updated ON agent_session_transcripts(updated_at)');
            await run('CREATE INDEX IF NOT EXISTS idx_agent_session_transcripts_owner_root ON agent_session_transcripts(owner, root, updated_at)');
        })().catch(error => {
            readyByDb.delete(dbKey);
            throw error;
        });
        readyByDb.set(dbKey, initPromise);
    }
    return initPromise;
}

function sanitizeEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.role === 'tool') {
        const toolResults = (Array.isArray(entry.toolResults) ? entry.toolResults : [])
            .map(item => ({ id: String(item.id || ''), name: String(item.name || ''), content: String(item.content ?? ''), isError: Boolean(item.isError) }));
        return toolResults.length ? { role: 'tool', toolResults } : null;
    }
    if (entry.role === 'model' || entry.role === 'user') {
        const out = { role: entry.role, content: String(entry.content ?? '') };
        if (Array.isArray(entry.toolCalls) && entry.toolCalls.length) {
            out.toolCalls = entry.toolCalls.map(call => {
                const saved = { id: String(call.id || ''), name: String(call.name || ''), args: call.args && typeof call.args === 'object' ? call.args : {} };
                // Gemini 3 回传工具调用必须带思考签名，重启后续写也要保留。
                if (typeof call.thoughtSignature === 'string' && call.thoughtSignature) saved.thoughtSignature = call.thoughtSignature;
                return saved;
            });
        }
        if (!out.content && !out.toolCalls) return null;
        return out;
    }
    return null;
}

/**
 * 规范化并裁剪转录。转录按「轮」组织：每轮以用户消息开头，后接模型工具调用 / 工具结果 / 模型回答。
 * 只按整轮从最旧的丢起（最多 MAX_ENTRIES 条、序列化不超过 MAX_JSON_BYTES），
 * 保证模型的工具调用总紧跟在用户消息或工具结果之后（Gemini 等供应商强制要求）。
 * 第一个用户消息之前的条目（旧格式转录或残缺的一轮）直接丢弃。
 */
function normalizeTranscript(transcript) {
    const turns = [];
    for (const entry of (Array.isArray(transcript) ? transcript : []).map(sanitizeEntry).filter(Boolean)) {
        if (entry.role === 'user') turns.push([entry]);
        else if (turns.length) turns[turns.length - 1].push(entry);
    }
    const kept = [];
    let count = 0;
    let bytes = 2;
    for (let index = turns.length - 1; index >= 0; index -= 1) {
        const size = Buffer.byteLength(JSON.stringify(turns[index]), 'utf8') + 1;
        if (count + turns[index].length > MAX_ENTRIES || bytes + size > MAX_JSON_BYTES) break;
        kept.unshift(turns[index]);
        count += turns[index].length;
        bytes += size;
    }
    return kept.flat();
}

/**
 * 把文字历史（数据库里的问答，末尾是本轮用户消息）与工具转录合成发给模型的消息。
 * 历史中从「第一个也出现在转录里的用户消息」起的部分由转录（含工具步骤的完整版本）替换，
 * 其余较早的纯文字历史保留在前面。
 */
function mergeHistoryWithTranscript(historyMessages, transcript) {
    const history = Array.isArray(historyMessages) ? historyMessages : [];
    const current = history[history.length - 1];
    const prior = history.slice(0, -1);
    const entries = Array.isArray(transcript) ? transcript : [];
    if (!entries.length) return [...prior, current].filter(Boolean);
    const transcriptQuestions = new Set(entries.filter(entry => entry.role === 'user').map(entry => String(entry.content || '').trim()));
    const cut = prior.findIndex(message => message && message.role === 'user' && transcriptQuestions.has(String(message.content || '').trim()));
    const before = cut >= 0 ? prior.slice(0, cut) : prior;
    return [...before, ...entries, current].filter(Boolean);
}

async function load(agentSessionId) {
    await ensureReady();
    const row = await get(
        'SELECT agent_session_id, owner, root, permission_mode, transcript, turn_count, context, updated_at FROM agent_session_transcripts WHERE agent_session_id = ?',
        [String(agentSessionId || '')]
    );
    if (!row) return null;
    let transcript = [];
    try {
        transcript = normalizeTranscript(JSON.parse(row.transcript || '[]'));
    } catch (_error) {
        transcript = [];
    }
    let context = null;
    try {
        context = row.context ? JSON.parse(row.context) : null;
    } catch (_error) {
        context = null;
    }
    return {
        agentSessionId: row.agent_session_id,
        owner: row.owner,
        root: row.root,
        permissionMode: row.permission_mode,
        transcript,
        turnCount: Number(row.turn_count) || 0,
        context,
        updatedAt: row.updated_at
    };
}

async function save({ agentSessionId, owner, root, permissionMode, transcript, turnCount, context = null }) {
    await ensureReady();
    const entries = normalizeTranscript(transcript);
    const contextJson = context && typeof context === 'object' ? JSON.stringify(context).slice(0, 64 * 1024) : '';
    await run(
        `INSERT INTO agent_session_transcripts (agent_session_id, owner, root, permission_mode, transcript, turn_count, context)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_session_id) DO UPDATE SET
             owner = excluded.owner,
             root = excluded.root,
             permission_mode = excluded.permission_mode,
             transcript = excluded.transcript,
             turn_count = excluded.turn_count,
             context = excluded.context,
             updated_at = CURRENT_TIMESTAMP`,
        [String(agentSessionId), String(owner || ''), String(root || ''), String(permissionMode || 'ask'), JSON.stringify(entries), Math.max(0, Number(turnCount) || 0), contextJson]
    );
    return entries;
}

/** 该用户在该根目录下最近一次有转录的 agentSessionId；浏览器换了标签页/端口后重选同一目录时据此接上。 */
async function findLatestSessionId(owner, root) {
    await ensureReady();
    const row = await get(
        `SELECT agent_session_id FROM agent_session_transcripts
         WHERE owner = ? AND root = ? AND transcript <> '[]'
         ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
        [String(owner || ''), String(root || '')]
    );
    return row ? row.agent_session_id : '';
}

async function remove(agentSessionId) {
    await ensureReady();
    await run('DELETE FROM agent_session_transcripts WHERE agent_session_id = ?', [String(agentSessionId || '')]);
}

/** 清理长期未用的转录（默认 30 天）。 */
async function prune(days = 30) {
    await ensureReady();
    const result = await run("DELETE FROM agent_session_transcripts WHERE updated_at < datetime('now', ?)", [`-${Math.max(1, Number(days) || 30)} days`]);
    return result.changes || 0;
}

module.exports = { ensureReady, load, save, findLatestSessionId, remove, prune, normalizeTranscript, mergeHistoryWithTranscript, MAX_ENTRIES, MAX_JSON_BYTES };
