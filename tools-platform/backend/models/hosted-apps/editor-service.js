// 托管 Python 应用在线代码编辑器（在线 IDE）与版本管理服务
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const runtime = require('./runtime');

const IGNORED_DIRS = new Set(['.git', '__pycache__', '.venv', 'venv', 'env', 'node_modules', '.idea', '.vscode', '.pytest_cache']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const MAX_EDIT_BYTES = 5 * 1024 * 1024; // 5MB

function runGit(codeDir, args, options = {}) {
    try {
        return execFileSync('git', ['-C', codeDir, ...args], {
            encoding: 'utf8',
            timeout: 20000,
            maxBuffer: 10 * 1024 * 1024,
            ...options
        }).trim();
    } catch (error) {
        const stderr = error.stderr ? String(error.stderr).trim() : '';
        const stdout = error.stdout ? String(error.stdout).trim() : '';
        const msg = stderr || stdout || error.message;
        const err = new Error(msg);
        err.status = 500;
        err.gitError = true;
        throw err;
    }
}

function resolveSafePath(slug, targetPath = '') {
    const codeDir = path.resolve(runtime.paths(slug).code);
    if (!fs.existsSync(codeDir)) {
        fs.mkdirSync(codeDir, { recursive: true });
    }
    const cleanRel = String(targetPath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    const resolved = path.resolve(codeDir, cleanRel);
    if (resolved !== codeDir && !resolved.startsWith(codeDir + path.sep)) {
        const err = new Error('非法路径访问（路径超出应用目录范围）');
        err.status = 403;
        throw err;
    }
    const parts = cleanRel.split('/').filter(Boolean);
    if (parts.some(p => p === '.git')) {
        const err = new Error('禁止直接访问 .git 内部目录');
        err.status = 403;
        throw err;
    }
    return { codeDir, resolved, relativePath: cleanRel };
}

function isBinaryFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const binaryExts = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svgz',
        '.zip', '.tar', '.gz', '.bz2', '.7z', '.whl',
        '.pyc', '.pyo', '.so', '.dylib', '.dll', '.exe',
        '.db', '.sqlite', '.sqlite3', '.pdf', '.woff', '.woff2', '.ttf', '.eot'
    ]);
    if (binaryExts.has(ext)) return true;
    try {
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
        fs.closeSync(fd);
        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) return true;
        }
    } catch (_e) {
        // ignore read error
    }
    return false;
}

function ensureGitRepo(slug) {
    const codeDir = path.resolve(runtime.paths(slug).code);
    if (!fs.existsSync(codeDir)) fs.mkdirSync(codeDir, { recursive: true });
    const gitDir = path.join(codeDir, '.git');
    if (!fs.existsSync(gitDir)) {
        const gitignoreFile = path.join(codeDir, '.gitignore');
        if (!fs.existsSync(gitignoreFile)) {
            const defaultIgnore = [
                '__pycache__/',
                '*.py[cod]',
                '*$py.class',
                'logs/',
                '*.log',
                '.venv/',
                'venv/',
                '.DS_Store',
                '_platform_host.py'
            ].join('\n') + '\n';
            fs.writeFileSync(gitignoreFile, defaultIgnore, 'utf8');
        }
        runGit(codeDir, ['init', '-b', 'main']);
        try { runGit(codeDir, ['config', 'user.name', 'dragon']); } catch (_e) {}
        try { runGit(codeDir, ['config', 'user.email', 'anshanfan@live.com']); } catch (_e) {}
        try {
            runGit(codeDir, ['add', '.']);
            runGit(codeDir, ['commit', '-m', `feat(${slug}): initial commit`]);
        } catch (_e) {
            // may be empty
        }
    }

    const state = runtime.readState(slug);
    if (state?.gitRemote) {
        try {
            const currentRemote = runGit(codeDir, ['remote', 'get-url', 'origin']);
            if (currentRemote !== state.gitRemote) {
                runGit(codeDir, ['remote', 'set-url', 'origin', state.gitRemote]);
            }
        } catch (_e) {
            try { runGit(codeDir, ['remote', 'add', 'origin', state.gitRemote]); } catch (_err) {}
        }
    }
    return codeDir;
}

function getFileTree(slug) {
    const codeDir = path.resolve(runtime.paths(slug).code);
    if (!fs.existsSync(codeDir)) return [];

    function walk(dirPath, relPrefix = '') {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const items = [];
        for (const entry of entries) {
            if (IGNORED_FILES.has(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (IGNORED_DIRS.has(entry.name)) continue;
                items.push({
                    name: entry.name,
                    path: relPath,
                    isDir: true,
                    children: walk(fullPath, relPath)
                });
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                if (entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) continue;
                if (relPrefix === 'logs' && entry.name.endsWith('.log')) continue;
                try {
                    const stats = fs.statSync(fullPath);
                    items.push({
                        name: entry.name,
                        path: relPath,
                        isDir: false,
                        size: stats.size,
                        mtime: stats.mtimeMs,
                        isBinary: isBinaryFile(fullPath)
                    });
                } catch (_e) {
                    // skip broken symlinks
                }
            }
        }
        items.sort((a, b) => {
            if (a.isDir && !b.isDir) return -1;
            if (!a.isDir && b.isDir) return 1;
            return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
        });
        return items;
    }

    return walk(codeDir, '');
}

function readFile(slug, relativePath) {
    const { resolved, relativePath: cleanRel } = resolveSafePath(slug, relativePath);
    if (!fs.existsSync(resolved)) {
        const err = new Error(`文件不存在：${cleanRel}`);
        err.status = 404;
        throw err;
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
        const err = new Error(`目标是目录而非文件：${cleanRel}`);
        err.status = 400;
        throw err;
    }
    const isBinary = isBinaryFile(resolved);
    if (isBinary) {
        return {
            path: cleanRel,
            name: path.basename(cleanRel),
            size: stat.size,
            mtime: stat.mtimeMs,
            ext: path.extname(cleanRel).toLowerCase(),
            isBinary: true,
            content: null
        };
    }
    if (stat.size > MAX_EDIT_BYTES) {
        const err = new Error(`文件大小超限（当前 ${(stat.size / (1024 * 1024)).toFixed(1)}MB，上限 5MB）`);
        err.status = 413;
        throw err;
    }
    const content = fs.readFileSync(resolved, 'utf8');
    return {
        path: cleanRel,
        name: path.basename(cleanRel),
        size: stat.size,
        mtime: stat.mtimeMs,
        ext: path.extname(cleanRel).toLowerCase(),
        isBinary: false,
        content
    };
}

function saveFile(slug, relativePath, content, { autoCommit = false, commitMessage = '' } = {}) {
    const { resolved, codeDir, relativePath: cleanRel } = resolveSafePath(slug, relativePath);
    const parentDir = path.dirname(resolved);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

    fs.writeFileSync(resolved, String(content), 'utf8');
    const stat = fs.statSync(resolved);

    let commitResult = null;
    if (autoCommit) {
        ensureGitRepo(slug);
        try {
            runGit(codeDir, ['add', cleanRel]);
            const msg = commitMessage || `chore(ide): update ${cleanRel}`;
            runGit(codeDir, ['commit', '-m', msg]);
            const hash = runGit(codeDir, ['rev-parse', '--short', 'HEAD']);
            commitResult = { hash, message: msg };
        } catch (_e) {
            // clean working tree or commit error
        }
    }

    const synced = runtime.syncStateFromCode(slug);

    return {
        success: true,
        path: cleanRel,
        size: stat.size,
        mtime: stat.mtimeMs,
        commit: commitResult,
        version: synced?.version || ''
    };
}

function createItem(slug, relativePath, isDir = false) {
    const { resolved, relativePath: cleanRel } = resolveSafePath(slug, relativePath);
    if (fs.existsSync(resolved)) {
        const err = new Error(`目标已存在：${cleanRel}`);
        err.status = 409;
        throw err;
    }
    if (isDir) {
        fs.mkdirSync(resolved, { recursive: true });
    } else {
        const parentDir = path.dirname(resolved);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(resolved, '', 'utf8');
    }
    return { success: true, path: cleanRel, isDir };
}

function deleteItem(slug, relativePath) {
    const { resolved, relativePath: cleanRel } = resolveSafePath(slug, relativePath);
    if (!cleanRel) {
        const err = new Error('禁止删除应用根目录');
        err.status = 403;
        throw err;
    }
    if (!fs.existsSync(resolved)) {
        const err = new Error(`目标不存在：${cleanRel}`);
        err.status = 404;
        throw err;
    }
    fs.rmSync(resolved, { recursive: true, force: true });
    return { success: true, path: cleanRel };
}

function renameItem(slug, oldPath, newPath) {
    const { resolved: oldResolved, relativePath: cleanOld } = resolveSafePath(slug, oldPath);
    const { resolved: newResolved, relativePath: cleanNew } = resolveSafePath(slug, newPath);
    if (!cleanOld || !cleanNew) {
        const err = new Error('路径无效');
        err.status = 400;
        throw err;
    }
    if (!fs.existsSync(oldResolved)) {
        const err = new Error(`源文件不存在：${cleanOld}`);
        err.status = 404;
        throw err;
    }
    if (fs.existsSync(newResolved)) {
        const err = new Error(`目标名称已存在：${cleanNew}`);
        err.status = 409;
        throw err;
    }
    const parentDir = path.dirname(newResolved);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.renameSync(oldResolved, newResolved);
    return { success: true, oldPath: cleanOld, newPath: cleanNew };
}

function getGitStatus(slug) {
    const codeDir = ensureGitRepo(slug);
    let branch = 'main';
    try {
        branch = runGit(codeDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch (_e) {}

    let remoteUrl = '';
    try {
        remoteUrl = runGit(codeDir, ['remote', 'get-url', 'origin']);
    } catch (_e) {
        const state = runtime.readState(slug);
        remoteUrl = state?.gitRemote || '';
    }

    const rawStatus = runGit(codeDir, ['status', '--porcelain=v1']);
    const lines = rawStatus.split('\n').map(l => l.trim()).filter(Boolean);
    const modified = [];
    const untracked = [];
    for (const line of lines) {
        const code = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (code === '??') untracked.push(file);
        else modified.push({ code: code.trim(), file });
    }

    let ahead = 0;
    let behind = 0;
    try {
        const tracking = runGit(codeDir, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
        const [a, b] = tracking.split(/\s+/).map(Number);
        ahead = a || 0;
        behind = b || 0;
    } catch (_e) {}

    const synced = runtime.syncStateFromCode(slug);

    return {
        branch,
        remoteUrl,
        clean: modified.length === 0 && untracked.length === 0,
        modified,
        untracked,
        ahead,
        behind,
        version: synced?.version || '',
        packageName: synced?.packageName || ''
    };
}

function getGitHistory(slug, limit = 40) {
    const codeDir = ensureGitRepo(slug);
    try {
        const raw = runGit(codeDir, ['log', `-n`, String(limit), '--format=%H|%h|%an|%ad|%s', '--date=iso']);
        if (!raw) return [];
        return raw.split('\n').filter(Boolean).map(line => {
            const [hash, shortHash, author, date, ...subjectParts] = line.split('|');
            return {
                hash,
                shortHash,
                author,
                date,
                message: subjectParts.join('|')
            };
        });
    } catch (_e) {
        return [];
    }
}

function nextVersion(rawVer) {
    const raw = String(rawVer || '').trim();
    if (!raw) return '1.0.1';
    const m = raw.match(/^v?(\d+)\.(\d+)\.(\d+)(.*)$/i);
    if (m) {
        const major = m[1];
        const minor = m[2];
        const patch = parseInt(m[3], 10) + 1;
        const extra = m[4] || '';
        return `${major}.${minor}.${patch}${extra}`;
    }
    const m2 = raw.match(/^v?(\d+)\.(\d+)(.*)$/i);
    if (m2) {
        return `${m2[1]}.${parseInt(m2[2], 10) + 1}${m2[3] || ''}`;
    }
    return `${raw}.1`;
}

function bumpAppVersion(slug) {
    const codeDir = ensureGitRepo(slug);
    let versionFile = null;
    let oldVersion = '';

    const entries = fs.readdirSync(codeDir, { withFileTypes: true });
    const vEntry = entries.find(e => e.isFile() && (/^[^/]+\.version$/i.test(e.name) || /^VERSION(?:\.txt)?$/i.test(e.name)));
    if (vEntry) {
        versionFile = path.join(codeDir, vEntry.name);
        try {
            oldVersion = fs.readFileSync(versionFile, 'utf8').trim();
        } catch (_e) {}
    }

    const manifestPath = path.join(codeDir, 'platform-app.json');
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!oldVersion && manifest?.version) {
                oldVersion = String(manifest.version).trim();
            }
        } catch (_e) {}
    }

    if (!oldVersion) {
        const state = runtime.readState(slug) || {};
        oldVersion = state.version || '1.0.0';
    }

    const newVersion = nextVersion(oldVersion);

    // 1. 写入版本标识文件
    if (versionFile) {
        fs.writeFileSync(versionFile, `${newVersion}\n`, 'utf8');
    } else {
        const defaultVFile = path.join(codeDir, `${slug}.version`);
        fs.writeFileSync(defaultVFile, `${newVersion}\n`, 'utf8');
        versionFile = defaultVFile;
    }

    // 2. 更新 platform-app.json（若存在）
    if (manifest) {
        manifest.version = newVersion;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    }

    // 3. 更新 README.md 中的版本号（若存在）
    const readmePath = path.join(codeDir, 'README.md');
    if (fs.existsSync(readmePath)) {
        try {
            const readmeText = fs.readFileSync(readmePath, 'utf8');
            const updatedReadme = readmeText.replace(
                new RegExp(`(版本\\s*[\`'"]v?)${oldVersion.replace(/\./g, '\\.')}([\`'"])`),
                `$1${newVersion}$2`
            );
            if (updatedReadme !== readmeText) {
                fs.writeFileSync(readmePath, updatedReadme, 'utf8');
            }
        } catch (_e) {}
    }

    // 4. 同步运行时内存与 state 状态
    runtime.syncStateFromCode(slug);

    return { oldVersion, newVersion, versionFile: path.basename(versionFile) };
}

function commitChanges(slug, message = '', user = '', { autoBump = false } = {}) {
    const codeDir = ensureGitRepo(slug);
    runGit(codeDir, ['add', '-A']);
    let status = runGit(codeDir, ['status', '--porcelain=v1']);
    if (!status && !autoBump) {
        return { committed: false, message: '没有检测到未提交的文件变动' };
    }
    let bumped = null;
    if (autoBump && status) {
        bumped = bumpAppVersion(slug);
        runGit(codeDir, ['add', '-A']);
        status = runGit(codeDir, ['status', '--porcelain=v1']);
    }
    if (!status) {
        return { committed: false, message: '没有检测到未提交的文件变动' };
    }
    const versionSuffix = bumped ? ` (v${bumped.newVersion})` : '';
    const finalMsg = message.trim()
        ? `${message.trim()}${bumped && !message.includes(bumped.newVersion) ? versionSuffix : ''}`
        : `update(ide): code changes by ${user || 'developer'} at ${new Date().toLocaleString('zh-CN')}${versionSuffix}`;
    runGit(codeDir, ['commit', '-m', finalMsg]);
    const hash = runGit(codeDir, ['rev-parse', 'HEAD']);
    const shortHash = hash.slice(0, 7);
    return { committed: true, hash, shortHash, message: finalMsg, version: bumped?.newVersion };
}

function revertToCommit(slug, commitHash) {
    const codeDir = ensureGitRepo(slug);
    const cleanHash = String(commitHash || '').trim();
    if (!/^[0-9a-fA-F]{6,40}$/.test(cleanHash)) {
        const err = new Error('无效的提交 Hash');
        err.status = 400;
        throw err;
    }
    runGit(codeDir, ['reset', '--hard', cleanHash]);
    const synced = runtime.syncStateFromCode(slug);
    return { success: true, commitHash: cleanHash, version: synced?.version || '' };
}

function setGitRemote(slug, remoteUrl) {
    const codeDir = ensureGitRepo(slug);
    const cleanUrl = String(remoteUrl || '').trim();
    let currentRemote = null;
    try { currentRemote = runGit(codeDir, ['remote', 'get-url', 'origin']); } catch (_e) {}

    if (!cleanUrl) {
        if (currentRemote) {
            try { runGit(codeDir, ['remote', 'remove', 'origin']); } catch (_e) {}
        }
    } else {
        if (currentRemote) {
            runGit(codeDir, ['remote', 'set-url', 'origin', cleanUrl]);
        } else {
            runGit(codeDir, ['remote', 'add', 'origin', cleanUrl]);
        }
    }
    runtime.updateState(slug, { gitRemote: cleanUrl });
    return { success: true, remoteUrl: cleanUrl };
}

function pushToRemote(slug, { force = false, autoBump = false, user = '' } = {}) {
    const codeDir = ensureGitRepo(slug);
    const status = getGitStatus(slug);
    if (!status.remoteUrl) {
        const err = new Error('未配置远程 Git 仓库地址，请先配置');
        err.status = 400;
        throw err;
    }
    const branch = status.branch || 'main';

    let bumpedVersion = null;
    if (autoBump) {
        const uncommitted = runGit(codeDir, ['status', '--porcelain=v1']);
        if (uncommitted) {
            const commitRes = commitChanges(slug, '', user, { autoBump: true });
            if (commitRes.committed) {
                bumpedVersion = commitRes.version;
            }
        } else {
            let isAhead = false;
            try {
                const aheadCount = runGit(codeDir, ['rev-list', '--count', `origin/${branch}..HEAD`]);
                isAhead = parseInt(aheadCount, 10) > 0;
            } catch (_e) {
                isAhead = true;
            }
            if (isAhead) {
                let versionAlreadyChanged = false;
                try {
                    const diffFiles = runGit(codeDir, ['diff', '--name-only', `origin/${branch}...HEAD`]);
                    versionAlreadyChanged = /(?:\.version$|platform-app\.json$)/m.test(diffFiles);
                } catch (_e) {
                    versionAlreadyChanged = false;
                }
                if (!versionAlreadyChanged) {
                    const bumped = bumpAppVersion(slug);
                    runGit(codeDir, ['add', '-A']);
                    runGit(codeDir, ['commit', '-m', `chore(release): bump version to v${bumped.newVersion} before push`]);
                    bumpedVersion = bumped.newVersion;
                }
            }
        }
    }

    const args = ['push'];
    if (force) args.push('-f');
    args.push('-u', 'origin', branch);
    const output = runGit(codeDir, args);
    const synced = runtime.syncStateFromCode(slug);
    return { success: true, output, version: bumpedVersion || synced?.version || '' };
}

function pullFromRemote(slug) {
    const codeDir = ensureGitRepo(slug);
    const status = getGitStatus(slug);
    if (!status.remoteUrl) {
        const err = new Error('未配置远程 Git 仓库地址，请先配置');
        err.status = 400;
        throw err;
    }
    const branch = status.branch || 'main';
    const output = runGit(codeDir, ['pull', 'origin', branch]);
    const synced = runtime.syncStateFromCode(slug);
    return { success: true, output, version: synced?.version || '' };
}

function getDiff(slug, { commitHash = null, filePath = null } = {}) {
    const codeDir = ensureGitRepo(slug);
    if (commitHash) {
        const cleanHash = String(commitHash).trim();
        const args = ['show', cleanHash];
        if (filePath) args.push('--', filePath);
        return { diff: runGit(codeDir, args) };
    }
    const args = ['diff', 'HEAD'];
    if (filePath) args.push('--', filePath);
    return { diff: runGit(codeDir, args) };
}

module.exports = {
    ensureGitRepo,
    getFileTree,
    readFile,
    saveFile,
    createItem,
    deleteItem,
    renameItem,
    getGitStatus,
    getGitHistory,
    commitChanges,
    revertToCommit,
    setGitRemote,
    pushToRemote,
    pullFromRemote,
    getDiff,
    bumpAppVersion
};
