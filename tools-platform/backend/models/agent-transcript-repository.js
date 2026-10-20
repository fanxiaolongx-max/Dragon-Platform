// Dragon Claw 工作区：智能体会话的工具调用转录持久化（租户库 agent_session_transcripts）。
// 转录 = 上几轮的 model(toolCalls) / tool(toolResults) / model(text) 消息，重启后同一 agentSessionId 仍能延续。
const { run, get, all } = require('./app-db');
const { redactValue } = require('./ai-sensitive-data');

const MAX_ENTRIES = 80; // 单轮最多 25 步（约 52 条），至少能完整保住一轮
const MAX_JSON_BYTES = 1.5 * 1024 * 1024;

// 每个租户是独立的数据库文件：建表要按数据库各做一次（只做一次会让第二个租户缺表）
const readyByDb = new WeakMap();
const { getDatabase } = require('./app-db');

function ensureReady() {
    const dbKey = getDatabase();
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
            await run('ALTER TABLE agent_session_transcripts ADD COLUMN compacted_through_rowid INTEGER NOT NULL DEFAULT 0').catch(error => {
                if (!/duplicate column/i.test(String(error.message))) throw error;
            });
            await run('CREATE INDEX IF NOT EXISTS idx_agent_session_transcripts_updated ON agent_session_transcripts(updated_at)');
            await run('CREATE INDEX IF NOT EXISTS idx_agent_session_transcripts_owner_root ON agent_session_transcripts(owner, root, updated_at)');
            await run(`CREATE TABLE IF NOT EXISTS agent_session_owners (
                agent_session_id TEXT PRIMARY KEY,
                owner TEXT NOT NULL
            )`);
            // 完整逐轮档案与模型的有限上下文分开保存，裁剪上下文不删除历史。
            await run(`CREATE TABLE IF NOT EXISTS agent_session_turns (
                run_id TEXT PRIMARY KEY,
                agent_session_id TEXT NOT NULL,
                owner TEXT NOT NULL,
                root TEXT NOT NULL,
                transcript TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'running',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_agent_turns_session ON agent_session_turns(agent_session_id, created_at)');
            await run("ALTER TABLE agent_session_turns ADD COLUMN recovery TEXT NOT NULL DEFAULT '{}'").catch(error => {
                if (!/duplicate column/i.test(String(error.message))) throw error;
            });
            await run("ALTER TABLE agent_session_turns ADD COLUMN chat_session_id TEXT NOT NULL DEFAULT ''").catch(error => {
                if (!/duplicate column/i.test(String(error.message))) throw error;
            });
            await run('CREATE INDEX IF NOT EXISTS idx_agent_turns_chat ON agent_session_turns(owner, chat_session_id)');
        })().catch(error => {
            readyByDb.delete(dbKey);
            throw error;
        });
        readyByDb.set(dbKey, initPromise);
    }
    return initPromise;
}

// 在执行任何工具之前原子保留会话归属；两个进程同时收到同一新 ID 时也只能有一个用户成功。
async function claimSession(agentSessionId, owner) {
    await ensureReady();
    await run('INSERT OR IGNORE INTO agent_session_owners (agent_session_id, owner) VALUES (?, ?)', [String(agentSessionId), String(owner)]);
    const record = await get('SELECT owner FROM agent_session_owners WHERE agent_session_id = ?', [String(agentSessionId)]);
    if (record?.owner !== owner) throw Object.assign(new Error('无权访问该智能体会话'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
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
        // 最新一轮即使较大也必须保留，后续请求由上下文预算控制；不能静默变成空转录。
        if (kept.length && (count + turns[index].length > MAX_ENTRIES || bytes + size > MAX_JSON_BYTES)) break;
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
        'SELECT agent_session_id, owner, root, permission_mode, transcript, turn_count, context, updated_at, compacted_through_rowid FROM agent_session_transcripts WHERE agent_session_id = ?',
        [String(agentSessionId || '')]
    );
    const latest = await get('SELECT *, rowid AS sequence FROM agent_session_turns WHERE agent_session_id = ? ORDER BY rowid DESC LIMIT 1', [String(agentSessionId || '')]);
    if (!row && !latest) return null;
    let transcript = [];
    try {
        transcript = normalizeTranscript(JSON.parse(row?.transcript || '[]'));
    } catch (_error) {
        transcript = [];
    }
    let context = null;
    try {
        context = row?.context ? JSON.parse(row.context) : null;
    } catch (_error) {
        context = null;
    }
    let recovery = {};
    try { recovery = JSON.parse(latest?.recovery || '{}'); } catch (_error) { /* legacy archive */ }
    if (latest && latest.sequence > Number(row?.compacted_through_rowid || 0) && (recovery.version === 1 || !row || latest.status === 'running')) {
        if (row && row.owner !== latest.owner) throw Object.assign(new Error('会话档案归属不一致'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
        const archived = JSON.parse(latest.transcript || '[]');
        const prior = recovery.version === 1 ? recovery.priorTranscript : transcript;
        const count = Number(recovery.priorTurnCount ?? row?.turn_count ?? 0) + (latest.status === 'completed' ? 1 : 0);
        return { agentSessionId: latest.agent_session_id, owner: latest.owner, root: latest.root,
            permissionMode: recovery.permissionMode || row?.permission_mode || 'ask',
            transcript: normalizeTranscript(restoreInterruptedTranscript([...(prior || []), ...archived], latest.status)),
            turnCount: count, context: row && row.turn_count === count ? context : null, updatedAt: latest.updated_at };
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

// 没有持久结果的调用不能断言“未执行”：进程可能在副作用发生后、保存结果前退出。
function restoreInterruptedTranscript(entries, status) {
    const restored = [];
    for (let index = 0; index < entries.length; index++) {
        const entry = sanitizeEntry(entries[index]);
        if (!entry || entry.role === 'tool') continue;
        restored.push(entry);
        if (!entry.toolCalls?.length) continue;
        const next = entries[index + 1];
        const results = next?.role === 'tool' ? next.toolResults || [] : [];
        if (next?.role === 'tool') index += 1;
        restored.push({ role: 'tool', toolResults: entry.toolCalls.map(call => results.find(item => item.id === call.id) || {
            id: call.id, name: call.name, isError: true,
            content: '操作状态未知：上次进程可能在执行前或执行后中断。请先检查实际状态，不能把缺失结果当作未执行，也不要直接重复写入、提交或外部请求。'
        }) });
    }
    if (status === 'running') restored.push({ role: 'model', content: '（上次运行没有结束记录，已恢复保存的步骤；无结果的操作状态未知，后续先核实实际状态。）' });
    return restored;
}

async function saveTurn({ runId, agentSessionId, owner, root, transcript, status = 'running', recovery = {} }) {
    await claimSession(agentSessionId, owner);
    const entries = redactValue((Array.isArray(transcript) ? transcript : []).map(sanitizeEntry).filter(Boolean));
    await run(`INSERT INTO agent_session_turns (run_id, agent_session_id, owner, root, transcript, status, recovery, chat_session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET transcript = excluded.transcript, status = excluded.status, updated_at = CURRENT_TIMESTAMP
        WHERE agent_session_turns.owner = excluded.owner AND agent_session_turns.agent_session_id = excluded.agent_session_id`,
    [runId, agentSessionId, owner, root, JSON.stringify(entries), status, JSON.stringify(redactValue(recovery)), recovery.chatSessionId || '']);
    if (recovery.chatSessionId) await syncChatTurn({ run_id: runId, agent_session_id: agentSessionId, owner, root, transcript: JSON.stringify(entries), status, recovery: JSON.stringify(recovery) });
}

async function syncChatTurn(row) {
    const recovery = JSON.parse(row.recovery || '{}');
    if (!recovery.chatSessionId || !recovery.chatOwner) return;
    await require('./ai-chat-repository').upsertAgentTurn({ sessionId: recovery.chatSessionId, owner: recovery.chatOwner,
        runId: row.run_id, agentSessionId: row.agent_session_id, root: row.root,
        transcript: restoreInterruptedTranscript(JSON.parse(row.transcript), row.status) });
}

async function syncChatSession(sessionId, owner) {
    await ensureReady();
    const rows = await all(`SELECT * FROM agent_session_turns t WHERE owner = ? AND chat_session_id = ?
        AND NOT EXISTS (SELECT 1 FROM ai_chat_messages m WHERE m.id = 'agent_' || t.run_id || '_model' AND m.agent_final = 1)
        ORDER BY rowid`, [owner, sessionId]);
    for (const row of rows) {
        let recovery = {};
        try { recovery = JSON.parse(row.recovery || '{}'); } catch (_error) { continue; }
        if (recovery.chatSessionId === sessionId) await syncChatTurn(row);
    }
}

async function listTurns({ agentSessionId, owner, root, limit = 5, offset = 0 }) {
    await ensureReady();
    const record = await get('SELECT owner FROM agent_session_owners WHERE agent_session_id = ?', [agentSessionId]);
    if (!record || record.owner !== owner) throw Object.assign(new Error('无权访问该智能体会话'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
    const size = Math.min(20, Math.max(1, Math.floor(Number(limit)) || 5));
    const skip = Math.max(0, Math.floor(Number(offset)) || 0);
    const rows = await all(`SELECT run_id, transcript, status, created_at FROM agent_session_turns
        WHERE agent_session_id = ? AND owner = ? AND root = ? ORDER BY rowid DESC LIMIT ? OFFSET ?`, [agentSessionId, owner, root, size, skip]);
    return rows.map(row => ({ runId: row.run_id, status: row.status, createdAt: row.created_at, transcript: JSON.parse(row.transcript) }));
}

async function save({ agentSessionId, owner, root, permissionMode, transcript, turnCount, context = null }) {
    await ensureReady();
    const existing = await load(agentSessionId);
    if (existing && existing.owner !== owner) throw Object.assign(new Error('无权覆盖该智能体会话'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
    await claimSession(agentSessionId, owner);
    const entries = normalizeTranscript(redactValue(transcript));
    const contextJson = context && typeof context === 'object' ? JSON.stringify(context).slice(0, 64 * 1024) : '';
    const result = await run(
        `INSERT INTO agent_session_transcripts (agent_session_id, owner, root, permission_mode, transcript, turn_count, context, compacted_through_rowid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_session_id) DO UPDATE SET
             owner = excluded.owner,
             root = excluded.root,
             permission_mode = excluded.permission_mode,
             transcript = excluded.transcript,
             turn_count = excluded.turn_count,
             context = excluded.context,
             compacted_through_rowid = MAX(agent_session_transcripts.compacted_through_rowid, excluded.compacted_through_rowid),
             updated_at = CURRENT_TIMESTAMP
         WHERE agent_session_transcripts.owner = excluded.owner`,
        [String(agentSessionId), String(owner || ''), String(root || ''), String(permissionMode || 'ask'), JSON.stringify(entries), Math.max(0, Number(turnCount) || 0), contextJson, 0]
    );
    if (!result.changes) throw Object.assign(new Error('无权覆盖该智能体会话'), { code: 'AGENT_SESSION_FORBIDDEN', statusCode: 403 });
    return entries;
}

/** 该用户在该根目录下最近一次有转录的 agentSessionId；浏览器换了标签页/端口后重选同一目录时据此接上。 */
async function findLatestSessionId(owner, root) {
    await ensureReady();
    const row = await get(
        `SELECT agent_session_id FROM (
            SELECT agent_session_id, updated_at, rowid AS sequence FROM agent_session_transcripts WHERE owner = ? AND root = ? AND transcript <> '[]'
            UNION ALL SELECT agent_session_id, updated_at, rowid AS sequence FROM agent_session_turns WHERE owner = ? AND root = ? AND transcript <> '[]'
         ) ORDER BY updated_at DESC, sequence DESC LIMIT 1`,
        [String(owner || ''), String(root || ''), String(owner || ''), String(root || '')]
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

module.exports = { ensureReady, claimSession, load, save, saveTurn, listTurns, syncChatSession, findLatestSessionId, remove, prune, normalizeTranscript, mergeHistoryWithTranscript, MAX_ENTRIES, MAX_JSON_BYTES };
