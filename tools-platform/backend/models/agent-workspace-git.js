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
        const wtBranch = (fields.find(field => field.startsWith('branch ')) || '').slice(7).replace(/^refs\/heads\//, '');
        const available = await fs.stat(worktreeRoot).then(stat => stat.isDirectory(), () => false);
        worktrees.push({
            root: worktreeRoot,
            branch: wtBranch,
            current: guard.samePath(repoRoot, worktreeRoot),
            isMain: worktrees.length === 0,
            available,
            dirty: false,
            ahead: 0,
            behind: 0
        });
    }
    const mainBranch = worktrees[0]?.branch || '';
    await Promise.all(worktrees.map(async (item, index) => {
        if (!item.available) return;
        const wtStatus = index === 0 && guard.samePath(repoRoot, item.root)
            ? status
            : await git(item.root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], true);
        item.dirty = Boolean(wtStatus);
        if (index > 0 && item.branch && mainBranch && item.branch !== mainBranch) {
            const counts = await git(repoRoot, ['rev-list', '--left-right', '--count', `${mainBranch}...${item.branch}`], true);
            const parts = String(counts || '').trim().split(/\s+/);
            if (parts.length === 2) {
                item.behind = Number(parts[0]) || 0;
                item.ahead = Number(parts[1]) || 0;
            }
        }
    }));
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

async function commitAll(root, message) {
    if (typeof message !== 'string' || !message.trim() || message.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) {
        throw failure('WORKSPACE_COMMIT_INVALID', '请输入有效的提交说明（1-500 字）', 400);
    }
    return mutate(root, async info => {
        if (!info.dirty) return { committed: false, clean: true, git: info };
        await git(info.repoRoot, ['add', '-A']);
        await git(info.repoRoot, ['commit', '--no-gpg-sign', '-m', message.trim()]);
        return { committed: true, git: await inspect(root) };
    });
}

async function mergeWorktree(root, { targetBranch = '', mode = 'merge', message = '', removeAfter = false } = {}) {
    const mergeMode = mode === 'squash' ? 'squash' : 'merge';
    return mutate(root, async info => {
        if (!info.isWorktree || guard.samePath(info.repoRoot, info.mainRoot)) {
            throw failure('WORKSPACE_NOT_WORKTREE', '当前不在独立 Worktree 中，无需合并', 400);
        }
        const sourceBranch = info.branch;
        if (!sourceBranch) throw failure('WORKSPACE_BRANCH_INVALID', '当前 Worktree 处于分离 HEAD，请先创建分支再合并', 400);
        if (info.dirty) throw failure('WORKSPACE_DIRTY', '当前 Worktree 还有未提交的改动，请先提交后再合并', 409);
        const mainInfo = await inspect(info.mainRoot);
        const target = (typeof targetBranch === 'string' && targetBranch.trim()) ? targetBranch.trim() : mainInfo.branch;
        if (!target || target === sourceBranch) throw failure('WORKSPACE_TARGET_INVALID', '找不到可合并的目标主分支', 400);
        if (mainInfo.branch !== target) throw failure('WORKSPACE_TARGET_NOT_CHECKED_OUT', `主仓库当前位于 ${mainInfo.branch || 'HEAD'}，请先切到 ${target} 再合并`, 409);
        if (mainInfo.dirty) throw failure('WORKSPACE_MAIN_DIRTY', '主仓库有未提交改动，请先提交或清理主仓库后再合并', 409);

        const aheadRaw = await git(info.mainRoot, ['rev-list', '--count', `${target}..${sourceBranch}`]);
        if ((Number(aheadRaw.trim()) || 0) === 0) {
            return { merged: false, nothingToMerge: true, targetBranch: target, sourceBranch, mainRoot: info.mainRoot, git: info };
        }
        const commitMsg = (typeof message === 'string' && message.trim() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message))
            ? message.trim().slice(0, 500)
            : `Merge ${sourceBranch} into ${target}`;
        try {
            if (mergeMode === 'squash') {
                await git(info.mainRoot, ['merge', '--squash', sourceBranch]);
                await git(info.mainRoot, ['commit', '--no-gpg-sign', '-m', commitMsg]);
            } else {
                await git(info.mainRoot, ['merge', '--no-ff', '--no-gpg-sign', '-m', commitMsg, sourceBranch]);
            }
        } catch {
            await git(info.mainRoot, ['merge', '--abort'], true);
            await git(info.mainRoot, ['reset', '--merge'], true);
            throw failure('WORKSPACE_MERGE_CONFLICT', '合并发生冲突，已自动中止以保护主仓库，请先解决冲突', 409);
        }
        if (removeAfter) {
            await git(info.mainRoot, ['worktree', 'remove', info.repoRoot]);
            await git(info.mainRoot, ['worktree', 'prune'], true);
            await git(info.mainRoot, ['branch', mergeMode === 'squash' ? '-D' : '-d', sourceBranch], true);
        }
        const nextRoot = removeAfter ? info.mainRoot : info.root;
        return {
            merged: true,
            mode: mergeMode,
            targetBranch: target,
            sourceBranch,
            mainRoot: info.mainRoot,
            removed: Boolean(removeAfter),
            root: nextRoot,
            git: await inspect(nextRoot)
        };
    });
}

async function removeWorktree(root, { worktreeRoot = '', force = false, deleteBranch = false } = {}) {
    return mutate(root, async info => {
        const targetPath = worktreeRoot ? guard.normalizeRoot(worktreeRoot) : info.repoRoot;
        const target = info.worktrees.find(item => guard.samePath(item.root, targetPath));
        if (!target || guard.samePath(target.root, info.mainRoot)) {
            throw failure('WORKSPACE_NOT_WORKTREE', '不能移除主仓库目录，仅可移除独立 Worktree', 400);
        }
        if (!force && target.dirty) {
            throw failure('WORKSPACE_DIRTY', '该 Worktree 还有未提交改动，请先提交或勾选强制移除', 409);
        }
        await git(info.mainRoot, force ? ['worktree', 'remove', '--force', target.root] : ['worktree', 'remove', target.root]);
        await git(info.mainRoot, ['worktree', 'prune'], true);
        if (deleteBranch && target.branch) {
            await git(info.mainRoot, ['branch', force ? '-D' : '-d', target.branch], true);
        }
        return { removed: true, removedRoot: target.root, mainRoot: info.mainRoot, git: await inspect(info.mainRoot) };
    });
}

async function diffSummary(directory, baseRef = 'HEAD') {
    const info = await inspect(directory);
    if (!info.git) return null;
    const raw = await git(info.repoRoot, ['diff', '--numstat', baseRef], true);
    const untracked = await git(info.repoRoot, ['ls-files', '--others', '--exclude-standard'], true);
    let files = 0, added = 0, removed = 0;
    for (const line of String(raw || '').split('\n')) {
        if (!line.trim()) continue;
        const [a, r] = line.split('\t');
        files += 1;
        if (/^\d+$/.test(a)) added += Number(a);
        if (/^\d+$/.test(r)) removed += Number(r);
    }
    const untrackedCount = String(untracked || '').split('\n').filter(Boolean).length;
    files += untrackedCount;
    return { dirty: info.dirty, files, added, removed, branch: info.branch };
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

module.exports = { inspect, switchBranch, createWorktree, commitAll, mergeWorktree, removeWorktree, diffSummary, createDirectory };
