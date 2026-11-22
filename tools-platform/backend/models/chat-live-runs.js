// 首页 Dragon Claw 多对话并行：回复在服务器后台跑，不再跟着页面的 HTTP 连接走。
// - POST /api/ai/chat 带 background:true 时，handleChatRequest 写进一个虚拟响应；真实连接只是“观看者”，
//   页面切走、刷新、断网都不会中止回复，只有显式停止（stop）才中止。
// - 事件按顺序缓存（连续的正文 / 思考增量合并成一条），切回来时 GET /sessions/:id/live 先补放、再接着推。
// - 同一账号同时进行的对话有上限，避免一下子把模型额度用完。
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { getTenantId } = require('./tenant-context');

const MAX_PARALLEL = Math.max(1, Number(process.env.AI_MAX_PARALLEL_CHATS) || 3);
const FINISHED_TTL_MS = 60 * 1000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
// 增量事件：相邻同类合并，补放时一次给全
const MERGE_FIELDS = { delta: 'delta', thinking: 'delta' };

// 回复拿到会话号时发 'session'(run)：共享对话据此把这一轮实时广播给其他成员（shared-live.js）
const lifecycle = new EventEmitter();
lifecycle.setMaxListeners(20);

const runs = new Map(); // runId → run
const bySession = new Map(); // tenant:sessionId → run

const tenantKey = () => String(getTenantId() || '');
const sessionKey = (tenant, sessionId) => `${tenant}:${sessionId}`;

function activeCount(tenant, owner) {
    let count = 0;
    for (const run of runs.values()) if (!run.done && run.tenant === tenant && run.owner === owner) count++;
    return count;
}

function pushEvent(run, event) {
    const last = run.events[run.events.length - 1];
    const field = MERGE_FIELDS[event.type];
    if (field && last && last.type === event.type && typeof last[field] === 'string' && typeof event[field] === 'string' && Object.keys(event).length === 2) {
        last[field] += event[field];
    } else {
        // 命令输出量可能很大：缓存超限后只保留非命令事件（实时推送不受影响）
        if (run.bytes > MAX_BUFFER_BYTES && /^command_(output|terminal)$/.test(event.type)) return;
        run.events.push({ ...event });
    }
    run.bytes += JSON.stringify(event).length;
}

function finish(run) {
    if (run.done) return;
    run.done = true;
    run.finishedAt = Date.now();
    run.emitter.emit('end');
    setTimeout(() => {
        runs.delete(run.id);
        if (run.sessionId && bySession.get(sessionKey(run.tenant, run.sessionId)) === run) bySession.delete(sessionKey(run.tenant, run.sessionId));
    }, FINISHED_TTL_MS).unref?.();
}

// handleChatRequest 看到的响应对象：只认 status / setHeader / flushHeaders / write / end / json / on('close')
function createRunResponse(run) {
    const res = new EventEmitter();
    let buffer = '';
    res.statusCode = 200;
    res.destroyed = false;
    res.writableEnded = false;
    res.headersSent = false;
    res.status = code => { res.statusCode = code; return res; };
    res.setHeader = () => res;
    res.getHeader = () => undefined;
    res.flushHeaders = () => {
        res.headersSent = true;
        run.emitter.emit('stream');
        // 回复真正开始前就点了停止：等处理函数挂好 close 监听后再中止
        if (run.stopRequested) setImmediate(() => res.abort());
    };
    const consume = final => {
        const lines = buffer.split('\n');
        buffer = final ? '' : lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            let event;
            try { event = JSON.parse(line); } catch { continue; }
            if (event.type === 'start' && event.sessionId && !run.sessionId) {
                run.sessionId = String(event.sessionId);
                bySession.set(sessionKey(run.tenant, run.sessionId), run);
                try { lifecycle.emit('session', run); } catch (error) { console.warn('[AI] live session hook failed:', error?.message || error); }
            }
            pushEvent(run, event);
            run.emitter.emit('event', event);
        }
    };
    res.write = chunk => { buffer += String(chunk); consume(false); return true; };
    res.end = chunk => {
        if (res.writableEnded) return res;
        if (chunk) buffer += String(chunk);
        consume(true);
        res.writableEnded = true;
        res.emit('finish');
        finish(run);
        return res;
    };
    res.json = body => {
        if (res.writableEnded) return res;
        run.jsonResult = { status: res.statusCode, body };
        res.writableEnded = true;
        res.emit('finish');
        finish(run);
        return res;
    };
    res.send = body => res.json(body);
    res.abort = () => {
        if (res.writableEnded || res.destroyed) return;
        res.destroyed = true;
        res.emit('close');
    };
    return res;
}

function writeNdjsonHead(res) {
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
}

// 把一个真实 HTTP 响应挂到 run 上：先补放缓存，再实时推送；连接断开只摘掉观看者，不中止回复
function watch(run, res, { prelude = null } = {}) {
    const send = event => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`); };
    const onEvent = event => send(event);
    const onEnd = () => {
        cleanup();
        if (run.jsonResult && !run.events.length) send({ type: 'error', error: run.jsonResult.body?.error || '回复失败', code: run.jsonResult.body?.code });
        if (!res.writableEnded) res.end();
    };
    const cleanup = () => { run.emitter.off('event', onEvent); run.emitter.off('end', onEnd); };
    res.on('close', cleanup);
    writeNdjsonHead(res);
    if (prelude) send(prelude);
    for (const event of run.events) send(event);
    if (run.done) return onEnd();
    run.emitter.on('event', onEvent);
    run.emitter.on('end', onEnd);
}

/** POST /chat（background:true）：后台起跑，当前连接作为第一个观看者 */
function start(req, res, handler) {
    const tenant = tenantKey();
    const owner = String(req.user?.username || '');
    if (activeCount(tenant, owner) >= MAX_PARALLEL) {
        return res.status(429).json({ code: 'AI_TOO_MANY_RUNS', limit: MAX_PARALLEL, error: `同时进行的对话最多 ${MAX_PARALLEL} 个，请等其中一个完成或停止后再发送` });
    }
    const clientRunId = String(req.body?.clientRunId || '');
    const run = {
        id: /^[A-Za-z0-9_-]{8,64}$/.test(clientRunId) && !runs.has(clientRunId) ? clientRunId : crypto.randomUUID(),
        tenant, owner, sessionId: '', events: [], bytes: 0, done: false, stopRequested: false,
        startedAt: Date.now(), emitter: new EventEmitter(), jsonResult: null,
        question: (() => { const last = Array.isArray(req.body?.messages) ? req.body.messages.at(-1) : null; return last?.role === 'user' ? String(last.content || '') : ''; })()
    };
    run.emitter.setMaxListeners(50);
    run.res = createRunResponse(run);
    runs.set(run.id, run);
    // 第一个观看者：处理函数开始流式输出时挂上；流开始前就出错（如 503 / 409）按原样返回 JSON
    let attached = false;
    const attach = () => { if (attached || res.destroyed || res.writableEnded) return; attached = true; watch(run, res, { prelude: { type: 'run', runId: run.id } }); };
    run.emitter.once('stream', attach);
    run.emitter.once('end', () => {
        if (attached || res.destroyed || res.writableEnded) return;
        attached = true;
        if (run.jsonResult) res.status(run.jsonResult.status || 200).json(run.jsonResult.body);
        else watch(run, res, { prelude: { type: 'run', runId: run.id } });
    });
    Promise.resolve()
        .then(() => handler(req, run.res))
        .catch(error => {
            console.error('[AI] background chat failed:', error?.message || error);
            if (!run.res.headersSent) run.res.status(500).json({ error: error?.message || '回复失败' });
            else run.res.end(`${JSON.stringify({ type: 'error', error: error?.message || '回复失败' })}\n`);
        })
        .finally(() => { if (!run.done) run.res.end(); });
}

function findBySession(sessionId, { owner, includeDone = false } = {}) {
    const run = bySession.get(sessionKey(tenantKey(), String(sessionId || '')));
    if (!run || run.owner !== String(owner || '') || (!includeDone && run.done)) return null;
    return run;
}

function isRunning(sessionId, owner) {
    return Boolean(findBySession(sessionId, { owner }));
}

/** GET /sessions/:id/live：切回正在回复的对话时接上（已结束不久的也能补放结果） */
function attachLive(req, res) {
    const run = findBySession(req.params.sessionId, { owner: req.user?.username, includeDone: true });
    if (!run) return res.status(204).end();
    watch(run, res, { prelude: { type: 'live', runId: run.id, sessionId: run.sessionId, question: run.question, startedAt: run.startedAt, done: run.done } });
}

/** 停止：按 runId（新对话还没拿到会话号时）或会话号 */
function stop({ runId, sessionId, owner }) {
    const tenant = tenantKey();
    const run = runId ? runs.get(String(runId)) : findBySession(sessionId, { owner });
    if (!run || run.tenant !== tenant || run.owner !== String(owner || '')) return false;
    if (run.done) return true;
    run.stopRequested = true;
    if (run.res.headersSent) run.res.abort();
    return true;
}

/** 本账号正在后台回复、还没有任何已保存消息的新对话（侧栏要能看到并点回去） */
function runningSessions(owner) {
    const tenant = tenantKey(), out = [];
    for (const run of runs.values()) {
        if (!run.done && run.sessionId && run.tenant === tenant && run.owner === String(owner || '')) out.push({ sessionId: run.sessionId, question: run.question, startedAt: run.startedAt });
    }
    return out;
}

module.exports = { start, attachLive, stop, isRunning, findBySession, runningSessions, lifecycle, MAX_PARALLEL, _runs: runs };
