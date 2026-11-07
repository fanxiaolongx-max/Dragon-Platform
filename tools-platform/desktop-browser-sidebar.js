'use strict';
// Dragon 浏览器侧栏 IPC：仅本机主窗口首页可挂载浏览器页面。
function registerBrowserSidebar({ ipcMain, getWindow, getBaseUrl, browser, onReadingChange = () => {} }) {
    // 仅主窗口的首页主 frame 能把既有 Dragon 标签页挂到侧栏；外部网页没有该 preload/IPC 权限。
    function browserSidebarSender(event) {
        try {
            const host = getWindow();
            // 窗口销毁后，队列里仍可能有布局 IPC；senderFrame getter 本身也可能抛错。
            if (!host || host.isDestroyed() || event.sender.isDestroyed() || event.sender !== host.webContents) return null;
            const frame = event.senderFrame;
            if (!frame || frame !== event.sender.mainFrame) return null;
            const url = new URL(frame.url), base = new URL(getBaseUrl());
            return url.origin === base.origin && ['/', '/index.html'].includes(url.pathname) ? host : null;
        } catch { return null; }
    }
    ipcMain.handle('dragon-browser:connect', event => {
        const host = browserSidebarSender(event);
        if (!host || !browser.setBrowserSidebar) return false;
        browser.setBrowserSidebar(host);
        if (!host.__dragonSidebarBound) {
            host.__dragonSidebarBound = true;
            host.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
                if (isMainFrame) { browser.setBrowserSidebarBounds(null); onReadingChange(false); }
            });
            host.on('closed', () => { browser.setBrowserSidebar(null); onReadingChange(false); });
        }
        return true;
    });
    ipcMain.on('dragon-browser:bounds', (event, bounds) => {
        const host = browserSidebarSender(event);
        if (!host) return;
        if (!bounds) return browser.setBrowserSidebarBounds?.(null);
        const zoom = host.webContents.getZoomFactor(), [width, height] = host.getContentSize();
        if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) return;
        const x = Math.max(0, Math.round(bounds.x * zoom)), y = Math.max(0, Math.round(bounds.y * zoom));
        const w = Math.min(Math.round(bounds.width * zoom), width - x), h = Math.min(Math.round(bounds.height * zoom), height - y);
        browser.setBrowserSidebarBounds?.(w > 0 && h > 0 ? { x, y, width: w, height: h } : null);
    });
    ipcMain.on('dragon-browser:reading', (event, active) => {
        if (browserSidebarSender(event) && typeof active === 'boolean') onReadingChange(active);
    });
    ipcMain.on('dragon-browser:action', (event, action, payload) => {
        if (browserSidebarSender(event)) browser.browserSidebarAction?.(event.sender, action, payload);
    });
    ipcMain.on('dragon-browser:popout', event => {
        if (browserSidebarSender(event)) browser.popoutBrowser?.();
    });

}
module.exports = { registerBrowserSidebar };
