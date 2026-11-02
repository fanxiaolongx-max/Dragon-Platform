/**
 * 首页首屏接口合并：一次 POST /api/home/bootstrap 取回对话区首屏需要的多个 GET 接口。
 *
 * 远程访问（Cloudflare 隧道）时每个请求都要回源一次，首屏 20 多个接口分好几波串行到达；
 * 这里在进程内把每个子请求交给 Express 完整处理一遍：沿用原请求的连接（来源 IP）与请求头，
 * 鉴权、租户、本机判断、日志都和单独请求时一致。只放行白名单里的 GET 路径，不做回环 HTTP 请求。
 */
const http = require('http');

// 只允许首页首屏用到的只读接口（按路径匹配，查询参数照常传给子请求）
const ALLOWED_PATHS = new Set([
    '/api/app-version',
    '/api/asset-version',
    '/api/tenants',
    '/api/migration-status',
    '/api/platform-promotions',
    '/api/platform-promotions/desktop',
    '/api/nav-settings',
    '/api/auth/me',
    '/api/custom-tools',
    '/api/custom-tools/f12-to-extension/scripts',
    '/api/alert-center/summary',
    '/api/builtin-promotion/status',
    '/api/home/capabilities',
    '/api/agent-skills',
    '/api/agent-workspace/capability',
    '/api/agent-workspace/prefs',
    '/api/ai/conversation-list',
    '/api/ai/sessions',
    '/api/ai/schedules',
    '/api/ai/models',
    '/api/channels/available',
    '/api/channels/ops/pending',
    '/api/desktop-agents/settings',
    '/api/desktop-agents/sessions',
    '/api/desktop-license/status',
    '/api/recent-nav',
    '/api/favorite-nav',
    '/api/onboarding/defaults/status'
]);
const MAX_PATHS = 40;
const SUB_REQUEST_TIMEOUT_MS = 10000;
// 子请求不继承这些头：避免 304 空响应、压缩编码和错误的请求体长度
const DROPPED_HEADERS = new Set(['content-length', 'content-type', 'transfer-encoding', 'if-none-match', 'if-modified-since', 'accept-encoding', 'connection', 'expect']);
// 子响应头原样带回（前端会读 X-Data-Source 等），但不转发 Cookie 和传输层相关的头
const HIDDEN_RESPONSE_HEADERS = new Set(['set-cookie', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function responseHeaders(res) {
    return Object.fromEntries(Object.entries(res.getHeaders())
        .filter(([key]) => !HIDDEN_RESPONSE_HEADERS.has(key))
        .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]));
}

function normalizePath(value) {
    if (typeof value !== 'string' || value.length > 600 || !value.startsWith('/api/')) return null;
    let url;
    try { url = new URL(value, 'http://bootstrap.local'); } catch { return null; }
    if (url.origin !== 'http://bootstrap.local' || !ALLOWED_PATHS.has(url.pathname)) return null;
    return url.pathname + url.search;
}

function runSubRequest(app, parentReq, path) {
    return new Promise(resolve => {
        const req = new http.IncomingMessage(parentReq.socket);
        req.method = 'GET';
        req.url = path;
        req.httpVersion = parentReq.httpVersion;
        req.headers = Object.fromEntries(Object.entries(parentReq.headers).filter(([key]) => !DROPPED_HEADERS.has(key)));
        req.push(null);

        const res = new http.ServerResponse(req);
        const chunks = [];
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const collect = (chunk, encoding) => {
            if (chunk == null || typeof chunk === 'function') return;
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : 'utf8'));
        };
        res.write = (chunk, encoding, callback) => {
            collect(chunk, encoding);
            const cb = typeof encoding === 'function' ? encoding : callback;
            if (cb) cb();
            return true;
        };
        res.end = (chunk, encoding, callback) => {
            collect(chunk, encoding);
            if (!res.headersSent) http.ServerResponse.prototype.writeHead.call(res, res.statusCode);
            res.finished = true;
            finish({ status: res.statusCode, headers: responseHeaders(res), body: Buffer.concat(chunks).toString('utf8') });
            res.emit('finish');
            const cb = [chunk, encoding, callback].find(item => typeof item === 'function');
            if (cb) cb();
            return res;
        };
        const timer = setTimeout(() => finish({ status: 504, headers: JSON_HEADERS, body: '{"error":"bootstrap sub-request timeout"}' }), SUB_REQUEST_TIMEOUT_MS);

        try {
            app.handle(req, res, error => {
                finish(error
                    ? { status: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'bootstrap sub-request failed' }) }
                    : { status: 404, headers: JSON_HEADERS, body: '{"error":"Not found"}' });
            });
        } catch (_error) {
            finish({ status: 500, headers: JSON_HEADERS, body: '{"error":"bootstrap sub-request failed"}' });
        }
    });
}

function createHomeBootstrapHandler(app) {
    return async (req, res) => {
        const requested = Array.isArray(req.body?.paths) ? req.body.paths.slice(0, MAX_PATHS) : [];
        const paths = [...new Set(requested.map(normalizePath).filter(Boolean))];
        res.setHeader('Cache-Control', 'no-store');
        const entries = await Promise.all(paths.map(async path => [path, await runSubRequest(app, req, path)]));
        res.json({ results: Object.fromEntries(entries) });
    };
}

module.exports = { createHomeBootstrapHandler, normalizePath, ALLOWED_PATHS };
