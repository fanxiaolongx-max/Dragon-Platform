// Dragon Claw 工作区：追踪 run_command 对工作目录文件的改动，让命令的修改也进入「更改」并可撤销。
// 命令执行前捕获状态，执行后对比：
//   - git 仓库：执行前读取已改动 / 未跟踪文件的内容；执行后新变化的文件，原内容取自 HEAD。
//     被 .gitignore 忽略的文件（依赖、构建产物）不追踪。
//   - 非 git 目录：执行前扫描文件大小与修改时间，较小的目录同时保存内容；大目录只能标记改动、不可撤销。
// 有上限，超出时降级为只标记不可撤销，不影响命令本身。
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const guard = require('./agent-path-guard');
const { MAX_SNAPSHOT_BYTES } = require('./agent-change-log');
const { _internal: git } = require('./agent-workspace-changes');

const MAX_TRACKED = 500;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const FS_MAX_FILES = 5000;
const FS_CONTENT_BUDGET = 32 * 1024 * 1024;
const MAX_CHANGES = 200;

function snapshot(absPath, budget) {
    try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return { exists: false, content: null, tooLarge: false, size: 0, mtimeMs: 0 };
        const base = { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
        if (stat.size > MAX_SNAPSHOT_BYTES || stat.size > budget.left) return { ...base, content: null, tooLarge: true };
        budget.left -= stat.size;
        return { ...base, content: fs.readFileSync(absPath), tooLarge: false };
    } catch (_error) {
        return { exists: false, content: null, tooLarge: false, size: 0, mtimeMs: 0 };
    }
}

function sameAsSnapshot(absPath, snap) {
    let stat = null;
    try { stat = fs.statSync(absPath); } catch (_error) { stat = null; }
    const exists = Boolean(stat && stat.isFile());
    if (!exists || !snap.exists) return exists === snap.exists;
    if (snap.content) {
        if (stat.size !== snap.content.length) return false;
        try { return fs.readFileSync(absPath).equals(snap.content); } catch (_error) { return false; }
    }
    return stat.size === snap.size && stat.mtimeMs === snap.mtimeMs;
}

function runGitBuffer(gitPath, cwd, args) {
    return new Promise(resolve => {
        execFile(gitPath, args, { cwd, encoding: 'buffer', timeout: 5000, maxBuffer: MAX_SNAPSHOT_BYTES + 1024, windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
            (error, stdout) => resolve(error ? null : stdout));
    });
}

async function gitStatusFiles(info, root) {
    const output = await git.runGit(info.git, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    if (output === null) return null;
    const files = new Set();
    for (const entry of git.parseStatus(output)) {
        for (const file of [entry.file, entry.from].filter(Boolean)) {
            const display = git.toRootPath(info, root, file);
            if (display) files.add(display);
        }
    }
    return files;
}

function walk(root, onFile) {
    const stack = [root];
    let count = 0;
    while (stack.length) {
        const dir = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { continue; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!guard.isIgnoredDirName(entry.name)) stack.push(full);
            } else if (entry.isFile()) {
                count += 1;
                if (count > FS_MAX_FILES) return false;
                onFile(full);
            }
        }
    }
    return true;
}

/** 命令执行前调用。失败或目录过大时返回 null（不追踪）。 */
async function captureBefore(root) {
    const info = await git.repoInfo(root);
    if (info) {
        const files = await gitStatusFiles(info, root);
        if (files === null) return null;
        // 固定执行前的 HEAD 和文件清单。命令可以提交、reset 或删除文件，不能再用执行后的 HEAD 推断原状态。
        const trackedOutput = await git.runGit(info.git, root, ['ls-files', '-z', '--full-name', '--', '.']);
        if (trackedOutput === null) return null;
        const tracked = new Set(trackedOutput.split('\0').filter(Boolean).map(file => git.toRootPath(info, root, file)).filter(Boolean));
        const head = info.hasHead ? await git.runGit(info.git, root, ['rev-parse', '--verify', 'HEAD']) : null;
        const budget = { left: MAX_CAPTURE_BYTES };
        const dirty = new Map();
        for (const display of [...files].slice(0, MAX_TRACKED)) dirty.set(display, snapshot(path.join(root, display), budget));
        return { mode: 'git', info, head: head?.trim(), tracked, dirty, overflow: files.size > MAX_TRACKED };
    }
    const files = new Map();
    const budget = { left: FS_CONTENT_BUDGET };
    const complete = walk(root, full => files.set(guard.toDisplayPath(root, full), snapshot(full, budget)));
    return complete ? { mode: 'fs', files } : null;
}

/** 命令执行后调用：返回改动列表 [{ display, abs, originalExists, original, originalTooLarge }] */
async function detectAfter(root, before) {
    if (!before) return [];
    const changes = [];
    const push = item => { if (changes.length < MAX_CHANGES) changes.push(item); };
    if (before.mode === 'git') {
        const after = await gitStatusFiles(before.info, root);
        if (after === null) return [];
        const candidates = new Set([...before.dirty.keys(), ...after]);
        for (const display of candidates) {
            const abs = path.join(root, display);
            const snap = before.dirty.get(display);
            if (snap) {
                if (sameAsSnapshot(abs, snap)) continue;
                push({ display, abs, originalExists: snap.exists, original: snap.content, originalTooLarge: snap.tooLarge });
                continue;
            }
            if (before.overflow) continue; // 执行前没能完整捕获，无法区分是否为本次命令造成
            // 执行前是干净的已跟踪文件或不存在：原内容取自 HEAD
            const repoRelative = path.relative(before.info.top, abs).split(path.sep).join('/');
            const existed = before.tracked.has(display);
            const original = existed && before.head ? await runGitBuffer(before.info.git, before.info.top, ['show', `${before.head}:${repoRelative}`]) : null;
            // 超限、超时或 git 读取失败都不代表原文件不存在。宁可禁用撤销，也不能把原文件当新建文件删除。
            push({ display, abs, originalExists: existed, original, originalTooLarge: existed && original === null });
        }
        return changes;
    }
    const seen = new Set();
    walk(root, full => {
        const display = guard.toDisplayPath(root, full);
        seen.add(display);
        const snap = before.files.get(display);
        if (!snap) return push({ display, abs: full, originalExists: false, original: null, originalTooLarge: false });
        if (!sameAsSnapshot(full, snap)) push({ display, abs: full, originalExists: true, original: snap.content, originalTooLarge: snap.tooLarge });
    });
    for (const [display, snap] of before.files) {
        if (seen.has(display) || !snap.exists) continue;
        push({ display, abs: path.join(root, display), originalExists: true, original: snap.content, originalTooLarge: snap.tooLarge });
    }
    return changes;
}

module.exports = { captureBefore, detectAfter };
