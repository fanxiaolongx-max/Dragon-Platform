// Dragon 浏览器侧栏：桌面端移动现有 BrowserView，Web 端提供受站点嵌入策略约束的预览。
(function () {
    'use strict';
    const bridge = window.DragonBrowser;
    const en = () => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '');
    const L = (zh, english) => en() ? english : zh;
    const esc = value => String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    let panel, surface, toggle, address, tabsNode, hint, open = false, suspended = new Set(), state = { tabs: [] }, connected = false, docked = false, raf = 0;
    let webTabs = [], webActive = '', sequence = 0;
    let agentMode = false, agentView = null, agentImage, agentStatus, viewEpoch = 0, viewController = null;
    let previousMenu = null, autoFit = true, pagePixelWidth = 0, readingVisible = false;
    function fitReadingWidth() {
        if (!open || !autoFit) return;
        const main = document.querySelector('.home-main');
        const available = innerWidth - Math.max(0, main?.getBoundingClientRect().left || 0);
        const width = innerWidth <= 860 ? innerWidth - 32
            : pagePixelWidth > 0 && pagePixelWidth <= 600 ? Math.max(320, pagePixelWidth + 32)
            : Math.min(1280, Math.max(720, Math.round(available * .7)));
        window.SidebarResize?.setWidth(panel, width);
    }
    function collapseMenu() {
        const v2 = document.documentElement.dataset.ui === 'v2';
        previousMenu = { v2, collapsed: document.body.classList.contains(v2 ? 'v2-side-collapsed' : 'home-sidebar-collapsed') };
        if (v2 && window.HomeV2?.setSideCollapsed) window.HomeV2.setSideCollapsed(true, { remember:false });
        else document.body.classList.add(v2 ? 'v2-side-collapsed' : 'home-sidebar-collapsed');
        autoFit = true;
    }
    function restoreMenu() {
        if (!previousMenu) return;
        const { v2, collapsed } = previousMenu;
        if (innerWidth <= 860 && v2) {
            if (window.HomeV2?.setSideCollapsed) window.HomeV2.setSideCollapsed(true, { remember:false });
            else { document.body.classList.add('v2-side-collapsed'); document.body.classList.remove('v2-mobile-side-open'); }
            previousMenu = null; return;
        }
        const key = v2 ? 'v2-side-collapsed' : 'home-sidebar-collapsed';
        // 用户在浏览期间主动展开菜单时，保留他的选择。
        if (document.body.classList.contains(key)) {
            if (v2 && window.HomeV2?.setSideCollapsed) window.HomeV2.setSideCollapsed(collapsed, { remember:false });
            else document.body.classList.toggle(key, collapsed);
        }
        previousMenu = null;
    }
    function bounds() {
        raf = 0;
        if (!bridge || !connected) return;
        const modal = [...document.querySelectorAll('[aria-modal="true"],.app-dialog,.modal.open')].some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
        if (!open || suspended.size || document.hidden || document.body.classList.contains('dc-sidebar-resizing') || modal) return bridge.bounds(null);
        const rect = surface.getBoundingClientRect();
        bridge.bounds(rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
    }
    function layout() { if (!raf) raf = requestAnimationFrame(bounds); }
    function visibility() {
        const visible = open && !suspended.size;
        panel.hidden = !visible;
        document.body.classList.toggle('dc-browser-open', visible);
        toggle.setAttribute('aria-pressed', String(visible));
        if (readingVisible !== visible) {
            readingVisible = visible;
            bridge?.reading?.(visible);
            window.dispatchEvent(new CustomEvent('dragon-claw:browser-reading', { detail:{ active:visible } }));
        }
        layout();
    }
    async function show() {
        window.ChatFiles?.closePreview();
        window.DragonClawWorkspace?.closePanel?.();
        const fresh = !open;
        if (fresh) collapseMenu();
        open = true;
        if (bridge && (!connected || !docked)) { connected = await bridge.connect().catch(() => false); docked = connected; }
        visibility();
        if (fresh) requestAnimationFrame(fitReadingWidth);
        if (bridge && connected && !state.tabs.length) bridge.action('new-tab');
        if (!bridge && !agentMode && !webTabs.length) webNew();
    }
    function close() { open = false; restoreMenu(); viewEpoch++; viewController?.abort(); visibility(); }
    function render() {
        const current = agentMode ? agentView : state.tabs.find(tab => tab.id === state.activeId);
        address.readOnly = agentMode;
        panel.querySelector('[type=submit]').disabled = agentMode;
        tabsNode.parentElement.hidden = agentMode;
        panel.querySelector('[data-browser=agent-view]').hidden = Boolean(bridge);
        panel.querySelector('[data-browser=agent-view]').textContent = agentMode ? L('网页预览','Web preview') : L('AI 画面','AI view');
        agentImage.parentElement.hidden = !agentMode;
        for (const tab of webTabs) tab.frame.hidden = agentMode || tab.id !== webActive;
        tabsNode.innerHTML = state.tabs.map(tab => `<span class="dc-browser-tab" aria-current="${tab.id === state.activeId}"><button type="button" data-tab="${esc(tab.id)}" title="${esc(tab.url)}">${esc(tab.title || L('新标签页','New tab'))}</button><button type="button" data-close-tab="${esc(tab.id)}" aria-label="${L('关闭标签','Close tab')}">×</button></span>`).join('');
        if (agentMode || document.activeElement !== address) address.value = current?.url === 'about:blank' ? '' : current?.url || '';
        panel.querySelector('[data-browser=back]').disabled = !bridge || !state.canBack;
        panel.querySelector('[data-browser=forward]').disabled = !bridge || !state.canForward;
        panel.querySelector('[data-browser=popout]').hidden = !bridge;
        const labels = { back: L('后退','Back'), forward: L('前进','Forward'), reload: L('刷新网页','Reload'), close: L('关闭浏览器','Close browser'), 'new-tab': L('新标签页','New tab'), popout: L('独立窗口','Separate window'), external: L('在外部浏览器打开','Open externally') };
        for (const [name, label] of Object.entries(labels)) {
            const button = panel.querySelector(`[data-browser="${name}"]`);
            button.title = label; button.setAttribute('aria-label', label);
        }
        panel.setAttribute('aria-label', L('内置浏览器','Built-in browser'));
        panel.querySelector('[type=submit]').setAttribute('aria-label', L('打开网址','Go'));
        panel.querySelector('[data-browser=new-tab]').title = L('新标签页','New tab');
        panel.querySelector('[data-browser=external]').title = L('在外部浏览器打开','Open externally');
        panel.querySelector('[data-browser=popout]').title = L('独立窗口','Separate window');
        address.placeholder = L('输入网址','Enter a URL');
        address.setAttribute('aria-label', L('网址','URL'));
        toggle.textContent = L('浏览器','Browser');
        panel.querySelector('strong').textContent = L('Dragon 浏览器','Dragon Browser');
        hint.textContent = bridge ? L('与 Dragon 浏览器共用标签页，平台 AI 通过该浏览器打开的网页会显示在这里。','Shares Dragon Browser tabs. Pages opened through it by the platform AI appear here.') : L('仅支持允许嵌入的网站；若页面空白或拒绝连接，请点 ↗ 在新标签页打开。此预览不与 AI 的服务端浏览器共享登录态或操作。','Only sites permitting embedding can appear here. If blank or blocked, use ↗. This preview is separate from the AI server browser and its sign-in.');
        if (agentMode) hint.textContent = L('AI 浏览器的真实画面（只读截图）。操作请在对话里告诉 AI；点 ↻ 更新画面。','Actual AI browser view (read-only screenshot). Ask the AI to interact; use ↻ to refresh.');
        layout();
    }
    async function refreshAgentView() {
        if (bridge || !agentMode || !open) return;
        const epoch = ++viewEpoch;
        viewController?.abort(); const controller = new AbortController(); viewController = controller;
        const timer = setTimeout(() => controller.abort(), 15000);
        agentStatus.textContent = L('正在读取 AI 浏览器画面…','Loading AI browser view…');
        try {
            const headers = window.getAuthHeaderForNav?.() || {};
            const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
            if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
            const response = await fetch('/api/agent-workspace/browser/view', { headers, credentials:'same-origin', cache:'no-store', signal:controller.signal });
            const data = await response.json();
            if (epoch !== viewEpoch) return;
            if (!response.ok) throw Error(data.error || `HTTP ${response.status}`);
            if (!data.available || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data.image || '')) {
                agentImage.hidden = true; agentView = null;
                agentStatus.textContent = L('当前账号还没有打开的 AI 浏览器页面，或浏览器会话已结束。请让 AI 打开一个网站。','No active AI browser page for this account, or the browser session has ended. Ask the AI to open a site.');
            } else {
                agentView = data; agentImage.src = data.image; agentImage.alt = data.title || L('AI 浏览器画面','AI browser view'); agentImage.hidden = false;
                agentStatus.textContent = L('画面已更新','View updated');
            }
            render();
        } catch (error) {
            if (epoch !== viewEpoch) return;
            agentStatus.textContent = error.name === 'AbortError' ? L('读取超时，请点 ↻ 重试。','Loading timed out. Use ↻ to retry.') : L('读取失败，请点 ↻ 重试。','Could not load the view. Use ↻ to retry.');
        } finally { clearTimeout(timer); }
    }
    async function showAgentView() {
        if (bridge) return;
        agentMode = true; await show(); render(); await refreshAgentView();
    }
    function webRender() {
        state = { tabs: webTabs.map(tab => ({ id: tab.id, title: tab.url || L('新标签页','New tab'), url: tab.url })), activeId: webActive };
        for (const tab of webTabs) tab.frame.hidden = agentMode || tab.id !== webActive;
        render();
    }
    function webNew() {
        agentMode = false; pagePixelWidth = 0; autoFit = true; requestAnimationFrame(fitReadingWidth);
        const frame = document.createElement('iframe');
        frame.title = L('网页预览','Web preview');
        frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads');
        frame.referrerPolicy = 'no-referrer';
        frame.src = 'about:blank';
        surface.append(frame);
        const tab = { id: `web-${++sequence}`, url: '', frame };
        webTabs.push(tab); webActive = tab.id; webRender(); address.focus();
    }
    function navigate() {
        if (agentMode) return refreshAgentView();
        const raw = address.value.trim();
        if (!raw) return;
        if (bridge) return bridge.action('navigate', raw);
        let url;
        try {
            url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[\w.-]+:\d+(?:\/|$)/.test(raw) ? raw : (/^(localhost|127\.0\.0\.1)(:|\/|$)/.test(raw) ? 'http://' : 'https://') + raw);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error();
        } catch { hint.textContent = L('请输入有效的 HTTP 或 HTTPS 网址。','Enter a valid HTTP or HTTPS URL.'); return; }
        const tab = webTabs.find(item => item.id === webActive);
        if (!tab) return;
        pagePixelWidth = 0; autoFit = true;
        tab.url = url.href; tab.frame.src = url.href; webRender(); requestAnimationFrame(fitReadingWidth);
    }
    function action(name) {
        if (name === 'close') return close();
        if (name === 'agent-view') {
            if (!agentMode) return showAgentView();
            agentMode = false; viewEpoch++; viewController?.abort();
            if (!webTabs.length) webNew(); else webRender();
            return;
        }
        if (agentMode && name === 'reload') return refreshAgentView();
        if (agentMode && name === 'external') { if (/^https?:\/\//.test(agentView?.url || '')) window.open(agentView.url, '_blank', 'noopener,noreferrer'); return; }
        if (name === 'popout') { bridge.popout(); docked = false; return close(); }
        if (bridge) return bridge.action(name);
        if (name === 'new-tab') return webNew();
        const tab = webTabs.find(item => item.id === webActive);
        if (name === 'external' && tab?.url) window.open(tab.url, '_blank', 'noopener,noreferrer');
        if (name === 'reload' && tab?.url) tab.frame.src = tab.url;
    }
    function init() {
        toggle = document.getElementById('dcBrowserToggle');
        const workspace = document.getElementById('dcWorkspacePanel');
        if (!toggle || !workspace) return;
        panel = document.createElement('aside'); panel.className = 'dc-browser-panel'; panel.id = 'dcBrowserPanel'; panel.hidden = true;
        panel.setAttribute('aria-label', L('内置浏览器','Built-in browser'));
        panel.innerHTML = '<header class="dc-browser-head"><strong>Dragon 浏览器</strong><button type="button" data-browser="agent-view">AI 画面</button><button type="button" data-browser="popout">▣</button><button type="button" data-browser="external">↗</button><button type="button" data-browser="close" aria-label="Close browser">×</button></header><div style="display:flex;min-width:0"><div class="dc-browser-tabs" style="flex:1;min-width:0"></div><button type="button" data-browser="new-tab">＋</button></div><form class="dc-browser-address"><button type="button" data-browser="back" aria-label="Back">←</button><button type="button" data-browser="forward" aria-label="Forward">→</button><button type="button" data-browser="reload" aria-label="Reload">↻</button><input autocomplete="off" spellcheck="false"><button type="submit" aria-label="Go">↵</button></form><div class="dc-browser-hint"></div><div class="dc-browser-surface"></div>';
        workspace.after(panel);
        surface = panel.querySelector('.dc-browser-surface'); address = panel.querySelector('input'); tabsNode = panel.querySelector('.dc-browser-tabs'); hint = panel.querySelector('.dc-browser-hint');
        const agentSurface = document.createElement('div'); agentSurface.className = 'dc-browser-agent-view'; agentSurface.hidden = true;
        agentSurface.innerHTML = '<div class="dc-browser-agent-status" role="status"></div><img hidden>';
        surface.append(agentSurface); agentImage = agentSurface.querySelector('img'); agentStatus = agentSurface.firstElementChild;
        agentImage.addEventListener('load', () => { pagePixelWidth = agentImage.naturalWidth; fitReadingWidth(); });
        window.SidebarResize?.bind({ panel, cssVar: '--browser-panel-width', storageKey: 'dragon_browser_sidebar_width', defaultWidth: 480, onManualResize: () => { autoFit = false; } });
        toggle.addEventListener('click', () => open ? close() : agentMode ? showAgentView() : show());
        panel.querySelector('form').addEventListener('submit', event => { event.preventDefault(); navigate(); });
        panel.addEventListener('click', event => {
            const button = event.target.closest('button'); if (!button) return;
            if (button.dataset.browser) action(button.dataset.browser);
            if (button.dataset.tab) {
                if (bridge) bridge.action('tab-select', button.dataset.tab);
                else { webActive = button.dataset.tab; webRender(); }
            }
            if (button.dataset.closeTab) {
                if (bridge) bridge.action('tab-close', button.dataset.closeTab);
                else { const tab = webTabs.find(item => item.id === button.dataset.closeTab); tab?.frame.remove(); webTabs = webTabs.filter(item => item !== tab); if (webActive === tab?.id) webActive = webTabs.at(-1)?.id || ''; webRender(); }
            }
        });
        for (const [name, key] of [['home:hub','hub'],['home:tool-frame','tool']]) window.addEventListener(name, event => {
            if (event.detail?.open) suspended.add(key); else suspended.delete(key); visibility();
        });
        window.addEventListener('dragon-claw:sidebar-layout', layout);
        window.addEventListener('dragon-claw:browser-update', event => {
            if (bridge) return;
            if (innerWidth <= 860 && !open) { agentMode = true; render(); return; }
            if (['browser_navigate', 'browser_snapshot', 'browser_screenshot'].includes(event.detail?.tool)) {
                if (event.detail.tool === 'browser_navigate') { autoFit = true; pagePixelWidth = 0; }
                showAgentView();
            }
            else if (open && agentMode) refreshAgentView();
        });
        window.matchMedia('(max-width: 860px)').addEventListener('change', event => { if (event.matches) close(); });
        window.addEventListener('resize', () => { if (autoFit) fitReadingWidth(); layout(); });
        window.addEventListener('tools:languagechange', render);
        window.addEventListener('beforeunload', () => { bridge?.bounds(null); bridge?.reading?.(false); });
        document.addEventListener('visibilitychange', layout);
        document.addEventListener('pointerdown', event => {
            if (innerWidth <= 860 && open && !panel.contains(event.target) && !toggle.contains(event.target) && !event.target.closest('[aria-modal="true"],.app-dialog')) close();
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && open && !event.defaultPrevented && !document.querySelector('[aria-modal="true"]')) close(); });
        new ResizeObserver(layout).observe(surface);
        new MutationObserver(layout).observe(document.body, { attributes:true, childList:true, subtree:true, attributeFilter:['class','hidden','open','style'] });
        if (bridge) {
            bridge.onState(value => {
                const before = state.tabs.find(tab => tab.id === state.activeId)?.url;
                const after = value.tabs.find(tab => tab.id === value.activeId)?.url;
                if (before !== after) { autoFit = true; pagePixelWidth = 0; }
                state = value; render(); if (before !== after) requestAnimationFrame(fitReadingWidth);
            });
            bridge.onReveal(() => { if (innerWidth > 860 || open) show(); });
            bridge.onFocusUrl(() => { address.focus(); address.select(); });
            bridge.onPoppedOut(() => { docked = false; close(); });
            bridge.connect().then(value => { connected = value; docked = value; layout(); }).catch(() => {});
        }
        render();
        window.DragonBrowserSidebar = { open: show, close, showAgentView, isOpen: () => open };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
