// 桌面端主窗口（desktop-main-window.js）里的窗口按钮与拖动区：只在桌面应用里生效（preload 提供 window.DragonWindow），浏览器访问时什么都不做。
// · Windows 风格（Win/Linux）：右上角经典三键（最小化 / 最大化或还原 / 关闭），关闭悬浮深红高亮；侧栏无需左侧留白。
// · Mac 风格（macOS）：使用系统原生左上角红绿灯（hiddenInset），侧栏左上留出 76px 留白。
// · 拖动区：顶部条带、侧栏顶部一行、对话 / 工具 / 技能中心的标题栏；按钮、输入框等照常可点。
(function () {
    'use strict';
    const api = window.DragonWindow;
    if (!api || window.top !== window) return;
    const root = document.documentElement;
    root.classList.add('is-desktop-app');
    let isMac = false;   // 由主进程告知（macOS 用系统红绿灯）

    const style = document.createElement('style');
    style.id = 'desktopWindowStyles';
    style.textContent = `
        html.is-desktop-app { --desktop-controls-w: 0px; }
        /* 首页使用整窗背景，隐藏整页滚动条槽，避免启动遮罩右侧留下 8px 白边；保留页面滚动。 */
        html.is-desktop-app[data-ui="v2"], html.is-desktop-app[data-ui="v2"] body { scrollbar-width: none !important; }
        html.is-desktop-app[data-ui="v2"]::-webkit-scrollbar,
        html.is-desktop-app[data-ui="v2"] body::-webkit-scrollbar { display: none; width: 0 !important; height: 0 !important; }
        html.desktop-mac { --desktop-controls-w: 76px; }
        html.desktop-win { --desktop-controls-w: 0px; }
        html.is-desktop-app .desktop-drag, html.is-desktop-app .v2-side-tools, html.is-desktop-app .v2-tool-frame-bar,
        html.is-desktop-app .dc-chat-head, html.is-desktop-app .v2-hub-top { -webkit-app-region: drag; }
        html.is-desktop-app :is(button, a, input, select, textarea, label, summary, iframe, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], .v2-hub-card, .v2-hub-grid, .v2-hub-featured, .v2-hub-bar, .v2-hub-menu, .v2-pop, .dc-find) { -webkit-app-region: no-drag; }
        html.desktop-mac .v2-side-tools { min-height: 32px; padding-left: var(--desktop-controls-w); }
        html.desktop-mac .v2-side-float { left: calc(var(--desktop-controls-w) + 10px); }
        html.desktop-mac { --v2-float-end: calc(var(--desktop-controls-w) + 84px); }
        html.desktop-win { --v2-float-end: 92px; }
        html.desktop-win .v2-side-tools { min-height: 32px; padding-left: 0; }
        html.desktop-win .v2-side-float {
            top: 0;
            height: 48px;
            left: 12px;
            gap: 8px;
            align-items: center;
            z-index: 2147482001;
            -webkit-app-region: no-drag;
        }
        html.desktop-win .v2-side-float .v2-icon-btn {
            width: 36px;
            height: 36px;
            border-radius: 9px;
        }
        html.desktop-win .v2-side-float .v2-icon-btn .v2-ico {
            width: 22px;
            height: 22px;
        }
        html.desktop-win .dc-chat-head { min-height: 48px; height: 48px; }
        /* 全局设置弹窗让出顶部窗口按钮（Mac 左上红绿灯 / Windows 右上三键）的高度，弹窗整体矮一些 */
        html.is-desktop-app .nav-settings-modal { padding-top: 44px; }
        html.is-desktop-app .nav-settings-window { height: min(900px, calc(100vh - 68px)); }
        /* Windows 顶部各栏右侧给右上角三键（138px 宽）让位，再留 14px 间隔，栏内最右的按钮不会贴着窗口按钮 */
        html.desktop-win .dc-chat-head,
        html.desktop-win .v2-hub-top,
        html.desktop-win .v2-tool-frame-bar { padding-right: 152px; }
        /* Windows 右侧边栏（工作区、桌面 Agent 会话、文件预览）贴着窗口右上角：顶部留出三键高度（32px）的标题行，
           面板自己的关闭等按钮下移到三键下方，不再和窗口关闭键挨在一起；留出的标题行可拖动窗口。
           展开的文件卡片与浮动文件预览同样从三键下方开始。全屏时没有三键，不必让位。 */
        html.desktop-win:not(.desktop-fullscreen) .home-workspace-panel { padding-top: 38px; }
        html.desktop-win:not(.desktop-fullscreen) .home-workspace-panel::before { content: ""; position: absolute; top: 0; left: 0; right: 140px; height: 32px; -webkit-app-region: drag; }
        html.desktop-win:not(.desktop-fullscreen) .ai-file-preview--floating,
        html.desktop-win:not(.desktop-fullscreen) .dc-file-card.is-expanded { top: max(calc(var(--navbar-h, 0px) + 16px), 44px); }
        /* 顶部拖动条带 */
        .desktop-drag { position: fixed; top: 0; left: 0; right: 140px; height: 10px; z-index: 2147482000; -webkit-app-region: drag; }
        html.desktop-mac .desktop-drag { right: 0; }
        /* Welcome screen and open chats: the blank title margin above the content (10–28px, where the chat header starts) drags too, without covering sidebar buttons. */
        .desktop-drag-welcome::after {
            content: ""; display: none; position: fixed; top: 10px; left: var(--v2-side-width, 240px); right: 140px; height: 18px;
            -webkit-app-region: drag;
        }
        html.is-desktop-app[data-ui="v2"] body:not(.v2-hub-open):not(.v2-tool-open):not(.ai-kg-open) .desktop-drag-welcome::after { display: block; }
        html.desktop-mac .desktop-drag-welcome::after { right: 0; }
        /* 收起后左上角是「侧边栏 + 新建对话」两个浮动按钮，拖动区从它们右侧开始 */
        html.desktop-mac body.v2-side-collapsed .desktop-drag-welcome::after { left: calc(var(--desktop-controls-w) + 92px); }
        html.desktop-win body.v2-side-collapsed .desktop-drag-welcome::after { left: calc(var(--v2-float-end) + 8px); }
        /* Hub headers are full of controls; reserve a blank title gutter for dragging. */
        .desktop-drag-hub { display: none; position: fixed; top: 8px; left: var(--v2-side-width, 240px); right: 140px; height: 28px; z-index: 2147482000; -webkit-app-region: drag; }
        html.desktop-mac .desktop-drag-hub { right: 0; }
        html.is-desktop-app[data-ui="v2"] body.v2-hub-open .desktop-drag-hub { display: block; }
        html.is-desktop-app[data-ui="v2"] body.v2-hub-open .home-main { padding-top: 44px; }
        html.is-desktop-app[data-ui="v2"] body.v2-side-collapsed.v2-hub-open .home-main { padding-top: 56px; }
        html.desktop-mac body.v2-side-collapsed .desktop-drag-hub { left: calc(var(--desktop-controls-w) + 92px); }
        html.desktop-win body.v2-side-collapsed .desktop-drag-hub { left: calc(var(--v2-float-end) + 8px); }

        /* Full-window graph overlay: reserve native caption space before loading any data.
           The blank gutter remains draggable; graph controls and canvas keep their mouse input. */
        html.is-desktop-app .ai-kg-overlay { padding-top: 44px; box-sizing: border-box; }
        html.is-desktop-app .ai-kg-overlay::before {
            content: ""; position: absolute; top: 10px; left: 96px; right: 140px; height: 26px;
            -webkit-app-region: drag;
        }
        html.desktop-mac .ai-kg-overlay::before { right: 12px; }

        /* Windows 右上角窗口控制按钮栏 */
        .desktop-controls {
            position: fixed;
            z-index: 2147483000;
            top: 0;
            right: 0;
            height: 32px;
            display: flex;
            align-items: stretch;
            -webkit-app-region: no-drag;
            user-select: none;
        }
        html.desktop-mac .desktop-controls { display: none !important; }
        .desktop-controls button {
            position: relative;
            width: 46px;
            height: 32px;
            padding: 0;
            margin: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: #4b5563;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: none;
            transition: background-color .1s ease, color .1s ease;
            -webkit-app-region: no-drag;
        }
        html[data-theme="dark"] .desktop-controls button { color: #d1d5db; }
        .desktop-controls button:hover {
            background: rgba(0, 0, 0, 0.08);
            color: #111827;
        }
        html[data-theme="dark"] .desktop-controls button:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #ffffff;
        }
        .desktop-controls button:active {
            background: rgba(0, 0, 0, 0.15);
        }
        html[data-theme="dark"] .desktop-controls button:active {
            background: rgba(255, 255, 255, 0.2);
        }
        .desktop-controls [data-act="close"]:hover {
            background: #e81123 !important;
            color: #ffffff !important;
        }
        .desktop-controls [data-act="close"]:active {
            background: #bf101f !important;
            color: #ffffff !important;
        }
        .desktop-controls svg {
            display: block;
            width: 10px;
            height: 10px;
            pointer-events: none;
        }
        .desktop-controls.is-blurred:not(:hover) button {
            color: #9ca3af;
        }
        .desktop-controls button:focus-visible {
            outline: 1px solid #0a84ff;
            outline-offset: -1px;
        }
        html.is-desktop-app.desktop-fullscreen .desktop-controls { display: none; }
    `;
    document.head.appendChild(style);

    const ICONS = {
        minimize: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" stroke-width="1.1"/></svg>',
        maximize: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
        restore: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
        close: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.1"/></svg>'
    };
    const L = (zh, en) => (document.documentElement.lang === 'en' || window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);

    let controls;
    function mount() {
        if (!document.body || document.querySelector('.desktop-controls')) return;
        const strip = document.createElement('div');
        strip.className = 'desktop-drag desktop-drag-welcome';
        strip.setAttribute('aria-hidden', 'true');
        document.body.prepend(strip);
        const hubStrip = document.createElement('div');
        hubStrip.className = 'desktop-drag-hub';
        hubStrip.setAttribute('aria-hidden', 'true');
        document.body.prepend(hubStrip);
        if (isMac) return;
        controls = document.createElement('div');
        controls.className = 'desktop-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', L('窗口', 'Window'));
        // Windows 习惯：从左至右为 最小化、最大化/还原、关闭
        controls.innerHTML = `
            <button type="button" data-act="minimize" title="${L('最小化', 'Minimize')}" aria-label="${L('最小化', 'Minimize')}">${ICONS.minimize}</button>
            <button type="button" data-act="maximize" title="${L('最大化', 'Maximize')}" aria-label="${L('最大化', 'Maximize')}">${ICONS.maximize}</button>
            <button type="button" data-act="close" title="${L('关闭', 'Close')}" aria-label="${L('关闭', 'Close')}">${ICONS.close}</button>`;
        controls.addEventListener('click', event => {
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (act === 'close') api.close();
            else if (act === 'minimize') api.minimize();
            else if (act === 'maximize') api.toggleMaximize();
        });
        document.body.appendChild(controls);
    }

    function applyState(state = {}) {
        root.classList.toggle('desktop-maximized', Boolean(state.maximized));
        root.classList.toggle('desktop-fullscreen', Boolean(state.fullscreen));
        if (!controls) return;
        controls.classList.toggle('is-blurred', state.focused === false);
        const max = controls.querySelector('[data-act="maximize"]');
        const label = state.maximized ? L('还原', 'Restore') : L('最大化', 'Maximize');
        max.title = label;
        max.setAttribute('aria-label', label);
        max.innerHTML = state.maximized ? ICONS.restore : ICONS.maximize;
    }

    async function init() {
        let state = {};
        try { state = (await api.getState?.()) || {}; } catch { /* 按 Windows 处理 */ }
        isMac = state.platform === 'darwin';
        root.classList.add(isMac ? 'desktop-mac' : 'desktop-win');
        mount();
        applyState(state);
        api.onState?.(applyState);

        // 加载桌面端无侵入下载浮动条与右侧圆环管理器
        if (window.DragonDownload && !window.__desktopDownloadManagerInitialized && !document.querySelector('script[src*="desktop-download-manager.js"]')) {
            const script = document.createElement('script');
            script.src = './tp-static/frontend/js/shared/desktop-download-manager.js';
            document.head.appendChild(script);
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
