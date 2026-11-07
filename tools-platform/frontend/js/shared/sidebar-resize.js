// 右侧面板共用拖动、键盘调整与宽度记忆；为中间对话保留可用空间。
(function () {
    'use strict';
    const controls = new WeakMap();
    window.SidebarResize = {
        setWidth(panel, width) { controls.get(panel)?.(width); },
        bind({ panel, cssVar, storageKey, defaultWidth = 360, onManualResize }) {
            const existing = panel.querySelector(':scope > .dc-sidebar-resize');
            if (existing) return existing;
            const handle = document.createElement('span');
            handle.className = 'dc-sidebar-resize';
            handle.tabIndex = 0;
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-orientation', 'vertical');
            panel.prepend(handle);
            let saved = defaultWidth, drag = null;
            try { saved = Number(localStorage.getItem(storageKey)) || defaultWidth; } catch {}
            const label = () => { const text = /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? 'Resize sidebar' : '调整侧栏宽度'; handle.setAttribute('aria-label', text); handle.title = text; };
            const limit = () => {
                if (innerWidth <= 860) return Math.max(240, innerWidth - 32);
                const main = document.querySelector('.home-main');
                return Math.max(280, innerWidth - (main?.getBoundingClientRect().left || 0) - 360);
            };
            const apply = (width, remember = false) => {
                const max = limit(), value = Math.round(Math.max(Math.min(280, max), Math.min(width, max)));
                document.body.style.setProperty(cssVar, `${value}px`);
                handle.setAttribute('aria-valuemin', String(Math.min(280, max)));
                handle.setAttribute('aria-valuemax', String(Math.round(max)));
                handle.setAttribute('aria-valuenow', String(value));
                if (remember) { saved = value; try { localStorage.setItem(storageKey, String(value)); } catch {} onManualResize?.(); }
                window.dispatchEvent(new Event('dragon-claw:sidebar-layout'));
            };
            const end = () => {
                if (!drag) return;
                drag = null;
                document.body.classList.remove('dc-sidebar-resizing');
                window.dispatchEvent(new Event('dragon-claw:sidebar-layout'));
            };
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                drag = { x: event.clientX, width: panel.getBoundingClientRect().width };
                handle.setPointerCapture(event.pointerId);
                document.body.classList.add('dc-sidebar-resizing');
                window.dispatchEvent(new Event('dragon-claw:sidebar-layout'));
            });
            document.addEventListener('pointermove', event => { if (drag) apply(drag.width + drag.x - event.clientX, true); });
            ['pointerup', 'pointercancel'].forEach(type => document.addEventListener(type, end));
            handle.addEventListener('lostpointercapture', end);
            handle.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
                event.preventDefault();
                apply(event.key === 'Home' ? defaultWidth : panel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 40 : -40), true);
            });
            window.addEventListener('blur', end);
            window.addEventListener('resize', () => apply(saved));
            window.addEventListener('tools:languagechange', label);
            new ResizeObserver(() => { if (!panel.hidden) apply(saved); }).observe(document.querySelector('.home-main') || panel);
            controls.set(panel, width => { saved = width; apply(width); });
            label(); apply(saved);
            return handle;
        }
    };
})();
