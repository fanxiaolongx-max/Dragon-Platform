// 全局设置 › 平台推广：首页右上角推广区（内置视频 + 推广链接）的配置。
// 内置视频与内置链接只能隐藏，不能删除或改地址；自定义链接可增删改。按租户保存在 sys_kv_store。
// 内置（默认）链接来自受版本控制的 backend/platform-promotions-defaults.json：手动编辑或在源码可写的服务上
// 通过全局设置写回，提交并推送到 Git 后即成为所有环境的默认链接。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readKV, writeKV } = require('./kv-store');

const CONFIG_KEY = 'platform_promotions_config';
const CONFIG_SCHEMA_VERSION = 1;
const MAX_CUSTOM_LINKS = 30;
const DEFAULT_MAX_LINKS = 3;
const MAX_LINKS_LIMIT = 10;
const DEFAULT_ROTATE_SECONDS = 30;
const MIN_ROTATE_SECONDS = 10;
const MAX_ROTATE_SECONDS = 600;
const COLORS = ['teal', 'blue', 'violet', 'orange', 'rose', 'green'];

// 与 frontend/js/home/promo-video.js 的 ORDER 保持一致
const BUILTIN_VIDEOS = [
    { id: 'rfc', name: 'NetCare RFC 方案与 AI 审计', nameEn: 'NetCare RFC Plans and AI Audit' },
    { id: 'incentive', name: '操作激励统计：怎么算准每一笔', nameEn: 'Operation Incentive Statistics' },
    { id: 'eos', name: 'EOS 风险收编：一键取数，自动成月报', nameEn: 'EOS incorporation and monthly report' },
    { id: 'guide', name: 'Dragon 平台五站使用指南', nameEn: 'Dragon Platform five-step guide' }
];

const DEFAULTS_FILE = process.env.TOOLS_PROMOTION_DEFAULTS_FILE || path.join(__dirname, '../platform-promotions-defaults.json');
const MAX_DEFAULT_LINKS = 20;

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
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('推广链接仅支持 HTTP 或 HTTPS 地址');
    if (parsed.username || parsed.password) throw new Error('推广链接地址不能包含账号或密码');
    return parsed.toString();
}

const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max);
const clampInt = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

function makeLinkId(url, index) {
    return `promo_${crypto.createHash('sha1').update(`${url}:${index}`).digest('hex').slice(0, 12)}`;
}

// 每次读取文件：手动编辑默认链接后无需重启
function builtinLinks() {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(DEFAULTS_FILE, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[platform-promotions] 读取默认推广链接失败：', error.message);
        return [];
    }
    const used = new Set();
    const links = [];
    (Array.isArray(parsed && parsed.links) ? parsed.links : []).slice(0, MAX_DEFAULT_LINKS).forEach((item, index) => {
        try {
            if (!item || !item.id) throw new Error('缺少 id');
            const link = normalizeCustomLink(item, index, used);
            links.push({ ...link, builtin: true, enabled: true });
        } catch (error) {
            console.warn(`[platform-promotions] 忽略无效的默认推广链接 #${index + 1}：`, error.message);
        }
    });
    return links;
}

/** 默认链接文件是否可写（打包后的桌面版在 app.asar 内只读） */
function defaultsWritable() {
    const file = path.resolve(DEFAULTS_FILE);
    if (/\.asar(?:[\\/]|$)/i.test(file)) return false;
    try {
        fs.accessSync(fs.existsSync(file) ? file : path.dirname(file), fs.constants.W_OK);
        return true;
    } catch (_) {
        return false;
    }
}

function saveDefaultLinks(input) {
    if (!defaultsWritable()) {
        throw Object.assign(new Error('当前运行环境的项目源码不可写（例如打包后的桌面版），请在项目源码目录运行的服务上修改默认链接'), { statusCode: 409 });
    }
    const raw = Array.isArray(input) ? input : [];
    if (raw.length > MAX_DEFAULT_LINKS) throw new Error(`默认推广链接最多 ${MAX_DEFAULT_LINKS} 个`);
    const used = new Set();
    const links = raw.map((item, index) => {
        if (!item || !String(item.id || '').trim()) throw new Error('默认推广链接缺少 id');
        const { id, name, nameEn, badge, badgeEn, description, descriptionEn, url, color } = normalizeCustomLink(item, index, used);
        return { id, name, nameEn, badge, badgeEn, description, descriptionEn, url, color };
    });
    const temp = `${DEFAULTS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ links }, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, DEFAULTS_FILE);
    return links;
}

function normalizeCustomLink(item, index, usedIds) {
    const url = normalizeUrl(item && item.url);
    const name = text(item && item.name, 40);
    if (!name) throw new Error('推广链接名称不能为空');
    let id = text(item && item.id, 64).replace(/[^a-zA-Z0-9_-]+/g, '_');
    if (!id || usedIds.has(id)) id = makeLinkId(url, index);
    while (usedIds.has(id)) id = makeLinkId(url, index + usedIds.size + 1);
    usedIds.add(id);
    return {
        id,
        builtin: false,
        enabled: item.enabled !== false,
        name,
        nameEn: text(item.nameEn, 60),
        badge: text(item.badge, 12) || '推广',
        badgeEn: text(item.badgeEn, 16),
        description: text(item.description, 120),
        descriptionEn: text(item.descriptionEn, 160),
        url,
        color: COLORS.includes(item.color) ? item.color : 'blue'
    };
}

function normalizeConfig(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const BUILTIN_LINKS = builtinLinks();
    const videoState = new Map((Array.isArray(source.videos) ? source.videos : [])
        .filter(item => item && typeof item === 'object').map(item => [item.id, item.enabled !== false]));
    const videos = BUILTIN_VIDEOS.map(video => ({ ...video, builtin: true, enabled: videoState.has(video.id) ? videoState.get(video.id) : true }));

    const rawLinks = Array.isArray(source.links) ? source.links.filter(item => item && typeof item === 'object') : [];
    const builtinState = new Map(rawLinks.filter(item => BUILTIN_LINKS.some(link => link.id === item.id)).map(item => [item.id, item]));
    // 内置链接只接受“是否显示”与排序位置，其余字段始终以代码为准
    const usedIds = new Set(BUILTIN_LINKS.map(link => link.id));
    const custom = rawLinks.filter(item => !BUILTIN_LINKS.some(link => link.id === item.id));
    if (custom.length > MAX_CUSTOM_LINKS) throw new Error(`自定义推广链接最多支持 ${MAX_CUSTOM_LINKS} 个`);
    const ordered = [];
    const placed = new Set();
    rawLinks.forEach((item, index) => {
        const builtin = BUILTIN_LINKS.find(link => link.id === item.id);
        if (builtin) {
            if (placed.has(builtin.id)) return;
            placed.add(builtin.id);
            ordered.push({ ...builtin, builtin: true, enabled: builtinState.get(builtin.id).enabled !== false });
        } else {
            ordered.push(normalizeCustomLink(item, index, usedIds));
        }
    });
    // 新增的内置链接（或旧配置里没有的）放在最前
    BUILTIN_LINKS.filter(link => !placed.has(link.id)).reverse()
        .forEach(link => ordered.unshift({ ...link, builtin: true, enabled: true }));

    return {
        schemaVersion: CONFIG_SCHEMA_VERSION,
        maxLinks: clampInt(source.maxLinks, 1, MAX_LINKS_LIMIT, DEFAULT_MAX_LINKS),
        rotateSeconds: clampInt(source.rotateSeconds, MIN_ROTATE_SECONDS, MAX_ROTATE_SECONDS, DEFAULT_ROTATE_SECONDS),
        desktopStack: source.desktopStack !== false,
        videos,
        links: ordered,
        defaultsWritable: defaultsWritable(),
        updatedAt: source.updatedAt || null
    };
}

async function getConfig() {
    const stored = await readKV('sys', CONFIG_KEY, null);
    return normalizeConfig(stored || {});
}

async function saveConfig(input) {
    const config = normalizeConfig({ ...(input || {}), updatedAt: new Date().toISOString() });
    const { defaultsWritable: _writable, ...stored } = config;
    await writeKV('sys', CONFIG_KEY, stored);
    return config;
}

module.exports = {
    CONFIG_KEY,
    BUILTIN_VIDEOS,
    DEFAULTS_FILE,
    builtinLinks,
    defaultsWritable,
    saveDefaultLinks,
    COLORS,
    MAX_CUSTOM_LINKS,
    DEFAULT_MAX_LINKS,
    MAX_LINKS_LIMIT,
    DEFAULT_ROTATE_SECONDS,
    MIN_ROTATE_SECONDS,
    MAX_ROTATE_SECONDS,
    normalizeUrl,
    normalizeConfig,
    getConfig,
    saveConfig
};
