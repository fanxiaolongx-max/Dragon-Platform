const fs = require('fs');
const path = require('path');

function downloadFilename(value) {
    // 只使用文件名；兼容 Windows 禁用字符和设备名。
    let name = String(value || '').replace(/\\/g, '/').split('/').pop()
        .replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '');
    if (!name || name === '.') name = 'download';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    return name;
}

function configureDownloads(session, getDirectory) {
    const reserved = new Set();
    const keyFor = file => process.platform === 'linux' ? file : file.toLowerCase();
    const exists = file => {
        try { fs.lstatSync(file); return true; }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    };
    function onDownload(_event, item) {
        let key;
        try {
            const directory = getDirectory();
            fs.mkdirSync(directory, { recursive: true });
            const name = downloadFilename(item.getFilename());
            const { name: stem, ext } = path.parse(name);
            let target = path.join(directory, name), number = 0;
            while (reserved.has(keyFor(target)) || exists(target)) {
                target = path.join(directory, `${stem} (${++number})${ext}`);
            }
            key = keyFor(target);
            reserved.add(key);
            item.once('done', () => reserved.delete(key));
            // 在 will-download 回调内明确指定路径，Electron 就不会弹出另存为窗口。
            item.setSavePath(target);
        } catch (error) {
            if (key) reserved.delete(key);
            item.cancel();
            console.warn('[DragonBrowser] 无法保存下载文件：', error.message || error);
        }
    }
    session.on('will-download', onDownload);
    return () => session.removeListener('will-download', onDownload);
}

module.exports = { configureDownloads, downloadFilename };
