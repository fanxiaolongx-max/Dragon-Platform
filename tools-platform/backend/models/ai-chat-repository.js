const { run, get, all } = require('./app-db');
const { v4: uuidv4 } = require('uuid');

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
const readyByDb = new Map();
const { getDbPath } = require('./app-db');

function buildId(prefix) {
    return `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
}

async function ensureReady() {
    const dbKey = getDbPath();
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

async function getOrCreateSession({ sessionId, pagePath, pageTitle, owner = '' }) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const cleanTitle = String(pageTitle || '').slice(0, 200);
    const cleanOwner = String(owner || '').slice(0, 120);
    if (sessionId) {
        const existing = await get('SELECT id FROM ai_chat_sessions WHERE id = ?', [sessionId]);
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
async function setSessionAgent(sessionId, { agentSessionId, root }) {
    await ensureReady();
    if (!sessionId || !agentSessionId || !root) return;
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

async function addMessage({ sessionId, pagePath, pageTitle, role, content, tokens = 0, cost = 0, events = null, owner = '' }) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const cleanTitle = String(pageTitle || '').slice(0, 200);
    const finalSessionId = await getOrCreateSession({ sessionId, pagePath: normalizedPath, pageTitle: cleanTitle, owner });
    const eventsJson = Array.isArray(events) && events.length ? JSON.stringify(events).slice(0, 400 * 1024) : '';
    await run(
        `INSERT INTO ai_chat_messages (id, session_id, page_path, page_title, role, content, tokens, cost, events)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            buildId('msg'),
            finalSessionId,
            normalizedPath,
            cleanTitle,
            role === 'model' ? 'model' : 'user',
            String(content || '').slice(0, 20000),
            Math.max(0, Number(tokens) || 0),
            Math.max(0, Number(cost) || 0),
            eventsJson.endsWith(']') ? eventsJson : '' // 超长被截断的 JSON 不保存
        ]
    );
    await run('UPDATE ai_chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [finalSessionId]);
    await autoArchiveSessions();
    return finalSessionId;
}

async function recordQuestion({ pagePath, question }) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const clean = cleanQuestion(question);
    const key = normalizeQuestion(clean);
    if (!clean || isInvalidQuestion(clean) || key.length < 2) return null;
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
         (id, page_path, normalized_key, question, source, hit_count)
         VALUES (?, ?, ?, ?, 'history', 1)`,
        [id, normalizedPath, key, clean]
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

async function setSessionArchived(sessionId, archived = true) {
    await ensureReady();
    await run(`
        UPDATE ai_chat_sessions
        SET is_archived = ?,
            archived_at = CASE WHEN ? = 1 THEN COALESCE(archived_at, CURRENT_TIMESTAMP) ELSE NULL END,
            updated_at = CASE WHEN ? = 1 THEN updated_at ELSE CURRENT_TIMESTAMP END
        WHERE id = ?
    `, [archived ? 1 : 0, archived ? 1 : 0, archived ? 1 : 0, sessionId]);
    return getSession(sessionId);
}

async function listSuggestions({ pagePath, limit = 8 } = {}) {
    await ensureReady();
    const normalizedPath = normalizePagePath(pagePath);
    const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 12));
    const rows = await all(
        `SELECT id, question, source, hit_count, last_used_at
         FROM ai_question_suggestions
         WHERE enabled = 1 AND (page_path = ? OR page_path = '*')
         ORDER BY page_path = ? DESC, hit_count DESC, last_used_at DESC
         LIMIT ?`,
        [normalizedPath, normalizedPath, safeLimit]
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

async function listSessions({ pagePath, limit = 20 } = {}) {
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
         WHERE s.page_path = ? AND s.is_archived = 0
         GROUP BY s.id
         HAVING message_count > 0
         ORDER BY s.updated_at DESC, s.rowid DESC
         LIMIT ?`,
        [normalizedPath, safeLimit]
    );
    return rows.map(row => ({
        ...row,
        last_question: String(row.last_question || '').slice(0, 120)
    }));
}

async function listArchivedSessions({ query = '', limit = 60, offset = 0, archivedOnly = false, status = 'all' } = {}) {
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

    const filterSql = cleanQuery
        ? `AND (s.page_title LIKE ? OR s.page_path LIKE ? OR EXISTS (
              SELECT 1 FROM ai_chat_messages sm
              WHERE sm.session_id = s.id AND sm.content LIKE ?
          ))`
        : '';
    const params = cleanQuery ? [pattern, pattern, pattern] : [];
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

async function listMessages(sessionId) {
    await ensureReady();
    return all(
        `SELECT id, session_id, role, content, tokens, cost, created_at, events
         FROM ai_chat_messages
         WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC`,
        [sessionId]
    ).then(rows => rows.map(row => {
        let events = [];
        try { events = row.events ? JSON.parse(row.events) : []; } catch (_error) { events = []; }
        return { ...row, events };
    }));
}

async function getSession(sessionId) {
    await ensureReady();
    if (!sessionId) return null;
    return get(
        `SELECT id, page_path, page_title, summary, summary_until_message_id, summary_updated_at,
                is_archived, archived_at, created_at, updated_at
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
        `SELECT id, role, content, created_at
         FROM ai_chat_messages
         WHERE session_id = ?
         ORDER BY rowid DESC
         LIMIT ?`,
        [sessionId, safeLimit]
    );
    return rows.reverse();
}

module.exports = {
    ensureReady,
    getOrCreateSession,
    setSessionAgent,
    listOwnedSessions,
    addMessage,
    recordQuestion,
    listSuggestions,
    listSessions,
    listArchivedSessions,
    listMessages,
    getSession,
    setSessionArchived,
    autoArchiveSessions,
    getMessagesForCompression,
    updateSessionSummary,
    getRecentMessagesForContext,
    normalizePagePath
};
