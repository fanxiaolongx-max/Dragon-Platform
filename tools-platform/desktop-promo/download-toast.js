'use strict';
// Dragon 浏览器（侧栏模式）下载横幅：网页是原生 BrowserView，会盖住宿主 HTML，
// 所以横幅放进一块透明的置顶 BrowserView，紧贴在工具栏「下载」按钮下方。
// 视图只在有横幅时挂载，高度跟随内容，避免空白区域拦截网页点击。
const path = require('path');

const VIEW_WIDTH = 324;   // 300px 卡片 + 左右各 12px 阴影留白（CSS 像素）
const EDGE_RIGHT = 12;    // 卡片右边缘到视图右边缘的距离
const ALIGN_OFFSET = 4;   // 卡片右边缘比按钮右边缘再往右 4px，视觉上与按钮组对齐
const GAP_BELOW = 2;      // 视图顶端距按钮底部；页面内另有 6px 顶部留白

function finite(value) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6; }

function createDownloadToast({ getHost, getTheme = () => 'light', getLanguage = () => 'zh-CN', onAction = () => {}, BrowserView = null } = {}) {
    let view = null, ready = false, attachedTo = null, anchor = null, height = 0;
    const queue = [];

    function hostWindow() {
        const host = getHost();
        return host && !host.isDestroyed() ? host : null;
    }
    function send(message) {
        if (!view || view.webContents.isDestroyed()) return;
        if (!ready) { queue.push(message); if (queue.length > 50) queue.shift(); return; }
        view.webContents.send('dragon-download-toast:event', message);
    }
    function config() {
        return { type: 'config', theme: getTheme() === 'dark' ? 'dark' : 'light', lang: getLanguage() === 'en-US' ? 'en-US' : 'zh-CN' };
    }
    function ensureView() {
        if (view && !view.webContents.isDestroyed()) return view;
        const View = BrowserView || require('electron').BrowserView;
        ready = false; queue.length = 0;
        view = new View({ webPreferences: { preload: path.join(__dirname, 'download-toast-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
        view.setBackgroundColor('#00000000');
        const wc = view.webContents;
        wc.setWindowOpenHandler(() => ({ action: 'deny' }));
        wc.on('will-navigate', event => event.preventDefault());
        wc.on('ipc-message', (event, channel, payload) => {
            if (event.senderFrame !== wc.mainFrame) return;
            if (channel === 'dragon-download-toast:size') { if (finite(payload) && payload >= 0) { height = Math.min(2000, Math.ceil(payload)); place(); } }
            else if (channel === 'dragon-download-toast:action') {
                if (payload && typeof payload.id === 'string' && ['open', 'show'].includes(payload.action)) onAction(payload.id, payload.action);
            }
        });
        wc.on('did-finish-load', () => {
            ready = true;
            wc.send('dragon-download-toast:event', config());
            for (const message of queue.splice(0)) wc.send('dragon-download-toast:event', message);
        });
        wc.loadFile(path.join(__dirname, 'download-toast.html')).catch(() => {});
        return view;
    }
    function detach() {
        if (view && attachedTo && !attachedTo.isDestroyed()) { try { attachedTo.removeBrowserView(view); } catch (_) { /* 宿主已关闭 */ } }
        attachedTo = null;
    }
    function place() {
        const host = hostWindow();
        if (!view || view.webContents.isDestroyed() || !host || !anchor || height <= 0) { detach(); return; }
        const zoom = host.webContents.getZoomFactor() || 1;
        const [hostWidth, hostHeight] = host.getContentSize();
        const width = Math.min(Math.round(VIEW_WIDTH * zoom), hostWidth);
        const x = Math.max(0, Math.min(hostWidth - width, Math.round((anchor.right + ALIGN_OFFSET + EDGE_RIGHT) * zoom) - width));
        const y = Math.max(0, Math.round((anchor.bottom + GAP_BELOW) * zoom));
        const h = Math.min(Math.round(height * zoom), hostHeight - y);
        if (h <= 0 || width <= 0) { detach(); return; }
        if (attachedTo !== host) { detach(); host.addBrowserView(view); attachedTo = host; }
        if (Math.abs(view.webContents.getZoomFactor() - zoom) > .001) view.webContents.setZoomFactor(zoom);
        view.setBounds({ x, y, width, height: h });
        host.setTopBrowserView(view);
    }

    return {
        // anchor 为宿主页面里「下载」按钮的 CSS 坐标；null 表示浏览器侧栏已收起/被遮挡。
        setAnchor(value) {
            const next = value && finite(value.right) && finite(value.bottom) ? { right: value.right, bottom: value.bottom } : null;
            if (!next && anchor) send({ type: 'clear' });
            anchor = next;
            place();
        },
        push(change) {
            const item = change?.item;
            if (!item || typeof item.id !== 'string') return;
            // 只为侧栏可见时开始/结束的下载建立横幅；进度更新只刷新已有横幅。
            const opens = Boolean(change.started || change.finished) && item.state !== 'cancelled';
            if (!view && !opens) return;
            if (opens && (!anchor || !hostWindow())) return;
            ensureView();
            send({ type: 'download', started: Boolean(change.started), finished: Boolean(change.finished), item: { id: item.id, name: String(item.name || ''), state: String(item.state || ''), received: Number(item.received) || 0, total: Number(item.total) || 0 } });
        },
        refreshConfig() { if (view) send(config()); },
        // 宿主重新挂载网页 BrowserView 后调用，保证横幅仍在最上层。
        raise() { if (attachedTo && view && !attachedTo.isDestroyed()) attachedTo.setTopBrowserView(view); },
        // 清空横幅但保留锚点：锚点只在按钮位置变化时由宿主重发。
        reset() { send({ type: 'clear' }); height = 0; detach(); },
        destroy() {
            detach();
            if (view && !view.webContents.isDestroyed()) view.webContents.close();
            view = null; ready = false; queue.length = 0;
        },
        get attached() { return Boolean(attachedTo); }
    };
}

module.exports = { createDownloadToast, VIEW_WIDTH };
