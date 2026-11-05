/* Ordinary tools live in the home shell; new windows contain only the tool. */
(function () {
    'use strict';
    if (window.ToolsNavigation?.installed) return;
    const toolPath = /^\/(?:uivf12|sla|report|expedite|monthly|ai-report|duty-roster|bigscreen|topic-analysis|frt|praudit|storage|db-explorer|netcare-explorer|requirements|cinema|cinama|project-evolution|python-updater|desktop-license-admin)(?:\/|\.html$|$)|^\/(?:tools|apps)\/[^/]+(?:\/|$)|^\/pages\/(?:uivf12|sla|report|expedite|ai-report|monthly|monthly-designer|duty-roster|bigscreen|topic-analysis|frt|praudit|storage|db-explorer|netcare-explorer|requirements|custom-tool|cinema|project-evolution|python-updater|desktop-license-admin)\.html$/;
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
        url.searchParams.set('standalone', '1');
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
        const link = event.target.closest?.('a[href]');
        if (!link || link.hasAttribute('download')) return;
        if (link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) { update(link); return; }
        if (event.defaultPrevented || event.button > 0 || (link.target && link.target !== '_self')) return;
        if (window.top !== window) return;
        const href = originals.get(link) || link.getAttribute('href'), url = resolveTool(href);
        if (!url || url.searchParams.get('standalone') === '1') return;
        event.preventDefault(); event.stopPropagation();
        window.HomeV2?.closePop?.();
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
    const current = location.pathname !== '/' ? resolveTool(location.href) : null;
    let clean = current?.searchParams.get('standalone') === '1';
    try { if (window.top !== window) clean ||= window.top.document.documentElement.classList.contains('is-clean-tool'); } catch { /* Cross-origin host. */ }
    if (current || clean) {
        document.documentElement.classList.add('is-embedded-tool');
        if (clean) document.documentElement.classList.add('is-clean-tool');
        else if (window.top === window && !window.__TP_STATIC_BASE__) location.replace(shellUrl(location.href));
        const style = document.createElement('style');
        style.textContent = 'html.is-embedded-tool{--navbar-h:0px}html.is-embedded-tool #app-navbar,html.is-embedded-tool #navbar-container{display:none!important}html.is-clean-tool :is(.ai-fab,.ai-panel,.ai-proactive-alert,.ops-inbox-banner,.ops-home-inbox,.custom-tool-head){display:none!important}html.is-clean-tool .custom-tool-shell{grid-template-rows:1fr}';
        document.head.append(style);
    }
    scan(document);
})();
