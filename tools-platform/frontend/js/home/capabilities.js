// 首页「插件与脚本」：藏在各工具内部的小功能（F12 插件、Python 脚本、数据抓取浮窗脚本……）。
// 目录来自 /api/home/capabilities（backend/models/home-capabilities.js），各类脚本仓库新增条目后这里自动出现。
// 工具模式：侧栏分类下方一组入口 + 主区工具网格后的分组卡片，跟随工具搜索框过滤；
// 对话模式：通过 window.HomeCapabilities 提供给 Dragon Claw 的推荐轮播与上下文（js/home/dragon-claw.js）。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            title: '插件与脚本', subtitle: '藏在各工具里的小功能，新增脚本或插件后会自动出现在这里', count: '{n} 项',
            where: '在哪里：{where}', open: '打开', openAll: '前往', badgeExtension: '完整扩展', badgeServer: '服务器脚本',
            badgeScript: 'F12 脚本', scripts: '{n} 个脚本', entrySub: '{n} 个藏在工具里的小功能'
        },
        'en-US': {
            title: 'Plugins & scripts', subtitle: 'Small features tucked inside tools. New scripts and plugins appear here automatically.', count: '{n}',
            where: 'Where: {where}', open: 'Open', openAll: 'Go', badgeExtension: 'Extension', badgeServer: 'Server script',
            badgeScript: 'F12 script', scripts: '{n} scripts', entrySub: '{n} features tucked inside tools'
        }
    };

    const state = { groups: [], loaded: false, filter: { view: 'all', query: '' } };
    const el = {};
    let readyResolve;
    const ready = new Promise(resolve => { readyResolve = resolve; });

    function lang() {
        return window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN';
    }

    function tx(key, params = {}) {
        const template = TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
        return Object.keys(params).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), template);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function authHeaders() {
        try {
            const token = localStorage.getItem('tools_token');
            return token ? { Authorization: `Bearer ${token}` } : {};
        } catch {
            return {};
        }
    }

    function normalize(value) {
        return typeof normalizeNavSearchTerm === 'function'
            ? normalizeNavSearchTerm(value)
            : String(value ?? '').toLocaleLowerCase().replace(/\s+/g, '');
    }

    function itemName(item) {
        return lang() === 'en-US' ? item.nameEn || item.name : item.name;
    }

    function groupLabel(group) {
        return lang() === 'en-US' ? group.labelEn || group.label : group.label;
    }

    function groupWhere(group) {
        return lang() === 'en-US' ? group.whereEn || group.where : group.where;
    }

    function badgeText(item) {
        if (item.kind === 'f12') return tx(item.badge === 'extension' ? 'badgeExtension' : item.badge === 'server' ? 'badgeServer' : 'badgeScript');
        if (item.kind === 'float') return tx('scripts', { n: item.badge });
        return item.badge || '';
    }

    function matches(item, group, query) {
        if (!query) return true;
        const q = normalize(query);
        return [itemName(item), item.name, item.description, groupLabel(group)].some(text => normalize(text).includes(q));
    }

    // F12 服务器脚本 / Python 脚本可「转为内置」；打包器源码自带的条目显示为已内置且不能取消（js/home/builtin-promotion.js）
    function promotionButton(group, item) {
        if (!window.BuiltinPromotion || !['f12', 'python'].includes(group.kind)) return '';
        if (!item.promoteId && !item.builtInLocked) return '';
        return window.BuiltinPromotion.button(group.kind, item.promoteId || item.id, {
            builtIn: item.builtIn === true, locked: item.builtInLocked === true, name: itemName(item), className: 'home-cap-builtin'
        });
    }

    // ── 侧栏入口 ──
    function renderNav() {
        if (!el.nav) return;
        el.nav.hidden = !state.groups.length;
        el.nav.innerHTML = state.groups.length ? [
            `<div class="home-cat-label">${escapeHtml(tx('title'))}</div>`,
            ...state.groups.map(group => `
                <button type="button" class="home-cat-item" data-cap-kind="${escapeHtml(group.kind)}" title="${escapeHtml(groupLabel(group))}" style="--group-color:${escapeHtml(group.color || '#64ffda')}">
                    <span class="home-cat-icon home-cap-icon" aria-hidden="true">${escapeHtml(group.icon)}</span>
                    <span class="home-cat-name">${escapeHtml(groupLabel(group))}</span>
                    <span class="home-cat-count">${group.count}</span>
                </button>`)
        ].join('') : '';
    }

    // ── 主区分组卡片 ──
    function renderSection() {
        if (!el.section) return;
        if (!state.groups.length) {
            el.section.hidden = true;
            el.section.innerHTML = '';
            return;
        }
        const total = state.groups.reduce((sum, group) => sum + group.count, 0);
        el.section.innerHTML = `
            <header class="home-caps-head">
                <div class="home-caps-heading">
                    <h2 class="home-caps-title" id="homeCapsTitle">${escapeHtml(tx('title'))}</h2>
                    <span class="home-caps-count" data-caps-total>${escapeHtml(tx('count', { n: total }))}</span>
                </div>
                <p class="home-caps-sub">${escapeHtml(tx('subtitle'))}</p>
            </header>
            ${state.groups.map(group => `
                <div class="home-caps-group" data-cap-group="${escapeHtml(group.kind)}" style="--cap-color:${escapeHtml(group.color || '#64ffda')}">
                    <div class="home-caps-group-head">
                        <span class="home-group-dot" aria-hidden="true"></span>
                        <span class="home-caps-group-name">${escapeHtml(groupLabel(group))}</span>
                        <span class="home-group-count" data-cap-count>${group.count}</span>
                        <span class="home-caps-where">${escapeHtml(tx('where', { where: groupWhere(group) }))}</span>
                        <a class="home-caps-go" href="${escapeHtml(group.href)}">${escapeHtml(tx('openAll'))} <span aria-hidden="true">›</span></a>
                    </div>
                    <div class="home-caps-grid">
                        ${group.items.map((item, index) => `
                            <a class="home-cap-card" href="${escapeHtml(item.href)}" data-cap-index="${index}" title="${escapeHtml(`${itemName(item)} · ${tx('where', { where: groupWhere(group) })}`)}">
                                <span class="home-cap-card-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>
                                <span class="home-cap-card-body">
                                    <span class="home-cap-card-title"><span class="home-cap-card-name">${escapeHtml(itemName(item))}</span>${badgeText(item) ? `<span class="home-cap-badge">${escapeHtml(badgeText(item))}</span>` : ''}</span>
                                    <span class="home-cap-card-desc">${escapeHtml(item.description)}</span>
                                </span>
                                ${promotionButton(group, item)}
                                <span class="home-cap-card-arrow" aria-hidden="true">↗</span>
                            </a>`).join('')}
                    </div>
                </div>`).join('')}`;
        applyFilter();
    }

    function applyFilter() {
        if (!el.section || !state.groups.length) return;
        const { view, query } = state.filter;
        // 「最近使用」只看工具；全部视图与搜索时显示插件与脚本
        const hiddenByView = view === 'recent' && !query;
        let visibleTotal = 0;
        state.groups.forEach(group => {
            const node = el.section.querySelector(`[data-cap-group="${CSS.escape(group.kind)}"]`);
            if (!node) return;
            let visible = 0;
            node.querySelectorAll('[data-cap-index]').forEach(card => {
                const show = matches(group.items[Number(card.dataset.capIndex)], group, query);
                card.hidden = !show;
                if (show) visible += 1;
            });
            node.hidden = visible === 0;
            const count = node.querySelector('[data-cap-count]');
            if (count) count.textContent = String(visible);
            visibleTotal += visible;
        });
        el.section.hidden = hiddenByView || visibleTotal === 0;
        const total = el.section.querySelector('[data-caps-total]');
        if (total) total.textContent = tx('count', { n: visibleTotal });
        // 工具都没匹配、但插件与脚本有匹配时，不显示「没有匹配的工具」
        const empty = document.getElementById('homeToolsEmpty');
        if (empty && query && visibleTotal > 0) empty.hidden = true;
    }

    // 对话首页「插件与脚本」入口（与项目知识图谱并排）
    function renderEntry() {
        if (!el.entry) return;
        const total = state.groups.reduce((sum, group) => sum + group.count, 0);
        el.entry.hidden = total === 0;
        const title = el.entry.querySelector('[data-caps-entry-title]');
        const sub = el.entry.querySelector('[data-caps-entry-sub]');
        if (title) title.textContent = tx('title');
        if (sub) sub.textContent = tx('entrySub', { n: total });
    }

    function navbarOffset() {
        const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-h'));
        return (Number.isFinite(value) ? value : 52) + 16;
    }

    function scrollToGroup(kind) {
        window.HomeMode?.set?.('tools');
        window.HomeWorkspace?.showAll?.();
        requestAnimationFrame(() => {
            const target = kind ? el.section?.querySelector(`[data-cap-group="${CSS.escape(kind)}"]`) : el.section;
            if (!target || el.section.hidden) return;
            const top = target.getBoundingClientRect().top + window.scrollY - navbarOffset();
            window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        });
    }

    // 滚动到插件与脚本区块时，侧栏高亮对应类别（工具分类的高亮由 workspace.js 维护，这里接管区块范围内的部分）
    function syncCurrentGroup() {
        if (!el.nav || !el.section || el.section.hidden || !document.body.classList.contains('home-mode-tools')) return;
        const offset = navbarOffset() + 24;
        let current = '';
        el.section.querySelectorAll('[data-cap-group]:not([hidden])').forEach(node => {
            if (node.getBoundingClientRect().top <= offset) current = node.dataset.capGroup;
        });
        el.nav.querySelectorAll('[data-cap-kind]').forEach(button => button.classList.toggle('is-current', button.dataset.capKind === current));
        if (current) document.querySelectorAll('#homeCategoryNav .is-current').forEach(button => button.classList.remove('is-current'));
    }

    async function load() {
        try {
            const res = await fetch(`/api/home/capabilities?lang=${encodeURIComponent(lang())}`, { headers: authHeaders() });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            state.groups = Array.isArray(data.groups) ? data.groups.filter(group => Array.isArray(group.items) && group.items.length) : [];
        } catch {
            state.groups = []; // 目录是辅助信息，读取失败时首页照常显示
        }
        state.loaded = true;
        renderNav();
        renderSection();
        renderEntry();
        readyResolve(state.groups);
        window.dispatchEvent(new CustomEvent('home:capabilities', { detail: { groups: state.groups } }));
    }

    // 扁平条目（带所属分类信息），供 Dragon Claw 推荐与上下文使用
    function items() {
        return state.groups.flatMap(group => group.items.map(item => ({
            ...item,
            displayName: itemName(item),
            groupLabel: groupLabel(group),
            where: groupWhere(group),
            color: group.color
        })));
    }

    window.HomeCapabilities = {
        ready: () => ready,
        items,
        groups: () => state.groups,
        total: () => state.groups.reduce((sum, group) => sum + group.count, 0),
        show: kind => scrollToGroup(kind),
        reload: () => load()
    };

    function init() {
        el.nav = document.getElementById('homeCapsNav');
        el.section = document.getElementById('homeCaps');
        el.entry = document.getElementById('homeCapsEntry');
        el.entry?.addEventListener('click', () => scrollToGroup(''));
        state.filter = window.HomeWorkspace?.getFilter?.() || state.filter;
        el.nav?.addEventListener('click', event => {
            const button = event.target.closest('[data-cap-kind]');
            if (button) scrollToGroup(button.dataset.capKind);
        });
        let scrollQueued = false;
        window.addEventListener('scroll', () => {
            if (scrollQueued) return;
            scrollQueued = true;
            requestAnimationFrame(() => {
                scrollQueued = false;
                syncCurrentGroup();
            });
        }, { passive: true });
        window.addEventListener('home:tools-filtered', event => {
            state.filter = { view: event.detail?.view || 'all', query: event.detail?.query || '' };
            applyFilter();
        });
        // 浮窗脚本等描述由后端按语言生成，切换语言时重新读取
        window.addEventListener('tools:languagechange', () => { if (state.loaded) load(); });
        load();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
