'use strict';
const crypto = require('node:crypto');
const { run, get } = require('./app-db');
const usersRepo = require('./auth-users-repository');
const tenants = require('./tenants-repository');
const { getTenantId } = require('./tenant-context');
const pbkdf2 = require('node:util').promisify(crypto.pbkdf2);
const ITERATIONS = 210000;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

async function ready() {
    await run(`CREATE TABLE IF NOT EXISTS snapshot_portal_keys (
        id TEXT PRIMARY KEY, revision TEXT NOT NULL UNIQUE, key_hex TEXT NOT NULL,
        accounts_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
}

function seal(bytes, key, iv = crypto.randomBytes(12)) {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
    return { iv: iv.toString('base64'), ciphertext };
}

function open(bytes, key, iv) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(bytes.subarray(-16));
    return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
}

async function getSecurity() {
    await ready();
    const { items } = await usersRepo.listUsers();
    const allowed = [];
    for (const [username, user] of Object.entries(items).sort(([a], [b]) => a.localeCompare(b))) {
        if (user.role === 'admin' || await tenants.canAccess(username, user.role, getTenantId())) {
            allowed.push({ username, role: user.role, passwordHash: user.passwordHash });
        }
    }
    if (!allowed.length) throw Object.assign(new Error('当前租户没有可用于静态站点登录的账号'), { status: 400 });
    const revision = digest(JSON.stringify(allowed));
    let row = await get('SELECT * FROM snapshot_portal_keys WHERE revision = ?', [revision]);
    if (!row) {
        const key = crypto.randomBytes(32), id = crypto.randomUUID();
        const accounts = [];
        for (const user of allowed) {
            const salt = crypto.randomBytes(24);
            // 使用独立 PBKDF2 密钥包装站点密钥；从不导出平台密码、原始密码哈希或 Session。
            const wrapKey = await pbkdf2(user.passwordHash, salt, ITERATIONS, 32, 'sha256');
            const wrapped = seal(Buffer.from(JSON.stringify({ key: key.toString('base64'), username: user.username, role: user.role })), wrapKey);
            accounts.push({ id: digest(user.username), salt: salt.toString('base64'), iv: wrapped.iv, wrapped: wrapped.ciphertext.toString('base64') });
        }
        await run('INSERT OR IGNORE INTO snapshot_portal_keys (id,revision,key_hex,accounts_json) VALUES (?,?,?,?)', [id, revision, key.toString('hex'), JSON.stringify(accounts)]);
        row = await get('SELECT * FROM snapshot_portal_keys WHERE revision = ?', [revision]);
    }
    return { id: row.id, key: Buffer.from(row.key_hex, 'hex'), public: { keyId: row.id, iterations: ITERATIONS, accounts: JSON.parse(row.accounts_json) } };
}

async function getKey(id) {
    await ready();
    const row = await get('SELECT key_hex FROM snapshot_portal_keys WHERE id = ?', [id]);
    if (!row) throw Object.assign(new Error('无法读取旧静态站点密钥，请在原租户恢复发布配置后重试'), { status: 400 });
    return Buffer.from(row.key_hex, 'hex');
}

module.exports = { getSecurity, getKey, seal, open, digest };
