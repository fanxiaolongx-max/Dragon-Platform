// 桌面浏览器的浮窗脚本：数据抓取页「📋 浮窗脚本 → 🖥 桌面浏览器运行」生成的脚本按站点缓存在本机，
// 托盘菜单和大窗工具栏可以一键再次打开站点并在登录完成后自动运行。数据抓取页打开时会自动刷新缓存的脚本。
const fs = require('fs');
const path = require('path');

const MAX_SITES = 40;
const MAX_CODE_BYTES = 8 * 1024 * 1024;

function normalizeOrigin(value) {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('浮窗脚本只支持 http/https 站点');
    return url.origin;
}

function createSiteScriptStore(file) {
    let sites = read();

    function read() {
        try {
            const value = JSON.parse(fs.readFileSync(file, 'utf8'));
            return value && typeof value.sites === 'object' && value.sites ? value.sites : {};
        } catch (_) {
            return {};
        }
    }
    function write() {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const temp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(temp, JSON.stringify({ sites }), 'utf8');
            fs.renameSync(temp, file);
        } catch (error) {
            console.warn('[DesktopBrowser] 保存浮窗脚本失败：', error.message || error);
        }
    }

    return {
        put({ origin, name, url, code }) {
            const key = normalizeOrigin(origin);
            const openUrl = url ? new URL(url).toString() : key + '/';
            if (new URL(openUrl).origin !== key) throw new Error('打开地址必须属于该站点');
            if (typeof code !== 'string' || !code.trim()) throw new Error('浮窗脚本为空');
            if (Buffer.byteLength(code) > MAX_CODE_BYTES) throw new Error('浮窗脚本过大');
            sites[key] = { origin: key, name: String(name || key).slice(0, 80), url: openUrl, code, updatedAt: new Date().toISOString() };
            const keys = Object.values(sites).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(item => item.origin);
            keys.slice(MAX_SITES).forEach(old => { delete sites[old]; });
            write();
            return sites[key];
        },
        get: origin => { try { return sites[normalizeOrigin(origin)] || null; } catch (_) { return null; } },
        list: () => Object.values(sites).map(({ code, ...meta }) => meta).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
        remove(origin) { delete sites[normalizeOrigin(origin)]; write(); }
    };
}

module.exports = { createSiteScriptStore, normalizeOrigin };
