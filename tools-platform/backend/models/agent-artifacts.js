// 工作区 Agent 的大工具结果：超过上限时完整内容存成文件，上下文里只留开头、结尾和文件路径，模型需要时用 read_file 按行读取。
// 存在数据目录的 agent-artifacts/<租户>/<账号>/<会话>/ 下，不放进 outputs/（里面可能有数据库查询结果）；
// 只有本人能读：read_file 与 /api/agent-files 都按账号目录核对。内容在写入前已脱敏。
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const guard = require('./agent-path-guard');

const LIMITS = {
    spillChars: 8 * 1024,     // 超过这个长度存文件
    headChars: 3000,          // 上下文里保留的开头
    tailChars: 1500,          // 上下文里保留的结尾
    fileChars: 20 * 1024 * 1024,
    keepDays: 14
};

function baseDir() {
    return path.join(process.env.TOOLS_DATA_DIR || path.join(__dirname, '../data'), 'agent-artifacts');
}

// 目录名保留可读部分，加哈希避免不同名字清洗后撞车
function safeName(value) {
    const raw = String(value || '');
    const readable = raw.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';
    return `${readable}-${crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8)}`;
}

/** owner 是 agent-run-manager 的 ownerKey：`租户::账号` */
function ownerDir(owner) {
    const [tenant, ...user] = String(owner || '').split('::');
    return path.join(baseDir(), safeName(tenant || 'default'), safeName(user.join('::')));
}

function realOrSelf(target) {
    try { return fs.realpathSync(target); } catch (_error) { return path.resolve(target); }
}

function isUnderBase(abs) {
    return guard.isInside(realOrSelf(baseDir()), realOrSelf(abs));
}

function belongsTo(owner, abs) {
    return guard.isInside(realOrSelf(ownerDir(owner)), realOrSelf(abs));
}

async function prune(dir) {
    const cutoff = Date.now() - LIMITS.keepDays * 24 * 60 * 60 * 1000;
    const sessions = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessions) {
        if (!entry.isDirectory()) continue;
        const sessionDir = path.join(dir, entry.name);
        const files = await fsp.readdir(sessionDir).catch(() => []);
        for (const name of files) {
            const file = path.join(sessionDir, name);
            const stat = await fsp.stat(file).catch(() => null);
            if (stat && stat.mtimeMs < cutoff) await fsp.unlink(file).catch(() => {});
        }
        await fsp.rmdir(sessionDir).catch(() => {}); // 只删空目录
    }
}

/**
 * 结果不超过上限时原样返回；超过时写入文件，返回 { content（开头 + 说明 + 结尾）, artifact: { path, size, lines } }。
 * 写文件失败时退回掐头去尾，不影响本轮继续。
 */
async function spill({ owner, sessionId, callId, toolName, content }) {
    const text = String(content ?? '');
    if (text.length <= LIMITS.spillChars) return { content: text, artifact: null };
    const full = text.length > LIMITS.fileChars ? `${text.slice(0, LIMITS.fileChars)}\n…（超过 ${LIMITS.fileChars} 字符的部分未保存）` : text;
    const lines = full.split('\n').length;
    const head = text.slice(0, LIMITS.headChars);
    const tail = text.slice(-LIMITS.tailChars);
    const dir = path.join(ownerDir(owner), safeName(sessionId));
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '');
    const file = path.join(dir, `${stamp}-${String(toolName || 'tool').replace(/[^A-Za-z0-9_-]/g, '_')}-${safeName(callId)}.txt`);
    try {
        await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
        await fsp.writeFile(file, full, { mode: 0o600 });
        if (Math.random() < 0.05) prune(ownerDir(owner)).catch(() => {});
    } catch (error) {
        console.warn('[agent] failed to save a large tool result:', error.message);
        return { content: `${head}\n…（结果过长，已截断，共 ${text.length} 字符）…\n${tail}`, artifact: null };
    }
    const note = `…（结果共 ${text.length} 字符、${lines} 行，中间部分没有放进上下文。完整内容已保存到 ${file}；需要时用 read_file 读取该路径并指定 startLine，查找内容可先按行号分段读取。）…`;
    return { content: `${head}\n${note}\n${tail}`, artifact: { path: file, size: Buffer.byteLength(full), lines } };
}

module.exports = { LIMITS, baseDir, ownerDir, isUnderBase, belongsTo, spill, prune };
