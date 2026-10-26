const repo = require('./repository'), catalog = require('./catalog'), codex = require('./codex-ipc'), ag = require('./antigravity-cdp'), claude = require('./claude-desktop');
const { getTenantId } = require('../tenant-context');
const { containsSensitiveText, redactText } = require('../ai-sensitive-data');
const providers = ['codex', 'claudecode', 'antigravity'];
const cache = new Map(), locks = new Set();
function key(owner) { return getTenantId() + ':' + owner; }
async function discover(owner, force = false) {
    const cfg = await repo.access(owner), previous = cache.get(key(owner));
    if (!force && previous && Date.now() - previous.at < Math.min(cfg.syncSeconds * 1000, 15000))
        return previous;
    const rows = [], states = [];
    await Promise.all(providers.map(async (provider) => {
        if (!cfg.providers[provider]) {
            states.push({ id: provider, enabled: false, connected: false, canRead: false, canSend: false });
            return;
        }
        try {
            const items = await (provider === 'codex' ? catalog.codex(cfg.recentLimit) : provider === 'claudecode' ? catalog.claude(cfg.recentLimit) : ag.list(cfg.recentLimit));
            rows.push(...items);
            let canSend = false, reason = '';
            if (provider === 'codex') {
                let ipc;
                try {
                    ipc = new codex.DesktopIPC(undefined, 1500);
                    await ipc.initialize();
                    canSend = true;
                }
                catch { }
                finally {
                    ipc?.close();
                }
                reason = canSend ? '原生桌面会话连接' : 'Codex 桌面未运行，可查看已保存记录';
            }
            if (provider === 'claudecode') {
                const state = await claude.status();
                canSend = state.canSend;
                reason = state.reason;
            }
            if (provider === 'antigravity') {
                canSend = true;
                reason = '原生桌面页面连接；打开记录会同步切换桌面会话';
            }
            states.push({ id: provider, enabled: true, connected: provider === 'antigravity' || canSend || provider === 'claudecode' && items.length > 0, canRead: items.length > 0, canSend: cfg.allowSend && canSend, count: items.length, reason });
        }
        catch {
            states.push({ id: provider, enabled: true, connected: false, canRead: false, canSend: false, count: 0, reason: '本机桌面连接不可用，请打开对应客户端后刷新' });
        }
    }));
    const value = { at: Date.now(), rows, providers: providers.map(id => states.find(s => s.id === id)), settings: cfg };
    cache.set(key(owner), value);
    return value;
}
function publicSession(row) { return { id: row.id, provider: row.provider, title: row.title, updatedAt: row.updatedAt, observedAt: row.observedAt, source: row.source }; }
async function list(owner, { provider, q = '', force = false } = {}) { const state = await discover(owner, force); return { items: state.rows.filter(r => (!provider || r.provider === provider) && r.title.toLowerCase().includes(String(q).slice(0, 200).toLowerCase())).map(publicSession), providers: state.providers, syncedAt: new Date(state.at).toISOString() }; }
async function selected(owner, provider, id) { if (!providers.includes(provider) || typeof id !== 'string' || !/^(?:local_)?[a-f0-9-]{36}$/i.test(id))
    throw repo.error('会话标识无效', 400); const state = await discover(owner); let row = state.rows.find(s => s.provider === provider && s.id === id); if (!row) {
    const current = await discover(owner, true);
    row = current.rows.find(s => s.provider === provider && s.id === id);
} if (!row)
    throw repo.error('会话已移除或不属于当前桌面连接', 404); return { state, row }; }
async function messages(owner, provider, id) { const { state, row } = await selected(owner, provider, id); const content = provider === 'antigravity' ? await ag.messages(id) : await catalog.transcript(row); return { ...content, session: publicSession(row), canSend: state.providers.find(p => p.id === provider)?.canSend || false }; }
async function send(owner, provider, id, { text, requestId }) {
    if (typeof text !== 'string' || !text.trim() || text.length > 20000 || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId))
        throw repo.error('消息或请求编号无效', 400);
    if (containsSensitiveText(text))
        throw repo.error('消息包含凭据，请移除密码或 Token 后再发送', 400);
    const { state, row } = await selected(owner, provider, id);
    if (!state.providers.find(p => p.id === provider)?.canSend)
        throw repo.error('当前连接仅支持查看，请到全局设置检查桌面发送能力', 409);
    const claimed = await repo.claim(owner, requestId, provider, id);
    if (!claimed.claimed) {
        if (claimed.item.provider !== provider || claimed.item.sessionId !== id)
            throw repo.error('请求编号已用于另一个会话', 409);
        return claimed.item;
    }
    const lock = provider; // One desktop window cannot receive concurrent automation across tenants.
    if (locks.has(lock)) {
        await repo.settle(owner, requestId, 'rejected', '本机正在处理另一条桌面消息');
        throw repo.error('本机正在处理另一条桌面消息，请稍后重试', 409);
    }
    locks.add(lock);
    try {
        const before = provider !== 'antigravity' ? (await catalog.transcript(row)).items : [];
        const started = Date.now();
        if (provider === 'codex')
            await codex.send(id, text, requestId);
        if (provider === 'antigravity')
            await ag.send(id, text);
        if (provider === 'claudecode') {
            await claude.send(row, text);
        }
        if (provider !== 'antigravity') {
            let acknowledged = false;
            for (let n = 0; n < 40; n++) {
                const after = (await catalog.transcript(row)).items;
                if (after.some(m => m.role === 'user' && m.content === text && Date.parse(m.createdAt) >= started - 1000 && !before.some(old => old.createdAt === m.createdAt && old.content === m.content))) {
                    acknowledged = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
            }
            if (!acknowledged)
                throw Object.assign(new Error('已提交到桌面但尚未确认，请先核对原会话，避免重复发送'), { code: 'DELIVERY_UNKNOWN' });
        }
        return repo.settle(owner, requestId, 'accepted');
    }
    catch (error) {
        const uncertain = ['DELIVERY_UNKNOWN', 'DESKTOP_TIMEOUT'].includes(error.code), message = redactText(error.message || '桌面发送失败').slice(0, 300);
        await repo.settle(owner, requestId, uncertain ? 'unknown' : 'rejected', message);
        throw Object.assign(new Error(message), { status: uncertain ? 504 : 409, code: error.code, requestId });
    }
    finally {
        locks.delete(lock);
    }
}
async function save(owner, patch) { const cfg = await repo.save(owner, patch); cache.delete(key(owner)); return cfg; }
module.exports = { list, messages, send, save, discover, publicSession };
