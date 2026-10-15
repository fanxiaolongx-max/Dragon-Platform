// 频道会话、联系人/群组目标与收发日志（当前租户 tools.db）。
// - channel_sessions：SDK 的 toolSessionId 与发起人、群组、DragonClaw 会话的映射；
// - channel_targets：出现过的人员与群组，按最近活跃排序，供黑白名单与推送范围选择；
//   只有带可用 toolSessionId 的目标才能主动推送（人员需与助理单聊过，群组需在群里用过助理）；
// - channel_messages：收发审计日志，超过上限自动裁剪。
const { run, get, all, getDatabase } = require('../app-db');

const MESSAGE_KEEP = 3000;
const initializations = new WeakMap();

async function ensureSchema() {
    const connection = getDatabase();
    if (!initializations.has(connection)) {
        const pending = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS channel_sessions (
                channel TEXT NOT NULL,
                tool_session_id TEXT NOT NULL,
                title TEXT,
                kind TEXT,
                target_id TEXT,
                sender_account TEXT,
                ai_session_id TEXT,
                ext_json TEXT,
                created_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                closed_at TEXT,
                PRIMARY KEY (channel, tool_session_id)
            )`);
            await run(`CREATE TABLE IF NOT EXISTS channel_targets (
                channel TEXT NOT NULL,
                kind TEXT NOT NULL,
                target_id TEXT NOT NULL,
                display_name TEXT,
                alias TEXT,
                tool_session_id TEXT,
                message_count INTEGER NOT NULL DEFAULT 0,
                first_seen_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                PRIMARY KEY (channel, kind, target_id)
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_channel_targets_active ON channel_targets(channel, last_active_at DESC)');
            await run(`CREATE TABLE IF NOT EXISTS channel_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                direction TEXT NOT NULL,
                tool_session_id TEXT,
                kind TEXT,
                target_id TEXT,
                sender TEXT,
                text TEXT,
                status TEXT,
                trigger TEXT,
                source TEXT,
                error TEXT,
                created_at TEXT NOT NULL
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_channel_messages_created ON channel_messages(channel, id DESC)');
        })();
        initializations.set(connection, pending);
        pending.catch(() => initializations.delete(connection));
    }
    await initializations.get(connection);
}

function now() {
    return new Date().toISOString();
}

function clip(value, max) {
    return value == null ? null : String(value).slice(0, max);
}

function mapSession(row) {
    if (!row) return null;
    let ext = null;
    try { ext = row.ext_json ? JSON.parse(row.ext_json) : null; } catch { ext = null; }
    return {
        channel: row.channel,
        toolSessionId: row.tool_session_id,
        title: row.title || '',
        kind: row.kind || '',
        targetId: row.target_id || '',
        senderAccount: row.sender_account || '',
        aiSessionId: row.ai_session_id || '',
        ext,
        createdAt: row.created_at,
        lastActiveAt: row.last_active_at,
        closedAt: row.closed_at || null
    };
}

function mapTarget(row) {
    return {
        kind: row.kind,
        id: row.target_id,
        name: row.alias || row.display_name || row.target_id,
        displayName: row.display_name || '',
        alias: row.alias || '',
        canPush: Boolean(row.tool_session_id),
        messageCount: Number(row.message_count || 0),
        firstSeenAt: row.first_seen_at,
        lastActiveAt: row.last_active_at
    };
}

async function upsertSession(channel, { toolSessionId, title, kind, targetId, senderAccount, ext }) {
    await ensureSchema();
    const at = now();
    await run(`INSERT INTO channel_sessions (channel, tool_session_id, title, kind, target_id, sender_account, ext_json, created_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, tool_session_id) DO UPDATE SET
            title = COALESCE(excluded.title, channel_sessions.title),
            kind = COALESCE(excluded.kind, channel_sessions.kind),
            target_id = COALESCE(excluded.target_id, channel_sessions.target_id),
            sender_account = COALESCE(excluded.sender_account, channel_sessions.sender_account),
            ext_json = COALESCE(excluded.ext_json, channel_sessions.ext_json),
            last_active_at = excluded.last_active_at,
            closed_at = NULL`,
    [channel, clip(toolSessionId, 200), clip(title, 200), kind || null, clip(targetId, 200), clip(senderAccount, 200), ext ? JSON.stringify(ext).slice(0, 4000) : null, at, at]);
}

async function getSession(channel, toolSessionId) {
    await ensureSchema();
    return mapSession(await get('SELECT * FROM channel_sessions WHERE channel = ? AND tool_session_id = ?', [channel, toolSessionId]));
}

async function bindAiSession(channel, toolSessionId, aiSessionId) {
    await ensureSchema();
    await run('UPDATE channel_sessions SET ai_session_id = ? WHERE channel = ? AND tool_session_id = ?', [aiSessionId || null, channel, toolSessionId]);
}

async function closeSession(channel, toolSessionId) {
    await ensureSchema();
    const at = now();
    await run('UPDATE channel_sessions SET closed_at = ? WHERE channel = ? AND tool_session_id = ?', [at, channel, toolSessionId]);
    // 会话关闭后该目标不能再借此会话推送
    await run('UPDATE channel_targets SET tool_session_id = NULL WHERE channel = ? AND tool_session_id = ?', [channel, toolSessionId]);
}

/**
 * 记录一次目标活跃。toolSessionId 只在该会话可用于向此目标推送时传入
 * （人员 = 单聊会话；群组 = 群会话），群里的发言人只更新活跃度，不覆盖其单聊会话。
 */
async function touchTarget(channel, { kind, id, displayName, toolSessionId, countMessage = true }) {
    if (!kind || !id) return;
    await ensureSchema();
    const at = now();
    await run(`INSERT INTO channel_targets (channel, kind, target_id, display_name, tool_session_id, message_count, first_seen_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, kind, target_id) DO UPDATE SET
            display_name = COALESCE(excluded.display_name, channel_targets.display_name),
            tool_session_id = COALESCE(excluded.tool_session_id, channel_targets.tool_session_id),
            message_count = channel_targets.message_count + ?,
            last_active_at = excluded.last_active_at`,
    [channel, kind, clip(id, 200), clip(displayName, 200), clip(toolSessionId, 200), countMessage ? 1 : 0, at, at, countMessage ? 1 : 0]);
}

async function getTarget(channel, kind, id) {
    await ensureSchema();
    const row = await get('SELECT * FROM channel_targets WHERE channel = ? AND kind = ? AND target_id = ?', [channel, kind, id]);
    return row ? { ...mapTarget(row), toolSessionId: row.tool_session_id || '' } : null;
}

/** 按最近活跃由近及远列出目标，可按类型、关键字过滤。 */
async function listTargets(channel, { kind = '', q = '', limit = 500, pushableOnly = false } = {}) {
    await ensureSchema();
    const where = ['channel = ?'];
    const params = [channel];
    if (kind === 'user' || kind === 'group') {
        where.push('kind = ?');
        params.push(kind);
    }
    const keyword = String(q || '').trim();
    if (keyword) {
        where.push("(target_id LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR alias LIKE ? ESCAPE '\\')");
        const like = `%${keyword.replace(/[\\%_]/g, char => `\\${char}`)}%`;
        params.push(like, like, like);
    }
    if (pushableOnly) where.push('tool_session_id IS NOT NULL');
    const rows = await all(`SELECT * FROM channel_targets WHERE ${where.join(' AND ')} ORDER BY last_active_at DESC LIMIT ?`,
        [...params, Math.max(1, Math.min(2000, Number(limit) || 500))]);
    return rows.map(mapTarget);
}

async function setTargetAlias(channel, kind, id, alias) {
    await ensureSchema();
    const result = await run('UPDATE channel_targets SET alias = ? WHERE channel = ? AND kind = ? AND target_id = ?', [clip(String(alias || '').trim(), 120) || null, channel, kind, id]);
    return result.changes > 0;
}

async function deleteTarget(channel, kind, id) {
    await ensureSchema();
    const result = await run('DELETE FROM channel_targets WHERE channel = ? AND kind = ? AND target_id = ?', [channel, kind, id]);
    return result.changes > 0;
}

async function logMessage(channel, entry) {
    await ensureSchema();
    await run(`INSERT INTO channel_messages (channel, direction, tool_session_id, kind, target_id, sender, text, status, trigger, source, error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [channel, entry.direction === 'out' ? 'out' : 'in', clip(entry.toolSessionId, 200), entry.kind || null, clip(entry.targetId, 200), clip(entry.sender, 200),
        clip(entry.text, 4000), clip(entry.status || 'ok', 40), clip(entry.trigger, 40), clip(entry.source, 120), clip(entry.error, 500), now()]);
    const row = await get('SELECT COUNT(*) AS total FROM channel_messages WHERE channel = ?', [channel]);
    if (Number(row?.total || 0) > MESSAGE_KEEP + 200) {
        await run(`DELETE FROM channel_messages WHERE channel = ? AND id NOT IN (
            SELECT id FROM channel_messages WHERE channel = ? ORDER BY id DESC LIMIT ?)`, [channel, channel, MESSAGE_KEEP]);
    }
}

async function listMessages(channel, { limit = 100 } = {}) {
    await ensureSchema();
    const rows = await all('SELECT * FROM channel_messages WHERE channel = ? ORDER BY id DESC LIMIT ?', [channel, Math.max(1, Math.min(500, Number(limit) || 100))]);
    return rows.map(row => ({
        id: row.id,
        direction: row.direction,
        toolSessionId: row.tool_session_id || '',
        kind: row.kind || '',
        targetId: row.target_id || '',
        sender: row.sender || '',
        text: row.text || '',
        status: row.status || '',
        trigger: row.trigger || '',
        source: row.source || '',
        error: row.error || '',
        createdAt: row.created_at
    }));
}

async function countSummary(channel) {
    await ensureSchema();
    const targets = await all('SELECT kind, COUNT(*) AS total, SUM(CASE WHEN tool_session_id IS NOT NULL THEN 1 ELSE 0 END) AS pushable FROM channel_targets WHERE channel = ? GROUP BY kind', [channel]);
    const sessions = await get('SELECT COUNT(*) AS total FROM channel_sessions WHERE channel = ? AND closed_at IS NULL', [channel]);
    const summary = { users: 0, groups: 0, pushableUsers: 0, pushableGroups: 0, openSessions: Number(sessions?.total || 0) };
    targets.forEach(row => {
        if (row.kind === 'user') { summary.users = Number(row.total); summary.pushableUsers = Number(row.pushable || 0); }
        if (row.kind === 'group') { summary.groups = Number(row.total); summary.pushableGroups = Number(row.pushable || 0); }
    });
    return summary;
}

module.exports = {
    ensureSchema,
    upsertSession,
    getSession,
    bindAiSession,
    closeSession,
    touchTarget,
    getTarget,
    listTargets,
    setTargetAlias,
    deleteTarget,
    logMessage,
    listMessages,
    countSummary
};
