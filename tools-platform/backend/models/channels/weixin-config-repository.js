// 微信频道配置：与 WeLink 一样存放在当前租户的 sys_kv_store（租户隔离）。
// 助理行为、访问控制、主动推送的结构与 WeLink 完全一致（复用同一套规范化与前端卡片）；
// 连接部分换成 iLink bot：baseUrl + bot token（扫码或从本机 OpenClaw 导入）。
// token 只在后端使用，对外只返回掩码。get_updates_buf 游标与各联系人 context_token 单独存放，避免每次保存配置都改写。
const { readKV, writeKV } = require('../kv-store');
const welinkConfig = require('./welink-config-repository');
const { DEFAULT_BASE_URL } = require('./weixin-ilink-client');

const CATEGORY = 'channels';
const KEY = 'weixin_config';
const STATE_KEY = 'weixin_state';

const DEFAULT_CONFIG = {
    enabled: false,
    baseUrl: DEFAULT_BASE_URL,
    token: '',
    botId: '',
    ownerUserId: '',
    botAgent: 'ToolsPlatform/1.0',
    source: '',
    assistantInfo: null,
    replyEngine: 'dragon-claw',
    modelId: '',
    slashCommandsEnabled: true,
    deniedReply: '抱歉，你暂无权限使用该助理，如需开通请联系平台管理员。',
    access: {
        users: { mode: 'all', whitelist: [], blacklist: [] },
        groups: { mode: 'all', whitelist: [], blacklist: [] }
    },
    push: {
        defaultTargets: [],
        allowUserPush: false
    },
    updatedAt: null
};

function clean(value, max = 200) {
    return String(value ?? '').trim().slice(0, max);
}

function normalizeBaseUrl(value) {
    const url = clean(value, 500);
    return /^https?:\/\//i.test(url) ? url.replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

function normalizeConfig(input = {}) {
    const base = { ...DEFAULT_CONFIG, ...input };
    const access = input.access || {};
    const push = input.push || {};
    return {
        enabled: base.enabled === true,
        baseUrl: normalizeBaseUrl(base.baseUrl),
        token: clean(base.token, 500),
        botId: clean(base.botId, 200),
        ownerUserId: clean(base.ownerUserId, 200),
        botAgent: clean(base.botAgent, 120) || DEFAULT_CONFIG.botAgent,
        source: ['qrcode', 'openclaw', 'manual'].includes(base.source) ? base.source : '',
        assistantInfo: base.assistantInfo && typeof base.assistantInfo === 'object' ? { name: clean(base.assistantInfo.name, 120), desc: clean(base.assistantInfo.desc, 500) } : null,
        replyEngine: welinkConfig.REPLY_ENGINES.includes(base.replyEngine) ? base.replyEngine : 'dragon-claw',
        modelId: clean(base.modelId, 100),
        slashCommandsEnabled: base.slashCommandsEnabled !== false,
        deniedReply: String(base.deniedReply ?? DEFAULT_CONFIG.deniedReply).slice(0, 500),
        access: {
            users: welinkConfig.normalizeAccessRule(access.users),
            groups: welinkConfig.normalizeAccessRule(access.groups)
        },
        push: {
            defaultTargets: welinkConfig.normalizeTargets(push.defaultTargets),
            allowUserPush: push.allowUserPush === true
        },
        updatedAt: base.updatedAt || null
    };
}

/** 完整配置（含 token），仅后端使用。 */
async function getConfig() {
    return normalizeConfig(await readKV(CATEGORY, KEY, DEFAULT_CONFIG) || DEFAULT_CONFIG);
}

/** 返回给前端的配置：token 替换为掩码。 */
function toPublic(config) {
    const { token, ...rest } = config;
    return { ...rest, hasToken: Boolean(token), maskedToken: welinkConfig.maskSecret(token) };
}

async function getPublicConfig() {
    return toPublic(await getConfig());
}

/** 合并保存；token 为空或等于掩码时保留原值，clearToken=true 时清空。 */
async function saveConfig(patch = {}) {
    const current = await getConfig();
    const next = { ...current, ...patch };
    if (patch.access) next.access = { ...current.access, ...patch.access };
    if (patch.push) next.push = { ...current.push, ...patch.push };
    const incoming = clean(patch.token, 500);
    if (patch.clearToken === true) next.token = '';
    else if (!incoming || incoming === welinkConfig.maskSecret(current.token)) next.token = current.token;
    delete next.clearToken;
    delete next.hasToken;
    delete next.maskedToken;
    const normalized = normalizeConfig({ ...next, updatedAt: new Date().toISOString() });
    await writeKV(CATEGORY, KEY, normalized);
    // 换了 bot（token 变化）时旧游标与 context_token 不再有效
    if (normalized.token !== current.token) await saveState({ getUpdatesBuf: '', contextTokens: {} });
    return normalized;
}

/** 影响连接的字段；变化时需要重连。 */
function connectionFingerprint(config) {
    return JSON.stringify([config.baseUrl, config.token, config.botAgent]);
}

// ── 运行状态：长轮询游标 + 每个联系人最近的 context_token（主动推送需要） ──

async function getState() {
    const state = await readKV(CATEGORY, STATE_KEY, null) || {};
    return {
        getUpdatesBuf: String(state.getUpdatesBuf || ''),
        contextTokens: state.contextTokens && typeof state.contextTokens === 'object' ? state.contextTokens : {}
    };
}

async function saveState(patch = {}) {
    const current = await getState();
    const next = { ...current, ...patch };
    await writeKV(CATEGORY, STATE_KEY, next);
    return next;
}

module.exports = {
    DEFAULT_CONFIG,
    normalizeConfig,
    normalizeTargets: welinkConfig.normalizeTargets,
    getConfig,
    getPublicConfig,
    toPublic,
    saveConfig,
    connectionFingerprint,
    getState,
    saveState
};
