// 需求 / 意见反馈的附件（任意格式，例如对话研发日志 JSON、表格、压缩包）。
// 和配图分开存：图片要校验格式并内联展示，附件只做大小限制，下载时一律按二进制附件返回。
const MAX_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const cleanName = name => String(name || 'file').replace(/[\\/\u0000-\u001f\u007f]+/g, '_').trim().slice(0, 160) || 'file';
const cleanType = type => /^[\w.+-]+\/[\w.+-]+$/.test(String(type || '')) ? String(type).slice(0, 100) : 'application/octet-stream';

function parseFiles(input) {
    if (input === undefined || input === null) return [];
    const invalid = () => Object.assign(new Error('最多上传 5 个附件，合计不超过 20 MB'), { status: 400, code: 'REQUIREMENT_FILE_INVALID' });
    if (!Array.isArray(input) || input.length > MAX_FILES) throw invalid();
    let total = 0;
    return input.map(file => {
        if (typeof file?.data !== 'string' || file.data.length > 4 * Math.ceil(MAX_FILE_BYTES / 3)) throw invalid();
        const bytes = Buffer.from(file.data, 'base64');
        total += bytes.length;
        if (bytes.length > MAX_FILE_BYTES || total > MAX_TOTAL_BYTES || bytes.toString('base64') !== file.data) throw invalid();
        return { name: cleanName(file.name), type: cleanType(file.type), bytes };
    });
}

module.exports = { parseFiles, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES };
