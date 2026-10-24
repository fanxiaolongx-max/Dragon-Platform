// 一个 Dragon 浏览器窗口，多个独立页面；所有标签共用原有持久 Session 和插件。
const { BrowserWindow, BrowserView, shell } = require('electron');
const path = require('path');
const TAB_HEIGHT = 34;
const TOOLBAR_HEIGHT = 40;

function webUrl(value) {
    try {
        const url = new URL(String(value));
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch (_) { return null; }
}

function createDragonBrowser({ partition, whenReady, getLanguage, getWorkArea, onPageCreated = () => {}, onAction = () => {}, onVisibilityChange = () => {} }) {
    let win = null, tabs = [], activeId = null, attached = null, shown = false, sequence = 0, ready = false;
    const active = () => tabs.find(tab => tab.id === activeId);

    function pushState() {
        if (!win || win.isDestroyed() || !ready) return;
        const tab = active();
        if (!tab) return;
        const wc = tab.page.webContents;
        const english = getLanguage() === 'en-US';
        win.setTitle(`${wc.getTitle() || tab.link.name || 'Dragon'} — ${english ? 'Dragon Browser' : 'Dragon 浏览器'}`);
        win.webContents.send('promo-card:state', {
            mode: 'browser', tool: true, lang: english ? 'en-US' : 'zh-CN',
            name: english ? 'Dragon Browser' : 'Dragon 浏览器', badge: 'Dragon', color: tab.link.color || 'teal',
            title: wc.getTitle() || tab.link.name, url: wc.getURL(),
            canBack: wc.canGoBack(), canForward: wc.canGoForward(), maximized: win.isMaximized(), activeId,
            tabs: tabs.map(item => ({ id: item.id, title: item.page.webContents.getTitle() || item.link.name || (english ? 'New tab' : '新标签页'), url: item.page.webContents.getURL(), loading: item.page.webContents.isLoading() }))
        });
    }

    function detach() {
        if (attached && win && !win.isDestroyed()) win.removeBrowserView(attached);
        attached = null;
    }

    function layout() {
        if (!win || win.isDestroyed() || !shown) return;
        const [width, height] = win.getContentSize();
        const tab = active();
        if (attached !== tab?.page) {
            detach();
            if (tab) { win.addBrowserView(tab.page); attached = tab.page; }
        }
        for (const tab of tabs) {
            tab.page.setBounds({ x: 0, y: TAB_HEIGHT + TOOLBAR_HEIGHT, width, height: Math.max(1, height - TAB_HEIGHT - TOOLBAR_HEIGHT) });
            if (tab.id === activeId) tab.onLayout?.();
        }
    }

    function visibility(next) {
        if (shown === next) return;
        shown = next;
        if (!shown) detach();
        tabs.forEach(tab => tab.onModeChange?.(shown));
        if (shown) layout();
        onVisibilityChange();
    }

    function showTab(id) {
        if (!tabs.some(tab => tab.id === id)) return;
        activeId = id;
        if (win.isMinimized()) win.restore();
        visibility(true);
        layout();
        win.show(); win.focus();
        active().page.webContents.focus();
        pushState();
    }

    function disposeTab(tab) {
        if (tab.closed) return;
        tab.closed = true;
        if (tab.tool) clearTimeout(tab.tool.timer);
        if (attached === tab.page) detach();
        tab.onModeChange?.(false);
        if (tab.release) tab.release();
        else if (!tab.page.webContents.isDestroyed()) tab.page.webContents.close();
        tab.cleanup?.();
    }

    function disposeAll() {
        shown = false;
        detach();
        const closing = tabs;
        tabs = []; activeId = null;
        closing.forEach(disposeTab);
        onVisibilityChange();
    }

    function closeTab(id) {
        const index = tabs.findIndex(tab => tab.id === id);
        if (index < 0) return;
        const [tab] = tabs.splice(index, 1);
        disposeTab(tab);
        if (!tabs.length) { win.close(); return; }
        if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)].id;
        layout(); pushState();
    }

    function keyboard(event, input) {
        if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
        const key = input.key.toLowerCase();
        if (key === 'w') { event.preventDefault(); closeTab(activeId); }
        else if (key === 't') { event.preventDefault(); open({ link: { name: getLanguage() === 'en-US' ? 'New tab' : '新标签页', url: 'about:blank' } }); }
        else if (key === 'l') { event.preventDefault(); win.webContents.focus(); win.webContents.send('promo-card:focus-url'); }
        else if (key === 'tab' && tabs.length) {
            event.preventDefault();
            const index = tabs.findIndex(tab => tab.id === activeId);
            showTab(tabs[(index + (input.shift ? -1 : 1) + tabs.length) % tabs.length].id);
        }
    }

    function ensureWindow() {
        if (win && !win.isDestroyed()) return;
        const area = getWorkArea();
        const width = Math.min(1360, Math.round(area.width * .86)), height = Math.min(900, Math.round(area.height * .88));
        ready = false;
        win = new BrowserWindow({
            width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2),
            minWidth: 640, minHeight: 420, frame: false, show: false, backgroundColor: '#0f172a', title: 'Dragon 浏览器',
            webPreferences: { preload: path.join(__dirname, 'card-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
        });
        win.webContents.on('did-finish-load', () => { ready = true; pushState(); });
        win.webContents.on('before-input-event', keyboard);
        win.on('resize', () => { layout(); pushState(); });
        win.on('maximize', pushState); win.on('unmaximize', pushState);
        win.on('minimize', () => visibility(false));
        win.on('hide', () => visibility(false));
        win.on('restore', () => visibility(true));
        win.on('close', disposeAll);
        win.on('closed', () => { win = null; ready = false; });
        win.loadFile(path.join(__dirname, 'card.html')).catch(() => {});
    }

    function open(options) {
        ensureWindow();
        const page = options.page || new BrowserView({ webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
        const tab = { ...options, id: `dragon-tab-${++sequence}`, page, win };
        tabs.push(tab);
        if (shown) tab.onModeChange?.(true);
        const wc = page.webContents;
        const changed = () => { if (!tab.closed) pushState(); };
        const events = ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading'];
        events.forEach(event => wc.on(event, changed));
        wc.on('before-input-event', keyboard);
        tab.cleanup = () => { events.forEach(event => wc.removeListener(event, changed)); wc.removeListener('before-input-event', keyboard); };
        wc.setWindowOpenHandler(details => {
            if (tab.closed || (tab.context && !shown)) return { action: 'deny' };
            const url = webUrl(details.url);
            if (url) {
                const loadOptions = { httpReferrer: details.referrer };
                if (details.postBody) {
                    loadOptions.postData = details.postBody.data;
                    loadOptions.extraHeaders = `Content-Type: ${details.postBody.contentType}${details.postBody.boundary ? '; boundary=' + details.postBody.boundary : ''}`;
                }
                // 先让 Chromium 完成当前开窗回调，再切换 BrowserView，避免阻塞来源页面。
                setImmediate(() => { if (!tab.closed) open({ link: { name: url, url }, loadOptions }); });
            }
            return { action: 'deny' };
        });
        if (!options.page) {
            onPageCreated(tab);
            whenReady().then(() => { if (!tab.closed && !wc.isDestroyed()) wc.loadURL(tab.link.url, options.loadOptions).catch(() => {}); });
        }
        showTab(tab.id);
        return tab;
    }

    function handleAction(sender, action, payload) {
        if (!win || sender !== win.webContents) return false;
        const tab = active();
        if (!tab) return true;
        const wc = tab.page.webContents;
        switch (action) {
        case 'tab-select': if (typeof payload === 'string') showTab(payload); break;
        case 'tab-close': if (typeof payload === 'string') closeTab(payload); break;
        case 'new-tab': open({ link: { name: getLanguage() === 'en-US' ? 'New tab' : '新标签页', url: 'about:blank' } }); break;
        case 'navigate': {
            if (typeof payload !== 'string' || payload.length > 8192) break;
            const value = payload.trim();
            const url = webUrl(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : 'https://' + value);
            if (url) wc.loadURL(url).catch(() => {});
            break;
        }
        case 'minimize': win.minimize(); break;
        case 'close': win.close(); break;
        case 'maximize': if (win.isMaximized()) win.unmaximize(); else win.maximize(); break;
        case 'back': if (wc.canGoBack()) wc.goBack(); break;
        case 'forward': if (wc.canGoForward()) wc.goForward(); break;
        case 'reload': wc.reload(); break;
        case 'home': wc.loadURL(tab.link.url).catch(() => {}); break;
        case 'external': { const url = webUrl(wc.getURL()); if (url) shell.openExternal(url).catch(() => {}); break; }
        default: onAction(tab.context || tab, action); break;
        }
        return true;
    }

    return {
        open, showTab, handleAction, list: () => [...tabs], isVisible: () => shown,
        getWindow: () => win, pushState,
        destroy() { disposeAll(); if (win && !win.isDestroyed()) win.destroy(); },
        findContext: context => tabs.find(tab => tab.context === context)
    };
}

module.exports = { createDragonBrowser, webUrl, TAB_HEIGHT, TOOLBAR_HEIGHT };
