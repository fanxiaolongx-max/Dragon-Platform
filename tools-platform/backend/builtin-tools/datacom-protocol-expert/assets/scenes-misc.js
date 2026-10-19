// 通用场景：任意 RFC ASCII 报文图 → 3D 拆解；知识星图。
import { PALETTE, span, ease, pathPoint } from './engine3d.js';
import { buildBitLayers } from './scenes-ospf.js';

const FIELD_COLORS = [0x2563eb, 0x7c3aed, 0x0d9488, 0xdb2777, 0xea580c, 0x16a34a, 0x0891b2, 0xb45309, 0x4f46e5, 0x65a30d];
const SEPARATOR = /^\s*\+(?:[-+]+)\+?\s*$/;

export function isRfcDiagram(text) {
    const lines = String(text || '').split('\n');
    const separators = lines.filter(line => SEPARATOR.test(line) && line.includes('-'));
    // 至少有一条分隔线带有字段边界（3 个以上 “+”），以排除普通的 ASCII 文本框
    return separators.length >= 2 && separators.some(line => (line.match(/\+/g) || []).length >= 3) && lines.some(line => /^\s*\|.*\|/.test(line));
}

// 解析 RFC 风格的位图：分隔线确定行宽，竖线位置换算成 bit 数，竖线外的文字当作注释
export function parseRfcDiagram(text) {
    const lines = String(text || '').replace(/\t/g, '    ').split('\n');
    const rulers = lines.filter(line => /^\s*\d(\s+\d)+\s*$/.test(line)).map(line => line.trim().split(/\s+/).length);
    const bitsPerRow = rulers.length && Math.max(...rulers) >= 8 && Math.max(...rulers) <= 64 ? Math.max(...rulers) : 32;
    const separators = lines.filter(line => SEPARATOR.test(line));
    const start = Math.min(...separators.map(line => line.indexOf('+')));
    const width = Math.max(...separators.map(line => line.trimEnd().length - 1 - line.indexOf('+')));
    if (!Number.isFinite(width) || width < 4) return null;
    const fields = [];
    let groupFirstField = null;
    lines.forEach(line => {
        if (SEPARATOR.test(line)) { groupFirstField = null; return; }
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
            segments.push({ name: line.slice(pipes[i] + 1, textEnd).trim(), bits: Math.max(1, Math.round(chars * bitsPerRow / width)) });
        }
        const total = segments.reduce((sum, item) => sum + item.bits, 0);
        if (segments.length) segments[segments.length - 1].bits += bitsPerRow - total;
        // 同一分隔区内的空白续行：字段跨越多个 32 bit 字
        if (groupFirstField && segments.every(item => !item.name || item.name === '...' || item.name === '…')) {
            if (segments.every(item => !item.name)) { groupFirstField.bits += bitsPerRow; return; }
        }
        segments.forEach((segment, index) => {
            const field = {
                name: segment.name === '...' || segment.name === '…' ? '…（可重复）' : (segment.name || '（保留）'),
                bits: segment.bits,
                desc: note && segments.length === 1 ? note : (segment.name === '0' ? '保留位，置 0。' : ''),
                color: FIELD_COLORS[fields.length % FIELD_COLORS.length]
            };
            fields.push(field);
            if (index === 0) groupFirstField = segments.length === 1 ? field : null;
        });
    });
    if (!fields.length) return null;
    return { bitsPerRow, fields };
}

export function rfcScene(text, title = '报文结构') {
    const parsed = parseRfcDiagram(text);
    if (!parsed) return null;
    const totalBits = parsed.fields.reduce((sum, field) => sum + field.bits, 0);
    return {
        id: 'rfc-diagram',
        title: `${title} · 3D 拆解`,
        subtitle: `从文中的 RFC 位图自动生成：每行 ${parsed.bitsPerRow} bit，共 ${Math.ceil(totalBits / 8)} 字节、${parsed.fields.length} 个字段。点击砖块查看字段长度。`,
        duration: 10,
        build(ctx) {
            const layer = { id: 'rfc', name: title, color: PALETTE.info, fields: parsed.fields };
            const { layerRecords, height } = buildBitLayers(ctx, [layer], { bitsPerRow: parsed.bitsPerRow, bitWidth: parsed.bitsPerRow <= 16 ? 0.75 : 0.19, showTitles: false });
            const records = layerRecords[0].records.filter(record => !record.id.endsWith('-title'));
            records.forEach((record, index) => { record.offset.set(record.offset.x * 2, record.offset.y, (index % 2 ? 0.6 : -0.6) + record.offset.z); });
            ctx.camera3([6, 3 - height * 0.3, 12], [0, -height * 0.4, 0]);
            ctx.setSteps([
                { at: 0, title: '逐字段装配', text: '按报文中出现的顺序依次落位，宽度与 bit 数成正比。' },
                { at: 0.6, title: '完整报文', text: '拖动“拆解”滑块可以把每个字段炸开，点击查看详情。' }
            ]);
            return {
                update(t) {
                    records.forEach((record, index) => {
                        const at = (index / records.length) * 0.55;
                        const k = ease(span(t, at, at + 0.08));
                        record.object.visible = k > 0.01;
                        record.anim.set(0, (1 - k) * 3, 0);
                    });
                }
            };
        }
    };
}

// ---------------- 知识星图 ----------------
export function knowledgeMapScene(catalog) {
    return {
        id: 'knowledge-map',
        title: '数通知识星图',
        subtitle: '领域是恒星、分类是行星、文章是卫星；连线表示知识关联。点击任意节点查看并跳转。',
        duration: 60,
        options: [{ id: 'path', label: '叠加', value: 'path', choices: [{ value: 'path', label: '学习路径' }, { value: 'relations', label: '知识关联' }, { value: 'none', label: '仅结构' }] }],
        build(ctx, options) {
            const { THREE, models } = ctx;
            const galaxy = new THREE.Group();
            ctx.add(galaxy);
            const palette = [0x3b82f6, 0xf97316, 0x22c55e, 0xa855f7, 0xeab308, 0x06b6d4];
            const articlePos = new Map();
            const articleObj = new Map();
            const domains = catalog.domains;
            domains.forEach((domain, domainIndex) => {
                const angle = domainIndex / Math.max(1, domains.length) * Math.PI * 2;
                const color = palette[domainIndex % palette.length];
                const star = new THREE.Mesh(new THREE.SphereGeometry(1.3, 32, 32), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }));
                star.position.set(Math.cos(angle) * 11, 0, Math.sin(angle) * 11);
                const tag = ctx.makeLabel(`${domain.icon || ''} ${domain.name}`, { size: 0.42, bold: true, border: `#${new THREE.Color(color).getHexString()}` });
                tag.position.y = 2.1;
                star.add(tag);
                galaxy.add(star);
                const domainArticles = catalog.articles.filter(article => catalog.categories.find(category => category.id === article.categoryId)?.domainId === domain.id);
                ctx.part(star, { id: `d-${domain.id}`, name: domain.name, desc: domain.description, rows: [['文章数', String(domainArticles.length)]], explode: [Math.cos(angle) * 4, 0, Math.sin(angle) * 4] });
                const categories = catalog.categories.filter(category => category.domainId === domain.id);
                categories.forEach((category, categoryIndex) => {
                    const a2 = angle + (categoryIndex - (categories.length - 1) / 2) * 0.55;
                    const planet = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.3 }));
                    const radius = 11 + 4.5 + (categoryIndex % 2) * 1.2;
                    planet.position.set(Math.cos(a2) * radius, (categoryIndex % 3 - 1) * 1.4, Math.sin(a2) * radius);
                    const ctag = ctx.makeLabel(category.name, { size: 0.28, border: `#${new THREE.Color(color).getHexString()}` });
                    ctag.position.y = 1;
                    planet.add(ctag);
                    galaxy.add(planet);
                    const articles = catalog.articles.filter(article => article.categoryId === category.id);
                    ctx.part(planet, { id: `c-${category.id}`, name: category.name, desc: category.description, rows: [['文章数', String(articles.length)]], explode: [Math.cos(a2) * 6, (categoryIndex % 3 - 1) * 1.5, Math.sin(a2) * 6] });
                    ctx.link(star, planet, { color, radius: 0.04, opacity: 0.5 });
                    articles.forEach((article, articleIndex) => {
                        const a3 = a2 + (articleIndex - (articles.length - 1) / 2) * 0.16;
                        const r3 = radius + 2.6 + (articleIndex % 2) * 0.9;
                        const moon = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + article.difficulty * 0.04, 1), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, emissive: color, emissiveIntensity: 0.6 }));
                        moon.position.set(Math.cos(a3) * r3, planet.position.y + (articleIndex % 3 - 1) * 0.8, Math.sin(a3) * r3);
                        galaxy.add(moon);
                        ctx.part(moon, {
                            id: `a-${article.id}`, name: article.title, desc: article.summary,
                            rows: [['难度', '★'.repeat(article.difficulty)], ['可视化', String(article.visuals.length)], ['阅读', `<a class="dk-link" href="#/a/${article.id}">打开文章 →</a>`]],
                            explode: [Math.cos(a3) * 7, (articleIndex % 3 - 1) * 1.2, Math.sin(a3) * 7]
                        });
                        ctx.link(planet, moon, { color, radius: 0.015, opacity: 0.35 });
                        articlePos.set(article.id, moon.position);
                        articleObj.set(article.id, moon);
                    });
                });
            });
            const traveller = ctx.packet({ color: PALETTE.warn, label: '', size: 0.3 });
            let pathIds = [];
            if (options.path === 'path') {
                pathIds = catalog.learningPath.flatMap(step => step.articles).filter(id => articleObj.has(id));
                for (let i = 0; i < pathIds.length - 1; i += 1) ctx.link(articleObj.get(pathIds[i]), articleObj.get(pathIds[i + 1]), { color: PALETTE.warn, radius: 0.03, arc: 1.5, opacity: 0.55 });
            } else if (options.path === 'relations') {
                const seen = new Set();
                catalog.articles.forEach(article => article.related.forEach(other => {
                    const key = [article.id, other].sort().join('|');
                    if (seen.has(key) || !articleObj.has(other)) return;
                    seen.add(key);
                    ctx.link(articleObj.get(article.id), articleObj.get(other), { color: 0x38bdf8, radius: 0.02, arc: 2.5, opacity: 0.4 });
                }));
            }
            ctx.setSteps(options.path === 'path' ? catalog.learningPath.map((step, index) => ({ at: index / catalog.learningPath.length, title: `学习路径 ${index + 1}：${step.title}`, text: step.articles.map(id => catalog.articles.find(article => article.id === id)?.title).filter(Boolean).join(' → ') })) : []);
            ctx.camera3([0, 24, 34], [0, 0, 0]);
            return {
                update(t) {
                    galaxy.rotation.y = t * Math.PI * 2 * 0.25;
                    if (pathIds.length > 1) {
                        const points = pathIds.map(id => ctx.posOf(articleObj.get(id)).add(new THREE.Vector3(0, 0.5, 0)));
                        traveller.set(t, v => pathPoint(points, v, 1.5));
                        const index = Math.min(pathIds.length - 1, Math.round(t * (pathIds.length - 1)));
                        traveller.relabel(catalog.articles.find(article => article.id === pathIds[index])?.title.slice(0, 18) || '');
                    } else {
                        traveller.hide();
                    }
                }
            };
        }
    };
}
