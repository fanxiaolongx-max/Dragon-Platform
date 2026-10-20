'use strict';
const fs = require('node:fs');
const path = require('node:path');
const security = require('./snapshot-portal-security');
const { PAYLOAD_CHUNK_BYTES } = require('./snapshot-size-policy');
const { getTenantId } = require('./tenant-context');
const { safeJson } = require('./static-snapshot-data');
const FRONTEND = path.join(__dirname, '../../frontend');
const EXCLUDED = new Set(['f12-to-extension', 'python-updater']);
const safeName = name => typeof name === 'string' && !name.startsWith('/') && !name.split('/').some(p => !p || p === '..' || p === '.');
const read = name => fs.readFileSync(path.join(FRONTEND, name), 'utf8');
const payloadParts = item => item.parts || [item];
function mime(name) {
    return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.ico': 'image/x-icon' })[path.extname(name).toLowerCase()] || 'application/octet-stream';
}
function write(root, name, bytes) {
    assertPath(root, name);
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), bytes);
}
function assertPath(root, name) {
    if (!safeName(name)) throw new Error('静态站点文件路径无效');
    let dir = root;
    for (const part of name.split('/')) {
        dir = path.join(dir, part);
        if (fs.lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('静态站点路径不可包含符号链接');
    }
}
function portalHtml(source, name, bridge = true) {
    const root = path.posix.relative(path.posix.dirname(name), '.') || '.';
    const injection = `<script src="${root}/tp-static/boot.js"></script>${bridge ? `<script src="${root}/tp-static/bridge.js"></script>` : ''}`;
    return source.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
}
function rewrite(source) {
    return source.replace(/(["'`(])\/(assets|css|js)\//g, '$1./tp-static/frontend/$2/')
        .replace(/(["'])\/favicon\.ico/g, '$1./tp-static/frontend/favicon.ico')
        .replace(/window\.location\.href = '\/'/g, 'window.location.href = window.__TP_LOGIN_DESTINATION__ || \'./index.html\'')
        .replace(/(['"])\/login\.html\1/g, '$1./login.html$1')
        .replace(/href="\/project-evolution"/g, 'href="./project-evolution.html"');
}
function bootHtml(depth = '.') {
    const hash = security.digest(read('js/static-portal/boot.js')).slice(0, 12);
    return `<!doctype html><html lang="zh-CN" data-static-boot="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dragon Platform</title></head><body><p id="staticBootStatus">正在打开平台 / Opening platform…</p><script src="${depth}/tp-static/boot.js?v=${hash}"></script></body></html>`;
}
function versionPage(html, files) {
    return html.replace(/\b(src|href)="(\.\/tp-static\/([^"?]+))(?:\?[^"\s]*)?"/g, (match, attribute, relative, name) => {
        const bytes = files.get('tp-static/' + name);
        return bytes === undefined ? match : `${attribute}="${relative}?v=${security.digest(bytes).slice(0, 12)}"`;
    });
}
async function collectHome(items) {
    const settings = await require('./nav-settings-repository').getSettings();
    settings.f12QuickDownloads = [];
    const tools = (await require('./custom-tools-repository').listTools()).filter(t => !EXCLUDED.has(t.slug)).map(tool => {
        const item = items.find(i => i.slug === tool.slug);
        const { slug, name, nameEn, description, descriptionEn, tags, icon, builtIn, createdAt, updatedAt } = tool;
        return { slug, name, nameEn, description, descriptionEn, tags, icon, builtIn, createdAt, updatedAt, href: item?.href || `/custom-tools/${slug}/index.html` };
    });
    for (const item of items) if (!tools.some(tool => tool.slug === item.slug)) tools.push({ slug: item.slug, name: item.name, description: item.description, icon: '🧩', href: item.href });
    let summary = {};
    try { summary = await require('./platform-metrics-repository').getSummary(); } catch (_) { /* 没有业务指标时保持原页面的空状态。 */ }
    delete summary.generatedAt;
    const linksConfig = await require('./friend-links-repository').getConfig();
    const friendLinks = { links: linksConfig.links.map(({ id, name, nameEn, icon, url }) => ({ id, name, nameEn, icon, url: new URL(url).origin + new URL(url).pathname })), statuses: {}, probeIntervalMinutes: linksConfig.probeIntervalMinutes };
    const identity = Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('platform')));
    return { settings, identity, tools, summary, items, friendLinks, tenantId: getTenantId() };
}
function collectPublicFiles(identity) {
    const files = new Map();
    function walk(dir) {
        for (const entry of fs.readdirSync(path.join(FRONTEND, dir), { withFileTypes: true })) {
            const name = path.posix.join(dir, entry.name);
            if (entry.isDirectory()) walk(name);
            else if (entry.isFile() && !/\.(?:mp4|mp3|webm|mov)$/i.test(name)) {
                const source = /\.css$/.test(name)
                    ? read(name).replace(/(["'(])\/assets\//g, '$1' + path.posix.relative(path.posix.dirname(name), 'assets') + '/')
                    : /\.js$/.test(name) ? rewrite(read(name)) : null;
                files.set(name, source === null ? fs.readFileSync(path.join(FRONTEND, name)) : Buffer.from(source));
            }
        }
    }
    walk('css'); walk('js/shared'); walk('js/home');
    // 只复制版本控制的主页图片和字体，不读取用户媒体或运行时业务附件。
    for (const entry of fs.readdirSync(path.join(FRONTEND, 'assets'), { withFileTypes: true })) {
        if (entry.isFile() && /\.(?:png|jpg|svg|ico|woff2?|ttf)$/i.test(entry.name)) files.set('assets/' + entry.name, fs.readFileSync(path.join(FRONTEND, 'assets', entry.name)));
    }
    for (const entry of fs.readdirSync(path.join(FRONTEND, 'assets/promotions'), { withFileTypes: true })) {
        if (entry.isFile() && /\.(?:png|jpg|svg)$/i.test(entry.name)) files.set('assets/promotions/' + entry.name, fs.readFileSync(path.join(FRONTEND, 'assets/promotions', entry.name)));
    }
    if (fs.existsSync(path.join(FRONTEND, 'favicon.ico'))) files.set('favicon.ico', fs.readFileSync(path.join(FRONTEND, 'favicon.ico')));
    const logo = require('./platform-logo-runtime');
    for (const name of logo.ASSET_NAMES) {
        const file = logo.resolveLogoAsset(name);
        if (file && fs.existsSync(file)) files.set('assets/' + name, fs.readFileSync(file));
    }
    const catalog = require('../home-promo-videos.json');
    const media = {};
    for (const [name, asset] of Object.entries(catalog.assets)) media[name] = asset.url || `${catalog.baseUrl}/${encodeURIComponent(name)}`;
    for (const [name, bytes] of files) if (name.startsWith('assets/promotions/')) media[path.posix.basename(name)] = `./tp-static/frontend/${name}?v=${security.digest(bytes).slice(0, 12)}`;
    let promo = files.get('js/home/promo-video.js').toString();
    promo = promo.replace(/const media = [^\n]+;/, () => `const STATIC_MEDIA=${safeJson(media)};\n    const media = (key,kind) => {const file=isEnglish()&&EN_FILES[key]?EN_FILES[key][kind]:VIDEOS[key][kind].split('/').pop().split('?')[0];return STATIC_MEDIA[file]||('./tp-static/frontend/assets/promotions/'+file);};`);
    files.set('js/home/promo-video.js', promo);
    for (const name of ['js/shared/navbar.js', 'js/shared/api.js']) {
        files.set(name, files.get(name).toString().replaceAll('window.location.pathname', '(window.__TP_STATIC_PATH__ || window.location.pathname)'));
    }
    files.set('js/project-evolution.js', rewrite(read('js/project-evolution.js').replace('/assets/promotions/project-evolution-galaxy-hd.mp4', media['project-evolution-galaxy-hd.mp4'])));
    files.set('project-evolution.html', rewrite(read('pages/project-evolution.html')));
    files.set('tp-static/boot.js', read('js/static-portal/boot.js'));
    files.set('tp-static/bridge.js', read('js/static-portal/bridge.js'));
    files.set('tp-static/session.js', read('js/static-portal/session.js'));
    files.set('tp-static-sw.js', read('js/static-portal/worker.js'));
    files.set('tp-static/boot.html', bootHtml());
    files.set('login.html', portalHtml(rewrite(read('pages/login.html')), 'login.html', false));
    const published = new Map([...files].map(([name, bytes]) => [/^(?:js|css|assets)\//.test(name) || name === 'favicon.ico' ? 'tp-static/frontend/' + name : name, bytes]));
    for (const name of ['login.html', 'project-evolution.html']) published.set(name, versionPage(String(published.get(name)), published));
    return { files: published, media, identity: { '/api/platform-identity': identity, '/api/nav-settings': identity, '/api/platform-logo/status': { ok: true, hasLogo: files.has('assets/logo.png') } } };
}

async function readPrevious(checkout, keep) {
    assertPath(checkout, 'tp-static/site.json');
    const file = path.join(checkout, 'tp-static/site.json');
    if (!fs.existsSync(file)) return { files: new Map() };
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('静态站点清单不可为符号链接');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.version !== 1 || manifest.tenantId !== getTenantId() || !manifest.files || typeof manifest.files !== 'object') throw new Error('目标静态站点不属于当前租户或清单无效');
    let key;
    const files = new Map();
    for (const [name, item] of Object.entries(manifest.files)) {
        if (!safeName(name) || !payloadParts(item).length) throw new Error('旧静态站点清单路径无效');
        for (const part of payloadParts(item)) {
            if (!/^tp-static\/payload\/[a-f0-9]+\.bin$/.test(part.url)) throw new Error('旧静态站点清单路径无效');
            assertPath(checkout, part.url);
        }
        if (!keep(name)) continue;
        key ||= await security.getKey(manifest.keyId);
        files.set(name, Buffer.concat(payloadParts(item).map(part => security.open(fs.readFileSync(path.join(checkout, part.url)), key, part.iv))));
    }
    return { files, manifest };
}

async function buildPortal(checkout, items, changedFiles) {
    const belongs = name => items.some(item => {
        const entry = item.href.slice(2), dir = path.posix.dirname(entry);
        return name === entry || dir !== '.' && name.startsWith(dir + '/');
    });
    const refreshed = items.filter(item => changedFiles.has(item.href.slice(2))).map(item => item.href.slice(2));
    const replaced = name => refreshed.some(entry => {
        const dir = path.posix.dirname(entry);
        return name === entry || dir !== '.' && name.startsWith(dir + '/');
    });
    const previous = await readPrevious(checkout, name => belongs(name) && !replaced(name));
    const auth = await security.getSecurity();
    const home = await collectHome(items);
    const publicFiles = collectPublicFiles(home.identity);
    const files = new Map();
    for (const [name, bytes] of previous.files) if (belongs(name) && !replaced(name) && !name.endsWith('/.tools-platform-snapshot.json')) files.set(name, bytes);
    // 首次升级：吸收以前发布的工具文件，再以加密载荷替换明文文件。
    if (!previous.manifest) {
        function walk(dir) {
            for (const entry of fs.readdirSync(path.join(checkout, dir), { withFileTypes: true })) {
                const name = path.posix.join(dir, entry.name);
                if (entry.isSymbolicLink()) throw new Error('静态工具发布目录不可包含符号链接');
                if (entry.isDirectory()) walk(name);
                else if (entry.isFile() && !entry.name.startsWith('.')) files.set(name, fs.readFileSync(path.join(checkout, name)));
            }
        }
        for (const item of items) {
            const name = item.href.slice(2), dir = path.posix.dirname(name);
            if (dir === '.') { if (fs.existsSync(path.join(checkout, name))) files.set(name, fs.readFileSync(path.join(checkout, name))); }
            else if (fs.existsSync(path.join(checkout, dir))) walk(dir);
        }
    }
    for (const [name, bytes] of changedFiles) if (!name.endsWith('/.tools-platform-snapshot.json')) files.set(name, bytes);
    files.set('index.html', Buffer.from(versionPage(portalHtml(rewrite(read('index.html')), 'index.html'), publicFiles.files)));
    files.set('portal-data.json', Buffer.from(safeJson(home)));
    const proof = previous.manifest?.keyId === auth.id ? previous.manifest.proof : (() => { const value = security.seal(Buffer.from('tools-platform-static-site'), auth.key); return { iv: value.iv, data: value.ciphertext.toString('base64') }; })();
    const manifest = { version: 1, ...auth.public, tenantId: getTenantId(), media: publicFiles.media, identity: publicFiles.identity, proof, files: {} };
    for (const [name, value] of files) {
        assertPath(checkout, name);
        let bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        if (/\.html$/i.test(name) && name !== 'index.html' && !bytes.includes(Buffer.from('/tp-static/session.js'))) {
            const depth = path.posix.relative(path.posix.dirname(name), '.') || '.';
            bytes = Buffer.from(bytes.toString().replace(/<head([^>]*)>/i, `<head$1><script src="${depth}/tp-static/session.js"></script>`));
        }
        const hash = security.digest(bytes);
        const old = previous.manifest?.keyId === auth.id && previous.manifest.files[name];
        let entry = old?.hash === hash && (bytes.length <= PAYLOAD_CHUNK_BYTES || old.parts) ? old : null;
        if (!entry) {
            const parts = [];
            for (let offset = 0; offset < bytes.length || !parts.length; offset += PAYLOAD_CHUNK_BYTES) {
                const chunk = bytes.subarray(offset, offset + PAYLOAD_CHUNK_BYTES);
                const hash = security.digest(chunk);
                const prior = old?.parts?.[parts.length];
                if (prior?.hash === hash) { parts.push(prior); continue; }
                const encrypted = security.seal(chunk, auth.key);
                const url = `tp-static/payload/${security.digest(bytes.length > PAYLOAD_CHUNK_BYTES ? 'chunk\0' + name + '\0' + offset : name)}.bin`;
                write(checkout, url, encrypted.ciphertext);
                parts.push({ url, iv: encrypted.iv, ...(bytes.length > PAYLOAD_CHUNK_BYTES ? { hash } : {}) });
            }
            entry = { ...(parts.length === 1 ? parts[0] : { parts }), hash, type: mime(name) };
        }
        manifest.files[name] = entry;
        if (/\.html$/i.test(name)) write(checkout, name, bootHtml(path.posix.relative(path.posix.dirname(name), '.') || '.'));
        else if (belongs(name) && fs.existsSync(path.join(checkout, name))) fs.unlinkSync(path.join(checkout, name));
    }
    for (const [name, bytes] of publicFiles.files) write(checkout, name, bytes);
    manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
    const activePayloads = new Set(Object.values(manifest.files).flatMap(payloadParts).map(item => item.url));
    for (const item of Object.values(previous.manifest?.files || {}).flatMap(payloadParts)) {
        if (!activePayloads.has(item.url) && fs.existsSync(path.join(checkout, item.url))) fs.unlinkSync(path.join(checkout, item.url));
    }
    write(checkout, 'tp-static/site.json', JSON.stringify(manifest, null, 2) + '\n');
    return { paths: ['index.html', 'login.html', 'project-evolution.html', 'tp-static-sw.js', 'tp-static', ...items.map(i => path.posix.dirname(i.href.slice(2))).filter(dir => dir !== '.')], manifest };
}

module.exports = { buildPortal, EXCLUDED };
