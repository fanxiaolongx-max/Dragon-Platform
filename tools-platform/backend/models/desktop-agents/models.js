// Catalogs come from the installed clients, not the platform's API model list.
const fs = require('node:fs/promises'), path = require('node:path');
const { home, safe } = require('./catalog');
const providers = ['codex', 'claudecode', 'antigravity', 'workbuddy'];
const memo = new Map();
const error = message => Object.assign(new Error(message), { status: 400, code: 'DESKTOP_MODEL_INVALID' });
function clean(items) {
    const seen = new Set();
    return (items || []).filter(m => m && typeof m.id === 'string' && m.id.length > 0 && m.id.length <= 160 && !/[\r\n\0]/.test(m.id) && !seen.has(m.id) && seen.add(m.id))
        .map(m => ({ id: m.id, name: safe(m.name || m.id, 180) }));
}
async function codexModels() {
    const file = path.join(process.env.CODEX_HOME || path.join(home(), '.codex'), 'models_cache.json');
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return clean(data.models?.filter(m => m.visibility === 'list' && !m.disabled).map(m => ({ id: m.slug, name: m.display_name })));
}
function workbuddyModels(data) {
    const allowed = data.agents?.find(a => a.name === 'cli')?.models || [];
    return clean(allowed.map(id => data.models?.find(m => m.id === id)).filter(m => m && !m.disabled && !m.hidden));
}
async function readWorkbuddy() {
    const dir = path.join(process.env.WORKBUDDY_CONFIG_DIR || path.join(home(), '.workbuddy'), 'cache');
    const files = await Promise.all((await fs.readdir(dir)).filter(f => /^acc-product-config-v3-.*\.json$/.test(f)).map(async name => ({ name, time: (await fs.stat(path.join(dir,name))).mtimeMs })));
    for (const {name} of files.sort((a,b)=>b.time-a.time)) {
        try { const models = workbuddyModels(JSON.parse(await fs.readFile(path.join(dir,name),'utf8'))); if(models.length)return models; } catch { /* Try an older complete native cache. */ }
    }
    throw error('未读取到 WorkBuddy 可用模型，请先打开 WorkBuddy');
}
// Claude / Antigravity 的模型只能靠打开原生模型菜单读取，会把客户端切到前台。
// 这类列表读过一次就落库，之后只在用户主动刷新或从未读过时才去操作界面。
const uiProviders = ['claudecode', 'antigravity'];
const stored = {
    read: async provider => { try { return clean(await require('./repository').catalog(provider)); } catch { return []; } },
    save: async (provider, items) => { try { await require('./repository').saveCatalog(provider, items); } catch { /* 缓存失败不影响本次读取 */ } }
};
async function list(provider, { force = false, validation = false, cached = false, day = new Date().toISOString().slice(0,10) } = {}) {
    if (!providers.includes(provider)) throw error('未知桌面 Agent');
    if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw error('模型缓存日期无效');
    let old = memo.get(provider);
    if (!old && uiProviders.includes(provider)) {
        const saved = await stored.read(provider);
        if (saved.length) { old = { day, items: saved }; memo.set(provider, old); }
    }
    if (uiProviders.includes(provider) && !force && (old || cached)) return old?.items || [];
    // Sending/queueing/group validation must never open a native menu in the
    // middle of another desktop operation. The explicit catalog endpoint owns
    // that UI work and its provider lock; sends still verify the native choice.
    if (validation) {
        if (old) return old.items;
        if(['claudecode','antigravity'].includes(provider))throw error('请先读取该连接器的模型列表，再发送所选模型');
    }
    if (!force && old?.day===day) return old.items;
    const items = clean(await (provider === 'codex' ? codexModels() : provider === 'workbuddy' ? readWorkbuddy() : require(provider === 'claudecode' ? './claude-desktop' : './antigravity-cdp').models()));
    if (!items.length) throw error('未读取到原生客户端可切换的模型，请打开客户端后重试');
    memo.set(provider,{day,items});
    if (uiProviders.includes(provider)) await stored.save(provider, items);
    return items;
}
async function validate(provider, model) {
    if (model === undefined || model === '') return '';
    if (typeof model !== 'string' || model.length > 160 || !(await module.exports.list(provider,{validation:true})).some(m => m.id === model)) throw error('模型不属于该连接器或当前不可用，请选择其他模型或使用默认');
    return model;
}
async function validateMap(input, selected) {
    if (input === undefined) return {};
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(p => !selected.includes(p))) throw error('模型选择必须按连接器指定，每家最多一个');
    const out = {};
    for (const [p,m] of Object.entries(input)) out[p] = await validate(p,m);
    return out;
}
module.exports = { list, validate, validateMap, workbuddyModels, clean, stored, memo };
