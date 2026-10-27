// 小窗使用独立的桌面视口缩放，避免 setZoomFactor 的同源联动影响其他大窗。
const STYLE_ID = 'tools-desktop-preview-scrollbars';
const PREVIEW_CSS = 'html,body{overflow:hidden!important}*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';

function createPagePreview(contents, { isExpanded, getBounds, getDesktopSize }) {
    let previous = '';
    let documentReady = false;

    function syncStyles() {
        if (contents.isDestroyed() || !documentReady) return Promise.resolve();
        const preview = !isExpanded();
        const code = `(() => {
            const id = ${JSON.stringify(STYLE_ID)};
            let style = document.getElementById(id);
            if (!${preview}) { if (style) style.remove(); return; }
            if (!document.documentElement || style) return;
            style = document.createElement('style'); style.id = id;
            style.textContent = ${JSON.stringify(PREVIEW_CSS)};
            document.documentElement.appendChild(style);
        })()`;
        // 包括跨域 iframe：只改变预览样式，不读取或传递站点内容。
        return Promise.all(contents.mainFrame.framesInSubtree.map(frame =>
            frame.executeJavaScript(code).catch(() => {}) // 页面可能正在跳转或移除 iframe
        ));
    }

    function update() {
        if (contents.isDestroyed() || !documentReady) return;
        const expanded = isExpanded();
        const bounds = getBounds();
        const desktop = getDesktopSize();
        const width = Math.max(1600, desktop.width);
        const height = Math.round(width * bounds.height / Math.max(1, bounds.width));
        const key = expanded ? 'expanded' : `${bounds.width}:${bounds.height}:${width}`;
        if (key !== previous) {
            previous = key;
            if (expanded) contents.disableDeviceEmulation();
            else contents.enableDeviceEmulation({
                screenPosition: 'desktop', screenSize: { width, height },
                viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0,
                viewSize: { width, height }, scale: bounds.width / width
            });
            syncStyles();
        }
    }

    contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) documentReady = false;
    });
    contents.on('did-frame-finish-load', syncStyles);
    contents.on('dom-ready', () => {
        documentReady = true;
        previous = '';
        contents.setVisualZoomLevelLimits(1, 1).catch(() => {});
        update();
        syncStyles();
    });
    return { update, syncStyles };
}

module.exports = { createPagePreview };
