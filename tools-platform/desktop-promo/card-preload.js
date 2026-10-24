// 推广卡片外壳（标题条/工具栏）与小窗遮罩共用的预加载脚本：只暴露固定的几个动作。
const { contextBridge, ipcRenderer } = require('electron');

const ACTIONS = new Set(['activate', 'front', 'expand', 'hide-stack', 'minimize', 'close', 'maximize', 'back', 'forward', 'reload', 'home', 'external', 'plugins', 'scripts', 'tab-select', 'tab-close', 'new-tab', 'navigate']);

contextBridge.exposeInMainWorld('promoCard', {
    send: (action, payload) => {
        if (!ACTIONS.has(action)) return;
        if (['tab-select', 'tab-close', 'navigate'].includes(action) && (typeof payload !== 'string' || payload.length > 8192)) return;
        ipcRenderer.send('promo-card:action', action, typeof payload === 'string' ? payload : undefined);
    },
    onFocusUrl: callback => {
        if (typeof callback === 'function') ipcRenderer.on('promo-card:focus-url', () => callback());
    },
    onState: callback => {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('promo-card:state', (_event, state) => callback(state));
    }
});
