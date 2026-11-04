// 首页新版界面（html[data-ui="v2"]）：左侧导航、发现应用、二级菜单、底部用户栏、主题切换。
// 只负责外框与入口，具体功能仍交给原有模块（Dragon Claw、频道会话、工具区、导航栏里的告警台 / 设置 / 租户）。
(function () {
    'use strict';
    const root = document.documentElement;
    if (root.getAttribute('data-ui') !== 'v2') return;

    const ICONS = {
        wide: '<path d="M3.5 5v14M20.5 5v14"/><path d="M7 12h10M9.5 9 6.5 12l3 3m5-6 3 3-3 3"/>',
        capture: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/><rect x="8" y="8" width="8" height="8" rx="1.5"/><path d="M8 12h8M12 8v8"/>',
        importData: '<path d="M12 3v10m-3-3 3 3 3-3M5 12l-2 5v4h18v-4l-2-5"/><path d="M3 17h5l1.5 2h5l1.5-2h5"/>',
        chart: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M8 16v-3m4 3V8m4 8v-5"/>',
        bolt: '<path d="m13.5 3-9 10H11l-.5 8 9-11H13l.5-7Z"/>',
        calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-12 4h3m2 0h3m-8 3h3"/>',
        dashboard: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 13v-3m5 3V7m5 6V9"/>',
        analytics: '<path d="M4 5v14h9M8 14v-4m4 2V6"/><circle cx="17" cy="14" r="3.5"/><path d="m19.5 16.5 2 2"/>',
        presentation: '<path d="M3 4h18M5 4v12h14V4M12 16v5m-4 0 4-3 4 3M8 12l3-3 2 2 3-4"/>',
        calculator: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h1m5 0h2m-8 4h1m5 0h2m-8 3h1m5 0h2"/>',
        checklist: '<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M9 4V2h7v2M8 10l1 1 2-2m2 1h4m-9 6 1 1 2-2m2 1h4"/>',
        database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
        server: '<rect x="4" y="3" width="16" height="7" rx="2"/><rect x="4" y="14" width="16" height="7" rx="2"/><path d="M8 6.5h.01M8 17.5h.01M12 6.5h4m-4 11h4"/>',
        compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
        chevron: '<path d="m7 10 5 5 5-5"/>',
        chatPlus: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V16h-.5A1.5 1.5 0 0 1 4 14.5v-9Z"/><path d="M12 7.5v5M9.5 10h5"/>',
        channels: '<path d="M7 9h10M7 13h6"/><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9l-5 4V6.5Z"/>',
        puzzle: '<path d="M10 4.5a2 2 0 1 1 4 0V6h3a1 1 0 0 1 1 1v3h1.5a2 2 0 1 1 0 4H18v3a1 1 0 0 1-1 1h-3v-1.5a2 2 0 1 0-4 0V18H7a1 1 0 0 1-1-1v-3h1.5a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V4.5Z"/>',
        alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 1.5M5 4 3 6M19 4l2 2"/>',
        book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5v-15ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5v-15Z"/>',
        inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5Z"/><path d="M4 13.5h4.5a3.5 3.5 0 0 0 7 0H20"/>',
        grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
        bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.1h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1L7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
        sparkles: '<path d="M12 4.5 13.6 9l4.4 1.5-4.4 1.5L12 16.5 10.4 12 6 10.5 10.4 9 12 4.5ZM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>',
        plug: '<path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v4"/>',
        store: '<path d="M4.5 9 6 4.5h12L19.5 9"/><path d="M4.5 9h15v1a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0V9ZM6 12.5V19.5h12v-7"/>',
        upload: '<path d="M12 15V4.5M8 8.5l4-4 4 4M5 14v5.5h14V14"/>',
        compare: '<path d="M4 7h13m-3-3 3 3-3 3M20 17H7m3-3-3 3 3 3"/>',
        link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
        moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
        language: '<path d="M4 6h9M8.5 4v2M6 6c.5 3 2.5 5.5 5.5 7M11 6c-.5 3-3 6-6.5 7.5"/><path d="m13 20 3.5-8 3.5 8M14.2 17.5h4.6"/>',
        logout: '<path d="M14 5V4.5A1.5 1.5 0 0 0 12.5 3h-7A1.5 1.5 0 0 0 4 4.5v15A1.5 1.5 0 0 0 5.5 21h7a1.5 1.5 0 0 0 1.5-1.5V19M10 12h10m-3-3 3 3-3 3"/>',
        activity: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
        target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".5"/>',
        chat: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4 3.5V15h-.5A1.5 1.5 0 0 1 5 13.5v-8Z"/>',
        tools: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
        users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M3 19.5a6 6 0 0 1 12 0M16 5a3.5 3.5 0 0 1 0 7M18 19.5a6 6 0 0 0-2.5-4.9"/>',
        check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
        devices: '<rect x="3" y="5" width="13" height="10" rx="1.5"/><path d="M7 19h5M9.5 15v4"/><rect x="16.5" y="9" width="5" height="10" rx="1.2"/>',
        palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.1-.9-1.5-.9-2.5 0-.9.7-1.6 1.7-1.6H17a3.5 3.5 0 0 0 3.5-3.5c0-4.3-3.8-7.7-8.5-7.7Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
        refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        external: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
        alert: '<path d="M12 4 3 19.5h18L12 4Z"/><path d="M12 10v4M12 17v.5"/>',
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.5"/>',
        chevronRight: '<path d="m10 7 5 5-5 5"/>',
        sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9 4.5v15"/>',
        filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5Z"/>',
        arrowUpRight: '<path d="M7.5 16.5 16.5 7.5M9 7.5h7.5V15"/>',
        terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>'
    };
    const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    const fillIcons = scope => scope.querySelectorAll('.v2-ico[data-icon]').forEach(el => { if (!el.firstChild) el.innerHTML = svg(el.dataset.icon); });
    // Route-based glyphs stay consistent across language changes and navbar markup.
    function appGlyph(href) {
        let path = '';
        try { path = new URL(href, location.href).pathname.replace(/^\/pages\//, '/').replace(/\.html$/, '').replace(/\/$/, ''); } catch { /* Use a generic application glyph. */ }
        const routes = { '/uivf12': 'capture', '/sla': 'importData', '/report': 'chart', '/custom-report': 'chart', '/expedite': 'bolt', '/monthly': 'calendar', '/ai-report': 'calendar', '/duty-roster': 'moon', '/bigscreen': 'dashboard', '/topic-analysis': 'analytics', '/topical-analysis': 'analytics', '/frt': 'calculator', '/praudit': 'checklist', '/storage': 'server', '/db-explorer': 'database', '/netcare-explorer': 'compass' };
        if (routes[path]) return routes[path];
        if (/network_safety_meeting_summary|nis_2026h1_summary|slide|presentation|ppt/i.test(path)) return 'presentation';
        return path.startsWith('/custom-tools/') ? 'puzzle' : 'grid';
    }

    const TEXT = {
        'zh-CN': {
            discover: '发现应用', newChat: '新建对话', channels: '频道会话', skills: '技能·插件·工具', schedule: '定时任务', library: '资料库',
            opsDrafts: '运维待办', more: '更多', heroTitle: 'Dragon Claw，让想法落地', modeChat: '对话', modeTools: '工具', alerts: '告警台', settings: '全局设置',
            skillList: '技能 Skill', plugins: '插件与脚本', market: '工具市场', importTool: '导入工具', compare: '内置工具比对', links: '友情链接',
            searchApps: '搜索应用，支持拼音，如 hykq', recommended: '推荐', all: '全部', recent: '最近使用', popular: '常用推荐', results: '搜索结果',
            noApps: '没有找到“{q}”，试试拼音首字母', appCount: '共 {n} 个应用', found: '找到 {n} 个', open: '进入',
            language: 'English', themeLight: '浅色模式', themeDark: '深色模式', serviceStatus: '服务状态', requirements: '需求管理',             logout: '退出登录', classic: '切回旧版界面', online: '服务在线', loadingApps: '正在读取应用…',
            recentAsked: '最近问过', suggested: '试试这样问',
            collapse: '收起侧栏', expand: '展开侧栏', search: '搜索', sortFilter: '排序与筛选',
            searchPlaceholder: '搜索对话、频道、桌面 Agent、应用和技能', searchTabsAll: '全部', searchChats: '对话', searchChannels: '频道', searchAgents: '桌面 Agent', searchApps: '应用', searchSkills: '技能',
            searchIdle: '输入关键词开始搜索，应用支持拼音', searchNone: '没有找到相关内容', searching: '正在搜索…',
            keyMove: '上下切换', keyOpen: '打开', keyTab: '切换类别', keyClose: '关闭窗口',
            filterStatus: '筛选状态', statusAll: '全部状态', statusPinned: '置顶', statusGroup: '讨论组', statusWorkspace: '带工作区',
            filterTime: '筛选时间', timeAll: '全部时间', timeToday: '今天', time7: '最近 7 天', time30: '最近 30 天', filterReset: '重置筛选条件',
            messages: '消息中心', scan: '扫码使用', appearance: '外观', wide: '宽屏模式', light: '浅色', dark: '深色', version: '版本', service: '服务', checkUpdate: '检查更新',
            clearAll: '全部清除', markAllRead: '全部已读', filterAll: '全部', filterUnread: '未读', filterWarn: '警告', noMessages: '暂无消息', loadFailed: '读取失败：{e}',
            view: '查看', markRead: '标为已读', today: '今天', yesterday: '昨天', scanWeixin: '微信助理', scanWelink: 'WeLink 本人',
            scanHintWeixin: '用微信扫码，接入微信助理与推送', scanHintWelink: '用 WeLink 扫码，以本人身份与 Dragon Claw 协同办公',
            scanConnecting: '正在连接 WeLink PC…', scanConnectingWeixin: '正在生成微信登录二维码…',
            scanWaitWeLink: '请使用手机 WeLink 扫码登录', scanWaitWeixin: '请使用手机微信扫码并确认',
            scanLoggedInWelink: '已登录 WeLink 个人身份', scanConnectedWeixin: '微信助理已连接',
            scanIntranetOnly: '仅限内网使用', scanIntranetHint: 'WeLink 个人身份仅限华为内网使用。当前网络无法访问 WeLink 内网服务，请连接公司内网或 VPN 后重新检测。',
            scanWelinkBot: 'WeLink 助理', scanWaitWelinkBot: '请使用手机 WeLink 扫码并确认授权', scanConnectedWelinkBot: 'WeLink 助理已对接',
            scanRecheck: '重新检测', scanWindowsOnly: '仅支持 Windows', scanWindowsHint: '内置的 welink-cli 只能在 Windows 上运行，并需要本机登录 WeLink PC。',
            scanRelogin: '重新扫码', scanLogout: '退出登录', scanChannelSettings: '频道设置',
            channelDisabledNoChannel: '当前未对接任何频道（WeLink / 微信），可在全局设置中对接',
            channelDisabledNotEnabled: '已配置频道凭据但尚未启用，请在全局设置中开启'
        },
        'en-US': {
            discover: 'Discover', newChat: 'New chat', channels: 'Channels', skills: 'Skills · plugins', schedule: 'Scheduled', library: 'Library',
            opsDrafts: 'Ops drafts', more: 'More', heroTitle: 'Dragon Claw, from idea to done', modeChat: 'Chat', modeTools: 'Tools', alerts: 'Alerts', settings: 'Settings',
            skillList: 'Skills', plugins: 'Plugins and scripts', market: 'Tool market', importTool: 'Import tool', compare: 'Compare built-ins', links: 'Links',
            searchApps: 'Search apps, pinyin works too', recommended: 'For you', all: 'All', recent: 'Recent', popular: 'Popular', results: 'Results',
            noApps: 'No apps match “{q}”', appCount: '{n} apps', found: '{n} found', open: 'Open',
            language: '中文', themeLight: 'Light mode', themeDark: 'Dark mode', serviceStatus: 'Service status', requirements: 'Requirements',             logout: 'Sign out', classic: 'Back to classic layout', online: 'Online', loadingApps: 'Loading apps…',
            recentAsked: 'Asked recently', suggested: 'Try asking',
            collapse: 'Collapse sidebar', expand: 'Expand sidebar', search: 'Search', sortFilter: 'Sort and filter',
            searchPlaceholder: 'Search chats, channels, desktop agents, apps and skills', searchTabsAll: 'All', searchChats: 'Chats', searchChannels: 'Channels', searchAgents: 'Desktop agents', searchApps: 'Apps', searchSkills: 'Skills',
            searchIdle: 'Type to search; apps also match pinyin', searchNone: 'Nothing found', searching: 'Searching…',
            keyMove: 'Move', keyOpen: 'Open', keyTab: 'Switch type', keyClose: 'Close',
            filterStatus: 'Status', statusAll: 'All', statusPinned: 'Pinned', statusGroup: 'Agent group', statusWorkspace: 'With workspace',
            filterTime: 'Time', timeAll: 'Any time', timeToday: 'Today', time7: 'Last 7 days', time30: 'Last 30 days', filterReset: 'Reset filters',
            messages: 'Messages', scan: 'Scan to use', appearance: 'Appearance', wide: 'Wide layout', light: 'Light', dark: 'Dark', version: 'Version', service: 'Service', checkUpdate: 'Check for updates',
            clearAll: 'Clear all', markAllRead: 'Mark all read', filterAll: 'All', filterUnread: 'Unread', filterWarn: 'Warnings', noMessages: 'No messages', loadFailed: 'Could not load: {e}',
            view: 'View', markRead: 'Mark read', today: 'Today', yesterday: 'Yesterday', scanWeixin: 'WeChat Bot', scanWelink: 'WeLink (Me)',
            scanHintWeixin: 'Scan with WeChat to connect the assistant and proactive push', scanHintWelink: 'Scan with WeLink to work with Dragon Claw as you',
            scanConnecting: 'Connecting to WeLink PC…', scanConnectingWeixin: 'Generating WeChat QR code…',
            scanWaitWeLink: 'Scan with WeLink mobile to sign in', scanWaitWeixin: 'Scan with WeChat mobile and confirm',
            scanLoggedInWelink: 'Signed in to personal WeLink', scanConnectedWeixin: 'WeChat assistant connected',
            scanIntranetOnly: 'Intranet only', scanIntranetHint: 'WeLink personal identity works only on the Huawei intranet. This network cannot reach the WeLink intranet service. Connect to the intranet or VPN, then check again.',
            scanWelinkBot: 'WeLink Bot', scanWaitWelinkBot: 'Scan with WeLink mobile and confirm', scanConnectedWelinkBot: 'WeLink assistant connected',
            scanRecheck: 'Check again', scanWindowsOnly: 'Windows only', scanWindowsHint: 'The built-in welink-cli runs only on Windows, with WeLink PC signed in on this machine.',
            scanRelogin: 'Re-scan', scanLogout: 'Sign out', scanChannelSettings: 'Channel settings',
            channelDisabledNoChannel: 'No channels configured (WeLink / WeChat). Configure them in Global Settings.',
            channelDisabledNotEnabled: 'Channels configured but not enabled. Please enable them in Global Settings.'
        }
    };
    const lang = () => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN');
    const t = (key, params = {}) => String(TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const $ = id => document.getElementById(id);
    const click = id => $(id)?.click();

    function applyText() {
        document.querySelectorAll('[data-v2-i18n]').forEach(el => { el.textContent = t(el.dataset.v2I18n); });
        document.querySelectorAll('[data-v2-i18n-title]').forEach(el => { el.title = t(el.dataset.v2I18nTitle); el.setAttribute('aria-label', el.title); });
        renderModes();
    }

    // ── 浮层：同一时间只开一个，点外面或 Esc 关闭 ──
    let openPop = null, linksPanel = null, linksAnchor = null, linksTimer = 0;
    function closePop() {
        clearTimeout(hoverTimer);
        closeLinks();
        if (typeof scan !== 'undefined' && scan?.abortAll) scan.abortAll();
        if (!openPop) return;
        const shortcuts = document.getElementById('homeSidebarShortcuts');
        if (shortcuts && openPop.pop.contains(shortcuts)) shortcuts.hidden = true;
        openPop.pop.classList.remove('is-open');
        openPop.anchor?.setAttribute('aria-expanded', 'false');
        openPop = null;
    }
    function showPop(pop, anchor, place) {
        if (openPop?.pop === pop && openPop?.anchor === anchor) return;
        closePop();
        const rect = anchor.getBoundingClientRect();
        if (place === 'right') { pop.style.left = `${rect.right + 6}px`; pop.style.top = `${rect.top - 6}px`; pop.style.bottom = ''; }
        else if (place === 'up') { pop.style.left = `${rect.left}px`; pop.style.bottom = `${window.innerHeight - rect.top + 8}px`; pop.style.top = ''; }
        else { pop.style.left = `${rect.left}px`; pop.style.top = `${rect.bottom + 6}px`; pop.style.bottom = ''; }
        pop.classList.add('is-open');
        anchor.setAttribute('aria-expanded', 'true');
        openPop = { pop, anchor };
        // 超出视口底部时向上收
        const box = pop.getBoundingClientRect();
        if (box.right > window.innerWidth - 8) pop.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
        if (box.bottom > window.innerHeight - 8 && place !== 'up') pop.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;
    }
    function makePop(className = '') {
        const pop = document.createElement('div');
        pop.className = `v2-pop ${className}`.trim();
        pop.setAttribute('role', 'menu');
        document.body.appendChild(pop);
        return pop;
    }
    function closeOutsidePop(event) {
        if (!openPop) return;
        // 捕获阶段处理，避免正文/工具自身的 stopPropagation 阻止菜单关闭。
        const path = event.composedPath();
        if (path.includes(openPop.pop) || path.includes(openPop.anchor) || path.includes(linksPanel)) return;
        closePop();
    }
    document.addEventListener('pointerdown', closeOutsidePop, true);
    document.addEventListener('click', closeOutsidePop, true);
    // 内嵌工具的点击不会冒泡到首页；焦点进入 iframe 时也收起菜单。
    window.addEventListener('blur', () => {
        setTimeout(() => {
            if (openPop && document.activeElement instanceof HTMLIFrameElement) closePop();
        }, 0);
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closePop(); });
    window.addEventListener('resize', closePop);

    const menuItem = (icon, label, action, hint = '') => `<button type="button" class="v2-pop-item" role="menuitem" data-v2-do="${action}"><span class="v2-ico" data-icon="${icon}"></span><span>${esc(label)}</span>${hint ? `<span class="v2-pop-hint">${esc(hint)}</span>` : ''}</button>`;

    // ── 侧栏导航项悬停提示 ──
    const navTip = document.createElement('div');
    navTip.className = 'v2-nav-tip';
    navTip.setAttribute('role', 'tooltip');
    document.body.appendChild(navTip);
    let navTipTimer = 0;
    function showNavTip(text, anchor) {
        clearTimeout(navTipTimer);
        navTip.textContent = text;
        const rect = anchor.getBoundingClientRect();
        navTip.style.left = `${rect.right + 8}px`;
        navTip.style.top = `${rect.top + (rect.height / 2)}px`;
        navTip.classList.add('is-open');
    }
    function hideNavTip() {
        clearTimeout(navTipTimer);
        navTip.classList.remove('is-open');
    }
    document.addEventListener('mouseover', event => {
        const item = event.target.closest('.v2-nav-item.is-disabled');
        if (item && item.dataset.disabledReason) showNavTip(item.dataset.disabledReason, item);
    });
    document.addEventListener('mouseout', event => {
        const item = event.target.closest('.v2-nav-item.is-disabled');
        if (item) hideNavTip();
    });

    // ── 主导航动作 ──
    const ACTIONS = {
        newChat() {
            window.HomeMode?.set('chat');
            if (location.hash === '#channels') {
                try { history.replaceState(history.state, '', location.pathname + location.search); } catch { location.hash = ''; }
            }
            window.HomeWelinkThreads?.setSource?.('mine');
            click('homeChatNew');
            $('dcInput')?.focus();
            renderModes();
            queueGroups();
        },
        channels() {
            const navItem = document.querySelector('.v2-nav-item[data-v2-action="channels"]');
            if (navItem?.classList.contains('is-disabled')) {
                const reason = navItem.dataset.disabledReason || navItem.title || t('channelDisabledNoChannel');
                showNavTip(reason, navItem);
                clearTimeout(navTipTimer);
                navTipTimer = setTimeout(hideNavTip, 3000);
                return;
            }
            window.HomeMode?.set('chat');
            try { history.replaceState(history.state, '', location.pathname + location.search + '#channels'); } catch { location.hash = '#channels'; }
            const available = (window.HomeWelinkThreads?.channels?.() || []).map(c => c.id);
            const tabs = [...document.querySelectorAll('.home-chat-tabs [data-chat-source]')].map(el => el.dataset.chatSource);
            const channel = ['welink', 'weixin'].find(id => available.includes(id) || tabs.includes(id)) || 'welink';
            window.HomeWelinkThreads?.setSource?.(channel, { openLatest: true });
            renderModes();
            queueGroups();
        },
        schedule() { window.HomeMode?.set('chat'); window.DragonClaw?.openSchedules?.(); },
        library() { window.openToolsKnowledgeGraph?.(); },
        promotions() { window.HomePromoPlayer?.open?.(); },
        opsDrafts() { window.HomeMode?.set('chat'); if (location.hash !== '#ops-drafts') location.hash = '#ops-drafts'; else window.ToolsOpsInbox?.open?.(); },
        skillHub() { window.HomeSkillHub?.open?.(); },
        skillList() { window.HomeSkillHub?.open?.('skills'); },
        plugins() { window.HomeSkillHub?.open?.('plugins'); },
        market() { click('toolMarketBtn'); },
        importTool() { click('customToolUploadBtn'); },
        compare() { click('builtinToolsCompareBtn'); },
        links() { openLinks(); },
        alerts() { openMessages(); },
        checkUpdate() { window.ToolsDialogs?.checkUpdate(); },
        feedback() { window.ToolsDialogs?.feedback(); },
        settings() { window.openNavSettingsModal?.(); },
        language() { window.toggleAppLanguage?.(); },
        theme() { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); },
        wide() { setWide(!root.classList.contains('v2-wide')); },
        serviceStatus() { window.openServiceStatusModal?.(); },
        requirements() { if (!window.HomeToolFrame?.open?.('/requirements')) location.href = '/requirements'; },
        classic() { try { localStorage.setItem('tools_home_ui', 'v1'); } catch { /* 无痕模式 */ } location.reload(); },
        logout() { window.doLogout?.(); }
    };
    function run(action) { closePop(); ACTIONS[action]?.(); }
    document.addEventListener('click', event => {
        const el = event.target.closest('[data-v2-action], [data-v2-do]');
        if (!el) return;
        if (el.classList.contains('is-disabled')) {
            event.preventDefault();
            event.stopPropagation();
            const reason = el.dataset.disabledReason || el.title;
            if (reason) {
                showNavTip(reason, el);
                clearTimeout(navTipTimer);
                navTipTimer = setTimeout(hideNavTip, 3000);
            }
            return;
        }
        const action = el.dataset.v2Action || el.dataset.v2Do;
        if (action === 'links') { openLinks(el); return; }
        run(action);
    });

    // ── 二级菜单：技能·插件·工具 / 更多（悬停或点击展开） ──
    const flyouts = {
        more: () => {
            const links = [...document.querySelectorAll('#app-navbar .nav-links a[href]')]
                .filter(a => a.getAttribute('href') !== '/' && !a.getAttribute('href').startsWith('#'))
                .map(a => `<a class="v2-pop-item" role="menuitem" href="${esc(a.getAttribute('href'))}"><span class="v2-ico v2-app-glyph" data-icon="${appGlyph(a.getAttribute('href'))}"></span><span>${esc((a.querySelector('.nav-text, .nav-link-text')?.textContent || a.getAttribute('title') || a.textContent || '').trim().replace(/^\S+\s+/, m => (/^[\p{Extended_Pictographic}️]+\s+$/u.test(m) ? '' : m)))}</span></a>`);
            return [
                links.length ? `<div class="v2-pop-cap">${esc(t('discover'))}</div>${links.join('')}<div class="v2-pop-sep"></div>` : '',
                menuItem('link', t('links'), 'links', '›').replace('role="menuitem"', 'role="menuitem" aria-haspopup="menu" aria-controls="v2LinksSubmenu" aria-expanded="false"'),
                menuItem('target', t('requirements'), 'requirements'),
                menuItem('compass', lang() === 'en-US' ? 'Promotions' : '平台推广', 'promotions')
            ].join('');
        }
    };
    const flyPop = makePop('v2-flyout');
    const sidebarShortcuts = $('homeSidebarShortcuts');
    const shortcutHome = sidebarShortcuts?.parentElement;
    sidebarShortcuts?.addEventListener('click', event => {
        if (event.target.closest('#homeKnowledgeGraphEntry, #homeCapsEntry')) closePop();
    }, true);
    let hoverTimer = 0;
    function openFlyout(anchor) {
        closePop();
        // Move the live controls instead of copying their handlers or download implementation.
        if (sidebarShortcuts && shortcutHome) { sidebarShortcuts.hidden = true; shortcutHome.append(sidebarShortcuts); }
        flyPop.innerHTML = flyouts[anchor.dataset.v2Flyout]();
        if (anchor.dataset.v2Flyout === 'more' && sidebarShortcuts) {
            const caption = document.createElement('div');
            caption.className = 'v2-pop-cap';
            caption.textContent = lang() === 'en-US' ? 'Knowledge & extensions' : '知识与扩展';
            flyPop.insertAdjacentHTML('beforeend', '<div class="v2-pop-sep"></div>');
            flyPop.append(caption, sidebarShortcuts);
            sidebarShortcuts.hidden = false;
        }
        fillIcons(flyPop);
        showPop(flyPop, anchor, 'right');
        if (anchor.dataset.v2Flyout === 'more' && sidebarShortcuts) sidebarShortcuts.hidden = false;
    }
    document.querySelectorAll('[data-v2-flyout]').forEach(anchor => {
        anchor.addEventListener('click', () => { clearTimeout(hoverTimer); if (openPop?.anchor === anchor) closePop(); else openFlyout(anchor); });
        anchor.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => openFlyout(anchor), 120); });
        anchor.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { if (openPop?.pop === flyPop && !flyPop.matches(':hover') && !linksPanel?.matches(':hover')) closePop(); }, 220); });
    });
    flyPop.addEventListener('mouseleave', () => { hoverTimer = setTimeout(() => { if (openPop?.pop === flyPop && !openPop.anchor.matches(':hover') && !linksPanel?.matches(':hover')) closePop(); }, 220); });
    flyPop.addEventListener('mouseenter', () => clearTimeout(hoverTimer));

    // Keep the original live link list and its status / admin handlers inside a cascade.
    // Moving the node avoids a second copy of the configured URLs or click behavior.
    function closeLinks(focus = false) {
        clearTimeout(linksTimer);
        linksPanel?.classList.remove('is-open');
        linksAnchor?.setAttribute('aria-expanded', 'false');
        if (focus) linksAnchor?.focus({ preventScroll: true });
        linksAnchor = null;
    }
    function positionLinksSubmenu() {
        if (!linksAnchor || !linksPanel?.classList.contains('is-open')) return;
        const anchor = linksAnchor.getBoundingClientRect(), parent = flyPop.getBoundingClientRect(), pad = 8, gap = 6;
        const width = linksPanel.offsetWidth, height = linksPanel.offsetHeight;
        let left = parent.right + gap;
        if (left + width > innerWidth - pad) left = parent.left - width - gap;
        const stacked = left < pad;
        if (stacked) left = Math.max(pad, Math.min(parent.left, innerWidth - width - pad));
        linksPanel.classList.toggle('is-stacked', stacked);
        linksPanel.style.left = `${left}px`;
        linksPanel.style.top = `${Math.max(pad, Math.min(anchor.top - 7, innerHeight - linksPanel.offsetHeight - pad))}px`;
    }
    function openLinks(anchor, focus = true) {
        if (!openPop || openPop.pop !== flyPop || !flyPop.querySelector('[data-v2-do="links"]')) {
            const more = document.querySelector('[data-v2-flyout="more"]');
            if (!more) return;
            openFlyout(more);
        }
        anchor = anchor?.closest('[data-v2-do="links"]') || flyPop.querySelector('[data-v2-do="links"]');
        if (!anchor) return;
        if (focus && linksAnchor === anchor && linksPanel?.classList.contains('is-open')) { closeLinks(true); return; }
        if (!linksPanel) {
            linksPanel = makePop('v2-links-submenu'); linksPanel.id = 'v2LinksSubmenu';
            const back = document.createElement('button'); back.type = 'button'; back.className = 'v2-links-back';
            back.onclick = () => closeLinks(true); linksPanel.append(back);
            const live = document.querySelector('#homeLinksPop .friend-links');
            if (live) linksPanel.append(live);
            linksPanel.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); clearTimeout(linksTimer); });
            linksPanel.addEventListener('mouseleave', () => { linksTimer = setTimeout(() => { if (!flyPop.matches(':hover')) closeLinks(); }, 250); });
            linksPanel.addEventListener('click', event => { if (event.target.closest('a.friend-link')) closePop(); });
            linksPanel.addEventListener('keydown', event => {
                if (event.key === 'ArrowLeft' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLinks(true); return; }
                if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
                const options = [...linksPanel.querySelectorAll('a:not([hidden]),button:not([hidden])')].filter(node => node.getClientRects().length);
                const index = options.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                event.preventDefault(); options[next]?.focus({ preventScroll: true });options[next]?.scrollIntoView({block:'nearest'});
            });
            new MutationObserver(positionLinksSubmenu).observe(live || linksPanel, {subtree:true,childList:true,attributes:true,attributeFilter:['hidden']});
        }
        $('homeLinksPop').hidden = true;
        linksPanel.querySelector('.v2-links-back').textContent = lang() === 'en-US' ? '‹ Back to More' : '‹ 返回更多';
        linksAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
        linksPanel.querySelectorAll('a.friend-link').forEach(node => node.setAttribute('role','menuitem'));
        linksPanel.classList.add('is-open'); positionLinksSubmenu();
        clearTimeout(hoverTimer);clearTimeout(linksTimer);
        if (focus) linksPanel.querySelector('a.friend-link:not([hidden])')?.focus({ preventScroll: true });
    }
    flyPop.addEventListener('pointerover', event => {
        const item = event.target.closest('[data-v2-do="links"]');
        if (!item) { if (event.target.closest('.v2-pop-item')) closeLinks(); return; }
        if (event.pointerType === 'touch') return;
        clearTimeout(linksTimer); linksTimer = setTimeout(() => openLinks(item, false), 120);
    });
    flyPop.addEventListener('keydown', event => {
        const item = event.target.closest('[data-v2-do="links"]');
        if (item && event.key === 'ArrowRight') { event.preventDefault(); openLinks(item); }
    });
    flyPop.addEventListener('scroll', positionLinksSubmenu);

    // ── 发现应用 ──
    const discover = { pop: makePop('v2-discover'), cat: 'recommended', query: '', pinyin: null };
    discover.pop.setAttribute('role', 'dialog');
    discover.pop.innerHTML = `<div class="v2-discover-search"><span class="v2-ico" data-icon="search"></span><input type="search" autocomplete="off" spellcheck="false"></div><div class="v2-discover-chips"></div><div class="v2-discover-list"></div><div class="v2-discover-foot"></div>`;
    fillIcons(discover.pop);
    const dInput = discover.pop.querySelector('input');
    const apps = () => (window.HomeWorkspace?.getTools?.() || []).filter(item => item && item.href && item.title);
    function recentApps(all) {
        const ids = typeof getRecentNavToolIds === 'function' ? getRecentNavToolIds() : [];
        const nav = typeof getAllNavItems === 'function' ? getAllNavItems() : [];
        const hrefs = ids.map(id => nav.find(item => item.id === id)?.href || id);
        return hrefs.map(href => all.find(app => app.href === href || app.id === href)).filter(Boolean).slice(0, 5);
    }
    const appRow = app => `<a class="v2-app" href="${esc(app.href)}"><span class="v2-app-icon v2-app-glyph">${svg(appGlyph(app.href))}</span><span class="v2-app-text"><strong>${esc(app.title)}</strong><small>${esc(app.description || app.group || '')}</small></span><span class="v2-app-go">${esc(t('open'))}</span></a>`;
    const section = (title, list) => (list.length ? `<div class="v2-pop-cap">${esc(title)}</div>${list.map(appRow).join('')}` : '');
    function matches(app, query) {
        const text = `${app.title} ${app.description || ''} ${app.group || ''} ${(app.tags || []).join(' ')}`.toLowerCase();
        if (text.includes(query)) return true;
        return Boolean(discover.pinyin?.pinyinMatches?.(app.title, query));
    }
    function renderDiscover() {
        const all = apps();
        const groups = [...new Set(all.map(app => app.group).filter(Boolean))];
        const chips = [['recommended', t('recommended')], ['all', t('all')], ...groups.map(g => [g, g])];
        discover.pop.querySelector('.v2-discover-chips').innerHTML = chips.map(([id, label]) => `<button type="button" class="v2-chip${discover.cat === id && !discover.query ? ' is-active' : ''}" data-cat="${esc(id)}">${esc(label)}</button>`).join('');
        const query = discover.query.trim().toLowerCase();
        let html = '';
        let count = all.length;
        if (!all.length) html = `<div class="v2-discover-empty">${esc(t('loadingApps'))}</div>`;
        else if (query) {
            const hit = all.filter(app => matches(app, query));
            count = hit.length;
            html = hit.length ? section(t('results'), hit) : `<div class="v2-discover-empty">${esc(t('noApps', { q: discover.query.trim() }))}</div>`;
        } else if (discover.cat === 'recommended') {
            const recent = recentApps(all);
            const pinned = all.filter(app => !recent.includes(app)).slice(0, 8);
            html = section(t('recent'), recent) + section(t('popular'), pinned);
        } else if (discover.cat === 'all') html = groups.map(g => section(g, all.filter(app => app.group === g))).join('');
        else {
            const list = all.filter(app => app.group === discover.cat);
            count = list.length;
            html = section(discover.cat, list);
        }
        discover.pop.querySelector('.v2-discover-list').innerHTML = html;
        discover.pop.querySelector('.v2-discover-foot').innerHTML = `<span>${esc(query ? t('found', { n: count }) : t('appCount', { n: all.length }))}</span>${menuItem('store', t('market'), 'market')}${menuItem('upload', t('importTool'), 'importTool')}`;
        fillIcons(discover.pop);
        dInput.placeholder = t('searchApps');
    }
    function ensurePinyin() {
        if (window.ToolsPinyinSearch || discover.pinyinLoading) return;
        discover.pinyinLoading = true;
        const script = document.createElement('script');
        script.src = '/js/shared/pinyin-search.js';
        script.onload = () => { discover.pinyin = window.ToolsPinyinSearch; if (discover.query) renderDiscover(); };
        document.head.appendChild(script);
    }
    discover.pop.addEventListener('click', event => {
        const chip = event.target.closest('[data-cat]');
        if (!chip) return;
        discover.cat = chip.dataset.cat;
        discover.query = dInput.value = '';
        renderDiscover();
    });
    dInput.addEventListener('input', () => { discover.query = dInput.value; discover.pinyin = window.ToolsPinyinSearch || null; ensurePinyin(); renderDiscover(); });
    $('v2DiscoverBtn')?.addEventListener('click', event => {
        const anchor = event.currentTarget;
        if (openPop?.pop === discover.pop) return closePop();
        renderDiscover();
        showPop(discover.pop, anchor, 'down');
        setTimeout(() => dInput.focus(), 30);
    });
    window.addEventListener('home:tools-updated', () => { if (openPop?.pop === discover.pop) renderDiscover(); });

    // ── 底部用户栏：账号卡片菜单 ──
    const userPop = makePop('v2-account');
    const serviceDown = () => Boolean(document.querySelector('#app-navbar .nav-server-status')?.matches('.offline, .is-offline, .warning, .error, .is-down'));
    const serviceText = () => $('server-status-text')?.textContent?.trim() || t('online');
    const versionText = () => ($('nav-resource-version-display')?.textContent?.trim() || '').split(' · ')[0];
    function renderUser() {
        const name = localStorage.getItem('tools_user') || '';
        $('v2UserName').textContent = name;
        if (!$('v2Avatar').firstChild) $('v2Avatar').innerHTML = '<img src="/assets/logo.png" alt="">';
        $('v2UserMeta').textContent = serviceText();
        $('v2StatusDot').classList.toggle('is-down', serviceDown());
    }
    const rowItem = (icon, label, action, hint = '', arrow = false) => `<button type="button" class="v2-pop-item" role="menuitem" data-v2-do="${action}"><span class="v2-ico" data-icon="${icon}"></span><span>${esc(label)}</span>${hint ? `<span class="v2-pop-hint">${esc(hint)}</span>` : ''}${arrow ? '<span class="v2-ico v2-pop-arrow" data-icon="chevronRight"></span>' : ''}</button>`;
    const switchItem = (icon, label, action, on) => `<button type="button" class="v2-pop-item" role="menuitemcheckbox" aria-checked="${on}" data-v2-do="${action}"><span class="v2-ico" data-icon="${icon}"></span><span>${esc(label)}</span><span class="v2-pop-switch" aria-hidden="true"></span></button>`;
    // 宽屏模式：对话正文与输入框随窗口变宽，两侧不再留大片空白；只记在本浏览器
    function setWide(on) {
        root.classList.toggle('v2-wide', on);
        try { localStorage.setItem('tools_home_wide', on ? '1' : '0'); } catch { /* 无痕模式下只在本页生效 */ }
        window.dispatchEvent(new Event('resize'));
    }
    function renderUserMenu() {
        const name = localStorage.getItem('tools_user') || '';
        const admin = localStorage.getItem('tools_role') === 'admin';
        const dark = root.getAttribute('data-theme') === 'dark';
        const mac = /Mac/i.test(navigator.platform || '');
        userPop.innerHTML = `
            <div class="v2-account-card v2-account-head"><span class="v2-avatar v2-avatar-lg"><img src="/assets/logo.png" alt=""></span><strong>${esc(name)}</strong></div>
            <div class="v2-account-card v2-account-stats">
                <div><small>${esc(t('version'))}</small><strong>${esc(versionText() || '—')}</strong></div>
                <div><small>${esc(t('service'))}</small><button type="button" class="v2-account-service" data-v2-do="serviceStatus" title="${esc(t('serviceStatus'))}" aria-label="${esc(t('serviceStatus'))}"><span class="v2-status-dot${serviceDown() ? ' is-down' : ''}"></span>${esc(serviceText())}</button></div>
            </div>
            <div class="v2-account-card v2-account-list">
                ${admin ? rowItem('settings', t('settings'), 'settings', mac ? '⌘,' : 'Ctrl+,') : ''}
                ${rowItem('palette', t('appearance'), 'theme', dark ? t('dark') : t('light'), true)}
                ${switchItem('wide', t('wide'), 'wide', root.classList.contains('v2-wide'))}
                ${rowItem('language', t('language'), 'language')}
                ${rowItem('target', t('requirements'), 'requirements')}
                ${rowItem('compare', t('classic'), 'classic')}
                ${rowItem('chat', lang() === 'en-US' ? 'Feedback' : '意见反馈', 'feedback')}
                ${rowItem('refresh', t('checkUpdate'), 'checkUpdate')}
                <div class="v2-pop-sep"></div>
                ${rowItem('logout', t('logout'), 'logout')}
            </div>`;
        fillIcons(userPop);
    }
    $('v2UserBtn')?.addEventListener('click', event => {
        const anchor = event.currentTarget;
        if (openPop?.pop === userPop) return closePop();
        renderUserMenu();
        showPop(userPop, anchor, 'up');
    });
    // 外观切换后菜单保持打开，直接刷新文案
    userPop.addEventListener('click', event => { if (event.target.closest('[data-v2-do="theme"],[data-v2-do="wide"]')) setTimeout(() => { renderUserMenu(); userPop.classList.add('is-open'); openPop = { pop: userPop, anchor: $('v2UserBtn') }; }, 0); });
    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key === ',' && localStorage.getItem('tools_role') === 'admin') { event.preventDefault(); run('settings'); }
    });
    $('v2AlertBtn')?.addEventListener('click', () => run('alerts'));

    // ── 扫码使用：直接对接频道设置中的个人身份（welink-cli）与微信助理 ──
    const scan = {
        pop: makePop('v2-scan'),
        tab: 'welink',
        weixinDisabled: false,
        weixinDisabledHint: '',
        welink: {
            checking: false,
            status: null,
            login: null,
            controller: null
        },
        weixin: {
            checking: false,
            status: null,
            qr: null,
            controller: null
        },
        // WeLink 助理（Bot SDK 扫码授权）：Channel 默认 GDEClaw，确认后 AK/SK 等由后端保存并直接连接
        welinkbot: {
            checking: false,
            status: null,
            qr: null,
            controller: null
        }
    };
    scan.pop.setAttribute('role', 'dialog');

    function scanHeaders(json) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return {
            ...(json ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(typeof getAuthHeaderForNav === 'function' ? getAuthHeaderForNav() : {})
        };
    }

    scan.abortAll = function () {
        if (scan.welink.controller) { scan.welink.controller.abort(); scan.welink.controller = null; }
        if (scan.weixin.controller) { scan.weixin.controller.abort(); scan.weixin.controller = null; }
        if (scan.welinkbot.controller) { scan.welinkbot.controller.abort(); scan.welinkbot.controller = null; }
    };

    function loadScanTab() {
        if (scan.tab === 'welink') loadWelinkStatus({ autoLogin: true });
        else if (scan.tab === 'welinkbot') loadWelinkBotStatus({ autoQr: true });
        else {
            if (scan.weixinDisabled) {
                scan.tab = 'welink';
                loadWelinkStatus({ autoLogin: true });
                return;
            }
            loadWeixinStatus({ autoQr: true });
        }
    }

    function ensureQrLib() {
        if (window.ToolsQrCode) return Promise.resolve();
        scan.qrLoading ||= new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/shared/qr-code.js';
            script.onload = resolve;
            script.onerror = () => { scan.qrLoading = null; reject(new Error('qr-code.js')); };
            document.head.appendChild(script);
        });
        return scan.qrLoading;
    }

    function renderScanRing(title, subtitle) {
        return `<div class="v2-scan-loading-box">
            <div class="v2-scan-ring-spinner">
                <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">
                    <circle class="v2-scan-ring-bg" cx="22" cy="22" r="18" fill="none" stroke="currentColor" stroke-width="3"></circle>
                    <circle class="v2-scan-ring-bar" cx="22" cy="22" r="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"></circle>
                </svg>
            </div>
            <div class="v2-scan-status-main">${esc(title)}</div>
            ${subtitle ? `<div class="v2-scan-status-sub">${esc(subtitle)}</div>` : ''}
        </div>`;
    }

    function renderScanQrBox(content) {
        return `<div class="v2-scan-qr-box">${content}</div>`;
    }

    async function loadWelinkStatus({ autoLogin = true, refresh = false } = {}) {
        scan.welink.checking = true;
        renderScan();
        try {
            const res = await fetch(`/api/channels/welink-cli/status?auth=1${refresh ? '&refresh=1' : ''}`, { headers: scanHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
            scan.welink.status = data;
            scan.welink.checking = false;
            if (autoLogin && !data.auth?.loggedIn && data.install?.available && data.network?.intranet !== false) {
                startWelinkLogin();
                return;
            }
        } catch (err) {
            scan.welink.checking = false;
            scan.welink.status = { error: err.message, status: err.status };
        }
        renderScan();
    }

    async function startWelinkLogin() {
        if (scan.welink.controller) scan.welink.controller.abort();
        const controller = new AbortController();
        scan.welink.controller = controller;
        scan.welink.login = {
            phase: 'running',
            statusText: t('scanConnecting', '正在连接 WeLink PC…'),
            qrUrl: '',
            qrText: '',
            elapsed: null,
            error: ''
        };
        renderScan();
        try {
            const env = scan.welink.status?.config?.env || '';
            const res = await fetch('/api/channels/welink-cli/login', {
                method: 'POST',
                headers: scanHeaders(true),
                body: JSON.stringify({ env }),
                signal: controller.signal
            });
            if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    handleWelinkMsg(JSON.parse(line));
                }
                renderScan();
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                if (!scan.welink.login) scan.welink.login = {};
                scan.welink.login.phase = 'failed';
                scan.welink.login.error = err.message;
            }
        }
        scan.welink.controller = null;
        renderScan();
        if (scan.welink.login?.phase === 'done') {
            setTimeout(() => {
                if (openPop?.pop === scan.pop && scan.tab === 'welink') loadWelinkStatus({ autoLogin: false });
            }, 1200);
        }
    }

    function handleWelinkMsg(msg) {
        const l = scan.welink.login;
        if (!l) return;
        if (msg.type === 'done') {
            l.phase = 'done';
            l.statusText = '登录成功！凭据已缓存在本机';
            return;
        }
        if (msg.type === 'error') {
            if (msg.code === 'WELINK_CLI_EXTRANET') {
                // 服务端发现已离开内网：回到「仅限内网」提示
                scan.welink.status = { ...(scan.welink.status || {}), network: msg.network || { intranet: false } };
                scan.welink.login = null;
                return;
            }
            l.phase = 'failed';
            l.error = msg.error;
            return;
        }
        const ev = msg.event || {};
        if (ev.type === 'qrcode') {
            l.phase = 'qrcode';
            l.qrUrl = ev.url;
            l.statusText = t('scanWaitWeLink', '请使用手机 WeLink 扫码登录');
        } else if (ev.type === 'qrtext') {
            l.phase = 'qrcode';
            l.qrText = ev.text;
            l.statusText = t('scanWaitWeLink', '请使用手机 WeLink 扫码登录');
        } else if (ev.type === 'waiting') {
            l.elapsed = ev.elapsed;
            l.statusText = `等待扫码中 ${ev.elapsed ? `(${ev.elapsed}s)` : ''}`;
        } else if (ev.type === 'scanned') {
            l.statusText = '📱 手机已扫码，正在获取登录凭据…';
        } else if (ev.type === 'expired') {
            l.phase = 'expired';
            l.statusText = '二维码已过期，请点击重新获取';
        } else if (ev.type === 'success') {
            l.phase = 'done';
            l.statusText = '✅ 登录成功！';
        }
    }

    async function loadWeixinStatus({ autoQr = true } = {}) {
        scan.weixin.checking = true;
        renderScan();
        try {
            const res = await fetch('/api/channels/weixin/status', { headers: scanHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            scan.weixin.status = data;
            scan.weixin.checking = false;
            if (data.disabledByIntranet) {
                scan.weixinDisabled = true;
                scan.weixinDisabledHint = data.disabledHint || '';
                if (scan.tab === 'weixin') {
                    scan.tab = 'welink';
                    renderScan();
                    loadWelinkStatus({ autoLogin: true });
                    return;
                }
            }
            if (autoQr && !data.connected && !data.bot?.id) {
                startWeixinQr();
                return;
            }
        } catch (err) {
            scan.weixin.checking = false;
            scan.weixin.status = { error: err.message };
        }
        renderScan();
    }

    async function startWeixinQr() {
        if (scan.weixin.controller) scan.weixin.controller.abort();
        const controller = new AbortController();
        scan.weixin.controller = controller;
        scan.weixin.qr = { type: 'starting', running: true };
        renderScan();
        try {
            const res = await fetch('/api/channels/weixin/qrcode-auth', {
                method: 'POST',
                headers: scanHeaders(true),
                body: JSON.stringify({}),
                signal: controller.signal
            });
            if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (event.type === 'snapshot') {
                        scan.weixin.qr = { ...event.snapshot, running: !['confirmed', 'cancelled', 'failed', 'expired'].includes(event.snapshot.type) };
                    }
                    if (event.type === 'error') scan.weixin.qr = { type: 'error', error: event.error, running: false };
                    if (event.type === 'done' && event.saved) {
                        scan.weixin.qr = { type: 'confirmed', running: false };
                        setTimeout(() => {
                            if (openPop?.pop === scan.pop && scan.tab === 'weixin') loadWeixinStatus({ autoQr: false });
                        }, 1200);
                    }
                }
                renderScan();
            }
        } catch (err) {
            if (err.name !== 'AbortError') scan.weixin.qr = { type: 'error', error: err.message, running: false };
        }
        scan.weixin.controller = null;
        renderScan();
    }

    async function submitWeixinVerify(code) {
        if (!code) return;
        try {
            await fetch('/api/channels/weixin/qrcode-auth/verify', {
                method: 'POST',
                headers: scanHeaders(true),
                body: JSON.stringify({ code })
            });
        } catch (_) {}
    }

    async function loadWelinkBotStatus({ autoQr = true } = {}) {
        // 切换标签时二维码流已中止，旧二维码不再有效
        if (!scan.welinkbot.controller) scan.welinkbot.qr = null;
        scan.welinkbot.checking = true;
        renderScan();
        try {
            const res = await fetch('/api/channels/welink/status', { headers: scanHeaders() });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            scan.welinkbot.status = data;
            scan.welinkbot.checking = false;
            if (autoQr && !(data.enabled && data.configured) && data.sdk?.available !== false) {
                startWelinkBotQr();
                return;
            }
        } catch (err) {
            scan.welinkbot.checking = false;
            scan.welinkbot.status = { error: err.message };
        }
        renderScan();
    }

    async function startWelinkBotQr() {
        if (scan.welinkbot.controller) scan.welinkbot.controller.abort();
        const controller = new AbortController();
        scan.welinkbot.controller = controller;
        scan.welinkbot.qr = { type: 'starting', running: true };
        renderScan();
        try {
            const res = await fetch('/api/channels/welink/qrcode-auth', {
                method: 'POST',
                headers: scanHeaders(true),
                body: JSON.stringify({}),
                signal: controller.signal
            });
            if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    if (!line.trim()) continue;
                    const event = JSON.parse(line);
                    if (event.type === 'snapshot') {
                        const snap = event.snapshot || {};
                        const keepQr = snap.type === 'scanned' ? (scan.welinkbot.qr?.display || null) : (snap.display || null);
                        scan.welinkbot.qr = { ...snap, display: keepQr, running: !['confirmed', 'cancelled', 'failed', 'expired'].includes(snap.type),
                            error: snap.type === 'failed' ? (snap.serviceError?.message || snap.serviceError?.error || snap.reasonCode || '') : '' };
                    }
                    if (event.type === 'error') {
                        scan.welinkbot.qr = event.code === 'WELINK_EXTRANET'
                            ? { type: 'extranet', error: event.error, running: false }
                            : { type: 'error', error: event.error, running: false };
                    }
                    if (event.type === 'done' && event.saved) {
                        scan.welinkbot.qr = { type: 'confirmed', running: false };
                        setTimeout(() => {
                            if (openPop?.pop === scan.pop && scan.tab === 'welinkbot') loadWelinkBotStatus({ autoQr: false });
                        }, 1200);
                    }
                }
                renderScan();
            }
        } catch (err) {
            if (err.name !== 'AbortError') scan.welinkbot.qr = { type: 'error', error: err.message, running: false };
        }
        scan.welinkbot.controller = null;
        renderScan();
    }

    function renderWelinkBot() {
        const wb = scan.welinkbot;
        const settingsBtn = `<button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>`;
        const qrVal = wb.qr?.display?.weUrl || wb.qr?.display?.qrcode || wb.qr?.qrcode;
        const qrSvg = () => {
            if (!qrVal || !window.ToolsQrCode) return '';
            try { return window.ToolsQrCode.toSvg(qrVal, { scale: 4, border: 2 }); } catch (_) { return ''; }
        };
        if (wb.checking) return renderScanRing('正在检查 WeLink 助理状态…', '通过 WeLink 助理 SDK 扫码授权接入');
        if (wb.qr?.type === 'extranet') {
            return `<div class="v2-scan-connected">
                <div class="v2-scan-connected-icon">🌐</div>
                <div class="v2-scan-connected-title">${esc(t('scanIntranetOnly', '仅限内网使用'))}</div>
                <div class="v2-scan-connected-meta">${esc(wb.qr.error || t('scanIntranetHint', ''))}</div>
                <div class="v2-scan-actions">
                    <button type="button" class="v2-account-btn is-primary" data-scan-action="relogin-welinkbot" style="margin-top:6px">${esc(t('scanRecheck', '重新检测'))}</button>
                </div>
            </div>`;
        }
        if (wb.qr?.type === 'qrcode_generated' || wb.qr?.type === 'scanned') {
            const scanned = wb.qr.type === 'scanned';
            return `
                ${renderScanQrBox(qrSvg() || '<span class="v2-scan-loading"></span>')}
                <div class="v2-scan-hint-lead">${esc(scanned ? '已扫码，请在手机 WeLink 上确认授权' : t('scanWaitWelinkBot', '请使用手机 WeLink 扫码并确认授权'))}</div>
                <div class="v2-scan-hint-sub">Channel ${esc(wb.status?.channelName || 'GDEClaw')} · 确认后自动填入 AK/SK 并连接</div>
                <div class="v2-scan-status-pill ${scanned ? 'is-pulsing' : ''}">
                    <span class="v2-scan-dot"></span>
                    <span>${esc(scanned ? '手机已扫码，正在等待确认授权…' : '等待 WeLink 扫码确认…')}</span>
                </div>
                <div class="v2-scan-actions">
                    <button type="button" class="v2-pop-item" data-scan-action="relogin-welinkbot">${esc(t('scanRelogin', '刷新二维码'))}</button>
                    ${settingsBtn}
                </div>`;
        }
        if (wb.qr?.type === 'confirmed') {
            return `<div class="v2-scan-connected">
                <div class="v2-scan-connected-icon">✅</div>
                <div class="v2-scan-connected-title">授权成功！</div>
                <div class="v2-scan-connected-meta">AK/SK 已保存，WeLink 助理正在连接…</div>
            </div>`;
        }
        if (wb.qr && ['error', 'failed', 'expired', 'cancelled'].includes(wb.qr.type)) {
            const title = wb.qr.type === 'expired' ? '二维码已过期' : (wb.qr.type === 'cancelled' ? '已在手机上取消授权' : 'WeLink 助理接入失败');
            return `<div class="v2-scan-connected">
                <div class="v2-scan-connected-icon">⚠️</div>
                <div class="v2-scan-connected-title">${esc(title)}</div>
                <div class="v2-scan-connected-meta">${esc(wb.qr.error || '请刷新二维码重试')}</div>
                <div class="v2-scan-actions">
                    <button type="button" class="v2-account-btn is-primary" data-scan-action="relogin-welinkbot" style="margin-top:6px">重新获取二维码</button>
                </div>
            </div>`;
        }
        if (wb.status?.sdk && wb.status.sdk.available === false) {
            return `<div class="v2-scan-connected">
                <div class="v2-scan-connected-icon">📦</div>
                <div class="v2-scan-connected-title">未检测到 WeLink 助理 SDK</div>
                <div class="v2-scan-connected-meta">${esc(wb.status.sdk.hint || '内置 SDK 缺失，可在频道设置中导入。')}</div>
                <div class="v2-scan-actions">${settingsBtn}</div>
            </div>`;
        }
        if (wb.status?.enabled && wb.status?.configured && !wb.qr?.running) {
            const info = wb.status.assistantInfo || {};
            const state = wb.status.connected ? '在线' : (wb.status.lastError?.message ? `连接异常：${wb.status.lastError.message}` : '正在连接…');
            return `<div class="v2-scan-connected">
                <div class="v2-scan-connected-icon">🤖</div>
                <div class="v2-scan-connected-title">${esc(t('scanConnectedWelinkBot', 'WeLink 助理已对接'))}</div>
                <div class="v2-scan-connected-account">${esc(info.name || wb.status.channelName || 'GDEClaw')} · ${esc(state)}</div>
                <div class="v2-scan-connected-meta">${esc(info.desc || '手机 WeLink 中的助理消息由 Dragon Claw 协同回复，可用于主动推送')}</div>
                <div class="v2-scan-actions">
                    <button type="button" class="v2-pop-item" data-scan-action="relogin-welinkbot">${esc(t('scanRelogin', '重新扫码'))}</button>
                    ${settingsBtn}
                </div>
            </div>`;
        }
        if (wb.status?.error) {
            return `<div class="v2-scan-connected">
                <div class="v2-scan-connected-icon">⚠️</div>
                <div class="v2-scan-connected-title">无法读取 WeLink 助理状态</div>
                <div class="v2-scan-connected-meta">${esc(wb.status.error)}</div>
                <div class="v2-scan-actions">
                    <button type="button" class="v2-account-btn is-primary" data-scan-action="relogin-welinkbot" style="margin-top:6px">重新获取二维码</button>
                </div>
            </div>`;
        }
        return renderScanRing('正在生成 WeLink 助理授权二维码…', '通过 WeLink 助理 SDK 扫码授权接入');
    }

    async function logoutWelink() {
        try {
            await fetch('/api/channels/welink-cli/logout', { method: 'POST', headers: scanHeaders() });
        } catch (_) {}
        loadWelinkStatus({ autoLogin: false });
    }

    function renderScan() {
        if (scan.weixinDisabled && scan.tab === 'weixin') {
            scan.tab = 'welink';
        }
        const tabs = `<div class="v2-seg v2-scan-tabs" role="tablist">
            <button type="button" role="tab" aria-selected="${scan.tab === 'welink'}" data-scan-tab="welink">${esc(t('scanWelink', 'WeLink 本人'))}</button>
            <button type="button" role="tab" aria-selected="${scan.tab === 'welinkbot'}" data-scan-tab="welinkbot">${esc(t('scanWelinkBot', 'WeLink 助理'))}</button>
            ${scan.weixinDisabled ? '' : `<button type="button" role="tab" aria-selected="${scan.tab === 'weixin'}" data-scan-tab="weixin">${esc(t('scanWeixin', '微信助理'))}</button>`}
        </div>`;

        let body = '';
        if (scan.tab === 'welink') {
            const w = scan.welink;
            if (w.checking) {
                body = renderScanRing('正在连接 WeLink…', '正在检查本机 WeLink PC 登录状态');
            } else if (w.status?.status === 403) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">🔒</div>
                    <div class="v2-scan-connected-title">仅系统管理员可用</div>
                    <div class="v2-scan-connected-meta">WeLink 个人身份在当前机器以管理员身份登录后，Dragon Claw 可代为智能办公。</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>
                    </div>
                </div>`;
            } else if (w.status?.install?.unsupported) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">🪟</div>
                    <div class="v2-scan-connected-title">${esc(t('scanWindowsOnly', '仅支持 Windows'))}</div>
                    <div class="v2-scan-connected-meta">${esc(t('scanWindowsHint', '内置的 welink-cli 只能在 Windows 上运行，并需要本机登录 WeLink PC。'))}</div>
                </div>`;
            } else if (w.status?.network?.intranet === false) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">🌐</div>
                    <div class="v2-scan-connected-title">${esc(t('scanIntranetOnly', '仅限内网使用'))}</div>
                    <div class="v2-scan-connected-meta">${esc(t('scanIntranetHint', 'WeLink 个人身份仅限华为内网使用。当前网络无法访问 WeLink 内网服务，请连接公司内网或 VPN 后重新检测。'))}</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-account-btn is-primary" data-scan-action="recheck-welink" style="margin-top:6px">${esc(t('scanRecheck', '重新检测'))}</button>
                    </div>
                </div>`;
            } else if (w.status?.install && !w.status.install.available) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">📦</div>
                    <div class="v2-scan-connected-title">未检测到 welink-cli</div>
                    <div class="v2-scan-connected-meta">内置的 welink-cli 缺失，可重新安装客户端，或在全局设置中指定 CLI 路径。</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>
                    </div>
                </div>`;
            } else if (w.status?.auth?.loggedIn) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">👤</div>
                    <div class="v2-scan-connected-title">${esc(t('scanLoggedInWelink', '已登录 WeLink 个人身份'))}</div>
                    <div class="v2-scan-connected-account">${esc(w.status.auth.uid || '当前会话有效')}</div>
                    <div class="v2-scan-connected-meta">Dragon Claw 已获授权，可通过 @welink-office 以你的身份协同办公（查联系人、日程、邮件等）</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-pop-item" data-scan-action="relogin-welink">${esc(t('scanRelogin', '重新扫码'))}</button>
                        <button type="button" class="v2-pop-item" data-scan-action="logout-welink">${esc(t('scanLogout', '退出登录'))}</button>
                        <button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>
                    </div>
                </div>`;
            } else if (w.login && (w.login.phase === 'qrcode' || w.login.qrUrl || w.login.qrText)) {
                let qrImage = '';
                if (w.login.qrUrl) {
                    qrImage = `<img src="${esc(w.login.qrUrl)}" alt="WeLink QR" draggable="false">`;
                } else if (w.login.qrText && window.ToolsQrCode) {
                    try { qrImage = window.ToolsQrCode.toSvg(w.login.qrText, { scale: 4, border: 2 }); } catch (_) {}
                }
                const isPulse = w.login.statusText?.includes('已扫码');
                body = `
                    ${renderScanQrBox(qrImage || '<span class="v2-scan-loading"></span>')}
                    <div class="v2-scan-hint-lead">${esc(t('scanWaitWeLink', '请使用手机 WeLink 扫码登录'))}</div>
                    <div class="v2-scan-hint-sub">确认后凭据安全缓存在本机，供 Dragon Claw 协同办公</div>
                    <div class="v2-scan-status-pill ${isPulse ? 'is-pulsing' : ''}">
                        <span class="v2-scan-dot"></span>
                        <span>${esc(w.login.statusText || '等待扫码…')}</span>
                    </div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-pop-item" data-scan-action="relogin-welink">${esc(t('scanRelogin', '刷新二维码'))}</button>
                        <button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>
                    </div>`;
            } else if (w.login && w.login.phase === 'done') {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">✅</div>
                    <div class="v2-scan-connected-title">登录成功！</div>
                    <div class="v2-scan-connected-meta">凭据已保存在本机，正在同步…</div>
                </div>`;
            } else if (w.login && (w.login.phase === 'failed' || w.login.phase === 'expired')) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">⚠️</div>
                    <div class="v2-scan-connected-title">${esc(w.login.phase === 'expired' ? '二维码已过期' : '登录未完成')}</div>
                    <div class="v2-scan-connected-meta">${esc(w.login.error || '连接超时或未检测到 WeLink PC 运行')}</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-account-btn is-primary" data-scan-action="relogin-welink" style="margin-top:6px">重新获取二维码</button>
                    </div>
                </div>`;
            } else {
                body = renderScanRing(w.login?.statusText || t('scanConnecting', '正在连接 WeLink PC…'), '请确保本机 WeLink 客户端处于运行登录状态');
            }
        } else if (scan.tab === 'welinkbot') {
            body = renderWelinkBot();
        } else {
            // 微信 (weixin) 标签
            const wx = scan.weixin;
            if (scan.weixinDisabled || wx.status?.disabledByIntranet) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">🌐</div>
                    <div class="v2-scan-connected-title">华为内网已自动禁用微信</div>
                    <div class="v2-scan-connected-meta">${esc(scan.weixinDisabledHint || wx.status?.disabledHint || '当前处于华为内网环境，无法连接微信外网服务（ilinkai.weixin.qq.com）。左下角扫码仅提供 WeLink 服务。')}</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-account-btn is-primary" data-scan-action="switch-to-welink">切换至 WeLink 扫码</button>
                    </div>
                </div>`;
            } else if (wx.checking) {
                body = renderScanRing('正在检查微信连接状态…', '通过微信 ClawBot (iLink 协议) 接入');
            } else if (wx.status?.connected || wx.status?.bot?.id) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">💬</div>
                    <div class="v2-scan-connected-title">${esc(t('scanConnectedWeixin', '微信助理已连接'))}</div>
                    <div class="v2-scan-connected-account">Bot: ${esc(wx.status.bot?.id || wx.status.bot?.ownerUserId || '在线')}</div>
                    <div class="v2-scan-connected-meta">微信助理在线运行，可接收微信消息并由 Dragon Claw 协同回复与推送</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-pop-item" data-scan-action="relogin-weixin">${esc(t('scanRelogin', '重新扫码'))}</button>
                        <button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>
                    </div>
                </div>`;
            } else if (wx.qr && wx.qr.type === 'qrcode_generated') {
                const qrVal = wx.qr.display?.weUrl || wx.qr.display?.qrcode || wx.qr.qrcode;
                let qrImage = '';
                if (qrVal && window.ToolsQrCode) {
                    try { qrImage = window.ToolsQrCode.toSvg(qrVal, { scale: 4, border: 2 }); } catch (_) {}
                }
                body = `
                    ${renderScanQrBox(qrImage || '<span class="v2-scan-loading"></span>')}
                    <div class="v2-scan-hint-lead">${esc(t('scanWaitWeixin', '请使用手机微信扫码并确认'))}</div>
                    <div class="v2-scan-hint-sub">通过微信 ClawBot 接入个人微信助理</div>
                    <div class="v2-scan-status-pill">
                        <span class="v2-scan-dot"></span>
                        <span>等待微信扫码确认…</span>
                    </div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-pop-item" data-scan-action="relogin-weixin">${esc(t('scanRelogin', '刷新二维码'))}</button>
                        <button type="button" class="v2-pop-item" data-scan-action="open-channel-settings">${esc(t('scanChannelSettings', '频道设置'))}</button>
                    </div>`;
            } else if (wx.qr && wx.qr.type === 'scanned') {
                const qrVal = wx.qr.display?.weUrl || wx.qr.display?.qrcode || wx.qr.qrcode;
                let qrImage = qrVal && window.ToolsQrCode ? window.ToolsQrCode.toSvg(qrVal, { scale: 4, border: 2 }) : '';
                body = `
                    ${renderScanQrBox(qrImage || '<span class="v2-scan-loading"></span>')}
                    <div class="v2-scan-hint-lead">已扫码，请在手机微信上点击确认</div>
                    <div class="v2-scan-status-pill is-pulsing">
                        <span class="v2-scan-dot"></span>
                        <span>手机已扫码，正在等待确认授权…</span>
                    </div>`;
            } else if (wx.qr && wx.qr.type === 'need_verifycode') {
                body = `
                    <div class="v2-scan-verify-box">
                        <div style="font-weight:500;margin-bottom:4px">请输入手机微信上显示的数字以继续：</div>
                        <div class="v2-scan-verify-row">
                            <input type="text" data-scan-verify-code inputmode="numeric" maxlength="12" placeholder="数字验证码" autofocus>
                            <button type="button" class="v2-account-btn is-primary" data-scan-action="submit-weixin-verify">提交</button>
                        </div>
                    </div>`;
            } else if (wx.qr && wx.qr.type === 'confirmed') {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">✅</div>
                    <div class="v2-scan-connected-title">微信登录成功！</div>
                    <div class="v2-scan-connected-meta">微信助理已连接，正在同步状态…</div>
                </div>`;
            } else if (wx.qr && (wx.qr.type === 'error' || wx.qr.type === 'expired' || wx.qr.type === 'failed')) {
                body = `<div class="v2-scan-connected">
                    <div class="v2-scan-connected-icon">⚠️</div>
                    <div class="v2-scan-connected-title">${esc(wx.qr.type === 'expired' ? '二维码已过期' : '微信接入失败')}</div>
                    <div class="v2-scan-connected-meta">${esc(wx.qr.error || '请求超时，请刷新重试')}</div>
                    <div class="v2-scan-actions">
                        <button type="button" class="v2-account-btn is-primary" data-scan-action="relogin-weixin" style="margin-top:6px">重新获取二维码</button>
                    </div>
                </div>`;
            } else {
                body = renderScanRing(t('scanConnectingWeixin', '正在生成微信登录二维码…'), '通过微信 ClawBot (iLink 协议) 接入');
            }
        }

        scan.pop.innerHTML = `${tabs}${body}`;
        fillIcons(scan.pop);
    }

    scan.pop.addEventListener('click', event => {
        const tabBtn = event.target.closest('[data-scan-tab]');
        if (tabBtn) {
            const nextTab = tabBtn.dataset.scanTab;
            if (nextTab === 'weixin' && scan.weixinDisabled) return;
            if (nextTab !== scan.tab) {
                scan.abortAll();
                scan.tab = nextTab;
                renderScan();
                loadScanTab();
            }
            return;
        }

        const actionBtn = event.target.closest('[data-scan-action]');
        if (!actionBtn) return;
        const act = actionBtn.dataset.scanAction;
        if (act === 'switch-to-welink') {
            scan.abortAll();
            scan.tab = 'welink';
            renderScan();
            loadScanTab();
            return;
        }
        if (act === 'relogin-welink') {
            startWelinkLogin();
        } else if (act === 'recheck-welink') {
            loadWelinkStatus({ autoLogin: true, refresh: true });
        } else if (act === 'logout-welink') {
            logoutWelink();
        } else if (act === 'relogin-weixin') {
            startWeixinQr();
        } else if (act === 'relogin-welinkbot') {
            startWelinkBotQr();
        } else if (act === 'submit-weixin-verify') {
            const input = scan.pop.querySelector('[data-scan-verify-code]');
            if (input && input.value.trim()) submitWeixinVerify(input.value.trim());
        } else if (act === 'open-channel-settings') {
            closePop();
            window.openNavSettingsModal?.();
            window.switchNavSettingsTab?.('channels');
        }
    });

    async function openScan(event) {
        const anchor = event.currentTarget;
        if (openPop?.pop === scan.pop) return;
        renderScan();
        showPop(scan.pop, anchor, 'up');
        await ensureQrLib().catch(() => {});
        if (openPop?.pop !== scan.pop) return;
        loadScanTab();
    }
    $('v2ScanBtn')?.addEventListener('mouseenter', openScan);
    $('v2ScanBtn')?.addEventListener('click', openScan);

    // ── 消息中心：主区整页显示平台告警（沿用 /api/alert-center） ──
    const msg = { el: null, filter: 'all', events: [], error: '' };
    function msgHeaders(json) { return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(typeof getAuthHeaderForNav === 'function' ? getAuthHeaderForNav() : {}) }; }
    function msgDay(value) {
        const date = new Date(String(value || '').replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return { day: '', time: '' };
        const today = new Date(); const y = new Date(today); y.setDate(today.getDate() - 1);
        const same = (a, b) => a.toDateString() === b.toDateString();
        const day = same(date, today) ? t('today') : same(date, y) ? t('yesterday') : date.toLocaleDateString(lang(), { month: 'long', day: 'numeric' });
        return { day, time: date.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit', hour12: false }) };
    }
    async function loadMessages() {
        msg.error = '';
        const params = new URLSearchParams({ limit: '120' });
        if (msg.filter === 'unread') params.set('status', 'unread');
        try {
            const res = await fetch(`/api/alert-center/events?${params}`, { headers: msgHeaders(), cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            msg.events = (data.events || []).filter(event => msg.filter !== 'warn' || ['warn', 'error', 'critical'].includes(event.severity));
        } catch (error) { msg.error = error.message; msg.events = []; }
        renderMessages();
    }
    function renderMessages() {
        if (!msg.el) return;
        const groups = [];
        for (const event of msg.events) {
            const { day, time } = msgDay(event.created_at);
            const key = `${day} ${time.slice(0, 2)}`;
            let group = groups[groups.length - 1];
            if (!group || group.day !== day) groups.push(group = { day, first: time, items: [] });
            group.items.push(event);
            void key;
        }
        const severityIcon = level => (['warn', 'error', 'critical'].includes(level) ? 'alert' : 'info');
        const list = msg.error ? `<div class="v2-discover-empty">${esc(t('loadFailed', { e: msg.error }))}</div>`
            : !msg.events.length ? `<div class="v2-discover-empty">${esc(t('noMessages'))}</div>`
                : groups.map(group => `<section><h3>${esc(`${group.day} ${group.first}`)}</h3>${group.items.map(event => {
                    const href = /^https?:\/\//.test(event.source || '') ? event.source : '';
                    return `<article class="v2-msg${event.status === 'unread' ? ' is-unread' : ''}" data-id="${esc(event.id)}">
                        <span class="v2-msg-icon is-${esc(event.severity || 'info')}"><span class="v2-ico" data-icon="${severityIcon(event.severity)}"></span></span>
                        <div class="v2-msg-text"><strong>${esc(event.title || '')}</strong><p>${esc(event.ai_summary || event.message || '')}</p></div>
                        <span class="v2-msg-time">${esc(msgDay(event.created_at).time)}</span>
                        ${href ? `<a class="v2-account-btn" href="${esc(href)}" data-msg-read>${esc(t('view'))}</a>` : event.status === 'unread' ? `<button type="button" class="v2-account-btn" data-msg-read>${esc(t('markRead'))}</button>` : ''}
                    </article>`;
                }).join('')}</section>`).join('');
        msg.el.querySelector('.v2-msg-list').innerHTML = list;
        msg.el.querySelectorAll('[data-msg-filter]').forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.msgFilter === msg.filter)));
        fillIcons(msg.el);
    }
    function openMessages() {
        closePop();
        if (!msg.el) {
            msg.el = document.createElement('section');
            msg.el.className = 'v2-messages';
            msg.el.setAttribute('role', 'dialog');
            msg.el.setAttribute('aria-label', t('messages'));
            document.body.appendChild(msg.el);
            msg.el.addEventListener('click', async event => {
                const filter = event.target.closest('[data-msg-filter]');
                if (filter) { msg.filter = filter.dataset.msgFilter; loadMessages(); return; }
                if (event.target.closest('[data-msg-close]')) return closeMessages();
                if (event.target.closest('[data-msg-all]')) {
                    await fetch('/api/alert-center/events/read-all', { method: 'PUT', headers: msgHeaders(true), body: '{}' }).catch(() => {});
                    window.refreshAlertCenterBadge?.(); loadMessages(); return;
                }
                if (event.target.closest('[data-msg-clear]')) {
                    const confirmMsg = lang() === 'en-US' ? 'Clear all alert messages?' : '确定清空所有告警消息？';
                    const ok = window.AppDialog
                        ? await window.AppDialog.confirm(confirmMsg, { title: lang() === 'en-US' ? 'Clear all' : '全部清除', tone: 'danger', confirmText: lang() === 'en-US' ? 'Clear' : '清空', cancelText: lang() === 'en-US' ? 'Cancel' : '取消' })
                        : confirm(confirmMsg);
                    if (!ok) return;
                    await fetch('/api/alert-center/events/clear-all', { method: 'POST', headers: msgHeaders(true), body: '{}' }).catch(() => {});
                    window.refreshAlertCenterBadge?.(); loadMessages(); return;
                }
                const read = event.target.closest('[data-msg-read]');
                if (read) {
                    const id = read.closest('[data-id]')?.dataset.id;
                    if (id) fetch('/api/alert-center/events/read', { method: 'PUT', headers: msgHeaders(true), body: JSON.stringify({ ids: [id] }) }).then(() => window.refreshAlertCenterBadge?.()).catch(() => {});
                    if (read.tagName === 'BUTTON') { read.closest('.v2-msg')?.classList.remove('is-unread'); read.remove(); }
                }
            });
        }
        msg.el.innerHTML = `<header><span></span><h2>${esc(t('messages'))}</h2><button type="button" class="v2-icon-btn" data-msg-close aria-label="×"><span class="v2-ico" data-icon="close"></span></button></header>
            <div class="v2-msg-toolbar"><div class="v2-seg">${[['all', t('filterAll')], ['unread', t('filterUnread')], ['warn', t('filterWarn')]].map(([id, label]) => `<button type="button" role="tab" data-msg-filter="${id}" aria-selected="${msg.filter === id}">${esc(label)}</button>`).join('')}</div><span></span><button type="button" class="v2-account-btn" data-msg-all>${esc(t('markAllRead'))}</button><button type="button" class="v2-account-btn" data-msg-clear>${esc(t('clearAll'))}</button></div>
            <div class="v2-msg-list"><div class="v2-discover-empty">…</div></div>`;
        fillIcons(msg.el);
        msg.el.classList.add('is-open');
        document.body.classList.add('v2-messages-open');
        loadMessages();
    }
    function closeMessages() {
        msg.el?.classList.remove('is-open');
        document.body.classList.remove('v2-messages-open');
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && msg.el?.classList.contains('is-open') && !openPop) closeMessages(); });
    // Dismiss before navigation handlers run: some menus keep the same home mode,
    // and conversation buttons may stop bubbling at their list container.
    document.addEventListener('click', event => {
        if (!msg.el?.classList.contains('is-open')) return;
        const target = event.target.closest('button, a[href], [role="button"], [role="menuitem"]');
        if (!target || target.closest('#v2AlertBtn, [data-v2-action="alerts"], [data-v2-do="alerts"], .v2-side-tools')
            || target.matches('.is-disabled, :disabled, [aria-disabled="true"]')) return;
        if (target.closest('#homeSidebar') || target.matches('[data-v2-action], [data-v2-do]')) closeMessages();
    }, true);


    // 告警数、服务状态、版本号沿用导航栏（导航栏隐藏但仍在运行），这里只做镜像
    function mirrorNavbar() {
        const count = $('navAlertCount');
        const badge = $('v2AlertCount');
        if (count && badge) { badge.hidden = count.hidden || !Number(count.textContent); badge.textContent = count.textContent; }
        const version = $('nav-resource-version-display')?.textContent?.trim();
        if (version) $('v2Version').textContent = version.split(' · ')[0];
        renderUser();
    }
    let navObserver = null;
    function watchNavbar() {
        const nav = $('app-navbar');
        if (!nav || nav.__v2Watched) return;
        nav.__v2Watched = true;
        navObserver?.disconnect();
        navObserver = new MutationObserver(mirrorNavbar);
        navObserver.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
        mirrorNavbar();
    }
    // 导航栏会整体重绘（语言、数据空间切换后），重绘后重新挂监听
    new MutationObserver(watchNavbar).observe(document.body, { childList: true });

    window.addEventListener('tools:ops-inbox-total', event => {
        const total = Number(event.detail?.total) || 0;
        $('v2OpsCount').hidden = !total;
        $('v2OpsCount').textContent = total > 99 ? '99+' : String(total);
    });

    // ── 模式切换（对话 / 工具 / 频道会话） ──
    const isChannelSource = s => ['welink', 'weixin'].includes(s);
    function renderModes() {
        const mode = window.HomeMode?.get?.() || (document.body.classList.contains('home-mode-tools') ? 'tools' : 'chat');
        document.querySelectorAll('[data-v2-modes]').forEach(seg => {
            seg.innerHTML = [['chat', 'chat', t('modeChat')], ['tools', 'tools', t('modeTools')]]
                .map(([id, icon, label]) => `<button type="button" role="tab" aria-selected="${mode === id}" data-v2-mode="${id}"><span class="v2-ico" data-icon="${icon}"></span>${esc(label)}</button>`).join('');
            fillIcons(seg);
        });
        const hub = Boolean(window.HomeSkillHub?.isOpen?.());
        const navItem = document.querySelector('.v2-nav-item[data-v2-action="channels"]');
        const isChannelDisabled = Boolean(navItem?.classList.contains('is-disabled'));
        const isChannel = !hub && !isChannelDisabled && mode === 'chat' && isChannelSource(activeChatSource());
        document.querySelectorAll('.v2-nav-item[data-v2-action="newChat"]').forEach(el => el.classList.toggle('is-active', !hub && mode === 'chat' && !isChannel));
        document.querySelectorAll('.v2-nav-item[data-v2-action="channels"]').forEach(el => el.classList.toggle('is-active', isChannel));
        document.querySelectorAll('.v2-nav-item[data-v2-action="skillHub"]').forEach(el => el.classList.toggle('is-active', hub));
    }

    // ── 频道会话入口启用/禁用状态（无对接或未启用时灰色禁用并悬停说明） ──
    let lastChannelsData = null;
    function updateChannelsNavState(data) {
        if (data) lastChannelsData = data;
        const currentData = data || lastChannelsData || { items: window.HomeWelinkThreads?.channels?.() || [], summary: window.HomeWelinkThreads?.summary?.() || {} };
        if (currentData.network?.weixinDisabled || currentData.summary?.weixin?.disabledByIntranet) {
            scan.weixinDisabled = true;
            scan.weixinDisabledHint = currentData.network?.hint || currentData.summary?.weixin?.disabledHint || '';
            if (scan.tab === 'weixin') {
                scan.tab = 'welink';
                if (openPop?.pop === scan.pop) renderScan();
            }
        }
        const navItem = document.querySelector('.v2-nav-item[data-v2-action="channels"]');
        if (!navItem) return;
        const items = Array.isArray(currentData.items) ? currentData.items : [];
        const summary = currentData.summary || {};
        const hasEnabled = items.length > 0;
        const hasConfigured = Object.values(summary).some(s => s && s.configured);

        if (hasEnabled) {
            navItem.classList.remove('is-disabled');
            navItem.removeAttribute('aria-disabled');
            delete navItem.dataset.disabledReason;
            navItem.title = t('channels');
        } else {
            navItem.classList.add('is-disabled');
            navItem.setAttribute('aria-disabled', 'true');
            navItem.classList.remove('is-active');
            const reasonKey = hasConfigured ? 'channelDisabledNotEnabled' : 'channelDisabledNoChannel';
            const reason = t(reasonKey);
            navItem.title = reason;
            navItem.dataset.disabledReason = reason;
        }
        renderModes();
    }
    window.addEventListener('tools:channels-updated', event => updateChannelsNavState(event.detail));
    document.addEventListener('click', event => {
        const btn = event.target.closest('[data-v2-mode]');
        if (btn) window.HomeMode?.set(btn.dataset.v2Mode);
    });
    window.addEventListener('home:mode', () => { renderModes(); closeMessages(); });
    window.addEventListener('home:hub', event => { renderModes(); if (event.detail?.open) closeMessages(); });
    window.addEventListener('home:tool-frame', event => { if (event.detail?.open) closeMessages(); });

    // ── 侧边栏收起 ──
    const SIDE_KEY = 'tools_v2_side';
    // 鼠标最后的位置：点击收起后浮动按钮正好出现在指针下，不能因此立刻又滑出侧栏
    let lastPointer = null;
    document.addEventListener('pointermove', event => { lastPointer = { x: event.clientX, y: event.clientY }; }, { passive: true });
    let peekArmed = true;
    function setSideCollapsed(collapsed) {
        document.body.classList.toggle('v2-side-collapsed', collapsed);
        try { localStorage.setItem(SIDE_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* 无痕模式 */ }
        setSidePeek(false);
        const toggle = $('v2SideToggle');
        if (toggle) { toggle.removeAttribute('title'); toggle.setAttribute('aria-label', t(collapsed ? 'expand' : 'collapse')); }
        floatToggle.setAttribute('aria-label', t('expand'));
        hideFloatTip();
        // 收起后指针若已在浮动按钮上：先不滑出，移开再悬停才滑出
        peekArmed = true;
        if (collapsed && lastPointer) {
            const r = floatToggle.getBoundingClientRect();
            if (lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom) peekArmed = false;
        }
    }
    const isSideCollapsed = () => document.body.classList.contains('v2-side-collapsed');
    const shortcutKey = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘B' : 'Ctrl+B';

    // 收起后左上角：侧边栏按钮（悬停临时滑出侧栏，点击恢复）+ 新建对话（任意界面一键新建）
    const sideFloat = document.createElement('div');
    sideFloat.className = 'v2-side-float';
    sideFloat.innerHTML = '<button type="button" class="v2-icon-btn" data-v2-float="toggle"><span class="v2-ico" data-icon="sidebar"></span></button>'
        + '<button type="button" class="v2-icon-btn" data-v2-float="newChat"><span class="v2-ico" data-icon="chatPlus"></span></button>';
    document.body.appendChild(sideFloat);
    fillIcons(sideFloat);
    const floatToggle = sideFloat.querySelector('[data-v2-float="toggle"]');
    const floatNew = sideFloat.querySelector('[data-v2-float="newChat"]');
    floatNew.setAttribute('aria-label', t('newChat'));

    // 深色提示气泡（按钮下方）：名称 + 快捷键
    const floatTip = document.createElement('div');
    floatTip.className = 'v2-float-tip';
    floatTip.setAttribute('role', 'tooltip');
    document.body.appendChild(floatTip);
    let floatTipTimer = 0;
    function showFloatTip(anchor, label, key = '') {
        clearTimeout(floatTipTimer);
        floatTipTimer = setTimeout(() => {
            floatTip.innerHTML = `<span>${esc(label)}</span>${key ? `<kbd>${esc(key)}</kbd>` : ''}`;
            const rect = anchor.getBoundingClientRect();
            floatTip.style.top = `${rect.bottom + 6}px`;
            floatTip.style.left = `${Math.max(6, rect.left + rect.width / 2 - floatTip.offsetWidth / 2)}px`;
            floatTip.classList.add('is-open');
        }, 350);
    }
    function hideFloatTip() { clearTimeout(floatTipTimer); floatTip.classList.remove('is-open'); }
    const tipFor = el => el === floatNew ? [t('newChat'), '']
        : [t(isSideCollapsed() ? 'expand' : 'collapse'), shortcutKey];
    [floatToggle, floatNew, $('v2SideToggle')].filter(Boolean).forEach(el => {
        el.addEventListener('mouseenter', () => showFloatTip(el, ...tipFor(el)));
        el.addEventListener('mouseleave', hideFloatTip);
        el.addEventListener('click', hideFloatTip);
    });

    // 悬停浮动的侧边栏按钮：侧栏从左侧滑出（浮层，不挤占内容），移开收回；点击恢复为常驻侧栏
    const sidebarEl = $('homeSidebar');
    const wideSide = () => window.matchMedia('(min-width: 861px)').matches;
    let peekTimer = 0;
    function setSidePeek(on) {
        clearTimeout(peekTimer);
        const next = Boolean(on) && isSideCollapsed() && wideSide();
        document.body.classList.toggle('v2-side-peek', next);
        floatToggle?.classList.toggle('is-on', next);
    }
    function schedulePeekEnd() {
        clearTimeout(peekTimer);
        peekTimer = setTimeout(() => {
            if (!document.body.classList.contains('v2-side-peek')) return;
            // 从滑出的侧栏里打开的菜单 / 弹层还在用时先不收
            if (floatToggle.matches(':hover') || sidebarEl?.matches(':hover') || document.querySelector('.v2-pop.is-open, .home-links-pop:not([hidden])')) { schedulePeekEnd(); return; }
            setSidePeek(false);
        }, 280);
    }
    floatToggle.addEventListener('mouseenter', () => { if (isSideCollapsed() && peekArmed) setSidePeek(true); });
    floatToggle.addEventListener('mouseleave', () => { peekArmed = true; schedulePeekEnd(); });
    sidebarEl?.addEventListener('mouseenter', () => { if (document.body.classList.contains('v2-side-peek')) clearTimeout(peekTimer); });
    sidebarEl?.addEventListener('mouseleave', () => { if (document.body.classList.contains('v2-side-peek')) schedulePeekEnd(); });
    floatToggle.addEventListener('click', () => setSideCollapsed(false));
    floatNew.addEventListener('click', () => { setSidePeek(false); run('newChat'); });
    $('v2SideToggle')?.addEventListener('click', () => setSideCollapsed(!isSideCollapsed()));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.body.classList.contains('v2-side-peek')) setSidePeek(false);
        // ⌘B / Ctrl+B：收起或恢复侧栏
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            setSideCollapsed(!isSideCollapsed());
        }
    });
    window.addEventListener('resize', () => { if (!wideSide()) setSidePeek(false); });

    const authHeaders = () => (typeof getAuthHeaderForNav === 'function' ? getAuthHeaderForNav() : { Authorization: `Bearer ${localStorage.getItem('tools_token') || ''}` });
    const getJson = async url => { const res = await fetch(url, { headers: authHeaders(), cache: 'no-store' }); return res.ok ? res.json() : null; };
    // ── 筛选：状态 + 时间（对三个来源的列表都生效，js/home/conversation-list.js） ──
    const sortPop = makePop('v2-sort');
    function renderSortMenu() {
        const filter = window.HomeConversationList?.getFilter?.() || { status: 'all', time: 'all' };
        const option = (label, attr, on) => `<button type="button" class="v2-pop-item v2-check-item${on ? ' is-checked' : ''}" role="menuitemradio" aria-checked="${on}" ${attr}><span>${esc(label)}</span>${on ? '<span class="v2-ico v2-check" data-icon="check"></span>' : ''}</button>`;
        sortPop.innerHTML = `<div class="v2-pop-cap">${esc(t('filterStatus'))}</div>
            ${[['all', 'statusAll'], ['pinned', 'statusPinned'], ['group', 'statusGroup'], ['workspace', 'statusWorkspace']].map(([id, key]) => option(t(key), `data-filter-status="${id}"`, filter.status === id)).join('')}
            <div class="v2-pop-sep"></div><div class="v2-pop-cap">${esc(t('filterTime'))}</div>
            ${[['all', 'timeAll'], ['today', 'timeToday'], ['7', 'time7'], ['30', 'time30']].map(([id, key]) => option(t(key), `data-filter-time="${id}"`, filter.time === id)).join('')}
            <div class="v2-pop-sep"></div><button type="button" class="v2-pop-item" data-filter-archived>${lang() === 'en-US' ? 'Show / hide archived chats' : '查看 / 收起已归档对话'}</button><button type="button" class="v2-pop-item v2-pop-reset" data-filter-reset${filter.status === 'all' && filter.time === 'all' ? ' disabled' : ''}>${esc(t('filterReset'))}</button>`;
        fillIcons(sortPop);
        $('v2SortBtn')?.classList.toggle('is-on', filter.status !== 'all' || filter.time !== 'all');
    }
    sortPop.addEventListener('click', event => {
        const status = event.target.closest('[data-filter-status]');
        const time = event.target.closest('[data-filter-time]');
        if (status) window.HomeConversationList?.setFilter?.({ status: status.dataset.filterStatus });
        else if (time) window.HomeConversationList?.setFilter?.({ time: time.dataset.filterTime });
        else if (event.target.closest('[data-filter-archived]')) window.HomeConversationList?.toggleArchived?.(activeChatSource()==='agents' ? 'desktop:'+activeProvider() : activeChatSource());
        else if (event.target.closest('[data-filter-reset]')) window.HomeConversationList?.setFilter?.({ status: 'all', time: 'all' });
        else return;
        renderSortMenu();
    });
    $('v2SortBtn')?.addEventListener('click', event => {
        const anchor = event.currentTarget;
        if (openPop?.pop === sortPop) return closePop();
        renderSortMenu();
        showPop(sortPop, anchor, 'down');
    });

    // ── 对话分类：侧栏里可折叠的分组（对话 / 微信 / WeLink），同一时间展开一组 ──
    // 桌面 Agent（Codex / Claude Code / Antigravity）的会话已合并进「对话」列表，不再单独分组。
    // 分组头只负责切换来源（沿用 HomeWelinkThreads.setSource），列表本身仍由原模块渲染，通过 CSS order 排到展开的分组头下面。
    const groups = { bound: false, collapsed: false, visualCollapsed: false, animations: [], animationVersion: 0 };
    const chatView = () => document.querySelector('.home-panel-view[data-home-panel="chat"]');
    const activeChatSource = () => window.HomeWelinkThreads?.source?.() || document.querySelector('.home-chat-tabs [data-chat-source].is-active')?.dataset.chatSource || 'mine';
    const activeProvider = () => document.querySelector('.desktop-agent-provider[aria-pressed="true"]')?.dataset.desktopProvider || '';
    function groupList() {
        const source = activeChatSource();
        if (isChannelSource(source)) {
            // 频道会话视图：只出现微信或者 WeLink 对话
            const tabs = [...document.querySelectorAll('.home-chat-tabs [data-chat-source]')].map(btn => btn.dataset.chatSource);
            const available = (window.HomeWelinkThreads?.channels?.() || []).map(c => c.id);
            const channelIds = ['weixin', 'welink'].filter(id => available.includes(id) || tabs.includes(id));
            const list = [];
            for (const id of (channelIds.length ? channelIds : [source])) {
                list.push({ id, label: id === 'weixin' ? t('scanWeixin') : 'WeLink' });
            }
            return list;
        }
        // 普通对话视图：列表自带「任务」「空间」两个顶级分类（js/home/dragon-claw.js），不再显示「对话」分组头
        return [];
    }
    function activeGroupId() {
        const source = activeChatSource();
        return source === 'agents' ? 'mine' : source;
    }
    function visibleCount() {
        const source = activeChatSource();
        const scope = source === 'agents' ? document.querySelector('.desktop-agent-list') : (isChannelSource(source) ? $('homeWelinkList') : $('homeChatList'));
        return scope ? [...scope.querySelectorAll(source === 'agents' ? '[data-desktop-session]' : (source === 'mine' ? '.home-chat-item' : '[data-wl-thread], .home-chat-item'))].filter(row => !row.closest('.conversation-list-row[hidden]')).length : 0;
    }
    // 对话顶栏标题：显示当前打开的对话（侧栏里高亮的那一条），没有时显示 Dragon Claw
    function renderChatTitle() {
        const name = document.querySelector('.dc-chat-head .dc-chat-name');
        if (!name) return;
        const active = document.querySelector('#homeChatList .home-chat-item.is-active .home-chat-title, #homeWelinkList .home-chat-item.is-active .home-chat-title, .desktop-agent-list .is-active [class*="title"], #homeChatList .is-active [class*="title"]');
        const channel = activeChatSource();
        const fallback = isChannelSource(channel) ? (channel === 'weixin' ? t('scanWeixin') : 'WeLink') : 'Dragon Claw';
        const title = active?.textContent.trim() || fallback;
        if (name.textContent !== title) name.textContent = title;
    }
    function renderGroups() {
        clearHeads();
        renderChatTitle();
        const view = chatView();
        if (!view) return;
        if (!groups.bound) {
            groups.bound = true;
            view.addEventListener('click', event => {
                const head = event.target.closest('.v2-group-head[data-group]');
                if (head) toggleGroup(head.dataset.group);
            });
        }
        const active = activeGroupId();
        const list = groupList();
        if (!list.length) {
            groups.collapsed = false;
            groups.visualCollapsed = false;
        }
        view.classList.toggle('v2-groups-collapsed', Boolean(list.length && groups.visualCollapsed));
        // 分组头按顺序占 order 10、30、50…；展开分组的工具栏和列表排在它后面（order +10）
        list.forEach((group, index) => {
            const isActive = group.id === active;
            const head = [...view.querySelectorAll(':scope > .v2-group-head')].find(node => node.dataset.group === group.id) || document.createElement('button');
            head.type = 'button';
            head.className = 'v2-group-head';
            head.dataset.group = group.id;
            head.style.order = String(10 + index * 20);
            head.setAttribute('aria-expanded', String(isActive && !groups.collapsed));
            const content = `<span class="v2-ico v2-group-chev" data-icon="chevron"></span><span>${esc(group.label)}</span>${isActive ? `<small>(${visibleCount()})</small>` : ''}`;
            if (head.dataset.content !== content) { head.innerHTML = content; head.dataset.content = content; }
            if (head.parentElement !== view) view.appendChild(head);
            if (isActive) view.style.setProperty('--v2-active-order', String(20 + index * 20));
        });
        fillIcons(view);
    }
    // 保留当前分组头，让箭头旋转可以连续过渡；只移除失效的分组。
    function clearHeads() {
        const ids = groupList().map(group => group.id);
        chatView()?.querySelectorAll(':scope > .v2-group-head').forEach(el => { if (!ids.includes(el.dataset.group)) el.remove(); });
    }
    function animateGroup(collapsed) {
        const view = chatView();
        if (!view) return;
        const nodes = [...view.querySelectorAll(':scope > .home-chat-list, :scope > .desktop-agents-sidebar')];
        const heights = new Map(nodes.map(node => [node, node.getBoundingClientRect().height]));
        groups.animations.forEach(animation => animation.cancel());
        const version = ++groups.animationVersion;
        groups.collapsed = collapsed;
        if (!collapsed) nodes.forEach(node => {
            window.HomeConversationList?.reset?.(node);
            node.querySelectorAll('.home-chat-list').forEach(list => window.HomeConversationList?.reset?.(list));
        });
        groups.visualCollapsed = false;
        clearHeads();renderGroups();
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        groups.animations = nodes.filter(node => !node.hidden && getComputedStyle(node).display !== 'none').map(node => {
            node.style.overflow = 'hidden';
            return node.animate([
                { height: `${heights.get(node)}px`, opacity: heights.get(node) ? 1 : 0 },
                { height: `${collapsed ? 0 : node.scrollHeight}px`, opacity: collapsed ? 0 : 1 }
            ], { duration: reduced ? 0 : 220, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'both' });
        });
        Promise.all(groups.animations.map(animation => animation.finished)).then(() => {
            if (version !== groups.animationVersion) return;
            groups.visualCollapsed = collapsed;
            groups.animations.forEach(animation => animation.cancel());groups.animations = [];
            nodes.forEach(node => node.style.removeProperty('overflow'));
            clearHeads();renderGroups();
            if (collapsed) nodes.forEach(node => {
                window.HomeConversationList?.reset?.(node);
                node.querySelectorAll('.home-chat-list').forEach(list => window.HomeConversationList?.reset?.(list));
            });
        }).catch(() => { /* A second click reverses the current animation. */ });
    }
    function toggleGroup(id) {
        if (id === activeGroupId()) { animateGroup(!groups.collapsed); return; }
        groups.collapsed = false;groups.visualCollapsed = false;
        window.HomeMode?.set('chat');
        window.HomeWelinkThreads?.setSource?.(id);
        setTimeout(() => { clearHeads(); renderGroups(); renderModes(); }, 30);
    }
    let groupsQueued = false;
    function queueGroups() {
        if (groupsQueued) return;
        groupsQueued = true;
        requestAnimationFrame(() => { groupsQueued = false; renderModes(); clearHeads(); renderGroups(); });
    }
    // 来源切换、列表重绘、频道连接变化后刷新分组头
    const ownNode = node => node.nodeType !== 1 || node.classList.contains('v2-group-head') || Boolean(node.closest?.('.v2-group-head'));
    new MutationObserver(records => {
        if (records.every(record => ownNode(record.target) || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(ownNode)))) return;
        queueGroups();
    }).observe(document.querySelector('.home-panel') || document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'hidden'] });

    // ── 搜索窗口：对话 / 频道 / 桌面 Agent / 应用 / 技能，键盘上下切换、回车打开、Tab 切换类别 ──
    const search = { el: null, tab: 'all', query: '', results: [], active: 0, seq: 0, timer: 0 };
    const SEARCH_TABS = ['all', 'chats', 'channels', 'agents', 'apps', 'skills'];
    const tabLabel = id => t({ all: 'searchTabsAll', chats: 'searchChats', channels: 'searchChannels', agents: 'searchAgents', apps: 'searchApps', skills: 'searchSkills' }[id]);
    const textMatch = (text, q) => String(text || '').toLowerCase().includes(q) || Boolean(window.ToolsPinyinSearch?.pinyinMatches?.(String(text || ''), q));
    const searchers = {
        async chats(q) {
            const data = await getJson(`/api/ai/sessions?mine=1&pagePath=%2F&limit=12&query=${encodeURIComponent(q)}`);
            return (data?.items || []).map(item => ({ type: 'chats', icon: 'chat', title: item.title || item.preview || item.id, sub: item.updatedAt || '', open: () => { window.HomeMode?.set('chat'); window.HomeWelinkThreads?.setSource?.('mine'); window.DragonClaw?.openChat?.(item); } }));
        },
        async channels(q) {
            const channels = [...document.querySelectorAll('.home-chat-tabs [data-chat-source]')].map(btn => btn.dataset.chatSource).filter(id => ['welink', 'weixin'].includes(id));
            const lists = await Promise.all(channels.map(async channel => {
                const data = await getJson(`/api/channels/${channel}/threads?limit=8&q=${encodeURIComponent(q)}`);
                return (data?.items || data?.threads || []).map(thread => ({ type: 'channels', icon: 'channels', title: thread.title || thread.name || thread.targetName || thread.id, sub: channel === 'weixin' ? t('scanWeixin') : 'WeLink', open: () => { window.HomeMode?.set('chat'); window.HomeWelinkThreads?.setSource?.(channel); window.HomeWelinkThreads?.open?.({ ...thread, channel }); } }));
            }));
            return lists.flat();
        },
        async agents(q) {
            if (!window.HomeDesktopAgents?.available?.()) return [];
            const data = await getJson(`/api/desktop-agents/sessions?q=${encodeURIComponent(q)}`);
            return (data?.items || []).slice(0, 10).map(session => ({ type: 'agents', icon: 'terminal', title: session.title, sub: session.provider, open: () => { window.HomeMode?.set('chat'); window.HomeWelinkThreads?.setSource?.('agents'); window.HomeDesktopAgents?.open?.(session); } }));
        },
        async apps(q) {
            return apps().filter(app => matches(app, q)).slice(0, 12).map(app => ({ type: 'apps', icon: 'grid', title: app.title, sub: app.group || '', open: () => { location.href = app.href; } }));
        },
        async skills(q) {
            return (window.HomeSkills?.items?.() || []).filter(skill => textMatch(`${skill.name || ''} ${skill.title || ''} ${skill.description || ''}`, q)).slice(0, 10)
                .map(skill => ({ type: 'skills', icon: 'sparkles', title: skill.title || skill.name, sub: skill.description || '', open: () => { window.HomeMode?.set('chat'); if (skill.id || skill.name) window.DragonClaw?.startWithSkill?.(skill.id || skill.name); } }));
        }
    };
    function renderSearchResults(state) {
        const list = search.el.querySelector('.v2-search-list');
        if (state) { list.innerHTML = `<div class="v2-discover-empty">${esc(state)}</div>`; return; }
        if (!search.results.length) { list.innerHTML = `<div class="v2-discover-empty">${esc(t('searchNone'))}</div>`; return; }
        let lastType = '';
        list.innerHTML = search.results.map((item, index) => {
            const head = search.tab === 'all' && item.type !== lastType ? `<div class="v2-pop-cap">${esc(tabLabel(item.type))}</div>` : '';
            lastType = item.type;
            return `${head}<button type="button" class="v2-search-item${index === search.active ? ' is-active' : ''}" data-search-index="${index}"><span class="v2-ico" data-icon="${item.icon}"></span><span class="v2-search-text"><strong>${esc(item.title)}</strong>${item.sub ? `<small>${esc(item.sub)}</small>` : ''}</span></button>`;
        }).join('');
        fillIcons(list);
        list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    }
    async function runSearch() {
        const q = search.query.trim().toLowerCase();
        const seq = ++search.seq;
        search.active = 0;
        if (!q) { search.results = []; renderSearchResults(t('searchIdle')); return; }
        renderSearchResults(t('searching'));
        if (!window.ToolsPinyinSearch) ensurePinyin();
        const types = search.tab === 'all' ? SEARCH_TABS.slice(1) : [search.tab];
        const lists = await Promise.all(types.map(type => searchers[type](q).catch(() => [])));
        if (seq !== search.seq) return;
        search.results = lists.flatMap(list => (search.tab === 'all' ? list.slice(0, 5) : list));
        renderSearchResults();
    }
    function renderSearchTabs() {
        search.el.querySelector('.v2-search-tabs').innerHTML = SEARCH_TABS.map(id => `<button type="button" role="tab" aria-selected="${search.tab === id}" data-search-tab="${id}">${esc(tabLabel(id))}</button>`).join('');
    }
    function openSearch() {
        closePop();
        if (!search.el) {
            search.el = document.createElement('div');
            search.el.className = 'v2-search';
            search.el.innerHTML = `<div class="v2-search-panel" role="dialog" aria-modal="true">
                <div class="v2-search-input"><span class="v2-ico" data-icon="search"></span><input type="search" autocomplete="off" spellcheck="false"></div>
                <div class="v2-search-tabs" role="tablist"></div>
                <div class="v2-search-list"></div>
                <footer class="v2-search-keys"><span><kbd>↑</kbd><kbd>↓</kbd><b data-key="keyMove"></b></span><span><kbd>↵</kbd><b data-key="keyOpen"></b></span><span><kbd>Tab</kbd><b data-key="keyTab"></b></span><span><kbd>Esc</kbd><b data-key="keyClose"></b></span></footer>
            </div>`;
            document.body.appendChild(search.el);
            fillIcons(search.el);
            const input = search.el.querySelector('input');
            input.addEventListener('input', () => { search.query = input.value; clearTimeout(search.timer); search.timer = setTimeout(runSearch, 180); });
            search.el.addEventListener('mousedown', event => { if (event.target === search.el) closeSearch(); });
            search.el.addEventListener('click', event => {
                const tab = event.target.closest('[data-search-tab]');
                if (tab) { search.tab = tab.dataset.searchTab; renderSearchTabs(); runSearch(); input.focus(); return; }
                const item = event.target.closest('[data-search-index]');
                if (item) openResult(Number(item.dataset.searchIndex));
            });
            search.el.addEventListener('keydown', event => {
                if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
                else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (!search.results.length) return;
                    search.active = (search.active + (event.key === 'ArrowDown' ? 1 : -1) + search.results.length) % search.results.length;
                    renderSearchResults();
                } else if (event.key === 'Enter') { event.preventDefault(); openResult(search.active); }
                else if (event.key === 'Tab') {
                    event.preventDefault();
                    const index = SEARCH_TABS.indexOf(search.tab);
                    search.tab = SEARCH_TABS[(index + (event.shiftKey ? -1 : 1) + SEARCH_TABS.length) % SEARCH_TABS.length];
                    renderSearchTabs(); runSearch();
                }
            });
        }
        search.el.querySelector('input').placeholder = t('searchPlaceholder');
        search.el.querySelectorAll('[data-key]').forEach(el => { el.textContent = t(el.dataset.key); });
        renderSearchTabs();
        search.el.classList.add('is-open');
        const input = search.el.querySelector('input');
        input.value = search.query;
        runSearch();
        setTimeout(() => { input.focus(); input.select(); }, 20);
    }
    function closeSearch() { search.el?.classList.remove('is-open'); }
    function openResult(index) {
        const item = search.results[index];
        if (!item) return;
        closeSearch(); closeMessages();
        item.open();
    }
    $('v2SearchBtn')?.addEventListener('click', openSearch);
    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.el?.classList.contains('is-open') ? closeSearch() : openSearch(); }
    });

    // ── 快速提问：场景标签 + 建议问题，点击只填入输入框（不发送）；默认展示最近问过的问题 ──
    const SCENES = {
        'zh-CN': [
            ['analysis', '数据分析', ['本月哪些指标还没达标？按差距从大到小列出来', '对比最近三个月的 SLA 达成率，指出下降最明显的项', '帮我检查最新导入的数据里有没有异常值']],
            ['monthly', '月报生成', ['根据本月数据写出月报的关键结论和三条改进建议', '把本月指标变化整理成适合汇报的要点', '帮我写月报里“下月计划”这一部分']],
            ['expedite', '催办提醒', ['帮我写一封礼貌的催办提醒邮件', '列出超期未处理的事项，按负责人分组', '给这些超期事项写一条简短的 WeLink 提醒']],
            ['script', '写脚本', ['用 Python 写一个 Excel 去重脚本', '写一个 F12 控制台脚本，把当前页面的表格导出成 Excel', '解释「数据导入」的代码逻辑']],
            ['graph', '知识图谱', ['平台里哪些工具和 SLA 数据有关？', '解释「大屏看板」的数据来源', '画出报表看板、月报和大屏之间的数据关系']],
            ['schedule', '定时任务', ['/schedule 每个工作日早上 9 点汇总昨天的告警', '/schedule 每周一生成上周指标周报并推送到微信', '/schedule 每月 1 号提醒我导入上个月的数据']]
        ],
        'en-US': [
            ['analysis', 'Data analysis', ['Which metrics missed target this month? Sort by gap', 'Compare SLA attainment over the last three months and flag the biggest drop', 'Check the latest import for outliers']],
            ['monthly', 'Monthly report', ['Draft the key findings and three improvements for this month', 'Summarise this month’s metric changes as briefing points', 'Write the “next month plan” section']],
            ['expedite', 'Follow-ups', ['Write a polite follow-up email', 'List overdue items grouped by owner', 'Write a short WeLink reminder for these overdue items']],
            ['script', 'Scripts', ['Write a Python script that removes duplicate Excel rows', 'Write an F12 console script that exports this page’s table to Excel', 'Explain how Data Import works']],
            ['graph', 'Knowledge graph', ['Which tools use SLA data?', 'Where does the dashboard get its data?', 'Map the data flow between reports, monthly and dashboard']],
            ['schedule', 'Scheduled', ['/schedule every weekday at 9am summarise yesterday’s alerts', '/schedule every Monday send last week’s metric report to WeChat', '/schedule on the 1st remind me to import last month’s data']]
        ]
    };
    const quick = { scene: '', scenesEl: null, suggestEl: null, illustration: null, recent: [] };
    function fillInput(text) {
        const input = $('dcInput');
        if (!input) return;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(text.length, text.length);
    }
    function recentQuestions() {
        const titles = [...document.querySelectorAll('#homeChatList [data-question]')].map(el => el.dataset.question.trim());
        const matchesLanguage = title => lang() === 'en-US'
            ? /[A-Za-z]/.test(title) && !/[^\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\p{Z}\s]/u.test(title)
            : /\p{Script=Han}/u.test(title);
        return [...new Set([...titles, ...quick.recent].filter(title => title.length >= 4 && !/^@/.test(title) && matchesLanguage(title)))].slice(0, 4);
    }
    function updateSuggestionFade() {
        if (!quick.suggestEl || !quick.illustration?.isConnected) return;
        const art = quick.illustration.getBoundingClientRect();
        for (const item of quick.suggestEl.querySelectorAll('.v2-suggest-item')) {
            const box = item.getBoundingClientRect();
            const fades = art.width > 0 && box.width > 240 && box.right > art.left + 40;
            item.classList.toggle('is-fading', fades);
            if (fades) item.style.setProperty('--suggest-fade-start', `${Math.max(100, Math.min(box.width - 80, art.left - box.left))}px`);
            else item.style.removeProperty('--suggest-fade-start');
        }
    }
    function renderQuick() {
        const composer = $('dcComposer');
        if (!composer) return;
        if (!quick.scenesEl) {
            quick.scenesEl = document.createElement('div');
            quick.scenesEl.className = 'v2-scenes';
            composer.before(quick.scenesEl);
            quick.suggestEl = document.createElement('div');
            quick.suggestEl.className = 'v2-suggest';
            let preview = null;
            const clearPreview = () => {
                if (!preview) return;
                const input = $('dcInput');
                input.placeholder = preview.placeholder;
                if (!input.value) input.style.height = preview.height;
                input.classList.remove('is-prompt-preview');preview = null;
            };
            const showPreview = event => {
                const item = event.target.closest('[data-fill]'), input = $('dcInput');
                if (!item || !input || input.value || input.disabled) return;
                clearPreview();preview = { placeholder: input.placeholder, height: input.style.height };
                input.placeholder = item.dataset.fill;input.classList.add('is-prompt-preview');
                input.style.height = 'auto';input.style.height = `${Math.min(220, input.scrollHeight)}px`;
            };
            quick.suggestEl.addEventListener('pointerover', showPreview);
            quick.suggestEl.addEventListener('focusin', showPreview);
            quick.suggestEl.addEventListener('pointerleave', clearPreview);
            quick.suggestEl.addEventListener('focusout', clearPreview);
            quick.suggestEl.addEventListener('click', clearPreview, true);
            $('dcInput')?.addEventListener('focus', clearPreview);
            $('dcInput')?.addEventListener('input', clearPreview);
            window.addEventListener('home:mode', clearPreview);
            window.addEventListener('tools:languagechange', clearPreview);

            composer.after(quick.suggestEl);
            new ResizeObserver(updateSuggestionFade).observe(quick.suggestEl);
            const mascot = document.createElement('img');
            mascot.className = 'v2-mascot';
            mascot.src = '/assets/mascot-perched.png';
            mascot.alt = '';
            mascot.setAttribute('aria-hidden', 'true');
            composer.appendChild(mascot);
            quick.scenesEl.addEventListener('click', event => {
                const chip = event.target.closest('[data-scene]');
                if (!chip) return;
                quick.scene = quick.scene === chip.dataset.scene ? '' : chip.dataset.scene;
                renderQuick();
            });
            quick.suggestEl.addEventListener('click', event => {
                const item = event.target.closest('[data-fill]');
                if (item) fillInput(item.dataset.fill);
            });
        }
        const scenes = SCENES[lang()];
        quick.scenesEl.replaceChildren(...scenes.map(([id, label]) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `v2-scene${quick.scene === id ? ' is-active' : ''}`;
            chip.dataset.scene = id;
            chip.textContent = label;
            return chip;
        }));
        const scene = scenes.find(([id]) => id === quick.scene);
        const recent = recentQuestions();
        const defaults = ['analysis', 'monthly', 'script', 'schedule'].map(id => scenes.find(scene => scene[0] === id)[2][0]);
        const items = scene ? scene[2] : (recent.length ? recent : defaults);
        const title = scene || !recent.length ? t('suggested') : t('recentAsked');
        quick.illustration ||= document.querySelector('.v2-agent-illustration');
        quick.suggestEl.innerHTML = items.length ? `<div class="v2-suggest-cap">${esc(title)}</div>${items.map(text => `<button type="button" class="v2-suggest-item" data-fill="${esc(text)}"><span>${esc(text)}</span><span class="v2-ico" data-icon="arrowUpRight"></span></button>`).join('')}` : '';
        if (items.length && quick.illustration) quick.suggestEl.appendChild(quick.illustration);
        fillIcons(quick.suggestEl);
        requestAnimationFrame(updateSuggestionFade);
        const input = $('dcInput');
        if (input) {
            input.dataset.v2Placeholder ||= input.placeholder;
            input.placeholder = scene ? scene[2][0] : input.dataset.v2Placeholder;
        }
    }
    async function loadRecentQuestions() {
        if (recentQuestions().length) return renderQuick();
        try {
            const data = await getJson('/api/ai/sessions?mine=1&pagePath=%2F&limit=40&query=');
            quick.recent = (data?.items || []).map(item => String(item.firstQuestion || item.lastQuestion || item.title || '').trim()).filter(Boolean);
        } catch { /* 没有匹配历史时使用当前语言的平台能力推荐 */ }
        renderQuick();
    }
    window.addEventListener('home:conversation-list-changed', () => { if (!quick.scene) renderQuick(); });

    // ── 主题 ──
    function setTheme(theme) {
        root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
        try { localStorage.setItem('tools_theme', theme === 'dark' ? 'dark' : 'light'); } catch { /* 无痕模式只在本次生效 */ }
    }

    function init() {
        fillIcons(document);
        try { if (window.matchMedia('(max-width: 860px)').matches || localStorage.getItem(SIDE_KEY) === 'collapsed') setSideCollapsed(true); } catch { /* 无痕模式 */ }
        applyText();
        watchNavbar();
        mirrorNavbar();
        renderModes();
        updateChannelsNavState();
        getJson('/api/channels/available').then(data => { if (data) updateChannelsNavState(data); }).catch(() => {});
        if (activeChatSource() === 'agents') window.HomeWelinkThreads?.setSource?.('mine');
        renderQuick();
        loadRecentQuestions();
        if (window.ToolsOpsInbox?.total) window.dispatchEvent(new CustomEvent('tools:ops-inbox-total', { detail: { total: window.ToolsOpsInbox.total() } }));
    }
    window.addEventListener('hashchange', () => {
        if (location.hash === '#channels') {
            const navItem = document.querySelector('.v2-nav-item[data-v2-action="channels"]');
            if (navItem?.classList.contains('is-disabled')) {
                try { history.replaceState(history.state, '', location.pathname + location.search); } catch { location.hash = ''; }
                window.HomeWelinkThreads?.setSource?.('mine');
                renderModes();
                queueGroups();
                return;
            }
            const tabs = [...document.querySelectorAll('.home-chat-tabs [data-chat-source]')].map(el => el.dataset.chatSource);
            const channel = ['welink', 'weixin'].find(id => tabs.includes(id)) || 'welink';
            window.HomeWelinkThreads?.setSource?.(channel, { openLatest: true });
        }
        renderModes();
        queueGroups();
    });
    window.addEventListener('tools:languagechange', () => {
        applyText();
        mirrorNavbar();
        renderQuick();
        if (!quick.scene) loadRecentQuestions();
        updateChannelsNavState();
        if (openPop?.pop === discover.pop) renderDiscover();
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();

    window.HomeV2 = { setTheme, closePop, fillIcons, openLinks, updateChannelsNavState };
})();
