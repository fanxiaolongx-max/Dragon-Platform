// 全局设置 › 平台推广：首页右上角推广区（内置视频 + 推广链接）的配置。
// 内置链接可隐藏或更换封面，不能删除或改地址；自定义链接可增删改。按租户保存在 sys_kv_store。
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
    { id: 'guide', name: 'Dragon 平台五站使用指南', nameEn: 'Dragon Platform five-step guide' },
    { id: 'aiMonthly', name: 'AI 月报：这个月做好，下个月接着用', nameEn: 'AI Monthly Reports: build once, reuse next month (Mandarin)' },
    { id: 'welinkCli', name: 'WeLink CLI：把散落的办公信息找回来', nameEn: 'WeLink CLI: personal office assistant (Mandarin)' },
    { id: 'welinkSdk', name: 'WeLink SDK：把运营助手装进口袋', nameEn: 'WeLink SDK: the platform assistant on your phone (Mandarin)' },
    { id: 'digitalHuman', name: '数字人基座：从看不懂表，到查得清数据', nameEn: 'Digital Human Base: understand and query NetCare data (Mandarin)' }
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
        const { id, name, nameEn, badge, badgeEn, description, descriptionEn, url, color, coverImage } = normalizeCustomLink(item, index, used);
        return { id, name, nameEn, badge, badgeEn, description, descriptionEn, url, color, coverImage };
    });
    const temp = `${DEFAULTS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ links }, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, DEFAULTS_FILE);
    return links;
}

function normalizeCoverImage(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\/assets\/promotions\/[a-zA-Z0-9/_-]+\.(?:svg|png|jpg|jpeg|webp)$/.test(raw) && !raw.includes('..')) return raw;
    if (raw.startsWith('data:')) {
        if (raw.length > 710000) throw new Error('封面图片不能超过 512 KB');
        const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
        if (!match) throw new Error('封面图片仅支持 PNG、JPEG、WebP');
        const bytes = Buffer.from(match[2], 'base64');
        const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
                : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        if (!valid || bytes.length > 512 * 1024) throw new Error('封面图片无效或超过 512 KB');
        return raw;
    }
    return normalizeUrl(raw);
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
        color: COLORS.includes(item.color) ? item.color : 'blue',
        coverImage: normalizeCoverImage(item.coverImage)
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
    // 内置链接允许租户更换封面，名称和目标地址仍以代码为准。
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
            ordered.push({ ...builtin, builtin: true, enabled: builtinState.get(builtin.id).enabled !== false,
                coverImage: Object.hasOwn(item, 'coverImage') ? normalizeCoverImage(item.coverImage) : builtin.coverImage });
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
    // 与默认封面相同时继承源码默认值，避免普通保存把旧默认封面永久固定。
    const defaults = builtinLinks();
    stored.links = stored.links.map(link => {
        if (link.builtin && link.coverImage === defaults.find(item => item.id === link.id)?.coverImage) {
            const { coverImage: _cover, ...inherited } = link;
            return inherited;
        }
        return link;
    });
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
