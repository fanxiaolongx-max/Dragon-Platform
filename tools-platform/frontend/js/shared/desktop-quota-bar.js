// 网页顶部额度栏：桌面版刘海额度栏（desktop-pet/quota-panel.js）的网页版。
// 连接本机桌面 Agent 并启用了 Codex / Claude Code / Antigravity 任一客户端时自动出现；
// 只能沿页面顶边左右拖动，外观默认跟随主页亮暗色。桌面专属功能（额度历史窗口、隐藏桌宠时保留）不在网页提供。
(function () {
    'use strict';
    if (window.ToolsDesktopQuotaBar) return;
    const API = '/api/desktop-agents';
    const PROVIDERS = [['codex', 'Codex'], ['claudecode', 'Claude Code'], ['antigravity', 'Antigravity']];
    const STORE = 'tools_desktop_quota_bar_v2'; // v1 默认自动收起；改为默认常驻后换键，旧的“自动收起”不再沿用
    const POLL_MS = 60000, TUCK_MS = 1400;
    const L = (zh, en) => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const english = () => L(false, true);
    let prefs = load(), root, panel, rows, peek, menu, sensor;
    let dragged = false, quotas = null, providers = [], active = false, pollTimer = 0, tuckTimer = 0, peekTimer = 0, inside = false, menuOpen = false, drag = null, peekProvider = null;

    let readingMode = document.body.classList.contains('dc-browser-open');
    const autoHide = () => readingMode || prefs.autoHide;
    const isExpanded = () => !readingMode && prefs.expanded;

    function load() {
        // 默认常驻；只有用户点 × 或在菜单里选择收起后，才收成顶边的小横条（悬停展开）
        const fallback = { hidden: false, expanded: false, theme: 'auto', autoHide: false, center: null };
        try { return { ...fallback, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return fallback; }
    }
    function save(patch) {
        prefs = { ...prefs, ...patch };
        try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch { /* 无痕模式下只在本页生效 */ }
    }
    async function request(path) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        const response = await fetch(API + path, { credentials: 'same-origin', cache: 'no-store', headers: token ? { Authorization: 'Bearer ' + token } : {} });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || 'HTTP ' + response.status), { status: response.status });
        return data;
    }
    function strings() {
        return english()
            ? { title: 'Account quota', five: '5 hours', week: 'Weekly', remaining: 'remaining', reset: 'Resets ', updated: 'Updated ', unknown: 'Plan unavailable', menu: 'Quota bar menu', hide: 'Tuck into the top edge', drag: 'Drag to slide along the top edge · double-click to center', footer: 'Hover for details · Drag to slide', expand: 'Show quota bar',
                compact: 'Compact quota bar', detailed: 'Detailed quota panel', appearance: 'Appearance', followHome: 'Match home page', light: 'Light', dark: 'Dark', center: 'Center at top edge', refresh: 'Refresh quotas', autoHide: 'Tuck into the top edge · hover to show', hideNote: 'Turn the quota bar off in Settings → Desktop Agent', trends: 'Click a quota for its usage trend', loading: 'Reading account quotas…',
                extraUsage: 'Spend limit', extraUsed: 'Used ', extraTotal: ' of ',
                states: { live: 'Live', cached: 'Cached', unavailable: 'Read failed', not_installed: 'Not installed', signed_out: 'Not signed in', api_key: 'API Key mode · no subscription quota', auth_required: 'Sign in again', offline: 'Not running', unsupported: 'Quota not provided', rate_limited: 'Rate limited', desktop_session_required: 'Open a Code session in Claude Desktop' } }
            : { title: '账户剩余额度', five: '5 小时', week: '每周', remaining: '剩余', reset: '重置于 ', updated: '更新于 ', unknown: '未提供订阅信息', menu: '额度栏菜单', hide: '收起到顶边', drag: '拖动沿页面顶部左右移动 · 双击居中', footer: '悬停查看详情 · 拖动左右移动', expand: '展开额度栏',
                compact: '精简额度栏', detailed: '详细额度面板', appearance: '外观', followHome: '跟随主页', light: '浅色', dark: '深色', center: '居中到页面顶部', refresh: '立即刷新额度', autoHide: '收起到顶边 · 悬停展开', hideNote: '完全关闭额度栏：全局设置 → 桌面 Agent', trends: '点击额度查看使用趋势', loading: '正在读取账户额度…',
                extraUsage: '用量额度', extraUsed: '已用 ', extraTotal: '，共 ',
                states: { live: '实时', cached: '缓存', unavailable: '读取失败', not_installed: '未安装', signed_out: '未登录', api_key: 'API Key 模式 · 无订阅额度', auth_required: '需要重新登录', offline: '未运行', unsupported: '未提供额度', rate_limited: '查询受限', desktop_session_required: '请在 Claude 桌面版打开 Code 会话' } };
    }
    const time = value => { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? d.toLocaleString(english() ? 'en-US' : 'zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''; };
    const nameOf = id => id === 'antigravity' && !english() ? '反重力' : PROVIDERS.find(([key]) => key === id)[1];
    function formatMoney(amount, currency = 'USD') {
        if (typeof amount !== 'number' || !Number.isFinite(amount)) return '';
        const symbol = currency === 'USD' ? 'US$' : currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : currency + ' ';
        return symbol + amount.toFixed(2);
    }
    function extraUsageBlock(source, className) {
        const extra = source?.extraUsage;
        if (!['live', 'cached'].includes(source?.status)) return null;
        if (!extra?.enabled || !Number.isFinite(extra.used) || extra.used < 0) return null;
        const t = strings(), block = el('div', className), head = el('div', 'dqb-extra-head');
        const limit = Number.isFinite(extra.limit) && extra.limit >= 0 ? t.extraTotal + formatMoney(extra.limit, extra.currency) : '';
        head.append(el('span', 'dqb-extra-title', t.extraUsage),
            el('span', 'dqb-extra-text', t.extraUsed + formatMoney(extra.used, extra.currency) + limit));
        block.append(head);
        if (Number.isFinite(extra.percent) && extra.percent >= 0) {
            const track = el('span', 'dqb-extra-track'), fill = el('i');
            fill.style.transform = `scaleX(${Math.min(100, extra.percent) / 100})`;
            track.append(fill); block.append(track);
            block.title = t.extraUsage + ' · ' + Math.round(extra.percent) + '% ' + (english() ? 'used' : '已用');
        }
        return block;
    }
    // Antigravity 有 Gemini 与 Claude / GPT 两组额度：额度栏显示 Gemini 组，详情里两组都显示（同 id 的重复组只取第一组）
    function groupsOf(id) {
        const seen = new Set();
        return (quotas?.[id]?.groups || []).filter(g => !seen.has(g.id) && seen.add(g.id));
    }
    function windowOf(group, id) {
        const w = group?.windows?.find(item => item.id === id);
        const value = typeof w?.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) ? Math.max(0, Math.min(100, w.remainingPercent)) : null;
        return { value, reset: time(w?.resetsAt) };
    }
    function stateText(id) {
        const source = quotas?.[id], t = strings();
        return !quotas ? t.loading : !source ? t.states.unavailable : t.states[source.status] || t.states.unavailable;
    }
    function usable(id) { return ['live', 'cached'].includes(quotas?.[id]?.status); }

    function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
    function cell(windowId) {
        const node = el('div', 'dqb-cell'); node.dataset.window = windowId;
        const label = el('span', 'dqb-window'), value = el('div', 'dqb-value'), digits = el('span'), unit = el('span', 'dqb-percent', '%');
        value.append(digits, unit);
        const track = el('span', 'dqb-track'), fill = el('i'); track.append(fill);
        node.append(label, value, track, el('span', 'dqb-reset'));
        node.tabIndex = 0; node.setAttribute('role', 'button');
        const open = () => { const provider = node.closest('[data-provider]')?.dataset.provider || peekProvider; if (provider) openTrends(provider, node.dataset.group || groupsOf(provider)[0]?.id || provider, windowId); };
        node.addEventListener('click', event => { event.stopPropagation(); if (!dragged) open(); });
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
        return node;
    }
    function paintCell(node, id, data) {
        const t = strings(), value = usable(id) ? data.value : null;
        node.className = 'dqb-cell' + (value === null ? ' unknown' : value <= 20 ? ' low' : value <= 40 ? ' warning' : '');
        node.querySelector('.dqb-window').textContent = node.dataset.window === '5h' ? t.five : t.week;
        node.querySelector('.dqb-value span').textContent = value === null ? '—' : String(Math.round(value));
        node.querySelector('.dqb-percent').hidden = value === null;
        node.querySelector('.dqb-track i').style.transform = 'scaleX(' + (value === null ? 0 : value / 100) + ')';
        node.querySelector('.dqb-reset').textContent = data.reset ? t.reset + data.reset : '—';
        node.setAttribute('aria-label', nameOf(id) + ' · ' + node.querySelector('.dqb-window').textContent + ' · ' + (value === null ? stateText(id) : Math.round(value) + '% ' + t.remaining));
    }

    function build() {
        root = el('div', 'dqb'); root.hidden = true; root.setAttribute('role', 'region');
        root.innerHTML = `<div class="dqb-glow" aria-hidden="true"></div><button type="button" class="dqb-sensor"><span></span></button>
            <section class="dqb-panel"><header class="dqb-head"><span class="dqb-grip" aria-hidden="true">⠿</span><span class="dqb-heading"><small>DRAGON · AGENTS</small><span class="dqb-title"></span></span><span class="dqb-live" aria-hidden="true"></span><button type="button" data-dqb-menu aria-haspopup="menu">···</button></header>
            <div class="dqb-rows"></div><footer class="dqb-foot"></footer></section>
            <aside class="dqb-peek" hidden></aside><div class="dqb-menu" role="menu" hidden></div>`;
        panel = root.querySelector('.dqb-panel'); rows = root.querySelector('.dqb-rows'); peek = root.querySelector('.dqb-peek'); menu = root.querySelector('.dqb-menu'); sensor = root.querySelector('.dqb-sensor');
        document.body.append(root);
        panel.addEventListener('pointerenter', reveal);
        panel.addEventListener('pointerleave', () => { if (drag) return; inside = false; hidePeek(); if (autoHide() && !isExpanded()) scheduleTuck(); else cancelTuck(); });
        sensor.addEventListener('pointerenter', reveal); sensor.addEventListener('click', reveal);
        panel.addEventListener('pointerdown', startDrag);
        panel.querySelector('.dqb-head').addEventListener('dblclick', event => { if (!event.target.closest('button')) center(); });
        root.querySelector('[data-dqb-menu]').addEventListener('click', event => { event.stopPropagation(); menuOpen ? closeMenu() : openMenu(); });
        peek.addEventListener('pointerenter', () => clearTimeout(peekTimer));
        peek.addEventListener('pointerleave', () => { hidePeek(); if (autoHide() && !isExpanded()) scheduleTuck(); else cancelTuck(); });
        document.addEventListener('pointerdown', event => { if (menuOpen && !menu.contains(event.target) && !event.target.closest('[data-dqb-menu]')) closeMenu(); }, true);
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || root.hidden) return;
            if (menuOpen) closeMenu(); else if (autoHide() && !isExpanded()) tuck();
        });
        window.addEventListener('resize', place);
        // 主页切换亮暗色时同步
        new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    }
    function renderRows() {
        rows.replaceChildren();
        rows.style.setProperty('--count', providers.length);
        for (const id of providers) {
            const row = el('div', 'dqb-row ' + id); row.dataset.provider = id;
            const brand = el('div', 'dqb-brand'), name = el('div', 'dqb-name'), icon = el('img', 'dqb-icon');
            icon.src = '/assets/desktop-agents/' + id + '.png'; icon.alt = ''; icon.draggable = false;
            name.append(icon, el('span', 'dqb-label'));
            const meta = el('div', 'dqb-meta'); meta.append(el('span', 'dqb-plan'), el('span', 'dqb-detail'));
            brand.append(name, meta);
            const extraBlock = el('div', 'dqb-row-extra'); extraBlock.hidden = true;
            row.append(brand, cell('5h'), cell('weekly'), extraBlock);
            row.addEventListener('pointerenter', () => { clearTimeout(peekTimer); if (!drag && !isExpanded()) peekTimer = setTimeout(() => showPeek(id, row), 80); });
            row.addEventListener('pointerleave', () => { clearTimeout(peekTimer); peekTimer = setTimeout(hidePeek, 120); });
            rows.append(row);
        }
    }
    function render() {
        if (!root) return;
        const t = strings();
        root.querySelector('.dqb-title').textContent = t.title;
        root.querySelector('.dqb-foot').textContent = t.footer;
        root.setAttribute('aria-label', t.title);
        panel.title = t.drag; sensor.setAttribute('aria-label', t.expand);
        root.querySelector('[data-dqb-menu]').setAttribute('aria-label', t.menu);
        root.classList.toggle('expanded', isExpanded());
        for (const row of rows.children) {
            const id = row.dataset.provider, group = groupsOf(id)[0], source = quotas?.[id];
            row.classList.toggle('cached', source?.status === 'cached');
            row.querySelector('.dqb-label').textContent = nameOf(id);
            row.querySelector('.dqb-plan').textContent = source?.membership?.label || '';
            row.querySelector('.dqb-plan').title = source?.membership?.label || t.unknown;
            row.querySelector('.dqb-detail').textContent = source?.status === 'live' ? '' : stateText(id);
            row.setAttribute('aria-label', nameOf(id) + ' · ' + stateText(id));
            row.querySelectorAll('.dqb-cell').forEach(node => paintCell(node, id, windowOf(group, node.dataset.window)));
            const extraBlock = row.querySelector('.dqb-row-extra');
            const nextExtra = isExpanded() ? extraUsageBlock(source, 'dqb-row-extra') : null;
            extraBlock.hidden = !nextExtra;
            extraBlock.replaceChildren(...(nextExtra ? nextExtra.childNodes : []));
            extraBlock.title = nextExtra?.title || '';
        }
        root.querySelector('.dqb-live').style.opacity = providers.some(id => quotas?.[id]?.status === 'live') ? '1' : '.25';
        if (peekProvider) fillPeek(peekProvider);
        applyTheme(); place();
    }
    function applyTheme() {
        if (!root) return;
        const page = document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        root.dataset.theme = prefs.theme === 'auto' ? page : prefs.theme;
    }

    // 位置记为刘海中心占页面宽度的比例：窗口缩放后仍在相对相同的位置
    function place() {
        if (!root || root.hidden) return;
        const width = root.offsetWidth, max = Math.max(0, window.innerWidth - width);
        const centerRatio = Number.isFinite(prefs.center) ? prefs.center : 0.5;
        root.style.left = Math.round(Math.max(0, Math.min(max, centerRatio * window.innerWidth - width / 2))) + 'px';
    }
    function center() { save({ center: 0.5 }); place(); }
    function startDrag(event) {
        if (event.button !== 0 || event.target.closest('button')) return;
        cancelTuck(); hidePeek(); closeMenu();
        drag = { id: event.pointerId, x: event.clientX, left: root.offsetLeft, moved: false };
        const move = e => {
            if (e.pointerId !== drag?.id) return;
            if (!drag.moved) { if (Math.abs(e.clientX - drag.x) <= 3) return; drag.moved = true; panel.setPointerCapture(drag.id); root.classList.add('dragging'); }
            const max = Math.max(0, window.innerWidth - root.offsetWidth);
            root.style.left = Math.round(Math.max(0, Math.min(max, drag.left + e.clientX - drag.x))) + 'px';
        };
        const end = e => {
            if (e.pointerId !== drag?.id) return;
            window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
            // 真的拖动过才算拖动；只是点一下额度时照常打开趋势窗口
            dragged = drag.moved; setTimeout(() => { dragged = false; }, 0);
            drag = null; root.classList.remove('dragging');
            save({ center: (root.offsetLeft + root.offsetWidth / 2) / Math.max(1, window.innerWidth) });
            if (!panel.matches(':hover')) { inside = false; if (autoHide() && !isExpanded()) scheduleTuck(); else cancelTuck(); }
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
    }

    function reveal() { inside = true; cancelTuck(); root.classList.remove('tucked'); }
    function cancelTuck() { clearTimeout(tuckTimer); }
    function tuck() {
        cancelTuck();
        if (!autoHide() || isExpanded()) {
            root?.classList.remove('tucked');
            return;
        }
        hidePeek(); closeMenu(); root.classList.add('tucked');
    }
    function scheduleTuck() {
        cancelTuck();
        if (inside || drag || menuOpen || peekProvider || !autoHide() || isExpanded() || root.classList.contains('trends-open')) return;
        tuckTimer = setTimeout(() => {
            if (!autoHide() || isExpanded()) return;
            if (!panel.matches(':hover') && !peek.matches(':hover')) tuck();
        }, TUCK_MS);
    }

    function showPeek(id, row) {
        peekProvider = id; fillPeek(id); peek.hidden = false;
        const rect = row.getBoundingClientRect(), width = peek.offsetWidth;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
        peek.style.left = left + 'px'; peek.style.top = (panel.getBoundingClientRect().bottom + 10) + 'px';
        peek.style.setProperty('--pointer', Math.max(24, Math.min(width - 24, rect.left + rect.width / 2 - left)) + 'px');
        requestAnimationFrame(() => peek.classList.add('visible'));
    }
    function hidePeek() { if (peek?.matches(':hover')) return; peekProvider = null; if (peek) { peek.classList.remove('visible'); peek.hidden = true; } }
    function fillPeek(id) {
        const t = strings(), source = quotas?.[id], groups = groupsOf(id);
        peek.replaceChildren(); peek.dataset.provider = id;
        const top = el('div', 'dqb-peek-top'), icon = el('img'); icon.src = '/assets/desktop-agents/' + id + '.png'; icon.alt = '';
        top.append(icon, el('strong', '', nameOf(id)), el('span', 'dqb-peek-plan', source?.membership?.label || ''));
        const status = el('div', 'dqb-peek-status'); status.append(el('span', '', stateText(id)), el('span', '', t.remaining));
        const list = el('div', 'dqb-peek-groups');
        for (const group of groups.length ? groups : [null]) {
            const block = el('div', 'dqb-peek-group');
            if (id === 'antigravity' && group) block.append(el('small', '', group.id === 'gemini' ? 'Gemini' : group.id === 'third-party' ? 'Claude / GPT' : group.label || group.id));
            const quotasEl = el('div', 'dqb-peek-quotas');
            for (const windowId of ['5h', 'weekly']) { const node = cell(windowId); if (group) node.dataset.group = group.id; paintCell(node, id, windowOf(group, windowId)); quotasEl.append(node); }
            block.append(quotasEl); list.append(block);
        }
        const foot = el('div', 'dqb-peek-foot'); foot.append(el('span', '', source?.updatedAt ? t.updated + time(source.updatedAt) : ''), el('span', '', t.trends));
        const extra = extraUsageBlock(source, 'dqb-peek-extra');
        peek.append(top, status, list);
        if (extra) peek.append(extra);
        peek.append(foot);
        peek.setAttribute('aria-label', nameOf(id) + ' · ' + t.title);
    }

    function openMenu() {
        const t = strings();
        const item = (label, action, checked, role = checked === undefined ? 'menuitem' : 'menuitemradio') => {
            const b = el('button', '', label);
            b.type = 'button';
            b.setAttribute('role', role);
            if (checked !== undefined) b.setAttribute('aria-checked', String(checked));
            b.addEventListener('click', () => {
                action();
                closeMenu();
            });
            return b;
        };
        menu.replaceChildren(
            item(t.compact, () => setExpanded(false), !isExpanded()), item(t.detailed, () => setExpanded(true), isExpanded()), el('hr'),
            el('small', '', t.appearance),
            ...[['auto', t.followHome], ['light', t.light], ['dark', t.dark]].map(([theme, label]) => item(label, () => { save({ theme }); applyTheme(); }, prefs.theme === theme)),
            item(t.center, center), el('hr'),
            item(t.refresh, () => refresh(true)),
            item(t.autoHide, () => {
                const next = !autoHide();
                save({ autoHide: next });
                if (next) {
                    inside = false;
                    tuck();
                } else {
                    cancelTuck();
                    root.classList.remove('tucked');
                }
            }, autoHide(), 'menuitemcheckbox'),
            el('small', '', t.hideNote)
        );
        menuOpen = true; cancelTuck(); hidePeek(); menu.hidden = false;
        const button = root.querySelector('[data-dqb-menu]').getBoundingClientRect();
        menu.style.top = (button.bottom + 8) + 'px';
        menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, button.right - menu.offsetWidth)) + 'px';
        menu.querySelector('button')?.focus({ preventScroll: true });
    }
    function closeMenu() {
        if (!menuOpen) return;
        menuOpen = false;
        menu.hidden = true;
        if (autoHide() && !isExpanded()) scheduleTuck();
        else cancelTuck();
    }
    function setExpanded(expanded) {
        save({ expanded });
        root.classList.remove('tucked');
        render();
        if (autoHide() && !expanded) scheduleTuck();
        else cancelTuck();
    }

    // 额度使用趋势：与桌面版趋势窗口同一数据与画法（PetQuotaChart），数据来自服务端额度历史（桌面应用与网页读取都会记录）
    const COLORS = ['#74cdb8', '#d6b479', '#a49de0', '#dc9a80', '#73b9d9', '#ca9cc0'];
    let trendsEl = null, trendsState = null, trendsSeq = 0;
    function seriesLabel(provider, s) {
        const t = strings(), period = s.windowId === '5h' ? t.five : s.windowId === 'weekly' ? t.week : s.windowLabel ? t.week + ' · ' + s.windowLabel : s.durationMinutes ? s.durationMinutes + ' min' : s.windowId;
        const name = provider === 'antigravity' ? (s.groupId === 'gemini' ? 'Gemini' : s.groupId === 'third-party' ? 'Claude / GPT' : s.groupLabel || s.groupId) : nameOf(provider);
        return name + ' · ' + period;
    }
    function openTrends(provider, groupId, windowId) {
        hidePeek(); closeMenu(); cancelTuck();
        trendsState = { provider, groupId, windowId, days: 1, metric: 'remaining', data: null, failed: false, busy: false };
        if (!trendsEl) {
            trendsEl = el('div', 'dqb-trends'); trendsEl.hidden = true;
            trendsEl.innerHTML = `<div class="dqb-trends-card" role="dialog" aria-modal="true"><header><div><small>DRAGON · ACCOUNT INSIGHTS</small><h3 data-t="title"></h3></div><button type="button" data-t="close" aria-label="×">×</button></header>
                <div class="dqb-trends-filters"><label><span data-t="providerLabel"></span><select data-t="provider"></select></label><label class="wide"><span data-t="seriesLabel"></span><select data-t="series"></select></label><label><span data-t="rangeLabel"></span><select data-t="range"></select></label><label><span data-t="metricLabel"></span><select data-t="metric"></select></label></div>
                <div class="dqb-trends-summary"><div><span data-t="latestLabel"></span><strong data-t="latest">—</strong></div><div><span data-t="samplesLabel"></span><strong data-t="samples">0</strong></div><div><span data-t="updatedLabel"></span><strong data-t="updated">—</strong></div></div>
                <div class="dqb-trends-chart"><svg data-t="chart" viewBox="0 0 680 240" role="img"></svg><p data-t="empty" hidden></p><div data-t="legend" class="dqb-trends-legend"></div></div>
                <p data-t="note" class="dqb-trends-note"></p></div>`;
            root.append(trendsEl);
            const q = name => trendsEl.querySelector(`[data-t="${name}"]`);
            trendsEl.addEventListener('pointerdown', event => { if (event.target === trendsEl) closeTrends(); });
            q('close').addEventListener('click', closeTrends);
            q('provider').addEventListener('change', () => { const p = q('provider').value; Object.assign(trendsState, { provider: p, groupId: groupsOf(p)[0]?.id || p }); loadTrends(); });
            q('series').addEventListener('change', () => { const [groupId, windowId] = q('series').value.split(':'); if (windowId) Object.assign(trendsState, { groupId, windowId }); else trendsState.compare = true; drawTrends(); });
            q('range').addEventListener('change', () => { trendsState.days = Number(q('range').value); loadTrends(); });
            q('metric').addEventListener('change', () => { trendsState.metric = q('metric').value; drawTrends(); });
            document.addEventListener('keydown', event => { if (event.key === 'Escape' && trendsEl && !trendsEl.hidden) { event.stopPropagation(); closeTrends(); } }, true);
            window.addEventListener('resize', () => { if (!trendsEl.hidden) drawTrends(); });
        }
        trendsEl.hidden = false; root.classList.add('trends-open');
        requestAnimationFrame(() => trendsEl.classList.add('visible'));
        loadTrends();
        trendsEl.querySelector('[data-t="close"]').focus({ preventScroll: true });
    }
    function closeTrends() { if (!trendsEl) return; trendsSeq++; trendsEl.classList.remove('visible'); trendsEl.hidden = true; root.classList.remove('trends-open'); scheduleTuck(); }
    async function loadTrends() {
        const state = trendsState, version = ++trendsSeq;
        Object.assign(state, { busy: true, failed: false, compare: false }); drawTrends();
        try { const data = await request(`/quota/history?provider=${encodeURIComponent(state.provider)}&days=${state.days}`); if (version === trendsSeq) state.data = data; }
        catch { if (version === trendsSeq) { state.data = null; state.failed = true; } }
        if (version === trendsSeq) { state.busy = false; drawTrends(); }
    }
    function drawTrends() {
        if (!trendsEl || !trendsState) return;
        const t = strings(), en = english(), tr = (zh, e) => en ? e : zh, q = name => trendsEl.querySelector(`[data-t="${name}"]`), state = trendsState, data = state.data;
        const fill = (select, options, value) => { select.replaceChildren(...options.map(([v, text]) => { const o = el('option', '', text); o.value = v; return o; })); select.value = value; };
        q('title').textContent = tr('额度使用趋势', 'Quota trends');
        for (const [id, zh, e] of [['providerLabel', '服务商', 'Provider'], ['seriesLabel', '额度 / 模型组', 'Quota / model group'], ['rangeLabel', '时间范围', 'Time range'], ['metricLabel', '显示', 'Show'], ['latestLabel', '最新剩余', 'Latest remaining'], ['samplesLabel', '图中采样点', 'Plotted samples'], ['updatedLabel', '最新采样时间', 'Latest sample']]) q(id).textContent = tr(zh, e);
        q('close').setAttribute('aria-label', tr('关闭', 'Close'));
        fill(q('provider'), providers.map(id => [id, nameOf(id)]), state.provider);
        fill(q('range'), [['1', tr('近 24 小时', 'Last 24 hours')], ['7', tr('近 7 天', 'Last 7 days')], ['30', tr('近 30 天', 'Last 30 days')], ['90', tr('近 90 天', 'Last 90 days')]], String(state.days));
        fill(q('metric'), [['remaining', tr('剩余比例 %', 'Remaining %')], ['used', tr('已用比例 %', 'Used %')]], state.metric);
        const series = data?.series || [], current = state.groupId + ':' + state.windowId;
        const options = series.map(s => [s.groupId + ':' + s.windowId, seriesLabel(state.provider, s)]);
        if (!options.some(([v]) => v === current)) options.unshift([current, seriesLabel(state.provider, { groupId: state.groupId, windowId: state.windowId })]);
        if (series.filter(s => s.windowId === state.windowId).length > 1) options.push(['compare', tr('同周期额度对比', 'Compare pools')]);
        fill(q('series'), options, state.compare ? 'compare' : current);
        const chart = q('chart'), width = Math.max(300, chart.clientWidth || 680), height = window.innerHeight < 700 ? 200 : 240;
        chart.replaceChildren(); q('legend').replaceChildren(); chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
        const svgEl = (name, attrs = {}, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); if (text !== undefined) n.textContent = text; return n; };
        const now = Date.now(), from = data?.from || now - state.days * 86400000, to = data?.to || now;
        for (const v of [0, 25, 50, 75, 100]) { const y = 22 + (100 - v) * (height - 62) / 100; chart.append(svgEl('line', { x1: 56, y1: y, x2: width - 24, y2: y, class: 'grid' }), svgEl('text', { x: 44, y: y + 3, 'text-anchor': 'end' }, v + '%')); }
        const ticks = width < 500 ? 2 : 4;
        for (let i = 0; i <= ticks; i++) chart.append(svgEl('text', { x: 56 + i * (width - 80) / ticks, y: height - 14, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, time(from + (to - from) * i / ticks)));
        const chosen = series.filter(s => state.compare ? s.windowId === state.windowId : s.groupId + ':' + s.windowId === current);
        const all = chosen.flatMap(s => s.points), latest = all.reduce((a, p) => !a || p.at > a.at ? p : a, null);
        q('latest').textContent = chosen.length === 1 && latest ? Math.round(latest.remaining) + '%' : '—';
        q('samples').textContent = String(all.length); q('updated').textContent = latest ? time(latest.at) : '—';
        chosen.forEach((s, index) => {
            const color = COLORS[index % COLORS.length];
            for (const segment of window.PetQuotaChart?.paths(s.points, from, to, data.step, state.metric === 'used', width, height, s) || []) {
                if (segment.areaD && segment.points.length > 1) {
                    chart.append(svgEl('path', { d: segment.areaD, fill: color, 'fill-opacity': '0.08', stroke: 'none', 'pointer-events': 'none' }));
                }
                if (segment.d) {
                    chart.append(svgEl('path', { d: segment.d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
                }
                segment.points.forEach((point, pIdx) => {
                    const isSingle = segment.points.length === 1;
                    const isLast = pIdx === segment.points.length - 1;
                    const titleText = seriesLabel(state.provider, s) + '\n' + time(point.at) + '\n' + tr('剩余 ', 'Remaining ') + Math.round(point.remaining) + '%' + (point.resetsAt ? '\n' + tr('重置：', 'Resets: ') + time(point.resetsAt) : '');
                    if (isSingle || isLast) {
                        const tipDot = svgEl('circle', {
                            cx: point.x, cy: point.y,
                            r: isSingle ? 3.5 : 3,
                            fill: color,
                            stroke: 'var(--surface, #101113)',
                            'stroke-width': 1.5,
                            class: 'trend-endpoint'
                        });
                        tipDot.append(svgEl('title', {}, titleText));
                        chart.append(tipDot);
                    }
                    const hitDot = svgEl('circle', {
                        cx: point.x, cy: point.y,
                        r: 6,
                        fill: color,
                        'fill-opacity': '0',
                        class: 'trend-hit'
                    });
                    hitDot.append(svgEl('title', {}, titleText));
                    chart.append(hitDot);
                });
            }
            const item = el('span'), mark = el('i'); mark.style.background = color; item.append(mark, document.createTextNode(seriesLabel(state.provider, s))); q('legend').append(item);
        });
        chart.setAttribute('aria-label', tr('额度百分比时间曲线', 'Quota percentage over time'));
        q('empty').hidden = all.length > 1 || state.busy;
        q('empty').textContent = state.failed ? tr('额度历史暂时不可用，请稍后重试。', 'Quota history is unavailable. Try again later.') : all.length === 1 ? tr('已记录第一个采样点，后续读取会逐渐形成曲线。', 'First sample recorded. Future reads will build the curve.') : tr('此时间段暂无记录：桌面应用运行或网页额度栏打开时才会采样。', 'No samples in this period. Samples are taken while the desktop app runs or this quota bar is open.');
        q('note').textContent = state.busy ? tr('正在读取额度历史…', 'Reading quota history…') : (data?.firstSampleAt ? tr('开始记录于 ', 'Recording since ') + time(data.firstSampleAt) + ' · ' : '') + tr('曲线是账户或模型共享池的额度百分比，不是 token 数；重置、额度回升或较长停采会断开曲线。保存最近 90 天。', 'Percentages of account or shared model quotas, not token counts. Resets, quota increases and sampling gaps break the line. Kept for 90 days.');
    }

    async function refresh(force = false) {
        try {
            const data = await request('/quota' + (force ? '?refresh=1' : ''));
            quotas = data.quotas || {};
            if (data.providers.join() !== providers.join()) { providers = data.providers; renderRows(); }
            if (!providers.length) return stop();
            render();
        } catch (error) { if ([401, 403, 404, 409].includes(error.status)) stop(); }
    }
    function start(list) {
        if (!root) build();
        if (list.join() !== providers.join()) { providers = list; renderRows(); }
        if (active) return;
        active = true; root.hidden = false; render();
        if (autoHide() && !isExpanded()) root.classList.add('tucked');
        refresh();
        pollTimer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    }
    function stop() {
        active = false; clearInterval(pollTimer); cancelTuck();
        if (root) { closeMenu(); hidePeek(); root.hidden = true; }
    }
    // 是否显示：本机桌面 Agent 已连接、本账号拥有、至少启用了一家有额度的客户端，且本浏览器没有手动隐藏
    async function sync() {
        // 桌面应用自带原生刘海额度栏；网页版再出现会重复，且顶部按钮会占掉窗口拖动区
        if (window.DragonWindow || document.documentElement.classList.contains('is-desktop-app')) return stop();
        if (prefs.hidden || !(localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token'))) return stop();
        try {
            const data = await request('/settings'), cfg = data.settings;
            const list = data.owned && cfg?.enabled ? PROVIDERS.map(([id]) => id).filter(id => cfg.providers?.[id]) : [];
            list.length ? start(list) : stop();
        } catch { stop(); }
    }
    function setHidden(hidden) { save({ hidden: Boolean(hidden) }); sync(); }
    function setReadingMode(enabled) {
        if (readingMode === Boolean(enabled)) return;
        readingMode = Boolean(enabled);
        if (!root) return;
        cancelTuck();
        if (readingMode) { inside = false; hidePeek(); closeMenu(); }
        render();
        if (autoHide() && !isExpanded()) tuck(); else root.classList.remove('tucked');
    }
    window.addEventListener('dragon-claw:browser-reading', event => setReadingMode(event.detail?.active));
    window.addEventListener('tools:desktop-agent-settings-changed', sync);
    window.addEventListener('tools:languagechange', render);
    document.addEventListener('visibilitychange', () => { if (active && document.visibilityState === 'visible') refresh(); });
    window.ToolsDesktopQuotaBar = { sync, refresh, setReadingMode, setHidden, isHidden: () => prefs.hidden, isActive: () => active };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
