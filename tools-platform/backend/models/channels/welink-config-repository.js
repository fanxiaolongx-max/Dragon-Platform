// WeLink 频道对接配置：与 AI 配置一致，存放在当前租户的 sys_kv_store（租户隔离）。
// SK 只在后端使用，对外只返回掩码；保存时未修改的掩码值保留原 SK。
const { readKV, writeKV } = require('../kv-store');

const CATEGORY = 'channels';
const KEY = 'welink_config';
const ACCESS_MODES = ['all', 'whitelist', 'blacklist'];
const REPLY_ENGINES = ['dragon-claw', 'rule'];
const TARGET_KINDS = ['user', 'group'];
const MAX_LIST = 2000;

const DEFAULT_CONFIG = {
    enabled: false,
    environment: 'prod',
    gatewayUrl: '',
    channel: '',
    toolVersion: '1.0.0',
    ak: '',
    sk: '',
    sdkPath: '',
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

function normalizeIdList(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(item => clean(typeof item === 'object' && item ? item.id : item, 200))
        .filter(item => item && !seen.has(item) && seen.add(item))
        .slice(0, MAX_LIST);
}

function normalizeAccessRule(rule = {}) {
    return {
        mode: ACCESS_MODES.includes(rule.mode) ? rule.mode : 'all',
        whitelist: normalizeIdList(rule.whitelist),
        blacklist: normalizeIdList(rule.blacklist)
    };
}

function normalizeTargets(list) {
    const seen = new Set();
    return (Array.isArray(list) ? list : [])
        .map(item => ({ kind: TARGET_KINDS.includes(item?.kind) ? item.kind : '', id: clean(item?.id, 200) }))
        .filter(item => item.kind && item.id && !seen.has(`${item.kind}:${item.id}`) && seen.add(`${item.kind}:${item.id}`))
        .slice(0, MAX_LIST);
}

function normalizeConfig(input = {}) {
    const base = { ...DEFAULT_CONFIG, ...input };
    const access = input.access || {};
    const push = input.push || {};
    return {
        enabled: base.enabled === true,
        environment: base.environment === 'uat' ? 'uat' : 'prod',
        gatewayUrl: clean(base.gatewayUrl, 500),
        channel: clean(base.channel, 100),
        toolVersion: clean(base.toolVersion, 40) || '1.0.0',
        ak: clean(base.ak, 200),
        sk: clean(base.sk, 200),
        sdkPath: clean(base.sdkPath, 500),
        assistantInfo: base.assistantInfo && typeof base.assistantInfo === 'object' ? {
            name: clean(base.assistantInfo.name, 120),
            nameEn: clean(base.assistantInfo.nameEn, 120),
            desc: clean(base.assistantInfo.desc, 500),
            descEn: clean(base.assistantInfo.descEn, 500)
        } : null,
        replyEngine: REPLY_ENGINES.includes(base.replyEngine) ? base.replyEngine : 'dragon-claw',
        modelId: clean(base.modelId, 100),
        slashCommandsEnabled: base.slashCommandsEnabled !== false,
        deniedReply: String(base.deniedReply ?? DEFAULT_CONFIG.deniedReply).slice(0, 500),
        access: {
            users: normalizeAccessRule(access.users),
            groups: normalizeAccessRule(access.groups)
        },
        push: {
            defaultTargets: normalizeTargets(push.defaultTargets),
            allowUserPush: push.allowUserPush === true
        },
        updatedAt: base.updatedAt || null
    };
}

function maskSecret(value) {
    if (!value) return '';
    if (value.length <= 8) return '********';
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 完整配置（含 SK），仅后端使用。 */
async function getConfig() {
    return normalizeConfig(await readKV(CATEGORY, KEY, DEFAULT_CONFIG) || DEFAULT_CONFIG);
}

/** 返回给前端的配置：SK 替换为掩码。 */
function toPublic(config) {
    const { sk, ...rest } = config;
    return { ...rest, hasSk: Boolean(sk), maskedSk: maskSecret(sk) };
}

async function getPublicConfig() {
    return toPublic(await getConfig());
}

/** 合并保存；sk 为空或等于掩码时保留原值，clearSk=true 时清空。 */
async function saveConfig(patch = {}) {
    const current = await getConfig();
    const next = { ...current, ...patch };
    if (patch.access) next.access = { ...current.access, ...patch.access };
    if (patch.push) next.push = { ...current.push, ...patch.push };
    const incomingSk = clean(patch.sk, 200);
    if (patch.clearSk === true) next.sk = '';
    else if (!incomingSk || incomingSk === maskSecret(current.sk)) next.sk = current.sk;
    delete next.clearSk;
    delete next.hasSk;
    delete next.maskedSk;
    const normalized = normalizeConfig({ ...next, updatedAt: new Date().toISOString() });
    await writeKV(CATEGORY, KEY, normalized);
    return normalized;
}

/** 影响网关连接的字段；变化时需要重连。 */
function connectionFingerprint(config) {
    return JSON.stringify([config.environment, config.gatewayUrl, config.channel, config.toolVersion, config.ak, config.sk, config.sdkPath]);
}

/** 供脱敏使用：不得经 API 返回。 */
async function getSecrets() {
    const config = await getConfig();
    return [config.sk].filter(Boolean);
}

module.exports = {
    DEFAULT_CONFIG,
    ACCESS_MODES,
    TARGET_KINDS,
    normalizeConfig,
    normalizeTargets,
    maskSecret,
    getConfig,
    getPublicConfig,
    toPublic,
    saveConfig,
    connectionFingerprint,
    getSecrets
};
