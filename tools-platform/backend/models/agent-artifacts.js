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

// 对话附件（首页对话里上传的文件）：与大结果文件同样按 租户/账号 分目录、只给本人，保留 30 天
const UPLOAD_KEEP_DAYS = 30;
const UPLOAD_LIMITS = { fileBytes: 20 * 1024 * 1024, files: 5 };
const UPLOAD_EXTENSIONS = new Set(['xlsx', 'xlsm', 'csv', 'tsv', 'txt', 'md', 'json', 'log', 'xml', 'yaml', 'yml', 'html', 'htm', 'docx', 'pptx', 'zip',
    'js', 'ts', 'py', 'java', 'go', 'sql', 'sh', 'css', 'ini', 'conf', 'png', 'jpg', 'jpeg', 'gif', 'webp']);

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

function uploadsBase() {
    return path.join(process.env.TOOLS_DATA_DIR || path.join(__dirname, '../data'), 'agent-uploads');
}

/** 本人的附件根目录：不选工作目录时，文件类工具以它为根 */
function uploadDir(owner) {
    const [tenant, ...user] = String(owner || '').split('::');
    return path.join(uploadsBase(), safeName(tenant || 'default'), safeName(user.join('::')));
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

function isUnderUploads(abs) {
    return guard.isInside(realOrSelf(uploadsBase()), realOrSelf(abs));
}

/** 本人的大结果文件或对话附件：在工作目录之外也允许读取 */
function ownsFile(owner, abs) {
    return Boolean(owner) && (belongsTo(owner, abs) || guard.isInside(realOrSelf(uploadDir(owner)), realOrSelf(abs)));
}

/** JSON 里各数组的项数（顶层和第二层），如「tables：7 项」 */
function jsonShape(value) {
    const parts = [];
    if (Array.isArray(value)) parts.push(`顶层数组 ${value.length} 项`);
    else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            if (Array.isArray(child)) parts.push(`${key}：${child.length} 项`);
            else if (child && typeof child === 'object') {
                for (const [inner, grand] of Object.entries(child)) if (Array.isArray(grand)) parts.push(`${key}.${inner}：${grand.length} 项`);
            }
            if (parts.length >= 8) break;
        }
    }
    return parts.join('，');
}

async function prune(dir, keepDays = LIMITS.keepDays) {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
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
    let text = String(content ?? '');
    if (text.length <= LIMITS.spillChars) return { content: text, artifact: null };
    // 数据库等工具返回的是单行 JSON：展开成多行，文件才能按行分段读取；顺便数出各数组有几项，写进说明，
    // 免得模型只看到开头结尾就去猜数量
    let shape = '';
    if (!text.includes('\n')) {
        try {
            const parsed = JSON.parse(text);
            text = JSON.stringify(parsed, null, 1);
            shape = jsonShape(parsed);
        } catch (_error) { /* 不是 JSON 就按原样存 */ }
    }
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
    const note = `…（结果共 ${text.length} 字符、${lines} 行，中间部分没有放进上下文。${shape ? `JSON 结构：${shape}。` : ''}完整内容已保存到 ${file}；回答数量、完整列表或中间的内容前，必须先用 read_file 读取该路径（指定 startLine 分段读），不能根据开头和结尾推测。）…`;
    return { content: `${head}\n${note}\n${tail}`, artifact: { path: file, size: Buffer.byteLength(full), lines } };
}

/**
 * 保存一个对话附件：放进本人附件目录下按时间新建的子目录，文件名只保留安全字符。
 * @returns {{ path, name, size }}
 */
async function saveUpload(owner, { originalname, buffer }) {
    const name = String(originalname || 'file').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').slice(-120) || 'file';
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!UPLOAD_EXTENSIONS.has(ext)) throw Object.assign(new Error(`不支持上传 .${ext || '（无扩展名）'} 文件`), { code: 'AGENT_UPLOAD_TYPE', statusCode: 400 });
    guard.assertNotSecretFile(name);
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
    const dir = path.join(uploadDir(owner), `${stamp}-${crypto.randomBytes(3).toString('hex')}`);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, name);
    await fsp.writeFile(file, buffer, { mode: 0o600 });
    if (Math.random() < 0.1) prune(uploadDir(owner), UPLOAD_KEEP_DAYS).catch(() => {});
    return { path: file, name, size: buffer.length };
}

/** 文本里出现的、属于本人的附件路径（附件说明用 Markdown 链接 [名称](<路径>) 写进用户消息） */
function uploadsIn(owner, texts) {
    const base = uploadDir(owner);
    const found = new Set();
    for (const text of texts) {
        for (const match of String(text || '').matchAll(/\(<([^>]+)>\)/g)) {
            if (guard.isInside(realOrSelf(base), realOrSelf(match[1])) && fs.existsSync(match[1])) found.add(match[1]);
        }
    }
    return [...found];
}

module.exports = { LIMITS, UPLOAD_LIMITS, UPLOAD_EXTENSIONS, baseDir, ownerDir, isUnderBase, belongsTo, uploadsBase, uploadDir, isUnderUploads, ownsFile, saveUpload, uploadsIn, spill, prune };
