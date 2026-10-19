import { esc, svg, node, edge } from './diagram-kit.js';
// 先按结构定位，再展开一跳关联；所有文章可检索，不用密集星点代替信息。
export function mountKnowledgeMap(container, catalog) {
    const root = document.createElement('section');
    root.className = 'dk-knowledge-map';
    container.replaceChildren(root);
    let domain = '',
        category = '',
        query = '',
        selected = null,
        mode = 'structure';
    const articles = catalog.articles || [],
        categories = catalog.categories || [],
        domains = catalog.domains || [];
    const get = (id) => articles.find((a) => a.id === id);
    root.innerHTML = `<header class="dk-map-head"><span class="dk-eyebrow">KNOWLEDGE ATLAS / 知识星图</span><h2>先看全局，再连接知识</h2><p>领域 → 主题 → 文章。选择文章后，展开它的直接关联；学习路径单独呈现，避免把关联误当成先修关系。</p><div class="dk-map-modes"><button type="button" data-mode="structure" aria-pressed="true">知识结构</button><button type="button" data-mode="path" aria-pressed="false">学习路径</button></div></header><div class="dk-map-body"><aside class="dk-map-filters"><label>在星图中查找<input type="search" class="dk-input" placeholder="标题、标签、摘要" data-map-search></label><div data-domains></div><div data-categories></div></aside><div class="dk-map-content"><div class="dk-map-count" aria-live="polite"></div><div data-map-list></div><div data-map-detail></div></div></div>`;
    const q = (s) => root.querySelector(s);
    const href = (a) => `#/a/${encodeURIComponent(a.id)}`;
    function render() {
        q('[data-domains]').innerHTML =
            `<button data-domain="" aria-pressed="${!domain}"><span>全部领域</span><b>${articles.length}</b></button>` +
            domains
                .map(
                    (d) =>
                        `<button data-domain="${esc(d.id)}" aria-pressed="${domain === d.id}"><span>${esc(d.name)}</span><b>${articles.filter((a) => categories.some((c) => c.id === a.categoryId && c.domainId === d.id)).length}</b></button>`,
                )
                .join('');
        q('[data-categories]').innerHTML =
            `<span class="dk-eyebrow">主题筛选</span><button data-category="" aria-pressed="${!category}">全部主题</button>` +
            categories
                .filter((c) => !domain || c.domainId === domain)
                .map(
                    (c) =>
                        `<button data-category="${esc(c.id)}" aria-pressed="${category === c.id}">${esc(c.name)}</button>`,
                )
                .join('');
        const visible = articles.filter(
            (a) =>
                (!domain || categories.some((c) => c.id === a.categoryId && c.domainId === domain)) &&
                (!category || a.categoryId === category) &&
                (!query || [a.title, a.summary, ...(a.tags || [])].join(' ').toLowerCase().includes(query)),
        );
        q('.dk-map-count').textContent =
            `${visible.length} / ${articles.length} 篇文章 · ${mode === 'path' ? '按推荐顺序学习' : '选择卡片展开关联'}`;
        if (mode === 'path')
            q('[data-map-list]').innerHTML =
                (catalog.learningPath || [])
                    .map((s, i) => {
                        const items = (s.articles || []).map(get).filter((a) => a && visible.includes(a));
                        return items.length
                            ? `<section class="dk-map-path"><b>${String(i + 1).padStart(2, '0')}</b><div><h3>${esc(s.title)}</h3>${items.map((a) => `<button data-article="${esc(a.id)}">${esc(a.shortTitle || a.title)} <span>→</span></button>`).join('')}</div></section>`
                            : '';
                    })
                    .join('') || '<p class="dk-empty">当前筛选下没有学习路径条目。</p>';
        else
            q('[data-map-list]').innerHTML =
                categories
                    .filter((c) => visible.some((a) => a.categoryId === c.id))
                    .map(
                        (c) =>
                            `<section class="dk-map-cluster"><header><span>${esc(domains.find((d) => d.id === c.domainId)?.name || '')}</span><h3>${esc(c.name)}</h3></header><div>${visible
                                .filter((a) => a.categoryId === c.id)
                                .map(
                                    (a) =>
                                        `<button class="dk-map-article" data-article="${esc(a.id)}" aria-pressed="${selected === a.id}"><strong>${esc(a.shortTitle || a.title)}</strong><p>${esc(a.summary || '打开文章阅读详细内容。')}</p><small>${(a.related || []).filter(get).length} 个关联 · ${(a.visuals || []).length} 个实验</small></button>`,
                                )
                                .join('')}</div></section>`,
                    )
                    .join('') || '<p class="dk-empty">没有匹配的文章，请调整关键词或筛选。</p>';
        renderDetail();
    }
    function renderDetail() {
        const a = get(selected);
        if (!a) {
            q('[data-map-detail]').innerHTML = '';
            return;
        }
        const outgoing = [...new Set(a.related || [])]
                .map(get)
                .filter(Boolean)
                .filter((b) => b.id !== a.id),
            incoming = articles.filter((b) => b.id !== a.id && (b.related || []).includes(a.id));
        const height = Math.max(220, 90 * Math.max(outgoing.length, incoming.length) + 80);
        let drawing = '';
        incoming.forEach((b, i) => {
            drawing +=
                edge(`in${i}`, 240, 80 + i * 90, 360, height / 2, '', 'done') +
                node(b.id, 150, 80 + i * 90, short(b.shortTitle || b.title), '指向当前文章', '', 180);
        });
        outgoing.forEach((b, i) => {
            drawing +=
                edge(`out${i}`, 520, height / 2, 640, 80 + i * 90, '', 'done') +
                node(b.id, 730, 80 + i * 90, short(b.shortTitle || b.title), '当前文章的关联', '', 180);
        });
        drawing += node(a.id, 440, height / 2, short(a.shortTitle || a.title), '当前文章', 'active', 160);
        q('[data-map-detail]').innerHTML =
            `<section class="dk-map-detail"><div class="dk-map-detail-head"><div><span class="dk-eyebrow">一跳知识关联</span><h3>${esc(a.title)}</h3></div><button class="dk-btn ghost" data-clear>收起</button></div><p>${esc(a.summary)}</p><a class="dk-btn" href="${href(a)}">阅读这篇文章 →</a><div class="dk-diagram-scroll" tabindex="0" aria-label="文章关联图">${svg(drawing, '左侧文章引用当前文章；右侧是当前文章的关联', height)}</div><p class="dk-mini-note">箭头表示知识库中的文章关联，不表示协议数据流或强制学习顺序。完整标题见下方链接。</p><div class="dk-map-relations"><div><b>哪些文章关联它</b>${incoming.map((b) => `<a href="${href(b)}">${esc(b.title)}</a>`).join('') || '<p>暂无入向关联</p>'}</div><div><b>它关联哪些文章</b>${outgoing.map((b) => `<a href="${href(b)}">${esc(b.title)}</a>`).join('') || '<p>暂无出向关联</p>'}</div></div></section>`;
    }
    function short(s) {
        return s.length > 13 ? s.slice(0, 12) + '…' : s;
    }
    root.addEventListener('input', (e) => {
        if (e.target.matches('[data-map-search]')) {
            query = e.target.value.trim().toLowerCase();
            render();
        }
    });
    root.addEventListener('click', (e) => {
        const d = e.target.closest('[data-domain]'),
            c = e.target.closest('[data-category]'),
            a = e.target.closest('[data-article]'),
            m = e.target.closest('[data-mode]'),
            p = e.target.closest('[data-part]');
        if (d) {
            domain = d.dataset.domain;
            category = '';
            selected = null;
            render();
        }
        if (c) {
            category = c.dataset.category;
            selected = null;
            render();
        }
        if (m) {
            mode = m.dataset.mode;
            root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b === m));
            render();
        }
        if (a || p) {
            selected = (a || p).dataset.article || (a || p).dataset.part;
            render();
            q('[data-map-detail]').scrollIntoView({ behavior: 'instant', block: 'start' });
        }
        if (e.target.closest('[data-clear]')) {
            selected = null;
            render();
        }
    });
    root.addEventListener('keydown', (e) => {
        if (e.target.matches('[data-part]') && ['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            selected = e.target.dataset.part;
            render();
        }
    });
    render();
    return {
        dispose() {
            root.remove();
        },
    };
}
