// Shared platform capability: platform-core. See docs/frontend-architecture.md.
const platformStatus = { online: true, unread: 0, version: '' };
window.ToolsPlatform = { status: () => ({ ...platformStatus }), catalog: () => getAllNavItems() };
function publishPlatformStatus(patch) {
    Object.assign(platformStatus, patch);
    window.dispatchEvent(new CustomEvent('tools:platform-status', { detail: { ...platformStatus } }));
}
function publishPlatformCatalog() {
    applyPlatformIdentity();
    window.dispatchEvent(new CustomEvent('tools:catalog-change'));
}

// Shared platform context. Tool documents occupy the full viewport.
const PLATFORM_EMBEDDED = (() => {
    if (new URLSearchParams(location.search).get('standalone') === '1') return true;
    try { return window.top !== window && window.top.location.origin === location.origin && Boolean(window.top.HomeToolFrame); } catch { return false; }
})();
document.documentElement.classList.add('is-embedded-tool');
const NAV_BUILTIN_LINKS = [
    { id: 'home', href: '/', icon: '🏠', label: '工具中台', labelKey: 'nav.home', defaultCategory: 'business', match: p => p === '/' },
    { id: 'uivf12', href: '/uivf12', icon: '🚀', label: '数据抓取', labelKey: 'nav.uivf12', defaultCategory: 'business', match: p => p.startsWith('/uivf12') },
    { id: 'sla', href: '/sla', icon: '📊', label: '数据导入', labelKey: 'nav.sla', defaultCategory: 'business', match: p => p.startsWith('/sla') },
    { id: 'report', href: '/report', icon: '📈', label: '报表看板', labelKey: 'nav.report', defaultCategory: 'business', match: p => p.startsWith('/report') },
    { id: 'expedite', href: '/expedite', icon: '⚡', label: '一键催办', labelKey: 'nav.expedite', defaultCategory: 'business', match: p => p.startsWith('/expedite') },
    { id: 'monthly', href: '/monthly', icon: '📅', label: '月报页面', labelKey: 'nav.monthly', defaultCategory: 'business', match: p => p.startsWith('/monthly') || p === '/pages/ai-report.html' },
    { id: 'ai-bi', href: '/ai-bi', icon: '🧩', label: 'AI BI', labelEn: 'AI BI', labelKey: 'nav.aiBi', defaultCategory: 'business', match: p => p.startsWith('/ai-bi') || p === '/pages/ai-bi.html' || p.endsWith('/ai-bi.html') },
    { id: 'duty-roster', href: '/duty-roster', icon: '🌙', label: '值班表', labelEn: 'Duty Roster', labelKey: 'nav.dutyRoster', defaultCategory: 'business', match: p => p.startsWith('/duty-roster') },
    { id: 'bigscreen', href: '/bigscreen', icon: '🖥️', label: '大屏看板', labelKey: 'nav.bigscreen', defaultCategory: 'business', match: p => p.startsWith('/bigscreen') },
    { id: 'topic-analysis', href: '/topic-analysis', icon: '📊', label: '专题分析', labelKey: 'nav.topicAnalysis', defaultCategory: 'cat_mshv1h0m', match: p => p.startsWith('/topic-analysis') },
    { id: 'frt', href: '/frt', icon: '📊', label: 'FRT核算', labelKey: 'nav.frt', defaultCategory: 'audit', match: p => p.startsWith('/frt') },
    { id: 'praudit', href: '/praudit', icon: '📋', label: 'PR稽查', labelKey: 'nav.praudit', defaultCategory: 'audit', match: p => p.startsWith('/praudit') },
    { id: 'storage', href: '/storage', icon: '💽', label: '迁移状态', labelKey: 'nav.storage', defaultCategory: 'system', match: p => p.startsWith('/storage') },
    { id: 'db-explorer', href: '/db-explorer', icon: '🗄️', label: '数据探索', labelKey: 'nav.dbExplorer', defaultCategory: 'system', match: p => p.startsWith('/db-explorer') },
    // 数字人基座的 NetCare 业务库探查：接口第一期只开放给管理员，普通账号不显示入口
    { id: 'netcare-explorer', href: '/netcare-explorer', icon: '🧭', label: 'NetCare 数据探查', labelEn: 'NetCare Explorer', labelKey: 'nav.netcareExplorer', defaultCategory: 'system', adminOnly: true, match: p => p.startsWith('/netcare-explorer') }
];
const PLATFORM_LOCKED_PAGE_IDS = new Set(['storage', 'db-explorer', 'netcare-explorer']);
const PLATFORM_PAGE_ALIAS = { 'ai-report': 'monthly', 'duty-roster.html': 'duty-roster', 'topical-analysis': 'topic-analysis' };
function normalizePlatformPageId(idOrHref) {
    let clean = String(idOrHref || '').trim().split(/[?#]/)[0];
    if (!clean || clean === '/' || clean === '/index.html' || clean === 'home') return '';
    if (clean.startsWith('custom:') || clean.startsWith('skill:')) return '';
    if (clean.startsWith('/pages/')) clean = clean.slice('/pages/'.length);
    clean = clean.replace(/^\/+|\/+$/g, '').replace(/\.html$/i, '');
    if (!clean || clean === 'index' || clean === 'home') return '';
    return PLATFORM_PAGE_ALIAS[clean] || clean;
}
function defaultPlatformPageAccess(id) {
    const locked = PLATFORM_LOCKED_PAGE_IDS.has(id);
    return {
        id,
        sharedAccess: !locked,
        locked,
        visible: isNavSuperAdmin() || !locked
    };
}
function setPlatformPageAccessList(pages) {
    const next = {};
    for (const page of pages || []) {
        if (!page || !page.id) continue;
        next[page.id] = {
            id: page.id,
            href: page.href || `/${page.id}`,
            sharedAccess: page.sharedAccess === true,
            locked: page.locked === true,
            visible: page.visible === true
        };
    }
    navState.pageAccess = next;
}
function getPlatformPageAccess(idOrHref) {
    const id = normalizePlatformPageId(idOrHref);
    if (!id) return null;
    if (navState.pageAccess && Object.prototype.hasOwnProperty.call(navState.pageAccess, id)) {
        return navState.pageAccess[id];
    }
    return defaultPlatformPageAccess(id);
}
function isPlatformPageShared(idOrHref) {
    const id = normalizePlatformPageId(idOrHref);
    if (!id) return true;
    const entry = getPlatformPageAccess(id);
    return entry ? entry.sharedAccess === true : true;
}
if (typeof window !== 'undefined') {
    window.normalizePlatformPageId = normalizePlatformPageId;
    window.getPlatformPageAccess = getPlatformPageAccess;
    window.isPlatformPageShared = isPlatformPageShared;
    window.updatePlatformPageAccessEntry = function (page) {
        if (!page || !page.id) return;
        navState.pageAccess = {
            ...(navState.pageAccess || {}),
            [page.id]: {
                id: page.id,
                href: page.href || `/${page.id}`,
                sharedAccess: page.sharedAccess === true,
                locked: page.locked === true,
                visible: isNavSuperAdmin() || page.sharedAccess === true
            }
        };
        writeNavigationBootstrapCache();
        publishPlatformCatalog();
    };
}
const NAV_WORKFLOW_IDS = ['uivf12', 'sla', 'report', 'expedite', 'monthly', 'ai-bi', 'bigscreen'];
const NAV_WORKFLOW_CATEGORY = '__workflow';
window.NavWorkflow = {
    categoryId: NAV_WORKFLOW_CATEGORY,
    ids: NAV_WORKFLOW_IDS,
    label: () => navT('nav.set.systemTools'),
    links: () => NAV_WORKFLOW_IDS.map(id => NAV_BUILTIN_LINKS.find(item => item.id === id))
};

const NAV_DEFAULT_SETTINGS = {
    // 与服务端首次安装预设保持一致；接口返回已有配置后会立即替换此启动默认值。
    primaryIds: [
        'home', 'uivf12', 'sla', 'report', 'custom-report', 'expedite', 'monthly', 'ai-bi', 'duty-roster', 'bigscreen',
        'custom:network_safety_meeting_summary'
    ],
    categories: [
        { id: 'business', name: '业务工具', nameEn: 'Business Tools', nameKey: 'nav.category.business' },
        { id: 'audit', name: '审计与核算', nameEn: 'Audit & KPI', nameKey: 'nav.category.audit' },
        { id: 'system', name: '系统治理', nameEn: 'System Governance', nameKey: 'nav.category.system' },
        { id: 'cat_mq0nny3v', name: '五个端到端', nameEn: '“5” E2E' },
        { id: 'cat_msbmuup1', name: '实用工具', nameEn: 'Useful' },
        { id: 'cat_msbmvd5l', name: '网络安全', nameEn: 'Safety' },
        { id: 'cat_mshv1h0m', name: '汇报呈现', nameEn: 'Report' },
        { id: 'custom', name: '自定义工具', nameEn: 'Custom Tools', nameKey: 'nav.category.custom' },
        { id: 'cat_ms2192c7', name: '行政餐饮', nameEn: 'Admin' },
        { id: 'cat_mshua5iu', name: '休闲娱乐', nameEn: 'Play' }
    ],
    categoryByItem: {
        frt: 'audit', praudit: 'audit', storage: 'system', 'db-explorer': 'system', 'netcare-explorer': 'system', 'topic-analysis': 'cat_mshv1h0m',
        'custom:eos_tool-v2': 'cat_mq0nny3v', 'custom:eos': 'cat_mq0nny3v',
        'custom:eos_tool-v4': 'cat_mq0nny3v', 'custom:eos_tool-v8': 'cat_mq0nny3v',
        'custom:esn-check': 'cat_mq0nny3v', 'custom:pr': 'audit',
        'custom:tool-mro1gt5o': 'cat_ms2192c7', 'custom:tool-mr87218d': 'cat_ms2192c7',
        'custom:tool-mrlpwjk3': 'cat_ms2192c7', 'custom:tool-ms1saxuh': 'cat_ms2192c7',
        'custom:tool-msbmscxd': 'audit', 'custom:tool-msbmu55i': 'audit',
        'custom:tool-ms4xb66s': 'cat_msbmuup1', 'custom:tool-mrhqjeya': 'cat_msbmuup1',
        'custom:tool-mrsw86w8': 'cat_mshv1h0m', 'custom:pr-2': 'cat_msbmuup1',
        'custom:f12-to-extension': 'cat_msbmuup1', 'custom:python-updater': 'cat_msbmuup1', 'custom:tool-mrrgpqy4': 'cat_ms2192c7',
        'custom:particle-effects': 'cat_mshua5iu', 'custom:tool-mrrn48dc': 'cat_mshua5iu',
        'custom:optical-transfer': 'cat_mshua5iu', 'custom:tool-msf5b7nn': 'audit',
        'custom:nis_2026h1_summary': 'cat_mshv1h0m', 'custom:tool-msh8aro4': 'cat_mshv1h0m',
        'custom:question-bank-assistant-privacy': 'cat_mshv1h0m', 'custom:tool-mr88gv9x': 'cat_mshv1h0m'
    },
    itemOrder: [
        'praudit', 'custom:pr', 'frt', 'storage', 'db-explorer', 'topic-analysis', 'custom:eos_tool-v8',
        'custom:f12-to-extension', 'custom:python-updater',
        'custom:tool-mqtlwcrv', 'custom:nis_2026h1_summary', 'custom:tool-ms4xb66s',
        'custom:particle-effects', 'custom:esn-check', 'custom:tool-mqp55fna',
        'custom:tool-mrrn48dc', 'custom:tool-ms1saxuh', 'custom:tool-mr88gv9x',
        'custom:tool-mrlpwjk3', 'custom:tool-mrrgpqy4', 'custom:tool-mrhqjeya',
        'custom:tool-mr87218d', 'custom:tool-mr0vvmyi', 'custom:tool-mro1gt5o',
        'custom:tool-mrsw86w8'
    ]
};

const NAV_BOOTSTRAP_CACHE_KEY = 'tools_nav_bootstrap_v3';
const NAV_BOOTSTRAP_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NAV_NEW_BADGE_MAX_AGE = 3 * 24 * 60 * 60 * 1000;
function isRecentlyChangedTool(tool, now = Date.now()) {
    const timestamps = [tool?.createdAt, tool?.updatedAt]
        .map(value => Date.parse(value))
        .filter(Number.isFinite);
    if (!timestamps.length) return false;
    const latestTimestamp = Math.max(...timestamps);
    const age = now - latestTimestamp;
    return age >= 0 && age < NAV_NEW_BADGE_MAX_AGE;
}

let navState = {
    settings: JSON.parse(JSON.stringify(NAV_DEFAULT_SETTINGS)),
    customTools: [],
    pageAccess: {},
    currentPrimaryItems: [],
    settingsTab: 'primary',
    saveTimer: null,
    aiSettings: null,
    aiSelectedProfileId: null,
    aiSaveTimer: null,
    aiUsageDimension: 'day',
    aiUsageExpanded: false,
    securitySettings: null,
    securityLocks: [],
    securitySaveTimer: null,
    remoteBackupSettings: null,
    remoteBackupSaveTimer: null,
    scheduleBackupSettings: null,
    scheduleBackupSaveTimer: null,
    updaterStatus: null,
    updaterVersion: null,
    updaterUnsubscribe: null,
    activeTenantId: localStorage.getItem('tools_tenant_id') || 'default',
    alertCenter: {
        events: [],
        summary: null,
        filter: 'all',
        loading: false
    }
};
let navConfirmResolver = null;
let navTypedConfirmResolver = null;
let navFormDialogResolver = null;
let navDialogPreviousFocus = null;

function tenantNavCacheKey() {
    return `${NAV_BOOTSTRAP_CACHE_KEY}:${localStorage.getItem('tools_tenant_id') || 'default'}`;
}

const TENANT_BROWSER_STATE_PREFIX = 'tools_tenant_browser_state:';
const TENANT_BROWSER_GLOBAL_KEYS = new Set([
    'tools_token', 'tools_user', 'tools_role', 'tools_super', 'tools_tenant_id', 'tools_lang', 'tools_language'
]);

function switchTenantBrowserState(fromTenantId, toTenantId) {
    const snapshot = {};
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || TENANT_BROWSER_GLOBAL_KEYS.has(key) || key.startsWith(TENANT_BROWSER_STATE_PREFIX) || key.startsWith(NAV_BOOTSTRAP_CACHE_KEY) || key.startsWith('home_sidebar_width:')) continue;
        snapshot[key] = localStorage.getItem(key);
    }
    try {
        localStorage.setItem(`${TENANT_BROWSER_STATE_PREFIX}${fromTenantId || 'default'}`, JSON.stringify(snapshot));
    } catch (error) {
        console.warn('[Tenant] browser state snapshot could not be saved:', error);
    }
    Object.keys(snapshot).forEach(key => localStorage.removeItem(key));
    try {
        const target = JSON.parse(localStorage.getItem(`${TENANT_BROWSER_STATE_PREFIX}${toTenantId || 'default'}`) || '{}');
        Object.entries(target || {}).forEach(([key, value]) => localStorage.setItem(key, String(value)));
    } catch (_) { }
    sessionStorage.clear();
}

function readNavigationBootstrapCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(tenantNavCacheKey()) || 'null');
        if (!cached || typeof cached !== 'object') return null;
        if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > NAV_BOOTSTRAP_CACHE_MAX_AGE) return null;
        if (!cached.settings || !Array.isArray(cached.customTools)) return null;
        return cached;
    } catch (_) {
        return null;
    }
}

function writeNavigationBootstrapCache() {
    try {
        localStorage.setItem(tenantNavCacheKey(), JSON.stringify({
            settings: navState.settings,
            customTools: navState.customTools,
            pageAccess: navState.pageAccess || {},
            savedAt: Date.now()
        }));
    } catch (_) {
        // 缓存不可用时继续使用服务端数据，不影响导航功能。
    }
}

function hydrateNavigationFromCache() {
    const cached = readNavigationBootstrapCache();
    if (!cached) return false;
    navState.settings = normalizeNavSettings(cached.settings);
    navState.customTools = cached.customTools;
    if (cached.pageAccess && typeof cached.pageAccess === 'object') {
        navState.pageAccess = { ...cached.pageAccess };
    }
    return true;
}

let platformI18nEntries;
function navT(key, params = {}) {
    const translated = window.ToolsI18n?.t(key, params);
    if (translated && translated !== key) return translated;
    let lang = 'zh-CN';
    try { lang = window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || localStorage.getItem('tools_language') || lang; } catch (_) {}
    const fallback = platformI18nEntries?.[lang]?.[key] ?? platformI18nEntries?.['zh-CN']?.[key] ?? key;
    return String(fallback).replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? params[name] : match);
}

function navLocaleText(zh, en) {
    return window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
}

let lastBuiltinToolsSyncPreview = null;

function getNavLabel(item) {
    if (!item) return '';
    if (window.ToolsI18n?.getLanguage?.() === 'en-US' && item.labelEn) return item.labelEn;
    if (item.labelKey && window.ToolsI18n) {
        const translated = navT(item.labelKey);
        if (translated && translated !== item.labelKey) return translated;
    }
    return item.label || '';
}

function getNavCategoryName(cat) {
    if (window.ToolsI18n?.getLanguage?.() === 'en-US' && cat.nameEn) return cat.nameEn;
    return cat.name || (cat.nameKey ? navT(cat.nameKey) : '');
}

// 拼音（全拼/首字母）匹配用平台共用的 shared/pinyin-search.js，词库较大，搜索框首次使用时再按需加载。
function normalizeNavSearchTerm(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function buildNavSearchIndex(item) {
    const values = [item.label, item.labelEn, getNavLabel(item), item.id, item.href].filter(Boolean);
    const aliases = new Set();
    values.forEach(value => {
        const normalized = normalizeNavSearchTerm(value);
        if (normalized) aliases.add(normalized);
    });
    return Array.from(aliases).join('|');
}

function isNavSearchSubsequence(query, candidate) {
    if (query.length < 2 || query.length > candidate.length) return false;
    let queryIndex = 0;
    for (const char of candidate) {
        if (char === query[queryIndex]) queryIndex += 1;
        if (queryIndex === query.length) return true;
    }
    return false;
}

function matchesNavSearch(searchIndex, query) {
    const normalizedQuery = normalizeNavSearchTerm(query);
    if (!normalizedQuery) return true;
    const pinyin = window.ToolsPinyinSearch;
    const usePinyin = Boolean(pinyin && pinyin.isPinyinQuery(query));
    return String(searchIndex || '').split('|').some(candidate =>
        candidate.includes(normalizedQuery) || isNavSearchSubsequence(normalizedQuery, candidate)
        || (usePinyin && pinyin.pinyinMatches(candidate, query))
    );
}

let navPinyinLoading = null;
function ensureNavPinyinSearch() {
    if (window.ToolsPinyinSearch) return Promise.resolve();
    navPinyinLoading ||= loadNavLazyScript('/js/shared/pinyin-search.js', 'pinyin search could not load')
        .catch(error => {
            navPinyinLoading = null;
            console.warn('[platform]', error.message);
        });
    return navPinyinLoading;
}

function registerPlatformI18n() {
    // Keep the same dictionary available during asynchronous language initialization.
    platformI18nEntries ||= {
        'zh-CN': {
            'nav.home': '工具中台',
            'nav.uivf12': '数据抓取',
            'nav.sla': '数据导入',
            'nav.report': '报表看板',
            'nav.expedite': '一键催办',
            'nav.monthly': '月报页面',
            'nav.aiBi': 'AI BI',
            'nav.dutyRoster': '值班表',
            'nav.bigscreen': '大屏看板',
            'nav.topicAnalysis': '专题分析',
            'nav.frt': 'FRT核算',
            'nav.praudit': 'PR稽查',
            'nav.storage': '迁移状态',
            'nav.dbExplorer': '数据探索',
            'nav.netcareExplorer': 'NetCare 数据探查',
            'nav.f12packer': 'F12扩展打包',
            'nav.pythonUpdater': 'Python脚本更新',
            'nav.more': '更多工具',
            'nav.sidebarShortcuts': '快捷工具',
            'nav.moreSearch': '搜索工具、拼音或首字母...',
            'nav.moreSearchLabel': '搜索更多工具',
            'nav.moreAll': '全部',
            'nav.moreRecent': '最近使用',
            'nav.moreRecentBadge': '常用直达',
            'nav.moreFavorites': '收藏',
            'nav.moreFavoritesBadge': '我的收藏',
            'nav.moreNoResults': '没有找到匹配的工具',
            'nav.requirements': '需求',
            'nav.alertCenter': '告警台',
            'nav.alertCenterTitle': '打开系统告警台',
            'nav.settings': '全局导航设置',
            'nav.userPrefix': '👤 {user}',
            'nav.logout': '退出',
            'nav.relogin.title': '需要重新登录',
            'nav.relogin.message': '浏览器里的登录信息已丢失（常见于桌面版地址或端口变化后），设置、Dragon Claw 智能体等功能暂时不可用。',
            'nav.relogin.hint': '重新登录一次即可恢复，账号和数据不受影响。',
            'nav.relogin.confirm': '重新登录',
            'nav.relogin.later': '稍后',
            'nav.online': '服务在线',
            'nav.offline': '离线',
            'nav.language': '语言',
            'nav.languageTitle': '切换语言',
            'nav.category.business': '业务工具',
            'nav.category.audit': '审计与核算',
            'nav.category.system': '系统治理',
            'nav.category.custom': '自定义工具',
            'nav.uncategorized': '未分类',
            'nav.empty': '暂无更多工具',
            'nav.customTool': '自定义工具',
            'nav.set.title': '全局设置',
            'nav.set.tab.primary': '顶部菜单',
            'nav.set.tab.sidebar': '更多菜单',
            'nav.set.tab.logo': '平台标识',
            'nav.set.tab.categories': '二级分类',
            'nav.set.tab.items': '分类与顺序',
            'nav.set.tab.ai': 'AI 助手',
            'nav.set.tab.channels': '频道对接',
            'nav.set.sub.channels': '把平台接入 WeLink 等频道：配置连接、扫码授权、测试连通性、管理黑白名单与主动推送范围。',
            'nav.set.tab.update': '程序更新',
            'nav.set.tab.backup': '备份恢复',
            'nav.set.tab.snapshotPublish': '静态页面推送',
            'nav.set.tab.initialize': '初始化',
            'nav.set.tab.media': '媒体资源',
            'nav.set.tab.promotions': '平台推广',
            'nav.set.tab.customBackup': '自定义工具备份',
            'nav.set.tab.accounts': '账号管理',
            'nav.set.tab.security': '安全策略',
            'nav.set.tab.pages': '页面配置',
            'nav.set.saved': '已自动保存',
            'nav.set.saving': '正在自动保存...',
            'nav.set.saveFail': '保存失败: ',
            'nav.set.loaded': '已加载',
            'nav.set.pageConfig': '{page}配置',
            'nav.page.f12.title': 'F12插件',
            'nav.set.sub.primary': '修改后会自动保存，并立即影响工具快捷入口。',
            'nav.set.sub.sidebar': '管理首页左侧「更多」里的工具快捷入口。',
            'nav.set.sub.logo': '修改平台名称、主图标及桌面应用图标。',
            'nav.set.sub.categories': '修改后会自动保存，并立即影响“更多工具”的分类展示。',
            'nav.set.sub.items': '修改后会自动保存，并立即影响“更多工具”的分组与排序。',
            'nav.set.sub.ai': '修改后会自动保存，并立即影响 Dragon Claw 智能体配置。',
            'nav.set.sub.update': '检查、下载并安装桌面客户端更新。',
            'nav.set.sub.backup': '备份与恢复仅作用于当前平台的数据库、附件和自定义工具，不会覆盖其他数据空间。',
            'nav.set.sub.snapshotPublish': '配置当前平台的只读快照推送目标，并查看推送进度与历史日志。',
            'nav.set.sub.initialize': '补齐开箱即用内容，或在安全备份和完整归档后恢复到首次使用状态。',
            'nav.set.sub.media': '统一管理点播媒体库、分类文件夹、本地资源批量导入与封面重绘。',
            'nav.set.sub.promotions': '配置首页右上角推广区：推广视频的显示、推广链接的增删改、首页最多显示的链接数与轮换间隔，以及桌面端右侧 Dragon 浏览器推广标签。',
            'nav.media.categoryFilter': '媒体分类筛选',
            'nav.media.searchLabel': '搜索媒体资源',
            'nav.media.previewBack': '返回媒体设置',
            'nav.set.sub.customBackup': '单独备份和恢复自定义工具文件、注册信息、服务端状态及可识别的浏览器本地数据。',
            'nav.set.sub.accounts': '修改后会自动保存，并立即影响账号权限。',
            'nav.set.sub.security': '配置登录失败锁定、会话过期和安全告警策略。',
            'nav.set.sub.report': '报表看板历史数据的独立备份、跨站点恢复与冗余清理。',
            'nav.set.sub.pageFallback': '该页面的配置预留位，后续可把页面内相关设置迁移到这里统一管理。',
            'nav.set.help.primary': '勾选后显示在顶部 bar；未勾选的菜单会进入“更多工具”。使用上下按钮调整顶部显示顺序。',
            'nav.set.help.sidebar': '勾选工具即可加入「更多 → 快捷工具」，用上下按钮调整显示顺序。修改会自动保存，也可通过「发现应用」按分类浏览工具。',
            'nav.set.help.categories': '分类会显示在“更多工具”下拉菜单中。配置英文名称后，系统会在英文模式下自动应用。',
            'nav.set.help.items': '这里管理“更多工具”里的二级分类和分类内顺序。顶部直显菜单不会出现在此列表中。',
            'nav.set.sub.toolCategories': '管理「发现应用」和工具列表中的分类，修改会自动保存。',
            'nav.set.help.toolCategories': '可新增、重命名或调整分类顺序。填写英文名称后，切换到英文界面时会显示该名称。',
            'nav.set.sub.toolOrder': '调整工具所属分类和分类内的显示顺序，修改会自动保存。',
            'nav.set.help.toolOrder': '使用下拉框为工具选择分类，用上下按钮调整分类内顺序。',
            'nav.set.systemTools': '系统工具',
            'nav.set.otherTools': '其他',
            'nav.set.btn.up': '上移',
            'nav.set.btn.down': '下移',
            'nav.set.btn.delete': '删除',
            'nav.set.btn.addCategory': '新增分类',
            'nav.set.restore.title': '恢复系统默认布局',
            'nav.set.restore.desc': '恢复系统工具快捷入口、分类和工具顺序，保留非系统工具和自建分类。',
            'nav.set.restore.button': '恢复系统默认',
            'nav.set.restore.confirmTitle': '恢复系统导航默认布局？',
            'nav.set.restore.confirmMessage': '系统工具快捷入口、分类和工具顺序将恢复默认。',
            'nav.set.restore.confirmHint': '非系统工具和自建分类会保留，工具现有的快捷入口、分类和相对顺序会尽量保留。',
            'nav.set.restore.cancel': '取消',
            'nav.set.restore.action': '确认恢复',
            'nav.set.restore.restoring': '正在恢复系统默认...',
            'nav.set.restore.success': '已恢复系统默认，并保留 {tools} 个非系统工具、{categories} 个自建分类',
            'nav.set.restore.fail': '恢复失败: ',
            'nav.set.default.button': '设为系统默认布局',
            'nav.set.default.confirmTitle': '将当前布局设为系统默认布局？',
            'nav.set.default.confirmMessage': '当前工具快捷入口、分类和工具顺序将写入系统默认配置（defaults/nav-layout.json），并在当前平台生效。',
            'nav.set.default.confirmHint': '推送代码至远端仓库后，该布局将作为所有环境和后续默认初始化的系统标准布局。',
            'nav.set.default.action': '确认设为默认',
            'nav.set.default.saving': '正在设为系统默认布局...',
            'nav.set.default.success': '已成功将当前布局设为系统默认布局并写入默认配置',
            'nav.set.default.fail': '设为系统默认布局失败: ',
            'nav.init.help': '这里的两种操作都只作用于当前平台：开箱即用只补齐缺失默认内容；彻底初始化会清空当前平台业务数据。',
            'nav.init.quickTitle': '启动开箱即用模式',
            'nav.init.quickDesc': '重新导入仓库内置的智能调度脚本和全量指标规则。仅补齐缺失项，不覆盖同名脚本、规则或用户配置；导入前会生成配置快照。',
            'nav.init.quickButton': '启动开箱即用模式',
            'nav.init.quickConfirmTitle': '导入开箱即用默认内容？',
            'nav.init.quickConfirmMessage': '系统将补齐内置智能调度脚本和全量指标规则。',
            'nav.init.quickConfirmHint': '已有同名内容会保留，不会被默认版本覆盖。',
            'nav.init.quickRunning': '正在导入默认内容...',
            'nav.init.quickSuccess': '导入完成：新增脚本 {scripts} 个、指标规则 {rules} 条、指标分组 {groups} 个、分类 {categories} 个。',
            'nav.init.quickUpToDate': '当前空间已包含开箱即用内容，无需新增。已有脚本和配置已保留。',
            'nav.init.quickMissingResult': '服务器未返回导入结果，请刷新后重试。',
            'nav.init.dangerLabel': '危险区域',
            'nav.init.resetTitle': '彻底初始化当前平台',
            'nav.init.resetDesc': '先自动生成当前平台安全备份，再完整归档其数据并建立干净数据库。账号、其他数据空间及桌面/F12 授权不会受影响。',
            'nav.init.resetArchive': '原数据保留在出厂重置归档中，初始化后重新显示首次导入提示。',
            'nav.init.resetButton': '初始化当前平台',
            'nav.init.resetConfirmTitle': '高危操作：彻底初始化当前平台',
            'nav.init.resetConfirmMessage': '当前平台的业务数据、配置、附件和自定义工具将从运行目录移出。系统会先创建安全备份和完整旧数据归档，其他数据空间不受影响。',
            'nav.init.resetConfirmHint': '请在下方完整输入 RESET，然后才能执行初始化。',
            'nav.init.resetPlaceholder': '输入：RESET',
            'nav.init.resetAction': '确认初始化',
            'nav.init.resetRunning': '正在创建安全备份并准备初始化...',
            'nav.init.resetSuccess': '安全备份 {backup} 已创建。程序即将退出；请重新启动，初始化会在退出后自动完成。',
            'nav.init.resetSuccessNoRestart': '安全备份 {backup} 已创建，当前平台已恢复为空白状态；正在返回登录页。',
            'nav.init.failed': '操作失败：',
            'nav.set.emptyItems': '暂无更多工具菜单。',
            'nav.set.placeholder.zh': '中文名称',
            'nav.set.placeholder.en': 'English Name',
            'nav.set.newCategory': '新分类',

            'nav.page.placeholderTitle': '{page}配置预留位',
            'nav.page.placeholderDesc': '当前暂无需要迁移到全局设置的配置项。后续如果该页面新增全局级设置，可以直接放在这里。',
            'nav.page.home.help': '在工具卡片的三点菜单中设置全员开放。已开放的内置工具会自动显示在工具列表，也可在这里为已开放的工具允许免登录访问。',
            'nav.page.home.title': '自定义 HTML 访问鉴权',
            'nav.page.home.public': '允许免登录新窗口访问',
            'nav.page.home.private': '需要登录',
            'nav.page.home.empty': '暂无自定义 HTML 工具。',
            'nav.page.report.help': '可单独备份和恢复历史快照与已入库内容，也可清理报表看板历史下拉列表中的冗余 SLA 源快照。所有操作只影响当前平台。',
            'nav.page.report.backupTitle': '报表历史数据独立备份与恢复',
            'nav.page.report.backupDesc': '导出 SLA 历史快照、已入库报表、分类得分、指标明细及人工佐证附件。报表截图和已生成 Excel 不导出。',
            'nav.page.report.exportButton': '导出独立备份',
            'nav.page.report.importMode': '导入模式',
            'nav.page.report.modeMerge': '增量恢复（默认）',
            'nav.page.report.modeReplace': '清空恢复',
            'nav.page.report.modeMergeHint': '按“快照 ID + 月份”合并：不同日期追加，同一份数据以备份包覆盖，其他现有数据保留。',
            'nav.page.report.modeReplaceHint': '先清空当前平台的 SLA 历史快照和报表入库内容，再完整导入备份包。',
            'nav.page.report.chooseImport': '选择备份并导入',
            'nav.page.report.noFile': '请先选择 .zip 备份包。',
            'nav.page.report.importDone': '导入完成：SLA 快照 {sla}条，入库报表 {reports}份，分类得分 {scores}条，指标明细 {metrics}条，佐证附件 {attachments}个。',
            'nav.page.report.replaceConfirmTitle': '高危操作：清空当前报表历史后恢复',
            'nav.page.report.replaceConfirmWarning': '当前平台的 SLA 历史快照和全部已入库报表将被备份包取代。',
            'nav.page.report.replaceConfirmHint': '请在下方完整输入“确认清空恢复”。账号、规则和其他业务数据不受影响。',
            'nav.page.report.replaceConfirmPlaceholder': '输入：确认清空恢复',
            'nav.page.report.replaceConfirmAction': '清空并恢复',
            'nav.page.report.title': '历史快照冗余清理',
            'nav.page.report.desc': '默认彻底清理，仅保留最新快照，保证看板仍可正常打开。请先预览影响再执行。',
            'nav.page.report.mode': '清理方式',
            'nav.page.report.modeLatest': '彻底清理（仅保留最新 1 份）',
            'nav.page.report.modeRetain': '按保留期清理（每天仅保留最新 1 份）',
            'nav.page.report.retainLast': '保留最近',
            'nav.page.report.days': '天',
            'nav.page.report.btnPreview': '预览影响',
            'nav.page.report.btnRun': '执行清理',
            'nav.page.report.wait': '等待预览。',
            'nav.page.report.res.preview': '预览结果',
            'nav.page.report.res.done': '清理完成',
            'nav.page.report.res.summaryLatest': '范围：全部 SLA 源快照；清理前 {beforeCount} 条，清理后 {afterCount} 条，预计/实际删除 {removedCount} 条。',
            'nav.page.report.res.summaryRetain': '保留期：最近 {days} 天；清理前 {beforeCount} 条，清理后 {afterCount} 条，预计/实际删除 {removedCount} 条。',
            'nav.page.report.res.keptLatest': '保留的最新快照 ID：{latestSnapshotId}。',
            'nav.page.report.res.archiveSafe': '月报/报表入库档案和已生成的导出文件不会被删除。',
            'nav.page.report.res.empty': '没有需要清理的冗余快照。',
            'nav.page.report.res.more': '仅展示前 8 条，剩余 {remaining} 条未展开。',
            'nav.page.report.confirmLatest': '确定删除 {count} 条历史快照，仅保留最新 1 份吗？\n\n这会改变报表看板的“历史快照”列表，但不删除月报/报表入库档案。',
            'nav.page.report.confirmLatestTitle': '高危操作：将永久删除历史快照',
            'nav.page.report.confirmLatestWarning': '本次将删除 {count} 条 SLA 历史快照，并且只保留最新 1 条。报表看板将无法再切换这些快照。',
            'nav.page.report.confirmLatestHint': '请在下方完整输入“确认删除”，然后才能点击确认删除。',
            'nav.page.report.confirmLatestPlaceholder': '输入：确认删除',
            'nav.page.report.confirmLatestAction': '确认删除',
            'nav.page.report.confirmRetain': '确定删除 {count} 条超出 {days} 天保留期或同日重复的快照吗？',

            'nav.ai.clearSelectedHint': '清空当前选中模型的用量与计费统计',
            'nav.ai.clearAllHint': '清空全部历史用量与计费统计',
            'nav.ai.costLegend': '费用 CNY',
            'nav.ai.usageHistory': '历史模型用量明细',
            'nav.ai.usageHistoryHelp': '支持独立清空指定模型历史记录',
            'nav.ai.unconfigured': '已不在配置中',
            'nav.ai.clearingModel': '正在清空模型用量统计…',
            'nav.ai.clearedModel': '已成功清空模型 “{name}” 统计信息',
            'nav.ai.clearFail': '清空失败：',
            'nav.ai.clearStatsFail': '清空统计失败：',
            'nav.ai.clearingAll': '正在清空全部模型统计…',
            'nav.ai.clearedAll': '全部模型统计信息已清空',
            'nav.ai.categoryLabel': 'AI 模型分类',
            'nav.ai.chatIcon': '文',
            'nav.ai.imageIcon': '丹',
            'nav.ai.chatTitle': '文心 · 对话模型',
            'nav.ai.imageTitle': '丹青 · 绘图模型',
            'nav.ai.chatSummary': '对话、分析、写作与月报生成 · {count} 套',
            'nav.ai.imageSummary': '生成与修改图片 · {count} 套',
            'nav.ai.imageEmpty': '还没有绘图模型',
            'nav.ai.imageEmptyHelp': '添加一个能输出图片的模型（如 Gemini 的图片模型），AI 月报的图片对话就能生成真正的图片；没有时会用对话模型画 SVG 矢量图。',
            'nav.ai.imageNew': '＋ 新建绘图模型',
            'nav.ai.imageHelp': 'AI 月报的图片对话（LOGO 和以后格子里的图片）用这里“使用中”的绘图模型生成图片；它不会参与对话，也不会被自动切换。',
            'nav.ai.imageProfiles': '绘图模型方案',
            'nav.ai.chatProfiles': 'AI 配置方案',
            'nav.ai.imageProfilesHelp': '可保存多套绘图模型；只有“使用中”的一套会用于生成图片。',
            'nav.ai.chatProfilesHelp': '可保存多套供应商与模型参数；只有已激活方案会用于实际业务。',
            'nav.ai.profileNew': '＋ 新建',
            'nav.ai.profileClone': '⧉ 复制当前',
            'nav.ai.profileActive': '使用中',
            'nav.ai.tokenReady': '● Token 可用',
            'nav.ai.tokenNotReady': '○ Token 未就绪',
            'nav.ai.profileName': '方案名称',
            'nav.ai.profileDefault': 'AI 配置',
            'nav.ai.testConnection': '⌁ 测试连接',
            'nav.ai.imageActive': '✓ 正在用于绘图',
            'nav.ai.chatActive': '✓ 当前已激活',
            'nav.ai.imageActivate': '⚡ 用于绘图',
            'nav.ai.chatActivate': '⚡ 激活此方案',
            'nav.ai.profileDelete': '删除',
            'nav.ai.imageStatus': '图片生成正在使用此方案',
            'nav.ai.chatStatus': '当前业务正在使用此方案',
            'nav.ai.inactiveStatus': '正在编辑未激活方案',
            'nav.ai.testResult': '连接测试结果',
            'nav.ai.temperature': '温度（Temperature）',
            'nav.ai.usageChartCost': '费用',
            'nav.ai.switchSaveFail': '切换前保存失败：',
            'nav.ai.creating': '正在创建…',
            'nav.ai.created': '已创建，尚未激活',
            'nav.ai.createFail': '创建失败：',
            'nav.ai.newImageName': '新绘图模型',
            'nav.ai.newChatName': '新 AI 配置',
            'nav.ai.copySuffix': '副本',
            'nav.ai.cloned': '已复制，尚未激活',
            'nav.ai.cloneFail': '复制失败：',
            'nav.ai.activating': '正在切换模型…',
            'nav.ai.activated': '已激活，业务调用已切换',
            'nav.ai.activateFail': '激活失败：',
            'nav.ai.deleted': '配置已删除',
            'nav.ai.deleteFail': '删除失败：',
            'nav.ai.noProfile': '未选择 AI 配置',
            'nav.ai.empty': '正在加载 Dragon Claw 智能体配置...',
            'nav.ai.help': '这里管理 Dragon Claw 智能体与后台 AI 分析使用的模型方案。支持 Gemini、OpenAI、Anthropic、MiniMax 和 OpenAI 兼容网关；Token 保存于服务端，前端只显示脱敏状态。',
            'nav.ai.sourcePrefix': '当前 Token 来源：',
            'nav.ai.srcStored': '设置中心保存的 Token',
            'nav.ai.srcEnv': '供应商环境变量',
            'nav.ai.srcNone': '未配置',
            'nav.ai.keyNone': '尚未配置 Token',
            'nav.ai.keyInvalid': '格式疑似无效 ',
            'nav.ai.keyValid': '已配置 ',
            'nav.ai.lblToken': 'API Token',
            'nav.ai.plhToken': '点击后粘贴当前供应商 API Token',
            'nav.ai.plhKeep': '留空则保持当前：',
            'nav.ai.btnClear': '清除 Token',
            'nav.ai.btnTest': '测试模型',
            'nav.ai.testing': '正在测试模型...',
            'nav.ai.testOk': '测试通过',
            'nav.ai.testFail': '测试失败：',
            'nav.ai.testHintLabel': '排查建议：',
            'nav.ai.testDetailsExpand': '查看失败详情',
            'nav.ai.testDetailsCollapse': '收起失败详情',
            'nav.ai.testCopyDetails': '复制排障详情',
            'nav.ai.testCopied': '已复制',
            'nav.ai.testCopyFail': '复制失败',
            'nav.ai.testRawLabel': '返回细节 / 原始响应',
            'nav.ai.testMetaProvider': '供应商 / 协议',
            'nav.ai.testMetaModel': '测试模型',
            'nav.ai.testMetaEndpoint': '请求地址',
            'nav.ai.testMetaStatus': 'HTTP 状态',
            'nav.ai.testMetaCode': '错误码',
            'nav.ai.testMetaLatency': '耗时',
            'nav.ai.testMetaParams': '测试参数',
            'nav.ai.testMetaHeaders': '响应头',
            'nav.ai.testMetaCause': '底层原因',
            'nav.ai.testMetaTime': '时间',
            'nav.ai.lblProvider': '供应商协议',
            'nav.ai.authModeLabel': '认证方式',
            'nav.ai.customAuthHeaderLabel': '自定义认证头名称',
            'nav.ai.customAuthHeaderPlaceholder': 'X-API-Key',
            'nav.ai.verifySslLabel': '校验 HTTPS 证书',
            'nav.ai.verifySslHelp': '默认开启；仅在接入受信任的企业内网自签证书网关时关闭',
            'nav.ai.authNoneReady': '免认证就绪 (none)',
            'nav.ai.authNoneBadge': '● 免认证',
            'nav.ai.plhTokenNone': '当前认证方式为 none（无需填写 Token）',
            'nav.ai.lblApiUrl': 'API URL',
            'nav.ai.plhApiUrl': '留空使用供应商默认地址；兼容网关填 /v1 基地址',
            'nav.ai.lblModel': '模型名称',
            'nav.ai.channelModelsTitle': '渠道模型列表',
            'nav.ai.channelModelsHelp': '同一渠道（共享 Base URL 与 Token）可配置多个模型，标 ★ 为默认主模型',
            'nav.ai.plhAddModel': '输入模型名称（如 gpt-5.6-luna、grok-4.7），回车或点击添加',
            'nav.ai.btnAddModel': '＋ 添加模型',
            'nav.ai.modelPrimary': '★ 主模型',
            'nav.ai.modelSetPrimary': '设为主模型',
            'nav.ai.modelTest': '测试',
            'nav.ai.modelCount': '{count}个模型',
            'nav.ai.lblMax': '最大输出 Tokens',
            'nav.ai.lblContext': '上下文窗口 Tokens（0 = 按模型自动）',
            'nav.ai.lblInputCost': '输入成本 USD / 1M Tokens',
            'nav.ai.lblOutputCost': '输出成本 USD / 1M Tokens',
            'nav.ai.lblUsdCny': '美元兑人民币',
            'nav.ai.lblPrompt': '补充系统提示词',
            'nav.ai.plhPrompt': '例如：回答优先使用中文，涉及平台操作时给出步骤。',
            'nav.ai.advancedTitle': '高级参数与自定义协议',
            'nav.ai.advancedHelp': '附加参数覆盖协议默认字段，可用 null 省略不支持的字段。请求头和高级 JSON 同样加密保存，读取配置时不回显。',
            'nav.ai.extraHeadersLabel': '附加请求头 JSON',
            'nav.ai.extraHeadersPlaceholder': '可选 JSON 对象，例如 {"X-Project":"demo"}',
            'nav.ai.extraBodyLabel': '附加请求参数 JSON',
            'nav.ai.extraBodyPlaceholder': '可选 JSON 对象，例如 {"temperature":null,"max_tokens":null,"max_completion_tokens":8000}',
            'nav.ai.jsonSavedPlaceholder': '已加密保存，留空保留；JSON 填 {} 清空',
            'nav.ai.jsonInvalid': '必须是有效的 JSON 对象',
            'nav.ai.failLoad': '加载 AI 助手配置失败：',
            'nav.ai.saving': '正在保存 AI 设置...',
            'nav.ai.saved': 'AI 设置已自动保存',
            'nav.ai.waitSave': 'AI 设置待保存...',
            'nav.ai.usageTitle': 'Token 与成本趋势',
            'nav.ai.usageHelp': '统计 AI 助手、后台分析与模型测试的成功请求；费用按请求发生时的单价估算。',
            'nav.ai.usageTokens': '累计 Tokens',
            'nav.ai.usageCostCny': '累计费用',
            'nav.ai.usageCostUsd': '美元估算',
            'nav.ai.usageRequests': '成功请求',
            'nav.ai.usageDay': '日',
            'nav.ai.usageWeek': '周',
            'nav.ai.usageMonth': '月',
            'nav.ai.usageYear': '年',
            'nav.ai.usageLoading': '正在读取用量...',
            'nav.ai.usageFail': '用量读取失败：',
            'nav.ai.usagePeriod': '当前区间',
            'nav.ai.usageExpand': '展开趋势',
            'nav.ai.usageCollapse': '收起趋势',
            'nav.ai.autoSwitch': '主模型异常时自动切换',
            'nav.ai.autoSwitchHelp': '仅切换到已配置有效 Token 的其他方案；限流、超时、鉴权或服务异常时生效。',
            'nav.ai.usageAllModels': '全部模型',
            'nav.ai.usageByModel': '按模型查看趋势',
            'nav.ai.usageLegacy': '历史未分类',
            'nav.ai.anthropicAuthField': 'Anthropic 认证字段',
            'nav.ai.anthropicAuthToken': 'ANTHROPIC_AUTH_TOKEN (默认 Bearer)',
            'nav.ai.anthropicApiKey': 'ANTHROPIC_API_KEY (x-api-key)',
            'nav.ai.clearModelUsage': '清空此模型统计',
            'nav.ai.clearModelUsageConfirm': '确定清空该模型的历史 Token 用量与计费统计吗？',
            'nav.ai.clearAllModelUsage': '清空全部模型统计',
            'nav.ai.clearedSuccess': '统计信息已清空',
            'nav.ai.modelIdentityHelp': '对话选择器直接显示真实模型名称；配置方案名称只用于区分连接。',

            'nav.up.help': '更新来源为 GitHub Releases。下载完成后可立即重启安装，也可以稍后手动重启。',
            'nav.up.current': '当前版本',
            'nav.up.latest': '最新版本',
            'nav.up.packaged': '运行模式',
            'nav.up.packagedYes': '安装版',
            'nav.up.packagedNo': '开发模式',
            'nav.up.status': '更新状态',
            'nav.up.progress': '下载进度',
            'nav.up.btnCheck': '检查更新',
            'nav.up.btnDownload': '下载更新',
            'nav.up.btnInstall': '重启安装',
            'nav.up.unavailable': '网页端不直接执行程序更新。请在 Windows 托盘图标中选择“检查更新 / 下载更新 / 重启并安装更新”。',
            'nav.up.state.idle': '等待检查',
            'nav.up.state.checking': '检查中',
            'nav.up.state.available': '有可用更新',
            'nav.up.state.not-available': '已是最新',
            'nav.up.state.downloading': '下载中',
            'nav.up.state.downloaded': '已下载',
            'nav.up.state.installing': '安装中',
            'nav.up.state.error': '更新失败',
            'nav.up.state.dev-unavailable': '开发模式不可用',

            'nav.bk.empty': '正在加载备份列表...',
            'nav.bk.help': '平台完整备份范围：{target}。',
            'nav.ctbk.help': '独立备份不会覆盖其他业务模块。导出包包含工具全部文件、注册信息、服务端状态与快照、可识别的 localStorage 数据，以及逐文件 SHA-256 完整性清单。',
            'nav.ctbk.loading': '正在扫描自定义工具依赖...',
            'nav.ctbk.empty': '当前没有可备份的自定义工具。',
            'nav.ctbk.exportTitle': '选择要导出的工具',
            'nav.ctbk.exportDesc': '默认全选。工具调用的公共平台 API、外部服务、sessionStorage 和 IndexedDB 会记录为依赖，但不会复制共享数据或登录凭据。',
            'nav.ctbk.files': '{count} 个文件',
            'nav.ctbk.serverState': '服务端状态',
            'nav.ctbk.localState': '本地状态 {count}',
            'nav.ctbk.apiDeps': '平台 API {count}',
            'nav.ctbk.externalDeps': '外部接口 {count}',
            'nav.ctbk.indexedDb': 'IndexedDB {count}',
            'nav.ctbk.btnAll': '全选',
            'nav.ctbk.btnNone': '取消全选',
            'nav.ctbk.btnExport': '导出所选工具备份',
            'nav.ctbk.restoreTitle': '恢复自定义工具备份',
            'nav.ctbk.restoreDesc': '上传后先校验包类型、清单、CRC 和所有文件 SHA-256；校验全部通过后才写入。发生错误会自动回滚文件、注册表和服务端状态。',
            'nav.ctbk.strategyReplace': '同名工具：完整替换',
            'nav.ctbk.strategySkip': '同名工具：跳过保留现有',
            'nav.ctbk.btnRestore': '校验并恢复',
            'nav.ctbk.portabilityTitle': '完整度与运行依赖',
            'nav.ctbk.portability': '已包含：HTML/JS/CSS/附件、工具注册信息、访问权限、custom_tool_state 服务端状态与快照、可静态识别且不含凭据的 localStorage。未包含：公共平台 API 背后的共享数据库、外部系统数据、动态生成的本地键、sessionStorage、IndexedDB 和登录凭据。恢复后会列出这些运行依赖。',
            'nav.ctbk.selected': '已选择 {selected}/{total} 个工具',
            'nav.ctbk.exporting': '正在生成自定义工具备份...',
            'nav.ctbk.restoring': '正在校验并恢复自定义工具...',
            'nav.ctbk.noSelection': '请至少选择一个自定义工具。',
            'nav.ctbk.noFile': '请先选择自定义工具备份 ZIP。',
            'nav.ctbk.restoreConfirm': '确定恢复此自定义工具备份吗？\n\n文件：{file}\n策略：{strategy}\n\n恢复前会完整校验；如写入失败会自动回滚。',
            'nav.ctbk.restoreDone': '恢复完成：{restored} 个；跳过：{skipped} 个。',
            'nav.ctbk.dependencyWarn': '其中 {count} 个工具仍依赖公共平台 API、外部接口或 IndexedDB，请确保目标环境具备相同服务。',
            'nav.ctbk.fail': '加载自定义工具备份功能失败：',
            'nav.bk.remoteTitle': '远端主站同步',
            'nav.bk.remoteDesc': '从远端主站同步备份，恢复前校验数据范围；连接设置只保存在本机。',
            'nav.bk.enable': '启用',
            'nav.bk.remoteDomain': '远端网站域名',
            'nav.bk.remoteUser': '账号',
            'nav.bk.remotePwd': '密码',
            'nav.bk.plhPwd': '填写远端登录密码',
            'nav.bk.optCompare': '比较备份新旧，未更新则跳过',
            'nav.bk.optPull': '拉取前请求主站立即生成备份',
            'nav.bk.optAuto': '启动时自动恢复最新备份',
            'nav.bk.optAutoDefaultOnly': '启动时可自动恢复最近一次备份。',
            'nav.bk.scheduleTitle': '定时备份',
            'nav.bk.scheduleDesc': '当前平台独立调度；默认每天凌晨 2 点生成本平台备份，并仅清理本平台超过保留天数的自动备份。',
            'nav.bk.scheduleEnabled': '开启定时备份',
            'nav.bk.scheduleTime': '执行时间',
            'nav.bk.scheduleRetention': '保留天数',
            'nav.bk.scheduleDays': '天',
            'nav.bk.scheduleCapacity': '备份总容量上限',
            'nav.bk.scheduleGB': 'GB',
            'nav.bk.scheduleUsage': '当前容量：{used} / {limit}',
            'nav.bk.scheduleOver': '最新单个备份已超过容量上限，系统仍保留至少一个恢复点。',
            'nav.bk.scheduleNext': '下次执行：',
            'nav.bk.scheduleLast': '最近成功：',
            'nav.bk.scheduleLastFile': '最近文件：',
            'nav.bk.scheduleError': '最近错误：',
            'nav.bk.scheduleNotRun': '尚未执行',
            'nav.bk.scheduleDisabled': '已关闭',
            'nav.bk.scheduleSaved': '定时备份设置已保存',
            'nav.bk.scheduleSaving': '正在保存定时备份设置...',
            'nav.bk.scheduleRun': '立即执行一次',
            'nav.bk.stLocal': '时间显示：浏览器本地时区（{tz}）',
            'nav.bk.stCheck': '最近检查：',
            'nav.bk.stSync': '最近恢复：',
            'nav.bk.stError': '最近错误：',
            'nav.bk.btnCheck': '测试连接/检查最新',
            'nav.bk.btnPull': '按规则拉取恢复',
            'nav.bk.btnForce': '强制恢复远端最新',
            'nav.bk.btnClearPwd': '清除密码',
            'nav.bk.svrTitle': '服务器备份',
            'nav.bk.svrDesc': '备份平台数据并保存到服务器备份目录，也可以下载留档。',
            'nav.bk.btnCreate': '生成服务器备份',
            'nav.bk.btnCreateDL': '生成并下载',
            'nav.bk.upTitle': '上传备份包恢复',
            'nav.bk.upDesc': '优先恢复同数据空间 ID 的备份；ID 不一致时会安全拦截并显示来源与目标，管理员确认后可强制恢复。',
            'nav.bk.btnUp': '上传并恢复',
            'nav.bk.badgeSync': '外部同步触发',
            'nav.bk.badgeSafe': '恢复前安全备份',
            'nav.bk.badgeAuto': '定时备份',
            'nav.bk.fail': '加载备份列表失败：',
            'nav.bk.dlTitle': '下载备份',
            'nav.bk.rsTitle': '从该备份恢复',
            'nav.bk.delTitle': '永久删除此备份',
            'nav.bk.thFile': '备份文件',
            'nav.bk.thAction': '操作',
            'nav.bk.noData': '暂无服务器备份',

            'nav.acc.empty': '正在加载账号列表...',
            'nav.acc.admin': '超级管理',
            'nav.acc.readonly': '只读用户',
            'nav.acc.help': '账号权限用于控制平台写入类操作。新增或调整后立即生效。',
            'nav.acc.plhUser': '输入新用户名',
            'nav.acc.plhPwd': '设置密码',
            'nav.acc.btnAdd': '新增账号',
            'nav.acc.thUser': '账号名称',
            'nav.acc.thRole': '权限角色',
            'nav.acc.thAction': '快捷操作',
            'nav.acc.noData': '暂无账号',
            'nav.acc.fail': '加载账号失败：',
            'nav.acc.btnDel': '删除',
            'nav.acc.btnReset': '重置密码',
            'nav.acc.required': '请完整填写用户名和密码。',
            'nav.acc.added': '账号已添加',
            'nav.acc.addedDesc': '新账号“{user}”已创建并立即生效。',
            'nav.acc.deleteTitle': '删除账号',
            'nav.acc.deleteDesc': '确定删除账号“{user}”吗？删除后该账号将无法继续登录。',
            'nav.acc.resetTitle': '重置账号密码',
            'nav.acc.resetDesc': '为账号“{user}”设置一个新密码。保存后旧密码立即失效。',
            'nav.acc.newPassword': '新密码',
            'nav.acc.resetDone': '密码已重置',
            'nav.acc.resetDoneDesc': '账号“{user}”的新密码已立即生效。',

            'nav.dialog.notice': '操作提示',
            'nav.dialog.info': '操作提示',
            'nav.dialog.success': '操作成功',
            'nav.dialog.warning': '请确认操作',
            'nav.dialog.error': '操作未完成',
            'nav.dialog.confirm': '确定',
            'nav.dialog.cancel': '取消',
            'nav.dialog.close': '知道了',
            'nav.dialog.save': '保存',

            'nav.sec.empty': '正在加载安全策略...',
            'nav.sec.help': '登录失败后会按账号、来源 IP、同一 IP 多账号尝试三类规则递进锁定；触发锁定时会按配置级别上报告警台。',
            'nav.sec.enabled': '启用登录失败递进锁定',
            'nav.sec.alertOnLock': '锁定时上报告警台',
            'nav.sec.sessionHours': '会话有效期（小时）',
            'nav.sec.accountPolicy': '账号锁定策略',
            'nav.sec.ipPolicy': 'IP 锁定策略',
            'nav.sec.multiPolicy': '同 IP 多账号策略',
            'nav.sec.thEnabled': '启用',
            'nav.sec.thCount': '失败次数/账号数',
            'nav.sec.thWindow': '统计窗口(分钟)',
            'nav.sec.thLock': '锁定(分钟)',
            'nav.sec.thSeverity': '告警级别',
            'nav.sec.locksTitle': '当前锁定',
            'nav.sec.btnRefresh': '刷新锁定',
            'nav.sec.btnUnlock': '解锁',
            'nav.sec.noLocks': '暂无账号或 IP 被锁定',
            'nav.sec.thType': '类型',
            'nav.sec.thTarget': '对象',
            'nav.sec.thReason': '原因',
            'nav.sec.thFailCount': '计数',
            'nav.sec.thUntil': '锁定到',
            'nav.sec.failLoad': '加载安全策略失败：',
            'nav.sec.saving': '正在保存安全策略...',
            'nav.sec.saved': '安全策略已自动保存',

            'nav.alert.title': '告警台',
            'nav.alert.subtitle': '集中查看系统告警、配置变化和用户关键行为。',
            'nav.alert.loading': '正在加载告警...',
            'nav.alert.empty': '暂无告警事件',
            'nav.alert.all': '全部',
            'nav.alert.unread': '未读',
            'nav.alert.warn': '风险以上',
            'nav.alert.config': '配置变化',
            'nav.alert.security': '安全',
            'nav.alert.userAction': '用户行为',
            'nav.alert.system': '系统',
            'nav.alert.summaryTotal': '事件',
            'nav.alert.summaryUnread': '未读',
            'nav.alert.summaryRisk': '风险',
            'nav.alert.markAll': '全部已读',
            'nav.alert.refresh': '刷新',
            'nav.alert.archive': '归档',
            'nav.alert.archiveAll': '全部归档',
            'nav.alert.archiveAllConfirm': '确定要将所有告警归档吗？',
            'nav.alert.archiveConfirmTitle': '归档全部告警？',
            'nav.alert.archiveConfirmHint': '归档后，当前告警会从告警台列表中移除，但不会影响已经产生的系统记录。',
            'nav.alert.archiveConfirmCancel': '暂不归档',
            'nav.alert.archiveConfirmAction': '确认归档',
            'nav.alert.read': '已读',
            'nav.alert.actor': '操作人',
            'nav.alert.source': '来源',
            'nav.alert.object': '对象',
            'nav.alert.failLoad': '告警加载失败：'
        },
        'en-US': {
            'nav.home': 'Home',
            'nav.uivf12': 'Data Capture',
            'nav.sla': 'Data Import',
            'nav.report': 'Reports',
            'nav.expedite': 'Expedite',
            'nav.monthly': 'Monthly',
            'nav.aiBi': 'AI BI',
            'nav.dutyRoster': 'Duty Roster',
            'nav.bigscreen': 'Big Screen',
            'nav.topicAnalysis': 'Topic Analysis',
            'nav.frt': 'FRT KPI',
            'nav.praudit': 'PR Audit',
            'nav.storage': 'Migration',
            'nav.dbExplorer': 'Data Explorer',
            'nav.netcareExplorer': 'NetCare Explorer',
            'nav.f12packer': 'F12 Packer',
            'nav.pythonUpdater': 'Python Updater',
            'nav.more': 'More Tools',
            'nav.sidebarShortcuts': 'Tool Shortcuts',
            'nav.moreSearch': 'Search tools, pinyin, or initials...',
            'nav.moreSearchLabel': 'Search more tools',
            'nav.moreAll': 'All',
            'nav.moreRecent': 'Recently used',
            'nav.moreRecentBadge': 'Quick Access',
            'nav.moreFavorites': 'Favorites',
            'nav.moreFavoritesBadge': 'Mine',
            'nav.moreNoResults': 'No matching tools',
            'nav.requirements': 'Requests',
            'nav.alertCenter': 'Alerts',
            'nav.alertCenterTitle': 'Open Alert Center',
            'nav.settings': 'Global navigation settings',
            'nav.userPrefix': '👤 {user}',
            'nav.logout': 'Logout',
            'nav.relogin.title': 'Please sign in again',
            'nav.relogin.message': 'The sign-in data stored in this browser is missing (common after the desktop app address or port changes), so Settings and the Dragon Claw agent are unavailable.',
            'nav.relogin.hint': 'Sign in once to restore them. Your account and data are not affected.',
            'nav.relogin.confirm': 'Sign in again',
            'nav.relogin.later': 'Later',
            'nav.online': 'Online',
            'nav.offline': 'Offline',
            'nav.language': 'Language',
            'nav.languageTitle': 'Switch language',
            'nav.category.business': 'Business Tools',
            'nav.category.audit': 'Audit & KPI',
            'nav.category.system': 'System Governance',
            'nav.category.custom': 'Custom Tools',
            'nav.uncategorized': 'Uncategorized',
            'nav.empty': 'No more tools',
            'nav.customTool': 'Custom Tool',
            'nav.set.title': 'Global Settings',
            'nav.set.tab.primary': 'Top Menu',
            'nav.set.tab.sidebar': 'More Menu',
            'nav.set.tab.logo': 'Platform Identity',
            'nav.set.tab.categories': 'Categories',
            'nav.set.tab.items': 'Items & Order',
            'nav.set.tab.ai': 'AI Assistant',
            'nav.set.tab.channels': 'Channels',
            'nav.set.sub.channels': 'Connect the platform to channels such as WeLink: connection, scan-to-authorize, connectivity tests, allow/block lists and push recipients.',
            'nav.set.tab.update': 'App Updates',
            'nav.set.tab.backup': 'Backup & Restore',
            'nav.set.tab.snapshotPublish': 'Static Page Publishing',
            'nav.set.tab.initialize': 'Initialization',
            'nav.set.tab.media': 'Media Library',
            'nav.set.tab.promotions': 'Promotions',
            'nav.set.tab.customBackup': 'Custom Tool Backup',
            'nav.set.tab.accounts': 'Accounts',
            'nav.set.tab.security': 'Security',
            'nav.set.tab.pages': 'Page Settings',
            'nav.set.saved': 'Saved automatically',
            'nav.set.saving': 'Saving automatically...',
            'nav.set.saveFail': 'Save failed: ',
            'nav.set.loaded': 'Loaded',
            'nav.set.pageConfig': '{page} Config',
            'nav.page.f12.title': 'F12 Plugins',
            'nav.set.sub.primary': 'Changes are saved automatically and immediately applied to the tool shortcuts.',
            'nav.set.sub.sidebar': 'Manage tool shortcuts in More on the home sidebar.',
            'nav.set.sub.logo': 'Manage the platform name, logo and desktop app icons.',
            'nav.set.sub.categories': 'Changes are saved automatically and immediately applied to the category display in "More Tools".',
            'nav.set.sub.items': 'Changes are saved automatically and immediately applied to the grouping and ordering in "More Tools".',
            'nav.set.sub.ai': 'Changes are saved automatically and immediately applied to the Dragon Claw Agent configuration.',
            'nav.set.sub.update': 'Check, download, and install desktop client updates.',
            'nav.set.sub.backup': 'Backup and restore only affect the current platform\'s databases, attachments, and custom tools, without overwriting other data spaces.',
            'nav.set.sub.snapshotPublish': 'Configure this platform’s read-only snapshot destination and review publishing progress and history.',
            'nav.set.sub.initialize': 'Add the Quick Start defaults or return to a clean first-run state after a safety backup and full archive.',
            'nav.set.sub.media': 'Manage the on-demand media library, category folders, local batch imports, and poster regeneration.',
            'nav.set.sub.promotions': 'Configure the home page promo area: which videos show, promoted links, the maximum number of links and rotation interval, and the desktop Dragon Browser promotion tabs.',
            'nav.media.categoryFilter': 'Filter media categories',
            'nav.media.searchLabel': 'Search media resources',
            'nav.media.previewBack': 'Back to media settings',
            'nav.set.sub.customBackup': 'Back up and restore custom tool files, registry data, server state, and detectable browser-local data independently.',
            'nav.set.sub.accounts': 'Changes are saved automatically and immediately applied to account permissions.',
            'nav.set.sub.security': 'Configure login lockouts, session expiry, and security alert severity.',
            'nav.set.sub.report': 'Independent backup, cross-site restore, and redundant-history cleanup for Report Dashboard data.',
            'nav.set.sub.pageFallback': "Placeholder for this page's configuration. Future page settings can be managed here.",
            'nav.set.help.primary': 'Checked items appear in the top bar; unchecked items move to "More Tools". Use up/down buttons to reorder.',
            'nav.set.help.sidebar': 'Select tools to add them to More → Tool Shortcuts. Use Up and Down to reorder them. Changes save automatically. Use Discover Apps to browse by category.',
            'nav.set.help.categories': 'Categories are displayed in the "More Tools" dropdown. English names will apply automatically in English mode.',
            'nav.set.help.items': 'Manage sub-categories and their ordering in "More Tools". Direct top menu items do not appear here.',
            'nav.set.sub.toolCategories': 'Manage categories in Discover Apps and the tool list. Changes save automatically.',
            'nav.set.help.toolCategories': 'Add, rename, or reorder categories. Enter an English name to display it in the English interface.',
            'nav.set.sub.toolOrder': 'Assign tools to categories and reorder them within each category. Changes save automatically.',
            'nav.set.help.toolOrder': 'Use the dropdown to assign a category and Up and Down to reorder tools within it.',
            'nav.set.systemTools': 'System tools',
            'nav.set.otherTools': 'Other',
            'nav.set.btn.up': 'Up',
            'nav.set.btn.down': 'Down',
            'nav.set.btn.delete': 'Delete',
            'nav.set.btn.addCategory': 'Add Category',
            'nav.set.restore.title': 'Restore system defaults',
            'nav.set.restore.desc': 'Restore system tool shortcuts, categories, and tool order. Non-system tools and custom categories are kept.',
            'nav.set.restore.button': 'Restore defaults',
            'nav.set.restore.confirmTitle': 'Restore the default navigation layout?',
            'nav.set.restore.confirmMessage': 'System tool shortcuts, categories, and tool order will be restored to defaults.',
            'nav.set.restore.confirmHint': 'Non-system tools and custom categories are kept. Existing shortcuts, categories, and relative order for these tools are preserved where possible.',
            'nav.set.restore.cancel': 'Cancel',
            'nav.set.restore.action': 'Restore',
            'nav.set.restore.restoring': 'Restoring system defaults...',
            'nav.set.restore.success': 'Defaults restored; preserved {tools} non-system tool(s) and {categories} custom category/categories',
            'nav.set.restore.fail': 'Restore failed: ',
            'nav.set.default.button': 'Set as system default',
            'nav.set.default.confirmTitle': 'Set current layout as system default?',
            'nav.set.default.confirmMessage': 'The current tool shortcuts, categories, and tool order will be saved to defaults/nav-layout.json and applied to this platform.',
            'nav.set.default.confirmHint': 'Once pushed to the remote repository, this layout will serve as the system standard default across environments.',
            'nav.set.default.action': 'Set as default',
            'nav.set.default.saving': 'Setting as system default...',
            'nav.set.default.success': 'Current layout successfully set as system default and saved to defaults config',
            'nav.set.default.fail': 'Failed to set system default: ',
            'nav.init.help': 'Both actions affect only the current platform: Quick Start adds missing defaults, while Factory Reset clears this platform’s business data.',
            'nav.init.quickTitle': 'Enable Quick Start Mode',
            'nav.init.quickDesc': 'Re-import the bundled smart-scheduling scripts and complete metric rules. Missing items are added without overwriting same-name scripts, rules, or user settings; a configuration snapshot is created first.',
            'nav.init.quickButton': 'Enable Quick Start Mode',
            'nav.init.quickConfirmTitle': 'Import the Quick Start defaults?',
            'nav.init.quickConfirmMessage': 'The bundled smart-scheduling scripts and complete metric rules will be added.',
            'nav.init.quickConfirmHint': 'Existing same-name content is preserved and will not be overwritten.',
            'nav.init.quickRunning': 'Importing default content...',
            'nav.init.quickSuccess': 'Import complete: added {scripts} scripts, {rules} metric rules, {groups} metric groups, and {categories} categories.',
            'nav.init.quickUpToDate': 'This workspace already has the Quick Start defaults. Existing scripts and settings were kept.',
            'nav.init.quickMissingResult': 'The server did not return the import result. Refresh and try again.',
            'nav.init.dangerLabel': 'Danger Zone',
            'nav.init.resetTitle': 'Factory Reset Platform',
            'nav.init.resetDesc': 'Creates a platform-scoped safety backup, archives this platform, and builds a clean database. Accounts, other data spaces, and desktop/F12 licenses are unaffected.',
            'nav.init.resetArchive': 'Previous data remains in factory-reset archives. The first-run import prompt appears again after initialization.',
            'nav.init.resetButton': 'Reset Platform',
            'nav.init.resetConfirmTitle': 'DANGER: Factory reset current platform',
            'nav.init.resetConfirmMessage': 'This platform’s business data, settings, attachments, and custom tools will be moved out of the live directory after a safety backup. Other data spaces are unaffected.',
            'nav.init.resetConfirmHint': 'Type RESET exactly below to enable factory reset.',
            'nav.init.resetPlaceholder': 'Type: RESET',
            'nav.init.resetAction': 'Reset Tenant',
            'nav.init.resetRunning': 'Creating a safety backup and preparing reset...',
            'nav.init.resetSuccess': 'Safety backup {backup} was created. The app will exit; launch it again after the reset completes.',
            'nav.init.resetSuccessNoRestart': 'Safety backup {backup} was created and the current platform is clean. Returning to sign in.',
            'nav.init.failed': 'Operation failed: ',
            'nav.set.emptyItems': 'No more tools available.',
            'nav.set.placeholder.zh': 'Chinese Name',
            'nav.set.placeholder.en': 'English Name',
            'nav.set.newCategory': 'New Category',

            'nav.page.placeholderTitle': '{page} Configuration Placeholder',
            'nav.page.placeholderDesc': 'There are currently no configuration items to migrate to global settings. Future global settings for this page will be placed here.',
            'nav.page.home.help': 'Use the three-dot menu on a tool card to share it. Shared built-in tools appear in the tool list. You can separately allow signed-out access here.',
            'nav.page.home.title': 'Custom HTML Access Control',
            'nav.page.home.public': 'Allow public new-window access',
            'nav.page.home.private': 'Sign-in required',
            'nav.page.home.empty': 'No custom HTML tools yet.',
            'nav.page.report.help': 'Back up and restore historical snapshots and saved report content independently, or clean redundant SLA source snapshots from the Report Dashboard history selector. Every operation is limited to the current platform.',
            'nav.page.report.backupTitle': 'Independent Report History Backup & Restore',
            'nav.page.report.backupDesc': 'Export SLA history, saved reports, category scores, metric details, and manual evidence attachments. Report screenshots and generated Excel files are excluded.',
            'nav.page.report.exportButton': 'Export Independent Backup',
            'nav.page.report.importMode': 'Import mode',
            'nav.page.report.modeMerge': 'Incremental restore (default)',
            'nav.page.report.modeReplace': 'Clear and restore',
            'nav.page.report.modeMergeHint': 'Merge by snapshot ID + month: add different dates, replace matching records from the package, and retain all other existing data.',
            'nav.page.report.modeReplaceHint': 'Clear the current platform\'s SLA history and saved report records, then import the package in full.',
            'nav.page.report.chooseImport': 'Choose Backup and Import',
            'nav.page.report.noFile': 'Choose a .zip backup package first.',
            'nav.page.report.importDone': 'Import complete: {sla} SLA snapshots, {reports} saved reports, {scores} category scores, {metrics} metric rows, and {attachments} evidence attachments.',
            'nav.page.report.replaceConfirmTitle': 'DANGER: Clear current report history and restore',
            'nav.page.report.replaceConfirmWarning': 'The current platform\'s SLA history and all saved report records will be replaced by this package.',
            'nav.page.report.replaceConfirmHint': 'Type “确认清空恢复” exactly below. Accounts, rules, and other business data are not affected.',
            'nav.page.report.replaceConfirmPlaceholder': 'Type: 确认清空恢复',
            'nav.page.report.replaceConfirmAction': 'Clear and restore',
            'nav.page.report.title': 'Redundant Historical Snapshot Cleanup',
            'nav.page.report.desc': 'Complete cleanup is selected by default and retains the latest snapshot so the dashboard remains usable. Preview the impact before execution.',
            'nav.page.report.mode': 'Cleanup Mode',
            'nav.page.report.modeLatest': 'Complete cleanup (keep latest 1 only)',
            'nav.page.report.modeRetain': 'Retention cleanup (keep latest 1 per day)',
            'nav.page.report.retainLast': 'Keep the last',
            'nav.page.report.days': 'days',
            'nav.page.report.btnPreview': 'Preview Impact',
            'nav.page.report.btnRun': 'Execute Cleanup',
            'nav.page.report.wait': 'Waiting for preview.',
            'nav.page.report.res.preview': 'Preview Result',
            'nav.page.report.res.done': 'Cleanup Complete',
            'nav.page.report.res.summaryLatest': 'Scope: all SLA source snapshots; Before: {beforeCount}, After: {afterCount}, Removed (est./actual): {removedCount}.',
            'nav.page.report.res.summaryRetain': 'Retention: last {days} days; Before: {beforeCount}, After: {afterCount}, Removed (est./actual): {removedCount}.',
            'nav.page.report.res.keptLatest': 'Latest retained snapshot ID: {latestSnapshotId}.',
            'nav.page.report.res.archiveSafe': 'Saved monthly/report archives and generated export files are not deleted.',
            'nav.page.report.res.empty': 'No redundant snapshots to clean up.',
            'nav.page.report.res.more': 'Only showing the first 8 items, {remaining} items hidden.',
            'nav.page.report.confirmLatest': 'Delete {count} historical snapshots and keep only the latest one?\n\nThis changes the Report Dashboard history list but does not delete saved monthly/report archives.',
            'nav.page.report.confirmLatestTitle': 'DANGER: Historical snapshots will be permanently deleted',
            'nav.page.report.confirmLatestWarning': 'This will delete {count} SLA historical snapshots and keep only the latest one. They will no longer be selectable in the Report Dashboard.',
            'nav.page.report.confirmLatestHint': 'Type “确认删除” exactly below to enable the destructive action.',
            'nav.page.report.confirmLatestPlaceholder': 'Type: 确认删除',
            'nav.page.report.confirmLatestAction': 'Delete snapshots',
            'nav.page.report.confirmRetain': 'Delete {count} snapshots outside the {days}-day retention period or duplicated on the same day?',

            'nav.ai.clearSelectedHint': 'Clear usage and cost statistics for the selected model',
            'nav.ai.clearAllHint': 'Clear all historical usage and cost statistics',
            'nav.ai.costLegend': 'Cost CNY',
            'nav.ai.usageHistory': 'Historical model usage',
            'nav.ai.usageHistoryHelp': 'Clear each model’s history separately',
            'nav.ai.unconfigured': 'No longer configured',
            'nav.ai.clearingModel': 'Clearing model usage statistics…',
            'nav.ai.clearedModel': 'Statistics cleared for model “{name}”',
            'nav.ai.clearFail': 'Failed to clear: ',
            'nav.ai.clearStatsFail': 'Failed to clear statistics: ',
            'nav.ai.clearingAll': 'Clearing statistics for all models…',
            'nav.ai.clearedAll': 'Statistics cleared for all models',
            'nav.ai.categoryLabel': 'AI model categories',
            'nav.ai.chatIcon': 'C',
            'nav.ai.imageIcon': 'I',
            'nav.ai.chatTitle': 'Wenxin · Chat Models',
            'nav.ai.imageTitle': 'Danqing · Image Models',
            'nav.ai.chatSummary': 'Chat, analysis, writing and monthly reports · {count} profiles',
            'nav.ai.imageSummary': 'Generate and edit images · {count} profiles',
            'nav.ai.imageEmpty': 'No image models yet',
            'nav.ai.imageEmptyHelp': 'Add a model that can output images, such as a Gemini image model, to generate images in AI Report image chat. Without one, the chat model creates SVG graphics.',
            'nav.ai.imageNew': '＋ New image model',
            'nav.ai.imageHelp': 'AI Report image chat (logos and images in report cells) uses the active image model here. This model is not used for chat or automatic fallback.',
            'nav.ai.imageProfiles': 'Image Model Profiles',
            'nav.ai.chatProfiles': 'AI Configuration Profiles',
            'nav.ai.imageProfilesHelp': 'Save multiple image model profiles; only the active profile generates images.',
            'nav.ai.chatProfilesHelp': 'Save multiple provider and model configurations; only the active profile is used for requests.',
            'nav.ai.profileNew': '＋ New',
            'nav.ai.profileClone': '⧉ Duplicate current',
            'nav.ai.profileActive': 'In use',
            'nav.ai.tokenReady': '● Token ready',
            'nav.ai.tokenNotReady': '○ Token not ready',
            'nav.ai.profileName': 'Profile name',
            'nav.ai.profileDefault': 'AI Profile',
            'nav.ai.testConnection': '⌁ Test connection',
            'nav.ai.imageActive': '✓ In use for images',
            'nav.ai.chatActive': '✓ Currently active',
            'nav.ai.imageActivate': '⚡ Use for images',
            'nav.ai.chatActivate': '⚡ Activate profile',
            'nav.ai.profileDelete': 'Delete',
            'nav.ai.imageStatus': 'Image generation is using this profile',
            'nav.ai.chatStatus': 'Requests are using this profile',
            'nav.ai.inactiveStatus': 'Editing an inactive profile',
            'nav.ai.testResult': 'Connection test result',
            'nav.ai.temperature': 'Temperature',
            'nav.ai.usageChartCost': 'Cost',
            'nav.ai.switchSaveFail': 'Failed to save before switching: ',
            'nav.ai.creating': 'Creating…',
            'nav.ai.created': 'Created, not yet active',
            'nav.ai.createFail': 'Failed to create: ',
            'nav.ai.newImageName': 'New image model',
            'nav.ai.newChatName': 'New AI profile',
            'nav.ai.copySuffix': 'Copy',
            'nav.ai.cloned': 'Duplicated, not yet active',
            'nav.ai.cloneFail': 'Failed to duplicate: ',
            'nav.ai.activating': 'Switching model…',
            'nav.ai.activated': 'Activated; requests now use this profile',
            'nav.ai.activateFail': 'Failed to activate: ',
            'nav.ai.deleted': 'Profile deleted',
            'nav.ai.deleteFail': 'Failed to delete: ',
            'nav.ai.noProfile': 'No AI profile selected',
            'nav.ai.empty': 'Loading Dragon Claw Agent configuration...',
            'nav.ai.help': 'Manage model profiles for the Dragon Claw Agent and background analysis. Supports Gemini, OpenAI, Anthropic, MiniMax, and OpenAI-compatible gateways. Tokens are stored on the server and masked in the UI.',
            'nav.ai.sourcePrefix': 'Current Token Source: ',
            'nav.ai.srcStored': 'Stored in Settings',
            'nav.ai.srcEnv': 'Provider Environment Variable',
            'nav.ai.srcNone': 'Not Configured',
            'nav.ai.keyNone': 'No Token Configured',
            'nav.ai.keyInvalid': 'Format seems invalid ',
            'nav.ai.keyValid': 'Configured ',
            'nav.ai.lblToken': 'API Token',
            'nav.ai.plhToken': 'Click to paste the current provider API token',
            'nav.ai.plhKeep': 'Leave empty to keep current: ',
            'nav.ai.btnClear': 'Clear Token',
            'nav.ai.btnTest': 'Test Model',
            'nav.ai.testing': 'Testing model...',
            'nav.ai.testOk': 'Test passed',
            'nav.ai.testFail': 'Test failed: ',
            'nav.ai.testHintLabel': 'Troubleshooting: ',
            'nav.ai.testDetailsExpand': 'Show failure details',
            'nav.ai.testDetailsCollapse': 'Hide failure details',
            'nav.ai.testCopyDetails': 'Copy details',
            'nav.ai.testCopied': 'Copied',
            'nav.ai.testCopyFail': 'Copy failed',
            'nav.ai.testRawLabel': 'Response / Error Details',
            'nav.ai.testMetaProvider': 'Provider',
            'nav.ai.testMetaModel': 'Tested Model',
            'nav.ai.testMetaEndpoint': 'Endpoint',
            'nav.ai.testMetaStatus': 'HTTP Status',
            'nav.ai.testMetaCode': 'Error Code',
            'nav.ai.testMetaLatency': 'Duration',
            'nav.ai.testMetaParams': 'Test Params',
            'nav.ai.testMetaHeaders': 'Response Headers',
            'nav.ai.testMetaCause': 'Root Cause',
            'nav.ai.testMetaTime': 'Timestamp',
            'nav.ai.lblProvider': 'Provider Protocol',
            'nav.ai.authModeLabel': 'Auth Mode',
            'nav.ai.customAuthHeaderLabel': 'Custom Auth Header',
            'nav.ai.customAuthHeaderPlaceholder': 'X-API-Key',
            'nav.ai.verifySslLabel': 'Verify HTTPS certificate',
            'nav.ai.verifySslHelp': 'Enabled by default; disable only for trusted internal gateways with self-signed certificates',
            'nav.ai.authNoneReady': 'No auth required (none)',
            'nav.ai.authNoneBadge': '● No Auth',
            'nav.ai.plhTokenNone': 'Auth mode is none (API token not required)',
            'nav.ai.lblApiUrl': 'API URL',
            'nav.ai.plhApiUrl': 'Leave empty for provider default; compatible gateways should use the /v1 base URL',
            'nav.ai.lblModel': 'Model Name',
            'nav.ai.channelModelsTitle': 'Channel Models',
            'nav.ai.channelModelsHelp': 'Multiple models can share this channel (Base URL & Token). Star ★ indicates primary model',
            'nav.ai.plhAddModel': 'Enter model name (e.g. gpt-5.6-luna, grok-4.7), press Enter or Add',
            'nav.ai.btnAddModel': '＋ Add Model',
            'nav.ai.modelPrimary': '★ Primary',
            'nav.ai.modelSetPrimary': 'Set Primary',
            'nav.ai.modelTest': 'Test',
            'nav.ai.modelCount': '{count} models',
            'nav.ai.lblMax': 'Max Output Tokens',
            'nav.ai.lblContext': 'Context Window Tokens (0 = auto by model)',
            'nav.ai.lblInputCost': 'Input Cost (USD / 1M)',
            'nav.ai.lblOutputCost': 'Output Cost (USD / 1M)',
            'nav.ai.lblUsdCny': 'USD to CNY Exchange Rate',
            'nav.ai.lblPrompt': 'Supplemental System Prompt',
            'nav.ai.plhPrompt': 'e.g. Please respond in English and provide step-by-step instructions.',
            'nav.ai.advancedTitle': 'Advanced / custom protocol',
            'nav.ai.advancedHelp': 'Extra parameters override defaults; null omits unsupported fields. Headers and advanced JSON are encrypted and never returned by read APIs.',
            'nav.ai.extraHeadersLabel': 'Extra headers JSON',
            'nav.ai.extraHeadersPlaceholder': 'Optional JSON object, e.g. {"X-Project":"demo"}',
            'nav.ai.extraBodyLabel': 'Extra request parameters JSON',
            'nav.ai.extraBodyPlaceholder': 'Optional JSON object, e.g. {"temperature":null,"max_tokens":null,"max_completion_tokens":8000}',
            'nav.ai.jsonSavedPlaceholder': 'Saved and encrypted; leave blank to retain. Use {} to clear JSON.',
            'nav.ai.jsonInvalid': 'must be a valid JSON object',
            'nav.ai.failLoad': 'Failed to load AI configuration: ',
            'nav.ai.saving': 'Saving AI settings...',
            'nav.ai.saved': 'AI settings saved automatically',
            'nav.ai.waitSave': 'AI settings waiting to save...',
            'nav.ai.usageTitle': 'Token & Cost Trend',
            'nav.ai.usageHelp': 'Tracks successful Assistant, background analysis, and model-test requests. Cost uses prices configured at request time.',
            'nav.ai.usageTokens': 'Lifetime Tokens',
            'nav.ai.usageCostCny': 'Lifetime Cost',
            'nav.ai.usageCostUsd': 'USD Estimate',
            'nav.ai.usageRequests': 'Successful Requests',
            'nav.ai.usageDay': 'Day',
            'nav.ai.usageWeek': 'Week',
            'nav.ai.usageMonth': 'Month',
            'nav.ai.usageYear': 'Year',
            'nav.ai.usageLoading': 'Loading usage...',
            'nav.ai.usageFail': 'Failed to load usage: ',
            'nav.ai.usagePeriod': 'Selected range',
            'nav.ai.usageExpand': 'Expand Trend',
            'nav.ai.usageCollapse': 'Collapse Trend',
            'nav.ai.autoSwitch': 'Auto-switch when the primary model fails',
            'nav.ai.autoSwitchHelp': 'Uses another profile with a valid token for rate limits, timeouts, authentication, or service failures.',
            'nav.ai.usageAllModels': 'All models',
            'nav.ai.usageByModel': 'View trends by model',
            'nav.ai.usageLegacy': 'Legacy unclassified',
            'nav.ai.anthropicAuthField': 'Anthropic Auth Field',
            'nav.ai.anthropicAuthToken': 'ANTHROPIC_AUTH_TOKEN (Default Bearer)',
            'nav.ai.anthropicApiKey': 'ANTHROPIC_API_KEY (x-api-key)',
            'nav.ai.clearModelUsage': 'Clear model stats',
            'nav.ai.clearModelUsageConfirm': 'Clear historical token usage and cost stats for this model?',
            'nav.ai.clearAllModelUsage': 'Clear all models stats',
            'nav.ai.clearedSuccess': 'Statistics cleared',
            'nav.ai.modelIdentityHelp': 'Chat shows real model names. Profile names only distinguish connections.',

            'nav.up.help': 'Updates are delivered from GitHub Releases. After download, restart now to install or restart later manually.',
            'nav.up.current': 'Current Version',
            'nav.up.latest': 'Latest Version',
            'nav.up.packaged': 'Runtime',
            'nav.up.packagedYes': 'Installed App',
            'nav.up.packagedNo': 'Development Mode',
            'nav.up.status': 'Status',
            'nav.up.progress': 'Download Progress',
            'nav.up.btnCheck': 'Check for Updates',
            'nav.up.btnDownload': 'Download Update',
            'nav.up.btnInstall': 'Restart & Install',
            'nav.up.unavailable': 'Program updates are managed from the Windows tray icon. Use “Check update / Download update / Restart and install” there.',
            'nav.up.state.idle': 'Waiting',
            'nav.up.state.checking': 'Checking',
            'nav.up.state.available': 'Update Available',
            'nav.up.state.not-available': 'Up to Date',
            'nav.up.state.downloading': 'Downloading',
            'nav.up.state.downloaded': 'Downloaded',
            'nav.up.state.installing': 'Installing',
            'nav.up.state.error': 'Update Failed',
            'nav.up.state.dev-unavailable': 'Unavailable in Development',

            'nav.bk.empty': 'Loading backup list...',
            'nav.bk.help': 'Full platform backup: {target}.',
            'nav.ctbk.help': 'Independent backups do not overwrite other business modules. Packages include all tool files, registry metadata, server state and snapshots, detectable localStorage data, and per-file SHA-256 integrity records.',
            'nav.ctbk.loading': 'Scanning custom tool dependencies...',
            'nav.ctbk.empty': 'There are no custom tools to back up.',
            'nav.ctbk.exportTitle': 'Select tools to export',
            'nav.ctbk.exportDesc': 'All tools are selected by default. Shared platform APIs, external services, sessionStorage, and IndexedDB are recorded as dependencies but shared data and credentials are not copied.',
            'nav.ctbk.files': '{count} files',
            'nav.ctbk.serverState': 'Server state',
            'nav.ctbk.localState': 'Local state {count}',
            'nav.ctbk.apiDeps': 'Platform APIs {count}',
            'nav.ctbk.externalDeps': 'External {count}',
            'nav.ctbk.indexedDb': 'IndexedDB {count}',
            'nav.ctbk.btnAll': 'Select all',
            'nav.ctbk.btnNone': 'Clear selection',
            'nav.ctbk.btnExport': 'Export selected tools',
            'nav.ctbk.restoreTitle': 'Restore custom tool backup',
            'nav.ctbk.restoreDesc': 'The package type, manifest, CRC, and every SHA-256 file hash are validated before writing. Files, registry data, and server state are rolled back automatically on failure.',
            'nav.ctbk.strategyReplace': 'Same slug: replace completely',
            'nav.ctbk.strategySkip': 'Same slug: keep existing',
            'nav.ctbk.btnRestore': 'Validate and restore',
            'nav.ctbk.portabilityTitle': 'Completeness and runtime dependencies',
            'nav.ctbk.portability': 'Included: HTML/JS/CSS/assets, registry metadata, access settings, custom_tool_state server data and snapshots, and statically detectable credential-free localStorage. Not included: shared databases behind platform APIs, external system data, dynamic local keys, sessionStorage, IndexedDB, or login credentials. Runtime dependencies are reported after restore.',
            'nav.ctbk.selected': '{selected}/{total} tools selected',
            'nav.ctbk.exporting': 'Generating custom tool backup...',
            'nav.ctbk.restoring': 'Validating and restoring custom tools...',
            'nav.ctbk.noSelection': 'Select at least one custom tool.',
            'nav.ctbk.noFile': 'Choose a custom tool backup ZIP first.',
            'nav.ctbk.restoreConfirm': 'Restore this custom tool backup?\n\nFile: {file}\nStrategy: {strategy}\n\nThe package is fully validated first and any failed write is rolled back.',
            'nav.ctbk.restoreDone': 'Restore complete: {restored}; skipped: {skipped}.',
            'nav.ctbk.dependencyWarn': '{count} restored tools still depend on platform APIs, external endpoints, or IndexedDB. Ensure the target environment provides the same services.',
            'nav.ctbk.fail': 'Failed to load custom tool backup: ',
            'nav.bk.remoteTitle': 'Remote Main Site Sync',
            'nav.bk.remoteDesc': 'Synchronize backups from the remote site, validating the data scope before restore. Connection settings stay on this machine.',
            'nav.bk.enable': 'Enable',
            'nav.bk.remoteDomain': 'Remote Domain',
            'nav.bk.remoteUser': 'Username',
            'nav.bk.remotePwd': 'Password',
            'nav.bk.plhPwd': 'Enter remote login password',
            'nav.bk.optCompare': 'Compare before restore, skip if not updated',
            'nav.bk.optPull': 'Request immediate backup generation on main site before pulling',
            'nav.bk.optAuto': 'Auto-restore latest backup on startup',
            'nav.bk.optAutoDefaultOnly': 'The latest backup can be restored automatically on startup.',
            'nav.bk.scheduleTitle': 'Scheduled Backup',
            'nav.bk.scheduleDesc': 'Scheduled independently for the current platform; by default runs daily at 02:00 and prunes only this platform’s expired scheduled backups.',
            'nav.bk.scheduleEnabled': 'Enable scheduled backup',
            'nav.bk.scheduleTime': 'Run Time',
            'nav.bk.scheduleRetention': 'Retention',
            'nav.bk.scheduleDays': 'days',
            'nav.bk.scheduleCapacity': 'Total backup capacity',
            'nav.bk.scheduleGB': 'GB',
            'nav.bk.scheduleUsage': 'Current usage: {used} / {limit}',
            'nav.bk.scheduleOver': 'The newest backup alone exceeds the limit, so one recovery point is still retained.',
            'nav.bk.scheduleNext': 'Next Run: ',
            'nav.bk.scheduleLast': 'Last Success: ',
            'nav.bk.scheduleLastFile': 'Last File: ',
            'nav.bk.scheduleError': 'Last Error: ',
            'nav.bk.scheduleNotRun': 'Not run yet',
            'nav.bk.scheduleDisabled': 'Disabled',
            'nav.bk.scheduleSaved': 'Scheduled backup settings saved',
            'nav.bk.scheduleSaving': 'Saving scheduled backup settings...',
            'nav.bk.scheduleRun': 'Run Once Now',
            'nav.bk.stLocal': 'Time displayed in local timezone ({tz})',
            'nav.bk.stCheck': 'Last Check: ',
            'nav.bk.stSync': 'Last Sync: ',
            'nav.bk.stError': 'Last Error: ',
            'nav.bk.btnCheck': 'Test Connection / Check Latest',
            'nav.bk.btnPull': 'Pull & Restore by Rules',
            'nav.bk.btnForce': 'Force Restore Remote Latest',
            'nav.bk.btnClearPwd': 'Clear Password',
            'nav.bk.svrTitle': 'Server Backup',
            'nav.bk.svrDesc': 'Back up platform data to the server backup directory, with optional download.',
            'nav.bk.btnCreate': 'Create Server Backup',
            'nav.bk.btnCreateDL': 'Create & Download',
            'nav.bk.upTitle': 'Restore from Upload',
            'nav.bk.upDesc': 'Backups with the same data scope ID restore directly. A mismatch is safely blocked and shows source and target details before an admin can force restore.',
            'nav.bk.btnUp': 'Upload & Restore',
            'nav.bk.badgeSync': 'Remote Sync',
            'nav.bk.badgeSafe': 'Safety Backup',
            'nav.bk.badgeAuto': 'Scheduled',
            'nav.bk.fail': 'Failed to load backups: ',
            'nav.bk.dlTitle': 'Download Backup',
            'nav.bk.rsTitle': 'Restore from this backup',
            'nav.bk.delTitle': 'Permanently delete this backup',
            'nav.bk.thFile': 'Backup File',
            'nav.bk.thAction': 'Action',
            'nav.bk.noData': 'No Server Backups',

            'nav.acc.empty': 'Loading accounts...',
            'nav.acc.admin': 'Admin',
            'nav.acc.readonly': 'Readonly',
            'nav.acc.help': 'Account permissions control write operations on the platform. Takes effect immediately.',
            'nav.acc.plhUser': 'New Username',
            'nav.acc.plhPwd': 'Set Password',
            'nav.acc.btnAdd': 'Add Account',
            'nav.acc.thUser': 'Username',
            'nav.acc.thRole': 'Role',
            'nav.acc.thAction': 'Actions',
            'nav.acc.noData': 'No Accounts',
            'nav.acc.fail': 'Failed to load accounts: ',
            'nav.acc.btnDel': 'Delete',
            'nav.acc.btnReset': 'Reset Password',
            'nav.acc.required': 'Enter both a username and password.',
            'nav.acc.added': 'Account added',
            'nav.acc.addedDesc': 'The new account “{user}” is ready to use.',
            'nav.acc.deleteTitle': 'Delete account',
            'nav.acc.deleteDesc': 'Delete account “{user}”? This account will no longer be able to sign in.',
            'nav.acc.resetTitle': 'Reset account password',
            'nav.acc.resetDesc': 'Set a new password for “{user}”. The old password will stop working immediately.',
            'nav.acc.newPassword': 'New password',
            'nav.acc.resetDone': 'Password reset',
            'nav.acc.resetDoneDesc': 'The new password for “{user}” is now active.',

            'nav.dialog.notice': 'Notice',
            'nav.dialog.info': 'Notice',
            'nav.dialog.success': 'Completed',
            'nav.dialog.warning': 'Confirm action',
            'nav.dialog.error': 'Action failed',
            'nav.dialog.confirm': 'Confirm',
            'nav.dialog.cancel': 'Cancel',
            'nav.dialog.close': 'Close',
            'nav.dialog.save': 'Save',

            'nav.sec.empty': 'Loading security policy...',
            'nav.sec.help': 'Failed logins are progressively locked by account, source IP, and multi-account attempts from the same IP. Lock events are reported to the alert center with the configured severity.',
            'nav.sec.enabled': 'Enable progressive failed-login lockout',
            'nav.sec.alertOnLock': 'Report lock events to alert center',
            'nav.sec.sessionHours': 'Session lifetime (hours)',
            'nav.sec.accountPolicy': 'Account Lock Policies',
            'nav.sec.ipPolicy': 'IP Lock Policies',
            'nav.sec.multiPolicy': 'Same-IP Multi-Account Policies',
            'nav.sec.thEnabled': 'Enabled',
            'nav.sec.thCount': 'Fail/User Count',
            'nav.sec.thWindow': 'Window (min)',
            'nav.sec.thLock': 'Lock (min)',
            'nav.sec.thSeverity': 'Severity',
            'nav.sec.locksTitle': 'Active Locks',
            'nav.sec.btnRefresh': 'Refresh Locks',
            'nav.sec.btnUnlock': 'Unlock',
            'nav.sec.noLocks': 'No account or IP locks',
            'nav.sec.thType': 'Type',
            'nav.sec.thTarget': 'Target',
            'nav.sec.thReason': 'Reason',
            'nav.sec.thFailCount': 'Count',
            'nav.sec.thUntil': 'Locked Until',
            'nav.sec.failLoad': 'Failed to load security policy: ',
            'nav.sec.saving': 'Saving security policy...',
            'nav.sec.saved': 'Security policy saved',

            'nav.alert.title': 'Alert Center',
            'nav.alert.subtitle': 'Review system alerts, configuration changes, and key user actions in one place.',
            'nav.alert.loading': 'Loading alerts...',
            'nav.alert.empty': 'No alert events',
            'nav.alert.all': 'All',
            'nav.alert.unread': 'Unread',
            'nav.alert.warn': 'Risk+',
            'nav.alert.config': 'Config',
            'nav.alert.security': 'Security',
            'nav.alert.userAction': 'User Actions',
            'nav.alert.system': 'System',
            'nav.alert.summaryTotal': 'Events',
            'nav.alert.summaryUnread': 'Unread',
            'nav.alert.summaryRisk': 'Risk',
            'nav.alert.markAll': 'Mark all read',
            'nav.alert.refresh': 'Refresh',
            'nav.alert.archive': 'Archive',
            'nav.alert.archiveAll': 'Archive all',
            'nav.alert.archiveAllConfirm': 'Archive all alerts?',
            'nav.alert.archiveConfirmTitle': 'Archive all alerts?',
            'nav.alert.archiveConfirmHint': 'Archived alerts are removed from this list without affecting existing system records.',
            'nav.alert.archiveConfirmCancel': 'Keep alerts',
            'nav.alert.archiveConfirmAction': 'Archive all',
            'nav.alert.read': 'Read',
            'nav.alert.actor': 'Actor',
            'nav.alert.source': 'Source',
            'nav.alert.object': 'Object',
            'nav.alert.failLoad': 'Failed to load alerts: '
        }
    };
    window.ToolsI18n?.register('platform', platformI18nEntries);
}

function navEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAuthHeaderForNav() {
    const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function hasNavAuthToken() {
    return Boolean(localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token'));
}

// AI BI 是后加的入口：布局里还没有它时（AI BI 上线前保存的设置），放在“月报页面”后面。
// 布局里出现过它（快捷入口或排序里）就说明管理员已经安排过，不再自动插入。
function withAiBiAfterMonthly(ids, settings = {}, always = false) {
    const known = [...(settings.primaryIds || []), ...(settings.itemOrder || [])].map(String);
    if (ids.includes('ai-bi') || (!always && known.includes('ai-bi'))) return ids;
    const at = ids.indexOf('monthly');
    return at < 0 ? ids : [...ids.slice(0, at + 1), 'ai-bi', ...ids.slice(at + 1)];
}

function normalizeNavSettings(settings = {}) {
    const cats = Array.isArray(settings.categories) && settings.categories.length ? settings.categories.map(cat => {
        const defCat = NAV_DEFAULT_SETTINGS.categories.find(c => c.id === cat.id);
        if (defCat && !cat.nameEn) cat.nameEn = defCat.nameEn;
        return cat;
    }) : NAV_DEFAULT_SETTINGS.categories.slice();

    const clean = (val, max = 120) => typeof val === 'string'
        ? val.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
        : '';

    const rawName = clean(settings.platformName, 80);
    const rawHasNonAscii = /[^\x00-\x7F]/.test(rawName);
    let platformNameZh = clean(settings.platformNameZh, 80);
    let platformNameEn = clean(settings.platformNameEn, 80);

    if (platformNameZh && platformNameEn && platformNameZh.toLowerCase() === platformNameEn.toLowerCase() && !/[^\x00-\x7F]/.test(platformNameZh) && (platformNameEn.toLowerCase() === 'thoth platform' || platformNameEn.toLowerCase() === 'tools platform' || platformNameEn.toLowerCase() === 'eg cs hub')) {
        platformNameZh = 'Dragon Claw';
    }

    platformNameZh = platformNameZh || (rawHasNonAscii ? rawName : 'Dragon Claw');
    platformNameEn = platformNameEn || (!rawHasNonAscii && rawName ? rawName : 'Dragon Claw');
    const platformSubtitle = clean(settings.platformSubtitle, 120) || '埃及 CS 工具与知识中心';
    const platformSubtitleEn = clean(settings.platformSubtitleEn, 120) || 'Egypt CS Tools & Knowledge Center';
    const platformSlogan = clean(settings.platformSlogan, 200) || '“认真做好每一个工具，让日常工作更省心。”';
    const platformSloganEn = clean(settings.platformSloganEn, 200) || '“Build every tool with care. Make everyday work easier.”';
    const platformName = rawName || platformNameZh;

    return {
        platformGuideVideoUrl: typeof settings.platformGuideVideoUrl === 'string' ? settings.platformGuideVideoUrl : '',
        platformName,
        platformNameZh,
        platformNameEn,
        platformSubtitle,
        platformSubtitleEn,
        platformSlogan,
        platformSloganEn,
        primaryIds: withAiBiAfterMonthly(Array.isArray(settings.primaryIds) ? settings.primaryIds.map(String) : NAV_DEFAULT_SETTINGS.primaryIds.slice(), settings),
        categories: cats,
        categoryByItem: settings.categoryByItem && typeof settings.categoryByItem === 'object' ? { ...settings.categoryByItem } : { ...NAV_DEFAULT_SETTINGS.categoryByItem },
        f12QuickDownloads: Array.isArray(settings.f12QuickDownloads)
            ? settings.f12QuickDownloads
                .filter(item => item && typeof item.scriptId === 'string' && /^(builtin|server):[a-zA-Z0-9_-]+$/.test(item.scriptId))
                .map(item => ({ scriptId: item.scriptId, target: item.target === 'local' ? 'local' : 'store' }))
            : [],
        itemOrder: withAiBiAfterMonthly(Array.isArray(settings.itemOrder) ? settings.itemOrder.map(String) : NAV_DEFAULT_SETTINGS.itemOrder.slice(), settings, true)
    };
}

let platformTitleOriginal = null;
let platformTitleApplied = null;
let platformTitleObserver = null;

function applyPlatformTitle() {
    if (typeof window !== 'undefined' && window.ToolsPlatformTitle?.apply(navState.settings)) {
        platformTitleApplied = document.title;
        return;
    }
    if (document.title !== platformTitleApplied) platformTitleOriginal = document.title;
    const isEn = typeof window !== 'undefined' && window.ToolsI18n?.getLanguage?.() === 'en-US';
    const mainName = (isEn && navState.settings?.platformNameEn)
        ? navState.settings.platformNameEn
        : (navState.settings?.platformNameZh || navState.settings?.platformName || 'Dragon Claw');
    let next = platformTitleOriginal || '';
    for (const alias of ['Dragon Claw', 'Dragon Platform', 'Tools Platform', 'Dragon 工具平台', 'EG CS HUB', '图特工具平台', 'Thoth Platform']) {
        if (next.includes(alias)) { next = next.split(alias).join(mainName); break; }
    }
    platformTitleApplied = next;
    if (document.title !== next) document.title = next;
}

function applyPlatformIdentity() {
    const isEn = typeof window !== 'undefined' && window.ToolsI18n?.getLanguage?.() === 'en-US';
    const rawName = navState.settings?.platformName || '';
    const rawHasNonAscii = /[^\x00-\x7F]/.test(rawName);

    let zhName = navState.settings?.platformNameZh;
    let enName = navState.settings?.platformNameEn;

    if (zhName && enName && zhName.toLowerCase() === enName.toLowerCase() && !/[^\x00-\x7F]/.test(zhName) && (enName.toLowerCase() === 'thoth platform' || enName.toLowerCase() === 'dragon platform' || enName.toLowerCase() === 'tools platform' || enName.toLowerCase() === 'eg cs hub')) {
        zhName = 'Dragon Claw';
    }

    zhName = zhName || (rawHasNonAscii ? rawName : (navState.settings?.platformName || 'Dragon Claw'));
    enName = enName || (!rawHasNonAscii && rawName ? rawName : 'Dragon Claw');

    const zhSub = navState.settings?.platformSubtitle || '埃及 CS 工具与知识中心';
    const enSub = navState.settings?.platformSubtitleEn || 'Egypt CS Tools & Knowledge Center';
    const zhSlogan = navState.settings?.platformSlogan || '“认真做好每一个工具，让日常工作更省心。”';
    const enSlogan = navState.settings?.platformSloganEn || '“Build every tool with care. Make everyday work easier.”';

    const mainName = (isEn && navState.settings?.platformNameEn) ? enName : (navState.settings?.platformNameZh || navState.settings?.platformName || zhName);
    const secondaryName = (isEn && navState.settings?.platformNameEn) ? zhName : enName;
    const subtitleText = isEn ? (enSub || zhSub) : (zhSub || enSub);
    const sloganText = isEn ? (enSlogan || zhSlogan) : (zhSlogan || enSlogan);

    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('tools_platform_name', mainName);
            localStorage.setItem('tools_platform_identity', JSON.stringify({
                platformName: navState.settings?.platformName || mainName,
                platformNameZh: zhName,
                platformNameEn: enName,
                platformSubtitle: zhSub,
                platformSubtitleEn: enSub,
                platformSlogan: zhSlogan,
                platformSloganEn: enSlogan
            }));
        }
    } catch (_) {}

    document.querySelectorAll('[data-platform-name], [data-platform-main-title]').forEach(el => {
        el.textContent = mainName;
        el.title = mainName;
    });

    const hasDistinctSecondary = Boolean(
        secondaryName &&
        mainName &&
        secondaryName.trim().toLowerCase() !== mainName.trim().toLowerCase()
    );

    document.querySelectorAll('[data-platform-sub-title]').forEach(el => {
        if (typeof el.getAttribute === 'function' && el.getAttribute('data-platform-sub-title') !== null) {
            if (hasDistinctSecondary) {
                el.textContent = secondaryName;
                el.style.display = '';
            } else {
                el.textContent = '';
                el.style.display = 'none';
            }
        }
    });
    document.querySelectorAll('[data-platform-page-subtitle]').forEach(el => {
        if (typeof el.getAttribute === 'function' && el.getAttribute('data-platform-page-subtitle') !== null) {
            el.textContent = subtitleText;
        }
    });
    document.querySelectorAll('[data-platform-slogan]').forEach(el => {
        if (typeof el.getAttribute === 'function' && el.getAttribute('data-platform-slogan') !== null) {
            el.textContent = sloganText;
        }
    });
    ['navBrandLogo', 'homeHeroLogo'].forEach(id => {
        const image = document.getElementById(id);
        if (image) image.alt = mainName;
    });
    applyPlatformTitle();
    // Business pages can change their titles after loading or switching language.
    const title = document.querySelector('title');
    if (title && !platformTitleObserver) {
        platformTitleObserver = new MutationObserver(applyPlatformTitle);
        platformTitleObserver.observe(title, { childList: true, characterData: true, subtree: true });
    }
}

function getAllNavItems() {
    const customItems = (navState.customTools || []).map(tool => ({
        id: `custom:${tool.slug}`,
        href: tool.href,
        icon: tool.icon || '🧩',
        label: tool.name || navT('nav.customTool'),
        labelEn: tool.nameEn || '',
        defaultCategory: 'custom',
        match: p => p === tool.href || p.startsWith(`${tool.href}/`),
        builtIn: typeof tool.builtIn === 'boolean' ? tool.builtIn : undefined,
        hostedApp: tool.hostedApp === true,
        createdAt: tool.createdAt,
        updatedAt: tool.updatedAt
    }));
    const isAdmin = localStorage.getItem('tools_role') === 'admin';
    const superAdmin = isNavSuperAdmin();
    // 迁移状态、数据探索、NetCare 浏览及未向全员开放的内置页面仅超级管理员可见（后端同样拦截）
    return [
        ...NAV_BUILTIN_LINKS.filter(item => {
            if (item.adminOnly && !isAdmin) return false;
            if (superAdmin) return true;
            return item.id === 'home' || isPlatformPageShared(item.id);
        }),
        ...customItems
    ];
}

// 需求管理页以导航中的实际页面/工具作为分类来源，避免维护另一份容易过期的页面清单。
// value 保持中文原始名称，展示文本才随当前语言切换，保证已保存的需求分类稳定。
function getRequirementPageCategories() {
    const fixedCategories = [
        { value: '全局通用', label: navLocaleText('🌐 全局通用', '🌐 General') },
        { value: '新增页面', label: navLocaleText('✨ 新增页面', '✨ New Page') },
        { value: '需求管理', label: navLocaleText('🎯 需求管理', '🎯 Requirements') }
    ];
    const knownValues = new Set(fixedCategories.map(category => category.value));
    const pageCategories = getAllNavItems().reduce((categories, item) => {
        const value = String(item.label || '').trim();
        if (!value || knownValues.has(value)) return categories;
        knownValues.add(value);
        categories.push({
            value,
            label: `${item.icon || '📄'} ${getNavLabel(item)}`.trim()
        });
        return categories;
    }, []);
    return [...fixedCategories, ...pageCategories];
}

function notifyRequirementPageCategoriesChanged() {
    window.dispatchEvent(new CustomEvent('tools:requirement-page-categories-change', {
        detail: { categories: getRequirementPageCategories() }
    }));
}

window.getRequirementPageCategories = getRequirementPageCategories;

function sortNavItems(items, orderIds) {
    const order = new Map((orderIds || []).map((id, index) => [id, index]));
    return items.slice().sort((a, b) => {
        const ai = order.has(a.id) ? order.get(a.id) : 9999;
        const bi = order.has(b.id) ? order.get(b.id) : 9999;
        if (ai !== bi) return ai - bi;
        const locale = window.ToolsI18n?.getLanguage?.() || 'zh-CN';
        return getNavLabel(a).localeCompare(getNavLabel(b), locale);
    });
}

const NAV_RECENT_STORAGE_KEY = 'tools_recent_nav_tools';
let recentNavIds = null;
let recentNavWriteQueue = Promise.resolve();

function getRecentNavToolIds() {
    if (recentNavIds) return recentNavIds;
    try {
        const tenantId = localStorage.getItem('tools_tenant_id') || 'default';
        const raw = localStorage.getItem(`${NAV_RECENT_STORAGE_KEY}:${tenantId}`);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function recordRecentNavTool(toolId) {
    if (!toolId || typeof toolId !== 'string') return;
    try { window.CatalogUpdateAudit?.markUsed?.('tool', toolId.replace(/^custom:/, '')); } catch (_) {}
    try {
        const tenantId = localStorage.getItem('tools_tenant_id') || 'default';
        const key = `${NAV_RECENT_STORAGE_KEY}:${tenantId}`;
        const ids = getRecentNavToolIds().filter(id => id !== toolId);
        ids.unshift(toolId);
        recentNavIds = ids.slice(0, 16);
        localStorage.setItem(key, JSON.stringify(recentNavIds));
    } catch (_) {}
    if (hasNavAuthToken()) {
        recentNavWriteQueue = recentNavWriteQueue.then(async () => {
            const response = await fetch('/api/recent-nav', {
                method: 'POST',
                keepalive: true,
                headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
                body: JSON.stringify({ toolId })
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }).catch(error => console.warn('[Platform] save recent tool failed:', error));
    }
}

async function loadRecentNavTools() {
    if (!hasNavAuthToken()) return;
    try {
        const response = await fetch('/api/recent-nav', { headers: getAuthHeaderForNav() });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.ids)) return;
        const localIds = getRecentNavToolIds();
        recentNavIds = data.ids.filter(id => typeof id === 'string').slice(0, 16);
        if (!recentNavIds.length && localIds.length) {
            // 首次升级时，把该浏览器原有的最近使用顺序写入服务端。
            localIds.slice(0, 16).reverse().forEach(recordRecentNavTool);
        }
    } catch (error) {
        console.warn('[Platform] load recent tools failed:', error);
    }
}

function trackCurrentPageAsRecentNavTool() {
    try {
        const path = window.location.pathname;
        const allItems = getAllNavItems();
        const currentItem = allItems.find(item => item && typeof item.match === 'function' && item.match(path));
        if (currentItem && currentItem.id) {
            recordRecentNavTool(currentItem.id);
        }
    } catch (_) {}
}

// ── 收藏的工具：按账号保存在服务端（/api/favorite-nav），本地缓存用于首屏；首页卡片与「更多工具」共用 ──
const NAV_FAVORITE_STORAGE_KEY = 'tools_favorite_nav_tools';
let favoriteNavIds = null;
let favoriteNavWriteQueue = Promise.resolve();

function favoriteStorageKey() {
    return `${NAV_FAVORITE_STORAGE_KEY}:${localStorage.getItem('tools_tenant_id') || 'default'}`;
}

function getFavoriteNavToolIds() {
    if (favoriteNavIds) return favoriteNavIds.slice();
    try {
        const parsed = JSON.parse(localStorage.getItem(favoriteStorageKey()) || '[]');
        return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
    } catch (_) {
        return [];
    }
}

function setFavoriteNavToolIds(ids) {
    favoriteNavIds = [...new Set((ids || []).filter(id => typeof id === 'string' && id))].slice(0, 60);
    try { localStorage.setItem(favoriteStorageKey(), JSON.stringify(favoriteNavIds)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('tools:favorites-change', { detail: { ids: favoriteNavIds.slice() } }));
    if (!hasNavAuthToken()) return;
    const snapshot = favoriteNavIds.slice();
    favoriteNavWriteQueue = favoriteNavWriteQueue.then(async () => {
        const response = await fetch('/api/favorite-nav', {
            method: 'PUT',
            keepalive: true,
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ ids: snapshot })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }).catch(error => console.warn('[Platform] save favorite tools failed:', error));
}

function toggleFavoriteNavTool(toolId) {
    const ids = getFavoriteNavToolIds();
    const next = ids.includes(toolId) ? ids.filter(id => id !== toolId) : [...ids, toolId];
    setFavoriteNavToolIds(next);
    return next.includes(toolId);
}

async function loadFavoriteNavTools() {
    if (!hasNavAuthToken()) return;
    try {
        const response = await fetch('/api/favorite-nav', { headers: getAuthHeaderForNav() });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.ids)) return;
        favoriteNavIds = data.ids.filter(id => typeof id === 'string');
        try { localStorage.setItem(favoriteStorageKey(), JSON.stringify(favoriteNavIds)); } catch (_) {}
        window.dispatchEvent(new CustomEvent('tools:favorites-change', { detail: { ids: favoriteNavIds.slice() } }));
    } catch (error) {
        console.warn('[Platform] load favorite tools failed:', error);
    }
}

window.NavFavorites = {
    get: getFavoriteNavToolIds,
    set: setFavoriteNavToolIds,
    toggle: toggleFavoriteNavTool,
    has: id => getFavoriteNavToolIds().includes(id)
};

/**
 * 管理员拖动首页卡片后调整工具分类和顺序。快捷入口（primaryIds）的顺序在设置中单独维护。
 */
function reorderNavItem(itemId, { beforeId = '', afterId = '', categoryId = '' } = {}) {
    if (localStorage.getItem('tools_role') !== 'admin' || !navState.settings || !itemId) return false;
    if (NAV_WORKFLOW_IDS.includes(itemId) || categoryId === NAV_WORKFLOW_CATEGORY) return false;
    const settings = navState.settings;
    const ordered = sortNavItems(getAllNavItems(), settings.itemOrder).map(item => item.id);
    if (!ordered.includes(itemId)) return false;
    const ids = ordered.filter(id => id !== itemId);
    let index = ids.length;
    if (beforeId && ids.includes(beforeId)) index = ids.indexOf(beforeId);
    else if (afterId && ids.includes(afterId)) index = ids.indexOf(afterId) + 1;
    else if (categoryId) {
        // 放到目录末尾：插在该目录最后一个工具之后
        const categoryOf = id => settings.categoryByItem[id] || getAllNavItems().find(item => item.id === id)?.defaultCategory || 'custom';
        const last = ids.map((id, position) => [id, position]).filter(([id]) => categoryOf(id) === categoryId).pop();
        if (last) index = last[1] + 1;
    }
    ids.splice(index, 0, itemId);
    const nextCategory = { ...settings.categoryByItem };
    if (categoryId && (settings.categories || []).some(category => category.id === categoryId)) nextCategory[itemId] = categoryId;
    navState.settings = { ...settings, itemOrder: ids, categoryByItem: nextCategory };
    scheduleNavSettingsSave();
    notifyRequirementPageCategoriesChanged();
    return true;
}

window.NavLayout = { reorder: reorderNavItem, itemOrder: () => (navState.settings?.itemOrder || []).slice() };

async function loadNavigationData() {
    try {
        const [settings, tools, pagesData] = await Promise.all([
            fetch('/api/nav-settings', { headers: getAuthHeaderForNav() }).then(res => res.ok ? res.json() : null),
            typeof API !== 'undefined'
                ? API.get('/api/custom-tools').catch(() => null)
                : fetch('/api/custom-tools', { headers: getAuthHeaderForNav() }).then(res => res.ok ? res.json() : null),
            fetch('/api/distribution/pages', { headers: getAuthHeaderForNav() }).then(res => res.ok ? res.json() : null).catch(() => null)
        ]);
        if (settings) navState.settings = normalizeNavSettings(settings);
        if (tools) navState.customTools = tools;
        if (Array.isArray(pagesData?.pages)) setPlatformPageAccessList(pagesData.pages);
        if (settings || tools || Array.isArray(pagesData?.pages)) writeNavigationBootstrapCache();
    } catch (e) {
        console.warn('[Platform] load navigation data failed:', e);
    }
    notifyRequirementPageCategoriesChanged();
    publishPlatformCatalog();
    await Promise.all([loadRecentNavTools(), loadFavoriteNavTools()]);
    trackCurrentPageAsRecentNavTool();
    if (document.getElementById('navSettingsModal')) renderNavSettingsContent();
}

// 一个账号 = 一个团队：服务端会话决定当前团队（超级管理员排障时可临时进入其他团队）。
// 浏览器本地状态按团队分片保存，团队变化时切换分片并刷新。
async function syncTenantWorkspace(user) {
    const previous = localStorage.getItem('tools_tenant_id') || 'default';
    const target = user.tenantId || 'default';
    // 旧后端（尚未重启）的 /api/auth/me 没有 isSuper：沿用单用户时代的语义，管理员即超级管理员
    const isSuper = typeof user.isSuper === 'boolean' ? user.isSuper : user.role === 'admin';
    localStorage.setItem('tools_super', isSuper ? '1' : '0');
    navState.viewingTeam = user.viewingTeam || null;
    navState.homeTenantId = user.homeTenantId || target;
    if (previous !== target) {
        switchTenantBrowserState(previous, target);
        localStorage.setItem('tools_tenant_id', target);
        window.location.reload(); return true;
    }
    navState.activeTenantId = target;
    renderViewingTeamBanner();
    return false;
}

function isNavSuperAdmin() {
    if (localStorage.getItem('tools_role') !== 'admin') return false;
    const flag = localStorage.getItem('tools_super');
    return flag === null ? true : flag === '1'; // 还没从服务端取到标记时不隐藏管理员菜单
}
if (typeof window !== 'undefined') window.isNavSuperAdmin = isNavSuperAdmin;

// 超级管理员进入其他团队排障时的提示条
function renderViewingTeamBanner() {
    document.getElementById('navViewingTeamBanner')?.remove();
    const team = navState.viewingTeam;
    if (!team) return;
    const en = window.ToolsI18n?.getLanguage?.() === 'en-US';
    const bar = document.createElement('div');
    bar.id = 'navViewingTeamBanner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:10050;display:flex;gap:10px;align-items:center;padding:8px 14px;border-radius:999px;background:#7c2d12;color:#fff;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    bar.innerHTML = `<span>${navEscape(en ? `Viewing team: ${team.name}` : `正在查看团队：${team.name}`)}</span><button type="button" style="border:0;border-radius:999px;padding:3px 10px;background:#fff;color:#7c2d12;font-weight:600;cursor:pointer">${navEscape(en ? 'Back to mine' : '返回我的空间')}</button>`;
    bar.querySelector('button').addEventListener('click', () => switchNavTeam(navState.homeTenantId || 'default'));
    document.body.appendChild(bar);
}

async function switchNavTeam(tenantId) {
    const response = await fetch('/api/tenants/switch', { method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }, body: JSON.stringify({ tenantId }) });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const msg = data.error || '切换失败';
        if (window.AppDialog?.alert) await window.AppDialog.alert(msg, { title: '切换失败', tone: 'error' });
        else if (typeof showPlatformNotice === 'function') await showPlatformNotice({ title: '切换失败', message: msg, tone: 'error' });
        return;
    }
    const previous = localStorage.getItem('tools_tenant_id') || 'default';
    if (previous !== tenantId) switchTenantBrowserState(previous, tenantId);
    localStorage.setItem('tools_tenant_id', tenantId);
    window.location.href = '/';
}
if (typeof window !== 'undefined') window.switchNavTeam = switchNavTeam;
function activeTenantName() { return navState.settings?.platformName || 'Dragon Claw'; }

window.refreshCustomToolNavLinks = loadNavigationData;

window.toggleAppLanguage = function () {
    if (window.ToolsI18n) window.ToolsI18n.toggleLanguage();
};

window.addEventListener('tools:languagechange', () => {
    registerPlatformI18n();
    publishPlatformCatalog();

    // Also re-render the modal shell if it's open, to update the sidebar language without losing the open state
    const modal = document.getElementById('navSettingsModal');
    if (modal && modal.style.display !== 'none') {
        renderNavSettingsSidebar();
        renderNavSettingsContent();
    }

    const syncModal = document.getElementById('builtinToolsSyncModal');
    if (syncModal && lastBuiltinToolsSyncPreview) {
        if (syncModal.dataset.applying === '1' || syncModal.dataset.needsRefresh === '1') {
            if (syncModal.dataset.applying === '1') {
                renderBuiltinToolsSyncProgress(syncModal, syncModal.syncProgress || {});
                syncModal.querySelector('.builtin-sync-apply').textContent = navLocaleText('正在处理…', 'Processing…');
            } else {
                syncModal.querySelector('.builtin-sync-apply').textContent = navLocaleText('重新检查', 'Check Again');
            }
            return;
        }
        const selectedSlugs = new Set(
            [...syncModal.querySelectorAll('.builtin-sync-choice:checked')].map(input => input.dataset.syncSlug)
        );
        openBuiltinToolsSyncModal(lastBuiltinToolsSyncPreview, selectedSlugs);
    }
});

window.doLogout = async function () {
    stopAlertCenterPolling();
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('tools_token') }
        });
    } catch (e) { }
    const language = localStorage.getItem('tools_language');
    const legacyLanguage = localStorage.getItem('tools_lang');
    const preservedEntries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
            key.startsWith('tools_recent_nav_tools') ||
            key.startsWith('home_sidebar_width:') ||
            key === 'tools_tenant_id' ||
            key === 'tools_platform_name' ||
            key === 'tools_platform_identity' ||
            key === 'builtin_tools_sync_snooze_date_v1' ||
            key.startsWith('tools_ai_proactive_alerts_snoozed') ||
            key.startsWith('tools_ai_proactive_alerts_seen')
        )) {
            preservedEntries.push([key, localStorage.getItem(key)]);
        }
    }
    localStorage.clear();
    if (language) localStorage.setItem('tools_language', language);
    if (legacyLanguage) localStorage.setItem('tools_lang', legacyLanguage);
    for (const [key, val] of preservedEntries) {
        if (val !== null) localStorage.setItem(key, val);
    }
    sessionStorage.clear();
    try { sessionStorage.setItem('tools_manual_logout', '1'); } catch (_) {}
    document.cookie = 'tools_token=; path=/; max-age=0';
    window.location.href = '/login.html';
};

// ==========================================
// 全局注入 AI 客服助手
// ==========================================
let toolsKnowledgeGraphLoader = null;
window.openToolsKnowledgeGraph = function (options = {}) {
    if (window.AIKnowledgeGraph?.open) {
        window.AIKnowledgeGraph.open(options);
        return Promise.resolve();
    }
    if (!toolsKnowledgeGraphLoader) {
        toolsKnowledgeGraphLoader = loadNavLazyScript('/js/shared/ai-knowledge-graph-spatial-themes-v5.js', '知识图谱组件加载失败').catch(error => {
            toolsKnowledgeGraphLoader = null;
            throw error;
        });
    }
    return toolsKnowledgeGraphLoader.then(() => {
        if (!window.AIKnowledgeGraph?.open) throw new Error('知识图谱组件初始化失败');
        window.AIKnowledgeGraph.open(options);
    });
};

// 对话里的文件卡片与图片放大（ai-assistant.js 的 Markdown 渲染会用到），需先于助手脚本执行
let toolsChatFilesLoader = null;
function ensureChatFilesScript() {
    if (window.ChatFiles) return Promise.resolve();
    // 无版本地址会被 CDN/移动端缓存数小时，必须使用服务端内容哈希。
    toolsChatFilesLoader ||= loadNavLazyScript('/js/shared/chat-files.js', '文件组件加载失败').catch(error => {
        toolsChatFilesLoader = null;
        throw error;
    });
    return toolsChatFilesLoader;
}

let toolsAiAssistantLoader = null;
function ensureToolsAIAssistantScript() {
    if (window.ToolsAIAssistant?.open) return Promise.resolve();
    if (!toolsAiAssistantLoader) {
        toolsAiAssistantLoader = ensureChatFilesScript().then(() =>
            loadNavLazyScript('/js/shared/ai-assistant.js', 'AI 助手组件加载失败')
        ).catch(error => {
            toolsAiAssistantLoader = null;
            throw error;
        });
    }
    return toolsAiAssistantLoader;
}
window.openToolsAIAssistant = function (options = {}) {
    return ensureToolsAIAssistantScript().then(() => {
        if (!window.ToolsAIAssistant?.open) throw new Error('AI 助手组件初始化失败');
        return window.ToolsAIAssistant.open(options);
    });
};

// 检查服务状态
function ensureToolsI18nLoaded() {
    if (window.ToolsI18n) return Promise.resolve();
    return new Promise((resolve) => {
        const existing = document.querySelector('script[src^="/js/shared/i18n.js"]');
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', resolve, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = '/js/shared/i18n.js';
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
    });
}

function ensureMigrationStatusLoaded() {
    if (document.querySelector('script[src^="/js/shared/migration-status.js"]')) return;
    const script = document.createElement('script');
    script.src = '/js/shared/migration-status.js';
    document.head.appendChild(script);
}

function trackCurrentToolOpen() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    const builtinTools = new Set([
        'uivf12', 'sla', 'report', 'expedite', 'monthly', 'ai-bi', 'bigscreen',
        'frt', 'requirements', 'praudit', 'storage', 'db-explorer', 'netcare-explorer'
    ]);
    let toolKey = pathname.replace(/^\//, '');
    const customMatch = pathname.match(/^\/tools\/([^/]+)$/);
    if (customMatch) toolKey = `custom:${decodeURIComponent(customMatch[1])}`;
    if (!builtinTools.has(toolKey) && !toolKey.startsWith('custom:')) return;

    const submit = window.API?.post
        ? window.API.post('/api/platform-metrics/open', { toolKey })
        : fetch('/api/platform-metrics/open', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(localStorage.getItem('tools_token') ? { Authorization: `Bearer ${localStorage.getItem('tools_token')}` } : {})
            },
            body: JSON.stringify({ toolKey })
        });
    Promise.resolve(submit).catch(() => { });
}

function initBackToTopButton() {
    if (document.getElementById('globalBackToTop')) return;

    const styleId = 'globalBackToTopStyle';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* 右侧停靠列的一员：与 Dragon Claw / 工作区标签同形同材质，小一号，叠在整列最上方 */
            #globalBackToTop {
                position: fixed;
                right: 0;
                bottom: var(--global-back-to-top-bottom, 156px);
                z-index: 10050;
                width: 46px;
                height: 40px;
                padding: 0 4px 0 8px;
                border: 1px solid rgba(100, 255, 218, 0.26);
                border-right: none;
                border-radius: 20px 0 0 20px;
                background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(16, 32, 54, 0.9));
                color: #99f6e4;
                box-shadow: -6px 8px 22px rgba(2, 6, 23, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.07);
                backdrop-filter: blur(12px);
                -webkit-backdrop-filter: blur(12px);
                cursor: pointer;
                display: grid;
                place-items: center;
                opacity: 0;
                visibility: hidden;
                transform: translateX(100%);
                transition: opacity 0.2s ease, transform 0.24s cubic-bezier(.2,.8,.2,1), visibility 0.2s ease, border-color 0.18s ease, color 0.18s ease;
                -webkit-tap-highlight-color: transparent;
            }
            #globalBackToTop svg { width: 18px; height: 18px; }
            #globalBackToTop.visible {
                opacity: 1;
                visibility: visible;
                transform: translateX(0);
            }
            #globalBackToTop:hover {
                border-color: rgba(100, 255, 218, 0.55);
                color: #64ffda;
            }
            #globalBackToTop:focus-visible {
                outline: 2px solid rgba(100, 255, 218, 0.75);
                outline-offset: 2px;
            }
            @media (max-width: 520px) {
                #globalBackToTop { width: 42px; height: 36px; border-radius: 18px 0 0 18px; }
            }
            @media (prefers-reduced-motion: reduce) {
                #globalBackToTop { transition: none; }
            }
            @media print {
                #globalBackToTop { display: none !important; }
            }
        `;
        document.head.appendChild(style);
    }

    const button = document.createElement('button');
    button.id = 'globalBackToTop';
    button.type = 'button';
    button.setAttribute('aria-label', '回到顶部');
    button.title = '回到顶部';
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';
    document.body.appendChild(button);

    let lastScrollElement = null;
    let rafPending = false;
    const threshold = 360;
    const DOCK_GAP = 10;
    const defaultBottom = () => (window.innerWidth <= 720 ? 142 : 156);

    function getWindowScrollTop() {
        return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    }

    // 只认「当前可见且占屏一半以上高度」的主滚动区（如对话列表）；已关闭的弹窗、抽屉、下拉菜单滚过也不算，
    // 否则它们残留的 scrollTop 会让按钮在页面顶部时也出现。
    function isMainScroller(element) {
        if (!element || !document.contains(element) || !element.getClientRects().length) return false;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        return element.clientHeight >= window.innerHeight * 0.5;
    }

    function getActiveScrollTop() {
        const windowTop = getWindowScrollTop();
        if (!isMainScroller(lastScrollElement)) {
            lastScrollElement = null;
            return windowTop;
        }
        return Math.max(windowTop, lastScrollElement.scrollTop || 0);
    }

    function updateVisibility() {
        rafPending = false;
        updateBackToTopPlacement();
        button.classList.toggle('visible', getActiveScrollTop() > threshold);
    }

    // 叠放在右侧停靠列（Dragon Claw、下载圆环、工作区标签）最上方，间距与停靠列一致
    function updateBackToTopPlacement() {
        const docked = Array.from(document.querySelectorAll('.ai-fab, #dcWorkspaceFab, #desktopDlFab')).filter(element => {
            if (!element.getClientRects().length) return false;
            const style = getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.05;
        });
        const dockTop = docked.length ? Math.min(...docked.map(element => element.getBoundingClientRect().top)) : null;
        const nextBottom = dockTop === null ? defaultBottom() : window.innerHeight - dockTop + DOCK_GAP;
        button.style.setProperty('--global-back-to-top-bottom', `${Math.round(nextBottom)}px`);
    }

    // 横向滚动（如数据导入页顶部每帧自动滚动的指标栏）不改变按钮状态；若照样处理，
    // 每帧都会查询停靠按钮并强制重排，大页面上会长期占满主线程。
    const lastScrollTops = new WeakMap();
    function queueVisibilityUpdate(event) {
        const target = event && event.target;
        if (event && event.type === 'scroll') {
            const scroller = target && target.nodeType === 1 ? target : document;
            const top = scroller === document ? getWindowScrollTop() : (target.scrollTop || 0);
            if (lastScrollTops.get(scroller) === top) return;
            lastScrollTops.set(scroller, top);
        }
        if (target && target !== document && target !== window && target !== document.documentElement && target !== document.body) {
            if (target.scrollTop > threshold && isMainScroller(target)) lastScrollElement = target;
        }
        if (rafPending) return;
        rafPending = true;
        window.requestAnimationFrame(updateVisibility);
    }

    function scrollElementToTop(element) {
        if (!element || !document.contains(element) || !element.scrollTo) return;
        if ((element.scrollTop || 0) <= 0) return;
        element.scrollTo({ top: 0, behavior: 'smooth' });
    }

    button.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        scrollElementToTop(document.scrollingElement);
        scrollElementToTop(lastScrollElement);
    });

    window.addEventListener('scroll', queueVisibilityUpdate, { passive: true });
    document.addEventListener('scroll', queueVisibilityUpdate, { passive: true, capture: true });
    window.addEventListener('resize', () => {
        updateBackToTopPlacement();
        queueVisibilityUpdate();
    }, { passive: true });
    window.addEventListener('tools:ai-fab-position', updateBackToTopPlacement);
    // 工作区标签异步出现/隐藏、抽屉开关时重新对位
    new MutationObserver(() => queueVisibilityUpdate()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    setTimeout(updateVisibility, 300);
}

