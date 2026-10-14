// Dragon Claw 工作区门禁：读写的是后端所在机器的磁盘，所以只对
//   - 回环地址请求（桌面版 / 本机 localhost），或
//   - 管理员
// 开放。使用真实 peer 地址（不信任 X-Forwarded-For）；带 Origin 时要求同源。
// 同机反向代理会让所有请求看起来像回环，可用 TOOLS_AGENT_WORKSPACE=admin-only 收紧。
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function isLoopbackRequest(req) {
    return LOOPBACK.has(String(req.socket?.remoteAddress || ''));
}

function originMatches(req) {
    if (!req.headers?.origin) return true;
    try {
        const origin = new URL(req.headers.origin);
        return origin.host === req.headers.host;
    } catch (_error) {
        return false;
    }
}

/** @returns {{ enabled: boolean, reason: string }} */
function evaluate(req) {
    if (!req.user) return { enabled: false, reason: 'AUTH_REQUIRED' };
    if (!originMatches(req)) return { enabled: false, reason: 'ORIGIN_MISMATCH' };
    const adminOnly = String(process.env.TOOLS_AGENT_WORKSPACE || '').toLowerCase() === 'admin-only';
    const isAdmin = req.user.role === 'admin';
    if (adminOnly) return isAdmin ? { enabled: true, reason: 'ADMIN' } : { enabled: false, reason: 'ADMIN_ONLY' };
    if (isLoopbackRequest(req)) return { enabled: true, reason: process.env.TOOLS_DESKTOP_RUNTIME === '1' ? 'DESKTOP' : 'LOOPBACK' };
    if (isAdmin) return { enabled: true, reason: 'ADMIN' };
    return { enabled: false, reason: 'REMOTE_VIEWER' };
}

function isAgentWorkspaceAllowed(req) {
    return evaluate(req).enabled;
}

function middleware(req, res, next) {
    const verdict = evaluate(req);
    if (verdict.enabled) return next();
    if (verdict.reason === 'AUTH_REQUIRED') return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Login required' });
    return res.status(403).json({ code: 'AGENT_WORKSPACE_FORBIDDEN', reason: verdict.reason, error: '工作区功能仅对本机或管理员开放' });
}

module.exports = { evaluate, isAgentWorkspaceAllowed, isLoopbackRequest, middleware };
