const { allowedEntries, personalEntries, personalEntry, setPersonalEntry } = require('./tool-distribution');
const { readKV, writeKV } = require('./kv-store');
const catalog = require('../builtin-tools/f12-to-extension/builtin-catalog');

async function visibleCatalog(user) {
    const allowed = await allowedEntries();
    const personal = await personalEntries(user);
    return Object.fromEntries(Object.entries(catalog).flatMap(([id, item]) => {
        const key = `cap:f12:builtin:${id}`;
        const prefs = personal.get(key) || {};
        return allowed.has(key) && !prefs.hidden ? [[id, { ...item, name: prefs.name || item.name, nameEn: prefs.name || item.nameEn }]] : [];
    }));
}

async function assetResponse(asset, user) {
    if (asset === 'builtin-catalog.js') return { catalog: await visibleCatalog(user) };
    if (['index.html', 'packer-core.js'].includes(asset)) return {};
    const owner = Object.entries(catalog).find(([id, item]) =>
        asset === item.file?.replace(/^\.\//, '') || asset === item.templateZip?.replace(/^\.\//, '')
        || asset.startsWith(`${id}/`) || (id === 'netcare-rfc-word' && /^netcare-/i.test(asset))
        || (id === 'exam-question-bank' && /^exam-/i.test(asset)));
    // The packager includes other assets from the same directory only when they belong
    // to a known preset. An unclassified file must not expose an unpublished preset.
    const visible = owner && (await visibleCatalog(user))[owner[0]];
    if (!visible) return { blocked: true };
    const key = `cap:f12:builtin:${owner[0]}`;
    const primaryFile = owner[1].file || owner[1].templateZip;
    if (user && asset === primaryFile?.replace(/^\.\//, '') && (await personalEntry(user, key)).fork) {
        const data = await readKV(`personal_capability_files:${user.username}`, key, null);
        if (data) return { bytes: Buffer.from(data, 'base64'), type: owner[1].templateZip ? 'application/zip' : 'application/javascript' };
    }
    return {};
}

async function filterIndex(html, user) {
    const visible = await visibleCatalog(user);
    const withoutLicense = html.replace(/<input\b[^>]*id="extLicense"[^>]*>/i, input =>
        input.replace(/\s+checked\b/i, '').replace(/>$/, ' disabled>'));
    return withoutLicense.replace(/(<select\b[^>]*id="builtinScriptSelect"[^>]*>)([\s\S]*?)(<\/select>)/i,
        (_all, open, options, close) => open + options.replace(/<option\b[^>]*value="([^"]+)"[^>]*>[\s\S]*?<\/option>/gi,
            (option, id) => {
                if (id === '__new__') return option;
                if (!Object.hasOwn(visible, id)) return '';
                const label = String(visible[id].name).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
                return option.replace(/>[^<]*<\/option>/, `>${label}</option>`);
            }) + close);
}

async function savePersonalFile(user, id, encoded) {
    const presetId = String(id).match(/^f12:builtin:([a-z0-9-]+)$/)?.[1];
    const visible = await visibleCatalog(user);
    if (!presetId || !Object.hasOwn(visible, presetId)) throw Object.assign(new Error('脚本不存在或未开放'), { status: 404 });
    if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil((8 * 1024 * 1024) / 3)) throw Object.assign(new Error('文件超过 8 MB'), { status: 400 });
    const data = Buffer.from(encoded, 'base64');
    const zip = Boolean(visible[presetId].templateZip);
    const valid = data.length > 0 && data.length <= 8 * 1024 * 1024 && data.toString('base64') === encoded
        && (zip ? data.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')) : !data.includes(0));
    if (!valid) throw Object.assign(new Error(zip ? '请选择有效的扩展 ZIP 包' : '请选择有效的 JavaScript 文件'), { status: 400 });
    const key = `cap:${id}`;
    await writeKV(`personal_capability_files:${user.username}`, key, encoded);
    await setPersonalEntry(user, key, { fork: true });
}

module.exports = { assetResponse, filterIndex, savePersonalFile };
