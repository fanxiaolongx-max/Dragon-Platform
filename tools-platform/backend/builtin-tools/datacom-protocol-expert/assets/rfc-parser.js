// RFC ASCII 位图解析，与渲染器解耦。
const FIELD_COLORS = [
    0x2563eb, 0x7c3aed, 0x0d9488, 0xdb2777, 0xea580c, 0x16a34a, 0x0891b2, 0xb45309, 0x4f46e5, 0x65a30d,
];
const SEPARATOR = /^\s*\+(?:[-+]+)\+?\s*$/;

export function isRfcDiagram(text) {
    const lines = String(text || '').split('\n');
    const separators = lines.filter((line) => SEPARATOR.test(line) && line.includes('-'));
    // 至少有一条分隔线带有字段边界（3 个以上 “+”），以排除普通的 ASCII 文本框
    return (
        separators.length >= 2 &&
        separators.some((line) => (line.match(/\+/g) || []).length >= 3) &&
        lines.some((line) => /^\s*\|.*\|/.test(line))
    );
}

// 解析 RFC 风格的位图：分隔线确定行宽，竖线位置换算成 bit 数，竖线外的文字当作注释
export function parseRfcDiagram(text) {
    const lines = String(text || '')
        .replace(/\t/g, '    ')
        .split('\n');
    const rulers = lines
        .filter((line) => /^\s*\d(\s+\d)+\s*$/.test(line))
        .map((line) => line.trim().split(/\s+/).length);
    const bitsPerRow =
        rulers.length && Math.max(...rulers) >= 8 && Math.max(...rulers) <= 64 ? Math.max(...rulers) : 32;
    const separators = lines.filter((line) => SEPARATOR.test(line));
    const start = Math.min(...separators.map((line) => line.indexOf('+')));
    const width = Math.max(...separators.map((line) => line.trimEnd().length - 1 - line.indexOf('+')));
    if (!Number.isFinite(width) || width < 4) return null;
    const fields = [];
    let groupFirstField = null;
    lines.forEach((line) => {
        if (SEPARATOR.test(line)) {
            groupFirstField = null;
            return;
        }
        if (!/^\s*\|/.test(line)) return;
        const pipes = [];
        for (let i = start; i <= start + width && i < line.length; i += 1) if (line[i] === '|') pipes.push(i);
        if (pipes[0] !== start) pipes.unshift(start);
        // 行尾缺少竖线（如 DD 的 “|I|M|MS”）：按分隔线宽度补一个虚拟边界，字段名取到行尾
        const open = pipes[pipes.length - 1] < start + width;
        if (open) pipes.push(start + width);
        const note = (open ? '' : line.slice(start + width + 1)).trim().replace(/^[(（]|[)）]$/g, '');
        const segments = [];
        for (let i = 0; i < pipes.length - 1; i += 1) {
            const chars = pipes[i + 1] - pipes[i];
            const textEnd = open && i === pipes.length - 2 ? line.length : pipes[i + 1];
            segments.push({
                name: line.slice(pipes[i] + 1, textEnd).trim(),
                bits: Math.max(1, Math.round((chars * bitsPerRow) / width)),
            });
        }
        const total = segments.reduce((sum, item) => sum + item.bits, 0);
        if (segments.length) segments[segments.length - 1].bits += bitsPerRow - total;
        // 同一分隔区内的空白续行：字段跨越多个 32 bit 字
        if (groupFirstField && segments.every((item) => !item.name || item.name === '...' || item.name === '…')) {
            if (segments.every((item) => !item.name)) {
                groupFirstField.bits += bitsPerRow;
                return;
            }
        }
        segments.forEach((segment, index) => {
            const field = {
                name: segment.name === '...' || segment.name === '…' ? '…（可重复）' : segment.name || '（保留）',
                bits: segment.bits,
                desc: note && segments.length === 1 ? note : segment.name === '0' ? '保留位，置 0。' : '',
                color: FIELD_COLORS[fields.length % FIELD_COLORS.length],
            };
            fields.push(field);
            if (index === 0) groupFirstField = segments.length === 1 ? field : null;
        });
    });
    if (!fields.length) return null;
    return { bitsPerRow, fields };
}
