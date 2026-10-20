// 数通协议专家：知识库阅读 + 分步教学可视化 + 管理员维护（数据存放在后端 datacom-knowledge.db）
import { createTeachingStage } from './teaching-stage.js';
import { ospfLessons } from './ospf-lessons.js';
import { junosLessons } from './junos-lessons.js';
import { rfcLesson } from './packet-lesson.js';
import { mountKnowledgeMap } from './knowledge-map.js';
import { labs } from './labs.js';
import { readingGuides } from './reading-guides.js';
import { renderMarkdown, renderMermaid } from './markdown.js';
import { createSnapshotApi } from './snapshot-api.js';
import { initAiNotes } from './ai-notes.js';
import { mountNoteVideo, loadVideoManifest, mountVideoRecommendations } from './note-video.js';
import { mountMindMap } from './mindmap.js';
import { mountNotesReview, sidebarIndexHtml } from './notes-review.js';

const API = '/api/datacom-knowledge';
const snapshotApi = window.__DATACOM_SNAPSHOT__ ? createSnapshotApi(window.__DATACOM_SNAPSHOT__) : null;
const THEME_KEY = 'dk_theme';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const VISUALS = new Map();
[...ospfLessons, ...junosLessons].forEach(def => VISUALS.set(def.id, { id: def.id, kind: 'lesson', title: def.title, subtitle: def.subtitle, def }));
labs.forEach(lab => VISUALS.set(lab.id, { id: lab.id, kind: '2d', title: lab.title, subtitle: lab.subtitle, lab }));

const state = {
    catalog: null, canWrite: false, tenantId: undefined, username: '',
    articles: new Map(), videos: {}, mounted: [], route: null, sidebarOpen: false, collapsed: new Set(), coverageFilter: 'all'
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
    if (snapshotApi) return snapshotApi(path, { method });
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
        const handle = visual.kind === 'lesson' ? createTeachingStage(container, visual.def) : visual.lab.mount(container);
        state.mounted.push(handle);
        document.dispatchEvent(new CustomEvent('dk:visual-mounted', { detail: { id, handle, container } }));
        return handle;
    } catch (error) {
        console.error(error);
        container.innerHTML = `<div class="dk-empty">可视化加载失败：${esc(error.message)}</div>`;
        return null;
    }
}

const category = id => state.catalog.categories.find(item => item.id === id);
const domain = id => state.catalog.domains.find(item => item.id === id);
const articleMeta = id => state.catalog.articles.find(item => item.id === id);
const stars = n => `<span class="dk-stars" title="难度 ${n}/5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
const STATUS = {
    covered: { label: '原笔记已覆盖', short: '原笔记', icon: '●' },
    partial: { label: '笔记提及但不完整', short: '不完整', icon: '◐' },
    added: { label: 'AI 补充（笔记未提及）', short: 'AI 补充', icon: '✦' }
};
const NAV_MODE_KEY = 'dk_nav_mode';
const navTitle = article => article.shortTitle || article.title;
const outlinePoints = parentId => (state.catalog.outline || []).filter(node => node.parentId === parentId).sort((a, b) => a.sort - b.sort);
const outlineChapters = domainId => (state.catalog.outline || []).filter(node => node.domainId === domainId && !node.parentId).sort((a, b) => a.sort - b.sort);
function countStatus(points) {
    const count = { covered: 0, partial: 0, added: 0 };
    points.forEach(point => { if (count[point.status] !== undefined) count[point.status] += 1; });
    return count;
}
// 章节状态：全部原笔记覆盖 → 原笔记；全部为 AI 补充 → AI 补充；其余为不完整
function chapterStatus(chapterId) {
    const count = countStatus(outlinePoints(chapterId));
    const total = count.covered + count.partial + count.added;
    if (!total) return 'added';
    if (count.covered === total) return 'covered';
    if (count.added === total) return 'added';
    return 'partial';
}
const coverageBar = count => {
    const total = count.covered + count.partial + count.added || 1;
    return `<span class="dk-cov-bar" title="原笔记 ${count.covered} · 不完整 ${count.partial} · AI 补充 ${count.added}">${['covered', 'partial', 'added'].map(key => `<i class="is-${key}" style="width:${count[key] / total * 100}%"></i>`).join('')}</span>`;
};
const aiBadge = text => `<span class="dk-src-badge is-ai" title="由 AI 根据原笔记整理生成，非笔记原文">✦ ${text}</span>`;
const visualBadge = visual => `<span class="dk-badge ${visual.kind === 'lesson' ? 'is-lesson' : 'is-2d'}">${visual.kind === 'lesson' ? '分步图解' : '动手计算'}</span>`;

function findArticleByTitle(target) {
    const key = String(target).toLowerCase().replace(/\s+/g, '');
    if (!key) return null;
    return state.catalog.articles.find(item => item.id === target)
        || state.catalog.articles.find(item => item.title.toLowerCase().replace(/\s+/g, '').includes(key))
        || state.catalog.articles.find(item => item.tags.some(tag => tag.toLowerCase().replace(/\s+/g, '') === key))
        || null;
}

// ---------------- 主题 ----------------
let systemThemeMedia = null;
try { systemThemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)') || null; } catch (_) { /* 无法识别时使用浅色 */ }
function themePreference() {
    const pref = localStorageGet(THEME_KEY);
    return ['dark', 'light', 'system'].includes(pref) ? pref : 'system';
}
function resolvedTheme() {
    const pref = themePreference();
    if (pref === 'system') return systemThemeMedia?.matches === true ? 'dark' : 'light';
    return pref;
}
function localStorageGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function localStorageSet(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* 隐私模式 */ } }
function applyTheme() {
    const pref = themePreference();
    document.documentElement.dataset.theme = resolvedTheme();
    const button = $('#themeBtn');
    if (button) button.textContent = { dark: '🌙 深色', light: '☀️ 浅色', system: '🌓 跟随系统' }[pref];
}

// ---------------- 侧边栏 ----------------
function renderSidebar() {
    const { catalog } = state;
    const route = state.route || {};
    const mode = state.aiNotes && localStorageGet(NAV_MODE_KEY) === 'notes' ? 'notes' : 'dir';
    const top = [
        ['home', '#/', '🏠', '总览'], ['labs', '#/labs', '🧊', '可视化实验室'], ['map', '#/map', '🌌', '知识星图'], ['outline', '#/outline', '🧭', '知识大纲']
    ].map(([name, href, icon, label]) => `<a href="${href}" class="${route.name === name || (name === 'labs' && route.name === 'lab') || (name === 'outline' && route.name === 'coverage') ? 'is-active' : ''}"><span>${icon}</span>${label}</a>`).join('');
    const admin = state.canWrite ? `<div class="dk-nav-admin">
            <button class="dk-nav-tool is-primary" data-action="new-article" title="新建文章"><span>＋</span>新建</button>
            <button class="dk-nav-tool" data-action="import" title="导入 Markdown"><span>⇪</span>导入</button>
            <button class="dk-nav-tool" data-action="manage" title="管理领域与分类"><span>🗂</span>分类</button></div>` : '';
    const switcher = `<div class="dk-nav-mode" role="tablist" aria-label="目录视图">
            <button class="${mode === 'dir' ? 'is-active' : ''}" data-nav-mode="dir">📁 笔记目录</button>
            ${state.aiNotes ? `<button class="${mode === 'notes' ? 'is-active' : ''}" data-nav-mode="notes">💬 笔记问答</button>` : ''}</div>`;
    if (mode === 'notes' && !state.notesIndex && !state.notesIndexLoading) refreshNotesIndex();
    const tree = mode === 'notes' ? sidebarIndexHtml({ list: state.notesIndex || [], catalog, activeKey: route.name === 'notes' ? route.id : null, loading: !state.notesIndex }) : catalog.domains.map(item => {
        const collapsed = state.collapsed.has(item.id);
        const categories = catalog.categories.filter(cat => cat.domainId === item.id);
        const total = catalog.articles.filter(article => categories.some(cat => cat.id === article.categoryId)).length;
        const head = `<button class="dk-nav-domain-head" data-collapse="${item.id}"><i class="dk-chevron"></i><span class="dk-nav-icon">${esc(item.icon || '📚')}</span><strong>${esc(item.name)}</strong><em>${total}</em></button>`;
        const body = categories.map(cat => {
                const articles = catalog.articles.filter(article => article.categoryId === cat.id);
                return `<div class="dk-nav-cat"><div class="dk-nav-cat-name"><span>${esc(cat.name)}</span><em>${articles.length}</em></div>${articles.map(article => {
                    const hasLesson = article.visuals.some(id => VISUALS.get(id)?.kind === 'lesson');
                    return `<a class="dk-nav-link${route.name === 'article' && route.id === article.id ? ' is-active' : ''}" href="#/a/${article.id}" title="${esc(article.title)}"><span>${esc(navTitle(article))}</span>${Object.hasOwn(state.videos, article.id) ? '<i class="dk-nav-video" title="含视频讲解" aria-label="含视频讲解">▶ 视频</i>' : ''}${hasLesson ? '<i class="dk-nav-3d" title="含分步教学图解">图解</i>' : ''}</a>`;
                }).join('') || '<div class="dk-nav-empty">暂无文章</div>'}</div>`;
        }).join('');
        return `<section class="dk-nav-domain${collapsed ? ' is-collapsed' : ''}">${head}<div class="dk-nav-domain-body">${body}</div></section>`;
    }).join('');
    const sidebar = $('#sidebar');
    const scrollTop = sidebar.scrollTop;
    sidebar.innerHTML = `<nav class="dk-nav-top">${top}</nav>${admin}${switcher}<div class="dk-nav-tree">${tree}</div>
        <div class="dk-nav-foot">数据库：${esc(state.databaseFile || 'datacom-knowledge.db')}</div>`;
    // 重绘后保持原滚动位置；只在当前项不在可视区时纵向滚动，绝不横向滚动
    sidebar.scrollTop = scrollTop;
    sidebar.scrollLeft = 0;
    const active = sidebar.querySelector('.is-active.dk-nav-link');
    if (active) {
        const top = active.offsetTop;
        const bottom = top + active.offsetHeight;
        if (top < sidebar.scrollTop + 60) sidebar.scrollTop = Math.max(0, top - 120);
        else if (bottom > sidebar.scrollTop + sidebar.clientHeight - 20) sidebar.scrollTop = bottom - sidebar.clientHeight + 80;
    }
}

// 侧栏「笔记问答」索引的数据：与复习页共用 /annotations?scope=all
async function refreshNotesIndex() {
    if (!state.aiNotes) return;
    state.notesIndexLoading = true;
    try { state.notesIndex = await state.aiNotes.loadAll(); } catch (_) { state.notesIndex = []; }
    state.notesIndexLoading = false;
    renderSidebar();
}

// ---------------- 视图：笔记问答（复习页） ----------------
function renderNotes(groupKey = null) {
    if (!state.aiNotes) { main().innerHTML = '<div class="dk-empty">离线快照不包含 AI 问答与笔记</div>'; return; }
    if (localStorageGet(NAV_MODE_KEY) !== 'notes') { localStorageSet(NAV_MODE_KEY, 'notes'); renderSidebar(); }
    const handle = mountNotesReview(main(), { notes: state.aiNotes, catalog: state.catalog, focusKey: groupKey, toast });
    state.mounted.push(handle);
}

// ---------------- 视图：知识大纲（无限画布导图 + 覆盖清单） ----------------
function outlineTabs(active) {
    return `<div class="dk-outline-tabs" role="tablist"><a href="#/outline" class="${active === 'map' ? 'is-active' : ''}">🗺 知识导图</a><a href="#/outline-list" class="${active === 'list' ? 'is-active' : ''}">☑ 覆盖清单</a></div>`;
}

function renderOutline(focusId = null) {
    const all = (state.catalog.outline || []).filter(node => node.parentId);
    const total = countStatus(all);
    main().innerHTML = `<div class="dk-outline-page">
        <header class="dk-outline-head"><div><div class="dk-hud-kicker">KNOWLEDGE OUTLINE</div><h1>🧭 知识大纲</h1>
            <p>从左到右：一层目录 → 二层目录 → 笔记 → 知识点。虚线是笔记之间的关联；点击笔记或知识点即可打开并播放视频讲解。</p></div>
            <div class="dk-outline-stats">${Object.entries(STATUS).map(([key, info]) => `<span class="is-${key}"><b>${total[key]}</b>${info.short}</span>`).join('')}</div>${outlineTabs('map')}</header>
        <div class="dk-outline-canvas" id="outlineCanvas"></div></div>`;
    const handle = mountMindMap($('#outlineCanvas'), {
        catalog: state.catalog,
        statusLabels: Object.fromEntries(Object.entries(STATUS).map(([key, info]) => [key, info.label])),
        currentArticleId: state.lastArticleId || null,
        focusNodeId: focusId,
        onOpen({ articleId, focus }) {
            if (focus) state.pendingFocus = focus;
            location.hash = `#/a/${encodeURIComponent(articleId)}`;
        }
    });
    state.mounted.push(handle);
}

function renderCoverage(focusId = null) {
    const { catalog } = state;
    const filter = state.coverageFilter;
    const all = (catalog.outline || []).filter(node => node.parentId);
    const total = countStatus(all);
    const filters = [['all', '全部', all.length], ...Object.entries(STATUS).map(([key, info]) => [key, info.short, total[key]])];
    const editBtn = (id, label = '编辑') => state.canWrite ? `<button class="dk-btn small ghost" data-outline-edit="${id}">${label}</button>` : '';
    main().innerHTML = `<header class="dk-page-head"><div class="dk-hud-kicker">KNOWLEDGE COVERAGE</div><h1>🧭 知识大纲 · 覆盖清单</h1>${outlineTabs('list')}
            <p>按协议的完整知识体系列出“章节 → 知识点”，用颜色区分每个知识点在你的原笔记中的覆盖情况。绿色来自原笔记；琥珀色表示笔记提到了但讲得不完整，并写明缺了什么；紫色是笔记完全没有、由 AI 补充的内容，建议核实后再使用。</p></header>
        <div class="dk-cov-summary">${Object.entries(STATUS).map(([key, info]) => `<div class="dk-cov-stat is-${key}"><b>${total[key]}</b><span>${info.icon} ${info.label}</span></div>`).join('')}
            <div class="dk-cov-stat"><b>${all.length ? Math.round(total.covered / all.length * 100) : 0}%</b><span>原笔记完整覆盖率</span></div></div>
        <div class="dk-chip-row dk-cov-filters">${filters.map(([key, label, n]) => `<button class="dk-chip${filter === key ? ' is-on' : ''}${key !== 'all' ? ` is-${key}` : ''}" data-cov-filter="${key}">${label} · ${n}</button>`).join('')}</div>
        ${catalog.domains.map(item => {
            const chapters = outlineChapters(item.id);
            const points = chapters.flatMap(chapter => outlinePoints(chapter.id));
            return `<section class="dk-cov-domain"><header><h2>${esc(item.icon)} ${esc(item.name)}</h2>${coverageBar(countStatus(points))}<span class="dk-mini-note">${points.length} 个知识点</span>${state.canWrite ? `<button class="dk-btn small ghost" data-outline-new="${item.id}">＋ 章节</button>` : ''}</header>
                <div class="dk-cov-grid">${chapters.map(chapter => {
                    const list = outlinePoints(chapter.id).filter(point => filter === 'all' || point.status === filter);
                    if (filter !== 'all' && !list.length) return '';
                    const status = chapterStatus(chapter.id);
                    return `<article class="dk-cov-chapter is-${status}" id="cov-${chapter.id}"><header><span class="dk-status-pill is-${status}">${STATUS[status].short}</span><h3>${esc(chapter.title)}</h3>${editBtn(chapter.id)}${state.canWrite ? `<button class="dk-btn small ghost" data-outline-new="${item.id}" data-parent="${chapter.id}">＋ 知识点</button>` : ''}</header>
                        <ul>${list.map(point => {
                            const links = point.articles.map(articleMeta).filter(Boolean).map(article => `<a class="dk-pill" href="#/a/${article.id}">${esc(navTitle(article))}</a>`).join('');
                            const note = point.note ? `<p class="dk-cov-note">${point.status === 'added' ? '<b>AI 补充：</b>' : (point.status === 'partial' ? '<b>未完整之处：</b>' : '')}${esc(point.note)}${point.status === 'added' ? ' <em>（非原笔记内容，建议核实）</em>' : ''}</p>` : '';
                            return `<li class="dk-cov-point is-${point.status}${point.id === focusId ? ' is-focus' : ''}" id="cov-${point.id}"><div class="dk-cov-row"><span class="dk-status-pill is-${point.status}">${STATUS[point.status]?.icon || ''} ${STATUS[point.status]?.short || ''}</span><strong>${esc(point.title)}</strong>${editBtn(point.id)}</div>${note}${links ? `<div class="dk-cov-links">${links}</div>` : ''}</li>`;
                        }).join('')}</ul></article>`;
                }).join('')}</div></section>`;
        }).join('')}`;
    if (focusId) requestAnimationFrame(() => document.getElementById(`cov-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
}

function openOutlineEditor({ id = null, domainId, parentId = null }) {
    const node = id ? state.catalog.outline.find(item => item.id === id) : { domainId, parentId, title: '', status: parentId ? 'covered' : null, note: '', articles: [], sort: ((parentId ? outlinePoints(parentId) : outlineChapters(domainId)).length + 1) * 10 };
    if (!node) return;
    const isPoint = Boolean(node.parentId);
    const { root, close } = openModal(id ? `编辑${isPoint ? '知识点' : '章节'}` : `新建${isPoint ? '知识点' : '章节'}`, `
        <form class="dk-editor" autocomplete="off"><div class="dk-form-grid">
            <label class="span-2">标题<input class="dk-input" name="title" required maxlength="120" value="${esc(node.title)}"></label>
            <label>排序<input class="dk-input" type="number" name="sort" value="${node.sort}"></label>
            ${isPoint ? `<label>覆盖状态<select class="dk-input" name="status">${Object.entries(STATUS).map(([key, info]) => `<option value="${key}"${node.status === key ? ' selected' : ''}>${info.label}</option>`).join('')}</select></label>
            <label class="span-2">关联文章<select class="dk-input" name="articles" multiple size="6">${state.catalog.articles.map(article => `<option value="${article.id}"${node.articles.includes(article.id) ? ' selected' : ''}>${esc(article.title)}</option>`).join('')}</select></label>
            <label class="span-3">说明（不完整之处 / AI 补充内容）<textarea class="dk-input" name="note" rows="4">${esc(node.note)}</textarea></label>` : ''}
        </div><footer class="dk-modal-foot">${id ? '<button type="button" class="dk-btn danger ghost" data-delete>删除</button>' : ''}<span></span><button type="button" class="dk-btn ghost" data-cancel>取消</button><button class="dk-btn">保存</button></footer></form>`);
    const form = root.querySelector('form');
    root.querySelector('[data-cancel]').addEventListener('click', close);
    root.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (!confirm('确定删除该大纲节点吗？')) return;
        try {
            await api(`/outline/${id}?tenantId=${encodeURIComponent(state.tenantId)}`, { method: 'DELETE' });
            close();
            await reloadCatalog();
            route();
        } catch (error) { toast(error.message, 'bad'); }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const payload = { domainId: node.domainId, parentId: node.parentId, title: form.title.value.trim(), sort: Number(form.sort.value) || 0,
            status: isPoint ? form.status.value : null, note: isPoint ? form.note.value.trim() : '', articles: isPoint ? [...form.articles.selectedOptions].map(option => option.value) : [] };
        try {
            await api(id ? `/outline/${id}` : '/outline', { method: id ? 'PUT' : 'POST', body: { tenantId: state.tenantId, node: payload } });
            toast('已保存', 'ok');
            close();
            await reloadCatalog();
            route();
        } catch (error) { toast(error.message, 'bad'); }
    });
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
                <p>从拓扑关系到报文交换，从计算过程到选路结果。每个实验用清晰的分步图解，帮你看懂发生了什么、为什么发生，以及条件改变后会怎样。</p>
                <div class="dk-hero-actions"><a class="dk-btn" href="#/a/${catalog.learningPath[0]?.articles[0] || catalog.articles[0]?.id}">▶ 从学习路径开始</a><a class="dk-btn ghost" href="#/map">🌌 打开知识星图</a><a class="dk-btn ghost" href="#/labs">🧊 可视化实验室</a></div>
            </div>
            <div class="dk-hero-stats">
                <div><b>${catalog.articles.length}</b><span>篇知识文章</span></div>
                <div><b>${catalog.categories.length}</b><span>个主题分类</span></div>
                <div><b>${VISUALS.size}</b><span>个可视化实验</span></div>
                <div><b>${Math.round(chars / 1000)}k</b><span>字原文</span></div>
            </div>
        </section>
        <div class="dk-home-section"><div class="dk-home-layout"><div class="dk-home-content">
        <h2 class="dk-section-title">知识覆盖度 <a class="dk-mini-note" href="#/outline-list">查看覆盖清单 →</a></h2>
        <div class="dk-cov-home">${catalog.domains.map(item => {
            const points = outlineChapters(item.id).flatMap(chapter => outlinePoints(chapter.id));
            const count = countStatus(points);
            return `<a class="dk-cov-home-card" href="#/outline-list"><strong>${esc(item.icon)} ${esc(item.name)}</strong>${coverageBar(count)}<span>${Object.entries(STATUS).map(([key, info]) => `<i class="is-${key}">${info.short} ${count[key]}</i>`).join('')}</span></a>`;
        }).join('')}</div>
        <h2 class="dk-section-title">知识体系</h2>
        <div class="dk-domain-grid">${catalog.domains.map(item => {
            const cats = catalog.categories.filter(cat => cat.domainId === item.id);
            return `<article class="dk-domain-card"><header><span>${esc(item.icon)}</span><h3>${esc(item.name)}</h3></header><p>${esc(item.description)}</p><div class="dk-cat-list">${cats.map(cat => {
                const articles = catalog.articles.filter(article => article.categoryId === cat.id);
                return `<div class="dk-cat-row"><strong>${esc(cat.name)}</strong><div>${articles.map(article => `<a class="dk-pill" href="#/a/${article.id}" title="${esc(article.title)}">${esc(navTitle(article))}</a>`).join('')}</div></div>`;
            }).join('')}</div></article>`;
        }).join('')}</div>
        <h2 class="dk-section-title">推荐学习路径</h2>
        <ol class="dk-path">${catalog.learningPath.map((step, index) => `<li><div class="dk-path-index">${index + 1}</div><div><h4>${esc(step.title)}</h4><div class="dk-path-items">${step.articles.map(id => articleMeta(id)).filter(Boolean).map(article => `<a href="#/a/${article.id}">${esc(article.title)}</a>`).join('<span>→</span>')}</div></div></li>`).join('')}</ol>
        <h2 class="dk-section-title">复杂知识点 · 建议配合可视化阅读</h2>
        <div class="dk-hard-list">${hard.map(article => `<a class="dk-hard" href="#/a/${article.id}"><div>${stars(article.difficulty)}<strong>${esc(article.title)}</strong></div><p>${esc(article.summary)}</p><div class="dk-hard-vis">${article.visuals.map(id => VISUALS.get(id)).filter(Boolean).map(visual => `<span>${visualBadge(visual)}${esc(visual.title.split(' · ')[0])}</span>`).join('')}</div></a>`).join('')}</div>
        </div><aside class="dk-video-recommendations" id="homeVideos" aria-label="视频课堂" hidden></aside></div></div>`;
    state.mounted.push(mountVideoRecommendations($('#homeVideos'), { articles: catalog.articles, offline: Boolean(snapshotApi) }));
}

function renderLabs() {
    const used = new Map();
    state.catalog.articles.forEach(article => article.visuals.forEach(id => used.set(id, (used.get(id) || 0) + 1)));
    main().innerHTML = `<header class="dk-page-head"><div class="dk-hud-kicker">VISUAL LAB</div><h1>可视化实验室</h1><p>先选择条件，再逐步观察。支持上一步 / 下一步、播放暂停、进度回看和节点详情；计算实验室可直接修改参数，核对中间过程与最终结果。</p></header>
        <div class="dk-lab-grid">${[...VISUALS.values()].map(visual => `<a class="dk-lab-card ${visual.kind === 'lesson' ? 'is-lesson' : ''}" href="#/lab/${visual.id}"><div class="dk-lab-card-top">${visualBadge(visual)}<span class="dk-mini-note">${used.get(visual.id) || 0} 篇文章引用</span></div><h3>${esc(visual.title)}</h3><p>${esc(visual.subtitle)}</p></a>`).join('')}</div>`;
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
    main().innerHTML = '<div class="dk-lab-page"><div id="mapHost"></div></div>';
    state.mounted.push(mountKnowledgeMap($('#mapHost'), state.catalog));
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
    state.lastArticleId = id;
    const cat = category(article.categoryId);
    const dom = cat && domain(cat.domainId);
    const visuals = article.visuals.map(vid => VISUALS.get(vid)).filter(Boolean);
    const related = article.related.map(articleMeta).filter(Boolean);
    const list = state.catalog.articles.filter(item => item.categoryId === article.categoryId);
    const index = list.findIndex(item => item.id === article.id);
    const ai = new Set(article.aiFields || []);
    const guide = readingGuides[article.id] || [];
    const points = (state.catalog.outline || []).filter(node => node.parentId && node.articles.includes(article.id));
    main().innerHTML = `<div class="dk-article-layout">
        <article class="dk-article">
            <div class="dk-breadcrumb"><a href="#/">总览</a><span>/</span>${esc(dom?.name || '')}<span>/</span>${esc(cat?.name || '')}</div>
            <h1>${esc(article.title)}</h1>
            <div class="dk-meta">${stars(article.difficulty)}${article.tags.map(tag => `<span class="dk-tag">#${esc(tag)}</span>`).join('')}<span class="dk-mini-note">v${article.revision} · ${esc((article.updatedAt || '').slice(0, 10))}${article.updatedBy && article.updatedBy !== 'system' ? ` · ${esc(article.updatedBy)}` : ''}</span>
                ${state.canWrite ? '<button class="dk-btn small ghost" data-action="edit">✏️ 编辑</button><button class="dk-btn small ghost" data-action="history">🕘 历史</button>' : ''}</div>
            <section class="dk-note-video" id="articleVideo" hidden></section>
            ${article.summary ? `<p class="dk-summary">${ai.has('summary') ? aiBadge('AI 整理') : ''}${esc(article.summary)}</p>` : ''}
            ${guide.length ? `<section class="dk-reading-guide"><h2>阅读提示 · 概念与适用边界</h2><ul>${guide.map(point => `<li>${esc(point)}</li>`).join('')}</ul></section>` : ''}
            ${article.keyPoints.length ? `<section class="dk-keypoints"><h2>核心要点${ai.has('keyPoints') ? aiBadge('AI 整理') : ''}</h2><ol>${article.keyPoints.map(point => `<li>${esc(point)}</li>`).join('')}</ol></section>` : ''}
            ${points.length ? `<section class="dk-article-outline"><h2>本文涉及的大纲知识点 <a class="dk-mini-note" href="#/outline">在知识大纲中查看 →</a></h2><div>${points.map(point => `<a class="dk-cov-chip is-${point.status}" href="#/outline/${point.id}" title="${STATUS[point.status]?.label || ''}${point.note ? `：${esc(point.note)}` : ''}"><i></i>${esc(point.title)}</a>`).join('')}</div></section>` : ''}
            ${visuals.length ? `<section class="dk-visual-block"><div class="dk-section-label">${ai.has('visuals') ? aiBadge('AI 构建的可视化') : ''}<span class="dk-mini-note">依据原笔记内容建模，演示数值仅为示意</span></div><div class="dk-visual-tabs">${visuals.map((visual, i) => `<button class="${i === 0 ? 'is-active' : ''}" data-visual="${visual.id}">${visualBadge(visual)}${esc(visual.title.split(' · ')[0])}</button>`).join('')}<a class="dk-btn small ghost" data-open-lab href="#/lab/${visuals[0].id}">⛶ 实验室全屏</a></div><div class="dk-stage-host" id="articleStage"></div></section>` : ''}
            <div class="dk-section-label"><span class="dk-src-badge is-note" title="笔记原文，未做改动">● 原笔记正文</span>${article.source ? `<span class="dk-mini-note">${esc(article.source)}</span>` : ''}</div>
            <section class="dk-markdown" id="articleBody"></section>
            ${related.length ? `<section class="dk-related"><h3>关联知识</h3><div class="dk-related-grid">${related.map(item => `<a class="dk-related-card" href="#/a/${item.id}">${stars(item.difficulty)}<strong>${esc(item.title)}</strong><p>${esc(item.summary)}</p></a>`).join('')}</div></section>` : ''}
            <nav class="dk-pager">${index > 0 ? `<a href="#/a/${list[index - 1].id}">← ${esc(navTitle(list[index - 1]))}</a>` : '<span></span>'}${index < list.length - 1 ? `<a href="#/a/${list[index + 1].id}">${esc(navTitle(list[index + 1]))} →</a>` : ''}</nav>
            ${article.source ? `<p class="dk-mini-note">来源：${esc(article.source)}</p>` : ''}
        </article>
        <aside class="dk-toc" id="articleToc"></aside></div>`;
    const { toc } = renderMarkdown($('#articleBody'), article.bodyMd, { findArticle: findArticleByTitle });
    $('#articleToc').innerHTML = toc.length ? `<div class="dk-toc-title">目录</div>${toc.map(item => `<a class="lvl-${item.level}" href="#${item.id}" data-toc="${item.id}">${esc(item.text)}</a>`).join('')}` : '';
    renderMermaid($('#articleBody'), resolvedTheme() === 'dark');
    document.dispatchEvent(new CustomEvent('dk:article-rendered', { detail: { article } }));
    if (state.pendingFocus) {
        const focus = state.pendingFocus;
        state.pendingFocus = null;
        requestAnimationFrame(() => focusByText(focus));
    }
    if (visuals.length) mountVisual($('#articleStage'), visuals[0].id, { compact: true });
    // 有讲解视频的笔记：先播视频；跳到正文某一节时视频转为右下角悬浮小窗继续播放
    const videoHost = $('#articleVideo');
    mountNoteVideo(videoHost, article.id, { offline: Boolean(snapshotApi) }).then(dispose => {
        if (state.route?.id === article.id && videoHost.isConnected) state.mounted.push({ dispose });
        else dispose();
    });
    main().scrollTop = 0;
    window.scrollTo(0, 0);
}

// 按知识点标题在正文中找最相关的章节/段落：标题命中优先，其次段落，按关键词命中数打分
function focusByText(text) {
    const words = String(text).split(/[\s/／、，,：:（）()·<>=+\-]+/).map(word => word.trim()).filter(word => word.length >= 2 && !/^(与|和|的|及|类|vs)$/i.test(word));
    if (!words.length) return;
    const score = node => words.reduce((sum, word) => sum + (node.textContent.toLowerCase().includes(word.toLowerCase()) ? word.length : 0), 0);
    const body = $('#articleBody');
    if (!body) return;
    let best = null;
    let bestScore = 0;
    body.querySelectorAll('h1, h2, h3, h4').forEach(node => { const value = score(node) * 2; if (value > bestScore) { best = node; bestScore = value; } });
    if (!best) body.querySelectorAll('p, li, td, .dk-callout-title').forEach(node => { const value = score(node); if (value > bestScore) { best = node; bestScore = value; } });
    if (!best) return;
    best.scrollIntoView({ behavior: 'smooth', block: 'start' });
    best.classList.add('dk-flash');
    setTimeout(() => best.classList.remove('dk-flash'), 2600);
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
// 统一弹窗外壳：图标 + 标题 + 副标题的头部、可滚动正文、固定底部操作栏；size: md | lg | xl
function openModal(title, bodyHtml, { wide = false, size = wide ? 'xl' : 'md', icon = '', subtitle = '', footer = '' } = {}) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="dk-modal-mask"><div class="dk-modal is-${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header class="dk-modal-head">${icon ? `<span class="dk-modal-icon">${icon}</span>` : ''}<div><h3>${esc(title)}</h3>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="dk-icon-btn" data-close aria-label="关闭">×</button></header>
        <div class="dk-modal-body">${bodyHtml}</div>${footer ? `<footer class="dk-modal-actions">${footer}</footer>` : ''}</div></div>`;
    root.hidden = false;
    const onKey = event => { if (event.key === 'Escape' && !event.defaultPrevented) close(); };
    const close = () => {
        modalDisposers.forEach(fn => fn());
        modalDisposers = [];
        document.removeEventListener('keydown', onKey);
        root.hidden = true;
        root.innerHTML = '';
    };
    document.addEventListener('keydown', onKey);
    root.querySelector('[data-close]').addEventListener('click', close);
    root.querySelector('.dk-modal-mask').addEventListener('mousedown', event => { if (event.target.classList.contains('dk-modal-mask')) close(); });
    return { root: root.querySelector('.dk-modal'), close };
}
let modalDisposers = [];

function categoryOptions(selected) {
    return state.catalog.domains.map(item => `<optgroup label="${esc(item.icon || '')} ${esc(item.name)}">${state.catalog.categories.filter(cat => cat.domainId === item.id).map(cat => `<option value="${cat.id}"${cat.id === selected ? ' selected' : ''}>${esc(cat.name)}</option>`).join('')}</optgroup>`).join('');
}

const field = (label, control, { hint = '', span = '', required = false } = {}) => `<label class="dk-field${span ? ` ${span}` : ''}"><span class="dk-field-label">${label}${required ? '<i>*</i>' : ''}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`;

// 标签胶囊输入：回车或逗号添加，退格删除最后一个
function bindChipInput(box, initial = []) {
    const values = [...initial];
    const input = box.querySelector('input');
    const draw = () => {
        box.querySelectorAll('.dk-chip-token').forEach(node => node.remove());
        values.forEach((value, index) => input.insertAdjacentHTML('beforebegin', `<span class="dk-chip-token">#${esc(value)}<button type="button" data-chip-remove="${index}" aria-label="移除">×</button></span>`));
    };
    const commit = () => {
        input.value.split(/[,，]/).map(item => item.trim()).filter(Boolean).forEach(value => { if (!values.includes(value)) values.push(value); });
        input.value = '';
        draw();
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ',' || event.key === '，') { event.preventDefault(); commit(); }
        if (event.key === 'Backspace' && !input.value && values.length) { values.pop(); draw(); }
    });
    input.addEventListener('blur', commit);
    box.addEventListener('click', event => {
        const index = event.target.closest('[data-chip-remove]')?.dataset.chipRemove;
        if (index !== undefined) { values.splice(Number(index), 1); draw(); } else input.focus();
    });
    draw();
    return () => { commit(); return [...values]; };
}

function openEditor(article = null) {
    const draft = article || { title: '', categoryId: state.catalog.categories[0]?.id, difficulty: 3, tags: [], summary: '', keyPoints: [], visuals: [], related: [], source: '', bodyMd: '# 新文章\n\n', sort: 0 };
    const visuals = [...VISUALS.values()];
    const others = state.catalog.articles.filter(item => item.id !== draft.id);
    const levelName = n => ['', '入门', '基础', '进阶', '较难', '专家'][n] || '';
    const body = `<form class="dk-editor2" id="articleForm" autocomplete="off">
        <aside class="dk-editor2-meta">
            <section class="dk-form-section"><h4>基本信息</h4>
                ${field('标题', `<input class="dk-input" name="title" required maxlength="200" value="${esc(draft.title)}" placeholder="例如：OSPF 邻居状态机">`, { required: true })}
                <div class="dk-field-row">${field('目录短标题', `<input class="dk-input" name="shortTitle" maxlength="40" value="${esc(draft.shortTitle || '')}" placeholder="可留空">`, { hint: '左侧目录显示' })}
                    ${field('排序', `<input class="dk-input" type="number" name="sort" value="${draft.sort || 0}">`, { hint: '数字越小越靠前' })}</div>
                ${field('分类', `<select class="dk-input" name="categoryId">${categoryOptions(draft.categoryId)}</select>`)}
                <div class="dk-field"><span class="dk-field-label">难度</span><div class="dk-star-pick" data-stars>${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" class="${n <= draft.difficulty ? 'is-on' : ''}" aria-label="难度 ${n}">★</button>`).join('')}<em>${levelName(draft.difficulty)}</em></div><input type="hidden" name="difficulty" value="${draft.difficulty}"></div>
                <div class="dk-field"><span class="dk-field-label">标签</span><div class="dk-chip-input" data-tags><input placeholder="输入后回车添加"></div></div>
                ${field('来源', `<input class="dk-input" name="source" value="${esc(draft.source)}" placeholder="例如：Obsidian / OSPF 笔记.md">`)}
            </section>
            <section class="dk-form-section"><h4>导读</h4>
                ${field('一句话摘要', `<textarea class="dk-input" name="summary" rows="2" placeholder="用一句话说明这篇笔记讲什么">${esc(draft.summary)}</textarea>`)}
                ${field('核心要点', `<textarea class="dk-input" name="keyPoints" rows="4" placeholder="每行一条">${esc(draft.keyPoints.join('\n'))}</textarea>`, { hint: '每行一条，显示在正文前' })}
            </section>
            <section class="dk-form-section"><h4>关联 <span class="dk-mini-note" data-rel-count></span></h4>
                <div class="dk-field"><span class="dk-field-label">分步图解 / 动手计算</span><div class="dk-pick-grid">${visuals.map(visual => `<label class="dk-pick"><input type="checkbox" name="visuals" value="${visual.id}"${draft.visuals.includes(visual.id) ? ' checked' : ''}><span>${esc(visual.title.split(' · ')[0])}</span></label>`).join('') || '<span class="dk-mini-note">暂无</span>'}</div></div>
                <div class="dk-field"><span class="dk-field-label">关联笔记</span><input class="dk-input slim" data-rel-filter placeholder="筛选笔记…"><div class="dk-pick-list">${others.map(item => `<label class="dk-pick-row" data-rel-row="${esc(item.title.toLowerCase())}"><input type="checkbox" name="related" value="${item.id}"${draft.related.includes(item.id) ? ' checked' : ''}><span>${esc(item.title)}</span></label>`).join('')}</div></div>
            </section>
        </aside>
        <section class="dk-editor2-body">
            <div class="dk-editor2-bar"><div class="dk-seg-pill">${[['src', '✏️ 编辑'], ['split', '◫ 分屏'], ['preview', '👁 预览']].map(([key, label]) => `<button type="button" data-etab="${key}" class="${key === 'split' ? 'is-active' : ''}">${label}</button>`).join('')}</div><span class="dk-mini-note" data-md-count></span></div>
            <div class="dk-editor2-panes is-split"><textarea class="dk-input dk-md-input" name="bodyMd" spellcheck="false" placeholder="# 标题&#10;&#10;正文支持 Markdown、Mermaid、[[双链]]">${esc(draft.bodyMd)}</textarea><div class="dk-markdown dk-md-preview"></div></div>
        </section>
    </form>`;
    const footer = `${article ? '<button type="button" class="dk-btn ghost danger" data-delete>🗑 删除文章</button>' : ''}<span class="dk-modal-status" data-dirty></span>
        <button type="button" class="dk-btn ghost" data-cancel>取消</button><button type="submit" form="articleForm" class="dk-btn">${article ? '保存修改' : '创建文章'}</button>`;
    const { root, close } = openModal(article ? `编辑：${article.title}` : '新建文章', body, { size: 'xl', icon: article ? '✏️' : '＋', subtitle: article ? `v${article.revision} · 保存后生成新版本，可在历史中回溯（Ctrl/⌘ + S 保存）` : '左侧填写基本信息，右侧编写正文并实时预览（Ctrl/⌘ + S 保存）', footer });
    const form = root.querySelector('form');
    const readTags = bindChipInput(root.querySelector('[data-tags]'), draft.tags);
    const preview = root.querySelector('.dk-md-preview');
    const panes = root.querySelector('.dk-editor2-panes');
    let dirty = false;
    let previewTimer = null;
    const renderPreview = () => { if (panes.classList.contains('is-src')) return; renderMarkdown(preview, form.bodyMd.value, { findArticle: findArticleByTitle }); renderMermaid(preview, resolvedTheme() === 'dark'); };
    const updateCounts = () => {
        root.querySelector('[data-md-count]').textContent = `${form.bodyMd.value.length} 字符 · ${form.bodyMd.value.split('\n').length} 行`;
        root.querySelector('[data-rel-count]').textContent = `已选 ${form.querySelectorAll('[name="visuals"]:checked, [name="related"]:checked').length} 项`;
    };
    const markDirty = () => { dirty = true; root.querySelector('[data-dirty]').textContent = '● 有未保存的修改'; };
    renderPreview();
    updateCounts();
    form.addEventListener('input', event => {
        if (event.target.matches('[data-rel-filter]')) {
            const query = event.target.value.trim().toLowerCase();
            root.querySelectorAll('[data-rel-row]').forEach(row => { row.hidden = Boolean(query) && !row.dataset.relRow.includes(query); });
            return;
        }
        markDirty();
        if (event.target.name === 'bodyMd') { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 300); }
        updateCounts();
    });
    form.addEventListener('change', updateCounts);
    root.querySelectorAll('[data-etab]').forEach(button => button.addEventListener('click', () => {
        root.querySelectorAll('[data-etab]').forEach(other => other.classList.toggle('is-active', other === button));
        panes.className = `dk-editor2-panes is-${button.dataset.etab}`;
        renderPreview();
    }));
    root.querySelector('[data-stars]').addEventListener('click', event => {
        const n = Number(event.target.closest('[data-star]')?.dataset.star);
        if (!n) return;
        form.difficulty.value = n;
        root.querySelectorAll('[data-star]').forEach(button => button.classList.toggle('is-on', Number(button.dataset.star) <= n));
        root.querySelector('[data-stars] em').textContent = levelName(n);
        markDirty();
    });
    root.querySelector('[data-cancel]').addEventListener('click', () => { if (!dirty || confirm('放弃未保存的修改？')) close(); });
    const onSave = event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); form.requestSubmit(); } };
    document.addEventListener('keydown', onSave);
    modalDisposers.push(() => document.removeEventListener('keydown', onSave));
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
            title: form.title.value.trim(), shortTitle: form.shortTitle.value.trim(), categoryId: form.categoryId.value, difficulty: Number(form.difficulty.value), sort: Number(form.sort.value) || 0,
            tags: readTags(),
            summary: form.summary.value.trim(), keyPoints: form.keyPoints.value.split('\n').map(item => item.trim()).filter(Boolean),
            visuals: [...form.querySelectorAll('[name="visuals"]:checked')].map(input => input.value),
            related: [...form.querySelectorAll('[name="related"]:checked')].map(input => input.value),
            source: form.source.value.trim(), bodyMd: form.bodyMd.value
        };
        if (!payload.title) { form.title.focus(); return toast('请填写标题', 'bad'); }
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

// 导入：① 选择文件或粘贴 → ② 预览确认（逐篇改标题、选分类）→ 导入
function openImport() {
    const files = [];
    let drafts = [];
    const steps = step => `<ol class="dk-stepper">${['选择内容', '确认导入'].map((label, index) => `<li class="${index + 1 === step ? 'is-active' : index + 1 < step ? 'is-done' : ''}"><b>${index + 1 < step ? '✓' : index + 1}</b>${label}</li>`).join('')}</ol>`;
    const pickHtml = () => `${steps(1)}
        <div class="dk-drop" data-drop tabindex="0" role="button"><div class="dk-drop-icon">⇪</div><strong>拖拽 Markdown 文件到这里，或点击选择</strong><span>支持多选 .md / .markdown / .txt；Obsidian 合并文档会按 <code>&lt;!-- 文件 n/N：路径 --&gt;</code> 标记自动拆分</span><input type="file" accept=".md,.markdown,.txt" multiple hidden data-files></div>
        <div class="dk-file-list" data-file-list></div>
        <details class="dk-paste-box"${files.length ? '' : ' open'}><summary>或直接粘贴一篇文档</summary><textarea class="dk-input" rows="7" data-paste placeholder="# 标题&#10;&#10;正文……一个文件里有多个一级标题时会拆成多篇"></textarea></details>`;
    const pickFooter = '<span class="dk-modal-status">解析只做预览，不会写入知识库</span><button type="button" class="dk-btn ghost" data-cancel>取消</button><button type="button" class="dk-btn" data-parse>解析预览 →</button>';
    const { root, close } = openModal('导入 Markdown 知识', pickHtml(), { size: 'lg', icon: '⇪', subtitle: '把 Obsidian 或其他 Markdown 笔记批量导入为知识文章', footer: pickFooter });
    const bodyNode = root.querySelector('.dk-modal-body');
    const footNode = root.querySelector('.dk-modal-actions');
    const fmtSize = n => (n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
    const drawFiles = () => {
        const list = root.querySelector('[data-file-list]');
        if (list) list.innerHTML = files.map((file, index) => `<div class="dk-file-row"><span>📄</span><strong>${esc(file.name)}</strong><em>${fmtSize(file.size)}</em><button type="button" class="dk-icon-btn" data-file-remove="${index}" aria-label="移除">×</button></div>`).join('');
    };
    const addFiles = list => { [...list].forEach(file => { if (!files.some(item => item.name === file.name && item.size === file.size)) files.push(file); }); drawFiles(); };
    const showPick = () => { bodyNode.innerHTML = pickHtml(); footNode.innerHTML = pickFooter; drawFiles(); };
    const syncPicked = () => { const node = root.querySelector('[data-picked]'); if (node) node.textContent = root.querySelectorAll('[data-pick]:checked').length; };
    const showPreview = () => {
        bodyNode.innerHTML = `${steps(2)}
            <div class="dk-import-bar"><label class="dk-check"><input type="checkbox" checked data-check-all> 全选</label><span class="dk-mini-note">共解析 ${drafts.length} 篇，分类已按文件名和标题自动推荐</span>
                <div class="dk-import-bulk"><select class="dk-input slim" data-all>${categoryOptions(state.catalog.categories[0]?.id)}</select><button type="button" class="dk-btn small ghost" data-apply-all>全部放入此分类</button></div></div>
            <div class="dk-import-list">${drafts.map((draft, index) => `<div class="dk-import-row"><input type="checkbox" checked data-pick="${index}" aria-label="选择">
                <div class="dk-import-main"><input class="dk-input slim" data-title="${index}" value="${esc(draft.title)}"><small>${esc(draft.source || '粘贴内容')} · ${draft.bodyMd.length} 字符</small></div>
                <select class="dk-input slim" data-cat="${index}">${categoryOptions(guessCategory(draft))}</select></div>`).join('')}</div>`;
        footNode.innerHTML = '<button type="button" class="dk-btn ghost" data-back>← 返回</button><span class="dk-modal-status">导入后可在编辑器中补充摘要、要点和图解关联</span><button type="button" class="dk-btn" data-commit>导入选中（<b data-picked></b>）</button>';
        syncPicked();
    };
    root.addEventListener('click', async event => {
        if (event.target.closest('[data-cancel]')) return close();
        if (event.target.closest('[data-drop]') && !event.target.closest('input')) root.querySelector('[data-files]')?.click();
        const remove = event.target.closest('[data-file-remove]')?.dataset.fileRemove;
        if (remove !== undefined) { files.splice(Number(remove), 1); drawFiles(); }
        if (event.target.closest('[data-back]')) showPick();
        if (event.target.closest('[data-parse]')) {
            const sources = await Promise.all(files.map(async file => ({ name: file.name, content: await file.text() })));
            const pasted = root.querySelector('[data-paste]')?.value || '';
            if (pasted.trim()) sources.push({ name: 'pasted.md', content: pasted });
            if (!sources.length) return toast('请先选择文件或粘贴内容', 'bad');
            try { ({ drafts } = await api('/import/parse', { method: 'POST', body: { files: sources } })); } catch (error) { return toast(error.message, 'bad'); }
            if (!drafts.length) return toast('没有解析出任何文章', 'bad');
            showPreview();
        }
        if (event.target.closest('[data-apply-all]')) {
            const value = root.querySelector('[data-all]').value;
            root.querySelectorAll('[data-cat]').forEach(select => { select.value = value; });
        }
        if (event.target.closest('[data-check-all]')) { root.querySelectorAll('[data-pick]').forEach(box => { box.checked = event.target.checked; }); syncPicked(); }
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
    root.addEventListener('change', event => {
        if (event.target.matches('[data-files]')) { addFiles(event.target.files); event.target.value = ''; }
        if (event.target.matches('[data-pick]')) syncPicked();
    });
    root.addEventListener('dragover', event => { const drop = event.target.closest('[data-drop]'); if (drop) { event.preventDefault(); drop.classList.add('is-over'); } });
    root.addEventListener('dragleave', event => event.target.closest('[data-drop]')?.classList.remove('is-over'));
    root.addEventListener('drop', event => {
        const drop = event.target.closest('[data-drop]');
        if (!drop) return;
        event.preventDefault();
        drop.classList.remove('is-over');
        addFiles([...event.dataTransfer.files].filter(file => /\.(md|markdown|txt)$/i.test(file.name)));
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

// 分类管理：左栏领域，右栏该领域的分类；就地改名、新增，有文章的分类不可删除
function openManager() {
    let selected = state.catalog.domains[0]?.id || '__new';
    let editing = null;
    const ID_PATTERN = '[a-z0-9][a-z0-9-]{1,63}';
    const countIn = catId => state.catalog.articles.filter(article => article.categoryId === catId).length;
    const domainCount = domId => state.catalog.categories.filter(cat => cat.domainId === domId).reduce((sum, cat) => sum + countIn(cat.id), 0);
    const render = () => {
        const dom = state.catalog.domains.find(item => item.id === selected);
        const categories = dom ? state.catalog.categories.filter(cat => cat.domainId === dom.id) : [];
        const left = `<nav class="dk-mgr-domains">${state.catalog.domains.map(item => `<button type="button" class="${item.id === selected ? 'is-active' : ''}" data-pick-domain="${item.id}"><span>${esc(item.icon || '📚')}</span><strong>${esc(item.name)}</strong><em>${domainCount(item.id)}</em></button>`).join('')}
            <button type="button" class="dk-mgr-add${!dom ? ' is-active' : ''}" data-pick-domain="__new">＋ 新建领域</button></nav>`;
        let right;
        if (!dom) {
            right = `<form class="dk-mgr-pane" data-new-domain><h4>新建领域</h4><p class="dk-mini-note">领域是目录的第一层，例如「BGP 边界网关协议」。</p>
                <div class="dk-field-row is-icon">${field('图标', '<input class="dk-input" name="icon" maxlength="4" placeholder="🌐">')}${field('名称', '<input class="dk-input" name="name" required maxlength="80" placeholder="BGP 边界网关协议">', { required: true })}</div>
                ${field('ID', `<input class="dk-input" name="id" required pattern="${ID_PATTERN}" placeholder="bgp">`, { hint: '小写字母、数字和连字符，创建后不可修改', required: true })}
                ${field('描述', '<textarea class="dk-input" name="description" rows="2" placeholder="一句话介绍这个领域"></textarea>')}
                <div class="dk-mgr-actions"><button class="dk-btn">创建领域</button></div></form>`;
        } else {
            right = `<div class="dk-mgr-pane">
                <form class="dk-mgr-domain-form" data-edit-domain="${dom.id}"><div class="dk-field-row is-icon">${field('图标', `<input class="dk-input" name="icon" maxlength="4" value="${esc(dom.icon || '')}">`)}${field('领域名称', `<input class="dk-input" name="name" required maxlength="80" value="${esc(dom.name)}">`)}</div>
                    ${field('描述', `<input class="dk-input" name="description" maxlength="500" value="${esc(dom.description || '')}">`, { hint: `ID：${esc(dom.id)}` })}<div class="dk-mgr-actions"><button class="dk-btn small ghost">保存领域信息</button></div></form>
                <div class="dk-mgr-cats-head"><h4>分类 <span class="dk-mini-note">${categories.length} 个</span></h4></div>
                <ul class="dk-mgr-cats">${categories.map(cat => {
                    const count = countIn(cat.id);
                    if (editing === cat.id) return `<li class="is-editing"><form data-edit-cat="${cat.id}"><input class="dk-input slim" name="name" required maxlength="80" value="${esc(cat.name)}"><input class="dk-input slim" name="description" maxlength="500" value="${esc(cat.description || '')}" placeholder="描述（可选）"><button class="dk-btn small">保存</button><button type="button" class="dk-btn small ghost" data-cancel-cat>取消</button></form></li>`;
                    return `<li><div><strong>${esc(cat.name)}</strong><small><code>${esc(cat.id)}</code>${cat.description ? ` · ${esc(cat.description)}` : ''}</small></div><span class="dk-mgr-count">${count} 篇</span>
                        <button type="button" class="dk-btn small ghost" data-rename-cat="${cat.id}">改名</button><button type="button" class="dk-btn small ghost danger" data-del-cat="${cat.id}"${count ? ' disabled title="分类下还有文章，先移走文章才能删除"' : ''}>删除</button></li>`;
                }).join('') || '<li class="dk-mgr-empty">这个领域还没有分类</li>'}</ul>
                <form class="dk-mgr-new-cat" data-new-cat="${dom.id}"><input class="dk-input slim" name="name" required maxlength="80" placeholder="新分类名称，如 选路原则"><input class="dk-input slim" name="id" required pattern="${ID_PATTERN}" placeholder="ID，如 ${esc(dom.id)}-path"><button class="dk-btn small">＋ 添加分类</button></form></div>`;
        }
        return `<div class="dk-mgr">${left}${right}</div>`;
    };
    const { root, close } = openModal('管理领域与分类', render(), { size: 'lg', icon: '🗂', subtitle: '目录结构：领域 → 分类 → 笔记。改名不影响已有文章。', footer: '<span class="dk-modal-status">修改会立即保存</span><button type="button" class="dk-btn" data-close-mgr>完成</button>' });
    const bodyNode = root.querySelector('.dk-modal-body');
    const redraw = () => { bodyNode.innerHTML = render(); };
    const refresh = async () => { await reloadCatalog(); redraw(); };
    root.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.target;
        const data = Object.fromEntries(new FormData(form).entries());
        try {
            if (form.matches('[data-new-domain]')) {
                await api('/domains', { method: 'POST', body: { tenantId: state.tenantId, domain: { ...data, sort: 100 } } });
                selected = data.id;
                toast('领域已创建', 'ok');
            } else if (form.matches('[data-edit-domain]')) {
                const dom = domain(form.dataset.editDomain);
                await api(`/domains/${dom.id}`, { method: 'PUT', body: { tenantId: state.tenantId, domain: { ...dom, ...data } } });
                toast('已保存', 'ok');
            } else if (form.matches('[data-new-cat]')) {
                await api('/categories', { method: 'POST', body: { tenantId: state.tenantId, category: { ...data, domainId: form.dataset.newCat, sort: 100 } } });
                toast('分类已添加', 'ok');
            } else if (form.matches('[data-edit-cat]')) {
                const cat = category(form.dataset.editCat);
                await api(`/categories/${cat.id}`, { method: 'PUT', body: { tenantId: state.tenantId, category: { ...cat, ...data } } });
                editing = null;
                toast('已改名', 'ok');
            }
            await refresh();
        } catch (error) { toast(error.message, 'bad'); }
    });
    root.addEventListener('click', async event => {
        if (event.target.closest('[data-close-mgr]')) return close();
        const pick = event.target.closest('[data-pick-domain]')?.dataset.pickDomain;
        if (pick) { selected = pick; editing = null; return redraw(); }
        const rename = event.target.closest('[data-rename-cat]')?.dataset.renameCat;
        if (rename) { editing = rename; redraw(); root.querySelector('[data-edit-cat] input')?.focus(); return; }
        if (event.target.closest('[data-cancel-cat]')) { editing = null; return redraw(); }
        const id = event.target.closest('[data-del-cat]')?.dataset.delCat;
        if (!id || !confirm(`确定删除分类「${category(id)?.name || id}」吗？`)) return;
        try {
            await api(`/categories/${id}?tenantId=${encodeURIComponent(state.tenantId)}`, { method: 'DELETE' });
            toast('已删除', 'ok');
            await refresh();
        } catch (error) { toast(error.message, 'bad'); }
    });
}

function openRfcModal(code, title) {
    const def = rfcLesson(code, title);
    if (!def) return toast('无法解析该报文图', 'bad');
    const { root } = openModal(def.title, '<div class="dk-stage-host is-modal" data-modal-stage></div>', { wide: true });
    const handle = createTeachingStage(root.querySelector('[data-modal-stage]'), def);
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
    if (parts[0] === 'outline' || parts[0] === 'coverage') return { name: 'outline', id: parts[1] ? decodeURIComponent(parts[1]) : null };
    if (parts[0] === 'notes') return { name: 'notes', id: parts[1] ? decodeURIComponent(parts[1]) : null };
    if (parts[0] === 'outline-list') return { name: 'coverage', id: parts[1] ? decodeURIComponent(parts[1]) : null };
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
    document.dispatchEvent(new CustomEvent('dk:route', { detail: { route: next } }));
    state.sidebarOpen = false;
    document.body.classList.remove('is-nav-open');
    $('#searchResults').hidden = true;
    state.aiNotes?.setSuspended(next.name === 'notes');
    renderSidebar();
    if (next.name === 'home') renderHome();
    if (next.name === 'labs') renderLabs();
    if (next.name === 'lab') renderLab(next.id);
    if (next.name === 'map') renderMap();
    if (next.name === 'outline') renderOutline(next.id);
    if (next.name === 'notes') renderNotes(next.id);
    if (next.name === 'coverage') renderCoverage(next.id);
    if (next.name === 'article') renderArticle(next.id);
    if (next.name !== 'article') window.scrollTo(0, 0);
}

async function reloadCatalog() {
    const data = await api('');
    state.catalog = { domains: data.domains, categories: data.categories, articles: data.articles, learningPath: data.learningPath, outline: data.outline || [] };
    state.canWrite = data.canWrite;
    state.tenantId = data.tenantId;
    state.username = data.username;
    state.databaseFile = data.databaseFile;
    if (data.preference) {
        applyServerPreference(data.preference);
    }
    renderSidebar();
}

// ---------- 左侧目录：拖动调宽，拖过最小宽度自动收起 ----------
const NAV_WIDTH_KEY = 'dk_nav_width';
const NAV_COLLAPSED_KEY = 'dk_nav_collapsed';
const NAV_UPDATED_AT_KEY = 'dk_nav_updated_at';
const NAV_MIN = 200;
const NAV_COLLAPSE_AT = 140;
const navMax = () => Math.max(NAV_MIN, Math.min(600, Math.round(window.innerWidth * 0.5)));
let savedNavWidth = 290;
let navWidth = 290;
let snapTimer = 0;
let syncPrefTimer = 0;

function syncPreferenceToServer(width, collapsed) {
    if (snapshotApi) return;
    clearTimeout(syncPrefTimer);
    syncPrefTimer = setTimeout(async () => {
        try {
            await api('/preference', {
                method: 'PUT',
                body: {
                    tenantId: state.tenantId,
                    navWidth: width !== undefined ? width : savedNavWidth,
                    navCollapsed: collapsed !== undefined ? collapsed : document.body.classList.contains('is-nav-collapsed')
                }
            });
        } catch (err) {
            console.warn('[dk-preference] 同步偏好至服务端失败:', err);
        }
    }, 280);
}

function applyServerPreference(serverPref) {
    if (!serverPref || typeof serverPref !== 'object') return;
    const sWidth = Number(serverPref.navWidth);
    const sCollapsed = Boolean(serverPref.navCollapsed);
    const sUpdated = serverPref.updatedAt ? new Date(serverPref.updatedAt).getTime() : 0;

    const localWidthRaw = localStorageGet(NAV_WIDTH_KEY);
    const localUpdatedRaw = localStorageGet(NAV_UPDATED_AT_KEY);
    const localUpdated = localUpdatedRaw ? new Date(localUpdatedRaw).getTime() : 0;
    const hasLocal = localWidthRaw !== null && localWidthRaw !== undefined && localWidthRaw !== '';

    // 1. 本地无记录（首次访问 / 换浏览器 / 隐身窗口 / 清空缓存），或服务端更新时间晚于本地
    if (!hasLocal || (sUpdated && (!localUpdated || sUpdated > localUpdated))) {
        if (sWidth && sWidth >= NAV_MIN && sWidth <= 900) {
            savedNavWidth = sWidth;
            setNavWidth(sWidth, true, false);
        }
        setNavCollapsed(sCollapsed, true, false);
        if (sUpdated) localStorageSet(NAV_UPDATED_AT_KEY, new Date(sUpdated).toISOString());
        return;
    }

    // 2. 本地有调整且比服务端更新，反向同步至服务器
    if (hasLocal && (!sUpdated || (localUpdated && localUpdated > sUpdated))) {
        syncPreferenceToServer(savedNavWidth, document.body.classList.contains('is-nav-collapsed'));
    }
}

function setNavWidth(width, persist = true, syncServer = false) {
    const target = Math.round(Math.max(NAV_MIN, Math.min(navMax(), width)));
    navWidth = target;
    document.documentElement.style.setProperty('--nav-w', `${navWidth}px`);
    if (persist) {
        savedNavWidth = target;
        const stamp = new Date().toISOString();
        localStorageSet(NAV_WIDTH_KEY, String(savedNavWidth));
        localStorageSet(NAV_UPDATED_AT_KEY, stamp);
        if (syncServer) syncPreferenceToServer(savedNavWidth);
    }
}

function setNavCollapsed(collapsed, persist = true, syncServer = false) {
    document.body.classList.toggle('is-nav-collapsed', collapsed);
    const label = collapsed ? '展开目录' : '收起目录';
    for (const button of [$('#navCollapse'), $('#navToggle')]) { button?.setAttribute('aria-label', label); button?.setAttribute('title', label); }
    $('#navResize')?.setAttribute('aria-expanded', String(!collapsed));
    if (persist) {
        const stamp = new Date().toISOString();
        localStorageSet(NAV_COLLAPSED_KEY, collapsed ? '1' : '0');
        localStorageSet(NAV_UPDATED_AT_KEY, stamp);
        if (syncServer) syncPreferenceToServer(undefined, collapsed);
    }
}

// 拖动中跨过收起阈值时，短暂恢复过渡，让收起/展开同样平滑。
function snapNav() {
    document.body.classList.add('is-nav-snapping');
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => document.body.classList.remove('is-nav-snapping'), 320);
}

function bindSidebarResize() {
    const handle = $('#navResize');
    if (!handle) return;
    const initialLocalWidth = Number(localStorageGet(NAV_WIDTH_KEY));
    savedNavWidth = initialLocalWidth && initialLocalWidth >= NAV_MIN ? initialLocalWidth : 290;
    setNavWidth(savedNavWidth, false, false);
    setNavCollapsed(localStorageGet(NAV_COLLAPSED_KEY) === '1', false, false);
    // 画布类视图（思维导图）只监听窗口尺寸，布局过渡结束后补发一次。
    $('.dk-layout').addEventListener('transitionend', event => { if (event.propertyName === 'grid-template-columns') window.dispatchEvent(new Event('resize')); });
    $('#navCollapse').addEventListener('click', event => { event.stopPropagation(); setNavCollapsed(!document.body.classList.contains('is-nav-collapsed'), true, true); });
    $('#navCollapse').addEventListener('pointerdown', event => event.stopPropagation());
    handle.addEventListener('dblclick', event => { if (!event.target.closest('#navCollapse')) setNavCollapsed(!document.body.classList.contains('is-nav-collapsed'), true, true); });
    handle.addEventListener('keydown', event => {
        if (event.target !== handle) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setNavCollapsed(!document.body.classList.contains('is-nav-collapsed'), true, true); }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const step = event.key === 'ArrowLeft' ? -24 : 24;
            if (document.body.classList.contains('is-nav-collapsed')) { if (step > 0) setNavCollapsed(false, true, true); }
            else if (step < 0 && navWidth <= NAV_MIN) setNavCollapsed(true, true, true);
            else setNavWidth(navWidth + step, true, true);
        }
    });
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        try { handle.setPointerCapture(event.pointerId); } catch (_) { /* 合成事件无捕获 */ }
        const body = document.body;
        const left = $('.dk-layout').getBoundingClientRect().left;
        const before = navWidth;
        let x = event.clientX, frame = 0;
        body.classList.add('is-nav-resizing');
        const apply = () => {
            frame = 0;
            const wanted = x - left;
            if (body.classList.contains('is-nav-collapsed')) {
                // 收起状态下向右拖过阈值即展开，展开宽度跟随指针
                if (wanted > NAV_COLLAPSE_AT + 20) { setNavWidth(wanted, false, false); setNavCollapsed(false, false, false); snapNav(); }
                return;
            }
            if (wanted < NAV_COLLAPSE_AT) {
                body.classList.remove('is-nav-will-collapse');
                setNavWidth(before, false, false);
                setNavCollapsed(true, false, false);
                snapNav();
                return;
            }
            // 低于最小宽度时带阻尼，提示继续拖动将收起
            const below = wanted < NAV_MIN;
            body.classList.toggle('is-nav-will-collapse', below);
            if (below) { navWidth = NAV_MIN; document.documentElement.style.setProperty('--nav-w', `${Math.round(NAV_MIN - (NAV_MIN - wanted) * 0.35)}px`); }
            else setNavWidth(wanted, false, false);
        };
        const move = moveEvent => { x = moveEvent.clientX; if (!frame) frame = requestAnimationFrame(apply); };
        const up = () => {
            if (frame) { cancelAnimationFrame(frame); apply(); }   // 松手前落实最后一次位置
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            document.removeEventListener('pointercancel', up);
            const springBack = body.classList.contains('is-nav-will-collapse');
            body.classList.remove('is-nav-resizing', 'is-nav-will-collapse', 'is-nav-snapping');
            setNavWidth(navWidth, true, true);   // 阻尼区松手时平滑回弹到最小宽度，持久化本地并同步服务器
            setNavCollapsed(body.classList.contains('is-nav-collapsed'), true, true);
            if (!springBack) window.dispatchEvent(new Event('resize'));
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
    });
    window.addEventListener('resize', () => {
        const max = navMax();
        if (navWidth > max) {
            navWidth = max;
            document.documentElement.style.setProperty('--nav-w', `${navWidth}px`);
        } else if (navWidth < savedNavWidth && savedNavWidth <= max) {
            navWidth = savedNavWidth;
            document.documentElement.style.setProperty('--nav-w', `${navWidth}px`);
        }
    });
}

function bindGlobalEvents() {
    window.addEventListener('hashchange', route);
    $('#themeBtn').addEventListener('click', () => {
        const order = ['system', 'light', 'dark'];
        const current = themePreference();
        localStorageSet(THEME_KEY, order[(order.indexOf(current) + 1) % order.length]);
        applyTheme();
        if (state.route?.name === 'article') renderArticle(state.route.id);
    });
    const followSystemTheme = () => {
        if (themePreference() !== 'system') return;
        applyTheme();
        if (state.route?.name === 'article') renderArticle(state.route.id);
    };
    if (systemThemeMedia?.addEventListener) systemThemeMedia.addEventListener('change', followSystemTheme);
    else systemThemeMedia?.addListener?.(followSystemTheme);
    $('#navToggle').addEventListener('click', () => {
        if (window.innerWidth <= 860) document.body.classList.toggle('is-nav-open');
        else setNavCollapsed(!document.body.classList.contains('is-nav-collapsed'), true, true);
    });
    bindSidebarResize();
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
        const navMode = event.target.closest('[data-nav-mode]')?.dataset.navMode;
        if (navMode) {
            localStorageSet(NAV_MODE_KEY, navMode);
            if (navMode === 'notes') { state.notesIndex = null; if (state.route?.name !== 'notes') location.hash = '#/notes'; else renderSidebar(); }
            else renderSidebar();
        }
        const covFilter = event.target.closest('[data-cov-filter]')?.dataset.covFilter;
        if (covFilter) { state.coverageFilter = covFilter; renderCoverage(); }
        const outlineEdit = event.target.closest('[data-outline-edit]')?.dataset.outlineEdit;
        if (outlineEdit) openOutlineEditor({ id: outlineEdit });
        const outlineNew = event.target.closest('[data-outline-new]');
        if (outlineNew) openOutlineEditor({ domainId: outlineNew.dataset.outlineNew, parentId: outlineNew.dataset.parent || null });
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
    // 视频清单与总览播放器共用一次请求，目录不阻塞知识库首屏。
    loadVideoManifest({ offline: Boolean(snapshotApi) }).then(videos => {
        state.videos = videos || {};
        renderSidebar();
    });
    // 平台注入的语言开关放入导航栏，避免固定浮钮覆盖图表操作。
    const languageButton = document.getElementById('toolsCustomLanguageButton');
    if (languageButton) document.querySelector('.dk-topbar').appendChild(languageButton);
    // AI 问答与笔记（只读快照中不可用）
    state.aiNotes = initAiNotes({
        readOnly: Boolean(snapshotApi), state, VISUALS, toast, findArticle: findArticleByTitle,
        async reloadArticle(id) {
            state.articles.delete(id);
            await reloadCatalog();
            if (state.route?.name === 'article' && state.route.id === id) renderArticle(id);
        }
    });
    if (snapshotApi) document.getElementById('aiPanelBtn')?.remove();
    // 问答/笔记有增删改时，侧栏索引同步刷新
    document.addEventListener('dk:annotations-changed', () => { if (state.notesIndex) refreshNotesIndex(); });
    route();
}

boot();
