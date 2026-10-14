const crypto = require('crypto');
const { readKV, writeKV } = require('./kv-store');

const PROFILE_STORE_KEY = 'ai_settings_profiles';
const LEGACY_SETTINGS_KEY = 'ai_settings';
const MODEL_ALIAS_KEY = 'ai_model_aliases';
const MAX_MODEL_ALIASES = 20;
// 从未配置过映射时，对话界面只提供一个品牌模型 Aragon，跟随当前激活方案。
const DEFAULT_MODEL_ALIASES = [{ id: 'aragon', name: 'Aragon', description: '', profileId: '' }];

const DEFAULT_SETTINGS = {
    provider: 'gemini',
    anthropicAuthType: 'ANTHROPIC_AUTH_TOKEN',
    apiBaseUrl: '',
    model: 'gemini-2.5-flash',
    apiKey: '',
    maxOutputTokens: 2048,
    temperature: 0.7,
    inputCostPerMillionUsd: 0.075,
    outputCostPerMillionUsd: 0.3,
    usdToCny: 7.2,
    systemPrompt: '',
    pptCopilotRules: ''
};

const DEFAULT_MODELS = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-sonnet-latest',
    minimax: 'MiniMax-M2.7-highspeed',
    'openai-compatible': 'gpt-4o-mini'
};

function normalizeProvider(value) {
    const provider = String(value || DEFAULT_SETTINGS.provider).trim().toLowerCase();
    return ['gemini', 'openai', 'anthropic', 'minimax', 'openai-compatible'].includes(provider) ? provider : 'gemini';
}

function normalizeAnthropicAuthType(value) {
    const type = String(value || '').trim().toUpperCase();
    return type === 'ANTHROPIC_API_KEY' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN';
}

function clampNumber(value, fallback, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
}

function normalizeSettings(input = {}, previous = {}) {
    const base = { ...DEFAULT_SETTINGS, ...previous, ...input };
    const provider = normalizeProvider(base.provider);
    return {
        provider,
        anthropicAuthType: normalizeAnthropicAuthType(base.anthropicAuthType),
        apiBaseUrl: String(base.apiBaseUrl || '').trim().slice(0, 500),
        model: String(base.model || DEFAULT_MODELS[provider] || DEFAULT_SETTINGS.model).trim() || DEFAULT_MODELS[provider],
        apiKey: String(base.apiKey || '').trim(),
        maxOutputTokens: Math.round(clampNumber(base.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens, 128, 8192)),
        temperature: clampNumber(base.temperature, DEFAULT_SETTINGS.temperature, 0, 2),
        inputCostPerMillionUsd: clampNumber(base.inputCostPerMillionUsd, DEFAULT_SETTINGS.inputCostPerMillionUsd, 0, 999),
        outputCostPerMillionUsd: clampNumber(base.outputCostPerMillionUsd, DEFAULT_SETTINGS.outputCostPerMillionUsd, 0, 999),
        usdToCny: clampNumber(base.usdToCny, DEFAULT_SETTINGS.usdToCny, 0, 99),
        systemPrompt: String(base.systemPrompt || '').slice(0, 5000),
        pptCopilotRules: String(base.pptCopilotRules || '').slice(0, 20000)
    };
}

function maskApiKey(apiKey) {
    if (!apiKey) return '';
    if (apiKey.length <= 8) return '********';
    return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}

function isLikelyValidApiKey(apiKey) {
    if (!apiKey) return false;
    return String(apiKey).trim().length >= 12;
}

function getEnvKeyForProvider(provider, anthropicAuthType = 'ANTHROPIC_AUTH_TOKEN') {
    if (provider === 'openai' || provider === 'openai-compatible') return String(process.env.OPENAI_API_KEY || '').trim();
    if (provider === 'anthropic') {
        if (anthropicAuthType === 'ANTHROPIC_API_KEY') {
            return String(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '').trim();
        }
        return String(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || '').trim();
    }
    if (provider === 'minimax') return String(process.env.MINIMAX_API_KEY || '').trim();
    return String(process.env.GEMINI_API_KEY || '').trim();
}

function cleanProfileName(value, fallback = 'AI 配置') {
    return String(value || fallback).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 60) || fallback;
}

function defaultProfileName(settings) {
    const providerNames = {
        gemini: 'Gemini',
        openai: 'OpenAI',
        anthropic: 'Anthropic',
        minimax: 'MiniMax',
        'openai-compatible': '兼容接口'
    };
    return `${providerNames[settings.provider] || 'AI'} · ${settings.model}`;
}

function uniqueProfileName(profiles, requested) {
    const used = new Set(profiles.map(item => item.name));
    if (!used.has(requested)) return requested;
    let suffix = 2;
    while (used.has(`${requested} ${suffix}`)) suffix += 1;
    return `${requested} ${suffix}`;
}

function createProfileRecord(settings, name, id = crypto.randomUUID()) {
    const now = new Date().toISOString();
    return {
        id: String(id),
        name: cleanProfileName(name, defaultProfileName(settings)),
        ...normalizeSettings(settings),
        createdAt: now,
        updatedAt: now
    };
}

function profileSettings(profile) {
    return normalizeSettings(profile);
}

function normalizeProfile(profile, index) {
    const settings = normalizeSettings(profile);
    const fallbackId = index === 0 ? 'default' : crypto.randomUUID();
    return {
        id: String(profile && profile.id || fallbackId).slice(0, 100),
        name: cleanProfileName(profile && profile.name, defaultProfileName(settings)),
        ...settings,
        createdAt: String(profile && profile.createdAt || new Date().toISOString()),
        updatedAt: String(profile && profile.updatedAt || new Date().toISOString())
    };
}

async function getProfileStore() {
    const raw = await readKV('sys', PROFILE_STORE_KEY, null);
    if (raw && Array.isArray(raw.profiles) && raw.profiles.length) {
        const profiles = raw.profiles.map(normalizeProfile);
        const activeProfileId = profiles.some(item => item.id === raw.activeProfileId)
            ? raw.activeProfileId
            : profiles[0].id;
        return { version: 3, activeProfileId, autoSwitchEnabled: raw.autoSwitchEnabled === true, profiles };
    }

    // 无感迁移：历史单配置原样成为第一套方案，Token 不会丢失。
    const legacy = normalizeSettings(await readKV('sys', LEGACY_SETTINGS_KEY, DEFAULT_SETTINGS));
    const first = createProfileRecord(legacy, defaultProfileName(legacy), 'default');
    const migrated = { version: 3, activeProfileId: first.id, autoSwitchEnabled: false, profiles: [first] };
    await writeProfileStore(migrated);
    return migrated;
}

async function writeProfileStore(store) {
    const active = store.profiles.find(item => item.id === store.activeProfileId) || store.profiles[0];
    const normalized = {
        version: 3,
        activeProfileId: active.id,
        autoSwitchEnabled: store.autoSwitchEnabled === true,
        profiles: store.profiles.map(normalizeProfile)
    };
    await writeKV('sys', PROFILE_STORE_KEY, normalized);
    // 同步旧键，确保旧版本回滚和历史脚本仍能读取当前激活配置。
    await writeKV('sys', LEGACY_SETTINGS_KEY, profileSettings(active));
    return normalized;
}

function findProfile(store, profileId) {
    const id = String(profileId || store.activeProfileId);
    return store.profiles.find(item => item.id === id) || null;
}

function profileNotFoundError() {
    const error = new Error('AI 配置不存在或已被删除');
    error.statusCode = 404;
    return error;
}

function runtimeSettings(stored) {
    const envKey = getEnvKeyForProvider(stored.provider, stored.anthropicAuthType);
    const apiKey = stored.apiKey || envKey;
    return {
        ...stored,
        apiKey,
        apiKeySource: stored.apiKey ? 'stored' : (envKey ? 'env' : 'none'),
        hasApiKey: Boolean(apiKey),
        keyLooksValid: isLikelyValidApiKey(apiKey)
    };
}

function publicSettings(runtime) {
    return {
        provider: runtime.provider,
        anthropicAuthType: runtime.anthropicAuthType || 'ANTHROPIC_AUTH_TOKEN',
        apiBaseUrl: runtime.apiBaseUrl,
        model: runtime.model,
        maxOutputTokens: runtime.maxOutputTokens,
        temperature: runtime.temperature,
        inputCostPerMillionUsd: runtime.inputCostPerMillionUsd,
        outputCostPerMillionUsd: runtime.outputCostPerMillionUsd,
        usdToCny: runtime.usdToCny,
        systemPrompt: runtime.systemPrompt,
        pptCopilotRules: runtime.pptCopilotRules,
        hasApiKey: runtime.hasApiKey,
        keyLooksValid: runtime.hasApiKey ? runtime.keyLooksValid : false,
        apiKeySource: runtime.apiKeySource,
        maskedApiKey: maskApiKey(runtime.apiKey)
    };
}

function publicProfile(profile, activeProfileId) {
    return {
        id: profile.id,
        name: profile.name,
        isActive: profile.id === activeProfileId,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        ...publicSettings(runtimeSettings(profileSettings(profile)))
    };
}

async function getStoredSettings(profileId) {
    const store = await getProfileStore();
    const profile = findProfile(store, profileId);
    if (!profile) throw profileNotFoundError();
    return profileSettings(profile);
}

async function getRuntimeSettings(options = {}) {
    const store = await getProfileStore();
    // 对话模型选择指定的方案存在时作为主模型，否则使用激活方案。
    const active = (options.profileId && findProfile(store, options.profileId)) || findProfile(store, store.activeProfileId);
    const toRuntime = profile => runtimeSettings({
        ...profileSettings(profile),
        profileId: profile.id,
        profileName: profile.name
    });
    const primary = toRuntime(active);
    const fallbackProfiles = store.autoSwitchEnabled
        ? store.profiles.filter(profile => profile.id !== active.id).map(toRuntime).filter(item => item.hasApiKey && item.keyLooksValid)
        : [];
    return { ...primary, autoSwitchEnabled: store.autoSwitchEnabled === true, fallbackProfiles };
}

async function buildRuntimeSettings(payload = {}) {
    const current = await getStoredSettings(payload.profileId);
    const nextPayload = { ...payload };
    delete nextPayload.profileId;
    delete nextPayload.name;
    if (!Object.prototype.hasOwnProperty.call(nextPayload, 'apiKey') || String(nextPayload.apiKey || '').trim() === '') {
        nextPayload.apiKey = current.apiKey;
    }
    return runtimeSettings(normalizeSettings(nextPayload, current));
}

async function getPublicSettings() {
    const store = await getProfileStore();
    const active = findProfile(store, store.activeProfileId);
    return {
        ...publicSettings(runtimeSettings(profileSettings(active))),
        activeProfileId: store.activeProfileId,
        autoSwitchEnabled: store.autoSwitchEnabled === true,
        profiles: store.profiles.map(item => publicProfile(item, store.activeProfileId)),
        modelAliases: await getModelAliases()
    };
}

// ── 对话模型选择：自定义名称（如 Aragon）→ 实际配置方案 ─────────────
function cleanAliasText(value, max) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

function normalizeModelAliases(list) {
    const usedNames = new Set();
    const usedIds = new Set();
    return (Array.isArray(list) ? list : []).map(item => {
        const name = cleanAliasText(item && item.name, 40);
        if (!name || usedNames.has(name.toLowerCase())) return null;
        usedNames.add(name.toLowerCase());
        let id = cleanAliasText(item && item.id, 60).replace(/[^\w-]/g, '');
        if (!id || id.startsWith('profile') || usedIds.has(id)) id = crypto.randomUUID();
        usedIds.add(id);
        return {
            id,
            name,
            description: cleanAliasText(item && item.description, 120),
            profileId: cleanAliasText(item && item.profileId, 100)
        };
    }).filter(Boolean).slice(0, MAX_MODEL_ALIASES);
}

async function getModelAliases() {
    const raw = await readKV('sys', MODEL_ALIAS_KEY, null);
    if (!raw || !Array.isArray(raw.aliases)) return DEFAULT_MODEL_ALIASES.map(item => ({ ...item }));
    return normalizeModelAliases(raw.aliases);
}

async function saveModelAliases(list) {
    if (!Array.isArray(list)) {
        const error = new Error('模型映射格式无效');
        error.statusCode = 400;
        throw error;
    }
    const store = await getProfileStore();
    const aliases = normalizeModelAliases(list).map(item => ({
        ...item,
        profileId: item.profileId && findProfile(store, item.profileId) ? item.profileId : ''
    }));
    await writeKV('sys', MODEL_ALIAS_KEY, { version: 1, aliases });
    return getPublicSettings();
}

/**
 * 对话界面可选模型（纯函数）。
 * - 有映射：只暴露自定义名称；未绑定或绑定方案已删除时跟随激活方案。
 * - 映射为空：直接暴露各方案的真实模型名，只列 Token 就绪的方案（都未就绪时列激活方案）。
 */
function buildModelChoices(store, aliases) {
    const byId = new Map(store.profiles.map(profile => [profile.id, profile]));
    if (aliases.length) {
        const models = aliases.map(alias => {
            const bound = alias.profileId ? byId.get(alias.profileId) : null;
            return {
                id: alias.id,
                name: alias.name,
                description: alias.description,
                profileId: bound ? bound.id : store.activeProfileId,
                followsActive: !bound
            };
        });
        return { mode: 'alias', defaultId: models[0].id, models };
    }
    const ready = store.profiles.filter(profile => {
        const runtime = runtimeSettings(profileSettings(profile));
        return runtime.hasApiKey && runtime.keyLooksValid;
    });
    const visible = ready.length ? ready : store.profiles.filter(profile => profile.id === store.activeProfileId);
    const models = visible.map(profile => ({
        id: `profile:${profile.id}`,
        name: profile.model,
        description: profile.name,
        profileId: profile.id,
        followsActive: false
    }));
    const activeChoice = models.find(item => item.profileId === store.activeProfileId) || models[0];
    return { mode: 'direct', defaultId: activeChoice ? activeChoice.id : '', models };
}

// 未知或已失效的选择回退到默认模型。
function pickModelChoice(choices, modelId) {
    const id = String(modelId || '');
    return choices.models.find(item => item.id === id)
        || choices.models.find(item => item.id === choices.defaultId)
        || null;
}

async function getModelChoices() {
    return buildModelChoices(await getProfileStore(), await getModelAliases());
}

async function resolveModelChoice(modelId) {
    return pickModelChoice(await getModelChoices(), modelId);
}

// 对普通用户只暴露名称与说明，不暴露方案 ID。
function publicModelChoices(choices) {
    return {
        mode: choices.mode,
        defaultId: choices.defaultId,
        models: choices.models.map(({ id, name, description }) => ({ id, name, description }))
    };
}

async function saveSettings(payload = {}) {
    const store = await getProfileStore();
    const profile = findProfile(store, payload.profileId);
    if (!profile) throw profileNotFoundError();
    const nextPayload = { ...payload };
    if (Object.prototype.hasOwnProperty.call(payload, 'autoSwitchEnabled')) store.autoSwitchEnabled = payload.autoSwitchEnabled === true;
    delete nextPayload.profileId;
    delete nextPayload.name;
    delete nextPayload.autoSwitchEnabled;
    if (payload.clearApiKey) {
        nextPayload.apiKey = '';
    } else if (!Object.prototype.hasOwnProperty.call(payload, 'apiKey') || String(payload.apiKey || '').trim() === '') {
        nextPayload.apiKey = profile.apiKey;
    }
    const normalized = normalizeSettings(nextPayload, profile);
    if (normalized.apiKey && !isLikelyValidApiKey(normalized.apiKey)) {
        const error = new Error('API Token 格式疑似无效');
        error.statusCode = 400;
        throw error;
    }
    Object.assign(profile, normalized, {
        name: Object.prototype.hasOwnProperty.call(payload, 'name') ? cleanProfileName(payload.name, profile.name) : profile.name,
        updatedAt: new Date().toISOString()
    });
    await writeProfileStore(store);
    return getPublicSettings();
}

async function createProfile(payload = {}) {
    const store = await getProfileStore();
    const source = payload.sourceProfileId ? findProfile(store, payload.sourceProfileId) : null;
    if (payload.sourceProfileId && !source) throw profileNotFoundError();
    const requestedProvider = normalizeProvider(payload.provider || source && source.provider || DEFAULT_SETTINGS.provider);
    const base = source ? profileSettings(source) : {
        ...DEFAULT_SETTINGS,
        provider: requestedProvider,
        model: DEFAULT_MODELS[requestedProvider]
    };
    const settings = normalizeSettings(payload, base);
    if (!source && !Object.prototype.hasOwnProperty.call(payload, 'apiKey')) settings.apiKey = '';
    const requestedName = cleanProfileName(payload.name, source ? `${source.name} 副本` : defaultProfileName(settings));
    const profile = createProfileRecord(settings, uniqueProfileName(store.profiles, requestedName));
    store.profiles.push(profile);
    if (payload.activate === true) store.activeProfileId = profile.id;
    await writeProfileStore(store);
    return { ...(await getPublicSettings()), createdProfileId: profile.id };
}

async function activateProfile(profileId) {
    const store = await getProfileStore();
    const profile = findProfile(store, profileId);
    if (!profile) throw profileNotFoundError();
    store.activeProfileId = profile.id;
    await writeProfileStore(store);
    return getPublicSettings();
}

async function deleteProfile(profileId) {
    const store = await getProfileStore();
    if (store.profiles.length <= 1) {
        const error = new Error('至少需要保留一套 AI 配置');
        error.statusCode = 400;
        throw error;
    }
    const index = store.profiles.findIndex(item => item.id === String(profileId));
    if (index < 0) throw profileNotFoundError();
    const wasActive = store.activeProfileId === store.profiles[index].id;
    store.profiles.splice(index, 1);
    if (wasActive) store.activeProfileId = store.profiles[Math.min(index, store.profiles.length - 1)].id;
    await writeProfileStore(store);
    return getPublicSettings();
}

module.exports = {
    DEFAULT_SETTINGS,
    getStoredSettings,
    getRuntimeSettings,
    buildRuntimeSettings,
    getPublicSettings,
    saveSettings,
    getModelAliases,
    saveModelAliases,
    getModelChoices,
    resolveModelChoice,
    buildModelChoices,
    pickModelChoice,
    normalizeModelAliases,
    publicModelChoices,
    createProfile,
    activateProfile,
    deleteProfile,
    isLikelyValidApiKey
};
