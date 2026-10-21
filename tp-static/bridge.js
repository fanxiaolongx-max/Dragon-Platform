(function () {
    'use strict';
    const script = document.currentScript;
    const base = new URL('../', script.src);
    const home = window.__TP_STATIC_READY__.then(async () => {
        const response = await fetch(new URL('portal-data.json', base));
        if (!response.ok) throw new Error('请重新登录 / Please sign in again');
        return response.json();
    });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    function notify() {
        const message = window.__TP_STATIC_DENIED__();
        if (window.showToast) window.showToast(message, 'warning');
        else if (window.Toast?.warning) window.Toast.warning(message);
        else {
            let panel = document.getElementById('staticPermissionNotice');
            if (!panel) { panel = document.createElement('div'); panel.id = 'staticPermissionNotice'; panel.setAttribute('role', 'status'); panel.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:14px 22px;border-radius:12px;background:#19324b;color:white;box-shadow:0 8px 35px #0005;font:14px system-ui'; document.body.append(panel); }
            panel.textContent = message;
            clearTimeout(panel.timer);
            panel.timer = setTimeout(() => panel.remove(), 4500);
        }
    }
    window.__TP_STATIC_API__ = async (path, options = {}) => {
        const data = await home;
        const route = path.split('?')[0];
        const auth = window.__TP_STATIC_SESSION__();
        if (route === '/api/auth/me') return json(auth ? { username: auth.username, role: auth.role, tenantId: data.tenantId } : {}, auth ? 200 : 401);
        if (String(options.method || 'GET').toUpperCase() !== 'GET') {
            if (route === '/api/platform-metrics/open') return json({ success: true });
            // 静态站点不收集点击统计；原推广组件上报时无需弹出只读提示。
            if (route === '/api/platform-promotions/clicks' && String(options.method).toUpperCase() === 'POST') return json({ success: true, counted: false });
            notify(); return json({ error: window.__TP_STATIC_DENIED__(), code: 'READ_ONLY_SNAPSHOT' }, 403);
        }
        if (route === '/api/app-version') return json(data.appVersion || {});
        if (route === '/api/platform-promotions' && data.promotions) return json({
            ...data.promotions,
            desktopStack: false,
            defaultsWritable: false,
            links: data.promotions.links.map(link => ({ ...link, coverImage: link.coverImage?.startsWith('/assets/promotions/') ? new URL('tp-static/frontend' + link.coverImage, base).href : link.coverImage }))
        });
        if (route === '/api/platform-promotions/desktop') return json({ available: false });
        if (route === '/api/nav-settings') return json(data.settings);
        if (route === '/api/platform-identity') return json(data.identity);
        if (route === '/api/custom-tools') return json(data.tools);
        if (route === '/api/platform-metrics/summary') return json(data.summary);
        if (route === '/api/upload/history') return json([]);
        if (route === '/api/home/page-updates') return json({});
        if (route === '/api/home/capabilities') return json({ groups: [] });
        if (route === '/api/agent-skills') return json({ skills: [], items: [] });
        if (route === '/api/ai/skills') return json({ skills: [] });
        if (route === '/api/ai/sessions') return json({ sessions: [], total: 0, hasMore: false });
        if (route === '/api/ai/models') return json({ models: [] });
        if (route === '/api/ai/tool-local-keys') return json({ keys: {} });
        if (route === '/api/alert-center/summary') return json({ unread: 0, total: 0 });
        if (route === '/api/health') return json({ status: 'ok', success: true, static: true });
        if (route === '/api/builtin-promotion/status') return json({ tools: [], lockedTools: [] });
        if (route === '/api/custom-tools/builtin-sync/preview') return json({ items: [], count: 0, changes: [] });
        if (route === '/api/tenants') return json({ tenants: [{ id: data.tenantId, name: data.tenantId }], currentTenantId: data.tenantId });
        if (route === '/api/platform-logo/status') return json({ ok: true, hasLogo: true });
        if (route === '/api/friend-links') return json(data.friendLinks);
        return json({ error: window.__TP_STATIC_DENIED__(), code: 'READ_ONLY_SNAPSHOT' }, 403);
    };
    function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); notify(); }
    document.addEventListener('submit', event => stop(event), true);
    document.addEventListener('click', async event => {
        const anchor = event.target.closest('a[href]');
        if (!anchor) {
            const mutation = event.target.closest('[type="file"],.custom-tool-actions button,#customToolUploadBtn,#toolMarketBtn,#builtinToolsCompareBtn,#dcSend,#dcAttach,#dcWorkspaceBtn,[data-skill-action]');
            if (mutation) stop(event);
            return;
        }
        const raw = anchor.getAttribute('href');
        if (!raw || raw.startsWith('#')) return;
        const url = new URL(raw, base);
        if (url.origin === base.origin && url.pathname === location.pathname && url.hash) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (url.origin !== base.origin) return notify();
        let route = url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : url.pathname.slice(1);
        route = route.replace(/^pages\//, '').replace(/\.html$/, '').replace(/\/$/, '');
        if (!route || route === 'index') return location.assign(new URL('index.html' + url.hash, base));
        if (route === 'project-evolution') return window.open(new URL('project-evolution.html', base), '_blank', 'noopener');
        if (route === 'login') return location.assign(new URL('login.html', base));
        const data = await home;
        const slug = route.replace(/^(?:tools|custom-tools)\//, '').replace(/\/index$/, '');
        const item = data.items.find(item => item.slug === slug || item.href.slice(2).replace(/\.html$/, '') === route);
        if (item) location.assign(new URL(item.href, base));
        else notify();
    }, true);
    home.then(() => {
        // 脚本/插件列表不导出；其它区域使用平台原组件和布局。
        const removeScripts = () => {
            document.querySelectorAll('#skillsTools,#skillsToolsSection,#homeCapabilities .capability-group[data-kind="script"]').forEach(node => node.remove());
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeScripts);
        else removeScripts();
    }).catch(() => {});
})();
