const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function downloadFilename(value) {
    // 只使用文件名；兼容 Windows 禁用字符和设备名。
    let name = String(value || '').replace(/\\/g, '/').split('/').pop()
        .replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/[. ]+$/, '');
    if (!name || name === '.') name = 'download';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
    return name;
}

function configureDownloads(session, getDirectory, { onChange = () => {}, library = null, openFile = () => {}, showFile = () => {} } = {}) {
    const reserved = new Set();
    const records = new Map(), live = new Map();
    let disposed = false;
    const persist = record => library?.saveDownload(record).catch(() => {});
    const emit = (record, started = false, finished = false) => { if (!disposed) onChange([...records.values()].reverse(), { started, finished, item: record }); };
    const ready = library ? library.downloads().then(items => {
        for (const item of items.reverse()) if (!records.has(item.id)) records.set(item.id, item);
        emit();
    }).catch(() => {}) : Promise.resolve();
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
            const record = { id: randomUUID(), name, path: target, state: 'progressing', received: 0, total: item.getTotalBytes?.() || 0, startedAt: Date.now() };
            records.set(record.id, record); live.set(record.id, item);
            let lastUpdate = 0;
            item.on('updated', (_event, state) => {
                record.state = item.isPaused() ? 'paused' : state;
                record.received = item.getReceivedBytes(); record.total = item.getTotalBytes();
                if (Date.now() - lastUpdate < 150) return;
                lastUpdate = Date.now(); emit(record);
            });
            item.once('done', (_event, state) => {
                record.state = state; record.received = item.getReceivedBytes?.() || record.received;
                record.total = item.getTotalBytes?.() || record.total;
                live.delete(record.id); persist(record); emit(record, false, true);
            });
            persist(record); emit(record, true);
        } catch (error) {
            if (key) reserved.delete(key);
            item.cancel();
            const record = { id: randomUUID(), name: downloadFilename(item.getFilename()), path: '', state: 'failed', received: 0, total: 0, startedAt: Date.now() };
            records.set(record.id, record); persist(record); emit(record, true, true);
            console.warn('[DragonBrowser] 无法保存下载文件：', error.message || error);
        }
    }
    session.on('will-download', onDownload);
    const dispose = () => { disposed = true; session.removeListener('will-download', onDownload); };
    dispose.ready = ready;
    dispose.list = () => [...records.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200);
    dispose.action = (id, action) => {
        const record = records.get(id), item = live.get(id);
        if (!record) return;
        if (action === 'pause' && item) item.pause();
        else if (action === 'resume' && item && item.canResume()) item.resume();
        else if (action === 'cancel' && item) item.cancel();
        else if (action === 'open' && record.state === 'completed' && fs.existsSync(record.path)) openFile(record.path);
        else if (action === 'show' && fs.existsSync(record.path)) showFile(record.path);
        if (item && action !== 'cancel') { record.state = item.isPaused() ? 'paused' : 'progressing'; emit(record); }
    };
    return dispose;
}

module.exports = { configureDownloads, downloadFilename };
