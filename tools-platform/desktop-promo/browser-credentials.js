// Local browser secrets, encrypted with the OS key store. Never use business DBs,
// JSON/plaintext fallbacks, page localStorage or the platform's login credentials.
'use strict';
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

function loginOrigin(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password ? url.origin : null;
    } catch (_) { return null; }
}
function captureSite(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['netcare.huawei.com', 'netcare-ae.gts.huawei.com', 'netcare-de.gts.huawei.com', 'datafab-pro.gtsdata.huawei.com'].includes(url.hostname);
    } catch (_) { return false; }
}
function createBrowserCredentials(filename, safeStorage) {
    const attempts = new Map();
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    let db;
    const opened = new Promise((resolve, reject) => { db = new sqlite3.Database(filename, error => error ? reject(error) : resolve()); });
    db.configure('busyTimeout', 5000);
    const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => error ? reject(error) : resolve()));
    const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
    const ready = (async () => {
        await opened;
        await run('CREATE TABLE IF NOT EXISTS browser_logins (origin TEXT PRIMARY KEY, secret BLOB, enabled INTEGER NOT NULL DEFAULT 1)');
        try { fs.chmodSync(filename, 0o600); } catch (_) {}
    })();
    ready.catch(() => {});
    async function available() {
        if (!safeStorage || safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
        if (safeStorage.isAsyncEncryptionAvailable) return safeStorage.isAsyncEncryptionAvailable();
        return !!safeStorage.isEncryptionAvailable?.();
    }
    return {
        ready,
        claimAutoSubmit(origin) {
            const last = attempts.get(origin) || 0;
            if (Date.now() - last < 300000) return false;
            attempts.set(origin, Date.now());
            return true;
        },
        async read(url) {
            const origin = loginOrigin(url);
            if (!origin || !(await available())) return null;
            await ready;
            const row = await get('SELECT secret, enabled FROM browser_logins WHERE origin = ?', [origin]);
            if (!row?.enabled || !row.secret) return null;
            try {
                const decoded = safeStorage.decryptStringAsync ? (await safeStorage.decryptStringAsync(row.secret)).result : safeStorage.decryptString(row.secret);
                const value = JSON.parse(decoded);
                return typeof value.username === 'string' && typeof value.password === 'string' ? value : null;
            } catch (_) { return null; }
        },
        async save(url, credentials) {
            const origin = loginOrigin(url);
            if (!origin || !credentials || typeof credentials.username !== 'string' || typeof credentials.password !== 'string' || !credentials.username.trim() || !credentials.password || credentials.username.length > 512 || credentials.password.length > 4096 || !(await available())) return false;
            await ready;
            const row = await get('SELECT enabled FROM browser_logins WHERE origin = ?', [origin]);
            if (row && !row.enabled) return false;
            const text = JSON.stringify({ username: credentials.username.trim(), password: credentials.password });
            const secret = safeStorage.encryptStringAsync ? await safeStorage.encryptStringAsync(text) : safeStorage.encryptString(text);
            await run('INSERT INTO browser_logins (origin, secret) VALUES (?, ?) ON CONFLICT(origin) DO UPDATE SET secret = excluded.secret WHERE browser_logins.enabled = 1', [origin, secret]);
            return true;
        },
        async enabled(url) {
            const origin = loginOrigin(url); if (!origin) return false;
            await ready;
            const row = await get('SELECT enabled FROM browser_logins WHERE origin = ?', [origin]);
            return row ? !!row.enabled : true;
        },
        async toggle(url) {
            const origin = loginOrigin(url); if (!origin) return;
            const enabled = !(await this.enabled(origin));
            await run('INSERT INTO browser_logins (origin, enabled) VALUES (?, ?) ON CONFLICT(origin) DO UPDATE SET enabled = excluded.enabled', [origin, Number(enabled)]);
            return enabled;
        },
        async remove(url) {
            const origin = loginOrigin(url); if (!origin) return;
            await ready; await run('INSERT INTO browser_logins (origin, enabled) VALUES (?, 0) ON CONFLICT(origin) DO UPDATE SET secret = NULL, enabled = 0', [origin]);
        },
        async close() { await ready.catch(() => {}); await new Promise(resolve => db.close(() => resolve())); }
    };
}

// This handler is attached only to tabs opened for the capture sites. Each IPC
// reply is tied to the current main-frame URL and document nonce, never a URL
// supplied by page JavaScript. No Electron bridge is exposed to the page.
function attachBrowserLogin(wc, { getStore, allowed = () => true, notify = () => {}, originOf = loginOrigin }) {
    let documentNonce = '', documentOrigin = '';
    const handler = async (event, channel, message) => {
        if (channel !== 'dragon-browser:login' || event.senderFrame !== wc.mainFrame || !allowed() || !message || typeof message.document !== 'string' || message.document.length > 100) return;
        const href = wc.getURL(), origin = originOf(href), store = getStore();
        if (!origin || !store) return;
        try {
            if (message.action !== 'probe' && (message.document !== documentNonce || origin !== documentOrigin)) return;
            if (message.action === 'save') {
                if (!(await store.enabled(origin))) return;
                notify(await store.save(origin, message.credentials) ? 'saved' : 'unavailable');
            } else if (message.action === 'probe') {
                documentNonce = message.document; documentOrigin = origin;
                const credentials = await store.read(origin);
                const enabled = await store.enabled(origin);
                if (wc.isDestroyed() || wc.getURL() !== href || documentNonce !== message.document) return;
                const autoSubmit = !!(enabled && credentials && credentials.autoSubmit !== false && store.claimAutoSubmit(origin));
                wc.send('dragon-browser:login-state', { document: message.document, origin, enabled, credentials: credentials ? { username: credentials.username, password: credentials.password } : null, autoSubmit });
            }
        } catch (_) { notify('unavailable'); }
    };
    wc.on('ipc-message', handler);
    return () => wc.removeListener('ipc-message', handler);
}

/**
 * 把 Dragon 浏览器的「记住密码」接到平台保险箱：凭据归当前登录平台的账号所有，任何站点都可用。
 * 接口与上面的本机库一致（attachBrowserLogin 不用区分）。没有登录账号时什么都不存、什么都不填。
 * legacy：旧版只存在这台电脑上的密码库，第一次用到某个站点时迁进保险箱。
 */
function createVaultCredentials({ vault, getOwner, legacy = null }) {
    const attempts = new Map();
    const owner = async () => { try { return (await getOwner()) || null; } catch (_) { return null; } };
    return {
        ready: Promise.resolve(),
        claimAutoSubmit(origin) {
            const last = attempts.get(origin) || 0;
            if (Date.now() - last < 300000) return false;
            attempts.set(origin, Date.now());
            return true;
        },
        async read(url) {
            const account = await owner();
            if (!account) return null;
            let entry = (await vault.find(account, url)).find(item => item.autoFill);
            if (!entry && legacy && !(await vault.find(account, url)).length) {
                const old = await legacy.read(url).catch(() => null);
                if (old) {
                    entry = (await vault.save(account, { url, username: old.username, password: old.password })).entry;
                    await legacy.remove(url).catch(() => {}); // 迁移后清掉本机旧副本，避免在保险箱里删除后又被迁回来
                }
            }
            if (!entry) return null;
            const found = await vault.credentials(account, url, { id: entry.id });
            return found ? { username: found.username, password: found.password, autoSubmit: found.autoSubmit } : null;
        },
        async save(url, credentials) {
            const account = await owner();
            if (!account || !credentials || await vault.neverSave(account, url)) return false;
            // 用户刚亲手登录过：接下来几分钟回到登录页（后退、退出登录）只填写，不再自动提交
            try { attempts.set(new URL(url).origin, Date.now()); } catch (_) { /* 地址无效时由保险箱拒绝 */ }
            try { await vault.save(account, { url, username: credentials.username, password: credentials.password }); return true; }
            catch (_) { return false; }
        },
        async enabled(url) {
            const account = await owner();
            return !!account && !(await vault.neverSave(account, url));
        },
        async toggle(url) {
            const account = await owner();
            if (!account) return false;
            const never = !(await vault.neverSave(account, url));
            await vault.setNeverSave(account, url, never);
            return !never;
        },
        async remove(url) {
            const account = await owner();
            if (!account) return;
            for (const entry of await vault.find(account, url)) await vault.remove(account, entry.id);
            await vault.setNeverSave(account, url, true);
        },
        async close() { await legacy?.close().catch(() => {}); }
    };
}
module.exports = { loginOrigin, captureSite, createBrowserCredentials, attachBrowserLogin, createVaultCredentials };
