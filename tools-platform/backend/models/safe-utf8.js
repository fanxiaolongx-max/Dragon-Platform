// 严格 UTF-8 判断与解码。
// 不要用 new TextDecoder('utf-8', { fatal: true })：桌面端（Electron 28 / Node 18）里它遇到非法字节时
// 不是抛出普通错误，而是有概率让整个主进程原生崩溃（Windows 上表现为窗口直接消失）。
// 这里先校验、再用不会抛错的方式解码，全程不经过那条路径。
const buffer = require('buffer');

function isValidUtf8(bytes) {
    if (!bytes || !bytes.length) return true;
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    if (typeof buffer.isUtf8 === 'function') return buffer.isUtf8(data);
    return Buffer.compare(Buffer.from(data.toString('utf8'), 'utf8'), data) === 0;
}

// 合法 UTF-8 返回字符串（与 TextDecoder 一致，去掉开头的 BOM），否则返回 null
function decodeUtf8Strict(bytes) {
    if (!bytes || !bytes.length) return '';
    if (!isValidUtf8(bytes)) return null;
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    const text = data.toString('utf8');
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

// 按字节截断的 UTF-8 片段两端可能各留下半个字符；去掉它们后再判断，避免整段被误当成 GBK
function trimPartialUtf8(data) {
    let start = 0;
    while (start < 3 && start < data.length && (data[start] & 0xC0) === 0x80) start += 1;
    let end = data.length;
    for (let back = 1; back <= 4 && back <= end - start; back += 1) {
        const byte = data[end - back];
        if ((byte & 0xC0) === 0x80) continue;
        const need = byte >= 0xF0 ? 4 : byte >= 0xE0 ? 3 : byte >= 0xC0 ? 2 : 1;
        if (need > back) end -= back;
        break;
    }
    return data.subarray(start, end);
}

module.exports = { isValidUtf8, decodeUtf8Strict, trimPartialUtf8 };
