// 首页工具模式：左侧分类与搜索，右侧按分类分组铺满的卡片网格，卡片底部显示「上次更新」。
// 卡片仍由 index.html 渲染（内置为静态 HTML，自定义工具由 renderCustomToolCards 生成）；
// 这里只做增强：分组排序、筛选、更新时间，不改动卡片自身的数据和事件。
// 分类沿用导航设置（navbar.js 的 navState.settings），在导航中调整分类后首页同步变化。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            all: '全部工具', recent: '最近使用', groups: '分类', other: '其他',
            searchPlaceholder: '搜索工具 / 拼音首字母', empty: '没有匹配的工具', emptyRecent: '还没有最近使用的工具',
            updated: '{time}更新', justNow: '刚刚', minutes: '{n} 分钟前', hours: '{n} 小时前', days: '{n} 天前',
            updatedTitle: '上次更新：{time}', searchTitle: '搜索“{q}”', toolCount: '{n} 个工具'
        },
        'en-US': {
            all: 'All tools', recent: 'Recent', groups: 'Categories', other: 'Other',
            searchPlaceholder: 'Search tools', empty: 'No matching tools', emptyRecent: 'No recently used tools yet',
            updated: 'Updated {time}', justNow: 'just now', minutes: '{n}m ago', hours: '{n}h ago', days: '{n}d ago',
            updatedTitle: 'Last updated: {time}', searchTitle: 'Search “{q}”', toolCount: '{n} tools'
        }
    };
    const GROUP_COLORS = ['#38bdf8', '#34d399', '#a78bfa', '#f59e0b', '#f472b6', '#22d3ee', '#fb7185', '#a3e635', '#818cf8', '#fbbf24'];
    const CLOCK_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

    const state = { view: 'all', query: '', currentGroup: '' };
    const updates = { pages: {}, tools: {}, toolsLoaded: false, toolsLoading: null };
    let grid;
    let sidebarNav;
    let searchInput;
    let emptyEl;
    let headTitle;
    let headCount;
    let groups = [];
    let layoutQueued = false;

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

    function navSettings() {
        return typeof navState !== 'undefined' && navState?.settings ? navState.settings : { categories: [], categoryByItem: {} };
    }

    function cardItemId(card) {
        if (card.dataset.customToolCard === '1') return `custom:${card.dataset.toolSlug}`;
        return String(card.getAttribute('href') || '').replace(/^\//, '');
    }

    function defaultCategory(card, itemId) {
        if (card.dataset.customToolCard === '1') return 'custom';
        const builtin = typeof NAV_BUILTIN_LINKS !== 'undefined' ? NAV_BUILTIN_LINKS.find(item => item.id === itemId) : null;
        return builtin?.defaultCategory || 'business';
    }

    function categoryName(category) {
        if (typeof getNavCategoryName === 'function') return getNavCategoryName(category);
        return lang() === 'en-US' && category.nameEn ? category.nameEn : category.name;
    }

    function cardText(card, selector) {
        return card.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || '';
    }

    function normalize(value) {
        return typeof normalizeNavSearchTerm === 'function'
            ? normalizeNavSearchTerm(value)
            : String(value ?? '').toLocaleLowerCase().replace(/\s+/g, '');
    }

    // 返回匹配度（越小越靠前），不匹配返回 -1：
    // 0 标题直接包含，1 标题拼音首字母/子序列（与导航搜索一致），2 描述或标签包含（长文本只做包含匹配，避免误命中）。
    function matchScore(card, query) {
        const title = cardText(card, '.card-title');
        const normalizedQuery = normalize(query);
        if (normalize(title).includes(normalizedQuery)) return 0;
        if (typeof buildNavSearchIndex === 'function' && typeof matchesNavSearch === 'function'
            && matchesNavSearch(buildNavSearchIndex({ label: title, id: cardItemId(card), href: card.getAttribute('href') }), query)) return 1;
        const extra = [cardText(card, '.card-desc'), ...[...card.querySelectorAll('.feature-tag')].map(tag => tag.textContent)].join(' ');
        return normalize(extra).includes(normalizedQuery) ? 2 : -1;
    }

    function formatRelative(iso) {
        const time = Date.parse(iso);
        if (!Number.isFinite(time)) return '';
        const diff = Math.max(0, Date.now() - time);
        const minute = 60 * 1000;
        let relative;
        if (diff < minute) relative = tx('justNow');
        else if (diff < 60 * minute) relative = tx('minutes', { n: Math.floor(diff / minute) });
        else if (diff < 24 * 60 * minute) relative = tx('hours', { n: Math.floor(diff / (60 * minute)) });
        else if (diff < 30 * 24 * 60 * minute) relative = tx('days', { n: Math.floor(diff / (24 * 60 * minute)) });
        // 绝对日期后补空格，中文显示为「2026/06/10 更新」而不是粘连在一起。
        else relative = `${new Date(time).toLocaleDateString(lang(), { year: 'numeric', month: '2-digit', day: '2-digit' })} `;
        return relative;
    }

    function updatedAtFor(card) {
        if (card.dataset.customToolCard === '1') return updates.tools[card.dataset.toolSlug] || '';
        return updates.pages[card.getAttribute('href')] || '';
    }

    function renderCardMeta(card) {
        let foot = card.querySelector(':scope > .card-foot');
        if (!foot) {
            foot = document.createElement('div');
            foot.className = 'card-foot';
            foot.innerHTML = '<span class="card-meta"></span>';
            card.appendChild(foot);
        }
        // renderToolImpact 会在 .card-features 之后补建 .card-impact；统一收进卡片底栏。
        const impact = card.querySelector(':scope > .card-impact') || foot.querySelector('.card-impact') || document.createElement('div');
        impact.classList.add('card-impact');
        if (impact.parentElement !== foot) foot.appendChild(impact);

        const meta = foot.querySelector('.card-meta');
        const updatedAt = updatedAtFor(card);
        if (!updatedAt) {
            meta.hidden = true;
            return;
        }
        meta.hidden = false;
        meta.innerHTML = `${CLOCK_SVG}<span>${escapeHtml(tx('updated', { time: formatRelative(updatedAt) }))}</span>`;
        meta.title = tx('updatedTitle', { time: new Date(updatedAt).toLocaleString(lang()) });
    }

    function buildGroups(cards) {
        const settings = navSettings();
        const known = new Map((settings.categories || []).map(category => [category.id, category]));
        const byGroup = new Map();
        cards.forEach(card => {
            const itemId = cardItemId(card);
            let groupId = settings.categoryByItem?.[itemId] || defaultCategory(card, itemId);
            if (!known.has(groupId)) groupId = known.has('custom') && card.dataset.customToolCard === '1' ? 'custom' : '__other';
            if (!byGroup.has(groupId)) byGroup.set(groupId, []);
            byGroup.get(groupId).push(card);
        });
        const ordered = [...known.values()].filter(category => byGroup.has(category.id))
            .map(category => ({ id: category.id, name: categoryName(category), cards: byGroup.get(category.id) }));
        if (byGroup.has('__other')) ordered.push({ id: '__other', name: tx('other'), cards: byGroup.get('__other') });
        const colorIndex = new Map((settings.categories || []).map((category, index) => [category.id, index]));
        ordered.forEach((group, index) => {
            group.color = GROUP_COLORS[(colorIndex.get(group.id) ?? index) % GROUP_COLORS.length];
        });
        return ordered;
    }

    function renderGroupHeads() {
        const existing = new Map([...grid.querySelectorAll(':scope > .home-group-head')].map(head => [head.dataset.group, head]));
        let order = 0;
        groups.forEach(group => {
            let head = existing.get(group.id);
            existing.delete(group.id);
            if (!head) {
                head = document.createElement('div');
                head.className = 'home-group-head';
                head.dataset.group = group.id;
                head.setAttribute('role', 'heading');
                head.setAttribute('aria-level', '2');
                grid.appendChild(head);
            }
            head.style.setProperty('--group-color', group.color);
            head.innerHTML = `<span class="home-group-dot"></span><span class="home-group-name">${escapeHtml(group.name)}</span><span class="home-group-count">${group.cards.length}</span>`;
            head.style.order = String(order++);
            group.head = head;
            group.cards.forEach(card => {
                card.dataset.groupOrder = String(order);
                card.style.order = String(order++);
                card.style.setProperty('--group-color', group.color);
            });
        });
        existing.forEach(head => head.remove());
    }

    function recentIds() {
        try {
            return typeof getRecentNavToolIds === 'function' ? getRecentNavToolIds() : [];
        } catch {
            return [];
        }
    }

    function renderSidebar() {
        if (!sidebarNav) return;
        const total = groups.reduce((sum, group) => sum + group.cards.length, 0);
        const cardIds = new Set(groups.flatMap(group => group.cards.map(cardItemId)));
        const recentCount = recentIds().filter(id => cardIds.has(id)).length;
        const item = (attrs, icon, name, count) => `
            <button type="button" class="home-cat-item" title="${escapeHtml(name)}" ${attrs}>
                <span class="home-cat-icon" aria-hidden="true">${icon}</span>
                <span class="home-cat-name">${escapeHtml(name)}</span>
                <span class="home-cat-count">${count}</span>
            </button>`;
        sidebarNav.innerHTML = [
            item('data-view="all"', '<svg viewBox="0 0 16 16"><path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>', tx('all'), total),
            item('data-view="recent"', CLOCK_SVG, tx('recent'), recentCount),
            `<div class="home-cat-label">${escapeHtml(tx('groups'))}</div>`,
            ...groups.map(group => item(`data-group="${escapeHtml(group.id)}" style="--group-color:${group.color}"`, '<span class="home-cat-dot"></span>', group.name, group.cards.length))
        ].join('');
        syncSidebarState();
    }

    // 首页分对话 / 工具两种互斥模式（js/home/home-mode.js），工具区只在工具模式下显示。
    function isToolsMode() {
        return document.body.classList.contains('home-mode-tools');
    }

    function syncSidebarState() {
        if (!sidebarNav) return;
        const browsing = state.view === 'all' && !state.query;
        sidebarNav.querySelectorAll('[data-view]').forEach(button => {
            const active = button.dataset.view === state.view && !state.query;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
        });
        sidebarNav.querySelectorAll('[data-group]').forEach(button => {
            button.classList.toggle('is-current', browsing && button.dataset.group === state.currentGroup);
        });
    }

    function renderToolsHead(visible) {
        if (!headTitle) return;
        const query = state.query.trim();
        headTitle.textContent = query ? tx('searchTitle', { q: query }) : tx(state.view === 'recent' ? 'recent' : 'all');
        if (headCount) headCount.textContent = tx('toolCount', { n: visible });
    }

    function applyFilter() {
        const query = state.query.trim();
        const recent = state.view === 'recent' && !query ? recentIds() : null;
        const flat = Boolean(recent || query);
        let visible = 0;
        groups.forEach(group => {
            let groupVisible = 0;
            group.cards.forEach(card => {
                // 搜索按匹配度排序、最近使用按使用先后排序，二者都不分组；浏览视图沿用 renderGroupHeads 的分组顺序。
                let rank = 0;
                if (query) rank = matchScore(card, query);
                else if (recent) rank = recent.indexOf(cardItemId(card));
                const show = rank >= 0;
                card.classList.toggle('is-filtered-out', !show);
                if (flat && show) card.style.order = String(rank * 1000 + Number(card.dataset.groupOrder || 0));
                if (show) groupVisible += 1;
            });
            group.head.hidden = flat || groupVisible === 0;
            visible += groupVisible;
        });
        grid.classList.toggle('is-flat', flat);
        if (emptyEl) {
            emptyEl.hidden = visible > 0;
            const text = emptyEl.querySelector('#homeToolsEmptyText');
            if (text) text.textContent = recent ? tx('emptyRecent') : tx('empty');
        }
        renderToolsHead(visible);
        syncSidebarState();
        // 插件与脚本区块（js/home/capabilities.js）跟随同一个搜索与视图过滤
        window.dispatchEvent(new CustomEvent('home:tools-filtered', { detail: { view: state.view, query, visible } }));
    }

    function layout() {
        layoutQueued = false;
        const cards = [...grid.querySelectorAll(':scope > a.tool-card')];
        cards.forEach(renderCardMeta);
        groups = buildGroups(cards);
        renderGroupHeads();
        renderSidebar();
        applyFilter();
        if (!updates.toolsLoaded || cards.some(card => card.dataset.customToolCard === '1' && !updates.tools[card.dataset.toolSlug])) {
            loadToolUpdates();
        }
        updateCurrentGroup();
        window.dispatchEvent(new CustomEvent('home:tools-updated'));
    }

    // 供 Dragon Claw 推荐工具使用：按分组顺序返回卡片上的工具信息。
    function getTools() {
        return groups.flatMap(group => group.cards.map(card => {
            const title = card.querySelector('.card-title')?.cloneNode(true);
            title?.querySelectorAll('.new-badge, .tool-kind-badge').forEach(node => node.remove());
            return {
                id: cardItemId(card),
                title: title?.textContent.replace(/\s+/g, ' ').trim() || '',
                description: cardText(card, '.card-desc'),
                href: card.getAttribute('href') || '',
                icon: cardText(card, '.card-icon'),
                tags: [...card.querySelectorAll('.feature-tag:not(.is-default)')].map(tag => tag.textContent.trim()).filter(Boolean),
                group: group.name,
                color: group.color,
                updatedAt: updatedAtFor(card),
                updatedText: updatedAtFor(card) ? formatRelative(updatedAtFor(card)) : ''
            };
        }));
    }

    window.HomeWorkspace = {
        getTools, recentIds, syncSidebar: () => syncSidebarState(), scrollToTools,
        getFilter: () => ({ view: state.view, query: state.query.trim() }),
        // 侧栏其它区块（插件与脚本）被点击时，退出「最近使用」/搜索，回到全部视图
        showAll: () => { if (state.view !== 'all' || state.query) setView('all'); }
    };

    // 微任务批量重排：在绘制前完成（避免卡片先乱序再跳位），且不像 rAF 那样在后台标签页被暂停。
    function scheduleLayout() {
        if (layoutQueued) return;
        layoutQueued = true;
        queueMicrotask(layout);
    }

    function navbarOffset() {
        const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--navbar-h'));
        return (Number.isFinite(value) ? value : 52) + 16;
    }

    function scrollToGroup(groupId) {
        const group = groups.find(item => item.id === groupId);
        if (!group?.head) return;
        const top = group.head.getBoundingClientRect().top + window.scrollY - navbarOffset();
        state.currentGroup = groupId;
        syncSidebarState();
        window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    function updateCurrentGroup() {
        if (state.view !== 'all' || state.query || !isToolsMode()) return;
        const offset = navbarOffset() + 24;
        let current = groups[0]?.id || '';
        groups.forEach(group => {
            if (group.head && !group.head.hidden && group.head.getBoundingClientRect().top <= offset) current = group.id;
        });
        if (current !== state.currentGroup) {
            state.currentGroup = current;
            syncSidebarState();
        }
    }

    function setView(view) {
        state.view = view;
        if (state.query) {
            state.query = '';
            if (searchInput) searchInput.value = '';
        }
        if (view === 'all') renderGroupHeads();
        applyFilter();
        scrollToTools();
    }

    // 工具模式下工具区就在页面顶部
    function scrollToTools() {
        window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }

    function showTools() {
        if (!isToolsMode()) window.HomeMode?.set?.('tools');
    }

    function onSearch() {
        state.query = searchInput.value;
        if (!state.query && state.view === 'all') renderGroupHeads();
        applyFilter();
    }

    function visibleCards() {
        return [...grid.querySelectorAll(':scope > a.tool-card:not(.is-filtered-out)')]
            .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0));
    }

    async function loadPageUpdates() {
        try {
            const res = await fetch('/api/home/page-updates', { headers: typeof getAuthHeaderForNav === 'function' ? getAuthHeaderForNav() : {} });
            if (res.ok) updates.pages = await res.json();
        } catch {
            // 更新时间是辅助信息，接口失败时卡片不显示即可。
        }
        scheduleLayout();
    }

    function loadToolUpdates() {
        if (updates.toolsLoading) return updates.toolsLoading;
        updates.toolsLoading = (async () => {
            try {
                const tools = typeof API !== 'undefined' ? await API.get('/api/custom-tools') : [];
                (Array.isArray(tools) ? tools : []).forEach(tool => {
                    updates.tools[tool.slug] = tool.updatedAt || tool.createdAt || '';
                });
            } catch {
                // 同上，静默降级
            }
            updates.toolsLoaded = true;
            grid.querySelectorAll(':scope > a.tool-card').forEach(renderCardMeta);
        })().finally(() => {
            setTimeout(() => { updates.toolsLoading = null; }, 30000);
        });
        return updates.toolsLoading;
    }

    function bindEvents() {
        sidebarNav?.addEventListener('click', event => {
            const button = event.target.closest('.home-cat-item');
            if (!button) return;
            showTools();
            if (button.dataset.view) {
                setView(button.dataset.view);
                return;
            }
            if (state.view !== 'all' || state.query) setView('all');
            scrollToGroup(button.dataset.group);
        });

        searchInput?.addEventListener('input', () => {
            showTools();
            onSearch();
        });
        searchInput?.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                searchInput.value = '';
                onSearch();
                searchInput.blur();
            } else if (event.key === 'Enter') {
                const first = visibleCards()[0];
                if (first) first.click();
            } else if (event.key === 'ArrowDown') {
                const first = visibleCards()[0];
                if (first) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });

        document.addEventListener('keydown', event => {
            if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target;
            if (target.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
            event.preventDefault();
            // 工具模式聚焦工具搜索，对话模式聚焦历史对话搜索
            const field = isToolsMode() ? searchInput : document.getElementById('homeChatSearch');
            field?.focus();
            field?.select();
        });

        // 卡片间方向键导航：按视觉顺序在可见卡片中移动焦点。
        grid.addEventListener('keydown', event => {
            if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
            const card = event.target.closest('a.tool-card');
            if (!card) return;
            const cards = visibleCards();
            const index = cards.indexOf(card);
            if (index < 0) return;
            const columns = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
            const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
            const next = cards[index + step];
            if (next) {
                event.preventDefault();
                next.focus();
            } else if (event.key === 'ArrowUp' && searchInput) {
                event.preventDefault();
                searchInput.focus();
            }
        });

        let scrollQueued = false;
        window.addEventListener('scroll', () => {
            if (scrollQueued) return;
            scrollQueued = true;
            requestAnimationFrame(() => {
                scrollQueued = false;
                updateCurrentGroup();
            });
        }, { passive: true });

        window.addEventListener('tools:languagechange', () => {
            if (searchInput) searchInput.placeholder = tx('searchPlaceholder');
            scheduleLayout();
        });
        // navbar 加载/保存导航设置后会派发该事件，借此同步分类。
        window.addEventListener('tools:requirement-page-categories-change', scheduleLayout);
        window.addEventListener('home:mode', () => {
            if (isToolsMode()) requestAnimationFrame(updateCurrentGroup);
        });

        new MutationObserver(records => {
            const cardsChanged = records.some(record => [...record.addedNodes, ...record.removedNodes]
                .some(node => node.nodeType === 1 && node.matches('a.tool-card')));
            if (cardsChanged) scheduleLayout();
        }).observe(grid, { childList: true });

        // 相对时间随时间推移刷新
        setInterval(() => grid.querySelectorAll(':scope > a.tool-card').forEach(renderCardMeta), 60 * 1000);
    }

    function init() {
        grid = document.getElementById('toolsGrid');
        if (!grid) return;
        sidebarNav = document.getElementById('homeCategoryNav');
        searchInput = document.getElementById('homeToolSearch');
        emptyEl = document.getElementById('homeToolsEmpty');
        headTitle = document.getElementById('homeToolsTitle');
        headCount = document.getElementById('homeToolsCount');
        if (searchInput) searchInput.placeholder = tx('searchPlaceholder');
        document.documentElement.classList.add('home-workspace-ready');
        bindEvents();
        layout();
        loadPageUpdates();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
