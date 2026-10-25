// Dragon Claw「/schedule」定时指令（当前租户 tools.db 的 dragon_claw_schedules 表）：
// - 一次性（run_at）或周期（rule_json，复用运营计划的 ops-schedule 规则）；时区取用户浏览器；
// - 到点后以创建者身份走与首页相同的对话链路（handleChatRequest），结果写回发起定时的那段对话，没有则新开一段；
// - 可选「推送到」WeLink/微信的人或群（targets_json）：执行成功后用频道公共推送把结果发过去，权限与频道推送接口一致；
// - 每分钟轮询各租户；认领时先推进 next_run_at，同一次不会重复执行；对话正忙时 2 分钟后重试；停机期间错过的只补跑一次。
const crypto = require('crypto');
const { run, get, all, getDatabase } = require('./app-db');
const { runWithTenant } = require('./tenant-context');
const parser = require('./dragon-claw-schedule-parser');

const TICK_MS = 60 * 1000;
const BUSY_RETRY_MS = 2 * 60 * 1000;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const BATCH = 10;
const MAX_ACTIVE_PER_USER = 20;
const MAX_TARGETS = 10;
const PUSH_MAX_CHARS = 7800;
const CHANNEL_LABELS = { welink: 'WeLink', weixin: '微信' };
const PAGE_TITLE = 'Dragon Claw · 首页';
const initializations = new WeakMap();
let timer = null;
let ticking = false;

function now() {
    return new Date().toISOString();
}

function serviceError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

function parseJson(text, fallback) {
    try {
        return text ? JSON.parse(text) : fallback;
    } catch {
        return fallback;
    }
}

async function ensureSchema() {
    const connection = getDatabase();
    if (!initializations.has(connection)) {
        const pending = (async () => {
            await run(`CREATE TABLE IF NOT EXISTS dragon_claw_schedules (
                id TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                instruction TEXT NOT NULL,
                kind TEXT NOT NULL,
                rule_json TEXT,
                timezone TEXT,
                session_id TEXT,
                model_id TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                next_run_at TEXT,
                last_run_at TEXT,
                last_status TEXT,
                last_error TEXT,
                last_reply TEXT,
                run_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`);
            // 后加的列：已有表补上（推送目标与最近一次推送结果）
            const columns = new Set((await all('PRAGMA table_info(dragon_claw_schedules)')).map(column => column.name));
            if (!columns.has('targets_json')) await run('ALTER TABLE dragon_claw_schedules ADD COLUMN targets_json TEXT');
            if (!columns.has('last_push_json')) await run('ALTER TABLE dragon_claw_schedules ADD COLUMN last_push_json TEXT');
            await run('CREATE INDEX IF NOT EXISTS idx_dc_schedules_due ON dragon_claw_schedules(status, next_run_at)');
            await run('CREATE INDEX IF NOT EXISTS idx_dc_schedules_owner ON dragon_claw_schedules(owner, updated_at DESC)');
        })();
        initializations.set(connection, pending);
        pending.catch(() => initializations.delete(connection));
    }
    return initializations.get(connection);
}

function toSchedule(row) {
    if (!row) return null;
    const schedule = {
        id: row.id,
        instruction: row.instruction,
        kind: row.kind,
        rule: parseJson(row.rule_json, null),
        timezone: row.timezone || '',
        sessionId: row.session_id || '',
        status: row.status,
        nextRunAt: row.next_run_at || null,
        lastRunAt: row.last_run_at || null,
        lastStatus: row.last_status || '',
        lastError: row.last_error || '',
        lastReply: row.last_reply || '',
        targets: parseJson(row.targets_json, []),
        lastPush: parseJson(row.last_push_json, null),
        runCount: Number(row.run_count) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
    schedule.description = parser.describe(schedule);
    return schedule;
}

async function workdays() {
    try {
        return (await require('./channels/welink-config-repository').getConfig()).followup.calendar.workdays;
    } catch {
        return null;
    }
}

function channelConfigRepo(channel) {
    return require(channel === 'weixin' ? './channels/weixin-config-repository' : './channels/welink-config-repository');
}

/**
 * 校验并补全推送目标：只接受频道里出现过、可主动推送的人/群；微信暂不支持群推送。
 * 权限与 /api/channels/:channel/push 一致：管理员不限，普通用户需开启「允许普通用户推送」且只能推到默认推送范围。
 */
async function resolveTargets(input, role) {
    const list = Array.isArray(input) ? input : [];
    if (list.length > MAX_TARGETS) throw serviceError('SCHEDULE_TARGETS_LIMIT', `最多推送给 ${MAX_TARGETS} 个对象`);
    const targetsRepo = require('./channels/channel-targets-repository');
    const seen = new Set();
    const resolved = [];
    for (const item of list) {
        const channel = item?.channel === 'weixin' ? 'weixin' : (item?.channel === 'welink' ? 'welink' : '');
        const kind = item?.kind === 'group' ? 'group' : (item?.kind === 'user' ? 'user' : '');
        const id = String(item?.id || '').trim().slice(0, 200);
        if (!channel || !kind || !id) throw serviceError('SCHEDULE_TARGET_INVALID', '推送对象无效');
        const key = `${channel}:${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (channel === 'weixin' && kind === 'group') throw serviceError('SCHEDULE_TARGET_UNSUPPORTED', '微信助理暂不支持群推送，请选择微信联系人');
        const target = await targetsRepo.getTarget(channel, kind, id);
        if (!target) throw serviceError('SCHEDULE_TARGET_NOT_FOUND', `${CHANNEL_LABELS[channel]}里找不到这个${kind === 'group' ? '群' : '联系人'}`);
        if (!target.toolSessionId) throw serviceError('SCHEDULE_TARGET_NOT_PUSHABLE', `「${target.alias || target.name || id}」还不能主动推送（联系人需先与助理单聊过，群需在群里用过助理）`);
        if (role !== 'admin') {
            const config = await channelConfigRepo(channel).getConfig();
            if (!config.push.allowUserPush) throw serviceError('SCHEDULE_TARGET_FORBIDDEN', `仅管理员可推送${CHANNEL_LABELS[channel]}消息`, 403);
            if (!config.push.defaultTargets.some(entry => entry.kind === kind && entry.id === id)) throw serviceError('SCHEDULE_TARGET_FORBIDDEN', '只能推送到管理员配置的默认推送范围', 403);
        }
        resolved.push({ channel, kind, id, name: String(target.alias || target.name || id).slice(0, 120) });
    }
    return resolved;
}

async function create({ owner, role, text, sessionId, timezone, modelId, targets }) {
    await ensureSchema();
    if (!owner) throw serviceError('SCHEDULE_OWNER_REQUIRED', '请先登录', 401);
    const parsed = parser.parse(text, { timezone });
    const zone = require('./channels/followup-schedule').normalizeCalendar({ timezone }).timezone;
    const active = await get("SELECT COUNT(*) AS count FROM dragon_claw_schedules WHERE owner = ? AND status = 'active'", [owner]);
    if (Number(active?.count) >= MAX_ACTIVE_PER_USER) throw serviceError('SCHEDULE_LIMIT', `最多同时保留 ${MAX_ACTIVE_PER_USER} 个定时任务，请先取消一些`);
    const pushTargets = await resolveTargets(targets, role);
    const nextRun = parsed.kind === 'once' ? parsed.runAt : parser.nextRecurring(parsed.rule, new Date(), zone, await workdays());
    if (!nextRun) throw serviceError('SCHEDULE_NO_NEXT_RUN', '按这个规则找不到下一次执行时间');
    if (sessionId) {
        // 只绑定本人已存在的对话；别人的或不存在的对话不绑定，到点时新开一段
        const owned = await require('./ai-chat-repository').assertSessionOwner(String(sessionId), owner).catch(() => null);
        if (!owned) sessionId = '';
    }
    const id = `dcs_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
    const at = now();
    await run(`INSERT INTO dragon_claw_schedules (id, owner, role, instruction, kind, rule_json, timezone, session_id, model_id, targets_json, status, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [id, owner, role === 'admin' ? 'admin' : 'user', parsed.instruction.slice(0, 4000), parsed.kind, parsed.rule ? JSON.stringify(parsed.rule) : null,
        zone, sessionId || null, modelId ? String(modelId).slice(0, 120) : null, pushTargets.length ? JSON.stringify(pushTargets) : null, nextRun.toISOString(), at, at]);
    return getForOwner(id, owner);
}

async function getForOwner(id, owner) {
    await ensureSchema();
    return toSchedule(await get('SELECT * FROM dragon_claw_schedules WHERE id = ? AND owner = ?', [id, owner]));
}

/** 进行中的在前（按下次时间），其后是最近结束/取消的。since：只返回该时间之后执行过的（用于完成提醒）。 */
async function list(owner, { since = '' } = {}) {
    await ensureSchema();
    const rows = since
        ? await all('SELECT * FROM dragon_claw_schedules WHERE owner = ? AND last_run_at > ? ORDER BY last_run_at DESC LIMIT 20', [owner, since])
        : await all(`SELECT * FROM dragon_claw_schedules WHERE owner = ? AND (status = 'active' OR updated_at > ?)
            ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, CASE status WHEN 'active' THEN next_run_at END ASC, updated_at DESC LIMIT 60`,
        [owner, new Date(Date.now() - 7 * 86400000).toISOString()]);
    return rows.map(toSchedule);
}

/** 等待执行或正在执行的任务数（前端据此决定是否继续轮询完成提醒）。 */
async function countActive(owner) {
    await ensureSchema();
    const row = await get("SELECT COUNT(*) AS count FROM dragon_claw_schedules WHERE owner = ? AND status IN ('active', 'running')", [owner]);
    return Number(row?.count) || 0;
}

// 仅按当前频道、会话类型和目标精确匹配；普通用户只看自己的任务，管理员可查看租户内任务。
async function listForTarget({ channel, kind, id, owner, admin = false }) {
    if (!['welink', 'weixin'].includes(channel) || !['user', 'group'].includes(kind) || !id || (!admin && !owner)) return { items: [], truncated: false };
    await ensureSchema();
    const rows = await all(`SELECT * FROM dragon_claw_schedules
        WHERE (? = 1 OR owner = ?) AND EXISTS (
            SELECT 1 FROM json_each(CASE WHEN json_valid(targets_json) THEN targets_json ELSE '[]' END) target
            WHERE json_extract(CASE WHEN target.type = 'object' THEN target.value ELSE '{}' END, '$.channel') = ?
                AND json_extract(CASE WHEN target.type = 'object' THEN target.value ELSE '{}' END, '$.kind') = ?
                AND json_extract(CASE WHEN target.type = 'object' THEN target.value ELSE '{}' END, '$.id') = ?
        ) ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'active' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END,
            next_run_at ASC, updated_at DESC LIMIT 201`, [admin ? 1 : 0, owner || '', channel, kind, id]);
    return {
        truncated: rows.length > 200,
        items: rows.slice(0, 200).map(row => {
            const item = toSchedule(row);
            // 不返回原始个人对话、回答正文或其他推送对象。
            const push = item.lastPush?.results?.find(target => target.channel === channel && target.kind === kind && target.id === id);
            return {
                id: item.id, instruction: item.instruction, kind: item.kind, description: item.description,
                status: item.status, nextRunAt: item.nextRunAt, lastRunAt: item.lastRunAt,
                lastStatus: item.lastStatus, lastError: item.lastError, runCount: item.runCount,
                timezone: item.timezone, updatedAt: item.updatedAt,
                lastPush: push ? { ok: push.ok === true, error: String(push.error || ''), at: item.lastPush.at } : null
            };
        })
    };
}

async function cancel(id, owner) {
    await ensureSchema();
    const result = await run("UPDATE dragon_claw_schedules SET status = 'cancelled', next_run_at = NULL, updated_at = ? WHERE id = ? AND owner = ? AND status = 'active'", [now(), id, owner]);
    const schedule = await getForOwner(id, owner);
    if (!schedule) throw serviceError('SCHEDULE_NOT_FOUND', '定时任务不存在', 404);
    if (!result?.changes && schedule.status !== 'cancelled') throw serviceError('SCHEDULE_NOT_ACTIVE', '该任务已结束，无需取消');
    return schedule;
}

// ── 执行 ─────────────────────────────────────────────────

function contextNote(schedule, firedAt) {
    const when = firedAt.toLocaleString('zh-CN', { timeZone: schedule.timezone || undefined, hour12: false });
    return [
        `【定时任务】这条消息是用户之前用 /schedule 预约的指令，于 ${when}${schedule.timezone ? `（${schedule.timezone}）` : ''} 自动执行${schedule.kind === 'recurring' ? `，执行规则：${schedule.description}（第 ${schedule.runCount + 1} 次）` : ''}。`,
        '用户此刻可能不在线，请直接完成指令并给出结果；如果指令是提醒，就用醒目的一句话提醒用户。不要反问确认，也不要再创建新的定时任务。'
    ].join('\n');
}

/** 以创建者身份跑一轮对话；返回 { sessionId, reply }，失败抛错（busy=true 表示对话正忙，稍后重试）。 */
async function runTurn(schedule, row, firedAt) {
    const aiRouter = require('../routes/ai');
    const { createVirtualResponse } = require('./channels/dragon-claw-channel-bridge');
    let streamed = '';
    let finalPayload = null;
    let failure = null;
    let sessionId = schedule.sessionId;
    const res = createVirtualResponse(event => {
        if (event.type === 'start' && event.sessionId) sessionId = event.sessionId;
        else if (event.type === 'delta' && event.delta) streamed += event.delta;
        else if (event.type === 'done') finalPayload = event;
        else if (event.type === 'error') failure = { message: String(event.error || 'AI 执行失败') };
        else if (event.type === 'http-json' && event.status >= 400) failure = { message: String(event.body?.error || `AI 执行失败（HTTP ${event.status}）`), busy: event.body?.code === 'AI_CHAT_BUSY' };
    });
    const timeout = setTimeout(() => res.abort(), RUN_TIMEOUT_MS);
    try {
        await aiRouter.handleChatRequest({
            method: 'POST',
            path: '/chat',
            headers: {},
            user: { username: row.owner, role: row.role },
            get: () => '',
            body: {
                messages: [{ role: 'user', content: schedule.instruction }],
                context: contextNote(schedule, firedAt),
                pageTitle: PAGE_TITLE,
                pagePath: '/',
                sessionId: sessionId || undefined,
                stream: true,
                agent: 'dragon-claw-home',
                uiLanguage: 'zh-CN',
                ...(row.model_id ? { modelId: row.model_id } : {})
            }
        }, res);
    } finally {
        clearTimeout(timeout);
    }
    if (res.destroyed && !finalPayload) throw Object.assign(new Error('执行超时'), { sessionId });
    if (failure) throw Object.assign(new Error(failure.message), { busy: failure.busy, sessionId });
    return { sessionId: finalPayload?.sessionId || sessionId, reply: String(finalPayload?.reply || streamed).trim() };
}

function pushText(schedule, reply) {
    const head = `⏰ **定时任务** · ${schedule.instruction.length > 80 ? `${schedule.instruction.slice(0, 80)}…` : schedule.instruction}`;
    const body = reply.length > PUSH_MAX_CHARS - head.length - 4 ? `${reply.slice(0, PUSH_MAX_CHARS - head.length - 5)}…` : reply;
    return `${head}\n\n${body}`;
}

/** 把结果推给选中的人/群；按频道分批，执行时再校验一次权限（角色或推送范围可能已变）。返回每个对象的结果。 */
async function pushResult(schedule, row, reply, push) {
    const results = [];
    const byChannel = new Map();
    for (const target of schedule.targets) {
        if (!byChannel.has(target.channel)) byChannel.set(target.channel, []);
        byChannel.get(target.channel).push(target);
    }
    const text = pushText(schedule, reply);
    for (const [channel, targets] of byChannel) {
        let allowed = targets;
        try {
            await resolveTargets(targets, row.role);
        } catch (error) {
            // 单个对象不再允许时逐个判断，其余照常推送
            allowed = [];
            for (const target of targets) {
                try {
                    await resolveTargets([target], row.role);
                    allowed.push(target);
                } catch (targetError) {
                    results.push({ ...target, ok: false, error: targetError.message });
                }
            }
        }
        if (!allowed.length) continue;
        try {
            const result = await push({ channel, text, targets: allowed.map(({ kind, id }) => ({ kind, id })), trigger: 'scheduled', source: `dragon-claw-schedule:${schedule.id}:${row.owner}` });
            for (const target of allowed) {
                const item = (result?.results || []).find(entry => entry.kind === target.kind && String(entry.id) === target.id);
                results.push({ ...target, ok: Boolean(item ? item.ok : result?.sent), error: item?.error || (item || result?.sent ? '' : '推送未成功') });
            }
        } catch (error) {
            allowed.forEach(target => results.push({ ...target, ok: false, error: error.message }));
        }
    }
    return { at: now(), sent: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length, results };
}

/** 认领：把 next_run_at 推进到下一次（一次性任务清空并标为执行中），返回是否抢到。 */
async function claim(row, next) {
    const result = await run(`UPDATE dragon_claw_schedules SET next_run_at = ?, status = ?, updated_at = ?
        WHERE id = ? AND status = 'active' AND next_run_at = ?`,
    [next ? next.toISOString() : null, row.kind === 'once' ? 'running' : 'active', now(), row.id, row.next_run_at]);
    return Boolean(result?.changes);
}

async function execute(row, firedAt = new Date(), { push = options => require('./channels').push(options) } = {}) {
    const schedule = toSchedule(row);
    const next = row.kind === 'recurring' ? parser.nextRecurring(schedule.rule, firedAt, schedule.timezone, await workdays()) : null;
    if (!(await claim(row, next))) return { skipped: true };
    try {
        const result = await runTurn(schedule, row, firedAt);
        const pushed = schedule.targets.length && result.reply ? await pushResult(schedule, row, result.reply, push) : null;
        if (pushed) await run('UPDATE dragon_claw_schedules SET last_push_json = ? WHERE id = ?', [JSON.stringify(pushed), row.id]);
        await run(`UPDATE dragon_claw_schedules SET session_id = ?, last_run_at = ?, last_status = 'ok', last_error = NULL, last_reply = ?,
            run_count = run_count + 1, status = CASE WHEN status = 'running' THEN 'done' ELSE status END, updated_at = ? WHERE id = ?`,
        [result.sessionId || row.session_id, now(), result.reply.slice(0, 600), now(), row.id]);
        return { ran: true };
    } catch (error) {
        if (error.busy) {
            // 对话正在压缩/执行：恢复到期状态，稍后重试（不计入执行次数）
            await run("UPDATE dragon_claw_schedules SET next_run_at = ?, status = CASE WHEN status = 'running' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?",
                [new Date(Date.now() + BUSY_RETRY_MS).toISOString(), now(), row.id]);
            return { retry: true };
        }
        await run(`UPDATE dragon_claw_schedules SET session_id = COALESCE(?, session_id), last_run_at = ?, last_status = 'failed', last_error = ?,
            run_count = run_count + 1, status = CASE WHEN status = 'running' THEN 'failed' ELSE status END, updated_at = ? WHERE id = ?`,
        [error.sessionId || null, now(), String(error.message || error).slice(0, 500), now(), row.id]);
        return { failed: true, error: error.message };
    }
}

async function runTenant(tenantId, { now: at = new Date(), push } = {}) {
    return runWithTenant(tenantId, async () => {
        await ensureSchema();
        // 服务重启时中断的一次性任务：标为失败，避免永远停在「执行中」
        await run("UPDATE dragon_claw_schedules SET status = 'failed', last_status = 'failed', last_error = '执行过程中服务重启', updated_at = ? WHERE status = 'running' AND updated_at < ?",
            [now(), new Date(at.getTime() - RUN_TIMEOUT_MS - 60000).toISOString()]);
        const due = await all("SELECT * FROM dragon_claw_schedules WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT ?", [at.toISOString(), BATCH]);
        let ran = 0;
        for (const row of due) {
            const result = await execute(row, at, push ? { push } : undefined);
            if (result.ran) ran += 1;
        }
        return { checked: due.length, ran };
    });
}

async function tick(listTenantIds) {
    if (ticking) return;
    ticking = true;
    try {
        const ids = new Set(['default']);
        try { (await listTenantIds()).forEach(id => id && ids.add(id)); } catch { /* 只处理默认租户 */ }
        for (const tenantId of ids) {
            try {
                await runTenant(tenantId);
            } catch (error) {
                console.warn(`[DragonClaw] 租户 ${tenantId} 定时任务处理失败：${error.message}`);
            }
        }
    } finally {
        ticking = false;
    }
}

function start(listTenantIds) {
    if (timer) return;
    timer = setInterval(() => { tick(listTenantIds); }, TICK_MS);
    if (typeof timer.unref === 'function') timer.unref();
    setTimeout(() => tick(listTenantIds), 20 * 1000).unref?.();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = { create, list, listForTarget, countActive, cancel, getForOwner, execute, runTenant, tick, start, stop, ensureSchema };
