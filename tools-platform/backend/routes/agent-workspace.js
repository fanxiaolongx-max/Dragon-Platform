// Dragon Claw 工作区 API：目录联想、选择与偏好、审批结算、变更列表与撤销。
// 整个路由过 agent-workspace-access 门禁（本机 / 桌面 / 管理员）；/capability 例外，返回 enabled:false 供前端隐藏入口。
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { pipeline } = require('node:stream/promises');
const access = require('../models/agent-workspace-access');
const prefsRepo = require('../models/agent-workspace-repository');
const runManager = require('../models/agent-run-manager');
const guard = require('../models/agent-path-guard');
const prService = require('../models/agent-pr-service');
const workspaceChanges = require('../models/agent-workspace-changes');
const workspaceGit = require('../models/agent-workspace-git');
const transcripts = require('../models/agent-transcript-repository');
const { getTenantId, runWithTenant } = require('../models/tenant-context');
const boundary = require('../models/team-boundary');
const { isSuperAdmin } = require('../middleware/auth');

const router = express.Router();
const SUGGEST_LIMIT = 50;

router.get('/capability', (req, res) => {
    const verdict = access.evaluate(req);
    const confined = boundary.isConfined(req.user);
    res.json({
        enabled: verdict.enabled,
        reason: verdict.reason,
        // 团队账号的「家目录」就是团队工作目录：目录联想、~ 展开都以它为根
        homeDir: verdict.enabled ? (confined ? boundary.workspaceRoot() : os.homedir()) : '',
        confined,
        canPrepareAccountDirectory: verdict.enabled && !isSuperAdmin(req.user),
        platform: process.platform,
        sep: path.sep,
        readOnly: !runManager.isAdminUser(req.user), // 管理员全部权限，其他账号只读
        permissionModes: runManager.PERMISSION_MODES
    });
});

router.use((req, res, next) => {
    const approvalId = req.method === 'POST' && req.path.match(/^\/approvals\/([^/]+)$/)?.[1];
    if (approvalId && runManager.isSharedMcpApproval(approvalId, req.user, getTenantId())) {
        const verdict = access.evaluate(req);
        if (verdict.reason !== 'ORIGIN_MISMATCH') return next();
    }
    return access.middleware(req, res, next);
});

// 只创建当前会话所属工作空间里的账号同名目录，不接收客户端路径。
router.post('/account-directory', async (req, res) => {
    const { username } = req.user;
    if (isSuperAdmin(req.user) || !/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(username || '')) {
        return res.status(403).json({ code: 'ACCOUNT_DIRECTORY_FORBIDDEN', error: '当前账号无法自动创建工作目录' });
    }
    try {
        const directory = path.join(boundary.workspaceRoot(), username);
        await fsp.mkdir(directory).catch(error => {
            if (error.code !== 'EEXIST') throw error;
        });
        // lstat 不跟随链接，遇到同名文件或符号链接时保留原项。
        if (!(await fsp.lstat(directory)).isDirectory()) {
            return res.status(409).json({ code: 'ACCOUNT_DIRECTORY_CONFLICT', error: '账号同名路径已被占用' });
        }
        res.json({ directory });
    } catch (_error) {
        res.status(500).json({ code: 'ACCOUNT_DIRECTORY_UNAVAILABLE', error: '无法准备账号工作目录' });
    }
});

router.get('/browser/view', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!runManager.isAdminUser(req.user)) return res.status(403).json({ code: 'ADMIN_REQUIRED', error: '浏览器画面仅管理员可查看' });
    try {
        const owner = runManager.ownerKey(req.user, getTenantId());
        res.json(await require('../models/agent-browser').view(owner));
    } catch (error) {
        res.status(503).json({ code: error.code || 'BROWSER_VIEW_UNAVAILABLE', error: '无法读取浏览器画面，请稍后刷新' });
    }
});

router.get('/browser/downloads/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!runManager.isAdminUser(req.user)) return res.status(403).json({ code: 'ADMIN_REQUIRED', error: '浏览器下载仅管理员可用' });
    let file;
    try {
        const owner = runManager.ownerKey(req.user, getTenantId());
        file = await require('../models/agent-browser').openDownload(owner, req.params.id);
        if (!file) return res.status(404).json({ code: 'BROWSER_DOWNLOAD_NOT_FOUND', error: '下载文件尚未完成或已失效' });
        res.attachment(file.name);
        res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size), 'X-Content-Type-Options': 'nosniff' });
        await pipeline(file.handle.createReadStream(), res);
    } catch {
        if (!res.headersSent && !res.destroyed) {
            res.removeHeader('Content-Disposition');
            res.removeHeader('Content-Length');
            res.status(503).json({ code: 'BROWSER_DOWNLOAD_FAILED', error: '无法读取下载文件，请重试' });
        }
    } finally {
        await file?.handle.close().catch(() => {});
    }
});

// 使用已有鉴权链的连续画面通道；不暴露 CDP 端口，不在 URL 中放 Token。
const browserStreams = new Map();
router.get('/browser/stream', async (req,res)=>{
    if(!runManager.isAdminUser(req.user))return res.status(403).json({code:'ADMIN_REQUIRED',error:'浏览器画面仅管理员可查看'});
    const owner=runManager.ownerKey(req.user,getTenantId());
    if((browserStreams.get(owner)||0)>=2)return res.status(429).json({code:'BROWSER_STREAM_LIMIT',error:'浏览器画面窗口过多'});
    browserStreams.set(owner,(browserStreams.get(owner)||0)+1);
    res.set({'Content-Type':'application/x-ndjson','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no'});
    res.flushHeaders();
    let closed=false;
    res.on('close',()=>{closed=true;});
    const until=Date.now()+45000;
    try{
        while(!closed&&Date.now()<until){
            const data=await require('../models/agent-browser').view(owner,true);
            if(closed)break;
            if(!res.write(JSON.stringify(data)+'\n')){
                await new Promise(resolve=>{
                    const done=()=>{clearTimeout(timer);res.off('drain',done);res.off('close',done);resolve();};
                    const timer=setTimeout(()=>{closed=true;done();},3000);
                    res.once('drain',done);res.once('close',done);
                });
            }
            if(!data.available)break;
            await new Promise(resolve=>setTimeout(resolve,250));
        }
    }catch(_error){if(!closed)res.write(JSON.stringify({error:'画面连接中断，请刷新重连'})+'\n');}
    finally{const count=(browserStreams.get(owner)||1)-1;count?browserStreams.set(owner,count):browserStreams.delete(owner);res.end();}
});

// 单独接收本次选择的文件；不接受任意服务器路径，不把文件内容放入 AI 消息。
router.post('/browser/upload', (req,res,next)=>{
    if(!runManager.isAdminUser(req.user))return res.status(403).json({code:'ADMIN_REQUIRED',error:'浏览器控制仅管理员可用'});
    const tenantId=getTenantId(),multer=require('multer'),limits=require('../models/agent-artifacts').UPLOAD_LIMITS;
    multer({storage:multer.memoryStorage(),limits:{fileSize:limits.fileBytes,files:limits.files,fields:8,fieldSize:1000}}).array('files',limits.files)(req,res,error=>runWithTenant(tenantId,()=>error?res.status(400).json({code:error.code,error:'单个文件上限 20MB，一次最多 5 个'}):next()));
},async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
        const owner=runManager.ownerKey(req.user,getTenantId());
        const files=(req.files||[]).map(file=>{
            const raw=file.originalname,decoded=Buffer.from(raw,'latin1').toString('utf8');
            return {originalname:decoded.includes('\ufffd')?raw:decoded,buffer:file.buffer};
        });
        const args={action:req.body.action==='file-drop'?'file-drop':'upload',token:req.body.token,frameId:req.body.frameId,chooserId:req.body.chooserId,_uploads:files};
        if(args.action==='file-drop'){args.x=Number(req.body.x);args.y=Number(req.body.y);}
        res.json(await require('../models/agent-browser').control(owner,args));
    }catch(error){
        const code=error.code||'BROWSER_UPLOAD_FAILED';
        const status=error.statusCode||(['BROWSER_VIEW_STALE','BROWSER_CONTROL_REQUIRED','BROWSER_NO_TAB'].includes(code)?409:code==='BROWSER_CONTROL_INVALID'?400:503);
        res.status(status).json({code,error:status===503?'上传未确认，请核对网页后继续':error.message});
    }
});

// 手动输入只发给当前账号的浏览器，不进入对话、工具转录或 AI 上下文。
router.post('/browser/control', async (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!runManager.isAdminUser(req.user))return res.status(403).json({code:'ADMIN_REQUIRED',error:'浏览器控制仅管理员可用'});
    try{
        const owner=runManager.ownerKey(req.user,getTenantId());
        res.json(await require('../models/agent-browser').control(owner,req.body||{}));
    }catch(error){
        const code=error.code||'BROWSER_CONTROL_FAILED';
        const status=code==='BROWSER_CONTROL_INVALID'?400:['BROWSER_NO_TAB','BROWSER_CONTROL_BUSY','BROWSER_CONTROL_REQUIRED','BROWSER_VIEW_STALE','BROWSER_CONTROL_LIMIT'].includes(code)?409:503;
        res.status(status).json({code,error:status===503?'浏览器操作未确认，请刷新画面核对后再继续':error.message});
    }
});

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

/** 解析用户给的目录：团队账号以团队工作目录为基准并校验不越界；超级管理员保持原行为 */
function userPath(req, input, what) {
    if (!boundary.isConfined(req.user)) return expandHome(input);
    const resolved = boundary.resolveUserPath(req.user, getTenantId(), input);
    boundary.assertAllowed(req.user, getTenantId(), resolved, what);
    return resolved;
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

// 团队账号的目录联想：只在团队工作目录内列子目录，越界输入返回空列表
async function suggestInsideWorkspace(req) {
    const tenantId = getTenantId();
    const root = boundary.workspaceRoot(tenantId);
    const showHidden = req.query.showHidden === 'true';
    const input = String(req.query.input || '').replace(/[\u0000-\u001f]/g, '');
    if (!input.trim() || input.trim() === '~') {
        const list = await listSubdirectories(root, { showHidden, limit: 50 });
        return { input: '', parent: root, prefix: '', exists: true, isDir: true, confined: true, groups: [{ label: 'home', base: root, entries: list.entries }] };
    }
    const resolved = path.resolve(boundary.resolveUserPath(req.user, tenantId, input));
    const endsWithSep = /[\\/]$/.test(input);
    const parent = endsWithSep ? resolved : path.dirname(resolved);
    const prefix = endsWithSep ? '' : path.basename(resolved);
    if (!boundary.isAllowedPath(tenantId, parent)) {
        return { input, parent: root, prefix: '', exists: false, isDir: false, confined: true, error: 'OUTSIDE_TEAM', groups: [{ label: 'children', base: root, entries: [] }] };
    }
    let exists = false;
    let isDir = false;
    try { const stat = await fsp.stat(resolved); exists = true; isDir = stat.isDirectory(); } catch (_error) { exists = false; }
    const listing = await listSubdirectories(parent, { prefix, showHidden });
    return { input, parent, prefix, exists, isDir, confined: true, isGit: isDir && fs.existsSync(path.join(resolved, '.git')), error: listing.error || undefined, groups: [{ label: 'children', base: parent, entries: listing.entries }] };
}

/**
 * GET /suggest?input=&showHidden=
 * 输入拆成「已存在的父目录 + 未完成的末段」，只列目录。空输入 → 家目录与根目录；
 * 以分隔符结尾 → 列该目录全部子目录。
 */
router.get('/suggest', async (req, res) => {
    try {
        if (boundary.isConfined(req.user)) return res.json(await suggestInsideWorkspace(req));
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

function workspaceMutation(handler) {
    return async (req, res) => {
        if (!runManager.isAdminUser(req.user)) return res.status(403).json({code:'AGENT_READ_ONLY',error:'当前账号只读，不能修改工作空间'});
        try { res.json(await handler(req)); }
        catch(error) { res.status(error.statusCode || 400).json({code:error.code || 'WORKSPACE_ERROR',error:error.message}); }
    };
}
router.get('/git', async (req, res) => {
    try { res.setHeader('Cache-Control','no-store');res.json(await workspaceGit.inspect(userPath(req, req.query.root))); }
    catch(error) { res.status(error.statusCode || 400).json({code:error.code,error:error.message}); }
});
router.post('/git/branch', workspaceMutation(req => workspaceGit.switchBranch(userPath(req, req.body?.root), req.body?.branch, req.body?.create === true)));
router.post('/git/worktree', workspaceMutation(async req => {
    const root = userPath(req, req.body?.root);
    if (boundary.isConfined(req.user)) {
        // worktree 建在主仓库的上一级目录：仓库就是团队工作目录本身时会落到团队空间外
        const info = await workspaceGit.inspect(root);
        if (info?.mainRoot) boundary.assertAllowed(req.user, getTenantId(), path.join(path.dirname(info.mainRoot), '.dragonclaw-worktrees'), 'Worktree 目录');
    }
    return workspaceGit.createWorktree(root, runManager.ownerKey(req.user,getTenantId()));
}));
router.post('/create', workspaceMutation(req => workspaceGit.createDirectory(userPath(req, req.body?.path, '新建目录'))));

router.post('/select', async (req, res) => {
    try {
        const root = guard.normalizeRoot(userPath(req, req.body && req.body.path, '所选目录'));
        boundary.assertAllowed(req.user, getTenantId(), root, '所选目录');
        const prefs = await prefsRepo.rememberDirectory(req.user.username, root);
        // 最近一次在该目录的会话 id：新标签页（sessionStorage 为空）重选同一目录时沿用，服务端转录才能接上
        const agentSessionId = await runManager.findLatestSessionId(req.user, getTenantId(), root);
        res.json({ root, git: await workspaceGit.inspect(root), gitBranch: runManager.readGitBranch(root), name: path.basename(root) || root, prefs, agentSessionId });
    } catch (error) {
        const status = error.code === 'TEAM_BOUNDARY' ? 403 : ['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR', 'AGENT_ROOT_REQUIRED'].includes(error.code) ? 400 : 500;
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
        res.json(runManager.resolveApproval(req.params.id, req.body && req.body.decision, req.user, getTenantId(), req.body && req.body.scope));
    } catch (error) {
        res.status(error.statusCode || 500).json({ code: error.code, error: error.message });
    }
});

// 工作目录：内存会话的根目录优先；重启后会话不在内存时用 ?root=（与 /select 同样校验）
function resolveRoot(req, session, rawRoot) {
    if (session) return session.root;
    if (!rawRoot) return '';
    return guard.normalizeRoot(userPath(req, String(rawRoot), '工作目录'));
}

// 「更改」= 智能体本会话的改动（可撤销）+ git 工作区的实际改动（手动 / 外部修改，只能查看）
router.get('/changes/:agentSessionId', async (req, res) => {
    try {
        let session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        const root = resolveRoot(req, session, req.query.root);
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
        const root = resolveRoot(req, session, req.query.root);
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
        const root = guard.normalizeRoot(userPath(req, String(req.query.root || ''), '工作目录'));
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
            session = await runManager.restoreSession(req.params.agentSessionId, req.user, getTenantId(), resolveRoot(req, null, req.body.root));
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

// 按轮回退：哪些轮次改过文件（对话里的回答据此显示「回退到这一轮之前」），以及执行回退
router.get('/checkpoints/:agentSessionId', async (req, res) => {
    try {
        const root = resolveRoot(req, null, String(req.query.root || ''));
        if (!root) return res.json({ runs: [] });
        const session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId())
            || await runManager.restoreSession(req.params.agentSessionId, req.user, getTenantId(), root);
        if (!session || session.root !== root) return res.json({ runs: [] });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ runs: await require('../models/agent-change-repository').listCheckpointRuns(session.id, session.owner) });
    } catch (error) {
        const status = error.statusCode || (['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR', 'AGENT_ROOT_REQUIRED'].includes(error.code) ? 400 : 500);
        res.status(status).json({ code: error.code, error: error.message });
    }
});

router.post('/checkpoints/:agentSessionId/rewind', async (req, res) => {
    if (!requireWriter(req, res)) return;
    try {
        let session = runManager.getSession(req.params.agentSessionId, req.user, getTenantId());
        if (!session && req.body && req.body.root) {
            session = await runManager.restoreSession(req.params.agentSessionId, req.user, getTenantId(), resolveRoot(req, null, req.body.root));
        }
        if (!session) return res.status(404).json({ code: 'AGENT_SESSION_NOT_FOUND', error: '会话不存在或已过期' });
        const result = await runManager.rewindToBefore(session, String(req.body && req.body.runId || ''));
        res.json({ ...result, ...await workspaceChanges.collect(session.root, session.changeLog.summary()) });
    } catch (error) {
        const status = error.statusCode || (['AGENT_ROOT_NOT_FOUND', 'AGENT_ROOT_NOT_DIR'].includes(error.code) ? 400 : 500);
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
