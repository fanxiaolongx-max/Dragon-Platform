const path = require('node:path');
const fs = require('node:fs');
const { readKV, writeKV } = require('./kv-store');
const { getTenantId, DEFAULT_TENANT_ID } = require('./tenant-context');

const FALLBACK_PLATFORM_IDENTITY = Object.freeze({
    platformName: 'Dragon 工具平台',
    platformNameZh: 'Dragon 工具平台',
    platformNameEn: 'Dragon Platform',
    platformSubtitle: '埃及 CS 工具与知识中心',
    platformSubtitleEn: 'Egypt CS Tools & Knowledge Center',
    platformSlogan: '“以智慧之神图特之羽衡度万象，以数智之枢纽连接经验与效率。”',
    platformSloganEn: '“By the scales of Thoth, ancient god of wisdom — measuring order, uniting tools, and turning experience into efficiency.”'
});

function getDefaultPlatformIdentity() {
    try {
        const file = path.join(__dirname, '../defaults/platform-identity.json');
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (data && typeof data === 'object') {
                const clean = (val, fallback, max = 120) => {
                    if (typeof val === 'string') {
                        const trimmed = val.replace(/[\u0000-\u001f\u007f]/g, '').trim();
                        if (trimmed) return trimmed.slice(0, max);
                    }
                    return fallback;
                };
                const platformNameZh = clean(data.platformNameZh, clean(data.platformName, FALLBACK_PLATFORM_IDENTITY.platformNameZh, 80), 80);
                const platformNameEn = clean(data.platformNameEn, FALLBACK_PLATFORM_IDENTITY.platformNameEn, 80);
                const platformSubtitle = clean(data.platformSubtitle, FALLBACK_PLATFORM_IDENTITY.platformSubtitle, 120);
                const platformSubtitleEn = clean(data.platformSubtitleEn, FALLBACK_PLATFORM_IDENTITY.platformSubtitleEn, 120);
                const platformSlogan = clean(data.platformSlogan, FALLBACK_PLATFORM_IDENTITY.platformSlogan, 200);
                const platformSloganEn = clean(data.platformSloganEn, FALLBACK_PLATFORM_IDENTITY.platformSloganEn, 200);
                const platformName = clean(data.platformName, platformNameZh, 80);
                return {
                    platformName,
                    platformNameZh,
                    platformNameEn,
                    platformSubtitle,
                    platformSubtitleEn,
                    platformSlogan,
                    platformSloganEn
                };
            }
        }
    } catch (_) {}
    return { ...FALLBACK_PLATFORM_IDENTITY };
}

function getDefaultPlatformName() {
    const identity = getDefaultPlatformIdentity();
    return identity.platformNameZh || identity.platformName || '图特工具平台';
}

const DEFAULT_GUIDE_VIDEO_URL = 'https://jx.huawei.com/community/comgroup/videoShareDetail/7207b25a9c0f42a08dfb1ab9832d44fe?commentId=0cca456df675451ca2df19c08b01ab11';

function normalizeGuideVideoUrl(value) {
    if (value === undefined) return DEFAULT_GUIDE_VIDEO_URL;
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value.trim());
        return /^https?:$/.test(url.protocol) && !url.username && !url.password && value.length <= 2048 ? url.href : '';
    } catch (_) { return ''; }
}

const FALLBACK_NAV_LAYOUT = Object.freeze({
    primaryIds: [
        'home',
        'uivf12',
        'sla',
        'report',
        'custom-report',
        'expedite',
        'monthly',
        'bigscreen',
        'topic-analysis',
        'custom:network_safety_meeting_summary'
    ],
    categories: [
        { id: 'audit', name: '审计与核算', nameEn: 'Audit & KPI' },
        { id: 'cat_mu9po0me', name: '奖惩管理', nameEn: 'Incentive & Negative' },
        { id: 'cat_mq0nny3v', name: '五个端到端', nameEn: '“5” E2E' },
        { id: 'cat_msbmuup1', name: '实用工具', nameEn: 'Useful' },
        { id: 'cat_msbmvd5l', name: '网络安全', nameEn: 'Safety' },
        { id: 'cat_mshv1h0m', name: '汇报呈现', nameEn: 'Report' },
        { id: 'custom', name: '自定义工具', nameEn: 'Custom Tools' },
        { id: 'cat_mshua5iu', name: '休闲娱乐', nameEn: 'Play' },
        { id: 'cat_ms2192c7', name: '行政餐饮', nameEn: 'Admin' },
        { id: 'system', name: '系统治理', nameEn: 'System Governance' }
    ],
    categoryByItem: {
        frt: 'audit',
        praudit: 'audit',
        storage: 'system',
        'db-explorer': 'system',
        'topic-analysis': 'cat_mshv1h0m',
        'custom:eos_tool-v2': 'cat_mq0nny3v',
        'custom:eos': 'cat_mq0nny3v',
        'custom:eos_tool-v4': 'cat_mq0nny3v',
        'custom:eos_tool-v8': 'cat_mq0nny3v',
        'custom:esn-check': 'cat_mq0nny3v',
        'custom:pr': 'audit',
        'custom:tool-mro1gt5o': 'cat_ms2192c7',
        'custom:tool-mr87218d': 'cat_ms2192c7',
        'custom:tool-mrlpwjk3': 'cat_ms2192c7',
        'custom:tool-ms1saxuh': 'cat_ms2192c7',
        'custom:tool-msbmscxd': 'audit',
        'custom:tool-msbmu55i': 'audit',
        'custom:tool-ms4xb66s': 'cat_mu9po0me',
        'custom:tool-mrhqjeya': 'cat_msbmuup1',
        'custom:tool-mrsw86w8': 'cat_mshv1h0m',
        'custom:pr-2': 'cat_msbmuup1',
        'custom:f12-to-extension': 'audit',
        'custom:tool-mrrgpqy4': 'cat_ms2192c7',
        'custom:particle-effects': 'cat_mshua5iu',
        'custom:tool-mrrn48dc': 'cat_mshua5iu',
        'custom:optical-transfer': 'cat_mshua5iu',
        'custom:tool-msf5b7nn': 'cat_mu9po0me',
        'custom:nis_2026h1_summary': 'cat_mshv1h0m',
        'custom:tool-msh8aro4': 'cat_mshv1h0m',
        'custom:question-bank-assistant-privacy': 'cat_mshv1h0m',
        'custom:tool-mr88gv9x': 'cat_mshv1h0m'
    },
    itemOrder: [
        'praudit',
        'custom:pr',
        'frt',
        'storage',
        'db-explorer',
        'custom:eos_tool-v8',
        'custom:tool-mqtlwcrv',
        'custom:nis_2026h1_summary',
        'custom:tool-ms4xb66s',
        'custom:particle-effects',
        'custom:esn-check',
        'custom:tool-mqp55fna',
        'custom:tool-mrrn48dc',
        'custom:tool-ms1saxuh',
        'custom:tool-mr88gv9x',
        'custom:tool-mrlpwjk3',
        'custom:tool-mrrgpqy4',
        'custom:tool-mrhqjeya',
        'custom:tool-mr87218d',
        'custom:tool-mr0vvmyi',
        'custom:tool-mro1gt5o',
        'custom:tool-mrsw86w8'
    ]
});

function getDefaultNavLayout() {
    try {
        const file = path.join(__dirname, '../defaults/nav-layout.json');
        if (fs.existsSync(file)) {
            const data = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (data && typeof data === 'object') {
                const primaryIds = Array.isArray(data.primaryIds) ? data.primaryIds.map(String) : FALLBACK_NAV_LAYOUT.primaryIds.slice();
                const categories = Array.isArray(data.categories) && data.categories.length ? data.categories : FALLBACK_NAV_LAYOUT.categories.slice();
                const categoryByItem = data.categoryByItem && typeof data.categoryByItem === 'object' && !Array.isArray(data.categoryByItem)
                    ? { ...data.categoryByItem }
                    : { ...FALLBACK_NAV_LAYOUT.categoryByItem };
                const itemOrder = Array.isArray(data.itemOrder) ? data.itemOrder.map(String) : FALLBACK_NAV_LAYOUT.itemOrder.slice();
                return { primaryIds, categories, categoryByItem, itemOrder };
            }
        }
    } catch (_) {}
    return {
        primaryIds: FALLBACK_NAV_LAYOUT.primaryIds.slice(),
        categories: FALLBACK_NAV_LAYOUT.categories.slice(),
        categoryByItem: { ...FALLBACK_NAV_LAYOUT.categoryByItem },
        itemOrder: FALLBACK_NAV_LAYOUT.itemOrder.slice()
    };
}

const DEFAULT_SETTINGS = {
    get platformName() { return getDefaultPlatformName(); },
    get platformNameZh() { return getDefaultPlatformIdentity().platformNameZh; },
    get platformNameEn() { return getDefaultPlatformIdentity().platformNameEn; },
    get platformSubtitle() { return getDefaultPlatformIdentity().platformSubtitle; },
    get platformSubtitleEn() { return getDefaultPlatformIdentity().platformSubtitleEn; },
    get platformSlogan() { return getDefaultPlatformIdentity().platformSlogan; },
    get platformSloganEn() { return getDefaultPlatformIdentity().platformSloganEn; },
    // 首次安装或恢复默认时使用 defaults/nav-layout.json；已有租户配置不会被覆盖。
    get primaryIds() { return getDefaultNavLayout().primaryIds; },
    get categories() { return getDefaultNavLayout().categories; },
    get categoryByItem() { return getDefaultNavLayout().categoryByItem; },
    get itemOrder() { return getDefaultNavLayout().itemOrder; }
};

function normalizeSettings(input = {}) {
    const categories = Array.isArray(input.categories) && input.categories.length
        ? input.categories
        : DEFAULT_SETTINGS.categories;
    const normalizedCategories = categories
        .map((item, index) => {
            const cat = {
                id: String(item.id || `cat_${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, '_'),
                name: String(item.name || `分类 ${index + 1}`).trim()
            };
            if (item.nameEn) {
                cat.nameEn = String(item.nameEn).trim();
            }
            return cat;
        })
        .filter(item => item.id && item.name);

    const defaultIdentity = getDefaultPlatformIdentity();
    const sanitizeText = (val, fallback, maxLen = 120) => {
        if (typeof val === 'string') {
            const clean = val.replace(/[\u0000-\u001f\u007f]/g, '').trim();
            if (clean) return clean.slice(0, maxLen);
        }
        return fallback;
    };

    const rawPlatformName = typeof input.platformName === 'string'
        ? input.platformName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80)
        : '';
    const rawHasNonAscii = /[^\x00-\x7F]/.test(rawPlatformName);
    const defaultZh = rawHasNonAscii ? rawPlatformName : defaultIdentity.platformNameZh;
    const defaultEn = (!rawHasNonAscii && rawPlatformName) ? rawPlatformName : defaultIdentity.platformNameEn;
    let platformNameZh = sanitizeText(input.platformNameZh, defaultZh, 80);
    let platformNameEn = sanitizeText(input.platformNameEn, defaultEn, 80);

    if (platformNameZh && platformNameEn && platformNameZh.toLowerCase() === platformNameEn.toLowerCase() && !/[^\x00-\x7F]/.test(platformNameZh) && (platformNameEn.toLowerCase() === 'thoth platform' || platformNameEn.toLowerCase() === 'tools platform' || platformNameEn.toLowerCase() === 'eg cs hub')) {
        platformNameZh = defaultIdentity.platformNameZh;
    }

    const platformSubtitle = sanitizeText(input.platformSubtitle, defaultIdentity.platformSubtitle, 120);
    const platformSubtitleEn = sanitizeText(input.platformSubtitleEn, defaultIdentity.platformSubtitleEn, 120);
    const platformSlogan = sanitizeText(input.platformSlogan, defaultIdentity.platformSlogan, 200);
    const platformSloganEn = sanitizeText(input.platformSloganEn, defaultIdentity.platformSloganEn, 200);
    const platformName = rawPlatformName || platformNameZh || defaultIdentity.platformName;

    return {
        platformGuideVideoUrl: normalizeGuideVideoUrl(input.platformGuideVideoUrl),
        platformName,
        platformNameZh,
        platformNameEn,
        platformSubtitle,
        platformSubtitleEn,
        platformSlogan,
        platformSloganEn,
        f12QuickDownloads: Array.isArray(input.f12QuickDownloads)
            ? input.f12QuickDownloads
                .filter(item => item && typeof item.scriptId === 'string' && /^(builtin|server):[a-zA-Z0-9_-]+$/.test(item.scriptId))
                .map(item => ({ scriptId: item.scriptId, target: item.target === 'local' ? 'local' : 'store' }))
            : [],
        primaryIds: Array.isArray(input.primaryIds) ? input.primaryIds.map(String) : DEFAULT_SETTINGS.primaryIds.slice(),
        categories: normalizedCategories.length ? normalizedCategories : DEFAULT_SETTINGS.categories.slice(),
        categoryByItem: input.categoryByItem && typeof input.categoryByItem === 'object' && !Array.isArray(input.categoryByItem)
            ? { ...input.categoryByItem }
            : { ...DEFAULT_SETTINGS.categoryByItem },
        itemOrder: Array.isArray(input.itemOrder) ? input.itemOrder.map(String) : DEFAULT_SETTINGS.itemOrder.slice()
    };
}

function collectDefaultItemIds() {
    return new Set([
        ...DEFAULT_SETTINGS.primaryIds,
        ...Object.keys(DEFAULT_SETTINGS.categoryByItem),
        ...DEFAULT_SETTINGS.itemOrder
    ].map(String));
}

function mergeDefaultSettingsPreservingCustomTools(currentInput, customToolIds = []) {
    const current = normalizeSettings(currentInput || {});
    const defaults = normalizeSettings(DEFAULT_SETTINGS);
    const defaultItemIds = collectDefaultItemIds();
    const registeredCustomIds = [...new Set((customToolIds || []).map(String).filter(id => id.startsWith('custom:')))];
    const preservedCustomIds = registeredCustomIds.filter(id => !defaultItemIds.has(id));
    const preservedSet = new Set(preservedCustomIds);

    const defaultCategoryIds = new Set(defaults.categories.map(category => category.id));
    const preservedCategories = current.categories
        .filter(category => !defaultCategoryIds.has(category.id))
        .map(category => ({ ...category }));
    const categories = [...defaults.categories.map(category => ({ ...category })), ...preservedCategories];
    const availableCategoryIds = new Set(categories.map(category => category.id));

    const preservedPrimaryIds = current.primaryIds.filter(id => preservedSet.has(id));
    const primaryIds = [...defaults.primaryIds, ...preservedPrimaryIds.filter(id => !defaults.primaryIds.includes(id))];
    const primarySet = new Set(primaryIds);

    const categoryByItem = { ...defaults.categoryByItem };
    preservedCustomIds.forEach(id => {
        const currentCategory = current.categoryByItem[id];
        categoryByItem[id] = availableCategoryIds.has(currentCategory) ? currentCategory : 'custom';
    });

    const itemOrder = defaults.itemOrder.slice();
    const itemOrderSet = new Set(itemOrder);
    current.itemOrder.forEach(id => {
        if (preservedSet.has(id) && !primarySet.has(id) && !itemOrderSet.has(id)) {
            itemOrder.push(id);
            itemOrderSet.add(id);
        }
    });
    preservedCustomIds.forEach(id => {
        if (!primarySet.has(id) && !itemOrderSet.has(id)) {
            itemOrder.push(id);
            itemOrderSet.add(id);
        }
    });

    return normalizeSettings({
        primaryIds,
        categories,
        categoryByItem,
        itemOrder,
        platformGuideVideoUrl: current.platformGuideVideoUrl,
        platformName: current.platformName,
        platformNameZh: current.platformNameZh,
        platformNameEn: current.platformNameEn,
        platformSubtitle: current.platformSubtitle,
        platformSubtitleEn: current.platformSubtitleEn,
        platformSlogan: current.platformSlogan,
        platformSloganEn: current.platformSloganEn,
        f12QuickDownloads: current.f12QuickDownloads
    });
}

async function getSettings() {
    return normalizeSettings(await readKV('sys', 'nav_settings', DEFAULT_SETTINGS));
}

async function saveSettings(settings) {
    // Older navigation clients must not erase separately configured packaging shortcuts or identity properties.
    const input = { ...settings };
    const current = await getSettings();
    if (!Object.hasOwn(input, 'platformGuideVideoUrl')) input.platformGuideVideoUrl = current.platformGuideVideoUrl;
    if (!Object.hasOwn(input, 'f12QuickDownloads')) input.f12QuickDownloads = current.f12QuickDownloads;
    if (!Object.hasOwn(input, 'platformName')) input.platformName = current.platformName;
    if (!Object.hasOwn(input, 'platformNameZh')) input.platformNameZh = current.platformNameZh;
    if (!Object.hasOwn(input, 'platformNameEn')) input.platformNameEn = current.platformNameEn;
    if (!Object.hasOwn(input, 'platformSubtitle')) input.platformSubtitle = current.platformSubtitle;
    if (!Object.hasOwn(input, 'platformSubtitleEn')) input.platformSubtitleEn = current.platformSubtitleEn;
    if (!Object.hasOwn(input, 'platformSlogan')) input.platformSlogan = current.platformSlogan;
    if (!Object.hasOwn(input, 'platformSloganEn')) input.platformSloganEn = current.platformSloganEn;

    const normalized = normalizeSettings(input);
    await writeKV('sys', 'nav_settings', normalized);

    // 在本地源码开发环境（非打包 Electron ASAR，且非只读运行时，且仅限平台默认租户），自动同步新名称到源码版本库
    try {
        const file = path.join(__dirname, '../defaults/platform-identity.json');
        if (getTenantId() === DEFAULT_TENANT_ID && !process.env.TOOLS_DATA_DIR && !process.env.TOOLS_DESKTOP_RUNTIME && fs.existsSync(path.dirname(file))) {
            const identityPayload = {
                platformName: normalized.platformName || normalized.platformNameZh,
                platformNameZh: normalized.platformNameZh,
                platformNameEn: normalized.platformNameEn,
                platformSubtitle: normalized.platformSubtitle,
                platformSubtitleEn: normalized.platformSubtitleEn,
                platformSlogan: normalized.platformSlogan,
                platformSloganEn: normalized.platformSloganEn
            };
            fs.writeFileSync(file, JSON.stringify(identityPayload, null, 2), 'utf8');
        }
    } catch (_) {}

    return normalized;
}

async function restoreDefaultsPreservingCustomTools(customToolIds = []) {
    const current = await getSettings();
    const restored = mergeDefaultSettingsPreservingCustomTools(current, customToolIds);
    await writeKV('sys', 'nav_settings', restored);
    return {
        settings: restored,
        preservedCustomToolCount: customToolIds.filter(id => !collectDefaultItemIds().has(String(id))).length,
        preservedCustomCategoryCount: restored.categories.filter(category =>
            !DEFAULT_SETTINGS.categories.some(defaultCategory => defaultCategory.id === category.id)
        ).length
    };
}

async function setAsDefaultLayout(layoutToSet) {
    const current = layoutToSet ? normalizeSettings(layoutToSet) : (await getSettings());
    const layout = {
        primaryIds: Array.isArray(current.primaryIds) ? current.primaryIds.map(String) : [],
        categories: Array.isArray(current.categories) ? current.categories.map(c => ({
            id: String(c.id).trim(),
            name: String(c.name).trim(),
            ...(c.nameEn ? { nameEn: String(c.nameEn).trim() } : {})
        })) : [],
        categoryByItem: current.categoryByItem && typeof current.categoryByItem === 'object' && !Array.isArray(current.categoryByItem)
            ? { ...current.categoryByItem }
            : {},
        itemOrder: Array.isArray(current.itemOrder) ? current.itemOrder.map(String) : []
    };

    // 写入源码默认配置文件 defaults/nav-layout.json（可随代码仓库一同推送至远端）
    const defaultsDir = path.join(__dirname, '../defaults');
    fs.mkdirSync(defaultsDir, { recursive: true });
    const file = path.join(defaultsDir, 'nav-layout.json');
    fs.writeFileSync(file, JSON.stringify(layout, null, 2) + '\n', 'utf8');

    // 自动生效：保存到当前租户的配置
    const saved = await saveSettings({
        ...current,
        primaryIds: layout.primaryIds,
        categories: layout.categories,
        categoryByItem: layout.categoryByItem,
        itemOrder: layout.itemOrder
    });

    return {
        success: true,
        file: 'backend/defaults/nav-layout.json',
        settings: saved,
        layout
    };
}

module.exports = {
    DEFAULT_SETTINGS,
    getDefaultPlatformIdentity,
    getDefaultPlatformName,
    getDefaultNavLayout,
    normalizeSettings,
    mergeDefaultSettingsPreservingCustomTools,
    getSettings,
    saveSettings,
    restoreDefaultsPreservingCustomTools,
    setAsDefaultLayout
};
