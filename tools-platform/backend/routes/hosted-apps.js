// 托管 Python 应用 API：启动页（登录用户）与运维操作（管理员）。导入走自定义工具的上传通道。
const express = require('express');
const router = express.Router();
const runtime = require('../models/hosted-apps/runtime');
const service = require('../models/hosted-apps/service');
const editorService = require('../models/hosted-apps/editor-service');
const { requireAdmin, requireSuperAdmin, inSuperAdminSpace } = require('../middleware/auth');
const distribution = require('../models/tool-distribution');
const { DEFAULT_TENANT_ID, getTenantId, runWithTenant } = require('../models/tenant-context');

// 团队账号只能碰超级管理员「开放给全员」的应用，并且只有下面这些只读接口；启停、改代码、Git、日志、配置等一律拒绝。
// 应用在超级管理员空间里，所以通过后切到该空间处理；处理函数里用 req.hostedViewer 去掉密钥类内容。
const VIEWER_READS = [/^\/launch$/, /^\/status$/, /^\/config$/, /^\/editor\/tree$/, /^\/editor\/file$/, /^\/editor\/git\/(?:status|history|diff)$/];
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
router.use(async (req, res, next) => {
    if (inSuperAdminSpace(req.user)) return next(); // 超级管理员空间里沿用各接口原有的角色规则
    const deny = () => res.status(403).json({ code: 'SUPER_ADMIN_REQUIRED', error: '该功能仅超级管理员可用' });
    const match = /^\/([a-z0-9][a-z0-9-]{0,79})(\/.+)$/.exec(req.path);
    if (!match || req.method !== 'GET' || !VIEWER_READS.some(pattern => pattern.test(match[2]))) return deny();
    try {
        if (!await distribution.sharedHostedApp(match[1], req.user)) return deny();
        req.hostedViewer = true;
        req.hostedViewerTenant = getTenantId();
        runWithTenant(DEFAULT_TENANT_ID, next);
    } catch (error) { next(error); }
});

const send = (res, error, fallback) => res.status(error.status || 500).json({ error: error.message || fallback, code: error.code });

// 更新等待旧进程退出期间，禁止编辑、Git 和配置等写操作交叉修改同一应用。
router.use('/:slug', (req, res, next) => {
    try {
        if (req.method !== 'GET' && runtime.status(req.params.slug)?.status === 'updating') {
            return res.status(409).json({ error: '应用正在更新代码，请稍后再操作', code: 'HOSTED_APP_BUSY' });
        }
        next();
    } catch (error) { send(res, error, '读取应用状态失败'); }
});


router.get('/settings', requireAdmin, async (req, res) => {
    const python = await runtime.findPython({ refresh: req.query.refresh === '1' });
    res.json({ success: true, settings: runtime.getSettings(), python, apps: runtime.listApps() });
});

router.put('/settings', requireAdmin, async (req, res) => {
    try {
        const settings = runtime.saveSettings(req.body || {});
        res.json({ success: true, settings, python: await runtime.findPython({ refresh: true }) });
    } catch (error) { send(res, error, '保存设置失败'); }
});

router.post('/preview', requireSuperAdmin, async (req, res) => {
    req.suppressBodyLog = true;
    try {
        res.json({ success: true, app: await service.preview(req.body || {}) });
    } catch (error) { send(res, error, '识别应用包失败'); }
});

router.post('/:slug/preview', requireSuperAdmin, async (req, res) => {
    req.suppressBodyLog = true;
    try {
        res.json({ success: true, app: await service.preview(req.body || {}) });
    } catch (error) { send(res, error, '识别应用包失败'); }
});

router.post('/:slug/package', requireSuperAdmin, async (req, res) => {
    req.suppressBodyLog = true;
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const result = await service.updatePackage(req.params.slug, req.body || {});
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '更新应用包失败'); }
});

router.get('/:slug/launch', async (req, res) => {
    try {
        const result = await service.launch(req.params.slug, req.user, { viewer: req.hostedViewer, userTenantId: req.hostedViewerTenant });
        if (!result) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, app: result });
    } catch (error) { send(res, error, '打开应用失败'); }
});

router.get('/:slug/status', requireAdmin, (req, res) => {
    try {
        const status = runtime.status(req.params.slug);
        if (!status) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, app: req.hostedViewer ? service.publicStatus(status) : status });
    } catch (error) { send(res, error, '读取状态失败'); }
});

router.get('/:slug/database-script', requireAdmin, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ success: true, script: require('../models/hosted-apps/schema-deployment').inspect(req.params.slug, req.query.kind) }); }
    catch (error) { send(res, error, '读取数据库部署脚本失败'); }
});
router.post('/:slug/database-script', requireAdmin, async (req, res) => {
    req.suppressBodyLog = true;
    try { res.json({ success: true, deployment: await require('../models/hosted-apps/schema-deployment').apply(req.params.slug, req.body?.kind, req.body?.hash) }); }
    catch (error) { send(res, error, '执行数据库部署脚本失败'); }
});

router.get('/:slug/config', requireAdmin, async (req, res) => {
    try {
        const state = runtime.readState(req.params.slug);
        if (!state) return res.status(404).json({ error: '应用不存在' });
        const dataApi = require('../models/hosted-apps/data-api');
        const datasources = await dataApi.listDatasources({ uuid: state.uuid, slug: req.params.slug, tenantId: require('../models/tenant-context').getTenantId() });
        const { netcareName } = dataApi.datasourceNames();
        const businessDatasource = state.businessDatasource || netcareName || (state.databaseContract === 'digital-human' ? 'netcare' : 'platform:report.db');
        res.json({
            success: true,
            slug: req.params.slug,
            name: state.name || state.packageName,
            uuid: state.uuid,
            businessDatasource,
            appDatabase: {
                name: 'app',
                schema: state.uuid,
                file: 'app.db',
                writable: true,
                env: {
                    APP_DATASOURCE_ID: 'app',
                    APP_SCHEMA: state.uuid
                }
            },
            businessDatabase: {
                name: businessDatasource,
                remark: 'NetCare 业务库（只读，含全量 441 张业务表及上游源表视图）',
                writable: false,
                env: {
                    BUSINESS_DATASOURCE_NAME: businessDatasource
                }
            },
            availableDatasources: datasources.filter(d => d.type !== 'APP_CUSTOM').map(d => d.name),
            env: req.hostedViewer ? {} : state.env || {}
        });
    } catch (error) { send(res, error, '读取应用配置失败'); }
});

router.put('/:slug/config', requireAdmin, async (req, res) => {
    try {
        const state = runtime.readState(req.params.slug);
        if (!state) return res.status(404).json({ error: '应用不存在' });
        const patch = {};
        if (req.body.businessDatasource !== undefined) patch.businessDatasource = String(req.body.businessDatasource || '');
        if (req.body.env && typeof req.body.env === 'object') patch.env = req.body.env;
        const updated = runtime.updateState(req.params.slug, patch);
        if (updated.status === 'running') {
            runtime.restart(req.params.slug).catch(() => {});
        }
        res.json({ success: true, app: runtime.status(req.params.slug) });
    } catch (error) { send(res, error, '更新应用配置失败'); }
});

router.get('/:slug/logs', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, lines: runtime.logs(req.params.slug, req.query.limit) });
    } catch (error) { send(res, error, '读取日志失败'); }
});

router.get('/:slug/logs/dates', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        res.json({ success: true, dates: runtime.availableLogDates(req.params.slug) });
    } catch (error) { send(res, error, '获取日志日期失败'); }
});

router.get('/:slug/logs/export', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { date, all } = req.query;
        const result = runtime.exportLogs(req.params.slug, { date, all: all === '1' || all === 'true' });
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
        res.send(result.content);
    } catch (error) { send(res, error, '导出日志失败'); }
});

// 运维操作立即返回，安装/启动在后台进行，启动页轮询状态
const actions = {
    start: slug => { runtime.updateState(slug, { desired: 'running' }); runtime.start(slug).catch(() => {}); },
    restart: slug => { runtime.updateState(slug, { desired: 'running' }); runtime.restart(slug).catch(() => {}); },
    stop: slug => runtime.stop(slug),
    reinstall: async slug => {
        await runtime.stop(slug, { keepDesired: true });
        runtime.install(slug, { force: true }).then(() => runtime.start(slug)).catch(() => {});
    }
};

router.post('/:slug/:action(start|stop|restart|reinstall)', requireAdmin, async (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        await actions[req.params.action](req.params.slug);
        res.json({ success: true, app: runtime.status(req.params.slug) });
    } catch (error) { send(res, error, '操作失败'); }
});

// ── 在线 IDE 与版本管理 ─────────────────────────────────────────
router.get('/:slug/editor/tree', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const tree = req.hostedViewer ? editorService.viewer.tree(req.params.slug) : editorService.getFileTree(req.params.slug);
        res.json({ success: true, tree });
    } catch (error) { send(res, error, '读取文件树失败'); }
});

router.get('/:slug/editor/file', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const file = req.hostedViewer ? editorService.viewer.file(req.params.slug, req.query.path) : editorService.readFile(req.params.slug, req.query.path);
        res.json({ success: true, file });
    } catch (error) { send(res, error, '读取文件失败'); }
});

router.put('/:slug/editor/file', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { path: filePath, content, autoCommit, commitMessage } = req.body || {};
        if (filePath === undefined || content === undefined) return res.status(400).json({ error: '缺少 path 或 content 参数' });
        const result = editorService.saveFile(req.params.slug, filePath, content, { autoCommit, commitMessage });
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '保存文件失败'); }
});

router.post('/:slug/editor/create', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { path: itemPath, isDir } = req.body || {};
        if (!itemPath) return res.status(400).json({ error: '路径不能为空' });
        const result = editorService.createItem(req.params.slug, itemPath, Boolean(isDir));
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '创建失败'); }
});

router.post('/:slug/editor/delete', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { path: itemPath } = req.body || {};
        if (!itemPath) return res.status(400).json({ error: '路径不能为空' });
        const result = editorService.deleteItem(req.params.slug, itemPath);
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '删除失败'); }
});

router.post('/:slug/editor/rename', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { oldPath, newPath } = req.body || {};
        if (!oldPath || !newPath) return res.status(400).json({ error: '缺少 oldPath 或 newPath 参数' });
        const result = editorService.renameItem(req.params.slug, oldPath, newPath);
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '重命名失败'); }
});

router.get('/:slug/editor/git/status', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const status = req.hostedViewer ? editorService.viewer.gitStatus(req.params.slug) : editorService.getGitStatus(req.params.slug);
        res.json({ success: true, status });
    } catch (error) { send(res, error, '读取 Git 状态失败'); }
});

router.get('/:slug/editor/git/history', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const limit = parseInt(req.query.limit, 10) || 40;
        const history = req.hostedViewer ? editorService.viewer.gitHistory(req.params.slug, limit) : editorService.getGitHistory(req.params.slug, limit);
        res.json({ success: true, history });
    } catch (error) { send(res, error, '读取版本历史失败'); }
});

router.get('/:slug/editor/git/diff', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { commit, file } = req.query || {};
        // 提交号直接拼进 git 命令：只接受哈希，避免被当成命令行选项
        if (commit && !COMMIT_RE.test(String(commit).trim())) return res.status(400).json({ error: '提交号无效' });
        const result = req.hostedViewer ? editorService.viewer.diff(req.params.slug, { commitHash: commit, filePath: file })
            : editorService.getDiff(req.params.slug, { commitHash: commit, filePath: file });
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '获取 Diff 失败'); }
});

router.post('/:slug/editor/git/commit', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { message, autoBump } = req.body || {};
        const result = editorService.commitChanges(req.params.slug, message, req.user?.username || req.user?.email || '', { autoBump: Boolean(autoBump) });
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '提交修改失败'); }
});

router.post('/:slug/editor/git/revert', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { commitHash } = req.body || {};
        if (!commitHash) return res.status(400).json({ error: '缺少 commitHash 参数' });
        const result = editorService.revertToCommit(req.params.slug, commitHash);
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '版本回退失败'); }
});

router.post('/:slug/editor/git/remote', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { remoteUrl } = req.body || {};
        const result = editorService.setGitRemote(req.params.slug, remoteUrl);
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '配置远程仓库失败'); }
});

router.post('/:slug/editor/git/push', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const { force, autoBump } = req.body || {};
        const result = editorService.pushToRemote(req.params.slug, {
            force: Boolean(force),
            autoBump: autoBump === undefined ? true : Boolean(autoBump),
            user: req.user?.username || req.user?.email || ''
        });
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '推送到远程仓库失败'); }
});

router.post('/:slug/editor/git/pull', requireAdmin, (req, res) => {
    try {
        if (!runtime.exists(req.params.slug)) return res.status(404).json({ error: '应用不存在' });
        const result = editorService.pullFromRemote(req.params.slug);
        res.json({ success: true, ...result });
    } catch (error) { send(res, error, '从远程仓库拉取失败'); }
});

module.exports = router;
