// 新版首页：工具在主区（侧栏右侧）内嵌打开，不再跳转到带旧顶部导航的整页。
// 首页里点到任何工具链接（技能·插件·工具中心、发现应用、更多、对话里的工具卡等）都在这里用 iframe 打开；
// 工具页通过 js/shared/navbar.js 的 NAV_EMBEDDED 隐藏自己的顶部导航。地址栏记为 ?app=<路径>，刷新和前进后退都能还原。
(function () {
    'use strict';
    if (document.documentElement.dataset.ui !== 'v2') return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const state = { href: '', title: '' };
    let root, frame, titleEl, iconEl;

    // 工具地址：首页工具卡、导航里登记的工具、自定义工具与插件入口（/tools/…）
    function knownPaths() {
        const paths = new Set();
        for (const tool of window.HomeWorkspace?.getTools?.() || []) if (tool?.href) paths.add(tool.href);
        if (typeof getAllNavItems === 'function') for (const item of getAllNavItems()) if (item?.href) paths.add(item.href);
        return [...paths].map(href => { try { return new URL(href, location.origin); } catch { return null; } })
            .filter(url => url && url.origin === location.origin && url.pathname !== '/' && !url.searchParams.has('skill')).map(url => url.pathname);
    }
    function isToolUrl(url) {
        if (url.origin !== location.origin || url.pathname === '/' || /^\/(api|login|downloads?)\b/.test(url.pathname)) return false;
        if (/^\/(tools|custom-tools|apps)\//.test(url.pathname)) return true;
        return knownPaths().some(path => url.pathname === path || url.pathname.startsWith(path.replace(/\/$/, '') + '/'));
    }
    function toolInfo(url) {
        const tool = (window.HomeWorkspace?.getTools?.() || []).find(item => { try { return new URL(item.href, location.origin).pathname === url.pathname; } catch { return false; } });
        return { title: tool?.title || '', icon: tool?.icon || '' };
    }
    function iconHtml(icon) {
        const value = String(icon || '').trim();
        if (/^(https?:|\/|data:image)/.test(value)) return `<img src="${esc(value)}" alt="">`;
        return esc(value.length <= 4 ? value : '') || '🧩';
    }

    function render() {
        root = document.createElement('section');
        root.className = 'v2-tool-frame';
        root.id = 'v2ToolFrame';
        root.hidden = true;
        root.innerHTML = `<header class="v2-tool-frame-bar">
                <span class="v2-tool-frame-icon"></span><strong class="v2-tool-frame-title"></strong>
                <span class="v2-tool-frame-spacer"></span>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="reload" title="${esc(L('刷新', 'Reload'))}"><span class="v2-ico" data-icon="refresh"></span></button>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="external" title="${esc(L('在新标签页打开', 'Open in new tab'))}"><span class="v2-ico" data-icon="external"></span></button>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="close" title="${esc(L('关闭', 'Close'))}"><span class="v2-ico" data-icon="close"></span></button>
            </header>
            <iframe class="v2-tool-frame-view" title="" allow="clipboard-read; clipboard-write; fullscreen; microphone; camera; display-capture"></iframe>`;
        document.querySelector('.home-main')?.prepend(root);
        frame = root.querySelector('iframe');
        titleEl = root.querySelector('.v2-tool-frame-title');
        iconEl = root.querySelector('.v2-tool-frame-icon');
        window.HomeV2?.fillIcons?.(root);
        root.addEventListener('click', event => {
            const act = event.target.closest('[data-frame-act]')?.dataset.frameAct;
            if (act === 'close') close();
            else if (act === 'reload') { try { frame.contentWindow.location.reload(); } catch { frame.src = state.href; } }
            else if (act === 'external') window.open(currentHref(), '_blank', 'noopener');
        });
        // 工具内部跳转后同步标题与地址
        frame.addEventListener('load', () => {
            let doc;
            try { doc = frame.contentDocument; } catch { doc = null; }
            const href = currentHref();
            if (doc?.title && !toolInfo(new URL(href, location.origin)).title) titleEl.textContent = doc.title.replace(/\s*[-|]\s*Dragon.*$/i, '');
            // 工具页里点回首页（Logo 等）：关掉内嵌而不是在框里再套一个首页
            try { if (new URL(href, location.origin).pathname === '/') { close(); return; } } catch { /* ignore */ }
            writeUrl(href, true);
        });
    }

    function currentHref() {
        try { const loc = frame.contentWindow.location; if (loc.origin === location.origin && loc.href !== 'about:blank') return loc.pathname + loc.search + loc.hash; } catch { /* 跨源 */ }
        return state.href;
    }
    function writeUrl(href, replace) {
        const url = new URL(location.href);
        if (href) url.searchParams.set('app', href); else url.searchParams.delete('app');
        url.hash = href ? '' : url.hash;
        const next = url.pathname + url.search + url.hash;
        if (next === location.pathname + location.search + location.hash) return;
        history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), app: href || null }, '', next);
    }

    function open(href, { push = true } = {}) {
        let url;
        try { url = new URL(href, location.origin); } catch { return false; }
        if (!root) render();
        window.HomeSkillHub?.close?.();
        const path = url.pathname + url.search + url.hash;
        const info = toolInfo(url);
        state.href = path;
        titleEl.textContent = info.title || decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
        iconEl.innerHTML = iconHtml(info.icon);
        frame.title = titleEl.textContent;
        if (frame.getAttribute('src') !== path) frame.src = path;
        root.hidden = false;
        document.body.classList.add('v2-tool-open');
        window.dispatchEvent(new CustomEvent('home:tool-frame', { detail: { open: true, href: path } }));
        if (push) writeUrl(path, false);
        return true;
    }
    function close({ push = true } = {}) {
        if (!root || root.hidden) return;
        root.hidden = true;
        document.body.classList.remove('v2-tool-open');
        frame.removeAttribute('src');
        state.href = '';
        window.dispatchEvent(new CustomEvent('home:tool-frame', { detail: { open: false } }));
        if (push) writeUrl('', false);
    }

    window.HomeToolFrame = { open, close, isOpen: () => Boolean(root && !root.hidden), isToolUrl: href => { try { return isToolUrl(new URL(href, location.origin)); } catch { return false; } } };

    // 首页内任何指向工具的普通点击都改为内嵌打开（新标签 / 修饰键 / 下载链接照旧）
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest?.('a[href]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || link.closest('#v2ToolFrame')) return;
        let url;
        try { url = new URL(link.getAttribute('href'), location.href); } catch { return; }
        if (!isToolUrl(url)) return;
        event.preventDefault();
        window.HomeV2?.closePop?.();
        open(url.pathname + url.search + url.hash);
    });

    function init() {
        const app = new URLSearchParams(location.search).get('app');
        if (app && app.startsWith('/')) open(app, { push: false });
        window.addEventListener('popstate', () => {
            const next = new URLSearchParams(location.search).get('app');
            if (next && next.startsWith('/')) open(next, { push: false });
            else close({ push: false });
        });
        // 直接打开 ?app= 时工具列表可能还没加载：加载后补上名称和图标
        window.addEventListener('home:tools-updated', () => {
            if (!window.HomeToolFrame.isOpen()) return;
            const info = toolInfo(new URL(state.href, location.origin));
            if (info.title) { titleEl.textContent = info.title; frame.title = info.title; iconEl.innerHTML = iconHtml(info.icon); }
        });
        // 打开技能中心、切换对话或点侧栏其他入口时收起
        window.addEventListener('home:hub', event => { if (event.detail?.open) close(); });
        window.addEventListener('home:mode', () => close());
        document.getElementById('homeSidebar')?.addEventListener('click', event => {
            if (!window.HomeToolFrame.isOpen() || event.target.closest('.v2-userbar, .v2-side-tools, #v2DiscoverBtn, a[href]')) return;
            if (event.target.closest('button, [role="button"], [data-conversation-id]')) close();
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
