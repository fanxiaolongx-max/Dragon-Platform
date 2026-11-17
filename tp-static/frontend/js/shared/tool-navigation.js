/* Shared app navigation and mobile viewport behavior. */
(function () {
    'use strict';
    if (window.ToolsNavigation?.installed) return;
    const appTool = (() => {
        try { return new URL(location.href).searchParams.get('tools_mobile') === '1'; }
        catch { return false; }
    })();
    configureMobileViewport();

    function configureMobileViewport() {
        const { userAgent = '', platform = '', maxTouchPoints = 0 } = window.navigator || {};
        const ios = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
        if (/Electron/i.test(userAgent) || (!ios && !/Android/i.test(userAgent) &&
            !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches)) return;

        function detectedLayout() {
            return document.querySelector?.('meta[name="tools-detected-mobile-layout"]')?.content || '';
        }
        function lockViewport() {
            const viewports = [...(document.querySelectorAll?.('meta[name="viewport"]') || [])];
            const rawSettings = viewports
                .flatMap(node => String(node.content || '').split(','))
                .map(value => value.trim())
                .filter(value => value && !/^(?:width|initial-scale|minimum-scale|maximum-scale|user-scalable)\s*=/i.test(value));
            const settings = [...new Set(rawSettings)];
            let viewport = viewports[0];
            for (const extra of viewports.slice(1)) extra.remove?.();
            if (!viewport) {
                viewport = document.createElement('meta');
                viewport.name = 'viewport';
                (document.head?.prepend || document.head?.append)?.call(document.head, viewport);
            }
            const layout = detectedLayout();
            if (appTool && layout === 'desktop') {
                viewport.content = ['width=1200', 'user-scalable=yes', ...settings].join(', ');
            } else if (appTool) {
                viewport.content = ['width=device-width', 'initial-scale=1', 'user-scalable=yes', ...settings].join(', ');
            } else {
                viewport.content = ['width=device-width', 'initial-scale=1', 'minimum-scale=1', 'maximum-scale=1',
                    'user-scalable=no', ...settings].join(', ');
            }
        }
        // Apply immediately and observe <head> during parsing so page-native viewport tags are
        // rewritten before initial body layout instead of waiting until DOMContentLoaded.
        lockViewport();
        if (document.readyState === 'loading') {
            let headObserver = null;
            if (document.head && typeof MutationObserver === 'function') {
                headObserver = new MutationObserver(() => lockViewport());
                headObserver.observe(document.head, { childList: true });
            }
            document.addEventListener('DOMContentLoaded', () => {
                headObserver?.disconnect?.();
                lockViewport();
            }, { once: true });
        }

        const style = document.createElement('style');
        // Allow pinch-zoom inside mobile app tool WebViews; block pinch only on outer shell.
        const touchActionRule = appTool
            ? 'touch-action: manipulation;'
            : 'touch-action: manipulation; touch-action: pan-x pan-y;';
        const inputZoomRule = ios && (!appTool || detectedLayout() !== 'desktop')
            ? `:is(textarea, select, input:not([type]), input:is([type="text"], [type="search"],
                [type="password"], [type="email"], [type="tel"], [type="url"], [type="number"]),
                [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]) {
                font-size: 16px !important;
            }`
            : '';
        style.textContent = `
            :where(html, body, body *) { ${touchActionRule} }
            ${inputZoomRule}
        `;
        document.head.append(style);

        if (ios && !appTool) {
            // Safari can ignore the viewport's scale limits for pinch gestures.
            const preventZoom = event => event.preventDefault();
            for (const type of ['gesturestart', 'gesturechange']) {
                document.addEventListener(type, preventZoom, { capture: true, passive: false });
            }
        }
    }

    const toolPath = /^\/(?:uivf12|sla|report|expedite|monthly|ai-bi|ai-report|duty-roster|bigscreen|topic-analysis|frt|praudit|storage|db-explorer|netcare-explorer|requirements|cinema|cinama|project-evolution|python-updater|desktop-license-admin)(?:\/|\.html$|$)|^\/(?:tools|apps)\/[^/]+(?:\/|$)|^\/pages\/(?:uivf12|sla|report|expedite|ai-report|ai-bi|monthly|monthly-designer|duty-roster|bigscreen|topic-analysis|frt|praudit|storage|db-explorer|netcare-explorer|requirements|custom-tool|cinema|project-evolution|python-updater|desktop-license-admin)\.html$/;
    const originals = new WeakMap();
    function resolveTool(href) {
        if (!href || String(href).startsWith('#')) return null;
        try {
            let url = new URL(href, location.href);
            if (url.origin !== location.origin) return null;
            if (url.pathname === '/' && url.searchParams.has('app')) {
                url = new URL(url.searchParams.get('app'), location.origin);
                if (url.origin !== location.origin) return null;
            }
            const raw = url.pathname.match(/^\/custom-tools\/([^/]+)\/(?:index\.html)?$/);
            if (raw) url.pathname = '/tools/' + raw[1];
            if (!toolPath.test(url.pathname)) return null;
            if (['/ai-report', '/pages/monthly-designer.html'].includes(url.pathname)) url.pathname = '/monthly';
            url.searchParams.delete('_t');
            return url;
        } catch { return null; }
    }
    function toolUrl(href) {
        const url = resolveTool(href);
        if (!url) return href;
        const custom = url.pathname.match(/^\/tools\/([^/]+)\/?$/);
        if (custom) url.pathname = '/custom-tools/' + custom[1] + '/index.html';
        url.searchParams.set('standalone', '1');
        if (appTool) url.searchParams.set('tools_mobile', '1');
        return url.pathname + url.search + url.hash;
    }
    function shellUrl(href) {
        const url = resolveTool(href);
        if (!url) return href;
        url.searchParams.delete('standalone');
        return '/?app=' + encodeURIComponent(url.pathname + url.search + url.hash);
    }
    function update(link) {
        if (!link?.matches('a[href]') || link.hasAttribute('download')) return;
        const href = link.getAttribute('href'), next = toolUrl(href);
        if (next !== href) { originals.set(link, href); link.setAttribute('href', next); }
    }
    function scan(root) {
        if (root.nodeType !== 1 && root.nodeType !== 9) return;
        if (root.matches?.('a[target="_blank"][href]')) update(root);
        root.querySelectorAll('a[target="_blank"][href]').forEach(update);
    }
    document.addEventListener('pointerdown', event => {
        if (event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey) update(event.target.closest?.('a[href]'));
    }, true);
    document.addEventListener('contextmenu', event => update(event.target.closest?.('a[href]')), true);
    document.addEventListener('click', event => {
        // Card controls handle their own clicks after the document capture phase.
        if (event.target.closest?.('button, input, select, textarea, label, [role="button"], [data-tool-card-actions]')) return;
        const link = event.target.closest?.('a[href]');
        if (!link || link.hasAttribute('download')) return;
        if (link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) { update(link); return; }
        if (event.defaultPrevented || event.button > 0 || (link.target && link.target !== '_self')) return;
        if (window.top !== window) return;
        const href = originals.get(link) || link.getAttribute('href'), url = resolveTool(href);
        if (!url || url.searchParams.get('standalone') === '1') return;
        event.preventDefault(); event.stopPropagation();
        window.HomeShell?.closePop?.();
        const path = url.pathname + url.search + url.hash;
        if (document.documentElement.classList.contains('is-clean-tool')) { location.assign(toolUrl(path)); return; }
        if (!window.HomeToolFrame?.open?.(path)) location.assign(shellUrl(path));
    }, true);
    new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'childList') record.addedNodes.forEach(scan);
            else if (record.target.matches?.('a[target="_blank"][href]')) update(record.target);
        }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'target'] });
    const open = window.open;
    window.open = function (url, ...args) { return open.call(this, typeof url === 'string' || url instanceof URL ? toolUrl(String(url)) : url, ...args); };
    window.ToolsNavigation = { ...window.ToolsNavigation, toolUrl, shellUrl, installed: true };
    const publicPath = /^\/(?:cinema|cinama|project-evolution|privacy|terms)(?:\/|\.html$|$)|^\/pages\/(?:cinema|cinama|project-evolution|privacy|terms)\.html$/i;
    const isPublic = publicPath.test(location.pathname);
    const current = location.pathname !== '/' ? resolveTool(location.href) : null;
    // Raw tool documents use their own access policy, including anonymous access.
    // Sending them through the platform shell would require a login again.
    const rawTool = location.pathname.startsWith('/custom-tools/');
    let clean = current?.searchParams.get('standalone') === '1' || ((isPublic || rawTool) && window.top === window);
    try { if (window.top !== window) clean ||= window.top.document.documentElement.classList.contains('is-clean-tool'); } catch { /* Cross-origin host. */ }
    if (current || clean) {
        if (!isPublic || window.top !== window) {
            document.documentElement.classList.add('is-embedded-tool');
        }
        if (clean && !window.DragonToolSurface) {
            if (!isPublic) document.documentElement.classList.add('is-clean-tool');
        } else if (!clean && window.top === window && !window.__TP_STATIC_BASE__ && !isPublic) {
            location.replace(shellUrl(location.href));
        }
        const style = document.createElement('style');
        style.textContent = 'html.is-embedded-tool{--navbar-h:0px}html.is-clean-tool :is(.ai-fab,.ai-panel,.ai-proactive-alert,.ops-inbox-banner,.ops-home-inbox,.custom-tool-head){display:none!important}html.is-clean-tool .custom-tool-shell{grid-template-rows:1fr}';
        document.head.append(style);
    }
    scan(document);
})();
