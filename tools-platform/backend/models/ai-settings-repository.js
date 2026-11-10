const crypto = require('crypto');
const { readKV, writeKV } = require('./kv-store');

const PROFILE_STORE_KEY = 'ai_settings_profiles';
// 公共模型：超级管理员（默认团队）里勾选了「分配给所有团队」的配置。其他团队能看到、选用，但不能修改或删除，
// API Key 只在服务端使用，不会写进团队自己的库；团队也可以另外添加自己的模型。
const SHARED_PREFIX = 'shared:';
const tenantContext = require('./tenant-context');
function inDefaultTenant() {
    return tenantContext.getTenantId() === tenantContext.DEFAULT_TENANT_ID;
}
function isSharedId(id) {
    return String(id || '').startsWith(SHARED_PREFIX);
}
function sharedLockedError() {
    const error = new Error('公共模型由超级管理员统一维护，不能在团队里修改或删除；可以新增自己的模型配置');
    error.statusCode = 403;
    error.code = 'AI_PROFILE_SHARED';
    return error;
}
const LEGACY_SETTINGS_KEY = 'ai_settings';
const MODEL_ALIAS_KEY = 'ai_model_aliases';
const MAX_MODEL_ALIASES = 20;
// Legacy aliases are read only to resolve requests from an already-open older client.

const DEFAULT_SETTINGS = {
    provider: 'gemini',
    anthropicAuthType: 'ANTHROPIC_AUTH_TOKEN',
    apiBaseUrl: '',
    model: 'gemini-2.5-flash',
    apiKey: '',
    maxOutputTokens: 2048,
    contextWindowTokens: 0, // 0 = 按模型名自动识别（agent-context-stats.windowFor）
    temperature: 0.7,
    inputCostPerMillionUsd: 0.075,
    outputCostPerMillionUsd: 0.3,
    usdToCny: 7.2,
    systemPrompt: '',
    pptCopilotRules: '',
    headers: {},
    extraBody: {}
};

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'cookie', 'proxy-authorization']);

function getAiSettingsCipherKey() {
    return crypto.hkdfSync('sha256', Buffer.from('dragon-ai-settings-master-salt-v1', 'utf8'), Buffer.from('ai-headers-extra-body', 'utf8'), Buffer.from('dragon-claw-ai-v1', 'utf8'), 32);
}

function encryptJson(data) {
    if (!data || typeof data !== 'object') return '';
    const raw = JSON.stringify(data);
    if (!raw || raw === '{}' || raw === '[]') return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getAiSettingsCipherKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptJson(cipherText) {
    if (!cipherText || typeof cipherText !== 'string') return {};
    try {
        const buf = Buffer.from(cipherText, 'base64');
        if (buf.length < 28) return {};
        const iv = buf.subarray(0, 12);
        const tag = buf.subarray(12, 28);
        const body = buf.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', getAiSettingsCipherKey(), iv);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
        const parsed = JSON.parse(plain);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function normalizeHeaders(input, previous = {}) {
    if (input === undefined) return previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {};
    let obj = input;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {};
        try { obj = JSON.parse(trimmed); }
        catch {
            const err = new Error('附加请求头必须是有效的 JSON 对象');
            err.statusCode = 400;
            throw err;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        const err = new Error('附加请求头必须是 JSON 对象');
        err.statusCode = 400;
        throw err;
    }
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        const name = String(k || '').trim();
        if (!name || !/^[A-Za-z0-9-_]{1,80}$/.test(name) || FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
        if (v === null || v === undefined) continue;
        const valStr = String(v);
        if (/[\r\n\x00]/.test(valStr)) continue;
        clean[name] = valStr;
    }
    return clean;
}

function normalizeExtraBody(input, previous = {}) {
    if (input === undefined) return previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {};
    let obj = input;
    if (typeof input === 'string') {
        const trimmed = input.trim();
        if (!trimmed) return previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {};
        try { obj = JSON.parse(trimmed); }
        catch {
            const err = new Error('附加请求参数必须是有效的 JSON 对象');
            err.statusCode = 400;
            throw err;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        const err = new Error('附加请求参数必须是 JSON 对象');
        err.statusCode = 400;
        throw err;
    }
    if (JSON.stringify(obj).length > 60000) {
        const err = new Error('附加请求参数过大（最多支持 60 KB）');
        err.statusCode = 400;
        throw err;
    }
    return obj;
}

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

// 上下文窗口：0 表示自动；手填时限定在 4K～1000 万之间
function normalizeContextWindow(value) {
    const num = Math.round(Number(value) || 0);
    return num > 0 ? Math.round(clampNumber(num, 0, 4096, 10000000)) : 0;
}

function normalizeModels(input, fallbackModel, provider) {
    let list = [];
    if (Array.isArray(input)) {
        list = input;
    } else if (typeof input === 'string') {
        list = input.split(/[\r\n,，\s]+/);
    }
    const cleaned = list.map(m => String(m || '').trim()).filter(m => m.length > 0 && m.length <= 100);
    if (!cleaned.length && fallbackModel) {
        cleaned.push(String(fallbackModel).trim());
    }
    if (!cleaned.length) {
        cleaned.push(DEFAULT_MODELS[provider] || DEFAULT_SETTINGS.model);
    }
    return Array.from(new Set(cleaned));
}

function normalizeSettings(input = {}, previous = {}) {
    const base = { ...DEFAULT_SETTINGS, ...previous, ...input };
    const provider = normalizeProvider(base.provider);
    const models = normalizeModels(input.models !== undefined ? input.models : previous.models, base.model, provider);
    const primaryModel = String(input.model || base.model || models[0] || DEFAULT_MODELS[provider] || DEFAULT_SETTINGS.model).trim();
    const remaining = models.filter(m => m !== primaryModel);
    const allModels = [primaryModel, ...remaining].filter(Boolean);
    const headers = normalizeHeaders(input.headers !== undefined ? input.headers : previous.headers, previous.headers);
    const extraBody = normalizeExtraBody(input.extraBody !== undefined ? input.extraBody : (input.extra_body !== undefined ? input.extra_body : previous.extraBody), previous.extraBody);
    return {
        provider,
        anthropicAuthType: normalizeAnthropicAuthType(base.anthropicAuthType),
        apiBaseUrl: String(base.apiBaseUrl || '').trim().slice(0, 500),
        model: allModels[0] || DEFAULT_MODELS[provider],
        models: allModels,
        apiKey: String(base.apiKey || '').trim(),
        maxOutputTokens: Math.round(clampNumber(base.maxOutputTokens, DEFAULT_SETTINGS.maxOutputTokens, 128, 8192)),
        contextWindowTokens: normalizeContextWindow(base.contextWindowTokens),
        temperature: clampNumber(base.temperature, DEFAULT_SETTINGS.temperature, 0, 2),
        inputCostPerMillionUsd: clampNumber(base.inputCostPerMillionUsd, DEFAULT_SETTINGS.inputCostPerMillionUsd, 0, 999),
        outputCostPerMillionUsd: clampNumber(base.outputCostPerMillionUsd, DEFAULT_SETTINGS.outputCostPerMillionUsd, 0, 999),
        usdToCny: clampNumber(base.usdToCny, DEFAULT_SETTINGS.usdToCny, 0, 99),
        systemPrompt: String(base.systemPrompt || '').slice(0, 5000),
        pptCopilotRules: String(base.pptCopilotRules || '').slice(0, 20000),
        headers,
        extraBody
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

// Profiles come in two categories: chat models (conversation, analysis, generation of text) and image models (drawing).
// Older profiles without a category are sorted by model name, so an image model someone already added lands in the right one.
const IMAGE_MODEL = /image|imagen|banana|gpt-image|dall-?e|flux|stable-?diffusion/i;
function profileCategory(profile) {
    if (profile && (profile.category === 'image' || profile.category === 'chat')) return profile.category;
    return IMAGE_MODEL.test(String(profile && profile.model || '')) ? 'image' : 'chat';
}

function createProfileRecord(settings, name, id = crypto.randomUUID(), category = 'chat') {
    const now = new Date().toISOString();
    return {
        id: String(id),
        name: cleanProfileName(name, defaultProfileName(settings)),
        category: category === 'image' ? 'image' : 'chat',
        ...normalizeSettings(settings),
        createdAt: now,
        updatedAt: now
    };
}

function profileSettings(profile) {
    return normalizeSettings(profile);
}

function normalizeProfile(profile, index) {
    const rawHeaders = profile && (profile.headers !== undefined ? profile.headers : (profile.headersCipher ? decryptJson(profile.headersCipher) : {}));
    const rawExtraBody = profile && (profile.extraBody !== undefined ? profile.extraBody : (profile.extraBodyCipher ? decryptJson(profile.extraBodyCipher) : (profile.extra_body !== undefined ? profile.extra_body : {})));
    const settings = normalizeSettings({ ...profile, headers: rawHeaders, extraBody: rawExtraBody });
    const fallbackId = index === 0 ? 'default' : crypto.randomUUID();
    return {
        id: String(profile && profile.id || fallbackId).slice(0, 100),
        name: cleanProfileName(profile && profile.name, defaultProfileName(settings)),
        category: profileCategory(profile),
        shared: Boolean(profile && profile.shared === true),
        ...settings,
        createdAt: String(profile && profile.createdAt || new Date().toISOString()),
        updatedAt: String(profile && profile.updatedAt || new Date().toISOString())
    };
}

/** 默认团队里标记为公共的配置，以只读形式并入其他团队的配置列表 */
async function sharedProfiles() {
    if (inDefaultTenant()) return [];
    const raw = await tenantContext.runWithTenant(tenantContext.DEFAULT_TENANT_ID, () => readKV('sys', PROFILE_STORE_KEY, null)).catch(() => null);
    return (raw && Array.isArray(raw.profiles) ? raw.profiles : [])
        .filter(profile => profile && profile.shared === true)
        .map((profile, index) => ({ ...normalizeProfile(profile, index + 1), id: `${SHARED_PREFIX}${profile.id}`, shared: true, locked: true }));
}

async function getProfileStore() {
    const raw = await readKV('sys', PROFILE_STORE_KEY, null);
    const shared = await sharedProfiles();
    const meta = raw ? { activeProfileId: raw.activeProfileId, activeImageProfileId: raw.activeImageProfileId, autoSwitchEnabled: raw.autoSwitchEnabled === true } : {};
    if (raw && Array.isArray(raw.profiles) && raw.profiles.length) {
        const profiles = [...shared, ...raw.profiles.map(normalizeProfile).map(profile => ({ ...profile, locked: false }))];
        return withActiveIds({ version: 3, ...meta, profiles });
    }
    // 新团队还没有自己的配置：直接使用公共模型，不生成空白配置
    if (shared.length) return withActiveIds({ version: 3, ...meta, profiles: shared });

    // 无感迁移：历史单配置原样成为第一套方案，Token 不会丢失。
    const legacy = normalizeSettings(await readKV('sys', LEGACY_SETTINGS_KEY, DEFAULT_SETTINGS));
    const first = createProfileRecord(legacy, defaultProfileName(legacy), 'default');
    const migrated = { version: 3, activeProfileId: first.id, autoSwitchEnabled: false, profiles: [first] };
    // 团队还没有任何模型（超级管理员也没分配公共模型）：只给一套空白方案用于编辑，不落盘；
    // 否则之后分配的公共模型不会成为团队的默认模型
    if (!inDefaultTenant() && !await readKV('sys', LEGACY_SETTINGS_KEY, null)) return migrated;
    await writeProfileStore(migrated);
    return migrated;
}

// The active chat profile is always a chat profile (the first one when the stored id is gone or is an image profile);
// the active image profile is an image profile, or empty when there is none.
function withActiveIds(store) {
    const chats = store.profiles.filter(item => profileCategory(item) === 'chat'), pictures = store.profiles.filter(item => profileCategory(item) === 'image');
    const activeProfileId = (chats.find(item => item.id === store.activeProfileId) || chats[0] || store.profiles[0]).id;
    const activeImageProfileId = (pictures.find(item => item.id === store.activeImageProfileId) || pictures[0] || { id: '' }).id;
    return { ...store, activeProfileId, activeImageProfileId };
}

async function writeProfileStore(store) {
    const ids = withActiveIds({ ...store, profiles: store.profiles.map((profile, index) => ({ ...normalizeProfile(profile, index), locked: Boolean(profile.locked) })) });
    const active = ids.profiles.find(item => item.id === ids.activeProfileId) || ids.profiles[0];
    // 公共模型只是并入展示，绝不写进团队自己的库（否则团队能从自己的数据库里读到公共 API Key）
    const own = ids.profiles.filter(profile => !isSharedId(profile.id)).map(({ locked, ...profile }) => {
        const p = inDefaultTenant() ? { ...profile } : { ...profile, shared: false };
        const headersCipher = encryptJson(p.headers);
        const extraBodyCipher = encryptJson(p.extraBody);
        if (headersCipher) p.headersCipher = headersCipher;
        else delete p.headersCipher;
        if (extraBodyCipher) p.extraBodyCipher = extraBodyCipher;
        else delete p.extraBodyCipher;
        delete p.headers;
        delete p.extraBody;
        delete p.extra_body;
        return p;
    });
    const normalized = {
        version: 3,
        activeProfileId: active.id,
        activeImageProfileId: ids.activeImageProfileId,
        autoSwitchEnabled: store.autoSwitchEnabled === true,
        profiles: own
    };
    await writeKV('sys', PROFILE_STORE_KEY, normalized);
    // 同步旧键，确保旧版本回滚和历史脚本仍能读取当前激活配置（激活的是公共模型时不写，避免把公共 Key 落进团队库）。
    const legacy = isSharedId(active.id) ? own[0] : active;
    if (legacy) await writeKV('sys', LEGACY_SETTINGS_KEY, profileSettings(legacy));
    return normalized;
}

// 仅供后端内容过滤使用，绝不能通过设置/模型列表 API 返回。
async function getRedactionSecrets() {
    const store = await getProfileStore();
    // 频道对接凭据（WeLink SK）同样不得进入模型上下文与日志
    const channelSecrets = await require('./channels/welink-config-repository').getSecrets().catch(() => []);
    // MCP 服务的环境变量与请求头（Token 等）同样不发给模型
    const mcpSecrets = await require('./agent-mcp').secrets().catch(() => []);
    const headerSecrets = [];
    for (const profile of store.profiles) {
        if (profile.headers && typeof profile.headers === 'object') {
            for (const val of Object.values(profile.headers)) {
                if (typeof val === 'string' && val.trim().length >= 4) {
                    headerSecrets.push(val.trim());
                }
            }
        }
    }
    return [...new Set([...store.profiles.map(profile => runtimeSettings(profile).apiKey), ...headerSecrets, ...channelSecrets, ...mcpSecrets].filter(Boolean))];
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
    // 服务器环境变量里的 Key 只给超级管理员的默认团队用：团队自建配置不能借用它（否则可指向自己的 Base URL 套走 Key）
    const envKey = inDefaultTenant() ? getEnvKeyForProvider(stored.provider, stored.anthropicAuthType) : '';
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
    const models = Array.isArray(runtime.models) && runtime.models.length
        ? runtime.models
        : [runtime.model].filter(Boolean);
    const hasHeaders = Boolean(runtime.headers && typeof runtime.headers === 'object' && Object.keys(runtime.headers).length > 0);
    const hasExtraBody = Boolean(runtime.extraBody && typeof runtime.extraBody === 'object' && Object.keys(runtime.extraBody).length > 0);
    return {
        provider: runtime.provider,
        anthropicAuthType: runtime.anthropicAuthType || 'ANTHROPIC_AUTH_TOKEN',
        apiBaseUrl: runtime.apiBaseUrl,
        model: runtime.model,
        models,
        maxOutputTokens: runtime.maxOutputTokens,
        contextWindowTokens: runtime.contextWindowTokens,
        temperature: runtime.temperature,
        inputCostPerMillionUsd: runtime.inputCostPerMillionUsd,
        outputCostPerMillionUsd: runtime.outputCostPerMillionUsd,
        usdToCny: runtime.usdToCny,
        systemPrompt: runtime.systemPrompt,
        pptCopilotRules: runtime.pptCopilotRules,
        hasApiKey: runtime.hasApiKey,
        keyLooksValid: runtime.hasApiKey ? runtime.keyLooksValid : false,
        apiKeySource: runtime.apiKeySource,
        maskedApiKey: maskApiKey(runtime.apiKey),
        hasHeaders,
        hasExtraBody
    };
}

function publicProfile(profile, activeProfileId, activeImageProfileId = '') {
    const category = profileCategory(profile);
    return {
        id: profile.id,
        name: profile.name,
        category,
        shared: Boolean(profile.shared), // 默认团队：已分配给所有团队；其他团队：来自超级管理员的公共模型
        locked: Boolean(profile.locked),
        isActive: profile.id === (category === 'image' ? activeImageProfileId : activeProfileId),
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
    const toRuntime = profile => {
        const item = runtimeSettings({
            ...profileSettings(profile),
            profileId: profile.id,
            profileName: profile.name
        });
        if (options.modelName && profile.id === active.id) {
            item.model = options.modelName;
        }
        return item;
    };
    const primary = toRuntime(active);
    // Failover only moves between chat models; an image model never answers a conversation.
    const fallbackProfiles = store.autoSwitchEnabled
        ? store.profiles.filter(profile => profile.id !== active.id && profileCategory(profile) === 'chat').map(toRuntime).filter(item => item.hasApiKey && item.keyLooksValid)
        : [];
    return { ...primary, autoSwitchEnabled: store.autoSwitchEnabled === true, fallbackProfiles };
}

// The image model in use (for drawing), or null when no image profile is configured.
async function getImageRuntimeSettings() {
    const store = await getProfileStore();
    const profile = store.activeImageProfileId && findProfile(store, store.activeImageProfileId);
    if (!profile) return null;
    return runtimeSettings({ ...profileSettings(profile), profileId: profile.id, profileName: profile.name });
}

async function buildRuntimeSettings(payload = {}) {
    const store = await getProfileStore();
    const target = findProfile(store, payload.profileId);
    if (target?.locked) {
        // 公共模型的连通性测试：只能换成它自己列出的模型，其余参数（尤其 Base URL）一律用超级管理员的配置，Key 不会被发往别处
        const stored = profileSettings(target);
        const model = stored.models.includes(String(payload.model || '')) ? String(payload.model) : stored.model;
        return runtimeSettings({ ...stored, model });
    }
    const current = payload.profileId ? await getStoredSettings(payload.profileId).catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
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
        activeImageProfileId: store.activeImageProfileId || '',
        autoSwitchEnabled: store.autoSwitchEnabled === true,
        profiles: store.profiles.map(item => publicProfile(item, store.activeProfileId, store.activeImageProfileId)),
        modelAliases: [] // Deprecated response field retained for older clients.
    };
}

// ── 对话模型选择：真实模型名；历史映射仅兼容旧客户端请求 ─────────────
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
    if (!raw || !Array.isArray(raw.aliases)) return [];
    return normalizeModelAliases(raw.aliases);
}

/** Chat always lists the real model ID of each ready chat profile. */
function buildModelChoices(store) {
    const ready = store.profiles.filter(profile => profileCategory(profile) === 'chat').filter(profile => {
        const runtime = runtimeSettings(profileSettings(profile));
        return runtime.hasApiKey && runtime.keyLooksValid;
    });
    const visible = ready.length ? ready : store.profiles.filter(profile => profile.id === store.activeProfileId);
    const models = [];
    for (const profile of visible) {
        const profileModels = Array.isArray(profile.models) && profile.models.length
            ? profile.models
            : [profile.model || DEFAULT_MODELS[profile.provider] || DEFAULT_SETTINGS.model].filter(Boolean);
        profileModels.forEach((modelName, idx) => {
            models.push({
                id: idx === 0 ? `profile:${profile.id}` : `profile:${profile.id}:${modelName}`,
                aliasId: `profile:${profile.id}:${modelName}`,
                name: modelName,
                provider: profile.provider,
                description: profile.name,
                profileId: profile.id,
                modelName: modelName,
                isPrimary: idx === 0,
                followsActive: false
            });
        });
    }
    const activeChoice = models.find(item => item.profileId === store.activeProfileId && item.isPrimary) || models[0];
    return { mode: 'direct', defaultId: activeChoice ? activeChoice.id : '', models };
}

// 未知或已失效的选择回退到默认模型。
function pickModelChoice(choices, modelId) {
    const id = String(modelId || '');
    let found = choices.models.find(item => item.id === id || item.aliasId === id);
    if (found) return found;

    if (id.startsWith('profile:')) {
        const parts = id.slice('profile:'.length).split(':');
        const profileId = parts[0];
        const specificModel = parts.slice(1).join(':');
        if (specificModel) {
            found = choices.models.find(item => item.profileId === profileId && (item.modelName === specificModel || item.name === specificModel));
            if (found) return found;
        }
        found = choices.models.find(item => item.profileId === profileId);
        if (found) return found;
    }

    return choices.models.find(item => item.id === choices.defaultId)
        || choices.models[0]
        || null;
}

async function getModelChoices() {
    return buildModelChoices(await getProfileStore());
}

async function resolveModelChoice(modelId) {
    const choices = await getModelChoices();
    // Preserve the underlying profile for an old tab's alias selection; never expose the alias name.
    if (modelId && !String(modelId).startsWith('profile:')) {
        const alias = (await getModelAliases()).find(item => item.id === modelId);
        if (alias?.profileId) return pickModelChoice(choices, `profile:${alias.profileId}`);
    }
    return pickModelChoice(choices, modelId);
}

// 对普通用户只暴露名称与说明，不暴露方案 ID。
function publicModelChoices(choices) {
    return {
        mode: choices.mode,
        defaultId: choices.defaultId,
        models: choices.models.map(({ id, name, description, provider }) => ({ id, name, description, provider }))
    };
}

async function saveSettings(payload = {}) {
    const store = await getProfileStore();
    const profile = findProfile(store, payload.profileId);
    if (!profile) throw profileNotFoundError();
    if (Object.prototype.hasOwnProperty.call(payload, 'autoSwitchEnabled')) store.autoSwitchEnabled = payload.autoSwitchEnabled === true;
    if (profile.locked) {
        // 公共模型只允许在团队里切换「自动切换」开关
        const editable = Object.keys(payload).filter(key => !['profileId', 'autoSwitchEnabled'].includes(key));
        if (editable.length) throw sharedLockedError();
        await writeProfileStore(store);
        return getPublicSettings();
    }
    const nextPayload = { ...payload };
    delete nextPayload.shared;
    if (inDefaultTenant() && Object.prototype.hasOwnProperty.call(payload, 'shared')) profile.shared = payload.shared === true;
    delete nextPayload.profileId;
    delete nextPayload.name;
    delete nextPayload.autoSwitchEnabled;
    delete nextPayload.category;
    if (payload.clearApiKey) {
        nextPayload.apiKey = '';
    } else if (!Object.prototype.hasOwnProperty.call(payload, 'apiKey') || String(payload.apiKey || '').trim() === '') {
        nextPayload.apiKey = profile.apiKey;
    }
    if (payload.clearHeaders || (payload.headers && typeof payload.headers === 'object' && Object.keys(payload.headers).length === 0)) {
        nextPayload.headers = {};
    }
    if (payload.clearExtraBody || (payload.extraBody && typeof payload.extraBody === 'object' && Object.keys(payload.extraBody).length === 0) || (payload.extra_body && typeof payload.extra_body === 'object' && Object.keys(payload.extra_body).length === 0)) {
        nextPayload.extraBody = {};
    }
    const normalized = normalizeSettings(nextPayload, profile);
    if (normalized.apiKey && !isLikelyValidApiKey(normalized.apiKey)) {
        const error = new Error('API Token 格式疑似无效');
        error.statusCode = 400;
        throw error;
    }
    Object.assign(profile, normalized, {
        category: payload.category === 'image' || payload.category === 'chat' ? payload.category : profileCategory(profile),
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
    if ((!source || source.locked) && !Object.prototype.hasOwnProperty.call(payload, 'apiKey')) settings.apiKey = '';
    if (source && source.locked) {
        settings.apiKey = String(payload.apiKey || '').trim(); // 复制公共模型时不带走它的 Key
        if (!Object.prototype.hasOwnProperty.call(payload, 'headers')) settings.headers = {};
        if (!Object.prototype.hasOwnProperty.call(payload, 'extraBody') && !Object.prototype.hasOwnProperty.call(payload, 'extra_body')) settings.extraBody = {};
    }
    const requestedName = cleanProfileName(payload.name, source ? `${source.name} 副本` : defaultProfileName(settings));
    const category = payload.category === 'image' || payload.category === 'chat' ? payload.category : (source ? profileCategory(source) : 'chat');
    const profile = createProfileRecord(settings, uniqueProfileName(store.profiles, requestedName), crypto.randomUUID(), category);
    if (inDefaultTenant() && payload.shared === true) profile.shared = true;
    store.profiles.push(profile);
    if (payload.activate === true) store[category === 'image' ? 'activeImageProfileId' : 'activeProfileId'] = profile.id;
    await writeProfileStore(store);
    return { ...(await getPublicSettings()), createdProfileId: profile.id };
}

async function activateProfile(profileId) {
    const store = await getProfileStore();
    const profile = findProfile(store, profileId);
    if (!profile) throw profileNotFoundError();
    store[profileCategory(profile) === 'image' ? 'activeImageProfileId' : 'activeProfileId'] = profile.id;
    await writeProfileStore(store);
    return getPublicSettings();
}

async function deleteProfile(profileId) {
    const store = await getProfileStore();
    if (findProfile(store, profileId)?.locked) throw sharedLockedError();
    if (store.profiles.length <= 1) {
        const error = new Error('至少需要保留一套 AI 配置');
        error.statusCode = 400;
        throw error;
    }
    const index = store.profiles.findIndex(item => item.id === String(profileId));
    if (index < 0) throw profileNotFoundError();
    if (store.profiles[index].locked) throw sharedLockedError();
    if (profileCategory(store.profiles[index]) === 'chat' && store.profiles.filter(item => profileCategory(item) === 'chat').length <= 1) {
        const error = new Error('至少需要保留一套对话模型配置');
        error.statusCode = 400;
        throw error;
    }
    store.profiles.splice(index, 1);
    await writeProfileStore(store);
    return getPublicSettings();
}

module.exports = {
    getRedactionSecrets,
    DEFAULT_SETTINGS,
    getStoredSettings,
    getRuntimeSettings,
    getImageRuntimeSettings,
    buildRuntimeSettings,
    getPublicSettings,
    saveSettings,
    getModelAliases,
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
