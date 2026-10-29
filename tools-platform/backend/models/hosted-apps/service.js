// 托管应用与自定义工具的衔接：导入时登记为工具菜单入口（启动页），后台安装依赖并启动；删除工具时一并停止并清理。
const runtime = require('./runtime');
const appPackage = require('./package');
const proxy = require('./proxy');
const tenant = require('../tenant-context');

const LAUNCHER_TAG = 'Python 应用';

function launcherHtml(slug, name) {
    const escape = value => String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="hosted-app" content="${escape(slug)}">
<title>${escape(name)}</title>
<link rel="stylesheet" href="/css/hosted-app-launcher.css">
</head>
<body data-hosted-app="${escape(slug)}">
<script src="/js/shared/app-dialog.js"></script>
<script src="/js/shared/toast.js"></script>
<script src="/js/shared/ide-highlighter.js"></script>
<script src="/js/hosted-app-launcher.js"></script>
</body>
</html>
`;
}

function archiveBuffer(payload) {
    const raw = String(payload.archiveBase64 || '');
    if (!raw) return null;
    return Buffer.from(raw, 'base64');
}

/** 只看文件名判断是否 Python 应用包，避免把普通网页 ZIP 交给 Python 解析。 */
async function isPythonPayload(payload) {
    const buffer = archiveBuffer(payload);
    if (!buffer || !/\.zip$/i.test(String(payload.archiveName || '.zip'))) return false;
    try {
        const zip = await require('jszip').loadAsync(buffer);
        return appPackage.looksLikePythonApp(Object.values(zip.files).filter(entry => !entry.dir).map(entry => entry.name));
    } catch (_error) {
        return false;
    }
}

/** 导入弹窗预览：识别结果、Python 环境、同名已托管应用（可选择更新）。 */
async function preview(payload) {
    const inspected = await appPackage.inspectArchive(archiveBuffer(payload));
    const python = await runtime.findPython();
    const existing = runtime.listApps().filter(app => inspected.config.name && app.packageName === inspected.config.name)
        .map(app => ({ slug: app.slug, name: app.name, version: app.version, status: app.status }));
    return { ...inspected.config, root: inspected.root, fileCount: inspected.fileCount, totalBytes: inspected.totalBytes, offlineWheels: inspected.offlineWheels,
        python: python.ok ? { ok: true, version: python.version } : { ok: false, message: python.message }, existing };
}

function startInBackground(slug, tenantId) {
    tenant.runWithTenant(tenantId, () => {
        runtime.start(slug).catch(error => console.warn(`[hosted-apps] ${tenantId}/${slug} 安装或启动失败：${error.message}`));
    });
}

/**
 * 导入 Python 应用：登记自定义工具（启动页）→ 写入应用目录 → 后台安装依赖并启动。
 * payload.updateSlug 指向已托管应用时只更新代码，保留应用库与密钥。
 */
async function importApp(payload, { createTool, user = '' }) {
    const inspected = await appPackage.inspectArchive(archiveBuffer(payload));
    const tenantId = tenant.getTenantId();
    if (payload.updateSlug) {
        const slug = runtime.assertSlug(String(payload.updateSlug));
        const { wasRunning } = await runtime.updateApp(slug, inspected);
        runtime.savePackage(slug, archiveBuffer(payload), payload.archiveName);
        if (wasRunning || runtime.readState(slug)?.desired === 'running') startInBackground(slug, tenantId);
        const tool = await require('../custom-tools-repository').getTool(slug);
        return { ...(tool || { slug }), hostedApp: runtime.status(slug), updated: true };
    }
    const name = String(payload.name || inspected.config.name || '').trim();
    const tags = Array.isArray(payload.tags) ? payload.tags.filter(tag => !/^(?:自定义 HTML|Custom HTML)$/i.test(tag)) : [];
    const tool = await createTool({
        ...payload,
        archiveBase64: undefined,
        archiveName: undefined,
        name,
        icon: !payload.icon || payload.icon === '🧩' ? '🐍' : payload.icon,
        description: payload.description || inspected.config.description,
        tags: [LAUNCHER_TAG, ...tags.filter(tag => tag !== LAUNCHER_TAG)].slice(0, 8),
        htmlContent: launcherHtml('__slug__', name)
    });
    try {
        // 启动页需要真实 slug：工具登记后再写入
        require('fs').writeFileSync(require('path').join(require('../custom-tools-repository').getToolRootDir(tool.slug), 'index.html'), launcherHtml(tool.slug, name));
        runtime.createApp(tool.slug, inspected, { name, user });
        runtime.savePackage(tool.slug, archiveBuffer(payload), payload.archiveName);
    } catch (error) {
        await require('../custom-tools-repository').deleteTool(tool.slug).catch(() => {});
        throw error;
    }
    startInBackground(tool.slug, tenantId);
    return { ...tool, hostedApp: runtime.status(tool.slug) };
}

// ── 随源码内置：工具目录里的 hosted-app.zip 是应用包（转为内置时写入，已剔除 .env） ──
const BUNDLED_PACKAGE = 'hosted-app.zip';
const ENV_FILE = /(^|\/)\.env(\.[^/]*)?$/i;
const bundleLocks = new Map();

/** 生成写入源码的应用包：原始包（或按当前代码重新打包）去掉 .env 等本地配置，.env.example 保留。 */
async function packageForSource(slug) {
    const archive = await runtime.packageArchive(slug);
    if (!archive) throw Object.assign(new Error('应用不存在'), { status: 404 });
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(archive.buffer);
    const removed = [];
    Object.keys(zip.files).forEach(name => {
        if (ENV_FILE.test(name) && !/\.env\.example$/i.test(name)) { removed.push(name); zip.remove(name); }
    });
    return { buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), removed };
}

/**
 * 内置工具在新环境 / 其他租户首次打开时，用随源码带来的应用包创建托管应用；
 * 源码里的包更新后（哈希变化）更新应用代码，保留应用库与密钥。并发打开合并为一次。
 */
function ensureFromBundle(slug) {
    const tenantId = tenant.getTenantId();
    const key = `${tenantId}/${slug}`;
    if (bundleLocks.has(key)) return bundleLocks.get(key);
    const task = (async () => {
        const repo = require('../custom-tools-repository');
        const file = require('path').join(repo.getToolRootDir(slug) || '', BUNDLED_PACKAGE);
        if (!require('fs').existsSync(file)) return false;
        const buffer = require('fs').readFileSync(file);
        const hash = require('crypto').createHash('sha256').update(buffer).digest('hex');
        const state = runtime.readState(slug);
        if (state && (!state.bundleHash || state.bundleHash === hash)) {
            if (!state.bundleHash) runtime.updateState(slug, { bundleHash: hash });
            return false;
        }
        const inspected = await appPackage.inspectArchive(buffer);
        if (!state) {
            const tool = await repo.getTool(slug);
            runtime.createApp(slug, inspected, { name: tool?.name || inspected.config.name || slug, user: 'builtin' });
        } else {
            await runtime.updateApp(slug, inspected);
        }
        runtime.savePackage(slug, buffer, `${inspected.config.name || slug}.zip`);
        runtime.updateState(slug, { bundleHash: hash, desired: 'running' });
        return true;
    })().finally(() => bundleLocks.delete(key));
    bundleLocks.set(key, task);
    return task;
}

/** 启动页调用：未运行则后台启动，运行中则签发当前用户的访问链接。 */
async function launch(slug, user) {
    await ensureFromBundle(runtime.assertSlug(slug));
    const state = runtime.status(slug);
    if (!state) return null;
    // 停止 / 崩溃 → 重新启动；「安装中 / 启动中」但后台没有任务（内置应用刚从源码包创建、或安装中途平台重启）→ 重新开始安装
    const stalled = ['installing', 'starting'].includes(state.status) && !runtime.isActive(slug);
    if ((['stopped', 'crashed'].includes(state.status) || stalled) && runtime.readState(slug)?.desired !== 'stopped') startInBackground(slug, tenant.getTenantId());
    const current = runtime.status(slug);
    const result = { ...current, isAdmin: user.role === 'admin' };
    if (current.status === 'running') {
        const { token, expiresAt } = proxy.issueToken({ tenantId: tenant.getTenantId(), slug, username: user.username, role: user.role });
        result.entryUrl = proxy.entryUrl(slug, token);
        result.entryExpiresAt = expiresAt;
    }
    if (user.role !== 'admin') {
        delete result.port;
        delete result.pid;
        delete result.entry;
        result.lastError = current.lastError ? '应用暂时不可用，请联系管理员' : '';
    }
    return result;
}

const LAUNCHER_MARKER = '<meta name="hosted-app"';

/** 工具入口是否为托管应用启动页（只看文件头部，不依赖租户上下文）：托管应用是动态服务，不参与静态推送。 */
function isLauncherFile(indexPath) {
    let fd;
    try {
        fd = require('fs').openSync(indexPath, 'r');
        const buffer = Buffer.alloc(1024);
        const read = require('fs').readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, read).toString('utf8').includes(LAUNCHER_MARKER);
    } catch (_error) {
        return false;
    } finally {
        if (fd !== undefined) require('fs').closeSync(fd);
    }
}

async function removeIfHosted(slug) {
    if (!runtime.exists(slug)) return false;
    return runtime.removeApp(slug);
}

module.exports = { isPythonPayload, preview, importApp, launch, removeIfHosted, launcherHtml, isLauncherFile, packageForSource, ensureFromBundle, BUNDLED_PACKAGE, LAUNCHER_TAG };
