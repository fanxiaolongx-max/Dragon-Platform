// 首页两种互斥模式：对话（Dragon Claw + 历史对话 + 右侧工作区）与工具（分类 + 卡片网格）。
// 左侧图标栏切换模式；同一图标再点一次收起/展开侧栏面板；友情链接以弹层展示。
// 模式写在地址栏（#tools），刷新后保持；body 上的 home-mode-chat / home-mode-tools 决定各区块显隐。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            chat: '对话', tools: '工具', links: '链接', history: '历史', chatTitle: '对话', toolsTitle: '工具', newChat: '新对话',
            chatSearch: '搜索对话', collapse: '收起侧栏', expand: '展开侧栏', linksTitle: '友情链接'
        },
        'en-US': {
            chat: 'Chats', tools: 'Tools', links: 'Links', history: 'History', chatTitle: 'Chats', toolsTitle: 'Tools', newChat: 'New chat',
            chatSearch: 'Search chats', collapse: 'Collapse sidebar', expand: 'Expand sidebar', linksTitle: 'Links'
        }
    };
    const MODES = ['chat', 'tools'];
    const SIDEBAR_KEY = 'home_sidebar_mode';
    const AUTO_COLLAPSE = 1280; // 窄于此宽度默认只显示图标栏
    const WORKSPACE_COLLAPSE = 1600; // 右侧工作区打开且窄于此宽度时，左侧自动收成图标栏
    const MOBILE = 860;

    const el = {};
    let mode = 'chat';
    // 工作区打开期间用户手动展开/收起的选择；工作区开关变化时清空，回到自动规则
    let workspaceOverride = null;
    let lastWorkspaceOpen = false;

    function lang() {
        return window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN';
    }

    function tx(key) {
        return TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
    }

    function modeFromHash() {
        return location.hash === '#tools' ? 'tools' : 'chat';
    }

    function isMobile() {
        return window.innerWidth <= MOBILE;
    }

    function workspaceOpen() {
        return mode === 'chat' && document.body.classList.contains('dc-workspace-open');
    }

    function storedSidebarMode() {
        try { return localStorage.getItem(SIDEBAR_KEY); } catch { return null; }
    }

    function isCollapsed() {
        return document.body.classList.contains('home-sidebar-collapsed');
    }

    function applySidebarMode() {
        let collapsed = false;
        if (!isMobile()) {
            const stored = storedSidebarMode();
            collapsed = stored ? stored === 'collapsed' : window.innerWidth < AUTO_COLLAPSE;
            if (workspaceOpen() && window.innerWidth < WORKSPACE_COLLAPSE) collapsed = workspaceOverride ?? true;
            else if (workspaceOpen() && workspaceOverride !== null) collapsed = workspaceOverride;
        }
        document.body.classList.toggle('home-sidebar-collapsed', collapsed);
        el.toggles.forEach(button => {
            const label = tx(collapsed ? 'expand' : 'collapse');
            button.setAttribute('aria-expanded', String(!collapsed));
            button.setAttribute('aria-label', label);
            button.title = label;
        });
    }

    function setCollapsed(collapsed) {
        if (workspaceOpen()) workspaceOverride = collapsed;
        else {
            try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* 无痕模式下仅本次生效 */ }
        }
        applySidebarMode();
    }

    function setMode(next, { updateHash = true, focus = false } = {}) {
        if (!MODES.includes(next)) next = 'chat';
        if (!document.getElementById('dragonClaw')) next = 'tools'; // 没有智能体区域时只有工具
        const changed = next !== mode || !document.body.classList.contains(`home-mode-${next}`);
        mode = next;
        document.body.classList.toggle('home-mode-chat', mode === 'chat');
        document.body.classList.toggle('home-mode-tools', mode === 'tools');
        el.modeButtons.forEach(button => {
            const active = button.dataset.homeMode === mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        el.panels.forEach(panel => { panel.hidden = panel.dataset.homePanel !== mode; });
        if (updateHash) {
            const url = `${location.pathname}${location.search}${mode === 'tools' ? '#tools' : ''}`;
            if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
        }
        applySidebarMode();
        if (changed) {
            window.scrollTo({ top: 0, behavior: 'auto' });
            window.dispatchEvent(new CustomEvent('home:mode', { detail: { mode } }));
        }
        if (focus) {
            const target = mode === 'tools' ? document.getElementById('homeToolSearch') : document.getElementById('dcInput');
            target?.focus({ preventScroll: true });
        }
    }

    // ── 友情链接弹层 ──
    function linksOpen() {
        return Boolean(el.linksPop && !el.linksPop.hidden);
    }

    function positionLinks() {
        if (!linksOpen() || isMobile()) {
            el.linksPop?.style.removeProperty('left');
            el.linksPop?.style.removeProperty('top');
            return;
        }
        const anchor = el.linksBtn.getBoundingClientRect();
        const rail = el.rail.getBoundingClientRect();
        const pop = el.linksPop.getBoundingClientRect();
        const top = Math.max(12, Math.min(anchor.bottom - pop.height, window.innerHeight - pop.height - 12));
        el.linksPop.style.left = `${Math.round(rail.right + 10)}px`;
        el.linksPop.style.top = `${Math.round(top)}px`;
    }

    function toggleLinks(open = !linksOpen()) {
        if (!el.linksPop) return;
        el.linksPop.hidden = !open;
        el.linksBtn.setAttribute('aria-expanded', String(open));
        el.linksBtn.classList.toggle('is-open', open);
        if (open) {
            positionLinks();
            el.linksPop.querySelector('.friend-link:not([hidden])')?.focus({ preventScroll: true });
        }
    }

    function applyTexts() {
        document.querySelectorAll('[data-home-mode-i18n]').forEach(node => {
            node.textContent = tx(node.dataset.homeModeI18n);
        });
        el.modeButtons.forEach(button => { button.title = tx(button.dataset.homeMode); });
        if (el.linksBtn) el.linksBtn.title = tx('linksTitle');
        const chatSearch = document.getElementById('homeChatSearch');
        if (chatSearch) chatSearch.placeholder = tx('chatSearch');
        applySidebarMode();
    }

    function bindEvents() {
        el.modeButtons.forEach(button => button.addEventListener('click', () => {
            toggleLinks(false);
            const next = button.dataset.homeMode;
            // 点当前模式的图标：收起/展开侧栏面板
            if (next === mode && !isMobile()) return setCollapsed(!isCollapsed());
            setMode(next, { focus: next === 'tools' && !isCollapsed() });
        }));
        el.toggles.forEach(button => button.addEventListener('click', () => setCollapsed(!isCollapsed())));

        el.linksBtn?.addEventListener('click', event => {
            event.stopPropagation();
            toggleLinks();
        });
        document.addEventListener('pointerdown', event => {
            if (linksOpen() && !el.linksPop.contains(event.target) && !el.linksBtn.contains(event.target)) toggleLinks(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && linksOpen()) {
                toggleLinks(false);
                el.linksBtn.focus();
            }
        });

        // 旧入口（对话头部「浏览工具」、侧栏 Dragon Claw 等）沿用的事件
        window.addEventListener('home:show-tools', () => setMode('tools'));
        window.addEventListener('home:show-agent', () => setMode('chat'));
        window.addEventListener('hashchange', () => setMode(modeFromHash(), { updateHash: false }));
        window.addEventListener('tools:languagechange', applyTexts);

        let raf = 0;
        window.addEventListener('resize', () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                applySidebarMode();
                positionLinks();
            });
        }, { passive: true });

        // 右侧工作区开关（workspace-panel.js 切换 body.dc-workspace-open）
        new MutationObserver(() => {
            const open = document.body.classList.contains('dc-workspace-open');
            if (open === lastWorkspaceOpen) return;
            lastWorkspaceOpen = open;
            workspaceOverride = null;
            applySidebarMode();
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    function init() {
        el.sidebar = document.getElementById('homeSidebar');
        if (!el.sidebar) return;
        el.rail = el.sidebar.querySelector('.home-rail');
        el.modeButtons = [...el.sidebar.querySelectorAll('[data-home-mode]')];
        el.panels = [...el.sidebar.querySelectorAll('[data-home-panel]')];
        el.toggles = [...el.sidebar.querySelectorAll('.home-sidebar-toggle')];
        el.linksBtn = document.getElementById('homeLinksBtn');
        el.linksPop = document.getElementById('homeLinksPop');
        // 侧栏带 backdrop-filter，会成为 fixed 子元素的定位容器；弹层挂到 body 下才能贴着图标栏定位
        if (el.linksPop && el.linksPop.parentElement !== document.body) document.body.appendChild(el.linksPop);
        lastWorkspaceOpen = document.body.classList.contains('dc-workspace-open');
        bindEvents();
        applyTexts();
        setMode(modeFromHash(), { updateHash: false });
    }

    window.HomeMode = {
        get: () => mode,
        set: (next, options) => setMode(next, options)
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
