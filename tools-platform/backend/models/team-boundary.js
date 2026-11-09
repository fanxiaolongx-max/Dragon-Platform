// 团队边界：一个账号 = 一个团队。除超级管理员（及其默认团队）外，AI 对话、终端、文件预览只能在
// 本团队的用户空间里活动——workspace（可选的工作目录根）与 tmp（未选目录时的临时空间）。
const fs = require('fs');
const path = require('path');
const tenant = require('./tenant-context');

function boundaryError(message, code = 'TEAM_BOUNDARY') {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 403;
    error.status = 403;
    return error;
}

/** 该用户在该团队里是否受限：默认团队是超级管理员的空间；超级管理员进入其他团队排障也不受限 */
function isConfined(user, tenantId = tenant.getTenantId()) {
    if (user && user.role === 'admin' && user.isSuper) return false;
    return tenant.normalizeTenantId(tenantId) !== tenant.DEFAULT_TENANT_ID;
}

function realOrResolved(dir) {
    try { return fs.realpathSync(dir); } catch (_error) { return path.resolve(dir); }
}

/** 受限账号可用的根目录（已建好、取真实路径） */
function allowedRoots(tenantId = tenant.getTenantId()) {
    const dirs = tenant.ensureUserSpaceDirs(tenantId);
    return [dirs.workspace, dirs.tmp].map(realOrResolved);
}

function workspaceRoot(tenantId = tenant.getTenantId()) {
    return realOrResolved(tenant.ensureUserSpaceDirs(tenantId).workspace);
}

function isInside(root, target) {
    const rel = path.relative(root, target);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** target 的真实路径（不存在时取最深已存在祖先的真实路径再拼回，防 symlink 逃逸） */
function realTarget(target) {
    let current = path.resolve(target);
    const tail = [];
    while (true) {
        try { return path.join(fs.realpathSync(current), ...tail.reverse()); } catch (_error) { /* 继续向上 */ }
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(target);
        tail.push(path.basename(current));
        current = parent;
    }
}

function isAllowedPath(tenantId, target) {
    const real = realTarget(target);
    return allowedRoots(tenantId).some(root => isInside(root, real));
}

/** 受限账号访问 target 前调用；越界抛 403 */
function assertAllowed(user, tenantId, target, what = '该目录') {
    if (!isConfined(user, tenantId)) return;
    if (!target || !isAllowedPath(tenantId, target)) throw boundaryError(`${what}不在你的团队空间内，只能使用团队工作目录下的文件夹`);
}

/** 把用户输入的目录解析成绝对路径：受限账号的 ~ 与相对路径都以团队工作目录为基准 */
function resolveUserPath(user, tenantId, input) {
    const text = String(input || '').trim();
    if (!isConfined(user, tenantId)) return text;
    const base = workspaceRoot(tenantId);
    if (!text || text === '~') return base;
    if (text.startsWith('~/') || text.startsWith('~\\')) return path.join(base, text.slice(2));
    return path.isAbsolute(text) ? text : path.join(base, text);
}

module.exports = { allowedRoots, assertAllowed, boundaryError, isAllowedPath, isConfined, isInside, realTarget, resolveUserPath, workspaceRoot };
