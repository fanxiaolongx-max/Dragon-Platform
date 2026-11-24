const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 首页卡片「上次更新」：取内置页面 HTML 及其专属 js/css 的最近更新时间。
// 源码部署优先用 git 提交时间（pull / checkout 会刷新 mtime，不可靠），
// 有未提交改动的文件取 mtime；无 git 的环境（桌面安装包）优先读构建期生成的
// frontend/assets/page-updates.json，再退回 mtime。
// 公共资源（/js/shared、shared.css、startup-screen.css、*.min.*）以及跨页复用但
// 不属于本页命名空间的模块（如 ai-bi 复用的 js/ai-report/*）不计入本页更新。

const PAGE_FILES = {
    '/uivf12': 'pages/uivf12.html',
    '/sla': 'pages/sla.html',
    '/report': 'pages/report.html',
    '/expedite': 'pages/expedite.html',
    '/monthly': 'pages/ai-report.html',
    '/ai-bi': 'pages/ai-bi.html',
    '/duty-roster': 'pages/duty-roster.html',
    '/bigscreen': 'pages/bigscreen.html',
    '/topic-analysis': 'pages/topic-analysis.html',
    '/frt': 'pages/frt.html',
    '/requirements': 'pages/requirements.html',
    '/praudit': 'pages/praudit.html',
    '/storage': 'pages/storage.html',
    '/db-explorer': 'pages/db-explorer.html',
    '/netcare-explorer': 'pages/netcare-explorer.html'
};

// 页面 URL 与其专属静态资源目录/文件名前缀的显式映射；未列出时默认取路由段与 HTML 文件名。
const PAGE_NAMESPACES = {
    '/monthly': ['ai-report', 'monthly']
};

const BUNDLED_MANIFEST_REL = path.join('assets', 'page-updates.json');
const CACHE_TTL_MS = 10 * 60 * 1000;
const GIT_LOG_DEPTH = 200;
const ASSET_REF_RE = /<(?:script|link)\b[^>]*?\s(?:src|href)=["']([^"'?#\s]+\.(?:m?js|css))(?:\?[^"']*)?["']/gi;
const SHARED_ASSET_RE = /^\/(?:js\/shared\/|css\/(?:shared|startup-screen)\.css$)|\.min\.(?:js|css)$/i;
// 全站批量改动：公共脚本/样式引用、站点图标。
const SHARED_TAG_LINE_RE = /^\s*<(?:script|link)\b[^>]*(?:\/js\/shared\/|\/css\/(?:shared|startup-screen)\.css|rel=["'](?:shortcut )?icon["']|rel=["']apple-touch-icon["'])[^>]*>(?:\s*<\/script>)?\s*$/i;

let cache = null;

function clearCache() {
    cache = null;
}

function mtimeOf(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return 0;
    }
}

function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function namespacesFor(href, relPath) {
    if (PAGE_NAMESPACES[href]) return PAGE_NAMESPACES[href];
    const set = new Set();
    const routeSlug = String(href || '').replace(/^\/+|\/+$/g, '');
    const htmlBase = path.basename(String(relPath || ''), '.html');
    if (routeSlug) set.add(routeSlug);
    if (htmlBase) set.add(htmlBase);
    return [...set];
}

function assetBelongsToPage(href, relPath, relAsset) {
    const normalized = String(relAsset || '').replace(/\\/g, '/');
    return namespacesFor(href, relPath).some(ns =>
        new RegExp(`(?:^|/)${escapeRegExp(ns)}(?:[/.]|$)`).test(normalized)
    );
}

function git(args, cwd) {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

// 返回 { root, dirty:Set<abs path> }；不在 git 仓库中时返回 null。
async function readGitState(publicDir) {
    try {
        const root = (await git(['rev-parse', '--show-toplevel'], publicDir)).trim();
        const status = await git(['status', '--porcelain', '-z', '--', '.'], publicDir);
        const dirty = new Set(status.split('\0')
            .filter(entry => entry.length > 3)
            .map(entry => path.join(root, entry.slice(3))));
        return { root, dirty };
    } catch {
        return null;
    }
}

function rawPageFiles(publicDir, relPath) {
    const htmlPath = path.join(publicDir, relPath);
    let html;
    try {
        html = fs.readFileSync(htmlPath, 'utf8');
    } catch {
        return [];
    }
    const files = new Set([htmlPath]);
    for (const [, url] of html.matchAll(ASSET_REF_RE)) {
        if (/^(?:[a-z]+:|\/\/)/i.test(url) || SHARED_ASSET_RE.test(url)) continue;
        const assetPath = url.startsWith('/') ? path.join(publicDir, url) : path.resolve(path.dirname(htmlPath), url);
        if (assetPath.startsWith(publicDir + path.sep) && fs.existsSync(assetPath)) files.add(assetPath);
    }
    return [...files];
}

// 统一收集各页面的专属文件：被 2 个及以上页面共同引用的脚本/样式仅归属给命名空间匹配的主页面，
// 避免 A 页面复用 B 页面模块时，B 页面改代码把 A 页面也算成「刚更新」。
function collectPageFiles(publicDir, pageMap = PAGE_FILES) {
    const rawByPage = {};
    const refCount = new Map();
    for (const [href, relPath] of Object.entries(pageMap)) {
        const htmlPath = path.join(publicDir, relPath);
        const files = rawPageFiles(publicDir, relPath);
        rawByPage[href] = { htmlPath, relPath, files };
        for (const file of files) {
            if (file === htmlPath) continue;
            refCount.set(file, (refCount.get(file) || 0) + 1);
        }
    }
    const ownedByPage = {};
    for (const [href, { htmlPath, relPath, files }] of Object.entries(rawByPage)) {
        ownedByPage[href] = files.filter(file => {
            if (file === htmlPath) return true;
            if ((refCount.get(file) || 0) <= 1) return true;
            return assetBelongsToPage(href, relPath, path.relative(publicDir, file));
        });
    }
    return ownedByPage;
}

function isSharedChurnOnly(diffLines) {
    if (!diffLines.length) return false;
    const meaningful = diffLines
        .map(line => [line[0], line.slice(1).replace(/\?v=[\w.-]*/g, '')])
        .filter(([, text]) => !SHARED_TAG_LINE_RE.test(text));
    const removed = meaningful.filter(([sign]) => sign === '-').map(([, text]) => text).sort();
    const added = meaningful.filter(([sign]) => sign === '+').map(([, text]) => text).sort();
    return removed.join('\n') === added.join('\n');
}

// 最近一次真正改动页面内容的提交；扫描范围内全是批量改动时取最早那次。
async function lastMeaningfulCommitTime(files, root) {
    let log;
    try {
        log = await git(['log', '-n', String(GIT_LOG_DEPTH), '-p', '--unified=0', '--format=%x00%ct', '--', ...files], root);
    } catch {
        return 0;
    }
    let oldest = 0;
    for (const entry of log.split('\0').slice(1)) {
        const [header, ...lines] = entry.split('\n');
        oldest = Number(header) * 1000;
        const diffLines = lines.filter(line => /^[+-]/.test(line) && !/^(?:\+\+\+|---) /.test(line));
        if (!isSharedChurnOnly(diffLines)) return oldest;
    }
    return oldest;
}

function readBundledPageUpdates(publicDir) {
    const manifestPath = path.join(publicDir, BUNDLED_MANIFEST_REL);
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const valid = {};
        for (const [href, value] of Object.entries(parsed)) {
            const ms = Date.parse(String(value || ''));
            if (Number.isFinite(ms) && ms > 0) valid[href] = ms;
        }
        return valid;
    } catch {
        return {};
    }
}

async function latestUpdate(href, files, gitState, bundled) {
    if (!files.length) return bundled[href] || 0;
    if (!gitState) return bundled[href] || Math.max(...files.map(mtimeOf));
    const dirty = files.filter(file => gitState.dirty.has(file));
    const committed = files.filter(file => !gitState.dirty.has(file));
    const dirtyAt = dirty.length ? Math.max(...dirty.map(mtimeOf)) : 0;
    const committedAt = committed.length ? await lastMeaningfulCommitTime(committed, gitState.root) : 0;
    return Math.max(dirtyAt, committedAt) || bundled[href] || Math.max(...files.map(mtimeOf));
}

async function computePageUpdateTimes(publicDir) {
    const gitState = await readGitState(publicDir);
    const bundled = gitState ? {} : readBundledPageUpdates(publicDir);
    const ownedByPage = collectPageFiles(publicDir);
    const entries = await Promise.all(Object.keys(PAGE_FILES).map(async href =>
        [href, await latestUpdate(href, ownedByPage[href] || [], gitState, bundled)]));
    return Object.fromEntries(entries
        .filter(([, latest]) => latest)
        .map(([href, latest]) => [href, new Date(latest).toISOString()]));
}

async function writePageUpdatesManifest(publicDir, outPath = path.join(publicDir, BUNDLED_MANIFEST_REL)) {
    const times = await computePageUpdateTimes(publicDir);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(times, null, 2)}\n`, 'utf8');
    return times;
}

function getPageUpdateTimes(publicDir, { now = Date.now() } = {}) {
    if (!cache || cache.publicDir !== publicDir || now - cache.at >= CACHE_TTL_MS) {
        const promise = computePageUpdateTimes(publicDir);
        cache = { publicDir, at: now, promise };
        promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
    }
    return cache.promise;
}

module.exports = {
    getPageUpdateTimes,
    computePageUpdateTimes,
    writePageUpdatesManifest,
    readBundledPageUpdates,
    collectPageFiles,
    isSharedChurnOnly,
    clearCache,
    PAGE_FILES
};
