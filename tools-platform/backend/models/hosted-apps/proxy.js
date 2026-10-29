// 托管应用反向代理：/apps/<slug>/~<访问令牌>/...
// 安全边界：
// - 访问令牌由平台为已登录用户签发（绑定租户、应用、用户、过期时间），应用后端只能经此入口访问；端口只监听 127.0.0.1。
// - 转发前去掉平台 Cookie、Authorization、Origin/Referer 与转发头，只传签名的当前用户信息；应用拿不到用户的平台会话。
// - 应用响应去掉 Set-Cookie、Clear-Site-Data、HSTS 等可能影响平台的头，并加 CSP sandbox：应用页面成为独立来源，
//   读不到平台 Cookie，也不能带登录态调用平台 API。localStorage 由注入的兼容脚本改为按「应用 + 用户」保存在平台服务端。
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const tenant = require('../tenant-context');
const runtime = require('./runtime');

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const MAX_HTML_BYTES = 10 * 1024 * 1024;
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';
const PATH_RE = /^\/([a-z0-9][a-z0-9-]{0,79})(?:\/~([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+))?(\/[^?#]*)?$/;
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate']);
const DROP_REQUEST = new Set(['host', 'cookie', 'authorization', 'origin', 'referer', 'forwarded', 'x-real-ip', 'true-client-ip', 'accept-encoding', 'content-length']);
const DROP_RESPONSE = new Set(['set-cookie', 'set-cookie2', 'clear-site-data', 'strict-transport-security', 'x-frame-options', 'server', 'x-powered-by',
    'content-length', 'public-key-pins', 'expect-ct', 'report-to', 'nel', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'refresh']);

// 不复用上游连接：应用异常后 uvicorn 会关闭连接，复用失效的长连接会让下一个请求变成 502
const upstreamAgent = new http.Agent({ keepAlive: false });
let signingKey = null;
function key() {
    if (signingKey) return signingKey;
    const file = path.join(tenant.BASE_DATA_DIR, 'hosted-apps-proxy.key');
    try {
        signingKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
        if (signingKey.length >= 32) return signingKey;
    } catch (_error) { /* 首次生成 */ }
    signingKey = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, signingKey.toString('base64'), { mode: 0o600 });
    return signingKey;
}

const sign = payload => crypto.createHmac('sha256', key()).update(payload).digest('base64url').slice(0, 32);

/** 签发访问令牌：只有经过平台登录校验的接口调用。 */
function issueToken({ tenantId, slug, username, role }, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ t: tenantId, s: slug, u: username, r: role, e: Math.floor(now / 1000) + TOKEN_TTL_SECONDS })).toString('base64url');
    return { token: `${payload}.${sign(payload)}`, expiresAt: new Date(now + TOKEN_TTL_SECONDS * 1000).toISOString() };
}

function verifyToken(token, now = Date.now()) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return null;
    const expected = sign(payload);
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!claims || typeof claims.e !== 'number' || claims.e * 1000 < now) return null;
        return claims;
    } catch (_error) {
        return null;
    }
}

const entryUrl = (slug, token) => `/apps/${slug}/~${token}/`;

function sendPage(res, status, title, message) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', `${SANDBOX}; default-src 'none'; style-src 'unsafe-inline'`);
    const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
    res.end(`<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><body style="font:14px system-ui,sans-serif;padding:32px;color:#555"><h3 style="color:#333">${escape(title)}</h3><p>${escape(message)}</p></body>`);
}

function corsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
}

// 沙箱页面里 localStorage / sessionStorage / document.cookie 会抛 SecurityError；兼容脚本改为内存实现。
// localStorage 按「应用 + 用户」保存在平台服务端：页面加载时同步读取（多页面跳转、换设备都保留），变更合并后异步提交。
const SHIM = `(function () {
  var src = document.currentScript && document.currentScript.src || '';
  var base = src.slice(0, src.indexOf('/__platform/shim.js'));
  var seed = {};
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', base + '/__platform/storage', false);
    xhr.send();
    if (xhr.status === 200) seed = JSON.parse(xhr.responseText) || {};
  } catch (e) { seed = {}; }
  var queue = [], timer = null;
  function flush(beacon) {
    clearTimeout(timer); timer = null;
    if (!queue.length) return;
    var body = JSON.stringify({ ops: queue.splice(0) });
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(base + '/__platform/storage', new Blob([body], { type: 'text/plain' }));
      else fetch(base + '/__platform/storage', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true });
    } catch (e) {}
  }
  function post(op, key, value) { queue.push(op === 'set' ? [op, key, value] : [op, key]); if (!timer) timer = setTimeout(flush, 300); }
  addEventListener('pagehide', function () { flush(true); });
  function make(initial, persist) {
    var data = Object.create(null);
    Object.keys(initial || {}).forEach(function (k) { data[k] = String(initial[k]); });
    var api = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { k = String(k); v = String(v); data[k] = v; if (persist) post('set', k, v); },
      removeItem: function (k) { k = String(k); delete data[k]; if (persist) post('remove', k); },
      clear: function () { data = Object.create(null); if (persist) post('clear'); },
      key: function (i) { return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length; } });
    return api;
  }
  function install(name, storage) {
    try { window[name].getItem('__probe__'); return; } catch (e) {}
    try { Object.defineProperty(window, name, { configurable: true, value: storage }); } catch (e) {}
  }
  install('localStorage', make(seed, true));
  install('sessionStorage', make({}, false));
  try { void document.cookie; } catch (e) {
    try { Object.defineProperty(document, 'cookie', { configurable: true, get: function () { return ''; }, set: function () {} }); } catch (e2) {}
  }
})();`;

// ── 应用的浏览器存储（按应用 + 用户保存在应用目录）──────────────
const MAX_STORAGE_BYTES = 5 * 1024 * 1024;

function storageFile(slug, claims) {
    const user = crypto.createHash('sha256').update(`${claims.t}\n${claims.u}`).digest('hex').slice(0, 32);
    return path.join(runtime.paths(slug, claims.t).data, 'browser-storage', `${user}.json`);
}

function readStorage(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (_error) { return {}; }
}

function handleStorage(req, res, slug, claims) {
    const file = storageFile(slug, claims);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end(JSON.stringify(readStorage(file)));
    }
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_STORAGE_BYTES) { res.statusCode = 413; res.end(); req.destroy(); return; }
        chunks.push(chunk);
    });
    req.on('end', () => {
        if (res.writableEnded) return;
        let ops;
        try { ops = JSON.parse(Buffer.concat(chunks).toString('utf8')).ops; } catch (_error) { ops = null; }
        if (!Array.isArray(ops)) { res.statusCode = 400; return res.end(); }
        const data = readStorage(file);
        for (const [op, key, value] of ops) {
            if (op === 'clear') Object.keys(data).forEach(name => delete data[name]);
            else if (op === 'remove' && typeof key === 'string') delete data[key];
            else if (op === 'set' && typeof key === 'string' && typeof value === 'string') data[key] = value;
        }
        const text = JSON.stringify(data);
        if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) { res.statusCode = 413; return res.end(); }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(`${file}.tmp`, text);
        fs.renameSync(`${file}.tmp`, file);
        res.statusCode = 204;
        res.end();
    });
}

function injectShim(html, prefix) {
    const tag = `<script src="${prefix}/__platform/shim.js"></script>`;
    const head = /<head\b[^>]*>/i.exec(html);
    if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
    const doctype = /<!doctype[^>]*>/i.exec(html);
    return doctype ? html.slice(0, doctype.index + doctype[0].length) + tag + html.slice(doctype.index + doctype[0].length) : tag + html;
}

function rewriteLocation(value, port, prefix, requestPath) {
    try {
        const resolved = new URL(value, `http://127.0.0.1:${port}${requestPath}`);
        if (!['127.0.0.1', 'localhost'].includes(resolved.hostname) || String(resolved.port) !== String(port)) return value;
        const pathname = resolved.pathname.startsWith(`${prefix}/`) || resolved.pathname === prefix ? resolved.pathname : `${prefix}${resolved.pathname}`;
        return `${pathname}${resolved.search}${resolved.hash}`;
    } catch (_error) {
        return value;
    }
}

function forwardHeaders(req, { port, prefix, claims, secret }) {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        if (HOP_BY_HOP.has(name) || DROP_REQUEST.has(name) || name.startsWith('cf-') || name.startsWith('x-forwarded-') || name.startsWith('x-platform-')) continue;
        headers[name] = value;
    }
    if (req.headers['content-length'] !== undefined) headers['content-length'] = req.headers['content-length'];
    if (req.headers['transfer-encoding'] !== undefined) headers['transfer-encoding'] = req.headers['transfer-encoding'];
    const timestamp = String(Date.now());
    const user = encodeURIComponent(claims.u || '');
    Object.assign(headers, {
        host: `127.0.0.1:${port}`,
        'accept-encoding': 'identity',
        'x-forwarded-prefix': prefix,
        'x-forwarded-proto': String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0].trim(),
        'x-forwarded-host': String(req.headers['x-forwarded-host'] || req.headers.host || ''),
        'x-platform-user': user,
        'x-platform-role': claims.r || 'user',
        'x-platform-tenant': claims.t,
        'x-platform-timestamp': timestamp,
        // 应用可用 PLATFORM_APP_SECRET 校验：HMAC-SHA256(secret, user\nrole\ntenant\ntimestamp)
        'x-platform-signature': crypto.createHmac('sha256', secret || '').update(`${user}\n${claims.r || 'user'}\n${claims.t}\n${timestamp}`).digest('hex')
    });
    return headers;
}

function resolveRequest(req) {
    const url = new URL(req.url, 'http://local');
    const match = PATH_RE.exec(url.pathname);
    if (!match) return { error: [404, '页面不存在', '托管应用地址无效'] };
    const [, slug, token, rest] = match;
    if (!token) return { slug, redirectToLauncher: true };
    const claims = verifyToken(token);
    if (!claims || claims.s !== slug) return { error: [401, '访问链接已过期', '请回到平台，从工具菜单重新打开该应用'] };
    return { slug, token, claims, rest, search: url.search, prefix: `/apps/${slug}/~${token}` };
}

/** Express 中间件：挂在 /apps，位于 JSON 解析与页面登录拦截之前，请求体原样转发。 */
function handler(req, res) {
    const resolved = resolveRequest(req);
    if (resolved.error) return sendPage(res, ...resolved.error);
    if (resolved.redirectToLauncher) {
        res.statusCode = 302;
        res.setHeader('Location', `/tools/${resolved.slug}`);
        return res.end();
    }
    const { slug, claims, rest, search, prefix } = resolved;
    tenant.runWithTenant(claims.t, () => {
        if (!runtime.exists(slug)) return sendPage(res, 404, '应用不存在', '该应用已被删除');
        if (rest === undefined) {
            res.statusCode = 302;
            res.setHeader('Location', `${prefix}/${search}`);
            return res.end();
        }
        corsHeaders(res);
        if (rest === '/__platform/shim.js') {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.end(SHIM);
        }
        if (rest === '/__platform/storage') return handleStorage(req, res, slug, claims);
        if (rest.startsWith('/__platform/adc/')) return require('./adc-bridge').handle(req, res, rest.slice('/__platform/adc'.length), claims);
        if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
            res.statusCode = 204;
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', String(req.headers['access-control-request-headers'] || '*'));
            res.setHeader('Access-Control-Max-Age', '600');
            return res.end();
        }
        const target = runtime.target(slug, claims.t);
        if (!target) return sendPage(res, 503, '应用未运行', '请回到平台的应用入口启动后再访问');
        const upstream = http.request({ host: '127.0.0.1', port: target.port, method: req.method, path: `${rest}${search}`, agent: upstreamAgent,
            headers: forwardHeaders(req, { port: target.port, prefix, claims, secret: target.secret }) });
        upstream.setTimeout(10 * 60 * 1000, () => upstream.destroy(new Error('应用响应超时')));
        upstream.on('error', error => {
            if (res.headersSent) return res.destroy(error);
            sendPage(res, 502, '应用暂时无法访问', error.message);
        });
        upstream.on('response', response => {
            const contentType = String(response.headers['content-type'] || '');
            for (const [name, value] of Object.entries(response.headers)) {
                if (HOP_BY_HOP.has(name) || DROP_RESPONSE.has(name) || name.startsWith('access-control-')) continue;
                if (name === 'location') { res.setHeader('Location', rewriteLocation(value, target.port, prefix, rest)); continue; }
                if (name === 'content-security-policy') continue;
                res.setHeader(name, value);
            }
            res.setHeader('Content-Security-Policy', [response.headers['content-security-policy'], SANDBOX].flat().filter(Boolean));
            res.setHeader('Referrer-Policy', 'same-origin');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('X-Frame-Options', 'SAMEORIGIN');
            corsHeaders(res);
            res.statusCode = response.statusCode;
            const html = /text\/html/i.test(contentType) && !response.headers['content-encoding'] && req.method !== 'HEAD';
            if (!html) {
                if (response.headers['content-length'] !== undefined) res.setHeader('Content-Length', response.headers['content-length']);
                return response.pipe(res);
            }
            const chunks = [];
            let size = 0;
            response.on('data', chunk => {
                size += chunk.length;
                if (size > MAX_HTML_BYTES) { response.destroy(); res.destroy(); return; }
                chunks.push(chunk);
            });
            response.on('end', () => {
                const body = Buffer.from(injectShim(require('./adc-bridge').adaptHtml(Buffer.concat(chunks).toString('utf8'), prefix), prefix), 'utf8');
                res.setHeader('Content-Length', body.length);
                res.end(body);
            });
        });
        req.pipe(upstream);
    });
}

/** HTTP 服务器 upgrade 事件：WebSocket 同样经令牌校验后转发。 */
function handleUpgrade(req, socket, head) {
    if (!String(req.url || '').startsWith('/apps/')) return false;
    const resolved = resolveRequest({ url: req.url.slice('/apps'.length) });
    const reject = status => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); return true; };
    if (resolved.error || resolved.redirectToLauncher || resolved.rest === undefined) return reject(401);
    const { slug, claims, rest, search, prefix } = resolved;
    return tenant.runWithTenant(claims.t, () => {
        const target = runtime.target(slug, claims.t);
        if (!target) return reject(503);
        const headers = forwardHeaders(req, { port: target.port, prefix, claims, secret: target.secret });
        delete headers['accept-encoding'];
        headers.connection = 'Upgrade';
        headers.upgrade = req.headers.upgrade;
        const upstream = net.connect(target.port, '127.0.0.1', () => {
            const lines = [`${req.method} ${rest}${search} HTTP/1.1`, ...Object.entries(headers).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)];
            upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
            if (head && head.length) upstream.write(head);
            upstream.pipe(socket);
            socket.pipe(upstream);
        });
        const close = () => { upstream.destroy(); socket.destroy(); };
        upstream.on('error', close);
        socket.on('error', close);
        return true;
    });
}

module.exports = { handler, handleUpgrade, issueToken, verifyToken, entryUrl, injectShim, rewriteLocation, SHIM, SANDBOX };
