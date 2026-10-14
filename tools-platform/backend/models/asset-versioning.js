const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 按文件内容自动给 HTML 中引用的本地 js/css 追加 ?v=<hash>，取代手工维护版本号。
// 哈希按 mtime+size 缓存，文件变化后自动失效。

const hashCache = new Map();

// <script src="..."> / <link href="...">，仅匹配无查询串或只带 ?v= 的本地 js/css。
const ASSET_REF_RE = /(<(?:script|link)\b[^>]*?\s(?:src|href)=)(["'])([^"'?#\s]+\.(?:m?js|css))(?:\?v=[^"'#&\s]*)?\2/gi;

function isInside(dir, filePath) {
    const rel = path.relative(dir, filePath);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function fileHash(absPath) {
    let stat;
    try {
        stat = fs.statSync(absPath);
    } catch {
        return null;
    }
    if (!stat.isFile()) return null;
    const cached = hashCache.get(absPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.hash;
    const hash = crypto.createHash('sha1').update(fs.readFileSync(absPath)).digest('hex').slice(0, 10);
    hashCache.set(absPath, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
    return hash;
}

function resolveAssetPath(url, { publicDir, baseDir }) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return null;
    let decoded;
    try {
        decoded = decodeURI(url);
    } catch {
        return null;
    }
    if (decoded.startsWith('/')) {
        const absPath = path.join(publicDir, decoded);
        return isInside(publicDir, absPath) ? absPath : null;
    }
    if (!baseDir) return null;
    const absPath = path.resolve(baseDir, decoded);
    return isInside(baseDir, absPath) ? absPath : null;
}

function versionAssetUrls(html, { publicDir, baseDir } = {}) {
    return String(html).replace(ASSET_REF_RE, (match, prefix, quote, url) => {
        const absPath = resolveAssetPath(url, { publicDir, baseDir });
        const hash = absPath && fileHash(absPath);
        return hash ? `${prefix}${quote}${url}?v=${hash}${quote}` : match;
    });
}

function createFrontendHtmlSender(publicDir) {
    return function sendFrontendHtml(res, relPath) {
        const absPath = path.join(publicDir, relPath);
        let html;
        try {
            html = fs.readFileSync(absPath, 'utf8');
        } catch (error) {
            return res.status(404).send('Not found');
        }
        if (!res.getHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-cache');
        return res.type('html').send(versionAssetUrls(html, { publicDir, baseDir: path.dirname(absPath) }));
    };
}

// 拦截直接访问的 *.html，返回带内容版本号的页面。
function createFrontendHtmlMiddleware(publicDir) {
    const sendFrontendHtml = createFrontendHtmlSender(publicDir);
    return (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let reqPath;
        try {
            reqPath = decodeURIComponent(req.path);
        } catch {
            return next();
        }
        if (!/\.html?$/i.test(reqPath)) return next();
        const absPath = path.join(publicDir, reqPath);
        if (!isInside(publicDir, absPath) || !fs.existsSync(absPath)) return next();
        return sendFrontendHtml(res, path.relative(publicDir, absPath));
    };
}

// 带当前内容哈希的 js/css 请求可以长期缓存；版本不匹配时交回默认的协商缓存。
function createImmutableAssetMiddleware(publicDir) {
    return (req, res, next) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || !req.query.v) return next();
        if (!/\.(?:m?js|css)$/i.test(req.path)) return next();
        const absPath = resolveAssetPath(req.path, { publicDir });
        if (absPath && fileHash(absPath) === String(req.query.v)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
        return next();
    };
}

module.exports = {
    createFrontendHtmlMiddleware,
    createFrontendHtmlSender,
    createImmutableAssetMiddleware,
    fileHash,
    versionAssetUrls
};
