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
function attachBrowserLogin(wc, { getStore, allowed = () => true, notify = () => {} }) {
    let documentNonce = '', documentOrigin = '';
    const handler = async (event, channel, message) => {
        if (channel !== 'dragon-browser:login' || event.senderFrame !== wc.mainFrame || !allowed() || !message || typeof message.document !== 'string' || message.document.length > 100) return;
        const href = wc.getURL(), origin = loginOrigin(href), store = getStore();
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
                const autoSubmit = !!(enabled && credentials && store.claimAutoSubmit(origin));
                wc.send('dragon-browser:login-state', { document: message.document, origin, enabled, credentials, autoSubmit });
            }
        } catch (_) { notify('unavailable'); }
    };
    wc.on('ipc-message', handler);
    return () => wc.removeListener('ipc-message', handler);
}
module.exports = { loginOrigin, captureSite, createBrowserCredentials, attachBrowserLogin };
