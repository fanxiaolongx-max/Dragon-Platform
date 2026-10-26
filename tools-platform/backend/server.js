/**
 * Tools Platform - 主服务入口
 * 统一管理 UIVF12 Catcher 和 Task SLA Killer 的后端 API
 */
const dailyFileConsole = require('./logger/daily-file-console');
dailyFileConsole.installDailyFileConsole();
const { runPreflight } = require('./preflight');

const PORT = process.env.PORT || 3030;

if (!runPreflight({ port: PORT })) {
    process.exit(1);
}

// A factory-reset worker runs after the previous process exits so Windows can
// release SQLite file locks. Process managers may restart immediately; wait
// briefly for the pending plan to finish before any database is opened.
function waitForPendingFactoryReset(maxWaitMs = 45000) {
    const fs = require('fs');
    const path = require('path');
    const dataDir = process.env.TOOLS_DATA_DIR || path.join(__dirname, 'data');
    const resetRoot = path.resolve(dataDir, '../factory-reset-archives');
    if (!fs.existsSync(resetRoot)) return;
    const pendingPlans = () => fs.readdirSync(resetRoot).filter(name => /^pending-.*\.json$/.test(name));
    const deadline = Date.now() + maxWaitMs;
    let pending = pendingPlans();
    if (pending.length) console.log('[FACTORY RESET] Waiting for the pending reset worker to finish...');
    while (pending.length && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
        pending = pendingPlans();
    }
    if (pending.length) {
        console.warn(`[FACTORY RESET] Pending reset did not finish within ${maxWaitMs}ms; check ${resetRoot} before using the service.`);
        process.exit(1);
    }
}

waitForPendingFactoryReset();

const { repairStartupDatabases } = require('./models/sqlite-integrity-repair');

(async () => {
    await repairStartupDatabases();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const appPackage = require('../package.json');

const uivRoutes = require('./routes/uiv');
const uivAutoImportRoutes = require('./routes/uiv-auto-import');
const uivAiAdapterRoutes = require('./routes/uiv-ai-adapter');
const slaRoutes = require('./routes/sla');
const uploadRoutes = require('./routes/upload');
const authRoutes = require('./routes/auth');
const requirementsRoutes = require('./routes/requirements');
const { router: mediaRoutes, VIDEOS_DIR, mediaAssetGuard } = require('./routes/media');
const aiRoutes = require('./routes/ai');
const storageRoutes = require('./routes/storage');
const frtRoutes = require('./routes/frt');
const topicSnapshotsRoutes = require('./routes/topic-snapshots');
const prauditRoutes = require('./routes/praudit');
const chatHistoryRoutes = require('./routes/chat-history');
const customToolsRoutes = require('./routes/custom-tools');
const monthlySnapshotsRoutes = require('./routes/monthly-snapshots');
const meetingSnapshotsRoutes = require('./routes/meeting-snapshots');
const operationIncentiveSnapshotsRoutes = require('./routes/operation-incentive-snapshots');
const f12LicensePublicRoutes = require('./routes/f12-license-public');
const desktopLicenseLocal = require('./routes/desktop-license-local');
const isDesktopRuntime = process.env.TOOLS_DESKTOP_RUNTIME === '1';
const desktopLicensePublicRoutes = !isDesktopRuntime ? require('./routes/desktop-license-public') : null;
const desktopLicenseAdminRoutes = !isDesktopRuntime ? require('./routes/desktop-license-admin') : null;
const slideDesignRoutes = require('./routes/slide-design');
const surveysRoutes = require('./routes/surveys');
const externalMetricsRoutes = require('./routes/external-metrics');
const customToolsRepo = require('./models/custom-tools-repository');
const customToolI18nService = require('./models/custom-tool-i18n-service');
const assetVersioning = require('./models/asset-versioning');
const pageUpdateTimes = require('./models/page-update-times');
const { initializeTenantBuiltinTools } = require('./models/builtin-tools-startup');
const { ensureBuiltinToolAssets } = require('./models/builtin-assets-unpacker');
const { DATA_DIR } = require('./models/store');
const navSettingsRoutes = require('./routes/nav-settings');
const aiSettingsRoutes = require('./routes/ai-settings');
const globalBackupRoutes = require('./routes/global-backup');
const alertCenterRoutes = require('./routes/alert-center');
const platformMetricsRoutes = require('./routes/platform-metrics');
const friendLinksRoutes = require('./routes/friend-links');
const onboardingRoutes = require('./routes/onboarding');
const tenantsRoutes = require('./routes/tenants');
const { DEFAULT_TENANT_ID, runWithTenant, tenantMiddleware } = require('./models/tenant-context');
const { initializeDefaultBusinessSchema } = require('./models/business-schema-initializer');
const friendLinksService = require('./models/friend-links-service');
const serviceStatusRepo = require('./models/service-status-repository');
dailyFileConsole.setRuntimeLogSink(event => {
    if (String(event.detail || '').includes('/api/platform-metrics/service-status/logs')) return null;
    const apiMatch = String(event.detail || '').match(/\]\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)\s+#(\S+).*?→\s+(\d{3})\s+\((\d+)ms\)/);
    const apiStatus = apiMatch ? Number(apiMatch[4]) : null;
    return serviceStatusRepo.recordRuntimeLog({
        ...event,
        level: apiStatus >= 500 ? 'ERROR' : apiStatus >= 400 ? 'WARN' : event.level,
        requestId: apiMatch?.[3] || '',
        serviceKey: apiMatch ? serviceStatusRepo.resolveService(apiMatch[2]).id : '',
        statusCode: apiStatus,
        durationMs: apiMatch ? Number(apiMatch[5]) : null
    });
});
const globalBackupRepo = require('./models/global-backup-repository');
const snapshotPublishService = require('./models/snapshot-publish-service');
const remoteBackupSyncRepo = require('./models/remote-backup-sync-repository');
const legacyJsonMigration = require('./models/legacy-json-migration');
const configChangeMonitor = require('./models/config-change-monitor');
const alertAiAnalyzer = require('./models/alert-ai-analyzer');
const { checkAuth, requireAdmin, checkHtmlAuth } = require('./middleware/auth');

const app = express();

// ============================================================
// 中间件
// ============================================================
app.use(cors());
app.use('/api/custom-tools/import-upload', express.json({ limit: 850000 }));
app.use('/api/topic-snapshots/import-upload', express.json({ limit: 850000 }));
app.use('/api/requirements/uploads', express.json({ limit: 800000 }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
    const incoming = req.get('x-request-id') || req.get('x-correlation-id');
    req.requestId = incoming || `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    res.setHeader('X-Request-Id', req.requestId);
    next();
});

app.use('/api/desktop-license', desktopLicenseLocal.router);
if (desktopLicensePublicRoutes) app.use('/api/public/desktop-license', desktopLicensePublicRoutes);

// EXE 运行时由 Electron 维护授权状态。授权失效后阻止业务页面和 API，但保留健康检查与静态资源。
app.use((req, res, next) => {
    if (!isDesktopRuntime) return next();
    if (
        req.path === '/api/desktop-license/status'
        || req.path === '/api/platform-metrics/service-status'
        || req.path === '/api/platform-metrics/service-status/logs'
        || req.path === '/api/health'
    ) return next();
    const ext = path.extname(req.path).toLowerCase();
    if (ext && ext !== '.html') return next();
    const status = desktopLicenseLocal.getStatus();
    if (status.valid) return next();
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'EXE License 已失效', reasonCode: status.reasonCode });
    }
    return res.status(403).send(`<!doctype html><meta charset="utf-8"><title>License</title><style>body{font-family:Segoe UI,"Microsoft YaHei";background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:32px;border:1px solid #334155;border-radius:18px;background:#111827;text-align:center}</style><main><h1>Tools Platform License 已失效</h1><p>请联系管理员续期或恢复授权，然后重新启动 EXE。</p><small>${String(status.reasonCode || 'LICENSE_REQUIRED')}</small></main>`);
});

const SENSITIVE_LOG_KEYS = new Set([
    'authorization',
    'password',
    'token',
    'access_token',
    'refresh_token',
    'api_key',
    'apikey',
    'secret'
]);

function shouldRedactLogKey(key) {
    const normalized = String(key || '').toLowerCase();
    return SENSITIVE_LOG_KEYS.has(normalized) || normalized.includes('password') || normalized.includes('token');
}

function redactForLog(value) {
    if (Array.isArray(value)) {
        return value.map(item => redactForLog(item));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            shouldRedactLogKey(key) ? '[REDACTED]' : redactForLog(item)
        ]));
    }
    return value;
}

function sanitizeOriginalUrl(originalUrl) {
    try {
        const parsed = new URL(originalUrl, 'http://tools-platform.local');
        parsed.searchParams.forEach((value, key) => {
            if (shouldRedactLogKey(key)) {
                parsed.searchParams.set(key, '[REDACTED]');
            }
        });
        return `${parsed.pathname}${parsed.search}`;
    } catch (err) {
        return String(originalUrl || '').replace(/([?&][^=]*(?:token|password|secret|api_?key)[^=]*=)[^&]*/gi, '$1[REDACTED]');
    }
}

function getSanitizedQuery(req) {
    return redactForLog(req.query || {});
}

function sanitizeResponseForStatus(body) {
    if (body == null || Buffer.isBuffer(body)) return '';
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    try {
        return JSON.stringify(redactForLog(JSON.parse(text)));
    } catch (_) {
        return text
            .replace(/((?:password|token|secret|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;&]+/gi, '$1[REDACTED]')
            .slice(0, 16000);
    }
}

// ── 请求日志（每次 API 请求都打印到控制台）
app.use((req, res, next) => {
    const originalUrl = req.originalUrl || req.url || req.path;
    if (!originalUrl.startsWith('/api')) return next(); // 只记录 API 请求
    const start = Date.now();
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const safeUrl = sanitizeOriginalUrl(originalUrl);
    const safeQuery = getSanitizedQuery(req);
    const client = req.ip || req.socket?.remoteAddress || '';
    const userAgent = req.get('user-agent') || '';
    const originalSend = res.send;
    res.send = function serviceStatusCaptureSend(body) {
        res.locals.serviceStatusResponseBody = req.suppressResponseLog ? '[omitted]' : sanitizeResponseForStatus(body);
        return originalSend.call(this, body);
    };
    res.on('finish', () => {
        const dur = Date.now() - start;
        const status = res.statusCode;
        const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
        const reset = '\x1b[0m';
        const bodySize = req.headers['content-length'] ? `(body: ${req.headers['content-length']}B)` : '';
        const querySummary = Object.keys(safeQuery).length ? ` query=${JSON.stringify(safeQuery)}` : '';
        const externalTag = safeUrl.startsWith('/api/external/metrics') ? ' [external-metrics]' : '';
        const isRuntimeLogViewerRequest = safeUrl.startsWith('/api/platform-metrics/service-status/logs');
        const isChatProgressPoll = safeUrl.startsWith('/api/chat-history/status');
        if (!isRuntimeLogViewerRequest && !isChatProgressPoll) {
            console.log(`${color}[${ts}] ${req.method} ${safeUrl} #${req.requestId}${externalTag} → ${status} (${dur}ms) ${bodySize}${querySummary} ip=${client} ua="${userAgent.substring(0, 120)}"${reset}`);
        }
        if (!isChatProgressPoll) serviceStatusRepo.trackRequest({
            method: req.method,
            pathname: safeUrl,
            statusCode: status,
            durationMs: dur,
            requestId: req.requestId,
            requestBody: req.suppressBodyLog ? '[omitted]' : JSON.stringify(redactForLog(req.body || {})).slice(0, 16000),
            responseBody: res.locals.serviceStatusResponseBody || ''
        }).catch(error => console.warn(`[service-status] 请求指标记录失败：${error.message}`));
        if (status >= 400 && !req.suppressBodyLog) {
            console.log(`  ↳ Body:`, JSON.stringify(redactForLog(req.body)).substring(0, 300));
        }
    });
    next();
});

const FRONTEND_DIR = path.join(__dirname, '../frontend');
const sendFrontendHtml = assetVersioning.createFrontendHtmlSender(FRONTEND_DIR);
const PUBLIC_HTML_PATHS = new Set([
    '/login.html',
    '/pages/login.html',
    '/project-evolution',
    '/project-evolution.html',
    '/pages/project-evolution.html',
    '/privacy',
    '/privacy.html',
    '/pages/privacy.html',
    '/terms',
    '/terms.html',
    '/pages/terms.html',
    '/googlea8435fd020ce60ab.html',
    '/cinema',
    '/cinema.html',
    '/pages/cinema.html'
]);
const PUBLIC_ASSET_EXTS = new Set([
    '.css', '.js', '.mjs', '.map',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
    '.woff', '.woff2', '.ttf', '.otf',
    '.json', '.txt', '.zip',
    '.mp4', '.webm', '.mkv', '.mov', '.m4v'
]);

function shouldProtectHtmlEntry(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (req.path.startsWith('/api/')) return false;
    if (req.path.startsWith('/knight-dreams/')) return false;
    // 自定义工具在下方按工具配置独立鉴权，避免静态资源绕过或重复鉴权。
    if (req.path.startsWith('/custom-tools/')) return false;
    if (PUBLIC_HTML_PATHS.has(req.path)) return false;
    const ext = path.extname(req.path).toLowerCase();
    if (PUBLIC_ASSET_EXTS.has(ext)) return false;
    if (ext && ext !== '.html') return false;
    return true;
}

app.use((req, res, next) => {
    if (!shouldProtectHtmlEntry(req)) return next();
    return checkHtmlAuth(req, res, next);
});

// Desktop builds keep uploaded media outside app.asar. Preserve the public URL
// used by the cinema page while serving files from the writable runtime folder.
app.use('/assets/videos', mediaAssetGuard, express.static(VIDEOS_DIR, { index: false }));
// Released home videos stream/cache separately from uploaded cinema media.
app.use(require('./models/home-promo-videos').createPromoVideoMiddleware());
app.use(require('./models/platform-logo-runtime').createLogoAssetMiddleware());
app.use(assetVersioning.createFrontendHtmlMiddleware(FRONTEND_DIR));
app.use(assetVersioning.createImmutableAssetMiddleware(FRONTEND_DIR));
app.use(express.static(FRONTEND_DIR, { index: false }));
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'assets/icon.ico'));
});

// ============================================================
// API 路由与鉴权
// ============================================================
app.use('/api/auth', authRoutes);

// ============================================================
// 健康检查
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

const quickStartService = require('./models/default-quick-start-service');

// 动态加载的前端脚本、样式没有经过 HTML 版本化：返回内容哈希，避免 CDN/浏览器缓存旧版
app.get('/api/asset-version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const assetPath = String(req.query.path || '');
    if (!/^(?:\/js\/[\w./-]+\.js|\/css\/[\w./-]+\.css)$/.test(assetPath) || assetPath.includes('..')) return res.status(400).json({ error: 'Invalid asset path' });
    const hash = assetVersioning.fileHash(path.join(FRONTEND_DIR, assetPath));
    if (!hash) return res.status(404).json({ error: 'Asset not found' });
    res.json({ path: assetPath, version: hash });
});

// 登录页未登录可访问，用根 package.json 版本号对齐 GitHub/electron-builder 打包版本，附带构建与三方件信息。
app.get('/api/app-version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const buildMeta = typeof quickStartService.getBuildMetadata === 'function'
        ? quickStartService.getBuildMetadata()
        : null;
    res.json({
        name: appPackage.productName || appPackage.name || 'Tools Platform',
        version: appPackage.version || (buildMeta && buildMeta.version) || '0.0.0',
        build: buildMeta
    });
});

// 旧 JSON -> SQLite 启动迁移报告。允许未登录访问，便于 Windows 打包版升级后定位数据迁移问题。
app.get('/api/migration-status', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(legacyJsonMigration.getLastMigrationReport());
});

app.use('/api/uiv-auto-import', uivAutoImportRoutes);
app.use('/api/public/f12-license', f12LicensePublicRoutes);

// 媒体资源管理与公开点播路由
app.use('/api/media', mediaRoutes);
app.get('/api/public/videos', (req, res, next) => {
    req.url = '/public/list' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    mediaRoutes(req, res, next);
});

// 登录页与公共品牌标识 API：提供中英文主名称、副标题与登录标语，无需鉴权即可访问
app.get('/api/platform-identity', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const repo = require('./models/nav-settings-repository');
    res.json(await repo.getSettings());
});

app.use('/api', checkAuth); // Protect all /api/* (except login, which is handled inside checkAuth)
app.use('/api', tenantMiddleware);

// 首页卡片「上次更新」时间（内置页面按 HTML 及专属 js/css 的最新修改时间）
app.get('/api/home/page-updates', async (req, res, next) => {
    try {
        res.json(await pageUpdateTimes.getPageUpdateTimes(FRONTEND_DIR));
    } catch (error) {
        next(error);
    }
});

// 首页「插件与脚本」目录：F12 插件、Python 脚本、数据抓取浮窗脚本等藏在工具内部的小功能（models/home-capabilities.js）
app.get('/api/home/capabilities', async (req, res, next) => {
    try {
        res.setHeader('Cache-Control', 'no-store');
        res.json(await require('./models/home-capabilities').listCapabilities({
            isAdmin: req.user?.role === 'admin',
            lang: req.query.lang === 'en-US' ? 'en-US' : 'zh-CN'
        }));
    } catch (error) {
        next(error);
    }
});

// Protect modifications: requireAdmin for all non-GET requests under uiv, sla, upload
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    if (req.method === 'POST' && req.path === '/tenants/switch') return next();
    if (req.path.startsWith('/requirements')) return next(); // 需求管理内部自行控制权限
    if (req.path.startsWith('/surveys')) return next(); // 调查模板和提交由模块内部控制权限
    if (req.method === 'POST' && req.path === '/db/config/monthly_report_titles') return next(); // 登录用户可编辑月报中英文标题，路由内继续校验数据
    if (/^\/monthly-snapshots(?:\/[^/]+)?$/.test(req.path)) return next(); // 登录用户可维护各月份月报快照
    if (/^\/ai-report(?:\/.*)?$/.test(req.path)) return next(); // 登录用户可编辑 AI 月报、与格子 AI 对话
    if (/^\/duty-roster(?:\/.*)?$/.test(req.path)) return next(); // 登录用户可维护各月份值班表
    if (/^\/meeting-snapshots(?:\/.*)?$/.test(req.path)) return next(); // 登录用户可维护会议考勤历史快照与名单设置
    if (/^\/(?:operation-incentive-snapshots|incentive-snapshots)(?:\/[^/]+)?$/.test(req.path)) return next(); // 登录用户可维护操作激励历史快照
    if (/^\/custom-tools\/[^/]+\/(?:state(?:\/restore)?|history(?:\/[^/]+)?|snapshots(?:\/[^/]+)?)$/.test(req.path)) return next(); // 登录用户可维护自定义工具业务数据及快照
    if ((req.method === 'POST' && /^\/department-reward-penalty\/(?:records|evidence)$/.test(req.path)) ||
        (req.method === 'DELETE' && /^\/department-reward-penalty\/records\/[^/]+$/.test(req.path))) return next(); // 普通用户可提交草稿、证据和删除草稿，路由内校验发布和归属权限
    if ((req.method === 'POST' && /^\/reward-program\/(?:applications(?:\/[^/]+\/(?:save|submit|publish))?|evidence)$/.test(req.path)) ||
        (req.method === 'DELETE' && /^\/reward-program\/(?:applications(?:\/[^/]+)?|archived)$/.test(req.path))) return next(); // 申报人/管理员可维护本人草稿/归档数据与发布，路由内校验归属与状态
    if (req.method === 'POST' && /^\/reward-program\/applications\/[^/]+\/objections$/.test(req.path)) return next(); // 登录用户可在公示期提出异议
    if (/^\/chat-history\/(?:settings|conversations\/[^/]+\/(?:read|pin)|favorites\/[^/]+)$/.test(req.path)) return next(); // 聊天数据租户共享，普通用户只能维护个人状态
    if (req.method === 'DELETE' && /^\/slide-design\/assets\/[^/]+$/.test(req.path)) return next(); // 素材上传者或管理员可删除，路由内校验归属
    if (req.method === 'POST' && req.path === '/uiv/run-uivision-macro') return next(); // 只生成临时 runner，不修改业务数据
    if (req.method === 'POST' && req.path === '/platform-metrics/open') return next(); // 登录用户记录工具打开量
    if (req.method === 'POST' && req.path === '/recent-nav') return next(); // 登录用户维护自己的最近使用
    if ((req.method === 'POST' && req.path === '/datacom-knowledge/ai/ask') ||
        (req.method === 'PUT' && req.path === '/datacom-knowledge/preference') ||
        (['PUT', 'DELETE'].includes(req.method) && /^\/datacom-knowledge\/annotations\/[^/]+$/.test(req.path))) return next(); // 登录用户可向 AI 提问、记笔记、保存偏好；路由内校验归属，改写原文仍需管理员
    if (req.method === 'POST' && req.path === '/desktop-pet/language') return next(); // 路由内限制本机登录用户
    if (req.method === 'POST' && /^\/platform-promotions\/desktop\/(?:sync|open\/[^/]+|site-scripts(?:\/run)?)$/.test(req.path)) return next(); // 路由内限制本机登录用户，只操作本机桌面浏览器窗口（推广卡片、浮窗脚本）
    if (req.method === 'POST' && req.path === '/platform-promotions/clicks') return next(); // 登录用户上报推广点击，路由内校验推广项
    if (req.method === 'POST' && req.path === '/ai/proactive-alert-message') return next(); // 只读 KPI 提醒文案，不修改业务数据
    if (req.method === 'POST' && req.path === '/ai/chat') return next(); // 登录用户都可对话；工作区内非管理员只拿到只读工具（路由与 agent-run-manager 内校验）
    if (req.method === 'POST' && req.path === '/ai/compact') return next(); // 登录用户仅可压缩本人会话的模型上下文，路由内校验归属
    if (req.method === 'POST' && req.path === '/report-msg/export') return next(); // 仅生成并返回当前用户的月报文件
    if (req.method === 'POST' && /^\/channels\/(?:welink|weixin)\/push$/.test(req.path)) return next(); // 路由内校验：管理员，或已开放普通用户推送且目标在默认推送范围内
    if (/^\/agent-workspace(?:\/.*)?$/.test(req.path)) return next(); // 路由内按本机/桌面/管理员门禁与会话归属校验
    if (req.method !== 'GET') {
        return requireAdmin(req, res, next);
    }
    next();
});
app.use('/api/uiv', uivRoutes);         // UIV12 脚本仓库 API
app.use('/api/uiv-ai-adapter', uivAiAdapterRoutes); // UIVF12 AI 网站适配器
app.use('/api/sla', slaRoutes);         // SLA 配置持久化 API
app.use('/api/upload', uploadRoutes);   // 文件上传历史 API
app.use('/api/db', require('./routes/db')); // DB 保存 API
app.use('/api/requirements', requirementsRoutes); // 需求管理 API
app.use('/api/ai/schedules', require('./routes/dragon-claw-schedules')); // Dragon Claw /schedule 定时指令
app.use('/api/ai', aiRoutes); // AI 服务 API
app.use('/api/agent-skills', require('./routes/agent-skills')); // Skill 管理：内置 + 租户自定义（对话 @create-skill 创建或导入 SKILL 压缩包）
app.use('/api/builtin-promotion', require('./routes/builtin-promotion')); // 自定义工具 / 技能 / 脚本「转为内置」写入项目源码目录，或取消内置
app.use('/api/storage', storageRoutes); // 存储迁移状态 API
app.use('/api/db-explorer', require('./routes/db-explorer')); // 数据库浏览 API
app.use('/api/frt', frtRoutes); // FRT 历史快照 API
app.use('/api/topic-snapshots', topicSnapshotsRoutes); // NetCare/DataFab 专题历史快照 API
app.use('/api/monthly-snapshots', monthlySnapshotsRoutes); // 跨设备月报快照持久化 API
app.use('/api/meeting-snapshots', meetingSnapshotsRoutes); // 会议考勤历史快照持久化 API
app.use('/api/operation-incentive-snapshots', operationIncentiveSnapshotsRoutes); // 操作激励历史快照持久化 API
app.use('/api/incentive-snapshots', operationIncentiveSnapshotsRoutes); // 别名路由
app.use('/api/report-msg', require('./routes/report-msg')); // 月报 Outlook 邮件文件导出
app.use('/api/ai-report', require('./routes/ai-report')); // AI 月报：格子对话、配方数据与报告文档
app.use('/api/praudit', prauditRoutes); // PR审计配置 API
app.use('/api/chat-history', chatHistoryRoutes); // 租户隔离的聊天记录中心
app.use('/api/custom-tools', customToolsRoutes); // 自定义 HTML 工具注册 API
app.use('/api/department-reward-penalty', require('./routes/department-reward-penalty'));
app.use('/api/reward-program', require('./routes/reward-program'));
app.use('/api/datacom-knowledge', require('./routes/datacom-knowledge')); // 数通协议专家知识库（独立 datacom-knowledge.db）
app.use('/api/slide-design', slideDesignRoutes); // 胶片设计项目与 PPT 素材库
app.use('/api/surveys', surveysRoutes); // 可配置调查模板与提交记录 API
app.use('/api/nav-settings', navSettingsRoutes); // 顶部导航全局设置 API
app.use('/api/platform-logo', require('./routes/platform-logo')); // 平台 LOGO 与多端规格图标管理
app.use('/api/recent-nav', require('./routes/recent-nav')); // 按租户和账号保存最近使用
app.use('/api/desktop-pet', require('./routes/desktop-pet'));
app.use('/api/ai-settings', aiSettingsRoutes); // Dragon Claw 智能体模型配置 API
app.use('/api/agent-workspace', require('./routes/agent-workspace')); // Dragon Claw 工作区：本地目录联想、审批、变更撤销
app.use('/api/channels', require('./routes/channels')); // 频道对接（WeLink / 微信助理）：配置、连通性、名单、主动推送
app.use('/api/dragon-tac', require('./routes/dragon-tac'));
app.use('/api/desktop-agents', require('./routes/desktop-agents'));
app.use('/api/global-backup', globalBackupRoutes); // 当前租户核心数据备份与恢复 API（保留历史路由名）
app.use('/api/external/metrics', externalMetricsRoutes); // 外部/移动端只读指标 API
app.use('/api/alert-center', alertCenterRoutes); // 系统告警台 API
app.use('/api/platform-metrics', platformMetricsRoutes); // 首页效能与使用量统计
app.use('/api/friend-links', friendLinksRoutes); // 首页友情链接配置与轻量可用性探测
app.use('/api/platform-promotions', require('./routes/platform-promotions')); // 首页推广区（视频 + 推广链接）配置与桌面推广卡片堆
app.use('/api/onboarding', onboardingRoutes); // 首次启动默认脚本/指标规则可选导入
app.use('/api/duty-roster', require('./routes/duty-roster')); // 夜间运维值班表 API
app.use('/api/tenants', tenantsRoutes); // 租户清单、切换与管理
app.use('/api/python-updater', require('./routes/python-updater')); // Python 脚本热更新与版本管理 API
if (desktopLicenseAdminRoutes) app.use('/api/desktop-licenses', requireAdmin, desktopLicenseAdminRoutes);


// ============================================================
// 前端路由回退（SPA）
// ============================================================
app.get('/', (req, res) => {
    sendFrontendHtml(res, 'index.html');
});
app.get('/login.html', (req, res) => {
    sendFrontendHtml(res, 'pages/login.html');
});
app.get(['/project-evolution', '/project-evolution.html'], (req, res) => {
    sendFrontendHtml(res, 'pages/project-evolution.html');
});
app.get(['/cinema', '/cinema.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    sendFrontendHtml(res, 'pages/cinema.html');
});
app.get('/uivf12', (req, res) => {
    sendFrontendHtml(res, 'pages/uivf12.html');
});
app.get('/topic-analysis', (req, res) => {
    sendFrontendHtml(res, 'pages/topic-analysis.html');
});
app.get('/sla', (req, res) => {
    sendFrontendHtml(res, 'pages/sla.html');
});
app.get('/report', (req, res) => {
    sendFrontendHtml(res, 'pages/report.html');
});
app.get('/expedite', (req, res) => {
    sendFrontendHtml(res, 'pages/expedite.html');
});
app.get('/monthly', (req, res) => {
    sendFrontendHtml(res, 'pages/ai-report.html'); // AI 月报编辑器（旧编辑器已归档于 backups/monthly-designer-classic-2026-10-21）
});
// 旧月报编辑器与旧月报页面的书签统一跳到 AI 月报
app.get(['/ai-report', '/monthly/legacy', '/pages/monthly-designer.html', '/pages/monthly.html'], (req, res) => res.redirect(302, '/monthly'));
app.get(['/duty-roster', '/duty-roster.html'], (req, res) => {
    sendFrontendHtml(res, 'pages/duty-roster.html');
});
app.get('/bigscreen', (req, res) => {
    sendFrontendHtml(res, 'pages/bigscreen.html');
});
app.get('/requirements', (req, res) => {
    sendFrontendHtml(res, 'pages/requirements.html');
});
app.get('/praudit', (req, res) => {
    sendFrontendHtml(res, 'pages/praudit.html');
});
app.get('/storage', (req, res) => {
    sendFrontendHtml(res, 'pages/storage.html');
});
app.get('/db-explorer', (req, res) => {
    sendFrontendHtml(res, 'pages/db-explorer.html');
});
app.get('/privacy', (req, res) => {
    sendFrontendHtml(res, 'pages/privacy.html');
});
app.get('/terms', (req, res) => {
    sendFrontendHtml(res, 'pages/terms.html');
});
app.get('/frt', (req, res) => {
    sendFrontendHtml(res, 'pages/frt.html');
});
if (!isDesktopRuntime) app.get('/desktop-license-admin', checkHtmlAuth, (req, res) => {
    sendFrontendHtml(res, 'pages/desktop-license-admin.html');
});
app.get('/python-updater', checkHtmlAuth, (req, res) => {
    res.redirect('/tools/python-updater');
});
app.get('/tools/:slug', checkHtmlAuth, (req, res) => {
    sendFrontendHtml(res, 'pages/custom-tool.html');
});
app.use('/custom-tools', async (req, res, next) => {
    const hasSessionCookie = String(req.headers.cookie || '').split(';')
        .some(item => item.trim().startsWith('tools_token='));
    if (hasSessionCookie) return checkHtmlAuth(req, res, next);
    return runWithTenant(DEFAULT_TENANT_ID, async () => {
        try {
            const slug = String(req.path || '').split('/').filter(Boolean)[0] || '';
            const tool = slug ? await customToolsRepo.getTool(slug) : null;
            if (tool && tool.publicAccess === true) return next();
            return checkHtmlAuth(req, res, next);
        } catch (err) {
            return next(err);
        }
    });
});
app.get('/custom-tools/:slug/index.html', async (req, res, next) => {
    try {
        const tool = await customToolsRepo.getTool(req.params.slug);
        const filePath = await customToolsRepo.getToolFilePath(req.params.slug);
        if (!tool || !filePath) return res.status(404).send('Custom tool not found');
        const html = fs.readFileSync(filePath, 'utf8');
        const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
        if (req.query.download === '1') {
            const filename = `${String(tool.name || tool.slug).replace(/[\\/:*?"<>|]+/g, '_')}.html`;
            const standaloneHtml = customToolI18nService.injectLanguageRuntime(html, tool.slug, {
                inlineRuntime: true,
                standalone: true,
                mtime: stat ? stat.mtime : null,
                filePath,
                tool
            });
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
            return res.send(standaloneHtml);
        }
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.type('html').send(assetVersioning.versionAssetUrls(customToolI18nService.injectLanguageRuntime(html, tool.slug, {
            mtime: stat ? stat.mtime : null,
            filePath,
            tool
        }), { publicDir: FRONTEND_DIR, baseDir: path.dirname(filePath) }));
    } catch (err) {
        next(err);
    }
});
app.use('/custom-tools/:slug', (req, res, next) => {
    const requestedPath = (req.path.endsWith('/') || !req.path) ? `${req.path || '/'}index.html` : req.path;
    const assetPath = customToolsRepo.getToolAssetPath(req.params.slug, requestedPath);
    if (!assetPath) return next();
    if (/\.html?$/i.test(assetPath)) {
        try {
            const html = fs.readFileSync(assetPath, 'utf8');
            const stat = fs.existsSync(assetPath) ? fs.statSync(assetPath) : null;
            return res.type('html').send(assetVersioning.versionAssetUrls(customToolI18nService.injectLanguageRuntime(html, req.params.slug, {
                mtime: stat ? stat.mtime : null,
                filePath: assetPath
            }), { publicDir: FRONTEND_DIR, baseDir: path.dirname(assetPath) }));
        } catch (error) {
            return next(error);
        }
    }
    res.sendFile(assetPath);
});
app.use('/custom-tools', (req, res, next) => express.static(customToolsRepo.getCustomToolsDir())(req, res, next));


// ── 全局错误兜底
app.use((err, req, res, next) => {
    console.error(`\x1b[31m[ERROR] ${req.method} ${req.path}:\x1b[0m`, err.stack || err.message);
    res.status(500).json({ error: err.message || '服务器内部错误' });
});

async function startServer() {
    await legacyJsonMigration.runStartupLegacyJsonMigration();
    await initializeDefaultBusinessSchema();
    try {
        await initializeTenantBuiltinTools(DEFAULT_TENANT_ID);
        const tenants = await require('./models/tenants-repository').listManagedTenants();
        for (const tenant of tenants.filter(item => item.id !== DEFAULT_TENANT_ID && item.status === 'active')) {
            try { await initializeTenantBuiltinTools(tenant.id); }
            catch (error) { console.warn(`[custom-tools] 租户 ${tenant.id} 工具自动同步失败：${error.message}`); }
        }
    } catch (error) {
        console.warn(`[custom-tools] 系统工具初始化失败，继续使用现有用户工具：${error.message}`);
    }
    try {
        await ensureBuiltinToolAssets({
            sourceDir: customToolsRepo.BUILTIN_TOOLS_DIR,
            targetDir: customToolsRepo.CUSTOM_TOOLS_DIR
        });
    } catch (assetsError) {
        console.warn(`[builtin-assets] 媒体资源包就绪检查失败：${assetsError.message}`);
    }

    const server = app.listen(PORT, () => {
        console.log(`\n✅ Tools Platform 已启动`);
        console.log(`   🌐 访问地址: http://localhost:${PORT}`);
        console.log(`   📦 UIVF12:   http://localhost:${PORT}/uivf12`);
        console.log(`   📊 SLA:      http://localhost:${PORT}/sla\n`);
        setTimeout(() => {
            remoteBackupSyncRepo.runStartupRemoteSync();
        }, 1200);
        setTimeout(() => {
            globalBackupRepo.startAutoBackupScheduler().catch(err => {
                console.error('[GLOBAL BACKUP] Failed to start scheduled backup:', err);
            });
        }, 1800);
        setTimeout(() => {
            configChangeMonitor.startConfigFingerprintMonitor();
        }, 2400);
        setTimeout(() => {
            alertAiAnalyzer.startAlertAiBackfill();
        }, 3200);
        setTimeout(() => {
            friendLinksService.start().catch(err => {
                console.error('[friend-links] 启动自动探测调度失败：', err);
            });
        }, 4000);
        setTimeout(() => {
            snapshotPublishService.startScheduler().catch(err => {
                console.error('[snapshot-publish] 启动定时推送失败：', err.message);
            });
        }, 4500);
        setTimeout(() => {
            // 频道对接：已启用 WeLink 助理的租户自动连接网关（SDK 未安装时只记录提示，不影响启动）
            const tenantsRepo = require('./models/tenants-repository');
            tenantsRepo.listManagedTenants().then(items => Promise.all(['default', ...items.filter(item => item.status === 'active').map(item => item.id)].map(id => runWithTenant(id, () => require('./models/dragon-tac/service').recover())))).catch(() => console.warn('[DragonTAC] 中断任务恢复失败'));
            require('./models/channels/welink-bridge-service')
                .autoStartAll(async () => (await tenantsRepo.listManagedTenants()).filter(item => item.status === 'active').map(item => item.id))
                .catch(err => console.error('[WeLink] 自动连接失败：', err.message));
            // 微信助理（iLink bot）：已启用的租户自动开始长轮询
            require('./models/channels/weixin-bridge-service')
                .autoStartAll(async () => (await tenantsRepo.listManagedTenants()).filter(item => item.status === 'active').map(item => item.id))
                .catch(err => console.error('[Weixin] 自动连接失败：', err.message));
            // 频道跟进任务：每分钟检查到期提醒，在原群/单聊 @ 相关人
            require('./models/channels/followup-scheduler')
                .start(async () => (await tenantsRepo.listManagedTenants()).filter(item => item.status === 'active').map(item => item.id));
            // 自动化运营：每分钟检查到期的运营计划，生成草稿或推送到运营群组
            require('./models/channels/ops-service')
                .start(async () => (await tenantsRepo.listManagedTenants()).filter(item => item.status === 'active').map(item => item.id));
            // Dragon Claw /schedule：每分钟检查到期的定时指令，以创建者身份执行并写回原对话
            require('./models/dragon-claw-schedules')
                .start(async () => (await tenantsRepo.listManagedTenants()).filter(item => item.status === 'active').map(item => item.id));
            // 频道心跳抽查与健康自愈看门狗：定时抽查每个频道的长连接与心跳状态，断线自动重连
            require('./models/channels/channel-watchdog')
                .start(async () => (await tenantsRepo.listManagedTenants()).filter(item => item.status === 'active').map(item => item.id));
        }, 5000);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\n❌ 启动失败：端口 ${PORT} 已被占用。`);
            console.error(`   解决方式：关闭占用该端口的程序，或使用其他端口启动：`);
            console.error(`   Windows PowerShell: $env:PORT=3031; npm start`);
            console.error(`   macOS/Linux: PORT=3031 npm start\n`);
        } else if (err.code === 'EACCES') {
            console.error(`\n❌ 启动失败：没有权限监听端口 ${PORT}。请换用 1024 以上端口，或检查系统权限。\n`);
        } else {
            console.error('\n❌ 启动失败：', err);
        }
        process.exit(1);
    });
}

startServer().catch(err => {
    console.error('\n❌ 启动失败：旧 JSON 自动迁移失败：', err);
    process.exit(1);
});
})().catch(err => {
    console.error('\n❌ 启动失败：SQLite 启动自检/修复失败：', err);
    process.exit(1);
});
