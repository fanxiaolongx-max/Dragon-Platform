const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

// 按文件内容自动给 HTML 中引用的本地 js/css 追加 ?v=<hash>，取代手工维护版本号。
// 哈希按 mtime+size 缓存，文件变化后自动失效。

const hashCache = new Map();
const moduleImportCache = new Map();

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

function moduleImports(file) {
    const hash = fileHash(file);
    if (!hash) return [];
    const cached = moduleImportCache.get(file);
    if (cached?.hash === hash) return cached.imports;
    const imports = new Set();
    try {
        const ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
        const walk = node => {
            if (!node || typeof node !== 'object') return;
            if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)
                && typeof node.source?.value === 'string') imports.add(node.source.value);
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(walk);
                else if (value && typeof value === 'object') walk(value);
            }
        };
        walk(ast);
    } catch (_) { /* 非标准模块保持原有加载行为 */ }
    const result = [...imports];
    moduleImportCache.set(file, { hash, imports: result });
    return result;
}

// HTML 中的入口带版本还不够：浏览器会单独缓存它导入的每一个模块。
// 在页面里生成依赖映射，文件任意层级更新都会拿到自己的新内容版本。
// 使用 import map 而不改写 JS 响应，保留循环依赖、相对路径和文件哈希的语义。
function versionModuleDependencies(html, { publicDir, baseDir }) {
    if (!baseDir || /<script\b[^>]*\btype\s*=\s*["']?importmap\b/i.test(html)) return html;
    const entries = [...html.matchAll(/<script\b[^>]*>/gi)].filter(match => /\btype\s*=\s*(?:["']module["']|module(?=\s|>))/i.test(match[0]));
    if (!entries.length) return html;
    const imports = {};
    const visited = new Set();
    const cleanUrl = url => url.replace(/[?#].*$/, '');
    const localUrl = url => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)
        && (!url.includes('?') || /\?v=[^&#]*$/.test(url));
    const visit = (file, url) => {
        const hash = fileHash(file);
        if (!hash) return;
        const key = url.startsWith('/') || url.startsWith('.') ? url : './' + url;
        imports[key] = `${cleanUrl(key)}?v=${hash}`;
        if (visited.has(file)) return;
        visited.add(file);
        for (const specifier of moduleImports(file)) {
            if (!localUrl(specifier) || !/^(?:\.?\.?\/)/.test(specifier)) continue;
            const name = cleanUrl(specifier);
            let target;
            try {
                target = name.startsWith('/') ? resolveAssetPath(name, { publicDir, baseDir }) : path.resolve(path.dirname(file), decodeURI(name));
            } catch (_) { continue; }
            if (!target || !(isInside(baseDir, target)
                || ((name.startsWith('/') || isInside(publicDir, file)) && isInside(publicDir, target)))) continue;
            const nextUrl = name.startsWith('/') ? specifier
                : path.posix.join(path.posix.dirname(cleanUrl(url)), specifier);
            visit(target, nextUrl);
        }
    };
    for (const entry of entries) {
        const src = /\bsrc\s*=\s*(["'])(.*?)\1/i.exec(entry[0])?.[2];
        if (!src || !localUrl(src)) continue;
        const file = resolveAssetPath(cleanUrl(src), { publicDir, baseDir });
        if (file) visit(file, src);
    }
    if (!Object.keys(imports).length) return html;
    const json = JSON.stringify({ imports }).replace(/</g, '\\u003c');
    const index = entries[0].index;
    return html.slice(0, index) + `<script type="importmap">${json}</script>\n` + html.slice(index);
}

function versionAssetUrls(html, { publicDir, baseDir } = {}) {
    const versioned = String(html).replace(ASSET_REF_RE, (match, prefix, quote, url) => {
        const absPath = resolveAssetPath(url, { publicDir, baseDir });
        const hash = absPath && fileHash(absPath);
        return hash ? `${prefix}${quote}${url}?v=${hash}${quote}` : match;
    });
    return versionModuleDependencies(versioned, { publicDir, baseDir });
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
