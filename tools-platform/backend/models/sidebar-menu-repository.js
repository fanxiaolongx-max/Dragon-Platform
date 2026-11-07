const { readKV, writeKV } = require('./kv-store');

const PRIMARY = ['channels', 'skillHub', 'schedule', 'library', 'opsDrafts'];
const MORE = ['links', 'requirements', 'promotions'];
const IDS = [...PRIMARY, ...MORE];
const defaults = () => ({ primary: [...PRIMARY], more: [...MORE] });

// Keep saved layouts usable when a future release adds or removes an entry.
function normalize(value) {
    if (!value || !Array.isArray(value.primary) || !Array.isArray(value.more)) return defaults();
    const seen = new Set();
    const clean = list => list.filter(id => IDS.includes(id) && !seen.has(id) && seen.add(id));
    const primary = clean(value.primary), more = clean(value.more);
    more.push(...IDS.filter(id => !seen.has(id)));
    return { primary, more };
}
async function getLayout(owner) {
    return normalize(await readKV('sidebar_menu', owner, null));
}
async function saveLayout(owner, input) {
    const valid = input && Array.isArray(input.primary) && Array.isArray(input.more)
        && Object.keys(input).every(key => ['primary', 'more'].includes(key));
    const ids = valid ? [...input.primary, ...input.more] : [];
    if (!owner || !valid || ids.length !== IDS.length || new Set(ids).size !== IDS.length || ids.some(id => !IDS.includes(id))) {
        throw Object.assign(new Error('菜单配置无效'), { status: 400, code: 'INVALID_SIDEBAR_MENU' });
    }
    const layout = { primary: [...input.primary], more: [...input.more] };
    await writeKV('sidebar_menu', owner, layout);
    return layout;
}
module.exports = { defaults, getLayout, saveLayout };
