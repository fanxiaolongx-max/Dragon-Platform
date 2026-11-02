/* Shared offline adapter for the platform's published read-only pages. */
module.exports = function platformDemo(data, slug, modules) {
    const responses = data.responses;
    const originalFetch = window.fetch.bind(window);
    const canonical = url => {
        const parsed = new URL(url, 'https://snapshot.invalid');
        const params = new URLSearchParams();
        for (const name of ['topic', 'month']) if (parsed.searchParams.has(name)) params.set(name, parsed.searchParams.get(name));
        params.sort();
        return decodeURI(parsed.pathname) + (params.size ? '?' + params : '');
    };
    const captured = new Map(Object.entries(responses).map(([key, value]) => [canonical(key), value]));
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'X-Data-Source': 'snapshot' } });
    window.__TP_STATIC_DEMO__ = true;
    window.fetch = async (input, options = {}) => {
        const url = typeof input === 'string' ? input : input.url;
        if (/^(data:|blob:)/.test(url)) return originalFetch(input, options);
        const method = String(options.method || input.method || 'GET').toUpperCase();
        if (method !== 'GET') return json({ error: '只读演示：请回到平台操作 / Read-only demo: use the platform to make changes', code: 'READ_ONLY_SNAPSHOT' }, 403);
        const key = canonical(url);
        if (data.textAssets?.[key]) return new Response(data.textAssets[key], { headers: { 'Content-Type': 'text/javascript' } });
        if (captured.has(key)) {
            const value = JSON.parse(JSON.stringify(captured.get(key)));
            if (key === '/api/db/monthly_report_data') {
                const params = new URL(url, 'https://snapshot.invalid').searchParams;
                const start = params.get('startDate'), end = params.get('endDate');
                if (start && end) {
                    value.trends = value.trends.filter(row => row.date >= start && row.date <= end);
                    const latest = value.trends.at(-1);
                    value.latest_snapshot = latest ? responses.latestByDate?.[latest.date] || value.latest_snapshot : null;
                }
            }
            return json(value);
        }
        const path = key.split('?')[0];
        if (captured.has(path)) return json(captured.get(path));
        if (path === '/api/ai-settings') return json({});
        if (path === '/api/auth/me') return json({ user: { username: 'demo', role: 'user' } });
        return json({ error: '此内容未包含在本次快照中 / Not included in this snapshot', code: 'SNAPSHOT_NOT_FOUND' }, 404);
    };
    // Offline viewing never relies on a browser's existing signed-in identity.
    window.getUserRole = () => 'user';
    window.isAdmin = () => false;
    window.getAuthHeaderForNav = () => ({});
    document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '#tp-demo-nav{position:relative;z-index:10000;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 18px;background:#14283f;color:#f1f6ff;font:13px/1.5 system-ui}#tp-demo-nav a{color:#d2e9ff;text-decoration:none}#tp-demo-nav button{margin-left:auto;border:1px solid #86a7c9;border-radius:6px;background:transparent;color:inherit;padding:5px 9px}';
        document.head.appendChild(style);
        const nav = document.createElement('nav');
        nav.id = 'tp-demo-nav';
        const home = document.createElement('a');
        home.href = data.homeHref || '../index.html'; home.textContent = '首页 / Home'; nav.appendChild(home);
        const label = document.createElement('span'); label.textContent = '只读演示 / Read-only demo'; nav.appendChild(label);
        const button = document.createElement('button'); button.textContent = '中文 / English';
        button.onclick = () => window.ToolsI18n?.toggleLanguage(); nav.appendChild(button);
        document.body.prepend(nav);
        if (data.legacyHtml) document.getElementById('airLegacyReport')?.addEventListener('click', event => {
            event.preventDefault();
            location.assign(URL.createObjectURL(new Blob([data.legacyHtml], { type: 'text/html' })));
        });
        for (const link of document.querySelectorAll('a[href="/monthly"]')) link.href = './index.html';
    });
};
