const crypto = require('crypto');
const authSessionsRepo = require('../models/auth-sessions-repository');

const SALT = 'tools_platform_salt';

async function tryTempTerminalAuth(req) {
    if (!req.path.startsWith('/terminal') || req.path === '/terminal/loopback') return false;
    try {
        const tempToolTokens = require('../models/temp-tool-tokens-repository');
        const tempRaw = tempToolTokens.extractTempTokenFromCookie(req.headers.cookie);
        const record = tempRaw ? await tempToolTokens.verifyToken(tempRaw, { requireTerminal: true, touch: false }) : null;
        if (!record) return false;
        req.user = {
            username: `temp:${record.slug}:${record.id.slice(0, 8)}`,
            role: 'admin',
            tenantId: record.sourceTenant,
            homeTenantId: record.sourceTenant,
            isSuper: false,
            tempToolToken: record
        };
        return true;
    } catch (tempErr) {
        console.error('Temp tool token auth error:', tempErr);
        return false;
    }
}

async function checkAuth(req, res, next) {
    // 登录接口无需鉴权 (req.path is relative to /api, so it's /auth/login)
    if (req.path === '/auth/login') return next();
    if (req.method === 'GET' && /^\/uiv\/uivision-runner\/[a-f0-9]{32}$/.test(req.path)) return next();
    if (req.method === 'GET' && req.path === '/platform-logo/status') return next();

    const authHeader = req.headers.authorization;
    const cookieToken = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('tools_token='))?.slice('tools_token='.length);
    // 只认 Authorization 头与 HttpOnly Cookie：查询串里的令牌会进访问日志、浏览历史和 Referer
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : cookieToken;
    if (!token) {
        if (await tryTempTerminalAuth(req)) return next();
        return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
    }

    try {
        const session = await authSessionsRepo.getSession(token);

        if (!session || session.expiresAt < Date.now()) {
            if (session) {
                await authSessionsRepo.deleteSession(token);
            }
            if (await tryTempTerminalAuth(req)) return next();
            return res.status(401).json({ error: '登录已过期，请重新登录', code: 'AUTH_EXPIRED' });
        }

        req.user = session.user; // { username, role, tenantId, homeTenantId, isSuper }
        req.authToken = token;
        next();
    } catch (err) {
        if (err && err.code === 'SQLITE_MISUSE') {
            console.warn('[AUTH] SQLite connection is closed, most likely because a global restore just completed. Please restart the service.');
            return res.status(503).json({ error: '数据恢复已完成，服务正在重启或需要手动重启。请稍后刷新页面。' });
        }
        console.error('Auth check error:', err);
        return res.status(500).json({ error: '服务器鉴权异常' });
    }
}

// 超级管理员：平台级设置、增删账号、托管应用、静态推送等全局能力
function isSuperAdmin(user) {
    return Boolean(user && user.role === 'admin' && user.isSuper);
}

// 平台级功能（托管应用、频道、MCP、品牌等）：超级管理员，或身处默认空间（超级管理员自己的空间）的管理员。
// 团队账号永远处在自己的团队里，所以拿不到；超级管理员进入团队排障时仍可用。
// 是否身处超级管理员空间：超级管理员本人（含进入团队排障时），或默认空间里的会话。不看角色——空间内原有的角色规则照旧。
function inSuperAdminSpace(user, tenantId) {
    if (!user) return false;
    if (user.isSuper) return true;
    const tenant = require('../models/tenant-context');
    return tenant.normalizeTenantId(tenantId || user.tenantId || tenant.getTenantId()) === tenant.DEFAULT_TENANT_ID;
}

function isPlatformAdmin(user, tenantId) {
    return Boolean(user && user.role === 'admin' && inSuperAdminSpace(user, tenantId));
}

function requirePlatformAdmin(req, res, next) {
    if (isPlatformAdmin(req.user)) return next();
    res.status(403).json({ error: '该功能仅超级管理员可用', code: 'SUPER_ADMIN_REQUIRED' });
}

function requireSuperAdmin(req, res, next) {
    if (isSuperAdmin(req.user)) return next();
    res.status(403).json({ error: '权限不足，需要超级管理员账号', code: 'SUPER_ADMIN_REQUIRED' });
}

async function hasCurrentSuperAdminAccount(user) {
    if (!isSuperAdmin(user)) return false;
    // 访问敏感数据时，不能用会话兼容角色代替当前账号记录。
    const account = await require('../models/auth-users-repository').getUser(user.username);
    return isSuperAdmin(account);
}

async function requireCurrentSuperAdmin(req, res, next) {
    try {
        if (await hasCurrentSuperAdminAccount(req.user)) return next();
        res.status(403).json({ code: 'SUPER_ADMIN_REQUIRED', error: '该功能仅超级管理员可用' });
    } catch (error) {
        next(error);
    }
}

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: '权限不足，需要超级管理员账号' });
    }
}

// 共享对话链接 /?share=<token>：未登录跳登录页时带上令牌，登录后回到首页自动打开邀请（login.html 记下它）
function loginRedirect(req) {
    const share = typeof req.query?.share === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(req.query.share) ? req.query.share : '';
    if (share) return `/login.html?share=${share}`;
    // 内网直连共享链接（别人电脑上的落地页带过来的）：登录后自动加入
    const lanjoin = typeof req.query?.lanjoin === 'string' && req.query.lanjoin.length < 400 && /^http:\/\/[\w.-]+(?::\d+)?\/lan-share\/[\w-]{4,80}\?t=[\w-]{8,80}$/.test(req.query.lanjoin) ? req.query.lanjoin : '';
    return lanjoin ? `/login.html?lanjoin=${encodeURIComponent(lanjoin)}` : '/login.html';
}

function redirectHtmlLogin(req, res) {
    return res.redirect(loginRedirect(req));
}

async function checkHtmlAuth(req, res, next, onGuest = redirectHtmlLogin) {
    let token = null;
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        const cookies = cookieHeader.split(';');
        for (let c of cookies) {
            const [k, v] = c.trim().split('=');
            if (k === 'tools_token') {
                token = v;
                break;
            }
        }
    }

    if (!token) return onGuest(req, res);

    try {
        const session = await authSessionsRepo.getSession(token);
        if (!session || session.expiresAt < Date.now()) {
            if (session) await authSessionsRepo.deleteSession(token);
            return onGuest(req, res);
        }
        req.user = session.user;
        const { runWithTenant } = require('../models/tenant-context');
        runWithTenant(session.user.tenantId, next);
    } catch (err) {
        console.error('HTML Auth check error:', err);
        return onGuest(req, res);
    }
}

// 旧算法（sha256 + 固定盐）：静态快照门户的口令派生仍在用，账号密码不要再用它
function hashPassword(password) {
    return crypto.createHash('sha256').update(password + SALT).digest('hex');
}

// 账号密码：scrypt + 每账号随机盐，格式 scrypt$N$r$p$salt$hash
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
function hashUserPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

function isLegacyPasswordHash(stored) {
    return !String(stored || '').startsWith('scrypt$');
}

/** 校验账号密码；兼容旧 sha256 哈希（登录成功后由调用方升级成 scrypt） */
function verifyUserPassword(password, stored) {
    const value = String(stored || '');
    if (!value || typeof password !== 'string') return false;
    if (isLegacyPasswordHash(value)) {
        const legacy = Buffer.from(hashPassword(password));
        const expected = Buffer.from(value);
        return legacy.length === expected.length && crypto.timingSafeEqual(legacy, expected);
    }
    const [, N, r, p, saltB64, hashB64] = value.split('$');
    const expected = Buffer.from(hashB64 || '', 'base64');
    if (!expected.length) return false;
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
    checkAuth,
    requireAdmin,
    checkHtmlAuth,
    redirectHtmlLogin,
    hashPassword,
    hashUserPassword,
    hasCurrentSuperAdminAccount,
    isLegacyPasswordHash,
    inSuperAdminSpace,
    isPlatformAdmin,
    isSuperAdmin,
    requirePlatformAdmin,
    requireCurrentSuperAdmin,
    requireSuperAdmin,
    verifyUserPassword
};
