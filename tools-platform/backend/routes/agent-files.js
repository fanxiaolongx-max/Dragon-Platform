// 对话里的本地文件：Agent / 微信 / WeLink / 我的对话 回复中引用的本机文件，在网页里预览图片、下载文件。
// 权限沿用 Dragon Claw 工作区门禁：本机或管理员可读本机任意普通文件（凭据文件、隐藏目录除外）；
// 远程普通账号只能读平台 outputs 目录（以及 TOOLS_AGENT_FILE_ROOTS 追加的目录）。
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const access = require('../models/agent-workspace-access');
const guard = require('../models/agent-path-guard');
const artifacts = require('../models/agent-artifacts');
const { getTenantId } = require('../models/tenant-context');

const router = express.Router();
const PLATFORM_ROOT = path.resolve(__dirname, '../..');
// 隐藏目录里只放行 Agent 自己的生成物/附件目录（Codex 生图、粘贴的附件）
const AGENT_MEDIA_DIRS = ['.codex/generated_images', '.codex/attachments'].map(dir => path.join(os.homedir(), dir));

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const TEXT_TYPES = new Set(['.txt', '.md', '.csv', '.tsv', '.json', '.log', '.yaml', '.yml', '.xml', '.sql']);
const DOWNLOAD_TYPES = new Set(['.pdf', '.xlsx', '.xls', '.xlsm', '.csv', '.docx', '.doc', '.pptx', '.ppt', '.zip', '.7z', '.rar', '.gz', '.tgz', '.tar', '.html', '.htm', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.ndjson', '.py', '.js', '.ts', '.sh', '.ps1']);

function allowedExtension(ext) {
    return Boolean(IMAGE_TYPES[ext]) || TEXT_TYPES.has(ext) || DOWNLOAD_TYPES.has(ext);
}

function extraRoots() {
    return [path.join(PLATFORM_ROOT, 'outputs'), ...String(process.env.TOOLS_AGENT_FILE_ROOTS || '').split(path.delimiter)]
        .map(item => item.trim()).filter(Boolean).map(item => path.resolve(item));
}

function fileError(status, code, message) {
    const error = new Error(message);
    error.statusCode = status;
    error.code = code;
    return error;
}

function normalizeInput(raw) {
    let value = String(raw || '').trim();
    if (!value || value.length > 4096 || value.includes('\0')) throw fileError(400, 'AGENT_FILE_INVALID', '无效的文件路径');
    if (/^file:\/\//i.test(value)) {
        try { value = decodeURIComponent(new URL(value).pathname); } catch (_error) { throw fileError(400, 'AGENT_FILE_INVALID', '无效的文件路径'); }
        if (/^\/[A-Za-z]:\//.test(value)) value = value.slice(1);
    }
    // 引用里常见的 a.md:55、a.md:55:3、a.md#L55
    value = value.replace(/#L\d+(?:-L?\d+)?$/i, '').replace(/(\.[A-Za-z0-9]{1,8}):\d+(?::\d+)?$/, '$1');
    if (value.startsWith('~/')) value = path.join(os.homedir(), value.slice(2));
    if (!path.isAbsolute(value)) throw fileError(400, 'AGENT_FILE_RELATIVE', '只支持本机绝对路径');
    return path.resolve(value);
}

/** 解析并校验，返回 { real, stat, ext, name }；越权、敏感、不存在都抛错。 */
async function resolveFile(req, raw) {
    const abs = normalizeInput(raw);
    let real;
    try { real = await fsp.realpath(abs); } catch (_error) { throw fileError(404, 'AGENT_FILE_NOT_FOUND', '文件不存在或已被移动'); }
    const ext = path.extname(real).toLowerCase();
    if (!allowedExtension(ext)) throw fileError(415, 'AGENT_FILE_TYPE', `不支持预览或下载 ${ext || '无扩展名'} 文件`);
    // 隐藏目录（.ssh、.git、.aws…）和凭据文件一律不出
    const agentMedia = AGENT_MEDIA_DIRS.some(dir => { try { return guard.isInside(fs.realpathSync(dir), real); } catch (_error) { return false; } });
    if (!agentMedia && real.split(/[\\/]/).some(part => part.startsWith('.') && part !== '.' && part !== '..')) throw fileError(403, 'AGENT_FILE_HIDDEN', '不能读取隐藏目录中的文件');
    try { guard.assertNotSecretFile(real); } catch (error) { throw fileError(403, error.code, error.message); }
    // Agent 的大结果文件只给本人：管理员也不能读别人的
    const ownArtifact = artifacts.isUnderBase(real) && artifacts.belongsTo(`${getTenantId()}::${req.user?.username || ''}`, real);
    if (artifacts.isUnderBase(real) && !ownArtifact) throw fileError(403, 'AGENT_FILE_FORBIDDEN', '只能查看自己的 Agent 结果文件');
    if (!ownArtifact && !access.isAgentWorkspaceAllowed(req)) {
        const roots = extraRoots().map(root => { try { return fs.realpathSync(root); } catch (_error) { return null; } }).filter(Boolean);
        if (!roots.some(root => guard.isInside(root, real))) throw fileError(403, 'AGENT_FILE_FORBIDDEN', '该文件仅本机或管理员可查看');
    }
    const stat = await fsp.stat(real);
    if (!stat.isFile()) throw fileError(400, 'AGENT_FILE_NOT_FILE', '不是文件');
    return { real, stat, ext, name: path.basename(real) };
}

function sendError(res, error) {
    res.status(error.statusCode || 500).json({ code: error.code || 'AGENT_FILE_ERROR', error: error.statusCode ? error.message : '读取文件失败' });
}

router.get('/stat', async (req, res) => {
    try {
        const file = await resolveFile(req, req.query.path);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ name: file.name, size: file.stat.size, mtimeMs: file.stat.mtimeMs, kind: IMAGE_TYPES[file.ext] ? 'image' : 'file', previewable: Boolean(IMAGE_TYPES[file.ext]) || TEXT_TYPES.has(file.ext) || file.ext === '.pdf' });
    } catch (error) { sendError(res, error); }
});

router.get('/raw', async (req, res) => {
    try {
        const file = await resolveFile(req, req.query.path);
        const download = req.query.download === '1';
        const inline = !download && (Boolean(IMAGE_TYPES[file.ext]) || TEXT_TYPES.has(file.ext) || file.ext === '.pdf');
        const encoded = encodeURIComponent(file.name);
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encoded}"; filename*=UTF-8''${encoded}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, no-cache');
        // 同源直接打开时不让文件里的脚本运行（SVG、HTML 等）；PDF 交给浏览器自带查看器
        if (file.ext !== '.pdf') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
        const type = IMAGE_TYPES[file.ext] || (TEXT_TYPES.has(file.ext) ? 'text/plain; charset=utf-8' : file.ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
        res.setHeader('Content-Type', type);
        res.sendFile(file.real, { headers: { 'Content-Type': type }, dotfiles: 'deny' }, error => {
            if (error && !res.headersSent) sendError(res, fileError(500, 'AGENT_FILE_ERROR', '读取文件失败'));
        });
    } catch (error) { sendError(res, error); }
});

module.exports = router;
module.exports.resolveFile = resolveFile;
