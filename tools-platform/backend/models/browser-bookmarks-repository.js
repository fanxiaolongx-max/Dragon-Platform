const { readKV, writeKV } = require('./kv-store');
const { savedUrl } = require('../../desktop-promo/browser-library');
const CATEGORY = 'browser-bookmarks';
const list = async username => readKV(CATEGORY, String(username), []);
async function update(username, { url, title, remove = false }) {
    const safe = savedUrl(url);
    if (!safe) throw Object.assign(new Error('只能收藏 HTTP 或 HTTPS 网页'), { status: 400 });
    const items = (await list(username)).filter(item => item.url !== safe);
    if (!remove) items.unshift({ url: safe, title: String(title || safe).slice(0, 500) });
    await writeKV(CATEGORY, String(username), items.slice(0, 200));
    return items.slice(0, 200);
}
module.exports = { list, update };
