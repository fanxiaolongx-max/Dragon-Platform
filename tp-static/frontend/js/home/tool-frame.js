// 新版首页：工具在主区（侧栏右侧）内嵌打开，不再跳转到带旧顶部导航的整页。
// 首页里的工具链接在这里打开。Mac 上的数通协议专家使用独立的桌面视图。
// 工具页通过 js/shared/navbar.js 的 NAV_EMBEDDED 隐藏自己的顶部导航。地址栏记为 ?app=<路径>，刷新和前进后退都能还原。
(function () {
    'use strict';
    if (document.documentElement.dataset.ui !== 'v2') return;

    const L = (zh, en) => (/^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const state = { href: '', title: '', returnTo: null };
    const datacom = '/tools/datacom-protocol-expert';
    const desktop = window.DragonEmbeddedTool;
    const staticNav = window.ToolsStaticNavigation;
    let root, frame, titleEl, iconEl, surface, skeleton, surfaceMessage, retry;
    let assistantObserver, surfaceObserver, resizeObserver, surfaceFrame, surfaceId = 0, activeSurface = 0;

    function toolAssistant() {
        if (!root || root.hidden) return null;
        try {
            return frame.contentDocument?.querySelector('.ai-fab') ? frame.contentWindow.ToolsAIAssistant || null : null;
        } catch { return null; }
    }
    function syncAssistant() {
        document.body.classList.toggle('v2-tool-has-assistant', Boolean(activeSurface || toolAssistant()));
    }

    function queueSurfaceLayout() {
        if (!activeSurface || surfaceFrame) return;
        surfaceFrame = requestAnimationFrame(() => {
            surfaceFrame = 0;
            const { x, y, width, height } = surface.getBoundingClientRect();
            // 原生视图在网页上层，宿主菜单和弹窗打开时暂时摘下视图。
            const overlay = document.querySelector('.v2-pop.is-open, .v2-search.is-open, .ai-kg-overlay, dialog[open], .tools-dialog-overlay, .v2-msg.is-open');
            const visible = !overlay && !document.body.classList.contains('v2-side-peek');
            desktop.command('layout', activeSurface, { bounds: { x, y, width, height, visible } });
        });
    }

    function closeSurface() {
        if (!activeSurface) return;
        desktop.command('close', activeSurface);
        activeSurface = 0;
        cancelAnimationFrame(surfaceFrame);
        surfaceFrame = 0;
        surfaceObserver.disconnect();
        resizeObserver.disconnect();
        surface.hidden = true;
        frame.hidden = false;
    }

    function openSurface(href) {
        const id = activeSurface = ++surfaceId;
        frame.hidden = true;
        surface.hidden = false;
        skeleton.hidden = false;
        retry.hidden = true;
        surfaceMessage.textContent = L('正在加载数通协议专家…', 'Loading Datacom Protocol Expert…');
        surfaceObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'open', 'hidden'] });
        resizeObserver.observe(surface);
        syncAssistant();
        desktop.command('open', id, { href });
        queueSurfaceLayout();
    }

    // 工具地址：首页工具卡、导航里登记的工具、自定义工具与插件入口（/tools/…）
    function knownPaths() {
        const paths = new Set();
        for (const tool of window.HomeWorkspace?.getTools?.() || []) if (tool?.href) paths.add(tool.href);
        if (typeof getAllNavItems === 'function') for (const item of getAllNavItems()) if (item?.href) paths.add(item.href);
        return [...paths].map(href => { try { return new URL(href, location.origin); } catch { return null; } })
            .filter(url => url && url.origin === location.origin && url.pathname !== '/' && !url.searchParams.has('skill')).map(url => url.pathname);
    }
    function isToolUrl(url) {
        if (staticNav) return Boolean(staticNav.resolveTool(url));
        if (url.origin !== location.origin || url.pathname === '/' || /^\/(api|login|downloads?)\b/.test(url.pathname)) return false;
        // Requirements also has fixed menu/navbar entries outside the async tool catalog.
        if (['/requirements', '/pages/requirements.html'].includes(url.pathname)) return true;
        if (/^\/(tools|custom-tools|apps)\//.test(url.pathname)) return true;
        return knownPaths().some(path => url.pathname === path || url.pathname.startsWith(path.replace(/\/$/, '') + '/'));
    }
    function toolInfo(url) {
        if (staticNav) return staticNav.resolveTool(url) || {};
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
                <div class="v2-tool-frame-actions">
                <button type="button" class="v2-tool-frame-btn v2-tool-browser-btn" data-frame-act="browser" aria-controls="dcBrowserPanel" aria-pressed="false" hidden></button>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="more" title="${esc(L('更多操作', 'More options'))}" aria-haspopup="menu" aria-label="${esc(L('更多操作', 'More options'))}"><span class="v2-ico" data-icon="more"></span></button>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="reload" title="${esc(L('刷新', 'Reload'))}"><span class="v2-ico" data-icon="refresh"></span></button>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="external" title="${esc(staticNav ? L('独立页面打开', 'Open standalone page') : L('在新标签页打开', 'Open in new tab'))}"><span class="v2-ico" data-icon="external"></span></button>
                <button type="button" class="v2-tool-frame-btn" data-frame-act="close" title="${esc(L('关闭', 'Close'))}"><span class="v2-ico" data-icon="close"></span></button>
                </div>
            </header>
            <iframe class="v2-tool-frame-view" title="" allow="clipboard-read; clipboard-write; fullscreen; microphone; camera; display-capture"></iframe>
            <div class="v2-tool-surface" hidden>
                <div class="v2-tool-skeleton" aria-hidden="true"><div></div><div><i></i><i></i><i></i></div></div>
                <div class="v2-tool-surface-status">
                    <span role="status"></span>
                    <button type="button" data-frame-act="reload" hidden>${esc(L('重试', 'Retry'))}</button>
                </div>
            </div>`;
        document.querySelector('.home-main')?.prepend(root);
        frame = root.querySelector('iframe');
        titleEl = root.querySelector('.v2-tool-frame-title');
        iconEl = root.querySelector('.v2-tool-frame-icon');
        surface = root.querySelector('.v2-tool-surface');
        skeleton = surface.querySelector('.v2-tool-skeleton');
        surfaceMessage = surface.querySelector('[role="status"]');
        retry = surface.querySelector('button');
        if (desktop) {
            surfaceObserver = new MutationObserver(queueSurfaceLayout);
            resizeObserver = new ResizeObserver(queueSurfaceLayout);
            window.addEventListener('resize', queueSurfaceLayout);
            desktop.onStatus(({ id, status }) => {
                if (id !== activeSurface) return;
                skeleton.hidden = true;
                retry.hidden = status === 'ready';
                surfaceMessage.textContent = status === 'ready' ? '' : status === 'unresponsive'
                    ? L('工具无响应，可以重试或关闭。', 'The tool stopped responding. Retry or close it.')
                    : L('工具加载失败，请重试。', 'The tool could not load. Please retry.');
            });
        }
        window.HomeV2?.fillIcons?.(root);
        const browserButton = root.querySelector('[data-frame-act=browser]');
        const syncBrowserButton = () => {
            browserButton.textContent = L('浏览器', 'Browser');
            browserButton.title = L('显示或收起 Dragon 浏览器', 'Show or hide Dragon Browser');
            browserButton.setAttribute('aria-pressed', String(document.body.classList.contains('dc-browser-open')));
        };
        syncBrowserButton();
        window.addEventListener('tools:languagechange', syncBrowserButton);
        window.addEventListener('dragon-claw:browser-reading', syncBrowserButton);
        root.addEventListener('click', event => {
            const act = event.target.closest('[data-frame-act]')?.dataset.frameAct;
            if (act === 'browser') {
                if (document.body.classList.contains('dc-browser-open')) window.DragonBrowserSidebar?.close();
                else window.DragonBrowserSidebar?.open();
            }
            else if (act === 'close') close();
            else if (act === 'reload') {
                if (activeSurface) open(currentHref(), { push: false });
                else frame.src = currentHref();
            }
            else if (act === 'external') {
                if (staticNav) staticNav.openStandalone(currentHref());
                else window.open(window.ToolsNavigation.toolUrl(currentHref()), '_blank', 'noopener');
            }
            else if (act === 'more') {
                const btn = event.target.closest('[data-frame-act="more"]');
                window.HomeToolMenu?.open({
                    anchor: btn,
                    href: currentHref(),
                    title: titleEl?.textContent || '',
                    onRename: newTitle => {
                        if (newTitle && titleEl) {
                            titleEl.textContent = newTitle;
                            if (frame) frame.title = newTitle;
                        }
                    },
                    onDelete: () => {
                        close();
                    },
                    onReload: () => {
                        if (activeSurface) open(currentHref(), { push: false });
                        else frame.src = currentHref();
                    }
                });
            }
        });
        root.querySelector('.v2-tool-frame-bar')?.addEventListener('contextmenu', event => {
            if (event.target.closest('[data-frame-act="close"], [data-frame-act="external"], [data-frame-act="reload"]')) return;
            event.preventDefault();
            event.stopPropagation();
            window.HomeToolMenu?.open({
                x: event.clientX,
                y: event.clientY,
                href: currentHref(),
                title: titleEl?.textContent || '',
                onRename: newTitle => {
                    if (newTitle && titleEl) {
                        titleEl.textContent = newTitle;
                        if (frame) frame.title = newTitle;
                    }
                },
                onDelete: () => {
                    close();
                },
                onReload: () => {
                    if (activeSurface) open(currentHref(), { push: false });
                    else frame.src = currentHref();
                }
            });
        });
        // 工具内部跳转后同步标题与地址
        frame.addEventListener('load', () => {
            if (activeSurface) return;
            assistantObserver?.disconnect();
            syncAssistant();
            if (root.hidden) return;
            let doc;
            try { doc = frame.contentDocument; } catch { doc = null; }
            if (doc?.body) {
                assistantObserver = new MutationObserver(syncAssistant);
                assistantObserver.observe(doc.body, { childList: true, subtree: true });
            }
            const href = currentHref();
            if (staticNav && !staticNav.resolveTool(href)) return;
            if (doc?.title && !toolInfo(new URL(href, location.origin)).title) titleEl.textContent = doc.title.replace(/\s*[-|]\s*Dragon.*$/i, '');
            // 工具页里点回首页（Logo 等）：关掉内嵌而不是在框里再套一个首页
            try { if (new URL(href, location.origin).pathname === '/') { close(); return; } } catch { /* ignore */ }
            writeUrl(href, true);
        });
    }

    function currentHref() {
        if (activeSurface) return state.href;
        try { const loc = frame.contentWindow.location; if (loc.origin === location.origin && loc.href !== 'about:blank') return loc.pathname + loc.search + loc.hash; } catch { /* 跨源 */ }
        return state.href;
    }
    function writeUrl(href, replace) {
        const url = new URL(location.href);
        if (href) url.searchParams.set('app', href); else url.searchParams.delete('app');
        url.hash = href ? '' : url.hash;
        const next = url.pathname + url.search + url.hash;
        if (next === location.pathname + location.search + location.hash) return;
        history[replace ? 'replaceState' : 'pushState']({ ...(history.state || {}), app: href || null, toolReturn: href ? state.returnTo : null }, '', next);
    }

    function open(href, { push = true } = {}) {
        let url;
        try { url = new URL(href, location.origin); } catch { return false; }
        if (staticNav) {
            const tool = staticNav.resolveTool(url);
            if (!tool) {
                staticNav.notify();
                return true;
            }
            url = tool.url;
        }
        url.searchParams.delete('standalone');
        if (desktop && url.origin === location.origin && /^\/custom-tools\/datacom-protocol-expert\/(?:index\.html)?$/.test(url.pathname)) url.pathname = datacom;
        const useSurface = desktop && url.origin === location.origin && url.pathname === datacom;
        if (!root) render();
        // 连续打开另一个工具时仍返回最初入口，不把工具自身当作返回页。
        if (root.hidden) {
            const origin = new URL(location.href);
            origin.searchParams.delete('app');
            state.returnTo = new URLSearchParams(location.search).has('app') && history.state?.toolReturn
                ? history.state.toolReturn
                : { url: origin.pathname + origin.search + origin.hash, hub: Boolean(window.HomeSkillHub?.isOpen?.()),
                    mainScroll: document.querySelector('.home-main')?.scrollTop || 0, windowScroll: window.scrollY };
        }
        window.HomeSkillHub?.close?.();
        window.HomeV2?.closePop?.();
        const path = url.pathname + url.search + url.hash;
        const info = toolInfo(url);
        closeSurface();
        assistantObserver?.disconnect();
        document.body.classList.remove('v2-tool-has-assistant');
        state.href = path;
        titleEl.textContent = info.title || (useSurface ? L('数通协议专家', 'Datacom Protocol Expert') : decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || ''));
        iconEl.innerHTML = iconHtml(info.icon);
        frame.title = titleEl.textContent;
        root.hidden = false;
        root.querySelector('[data-frame-act=browser]').hidden = !window.DragonBrowser || Boolean(useSurface);
        document.body.classList.add('v2-tool-open');
        if (useSurface) {
            if (frame.hasAttribute('src')) frame.contentWindow.location.replace('about:blank');
            openSurface(path);
        } else {
            // iframe 导航不额外占用浏览器历史，返回键交给宿主页的 app 状态处理。
            if (!frame.hasAttribute('src')) frame.src = path;
            else frame.contentWindow.location.replace(path);
        }
        window.dispatchEvent(new CustomEvent('home:tool-frame', { detail: { open: true, href: path, browserAllowed: !useSurface } }));
        if (push) writeUrl(path, false);
        return true;
    }
    function close({ push = true, restore = true } = {}) {
        if (!root || root.hidden) return;
        const returnTo = state.returnTo;
        state.returnTo = null;
        root.hidden = true;
        closeSurface();
        assistantObserver?.disconnect();
        document.body.classList.remove('v2-tool-has-assistant');
        document.body.classList.remove('v2-tool-open');
        frame.contentWindow.location.replace('about:blank');
        state.href = '';
        window.dispatchEvent(new CustomEvent('home:tool-frame', { detail: { open: false } }));
        if (push) {
            if (restore && returnTo?.url) history.pushState({ ...(history.state || {}), app: null, toolReturn: null }, '', returnTo.url);
            else writeUrl('', false);
        }
        if (restore && returnTo) {
            if (returnTo.hub) window.HomeSkillHub?.open?.();
            const main = document.querySelector('.home-main');
            if (main) main.scrollTop = returnTo.mainScroll || 0;
            window.scrollTo({ top: returnTo.windowScroll || 0 });
        }
    }

    window.HomeToolFrame = { open, close, assistant: toolAssistant, isOpen: () => Boolean(root && !root.hidden), isToolUrl: href => { try { return isToolUrl(new URL(href, location.origin)); } catch { return false; } } };

    // 首页内任何指向工具的普通点击都改为内嵌打开（新标签 / 修饰键 / 下载链接照旧）
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.target.closest?.('[data-hub-act], .v2-hub-more, .card-more-toggle, .custom-tool-actions, .card-fav-toggle, .tool-context-menu')) return;
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
        const restore = () => {
            const next = new URLSearchParams(location.search).get('app');
            if (next && next.startsWith('/')) open(next, { push: false });
            else close({ push: false });
        };
        if (staticNav) staticNav.ready.then(() => {
            restore();
            window.addEventListener('popstate', restore);
        }).catch(() => {});
        else {
            restore();
            window.addEventListener('popstate', restore);
        }
        // 直接打开 ?app= 时工具列表可能还没加载：加载后补上名称和图标
        window.addEventListener('home:tools-updated', () => {
            if (!window.HomeToolFrame.isOpen()) return;
            const info = toolInfo(new URL(state.href, location.origin));
            if (info.title) { titleEl.textContent = info.title; frame.title = info.title; iconEl.innerHTML = iconHtml(info.icon); }
        });
        // 打开技能中心、切换对话或点侧栏其他入口时收起
        window.addEventListener('home:hub', event => { if (event.detail?.open) close({ restore: false }); });
        window.addEventListener('home:mode', () => close({ restore: false }));
        document.getElementById('homeSidebar')?.addEventListener('click', event => {
            // 打开弹窗或侧栏菜单时保留 iframe 及其当前状态。
            if (!window.HomeToolFrame.isOpen() || event.target.closest('.v2-userbar, .v2-side-tools, [aria-haspopup], #friendLinksManageBtn, a[href]')) return;
            if (event.target.closest('button, [role="button"], [data-conversation-id]')) close({ restore: false });
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
