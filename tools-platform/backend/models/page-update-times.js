const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// 首页卡片「上次更新」：取内置页面 HTML 及其专属 js/css 的最近更新时间。
// 源码部署优先用 git 提交时间（pull / checkout 会刷新 mtime，不可靠），
// 有未提交改动的文件取 mtime；无 git 的环境（桌面安装包）退回 mtime。
// 公共资源（/js/shared、shared.css、*.min.*）改动会波及所有页面，不计入。

const PAGE_FILES = {
    '/uivf12': 'pages/uivf12.html',
    '/sla': 'pages/sla.html',
    '/report': 'pages/report.html',
    '/expedite': 'pages/expedite.html',
    '/monthly': 'pages/monthly-designer.html',
    '/duty-roster': 'pages/duty-roster.html',
    '/bigscreen': 'pages/bigscreen.html',
    '/topic-analysis': 'pages/topic-analysis.html',
    '/frt': 'pages/frt.html',
    '/requirements': 'pages/requirements.html',
    '/praudit': 'pages/praudit.html',
    '/storage': 'pages/storage.html',
    '/db-explorer': 'pages/db-explorer.html'
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const GIT_LOG_DEPTH = 200;
const ASSET_REF_RE = /<(?:script|link)\b[^>]*?\s(?:src|href)=["']([^"'?#\s]+\.(?:m?js|css))(?:\?[^"']*)?["']/gi;
const SHARED_ASSET_RE = /^\/(?:js\/shared\/|css\/shared\.css$)|\.min\.(?:js|css)$/i;
// 全站批量改动：公共脚本/样式引用、站点图标。
const SHARED_TAG_LINE_RE = /^\s*<(?:script|link)\b[^>]*(?:\/js\/shared\/|\/css\/shared\.css|rel=["'](?:shortcut )?icon["']|rel=["']apple-touch-icon["'])[^>]*>(?:\s*<\/script>)?\s*$/i;

let cache = null;

function mtimeOf(filePath) {
    try {
        return fs.statSync(filePath).mtimeMs;
    } catch {
        return 0;
    }
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

function pageFiles(publicDir, relPath) {
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

async function latestUpdate(files, gitState) {
    if (!files.length) return 0;
    if (!gitState) return Math.max(...files.map(mtimeOf));
    const dirty = files.filter(file => gitState.dirty.has(file));
    const committed = files.filter(file => !gitState.dirty.has(file));
    const dirtyAt = dirty.length ? Math.max(...dirty.map(mtimeOf)) : 0;
    const committedAt = committed.length ? await lastMeaningfulCommitTime(committed, gitState.root) : 0;
    return Math.max(dirtyAt, committedAt) || Math.max(...files.map(mtimeOf));
}

async function computePageUpdateTimes(publicDir) {
    const gitState = await readGitState(publicDir);
    const entries = await Promise.all(Object.entries(PAGE_FILES).map(async ([href, relPath]) =>
        [href, await latestUpdate(pageFiles(publicDir, relPath), gitState)]));
    return Object.fromEntries(entries
        .filter(([, latest]) => latest)
        .map(([href, latest]) => [href, new Date(latest).toISOString()]));
}

function getPageUpdateTimes(publicDir, { now = Date.now() } = {}) {
    if (!cache || cache.publicDir !== publicDir || now - cache.at >= CACHE_TTL_MS) {
        const promise = computePageUpdateTimes(publicDir);
        cache = { publicDir, at: now, promise };
        promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
    }
    return cache.promise;
}

module.exports = { getPageUpdateTimes, isSharedChurnOnly, PAGE_FILES };
