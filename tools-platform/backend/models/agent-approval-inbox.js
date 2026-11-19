// 「需要你」收件箱：跨对话汇总正在等审批的操作，超过设定时间没人处理就推送到 WeLink / 微信的指定群组或个人。
// - 审批本身仍由 agent-run-manager 的 pendingApprovals 结算（内存态，服务重启即失效），这里只登记副本、负责通知；
// - 推送设置按账号存当前租户 tools.db（agent_inbox_settings）；只有所选频道当前连接正常时才推送；
// - 机器人频道（WeLink 助理、微信）里回复「批准 1234」/「拒绝 1234」直接结算；welink-cli 以本人身份发送，收不到回复，只做提醒。
const crypto = require('crypto');
const { run, get } = require('./app-db');
const { getTenantId, runWithTenant } = require('./tenant-context');
const { redactText } = require('./ai-sensitive-data');

const CHANNELS = ['welink', 'weixin', 'welink-cli'];
const CHANNEL_LABELS = { welink: 'WeLink 助理', weixin: '微信', 'welink-cli': 'WeLink 个人身份（welink-cli）' };
const DELAYS = [0, 30, 60, 120, 300];
const DEFAULT_SETTINGS = { enabled: false, channel: 'welink', targets: [], delaySec: 30 };
const MAX_TARGETS = 20;
const RESOLVED_KEEP_MS = 30 * 60 * 1000;

const entries = new Map();   // approvalId → entry
const resolved = new Map();  // approvalId → { code, title, decision, via, at, tenantId, targets }
const lastPush = new Map();  // `${tenantId}\n${username}` → { at, ok, error, channel }
const pendingSchedules = new Set(); // 进行中的异步推送调度，供测试收尾等待落盘完成

const APPROVE_RE = /^(?:批准|允许|同意|通过|确认|approve|allow|yes|ok)\s*[：:#]?\s*(\d{4})\s*[。.!！]?$/i;
const DENY_RE = /^(?:拒绝|驳回|不同意|不允许|deny|reject|no)\s*[：:#]?\s*(\d{4})\s*[。.!！]?$/i;

function inboxError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

// ── 设置 ──────────────────────────────────────────────────
const ready = new WeakMap();
async function ensureSchema() {
    const connection = require('./app-db').getDatabase();
    if (!ready.has(connection)) {
        const pending = run(`CREATE TABLE IF NOT EXISTS agent_inbox_settings (
            username TEXT PRIMARY KEY,
            json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )`);
        ready.set(connection, pending);
        pending.catch(() => ready.delete(connection));
    }
    return ready.get(connection);
}

function normalizeTargets(list) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
        const kind = item?.kind === 'group' ? 'group' : 'user';
        const id = String(item?.id || '').trim().slice(0, 200);
        if (!id || seen.has(`${kind}:${id}`)) continue;
        seen.add(`${kind}:${id}`);
        out.push({ kind, id, name: String(item?.name || id).trim().slice(0, 80) });
        if (out.length >= MAX_TARGETS) break;
    }
    return out;
}

function normalizeSettings(raw = {}) {
    const channel = CHANNELS.includes(raw.channel) ? raw.channel : DEFAULT_SETTINGS.channel;
    const delay = Number(raw.delaySec);
    let targets = normalizeTargets(raw.targets);
    if (channel === 'weixin') targets = targets.filter(item => item.kind === 'user'); // 微信助理不能推群
    return {
        enabled: raw.enabled === true,
        channel,
        targets,
        delaySec: DELAYS.includes(delay) ? delay : DEFAULT_SETTINGS.delaySec
    };
}

async function getSettings(username) {
    await ensureSchema();
    const row = await get('SELECT json FROM agent_inbox_settings WHERE username = ?', [String(username || '')]);
    let parsed = {};
    try { parsed = row ? JSON.parse(row.json) : {}; } catch { parsed = {}; }
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...parsed });
}

async function saveSettings(username, patch = {}) {
    if (!username) throw inboxError('INBOX_USER_REQUIRED', '缺少账号');
    const next = normalizeSettings({ ...(await getSettings(username)), ...patch });
    if (next.enabled) {
        if (!next.targets.length) throw inboxError('INBOX_TARGETS_REQUIRED', '请先选择接收审批的人员或群组');
        const status = await channelStatus(next.channel);
        if (!status.ok) throw inboxError('INBOX_CHANNEL_UNAVAILABLE', `${CHANNEL_LABELS[next.channel]} 当前不可用：${status.reason}`);
    }
    await run(`INSERT INTO agent_inbox_settings (username, json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [String(username), JSON.stringify(next), new Date().toISOString()]);
    return next;
}

// ── 频道可用性 ─────────────────────────────────────────────
/** { ok, reason, canReply, groups } —— 只把「已对接且连接正常」视为可用 */
async function channelStatus(channel) {
    try {
        if (channel === 'welink-cli') {
            const runner = require('./channels/welink-cli-runner');
            if (!runner.tenantAllowed()) return { ok: false, reason: '只在默认租户可用（使用本机登录的个人身份）' };
            const config = runner.readConfig();
            if (!config.enabled) return { ok: false, reason: '未启用 welink-cli' };
            if (!config.allowWrite) return { ok: false, reason: 'welink-cli 未开启「允许写操作」，不能发消息' };
            const install = await runner.detect();
            if (!install.available) return { ok: false, reason: install.hint || '未检测到 welink-cli' };
            return { ok: true, reason: '', canReply: false, groups: true };
        }
        const status = await require('./channels').getStatus({ channel });
        if (!status.enabled) return { ok: false, reason: status.disabledHint || '频道未启用' };
        if (!status.connected) return { ok: false, reason: status.runtime?.failureReason || '频道未连接' };
        return { ok: true, reason: '', canReply: true, groups: channel !== 'weixin' };
    } catch (error) {
        return { ok: false, reason: error.message || String(error) };
    }
}

async function listChannels() {
    return Promise.all(CHANNELS.map(async channel => ({ channel, label: CHANNEL_LABELS[channel], ...(await channelStatus(channel)) })));
}

// ── 登记 / 结算 ────────────────────────────────────────────
function pickCode(tenantId) {
    const taken = new Set([...entries.values(), ...resolved.values()].filter(item => item.tenantId === tenantId).map(item => item.code));
    try {
        for (const item of require('./channels/channel-pending-actions')._internal.pending.values()) taken.add(item.code);
    } catch { /* 可选：避免与频道「确认 1234」撞码 */ }
    let code;
    do code = String(crypto.randomInt(1000, 10000)); while (taken.has(code));
    return code;
}

const TOOL_LABELS = {
    run_command: '执行命令', write_file: '写入文件', edit_file: '修改文件', delete_path: '删除文件', move_path: '移动文件',
    save_skill: '保存技能', browser_action: '浏览器操作'
};

function describe(tool, args = {}) {
    const label = TOOL_LABELS[tool] || tool;
    const detail = args.command || args.path || args.file || args.url || args.id || args.name || '';
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
    return { label, detail: redactText(String(text).replace(/\s+/g, ' ').slice(0, 300)) };
}

/** agent-run-manager 新建审批时调用 */
function add({ id, owner, chatSessionId = '', tool, args, settle, expiresInMs }) {
    if (!id || typeof settle !== 'function') return;
    const tenantId = getTenantId();
    const username = String(owner || '').split('::').slice(1).join('::');
    const { label, detail } = describe(tool, args);
    const entry = {
        id, owner, tenantId, username, chatSessionId: String(chatSessionId || ''), tool, label, detail,
        code: pickCode(tenantId), settle, createdAt: Date.now(), expiresAt: Date.now() + (expiresInMs || 0),
        pushed: null, timer: null
    };
    entries.set(id, entry);
    const task = schedulePush(entry).catch(error => console.warn('[inbox] schedule failed:', error.message || error));
    pendingSchedules.add(task);
    task.finally(() => pendingSchedules.delete(task));
}

/** 审批已结算（任何来源：网页、频道回复、超时、中止） */
function remove(id, decision, via = 'web') {
    const entry = entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entries.delete(id);
    if (entry.pushed) {
        resolved.set(id, { code: entry.code, label: entry.label, detail: entry.detail, decision, via, at: Date.now(), tenantId: entry.tenantId, targets: entry.pushed.targets, channel: entry.pushed.channel });
        for (const [key, item] of resolved) if (Date.now() - item.at > RESOLVED_KEEP_MS) resolved.delete(key);
    }
}

async function list(owner) {
    const items = [...entries.values()].filter(item => item.owner === owner).sort((a, b) => b.createdAt - a.createdAt);
    const titles = new Map(await Promise.all([...new Set(items.map(item => item.chatSessionId))].map(async id => [id, await sessionTitle(id)])));
    return items.map(item => ({
        id: item.id, chatSessionId: item.chatSessionId, title: titles.get(item.chatSessionId) || '', tool: item.tool, label: item.label, detail: item.detail, code: item.code,
        createdAt: new Date(item.createdAt).toISOString(), expiresAt: new Date(item.expiresAt).toISOString(),
        pushed: item.pushed ? { channel: item.pushed.channel, at: new Date(item.pushed.at).toISOString(), ok: item.pushed.ok, error: item.pushed.error || '' } : null,
        pushError: item.pushError || ''
    }));
}

async function sessionTitle(chatSessionId) {
    if (!chatSessionId) return '';
    try {
        const row = await get('SELECT auto_title, page_title FROM ai_chat_sessions WHERE id = ?', [chatSessionId]);
        return String(row?.auto_title || row?.page_title || '').slice(0, 60);
    } catch { return ''; }
}

// ── 推送 ──────────────────────────────────────────────────
function messageText(entry, title, canReply) {
    const minutes = Math.max(1, Math.round((entry.expiresAt - Date.now()) / 60000));
    const lines = [
        '**🔔 Dragon Claw 需要你审批**',
        `操作：${entry.label}${entry.detail ? `\n内容：${entry.detail}` : ''}`,
        title ? `对话：${title}` : '',
        `发起人：${entry.username || '未知'}`,
        canReply
            ? `回复「批准 ${entry.code}」放行，回复「拒绝 ${entry.code}」拒绝（${minutes} 分钟内有效）。`
            : `请在 Dragon Claw 网页的「需要你」里处理（${minutes} 分钟内有效）。`
    ];
    return lines.filter(Boolean).join('\n');
}

async function sendVia(channel, targets, text) {
    if (channel === 'welink-cli') {
        const agent = require('./channels/welink-cli-agent');
        const runner = require('./channels/welink-cli-runner');
        const results = [];
        for (const target of targets) {
            const built = agent.buildArgs(target.kind === 'group'
                ? { command: 'im send-to-group', options: { 'group-id': target.id, text } }
                : { command: 'im send-to-user', options: { receiver: target.id, text } }, { mode: 'write' });
            const result = await runner.run(built.args);
            results.push({ ...target, ok: result.ok, error: result.error || '' });
        }
        return { results, sent: results.filter(item => item.ok).length };
    }
    return require('./channels').push({ channel, text, targets, trigger: 'system', source: 'Dragon Claw 审批' });
}

async function pushEntry(entry, settings) {
    const status = await channelStatus(settings.channel);
    if (!status.ok) throw inboxError('INBOX_CHANNEL_UNAVAILABLE', `${CHANNEL_LABELS[settings.channel]} 当前不可用：${status.reason}`);
    const text = messageText(entry, await sessionTitle(entry.chatSessionId), status.canReply);
    const result = await sendVia(settings.channel, settings.targets, text);
    const failed = (result.results || []).filter(item => !item.ok);
    const sent = Number(result.sent ?? (result.results || []).length - failed.length);
    if (!sent) throw inboxError('INBOX_PUSH_FAILED', failed.map(item => `${item.name || item.id}：${item.error}`).join('；') || '推送失败');
    return { sent, failed };
}

async function schedulePush(entry) {
    // 若同微任务内已完成审批（例如测试或秒批），无需打开数据库读设置
    await Promise.resolve();
    if (!entries.has(entry.id)) return;
    const settings = await getSettings(entry.username);
    if (!entries.has(entry.id) || !settings.enabled || !settings.targets.length) return;
    entry.timer = setTimeout(() => {
        if (!entries.has(entry.id)) return;
        runWithTenant(entry.tenantId, async () => {
            const key = `${entry.tenantId}\n${entry.username}`;
            try {
                const fresh = await getSettings(entry.username);
                if (!fresh.enabled || !fresh.targets.length || !entries.has(entry.id)) return;
                const { failed } = await pushEntry(entry, fresh);
                entry.pushed = { channel: fresh.channel, targets: fresh.targets, at: Date.now(), ok: true, error: failed.length ? `部分失败：${failed.map(item => item.name || item.id).join('、')}` : '' };
                lastPush.set(key, { at: Date.now(), ok: true, channel: fresh.channel, error: entry.pushed.error });
            } catch (error) {
                entry.pushed = null;
                entry.pushError = error.message;
                lastPush.set(key, { at: Date.now(), ok: false, channel: settings.channel, error: error.message });
                console.warn('[inbox] push failed:', error.message || error);
            }
        }).catch(() => {});
    }, settings.delaySec * 1000);
    if (typeof entry.timer.unref === 'function') entry.timer.unref();
}

/** 设置页「发送测试」 */
async function sendTest(username, patch = {}) {
    const settings = normalizeSettings({ ...(await getSettings(username)), ...patch });
    if (!settings.targets.length) throw inboxError('INBOX_TARGETS_REQUIRED', '请先选择接收审批的人员或群组');
    const status = await channelStatus(settings.channel);
    if (!status.ok) throw inboxError('INBOX_CHANNEL_UNAVAILABLE', `${CHANNEL_LABELS[settings.channel]} 当前不可用：${status.reason}`);
    const text = `**🔔 Dragon Claw 审批通知测试**\n以后 ${username} 的任务需要审批、${settings.delaySec ? `${settings.delaySec} 秒内` : '立即'}没处理时，会发到这里。${status.canReply ? '\n收到后回复「批准 四位码」即可放行。' : ''}`;
    const result = await sendVia(settings.channel, settings.targets, text);
    return { ok: true, sent: result.sent, results: result.results || [] };
}

function lastPushOf(username) {
    const item = lastPush.get(`${getTenantId()}\n${username}`);
    return item ? { ...item, at: new Date(item.at).toISOString() } : null;
}

// ── 频道回复 ───────────────────────────────────────────────
function matchesTarget(targets, conversation) {
    return (targets || []).some(item => item.kind === conversation.kind && item.id === conversation.id);
}

/** 频道桥在交给 AI 前调用：回复「批准/拒绝 1234」且码属于推送到本会话的审批时，结算并返回回复文本；否则 null */
function handleReply({ channel, conversation, actor = '', text }) {
    const message = String(text || '').trim();
    if (!conversation?.id || message.length > 30) return null;
    const approve = APPROVE_RE.exec(message);
    const deny = !approve && DENY_RE.exec(message);
    if (!approve && !deny) return null;
    const code = (approve || deny)[1];
    const tenantId = getTenantId();
    const entry = [...entries.values()].find(item => item.tenantId === tenantId && item.code === code
        && item.pushed?.channel === channel && matchesTarget(item.pushed.targets, conversation));
    if (!entry) {
        const done = [...resolved.values()].find(item => item.tenantId === tenantId && item.code === code && item.channel === channel && matchesTarget(item.targets, conversation));
        if (!done) return null; // 不是我们的码，交给其他确认流程（如频道「确认 1234」）
        const what = { allow: '已批准', always: '已批准', deny: '已拒绝', timeout: '已超时', abort: '任务已停止' }[done.decision] || '已处理';
        return `这个审批（${done.code}）${what}${done.via === 'web' ? '（在网页处理）' : ''}，不需要再操作。`;
    }
    const decision = approve ? 'allow' : 'deny';
    const by = String(actor || conversation.id);
    console.info(`[inbox] ${decision} ${entry.code} via ${channel} by ${by}`);
    entry.settle(decision, '', `${channel}:${by}`);
    return approve
        ? `✅ 已批准「${entry.label}」，任务继续执行。${entry.detail ? `\n${entry.detail}` : ''}`
        : `🚫 已拒绝「${entry.label}」，操作不会执行。`;
}

async function flushPending() {
    while (pendingSchedules.size) await Promise.allSettled([...pendingSchedules]);
}

module.exports = {
    CHANNELS, CHANNEL_LABELS, DELAYS,
    add, remove, list, handleReply, flushPending,
    getSettings, saveSettings, listChannels, channelStatus, sendTest, lastPushOf,
    _internal: { entries, resolved, normalizeSettings, messageText, APPROVE_RE, DENY_RE }
};
