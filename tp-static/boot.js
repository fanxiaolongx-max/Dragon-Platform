window.__TP_STATIC_READY__ = (async () => {
    'use strict';
    const base = new URL('../', document.currentScript.src);
    window.__TP_STATIC_BASE__ = base.href;
    const relativePath = location.pathname.startsWith(base.pathname) ? location.pathname.slice(base.pathname.length) : '';
    window.__TP_STATIC_PATH__ = !relativePath || relativePath === 'index.html' ? '/' : '/' + relativePath;
    const SESSION = 'tp-static:' + base.pathname;
    const fetchNetwork = window.fetch.bind(window);
    window.fetch = (...args) => window.__TP_STATIC_READY__.then(() => window.fetch(...args));
    const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
    const text = value => new TextEncoder().encode(value);
    const hash = async value => hex(await crypto.subtle.digest('SHA-256', text(value)));
    const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
    const en = () => /^en/i.test(localStorage.getItem('tools_lang') || document.documentElement.lang || '');
    const denied = () => en() ? 'No permission. Please contact an administrator to add access.' : '无权限，请联系管理员添加';
    const site = await (await fetchNetwork(new URL('tp-static/site.json', base), { cache: 'no-store' })).json();
    window.__TP_PUBLIC_MEDIA__ = site.media;
    async function worker() {
        if (!window.isSecureContext || !navigator.serviceWorker) throw new Error(en() ? 'Open this site over HTTPS.' : '请通过 HTTPS 打开此站点');
        const registration = await navigator.serviceWorker.register(new URL('tp-static-sw.js', base), { scope: base.pathname, updateViaCache: 'none' });
        await registration.update();
        const pending = registration.installing || registration.waiting;
        if (pending && pending.state !== 'activated') await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('静态站点更新超时，请刷新重试')), 15000);
            const changed = () => {
                if (pending.state === 'activated' || pending.state === 'redundant') {
                    clearTimeout(timer); pending.removeEventListener('statechange', changed);
                    pending.state === 'activated' ? resolve() : reject(new Error('静态站点更新失败，请刷新重试'));
                }
            };
            pending.addEventListener('statechange', changed); changed();
        });
        await navigator.serviceWorker.ready;
        return registration.active || navigator.serviceWorker.controller;
    }
    async function message(data) {
        const target = await worker();
        return new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timer = setTimeout(() => reject(new Error('静态站点初始化超时')), 15000);
            channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
            target.postMessage(data, [channel.port2]);
        });
    }
    function session() { try { return JSON.parse(sessionStorage.getItem(SESSION)); } catch (_) { return null; } }
    function destination() {
        const value = new URL(location.href).searchParams.get('next');
        const target = value ? new URL(value, base) : new URL('index.html', base);
        return target.origin === base.origin && target.pathname.startsWith(base.pathname) ? target.href : new URL('index.html', base).href;
    }
    navigator.serviceWorker?.addEventListener('message', event => {
        if (event.source?.scriptURL !== new URL('tp-static-sw.js', base).href) return;
        if (event.data?.type === 'NEED_KEY') event.ports[0]?.postMessage(session());
        if (event.data?.type === 'LOCK') {
            sessionStorage.removeItem(SESSION);
            localStorage.removeItem('tools_token');
            if (!location.pathname.endsWith('/login.html')) location.replace(new URL('login.html', base));
        }
    });
    // 已登录页面也检查 worker 更新，等待支持新载荷格式的版本激活后再加载业务资源。
    await worker();
    window.fetch = async (input, init = {}) => {
        const url = new URL(typeof input === 'string' ? input : input.url, base);
        if (url.pathname === '/api/auth/login' || url.pathname.endsWith('/api/auth/login')) {
            try {
                if (!window.isSecureContext || !crypto.subtle || !navigator.serviceWorker) return response({ error: en() ? 'Open this site over HTTPS in a modern browser.' : '请使用现代浏览器通过 HTTPS 打开站点' }, 503);
                const { username, password } = JSON.parse(init.body);
                const accountId = await hash(username);
                const account = site.accounts.find(a => a.id === accountId);
                if (!account) return response({ error: en() ? 'Invalid username or password' : '用户名或密码错误' }, 401);
                const material = await crypto.subtle.importKey('raw', text(await hash(password + 'tools_platform_salt')), 'PBKDF2', false, ['deriveKey']);
                const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: bytes(account.salt), iterations: site.iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
                const accountData = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(account.iv) }, key, bytes(account.wrapped))));
                const auth = { ...accountData, keyId: site.keyId };
                if (!(await message({ type: 'UNLOCK', ...auth })).ok) throw new Error('login');
                sessionStorage.setItem(SESSION, JSON.stringify(auth));
                window.__TP_LOGIN_DESTINATION__ = destination();
                return response({ success: true, token: 'static-site-session', username: auth.username, role: auth.role, tenantId: site.tenantId });
            } catch (_) { return response({ error: en() ? 'Invalid username or password' : '用户名或密码错误' }, 401); }
        }
        if (url.pathname.endsWith('/api/auth/logout')) {
            sessionStorage.removeItem(SESSION);
            await message({ type: 'LOCK' });
            return response({ success: true });
        }
        if (url.pathname.includes('/api/')) {
            const route = url.pathname.slice(url.pathname.indexOf('/api/'));
            if (['/api/platform-identity', '/api/nav-settings', '/api/platform-logo/status', '/api/app-version'].includes(route) && location.pathname.endsWith('/login.html') && String(init.method || 'GET').toUpperCase() === 'GET') {
                return response(site.identity?.[route] || {});
            }
            if (window.__TP_STATIC_API__) return window.__TP_STATIC_API__(route, init);
            return response({ error: denied(), code: 'READ_ONLY_SNAPSHOT' }, 403);
        }
        return fetchNetwork(input, init);
    };
    window.__TP_STATIC_SESSION__ = session;
    window.__TP_STATIC_DENIED__ = denied;
    if (!location.pathname.endsWith('/login.html') && session()?.keyId !== site.keyId) {
        sessionStorage.removeItem(SESSION);
        location.replace(new URL('login.html?next=' + encodeURIComponent(location.href), base));
        return;
    }
    if (document.documentElement.dataset.staticBoot === '1') {
        const auth = session();
        if (!site.files[relativePath || 'index.html'] && auth?.keyId === site.keyId) location.replace(new URL('index.html', base));
        else if (auth?.keyId === site.keyId && (await message({ type: 'UNLOCK', ...auth })).ok) location.reload();
        else location.replace(new URL('login.html?next=' + encodeURIComponent(location.href), base));
    }
})().catch(error => { const host = document.getElementById('staticBootStatus'); if (host) host.textContent = error.message; });
