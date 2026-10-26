// 频道对话的「记忆」：跟进任务、任务流水与对话段落（当前租户 tools.db）。
// - channel_followups：在某个群/单聊里记下的跟进任务，含提醒谁、频率、下次提醒时间与状态；
// - channel_followup_events：创建、提醒、进度、关闭等流水，平台工作区据此展示跟进情况；
// - channel_conversation_segments：某个群/人先后绑定过的平台对话（每次 /new 或新会话产生一段），
//   历史视图按群/人把各段合并成一条时间线，并在段落之间标注「新的对话上下文」。
const crypto = require('crypto');
const { run, get, all, getDatabase } = require('../app-db');
const schedule = require('./followup-schedule');

const STATUSES = ['open', 'paused', 'done', 'cancelled'];
const EVENT_TYPES = ['created', 'updated', 'progress', 'reminded', 'remind_failed', 'paused', 'resumed', 'done', 'cancelled', 'reopened', 'limit'];
const MAX_ASSIGNEES = 20;
const DEFAULT_MAX_REMINDERS = 30;
const initializations = new WeakMap();

function now() {
    return new Date().toISOString();
}

function clip(value, max) {
    return value == null ? null : String(value).slice(0, max);
}

function newId() {
    return `fu_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function serviceError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

async function addColumnIfMissing(table, column, definition) {
    const columns = await all(`PRAGMA table_info(${table})`);
    if (!columns.some(item => item.name === column)) await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureSchema() {
    const connection = getDatabase();
    if (!initializations.has(connection)) {
        const pending = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS channel_followups (
                id TEXT PRIMARY KEY,
                channel TEXT NOT NULL,
                conv_kind TEXT NOT NULL,
                conv_id TEXT NOT NULL,
                tool_session_id TEXT,
                ai_session_id TEXT,
                title TEXT NOT NULL,
                detail TEXT,
                source_text TEXT,
                creator TEXT,
                assignees_json TEXT,
                urgency TEXT NOT NULL DEFAULT 'normal',
                schedule_mode TEXT NOT NULL DEFAULT 'auto',
                interval_minutes INTEGER,
                random_min_minutes INTEGER,
                random_max_minutes INTEGER,
                allow_off_hours INTEGER,
                next_remind_at TEXT,
                next_remind_note TEXT,
                last_reminded_at TEXT,
                remind_count INTEGER NOT NULL DEFAULT 0,
                max_reminders INTEGER NOT NULL DEFAULT ${DEFAULT_MAX_REMINDERS},
                due_at TEXT,
                progress TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                closed_by TEXT,
                closed_at TEXT,
                close_note TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_channel_followups_conv ON channel_followups(channel, conv_kind, conv_id, created_at DESC)');
            await run('CREATE INDEX IF NOT EXISTS idx_channel_followups_due ON channel_followups(status, next_remind_at)');
            await run(`CREATE TABLE IF NOT EXISTS channel_followup_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                followup_id TEXT NOT NULL,
                type TEXT NOT NULL,
                actor TEXT,
                note TEXT,
                meta_json TEXT,
                created_at TEXT NOT NULL
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_channel_followup_events_task ON channel_followup_events(followup_id, id)');
            await run(`CREATE TABLE IF NOT EXISTS channel_conversation_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel TEXT NOT NULL,
                conv_kind TEXT NOT NULL,
                conv_id TEXT NOT NULL,
                tool_session_id TEXT,
                ai_session_id TEXT NOT NULL,
                reason TEXT,
                started_at TEXT NOT NULL
            )`);
            await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_segments_ai ON channel_conversation_segments(channel, ai_session_id)');
            await run('CREATE INDEX IF NOT EXISTS idx_channel_segments_conv ON channel_conversation_segments(channel, conv_kind, conv_id, started_at)');
            await addColumnIfMissing('channel_followups', 'last_reminder_text', 'TEXT');
            await backfillSegments();
        })();
        initializations.set(connection, pending);
        pending.catch(() => initializations.delete(connection));
    }
    await initializations.get(connection);
}

// 升级前已绑定的会话补登为段落：channel_sessions 只保留了每个会话当前绑定的平台对话。
async function backfillSegments() {
    const table = await get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'channel_sessions'");
    if (!table) return;
    const rows = await all(`SELECT channel, tool_session_id, kind, target_id, ai_session_id, created_at FROM channel_sessions
        WHERE ai_session_id IS NOT NULL AND ai_session_id <> '' AND kind IN ('group', 'user') AND target_id IS NOT NULL AND target_id <> ''`);
    for (const row of rows) {
        await run(`INSERT OR IGNORE INTO channel_conversation_segments (channel, conv_kind, conv_id, tool_session_id, ai_session_id, reason, started_at)
            VALUES (?, ?, ?, ?, ?, 'legacy', ?)`, [row.channel, row.kind, row.target_id, row.tool_session_id, row.ai_session_id, row.created_at || now()]);
    }
}

// ───────────────────────── 对话段落 ─────────────────────────

/** 记录某个群/人开始使用一个新的平台对话；同一平台对话只记一次。返回是否新增。 */
async function addSegment(channel, { kind, id, toolSessionId, aiSessionId }) {
    if (!aiSessionId || !kind || !id) return false;
    await ensureSchema();
    const previous = await get('SELECT COUNT(*) AS total FROM channel_conversation_segments WHERE channel = ? AND conv_kind = ? AND conv_id = ?', [channel, kind, id]);
    const result = await run(`INSERT OR IGNORE INTO channel_conversation_segments (channel, conv_kind, conv_id, tool_session_id, ai_session_id, reason, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [channel, kind, clip(id, 200), clip(toolSessionId, 200), clip(aiSessionId, 120), Number(previous?.total) ? 'new-context' : 'first', now()]);
    return result.changes > 0;
}

async function listSegments(channel, kind, id) {
    await ensureSchema();
    const rows = await all('SELECT * FROM channel_conversation_segments WHERE channel = ? AND conv_kind = ? AND conv_id = ? ORDER BY started_at ASC, id ASC', [channel, kind, id]);
    return rows.map(row => ({ id: row.id, aiSessionId: row.ai_session_id, toolSessionId: row.tool_session_id || '', reason: row.reason || '', startedAt: row.started_at }));
}

/**
 * 按群/人列出有对话或跟进任务的会话，最近活跃在前。
 * 名称取自 channel_targets（别名优先），统计段落数、消息数与任务状态。
 */
async function listThreads(channel, { q = '', limit = 100 } = {}) {
    await ensureSchema();
    const chat = await get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ai_chat_messages'");
    const rows = await all(`SELECT conv_kind AS kind, conv_id AS id FROM channel_conversation_segments WHERE channel = ?
        UNION SELECT conv_kind AS kind, conv_id AS id FROM channel_followups WHERE channel = ?`, [channel, channel]);
    const keyword = String(q || '').trim().toLowerCase();
    const threads = [];
    for (const row of rows) {
        const target = await get('SELECT display_name, alias, last_active_at FROM channel_targets WHERE channel = ? AND kind = ? AND target_id = ?', [channel, row.kind, row.id]).catch(() => null);
        const segments = await all('SELECT ai_session_id, started_at FROM channel_conversation_segments WHERE channel = ? AND conv_kind = ? AND conv_id = ?', [channel, row.kind, row.id]);
        let messageCount = 0;
        let lastMessageAt = '';
        let lastMessage = '';
        if (chat && segments.length) {
            const ids = segments.map(item => item.ai_session_id);
            const marks = ids.map(() => '?').join(',');
            const stats = await get(`SELECT COUNT(*) AS total, MAX(created_at) AS last_at FROM ai_chat_messages WHERE session_id IN (${marks})`, ids);
            messageCount = Number(stats?.total || 0);
            lastMessageAt = stats?.last_at || '';
            const last = await get(`SELECT content FROM ai_chat_messages WHERE session_id IN (${marks}) AND role = 'user' ORDER BY created_at DESC, rowid DESC LIMIT 1`, ids);
            lastMessage = String(last?.content || '').replace(/\s+/g, ' ').slice(0, 120);
        }
        const tasks = await all('SELECT status, updated_at FROM channel_followups WHERE channel = ? AND conv_kind = ? AND conv_id = ?', [channel, row.kind, row.id]);
        const name = target?.alias || target?.display_name || row.id;
        if (keyword && ![name, row.id, lastMessage].some(value => String(value || '').toLowerCase().includes(keyword))) continue;
        // ai_chat_messages.created_at 为 SQLite UTC「YYYY-MM-DD HH:MM:SS」，统一换成 ISO 再比较
        const times = [toIso(lastMessageAt), target?.last_active_at, ...tasks.map(task => task.updated_at), ...segments.map(item => item.started_at)].filter(Boolean).sort();
        threads.push({
            kind: row.kind,
            id: row.id,
            name,
            segmentCount: segments.length,
            messageCount,
            lastMessage,
            lastActiveAt: times[times.length - 1] || '',
            tasks: {
                open: tasks.filter(task => task.status === 'open').length,
                paused: tasks.filter(task => task.status === 'paused').length,
                done: tasks.filter(task => task.status === 'done').length,
                cancelled: tasks.filter(task => task.status === 'cancelled').length
            }
        });
    }
    return threads.sort((a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt))).slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

function toIso(value) {
    if (!value) return '';
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}.000Z` : text;
}

/**
 * 合并后的对话时间线：该群/人所有段落的消息按时间排序，before 为消息 id 游标（向前翻页）。
 * 只读取属于该会话段落的平台对话，不经过个人对话的归属校验。
 */
async function listThreadMessages(channel, kind, id, { limit = 40, before = '' } = {}) {
    await ensureSchema();
    const segments = await listSegments(channel, kind, id);
    if (!segments.length) return { segments, items: [], hasMore: false, total: 0 };
    const ids = segments.map(item => item.aiSessionId);
    const marks = ids.map(() => '?').join(',');
    const size = Math.min(100, Math.max(1, Math.floor(Number(limit)) || 40));
    let where = `session_id IN (${marks})`;
    const params = [...ids];
    if (before) {
        const cursor = await get(`SELECT created_at, rowid AS seq FROM ai_chat_messages WHERE id = ? AND session_id IN (${marks})`, [String(before), ...ids]);
        if (!cursor) throw serviceError('CHANNEL_CURSOR_INVALID', '分页游标无效');
        where += ' AND (created_at < ? OR (created_at = ? AND rowid < ?))';
        params.push(cursor.created_at, cursor.created_at, cursor.seq);
    }
    const rows = await all(`SELECT id, session_id, role, content, events, created_at, model_name, rowid AS seq FROM ai_chat_messages
        WHERE ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`, [...params, size + 1]);
    const total = Number((await get(`SELECT COUNT(*) AS total FROM ai_chat_messages WHERE session_id IN (${marks})`, ids))?.total || 0);
    const items = rows.slice(0, size).reverse().map(row => {
        let events = [];
        try { events = row.events ? JSON.parse(row.events) : []; } catch { events = []; }
        const channelEvent = events.find(event => event?.type === 'channel') || {};
        return {
            id: row.id,
            sessionId: row.session_id,
            role: row.role === 'model' ? 'model' : 'user',
            content: row.content || '',
            sender: channelEvent.sender || '',
            followups: events.filter(event => event?.type === 'followup').map(event => ({ action: event.action, id: event.id, title: event.title })),
            // 主动推送（运营计划、测试、手动推送、跟进提醒）：时间线上标注来源
            push: (event => (event ? { trigger: event.trigger || '', source: event.source || '' } : null))(events.find(item => item?.type === 'push')),
            createdAt: toIso(row.created_at),
            modelName: row.model_name || ''
        };
    });
    return { segments, items, hasMore: rows.length > size, total };
}

// ───────────────────────── 跟进任务 ─────────────────────────

function parseJson(text, fallback) {
    try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

function mapTask(row) {
    if (!row) return null;
    const task = {
        id: row.id,
        channel: row.channel,
        conversation: { kind: row.conv_kind, id: row.conv_id },
        toolSessionId: row.tool_session_id || '',
        aiSessionId: row.ai_session_id || '',
        title: row.title,
        detail: row.detail || '',
        sourceText: row.source_text || '',
        creator: row.creator || '',
        assignees: parseJson(row.assignees_json, []),
        urgency: row.urgency,
        scheduleMode: row.schedule_mode,
        intervalMinutes: row.interval_minutes,
        randomMinMinutes: row.random_min_minutes,
        randomMaxMinutes: row.random_max_minutes,
        allowOffHours: row.allow_off_hours == null ? null : Boolean(row.allow_off_hours),
        nextRemindAt: row.next_remind_at || null,
        nextRemindNote: row.next_remind_note || '',
        lastRemindedAt: row.last_reminded_at || null,
        lastReminderText: row.last_reminder_text || '',
        remindCount: Number(row.remind_count || 0),
        maxReminders: Number(row.max_reminders || 0),
        dueAt: row.due_at || null,
        progress: row.progress || '',
        status: row.status,
        closedBy: row.closed_by || '',
        closedAt: row.closed_at || null,
        closeNote: row.close_note || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    task.frequency = schedule.describeInterval(task);
    task.stage = task.status === 'done' || task.status === 'cancelled' ? 'end' : (task.remindCount > 0 || task.progress ? 'active' : 'start');
    return task;
}

function normalizeAssignees(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(item => (typeof item === 'string' ? { name: item } : item || {}))
        .map(item => ({ name: String(item.name || '').trim().replace(/^@+/, '').slice(0, 60), account: String(item.account || '').trim().slice(0, 80) }))
        .filter(item => item.name || item.account)
        .filter(item => {
            const key = (item.account || item.name).toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_ASSIGNEES);
}

function normalizeSchedule(input = {}, current = {}) {
    const urgency = schedule.URGENCIES.includes(input.urgency) ? input.urgency : (current.urgency || 'normal');
    const scheduleMode = schedule.MODES.includes(input.scheduleMode) ? input.scheduleMode : (current.scheduleMode || 'auto');
    const int = (value, fallback) => (value === undefined ? fallback : (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : null));
    const intervalMinutes = int(input.intervalMinutes, current.intervalMinutes ?? null);
    const randomMinMinutes = int(input.randomMinMinutes, current.randomMinMinutes ?? null);
    const randomMaxMinutes = int(input.randomMaxMinutes, current.randomMaxMinutes ?? null);
    const allowOffHours = input.allowOffHours === undefined ? (current.allowOffHours ?? null) : (input.allowOffHours == null ? null : Boolean(input.allowOffHours));
    return {
        urgency,
        scheduleMode: scheduleMode === 'interval' && !intervalMinutes ? 'auto' : scheduleMode,
        intervalMinutes: intervalMinutes ? Math.min(Math.max(intervalMinutes, 15), 60 * 24 * 30) : null,
        randomMinMinutes,
        randomMaxMinutes,
        allowOffHours
    };
}

async function addEvent(followupId, type, { actor = '', note = '', meta = null } = {}) {
    await run('INSERT INTO channel_followup_events (followup_id, type, actor, note, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [followupId, EVENT_TYPES.includes(type) ? type : 'updated', clip(actor, 120), clip(note, 2000), meta ? JSON.stringify(meta).slice(0, 2000) : null, now()]);
}

async function getTask(id) {
    await ensureSchema();
    return mapTask(await get('SELECT * FROM channel_followups WHERE id = ?', [String(id || '')]));
}

async function listEvents(id, { limit = 100 } = {}) {
    await ensureSchema();
    const rows = await all('SELECT * FROM channel_followup_events WHERE followup_id = ? ORDER BY id DESC LIMIT ?', [id, Math.max(1, Math.min(500, Number(limit) || 100))]);
    return rows.reverse().map(row => ({ id: row.id, type: row.type, actor: row.actor || '', note: row.note || '', meta: parseJson(row.meta_json, null), createdAt: row.created_at }));
}

/**
 * 新建跟进任务。
 * @param {object} input title / detail / sourceText / assignees / urgency / scheduleMode / intervalMinutes /
 *   randomMinMinutes / randomMaxMinutes / allowOffHours / firstRemindAt / nextRemindNote / dueAt / maxReminders
 * @param {object} ctx channel / conversation {kind,id} / toolSessionId / aiSessionId / actor
 * @param {object} [calendar]
 */
async function createTask(input, ctx, calendar) {
    await ensureSchema();
    const title = String(input.title || '').trim().slice(0, 200);
    if (!title) throw serviceError('FOLLOWUP_TITLE_REQUIRED', '跟进任务需要标题');
    if (!ctx?.conversation?.kind || !ctx.conversation.id) throw serviceError('FOLLOWUP_CONVERSATION_REQUIRED', '缺少任务所属的会话');
    if (ctx.channel === 'weixin' && ctx.conversation.kind !== 'user') throw serviceError('FOLLOWUP_TARGET_UNSUPPORTED', '微信跟进任务仅支持当前单聊');
    const plan = normalizeSchedule(input);
    const createdAt = new Date();
    let first = null;
    const inMin = Number(input.inMinutes);
    if (Number.isFinite(inMin) && inMin > 0) {
        first = new Date(createdAt.getTime() + Math.round(inMin) * 60000);
    } else {
        first = parseFuture(input.firstRemindAt, createdAt, calendar);
    }
    const nextRemindAt = (first || schedule.nextReminder(plan, createdAt, calendar)).toISOString();
    const id = newId();
    const at = createdAt.toISOString();
    const maxReminders = Number.isInteger(Number(input.maxReminders)) && Number(input.maxReminders) >= 0 ? Math.min(Number(input.maxReminders), 500) : DEFAULT_MAX_REMINDERS;
    await run(`INSERT INTO channel_followups (id, channel, conv_kind, conv_id, tool_session_id, ai_session_id, title, detail, source_text, creator, assignees_json,
        urgency, schedule_mode, interval_minutes, random_min_minutes, random_max_minutes, allow_off_hours, next_remind_at, next_remind_note, max_reminders, due_at,
        status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [id, ctx.channel || 'welink', ctx.conversation.kind, clip(ctx.conversation.id, 200), clip(ctx.toolSessionId, 200), clip(ctx.aiSessionId, 120), title,
        clip(input.detail, 6000), clip(input.sourceText, 6000), clip(input.creator || ctx.actor, 120), JSON.stringify(normalizeAssignees(input.assignees)),
        plan.urgency, plan.scheduleMode, plan.intervalMinutes, plan.randomMinMinutes, plan.randomMaxMinutes, plan.allowOffHours == null ? null : (plan.allowOffHours ? 1 : 0),
        nextRemindAt, clip(input.nextRemindNote, 500), maxReminders, parseDate(input.dueAt, calendar), at, at]);
    await addEvent(id, 'created', { actor: ctx.actor, note: title, meta: { urgency: plan.urgency, nextRemindAt } });
    return getTask(id);
}

function parseDate(value, calendar) {
    if (!value) return null;
    const str = String(value).trim();
    const naiveMatch = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str);
    if (naiveMatch) {
        const [, y, m, d, hh, mm] = naiveMatch;
        return schedule.fromZone(Number(y), Number(m), Number(d), Number(hh) * 60 + Number(mm), calendar?.timezone || schedule.DEFAULT_CALENDAR.timezone).toISOString();
    }
    const date = new Date(str);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseFuture(value, from, calendar) {
    const iso = parseDate(value, calendar);
    return iso && new Date(iso) > from ? new Date(iso) : null;
}

/** 更新任务内容、进度或频率。频率变化时重算下次提醒。 */
async function updateTask(id, patch = {}, { actor = '', calendar } = {}) {
    const task = await getTask(id);
    if (!task) throw serviceError('FOLLOWUP_NOT_FOUND', '跟进任务不存在', 404);
    const sets = [];
    const params = [];
    const set = (column, value) => { sets.push(`${column} = ?`); params.push(value); };
    if (patch.title !== undefined && String(patch.title).trim()) set('title', String(patch.title).trim().slice(0, 200));
    if (patch.detail !== undefined) set('detail', clip(patch.detail, 6000));
    if (patch.assignees !== undefined) set('assignees_json', JSON.stringify(normalizeAssignees(patch.assignees)));
    if (patch.nextRemindNote !== undefined) set('next_remind_note', clip(patch.nextRemindNote, 500));
    if (patch.dueAt !== undefined) set('due_at', parseDate(patch.dueAt, calendar));
    if (patch.progress !== undefined && String(patch.progress).trim()) set('progress', clip(String(patch.progress).trim(), 2000));
    const scheduleKeys = ['urgency', 'scheduleMode', 'intervalMinutes', 'randomMinMinutes', 'randomMaxMinutes', 'allowOffHours'];
    let nextRemindAt = null;
    if (scheduleKeys.some(key => patch[key] !== undefined)) {
        const plan = normalizeSchedule(patch, task);
        set('urgency', plan.urgency);
        set('schedule_mode', plan.scheduleMode);
        set('interval_minutes', plan.intervalMinutes);
        set('random_min_minutes', plan.randomMinMinutes);
        set('random_max_minutes', plan.randomMaxMinutes);
        set('allow_off_hours', plan.allowOffHours == null ? null : (plan.allowOffHours ? 1 : 0));
        if (task.status === 'open') nextRemindAt = schedule.nextReminder(plan, new Date(), calendar).toISOString();
    }
    const inMin = Number(patch.inMinutes);
    if (Number.isFinite(inMin) && inMin > 0 && task.status === 'open') {
        nextRemindAt = new Date(Date.now() + Math.round(inMin) * 60000).toISOString();
    } else {
        const explicit = parseFuture(patch.nextRemindAt, new Date(), calendar);
        if (explicit && task.status === 'open') nextRemindAt = explicit.toISOString();
    }
    if (nextRemindAt) set('next_remind_at', nextRemindAt);
    if (!sets.length) return task;
    set('updated_at', now());
    await run(`UPDATE channel_followups SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    const progressOnly = patch.progress !== undefined && Object.keys(patch).every(key => ['progress', 'nextRemindNote'].includes(key));
    await addEvent(id, progressOnly ? 'progress' : 'updated', { actor, note: progressOnly ? String(patch.progress).slice(0, 2000) : describePatch(patch), meta: nextRemindAt ? { nextRemindAt } : null });
    return getTask(id);
}

function describePatch(patch) {
    const labels = { title: '标题', detail: '详情', assignees: '提醒人', urgency: '紧急度', scheduleMode: '频率', intervalMinutes: '间隔', randomMinMinutes: '随机下限', randomMaxMinutes: '随机上限', allowOffHours: '非工作日', nextRemindAt: '下次提醒时间', nextRemindNote: '下次跟进内容', dueAt: '截止时间', progress: '进度' };
    const changed = Object.keys(patch).filter(key => labels[key]).map(key => labels[key]);
    const progress = patch.progress ? `；进度：${String(patch.progress).slice(0, 300)}` : '';
    return `更新了${changed.join('、') || '任务'}${progress}`;
}

/** 状态流转：done / cancelled / paused / open（恢复或重新打开）。 */
async function setStatus(id, status, { actor = '', note = '', calendar } = {}) {
    if (!STATUSES.includes(status)) throw serviceError('FOLLOWUP_STATUS_INVALID', '无效的任务状态');
    const task = await getTask(id);
    if (!task) throw serviceError('FOLLOWUP_NOT_FOUND', '跟进任务不存在', 404);
    if (task.status === status) return task;
    const at = now();
    if (status === 'done' || status === 'cancelled') {
        await run('UPDATE channel_followups SET status = ?, closed_by = ?, closed_at = ?, close_note = ?, next_remind_at = NULL, updated_at = ? WHERE id = ?',
            [status, clip(actor, 120), at, clip(note, 2000), at, id]);
        await addEvent(id, status, { actor, note });
    } else if (status === 'paused') {
        await run('UPDATE channel_followups SET status = ?, next_remind_at = NULL, updated_at = ? WHERE id = ?', [status, at, id]);
        await addEvent(id, 'paused', { actor, note });
    } else {
        const nextRemindAt = schedule.nextReminder(task, new Date(), calendar).toISOString();
        await run('UPDATE channel_followups SET status = ?, closed_by = NULL, closed_at = NULL, close_note = NULL, next_remind_at = ?, updated_at = ? WHERE id = ?',
            ['open', nextRemindAt, at, id]);
        await addEvent(id, task.status === 'paused' ? 'resumed' : 'reopened', { actor, note, meta: { nextRemindAt } });
    }
    return getTask(id);
}

async function listTasks(channel, { kind, id, statuses = null, limit = 100 } = {}) {
    await ensureSchema();
    const where = ['channel = ?'];
    const params = [channel];
    if (kind && id) {
        where.push('conv_kind = ? AND conv_id = ?');
        params.push(kind, id);
    }
    const wanted = (Array.isArray(statuses) ? statuses : []).filter(item => STATUSES.includes(item));
    if (wanted.length) {
        where.push(`status IN (${wanted.map(() => '?').join(',')})`);
        params.push(...wanted);
    }
    const rows = await all(`SELECT * FROM channel_followups WHERE ${where.join(' AND ')}
        ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, created_at DESC LIMIT ?`, [...params, Math.max(1, Math.min(500, Number(limit) || 100))]);
    return rows.map(mapTask);
}

/** 到期待提醒的任务（调度器使用）。 */
async function listDue(atIso = now(), limit = 20, channel = '') {
    await ensureSchema();
    const rows = await all(`SELECT * FROM channel_followups WHERE status = 'open' AND next_remind_at IS NOT NULL AND next_remind_at <= ? ${channel ? 'AND channel = ?' : ''} ORDER BY next_remind_at ASC LIMIT ?`, [atIso, ...(channel ? [channel] : []), limit]);
    return rows.map(mapTask);
}

/**
 * 认领一次提醒：只有 next_remind_at 仍是读取时的值才成功，避免重复发送。
 * 成功后 next_remind_at 先推进到下一次，发送失败再由 releaseReminder 回退。
 */
async function claimReminder(task, nextRemindAt) {
    const result = await run(`UPDATE channel_followups SET next_remind_at = ?, last_reminded_at = ?, remind_count = remind_count + 1, updated_at = ?
        WHERE id = ? AND status = 'open' AND next_remind_at = ?`, [nextRemindAt, now(), now(), task.id, task.nextRemindAt]);
    return result.changes > 0;
}

async function recordReminder(id, { text, sent, error, retryAt, count, limitReached } = {}) {
    if (sent) {
        await run('UPDATE channel_followups SET last_reminder_text = ? WHERE id = ?', [clip(text, 4000), id]);
        await addEvent(id, 'reminded', { actor: 'system', note: `第 ${count} 次提醒已发送`, meta: { text: clip(text, 1500) } });
        if (limitReached) {
            await run("UPDATE channel_followups SET status = 'paused', next_remind_at = NULL, updated_at = ? WHERE id = ? AND status = 'open'", [now(), id]);
            await addEvent(id, 'limit', { actor: 'system', note: `已达到提醒上限（${count} 次），自动暂停；可在平台或群里恢复` });
        }
        return;
    }
    await run('UPDATE channel_followups SET remind_count = MAX(remind_count - 1, 0), next_remind_at = ? WHERE id = ?', [retryAt, id]);
    await addEvent(id, 'remind_failed', { actor: 'system', note: String(error || '发送失败').slice(0, 500), meta: { retryAt } });
}

module.exports = {
    STATUSES,
    ensureSchema,
    addSegment,
    listSegments,
    listThreads,
    listThreadMessages,
    createTask,
    updateTask,
    setStatus,
    getTask,
    listTasks,
    listEvents,
    listDue,
    claimReminder,
    recordReminder,
    normalizeAssignees
};
