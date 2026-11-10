// 保险箱：每个账号自己的网站登录凭据（Dragon 浏览器自动保存 / 自动填充 / AI 代填）。
//
// 安全边界：
// - 归属只认登录账号（账号名全平台唯一）。超级管理员也只能读写自己的条目，没有任何跨账号入口。
// - 密码用 AES-256-GCM 加密后入库；每个账号一把由主密钥派生的子密钥，并把「账号 | 站点 | 用户名」
//   作为附加校验数据，密文挪到别的账号或站点下无法解开。
// - 主密钥只存在本机：桌面端由系统密码库（DPAPI / Keychain）封装，服务器部署是 0600 权限的密钥文件。
//   保险箱目录不进全局备份，换机器后需要重新保存密码。
// - 只按「协议 + 域名 + 端口」完全一致的站点取密码，仿冒域名拿不到。
// - 明文密码只在两处出现：填进网页的那一刻，以及本人输入平台登录密码后查看。不写日志、不进模型上下文。
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const tenantContext = require('./tenant-context');

const LIMITS = { username: 512, password: 4096, label: 120, entriesPerOwner: 2000 };
const AUTO_SUBMIT_COOLDOWN_MS = 5 * 60 * 1000;
const FORMAT = 1;

function vaultError(code, message, statusCode = 400) {
    return Object.assign(new Error(message), { code, statusCode });
}

/** 登录账号 → 保险箱归属。账号名全平台唯一，进入别的团队空间排障时仍是自己的保险箱。 */
function ownerOf(user) {
    const name = String(user && user.username || '').trim();
    return name || null;
}

/** 站点标识：协议 + 域名 + 端口。只接受 http(s)，带账号密码的地址不认。 */
function originOf(value) {
    try {
        const url = new URL(String(value || '').trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) return null;
        return url.origin;
    } catch (_error) { return null; }
}

function safeStorage() {
    try {
        const storage = require('electron').safeStorage;
        if (!storage || typeof storage.isEncryptionAvailable !== 'function' || !storage.isEncryptionAvailable()) return null;
        if (storage.getSelectedStorageBackend?.() === 'basic_text') return null;
        return storage;
    } catch (_error) { return null; }
}

function createVault({ directory = path.join(tenantContext.BASE_DATA_DIR, 'vault'), protector = safeStorage } = {}) {
    let db = null, ready = null, masterKey = null;
    const autoSubmitAt = new Map();
    const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function done(error) { return error ? reject(error) : resolve(this); }));
    const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
    const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows)));

    function loadMasterKey() {
        if (masterKey) return masterKey;
        const plainFile = path.join(directory, 'master.key'), sealedFile = path.join(directory, 'master.key.sealed');
        const storage = protector();
        if (fs.existsSync(sealedFile)) {
            if (!storage) throw vaultError('VAULT_LOCKED', '本机系统密码库不可用，保险箱暂时无法解锁', 503);
            try { masterKey = Buffer.from(storage.decryptString(fs.readFileSync(sealedFile)), 'base64'); }
            catch (_error) { throw vaultError('VAULT_LOCKED', '保险箱密钥无法在这台电脑上解开（数据可能来自另一台电脑），请重新保存密码', 503); }
        } else if (fs.existsSync(plainFile)) {
            masterKey = fs.readFileSync(plainFile);
        } else {
            masterKey = crypto.randomBytes(32);
            if (storage) fs.writeFileSync(sealedFile, storage.encryptString(masterKey.toString('base64')), { mode: 0o600 });
            else fs.writeFileSync(plainFile, masterKey, { mode: 0o600 });
        }
        if (masterKey.length !== 32) { masterKey = null; throw vaultError('VAULT_LOCKED', '保险箱密钥损坏', 503); }
        return masterKey;
    }
    const ownerKey = owner => Buffer.from(crypto.hkdfSync('sha256', loadMasterKey(), Buffer.from(owner, 'utf8'), Buffer.from('dragon-vault-v1', 'utf8'), 32));
    const binding = (owner, origin, username) => Buffer.from(`${owner}\n${origin}\n${username}`, 'utf8');
    function seal(owner, origin, username, password) {
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', ownerKey(owner), iv);
        cipher.setAAD(binding(owner, origin, username));
        const body = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
        return Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), body]);
    }
    function open(owner, origin, username, secret) {
        const blob = Buffer.isBuffer(secret) ? secret : Buffer.from(secret || []);
        if (blob.length < 29 || blob[0] !== FORMAT) throw vaultError('VAULT_CORRUPT', '保险箱条目已损坏，请删除后重新保存');
        const decipher = crypto.createDecipheriv('aes-256-gcm', ownerKey(owner), blob.subarray(1, 13));
        decipher.setAAD(binding(owner, origin, username));
        decipher.setAuthTag(blob.subarray(13, 29));
        try { return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8'); }
        catch (_error) { throw vaultError('VAULT_CORRUPT', '保险箱条目无法解密，请删除后重新保存'); }
    }

    function init() {
        ready ||= (async () => {
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            const filename = path.join(directory, 'vault.db');
            await new Promise((resolve, reject) => { db = new sqlite3.Database(filename, error => error ? reject(error) : resolve()); });
            db.configure('busyTimeout', 5000);
            await run(`CREATE TABLE IF NOT EXISTS vault_logins (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, origin TEXT NOT NULL, username TEXT NOT NULL, secret BLOB NOT NULL,
                label TEXT NOT NULL DEFAULT '', auto_fill INTEGER NOT NULL DEFAULT 1, auto_submit INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL DEFAULT 0, use_count INTEGER NOT NULL DEFAULT 0,
                UNIQUE(owner, origin, username))`);
            await run('CREATE TABLE IF NOT EXISTS vault_sites (owner TEXT NOT NULL, origin TEXT NOT NULL, never_save INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(owner, origin))');
            try { fs.chmodSync(filename, 0o600); } catch (_error) { /* Windows 没有这套权限位 */ }
            loadMasterKey();
        })().catch(error => { ready = null; throw error; });
        return ready;
    }

    const requireOwner = owner => { if (typeof owner !== 'string' || !owner) throw vaultError('VAULT_OWNER', '无法确定账号', 401); return owner; };
    const publicEntry = row => ({
        id: row.id, origin: row.origin, host: new URL(row.origin).host, username: row.username, label: row.label || '',
        autoFill: !!row.auto_fill, autoSubmit: !!row.auto_submit, createdAt: row.created_at, updatedAt: row.updated_at, lastUsedAt: row.last_used_at, useCount: row.use_count
    });
    function checkFields({ username, password, label }, { partial = false } = {}) {
        if (username !== undefined || !partial) {
            if (typeof username !== 'string' || !username.trim() || username.length > LIMITS.username) throw vaultError('VAULT_INVALID', '请填写用户名');
        }
        if (password !== undefined || !partial) {
            if (typeof password !== 'string' || !password || password.length > LIMITS.password) throw vaultError('VAULT_INVALID', '请填写密码');
        }
        if (label !== undefined && (typeof label !== 'string' || label.length > LIMITS.label)) throw vaultError('VAULT_INVALID', '备注过长');
    }

    const api = {
        LIMITS,
        async list(owner) {
            requireOwner(owner); await init();
            const [logins, sites] = await Promise.all([
                all('SELECT * FROM vault_logins WHERE owner = ? ORDER BY origin, username', [owner]),
                all('SELECT origin FROM vault_sites WHERE owner = ? AND never_save = 1 ORDER BY origin', [owner])
            ]);
            return { entries: logins.map(publicEntry), neverSave: sites.map(row => row.origin) };
        },
        /** 新增或按「站点 + 用户名」更新。返回 { entry, created }。 */
        async save(owner, { url, origin, username, password, label } = {}) {
            requireOwner(owner); await init();
            const site = originOf(origin || url);
            if (!site) throw vaultError('VAULT_INVALID', '请填写 http(s) 网址');
            checkFields({ username, password, label });
            const name = username.trim(), now = Date.now();
            const existing = await get('SELECT id FROM vault_logins WHERE owner = ? AND origin = ? AND username = ?', [owner, site, name]);
            if (existing) {
                await run(`UPDATE vault_logins SET secret = ?, updated_at = ?${label === undefined ? '' : ', label = ?'} WHERE id = ? AND owner = ?`,
                    [seal(owner, site, name, password), now, ...(label === undefined ? [] : [label.trim()]), existing.id, owner]);
            } else {
                const count = await get('SELECT COUNT(*) AS total FROM vault_logins WHERE owner = ?', [owner]);
                if (count.total >= LIMITS.entriesPerOwner) throw vaultError('VAULT_LIMIT', `保险箱最多保存 ${LIMITS.entriesPerOwner} 条`);
                await run('INSERT INTO vault_logins (id, owner, origin, username, secret, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [crypto.randomUUID(), owner, site, name, seal(owner, site, name, password), String(label || '').trim(), now, now]);
            }
            const row = await get('SELECT * FROM vault_logins WHERE owner = ? AND origin = ? AND username = ?', [owner, site, name]);
            return { entry: publicEntry(row), created: !existing };
        },
        async update(owner, id, changes = {}) {
            requireOwner(owner); await init();
            const row = await get('SELECT * FROM vault_logins WHERE id = ? AND owner = ?', [String(id || ''), owner]);
            if (!row) throw vaultError('VAULT_NOT_FOUND', '条目不存在', 404);
            checkFields(changes, { partial: true });
            const username = changes.username === undefined ? row.username : changes.username.trim();
            // 用户名参与密文绑定：改用户名或密码都要重新加密
            let secret = row.secret;
            if (changes.password !== undefined || username !== row.username) {
                secret = seal(owner, row.origin, username, changes.password === undefined ? open(owner, row.origin, row.username, row.secret) : changes.password);
            }
            if (username !== row.username && await get('SELECT 1 FROM vault_logins WHERE owner = ? AND origin = ? AND username = ? AND id <> ?', [owner, row.origin, username, row.id])) {
                throw vaultError('VAULT_DUPLICATE', '这个站点已经保存了同名账号');
            }
            await run('UPDATE vault_logins SET username = ?, secret = ?, label = ?, auto_fill = ?, auto_submit = ?, updated_at = ? WHERE id = ? AND owner = ?', [
                username, secret, changes.label === undefined ? row.label : changes.label.trim(),
                Number(changes.autoFill === undefined ? row.auto_fill : !!changes.autoFill), Number(changes.autoSubmit === undefined ? row.auto_submit : !!changes.autoSubmit),
                Date.now(), row.id, owner]);
            return publicEntry(await get('SELECT * FROM vault_logins WHERE id = ? AND owner = ?', [row.id, owner]));
        },
        async remove(owner, id) {
            requireOwner(owner); await init();
            const result = await run('DELETE FROM vault_logins WHERE id = ? AND owner = ?', [String(id || ''), owner]);
            if (!result.changes) throw vaultError('VAULT_NOT_FOUND', '条目不存在', 404);
        },
        /** 本人查看明文密码（调用方负责先核对平台登录密码）。 */
        async reveal(owner, id) {
            requireOwner(owner); await init();
            const row = await get('SELECT * FROM vault_logins WHERE id = ? AND owner = ?', [String(id || ''), owner]);
            if (!row) throw vaultError('VAULT_NOT_FOUND', '条目不存在', 404);
            return open(owner, row.origin, row.username, row.secret);
        },
        /** 当前站点可用的账号（不含密码），最近用过的排前面。 */
        async find(owner, url) {
            const site = originOf(url);
            if (!owner || !site) return [];
            await init();
            return (await all('SELECT * FROM vault_logins WHERE owner = ? AND origin = ? ORDER BY last_used_at DESC, updated_at DESC', [owner, site])).map(publicEntry);
        },
        /** 取出要填进网页的凭据。只给浏览器注入用，返回值不得进日志、事件或模型上下文。 */
        async credentials(owner, url, { username, id } = {}) {
            const site = originOf(url);
            if (!owner || !site) return null;
            await init();
            const rows = await all('SELECT * FROM vault_logins WHERE owner = ? AND origin = ? ORDER BY last_used_at DESC, updated_at DESC', [owner, site]);
            const row = id ? rows.find(item => item.id === id) : username ? rows.find(item => item.username === username) : rows[0];
            if (!row) return null;
            const password = open(owner, row.origin, row.username, row.secret);
            await run('UPDATE vault_logins SET last_used_at = ?, use_count = use_count + 1 WHERE id = ? AND owner = ?', [Date.now(), row.id, owner]);
            return { id: row.id, origin: row.origin, username: row.username, password, autoFill: !!row.auto_fill, autoSubmit: !!row.auto_submit };
        },
        async neverSave(owner, url) {
            const site = originOf(url);
            if (!owner || !site) return false;
            await init();
            return !!(await get('SELECT 1 FROM vault_sites WHERE owner = ? AND origin = ? AND never_save = 1', [owner, site]));
        },
        async setNeverSave(owner, url, never) {
            requireOwner(owner); await init();
            const site = originOf(url);
            if (!site) throw vaultError('VAULT_INVALID', '请填写 http(s) 网址');
            await run('INSERT INTO vault_sites (owner, origin, never_save) VALUES (?, ?, ?) ON CONFLICT(owner, origin) DO UPDATE SET never_save = excluded.never_save', [owner, site, Number(!!never)]);
        },
        /** 同一站点 5 分钟内只自动提交一次：密码错了不会反复提交把账号锁掉。 */
        claimAutoSubmit(owner, url) {
            const site = originOf(url);
            if (!owner || !site) return false;
            const key = `${owner}\n${site}`, last = autoSubmitAt.get(key) || 0;
            if (Date.now() - last < AUTO_SUBMIT_COOLDOWN_MS) return false;
            autoSubmitAt.set(key, Date.now());
            return true;
        },
        async close() {
            if (!db) return;
            await Promise.resolve(ready).catch(() => {});
            await new Promise(resolve => db.close(() => resolve()));
            db = null; ready = null; masterKey = null;
        }
    };
    return api;
}

let shared = null;
/** 平台共用的保险箱实例（数据目录下的 vault/）。 */
function vault() { return shared ||= createVault(); }

/** 用户名打码后给界面提示和模型看：能认出是哪个账号，但不整段暴露。 */
function maskUsername(value) {
    const text = String(value || '');
    if (text.length <= 2) return `${text.slice(0, 1)}*`;
    const at = text.indexOf('@');
    if (at > 1) return `${text.slice(0, 2)}***${text.slice(at)}`;
    return `${text.slice(0, 2)}***${text.length > 5 ? text.slice(-1) : ''}`;
}

module.exports = { createVault, vault, ownerOf, originOf, maskUsername, vaultError, LIMITS };
