// 网页顶部额度栏：复用桌面版的额度读取（desktop-pet/quota-detector，本机凭据只在服务端使用，返回值不含凭据）。
// 只给已连接本机桌面 Agent 的绑定账号读取，只返回在全局设置里启用的客户端。
const repo = require('./repository');
const detector = require('../../../desktop-pet/quota-detector');
const history = require('../pet-quota-history-repository');
const PROVIDERS = ['codex', 'claudecode', 'antigravity'];
const DEVICE = 'web-server'; // 服务端读到的额度也写进额度历史，网页趋势窗口不依赖桌面应用在运行
const FORCE_GAP_MS = 15000; // 手动刷新也最多 15 秒一次，避免频繁请求各家额度接口
let lastForce = 0;
function publicQuota(value) {
    if (!value || typeof value !== 'object') return null;
    return {
        status: value.status, membership: value.membership || null, updatedAt: value.updatedAt || null,
        creditsBalance: Number.isFinite(value.creditsBalance) && value.creditsBalance > 0 ? value.creditsBalance : null,
        groups: (Array.isArray(value.groups) ? value.groups : []).slice(0, 10).map(group => ({
            id: group.id, label: group.label,
            windows: (Array.isArray(group.windows) ? group.windows : []).slice(0, 10).map(w => ({ id: w.id, label: w.label, remainingPercent: w.remainingPercent, resetsAt: w.resetsAt, durationMinutes: w.durationMinutes }))
        })),
        extraUsage: value.extraUsage ? {
            enabled: Boolean(value.extraUsage.enabled),
            used: Number.isFinite(value.extraUsage.used) && value.extraUsage.used >= 0 ? value.extraUsage.used : null,
            limit: Number.isFinite(value.extraUsage.limit) && value.extraUsage.limit >= 0 ? value.extraUsage.limit : null,
            currency: /^[A-Z]{3}$/.test(value.extraUsage.currency) ? value.extraUsage.currency : 'USD',
            percent: Number.isFinite(value.extraUsage.percent) && value.extraUsage.percent >= 0 ? value.extraUsage.percent : null,
            remainingPercent: Number.isFinite(value.extraUsage.remainingPercent) && value.extraUsage.remainingPercent >= 0 ? value.extraUsage.remainingPercent : null
        } : null
    };
}
async function read(owner, { force = false, detect = detector.detectAllQuotas } = {}) {
    const cfg = await repo.access(owner);
    const providers = PROVIDERS.filter(id => cfg.providers[id]);
    if (force && Date.now() - lastForce < FORCE_GAP_MS) force = false;
    if (force) lastForce = Date.now();
    const all = providers.length ? await detect(force) : {};
    if (providers.length) await history.record(owner, DEVICE, Object.fromEntries(providers.map(id => [id, all[id]]))).catch(() => {});
    return { providers, quotas: Object.fromEntries(providers.map(id => [id, publicQuota(all[id])])), checkedAt: Date.now() };
}
async function trends(owner, provider, days) {
    const cfg = await repo.access(owner);
    if (!PROVIDERS.includes(provider) || !cfg.providers[provider]) throw repo.error('未启用这个客户端的额度', 400);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw repo.error('时间范围需为 1–90 天', 400);
    return history.history(owner, history.ANY_DEVICE, provider, days);
}
module.exports = { read, trends, PROVIDERS };
