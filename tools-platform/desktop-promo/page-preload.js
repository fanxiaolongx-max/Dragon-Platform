// 隔离世界中接收真实 Ctrl/Command+滚轮；不向网页暴露任何 Electron API。
const { ipcRenderer } = require('electron');
window.addEventListener('wheel', event => {
    if (!event.isTrusted || !(event.ctrlKey || event.metaKey) || !event.deltaY) return;
    event.preventDefault();
    ipcRenderer.send('dragon-browser:zoom-wheel', event.deltaY < 0 ? 'in' : 'out');
}, { capture: true, passive: false });
