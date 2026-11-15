// 技能包目录：每个自定义技能的 SKILL.md 和附带文件（脚本、参考文档、数据）原样放在团队用户空间的
// home/.dragonclaw/skills/<id>/ 下，命令可以直接读取和执行。数据库里的技能内容是唯一来源，这个目录由它生成：
// 技能被加载时按内容指纹核对，不一致就整目录重建；技能删除时目录一并删除。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tenant = require('./tenant-context');

const MARK = '.skill-package.json';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const rootDir = tenantId => path.join(tenant.getHomeDir(tenantId), '.dragonclaw', 'skills');
function dirOf(id, tenantId) {
    const cleanId = String(id || '').toLowerCase();
    if (!ID_RE.test(cleanId)) throw new Error('技能标识无效');
    return path.join(rootDir(tenantId), cleanId);
}

/** 包内相对路径：不允许绝对路径、盘符、空段、. 和 .. */
function safeRelative(value) {
    const clean = String(value || '').replace(/\\/g, '/');
    if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return '';
    const parts = clean.split('/');
    return parts.some(part => !part || part === '.' || part === '..') ? '' : parts.join('/');
}

const isBinary = file => typeof file?.base64 === 'string';
const bytesOf = file => (isBinary(file) ? Buffer.from(file.base64, 'base64') : Buffer.from(String(file?.content ?? ''), 'utf8'));

function fingerprint(markdown, files) {
    const hash = crypto.createHash('sha256').update(String(markdown || ''));
    for (const file of files) hash.update('\0' + file.path + '\0').update(bytesOf(file));
    return hash.digest('hex');
}

/** 让目录与给定内容一致，返回目录路径；内容没变时不动硬盘 */
function sync(id, { markdown = '', files = [] } = {}, tenantId) {
    const dir = dirOf(id, tenantId);
    const list = (Array.isArray(files) ? files : []).map(file => ({ ...file, path: safeRelative(file?.path) }))
        .filter(file => file.path && file.path.toLowerCase() !== 'skill.md' && file.path !== MARK);
    const hash = fingerprint(markdown, list);
    try { if (JSON.parse(fs.readFileSync(path.join(dir, MARK), 'utf8')).hash === hash) return dir; } catch { /* 目录不存在或不完整：重建 */ }
    const staging = `${dir}.tmp-${process.pid}-${Date.now()}`;
    fs.rmSync(staging, { recursive: true, force: true });
    try {
        fs.mkdirSync(staging, { recursive: true });
        fs.writeFileSync(path.join(staging, 'SKILL.md'), String(markdown || ''), 'utf8');
        for (const file of list) {
            const target = path.join(staging, file.path);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const bytes = bytesOf(file);
            // scripts/ 下的文件和带 #! 的脚本可以直接执行
            const runnable = /^scripts\//i.test(file.path) || bytes.subarray(0, 2).toString() === '#!';
            fs.writeFileSync(target, bytes, { mode: runnable ? 0o755 : 0o644 });
        }
        fs.writeFileSync(path.join(staging, MARK), JSON.stringify({ id: String(id).toLowerCase(), hash, files: list.length, syncedAt: new Date().toISOString() }), 'utf8');
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(staging, dir);
    } catch (error) {
        fs.rmSync(staging, { recursive: true, force: true });
        throw error;
    }
    return dir;
}

/** 技能删除（或恢复为内置）时清掉它的目录 */
function remove(id, tenantId) {
    try { fs.rmSync(dirOf(id, tenantId), { recursive: true, force: true }); } catch { /* 标识无效或目录不存在 */ }
}

/** 给界面和接口用：二进制文件不带内容，只给大小 */
function publicFiles(files) {
    return (Array.isArray(files) ? files : []).map(file => (isBinary(file)
        ? { path: file.path, content: '', binary: true, size: bytesOf(file).length }
        : { path: file.path, content: String(file.content ?? ''), size: Buffer.byteLength(String(file.content ?? '')) }));
}

module.exports = { MARK, rootDir, dirOf, safeRelative, isBinary, bytesOf, sync, remove, publicFiles };
