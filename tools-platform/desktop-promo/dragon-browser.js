// 一个 Dragon 浏览器窗口，多个独立页面；所有标签共用原有持久 Session 和插件。
const { BrowserWindow, BrowserView, shell, Menu, clipboard, app } = require('electron');
const path = require('path');
const pageLayoutScript=require('../backend/models/browser-page-layout').script;
const { savedUrl } = require('./browser-library');
const { captureSite, loginOrigin, attachBrowserLogin } = require('./browser-credentials');
const TAB_HEIGHT = 34;
const TOOLBAR_HEIGHT = 40;
const PANEL_HEIGHT = 240, FIND_HEIGHT = 38;
const NOTICE_HEIGHT = 32;
const OPERATOR_EXIT_MS = 480; // Allow the shared 440 ms exit transition to finish.
const ZOOM_LEVELS = [.25, .33, .5, .67, .75, .8, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function webUrl(value) {
    try {
        const url = new URL(String(value));
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
    } catch (_) { return null; }
}

function createDragonBrowser({ onOpenAppUrl = () => false, partition, whenReady, getLanguage, getWorkArea, getLibrary = () => null, getDownloads = () => null, getExtensions = () => [], getCredentialStore = () => null, credentialOrigin = loginOrigin, isAppOrigin = () => false, onPageCreated = () => {}, onAction = () => {}, onVisibilityChange = () => {} }) {
    let win = null, tabs = [], activeId = null, attached = null, shown = false, sequence = 0, ready = false;
    let windowDrag = null;
    let operatorView=null,operatorExitTimer=null,sidebarTheme='light';
    function themePage(tab){
        const dark=sidebarTheme==='dark',color=dark?'#101114':'#ffffff';
        if(!tab||tab.page.webContents.isDestroyed())return;
        tab.page.setBackgroundColor(['','about:blank'].includes(tab.page.webContents.getURL())?color:'#ffffff');
        if(tab.page.webContents.getURL()==='about:blank')tab.page.webContents.executeJavaScript(`(()=>{if(location.href!=='about:blank')return;document.documentElement.style.cssText='background:${color};color:${dark?'#e2e8f0':'#172033'};color-scheme:${dark?'dark':'light'}';document.body.style.background='${color}';})()`).catch(()=>{});
    }
    let sidebarHost = null, sidebarBounds = null, sidebarMode = false, attachedHost = null;
    let panel = '', bookmarks = [], history = [], libraryError = false;
    let notice = null, noticeTimer = null;
    let find = { open: false, text: '', matches: 0, activeMatch: 0 }, findRequest = null;
    const closedTabs = [];
    const active = () => tabs.find(tab => tab.id === activeId);
    // 保险箱对任何 http(s) 站点生效；平台自己的页面（登录页等）除外，平台登录密码不进保险箱。
    function loginContext(tab) {
        const current = tab.page.webContents.getURL();
        if (captureSite(tab.link.url) || captureSite(current)) tab.captureLogin = true;
        const origin = credentialOrigin(current);
        return !!origin && !isAppOrigin(origin);
    }
    const T = (zh, en) => getLanguage() === 'en-US' ? en : zh;

    function pushState() {
        if (!win || win.isDestroyed()) return;
        const tab = active();
        if (!tab) { if (sidebarHost && !sidebarHost.isDestroyed()) sidebarHost.webContents.send('dragon-browser:state', { tabs: [], activeId: null }); return; }
        const wc = tab.page.webContents;
        const english = getLanguage() === 'en-US';
        win.setTitle(`${wc.getTitle() || tab.link.name || 'Dragon'} — ${english ? 'Dragon Browser' : 'Dragon 浏览器'}`);
        const snapshot = {
            mode: 'browser', tool: true, lang: english ? 'en-US' : 'zh-CN',
            name: english ? 'Dragon Browser' : 'Dragon 浏览器', badge: 'Dragon', color: tab.link.color || 'teal',
            title: wc.getTitle() || tab.link.name, url: wc.getURL(), layout:tab.readingLayout||null,
            canBack: wc.canGoBack(), canForward: wc.canGoForward(), maximized: win.isMaximized(), activeId,
            zoom: Math.round(wc.getZoomFactor() * 100), bookmarked: bookmarks.some(item => item.url === savedUrl(wc.getURL())),
            find, panel, notice, bookmarks, history, libraryError, extensions:getExtensions().map(item=>({id:item.id,name:item.name,version:item.version,enabled:!item.error})), downloads: getDownloads()?.list() || [],
            tabs: tabs.map(item => ({ id: item.id, title: item.page.webContents.getTitle() || item.link.name || (english ? 'New tab' : '新标签页'), url: item.page.webContents.getURL(), loading: item.page.webContents.isLoading(), muted: item.page.webContents.isAudioMuted() }))
        };
        if (ready) win.webContents.send('promo-card:state', snapshot);
        if (sidebarHost && !sidebarHost.isDestroyed()) sidebarHost.webContents.send('dragon-browser:state', snapshot);
    }

    function detachOperator() {
        clearTimeout(operatorExitTimer);operatorExitTimer=null;
        if(operatorView&&attachedHost&&!attachedHost.isDestroyed())attachedHost.removeBrowserView(operatorView);
        operatorView=null;
    }

    function detach() {
        detachOperator();
        if (attached && attachedHost && !attachedHost.isDestroyed()) attachedHost.removeBrowserView(attached);
        attached = null; attachedHost = null;
    }

    function layoutOperator(tab){
        if(!tab||!attachedHost||attachedHost.isDestroyed())return;
        if(operatorView&&operatorView!==tab.operatorView)detachOperator();
        const state=tab.operatorState;
        if(state?.manual){detachOperator();return;} // Give input back immediately on takeover.
        if(!state?.active){
            if(!operatorView)return;
            operatorView.setBounds(tab.page.getBounds());
            if(operatorView.webContents.isLoading()){detachOperator();return;}
            if(!operatorExitTimer){
                operatorView.webContents.send('dragon-browser:operator-state',state);
                operatorExitTimer=setTimeout(detachOperator,OPERATOR_EXIT_MS);
            }
            return;
        }
        clearTimeout(operatorExitTimer);operatorExitTimer=null;
        if(!tab.operatorView){
            const view=new BrowserView({webPreferences:{preload:path.join(__dirname,'operator-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
            view.setBackgroundColor('#00000000');tab.operatorView=view;
            view.webContents.on('ipc-message',(event,channel,action)=>{if(event.senderFrame===view.webContents.mainFrame&&channel==='dragon-browser:operator-action'&&action==='takeover'&&operatorView===view&&tab.operatorState?.active&&!tab.operatorState.manual)tab.operatorAction?.(action);});
            view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-navigate',event=>event.preventDefault());
            view.webContents.on('did-finish-load',()=>{if(!view.webContents.isDestroyed())view.webContents.send('dragon-browser:operator-state',tab.operatorState);});
            view.webContents.loadFile(path.join(__dirname,'operator-overlay.html')).catch(()=>{});
        }
        if(operatorView!==tab.operatorView){attachedHost.addBrowserView(tab.operatorView);operatorView=tab.operatorView;}
        operatorView.setBounds(tab.page.getBounds());attachedHost.setTopBrowserView(operatorView);
        if(!operatorView.webContents.isLoading())operatorView.webContents.send('dragon-browser:operator-state',tab.operatorState);
    }
    function layout() {
        if (!win || win.isDestroyed() || !shown) return;
        if (sidebarMode) {
            if (!sidebarHost || sidebarHost.isDestroyed() || !sidebarBounds) { detach(); return; }
            const tab = active();
            if (attached !== tab?.page || attachedHost !== sidebarHost) {
                detach();
                if (tab) { sidebarHost.addBrowserView(tab.page); attached = tab.page; attachedHost = sidebarHost; }
            }
            if (tab) { tab.page.setBounds(sidebarBounds); tab.onLayout?.();layoutOperator(tab); }
            return;
        }
        const [width, height] = win.getContentSize();
        const top = TAB_HEIGHT + TOOLBAR_HEIGHT + (notice ? NOTICE_HEIGHT : 0) + (find.open ? FIND_HEIGHT : 0) + (panel ? PANEL_HEIGHT : 0);
        const tab = active();
        if (attached !== tab?.page) {
            detach();
            if (tab) { win.addBrowserView(tab.page); attached = tab.page; attachedHost = win; }
        }
        for (const tab of tabs) {
            tab.page.setBounds({ x: 0, y: top, width, height: Math.max(1, height - top) });
            if (tab.id === activeId) tab.onLayout?.();
        }
        layoutOperator(tab);
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
        if (id !== activeId) closeFind();
        activeId = id;
        if (win.isMinimized()) win.restore();
        visibility(true);
        layout();
        if (sidebarMode && sidebarHost && !sidebarHost.isDestroyed()) sidebarHost.webContents.send('dragon-browser:reveal');
        else { win.show(); win.focus(); active().page.webContents.focus(); }
        pushState();
    }

    function disposeTab(tab) {
        if (tab.closed) return;
        tab.closed = true;
        if (tab.tool) clearTimeout(tab.tool.timer);
        if (attached === tab.page) detach();
        if(tab.operatorView&&!tab.operatorView.webContents.isDestroyed())tab.operatorView.webContents.close();
        tab.onModeChange?.(false);
        if (tab.release) tab.release();
        else if (!tab.page.webContents.isDestroyed()) tab.page.webContents.close();
        tab.cleanup?.();
    }

    function disposeAll() {
        clearTimeout(noticeTimer); notice = null;
        closeFind();
        shown = false;
        detach();
        const closing = tabs;
        tabs = []; activeId = null;
        closing.forEach(disposeTab);
        pushState();
        onVisibilityChange();
    }

    function closeTab(id) {
        const index = tabs.findIndex(tab => tab.id === id);
        if (index < 0) return;
        if (id === activeId) closeFind();
        const [tab] = tabs.splice(index, 1);
        const url = webUrl(tab.page.webContents.getURL());
        if (url) {
            closedTabs.push({ link: { ...tab.link, url }, captureLogin: tab.captureLogin, tool: tab.tool ? { ...tab.tool, timer: undefined } : undefined });
            if (closedTabs.length > 20) closedTabs.shift();
        }
        disposeTab(tab);
        if (!tabs.length) { if (sidebarMode) { visibility(false); pushState(); } else win.close(); return; }
        if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)].id;
        layout(); pushState();
    }

    function reopenTab() { const options = closedTabs.pop(); if (options) open(options); }
    function duplicateTab(tab = active()) {
        if (!tab) return;
        const url = webUrl(tab.page.webContents.getURL());
        if (url) open({ link: { ...tab.link, url }, captureLogin: tab.captureLogin, tool: tab.tool ? { ...tab.tool, timer: undefined } : undefined });
    }
    function zoom(direction) {
        const wc = active()?.page.webContents; if (!wc) return;
        const value = wc.getZoomFactor();
        const next = direction === 'reset' ? 1 : direction === 'in'
            ? ZOOM_LEVELS.find(level => level > value + .01) || 5
            : [...ZOOM_LEVELS].reverse().find(level => level < value - .01) || .25;
        wc.setZoomFactor(next); pushState();
    }
    function closeFind() {
        if (find.open) active()?.page.webContents.stopFindInPage('clearSelection');
        find = { open: false, text: '', matches: 0, activeMatch: 0 }; findRequest = null;
    }
    function openFind() {
        find.open = true; panel = ''; layout(); pushState();
        if(!sidebarMode){win.webContents.focus();win.webContents.send('promo-card:focus-find');}
    }
    function findText(payload) {
        if (!payload || typeof payload.text !== 'string' || payload.text.length > 500) return;
        const wc = active().page.webContents, changed = payload.text !== find.text;
        find.text = payload.text; find.matches = 0; find.activeMatch = 0;
        if (!find.text) { wc.stopFindInPage('clearSelection'); findRequest = null; pushState(); return; }
        // Electron 28 的 findNext 映射到 Chromium new_session，首次查询必须为 true。
        findRequest = wc.findInPage(find.text, { forward: payload.forward !== false, findNext: changed });
        pushState();
    }
    async function refreshLibrary() {
        const library = getLibrary(); if (!library) return;
        try { [bookmarks, history] = await Promise.all([library.bookmarks(), library.history()]); libraryError = false; }
        catch (_) { libraryError = true; }
        pushState();
    }
    async function toggleBookmark(url = active()?.page.webContents.getURL(), title = active()?.page.webContents.getTitle()) {
        const library = getLibrary(); if (!library || !savedUrl(url)) return;
        try { await library.bookmark(url, title, bookmarks.some(item => item.url === savedUrl(url))); await refreshLibrary(); }
        catch (_) { libraryError = true; pushState(); }
    }
    function showPanel(next) {
        if(sidebarMode){if(next==='downloads')downloadMenu();else libraryMenu(next);return;}
        panel = panel === next ? '' : next;
        if (panel === 'downloads') { clearTimeout(noticeTimer); notice = null; }
        closeFind(); layout(); pushState();
        if (panel === 'bookmarks' || panel === 'history') refreshLibrary();
    }
    let popupPosition=null;
    const popup = template => {const position=popupPosition,host=sidebarMode?sidebarHost:win;popupPosition=null;if(!host||host.isDestroyed())return;Menu.buildFromTemplate(template).popup({window:host,...position});};
    function downloadMenu(){
        const items=getDownloads()?.list()||[],labels={completed:T('已完成','Completed'),progressing:T('下载中','Downloading'),paused:T('已暂停','Paused'),cancelled:T('已取消','Cancelled'),interrupted:T('已中断','Interrupted'),failed:T('失败','Failed')};
        popup([{label:T('打开下载文件夹','Open Downloads folder'),click:()=>shell.openPath(app.getPath('downloads')).catch(()=>{})},{type:'separator'},...(items.length?items.slice(0,30).map(item=>({label:`${item.name} · ${labels[item.state]||item.state} · ${Math.round((item.received||0)/1024)} KB`,submenu:(item.state==='completed'?['open','show']:item.state==='progressing'?['pause','cancel']:item.state==='paused'?['resume','cancel']:[]).map(action=>({label:({open:T('打开文件','Open file'),show:T('在文件夹中显示','Show in folder'),pause:T('暂停','Pause'),resume:T('继续','Resume'),cancel:T('取消','Cancel')})[action],click:()=>getDownloads()?.action(item.id,action)}))})): [{label:T('暂无下载记录','No downloads yet'),enabled:false}])]);
    }
    async function libraryMenu(name){
        await refreshLibrary();const items=name==='history'?history:bookmarks;
        popup(items.length?items.slice(0,60).map(item=>({label:item.title||item.url,click:()=>open({link:{name:item.title||item.url,url:item.url}})})):[{label:T('暂无记录','No entries yet'),enabled:false}]);
    }
    function sidebarMenu(payload){
        if(!payload||!['more','downloads','extensions','tabs','history','bookmarks'].includes(payload.name))return;
        if(Number.isFinite(payload.x)&&Number.isFinite(payload.y)){const [width,height]=sidebarHost.getContentSize(),zoom=sidebarHost.webContents.getZoomFactor();popupPosition={x:Math.max(0,Math.min(width,Math.round(payload.x*zoom))),y:Math.max(0,Math.min(height,Math.round(payload.y*zoom)))};}
        if(payload.name==='more')return browserMenu();
        if(payload.name==='downloads')return downloadMenu();
        if(payload.name==='extensions'&&!active())return popup([{label:T('请先点击 + 新建标签页','Click + to open a tab first'),enabled:false}]);
        if(payload.name==='extensions'){popupPosition=null;return onAction(active()?.context||active(),'plugins');}
        if(payload.name==='history'||payload.name==='bookmarks')return libraryMenu(payload.name);
        popup(tabs.map(tab=>({label:tab.page.webContents.getTitle()||tab.link.name||T('新标签页','New tab'),type:'checkbox',checked:tab.id===activeId,click:()=>showTab(tab.id)})));
    }
    function tabMenu(id) {
        const tab = tabs.find(item => item.id === id); if (!tab) return;
        popup([
            { label: T('新建标签页', 'New tab'), click: () => open({ link: { name: T('新标签页', 'New tab'), url: 'about:blank' } }) },
            { label: T('复制标签页', 'Duplicate tab'), click: () => duplicateTab(tab) },
            { label: tab.page.webContents.isAudioMuted() ? T('取消静音', 'Unmute tab') : T('静音标签页', 'Mute tab'), click: () => { tab.page.webContents.setAudioMuted(!tab.page.webContents.isAudioMuted()); pushState(); } },
            { type: 'separator' },
            { label: T('关闭标签页', 'Close tab'), click: () => closeTab(id) },
            { label: T('关闭其他标签页', 'Close other tabs'), enabled: tabs.length > 1, click: () => { showTab(id); [...tabs].filter(item => item !== tab).forEach(item => closeTab(item.id)); } },
            { label: T('关闭右侧标签页', 'Close tabs to the right'), enabled: tabs.indexOf(tab) < tabs.length - 1, click: () => tabs.slice(tabs.indexOf(tab) + 1).forEach(item => closeTab(item.id)) },
            { label: T('恢复关闭的标签页', 'Reopen closed tab'), enabled: closedTabs.length > 0, click: reopenTab }
        ]);
    }
    async function browserMenu() {
        const tab = active(), url = tab?.page.webContents.getURL();
        const managed = tab && loginContext(tab), store = getCredentialStore();
        let loginEnabled = false;
        try { loginEnabled = managed && store ? await store.enabled(url) : false; } catch (_) {}
        popup([
            ...(!sidebarMode?[{ label: T('新建标签页', 'New tab'), accelerator: 'CmdOrCtrl+T', click: () => open({ link: { name: T('新标签页', 'New tab'), url: 'about:blank' } }) }]:[]),
            { label: T('恢复关闭的标签页', 'Reopen closed tab'), accelerator: 'CmdOrCtrl+Shift+T', enabled: closedTabs.length > 0, click: reopenTab },
            { type: 'separator' },
            { label: T('收藏夹', 'Bookmarks'), click: () => showPanel('bookmarks') },
            { label: T('历史记录', 'History'), click: () => showPanel('history') },
            { label: T('下载内容', 'Downloads'), click: () => showPanel('downloads') },
            { label: T('打开下载文件夹', 'Open Downloads folder'), click: () => shell.openPath(app.getPath('downloads')).catch(() => {}) },
            { label: T('此登录站点：记住密码并自动登录', 'This login site: remember password and sign in'), type: 'checkbox', checked: loginEnabled, enabled: !!(managed && store), click: () => store.toggle(url).catch(() => {}) },
            { label: T('清除此登录站点的密码并关闭自动登录', 'Forget this login and disable auto sign-in'), enabled: !!(managed && store), click: () => store.remove(url).catch(() => {}) },
            { type: 'separator' },
            { label: T('放大', 'Zoom in'), click: () => zoom('in') },
            { label: T('缩小', 'Zoom out'), click: () => zoom('out') },
            { label: T('重置缩放 (100%)', 'Reset zoom (100%)'), click: () => zoom('reset') },
            { label: T('在页面中查找', 'Find in page'), accelerator: 'CmdOrCtrl+F', click: openFind },
            { label: T('打印…', 'Print…'), accelerator: 'CmdOrCtrl+P', click: () => active()?.page.webContents.print({}) },
            { label: T('全屏', 'Full screen'), accelerator: 'F11', click: () => {const host=sidebarMode?sidebarHost:win;host?.setFullScreen(!host.isFullScreen());} },
            { label: T('开发者工具', 'Developer tools'), click: () => active()?.page.webContents.toggleDevTools() }
        ]);
    }
    function pageMenu(tab, params) {
        const wc = tab.page.webContents, template = [];
        const link = webUrl(params.linkURL);
        if (link) template.push(
            { label: T('在新标签页打开链接', 'Open link in new tab'), click: () => open({ link: { name: params.linkText || link, url: link } }) },
            { label: T('复制链接地址', 'Copy link address'), click: () => clipboard.writeText(link) },
            { label: T('链接另存为…', 'Save link as…'), click: () => wc.downloadURL(link) }, { type: 'separator' });
        if (params.isEditable) template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
        else if (params.selectionText) template.push({ label: T('复制', 'Copy'), click: () => wc.copy() });
        template.push(
            { label: T('后退', 'Back'), enabled: wc.canGoBack(), click: () => wc.goBack() },
            { label: T('前进', 'Forward'), enabled: wc.canGoForward(), click: () => wc.goForward() },
            { label: T('刷新', 'Reload'), click: () => wc.reload() },
            { label: T('检查元素', 'Inspect element'), click: () => wc.inspectElement(params.x, params.y) });
        popup(template);
    }

    function moveTab(payload) {
        if (!payload || typeof payload.id !== 'string' || !(payload.beforeId === null || typeof payload.beforeId === 'string')) return;
        const index = tabs.findIndex(tab => tab.id === payload.id);
        if (index < 0 || payload.beforeId === payload.id || (payload.beforeId !== null && !tabs.some(tab => tab.id === payload.beforeId))) return;
        const [tab] = tabs.splice(index, 1);
        const target = payload.beforeId === null ? tabs.length : tabs.findIndex(item => item.id === payload.beforeId);
        tabs.splice(target, 0, tab);
        pushState();
    }

    function dragWindow(action, point) {
        if (action === 'window-drag-end') { windowDrag = null; return; }
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e7 || Math.abs(point.y) > 1e7) return;
        if (action === 'window-drag-start') {
            windowDrag = { point, bounds: win.getBounds(), maximized: win.isMaximized() };
            return;
        }
        if (!windowDrag) return;
        const dx = point.x - windowDrag.point.x, dy = point.y - windowDrag.point.y;
        if (!windowDrag.moving && Math.hypot(dx, dy) < 4) return;
        windowDrag.moving = true;
        if (windowDrag.maximized) {
            const ratio = Math.max(0, Math.min(1, (windowDrag.point.x - windowDrag.bounds.x) / windowDrag.bounds.width));
            const offsetY = windowDrag.point.y - windowDrag.bounds.y;
            const restored = win.getNormalBounds();
            win.unmaximize();
            windowDrag = { point, bounds: { ...restored, x: point.x - restored.width * ratio, y: point.y - offsetY }, maximized: false, moving: true };
            win.setPosition(Math.round(windowDrag.bounds.x), Math.round(windowDrag.bounds.y));
            return;
        }
        win.setPosition(Math.round(windowDrag.bounds.x + dx), Math.round(windowDrag.bounds.y + dy));
    }

    function keyboard(event, input) {
        if (input.type !== 'keyDown' || !shown) return;
        const key = input.key.toLowerCase();
        const wc = active()?.page.webContents;
        if (!wc) return;
        const command = input.control || input.meta;
        if (sidebarMode && sidebarHost && !sidebarHost.isDestroyed()) {
            if (command && key === 'l') { event.preventDefault(); sidebarHost.webContents.focus(); sidebarHost.webContents.send('dragon-browser:focus-url'); return; }

        }
        if (key === 'escape') {
            if (find.open) { event.preventDefault(); closeFind(); layout(); pushState(); wc.focus(); }
            else if (panel) { event.preventDefault(); panel = ''; layout(); pushState(); }
            else if ((sidebarMode?sidebarHost:win)?.isFullScreen()) { event.preventDefault(); (sidebarMode?sidebarHost:win).setFullScreen(false); }
            else if (wc.isLoading()) { event.preventDefault(); wc.stop(); }
            return;
        }
        if (key === 'f11') { event.preventDefault();const host=sidebarMode?sidebarHost:win;host?.setFullScreen(!host.isFullScreen());return; }
        if (key === 'f5') { event.preventDefault(); input.shift ? wc.reloadIgnoringCache() : wc.reload(); return; }
        if (input.alt && ['arrowleft', 'arrowright'].includes(key)) {
            event.preventDefault(); if (key === 'arrowleft' && wc.canGoBack()) wc.goBack(); else if (key === 'arrowright' && wc.canGoForward()) wc.goForward(); return;
        }
        if (!command) return;
        if (key === 'w') { event.preventDefault(); closeTab(activeId); }
        else if (key === 't' && input.shift) { event.preventDefault(); reopenTab(); }
        else if (key === 't') { event.preventDefault(); open({ link: { name: getLanguage() === 'en-US' ? 'New tab' : '新标签页', url: 'about:blank' } }); }
        else if (key === 'l') { event.preventDefault(); win.webContents.focus(); win.webContents.send('promo-card:focus-url'); }
        else if (key === 'f') { event.preventDefault(); openFind(); }
        else if (key === 'r') { event.preventDefault(); input.shift ? wc.reloadIgnoringCache() : wc.reload(); }
        else if (key === 'd') { event.preventDefault(); toggleBookmark(); }
        else if (key === 'h') { event.preventDefault(); showPanel('history'); }
        else if (key === 'j') { event.preventDefault(); showPanel('downloads'); }
        else if (key === 'p') { event.preventDefault(); wc.print({}); }
        else if (['+', '=', '-', '0'].includes(key)) { event.preventDefault(); zoom(key === '0' ? 'reset' : key === '-' ? 'out' : 'in'); }
        else if (/^[1-9]$/.test(key)) { event.preventDefault(); showTab(tabs[key === '9' ? tabs.length - 1 : Number(key) - 1]?.id); }
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
        win.on('blur', () => { windowDrag = null; });
        win.on('hide', () => visibility(false));
        win.on('restore', () => visibility(true));
        win.on('close', disposeAll);
        win.on('closed', () => { win = null; ready = false; windowDrag = null; panel = ''; closeFind(); });
        win.loadFile(path.join(__dirname, 'card.html')).catch(() => {});
    }

    function open(options) {
        ensureWindow();
        const page = options.page || new BrowserView({ webPreferences: { partition, preload: path.join(__dirname, 'page-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
        const tab = { ...options, id: `dragon-tab-${++sequence}`, page, win };
        tab.setOperatorState=value=>{tab.operatorState={...value,lang:getLanguage()};if(!wc.isDestroyed())wc.send('dragon-browser:operator-state',tab.operatorState);if(activeId===tab.id)layout();};
        tabs.push(tab);
        if (shown) tab.onModeChange?.(true);
        const wc = page.webContents;
        themePage(tab);wc.on('did-finish-load',()=>themePage(tab));
        const loginNavigation = (_event, url, _inPlace, isMainFrame) => {
            if (isMainFrame && captureSite(url)) tab.captureLogin = true;
        };
        wc.on('did-start-navigation', loginNavigation);
        let loginStorageWarned = false;
        const detachLogin = attachBrowserLogin(wc, {
            getStore: getCredentialStore, allowed: () => loginContext(tab), originOf: credentialOrigin,
            notify: result => {
                if (result !== 'unavailable' || loginStorageWarned) return;
                loginStorageWarned = true;
                // Never include a credential or raw storage error in UI/logs.
                if (win && !win.isDestroyed()) require('electron').dialog.showMessageBox(win, { type: 'info', message: T('本机系统密码库暂不可用，密码未保存。请手动登录。', 'The system key store is unavailable. Password was not saved; sign in manually.') }).catch(() => {});
            }
        });
        let layoutTimer=null,layoutEpoch=0;
        const measureLayout=()=>{
            if(tab.closed||wc.isDestroyed()||wc.isLoading())return;
            const epoch=++layoutEpoch;
            wc.executeJavaScript(pageLayoutScript).then(value=>{if(!tab.closed&&epoch===layoutEpoch){if(!value?.preferredWidth&&tab.readingLayout?.preferredWidth&&value?.viewportWidth<=744)return;tab.readingLayout=value?.preferredWidth?{...value,preferredWidth:Math.round(value.preferredWidth*wc.getZoomFactor())}:value;pushState();}}).catch(()=>{});
        };
        const layoutInterval=setInterval(()=>{if(sidebarMode&&activeId===tab.id)measureLayout();},2500);layoutInterval.unref?.();
        const changed = () => {
            if(tab.closed)return;
            tab.readingLayout=null;layoutEpoch++;pushState();clearTimeout(layoutTimer);
            layoutTimer=setTimeout(measureLayout,700);
        };
        const events = ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading'];
        events.forEach(event => wc.on(event, changed));
        wc.on('before-input-event', keyboard);
        const wheelZoom = (_event, direction) => { if (shown && activeId === tab.id) zoom(direction); };
        const pageMessage = (event, channel, direction) => {
            if(event.senderFrame===wc.mainFrame&&channel==='dragon-browser:operator-action'&&direction==='activity')tab.operatorAction?.('activity');
            if (event.senderFrame === wc.mainFrame && channel === 'dragon-browser:zoom-wheel' && ['in', 'out'].includes(direction)) wheelZoom(event, direction);
        };
        const found = (_event, result) => {
            if (activeId !== tab.id || !find.open || result.requestId !== findRequest) return;
            find.matches = result.matches; find.activeMatch = result.activeMatchOrdinal; pushState();
        };
        const contextMenu = (_event, params) => { if (shown && activeId === tab.id) pageMenu(tab, params); };
        const visited = () => {
            if (tab.closed) return;
            getLibrary()?.visit(wc.getURL(), wc.getTitle()).then(() => { if (panel === 'history') refreshLibrary(); }).catch(() => { libraryError = true; pushState(); });
        };
        const navigatedInPage = (_event, _url, isMainFrame) => { if (isMainFrame) visited(); };
        wc.on('zoom-changed', wheelZoom); wc.on('found-in-page', found); wc.on('context-menu', contextMenu);
        wc.on('ipc-message', pageMessage);
        wc.on('did-finish-load', visited); wc.on('did-navigate-in-page', navigatedInPage);
        if (options.page && !wc.isLoading()) visited();
        tab.cleanup = () => {
            clearInterval(layoutInterval);clearTimeout(layoutTimer);layoutEpoch++;detachLogin();
            wc.removeListener('did-start-navigation', loginNavigation);
            events.forEach(event => wc.removeListener(event, changed)); wc.removeListener('before-input-event', keyboard);
            wc.removeListener('zoom-changed', wheelZoom); wc.removeListener('found-in-page', found); wc.removeListener('context-menu', contextMenu);
            wc.removeListener('ipc-message', pageMessage);
            wc.removeListener('did-finish-load', visited); wc.removeListener('did-navigate-in-page', navigatedInPage);
        };
        wc.setWindowOpenHandler(details => {
            if (tab.closed || (tab.context && !shown)) return { action: 'deny' };
            const url = webUrl(details.url);
            if (url && onOpenAppUrl(url)) return { action: 'deny' };
            if (url) {
                const loadOptions = { httpReferrer: details.referrer };
                if (details.postBody) {
                    loadOptions.postData = details.postBody.data;
                    loadOptions.extraHeaders = `Content-Type: ${details.postBody.contentType}${details.postBody.boundary ? '; boundary=' + details.postBody.boundary : ''}`;
                }
                // 先让 Chromium 完成当前开窗回调，再切换 BrowserView，避免阻塞来源页面。
                setImmediate(() => { if (!tab.closed) open({ link: { name: url, url }, captureLogin: tab.captureLogin || captureSite(wc.getURL()), loadOptions }); });
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
        const fromSidebar = sidebarMode && sidebarHost && !sidebarHost.isDestroyed() && sender === sidebarHost.webContents;
        if(fromSidebar&&action==='sidebar-menu'){sidebarMenu(payload);return true;}
        if(fromSidebar&&action==='theme'){if(['light','dark'].includes(payload)){sidebarTheme=payload;tabs.forEach(themePage);}return true;}
        if (!win && fromSidebar && action === 'new-tab') { open({ link: { name: T('新标签页', 'New tab'), url: 'about:blank' } }); return true; }
        if (!win || (sender !== win.webContents && !fromSidebar)) return false;
        if (fromSidebar && !['tab-select','tab-close','tab-move','tab-menu','new-tab','reopen-tab','navigate','back','forward','reload','external','plugins','downloads','downloads-folder','download-action','history','bookmarks','library-open','zoom-in','zoom-out','zoom-reset','find-open','find','find-close','print','devtools','screenshot'].includes(action)) return false;
        const tab = active();
        if (!tab) { if (action === 'new-tab') open({ link: { name: T('新标签页', 'New tab'), url: 'about:blank' } }); return true; }
        const wc = tab.page.webContents;
        switch (action) {
        case 'tab-select': if (typeof payload === 'string') showTab(payload); break;
        case 'tab-close': if (typeof payload === 'string') closeTab(payload); break;
        case 'tab-move': moveTab(payload); break;
        case 'tab-menu': if (typeof payload === 'string') tabMenu(payload); break;
        case 'window-drag-start': case 'window-drag': case 'window-drag-end': dragWindow(action, payload); break;
        case 'menu': browserMenu(); break;
        case 'reopen-tab': reopenTab(); break;
        case 'bookmark': toggleBookmark(); break;
        case 'downloads': case 'history': case 'bookmarks': showPanel(action); break;
        case 'panel-close': panel = ''; layout(); pushState(); break;
        case 'notice-close': clearTimeout(noticeTimer); notice = null; layout(); pushState(); break;
        case 'history-clear': getLibrary()?.clearHistory().then(refreshLibrary).catch(() => { libraryError = true; pushState(); }); break;
        case 'library-open': {
            const url = savedUrl(payload);
            if (url && [...bookmarks, ...history].some(item => item.url === url)) open({ link: { name: url, url } });
            break;
        }
        case 'bookmark-remove': if (bookmarks.some(item => item.url === payload)) toggleBookmark(payload, ''); break;
        case 'download-action': if (payload && typeof payload.id === 'string' && ['pause', 'resume', 'cancel', 'open', 'show'].includes(payload.action)) getDownloads()?.action(payload.id, payload.action); break;
        case 'downloads-folder': shell.openPath(app.getPath('downloads')).catch(() => {}); break;
        case 'plugins': onAction(tab.context || tab,'plugins'); break;
        case 'print': wc.print({}); break;
        case 'devtools': wc.toggleDevTools(); break;
        case 'screenshot': wc.capturePage().then(async image=>{const result=await require('electron').dialog.showSaveDialog(fromSidebar?sidebarHost:win,{defaultPath:'Dragon-page.png',filters:[{name:'PNG',extensions:['png']}]});if(!result.canceled&&result.filePath)await require('fs').promises.writeFile(result.filePath,image.toPNG());}).catch(()=>{});break;
        case 'zoom-in': zoom('in'); break;
        case 'zoom-out': zoom('out'); break;
        case 'zoom-reset': zoom('reset'); break;
        case 'find-open': openFind(); break;
        case 'find': if (find.open) findText(payload); break;
        case 'find-close': closeFind(); layout(); pushState(); wc.focus(); break;
        case 'new-tab': open({ link: { name: getLanguage() === 'en-US' ? 'New tab' : '新标签页', url: 'about:blank' } }); break;
        case 'navigate': {
            if (typeof payload !== 'string' || payload.length > 8192) break;
            const value = payload.trim();
            if (!value) break;
            let url;
            if (/^localhost(?::\d+)?(?:\/|$)/i.test(value) || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/.test(value)) url = webUrl('http://' + value);
            else if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) url = webUrl(value);
            else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[\w.-]+:\d+(?:\/|$)/.test(value)) break;
            else if (!/\s/.test(value) && /[.:]/.test(value)) url = webUrl('https://' + value);
            else url = 'https://www.google.com/search?q=' + encodeURIComponent(value);
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
        setSidebar(host) {
            if(sidebarMode&&sidebarHost===host){layout();pushState();return;}
            detach(); sidebarHost = host; sidebarBounds = null; sidebarMode = Boolean(host);
            if (host && win && !win.isDestroyed()) win.hide();
            if (tabs.length) visibility(true);
            layout(); pushState();
        },
        setSidebarBounds(bounds) { sidebarBounds = bounds; layout(); },
        // Compatibility for older renderer callers: open externally, never detach the native page.
        popout() {
            const url=webUrl(active()?.page.webContents.getURL());
            if(url)shell.openExternal(url).catch(()=>{});
        },
        open, showTab, closeTab, handleAction, list: () => [...tabs], isVisible: () => shown,
        refreshLibrary, libraryFailed() { libraryError = true; pushState(); },
        downloadsChanged(change) {
            if (change?.started) { panel = 'downloads'; closeFind(); layout(); }
            if (change?.finished && panel !== 'downloads' && change.item.state !== 'cancelled' && win && !win.isDestroyed()) {
                notice = { name: change.item.name, state: change.item.state };
                clearTimeout(noticeTimer);
                noticeTimer = setTimeout(() => { notice = null; layout(); pushState(); }, 8000);
                noticeTimer.unref(); layout();
            }
            pushState();
        },
        getWindow: () => sidebarMode && sidebarHost && !sidebarHost.isDestroyed() ? sidebarHost : win, pushState,
        destroy() { disposeAll(); if (win && !win.isDestroyed()) win.destroy(); },
        findContext: context => tabs.find(tab => tab.context === context)
    };
}

module.exports = { createDragonBrowser, webUrl, TAB_HEIGHT, TOOLBAR_HEIGHT };
