// Dragon Claw 工作区：读取 git 工作区的实际改动（含用户手动、其他程序的修改），供右侧「更改」面板实时展示。
// 只读：status / diff，不改动仓库；非 git 目录返回 { git: false }，面板只显示智能体本会话的改动。
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { findExecutable, _internal: prInternal } = require('./agent-pr-service');
const { unifiedDiff, diffLines } = require('./agent-change-log');

const MAX_ENTRIES = 200;
const MAX_TEXT_BYTES = 512 * 1024;
const GIT_TIMEOUT_MS = 5000;

function gitBinary() {
    return findExecutable('git', prInternal.GIT_CANDIDATES).path;
}

// 成功返回 stdout，失败（非 git、无 HEAD、超时）返回 null。GIT_OPTIONAL_LOCKS=0：只读刷新不抢 index 锁。
function runGit(git, cwd, args) {
    return new Promise(resolve => {
        execFile(git, args, {
            cwd,
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }
        }, (error, stdout) => resolve(error ? null : String(stdout)));
    });
}

async function repoInfo(root) {
    const git = gitBinary();
    if (!git) return null;
    const top = await runGit(git, root, ['rev-parse', '--show-toplevel']);
    if (top === null || !top.trim()) return null;
    let realTop = top.trim();
    try { realTop = fs.realpathSync(realTop); } catch (_error) { /* 保持原样 */ }
    const hasHead = (await runGit(git, root, ['rev-parse', '--verify', '-q', 'HEAD'])) !== null;
    return { git, top: realTop, hasHead };
}

// 仓库相对路径 → 工作目录相对路径（工作目录可能是仓库的子目录）；目录外的返回 null
function toRootPath(info, root, repoRelative) {
    const rel = path.relative(root, path.join(info.top, repoRelative));
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return rel.split(path.sep).join('/');
}

function readText(absPath) {
    try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null;
        const buffer = fs.readFileSync(absPath);
        if (buffer.includes(0)) return null; // 二进制
        return buffer.toString('utf8');
    } catch (_error) {
        return null;
    }
}

function parseStatus(output) {
    const tokens = String(output || '').split('\0');
    const entries = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token || token.length < 4) continue;
        const x = token[0];
        const y = token[1];
        const file = token.slice(3);
        let from = null;
        if (x === 'R' || x === 'C') {
            from = tokens[index + 1] || null;
            index += 1;
        }
        let kind = 'modify';
        if (x === '?' && y === '?') kind = 'create';
        else if (x === 'R') kind = 'rename';
        else if (x === 'D' || y === 'D') kind = 'delete';
        else if (x === 'A' || x === 'C') kind = 'create';
        entries.push({ file, from, kind });
    }
    return entries;
}

// numstat -z：普通 "a\tr\tpath\0"；改名 "a\tr\t\0old\0new\0"；二进制 "-\t-\t…"
function parseNumstat(output) {
    const stats = new Map();
    const tokens = String(output || '').split('\0');
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token) continue;
        const match = token.match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
        if (!match) continue;
        let file = match[3];
        if (!file) {
            file = tokens[index + 2] || '';
            index += 2;
        }
        const binary = match[1] === '-' && match[2] === '-';
        stats.set(file, { added: binary ? 0 : Number(match[1]), removed: binary ? 0 : Number(match[2]), binary });
    }
    return stats;
}

/** 列出工作目录内相对 HEAD 的全部改动（含未跟踪文件）。 */
async function listChanges(root) {
    const info = await repoInfo(root);
    if (!info) return { git: false, changes: [] };
    const status = await runGit(info.git, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']);
    if (status === null) return { git: false, changes: [] };
    const numstatArgs = info.hasHead ? ['diff', 'HEAD', '--numstat', '-z', '-M', '--', '.'] : ['diff', '--cached', '--numstat', '-z', '--', '.'];
    const numstat = parseNumstat(await runGit(info.git, root, numstatArgs));
    const changes = [];
    for (const entry of parseStatus(status)) {
        if (changes.length >= MAX_ENTRIES) break;
        const display = toRootPath(info, root, entry.file);
        if (!display) continue;
        let added = 0;
        let removed = 0;
        let binary = false;
        if (numstat.has(entry.file)) {
            ({ added, removed, binary } = numstat.get(entry.file));
        } else if (entry.kind === 'create') {
            const text = readText(path.join(info.top, entry.file));
            if (text !== null) added = diffLines('', text).added;
            else binary = fs.existsSync(path.join(info.top, entry.file));
        }
        // 二进制文件（数据库、图片等）没有行数可比，内容变了就只标「二进制」
        const item = { path: display, kind: entry.kind, added, removed, source: 'git', revertible: false, ...(binary ? { binary: true } : {}) };
        const from = entry.from ? toRootPath(info, root, entry.from) : null;
        if (from) item.from = from;
        changes.push(item);
    }
    return { git: true, changes };
}

/** 单个文件相对 HEAD 的 unified diff；未跟踪文件按新建展示。 */
async function diff(root, displayPath) {
    const info = await repoInfo(root);
    if (!info) return null;
    const abs = path.resolve(root, String(displayPath || ''));
    const relToRoot = path.relative(root, abs);
    if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
    const repoRelative = path.relative(info.top, abs).split(path.sep).join('/');
    const args = info.hasHead ? ['diff', 'HEAD', '-M', '--', repoRelative] : ['diff', '--cached', '--', repoRelative];
    // 路径参数相对 git 的当前目录解释：在仓库根目录执行，用仓库相对路径
    const output = await runGit(info.git, info.top, args);
    const display = relToRoot.split(path.sep).join('/');
    if (output && output.trim()) {
        const lines = output.split('\n');
        const start = lines.findIndex(line => line.startsWith('--- '));
        const text = (start >= 0 ? lines.slice(start) : lines).join('\n').replace(/\n$/, '');
        const added = lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
        const removed = lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
        return { path: display, kind: 'modify', text, added, removed, truncated: false, source: 'git' };
    }
    const tracked = await runGit(info.git, info.top, ['ls-files', '--', repoRelative]);
    if (tracked && tracked.trim()) return { path: display, kind: 'modify', text: '', added: 0, removed: 0, truncated: false, source: 'git' };
    const text = readText(abs);
    if (text === null) {
        if (!fs.existsSync(abs)) return { path: display, kind: 'delete', text: '', added: 0, removed: 0, truncated: false, source: 'git' };
        return { path: display, kind: 'create', text: '（二进制或过大的文件，不显示内容）', added: 0, removed: 0, truncated: true, source: 'git' };
    }
    return { path: display, kind: 'create', ...unifiedDiff(display, '', text), source: 'git' };
}

/**
 * 合并智能体本会话的改动（可撤销）与 git 工作区的实际改动（外部改动，只能查看）。
 * 同一文件以智能体记录为准；非 git 目录只返回智能体记录。
 */
async function collect(root, agentChanges = []) {
    const agent = (agentChanges || []).map(item => ({ ...item, source: item.source || 'agent' })); // agent / command
    let live = { git: false, changes: [] };
    try {
        live = await listChanges(root);
    } catch (_error) {
        live = { git: false, changes: [] };
    }
    if (!live.git) return { git: false, changes: agent };
    const known = new Set(agent.flatMap(item => [item.path, item.from].filter(Boolean)));
    const external = live.changes.filter(item => !known.has(item.path) && !(item.from && known.has(item.from)));
    return { git: true, changes: [...agent, ...external] };
}

module.exports = { listChanges, diff, collect, _internal: { parseStatus, parseNumstat, toRootPath, repoInfo, runGit } };
