// 桌面端主窗口（desktop-main-window.js）里的窗口按钮与拖动区：只在桌面应用里生效（preload 提供 window.DragonWindow），浏览器访问时什么都不做。
// · 左上角 Mac 风格三个圆点：关闭 / 最小化 / 最大化（再点还原）；macOS 用系统红绿灯，这里只留出位置。
// · 拖动区：侧栏顶部一行、对话 / 工具 / 技能中心的标题栏、欢迎页和登录页顶部；按钮、输入框等照常可点。
//   双击拖动区最大化、再双击还原由系统处理。
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
        html.is-desktop-app { --desktop-controls-w: 76px; }
        html.is-desktop-app .desktop-drag, html.is-desktop-app .v2-side-tools, html.is-desktop-app .v2-tool-frame-bar,
        html.is-desktop-app .dc-chat-head, html.is-desktop-app .v2-hub-top { -webkit-app-region: drag; }
        html.is-desktop-app :is(button, a, input, select, textarea, label, summary, iframe, [role="button"], [role="tab"], [role="menuitem"], [contenteditable="true"], .v2-hub-card, .v2-hub-grid, .v2-hub-featured, .v2-hub-bar, .v2-hub-menu, .v2-pop, .dc-find) { -webkit-app-region: no-drag; }
        html.is-desktop-app .v2-side-tools { min-height: 28px; padding-left: var(--desktop-controls-w); }
        html.is-desktop-app .v2-side-expand { left: calc(var(--desktop-controls-w) + 10px) !important; }
        .desktop-drag { position: fixed; top: 0; left: 0; right: 0; height: 34px; z-index: 1; }
        html.is-desktop-app body:is(.dc-chatting, .v2-hub-open, .v2-tool-open) .desktop-drag-welcome { display: none; }
        .desktop-controls { position: fixed; z-index: 2147483000; top: 24px; left: 18px; display: flex; gap: 8px; -webkit-app-region: no-drag; }
        html.desktop-mac .desktop-controls { display: none; }
        .desktop-controls button { position: relative; width: 12px; height: 12px; padding: 0; border: 0; border-radius: 50%; cursor: default;
            box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.18); }
        .desktop-controls [data-act="close"] { background: #ff5f57; }
        .desktop-controls [data-act="minimize"] { background: #febc2e; }
        .desktop-controls [data-act="maximize"] { background: #28c840; }
        .desktop-controls svg { position: absolute; inset: 0; width: 12px; height: 12px; opacity: 0; transition: opacity .12s ease; }
        .desktop-controls:hover svg, .desktop-controls:focus-within svg { opacity: 1; }
        .desktop-controls.is-blurred:not(:hover) button { background: #d6d6d9; box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.12); }
        .desktop-controls button:focus-visible { outline: 2px solid #0a84ff; outline-offset: 2px; }
        html.is-desktop-app.desktop-fullscreen .desktop-controls { display: none; }
    `;
    document.head.appendChild(style);

    const icon = path => `<svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="1.2" stroke-linecap="round">${path}</svg>`;
    const ICONS = {
        close: icon('<path d="M3.8 3.8l4.4 4.4M8.2 3.8l-4.4 4.4"/>'),
        minimize: icon('<path d="M3.3 6h5.4"/>'),
        maximize: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.4 7.9V3.4h4.5z M8.6 4.1v4.5H4.1z" fill="rgba(0,0,0,.55)"/></svg>',
        restore: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M5.6 2.6v3H2.6z M6.4 9.4v-3h3z" fill="rgba(0,0,0,.55)"/></svg>'
    };
    const L = (zh, en) => (document.documentElement.lang === 'en' || window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);

    let controls;
    function mount() {
        if (!document.body || document.querySelector('.desktop-controls')) return;
        const strip = document.createElement('div');
        strip.className = 'desktop-drag desktop-drag-welcome';
        strip.setAttribute('aria-hidden', 'true');
        document.body.prepend(strip);
        if (isMac) return;
        controls = document.createElement('div');
        controls.className = 'desktop-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', L('窗口', 'Window'));
        controls.innerHTML = `
            <button type="button" data-act="close" title="${L('关闭', 'Close')}" aria-label="${L('关闭', 'Close')}">${ICONS.close}</button>
            <button type="button" data-act="minimize" title="${L('最小化', 'Minimize')}" aria-label="${L('最小化', 'Minimize')}">${ICONS.minimize}</button>
            <button type="button" data-act="maximize" title="${L('最大化', 'Maximize')}" aria-label="${L('最大化', 'Maximize')}">${ICONS.maximize}</button>`;
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
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
