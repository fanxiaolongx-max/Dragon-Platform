/**
 * shared/fetch-dedupe.js - 合并同一时刻重复发出的 GET /api 请求，并支持首屏预取
 *
 * 首页各模块启动时会各自请求同一个接口（nav-settings、tenants、desktop-agents/settings…），
 * 这里只合并“仍在进行中”的相同请求：请求结束即释放，不缓存已完成的业务数据。
 * 每个调用方拿到的都是独立的 Response 副本，可以各自读取 body。
 *
 * 首屏预取：页面一开始用 POST /api/home/bootstrap 一次取回多个首屏接口（远程访问只回源一次），
 * 之后模块发出的同一个 GET 直接使用预取结果。每条结果只用一次、15 秒后作废，之后的刷新照常走网络。
 */
(function () {
    'use strict';
    if (window.__toolsFetchDedupe || typeof window.fetch !== 'function') return;
    window.__toolsFetchDedupe = true;

    const nativeFetch = window.fetch.bind(window);
    const pending = new Map();
    const prefetched = new Map();
    const PREFETCH_TTL_MS = 15000;
    // 流式或有副作用风险的路径不合并
    const SKIP = /\/(stream|events|sse|download|export)(\/|\?|$)/i;

    function apiGetUrl(input, init) {
        if (typeof input !== 'string' && !(input instanceof URL)) return null;
        if (init && (init.body != null || init.signal)) return null;
        if (String(init?.method || 'GET').toUpperCase() !== 'GET') return null;
        let url;
        try { url = new URL(String(input), window.location.href); } catch { return null; }
        if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/') || SKIP.test(url.pathname)) return null;
        return url;
    }

    function dedupeKey(url, init) {
        const headers = [...new Headers(init?.headers || {}).entries()].sort().map(([k, v]) => `${k}:${v}`).join('\n');
        return `${url.href}\n${init?.credentials || ''}\n${headers}`;
    }

    function toResponse(hit) {
        const nullBody = hit.status === 204 || hit.status === 205 || hit.status === 304;
        return new Response(nullBody ? null : hit.body, { status: hit.status, headers: hit.headers || {} });
    }

    // 取出一条预取结果（只用一次）；没有可用结果（未预取、已过期、5xx）时返回 null，由调用方走网络
    function takePrefetched(url, input, init) {
        const entry = prefetched.get(url.href);
        if (!entry) return null;
        prefetched.delete(url.href);
        return entry.then(hit => (hit && hit.status >= 200 && hit.status < 500 ? toResponse(hit) : nativeFetch(input, init)));
    }

    function prefetch(paths, headers = {}) {
        const list = [...new Set((paths || []).filter(path => typeof path === 'string'))];
        if (!list.length) return;
        const batch = nativeFetch('/api/home/bootstrap', {
            method: 'POST',
            cache: 'no-store',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: list })
        }).then(res => (res.ok ? res.json() : null)).catch(() => null);
        list.forEach(path => {
            const href = new URL(path, window.location.href).href;
            prefetched.set(href, batch.then(data => data?.results?.[path] || null));
        });
        batch.finally(() => setTimeout(() => list.forEach(path => prefetched.delete(new URL(path, window.location.href).href)), PREFETCH_TTL_MS));
    }

    window.fetch = function (input, init) {
        const url = apiGetUrl(input, init);
        if (!url) return nativeFetch(input, init);
        const key = dedupeKey(url, init);
        let shared = pending.get(key);
        if (!shared) {
            shared = takePrefetched(url, input, init) || nativeFetch(input, init);
            pending.set(key, shared);
            const release = () => { if (pending.get(key) === shared) pending.delete(key); };
            shared.then(release, release);
        }
        return shared.then(response => response.clone());
    };

    window.ToolsFetchPrefetch = prefetch;
})();
