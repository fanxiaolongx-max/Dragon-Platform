const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
    ipcRenderer.on('desktop-tool:ping', () => ipcRenderer.send('desktop-tool:signal', 'pong'));
    contextBridge.exposeInMainWorld('DragonToolSurface', {
        ready: () => ipcRenderer.send('desktop-tool:signal', 'ready')
    });
}
