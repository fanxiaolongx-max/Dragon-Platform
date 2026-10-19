// 数通协议专家：知识库阅读 + 3D 可视化拆解 + 管理员维护（数据存放在后端 datacom-knowledge.db）
import { createStage } from './engine3d.js';
import { ospfScenes } from './scenes-ospf.js';
import { junosScenes } from './scenes-junos.js';
import { rfcScene, knowledgeMapScene } from './scenes-misc.js';
import { labs } from './labs.js';
import { renderMarkdown, renderMermaid } from './markdown.js';

const API = '/api/datacom-knowledge';
const THEME_KEY = 'dk_theme';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const VISUALS = new Map();
[...ospfScenes, ...junosScenes].forEach(def => VISUALS.set(def.id, { id: def.id, kind: '3d', title: def.title, subtitle: def.subtitle, def }));
labs.forEach(lab => VISUALS.set(lab.id, { id: lab.id, kind: '2d', title: lab.title, subtitle: lab.subtitle, lab }));

const state = {
    catalog: null, canWrite: false, tenantId: undefined, username: '',
    articles: new Map(), mounted: [], route: null, sidebarOpen: false, collapsed: new Set()
};

const $ = selector => document.querySelector(selector);
const main = () => $('#main');

// ---------------- 通用 ----------------
function toast(message, type = 'info') {
    const host = $('#toast');
    const item = document.createElement('div');
    item.className = `dk-toast is-${type}`;
    item.textContent = message;
    host.appendChild(item);
    setTimeout(() => item.classList.add('is-out'), 2600);
    setTimeout(() => item.remove(), 3100);
}

async function api(path = '', { method = 'GET', body } = {}) {
    const response = await fetch(`${API}${path}`, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || (response.status === 401 ? '登录已失效，请在平台中重新登录' : `请求失败 (${response.status})`));
        error.status = response.status;
        error.code = data.code;
        throw error;
    }
    return data;
}

function unmountAll() {
    state.mounted.forEach(item => { try { item.dispose(); } catch (_) { /* 已释放 */ } });
    state.mounted = [];
}

function mountVisual(container, id, { compact = false } = {}) {
    const visual = VISUALS.get(id);
    container.innerHTML = '';
    if (!visual) {
        container.innerHTML = '<div class="dk-empty">该可视化尚未实现</div>';
        return null;
    }
    try {
        const handle = visual.kind === '3d' ? createStage(container, visual.def, { compact }) : visual.lab.mount(container);
        state.mounted.push(handle);
        return handle;
    } catch (error) {
        console.error(error);
        container.innerHTML = `<div class="dk-empty">可视化加载失败：${esc(error.message)}（浏览器可能不支持 WebGL）</div>`;
        return null;
    }
}

const category = id => state.catalog.categories.find(item => item.id === id);
const domain = id => state.catalog.domains.find(item => item.id === id);
const articleMeta = id => state.catalog.articles.find(item => item.id === id);
const stars = n => `<span class="dk-stars" title="难度 ${n}/5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
const visualBadge = visual => `<span class="dk-badge ${visual.kind === '3d' ? 'is-3d' : 'is-2d'}">${visual.kind === '3d' ? '3D' : '交互'}</span>`;

function findArticleByTitle(target) {
    const key = String(target).toLowerCase().replace(/\s+/g, '');
    if (!key) return null;
    return state.catalog.articles.find(item => item.id === target)
        || state.catalog.articles.find(item => item.title.toLowerCase().replace(/\s+/g, '').includes(key))
        || state.catalog.articles.find(item => item.tags.some(tag => tag.toLowerCase().replace(/\s+/g, '') === key))
        || null;
}

// ---------------- 主题 ----------------
function resolvedTheme() {
    const pref = localStorageGet(THEME_KEY) || 'dark';
    if (pref === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return pref;
}
function localStorageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* 隐私模式 */ } }
function applyTheme() {
    const pref = localStorageGet(THEME_KEY) || 'dark';
    document.documentElement.dataset.theme = resolvedTheme();
    const button = $('#themeBtn');
    if (button) button.textContent = { dark: '🌙 深色', light: '☀️ 浅色', system: '🌓 跟随系统' }[pref];
}

// ---------------- 侧边栏 ----------------
function renderSidebar() {
    const { catalog } = state;
    const route = state.route || {};
    const domains = catalog.domains.map(item => {
        const categories = catalog.categories.filter(cat => cat.domainId === item.id);
        const total = catalog.articles.filter(article => categories.some(cat => cat.id === article.categoryId)).length;
        const collapsed = state.collapsed.has(item.id);
        return `<section class="dk-nav-domain${collapsed ? ' is-collapsed' : ''}">
            <button class="dk-nav-domain-head" data-collapse="${item.id}"><span>${esc(item.icon || '📚')}</span><strong>${esc(item.name)}</strong><em>${total}</em></button>
            <div class="dk-nav-domain-body">${categories.map(cat => {
                const articles = catalog.articles.filter(article => article.categoryId === cat.id);
                return `<div class="dk-nav-cat"><div class="dk-nav-cat-name">${esc(cat.name)}</div>${articles.map(article => `<a class="dk-nav-link${route.name === 'article' && route.id === article.id ? ' is-active' : ''}" href="#/a/${article.id}" title="${esc(article.title)}"><span>${esc(article.title)}</span>${article.visuals.length ? `<i class="dk-nav-vis" title="含 ${article.visuals.length} 个可视化">◆</i>` : ''}</a>`).join('') || '<div class="dk-nav-empty">暂无文章</div>'}</div>`;
            }).join('')}</div></section>`;
    }).join('');
    const admin = state.canWrite ? `<div class="dk-nav-admin"><button class="dk-btn small" data-action="new-article">＋ 新建文章</button><button class="dk-btn small ghost" data-action="import">⇪ 导入 Markdown</button><button class="dk-btn small ghost" data-action="manage">🗂 管理分类</button></div>` : '';
    $('#sidebar').innerHTML = `<nav class="dk-nav-top">
            <a href="#/" class="${route.name === 'home' ? 'is-active' : ''}">🏠 总览</a>
            <a href="#/labs" class="${route.name === 'labs' || route.name === 'lab' ? 'is-active' : ''}">🧊 可视化实验室</a>
            <a href="#/map" class="${route.name === 'map' ? 'is-active' : ''}">🌌 知识星图</a>
        </nav>${admin}<div class="dk-nav-tree">${domains}</div>
        <div class="dk-nav-foot">数据库：${esc(state.databaseFile || 'datacom-knowledge.db')}</div>`;
}

// ---------------- 视图：总览 ----------------
function renderHome() {
    const { catalog } = state;
    const used = new Map();
    catalog.articles.forEach(article => article.visuals.forEach(id => used.set(id, (used.get(id) || 0) + 1)));
    const chars = catalog.articles.reduce((sum, article) => sum + (article.bodyLength || 0), 0);
    const hard = catalog.articles.filter(article => article.difficulty >= 4).sort((a, b) => b.difficulty - a.difficulty);
    main().innerHTML = `
        <section class="dk-hero">
            <div class="dk-hero-text">
                <div class="dk-hud-kicker">DATACOM PROTOCOL EXPERT</div>
                <h1>数通协议专家</h1>
                <p>把协议原理、报文字段与复杂流程拆成可旋转、可炸开、可拖动的 3D 模型。文字讲“为什么”，可视化让你看见“怎么动”。</p>
                <div class="dk-hero-actions"><a class="dk-btn" href="#/a/${catalog.learningPath[0]?.articles[0] || catalog.articles[0]?.id}">▶ 从学习路径开始</a><a class="dk-btn ghost" href="#/map">🌌 打开知识星图</a><a class="dk-btn ghost" href="#/labs">🧊 可视化实验室</a></div>
            </div>
            <div class="dk-hero-stats">
                <div><b>${catalog.articles.length}</b><span>篇知识文章</span></div>
                <div><b>${catalog.categories.length}</b><span>个主题分类</span></div>
                <div><b>${VISUALS.size}</b><span>个可视化实验</span></div>
                <div><b>${Math.round(chars / 1000)}k</b><span>字原文</span></div>
            </div>
        </section>
        <h2 class="dk-section-title">知识体系</h2>
        <div class="dk-domain-grid">${catalog.domains.map(item => {
            const cats = catalog.categories.filter(cat => cat.domainId === item.id);
            return `<article class="dk-domain-card"><header><span>${esc(item.icon)}</span><h3>${esc(item.name)}</h3></header><p>${esc(item.description)}</p><div class="dk-cat-list">${cats.map(cat => {
                const articles = catalog.articles.filter(article => article.categoryId === cat.id);
                return `<div class="dk-cat-row"><strong>${esc(cat.name)}</strong><div>${articles.map(article => `<a class="dk-pill" href="#/a/${article.id}">${esc(article.title.length > 22 ? `${article.title.slice(0, 22)}…` : article.title)}</a>`).join('')}</div></div>`;
            }).join('')}</div></article>`;
        }).join('')}</div>
        <h2 class="dk-section-title">推荐学习路径</h2>
        <ol class="dk-path">${catalog.learningPath.map((step, index) => `<li><div class="dk-path-index">${index + 1}</div><div><h4>${esc(step.title)}</h4><div class="dk-path-items">${step.articles.map(id => articleMeta(id)).filter(Boolean).map(article => `<a href="#/a/${article.id}">${esc(article.title)}</a>`).join('<span>→</span>')}</div></div></li>`).join('')}</ol>
        <h2 class="dk-section-title">复杂知识点 · 建议配合可视化阅读</h2>
        <div class="dk-hard-list">${hard.map(article => `<a class="dk-hard" href="#/a/${article.id}"><div>${stars(article.difficulty)}<strong>${esc(article.title)}</strong></div><p>${esc(article.summary)}</p><div class="dk-hard-vis">${article.visuals.map(id => VISUALS.get(id)).filter(Boolean).map(visual => `<span>${visualBadge(visual)}${esc(visual.title.split(' · ')[0])}</span>`).join('')}</div></a>`).join('')}</div>`;
}

function renderLabs() {
    const used = new Map();
    state.catalog.articles.forEach(article => article.visuals.forEach(id => used.set(id, (used.get(id) || 0) + 1)));
    main().innerHTML = `<header class="dk-page-head"><div class="dk-hud-kicker">VISUAL LAB</div><h1>可视化实验室</h1><p>3D 场景支持：组装 / 剖面 / 爆炸三种视图、爆炸程度滑块、点击部件高亮并显示引线标注、拖动时间轴逐帧回放。交互实验室可以动手计算。</p></header>
        <div class="dk-lab-grid">${[...VISUALS.values()].map(visual => `<a class="dk-lab-card ${visual.kind === '3d' ? 'is-3d' : ''}" href="#/lab/${visual.id}"><div class="dk-lab-card-top">${visualBadge(visual)}<span class="dk-mini-note">${used.get(visual.id) || 0} 篇文章引用</span></div><h3>${esc(visual.title)}</h3><p>${esc(visual.subtitle)}</p></a>`).join('')}</div>`;
}

function renderLab(id) {
    const visual = VISUALS.get(id);
    if (!visual) { main().innerHTML = '<div class="dk-empty">未找到该可视化</div>'; return; }
    const articles = state.catalog.articles.filter(article => article.visuals.includes(id));
    main().innerHTML = `<div class="dk-lab-page"><div class="dk-breadcrumb"><a href="#/labs">可视化实验室</a><span>/</span>${esc(visual.title)}</div>
        <div class="dk-stage-host is-tall" id="labHost"></div>
        <section class="dk-related"><h3>相关知识文章</h3><div class="dk-related-grid">${articles.map(article => `<a class="dk-related-card" href="#/a/${article.id}">${stars(article.difficulty)}<strong>${esc(article.title)}</strong><p>${esc(article.summary)}</p></a>`).join('') || '<div class="dk-mini-note">暂无文章关联该可视化，管理员可在文章编辑器中关联。</div>'}</div></section></div>`;
    mountVisual($('#labHost'), id);
}

function renderMap() {
    main().innerHTML = `<div class="dk-lab-page"><div class="dk-breadcrumb">🌌 知识星图 · 点击卫星节点即可跳转到文章</div><div class="dk-stage-host is-tall" id="mapHost"></div></div>`;
    const def = knowledgeMapScene(state.catalog);
    const handle = createStage($('#mapHost'), def, {});
    state.mounted.push(handle);
}

// ---------------- 视图：文章 ----------------
async function loadArticle(id) {
    if (!state.articles.has(id)) state.articles.set(id, (await api(`/articles/${encodeURIComponent(id)}`)).article);
    return state.articles.get(id);
}

async function renderArticle(id) {
    main().innerHTML = '<div class="dk-loading">正在加载文章…</div>';
    let article;
    try {
        article = await loadArticle(id);
    } catch (error) {
        main().innerHTML = `<div class="dk-empty">${esc(error.message)}</div>`;
        return;
    }
    if (state.route?.id !== id) return;
    const cat = category(article.categoryId);
    const dom = cat && domain(cat.domainId);
    const visuals = article.visuals.map(vid => VISUALS.get(vid)).filter(Boolean);
    const related = article.related.map(articleMeta).filter(Boolean);
    const list = state.catalog.articles.filter(item => item.categoryId === article.categoryId);
    const index = list.findIndex(item => item.id === article.id);
    main().innerHTML = `<div class="dk-article-layout">
        <article class="dk-article">
            <div class="dk-breadcrumb"><a href="#/">总览</a><span>/</span>${esc(dom?.name || '')}<span>/</span>${esc(cat?.name || '')}</div>
            <h1>${esc(article.title)}</h1>
            <div class="dk-meta">${stars(article.difficulty)}${article.tags.map(tag => `<span class="dk-tag">#${esc(tag)}</span>`).join('')}<span class="dk-mini-note">v${article.revision} · ${esc((article.updatedAt || '').slice(0, 10))}${article.updatedBy && article.updatedBy !== 'system' ? ` · ${esc(article.updatedBy)}` : ''}</span>
                ${state.canWrite ? '<button class="dk-btn small ghost" data-action="edit">✏️ 编辑</button><button class="dk-btn small ghost" data-action="history">🕘 历史</button>' : ''}</div>
            ${article.summary ? `<p class="dk-summary">${esc(article.summary)}</p>` : ''}
            ${article.keyPoints.length ? `<section class="dk-keypoints"><h2>核心要点</h2><ol>${article.keyPoints.map(point => `<li>${esc(point)}</li>`).join('')}</ol></section>` : ''}
            ${visuals.length ? `<section class="dk-visual-block"><div class="dk-visual-tabs">${visuals.map((visual, i) => `<button class="${i === 0 ? 'is-active' : ''}" data-visual="${visual.id}">${visualBadge(visual)}${esc(visual.title.split(' · ')[0])}</button>`).join('')}<a class="dk-btn small ghost" data-open-lab href="#/lab/${visuals[0].id}">⛶ 实验室全屏</a></div><div class="dk-stage-host" id="articleStage"></div></section>` : ''}
            <section class="dk-markdown" id="articleBody"></section>
            ${related.length ? `<section class="dk-related"><h3>关联知识</h3><div class="dk-related-grid">${related.map(item => `<a class="dk-related-card" href="#/a/${item.id}">${stars(item.difficulty)}<strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p></a>`).join('')}</div></section>` : ''}
            <nav class="dk-pager">${index > 0 ? `<a href="#/a/${list[index - 1].id}">← ${esc(list[index - 1].title)}</a>` : '<span></span>'}${index < list.length - 1 ? `<a href="#/a/${list[index + 1].id}">${esc(list[index + 1].title)} →</a>` : ''}</nav>
            ${article.source ? `<p class="dk-mini-note">来源：${esc(article.source)}</p>` : ''}
        </article>
        <aside class="dk-toc" id="articleToc"></aside></div>`;
    const { toc } = renderMarkdown($('#articleBody'), article.bodyMd, { findArticle: findArticleByTitle });
    $('#articleToc').innerHTML = toc.length ? `<div class="dk-toc-title">目录</div>${toc.map(item => `<a class="lvl-${item.level}" href="#${item.id}" data-toc="${item.id}">${esc(item.text)}</a>`).join('')}` : '';
    renderMermaid($('#articleBody'), resolvedTheme() === 'dark');
    if (visuals.length) mountVisual($('#articleStage'), visuals[0].id, { compact: true });
    main().scrollTop = 0;
    window.scrollTo(0, 0);
}

// ---------------- 搜索 ----------------
let searchTimer = null;
async function runSearch(query) {
    const box = $('#searchResults');
    if (!query.trim()) { box.hidden = true; return; }
    try {
        const { results } = await api(`/search?q=${encodeURIComponent(query)}`);
        box.hidden = false;
        box.innerHTML = results.length ? results.slice(0, 12).map(item => `<a href="#/a/${item.id}"><strong>${esc(item.title)}</strong><span>${esc(item.snippet)}</span></a>`).join('') : '<div class="dk-mini-note">没有找到相关内容</div>';
    } catch (error) {
        box.hidden = false;
        box.innerHTML = `<div class="dk-mini-note">${esc(error.message)}</div>`;
    }
}

// ---------------- 弹窗 ----------------
function openModal(title, bodyHtml, { wide = false } = {}) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="dk-modal-mask"><div class="dk-modal${wide ? ' is-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header><h3>${esc(title)}</h3><button class="dk-icon-btn" data-close aria-label="关闭">×</button></header><div class="dk-modal-body">${bodyHtml}</div></div></div>`;
    root.hidden = false;
    const close = () => {
        root.querySelectorAll('[data-modal-stage]').forEach(() => {});
        modalDisposers.forEach(fn => fn());
        modalDisposers = [];
        root.hidden = true;
        root.innerHTML = '';
    };
    root.querySelector('[data-close]').addEventListener('click', close);
    root.querySelector('.dk-modal-mask').addEventListener('click', event => { if (event.target.classList.contains('dk-modal-mask')) close(); });
    return { root: root.querySelector('.dk-modal'), close };
}
let modalDisposers = [];

function categoryOptions(selected) {
    return state.catalog.domains.map(item => `<optgroup label="${esc(item.name)}">${state.catalog.categories.filter(cat => cat.domainId === item.id).map(cat => `<option value="${cat.id}"${cat.id === selected ? ' selected' : ''}>${esc(cat.name)}</option>`).join('')}</optgroup>`).join('');
}

function openEditor(article = null) {
    const draft = article || { title: '', categoryId: state.catalog.categories[0]?.id, difficulty: 3, tags: [], summary: '', keyPoints: [], visuals: [], related: [], source: '', bodyMd: '# 新文章\n\n', sort: 0 };
    const { root, close } = openModal(article ? `编辑：${article.title}` : '新建文章', `
        <form class="dk-editor" autocomplete="off">
            <div class="dk-form-grid">
                <label class="span-2">标题<input class="dk-input" name="title" required maxlength="200" value="${esc(draft.title)}"></label>
                <label>分类<select class="dk-input" name="categoryId">${categoryOptions(draft.categoryId)}</select></label>
                <label>难度 (1~5)<input class="dk-input" type="number" name="difficulty" min="1" max="5" value="${draft.difficulty}"></label>
                <label>排序<input class="dk-input" type="number" name="sort" value="${draft.sort || 0}"></label>
                <label>标签（逗号分隔）<input class="dk-input" name="tags" value="${esc(draft.tags.join(', '))}"></label>
                <label class="span-3">一句话摘要<textarea class="dk-input" name="summary" rows="2">${esc(draft.summary)}</textarea></label>
                <label class="span-3">核心要点（每行一条）<textarea class="dk-input" name="keyPoints" rows="4">${esc(draft.keyPoints.join('\n'))}</textarea></label>
                <fieldset class="span-3"><legend>关联可视化</legend><div class="dk-check-grid">${[...VISUALS.values()].map(visual => `<label class="dk-check"><input type="checkbox" name="visuals" value="${visual.id}"${draft.visuals.includes(visual.id) ? ' checked' : ''}>${visualBadge(visual)}${esc(visual.title)}</label>`).join('')}</div></fieldset>
                <label class="span-2">关联文章<select class="dk-input" name="related" multiple size="5">${state.catalog.articles.filter(item => item.id !== draft.id).map(item => `<option value="${item.id}"${draft.related.includes(item.id) ? ' selected' : ''}>${esc(item.title)}</option>`).join('')}</select></label>
                <label>来源<input class="dk-input" name="source" value="${esc(draft.source)}"></label>
            </div>
            <div class="dk-editor-body"><div class="dk-tabs"><button type="button" class="is-active" data-etab="src">Markdown 正文</button><button type="button" data-etab="preview">预览</button></div>
                <textarea class="dk-input dk-md-input" name="bodyMd" spellcheck="false">${esc(draft.bodyMd)}</textarea><div class="dk-markdown dk-md-preview" hidden></div></div>
            <footer class="dk-modal-foot">${article ? '<button type="button" class="dk-btn danger ghost" data-delete>删除文章</button>' : ''}<span></span><button type="button" class="dk-btn ghost" data-cancel>取消</button><button type="submit" class="dk-btn">保存</button></footer>
        </form>`, { wide: true });
    const form = root.querySelector('form');
    root.querySelector('[data-cancel]').addEventListener('click', close);
    root.querySelectorAll('[data-etab]').forEach(button => button.addEventListener('click', () => {
        root.querySelectorAll('[data-etab]').forEach(other => other.classList.toggle('is-active', other === button));
        const preview = button.dataset.etab === 'preview';
        form.bodyMd.hidden = preview;
        const box = root.querySelector('.dk-md-preview');
        box.hidden = !preview;
        if (preview) { renderMarkdown(box, form.bodyMd.value, { findArticle: findArticleByTitle }); renderMermaid(box, resolvedTheme() === 'dark'); }
    }));
    root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm(`确定删除《${article.title}》吗？删除后保留历史版本，但不会再显示。`)) return;
        try {
            await api(`/articles/${article.id}?tenantId=${encodeURIComponent(state.tenantId)}`, { method: 'DELETE' });
            toast('已删除', 'ok');
            close();
            state.articles.delete(article.id);
            await reloadCatalog();
            location.hash = '#/';
        } catch (error) { toast(error.message, 'bad'); }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const payload = {
            title: form.title.value.trim(), categoryId: form.categoryId.value, difficulty: Number(form.difficulty.value), sort: Number(form.sort.value) || 0,
            tags: form.tags.value.split(/[,，]/).map(item => item.trim()).filter(Boolean),
            summary: form.summary.value.trim(), keyPoints: form.keyPoints.value.split('\n').map(item => item.trim()).filter(Boolean),
            visuals: [...form.querySelectorAll('[name="visuals"]:checked')].map(input => input.value),
            related: [...form.related.selectedOptions].map(option => option.value),
            source: form.source.value.trim(), bodyMd: form.bodyMd.value
        };
        try {
            if (article) {
                await api(`/articles/${article.id}`, { method: 'PUT', body: { tenantId: state.tenantId, revision: article.revision, article: payload } });
                state.articles.delete(article.id);
                toast('已保存', 'ok');
                close();
                await reloadCatalog();
                route();
            } else {
                const { ids } = await api('/articles', { method: 'POST', body: { tenantId: state.tenantId, article: payload } });
                toast('已创建', 'ok');
                close();
                await reloadCatalog();
                location.hash = `#/a/${ids[0]}`;
            }
        } catch (error) {
            toast(error.code === 'DATACOM_REVISION_CONFLICT' ? '文章已被其他人修改，请关闭后刷新再编辑' : error.message, 'bad');
        }
    });
}

async function openHistory(article) {
    const { root } = openModal(`历史版本：${article.title}`, '<div class="dk-loading">加载中…</div>');
    try {
        const { revisions } = await api(`/articles/${article.id}/revisions`);
        root.querySelector('.dk-modal-body').innerHTML = revisions.length ? `<table class="dk-calc-table"><thead><tr><th>版本</th><th>时间</th><th>修改人</th><th>正文长度</th><th></th></tr></thead><tbody>${revisions.map(item => `<tr><td>v${item.revision}</td><td>${esc(item.createdAt.replace('T', ' ').slice(0, 19))}</td><td>${esc(item.createdBy)}</td><td>${item.bodyLength}</td><td><button class="dk-btn small ghost" data-restore="${item.id}">载入编辑器</button></td></tr>`).join('')}</tbody></table><p class="dk-mini-note">“载入编辑器”只把历史内容填入编辑器，点击保存后才会生效。</p>` : '<div class="dk-mini-note">暂无历史版本（首次修改后才会产生）。</div>';
        root.addEventListener('click', async event => {
            const id = event.target.closest('[data-restore]')?.dataset.restore;
            if (!id) return;
            const { article: old } = await api(`/articles/${article.id}/revisions/${id}`);
            openEditor({ ...article, ...old, id: article.id, revision: article.revision });
        });
    } catch (error) {
        root.querySelector('.dk-modal-body').innerHTML = `<div class="dk-empty">${esc(error.message)}</div>`;
    }
}

function openImport() {
    const { root, close } = openModal('导入 Markdown 知识', `
        <div class="dk-import">
            <p class="dk-mini-note">支持多选 .md 文件、粘贴单篇文档，或 Obsidian 合并文档（含 <code>&lt;!-- 文件 n/N：路径 --&gt;</code> 标记）。一个文件里有多个一级标题时会拆成多篇。</p>
            <div class="dk-form-row"><label>选择文件<input class="dk-input" type="file" accept=".md,.markdown,.txt" multiple data-files></label></div>
            <label>或直接粘贴<textarea class="dk-input" rows="8" data-paste placeholder="# 标题\n\n正文……"></textarea></label>
            <div class="dk-form-row"><button class="dk-btn" data-parse>解析预览</button></div>
            <div data-preview></div>
        </div>`, { wide: true });
    let drafts = [];
    root.querySelector('[data-parse]').addEventListener('click', async () => {
        const files = await Promise.all([...root.querySelector('[data-files]').files].map(async file => ({ name: file.name, content: await file.text() })));
        const pasted = root.querySelector('[data-paste]').value;
        if (pasted.trim()) files.push({ name: 'pasted.md', content: pasted });
        if (!files.length) return toast('请先选择文件或粘贴内容', 'bad');
        try {
            ({ drafts } = await api('/import/parse', { method: 'POST', body: { files } }));
        } catch (error) { return toast(error.message, 'bad'); }
        root.querySelector('[data-preview]').innerHTML = `<div class="dk-form-row"><label>统一放入分类<select class="dk-input" data-all>${categoryOptions(state.catalog.categories[0]?.id)}</select></label><button class="dk-btn small ghost" data-apply-all>应用到全部</button></div>
            <table class="dk-calc-table dk-import-table"><thead><tr><th><input type="checkbox" checked data-check-all></th><th>标题</th><th>分类</th><th>长度</th></tr></thead><tbody>${drafts.map((draft, index) => `<tr><td><input type="checkbox" checked data-pick="${index}"></td><td><input class="dk-input slim" data-title="${index}" value="${esc(draft.title)}"><div class="dk-mini-note">${esc(draft.source)}</div></td><td><select class="dk-input slim" data-cat="${index}">${categoryOptions(guessCategory(draft))}</select></td><td>${draft.bodyMd.length}</td></tr>`).join('')}</tbody></table>
            <footer class="dk-modal-foot"><span class="dk-mini-note">共解析 ${drafts.length} 篇。导入后可在编辑器中补充摘要、要点和可视化关联。</span><button class="dk-btn" data-commit>导入选中文章</button></footer>`;
    });
    root.addEventListener('click', async event => {
        if (event.target.closest('[data-apply-all]')) {
            const value = root.querySelector('[data-all]').value;
            root.querySelectorAll('[data-cat]').forEach(select => { select.value = value; });
        }
        if (event.target.closest('[data-check-all]')) {
            const checked = event.target.checked;
            root.querySelectorAll('[data-pick]').forEach(box => { box.checked = checked; });
        }
        if (event.target.closest('[data-commit]')) {
            const articles = drafts.map((draft, index) => ({ ...draft, title: root.querySelector(`[data-title="${index}"]`).value.trim(), categoryId: root.querySelector(`[data-cat="${index}"]`).value }))
                .filter((_, index) => root.querySelector(`[data-pick="${index}"]`).checked);
            if (!articles.length) return toast('没有选中任何文章', 'bad');
            try {
                const { ids } = await api('/articles', { method: 'POST', body: { tenantId: state.tenantId, articles } });
                toast(`已导入 ${ids.length} 篇`, 'ok');
                close();
                await reloadCatalog();
                location.hash = `#/a/${ids[0]}`;
            } catch (error) { toast(error.message, 'bad'); }
        }
    });
}

function guessCategory(draft) {
    const text = `${draft.source} ${draft.title} ${draft.tags.join(' ')}`.toLowerCase();
    const scored = state.catalog.categories.map(cat => {
        const dom = domain(cat.domainId);
        let score = 0;
        [cat.name, dom?.name, dom?.id, cat.id].filter(Boolean).forEach(word => { String(word).toLowerCase().split(/[\s·/-]+/).forEach(part => { if (part.length >= 2 && text.includes(part)) score += part.length; }); });
        return { cat, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.score ? scored[0].cat.id : state.catalog.categories[0]?.id;
}

function openManager() {
    const render = () => `
        <div class="dk-manage">
            ${state.catalog.domains.map(item => `<section><h4>${esc(item.icon)} ${esc(item.name)} <code>${esc(item.id)}</code></h4><ul>${state.catalog.categories.filter(cat => cat.domainId === item.id).map(cat => `<li><span>${esc(cat.name)} <code>${esc(cat.id)}</code> · ${state.catalog.articles.filter(article => article.categoryId === cat.id).length} 篇</span><button class="dk-btn small ghost" data-del-cat="${cat.id}">删除</button></li>`).join('')}</ul></section>`).join('')}
            <form data-new-domain class="dk-form-row"><strong>新领域</strong><input class="dk-input" name="id" placeholder="ID，如 bgp" required pattern="[a-z0-9][a-z0-9-]{1,63}"><input class="dk-input" name="name" placeholder="名称，如 BGP 边界网关协议" required><input class="dk-input" name="icon" placeholder="图标 🌐" maxlength="4"><input class="dk-input" name="description" placeholder="描述"><button class="dk-btn small">创建</button></form>
            <form data-new-cat class="dk-form-row"><strong>新分类</strong><select class="dk-input" name="domainId">${state.catalog.domains.map(item => `<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select><input class="dk-input" name="id" placeholder="ID，如 bgp-path" required pattern="[a-z0-9][a-z0-9-]{1,63}"><input class="dk-input" name="name" placeholder="名称，如 选路原则" required><input class="dk-input" name="description" placeholder="描述"><button class="dk-btn small">创建</button></form>
        </div>`;
    const { root } = openModal('管理领域与分类', render(), { wide: true });
    const refresh = async () => { await reloadCatalog(); root.querySelector('.dk-modal-body').innerHTML = render(); };
    root.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.target;
        const data = Object.fromEntries(new FormData(form).entries());
        try {
            if (form.matches('[data-new-domain]')) await api('/domains', { method: 'POST', body: { tenantId: state.tenantId, domain: { ...data, sort: 100 } } });
            else await api('/categories', { method: 'POST', body: { tenantId: state.tenantId, category: { ...data, sort: 100 } } });
            toast('已创建', 'ok');
            await refresh();
        } catch (error) { toast(error.message, 'bad'); }
    });
    root.addEventListener('click', async event => {
        const id = event.target.closest('[data-del-cat]')?.dataset.delCat;
        if (!id || !confirm('确定删除该分类吗？分类下必须没有文章。')) return;
        try {
            await api(`/categories/${id}?tenantId=${encodeURIComponent(state.tenantId)}`, { method: 'DELETE' });
            toast('已删除', 'ok');
            await refresh();
        } catch (error) { toast(error.message, 'bad'); }
    });
}

function openRfcModal(code, title) {
    const def = rfcScene(code, title);
    if (!def) return toast('无法解析该报文图', 'bad');
    const { root } = openModal(def.title, '<div class="dk-stage-host is-modal" data-modal-stage></div>', { wide: true });
    const handle = createStage(root.querySelector('[data-modal-stage]'), def, {});
    modalDisposers.push(() => handle.dispose());
}

// ---------------- 路由 ----------------
function parseRoute() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const parts = hash.split('/').filter(Boolean);
    if (!parts.length) return { name: 'home' };
    if (parts[0] === 'a' && parts[1]) return { name: 'article', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'lab' && parts[1]) return { name: 'lab', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'labs') return { name: 'labs' };
    if (parts[0] === 'map') return { name: 'map' };
    return { name: 'anchor', id: hash };
}

function route() {
    const next = parseRoute();
    if (next.name === 'anchor' && state.route) {
        // 目录中的锚点：只滚动，不切换页面
        document.getElementById(next.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    if (next.name === 'anchor') next.name = 'home';
    unmountAll();
    state.route = next;
    state.sidebarOpen = false;
    document.body.classList.remove('is-nav-open');
    $('#searchResults').hidden = true;
    renderSidebar();
    if (next.name === 'home') renderHome();
    if (next.name === 'labs') renderLabs();
    if (next.name === 'lab') renderLab(next.id);
    if (next.name === 'map') renderMap();
    if (next.name === 'article') renderArticle(next.id);
    if (next.name !== 'article') window.scrollTo(0, 0);
}

async function reloadCatalog() {
    const data = await api('');
    state.catalog = { domains: data.domains, categories: data.categories, articles: data.articles, learningPath: data.learningPath };
    state.canWrite = data.canWrite;
    state.tenantId = data.tenantId;
    state.username = data.username;
    state.databaseFile = data.databaseFile;
    renderSidebar();
}

function bindGlobalEvents() {
    window.addEventListener('hashchange', route);
    $('#themeBtn').addEventListener('click', () => {
        const order = ['dark', 'light', 'system'];
        const current = localStorageGet(THEME_KEY) || 'dark';
        localStorageSet(THEME_KEY, order[(order.indexOf(current) + 1) % order.length]);
        applyTheme();
        if (state.route?.name === 'article') renderArticle(state.route.id);
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
    $('#navToggle').addEventListener('click', () => document.body.classList.toggle('is-nav-open'));
    $('#searchInput').addEventListener('input', event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => runSearch(event.target.value), 220);
    });
    $('#searchInput').addEventListener('keydown', event => { if (event.key === 'Escape') { event.target.value = ''; $('#searchResults').hidden = true; } });
    document.addEventListener('click', event => {
        if (!event.target.closest('.dk-search')) $('#searchResults').hidden = true;
        const collapse = event.target.closest('[data-collapse]')?.dataset.collapse;
        if (collapse) {
            state.collapsed.has(collapse) ? state.collapsed.delete(collapse) : state.collapsed.add(collapse);
            renderSidebar();
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if (action === 'new-article') openEditor();
        if (action === 'import') openImport();
        if (action === 'manage') openManager();
        if (action === 'edit' && state.route?.name === 'article') openEditor(state.articles.get(state.route.id));
        if (action === 'history' && state.route?.name === 'article') openHistory(state.articles.get(state.route.id));
        const visualTab = event.target.closest('[data-visual]');
        if (visualTab) {
            unmountAll();
            document.querySelectorAll('[data-visual]').forEach(button => button.classList.toggle('is-active', button === visualTab));
            const open = document.querySelector('[data-open-lab]');
            if (open) open.href = `#/lab/${visualTab.dataset.visual}`;
            mountVisual($('#articleStage'), visualTab.dataset.visual, { compact: true });
        }
        const copy = event.target.closest('[data-copy]');
        if (copy) {
            const code = copy.closest('.dk-code').querySelector('code').textContent;
            navigator.clipboard?.writeText(code).then(() => toast('已复制', 'ok'), () => toast('复制失败', 'bad'));
        }
        const rfc = event.target.closest('[data-rfc]');
        if (rfc) {
            const figure = rfc.closest('.dk-code');
            let heading = figure.previousElementSibling;
            while (heading && !/^H[1-4]$/.test(heading.tagName)) heading = heading.previousElementSibling;
            openRfcModal(figure.querySelector('code').textContent, heading ? heading.textContent.replace(/^[#\s]+/, '').slice(0, 40) : '报文结构');
        }
        const toc = event.target.closest('[data-toc]');
        if (toc) {
            event.preventDefault();
            document.getElementById(toc.dataset.toc)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}

async function boot() {
    applyTheme();
    bindGlobalEvents();
    try {
        await reloadCatalog();
    } catch (error) {
        main().innerHTML = `<div class="dk-empty"><h2>无法加载知识库</h2><p>${esc(error.message)}</p></div>`;
        return;
    }
    route();
}

boot();
