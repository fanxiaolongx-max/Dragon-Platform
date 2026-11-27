// 共享对话实时围观：某个成员在自己的本地副本里提问时，把这一轮的流式回答实时广播给同一共享的其他成员。
// - 回复都在 chat-live-runs 里后台跑；拿到会话号时（lifecycle 'session'）查这个本地对话是否在进行中的共享里，
//   是的话挂上 run.emitter，把正文增量与过程事件（思考、工具、状态）转发到共享频道。
// - 围观端 GET /api/shared-conversations/session/:sessionId/live：先补发进行中的一轮（catchup），再实时推送。
// - 只转发展示需要的字段（不带工具参数 / 结果、文件路径），最终内容仍以推送 / 拉取落库的消息为准。
// - 这一轮结束时先立即推送提问者的新消息，再通知围观端结束，围观端随即拉取，用落库消息替换实时气泡。
// - 只在本进程内存里：提问者与围观者需连到同一实例（当前单实例部署）；多实例时退化为轮询拉取。
// - 内网桌面版互联（lan-share）：别的电脑上成员的一轮经主共享者转发过来，用 ingestRemote 注入本机频道，
//   同样支持中途打开时的 catchup；by 形如 lan:<节点>:<账号>，不会与本机账号混淆。
const { EventEmitter } = require('events');
const chatLiveRuns = require('./chat-live-runs');
const shared = require('./shared-conversations');
const tenantContext = require('./tenant-context');

const FORWARD_TYPES = new Set(['delta', 'thinking', 'status', 'tool_start', 'tool_result', 'compaction', 'error']);
const FORWARD_FIELDS = ['type', 'delta', 'status', 'callId', 'tool', 'ok', 'phase', 'summarized', 'beforeTokens', 'afterTokens', 'error'];
const MAX_FIELD = 4000;
const MAX_CATCHUP_EVENTS = 200;

const hub = new EventEmitter();
hub.setMaxListeners(0);
const active = new Map(); // shareId → Map(runId → entry)
const remote = new Map(); // shareId → Map(by → { remote: true, by, name, question, startedAt, text, events, touchedAt })
const REMOTE_IDLE_MS = 3 * 60 * 1000;

const channel = shareId => `share:${shareId}`;

function compact(event) {
    const out = {};
    for (const key of FORWARD_FIELDS) {
        const value = event[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') out[key] = value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
        else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    }
    return out;
}

function textOf(run) {
    const done = run.events.findLast?.(event => event.type === 'done');
    if (done && typeof done.reply === 'string') return done.reply;
    return run.events.filter(event => event.type === 'delta' && typeof event.delta === 'string').map(event => event.delta).join('');
}

function eventsOf(run) {
    return run.events.filter(event => FORWARD_TYPES.has(event.type) && event.type !== 'delta').slice(-MAX_CATCHUP_EVENTS).map(compact);
}

function errorOf(run) {
    const last = [...run.events].reverse().find(event => event.type === 'error');
    return last?.error || (run.jsonResult && run.jsonResult.status >= 400 ? run.jsonResult.body?.error || '' : '');
}

function snapshot(entry, type = 'catchup') {
    return {
        type,
        by: entry.by,
        name: entry.name,
        question: entry.question,
        startedAt: entry.startedAt,
        text: entry.remote ? entry.text : textOf(entry.run),
        events: entry.remote ? entry.events.slice(-MAX_CATCHUP_EVENTS) : eventsOf(entry.run)
    };
}

function remoteEntries(shareId) {
    const map = remote.get(String(shareId || ''));
    if (!map) return [];
    const now = Date.now();
    for (const [by, entry] of map) if (now - entry.touchedAt > REMOTE_IDLE_MS) map.delete(by); // 远端断线没收到结束：过期丢弃
    if (!map.size) remote.delete(String(shareId || ''));
    return [...map.values()];
}

/** 进行中最早开始的一轮（排除自己发起的：自己的回复由本人页面直接接上） */
function current(shareId, viewer = '') {
    const runs = active.get(String(shareId || ''));
    let found = null;
    for (const entry of [...(runs ? runs.values() : []), ...remoteEntries(shareId)]) {
        if (viewer && entry.by === viewer) continue;
        if (!found || entry.startedAt < found.startedAt) found = entry;
    }
    return found;
}

/** /sync 的兜底信息：有人在提问就返回 { by, name, question } */
function activeTurn(shareId, viewer = '') {
    const entry = current(shareId, viewer);
    return entry ? { by: entry.by, name: entry.name, question: entry.question } : null;
}

async function track(run) {
    if (!run?.sessionId || !run.owner || run.sharedLive) return;
    run.sharedLive = true;
    const target = await tenantContext.runWithTenant(run.tenant, () => shared.liveShareForLocal({ tenantId: run.tenant, username: run.owner, sessionId: run.sessionId })).catch(() => null);
    if (!target) return;
    const shareId = target.shareId;
    const entry = {
        shareId, run, by: run.owner, name: target.name, question: String(run.question || '').split('📎 附件：')[0].trim().slice(0, 2000),
        startedAt: run.startedAt || Date.now()
    };
    if (!active.has(shareId)) active.set(shareId, new Map());
    active.get(shareId).set(run.id, entry);
    // 带上已生成的部分：查共享关系期间可能已经输出了几段
    hub.emit(channel(shareId), snapshot(entry, 'stream_start'));

    const onEvent = event => {
        if (!event || !FORWARD_TYPES.has(event.type)) return;
        hub.emit(channel(shareId), { ...compact(event), by: entry.by });
    };
    const onEnd = async () => {
        run.emitter.off('event', onEvent);
        // 先把提问者这一轮的消息推到中转表，围观端收到结束后立刻就能拉到
        await tenantContext.runWithTenant(run.tenant, () => shared.syncIfShared({ tenantId: run.tenant, username: run.owner, sessionId: run.sessionId })).catch(() => null);
        const runs = active.get(shareId);
        runs?.delete(run.id);
        if (runs && !runs.size) active.delete(shareId);
        const error = errorOf(run);
        hub.emit(channel(shareId), { type: 'stream_finish', by: entry.by, text: textOf(run), ...(error ? { error } : {}) });
        hub.emit(channel(shareId), { type: 'turn_ended', by: entry.by });
        // 同一共享里还有别人在进行的一轮：让围观端接着看那一轮
        const next = current(shareId);
        if (next) hub.emit(channel(shareId), snapshot(next, 'stream_start'));
    };
    run.emitter.on('event', onEvent);
    if (run.done) onEnd();
    else run.emitter.once('end', onEnd);
}

/** 进行中的全部轮次快照（内网主共享者给新连上的成员补发；skip 过滤掉该成员自己发起的） */
function snapshots(shareId, skip = () => false) {
    const runs = active.get(String(shareId || ''));
    return [...(runs ? runs.values() : []), ...remoteEntries(shareId)].filter(entry => !skip(entry.by)).map(entry => snapshot(entry, 'catchup'));
}

/** 远端（另一台电脑）成员这一轮的实时事件：记下进度供 catchup，并广播到本机频道 */
function ingestRemote(shareId, event) {
    const id = String(shareId || '');
    const by = String(event?.by || '');
    if (!id || !by.startsWith('lan:') || !event?.type) return;
    if (!remote.has(id)) remote.set(id, new Map());
    const map = remote.get(id);
    const out = { ...event };
    if (event.type === 'stream_start' || event.type === 'catchup') {
        map.set(by, {
            remote: true, by, name: String(event.name || by).slice(0, 120), question: String(event.question || '').slice(0, 2000),
            startedAt: Number(event.startedAt) || Date.now(), text: String(event.text || ''),
            events: Array.isArray(event.events) ? event.events.slice(-MAX_CATCHUP_EVENTS).map(compact) : [], touchedAt: Date.now()
        });
        out.type = 'stream_start';
    } else if (event.type === 'turn_ended') {
        map.delete(by);
    } else if (FORWARD_TYPES.has(event.type) || event.type === 'stream_finish') {
        const entry = map.get(by);
        if (entry) {
            entry.touchedAt = Date.now();
            if (event.type === 'delta' && typeof event.delta === 'string') entry.text += event.delta;
            else if (event.type === 'stream_finish' && typeof event.text === 'string') entry.text = event.text;
            else if (event.type !== 'delta') { entry.events.push(compact(event)); if (entry.events.length > MAX_CATCHUP_EVENTS) entry.events.shift(); }
        }
    } else if (!['idle', 'ping'].includes(event.type)) {
        return;
    }
    if (!map.size) remote.delete(id);
    if (out.type === 'idle') return;
    hub.emit(channel(id), out);
}

/** 远端连接断了：收掉 prefix（lan:<节点>）开头的所有进行中轮次，围观端随即解锁 */
function clearRemote(shareId, prefix = 'lan:') {
    const id = String(shareId || '');
    const map = remote.get(id);
    if (!map) return;
    for (const by of [...map.keys()]) {
        if (!by.startsWith(prefix)) continue;
        map.delete(by);
        hub.emit(channel(id), { type: 'turn_ended', by });
    }
    if (!map.size) remote.delete(id);
}

chatLiveRuns.lifecycle.on('session', run => { track(run).catch(error => console.warn('[shared-live] track failed:', error?.message || error)); });

// 成员被移除 / 退出 / 共享停止：断开对应的围观连接
shared.shareEvents.on('revoked', ({ shareId, username }) => hub.emit(`kick:${shareId}`, username || ''));

/** GET /session/:sessionId/live */
async function attach(req, res, { tenantId, username }) {
    const target = await shared.liveShareForLocal({ tenantId, username, sessionId: req.params.sessionId });
    if (!target) return res.status(404).json({ code: 'SHARE_NOT_FOUND', error: '这个对话没有进行中的共享' });
    const shareId = target.shareId;
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;
    let timer = null;
    const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        hub.off(channel(shareId), onEvent);
        hub.off(`kick:${shareId}`, onKick);
        if (!res.writableEnded) res.end();
    };
    const send = event => {
        if (closed || res.destroyed || res.writableEnded) return close();
        res.write(`${JSON.stringify(event)}\n`);
    };
    // 自己发起的一轮不推给自己（本人页面通过 /api/ai/sessions/:id/live 接上）
    const onEvent = event => { if (event.by !== username) send(event); };
    const onKick = target => {
        if (target && target !== username) return;
        send({ type: 'revoked' });
        close();
    };

    const entry = current(shareId, username);
    send(entry ? snapshot(entry, 'catchup') : { type: 'idle' });
    hub.on(channel(shareId), onEvent);
    hub.on(`kick:${shareId}`, onKick);
    timer = setInterval(() => send({ type: 'ping' }), 15000);
    if (typeof timer.unref === 'function') timer.unref();
    res.on('close', close);
}

module.exports = { attach, activeTurn, snapshots, ingestRemote, clearRemote, channel, hub, _active: active, _remote: remote, _hub: hub };
