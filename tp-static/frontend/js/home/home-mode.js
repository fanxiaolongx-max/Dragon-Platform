// 首页两种互斥模式：对话（Dragon Claw + 历史对话 + 右侧工作区）与工具（分类 + 卡片网格）。
// 首页外框由 home-shell.js 负责；本模块协调工具中心、会话模式及侧栏宽度。
// 模式写在地址栏（#tools），刷新后保持；body 上的 home-mode-chat / home-mode-tools 决定各区块显隐。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            chat: '对话', tools: '工具', links: '链接', history: '历史', chatTitle: '对话', toolsTitle: '工具', newChat: '新对话',
            chatSearch: '搜索对话', collapse: '收起侧栏', expand: '展开侧栏', linksTitle: '友情链接',
            resize: '调整侧栏宽度', resizeHint: '拖动或按左右方向键调整宽度，双击或按 Enter 恢复默认'
        },
        'en-US': {
            chat: 'Chats', tools: 'Tools', links: 'Links', history: 'History', chatTitle: 'Chats', toolsTitle: 'Tools', newChat: 'New chat',
            chatSearch: 'Search chats', collapse: 'Collapse sidebar', expand: 'Expand sidebar', linksTitle: 'Links',
            resize: 'Resize sidebar', resizeHint: 'Drag or use arrow keys to resize; double-click or press Enter to reset'
        }
    };
    const MODES = ['chat', 'tools'];
    const MOBILE = 860;
    const WIDTH_KEY = 'home_sidebar_width';
    const MIN_WIDTH = 208;
    const MAX_WIDTH = 560;

    const el = {};
    let mode = 'chat';
    // 工作区打开期间用户手动展开/收起的选择；工作区开关变化时清空，回到自动规则
    let lastWorkspaceOpen = false;
    let widthScope = '';
    let widths = {};
    let drag = null;

    function preferenceScope() {
        try { return `${encodeURIComponent(localStorage.getItem('tools_tenant_id') || 'default')}:${encodeURIComponent(localStorage.getItem('tools_user') || 'local')}`; }
        catch { return 'local'; }
    }

    function loadWidths() {
        const scope = preferenceScope();
        if (scope === widthScope) return;
        widthScope = scope;
        widths = {};
        for (const name of MODES) {
            try {
                const value = Number(localStorage.getItem(`${WIDTH_KEY}:${scope}:${name}`));
                if (Number.isFinite(value) && value >= MIN_WIDTH && value <= MAX_WIDTH) widths[name] = value;
            } catch { /* Keep defaults when browser storage is unavailable. */ }
        }
    }

    function widthBounds() {
        const css = getComputedStyle(el.layout);
        const available = el.layout.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
        const gap = parseFloat(css.columnGap) || 0;
        const right = workspaceOpen() ? (document.getElementById('dcWorkspacePanel')?.getBoundingClientRect().width || 320) : 0;
        const maximum = Math.floor(Math.min(MAX_WIDTH, available * 0.48, available - right - gap * (right ? 2 : 1) - 360));
        return { min: MIN_WIDTH, max: Math.max(MIN_WIDTH, maximum) };
    }

    function applySidebarWidth() {
        loadWidths();
        const bounds = widthBounds();
        el.layout.style.setProperty('--ws-side-max', `${bounds.max}px`);
        if (widths[mode] !== undefined) el.layout.style.setProperty('--ws-side-preferred', `${widths[mode]}px`);
        else el.layout.style.removeProperty('--ws-side-preferred');
        document.documentElement.style.setProperty('--v2-side-width', `${Math.max(bounds.min,Math.min(bounds.max,widths[mode] || 240))}px`);
        if (el.resizer) {
            el.resizer.hidden = isMobile() || (document.body.classList.contains('v2-side-collapsed'));
            el.resizer.setAttribute('aria-valuemin', String(bounds.min));
            el.resizer.setAttribute('aria-valuemax', String(bounds.max));
            if (!el.resizer.hidden) el.resizer.setAttribute('aria-valuenow', String(Math.round(el.sidebar.getBoundingClientRect().width)));
        }
        window.dispatchEvent(new Event('dragon-claw:sidebar-layout'));
    }

    function saveWidth() {
        try {
            const key = `${WIDTH_KEY}:${widthScope}:${mode}`;
            if (widths[mode] === undefined) localStorage.removeItem(key);
            else localStorage.setItem(key, String(widths[mode]));
        } catch { /* Retain the preference for this page when storage is full or disabled. */ }
    }

    function changeWidth(value, persist = false) {
        loadWidths();
        const bounds = widthBounds();
        widths[mode] = Math.round(Math.max(bounds.min, Math.min(bounds.max, value)));
        applySidebarWidth();
        if (persist) saveWidth();
    }

    function finishResize(persist) {
        if (!drag) return;
        const previous = drag;
        drag = null;
        document.body.classList.remove('home-sidebar-resizing');
        if (el.resizer.hasPointerCapture(previous.pointerId)) el.resizer.releasePointerCapture(previous.pointerId);
        if (previous.scope === preferenceScope() && previous.mode === mode) {
            if (persist) saveWidth();
            else widths[mode] = previous.preferred;
        }
        applySidebarWidth();
    }

    function bindSidebarResize() {
        if (!el.resizer) return;
        const reset = () => {
            finishResize(false);
            loadWidths();
            widths[mode] = undefined;
            saveWidth();
            applySidebarWidth();
        };
        el.resizer.addEventListener('pointerdown', event => {
            if (drag || event.button !== 0 || !event.isPrimary || isMobile() || (document.body.classList.contains('v2-side-collapsed'))) return;
            event.preventDefault();
            loadWidths();
            drag = { pointerId: event.pointerId, x: event.clientX, width: el.sidebar.getBoundingClientRect().width, preferred: widths[mode], mode, scope: widthScope };
            el.resizer.focus({ preventScroll: true });
            el.resizer.setPointerCapture(event.pointerId);
            document.body.classList.add('home-sidebar-resizing');
        });
        el.resizer.addEventListener('pointermove', event => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            if (drag.scope !== preferenceScope()) return finishResize(false);
            changeWidth(drag.width + event.clientX - drag.x);
        });
        el.resizer.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finishResize(true); });
        el.resizer.addEventListener('pointercancel', () => finishResize(false));
        el.resizer.addEventListener('lostpointercapture', () => finishResize(false));
        el.resizer.addEventListener('dblclick', reset);
        el.resizer.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); reset(); return; }
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const bounds = widthBounds();
            const width = el.sidebar.getBoundingClientRect().width;
            changeWidth(event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 40 : 16), true);
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') finishResize(false); });
        window.addEventListener('blur', () => finishResize(false));
        window.addEventListener('storage', event => {
            if (event.key === null || event.key === 'tools_user' || event.key === 'tools_tenant_id' || event.key.startsWith(`${WIDTH_KEY}:`)) {
                finishResize(false);
                widthScope = '';
                applySidebarWidth();
            }
        });
    }

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

    function applySidebarMode() {
        if (isMobile() || document.body.classList.contains('v2-side-collapsed')) finishResize(false);
        applySidebarWidth();
    }

    let hubToolsRequest = 0;
    function openHubTools() {
        const version = ++hubToolsRequest;
        const open = () => { if (version === hubToolsRequest) window.HomeSkillHub?.open?.('tools'); };
        if (document.getElementById('v2SkillHub')) open();
        else window.addEventListener('home:skill-hub-ready', open, { once: true });
    }

    function setMode(next, { updateHash = true, focus = false } = {}) {
        finishResize(false);
        if (!MODES.includes(next)) next = 'chat';
        if (!document.getElementById('dragonClaw')) next = 'tools'; // 没有智能体区域时只有工具
        const hubTools = next === 'tools' && Boolean(document.getElementById('dragonClaw'));
        // 工具中心复用主区，侧栏继续保留对话列表。
        if (hubTools) next = 'chat';
        else { ++hubToolsRequest; window.HomeSkillHub?.close?.(); }
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
            const url = `${location.pathname}${location.search}${hubTools || mode === 'tools' ? '#tools' : ''}`;
            if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
        }
        applySidebarMode();
        if (changed) {
            window.scrollTo({ top: 0, behavior: 'auto' });
            window.dispatchEvent(new CustomEvent('home:mode', { detail: { mode } }));
        }
        if (hubTools) openHubTools();
        if (focus) {
            const target = hubTools ? document.querySelector('#v2SkillHub .v2-hub-search input') : mode === 'tools' ? document.getElementById('homeToolSearch') : document.getElementById('dcInput');
            target?.focus({ preventScroll: true });
        }
    }

    // ── 友情链接弹层 ──
    function linksOpen() {
        return Boolean(el.linksPop && !el.linksPop.hidden);
    }

    function applyTexts() {
        document.querySelectorAll('[data-home-mode-i18n]').forEach(node => {
            node.textContent = tx(node.dataset.homeModeI18n);
        });
        el.modeButtons.forEach(button => { button.title = tx(button.dataset.homeMode); });
        const chatSearch = document.getElementById('homeChatSearch');
        if (chatSearch) chatSearch.placeholder = tx('chatSearch');
        if (el.resizer) {
            el.resizer.setAttribute('aria-label', tx('resize'));
            el.resizer.title = tx('resizeHint');
        }
        applySidebarMode();
    }

    function bindEvents() {
        bindSidebarResize();
        window.addEventListener('home:show-tools', () => setMode('tools'));
        window.addEventListener('home:show-agent', () => setMode('chat'));
        window.addEventListener('hashchange', () => setMode(modeFromHash(), { updateHash: false }));
        window.addEventListener('tools:languagechange', applyTexts);

        let raf = 0;
        window.addEventListener('resize', () => {
            finishResize(false);
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                applySidebarMode();
            });
        }, { passive: true });

        // 右侧工作区开关（workspace-panel.js 切换 body.dc-workspace-open）
        new MutationObserver(() => {
            const open = document.body.classList.contains('dc-workspace-open');
            if (open === lastWorkspaceOpen) return;
            lastWorkspaceOpen = open;
            applySidebarMode();
        }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    function init() {
        el.sidebar = document.getElementById('homeSidebar');
        if (!el.sidebar) return;
        el.layout = el.sidebar.closest('.home-workspace');
        el.resizer = document.getElementById('homeSidebarResizer');
        el.modeButtons = [...el.sidebar.querySelectorAll('[data-home-mode]')];
        el.panels = [...el.sidebar.querySelectorAll('[data-home-panel]')];
        el.toggles = [...el.sidebar.querySelectorAll('.home-sidebar-toggle')];
        el.linksPop = document.getElementById('homeLinksPop');
        // 侧栏带 backdrop-filter，会成为 fixed 子元素的定位容器；弹层挂到 body 下才能贴着图标栏定位
        if (el.linksPop && el.linksPop.parentElement !== document.body) document.body.appendChild(el.linksPop);
        lastWorkspaceOpen = document.body.classList.contains('dc-workspace-open');
        bindEvents();
        applyTexts();
        setMode(modeFromHash(), { updateHash: false });
        // 首帧沿用 index.html 里预先恢复的状态，期间关闭过渡；两帧后恢复正常动画
        requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('home-booting')));
    }

    // 只有工具区用到的数据（友链、页面更新时间）不和对话区抢首屏请求：
    // 切到工具区时立即加载，否则等页面加载完、浏览器空闲后再补上。
    function whenTools(task) {
        let done = false;
        const run = () => {
            if (done) return;
            done = true;
            window.removeEventListener('home:mode', onMode);
            task();
        };
        const onMode = event => { if (event.detail?.mode === 'tools') run(); };
        if (document.body.classList.contains('home-mode-tools')) return run();
        window.addEventListener('home:mode', onMode);
        const idle = () => setTimeout(() => (window.requestIdleCallback || (cb => setTimeout(cb, 0)))(run, { timeout: 2000 }), 1500);
        if (document.readyState === 'complete') idle();
        else window.addEventListener('load', idle, { once: true });
    }

    window.HomeMode = {
        get: () => mode,
        set: (next, options) => setMode(next, options),
        whenTools
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
