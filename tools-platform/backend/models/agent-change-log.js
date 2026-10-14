// Dragon Claw 工作区：记录一次智能体会话内的文件变更，供右侧「更改」面板展示 diff 与撤销。
// 快照保存在内存中；撤销恢复到会话内第一次改动之前的状态。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const guard = require('./agent-path-guard');
const { redactText, containsSensitiveText } = require('./ai-sensitive-data');

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_LINES = 5000;

function splitLines(text) {
    if (!text) return [];
    const lines = String(text).split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

// 行级 LCS，输出 unified diff 所需的操作序列；超长文件只算统计。
function diffLines(before, after) {
    const a = splitLines(before);
    const b = splitLines(after);
    if (a.length + b.length > MAX_DIFF_LINES * 2) {
        return { ops: null, added: b.length, removed: a.length, truncated: true };
    }
    const n = a.length;
    const m = b.length;
    const table = new Array(n + 1);
    for (let i = 0; i <= n; i += 1) table[i] = new Uint32Array(m + 1);
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    let added = 0;
    let removed = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            ops.push({ type: ' ', text: a[i], oldLine: i + 1, newLine: j + 1 });
            i += 1; j += 1;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
            ops.push({ type: '-', text: a[i], oldLine: i + 1 });
            i += 1; removed += 1;
        } else {
            ops.push({ type: '+', text: b[j], newLine: j + 1 });
            j += 1; added += 1;
        }
    }
    while (i < n) { ops.push({ type: '-', text: a[i], oldLine: i + 1 }); i += 1; removed += 1; }
    while (j < m) { ops.push({ type: '+', text: b[j], newLine: j + 1 }); j += 1; added += 1; }
    return { ops, added, removed, truncated: false };
}

function unifiedDiff(displayPath, before, after, context = 3) {
    const { ops, added, removed, truncated } = diffLines(before, after);
    if (!ops) return { text: `（文件过大，仅统计：+${added} −${removed}）`, added, removed, truncated };
    if (!added && !removed) return { text: '', added, removed, truncated };
    const keep = new Array(ops.length).fill(false);
    ops.forEach((op, index) => {
        if (op.type === ' ') return;
        for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k += 1) keep[k] = true;
    });
    const lines = [`--- a/${displayPath}`, `+++ b/${displayPath}`];
    let index = 0;
    while (index < ops.length) {
        if (!keep[index]) { index += 1; continue; }
        let end = index;
        while (end < ops.length && keep[end]) end += 1;
        const hunk = ops.slice(index, end);
        const oldStart = hunk.find(op => op.oldLine)?.oldLine || 1;
        const newStart = hunk.find(op => op.newLine)?.newLine || 1;
        const oldCount = hunk.filter(op => op.type !== '+').length;
        const newCount = hunk.filter(op => op.type !== '-').length;
        lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
        hunk.forEach(op => lines.push(`${op.type}${op.text}`));
        index = end;
    }
    return { text: lines.join('\n'), added, removed, truncated };
}

function readSnapshot(absPath) {
    try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) return { exists: stat.isFile(), content: null, tooLarge: stat.size > MAX_SNAPSHOT_BYTES };
        return { exists: true, content: fs.readFileSync(absPath), tooLarge: false };
    } catch (_error) {
        return { exists: false, content: null, tooLarge: false };
    }
}

// 文件当前内容的指纹：撤销前用来判断智能体改完之后有没有被别人再改过
function hashOf(absPath) {
    try {
        const stat = fs.statSync(absPath);
        if (!stat.isFile()) return stat.isDirectory() ? 'dir' : 'other';
        if (stat.size > MAX_SNAPSHOT_BYTES) return `large:${stat.size}:${stat.mtimeMs}`;
        return crypto.createHash('sha1').update(fs.readFileSync(absPath)).digest('hex');
    } catch (_error) {
        return 'missing';
    }
}

function textOf(buffer) {
    return buffer ? buffer.toString('utf8') : '';
}

class AgentChangeLog {
    constructor(root) {
        this.root = root;
        this.entries = new Map(); // displayPath -> entry
    }

    /** 在修改前调用，保存该路径在会话中的首个快照。 */
    snapshotBefore(displayPath, absPath) {
        if (this.entries.has(displayPath)) return this.entries.get(displayPath);
        const before = readSnapshot(absPath);
        const entry = {
            path: displayPath,
            absPath,
            kind: before.exists ? 'modify' : 'create',
            originalExists: before.exists,
            original: before.content,
            originalTooLarge: before.tooLarge,
            added: 0,
            removed: 0,
            updatedAt: Date.now(),
            renamedFrom: null,
            source: 'agent',
            afterHash: null
        };
        this.entries.set(displayPath, entry);
        return entry;
    }

    /**
     * 记录命令等外部过程造成的改动。original 是改动前的内容（由调用方在执行前捕获）。
     * 该文件已有会话记录时保留最早的原始内容，只重算统计。
     */
    recordExternal(displayPath, absPath, { originalExists, original = null, originalTooLarge = false, source = 'command' } = {}) {
        if (!this.entries.has(displayPath)) {
            this.entries.set(displayPath, {
                path: displayPath,
                absPath,
                kind: originalExists ? 'modify' : 'create',
                originalExists: Boolean(originalExists),
                original,
                originalTooLarge: Boolean(originalTooLarge) || (originalExists && !original),
                added: 0,
                removed: 0,
                updatedAt: Date.now(),
                renamedFrom: null,
                source,
                afterHash: null
            });
        }
        return this.recordAfter(displayPath);
    }

    /** 在修改后调用，重新计算该文件相对会话初始状态的统计。 */
    recordAfter(displayPath, { kind } = {}) {
        const entry = this.entries.get(displayPath);
        if (!entry) return null;
        const after = readSnapshot(entry.absPath);
        if (kind) entry.kind = kind;
        else if (!after.exists) entry.kind = entry.originalExists ? 'delete' : 'create';
        else entry.kind = entry.renamedFrom && entry.originalExists ? 'rename' : entry.originalExists ? 'modify' : 'create';
        if (!after.exists && !entry.originalExists) {
            this.entries.delete(displayPath);
            return null;
        }
        if (entry.kind === 'modify' && after.content && entry.original && after.content.equals(entry.original)) {
            // 改回原样等于没有变化
            this.entries.delete(displayPath);
            return null;
        }
        const stats = diffLines(textOf(entry.original), after.exists ? textOf(after.content) : '');
        entry.added = stats.added;
        entry.removed = stats.removed;
        entry.updatedAt = Date.now();
        entry.afterHash = hashOf(entry.absPath);
        return entry;
    }

    recordRename(fromDisplay, fromAbs, toDisplay, toAbs) {
        const source = this.entries.get(fromDisplay);
        const originalExists = source ? source.originalExists : true;
        const origin = originalExists ? source?.renamedFrom || fromDisplay : null;
        const renamedFrom = origin && origin !== toDisplay ? origin : null;
        const entry = {
            path: toDisplay,
            absPath: toAbs,
            kind: renamedFrom ? 'rename' : originalExists ? 'modify' : 'create',
            originalExists,
            original: source ? source.original : readSnapshot(fromAbs).content,
            originalTooLarge: source ? source.originalTooLarge : false,
            added: 0,
            removed: 0,
            updatedAt: Date.now(),
            renamedFrom,
            renamedFromAbs: renamedFrom ? path.resolve(this.root, renamedFrom) : undefined,
            source: source?.source || 'agent',
            afterHash: hashOf(toAbs)
        };
        this.entries.delete(fromDisplay);
        this.entries.set(toDisplay, entry);
        return this.recordAfter(toDisplay);
    }

    summary() {
        return [...this.entries.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(entry => ({
                path: entry.path,
                kind: entry.kind,
                added: entry.added,
                removed: entry.removed,
                from: entry.renamedFrom || undefined,
                revertible: this.isRevertible(entry),
                source: entry.source || 'agent'
            }));
    }

    /** 持久化用：元数据 + 原始内容（Buffer），路径存相对工作目录 */
    toRecords() {
        return [...this.entries.values()].map(entry => {
            // 原文件含凭据时不把明文 BLOB 持久化；内存中的原内容仅用于当前进程内撤销。
            const sensitive = entry.original && (guard.isSecretFile(entry.absPath) || containsSensitiveText(textOf(entry.original), { secrets: this.sensitiveValues }));
            return {
                path: entry.path,
                meta: {
                    kind: entry.kind,
                    originalExists: entry.originalExists,
                    originalTooLarge: entry.originalTooLarge || Boolean(sensitive),
                    added: entry.added,
                    removed: entry.removed,
                    updatedAt: entry.updatedAt,
                    renamedFrom: entry.renamedFrom || null,
                    source: entry.source || 'agent',
                    afterHash: entry.afterHash || null
                },
                original: sensitive ? null : entry.original || null
            };
        });
    }

    static fromRecords(root, records = []) {
        const log = new AgentChangeLog(root);
        for (const record of records) {
            if (!record || !record.path || !record.meta) continue;
            const meta = record.meta;
            let absPath;
            let renamedFromAbs;
            try {
                absPath = guard.resolveInsideRoot(root, record.path);
                if (meta.renamedFrom) renamedFromAbs = guard.resolveInsideRoot(root, meta.renamedFrom);
            } catch (_error) { continue; }
            log.entries.set(record.path, {
                path: record.path,
                absPath,
                kind: meta.kind,
                originalExists: Boolean(meta.originalExists),
                original: record.original ? Buffer.from(record.original) : null,
                originalTooLarge: Boolean(meta.originalTooLarge),
                added: Number(meta.added) || 0,
                removed: Number(meta.removed) || 0,
                updatedAt: Number(meta.updatedAt) || Date.now(),
                renamedFrom: meta.renamedFrom || null,
                renamedFromAbs,
                source: meta.source || 'agent',
                afterHash: meta.afterHash || null
            });
        }
        return log;
    }

    isRevertible(entry) {
        if (entry.originalTooLarge) return false;
        return entry.originalExists ? Boolean(entry.original) : true;
    }

    diff(displayPath) {
        const entry = this.entries.get(displayPath);
        if (!entry) return null;
        const after = readSnapshot(entry.absPath);
        const result = unifiedDiff(entry.path, textOf(entry.original), after.exists ? textOf(after.content) : '');
        return { path: entry.path, kind: entry.kind, from: entry.renamedFrom || undefined, ...result, text: redactText(result.text, { secrets: this.sensitiveValues }) };
    }

    /** 恢复到会话开始前的状态。文件在记录之后又被改过时，除非 force，否则拒绝（避免覆盖用户后续工作）。 */
    revert(displayPath, { force = false } = {}) {
        const entry = this.entries.get(displayPath);
        if (!entry) throw Object.assign(new Error('没有该文件的变更记录'), { code: 'AGENT_CHANGE_NOT_FOUND' });
        if (!this.isRevertible(entry)) throw Object.assign(new Error('原文件过大或未保存快照，无法撤销'), { code: 'AGENT_CHANGE_NOT_REVERTIBLE' });
        guard.resolveInsideRoot(this.root, entry.path);
        if (entry.renamedFrom) guard.resolveInsideRoot(this.root, entry.renamedFrom);
        if (!force && entry.afterHash && hashOf(entry.absPath) !== entry.afterHash) {
            throw Object.assign(new Error(`${displayPath} 在这次改动之后又被修改过，撤销会一并丢掉这些后续修改`), { code: 'AGENT_CHANGE_CONFLICT', statusCode: 409 });
        }
        if (entry.renamedFrom && entry.originalExists) {
            // 目标文件的指纹没有变化，也可能有人在原路径创建了另一个文件。
            const destination = fs.lstatSync(entry.renamedFromAbs, { throwIfNoEntry: false });
            if (destination && (!force || !destination.isFile())) {
                throw Object.assign(new Error(`${entry.renamedFrom} 已被重新创建，撤销会覆盖该文件`), { code: 'AGENT_CHANGE_CONFLICT', statusCode: 409 });
            }
            if (fs.existsSync(entry.absPath)) {
                fs.mkdirSync(path.dirname(entry.renamedFromAbs), { recursive: true });
                fs.renameSync(entry.absPath, entry.renamedFromAbs);
            }
            if (entry.original) fs.writeFileSync(entry.renamedFromAbs, entry.original);
        } else if (!entry.originalExists) {
            fs.rmSync(entry.absPath, { force: true, recursive: true });
        } else {
            fs.mkdirSync(path.dirname(entry.absPath), { recursive: true });
            fs.writeFileSync(entry.absPath, entry.original);
        }
        this.entries.delete(displayPath);
        return this.summary();
    }
}

module.exports = { AgentChangeLog, diffLines, unifiedDiff, hashOf, MAX_SNAPSHOT_BYTES };
