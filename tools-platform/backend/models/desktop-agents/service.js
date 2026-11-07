const repo = require('./repository'), catalog = require('./catalog'), codex = require('./codex-ipc'), ag = require('./antigravity-cdp'), claude = require('./claude-desktop'), wb = require('./workbuddy');
const {composerText}=require('./composer-text');
const { getTenantId, runWithTenant } = require('../tenant-context');
const { containsSensitiveText, redactText, redactValue } = require('../ai-sensitive-data');
const providers = ['codex', 'claudecode', 'antigravity', 'workbuddy'];
// WorkBuddy 的记录格式与 Codex / Claude 不同，由自己的模块解析
const readTranscript = row => row.provider === 'workbuddy' ? wb.transcript(row) : catalog.transcript(row);
const cache = new Map(), locks = new Set(), scanning = new Map(), invalidatedAt = new Map();
function key(owner) { return getTenantId() + ':' + owner; }
function invalidate(owner) { cache.delete(key(owner)); invalidatedAt.set(key(owner), Date.now()); }
// allowStale：列表读取在缓存过期时先返回上一份结果，后台重新扫描（扫描含桌面 IPC 探测，冷启动可达数百毫秒，
// 会拖慢首页首屏）；发送等需要准确连接状态的调用仍同步扫描。同一账号同时只跑一次非强制扫描。
async function discover(owner, force = false, { allowStale = false } = {}) {
    const cfg = await repo.access(owner), previous = cache.get(key(owner));
    if (!force && previous && Date.now() - previous.at < Math.min(cfg.syncSeconds * 1000, 15000))
        return previous;
    if (force) return scan(owner, cfg);
    const k = key(owner);
    let pending = scanning.get(k);
    if (!pending) {
        pending = scan(owner, cfg).finally(() => { if (scanning.get(k) === pending) scanning.delete(k); });
        scanning.set(k, pending);
    }
    if (allowStale && previous) {
        pending.catch(() => {});
        return previous;
    }
    return pending;
}
async function scan(owner, cfg) {
    const startedAt = Date.now();
    const rows = [], states = [];
    await Promise.all(providers.map(async (provider) => {
        if (!cfg.providers[provider]) {
            states.push({ id: provider, enabled: false, connected: false, canRead: false, canSend: false });
            return;
        }
        try {
            const checkedAt = Date.now();
            const items = await (provider === 'codex' ? catalog.codex(cfg.recentLimit) : provider === 'claudecode' ? catalog.claude(cfg.recentLimit) : provider === 'workbuddy' ? wb.list(cfg.recentLimit) : ag.list(cfg.recentLimit));
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
                const state = await claude.status(cfg);
                canSend = state.canSend;
                reason = state.reason;
            }
            let connected = provider === 'antigravity' || canSend || provider === 'claudecode' && items.length > 0;
            if (provider === 'workbuddy') {
                ({ canSend, reason, connected } = await wb.status(items));
            }
            if (provider === 'antigravity') {
                const fromSidebar = items.some(i => i.source === 'desktop-sidebar');
                canSend = fromSidebar || (typeof ag.canConnect === 'function' ? await ag.canConnect() : true);
                connected = canSend || items.length > 0;
                reason = canSend
                    ? (fromSidebar ? '原生桌面页面连接；打开记录会同步切换桌面会话' : '本地记录直读 · 原生桌面会话连接')
                    : (items.length > 0 ? 'Antigravity 桌面未运行，可查看已保存记录' : '本机桌面连接不可用，请打开对应客户端后刷新');
            }
            states.push({ id: provider, enabled: true, connected, canRead: items.length > 0, canSend: cfg.allowSend && canSend, count: items.length, latencyMs: Date.now() - checkedAt, reason });
        }
        catch {
            states.push({ id: provider, enabled: true, connected: false, canRead: false, canSend: false, count: 0, reason: '本机桌面连接不可用，请打开对应客户端后刷新' });
        }
    }));
    const value = { at: Date.now(), rows, providers: providers.map(id => states.find(s => s.id === id)), settings: cfg };
    // 扫描期间设置被修改或刚发送过消息：结果照常返回给本次调用，但不写回缓存，避免旧配置覆盖
    if ((invalidatedAt.get(key(owner)) || 0) < startedAt) cache.set(key(owner), value);
    return value;
}
function publicSession(row) { return { id: row.id, provider: row.provider, title: row.title, updatedAt: row.updatedAt, observedAt: row.observedAt, source: row.source }; }
// 侧栏「运行中」转圈：最近 6 小时有活动的 Codex / Claude Code 会话（最多 12 个）读一次记录尾部判断是否还在这一轮里
const BUSY_WINDOW_MS = 6 * 60 * 60 * 1000, BUSY_MAX = 12;
async function list(owner, { provider, q = '', force = false } = {}) {
    const state = await discover(owner, force, { allowStale: true });
    const items = state.rows.filter(r => (!provider || r.provider === provider) && r.title.toLowerCase().includes(String(q).slice(0, 200).toLowerCase())).map(publicSession);
    const recent = state.rows.filter(r => ['codex', 'claudecode', 'workbuddy'].includes(r.provider) && Date.now() - Date.parse(r.updatedAt) < BUSY_WINDOW_MS)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, BUSY_MAX);
    const busy = new Set((await Promise.all(recent.map(async r => (r.provider === 'workbuddy' ? (await wb.transcript(r).catch(() => ({}))).busy : await catalog.busyState(r)) && `${r.provider}:${r.id}`))).filter(Boolean));
    if (state.rows.some(r => r.provider === 'antigravity'))
        for (const id of await ag.busyIds()) busy.add(`antigravity:${id}`);
    items.forEach(item => { item.busy = busy.has(`${item.provider}:${item.id}`); });
    // 客户端标题通常是第一句话：显示模型精简的短标题（缓存），完整原标题放 fullTitle
    const titled = await require('../ai-title-generator').agentTitles(items).catch(() => items);
    return { items: titled, providers: state.providers, syncedAt: new Date(state.at).toISOString() };
}
async function selected(owner, provider, id) { if (!providers.includes(provider) || typeof id !== 'string' || !/^(?:local_)?[a-f0-9-]{36}$/i.test(id))
    throw repo.error('会话标识无效', 400); const state = await discover(owner); let row = state.rows.find(s => s.provider === provider && s.id === id); if (!row) {
    const current = await discover(owner, true);
    row = current.rows.find(s => s.provider === provider && s.id === id);
} if (!row)
    throw repo.error('会话已移除或不属于当前桌面连接', 404); return { state, row }; }
async function messages(owner, provider, id, { passive = false } = {}) { const { state, row } = await selected(owner, provider, id), queue = queued(owner, provider, id); let content = provider === 'antigravity' ? await ag.messages(id, { passive }) : await readTranscript(row); if (Array.isArray(content.items)) { content = await require('./telemetry').enrich(owner,provider,row.nativeId||id,content); if(provider==='codex'){const timing=require('./codex-timing');content=timing.enrich(content,await timing.read(id));} } const status = state.providers.find(p => p.id === provider); return { ...content,...(Array.isArray(content.items)?{performance:require('./performance').aggregate(content.items,content.performanceTurns,content.modelUsage)}:{}), session: publicSession(row), canSend: status?.canSend || false, canSteer: provider === 'codex' && Boolean(status?.canSend), reason: content.reason || status?.reason || '', queue }; }
async function exportConversation(owner, provider, id) {
    const data = await messages(owner, provider, id, { passive: true });
    if (data.available === false || !Array.isArray(data.items)) throw repo.error(data.reason || '当前桌面会话暂不可读取，请刷新后重试', 409);
    return redactValue({
        format: 'dragon-claw-desktop-agent-log', formatVersion: 1,
        exportedAt: new Date().toISOString(), provider, session: data.session,
        available: data.available, busy: Boolean(data.busy), messages: data.items.slice(-200)
    }, { secrets: await require('../ai-settings-repository').getRedactionSecrets() });
}

// 空消息、超长、请求编号错误分别说明，避免长消息被误报成“编号无效”。
const MAX_MESSAGE = 20000;
function checkMessage(text, requestId) {
    if (typeof text !== 'string' || !text.trim())
        throw repo.error('消息为空', 400);
    if (text.length > MAX_MESSAGE)
        throw repo.error(`消息过长（${text.length} 字，上限 ${MAX_MESSAGE} 字），请精简，或把长内容存成文件作为附件发送`, 400);
    if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId))
        throw repo.error('请求编号无效，请刷新页面后重试', 400);
}
async function send(owner, provider, id, { text, requestId, mode = 'send' }) {
    checkMessage(text, requestId);
    if (!['send', 'steer'].includes(mode) || mode === 'steer' && provider !== 'codex')
        throw repo.error('这个桌面 Agent 不支持运行中引导，请改用排队', 400);
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
        const before = provider !== 'antigravity' ? (await readTranscript(row)).items : [];
        const started = Date.now();
        if (provider === 'codex')
            await (mode === 'steer' ? codex.steer(id, text, requestId, row.cwd) : codex.send(id, text, requestId));
        if (provider === 'antigravity')
            await ag.send(id, text);
        if (provider === 'claudecode') {
            // 模拟操作只能按标题认会话：同名会话无法区分时不发送
            if (state.rows.filter(r => r.provider === 'claudecode' && r.title === row.title).length > 1)
                throw Object.assign(new Error('Claude 有同名会话，无法确认发送目标；请先在桌面重命名'), { code: 'DESKTOP_TARGET_UNCONFIRMED' });
            await claude.send(row, text);
        }
        if (provider === 'workbuddy')
            await wb.send(row, text);
        if (provider !== 'antigravity') {
            let acknowledged = false;
            for (let n = 0; n < 40; n++) {
                const after = (await readTranscript(row)).items;
                if (after.some(m => m.role === 'user' && composerText(m.content) === composerText(text) && Date.parse(m.createdAt) >= started - 1000 && !before.some(old => old.createdAt === m.createdAt && old.content === m.content))) {
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
// 网页「新对话」：在选中的桌面 Agent 里新建原生会话并发出第一条消息；以新会话的回执为准，不重试、不落到旧会话。
async function create(owner, provider, { text, requestId }, { createAndSend = require('./new-conversation').createAndSend } = {}) {
    if (!providers.includes(provider))
        throw repo.error('未知桌面 Agent', 400);
    checkMessage(text, requestId);
    if (containsSensitiveText(text))
        throw repo.error('消息包含凭据，请移除密码或 Token 后再发送', 400);
    const state = await discover(owner);
    if (!state.providers.find(p => p.id === provider)?.canSend)
        throw repo.error('当前连接仅支持查看，无法新建桌面会话', 409);
    const claimed = await repo.claim(owner, requestId, provider, 'new');
    if (!claimed.claimed)
        return claimed.item;
    if (locks.has(provider)) {
        await repo.settle(owner, requestId, 'rejected', '本机正在处理另一条桌面消息');
        throw repo.error('本机正在处理另一条桌面消息，请稍后重试', 409);
    }
    locks.add(provider);
    try {
        const result = await createAndSend(provider, text.trim());
        invalidate(owner);
        return { ...await repo.settle(owner, requestId, 'accepted'), id: result.id };
    }
    catch (error) {
        const uncertain = error.code === 'DELIVERY_UNKNOWN', message = redactText(error.message || '桌面新建失败').slice(0, 300);
        await repo.settle(owner, requestId, uncertain ? 'unknown' : 'rejected', message);
        throw Object.assign(new Error(message), { status: uncertain ? 504 : 409, code: error.code, requestId });
    }
    finally {
        locks.delete(provider);
    }
}
async function save(owner, patch) { const cfg = await repo.save(owner, patch); invalidate(owner); return cfg; }
async function waitForReply(owner,provider,id,prompt,{signal,timeoutMs=180000,read=messages,runtime=codex.read,pollDelay=1500}={}) {
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
        signal?.throwIfAborted();
        const data=await read(owner,provider,id);
        const index=data.items.findLastIndex(m=>m.role==='user'&&composerText(m.content)===composerText(prompt));
        if(index>=0){
            const tail=data.items.slice(index+1);
            if(tail.some(m=>m.role==='user'))throw repo.error('桌面原会话收到另一条用户消息，本次回复无法可靠关联，请在原会话核对',409);
            const answer=tail.filter(m=>m.role==='assistant'&&m.channel!=='commentary').at(-1);
            if(answer){
                const busy=provider==='codex'?(await runtime(id)).threadRuntimeStatus?.type!=='idle':data.busy;
                if(busy===false)return answer.content;
            }
        }
        await require('node:timers/promises').setTimeout(pollDelay,undefined,{signal});
    }
    throw Object.assign(new Error('等待桌面回复超时，请核对原会话；不会自动重发'),{status:504,code:'DELIVERY_UNKNOWN'});
}
// 排队：Agent 正在运行时先存在服务端，本轮结束后按顺序逐条发送；页面关闭也会继续，服务重启后丢弃。
// 投递失败或结果不确定时停在该条并显示原因，不自动重发。
const queues = new Map();
function queueKey(owner, provider, id) { return [getTenantId(), owner, provider, id].join(':'); }
function queued(owner, provider, id) { return (queues.get(queueKey(owner, provider, id))?.items || []).map(({ requestId, text, status, error, createdAt }) => ({ requestId, text, status, error, createdAt })); }
async function enqueue(owner, provider, id, { text, requestId }) {
    checkMessage(text, requestId);
    if (containsSensitiveText(text))
        throw repo.error('消息包含凭据，请移除密码或 Token 后再发送', 400);
    const { state } = await selected(owner, provider, id);
    if (!state.providers.find(p => p.id === provider)?.canSend)
        throw repo.error('当前连接仅支持查看，请到全局设置检查桌面发送能力', 409);
    const k = queueKey(owner, provider, id), entry = queues.get(k) || { tenant: getTenantId(), owner, provider, id, items: [], timer: null, sent: 0, sawBusy: false };
    if (entry.items.some(item => item.requestId === requestId))
        return { status: 'queued', requestId, queue: queued(owner, provider, id) };
    if (entry.items.length >= 20)
        throw repo.error('排队消息过多，请等待当前回复结束', 409);
    entry.items.push({ requestId, text, status: 'queued', error: '', createdAt: new Date().toISOString() });
    queues.set(k, entry);
    if (!entry.timer)
        entry.timer = setInterval(() => runWithTenant(entry.tenant, () => drain(k)).catch(() => { }), 2000);
    return { status: 'queued', requestId, queue: queued(owner, provider, id) };
}
function cancelQueued(owner, provider, id, requestId) {
    const k = queueKey(owner, provider, id), entry = queues.get(k);
    const item = entry?.items.find(i => i.requestId === requestId);
    if (!item)
        throw repo.error('排队消息已发送或不存在', 404);
    if (item.status === 'sending')
        throw repo.error('这条消息正在投递，无法取消', 409);
    entry.items.splice(entry.items.indexOf(item), 1);
    if (!entry.items.length) {
        clearInterval(entry.timer);
        queues.delete(k);
    }
    return { queue: queued(owner, provider, id) };
}
async function drain(k, { read = (row) => row.provider === 'antigravity' ? ag.messages(row.id, { passive: true }) : readTranscript(row) } = {}) {
    const entry = queues.get(k), next = entry?.items[0];
    if (!next || next.status !== 'queued' || entry.draining || locks.has(entry.provider))
        return;
    entry.draining = true;
    try {
        const { row } = await selected(entry.owner, entry.provider, entry.id);
        const busy = Boolean((await read(row)).busy);
        // 刚发出的上一条可能还没在日志里开始：先等它出现“运行中”，最多 20 秒
        if (busy) {
            entry.sawBusy = true;
            return;
        }
        if (entry.sent && !entry.sawBusy && Date.now() - entry.sent < 20000)
            return;
        next.status = 'sending';
        try {
            await send(entry.owner, entry.provider, entry.id, { text: next.text, requestId: next.requestId });
            entry.items.shift();
            entry.sent = Date.now();
            entry.sawBusy = false;
        }
        catch (error) {
            next.status = 'failed';
            next.error = error.message;
        }
    }
    finally {
        entry.draining = false;
        if (!entry.items.length) {
            clearInterval(entry.timer);
            queues.delete(k);
        }
    }
}
module.exports = { list, messages, exportConversation, send, create, save, discover, publicSession, waitForReply, enqueue, cancelQueued, queued, drain, queueKey };
