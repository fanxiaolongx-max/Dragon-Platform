// 新版首页「技能·插件·工具」中心：侧栏入口点开后占据主区，顶部切换技能 / 插件与脚本 / 工具，
// 下方分类标签 + 排序 + 卡片网格，分类直接在右侧主区里切换（不再挤在左侧侧栏）。
// 数据复用已有模块：技能 window.HomeSkills（skills-tools.js）、插件与脚本 window.HomeCapabilities（capabilities.js）、
// 工具 window.HomeWorkspace.getTools()（workspace.js）。管理操作（改名、删除、下载）仍在「工具」视图的卡片上。
(function () {
    'use strict';

    const TEXT = {
        'zh-CN': {
            skills: '技能', plugins: '插件与脚本', tools: '工具', search: '搜索{tab}', all: '全部',
            sortMixed: '综合', sortNewest: '最新', sortName: '名称',
            featuredSkills: '精选技能', featuredTools: '最近使用', featuredPlugins: '常用插件', shuffle: '换一批',
            builtin: '内置', custom: '自定义', imported: '导入', workspace: '需工作目录', customized: '已自定义',
            use: '使用', open: '打开', improve: '完善技能', history: '版本历史',
            market: '查找工具（工具市场）', importTool: '上传工具', compare: '内置工具比对', manage: '管理',
            addSkill: '添加技能', addTool: '添加工具', addPlugin: '前往插件', findSkill: '查找技能', uploadSkill: '上传技能', createSkill: '创建技能',
            installed: '已安装({n})', favorites: '已收藏({n})',
            empty: '没有匹配「{q}」的结果', emptyCat: '这个分类下暂时没有内容', loading: '正在加载…', count: '{n} 项',
            defaultSkillDesc: '在对话里 @ 使用这个技能', where: '位于 {where}', close: '返回'
        },
        'en-US': {
            skills: 'Skills', plugins: 'Plugins & scripts', tools: 'Tools', search: 'Search {tab}', all: 'All',
            sortMixed: 'Default', sortNewest: 'Newest', sortName: 'Name',
            featuredSkills: 'Featured skills', featuredTools: 'Recently used', featuredPlugins: 'Popular plugins', shuffle: 'Shuffle',
            builtin: 'Built-in', custom: 'Custom', imported: 'Imported', workspace: 'Needs a folder', customized: 'Customized',
            use: 'Use', open: 'Open', improve: 'Improve Skill', history: 'History',
            market: 'Find tools (market)', importTool: 'Upload tool', compare: 'Compare built-ins', manage: 'Manage',
            addSkill: 'Add Skill', addTool: 'Add tool', addPlugin: 'Go to plugins', findSkill: 'Find Skills', uploadSkill: 'Upload Skill', createSkill: 'Create Skill',
            installed: 'Installed ({n})', favorites: 'Favorites ({n})',
            empty: 'Nothing matches “{q}”', emptyCat: 'Nothing in this category yet', loading: 'Loading…', count: '{n}',
            defaultSkillDesc: 'Use this Skill with @ in chat', where: 'In {where}', close: 'Back'
        }
    };
    const TABS = ['skills', 'plugins', 'tools'];
    const STORE_KEY = 'tools_v2_hub';
    const state = { open: false, tab: 'skills', cat: 'all', sort: 'mixed', query: '', seed: 0, mine: false };
    let root;

    const lang = () => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN');
    function t(key, params = {}) {
        const template = TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
        return Object.keys(params).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), template);
    }
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isAdmin = () => { try { return localStorage.getItem('tools_role') === 'admin'; } catch { return false; } };
    const ico = name => `<span class="v2-ico" data-icon="${name}"></span>`;

    try {
        const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        if (TABS.includes(saved.tab)) state.tab = saved.tab;
        if (['mixed', 'newest', 'name'].includes(saved.sort)) state.sort = saved.sort;
    } catch { /* 无痕模式 */ }
    const remember = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ tab: state.tab, sort: state.sort })); } catch { /* 无痕模式 */ } };

    // ── 三类条目统一成 { key, title, desc, icon, color, cat, catLabel, badges, updatedAt, href, kind } ──
    function skillEntries() {
        const en = lang() === 'en-US';
        return (window.HomeSkills?.items?.() || []).filter(item => !item.hidden).map(item => {
            const cat = item.builtIn ? 'builtin' : item.source === 'import' ? 'imported' : 'custom';
            return {
                key: `skill:${item.id}`, kind: 'skill', id: item.id,
                title: (en ? item.nameEn : '') || item.name || item.id,
                desc: (en ? item.descriptionEn : '') || item.description || t('defaultSkillDesc'),
                icon: item.icon || '✨', color: item.builtIn ? '#10a37f' : '#f472b6',
                cat, catLabel: t(cat), mine: !item.builtIn, extraCats: item.workspace ? ['workspace'] : [],
                badges: [`@${item.id}`, item.customized ? t('customized') : '', item.workspace ? t('workspace') : ''].filter(Boolean),
                updatedAt: item.updatedAt || '', href: `/?skill=${encodeURIComponent(item.id)}`
            };
        });
    }
    function pluginEntries() {
        const en = lang() === 'en-US';
        return (window.HomeCapabilities?.groups?.() || []).flatMap(group => group.items.map((item, index) => ({
            key: `cap:${group.kind}:${item.id || index}`, kind: 'plugin',
            title: (en ? item.nameEn : '') || item.name, desc: item.description || '',
            icon: item.icon || group.icon || '🧩', color: group.color || '#38bdf8',
            cat: group.kind, catLabel: (en ? group.labelEn : '') || group.label,
            badges: [t('where', { where: (en ? group.whereEn : '') || group.where })].filter(Boolean),
            updatedAt: item.updatedAt || '', href: item.href || group.href
        })));
    }
    function toolEntries() {
        const favorites = new Set((() => { try { return window.NavFavorites?.get?.() || []; } catch { return []; } })());
        return (window.HomeWorkspace?.getTools?.() || [])
            .filter(tool => tool && tool.href && tool.title && !String(tool.id).startsWith('skill:'))
            .map(tool => ({
                key: `tool:${tool.id}`, kind: 'tool', id: tool.id, title: tool.title, desc: tool.description || '',
                icon: tool.icon || '🧩', color: tool.color || '#64748b', cat: tool.group, catLabel: tool.group,
                badges: [tool.group, tool.updatedText].filter(Boolean), mine: favorites.has(tool.id), updatedAt: tool.updatedAt || '', href: tool.href
            }));
    }
    const entries = () => (state.tab === 'skills' ? skillEntries() : state.tab === 'plugins' ? pluginEntries() : toolEntries());

    function categories(list) {
        const seen = new Map();
        list.forEach(item => [[item.cat, item.catLabel], ...(item.extraCats || []).map(cat => [cat, t(cat)])].forEach(([id, label]) => {
            if (!id) return;
            const prev = seen.get(id) || { id, label, n: 0 };
            prev.n += 1;
            seen.set(id, prev);
        }));
        return [{ id: 'all', label: t('all'), n: list.length }, ...seen.values()];
    }

    function matches(item, query) {
        if (!query) return true;
        const text = `${item.title} ${item.desc} ${item.catLabel} ${item.badges.join(' ')}`.toLowerCase();
        return text.includes(query) || Boolean(window.ToolsPinyinSearch?.pinyinMatches?.(item.title, query));
    }
    function ensurePinyin() {
        if (window.ToolsPinyinSearch || document.querySelector('script[src="./tp-static/frontend/js/shared/pinyin-search.js"]')) return;
        const script = document.createElement('script');
        script.src = './tp-static/frontend/js/shared/pinyin-search.js';
        script.onload = () => { if (state.query) renderList(); };
        document.head.appendChild(script);
    }

    function recentTools(list) {
        const ids = typeof getRecentNavToolIds === 'function' ? getRecentNavToolIds() : [];
        const nav = typeof getAllNavItems === 'function' ? getAllNavItems() : [];
        const hrefs = ids.map(id => nav.find(item => item.id === id)?.href || id);
        return hrefs.map(href => list.find(item => item.href === href || item.id === href)).filter(Boolean);
    }
    // 精选：工具优先最近使用；技能与插件按「换一批」轮换
    function featured(list) {
        if (state.tab === 'tools') {
            const recent = recentTools(list);
            return (recent.length ? recent : list).slice(0, 3);
        }
        if (list.length <= 3) return list;
        const start = (state.seed * 3) % list.length;
        return [...list.slice(start), ...list.slice(0, start)].slice(0, 3);
    }

    function iconHtml(icon) {
        const value = String(icon || '').trim();
        if (/^(https?:|\/|data:image)/.test(value)) return `<img src="${esc(value)}" alt="" loading="lazy">`;
        return esc(value.length <= 4 ? value : '') || '🧩';
    }
    function card(item) {
        const action = item.kind === 'skill' ? `<span class="v2-hub-use">@ ${esc(t('use'))}</span>` : `<span class="v2-hub-use">${ico('arrowUpRight')}</span>`;
        const extra = item.kind === 'skill' ? `<span class="v2-hub-more">
                <button type="button" data-hub-act="improve" title="${esc(t('improve'))}">${ico('sparkles')}</button>
                <button type="button" data-hub-act="history" title="${esc(t('history'))}">${ico('refresh')}</button></span>` : '';
        return `<a class="v2-hub-card" href="${esc(item.href)}" data-hub-key="${esc(item.key)}" style="--hub-c:${esc(item.color)}" title="${esc(item.title)}">
            <span class="v2-hub-icon">${iconHtml(item.icon)}</span>
            <span class="v2-hub-body">
                <strong>${esc(item.title)}</strong>
                <small>${esc(item.desc)}</small>
                <span class="v2-hub-meta">${item.badges.slice(0, 3).map(b => `<span>${esc(b)}</span>`).join('')}</span>
            </span>
            ${extra}${action}
        </a>`;
    }

    function render() {
        if (!root) return;
        const admin = isAdmin();
        const mineCount = entries().filter(item => item.mine).length;
        const mineBtn = state.tab === 'plugins' ? '' : `<button type="button" class="v2-hub-btn${state.mine ? ' is-on' : ''}" data-hub-do="mine" aria-pressed="${state.mine}">${ico(state.tab === 'skills' ? 'check' : 'sparkles')}<span>${esc(t(state.tab === 'skills' ? 'installed' : 'favorites', { n: mineCount }))}</span></button>`;
        const addLabel = t(state.tab === 'skills' ? 'addSkill' : state.tab === 'plugins' ? 'addPlugin' : 'addTool');
        const actions = `${mineBtn}<div class="v2-hub-add"><button type="button" class="v2-hub-btn is-primary" data-hub-do="addMenu" aria-haspopup="menu" aria-expanded="false"><span class="v2-hub-plus">+</span><span>${esc(addLabel)}</span></button><div class="v2-hub-menu" role="menu" hidden>${addMenu()}</div></div>`;
        root.innerHTML = `
            <header class="v2-hub-top">
                <nav class="v2-hub-tabs" role="tablist">${TABS.map(id => `<button type="button" role="tab" data-hub-tab="${id}" aria-selected="${state.tab === id}">${ico(id === 'skills' ? 'sparkles' : id === 'plugins' ? 'plug' : 'grid')}<span>${esc(t(id))}</span></button>`).join('')}</nav>
                <div class="v2-hub-actions">
                    <label class="v2-hub-search">${ico('search')}<input type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('search', { tab: t(state.tab) }))}" value="${esc(state.query)}"></label>
                    ${actions}
                </div>
            </header>
            <section class="v2-hub-featured"></section>
            <div class="v2-hub-bar">
                <div class="v2-hub-chips" role="tablist"></div>
                <div class="v2-hub-sort" role="group">${['mixed', 'newest', 'name'].map(id => `<button type="button" data-hub-sort="${id}" aria-pressed="${state.sort === id}">${esc(t(id === 'mixed' ? 'sortMixed' : id === 'newest' ? 'sortNewest' : 'sortName'))}</button>`).join('')}</div>
            </div>
            <div class="v2-hub-grid"></div>`;
        window.HomeV2?.fillIcons?.(root);
        renderList();
    }

    // 「添加」下拉：技能 = 查找 / 上传 SKILL 包 / 用 @create-skill 创建；工具 = 工具市场 / 上传 / 比对；插件 = 各插件仓库入口
    function addMenu() {
        const row = (icon, label, attr) => `<button type="button" role="menuitem" ${attr}>${ico(icon)}<span>${esc(label)}</span></button>`;
        if (state.tab === 'skills') return [
            row('search', t('findSkill'), 'data-hub-do="find"'),
            row('upload', t('uploadSkill'), 'data-v2-do="importTool"'),
            row('sparkles', t('createSkill'), 'data-hub-do="createSkill"')
        ].join('');
        if (state.tab === 'tools') return [
            row('store', t('market'), 'data-v2-do="market"'),
            row('upload', t('importTool'), 'data-v2-do="importTool"'),
            isAdmin() ? row('compare', t('compare'), 'data-v2-do="compare"') : ''
        ].join('');
        const en = lang() === 'en-US';
        return (window.HomeCapabilities?.groups?.() || []).map(group => `<a role="menuitem" href="${esc(group.href)}"><span class="v2-hub-menu-emoji">${esc(group.icon)}</span><span>${esc((en ? group.labelEn : '') || group.label)}</span></a>`).join('');
    }
    function toggleMenu(force) {
        const menu = root?.querySelector('.v2-hub-menu');
        if (!menu) return;
        const show = force ?? menu.hidden;
        menu.hidden = !show;
        root.querySelector('[data-hub-do="addMenu"]')?.setAttribute('aria-expanded', String(show));
    }

    function renderList() {
        if (!root?.querySelector('.v2-hub-grid')) return;
        const all = entries();
        const query = state.query.trim().toLowerCase();
        const cats = categories(all);
        if (!cats.some(c => c.id === state.cat)) state.cat = 'all';
        root.querySelector('.v2-hub-chips').innerHTML = cats.map(c => `<button type="button" data-hub-cat="${esc(c.id)}" aria-selected="${state.cat === c.id}">${esc(c.label)}<em>${c.n}</em></button>`).join('');

        const feat = root.querySelector('.v2-hub-featured');
        // Featured entries are shortcuts for this tab, independent of the results below.
        // Keep their space stable while filtering so the category bar never jumps.
        const showFeatured = all.length > 3;
        feat.hidden = !showFeatured;
        if (showFeatured) {
            const title = t(state.tab === 'skills' ? 'featuredSkills' : state.tab === 'plugins' ? 'featuredPlugins' : 'featuredTools');
            feat.innerHTML = `<div class="v2-hub-head"><h2>${esc(title)}</h2>${state.tab === 'tools' ? '' : `<button type="button" class="v2-hub-link" data-hub-do="shuffle">${ico('refresh')}<span>${esc(t('shuffle'))}</span></button>`}</div>
                <div class="v2-hub-cards is-featured">${featured(all).map(card).join('')}</div>`;
        }

        let list = all.filter(item => (!state.mine || item.mine) && (state.cat === 'all' || item.cat === state.cat || (item.extraCats || []).includes(state.cat)) && matches(item, query));
        if (state.sort === 'name') list = list.slice().sort((a, b) => a.title.localeCompare(b.title, lang()));
        else if (state.sort === 'newest') list = list.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const loading = !all.length && (state.tab !== 'plugins' || !window.HomeCapabilities);
        root.querySelector('.v2-hub-grid').innerHTML = list.length
            ? `<div class="v2-hub-cards">${list.map(card).join('')}</div>`
            : `<div class="v2-hub-empty">${esc(loading ? t('loading') : query ? t('empty', { q: state.query.trim() }) : t('emptyCat'))}</div>`;
        window.HomeV2?.fillIcons?.(root);
    }

    function open(tab) {
        if (!root) { window.addEventListener('home:skill-hub-ready', () => open(tab), { once: true }); return; }
        if (TABS.includes(tab)) { state.tab = tab; state.cat = 'all'; state.query = ''; state.mine = false; }
        state.open = true;
        root.hidden = false;
        document.body.classList.add('v2-hub-open');
        window.dispatchEvent(new CustomEvent('home:hub', { detail: { open: true } }));
        render();
        const input = root.querySelector('.v2-hub-search input');
        if (input) input.value = state.query;
        document.querySelector('.home-main')?.scrollTo?.({ top: 0 });
        window.scrollTo({ top: 0 });
        remember();
    }
    function close() {
        if (!state.open) return;
        state.open = false;
        root.hidden = true;
        document.body.classList.remove('v2-hub-open');
        if (location.hash === '#tools' || location.hash === 'tools') {
            try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* noop */ }
            if (location.hash === '#tools' || location.hash === 'tools') location.hash = '';
        }
        window.dispatchEvent(new CustomEvent('home:hub', { detail: { open: false } }));
    }

    function onClick(event) {
        const tab = event.target.closest('[data-hub-tab]');
        if (!event.target.closest('.v2-hub-add')) toggleMenu(false);
        if (tab) {
            state.tab = tab.dataset.hubTab; state.cat = 'all'; state.query = ''; state.mine = false;
            if (state.tab !== 'tools' && (location.hash === '#tools' || location.hash === 'tools')) {
                try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* noop */ }
            }
            remember(); render(); window.dispatchEvent(new CustomEvent('home:hub', { detail: { open: true } })); return;
        }
        const cat = event.target.closest('[data-hub-cat]');
        if (cat) { state.cat = cat.dataset.hubCat; renderList(); return; }
        const sort = event.target.closest('[data-hub-sort]');
        if (sort) { state.sort = sort.dataset.hubSort; remember(); render(); return; }
        const doBtn = event.target.closest('[data-hub-do]');
        if (doBtn) {
            const what = doBtn.dataset.hubDo;
            if (what === 'shuffle') { state.seed += 1; renderList(); }
            else if (what === 'addMenu') toggleMenu();
            else if (what === 'mine') { state.mine = !state.mine; render(); }
            else if (what === 'find') { toggleMenu(false); state.mine = false; state.cat = 'all'; renderList(); root.querySelector('.v2-hub-search input')?.focus(); }
            else if (what === 'createSkill') { close(); window.HomeMode?.set?.('chat'); window.DragonClaw?.startWithSkill?.('create-skill'); }
            return;
        }
        const cardEl = event.target.closest('.v2-hub-card');
        if (!cardEl) return;
        const item = entries().find(entry => entry.key === cardEl.dataset.hubKey);
        if (!item || item.kind !== 'skill') return; // 工具与插件按普通链接打开
        const act = event.target.closest('[data-hub-act]')?.dataset.hubAct;
        const skill = window.HomeSkills?.items?.().find(s => s.id === item.id);
        if (act) {
            event.preventDefault();
            if (act === 'improve' && skill) { close(); window.HomeSkills.improve(skill); }
            else if (act === 'history' && skill) window.HomeSkills.showHistory(skill);
            return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        close();
        window.HomeMode?.set?.('chat');
        window.DragonClaw?.startWithSkill?.(item.id);
    }

    function init() {
        const main = document.querySelector('.home-main');
        if (!main || document.documentElement.dataset.ui !== 'v2') return;
        root = document.createElement('section');
        root.className = 'v2-hub';
        root.id = 'v2SkillHub';
        root.hidden = true;
        root.setAttribute('aria-label', t('skills'));
        main.prepend(root);
        root.addEventListener('click', onClick);
        document.addEventListener('click', event => { if (state.open && !root.contains(event.target)) toggleMenu(false); });
        // 菜单里的 data-v2-do（工具市场、上传）由 home-v2.js 执行，这里只负责收起菜单
        root.addEventListener('input', event => {
            if (!event.target.matches('.v2-hub-search input')) return;
            state.query = event.target.value;
            ensurePinyin();
            renderList();
        });
        // 侧栏其他入口（新建对话、频道、会话列表……）或切换对话/工具模式时收起
        document.getElementById('homeSidebar')?.addEventListener('click', event => {
            if (!state.open || event.target.closest('[data-v2-action="skillHub"], .v2-userbar, .v2-side-tools, #v2DiscoverBtn')) return;
            if (event.target.closest('button, a, [role="button"], [data-conversation-id]')) close();
        });
        window.addEventListener('home:mode', close);
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open && !document.querySelector('.v2-pop:not([hidden]), dialog[open]')) close(); });
        ['skills:changed', 'home:tools-updated', 'home:capabilities'].forEach(name => window.addEventListener(name, () => { if (state.open) setTimeout(renderList, 0); }));
        window.addEventListener('tools:languagechange', () => { if (state.open) render(); });
        const syncHash = () => {
            const h = location.hash.replace(/^#/, '');
            if (h === 'tools') open('tools');
            else if (!h && state.open) close();
        };
        window.addEventListener('hashchange', syncHash);
        if (location.hash === '#tools' || location.hash === 'tools') open('tools');
        window.dispatchEvent(new Event('home:skill-hub-ready'));
    }

    window.HomeSkillHub = { open, close, isOpen: () => state.open, tab: () => state.tab };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
