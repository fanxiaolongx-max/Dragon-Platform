const { execFileAware: execFile } = require('./tenant-sandbox'); // 团队目录里的 git 在沙箱中执行
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const guard = require('./agent-path-guard');
const manager = require('./agent-run-manager');
const { findExecutable, _internal } = require('./agent-pr-service');
const mutations = new Set();
const failure = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

function git(cwd, args, optional = false) {
    const binary = findExecutable('git', _internal.GIT_CANDIDATES).path;
    if (!binary) return optional ? Promise.resolve(null) : Promise.reject(failure('WORKSPACE_GIT_MISSING', '未找到 Git，请先安装 Git'));
    return new Promise((resolve, reject) => execFile(binary, [
        '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${os.devNull}`, '-c', 'submodule.recurse=false', ...args
    ], { cwd, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    }, (error, stdout) => error ? optional ? resolve(null) : reject(failure('WORKSPACE_GIT_FAILED', 'Git 操作未完成，请检查仓库状态后重试')) : resolve(String(stdout))));
}

async function inspect(directory) {
    const root = guard.normalizeRoot(directory);
    const top = await git(root, ['rev-parse', '--show-toplevel'], true);
    if (!top?.trim()) return { git: false, root, branch: '', branches: [], worktrees: [] };
    const repoRoot = guard.normalizeRoot(top.trim());
    const [branch, head, refs, porcelain, gitDir, commonDir, status] = await Promise.all([
        git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], true),
        git(root, ['rev-parse', '--short', 'HEAD'], true),
        git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
        git(root, ['worktree', 'list', '--porcelain', '-z']),
        git(root, ['rev-parse', '--git-dir']), git(root, ['rev-parse', '--git-common-dir']),
        git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
    ]);
    const worktrees = [];
    for (const record of porcelain.split('\0\0')) {
        const fields = record.split('\0');
        const directoryField = fields.find(field => field.startsWith('worktree '));
        if (!directoryField || fields.includes('bare')) continue;
        const worktreeRoot = directoryField.slice(9);
        worktrees.push({ root: worktreeRoot, branch: (fields.find(field => field.startsWith('branch ')) || '').slice(7).replace(/^refs\/heads\//, ''),
            current: guard.samePath(repoRoot, worktreeRoot), available: await fs.stat(worktreeRoot).then(stat => stat.isDirectory(), () => false) });
    }
    return { git: true, root, repoRoot, branch: branch?.trim() || '', head: head?.trim() || '', dirty: Boolean(status),
        branches: refs.trim().split('\n').filter(Boolean).map(name => ({ name, current: name === branch?.trim(), worktreeRoot: worktrees.find(item => item.branch === name)?.root || '' })),
        isWorktree: !guard.samePath(path.resolve(root, gitDir.trim()), path.resolve(root, commonDir.trim())),
        commonDir: path.resolve(root, commonDir.trim()), mainRoot: worktrees[0]?.root || repoRoot, worktrees };
}

async function mutate(root, action) {
    const info = await inspect(root);
    if (!info.git) throw failure('WORKSPACE_NOT_GIT', '所选工作空间不是 Git 仓库', 400);
    if (mutations.has(info.commonDir)) throw failure('WORKSPACE_BUSY', '工作空间有正在执行的任务，请完成或停止后再操作');
    const release = manager.reserveWorkspaceMutation(info.repoRoot);
    mutations.add(info.commonDir);
    try { return await action(info); } finally { mutations.delete(info.commonDir);release(); }
}

async function switchBranch(root, branch, create = false) {
    if (typeof branch !== 'string' || !branch || branch.length > 160 || branch.startsWith('-') || /[\x00-\x20\x7f]/.test(branch)) throw failure('WORKSPACE_BRANCH_INVALID', '分支名称无效', 400);
    return mutate(root, async info => {
        if (await git(info.repoRoot, ['check-ref-format', '--branch', branch], true) === null) throw failure('WORKSPACE_BRANCH_INVALID', '分支名称无效', 400);
        const existing = info.branches.find(item => item.name === branch);
        if (!create && existing?.current) return info;
        if (!create && !existing || create && existing) throw failure('WORKSPACE_BRANCH_INVALID', create ? '分支已存在' : '分支不存在', 400);
        if (existing?.worktreeRoot && !guard.samePath(existing.worktreeRoot, info.repoRoot)) throw failure('WORKSPACE_BRANCH_IN_USE', '此分支已在其他 worktree 使用，请打开对应工作空间');
        if (info.dirty) throw failure('WORKSPACE_DIRTY', '有未提交的改动，请先提交或自行暂存后再切换分支');
        if (!info.head) throw failure('WORKSPACE_NO_COMMITS', '仓库尚无提交，请先完成首次提交');
        await git(info.repoRoot, create ? ['switch', '--no-guess', '--no-overwrite-ignore', '-c', branch] : ['switch', '--no-guess', '--no-overwrite-ignore', branch]);
        return inspect(root);
    });
}

async function createWorktree(root, scope) {
    return mutate(root, async info => {
        if (!info.head) throw failure('WORKSPACE_NO_COMMITS', '仓库尚无提交，不能创建 worktree');
        const id = crypto.randomUUID().slice(0, 8);
        const owner = crypto.createHash('sha256').update(String(scope)).digest('hex').slice(0, 16);
        const name = path.basename(info.repoRoot).replace(/[^\p{L}\p{N}_.-]/gu, '-').slice(0, 48) || 'workspace';
        const parent = path.join(path.dirname(info.mainRoot), '.dragonclaw-worktrees', owner);
        const target = path.join(parent, `${name}-${id}`), branch = `codex/workspace-${id}`;
        await fs.mkdir(parent, { recursive: true });
        await git(info.repoRoot, ['worktree', 'add', '--quiet', '-b', branch, target, 'HEAD']);
        const relative = path.relative(info.repoRoot, info.root);
        const selected = path.join(target, relative);
        const selectedRoot = await fs.stat(selected).then(stat => stat.isDirectory() ? selected : target, () => target);
        return { root: selectedRoot, git: await inspect(selectedRoot) };
    });
}

async function createDirectory(directory) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || /[\x00-\x1f\x7f]/.test(directory)) throw failure('WORKSPACE_PATH_INVALID', '请输入完整的文件夹路径', 400);
    const parent = guard.normalizeRoot(path.dirname(directory)), name = path.basename(directory);
    if (!name || name === '.' || name === '..') throw failure('WORKSPACE_PATH_INVALID', '文件夹名称无效', 400);
    const root = path.join(parent, name);
    try { await fs.mkdir(root); } catch (error) {
        if (error.code === 'EEXIST') throw failure('WORKSPACE_EXISTS', '此目录已存在，请使用“打开本地文件夹”', 409);
        throw failure('WORKSPACE_CREATE_FAILED', '无法创建文件夹，请检查路径和写入权限', 400);
    }
    return { root: guard.normalizeRoot(root) };
}

module.exports = { inspect, switchBranch, createWorktree, createDirectory };
