// 推广卡片外壳（标题条/工具栏）与小窗遮罩共用的预加载脚本：只暴露固定的几个动作。
const { contextBridge, ipcRenderer } = require('electron');

const ACTIONS = new Set(['activate', 'front', 'expand', 'hide-stack', 'minimize', 'close', 'maximize', 'back', 'forward', 'reload', 'home', 'external', 'plugins', 'scripts', 'tab-select', 'tab-close', 'tab-move', 'new-tab', 'navigate', 'window-drag-start', 'window-drag', 'window-drag-end']);
for (const action of ['tab-menu', 'menu', 'reopen-tab', 'bookmark', 'bookmarks', 'history', 'downloads', 'panel-close', 'notice-close', 'history-clear', 'library-open', 'bookmark-remove', 'download-action', 'downloads-folder', 'zoom-in', 'zoom-out', 'zoom-reset', 'find-open', 'find', 'find-close']) ACTIONS.add(action);

contextBridge.exposeInMainWorld('promoCard', {
    send: (action, payload) => {
        if (!ACTIONS.has(action)) return;
        if (['tab-select', 'tab-close', 'navigate'].includes(action) && (typeof payload !== 'string' || payload.length > 8192)) return;
        let value = typeof payload === 'string' ? payload : undefined;
        if (['window-drag-start', 'window-drag'].includes(action)) {
            if (!payload || !Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
            value = { x: payload.x, y: payload.y };
        } else if (action === 'tab-move') {
            if (!payload || typeof payload.id !== 'string' || !(payload.beforeId === null || typeof payload.beforeId === 'string')) return;
            value = { id: payload.id, beforeId: payload.beforeId };
        } else if (action === 'find') {
            if (!payload || typeof payload.text !== 'string' || payload.text.length > 500) return;
            value = { text: payload.text, forward: payload.forward !== false };
        } else if (action === 'download-action') {
            if (!payload || typeof payload.id !== 'string' || !['pause', 'resume', 'cancel', 'open', 'show'].includes(payload.action)) return;
            value = { id: payload.id, action: payload.action };
        }
        ipcRenderer.send('promo-card:action', action, value);
    },
    onFocusUrl: callback => {
        if (typeof callback === 'function') ipcRenderer.on('promo-card:focus-url', () => callback());
    },
    onFocusFind: callback => {
        if (typeof callback === 'function') ipcRenderer.on('promo-card:focus-find', () => callback());
    },
    onState: callback => {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('promo-card:state', (_event, state) => callback(state));
    }
});
