// 知识大纲 · 无限画布导图：知识库 → 一层目录（领域）→ 二层目录（分类）→ 笔记 → 知识点，从左到右由粗到细。
// 拖拽平移、滚轮/双指以光标为中心缩放；节点可折叠；笔记之间的关联与共享知识点画成关联线，悬停高亮。
const SVGNS = 'http://www.w3.org/2000/svg';
const VIEW_KEY = 'dk_mindmap_view';
const COLLAPSE_KEY = 'dk_mindmap_collapsed';
const DOMAIN_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#f59e0b', '#f472b6', '#60a5fa'];
const STATUS_COLORS = { covered: '#22c55e', partial: '#f59e0b', added: '#a78bfa' };
// 每一层的列位置与节点尺寸
const LEVELS = [
    { x: 0, w: 180, h: 56 },
    { x: 250, w: 196, h: 54 },
    { x: 516, w: 204, h: 40 },
    { x: 790, w: 256, h: 46 },
    { x: 1120, w: 300, h: 30 }
];
const GAP = 10;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 隐私模式 */ } }
};
// 按显示宽度截断：中文按 1、ASCII 按 0.55 计
function clip(text, max) {
    let width = 0;
    let out = '';
    for (const ch of String(text)) {
        width += ch.charCodeAt(0) > 255 ? 1 : 0.55;
        if (width > max) return `${out}…`;
        out += ch;
    }
    return out;
}

// 由目录和大纲组装导图树与关联线
export function buildMindTree(catalog) {
    const nodes = new Map();
    const add = (node, parent) => {
        node.children = [];
        node.parent = parent || null;
        node.depth = parent ? parent.depth + 1 : 0;
        nodes.set(node.id, node);
        if (parent) parent.children.push(node);
        return node;
    };
    const root = add({ id: 'root', kind: 'root', label: '数通协议知识库' });
    const domains = [...(catalog.domains || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const outline = catalog.outline || [];
    const articleNode = new Map();
    domains.forEach((domain, index) => {
        const color = DOMAIN_COLORS[index % DOMAIN_COLORS.length];
        const domainNode = add({ id: `d:${domain.id}`, kind: 'domain', label: domain.name, icon: domain.icon || '📚', color, ref: domain.id }, root);
        (catalog.categories || []).filter(cat => cat.domainId === domain.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).forEach(cat => {
            const catNode = add({ id: `c:${cat.id}`, kind: 'category', label: cat.name, color, ref: cat.id }, domainNode);
            (catalog.articles || []).filter(article => article.categoryId === cat.id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).forEach(article => {
                articleNode.set(article.id, add({ id: `a:${article.id}`, kind: 'article', label: article.shortTitle || article.title, title: article.title, color, ref: article.id, difficulty: article.difficulty, article }, catNode));
            });
        });
    });
    const links = [];
    const linkKey = new Set();
    const pushLink = (from, to, kind) => {
        if (!from || !to || from === to) return;
        const key = kind === 'related' ? [from.id, to.id].sort().join('|') : `${from.id}|${to.id}`;
        if (linkKey.has(key)) return;
        linkKey.add(key);
        links.push({ from, to, kind });
    };
    // 知识点挂到第一篇关联笔记；同时关联多篇笔记的，其余画共享关联线
    const points = outline.filter(node => node.parentId).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const chapterArticles = new Map();
    points.forEach(point => point.articles.forEach(id => {
        if (!articleNode.has(id)) return;
        const counts = chapterArticles.get(point.parentId) || new Map();
        counts.set(id, (counts.get(id) || 0) + 1);
        chapterArticles.set(point.parentId, counts);
    }));
    const orphans = new Map();
    points.forEach(point => {
        const linked = point.articles.filter(id => articleNode.has(id));
        let host = linked.length ? articleNode.get(linked[0]) : null;
        if (!host) {
            // 未关联笔记（多为 AI 补充）：挂到同章节知识点最多的那篇笔记；整章都没有笔记时归入领域下的“待补充”
            const counts = chapterArticles.get(point.parentId);
            const best = counts && [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            if (best) host = articleNode.get(best[0]);
        }
        if (!host) {
            const domainNode = nodes.get(`d:${point.domainId}`);
            if (!domainNode) return;
            if (!orphans.has(point.domainId)) {
                const color = domainNode.color;
                const cat = add({ id: `c:__extra-${point.domainId}`, kind: 'category', label: '待补充的知识点', color, virtual: true }, domainNode);
                orphans.set(point.domainId, add({ id: `a:__extra-${point.domainId}`, kind: 'article', label: 'AI 补充 · 笔记未覆盖', color, virtual: true }, cat));
            }
            host = orphans.get(point.domainId);
        }
        const node = add({ id: `p:${point.id}`, kind: 'point', label: point.title, status: point.status, note: point.note, ref: point.id,
            articleId: host.virtual ? null : host.ref }, host);
        linked.slice(1).forEach(id => pushLink(node, articleNode.get(id), 'shared'));
    });
    // 没有大纲知识点的笔记：用核心要点作为知识点
    articleNode.forEach(node => {
        if (node.children.length) return;
        (node.article.keyPoints || []).slice(0, 6).forEach((text, index) => add({ id: `k:${node.ref}:${index}`, kind: 'point', label: text, status: null, articleId: node.ref }, node));
    });
    articleNode.forEach(node => (node.article.related || []).forEach(id => pushLink(node, articleNode.get(id), 'related')));
    return { root, nodes, links };
}

export function mountMindMap(container, { catalog, statusLabels = {}, currentArticleId = null, focusNodeId = null, onOpen }) {
    const { root, nodes, links } = buildMindTree(catalog);
    // 首次打开只展开到笔记一层，知识点按需展开，避免整张图过高
    const savedCollapsed = store.get(COLLAPSE_KEY, null);
    const collapsed = new Set(savedCollapsed || [...nodes.values()].filter(node => node.kind === 'article' && node.children.length).map(node => node.id));
    const host = document.createElement('div');
    host.className = 'dk-mm';
    host.innerHTML = `
        <div class="dk-mm-toolbar">
            <div class="dk-mm-search"><input type="search" placeholder="在导图中查找知识点…" aria-label="在导图中查找"><span></span></div>
            <div class="dk-mm-group">
                <button type="button" data-mm="expand" title="展开到知识点">展开全部</button>
                <button type="button" data-mm="collapse" title="只看到笔记这一层">收起知识点</button>
                <button type="button" data-mm="links" class="is-on" title="显示/隐藏笔记之间的关联线">关联线</button>
            </div>
            <div class="dk-mm-group">
                <button type="button" data-mm="out" title="缩小">−</button><b class="dk-mm-zoom">100%</b><button type="button" data-mm="in" title="放大">＋</button>
                <button type="button" data-mm="fit" title="适应全图">⤢ 全图</button>
                ${currentArticleId ? '<button type="button" data-mm="current" title="定位到刚才阅读的笔记">◎ 当前笔记</button>' : ''}
            </div>
        </div>
        <svg class="dk-mm-svg" xmlns="${SVGNS}"><g class="dk-mm-view"><g class="dk-mm-links"></g><g class="dk-mm-edges"></g><g class="dk-mm-nodes"></g></g></svg>
        <div class="dk-mm-legend">${Object.entries(STATUS_COLORS).map(([key, color]) => `<span><i style="background:${color}"></i>${esc(statusLabels[key] || key)}</span>`).join('')}<span><i class="is-link"></i>笔记关联</span><span><i class="is-shared"></i>共享知识点</span>
            <span class="dk-mm-hint">拖拽 / 滚动平移 · 双指或 Ctrl+滚轮缩放 · 点 ⊕ 展开知识点</span></div>
        <div class="dk-mm-tip" hidden></div>`;
    container.replaceChildren(host);
    const svg = host.querySelector('svg');
    const view = host.querySelector('.dk-mm-view');
    const gLinks = host.querySelector('.dk-mm-links');
    const gEdges = host.querySelector('.dk-mm-edges');
    const gNodes = host.querySelector('.dk-mm-nodes');
    const tip = host.querySelector('.dk-mm-tip');
    const savedView = store.get(VIEW_KEY, null);
    let transform = savedView || { x: 40, y: 40, k: 0.8 };
    let showLinks = true;
    let visible = [];
    let bounds = { minY: 0, maxY: 0, maxX: 0 };

    // ---- 布局：子树高度自底向上，父节点垂直居中于子节点 ----
    function isOpen(node) { return node.children.length && !collapsed.has(node.id); }
    function measure(node) {
        const own = LEVELS[node.depth].h;
        if (!isOpen(node)) { node.span = own; return own; }
        const sum = node.children.reduce((total, child) => total + measure(child), 0) + GAP * (node.children.length - 1);
        node.span = Math.max(own, sum);
        return node.span;
    }
    function place(node, top) {
        const level = LEVELS[node.depth];
        node.x = level.x;
        node.w = level.w;
        node.h = level.h;
        node.cy = top + node.span / 2;
        visible.push(node);
        if (!isOpen(node)) return;
        const sum = node.children.reduce((total, child) => total + child.span, 0) + GAP * (node.children.length - 1);
        let y = node.cy - sum / 2;
        node.children.forEach(child => { place(child, y); y += child.span + GAP; });
    }
    function layout() {
        visible = [];
        measure(root);
        place(root, 0);
        bounds = { minY: Math.min(...visible.map(n => n.cy - n.h / 2)), maxY: Math.max(...visible.map(n => n.cy + n.h / 2)), maxX: Math.max(...visible.map(n => n.x + n.w)) };
    }

    const shown = node => visible.includes(node);
    const nearestShown = node => { let current = node; while (current && !shown(current)) current = current.parent; return current; };
    const curve = (x1, y1, x2, y2) => { const mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };

    function nodeMarkup(node) {
        const y = node.cy - node.h / 2;
        const count = node.children.length;
        const toggle = count ? `<g class="dk-mm-toggle" data-toggle="${esc(node.id)}" transform="translate(${node.w + 10},${node.h / 2})"><circle r="${collapsed.has(node.id) ? 11 : 9}"/><text dy="3.5">${collapsed.has(node.id) ? `+${count}` : '−'}</text></g>` : '';
        let body = '';
        if (node.kind === 'root') {
            body = `<rect class="dk-mm-box" width="${node.w}" height="${node.h}" rx="28"/><text class="dk-mm-root-text" x="${node.w / 2}" y="${node.h / 2 + 5}" text-anchor="middle">◈ ${esc(node.label)}</text>`;
        } else if (node.kind === 'domain') {
            body = `<rect class="dk-mm-box" width="${node.w}" height="${node.h}" rx="14" style="--c:${node.color}"/><rect class="dk-mm-bar" width="5" height="${node.h - 16}" x="0" y="8" rx="2.5" style="fill:${node.color}"/>
                <text class="dk-mm-domain-text" x="18" y="${node.h / 2 + 6}">${esc(node.icon)} ${esc(clip(node.label, 11))}</text>`;
        } else if (node.kind === 'category') {
            body = `<rect class="dk-mm-box${node.virtual ? ' is-virtual' : ''}" width="${node.w}" height="${node.h}" rx="10" style="--c:${node.color}"/><text class="dk-mm-cat-text" x="14" y="${node.h / 2 + 5}">${esc(clip(node.label, 13))}</text>`;
        } else if (node.kind === 'article') {
            const stars = node.difficulty ? `<text class="dk-mm-stars" x="${node.w - 12}" y="${node.h / 2 + 4}" text-anchor="end">${'★'.repeat(node.difficulty)}</text>` : '';
            body = `<rect class="dk-mm-box is-article${node.virtual ? ' is-virtual' : ''}${node.ref === currentArticleId ? ' is-current' : ''}" width="${node.w}" height="${node.h}" rx="12" style="--c:${node.color}"/>
                <circle cx="16" cy="${node.h / 2}" r="5" style="fill:${node.color}"/><text class="dk-mm-article-text" x="30" y="${node.h / 2 + 5}">${esc(clip(node.label, 12))}</text>${stars}`;
        } else {
            const color = STATUS_COLORS[node.status] || 'var(--mm-muted)';
            body = `<rect class="dk-mm-box is-point" width="${node.w}" height="${node.h}" rx="${node.h / 2}"/><circle cx="14" cy="${node.h / 2}" r="5" style="fill:${color}"/>
                <text class="dk-mm-point-text" x="26" y="${node.h / 2 + 4.5}">${esc(clip(node.label, 20))}</text>`;
        }
        return `<g class="dk-mm-node is-${node.kind}" data-node="${esc(node.id)}" transform="translate(${node.x},${y})">${body}${toggle}</g>`;
    }

    function draw() {
        layout();
        gEdges.innerHTML = visible.filter(node => node.parent).map(node => {
            const parent = node.parent;
            const color = node.color || parent.color || 'var(--mm-line)';
            return `<path class="dk-mm-edge" data-edge="${esc(node.id)}" d="${curve(parent.x + parent.w + (parent.children.length ? 0 : 0), parent.cy, node.x, node.cy)}" style="stroke:${color}"/>`;
        }).join('');
        gLinks.innerHTML = links.map((link, index) => {
            const a = nearestShown(link.from);
            const b = nearestShown(link.to);
            if (!a || !b || a === b || a.depth < 3 || b.depth < 3) return '';
            const x1 = a.x + a.w;
            const x2 = b.x + b.w;
            const bulge = Math.min(260, 40 + Math.abs(a.cy - b.cy) * 0.22);
            const right = Math.max(x1, x2) + bulge;
            return `<path class="dk-mm-link is-${link.kind}" data-link="${index}" d="M${x1},${a.cy} C${right},${a.cy} ${right},${b.cy} ${x2},${b.cy}"/>`;
        }).join('');
        gNodes.innerHTML = visible.map(nodeMarkup).join('');
        host.classList.toggle('is-links-off', !showLinks);
        applyTransform();
    }

    function applyTransform() {
        view.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.k})`);
        host.querySelector('.dk-mm-zoom').textContent = `${Math.round(transform.k * 100)}%`;
        host.classList.toggle('is-far', transform.k < 0.5);
        host.classList.toggle('is-very-far', transform.k < 0.3);
        clearTimeout(applyTransform.timer);
        applyTransform.timer = setTimeout(() => store.set(VIEW_KEY, transform), 300);
    }

    function zoomAt(factor, cx, cy) {
        const k = Math.min(2.5, Math.max(0.12, transform.k * factor));
        const ratio = k / transform.k;
        transform = { k, x: cx - (cx - transform.x) * ratio, y: cy - (cy - transform.y) * ratio };
        applyTransform();
    }

    function fit() {
        const rect = svg.getBoundingClientRect();
        const width = bounds.maxX + 60;
        const height = bounds.maxY - bounds.minY + 40;
        // 整图放得下就整体居中；太高时按宽度适配、顶部对齐，滚动浏览
        const whole = Math.min((rect.width - 60) / width, (rect.height - 120) / height);
        const k = Math.min(1.1, Math.max(0.2, whole >= 0.45 ? whole : Math.min(1, (rect.width - 60) / width)));
        const top = height * k < rect.height - 120 ? (rect.height - height * k) / 2 + 20 : 70;
        transform = { k, x: Math.max(20, (rect.width - width * k) / 2) + 20 * k, y: top - (bounds.minY - 20) * k };
        applyTransform();
    }

    function centerOn(node, k = Math.max(transform.k, 0.9)) {
        const rect = svg.getBoundingClientRect();
        transform = { k, x: rect.width / 2 - (node.x + node.w / 2) * k, y: rect.height / 2 - node.cy * k };
        applyTransform();
    }

    // 展开某节点的所有祖先，保证它可见
    function reveal(node) {
        let current = node.parent;
        while (current) { collapsed.delete(current.id); current = current.parent; }
    }

    function saveCollapsed() { store.set(COLLAPSE_KEY, [...collapsed]); }

    // ---- 悬停高亮：祖先链 + 子树 + 关联 ----
    function highlight(node) {
        host.classList.toggle('has-focus', Boolean(node));
        gNodes.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
        gEdges.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
        gLinks.querySelectorAll('.is-lit').forEach(el => el.classList.remove('is-lit'));
        if (!node) return;
        const lit = new Set();
        let current = node;
        while (current) { lit.add(current); current = current.parent; }
        const walk = item => { lit.add(item); if (isOpen(item)) item.children.forEach(walk); };
        walk(node);
        links.forEach((link, index) => {
            const a = nearestShown(link.from);
            const b = nearestShown(link.to);
            if (lit.has(link.from) || lit.has(link.to) || a === node || b === node) {
                if (a) lit.add(a);
                if (b) lit.add(b);
                gLinks.querySelector(`[data-link="${index}"]`)?.classList.add('is-lit');
            }
        });
        lit.forEach(item => {
            gNodes.querySelector(`[data-node="${CSS.escape(item.id)}"]`)?.classList.add('is-lit');
            gEdges.querySelector(`[data-edge="${CSS.escape(item.id)}"]`)?.classList.add('is-lit');
        });
    }

    function showTip(node, event) {
        if (!node || node.kind === 'root') { tip.hidden = true; return; }
        const rect = host.getBoundingClientRect();
        const status = node.status ? `<em style="color:${STATUS_COLORS[node.status]}">${esc(statusLabels[node.status] || '')}</em>` : '';
        const action = node.kind === 'article' && !node.virtual ? '点击打开笔记并播放讲解' : node.kind === 'point' && node.articleId ? '点击跳到笔记中的这一节' : node.children.length ? '点击展开 / 收起' : '';
        tip.innerHTML = `<strong>${esc(node.title || node.label)}</strong>${status}${node.note ? `<p>${esc(node.note)}</p>` : ''}${action ? `<span>${action}</span>` : ''}`;
        tip.hidden = false;
        const x = Math.min(event.clientX - rect.left + 14, rect.width - 300);
        tip.style.transform = `translate(${x}px, ${event.clientY - rect.top + 16}px)`;
    }

    // ---- 交互 ----
    let drag = null;
    let moved = false;
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        drag = { x: event.clientX, y: event.clientY, ox: transform.x, oy: transform.y, id: event.pointerId };
        moved = false;
    });
    svg.addEventListener('pointermove', event => {
        if (drag) {
            const dx = event.clientX - drag.x;
            const dy = event.clientY - drag.y;
            if (!moved && Math.hypot(dx, dy) > 4) { moved = true; svg.setPointerCapture(drag.id); host.classList.add('is-panning'); tip.hidden = true; }
            if (moved) { transform = { ...transform, x: drag.ox + dx, y: drag.oy + dy }; applyTransform(); }
            return;
        }
        const target = event.target.closest('[data-node]');
        const node = target && nodes.get(target.dataset.node);
        if (node !== highlight.current) { highlight.current = node; highlight(node); }
        showTip(node, event);
    });
    const endDrag = () => { drag = null; host.classList.remove('is-panning'); };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; if (!drag) { highlight.current = null; highlight(null); } });
    svg.addEventListener('wheel', event => {
        event.preventDefault();
        const rect = svg.getBoundingClientRect();
        // 触控板双指捏合（带 ctrlKey）或 Ctrl/⌘+滚轮缩放；普通滚动平移，Shift+滚轮横向平移
        if (event.ctrlKey || event.metaKey) {
            zoomAt(Math.exp(-event.deltaY * (event.ctrlKey && Math.abs(event.deltaY) < 50 ? 0.01 : 0.002)), event.clientX - rect.left, event.clientY - rect.top);
            return;
        }
        const dx = event.shiftKey ? event.deltaY : event.deltaX;
        const dy = event.shiftKey ? 0 : event.deltaY;
        transform = { ...transform, x: transform.x - dx, y: transform.y - dy };
        applyTransform();
    }, { passive: false });
    svg.addEventListener('click', event => {
        if (moved) return;
        const toggle = event.target.closest('[data-toggle]');
        const target = event.target.closest('[data-node]');
        const node = target && nodes.get(target.dataset.node);
        if (toggle || (node && (node.kind === 'domain' || node.kind === 'category' || (node.kind === 'article' && node.virtual)))) {
            const id = toggle ? toggle.dataset.toggle : node.id;
            if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
            saveCollapsed();
            draw();
            return;
        }
        if (!node) return;
        if (node.kind === 'root') { fit(); return; }
        if (node.kind === 'article') onOpen?.({ articleId: node.ref });
        if (node.kind === 'point' && node.articleId) onOpen?.({ articleId: node.articleId, focus: node.label });
    });

    // 搜索：高亮命中节点，回车依次定位
    const searchInput = host.querySelector('.dk-mm-search input');
    const searchCount = host.querySelector('.dk-mm-search span');
    let hits = [];
    let hitIndex = -1;
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        hits = query ? [...nodes.values()].filter(node => node.kind !== 'root' && `${node.label} ${node.title || ''}`.toLowerCase().includes(query)) : [];
        hitIndex = -1;
        searchCount.textContent = query ? `${hits.length} 个` : '';
        hits.forEach(reveal);
        if (hits.length) { saveCollapsed(); draw(); }
        gNodes.querySelectorAll('.is-hit').forEach(el => el.classList.remove('is-hit'));
        hits.forEach(node => gNodes.querySelector(`[data-node="${CSS.escape(node.id)}"]`)?.classList.add('is-hit'));
    });
    searchInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !hits.length) return;
        hitIndex = (hitIndex + 1) % hits.length;
        centerOn(hits[hitIndex], Math.max(transform.k, 1));
        searchCount.textContent = `${hitIndex + 1}/${hits.length}`;
    });

    host.querySelector('.dk-mm-toolbar').addEventListener('click', event => {
        const action = event.target.closest('[data-mm]')?.dataset.mm;
        const rect = svg.getBoundingClientRect();
        if (action === 'in') zoomAt(1.25, rect.width / 2, rect.height / 2);
        if (action === 'out') zoomAt(0.8, rect.width / 2, rect.height / 2);
        if (action === 'fit') fit();
        if (action === 'expand') { collapsed.clear(); saveCollapsed(); draw(); fit(); }
        if (action === 'collapse') { nodes.forEach(node => { if (node.kind === 'article' && node.children.length) collapsed.add(node.id); }); saveCollapsed(); draw(); fit(); }
        if (action === 'links') { showLinks = !showLinks; event.target.classList.toggle('is-on', showLinks); host.classList.toggle('is-links-off', !showLinks); }
        if (action === 'current') { const node = nodes.get(`a:${currentArticleId}`); if (node) { reveal(node); saveCollapsed(); draw(); centerOn(node, 1); } }
    });

    draw();
    const focus = focusNodeId && (nodes.get(`p:${focusNodeId}`) || nodes.get(`a:${focusNodeId}`));
    requestAnimationFrame(() => {
        if (focus) { reveal(focus); draw(); centerOn(focus, 1); highlight(focus); }
        else if (!savedView) setTimeout(fit, 30);
    });
    const onResize = () => applyTransform();
    window.addEventListener('resize', onResize);
    return { dispose() { window.removeEventListener('resize', onResize); host.remove(); } };
}
