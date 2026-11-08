const { contextBridge, ipcRenderer } = require('electron');

if(process.isMainFrame)contextBridge.exposeInMainWorld('ToolsSpeech',{requestMicrophone:()=>ipcRenderer.invoke('speech:microphone')});

if (process.isMainFrame) contextBridge.exposeInMainWorld('DragonBrowser', {
    connect: () => ipcRenderer.invoke('dragon-browser:connect'),
    reading: active => ipcRenderer.send('dragon-browser:reading', active),
    bounds: bounds => ipcRenderer.send('dragon-browser:bounds', bounds),
    action: (action, payload) => ipcRenderer.send('dragon-browser:action', action, payload),
    popout: () => ipcRenderer.send('dragon-browser:popout'),
    onState: callback => {
        const listener = (_event, value) => callback(value);
        ipcRenderer.on('dragon-browser:state', listener);
        return () => ipcRenderer.removeListener('dragon-browser:state', listener);
    },
    onFocusUrl: callback => {
        const listener = () => callback();
        ipcRenderer.on('dragon-browser:focus-url', listener);
        return () => ipcRenderer.removeListener('dragon-browser:focus-url', listener);
    },
    onPoppedOut: callback => {
        const listener = () => callback();
        ipcRenderer.on('dragon-browser:popped-out', listener);
        return () => ipcRenderer.removeListener('dragon-browser:popped-out', listener);
    },
    onUivImport: callback => {
        const listener = (_event, href) => callback(href);
        ipcRenderer.on('dragon-browser:uiv-import', listener);
        return () => ipcRenderer.removeListener('dragon-browser:uiv-import', listener);
    },
    onReveal: callback => {
        const listener = () => callback();
        ipcRenderer.on('dragon-browser:reveal', listener);
        return () => ipcRenderer.removeListener('dragon-browser:reveal', listener);
    }
});

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

if (process.platform === 'darwin' && process.isMainFrame) {
    contextBridge.exposeInMainWorld('DragonEmbeddedTool', {
        command: (action, id, details) => ipcRenderer.send('desktop-tool:command', { ...details, action, id }),
        onStatus: callback => ipcRenderer.on('desktop-tool:status', (_event, status) => callback(status))
    });
}

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

// 桌面端全局下载管理：静默下载至默认目录、右上角进度浮动条、折叠右侧圆环
contextBridge.exposeInMainWorld('DragonDownload', {
    onEvent: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('desktop-download:event', listener);
        return () => ipcRenderer.removeListener('desktop-download:event', listener);
    },
    changeDirectory: () => ipcRenderer.invoke('desktop-download:change-directory'),
    getDirectory: () => ipcRenderer.invoke('desktop-download:get-directory'),
    openFile: (savePath) => ipcRenderer.invoke('desktop-download:open-file', savePath),
    showItemInFolder: (savePath) => ipcRenderer.invoke('desktop-download:show-item-in-folder', savePath),
    cancel: (id) => ipcRenderer.invoke('desktop-download:cancel', id)
});

// 桌面端自动记住密码管理：跨端口与重启无缝保存与读取凭据
contextBridge.exposeInMainWorld('ToolsDesktopAuth', {
    getSavedCredentials: () => ipcRenderer.invoke('desktop-auth:get-credentials'),
    saveCredentials: (credentials) => ipcRenderer.invoke('desktop-auth:save-credentials', credentials),
    clearCredentials: () => ipcRenderer.invoke('desktop-auth:clear-credentials')
});
