// SVG 教学图元：固定阅读方向、显式箭头、文字与状态双重编码。
export const esc = (value) =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
    );
let serial = 0;
export function svg(content, title, height = 420) {
    const id = `dk-diagram-${++serial}`;
    return `<svg class="dk-diagram" viewBox="0 0 880 ${height}" role="group" aria-labelledby="${id}"><title id="${id}">${esc(title)}</title><defs><marker id="${id}-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0 L8 4 L0 8" fill="var(--text-2)" stroke="none"/></marker></defs>${content.replaceAll('ARROW_ID', `${id}-arrow`)}</svg>`;
}
export const text = (x, y, label, cls = '', anchor = 'middle') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${esc(label)}</text>`;
export function node(id, x, y, title, sub = '', status = '', width = 148) {
    return `<g class="dk-dnode ${status}" data-part="${esc(id)}" role="button" tabindex="0" aria-label="${esc(title + '：' + sub)}"><rect x="${x - width / 2}" y="${y - 30}" width="${width}" height="60" rx="10"/>${text(x, y - 3, title, 'node-title')}${text(x, y + 18, sub, 'node-sub')}</g>`;
}
export function edge(id, x1, y1, x2, y2, label = '', status = '', bend = 0) {
    const d = bend ? `M${x1},${y1} Q${(x1 + x2) / 2},${(y1 + y2) / 2 + bend} ${x2},${y2}` : `M${x1},${y1} L${x2},${y2}`;
    return `<g class="dk-dedge ${status}"><path data-edge="${esc(id)}" d="${d}" marker-end="url(#ARROW_ID)"/>${label ? `<g class="edge-label"><rect x="${(x1 + x2) / 2 - Math.min(210, label.length * 6 + 10) / 2}" y="${(y1 + y2) / 2 + bend / 2 - 25}" width="${Math.min(210, label.length * 6 + 10)}" height="22" rx="5"/>${text((x1 + x2) / 2, (y1 + y2) / 2 + bend / 2 - 9, label, 'edge-text')}</g>` : ''}${status.includes('active') ? '<circle class="dk-traveler" r="5"/>' : ''}</g>`;
}
export const region = (x, y, w, h, title, cls = '') =>
    `<g class="dk-region ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16"/>${text(x + 18, y + 27, title, 'region-title', 'start')}</g>`;
export function flowDiagram(labels, active, { caption = '', statuses = [], edgeLabels = [] } = {}) {
    const n = labels.length,
        gap = 800 / n,
        width = Math.min(170, gap - 30);
    let out = '';
    for (let i = 0; i < n - 1; i++)
        out += edge(
            `flow-${i}`,
            40 + gap * (i + 0.5) + width / 2,
            185,
            40 + gap * (i + 1.5) - width / 2,
            185,
            edgeLabels[i] || '',
            statuses[i + 1]?.includes('blocked') && i < active
                ? 'blocked'
                : i === active - 1
                  ? 'active'
                  : i < active
                    ? 'done'
                    : '',
        );
    labels.forEach((item, i) => {
        out += node(
            item[2] || `part-${i}`,
            40 + gap * (i + 0.5),
            185,
            item[0],
            item[1],
            statuses[i] || (i === active ? 'active' : i < active ? 'done' : ''),
            width,
        );
    });
    out += text(440, 290, caption, 'diagram-caption');
    return svg(out, caption || labels.map((item) => item[0]).join(' → '), 340);
}
export function splitFields(fields, bitsPerRow = 32) {
    let offset = 0;
    return fields.flatMap((field, index) => {
        const bits = Number(field.bits);
        if (!Number.isFinite(bits) || bits <= 0 || bits > 65536) return [];
        const segments = [];
        let remaining = bits;
        while (remaining > 0) {
            const col = offset % bitsPerRow,
                take = Math.min(remaining, bitsPerRow - col);
            segments.push({
                ...field,
                index,
                row: Math.floor(offset / bitsPerRow),
                col,
                take,
                offset,
                continuation: remaining !== bits,
            });
            offset += take;
            remaining -= take;
        }
        return segments;
    });
}
export function bitDiagram(layer, selected = -1, bitsPerRow = 32) {
    const segments = splitFields(layer.fields, bitsPerRow);
    const rows = Math.max(1, ...segments.map((s) => s.row + 1));
    const unit = 768 / bitsPerRow;
    let out = text(56, 25, layer.name, 'region-title', 'start');
    for (let i = 0; i < bitsPerRow; i++) out += text(56 + (i + 0.5) * unit, 55, i, 'bit-ruler');
    for (let r = 0; r < rows; r++) out += text(42, 94 + r * 52, `${segments.some(f => f.variable && f.row < r) ? '?' : r * bitsPerRow}`, 'bit-ruler', 'end');
    segments.forEach((field) => {
        const x = 56 + field.col * unit,
            y = 70 + field.row * 52,
            w = field.take * unit;
        const label = w < 52 ? String(field.index + 1) : field.name;
        out += `<g class="dk-field ${selected === field.index ? 'active' : ''}" role="button" tabindex="0" data-part="field-${field.index}" aria-label="${esc(`${field.name}，${field.variable ? '可变长' : `${field.bits} bit`}`)}"><title>${esc(field.name)} · ${field.variable ? '可变长' : `${field.bits} bit`}</title><rect x="${x + 1}" y="${y}" width="${w - 2}" height="46" rx="4"/>${text(x + w / 2, y + 20, label, 'field-title')}${w >= 65 ? text(x + w / 2, y + 37, `${field.variable ? '可变长' : `${field.continuation ? '续段 · ' : ''}${field.take} bit`}`, 'bit-ruler') : ''}</g>`;
    });
    return svg(out, `${layer.name}，每行 ${bitsPerRow} bit；窄字段用序号标识`, 90 + rows * 52);
}
