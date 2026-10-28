// Python Web 应用包：识别 ZIP 结构、校验路径并推断 uvicorn 入口。
// 支持 ASGI（FastAPI / Starlette）与 WSGI（Flask / Django）；平台只用 uvicorn 在 127.0.0.1 上启动，不执行包里的 run.py。
const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');

const MAX_ARCHIVE_BYTES = 35 * 1024 * 1024;
const MAX_FILES = 3000;
const MAX_UNPACKED_BYTES = 300 * 1024 * 1024;
const HOST_MODULE = '_platform_host';
// 运行期目录与缓存不进入托管目录；wheels/ 保留用于离线安装依赖
const SKIPPED = /(?:^|\/)(?:\.venv|venv|env|__pycache__|\.git|\.idea|\.vscode|node_modules|logs|\.pytest_cache|\.mypy_cache)(?:\/|$)|\.py[co]$/i;
const ENTRY_RE = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*:[A-Za-z_][\w]*$/;

const fail = (message, code = 'HOSTED_APP_PACKAGE_INVALID') => Object.assign(new Error(message), { code, status: 400 });

function normalizeArchivePath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return null;
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part === '..' || part === '.')) return null;
    return parts.join('/');
}

const isMacMetadata = name => String(name || '').split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'));
const depth = name => name.split('/').length;

// 应用根目录：最浅的 requirements.txt 所在目录，且该目录下有可识别的应用代码或 platform-app.json
function findRoot(names) {
    const set = new Set(names);
    const candidates = names.filter(name => /(^|\/)requirements\.txt$/i.test(name)).sort((a, b) => depth(a) - depth(b));
    for (const requirements of candidates) {
        const prefix = requirements.slice(0, requirements.length - 'requirements.txt'.length);
        if (['platform-app.json', 'run.py', 'app/main.py', 'main.py', 'app.py', 'server.py', 'asgi.py', 'wsgi.py'].some(file => set.has(prefix + file))) return prefix;
    }
    return null;
}

/** 浏览器端与服务端共用的快速判断：只看文件名，不解压内容。 */
function looksLikePythonApp(names) {
    const clean = names.map(normalizeArchivePath).filter(name => name && !isMacMetadata(name));
    const root = findRoot(clean);
    if (root === null) return false;
    // 网页工具包带的 requirements.txt（比入口 HTML 更深）不算 Python 应用
    const html = clean.filter(name => /(^|\/)index\.html?$/i.test(name)).sort((a, b) => depth(a) - depth(b))[0];
    return !html || depth(html) > depth(`${root}requirements.txt`);
}

function detectEntry(read) {
    const candidates = [['app/main.py', 'app.main'], ['main.py', 'main'], ['app.py', 'app'], ['server.py', 'server'], ['asgi.py', 'asgi'], ['wsgi.py', 'wsgi'], ['run.py', 'run']];
    for (const [file, module] of candidates) {
        const source = read(file);
        if (!source) continue;
        const wsgi = /^\s*(?:from\s+flask\b|import\s+flask\b|from\s+django\b)/m.test(source) || module === 'wsgi';
        if (/^\s*(?:async\s+)?def\s+create_app\s*\(/m.test(source)) return { entry: `${module}:create_app`, factory: true, interface: wsgi ? 'wsgi' : 'asgi' };
        const instance = /^([A-Za-z_]\w*)\s*(?::\s*\w+\s*)?=\s*(?:fastapi\.)?(FastAPI|Starlette|Flask|Quart)\s*\(/m.exec(source);
        if (instance) return { entry: `${module}:${instance[1]}`, factory: false, interface: instance[2] === 'Flask' ? 'wsgi' : 'asgi' };
        const django = /^(application)\s*=\s*get_(wsgi|asgi)_application\s*\(/m.exec(source);
        if (django) return { entry: `${module}:application`, factory: false, interface: django[2] };
        // run.py 只用于找它启动的模块，例如 uvicorn.run("app.main:create_app", factory=True)
        const launched = /uvicorn\.run\(\s*["']([\w.]+:\w+)["'][^)]*?(factory\s*=\s*True)?/s.exec(source);
        if (launched) return { entry: launched[1], factory: Boolean(launched[2]), interface: 'asgi' };
    }
    return null;
}

function parseManifest(text) {
    if (!text) return {};
    let manifest;
    try { manifest = JSON.parse(text); } catch (_error) { throw fail('platform-app.json 不是有效 JSON'); }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw fail('platform-app.json 必须是对象');
    return manifest;
}

/**
 * 解析 Python 应用包，返回去掉根目录前缀的文件列表与运行配置。
 * @param {Buffer} archive ZIP 原始字节
 */
async function inspectArchive(archive) {
    if (!Buffer.isBuffer(archive) || !archive.length) throw fail('应用包为空');
    if (archive.length > MAX_ARCHIVE_BYTES) throw fail('应用包不能超过 35 MB；依赖较多时可去掉 wheels/ 改为在线安装');
    let zip;
    try { zip = await JSZip.loadAsync(archive, { checkCRC32: true }); } catch (error) { throw fail(`ZIP 解析失败：${error.message || '文件已损坏'}`); }
    const entries = Object.values(zip.files).filter(entry => !entry.dir && !isMacMetadata(entry.name));
    for (const entry of entries) {
        if (entry.unsafeOriginalName && normalizeArchivePath(entry.unsafeOriginalName) !== entry.name) throw fail(`应用包包含不安全的文件路径：${entry.unsafeOriginalName}`);
        if (typeof entry.unixPermissions === 'number' && (entry.unixPermissions & 0o170000) === 0o120000) throw fail(`应用包不允许包含符号链接：${entry.name}`);
        if (!normalizeArchivePath(entry.name)) throw fail(`应用包包含不安全的文件路径：${entry.name}`);
    }
    const names = entries.map(entry => normalizeArchivePath(entry.name));
    if (!looksLikePythonApp(names)) throw fail('未识别为 Python Web 应用：根目录需要 requirements.txt，以及 app/main.py、main.py、app.py 或 platform-app.json');
    const root = findRoot(names);
    const files = [];
    let total = 0;
    for (const entry of entries) {
        const name = normalizeArchivePath(entry.name);
        if (!name.startsWith(root)) continue;
        const relative = name.slice(root.length);
        if (!relative || SKIPPED.test(relative)) continue;
        if (relative.split('/')[0] === `${HOST_MODULE}.py`) throw fail(`${HOST_MODULE}.py 是平台保留的文件名，请改名后再导入`);
        if (files.length >= MAX_FILES) throw fail(`应用包文件数不能超过 ${MAX_FILES} 个`);
        const content = await entry.async('nodebuffer');
        total += content.length;
        if (total > MAX_UNPACKED_BYTES) throw fail('应用包解压后不能超过 300 MB');
        files.push([relative, content]);
    }
    const read = file => files.find(([name]) => name === file)?.[1].toString('utf8') || '';
    const manifest = parseManifest(read('platform-app.json'));
    const detected = manifest.entry ? null : detectEntry(read);
    const entry = String(manifest.entry || detected?.entry || '');
    if (!ENTRY_RE.test(entry)) throw fail('未找到应用入口：请在 platform-app.json 中声明 entry，例如 {"entry": "app.main:app"}');
    const iface = String(manifest.interface || detected?.interface || 'asgi').toLowerCase();
    if (!['asgi', 'wsgi'].includes(iface)) throw fail('platform-app.json 的 interface 只支持 asgi 或 wsgi');
    const versionFile = files.find(([name]) => /^[^/]+\.version$/i.test(name));
    const healthPath = String(manifest.healthPath || '/');
    if (!/^\/[\w\-./]*$/.test(healthPath)) throw fail('healthPath 必须是以 / 开头的路径');
    const requirements = read('requirements.txt');
    const wheels = files.filter(([name]) => /^wheels\/[^/]+\.(?:whl|tar\.gz|zip)$/i.test(name)).map(([name]) => name);
    return {
        files,
        root: root.replace(/\/$/, ''),
        config: {
            name: String(manifest.name || (versionFile ? path.posix.basename(versionFile[0], '.version') : '') || '').slice(0, 80),
            version: String(manifest.version || (versionFile ? versionFile[1].toString('utf8').trim().split(/\s/)[0] : '') || '').slice(0, 32),
            entry,
            factory: manifest.factory === undefined ? Boolean(detected?.factory) : manifest.factory === true,
            interface: iface,
            healthPath,
            description: String(manifest.description || '').slice(0, 1000)
        },
        requirementsHash: crypto.createHash('sha256').update(requirements).update(wheels.join('\n')).digest('hex'),
        offlineWheels: wheels.length,
        fileCount: files.length,
        totalBytes: total
    };
}

module.exports = { inspectArchive, looksLikePythonApp, detectEntry, normalizeArchivePath, HOST_MODULE, MAX_ARCHIVE_BYTES };
