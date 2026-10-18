const { run, all, get } = require('./app-db');

const MAX_ALERT_ROWS = 10000;

let initPromise = null;

function buildId(prefix = 'alert') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSeverity(value) {
    return ['info', 'warn', 'error', 'critical'].includes(value) ? value : 'info';
}

function normalizeType(value) {
    return ['config', 'alert', 'security', 'user_action', 'system'].includes(value) ? value : 'system';
}

function normalizeStatus(value) {
    return ['unread', 'read', 'archived'].includes(value) ? value : 'unread';
}

function parseJson(value, fallback) {
    try {
        return JSON.parse(value || '');
    } catch (_err) {
        return fallback;
    }
}

async function ensureReady() {
    if (!initPromise) {
        initPromise = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS alert_center_events (
                    id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL DEFAULT 'system',
                    severity TEXT NOT NULL DEFAULT 'info',
                    status TEXT NOT NULL DEFAULT 'unread',
                    title TEXT NOT NULL,
                    message TEXT DEFAULT '',
                    actor TEXT DEFAULT '',
                    source TEXT DEFAULT '',
                    object_type TEXT DEFAULT '',
                    object_id TEXT DEFAULT '',
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    ai_summary TEXT DEFAULT '',
                    ai_status TEXT DEFAULT 'pending',
                    ai_analyzed_at DATETIME,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    read_at DATETIME,
                    archived_at DATETIME
                )
            `);
            await run("ALTER TABLE alert_center_events ADD COLUMN ai_summary TEXT DEFAULT ''", []).catch(() => {});
            await run("ALTER TABLE alert_center_events ADD COLUMN ai_status TEXT DEFAULT 'pending'", []).catch(() => {});
            await run("ALTER TABLE alert_center_events ADD COLUMN ai_analyzed_at DATETIME", []).catch(() => {});
            await run(`CREATE INDEX IF NOT EXISTS idx_alert_center_status_created ON alert_center_events(status, created_at DESC)`);
            await run(`CREATE INDEX IF NOT EXISTS idx_alert_center_type_created ON alert_center_events(event_type, created_at DESC)`);
            await ensureBootstrapEvent();
        })().catch(err => {
            initPromise = null;
            throw err;
        });
    }

    return initPromise;
}

async function ensureBootstrapEvent() {
    const row = await get(`SELECT COUNT(*) AS count FROM alert_center_events`);
    if (row && Number(row.count) > 0) return;
    await run(
        `INSERT INTO alert_center_events
         (id, event_type, severity, status, title, message, actor, source, object_type, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            buildId(),
            'system',
            'info',
            'unread',
            '告警台已启用',
            '系统告警、配置变化和用户关键行为将逐步接入这里统一查看。',
            'system',
            'alert-center',
            'bootstrap',
            JSON.stringify({ version: 1 })
        ]
    );
}

async function trimEvents() {
    await run(`
        DELETE FROM alert_center_events
        WHERE id NOT IN (
            SELECT id
            FROM alert_center_events
            ORDER BY datetime(created_at) DESC, rowid DESC
            LIMIT ?
        )
    `, [MAX_ALERT_ROWS]);
}

function mapEventRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        event_type: row.event_type,
        severity: row.severity,
        status: row.status,
        title: row.title,
        message: row.message || '',
        actor: row.actor || '',
        source: row.source || '',
        object_type: row.object_type || '',
        object_id: row.object_id || '',
        detail: parseJson(row.detail_json, {}),
        ai_summary: row.ai_summary || '',
        ai_status: row.ai_status || 'pending',
        ai_analyzed_at: row.ai_analyzed_at || null,
        created_at: row.created_at,
        read_at: row.read_at || null,
        archived_at: row.archived_at || null
    };
}

async function addEvent({
    eventType = 'system',
    severity = 'info',
    status = 'unread',
    title,
    message = '',
    actor = '',
    source = '',
    objectType = '',
    objectId = '',
    detail = {},
    aiSummary = '',
    aiStatus = ''
}) {
    await ensureReady();
    const isCircuitBreakerEvent = source === 'ai_circuit_breaker';
    const resolvedAiStatus = aiStatus || (isCircuitBreakerEvent ? 'not_applicable' : 'pending');
    const resolvedAiSummary = aiSummary || (isCircuitBreakerEvent ? '系统底层防护告警，无需 AI 二次分析。' : '');

    const item = {
        id: buildId(),
        eventType: normalizeType(eventType),
        severity: normalizeSeverity(severity),
        status: normalizeStatus(status),
        title: String(title || '未命名事件').slice(0, 160),
        message: String(message || '').slice(0, 2000),
        actor: String(actor || '').slice(0, 120),
        source: String(source || '').slice(0, 120),
        objectType: String(objectType || '').slice(0, 120),
        objectId: String(objectId || '').slice(0, 240),
        detail: detail && typeof detail === 'object' ? detail : {},
        ai_summary: resolvedAiSummary,
        ai_status: resolvedAiStatus
    };

    await run(
        `INSERT INTO alert_center_events
         (id, event_type, severity, status, title, message, actor, source, object_type, object_id, detail_json, ai_summary, ai_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            item.id,
            item.eventType,
            item.severity,
            item.status,
            item.title,
            item.message,
            item.actor,
            item.source,
            item.objectType,
            item.objectId,
            JSON.stringify(item.detail || {}),
            item.ai_summary,
            item.ai_status
        ]
    );
    await trimEvents();
    if (item.ai_status !== 'not_applicable' && item.ai_status !== 'done' && !isCircuitBreakerEvent) {
        setTimeout(() => {
            try {
                require('./alert-ai-analyzer').enqueueAlertAnalysis({
                    id: item.id,
                    event_type: item.eventType,
                    severity: item.severity,
                    title: item.title,
                    message: item.message,
                    actor: item.actor,
                    source: item.source,
                    object_type: item.objectType,
                    object_id: item.objectId,
                    detail: item.detail
                });
            } catch (err) {
                console.warn('[alert-ai] enqueue failed:', err.message || err);
            }
        }, 0);
    }
    return item;
}

async function listEvents({ status, eventType, severity, limit = 80 } = {}) {
    await ensureReady();
    const where = [];
    const params = [];
    if (status && status !== 'all') {
        where.push('status = ?');
        params.push(normalizeStatus(status));
    } else if (!status) {
        where.push("status != 'archived'");
    }
    if (eventType && eventType !== 'all') {
        where.push('event_type = ?');
        params.push(normalizeType(eventType));
    }
    if (severity && severity !== 'all') {
        where.push('severity = ?');
        params.push(normalizeSeverity(severity));
    }
    const parsedLimit = Number.parseInt(limit, 10);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 80;
    params.push(safeLimit);
    const rows = await all(
        `SELECT id, event_type, severity, status, title, message, actor, source, object_type, object_id,
                detail_json, ai_summary, ai_status, ai_analyzed_at, created_at, read_at, archived_at
         FROM alert_center_events
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY datetime(created_at) DESC, rowid DESC
         LIMIT ?`,
        params
    );
    return rows.map(mapEventRow);
}

async function getSummary() {
    await ensureReady();
    const rows = await all(`
        SELECT status, severity, event_type, COUNT(*) AS count
        FROM alert_center_events
        WHERE status != 'archived'
        GROUP BY status, severity, event_type
    `);
    const summary = {
        total: 0,
        unread: 0,
        critical: 0,
        warnOrAbove: 0,
        byType: {},
        bySeverity: {}
    };
    rows.forEach(row => {
        const count = Number(row.count) || 0;
        summary.total += count;
        if (row.status === 'unread') summary.unread += count;
        if (row.severity === 'critical') summary.critical += count;
        if (['warn', 'error', 'critical'].includes(row.severity)) summary.warnOrAbove += count;
        summary.byType[row.event_type] = (summary.byType[row.event_type] || 0) + count;
        summary.bySeverity[row.severity] = (summary.bySeverity[row.severity] || 0) + count;
    });
    return summary;
}

async function markRead(ids = []) {
    await ensureReady();
    const safeIds = Array.isArray(ids) ? ids.map(String).filter(Boolean).slice(0, 500) : [];
    if (!safeIds.length) return { changed: 0 };
    const placeholders = safeIds.map(() => '?').join(',');
    const result = await run(
        `UPDATE alert_center_events
         SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
         WHERE id IN (${placeholders}) AND status = 'unread'`,
        safeIds
    );
    return { changed: result.changes || 0 };
}

async function markAllRead() {
    await ensureReady();
    const result = await run(`
        UPDATE alert_center_events
        SET status = 'read', read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE status = 'unread'
    `);
    return { changed: result.changes || 0 };
}

async function archiveEvent(id) {
    await ensureReady();
    const result = await run(
        `UPDATE alert_center_events
         SET status = 'archived', archived_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status != 'archived'`,
        [String(id || '')]
    );
    return { changed: result.changes || 0 };
}

async function archiveAllEvents() {
    await ensureReady();
    const result = await run(`
        UPDATE alert_center_events
        SET status = 'archived', archived_at = CURRENT_TIMESTAMP
        WHERE status != 'archived'
    `);
    return { changed: result.changes || 0 };
}

async function updateAiSummary(id, { summary = '', status = 'done' } = {}) {
    await ensureReady();
    const result = await run(
        `UPDATE alert_center_events
         SET ai_summary = ?, ai_status = ?, ai_analyzed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [String(summary || '').slice(0, 500), String(status || 'done').slice(0, 40), String(id || '')]
    );
    return { changed: result.changes || 0 };
}

module.exports = {
    ensureReady,
    addEvent,
    listEvents,
    getSummary,
    markRead,
    markAllRead,
    archiveEvent,
    archiveAllEvents,
    updateAiSummary
};
