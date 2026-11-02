/**
 * shared/fetch-dedupe.js - 合并同一时刻重复发出的 GET /api 请求
 *
 * 首页各模块启动时会各自请求同一个接口（nav-settings、tenants、desktop-agents/settings…），
 * 这里只合并“仍在进行中”的相同请求：请求结束即释放，不缓存已完成的业务数据。
 * 每个调用方拿到的都是独立的 Response 副本，可以各自读取 body。
 */
(function () {
    'use strict';
    if (window.__toolsFetchDedupe || typeof window.fetch !== 'function') return;
    window.__toolsFetchDedupe = true;

    const nativeFetch = window.fetch.bind(window);
    const pending = new Map();
    // 流式或有副作用风险的路径不合并
    const SKIP = /\/(stream|events|sse|download|export)(\/|\?|$)/i;

    function dedupeKey(input, init) {
        if (typeof input !== 'string' && !(input instanceof URL)) return '';
        if (init && (init.body != null || init.signal)) return '';
        const method = String(init?.method || 'GET').toUpperCase();
        if (method !== 'GET') return '';
        let url;
        try { url = new URL(String(input), window.location.href); } catch { return ''; }
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/') || SKIP.test(url.pathname)) return '';
        const headers = [...new Headers(init?.headers || {}).entries()].sort().map(([k, v]) => `${k}:${v}`).join('\n');
        return `${url.href}\n${init?.credentials || ''}\n${headers}`;
    }

    window.fetch = function (input, init) {
        const key = dedupeKey(input, init);
        if (!key) return nativeFetch(input, init);
        let shared = pending.get(key);
        if (!shared) {
            shared = nativeFetch(input, init);
            pending.set(key, shared);
            const release = () => { if (pending.get(key) === shared) pending.delete(key); };
            shared.then(release, release);
        }
        return shared.then(response => response.clone());
    };
})();
