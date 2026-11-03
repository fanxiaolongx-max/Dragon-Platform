const crypto = require('crypto');
const { readKV, writeKV } = require('./kv-store');

const CONFIG_KEY = 'friend_links_config';
const STATUS_KEY = 'friend_links_status';
const CONFIG_SCHEMA_VERSION = 6;
const DEFAULT_INTERVAL_MINUTES = 30;
const MIN_INTERVAL_MINUTES = 10;
const MAX_INTERVAL_MINUTES = 1440;

const DEFAULT_API_RELAY = {
    baseUrl: 'https://api.fanxiaolong.uk',
    apiKey: 'xxxx',
    openAiModel: 'gemini-3-flash',
    defaultModel: 'claude-3-5-sonnet-20241022',
    fastModel: 'gemini-2.5-flash'
};

const LEGACY_API_RELAY_MODELS = {
    'gemini-3-1-flash': 'gemini-3-flash',
    'gemini-2-5-flash': 'gemini-2.5-flash'
};

const DEFAULT_LINKS = [
    { id: 'wise', icon: '💰', name: '财务管理', nameEn: 'Finance', url: 'https://wise.fanxiaolong.uk/' },
    { id: 'app', icon: '📱', name: '手机控制', nameEn: 'Phone Control', url: 'https://app.fanxiaolong.uk/' },
    { id: 'yutang', icon: '🤖', name: 'AI 远程控机', nameEn: 'AI Phone Control', url: 'https://yutang.fanxiaolong.uk/' },
    { id: 'api', icon: '⚡', name: 'API 中转', nameEn: 'API Relay', url: 'https://api.fanxiaolong.uk/' },
    { id: 'api2', icon: '🔁', name: 'API 中转二站', nameEn: 'API Relay 2', url: 'https://api2.fanxiaolong.uk/' },
    { id: 'cs2', icon: '🛟', name: '工具中台备用', nameEn: 'Backup Hub', url: 'https://cs2.fanxiaolong.uk/' },
    { id: 'cs-main', icon: '🏠', name: '工具中台主站', nameEn: 'Dragon Claw', url: 'https://cs.fanxiaolong.uk/' },
    { id: 'license', icon: '🔑', name: 'License 发放', nameEn: 'Issue Licenses', url: 'https://cs.fanxiaolong.uk/desktop-license-admin' },
    { id: 'ssh', icon: '☁️', name: '移动终端云', nameEn: 'Mobile Terminal Cloud', url: 'https://ssh.fanxiaolong.uk/' },
    { id: 'pcap', icon: '📡', name: '网络分析', nameEn: 'Network Analysis', url: 'https://pcap.fanxiaolong.uk/' },
    { id: 'openclaw3', icon: '🦞', name: 'OpenClaw', nameEn: 'OpenClaw', url: 'https://openclaw3.fanxiaolong.uk/' },
    { id: 'bobapro', icon: '🧋', name: 'BobaPro', nameEn: 'BobaPro', url: 'https://bobapro.life/' },
    { id: 'canting', icon: '🍽️', name: '餐厅服务', nameEn: 'Dining Service', url: 'https://canting.fanxiaolong.uk/' },
    { id: 'ims', icon: '🗂️', name: 'IMS', nameEn: 'IMS', url: 'https://ims.fanxiaolong.uk/' },
    { id: 'boda-3xyulq', icon: '🏪', name: '线上中超', nameEn: 'Online Supermarket', url: 'https://boda-3xyulq.fly.dev/' },
    { id: 'canting-demo', icon: '🧪', name: '餐厅 Demo', nameEn: 'Dining Demo', url: 'https://canting-demo.fly.dev/' },
    { id: 'boda-t0amgq', icon: '🍜', name: '家家乐点餐', nameEn: 'Jiajiale Ordering', url: 'https://boda-t0amgq.fly.dev/' },
    { id: 'boda-0mqtrq', icon: '🧋', name: 'Neferdidi 奶茶店', nameEn: 'Neferdidi Milk Tea', url: 'https://boda-0mqtrq.fly.dev/' },
    { id: 'grok-api2', icon: '✦', name: 'Grok API 二站', nameEn: 'Grok API 2', url: 'https://grok-api2.fanxiaolong.uk/' }
];

function makeLinkId(url, index = 0) {
    return `link_${crypto.createHash('sha1').update(`${url}:${index}`).digest('hex').slice(0, 12)}`;
}

function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error('链接地址不能为空');
    if (raw.length > 2048) throw new Error('链接地址过长');
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        throw new Error(`链接地址无效：${raw}`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('友情链接仅支持 HTTP 或 HTTPS 地址');
    }
    if (parsed.username || parsed.password) {
        throw new Error('友情链接地址不能包含账号或密码');
    }
    return parsed.toString();
}

function normalizeLink(item, index = 0, usedIds = new Set()) {
    const url = normalizeUrl(item && item.url);
    const name = String(item && item.name || '').trim().slice(0, 40);
    if (!name) throw new Error('链接名称不能为空');
    const nameEn = String(item && item.nameEn || '').trim().slice(0, 60);
    const icon = Array.from(String(item && item.icon || '🔗').trim()).slice(0, 4).join('') || '🔗';
    let id = String(item && item.id || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
    if (!id || usedIds.has(id)) id = makeLinkId(url, index);
    while (usedIds.has(id)) id = makeLinkId(url, index + usedIds.size + 1);
    usedIds.add(id);
    return { id, icon, name, nameEn, url };
}

function normalizeConfig(input = {}) {
    const rawLinks = Array.isArray(input.links) ? input.links : DEFAULT_LINKS;
    if (rawLinks.length > 40) throw new Error('友情链接最多支持 40 个');
    const usedIds = new Set();
    const links = rawLinks.map((item, index) => normalizeLink(item, index, usedIds));
    const intervalValue = Number(input.probeIntervalMinutes);
    const probeIntervalMinutes = Number.isFinite(intervalValue)
        ? Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(intervalValue)))
        : DEFAULT_INTERVAL_MINUTES;
    return { schemaVersion: CONFIG_SCHEMA_VERSION, links, probeIntervalMinutes, apiRelay: normalizeApiRelay(input.apiRelay) };
}

function normalizeApiRelay(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    let baseUrl = normalizeUrl(source.baseUrl || DEFAULT_API_RELAY.baseUrl);
    baseUrl = baseUrl.replace(/\/+$/, '');
    const apiKey = String(source.apiKey ?? DEFAULT_API_RELAY.apiKey).trim().slice(0, 512);
    if (!apiKey) throw new Error('API 密钥不能为空');
    const openAiModel = String(source.openAiModel || DEFAULT_API_RELAY.openAiModel).trim().slice(0, 120);
    const defaultModel = String(source.defaultModel || DEFAULT_API_RELAY.defaultModel).trim().slice(0, 120);
    const fastModel = String(source.fastModel || DEFAULT_API_RELAY.fastModel).trim().slice(0, 120);
    if (!openAiModel || !defaultModel || !fastModel) throw new Error('模型名称不能为空');
    return { baseUrl, apiKey, openAiModel, defaultModel, fastModel };
}

function migrateLegacyApiRelayModels(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const legacyDefault = LEGACY_API_RELAY_MODELS[source.defaultModel] || source.defaultModel;
    return {
        ...source,
        openAiModel: source.openAiModel || legacyDefault || DEFAULT_API_RELAY.openAiModel,
        defaultModel: source.defaultModel === 'gemini-3-1-flash'
            ? DEFAULT_API_RELAY.defaultModel
            : source.defaultModel,
        fastModel: LEGACY_API_RELAY_MODELS[source.fastModel] || source.fastModel
    };
}

async function getConfig() {
    const stored = await readKV('sys', CONFIG_KEY, null);
    if (!stored) return normalizeConfig({ links: DEFAULT_LINKS, probeIntervalMinutes: DEFAULT_INTERVAL_MINUTES });

    const storedVersion = Number(stored.schemaVersion) || 1;
    if (storedVersion < CONFIG_SCHEMA_VERSION) {
        const links = Array.isArray(stored.links) ? stored.links.map(link => ({ ...link })) : DEFAULT_LINKS.map(link => ({ ...link }));
        const defaultIdsToAdd = [];
        if (storedVersion < 2) defaultIdsToAdd.push('cs-main');
        if (storedVersion < 3) defaultIdsToAdd.push('boda-3xyulq', 'canting-demo', 'boda-t0amgq', 'boda-0mqtrq');
        if (storedVersion < 4) defaultIdsToAdd.push('grok-api2');
        for (const defaultId of defaultIdsToAdd) {
            const defaultLink = DEFAULT_LINKS.find(link => link.id === defaultId);
            const hasLink = links.some(link => link && (
                link.id === defaultLink.id || String(link.url || '').replace(/\/+$/, '') === defaultLink.url.replace(/\/+$/, '')
            ));
            if (!hasLink) links.push(defaultLink);
        }
        if (storedVersion < 5) {
            const renamedDefaults = new Map(DEFAULT_LINKS
                .filter(link => ['boda-3xyulq', 'boda-t0amgq', 'boda-0mqtrq'].includes(link.id))
                .map(link => [link.id, link]));
            for (const link of links) {
                const renamed = renamedDefaults.get(link.id);
                if (renamed) Object.assign(link, { icon: renamed.icon, name: renamed.name, nameEn: renamed.nameEn });
            }
        }
        const apiRelay = storedVersion < 6 ? migrateLegacyApiRelayModels(stored.apiRelay) : stored.apiRelay;
        const migrated = normalizeConfig({ ...stored, links, apiRelay });
        await writeKV('sys', CONFIG_KEY, migrated);
        return migrated;
    }
    return normalizeConfig(stored);
}

async function saveConfig(input) {
    const config = normalizeConfig(input);
    await writeKV('sys', CONFIG_KEY, config);
    return config;
}

async function getStatuses() {
    const value = await readKV('sys', STATUS_KEY, { byId: {}, lastProbeAt: null });
    return value && typeof value === 'object'
        ? { byId: value.byId && typeof value.byId === 'object' ? value.byId : {}, lastProbeAt: value.lastProbeAt || null }
        : { byId: {}, lastProbeAt: null };
}

async function saveStatuses(value) {
    const normalized = {
        byId: value && value.byId && typeof value.byId === 'object' ? value.byId : {},
        lastProbeAt: value && value.lastProbeAt || null
    };
    await writeKV('sys', STATUS_KEY, normalized);
    return normalized;
}

module.exports = {
    DEFAULT_LINKS,
    DEFAULT_API_RELAY,
    CONFIG_SCHEMA_VERSION,
    DEFAULT_INTERVAL_MINUTES,
    MIN_INTERVAL_MINUTES,
    MAX_INTERVAL_MINUTES,
    normalizeUrl,
    normalizeLink,
    normalizeApiRelay,
    migrateLegacyApiRelayModels,
    normalizeConfig,
    getConfig,
    saveConfig,
    getStatuses,
    saveStatuses
};
