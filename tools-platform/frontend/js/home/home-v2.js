// 首页新版界面（html[data-ui="v2"]）：左侧导航、发现应用、二级菜单、底部用户栏、主题切换。
// 只负责外框与入口，具体功能仍交给原有模块（Dragon Claw、频道会话、工具区、导航栏里的告警台 / 设置 / 租户）。
(function () {
    'use strict';
    const root = document.documentElement;
    if (root.getAttribute('data-ui') !== 'v2') return;

    const ICONS = {
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
            messages: '消息中心', scan: '扫码使用', appearance: '外观', light: '浅色', dark: '深色', version: '版本', service: '服务', checkUpdate: '检查更新',
            fullAlerts: '完整告警台', markAllRead: '全部已读', filterAll: '全部', filterUnread: '未读', filterWarn: '警告', noMessages: '暂无消息', loadFailed: '读取失败：{e}',
            view: '查看', markRead: '标为已读', today: '今天', yesterday: '昨天', scanWeixin: '微信', scanWelink: 'WeLink',
            scanHintWeixin: '用微信扫码，在微信里和 DragonClaw 对话', scanHintWelink: '用 WeLink 扫码，在 WeLink 里和 DragonClaw 对话',
            scanEmpty: '还没有配置扫码链接', scanEmptyAdmin: '填入在{name}里打开 DragonClaw 的链接，保存后生成二维码', scanPlaceholder: 'https://…', save: '保存', saving: '正在保存…', saved: '已保存', invalidLink: '请填写 http 或 https 开头的链接', editLink: '修改链接', openLink: '打开链接'
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
            messages: 'Messages', scan: 'Scan to use', appearance: 'Appearance', light: 'Light', dark: 'Dark', version: 'Version', service: 'Service', checkUpdate: 'Check for updates',
            fullAlerts: 'Full alert center', markAllRead: 'Mark all read', filterAll: 'All', filterUnread: 'Unread', filterWarn: 'Warnings', noMessages: 'No messages', loadFailed: 'Could not load: {e}',
            view: 'View', markRead: 'Mark read', today: 'Today', yesterday: 'Yesterday', scanWeixin: 'WeChat', scanWelink: 'WeLink',
            scanHintWeixin: 'Scan with WeChat to chat with DragonClaw there', scanHintWelink: 'Scan with WeLink to chat with DragonClaw there',
            scanEmpty: 'No scan link yet', scanEmptyAdmin: 'Enter the link that opens DragonClaw in {name}; a QR code is generated after saving', scanPlaceholder: 'https://…', save: 'Save', saving: 'Saving…', saved: 'Saved', invalidLink: 'Enter a link starting with http or https', editLink: 'Edit link', openLink: 'Open link'
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
    let openPop = null;
    function closePop() {
        if (!openPop) return;
        openPop.pop.classList.remove('is-open');
        openPop.anchor?.setAttribute('aria-expanded', 'false');
        openPop = null;
    }
    function showPop(pop, anchor, place) {
        if (openPop?.pop === pop) return;
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
        if (box.bottom > window.innerHeight - 8 && place !== 'up') pop.style.top = `${Math.max(8, window.innerHeight - box.height - 8)}px`;
    }
    function makePop(className = '') {
        const pop = document.createElement('div');
        pop.className = `v2-pop ${className}`.trim();
        pop.setAttribute('role', 'menu');
        document.body.appendChild(pop);
        return pop;
    }
    document.addEventListener('click', event => {
        if (!openPop) return;
        if (openPop.pop.contains(event.target) || openPop.anchor.contains(event.target)) return;
        closePop();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closePop(); });
    window.addEventListener('resize', closePop);

    const menuItem = (icon, label, action, hint = '') => `<button type="button" class="v2-pop-item" role="menuitem" data-v2-do="${action}"><span class="v2-ico" data-icon="${icon}"></span><span>${esc(label)}</span>${hint ? `<span class="v2-pop-hint">${esc(hint)}</span>` : ''}</button>`;

    // ── 主导航动作 ──
    const ACTIONS = {
        newChat() { window.HomeMode?.set('chat'); window.HomeWelinkThreads?.setSource?.('mine'); click('homeChatNew'); $('dcInput')?.focus(); },
        channels() {
            window.HomeMode?.set('chat');
            const tabs = [...document.querySelectorAll('.home-chat-tabs [data-chat-source]')].map(el => el.dataset.chatSource);
            const channel = ['welink', 'weixin'].find(id => tabs.includes(id)) || 'welink';
            window.HomeWelinkThreads?.setSource?.(channel, { openLatest: true });
        },
        schedule() { window.HomeMode?.set('chat'); window.DragonClaw?.openSchedules?.(); },
        library() { window.openToolsKnowledgeGraph?.(); },
        opsDrafts() { window.HomeMode?.set('chat'); if (location.hash !== '#ops-drafts') location.hash = '#ops-drafts'; else window.ToolsOpsInbox?.open?.(); },
        skillList() { window.HomeMode?.set('tools'); window.HomeWorkspace?.setView?.('skills'); document.querySelector('#homeCategoryNav [data-view="skills"], #homeCategoryNav [data-group="技能"]')?.click(); },
        plugins() { window.HomeMode?.set('tools'); click('homeCapsEntry'); },
        market() { click('toolMarketBtn'); },
        importTool() { click('customToolUploadBtn'); },
        compare() { click('builtinToolsCompareBtn'); },
        links() { click('homeLinksBtn'); },
        alerts() { openMessages(); },
        fullAlerts() { closeMessages(); window.openAlertCenter?.(); },
        checkUpdate() { window.openNavSettingsModal?.(); window.switchNavSettingsTab?.('update'); },
        settings() { window.openNavSettingsModal?.(); },
        language() { window.toggleAppLanguage?.(); },
        theme() { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); },
        serviceStatus() { window.openServiceStatusModal?.(); },
        requirements() { location.href = '/requirements'; },
        classic() { try { localStorage.setItem('tools_home_ui', 'v1'); } catch { /* 无痕模式 */ } location.reload(); },
        logout() { window.doLogout?.(); }
    };
    function run(action) { closePop(); ACTIONS[action]?.(); }
    document.addEventListener('click', event => {
        const el = event.target.closest('[data-v2-action], [data-v2-do]');
        if (!el) return;
        run(el.dataset.v2Action || el.dataset.v2Do);
    });

    // ── 二级菜单：技能·插件·工具 / 更多（悬停或点击展开） ──
    const flyouts = {
        skills: () => [
            menuItem('sparkles', t('skillList'), 'skillList'),
            menuItem('plug', t('plugins'), 'plugins'),
            '<div class="v2-pop-sep"></div>',
            menuItem('store', t('market'), 'market'),
            menuItem('upload', t('importTool'), 'importTool'),
            localStorage.getItem('tools_role') === 'admin' ? menuItem('compare', t('compare'), 'compare') : ''
        ].join(''),
        more: () => {
            const links = [...document.querySelectorAll('#app-navbar .nav-links a[href]')]
                .filter(a => a.getAttribute('href') !== '/' && !a.getAttribute('href').startsWith('#'))
                .map(a => `<a class="v2-pop-item" role="menuitem" href="${esc(a.getAttribute('href'))}"><span class="v2-app-icon" style="width:20px;height:20px;font-size:13px;background:none">${esc((a.querySelector('.nav-icon, .nav-link-icon')?.textContent || '').trim())}</span><span>${esc((a.querySelector('.nav-text, .nav-link-text')?.textContent || a.textContent || '').trim().replace(/^\S+\s+/, m => (/^[\p{Extended_Pictographic}️]+\s+$/u.test(m) ? '' : m)))}</span></a>`);
            return [
                links.length ? `<div class="v2-pop-cap">${esc(t('discover'))}</div>${links.join('')}<div class="v2-pop-sep"></div>` : '',
                menuItem('link', t('links'), 'links'),
                menuItem('target', t('requirements'), 'requirements')
            ].join('');
        }
    };
    const flyPop = makePop('v2-flyout');
    let hoverTimer = 0;
    function openFlyout(anchor) {
        flyPop.innerHTML = flyouts[anchor.dataset.v2Flyout]();
        fillIcons(flyPop);
        showPop(flyPop, anchor, 'right');
    }
    document.querySelectorAll('[data-v2-flyout]').forEach(anchor => {
        anchor.addEventListener('click', () => (openPop?.anchor === anchor ? closePop() : openFlyout(anchor)));
        anchor.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => openFlyout(anchor), 120); });
        anchor.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => { if (openPop?.pop === flyPop && !flyPop.matches(':hover')) closePop(); }, 220); });
    });
    flyPop.addEventListener('mouseleave', () => { hoverTimer = setTimeout(() => { if (openPop?.pop === flyPop && !openPop.anchor.matches(':hover')) closePop(); }, 220); });
    flyPop.addEventListener('mouseenter', () => clearTimeout(hoverTimer));

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
    function appIcon(icon) {
        const value = String(icon || '').trim();
        if (/^(https?:|\/|data:image)/.test(value)) return `<img src="${esc(value)}" alt="" loading="lazy">`;
        return esc(value.length <= 4 ? value : '') || '🧩';
    }
    const appRow = app => `<a class="v2-app" href="${esc(app.href)}"><span class="v2-app-icon">${appIcon(app.icon)}</span><span class="v2-app-text"><strong>${esc(app.title)}</strong><small>${esc(app.description || app.group || '')}</small></span><span class="v2-app-go">${esc(t('open'))}</span></a>`;
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
        if (!$('v2Avatar').firstChild) $('v2Avatar').innerHTML = '<img src="/assets/dragonclaw-mascot.png" alt="">';
        $('v2UserMeta').textContent = serviceText();
        $('v2StatusDot').classList.toggle('is-down', serviceDown());
    }
    const rowItem = (icon, label, action, hint = '', arrow = false) => `<button type="button" class="v2-pop-item" role="menuitem" data-v2-do="${action}"><span class="v2-ico" data-icon="${icon}"></span><span>${esc(label)}</span>${hint ? `<span class="v2-pop-hint">${esc(hint)}</span>` : ''}${arrow ? '<span class="v2-ico v2-pop-arrow" data-icon="chevronRight"></span>' : ''}</button>`;
    function renderUserMenu() {
        const name = localStorage.getItem('tools_user') || '';
        const admin = localStorage.getItem('tools_role') === 'admin';
        const dark = root.getAttribute('data-theme') === 'dark';
        const mac = /Mac/i.test(navigator.platform || '');
        userPop.innerHTML = `
            <div class="v2-account-card v2-account-head"><span class="v2-avatar v2-avatar-lg"><img src="/assets/dragonclaw-mascot.png" alt=""></span><strong>${esc(name)}</strong></div>
            <div class="v2-account-card v2-account-stats">
                <div><small>${esc(t('version'))}</small><strong>${esc(versionText() || '—')}</strong>${admin ? `<button type="button" class="v2-account-btn is-primary" data-v2-do="checkUpdate">${esc(t('checkUpdate'))}</button>` : ''}</div>
                <div><small>${esc(t('service'))}</small><strong class="v2-account-service"><span class="v2-status-dot${serviceDown() ? ' is-down' : ''}"></span>${esc(serviceText())}</strong><button type="button" class="v2-account-btn" data-v2-do="serviceStatus">${esc(t('serviceStatus'))}</button></div>
            </div>
            <div class="v2-account-card v2-account-list">
                ${admin ? rowItem('settings', t('settings'), 'settings', mac ? '⌘,' : 'Ctrl+,') : ''}
                ${rowItem('palette', t('appearance'), 'theme', dark ? t('dark') : t('light'), true)}
                ${rowItem('language', t('language'), 'language')}
                ${rowItem('target', t('requirements'), 'requirements')}
                ${rowItem('compare', t('classic'), 'classic')}
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
    userPop.addEventListener('click', event => { if (event.target.closest('[data-v2-do="theme"]')) setTimeout(() => { renderUserMenu(); userPop.classList.add('is-open'); openPop = { pop: userPop, anchor: $('v2UserBtn') }; }, 0); });
    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key === ',' && localStorage.getItem('tools_role') === 'admin') { event.preventDefault(); run('settings'); }
    });
    $('v2AlertBtn')?.addEventListener('click', () => run('alerts'));

    // ── 扫码使用：微信 / WeLink 链接生成二维码（链接存在导航设置 scanLinks 里，管理员可直接填写） ──
    const scan = { pop: makePop('v2-scan'), tab: 'weixin', editing: false, status: '' };
    scan.pop.setAttribute('role', 'dialog');
    const navSettings = () => (typeof navState !== 'undefined' ? navState.settings : null);
    const scanLinks = () => scan.links || navSettings()?.scanLinks || {};
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
    async function loadScanLinks() {
        try {
            const res = await fetch('/api/nav-settings', { headers: typeof getAuthHeaderForNav === 'function' ? getAuthHeaderForNav() : {} });
            if (res.ok) scan.links = (await res.json()).scanLinks || {};
        } catch { /* 读取失败时按未配置显示 */ }
    }
    function renderScan() {
        const admin = localStorage.getItem('tools_role') === 'admin';
        const name = scan.tab === 'weixin' ? t('scanWeixin') : t('scanWelink');
        const link = scanLinks()[scan.tab] || '';
        let body;
        if (link && !scan.editing) {
            const svgCode = window.ToolsQrCode ? window.ToolsQrCode.toSvg(link, { scale: 5, border: 2 }) : '';
            body = `<p class="v2-scan-hint">${esc(scan.tab === 'weixin' ? t('scanHintWeixin') : t('scanHintWelink'))}</p>
                <div class="v2-scan-qr">${svgCode || '<span class="v2-scan-loading"></span>'}</div>
                <div class="v2-scan-actions"><a class="v2-pop-item" href="${esc(link)}" target="_blank" rel="noopener"><span class="v2-ico" data-icon="external"></span>${esc(t('openLink'))}</a>${admin ? `<button type="button" class="v2-pop-item" data-scan-edit>${esc(t('editLink'))}</button>` : ''}</div>`;
        } else if (admin) {
            body = `<p class="v2-scan-hint">${esc(link ? t('editLink') : t('scanEmptyAdmin', { name }))}</p>
                <form class="v2-scan-form" data-scan-form><input type="url" value="${esc(link)}" placeholder="${esc(t('scanPlaceholder'))}" required><button type="submit" class="v2-account-btn is-primary">${esc(t('save'))}</button></form>
                <p class="v2-scan-status">${esc(scan.status)}</p>`;
        } else body = `<div class="v2-discover-empty">${esc(t('scanEmpty'))}</div>`;
        scan.pop.innerHTML = `<div class="v2-seg v2-scan-tabs" role="tablist">${['weixin', 'welink'].map(id => `<button type="button" role="tab" aria-selected="${scan.tab === id}" data-scan-tab="${id}">${esc(id === 'weixin' ? t('scanWeixin') : t('scanWelink'))}</button>`).join('')}</div>${body}`;
        fillIcons(scan.pop);
    }
    scan.pop.addEventListener('click', event => {
        const tab = event.target.closest('[data-scan-tab]');
        if (tab) { scan.tab = tab.dataset.scanTab; scan.editing = false; scan.status = ''; renderScan(); return; }
        if (event.target.closest('[data-scan-edit]')) { scan.editing = true; renderScan(); scan.pop.querySelector('input')?.focus(); }
    });
    scan.pop.addEventListener('submit', async event => {
        if (!event.target.matches('[data-scan-form]')) return;
        event.preventDefault();
        const value = event.target.querySelector('input').value.trim();
        if (!/^https?:\/\//i.test(value)) { scan.status = t('invalidLink'); renderScan(); return; }
        scan.status = t('saving'); renderScan();
        try {
            const headers = { 'Content-Type': 'application/json', ...(typeof getAuthHeaderForNav === 'function' ? getAuthHeaderForNav() : {}) };
            // 导航设置整份保存：先取当前设置，只改扫码链接
            const current = await (await fetch('/api/nav-settings', { headers, cache: 'no-store' })).json();
            const next = { ...current, scanLinks: { ...(current.scanLinks || {}), [scan.tab]: value } };
            const res = await fetch('/api/nav-settings', { method: 'PUT', headers, body: JSON.stringify(next) });
            const saved = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(saved.error || `HTTP ${res.status}`);
            scan.links = saved.scanLinks || next.scanLinks;
            if (navSettings()) navSettings().scanLinks = scan.links;
            scan.editing = false; scan.status = '';
        } catch (error) { scan.status = t('loadFailed', { e: error.message }); }
        renderScan();
    });
    $('v2ScanBtn')?.addEventListener('click', async event => {
        const anchor = event.currentTarget;
        if (openPop?.pop === scan.pop) return closePop();
        scan.editing = false; scan.status = '';
        renderScan();
        showPop(scan.pop, anchor, 'up');
        await Promise.all([ensureQrLib().catch(() => {}), scan.links ? null : loadScanLinks()]);
        if (openPop?.pop === scan.pop) renderScan();
    });

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
                if (event.target.closest('[data-msg-full]')) return run('fullAlerts');
                const read = event.target.closest('[data-msg-read]');
                if (read) {
                    const id = read.closest('[data-id]')?.dataset.id;
                    if (id) fetch('/api/alert-center/events/read', { method: 'PUT', headers: msgHeaders(true), body: JSON.stringify({ ids: [id] }) }).then(() => window.refreshAlertCenterBadge?.()).catch(() => {});
                    if (read.tagName === 'BUTTON') { read.closest('.v2-msg')?.classList.remove('is-unread'); read.remove(); }
                }
            });
        }
        msg.el.innerHTML = `<header><span></span><h2>${esc(t('messages'))}</h2><button type="button" class="v2-icon-btn" data-msg-close aria-label="×"><span class="v2-ico" data-icon="close"></span></button></header>
            <div class="v2-msg-toolbar"><div class="v2-seg">${[['all', t('filterAll')], ['unread', t('filterUnread')], ['warn', t('filterWarn')]].map(([id, label]) => `<button type="button" role="tab" data-msg-filter="${id}" aria-selected="${msg.filter === id}">${esc(label)}</button>`).join('')}</div><span></span><button type="button" class="v2-account-btn" data-msg-all>${esc(t('markAllRead'))}</button><button type="button" class="v2-account-btn" data-msg-full>${esc(t('fullAlerts'))}</button></div>
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
    // 导航栏会整体重绘（语言、租户切换后），重绘后重新挂监听
    new MutationObserver(watchNavbar).observe(document.body, { childList: true });

    window.addEventListener('tools:ops-inbox-total', event => {
        const total = Number(event.detail?.total) || 0;
        $('v2OpsCount').hidden = !total;
        $('v2OpsCount').textContent = total > 99 ? '99+' : String(total);
    });

    // ── 模式切换（对话 / 工具） ──
    function renderModes() {
        const mode = window.HomeMode?.get?.() || (document.body.classList.contains('home-mode-tools') ? 'tools' : 'chat');
        document.querySelectorAll('[data-v2-modes]').forEach(seg => {
            seg.innerHTML = [['chat', 'chat', t('modeChat')], ['tools', 'tools', t('modeTools')]]
                .map(([id, icon, label]) => `<button type="button" role="tab" aria-selected="${mode === id}" data-v2-mode="${id}"><span class="v2-ico" data-icon="${icon}"></span>${esc(label)}</button>`).join('');
            fillIcons(seg);
        });
        document.querySelectorAll('.v2-nav-item[data-v2-action="newChat"]').forEach(el => el.classList.toggle('is-active', mode === 'chat'));
    }
    document.addEventListener('click', event => {
        const btn = event.target.closest('[data-v2-mode]');
        if (btn) window.HomeMode?.set(btn.dataset.v2Mode);
    });
    window.addEventListener('home:mode', () => { renderModes(); closeMessages(); });

    // ── 侧边栏收起 ──
    const SIDE_KEY = 'tools_v2_side';
    function setSideCollapsed(collapsed) {
        document.body.classList.toggle('v2-side-collapsed', collapsed);
        try { localStorage.setItem(SIDE_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* 无痕模式 */ }
        const toggle = $('v2SideToggle');
        if (toggle) { toggle.title = t(collapsed ? 'expand' : 'collapse'); toggle.setAttribute('aria-label', toggle.title); }
    }
    const sideExpand = document.createElement('button');
    sideExpand.type = 'button';
    sideExpand.className = 'v2-icon-btn v2-side-expand';
    sideExpand.innerHTML = '<span class="v2-ico" data-icon="sidebar"></span>';
    sideExpand.addEventListener('click', () => setSideCollapsed(false));
    document.body.appendChild(sideExpand);
    $('v2SideToggle')?.addEventListener('click', () => setSideCollapsed(true));

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
            <div class="v2-pop-sep"></div><button type="button" class="v2-pop-item v2-pop-reset" data-filter-reset${filter.status === 'all' && filter.time === 'all' ? ' disabled' : ''}>${esc(t('filterReset'))}</button>`;
        fillIcons(sortPop);
        $('v2SortBtn')?.classList.toggle('is-on', filter.status !== 'all' || filter.time !== 'all');
    }
    sortPop.addEventListener('click', event => {
        const status = event.target.closest('[data-filter-status]');
        const time = event.target.closest('[data-filter-time]');
        if (status) window.HomeConversationList?.setFilter?.({ status: status.dataset.filterStatus });
        else if (time) window.HomeConversationList?.setFilter?.({ time: time.dataset.filterTime });
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

    // ── 对话分类：侧栏里可折叠的分组（对话 / 微信 / WeLink / 每家桌面 Agent），同一时间展开一组 ──
    // 分组头只负责切换来源（沿用 HomeWelinkThreads.setSource 与桌面 Agent 的厂商按钮），列表本身仍由原模块渲染，
    // 通过 CSS order 排到展开的分组头下面。
    const AGENT_NAMES = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity' };
    const groups = { bound: false, agentProviders: null, collapsed: false };
    const chatView = () => document.querySelector('.home-panel-view[data-home-panel="chat"]');
    const activeChatSource = () => document.querySelector('.home-chat-tabs [data-chat-source].is-active')?.dataset.chatSource || 'mine';
    const activeProvider = () => document.querySelector('.desktop-agent-provider[aria-pressed="true"]')?.dataset.desktopProvider || '';
    function groupList() {
        const sources = [...document.querySelectorAll('.home-chat-tabs [data-chat-source]')].map(btn => btn.dataset.chatSource);
        const list = [{ id: 'mine', label: t('modeChat') }];
        for (const id of ['weixin', 'welink']) if (sources.includes(id)) list.push({ id, label: id === 'weixin' ? t('scanWeixin') : 'WeLink' });
        if (sources.includes('agents')) for (const provider of groups.agentProviders || []) list.push({ id: `agents:${provider}`, label: AGENT_NAMES[provider] || provider });
        return list;
    }
    function activeGroupId() {
        const source = activeChatSource();
        return source === 'agents' ? `agents:${activeProvider() || (groups.agentProviders || [])[0] || ''}` : source;
    }
    function visibleCount() {
        const source = activeChatSource();
        const scope = source === 'agents' ? document.querySelector('.desktop-agent-list') : $('homeChatList');
        return scope ? scope.querySelectorAll(source === 'agents' ? '[data-desktop-session]' : '.home-chat-item').length : 0;
    }
    // 对话顶栏标题：显示当前打开的对话（侧栏里高亮的那一条），没有时显示 Dragon Claw
    function renderChatTitle() {
        const name = document.querySelector('.dc-chat-head .dc-chat-name');
        if (!name) return;
        const active = document.querySelector('#homeChatList .home-chat-item.is-active .home-chat-title, .desktop-agent-list .is-active [class*="title"], #homeChatList .is-active [class*="title"]');
        const title = active?.textContent.trim() || 'Dragon Claw';
        if (name.textContent !== title) name.textContent = title;
    }
    function renderGroups() {
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
        view.classList.toggle('v2-groups-collapsed', groups.collapsed);
        // 分组头按顺序占 order 10、30、50…；展开分组的工具栏和列表排在它后面（order +10）
        list.forEach((group, index) => {
            const isActive = group.id === active;
            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'v2-group-head';
            head.dataset.group = group.id;
            head.style.order = String(10 + index * 20);
            head.setAttribute('aria-expanded', String(isActive && !groups.collapsed));
            head.innerHTML = `<span>${esc(group.label)}</span>${isActive && !groups.collapsed ? `<small>(${visibleCount()})</small>` : ''}<span class="v2-ico v2-group-chev" data-icon="chevron"></span>`;
            view.appendChild(head);
            if (isActive) view.style.setProperty('--v2-active-order', String(20 + index * 20));
        });
        fillIcons(view);
    }
    // 旧的分组头在 renderGroups 里重建：先清掉上一轮的
    function clearHeads() { chatView()?.querySelectorAll(':scope > .v2-group-head').forEach(el => el.remove()); }
    function toggleGroup(id) {
        if (id === activeGroupId()) { groups.collapsed = !groups.collapsed; clearHeads(); renderGroups(); return; }
        groups.collapsed = false;
        window.HomeMode?.set('chat');
        if (id.startsWith('agents:')) {
            const provider = id.slice(7);
            if (activeChatSource() !== 'agents') window.HomeWelinkThreads?.setSource?.('agents');
            setTimeout(() => document.querySelector(`.desktop-agent-provider[data-desktop-provider="${provider}"]`)?.click(), 0);
        } else window.HomeWelinkThreads?.setSource?.(id);
        setTimeout(() => { clearHeads(); renderGroups(); }, 30);
    }
    async function loadAgentProviders() {
        try {
            const data = await getJson('/api/desktop-agents/settings');
            const providers = data?.settings?.enabled ? Object.entries(data.settings.providers || {}).filter(([, on]) => on).map(([id]) => id) : [];
            groups.agentProviders = providers.filter(id => AGENT_NAMES[id]);
        } catch { groups.agentProviders = []; }
        clearHeads(); renderGroups();
    }
    let groupsQueued = false;
    function queueGroups() {
        if (groupsQueued) return;
        groupsQueued = true;
        requestAnimationFrame(() => { groupsQueued = false; clearHeads(); renderGroups(); });
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
    const quick = { scene: '', scenesEl: null, suggestEl: null, recent: [] };
    function fillInput(text) {
        const input = $('dcInput');
        if (!input) return;
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        input.setSelectionRange(text.length, text.length);
    }
    function recentQuestions() {
        const titles = [...document.querySelectorAll('#homeChatList .home-chat-owned .home-chat-title')].map(el => el.textContent.trim());
        const list = titles.length ? titles : quick.recent;
        return [...new Set(list.filter(title => title.length >= 4 && !/^@/.test(title)))].slice(0, 4);
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
            composer.after(quick.suggestEl);
            const mascot = document.createElement('img');
            mascot.className = 'v2-mascot';
            mascot.src = '/assets/dragonclaw-mascot.png';
            mascot.alt = '';
            mascot.setAttribute('aria-hidden', 'true');
            quick.scenesEl.appendChild(mascot);
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
        const mascot = quick.scenesEl.querySelector('.v2-mascot');
        quick.scenesEl.replaceChildren(...scenes.map(([id, label]) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `v2-scene${quick.scene === id ? ' is-active' : ''}`;
            chip.dataset.scene = id;
            chip.textContent = label;
            return chip;
        }), mascot);
        const scene = scenes.find(([id]) => id === quick.scene);
        const items = scene ? scene[2] : recentQuestions();
        const title = scene ? t('suggested') : t('recentAsked');
        quick.suggestEl.innerHTML = items.length ? `<div class="v2-suggest-cap">${esc(title)}</div>${items.map(text => `<button type="button" class="v2-suggest-item" data-fill="${esc(text)}"><span>${esc(text)}</span><span class="v2-ico" data-icon="arrowUpRight"></span></button>`).join('')}` : '';
        fillIcons(quick.suggestEl);
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
            quick.recent = (data?.items || []).map(item => String(item.title || '').trim()).filter(Boolean);
        } catch { /* 没有历史时只显示场景标签 */ }
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
        try { if (localStorage.getItem(SIDE_KEY) === 'collapsed') setSideCollapsed(true); } catch { /* 无痕模式 */ }
        applyText();
        watchNavbar();
        mirrorNavbar();
        loadAgentProviders();
        renderQuick();
        loadRecentQuestions();
        if (window.ToolsOpsInbox?.total) window.dispatchEvent(new CustomEvent('tools:ops-inbox-total', { detail: { total: window.ToolsOpsInbox.total() } }));
    }
    window.addEventListener('tools:languagechange', () => { applyText(); mirrorNavbar(); renderQuick(); if (openPop?.pop === discover.pop) renderDiscover(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();

    window.HomeV2 = { setTheme, closePop };
})();
