'use strict';

// Only the generated local SLA import link may return from a capture site to
// the logged-in tool frame. No auth tokens or browser storage are transferred.
function resolveUivImportPath(rawUrl, baseUrl) {
    try {
        const base = new URL(baseUrl), url = new URL(rawUrl);
        if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) return null;
        if (url.origin !== base.origin || url.username || url.password || !['/sla', '/pages/sla.html'].includes(url.pathname)) return null;
        const session = url.searchParams.get('uivImportSession'), token = url.searchParams.get('uivImportToken');
        if (url.searchParams.get('autoImport') !== '1' || !/^[a-f0-9]{32}$/.test(session || '') || !/^[a-f0-9]{32}$/.test(token || '')) return null;
        const params = new URLSearchParams({ uivImportSession: session, uivImportToken: token, autoImport: '1' });
        const month = url.searchParams.get('targetMonth');
        if (month && /^(?:[1-9]|1[0-2])$/.test(month)) params.set('targetMonth', month);
        return '/sla?' + params;
    } catch { return null; }
}
module.exports = { resolveUivImportPath };
