const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ToolsUpdater', {
    getVersion: () => ipcRenderer.invoke('updater:get-version'),
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('updater:status', listener);
        return () => ipcRenderer.removeListener('updater:status', listener);
    }
});

contextBridge.exposeInMainWorld('ToolsDesktop', {
    getRuntimeSnapshot: () => ipcRenderer.invoke('desktop:get-runtime-snapshot'),
    openLogsFolder: () => ipcRenderer.invoke('desktop:open-logs-folder')
});

// 主窗口（desktop-main-window.js）的左上角窗口按钮：页面通过它最小化 / 最大化 / 关闭，并接收窗口状态变化
contextBridge.exposeInMainWorld('DragonWindow', {
    minimize: () => ipcRenderer.send('desktop-window:minimize'),
    toggleMaximize: () => ipcRenderer.send('desktop-window:toggle-maximize'),
    close: () => ipcRenderer.send('desktop-window:close'),
    getState: () => ipcRenderer.invoke('desktop-window:get-state'),
    onState: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('desktop-window:state', listener);
        return () => ipcRenderer.removeListener('desktop-window:state', listener);
    }
});
