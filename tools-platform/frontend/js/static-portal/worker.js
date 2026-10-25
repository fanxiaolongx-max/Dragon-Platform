'use strict';
let manifestPromise, unlocked, recovery;
const base = new URL('./', self.registration.scope);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
async function manifest() {
    if (!manifestPromise) manifestPromise = fetch(new URL('tp-static/site.json', base), { cache: 'no-store' }).then(r => r.json());
    return manifestPromise;
}
async function unlock(auth, site) {
    if (auth?.keyId !== site.keyId) return false;
    const key = await crypto.subtle.importKey('raw', bytes(auth.key), 'AES-GCM', false, ['decrypt']);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(site.proof.iv) }, key, bytes(site.proof.data));
    unlocked = { key, keyId: site.keyId };
    return true;
}
async function recover(site) {
    if (!recovery) recovery = (async () => {
        const clients = await self.clients.matchAll();
        for (const client of clients) {
            const auth = await new Promise(resolve => {
                const channel = new MessageChannel();
                const timer = setTimeout(() => resolve(null), 800);
                channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
                client.postMessage({ type: 'NEED_KEY' }, [channel.port2]);
            });
            try { if (await unlock(auth, site)) return; } catch (_) {}
        }
    })().finally(() => { recovery = null; });
    await recovery;
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
    event.waitUntil((async () => {
        if (event.data?.type === 'UNLOCK') {
            manifestPromise = null;
            const site = await manifest();
            // 用站点校验块确认密钥正确，不能仅凭前端登录标记放行。
            event.ports[0]?.postMessage({ ok: await unlock(event.data, site) });
        } else if (event.data?.type === 'LOCK') {
            unlocked = null;
            for (const client of await self.clients.matchAll()) client.postMessage({ type: 'LOCK' });
            event.ports[0]?.postMessage({ ok: true });
        }
    })().catch(() => event.ports[0]?.postMessage({ ok: false })));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
    const name = decodeURIComponent(url.pathname.slice(base.pathname.length)) || 'index.html';
    if (name.startsWith('tp-static/') || name === 'tp-static-sw.js' || name === 'login.html') return;
    event.respondWith((async () => {
        if (event.request.mode === 'navigate') manifestPromise = null;
        const site = await manifest();
        const file = site.files[name];
        if (!file || file.public) return fetch(event.request);
        if (!unlocked || unlocked.keyId !== site.keyId) await recover(site);
        if (!unlocked || unlocked.keyId !== site.keyId) {
            // 回到公开引导页，允许刷新后从当前标签页的会话恢复解密密钥。
            if (event.request.mode === 'navigate') {
                const boot = await (await fetch(new URL('tp-static/boot.html', base))).text();
                return new Response(boot.replace('src="./tp-static/boot.js', `src="${new URL('tp-static/boot.js', base).href}`), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
            }
            return json({ error: '请先登录', code: 'AUTH_REQUIRED' }, 401);
        }
        try {
            const chunks = [];
            // 顺序下载和认证每个分片，避免并行载入大文件造成瞬时内存峰值。
            for (const part of file.parts || [file]) {
                if (!/^tp-static\/payload\/[a-f0-9]+\.bin$/.test(part.url)) throw new Error('Invalid payload');
                const response = await fetch(new URL(part.url, base), { cache: 'no-store' });
                if (!response.ok) return new Response('Snapshot unavailable', { status: 503 });
                chunks.push(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(part.iv) }, unlocked.key, await response.arrayBuffer()));
            }
            return new Response(new Blob(chunks), { headers: { 'Content-Type': file.type, 'Cache-Control': 'no-store' } });
        } catch (_) { return new Response('Snapshot verification failed', { status: 503 }); }
    })());
});
