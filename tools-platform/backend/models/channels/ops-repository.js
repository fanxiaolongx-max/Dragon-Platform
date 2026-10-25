// 自动化运营群组的数据（当前租户 tools.db）：
// - ops_groups：被标记为「运营群组」的频道会话（WeLink 群、微信联系人等），带群画像与互动人设；
// - ops_plans：运营计划——推给哪些群、生成什么内容（提示词或模板 + 素材）、什么时候发、自动发还是先出草稿；
// - ops_runs：每次生成/推送的记录，草稿也在这里等待确认。
// 全局运营规范（话术风格、平台访问地址）放在 sys_kv_store，由 @ops-group Skill 读写。
const crypto = require('crypto');
const { run, get, all, getDatabase } = require('../app-db');
const { readKV, writeKV } = require('../kv-store');
const opsSchedule = require('./ops-schedule');

const CHANNELS = ['welink', 'weixin'];
const KINDS = ['user', 'group'];
const CONTENT_MODES = ['ai', 'template'];
const SEND_MODES = ['draft', 'auto'];
const SOURCES = ['highlights', 'features', 'videos', 'metrics', 'chat'];
const RUN_STATUSES = ['generating', 'draft', 'sending', 'sent', 'partial', 'failed', 'discarded'];
const MAX_TARGETS = 50;
const RUN_KEEP = 1000;
const SETTINGS_KEY = 'ops_settings';
const DEFAULT_SETTINGS = {
    styleGuide: [
        '- 语气轻松友好，像群里的热心同事，不说教；适当使用 emoji，但每条不超过 5 个。',
        '- 先给一句吸引注意的开场，再给干货；正文控制在 300 字以内，分点清晰。',
        '- 介绍平台功能时说清「解决什么问题、在哪里打开、一句话怎么用」，并附上访问链接。',
        '- 结尾抛出一个轻松的问题或小互动（投票、竞猜、征集用法），鼓励群成员 @助手 回复。',
        '- 不编造数据；引用指标时注明数据时间。'
    ].join('\n'),
    publicBaseUrl: '',
    updatedAt: null
};
const initializations = new WeakMap();

function now() {
    return new Date().toISOString();
}

function clip(value, max) {
    return String(value ?? '').trim().slice(0, max);
}

function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
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
            await run(`CREATE TABLE IF NOT EXISTS ops_groups (
                channel TEXT NOT NULL,
                kind TEXT NOT NULL,
                target_id TEXT NOT NULL,
                name TEXT,
                profile TEXT,
                interaction_prompt TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (channel, kind, target_id)
            )`);
            await run(`CREATE TABLE IF NOT EXISTS ops_plans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                targets_json TEXT NOT NULL,
                content_mode TEXT NOT NULL DEFAULT 'ai',
                prompt TEXT,
                template TEXT,
                sources_json TEXT,
                options_json TEXT,
                schedule_json TEXT NOT NULL,
                send_mode TEXT NOT NULL DEFAULT 'draft',
                next_run_at TEXT,
                last_run_at TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_ops_plans_due ON ops_plans(enabled, next_run_at)');
            await run(`CREATE TABLE IF NOT EXISTS ops_runs (
                id TEXT PRIMARY KEY,
                plan_id TEXT,
                plan_name TEXT,
                trigger TEXT NOT NULL,
                status TEXT NOT NULL,
                content TEXT,
                targets_json TEXT,
                results_json TEXT,
                meta_json TEXT,
                error TEXT,
                created_by TEXT,
                created_at TEXT NOT NULL,
                sent_at TEXT
            )`);
            await run('CREATE INDEX IF NOT EXISTS idx_ops_runs_created ON ops_runs(created_at DESC)');
            await run('CREATE INDEX IF NOT EXISTS idx_ops_runs_plan ON ops_runs(plan_id, created_at DESC)');
        })();
        initializations.set(connection, pending);
        pending.catch(() => initializations.delete(connection));
    }
    return initializations.get(connection);
}

// ── 全局运营规范 ─────────────────────────────────────────

async function getSettings() {
    const stored = await readKV('channels', SETTINGS_KEY, null) || {};
    return {
        styleGuide: String(stored.styleGuide ?? DEFAULT_SETTINGS.styleGuide).slice(0, 6000),
        publicBaseUrl: clip(stored.publicBaseUrl ?? '', 300).replace(/\/+$/, ''),
        updatedAt: stored.updatedAt || null
    };
}

async function saveSettings(patch = {}) {
    const current = await getSettings();
    const next = { ...current };
    if (patch.styleGuide !== undefined) next.styleGuide = String(patch.styleGuide || '').slice(0, 6000) || DEFAULT_SETTINGS.styleGuide;
    if (patch.publicBaseUrl !== undefined) {
        const url = clip(patch.publicBaseUrl, 300).replace(/\/+$/, '');
        if (url && !/^https?:\/\//i.test(url)) throw serviceError('OPS_URL_INVALID', '平台访问地址需以 http:// 或 https:// 开头');
        next.publicBaseUrl = url;
    }
    next.updatedAt = now();
    await writeKV('channels', SETTINGS_KEY, next);
    return next;
}

// ── 运营群组 ─────────────────────────────────────────────

function mapGroup(row) {
    if (!row) return null;
    return {
        channel: row.channel,
        kind: row.kind,
        id: row.target_id,
        name: row.name || row.target_id,
        profile: row.profile || '',
        interactionPrompt: row.interaction_prompt || '',
        enabled: Boolean(row.enabled),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function normalizeRef(input = {}) {
    const channel = CHANNELS.includes(input.channel) ? input.channel : '';
    const kind = KINDS.includes(input.kind) ? input.kind : '';
    const id = clip(input.id, 200);
    if (!channel || !kind || !id) throw serviceError('OPS_TARGET_INVALID', '运营对象需要 channel（welink/weixin）、kind（group/user）与 id');
    if (channel === 'weixin' && kind === 'group') throw serviceError('OPS_TARGET_UNSUPPORTED', '微信助理暂不支持群推送，请选择微信联系人');
    return { channel, kind, id };
}

async function listGroups({ channel, enabledOnly = false } = {}) {
    await ensureSchema();
    const where = [];
    const params = [];
    if (CHANNELS.includes(channel)) { where.push('channel = ?'); params.push(channel); }
    if (enabledOnly) where.push('enabled = 1');
    const rows = await all(`SELECT * FROM ops_groups${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`, params);
    return rows.map(mapGroup);
}

async function getGroup(channel, kind, id) {
    await ensureSchema();
    return mapGroup(await get('SELECT * FROM ops_groups WHERE channel = ? AND kind = ? AND target_id = ?', [channel, kind, id]));
}

async function saveGroup(input = {}) {
    const ref = normalizeRef(input);
    await ensureSchema();
    const current = await getGroup(ref.channel, ref.kind, ref.id);
    const at = now();
    const value = (key, max) => (input[key] !== undefined ? clip(input[key], max) : (current ? current[key] : ''));
    const enabled = input.enabled !== undefined ? input.enabled !== false : (current ? current.enabled : true);
    await run(`INSERT INTO ops_groups (channel, kind, target_id, name, profile, interaction_prompt, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, kind, target_id) DO UPDATE SET name = excluded.name, profile = excluded.profile,
            interaction_prompt = excluded.interaction_prompt, enabled = excluded.enabled, updated_at = excluded.updated_at`,
    [ref.channel, ref.kind, ref.id, value('name', 120) || null, value('profile', 2000), value('interactionPrompt', 3000), enabled ? 1 : 0, current?.createdAt || at, at]);
    return getGroup(ref.channel, ref.kind, ref.id);
}

async function removeGroup(channel, kind, id) {
    await ensureSchema();
    const result = await run('DELETE FROM ops_groups WHERE channel = ? AND kind = ? AND target_id = ?', [channel, kind, id]);
    return result.changes > 0;
}

// ── 运营计划 ─────────────────────────────────────────────

function normalizeTargets(list) {
    const seen = new Set();
    const targets = [];
    for (const item of Array.isArray(list) ? list : []) {
        const ref = normalizeRef(item);
        const key = `${ref.channel}:${ref.kind}:${ref.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        targets.push(ref);
    }
    return targets.slice(0, MAX_TARGETS);
}

function normalizeSources(input) {
    const list = Array.isArray(input) ? input : Object.keys(input || {}).filter(key => input[key]);
    return SOURCES.filter(key => list.includes(key));
}

/**
 * 计划选项：videoCategory 只从该媒体分类挑视频；featureDays 新功能回看天数；
 * highlightTopic / highlightCount 从内置亮点库的哪个专题抽几个亮点；angle 运营角度（random 为每次随机）。
 */
function normalizeOptions(input = {}) {
    return {
        videoCategory: clip(input.videoCategory, 120),
        featureDays: Math.min(90, Math.max(1, Math.round(Number(input.featureDays) || 7))),
        highlightTopic: clip(input.highlightTopic, 60) || 'ai-report',
        highlightCount: Math.min(5, Math.max(1, Math.round(Number(input.highlightCount) || 1))),
        angle: clip(input.angle, 40) || 'random'
    };
}

function mapPlan(row) {
    if (!row) return null;
    const schedule = opsSchedule.normalize(parseJson(row.schedule_json, {}));
    return {
        id: row.id,
        name: row.name,
        enabled: Boolean(row.enabled),
        targets: parseJson(row.targets_json, []),
        contentMode: row.content_mode,
        prompt: row.prompt || '',
        template: row.template || '',
        sources: parseJson(row.sources_json, []),
        options: normalizeOptions(parseJson(row.options_json, {})),
        schedule,
        scheduleText: opsSchedule.describe(schedule),
        sendMode: row.send_mode,
        nextRunAt: row.next_run_at || null,
        lastRunAt: row.last_run_at || null,
        createdBy: row.created_by || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function listPlans() {
    await ensureSchema();
    return (await all('SELECT * FROM ops_plans ORDER BY created_at ASC')).map(mapPlan);
}

async function getPlan(id) {
    await ensureSchema();
    return mapPlan(await get('SELECT * FROM ops_plans WHERE id = ?', [String(id || '')]));
}

/** 新建或修改计划（传 id 为修改，只改传入的字段）；calendar 用于计算下次运行时间。 */
async function savePlan(input = {}, { actor = '', calendar } = {}) {
    await ensureSchema();
    const current = input.id ? await getPlan(input.id) : null;
    if (input.id && !current) throw serviceError('OPS_PLAN_NOT_FOUND', '运营计划不存在', 404);
    const pick = (key, fallback) => (input[key] !== undefined ? input[key] : (current ? current[key] : fallback));
    const plan = {
        id: current?.id || newId('ops'),
        name: clip(pick('name', ''), 80),
        enabled: pick('enabled', false) === true, // 新计划默认不启用定时，测试满意后再开
        targets: input.targets !== undefined ? normalizeTargets(input.targets) : (current?.targets || []),
        contentMode: CONTENT_MODES.includes(pick('contentMode', 'ai')) ? pick('contentMode', 'ai') : 'ai',
        prompt: String(pick('prompt', '') || '').slice(0, 4000),
        template: String(pick('template', '') || '').slice(0, 4000),
        sources: input.sources !== undefined ? normalizeSources(input.sources) : (current?.sources || []),
        options: normalizeOptions({ ...(current?.options || {}), ...(input.options || {}) }),
        schedule: opsSchedule.normalize(pick('schedule', {})),
        sendMode: SEND_MODES.includes(pick('sendMode', 'draft')) ? pick('sendMode', 'draft') : 'draft'
    };
    if (!plan.name) throw serviceError('OPS_PLAN_INVALID', '请给运营计划起个名字');
    if (!plan.targets.length) throw serviceError('OPS_PLAN_INVALID', '请至少选择一个推送对象（运营群组）');
    if (plan.contentMode === 'ai' && !plan.prompt.trim()) throw serviceError('OPS_PLAN_INVALID', 'AI 生成模式需要填写运营提示词');
    if (plan.contentMode === 'template' && !plan.template.trim()) throw serviceError('OPS_PLAN_INVALID', '模板模式需要填写消息模板');
    const scheduleChanged = !current || JSON.stringify(current.schedule) !== JSON.stringify(plan.schedule) || current.enabled !== plan.enabled;
    const nextRunAt = !plan.enabled ? null
        : (scheduleChanged || !current.nextRunAt ? opsSchedule.nextRun(plan.schedule, new Date(), calendar)?.toISOString() || null : current.nextRunAt);
    const at = now();
    await run(`INSERT INTO ops_plans (id, name, enabled, targets_json, content_mode, prompt, template, sources_json, options_json, schedule_json, send_mode, next_run_at, last_run_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = excluded.enabled, targets_json = excluded.targets_json,
            content_mode = excluded.content_mode, prompt = excluded.prompt, template = excluded.template, sources_json = excluded.sources_json, options_json = excluded.options_json,
            schedule_json = excluded.schedule_json, send_mode = excluded.send_mode, next_run_at = excluded.next_run_at, updated_at = excluded.updated_at`,
    [plan.id, plan.name, plan.enabled ? 1 : 0, JSON.stringify(plan.targets), plan.contentMode, plan.prompt, plan.template, JSON.stringify(plan.sources), JSON.stringify(plan.options),
        JSON.stringify(plan.schedule), plan.sendMode, nextRunAt, current?.lastRunAt || null, current?.createdBy || clip(actor, 120), current?.createdAt || at, at]);
    return getPlan(plan.id);
}

async function deletePlan(id) {
    await ensureSchema();
    const result = await run('DELETE FROM ops_plans WHERE id = ?', [String(id || '')]);
    return result.changes > 0;
}

async function listDuePlans(nowIso, limit = 20) {
    await ensureSchema();
    return (await all('SELECT * FROM ops_plans WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?', [nowIso, limit])).map(mapPlan);
}

/** 抢占一次到期运行：只有 next_run_at 仍为预期值时才推进，避免多实例/重复 tick 重复发送。 */
async function claimPlanRun(plan, nextRunAt) {
    await ensureSchema();
    const result = await run('UPDATE ops_plans SET next_run_at = ?, last_run_at = ? WHERE id = ? AND next_run_at = ?', [nextRunAt, now(), plan.id, plan.nextRunAt]);
    return result.changes > 0;
}

// ── 运行记录 ─────────────────────────────────────────────

function mapRun(row) {
    if (!row) return null;
    return {
        id: row.id,
        planId: row.plan_id || '',
        planName: row.plan_name || '',
        trigger: row.trigger,
        status: row.status,
        content: row.content || '',
        targets: parseJson(row.targets_json, []),
        results: parseJson(row.results_json, []),
        meta: parseJson(row.meta_json, {}),
        error: row.error || '',
        createdBy: row.created_by || '',
        createdAt: row.created_at,
        sentAt: row.sent_at || null
    };
}

async function createRun({ planId = '', planName = '', trigger = 'manual', status = 'generating', content = '', targets = [], meta = {}, createdBy = '' }) {
    await ensureSchema();
    const id = newId('opr');
    await run(`INSERT INTO ops_runs (id, plan_id, plan_name, trigger, status, content, targets_json, meta_json, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, planId || null, clip(planName, 80), trigger, status, String(content || ''), JSON.stringify(targets), JSON.stringify(meta || {}), clip(createdBy, 120), now()]);
    const total = await get('SELECT COUNT(*) AS total FROM ops_runs');
    if (Number(total?.total) > RUN_KEEP + 100) {
        await run('DELETE FROM ops_runs WHERE id NOT IN (SELECT id FROM ops_runs ORDER BY created_at DESC LIMIT ?)', [RUN_KEEP]);
    }
    return getRun(id);
}

async function updateRun(id, patch = {}) {
    await ensureSchema();
    const sets = [];
    const params = [];
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(RUN_STATUSES.includes(patch.status) ? patch.status : 'failed'); }
    if (patch.content !== undefined) { sets.push('content = ?'); params.push(String(patch.content || '')); }
    if (patch.targets !== undefined) { sets.push('targets_json = ?'); params.push(JSON.stringify(patch.targets)); }
    if (patch.results !== undefined) { sets.push('results_json = ?'); params.push(JSON.stringify(patch.results)); }
    if (patch.meta !== undefined) { sets.push('meta_json = ?'); params.push(JSON.stringify(patch.meta || {})); }
    if (patch.error !== undefined) { sets.push('error = ?'); params.push(clip(patch.error, 1000)); }
    if (patch.sentAt !== undefined) { sets.push('sent_at = ?'); params.push(patch.sentAt); }
    if (sets.length) await run(`UPDATE ops_runs SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return getRun(id);
}

async function getRun(id) {
    await ensureSchema();
    return mapRun(await get('SELECT * FROM ops_runs WHERE id = ?', [String(id || '')]));
}

/** 该计划已经推送过（sent/partial）的视频，挑选素材时跳过。 */
async function sentVideoIds(planId) {
    await ensureSchema();
    const rows = await all("SELECT meta_json FROM ops_runs WHERE plan_id = ? AND status IN ('sent', 'partial') AND trigger != 'test' ORDER BY created_at DESC LIMIT 500", [planId]);
    return new Set(rows.map(row => parseJson(row.meta_json, {}).videoId).filter(Boolean));
}

/** 该计划最近几次正式运行（含草稿）的素材标记，用于亮点与运营角度去重。 */
async function recentRunMetas(planId, limit = 10) {
    await ensureSchema();
    const rows = await all("SELECT meta_json FROM ops_runs WHERE plan_id = ? AND status IN ('draft', 'sent', 'partial') AND trigger != 'test' ORDER BY created_at DESC LIMIT ?", [planId, limit]);
    return rows.map(row => parseJson(row.meta_json, {}));
}

async function listRuns({ planId, status, limit = 30 } = {}) {
    await ensureSchema();
    const where = [];
    const params = [];
    if (planId) { where.push('plan_id = ?'); params.push(planId); }
    if (RUN_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
    const size = Math.min(200, Math.max(1, Number(limit) || 30));
    return (await all(`SELECT * FROM ops_runs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`, [...params, size])).map(mapRun);
}

async function listRunsPage({ page = 1, pageSize = 20 } = {}) {
    await ensureSchema();
    const sizeValue = Number(pageSize);
    const size = Number.isFinite(sizeValue) && sizeValue > 0 ? Math.min(100, Math.max(1, Math.floor(sizeValue))) : 20;
    const total = Number((await get('SELECT COUNT(*) AS total FROM ops_runs'))?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / size));
    const pageValue = Number(page);
    const currentPage = Math.min(totalPages, Number.isFinite(pageValue) && pageValue > 0 ? Math.max(1, Math.floor(pageValue)) : 1);
    const items = (await all('SELECT * FROM ops_runs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [size, (currentPage - 1) * size])).map(mapRun);
    return { items, total, page: currentPage, pageSize: size, totalPages };
}

async function getDraftCountsByPlan() {
    await ensureSchema();
    const rows = await all("SELECT plan_id, COUNT(*) AS total FROM ops_runs WHERE status = 'draft' GROUP BY plan_id");
    return Object.fromEntries(rows.map(row => [row.plan_id || '', Number(row.total)]));
}

// 单独查询全部待确认记录，避免草稿被最近 40 条运行历史挤出确认入口。
async function listPendingRuns({ limit = 20, offset = 0 } = {}) {
    await ensureSchema();
    const size = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const total = Number((await get("SELECT COUNT(*) AS total FROM ops_runs WHERE status = 'draft'"))?.total || 0);
    const rows = await all("SELECT * FROM ops_runs WHERE status = 'draft' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", [size, start]);
    return { items: rows.map(mapRun), total, offset: start, hasMore: start + rows.length < total };
}

// 主页、设置和多个浏览器标签可能同时确认；必须在开始推送前原子抢占草稿。
async function changeDraft(id, { status = 'draft', content, expectedContent } = {}) {
    await ensureSchema();
    const sets = ['status = ?'];
    const params = [status];
    if (content !== undefined) { sets.push('content = ?'); params.push(content); }
    params.push(id);
    if (expectedContent !== undefined) params.push(expectedContent);
    const result = await run(`UPDATE ops_runs SET ${sets.join(', ')} WHERE id = ? AND status = 'draft'${expectedContent !== undefined ? ' AND content = ?' : ''}`, params);
    return result.changes > 0;
}

module.exports = {
    CHANNELS,
    CONTENT_MODES,
    SEND_MODES,
    SOURCES,
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    listGroups,
    getGroup,
    saveGroup,
    removeGroup,
    listPlans,
    getPlan,
    savePlan,
    deletePlan,
    listDuePlans,
    claimPlanRun,
    createRun,
    updateRun,
    getRun,
    listRuns,
    listRunsPage,
    getDraftCountsByPlan,
    listPendingRuns,
    changeDraft,
    sentVideoIds,
    recentRunMetas,
    normalizeTargets
};
