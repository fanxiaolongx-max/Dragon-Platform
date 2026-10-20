'use strict';

const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const path = require('path');
const JSZip = require('jszip');
const builtinToolsSync = require('./builtin-tools-sync');
const repo = require('./custom-tools-repository');
const { fingerprintFiles } = require('./tool-content-fingerprint');
const { getDataDir } = require('./store');
const { run, get } = require('./app-db');
const BUILTIN_SOURCE_DIR = repo.BUILTIN_TOOLS_DIR;

const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/fanxiaolongx-max/privacy-policy/tool-market/catalog.json';
const CATALOG_MAX_BYTES = 2 * 1024 * 1024;
const PACKAGE_MAX_BYTES = 50 * 1024 * 1024;
const EXTRACTED_MAX_BYTES = 120 * 1024 * 1024;
const MAX_FILES = 1500;
const CACHE_MS = 5 * 60 * 1000;
const catalogCache = new Map();
const SETTINGS_KEY = 'sources';

async function ensureSettingsTable() {
    await run('CREATE TABLE IF NOT EXISTS tool_market_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
}

async function getMarketSettings() {
    await ensureSettingsTable();
    const row = await get('SELECT value_json FROM tool_market_settings WHERE key = ?', [SETTINGS_KEY]);
    let saved = {};
    try { saved = row ? JSON.parse(row.value_json) : {}; } catch (_) {}
    return {
        githubEnabled: saved.githubEnabled !== false,
        sources: Array.isArray(saved.sources) ? saved.sources : []
    };
}

function validateSourceUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); }
    catch (_) { throw Object.assign(new Error('请输入有效的 catalog.json 地址'), { status: 400 }); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !url.hostname
        || !url.pathname.endsWith('.json')) throw Object.assign(new Error('请输入不含账号密码的 catalog.json HTTP(S) 地址'), { status: 400 });
    return url.toString();
}

async function saveMarketSettings(input) {
    if (!input || typeof input.githubEnabled !== 'boolean' || !Array.isArray(input.sources) || input.sources.length > 20) {
        throw Object.assign(new Error('仓库设置格式无效（最多 20 个第三方仓库）'), { status: 400 });
    }
    const seen = new Set();
    const seenIds = new Set();
    const sources = input.sources.map(source => {
        const name = String(source.name || '').trim().slice(0, 80);
        const url = validateSourceUrl(source.url);
        if (!name || seen.has(url) || url === String(process.env.TOOLS_MARKET_CATALOG_URL || DEFAULT_CATALOG_URL).trim()) {
            throw Object.assign(new Error('仓库名称不能为空，目录地址不能重复'), { status: 400 });
        }
        seen.add(url);
        let id = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(source.id || '') ? source.id : crypto.randomUUID();
        if (seenIds.has(id)) id = crypto.randomUUID();
        seenIds.add(id);
        return { id, name, url, enabled: source.enabled !== false };
    });
    await ensureSettingsTable();
    await run('INSERT INTO tool_market_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
        [SETTINGS_KEY, JSON.stringify({ githubEnabled: input.githubEnabled, sources })]);
    return { githubEnabled: input.githubEnabled, sources };
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizeSlug(value) {
    return String(value || '').trim().toLowerCase();
}

function isPrivateIp(address) {
    const value = String(address || '').toLowerCase().split('%')[0];
    if (value.startsWith('::ffff:')) return isPrivateIp(value.slice(7));
    if (net.isIPv4(value)) {
        const [a, b] = value.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    if (net.isIPv6(value)) {
        return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
            || /^fe[89ab]/.test(value);
    }
    return true;
}

function allowedHostname(hostname, catalogHostname) {
    const configured = String(process.env.TOOLS_MARKET_ALLOWED_HOSTS || '')
        .split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
    const value = String(hostname || '').toLowerCase();
    return value === catalogHostname
        || value === 'github.com'
        || value.endsWith('.githubusercontent.com')
        || configured.includes(value);
}

async function assertMarketUrl(urlValue, catalogHostname, allowPrivate = false) {
    const parsed = new URL(urlValue);
    if (parsed.username || parsed.password || !['https:', ...(allowPrivate ? ['http:'] : [])].includes(parsed.protocol)) throw new Error('工具市场地址协议或凭据无效');
    if (!allowedHostname(parsed.hostname, catalogHostname || parsed.hostname)) throw new Error('工具包下载域名不在允许列表');
    if (net.isIP(parsed.hostname)) {
        if (isPrivateIp(parsed.hostname) && (!allowPrivate || parsed.hostname !== catalogHostname)) throw new Error('工具市场不允许访问此内网地址');
        return parsed;
    }
    const records = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
    if (!records.length || (records.some(record => isPrivateIp(record.address)) && (!allowPrivate || parsed.hostname !== catalogHostname))) {
        throw new Error('工具市场地址未解析到允许的地址');
    }
    return parsed;
}

async function readLimitedResponse(response, limit) {
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > limit) throw new Error('远程文件超过允许大小');
    if (!response.body || typeof response.body.getReader !== 'function') {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > limit) throw new Error('远程文件超过允许大小');
        return buffer;
    }
    const chunks = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > limit) throw new Error('远程文件超过允许大小');
            chunks.push(Buffer.from(value));
        }
    } finally {
        if (total > limit) await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks, total);
}

async function fetchBuffer(urlValue, { limit, catalogHostname, allowPrivate = false }) {
    let current = await assertMarketUrl(urlValue, catalogHostname, allowPrivate);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    if (typeof timeout.unref === 'function') timeout.unref();
    try {
        for (let redirects = 0; redirects <= 4; redirects += 1) {
            const response = await fetch(current, {
                redirect: 'manual',
                signal: controller.signal,
                headers: { 'User-Agent': 'Tools-Platform-Market/1.0', Accept: 'application/json,application/zip' }
            });
            if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
                if (redirects === 4) throw new Error('工具市场重定向次数过多');
                current = await assertMarketUrl(new URL(response.headers.get('location'), current).toString(), catalogHostname, allowPrivate);
                continue;
            }
            if (!response.ok) throw new Error(`工具市场返回 HTTP ${response.status}`);
            return readLimitedResponse(response, limit);
        }
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('连接工具市场超时');
        throw error;
    } finally {
        clearTimeout(timeout);
    }
    throw new Error('无法读取工具市场');
}

function verifyCatalogSignature(raw) {
    const signature = raw && raw.signature;
    const publicKeyBase64 = String(process.env.TOOLS_MARKET_PUBLIC_KEY || '').trim();
    const requireSignature = process.env.TOOLS_MARKET_REQUIRE_SIGNATURE === '1';
    if (!signature) {
        if (requireSignature) throw new Error('工具市场目录缺少数字签名');
        return { state: 'unsigned', keyId: null };
    }
    if (signature.algorithm !== 'Ed25519' || !signature.value) throw new Error('工具市场目录签名格式无效');
    if (!publicKeyBase64) {
        if (requireSignature) throw new Error('客户端尚未配置工具市场验签公钥');
        return { state: 'unverified', keyId: signature.keyId || null };
    }
    const unsigned = { ...raw };
    delete unsigned.signature;
    const publicKey = crypto.createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
    const valid = crypto.verify(null, Buffer.from(JSON.stringify(unsigned)), publicKey, Buffer.from(signature.value, 'base64'));
    if (!valid) throw new Error('工具市场目录数字签名校验失败');
    return { state: 'verified', keyId: signature.keyId || null };
}

function validateCatalog(raw, catalogUrl) {
    if (!raw || raw.catalogVersion !== 1 || !Array.isArray(raw.tools)) throw new Error('工具市场目录格式无效');
    const seen = new Set();
    const tools = raw.tools.map(item => {
        const slug = normalizeSlug(item && item.slug);
        if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug) || slug !== item.slug || seen.has(slug)) {
            throw new Error(`工具市场包含无效或重复的 slug：${item && item.slug}`);
        }
        seen.add(slug);
        const pkg = item.package || {};
        if (!/^[a-f0-9]{64}$/.test(String(pkg.sha256 || '')) || !/^[a-f0-9]{64}$/.test(String(pkg.directoryFingerprint || ''))) {
            throw new Error(`${slug} 缺少有效的 SHA-256 指纹`);
        }
        const packageSize = Number(pkg.size || 0);
        if (!Number.isSafeInteger(packageSize) || packageSize <= 0 || packageSize > PACKAGE_MAX_BYTES) {
            throw new Error(`${slug} 工具包大小无效`);
        }
        if (!Array.isArray(pkg.files) || pkg.files.length < 2 || pkg.files.length > MAX_FILES) {
            throw new Error(`${slug} 工具包文件清单无效`);
        }
        const packageFiles = pkg.files.map(record => {
            const recordPath = safeArchivePath(record && record.path);
            if (!recordPath || !/^[a-f0-9]{64}$/.test(String(record && record.sha256 || ''))) {
                throw new Error(`${slug} 工具包文件指纹无效`);
            }
            return { path: recordPath, size: Number(record.size || 0), sha256: record.sha256 };
        });
        const packageUrl = new URL(String(pkg.url || ''), catalogUrl).toString();
        return {
            id: String(item.id || `official/${slug}`),
            slug,
            releaseVersion: String(item.releaseVersion || item.releasedAt || 'unknown'),
            releasedAt: item.releasedAt || null,
            minPlatformVersion: String(item.minPlatformVersion || '1.0.0'),
            changelog: String(item.changelog || ''),
            tool: item.tool && typeof item.tool === 'object' ? item.tool : {},
            package: {
                url: packageUrl,
                size: packageSize,
                sha256: pkg.sha256,
                directoryFingerprint: pkg.directoryFingerprint,
                files: packageFiles
            }
        };
    });
    return { catalogVersion: 1, publisher: String(raw.publisher || 'unknown'), generatedAt: raw.generatedAt || null, tools };
}

function numericVersion(value) {
    return String(value || '').split('.').slice(0, 3).map(part => Number.parseInt(part, 10) || 0);
}

function versionAtLeast(current, minimum) {
    const left = numericVersion(current);
    const right = numericVersion(minimum);
    for (let index = 0; index < 3; index += 1) {
        if (left[index] !== right[index]) return left[index] > right[index];
    }
    return true;
}

function readManifest(toolDir) {
    try { return JSON.parse(fs.readFileSync(path.join(toolDir, repo.TOOL_MANIFEST_FILE), 'utf8')); } catch (_) { return null; }
}

function hasLocalChanges(toolDir, manifest) {
    const records = manifest && manifest.market && Array.isArray(manifest.market.files) ? manifest.market.files : [];
    return records.some(record => {
        if (!record || record.path === repo.TOOL_MANIFEST_FILE || !/^[a-f0-9]{64}$/.test(record.sha256 || '')) return false;
        const target = path.resolve(toolDir, record.path);
        if (!target.startsWith(`${path.resolve(toolDir)}${path.sep}`) || !fs.existsSync(target)) return true;
        return sha256(fs.readFileSync(target)) !== record.sha256;
    });
}

function releaseTime(value) {
    const text = String(value || '').trim();
    if (!/^20\d{2}[.-]\d{1,2}[.-]\d{1,2}(?:T|\b)/.test(text)) return null;
    const date = Date.parse(text.replace(/^20\d{2}\.\d{1,2}\.\d{1,2}/, match => match.replace(/\./g, '-')));
    return Number.isFinite(date) ? date : null;
}

function bundledCandidate(item, sourceDir) {
    const bundled = path.join(sourceDir, item.slug);
    if (!fs.existsSync(path.join(bundled, repo.TOOL_MANIFEST_FILE))) return null;
    const source = builtinToolsSync.validateBundledTool(sourceDir, item.slug);
    const version = source.manifest.tool.updatedAt || source.manifest.releaseVersion || null;
    const bundledTime = releaseTime(version);
    const marketTime = releaseTime(item.releasedAt || item.releaseVersion);
    return {
        fingerprint: source.fingerprint,
        files: source.files,
        version,
        comparable: bundledTime !== null && marketTime !== null,
        newer: bundledTime !== null && marketTime !== null && bundledTime > marketTime
    };
}

function compareCatalogTool(item, { targetDir = repo.CUSTOM_TOOLS_DIR, sourceDir = BUILTIN_SOURCE_DIR, platformVersion = require('../../package.json').version } = {}) {
    const toolDir = path.join(targetDir, item.slug);
    const exists = fs.existsSync(toolDir) && fs.statSync(toolDir).isDirectory();
    const manifest = exists ? readManifest(toolDir) : null;
    const managed = Boolean(manifest && manifest.system && manifest.system.managedBy === builtinToolsSync.SYSTEM_MARKER);
    const linked = Boolean(manifest && manifest.market && manifest.market.id === item.id) || managed;
    const bundled = bundledCandidate(item, sourceDir);
    const selectedSource = bundled && !bundled.comparable && bundled.fingerprint !== item.package.directoryFingerprint
        ? 'unknown' : bundled && bundled.newer ? 'builtin' : 'market';
    const selectedFingerprint = selectedSource === 'builtin' ? bundled.fingerprint : item.package.directoryFingerprint;
    const compatible = selectedSource === 'builtin' || versionAtLeast(platformVersion, item.minPlatformVersion);
    let localFingerprint = null;
    if (exists && linked && selectedSource !== 'unknown') {
        // Compare the actual release files, not a stale installation inventory.
        // Extra local assets are outside the release and must not trigger updates.
        const releaseFiles = selectedSource === 'builtin'
            ? bundled.files : item.package.files.map(file => file.path);
        try {
            localFingerprint = releaseFiles.every(file => fs.existsSync(path.join(toolDir, file)))
                ? fingerprintFiles(toolDir, releaseFiles)
                : null;
        } catch (_) { localFingerprint = null; }
    }
    let status = 'unchanged';
    if (selectedSource === 'unknown') status = 'unresolved';
    else if (!compatible) status = 'incompatible';
    else if (!exists) status = 'missing';
    else if (!linked) status = 'conflict';
    else if (localFingerprint !== selectedFingerprint) status = 'update';
    return {
        id: item.id,
        sourceId: item.sourceId || 'github',
        sourceName: item.sourceName || 'GitHub',
        slug: item.slug,
        name: item.tool.name || item.slug,
        nameEn: item.tool.nameEn || '',
        icon: item.tool.icon || '🧩',
        description: item.tool.description || '',
        descriptionEn: item.tool.descriptionEn || '',
        releaseVersion: selectedSource === 'builtin' ? bundled.version : item.releaseVersion,
        marketVersion: item.releaseVersion,
        builtinVersion: bundled && bundled.version || null,
        selectedSource,
        localVersion: manifest && manifest.market && manifest.market.releaseVersion || null,
        localSource: exists && !manifest?.market ? 'bundled' : null,
        releasedAt: item.releasedAt,
        minPlatformVersion: item.minPlatformVersion,
        changelog: item.changelog,
        packageSize: item.package.size,
        fingerprint: selectedFingerprint,
        packageSha256: item.package.sha256,
        status,
        compatible,
        localModified: exists && linked ? hasLocalChanges(toolDir, manifest) : false,
        recommended: ['missing', 'update'].includes(status) && compatible
    };
}

async function loadCatalog({ force = false, url = String(process.env.TOOLS_MARKET_CATALOG_URL || DEFAULT_CATALOG_URL).trim(), allowPrivate = false, onProgress } = {}) {
    const cached = catalogCache.get(url);
    if (!force && cached && Date.now() - cached.loadedAt < CACHE_MS) {
        onProgress?.({ stage: 'catalog_cached', count: cached.value.tools.length });
        return cached.value;
    }
    onProgress?.({ stage: 'catalog_fetching' });
    const parsedUrl = new URL(url);
    const suffix = parsedUrl.search ? `&t=${Date.now()}` : `?t=${Date.now()}`;
    const buffer = await fetchBuffer(`${url}${suffix}`, { limit: CATALOG_MAX_BYTES, catalogHostname: parsedUrl.hostname, allowPrivate });
    onProgress?.({ stage: 'catalog_received', bytes: buffer.length });
    let raw;
    try { raw = JSON.parse(buffer.toString('utf8')); } catch (_) { throw new Error('工具市场目录不是有效 JSON'); }
    const trust = verifyCatalogSignature(raw);
    onProgress?.({ stage: 'catalog_parsed', count: Array.isArray(raw.tools) ? raw.tools.length : 0 });
    const catalog = validateCatalog(raw, url);
    onProgress?.({ stage: 'catalog_validated', count: catalog.tools.length });
    const value = { ...catalog, trust, catalogUrl: url };
    catalogCache.set(url, { loadedAt: Date.now(), value });
    return value;
}

async function loadEnabledCatalogs(options = {}) {
    const settings = await getMarketSettings();
    const sources = [
        { id: 'github', name: 'GitHub', url: String(process.env.TOOLS_MARKET_CATALOG_URL || DEFAULT_CATALOG_URL).trim(), enabled: settings.githubEnabled, allowPrivate: false },
        ...settings.sources.map(source => ({ ...source, allowPrivate: true }))
    ];
    options.onProgress?.({ stage: 'sources_ready', count: sources.filter(source => source.enabled).length });
    const results = await Promise.all(sources.filter(source => source.enabled).map(async source => {
        const report = event => options.onProgress?.({ ...event, sourceName: source.name });
        report({ stage: 'source_start' });
        try {
            const catalog = await loadCatalog({ ...options, url: source.url, allowPrivate: source.allowPrivate, onProgress: report });
            report({ stage: 'source_done', count: catalog.tools.length });
            return { source, catalog };
        } catch (error) {
            report({ stage: 'source_error', error: error.message });
            return { source, error: error.message };
        }
    }));
    const seen = new Set();
    const tools = [];
    for (const result of results) {
        if (!result.catalog) continue;
        for (const item of result.catalog.tools) {
            if (seen.has(item.slug)) continue;
            seen.add(item.slug);
            tools.push({ ...item, sourceId: result.source.id, sourceName: result.source.name, catalogUrl: result.catalog.catalogUrl, allowPrivate: result.source.allowPrivate });
        }
    }
    const loaded = results.filter(result => result.catalog);
    options.onProgress?.({ stage: 'catalogs_merged', count: tools.length, sourceCount: loaded.length });
    return { tools, sources: sources.map(source => ({ id: source.id, name: source.name, enabled: source.enabled,
        error: results.find(result => result.source.id === source.id)?.error || null })),
        trust: { state: loaded.length && loaded.every(result => result.catalog.trust.state === 'verified') ? 'verified' : 'unsigned' } };
}

async function previewMarket(options = {}) {
    const catalog = await loadEnabledCatalogs(options);
    options.onProgress?.({ stage: 'tools_comparing', count: catalog.tools.length });
    const tools = catalog.tools.map(item => compareCatalogTool(item));
    options.onProgress?.({ stage: 'preview_done', count: tools.length });
    return {
        sources: catalog.sources,
        trust: catalog.trust,
        tools,
        counts: tools.reduce((result, tool) => {
            result[tool.status] = (result[tool.status] || 0) + 1;
            return result;
        }, {})
    };
}

function safeArchivePath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized) || parts.some(part => part === '.' || part === '..')) return null;
    return parts.join('/');
}

async function extractPackage(buffer, targetDir) {
    const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
    const entries = Object.values(zip.files).filter(entry => !entry.dir);
    if (!entries.length || entries.length > MAX_FILES) throw new Error('工具包文件数量无效');
    let total = 0;
    for (const entry of entries) {
        if (typeof entry.unixPermissions === 'number' && (entry.unixPermissions & 0o170000) === 0o120000) throw new Error('工具包不允许包含符号链接');
        const relativePath = safeArchivePath(entry.unsafeOriginalName || entry.name);
        if (!relativePath) throw new Error(`工具包包含不安全路径：${entry.name}`);
        const content = await entry.async('nodebuffer');
        total += content.length;
        if (total > EXTRACTED_MAX_BYTES) throw new Error('工具包解压后超过大小限制');
        const output = path.join(targetDir, relativePath);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, content);
    }
}

function annotateInstalledTool(item) {
    const target = path.join(repo.CUSTOM_TOOLS_DIR, item.slug, repo.TOOL_MANIFEST_FILE);
    const manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
    manifest.market = {
        id: item.id,
        publisher: item.sourceName || 'GitHub',
        sourceId: item.sourceId || 'github',
        releaseVersion: item.releaseVersion,
        packageSha256: item.package.sha256,
        directoryFingerprint: item.package.directoryFingerprint,
        installedAt: new Date().toISOString(),
        files: item.package.files
    };
    const temp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, target);
}

function logMarketUpdates(changed, backups) {
    for (const slug of changed) console.log(`[tool-market] 工具更新已生效 ${slug}：${path.join(repo.CUSTOM_TOOLS_DIR, slug)}`);
    for (const backup of backups) console.log(`[tool-market] 更新前备份 ${backup.slug}：${backup.path}`);
}

async function applyMarketUpdates({ slugs = [], adoptSlugs = [], expectedFingerprints = {}, expectedSources = {}, onProgress } = {}) {
    const selected = [...new Set(slugs.map(normalizeSlug).filter(Boolean))];
    const allowedAdoptions = new Set(adoptSlugs.map(normalizeSlug).filter(slug => selected.includes(slug)));
    if (!selected.length) return { installed: [], adopted: [], updated: [], changed: [], backups: [], invalid: [], preview: await previewMarket() };
    onProgress?.({ stage: 'apply_start', count: selected.length });
    const catalog = await loadEnabledCatalogs({ force: true, onProgress });
    const items = new Map(catalog.tools.map(item => [item.slug, item]));
    const current = new Map(catalog.tools.map(item => [item.slug, compareCatalogTool(item)]));
    for (const slug of selected) {
        const item = items.get(slug);
        const comparison = current.get(slug);
        if (!item) throw Object.assign(new Error(`工具市场中不存在 ${slug}`), { status: 404 });
        if (expectedSources[slug] && expectedSources[slug] !== item.sourceId) throw Object.assign(new Error(`${slug} 的仓库来源已变化，请重新加载市场`), { status: 409 });
        if (expectedFingerprints[slug] !== comparison.fingerprint) throw Object.assign(new Error(`${slug} 的推荐来源已变化，请重新加载市场`), { status: 409 });
        if (comparison.status === 'conflict' && !allowedAdoptions.has(slug)) {
            throw Object.assign(new Error(`${slug} 与未关联的本地工具同名，需要明确确认接管`), { status: 409 });
        }
        if (comparison.status === 'incompatible') throw Object.assign(new Error(`${slug} 需要平台 ${item.minPlatformVersion} 或更高版本`), { status: 409 });
        if (comparison.status === 'unresolved') throw Object.assign(new Error(`${slug} 缺少可比较的内置或市场发布日期，已停止自动更新`), { status: 409 });
        if (comparison.status === 'unchanged') throw Object.assign(new Error(`${slug} 已是最新版本，请重新加载市场`), { status: 409 });
    }
    const bundledSlugs = selected.filter(slug => current.get(slug).selectedSource === 'builtin');
    const marketSlugs = selected.filter(slug => current.get(slug).selectedSource === 'market');
    let bundledResult = { installed: [], adopted: [], updated: [], backups: [], invalid: [] };
    if (bundledSlugs.length) {
        onProgress?.({ stage: 'bundled_installing', count: bundledSlugs.length });
        bundledResult = builtinToolsSync.applyBuiltinToolDecisions({
            sourceDir: BUILTIN_SOURCE_DIR,
            targetDir: repo.CUSTOM_TOOLS_DIR,
            backupRoot: path.join(getDataDir(), 'backups', 'tool-market'),
            applySlugs: bundledSlugs,
            preserveInstalledRelease: false,
            expectedFingerprints: Object.fromEntries(bundledSlugs.map(slug => [slug, current.get(slug).fingerprint]))
        });
        onProgress?.({ stage: 'bundled_done', count: bundledResult.installed.length + bundledResult.adopted.length + bundledResult.updated.length });
    }
    if (!marketSlugs.length) {
        const changed = [...bundledResult.installed, ...bundledResult.adopted, ...bundledResult.updated];
        logMarketUpdates(changed, bundledResult.backups);
        onProgress?.({ stage: 'apply_done', count: changed.length });
        return { ...bundledResult, changed, preview: await previewMarket() };
    }
    const tempParent = path.join(getDataDir(), 'tmp', 'tool-market');
    fs.mkdirSync(tempParent, { recursive: true });
    const sourceDir = fs.mkdtempSync(path.join(tempParent, 'apply-'));
    try {
        for (const slug of marketSlugs) {
            const item = items.get(slug);
            onProgress?.({ stage: 'package_fetching', slug });
            const buffer = await fetchBuffer(item.package.url, { limit: PACKAGE_MAX_BYTES, catalogHostname: new URL(item.catalogUrl).hostname, allowPrivate: item.allowPrivate });
            onProgress?.({ stage: 'package_received', slug, bytes: buffer.length });
            if (buffer.length !== item.package.size || sha256(buffer) !== item.package.sha256) throw new Error(`${slug} 工具包 SHA-256 或大小校验失败`);
            onProgress?.({ stage: 'package_verified', slug });
            const toolSource = path.join(sourceDir, slug);
            fs.mkdirSync(toolSource, { recursive: true });
            await extractPackage(buffer, toolSource);
            onProgress?.({ stage: 'package_extracted', slug });
        }
        const sourcePreview = builtinToolsSync.previewBuiltinTools({ sourceDir, targetDir: repo.CUSTOM_TOOLS_DIR, includeSkipped: true, preserveInstalledRelease: false });
        const sourceMap = new Map(sourcePreview.tools.map(item => [item.slug, item]));
        for (const slug of marketSlugs) {
            if (sourceMap.get(slug)?.fingerprint !== items.get(slug).package.directoryFingerprint) throw new Error(`${slug} 解压内容指纹与目录不一致`);
            onProgress?.({ stage: 'directory_verified', slug });
        }
        onProgress?.({ stage: 'tools_installing', count: marketSlugs.length });
        const result = builtinToolsSync.applyBuiltinToolDecisions({
            sourceDir,
            targetDir: repo.CUSTOM_TOOLS_DIR,
            backupRoot: path.join(getDataDir(), 'backups', 'tool-market'),
            applySlugs: marketSlugs,
            preserveInstalledRelease: false,
            expectedFingerprints: Object.fromEntries(marketSlugs.map(slug => [slug, sourceMap.get(slug).fingerprint]))
        });
        const marketChanged = [...result.installed, ...result.adopted, ...result.updated];
        marketChanged.forEach(slug => annotateInstalledTool(items.get(slug)));
        const changed = [...bundledResult.installed, ...bundledResult.adopted, ...bundledResult.updated, ...marketChanged];
        logMarketUpdates(changed, [...bundledResult.backups, ...result.backups]);
        onProgress?.({ stage: 'apply_done', count: changed.length });
        return {
            ...result,
            installed: [...bundledResult.installed, ...result.installed],
            adopted: [...bundledResult.adopted, ...result.adopted],
            updated: [...bundledResult.updated, ...result.updated],
            backups: [...bundledResult.backups, ...result.backups],
            invalid: [...bundledResult.invalid, ...result.invalid],
            changed,
            preview: await previewMarket()
        };
    } finally {
        fs.rmSync(sourceDir, { recursive: true, force: true });
    }
}

module.exports = {
    DEFAULT_CATALOG_URL,
    applyMarketUpdates,
    compareCatalogTool,
    getMarketSettings,
    loadCatalog,
    loadEnabledCatalogs,
    previewMarket,
    saveMarketSettings,
    validateCatalog,
    verifyCatalogSignature,
    versionAtLeast
};
