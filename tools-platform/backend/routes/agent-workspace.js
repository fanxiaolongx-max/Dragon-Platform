// Dragon Claw 工作区 API：目录联想、选择与偏好、审批结算、变更列表与撤销。
// 整个路由过 agent-workspace-access 门禁（本机 / 桌面 / 管理员）；/capability 例外，返回 enabled:false 供前端隐藏入口。
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const access = require('../models/agent-workspace-access');
const prefsRepo = require('../models/agent-workspace-repository');
const runManager = require('../models/agent-run-manager');
const guard = require('../models/agent-path-guard');
const prService = require('../models/agent-pr-service');
const workspaceChanges = require('../models/agent-workspace-changes');
const transcripts = require('../models/agent-transcript-repository');
const { getTenantId } = require('../models/tenant-context');

const router = express.Router();
const SUGGEST_LIMIT = 50;

router.get('/capability', (req, res) => {
    const verdict = access.evaluate(req);
    res.json({
        enabled: verdict.enabled,
        reason: verdict.reason,
        homeDir: verdict.enabled ? os.homedir() : '',
        platform: process.platform,
        sep: path.sep,
        readOnly: !runManager.isAdminUser(req.user), // 管理员全部权限，其他账号只读
        permissionModes: runManager.PERMISSION_MODES
    });
});

router.use(access.middleware);

// 完整工具档案的只读分页入口，独立于给模型发送的上下文裁剪。
router.get('/transcripts/:agentSessionId', async (req, res) => {
    try {
        const owner = runManager.ownerKey(req.user, getTenantId());
        const root = guard.normalizeRoot(req.query.root);
        const items = await transcripts.listTurns({ agentSessionId: req.params.agentSessionId, owner, root, limit: req.query.limit, offset: req.query.offset });
        res.json({ items });
    } catch (error) {
        res.status(error.statusCode || 400).json({ code: error.code, error: error.message });
    }
});

function expandHome(input) {
    const text = String(input || '');
    if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) return path.join(os.homedir(), text.slice(1));
    return text;
}

async function listWindowsDrives() {
    const letters = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`);
    const checks = await Promise.all(letters.map(drive => fsp.stat(drive).then(stat => stat.isDirectory()).catch(() => false)));
    return letters.filter((_, index) => checks[index]).map(drive => ({ name: drive, path: drive, isGit: false }));
}

async function listSubdirectories(parent, { prefix = '', showHidden = false, limit = SUGGEST_LIMIT } = {}) {
    let entries;
    try {
        entries = await fsp.readdir(parent, { withFileTypes: true });
    } catch (error) {
        return { entries: [], error: error.code === 'EACCES' || error.code === 'EPERM' ? 'EACCES' : 'ENOENT' };
    }
    const lowerPrefix = prefix.toLowerCase();
    const dirs = entries
        .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
        .filter(entry => showHidden || prefix.startsWith('.') || !entry.name.startsWith('.'))
        .filter(entry => !lowerPrefix || entry.name.toLowerCase().includes(lowerPrefix))
        .map(entry => ({ name: entry.name, path: path.join(parent, entry.name), starts: entry.name.toLowerCase().startsWith(lowerPrefix) }))
        .sort((a, b) => (Number(b.starts) - Number(a.starts)) || a.name.localeCompare(b.name));
    const resolved = [];
    for (const item of dirs.slice(0, limit)) {
        try {
            if (!(await fsp.stat(item.path)).isDirectory()) continue;
        } catch (_error) {
            continue;
        }
        resolved.push({ name: item.name, path: item.path, isGit: fs.existsSync(path.join(item.path, '.git')) });
    }
    return { entries: resolved, total: dirs.length };
}

/**
 * GET /suggest?input=&showHidden=
 * 输入拆成「已存在的父目录 + 未完成的末段」，只列目录。空输入 → 家目录与根目录；
 * 以分隔符结尾 → 列该目录全部子目录。
 */
router.get('/suggest', async (req, res) => {
    try {
        const raw = expandHome(String(req.query.input || '').replace(/[\u0000-\u001f]/g, ''));
        const showHidden = req.query.showHidden === 'true';
        const isWin = process.platform === 'win32';
        if (!raw.trim()) {
            const home = os.homedir();
            const homeList = await listSubdirectories(home, { showHidden, limit: 30 });
            const rootList = isWin ? { entries: await listWindowsDrives() } : await listSubdirectories('/', { showHidden, limit: 30 });
            return res.json({
                input: '',
                parent: home,
                prefix: '',
                exists: true,
                isDir: true,
                groups: [
                    { label: 'home', base: home, entries: homeList.entries },
                    { label: 'root', base: isWin ? '' : '/', entries: rootList.entries }
                ]
            });
        }
        if (isWin && /^[a-z]:?$/i.test(raw.trim())) {
            // 只输入盘符（c / C:）：列出盘符，并按首字母过滤（大小写不敏感）
            const letter = raw.trim()[0].toUpperCase();
            const drives = (await listWindowsDrives()).filter(item => item.name.startsWith(letter));
            return res.json({ input: raw, parent: '', prefix: raw, exists: drives.length > 0, isDir: drives.length > 0, groups: [{ label: 'root', base: '', entries: drives }] });
        }
        const endsWithSep = /[\\/]$/.test(raw);
        const resolved = path.resolve(raw);
        let parent;
        let prefix;
        if (endsWithSep) {
            parent = resolved;
            prefix = '';
        } else {
            parent = path.dirname(resolved);
            prefix = path.basename(resolved);
        }
        let exists = false;
        let isDir = false;
        try {
            const stat = await fsp.stat(resolved);
            exists = true;
            isDir = stat.isDirectory();
        } catch (_error) {
            exists = false;
        }
        const listing = await listSubdirectories(parent, { prefix, showHidden });
        res.json({
            input: raw,
            parent,
            prefix,
            exists,
            isDir,
            isGit: isDir && fs.existsSync(path.join(resolved, '.git')),
            error: listing.error || undefined,
            groups: [{ label: 'children', base: parent, entries: listing.entries }]
        });
    } catch (error) {
        res.status(500).json({ error: error.message || '读取目录失败' });
    }
});

router.get('/prefs', async (req, res) => {
    try {
        res.json(await prefsRepo.getPrefs(req.user.username));
    } catch (error) {
        res.status(500).json({ error: error.message || '读取工作区偏好失败' });
    }
});

router.put('/prefs', async (req, res) => {
    try {
        const patch = {};
        if (req.body && req.body.permissionMode !== undefined) patch.permissionMode = req.body.permissionMode;
        if (req.body && Array.isArray(req.body.recentDirectories)) patch.recentDirectories = req.body.recentDirectories;
        if (req.body && req.body.lastDirectory !== undefined) patch.lastDirectory = req.body.lastDirectory;
        res.json(await prefsRepo.savePrefs(req.user.username, patch));
    } catch (error) {
        res.status(500).json({ error: error.message || '保存工作区偏好失败' });
    }
});

router.post('/select', async (req, res) => {
    try {
        const root = guard.normalizeRoot(expandHome(req.body && req.body.path));
        const prefs = await prefsRepo.rememberDirectory(req.user.username, root);
        // 最近一次在该目录的会话 id：新标签页（sessionStorage 为空）重选同一目录时沿用，服务端转录才能接上
        const agentSessionId = await runManager.findLatestSessionId(req.user, getTenantId(), root);
        res.json({ root, gitBranch: runManager.readGitBranch(root), name: path.basename(root) || root, prefs, agentSessionId });
    } catch (error) {
        const status = ['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR', 'AGENT_ROOT_REQUIRED'].includes(error.code) ? 400 : 500;
        res.status(status).json({ code: error.code, error: error.message || '选择目录失败' });
    }
});

router.post('/forget', async (req, res) => {
    try {
        res.json(await prefsRepo.forgetDirectory(req.user.username, req.body && req.body.path));
    } catch (error) {
        res.status(500).json({ error: error.message || '移除最近目录失败' });
    }
});

router.post('/approvals/:id', (req, res) => {
    try {
        res.json(runManager.resolveApproval(req.params.id, req.body && req.body.decision, req.user, getTenantId()));
    } catch (error) {
        res.status(error.statusCode || 500).json({ code: error.code, error: error.message });
    }
});

// 工作目录：内存会话的根目录优先；重启后会话不在内存时用 ?root=（与 /select 同样校验）
function resolveRoot(session, rawRoot) {
    if (session) return session.root;
    if (!rawRoot) return '';
    return guard.normalizeRoot(expandHome(String(rawRoot)));
}

// 「更改」= 智能体本会话的改动（可撤销）+ git 工作区的实际改动（手动 / 外部修改，只能查看）
router.get('/changes/:agentSessionId', async (req, res) => {
    try {
        let session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        const root = resolveRoot(session, req.query.root);
        // 重启后会话不在内存：按库里的记录恢复，智能体 / 命令的改动仍可查看与撤销
        if (!session && root) session = await runManager.restoreSession(req.params.agentSessionId, req.user, getTenantId(), root);
        if (!root) return res.json({ changes: [], diff: null, git: false });
        const collected = await workspaceChanges.collect(root, session ? session.changeLog.summary() : []);
        if (req.query.path) {
            const filePath = String(req.query.path);
            const diff = (session && session.changeLog.diff(filePath)) || await workspaceChanges.diff(root, filePath);
            if (!diff) return res.status(404).json({ code: 'AGENT_CHANGE_NOT_FOUND', error: '没有该文件的变更记录' });
            return res.json({ ...collected, diff });
        }
        res.json({ ...collected, diff: null });
    } catch (error) {
        const status = error.statusCode || (['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR'].includes(error.code) ? 400 : 500);
        res.status(status).json({ code: error.code, error: error.message });
    }
});

// 对话内文件卡片：读取工作目录内的文本文件，供「预览 / 代码」查看（只读，同 read_file 的越界与凭据文件限制）
const FILE_VIEW_MAX_BYTES = 2 * 1024 * 1024;
router.get('/file/:agentSessionId', async (req, res) => {
    try {
        const session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        const root = resolveRoot(session, req.query.root);
        if (!root) return res.status(400).json({ code: 'AGENT_ROOT_REQUIRED', error: '尚未选择工作目录' });
        const abs = guard.resolveInsideRoot(root, String(req.query.path || ''));
        const display = guard.toDisplayPath(root, abs);
        guard.assertNotSecretFile(abs);
        const stat = await fsp.stat(abs).catch(() => null);
        if (!stat) return res.status(404).json({ code: 'AGENT_FILE_NOT_FOUND', error: `文件不存在：${display}` });
        if (!stat.isFile()) return res.status(400).json({ code: 'AGENT_IS_DIR', error: `${display} 不是文件` });
        if (stat.size > FILE_VIEW_MAX_BYTES) return res.status(413).json({ code: 'AGENT_FILE_TOO_LARGE', error: `${display} 超过 2MB，无法在对话内预览`, size: stat.size });
        if (guard.looksBinaryByName(abs)) return res.status(415).json({ code: 'AGENT_BINARY', error: `${display} 是二进制文件` });
        const buffer = await fsp.readFile(abs);
        if (guard.isBinaryBuffer(buffer)) return res.status(415).json({ code: 'AGENT_BINARY', error: `${display} 是二进制文件` });
        res.json({ path: display, size: stat.size, mtimeMs: stat.mtimeMs, content: buffer.toString('utf8') });
    } catch (error) {
        const status = error.statusCode || (['AGENT_PATH_OUTSIDE', 'AGENT_PATH_INVALID', 'AGENT_SECRET_FILE'].includes(error.code) ? 403
            : ['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR', 'AGENT_ROOT_REQUIRED'].includes(error.code) ? 400 : 500);
        res.status(status).json({ code: error.code, error: error.message });
    }
});

// 恢复对话：上一轮的上下文占用 + 当前的实际改动
router.get('/state/:agentSessionId', async (req, res) => {
    try {
        const root = guard.normalizeRoot(expandHome(String(req.query.root || '')));
        const state = await runManager.loadSessionState(req.params.agentSessionId, req.user, getTenantId(), root);
        const collected = await workspaceChanges.collect(root, state.session ? state.session.changeLog.summary() : []);
        res.json({ context: state.context, turnCount: state.turnCount, ...collected });
    } catch (error) {
        const status = error.statusCode || (['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR', 'AGENT_ROOT_REQUIRED'].includes(error.code) ? 400 : 500);
        res.status(status).json({ code: error.code, error: error.message });
    }
});

// 只读账号不能撤销 / 创建 PR（这些会改动磁盘或仓库）
function requireWriter(req, res) {
    if (runManager.isAdminUser(req.user)) return true;
    res.status(403).json({ code: 'AGENT_READ_ONLY', error: '当前账号为只读权限，只有管理员可以修改文件或创建 PR' });
    return false;
}

router.post('/changes/:agentSessionId/revert', async (req, res) => {
    if (!requireWriter(req, res)) return;
    try {
        let session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        if (!session && req.body && req.body.root) {
            session = await runManager.restoreSession(req.params.agentSessionId, req.user, getTenantId(), resolveRoot(null, req.body.root));
        }
        if (!session) return res.status(404).json({ code: 'AGENT_SESSION_NOT_FOUND', error: '会话不存在或已过期' });
        if (session.activeRun) return res.status(409).json({ code: 'AGENT_RUN_BUSY', error: '任务进行中，暂不能撤销' });
        session.changeLog.revert(String(req.body && req.body.path || ''), { force: req.body?.force === true });
        await runManager.persistChanges(session);
        res.json(await workspaceChanges.collect(session.root, session.changeLog.summary()));
    } catch (error) {
        const status = error.statusCode || (error.code === 'AGENT_CHANGE_NOT_FOUND' ? 404 : ['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR'].includes(error.code) ? 400 : 500);
        res.status(status).json({ code: error.code, error: error.message });
    }
});

// ── 创建 PR ──────────────────────────────────────────
router.get('/pr/:agentSessionId/preflight', async (req, res) => {
    try {
        const session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        if (!session) return res.json({ ok: false, reason: 'NO_SESSION', isGit: false, hasGh: false, changedFiles: 0 });
        res.json(await prService.preflight(session.root, { changes: session.changeLog.summary() }));
    } catch (error) {
        res.status(error.statusCode || 500).json({ code: error.code, error: error.message });
    }
});

/**
 * POST /pr/:agentSessionId {title, body?, branch?} → NDJSON 流：
 * pr_step / approval / approval_result / tool_start / tool_result / done / error。
 */
router.post('/pr/:agentSessionId', async (req, res) => {
    if (!requireWriter(req, res)) return;
    let session;
    let run;
    try {
        session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        if (!session) return res.status(404).json({ code: 'AGENT_SESSION_NOT_FOUND', error: '会话不存在或已过期' });
        const changes = session.changeLog.summary();
        const check = await prService.preflight(session.root, { changes });
        if (!check.ok) return res.status(400).json({ code: `AGENT_PR_${check.reason}`, error: '当前无法创建 PR', preflight: check });
        const plan = prService.buildPlan({
            changes,
            title: req.body && req.body.title,
            body: req.body && req.body.body,
            branch: req.body && req.body.branch,
            gitPath: check.gitCommand || 'git',
            ghPath: check.ghCommand || 'gh'
        });
        const controller = new AbortController();
        run = runManager.beginRun(session, event => {
            if (res.destroyed || res.writableEnded) return;
            res.write(`${JSON.stringify(event)}\n`);
        }, controller.signal);
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
        res.on('close', () => { if (!res.writableEnded) controller.abort(); });
        run.write({ type: 'start', runId: run.id, branch: plan.branch, title: plan.title, steps: plan.steps.map(item => item.step), paths: plan.paths });
        const result = await prService.runPrFlow({
            session,
            run,
            plan,
            write: run.write,
            signal: controller.signal,
            classify: runManager.classifyDecision,
            requestApproval: runManager.requestApproval
        });
        run.write({ type: 'done', runId: run.id, ...result, gitBranch: runManager.readGitBranch(session.root) });
        res.end();
    } catch (error) {
        if (res.headersSent) {
            if (!res.writableEnded) {
                res.write(`${JSON.stringify({ type: 'error', code: error.code, error: error.message })}\n`);
                res.end();
            }
        } else {
            res.status(error.statusCode || 500).json({ code: error.code, error: error.message });
        }
    } finally {
        run?.end?.();
    }
});

module.exports = router;
