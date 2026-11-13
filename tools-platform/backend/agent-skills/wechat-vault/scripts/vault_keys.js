#!/usr/bin/env node
// 微信本地数据库密钥 ⇄ Dragon 平台保险箱（backend/models/password-vault.js）。
//
// 存储约定（每个数据库一条，复用保险箱「站点 + 用户名 + 密码」模型）：
//   归属 owner : 平台登录账号，默认 admin（环境变量 DRAGON_VAULT_OWNER 可改）
//   站点 origin: https://wechat-db.local        （虚拟站点，浏览器永远不会访问，且关闭自动填充/提交）
//   用户名     : <wxid>/<数据库相对路径>，例如 anshanfan_1f9b/message/message_0.db
//   密码       : 64 位十六进制 SQLCipher 原始密钥
//   备注 label : 微信库密钥 <相对路径>
//
// 子命令：
//   list                       只列条目名，不输出密钥
//   import [--from FILE]       从 wechat-keys.json 导入/更新（默认 ~/.config/wechat-keys.json）
//   verify [--against FILE]    逐条读回并与文件比对，只输出比对结果
//   export                     把 {相对路径: 密钥} JSON 打到 stdout —— 仅供管道给解密进程，禁止重定向到日志或发给模型
//   export-file --out FILE     还原成 wechat-keys.json 格式（权限 600），用于重建 ~/.config/wechat-keys.json
//   image-save                 从 stdin 读 {"aes":"16位","xor":0-255}，存为 <wxid>/image_aes 与 <wxid>/image_xor 两条（图片 .dat 密钥）
//   image-export               把 {"aes":..,"xor":..} 打到 stdout —— 仅供管道给 wv_media.py，禁止给模型/日志
//   image-status               只显示图片密钥条目是否存在、更新时间
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND = path.resolve(__dirname, '../../..');
const { createVault } = require(path.join(BACKEND, 'models/password-vault'));

const ORIGIN = 'https://wechat-db.local';
const OWNER = process.env.DRAGON_VAULT_OWNER || 'admin';
const VAULT_DIR = path.join(path.resolve(process.env.TOOLS_DATA_DIR || path.join(BACKEND, 'data')), 'vault');
const CONFIG_FILE = path.join(os.homedir(), '.config/wechat-local-vault.json');
const KEYS_FILE = path.join(os.homedir(), '.config/wechat-keys.json');
const ALIAS_TO_REL = {
    message_0: 'message/message_0.db', message_1: 'message/message_1.db', message_2: 'message/message_2.db',
    message_3: 'message/message_3.db', message_fts: 'message/message_fts.db', message_resource: 'message/message_resource.db',
    contact: 'contact/contact.db', session: 'session/session.db', sns: 'sns/sns.db', favorite: 'favorite/favorite.db'
};

function wxid() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).wxid || 'default'; } catch (_e) { return 'default'; }
}
function relOf(name) {
    if (name.startsWith('__')) return null;
    if (ALIAS_TO_REL[name]) return ALIAS_TO_REL[name];
    return name.endsWith('.db') && name.includes('/') ? name : null;
}
function readKeysFile(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = {};
    for (const [name, key] of Object.entries(raw)) {
        const rel = relOf(name);
        if (!rel || typeof key !== 'string') continue;
        if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error(`密钥格式不对: ${rel}`);
        out[rel] = key.toLowerCase();
    }
    return out;
}
function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function vaultEntries(vault, account) {
    const prefix = `${account}/`;
    const { entries } = await vault.list(OWNER);
    return entries.filter(e => e.origin === ORIGIN && e.username.startsWith(prefix));
}
const IMAGE_NAMES = ['image_aes', 'image_xor'];
async function readAll(vault) {
    const account = wxid(), out = {};
    for (const entry of await vaultEntries(vault, account)) {
        if (!entry.username.endsWith('.db')) continue; // 只要数据库密钥；image_aes/image_xor 另走 image-export
        out[entry.username.slice(account.length + 1)] = await vault.reveal(OWNER, entry.id);
    }
    return out;
}

async function main() {
    const cmd = process.argv[2] || 'list';
    const vault = createVault({ directory: VAULT_DIR, protector: () => null });
    try {
        if (cmd === 'list') {
            const account = wxid();
            const entries = await vaultEntries(vault, account);
            console.log(JSON.stringify({ owner: OWNER, origin: ORIGIN, account, count: entries.length,
                entries: entries.map(e => ({ username: e.username, label: e.label, updatedAt: new Date(e.updatedAt).toISOString() })) }, null, 2));
        } else if (cmd === 'import') {
            const keys = readKeysFile(arg('--from', KEYS_FILE)), account = wxid();
            let created = 0, updated = 0;
            for (const [rel, key] of Object.entries(keys)) {
                const res = await vault.save(OWNER, { origin: ORIGIN, username: `${account}/${rel}`, password: key, label: `微信库密钥 ${rel}` });
                await vault.update(OWNER, res.entry.id, { autoFill: false, autoSubmit: false });
                res.created ? created++ : updated++;
            }
            console.log(JSON.stringify({ imported: Object.keys(keys).length, created, updated, owner: OWNER, origin: ORIGIN, account }));
        } else if (cmd === 'verify') {
            const file = readKeysFile(arg('--against', KEYS_FILE)), stored = await readAll(vault);
            const missing = Object.keys(file).filter(rel => !(rel in stored));
            const mismatch = Object.keys(file).filter(rel => rel in stored && stored[rel] !== file[rel]);
            const extra = Object.keys(stored).filter(rel => !(rel in file));
            const ok = !missing.length && !mismatch.length;
            console.log(JSON.stringify({ ok, file: Object.keys(file).length, vault: Object.keys(stored).length, missing, mismatch, extra }));
            process.exitCode = ok ? 0 : 1;
        } else if (cmd === 'export') {
            const stored = await readAll(vault);
            if (!Object.keys(stored).length) { console.error('保险箱里没有微信密钥'); process.exitCode = 3; return; }
            process.stdout.write(JSON.stringify(stored));
        } else if (cmd === 'export-file') {
            const out = arg('--out');
            if (!out) throw new Error('需要 --out FILE');
            const stored = await readAll(vault);
            fs.writeFileSync(out, JSON.stringify(stored, null, 2), { mode: 0o600 });
            fs.chmodSync(out, 0o600);
            console.log(JSON.stringify({ written: out, count: Object.keys(stored).length }));
        } else if (cmd === 'image-save') {
            const input = JSON.parse(fs.readFileSync(0, 'utf8'));
            const aes = String(input.aes || ''), xor = Number(input.xor);
            if (!/^[0-9a-zA-Z]{16}$/.test(aes) || !Number.isInteger(xor) || xor < 0 || xor > 255) throw new Error('图片密钥格式不对');
            const account = wxid(), res = {};
            for (const [name, value, label] of [['image_aes', aes, '微信图片 .dat AES-128 密钥（V2，16 字符）'], ['image_xor', String(xor), '微信图片 .dat XOR 字节（十进制）']]) {
                const r = await vault.save(OWNER, { origin: ORIGIN, username: `${account}/${name}`, password: value, label });
                await vault.update(OWNER, r.entry.id, { autoFill: false, autoSubmit: false });
                res[name] = r.created ? 'created' : 'updated';
            }
            console.log(JSON.stringify({ ok: true, owner: OWNER, origin: ORIGIN, account, ...res }));
        } else if (cmd === 'image-export' || cmd === 'image-status') {
            const account = wxid(), found = {}, meta = {};
            for (const entry of await vaultEntries(vault, account)) {
                const name = entry.username.slice(account.length + 1);
                if (!IMAGE_NAMES.includes(name)) continue;
                meta[name] = new Date(entry.updatedAt).toISOString();
                if (cmd === 'image-export') found[name] = await vault.reveal(OWNER, entry.id);
            }
            if (cmd === 'image-status') { console.log(JSON.stringify({ account, origin: ORIGIN, entries: meta })); return; }
            if (!found.image_aes || found.image_xor === undefined) { console.error('保险箱里没有图片密钥'); process.exitCode = 3; return; }
            process.stdout.write(JSON.stringify({ aes: found.image_aes, xor: Number(found.image_xor) }));
        } else {
            console.error('用法: vault_keys.js list|import|verify|export|export-file|image-save|image-export|image-status');
            process.exitCode = 2;
        }
    } finally {
        await vault.close();
    }
}
main().catch(error => { console.error('[wechat-vault keys]', error.code || '', error.message); process.exit(1); });
