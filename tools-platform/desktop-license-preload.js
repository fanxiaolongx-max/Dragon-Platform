const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('DesktopLicense', {
    getState: () => ipcRenderer.invoke('desktop-license:get-state'),
    activate: token => ipcRenderer.invoke('desktop-license:activate', token),
    quit: () => ipcRenderer.invoke('desktop-license:quit'),
    readClipboard: () => {
        try {
            if (clipboard && typeof clipboard.readText === 'function') {
                return clipboard.readText();
            }
        } catch (_) {}
        return '';
    },
    writeClipboard: text => {
        try {
            if (clipboard && typeof clipboard.writeText === 'function') {
                clipboard.writeText(String(text || ''));
                return true;
            }
        } catch (_) {}
        return false;
    },
    requestInfo: () => ipcRenderer.invoke('desktop-license:request-info'),
    submitRequest: form => ipcRenderer.invoke('desktop-license:request-submit', form),
    refreshRequest: () => ipcRenderer.invoke('desktop-license:request-refresh'),
    cancelRequest: () => ipcRenderer.invoke('desktop-license:request-cancel'),
    onRequestUpdate: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('desktop-license:request-update', handler);
        return () => {
            try { ipcRenderer.removeListener('desktop-license:request-update', handler); } catch (_) {}
        };
    },
    onProgress: (callback) => {
        if (typeof callback !== 'function') return () => {};
        const handler = (_event, data) => callback(data);
        ipcRenderer.on('desktop-license:progress', handler);
        return () => {
            try {
                ipcRenderer.removeListener('desktop-license:progress', handler);
            } catch (_) {}
        };
    }
});
