import { translate } from './i18n.js';
// 「笔记问答」复习页：把 AI 问答与笔记按笔记分组放大呈现，支持检索筛选、展开全文和翻牌复习。
// 这里展示时右侧 AI 侧栏会被收起（见 ai-notes.js setSuspended），同一份内容不会同时出现在两处。
const VIEW_KEY = 'dk_review_view';
const KNOWN_KEY = 'dk_review_known';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 隐私模式 */ } }
};
const squash = value => String(value || '').replace(/\s+/g, ' ').trim();
const VISUAL_GROUP = '__visual';

// 按目录顺序分组：每篇笔记一组，未关联文章的（实验室、教学图）归入一组
export function groupAnnotations(list, catalog) {
    const order = new Map((catalog.articles || []).map((article, index) => [article.id, index]));
    const groups = new Map();
    list.forEach(item => {
        const key = item.articleId && order.has(item.articleId) ? item.articleId : VISUAL_GROUP;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
    });
    return [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9)).map(([key, items]) => ({ key, items }));
}

// 侧栏紧凑索引：领域 → 笔记，带问答/笔记数量
export function sidebarIndexHtml({ list, catalog, activeKey, loading }) {
    if (loading) return '<div class="dk-nav-empty">正在加载问答与笔记…</div>';
    if (!list.length) return '<div class="dk-review-nav-empty">还没有问答或笔记。<br>阅读时选中文字，点 <b>✦ 问 AI</b> 或 <b>📝 记笔记</b>，就会出现在这里。</div>';
    const groups = groupAnnotations(list, catalog);
    const articleById = new Map(catalog.articles.map(article => [article.id, article]));
    const domainOf = id => { const cat = catalog.categories.find(item => item.id === articleById.get(id)?.categoryId); return catalog.domains.find(item => item.id === cat?.domainId); };
    const byDomain = new Map();
    groups.forEach(group => {
        const domain = group.key === VISUAL_GROUP ? { id: VISUAL_GROUP, name: '图解与实验室', icon: '🧊' } : domainOf(group.key) || { id: 'other', name: '其他', icon: '📚' };
        if (!byDomain.has(domain.id)) byDomain.set(domain.id, { domain, groups: [] });
        byDomain.get(domain.id).groups.push(group);
    });
    const count = (items, kind) => items.filter(item => item.kind === kind).length;
    return `<a class="dk-review-nav-all${!activeKey ? ' is-active' : ''}" href="#/notes"><span>全部问答与笔记</span><em>${list.length}</em></a>` + [...byDomain.values()].map(({ domain, groups: items }) => `
        <div class="dk-review-nav-domain"><div class="dk-nav-cat-name"><span>${esc(domain.icon || '')} ${esc(domain.name)}</span><em>${items.reduce((sum, group) => sum + group.items.length, 0)}</em></div>
        ${items.map(group => {
            const article = articleById.get(group.key);
            const label = article ? (article.shortTitle || article.title) : '图解与实验室';
            const qa = count(group.items, 'qa');
            const note = count(group.items, 'note');
            return `<a class="dk-nav-link dk-review-nav-link${activeKey === group.key ? ' is-active' : ''}" href="#/notes/${encodeURIComponent(group.key)}" title="${esc(article?.title || label)}"><span>${esc(label)}</span><i class="dk-review-counts">${qa ? `<b class="is-qa">✦${qa}</b>` : ''}${note ? `<b class="is-note">📝${note}</b>` : ''}${group.items.length - qa - note ? `<b class="is-rewrite">✎${group.items.length - qa - note}</b>` : ''}</i></a>`;
        }).join('')}</div>`).join('');
}

export function mountNotesReview(container, { notes, catalog, focusKey = null, toast }) {
    const ui = { list: [], kind: 'all', scope: 'all', query: '', view: store.get(VIEW_KEY, 'cards'), expanded: new Set(), deck: [], index: 0, flipped: false, editing: null };
    const known = new Set(store.get(KNOWN_KEY, []));
    const articleById = new Map(catalog.articles.map(article => [article.id, article]));
    const root = document.createElement('div');
    root.className = 'dk-review';
    container.replaceChildren(root);
    let disposed = false;

    const me = () => notes.user().name;
    const question = item => item.turns[0]?.q || (item.kind === 'note' ? `关于「${squash(item.quote).slice(0, 40) || item.title}」的笔记` : item.title);
    const answer = item => String(item.turns.at(-1)?.a || '').split('<<<META>>>')[0];
    function filtered() {
        const query = ui.query.toLowerCase();
        return ui.list.filter(item => (ui.kind === 'all' || item.kind === ui.kind)
            && (ui.scope === 'all' || item.createdBy === me())
            && (!query || translate(`${item.title} ${item.brief} ${item.quote} ${item.turns.map(turn => `${turn.q || ''} ${turn.a || ''}`).join(' ')}`).toLowerCase().includes(query)));
    }

    function cardHtml(item) {
        const open = ui.expanded.has(item.id);
        const canEdit = notes.user().admin || item.createdBy === me();
        const kind = notes.KIND[item.kind] || {};
        const head = `<button type="button" class="dk-review-card-head" data-open="${item.id}">
                <span class="dk-review-kind is-${item.kind}">${kind.icon || ''} ${esc(kind.label || '')}</span>
                <strong>${esc(item.title)}</strong><p>${esc(item.brief)}</p>
                <div class="dk-review-quote">${esc(notes.anchorLabel(item))}</div>
                <small>${esc(item.createdBy || '匿名')} · ${esc(notes.ago(item.updatedAt))}${item.turns.length > 1 ? ` · ${item.turns.length} 轮对话` : ''}${known.has(item.id) ? ' · <b class="dk-review-known">已掌握</b>' : ''}</small></button>`;
        if (!open) return `<article class="dk-review-card is-${item.kind}" data-card="${item.id}">${head}</article>`;
        const body = ui.editing === item.id
            ? `<form class="dk-review-edit" data-edit-form="${item.id}"><label class="dk-field"><span>标题</span><input class="dk-input" name="title" maxlength="40" value="${esc(item.title)}"></label>
                <label class="dk-field"><span>内容（Markdown）</span><textarea class="dk-input" name="content" rows="12">${esc(answer(item))}</textarea></label>
                <div class="dk-review-actions"><button type="button" class="dk-btn small ghost" data-cancel-edit>取消</button><button class="dk-btn small">保存</button></div></form>`
            : `<div class="dk-review-thread">${item.turns.map((turn, index) => `<div class="dk-review-turn">${turn.q ? `<div class="dk-review-q"><b>${index ? '追问' : '问'}</b>${esc(turn.q)}</div>` : ''}${turn.before ? `<div class="dk-review-diff"><b>原文</b><del>${esc(turn.before)}</del></div>` : ''}<div class="dk-markdown dk-review-a" data-turn="${index}"></div></div>`).join('')}</div>
                <div class="dk-review-actions"><button type="button" class="dk-btn small ghost" data-jump="${item.id}">📍 定位原文</button>${item.kind !== 'rewrite' ? `<button type="button" class="dk-btn small ghost" data-follow="${item.id}">💬 追问</button>` : ''}
                    <button type="button" class="dk-btn small ghost" data-known="${item.id}">${known.has(item.id) ? '↺ 标记为未掌握' : '✓ 已掌握'}</button>
                    ${canEdit ? `<span></span><button type="button" class="dk-btn small ghost" data-edit="${item.id}">✏️ 编辑</button><button type="button" class="dk-btn small ghost danger" data-remove="${item.id}">🗑 删除</button>` : ''}</div>`;
        return `<article class="dk-review-card is-${item.kind} is-open" data-card="${item.id}">${head}${body}</article>`;
    }

    function cardsHtml(list) {
        if (!list.length) return `<div class="dk-review-empty">${ui.list.length ? '没有符合条件的问答或笔记' : '还没有任何问答或笔记。<br>阅读笔记时选中一段文字，点 <b>✦ 问 AI</b> 或 <b>📝 记笔记</b>，内容会自动汇总到这里。'}</div>`;
        return groupAnnotations(list, catalog).map(group => {
            const article = articleById.get(group.key);
            const title = article ? article.title : '图解与实验室';
            const link = article ? `<a class="dk-btn small ghost" href="#/a/${encodeURIComponent(article.id)}">打开笔记 →</a>` : '';
            return `<section class="dk-review-group" id="review-${esc(group.key)}"><header><h2>${esc(title)}</h2><span class="dk-mini-note">${group.items.length} 条</span>${link}</header>
                <div class="dk-review-grid">${group.items.map(cardHtml).join('')}</div></section>`;
        }).join('');
    }

    function deckHtml(list) {
        if (!list.length) return '<div class="dk-review-empty">没有可复习的卡片</div>';
        if (ui.index >= list.length) ui.index = 0;
        const item = list[ui.index];
        const article = articleById.get(item.articleId);
        const done = list.filter(entry => known.has(entry.id)).length;
        return `<div class="dk-flash-wrap">
            <div class="dk-flash-progress"><span>${ui.index + 1} / ${list.length}</span><div><i style="width:${(done / list.length) * 100}%"></i></div><span>已掌握 ${done}</span></div>
            <div class="dk-flash-card${ui.flipped ? ' is-flipped' : ''}" data-flip tabindex="0" role="button" aria-label="翻面">
                <div class="dk-flash-face is-front"><span class="dk-review-kind is-${item.kind}">${notes.KIND[item.kind]?.icon || ''} ${esc(notes.KIND[item.kind]?.label || '')}</span>
                    <div class="dk-flash-source">${esc(article ? article.shortTitle || article.title : '图解与实验室')} · ${esc(notes.anchorLabel(item))}</div>
                    <h2>${esc(question(item))}</h2><p class="dk-mini-note">先自己想一想，再点卡片看答案（空格键翻面）</p></div>
                <div class="dk-flash-face is-back"><h3>${esc(item.title)}</h3><div class="dk-markdown dk-flash-answer"></div></div>
            </div>
            <div class="dk-flash-controls"><button type="button" class="dk-btn ghost" data-deck="prev">← 上一张</button>
                <button type="button" class="dk-btn ghost" data-deck="again">再看看</button><button type="button" class="dk-btn" data-deck="known">✓ 记住了</button>
                <button type="button" class="dk-btn ghost" data-deck="next">下一张 →</button><button type="button" class="dk-btn ghost" data-deck="shuffle" title="打乱顺序">🔀</button>
                <button type="button" class="dk-btn ghost" data-jump="${item.id}">📍 原文</button></div></div>`;
    }

    function render() {
        if (disposed) return;
        const list = filtered();
        const count = kind => ui.list.filter(item => item.kind === kind).length;
        const articles = new Set(ui.list.map(item => item.articleId).filter(Boolean)).size;
        if (ui.view === 'deck') ui.deck = ui.deck.length && ui.deck.every(item => list.includes(item)) && ui.deck.length === list.length ? ui.deck : list.filter(item => !known.has(item.id)).concat(list.filter(item => known.has(item.id)));
        root.innerHTML = `<header class="dk-review-head"><div><div class="dk-hud-kicker">REVIEW</div><h1>💬 笔记问答</h1><p>阅读时向 AI 提的问题和记下的笔记都汇总在这里，按笔记分组，适合复习和查漏补缺。</p></div>
            <div class="dk-outline-stats"><span><b>${ui.list.length}</b>全部</span><span><b>${count('qa')}</b>问答</span><span><b>${count('note')}</b>笔记</span><span><b>${articles}</b>篇笔记</span></div></header>
            <div class="dk-review-toolbar">
                <label class="dk-review-search"><span>⌕</span><input type="search" placeholder="搜索问题、答案或原文" value="${esc(ui.query)}" data-query></label>
                <div class="dk-seg-pill">${[['all', '全部'], ...Object.entries(notes.KIND).map(([key, info]) => [key, `${info.icon} ${info.label}`])].map(([key, label]) => `<button type="button" class="${ui.kind === key ? 'is-active' : ''}" data-kind="${key}">${label}</button>`).join('')}</div>
                <div class="dk-seg-pill">${[['all', '所有人'], ['mine', '我的']].map(([key, label]) => `<button type="button" class="${ui.scope === key ? 'is-active' : ''}" data-scope="${key}">${label}</button>`).join('')}</div>
                <div class="dk-seg-pill dk-review-view">${[['cards', '▦ 卡片'], ['deck', '🃏 复习模式']].map(([key, label]) => `<button type="button" class="${ui.view === key ? 'is-active' : ''}" data-view="${key}">${label}</button>`).join('')}</div>
            </div>
            <div class="dk-review-body">${ui.view === 'deck' ? deckHtml(ui.deck) : cardsHtml(list)}</div>`;
        root.querySelectorAll('.dk-review-a').forEach(node => {
            const item = ui.list.find(entry => entry.id === node.closest('[data-card]').dataset.card);
            notes.renderMd(node, item.turns[Number(node.dataset.turn)].a);
        });
        const answerNode = root.querySelector('.dk-flash-answer');
        if (answerNode && ui.deck[ui.index]) notes.renderMd(answerNode, answer(ui.deck[ui.index]));
    }

    async function load() {
        root.innerHTML = '<div class="dk-loading">正在加载问答与笔记…</div>';
        try { ui.list = await notes.loadAll(); } catch (error) { root.innerHTML = `<div class="dk-empty">${esc(error.message)}</div>`; return; }
        render();
        if (focusKey) requestAnimationFrame(() => document.getElementById(`review-${focusKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }

    function step(delta) { ui.index = (ui.index + delta + ui.deck.length) % Math.max(1, ui.deck.length); ui.flipped = false; render(); }
    function markKnown(id, value) { if (value) known.add(id); else known.delete(id); store.set(KNOWN_KEY, [...known]); }

    root.addEventListener('click', async event => {
        const target = event.target;
        const kind = target.closest('[data-kind]')?.dataset.kind;
        if (kind) { ui.kind = kind; ui.deck = []; return render(); }
        const scope = target.closest('[data-scope]')?.dataset.scope;
        if (scope) { ui.scope = scope; ui.deck = []; return render(); }
        const view = target.closest('[data-view]')?.dataset.view;
        if (view) { ui.view = view; ui.deck = []; ui.index = 0; ui.flipped = false; store.set(VIEW_KEY, view); return render(); }
        const jump = target.closest('[data-jump]')?.dataset.jump;
        if (jump) return notes.jumpTo(jump);
        const follow = target.closest('[data-follow]')?.dataset.follow;
        if (follow) return notes.followUp(follow);
        const knownId = target.closest('[data-known]')?.dataset.known;
        if (knownId) { markKnown(knownId, !known.has(knownId)); return render(); }
        const edit = target.closest('[data-edit]')?.dataset.edit;
        if (edit) { ui.editing = edit; return render(); }
        if (target.closest('[data-cancel-edit]')) { ui.editing = null; return render(); }
        const remove = target.closest('[data-remove]')?.dataset.remove;
        if (remove) {
            if (!confirm('确定删除这条问答/笔记吗？')) return;
            try { await notes.remove(remove); ui.list = ui.list.filter(item => item.id !== remove); render(); } catch (error) { toast(error.message, 'bad'); }
            return;
        }
        const deck = target.closest('[data-deck]')?.dataset.deck;
        if (deck) {
            const current = ui.deck[ui.index];
            if (deck === 'prev') step(-1);
            if (deck === 'next') step(1);
            if (deck === 'known' && current) { markKnown(current.id, true); step(1); }
            if (deck === 'again' && current) { markKnown(current.id, false); step(1); }
            if (deck === 'shuffle') { ui.deck = [...ui.deck].sort(() => Math.random() - 0.5); ui.index = 0; ui.flipped = false; render(); }
            return;
        }
        if (target.closest('[data-flip]') && !target.closest('a, button')) { ui.flipped = !ui.flipped; root.querySelector('.dk-flash-card')?.classList.toggle('is-flipped', ui.flipped); return; }
        const open = target.closest('[data-open]')?.dataset.open;
        if (open) {
            if (ui.expanded.has(open)) ui.expanded.delete(open); else ui.expanded.add(open);
            ui.editing = null;
            render();
            if (ui.expanded.has(open)) root.querySelector(`[data-card="${open}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
    root.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.target.closest('[data-edit-form]');
        if (!form) return;
        try {
            const annotation = await notes.update(form.dataset.editForm, { title: form.title.value, content: form.content.value });
            ui.list = ui.list.map(item => (item.id === annotation.id ? annotation : item));
            ui.editing = null;
            render();
            toast('已保存', 'ok');
        } catch (error) { toast(error.message, 'bad'); }
    });
    let typing = null;
    root.addEventListener('input', event => {
        if (!event.target.matches('[data-query]')) return;
        clearTimeout(typing);
        typing = setTimeout(() => {
            ui.query = event.target.value;
            ui.deck = [];
            const caret = event.target.selectionStart;
            render();
            const input = root.querySelector('[data-query]');
            input.focus();
            input.setSelectionRange(caret, caret);
        }, 160);
    });
    const onKey = event => {
        if (ui.view !== 'deck' || event.target.closest('input, textarea')) return;
        if (event.key === ' ') { event.preventDefault(); ui.flipped = !ui.flipped; root.querySelector('.dk-flash-card')?.classList.toggle('is-flipped', ui.flipped); }
        if (event.key === 'ArrowRight') step(1);
        if (event.key === 'ArrowLeft') step(-1);
    };
    document.addEventListener('keydown', onKey);
    // 追问、侧栏外的编辑等改动后刷新
    const onChanged = () => notes.loadAll().then(list => { ui.list = list; render(); }).catch(() => {});
    document.addEventListener('dk:annotations-changed', onChanged);
    load();
    return { dispose() { disposed = true; document.removeEventListener('keydown', onKey); document.removeEventListener('dk:annotations-changed', onChanged); } };
}
