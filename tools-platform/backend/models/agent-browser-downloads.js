// Chrome writes files under their CDP GUID. Suggested filenames are display metadata only.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_FILES = 10;
const MAX_BYTES = 50 * 1024 * 1024;
const GUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function createDownloads() {
    const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'dragon-browser-downloads-'));
    const items = new Map();
    const filePath = id => path.join(directory, id);
    const remove = id => { try { fs.unlinkSync(filePath(id)); } catch {} };
    let disposed = false;
    return {
        directory,
        list: () => [...items.values()].reverse(),
        event(method, params, cancel) {
            const id = params?.guid;
            if (disposed || !GUID.test(id)) return;
            if (method === 'Browser.downloadWillBegin') {
                if (items.size >= MAX_FILES) {
                    const oldest = [...items.values()].find(item => item.state !== 'progressing');
                    if (!oldest) { cancel(id); return; }
                    remove(oldest.id);
                    items.delete(oldest.id);
                }
                const name = path.win32.basename(params.suggestedFilename || '').replace(/[\x00-\x1f\x7f]/g, '_');
                items.set(id, { id, name: name || 'download', state: 'progressing', received: 0 });
                return;
            }
            const item = items.get(id);
            if (!item || item.state !== 'progressing') {
                if (item?.state !== 'completed' && params.state === 'completed') remove(id);
                return;
            }
            item.received = params.receivedBytes || 0;
            if (item.received > MAX_BYTES || params.totalBytes > MAX_BYTES) {
                item.state = 'too-large';
                if (params.state === 'inProgress') cancel(id);
                remove(id);
            } else if (params.state === 'completed') {
                let file;
                try { file = fs.lstatSync(filePath(id)); } catch {}
                item.state = file?.isFile() && file.size <= MAX_BYTES ? 'completed' : 'failed';
                if (item.state !== 'completed') remove(id);
            } else if (params.state === 'canceled') {
                item.state = 'cancelled';
                remove(id);
            }
        },
        async open(id) {
            const item = items.get(id);
            if (item?.state !== 'completed') return null;
            const handle = await fs.promises.open(filePath(id), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)).catch(() => null);
            if (!handle) return null;
            const file = await handle.stat().catch(() => null);
            if (file?.isFile() && file.size <= MAX_BYTES) return { name: item.name, size: file.size, handle };
            await handle.close();
            return null;
        },
        dispose() {
            disposed = true;
            items.clear();
            try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
        }
    };
}

module.exports = { createDownloads };
