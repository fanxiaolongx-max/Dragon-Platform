'use strict';
// 下载横幅视图的最小桥：只接收主进程下发的横幅事件，回传内容高度与「打开/在文件夹中显示」。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DragonDownloadToast', {
    onEvent: callback => {
        if (typeof callback !== 'function') return;
        ipcRenderer.on('dragon-download-toast:event', (_event, message) => callback(message));
    },
    size: height => ipcRenderer.send('dragon-download-toast:size', Number(height) || 0),
    action: (id, action) => ipcRenderer.send('dragon-download-toast:action', { id: String(id || ''), action: String(action || '') })
});
