// 桌面端主窗口：本机服务就绪后直接在应用自己的窗口里打开首页，不再调用系统浏览器。
// · 隐藏系统标题栏，但保留系统窗口边框（Windows 的 WS_THICKFRAME）：四边四角由系统处理调整大小（感应区在可见边缘外侧，圆角处一样准）、
//   Windows 11 自动圆角与阴影、拖到屏幕边缘分屏；不用透明窗口 + CSS 圆角（那样会失去系统的调整大小边框）。
// · 窗口按钮（关闭 / 最小化 / 最大化）在页面左上角，Mac 风格：macOS 用系统红绿灯，Windows / Linux 由页面自己画（js/shared/desktop-window.js）。
//   页面顶部条带是拖动区（-webkit-app-region: drag），双击最大化、再双击还原由系统处理。
// · 去掉浏览器的痕迹：没有菜单栏、没有浏览器右键菜单（输入框保留剪切 / 复制 / 粘贴，选中文字可复制），
//   刷新、缩放、开发者工具快捷键不生效；站外链接用系统浏览器打开。
// · 点关闭只是隐藏到托盘（本机服务继续运行），从托盘「退出」才真正退出。
'use strict';
const { BrowserView, BrowserWindow, Menu, ipcMain, screen, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const DATACOM_TOOL_PATH = '/tools/datacom-protocol-expert';

function createMainWindowController({ getBaseUrl, getIconPath, statePath, isQuitting, preloadPath }) {
    let win = null;
    let saveTimer = null;
    let toolSurface;
    // TOOLS_DESKTOP_WIN_CHROME=1：在 macOS 上预览 Windows 的窗口外观（开发调试用）
    const isMac = process.platform === 'darwin' && !process.env.TOOLS_DESKTOP_WIN_CHROME;

    function readState() {
        try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) || {}; } catch { return {}; }
    }
    function writeState() {
        if (!win || win.isDestroyed()) return;
        try {
            const bounds = win.isMaximized() || win.isFullScreen() ? (readState().bounds || win.getNormalBounds()) : win.getBounds();
            fs.mkdirSync(path.dirname(statePath), { recursive: true });
            fs.writeFileSync(statePath, JSON.stringify({ bounds, maximized: win.isMaximized() }, null, 2));
        } catch { /* 记不住位置不影响使用 */ }
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(writeState, 400);
    }
    // 记住的位置必须还落在某块屏幕里（拔掉外接屏后不能跑到看不见的地方）
    function initialBounds() {
        const saved = readState();
        const area = screen.getPrimaryDisplay().workArea;
        const fallback = { width: Math.min(1440, Math.round(area.width * 0.88)), height: Math.min(940, Math.round(area.height * 0.9)) };
        const b = saved.bounds;
        if (b && b.width >= 900 && b.height >= 600) {
            const visible = screen.getAllDisplays().some(display => {
                const w = display.workArea;
                return b.x + 80 < w.x + w.width && b.x + b.width - 80 > w.x && b.y >= w.y - 8 && b.y + 40 < w.y + w.height;
            });
            if (visible) return { bounds: b, maximized: Boolean(saved.maximized) };
        }
        return { bounds: { ...fallback, x: area.x + Math.round((area.width - fallback.width) / 2), y: area.y + Math.round((area.height - fallback.height) / 2) }, maximized: Boolean(saved.maximized) };
    }

    function baseOrigin() {
        try { return new URL(getBaseUrl()).origin; } catch { return ''; }
    }
    const isAppUrl = url => { try { return new URL(url).origin === baseOrigin(); } catch { return false; } };
    function openExternal(url) {
        if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url).catch(() => {});
    }

    function sendState() {
        if (!win || win.isDestroyed()) return;
        win.webContents.send('desktop-window:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() });
    }

    // 只给输入框和选中文字一个精简的中文菜单；其他地方右键不出任何浏览器菜单
    function contextMenu(webContents, params) {
        const items = [];
        if (params.isEditable) {
            const flags = params.editFlags || {};
            items.push(
                { label: '撤销', role: 'undo', enabled: flags.canUndo },
                { label: '重做', role: 'redo', enabled: flags.canRedo },
                { type: 'separator' },
                { label: '剪切', role: 'cut', enabled: flags.canCut },
                { label: '复制', role: 'copy', enabled: flags.canCopy },
                { label: '粘贴', role: 'paste', enabled: flags.canPaste },
                { label: '全选', role: 'selectAll' }
            );
        } else if (params.selectionText && params.selectionText.trim()) {
            items.push({ label: '复制', role: 'copy' });
        }
        if (params.linkURL && !isAppUrl(params.linkURL) && /^https?:/i.test(params.linkURL)) {
            if (items.length) items.push({ type: 'separator' });
            items.push({ label: '在浏览器中打开链接', click: () => openExternal(params.linkURL) });
        }
        if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(webContents) || undefined });
    }

    // 浏览器式快捷键：刷新 / 强制刷新 / 缩放 / 开发者工具 / 打印 / 查看源码
    const terminalFocus = new WeakSet(); // 焦点在终端面板的 webContents：不拦截任何按键
    function blockBrowserKeys(event, input) {
        if (input.type !== 'keyDown') return;
        if (terminalFocus.has(this)) return;
        const key = String(input.key || '').toLowerCase();
        const mod = isMac ? input.meta : input.control;
        const blocked = key === 'f5' || key === 'f12'
            || (mod && ['r', '+', '=', '-', '_', '0', 'p', 'u'].includes(key))
            || (mod && input.shift && ['i', 'j', 'c', 'r'].includes(key))
            || (isMac && input.meta && input.alt && ['i', 'j', 'c'].includes(key));
        if (blocked && !process.env.TOOLS_DESKTOP_DEVTOOLS) event.preventDefault();
    }

    function hardenContents(contents) {
        contents.on('context-menu', (_event, params) => contextMenu(contents, params));
        contents.on('before-input-event', blockBrowserKeys);
        contents.setVisualZoomLevelLimits(1, 1).catch(() => {});
        // 站外跳转交给系统浏览器；本机页面在窗口内打开
        contents.on('will-navigate', (event, url) => {
            if (isAppUrl(url) || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return;
            event.preventDefault();
            openExternal(url);
        });
        contents.setWindowOpenHandler(({ url }) => {
            if (isAppUrl(url)) {
                // 「新窗口打开」等：本机页面在一个普通的独立窗口里打开（同一登录状态）
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        width: 1280, height: 860, autoHideMenuBar: true, icon: getIconPath(), backgroundColor: '#ffffff',
                        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
                    }
                };
            }
            openExternal(url);
            return { action: 'deny' };
        });
    }

    function closeToolSurface() {
        const surface = toolSurface;
        if (!surface) return;
        toolSurface = null;
        clearInterval(surface.watchdog);
        if (!surface.owner.isDestroyed()) surface.owner.removeBrowserView(surface.view);
        if (!surface.contents.isDestroyed()) surface.contents.destroy();
    }

    function layoutToolSurface(surface) {
        const { owner, view, bounds } = surface;
        if (!surface.ready || !bounds || owner.isDestroyed()) return;
        const [width, height] = owner.getContentSize();
        const x = Math.min(width, Math.max(0, Math.round(bounds.x)));
        const y = Math.min(height, Math.max(0, Math.round(bounds.y)));
        const w = Math.min(width - x, Math.round(bounds.width));
        const h = Math.min(height - y, Math.round(bounds.height));
        if (!bounds.visible || w <= 0 || h <= 0) {
            owner.removeBrowserView(view);
            return;
        }
        view.setBounds({ x, y, width: w, height: h });
        if (!owner.getBrowserViews().includes(view)) owner.addBrowserView(view);
    }

    function openToolSurface(owner, id, url) {
        closeToolSurface();
        const view = new BrowserView({
            webPreferences: {
                session: owner.webContents.session,
                preload: path.join(__dirname, 'desktop-tool-surface-preload.js'),
                contextIsolation: true, nodeIntegration: false, sandbox: true,
                backgroundThrottling: false, spellcheck: false
            }
        });
        const contents = view.webContents;
        const surface = { id, owner, view, contents, ready: false, lastPong: Date.now() };
        toolSurface = surface;
        const report = status => {
            if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
                owner.webContents.send('desktop-tool:status', { id, status });
            }
        };
        const fail = status => {
            if (toolSurface !== surface) return;
            closeToolSurface();
            report(status);
        };
        surface.setReady = () => {
            if (surface.ready) return;
            surface.ready = true;
            surface.lastPong = Date.now();
            layoutToolSurface(surface);
            report('ready');
        };
        hardenContents(contents);
        contents.on('did-create-window', child => hardenContents(child.webContents));
        contents.on('unresponsive', () => fail('unresponsive'));
        contents.on('render-process-gone', () => fail('failed'));
        contents.on('did-finish-load', () => {
            if (new URL(contents.getURL()).pathname !== DATACOM_TOOL_PATH) fail('failed');
        });
        surface.watchdog = setInterval(() => {
            if (Date.now() - surface.lastPong > (surface.ready ? 5000 : 30000)) {
                fail(surface.ready ? 'unresponsive' : 'timeout');
            } else if (surface.ready) {
                contents.send('desktop-tool:ping');
            }
        }, 1000);
        contents.loadURL(url.href).catch(() => fail('failed'));
    }

    function create() {
        const { bounds, maximized } = initialBounds();
        win = new BrowserWindow({
            ...bounds,
            minWidth: 900,
            minHeight: 600,
            show: false,
            title: 'Dragon Claw',
            icon: getIconPath(),
            backgroundColor: '#ffffff',
            // macOS：隐藏标题栏，保留系统红绿灯（左上角）；Windows / Linux：无系统标题栏，保留系统边框用于调整大小、圆角与阴影
            ...(isMac
                ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 24 } }
                : { frame: false, thickFrame: true }),
            autoHideMenuBar: true,
            webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
        });
        if (!isMac) win.setMenu(null);
        hardenContents(win.webContents);
        win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
            if (mainFrame && !inPlace) closeToolSurface();
        });
        // 页面渲染进程崩溃后窗口会变成空白：收起工具层并重新加载，一分钟内最多三次，避免反复崩溃时死循环。
        const reloads = [];
        win.webContents.on('render-process-gone', (_event, details = {}) => {
            closeToolSurface();
            if (details.reason === 'clean-exit' || isQuitting()) return;
            const now = Date.now();
            while (reloads.length && now - reloads[0] > 60000) reloads.shift();
            if (reloads.length >= 3) return;
            reloads.push(now);
            setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, 500);
        });
        win.webContents.on('did-create-window', child => {
            child.setMenu(null);
            hardenContents(child.webContents);
        });
        win.once('ready-to-show', () => {
            if (maximized) win.maximize();
            win.show();
        });
        ['resize', 'move'].forEach(name => win.on(name, scheduleSave));
        ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur'].forEach(name => win.on(name, () => { sendState(); scheduleSave(); }));
        // 关闭 = 隐藏到托盘；托盘「退出」时才真正关闭
        win.on('close', event => {
            writeState();
            if (isQuitting()) return;
            event.preventDefault();
            if (win.isFullScreen()) { win.once('leave-full-screen', () => win.hide()); win.setFullScreen(false); } else win.hide();
        });
        win.on('closed', () => { closeToolSurface(); win = null; });
        return win;
    }

    // 打开（或切到）主窗口，并在窗口内显示指定页面
    function open(target = '/') {
        const base = getBaseUrl();
        if (!base) return false;
        const url = new URL(target, base).toString();
        const fresh = !win || win.isDestroyed();
        if (fresh) create();
        const current = fresh ? '' : win.webContents.getURL();
        const sameHome = current && new URL(current).pathname === '/' && new URL(url).pathname === '/' && !new URL(url).search;
        if (fresh || (!sameHome && current !== url)) win.loadURL(url).catch(() => {});
        if (!fresh) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
        }
        return true;
    }

    function registerIpc() {
        const fromSender = event => BrowserWindow.fromWebContents(event.sender);
        ipcMain.on('desktop-tool:command', (event, { action, id, href, bounds } = {}) => {
            if (process.platform !== 'darwin' || !win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) return;
            const hostUrl = event.senderFrame.url;
            if (!isAppUrl(hostUrl) || new URL(hostUrl).pathname !== '/' || !Number.isSafeInteger(id)) return;
            if (action === 'open') {
                let url;
                try { url = new URL(href, hostUrl); } catch { return; }
                if (!isAppUrl(url.href) || url.pathname !== DATACOM_TOOL_PATH) return;
                url.searchParams.set('standalone', '1');
                openToolSurface(win, id, url);
            } else if (toolSurface?.id === id) {
                if (action === 'close') closeToolSurface();
                if (action === 'layout' && bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) {
                    toolSurface.bounds = bounds;
                    layoutToolSurface(toolSurface);
                }
            }
        });
        ipcMain.on('desktop-tool:signal', (event, signal) => {
            const surface = toolSurface;
            if (!surface || event.sender !== surface.contents || event.senderFrame !== event.sender.mainFrame) return;
            const url = event.senderFrame.url;
            if (!isAppUrl(url) || new URL(url).pathname !== DATACOM_TOOL_PATH) return;
            if (signal === 'ready') surface.setReady();
            if (signal === 'pong') surface.lastPong = Date.now();
        });
        ipcMain.on('desktop-window:minimize', event => fromSender(event)?.minimize());
        ipcMain.on('desktop-window:toggle-maximize', event => {
            const target = fromSender(event);
            if (!target) return;
            if (target.isFullScreen()) target.setFullScreen(false);
            else if (target.isMaximized()) target.unmaximize();
            else target.maximize();
        });
        ipcMain.on('desktop-window:close', event => fromSender(event)?.close());
        ipcMain.handle('desktop-window:read-clipboard', () => require('electron').clipboard.readText());
        ipcMain.on('desktop-window:terminal-keys', (event, active) => { if (active) terminalFocus.add(event.sender); else terminalFocus.delete(event.sender); });
        ipcMain.handle('desktop-window:get-state', event => {
            const target = fromSender(event);
            return { platform: isMac ? 'darwin' : process.platform === 'darwin' ? 'win32' : process.platform, maximized: Boolean(target?.isMaximized()), fullscreen: Boolean(target?.isFullScreen()), focused: Boolean(target?.isFocused()), main: target === win };
        });
    }

    return {
        open,
        registerIpc,
        get window() { return win && !win.isDestroyed() ? win : null; },
        isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
        destroy() { if (win && !win.isDestroyed()) win.destroy(); win = null; },
        version: () => app.getVersion()
    };
}

module.exports = { createMainWindowController };
