const crypto = require('crypto');
const authSessionsRepo = require('../models/auth-sessions-repository');

const SALT = 'tools_platform_salt';

async function checkAuth(req, res, next) {
    // 登录接口无需鉴权 (req.path is relative to /api, so it's /auth/login)
    if (req.path === '/auth/login') return next();
    if (req.method === 'GET' && /^\/uiv\/uivision-runner\/[a-f0-9]{32}$/.test(req.path)) return next();
    if (req.method === 'GET' && req.path === '/platform-logo/status') return next();

    const authHeader = req.headers.authorization;
    const cookieToken = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('tools_token='))?.slice('tools_token='.length);
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : (cookieToken || req.query?.token);
    if (!token) {
        return res.status(401).json({ error: '请先登录', code: 'AUTH_REQUIRED' });
    }

    try {
        const session = await authSessionsRepo.getSession(token);

        if (!session || session.expiresAt < Date.now()) {
            if (session) {
                await authSessionsRepo.deleteSession(token);
            }
            return res.status(401).json({ error: '登录已过期，请重新登录', code: 'AUTH_EXPIRED' });
        }

        req.user = session.user; // { username, role }
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

function requireAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: '权限不足，需要超级管理员账号' });
    }
}

async function checkHtmlAuth(req, res, next) {
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

    if (!token) return res.redirect('/login.html');

    try {
        const session = await authSessionsRepo.getSession(token);
        if (!session || session.expiresAt < Date.now()) {
            if (session) await authSessionsRepo.deleteSession(token);
            return res.redirect('/login.html');
        }
        req.user = session.user;
        const { runWithTenant } = require('../models/tenant-context');
        runWithTenant(session.user.tenantId, next);
    } catch (err) {
        console.error('HTML Auth check error:', err);
        return res.redirect('/login.html');
    }
}

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + SALT).digest('hex');
}

module.exports = {
    checkAuth,
    requireAdmin,
    checkHtmlAuth,
    hashPassword
};
