const { run, get, all } = require('./app-db');
const { v4: uuidv4 } = require('uuid');
const { redactText, redactValue } = require('./ai-sensitive-data');

const RECENT_CONTEXT_MESSAGES = 8;
const MAX_ACTIVE_SESSIONS_PER_PAGE = 30;
const AUTO_ARCHIVE_AFTER_DAYS = 30;
const DEFAULT_QUESTIONS = [
    '这个页面主要看什么？',
    '当前有哪些关键指标？',
    '哪些指标未达标？',
    'GAP分别是多少？',
    '今天导入了多少文件？',
    '最近规则有没有变化？'
];

// 每个租户是独立的数据库文件：建表要按数据库各做一次（只做一次会让第二个租户缺表）
const readyByDb = new WeakMap();
const { getDatabase } = require('./app-db');

function buildId(prefix) {
    return `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
}

async function ensureReady() {
    const dbKey = getDatabase();
    let initPromise = readyByDb.get(dbKey);
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS ai_chat_sessions (
                    id TEXT PRIMARY KEY,
                    page_path TEXT NOT NULL DEFAULT '',
                    page_title TEXT NOT NULL DEFAULT '',
                    summary TEXT NOT NULL DEFAULT '',
                    summary_until_message_id TEXT NOT NULL DEFAULT '',
                    summary_updated_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await addColumnIfMissing('ai_chat_sessions', 'summary', "TEXT NOT NULL DEFAULT ''");
            await addColumnIfMissing('ai_chat_sessions', 'summary_until_message_id', "TEXT NOT NULL DEFAULT ''");
            await addColumnIfMissing('ai_chat_sessions', 'summary_updated_at', 'DATETIME');
            await addColumnIfMissing('ai_chat_sessions', 'is_archived', 'INTEGER NOT NULL DEFAULT 0');
            await addColumnIfMissing('ai_chat_sessions', 'archived_at', 'DATETIME');
            // 会话归属与工作区：/session 只列出自己的会话，恢复时自动选回当时的目录
            await addColumnIfMissing('ai_chat_sessions', 'owner', "TEXT NOT NULL DEFAULT ''");
            await addColumnIfMissing('ai_chat_sessions', 'agent_session_id', "TEXT NOT NULL DEFAULT ''");
            await addColumnIfMissing('ai_chat_sessions', 'agent_root', "TEXT NOT NULL DEFAULT ''");
            await run(`
                CREATE TABLE IF NOT EXISTS ai_chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    page_path TEXT NOT NULL DEFAULT '',
                    page_title TEXT NOT NULL DEFAULT '',
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    tokens INTEGER DEFAULT 0,
                    cost REAL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            await run(`
                CREATE TABLE IF NOT EXISTS ai_question_suggestions (
                    id TEXT PRIMARY KEY,
                    page_path TEXT NOT NULL DEFAULT '',
                    normalized_key TEXT NOT NULL DEFAULT '',
                    question TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'history',
                    hit_count INTEGER DEFAULT 0,
                    enabled INTEGER DEFAULT 1,
                    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(page_path, normalized_key)
                )
            `);
            // 工具调用、审批、命令输出等过程记录（JSON），恢复对话时重放成卡片
            await addColumnIfMissing('ai_chat_messages', 'events', "TEXT NOT NULL DEFAULT ''");
            await addColumnIfMissing('ai_chat_messages', 'agent_final', 'INTEGER NOT NULL DEFAULT 0');
            // 每条回复的输入 / 输出 Token 与模型名：消息下方展示本次消耗（旧行为 0 / 空，界面不显示）
            await addColumnIfMissing('ai_chat_messages', 'input_tokens', 'INTEGER NOT NULL DEFAULT 0');
            await addColumnIfMissing('ai_chat_messages', 'output_tokens', 'INTEGER NOT NULL DEFAULT 0');
            await addColumnIfMissing('ai_chat_messages', 'model_name', "TEXT NOT NULL DEFAULT ''");
            await addColumnIfMissing('ai_question_suggestions', 'owner', "TEXT NOT NULL DEFAULT ''");
            await run('CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session ON ai_chat_messages(session_id, created_at)');
            await run('CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_page ON ai_chat_sessions(page_path, updated_at)');
            await run('CREATE INDEX IF NOT EXISTS idx_ai_chat_sessions_archive ON ai_chat_sessions(is_archived, archived_at, updated_at)');
            await run('CREATE INDEX IF NOT EXISTS idx_ai_question_suggestions_page ON ai_question_suggestions(page_path, enabled, hit_count, last_used_at)');
        })().catch(err => {
            readyByDb.delete(dbKey);
            throw err;
        });
        readyByDb.set(dbKey, initPromise);
    }
    return initPromise;
}

async function addColumnIfMissing(tableName, columnName, definition) {
    const rows = await all(`PRAGMA table_info(${tableName})`);
    if (rows.some(row => row.name === columnName)) return;
    await run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function normalizePagePath(value) {
    const raw = String(value || '').trim();
    try {
        if (/^https?:\/\//i.test(raw)) {
            const parsed = new URL(raw);
            return parsed.pathname || '/';
        }
    } catch {
        // Fall back to lightweight string cleanup below.
    }
    return raw.split('?')[0].split('#')[0].trim() || '/';
}

function normalizeQuestion(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[，。！？、,.!?;；:："'“”‘’()[\]{}<>《》\s]/g, '')
        .replace(/分别|具体|一下|请问|帮我|看看|看下/g, '')
        .replace(/差距|gap/g, 'gap')
        .replace(/未达标|不达标|不满足目标|没达标/g, '未达标')
        .slice(0, 120);
}

function cleanQuestion(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}

function isInvalidQuestion(value) {
    return /^\[object\s+\w+Event\]$/i.test(String(value || '').trim());
}

function forbiddenSession() {
    return Object.assign(new Error('无权访问该对话'), { code: 'AI_SESSION_FORBIDDEN', statusCode: 403 });
}

// 不猜测旧共享会话的所有者，也不因为调用者知道 ID 就允许认领或追加。
async function assertSessionOwner(sessionId, owner) {
    await ensureReady();
    const row = await get('SELECT id, owner FROM ai_chat_sessions WHERE id = ?', [sessionId]);
    if (row && row.owner !== String(owner || '')) throw forbiddenSession();
    return row;
}

async function getOrCreateSession({ sessionId, pagePath, pageTitle, owner = '' }) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const cleanTitle = String(pageTitle || '').slice(0, 200);
    const cleanOwner = String(owner || '').slice(0, 120);
    if (sessionId) {
        const existing = await assertSessionOwner(sessionId, cleanOwner);
        if (existing) {
            await run(
                `UPDATE ai_chat_sessions
                 SET page_path = ?, page_title = ?, is_archived = 0, archived_at = NULL, updated_at = CURRENT_TIMESTAMP,
                     owner = CASE WHEN owner = '' THEN ? ELSE owner END
                 WHERE id = ?`,
                [normalizedPath, cleanTitle, cleanOwner, sessionId]
            );
            return sessionId;
        }
    }
    const id = buildId('chat');
    await run(
        `INSERT INTO ai_chat_sessions (id, page_path, page_title, owner)
         VALUES (?, ?, ?, ?)`,
        [id, normalizedPath, cleanTitle, cleanOwner]
    );
    return id;
}

/** 记录该对话最近使用的工作区智能体会话与目录 */
async function setSessionAgent(sessionId, { agentSessionId, root, owner }) {
    await ensureReady();
    if (!sessionId || !agentSessionId || !root) return;
    if (owner !== undefined) await assertSessionOwner(sessionId, owner);
    await run('UPDATE ai_chat_sessions SET agent_session_id = ?, agent_root = ? WHERE id = ?', [String(agentSessionId).slice(0, 100), String(root).slice(0, 1000), sessionId]);
}

/**
 * /session：列出某用户在某页面（Dragon Claw 为 "/"）的会话，含已自动归档的，按最近更新排序。
 * query 匹配会话内任意问题或回答。
 */
async function listOwnedSessions({ owner, pagePath, query = '', limit = 30, offset = 0 } = {}) {
    await ensureReady();
    if (!owner) return [];
    const normalizedPath = normalizePagePath(pagePath);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const keyword = String(query || '').trim().slice(0, 100);
    const params = [owner, normalizedPath];
    let filter = '';
    if (keyword) {
        filter = 'AND EXISTS (SELECT 1 FROM ai_chat_messages q WHERE q.session_id = s.id AND q.content LIKE ?)';
        params.push(`%${keyword.replace(/[%_\\]/g, '')}%`); // 去掉通配符，按普通文本匹配
    }
    params.push(safeLimit, safeOffset);
    const rows = await all(
        `SELECT s.id, s.created_at, s.updated_at, s.is_archived, s.agent_session_id, s.agent_root,
                (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id) AS message_count,
                (SELECT content FROM ai_chat_messages f WHERE f.session_id = s.id AND f.role = 'user' ORDER BY f.created_at ASC, f.rowid ASC LIMIT 1) AS first_question,
                (SELECT content FROM ai_chat_messages l WHERE l.session_id = s.id AND l.role = 'user' ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1) AS last_question
         FROM ai_chat_sessions s
         WHERE s.owner = ? AND s.page_path = ? ${filter}
           AND EXISTS (SELECT 1 FROM ai_chat_messages e WHERE e.session_id = s.id)
         ORDER BY s.updated_at DESC, s.rowid DESC
         LIMIT ? OFFSET ?`,
        params
    );
    return rows.map(row => ({
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archived: Boolean(row.is_archived),
        messageCount: Number(row.message_count) || 0,
        firstQuestion: String(row.first_question || '').slice(0, 160),
        lastQuestion: String(row.last_question || '').slice(0, 160),
        agent: row.agent_session_id && row.agent_root ? { agentSessionId: row.agent_session_id, root: row.agent_root } : null
    }));
}

const tokenCount = value => Math.max(0, Math.round(Number(value) || 0));

async function addMessage({ sessionId, pagePath, pageTitle, role, content, tokens = 0, cost = 0, events = null, owner = '', inputTokens = 0, outputTokens = 0, modelName = '' }) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const cleanTitle = String(pageTitle || '').slice(0, 200);
    const finalSessionId = await getOrCreateSession({ sessionId, pagePath: normalizedPath, pageTitle: cleanTitle, owner });
    const eventsJson = Array.isArray(events) && events.length ? JSON.stringify(redactValue(events)) : '';
    await run(
        `INSERT INTO ai_chat_messages (id, session_id, page_path, page_title, role, content, tokens, cost, events, input_tokens, output_tokens, model_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            buildId('msg'),
            finalSessionId,
            normalizedPath,
            cleanTitle,
            role === 'model' ? 'model' : 'user',
            redactText(content || ''),
            Math.max(0, Number(tokens) || 0),
            Math.max(0, Number(cost) || 0),
            eventsJson,
            tokenCount(inputTokens),
            tokenCount(outputTokens),
            String(modelName || '').slice(0, 120)
        ]
    );
    await run('UPDATE ai_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [finalSessionId]);
    await autoArchiveSessions();
    return finalSessionId;
}

// runId 生成稳定消息 ID；检查点更新同一对消息，正常结束或恢复不会重复追加。
async function upsertAgentTurn({ sessionId, owner, runId, agentSessionId, root, transcript = [], content, events, tokens = 0, cost = 0, final = false, inputTokens = 0, outputTokens = 0, modelName = '' }) {
    await ensureReady();
    const session = await assertSessionOwner(sessionId, owner);
    if (!session) throw forbiddenSession();
    const metadata = await get('SELECT page_path, page_title FROM ai_chat_sessions WHERE id = ?', [sessionId]);
    const generatedEvents = [];
    for (const entry of transcript) {
        for (const call of entry.toolCalls || []) generatedEvents.push({ type: 'tool_start', callId: call.id, tool: call.name, args: call.args });
        for (const result of entry.toolResults || []) generatedEvents.push({ type: 'tool_result', callId: result.id, tool: result.name, ok: !result.isError,
            summary: result.isError ? String(result.content).slice(0, 160) : '已保存执行结果', ...(result.name === 'run_command' ? { output: result.content } : {}) });
    }
    const question = transcript.find(entry => entry.role === 'user')?.content || '';
    const answer = content ?? transcript.filter(entry => entry.role === 'model' && entry.content).map(entry => entry.content).join('\n\n');
    for (const role of ['user', 'model']) {
        const text = role === 'user' ? question : answer;
        const savedEvents = role === 'model' ? events || generatedEvents : [];
        const id = `agent_${runId}_${role}`;
        const existing = await get('SELECT session_id FROM ai_chat_messages WHERE id = ?', [id]);
        if (existing && existing.session_id !== sessionId) throw forbiddenSession();
        const model = role === 'model';
        await run(`INSERT INTO ai_chat_messages (id, session_id, page_path, page_title, role, content, tokens, cost, events, agent_final, input_tokens, output_tokens, model_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET content = excluded.content, tokens = excluded.tokens, cost = excluded.cost,
                events = excluded.events, agent_final = excluded.agent_final, input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens, model_name = excluded.model_name
            WHERE ai_chat_messages.session_id = excluded.session_id AND ai_chat_messages.agent_final = 0`,
        [id, sessionId, metadata.page_path, metadata.page_title, role, redactText(text), model ? tokens : 0,
            model ? cost : 0, JSON.stringify(redactValue(savedEvents)), Number(final),
            model ? tokenCount(inputTokens) : 0, model ? tokenCount(outputTokens) : 0, model ? String(modelName || '').slice(0, 120) : '']);
    }
    await setSessionAgent(sessionId, { agentSessionId, root, owner });
}

async function recordQuestion({ pagePath, question, owner } = {}) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const clean = cleanQuestion(redactText(question));
    const normalizedKey = normalizeQuestion(clean);
    const key = owner !== undefined ? `${encodeURIComponent(String(owner))}::${normalizedKey}` : normalizedKey;
    if (!clean || isInvalidQuestion(clean) || normalizedKey.length < 2) return null;
    const existing = await get(
        `SELECT id, question, hit_count
         FROM ai_question_suggestions
         WHERE page_path = ? AND normalized_key = ?`,
        [normalizedPath, key]
    );
    if (existing) {
        await run(
            `UPDATE ai_question_suggestions
             SET hit_count = hit_count + 1,
                 question = CASE WHEN length(question) > length(?) THEN question ELSE ? END,
                 last_used_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [clean, clean, existing.id]
        );
        return existing.id;
    }
    const id = buildId('suggest');
    await run(
        `INSERT INTO ai_question_suggestions
         (id, page_path, normalized_key, question, source, hit_count, owner)
         VALUES (?, ?, ?, ?, 'history', 1, ?)`,
        [id, normalizedPath, key, clean, String(owner || '')]
    );
    return id;
}

async function autoArchiveSessions() {
    const ageModifier = `-${AUTO_ARCHIVE_AFTER_DAYS} days`;
    await run(`
        UPDATE ai_chat_sessions
        SET is_archived = 1, archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
        WHERE is_archived = 0
          AND updated_at < datetime('now', ?)
    `, [ageModifier]);
    const pages = await all(`SELECT DISTINCT page_path FROM ai_chat_sessions WHERE is_archived = 0`);
    for (const page of pages) {
        await run(`
            UPDATE ai_chat_sessions
            SET is_archived = 1, archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
            WHERE id IN (
                SELECT id FROM ai_chat_sessions
                WHERE page_path = ? AND is_archived = 0
                ORDER BY updated_at DESC, rowid DESC
                LIMIT -1 OFFSET ?
            )
        `, [page.page_path, MAX_ACTIVE_SESSIONS_PER_PAGE]);
    }
}

async function setSessionArchived(sessionId, archived = true, { owner } = {}) {
    await ensureReady();
    if (owner !== undefined) await assertSessionOwner(sessionId, owner);
    await run(`
        UPDATE ai_chat_sessions
        SET is_archived = ?,
            archived_at = CASE WHEN ? = 1 THEN COALESCE(archived_at, CURRENT_TIMESTAMP) ELSE NULL END,
            updated_at = CASE WHEN ? = 1 THEN updated_at ELSE CURRENT_TIMESTAMP END
        WHERE id = ?
    `, [archived ? 1 : 0, archived ? 1 : 0, archived ? 1 : 0, sessionId]);
    return getSession(sessionId);
}

async function deleteSession(sessionId, { owner } = {}) {
    await ensureReady();
    if (!owner) throw forbiddenSession();
    if (!await assertSessionOwner(sessionId, owner)) return false;
    // Triggers keep the session and its private transcript deletion atomic on
    // this tenant's connection, without an interleavable BEGIN/COMMIT block.
    await run(`CREATE TRIGGER IF NOT EXISTS ai_chat_delete_messages AFTER DELETE ON ai_chat_sessions
        BEGIN DELETE FROM ai_chat_messages WHERE session_id=OLD.id; END`);
    const tables = new Set((await all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('desktop_agent_discussion_runs','desktop_agent_discussions')")).map(row => row.name));
    if (tables.has('desktop_agent_discussion_runs')) {
        await run(`CREATE TRIGGER IF NOT EXISTS ai_chat_delete_discussion_runs BEFORE DELETE ON ai_chat_sessions BEGIN
            SELECT RAISE(ABORT,'AI_CHAT_BUSY') WHERE EXISTS(SELECT 1 FROM desktop_agent_discussion_runs WHERE session_id=OLD.id AND status IN ('queued','running'));
            DELETE FROM desktop_agent_discussion_runs WHERE session_id=OLD.id;
        END`);
    }
    if (tables.has('desktop_agent_discussions')) {
        await run(`CREATE TRIGGER IF NOT EXISTS ai_chat_delete_discussion_settings AFTER DELETE ON ai_chat_sessions
            BEGIN DELETE FROM desktop_agent_discussions WHERE session_id=OLD.id; END`);
    }
    if (await get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_list_preferences'")) {
        await run(`CREATE TRIGGER IF NOT EXISTS ai_chat_delete_list_preference AFTER DELETE ON ai_chat_sessions
            BEGIN DELETE FROM conversation_list_preferences WHERE source='mine' AND item_id=OLD.id AND owner=OLD.owner; END`);
    }
    try {
        return (await run('DELETE FROM ai_chat_sessions WHERE id=? AND owner=?', [sessionId, owner])).changes > 0;
    } catch (error) {
        if (error.message.includes('AI_CHAT_BUSY')) throw Object.assign(new Error('讨论正在进行，请先停止或等待结束再删除'), { code: 'AI_CHAT_BUSY', statusCode: 409 });
        throw error;
    }
}

async function listSuggestions({ pagePath, limit = 8, owner } = {}) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 12));
    const rows = await all(
        `SELECT id, question, source, hit_count, last_used_at
         FROM ai_question_suggestions
         WHERE enabled = 1 AND (page_path = ? OR page_path = '*')
         ${owner !== undefined ? "AND (source <> 'history' OR owner = ?)" : ''}
         ORDER BY page_path = ? DESC, hit_count DESC, last_used_at DESC
         LIMIT ?`,
        [normalizedPath, ...(owner !== undefined ? [String(owner)] : []), normalizedPath, safeLimit]
    );
    const seen = new Set();
    const items = [];
    rows.forEach(row => {
        if (isInvalidQuestion(row.question)) return;
        const key = normalizeQuestion(row.question);
        if (seen.has(key)) return;
        seen.add(key);
        items.push(row);
    });
    DEFAULT_QUESTIONS.forEach(question => {
        if (items.length >= safeLimit) return;
        const key = normalizeQuestion(question);
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
            id: `default:${key}`,
            question,
            source: 'default',
            hit_count: 0,
            last_used_at: null
        });
    });
    return items;
}

async function listSessions({ pagePath, limit = 20, owner } = {}) {
    await ensureReady();
    await autoArchiveSessions();
    const normalizedPath = normalizePagePath(pagePath);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    const rows = await all(
        `SELECT s.id, s.page_path, s.page_title, s.created_at, s.updated_at,
                COUNT(m.id) AS message_count,
                (
                    SELECT content
                    FROM ai_chat_messages um
                    WHERE um.session_id = s.id AND um.role = 'user'
                    ORDER BY um.created_at DESC, um.rowid DESC
                    LIMIT 1
                ) AS last_question
         FROM ai_chat_sessions s
         LEFT JOIN ai_chat_messages m ON m.session_id = s.id
         WHERE s.page_path = ? AND s.is_archived = 0 ${owner !== undefined ? 'AND s.owner = ?' : ''}
         GROUP BY s.id
         HAVING message_count > 0
         ORDER BY s.updated_at DESC, s.rowid DESC
         LIMIT ?`,
        [normalizedPath, ...(owner !== undefined ? [String(owner)] : []), safeLimit]
    );
    return rows.map(row => ({
        ...row,
        last_question: String(row.last_question || '').slice(0, 120)
    }));
}

async function listArchivedSessions({ query = '', limit = 60, offset = 0, archivedOnly = false, status = 'all', owner } = {}) {
    await ensureReady();
    await autoArchiveSessions();
    const safeLimit = Math.max(1, Math.min(Number(limit) || 60, 200));
    const safeOffset = Math.max(0, Number(offset) || 0);
    const cleanQuery = String(query || '').trim().slice(0, 120);
    const pattern = `%${cleanQuery}%`;

    const isArchivedOnly = archivedOnly === true || archivedOnly === 'true' || archivedOnly === '1' || status === 'archived';
    const isActiveOnly = status === 'active';

    let statusSql = '';
    if (isArchivedOnly) {
        statusSql = 'AND s.is_archived = 1';
    } else if (isActiveOnly) {
        statusSql = 'AND s.is_archived = 0';
    }

    const querySql = cleanQuery
        ? `AND (s.page_title LIKE ? OR s.page_path LIKE ? OR EXISTS (
              SELECT 1 FROM ai_chat_messages sm
              WHERE sm.session_id = s.id AND sm.content LIKE ?
          ))`
        : '';
    const filterSql = `${owner !== undefined ? 'AND s.owner = ?' : ''} ${querySql}`;
    const params = [...(owner !== undefined ? [String(owner)] : []), ...(cleanQuery ? [pattern, pattern, pattern] : [])];
    const totalRow = await get(
        `SELECT COUNT(1) AS count
         FROM ai_chat_sessions s
         WHERE EXISTS (SELECT 1 FROM ai_chat_messages m WHERE m.session_id = s.id)
           ${statusSql}
           ${filterSql}`,
        params
    );
    const rows = await all(
        `SELECT s.id, s.page_path, s.page_title, s.is_archived, s.created_at, s.updated_at, s.archived_at,
                COUNT(m.id) AS message_count,
                (
                    SELECT content FROM ai_chat_messages um
                    WHERE um.session_id = s.id AND um.role = 'user'
                    ORDER BY um.created_at DESC, um.rowid DESC LIMIT 1
                ) AS last_question
         FROM ai_chat_sessions s
         JOIN ai_chat_messages m ON m.session_id = s.id
         WHERE 1=1 ${statusSql} ${filterSql}
         GROUP BY s.id
         ORDER BY s.updated_at DESC, s.rowid DESC
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, safeOffset]
    );
    return {
        total: Number(totalRow?.count) || 0,
        items: rows.map(row => ({
            ...row,
            is_archived: Number(row.is_archived) || 0,
            last_question: String(row.last_question || '').slice(0, 160)
        }))
    };
}

const MESSAGE_COLUMNS = 'id, session_id, role, content, tokens, cost, created_at, events, input_tokens, output_tokens, model_name';

function mapMessageRow(row) {
    let events = [];
    try { events = row.events ? JSON.parse(row.events) : []; } catch (_error) { events = []; }
    const { seq: _seq, ...rest } = row;
    return { ...rest, events };
}

async function listMessages(sessionId, { owner } = {}) {
    await ensureReady();
    if (owner !== undefined) await assertSessionOwner(sessionId, owner);
    if (owner !== undefined) await require('./agent-transcript-repository').syncChatSession(sessionId, `${require('./tenant-context').getTenantId()}::${owner}`);
    return all(
        `SELECT ${MESSAGE_COLUMNS}
         FROM ai_chat_messages
         WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC`,
        [sessionId]
    ).then(rows => rows.map(mapMessageRow));
}

/**
 * 分页读取历史消息（恢复对话时渐进加载）：返回 before 之前最近的 limit 条，按时间正序。
 * 游标为消息 id；排序键 (created_at, rowid) 与 listMessages 一致，同一秒写入的消息也不会漏或重。
 */
async function listMessagesPage(sessionId, { owner, limit = 30, before = '' } = {}) {
    await ensureReady();
    if (owner !== undefined) await assertSessionOwner(sessionId, owner);
    // 只在打开会话（第一页）时同步工作区转录，向上翻页不重复同步
    if (owner !== undefined && !before) await require('./agent-transcript-repository').syncChatSession(sessionId, `${require('./tenant-context').getTenantId()}::${owner}`);
    const size = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 30));
    let where = 'session_id = ?';
    const params = [sessionId];
    if (before) {
        const cursor = await get('SELECT created_at, rowid AS seq FROM ai_chat_messages WHERE id = ? AND session_id = ?', [String(before), sessionId]);
        if (!cursor) throw Object.assign(new Error('分页游标无效'), { statusCode: 400, code: 'AI_CHAT_CURSOR_INVALID' });
        where += ' AND (created_at < ? OR (created_at = ? AND rowid < ?))';
        params.push(cursor.created_at, cursor.created_at, cursor.seq);
    }
    const rows = await all(
        `SELECT ${MESSAGE_COLUMNS}, rowid AS seq FROM ai_chat_messages WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        [...params, size + 1]
    );
    const hasMore = rows.length > size;
    const total = (await get('SELECT COUNT(*) AS count FROM ai_chat_messages WHERE session_id = ?', [sessionId]))?.count || 0;
    return { items: rows.slice(0, size).reverse().map(mapMessageRow), hasMore, total };
}

async function getSession(sessionId) {
    await ensureReady();
    if (!sessionId) return null;
    return get(
        `SELECT id, page_path, page_title, summary, summary_until_message_id, summary_updated_at,
                is_archived, archived_at, created_at, updated_at, agent_session_id, agent_root
         FROM ai_chat_sessions
         WHERE id = ?`,
        [sessionId]
    );
}

async function getMessagesForCompression(sessionId, keepRecent = RECENT_CONTEXT_MESSAGES) {
    await ensureReady();
    const session = await getSession(sessionId);
    if (!session) return { session: null, messages: [], cutoffMessageId: '' };
    const marker = session.summary_until_message_id || '';
    const markerRow = marker
        ? await get('SELECT rowid FROM ai_chat_messages WHERE id = ? AND session_id = ?', [marker, sessionId])
        : null;
    const markerRowid = markerRow ? markerRow.rowid : 0;
    const rows = await all(
        `SELECT id, rowid, role, content, created_at
         FROM ai_chat_messages
         WHERE session_id = ? AND rowid > ?
         ORDER BY rowid ASC`,
        [sessionId, markerRowid]
    );
    const compressibleCount = Math.max(0, rows.length - Math.max(2, keepRecent));
    const messages = rows.slice(0, compressibleCount);
    return {
        session,
        messages,
        cutoffMessageId: messages.length ? messages[messages.length - 1].id : ''
    };
}

async function updateSessionSummary(sessionId, { summary, summaryUntilMessageId }) {
    await ensureReady();
    await run(
        `UPDATE ai_chat_sessions
         SET summary = ?,
             summary_until_message_id = ?,
             summary_updated_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            String(summary || '').slice(0, 12000),
            summaryUntilMessageId || '',
            sessionId
        ]
    );
}

async function getRecentMessagesForContext(sessionId, limit = RECENT_CONTEXT_MESSAGES) {
    await ensureReady();
    const safeLimit = Math.max(2, Math.min(Number(limit) || RECENT_CONTEXT_MESSAGES, 20));
    const rows = await all(
        `SELECT id, role, content, events, created_at
         FROM ai_chat_messages
         WHERE session_id = ? AND rowid > COALESCE((
             SELECT rowid FROM ai_chat_messages WHERE id = (SELECT summary_until_message_id FROM ai_chat_sessions WHERE id = ?)
             AND session_id = ?), 0)
         ORDER BY rowid DESC
         LIMIT ?`,
        [sessionId, sessionId, sessionId, safeLimit]
    );
    return rows.reverse();
}

module.exports = {
    listMessagesPage,
    ensureReady,
    getOrCreateSession,
    setSessionAgent,
    listOwnedSessions,
    addMessage,
    upsertAgentTurn,
    recordQuestion,
    listSuggestions,
    listSessions,
    listArchivedSessions,
    listMessages,
    getSession,
    setSessionArchived,
    deleteSession,
    autoArchiveSessions,
    getMessagesForCompression,
    updateSessionSummary,
    getRecentMessagesForContext,
    normalizePagePath,
    assertSessionOwner
};
