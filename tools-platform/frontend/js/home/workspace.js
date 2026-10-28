// 首页工具模式：左侧分类与搜索，右侧按分类分组铺满的卡片网格，卡片底部显示「上次更新」。
// 「全部工具」顶部依次是「最近使用」「收藏」两个快捷区（卡片副本），下面是各分类目录。
// 卡片右上角星标收藏；拖到收藏区即收藏；管理员可拖动卡片调整顺序和所属目录，同步到「更多工具」（顶部栏主功能只在设置里调整）。
// 卡片仍由 index.html 渲染（内置为静态 HTML，自定义工具由 renderCustomToolCards 生成）；
// 这里只做增强：分组排序、筛选、更新时间，不改动卡片自身的数据和事件。
// 分类沿用导航设置（navbar.js 的 navState.settings），在导航中调整分类后首页同步变化。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            all: '全部工具', recent: '最近使用', favorites: '收藏', groups: '分类', other: '其他', skills: '技能',
            searchPlaceholder: '搜索工具 / 拼音首字母', empty: '没有匹配的工具', emptyRecent: '还没有最近使用的工具',
            emptyFavorites: '还没有收藏的工具：点卡片右上角的 ☆，或把卡片拖到这里',
            favAdd: '收藏', favRemove: '取消收藏', favAdded: '已收藏「{name}」', favRemoved: '已取消收藏「{name}」',
            dropFavorite: '松开即收藏', dragHint: '拖到「收藏」区即可收藏；管理员还可拖到其他位置调整顺序和目录',
            reordered: '已调整顺序，「更多工具」同步更新', moved: '已移到「{group}」，「更多工具」同步更新',
            updated: '{time}更新', justNow: '刚刚', minutes: '{n} 分钟前', hours: '{n} 小时前', days: '{n} 天前',
            updatedTitle: '上次更新：{time}', searchTitle: '搜索“{q}”', toolCount: '{n} 个工具'
        },
        'en-US': {
            all: 'All tools', recent: 'Recent', favorites: 'Favorites', groups: 'Categories', other: 'Other', skills: 'Skills',
            searchPlaceholder: 'Search tools', empty: 'No matching tools', emptyRecent: 'No recently used tools yet',
            emptyFavorites: 'No favorites yet. Click ☆ on a card, or drag a card here',
            favAdd: 'Add to favorites', favRemove: 'Remove from favorites', favAdded: 'Added “{name}” to favorites', favRemoved: 'Removed “{name}” from favorites',
            dropFavorite: 'Drop to add to favorites', dragHint: 'Drop on Favorites to save it; admins can also drop elsewhere to reorder or move categories',
            reordered: 'Order updated; the More menu follows', moved: 'Moved to “{group}”; the More menu follows',
            updated: 'Updated {time}', justNow: 'just now', minutes: '{n}m ago', hours: '{n}h ago', days: '{n}d ago',
            updatedTitle: 'Last updated: {time}', searchTitle: 'Search “{q}”', toolCount: '{n} tools'
        }
    };
    const GROUP_COLORS = ['#38bdf8', '#34d399', '#a78bfa', '#f59e0b', '#f472b6', '#22d3ee', '#fb7185', '#a3e635', '#818cf8', '#fbbf24'];
    const STAR_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.9l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.1 4.4 13l.7-4L2.2 6.2l4-.6z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/></svg>';
    const RECENT_LIMIT = 8;
    const GROUP_ORDER_BASE = 1000; // 0–999 留给顶部的最近使用 / 收藏快捷区
    const CARD_SELECTOR = ':scope > a.tool-card:not(.is-shortcut)';
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

    // 技能卡片（js/home/skills-tools.js）：点击进入对话并 @ 该技能，统一归入「技能」分组
    const SKILLS_GROUP = '__skills';

    function cardItemId(card) {
        if (card.dataset.skillCard === '1') return `skill:${card.dataset.skillId}`;
        if (card.dataset.customToolCard === '1') return `custom:${card.dataset.toolSlug}`;
        return String(card.getAttribute('href') || '').replace(/^\//, '');
    }

    function defaultCategory(card, itemId) {
        if (card.dataset.skillCard === '1') return SKILLS_GROUP;
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
        if (card.dataset.skillCard === '1') return card.dataset.updatedAt || '';
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
            if (!known.has(groupId) && groupId !== SKILLS_GROUP) groupId = known.has('custom') && card.dataset.customToolCard === '1' ? 'custom' : '__other';
            if (!byGroup.has(groupId)) byGroup.set(groupId, []);
            byGroup.get(groupId).push(card);
        });
        // 目录内顺序与「更多工具」一致：按导航设置的 itemOrder，未登记的保持页面原有顺序
        const itemOrder = new Map((settings.itemOrder || []).map((id, index) => [id, index]));
        const domIndex = new Map(cards.map((card, index) => [card, index]));
        byGroup.forEach(list => list.sort((a, b) => {
            const ai = itemOrder.has(cardItemId(a)) ? itemOrder.get(cardItemId(a)) : 100000 + domIndex.get(a);
            const bi = itemOrder.has(cardItemId(b)) ? itemOrder.get(cardItemId(b)) : 100000 + domIndex.get(b);
            return ai - bi;
        }));
        const ordered = [...known.values()].filter(category => byGroup.has(category.id))
            .map(category => ({ id: category.id, name: categoryName(category), cards: byGroup.get(category.id) }));
        if (byGroup.has(SKILLS_GROUP)) ordered.push({ id: SKILLS_GROUP, name: tx('skills'), cards: byGroup.get(SKILLS_GROUP) });
        if (byGroup.has('__other')) ordered.push({ id: '__other', name: tx('other'), cards: byGroup.get('__other') });
        const colorIndex = new Map((settings.categories || []).map((category, index) => [category.id, index]));
        ordered.forEach((group, index) => {
            group.color = group.id === SKILLS_GROUP ? '#f472b6' : GROUP_COLORS[(colorIndex.get(group.id) ?? index) % GROUP_COLORS.length];
        });
        return ordered;
    }

    function renderGroupHeads() {
        const existing = new Map([...grid.querySelectorAll(':scope > .home-group-head:not(.home-shortcut-head)')].map(head => [head.dataset.group, head]));
        let order = GROUP_ORDER_BASE;
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

    function favoriteIds() {
        try {
            return window.NavFavorites?.get?.() || [];
        } catch {
            return [];
        }
    }

    function cardTitle(card) {
        const title = card.querySelector('.card-title')?.cloneNode(true);
        title?.querySelectorAll('.new-badge, .tool-kind-badge').forEach(node => node.remove());
        return title?.textContent.replace(/\s+/g, ' ').trim() || '';
    }

    function originalCards() {
        return [...grid.querySelectorAll(CARD_SELECTOR)];
    }

    function canFavorite(card) {
        return card.dataset.skillCard !== '1';
    }

    // 每张卡片右上角加星标（自定义工具放在下载按钮之后；内置卡片新建操作区）
    function ensureFavoriteButton(card) {
        if (!canFavorite(card) || card.querySelector(':scope > .custom-tool-actions > .card-fav-toggle, :scope > .card-quick-actions > .card-fav-toggle')) return;
        let actions = card.querySelector(':scope > .custom-tool-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'custom-tool-actions card-quick-actions';
            card.prepend(actions);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'custom-tool-action card-fav-toggle';
        button.innerHTML = STAR_SVG;
        const download = actions.querySelector(':scope > .custom-tool-action:not(.builtin-toggle):not(.delete)');
        if (download && /downloadCustomTool/.test(download.getAttribute('onclick') || '')) download.after(button);
        else actions.prepend(button);
    }

    function syncFavoriteButtons() {
        const favorites = new Set(favoriteIds());
        grid.querySelectorAll(':scope > a.tool-card .card-fav-toggle').forEach(button => {
            const card = button.closest('a.tool-card');
            const on = favorites.has(card.dataset.originId || cardItemId(card));
            button.classList.toggle('is-favorite', on);
            button.setAttribute('aria-pressed', String(on));
            button.title = tx(on ? 'favRemove' : 'favAdd');
            button.setAttribute('aria-label', button.title);
            card.classList.toggle('is-favorite', on);
        });
    }

    // 顶部快捷区：最近使用（只读）、收藏（可拖入、可拖动排序）。卡片是原卡片的副本，点击行为相同。
    function shortcutHead(kind, count, color) {
        let head = grid.querySelector(`:scope > .home-shortcut-head[data-shortcut="${kind}"]`);
        if (!head) {
            head = document.createElement('div');
            head.className = 'home-group-head home-shortcut-head';
            head.dataset.shortcut = kind;
            head.dataset.group = `__${kind}`;
            head.setAttribute('role', 'heading');
            head.setAttribute('aria-level', '2');
            grid.appendChild(head);
        }
        head.style.setProperty('--group-color', color);
        head.innerHTML = `<span class="home-group-dot"></span><span class="home-group-name">${escapeHtml(tx(kind))}</span><span class="home-group-count">${count}</span>`;
        return head;
    }

    function renderShortcuts() {
        grid.querySelectorAll(':scope > .is-shortcut, :scope > .home-fav-empty').forEach(node => node.remove());
        const byId = new Map(originalCards().filter(canFavorite).map(card => [cardItemId(card), card]));
        const recent = recentIds().filter(id => byId.has(id)).slice(0, RECENT_LIMIT);
        const favorites = favoriteIds().filter(id => byId.has(id));
        let order = 0;
        const place = (node, kind) => {
            node.style.order = String(order++);
            node.dataset.shortcut = kind;
            grid.appendChild(node);
        };
        const cloneFor = (id, kind) => {
            const clone = byId.get(id).cloneNode(true);
            clone.classList.add('is-shortcut');
            clone.classList.remove('is-filtered-out', 'is-dragging', 'drop-before', 'drop-after');
            clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
            clone.querySelector('.card-download-progress')?.remove();
            clone.dataset.originId = id;
            return clone;
        };
        const recentHead = shortcutHead('recent', recent.length, '#7dd3fc');
        recentHead.style.order = String(order++);
        recentHead.hidden = !recent.length;
        recent.forEach(id => place(cloneFor(id, 'recent'), 'recent'));
        const favoriteHead = shortcutHead('favorites', favorites.length, '#fbbf24');
        favoriteHead.style.order = String(order++);
        favoriteHead.hidden = false;
        favorites.forEach(id => place(cloneFor(id, 'favorites'), 'favorites'));
        if (!favorites.length) {
            const empty = document.createElement('div');
            empty.className = 'home-fav-empty';
            empty.innerHTML = `${STAR_SVG}<span>${escapeHtml(tx('emptyFavorites'))}</span>`;
            place(empty, 'favorites');
        }
    }

    function renderSidebar() {
        if (!sidebarNav) return;
        const total = groups.reduce((sum, group) => sum + group.cards.length, 0);
        const cardIds = new Set(groups.flatMap(group => group.cards.map(cardItemId)));
        const recentCount = recentIds().filter(id => cardIds.has(id)).length;
        const favoriteCount = favoriteIds().filter(id => cardIds.has(id)).length;
        const item = (attrs, icon, name, count) => `
            <button type="button" class="home-cat-item" title="${escapeHtml(name)}" ${attrs}>
                <span class="home-cat-icon" aria-hidden="true">${icon}</span>
                <span class="home-cat-name">${escapeHtml(name)}</span>
                <span class="home-cat-count">${count}</span>
            </button>`;
        sidebarNav.innerHTML = [
            item('data-view="all"', '<svg viewBox="0 0 16 16"><path d="M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>', tx('all'), total),
            item('data-view="recent"', CLOCK_SVG, tx('recent'), recentCount),
            item('data-view="favorites"', STAR_SVG, tx('favorites'), favoriteCount),
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
        headTitle.textContent = query ? tx('searchTitle', { q: query }) : tx(['recent', 'favorites'].includes(state.view) ? state.view : 'all');
        if (headCount) headCount.textContent = tx('toolCount', { n: visible });
    }

    function applyFilter() {
        const query = state.query.trim();
        const recent = !query && state.view === 'recent' ? recentIds() : !query && state.view === 'favorites' ? favoriteIds() : null;
        const flat = Boolean(recent || query);
        // 快捷区只在「全部工具」浏览视图显示；筛选视图直接筛原卡片
        grid.querySelectorAll(':scope > .is-shortcut, :scope > .home-fav-empty, :scope > .home-shortcut-head').forEach(node => {
            node.classList.toggle('is-filtered-out', flat);
            if (node.classList.contains('home-shortcut-head')) node.hidden = flat || (node.dataset.shortcut === 'recent' && !grid.querySelector(':scope > .is-shortcut[data-shortcut="recent"]'));
        });
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
            if (text) text.textContent = recent ? tx(state.view === 'favorites' ? 'emptyFavorites' : 'emptyRecent') : tx('empty');
        }
        renderToolsHead(visible);
        syncSidebarState();
        // 插件与脚本区块（js/home/capabilities.js）跟随同一个搜索与视图过滤
        window.dispatchEvent(new CustomEvent('home:tools-filtered', { detail: { view: state.view, query, visible } }));
    }

    function layout() {
        layoutQueued = false;
        // 拖动排序进行中不重排，结束后再补上
        if (sort) { setTimeout(scheduleLayout, 300); return; }
        const cards = originalCards();
        cards.forEach(renderCardMeta);
        cards.forEach(ensureFavoriteButton);
        groups = buildGroups(cards);
        renderGroupHeads();
        renderShortcuts();
        syncFavoriteButtons();
        renderSidebar();
        applyFilter();
        if (!updates.toolsLoaded || cards.some(card => card.dataset.customToolCard === '1' && card.dataset.skillCard !== '1' && !updates.tools[card.dataset.toolSlug])) {
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
        if (view === 'all') {
            renderGroupHeads();
            renderShortcuts();
            syncFavoriteButtons();
        }
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
        if (!state.query && state.view === 'all') {
            renderGroupHeads();
            renderShortcuts();
            syncFavoriteButtons();
        }
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
        window.addEventListener('tools:favorites-change', scheduleLayout);
        bindFavoritesAndDrag();
        window.addEventListener('home:mode', () => {
            if (isToolsMode()) requestAnimationFrame(updateCurrentGroup);
        });

        new MutationObserver(records => {
            // 快捷区副本由本模块增删，不触发重排
            const cardsChanged = records.some(record => [...record.addedNodes, ...record.removedNodes]
                .some(node => node.nodeType === 1 && node.matches('a.tool-card') && !node.classList.contains('is-shortcut')));
            if (cardsChanged) scheduleLayout();
        }).observe(grid, { childList: true });

        // 相对时间随时间推移刷新
        setInterval(() => grid.querySelectorAll(':scope > a.tool-card').forEach(renderCardMeta), 60 * 1000);
    }

    function toast(message, type) {
        if (typeof window.showToast === 'function') window.showToast(message, type);
    }

    function isAdmin() {
        return localStorage.getItem('tools_role') === 'admin';
    }

    function groupOfCard(card) {
        return groups.find(group => group.cards.includes(card)) || null;
    }

    // ── iOS 式拖动排序：整张卡片浮起跟手，其他卡片平滑让位（FLIP 动画），松手落位 ──
    // 鼠标拖动超过 6px 开始；触屏长按 320ms 开始（不影响滚动）。收藏区任何人可拖入 / 排序；
    // 目录内排序与跨目录移动仅管理员，提交后同步导航设置（「更多工具」；顶部栏主功能顺序不变）。
    const SORT_THRESHOLD = 6;
    const LONG_PRESS_MS = 320;
    let sort = null;
    let suppressClick = false;

    function sortableNodes() {
        return [...grid.querySelectorAll(':scope > a.tool-card:not(.is-filtered-out), :scope > .home-group-head:not([hidden]), :scope > .home-fav-empty:not(.is-filtered-out), :scope > .home-drop-slot')];
    }

    // 记录位置 → 调整 order → 让每个元素从旧位置平滑移到新位置
    function flip(mutate) {
        const nodes = sortableNodes().filter(node => node !== sort?.ghost);
        const before = new Map(nodes.map(node => [node, node.getBoundingClientRect()]));
        mutate();
        const moved = [];
        sortableNodes().forEach(node => {
            const old = before.get(node);
            if (!old) return;
            const now = node.getBoundingClientRect();
            const dx = old.left - now.left;
            const dy = old.top - now.top;
            if (!dx && !dy) return;
            node.style.transition = 'none';
            node.style.transform = `translate(${dx}px, ${dy}px)`;
            moved.push(node);
        });
        if (!moved.length) return;
        grid.getBoundingClientRect(); // 强制回流，让上面的起始位置生效
        moved.forEach(node => {
            node.style.transition = 'transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)';
            node.style.transform = '';
        });
        clearTimeout(flip.timer);
        flip.timer = setTimeout(() => moved.forEach(node => { node.style.transition = ''; }), 260);
    }

    function favoriteCards() {
        return [...grid.querySelectorAll(':scope > a.tool-card.is-shortcut[data-shortcut="favorites"]')]
            .sort((a, b) => Number(a.style.order) - Number(b.style.order));
    }

    // 按预览目标重新编号：最近使用 → 收藏（含占位）→ 各目录（拖动的卡片插入目标目录）
    function applyPreview(target) {
        const recentHead = grid.querySelector(':scope > .home-shortcut-head[data-shortcut="recent"]');
        const favoriteHead = grid.querySelector(':scope > .home-shortcut-head[data-shortcut="favorites"]');
        const empty = grid.querySelector(':scope > .home-fav-empty');
        let order = 0;
        if (recentHead) recentHead.style.order = String(order++);
        [...grid.querySelectorAll(':scope > a.tool-card.is-shortcut[data-shortcut="recent"]')]
            .sort((a, b) => Number(a.dataset.baseOrder) - Number(b.dataset.baseOrder))
            .forEach(card => { card.style.order = String(order++); });
        if (favoriteHead) favoriteHead.style.order = String(order++);

        const favorites = sort.favoriteBase.filter(card => card !== sort.favoritePlaceholder);
        if (target?.kind === 'favorites') {
            if (!sort.favoritePlaceholder) {
                const slot = document.createElement('div');
                slot.className = 'home-drop-slot';
                slot.style.height = `${sort.rect.height}px`;
                grid.appendChild(slot);
                sort.favoritePlaceholder = slot;
                sort.createdSlot = slot;
            }
            favorites.splice(Math.min(target.index, favorites.length), 0, sort.favoritePlaceholder);
        } else if (sort.createdSlot) {
            sort.createdSlot.remove();
            sort.createdSlot = null;
            sort.favoritePlaceholder = sort.sourceFavorite;
        } else if (sort.sourceFavorite && sort.favoritePlaceholder) {
            favorites.splice(Math.min(sort.sourceFavoriteIndex, favorites.length), 0, sort.favoritePlaceholder);
        }
        favorites.forEach(node => { node.style.order = String(order++); });
        if (empty) {
            empty.style.order = String(order++);
            empty.classList.toggle('is-filtered-out', favorites.length > 0);
        }

        order = GROUP_ORDER_BASE;
        groups.forEach(group => {
            const cards = group.cards.filter(card => card !== sort.original || target?.kind !== 'group');
            if (target?.kind === 'group' && target.groupId === group.id) cards.splice(Math.min(target.index, cards.length), 0, sort.original);
            if (group.head) group.head.style.order = String(order++);
            cards.forEach(card => {
                card.style.order = String(order++);
                card.style.setProperty('--group-color', group.color);
            });
        });
        // 目标为目录时原卡片就是占位（隐藏）；拖入收藏时原卡片留在原处、变淡
        sort.original?.classList.toggle('is-sort-placeholder', target?.kind === 'group');
        sort.original?.classList.toggle('is-sort-source', target?.kind !== 'group');
        if (sort.sourceFavorite) sort.sourceFavorite.classList.toggle('is-sort-placeholder', sort.favoritePlaceholder === sort.sourceFavorite && target?.kind === 'favorites');
    }

    function sectionOf(node) {
        if (!node) return null;
        if (node.classList.contains('home-fav-empty') || node.dataset.shortcut === 'favorites') return { kind: 'favorites' };
        if (node.dataset.shortcut) return null;
        if (node.classList.contains('home-group-head')) {
            return [SKILLS_GROUP, '__other'].includes(node.dataset.group) ? null : { kind: 'group', groupId: node.dataset.group, head: true };
        }
        const group = groupOfCard(node);
        return group && ![SKILLS_GROUP, '__other'].includes(group.id) ? { kind: 'group', groupId: group.id } : null;
    }

    // 根据指针下的元素计算目标位置（区块 + 插入下标，下标不含拖动项本身）
    function hitTarget(x, y) {
        const hit = document.elementFromPoint(x, y);
        const node = hit?.closest('#toolsGrid > a.tool-card, #toolsGrid > .home-group-head, #toolsGrid > .home-fav-empty, #toolsGrid > .home-drop-slot');
        if (!node) return sort.target;
        if (node === sort.original || node === sort.favoritePlaceholder) return sort.target; // 停在空槽上保持不变
        const section = sectionOf(node);
        if (!section) return sort.target;
        if (section.kind === 'group' && !isAdmin()) return sort.target;
        if (section.kind === 'favorites') {
            if (node.classList.contains('home-fav-empty') || node.classList.contains('home-shortcut-head')) return { kind: 'favorites', index: 0 };
            const list = favoriteCards().filter(card => card !== sort.favoritePlaceholder);
            const rect = node.getBoundingClientRect();
            return { kind: 'favorites', index: list.indexOf(node) + (x > rect.left + rect.width / 2 ? 1 : 0) };
        }
        const group = groups.find(item => item.id === section.groupId);
        if (section.head) return { kind: 'group', groupId: group.id, index: 0 };
        const list = group.cards.filter(card => card !== sort.original);
        const rect = node.getBoundingClientRect();
        return { kind: 'group', groupId: group.id, index: list.indexOf(node) + (x > rect.left + rect.width / 2 ? 1 : 0) };
    }

    const sameTarget = (a, b) => (!a && !b) || (a && b && a.kind === b.kind && a.groupId === b.groupId && a.index === b.index);

    function beginSort(card, event) {
        const id = card.dataset.originId || cardItemId(card);
        const original = originalCards().find(item => cardItemId(item) === id);
        if (!original) return;
        const rect = card.getBoundingClientRect();
        const ghost = card.cloneNode(true);
        ghost.classList.add('home-sort-ghost');
        ghost.classList.remove('is-filtered-out', 'is-shortcut');
        ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
        Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px`, top: `${rect.top}px`, order: '', transform: '', transition: '' });
        // 放在工具区容器里，沿用卡片在首页的样式；fixed 定位跟随指针
        (grid.closest('.home-workspace') || document.body).appendChild(ghost);
        const favoriteBase = favoriteCards();
        const sourceFavorite = card.dataset.shortcut === 'favorites' ? card : favoriteBase.find(item => item.dataset.originId === id) || null;
        sort = {
            id, card, original, ghost, rect,
            offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
            pointerX: event.clientX, pointerY: event.clientY,
            favoriteBase, sourceFavorite, sourceFavoriteIndex: sourceFavorite ? favoriteBase.indexOf(sourceFavorite) : -1,
            favoritePlaceholder: sourceFavorite, createdSlot: null,
            startTarget: null, target: null, lastSwitch: 0
        };
        grid.querySelectorAll(':scope > a.tool-card.is-shortcut[data-shortcut="recent"]').forEach(item => { item.dataset.baseOrder = item.style.order; });
        // 起始目标：从收藏区拖起 → 收藏原位；从目录拖起 → 目录原位（仅管理员可改目录顺序）
        if (card.dataset.shortcut === 'favorites') sort.startTarget = { kind: 'favorites', index: sort.sourceFavoriteIndex };
        else if (!card.dataset.shortcut && isAdmin()) {
            const group = groupOfCard(original);
            if (group && ![SKILLS_GROUP, '__other'].includes(group.id)) sort.startTarget = { kind: 'group', groupId: group.id, index: group.cards.indexOf(original) };
        }
        sort.target = sort.startTarget;
        document.body.classList.add('home-sorting');
        grid.classList.add('is-sorting');
        flip(() => applyPreview(sort.target));
        requestAnimationFrame(() => ghost.classList.add('is-lifted'));
        autoScroll();
    }

    function moveSort(x, y) {
        sort.pointerX = x;
        sort.pointerY = y;
        sort.ghost.style.left = `${x - sort.offsetX}px`;
        sort.ghost.style.top = `${y - sort.offsetY}px`;
        const target = hitTarget(x, y);
        if (sameTarget(target, sort.target)) return;
        // 让位动画进行中不立刻再次换位，避免卡片来回抖动；停下后补算一次，指针停在哪就落在哪
        const wait = 140 - (performance.now() - sort.lastSwitch);
        if (wait > 0) {
            clearTimeout(sort.pending);
            sort.pending = setTimeout(() => { if (sort) moveSort(sort.pointerX, sort.pointerY); }, wait + 10);
            return;
        }
        sort.target = target;
        sort.lastSwitch = performance.now();
        flip(() => applyPreview(target));
    }

    function autoScroll() {
        if (!sort) return;
        const edge = 72;
        const y = sort.pointerY;
        const speed = y < edge ? -Math.ceil((edge - y) / 6) : y > window.innerHeight - edge ? Math.ceil((y - window.innerHeight + edge) / 6) : 0;
        if (speed) {
            window.scrollBy(0, speed);
            moveSort(sort.pointerX, sort.pointerY);
        }
        sort.scrollFrame = requestAnimationFrame(autoScroll);
    }

    function finishSort(commit) {
        const current = sort;
        cancelAnimationFrame(current.scrollFrame);
        clearTimeout(current.pending);
        if (commit) {
            const final = hitTarget(current.pointerX, current.pointerY);
            if (!sameTarget(final, current.target)) {
                current.target = final;
                flip(() => applyPreview(final));
            }
        }
        const target = commit ? current.target : null;
        const changed = target && !sameTarget(target, current.startTarget);
        const landing = changed
            ? (target.kind === 'favorites' ? current.favoritePlaceholder : current.original)
            : (current.card.isConnected ? current.card : current.original);
        if (!changed) flip(() => applyPreview(current.startTarget));
        const rect = landing.getBoundingClientRect();
        current.ghost.classList.remove('is-lifted');
        current.ghost.classList.add('is-dropping');
        current.ghost.style.left = `${rect.left}px`;
        current.ghost.style.top = `${rect.top}px`;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 50);
        setTimeout(() => {
            current.ghost.remove();
            current.createdSlot?.remove();
            current.original.classList.remove('is-sort-placeholder', 'is-sort-source');
            current.sourceFavorite?.classList.remove('is-sort-placeholder');
            document.body.classList.remove('home-sorting');
            grid.classList.remove('is-sorting');
            sort = null;
            if (changed) commitSort(current, target);
            else { renderGroupHeads(); renderShortcuts(); syncFavoriteButtons(); applyFilter(); }
        }, 220);
    }

    function commitSort(current, target) {
        if (target.kind === 'favorites') {
            const before = favoriteIds();
            const ids = before.filter(id => id !== current.id);
            ids.splice(Math.min(target.index, ids.length), 0, current.id);
            window.NavFavorites?.set?.(ids);
            if (!before.includes(current.id)) toast(tx('favAdded', { name: cardTitle(current.original) }));
            return;
        }
        const group = groups.find(item => item.id === target.groupId);
        const list = group.cards.filter(card => card !== current.original);
        const prev = list[target.index - 1];
        const next = list[target.index];
        const fromGroup = groupOfCard(current.original);
        const ok = window.NavLayout?.reorder?.(current.id, prev ? { afterId: cardItemId(prev), categoryId: group.id }
            : next ? { beforeId: cardItemId(next), categoryId: group.id } : { categoryId: group.id });
        if (ok) toast(fromGroup && fromGroup.id !== group.id ? tx('moved', { group: group.name }) : tx('reordered'));
        else scheduleLayout();
    }

    function bindFavoritesAndDrag() {
        grid.addEventListener('click', event => {
            if (suppressClick && event.target.closest('a.tool-card')) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const button = event.target.closest('.card-fav-toggle');
            if (!button) return;
            event.preventDefault();
            event.stopPropagation();
            const card = button.closest('a.tool-card');
            const id = card.dataset.originId || cardItemId(card);
            const on = window.NavFavorites?.toggle?.(id);
            toast(tx(on ? 'favAdded' : 'favRemoved', { name: cardTitle(card) }));
        }, true);

        // 关掉浏览器原生的链接拖拽（只会拖出一条网址）
        grid.addEventListener('dragstart', event => {
            if (event.target.closest?.('#toolsGrid > a.tool-card')) event.preventDefault();
        });

        grid.addEventListener('pointerdown', event => {
            if (sort || event.button !== 0 || !event.isPrimary) return;
            const card = event.target.closest('#toolsGrid > a.tool-card');
            if (!card || !canFavorite(card) || event.target.closest('.custom-tool-actions, button, input, select, textarea')) return;
            const startX = event.clientX;
            const startY = event.clientY;
            const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
            let pressTimer = null;
            let started = false;
            const start = moveEvent => {
                started = true;
                clearTimeout(pressTimer);
                beginSort(card, moveEvent || event);
                if (touch && navigator.vibrate) navigator.vibrate(10);
            };
            const onMove = moveEvent => {
                if (started) {
                    if (sort) moveSort(moveEvent.clientX, moveEvent.clientY);
                    moveEvent.preventDefault();
                    return;
                }
                const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
                if (touch) { if (distance > 8) cleanup(); } // 触屏移动即滚动，不拖
                else if (distance > SORT_THRESHOLD) start(moveEvent);
            };
            const onUp = () => {
                cleanup();
                if (started && sort) finishSort(true);
            };
            const onKey = keyEvent => {
                if (keyEvent.key !== 'Escape' || !sort) return;
                cleanup();
                finishSort(false);
            };
            const cleanup = () => {
                clearTimeout(pressTimer);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                window.removeEventListener('keydown', onKey);
            };
            if (touch) pressTimer = setTimeout(() => start(null), LONG_PRESS_MS);
            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
            window.addEventListener('keydown', onKey);
        });
        // 触屏拖动时阻止页面跟着滚动
        grid.addEventListener('touchmove', event => { if (sort) event.preventDefault(); }, { passive: false });
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
