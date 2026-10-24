/**
 * shared/navbar.js - 统一导航栏组件
 * 支持固定工具、自定义工具、二级分类与全局顺序设置。
 */
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
    { id: 'db-explorer', href: '/db-explorer', icon: '🗄️', label: '数据探索', labelKey: 'nav.dbExplorer', defaultCategory: 'system', match: p => p.startsWith('/db-explorer') }
];

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
        frt: 'audit', praudit: 'audit', storage: 'system', 'db-explorer': 'system', 'topic-analysis': 'cat_mshv1h0m',
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
    tenants: [],
    managedTenants: [],
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
    'tools_token', 'tools_user', 'tools_role', 'tools_tenant_id', 'tools_lang', 'tools_language'
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
    if (!window.ToolsI18n) return cat.name;
    const lang = window.ToolsI18n.getLanguage();
    if (cat.nameKey) return navT(cat.nameKey);
    const inferredKey = `nav.category.${cat.id}`;
    const inferred = navT(inferredKey);
    if (inferred !== inferredKey) return inferred;
    if (lang === 'en-US' && cat.nameEn) return cat.nameEn;
    return cat.name;
}

// 导航搜索在浏览器本地完成，避免绿色版或离线环境依赖外部拼音服务。
// 词表覆盖内置功能、默认自定义工具和常见命名；未收录汉字仍可通过拼音排序规则推断首字母。
const NAV_PINYIN_SYLLABLES = Object.freeze({
    工: 'gong', 具: 'ju', 中: 'zhong', 台: 'tai', 数: 'shu', 据: 'ju', 抓: 'zhua', 取: 'qu',
    导: 'dao', 入: 'ru', 报: 'bao', 表: 'biao', 看: 'kan', 板: 'ban', 一: 'yi', 键: 'jian',
    催: 'cui', 办: 'ban', 月: 'yue', 页: 'ye', 面: 'mian', 大: 'da', 屏: 'ping', 核: 'he',
    算: 'suan', 稽: 'ji', 查: 'cha', 迁: 'qian', 移: 'yi', 状: 'zhuang', 态: 'tai', 探: 'tan',
    索: 'suo', 审: 'shen', 计: 'ji', 与: 'yu', 系: 'xi', 统: 'tong', 治: 'zhi', 理: 'li',
    五: 'wu', 个: 'ge', 端: 'duan', 到: 'dao', 实: 'shi', 用: 'yong', 网: 'wang', 络: 'luo',
    安: 'an', 全: 'quan', 汇: 'hui', 呈: 'cheng', 现: 'xian', 自: 'zi', 定: 'ding', 义: 'yi',
    行: 'xing', 政: 'zheng', 餐: 'can', 饮: 'yin', 休: 'xiu', 闲: 'xian', 娱: 'yu', 乐: 'yu',
    重: 'zhong', 急: 'ji', 收: 'shou', 编: 'bian', 临: 'lin', 时: 'shi', 胶: 'jiao', 片: 'pian',
    设: 'she', 六: 'liu', 博: 'bo', 客: 'ke', 爬: 'pa', 虫: 'chong', 上: 'shang', 传: 'chuan',
    指: 'zhi', 南: 'nan', 膳: 'shan', 食: 'shi', 手: 'shou', 册: 'ce', 日: 'ri', 程: 'cheng',
    排: 'pai', 透: 'tou', 视: 'shi', 欠: 'qian', 款: 'kuan', 对: 'dui', 账: 'zhang', 刷: 'shua',
    卡: 'ka', 粒: 'li', 子: 'zi', 特: 'te', 效: 'xiao', 人: 'ren', 点: 'dian', 通: 'tong',
    知: 'zhi', 平: 'ping', 介: 'jie', 绍: 'shao', 满: 'man', 意: 'yi', 度: 'du', 啊: 'a',
    旅: 'lu', 游: 'you', 激: 'ji', 励: 'li', 扩: 'kuo', 展: 'zhan', 打: 'da', 包: 'bao',
    外: 'wai', 三: 'san', 方: 'fang', 软: 'ruan', 件: 'jian', 分: 'fen', 析: 'xi', 要: 'yao',
    求: 'qiu', 会: 'hui', 议: 'yi', 考: 'kao', 勤: 'qin', 光: 'guang', 码: 'ma', 文: 'wen',
    景: 'jing', 题: 'ti', 库: 'ku', 助: 'zhu', 隐: 'yin', 私: 'si', 策: 'ce', 学: 'xue',
    习: 'xi', 转: 'zhuan', 换: 'huan', 档: 'dang', 整: 'zheng', 辑: 'ji', 智: 'zhi',
    能: 'neng', 调: 'diao', 脚: 'jiao', 本: 'ben', 仓: 'cang', 默: 'mo', 认: 'ren', 规: 'gui',
    则: 'ze', 量: 'liang', 标: 'biao', 获: 'huo', 采: 'cai', 集: 'ji', 监: 'jian', 控: 'kong',
    任: 'ren', 务: 'wu', 风: 'feng', 险: 'xian', 质: 'zhi', 生: 'sheng', 成: 'cheng', 合: 'he',
    并: 'bing', 组: 'zu', 清: 'qing', 单: 'dan', 检: 'jian', 测: 'ce', 维: 'wei', 护: 'hu',
    备: 'bei', 份: 'fen', 恢: 'hui', 复: 'fu', 记: 'ji', 录: 'lu', 志: 'zhi', 消: 'xiao',
    息: 'xi', 告: 'gao', 警: 'jing', 资: 'zi', 产: 'chan', 户: 'hu', 员: 'yuan', 设: 'she',
    部: 'bu', 门: 'men', 配: 'pei', 置: 'zhi', 管: 'guan', 服: 'fu', 心: 'xin', 总: 'zong',
    览: 'lan', 快: 'kuai', 速: 'su', 搜: 'sou', 出: 'chu', 批: 'pi', 动: 'dong', 流: 'liu',
    模: 'mo', 询: 'xun', 应: 'ying', 开: 'kai', 发: 'fa', 试: 'shi', 订: 'ding', 交: 'jiao',
    付: 'fu', 改: 'gai', 洞: 'dong', 察: 'cha', 处: 'chu', 下: 'xia', 载: 'zai', 图: 'tu',
    频: 'pin', 音: 'yin', 号: 'hao', 租: 'zu', 权: 'quan', 限: 'xian', 略: 'lue', 源: 'yuan',
    健: 'jian', 康: 'kang', 完: 'wan', 性: 'xing', 修: 'xiu', 初: 'chu', 始: 'shi', 化: 'hua',
    箱: 'xiang', 即: 'ji', 识: 'shi', 谱: 'pu', 示: 'shi', 提: 'ti', 醒: 'xing'
});

const NAV_PINYIN_INITIAL_BOUNDARIES = Object.freeze([
    ['a', '阿'], ['b', '八'], ['c', '擦'], ['d', '搭'], ['e', '蛾'], ['f', '发'],
    ['g', '噶'], ['h', '哈'], ['j', '击'], ['k', '喀'], ['l', '拉'], ['m', '妈'],
    ['n', '拿'], ['o', '哦'], ['p', '啪'], ['q', '期'], ['r', '然'], ['s', '撒'],
    ['t', '塌'], ['w', '挖'], ['x', '昔'], ['y', '压'], ['z', '匝']
]);
const NAV_PINYIN_COLLATOR = typeof Intl !== 'undefined' && Intl.Collator
    ? new Intl.Collator('zh-Hans-CN-u-co-pinyin')
    : null;

function normalizeNavSearchTerm(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function inferNavPinyinInitial(char) {
    if (!NAV_PINYIN_COLLATOR || !/[\u3400-\u9fff]/.test(char)) return '';
    for (let index = NAV_PINYIN_INITIAL_BOUNDARIES.length - 1; index >= 0; index -= 1) {
        const [initial, boundary] = NAV_PINYIN_INITIAL_BOUNDARIES[index];
        if (NAV_PINYIN_COLLATOR.compare(char, boundary) >= 0) return initial;
    }
    return '';
}

function getNavPinyinAliases(value) {
    const source = String(value ?? '').normalize('NFKC');
    let fullPinyin = '';
    let expandedInitials = '';
    let compactInitials = '';

    for (let index = 0; index < source.length;) {
        const asciiMatch = source.slice(index).match(/^[a-z0-9]+/i);
        if (asciiMatch) {
            const rawToken = asciiMatch[0];
            const token = rawToken.toLocaleLowerCase();
            fullPinyin += token;
            expandedInitials += token;
            compactInitials += /^[A-Z0-9]+$/.test(rawToken) && rawToken.length <= 5 ? token : token[0];
            index += rawToken.length;
            continue;
        }

        const char = source[index];
        const syllable = NAV_PINYIN_SYLLABLES[char];
        const initial = syllable?.[0] || inferNavPinyinInitial(char);
        if (syllable) fullPinyin += syllable;
        if (initial) {
            expandedInitials += initial;
            compactInitials += initial;
        }
        index += 1;
    }

    return [fullPinyin, expandedInitials, compactInitials]
        .map(normalizeNavSearchTerm)
        .filter(Boolean);
}

function buildNavSearchIndex(item) {
    const values = [item.label, item.labelEn, getNavLabel(item), item.id, item.href].filter(Boolean);
    const aliases = new Set();
    values.forEach(value => {
        const normalized = normalizeNavSearchTerm(value);
        if (normalized) aliases.add(normalized);
        getNavPinyinAliases(value).forEach(alias => aliases.add(alias));
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
    return String(searchIndex || '').split('|').some(candidate =>
        candidate.includes(normalizedQuery) || isNavSearchSubsequence(normalizedQuery, candidate)
    );
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
            'nav.f12packer': 'F12扩展打包',
            'nav.pythonUpdater': 'Python脚本更新',
            'nav.more': '更多工具',
            'nav.moreSearch': '搜索工具、拼音或首字母...',
            'nav.moreSearchLabel': '搜索更多工具',
            'nav.moreAll': '全部',
            'nav.moreRecent': '最近使用',
            'nav.moreRecentBadge': '常用直达',
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
            'nav.set.tab.tenants': '租户管理',
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
            'nav.set.sub.logo': '修改平台名称、主图标及桌面应用图标。',
            'nav.set.sub.categories': '修改后会自动保存，并立即影响“更多工具”的分类展示。',
            'nav.set.sub.items': '修改后会自动保存，并立即影响“更多工具”的分组与排序。',
            'nav.set.sub.ai': '修改后会自动保存，并立即影响 Dragon Claw 智能体配置。',
            'nav.set.sub.update': '检查、下载并安装桌面客户端更新。',
            'nav.set.sub.backup': '备份与恢复仅作用于当前租户的数据库、附件和自定义工具，不会覆盖其他租户。',
            'nav.set.sub.snapshotPublish': '配置当前租户的只读快照推送目标，并查看推送进度与历史日志。',
            'nav.set.sub.initialize': '补齐开箱即用内容，或在安全备份和完整归档后恢复到首次使用状态。',
            'nav.set.sub.tenants': '管理独立业务空间。每个租户拥有自己的脚本、规则、数据库、附件和自定义工具。',
            'nav.set.sub.media': '统一管理点播媒体库、分类文件夹、本地资源批量导入与封面重绘。',
            'nav.set.sub.promotions': '配置首页右上角推广区：推广视频的显示、推广链接的增删改、首页最多显示的链接数与轮换间隔，以及桌面端右下角推广卡片堆。',
            'nav.media.categoryFilter': '媒体分类筛选',
            'nav.media.searchLabel': '搜索媒体资源',
            'nav.media.previewBack': '返回媒体设置',
            'nav.tenant.current': '当前租户',
            'nav.tenant.switch': '切换租户',
            'nav.tenant.manage': '管理租户',
            'nav.tenant.loading': '正在读取租户...',
            'nav.tenant.empty': '暂无可用租户',
            'nav.tenant.create': '新增租户',
            'nav.tenant.name': '租户名称',
            'nav.tenant.id': '租户标识（可选）',
            'nav.tenant.description': '说明',
            'nav.tenant.edit': '编辑',
            'nav.tenant.archive': '归档',
            'nav.tenant.archiveConfirm': '归档租户“{name}”？该租户将无法继续进入，但数据目录会保留。',
            'nav.tenant.activeGroup': '启用中的租户',
            'nav.tenant.archivedGroup': '已归档租户',
            'nav.tenant.archivedEmpty': '暂无已归档租户',
            'nav.tenant.archivedBadge': '已归档',
            'nav.tenant.restore': '恢复启用',
            'nav.tenant.restoreConfirm': '恢复租户“{name}”？恢复后用户可重新进入，原数据目录保持不变。',
            'nav.tenant.delete': '彻底删除',
            'nav.tenant.deleteTitle': '彻底删除租户数据',
            'nav.tenant.deleteMessage': '将永久删除租户“{name}”（ID: {id}）的数据库、脚本、规则、附件、自定义工具和租户备份。',
            'nav.tenant.deleteHint': '此操作不可撤销。请输入租户 ID “{id}”确认。',
            'nav.tenant.deletePlaceholder': '输入租户 ID：{id}',
            'nav.tenant.deleteDone': '租户“{name}”及其数据已彻底删除。',
            'nav.tenant.defaultHint': '现有业务数据位于默认租户；新租户创建后为空白初始化状态。',
            'nav.tenant.defaultName': '默认租户',
            'nav.tenant.nameRequired': '请填写租户名称。',
            'nav.tenant.idInvalid': '租户标识只能包含英文字母、数字、下划线和短横线。',
            'nav.set.sub.customBackup': '单独备份和恢复自定义工具文件、注册信息、服务端状态及可识别的浏览器本地数据。',
            'nav.set.sub.accounts': '修改后会自动保存，并立即影响账号权限。',
            'nav.set.sub.security': '配置登录失败锁定、会话过期和安全告警策略。',
            'nav.set.sub.report': '报表看板历史数据的独立备份、跨站点恢复与冗余清理。',
            'nav.set.sub.pageFallback': '该页面的配置预留位，后续可把页面内相关设置迁移到这里统一管理。',
            'nav.set.help.primary': '勾选后显示在顶部 bar；未勾选的菜单会进入“更多工具”。使用上下按钮调整顶部显示顺序。',
            'nav.set.help.categories': '分类会显示在“更多工具”下拉菜单中。配置英文名称后，系统会在英文模式下自动应用。',
            'nav.set.help.items': '这里管理“更多工具”里的二级分类和分类内顺序。顶部直显菜单不会出现在此列表中。',
            'nav.set.btn.up': '上移',
            'nav.set.btn.down': '下移',
            'nav.set.btn.delete': '删除',
            'nav.set.btn.addCategory': '新增分类',
            'nav.set.restore.title': '恢复系统默认布局',
            'nav.set.restore.desc': '恢复顶部菜单、系统分类和系统工具顺序。非系统自带工具、自建分类及其当前位置会保留。',
            'nav.set.restore.button': '恢复系统默认',
            'nav.set.restore.confirmTitle': '恢复系统导航默认布局？',
            'nav.set.restore.confirmMessage': '系统自带菜单、分类和工具顺序将恢复默认。',
            'nav.set.restore.confirmHint': '不会删除或覆盖非系统自带工具；它们当前所在的顶部菜单、分类和相对顺序会尽量保留。',
            'nav.set.restore.cancel': '取消',
            'nav.set.restore.action': '确认恢复',
            'nav.set.restore.restoring': '正在恢复系统默认...',
            'nav.set.restore.success': '已恢复系统默认，并保留 {tools} 个非系统工具、{categories} 个自建分类',
            'nav.set.restore.fail': '恢复失败: ',
            'nav.set.default.button': '设为系统默认布局',
            'nav.set.default.confirmTitle': '将当前布局设为系统默认布局？',
            'nav.set.default.confirmMessage': '当前顶部菜单、分类及工具排版将被写入系统源码默认配置（defaults/nav-layout.json），并立即对当前系统生效。',
            'nav.set.default.confirmHint': '推送代码至远端仓库后，该布局将作为所有环境和后续默认初始化的系统标准布局。',
            'nav.set.default.action': '确认设为默认',
            'nav.set.default.saving': '正在设为系统默认布局...',
            'nav.set.default.success': '已成功将当前布局设为系统默认布局并写入默认配置',
            'nav.set.default.fail': '设为系统默认布局失败: ',
            'nav.init.help': '这里的两种操作都只作用于当前租户：开箱即用只补齐缺失默认内容；彻底初始化会清空当前租户业务数据。',
            'nav.init.quickTitle': '启动开箱即用模式',
            'nav.init.quickDesc': '重新导入仓库内置的智能调度脚本和全量指标规则。仅补齐缺失项，不覆盖同名脚本、规则或用户配置；导入前会生成配置快照。',
            'nav.init.quickButton': '启动开箱即用模式',
            'nav.init.quickConfirmTitle': '导入开箱即用默认内容？',
            'nav.init.quickConfirmMessage': '系统将补齐内置智能调度脚本和全量指标规则。',
            'nav.init.quickConfirmHint': '已有同名内容会保留，不会被默认版本覆盖。',
            'nav.init.quickRunning': '正在导入默认内容...',
            'nav.init.quickSuccess': '导入完成：新增脚本 {scripts} 个、指标规则 {rules} 条、指标分组 {groups} 个。',
            'nav.init.dangerLabel': '危险区域',
            'nav.init.resetTitle': '彻底初始化当前租户',
            'nav.init.resetDesc': '先自动生成当前租户安全备份，再完整归档其数据并建立干净数据库。账号、其他租户及桌面/F12 授权不会受影响。',
            'nav.init.resetArchive': '旧租户数据会整体保存在 factory-reset-archives 目录；初始化后会再次出现首次启动导入提示。',
            'nav.init.resetButton': '初始化当前租户',
            'nav.init.resetConfirmTitle': '高危操作：彻底初始化当前租户',
            'nav.init.resetConfirmMessage': '当前租户的业务数据、配置、附件和自定义工具将从运行目录移出。系统会先创建安全备份和完整旧数据归档，其他租户不受影响。',
            'nav.init.resetConfirmHint': '请在下方完整输入 RESET，然后才能执行初始化。',
            'nav.init.resetPlaceholder': '输入：RESET',
            'nav.init.resetAction': '确认初始化',
            'nav.init.resetRunning': '正在创建安全备份并准备初始化...',
            'nav.init.resetSuccess': '安全备份 {backup} 已创建。程序即将退出；请重新启动，初始化会在退出后自动完成。',
            'nav.init.resetSuccessNoRestart': '安全备份 {backup} 已创建，当前租户已恢复为空白状态；正在返回登录页。',
            'nav.init.failed': '操作失败：',
            'nav.set.emptyItems': '暂无更多工具菜单。',
            'nav.set.placeholder.zh': '中文名称',
            'nav.set.placeholder.en': 'English Name',
            'nav.set.newCategory': '新分类',

            'nav.page.placeholderTitle': '{page}配置预留位',
            'nav.page.placeholderDesc': '当前暂无需要迁移到全局设置的配置项。后续如果该页面新增全局级设置，可以直接放在这里。',
            'nav.page.home.help': '逐个控制自定义 HTML 工具的新窗口直达地址是否需要登录。默认关闭公开访问；开启后，任何获得链接的人都可以访问该工具及其静态资源。',
            'nav.page.home.title': '自定义 HTML 访问鉴权',
            'nav.page.home.public': '允许免登录新窗口访问',
            'nav.page.home.private': '免登录',
            'nav.page.home.empty': '暂无自定义 HTML 工具。',
            'nav.page.report.help': '可单独备份和恢复历史快照与已入库内容，也可清理报表看板历史下拉列表中的冗余 SLA 源快照。所有操作只影响当前租户。',
            'nav.page.report.backupTitle': '报表历史数据独立备份与恢复',
            'nav.page.report.backupDesc': '导出 SLA 历史快照、已入库报表、分类得分、指标明细及人工佐证附件。报表截图和已生成 Excel 不导出。',
            'nav.page.report.exportButton': '导出独立备份',
            'nav.page.report.importMode': '导入模式',
            'nav.page.report.modeMerge': '增量恢复（默认）',
            'nav.page.report.modeReplace': '清空恢复',
            'nav.page.report.modeMergeHint': '按“快照 ID + 月份”合并：不同日期追加，同一份数据以备份包覆盖，其他现有数据保留。',
            'nav.page.report.modeReplaceHint': '先清空当前租户的 SLA 历史快照和报表入库内容，再完整导入备份包。',
            'nav.page.report.chooseImport': '选择备份并导入',
            'nav.page.report.noFile': '请先选择 .zip 备份包。',
            'nav.page.report.importDone': '导入完成：SLA 快照 {sla}条，入库报表 {reports}份，分类得分 {scores}条，指标明细 {metrics}条，佐证附件 {attachments}个。',
            'nav.page.report.replaceConfirmTitle': '高危操作：清空当前报表历史后恢复',
            'nav.page.report.replaceConfirmWarning': '当前租户的 SLA 历史快照和全部已入库报表将被备份包取代。',
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
            'nav.ai.lblMax': '最大输出 Tokens',
            'nav.ai.lblInputCost': '输入成本 USD / 1M Tokens',
            'nav.ai.lblOutputCost': '输出成本 USD / 1M Tokens',
            'nav.ai.lblUsdCny': '美元兑人民币',
            'nav.ai.lblPrompt': '补充系统提示词',
            'nav.ai.plhPrompt': '例如：回答优先使用中文，涉及平台操作时给出步骤。',
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
            'nav.ai.aliasTitle': '对话模型名称映射',
            'nav.ai.aliasHelp': '对话界面（如首页 Dragon Claw）显示的模型名称，以及它实际使用的配置方案。清空映射后，对话界面直接列出各方案的真实模型名。',
            'nav.ai.aliasAdd': '＋ 添加模型',
            'nav.ai.aliasClear': '清空映射',
            'nav.ai.aliasClearConfirm': '清空后对话界面将直接显示真实模型名称，确定吗？',
            'nav.ai.aliasReset': '恢复默认 Aragon',
            'nav.ai.aliasName': '显示名称',
            'nav.ai.aliasNamePlh': '例如 Aragon',
            'nav.ai.aliasDesc': '简短说明',
            'nav.ai.aliasDescPlh': '例如 均衡、响应快',
            'nav.ai.aliasProfile': '实际配置',
            'nav.ai.aliasFollowActive': '跟随激活方案',
            'nav.ai.aliasDelete': '删除',
            'nav.ai.aliasDefault': '默认',
            'nav.ai.aliasEmpty': '未配置映射，对话界面将直接显示：',
            'nav.ai.aliasSaving': '正在保存模型映射...',
            'nav.ai.aliasSaved': '模型映射已自动保存',
            'nav.ai.aliasFail': '模型映射保存失败：',

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
            'nav.bk.help': '当前租户“{tenant}”（ID: {tenantId}）的完整备份范围：{target}。不会包含或覆盖其他租户的数据。',
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
            'nav.bk.remoteDesc': '远端同步严格按租户 ID 执行，不比较显示名称：当前租户只会拉取远端相同 ID 的备份；远端不存在时会安全终止。',
            'nav.bk.enable': '启用',
            'nav.bk.remoteDomain': '远端网站域名',
            'nav.bk.remoteUser': '账号',
            'nav.bk.remotePwd': '密码',
            'nav.bk.plhPwd': '填写远端登录密码',
            'nav.bk.optCompare': '比较备份新旧，未更新则跳过',
            'nav.bk.optPull': '拉取前请求主站立即生成备份',
            'nav.bk.optAuto': '启动时自动恢复最新备份',
            'nav.bk.optAutoDefaultOnly': '启动自动恢复仅用于默认租户；其他租户请手动检查和恢复。',
            'nav.bk.scheduleTitle': '定时备份',
            'nav.bk.scheduleDesc': '当前租户独立调度；默认每天凌晨 2 点生成该租户备份，并仅清理该租户超过保留天数的自动备份。',
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
            'nav.bk.svrDesc': '仅备份当前租户，生成后保存在该租户自己的备份目录，也可以下载留档。',
            'nav.bk.btnCreate': '生成服务器备份',
            'nav.bk.btnCreateDL': '生成并下载',
            'nav.bk.upTitle': '上传备份包恢复',
            'nav.bk.upDesc': '优先恢复同租户 ID 的备份；ID 不一致时会安全拦截并显示来源与目标，管理员确认后可强制恢复。',
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
            'nav.f12packer': 'F12 Packer',
            'nav.pythonUpdater': 'Python Updater',
            'nav.more': 'More Tools',
            'nav.moreSearch': 'Search tools, pinyin, or initials...',
            'nav.moreSearchLabel': 'Search more tools',
            'nav.moreAll': 'All',
            'nav.moreRecent': 'Recently used',
            'nav.moreRecentBadge': 'Quick Access',
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
            'nav.set.tab.tenants': 'Tenants',
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
            'nav.set.sub.logo': 'Manage the platform name, logo and desktop app icons.',
            'nav.set.sub.categories': 'Changes are saved automatically and immediately applied to the category display in "More Tools".',
            'nav.set.sub.items': 'Changes are saved automatically and immediately applied to the grouping and ordering in "More Tools".',
            'nav.set.sub.ai': 'Changes are saved automatically and immediately applied to the Dragon Claw Agent configuration.',
            'nav.set.sub.update': 'Check, download, and install desktop client updates.',
            'nav.set.sub.backup': 'Backup and restore only affect the current tenant\'s databases, attachments, and custom tools, without overwriting other tenants.',
            'nav.set.sub.snapshotPublish': 'Configure this tenant’s read-only snapshot destination and review publishing progress and history.',
            'nav.set.sub.initialize': 'Add the Quick Start defaults or return to a clean first-run state after a safety backup and full archive.',
            'nav.set.sub.tenants': 'Manage isolated workspaces. Each tenant has separate scripts, rules, databases, attachments, and custom tools.',
            'nav.set.sub.media': 'Manage the on-demand media library, category folders, local batch imports, and poster regeneration.',
            'nav.set.sub.promotions': 'Configure the home page promo area: which videos show, promoted links, the maximum number of links and rotation interval, and the desktop promotion card stack.',
            'nav.media.categoryFilter': 'Filter media categories',
            'nav.media.searchLabel': 'Search media resources',
            'nav.media.previewBack': 'Back to media settings',
            'nav.tenant.current': 'Current tenant',
            'nav.tenant.switch': 'Switch tenant',
            'nav.tenant.manage': 'Manage tenants',
            'nav.tenant.loading': 'Loading tenants...',
            'nav.tenant.empty': 'No tenants available',
            'nav.tenant.create': 'Add tenant',
            'nav.tenant.name': 'Tenant name',
            'nav.tenant.id': 'Tenant ID (optional)',
            'nav.tenant.description': 'Description',
            'nav.tenant.edit': 'Edit',
            'nav.tenant.archive': 'Archive',
            'nav.tenant.archiveConfirm': 'Archive tenant “{name}”? It will become unavailable while its data directory is retained.',
            'nav.tenant.activeGroup': 'Active tenants',
            'nav.tenant.archivedGroup': 'Archived tenants',
            'nav.tenant.archivedEmpty': 'No archived tenants',
            'nav.tenant.archivedBadge': 'Archived',
            'nav.tenant.restore': 'Restore',
            'nav.tenant.restoreConfirm': 'Restore tenant “{name}”? Users can enter it again and its existing data directory will be retained.',
            'nav.tenant.delete': 'Delete permanently',
            'nav.tenant.deleteTitle': 'Permanently delete tenant data',
            'nav.tenant.deleteMessage': 'This permanently deletes tenant “{name}” (ID: {id}), including its databases, scripts, rules, attachments, custom tools, and tenant backups.',
            'nav.tenant.deleteHint': 'This cannot be undone. Enter tenant ID “{id}” to confirm.',
            'nav.tenant.deletePlaceholder': 'Enter tenant ID: {id}',
            'nav.tenant.deleteDone': 'Tenant “{name}” and its data were permanently deleted.',
            'nav.tenant.defaultHint': 'Existing business data remains in the default tenant. New tenants start with a clean initialized workspace.',
            'nav.tenant.defaultName': 'Default Tenant',
            'nav.tenant.nameRequired': 'Enter a tenant name.',
            'nav.tenant.idInvalid': 'Tenant ID may contain only letters, numbers, underscores, and hyphens.',
            'nav.set.sub.customBackup': 'Back up and restore custom tool files, registry data, server state, and detectable browser-local data independently.',
            'nav.set.sub.accounts': 'Changes are saved automatically and immediately applied to account permissions.',
            'nav.set.sub.security': 'Configure login lockouts, session expiry, and security alert severity.',
            'nav.set.sub.report': 'Independent backup, cross-site restore, and redundant-history cleanup for Report Dashboard data.',
            'nav.set.sub.pageFallback': "Placeholder for this page's configuration. Future page settings can be managed here.",
            'nav.set.help.primary': 'Checked items appear in the top bar; unchecked items move to "More Tools". Use up/down buttons to reorder.',
            'nav.set.help.categories': 'Categories are displayed in the "More Tools" dropdown. English names will apply automatically in English mode.',
            'nav.set.help.items': 'Manage sub-categories and their ordering in "More Tools". Direct top menu items do not appear here.',
            'nav.set.btn.up': 'Up',
            'nav.set.btn.down': 'Down',
            'nav.set.btn.delete': 'Delete',
            'nav.set.btn.addCategory': 'Add Category',
            'nav.set.restore.title': 'Restore system defaults',
            'nav.set.restore.desc': 'Restore the top menu, system categories, and system-tool order. Non-system tools, custom categories, and their placements are preserved.',
            'nav.set.restore.button': 'Restore defaults',
            'nav.set.restore.confirmTitle': 'Restore the default navigation layout?',
            'nav.set.restore.confirmMessage': 'Built-in menus, categories, and tool order will be restored to system defaults.',
            'nav.set.restore.confirmHint': 'Non-system tools will not be deleted or overwritten. Their top-menu placement, category, and relative order will be preserved where possible.',
            'nav.set.restore.cancel': 'Cancel',
            'nav.set.restore.action': 'Restore',
            'nav.set.restore.restoring': 'Restoring system defaults...',
            'nav.set.restore.success': 'Defaults restored; preserved {tools} non-system tool(s) and {categories} custom category/categories',
            'nav.set.restore.fail': 'Restore failed: ',
            'nav.set.default.button': 'Set as system default',
            'nav.set.default.confirmTitle': 'Set current layout as system default?',
            'nav.set.default.confirmMessage': 'The current top menu, categories, and tool arrangement will be saved to codebase defaults (defaults/nav-layout.json) and applied immediately.',
            'nav.set.default.confirmHint': 'Once pushed to the remote repository, this layout will serve as the system standard default across environments.',
            'nav.set.default.action': 'Set as default',
            'nav.set.default.saving': 'Setting as system default...',
            'nav.set.default.success': 'Current layout successfully set as system default and saved to defaults config',
            'nav.set.default.fail': 'Failed to set system default: ',
            'nav.init.help': 'Both actions affect only the current tenant: Quick Start adds missing defaults, while Factory Reset clears this tenant’s business data.',
            'nav.init.quickTitle': 'Enable Quick Start Mode',
            'nav.init.quickDesc': 'Re-import the bundled smart-scheduling scripts and complete metric rules. Missing items are added without overwriting same-name scripts, rules, or user settings; a configuration snapshot is created first.',
            'nav.init.quickButton': 'Enable Quick Start Mode',
            'nav.init.quickConfirmTitle': 'Import the Quick Start defaults?',
            'nav.init.quickConfirmMessage': 'The bundled smart-scheduling scripts and complete metric rules will be added.',
            'nav.init.quickConfirmHint': 'Existing same-name content is preserved and will not be overwritten.',
            'nav.init.quickRunning': 'Importing default content...',
            'nav.init.quickSuccess': 'Import complete: {scripts} scripts, {rules} metric rules, and {groups} metric groups added.',
            'nav.init.dangerLabel': 'Danger Zone',
            'nav.init.resetTitle': 'Factory Reset Current Tenant',
            'nav.init.resetDesc': 'Creates a tenant-scoped safety backup, archives this tenant, and builds a clean database. Accounts, other tenants, and desktop/F12 licenses are unaffected.',
            'nav.init.resetArchive': 'Old tenant data remains in factory-reset-archives. The first-run import prompt appears again after initialization.',
            'nav.init.resetButton': 'Reset Current Tenant',
            'nav.init.resetConfirmTitle': 'DANGER: Factory reset current tenant',
            'nav.init.resetConfirmMessage': 'This tenant’s business data, settings, attachments, and custom tools will be moved out of the live directory after a safety backup. Other tenants are unaffected.',
            'nav.init.resetConfirmHint': 'Type RESET exactly below to enable factory reset.',
            'nav.init.resetPlaceholder': 'Type: RESET',
            'nav.init.resetAction': 'Reset Tenant',
            'nav.init.resetRunning': 'Creating a safety backup and preparing reset...',
            'nav.init.resetSuccess': 'Safety backup {backup} was created. The app will exit; launch it again after the reset completes.',
            'nav.init.resetSuccessNoRestart': 'Safety backup {backup} was created and the current tenant is clean. Returning to sign in.',
            'nav.init.failed': 'Operation failed: ',
            'nav.set.emptyItems': 'No more tools available.',
            'nav.set.placeholder.zh': 'Chinese Name',
            'nav.set.placeholder.en': 'English Name',
            'nav.set.newCategory': 'New Category',

            'nav.page.placeholderTitle': '{page} Configuration Placeholder',
            'nav.page.placeholderDesc': 'There are currently no configuration items to migrate to global settings. Future global settings for this page will be placed here.',
            'nav.page.home.help': 'Control whether each custom HTML tool can be opened in a new window without signing in. Public access is off by default; when enabled, anyone with the link can access the tool and its static assets.',
            'nav.page.home.title': 'Custom HTML Access Control',
            'nav.page.home.public': 'Allow public new-window access',
            'nav.page.home.private': 'Sign-in required',
            'nav.page.home.empty': 'No custom HTML tools yet.',
            'nav.page.report.help': 'Back up and restore historical snapshots and saved report content independently, or clean redundant SLA source snapshots from the Report Dashboard history selector. Every operation is limited to the current tenant.',
            'nav.page.report.backupTitle': 'Independent Report History Backup & Restore',
            'nav.page.report.backupDesc': 'Export SLA history, saved reports, category scores, metric details, and manual evidence attachments. Report screenshots and generated Excel files are excluded.',
            'nav.page.report.exportButton': 'Export Independent Backup',
            'nav.page.report.importMode': 'Import mode',
            'nav.page.report.modeMerge': 'Incremental restore (default)',
            'nav.page.report.modeReplace': 'Clear and restore',
            'nav.page.report.modeMergeHint': 'Merge by snapshot ID + month: add different dates, replace matching records from the package, and retain all other existing data.',
            'nav.page.report.modeReplaceHint': 'Clear the current tenant\'s SLA history and saved report records, then import the package in full.',
            'nav.page.report.chooseImport': 'Choose Backup and Import',
            'nav.page.report.noFile': 'Choose a .zip backup package first.',
            'nav.page.report.importDone': 'Import complete: {sla} SLA snapshots, {reports} saved reports, {scores} category scores, {metrics} metric rows, and {attachments} evidence attachments.',
            'nav.page.report.replaceConfirmTitle': 'DANGER: Clear current report history and restore',
            'nav.page.report.replaceConfirmWarning': 'The current tenant\'s SLA history and all saved report records will be replaced by this package.',
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
            'nav.ai.lblMax': 'Max Output Tokens',
            'nav.ai.lblInputCost': 'Input Cost (USD / 1M)',
            'nav.ai.lblOutputCost': 'Output Cost (USD / 1M)',
            'nav.ai.lblUsdCny': 'USD to CNY Exchange Rate',
            'nav.ai.lblPrompt': 'Supplemental System Prompt',
            'nav.ai.plhPrompt': 'e.g. Please respond in English and provide step-by-step instructions.',
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
            'nav.ai.aliasTitle': 'Chat model names',
            'nav.ai.aliasHelp': 'Model names shown in chat (such as Dragon Claw on the home page) and the profile each one actually uses. With no mappings, chat lists the real model names of your profiles.',
            'nav.ai.aliasAdd': '+ Add model',
            'nav.ai.aliasClear': 'Clear mappings',
            'nav.ai.aliasClearConfirm': 'Chat will show the real model names after clearing. Continue?',
            'nav.ai.aliasReset': 'Restore default Aragon',
            'nav.ai.aliasName': 'Display name',
            'nav.ai.aliasNamePlh': 'e.g. Aragon',
            'nav.ai.aliasDesc': 'Short description',
            'nav.ai.aliasDescPlh': 'e.g. Balanced and fast',
            'nav.ai.aliasProfile': 'Uses profile',
            'nav.ai.aliasFollowActive': 'Follow active profile',
            'nav.ai.aliasDelete': 'Delete',
            'nav.ai.aliasDefault': 'Default',
            'nav.ai.aliasEmpty': 'No mappings. Chat will list: ',
            'nav.ai.aliasSaving': 'Saving model names...',
            'nav.ai.aliasSaved': 'Model names saved automatically',
            'nav.ai.aliasFail': 'Failed to save model names: ',

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
            'nav.bk.help': 'Complete backup for the current tenant “{tenant}” (ID: {tenantId}): {target}. Other tenants are never included or overwritten.',
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
            'nav.bk.remoteDesc': 'Remote sync requires matching tenant IDs: the current tenant only pulls the same tenant from the remote site. Missing tenants fail safely. Connection settings stay on this machine.',
            'nav.bk.enable': 'Enable',
            'nav.bk.remoteDomain': 'Remote Domain',
            'nav.bk.remoteUser': 'Username',
            'nav.bk.remotePwd': 'Password',
            'nav.bk.plhPwd': 'Enter remote login password',
            'nav.bk.optCompare': 'Compare before restore, skip if not updated',
            'nav.bk.optPull': 'Request immediate backup generation on main site before pulling',
            'nav.bk.optAuto': 'Auto-restore latest backup on startup',
            'nav.bk.optAutoDefaultOnly': 'Startup auto-restore is available only for the default tenant. Restore other tenants manually.',
            'nav.bk.scheduleTitle': 'Scheduled Backup',
            'nav.bk.scheduleDesc': 'Scheduled independently for the current tenant; by default runs daily at 02:00 and prunes only this tenant’s expired scheduled backups.',
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
            'nav.bk.svrDesc': 'Backs up only the current tenant and stores the package in that tenant’s backup directory. It can also be downloaded.',
            'nav.bk.btnCreate': 'Create Server Backup',
            'nav.bk.btnCreateDL': 'Create & Download',
            'nav.bk.upTitle': 'Restore from Upload',
            'nav.bk.upDesc': 'Backups with the same tenant ID restore directly. A mismatch is safely blocked and shows source and target details before an admin can force restore.',
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
        platformNameZh = '图特工具平台';
    }

    platformNameZh = platformNameZh || (rawHasNonAscii ? rawName : 'Dragon 工具平台');
    platformNameEn = platformNameEn || (!rawHasNonAscii && rawName ? rawName : 'Dragon Platform');
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
    if (document.title !== platformTitleApplied) platformTitleOriginal = document.title;
    const isEn = typeof window !== 'undefined' && window.ToolsI18n?.getLanguage?.() === 'en-US';
    const mainName = (isEn && navState.settings?.platformNameEn)
        ? navState.settings.platformNameEn
        : (navState.settings?.platformNameZh || navState.settings?.platformName || '图特工具平台');
    let next = platformTitleOriginal || '';
    if (next.includes('Tools Platform')) {
        next = next.split('Tools Platform').join(mainName);
    } else if (next.includes('EG CS HUB')) {
        next = next.split('EG CS HUB').join(mainName);
    } else if (next.includes('图特工具平台')) {
        next = next.split('图特工具平台').join(mainName);
    } else if (next.includes('Thoth Platform')) {
        next = next.split('Thoth Platform').join(mainName);
    } else if (next.includes('Dragon Platform')) {
        next = next.split('Dragon Platform').join(mainName);
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
        zhName = 'Dragon 工具平台';
    }

    zhName = zhName || (rawHasNonAscii ? rawName : (navState.settings?.platformName || 'Dragon 工具平台'));
    enName = enName || (!rawHasNonAscii && rawName ? rawName : 'Dragon Platform');

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
        createdAt: tool.createdAt,
        updatedAt: tool.updatedAt
    }));
    return [...NAV_BUILTIN_LINKS, ...customItems];
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
        const path = window.location.pathname;
        const allItems = getAllNavItems();
        const currentItem = allItems.find(item => item && typeof item.match === 'function' && item.match(path));
        if (currentItem && currentItem.id) {
            recordRecentNavTool(currentItem.id);
        }
    } catch (_) {}
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
    const path = window.location.pathname;
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
    if (!menuEl) return;
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
}

function renderNavItem(item, className) {
    const path = window.location.pathname;
    const label = navEscape(getNavLabel(item));
    let content = className.includes('nav-more-item')
        ? `<span class="nav-more-item-icon">${item.icon}</span><span class="nav-more-item-label">${label}</span>`
        : `${item.icon} ${label}`;

    if (isRecentlyChangedTool(item)) {
        content += `<span class="new-badge">NEW!</span>`;
    }
    content += renderNavToolBadges(item);

    return `<a href="${item.href}" class="${className} ${item.match(path) ? 'active' : ''}" data-nav-item-id="${navEscape(item.id)}" data-nav-search="${navEscape(buildNavSearchIndex(item))}" title="${label}">${content}</a>`;
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

    menu.querySelector('.nav-more-search')?.addEventListener('input', event => {
        filterNavMoreItems(event.target.value);
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
    await loadRecentNavTools();
    trackCurrentPageAsRecentNavTool();
    if (document.getElementById('navSettingsModal')) renderNavSettingsContent();
}

function activeTenantName() {
    if (navState.activeTenantId === 'default') return navT('nav.tenant.defaultName');
    return navState.tenants.find(item => item.id === navState.activeTenantId)?.name || navState.activeTenantId || 'default';
}

function displayTenantName(tenant) {
    const name = tenant?.name || tenant?.id || '';
    return tenant?.id === 'default' && (!name || name === '默认租户' || name === 'Default Tenant')
        ? navT('nav.tenant.defaultName')
        : name;
}

async function loadTenantNavigation() {
    if (!hasNavAuthToken()) return;
    try {
        const response = await fetch('/api/tenants', { headers: getAuthHeaderForNav() });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        navState.tenants = Array.isArray(data.tenants) ? data.tenants : [];
        navState.activeTenantId = data.activeTenantId || 'default';
        localStorage.setItem('tools_tenant_id', navState.activeTenantId);
        const label = document.getElementById('navActiveTenantName');
        if (label) label.textContent = activeTenantName();
        renderTenantSwitchMenu();
    } catch (error) {
        console.warn('[Tenant] load failed:', error);
    }
}

async function loadManagedTenants() {
    const response = await fetch('/api/tenants?includeArchived=1', { headers: getAuthHeaderForNav() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    navState.managedTenants = Array.isArray(data.tenants) ? data.tenants : [];
}

function renderTenantSwitchMenu() {
    const menu = document.getElementById('navTenantMenu');
    if (!menu) return;
    menu.innerHTML = `
        <div class="nav-tenant-menu-label">${navEscape(navT('nav.tenant.current'))}</div>
        ${(navState.tenants || []).map(tenant => `<button type="button" class="nav-tenant-option ${tenant.id === navState.activeTenantId ? 'active' : ''}" onclick="switchActiveTenant('${navEscape(tenant.id)}')"><span>${navEscape(displayTenantName(tenant))}</span>${tenant.id === navState.activeTenantId ? '<span>✓</span>' : ''}</button>`).join('') || `<div class="nav-tenant-empty">${navEscape(navT('nav.tenant.empty'))}</div>`}
        ${localStorage.getItem('tools_role') === 'admin' ? `<button type="button" class="nav-tenant-manage" onclick="openTenantSettings()">⚙ ${navEscape(navT('nav.tenant.manage'))}</button>` : ''}
    `;
}

window.toggleTenantMenu = function (event) {
    event?.stopPropagation();
    document.getElementById('navTenantMenu')?.classList.toggle('open');
};

window.switchActiveTenant = async function (tenantId) {
    if (!tenantId || tenantId === navState.activeTenantId) return;
    const response = await fetch('/api/tenants/switch', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }, body: JSON.stringify({ tenantId })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return showNavbarNotice({
        title: navT('nav.dialog.error'),
        message: data.error || `HTTP ${response.status}`,
        tone: 'error'
    });
    switchTenantBrowserState(navState.activeTenantId, tenantId);
    localStorage.setItem('tools_tenant_id', tenantId);
    window.location.reload();
};

window.openTenantSettings = function () {
    document.getElementById('navTenantMenu')?.classList.remove('open');
    openNavSettingsModal();
    switchNavSettingsTab('tenants');
};

function renderNavbar() {
    const role = localStorage.getItem('tools_role');
    const user = localStorage.getItem('tools_user');


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
            <span class="brand-icon"><img src="/assets/logo.png?v=20261006" alt="Tools Platform" class="brand-logo-img" id="navBrandLogo"></span>
            <span class="brand-name">Tools Platform</span>
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
            ${role === 'admin' ? `<button type="button" class="nav-gear-btn" onclick="openNavSettingsModal()" title="${navEscape(navT('nav.settings'))}" aria-label="${navEscape(navT('nav.settings'))}">
                <svg class="nav-gear-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1.03-1.55V3h4v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.55 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15z"></path>
                </svg>
            </button>` : ''}
            <div class="nav-tenant-switcher">
                <button type="button" class="nav-user-chip" onclick="toggleTenantMenu(event)" title="${navEscape(navT('nav.tenant.switch'))}"><span class="nav-action-icon">👤</span><span class="nav-action-text">${navEscape(user || '未登录')} · <span id="navActiveTenantName">${navEscape(activeTenantName())}</span></span><span>▾</span></button>
                <div class="nav-tenant-menu" id="navTenantMenu"></div>
            </div>
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
    loadTenantNavigation();
}

document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-nav-item-id]');
    if (link) {
        const itemId = link.getAttribute('data-nav-item-id');
        if (itemId) recordRecentNavTool(itemId);
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
    document.getElementById('navTenantMenu')?.classList.remove('open');
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
    const tenantSwitcher = document.querySelector('.nav-tenant-switcher');
    if (tenantSwitcher && !tenantSwitcher.contains(event.target)) {
        document.getElementById('navTenantMenu')?.classList.remove('open');
    }
}, true);

function scheduleNavSettingsSave() {
    renderNavLinksFromState();
    writeNavigationBootstrapCache();
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

function moveArrayItem(arr, index, delta) {
    const next = index + delta;
    if (index < 0 || next < 0 || next >= arr.length) return arr;
    const copy = arr.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    return copy;
}

function renderNavSettingsTabLabel(icon, label) {
    return `<span class="nav-settings-tab-icon" aria-hidden="true">${navEscape(icon)}</span><span class="nav-settings-tab-label">${navEscape(label)}</span>`;
}

function renderPageSettingsTabs() {
    return NAV_BUILTIN_LINKS.map(item => `
        <button class="nav-settings-tab nav-settings-tab-page ${navState.settingsTab === `page:${item.id}` ? 'active' : ''}" data-tab="page:${navEscape(item.id)}" onclick="switchNavSettingsTab('page:${navEscape(item.id)}')">${renderNavSettingsTabLabel(item.icon, getNavLabel(item))}</button>
    `).join('');
}

function renderNavSettingsSidebar() {
    const sidebar = document.querySelector('.nav-settings-sidebar');
    if (!sidebar) return;
    const t = navState.settingsTab;
    sidebar.innerHTML = `
        <div class="nav-settings-title">${navEscape(navT('nav.set.title'))}</div>
        <button class="nav-settings-tab ${t === 'primary' ? 'active' : ''}" data-tab="primary" onclick="switchNavSettingsTab('primary')">${renderNavSettingsTabLabel('🧭', navT('nav.set.tab.primary'))}</button>
        <button class="nav-settings-tab ${t === 'logo' ? 'active' : ''}" data-tab="logo" onclick="switchNavSettingsTab('logo')">${renderNavSettingsTabLabel('🏷️', navT('nav.set.tab.logo'))}</button>
        <button class="nav-settings-tab ${t === 'categories' ? 'active' : ''}" data-tab="categories" onclick="switchNavSettingsTab('categories')">${renderNavSettingsTabLabel('🗂️', navT('nav.set.tab.categories'))}</button>
        <button class="nav-settings-tab ${t === 'items' ? 'active' : ''}" data-tab="items" onclick="switchNavSettingsTab('items')">${renderNavSettingsTabLabel('↕️', navT('nav.set.tab.items'))}</button>
        <button class="nav-settings-tab ${t === 'ai' ? 'active' : ''}" data-tab="ai" onclick="switchNavSettingsTab('ai')">${renderNavSettingsTabLabel('🤖', navT('nav.set.tab.ai'))}</button>
        <button class="nav-settings-tab ${t === 'channels' ? 'active' : ''}" data-tab="channels" onclick="switchNavSettingsTab('channels')">${renderNavSettingsTabLabel('🔌', navT('nav.set.tab.channels'))}</button>
        <button class="nav-settings-tab ${t === 'update' ? 'active' : ''}" data-tab="update" onclick="switchNavSettingsTab('update')">${renderNavSettingsTabLabel('🔄', navT('nav.set.tab.update'))}</button>
        <button class="nav-settings-tab ${t === 'backup' ? 'active' : ''}" data-tab="backup" onclick="switchNavSettingsTab('backup')">${renderNavSettingsTabLabel('💾', navT('nav.set.tab.backup'))}</button>
        <button class="nav-settings-tab ${t === 'snapshotPublish' ? 'active' : ''}" data-tab="snapshotPublish" onclick="switchNavSettingsTab('snapshotPublish')">${renderNavSettingsTabLabel('📤', navT('nav.set.tab.snapshotPublish'))}</button>
        <button class="nav-settings-tab ${t === 'initialize' ? 'active' : ''}" data-tab="initialize" onclick="switchNavSettingsTab('initialize')">${renderNavSettingsTabLabel('🌱', navT('nav.set.tab.initialize'))}</button>
        <button class="nav-settings-tab ${t === 'tenants' ? 'active' : ''}" data-tab="tenants" onclick="switchNavSettingsTab('tenants')">${renderNavSettingsTabLabel('🏢', navT('nav.set.tab.tenants'))}</button>
        <button class="nav-settings-tab ${t === 'media' ? 'active' : ''}" data-tab="media" onclick="switchNavSettingsTab('media')">${renderNavSettingsTabLabel('🎬', navT('nav.set.tab.media'))}</button>
        <button class="nav-settings-tab ${t === 'promotions' ? 'active' : ''}" data-tab="promotions" onclick="switchNavSettingsTab('promotions')">${renderNavSettingsTabLabel('📣', navT('nav.set.tab.promotions'))}</button>
        <button class="nav-settings-tab ${t === 'customBackup' ? 'active' : ''}" data-tab="customBackup" onclick="switchNavSettingsTab('customBackup')">${renderNavSettingsTabLabel('🧰', navT('nav.set.tab.customBackup'))}</button>
        <button class="nav-settings-tab ${t === 'accounts' ? 'active' : ''}" data-tab="accounts" onclick="switchNavSettingsTab('accounts')">${renderNavSettingsTabLabel('👤', navT('nav.set.tab.accounts'))}</button>
        <button class="nav-settings-tab ${t === 'security' ? 'active' : ''}" data-tab="security" onclick="switchNavSettingsTab('security')">${renderNavSettingsTabLabel('🛡️', navT('nav.set.tab.security'))}</button>
        <div class="nav-settings-title nav-settings-section-title">${navEscape(navT('nav.set.tab.pages'))}</div>
        ${renderPageSettingsTabs()}
        <div class="nav-settings-section-title" aria-hidden="true"></div>
        <button class="nav-settings-tab ${t === 'page:f12-extension' ? 'active' : ''}" data-tab="page:f12-extension" onclick="switchNavSettingsTab('page:f12-extension')">${renderNavSettingsTabLabel('🧩', navT('nav.page.f12.title'))}</button>
    `;
}

function openNavSettingsModal() {
    if (localStorage.getItem('tools_role') !== 'admin') return;
    let modal = document.getElementById('navSettingsModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'navSettingsModal';
        modal.className = 'nav-settings-modal';
        modal.innerHTML = `
            <div class="nav-settings-window">
                <div class="nav-settings-sidebar"></div>
                <div class="nav-settings-main">
                    <button class="nav-settings-close" onclick="closeNavSettingsModal()">×</button>
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
    }
    modal.style.display = 'flex';
    renderNavSettingsSidebar();
    renderNavSettingsContent();
}

function closeNavSettingsModal() {
    const modal = document.getElementById('navSettingsModal');
    if (modal) modal.style.display = 'none';
}

window.openNavSettingsModal = openNavSettingsModal;
window.closeNavSettingsModal = closeNavSettingsModal;

window.switchNavSettingsTab = function (tab) {
    navState.settingsTab = tab;
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
    if (navState.settingsTab === 'accounts') return navT('nav.set.tab.accounts');
    if (navState.settingsTab === 'security') return navT('nav.set.tab.security');
    if (navState.settingsTab === 'ai') return navT('nav.set.tab.ai');
    if (navState.settingsTab === 'channels') return navT('nav.set.tab.channels');
    if (navState.settingsTab === 'update') return navT('nav.set.tab.update');
    if (navState.settingsTab === 'backup') return navT('nav.set.tab.backup');
    if (navState.settingsTab === 'snapshotPublish') return navT('nav.set.tab.snapshotPublish');
    if (navState.settingsTab === 'initialize') return navT('nav.set.tab.initialize');
    if (navState.settingsTab === 'tenants') return navT('nav.set.tab.tenants');
    if (navState.settingsTab === 'media') return navT('nav.set.tab.media');
    if (navState.settingsTab === 'promotions') return navT('nav.set.tab.promotions');
    if (navState.settingsTab === 'customBackup') return navT('nav.set.tab.customBackup');
    if (navState.settingsTab === 'categories') return navT('nav.set.tab.categories');
    if (navState.settingsTab === 'items') return navT('nav.set.tab.items');
    if (navState.settingsTab === 'logo') return navT('nav.set.tab.logo');
    return navT('nav.set.tab.primary');
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
    if (navState.settingsTab === 'channels') return navT('nav.set.sub.channels');
    if (navState.settingsTab === 'update') return navT('nav.set.sub.update');
    if (navState.settingsTab === 'backup') return navT('nav.set.sub.backup');
    if (navState.settingsTab === 'snapshotPublish') return navT('nav.set.sub.snapshotPublish');
    if (navState.settingsTab === 'initialize') return navT('nav.set.sub.initialize');
    if (navState.settingsTab === 'tenants') return navT('nav.set.sub.tenants');
    if (navState.settingsTab === 'media') return navT('nav.set.sub.media');
    if (navState.settingsTab === 'promotions') return navT('nav.set.sub.promotions');
    if (navState.settingsTab === 'customBackup') return navT('nav.set.sub.customBackup');
    if (navState.settingsTab === 'categories') return navT('nav.set.sub.categories');
    if (navState.settingsTab === 'items') return navT('nav.set.sub.items');
    if (navState.settingsTab === 'logo') return navT('nav.set.sub.logo');
    return navT('nav.set.sub.primary');
}

function renderNavSettingsContent() {
    const content = document.getElementById('navSettingsContent');
    const heading = document.getElementById('navSettingsHeading');
    const subtitle = document.getElementById('navSettingsSubtitle');
    if (!content) return;
    if (heading) heading.textContent = getNavSettingsTitle();
    if (subtitle) subtitle.textContent = getNavSettingsSubtitle();

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator && (indicator.textContent === '已加载' || indicator.textContent === 'Loaded')) {
        indicator.textContent = navT('nav.set.loaded');
    }

    if (navState.settingsTab.startsWith('page:')) return renderPageSettings(content, navState.settingsTab.slice(5));
    if (navState.settingsTab === 'accounts') return renderAccountSettings(content);
    if (navState.settingsTab === 'security') return renderSecuritySettings(content);
    if (navState.settingsTab === 'ai') return renderAiSettings(content);
    if (navState.settingsTab === 'channels') return renderChannelSettings(content);
    if (navState.settingsTab === 'update') return renderUpdaterSettings(content);
    if (navState.settingsTab === 'backup') return renderBackupSettings(content);
    if (navState.settingsTab === 'snapshotPublish') return renderSnapshotPublishSettings(content);
    if (navState.settingsTab === 'initialize') return renderInitializationSettings(content);
    if (navState.settingsTab === 'tenants') return renderTenantSettings(content);
    if (navState.settingsTab === 'media') return renderMediaSettings(content);
    if (navState.settingsTab === 'promotions') return renderPromotionSettings(content);
    if (navState.settingsTab === 'customBackup') return renderCustomToolBackupSettings(content);
    if (navState.settingsTab === 'categories') return renderCategorySettings(content);
    if (navState.settingsTab === 'items') return renderItemCategorySettings(content);
    if (navState.settingsTab === 'logo') return renderLogoSettings(content);
    renderPrimarySettings(content);
}

function renderNavigationRestorePanel() {
    return `
        <section class="nav-settings-restore-card">
            <div>
                <strong>${navEscape(navT('nav.set.restore.title'))}</strong>
                <p>${navEscape(navT('nav.set.restore.desc'))}</p>
            </div>
            <div class="nav-settings-restore-actions">
                <button type="button" class="nav-settings-btn-restore" onclick="restoreSystemNavigationDefaults()">${navEscape(navT('nav.set.restore.button'))}</button>
                <button type="button" class="nav-settings-btn-setdefault" onclick="setCurrentNavigationAsDefault()">${navEscape(navT('nav.set.default.button'))}</button>
            </div>
        </section>
    `;
}

window.restoreSystemNavigationDefaults = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.set.restore.confirmTitle'),
        message: navT('nav.set.restore.confirmMessage'),
        hint: navT('nav.set.restore.confirmHint'),
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.set.restore.action')
    });
    if (!confirmed) return;

    clearTimeout(navState.saveTimer);
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.restore.restoring');
    try {
        const res = await fetch('/api/nav-settings/restore-defaults', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: '{}'
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.settings) throw new Error(payload.error || `HTTP ${res.status}`);
        navState.settings = normalizeNavSettings(payload.settings);
        writeNavigationBootstrapCache();
        renderNavLinksFromState();
        renderNavSettingsContent();
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) {
            nextIndicator.textContent = navT('nav.set.restore.success', {
                tools: Number(payload.preservedCustomToolCount || 0),
                categories: Number(payload.preservedCustomCategoryCount || 0)
            });
        }
    } catch (error) {
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) nextIndicator.textContent = navT('nav.set.restore.fail') + error.message;
    }
};

window.setCurrentNavigationAsDefault = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.set.default.confirmTitle'),
        message: navT('nav.set.default.confirmMessage'),
        hint: navT('nav.set.default.confirmHint'),
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.set.default.action')
    });
    if (!confirmed) return;

    clearTimeout(navState.saveTimer);
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.default.saving');
    try {
        const res = await fetch('/api/nav-settings/set-as-default', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ settings: navState.settings })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success) throw new Error(payload.error || `HTTP ${res.status}`);
        if (payload.settings) {
            navState.settings = normalizeNavSettings(payload.settings);
        }
        writeNavigationBootstrapCache();
        renderNavLinksFromState();
        renderNavSettingsContent();
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) {
            nextIndicator.textContent = navT('nav.set.default.success');
        }
    } catch (error) {
        const nextIndicator = document.getElementById('navSettingsSaveState');
        if (nextIndicator) nextIndicator.textContent = navT('nav.set.default.fail') + error.message;
    }
};

function renderPrimarySettings(content) {
    const items = sortNavItems(getAllNavItems(), navState.settings.primaryIds);
    const primaryIds = new Set(navState.settings.primaryIds || []);
    content.innerHTML = `
        ${renderNavigationRestorePanel()}
        <div class="nav-settings-help">${navEscape(navT('nav.set.help.primary'))}</div>
        <div class="nav-settings-list">
            ${items.map(item => {
        const index = navState.settings.primaryIds.indexOf(item.id);
        return `
                    <div class="nav-settings-row">
                        <label class="nav-settings-check">
                            <input type="checkbox" ${primaryIds.has(item.id) ? 'checked' : ''} onchange="togglePrimaryNavItem('${navEscape(item.id)}', this.checked)">
                            <span>${item.icon} ${navEscape(getNavLabel(item))}</span>
                        </label>
                        <div class="nav-settings-actions">
                            <button onclick="movePrimaryNavItem('${navEscape(item.id)}', -1)" ${index <= 0 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.up'))}</button>
                            <button onclick="movePrimaryNavItem('${navEscape(item.id)}', 1)" ${index < 0 || index >= navState.settings.primaryIds.length - 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.down'))}</button>
                        </div>
                    </div>
                `;
    }).join('')}
        </div>
    `;
}

window.togglePrimaryNavItem = function (id, checked) {
    const ids = navState.settings.primaryIds || [];
    if (checked && !ids.includes(id)) ids.push(id);
    if (!checked) navState.settings.primaryIds = ids.filter(item => item !== id);
    else navState.settings.primaryIds = ids;
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

window.movePrimaryNavItem = function (id, delta) {
    const ids = navState.settings.primaryIds || [];
    const index = ids.indexOf(id);
    navState.settings.primaryIds = moveArrayItem(ids, index, delta);
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

function renderCategorySettings(content) {
    const categories = navState.settings.categories || [];
    content.innerHTML = `
        ${renderNavigationRestorePanel()}
        <div class="nav-settings-help">${navEscape(navT('nav.set.help.categories'))}</div>
        <div class="nav-settings-list">
            ${categories.map((cat, index) => `
                <div class="nav-settings-row" style="flex-wrap: wrap; gap: 8px; padding-bottom: 12px;">
                    <div style="display: flex; gap: 8px; flex: 1; min-width: min(300px, 100%);">
                        <input class="nav-settings-input" placeholder="${navEscape(navT('nav.set.placeholder.zh'))}" value="${navEscape(cat.name)}" oninput="renameNavCategory('${navEscape(cat.id)}', this.value, 'zh')">
                        <input class="nav-settings-input" placeholder="${navEscape(navT('nav.set.placeholder.en'))}" value="${navEscape(cat.nameEn || '')}" oninput="renameNavCategory('${navEscape(cat.id)}', this.value, 'en')">
                    </div>
                    <div class="nav-settings-actions" style="margin-left: auto;">
                        <button onclick="moveNavCategory(${index}, -1)" ${index === 0 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.up'))}</button>
                        <button onclick="moveNavCategory(${index}, 1)" ${index === categories.length - 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.down'))}</button>
                        <button onclick="deleteNavCategory('${navEscape(cat.id)}')" ${categories.length <= 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.delete'))}</button>
                    </div>
                </div>
            `).join('')}
        </div>
        <button class="nav-settings-add" onclick="addNavCategory()">${navEscape(navT('nav.set.btn.addCategory'))}</button>
    `;
}

window.renameNavCategory = function (id, name, lang = 'zh') {
    const cat = (navState.settings.categories || []).find(item => item.id === id);
    if (cat) {
        if (lang === 'zh') cat.name = name.trim();
        else if (lang === 'en') cat.nameEn = name.trim();
    }
    scheduleNavSettingsSave();
};

window.moveNavCategory = function (index, delta) {
    navState.settings.categories = moveArrayItem(navState.settings.categories || [], index, delta);
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

window.addNavCategory = function () {
    const id = `cat_${Date.now().toString(36)}`;
    navState.settings.categories.push({ id, name: navT('nav.set.newCategory') });
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

window.deleteNavCategory = function (id) {
    const categories = navState.settings.categories || [];
    const fallback = categories.find(item => item.id !== id);
    navState.settings.categories = categories.filter(item => item.id !== id);
    Object.keys(navState.settings.categoryByItem || {}).forEach(itemId => {
        if (navState.settings.categoryByItem[itemId] === id && fallback) {
            navState.settings.categoryByItem[itemId] = fallback.id;
        }
    });
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

function renderItemCategorySettings(content) {
    const settings = navState.settings;
    const primaryIds = new Set(settings.primaryIds || []);
    const items = sortNavItems(getAllNavItems().filter(item => !primaryIds.has(item.id)), settings.itemOrder);
    const categories = settings.categories || [];
    content.innerHTML = `
        ${renderNavigationRestorePanel()}
        <div class="nav-settings-help">${navEscape(navT('nav.set.help.items'))}</div>
        <div class="nav-settings-list">
            ${items.map((item, index) => {
        const selected = settings.categoryByItem[item.id] || item.defaultCategory || (categories[0] && categories[0].id) || '';
        return `
                    <div class="nav-settings-row">
                        <div class="nav-settings-item-name">${item.icon} ${navEscape(getNavLabel(item))}</div>
                        <select class="nav-settings-select" onchange="setNavItemCategory('${navEscape(item.id)}', this.value)">
                            ${categories.map(cat => `<option value="${navEscape(cat.id)}" ${cat.id === selected ? 'selected' : ''}>${navEscape(getNavCategoryName(cat))}</option>`).join('')}
                        </select>
                        <div class="nav-settings-actions">
                            <button onclick="moveOverflowNavItem('${navEscape(item.id)}', -1)" ${index === 0 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.up'))}</button>
                            <button onclick="moveOverflowNavItem('${navEscape(item.id)}', 1)" ${index === items.length - 1 ? 'disabled' : ''}>${navEscape(navT('nav.set.btn.down'))}</button>
                        </div>
                    </div>
                `;
    }).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.set.emptyItems'))}</div>`}
        </div>
    `;
}

window.setNavItemCategory = function (id, categoryId) {
    navState.settings.categoryByItem[id] = categoryId;
    scheduleNavSettingsSave();
};

window.moveOverflowNavItem = function (id, delta) {
    const primaryIds = new Set(navState.settings.primaryIds || []);
    const overflowIds = sortNavItems(getAllNavItems().filter(item => !primaryIds.has(item.id)), navState.settings.itemOrder).map(item => item.id);
    const moved = moveArrayItem(overflowIds, overflowIds.indexOf(id), delta);
    const primaryOrder = new Set(moved);
    const rest = (navState.settings.itemOrder || []).filter(itemId => !primaryOrder.has(itemId));
    navState.settings.itemOrder = [...moved, ...rest];
    renderNavSettingsContent();
    scheduleNavSettingsSave();
};

function sourceLabelForAiSettings(source) {
    if (source === 'stored') return navT('nav.ai.srcStored');
    if (source === 'env') return navT('nav.ai.srcEnv');
    return navT('nav.ai.srcNone');
}

function keyHealthLabelForAiSettings(settings) {
    if (!settings.hasApiKey) return navT('nav.ai.keyNone');
    if (!settings.keyLooksValid) return navT('nav.ai.keyInvalid') + (settings.maskedApiKey || '');
    return navT('nav.ai.keyValid') + (settings.maskedApiKey || '');
}

async function fetchAiSettingsForNav() {
    const res = await fetch('/api/ai-settings', { headers: getAuthHeaderForNav() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    navState.aiSettings = await res.json();
    const profiles = Array.isArray(navState.aiSettings.profiles) ? navState.aiSettings.profiles : [];
    if (!profiles.some(item => item.id === navState.aiSelectedProfileId)) {
        navState.aiSelectedProfileId = navState.aiSettings.activeProfileId || profiles[0]?.id || null;
    }
    return navState.aiSettings;
}

function formatAiUsageNumber(value) {
    const number = Number(value || 0);
    if (number >= 1000000) return `${(number / 1000000).toFixed(number >= 10000000 ? 1 : 2)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(number >= 100000 ? 1 : 2)}K`;
    return Math.round(number).toLocaleString();
}

// ============================================================
// 🎨 平台图标与品牌管理 (Platform Logo & Branding Settings)
// ============================================================
window._selectedLogoFile = null;

function logoUploadError(error) {
    const messages = {
        LOGO_FORMAT: navLocaleText('请选择 PNG、JPG 或 WEBP 图片。', 'Choose a PNG, JPG or WEBP image.'),
        LOGO_SIZE: navLocaleText('图片不能超过 25 MB。', 'The image must be 25 MB or smaller.'),
        LOGO_DECODE: navLocaleText('无法读取图片，请检查文件是否损坏。', 'Cannot decode the image. Check that the file is valid.'),
        LOGO_BUSY: navLocaleText('正在处理另一张图标，请稍后重试。', 'Another logo is being processed. Please retry shortly.')
    };
    return messages[error.code || error.message] || error.message;
}

async function renderLogoSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `<div class="nav-settings-empty">${text('正在加载平台标识…', 'Loading platform identity…')}</div>`;
    let statusData;
    try {
        const res = await fetch('/api/platform-logo/status', { headers: getAuthHeaderForNav() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        statusData = await res.json();
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${text('无法读取图标状态：', 'Could not load logo status: ')}${navEscape(error.message)}</div>`;
        return;
    }
    const logoUrl = navEscape(statusData.logoUrl || '/assets/logo.png');
    const timestamp = statusData.updatedAt ? new Date(statusData.updatedAt).toLocaleString() : text('默认内置', 'Bundled default');
    const runtime = statusData.storageMode === 'runtime';
    content.innerHTML = `
        <div class="logo-settings-container">
            <div class="logo-settings-card">
                <h3>✏️ ${text('平台标识与名称设定', 'Platform identity & names')}</h3>
                <p>${text('支持配置中英文主名称、副标题与登录页专属标语。在中文界面优先显示中文名称，英文界面自动倒置为主英辅中。保存后自动同步为平台全局默认配置。', 'Configure Chinese and English platform names, subtitle and login slogan. Display order reverses automatically based on current language. Saved values become the system defaults.')}</p>
                <form onsubmit="event.preventDefault(); savePlatformName()">
                    <input type="hidden" id="platformNameInput" value="${navEscape(navState.settings.platformName || '图特工具平台')}">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:14px;margin-top:12px;">
                        <div>
                            <label for="platformNameZhInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">🇨🇳 ${text('主名称 (中文)', 'Main Name (Chinese)')}</label>
                            <input id="platformNameZhInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="80" value="${navEscape(navState.settings.platformNameZh || (/[^\x00-\x7F]/.test(navState.settings.platformName || '') ? navState.settings.platformName : '图特工具平台'))}" placeholder="图特工具平台" autocomplete="off" oninput="document.getElementById('platformNameInput').value = this.value">
                        </div>
                        <div>
                            <label for="platformNameEnInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">🇬🇧 ${text('主名称 (英文)', 'Main Name (English)')}</label>
                            <input id="platformNameEnInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="80" value="${navEscape(navState.settings.platformNameEn || (!/[^\x00-\x7F]/.test(navState.settings.platformName || '') && navState.settings.platformName ? navState.settings.platformName : 'Dragon Platform'))}" placeholder="Dragon Platform" autocomplete="off">
                        </div>
                        <div>
                            <label for="platformSubtitleInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">📑 ${text('页面副标题 (中文)', 'Page Subtitle (Chinese)')}</label>
                            <input id="platformSubtitleInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="120" value="${navEscape(navState.settings.platformSubtitle || '埃及 CS 工具与知识中心')}" placeholder="埃及 CS 工具与知识中心" autocomplete="off">
                        </div>
                        <div>
                            <label for="platformSubtitleEnInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">📑 ${text('页面副标题 (英文)', 'Page Subtitle (English)')}</label>
                            <input id="platformSubtitleEnInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="120" value="${navEscape(navState.settings.platformSubtitleEn || 'Egypt CS Tools & Knowledge Center')}" placeholder="Egypt CS Tools & Knowledge Center" autocomplete="off">
                        </div>
                        <div style="grid-column: 1 / -1;">
                            <label for="platformSloganInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">✨ ${text('登录页标语 (中文)', 'Login Page Slogan (Chinese)')}</label>
                            <input id="platformSloganInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="200" value="${navEscape(navState.settings.platformSlogan || '“认真做好每一个工具，让日常工作更省心。”')}" placeholder="“认真做好每一个工具，让日常工作更省心。”" autocomplete="off">
                        </div>
                        <div style="grid-column: 1 / -1;">
                            <label for="platformSloganEnInput" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:6px;">✨ ${text('登录页标语 (英文)', 'Login Page Slogan (English)')}</label>
                            <input id="platformSloganEnInput" class="nav-settings-input" style="width:100%;box-sizing:border-box" maxlength="200" value="${navEscape(navState.settings.platformSloganEn || '“Build every tool with care. Make everyday work easier.”')}" placeholder="“Build every tool with care. Make everyday work easier.”" autocomplete="off">
                        </div>
                    </div>
                    <div style="margin-top:14px">
                        <label for="platformGuideVideoUrlInput">${text('平台使用介绍视频（可选）', 'Platform introduction video (optional)')}</label>
                        <input type="url" id="platformGuideVideoUrlInput" class="nav-settings-input" style="width:100%;box-sizing:border-box;margin-top:6px" maxlength="2048" value="${navEscape(navState.settings.platformGuideVideoUrl || '')}" placeholder="https://…">
                        <p style="font-size:12px;opacity:.7">${text('AI 回答平台使用问题时附上此链接；清空后关闭视频推荐。', 'AI adds this link to platform usage answers. Leave blank to disable.')}</p>
                    </div>
                    <div class="nav-settings-actions" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px">
                        <button type="submit" class="primary" id="platformNameSaveBtn">${text('保存标识设置', 'Save identity settings')}</button>
                        <span id="platformNameSaveStatus" role="status" style="font-size:12px"></span>
                    </div>
                </form>
            </div>
            <div class="logo-ci-banner">
                <strong>✦ ${text('平台品牌与应用图标', 'Platform branding and app icons')}</strong>
                <span>${runtime
                    ? text('新 Logo 保存在本机用户数据目录，页面、浏览器图标及运行中的托盘图标会更新，重启后仍保留。', 'Your logo is saved in local user data. Pages, favicons and the running tray update, and the logo persists after restart.')
                    : text('上传后生成页面 Logo、浏览器图标及各平台打包图标，可将生成的资源提交到源码仓库用于下次打包。', 'Uploading generates page logos, favicons and packaging assets. Commit the generated assets to your source repository for the next build.')}</span><br>
                <span>${text('EXE 文件图标、macOS 应用包与安装包图标在重新打包后生效。', 'EXE file icons, macOS application bundles and installer icons change after rebuilding.')}</span>
            </div>
            <div class="logo-settings-card">
                <h3>👁 ${text('实时多场景预览', 'Live previews')}</h3>
                <p>${text('检查透明边缘、浅色背景和桌面图标的清晰度。', 'Check transparent edges, light backgrounds and desktop icon clarity.')}</p>
                <div class="logo-preview-grid">
                    <div class="logo-preview-box dark-bg">
                        <span class="logo-preview-tag">${text('深色背景', 'Dark background')}</span>
                        <div class="logo-preview-img-row">
                            <div style="text-align:center"><img src="${logoUrl}" alt="Logo 24px" class="brand-logo-img" style="width:24px;height:24px;object-fit:contain"><div>24px</div></div>
                            <div style="text-align:center"><img src="${logoUrl}" alt="Logo 72px" style="width:72px;height:72px;object-fit:contain"><div>72px</div></div>
                        </div>
                    </div>
                    <div class="logo-preview-box light-bg">
                        <span class="logo-preview-tag">${text('浅色背景', 'Light background')}</span>
                        <img src="${logoUrl}" alt="Logo" style="width:72px;height:72px;object-fit:contain">
                    </div>
                    <div class="logo-preview-box neutral-bg">
                        <span class="logo-preview-tag">${text('桌面应用图标预览', 'Desktop icon preview')}</span>
                        <div class="logo-preview-img-row">
                            <div style="text-align:center"><img src="/assets/icon-windows.png?t=${statusData.updatedAt}" alt="Standard" style="width:48px;height:48px;object-fit:contain"><div>${text('标准版', 'Standard')}</div></div>
                            <div style="text-align:center"><img src="/assets/icon-windows-portable.png?t=${statusData.updatedAt}" alt="Portable" style="width:48px;height:48px;object-fit:contain"><div>${text('便携版（P 标）', 'Portable (P)')}</div></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="logo-settings-card">
                <h3>📤 ${text('上传 Logo 并生成各尺寸', 'Upload a logo and generate all sizes')}</h3>
                <p>${text('支持 PNG、JPG、JPEG、WEBP，最大 25 MB；建议使用 512×512 或更高分辨率。', 'PNG, JPG, JPEG and WEBP, up to 25 MB; 512×512 or higher is recommended.')}</p>
                <div class="logo-upload-zone" id="logoDropZone" onclick="document.getElementById('logoFileInput').click()">
                    <span class="logo-upload-icon">📁</span>
                    <span class="logo-upload-title" id="logoUploadTitle">${text('点击选择图片，或拖拽到此处', 'Choose an image or drop it here')}</span>
                    <span class="logo-upload-hint">${text('支持白底和透明底，保留图标比例及透明图片内部白色细节。', 'White or transparent backgrounds; preserves proportions and white details in transparent artwork.')}</span>
                    <input type="file" id="logoFileInput" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="handleLogoFileSelect(event)">
                </div>
                <div class="logo-option-row">
                    <label class="logo-option-item"><input type="checkbox" id="logoOptCropBottom" checked><span><b>${text('自动裁切下方附加文本（推荐，仅保留核心主体徽标）', 'Auto crop bottom text (recommended: keep main badge only)')}</b></span></label>
                    <label class="logo-option-item"><input type="checkbox" id="logoOptRemoveBg" checked><span><b>${text('移除外围白色背景', 'Remove outer white background')}</b></span></label>
                    <label class="logo-option-item"><input type="checkbox" id="logoOptDarkEnhance" checked><span><b>${text('暗色背景边缘微光', 'Subtle edge glow on dark backgrounds')}</b></span></label>
                </div>
                <div class="nav-settings-actions" style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                    <button type="button" class="primary" id="logoUploadSubmitBtn" onclick="submitLogoUpload()" disabled>${text('生成并应用图标', 'Generate and apply icons')}</button>
                    <button type="button" id="logoDownloadBundleBtn" onclick="downloadLogoBundle()" ${statusData.hasLogo ? '' : 'disabled'}>📦 ${text('一键下载全部运营物料资产包 (.zip)', 'Download brand assets bundle (.zip)')}</button>
                    <span id="logoUploadStatus" role="status" style="font-size:12px">${text('最近更新：', 'Last updated: ')}${navEscape(timestamp)}</span>
                </div>
                <label for="logoStoreScreenshots" style="display:block;margin-top:14px;font-size:12px">${text('商店截图（可选，1–5 张 PNG/JPEG，每张不超过 10 MB）', 'Store screenshots (optional, 1–5 PNG/JPEG files, up to 10 MB each)')}</label>
                <input id="logoStoreScreenshots" type="file" accept="image/png,image/jpeg" multiple style="display:block;margin-top:8px;max-width:100%">
                <p style="font-size:12px;margin-top:8px">${text('资产包包含商店图标 128×128、小型宣传图 440×280、顶部宣传图 1400×560 和标准宣传截图 1280×800。未选择截图时由服务端自动生成标准宣传截图；若用于插件上架，可选择该插件的真实界面截图。视频需自行上传 YouTube 后填写网址。', 'Includes a 128×128 store icon, 440×280 small promo, 1400×560 marquee and standard 1280×800 promo screenshots. With no selected images, the server automatically generates standard promo screenshots. For an extension listing, you can select actual screenshots of that extension. Upload videos to YouTube separately.')}</p>
                <div id="logoUploadResultDetail" style="margin-top:12px;font-size:11px;white-space:pre-wrap;display:none"></div>
            </div>
        </div>`;
    const dropZone = document.getElementById('logoDropZone');
    dropZone.ondragover = event => { event.preventDefault(); dropZone.classList.add('dragover'); };
    dropZone.ondragleave = () => dropZone.classList.remove('dragover');
    dropZone.ondrop = event => {
        event.preventDefault(); dropZone.classList.remove('dragover');
        if (event.dataTransfer.files?.[0]) handleLogoFileSelect({ target: { files: event.dataTransfer.files } });
    };
}

window.savePlatformName = async function () {
    const input = document.getElementById('platformNameInput');
    const button = document.getElementById('platformNameSaveBtn');
    const status = document.getElementById('platformNameSaveStatus');
    if (!input || !button || button.disabled) return;

    const zhInput = document.getElementById('platformNameZhInput');
    const enInput = document.getElementById('platformNameEnInput');
    const subInput = document.getElementById('platformSubtitleInput');
    const subEnInput = document.getElementById('platformSubtitleEnInput');
    const sloganInput = document.getElementById('platformSloganInput');
    const sloganEnInput = document.getElementById('platformSloganEnInput');

    const clean = (val, max = 120) => typeof val === 'string'
        ? val.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
        : '';

    const rawInput = clean(input.value, 80);
    const platformNameZh = zhInput
        ? (clean(zhInput.value, 80) || rawInput || '图特工具平台')
        : (rawInput || '图特工具平台');
    const platformNameEn = enInput
        ? (clean(enInput.value, 80) || navState.settings?.platformNameEn || 'Dragon Platform')
        : (rawInput || 'Dragon Platform');
    const platformSubtitle = (subInput ? clean(subInput.value, 120) : '') || navState.settings?.platformSubtitle || '埃及 CS 工具与知识中心';
    const platformSubtitleEn = (subEnInput ? clean(subEnInput.value, 120) : '') || navState.settings?.platformSubtitleEn || 'Egypt CS Tools & Knowledge Center';
    const platformSlogan = (sloganInput ? clean(sloganInput.value, 200) : '') || navState.settings?.platformSlogan || '“认真做好每一个工具，让日常工作更省心。”';
    const platformSloganEn = (sloganEnInput ? clean(sloganEnInput.value, 200) : '') || navState.settings?.platformSloganEn || '“Build every tool with care. Make everyday work easier.”';
    const platformName = rawInput || platformNameZh;

    button.disabled = true;
    if (status) status.textContent = navT('nav.set.saving');
    clearTimeout(navState.saveTimer);
    try {
        const response = await fetch('/api/nav-settings', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({
                ...navState.settings,
                platformGuideVideoUrl: document.getElementById('platformGuideVideoUrlInput')?.value.trim() ?? navState.settings.platformGuideVideoUrl,
                platformName,
                platformNameZh,
                platformNameEn,
                platformSubtitle,
                platformSubtitleEn,
                platformSlogan,
                platformSloganEn
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        navState.settings = normalizeNavSettings(data);
        writeNavigationBootstrapCache();
        renderNavLinksFromState();
        input.value = navState.settings.platformName;
        if (zhInput) zhInput.value = navState.settings.platformNameZh;
        if (enInput) enInput.value = navState.settings.platformNameEn;
        if (subInput) subInput.value = navState.settings.platformSubtitle;
        if (subEnInput) subEnInput.value = navState.settings.platformSubtitleEn;
        if (sloganInput) sloganInput.value = navState.settings.platformSlogan;
        if (sloganEnInput) sloganEnInput.value = navState.settings.platformSloganEn;
        if (status) status.textContent = navT('nav.set.saved');
    } catch (error) {
        if (status) status.textContent = navT('nav.set.saveFail') + error.message;
    } finally {
        button.disabled = false;
    }
};

window.handleLogoFileSelect = function (event) {
    const file = event.target.files?.[0];
    if (!file) return;
    window._selectedLogoFile = file;
    const title = document.getElementById('logoUploadTitle');
    if (title) title.textContent = `${navLocaleText('已选择：', 'Selected: ')}${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const button = document.getElementById('logoUploadSubmitBtn');
    if (button) button.disabled = false;
};

window.submitLogoUpload = async function () {
    const file = window._selectedLogoFile || document.getElementById('logoFileInput')?.files?.[0];
    if (!file) {
        await showNavbarNotice({ title: navLocaleText('选择图片', 'Choose an image'), message: navLocaleText('请先选择 Logo 图片。', 'Select a logo image first.') });
        return;
    }
    const button = document.getElementById('logoUploadSubmitBtn');
    if (button?.disabled) return;
    const status = document.getElementById('logoUploadStatus');
    const detail = document.getElementById('logoUploadResultDetail');
    const cropBottom = document.getElementById('logoOptCropBottom')?.checked ?? true;
    const removeBg = document.getElementById('logoOptRemoveBg')?.checked ?? true;
    const darkEnhance = document.getElementById('logoOptDarkEnhance')?.checked ?? true;
    if (button) { button.disabled = true; button.textContent = navLocaleText('正在生成…', 'Generating…'); }
    if (status) status.textContent = navLocaleText('正在处理图片并生成 PNG / ICO / BMP…', 'Processing image and generating PNG / ICO / BMP…');
    if (detail) { detail.style.display = 'none'; detail.textContent = ''; }
    try {
        const prepared = await window.PlatformLogoUpload.prepareFile(file);
        const body = new FormData();
        body.append('logo', prepared);
        body.append('cropBottomText', String(cropBottom));
        body.append('removeBg', String(removeBg));
        body.append('darkEnhance', String(darkEnhance));
        const response = await fetch('/api/platform-logo/upload', { method: 'POST', headers: getAuthHeaderForNav(), body });
        const data = await response.json().catch(() => { throw new Error(navLocaleText(`服务返回异常（HTTP ${response.status}），请检查后端或代理。`, `Unexpected response (HTTP ${response.status}); check the backend or proxy.`)); });
        if (!response.ok || !data.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.code = data.code; throw error; }
        document.querySelectorAll('.brand-logo-img, .hero-logo-img, #navBrandLogo, #homeHeroLogo').forEach(image => { image.src = data.logoUrl; });
        const favicon = document.querySelector('link[rel="icon"]');
        if (favicon) favicon.href = `/favicon.ico?t=${data.updatedAt}`;
        const content = document.getElementById('navSettingsContent');
        if (content && navState.settingsTab === 'logo') await renderLogoSettings(content);
        const updatedStatus = document.getElementById('logoUploadStatus');
        if (updatedStatus) updatedStatus.textContent = navLocaleText(`已生成 ${data.assetCount} 处图标并应用。`, `Generated and applied ${data.assetCount} icon assets.`);
        const downloadBtn = document.getElementById('logoDownloadBundleBtn');
        if (downloadBtn) downloadBtn.disabled = false;
    } catch (error) {
        const message = logoUploadError(error);
        if (status) status.textContent = navLocaleText('处理失败：', 'Failed: ') + message;
        await showNavbarNotice({ title: navLocaleText('图标更新失败', 'Logo update failed'), message, tone: 'error' });
    } finally {
        if (button) { button.disabled = false; button.textContent = navLocaleText('生成并应用图标', 'Generate and apply icons'); }
    }
};

// 平台服务的每个响应都带 X-Request-Id（server.js 请求 ID 中间件）；缺失说明请求被本机代理、
// 企业安全软件或网关拦截，没有到达平台服务，给出可排查的提示而不是只有状态码。
async function describeLogoBundleFailure(response) {
    const requestId = response.headers.get('x-request-id');
    const raw = await response.text().catch(() => '');
    let data = {};
    try { data = JSON.parse(raw); } catch (_) {}
    if (data.error) return requestId ? `${data.error} (${requestId})` : data.error;
    if (response.status === 403) {
        const adminMsg = navLocaleText('权限不足，需要超级管理员账号 (HTTP 403)', 'Permission denied: Super administrator role required (HTTP 403)');
        return requestId ? `${adminMsg} (${requestId})` : adminMsg;
    }
    if (!requestId) {
        return navLocaleText(
            `HTTP ${response.status}：请求未到达平台服务，可能被本机代理或企业安全软件（如上传/DLP 管控）拦截`,
            `HTTP ${response.status}: the request never reached the platform service; a local proxy or security software (upload/DLP control) may have blocked it`
        );
    }
    return `HTTP ${response.status} (${requestId})`;
}

window.downloadLogoBundle = async function () {
    const button = document.getElementById('logoDownloadBundleBtn');
    const status = document.getElementById('logoUploadStatus');
    const originalText = button ? button.textContent : '';
    if (button) {
        button.disabled = true;
        button.textContent = navLocaleText('正在打包资产…', 'Packaging assets…');
    }
    if (status) status.textContent = navLocaleText('正在打包全套运营物料与各端徽标，请稍候…', 'Packaging brand and icon assets, please wait…');
    try {
        const screenshotInput = document.getElementById('logoStoreScreenshots');
        const customFiles = Array.from(screenshotInput?.files || []);
        let response;

        if (customFiles.length > 0) {
            // 用户显式上传了自定义截图：使用 store-assets 验证并以 multipart/form-data POST 上传
            if (!window.ToolsStoreAssets) await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/js/shared/store-assets.js';
                script.onload = resolve;
                script.onerror = () => reject(new Error(navLocaleText('无法加载商店物料组件', 'Store assets component could not load')));
                document.head.appendChild(script);
            });
            const body = await window.ToolsStoreAssets.form(customFiles);
            response = await fetch('/api/platform-logo/download-bundle', {
                method: 'POST',
                body,
                headers: getAuthHeaderForNav()
            });
        } else {
            // 默认情况：前端单纯发起 GET 下载请求，全套物料与标准宣传截图由服务端纯后台生成，无需前端截屏与大文件 POST
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token') || '';
            const downloadUrl = token ? `/api/platform-logo/download-bundle?token=${encodeURIComponent(token)}` : '/api/platform-logo/download-bundle';
            response = await fetch(downloadUrl, {
                method: 'GET',
                headers: getAuthHeaderForNav()
            });
        }

        if (!response.ok) throw new Error(await describeLogoBundleFailure(response));
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match ? match[1] : `brand-assets-${new Date().toISOString().slice(0, 10)}.zip`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (status) status.textContent = `${navLocaleText('下载完成：', 'Downloaded: ')}${filename} (${(blob.size / 1024).toFixed(1)} KB)`;
    } catch (error) {
        await showNavbarNotice({
            title: navLocaleText('物料包下载失败', 'Download failed'),
            message: error.message || navLocaleText('无法下载运营物料资产包', 'Could not download brand assets bundle'),
            tone: 'error'
        });
        if (status) status.textContent = navLocaleText('下载失败：', 'Download failed: ') + error.message;
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
};

function buildAiUsageChart(series) {
    const rows = Array.isArray(series) ? series : [];
    const width = 720, height = 260, left = 62, right = 24;
    const plotWidth = width - left - right;
    const tokenBand = { top: 24, height: 78 };
    const costBand = { top: 132, height: 78 };
    const maxTokens = Math.max(1, ...rows.map(item => Number(item.tokens || 0)));
    const maxCost = Math.max(0.000001, ...rows.map(item => Number(item.costCny || 0)));
    const x = index => rows.length <= 1 ? left + plotWidth / 2 : left + index * plotWidth / (rows.length - 1);
    const bandY = (value, max, band) => band.top + band.height - Number(value || 0) / max * band.height;
    const tokenY = value => bandY(value, maxTokens, tokenBand);
    const costY = value => bandY(value, maxCost, costBand);
    const tokenPoints = rows.map((item, index) => `${x(index).toFixed(1)},${tokenY(item.tokens).toFixed(1)}`).join(' ');
    const costPoints = rows.map((item, index) => `${x(index).toFixed(1)},${costY(item.costCny).toFixed(1)}`).join(' ');
    const labelStep = Math.max(1, Math.ceil(rows.length / 7));
    const grid = [tokenBand, costBand].map(band => [0, .5, 1].map(rate => {
        const y = band.top + band.height * rate;
        return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="nav-ai-chart-grid"/>`;
    }).join('')).join('');
    const labels = rows.map((item, index) => (index % labelStep === 0 || index === rows.length - 1)
        ? `<text x="${x(index)}" y="${height - 9}" text-anchor="middle" class="nav-ai-chart-label">${navEscape(item.label)}</text>`
        : '').join('');
    const tokenDots = rows.map((item, index) => `<circle cx="${x(index)}" cy="${tokenY(item.tokens)}" r="3" class="nav-ai-chart-token-dot"><title>${navEscape(item.label)} · ${Number(item.tokens || 0).toLocaleString()} Tokens</title></circle>`).join('');
    const costDots = rows.map((item, index) => `<circle cx="${x(index)}" cy="${costY(item.costCny)}" r="3" class="nav-ai-chart-cost-dot"><title>${navEscape(item.label)} · ¥${Number(item.costCny || 0).toFixed(4)}</title></circle>`).join('');
    return `<svg class="nav-ai-usage-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Token and cost trend">
        ${grid}
        <text x="8" y="${tokenBand.top + 10}" class="nav-ai-chart-band-title token">Token</text>
        <text x="8" y="${tokenBand.top + 24}" class="nav-ai-chart-band-max">${navEscape(formatAiUsageNumber(maxTokens))}</text>
        <polyline points="${tokenPoints}" class="nav-ai-chart-token-line"/>${tokenDots}
        <text x="8" y="${costBand.top + 10}" class="nav-ai-chart-band-title cost">费用</text>
        <text x="8" y="${costBand.top + 24}" class="nav-ai-chart-band-max">¥${Number(maxCost).toFixed(4)}</text>
        <polyline points="${costPoints}" class="nav-ai-chart-cost-line"/>${costDots}${labels}
    </svg>`;
}

function renderAiUsageDashboard(data) {
    const host = document.getElementById('navAiUsageBody');
    if (!host) return;
    const models = Array.isArray(data?.models) ? data.models : [];
    // Model buttons only for models configured in a profile now; older ones stay in the detail list below for clearing.
    // Usage is grouped per profile and model: a group counts when that profile still exists and still uses that model.
    const profiles = navState.aiSettings?.profiles || [];
    const configured = new Set(profiles.map(profile => `${profile.id}|${profile.provider}|${profile.model}`));
    const isConfigured = item => configured.has(`${item.profileId}|${item.provider}|${item.model}`);
    const shownModels = configured.size ? models.filter(isConfigured) : models;
    const selectedKey = navState.aiUsageModelKey || 'all';
    const selectedModel = shownModels.find(item => item.key === selectedKey) || null;
    if (selectedKey !== 'all' && !selectedModel) navState.aiUsageModelKey = 'all';
    const totals = selectedModel?.totals || data?.totals || {};
    const series = Array.isArray(selectedModel?.series) ? selectedModel.series : (Array.isArray(data?.series) ? data.series : []);
    const period = series.reduce((sum, item) => ({ tokens: sum.tokens + Number(item.tokens || 0), costCny: sum.costCny + Number(item.costCny || 0) }), { tokens: 0, costCny: 0 });
    const unclassified = data?.unclassified || {};
    host.innerHTML = `
        <div style="margin:12px 0 10px;display:flex;align-items:center;flex-wrap:wrap;gap:7px;padding-bottom:3px;">
            <button type="button" class="nav-settings-add ${selectedModel ? 'secondary' : ''}" onclick="setAiUsageModel('all')" style="margin:0;white-space:nowrap;">${navEscape(navT('nav.ai.usageAllModels'))}</button>
            ${shownModels.map(item => `<button type="button" class="nav-settings-add ${selectedModel?.key === item.key ? '' : 'secondary'}" onclick="setAiUsageModel('${navEscape(item.key)}')" style="margin:0;white-space:nowrap;">${navEscape(item.profileName || item.provider)} · ${navEscape(item.model)} · ${formatAiUsageNumber(item.totals?.tokens)}</button>`).join('')}
            ${selectedModel ? `
                <button type="button" class="nav-settings-add danger" onclick="clearSelectedModelAiUsage()" style="margin:0 0 0 auto;white-space:nowrap;font-size:12px;padding:3px 10px;height:28px;" title="清空当前选中模型的用量与计费统计">🗑 ${navEscape(navT('nav.ai.clearModelUsage'))}</button>
            ` : (models.length > 0 ? `
                <button type="button" class="nav-settings-add secondary" onclick="promptClearAllAiUsage()" style="margin:0 0 0 auto;white-space:nowrap;font-size:12px;padding:3px 10px;height:28px;" title="清空全部历史用量与计费统计">🗑 ${navEscape(navT('nav.ai.clearAllModelUsage'))}…</button>
            ` : '')}
        </div>
        <div style="font-size:11px;color:#64748b;margin-bottom:8px;">${navEscape(navT('nav.ai.usageByModel'))}${Number(unclassified.tokens || 0) > 0 ? ` · ${navEscape(navT('nav.ai.usageLegacy'))} ${formatAiUsageNumber(unclassified.tokens)} Tokens` : ''}</div>
        <div class="nav-ai-usage-kpis">
            <div><span>${navEscape(navT('nav.ai.usageTokens'))}</span><strong>${formatAiUsageNumber(totals.tokens)}</strong><small>${Number(totals.tokens || 0).toLocaleString()} tokens</small></div>
            <div><span>${navEscape(navT('nav.ai.usageCostCny'))}</span><strong>¥${Number(totals.costCny || 0).toFixed(4)}</strong><small>${navEscape(navT('nav.ai.usageCostUsd'))} $${Number(totals.costUsd || 0).toFixed(4)}</small></div>
            <div><span>${navEscape(navT('nav.ai.usageRequests'))}</span><strong>${Number(totals.requests || 0).toLocaleString()}</strong><small>${navEscape(navT('nav.ai.usagePeriod'))} ${formatAiUsageNumber(period.tokens)} tokens</small></div>
        </div>
        <div class="nav-ai-usage-legend"><span class="tokens">Token</span><span class="cost">费用 CNY</span><b>${navEscape(navT('nav.ai.usagePeriod'))}：${formatAiUsageNumber(period.tokens)} Tokens · ¥${period.costCny.toFixed(4)}</b></div>
        <div class="nav-ai-chart-wrap">${buildAiUsageChart(series)}</div>
        ${models.length > 0 ? `
        <div style="margin-top:12px;background:rgba(248,250,252,0.78);border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;">
                <span style="font-size:12px;font-weight:600;color:#334155;">历史模型用量明细 (${models.length})</span>
                <span style="font-size:11px;color:#64748b;">支持独立清空指定模型历史记录</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;max-height:150px;overflow-y:auto;padding-right:2px;">
                ${models.map(item => {
                    const displayName = `${item.profileName || item.provider} · ${item.model}`;
                    return `
                    <div style="display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid #edf2f7;border-radius:8px;padding:5px 9px;font-size:12px;">
                        <div style="display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                            <strong style="color:#1e293b;">${navEscape(displayName)}</strong>${configured.size && !isConfigured(item) ? '<em style="font-style:normal;font-size:10.5px;color:#94a3b8;border:1px solid #e2e8f0;border-radius:8px;padding:0 6px;">已不在配置中</em>' : ''}
                            <span style="color:#64748b;font-size:11px;">(${formatAiUsageNumber(item.totals?.tokens)} Tokens · ¥${Number(item.totals?.costCny || 0).toFixed(4)})</span>
                        </div>
                        <button type="button" class="nav-settings-add danger" onclick="clearSpecificModelUsage('${navEscape(item.key)}', '${navEscape(displayName)}', ${item.totals?.tokens || 0}, ${Number(item.totals?.costCny || 0).toFixed(4)})" style="margin:0;font-size:11px;padding:2px 8px;height:24px;line-height:20px;" title="清空该模型的历史 Token 与计费统计">🗑 清空统计</button>
                    </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}
    `;
}

window.setAiUsageModel = function (key) {
    navState.aiUsageModelKey = key || 'all';
    if (navState.aiUsageData) renderAiUsageDashboard(navState.aiUsageData);
};

window.clearSpecificModelUsage = async function (key, displayName, tokens, costCny) {
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('清空模型统计信息', 'Clear Model Statistics'),
        message: navLocaleText(
            `确定清空模型 “${displayName}” 的全部历史 Token 用量与计费统计吗？`,
            `Clear all historical token usage and cost statistics for “${displayName}”?`
        ),
        hint: navLocaleText(
            `当前累计：${formatAiUsageNumber(tokens)} Tokens，¥${costCny} 元。清空后不可恢复。`,
            `Current totals: ${formatAiUsageNumber(tokens)} Tokens, ¥${costCny}. This cannot be undone.`
        ),
        tone: 'danger',
        confirmText: navLocaleText('确认清空', 'Clear Statistics')
    });
    if (!confirmed) return;

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '正在清空模型用量统计…';
    try {
        const res = await fetch(`/api/ai-settings/usage?key=${encodeURIComponent(key)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (navState.aiUsageModelKey === key) navState.aiUsageModelKey = 'all';
        if (indicator) indicator.textContent = `已成功清空模型 “${displayName}” 统计信息`;
        await loadAiUsageDashboard(navState.aiUsageDimension);
    } catch (err) {
        if (indicator) indicator.textContent = `清空失败：${err.message}`;
        showNavbarNotice({ title: navT('nav.dialog.error'), message: `清空统计失败：${err.message}`, tone: 'error' });
    }
};

window.clearSelectedModelAiUsage = async function () {
    const models = Array.isArray(navState.aiUsageData?.models) ? navState.aiUsageData.models : [];
    const selected = models.find(item => item.key === navState.aiUsageModelKey);
    if (!selected) return;
    const displayName = `${selected.profileName || selected.provider} · ${selected.model}`;
    await clearSpecificModelUsage(selected.key, displayName, selected.totals?.tokens || 0, Number(selected.totals?.costCny || 0).toFixed(4));
};

window.promptClearAllAiUsage = async function () {
    const totals = navState.aiUsageData?.totals || {};
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('清空全部模型统计信息', 'Clear All Models Statistics'),
        message: navLocaleText(
            '确定清空全部模型的历史 Token 用量与计费统计吗？',
            'Are you sure you want to clear historical token usage and cost statistics for ALL models?'
        ),
        hint: navLocaleText(
            `当前全部累计：${formatAiUsageNumber(totals.tokens)} Tokens，¥${Number(totals.costCny || 0).toFixed(4)} 元。清空后全部模型与每日图表都将归零，不可恢复。`,
            `Current all totals: ${formatAiUsageNumber(totals.tokens)} Tokens, ¥${Number(totals.costCny || 0).toFixed(4)}. Cannot be undone.`
        ),
        tone: 'danger',
        confirmText: navLocaleText('全部清空', 'Clear All')
    });
    if (!confirmed) return;

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '正在清空全部模型统计…';
    try {
        const res = await fetch('/api/ai-settings/usage?clearAll=true', {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        navState.aiUsageModelKey = 'all';
        if (indicator) indicator.textContent = '全部模型统计信息已清空';
        await loadAiUsageDashboard(navState.aiUsageDimension);
    } catch (err) {
        if (indicator) indicator.textContent = `清空失败：${err.message}`;
        showNavbarNotice({ title: navT('nav.dialog.error'), message: `清空失败：${err.message}`, tone: 'error' });
    }
};

async function loadAiUsageDashboard(dimension = navState.aiUsageDimension || 'day') {
    navState.aiUsageDimension = ['day', 'week', 'month', 'year'].includes(dimension) ? dimension : 'day';
    document.querySelectorAll('[data-ai-usage-dimension]').forEach(button => button.classList.toggle('active', button.dataset.aiUsageDimension === navState.aiUsageDimension));
    const host = document.getElementById('navAiUsageBody');
    if (host) host.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.usageLoading'))}</div>`;
    try {
        const expectedDimension = navState.aiUsageDimension;
        const res = await fetch(`/api/ai-settings/usage?dimension=${encodeURIComponent(expectedDimension)}`, { headers: getAuthHeaderForNav() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (expectedDimension !== navState.aiUsageDimension) return;
        navState.aiUsageData = data;
        renderAiUsageDashboard(data);
    } catch (err) {
        if (host) host.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.usageFail'))}${navEscape(err.message)}</div>`;
    }
}

window.setAiUsageDimension = function (dimension) {
    loadAiUsageDashboard(dimension);
};

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

// 频道对接（WeLink 助理）设置页按需加载，逻辑在 shared/channel-settings.js
async function renderChannelSettings(content) {
    try {
        if (!window.ToolsChannelSettings) await loadNavLazyScript('/js/shared/channel-settings.js', navLocaleText('无法加载频道对接组件', 'Channel settings component could not load'));
        await window.ToolsChannelSettings.render(content);
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(error.message)}</div>`;
    }
}

// 平台推广设置页按需加载，逻辑在 shared/promotion-settings.js
async function renderPromotionSettings(content) {
    try {
        if (!window.ToolsPromotionSettings) await loadNavLazyScript('/js/shared/promotion-settings.js', navLocaleText('无法加载平台推广组件', 'Promotion settings component could not load'));
        await window.ToolsPromotionSettings.render(content);
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(error.message)}</div>`;
    }
}

async function renderAiSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.empty'))}</div>`;
    try {
        const settingsStore = await fetchAiSettingsForNav();
        if (!aiModelAliasSaveTimer) navState.aiModelAliasDraft = null;
        const allProfiles = Array.isArray(settingsStore.profiles) ? settingsStore.profiles : [];
        // Two categories as tabs: 文心 (chat models) and 丹青 (image models); each lists, creates and activates its own.
        const picked = allProfiles.find(item => item.id === navState.aiSelectedProfileId);
        const category = navState.aiCategory || picked?.category || 'chat';
        navState.aiCategory = category;
        const profiles = allProfiles.filter(item => (item.category || 'chat') === category);
        const settings = profiles.find(item => item.id === navState.aiSelectedProfileId) || profiles.find(item => item.isActive) || profiles[0] || null;
        if (settings) navState.aiSelectedProfileId = settings.id;
        const isImage = category === 'image';
        const isActiveProfile = !!settings?.isActive;
        const chatCount = allProfiles.filter(item => (item.category || 'chat') === 'chat').length, imageCount = allProfiles.length - chatCount;
        const tabs = `<div class="nav-ai-tabs" role="tablist" aria-label="AI 模型分类">
            <button type="button" role="tab" class="nav-ai-tab ${isImage ? '' : 'is-active'}" aria-selected="${!isImage}" onclick="switchAiCategory('chat')"><span class="nav-ai-tab-icon">文</span><span><b>文心 · 对话模型</b><small>对话、分析、写作与月报生成 · ${chatCount} 套</small></span></button>
            <button type="button" role="tab" class="nav-ai-tab ${isImage ? 'is-active' : ''}" aria-selected="${isImage}" onclick="switchAiCategory('image')"><span class="nav-ai-tab-icon">丹</span><span><b>丹青 · 绘图模型</b><small>生成与修改图片 · ${imageCount} 套</small></span></button>
        </div>`;
        if (!settings) {
            content.innerHTML = `${tabs}<div class="nav-ai-tab-empty"><strong>还没有绘图模型</strong><span>添加一个能输出图片的模型（如 Gemini 的图片模型），AI 月报的图片对话就能生成真正的图片；没有时会用对话模型画 SVG 矢量图。</span><button type="button" class="nav-settings-add" onclick="createAiProfile()">＋ 新建绘图模型</button></div>`;
            return;
        }
        content.innerHTML = `
            ${tabs}
            <div class="nav-settings-help">${isImage ? 'AI 月报的图片对话（LOGO 和以后格子里的图片）用这里“使用中”的绘图模型生成图片；它不会参与对话，也不会被自动切换。' : navEscape(navT('nav.ai.help'))}</div>
            <section class="nav-ai-profile-panel">
                <div class="nav-ai-profile-head">
                    <div>
                        <strong>${isImage ? '绘图模型方案' : 'AI 配置方案'}</strong>
                        <span>${isImage ? '可保存多套绘图模型；只有“使用中”的一套会用于生成图片。' : '可保存多套供应商与模型参数；只有已激活方案会用于实际业务。'}</span>
                    </div>
                    <div class="nav-ai-profile-head-actions">
                        <button type="button" class="nav-settings-add" onclick="createAiProfile()">＋ 新建</button>
                        <button type="button" class="nav-settings-add secondary" onclick="cloneAiProfile()">⧉ 复制当前</button>
                    </div>
                </div>
                <div class="nav-ai-profile-list">
                    ${profiles.map(profile => `
                        <button type="button" class="nav-ai-profile-card ${profile.id === settings.id ? 'selected' : ''} ${profile.isActive ? 'active' : ''}" onclick="selectAiProfile('${navEscape(profile.id)}')">
                            <span class="nav-ai-profile-card-top"><b>${navEscape(profile.name)}</b>${profile.isActive ? '<em>使用中</em>' : ''}</span>
                            <span>${navEscape(profile.provider)} · ${navEscape(profile.model)}${profile.provider === 'anthropic' || /claude/i.test(profile.model) ? ` · ${profile.anthropicAuthType === 'ANTHROPIC_API_KEY' ? 'API_KEY' : 'AUTH_TOKEN'}` : ''}</span>
                            <small class="${profile.keyLooksValid ? 'ready' : ''}">${profile.keyLooksValid ? '● Token 可用' : '○ Token 未就绪'}</small>
                        </button>
                    `).join('')}
                </div>
                ${isImage ? '' : `<label class="nav-settings-check" style="margin-top:8px;padding:9px 10px;border:1px solid rgba(129,140,248,.24);border-radius:10px;background:rgba(255,255,255,.68);display:flex;align-items:center;gap:8px;">
                    <input id="navAiAutoSwitch" type="checkbox" ${settingsStore.autoSwitchEnabled ? 'checked' : ''} onchange="scheduleAiSettingsSave()">
                    <span><b>${navEscape(navT('nav.ai.autoSwitch'))}</b><small style="display:block;margin-top:2px;color:#64748b;font-weight:500;">${navEscape(navT('nav.ai.autoSwitchHelp'))}</small></span>
                </label>`}
                <div class="nav-ai-profile-toolbar">
                    <label>
                        <span>方案名称</span>
                        <input id="navAiProfileName" class="nav-settings-input" maxlength="60" value="${navEscape(settings.name || 'AI 配置')}" oninput="scheduleAiSettingsSave()">
                    </label>
                    <div>
                        <button type="button" class="nav-settings-add" onclick="testAiSettingsNow()">⌁ 测试连接</button>
                        <button type="button" class="nav-settings-add activate" onclick="activateAiProfile()" ${isActiveProfile ? 'disabled' : ''}>${isActiveProfile ? (isImage ? '✓ 正在用于绘图' : '✓ 当前已激活') : (isImage ? '⚡ 用于绘图' : '⚡ 激活此方案')}</button>
                        <button type="button" class="nav-settings-add danger" onclick="deleteAiProfile()" ${!isImage && profiles.length <= 1 ? 'disabled' : ''}>删除</button>
                    </div>
                </div>
            </section>
            ${isImage ? '' : `<section class="nav-ai-profile-panel nav-ai-alias-panel" id="navAiAliasPanel">${renderAiModelAliasPanel()}</section>`}
            <div class="nav-ai-status">
                <span>${isActiveProfile ? (isImage ? '图片生成正在使用此方案' : '当前业务正在使用此方案') : '正在编辑未激活方案'}</span>
                <span>${navEscape(navT('nav.ai.sourcePrefix'))}${navEscape(sourceLabelForAiSettings(settings.apiKeySource))}</span>
                <span class="${settings.hasApiKey && !settings.keyLooksValid ? 'warning' : ''}">${navEscape(keyHealthLabelForAiSettings(settings))}</span>
            </div>
            <section class="nav-ai-usage-panel">
                <div class="nav-ai-usage-head">
                    <div><strong>${navEscape(navT('nav.ai.usageTitle'))}</strong><span>${navEscape(navT('nav.ai.usageHelp'))}</span></div>
                    <div class="nav-ai-usage-dimensions">
                        <button type="button" data-ai-usage-dimension="day" onclick="setAiUsageDimension('day')">${navEscape(navT('nav.ai.usageDay'))}</button>
                        <button type="button" data-ai-usage-dimension="week" onclick="setAiUsageDimension('week')">${navEscape(navT('nav.ai.usageWeek'))}</button>
                        <button type="button" data-ai-usage-dimension="month" onclick="setAiUsageDimension('month')">${navEscape(navT('nav.ai.usageMonth'))}</button>
                        <button type="button" data-ai-usage-dimension="year" onclick="setAiUsageDimension('year')">${navEscape(navT('nav.ai.usageYear'))}</button>
                    </div>
                </div>
                <div id="navAiUsageBody"><div class="nav-settings-empty">${navEscape(navT('nav.ai.usageLoading'))}</div></div>
            </section>
            <div class="nav-ai-grid">
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblProvider'))}</span>
                    <select id="navAiProvider" class="nav-settings-input" onchange="handleAiProviderChange()">
                        <option value="gemini" ${settings.provider === 'gemini' ? 'selected' : ''}>Gemini</option>
                        <option value="openai" ${settings.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                        <option value="anthropic" ${settings.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
                        <option value="minimax" ${settings.provider === 'minimax' ? 'selected' : ''}>MiniMax</option>
                        <option value="openai-compatible" ${settings.provider === 'openai-compatible' ? 'selected' : ''}>OpenAI Compatible</option>
                    </select>
                </label>
                <label class="nav-ai-field nav-ai-field-wide" id="navAiAnthropicAuthWrap" style="${(settings.provider === 'anthropic' || /claude|anthropic/i.test(settings.model)) ? '' : 'display:none;'}">
                    <span>${navEscape(navT('nav.ai.anthropicAuthField'))}</span>
                    <select id="navAiAnthropicAuthType" class="nav-settings-input" onchange="scheduleAiSettingsSave()">
                        <option value="ANTHROPIC_AUTH_TOKEN" ${settings.anthropicAuthType !== 'ANTHROPIC_API_KEY' ? 'selected' : ''}>${navEscape(navT('nav.ai.anthropicAuthToken'))}</option>
                        <option value="ANTHROPIC_API_KEY" ${settings.anthropicAuthType === 'ANTHROPIC_API_KEY' ? 'selected' : ''}>${navEscape(navT('nav.ai.anthropicApiKey'))}</option>
                    </select>
                </label>
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblApiUrl'))}</span>
                    <input id="navAiApiBaseUrl" class="nav-settings-input" value="${navEscape(settings.apiBaseUrl || '')}" placeholder="${navEscape(navT('nav.ai.plhApiUrl'))}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblToken'))}</span>
                    <div class="nav-ai-token-row">
                        <input id="navAiApiKey" type="text" inputmode="text" class="nav-settings-input nav-ai-token-input" autocomplete="new-password" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="${settings.hasApiKey ? `${navEscape(navT('nav.ai.plhKeep'))}${navEscape(settings.maskedApiKey)}` : navEscape(navT('nav.ai.plhToken'))}" onfocus="this.dataset.userTouched='1'" oninput="scheduleAiSettingsSave({ tokenTouched: this.dataset.userTouched === '1' })">
                        <button type="button" class="nav-settings-add" onclick="clearAiApiKey()">${navEscape(navT('nav.ai.btnClear'))}</button>
                    </div>
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblModel'))}</span>
                    <input id="navAiModel" class="nav-settings-input" list="navAiModelOptions" value="${navEscape(settings.model)}" oninput="updateAiModelAuthVisibility(); scheduleAiSettingsSave()">
                    <datalist id="navAiModelOptions">
                        <option value="gemini-2.5-flash"></option>
                        <option value="gemini-2.5-pro"></option>
                        <option value="gemini-1.5-flash"></option>
                        <option value="gpt-4o-mini"></option>
                        <option value="gpt-4o"></option>
                        <option value="gpt-4.1-mini"></option>
                        <option value="claude-3-5-sonnet-latest"></option>
                        <option value="claude-3-5-haiku-latest"></option>
                        <option value="MiniMax-M2.7-highspeed"></option>
                        <option value="MiniMax-M2.7"></option>
                        <option value="MiniMax-M3"></option>
                    </datalist>
                </label>
                <label class="nav-ai-field">
                    <span>Temperature</span>
                    <input id="navAiTemperature" type="number" min="0" max="2" step="0.1" class="nav-settings-input" value="${navEscape(settings.temperature)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblMax'))}</span>
                    <input id="navAiMaxTokens" type="number" min="128" max="8192" step="128" class="nav-settings-input" value="${navEscape(settings.maxOutputTokens)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblInputCost'))}</span>
                    <input id="navAiInputCost" type="number" min="0" step="0.001" class="nav-settings-input" value="${navEscape(settings.inputCostPerMillionUsd)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblOutputCost'))}</span>
                    <input id="navAiOutputCost" type="number" min="0" step="0.001" class="nav-settings-input" value="${navEscape(settings.outputCostPerMillionUsd)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.ai.lblUsdCny'))}</span>
                    <input id="navAiUsdToCny" type="number" min="0" step="0.01" class="nav-settings-input" value="${navEscape(settings.usdToCny)}" oninput="scheduleAiSettingsSave()">
                </label>
                <label class="nav-ai-field nav-ai-field-wide">
                    <span>${navEscape(navT('nav.ai.lblPrompt'))}</span>
                    <textarea id="navAiSystemPrompt" class="nav-ai-textarea" maxlength="5000" placeholder="${navEscape(navT('nav.ai.plhPrompt'))}" oninput="scheduleAiSettingsSave()">${navEscape(settings.systemPrompt || '')}</textarea>
                </label>
                <div class="nav-ai-field nav-ai-field-wide">
                    <span>连接测试结果</span>
                    <div id="navAiTestResult" class="nav-ai-test-result"></div>
                </div>
            </div>
        `;
        loadAiUsageDashboard(navState.aiUsageDimension);
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ai.failLoad'))}${navEscape(e.message)}</div>`;
    }
}

// ── 对话模型名称映射（Aragon 等自定义名称 → 实际配置方案）──────────
function renderAiModelAliasPanel() {
    const profiles = (Array.isArray(navState.aiSettings?.profiles) ? navState.aiSettings.profiles : []).filter(item => (item.category || 'chat') === 'chat');
    if (!Array.isArray(navState.aiModelAliasDraft)) {
        navState.aiModelAliasDraft = (navState.aiSettings?.modelAliases || []).map(item => ({ ...item }));
    }
    const aliases = navState.aiModelAliasDraft;
    const profileOptions = selected => [
        `<option value="" ${selected ? '' : 'selected'}>${navEscape(navT('nav.ai.aliasFollowActive'))}</option>`,
        ...profiles.map(profile => `<option value="${navEscape(profile.id)}" ${profile.id === selected ? 'selected' : ''}>${navEscape(profile.name)} · ${navEscape(profile.model)}</option>`)
    ].join('');
    const rows = aliases.map((alias, index) => `
        <div class="nav-ai-alias-row">
            <label><span>${navEscape(navT('nav.ai.aliasName'))}${index === 0 ? ` <em>${navEscape(navT('nav.ai.aliasDefault'))}</em>` : ''}</span>
                <input class="nav-settings-input" maxlength="40" value="${navEscape(alias.name)}" placeholder="${navEscape(navT('nav.ai.aliasNamePlh'))}" oninput="updateAiModelAlias(${index}, 'name', this.value)"></label>
            <label><span>${navEscape(navT('nav.ai.aliasDesc'))}</span>
                <input class="nav-settings-input" maxlength="120" value="${navEscape(alias.description || '')}" placeholder="${navEscape(navT('nav.ai.aliasDescPlh'))}" oninput="updateAiModelAlias(${index}, 'description', this.value)"></label>
            <label><span>${navEscape(navT('nav.ai.aliasProfile'))}</span>
                <select class="nav-settings-input" onchange="updateAiModelAlias(${index}, 'profileId', this.value)">${profileOptions(profiles.some(item => item.id === alias.profileId) ? alias.profileId : '')}</select></label>
            <button type="button" class="nav-settings-add danger" onclick="removeAiModelAlias(${index})" aria-label="${navEscape(navT('nav.ai.aliasDelete'))} ${navEscape(alias.name)}">${navEscape(navT('nav.ai.aliasDelete'))}</button>
        </div>`).join('');
    const realModels = profiles.filter(item => item.keyLooksValid).map(item => item.model);
    const fallbackModels = realModels.length ? realModels : profiles.filter(item => item.isActive).map(item => item.model);
    return `
        <div class="nav-ai-profile-head">
            <div><strong>${navEscape(navT('nav.ai.aliasTitle'))}</strong><span>${navEscape(navT('nav.ai.aliasHelp'))}</span></div>
            <div class="nav-ai-profile-head-actions">
                <button type="button" class="nav-settings-add" onclick="addAiModelAlias()" ${aliases.length >= 20 ? 'disabled' : ''}>${navEscape(navT('nav.ai.aliasAdd'))}</button>
                ${aliases.length
                    ? `<button type="button" class="nav-settings-add secondary" onclick="clearAiModelAliases()">${navEscape(navT('nav.ai.aliasClear'))}</button>`
                    : `<button type="button" class="nav-settings-add secondary" onclick="resetAiModelAliases()">${navEscape(navT('nav.ai.aliasReset'))}</button>`}
            </div>
        </div>
        ${aliases.length
            ? `<div class="nav-ai-alias-list">${rows}</div>`
            : `<div class="nav-ai-alias-empty">${navEscape(navT('nav.ai.aliasEmpty'))}<b>${navEscape([...new Set(fallbackModels)].join(' · ') || '—')}</b></div>`}`;
}

function rerenderAiModelAliasPanel() {
    const panel = document.getElementById('navAiAliasPanel');
    if (panel) panel.innerHTML = renderAiModelAliasPanel();
}

let aiModelAliasSaveTimer = null;
function scheduleAiModelAliasSave(delay = 600) {
    clearTimeout(aiModelAliasSaveTimer);
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.aliasSaving');
    aiModelAliasSaveTimer = setTimeout(saveAiModelAliasesNow, delay);
}

async function saveAiModelAliasesNow() {
    const indicator = document.getElementById('navSettingsSaveState');
    aiModelAliasSaveTimer = null;
    const aliases = navState.aiModelAliasDraft;
    // 有名称为空的行时暂不提交，避免输入中途被服务端丢弃。
    if (!Array.isArray(aliases) || aliases.some(item => !String(item.name || '').trim())) return;
    try {
        const res = await fetch('/api/ai-settings/model-aliases', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ aliases })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        navState.aiSettings = data;
        // 回填服务端生成的 ID，后续保存保持稳定（用户已选的模型不会失效）。
        const saved = Array.isArray(data.modelAliases) ? data.modelAliases : [];
        aliases.forEach((item, index) => { if (saved[index] && saved[index].name === String(item.name).trim()) item.id = saved[index].id; });
        if (indicator) indicator.textContent = navT('nav.ai.aliasSaved');
    } catch (e) {
        if (indicator) indicator.textContent = `${navT('nav.ai.aliasFail')}${e.message}`;
    }
}

window.updateAiModelAlias = function (index, field, value) {
    const alias = navState.aiModelAliasDraft?.[index];
    if (!alias) return;
    alias[field] = value;
    scheduleAiModelAliasSave(field === 'profileId' ? 0 : 600);
};

window.addAiModelAlias = function () {
    const draft = navState.aiModelAliasDraft || (navState.aiModelAliasDraft = []);
    if (draft.length >= 20) return;
    const used = new Set(draft.map(item => String(item.name).toLowerCase()));
    let name = draft.length ? `Aragon ${draft.length + 1}` : 'Aragon';
    for (let n = draft.length + 1; used.has(name.toLowerCase()); n += 1) name = `Aragon ${n + 1}`;
    draft.push({ id: `m-${Date.now().toString(36)}`, name, description: '', profileId: '' });
    rerenderAiModelAliasPanel();
    scheduleAiModelAliasSave(0);
};

window.removeAiModelAlias = function (index) {
    navState.aiModelAliasDraft?.splice(index, 1);
    rerenderAiModelAliasPanel();
    scheduleAiModelAliasSave(0);
};

window.clearAiModelAliases = function () {
    return showNavbarConfirm({ title: navT('nav.dialog.warning'), message: navT('nav.ai.aliasClearConfirm'), tone: 'danger' }).then(confirmed => {
        if (!confirmed) return;
        navState.aiModelAliasDraft = [];
        rerenderAiModelAliasPanel();
        scheduleAiModelAliasSave(0);
    });
};

window.resetAiModelAliases = function () {
    navState.aiModelAliasDraft = [{ id: 'aragon', name: 'Aragon', description: '', profileId: '' }];
    rerenderAiModelAliasPanel();
    scheduleAiModelAliasSave(0);
};

function collectAiSettingsPayload(options = {}) {
    const tokenInput = document.getElementById('navAiApiKey');
    const authTypeSelect = document.getElementById('navAiAnthropicAuthType');
    const payload = {
        profileId: navState.aiSelectedProfileId,
        name: document.getElementById('navAiProfileName')?.value || 'AI 配置',
        provider: document.getElementById('navAiProvider')?.value || 'gemini',
        anthropicAuthType: authTypeSelect?.value || 'ANTHROPIC_AUTH_TOKEN',
        apiBaseUrl: document.getElementById('navAiApiBaseUrl')?.value || '',
        model: document.getElementById('navAiModel')?.value || 'gemini-2.5-flash',
        temperature: document.getElementById('navAiTemperature')?.value || 0.7,
        maxOutputTokens: document.getElementById('navAiMaxTokens')?.value || 2048,
        inputCostPerMillionUsd: document.getElementById('navAiInputCost')?.value || 0.075,
        outputCostPerMillionUsd: document.getElementById('navAiOutputCost')?.value || 0.3,
        usdToCny: document.getElementById('navAiUsdToCny')?.value || 7.2,
        systemPrompt: document.getElementById('navAiSystemPrompt')?.value || ''
    };
    // Only the chat tab shows the failover switch; saving a drawing profile leaves the setting as it is.
    const autoSwitch = document.getElementById('navAiAutoSwitch');
    if (autoSwitch) payload.autoSwitchEnabled = autoSwitch.checked === true;
    const token = tokenInput ? tokenInput.value.trim() : '';
    if (token) payload.apiKey = token;
    if (options.clearApiKey) payload.clearApiKey = true;
    return payload;
}

function currentAiProfile() {
    const profiles = Array.isArray(navState.aiSettings?.profiles) ? navState.aiSettings.profiles : [];
    return profiles.find(item => item.id === navState.aiSelectedProfileId) || profiles[0] || null;
}

async function requestAiProfile(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...getAuthHeaderForNav(),
            ...(options.headers || {})
        }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

window.switchAiCategory = async function (category) {
    if (navState.aiCategory === category) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        if (document.getElementById('navAiProvider')) await saveAiSettingsNow();
        navState.aiCategory = category;
        const profiles = (navState.aiSettings?.profiles || []).filter(item => (item.category || 'chat') === category);
        navState.aiSelectedProfileId = (profiles.find(item => item.isActive) || profiles[0])?.id || null;
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = `切换前保存失败：${error.message}`;
    }
};

window.selectAiProfile = async function (profileId) {
    if (profileId === navState.aiSelectedProfileId) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        navState.aiSelectedProfileId = profileId;
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = `切换前保存失败：${error.message}`;
    }
};

window.createAiProfile = async function () {
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        if (indicator) indicator.textContent = '正在创建…';
        const data = await requestAiProfile('/api/ai-settings/profiles', {
            method: 'POST',
            body: JSON.stringify(navState.aiCategory === 'image' ? { name: '新绘图模型', category: 'image', provider: 'gemini' } : { name: '新 AI 配置', category: 'chat' })
        });
        navState.aiSettings = data;
        navState.aiSelectedProfileId = data.createdProfileId;
        if (indicator) indicator.textContent = '已创建，尚未激活';
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = `创建失败：${error.message}`;
    }
};

window.cloneAiProfile = async function () {
    const profile = currentAiProfile();
    if (!profile) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        const sourceName = document.getElementById('navAiProfileName')?.value.trim() || profile.name;
        const data = await requestAiProfile('/api/ai-settings/profiles', {
            method: 'POST',
            body: JSON.stringify({ sourceProfileId: profile.id, name: `${sourceName} 副本` })
        });
        navState.aiSettings = data;
        navState.aiSelectedProfileId = data.createdProfileId;
        if (indicator) indicator.textContent = '副本已创建，尚未激活';
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = `复制失败：${error.message}`;
    }
};

window.activateAiProfile = async function () {
    const profileId = navState.aiSelectedProfileId;
    if (!profileId) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow();
        if (indicator) indicator.textContent = '正在切换模型…';
        navState.aiSettings = await requestAiProfile(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}/activate`, { method: 'POST' });
        if (indicator) indicator.textContent = '已激活，业务调用已切换';
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = `激活失败：${error.message}`;
    }
};

window.deleteAiProfile = async function () {
    const profile = currentAiProfile();
    if (!profile) return;
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('删除 AI 配置', 'Delete AI profile'),
        message: navLocaleText(`确定删除 AI 配置“${profile.name}”吗？`, `Delete the AI profile “${profile.name}”?`),
        hint: navLocaleText('删除后无法恢复，当前业务调用不会自动切换到该配置。', 'This cannot be undone. Active requests will no longer use this profile.'),
        tone: 'danger',
        confirmText: navLocaleText('删除配置', 'Delete profile')
    });
    if (!confirmed) return;
    const indicator = document.getElementById('navSettingsSaveState');
    try {
        clearTimeout(navState.aiSaveTimer);
        const data = await requestAiProfile(`/api/ai-settings/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
        navState.aiSettings = data;
        navState.aiSelectedProfileId = data.activeProfileId;
        if (indicator) indicator.textContent = '配置已删除';
        renderAiSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (indicator) indicator.textContent = `删除失败：${error.message}`;
    }
};

window.handleAiProviderChange = function () {
    const provider = document.getElementById('navAiProvider')?.value || 'gemini';
    const modelInput = document.getElementById('navAiModel');
    const authWrap = document.getElementById('navAiAnthropicAuthWrap');
    if (authWrap) {
        authWrap.style.display = (provider === 'anthropic' || /claude|anthropic/i.test(modelInput?.value || '')) ? '' : 'none';
    }
    const defaults = {
        gemini: 'gemini-2.5-flash',
        openai: 'gpt-4o-mini',
        anthropic: 'claude-3-5-sonnet-latest',
        minimax: 'MiniMax-M2.7-highspeed',
        'openai-compatible': 'gpt-4o-mini'
    };
    if (modelInput && defaults[provider]) {
        modelInput.value = defaults[provider];
        if (authWrap) {
            authWrap.style.display = (provider === 'anthropic' || /claude|anthropic/i.test(modelInput.value)) ? '' : 'none';
        }
    }
    const apiBaseUrlInput = document.getElementById('navAiApiBaseUrl');
    if (apiBaseUrlInput) {
        if (provider === 'minimax') apiBaseUrlInput.value = 'https://api.minimax.io/v1';
        if (['gemini', 'openai', 'anthropic'].includes(provider)) apiBaseUrlInput.value = '';
    }
    scheduleAiSettingsSave();
};

window.updateAiModelAuthVisibility = function () {
    const provider = document.getElementById('navAiProvider')?.value || 'gemini';
    const model = document.getElementById('navAiModel')?.value || '';
    const authWrap = document.getElementById('navAiAnthropicAuthWrap');
    if (authWrap) {
        authWrap.style.display = (provider === 'anthropic' || /claude|anthropic/i.test(model)) ? '' : 'none';
    }
};

window.testAiSettingsNow = async function () {
    const resultEl = document.getElementById('navAiTestResult');
    const indicator = document.getElementById('navSettingsSaveState');
    clearTimeout(navState.aiSaveTimer);
    if (resultEl) {
        resultEl.className = 'nav-ai-test-result testing';
        resultEl.textContent = navT('nav.ai.testing');
    }
    if (indicator) indicator.textContent = navT('nav.ai.testing');
    try {
        const profileId = navState.aiSelectedProfileId;
        const res = await fetch(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}/test`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify(collectAiSettingsPayload())
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        const reply = data.reply ? `：${data.reply}` : '';
        if (resultEl) {
            resultEl.className = 'nav-ai-test-result ok';
            resultEl.textContent = `${navT('nav.ai.testOk')}${reply}`;
        }
        if (indicator) indicator.textContent = navT('nav.ai.testOk');
    } catch (e) {
        if (resultEl) {
            resultEl.className = 'nav-ai-test-result fail';
            resultEl.textContent = `${navT('nav.ai.testFail')}${e.message}`;
        }
        if (indicator) indicator.textContent = `${navT('nav.ai.testFail')}${e.message}`;
    }
};

async function saveAiSettingsNow(options = {}) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.saving');
    const profileId = navState.aiSelectedProfileId;
    if (!profileId) throw new Error('未选择 AI 配置');
    const res = await fetch(`/api/ai-settings/profiles/${encodeURIComponent(profileId)}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify(collectAiSettingsPayload(options))
    });
    if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch (e) { }
        throw new Error(message);
    }
    navState.aiSettings = await res.json();
    const savedProfile = currentAiProfile();
    const tokenInput = document.getElementById('navAiApiKey');
    if (tokenInput) {
        tokenInput.value = '';
        tokenInput.placeholder = savedProfile?.hasApiKey
            ? `${navT('nav.ai.plhKeep')}${savedProfile.maskedApiKey}`
            : navT('nav.ai.plhToken');
    }
    const status = document.querySelector('.nav-ai-status');
    if (status) {
        status.innerHTML = `
            <span>${savedProfile?.isActive ? '当前业务正在使用此方案' : '正在编辑未激活方案'}</span>
            <span>${navEscape(navT('nav.ai.sourcePrefix'))}${navEscape(sourceLabelForAiSettings(savedProfile?.apiKeySource))}</span>
            <span class="${savedProfile?.hasApiKey && !savedProfile?.keyLooksValid ? 'warning' : ''}">${navEscape(keyHealthLabelForAiSettings(savedProfile || {}))}</span>
        `;
    }
    if (indicator) indicator.textContent = navT('nav.ai.saved');
}

window.scheduleAiSettingsSave = function (options = {}) {
    const tokenInput = document.getElementById('navAiApiKey');
    if (tokenInput && tokenInput.value.trim() && !options.tokenTouched) {
        tokenInput.value = '';
        return;
    }
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.ai.waitSave');
    clearTimeout(navState.aiSaveTimer);
    navState.aiSaveTimer = setTimeout(async () => {
        try {
            await saveAiSettingsNow();
        } catch (e) {
            if (indicator) indicator.textContent = navT('nav.set.saveFail') + e.message;
        }
    }, 700);
};

window.clearAiApiKey = async function () {
    try {
        clearTimeout(navState.aiSaveTimer);
        await saveAiSettingsNow({ clearApiKey: true });
    } catch (e) {
        const indicator = document.getElementById('navSettingsSaveState');
        if (indicator) indicator.textContent = `清除失败: ${e.message}`;
    }
};

function updaterStateLabel(state) {
    const key = `nav.up.state.${state || 'idle'}`;
    const label = navT(key);
    return label === key ? (state || 'idle') : label;
}

function setUpdaterBusy(isBusy) {
    document.querySelectorAll('[data-updater-action]').forEach(btn => {
        btn.disabled = Boolean(isBusy);
    });
}

function updateUpdaterPanel(status = navState.updaterStatus || {}) {
    navState.updaterStatus = status || {};
    const state = navState.updaterStatus.state || 'idle';
    const progress = Math.max(0, Math.min(100, Number(navState.updaterStatus.progress) || 0));
    const latest = navState.updaterStatus.latestVersion || '-';
    const message = navState.updaterStatus.message || updaterStateLabel(state);

    const latestEl = document.getElementById('navUpdaterLatest');
    const statusEl = document.getElementById('navUpdaterStatus');
    const progressEl = document.getElementById('navUpdaterProgress');
    const progressTextEl = document.getElementById('navUpdaterProgressText');
    const checkBtn = document.getElementById('navUpdaterCheckBtn');
    const downloadBtn = document.getElementById('navUpdaterDownloadBtn');
    const installBtn = document.getElementById('navUpdaterInstallBtn');

    if (latestEl) latestEl.textContent = latest;
    if (statusEl) statusEl.textContent = `${updaterStateLabel(state)} · ${message}`;
    if (progressEl) progressEl.style.width = `${progress}%`;
    if (progressTextEl) progressTextEl.textContent = `${Math.round(progress)}%`;

    const checking = state === 'checking';
    const downloading = state === 'downloading';
    if (checkBtn) checkBtn.disabled = checking || downloading;
    if (downloadBtn) downloadBtn.disabled = state !== 'available';
    if (installBtn) installBtn.disabled = state !== 'downloaded';
}

async function renderUpdaterSettings(content) {
    if (!window.ToolsUpdater) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.up.unavailable'))}</div>`;
        return;
    }

    let versionInfo;
    let status;
    try {
        versionInfo = await window.ToolsUpdater.getVersion();
        status = await window.ToolsUpdater.getStatus();
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(e.message || navT('nav.up.unavailable'))}</div>`;
        return;
    }
    navState.updaterVersion = versionInfo;
    navState.updaterStatus = status;

    if (!navState.updaterUnsubscribe) {
        navState.updaterUnsubscribe = window.ToolsUpdater.onStatus((nextStatus) => {
            updateUpdaterPanel(nextStatus);
        });
    }

    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.up.help'))}</div>
        <div class="nav-update-card">
            <div class="nav-update-grid">
                <div class="nav-update-field">
                    <span>${navEscape(navT('nav.up.current'))}</span>
                    <strong>${navEscape(versionInfo.version || '-')}</strong>
                </div>
                <div class="nav-update-field">
                    <span>${navEscape(navT('nav.up.latest'))}</span>
                    <strong id="navUpdaterLatest">${navEscape(status.latestVersion || '-')}</strong>
                </div>
                <div class="nav-update-field">
                    <span>${navEscape(navT('nav.up.packaged'))}</span>
                    <strong>${navEscape(versionInfo.packaged ? navT('nav.up.packagedYes') : navT('nav.up.packagedNo'))}</strong>
                </div>
            </div>
            <div class="nav-update-status">
                <span>${navEscape(navT('nav.up.status'))}</span>
                <strong id="navUpdaterStatus">${navEscape(updaterStateLabel(status.state))} · ${navEscape(status.message || '')}</strong>
            </div>
            <div class="nav-update-progress-row">
                <span>${navEscape(navT('nav.up.progress'))}</span>
                <div class="nav-update-progress">
                    <div id="navUpdaterProgress" style="width:${Math.max(0, Math.min(100, Number(status.progress) || 0))}%"></div>
                </div>
                <b id="navUpdaterProgressText">${Math.round(Number(status.progress) || 0)}%</b>
            </div>
            <div class="nav-backup-toolbar nav-update-actions">
                <button id="navUpdaterCheckBtn" data-updater-action="check" onclick="checkToolsUpdate()">${navEscape(navT('nav.up.btnCheck'))}</button>
                <button id="navUpdaterDownloadBtn" data-updater-action="download" onclick="downloadToolsUpdate()">${navEscape(navT('nav.up.btnDownload'))}</button>
                <button id="navUpdaterInstallBtn" data-updater-action="install" onclick="installToolsUpdate()">${navEscape(navT('nav.up.btnInstall'))}</button>
            </div>
        </div>
    `;
    updateUpdaterPanel(status);
}

window.checkToolsUpdate = async function () {
    if (!window.ToolsUpdater) return;
    setUpdaterBusy(true);
    try {
        updateUpdaterPanel(await window.ToolsUpdater.check());
    } catch (e) {
        updateUpdaterPanel({ state: 'error', message: e.message, progress: 0 });
    } finally {
        setUpdaterBusy(false);
        updateUpdaterPanel(navState.updaterStatus);
    }
};

window.downloadToolsUpdate = async function () {
    if (!window.ToolsUpdater) return;
    try {
        updateUpdaterPanel(await window.ToolsUpdater.download());
    } catch (e) {
        updateUpdaterPanel({ state: 'error', message: e.message, progress: 0 });
    }
};

window.installToolsUpdate = async function () {
    if (!window.ToolsUpdater) return;
    try {
        updateUpdaterPanel(await window.ToolsUpdater.install());
    } catch (e) {
        updateUpdaterPanel({ state: 'error', message: e.message, progress: 100 });
    }
};

function formatBackupSize(bytes) {
    const size = Number(bytes) || 0;
    if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
}

function formatBackupTime(value) {
    if (!value) return '-';
    try {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleString('zh-CN', {
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short'
        });
    } catch (e) {
        return value;
    }
}

function getLocalTimeZoneLabel() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '浏览器本地时区';
    } catch (e) {
        return '浏览器本地时区';
    }
}

async function fetchBackupList() {
    const res = await fetch('/api/global-backup/list', { headers: getAuthHeaderForNav() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function fetchRemoteBackupSettings() {
    const res = await fetch('/api/global-backup/remote-settings', { headers: getAuthHeaderForNav() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function fetchScheduleBackupSettings() {
    const res = await fetch('/api/global-backup/schedule-settings', { headers: getAuthHeaderForNav() });
    if (res.status === 404) {
        return {
            enabled: true,
            time: '02:00',
            retentionDays: 90,
            maxTotalSizeGB: 10,
            nextRunAt: null,
            lastSuccessAt: null,
            lastBackupName: '',
            lastError: '定时备份接口未加载，请重启后端服务。'
        };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function renderScheduleBackupSettings(settings = {}) {
    const nextRunText = settings.enabled
        ? formatBackupTime(settings.nextRunAt)
        : navT('nav.bk.scheduleDisabled');
    const lastSuccessText = settings.lastSuccessAt
        ? formatBackupTime(settings.lastSuccessAt)
        : navT('nav.bk.scheduleNotRun');
    return `
        <div class="nav-schedule-backup-card">
            <div class="nav-remote-backup-head">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.scheduleTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.scheduleDesc'))}</div>
                </div>
                <label class="nav-remote-switch">
                    <input id="scheduleBackupEnabled" type="checkbox" ${settings.enabled !== false ? 'checked' : ''} onchange="scheduleBackupSettingsSave()">
                    ${navEscape(navT('nav.bk.scheduleEnabled'))}
                </label>
            </div>
            <div class="nav-schedule-backup-grid">
                <label>
                    <span>${navEscape(navT('nav.bk.scheduleTime'))}</span>
                    <input id="scheduleBackupTime" type="time" class="nav-settings-input" value="${navEscape(settings.time || '02:00')}" oninput="scheduleBackupSettingsSave()">
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.scheduleRetention'))}</span>
                    <div class="nav-schedule-retention-row">
                        <input id="scheduleBackupRetentionDays" type="number" min="1" max="3650" step="1" class="nav-settings-input" value="${navEscape(settings.retentionDays || 90)}" oninput="scheduleBackupSettingsSave()">
                        <em>${navEscape(navT('nav.bk.scheduleDays'))}</em>
                    </div>
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.scheduleCapacity'))}</span>
                    <div class="nav-schedule-retention-row">
                        <input id="scheduleBackupMaxTotalSizeGB" type="number" min="0.1" max="10240" step="0.1" class="nav-settings-input" value="${navEscape(settings.maxTotalSizeGB || 10)}" oninput="scheduleBackupSettingsSave()">
                        <em>${navEscape(navT('nav.bk.scheduleGB'))}</em>
                    </div>
                </label>
                <div class="nav-backup-toolbar nav-remote-backup-actions">
                    <button type="button" onclick="runScheduledBackupNow()">${navEscape(navT('nav.bk.scheduleRun'))}</button>
                </div>
            </div>
            <div class="nav-remote-backup-status">
                <span>${navEscape(navT('nav.bk.scheduleNext'))}${navEscape(nextRunText)}</span>
                <span>${navEscape(navT('nav.bk.scheduleLast'))}${navEscape(lastSuccessText)}</span>
                <span id="scheduleBackupCapacityStatus" class="${settings.capacityExceeded ? 'warning' : ''}">${navEscape(navT('nav.bk.scheduleUsage', { used: formatBackupSize(settings.currentTotalBytes || 0), limit: formatBackupSize(settings.maxTotalBytes || (Number(settings.maxTotalSizeGB || 10) * 1024 * 1024 * 1024)) }))}${settings.capacityExceeded ? ` · ${navEscape(navT('nav.bk.scheduleOver'))}` : ''}</span>
                ${settings.lastBackupName ? `<span>${navEscape(navT('nav.bk.scheduleLastFile'))}${navEscape(settings.lastBackupName)}</span>` : ''}
                ${settings.lastError ? `<span class="warning">${navEscape(navT('nav.bk.scheduleError'))}${navEscape(settings.lastError)}</span>` : ''}
            </div>
        </div>
    `;
}

function renderRemoteBackupSyncSettings(settings = {}) {
    const lastSync = settings.lastSync || {};
    const lastRemote = lastSync.remoteBackup || {};
    const lastCheck = settings.lastCheck || {};
    const checkLatest = lastCheck.latest || {};
    const lastSyncText = lastSync.restoredAt
        ? `${formatBackupTime(lastSync.restoredAt)} · ${lastRemote.name || '-'}`
        : '尚未恢复远端备份';
    const lastCheckText = lastCheck.checkedAt
        ? `${formatBackupTime(lastCheck.checkedAt)} · 最新：${checkLatest.name || '-'}`
        : '尚未检查远端';
    return `
        <div class="nav-remote-backup-card">
            <div class="nav-remote-backup-head">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.remoteTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.remoteDesc'))}</div>
                </div>
                <label class="nav-remote-switch">
                    <input id="remoteBackupEnabled" type="checkbox" ${settings.enabled ? 'checked' : ''} onchange="scheduleRemoteBackupSettingsSave()">
                    ${navEscape(navT('nav.bk.enable'))}
                </label>
            </div>
            <div class="nav-remote-backup-grid">
                <label>
                    <span>${navEscape(navT('nav.bk.remoteDomain'))}</span>
                    <input id="remoteBackupBaseUrl" class="nav-settings-input" value="${navEscape(settings.baseUrl || '')}" placeholder="例如：https://cs.fanxiaolong.uk" oninput="scheduleRemoteBackupSettingsSave()">
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.remoteUser'))}</span>
                    <input id="remoteBackupUsername" class="nav-settings-input" value="${navEscape(settings.username || '')}" autocomplete="username" oninput="scheduleRemoteBackupSettingsSave()">
                </label>
                <label>
                    <span>${navEscape(navT('nav.bk.remotePwd'))}</span>
                    <input id="remoteBackupPassword" type="password" class="nav-settings-input" autocomplete="new-password" data-lpignore="true" data-1p-ignore="true" placeholder="${settings.hasPassword ? `留空保持当前：${navEscape(settings.maskedPassword || '已保存')}` : navEscape(navT('nav.bk.plhPwd'))}" onfocus="this.dataset.userTouched='1'" oninput="scheduleRemoteBackupSettingsSave({ passwordTouched: this.dataset.userTouched === '1' })">
                </label>
                <div class="nav-remote-checks">
                    <label><input id="remoteBackupCompare" type="checkbox" ${settings.compareBeforeRestore !== false ? 'checked' : ''} onchange="scheduleRemoteBackupSettingsSave()"> ${navEscape(navT('nav.bk.optCompare'))}</label>
                    <label><input id="remoteBackupCreateBeforePull" type="checkbox" ${settings.createRemoteBackupBeforePull !== false ? 'checked' : ''} onchange="scheduleRemoteBackupSettingsSave()"> ${navEscape(navT('nav.bk.optPull'))}</label>
                    <label title="${settings.startupAutoRestoreSupported === false ? navEscape(navT('nav.bk.optAutoDefaultOnly')) : ''}"><input id="remoteBackupAutoRestore" type="checkbox" ${settings.autoRestore ? 'checked' : ''} ${settings.startupAutoRestoreSupported === false ? 'disabled' : ''} onchange="scheduleRemoteBackupSettingsSave()"> ${navEscape(navT('nav.bk.optAuto'))}</label>
                </div>
                ${settings.startupAutoRestoreSupported === false ? `<div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.optAutoDefaultOnly'))}</div>` : ''}
            </div>
            <div class="nav-remote-backup-status">
                <span>${navEscape(navT('nav.bk.stLocal', { tz: getLocalTimeZoneLabel() }))}</span>
                <span>${navEscape(navT('nav.bk.stCheck'))}${navEscape(lastCheckText)}</span>
                <span>${navEscape(navT('nav.bk.stSync'))}${navEscape(lastSyncText)}</span>
                ${settings.lastError ? `<span class="warning">${navEscape(navT('nav.bk.stError'))}${navEscape(settings.lastError)}</span>` : ''}
            </div>
            <div class="nav-backup-toolbar nav-remote-backup-actions">
                <button type="button" onclick="checkRemoteBackupNow()">${navEscape(navT('nav.bk.btnCheck'))}</button>
                <button type="button" onclick="pullRemoteBackupNow(false)">${navEscape(navT('nav.bk.btnPull'))}</button>
                <button type="button" class="danger" onclick="pullRemoteBackupNow(true)">${navEscape(navT('nav.bk.btnForce'))}</button>
                <button type="button" onclick="clearRemoteBackupPassword()">${navEscape(navT('nav.bk.btnClearPwd'))}</button>
            </div>
        </div>
    `;
}

async function renderBackupSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.bk.empty'))}</div>`;
    try {
        const [data, remoteSettings, scheduleSettings] = await Promise.all([
            fetchBackupList(),
            fetchRemoteBackupSettings(),
            fetchScheduleBackupSettings()
        ]);
        if (data.tenantId && data.tenantId !== (navState.activeTenantId || 'default')) {
            throw new Error(navLocaleText(
                `页面租户已发生变化（页面：${navState.activeTenantId || 'default'}，服务端：${data.tenantId}），请刷新页面后再操作备份。`,
                `The active tenant changed (page: ${navState.activeTenantId || 'default'}, server: ${data.tenantId}). Refresh before using backup actions.`
            ));
        }
        navState.remoteBackupSettings = remoteSettings;
        navState.scheduleBackupSettings = scheduleSettings;
        const targetText = (data.targets || []).map(item => item.relPath || item.path).join('、') || 'backend/data、data';
        const rows = (data.backups || []).map(item => `
            <tr>
                <td>
                    <div class="nav-backup-name" title="${navEscape(item.name)}">
                        ${navEscape(item.name)}
                        ${item.triggerType === 'remote-sync-request' ? `<span class="nav-backup-badge remote">${navEscape(navT('nav.bk.badgeSync'))}</span>` : ''}
                        ${item.triggerType === 'pre-restore' ? `<span class="nav-backup-badge safety">${navEscape(navT('nav.bk.badgeSafe'))}</span>` : ''}
                        ${item.triggerType === 'scheduled-auto' ? `<span class="nav-backup-badge automatic">${navEscape(navT('nav.bk.badgeAuto'))}</span>` : ''}
                    </div>
                    <div class="nav-backup-meta">${formatBackupTime(item.modifiedAt)} · ${formatBackupSize(item.size)}</div>
                    ${item.reason ? `<div class="nav-backup-meta">Reason: ${navEscape(item.reason)}</div>` : ''}
                </td>
                <td class="nav-backup-action-cell">
                    <div class="nav-backup-actions">
                        <button onclick="downloadGlobalBackup('${navEscape(item.name)}')" title="${navEscape(navT('nav.bk.dlTitle'))}">⬇️</button>
                        <button class="danger" onclick="restoreGlobalBackupFromServer('${navEscape(item.name)}')" title="${navEscape(navT('nav.bk.rsTitle'))}">⏪</button>
                        <button class="danger delete" onclick="deleteGlobalBackup('${navEscape(item.name)}')" title="${navEscape(navT('nav.bk.delTitle'))}">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');

        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.bk.help', { tenant: activeTenantName(), tenantId: navState.activeTenantId || 'default', target: targetText }))}</div>
            ${renderScheduleBackupSettings(scheduleSettings)}
            ${renderRemoteBackupSyncSettings(remoteSettings)}
            <div class="nav-backup-panel">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.svrTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.svrDesc'))}</div>
                </div>
                <div class="nav-backup-toolbar">
                    <button onclick="createGlobalBackup(false)">${navEscape(navT('nav.bk.btnCreate'))}</button>
                    <button onclick="createGlobalBackup(true)">${navEscape(navT('nav.bk.btnCreateDL'))}</button>
                </div>
            </div>
            <div class="nav-backup-upload">
                <div>
                    <div class="nav-backup-panel-title">${navEscape(navT('nav.bk.upTitle'))}</div>
                    <div class="nav-backup-panel-desc">${navEscape(navT('nav.bk.upDesc'))}</div>
                </div>
                <input id="globalBackupUploadInput" type="file" accept=".zip,application/zip">
                <button class="danger" onclick="restoreGlobalBackupFromUpload()">${navEscape(navT('nav.bk.btnUp'))}</button>
            </div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table nav-backup-table">
                    <thead><tr><th>${navEscape(navT('nav.bk.thFile'))}</th><th>${navEscape(navT('nav.bk.thAction'))}</th></tr></thead>
                    <tbody>${rows || `<tr><td colspan="2">${navEscape(navT('nav.bk.noData'))}</td></tr>`}</tbody>
                </table>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.bk.fail'))}${navEscape(e.message)}</div>`;
    }
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

async function renderSnapshotPublishSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(snapshotText('正在读取推送配置与历史…', 'Loading publishing settings and history…'))}</div>`;
    try {
        const [settings, jobs] = await Promise.all([snapshotApi('/settings'), snapshotApi('/jobs')]);
        if (navState.settingsTab !== 'snapshotPublish') return;
        const configKey = getSnapshotConfigKey(settings);
        const cached = getSnapshotPrereqCache(configKey);
        const prereqClass = cached ? (cached.result.gitFound && cached.result.branchReady ? 'ready' : 'attention') : '';
        const prereqContent = cached ? formatSnapshotPrereqHtml(cached.result) : navEscape(snapshotText('正在检测 Git 与 CodeHub 连接…', 'Checking Git and CodeHub access…'));
        content.innerHTML = `
            <div class="snapshot-settings">
                <div id="snapshotPrerequisites" class="snapshot-prerequisites ${prereqClass}" role="status">${prereqContent}</div>
                <div class="snapshot-hero"><span class="snapshot-hero-icon">↗</span><div><strong>${navEscape(snapshotText('平台工具 · 静态页面发布（Git Pages）', 'Platform Tools · Static Page Publishing (Git Pages)'))}</strong><p>${navEscape(snapshotText('推送与平台一致的主页和只读工具，统一使用本地账号登录。账号密码按推送时同步，修改后请再次推送；站点需使用 HTTPS。', 'Publish the platform homepage and read-only tools with one sign-in using local accounts. Account changes take effect after publishing again. HTTPS is required.'))}</p></div></div>
                <div class="snapshot-fields">
                    <label>${navEscape(snapshotText('推送格式', 'Publishing format'))}<select id="snapshotPublishMode" class="nav-settings-input" onchange="updateSnapshotPublishPathPreview(); restartSnapshotEstimates();"><option value="single" ${settings.publishMode !== 'pages' ? 'selected' : ''}>${navEscape(snapshotText('单文件 HTML（数据内嵌）', 'Single HTML (embedded data)'))}</option><option value="pages" ${settings.publishMode === 'pages' ? 'selected' : ''}>${navEscape(snapshotText('Pages 分离版（HTML + JSON + 附件）', 'Split Pages (HTML + JSON + evidence)'))}</option></select><small>${navEscape(snapshotText('下载按钮始终导出可离线查看的单 HTML。Pages 分离版按工具目录存储文件，仅提交有变化的文件。', 'The download button always exports a standalone offline HTML. Split Pages stores assets under the tool directory and commits only changed files.'))}</small></label>
                    <label>${navEscape(snapshotText('远端仓库地址（推荐）', 'Remote Git URL (recommended)'))}<input id="snapshotRemoteUrl" class="nav-settings-input" value="${navEscape(settings.remoteUrl || '')}" placeholder="https://codehub.example.com/team/project.git" autocomplete="off"><small>${navEscape(snapshotText('HTTPS 或 SSH；不要在地址中包含密码或 Token。服务器需已配置 Git 认证。填写后优先使用此地址。', 'HTTPS or SSH; never put a password or token in the URL. Git authentication must be configured on the server. This takes priority when set.'))}</small></label>
                    <label>${navEscape(snapshotText('本地 Git 镜像仓库（可选）', 'Local Git mirror (optional)'))}<input id="snapshotRepoDir" class="nav-settings-input" value="${navEscape(settings.repoDir || '')}" placeholder="D:\\03-工具开发\\privacy-policy-main\\CNBG\\_CS\\_Tools\\_Platform" autocomplete="off"><small>${navEscape(snapshotText('远端地址留空时读取此目录的 origin；不覆盖镜像工作区。', 'When the remote URL is empty, its origin is used. The mirror checkout remains untouched.'))}</small></label>
                    <label>${navEscape(snapshotText('目标分支', 'Target branch'))}<input id="snapshotBranch" class="nav-settings-input" value="${navEscape(settings.branch || 'master')}" autocomplete="off"></label>
                    <label>${navEscape(snapshotText('仓库内 HTML 路径模板', 'HTML path template in repository'))}<input id="snapshotFile" class="nav-settings-input" value="${navEscape(settings.file || '{toolSlug}/index.html')}" placeholder="{toolSlug}/index.html" autocomplete="off" oninput="updateSnapshotPublishPathPreview()"><small>${navEscape(snapshotText('{toolSlug} 使用工具市场的稳定标识。仓库根目录 index.html 将作为工具菜单；更改路径不会自动删除旧路径。', '{toolSlug} uses the stable marketplace identifier. Root index.html is reserved for the tool menu; changing paths does not delete old files.'))}</small><small id="snapshotPathPreview" class="snapshot-path-preview">${navEscape(snapshotText('实际页面：', 'Resolved page: '))}${navEscape(settings.resolvedFile || '{toolSlug}/index.html')}${settings.publishMode === 'pages' ? ` · ${navEscape(snapshotText('数据目录：', 'Data directory: '))}${navEscape((settings.resolvedFile || '{toolSlug}/index.html').replace(/[^/]+$/, 'data/'))}` : ''}</small></label>
                </div>
                <div class="snapshot-security">
                    <div class="snapshot-security-head">
                        <div>
                            <strong>${navEscape(snapshotText('已接入静态发布的工具', 'Tools with Snapshot Publishing'))}</strong>
                            <p>${navEscape(snapshotText('勾选参与全量与定时推送的工具。首页和所有工具统一登录，无需单独密码；脚本与插件暂不发布。', 'Choose tools for full and scheduled publishing. The homepage and tools share one sign-in; individual passwords are no longer needed. Scripts and plugins are excluded.'))}</p>
                        </div>
                        <input type="search" id="snapshotToolsFilter" class="nav-settings-input" style="max-width: 170px; padding: 5px 10px; font-size: 12px; margin-left: auto;" placeholder="${navEscape(snapshotText('搜索工具…', 'Filter tools…'))}" oninput="filterSnapshotTools(this.value)">
                    </div>
                    <div class="snapshot-tools-toolbar">
                        <button type="button" onclick="toggleAllSnapshotTools(true)">${navEscape(snapshotText('全选可推送工具', 'Select eligible tools'))}</button>
                        <button type="button" onclick="toggleAllSnapshotTools(false)">${navEscape(snapshotText('取消全选', 'Clear selection'))}</button>
                        <small>${navEscape(snapshotText('达到 10 MiB 或 100 个文件的工具自动跳过；仅可从该工具顶部强制推送。', 'Tools at 10 MiB or 100 files are skipped; use Force publish from that tool’s top menu.'))}</small>
                    </div>
                    <div class="snapshot-tools-list">
                        ${(settings.tools || [
                            { toolSlug: 'department-reward-penalty', name: '负向事件管理', encryptionEnabled: settings.encryptionEnabled, hasPassword: settings.hasPassword, enabled: true },
                            { toolSlug: 'reward-program', name: '奖励申报与评优', encryptionEnabled: false, hasPassword: false, enabled: true }
                        ]).filter(t => !['f12-to-extension', 'python-updater'].includes(t.toolSlug)).map(t => `
                            <div class="snapshot-tool-item" data-tool-slug="${navEscape(t.toolSlug)}">
                                <div class="snapshot-tool-row">
                                    <label class="snapshot-tool-enable">
                                        <input type="checkbox" id="snapshotToolEnabled_${navEscape(t.toolSlug)}" ${t.enabled !== false ? 'checked' : ''}>
                                        <strong>${navEscape(t.name || t.toolSlug)}</strong>
                                        <small class="snapshot-tool-slug">${navEscape(t.toolSlug)}</small>
                                    </label>
                                    <div class="snapshot-tool-meta-right">
                                        <button type="button" class="snapshot-tool-size-badge pending" id="snapshotToolSize_${navEscape(t.toolSlug)}" title="${navEscape(snapshotText('点击重新预估此工具大小', 'Click to re-estimate data volume'))}" onclick="estimateSingleSnapshotTool('${navEscape(t.toolSlug)}')">
                                            <span class="snapshot-size-loading-dot"></span>
                                            <span class="snapshot-size-text">${navEscape(snapshotText('待预估', 'Pending'))}</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="snapshot-tool-warning-row" id="snapshotToolWarning_${navEscape(t.toolSlug)}" style="display:none"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="snapshot-schedule"><div><strong>${navEscape(snapshotText('自动同步', 'Automatic sync'))}</strong><p>${navEscape(snapshotText('后台按周期生成最新只读快照；不需要打开工具页面。仅在服务端或绿色版程序运行时执行。', 'The backend periodically generates a fresh read-only snapshot without opening the tool page. It runs only while the server or portable app is running.'))}</p></div><label class="snapshot-schedule-toggle"><input id="snapshotScheduleEnabled" type="checkbox" ${settings.scheduleEnabled ? 'checked' : ''}> ${navEscape(snapshotText('启用定时推送', 'Enable scheduled publishing'))}</label><label class="snapshot-interval">${navEscape(snapshotText('每隔', 'Every'))} <input id="snapshotIntervalMinutes" class="nav-settings-input" type="number" min="5" max="1440" step="1" value="${Number(settings.intervalMinutes) || 60}"> ${navEscape(snapshotText('分钟', 'minutes'))}</label><div class="snapshot-schedule-status">${settings.scheduleEnabled ? `${navEscape(snapshotText('下次计划执行：', 'Next scheduled run: '))}${navEscape(settings.nextRunAt ? new Date(settings.nextRunAt).toLocaleString() : '-')}` : navEscape(snapshotText('自动推送未启用', 'Scheduled publishing is off'))}${settings.lastAutoError ? `<br>${navEscape(snapshotText('最近调度错误：', 'Last scheduling error: '))}${navEscape(settings.lastAutoError)}` : ''}</div></div>
                <div class="snapshot-actions"><button type="button" onclick="saveSnapshotPublishSettings()">${navEscape(snapshotText('保存推送配置', 'Save destination'))}</button><button type="button" onclick="startSnapshotPublish({ force: true })" title="${navEscape(snapshotText('即使文件未变更，也强制向远端提交并推送，以触发 Pages 重新部署', 'Force a Git commit & push even if no file changes, triggering Pages redeploy'))}">${navEscape(snapshotText('强制推送', 'Force publish'))}</button><button type="button" class="snapshot-primary" onclick="startSnapshotPublish()">${navEscape(snapshotText('生成并推送快照', 'Generate & publish'))}</button></div>
                <div class="snapshot-history-head"><strong>${navEscape(snapshotText('推送历史', 'Publishing history'))}</strong><button type="button" onclick="renderSnapshotPublishSettings(document.getElementById('navSettingsContent'))">↻ ${navEscape(snapshotText('刷新', 'Refresh'))}</button></div>
                <div class="snapshot-history">${jobs.length ? jobs.map(job => `<button type="button" class="snapshot-history-item" data-job-id="${navEscape(job.id)}"><span class="snapshot-dot ${navEscape(job.status)}"></span><span><strong>${job.trigger === 'scheduled' ? navEscape(snapshotText('定时', 'Scheduled')) + ' · ' : ''}${navEscape(job.stage)}</strong><small>${navEscape(new Date(job.createdAt).toLocaleString())} · ${navEscape(job.path)}</small></span><span class="snapshot-percent">${Number(job.progress)}%</span></button>`).join('') : `<div class="snapshot-history-empty">${navEscape(snapshotText('还没有推送记录', 'No publishing runs yet'))}</div>`}</div>
            </div>`;
        content.querySelectorAll('[data-job-id]').forEach(button => button.addEventListener('click', () => openSnapshotPublishProgress(button.dataset.jobId)));
        startSnapshotToolsEstimateQueue();
        if (!cached) {
            checkSnapshotPrerequisites({ settings });
        }
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(snapshotText('读取失败：', 'Failed to load: '))}${navEscape(error.message)}</div>`;
    }
}

let snapshotEstimateAbortController = null;

window.restartSnapshotEstimates = function () {
    if (snapshotEstimateAbortController) {
        snapshotEstimateAbortController.abort();
        snapshotEstimateAbortController = null;
    }
    startSnapshotToolsEstimateQueue();
};

window.estimateSingleSnapshotTool = async function (toolSlug) {
    const badge = document.getElementById('snapshotToolSize_' + toolSlug);
    const item = document.querySelector(`.snapshot-tool-item[data-tool-slug="${toolSlug}"]`);
    const warnRow = document.getElementById('snapshotToolWarning_' + toolSlug);
    const mode = document.getElementById('snapshotPublishMode')?.value || 'pages';
    if (!badge || !item) return;
    markSnapshotEstimatePending(item);
    const requestId = item.dataset.estimateRequest = String(Date.now()) + Math.random();
    badge.className = 'snapshot-tool-size-badge loading';
    badge.innerHTML = `<span class="snapshot-size-loading-dot"></span><span class="snapshot-size-text">${navEscape(snapshotText('预估中…', 'Estimating…'))}</span>`;

    try {
        const res = await snapshotApi('/estimate/' + encodeURIComponent(toolSlug) + '?mode=' + encodeURIComponent(mode) + '&refresh=1');
        if (item.dataset.estimateRequest !== requestId) return;
        applyToolEstimateResult(toolSlug, res, badge, item, warnRow);
    } catch (err) {
        if (item.dataset.estimateRequest === requestId) failSnapshotEstimate(item, badge);
    }
};

function applyToolEstimateResult(toolSlug, res, badge, item, warnRow) {
    if (!badge || !res || !item?.isConnected) return;
    const countText = snapshotText(`${res.fileCount} 个文件`, `${res.fileCount} files`);
    const sizeText = res.totalSizeFormatted || '0 B';
    const blocked = res.isHeavy || res.supported === false;
    item.dataset.estimateState = blocked ? 'blocked' : 'ready';
    const checkbox = document.getElementById('snapshotToolEnabled_' + toolSlug);
    if (checkbox) {
        checkbox.disabled = blocked;
        checkbox.checked = !blocked && item.dataset.requestedEnabled === '1';
    }
    badge.className = 'snapshot-tool-size-badge badge-' + (blocked ? 'danger' : res.warningLevel || 'normal');
    badge.title = snapshotText('点击重新预估此工具大小', 'Click to re-estimate data volume');
    badge.innerHTML = `${blocked ? '⚠️ ' : ''}<span class="snapshot-size-text">${navEscape(countText)} · ${navEscape(sizeText)}</span>`;
    item.classList.toggle('snapshot-tool-heavy', blocked);
    if (warnRow) {
        warnRow.style.display = blocked ? 'flex' : 'none';
        warnRow.className = 'snapshot-tool-warning-row snapshot-heavy-warning';
        warnRow.textContent = blocked ? snapshotText('批量与定时推送自动跳过，已发布版本保留。请打开该工具，在顶部选择“强制推送”单独更新；不会截断历史数据。', 'Skipped in bulk and scheduled publishing; the published version is retained. Open this tool and use Force publish from its top menu. History is preserved.') : '';
    }
}

window.toggleAllSnapshotTools = function (checked) {
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(item => {
        if (item.hidden) return;
        item.dataset.requestedEnabled = checked ? '1' : '0';
        const checkbox = document.getElementById('snapshotToolEnabled_' + item.dataset.toolSlug);
        if (checkbox) checkbox.checked = !checkbox.disabled && checked;
    });
};

function markSnapshotEstimatePending(item) {
    const input = document.getElementById('snapshotToolEnabled_' + item.dataset.toolSlug);
    if (input) {
        if (!input.disabled) item.dataset.requestedEnabled = input.checked ? '1' : '0';
        input.disabled = true; input.checked = false;
    }
    item.dataset.estimateState = 'pending';
}

function failSnapshotEstimate(item, badge) {
    item.dataset.estimateState = 'error';
    badge.className = 'snapshot-tool-size-badge error';
    badge.textContent = snapshotText('预估失败，点击重试', 'Estimate failed; click to retry');
}

function startSnapshotToolsEstimateQueue() {
    if (snapshotEstimateAbortController) {
        snapshotEstimateAbortController.abort();
    }
    const ac = new AbortController();
    snapshotEstimateAbortController = ac;

    const items = Array.from(document.querySelectorAll('.snapshot-tool-item[data-tool-slug]'));
    if (!items.length) return;

    const mode = document.getElementById('snapshotPublishMode')?.value || 'pages';

    // 初始将所有 badge 标记为待预估
    items.forEach(item => {
        markSnapshotEstimatePending(item);
        item.dataset.estimateRequest = '';
        const slug = item.dataset.toolSlug;
        const badge = document.getElementById('snapshotToolSize_' + slug);
        if (badge) {
            badge.className = 'snapshot-tool-size-badge pending';
            badge.innerHTML = `<span class="snapshot-size-text">${navEscape(snapshotText('排队中…', 'Queued…'))}</span>`;
        }
    });

    // 串行预估，避免同时生成多个业务快照。
    (async () => {
        for (const item of items) {
            if (ac.signal.aborted) return;
            const slug = item.dataset.toolSlug;
            if (!slug) continue;
            const badge = document.getElementById('snapshotToolSize_' + slug);
            const warnRow = document.getElementById('snapshotToolWarning_' + slug);
            if (!badge || item.dataset.estimateState !== 'pending' || item.dataset.estimateRequest) continue;
            const requestId = item.dataset.estimateRequest = String(Date.now()) + Math.random();

            badge.className = 'snapshot-tool-size-badge loading';
            badge.innerHTML = `<span class="snapshot-size-loading-dot"></span><span class="snapshot-size-text">${navEscape(snapshotText('预估中…', 'Estimating…'))}</span>`;

            try {
                const res = await snapshotApi('/estimate/' + encodeURIComponent(slug) + '?mode=' + encodeURIComponent(mode), {
                    signal: ac.signal
                });
                if (ac.signal.aborted) return;
                if (item.dataset.estimateRequest !== requestId) continue;
                applyToolEstimateResult(slug, res, badge, item, warnRow);
            } catch (err) {
                if (ac.signal.aborted) return;
                if (item.dataset.estimateRequest === requestId) failSnapshotEstimate(item, badge);
            }

            // 每个工具间隔 60ms 释放 CPU 与渲染线程，防止卡顿
            await new Promise(r => setTimeout(r, 60));
        }
    })().catch(() => {});
}

window.filterSnapshotTools = function (query) {
    const q = String(query || '').trim().toLowerCase();
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(item => {
        const slug = (item.dataset.toolSlug || '').toLowerCase();
        const name = (item.querySelector('strong')?.textContent || '').toLowerCase();
        const match = !q || slug.includes(q) || name.includes(q);
        item.style.display = match ? '' : 'none';
    });
};

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

window.updateSnapshotPublishPathPreview = function () {
    const preview = document.getElementById('snapshotPathPreview');
    const input = document.getElementById('snapshotFile');
    if (!preview || !input) return;
    const path = input.value.trim().replace('{toolSlug}', 'department-reward-penalty');
    const valid = path !== 'index.html' && /^[\w./-]+\.html$/.test(path) && !path.startsWith('/') && !path.split('/').some(part => !part || part === '..');
    preview.textContent = valid ? snapshotText('实际页面：', 'Resolved page: ') + path + (document.getElementById('snapshotPublishMode')?.value === 'pages' ? ' · ' + snapshotText('数据目录：', 'Data directory: ') + path.replace(/[^/]+$/, 'data/') : '') : snapshotText('路径格式无效，请使用 {toolSlug}/index.html 等相对路径', 'Invalid path. Use a relative path such as {toolSlug}/index.html');
};

window.saveSnapshotPublishSettings = async function (options = {}) {
    const button = document.querySelector('.snapshot-actions button');
    const indicator = document.getElementById('navSettingsSaveState');
    if (button) button.disabled = true;
    if (indicator && !options.silent) indicator.textContent = snapshotText('正在保存…', 'Saving…');
    const toolsList = [];
    document.querySelectorAll('.snapshot-tool-item[data-tool-slug]').forEach(el => {
        if (el.dataset.estimateState !== 'ready') return;
        const slug = el.dataset.toolSlug;
        const en = document.getElementById('snapshotToolEnabled_' + slug)?.checked !== false;
        toolsList.push({ toolSlug: slug, enabled: en });
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

function renderInitializationSettings(content) {
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.init.help'))}</div>
        <section class="nav-init-card">
            <div>
                <div class="nav-backup-panel-title">🚀 ${navEscape(navT('nav.init.quickTitle'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.init.quickDesc'))}</div>
            </div>
            <button type="button" onclick="enableQuickStartMode()">${navEscape(navT('nav.init.quickButton'))}</button>
        </section>
        <section class="nav-init-card danger-zone">
            <div>
                <div class="nav-init-danger-label">⚠ ${navEscape(navT('nav.init.dangerLabel'))}</div>
                <div class="nav-backup-panel-title">${navEscape(navT('nav.init.resetTitle'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.init.resetDesc'))}</div>
                <div class="nav-init-note">${navEscape(navT('nav.init.resetArchive'))}</div>
            </div>
            <button type="button" class="danger" onclick="factoryResetProgramData()">${navEscape(navT('nav.init.resetButton'))}</button>
        </section>
        <div id="navInitializationStatus" class="nav-init-status" role="status"></div>
    `;
}

async function renderTenantSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.tenant.loading'))}</div>`;
    try {
        await Promise.all([loadTenantNavigation(), loadManagedTenants()]);
    } catch (error) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(error.message)}</div>`;
        return;
    }
    const activeTenants = navState.managedTenants.filter(tenant => tenant.status === 'active');
    const archivedTenants = navState.managedTenants.filter(tenant => tenant.status === 'archived');
    const tenantRow = (tenant, archived = false) => `
        <div class="nav-tenant-admin-row ${archived ? 'archived' : ''}" data-tenant-id="${navEscape(tenant.id)}">
            <div>
                <strong>${navEscape(displayTenantName(tenant))}</strong><span>${navEscape(tenant.id)}</span>
                ${archived ? `<em class="nav-tenant-status-badge">${navEscape(navT('nav.tenant.archivedBadge'))}</em>` : ''}
                <p>${navEscape(tenant.description || '')}</p>
            </div>
            <div class="nav-backup-toolbar">
                <button type="button" onclick="editTenantInfo('${navEscape(tenant.id)}')">${navEscape(navT('nav.tenant.edit'))}</button>
                ${archived
            ? `<button type="button" onclick="restoreArchivedTenantInfo('${navEscape(tenant.id)}')">${navEscape(navT('nav.tenant.restore'))}</button>
                       <button type="button" class="danger" onclick="deleteTenantData('${navEscape(tenant.id)}')">${navEscape(navT('nav.tenant.delete'))}</button>`
            : tenant.id !== 'default' ? `<button type="button" class="danger" onclick="archiveTenantInfo('${navEscape(tenant.id)}')">${navEscape(navT('nav.tenant.archive'))}</button>` : ''}
            </div>
        </div>`;
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.tenant.defaultHint'))}</div>
        <form class="nav-tenant-create" novalidate onsubmit="createTenantInfo(event)">
            <input name="name" required maxlength="80" placeholder="${navEscape(navT('nav.tenant.name'))}">
            <input name="id" maxlength="63" pattern="[a-zA-Z0-9_-]+" placeholder="${navEscape(navT('nav.tenant.id'))}">
            <input name="description" maxlength="240" placeholder="${navEscape(navT('nav.tenant.description'))}">
            <button type="submit">${navEscape(navT('nav.tenant.create'))}</button>
        </form>
        <section class="nav-tenant-section">
            <div class="nav-tenant-section-head">${navEscape(navT('nav.tenant.activeGroup'))}<span>${activeTenants.length}</span></div>
            <div class="nav-tenant-admin-list">${activeTenants.map(tenant => tenantRow(tenant)).join('')}</div>
        </section>
        <section class="nav-tenant-section">
            <div class="nav-tenant-section-head">${navEscape(navT('nav.tenant.archivedGroup'))}<span>${archivedTenants.length}</span></div>
            <div class="nav-tenant-admin-list">${archivedTenants.map(tenant => tenantRow(tenant, true)).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.tenant.archivedEmpty'))}</div>`}</div>
        </section>`;
}

window.createTenantInfo = async function (event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    body.name = String(body.name || '').trim();
    body.id = String(body.id || '').trim();
    body.description = String(body.description || '').trim();
    if (!body.name) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.tenant.nameRequired'), tone: 'info' });
    if (body.id && !/^[a-zA-Z0-9_-]+$/.test(body.id)) {
        return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.tenant.idInvalid'), tone: 'info' });
    }
    const operationId = `tenant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    startBackupOperationConsole(navLocaleText('新增租户初始化', 'New tenant initialization'), '/api/tenants/operations', operationId);
    appendBackupConsoleEntry(navLocaleText(`正在创建租户“${body.name}”`, `Creating tenant “${body.name}”`), 'info');
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = navLocaleText('创建中…', 'Creating…');
    }
    try {
        const response = await fetch('/api/tenants', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Tenant-Operation-Id': operationId, ...getAuthHeaderForNav() },
            body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        appendBackupConsoleEntry(navLocaleText('客户端已收到创建完成响应', 'The client received the completion response'), 'success');
        setBackupConsoleProgress(100, 'COMPLETED');
        await renderTenantSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        appendBackupConsoleEntry(navLocaleText(`创建失败：${error.message}`, `Creation failed: ${error.message}`), 'error');
        setBackupConsoleProgress(100, 'FAILED');
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: error.message, tone: 'error' });
    } finally {
        if (submitButton?.isConnected) {
            submitButton.disabled = false;
            submitButton.textContent = navT('nav.tenant.create');
        }
    }
};

window.editTenantInfo = async function (tenantId) {
    const tenant = navState.managedTenants.find(item => item.id === tenantId) || navState.tenants.find(item => item.id === tenantId);
    if (!tenant) return;
    const values = await showNavbarFormDialog({
        title: navLocaleText('编辑租户信息', 'Edit tenant'),
        message: navLocaleText(`正在编辑“${displayTenantName(tenant)}”。租户标识 ${tenant.id} 不会改变。`, `Editing “${displayTenantName(tenant)}”. Tenant ID ${tenant.id} will not change.`),
        fields: [
            { name: 'name', label: navT('nav.tenant.name'), value: tenant.name, required: true, maxLength: 80 },
            { name: 'description', label: navT('nav.tenant.description'), value: tenant.description || '', maxLength: 240, multiline: true }
        ],
        confirmText: navT('nav.dialog.save')
    });
    if (!values) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }, body: JSON.stringify(values) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return showNavbarNotice({ title: navT('nav.dialog.error'), message: data.error || `HTTP ${response.status}`, tone: 'error' });
    await renderTenantSettings(document.getElementById('navSettingsContent'));
};

window.archiveTenantInfo = async function (tenantId) {
    const tenant = navState.managedTenants.find(item => item.id === tenantId) || navState.tenants.find(item => item.id === tenantId);
    if (!tenant) return;
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('归档租户', 'Archive tenant'),
        message: navT('nav.tenant.archiveConfirm').replace('{name}', tenant.name),
        hint: navLocaleText('租户数据目录会完整保留，但该租户将无法继续进入。', 'The tenant data directory will be retained, but users will no longer be able to enter it.'),
        tone: 'danger',
        confirmText: navT('nav.tenant.archive')
    });
    if (!confirmed) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}`, { method: 'DELETE', headers: getAuthHeaderForNav() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return showNavbarNotice({ title: navT('nav.dialog.error'), message: data.error || `HTTP ${response.status}`, tone: 'error' });
    if (tenantId === navState.activeTenantId) {
        switchTenantBrowserState(tenantId, 'default');
        localStorage.setItem('tools_tenant_id', 'default');
        window.location.reload();
        return;
    }
    await renderTenantSettings(document.getElementById('navSettingsContent'));
};

window.restoreArchivedTenantInfo = async function (tenantId) {
    const tenant = navState.managedTenants.find(item => item.id === tenantId);
    if (!tenant) return;
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('恢复已归档租户', 'Restore archived tenant'),
        message: navT('nav.tenant.restoreConfirm').replace('{name}', displayTenantName(tenant)),
        hint: navLocaleText('恢复只会重新启用租户，不会覆盖或初始化原有数据。', 'Restore only re-enables the tenant; it does not overwrite or initialize existing data.'),
        confirmText: navT('nav.tenant.restore')
    });
    if (!confirmed) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/restore`, { method: 'POST', headers: getAuthHeaderForNav() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return showNavbarNotice({ title: navT('nav.dialog.error'), message: data.error || `HTTP ${response.status}`, tone: 'error' });
    await renderTenantSettings(document.getElementById('navSettingsContent'));
};

window.deleteTenantData = async function (tenantId) {
    const tenant = navState.managedTenants.find(item => item.id === tenantId);
    if (!tenant) return;
    const name = displayTenantName(tenant);
    const confirmed = await showNavbarTypedConfirm({
        title: navT('nav.tenant.deleteTitle'),
        message: navT('nav.tenant.deleteMessage').replace('{name}', name).replace('{id}', tenant.id),
        hint: navT('nav.tenant.deleteHint').replace('{id}', tenant.id),
        placeholder: navT('nav.tenant.deletePlaceholder').replace('{id}', tenant.id),
        requiredText: tenant.id,
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.tenant.delete')
    });
    if (!confirmed) return;
    const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/permanent`, { method: 'DELETE', headers: getAuthHeaderForNav() });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return showNavbarNotice({ title: navT('nav.dialog.error'), message: data.error || `HTTP ${response.status}`, tone: 'error' });
    localStorage.removeItem(`${TENANT_BROWSER_STATE_PREFIX}${tenantId}`);
    localStorage.removeItem(`${NAV_BOOTSTRAP_CACHE_KEY}:${tenantId}`);
    await renderTenantSettings(document.getElementById('navSettingsContent'));
    await showNavbarNotice({
        title: navLocaleText('删除完成', 'Deletion complete'),
        message: navT('nav.tenant.deleteDone').replace('{name}', name),
        tone: 'success'
    });
};

function setInitializationStatus(message, tone = '') {
    const element = document.getElementById('navInitializationStatus');
    if (!element) return;
    element.textContent = message || '';
    element.className = `nav-init-status ${tone}`.trim();
}

window.enableQuickStartMode = async function () {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.init.quickConfirmTitle'),
        message: navT('nav.init.quickConfirmMessage'),
        hint: navT('nav.init.quickConfirmHint'),
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.init.quickButton')
    });
    if (!confirmed) return;
    setInitializationStatus(navT('nav.init.quickRunning'));
    try {
        const response = await fetch('/api/onboarding/defaults/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ importScripts: true, importMetricRules: true })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const result = data.state?.result || {};
        const message = navT('nav.init.quickSuccess')
            .replace('{scripts}', result.scriptsAdded || 0)
            .replace('{rules}', (result.targetsAdded || 0) + (result.preferencesAdded || 0))
            .replace('{groups}', result.groupsAdded || 0);
        setInitializationStatus(message, 'success');
    } catch (error) {
        setInitializationStatus(navT('nav.init.failed') + error.message, 'error');
    }
};

window.factoryResetProgramData = async function () {
    const confirmed = await showNavbarTypedConfirm({
        title: navT('nav.init.resetConfirmTitle'),
        message: navT('nav.init.resetConfirmMessage'),
        hint: navT('nav.init.resetConfirmHint'),
        placeholder: navT('nav.init.resetPlaceholder'),
        requiredText: 'RESET',
        cancelText: navT('nav.set.restore.cancel'),
        confirmText: navT('nav.init.resetAction')
    });
    if (!confirmed) return;
    setInitializationStatus(navT('nav.init.resetRunning'));
    try {
        const response = await fetch('/api/onboarding/factory-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ confirmation: 'RESET' })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const successKey = data.needsRestart === false ? 'nav.init.resetSuccessNoRestart' : 'nav.init.resetSuccess';
        setInitializationStatus(navT(successKey).replace('{backup}', data.backup || '-'), 'success');
        localStorage.clear();
        sessionStorage.clear();
        if (data.needsRestart === false) setTimeout(() => { window.location.href = '/login.html'; }, 900);
    } catch (error) {
        setInitializationStatus(navT('nav.init.failed') + error.message, 'error');
    }
};

function customToolBackupText(key, values = {}) {
    let text = navT(key);
    Object.entries(values).forEach(([name, value]) => {
        text = text.replaceAll(`{${name}}`, String(value));
    });
    return text;
}

function customToolDependencyBadges(tool) {
    const dependencies = tool.dependencies || {};
    const badges = [
        `<span class="nav-custom-backup-badge files">${navEscape(customToolBackupText('nav.ctbk.files', { count: tool.fileCount || 0 }))}</span>`,
        `<span class="nav-custom-backup-badge state">${navEscape(navT('nav.ctbk.serverState'))}</span>`
    ];
    const mappings = [
        ['localStorageKeys', 'nav.ctbk.localState', 'local'],
        ['platformApiPaths', 'nav.ctbk.apiDeps', 'api'],
        ['externalUrls', 'nav.ctbk.externalDeps', 'external'],
        ['indexedDbNames', 'nav.ctbk.indexedDb', 'warning']
    ];
    mappings.forEach(([field, key, tone]) => {
        const count = Array.isArray(dependencies[field]) ? dependencies[field].length : 0;
        if (count) badges.push(`<span class="nav-custom-backup-badge ${tone}">${navEscape(customToolBackupText(key, { count }))}</span>`);
    });
    return badges.join('');
}

function updateCustomToolBackupSelectionSummary() {
    const boxes = Array.from(document.querySelectorAll('[data-custom-backup-slug]'));
    const selected = boxes.filter(box => box.checked).length;
    const summary = document.getElementById('customToolBackupSelectionSummary');
    if (summary) summary.textContent = customToolBackupText('nav.ctbk.selected', { selected, total: boxes.length });
}

async function renderCustomToolBackupSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ctbk.loading'))}</div>`;
    try {
        const res = await fetch('/api/custom-tools/backup/summary', { headers: getAuthHeaderForNav() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        navState.customToolBackupSummary = data;
        const tools = Array.isArray(data.tools) ? data.tools : [];
        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.ctbk.help'))}</div>
            <div class="nav-custom-backup-portability">
                <div class="nav-custom-backup-portability-icon">🧭</div>
                <div><strong>${navEscape(navT('nav.ctbk.portabilityTitle'))}</strong><p>${navEscape(navT('nav.ctbk.portability'))}</p></div>
            </div>
            <section class="nav-custom-backup-card">
                <div class="nav-custom-backup-head">
                    <div><div class="nav-backup-panel-title">${navEscape(navT('nav.ctbk.exportTitle'))}</div><div class="nav-backup-panel-desc">${navEscape(navT('nav.ctbk.exportDesc'))}</div></div>
                    <div id="customToolBackupSelectionSummary" class="nav-custom-backup-selection"></div>
                </div>
                <div class="nav-custom-backup-list">
                    ${tools.map(tool => `
                        <label class="nav-custom-backup-tool">
                            <input type="checkbox" data-custom-backup-slug="${navEscape(tool.slug)}" checked onchange="updateCustomToolBackupSelectionSummary()">
                            <span class="nav-custom-backup-tool-icon">${navEscape(tool.icon || '🧩')}</span>
                            <span class="nav-custom-backup-tool-main">
                                <strong>${navEscape(tool.name || tool.slug)}</strong>
                                <code>${navEscape(tool.slug)}</code>
                                <span class="nav-custom-backup-badges">${customToolDependencyBadges(tool)}</span>
                            </span>
                            <span class="nav-custom-backup-size">${navEscape(formatBackupSize(tool.totalBytes || 0))}</span>
                        </label>
                    `).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.ctbk.empty'))}</div>`}
                </div>
                ${tools.length ? `<div class="nav-backup-toolbar nav-custom-backup-actions">
                    <button type="button" onclick="setAllCustomToolBackupSelections(true)">${navEscape(navT('nav.ctbk.btnAll'))}</button>
                    <button type="button" onclick="setAllCustomToolBackupSelections(false)">${navEscape(navT('nav.ctbk.btnNone'))}</button>
                    <button type="button" class="primary" onclick="exportCustomToolBackup()">${navEscape(navT('nav.ctbk.btnExport'))}</button>
                </div>` : ''}
            </section>
            <section class="nav-custom-backup-card restore">
                <div><div class="nav-backup-panel-title">${navEscape(navT('nav.ctbk.restoreTitle'))}</div><div class="nav-backup-panel-desc">${navEscape(navT('nav.ctbk.restoreDesc'))}</div></div>
                <div class="nav-custom-backup-restore-row">
                    <input id="customToolBackupRestoreInput" type="file" accept=".zip,application/zip">
                    <select id="customToolBackupConflictStrategy" class="nav-settings-input">
                        <option value="replace">${navEscape(navT('nav.ctbk.strategyReplace'))}</option>
                        <option value="skip">${navEscape(navT('nav.ctbk.strategySkip'))}</option>
                    </select>
                    <button type="button" class="danger" onclick="restoreCustomToolBackup()">${navEscape(navT('nav.ctbk.btnRestore'))}</button>
                </div>
            </section>
        `;
        updateCustomToolBackupSelectionSummary();
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.ctbk.fail'))}${navEscape(e.message)}</div>`;
    }
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

async function renderMediaSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">正在加载媒体资源库...</div>`;
    try {
        const [overviewRes, videosRes] = await Promise.all([
            fetch('/api/media/admin/overview', { headers: getAuthHeaderForNav() }),
            fetch('/api/media/admin/videos', { headers: getAuthHeaderForNav() })
        ]);

        if (!overviewRes.ok || !videosRes.ok) {
            throw new Error(`无法获取媒体资源数据 (HTTP ${overviewRes.status}/${videosRes.status})`);
        }

        const overview = await overviewRes.json();
        const videosData = await videosRes.json();
        navState.mediaOverviewCache = overview;
        navState.mediaVideosCache = videosData.data || [];
        navState.mediaCategoriesCache = videosData.categories || [];

        renderMediaSettingsHtml(content, overview, navState.mediaVideosCache, navState.mediaCategoriesCache);
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty" style="color:#ef4444;">加载媒体资源管理失败：${navEscape(e.message)}</div>`;
    }
}

function renderMediaSettingsHtml(content, overview, videos, categories) {
    const managedCategories = categories.filter(category => category.id !== 'all');
    const categoryCount = category => videos.filter(video => {
        if (category.folder) return video.folder === category.folder || video.category === category.id;
        return video.category === category.id;
    }).length;

    const activeFilter = navState.mediaCategoryFilter || 'all';
    const query = (navState.mediaSearchQuery || '').trim().toLowerCase();
    const feiniu = overview.feiniu || {
        url: 'https://feiniu.fanxiaolong.uk/v',
        username: 'admin',
        hasPassword: true,
        enabled: true,
        serverName: '雪花肥牛',
        connected: false,
        totalVideos: 0,
        lastError: ''
    };

    let filteredVideos = videos;
    if (activeFilter !== 'all') {
        filteredVideos = filteredVideos.filter(v => (v.folder || '') === activeFilter || v.category === activeFilter);
    }
    if (query) {
        filteredVideos = filteredVideos.filter(v =>
            (v.title && v.title.toLowerCase().includes(query)) ||
            (v.fileName && v.fileName.toLowerCase().includes(query)) ||
            (v.tags && v.tags.some(t => t.toLowerCase().includes(query)))
        );
    }

    content.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:16px;">
            <!-- 资产总体概况卡片 -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px, 1fr)); gap:12px;">
                <div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:#64748b; margin-bottom:4px;">🎬 视频资产总数</div>
                    <div style="font-size:22px; font-weight:800; color:#0f172a;">${overview.totalVideos} <span style="font-size:12px; font-weight:500; color:#64748b;">部</span></div>
                </div>
                <div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:#64748b; margin-bottom:4px;">📁 分类文件夹</div>
                    <div style="font-size:22px; font-weight:800; color:#0f172a;">${overview.totalCategories} <span style="font-size:12px; font-weight:500; color:#64748b;">个</span></div>
                </div>
                <div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:#64748b; margin-bottom:4px;">💾 媒体库占用</div>
                    <div style="font-size:22px; font-weight:800; color:#6366f1;">${overview.totalSizeFormatted}</div>
                </div>
                <div style="background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                    <div style="font-size:12px; color:#64748b; margin-bottom:4px;">💽 磁盘可用空间</div>
                    <div style="font-size:22px; font-weight:800; color:#10b981;">${overview.disk.freeGb} <span style="font-size:12px; font-weight:500; color:#64748b;">GB 可用</span></div>
                </div>
            </div>

            <!-- 飞牛影视远程对接配置卡片 -->
            <div style="background:linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%); border:1px solid #bfdbfe; border-radius:12px; padding:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="font-size:15px; font-weight:800; color:#0f172a;">☁️ 飞牛影视对接</span>
                        ${feiniu.connected
                            ? `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:#dcfce7; color:#15803d; font-size:12px; font-weight:600;">● 已连接「${navEscape(feiniu.serverName || '飞牛影视')}」· 同步 ${Number(feiniu.totalVideos) || 0} 部视频</span>`
                            : (!feiniu.enabled
                                ? `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:#e2e8f0; color:#475569; font-size:12px; font-weight:600;">⏸️ 已暂停对接</span>`
                                : `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; background:#fef3c7; color:#b45309; font-size:12px; font-weight:600;">⚠️ 未连接${feiniu.lastError ? '：' + navEscape(feiniu.lastError) : ''}</span>`
                            )
                        }
                    </div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <label style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:#334155; cursor:pointer;">
                            <input type="checkbox" id="feiniuEnabledInput" ${feiniu.enabled !== false ? 'checked' : ''} style="width:15px; height:15px; accent-color:#2563eb;">
                            <span>启用飞牛片源接入</span>
                        </label>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:minmax(220px, 1.8fr) minmax(130px, 1fr) minmax(130px, 1fr) auto; gap:10px; align-items:end;">
                    <label style="display:block; font-size:12px; font-weight:600; color:#334155;">
                        对接链接
                        <input type="url" id="feiniuUrlInput" value="${navEscape(feiniu.url || 'https://feiniu.fanxiaolong.uk/v')}" placeholder="https://feiniu.fanxiaolong.uk/v" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; color:#0f172a; background:#fff;">
                    </label>
                    <label style="display:block; font-size:12px; font-weight:600; color:#334155;">
                        账号
                        <input type="text" id="feiniuUsernameInput" value="${navEscape(feiniu.username || 'admin')}" placeholder="输入飞牛账号" autocomplete="username" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; color:#0f172a; background:#fff;">
                    </label>
                    <label style="display:block; font-size:12px; font-weight:600; color:#334155;">
                        密码
                        <input type="password" id="feiniuPasswordInput" value="${feiniu.hasPassword ? '********' : ''}" placeholder="输入飞牛密码" autocomplete="current-password" style="display:block; width:100%; box-sizing:border-box; margin-top:4px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; color:#0f172a; background:#fff;">
                    </label>
                    <div style="display:flex; gap:8px;">
                        <button type="button" onclick="saveFeiniuMediaConfig(this)" style="height:36px; padding:0 14px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap;">
                            🔗 保存并对接
                        </button>
                        <button type="button" onclick="syncFeiniuMediaCatalog(this)" style="height:36px; padding:0 12px; background:#fff; color:#1e40af; border:1px solid #93c5fd; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;" title="立即从飞牛影视同步影片列表">
                            🔄 同步片库
                        </button>
                    </div>
                </div>
            </div>

            <!-- 操作工具条 -->
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:12px; background:#fff; border:1px solid #e2e8f0; border-radius:10px;">
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button type="button" class="sys-btn" onclick="openCreateMediaFolderModal()" style="background:#6366f1; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                        <span>+</span> 新建分类文件夹
                    </button>
                    <button type="button" class="sys-btn" onclick="openImportLocalMediaModal()" style="background:#0ea5e9; color:#fff; border:none; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:4px;">
                        <span>📥</span> 本地目录一键导入
                    </button>
                    <a href="/cinema" target="_blank" style="text-decoration:none; background:#f8fafc; color:#334155; border:1px solid #cbd5e1; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
                        <span>🎬</span> 预览点播大厅 ↗
                    </a>
                </div>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button type="button" onclick="renderMediaSettings(document.getElementById('navSettingsContent'))" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:6px; padding:6px 10px; font-size:12px; cursor:pointer;" title="重新扫描磁盘视频">
                        🔄 刷新
                    </button>
                </div>
            </div>

            <!-- 分类切换与实时筛选 -->
            <div class="nav-media-filter-row">
                <div class="nav-media-category-tabs" aria-label="${navEscape(navT('nav.media.categoryFilter'))}">
                    <button type="button" class="tab-item" onclick="switchMediaCategoryFilter('all')" style="border-radius:20px; padding:4px 14px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid ${activeFilter === 'all' ? '#6366f1' : '#cbd5e1'}; background:${activeFilter === 'all' ? '#6366f1' : '#fff'}; color:${activeFilter === 'all' ? '#fff' : '#475569'};">
                        全部 (${videos.length})
                    </button>
                    ${managedCategories.map(c => {
        const filterValue = c.folder || c.id;
        const cnt = categoryCount(c);
        const isAct = activeFilter === filterValue;
        return `
                            <button type="button" class="tab-item" onclick="switchMediaCategoryFilter('${navEscape(filterValue)}')" style="border-radius:20px; padding:4px 14px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid ${isAct ? '#6366f1' : '#cbd5e1'}; background:${isAct ? '#6366f1' : '#fff'}; color:${isAct ? '#fff' : '#475569'}; display:inline-flex; align-items:center; gap:4px;">
                                <span>${c.icon || '📁'}</span> ${navEscape(c.name || filterValue || '独家影院')} (${cnt})
                            </button>
                        `;
    }).join('')}
                </div>
                <label class="nav-media-search">
                    <span aria-hidden="true">🔍</span>
                    <input type="search" id="mediaSearchInput" value="${navEscape(navState.mediaSearchQuery)}" placeholder="搜索片名、文件名或标签..." oninput="handleMediaSearchInput(this.value)" aria-label="${navEscape(navT('nav.media.searchLabel'))}">
                </label>
            </div>

            <!-- 视频表格管理区 -->
            <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
                <div class="nav-media-table-scroll">
                    <table class="nav-media-table">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#64748b; font-weight:600;">
                                <th style="padding:10px 12px; width:70px;">封面</th>
                                <th style="padding:10px 12px;">片名 & 文件名</th>
                                <th style="padding:10px 12px; width:130px;">所属分类</th>
                                <th style="padding:10px 12px; width:100px;">大小规格</th>
                                <th style="padding:10px 12px; width:248px; text-align:center;">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filteredVideos.length === 0 ? `
                                <tr>
                                    <td colspan="5" style="padding:40px; text-align:center; color:#94a3b8;">未找到匹配的视频媒体文件</td>
                                </tr>
                            ` : filteredVideos.map(item => `
                                <tr style="border-bottom:1px solid #f1f5f9; transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                                    <td style="padding:8px 12px;">
                                        <div onclick="previewMediaVideo('${navEscape(item.src)}', '${navEscape(item.title)}')" style="width:64px; height:40px; border-radius:4px; overflow:hidden; position:relative; cursor:pointer; background:#000;">
                                            <img src="${item.poster || '/assets/videos/龙餐馆_poster.jpg'}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">
                                            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.3); opacity:0; transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0'">
                                                <span style="color:#fff; font-size:14px;">▶</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td style="padding:8px 12px;">
                                        <div style="font-weight:600; color:#0f172a; margin-bottom:2px; display:flex; align-items:center; gap:6px;" title="${navEscape(item.title)}">
                                            <span>${navEscape(item.title)}</span>
                                            ${item.source === 'feiniu' ? `<span style="padding:1px 6px; border-radius:999px; background:#dbeafe; color:#1d4ed8; font-size:10px; font-weight:700;">☁️ 飞牛</span>` : ''}
                                        </div>
                                        <div class="nav-media-item-meta">
                                            <span class="nav-media-file-name">${navEscape(item.fileName)}</span>
                                            <label class="nav-media-priority" title="数字越小，在影视作品展播中越靠前">
                                                <span>优先级</span>
                                                <input type="number" step="1" value="${Number.isSafeInteger(item.order) ? item.order : 1000}" onchange="setMediaPriority('${navEscape(item.id)}', this.value, this)" aria-label="${navEscape(item.title)} 展播优先级">
                                            </label>
                                        </div>
                                    </td>
                                    <td style="padding:8px 12px;">
                                        <span style="display:inline-block; padding:2px 8px; border-radius:12px; background:#eff6ff; color:#2563eb; font-size:11px; font-weight:500;">
                                            ${navEscape(item.categoryName || item.folder || '独家影院')}
                                        </span>
                                    </td>
                                    <td style="padding:8px 12px;">
                                        <div style="font-weight:500; color:#334155;">${navEscape(item.fileSizeFormatted)}</div>
                                        <div style="font-size:11px; color:#94a3b8;">${navEscape(item.format)} · ${navEscape(item.resolution || 'HD')}</div>
                                    </td>
                                    <td style="padding:8px 12px; text-align:center;">
                                        <div class="nav-media-row-actions">
                                            <button type="button" class="nav-media-action" onclick="previewMediaVideo('${navEscape(item.src)}', '${navEscape(item.title)}')" title="在线预览播放">
                                                👁️ 预览
                                            </button>
                                            <button type="button" class="nav-media-action" onclick="openEditMediaModal('${navEscape(item.id)}')" title="修改标题、分类与简介">
                                                ✏️ 编辑
                                            </button>
                                            ${item.source === 'feiniu' ? `
                                                <span style="font-size:11px; color:#64748b; padding:0 6px;" title="飞牛远程流媒体">☁️ 远程源</span>
                                            ` : `
                                                <button type="button" class="nav-media-action" onclick="extractMediaPoster('${navEscape(item.id)}')" title="重新截取高清封面帧">
                                                    🖼️ 抽帧
                                                </button>
                                                <button type="button" class="nav-media-action danger" onclick="deleteMediaVideo('${navEscape(item.id)}', '${navEscape(item.title)}')" title="彻底删除该视频" aria-label="删除 ${navEscape(item.title)}">
                                                    🗑️
                                                </button>
                                            `}
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- 分类文件夹管理卡片 -->
            <div style="background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:14px;">
                <div style="font-size:13px; font-weight:700; color:#0f172a; margin-bottom:10px;">📁 现有分类文件夹列表</div>
                <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px;">
                    ${managedCategories.map(cat => {
        const f = cat.folder || '';
        const isFeiniuCat = cat.source === 'feiniu' || String(cat.id || '').startsWith('feiniu-');
        const isSystem = !f || f === 'film' || isFeiniuCat;
        const cnt = categoryCount(cat);
        return `
                            <div style="border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; background:#f8fafc;">
                                <div>
                                    <div style="font-weight:600; font-size:13px; color:#0f172a;">${cat.icon || '📁'} ${navEscape(cat.name || f || '独家影院')}</div>
                                    <div style="font-size:11px; color:#64748b; margin-top:2px;">目录: ${f ? navEscape(f) : '根目录'} · ${cnt} 部视频</div>
                                    <label class="nav-media-priority" title="数字越小，分类越靠前" style="margin-top:6px;">
                                        <span>分类优先级</span>
                                        <input type="number" step="1" value="${Number.isSafeInteger(cat.order) ? cat.order : 0}" onchange="setMediaCategoryPriority('${navEscape(cat.id)}', this.value, this)" aria-label="${navEscape(cat.name || f)} 分类优先级">
                                    </label>
                                </div>
                                <div style="display:flex; gap:4px;">
                                    ${!isFeiniuCat ? `
                                        <button type="button" onclick="openEditMediaCategoryModal('${navEscape(cat.id)}')" style="border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:600;cursor:pointer;" title="设置分类访问保护">
                                            ${cat.protected ? '🔒 PIN' : '设置'}
                                        </button>
                                    ` : ''}
                                    ${!isSystem ? `
                                        <button type="button" onclick="deleteMediaFolder('${navEscape(f)}')" style="border:1px solid #fecaca; background:#fff; color:#ef4444; border-radius:6px; padding:3px 9px; font-size:11px; font-weight:600; cursor:pointer; transition:all .15s ease;" onmouseover="this.style.background='#fef2f2';this.style.borderColor='#f87171'" onmouseout="this.style.background='#fff';this.style.borderColor='#fecaca'" title="删除分类">
                                            删除
                                        </button>
                                    ` : `<span style="font-size:11px; color:#94a3b8;">${isFeiniuCat ? '飞牛媒体库' : '系统内置'}</span>`}
                                </div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        </div>
    `;
}

// 保存并对接飞牛影视配置
window.saveFeiniuMediaConfig = async function (btn) {
    const urlInput = document.getElementById('feiniuUrlInput');
    const usernameInput = document.getElementById('feiniuUsernameInput');
    const passwordInput = document.getElementById('feiniuPasswordInput');
    const enabledInput = document.getElementById('feiniuEnabledInput');

    const url = (urlInput?.value || 'https://feiniu.fanxiaolong.uk/v').trim() || 'https://feiniu.fanxiaolong.uk/v';
    const username = (usernameInput?.value || 'admin').trim() || 'admin';
    const password = passwordInput?.value || '';
    const enabled = enabledInput ? Boolean(enabledInput.checked) : true;

    const origText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在对接...';
    }
    try {
        const res = await fetch('/api/media/admin/feiniu/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ url, username, password, enabled })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        await renderMediaSettings(document.getElementById('navSettingsContent'));
        showNavbarNotice({
            title: '飞牛影视对接成功',
            message: data.message || '飞牛影视配置已保存并完成影片同步。',
            tone: 'success'
        });
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origText || '🔗 保存并对接';
        }
        showNavbarNotice({
            title: '飞牛影视对接失败',
            message: error.message || '请检查飞牛影视地址、账号与密码是否正确。',
            tone: 'error'
        });
    }
};

// 手动立即同步飞牛影视片库
window.syncFeiniuMediaCatalog = async function (btn) {
    const origText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 同步中...';
    }
    try {
        const res = await fetch('/api/media/admin/feiniu/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        await renderMediaSettings(document.getElementById('navSettingsContent'));
        showNavbarNotice({
            title: '飞牛片库已同步',
            message: data.message || '已同步最新飞牛影视列表。',
            tone: 'success'
        });
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = origText || '🔄 同步片库';
        }
        showNavbarNotice({
            title: '同步失败',
            message: error.message || '无法从飞牛影视拉取最新列表。',
            tone: 'error'
        });
    }
};

// 客户端即时筛选分类
window.switchMediaCategoryFilter = function (category) {
    navState.mediaCategoryFilter = category;
    const content = document.getElementById('navSettingsContent');
    if (content && navState.mediaOverviewCache) {
        renderMediaSettingsHtml(content, navState.mediaOverviewCache, navState.mediaVideosCache, navState.mediaCategoriesCache);
    }
};

// 客户端即时搜索
window.handleMediaSearchInput = function (val) {
    navState.mediaSearchQuery = val;
    clearTimeout(navState.mediaSearchTimer);
    navState.mediaSearchTimer = setTimeout(() => {
        const content = document.getElementById('navSettingsContent');
        if (!content || !navState.mediaOverviewCache) return;
        renderMediaSettingsHtml(content, navState.mediaOverviewCache, navState.mediaVideosCache, navState.mediaCategoriesCache);
        const input = document.getElementById('mediaSearchInput');
        if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }
    }, 180);
};

window.setMediaPriority = async function (videoId, value, input) {
    const order = Number(value);
    if (!Number.isSafeInteger(order)) {
        showNavbarNotice({
            title: '输入提示',
            message: '优先级请输入整数；数字越小，展播顺序越靠前。',
            tone: 'info'
        });
        return;
    }
    if (input) input.disabled = true;
    try {
        const response = await fetch(`/api/media/admin/videos/${encodeURIComponent(videoId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ order })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        await renderMediaSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (input) input.disabled = false;
        showNavbarNotice({
            title: '保存失败',
            message: `优先级保存失败：${error.message}`,
            tone: 'error'
        });
    }
};

// 播放预览弹窗
window.previewMediaVideo = function (src, title) {
    let modal = document.getElementById('mediaPreviewModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'mediaPreviewModal';
        modal.className = 'nav-media-preview-modal';
        modal.addEventListener('click', event => {
            if (event.target === modal) closeMediaPreview();
        });
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <div class="nav-media-preview-dialog" role="dialog" aria-modal="true" aria-label="播放预览：${navEscape(title)}">
            <div class="nav-media-preview-head">
                <div class="nav-media-preview-title">🎬 播放预览：${navEscape(title)}</div>
                <button type="button" class="nav-media-preview-back" onclick="closeMediaPreview()">← ${navEscape(navT('nav.media.previewBack'))}</button>
            </div>
            <div class="nav-media-preview-player">
                <video id="previewVideoEl" src="${navEscape(src)}" controls autoplay playsinline></video>
            </div>
        </div>
    `;
    modal.style.display = 'flex';
    modal.querySelector('.nav-media-preview-back')?.focus();
};

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

// 媒体分类与设备文件导入
function openMediaForm(importing) {
    document.getElementById('mediaFormDialog')?.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'mediaFormDialog';
    if (importing) dialog.classList.add('is-importing');
    dialog.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;width:min(${importing ? '650px' : '520px'},calc(100vw - 32px));max-height:85vh;padding:26px 28px;border:1px solid rgba(148,163,184,0.35);border-radius:18px;background:#ffffff;color:#172033;box-shadow:0 28px 80px rgba(15,23,42,0.28);overflow:auto;z-index:100005;`;
    dialog.innerHTML = `
        <form method="dialog" style="margin:0;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <h2 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;">${importing ? '📥 导入媒体' : '📁 新建分类'}</h2>
                <button type="button" id="mediaFormCloseX" title="关闭" style="border:none;background:none;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer;padding:4px 6px;border-radius:6px;transition:all .15s ease;">×</button>
            </div>
            <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0 0 16px;">${importing ? '从此设备选择文件夹或多个视频，上传至指定分类。同名文件会自动重命名。' : '为视频创建一个分类，例如：经典纪录片、少儿动画。'}</p>
            <label style="display:block;font-size:13px;font-weight:600;color:#1e293b;margin-bottom:6px;">分类名称
                <input id="mediaFormName" required maxlength="80" placeholder="输入分类名称" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 16px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;color:#0f172a;outline:none;background:#fff;">
            </label>
            ${!importing ? `
                <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#1e293b;margin:0 0 10px;">
                    <input id="mediaFormProtected" type="checkbox" style="width:16px;height:16px;accent-color:#6366f1;">
                    🔒 设为 PIN 保护分类
                </label>
                <label id="mediaFormPinWrap" style="display:none;font-size:13px;font-weight:600;color:#1e293b;margin-bottom:12px;">4 位 PIN
                    <input id="mediaFormPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" placeholder="输入 4 位数字" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 4px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;color:#0f172a;outline:none;background:#fff;">
                    <span style="font-size:11px;font-weight:400;color:#64748b;">分类名称会显示，内容需验证 PIN 后才会加载。</span>
                </label>
            ` : ''}
            ${importing ? `
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
                    <button type="button" class="nav-media-action" id="mediaChooseFolder" style="height:34px;padding:0 12px;font-size:12px;">📂 选择文件夹</button>
                    <button type="button" class="nav-media-action" id="mediaChooseFiles" style="height:34px;padding:0 12px;font-size:12px;">🎬 选择视频</button>
                    <input hidden type="file" id="mediaFolderFiles" webkitdirectory multiple>
                    <input hidden type="file" id="mediaVideoFiles" accept=".mp4,.webm,.mkv,.mov,.m4v" multiple>
                </div>
                <p id="mediaFileSummary" style="font-size:12px;color:#64748b;margin-bottom:8px;">尚未选择文件 · 支持 MP4 / WebM / MKV / MOV / M4V</p>

                <!-- 实时上传进度与详情日志看板 -->
                <div id="mediaUploadDashboard" class="nav-media-dashboard" style="display:none;">
                    <!-- 总进度卡片 -->
                    <div class="nav-media-progress-card">
                        <div class="nav-media-progress-header">
                            <span id="mediaOverallTitle">总进度：等待开始...</span>
                            <span class="nav-media-progress-pct" id="mediaOverallPct">0%</span>
                        </div>
                        <div class="nav-media-progress-track">
                            <div class="nav-media-progress-bar" id="mediaOverallBar" style="width:0%;"></div>
                        </div>
                        <div class="nav-media-progress-meta">
                            <span id="mediaOverallSize">0 MB / 0 MB</span>
                            <span id="mediaOverallSpeed">-- MB/s</span>
                            <span id="mediaOverallEta">剩余时间: --</span>
                        </div>
                    </div>

                    <!-- 当前文件卡片 -->
                    <div class="nav-media-current-card" id="mediaCurrentCard">
                        <div class="nav-media-current-header">
                            <span class="nav-media-current-name" id="mediaCurrentName">当前文件：就绪</span>
                            <span class="nav-media-current-pct" id="mediaCurrentPct">0%</span>
                        </div>
                        <div class="nav-media-current-track">
                            <div class="nav-media-current-bar" id="mediaCurrentBar" style="width:0%;"></div>
                        </div>
                    </div>

                    <!-- 文件队列清单 -->
                    <div class="nav-media-file-queue" id="mediaFileQueue"></div>

                    <!-- 实时详情日志窗口 -->
                    <div class="nav-media-log-wrap">
                        <div class="nav-media-log-header">
                            <span class="nav-media-log-title"><span class="nav-media-log-dot" id="mediaLogDot"></span> 实时详情日志</span>
                            <span class="nav-media-log-badge" id="mediaLogCount">0 条记录</span>
                        </div>
                        <div class="nav-media-log-terminal" id="mediaLogTerminal" role="log" aria-live="polite"></div>
                    </div>
                </div>
            ` : ''}
            <p id="mediaFormStatus" role="status" style="font-size:13px;line-height:1.6;white-space:pre-wrap;margin:0;"></p>
            <div style="display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:20px;">
                <button type="button" class="nav-media-dialog-btn secondary" id="mediaFormCancel">关闭</button>
                <button type="submit" class="nav-media-dialog-btn primary" id="mediaFormSubmit">${importing ? '开始上传' : '创建分类'}</button>
            </div>
        </form>`;
    document.body.appendChild(dialog);

    let files = [], busy = false;
    const name = dialog.querySelector('#mediaFormName');
    const status = dialog.querySelector('#mediaFormStatus');
    const submit = dialog.querySelector('#mediaFormSubmit');
    const cancel = dialog.querySelector('#mediaFormCancel');
    const closeBtn = dialog.querySelector('#mediaFormCloseX');
    const protectedInput = dialog.querySelector('#mediaFormProtected');
    const pinInput = dialog.querySelector('#mediaFormPin');
    const pinWrap = dialog.querySelector('#mediaFormPinWrap');

    if (protectedInput && pinInput && pinWrap) {
        protectedInput.onchange = () => {
            pinWrap.style.display = protectedInput.checked ? 'block' : 'none';
            pinInput.required = protectedInput.checked;
            if (protectedInput.checked) pinInput.focus();
            else pinInput.value = '';
        };
    }

    if (closeBtn) {
        closeBtn.onmouseover = () => { closeBtn.style.color = '#334155'; closeBtn.style.background = '#f1f5f9'; };
        closeBtn.onmouseout = () => { closeBtn.style.color = '#94a3b8'; closeBtn.style.background = 'none'; };
    }

    const forceClose = () => {
        busy = false;
        try { dialog.close(); } catch (_) { }
        dialog.remove();
        document.querySelectorAll('#mediaFormDialog').forEach(el => el.remove());
    };
    const close = () => {
        if (!busy) {
            forceClose();
        }
    };
    cancel.onclick = close;
    closeBtn?.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => {
        const rect = dialog.getBoundingClientRect();
        const isInDialog = (
            rect.top <= event.clientY && event.clientY <= rect.top + rect.height &&
            rect.left <= event.clientX && event.clientX <= rect.left + rect.width
        );
        if (!isInDialog) close();
    });

    const formatMediaBytes = bytes => {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return bytes + ' B';
    };

    const formatMediaEta = seconds => {
        if (!Number.isFinite(seconds) || seconds <= 0) return '即将完成';
        if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
        const m = Math.floor(seconds / 60);
        const s = Math.ceil(seconds % 60);
        return `${m} 分 ${s} 秒`;
    };

    let logCount = 0;
    const addMediaLog = (msg, type = 'info') => {
        const term = dialog.querySelector('#mediaLogTerminal');
        const badge = dialog.querySelector('#mediaLogCount');
        if (!term) return;
        const time = new Date().toTimeString().slice(0, 8);
        const line = document.createElement('div');
        line.className = `nav-media-log-line ${type}`;
        line.innerHTML = `<span class="nav-media-log-time">[${time}]</span><span class="nav-media-log-text">${navEscape(msg)}</span>`;
        term.appendChild(line);
        term.scrollTop = term.scrollHeight;
        logCount++;
        if (badge) badge.textContent = `${logCount} 条记录`;
    };

    if (importing) {
        const dashboard = dialog.querySelector('#mediaUploadDashboard');
        const queueEl = dialog.querySelector('#mediaFileQueue');
        const summaryEl = dialog.querySelector('#mediaFileSummary');
        const overallSizeEl = dialog.querySelector('#mediaOverallSize');

        const selectFiles = event => {
            files = Array.from(event.target.files).filter(file => /\.(mp4|webm|mkv|mov|m4v)$/i.test(file.name));
            if (!files.length) {
                summaryEl.textContent = '未选定有效的视频文件（支持 MP4 / WebM / MKV / MOV / M4V）';
                if (dashboard) dashboard.style.display = 'none';
                return;
            }
            const folder = files[0]?.webkitRelativePath?.split('/')[0];
            if (!name.value && folder) name.value = folder;

            const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
            summaryEl.textContent = `已选择 ${files.length} 个视频 · 共 ${formatMediaBytes(totalBytes)}`;
            if (overallSizeEl) overallSizeEl.textContent = `0 B / ${formatMediaBytes(totalBytes)}`;

            if (queueEl) {
                queueEl.innerHTML = files.map((file, idx) => `
                    <div class="nav-media-queue-item" id="mediaQueueItem_${idx}">
                        <div class="nav-media-queue-name" title="${navEscape(file.name)}">
                            <span>🎬</span>
                            <span>${navEscape(file.name)}</span>
                        </div>
                        <div class="nav-media-queue-meta">
                            <span>${formatMediaBytes(file.size)}</span>
                            <span class="nav-media-queue-status waiting" id="mediaQueueStatus_${idx}">⏳ 待上传</span>
                        </div>
                    </div>
                `).join('');
            }
            if (dashboard) dashboard.style.display = 'flex';
            addMediaLog(`已扫描并选定 ${files.length} 个媒体文件，总计 ${formatMediaBytes(totalBytes)}。准备就绪。`, 'info');
        };

        dialog.querySelector('#mediaFolderFiles').onchange = selectFiles;
        dialog.querySelector('#mediaVideoFiles').onchange = selectFiles;
        dialog.querySelector('#mediaChooseFolder').onclick = () => dialog.querySelector('#mediaFolderFiles').click();
        dialog.querySelector('#mediaChooseFiles').onclick = () => dialog.querySelector('#mediaVideoFiles').click();
    }

    dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        if (importing && !files.length) {
            status.style.color = '#dc2626';
            status.textContent = '请先选择视频文件或文件夹。';
            return;
        }
        busy = true;
        dialog.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
        try {
            if (!importing) {
                const folderName = name.value.trim();
                const response = await fetch('/api/media/admin/folders', {
                    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
                    body: JSON.stringify({
                        name: folderName,
                        icon: '📁',
                        protected: Boolean(protectedInput?.checked),
                        pin: pinInput?.value || ''
                    })
                });
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.error || '创建失败');

                forceClose();
                await renderMediaSettings(document.getElementById('navSettingsContent'));
                showNavbarNotice({
                    title: '分类创建成功',
                    message: `已成功创建分类“${folderName}”。`,
                    tone: 'success'
                });
                return;
            } else {
                const folderName = name.value.trim() || '未分类';
                const totalFiles = files.length;
                const totalBytes = files.reduce((s, f) => s + f.size, 0);
                let completedFiles = 0;
                let failedFiles = 0;
                let completedBytesBefore = 0;

                const overallTitle = dialog.querySelector('#mediaOverallTitle');
                const overallPct = dialog.querySelector('#mediaOverallPct');
                const overallBar = dialog.querySelector('#mediaOverallBar');
                const overallSize = dialog.querySelector('#mediaOverallSize');
                const overallSpeed = dialog.querySelector('#mediaOverallSpeed');
                const overallEta = dialog.querySelector('#mediaOverallEta');
                const currentName = dialog.querySelector('#mediaCurrentName');
                const currentPct = dialog.querySelector('#mediaCurrentPct');
                const currentBar = dialog.querySelector('#mediaCurrentBar');
                const logDot = dialog.querySelector('#mediaLogDot');

                if (logDot) logDot.classList.add('busy');
                submit.textContent = '正在上传中...';

                addMediaLog(`🚀 开始批量上传：共 ${totalFiles} 个文件，目标分类：“${folderName}”`, 'start');

                let speedWindowBytes = 0;
                let speedWindowTime = Date.now();
                let currentSpeed = 0;

                for (let i = 0; i < totalFiles; i++) {
                    const file = files[i];
                    const queueStatus = dialog.querySelector(`#mediaQueueStatus_${i}`);
                    if (queueStatus) {
                        queueStatus.className = 'nav-media-queue-status uploading';
                        queueStatus.textContent = '⚡ 上传中 0%';
                    }
                    if (currentName) currentName.textContent = `当前文件 [${i + 1}/${totalFiles}]：${file.name}`;
                    if (currentPct) currentPct.textContent = '0%';
                    if (currentBar) currentBar.style.width = '0%';

                    addMediaLog(`[${i + 1}/${totalFiles}] 开始传输：${file.name} (${formatMediaBytes(file.size)})`, 'start');
                    const fileStartTime = Date.now();
                    let lastLoggedMilestone = 0;

                    try {
                        const result = await new Promise((resolve, reject) => {
                            const xhr = new XMLHttpRequest();
                            xhr.open('POST', '/api/media/admin/upload');
                            Object.entries(getAuthHeaderForNav()).forEach(([key, value]) => xhr.setRequestHeader(key, value));

                            xhr.upload.onprogress = ev => {
                                if (!ev.lengthComputable) return;
                                const fileLoaded = ev.loaded;
                                const fileTotal = ev.total;
                                const filePctVal = Math.min(100, (fileLoaded / fileTotal) * 100);

                                if (currentPct) currentPct.textContent = `${filePctVal.toFixed(0)}%`;
                                if (currentBar) currentBar.style.width = `${filePctVal}%`;
                                if (queueStatus) queueStatus.textContent = `⚡ 上传中 ${filePctVal.toFixed(0)}%`;

                                const overallLoaded = completedBytesBefore + fileLoaded;
                                const overallPctVal = Math.min(100, (overallLoaded / totalBytes) * 100);
                                if (overallBar) overallBar.style.width = `${overallPctVal}%`;
                                if (overallPct) overallPct.textContent = `${overallPctVal.toFixed(1)}%`;
                                if (overallTitle) overallTitle.textContent = `总进度：正在上传第 ${i + 1} / ${totalFiles} 个文件`;
                                if (overallSize) overallSize.textContent = `${formatMediaBytes(overallLoaded)} / ${formatMediaBytes(totalBytes)}`;

                                const now = Date.now();
                                const deltaT = (now - speedWindowTime) / 1000;
                                if (deltaT >= 0.5) {
                                    const deltaB = overallLoaded - speedWindowBytes;
                                    currentSpeed = deltaB / deltaT;
                                    speedWindowBytes = overallLoaded;
                                    speedWindowTime = now;

                                    if (overallSpeed) overallSpeed.textContent = `${formatMediaBytes(currentSpeed)}/s`;
                                    if (overallEta) {
                                        const remainingBytes = Math.max(0, totalBytes - overallLoaded);
                                        const etaSec = currentSpeed > 0 ? remainingBytes / currentSpeed : 0;
                                        overallEta.textContent = `剩余时间: ${formatMediaEta(etaSec)}`;
                                    }
                                }

                                const curMilestone = Math.floor(filePctVal / 25) * 25;
                                if (curMilestone > lastLoggedMilestone && curMilestone < 100) {
                                    lastLoggedMilestone = curMilestone;
                                    addMediaLog(`📡 [${i + 1}/${totalFiles}] ${file.name} 进度 ${curMilestone}% · 当前速度 ${formatMediaBytes(currentSpeed)}/s`, 'progress');
                                }
                            };

                            xhr.onerror = () => reject(new Error('网络连接中断'));
                            xhr.onload = () => {
                                let data;
                                try { data = JSON.parse(xhr.responseText); } catch (_) { }
                                if (xhr.status >= 200 && xhr.status < 300 && data?.success) resolve(data);
                                else reject(new Error(data?.error || `HTTP ${xhr.status}`));
                            };

                            const form = new FormData();
                            form.append('folder', folderName);
                            form.append('fileName', file.name);
                            form.append('video', file);
                            xhr.send(form);
                        });

                        const elapsed = ((Date.now() - fileStartTime) / 1000).toFixed(1);
                        completedFiles++;
                        completedBytesBefore += file.size;

                        if (queueStatus) {
                            queueStatus.className = 'nav-media-queue-status success';
                            queueStatus.textContent = '✅ 已完成';
                        }
                        if (currentBar) currentBar.style.width = '100%';
                        if (currentPct) currentPct.textContent = '100%';

                        const savedAs = result.fileName && result.fileName !== file.name ? `（服务端保存为 ${result.fileName}）` : '';
                        addMediaLog(`✅ [${i + 1}/${totalFiles}] ${file.name} 上传成功${savedAs}，耗时 ${elapsed}s`, 'success');
                    } catch (fileErr) {
                        failedFiles++;
                        completedBytesBefore += file.size;
                        if (queueStatus) {
                            queueStatus.className = 'nav-media-queue-status error';
                            queueStatus.textContent = '❌ 失败';
                        }
                        addMediaLog(`❌ [${i + 1}/${totalFiles}] ${file.name} 上传失败：${fileErr.message}`, 'error');
                    }
                }

                if (logDot) logDot.classList.remove('busy');
                if (overallBar) overallBar.style.width = '100%';
                if (overallPct) overallPct.textContent = '100%';
                if (overallSpeed) overallSpeed.textContent = '传输完成';
                if (overallEta) overallEta.textContent = '全部完成';
                if (overallTitle) overallTitle.textContent = `总进度：传输完毕（成功 ${completedFiles} / 失败 ${failedFiles}）`;

                addMediaLog(`🎉 全部上传任务处理完成！成功 ${completedFiles} 个，失败 ${failedFiles} 个，总计 ${formatMediaBytes(totalBytes)}。`, completedFiles > 0 ? 'success' : 'error');

                await renderMediaSettings(document.getElementById('navSettingsContent'));

                submit.style.display = 'none';
                if (cancel) {
                    cancel.textContent = '完成并关闭';
                    cancel.className = 'nav-media-dialog-btn primary';
                    cancel.disabled = false;
                    busy = false;
                    cancel.onclick = () => forceClose();
                }
            }
        } catch (error) {
            status.style.color = '#dc2626';
            status.textContent = error.message;
            busy = false;
            dialog.querySelectorAll('button,input').forEach(el => { el.disabled = false; });
        }
    };
    dialog.showModal();
    name.focus();
}
window.openCreateMediaFolderModal = () => openMediaForm(false);

window.setMediaCategoryPriority = async function (categoryId, value, input) {
    const category = (navState.mediaCategoriesCache || []).find(item => item.id === categoryId);
    const order = Number(value);
    if (!category || !Number.isSafeInteger(order)) {
        showNavbarNotice({ title: '输入提示', message: '分类优先级请输入整数；数字越小排名越靠前。', tone: 'info' });
        return;
    }
    if (input) input.disabled = true;
    try {
        const response = await fetch(`/api/media/admin/folders/${encodeURIComponent(category.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ newName: category.name, order })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        await renderMediaSettings(document.getElementById('navSettingsContent'));
    } catch (error) {
        if (input) input.disabled = false;
        showNavbarNotice({ title: '保存失败', message: `分类优先级保存失败：${error.message}`, tone: 'error' });
    }
};

window.openEditMediaCategoryModal = async function (categoryId) {
    const category = (navState.mediaCategoriesCache || []).find(item => item.id === categoryId);
    if (!category) return;
    const values = await showNavbarFormDialog({
        title: `分类设置：${category.name}`,
        eyebrow: '媒体库访问保护',
        icon: category.protected ? '🔒' : '📁',
        message: '隐藏分类的名称仍可见，点击后需输入 4 位 PIN 才能加载内容。',
        fields: [
            {
                name: 'order',
                label: '分类优先级（数字越小越靠前）',
                value: String(category.order ?? 0),
                type: 'number',
                required: true
            },
            {
                name: 'protected',
                label: '访问方式',
                value: String(Boolean(category.protected)),
                required: true,
                options: [
                    { value: 'false', label: '🌐 公开分类' },
                    { value: 'true', label: '🔒 4 位 PIN 保护' }
                ]
            },
            {
                name: 'pin',
                label: category.protected ? '新 PIN（留空则保持原 PIN）' : '4 位 PIN',
                value: '',
                type: 'password',
                maxLength: 4,
                placeholder: category.protected ? '不修改可留空' : '输入 4 位数字',
                enabledWhen: { field: 'protected', value: 'true' }
            }
        ],
        confirmText: '保存设置',
        cancelText: '取消'
    });
    if (!values) return;
    const shouldProtect = values.protected === 'true';
    const order = Number(values.order);
    const pin = String(values.pin || '').trim();
    if (!Number.isSafeInteger(order)) {
        return showNavbarNotice({ title: '优先级格式不正确', message: '分类优先级必须是整数。', tone: 'error' });
    }
    if (shouldProtect && !category.protected && !/^\d{4}$/.test(pin)) {
        return showNavbarNotice({ title: 'PIN 格式不正确', message: '请输入 4 位数字 PIN。', tone: 'error' });
    }
    if (pin && !/^\d{4}$/.test(pin)) {
        return showNavbarNotice({ title: 'PIN 格式不正确', message: 'PIN 必须是 4 位数字。', tone: 'error' });
    }
    try {
        const response = await fetch(`/api/media/admin/folders/${encodeURIComponent(category.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ newName: category.name, protected: shouldProtect, pin, order })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || '保存失败');
        await renderMediaSettings(document.getElementById('navSettingsContent'));
        showNavbarNotice({
            title: '分类设置已更新',
            message: shouldProtect ? `“${category.name}”现在需要 4 位 PIN 才能查看。` : `“${category.name}”已设为公开分类。`,
            tone: 'success'
        });
    } catch (error) {
        showNavbarNotice({ title: '保存失败', message: error.message, tone: 'error' });
    }
};

// 删除分类文件夹
window.deleteMediaFolder = async function (folderName) {
    const confirmed = await showNavbarConfirm({
        title: '删除分类文件夹',
        eyebrow: '危险操作 · 分类删除',
        message: `确定彻底删除分类文件夹“${folderName}”吗？`,
        hint: '⚠️ 警告：该文件夹下的所有视频资源将被一并清理，此操作无法撤销！',
        confirmText: '确认删除',
        cancelText: '取消',
        tone: 'danger',
        icon: '🗑'
    });
    if (!confirmed) return;

    try {
        const response = await fetch(`/api/media/admin/folders/${encodeURIComponent(folderName)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '删除成功',
                message: data.message || `分类“${folderName}”已成功删除。`,
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '删除失败',
                message: data.error || '未能删除该分类',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

// 从当前设备选择文件夹或视频上传
window.openImportLocalMediaModal = () => openMediaForm(true);

// 编辑视频元数据
window.openEditMediaModal = async function (videoId) {
    const video = navState.mediaVideosCache?.find(v => v.id === videoId);
    if (!video) return;

    const categoryOptions = (navState.mediaCategoriesCache || [])
        .filter(category => category.id !== 'all')
        .map(category => ({ value: category.id, label: `${category.icon || '📁'} ${category.name || category.folder || '未命名分类'}` }));

    const values = await showNavbarFormDialog({
        title: '编辑视频展示信息',
        eyebrow: '媒体库管理',
        icon: '✎',
        fields: [
            { name: 'title', label: '视频展示标题', value: video.title || '', required: true, maxLength: 80, placeholder: '输入视频标题' },
            { name: 'category', label: '所属分类', value: video.category || '', required: true, options: categoryOptions },
            { name: 'description', label: '视频简介', value: video.description || '', multiline: true, maxLength: 300, placeholder: '输入视频简介描述' }
        ],
        confirmText: '保存修改',
        cancelText: '取消'
    });
    if (!values) return;

    try {
        const response = await fetch(`/api/media/admin/videos/${encodeURIComponent(videoId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({
                title: (values.title || '').trim(),
                category: values.category,
                description: (values.description || '').trim()
            })
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '修改成功',
                message: '视频信息已更新。',
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '修改失败',
                message: data.error || '保存失败',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

// 抽取封面帧
window.extractMediaPoster = async function (videoId) {
    const values = await showNavbarFormDialog({
        title: '重新截取封面帧',
        message: '请输入抽取封面的时间点（格式如 00:00:06 或 00:01:20）：',
        eyebrow: '媒体库管理',
        icon: '🎬',
        fields: [
            { name: 'timeOffset', label: '截取时间点', value: '00:00:06', required: true, placeholder: '00:00:06' }
        ],
        confirmText: '开始截取',
        cancelText: '取消'
    });
    if (!values || !values.timeOffset) return;

    try {
        const response = await fetch(`/api/media/admin/extract-poster/${encodeURIComponent(videoId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ timeOffset: values.timeOffset.trim() })
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '封面抽帧成功',
                message: '视频高清封面帧已更新！',
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '抽帧失败',
                message: data.error || '截取失败',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

// 删除单个视频
window.deleteMediaVideo = async function (videoId, title) {
    const confirmed = await showNavbarConfirm({
        title: '删除视频',
        eyebrow: '不可逆操作',
        message: `确定彻底删除视频“${title}”吗？`,
        hint: '⚠️ 该视频文件及关联封面资源将被永久清除，且无法恢复。',
        confirmText: '确认删除',
        cancelText: '取消',
        tone: 'danger',
        icon: '🗑'
    });
    if (!confirmed) return;

    try {
        const response = await fetch(`/api/media/admin/videos/${encodeURIComponent(videoId)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await response.json();
        if (data.success) {
            await renderMediaSettings(document.getElementById('navSettingsContent'));
            showNavbarNotice({
                title: '删除成功',
                message: '视频已成功删除。',
                tone: 'success'
            });
        } else {
            showNavbarNotice({
                title: '删除失败',
                message: data.error || '未能删除该视频',
                tone: 'error'
            });
        }
    } catch (e) {
        showNavbarNotice({
            title: '请求失败',
            message: e.message || '网络连接异常，请重试',
            tone: 'error'
        });
    }
};

window.updateCustomToolBackupSelectionSummary = updateCustomToolBackupSelectionSummary;

window.setAllCustomToolBackupSelections = function (checked) {
    document.querySelectorAll('[data-custom-backup-slug]').forEach(box => { box.checked = checked; });
    updateCustomToolBackupSelectionSummary();
};

function collectCustomToolBrowserState(selectedSlugs) {
    const summary = navState.customToolBackupSummary || {};
    const selected = new Set(selectedSlugs);
    const keys = new Set();
    const reservedPlatformKeys = new Set(['tools_token', 'tools_role', 'tools_user', 'tools_language']);
    (summary.tools || []).filter(tool => selected.has(tool.slug)).forEach(tool => {
        (tool.dependencies?.localStorageKeys || []).forEach(key => {
            if (!reservedPlatformKeys.has(key) && !/(?:token|password|passwd|secret|authorization|session|credential)/i.test(key)) keys.add(key);
        });
    });
    const state = {};
    keys.forEach(key => {
        try {
            const value = localStorage.getItem(key);
            if (value !== null) state[key] = value;
        } catch (_) { }
    });
    return state;
}

window.exportCustomToolBackup = async function () {
    const slugs = Array.from(document.querySelectorAll('[data-custom-backup-slug]:checked')).map(box => box.dataset.customBackupSlug);
    if (!slugs.length) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.ctbk.noSelection'), tone: 'info' });
    await runGlobalBackupAction(navT('nav.ctbk.exporting'), async () => {
        const res = await fetch('/api/custom-tools/backup/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ slugs, browserState: collectCustomToolBrowserState(slugs) })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const disposition = res.headers.get('content-disposition') || '';
        const match = disposition.match(/filename="?([^";]+)"?/i);
        const filename = match ? match[1] : `tools-platform-custom-tools_${Date.now()}.zip`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { filename, size: blob.size };
    });
};

window.restoreCustomToolBackup = async function () {
    const input = document.getElementById('customToolBackupRestoreInput');
    const file = input?.files?.[0];
    if (!file) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.ctbk.noFile'), tone: 'info' });
    const strategy = document.getElementById('customToolBackupConflictStrategy')?.value === 'skip' ? 'skip' : 'replace';
    const strategyLabel = strategy === 'skip' ? navT('nav.ctbk.strategySkip') : navT('nav.ctbk.strategyReplace');
    const message = customToolBackupText('nav.ctbk.restoreConfirm', { file: file.name, strategy: strategyLabel });
    const confirmed = await showNavbarConfirm({
        title: navLocaleText('恢复自定义工具备份', 'Restore custom-tool backup'),
        message,
        hint: navLocaleText('请确认冲突处理策略和备份文件无误后继续。', 'Verify the backup file and conflict strategy before continuing.'),
        tone: 'warning',
        confirmText: navLocaleText('开始恢复', 'Restore')
    });
    if (!confirmed) return;
    const result = await runGlobalBackupAction(navT('nav.ctbk.restoring'), async () => {
        const form = new FormData();
        form.append('backup', file);
        form.append('conflictStrategy', strategy);
        const res = await fetch('/api/custom-tools/backup/restore', {
            method: 'POST',
            headers: getAuthHeaderForNav(),
            body: form
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        Object.entries(data.browserState || {}).forEach(([key, value]) => {
            try { localStorage.setItem(key, value); } catch (_) { }
        });
        const dependencyCount = Array.isArray(data.dependencyWarnings) ? data.dependencyWarnings.length : 0;
        let done = customToolBackupText('nav.ctbk.restoreDone', {
            restored: data.restored?.length || 0,
            skipped: data.skipped?.length || 0
        });
        if (dependencyCount) done += `\n\n${customToolBackupText('nav.ctbk.dependencyWarn', { count: dependencyCount })}`;
        await showNavbarNotice({ title: navT('nav.dialog.success'), message: done, tone: 'success' });
        return data;
    });
    if (result) {
        try {
            const toolsRes = await fetch('/api/custom-tools', { headers: getAuthHeaderForNav() });
            if (toolsRes.ok) {
                navState.customTools = await toolsRes.json();
                writeNavigationBootstrapCache();
            }
        } catch (_) { }
        renderCustomToolBackupSettings(document.getElementById('navSettingsContent'));
    }
};

function collectRemoteBackupSettings(options = {}) {
    const passwordInput = document.getElementById('remoteBackupPassword');
    const payload = {
        enabled: Boolean(document.getElementById('remoteBackupEnabled')?.checked),
        baseUrl: document.getElementById('remoteBackupBaseUrl')?.value || '',
        username: document.getElementById('remoteBackupUsername')?.value || '',
        compareBeforeRestore: Boolean(document.getElementById('remoteBackupCompare')?.checked),
        createRemoteBackupBeforePull: Boolean(document.getElementById('remoteBackupCreateBeforePull')?.checked),
        autoRestore: Boolean(document.getElementById('remoteBackupAutoRestore')?.checked)
    };
    if (options.clearPassword) {
        payload.clearPassword = true;
    } else if (options.passwordTouched && passwordInput) {
        payload.password = passwordInput.value || '';
    }
    return payload;
}

function collectScheduleBackupSettings() {
    return {
        enabled: Boolean(document.getElementById('scheduleBackupEnabled')?.checked),
        time: document.getElementById('scheduleBackupTime')?.value || '02:00',
        retentionDays: parseInt(document.getElementById('scheduleBackupRetentionDays')?.value || '90', 10),
        maxTotalSizeGB: parseFloat(document.getElementById('scheduleBackupMaxTotalSizeGB')?.value || '10')
    };
}

async function saveScheduleBackupSettingsNow() {
    const res = await fetch('/api/global-backup/schedule-settings', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify(collectScheduleBackupSettings())
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    navState.scheduleBackupSettings = data;
    const capacityStatus = document.getElementById('scheduleBackupCapacityStatus');
    if (capacityStatus) {
        capacityStatus.textContent = navT('nav.bk.scheduleUsage', {
            used: formatBackupSize(data.currentTotalBytes || 0),
            limit: formatBackupSize(data.maxTotalBytes || 0)
        }) + (data.capacityExceeded ? ` · ${navT('nav.bk.scheduleOver')}` : '');
        capacityStatus.classList.toggle('warning', Boolean(data.capacityExceeded));
    }
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = data.capacityCleanup?.removedCount
        ? `${navT('nav.bk.scheduleSaved')} · ${navLocaleText(`已清理 ${data.capacityCleanup.removedCount} 个旧备份`, `Removed ${data.capacityCleanup.removedCount} old backup(s)`)}`
        : navT('nav.bk.scheduleSaved');
    return data;
}

window.scheduleBackupSettingsSave = function () {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.bk.scheduleSaving');
    clearTimeout(navState.scheduleBackupSaveTimer);
    navState.scheduleBackupSaveTimer = setTimeout(async () => {
        try {
            await saveScheduleBackupSettingsNow();
        } catch (e) {
            if (indicator) indicator.textContent = `${navT('nav.set.saveFail')}${e.message}`;
        }
    }, 650);
};

window.runScheduledBackupNow = async function () {
    clearTimeout(navState.scheduleBackupSaveTimer);
    await saveScheduleBackupSettingsNow();
    await runGlobalBackupAction('正在执行定时备份...', async () => {
        const res = await fetch('/api/global-backup/schedule-run', {
            method: 'POST',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    });
    renderNavSettingsContent();
};

async function saveRemoteBackupSettingsNow(options = {}) {
    const res = await fetch('/api/global-backup/remote-settings', {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify(collectRemoteBackupSettings(options))
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    navState.remoteBackupSettings = data;
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '远端同步设置已保存';
    return data;
}

window.scheduleRemoteBackupSettingsSave = function (options = {}) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '正在保存远端同步设置...';
    clearTimeout(navState.remoteBackupSaveTimer);
    navState.remoteBackupSaveTimer = setTimeout(async () => {
        try {
            await saveRemoteBackupSettingsNow(options);
        } catch (e) {
            if (indicator) indicator.textContent = `保存失败: ${e.message}`;
        }
    }, 650);
};

window.clearRemoteBackupPassword = async function () {
    await runGlobalBackupAction('正在清除远端密码...', async () => {
        await saveRemoteBackupSettingsNow({ clearPassword: true });
    });
    renderNavSettingsContent();
};

window.checkRemoteBackupNow = async function () {
    clearTimeout(navState.remoteBackupSaveTimer);
    await saveRemoteBackupSettingsNow();
    const result = await runGlobalBackupAction('正在检查远端备份...', async () => {
        const res = await fetch('/api/global-backup/remote-check', {
            method: 'POST',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    });
    const latest = result.latest || {};
    await showNavbarNotice({
        title: navLocaleText('远端连接成功', 'Remote connection successful'),
        message: `${result.remoteCreatedBackup?.name ? `${navLocaleText('已请求主站生成新备份', 'Requested a new remote backup')}：${result.remoteCreatedBackup.name}\n` : ''}${navLocaleText('备份数量', 'Backups')}：${result.backups?.length || 0}\n${navLocaleText('最新备份', 'Latest backup')}：${latest.name || '-'}\n${navLocaleText('时间', 'Time')}：${formatBackupTime(latest.modifiedAt || latest.createdAt)}`,
        tone: 'success'
    });
    renderNavSettingsContent();
};

window.pullRemoteBackupNow = async function (force) {
    clearTimeout(navState.remoteBackupSaveTimer);
    await saveRemoteBackupSettingsNow();
    const ok = await showNavbarConfirm({
        title: force ? navLocaleText('强制恢复远端备份', 'Force remote restore') : navLocaleText('拉取并恢复远端备份', 'Pull and restore remote backup'),
        message: force ? navLocaleText('确定要强制恢复远端最新备份吗？', 'Force restore the latest remote backup?') : navLocaleText('确定要按规则拉取并恢复远端备份吗？', 'Pull and restore a remote backup using the configured rules?'),
        hint: navLocaleText('此操作只会覆盖当前租户的本地业务数据，不影响其他租户。恢复成功后服务会自动重启，手动启动方式可能需要重新启动服务。', 'This only overwrites local business data for the current tenant and does not affect other tenants. The service restarts automatically when possible; manual deployments may need a restart.'),
        tone: 'danger',
        confirmText: navLocaleText('确认恢复', 'Restore')
    });
    if (!ok) return;
    await runGlobalBackupAction('正在拉取远端备份并恢复...', async () => {
        const res = await fetch('/api/global-backup/remote-pull', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify({ restore: true, force })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.restored) {
            await showNavbarNotice({
                title: navLocaleText('远端备份恢复完成', 'Remote backup restored'),
                message: `${data.latest?.name || '-'}\n\n${navLocaleText('服务将自动重启；如果是手动 npm start，请重新启动服务。', 'The service will restart automatically. If it was started manually with npm start, restart it yourself.')}`,
                tone: 'success'
            });
        } else {
            await showNavbarNotice({
                title: navT('nav.dialog.notice'),
                message: data.message || navLocaleText('远端备份未更新，未执行恢复。', 'The remote backup is unchanged; no restore was performed.'),
                tone: 'info'
            });
        }
        return data;
    });
};

async function runGlobalBackupAction(actionText, action) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = actionText;
    try {
        const result = await action();
        if (indicator) indicator.textContent = '操作完成';
        if (document.getElementById('backupOperationConsole')) {
            appendBackupConsoleEntry('客户端已收到服务端完成响应', 'success');
            setBackupConsoleProgress(100, 'COMPLETED');
        }
        return result;
    } catch (e) {
        if (indicator) indicator.textContent = `操作失败: ${e.message}`;
        if (document.getElementById('backupOperationConsole')) {
            appendBackupConsoleEntry(`操作失败：${e.message}`, 'error');
            setBackupConsoleProgress(100, 'FAILED');
        }
        if (e.code !== 'BACKUP_TENANT_MISMATCH') {
            await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
        }
        throw e;
    }
}

function createBackupApiError(data = {}, status = 500) {
    const error = new Error(data.error || `HTTP ${status}`);
    error.status = status;
    Object.assign(error, data);
    return error;
}

async function confirmCrossTenantRestore(error) {
    const sourceName = error.backupTenantName || error.backupTenantId || '-';
    const sourceId = error.backupTenantId || '-';
    const targetName = error.currentTenantName || activeTenantName();
    const targetId = error.currentTenantId || navState.activeTenantId || 'default';
    return showNavbarConfirm({
        eyebrow: navLocaleText('跨租户数据恢复', 'CROSS-TENANT RESTORE'),
        title: navLocaleText('租户标识不一致，是否强制恢复？', 'Tenant IDs differ. Force restore?'),
        message: navLocaleText(
            `当前目标：${targetName}（ID: ${targetId}）\n备份来源：${sourceName}（ID: ${sourceId}）`,
            `Target: ${targetName} (ID: ${targetId})\nBackup source: ${sourceName} (ID: ${sourceId})`
        ),
        hint: navLocaleText(
            '确认后，来源租户的脚本、规则、数据库、附件和自定义工具将写入当前目标租户。目标租户现有业务数据会先生成安全备份；账号、登录会话、租户清单和其他租户不会被覆盖。',
            'The source tenant’s scripts, rules, databases, attachments, and custom tools will be written into the current target tenant. A safety backup of the target is created first. Accounts, sessions, the tenant registry, and other tenants are not overwritten.'
        ),
        icon: '⇄',
        tone: 'danger',
        cancelText: navLocaleText('取消恢复', 'Cancel'),
        confirmText: navLocaleText('确认强制恢复', 'Force restore')
    });
}

let backupConsolePollTimer = null;
let backupConsoleSeenEntries = 0;

function createBackupOperationId() {
    return `backup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureBackupOperationConsole(title = '备份任务控制台') {
    let panel = document.getElementById('backupOperationConsole');
    if (!panel) {
        panel = document.createElement('aside');
        panel.id = 'backupOperationConsole';
        panel.className = 'backup-operation-console';
        panel.innerHTML = `
            <div class="backup-console-head">
                <div>
                    <div class="backup-console-kicker">TOOLS PLATFORM · DATA OPS</div>
                    <strong id="backupConsoleTitle"></strong>
                </div>
                <div class="backup-console-actions">
                    <button type="button" onclick="toggleBackupOperationConsole()" title="折叠/展开">−</button>
                    <button type="button" onclick="clearBackupOperationConsole()" title="关闭">×</button>
                </div>
            </div>
            <div class="backup-console-progress"><span id="backupConsoleProgress"></span></div>
            <div class="backup-console-body" id="backupConsoleBody"></div>
            <div class="backup-console-foot"><span class="backup-console-pulse"></span><span id="backupConsoleStatus">READY</span></div>
        `;
        document.body.appendChild(panel);
    }
    panel.classList.remove('collapsed');
    document.getElementById('backupConsoleTitle').textContent = title;
    return panel;
}

function appendBackupConsoleEntry(message, level = 'info', detail = null, timestamp = null) {
    ensureBackupOperationConsole();
    const body = document.getElementById('backupConsoleBody');
    const row = document.createElement('div');
    row.className = `backup-console-entry ${level}`;
    const time = timestamp ? new Date(timestamp) : new Date();
    const timeText = Number.isNaN(time.getTime())
        ? '--:--:--'
        : time.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    row.innerHTML = `
        <span class="backup-console-time">${navEscape(timeText)}</span>
        <span class="backup-console-dot"></span>
        <span class="backup-console-message">${navEscape(message)}</span>
        ${detail ? `<code>${navEscape(typeof detail === 'string' ? detail : JSON.stringify(detail))}</code>` : ''}
    `;
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
}

function setBackupConsoleProgress(percent, status) {
    const bar = document.getElementById('backupConsoleProgress');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`;
    const statusEl = document.getElementById('backupConsoleStatus');
    if (statusEl && status) statusEl.textContent = status;
}

function stopBackupConsolePolling() {
    if (backupConsolePollTimer) {
        clearTimeout(backupConsolePollTimer);
        backupConsolePollTimer = null;
    }
}

async function pollBackupOperation(operationId, operationEndpoint = '/api/global-backup/operations') {
    stopBackupConsolePolling();
    try {
        const res = await fetch(`${operationEndpoint}/${encodeURIComponent(operationId)}`, {
            headers: getAuthHeaderForNav()
        });
        if (res.ok) {
            const operation = await res.json();
            const entries = Array.isArray(operation.entries) ? operation.entries : [];
            entries.slice(backupConsoleSeenEntries).forEach(entry => {
                const message = navLocaleText(entry.message, entry.messageEn || entry.message);
                appendBackupConsoleEntry(message, entry.level, entry.detail, entry.timestamp);
            });
            backupConsoleSeenEntries = entries.length;
            const reportedProgress = Number(operation.progress);
            const progress = operation.status === 'completed' || operation.status === 'failed'
                ? 100
                : Number.isFinite(reportedProgress) ? reportedProgress : 72;
            setBackupConsoleProgress(progress, operation.status.toUpperCase());
            if (operation.status === 'completed' || operation.status === 'failed') return;
        }
    } catch (e) {
        // The service may be restarting after a successful restore.
    }
    backupConsolePollTimer = setTimeout(() => pollBackupOperation(operationId, operationEndpoint), 650);
}

function startBackupOperationConsole(title, operationEndpoint = '/api/global-backup/operations', suppliedOperationId = '') {
    stopBackupConsolePolling();
    ensureBackupOperationConsole(title);
    document.getElementById('backupConsoleBody').innerHTML = '';
    backupConsoleSeenEntries = 0;
    setBackupConsoleProgress(4, 'STARTING');
    const operationId = suppliedOperationId || createBackupOperationId();
    appendBackupConsoleEntry(navLocaleText('任务已创建，正在连接服务端', 'Task created; connecting to the server'), 'info');
    pollBackupOperation(operationId, operationEndpoint);
    return operationId;
}

window.toggleBackupOperationConsole = function () {
    document.getElementById('backupOperationConsole')?.classList.toggle('collapsed');
};

window.clearBackupOperationConsole = function () {
    stopBackupConsolePolling();
    document.getElementById('backupOperationConsole')?.remove();
};

window.createGlobalBackup = async function (downloadAfterCreate) {
    const operationId = startBackupOperationConsole('生成当前租户备份');
    const result = await runGlobalBackupAction('正在生成备份...', async () => {
        const res = await fetch('/api/global-backup/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Backup-Operation-Id': operationId,
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify({ reason: 'manual' })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
    if (downloadAfterCreate && result?.name) {
        await downloadGlobalBackupFile(result.name);
    }
    renderNavSettingsContent();
};

async function downloadGlobalBackupFile(name) {
    ensureBackupOperationConsole('下载备份包');
    appendBackupConsoleEntry(`开始下载：${name}`);
    const res = await fetch(`/api/global-backup/download/${encodeURIComponent(name)}`, {
        headers: getAuthHeaderForNav()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    let loaded = 0;
    const reader = res.body.getReader();
    const chunks = [];
    const indicator = document.getElementById('navSettingsSaveState');

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (indicator) {
            if (total) {
                const percent = Math.round((loaded / total) * 100);
                indicator.textContent = `正在下载... ${percent}% (${formatBackupSize(loaded)} / ${formatBackupSize(total)})`;
                setBackupConsoleProgress(percent, `DOWNLOADING ${percent}%`);
            } else {
                indicator.textContent = `正在下载... 已接收 ${formatBackupSize(loaded)}`;
            }
        }
    }

    const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    appendBackupConsoleEntry(`下载完成：${formatBackupSize(loaded)}`, 'success');
    setBackupConsoleProgress(100, 'COMPLETED');
}

window.downloadGlobalBackup = async function (name) {
    await runGlobalBackupAction('正在下载备份...', () => downloadGlobalBackupFile(name));
};

window.deleteGlobalBackup = async function (name) {
    const ok = await showNavbarConfirm({
        title: navLocaleText('永久删除备份', 'Permanently delete backup'),
        message: name,
        hint: navLocaleText('删除后无法恢复，请确认该备份已经不再需要。', 'This cannot be undone. Make sure this backup is no longer needed.'),
        tone: 'danger',
        confirmText: navLocaleText('永久删除', 'Delete permanently')
    });
    if (!ok) return;
    await runGlobalBackupAction('正在删除备份...', async () => {
        const res = await fetch(`/api/global-backup/delete/${encodeURIComponent(name)}`, {
            method: 'DELETE',
            headers: getAuthHeaderForNav()
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    });
    renderNavSettingsContent();
};

function getGlobalRestoreCompletionMessage(data = {}) {
    const missing = Array.isArray(data.missingTargets) ? data.missingTargets : [];
    const crossTenantText = data.forcedCrossTenant
        ? `\n\n已强制跨租户恢复：${data.sourceTenant?.name || data.sourceTenant?.id || '-'}（${data.sourceTenant?.id || '-'}） → ${data.targetTenant?.name || data.targetTenant?.id || '-'}（${data.targetTenant?.id || '-'}）。`
        : '';
    const partialText = data.partialRestore
        ? `\n\n注意：这是旧版或不完整备份，未包含：${missing.join('、')}。对应的现有数据未被覆盖。`
        : '';
    return `恢复完成。恢复前安全备份：${data.safetyBackup?.name || '-'}${crossTenantText}${partialText}\n\n建议重启服务或刷新页面，确保 SQLite 连接重新加载。`;
}

async function performServerBackupRestore(name, forceCrossTenant = false) {
    const operationId = startBackupOperationConsole(forceCrossTenant ? '强制跨租户恢复服务器备份' : '恢复服务器备份');
    return runGlobalBackupAction('正在从服务器备份恢复...', async () => {
        const res = await fetch(`/api/global-backup/restore/server/${encodeURIComponent(name)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Backup-Operation-Id': operationId,
                ...getAuthHeaderForNav()
            },
            body: JSON.stringify({ forceCrossTenant, targetTenantId: navState.activeTenantId || 'default' })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw createBackupApiError(data, res.status);
        await showNavbarNotice({ title: navT('nav.dialog.success'), message: getGlobalRestoreCompletionMessage(data), tone: 'success' });
        return data;
    });
}

window.restoreGlobalBackupFromServer = async function (name) {
    const ok = await showNavbarConfirm({
        title: navLocaleText('从服务器备份恢复', 'Restore server backup'),
        message: name,
        hint: navLocaleText('此操作只会覆盖当前租户的业务数据，不影响其他租户。系统会先自动生成当前租户的恢复前安全备份。', 'This only overwrites business data for the current tenant and does not affect other tenants. A safety backup for the current tenant is created first.'),
        tone: 'danger',
        confirmText: navLocaleText('开始恢复', 'Restore')
    });
    if (!ok) return;
    try {
        await performServerBackupRestore(name, false);
    } catch (error) {
        if (error.code !== 'BACKUP_TENANT_MISMATCH') throw error;
        if (await confirmCrossTenantRestore(error)) await performServerBackupRestore(name, true);
    }
    renderNavSettingsContent();
};

window.restoreGlobalBackupFromUpload = async function (forceCrossTenant = false, skipInitialConfirm = false) {
    const input = document.getElementById('globalBackupUploadInput');
    const file = input && input.files && input.files[0];
    if (!file) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navLocaleText('请先选择备份 zip 包。', 'Select a backup ZIP package first.'), tone: 'info' });
    if (!skipInitialConfirm) {
        const ok = await showNavbarConfirm({
            title: navLocaleText('上传并恢复备份', 'Upload and restore backup'),
            message: file.name,
            hint: navLocaleText('系统会先校验备份租户 ID；如与当前租户不同，会在不修改数据的情况下暂停并要求再次确认。', 'The tenant ID is checked first. If it differs from the current tenant, the restore pauses without changing data and asks for another confirmation.'),
            tone: 'danger',
            confirmText: navLocaleText('上传并校验', 'Upload and validate')
        });
        if (!ok) return;
    }
    const operationId = startBackupOperationConsole(forceCrossTenant ? '强制跨租户上传恢复' : '上传并恢复备份');
    appendBackupConsoleEntry(`已选择文件：${file.name}`, 'info', { size: formatBackupSize(file.size) });

    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = '准备上传备份...';

    try {
        const data = await new Promise((resolve, reject) => {
            const form = new FormData();
            form.append('backup', file);
            form.append('forceCrossTenant', forceCrossTenant ? 'true' : 'false');
            form.append('targetTenantId', navState.activeTenantId || 'default');
            let uploadCompleteLogged = false;

            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/global-backup/restore/upload', true);

            const headers = getAuthHeaderForNav();
            Object.keys(headers).forEach(key => {
                xhr.setRequestHeader(key, headers[key]);
            });
            xhr.setRequestHeader('X-Backup-Operation-Id', operationId);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && indicator) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    indicator.textContent = `正在上传并解压... ${percent}% (${formatBackupSize(e.loaded)} / ${formatBackupSize(e.total)})`;
                    setBackupConsoleProgress(Math.min(45, Math.round(percent * 0.45)), `UPLOADING ${percent}%`);
                    if (percent === 100 && !uploadCompleteLogged) {
                        uploadCompleteLogged = true;
                        appendBackupConsoleEntry('上传完成，服务端开始校验和恢复', 'success');
                    }
                }
            };

            xhr.onload = () => {
                let resData = {};
                try { resData = JSON.parse(xhr.responseText); } catch (err) { }
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(resData);
                } else {
                    reject(createBackupApiError(resData, xhr.status));
                }
            };

            xhr.onerror = () => reject(new Error('网络请求失败'));
            xhr.send(form);
        });

        if (indicator) indicator.textContent = '操作完成';
        appendBackupConsoleEntry('客户端已收到恢复完成响应', 'success');
        setBackupConsoleProgress(100, 'COMPLETED');
        await showNavbarNotice({ title: navT('nav.dialog.success'), message: getGlobalRestoreCompletionMessage(data), tone: 'success' });
    } catch (e) {
        if (indicator) indicator.textContent = `操作失败: ${e.message}`;
        appendBackupConsoleEntry(`恢复失败：${e.message}`, 'error');
        setBackupConsoleProgress(100, 'FAILED');
        if (e.code === 'BACKUP_TENANT_MISMATCH' && !forceCrossTenant) {
            if (await confirmCrossTenantRestore(e)) {
                return window.restoreGlobalBackupFromUpload(true, true);
            }
        } else {
            await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
        }
    }
    renderNavSettingsContent();
};

let f12ShortcutLoader;

async function renderF12PageSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `<div class="nav-settings-help">${navEscape(text('正在读取插件列表…', 'Loading plugins…'))}</div>`;
    try {
        if (!window.ToolsF12QuickDownloads) {
            if (!f12ShortcutLoader) f12ShortcutLoader = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = '/js/shared/f12-quick-downloads.js';
                script.onload = resolve;
                script.onerror = () => { f12ShortcutLoader = null; script.remove(); reject(new Error(text('无法加载打包服务', 'Unable to load the packager'))); };
                document.head.append(script);
            });
            await f12ShortcutLoader;
        }
        const plugins = await window.ToolsF12QuickDownloads.catalog();
        if (navState.settingsTab !== 'page:f12-extension' || !content.isConnected) return;
        const name = plugin => text(plugin.name, plugin.nameEn || plugin.name);
        const render = () => {
            const shortcuts = navState.settings.f12QuickDownloads;
            content.innerHTML = `
                <div class="nav-settings-help">${navEscape(text('在首页知识图谱旁显示一键打包下载按钮。可添加任意数量，按钮会自动换行；除打包用途外，其余使用所选插件的默认参数。下载沿用 F12 打包的管理员权限。', 'Show one-click package downloads beside the knowledge graph on the home page. Add as many as needed; buttons wrap automatically. All other options use the selected plugin defaults. Downloads require the existing F12 administrator permissions.'))}</div>
                <div class="nav-settings-list">
                    ${shortcuts.map((item, index) => `
                        <div class="nav-settings-row" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
                            <label style="flex:1 1 240px;min-width:0;font-size:12px">${navEscape(text('插件', 'Plugin'))}
                                <select class="nav-settings-select" style="display:block;margin-top:6px;min-width:0" data-plugin="${index}">
                                    ${plugins.some(plugin => plugin.id === item.scriptId) ? '' : `<option value="${navEscape(item.scriptId)}" selected>${navEscape(text('插件已不可用：', 'Unavailable plugin: ') + item.scriptId)}</option>`}
                                    ${plugins.map(plugin => `<option value="${navEscape(plugin.id)}" ${plugin.id === item.scriptId ? 'selected' : ''}>${navEscape(name(plugin))} · ${navEscape(plugin.id.startsWith('builtin:') ? text('内置', 'Built-in') : text('脚本库', 'Script library'))}</option>`).join('')}
                                </select>
                            </label>
                            <label style="flex:1 1 195px;min-width:0;font-size:12px">${navEscape(text('默认打包用途', 'Default package target'))}
                                <select class="nav-settings-select" style="display:block;margin-top:6px;min-width:0" data-target="${index}">
                                    <option value="store" ${item.target === 'store' ? 'selected' : ''}>${navEscape(text('Edge 插件商店', 'Edge store'))}</option>
                                    <option value="local" ${item.target === 'local' ? 'selected' : ''}>${navEscape(text('本地安装 / 企业分发', 'Local / enterprise distribution'))}</option>
                                </select>
                            </label>
                            <div class="nav-settings-actions">
                                <button type="button" data-up="${index}" ${index === 0 ? 'disabled' : ''} aria-label="${navEscape(text('上移', 'Move up'))}" title="${navEscape(text('上移', 'Move up'))}">↑</button>
                                <button type="button" data-down="${index}" ${index === shortcuts.length - 1 ? 'disabled' : ''} aria-label="${navEscape(text('下移', 'Move down'))}" title="${navEscape(text('下移', 'Move down'))}">↓</button>
                                <button type="button" data-remove="${index}">${navEscape(text('删除', 'Remove'))}</button>
                            </div>
                        </div>`).join('') || `<div class="nav-settings-empty">${navEscape(text('尚未配置快捷下载插件', 'No download shortcuts configured'))}</div>`}
                </div>
                <button type="button" class="nav-settings-add" data-add-shortcut style="margin-top:14px" ${plugins.length ? '' : 'disabled'}>＋ ${navEscape(text('添加快捷插件', 'Add plugin shortcut'))}</button>`;
            content.querySelectorAll('[data-plugin]').forEach(select => select.addEventListener('change', () => {
                navState.settings.f12QuickDownloads[Number(select.dataset.plugin)].scriptId = select.value;
                scheduleNavSettingsSave();
            }));
            content.querySelectorAll('[data-target]').forEach(select => select.addEventListener('change', () => {
                navState.settings.f12QuickDownloads[Number(select.dataset.target)].target = select.value;
                scheduleNavSettingsSave();
            }));
            content.querySelectorAll('[data-up], [data-down], [data-remove]').forEach(button => button.addEventListener('click', () => {
                const current = navState.settings.f12QuickDownloads;
                if (button.dataset.remove !== undefined) current.splice(Number(button.dataset.remove), 1);
                else navState.settings.f12QuickDownloads = moveArrayItem(current, Number(button.dataset.up ?? button.dataset.down), button.dataset.up !== undefined ? -1 : 1);
                render();
                scheduleNavSettingsSave();
            }));
            content.querySelector('[data-add-shortcut]').addEventListener('click', () => {
                const current = navState.settings.f12QuickDownloads;
                current.push({ scriptId: plugins.find(plugin => plugin.id === 'builtin:netcare-rfc-word')?.id || plugins[0].id, target: 'store' });
                render();
                content.querySelector('[data-plugin="' + (current.length - 1) + '"]')?.focus();
                scheduleNavSettingsSave();
            });
        };
        render();
    } catch (error) {
        if (navState.settingsTab !== 'page:f12-extension' || !content.isConnected) return;
        content.innerHTML = `<div class="nav-settings-help">${navEscape(text('插件列表读取失败：', 'Unable to load plugins: ') + error.message)}</div><button type="button" class="nav-settings-add" data-retry-shortcuts>${navEscape(text('重试', 'Retry'))}</button>`;
        content.querySelector('[data-retry-shortcuts]').addEventListener('click', () => renderF12PageSettings(content));
    }
}

function renderPageSettings(content, pageId) {
    if (pageId === 'sla') return renderDataImportPageSettings(content);
    if (pageId === 'f12-extension') return renderF12PageSettings(content);
    if (pageId === 'home') return renderHomePageSettings(content);
    if (pageId === 'report') return renderReportPageSettings(content);
    if (pageId === 'duty-roster') return renderDutyRosterPageSettings(content);
    const item = NAV_BUILTIN_LINKS.find(link => link.id === pageId);
    content.innerHTML = `
        <div class="nav-page-config-placeholder">
            <div class="nav-page-config-icon">${item?.icon || '🧩'}</div>
            <div>
                <div class="nav-page-config-title">${navEscape(navT('nav.page.placeholderTitle', { page: getNavLabel(item) || '页面' }))}</div>
                <div class="nav-page-config-desc">${navEscape(navT('nav.page.placeholderDesc'))}</div>
            </div>
        </div>
    `;
}

function renderDutyRosterPageSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `
        <div class="nav-settings-help">
            ${navEscape(text('夜间运维值班表支持按目标月份自动计算自然周并标记埃及周末（周五/周六高亮），排班数据直接保存在服务端数据库，并已打通至“护网与网络安全月报编辑器”数据资料库。', 'The night operation duty roster calculates weekly intervals and Egyptian weekends (Fri/Sat highlighted), with persistence to server database and direct integration with the Monthly Report Designer data library.'))}
        </div>
        <div class="nav-page-config-placeholder" style="margin-top: 16px;">
            <div class="nav-page-config-icon">🌙</div>
            <div>
                <div class="nav-page-config-title">${navEscape(text('夜间运维值班表管理', 'Night Operation Duty Roster Management'))}</div>
                <div class="nav-page-config-desc">${navEscape(text('值班表采用专属独立编辑工作区，支持月份切换、一键引入上月人员、中英文切换及快捷保存。', 'The duty roster has a dedicated editing workspace supporting month switching, last-month import, bilingual toggles, and server sync.'))}</div>
                <div style="margin-top: 14px;">
                    <a href="/duty-roster" target="_blank" class="nav-settings-add" style="display:inline-flex;align-items:center;text-decoration:none;padding:6px 14px;font-size:13px;font-weight:600;border-radius:6px;background:#312e81;color:#fff;border:none;">
                        🌙 ${navEscape(text('打开夜间运维值班表编辑器 ↗', 'Open Duty Roster Editor ↗'))}
                    </a>
                </div>
            </div>
        </div>
    `;
}

async function renderDataImportPageSettings(content) {
    const text = navLocaleText;
    content.innerHTML = `<div class="nav-settings-help">${navEscape(text('正在读取导入设置…', 'Loading import settings…'))}</div>`;
    try {
        const response = await fetch('/api/upload/import-settings', { headers: getAuthHeaderForNav(), cache: 'no-store' });
        const settings = await response.json();
        if (!response.ok) throw new Error(settings.error || `HTTP ${response.status}`);
        if (navState.settingsTab !== 'page:sla' || !content.isConnected) return;
        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(text('开启时，先保存所有选中文件的完整原表，包括全部月份、全部工作表，再按目标月份筛选、清洗和提取指标。没有提取规则的表格也会保存。', 'When enabled, all selected original files, months and worksheets are saved before target-month filtering, cleaning and metric extraction. Tables without extraction rules are also archived.'))}</div>
            <div class="nav-settings-row" style="flex-wrap:wrap;gap:12px">
                <label class="nav-settings-check"><input id="navUploadOriginals" type="checkbox" ${settings.uploadOriginals ? 'checked' : ''}><span>${navEscape(text('原始数据上传到服务器（默认开启）', 'Upload original data to the server (on by default)'))}</span></label>
            </div>
            <div class="nav-settings-help" style="margin-top:12px">${navEscape(text('关闭后仍正常提取指标并保存快照，只停止新增原文件及全部工作表存档。已保存的原始表不会删除。此设置作用于当前租户，自动保存。', 'When disabled, metric extraction and snapshots continue; new original files and full worksheets are not archived. Existing archives are retained. This setting is saved automatically for the current tenant.'))}</div>`;
        content.querySelector('#navUploadOriginals').addEventListener('change', async event => {
            const checkbox = event.target;
            const enabled = checkbox.checked;
            const indicator = document.getElementById('navSettingsSaveState');
            checkbox.disabled = true;
            if (indicator) indicator.textContent = navT('nav.set.saving');
            try {
                const saved = await fetch('/api/upload/import-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }, body: JSON.stringify({ uploadOriginals: enabled }) });
                const data = await saved.json();
                if (!saved.ok) throw new Error(data.error || `HTTP ${saved.status}`);
                checkbox.checked = data.uploadOriginals;
                if (indicator) indicator.textContent = navT('nav.set.saved');
            } catch (error) {
                checkbox.checked = !enabled;
                if (indicator) indicator.textContent = navT('nav.set.saveFail') + error.message;
            } finally { checkbox.disabled = false; }
        });
    } catch (error) {
        if (navState.settingsTab !== 'page:sla' || !content.isConnected) return;
        content.innerHTML = `<div class="nav-settings-help">${navEscape(text('导入设置读取失败：', 'Unable to load import settings: ') + error.message)}</div><button type="button" class="nav-settings-add" data-retry-import-settings>${navEscape(text('重试', 'Retry'))}</button>`;
        content.querySelector('[data-retry-import-settings]').addEventListener('click', () => renderDataImportPageSettings(content));
    }
}

function renderHomePageSettings(content) {
    const tools = Array.isArray(navState.customTools) ? navState.customTools : [];
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.page.home.help'))}</div>
        <div class="nav-settings-list">
            ${tools.map(tool => `
                <div class="nav-settings-row">
                    <div class="nav-settings-item-name">
                        ${navEscape(tool.icon || '🧩')} ${navEscape(tool.name || tool.slug)}
                        <div style="font-size:11px;color:#7b8794;font-weight:500;margin-top:4px;">/custom-tools/${navEscape(tool.slug)}/index.html</div>
                    </div>
                    <label class="nav-settings-check" style="margin-left:auto;">
                        <input type="checkbox" ${tool.publicAccess === true ? 'checked' : ''} onchange="setCustomToolPublicAccess('${navEscape(tool.slug)}', this.checked, this)">
                        <span>${navEscape(tool.publicAccess === true ? navT('nav.page.home.public') : navT('nav.page.home.private'))}</span>
                    </label>
                </div>
            `).join('') || `<div class="nav-settings-empty">${navEscape(navT('nav.page.home.empty'))}</div>`}
        </div>
    `;
}

window.setCustomToolPublicAccess = async function (slug, publicAccess, checkbox) {
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.set.saving');
    if (checkbox) checkbox.disabled = true;
    try {
        const res = await fetch(`/api/custom-tools/${encodeURIComponent(slug)}/access`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
            body: JSON.stringify({ publicAccess })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const index = navState.customTools.findIndex(item => item.slug === slug);
        if (index >= 0) navState.customTools[index] = data.tool;
        writeNavigationBootstrapCache();
        if (indicator) indicator.textContent = navT('nav.set.saved');
        renderHomePageSettings(document.getElementById('navSettingsContent'));
    } catch (err) {
        if (checkbox) checkbox.checked = !publicAccess;
        if (indicator) indicator.textContent = navT('nav.set.saveFail') + err.message;
    } finally {
        if (checkbox) checkbox.disabled = false;
    }
};

function renderReportPageSettings(content) {
    content.innerHTML = `
        <div class="nav-settings-help">${navEscape(navT('nav.page.report.help'))}</div>
        <div class="nav-report-cleanup-card nav-report-transfer-card">
            <div class="nav-report-cleanup-main">
                <div class="nav-backup-panel-title">${navEscape(navT('nav.page.report.backupTitle'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.page.report.backupDesc'))}</div>
                <label class="nav-report-cleanup-field">
                    <span>${navEscape(navT('nav.page.report.importMode'))}</span>
                    <select id="reportDataRestoreMode" onchange="updateReportDataRestoreHint()">
                        <option value="merge" selected>${navEscape(navT('nav.page.report.modeMerge'))}</option>
                        <option value="replace">${navEscape(navT('nav.page.report.modeReplace'))}</option>
                    </select>
                </label>
                <div id="reportDataRestoreHint" class="nav-backup-panel-desc">${navEscape(navT('nav.page.report.modeMergeHint'))}</div>
                <input id="reportDataBackupFile" type="file" accept=".zip,application/zip" hidden onchange="importReportDataBackup(this)">
            </div>
            <div class="nav-backup-toolbar nav-report-transfer-actions">
                <button onclick="exportReportDataBackup()">${navEscape(navT('nav.page.report.exportButton'))}</button>
                <button onclick="document.getElementById('reportDataBackupFile').click()">${navEscape(navT('nav.page.report.chooseImport'))}</button>
            </div>
        </div>
        <div id="reportDataTransferResult" class="nav-report-cleanup-result" hidden></div>
        <div class="nav-report-cleanup-card">
            <div class="nav-report-cleanup-main">
                <div class="nav-backup-panel-title">${navEscape(navT('nav.page.report.title'))}</div>
                <div class="nav-backup-panel-desc">${navEscape(navT('nav.page.report.desc'))}</div>
                <label class="nav-report-cleanup-field">
                    <span>${navEscape(navT('nav.page.report.mode'))}</span>
                    <select id="reportSnapshotCleanupMode" onchange="updateReportSnapshotCleanupFields()">
                        <option value="latest-only">${navEscape(navT('nav.page.report.modeLatest'))}</option>
                        <option value="retain-days">${navEscape(navT('nav.page.report.modeRetain'))}</option>
                    </select>
                </label>
                <label id="reportSnapshotCleanupDaysField" class="nav-report-cleanup-field" hidden>
                    <span>${navEscape(navT('nav.page.report.retainLast'))}</span>
                    <input id="reportSnapshotCleanupDays" type="number" min="1" max="3650" step="1" value="30">
                    <span>${navEscape(navT('nav.page.report.days'))}</span>
                </label>
            </div>
            <div class="nav-backup-toolbar">
                <button onclick="previewReportSnapshotCleanup()">${navEscape(navT('nav.page.report.btnPreview'))}</button>
                <button class="danger" onclick="runReportSnapshotCleanup()">${navEscape(navT('nav.page.report.btnRun'))}</button>
            </div>
        </div>
        <div id="reportSnapshotCleanupResult" class="nav-report-cleanup-result">${navEscape(navT('nav.page.report.wait'))}</div>
    `;
}

window.updateReportDataRestoreHint = function () {
    const mode = document.getElementById('reportDataRestoreMode')?.value === 'replace' ? 'replace' : 'merge';
    const hint = document.getElementById('reportDataRestoreHint');
    if (hint) hint.textContent = navT(mode === 'replace' ? 'nav.page.report.modeReplaceHint' : 'nav.page.report.modeMergeHint');
};

function reportBackupDownloadName(response) {
    const disposition = response.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return match?.[1] || `tools-report-data-${new Date().toISOString().slice(0, 10)}.zip`;
}

window.exportReportDataBackup = async function () {
    await runGlobalBackupAction(navLocaleText('正在生成报表独立备份...', 'Creating report data backup...'), async () => {
        const response = await fetch('/api/db/report-data-backup/export', { headers: getAuthHeaderForNav() });
        if (!response.ok) throw new Error(await describeLogoBundleFailure(response));
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = reportBackupDownloadName(response);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { success: true };
    });
};

function renderReportDataTransferResult(data) {
    const result = document.getElementById('reportDataTransferResult');
    if (!result) return;
    const counts = data.counts || {};
    result.hidden = false;
    result.textContent = navT('nav.page.report.importDone', {
        sla: counts.slaSnapshots || 0,
        reports: counts.reportSnapshots || 0,
        scores: counts.reportCategoryScores || 0,
        metrics: counts.reportMetricData || 0,
        attachments: counts.attachments || 0
    });
}

window.importReportDataBackup = async function (input) {
    const file = input?.files?.[0];
    if (!file) return;
    const mode = document.getElementById('reportDataRestoreMode')?.value === 'replace' ? 'replace' : 'merge';
    let confirmationText = '';
    try {
        if (mode === 'replace') {
            const confirmed = await showNavbarTypedConfirm({
                title: navT('nav.page.report.replaceConfirmTitle'),
                message: navT('nav.page.report.replaceConfirmWarning'),
                hint: navT('nav.page.report.replaceConfirmHint'),
                placeholder: navT('nav.page.report.replaceConfirmPlaceholder'),
                requiredText: '确认清空恢复',
                cancelText: navT('nav.set.restore.cancel'),
                confirmText: navT('nav.page.report.replaceConfirmAction')
            });
            if (!confirmed) return;
            confirmationText = '确认清空恢复';
        }
        await runGlobalBackupAction(navLocaleText('正在导入报表历史数据...', 'Importing report history...'), async () => {
            const form = new FormData();
            form.append('backup', file);
            form.append('mode', mode);
            if (confirmationText) form.append('confirmationText', confirmationText);
            const response = await fetch('/api/db/report-data-backup/import', {
                method: 'POST',
                headers: getAuthHeaderForNav(),
                body: form
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
            renderReportDataTransferResult(data);
            return data;
        });
    } finally {
        if (input) input.value = '';
    }
};

function getReportSnapshotCleanupDays() {
    const input = document.getElementById('reportSnapshotCleanupDays');
    return Math.max(1, Math.min(3650, parseInt(input?.value, 10) || 30));
}

function getReportSnapshotCleanupMode() {
    const select = document.getElementById('reportSnapshotCleanupMode');
    return select?.value === 'retain-days' ? 'retain-days' : 'latest-only';
}

window.updateReportSnapshotCleanupFields = function () {
    const field = document.getElementById('reportSnapshotCleanupDaysField');
    if (field) field.hidden = getReportSnapshotCleanupMode() !== 'retain-days';
};

function renderReportSnapshotCleanupResult(result) {
    const el = document.getElementById('reportSnapshotCleanupResult');
    if (!el) return;
    const removedPreview = (result.removed || []).slice(0, 8)
        .map(item => `<li>${navEscape(item.date || '-')} · ${navEscape(item.timestamp || '-')} · ${navEscape(item.id || '-')}</li>`)
        .join('');
    const titleText = result.dryRun ? navT('nav.page.report.res.preview') : navT('nav.page.report.res.done');
    const summaryKey = result.mode === 'latest-only'
        ? 'nav.page.report.res.summaryLatest'
        : 'nav.page.report.res.summaryRetain';
    const summaryText = navT(summaryKey, { days: result.days, beforeCount: result.beforeCount, afterCount: result.afterCount, removedCount: result.removedCount })
        .replace('{days}', result.days).replace('{beforeCount}', result.beforeCount).replace('{afterCount}', result.afterCount).replace('{removedCount}', result.removedCount);
    const keptText = navT('nav.page.report.res.keptLatest', { latestSnapshotId: result.latestSnapshotId || '-' }).replace('{latestSnapshotId}', result.latestSnapshotId || '-');
    const emptyText = navT('nav.page.report.res.empty');
    const moreText = result.removedCount > 8 ? navT('nav.page.report.res.more', { remaining: result.removedCount - 8 }).replace('{remaining}', result.removedCount - 8) : '';

    el.innerHTML = `
        <div><strong>${navEscape(titleText)}</strong></div>
        <div>${navEscape(summaryText)}</div>
        <div>${navEscape(keptText)}</div>
        <div>${navEscape(navT('nav.page.report.res.archiveSafe'))}</div>
        ${removedPreview ? `<ul>${removedPreview}</ul>` : `<div>${navEscape(emptyText)}</div>`}
        ${moreText ? `<div>${navEscape(moreText)}</div>` : ''}
    `;
}

async function requestReportSnapshotCleanup(dryRun, confirmationText = '') {
    const res = await fetch('/api/sla/snapshots/cleanup-redundant', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaderForNav()
        },
        body: JSON.stringify({
            days: getReportSnapshotCleanupDays(),
            mode: getReportSnapshotCleanupMode(),
            dryRun,
            confirmationText
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

window.previewReportSnapshotCleanup = async function () {
    await runGlobalBackupAction('正在预览快照清理...', async () => {
        const result = await requestReportSnapshotCleanup(true);
        renderReportSnapshotCleanupResult(result);
        return result;
    });
};

window.runReportSnapshotCleanup = async function () {
    const days = getReportSnapshotCleanupDays();
    const mode = getReportSnapshotCleanupMode();
    const preview = await requestReportSnapshotCleanup(true);
    renderReportSnapshotCleanupResult(preview);
    if (!preview.removedCount) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.page.report.res.empty'), tone: 'info' });
    let confirmationText = '';
    let ok = false;
    if (mode === 'latest-only') {
        ok = await showNavbarTypedConfirm({
            title: navT('nav.page.report.confirmLatestTitle'),
            message: navT('nav.page.report.confirmLatestWarning', { count: preview.removedCount }).replace('{count}', preview.removedCount),
            hint: navT('nav.page.report.confirmLatestHint'),
            placeholder: navT('nav.page.report.confirmLatestPlaceholder'),
            requiredText: '确认删除',
            cancelText: navT('nav.set.restore.cancel'),
            confirmText: navT('nav.page.report.confirmLatestAction')
        });
        confirmationText = ok ? '确认删除' : '';
    } else {
        const confirmText = navT('nav.page.report.confirmRetain', { count: preview.removedCount, days })
            .replace('{count}', preview.removedCount)
            .replace('{days}', days);
        ok = await showNavbarConfirm({
            title: navLocaleText('清理报表快照', 'Clean report snapshots'),
            message: confirmText,
            hint: navLocaleText('系统将按照当前保留策略删除冗余快照。', 'Redundant snapshots will be deleted using the current retention policy.'),
            tone: 'danger',
            confirmText: navLocaleText('确认清理', 'Clean snapshots')
        });
    }
    if (!ok) return;
    await runGlobalBackupAction('正在清理冗余快照...', async () => {
        const result = await requestReportSnapshotCleanup(false, confirmationText);
        renderReportSnapshotCleanupResult(result);
        return result;
    });
};

function ensureNavbarTypedConfirmDialog() {
    let modal = document.getElementById('navbarTypedConfirmModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'navbarTypedConfirmModal';
    modal.className = 'nav-confirm-modal nav-confirm-modal-danger';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
        <div class="nav-confirm-backdrop" onclick="resolveNavbarTypedConfirm(false)"></div>
        <section class="nav-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="navbarTypedConfirmTitle" aria-describedby="navbarTypedConfirmMessage navbarTypedConfirmHint">
            <div class="nav-confirm-danger-label">⚠ 不可撤销的删除操作</div>
            <div class="nav-confirm-copy">
                <h3 id="navbarTypedConfirmTitle"></h3>
                <p id="navbarTypedConfirmMessage"></p>
                <div class="nav-confirm-hint" id="navbarTypedConfirmHint"></div>
                <input id="navbarTypedConfirmInput" class="nav-confirm-type-input" type="text" autocomplete="off" spellcheck="false">
            </div>
            <div class="nav-confirm-actions">
                <button type="button" class="nav-confirm-cancel" onclick="resolveNavbarTypedConfirm(false)"></button>
                <button type="button" class="nav-confirm-submit" onclick="resolveNavbarTypedConfirm(true)" disabled></button>
            </div>
        </section>`;
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            window.resolveNavbarTypedConfirm(false);
        }
    });
    document.body.appendChild(modal);
    return modal;
}

function showNavbarTypedConfirm({ title, message, hint, placeholder, requiredText, cancelText, confirmText }) {
    const modal = ensureNavbarTypedConfirmDialog();
    if (navTypedConfirmResolver) {
        navTypedConfirmResolver(false);
        navTypedConfirmResolver = null;
    }
    modal.querySelector('#navbarTypedConfirmTitle').textContent = title || '';
    modal.querySelector('#navbarTypedConfirmMessage').textContent = message || '';
    modal.querySelector('#navbarTypedConfirmHint').textContent = hint || '';
    const input = modal.querySelector('#navbarTypedConfirmInput');
    const submit = modal.querySelector('.nav-confirm-submit');
    input.value = '';
    input.placeholder = placeholder || '';
    submit.textContent = confirmText || '确认删除';
    submit.disabled = true;
    input.oninput = () => { submit.disabled = input.value.trim() !== requiredText; };
    input.onkeydown = event => {
        if (event.key === 'Enter' && !submit.disabled) {
            event.preventDefault();
            window.resolveNavbarTypedConfirm(true);
        }
    };
    modal.querySelector('.nav-confirm-cancel').textContent = cancelText || '取消';
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => input.focus());
    return new Promise(resolve => { navTypedConfirmResolver = resolve; });
}

window.resolveNavbarTypedConfirm = function (confirmed) {
    const modal = document.getElementById('navbarTypedConfirmModal');
    const submit = modal?.querySelector('.nav-confirm-submit');
    if (confirmed && submit?.disabled) return;
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    const resolve = navTypedConfirmResolver;
    navTypedConfirmResolver = null;
    if (resolve) resolve(Boolean(confirmed));
};

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

function startAlertCenterPolling(intervalMs = 60000) {
    stopAlertCenterPolling();
    if (!hasNavAuthToken()) return;
    alertCenterPollTimer = setInterval(refreshAlertCenterBadge, intervalMs);
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

async function fetchSecuritySettingsForNav() {
    const [settings, locks] = await Promise.all([
        API.get('/api/auth/security/settings'),
        API.get('/api/auth/security/locks')
    ]);
    navState.securitySettings = settings;
    navState.securityLocks = locks;
    return settings;
}

function renderSecurityPolicyRows(kind, rows) {
    return (rows || []).map((policy, index) => `
        <tr>
            <td data-label="${navEscape(navT('nav.sec.thEnabled'))}"><input type="checkbox" ${policy.enabled !== false ? 'checked' : ''} onchange="updateSecurityPolicy('${kind}', ${index}, 'enabled', this.checked)"></td>
            <td data-label="${navEscape(navT('nav.sec.thCount'))}"><input class="nav-settings-input nav-security-number" type="number" min="1" max="1000" step="1" value="${navEscape(policy.count)}" oninput="updateSecurityPolicy('${kind}', ${index}, 'count', this.value)"></td>
            <td data-label="${navEscape(navT('nav.sec.thWindow'))}"><input class="nav-settings-input nav-security-number" type="number" min="1" max="10080" step="1" value="${navEscape(policy.windowMinutes)}" oninput="updateSecurityPolicy('${kind}', ${index}, 'windowMinutes', this.value)"></td>
            <td data-label="${navEscape(navT('nav.sec.thLock'))}"><input class="nav-settings-input nav-security-number" type="number" min="1" max="10080" step="1" value="${navEscape(policy.lockMinutes)}" oninput="updateSecurityPolicy('${kind}', ${index}, 'lockMinutes', this.value)"></td>
            <td data-label="${navEscape(navT('nav.sec.thSeverity'))}">
                <select class="nav-settings-input nav-security-severity" onchange="updateSecurityPolicy('${kind}', ${index}, 'severity', this.value)">
                    ${['info', 'warn', 'error', 'critical'].map(level => `<option value="${level}" ${policy.severity === level ? 'selected' : ''}>${level}</option>`).join('')}
                </select>
            </td>
        </tr>
    `).join('');
}

function renderSecurityPolicyTable(title, kind, rows) {
    return `
        <div class="nav-security-section">
            <div class="nav-security-section-title">${navEscape(title)}</div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table nav-security-table">
                    <thead>
                        <tr>
                            <th>${navEscape(navT('nav.sec.thEnabled'))}</th>
                            <th>${navEscape(navT('nav.sec.thCount'))}</th>
                            <th>${navEscape(navT('nav.sec.thWindow'))}</th>
                            <th>${navEscape(navT('nav.sec.thLock'))}</th>
                            <th>${navEscape(navT('nav.sec.thSeverity'))}</th>
                        </tr>
                    </thead>
                    <tbody>${renderSecurityPolicyRows(kind, rows)}</tbody>
                </table>
            </div>
        </div>
    `;
}

function getSecurityLockTarget(lock) {
    return lock.lock_type === 'account' ? lock.username : lock.ip;
}

function renderSecurityLocksTable() {
    const locks = navState.securityLocks || [];
    const rows = locks.map(lock => `
        <tr>
            <td>${navEscape(lock.lock_type)}</td>
            <td>${navEscape(getSecurityLockTarget(lock))}</td>
            <td>${navEscape(lock.reason || '')}</td>
            <td>${navEscape(lock.fail_count || 0)}</td>
            <td>${navEscape(lock.locked_until || '')}</td>
            <td class="nav-account-actions">
                <button onclick="unlockSecurityLock('${navEscape(lock.lock_key)}')">${navEscape(navT('nav.sec.btnUnlock'))}</button>
            </td>
        </tr>
    `).join('');
    return `
        <div class="nav-security-section">
            <div class="nav-security-lock-head">
                <div class="nav-security-section-title">${navEscape(navT('nav.sec.locksTitle'))}</div>
                <button class="nav-settings-add" onclick="reloadSecurityLocks()">${navEscape(navT('nav.sec.btnRefresh'))}</button>
            </div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table">
                    <thead>
                        <tr>
                            <th>${navEscape(navT('nav.sec.thType'))}</th>
                            <th>${navEscape(navT('nav.sec.thTarget'))}</th>
                            <th>${navEscape(navT('nav.sec.thReason'))}</th>
                            <th>${navEscape(navT('nav.sec.thFailCount'))}</th>
                            <th>${navEscape(navT('nav.sec.thUntil'))}</th>
                            <th>${navEscape(navT('nav.acc.thAction'))}</th>
                        </tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="6">${navEscape(navT('nav.sec.noLocks'))}</td></tr>`}</tbody>
                </table>
            </div>
        </div>
    `;
}

async function renderSecuritySettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.sec.empty'))}</div>`;
    try {
        const settings = await fetchSecuritySettingsForNav();
        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.sec.help'))}</div>
            <div class="nav-security-grid">
                <label class="nav-security-toggle">
                    <input type="checkbox" id="navSecurityEnabled" ${settings.enabled !== false ? 'checked' : ''} onchange="scheduleSecuritySettingsSave()">
                    <span>${navEscape(navT('nav.sec.enabled'))}</span>
                </label>
                <label class="nav-security-toggle">
                    <input type="checkbox" id="navSecurityAlertOnLock" ${settings.alertOnLock !== false ? 'checked' : ''} onchange="scheduleSecuritySettingsSave()">
                    <span>${navEscape(navT('nav.sec.alertOnLock'))}</span>
                </label>
                <label class="nav-ai-field">
                    <span>${navEscape(navT('nav.sec.sessionHours'))}</span>
                    <input id="navSecuritySessionHours" class="nav-settings-input" type="number" min="1" max="720" step="1" value="${navEscape(settings.sessionMaxAgeHours || 168)}" oninput="scheduleSecuritySettingsSave()">
                </label>
            </div>
            ${renderSecurityPolicyTable(navT('nav.sec.accountPolicy'), 'accountLockPolicies', settings.accountLockPolicies)}
            ${renderSecurityPolicyTable(navT('nav.sec.ipPolicy'), 'ipLockPolicies', settings.ipLockPolicies)}
            ${renderSecurityPolicyTable(navT('nav.sec.multiPolicy'), 'ipMultiUserPolicies', settings.ipMultiUserPolicies)}
            ${renderSecurityLocksTable()}
        `;
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.sec.failLoad'))}${navEscape(e.message)}</div>`;
    }
}

function collectSecuritySettingsPayload() {
    const current = navState.securitySettings || {};
    return {
        enabled: document.getElementById('navSecurityEnabled')?.checked !== false,
        alertOnLock: document.getElementById('navSecurityAlertOnLock')?.checked !== false,
        sessionMaxAgeHours: Number(document.getElementById('navSecuritySessionHours')?.value || current.sessionMaxAgeHours || 168),
        accountLockPolicies: current.accountLockPolicies || [],
        ipLockPolicies: current.ipLockPolicies || [],
        ipMultiUserPolicies: current.ipMultiUserPolicies || []
    };
}

window.updateSecurityPolicy = function (kind, index, field, value) {
    if (!navState.securitySettings || !Array.isArray(navState.securitySettings[kind])) return;
    const policy = navState.securitySettings[kind][index];
    if (!policy) return;
    policy[field] = field === 'enabled' ? Boolean(value) : (field === 'severity' ? value : Number(value));
    scheduleSecuritySettingsSave();
};

window.scheduleSecuritySettingsSave = function () {
    if (!navState.securitySettings) return;
    const indicator = document.getElementById('navSettingsSaveState');
    if (indicator) indicator.textContent = navT('nav.sec.saving');
    clearTimeout(navState.securitySaveTimer);
    navState.securitySaveTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/auth/security/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaderForNav()
                },
                body: JSON.stringify(collectSecuritySettingsPayload())
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            navState.securitySettings = await res.json();
            if (indicator) indicator.textContent = navT('nav.sec.saved');
        } catch (e) {
            if (indicator) indicator.textContent = navT('nav.set.saveFail') + e.message;
        }
    }, 420);
};

window.reloadSecurityLocks = async function () {
    const content = document.getElementById('navSettingsContent');
    try {
        navState.securityLocks = await API.get('/api/auth/security/locks');
        if (content && navState.settingsTab === 'security') renderSecuritySettings(content);
    } catch (e) {
        const indicator = document.getElementById('navSettingsSaveState');
        if (indicator) indicator.textContent = navT('nav.sec.failLoad') + e.message;
    }
};

window.unlockSecurityLock = async function (lockKey) {
    const res = await fetch(`/api/auth/security/locks/${encodeURIComponent(lockKey)}`, {
        method: 'DELETE',
        headers: getAuthHeaderForNav()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await window.reloadSecurityLocks();
};

async function renderAccountSettings(content) {
    content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.acc.empty'))}</div>`;
    try {
        const users = await API.get('/api/auth/users');
        const rows = users.map(u => {
            const roleBadge = u.role === 'admin'
                ? `<span class="nav-account-role admin">${navEscape(navT('nav.acc.admin'))}</span>`
                : `<span class="nav-account-role readonly">${navEscape(navT('nav.acc.readonly'))}</span>`;
            return `
                <tr>
                    <td>${navEscape(u.username)}</td>
                    <td>${roleBadge}</td>
                    <td class="nav-account-actions">
                        ${u.username !== 'admin' ? `<button onclick="deleteUser('${navEscape(u.username)}')">${navEscape(navT('nav.acc.btnDel'))}</button>` : ''}
                        <button onclick="resetPwd('${navEscape(u.username)}')">${navEscape(navT('nav.acc.btnReset'))}</button>
                    </td>
                </tr>
            `;
        }).join('');

        content.innerHTML = `
            <div class="nav-settings-help">${navEscape(navT('nav.acc.help'))}</div>
            <div class="nav-account-create">
                <input id="nu_name" placeholder="${navEscape(navT('nav.acc.plhUser'))}">
                <input id="nu_pwd" placeholder="${navEscape(navT('nav.acc.plhPwd'))}" type="password">
                <select id="nu_role">
                    <option value="readonly">${navEscape(navT('nav.acc.readonly'))}</option>
                    <option value="admin">${navEscape(navT('nav.acc.admin'))}</option>
                </select>
                <button onclick="addUser()">${navEscape(navT('nav.acc.btnAdd'))}</button>
            </div>
            <div class="nav-account-table-wrap">
                <table class="nav-account-table">
                    <thead>
                        <tr><th>${navEscape(navT('nav.acc.thUser'))}</th><th>${navEscape(navT('nav.acc.thRole'))}</th><th>${navEscape(navT('nav.acc.thAction'))}</th></tr>
                    </thead>
                    <tbody>${rows || `<tr><td colspan="3">${navEscape(navT('nav.acc.noData'))}</td></tr>`}</tbody>
                </table>
            </div>
        `;
    } catch (e) {
        content.innerHTML = `<div class="nav-settings-empty">${navEscape(navT('nav.acc.fail'))}${navEscape(e.message)}</div>`;
    }
}

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
    document.cookie = 'tools_token=; path=/; max-age=0';
    window.location.href = '/login.html';
};

window.openUserModal = async function () {
    if (localStorage.getItem('tools_role') !== 'admin') return;

    let m = document.getElementById('user-mgmt-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'user-mgmt-modal';
        m.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(15,23,42,0.6); backdrop-filter:blur(4px); z-index:99999; display:none; align-items:center; justify-content:center;';
        document.body.appendChild(m);
    }

    try {
        const res = await API.get('/api/auth/users');

        let trs = res.map(u => {
            const roleBadge = u.role === 'admin'
                ? '<span style="background:#e0e7ff; color:#4338ca; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid #c7d2fe;">超级管理</span>'
                : '<span style="background:#f1f5f9; color:#64748b; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600; border:1px solid #e2e8f0;">只读用户</span>';

            return `
            <tr style="transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding:14px 16px; border-bottom:1px solid #f1f5f9; font-weight:500; color:#334155;">${u.username}</td>
                <td style="padding:14px 16px; border-bottom:1px solid #f1f5f9;">${roleBadge}</td>
                <td style="padding:14px 16px; border-bottom:1px solid #f1f5f9; text-align:right;">
                    ${u.username !== 'admin' ? `<button onclick="deleteUser('${u.username}')" onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fef2f2'" style="background:#fef2f2; color:#ef4444; border:1px solid #fee2e2; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.2s;">删除</button>` : ''}
                    <button onclick="resetPwd('${u.username}')" onmouseover="this.style.background='#e0f2fe'" onmouseout="this.style.background='#f0f9ff'" style="background:#f0f9ff; color:#0284c7; border:1px solid #e0f2fe; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.2s; margin-left:8px;">重置密码</button>
                </td>
            </tr>
            `;
        }).join('');

        m.innerHTML = `
            <div style="background:#ffffff; width:650px; max-width:90%; padding:32px; border-radius:16px; box-shadow:0 20px 40px rgba(0,0,0,0.2); position:relative; animation: fadeIn 0.3s ease;">
                <button onclick="document.getElementById('user-mgmt-modal').style.display='none'" style="position:absolute; top:24px; right:24px; background:none; border:none; font-size:24px; color:#94a3b8; cursor:pointer; line-height:1; transition:color 0.2s;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'">&times;</button>
                
                <h3 style="margin-top:0; margin-bottom:24px; font-size:20px; font-weight:700; color:#1e293b; display:flex; align-items:center; gap:8px; border-bottom:2px solid #f1f5f9; padding-bottom:16px;">
                    👥 账号管理与权限
                </h3>
                
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:16px; margin-bottom:24px;">
                    <div style="font-size:13px; font-weight:600; color:#475569; margin-bottom:12px;">➕ 新增账号</div>
                    <div style="display:flex; gap:12px;">
                        <input id="nu_name" placeholder="输入新用户名" style="flex:1; padding:10px 14px; border:1px solid #cbd5e1; border-radius:8px; outline:none; font-size:14px; transition:border-color 0.2s, box-shadow 0.2s;" onfocus="this.style.borderColor='#3b82f6'; this.style.boxShadow='0 0 0 3px rgba(59,130,246,0.1)'" onblur="this.style.borderColor='#cbd5e1'; this.style.boxShadow='none'">
                        <input id="nu_pwd" placeholder="设置密码" style="flex:1; padding:10px 14px; border:1px solid #cbd5e1; border-radius:8px; outline:none; font-size:14px; transition:border-color 0.2s, box-shadow 0.2s;" onfocus="this.style.borderColor='#3b82f6'; this.style.boxShadow='0 0 0 3px rgba(59,130,246,0.1)'" onblur="this.style.borderColor='#cbd5e1'; this.style.boxShadow='none'">
                        <select id="nu_role" style="padding:10px 14px; border:1px solid #cbd5e1; border-radius:8px; outline:none; font-size:14px; background:#fff; cursor:pointer;">
                            <option value="readonly">只读权限</option>
                            <option value="admin">超级管理</option>
                        </select>
                        <button onclick="addUser()" style="background:#10b981; color:#fff; border:none; padding:10px 20px; border-radius:8px; font-weight:600; cursor:pointer; transition:background 0.2s; box-shadow:0 2px 4px rgba(16,185,129,0.2);" onmouseover="this.style.background='#059669'" onmouseout="this.style.background='#10b981'">新增</button>
                    </div>
                </div>
                
                <div style="border:1px solid #e2e8f0; border-radius:12px; overflow:hidden;">
                    <table style="width:100%; border-collapse:collapse; text-align:left;">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0;">
                                <th style="padding:12px 16px; font-size:13px; font-weight:600; color:#64748b;">账号名称</th>
                                <th style="padding:12px 16px; font-size:13px; font-weight:600; color:#64748b;">权限角色</th>
                                <th style="padding:12px 16px; font-size:13px; font-weight:600; color:#64748b; text-align:right;">快捷操作</th>
                            </tr>
                        </thead>
                        <tbody>${trs}</tbody>
                    </table>
                </div>
                
                <div style="text-align:right; margin-top:24px;">
                    <button onclick="document.getElementById('user-mgmt-modal').style.display='none'" style="background:#f1f5f9; color:#475569; border:none; padding:10px 24px; border-radius:8px; font-weight:600; font-size:14px; cursor:pointer; transition:background 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">完成并关闭</button>
                </div>
            </div>
        `;
        m.style.display = 'flex';
    } catch (e) {
        await showNavbarNotice({
            title: navT('nav.dialog.error'),
            message: navLocaleText('获取用户列表失败：', 'Failed to load accounts: ') + e.message,
            tone: 'error'
        });
    }
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
        toolsKnowledgeGraphLoader = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[src*="/js/shared/ai-knowledge-graph"]');
            const script = existing || document.createElement('script');
            const handleLoad = () => resolve();
            const handleError = () => reject(new Error('知识图谱组件加载失败'));
            script.addEventListener('load', handleLoad, { once: true });
            script.addEventListener('error', handleError, { once: true });
            if (!existing) {
                script.src = '/js/shared/ai-knowledge-graph-spatial-themes-v5.js';
                document.body.appendChild(script);
            }
        }).catch(error => {
            toolsKnowledgeGraphLoader = null;
            throw error;
        });
    }
    return toolsKnowledgeGraphLoader.then(() => {
        if (!window.AIKnowledgeGraph?.open) throw new Error('知识图谱组件初始化失败');
        window.AIKnowledgeGraph.open(options);
    });
};

let toolsAiAssistantLoader = null;
window.openToolsAIAssistant = function (options = {}) {
    if (window.ToolsAIAssistant?.open) return window.ToolsAIAssistant.open(options);
    if (!toolsAiAssistantLoader) {
        toolsAiAssistantLoader = new Promise((resolve, reject) => {
            const existing = document.querySelector('script[src^="/js/shared/ai-assistant.js"]');
            const script = existing || document.createElement('script');
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', () => reject(new Error('AI 助手组件加载失败')), { once: true });
            if (!existing) {
                script.src = '/js/shared/ai-assistant.js';
                document.body.appendChild(script);
            }
        }).catch(error => {
            toolsAiAssistantLoader = null;
            throw error;
        });
    }
    return toolsAiAssistantLoader.then(() => {
        if (!window.ToolsAIAssistant?.open) throw new Error('AI 助手组件初始化失败');
        return window.ToolsAIAssistant.open(options);
    });
};

(function () {
    // 华子胶片设计工具内置了自己的 AI 助手，避免重复显示全局悬浮入口。
    if (window.location.pathname.startsWith('/tools/network_safety_meeting_summary')) return;
    // 公开的隐私/条款页在未登录时不请求受保护的 AI 接口，避免无效 401 日志。
    if (!hasNavAuthToken()) return;

    // 确保不重复加载
    if (!document.querySelector('script[src^="/js/shared/ai-assistant.js"]')) {
        const aiScript = document.createElement('script');
        aiScript.src = '/js/shared/ai-assistant.js';
        document.body.appendChild(aiScript);
    }
})();

window.addUser = async function () {
    const username = document.getElementById('nu_name').value.trim();
    const password = document.getElementById('nu_pwd').value;
    const role = document.getElementById('nu_role').value;
    if (!username || !password) return showNavbarNotice({ title: navT('nav.dialog.notice'), message: navT('nav.acc.required'), tone: 'info' });
    try {
        await API.post('/api/auth/users', { username, password, role });
        await showNavbarNotice({
            title: navT('nav.acc.added'),
            message: navT('nav.acc.addedDesc').replace('{user}', username),
            tone: 'success'
        });
        if (document.getElementById('navSettingsModal')?.style.display === 'flex') renderNavSettingsContent();
        else openUserModal();
    } catch (e) {
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
    }
};
window.deleteUser = async function (u) {
    const confirmed = await showNavbarConfirm({
        title: navT('nav.acc.deleteTitle'),
        message: navT('nav.acc.deleteDesc').replace('{user}', u),
        hint: navLocaleText('账号删除不会清理其历史操作记录。', 'Deleting the account does not remove its historical audit records.'),
        tone: 'danger',
        confirmText: navT('nav.acc.btnDel')
    });
    if (!confirmed) return;
    try {
        await API.delete('/api/auth/users/' + u);
        if (document.getElementById('navSettingsModal')?.style.display === 'flex') renderNavSettingsContent();
        else openUserModal();
    } catch (e) {
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
    }
};
window.resetPwd = async function (u) {
    const values = await showNavbarFormDialog({
        title: navT('nav.acc.resetTitle'),
        message: navT('nav.acc.resetDesc').replace('{user}', u),
        fields: [{
            name: 'password',
            label: navT('nav.acc.newPassword'),
            placeholder: navT('nav.acc.plhPwd'),
            type: 'password',
            autocomplete: 'new-password',
            required: true,
            maxLength: 200
        }],
        icon: '●',
        confirmText: navT('nav.acc.btnReset')
    });
    if (!values?.password) return;
    try {
        await API.put('/api/auth/users/' + u + '/password', { password: values.password });
        await showNavbarNotice({
            title: navT('nav.acc.resetDone'),
            message: navT('nav.acc.resetDoneDesc').replace('{user}', u),
            tone: 'success'
        });
    } catch (e) {
        await showNavbarNotice({ title: navT('nav.dialog.error'), message: e.message, tone: 'error' });
    }
};

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
        if (!failures.length) {
            content.innerHTML = `<div class="service-failure-empty"><strong>${serviceStatusBi('暂无可查看的失败明细', 'No failure details available')}</strong><p>${serviceStatusBi('失败明细从本功能启用后开始记录，历史统计仍会保留。', 'Failure details are recorded after this feature is enabled; historical totals remain available.')}</p></div>`;
            return;
        }
        content.innerHTML = failures.map((failure, index) => `
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
        window.renderServiceRuntimeLogShell();
        window.loadServiceRuntimeLogs(1);
    } else {
        window.clearServiceRuntimeLogPolling();
        window.loadServiceStatusHistory();
    }
};

window.refreshServiceStatusView = function () {
    if (serviceStatusView === 'logs') window.loadServiceRuntimeLogs(serviceRuntimeLogPage);
    else window.loadServiceStatusHistory();
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
            <div class="service-runtime-log-summary" id="serviceRuntimeLogSummary"></div>
            <div class="service-runtime-log-list" id="serviceRuntimeLogList" aria-live="polite"></div>
            <div class="service-runtime-log-pagination" id="serviceRuntimeLogPagination"></div>
        </section>`;
    window.toggleServiceRuntimeLogPolling();
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

function serviceStatusRequest(url) {
    if (window.API?.get) return window.API.get(url);
    return fetch(url, {
        headers: localStorage.getItem('tools_token') ? { Authorization: `Bearer ${localStorage.getItem('tools_token')}` } : {}
    }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
    });
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
            const title = `${day.date} · ${serviceStateMeta(day.state).label}\n${serviceStatusBi('请求', 'Requests')}: ${day.requests} · ${serviceStatusBi('成功', 'Success')}: ${day.successes} · 4xx: ${day.clientErrors} · 5xx: ${day.serverErrors}\n${serviceStatusBi('平均响应', 'Avg response')}: ${day.averageDurationMs}ms`;
            const clickable = canInspectFailures && (day.clientErrors || day.serverErrors);
            const action = clickable ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','${navEscape(day.date)}','')"` : '';
            return `<button type="button" class="service-day-bar ${navEscape(day.state)} ${clickable ? 'clickable' : ''}" title="${navEscape(title)}" aria-label="${navEscape(title)}"${action}></button>`;
        }).join('');
        const name = window.ToolsI18n?.getLanguage?.() === 'en-US' ? service.nameEn : service.name;
        const description = window.ToolsI18n?.getLanguage?.() === 'en-US' ? service.descriptionEn : service.description;
        return `
            <article class="service-status-card" data-service-status-key="${navEscape(service.id)}" data-service-status-name="${navEscape(name)}">
                <div class="service-status-card-head">
                    <div><h3>${navEscape(name)}</h3><p>${navEscape(description)}</p></div>
                    <span class="service-state-icon ${navEscape(service.currentState)}" title="${navEscape(meta.label)}">${meta.icon}</span>
                </div>
                <div class="service-status-bars" style="--status-days:${data.days}">${bars}</div>
                <div class="service-status-axis"><span>${navEscape(data.startDate)}</span><b>${serviceAvailability} ${serviceStatusBi('可用率', 'availability')}</b><span>${navEscape(data.endDate)}</span></div>
                <div class="service-status-card-foot"><span class="service-state-label ${navEscape(service.currentState)}">${navEscape(meta.label)}</span><span>${Number(service.summary?.requests || 0).toLocaleString()} ${serviceStatusBi('次请求', 'requests')}</span><span>${Number(service.summary?.averageDurationMs || 0)}ms ${serviceStatusBi('平均', 'avg')}</span></div>
            </article>`;
    }).join('');
    content.innerHTML = `
        <section class="service-status-overview">
            <div class="service-status-current ${navEscape(overallMeta.state)}"><span class="service-state-icon ${navEscape(overallMeta.state)}">${overallMeta.icon}</span><div><small>${serviceStatusBi('当前状态', 'Current status')}</small><strong>${navEscape(overallMeta.label)}</strong><em class="${overallMeta.hasIssue ? 'warning' : ''}" title="${navEscape(overallMeta.detail)}">${navEscape(overallMeta.detail)}</em></div></div>
            <div class="service-status-license ${navEscape(licenseMeta.state)}"><span class="service-state-icon ${navEscape(licenseMeta.state)}">${licenseMeta.icon}</span><div><small>${serviceStatusBi('License 可用状态', 'License availability')}</small><strong>${navEscape(licenseMeta.label)}</strong><em title="${navEscape(licenseMeta.detail)}">${navEscape(licenseMeta.detail)}</em></div></div>
            <div class="service-status-stat"><small>${serviceStatusBi('可用率', 'Availability')}</small><strong>${availability}</strong></div>
            <div class="service-status-stat"><small>${serviceStatusBi('成功返回', 'Successful')}</small><strong>${Number(overall.successes || 0).toLocaleString()}</strong></div>
            ${failureStat('warning', serviceStatusBi('客户端失败 4xx', 'Client errors 4xx'), overall.clientErrors, '4xx')}
            ${failureStat('danger', serviceStatusBi('服务端失败 5xx', 'Server errors 5xx'), overall.serverErrors, '5xx')}
        </section>
        ${Number(overall.requests || 0) ? '' : `<div class="service-status-notice">${serviceStatusBi('状态历史从本功能启用后开始累计；暂无历史请求时显示为灰色。', 'History starts accumulating after this feature is enabled; days without requests are gray.')}</div>`}
        <section class="service-status-grid">${cards}</section>
        <div class="service-status-legend"><span><i class="operational"></i>${serviceStatusBi('正常', 'Operational')}</span><span><i class="degraded"></i>${serviceStatusBi('存在 4xx', 'Has 4xx')}</span><span><i class="incident"></i>${serviceStatusBi('存在 5xx', 'Has 5xx')}</span><span><i class="no-data"></i>${serviceStatusBi('无请求数据', 'No requests')}</span><em>${serviceStatusBi('可用率按“非 5xx 请求 ÷ 全部请求”计算。', 'Availability is calculated as non-5xx requests divided by all requests.')}</em></div>`;
}

window.loadServiceStatusHistory = async function () {
    const modal = ensureServiceStatusModal();
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    range.innerHTML = [30, 90, 180].map(days => `<button type="button" class="${days === serviceStatusDays ? 'active' : ''}" onclick="setServiceStatusDays(${days})">${days} ${serviceStatusBi('天', 'days')}</button>`).join('');
    content.innerHTML = `<div class="service-status-loading"><span></span>${serviceStatusBi('正在读取服务状态…', 'Loading service status…')}</div>`;
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status?days=${serviceStatusDays}`);
        if (modal.style.display !== 'none') renderServiceStatusHistory(data);
    } catch (error) {
        content.innerHTML = `<div class="service-status-error"><strong>${serviceStatusBi('服务状态读取失败', 'Unable to load service status')}</strong><p>${navEscape(error.message)}</p><button type="button" onclick="loadServiceStatusHistory()">${serviceStatusBi('重试', 'Retry')}</button></div>`;
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
        'uivf12', 'sla', 'report', 'expedite', 'monthly', 'bigscreen',
        'frt', 'requirements', 'praudit', 'storage', 'db-explorer'
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

    // 叠放在右侧停靠列（Dragon Claw、工作区标签）最上方，间距与停靠列一致
    function updateBackToTopPlacement() {
        const docked = Array.from(document.querySelectorAll('.ai-fab, #dcWorkspaceFab')).filter(element => {
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
            ? `<div class="builtin-sync-conflict-note">${navEscape(navLocaleText('此目录不是系统管理版本，可能是您的同名自定义工具，已默认不覆盖。', 'This directory is not managed by the system and may be your custom tool with the same name. Overwrite is unchecked by default.'))}</div>`
            : tool.localChanges ? `<div class="builtin-sync-conflict-note">${navEscape(navLocaleText('检测到本地修改或旧版校验信息不完整，已保留当前工具。确认后可手动勾选更新，旧目录会先备份。', 'Local changes or incomplete legacy verification data were detected. The current tool is preserved. Select it to update after review; the old folder will be backed up first.'))}</div>` : '';
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
                ${toolInfoDiff}
                ${manual ? `<div class="builtin-sync-versions">${navEscape(navLocaleText('当前来源', 'Current source'))}：${navEscape(tool.currentSource === 'market' ? navLocaleText('工具市场', 'Tool market') : navLocaleText('本地工具', 'Local tool'))} · ${navEscape(tool.currentVersion || '—')} → ${navEscape(navLocaleText('随包内置', 'Bundled'))} · ${navEscape(tool.bundledVersion || '—')}</div>` : ''}
                <div class="builtin-sync-metrics">
                    <span>${navEscape(navLocaleText('当前使用', 'In use'))} <b>${formatBuiltinToolBytes(tool.oldBytes)}</b></span>
                    <span class="builtin-sync-arrow">→</span>
                    <span>${navEscape(navLocaleText('随包内置', 'Bundled'))} <b>${formatBuiltinToolBytes(tool.newBytes)}</b></span>
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
                <button type="button" data-sync-select="recommended">${navEscape(manual ? navLocaleText('全选差异', 'Select All Differences') : navLocaleText('选择建议项', 'Select Recommended'))}</button>
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
            input.checked = manual || Boolean(tools[index] && tools[index].recommended);
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
    if (document.getElementById('builtinToolsSyncModal')?.dataset.applying === '1'
        || localStorage.getItem('tools_role') !== 'admin') return;

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
    const toolMarketOpened = () => document.getElementById('toolMarketBtn')?.dataset.opened === '1';
    if (toolMarketOpened()) return;
    if (
        builtinToolsSyncChecking
        || localStorage.getItem('tools_role') !== 'admin'
        || isBuiltinToolsSyncSnoozedToday()
        || typeof API === 'undefined'
        || document.getElementById('builtinToolsSyncModal')
        || document.getElementById('defaultQuickStartModal')
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
        if (!toolMarketOpened() && preview && Array.isArray(preview.pending) && preview.pending.length) {
            openBuiltinToolsSyncModal(preview);
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
    if (typeof requestIdleCallback === 'function') requestIdleCallback(scheduleBuiltinToolsSync, { timeout: 12000 });
    else scheduleBuiltinToolsSync();
});

mountNavbarEarly();

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
    if (confirmed) window.location.href = '/login.html';
}

async function syncNavUserSession() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            if (data && data.username) {
                const previousRole = localStorage.getItem('tools_role');
                const previousUser = localStorage.getItem('tools_user');
                localStorage.setItem('tools_user', data.username);
                if (data.role) localStorage.setItem('tools_role', data.role);
                if (data.tenantId) localStorage.setItem('tools_tenant_id', data.tenantId);
                // 导航栏按本地角色渲染管理员入口（设置、租户管理）；服务端角色与渲染时不同就整条重绘。
                if ((data.role && data.role !== previousRole) || data.username !== previousUser) {
                    renderNavbar();
                } else {
                    const userChipText = document.querySelector('.nav-user-chip .nav-action-text');
                    if (userChipText) {
                        userChipText.innerHTML = `${navEscape(data.username)} · <span id="navActiveTenantName">${navEscape(activeTenantName())}</span>`;
                    }
                }
                // 服务端 cookie 仍有效但浏览器本地没有 token（换了端口/清过站点数据）：依赖 token 的功能会失效，引导重新登录。
                if (!hasNavAuthToken()) promptNavRelogin();
            }
        } else if (res.status === 401) {
            stopAlertCenterPolling();
            const pathname = window.location.pathname;
            const isPublicPage = pathname === '/login.html' || pathname === '/pages/login.html' ||
                pathname === '/privacy' || pathname === '/privacy.html' ||
                pathname === '/terms' || pathname === '/terms.html' ||
                pathname === '/cinema' || pathname === '/cinema.html';
            if (!isPublicPage) {
                window.location.replace('/login.html');
            }
        }
    } catch (_) {}
}

// EXE 授权角标在普通 Web 部署中会自动隐藏，仅桌面版本地服务显示。
if (!document.querySelector('script[data-desktop-license-badge]')) {
    const desktopLicenseBadgeScript = document.createElement('script');
    desktopLicenseBadgeScript.src = '/js/shared/desktop-license-badge.js';
    desktopLicenseBadgeScript.dataset.desktopLicenseBadge = '1';
    document.head.appendChild(desktopLicenseBadgeScript);
}

// 源码启动、Windows 安装版和绿色版共用同一个服务端首次启动状态。
if (!document.querySelector('script[data-first-run-onboarding]')) {
    const firstRunOnboardingScript = document.createElement('script');
    firstRunOnboardingScript.src = '/js/shared/first-run-onboarding.js';
    firstRunOnboardingScript.dataset.firstRunOnboarding = '1';
    document.head.appendChild(firstRunOnboardingScript);
}
