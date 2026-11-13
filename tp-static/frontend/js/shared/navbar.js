/**
 * shared/navbar.js - 统一导航栏组件
 * 支持固定工具、自定义工具、二级分类与全局顺序设置。
 */
// Tool links opened in another tab retain the current platform shell, including nested query/hash state.
function navToolShellUrl(href) {
    try {
        const url = new URL(href, location.origin);
        if (url.origin !== location.origin || url.pathname === '/' || /^\/(api|login|downloads?)\b/.test(url.pathname)) return href;
        url.searchParams.set('standalone', '1');
        return url.pathname + url.search + url.hash;
    } catch { return href; }
}
window.ToolsNavigation = { ...window.ToolsNavigation, toolUrl: window.ToolsNavigation?.toolUrl || navToolShellUrl };
// 在新版首页右侧内嵌打开（js/home/tool-frame.js）时不显示旧的顶部导航，页面直接从顶部开始
const NAV_EMBEDDED = (() => {
    if (new URLSearchParams(location.search).get('standalone') === '1') return true;
    try { return window.top !== window && window.top.location.origin === location.origin && Boolean(window.top.HomeToolFrame); } catch { return false; }
})();
if (NAV_EMBEDDED) document.documentElement.classList.add('is-embedded-tool');
if (/^\/(?:pages\/)?(?:privacy|terms)(?:\.html)?$/.test(location.pathname)) document.documentElement.classList.add('is-embedded-tool');
const NAV_BUILTIN_LINKS = [
    { id: 'home', href: '/', icon: '🏠', label: '工具中台', labelKey: 'nav.home', defaultCategory: 'business', match: p => p === '/' },
    { id: 'uivf12', href: '/uivf12', icon: '🚀', label: '数据抓取', labelKey: 'nav.uivf12', defaultCategory: 'business', match: p => p.startsWith('/uivf12') },
    { id: 'sla', href: '/sla', icon: '📊', label: '数据导入', labelKey: 'nav.sla', defaultCategory: 'business', match: p => p.startsWith('/sla') },
    { id: 'report', href: '/report', icon: '📈', label: '报表看板', labelKey: 'nav.report', defaultCategory: 'business', match: p => p.startsWith('/report') },
    { id: 'expedite', href: '/expedite', icon: '⚡', label: '一键催办', labelKey: 'nav.expedite', defaultCategory: 'business', match: p => p.startsWith('/expedite') },
    { id: 'monthly', href: '/monthly', icon: '📅', label: '月报页面', labelKey: 'nav.monthly', defaultCategory: 'business', match: p => p.startsWith('/monthly') || p === '/pages/ai-report.html' },
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
const NAV_WORKFLOW_IDS = ['uivf12', 'sla', 'report', 'expedite', 'monthly', 'bigscreen'];
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
        'home', 'uivf12', 'sla', 'report', 'custom-report', 'expedite', 'monthly', 'duty-roster', 'bigscreen',
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
// Verified pages that process data in the browser without business API/database calls.
const NAV_LOCAL_ONLY_TOOLS = new Set([
    'nis_2026h1_summary', 'particle-effects', 'pr', 'pr-2',
    'question-bank-assistant-privacy', 'question-bank-study',
    'supplier-quotation-comparison', 'tool-mr0vvmyi', 'tool-mr87218d',
    'tool-mr88gv9x', 'tool-mrlpwjk3', 'tool-mro1gt5o',
    'tool-mrrgpqy4', 'tool-mrrn48dc', 'tool-ms1saxuh',
    'tool-msbmscxd', 'tool-msbmu55i', 'tool-msh8aro4', 'tool-mtpx4vtr',
    'tool-msqfmv82', 'tool-msqfplq0', 'tool-mu2t8wi3', 'tool-mumxi3px'
]);

function isLocalOnlyNavTool(item) {
    return item?.id?.startsWith('custom:') && NAV_LOCAL_ONLY_TOOLS.has(item.id.slice('custom:'.length));
}

function renderNavToolBadges(item) {
    // 托管 Python 应用用 Python 标签代替「自定义」
    if (item?.hostedApp) {
        return `<span class="nav-tool-badges"><span class="tool-kind-badge tool-kind-badge--python" title="${navEscape(navLocaleText('平台托管运行的 Python Web 应用', 'Python web app hosted by the platform'))}">Python</span></span>`;
    }
    const localOnly = isLocalOnlyNavTool(item);
    const custom = item?.id?.startsWith('custom:') && item.builtIn === false;
    if (!localOnly && !custom) return '';
    return `<span class="nav-tool-badges${localOnly && custom ? ' nav-tool-badges--stacked' : ''}">
        ${localOnly ? `<span class="tool-kind-badge tool-kind-badge--local" title="${navEscape(navLocaleText('仅在浏览器中处理，不调用业务数据接口', 'Processed in the browser without business data APIs'))}">${navEscape(navLocaleText('纯 HTML', 'HTML'))}</span>` : ''}
        ${custom ? `<span class="tool-kind-badge tool-kind-badge--custom" title="${navEscape(navLocaleText('用户添加的自定义工具', 'User-added custom tool'))}">${navEscape(navLocaleText('自定义', 'CUSTOM'))}</span>` : ''}
    </span>`;
}

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
    return true;
}

let navbarI18nEntries;
function navT(key, params = {}) {
    const translated = window.ToolsI18n?.t(key, params);
    if (translated && translated !== key) return translated;
    let lang = 'zh-CN';
    try { lang = window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || localStorage.getItem('tools_language') || lang; } catch (_) {}
    const fallback = navbarI18nEntries?.[lang]?.[key] ?? navbarI18nEntries?.['zh-CN']?.[key] ?? key;
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
    navPinyinLoading ||= loadNavLazyScript('./tp-static/frontend/js/shared/pinyin-search.js', 'pinyin search could not load')
        .catch(error => {
            navPinyinLoading = null;
            console.warn('[navbar]', error.message);
        });
    return navPinyinLoading;
}

function registerNavbarI18n() {
    // Keep the same dictionary available during asynchronous language initialization.
    navbarI18nEntries ||= {
        'zh-CN': {
            'nav.home': '工具中台',
            'nav.uivf12': '数据抓取',
            'nav.sla': '数据导入',
            'nav.report': '报表看板',
            'nav.expedite': '一键催办',
            'nav.monthly': '月报页面',
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
            'nav.set.sub.primary': '修改后会自动保存，并立即影响顶部导航。',
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
            'nav.ai.lblProvider': '供应商协议',
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
            'nav.set.sub.primary': 'Changes are saved automatically and immediately applied to the top navigation.',
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
            'nav.ai.lblProvider': 'Provider Protocol',
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
    window.ToolsI18n?.register('navbar', navbarI18nEntries);
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
        primaryIds: Array.isArray(settings.primaryIds) ? settings.primaryIds.map(String) : NAV_DEFAULT_SETTINGS.primaryIds.slice(),
        categories: cats,
        categoryByItem: settings.categoryByItem && typeof settings.categoryByItem === 'object' ? { ...settings.categoryByItem } : { ...NAV_DEFAULT_SETTINGS.categoryByItem },
        f12QuickDownloads: Array.isArray(settings.f12QuickDownloads)
            ? settings.f12QuickDownloads
                .filter(item => item && typeof item.scriptId === 'string' && /^(builtin|server):[a-zA-Z0-9_-]+$/.test(item.scriptId))
                .map(item => ({ scriptId: item.scriptId, target: item.target === 'local' ? 'local' : 'store' }))
            : [],
        itemOrder: Array.isArray(settings.itemOrder) ? settings.itemOrder.map(String) : NAV_DEFAULT_SETTINGS.itemOrder.slice()
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

    document.querySelectorAll('#app-navbar .brand-name, [data-platform-name], [data-platform-main-title]').forEach(el => {
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
    // 迁移状态、数据探索、NetCare 浏览只给超级管理员（后端同样拦截），团队账号的导航里不出现
    const superOnly = isNavSuperAdmin() ? [] : ['storage', 'db-explorer', 'netcare-explorer'];
    return [...NAV_BUILTIN_LINKS.filter(item => (!item.adminOnly || isAdmin) && !superOnly.includes(item.id)), ...customItems];
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
        }).catch(error => console.warn('[Navbar] save recent tool failed:', error));
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
        refreshNavMoreRecent();
    } catch (error) {
        console.warn('[Navbar] load recent tools failed:', error);
    }
}

function trackCurrentPageAsRecentNavTool() {
    try {
        const path = (window.__TP_STATIC_PATH__ || window.location.pathname);
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
    refreshNavMoreRecent();
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
    }).catch(error => console.warn('[Navbar] save favorite tools failed:', error));
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
        refreshNavMoreRecent();
        window.dispatchEvent(new CustomEvent('tools:favorites-change', { detail: { ids: favoriteNavIds.slice() } }));
    } catch (error) {
        console.warn('[Navbar] load favorite tools failed:', error);
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

function renderNavFavoriteSection(itemById) {
    const items = getFavoriteNavToolIds().map(id => itemById.get(id)).filter(Boolean).slice(0, 12);
    if (!items.length) return '';
    const path = (window.__TP_STATIC_PATH__ || window.location.pathname);
    const itemsHtml = items.map(item => {
        const label = navEscape(getNavLabel(item));
        return `
            <a href="${item.href}" class="nav-more-recent-item${item.hostedApp ? ' is-hosted-app' : ''} ${item.match(path) ? 'active' : ''}" data-nav-item-id="${navEscape(item.id)}" data-nav-search="${navEscape(buildNavSearchIndex(item))}" title="${label}">
                <span class="nav-more-recent-item-icon">${item.icon}</span>
                <span class="nav-more-recent-item-label">${label}</span>
            </a>`;
    }).join('');
    return `
        <section class="nav-more-recent nav-more-favorites" id="navMoreFavorites">
            <div class="nav-more-recent-header">
                <div class="nav-more-recent-title">
                    <span class="nav-more-recent-icon" aria-hidden="true">⭐</span>
                    <span>${navEscape(navT('nav.moreFavorites'))}</span>
                </div>
                <span class="nav-more-recent-badge">${navEscape(navT('nav.moreFavoritesBadge'))}</span>
            </div>
            <div class="nav-more-recent-grid" style="--recent-cols: ${Math.min(4, items.length)}">
                ${itemsHtml}
            </div>
        </section>`;
}

function getRecentNavDisplayItems(itemById, primaryIds, overflowItems) {
    const recentIds = getRecentNavToolIds();
    const recentItems = [];
    const seenRecent = new Set();
    for (const id of recentIds) {
        const item = itemById.get(id);
        if (item && !primaryIds.has(item.id) && !seenRecent.has(item.id)) {
            seenRecent.add(item.id);
            recentItems.push(item);
            if (recentItems.length >= 4) break;
        }
    }
    if (recentItems.length < 2) {
        for (const item of overflowItems) {
            if (!seenRecent.has(item.id)) {
                seenRecent.add(item.id);
                recentItems.push(item);
                if (recentItems.length >= 4) break;
            }
        }
    }
    return recentItems;
}

function renderNavRecentSection(recentItems) {
    if (!Array.isArray(recentItems) || !recentItems.length) return '';
    const path = (window.__TP_STATIC_PATH__ || window.location.pathname);
    const itemsHtml = recentItems.map(item => {
        const label = navEscape(getNavLabel(item));
        return `
            <a href="${item.href}" class="nav-more-recent-item ${item.match(path) ? 'active' : ''}" data-nav-item-id="${navEscape(item.id)}" data-nav-search="${navEscape(buildNavSearchIndex(item))}" title="${label}">
                <span class="nav-more-recent-item-icon">${item.icon}</span>
                <span class="nav-more-recent-item-label">${label}</span>
            </a>
        `;
    }).join('');

    return `
        <section class="nav-more-recent" id="navMoreRecent">
            <div class="nav-more-recent-header">
                <div class="nav-more-recent-title">
                    <span class="nav-more-recent-icon" aria-hidden="true">🕒</span>
                    <span>${navEscape(navT('nav.moreRecent'))}</span>
                </div>
                <span class="nav-more-recent-badge">${navEscape(navT('nav.moreRecentBadge'))}</span>
            </div>
            <div class="nav-more-recent-grid" style="--recent-cols: ${recentItems.length}">
                ${itemsHtml}
            </div>
        </section>
    `;
}

function refreshNavMoreRecent() {
    const menuEl = document.getElementById('navMoreMenu');
    if (!menuEl || !navState.settings) return;
    const settings = navState.settings;
    const allItems = getAllNavItems();
    const itemById = new Map(allItems.map(item => [item.id, item]));
    const primaryItems = (settings.primaryIds || []).map(id => itemById.get(id)).filter(Boolean);
    const primaryIds = new Set(primaryItems.map(item => item.id));
    const overflowItems = sortNavItems(allItems.filter(item => !primaryIds.has(item.id)), settings.itemOrder);
    const recentItems = getRecentNavDisplayItems(itemById, primaryIds, overflowItems);

    const existingBar = menuEl.querySelector('#navMoreRecent');
    const newHtml = renderNavRecentSection(recentItems);
    if (existingBar) {
        const temp = document.createElement('div');
        temp.innerHTML = newHtml;
        const newBar = temp.firstElementChild;
        if (newBar) existingBar.replaceWith(newBar);
    } else {
        const toolbar = menuEl.querySelector('.nav-more-toolbar');
        if (toolbar) toolbar.insertAdjacentHTML('afterend', newHtml);
    }
    const existingFavorites = menuEl.querySelector('#navMoreFavorites');
    const favoritesHtml = renderNavFavoriteSection(itemById);
    if (existingFavorites) existingFavorites.outerHTML = favoritesHtml;
    else if (favoritesHtml) (menuEl.querySelector('#navMoreRecent') || menuEl.querySelector('.nav-more-toolbar'))?.insertAdjacentHTML('afterend', favoritesHtml);
}

function renderNavItem(item, className) {
    const path = (window.__TP_STATIC_PATH__ || window.location.pathname);
    const label = navEscape(getNavLabel(item));
    let content = className.includes('nav-more-item')
        ? `<span class="nav-more-item-icon">${item.icon}</span><span class="nav-more-item-label">${label}</span>`
        : `${item.icon} ${label}`;

    if (isRecentlyChangedTool(item)) {
        content += `<span class="new-badge">NEW!</span>`;
    }
    content += renderNavToolBadges(item);

    return `<a href="${item.href}" class="${className}${item.hostedApp ? ' is-hosted-app' : ''} ${item.match(path) ? 'active' : ''}" data-nav-item-id="${navEscape(item.id)}" data-nav-search="${navEscape(buildNavSearchIndex(item))}" title="${label}">${content}</a>`;
}

function renderNavLinksFromState() {
    applyPlatformIdentity();
    const primaryEl = document.querySelector('#app-navbar .nav-links');
    const menuEl = document.getElementById('navMoreMenu');
    if (!primaryEl || !menuEl) return;

    const settings = navState.settings;
    const allItems = getAllNavItems();
    const itemById = new Map(allItems.map(item => [item.id, item]));
    const primaryItems = (settings.primaryIds || []).map(id => itemById.get(id)).filter(Boolean);
    const primaryIds = new Set(primaryItems.map(item => item.id));
    const overflowItems = sortNavItems(allItems.filter(item => !primaryIds.has(item.id)), settings.itemOrder);
    navState.currentPrimaryItems = primaryItems;

    primaryEl.innerHTML = primaryItems.map(item => renderNavItem(item, 'nav-link')).join('');

    const categoryMap = new Map((settings.categories || []).map(cat => [cat.id, { ...cat, items: [] }]));
    if (!categoryMap.size) {
        NAV_DEFAULT_SETTINGS.categories.forEach(cat => categoryMap.set(cat.id, { ...cat, items: [] }));
    }
    overflowItems.forEach(item => {
        const catId = settings.categoryByItem[item.id] || item.defaultCategory || 'custom';
        if (!categoryMap.has(catId)) categoryMap.set(catId, { id: catId, name: navT('nav.uncategorized'), items: [] });
        categoryMap.get(catId).items.push(item);
    });

    const recentItems = getRecentNavDisplayItems(itemById, primaryIds, overflowItems);

    const visibleCategories = Array.from(categoryMap.values()).filter(cat => cat.items.length);
    const categoryButtons = visibleCategories
        .map((cat, index) => `<button type="button" class="nav-more-category-btn ${index === 0 ? 'active' : ''}" data-nav-category-target="${navEscape(cat.id)}">${navEscape(getNavCategoryName(cat))}<span>${cat.items.length}</span></button>`)
        .join('');
    const menuHtml = visibleCategories
        .map(cat => `
            <section class="nav-more-category" data-nav-category="${navEscape(cat.id)}">
                <div class="nav-more-section-label">${navEscape(getNavCategoryName(cat))}<span>${cat.items.length}</span></div>
                <div class="nav-more-items">${cat.items.map(item => renderNavItem(item, 'nav-more-item')).join('')}</div>
            </section>
        `).join('');
    menuEl.innerHTML = `
        <div class="nav-more-toolbar">
            <span class="nav-more-search-icon" aria-hidden="true">⌕</span>
            <input class="nav-more-search" id="navMoreSearch" type="search" autocomplete="off"
                placeholder="${navEscape(navT('nav.moreSearch'))}" aria-label="${navEscape(navT('nav.moreSearchLabel'))}">
            <kbd>Esc</kbd>
        </div>
        ${renderNavRecentSection(recentItems)}
        ${renderNavFavoriteSection(itemById)}
        <div class="nav-more-layout">
            <aside class="nav-more-sidebar" aria-label="${navEscape(navT('nav.more'))}">
                ${categoryButtons}
            </aside>
            <div class="nav-more-content">
                ${menuHtml || `<div class="nav-more-empty">${navEscape(navT('nav.empty'))}</div>`}
                <div class="nav-more-no-results" hidden>${navEscape(navT('nav.moreNoResults'))}</div>
            </div>
        </div>
    `;
    bindNavMoreInteractions();
    queueResponsiveNavbarUpdate();
}

function filterNavMoreItems(query = '') {
    const menu = document.getElementById('navMoreMenu');
    if (!menu) return;
    const trimmed = (query || '').trim();
    const recentBar = menu.querySelector('#navMoreRecent');
    let matchedRecentCount = 0;
    if (recentBar) {
        if (!trimmed) {
            recentBar.hidden = false;
            recentBar.querySelectorAll('.nav-more-recent-item').forEach(item => { item.hidden = false; });
        } else {
            recentBar.querySelectorAll('.nav-more-recent-item').forEach(item => {
                const matches = matchesNavSearch(item.dataset.navSearch, trimmed);
                item.hidden = !matches;
                if (matches) matchedRecentCount += 1;
            });
            recentBar.hidden = matchedRecentCount === 0;
        }
    }

    let visibleItemCount = 0;
    menu.querySelectorAll('.nav-more-category').forEach(category => {
        let categoryCount = 0;
        category.querySelectorAll('.nav-more-item').forEach(item => {
            const matches = matchesNavSearch(item.dataset.navSearch, trimmed);
            item.hidden = !matches;
            if (matches) categoryCount += 1;
        });
        category.hidden = categoryCount === 0;
        visibleItemCount += categoryCount;
        const categoryId = category.dataset.navCategory;
        const sidebarButton = menu.querySelector(`[data-nav-category-target="${CSS.escape(categoryId)}"]`);
        if (sidebarButton) sidebarButton.hidden = categoryCount === 0;
    });
    const noResults = menu.querySelector('.nav-more-no-results');
    if (noResults) noResults.hidden = (visibleItemCount !== 0 || matchedRecentCount !== 0);
}

function bindNavMoreInteractions() {
    const menu = document.getElementById('navMoreMenu');
    if (!menu) return;
    const content = menu.querySelector('.nav-more-content');
    const sidebar = menu.querySelector('.nav-more-sidebar');

    const searchInput = menu.querySelector('.nav-more-search');
    searchInput?.addEventListener('focus', () => { void ensureNavPinyinSearch(); });
    searchInput?.addEventListener('input', event => {
        filterNavMoreItems(event.target.value);
        if (!window.ToolsPinyinSearch) {
            ensureNavPinyinSearch().then(() => {
                if (window.ToolsPinyinSearch) filterNavMoreItems(searchInput.value);
            });
        }
    });

    let isClickScrolling = false;
    let clickScrollTimeout = null;

    function setActiveCategoryButton(targetId, shouldScrollSidebar = true) {
        const buttons = menu.querySelectorAll('.nav-more-category-btn');
        let activeButton = null;
        buttons.forEach(btn => {
            const isActive = btn.dataset.navCategoryTarget === targetId;
            btn.classList.toggle('active', isActive);
            if (isActive) activeButton = btn;
        });
        if (shouldScrollSidebar && activeButton && sidebar) {
            activeButton.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
    }

    menu.querySelectorAll('.nav-more-category-btn').forEach(button => {
        button.addEventListener('click', () => {
            const catId = button.dataset.navCategoryTarget;
            setActiveCategoryButton(catId, false);
            const target = menu.querySelector(`[data-nav-category="${CSS.escape(catId)}"]`);
            if (target && content) {
                isClickScrolling = true;
                clearTimeout(clickScrollTimeout);
                clickScrollTimeout = setTimeout(() => { isClickScrolling = false; }, 450);

                const contentRect = content.getBoundingClientRect();
                const targetRect = target.getBoundingClientRect();
                const targetScrollTop = content.scrollTop + (targetRect.top - contentRect.top);
                const scrollOffset = 16;
                content.scrollTo({ top: Math.max(0, targetScrollTop - scrollOffset), behavior: 'smooth' });
            }
        });
    });

    if (content) {
        let scrollRaf = null;
        content.addEventListener('scroll', () => {
            if (isClickScrolling) return;
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(() => {
                scrollRaf = null;
                if (isClickScrolling) return;

                const categories = Array.from(content.querySelectorAll('.nav-more-category:not([hidden])'));
                if (!categories.length) return;

                // 若已滚动到底部，直接高亮最后一个可见分类
                if (content.scrollTop + content.clientHeight >= content.scrollHeight - 10) {
                    const lastCat = categories[categories.length - 1];
                    if (lastCat) setActiveCategoryButton(lastCat.dataset.navCategory);
                    return;
                }

                const contentRect = content.getBoundingClientRect();
                // 判定线设在 content 可视区上方 40px 处，确保分类标题刚进入即精准识别
                const threshold = contentRect.top + 40;
                let currentCat = categories[0];

                for (const cat of categories) {
                    const rect = cat.getBoundingClientRect();
                    if (rect.top <= threshold) {
                        currentCat = cat;
                    } else {
                        break;
                    }
                }

                if (currentCat) {
                    setActiveCategoryButton(currentCat.dataset.navCategory);
                }
            });
        }, { passive: true });
    }
}

let navResponsiveRaf = null;

function queueResponsiveNavbarUpdate() {
    if (navResponsiveRaf) cancelAnimationFrame(navResponsiveRaf);
    navResponsiveRaf = requestAnimationFrame(updateResponsiveNavbar);
}

function isNavbarOverflowing(nav) {
    const primaryEl = nav.querySelector('.nav-links');
    const moreEl = document.getElementById('navMore');
    const actionsEl = nav.querySelector('.nav-actions');
    const statusEl = nav.querySelector('.nav-status');
    const rightEdge = actionsEl?.getBoundingClientRect?.().left || statusEl?.getBoundingClientRect?.().left || nav.getBoundingClientRect().right;
    const menuEdge = moreEl?.getBoundingClientRect?.().right || primaryEl?.getBoundingClientRect?.().right || 0;
    const visibleLinks = Array.from(primaryEl?.querySelectorAll('.nav-link:not(.nav-responsive-hidden)') || []);
    const lastLink = visibleLinks[visibleLinks.length - 1];
    const lastLinkEdge = lastLink?.getBoundingClientRect?.().right || 0;
    const moreLeft = moreEl?.getBoundingClientRect?.().left || Infinity;
    return nav.scrollWidth > nav.clientWidth + 1 || menuEdge > rightEdge - 8 || lastLinkEdge > moreLeft - 10;
}

function updateResponsiveNavbar() {
    navResponsiveRaf = null;
    const nav = document.getElementById('app-navbar');
    const primaryEl = nav?.querySelector('.nav-links');
    const menuEl = document.getElementById('navMoreMenu');
    if (!nav || !primaryEl || !menuEl) return;

    primaryEl.querySelectorAll('.nav-link.nav-responsive-hidden').forEach(link => {
        link.classList.remove('nav-responsive-hidden');
    });
    document.getElementById('navResponsiveCategory')?.remove();
    const links = Array.from(primaryEl.querySelectorAll('.nav-link'));
    // 手机宽度下主导航链接全部收进「更多工具」，避免与右侧按钮叠在一起
    const collapseAll = window.matchMedia('(max-width: 600px)').matches;
    if (!links.length || (!collapseAll && !isNavbarOverflowing(nav))) return;

    const nonActive = links.filter(link => !link.classList.contains('active')).reverse();
    const active = links.filter(link => link.classList.contains('active')).reverse();
    const candidates = [...nonActive, ...active];
    const collapsedIds = [];

    for (const link of candidates) {
        if (!collapseAll && !isNavbarOverflowing(nav)) break;
        link.classList.add('nav-responsive-hidden');
        const itemId = link.getAttribute('data-nav-item-id');
        if (itemId) collapsedIds.push(itemId);
    }

    if (!collapsedIds.length) return;

    const itemById = new Map((navState.currentPrimaryItems || []).map(item => [item.id, item]));
    const collapsedItems = collapsedIds
        .map(id => itemById.get(id))
        .filter(Boolean)
        .reverse();
    if (!collapsedItems.length) return;

    const category = document.createElement('div');
    category.className = 'nav-more-category nav-responsive-category';
    category.id = 'navResponsiveCategory';
    category.innerHTML = `
        <div class="nav-more-section-label">${navEscape(navT('nav.more'))}</div>
        <div class="nav-more-items">${collapsedItems.map(item => renderNavItem(item, 'nav-more-item nav-responsive-more-item')).join('')}</div>
    `;
    menuEl.querySelector('.nav-more-content')?.prepend(category);
}

async function loadNavigationData() {
    try {
        const [settings, tools] = await Promise.all([
            fetch('/api/nav-settings', { headers: getAuthHeaderForNav() }).then(res => res.ok ? res.json() : null),
            typeof API !== 'undefined'
                ? API.get('/api/custom-tools').catch(() => null)
                : fetch('/api/custom-tools', { headers: getAuthHeaderForNav() }).then(res => res.ok ? res.json() : null)
        ]);
        if (settings) navState.settings = normalizeNavSettings(settings);
        if (tools) navState.customTools = tools;
        if (settings || tools) writeNavigationBootstrapCache();
    } catch (e) {
        console.warn('[Navbar] load navigation data failed:', e);
    }
    notifyRequirementPageCategoriesChanged();
    renderNavLinksFromState();
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
        else if (typeof showNavbarNotice === 'function') await showNavbarNotice({ title: '切换失败', message: msg, tone: 'error' });
        return;
    }
    const previous = localStorage.getItem('tools_tenant_id') || 'default';
    if (previous !== tenantId) switchTenantBrowserState(previous, tenantId);
    localStorage.setItem('tools_tenant_id', tenantId);
    window.location.href = window.__TP_LOGIN_DESTINATION__ || './index.html';
}
if (typeof window !== 'undefined') window.switchNavTeam = switchNavTeam;
function activeTenantName() { return navState.settings?.platformName || 'Dragon Claw'; }

function renderNavbar() {
    const role = localStorage.getItem('tools_role');
    const isAdmin = role === 'admin';
    const isSuper = isAdmin && isNavSuperAdmin();
    const user = localStorage.getItem('tools_user');
    const en = window.ToolsI18n?.getLanguage?.() === 'en-US';
    const chipTier = isAdmin ? (isSuper ? 'is-super' : 'is-admin') : '';
    const chipRoleLabel = isAdmin ? (isSuper ? (en ? 'Super Admin' : '超级管理员') : (en ? 'Admin' : '管理员')) : '';

    // Hide all buttons that edit/add stuff if readonly
    if (role === 'readonly') {
        const style = document.createElement('style');
        style.textContent = `
            button[onclick^="openAdd"], button[onclick^="openGroupModal"], 
            button[onclick^="openWeightModal"], button[onclick^="save"],
            button[onclick^="delete"], button[onclick^="add"], button[onclick^="upload"],
            .btn-action, .manual-adjust-input { display: none !important; }
        `;
        document.head.appendChild(style);
    }

    const nav = document.createElement('nav');
    nav.id = 'app-navbar';
    nav.innerHTML = `
        <a href="/" class="nav-brand">
            <span class="brand-icon"><img src="./tp-static/frontend/assets/logo.png" alt="Dragon Claw" class="brand-logo-img" id="navBrandLogo"></span>
            <span class="brand-name">Dragon Claw</span>
        </a>
        <div class="nav-divider"></div>
        <div class="nav-links"></div>
        <div class="nav-more" id="navMore">
            <button type="button" class="nav-more-btn" id="navMoreBtn" aria-expanded="false" aria-controls="navMoreMenu" onclick="toggleNavMore(event)">${navEscape(navT('nav.more'))} ▾</button>
            <div class="nav-more-backdrop" aria-hidden="true"></div>
            <div class="nav-more-menu" id="navMoreMenu"></div>
        </div>
        <div style="flex:1"></div>
        
        <div class="nav-actions">
            <button type="button" class="nav-lang-toggle" onclick="toggleAppLanguage()" title="${navEscape(navT('nav.languageTitle'))}" aria-label="${navEscape(navT('nav.languageTitle'))}">
                <span class="nav-lang-icon">🌐</span>
                <span class="nav-lang-current">${window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'EN' : '中文'}</span>
            </button>
            <a href="/requirements" class="req-btn nav-action-link" title="${navEscape(navT('nav.requirements'))}"><span class="nav-action-icon">🎯</span><span class="nav-action-text">${navEscape(navT('nav.requirements'))}</span></a>
            <button type="button" class="nav-alert-btn" onclick="openAlertCenter()" title="${navEscape(navT('nav.alertCenterTitle'))}" aria-label="${navEscape(navT('nav.alertCenterTitle'))}">
                <span class="nav-action-icon">🔔</span>
                <span class="nav-action-text">${navEscape(navT('nav.alertCenter'))}</span>
                <span class="nav-alert-count" id="navAlertCount" hidden>0</span>
            </button>
            ${role ? `<button type="button" class="nav-gear-btn" onclick="openNavSettingsModal()" title="${navEscape(navT('nav.settings'))}" aria-label="${navEscape(navT('nav.settings'))}">
                <svg class="nav-gear-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1.03-1.55V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.55 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15z"></path>
                </svg>
            </button>` : ''}
            <span class="nav-user-chip${chipTier ? ` ${chipTier}` : ''}"><span class="nav-action-icon">${isSuper ? '👑' : (isAdmin ? '🛡️' : '👤')}</span><span class="nav-action-text">${navEscape(user || '未登录')}</span>${chipRoleLabel ? `<span class="nav-user-role">${navEscape(chipRoleLabel)}</span>` : ''}</span>
            <a href="#" class="nav-logout-link" onclick="doLogout()" title="${navEscape(navT('nav.logout'))}"><span class="nav-action-icon">↩</span><span class="nav-action-text">${navEscape(navT('nav.logout'))}</span></a>
        </div>

        <div class="nav-status" style="margin-left:20px; display:flex; align-items:center; gap:12px;">
            <div style="font-size:11px; color:#64748b; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; font-family:monospace; letter-spacing:0.5px;" id="nav-resource-version-display"></div>
            <button type="button" class="nav-server-status" onclick="openServiceStatusModal()" title="${navEscape(window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'View service status history' : '查看服务状态历史')}">
                <div class="status-dot"></div>
                <span id="server-status-text">${navEscape(navT('nav.online'))}</span>
            </button>
        </div>
    `;
    const existingNav = document.getElementById('app-navbar');
    if (existingNav) {
        existingNav.replaceWith(nav);
    } else {
        const container = document.getElementById('navbar-container');
        if (container) {
            container.appendChild(nav);
        } else if (document.body) {
            document.body.prepend(nav);
        }
    }

    // 显示平台发布版本（/api/app-version）；资源 ?v= 是服务端生成的内容哈希，不代表版本。
    const versionDisplay = document.getElementById('nav-resource-version-display');
    if (versionDisplay) {
        const getVersion = window.ToolsAppVersion?.get
            || (() => fetch('/api/app-version', { cache: 'no-store' }).then(res => (res.ok ? res.json() : null)).then(data => data?.version || '').catch(() => ''));
        getVersion().then(version => {
            if (version) versionDisplay.textContent = `v${version}${window.__TP_STATIC_BASE__ ? ' · ' + navLocaleText('在线测试版', 'Online test version') : ''}`;
        });
    }

    renderNavLinksFromState();
}

document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-nav-item-id]');
    if (link) {
        const itemId = link.getAttribute('data-nav-item-id');
        if (itemId) recordRecentNavTool(itemId);
    }
    if (window.parent === window
        && event.button === 0
        && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
        && typeof window.__dhIsDirty === 'function'
        && typeof window.__dhConfirmLeave === 'function'
        && window.__dhIsDirty()) {
        const navAnchor = event.target.closest('#app-navbar a[href], a.nav-brand[href], a[data-nav-item-id][href]');
        if (navAnchor && navAnchor.getAttribute('href') && navAnchor.getAttribute('href') !== '#') {
            const href = navAnchor.href;
            const target = navAnchor.getAttribute('target');
            if (!target || target === '_self') {
                event.preventDefault();
                event.stopImmediatePropagation();
                window.__dhConfirmLeave().then(ok => {
                    if (ok) location.href = href;
                });
            }
        }
    }
}, true);

window.refreshCustomToolNavLinks = loadNavigationData;

window.toggleAppLanguage = function () {
    if (window.ToolsI18n) window.ToolsI18n.toggleLanguage();
};

window.addEventListener('tools:languagechange', () => {
    registerNavbarI18n();
    const existingNav = document.getElementById('app-navbar');
    if (existingNav) existingNav.remove();
    renderNavbar();
    renderNavLinksFromState();

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

window.addEventListener('resize', queueResponsiveNavbarUpdate);

window.toggleNavMore = function (event) {
    event.preventDefault();
    event.stopPropagation();
    const more = document.getElementById('navMore');
    if (!more) return;
    const isOpening = !more.classList.contains('open');
    more.classList.toggle('open', isOpening);
    document.getElementById('navMoreBtn')?.setAttribute('aria-expanded', String(isOpening));
    if (isOpening) {
        refreshNavMoreRecent();
        const menu = document.getElementById('navMoreMenu');
        const buttonRect = document.getElementById('navMoreBtn')?.getBoundingClientRect();
        if (menu && buttonRect) {
            const panelWidth = menu.getBoundingClientRect().width;
            const left = Math.max(12, Math.min(buttonRect.left, window.innerWidth - panelWidth - 12));
            menu.style.left = `${left}px`;
        }
        const search = document.getElementById('navMoreSearch');
        if (search) {
            search.value = '';
            filterNavMoreItems('');
            setTimeout(() => search.focus(), 0);
        }
    }
};

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const more = document.getElementById('navMore');
    if (!more?.classList.contains('open')) return;
    more.classList.remove('open');
    document.getElementById('navMoreBtn')?.setAttribute('aria-expanded', 'false');
    document.getElementById('navMoreBtn')?.focus();
});

// 捕获阶段可绕过业务页面的 stopPropagation；透明遮罩还能覆盖 iframe 页面区域。
document.addEventListener('pointerdown', (event) => {
    const more = document.getElementById('navMore');
    const clickedMoreBackdrop = event.target instanceof Element && event.target.classList.contains('nav-more-backdrop');
    if (more && (clickedMoreBackdrop || !more.contains(event.target))) {
        more.classList.remove('open');
        document.getElementById('navMoreBtn')?.setAttribute('aria-expanded', 'false');
    }
}, true);

function scheduleNavSettingsSave() {
    renderNavLinksFromState();
    writeNavigationBootstrapCache();
    window.dispatchEvent(new Event('tools:nav-layout-change'));
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.saving');
    clearTimeout(navState.saveTimer);
    navState.saveTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/nav-settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaderForNav()
                },
                body: JSON.stringify(navState.settings)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            navState.settings = normalizeNavSettings(await res.json());
            writeNavigationBootstrapCache();
            window.dispatchEvent(new Event('tools:f12shortcutschange'));
            if (indicator) indicator.textContent = navT('nav.set.saved');
        } catch (e) {
            if (indicator) indicator.textContent = navT('nav.set.saveFail') + e.message;
        }
    }, 420);
}

function renderNavSettingsTabLabel(icon, label) {
    return `<span class="nav-settings-tab-icon" aria-hidden="true">${navEscape(icon)}</span><span class="nav-settings-tab-label">${navEscape(label)}</span>`;
}

function renderPageSettingsTabs() {
    // 「工具中台」页配置的是工具免密访问，属于超级管理员
    // 迁移状态、NetCare 数据探查依赖超级管理员专属接口
    return NAV_BUILTIN_LINKS.filter(item => !['home', 'storage', 'netcare-explorer'].includes(item.id) || isNavSuperAdmin()).map(item => `
        <button class="nav-settings-tab nav-settings-tab-page ${navState.settingsTab === `page:${item.id}` ? 'active' : ''}" data-tab="page:${navEscape(item.id)}" onclick="switchNavSettingsTab('page:${navEscape(item.id)}')">${renderNavSettingsTabLabel(item.icon, getNavLabel(item))}</button>
    `).join('');
}

function hasHomeSidebarMenu() {
    return Boolean(document.querySelector('#homeSidebar [data-v2-flyout="more"]'));
}

function isNavSidebarShortcut(href) {
    if (!href || href.startsWith('#')) return false;
    const clean = String(href).split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    return clean !== '/' && clean !== '/index.html';
}

function getPrimarySettingsTitle() {
    return navT(hasHomeSidebarMenu() ? 'nav.set.tab.sidebar' : 'nav.set.tab.primary');
}

function renderNavSettingsSidebar() {
    const sidebar = document.querySelector('.nav-settings-sidebar');
    if (!sidebar) return;
    const t = navState.settingsTab;
    const agentToolsTab = `<button class="nav-settings-tab ${t === 'agentTools' ? 'active' : ''}" data-tab="agentTools" onclick="switchNavSettingsTab('agentTools')">${renderNavSettingsTabLabel('🧰', navLocaleText('智能体工具', 'Agent tools'))}</button>`;
    const vaultTab = `<button class="nav-settings-tab ${t === 'vault' ? 'active' : ''}" data-tab="vault" onclick="switchNavSettingsTab('vault')">${renderNavSettingsTabLabel('🔐', navLocaleText('保险箱', 'Vault'))}</button>`;
    if (localStorage.getItem('tools_role') !== 'admin') {
        sidebar.innerHTML = agentToolsTab + vaultTab;
        syncNavSettingsMobileNav();
        return;
    }
    sidebar.innerHTML = `
        <div class="nav-settings-title">${navEscape(navT('nav.set.title'))}</div>
        <button class="nav-settings-tab ${t === 'primary' ? 'active' : ''}" data-tab="primary" onclick="switchNavSettingsTab('primary')">${renderNavSettingsTabLabel('🧭', getPrimarySettingsTitle())}</button>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'logo' ? 'active' : ''}" data-tab="logo" onclick="switchNavSettingsTab('logo')">${renderNavSettingsTabLabel('🏷️', navT('nav.set.tab.logo'))}</button>` : ''}
        <button class="nav-settings-tab ${t === 'categories' ? 'active' : ''}" data-tab="categories" onclick="switchNavSettingsTab('categories')">${renderNavSettingsTabLabel('🗂️', navT('nav.set.tab.categories'))}</button>
        <button class="nav-settings-tab ${t === 'items' ? 'active' : ''}" data-tab="items" onclick="switchNavSettingsTab('items')">${renderNavSettingsTabLabel('↕️', navT('nav.set.tab.items'))}</button>
        <button class="nav-settings-tab ${t === 'ai' ? 'active' : ''}" data-tab="ai" onclick="switchNavSettingsTab('ai')">${renderNavSettingsTabLabel('🤖', navT('nav.set.tab.ai'))}</button>
        ${agentToolsTab}
        ${vaultTab}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'channels' ? 'active' : ''}" data-tab="channels" onclick="switchNavSettingsTab('channels')">${renderNavSettingsTabLabel('🔌', navT('nav.set.tab.channels'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'desktopAgents' ? 'active' : ''}" data-tab="desktopAgents" onclick="switchNavSettingsTab('desktopAgents')">${renderNavSettingsTabLabel('🖥️', navLocaleText('桌面 Agent', 'Desktop Agents'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'update' ? 'active' : ''}" data-tab="update" onclick="switchNavSettingsTab('update')">${renderNavSettingsTabLabel('🔄', navT('nav.set.tab.update'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'backup' ? 'active' : ''}" data-tab="backup" onclick="switchNavSettingsTab('backup')">${renderNavSettingsTabLabel('💾', navT('nav.set.tab.backup'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'snapshotPublish' ? 'active' : ''}" data-tab="snapshotPublish" onclick="switchNavSettingsTab('snapshotPublish')">${renderNavSettingsTabLabel('📤', navT('nav.set.tab.snapshotPublish'))}</button>` : ''}
        <button class="nav-settings-tab ${t === 'initialize' ? 'active' : ''}" data-tab="initialize" onclick="switchNavSettingsTab('initialize')">${renderNavSettingsTabLabel('🌱', navT('nav.set.tab.initialize'))}</button>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'media' ? 'active' : ''}" data-tab="media" onclick="switchNavSettingsTab('media')">${renderNavSettingsTabLabel('🎬', navT('nav.set.tab.media'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'promotions' ? 'active' : ''}" data-tab="promotions" onclick="switchNavSettingsTab('promotions')">${renderNavSettingsTabLabel('📣', navT('nav.set.tab.promotions'))}</button>` : ''}
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'customBackup' ? 'active' : ''}" data-tab="customBackup" onclick="switchNavSettingsTab('customBackup')">${renderNavSettingsTabLabel('🧰', navT('nav.set.tab.customBackup'))}</button>` : ''}
        <button class="nav-settings-tab ${t === 'accounts' ? 'active' : ''}" data-tab="accounts" onclick="switchNavSettingsTab('accounts')">${renderNavSettingsTabLabel('👤', isNavSuperAdmin() ? navT('nav.set.tab.accounts') : navLocaleText('我的账号', 'My account'))}</button>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'security' ? 'active' : ''}" data-tab="security" onclick="switchNavSettingsTab('security')">${renderNavSettingsTabLabel('🛡️', navT('nav.set.tab.security'))}</button>` : ''}
        <div class="nav-settings-title nav-settings-section-title">${navEscape(navT('nav.set.tab.pages'))}</div>
        ${renderPageSettingsTabs()}
        <div class="nav-settings-section-title" aria-hidden="true"></div>
        ${isNavSuperAdmin() ? `<button class="nav-settings-tab ${t === 'page:f12-extension' ? 'active' : ''}" data-tab="page:f12-extension" onclick="switchNavSettingsTab('page:f12-extension')">${renderNavSettingsTabLabel('🧩', navT('nav.page.f12.title'))}</button>` : ''}
    `;
    syncNavSettingsMobileNav();
}

// 手机分类复用现有侧栏的标签与分组，避免维护第二套设置目录。
function syncNavSettingsMobileNav() {
    const select = document.getElementById('navSettingsMobileSection');
    const sidebar = document.querySelector('.nav-settings-sidebar');
    if (!select || !sidebar) return;
    select.replaceChildren();
    let group = null;
    for (const item of sidebar.children) {
        if (item.classList.contains('nav-settings-title') && item.textContent.trim()) {
            group = document.createElement('optgroup'); group.label = item.textContent.trim(); select.append(group);
        } else if (item.matches('button[data-tab]')) {
            const option = document.createElement('option'); option.value = item.dataset.tab;
            option.textContent = item.querySelector('.nav-settings-tab-label')?.textContent || item.textContent;
            (group || select).append(option);
        }
    }
    select.value = navState.settingsTab;
    select.setAttribute('aria-label', navLocaleText('设置分类', 'Settings category'));
    document.querySelector('.nav-settings-mobile-label').textContent = navT('nav.set.title');
}
let navSettingsViewportCleanup = null;
function bindNavSettingsViewport(modal) {
    navSettingsViewportCleanup?.();
    const viewport = window.visualViewport;
    const update = () => {
        if (window.innerWidth <= 860) {
            modal.style.setProperty('--nav-settings-viewport-h', `${Math.round(viewport?.height || window.innerHeight)}px`);
            modal.style.setProperty('--nav-settings-viewport-top', `${Math.round(viewport?.offsetTop || 0)}px`);
        } else {
            modal.style.removeProperty('--nav-settings-viewport-h'); modal.style.removeProperty('--nav-settings-viewport-top');
        }
    };
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update);
    navSettingsViewportCleanup = () => {
        window.removeEventListener('resize', update);
        viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
        navSettingsViewportCleanup = null;
    };
    update();
}

function openNavSettingsModal() {
    const role = localStorage.getItem('tools_role');
    if (!role) return;
    if (role !== 'admin' && navState.settingsTab !== 'vault') navState.settingsTab = 'agentTools';
    let modal = document.getElementById('navSettingsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'navSettingsModal';
        modal.className = 'nav-settings-modal';
        modal.innerHTML = `
            <div class="nav-settings-window" role="dialog" aria-modal="true" aria-labelledby="navSettingsHeading">
                <div class="nav-settings-mobile-nav"><label class="nav-settings-mobile-label" for="navSettingsMobileSection"></label><select id="navSettingsMobileSection" onchange="switchNavSettingsTab(this.value)"></select></div>
                <div class="nav-settings-sidebar"></div>
                <div class="nav-settings-main">
                    <button type="button" class="nav-settings-close" aria-label="${navEscape(navLocaleText('关闭设置', 'Close settings'))}" onclick="closeNavSettingsModal()">×</button>
                    <div class="nav-settings-head">
                        <div>
                            <div class="nav-settings-heading" id="navSettingsHeading"></div>
                            <div class="nav-settings-subtitle" id="navSettingsSubtitle"></div>
                        </div>
                        <div class="nav-settings-save-state" id="navSettingsSaveState">${navEscape(navT('nav.set.loaded'))}</div>
                    </div>
                    <div id="navSettingsContent"></div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', event => { if (event.target === modal) closeNavSettingsModal(); });
        modal.addEventListener('keydown', event => { if (event.key === 'Escape' && event.target.tagName !== 'SELECT') { event.stopPropagation(); closeNavSettingsModal(); } });
    }
    modal.style.display = 'flex';
    document.body.classList.add('nav-settings-open');
    bindNavSettingsViewport(modal);
    renderNavSettingsSidebar();
    return renderNavSettingsContent();
}

let chatModelSettingsReturnTarget = null;
function closeNavSettingsModal() {
    const modal = document.getElementById('navSettingsModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('nav-settings-open');
    navSettingsViewportCleanup?.();
    if (chatModelSettingsReturnTarget?.isConnected) chatModelSettingsReturnTarget.focus({ preventScroll: true });
    chatModelSettingsReturnTarget = null;
}

window.openNavSettingsModal = openNavSettingsModal;
window.openChatModelSettings = async function () {
    if (localStorage.getItem('tools_role') !== 'admin') return;
    chatModelSettingsReturnTarget = document.getElementById('dcModelBtn');
    navState.settingsTab = 'ai';
    navState.aiCategory = 'chat';
    navState.aiSelectedProfileId = null;
    await openNavSettingsModal();
    const field = document.getElementById('navAiModel');
    field?.scrollIntoView({ block: 'center' });
    field?.focus({ preventScroll: true });
};
window.closeNavSettingsModal = closeNavSettingsModal;

// 只有超级管理员能看到的平台级设置页
const NAV_SUPER_ONLY_SETTINGS_TABS = new Set(['logo', 'channels', 'desktopAgents', 'update', 'snapshotPublish', 'media', 'promotions', 'security', 'backup', 'customBackup', 'page:home', 'page:f12-extension', 'page:storage', 'page:netcare-explorer']);
window.switchNavSettingsTab = function (tab) {
    if (localStorage.getItem('tools_role') !== 'admin' && tab !== 'vault') tab = 'agentTools';
    if (tab === 'tenants') tab = 'accounts';
    if (NAV_SUPER_ONLY_SETTINGS_TABS.has(tab) && !isNavSuperAdmin()) tab = 'primary';
    navState.settingsTab = tab;
    const mobileSelect = document.getElementById('navSettingsMobileSection');
    if (mobileSelect) mobileSelect.value = tab;
    const settingsContent = document.getElementById('navSettingsContent');
    if (settingsContent) settingsContent.scrollTop = 0;
    document.querySelectorAll('.nav-settings-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    renderNavSettingsContent();
};

function getNavSettingsTitle() {
    if (navState.settingsTab === 'page:f12-extension') return navT('nav.page.f12.title');
    if (navState.settingsTab.startsWith('page:')) {
        const pageId = navState.settingsTab.slice(5);
        const item = NAV_BUILTIN_LINKS.find(link => link.id === pageId);
        return item ? navT('nav.set.pageConfig', { page: getNavLabel(item) }) : navT('nav.set.tab.pages');
    }
    if (navState.settingsTab === 'accounts') return isNavSuperAdmin() ? navT('nav.set.tab.accounts') : navLocaleText('我的账号', 'My account');
    if (navState.settingsTab === 'security') return navT('nav.set.tab.security');
    if (navState.settingsTab === 'ai') return navT('nav.set.tab.ai');
    if (navState.settingsTab === 'agentTools') return navLocaleText('智能体工具', 'Agent tools');
    if (navState.settingsTab === 'vault') return navLocaleText('保险箱', 'Vault');
    if (navState.settingsTab === 'desktopAgents') return navLocaleText('桌面 Agent', 'Desktop Agents');
    if (navState.settingsTab === 'channels') return navT('nav.set.tab.channels');
    if (navState.settingsTab === 'update') return navT('nav.set.tab.update');
    if (navState.settingsTab === 'backup') return navT('nav.set.tab.backup');
    if (navState.settingsTab === 'snapshotPublish') return navT('nav.set.tab.snapshotPublish');
    if (navState.settingsTab === 'initialize') return navT('nav.set.tab.initialize');
    if (navState.settingsTab === 'media') return navT('nav.set.tab.media');
    if (navState.settingsTab === 'promotions') return navT('nav.set.tab.promotions');
    if (navState.settingsTab === 'customBackup') return navT('nav.set.tab.customBackup');
    if (navState.settingsTab === 'categories') return navT('nav.set.tab.categories');
    if (navState.settingsTab === 'items') return navT('nav.set.tab.items');
    if (navState.settingsTab === 'logo') return navT('nav.set.tab.logo');
    return getPrimarySettingsTitle();
}

function getNavSettingsSubtitle() {
    if (navState.settingsTab === 'page:f12-extension') return navLocaleText('选择首页快捷下载插件及默认打包用途，修改后自动保存。', 'Choose home download shortcuts and default package targets. Changes save automatically.');
    if (navState.settingsTab.startsWith('page:')) {
        const pageId = navState.settingsTab.slice(5);
        if (pageId === 'report') return navT('nav.set.sub.report');
        if (pageId === 'duty-roster') return navLocaleText('夜间运维值班表服务端持久化及月报资料库互通说明。', 'Night operation duty roster server persistence and report library overview.');
        return navT('nav.set.sub.pageFallback');
    }
    if (navState.settingsTab === 'accounts') return navT('nav.set.sub.accounts');
    if (navState.settingsTab === 'security') return navT('nav.set.sub.security');
    if (navState.settingsTab === 'ai') return navT('nav.set.sub.ai');
    if (navState.settingsTab === 'agentTools') return navLocaleText('Dragon Claw 的 MCP 服务与工具清单：哪些工具常驻、哪些按需加载、占多少上下文、被调用了多少次。', 'Dragon Claw MCP servers and tool catalog: what is always loaded, what loads on demand, context cost and call counts.');
    if (navState.settingsTab === 'vault') return navLocaleText('只属于你的网站账号密码：Dragon 浏览器自动保存、自动填写并登录，AI 也能代你登录，但看不到密码。', 'Your own website logins: saved, filled and signed in automatically by the Dragon browser. The AI can sign in for you without seeing the password.');
    if (navState.settingsTab === 'desktopAgents') return navLocaleText('连接本机原生桌面会话，同步最近对话并在 Web 继续交流。', 'Sync recent native desktop sessions and continue them from the Web.');
    if (navState.settingsTab === 'channels') return navT('nav.set.sub.channels');
    if (navState.settingsTab === 'update') return navT('nav.set.sub.update');
    if (navState.settingsTab === 'backup') return navT('nav.set.sub.backup');
    if (navState.settingsTab === 'snapshotPublish') return navT('nav.set.sub.snapshotPublish');
    if (navState.settingsTab === 'initialize') return navT('nav.set.sub.initialize');
    if (navState.settingsTab === 'media') {
        const isEn = Boolean(navState.mediaOverviewCache?.enabled);
        const statusNote = isEn
            ? navLocaleText('【已启用】', ' [Enabled]')
            : navLocaleText('【未启用】', ' [Disabled]');
        return navT('nav.set.sub.media') + ' ' + statusNote;
    }
    if (navState.settingsTab === 'promotions') return navT('nav.set.sub.promotions');
    if (navState.settingsTab === 'customBackup') return navT('nav.set.sub.customBackup');
    const sidebar = hasHomeSidebarMenu();
    if (navState.settingsTab === 'categories') return navT(sidebar ? 'nav.set.sub.toolCategories' : 'nav.set.sub.categories');
    if (navState.settingsTab === 'items') return navT(sidebar ? 'nav.set.sub.toolOrder' : 'nav.set.sub.items');
    if (navState.settingsTab === 'logo') return navT('nav.set.sub.logo');
    return navT(sidebar ? 'nav.set.sub.sidebar' : 'nav.set.sub.primary');
}

// 全局设置各页签的渲染与操作（约占本文件一半）放在 shared/navbar-settings.js，首次打开设置时才加载：
// 19 个页面都引用 navbar.js，平时只需要导航本身。
let navSettingsPackPromise = null;
function ensureNavSettingsPack() {
    if (window.__navSettingsPackLoaded) return Promise.resolve();
    navSettingsPackPromise ||= loadNavLazyScript('./tp-static/frontend/js/shared/navbar-settings.js', navLocaleText('无法加载设置组件，请刷新后重试', 'Settings could not load. Refresh and try again'))
        .catch(error => { navSettingsPackPromise = null; throw error; });
    return navSettingsPackPromise;
}

async function renderNavSettingsContent() {
    const content = document.getElementById('navSettingsContent');
    const heading = document.getElementById('navSettingsHeading');
    const subtitle = document.getElementById('navSettingsSubtitle');
    if (!content) return;
    if (heading) heading.textContent = getNavSettingsTitle();
    if (subtitle) subtitle.textContent = getNavSettingsSubtitle();
    if (!window.__navSettingsPackLoaded) {
        content.innerHTML = `<div class="nav-settings-loading">${navEscape(navLocaleText('正在加载设置…', 'Loading settings…'))}</div>`;
        try {
            await ensureNavSettingsPack();
        } catch (error) {
            content.innerHTML = `<div class="nav-settings-loading">${navEscape(error.message)}</div>`;
            return;
        }
        // 加载期间可能切换了页签或关闭了弹窗：按当前状态重新渲染
        return renderNavSettingsContent();
    }

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator && (indicator.textContent === '已加载' || indicator.textContent === 'Loaded')) {
        indicator.textContent = navT('nav.set.loaded');
    }

    if (NAV_SUPER_ONLY_SETTINGS_TABS.has(navState.settingsTab) && !isNavSuperAdmin()) navState.settingsTab = 'primary';
    if (navState.settingsTab.startsWith('page:')) return renderPageSettings(content, navState.settingsTab.slice(5));
    if (navState.settingsTab === 'accounts') return renderAccountSettings(content);
    if (navState.settingsTab === 'security') return renderSecuritySettings(content);
    if (navState.settingsTab === 'ai') return renderAiSettings(content);
    if (navState.settingsTab === 'agentTools') return renderAgentToolsSettings(content);
    if (navState.settingsTab === 'vault') return renderVaultSettings(content);
    if (navState.settingsTab === 'desktopAgents') return renderDesktopAgentSettings(content);
    if (navState.settingsTab === 'channels') return renderChannelSettings(content);
    if (navState.settingsTab === 'update') return renderUpdaterSettings(content);
    if (navState.settingsTab === 'backup') return renderBackupSettings(content);
    if (navState.settingsTab === 'snapshotPublish') return renderSnapshotPublishSettings(content);
    if (navState.settingsTab === 'initialize') return renderInitializationSettings(content);
    if (navState.settingsTab === 'media') return renderMediaSettings(content);
    if (navState.settingsTab === 'promotions') return renderPromotionSettings(content);
    if (navState.settingsTab === 'customBackup') return renderCustomToolBackupSettings(content);
    if (navState.settingsTab === 'categories') return renderCategorySettings(content);
    if (navState.settingsTab === 'items') return renderItemCategorySettings(content);
    if (navState.settingsTab === 'logo') return renderLogoSettings(content);
    renderPrimarySettings(content);
}

// ============================================================
// 🎨 平台图标与品牌管理 (Platform Logo & Branding Settings)
// ============================================================
window._selectedLogoFile = null;

// 按需加载的设置脚本带上内容版本号：CDN 会给无版本号的脚本加数小时缓存，平台更新后仍拿到旧版
async function loadNavLazyScript(src, errorText) {
    let url = src;
    try {
        const res = await fetch(`/api/asset-version?path=${encodeURIComponent(src)}`, { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        if (data && data.version) url = `${src}?v=${encodeURIComponent(data.version)}`;
    } catch (_) { /* 拿不到版本号时按原地址加载 */ }
    await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(errorText));
        document.head.appendChild(script);
    });
}


const SNAPSHOT_API = '/api/department-reward-penalty/snapshot';
let snapshotProgressTimer = null;
let snapshotProgressJobId = '';
const snapshotText = (zh, en) => navLocaleText(zh, en);

async function snapshotApi(path, options = {}) {
    const response = await fetch(SNAPSHOT_API + path, {
        ...options,
        headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...getAuthHeaderForNav() }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
}

const SNAPSHOT_PREREQ_CACHE_KEY = 'tools_snapshot_prereq_cache';
const SNAPSHOT_PREREQ_TTL = 10 * 60 * 1000;

function getSnapshotConfigKey(settings) {
    if (!settings) {
        const remoteUrl = document.getElementById('snapshotRemoteUrl')?.value || '';
        const repoDir = document.getElementById('snapshotRepoDir')?.value || '';
        const branch = document.getElementById('snapshotBranch')?.value || '';
        return `${remoteUrl.trim()}::${repoDir.trim()}::${branch.trim()}`;
    }
    return `${(settings.remoteUrl || '').trim()}::${(settings.repoDir || '').trim()}::${(settings.branch || '').trim()}`;
}

function getSnapshotPrereqCache(configKey) {
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_PREREQ_CACHE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || !data.result || !data.checkedAt) return null;
        if (Date.now() - data.checkedAt > SNAPSHOT_PREREQ_TTL) return null;
        if (configKey && data.configKey !== configKey) return null;
        return data;
    } catch {
        return null;
    }
}

function setSnapshotPrereqCache(result, configKey) {
    try {
        sessionStorage.setItem(SNAPSHOT_PREREQ_CACHE_KEY, JSON.stringify({
            result,
            checkedAt: Date.now(),
            configKey: configKey || ''
        }));
    } catch (_) {}
}

let lastSnapshotPrereqResult = null;

function formatSnapshotPrereqHtml(result) {
    lastSnapshotPrereqResult = result;
    const isReady = result.gitFound && result.branchReady;
    const latencyHtml = result.latencyMs != null
        ? `<span class="snapshot-prereq-latency ${result.latencyMs > 1000 ? 'warn' : ''}">⚡ ${result.latencyMs}ms</span>`
        : '';
    const attemptText = result.attempts ? ` · ${snapshotText('尝试', 'Attempt')} ${result.attempts}/${result.maxAttempts || 10}` : '';
    return `<div><strong>${isReady ? navEscape(snapshotText('运行环境就绪', 'Environment ready')) : navEscape(snapshotText('运行前检查', 'Preflight check'))}${latencyHtml}</strong><p>${navEscape(result.message)}${attemptText}</p>${result.gitVersion ? `<small>${navEscape(result.gitVersion)}</small>` : ''}</div><div class="snapshot-prereq-actions">${!result.gitFound ? `<a href="https://git-scm.com/install/windows" target="_blank" rel="noopener noreferrer">${navEscape(snapshotText('Git 官方安装页', 'Official Git installer'))} ↗</a>` : ''}<a href="https://open.codehub.huawei.com/" target="_blank" rel="noopener noreferrer">${navEscape(snapshotText('打开 CodeHub · 查看右上角帮助中心', 'Open CodeHub · Help Center'))} ↗</a><button type="button" class="snapshot-prereq-log-btn" onclick="openSnapshotPrereqLogs()">${navEscape(snapshotText('详细检测日志', 'Detailed check logs'))}</button><button type="button" onclick="checkSnapshotPrerequisites({ force: true })">${navEscape(snapshotText('重新检测', 'Check again'))}</button></div>`;
}

let snapshotEstimateAbortController = null;

window.toggleSnapshotToolPassword = function (slug) {
    const enabled = document.getElementById('snapshotEncryptionEnabled_' + slug)?.checked;
    const row = document.getElementById('snapshotPasswordRow_' + slug);
    if (row) row.style.display = enabled ? '' : 'none';
};

window.toggleSnapshotToolPasswordVisibility = function (slug) {
    const input = document.getElementById('snapshotPassword_' + slug);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
};

window.toggleSnapshotPasswordInput = function () {
    window.toggleSnapshotToolPassword('department-reward-penalty');
};

window.toggleSnapshotPasswordVisibility = function () {
    window.toggleSnapshotToolPasswordVisibility('department-reward-penalty');
};

window.checkSnapshotPrerequisites = async function (options = {}) {
    const panel = document.getElementById('snapshotPrerequisites');
    if (!panel) return;
    const configKey = getSnapshotConfigKey(options.settings);
    if (!options.force) {
        const cached = getSnapshotPrereqCache(configKey);
        if (cached) {
            lastSnapshotPrereqResult = cached.result;
            panel.className = 'snapshot-prerequisites ' + (cached.result.gitFound && cached.result.branchReady ? 'ready' : 'attention');
            panel.innerHTML = formatSnapshotPrereqHtml(cached.result);
            return;
        }
    }
    panel.className = 'snapshot-prerequisites';
    panel.innerHTML = `<div><strong>${navEscape(snapshotText('正在检测 Git 与 CodeHub 连接…', 'Checking Git and CodeHub access…'))}</strong><p>${navEscape(snapshotText('正在探测本地 Git 环境与远端分支连通性（最多自动重试 10 次）…', 'Testing local Git and remote branch access (up to 10 retries)…'))}</p></div><div class="snapshot-prereq-actions">${lastSnapshotPrereqResult ? `<button type="button" class="snapshot-prereq-log-btn" onclick="openSnapshotPrereqLogs()">${navEscape(snapshotText('查看上次日志', 'View last logs'))}</button>` : ''}</div>`;
    try {
        const result = await snapshotApi('/prerequisites');
        if (!panel.isConnected) return;
        lastSnapshotPrereqResult = result;
        setSnapshotPrereqCache(result, configKey);
        panel.classList.add(result.gitFound && result.branchReady ? 'ready' : 'attention');
        panel.innerHTML = formatSnapshotPrereqHtml(result);
        const modal = document.getElementById('snapshotPrereqLogModal');
        if (modal && !modal.hidden) {
            renderSnapshotPrereqLogs(result);
        }
    } catch (error) {
        panel.classList.add('attention');
        panel.textContent = snapshotText('环境检测失败：', 'Preflight failed: ') + error.message;
    }
};

window.openSnapshotPrereqLogs = function () {
    let modal = document.getElementById('snapshotPrereqLogModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'snapshotPrereqLogModal';
        modal.className = 'snapshot-progress-overlay';
        modal.innerHTML = `
            <section class="snapshot-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshotPrereqLogTitle">
                <button type="button" class="snapshot-progress-close" aria-label="Close" onclick="closeSnapshotPrereqLogs()">×</button>
                <div class="snapshot-progress-eyebrow">GIT &amp; CODEHUB PREFLIGHT CHECK</div>
                <h2 id="snapshotPrereqLogTitle">${navEscape(snapshotText('连接检测详情', 'Connection Check Details'))}</h2>
                <p id="snapshotPrereqLogDetail"></p>
                <div id="snapshotPrereqLogMeta" class="snapshot-progress-meta"></div>
                <div class="snapshot-progress-logs-section">
                    <div class="snapshot-progress-logs-head">
                        <span><strong>${navEscape(snapshotText('详细执行与探测日志', 'Detailed Diagnostic Logs'))}</strong></span>
                        <div style="display: flex; gap: 8px;">
                            <button type="button" class="snapshot-progress-log-btn" onclick="checkSnapshotPrerequisites({ force: true })">${navEscape(snapshotText('重新检测', 'Re-check'))}</button>
                            <button type="button" class="snapshot-progress-log-btn" onclick="copySnapshotPrereqLogs()">${navEscape(snapshotText('复制日志', 'Copy Logs'))}</button>
                        </div>
                    </div>
                    <div id="snapshotPrereqTerminal" class="snapshot-progress-terminal" role="region" aria-label="Preflight check logs"></div>
                </div>
                <div style="margin-top: 16px; display: flex; justify-content: flex-end;">
                    <button type="button" class="snapshot-progress-log-btn" style="padding: 8px 16px; font-size: 12px; font-weight: 700;" onclick="closeSnapshotPrereqLogs()">${navEscape(snapshotText('关闭', 'Close'))}</button>
                </div>
            </section>
        `;
        document.body.appendChild(modal);
    }
    modal.hidden = false;
    const result = lastSnapshotPrereqResult || getSnapshotPrereqCache(getSnapshotConfigKey())?.result;
    if (result) {
        renderSnapshotPrereqLogs(result);
    } else {
        checkSnapshotPrerequisites({ force: true });
    }
};

window.closeSnapshotPrereqLogs = function () {
    const modal = document.getElementById('snapshotPrereqLogModal');
    if (modal) modal.hidden = true;
};

function renderSnapshotPrereqLogs(result) {
    const modal = document.getElementById('snapshotPrereqLogModal');
    if (!modal) return;
    const isReady = result.gitFound && result.branchReady;
    modal.querySelector('#snapshotPrereqLogTitle').textContent = isReady
        ? snapshotText('运行环境就绪', 'Environment Ready')
        : snapshotText('环境检测未完成', 'Check Incomplete');
    modal.querySelector('#snapshotPrereqLogDetail').textContent = result.message || '';
    const metaParts = [];
    if (result.gitVersion) metaParts.push(result.gitVersion);
    if (result.latencyMs != null) metaParts.push(snapshotText(`往返延迟: ${result.latencyMs}ms`, `Latency: ${result.latencyMs}ms`));
    if (result.attempts != null) metaParts.push(snapshotText(`尝试次数: ${result.attempts}/${result.maxAttempts || 10}`, `Attempts: ${result.attempts}/${result.maxAttempts || 10}`));
    if (result.branch) metaParts.push(snapshotText(`目标分支: ${result.branch}`, `Branch: ${result.branch}`));
    modal.querySelector('#snapshotPrereqLogMeta').textContent = metaParts.join(' · ');

    const terminal = modal.querySelector('#snapshotPrereqTerminal');
    if (!terminal) return;
    const logs = Array.isArray(result.logs) ? result.logs : [];
    if (!logs.length) {
        terminal.innerHTML = `<div class="snapshot-terminal-item info"><span class="snapshot-terminal-msg">${navEscape(snapshotText('暂无详细日志。可点击“重新检测”立即执行实时探测。', 'No logs available. Click Re-check to run diagnostic.'))}</span></div>`;
        terminal.dataset.copyText = result.message || '';
        return;
    }

    const copyLines = [];
    terminal.innerHTML = logs.map(l => {
        const timeStr = l.at ? new Date(l.at).toLocaleTimeString() : '';
        const durStr = l.latencyMs != null ? `${l.latencyMs}ms` : '';
        const lineText = `[${timeStr}] [${l.stage}]${durStr ? ' (' + durStr + ')' : ''} ${l.msg}${l.cmd ? ' | $ ' + l.cmd : ''}`;
        copyLines.push(lineText);
        return `<div class="snapshot-terminal-item ${navEscape(l.type || 'info')}">` +
            `<div class="snapshot-terminal-cmd-row">` +
                `<span class="snapshot-terminal-time">${navEscape(timeStr)}</span>` +
                `<span class="snapshot-terminal-badge" style="font-size: 10px; background: rgba(255,255,255,0.1); padding: 1px 5px; border-radius: 3px; margin-right: 6px;">[${navEscape(l.stage)}]</span>` +
                (l.cmd ? `<span class="snapshot-terminal-cmd" style="margin-right: 6px; color: #7dd3fc;">$ ${navEscape(l.cmd)}</span>` : '') +
                `<span class="snapshot-terminal-msg">${navEscape(l.msg)}</span>` +
                (durStr ? `<span class="snapshot-terminal-duration" style="margin-left: auto;">${navEscape(durStr)}</span>` : '') +
            `</div>` +
        `</div>`;
    }).join('');
    terminal.dataset.copyText = copyLines.join('\n');
}

window.copySnapshotPrereqLogs = async function () {
    const terminal = document.getElementById('snapshotPrereqTerminal');
    const button = document.querySelector('#snapshotPrereqLogModal .snapshot-progress-log-btn:last-child');
    if (!terminal) return;
    const text = terminal.dataset.copyText || terminal.textContent.trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    }
};

window.saveSnapshotPublishSettings = async function (options = {}) {
    const button = document.querySelector('.snapshot-actions button');
    const indicator = document.getElementById('navSettingsSaveState');
    if (button) button.disabled = true;
    if (indicator && !options.silent) indicator.textContent = snapshotText('正在保存…', 'Saving…');
    const toolsList = [];
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(el => {
        const slug = el.dataset.toolSlug;
        if (el.dataset.estimateState !== 'ready') {
            if (document.getElementById('snapshotToolPublic_' + slug)) toolsList.push({ toolSlug: slug, publicAccess: document.getElementById('snapshotToolPublic_' + slug).checked });
            return;
        }
        const en = document.getElementById('snapshotToolEnabled_' + slug)?.checked !== false;
        toolsList.push({ toolSlug: slug, enabled: en, ...(document.getElementById('snapshotToolPublic_' + slug) ? { publicAccess: document.getElementById('snapshotToolPublic_' + slug).checked } : {}) });
    });
    const newSettings = {
        remoteUrl: document.getElementById('snapshotRemoteUrl').value,
        repoDir: document.getElementById('snapshotRepoDir').value,
        branch: document.getElementById('snapshotBranch').value,
        file: document.getElementById('snapshotFile').value,
        publishMode: document.getElementById('snapshotPublishMode').value,
        scheduleEnabled: document.getElementById('snapshotScheduleEnabled').checked,
        intervalMinutes: Number(document.getElementById('snapshotIntervalMinutes').value),
        tools: toolsList
    };
    try {
        const saved = await snapshotApi('/settings', { method: 'PUT', body: JSON.stringify(newSettings) });
        if (indicator) indicator.textContent = snapshotText('推送配置已保存', 'Destination saved');
        (saved.tools || []).forEach(t => {
            const pwdInput = document.getElementById('snapshotPassword_' + t.toolSlug);
            if (pwdInput) {
                pwdInput.value = '';
                if (t.hasPassword) {
                    pwdInput.placeholder = snapshotText('留空表示保持当前已设置的密码', 'Leave blank to keep existing password');
                }
            }
        });
        if (!options.skipPrereq) {
            checkSnapshotPrerequisites({ force: true, settings: newSettings });
        }
        return { ok: true, saved };
    } catch (error) {
        if (indicator) indicator.textContent = snapshotText('保存失败：', 'Save failed: ') + error.message;
        return { ok: false, error: error.message };
    } finally { if (button) button.disabled = false; }
};

window.startSnapshotPublish = async function (options = {}) {
    window.snapshotLastPublishOptions = Object.assign({}, options);
    if (document.getElementById('navSettingsModal')?.style.display === 'flex'
        && document.getElementById('snapshotBranch') && document.getElementById('snapshotFile')) {
        const saveRes = await window.saveSnapshotPublishSettings({ silent: true, skipPrereq: true });
        if (saveRes && !saveRes.ok) {
            showNavbarNotice({ title: navT('nav.dialog.error'), message: snapshotText('保存推送配置失败，无法启动推送：', 'Failed to save snapshot settings before publish: ') + saveRes.error, tone: 'error' });
            return;
        }
    }
    const isForce = Boolean(options.force);
    const sizeNotice = snapshotText(' 大工具在全量与定时推送中自动跳过；只有单工具的强制推送才可更新，已发布版本保留。', ' Large tools are skipped in bulk and scheduled runs; only per-tool Force publish updates them. Published versions are retained.');
    const selectedTool = options.toolSlug ? (options.toolName || options.toolSlug) : '';
    const confirmed = await showNavbarConfirm({
        title: isForce
            ? snapshotText('确认强制重新发布快照', 'Force republish snapshot?')
            : snapshotText('确认发布只读快照', 'Publish read-only snapshot?'),
        message: (isForce
            ? snapshotText(`${selectedTool ? `仅针对「${selectedTool}」，` : '本次还会清理远端已发布但现已取消勾选的工具。'}即使文件未发生变化，本次也将强制创建 Git 提交并推送到远端仓库，以触发静态托管平台（Pages）的重新构建与部署。`, `${selectedTool ? `For ${selectedTool}, ` : 'Previously published tools that are now unchecked will also be removed from the remote. '}this will create a Git commit and push to remote even when files have not changed, triggering a Pages redeploy.`)
            : selectedTool
                ? snapshotText(`本次将根据已保存配置生成「${selectedTool}」的只读快照，并推送到目标仓库。`, `This will publish a read-only snapshot of ${selectedTool} using the saved destination settings.`)
                : snapshotText('本次将生成并推送各已启用工具的只读快照，同时从远端删除已发布但现已取消勾选的工具页面及受管理资源。请确认目标仓库及 Pages 的访问权限。', 'This will publish read-only snapshots of enabled tools and remove previously published, now unchecked tools and their managed assets from the remote. Confirm repository and Pages access first.')) + sizeNotice,
        confirmText: isForce ? snapshotText('强制推送', 'Force publish') : snapshotText('生成并推送', 'Generate & publish'),
        cancelText: snapshotText('取消', 'Cancel')
    });
    if (!confirmed) return;
    try {
        const job = await snapshotApi('/publish', { method: 'POST', body: JSON.stringify(options) });
        openSnapshotPublishProgress(job.id);
    } catch (error) {
        openSnapshotPublishProgress(null, error.message);
    }
};

window.retrySnapshotPublish = function () {
    const opts = window.snapshotLastPublishOptions || {};
    window.startSnapshotPublish(opts);
};

window.openSnapshotPublishProgress = function (jobId, initialError = '') {
    let modal = document.getElementById('snapshotProgressModal');
    if (!modal) {
        modal = document.createElement('div'); modal.id = 'snapshotProgressModal'; modal.className = 'snapshot-progress-overlay';
        modal.innerHTML = `<section class="snapshot-progress-dialog" role="dialog" aria-modal="true" aria-labelledby="snapshotProgressTitle"><button type="button" class="snapshot-progress-close" aria-label="Close" onclick="closeSnapshotPublishProgress()">×</button><div class="snapshot-progress-eyebrow">PUBLISHING WORKFLOW</div><h2 id="snapshotProgressTitle"></h2><p id="snapshotProgressDetail"></p><div class="snapshot-progress-bar"><i id="snapshotProgressFill"></i></div><div id="snapshotProgressMeta" class="snapshot-progress-meta"></div><div id="snapshotProgressFailureArea" class="snapshot-progress-failure-bar" style="display:none"></div><div id="snapshotProgressEntries" class="snapshot-progress-entries" aria-live="polite"></div><div class="snapshot-progress-logs-section"><div class="snapshot-progress-logs-head"><span><strong>${navEscape(snapshotText('详细执行日志', 'Detailed Execution Logs'))}</strong></span><button type="button" class="snapshot-progress-log-btn" onclick="copySnapshotPublishLogs()">${navEscape(snapshotText('复制日志', 'Copy Logs'))}</button></div><div id="snapshotProgressTerminal" class="snapshot-progress-terminal" role="region" aria-label="Detailed logs"></div></div><button type="button" class="snapshot-config-shortcut" onclick="closeSnapshotPublishProgress(); navState.settingsTab='snapshotPublish'; openNavSettingsModal()">${navEscape(snapshotText('查看推送配置与历史', 'View destination & history'))} ↗</button></section>`;
        document.body.appendChild(modal);
    }
    modal.hidden = false;
    snapshotProgressJobId = jobId || '';
    clearTimeout(snapshotProgressTimer);
    if (initialError) { renderSnapshotProgress({ status: 'failed', stage: snapshotText('无法启动推送', 'Could not start'), progress: 0, entries: [{ at: new Date().toISOString(), stage: snapshotText('启动失败', 'Start Error'), message: initialError }] }); return; }
    pollSnapshotProgress();
};

window.closeSnapshotPublishProgress = function () {
    const modal = document.getElementById('snapshotProgressModal');
    if (modal) modal.hidden = true;
    clearTimeout(snapshotProgressTimer);
};

window.copySnapshotPublishLogs = async function () {
    const terminal = document.getElementById('snapshotProgressTerminal');
    const button = document.querySelector('.snapshot-progress-log-btn');
    if (!terminal) return;
    const text = terminal.dataset.copyText || terminal.textContent.trim();
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (button) {
            const orig = button.textContent;
            button.textContent = snapshotText('已复制 ✓', 'Copied ✓');
            setTimeout(() => { button.textContent = orig; }, 2000);
        }
    }
};

function renderSnapshotProgress(job) {
    const modal = document.getElementById('snapshotProgressModal');
    if (!modal || modal.hidden) return;
    modal.querySelector('#snapshotProgressTitle').textContent = job.status === 'success' ? snapshotText('推送完成', 'Published') : job.status === 'failed' || job.status === 'interrupted' ? snapshotText('推送未完成', 'Publishing incomplete') : snapshotText('正在推送只读页面', 'Publishing read-only page');
    modal.querySelector('#snapshotProgressDetail').textContent = job.stage;
    modal.querySelector('#snapshotProgressFill').style.width = `${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`;
    modal.querySelector('#snapshotProgressFill').className = job.status;
    modal.querySelector('#snapshotProgressMeta').textContent = `${job.progress || 0}%${job.commit ? ' · ' + job.commit.slice(0, 12) : ''}`;
    const failureArea = modal.querySelector('#snapshotProgressFailureArea');
    if (failureArea) {
        if (job.status === 'failed' || job.status === 'interrupted') {
            failureArea.style.display = 'flex';
            const lastEntry = (job.entries && job.entries.length ? job.entries[job.entries.length - 1].message : '') || job.stage;
            let tip = snapshotText('建议：点击右侧“重新尝试推送”再次执行；或在全局设置中配置“本地 Git 镜像仓库”提升克隆与检查速度。', 'Tip: Click Retry Publishing on the right to try again, or configure a local mirror repository in Settings.');
            if (/体积|大小|MiB|大工具|大载荷|大文件/.test(lastEntry)) {
                tip = snapshotText('体积限制无法通过重试绕过。大工具请从自身顶部选择强制推送；业务载荷会自动分片加密。公共资源超限或远端历史含大文件时，请按日志处理。', 'Retry cannot bypass size limits. Use per-tool Force publish; business payloads are encrypted in chunks. Check logs for oversized public assets or old Git objects.');
            } else if (/文件暂存|检查变更|索引|超长|大量/i.test(lastEntry) || job.stage === '检查变更') {
                tip = snapshotText('单步提示：本次生成的工具快照包含大量文件（如多媒体或离线数据）。系统已自动放宽超时限制，可直接点击重试；若只需更新单个工具，可在该工具页面使用“独立推送”。', 'Step hint: Large number of files generated. Timeout has been extended; click Retry, or push this tool individually from its own page.');
            } else if (/网络|连接|超时|codehub|fetch|clone|push|远程/i.test(lastEntry) || /获取分支|推送远端/i.test(job.stage)) {
                tip = snapshotText('单步提示：与内网 CodeHub 连接缓慢或网络波动。系统已开启自动重试，建议确认内网 VPN 连接正常；若仓库较大，建议在设置中配置“本地 Git 镜像仓库”。', 'Step hint: CodeHub connection slow. Ensure VPN connection is active, or configure a local mirror repository.');
            }
            failureArea.innerHTML = `
                <div class="snapshot-failure-content">
                    <div class="snapshot-failure-msg"><strong>${navEscape(snapshotText('推送遇阻', 'Publishing Blocked'))}：</strong>${navEscape(lastEntry)}</div>
                    <div class="snapshot-failure-tip">${navEscape(tip)}</div>
                </div>
                <button type="button" class="snapshot-retry-btn" onclick="retrySnapshotPublish()">
                    🔄 ${navEscape(snapshotText('重新尝试推送', 'Retry Publishing'))}
                </button>
            `;
        } else {
            failureArea.style.display = 'none';
            failureArea.innerHTML = '';
        }
    }
    modal.querySelector('#snapshotProgressEntries').innerHTML = (job.entries || []).map(entry => `<div class="snapshot-progress-entry"><time>${navEscape(new Date(entry.at).toLocaleTimeString())}</time><span>${navEscape(entry.message)}</span></div>`).join('');
    const terminal = modal.querySelector('#snapshotProgressTerminal');
    if (terminal) {
        const commandLogs = job.commandLogs && job.commandLogs.length ? job.commandLogs : null;
        if (commandLogs) {
            const copyLines = [];
            terminal.innerHTML = commandLogs.map(log => {
                const timeStr = log.at ? new Date(log.at).toLocaleTimeString() : '';
                if (log.cmd) {
                    const durStr = log.durationMs != null ? `${(log.durationMs / 1000).toFixed(1)}s` : '';
                    copyLines.push(`[${timeStr}] $ ${log.cmd}${durStr ? ' (' + durStr + ')' : ''}${log.output ? '\n' + log.output : ''}`);
                    return `<div class="snapshot-terminal-item snapshot-terminal-cmd-block ${log.failed ? 'error' : ''}">` +
                        `<div class="snapshot-terminal-cmd-row">` +
                            `<span class="snapshot-terminal-time">${navEscape(timeStr)}</span>` +
                            `<span class="snapshot-terminal-prompt">$</span>` +
                            `<span class="snapshot-terminal-cmd">${navEscape(log.cmd)}</span>` +
                            (durStr ? `<span class="snapshot-terminal-duration">${navEscape(durStr)}</span>` : '') +
                        `</div>` +
                        (log.output ? `<pre class="snapshot-terminal-out">${navEscape(log.output)}</pre>` : '') +
                    `</div>`;
                }
                const msg = log.msg || '';
                copyLines.push(`[${timeStr}] [INFO] ${msg}`);
                return `<div class="snapshot-terminal-item snapshot-terminal-info-row">` +
                    `<span class="snapshot-terminal-time">${navEscape(timeStr)}</span>` +
                    `<span class="snapshot-terminal-info-tag">ℹ</span>` +
                    `<span class="snapshot-terminal-info-text">${navEscape(msg)}</span>` +
                `</div>`;
            }).join('');
            terminal.dataset.copyText = copyLines.join('\n');
            terminal.scrollTop = terminal.scrollHeight;
        } else {
            const entries = job.entries || [];
            if (!entries.length) {
                terminal.innerHTML = `<div class="snapshot-terminal-empty">${navEscape(snapshotText('等待日志输出…', 'Waiting for logs…'))}</div>`;
                terminal.dataset.copyText = '';
            } else {
                const copyLines = [];
                terminal.innerHTML = entries.map((entry, idx) => {
                    const isError = (job.status === 'failed' || job.status === 'interrupted') && idx === entries.length - 1;
                    const timeStr = new Date(entry.at).toLocaleTimeString();
                    const stageTag = entry.stage ? `[${entry.stage}] ` : '';
                    copyLines.push(`[${timeStr}] ${stageTag}${entry.message || ''}`);
                    return `<div class="snapshot-terminal-line ${isError ? 'error' : ''}"><span class="snapshot-terminal-time">${navEscape(timeStr)}</span><span class="snapshot-terminal-stage">${navEscape(stageTag)}</span><span class="snapshot-terminal-msg">${navEscape(entry.message)}</span></div>`;
                }).join('');
                terminal.dataset.copyText = copyLines.join('\n');
                terminal.scrollTop = terminal.scrollHeight;
            }
        }
    }
}

async function pollSnapshotProgress() {
    const id = snapshotProgressJobId;
    if (!id || document.getElementById('snapshotProgressModal')?.hidden) return;
    try {
        const job = await snapshotApi('/jobs/' + encodeURIComponent(id));
        if (snapshotProgressJobId !== id) return;
        renderSnapshotProgress(job);
        if (job.status === 'running') snapshotProgressTimer = setTimeout(pollSnapshotProgress, 1400);
        else {
            if (job.status === 'success') {
                const cached = getSnapshotPrereqCache();
                if (cached) {
                    cached.checkedAt = Date.now();
                    sessionStorage.setItem(SNAPSHOT_PREREQ_CACHE_KEY, JSON.stringify(cached));
                }
            }
            if (navState.settingsTab === 'snapshotPublish' && document.getElementById('navSettingsModal')?.style.display === 'flex') renderSnapshotPublishSettings(document.getElementById('navSettingsContent'));
        }
    } catch (error) {
        renderSnapshotProgress({ status: 'failed', stage: snapshotText('读取进度失败', 'Could not read progress'), progress: 0, entries: [{ at: new Date().toISOString(), stage: snapshotText('网络错误', 'Network Error'), message: error.message }] });
    }
}

function customToolBackupText(key, values = {}) {
    let text = navT(key);
    Object.entries(values).forEach(([name, value]) => {
        text = text.replaceAll(`{${name}}`, String(value));
    });
    return text;
}

function updateCustomToolBackupSelectionSummary() {
    const boxes = Array.from(document.querySelectorAll('[data-custom-backup-slug]'));
    const selected = boxes.filter(box => box.checked).length;
    const summary = document.getElementById('customToolBackupSelectionSummary');
    if (summary) summary.textContent = customToolBackupText('nav.ctbk.selected', { selected, total: boxes.length });
}

// ============================================================
// 🎬 媒体资源管理中心 (Media Resource Management)
// ============================================================
navState.mediaCategoryFilter = 'all';
navState.mediaSearchQuery = '';
navState.mediaVideosCache = [];
navState.mediaCategoriesCache = [];
navState.mediaOverviewCache = null;
navState.mediaSearchTimer = null;

window.closeMediaPreview = function () {
    const modal = document.getElementById('mediaPreviewModal');
    if (!modal) return;
    modal.querySelector('video')?.pause();
    modal.style.display = 'none';
    document.querySelector('.nav-settings-tab[data-tab="media"]')?.focus();
};

document.addEventListener('keydown', event => {
    const modal = document.getElementById('mediaPreviewModal');
    if (event.key === 'Escape' && modal?.style.display === 'flex') closeMediaPreview();
});

window.updateCustomToolBackupSelectionSummary = updateCustomToolBackupSelectionSummary;

let backupConsolePollTimer = null;
let backupConsoleSeenEntries = 0;

function formatAlertTime(value) {
    if (!value) return '-';
    const raw = String(value).trim();
    // SQLite CURRENT_TIMESTAMP is UTC but omits the timezone suffix.
    // Mark timezone-less database timestamps as UTC before formatting with
    // local Date getters, so each browser sees its own local time.
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
        ? `${raw.replace(' ', 'T')}Z`
        : raw;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return value || '-';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function alertTypeLabel(type) {
    if (type === 'config') return navT('nav.alert.config');
    if (type === 'security') return navT('nav.alert.security');
    if (type === 'user_action') return navT('nav.alert.userAction');
    if (type === 'alert') return navT('nav.alertCenter');
    return navT('nav.alert.system');
}

function severityLabel(severity) {
    return ({ info: 'Info', warn: 'Warn', error: 'Error', critical: 'Critical' })[severity] || 'Info';
}

async function fetchAlertCenterSummary() {
    const res = await fetch('/api/alert-center/summary', { headers: getAuthHeaderForNav() });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function fetchAlertCenterEvents(filter = navState.alertCenter.filter) {
    const params = new URLSearchParams({ limit: '120' });
    if (filter === 'unread') params.set('status', 'unread');
    if (filter === 'config') params.set('type', 'config');
    if (filter === 'security') params.set('type', 'security');
    if (filter === 'user_action') params.set('type', 'user_action');
    if (filter === 'system') params.set('type', 'system');
    const res = await fetch(`/api/alert-center/events?${params.toString()}`, { headers: getAuthHeaderForNav() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const events = data.events || [];
    return filter === 'warn'
        ? events.filter(event => ['warn', 'error', 'critical'].includes(event.severity))
        : events;
}

function updateAlertCenterBadge(summary = navState.alertCenter.summary) {
    const badge = document.getElementById('navAlertCount');
    const button = document.querySelector('.nav-alert-btn');
    if (!badge || !button) return;
    const unread = Number(summary && summary.unread) || 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread <= 0;
    button.classList.toggle('has-alerts', unread > 0);
}

function ensureNavbarConfirmDialog() {
    let modal = document.getElementById('navbarConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'navbarConfirmModal';
    modal.className = 'nav-confirm-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="nav-confirm-backdrop" onclick="resolveNavbarConfirm(false)"></div>
        <section class="nav-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="navbarConfirmTitle" aria-describedby="navbarConfirmMessage navbarConfirmHint">
            <div class="nav-confirm-icon" aria-hidden="true">!</div>
            <div class="nav-confirm-copy">
                <span class="nav-confirm-eyebrow"></span>
                <h3 id="navbarConfirmTitle"></h3>
                <p id="navbarConfirmMessage"></p>
                <div class="nav-confirm-hint" id="navbarConfirmHint"></div>
            </div>
            <div class="nav-confirm-actions">
                <button type="button" class="nav-confirm-cancel" onclick="resolveNavbarConfirm(false)"></button>
                <button type="button" class="nav-confirm-submit" onclick="resolveNavbarConfirm(true)"></button>
            </div>
        </section>
    `;
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.resolveNavbarConfirm(false);
        }
    });
    document.body.appendChild(modal);
    return modal;
}

function showNavbarConfirm({ title, message, hint, cancelText, confirmText, eyebrow, icon, tone = 'warning', notice = false }) {
    const modal = ensureNavbarConfirmDialog();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
        fsEl.appendChild(modal);
    } else if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    if (navConfirmResolver) {
        navConfirmResolver(false);
        navConfirmResolver = null;
    }
    navDialogPreviousFocus = document.activeElement;
    modal.dataset.tone = tone;
    modal.querySelector('.nav-confirm-icon').textContent = icon || ({ success: '✓', error: '!', danger: '!', info: 'i' }[tone] || '?');
    modal.querySelector('.nav-confirm-eyebrow').textContent = eyebrow || navT(`nav.dialog.${tone === 'danger' ? 'warning' : tone}`);
    modal.querySelector('#navbarConfirmTitle').textContent = title || '';
    modal.querySelector('#navbarConfirmMessage').textContent = message || '';
    const hintElement = modal.querySelector('#navbarConfirmHint');
    hintElement.textContent = hint || '';
    hintElement.hidden = !hint;
    const cancel = modal.querySelector('.nav-confirm-cancel');
    const submit = modal.querySelector('.nav-confirm-submit');
    cancel.hidden = notice;
    cancel.textContent = cancelText || navT('nav.dialog.cancel');
    submit.textContent = confirmText || navT(notice ? 'nav.dialog.close' : 'nav.dialog.confirm');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => (notice ? submit : cancel)?.focus());
    return new Promise(resolve => {
        navConfirmResolver = resolve;
    });
}

function showNavbarNotice({ title, message, hint = '', tone = 'info', confirmText, eyebrow, icon }) {
    return showNavbarConfirm({ title, message, hint, tone, confirmText, eyebrow, icon, notice: true });
}

window.resolveNavbarConfirm = function (confirmed) {
    const modal = document.getElementById('navbarConfirmModal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const resolve = navConfirmResolver;
    navConfirmResolver = null;
    if (resolve) resolve(Boolean(confirmed));
    if (navDialogPreviousFocus instanceof HTMLElement && document.contains(navDialogPreviousFocus)) {
        navDialogPreviousFocus.focus();
    }
    navDialogPreviousFocus = null;
};

function ensureNavbarFormDialog() {
    let modal = document.getElementById('navbarFormDialogModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'navbarFormDialogModal';
    modal.className = 'nav-confirm-modal nav-form-dialog-modal';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="nav-confirm-backdrop" onclick="resolveNavbarFormDialog(false)"></div>
        <section class="nav-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="navbarFormDialogTitle" aria-describedby="navbarFormDialogMessage">
            <div class="nav-confirm-icon" aria-hidden="true">✎</div>
            <div class="nav-confirm-copy">
                <span class="nav-confirm-eyebrow"></span>
                <h3 id="navbarFormDialogTitle"></h3>
                <p id="navbarFormDialogMessage"></p>
                <form class="nav-dialog-fields" id="navbarFormDialogFields" novalidate></form>
                <div class="nav-confirm-hint" id="navbarFormDialogHint"></div>
            </div>
            <div class="nav-confirm-actions">
                <button type="button" class="nav-confirm-cancel" onclick="resolveNavbarFormDialog(false)"></button>
                <button type="button" class="nav-confirm-submit" onclick="resolveNavbarFormDialog(true)"></button>
            </div>
        </section>`;
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.resolveNavbarFormDialog(false);
        }
    });
    modal.querySelector('#navbarFormDialogFields').addEventListener('submit', event => {
        event.preventDefault();
        window.resolveNavbarFormDialog(true);
    });
    document.body.appendChild(modal);
    return modal;
}

function showNavbarFormDialog({ title, message = '', hint = '', fields = [], cancelText, confirmText, eyebrow, icon = '✎', tone = 'info' }) {
    const modal = ensureNavbarFormDialog();
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) {
        fsEl.appendChild(modal);
    } else if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    if (navFormDialogResolver) {
        navFormDialogResolver(null);
        navFormDialogResolver = null;
    }
    navDialogPreviousFocus = document.activeElement;
    modal.dataset.tone = tone;
    modal.querySelector('.nav-confirm-icon').textContent = icon;
    modal.querySelector('.nav-confirm-eyebrow').textContent = eyebrow || navT('nav.dialog.notice');
    modal.querySelector('#navbarFormDialogTitle').textContent = title || '';
    const messageElement = modal.querySelector('#navbarFormDialogMessage');
    messageElement.textContent = message;
    messageElement.hidden = !message;
    const hintElement = modal.querySelector('#navbarFormDialogHint');
    hintElement.textContent = hint;
    hintElement.hidden = !hint;
    const form = modal.querySelector('#navbarFormDialogFields');
    form.innerHTML = fields.map((field, index) => {
        const id = `navbarFormField${index}`;
        const dependency = field.enabledWhen;
        const dependencyAttrs = dependency
            ? ` data-enabled-when-name="${navEscape(dependency.field)}" data-enabled-when-value="${navEscape(dependency.value)}"`
            : '';
        const dependencyField = dependency ? fields.find(item => item.name === dependency.field) : null;
        const initiallyEnabled = !dependency || String(dependencyField?.value ?? '') === String(dependency.value);
        const disabledClass = initiallyEnabled ? '' : ' is-disabled';
        const disabledAttr = initiallyEnabled ? '' : ' disabled';
        if (Array.isArray(field.options)) {
            const options = field.options.map(option => {
                const value = String(option.value ?? '');
                const selected = value === String(field.value ?? '') ? ' selected' : '';
                return `<option value="${navEscape(value)}"${selected}>${navEscape(option.label ?? value)}</option>`;
            }).join('');
            return `<label class="nav-dialog-field${disabledClass}" for="${id}"${dependencyAttrs}><span>${navEscape(field.label || '')}</span><select id="${id}" name="${navEscape(field.name || `field${index}`)}" ${field.required ? 'required' : ''}${disabledAttr}>${options}</select></label>`;
        }
        const tag = field.multiline ? 'textarea' : 'input';
        const attrs = [
            `id="${id}"`, `name="${navEscape(field.name || `field${index}`)}"`,
            `placeholder="${navEscape(field.placeholder || '')}"`,
            field.required ? 'required' : '',
            field.maxLength ? `maxlength="${Number(field.maxLength)}"` : '',
            !field.multiline ? `type="${navEscape(field.type || 'text')}"` : '',
            disabledAttr,
            `autocomplete="${navEscape(field.autocomplete || 'off')}"`
        ].filter(Boolean).join(' ');
        const value = navEscape(field.value || '');
        return `<label class="nav-dialog-field${disabledClass}" for="${id}"${dependencyAttrs}><span>${navEscape(field.label || '')}</span>${tag === 'textarea' ? `<textarea ${attrs}>${value}</textarea>` : `<input ${attrs} value="${value}">`}</label>`;
    }).join('');
    const cancel = modal.querySelector('.nav-confirm-cancel');
    const submit = modal.querySelector('.nav-confirm-submit');
    cancel.textContent = cancelText || navT('nav.dialog.cancel');
    submit.textContent = confirmText || navT('nav.dialog.save');
    const syncDependentFields = () => {
        form.querySelectorAll('[data-enabled-when-name]').forEach(label => {
            const source = form.elements.namedItem(label.dataset.enabledWhenName);
            const target = label.querySelector('input, select, textarea');
            const enabled = String(source?.value ?? '') === label.dataset.enabledWhenValue;
            if (target) target.disabled = !enabled;
            label.classList.toggle('is-disabled', !enabled);
        });
    };
    const validate = () => {
        syncDependentFields();
        submit.disabled = !form.checkValidity();
    };
    form.oninput = validate;
    form.onchange = validate;
    validate();
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => form.querySelector('input, select, textarea')?.focus());
    return new Promise(resolve => { navFormDialogResolver = resolve; });
}

window.resolveNavbarFormDialog = function (confirmed) {
    const modal = document.getElementById('navbarFormDialogModal');
    const form = modal?.querySelector('#navbarFormDialogFields');
    if (confirmed && form && !form.checkValidity()) {
        form.querySelector(':invalid')?.focus();
        return;
    }
    const values = confirmed && form ? Object.fromEntries(new FormData(form).entries()) : null;
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const resolve = navFormDialogResolver;
    navFormDialogResolver = null;
    if (resolve) resolve(values);
    if (navDialogPreviousFocus instanceof HTMLElement && document.contains(navDialogPreviousFocus)) {
        navDialogPreviousFocus.focus();
    }
    navDialogPreviousFocus = null;
};

let alertCenterPollTimer = null;

function stopAlertCenterPolling() {
    if (alertCenterPollTimer) {
        clearInterval(alertCenterPollTimer);
        alertCenterPollTimer = null;
    }
}

// 后台标签页不轮询（19 个页面都带导航栏，开着几个标签时各自每分钟回源一次）；切回来时补刷一次
let alertCenterVisibilityBound = false;
function startAlertCenterPolling(intervalMs = 60000) {
    stopAlertCenterPolling();
    if (!hasNavAuthToken()) return;
    alertCenterPollTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') refreshAlertCenterBadge();
    }, intervalMs);
    if (!alertCenterVisibilityBound) {
        alertCenterVisibilityBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && alertCenterPollTimer) refreshAlertCenterBadge();
        });
    }
}

window.startAlertCenterPolling = startAlertCenterPolling;
window.stopAlertCenterPolling = stopAlertCenterPolling;

async function refreshAlertCenterBadge() {
    if (!hasNavAuthToken()) {
        stopAlertCenterPolling();
        updateAlertCenterBadge({ unread: 0 });
        return;
    }
    try {
        navState.alertCenter.summary = await fetchAlertCenterSummary();
        updateAlertCenterBadge();
    } catch (e) {
        if (e.status === 401 || (e.message && e.message.includes('401'))) {
            // 检测到 401 响应说明登录凭据失效，立即停止轮询，避免对服务端产生大量无效日志
            stopAlertCenterPolling();
            updateAlertCenterBadge({ unread: 0 });
            return;
        }
        console.warn('[AlertCenter] summary failed:', e);
    }
}

function ensureAlertCenterModal() {
    let modal = document.getElementById('alertCenterModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'alertCenterModal';
    modal.className = 'alert-center-modal';
    modal.innerHTML = `
        <div class="alert-center-backdrop" onclick="closeAlertCenter()"></div>
        <aside class="alert-center-panel" role="dialog" aria-modal="true" aria-labelledby="alertCenterTitle">
            <div class="alert-center-head">
                <div>
                    <h2 id="alertCenterTitle">${navEscape(navT('nav.alert.title'))}</h2>
                    <p>${navEscape(navT('nav.alert.subtitle'))}</p>
                </div>
                <button class="alert-center-close" type="button" onclick="closeAlertCenter()">×</button>
            </div>
            <div class="alert-center-summary" id="alertCenterSummary"></div>
            <div class="alert-center-toolbar">
                <div class="alert-center-filters" id="alertCenterFilters"></div>
                <div class="alert-center-actions">
                    <button type="button" onclick="markAllAlertCenterRead()">${navEscape(navT('nav.alert.markAll'))}</button>
                    <button type="button" onclick="archiveAllAlertCenter()">${navEscape(navT('nav.alert.archiveAll'))}</button>
                    <button type="button" onclick="reloadAlertCenter()">${navEscape(navT('nav.alert.refresh'))}</button>
                </div>
            </div>
            <div class="alert-center-list" id="alertCenterList">${navEscape(navT('nav.alert.loading'))}</div>
        </aside>
    `;
    document.body.appendChild(modal);
    return modal;
}

function renderAlertCenterFilters() {
    const el = document.getElementById('alertCenterFilters');
    if (!el) return;
    const filters = [
        ['all', navT('nav.alert.all')],
        ['unread', navT('nav.alert.unread')],
        ['warn', navT('nav.alert.warn')],
        ['config', navT('nav.alert.config')],
        ['security', navT('nav.alert.security')],
        ['user_action', navT('nav.alert.userAction')],
        ['system', navT('nav.alert.system')]
    ];
    el.innerHTML = filters.map(([id, label]) => `
        <button type="button" class="${navState.alertCenter.filter === id ? 'active' : ''}" onclick="setAlertCenterFilter('${id}')">${navEscape(label)}</button>
    `).join('');
}

function renderAlertCenterSummary() {
    const el = document.getElementById('alertCenterSummary');
    if (!el) return;
    const summary = navState.alertCenter.summary || {};
    el.innerHTML = `
        <div><span>${navEscape(navT('nav.alert.summaryTotal'))}</span><strong>${Number(summary.total) || 0}</strong></div>
        <div><span>${navEscape(navT('nav.alert.summaryUnread'))}</span><strong>${Number(summary.unread) || 0}</strong></div>
        <div><span>${navEscape(navT('nav.alert.summaryRisk'))}</span><strong>${Number(summary.warnOrAbove) || 0}</strong></div>
    `;
}

function renderAlertCenterList() {
    const list = document.getElementById('alertCenterList');
    if (!list) return;
    if (navState.alertCenter.loading) {
        list.innerHTML = `<div class="alert-center-empty">${navEscape(navT('nav.alert.loading'))}</div>`;
        return;
    }
    const events = navState.alertCenter.events || [];
    if (!events.length) {
        list.innerHTML = `<div class="alert-center-empty">${navEscape(navT('nav.alert.empty'))}</div>`;
        return;
    }
    list.innerHTML = events.map(event => {
        const meta = [
            event.actor ? `${navT('nav.alert.actor')}: ${event.actor}` : '',
            event.source ? `${navT('nav.alert.source')}: ${event.source}` : '',
            event.object_type || event.object_id ? `${navT('nav.alert.object')}: ${event.object_type || '-'} ${event.object_id || ''}` : ''
        ].filter(Boolean);
        const detailEntries = event.detail && typeof event.detail === 'object'
            ? Object.entries(event.detail).slice(0, 4)
            : [];
        return `
            <article class="alert-center-item ${navEscape(event.severity)} ${event.status === 'unread' ? 'unread' : ''}">
                <div class="alert-center-item-top">
                    <div class="alert-center-title-wrap">
                        <span class="alert-center-severity">${navEscape(severityLabel(event.severity))}</span>
                        <span class="alert-center-type">${navEscape(alertTypeLabel(event.event_type))}</span>
                        <strong>${navEscape(event.title)}</strong>
                    </div>
                    <time>${navEscape(formatAlertTime(event.created_at))}</time>
                </div>
                ${event.ai_summary ? `<div class="alert-center-ai-summary"><span>AI</span>${navEscape(event.ai_summary)}</div>` : ''}
                ${event.message ? `<div class="alert-center-message" onclick="this.classList.toggle('expanded')" title="点击展开/收起">${navEscape(event.message)}</div>` : ''}
                ${meta.length ? `<div class="alert-center-meta">${meta.map(navEscape).join(' · ')}</div>` : ''}
                ${detailEntries.length ? `<div class="alert-center-detail">${detailEntries.map(([k, v]) => `<span onclick="this.classList.toggle('expanded')" title="点击展开/收起">${navEscape(k)}: ${navEscape(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`).join('')}</div>` : ''}
                <div class="alert-center-row-actions">
                    ${event.status === 'unread' ? `<button type="button" onclick="markAlertCenterRead('${navEscape(event.id)}')">${navEscape(navT('nav.alert.read'))}</button>` : ''}
                    <button type="button" onclick="archiveAlertCenterEvent('${navEscape(event.id)}')">${navEscape(navT('nav.alert.archive'))}</button>
                </div>
            </article>
        `;
    }).join('');
}

window.reloadAlertCenter = async function () {
    navState.alertCenter.loading = true;
    renderAlertCenterSummary();
    renderAlertCenterFilters();
    renderAlertCenterList();
    try {
        const [summary, events] = await Promise.all([
            fetchAlertCenterSummary(),
            fetchAlertCenterEvents()
        ]);
        navState.alertCenter.summary = summary;
        navState.alertCenter.events = events;
        updateAlertCenterBadge(summary);
    } catch (e) {
        const list = document.getElementById('alertCenterList');
        if (list) list.innerHTML = `<div class="alert-center-empty warning">${navEscape(navT('nav.alert.failLoad'))}${navEscape(e.message)}</div>`;
    } finally {
        navState.alertCenter.loading = false;
        renderAlertCenterSummary();
        renderAlertCenterFilters();
        renderAlertCenterList();
    }
};

window.openAlertCenter = function () {
    const modal = ensureAlertCenterModal();
    modal.classList.add('open');
    window.reloadAlertCenter();
};

window.closeAlertCenter = function () {
    document.getElementById('alertCenterModal')?.classList.remove('open');
};

window.setAlertCenterFilter = function (filter) {
    navState.alertCenter.filter = filter || 'all';
    window.reloadAlertCenter();
};

window.markAlertCenterRead = async function (id) {
    await fetch('/api/alert-center/events/read', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
        body: JSON.stringify({ ids: [id] })
    });
    window.reloadAlertCenter();
};

window.markAllAlertCenterRead = async function () {
    await fetch('/api/alert-center/events/read-all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }
    });
    window.reloadAlertCenter();
};

window.archiveAllAlertCenter = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.alert.archiveConfirmTitle'),
        message: navT('nav.alert.archiveAllConfirm'),
        hint: navT('nav.alert.archiveConfirmHint'),
        cancelText: navT('nav.alert.archiveConfirmCancel'),
        confirmText: navT('nav.alert.archiveConfirmAction')
    });
    if (!confirmed) return;
    await fetch('/api/alert-center/events/archive-all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }
    });
    window.reloadAlertCenter();
};

window.archiveAlertCenterEvent = async function (id) {
    await fetch(`/api/alert-center/events/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaderForNav()
    });
    window.reloadAlertCenter();
};

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
    window.location.href = './login.html';
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
        toolsKnowledgeGraphLoader = loadNavLazyScript('./tp-static/frontend/js/shared/ai-knowledge-graph-spatial-themes-v5.js', '知识图谱组件加载失败').catch(error => {
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
    toolsChatFilesLoader ||= loadNavLazyScript('./tp-static/frontend/js/shared/chat-files.js', '文件组件加载失败').catch(error => {
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
            loadNavLazyScript('./tp-static/frontend/js/shared/ai-assistant.js', 'AI 助手组件加载失败')
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

(function () {
    // 华子胶片设计工具内置了自己的 AI 助手，避免重复显示全局悬浮入口。
    if ((window.__TP_STATIC_PATH__ || window.location.pathname).startsWith('/tools/network_safety_meeting_summary')) return;
    // 公开的隐私/条款页在未登录时不请求受保护的 AI 接口，避免无效 401 日志。
    if (!hasNavAuthToken()) return;

    // 自动初始化与手动打开共用同一加载链，等待文件组件就绪后再启动助手。
    ensureToolsAIAssistantScript().catch(error => console.warn(error.message));
})();

// 检查服务状态
async function checkServerStatus() {
    try {
        const r = await fetch('/api/health');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await r.json();
        const dot = document.querySelector('.status-dot');
        const el = document.getElementById('server-status-text');
        if (dot) dot.style.background = '#4CAF50';
        if (el) el.textContent = navT('nav.online');
    } catch (e) {
        const dot = document.querySelector('.status-dot');
        const el = document.getElementById('server-status-text');
        if (dot) dot.style.background = '#ef5350';
        if (el) el.textContent = navT('nav.offline');
    }
}

let serviceStatusDays = 90;
let serviceStatusView = 'overview';
let serviceStatusTimer = null;
let serviceStatusRequestSeq = 0;
let serviceStatusRequestPending = false;
let serviceRuntimeLogPage = 1;
let serviceRuntimeLogTimer = null;
let serviceRuntimeLogRequestSeq = 0;

function serviceStatusBi(zh, en) {
    return window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
}

function canInspectServiceFailures() {
    return localStorage.getItem('tools_role') === 'admin';
}

function serviceStateMeta(state) {
    const states = {
        operational: { icon: '✓', label: serviceStatusBi('正常', 'Operational') },
        degraded: { icon: '!', label: serviceStatusBi('部分请求失败', 'Degraded') },
        incident: { icon: '!', label: serviceStatusBi('服务异常', 'Incident') },
        'no-data': { icon: '·', label: serviceStatusBi('暂无数据', 'No data') }
    };
    return states[state] || states['no-data'];
}

function resolveOverallServiceStatusMeta(data = {}) {
    const services = Array.isArray(data.services) ? data.services : [];
    const overall = data.overall || {};
    const isEn = window.ToolsI18n?.getLanguage?.() === 'en-US';

    const incidentServices = services.filter(service => service.currentState === 'incident');
    const degradedServices = services.filter(service => service.currentState === 'degraded');
    const activeServices = services.filter(service => service.currentState !== 'no-data');

    if (!activeServices.length && overall.currentState === 'no-data') {
        return {
            state: 'no-data',
            icon: '·',
            label: serviceStatusBi('暂无数据', 'No data'),
            detail: serviceStatusBi('暂无请求数据', 'No request data available'),
            hasIssue: false
        };
    }

    if (activeServices.length > 0 && incidentServices.length === activeServices.length) {
        return {
            state: 'incident',
            icon: '!',
            label: serviceStatusBi('服务异常', 'Incident'),
            detail: serviceStatusBi('全部服务出现异常', 'All services experiencing incidents'),
            hasIssue: true
        };
    }

    if (incidentServices.length > 0) {
        const names = incidentServices.map(service => isEn ? (service.nameEn || service.name) : (service.name || service.id));
        let detail = '';
        if (isEn) {
            detail = names.length === 1
                ? `${names[0]} may experience issues`
                : names.length === 2
                    ? `${names[0]} & ${names[1]} may experience issues`
                    : `${names[0]} and ${names.length - 1} other services may experience issues`;
        } else {
            detail = names.length === 1
                ? `${names[0]}部分可能存在异常`
                : names.length === 2
                    ? `${names[0]}、${names[1]}部分可能存在异常`
                    : `${names[0]}等 ${names.length} 个服务可能存在异常`;
        }
        return {
            state: 'operational',
            icon: '✓',
            label: serviceStatusBi('正常', 'Operational'),
            detail,
            hasIssue: true
        };
    }

    if (degradedServices.length > 0) {
        const names = degradedServices.map(service => isEn ? (service.nameEn || service.name) : (service.name || service.id));
        let detail = '';
        if (isEn) {
            detail = names.length === 1
                ? `${names[0]} may experience issues`
                : names.length === 2
                    ? `${names[0]} & ${names[1]} may experience issues`
                    : `${names[0]} and ${names.length - 1} other services may experience issues`;
        } else {
            detail = names.length === 1
                ? `${names[0]}部分可能存在异常`
                : names.length === 2
                    ? `${names[0]}、${names[1]}部分可能存在异常`
                    : `${names[0]}等 ${names.length} 个服务可能存在异常`;
        }
        return {
            state: 'operational',
            icon: '✓',
            label: serviceStatusBi('正常', 'Operational'),
            detail,
            hasIssue: true
        };
    }

    return {
        state: 'operational',
        icon: '✓',
        label: serviceStatusBi('正常', 'Operational'),
        detail: serviceStatusBi('全部服务运行正常', 'All services operational'),
        hasIssue: false
    };
}

function licenseStatusMeta(license = {}) {
    if (!license.enabled) {
        return {
            state: 'no-data',
            icon: '—',
            label: serviceStatusBi('Web 部署', 'Web deployment'),
            detail: serviceStatusBi('无需桌面 License', 'Desktop License not required')
        };
    }
    const state = ['operational', 'degraded', 'incident'].includes(license.state) ? license.state : 'incident';
    const expiresAt = Number(license.expiresAt);
    const expiryText = Number.isFinite(expiresAt) && expiresAt > 0
        ? new Date(expiresAt).toLocaleString(window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN')
        : serviceStatusBi('未知', 'Unknown');
    if (!license.valid) {
        return {
            state: 'incident',
            icon: '!',
            label: serviceStatusBi('License 已失效', 'License invalid'),
            detail: `${license.reasonCode || 'EXPIRED'} · ${serviceStatusBi('到期', 'Expires')} ${expiryText}`
        };
    }
    if (state === 'incident') {
        return {
            state,
            icon: '!',
            label: serviceStatusBi('License 即将到期', 'License expires imminently'),
            detail: `${serviceStatusBi('剩余', 'Remaining')} ${Number(license.hoursRemaining || 0)} ${serviceStatusBi('小时', 'hours')} · ${expiryText}`
        };
    }
    if (state === 'degraded') {
        return {
            state,
            icon: '!',
            label: serviceStatusBi('License 临近到期', 'License expires soon'),
            detail: `${serviceStatusBi('剩余', 'Remaining')} ${Number(license.daysRemaining || 0)} ${serviceStatusBi('天', 'days')} · ${expiryText}`
        };
    }
    return {
        state,
        icon: '✓',
        label: serviceStatusBi('License 可用', 'License active'),
        detail: `${serviceStatusBi('剩余', 'Remaining')} ${Number(license.daysRemaining || 0)} ${serviceStatusBi('天', 'days')} · ${expiryText}`
    };
}

function ensureServiceStatusModal() {
    let modal = document.getElementById('serviceStatusModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'serviceStatusModal';
    modal.className = 'service-status-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="service-status-dialog" role="dialog" aria-modal="true" aria-labelledby="serviceStatusTitle">
            <div class="service-status-head">
                <div>
                    <div class="service-status-kicker">TOOLS PLATFORM STATUS</div>
                    <h2 id="serviceStatusTitle"></h2>
                    <p id="serviceStatusSubtitle"></p>
                </div>
                <button type="button" class="service-status-close" onclick="closeServiceStatusModal()" aria-label="Close">×</button>
            </div>
            <div class="service-status-toolbar">
                <div class="service-status-tabs">
                    <button type="button" id="serviceStatusOverviewTab" onclick="setServiceStatusView('overview')">${serviceStatusBi('状态概览', 'Overview')}</button>
                    <button type="button" id="serviceStatusLogsTab" onclick="setServiceStatusView('logs')">${serviceStatusBi('运行日志', 'Runtime logs')}</button>
                </div>
                <div class="service-status-toolbar-actions">
                    <div class="service-status-range" id="serviceStatusRange"></div>
                    <button type="button" class="service-status-refresh" onclick="refreshServiceStatusView()">↻ <span>${serviceStatusBi('刷新', 'Refresh')}</span></button>
                </div>
            </div>
            <div class="service-status-content" id="serviceStatusContent"></div>
        </div>`;
    modal.addEventListener('click', event => { if (event.target === modal) window.closeServiceStatusModal(); });
    document.body.appendChild(modal);
    return modal;
}

function ensureServiceFailureModal() {
    let modal = document.getElementById('serviceFailureModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'serviceFailureModal';
    modal.className = 'service-failure-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="service-failure-dialog" role="dialog" aria-modal="true" aria-labelledby="serviceFailureTitle">
            <div class="service-failure-head">
                <div><small>REQUEST DIAGNOSTICS</small><h3 id="serviceFailureTitle"></h3><p id="serviceFailureSubtitle"></p></div>
                <button type="button" onclick="closeServiceFailureModal()" aria-label="Close">×</button>
            </div>
            <div class="service-failure-content" id="serviceFailureContent"></div>
        </div>`;
    modal.addEventListener('click', event => { if (event.target === modal) window.closeServiceFailureModal(); });
    document.body.appendChild(modal);
    return modal;
}

function formatServiceFailureBody(value) {
    if (!value) return serviceStatusBi('（无内容）', '(empty)');
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch (_) { return value; }
}

window.openServiceFailureModal = async function (serviceKey = '', date = '', statusClass = '') {
    const modal = ensureServiceFailureModal();
    const serviceName = serviceKey
        ? document.querySelector(`[data-service-status-key="${serviceKey}"]`)?.dataset.serviceStatusName || serviceKey
        : serviceStatusBi('全部服务', 'All services');
    modal.style.display = 'flex';
    document.getElementById('serviceFailureTitle').textContent = serviceStatusBi('失败请求明细', 'Failed request details');
    document.getElementById('serviceFailureSubtitle').textContent = [serviceName, date, statusClass].filter(Boolean).join(' · ');
    const content = document.getElementById('serviceFailureContent');
    content.innerHTML = `<div class="service-status-loading"><span></span>${serviceStatusBi('正在读取失败记录…', 'Loading failed requests…')}</div>`;
    const query = new URLSearchParams({ limit: '100' });
    if (serviceKey) query.set('serviceKey', serviceKey);
    if (date) query.set('date', date);
    if (statusClass) query.set('statusClass', statusClass);
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status/failures?${query}`);
        const failures = data.failures || [];
        const authNotice = data.excludedAuthResponses > 0
            ? `<div class="service-status-notice">${serviceStatusBi('已排除', 'Excluded')} ${Number(data.excludedAuthResponses).toLocaleString()} ${serviceStatusBi('条正常登录或会话过期拦截，不计入服务异常；原始诊断记录仍保留。', 'expected login or session-expiry responses from service failures; original diagnostic records are retained.')}</div>`
            : '';
        if (!failures.length) {
            const hasFilter = Boolean(serviceKey || date || statusClass);
            content.innerHTML = `${authNotice}
                <div class="service-failure-empty">
                    <strong>${date ? `${navEscape(date)} · ${serviceStatusBi('该时间点无失败请求记录', 'No failure records for this time point')}` : serviceStatusBi('暂无可查看的失败明细', 'No failure details available')}</strong>
                    <p>${date ? `${navEscape(serviceName)} ${serviceStatusBi('在所选时间点运行正常，未产生 4xx 或 5xx 请求异常。', 'operated normally at this time with no 4xx or 5xx exceptions.')}` : serviceStatusBi('失败明细从本功能启用后开始记录，历史统计仍会保留。', 'Failure details are recorded after this feature is enabled; historical totals remain available.')}</p>
                    ${hasFilter ? `
                        <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                            ${date && serviceKey ? `<button type="button" class="service-failure-quick-btn" onclick="openServiceFailureModal('${navEscape(serviceKey)}','','')">${serviceStatusBi('查看该服务全部失败记录', 'View all failures for this service')}</button>` : ''}
                            ${(date || serviceKey) ? `<button type="button" class="service-failure-quick-btn" onclick="openServiceFailureModal('','','')">${serviceStatusBi('查看全平台所有失败记录', 'View all platform failures')}</button>` : ''}
                        </div>` : ''}
                </div>`;
            return;
        }
        content.innerHTML = authNotice + failures.map((failure, index) => `
            <details class="service-failure-item" ${index === 0 ? 'open' : ''}>
                <summary>
                    <span class="service-failure-code ${failure.statusCode >= 500 ? 'server' : 'client'}">${Number(failure.statusCode)}</span>
                    <b>${navEscape(failure.method)} ${navEscape(failure.path)}</b>
                    <time>${navEscape(new Date(failure.requestAt).toLocaleString())}</time>
                    <em>${Number(failure.durationMs)}ms</em>
                </summary>
                <div class="service-failure-meta"><span>Request ID</span><code>${navEscape(failure.requestId || '—')}</code></div>
                <div class="service-failure-columns">
                    <section><h4>${serviceStatusBi('请求内容（已脱敏）', 'Request (redacted)')}</h4><pre>${navEscape(formatServiceFailureBody(failure.requestBody))}</pre></section>
                    <section><h4>${serviceStatusBi('失败返回（已脱敏）', 'Failure response (redacted)')}</h4><pre>${navEscape(formatServiceFailureBody(failure.responseBody))}</pre></section>
                </div>
            </details>`).join('');
    } catch (error) {
        content.innerHTML = `<div class="service-status-error"><strong>${serviceStatusBi('失败明细读取失败', 'Unable to load failure details')}</strong><p>${navEscape(error.message)}</p></div>`;
    }
};

window.closeServiceFailureModal = function () {
    const modal = document.getElementById('serviceFailureModal');
    if (modal) modal.style.display = 'none';
};

window.openServiceStatusModal = function () {
    const modal = ensureServiceStatusModal();
    modal.style.display = 'flex';
    document.body.classList.add('service-status-open');
    document.getElementById('serviceStatusTitle').textContent = serviceStatusBi('服务状态中心', 'Service Status Center');
    document.getElementById('serviceStatusSubtitle').textContent = serviceStatusBi('基于平台真实 API 请求返回结果生成', 'Generated from actual platform API responses');
    const runtimeLogsTab = document.getElementById('serviceStatusLogsTab');
    if (runtimeLogsTab) runtimeLogsTab.hidden = !canInspectServiceFailures();
    window.setServiceStatusView('overview');
};

window.closeServiceStatusModal = function () {
    const modal = document.getElementById('serviceStatusModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('service-status-open');
    window.clearServiceStatusPolling();
    window.clearServiceRuntimeLogPolling();
};

window.setServiceStatusView = function (view) {
    serviceStatusView = view === 'logs' && canInspectServiceFailures() ? 'logs' : 'overview';
    document.getElementById('serviceStatusOverviewTab')?.classList.toggle('active', serviceStatusView === 'overview');
    document.getElementById('serviceStatusLogsTab')?.classList.toggle('active', serviceStatusView === 'logs');
    const subtitle = document.getElementById('serviceStatusSubtitle');
    if (subtitle) subtitle.textContent = serviceStatusView === 'logs'
        ? serviceStatusBi('后台全量控制台日志 · 自动脱敏', 'Complete backend console · automatically redacted')
        : serviceStatusBi('基于平台真实 API 请求返回结果生成', 'Generated from actual platform API responses');
    if (serviceStatusView === 'logs') {
        window.clearServiceStatusPolling();
        window.renderServiceRuntimeLogShell();
        window.loadServiceRuntimeLogs(1);
    } else {
        window.clearServiceRuntimeLogPolling();
        window.startServiceStatusPolling();
        window.loadServiceStatusHistory();
    }
};

window.refreshServiceStatusView = function () {
    if (serviceStatusView === 'logs') window.loadServiceRuntimeLogs(serviceRuntimeLogPage);
    else window.loadServiceStatusHistory();
};

window.clearServiceStatusPolling = function () {
    if (serviceStatusTimer) window.clearInterval(serviceStatusTimer);
    serviceStatusTimer = null;
    serviceStatusRequestSeq += 1;
    serviceStatusRequestPending = false;
};

window.startServiceStatusPolling = function () {
    window.clearServiceStatusPolling();
    serviceStatusTimer = window.setInterval(() => {
        window.loadServiceStatusHistory(true);
    }, 5000);
};

window.clearServiceRuntimeLogPolling = function () {
    if (serviceRuntimeLogTimer) window.clearInterval(serviceRuntimeLogTimer);
    serviceRuntimeLogTimer = null;
};

function runtimeLogFilters() {
    const levels = [...document.querySelectorAll('.service-runtime-levels input:checked')].map(input => input.value);
    return {
        q: document.getElementById('serviceRuntimeLogSearch')?.value.trim() || '',
        levels: levels.length ? levels.join(',') : '__none__',
        startDate: document.getElementById('serviceRuntimeLogStartDate')?.value || '',
        endDate: document.getElementById('serviceRuntimeLogEndDate')?.value || ''
    };
}

window.clearServiceRuntimeLogFilters = function () {
    const search = document.getElementById('serviceRuntimeLogSearch');
    const startDate = document.getElementById('serviceRuntimeLogStartDate');
    const endDate = document.getElementById('serviceRuntimeLogEndDate');
    if (search) search.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    document.querySelectorAll('.service-runtime-levels input').forEach(input => { input.checked = true; });
    window.loadServiceRuntimeLogs(1);
};

window.renderServiceRuntimeLogShell = function () {
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    if (!content || !range) return;
    range.innerHTML = '';
    content.innerHTML = `
        <section class="service-runtime-log-panel">
            <div class="service-runtime-log-filter">
                <label class="service-runtime-search"><span>⌕</span><input id="serviceRuntimeLogSearch" type="search" placeholder="${serviceStatusBi('搜索详情、代码位置或请求 ID', 'Search detail, source or request ID')}" onkeydown="if(event.key==='Enter') loadServiceRuntimeLogs(1)"></label>
                <div class="service-runtime-levels" role="group" aria-label="${serviceStatusBi('日志等级（可多选）', 'Log levels (multi-select)')}">
                    ${['DEBUG', 'INFO', 'LOG', 'WARN', 'ERROR'].map(level => `<label class="${level.toLowerCase()}"><input type="checkbox" value="${level}" checked onchange="loadServiceRuntimeLogs(1)"><span>${level}</span></label>`).join('')}
                </div>
                <label class="service-runtime-date"><span>${serviceStatusBi('从', 'From')}</span><input id="serviceRuntimeLogStartDate" type="date" onchange="loadServiceRuntimeLogs(1)"></label>
                <label class="service-runtime-date"><span>${serviceStatusBi('到', 'To')}</span><input id="serviceRuntimeLogEndDate" type="date" onchange="loadServiceRuntimeLogs(1)"></label>
                <button type="button" class="service-runtime-query" onclick="loadServiceRuntimeLogs(1)">${serviceStatusBi('查询', 'Search')}</button>
                <button type="button" class="service-runtime-reset" onclick="clearServiceRuntimeLogFilters()">${serviceStatusBi('重置', 'Reset')}</button>
                <label class="service-runtime-follow"><input id="serviceRuntimeLogFollow" type="checkbox" checked onchange="toggleServiceRuntimeLogPolling()"> ${serviceStatusBi('实时跟随', 'Follow live')}</label>
            </div>
            <div class="service-runtime-export">
                <button type="button" class="service-runtime-reset" onclick="exportServiceRuntimeLogs(true)">${serviceStatusBi('导出当天 ZIP', 'Export today ZIP')}</button>
                <button type="button" class="service-runtime-reset" onclick="exportServiceRuntimeLogs(false)">${serviceStatusBi('导出日期范围 ZIP', 'Export date range ZIP')}</button>
                <span id="serviceRuntimeLogExportStatus" role="status">${serviceStatusBi('导出全部等级，含本人 AI 文本/代码；不含图片附件。日期按本机时区。', 'All levels, with your AI text/code; no media attachments. Dates use your local timezone.')}</span>
            </div>
            <div class="service-runtime-log-summary" id="serviceRuntimeLogSummary"></div>
            <div class="service-runtime-log-list" id="serviceRuntimeLogList" aria-live="polite"></div>
            <div class="service-runtime-log-pagination" id="serviceRuntimeLogPagination"></div>
        </section>`;
    window.toggleServiceRuntimeLogPolling();
};

window.exportServiceRuntimeLogs = async function (todayOnly) {
    const buttons = document.querySelectorAll('.service-runtime-export button');
    if ([...buttons].some(button => button.disabled)) return;
    const status = document.getElementById('serviceRuntimeLogExportStatus');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const startDate = todayOnly ? today : document.getElementById('serviceRuntimeLogStartDate')?.value;
    const endDate = todayOnly ? today : document.getElementById('serviceRuntimeLogEndDate')?.value;
    if (!startDate || !endDate || endDate < startDate) {
        if (status) status.textContent = serviceStatusBi('请在上方选择有效的起止日期。', 'Select a valid start and end date above.');
        return;
    }
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const query = new URLSearchParams({ startDate, endDate, startOffset: String(start.getTimezoneOffset()), endOffset: String(end.getTimezoneOffset()) });
    buttons.forEach(button => { button.disabled = true; });
    if (status) status.textContent = serviceStatusBi('正在打包日志并尝试读取 AI 对话…', 'Packing logs and trying to read AI conversations…');
    try {
        const token = localStorage.getItem('tools_token');
        const response = await fetch(`/api/platform-metrics/service-status/logs/export?${query}`, {
            credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${response.status}`);
        }
        if (!response.headers.get('Content-Type')?.includes('application/zip')) throw new Error(serviceStatusBi('服务器未返回日志压缩包，请检查登录状态。', 'No ZIP received; check your login.'));
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `service-logs-${startDate}_${endDate}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        if (status) status.textContent = serviceStatusBi('已生成 ZIP。导出数量、保留范围和 AI 读取情况见包内 manifest.json。', 'ZIP ready. See manifest.json for counts, retention and AI availability.');
    } catch (error) {
        if (status) status.textContent = serviceStatusBi('导出失败：', 'Export failed: ') + error.message;
    } finally {
        buttons.forEach(button => { button.disabled = false; });
    }
};

window.toggleServiceRuntimeLogPolling = function () {
    window.clearServiceRuntimeLogPolling();
    const follow = document.getElementById('serviceRuntimeLogFollow');
    if (serviceStatusView !== 'logs' || !follow?.checked) return;
    serviceRuntimeLogTimer = window.setInterval(() => {
        if (document.getElementById('serviceStatusModal')?.style.display === 'flex') window.loadServiceRuntimeLogs(1, true);
    }, 3000);
};

window.loadServiceRuntimeLogs = async function (page = 1, isLiveRefresh = false) {
    if (serviceStatusView !== 'logs') return;
    const list = document.getElementById('serviceRuntimeLogList');
    const summary = document.getElementById('serviceRuntimeLogSummary');
    const pagination = document.getElementById('serviceRuntimeLogPagination');
    if (!list || !summary || !pagination) return;
    if (!isLiveRefresh && Number(page) > 1) {
        const follow = document.getElementById('serviceRuntimeLogFollow');
        if (follow) follow.checked = false;
        window.toggleServiceRuntimeLogPolling();
    }
    const requestSeq = ++serviceRuntimeLogRequestSeq;
    const filters = runtimeLogFilters();
    if (!isLiveRefresh) list.innerHTML = `<div class="service-runtime-log-loading">${serviceStatusBi('正在读取程序运行日志…', 'Loading runtime logs…')}</div>`;
    const query = new URLSearchParams({ ...filters, page: String(page), pageSize: '50' });
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status/logs?${query}`);
        if (requestSeq !== serviceRuntimeLogRequestSeq || serviceStatusView !== 'logs') return;
        serviceRuntimeLogPage = data.page || page;
        const logs = data.logs || [];
        summary.textContent = `${serviceStatusBi('共', 'Total')} ${Number(data.total || 0).toLocaleString()} ${serviceStatusBi('条 · 保留最近', 'entries · last')} ${data.retentionDays || 30} ${serviceStatusBi('天 · 每 3 秒刷新', 'days · refreshes every 3 seconds')}`;
        list.innerHTML = logs.length ? `<div class="service-runtime-log-header"><span>${serviceStatusBi('时间', 'Time')}</span><span>${serviceStatusBi('等级', 'Level')}</span><span>${serviceStatusBi('代码位置', 'Source')}</span><span>${serviceStatusBi('详情', 'Detail')}</span><span>${serviceStatusBi('上下文', 'Context')}</span></div>${logs.map(log => {
            const context = log.requestId
                ? `${log.statusCode == null ? '—' : `HTTP ${Number(log.statusCode)}`} · ${log.durationMs == null ? '—' : `${Number(log.durationMs)}ms`} · ${navEscape(log.requestId)}`
                : serviceStatusBi('后台控制台', 'Backend console');
            return `<details class="service-runtime-log-row ${String(log.level || 'LOG').toLowerCase()}"><summary>
                <time>${navEscape(new Date(log.timestamp).toLocaleString())}</time>
                <span class="service-runtime-log-level">${navEscape(log.level)}</span>
                <code title="${navEscape(log.source)}">${navEscape(log.source)}</code>
                <p title="${navEscape(log.detail)}">${navEscape(log.detail)}</p>
                <span class="service-runtime-log-meta">${context}</span>
            </summary><pre>${navEscape(log.detail)}</pre></details>`;
        }).join('')}` : `<div class="service-runtime-log-empty">${serviceStatusBi('没有匹配的运行日志', 'No matching runtime logs')}</div>`;
        const previousDisabled = data.page <= 1 ? 'disabled' : '';
        const nextDisabled = data.page >= data.totalPages ? 'disabled' : '';
        pagination.innerHTML = `<button type="button" ${previousDisabled} onclick="loadServiceRuntimeLogs(${Math.max(1, data.page - 1)})">${serviceStatusBi('上一页', 'Previous')}</button><span>${data.page} / ${data.totalPages}</span><button type="button" ${nextDisabled} onclick="loadServiceRuntimeLogs(${Math.min(data.totalPages, data.page + 1)})">${serviceStatusBi('下一页', 'Next')}</button>`;
        if (isLiveRefresh && document.getElementById('serviceRuntimeLogFollow')?.checked) list.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        if (requestSeq !== serviceRuntimeLogRequestSeq) return;
        list.innerHTML = `<div class="service-runtime-log-empty error">${navEscape(error.message || serviceStatusBi('日志读取失败', 'Unable to load logs'))}</div>`;
    }
};

window.setServiceStatusDays = function (days) {
    serviceStatusDays = [30, 90, 180].includes(Number(days)) ? Number(days) : 90;
    window.loadServiceStatusHistory();
};

function serviceStatusRequest(url, options = {}) {
    if (window.API?.get && (!options.method || options.method === 'GET')) return window.API.get(url);
    if (window.API?.post && options.method === 'POST') return window.API.post(url, options.body);
    const fetchOptions = {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem('tools_token') ? { Authorization: `Bearer ${localStorage.getItem('tools_token')}` } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
    };
    return fetch(url, fetchOptions).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
    });
}

window.inspectChannelsNow = async function () {
    const btn = document.getElementById('serviceChannelInspectBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span> ${serviceStatusBi('抽查中…', 'Checking…')}`;
    }
    try {
        await serviceStatusRequest('/api/platform-metrics/service-status/channels/inspect', { method: 'POST' });
        await window.loadServiceStatusHistory();
    } catch (err) {
        const msg = serviceStatusBi('频道抽查失败：', 'Channel inspection failed: ') + err.message;
        if (window.AppDialog && typeof window.AppDialog.alert === 'function') {
            window.AppDialog.alert(msg, { title: serviceStatusBi('频道抽查失败', 'Inspection failed'), tone: 'danger' });
        } else if (typeof showNavbarNotice === 'function') {
            showNavbarNotice(msg, { tone: 'error' });
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `↻ <span>${serviceStatusBi('立即抽查', 'Inspect Now')}</span>`;
        }
    }
};

function renderChannelsWatchdogHtml(channelsData, canInspectFailures) {
    if (!channelsData || !channelsData.enabled) return '';
    const channels = channelsData.channels || [];
    if (!channels.length) return '';
    const lastCheckText = channelsData.lastCheckAt ? new Date(channelsData.lastCheckAt).toLocaleTimeString() : '—';
    const recoveryText = channelsData.autoRecoveryCount > 0
        ? ` · ${serviceStatusBi('已自动自愈', 'Auto-healed')} ${channelsData.autoRecoveryCount} ${serviceStatusBi('次', 'times')}`
        : '';
    const cards = channels.map(c => {
        const icon = c.id === 'welink' ? '💼' : '💬';
        const badgeClass = c.state || (c.enabled ? 'operational' : 'disabled');
        const badgeLabel = c.stateLabel || (c.enabled ? serviceStatusBi('正常', 'Operational') : serviceStatusBi('未启用', 'Disabled'));
        const heartbeatType = c.heartbeat?.type || (c.id === 'welink' ? 'WebSocket Keepalive' : 'Long-Polling');
        const heartbeatState = c.heartbeat?.healthy ? serviceStatusBi('长连接活跃', 'Active') : (c.enabled ? serviceStatusBi('异常断开', 'Disconnected') : serviceStatusBi('未启用', 'Disabled'));
        const lastHbText = c.heartbeat?.lastHeartbeatAt ? new Date(c.heartbeat.lastHeartbeatAt).toLocaleTimeString() : '—';
        const autoHealInfo = c.autoHeal?.recoveredCount ? `${serviceStatusBi('已自愈', 'Recovered')} ${c.autoHeal.recoveredCount} ${serviceStatusBi('次', 'times')}` : serviceStatusBi('就绪保活中', 'Standby');
        const clickAttr = canInspectFailures ? ` onclick="openServiceFailureModal('channels','','')" style="cursor:pointer;" title="${serviceStatusBi('点击查看频道服务失败明细', 'Click to view channel failures')}"` : '';
        return `
            <div class="service-channel-card ${navEscape(c.state || 'operational')} ${canInspectFailures ? 'clickable' : ''}"${clickAttr}>
                <div class="service-channel-header">
                    <div class="service-channel-name"><span>${icon}</span><span>${navEscape(c.name)} ${serviceStatusBi('助理', 'Assistant')}</span></div>
                    <span class="service-channel-badge ${navEscape(badgeClass)}"><i></i>${navEscape(badgeLabel)}</span>
                </div>
                <div class="service-channel-body">
                    <div class="service-channel-row"><span>${serviceStatusBi('心跳保活', 'Heartbeat')}</span><span>${navEscape(heartbeatType)} · <b>${navEscape(heartbeatState)}</b></span></div>
                    <div class="service-channel-row"><span>${serviceStatusBi('最近心跳', 'Last Heartbeat')}</span><code>${navEscape(lastHbText)}</code></div>
                    ${c.channel ? `<div class="service-channel-row"><span>${serviceStatusBi('频道标识', 'Channel')}</span><span><code>${navEscape(c.channel)}</code> (${navEscape(c.environment || 'prod')})</span></div>` : ''}
                    <div class="service-channel-row"><span>${serviceStatusBi('自愈监控', 'Auto-heal Watchdog')}</span><span>${navEscape(autoHealInfo)}</span></div>
                    ${c.lastError ? `<div class="service-channel-err" title="${navEscape(c.lastError)}">⚠️ ${navEscape(c.lastError)}</div>` : ''}
                </div>
            </div>`;
    }).join('');
    return `
        <section class="service-status-channels">
            <div class="service-status-channels-head">
                <div>
                    <div class="service-status-channels-title">
                        <span>📡</span>
                        <span>${serviceStatusBi('频道对接与心跳保活检测', 'Channel Integration & Heartbeat Keepalive')}</span>
                    </div>
                    <div class="service-status-channels-sub">
                        ${serviceStatusBi('30 秒定时抽查 · 面板每 5 秒更新 · 断线超时自动重连自愈 · 上次抽查', 'Checked every 30s · Panel refreshes every 5s · Auto-heal reconnect on timeout · Last check')}: ${navEscape(lastCheckText)}${navEscape(recoveryText)}
                    </div>
                </div>
                <div class="service-status-channels-action">
                    <button type="button" class="service-channel-inspect-btn" id="serviceChannelInspectBtn" onclick="inspectChannelsNow()">↻ <span>${serviceStatusBi('立即抽查', 'Inspect Now')}</span></button>
                </div>
            </div>
            <div class="service-status-channels-grid">${cards}</div>
        </section>`;
}

function renderServiceStatusHistory(data) {
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    if (!content || !range) return;
    range.innerHTML = [30, 90, 180].map(days => `<button type="button" class="${days === data.days ? 'active' : ''}" onclick="setServiceStatusDays(${days})">${days} ${serviceStatusBi('天', 'days')}</button>`).join('');
    const overall = data.overall || {};
    const overallMeta = resolveOverallServiceStatusMeta(data);
    const licenseMeta = licenseStatusMeta(data.license || {});
    const availability = overall.availability == null ? '—' : `${Number(overall.availability).toFixed(2)}%`;
    const canInspectFailures = canInspectServiceFailures();
    const failureStat = (kind, label, count, statusClass) => canInspectFailures
        ? `<button type="button" class="service-status-stat ${kind} service-status-clickable" onclick="openServiceFailureModal('','','${statusClass}')"><small>${label}</small><strong>${Number(count || 0).toLocaleString()}</strong><em>${serviceStatusBi('点击查看明细', 'View details')}</em></button>`
        : `<div class="service-status-stat ${kind}"><small>${label}</small><strong>${Number(count || 0).toLocaleString()}</strong></div>`;
    const cards = (data.services || []).map(service => {
        const meta = serviceStateMeta(service.currentState);
        const serviceAvailability = service.summary?.availability == null ? '—' : `${Number(service.summary.availability).toFixed(2)}%`;
        const bars = (service.history || []).map(day => {
            const title = `${day.date} · ${serviceStateMeta(day.state).label}\n${serviceStatusBi('请求', 'Requests')}: ${day.requests} · ${serviceStatusBi('成功', 'Success')}: ${day.successes} · 4xx: ${day.clientErrors} · 5xx: ${day.serverErrors}\n${serviceStatusBi('平均响应', 'Avg response')}: ${day.averageDurationMs}ms\n${canInspectFailures ? serviceStatusBi('点击查看失败请求明细', 'Click to view failed request details') : ''}`;
            const clickable = canInspectFailures;
            const action = clickable ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','${navEscape(day.date)}','')"` : '';
            return `<button type="button" class="service-day-bar ${navEscape(day.state)} ${clickable ? 'clickable' : ''}" title="${navEscape(title)}" aria-label="${navEscape(title)}"${action}></button>`;
        }).join('');
        const name = window.ToolsI18n?.getLanguage?.() === 'en-US' ? service.nameEn : service.name;
        const description = window.ToolsI18n?.getLanguage?.() === 'en-US' ? service.descriptionEn : service.description;
        const cardClickAttr = canInspectFailures ? ` style="cursor:pointer;" title="${serviceStatusBi('点击查看该服务失败明细', 'Click to view failures for this service')}"` : '';
        return `
            <article class="service-status-card" data-service-status-key="${navEscape(service.id)}" data-service-status-name="${navEscape(name)}">
                <div class="service-status-card-head"${cardClickAttr}${canInspectFailures ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','','')"` : ''}>
                    <div><h3>${navEscape(name)}</h3><p>${navEscape(description)}</p></div>
                    <span class="service-state-icon ${navEscape(service.currentState)}" title="${navEscape(meta.label)}">${meta.icon}</span>
                </div>
                <div class="service-status-bars" style="--status-days:${data.days}">${bars}</div>
                <div class="service-status-axis"><span>${navEscape(data.startDate)}</span><b>${serviceAvailability} ${serviceStatusBi('可用率', 'availability')}</b><span>${navEscape(data.endDate)}</span></div>
                <div class="service-status-card-foot"${cardClickAttr}${canInspectFailures ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','','')"` : ''}><span class="service-state-label ${navEscape(service.currentState)}">${navEscape(meta.label)}</span><span>${Number(service.summary?.requests || 0).toLocaleString()} ${serviceStatusBi('次请求', 'requests')}</span><span>${Number(service.summary?.averageDurationMs || 0)}ms ${serviceStatusBi('平均', 'avg')}</span></div>
            </article>`;
    }).join('');
    content.innerHTML = `
        <section class="service-status-overview">
            <div class="service-status-current ${navEscape(overallMeta.state)} ${canInspectFailures ? 'service-status-clickable' : ''}" ${canInspectFailures ? 'onclick="openServiceFailureModal(\'\',\'\',\'\')"' : ''}><span class="service-state-icon ${navEscape(overallMeta.state)}">${overallMeta.icon}</span><div><small>${serviceStatusBi('当前状态', 'Current status')}</small><strong>${navEscape(overallMeta.label)}</strong><em class="${overallMeta.hasIssue ? 'warning' : ''}" title="${navEscape(overallMeta.detail)}">${navEscape(overallMeta.detail)}</em></div></div>
            <div class="service-status-license ${navEscape(licenseMeta.state)}"><span class="service-state-icon ${navEscape(licenseMeta.state)}">${licenseMeta.icon}</span><div><small>${serviceStatusBi('License 可用状态', 'License availability')}</small><strong>${navEscape(licenseMeta.label)}</strong><em title="${navEscape(licenseMeta.detail)}">${navEscape(licenseMeta.detail)}</em></div></div>
            <div class="service-status-stat ${canInspectFailures ? 'service-status-clickable' : ''}" ${canInspectFailures ? 'onclick="openServiceFailureModal(\'\',\'\',\'\')"' : ''}><small>${serviceStatusBi('可用率', 'Availability')}</small><strong>${availability}</strong></div>
            <div class="service-status-stat ${canInspectFailures ? 'service-status-clickable' : ''}" ${canInspectFailures ? 'onclick="openServiceFailureModal(\'\',\'\',\'\')"' : ''}><small>${serviceStatusBi('成功返回', 'Successful')}</small><strong>${Number(overall.successes || 0).toLocaleString()}</strong></div>
            ${failureStat('warning', serviceStatusBi('客户端失败 4xx', 'Client errors 4xx'), overall.clientErrors, '4xx')}
            ${failureStat('danger', serviceStatusBi('服务端失败 5xx', 'Server errors 5xx'), overall.serverErrors, '5xx')}
        </section>
        ${Number(overall.requests || 0) ? '' : `<div class="service-status-notice">${serviceStatusBi('状态历史从本功能启用后开始累计；暂无历史请求时显示为灰色。', 'History starts accumulating after this feature is enabled; days without requests are gray.')}</div>`}
        <section class="service-status-grid">${cards}</section>
        <div class="service-status-legend"><span><i class="operational"></i>${serviceStatusBi('正常', 'Operational')}</span><span><i class="degraded"></i>${serviceStatusBi('存在 4xx', 'Has 4xx')}</span><span><i class="incident"></i>${serviceStatusBi('存在 5xx', 'Has 5xx')}</span><span><i class="no-data"></i>${serviceStatusBi('无请求数据', 'No requests')}</span><em>${serviceStatusBi('可用率按“非 5xx 请求 ÷ 全部请求”计算；正常登录拦截不计入 4xx 异常。', 'Availability is calculated as non-5xx requests divided by all requests; expected login responses are excluded from 4xx failures.')}</em></div>
        ${renderChannelsWatchdogHtml(data.channels, canInspectFailures)}`;
}

window.loadServiceStatusHistory = async function (isLiveRefresh = false) {
    if (serviceStatusView !== 'overview') return;
    const modal = ensureServiceStatusModal();
    if (modal.style.display !== 'flex') return;
    if (isLiveRefresh && (document.hidden || serviceStatusRequestPending)) return;
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    const requestSeq = ++serviceStatusRequestSeq;
    serviceStatusRequestPending = true;
    if (!isLiveRefresh) {
        range.innerHTML = [30, 90, 180].map(days => `<button type="button" class="${days === serviceStatusDays ? 'active' : ''}" onclick="setServiceStatusDays(${days})">${days} ${serviceStatusBi('天', 'days')}</button>`).join('');
        content.innerHTML = `<div class="service-status-loading"><span></span>${serviceStatusBi('正在读取服务状态…', 'Loading service status…')}</div>`;
    }
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status?days=${serviceStatusDays}`);
        if (requestSeq !== serviceStatusRequestSeq || serviceStatusView !== 'overview' || modal.style.display !== 'flex') return;
        const scrollTop = content.scrollTop;
        renderServiceStatusHistory(data);
        if (isLiveRefresh) content.scrollTop = scrollTop;
    } catch (error) {
        if (requestSeq !== serviceStatusRequestSeq || serviceStatusView !== 'overview' || modal.style.display !== 'flex' || isLiveRefresh) return;
        content.innerHTML = `<div class="service-status-error"><strong>${serviceStatusBi('服务状态读取失败', 'Unable to load service status')}</strong><p>${navEscape(error.message)}</p><button type="button" onclick="loadServiceStatusHistory()">${serviceStatusBi('重试', 'Retry')}</button></div>`;
    } finally {
        if (requestSeq === serviceStatusRequestSeq) serviceStatusRequestPending = false;
    }
};

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('serviceFailureModal')?.style.display === 'flex') window.closeServiceFailureModal();
    else if (document.getElementById('serviceStatusModal')?.style.display === 'flex') window.closeServiceStatusModal();
});

function ensureToolsI18nLoaded() {
    if (window.ToolsI18n) return Promise.resolve();
    return new Promise((resolve) => {
        const existing = document.querySelector('script[src^="./tp-static/frontend/js/shared/i18n.js"]');
        if (existing) {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', resolve, { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = './tp-static/frontend/js/shared/i18n.js';
        script.onload = resolve;
        script.onerror = resolve;
        document.head.appendChild(script);
    });
}

function ensureMigrationStatusLoaded() {
    if (document.querySelector('script[src^="./tp-static/frontend/js/shared/migration-status.js"]')) return;
    const script = document.createElement('script');
    script.src = './tp-static/frontend/js/shared/migration-status.js';
    document.head.appendChild(script);
}

function trackCurrentToolOpen() {
    const pathname = (window.__TP_STATIC_PATH__ || window.location.pathname).replace(/\/+$/, '') || '/';
    const builtinTools = new Set([
        'uivf12', 'sla', 'report', 'expedite', 'monthly', 'bigscreen',
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

    function queueVisibilityUpdate(event) {
        const target = event && event.target;
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

let builtinToolsSyncChecking = false;
let builtinToolsCompareAbort = null;
const BUILTIN_TOOLS_SYNC_SNOOZE_KEY = 'builtin_tools_sync_snooze_date_v1';

function getBuiltinToolsSyncLocalDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isBuiltinToolsSyncSnoozedToday() {
    try {
        return localStorage.getItem(BUILTIN_TOOLS_SYNC_SNOOZE_KEY) === getBuiltinToolsSyncLocalDate();
    } catch (_) {
        return false;
    }
}

function snoozeBuiltinToolsSyncForToday() {
    try {
        localStorage.setItem(BUILTIN_TOOLS_SYNC_SNOOZE_KEY, getBuiltinToolsSyncLocalDate());
    } catch (_) { /* 隐私模式或存储受限时仍允许关闭当前弹窗 */ }
}

function formatBuiltinToolBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function builtinToolStatusMeta(status) {
    return {
        missing: { label: navLocaleText('新增系统工具', 'New System Tool'), tone: 'new' },
        adopt: { label: navLocaleText('接管同版工具', 'Adopt Identical Version'), tone: 'adopt' },
        update: { label: navLocaleText('内容有差异', 'Content Differs'), tone: 'update' },
        conflict: { label: navLocaleText('同名工具冲突', 'Name Conflict'), tone: 'conflict' }
    }[status] || { label: navLocaleText('存在差异', 'Has Differences'), tone: 'update' };
}

function builtinToolChangeLabel(type) {
    return {
        added: navLocaleText('新增', 'Added'),
        modified: navLocaleText('修改', 'Modified'),
        removed: navLocaleText('删除', 'Deleted'),
        preserved: navLocaleText('保留', 'Preserved'),
        unchanged: navLocaleText('未变', 'Unchanged')
    }[type] || type;
}

function renderBuiltinToolDiff(tool) {
    const visibleChanges = (tool.changes || []).filter(item => item.type !== 'unchanged');
    const unchangedCount = tool.counts && tool.counts.unchanged || 0;
    const metadataRow = tool.metadataChanged
        ? `<div class="builtin-sync-file-row is-metadata">
            <span class="builtin-sync-change is-modified">${navEscape(navLocaleText('版本', 'Version'))}</span>
            <code title="${navEscape(navLocaleText('系统工具版本标识', 'System tool version metadata'))}">${navEscape(navLocaleText('系统工具版本标识', 'System tool version metadata'))}</code>
            <span class="builtin-sync-file-size">${navEscape(navLocaleText('需要同步', 'Sync required'))}</span>
        </div>`
        : '';
    if (!visibleChanges.length && !unchangedCount && !metadataRow) {
        return `<div class="builtin-sync-empty-diff">${navEscape(navLocaleText('仅更新系统工具标识，不改动工具文件。', 'Only updates tool metadata; tool files are unchanged.'))}</div>`;
    }
    const rows = visibleChanges.map(item => `
        <div class="builtin-sync-file-row">
            <span class="builtin-sync-change is-${navEscape(item.type)}">${navEscape(builtinToolChangeLabel(item.type))}</span>
            <code title="${navEscape(item.path)}">${navEscape(item.path)}</code>
            <span class="builtin-sync-file-size">${formatBuiltinToolBytes(item.oldSize)} → ${formatBuiltinToolBytes(item.newSize)}</span>
        </div>
    `).join('');
    const unchanged = unchangedCount
        ? `<div class="builtin-sync-unchanged">${navEscape(navLocaleText(`${unchangedCount} 个相同文件不会重复说明`, `${unchangedCount} identical file(s) omitted`))}</div>`
        : '';
    return rows + metadataRow + unchanged;
}

function closeBuiltinToolsSyncModal() {
    const modal = document.getElementById('builtinToolsSyncModal');
    if (modal?.dataset.applying === '1') return;
    if (builtinToolsCompareAbort) {
        try { builtinToolsCompareAbort.abort(); } catch (_) {}
        builtinToolsCompareAbort = null;
    }
    const button = document.getElementById('builtinToolsCompareBtn');
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    builtinToolsSyncChecking = false;
    if (modal) modal.remove();
}

async function fetchBuiltinToolsPreviewWithProgress(onProgress, signal) {
    try {
        const response = await fetch('/api/custom-tools/builtin-sync/preview-stream?manual=1', {
            headers: { ...getAuthHeaderForNav() },
            signal
        });
        if (response.ok && response.body?.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let result = null;
            const consume = line => {
                if (!line.trim()) return;
                const event = JSON.parse(line);
                if (event.type === 'progress') onProgress(event);
                else if (event.type === 'result') result = event.data;
                else if (event.type === 'error') throw new Error(event.error);
            };
            while (true) {
                const { done, value } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                let newline;
                while ((newline = buffer.indexOf('\n')) !== -1) {
                    consume(buffer.slice(0, newline));
                    buffer = buffer.slice(newline + 1);
                }
                if (done) break;
            }
            consume(buffer);
            if (result) return result;
        }
    } catch (err) {
        if (signal?.aborted) throw err;
        // 降级为普通请求
    }
    return await API.get('/api/custom-tools/builtin-sync/preview?manual=1');
}

function renderBuiltinToolsCompareProgress(modal, event) {
    if (!modal || modal.dataset.loading !== '1') return;
    const total = Math.max(1, Number(event.total) || 1);
    const current = Math.min(total, Math.max(0, Number(event.current) || 0));
    const percent = Math.round((current / total) * 100);
    const titleEl = modal.querySelector('.builtin-sync-loading-title');
    const percentEl = modal.querySelector('.builtin-sync-loading-percent');
    const barEl = modal.querySelector('.builtin-sync-loading-bar');
    const barFill = modal.querySelector('.builtin-sync-loading-bar i');
    const detailEl = modal.querySelector('.builtin-sync-loading-detail');
    const resultEl = modal.querySelector('.builtin-sync-result');
    if (titleEl) {
        titleEl.textContent = navLocaleText(
            `正在比对系统内置工具 · ${current}/${total}`,
            `Comparing bundled tools · ${current}/${total}`
        );
    }
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (barEl) barEl.setAttribute('aria-valuenow', String(percent));
    if (barFill) barFill.style.transform = `scaleX(${current / total})`;
    const toolText = event.name || event.slug ? `${event.name || event.slug}${event.slug && event.name !== event.slug ? ` (${event.slug})` : ''}` : '';
    if (detailEl) {
        detailEl.textContent = toolText ? navLocaleText(`正在检查：${toolText}`, `Checking: ${toolText}`) : navLocaleText('正在检索文件指纹与修改…', 'Scanning fingerprints and changes…');
    }
    if (resultEl && toolText) {
        resultEl.textContent = navLocaleText(`比对进度 (${current}/${total})：${toolText}`, `Progress (${current}/${total}): ${toolText}`);
    }
}

function renderBuiltinToolsCompareError(modal, error, onRetry) {
    if (!modal) return;
    modal.dataset.loading = '0';
    const list = modal.querySelector('.builtin-sync-list');
    if (list) {
        list.innerHTML = `
            <div class="builtin-sync-error-card">
                <strong>⚠️ ${navEscape(navLocaleText('读取内置工具比对失败', 'Failed to Compare Bundled Tools'))}</strong>
                <p>${navEscape(error?.message || navLocaleText('网络连接超时或服务未就绪，请重试。', 'Connection timed out or service unavailable. Please retry.'))}</p>
                <div><button type="button" class="builtin-sync-retry">${navEscape(navLocaleText('重新比对', 'Retry Comparison'))}</button></div>
            </div>
        `;
        list.querySelector('.builtin-sync-retry')?.addEventListener('click', () => {
            if (typeof onRetry === 'function') onRetry();
        });
    }
    const resultEl = modal.querySelector('.builtin-sync-result');
    if (resultEl) resultEl.textContent = navLocaleText('比对失败，请重试。', 'Comparison failed. Please retry.');
}

async function applyBuiltinToolsWithProgress(body, onProgress) {
    const response = await fetch('/api/custom-tools/builtin-sync/apply-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        if (typeof handleResponse === 'function') return handleResponse(response);
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${response.status}`);
    }
    if (!response.body?.getReader) throw new Error(navLocaleText('当前浏览器不支持更新进度，请重新检查更新状态。', 'This browser cannot display update progress. Please check update status again.'));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result;
    const consume = line => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === 'progress') onProgress(event);
        else if (event.type === 'result') result = event.data;
        else if (event.type === 'error') throw new Error(event.error);
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                consume(buffer.slice(0, newline));
                buffer = buffer.slice(newline + 1);
            }
            if (done) break;
        }
        consume(buffer);
        if (!result) throw new Error(navLocaleText('更新连接中断，服务端可能仍在处理，请稍后重新检查。', 'The connection ended. The server may still be updating; check again shortly.'));
        return result;
    } finally {
        reader.releaseLock();
    }
}

function renderBuiltinToolsSyncProgress(modal, event) {
    const previous = modal.syncProgress || {};
    const progress = { ...previous, ...event };
    const total = Math.max(1, Number(progress.total) || 0);
    const completed = Number(progress.completed) || 0;
    const fileFraction = progress.stage === 'copying' && progress.filesTotal
        ? progress.filesCompleted / progress.filesTotal : 0;
    const percent = progress.stage === 'done' ? 100
        : progress.stage === 'indexing' ? 96
            : progress.stage === 'saving' ? 92
                : progress.stage === 'validating' ? 10 * (progress.checked || 0) / total
                    : 10 + 80 * (completed + fileFraction) / total;
    // Phase weights describe overall progress; advance only on actual worker events.
    progress.percent = Math.min(100, Math.max(previous.percent || 0, Math.round(percent)));
    modal.syncProgress = progress;
    const labels = {
        validating: navLocaleText(`正在校验版本 · ${progress.checked || 0}/${progress.total || 0}`, `Checking versions · ${progress.checked || 0}/${progress.total || 0}`),
        backing_up: navLocaleText('正在备份旧版与保留用户文件', 'Backing up old version and preserving user files'),
        copying: navLocaleText(`正在复制程序文件 · ${progress.filesCompleted || 0}/${progress.filesTotal || 0}`, `Copying application files · ${progress.filesCompleted || 0}/${progress.filesTotal || 0}`),
        tool_complete: navLocaleText(`已处理 ${completed}/${progress.total || 0} 个工具`, `Processed ${completed}/${progress.total || 0} tools`),
        saving: navLocaleText('正在保存处理结果', 'Saving update results'),
        indexing: navLocaleText('正在刷新工具索引', 'Refreshing tool index'),
        done: navLocaleText('处理完成', 'Complete')
    };
    const panel = modal.querySelector('.builtin-sync-progress');
    panel.hidden = false;
    panel.querySelector('.builtin-sync-progress-label').textContent = labels[progress.stage] || labels.validating;
    panel.querySelector('.builtin-sync-progress-percent').textContent = `${progress.percent}%`;
    const bar = panel.querySelector('[role="progressbar"]');
    bar.setAttribute('aria-valuenow', String(progress.percent));
    bar.setAttribute('aria-label', navLocaleText('系统工具更新进度', 'System tool update progress'));
    bar.querySelector('i').style.transform = `scaleX(${progress.percent / 100})`;
    const tool = lastBuiltinToolsSyncPreview?.pending?.find(item => item.slug === progress.slug);
    const toolPosition = ['backing_up', 'copying'].includes(progress.stage)
        ? navLocaleText(`第 ${completed + 1}/${progress.total} 个`, `Tool ${completed + 1}/${progress.total}`) : '';
    panel.querySelector('.builtin-sync-progress-detail').textContent = progress.slug && !['saving', 'indexing', 'done'].includes(progress.stage)
        ? [tool?.name || progress.slug, toolPosition, progress.slug].filter(Boolean).join(' · ')
        : navLocaleText('请保持页面打开，完成后将自动刷新。', 'Keep this page open. It will refresh when the update finishes.');
}

function openBuiltinToolsSyncModal(preview, selectedSlugs) {
    if (document.getElementById('builtinToolsSyncModal')?.dataset.applying === '1') return;
    const tools = Array.isArray(preview?.pending) ? preview.pending : [];
    const manual = preview?.manual === true;
    const loading = preview?.loading === true;
    if (!tools.length && !manual && !loading) return;
    lastBuiltinToolsSyncPreview = preview;

    let modal = document.getElementById('builtinToolsSyncModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'builtinToolsSyncModal';
        modal.className = 'builtin-sync-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'builtinToolsSyncTitle');
        document.body.appendChild(modal);
    }
    delete modal.dataset.needsRefresh;
    delete modal.dataset.applying;
    modal.dataset.loading = loading ? '1' : '0';

    if (loading) {
        modal.innerHTML = `
            <div class="builtin-sync-window">
                <header class="builtin-sync-head">
                    <div>
                        <div class="builtin-sync-kicker">SYSTEM TOOLS UPDATE</div>
                        <h2 id="builtinToolsSyncTitle">${navEscape(navLocaleText('正在比对系统内置工具…', 'Comparing Bundled Tools…'))}</h2>
                        <p>${navEscape(navLocaleText('正在检索系统随包内置工具并与当前环境比对差异，请稍候…', 'Scanning bundled tools and comparing differences with in-use versions, please wait…'))}</p>
                    </div>
                    <button type="button" class="builtin-sync-close" aria-label="${navEscape(navLocaleText('稍后处理', 'Dismiss'))}">×</button>
                </header>
                <div class="builtin-sync-safe-note">
                    <span>🛡️</span>
                    <div><strong>${navEscape(navLocaleText('工具业务数据不会被覆盖', 'Tool business data will not be overwritten'))}</strong><br>${navEscape(navLocaleText('仅同步工具程序文件；用户额外文件会保留，被替换的旧目录也会备份到数据目录。', 'Only tool application files are synced. Custom user files are preserved, and replaced folders are backed up to the data directory.'))}</div>
                </div>
                <div class="builtin-sync-toolbar">
                    <span>${navEscape(navLocaleText('正在比对中…', 'Comparing...'))}</span>
                </div>
                <div class="builtin-sync-list">
                    <div class="builtin-sync-loading">
                        <div class="builtin-sync-loading-card">
                            <div class="builtin-sync-loading-head">
                                <div class="builtin-sync-spinner" aria-hidden="true"></div>
                                <div class="builtin-sync-loading-title">${navEscape(navLocaleText('正在比对系统内置工具…', 'Comparing bundled tools…'))}</div>
                                <div class="builtin-sync-loading-percent">0%</div>
                            </div>
                            <div class="builtin-sync-loading-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                                <i></i>
                            </div>
                            <div class="builtin-sync-loading-detail">${navEscape(navLocaleText('准备开始比对…', 'Preparing comparison…'))}</div>
                        </div>
                        <div class="builtin-sync-skeleton-list" aria-hidden="true">
                            <div class="builtin-sync-skeleton-card"></div>
                            <div class="builtin-sync-skeleton-card"></div>
                            <div class="builtin-sync-skeleton-card"></div>
                        </div>
                    </div>
                </div>
                <footer class="builtin-sync-footer">
                    <div class="builtin-sync-feedback">
                        <span class="builtin-sync-result" aria-live="polite">${navEscape(navLocaleText('正在比对系统内置工具与本地工具差异…', 'Comparing bundled tools with in-use versions…'))}</span>
                    </div>
                    <button type="button" class="builtin-sync-later">${navEscape(navLocaleText('关闭', 'Close'))}</button>
                    <button type="button" class="builtin-sync-today" hidden>${navEscape(navLocaleText('今天不再提醒', 'Don\'t Remind Today'))}</button>
                    <button type="button" class="builtin-sync-apply" disabled>${navEscape(navLocaleText('强制使用随包版本', 'Use Bundled Versions'))}</button>
                </footer>
            </div>
        `;
        const close = () => closeBuiltinToolsSyncModal();
        modal.querySelector('.builtin-sync-close').addEventListener('click', close);
        modal.querySelector('.builtin-sync-later').addEventListener('click', close);
        modal.addEventListener('click', event => {
            if (event.target === modal) close();
        });
        return;
    }

    const toolCards = tools.map(tool => {
        const status = builtinToolStatusMeta(tool.status);
        const counts = tool.counts || {};
        const diffCount = (counts.added || 0) + (counts.modified || 0) + (counts.removed || 0) + (counts.preserved || 0);
        const diffSummary = diffCount
            ? navLocaleText(`${diffCount} 项文件差异`, `${diffCount} file difference(s)`)
            : tool.metadataChanged
                ? navLocaleText('仅版本标识不同', 'Only version metadata differs')
                : navLocaleText('无文件差异', 'No file differences');
        const conflictNotice = tool.status === 'conflict'
            ? `<div class="builtin-sync-conflict-note">${navEscape(navLocaleText('此目录不是系统管理版本，可能是同名自定义工具，请结合版本和大小确认是否替换。', 'This directory is not system-managed and may be a custom tool with the same name. Review its release information and size before replacing.'))}</div>`
            : tool.localChanges ? `<div class="builtin-sync-conflict-note">${navEscape(navLocaleText('检测到本地修改或旧版校验信息不完整，请结合下方版本信息确认。处理前不会修改当前工具，旧目录会先备份。', 'Local changes or incomplete legacy verification data were detected. Review the release information below; applying a selection backs up the old folder first.'))}</div>` : '';
        const toolInfoDiff = tool.toolInfoChanged && tool.oldTool && tool.newTool
            ? `<div class="builtin-sync-info-diff">
                <span>${navEscape(navLocaleText('旧信息', 'Old'))}：${navEscape(tool.oldTool.icon)} ${navEscape(tool.oldTool.name)}</span>
                <span>→</span>
                <span>${navEscape(navLocaleText('新信息', 'New'))}：${navEscape(tool.newTool.icon)} ${navEscape(tool.newTool.name)}</span>
            </div>`
            : '';
        const isChecked = selectedSlugs ? selectedSlugs.has(tool.slug) : !manual && Boolean(tool.recommended);
        return `
            <article class="builtin-sync-card ${tool.status === 'conflict' ? 'is-conflict' : ''}" data-sync-slug="${navEscape(tool.slug)}">
                <label class="builtin-sync-tool-head">
                    <input type="checkbox" class="builtin-sync-choice" data-sync-slug="${navEscape(tool.slug)}" ${isChecked ? 'checked' : ''}>
                    <span class="builtin-sync-icon">${navEscape(tool.icon)}</span>
                    <span class="builtin-sync-tool-copy">
                        <strong>${navEscape(tool.name)}</strong>
                        <small>${navEscape(tool.slug)}</small>
                    </span>
                    <span class="builtin-sync-status is-${status.tone}">${navEscape(status.label)}</span>
                </label>
                ${conflictNotice}
                ${tool.recommendation ? `<div class="builtin-sync-versions">${navEscape(navLocaleText('建议依据', 'Recommendation'))}：${navEscape(({
                    'missing': navLocaleText('缺少内置工具或可接管的旧版', 'Missing tool or matching legacy version'),
                    'current-newer': navLocaleText('当前版本号或更新时间更新，建议保留', 'Current version or timestamp is newer; keep current'),
                    'custom-conflict': navLocaleText('同名自定义工具，需手动确认', 'Custom tool with the same name; review required'),
                    'market-choice': navLocaleText('保留已选择的市场版本', 'Keep the selected market release'),
                    'newer-larger': navLocaleText('内置版本更新，整体程序体积也有增加', 'Bundled release is newer and its program size increased'),
                    'newer-release': navLocaleText('内置版本号或更新时间更新', 'Bundled version or timestamp is newer'),
                    'larger-release': navLocaleText('版本信息未显示降级，内置整体程序体积增加', 'No older release metadata; bundled program size increased'),
                    'current-larger': navLocaleText('当前程序体积更大，且内置版本信息未显示更新，建议保留', 'Current program size is larger with no newer bundled metadata; keep current'),
                    'local-changes': navLocaleText('有本地修改，暂不建议覆盖', 'Local changes need review'),
                    'content-update': navLocaleText('程序内容更新', 'Program contents changed')
                })[tool.recommendation.reason] || '')}</div>` : ''}
                ${toolInfoDiff}
                ${`<div class="builtin-sync-versions">${navEscape(navLocaleText('当前来源', 'Current source'))}：${navEscape(tool.currentSource === 'market' ? navLocaleText('工具市场', 'Tool market') : navLocaleText('本地工具', 'Local tool'))} · ${navEscape(tool.currentReleaseVersion || '—')} · ${navEscape(tool.currentUpdatedAt || tool.currentVersion || '—')} → ${navEscape(navLocaleText('随包内置', 'Bundled'))} · ${navEscape(tool.bundledReleaseVersion || '—')} · ${navEscape(tool.bundledUpdatedAt || tool.bundledVersion || '—')}</div>`}
                <div class="builtin-sync-metrics">
                    <span>${navEscape(navLocaleText('当前使用', 'In use'))} <b>${formatBuiltinToolBytes(tool.currentReleaseBytes ?? tool.oldBytes)}</b></span>
                    <span class="builtin-sync-arrow">→</span>
                    <span>${navEscape(navLocaleText('随包内置', 'Bundled'))} <b>${formatBuiltinToolBytes(tool.bundledReleaseBytes ?? tool.newBytes)}</b></span>
                    <span class="builtin-sync-counts">+${counts.added || 0} / ~${counts.modified || 0} / −${counts.removed || 0} / ${navEscape(navLocaleText('保留', 'Preserved'))} ${counts.preserved || 0}</span>
                </div>
                <details class="builtin-sync-details" ${tool.status === 'conflict' ? 'open' : ''}>
                    <summary>${navEscape(navLocaleText(`查看当前与随包版本比对（${diffSummary}）`, `Compare in-use and bundled versions (${diffSummary})`))}</summary>
                    <div class="builtin-sync-file-list"></div>
                </details>
            </article>
        `;
    }).join('') || `<div class="builtin-sync-empty-diff">${navEscape(navLocaleText('当前工具与随包内置版本一致，没有需要替换的工具。', 'Installed tools match the bundled versions. No replacement is needed.'))}</div>`;

    modal.innerHTML = `
        <div class="builtin-sync-window">
            <header class="builtin-sync-head">
                <div>
                    <div class="builtin-sync-kicker">SYSTEM TOOLS UPDATE</div>
                    <h2 id="builtinToolsSyncTitle">${navEscape(manual ? navLocaleText('内置工具差异比对', 'Compare Bundled Tools') : navLocaleText('发现系统内置工具差异', 'Built-in System Tools Updates Available'))}</h2>
                    <p>${navEscape(manual ? navLocaleText('按需选择工具，强制使用当前主程序随包版本（可能是旧版）。未选择的工具保持不变。', 'Select tools to replace with this app’s bundled versions, which may be older. Unselected tools remain unchanged.') : navLocaleText('请选择要覆盖或安装的工具。未勾选项会保留现状，并在该内置版本不变时不再提醒。', 'Select tools to update or install. Unselected tools will remain as-is and won\'t prompt again unless updated.'))}</p>
                </div>
                <button type="button" class="builtin-sync-close" aria-label="${navEscape(navLocaleText('稍后处理', 'Dismiss'))}">×</button>
            </header>
            <div class="builtin-sync-safe-note">
                <span>🛡️</span>
                <div><strong>${navEscape(navLocaleText('工具业务数据不会被覆盖', 'Tool business data will not be overwritten'))}</strong><br>${navEscape(navLocaleText('仅同步工具程序文件；用户额外文件会保留，被替换的旧目录也会备份到数据目录。', 'Only tool application files are synced. Custom user files are preserved, and replaced folders are backed up to the data directory.'))}</div>
            </div>
            <div class="builtin-sync-toolbar">
                <span>${navEscape(navLocaleText(`共 ${tools.length} 个待处理工具`, `${tools.length} pending tool(s)`))}</span>
                <button type="button" data-sync-select="recommended">${navEscape(navLocaleText('选择建议项', 'Select Recommended'))}</button>
                <button type="button" data-sync-select="none">${navEscape(navLocaleText('全部取消', 'Deselect All'))}</button>
            </div>
            <div class="builtin-sync-list">${toolCards}</div>
            <footer class="builtin-sync-footer">
                <div class="builtin-sync-feedback">
                <div class="builtin-sync-progress" hidden>
                    <div class="builtin-sync-progress-head"><strong class="builtin-sync-progress-label" aria-live="polite"></strong><span class="builtin-sync-progress-percent">0%</span></div>
                    <div class="builtin-sync-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
                    <div class="builtin-sync-progress-detail"></div>
                </div>
                <span class="builtin-sync-result" aria-live="polite">${navEscape(manual ? navLocaleText('默认不选；强制替换前会备份当前目录，业务数据库与用户额外文件保留。', 'Nothing is selected by default. Current folders are backed up before replacement; business databases and extra user files are preserved.') : navLocaleText('冲突项默认保留旧版，您仍可手动勾选覆盖。', 'Conflicts keep old version by default. You can manually select to overwrite.'))}</span>
                </div>
                <button type="button" class="builtin-sync-later">${navEscape(manual ? navLocaleText('关闭', 'Close') : navLocaleText('稍后提醒', 'Remind Later'))}</button>
                <button type="button" class="builtin-sync-today" ${manual ? 'hidden' : ''}>${navEscape(navLocaleText('今天不再提醒', 'Don\'t Remind Today'))}</button>
                <button type="button" class="builtin-sync-apply" ${!tools.length ? 'disabled' : ''}>${navEscape(manual ? navLocaleText('强制使用随包版本', 'Use Bundled Versions') : navLocaleText('按选择处理', 'Apply Selected'))}</button>
            </footer>
        </div>
    `;
    document.body.appendChild(modal);

    // Collapsed comparisons can contain thousands of files; create rows on demand.
    modal.querySelectorAll('.builtin-sync-details').forEach((details, index) => {
        const renderDiff = () => {
            if (!details.open || details.dataset.loaded) return;
            details.dataset.loaded = '1';
            details.querySelector('.builtin-sync-file-list').innerHTML = renderBuiltinToolDiff(tools[index]);
        };
        details.addEventListener('toggle', renderDiff);
        renderDiff();
    });

    const close = () => closeBuiltinToolsSyncModal();
    modal.querySelector('.builtin-sync-close').addEventListener('click', close);
    modal.querySelector('.builtin-sync-later').addEventListener('click', close);
    modal.querySelector('.builtin-sync-today').addEventListener('click', () => {
        snoozeBuiltinToolsSyncForToday();
        close();
    });
    modal.addEventListener('click', event => {
        if (event.target === modal) close();
    });
    modal.querySelector('[data-sync-select="recommended"]').addEventListener('click', () => {
        modal.querySelectorAll('.builtin-sync-choice').forEach((input, index) => {
            input.checked = Boolean(tools[index] && tools[index].recommended);
        });
    });
    modal.querySelector('[data-sync-select="none"]').addEventListener('click', () => {
        modal.querySelectorAll('.builtin-sync-choice').forEach(input => {
            input.checked = false;
        });
    });
    modal.querySelector('.builtin-sync-apply').addEventListener('click', async event => {
        const button = event.currentTarget;
        const resultNode = modal.querySelector('.builtin-sync-result');
        if (modal.dataset.applying === '1') return;
        if (modal.dataset.needsRefresh === '1') {
            button.disabled = true;
            try {
                const refreshed = await API.get(manual ? '/api/custom-tools/builtin-sync/preview?manual=1' : '/api/custom-tools/builtin-sync/preview');
                if (refreshed.pending?.length || manual) openBuiltinToolsSyncModal(refreshed);
                else window.location.reload();
            } catch (error) {
                resultNode.textContent = error.message;
            } finally { button.disabled = false; }
            return;
        }
        const selected = new Set(
            [...modal.querySelectorAll('.builtin-sync-choice:checked')].map(input => input.dataset.syncSlug)
        );
        const applySlugs = tools.filter(tool => selected.has(tool.slug)).map(tool => tool.slug);
        if (manual && !applySlugs.length) {
            resultNode.textContent = navLocaleText('请先勾选需要替换的工具。', 'Select tools to replace first.');
            return;
        }
        const skipSlugs = manual ? [] : tools.filter(tool => !selected.has(tool.slug)).map(tool => tool.slug);
        const expectedFingerprints = Object.fromEntries(tools.map(tool => [tool.slug, tool.fingerprint]));
        modal.dataset.applying = '1';
        modal.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
        button.textContent = navLocaleText('正在处理…', 'Processing…');
        resultNode.textContent = '';
        renderBuiltinToolsSyncProgress(modal, { stage: 'validating', checked: 0, completed: 0, total: tools.length });
        try {
            const result = await applyBuiltinToolsWithProgress({
                applySlugs,
                skipSlugs,
                expectedFingerprints,
                ...(manual ? { forceBundled: true } : {})
            }, progress => renderBuiltinToolsSyncProgress(modal, progress));
            renderBuiltinToolsSyncProgress(modal, { stage: 'done' });
            const changed = result.installed.length + result.adopted.length + result.updated.length;
            const failed = Array.isArray(result.invalid) ? result.invalid : [];
            resultNode.textContent = failed.length
                ? navLocaleText(
                    `部分处理失败：${failed.map(item => `${item.slug}（${item.error}）`).join('；')}。成功 ${changed} 个，保留 ${result.skipped.length} 个。`,
                    `Partial failure: ${failed.map(item => `${item.slug} (${item.error})`).join('; ')}. Succeeded: ${changed}, Kept: ${result.skipped.length}.`
                )
                : navLocaleText(
                    `处理完成：更新/安装 ${changed} 个，保留 ${result.skipped.length} 个。`,
                    `Complete: updated/installed ${changed}, kept ${result.skipped.length}.`
                );
            if (changed) {
                setTimeout(() => window.location.reload(), failed.length ? 1800 : 650);
            } else if (failed.length) {
                enableRecheck();
            } else {
                modal.dataset.applying = '0';
                setTimeout(close, 650);
            }
            if (failed.length) modal.querySelector('.builtin-sync-progress').classList.add('is-error');
        } catch (error) {
            resultNode.textContent = navLocaleText(`处理失败：${error.message || '未知错误'}`, `Processing failed: ${error.message || 'Unknown error'}`);
            modal.querySelector('.builtin-sync-progress').classList.add('is-error');
            enableRecheck();
        }
        function enableRecheck() {
            modal.dataset.applying = '0';
            modal.dataset.needsRefresh = '1';
            button.disabled = false;
            button.textContent = navLocaleText('重新检查', 'Check Again');
            modal.querySelector('.builtin-sync-close').disabled = false;
            modal.querySelector('.builtin-sync-later').disabled = false;
            modal.querySelector('.builtin-sync-today').disabled = false;
        }
    });
    setTimeout(() => modal.querySelector('.builtin-sync-choice')?.focus(), 0);
}

window.openBuiltinToolsComparison = async function () {
    // 内嵌工具共用外层平台的比对窗口，避免手动入口再打开一层弹窗。
    if (window.top !== window) {
        try { return window.top.openBuiltinToolsComparison?.(); } catch (_) { return; }
    }
    if (document.getElementById('builtinToolsSyncModal')?.dataset.applying === '1'
        || !isNavSuperAdmin()) return;

    const existingModal = document.getElementById('builtinToolsSyncModal');
    if (existingModal && existingModal.dataset.loading === '1') {
        existingModal.querySelector('.builtin-sync-close')?.focus();
        return;
    }

    const button = document.getElementById('builtinToolsCompareBtn');
    builtinToolsSyncChecking = true;
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }

    if (builtinToolsCompareAbort) {
        try { builtinToolsCompareAbort.abort(); } catch (_) {}
        builtinToolsCompareAbort = null;
    }
    const abortController = new AbortController();
    builtinToolsCompareAbort = abortController;

    // 先出画面：立即渲染内置工具差异比对弹窗与加载态
    openBuiltinToolsSyncModal({ manual: true, loading: true });
    const modal = document.getElementById('builtinToolsSyncModal');

    const runScan = async () => {
        try {
            const preview = await fetchBuiltinToolsPreviewWithProgress(progress => {
                renderBuiltinToolsCompareProgress(modal, progress);
            }, abortController.signal);
            if (abortController.signal.aborted) return;
            openBuiltinToolsSyncModal(preview);
        } catch (error) {
            if (abortController.signal.aborted) return;
            renderBuiltinToolsCompareError(modal, error, () => {
                if (modal) {
                    modal.dataset.loading = '1';
                    openBuiltinToolsSyncModal({ manual: true, loading: true });
                }
                runScan();
            });
        } finally {
            builtinToolsSyncChecking = false;
            if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
            if (builtinToolsCompareAbort === abortController) builtinToolsCompareAbort = null;
        }
    };

    runScan();
};

document.addEventListener('click', event => {
    if (event.target.closest('#builtinToolsCompareBtn')) void window.openBuiltinToolsComparison();
});

const BUILTIN_SYNC_CHECK_TTL_MS = 5 * 60 * 1000;

async function builtinSyncCheckCacheKey() {
    let version;
    try { version = await window.ToolsAppVersion?.get(); } catch (_) { return ''; }
    // 包版本变化后重新检查；没有版本信息时不跳过扫描。
    if (!version) return '';
    return 'tools_builtin_sync_check:' + JSON.stringify([
        localStorage.getItem('tools_user') || '',
        localStorage.getItem('tools_tenant_id') || 'default',
        version
    ]);
}

async function checkBuiltinToolsSync() {
    // 导航在首页和工具 iframe 中都会加载；全局自动提醒只由顶层页面负责。
    if (window.top !== window) return;
    const toolMarketOpened = () => document.getElementById('toolMarketBtn')?.dataset.opened === '1';
    if (toolMarketOpened()) return;
    if (
        builtinToolsSyncChecking
        || !isNavSuperAdmin()
        || isBuiltinToolsSyncSnoozedToday()
        || typeof API === 'undefined'
        || document.getElementById('builtinToolsSyncModal')
        || document.getElementById('defaultQuickStartModal')
        || document.getElementById('navSettingsModal')
    ) return;
    builtinToolsSyncChecking = true;
    try {
        const cacheKey = await builtinSyncCheckCacheKey();
        try {
            const checkedAt = Number(cacheKey && sessionStorage.getItem(cacheKey));
            const age = Date.now() - checkedAt;
            if (checkedAt > 0 && age >= 0 && age < BUILTIN_SYNC_CHECK_TTL_MS) return;
        } catch (_) { /* 无法使用会话存储时按原逻辑扫描 */ }
        const preview = await API.get('/api/custom-tools/builtin-sync/preview');
        // 仅记住“没有待更新项”的成功检查，不复用可能过时的更新清单。
        if (cacheKey && Array.isArray(preview?.pending) && !preview.pending.length) {
            try { sessionStorage.setItem(cacheKey, String(Date.now())); } catch (_) { /* noop */ }
        }
        if (!toolMarketOpened() && !isBuiltinToolsSyncSnoozedToday()
            && !document.getElementById('builtinToolsSyncModal')
            && !document.getElementById('defaultQuickStartModal')
            && !document.getElementById('navSettingsModal')
            && preview && Array.isArray(preview.pending) && preview.pending.length) {
            // 如果所有待处理项都显式带有文件统计且变更均为 0（+0 / ~0 / -0），仅为接管或元数据标识差异，不弹窗打扰用户
            const hasActionableTools = preview.pending.some(tool => {
                if (!tool || !tool.counts) return true;
                const c = tool.counts;
                return (c.added || 0) > 0 || (c.modified || 0) > 0 || (c.removed || 0) > 0;
            });
            if (hasActionableTools) {
                openBuiltinToolsSyncModal(preview);
            }
        }
    } catch (error) {
        console.warn('[custom-tools] 读取系统工具更新失败：', error.message);
    } finally {
        builtinToolsSyncChecking = false;
    }
}

let pageScrollbarIdleTimer;
window.addEventListener('scroll', () => {
    document.documentElement.classList.add('is-page-scrolling');
    clearTimeout(pageScrollbarIdleTimer);
    pageScrollbarIdleTimer = setTimeout(() => {
        document.documentElement.classList.remove('is-page-scrolling');
    }, 900);
}, { passive: true });

let navbarMounted = false;

function mountNavbarEarly() {
    if (navbarMounted) return;
    const hasTarget = document.getElementById('navbar-container') || document.getElementById('app-navbar') || document.body;
    if (!hasTarget) return;

    ensureMigrationStatusLoaded();
    registerNavbarI18n();
    hydrateNavigationFromCache();
    renderNavbar();
    navbarMounted = true;
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!navbarMounted) {
        mountNavbarEarly();
    }
    await ensureToolsI18nLoaded();
    registerNavbarI18n();
    // Repaint the entire bar, including action labels and titles, after language loading.
    renderNavbar();
    const navigationCacheReady = hydrateNavigationFromCache();
    if (!navigationCacheReady) await loadNavigationData();
    renderNavLinksFromState();
    syncNavUserSession();
    initBackToTopButton();
    if (navigationCacheReady) loadNavigationData();
    trackCurrentToolOpen();
    if (hasNavAuthToken()) {
        refreshAlertCenterBadge();
        startAlertCenterPolling(60000);
    }
    setTimeout(checkServerStatus, 500);
    const scheduleBuiltinToolsSync = () => setTimeout(checkBuiltinToolsSync, 8000);
    if (window.top === window) {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(scheduleBuiltinToolsSync, { timeout: 12000 });
        else scheduleBuiltinToolsSync();
    }
});

mountNavbarEarly();

// 全部平台页共用草稿提醒；组件自身排除 iframe，避免工具容器中重复提醒。
loadNavLazyScript('./tp-static/frontend/js/shared/ops-inbox.js', 'Ops inbox could not load').catch(() => {});

let navReloginPrompted = false;

async function promptNavRelogin() {
    if (navReloginPrompted) return;
    navReloginPrompted = true;
    const confirmed = await showNavbarConfirm({
        title: navT('nav.relogin.title'),
        message: navT('nav.relogin.message'),
        hint: navT('nav.relogin.hint'),
        confirmText: navT('nav.relogin.confirm'),
        cancelText: navT('nav.relogin.later'),
        tone: 'info',
        icon: '🔑'
    });
    if (confirmed) window.location.href = './login.html';
}

async function syncNavUserSession() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data && data.username) {
                const previousRole = localStorage.getItem('tools_role');
                const previousUser = localStorage.getItem('tools_user');
                const previousSuper = localStorage.getItem('tools_super');
                localStorage.setItem('tools_user', data.username);
                if (data.role) localStorage.setItem('tools_role', data.role);
                if (await syncTenantWorkspace(data)) return;
                const currentSuper = localStorage.getItem('tools_super');
                // 导航栏按本地角色渲染管理员入口（设置、租户管理）；服务端角色与渲染时不同就整条重绘。
                if ((data.role && data.role !== previousRole) || data.username !== previousUser || currentSuper !== previousSuper) {
                    renderNavbar();
                } else {
                    const userChipText = document.querySelector('.nav-user-chip .nav-action-text');
                    if (userChipText) {
                        userChipText.textContent = data.username;
                    }
                }
                if (typeof window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
                    try { window.dispatchEvent(new CustomEvent('tools:authchange')); } catch (_) {}
                }
                // 服务端 cookie 仍有效但浏览器本地没有 token（换了端口/清过站点数据）：依赖 token 的功能会失效，引导重新登录。
                if (!hasNavAuthToken()) promptNavRelogin();
            }
        } else if (res.status === 401) {
            stopAlertCenterPolling();
            const pathname = (window.__TP_STATIC_PATH__ || window.location.pathname);
            const isPublicPage = pathname === './login.html' || pathname === '/pages/login.html' ||
                pathname === '/privacy' || pathname === '/privacy.html' ||
                pathname === '/terms' || pathname === '/terms.html' ||
                pathname === '/cinema' || pathname === '/cinema.html';
            if (!isPublicPage) {
                window.location.replace('./login.html');
            }
        }
    } catch (_) {}
}

// EXE 授权角标在普通 Web 部署中会自动隐藏，仅桌面版本地服务显示。
if (!document.querySelector('script[data-desktop-license-badge]')) {
    const desktopLicenseBadgeScript = document.createElement('script');
    desktopLicenseBadgeScript.src = './tp-static/frontend/js/shared/desktop-license-badge.js';
    desktopLicenseBadgeScript.dataset.desktopLicenseBadge = '1';
    document.head.appendChild(desktopLicenseBadgeScript);
}

// 源码启动、Windows 安装版和绿色版共用同一个服务端首次启动状态。
// 首页内嵌打开的工具页里不再弹（首页自己会弹一次）
if (!NAV_EMBEDDED && !document.querySelector('script[data-first-run-onboarding]')) {
    const firstRunOnboardingScript = document.createElement('script');
    firstRunOnboardingScript.src = './tp-static/frontend/js/shared/first-run-onboarding.js';
    firstRunOnboardingScript.dataset.firstRunOnboarding = '1';
    document.head.appendChild(firstRunOnboardingScript);
}


// App surfaces keep custom context menus; editing and copying selected text retain native actions.
document.addEventListener('contextmenu', event => {
    if(event.defaultPrevented || event.target.closest('input, textarea, [contenteditable="true"]') || window.getSelection()?.toString().trim()) return;
    event.preventDefault();
});
