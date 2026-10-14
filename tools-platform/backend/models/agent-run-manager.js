// Dragon Claw 工作区：智能体会话与运行（内存态）。
// - session：按 agentSessionId 保存根目录、权限模式、会话级“总是允许”、变更记录和上一轮工具转录；
// - run：一次 /api/ai/chat 流式请求内的工具循环，含审批等待、中止清理；
// - 审批由另一条 HTTP 请求 resolveApproval() 纯内存结算，不触碰数据库，避免租户上下文混用。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const toolsService = require('./agent-tools-service');
const contextStats = require('./agent-context-stats');
const { AgentChangeLog } = require('./agent-change-log');
const guard = require('./agent-path-guard');
const transcriptRepo = require('./agent-transcript-repository');
const commandGuard = require('./agent-command-guard');
const changeRepo = require('./agent-change-repository');
const { redactText, redactValue } = require('./ai-sensitive-data');

const MAX_STEPS = 25;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;
const SESSION_IDLE_MS = 6 * 60 * 60 * 1000;
const MAX_SESSIONS = 50;
const PERMISSION_MODES = ['ask', 'auto', 'full'];
const DIRECTORY_CONTEXT_ENTRIES = 200;

const sessions = new Map();
const runs = new Map();
const pendingApprovals = new Map();

function normalizePermissionMode(value) {
    return PERMISSION_MODES.includes(value) ? value : 'ask';
}

function managerError(code, message, statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function sweepSessions() {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (session.activeRun) continue;
        if (now - session.lastUsedAt > SESSION_IDLE_MS) sessions.delete(id);
    }
    if (sessions.size > MAX_SESSIONS) {
        [...sessions.entries()]
            .filter(([, session]) => !session.activeRun)
            .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
            .slice(0, sessions.size - MAX_SESSIONS)
            .forEach(([id]) => sessions.delete(id));
    }
}
const sweepTimer = setInterval(sweepSessions, 10 * 60 * 1000);
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

function ownerKey(user, tenantId) {
    return `${String(tenantId || 'default')}::${String(user && user.username || '')}`;
}

/** 取得或创建会话；根目录变化时重置变更记录与转录。 */
// 账号权限：管理员拥有全部权限；其他账号只读（只能查看、搜索文件）
function isAdminUser(user) {
    return Boolean(user && user.role === 'admin');
}

function ensureSession({ agentSessionId, user, tenantId, root, permissionMode }) {
    const id = String(agentSessionId || '').slice(0, 100);
    if (!/^[\w-]{8,100}$/.test(id)) throw managerError('AGENT_SESSION_INVALID', 'agentSessionId 无效');
    const realRoot = guard.normalizeRoot(root);
    const owner = ownerKey(user, tenantId);
    let session = sessions.get(id);
    if (session && session.owner !== owner) throw managerError('AGENT_SESSION_FORBIDDEN', '无权访问该智能体会话', 403);
    if (session) session.readOnly = !isAdminUser(user); // 角色可能被管理员调整
    if (!session) {
        session = {
            id,
            owner,
            username: user.username,
            tenantId: tenantId || 'default',
            root: realRoot,
            permissionMode: normalizePermissionMode(permissionMode),
            readOnly: !isAdminUser(user),
            alwaysAllow: new Set(),
            changeLog: new AgentChangeLog(realRoot),
            transcript: [],
            hydrated: false,
            turnCount: 0,
            activeRun: null,
            createdAt: Date.now(),
            lastUsedAt: Date.now()
        };
        sessions.set(id, session);
        sweepSessions();
    } else if (session.root !== realRoot) {
        session.root = realRoot;
        session.changeLog = new AgentChangeLog(realRoot);
        session.transcript = [];
        session.turnCount = 0;
        session.hydrated = false; // 换目录后仍需校验持久归属；旧根目录的转录不会被恢复。
        session.alwaysAllow.clear();
    }
    if (permissionMode) session.permissionMode = normalizePermissionMode(permissionMode);
    session.lastUsedAt = Date.now();
    return session;
}

/**
 * 从库里恢复同一 agentSessionId 上次持久化的工具转录（仅首次、且根目录一致时）。
 * 需在请求的租户上下文内调用；无法确认归属时停止本轮。
 */
async function hydrateSession(session) {
    if (!session || session.hydrated) return session;
    try {
        const saved = await transcriptRepo.load(session.id);
        if (saved && saved.owner !== session.owner) throw managerError('AGENT_SESSION_FORBIDDEN', '无权访问该智能体会话', 403);
        if (saved && saved.owner === session.owner && saved.root === session.root && !session.transcript.length) {
            session.transcript = saved.transcript;
            session.turnCount = saved.turnCount;
            if (!session.lastContext && saved.context) session.lastContext = saved.context;
        }
    } catch (error) {
        if (error.code === 'AGENT_SESSION_FORBIDDEN') throw error;
        throw managerError('AGENT_STORAGE_UNAVAILABLE', '无法校验智能体会话归属，请稍后重试', 503);
    }
    try {
        const changes = await changeRepo.load(session.id);
        if (changes && changes.owner !== session.owner) throw managerError('AGENT_SESSION_FORBIDDEN', '无权访问该智能体会话', 403);
        if (changes && changes.owner === session.owner && changes.root === session.root && !session.changeLog.entries.size) {
            session.changeLog = AgentChangeLog.fromRecords(session.root, changes.records);
        }
    } catch (error) {
        if (error.code === 'AGENT_SESSION_FORBIDDEN') throw error;
        throw managerError('AGENT_STORAGE_UNAVAILABLE', '无法校验智能体会话快照归属，请稍后重试', 503);
    }
    await transcriptRepo.claimSession(session.id, session.owner);
    session.hydrated = true;
    return session;
}

/** 更改与撤销快照落库（每次文件改动后、撤销后调用）；失败只记日志。 */
async function persistChanges(session) {
    try {
        await changeRepo.save({ agentSessionId: session.id, owner: session.owner, root: session.root, records: session.changeLog.toRecords() });
    } catch (error) {
        console.warn('[agent] failed to persist change snapshots:', error.message || error);
    }
}

/**
 * 重启后会话不在内存：按库里的转录或更改记录（同一用户、同一根目录）重建会话，
 * 以便查看更改、撤销。没有记录时返回 null。
 */
async function restoreSession(agentSessionId, user, tenantId, root) {
    const existing = getSession(agentSessionId, user, tenantId);
    if (existing) return existing.root === root ? existing : null;
    const owner = ownerKey(user, tenantId);
    let saved = null;
    let changes = null;
    try {
        saved = await transcriptRepo.load(agentSessionId);
        changes = await changeRepo.load(agentSessionId);
    } catch (error) {
        console.warn('[agent] failed to restore session:', error.message || error);
        return null;
    }
    const matches = record => record && record.owner === owner && record.root === root;
    if (!matches(saved) && !matches(changes)) return null;
    const session = ensureSession({ agentSessionId, user, tenantId, root, permissionMode: saved?.permissionMode || 'ask' });
    await hydrateSession(session);
    return session;
}

/**
 * 恢复对话时右侧面板的状态：上一轮的上下文占用与轮数（内存会话优先，否则读库）。
 * 只返回同一用户、同一根目录下的记录。
 */
async function loadSessionState(agentSessionId, user, tenantId, root) {
    const session = await restoreSession(agentSessionId, user, tenantId, root);
    if (session) return { context: session.lastContext || null, turnCount: session.turnCount || 0, session };
    try {
        const saved = await transcriptRepo.load(agentSessionId);
        if (saved && saved.owner === ownerKey(user, tenantId) && saved.root === root) return { context: saved.context || null, turnCount: saved.turnCount, session: null };
    } catch (error) {
        console.warn('[agent] failed to load session state:', error.message || error);
    }
    return { context: null, turnCount: 0, session: session && session.root === root ? session : null };
}

/** 供 /select 使用：该用户在该根目录最近的会话 id（无或读库失败时为空串）。 */
async function findLatestSessionId(user, tenantId, root) {
    try {
        return await transcriptRepo.findLatestSessionId(ownerKey(user, tenantId), root);
    } catch (error) {
        console.warn('[agent] failed to look up latest session:', error.message || error);
        return '';
    }
}

async function persistTranscript(session) {
    try {
        await transcriptRepo.save({
            agentSessionId: session.id,
            owner: session.owner,
            root: session.root,
            permissionMode: session.permissionMode,
            transcript: session.transcript,
            turnCount: session.turnCount,
            context: session.lastContext || null
        });
    } catch (error) {
        console.warn('[agent] failed to persist transcript:', error.message || error);
    }
}

function getSession(agentSessionId, user, tenantId) {
    const session = sessions.get(String(agentSessionId || ''));
    if (!session) return null;
    if (session.owner !== ownerKey(user, tenantId)) throw managerError('AGENT_SESSION_FORBIDDEN', '无权访问该智能体会话', 403);
    session.lastUsedAt = Date.now();
    return session;
}

// ── 目录概览与 git 分支 ───────────────────────────────────
function readGitBranch(root) {
    try {
        let gitDir = path.join(root, '.git');
        const stat = fs.statSync(gitDir);
        if (stat.isFile()) {
            const match = fs.readFileSync(gitDir, 'utf8').match(/gitdir:\s*(.+)/);
            if (!match) return '';
            gitDir = path.resolve(root, match[1].trim());
        }
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
        return ref ? ref[1] : head.slice(0, 8);
    } catch (_error) {
        return '';
    }
}

function buildDirectoryContext(root) {
    const lines = [];
    let count = 0;
    const walk = (dir, level) => {
        if (count >= DIRECTORY_CONTEXT_ENTRIES) return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true })
                .filter(entry => !entry.name.startsWith('.'))
                .sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name));
        } catch (_error) {
            return;
        }
        for (const entry of entries) {
            if (count >= DIRECTORY_CONTEXT_ENTRIES) { lines.push(`${'  '.repeat(level)}…`); return; }
            count += 1;
            lines.push(`${'  '.repeat(level)}${entry.name}${entry.isDirectory() ? '/' : ''}`);
            if (entry.isDirectory() && level < 1 && !guard.isIgnoredDirName(entry.name)) walk(path.join(dir, entry.name), level + 1);
        }
    };
    walk(root, 0);
    return lines.join('\n');
}

function buildAgentAddendum(session, { gitBranch, directoryContext }) {
    const modeText = { ask: '请求批准（写入、删除、命令都会先征求用户同意）', auto: '帮我批准（读写自动，删除/重命名/命令需用户同意）', full: '完全访问（根目录内全部自动执行）' }[session.permissionMode];
    return `
## 工作区（本地目录）
用户已选择本地目录作为上下文，你可以通过工具读取、搜索、修改其中的文件并执行命令。
- 根目录：${session.root}
- 操作系统：${process.platform}${gitBranch ? `\n- Git 分支：${gitBranch}` : ''}
- 权限模式：${session.readOnly ? '只读（当前账号不是管理员，只能查看和搜索文件，不能修改、删除、重命名或执行命令；需要改动时请告诉用户联系管理员）' : modeText}
- 所有路径都相对根目录（如 src/index.js）；不能访问根目录之外的内容。
- 改文件前先用 read_file 看清上下文；小改动用 edit_file，整文件重写才用 write_file。
- 涉及平台业务数据或 SQLite 时，先 list_databases，再 database_schema / read_database_table；平台数据库由当前租户解析，与所选目录无关。不要用 Shell 绕过数据库工具的凭据和租户限制。
- 工具返回的错误要如实告诉用户；被用户拒绝的操作不要换个方式重试。
- 执行完成后用简洁的 Markdown 总结做了什么、改了哪些文件。

目录概览（前两层）：
${directoryContext || '（空目录）'}`;
}

// ── 审批 ────────────────────────────────────────────────
function classifyDecision(session, toolName, args = null) {
    const kind = toolsService.kindOf(toolName);
    if (!kind) return 'deny';
    if (kind === 'read') return 'allow';
    if (session.readOnly) return 'readonly';
    // 命令访问工作目录外 / 主目录 / 密钥文件：不受权限模式与「总是允许」影响，逐条确认
    if (toolName === 'run_command' && args && commandGuard.assessCommand(args.command, session.root).risky) return 'ask';
    if (session.alwaysAllow.has(toolName)) return 'allow';
    if (session.permissionMode === 'full') return 'allow';
    if (session.permissionMode === 'auto' && kind === 'write') return 'allow';
    return 'ask';
}

function awaitApproval(run, call, preview) {
    const id = crypto.randomUUID();
    return new Promise(resolve => {
        const settle = decision => {
            const pending = pendingApprovals.get(id);
            if (!pending) return;
            clearTimeout(pending.timer);
            pendingApprovals.delete(id);
            run.pending.delete(id);
            resolve(decision);
        };
        const timer = setTimeout(() => settle('timeout'), APPROVAL_TIMEOUT_MS);
        if (typeof timer.unref === 'function') timer.unref();
        pendingApprovals.set(id, { runId: run.id, sessionId: run.session.id, owner: run.session.owner, settle, timer, createdAt: Date.now() });
        run.pending.set(id, settle);
        run.write({ type: 'approval', id, runId: run.id, callId: call.id, tool: call.name, args: call.args, preview, expiresInMs: APPROVAL_TIMEOUT_MS });
    });
}

/** 由 POST /api/agent-workspace/approvals/:id 调用；只结算 Promise，不触库。 */
function resolveApproval(approvalId, decision, user, tenantId) {
    if (!isAdminUser(user)) throw managerError('AGENT_SESSION_FORBIDDEN', '只读账号无权批准写入或命令', 403);
    const pending = pendingApprovals.get(String(approvalId || ''));
    if (!pending) throw managerError('AGENT_APPROVAL_NOT_FOUND', '审批已过期或不存在', 404);
    if (pending.owner !== ownerKey(user, tenantId)) throw managerError('AGENT_SESSION_FORBIDDEN', '无权处理该审批', 403);
    const normalized = ['allow', 'deny', 'always'].includes(decision) ? decision : 'deny';
    pending.settle(normalized);
    return { ok: true, decision: normalized };
}

// ── 工具循环 ─────────────────────────────────────────────
function previewArgs(args) {
    const text = JSON.stringify(args || {});
    return text.length > 2000 ? JSON.parse(JSON.stringify(args, (key, value) => typeof value === 'string' && value.length > 400 ? `${value.slice(0, 400)}…` : value)) : args;
}

/**
 * 执行一轮对话（可能包含多步工具调用）。
 * @returns {{ text, usage, steps, toolCallCount, denied, context, changes, gitBranch }}
 */
/** 在会话上开始一次运行（工具循环或「创建 PR」流程共用）：占用会话、登记中止清理。 */
function beginRun(session, write, signal) {
    if (session.activeRun) throw managerError('AGENT_RUN_BUSY', '该会话有正在进行的任务，请等待完成或先停止', 409);
    const run = { id: crypto.randomUUID(), session, write, signal, pending: new Map(), processes: new Set(), aborted: false };
    runs.set(run.id, run);
    session.activeRun = run;
    const onAbort = () => {
        run.aborted = true;
        run.pending.forEach(settle => settle('abort'));
        run.processes.forEach(child => toolsService.killTree(child));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    run.end = () => {
        signal?.removeEventListener('abort', onAbort);
        run.pending.forEach(settle => settle('abort'));
        runs.delete(run.id);
        if (session.activeRun === run) session.activeRun = null;
        session.lastUsedAt = Date.now();
    };
    return run;
}

async function runAgentTurn({ session, client, systemInstruction, historyMessages, write, signal, maxOutputTokens, temperature, model, sensitiveValues = [] }) {
    const emit = write;
    write = event => emit(redactValue(event, { secrets: sensitiveValues }));
    const run = beginRun(session, write, signal);
    try { await hydrateSession(session); } catch (error) {
        run.end();
        if (sessions.get(session.id) === session && !session.hydrated) sessions.delete(session.id);
        throw error;
    }

    const gitBranch = readGitBranch(session.root);
    const directoryContext = buildDirectoryContext(session.root);
    const addendum = buildAgentAddendum(session, { gitBranch, directoryContext });
    const fullSystem = redactText(`${systemInstruction}\n${addendum}`, { secrets: sensitiveValues });
    const tools = toolsService.definitions({ readOnly: session.readOnly });
    // 同一会话前几轮的工具转录（按轮保存、含用户消息）替换对应的文字历史，让模型记得自己做过什么，
    // 且工具调用始终紧跟用户消息或工具结果。
    const currentUser = historyMessages[historyMessages.length - 1];
    let messages = redactValue(transcriptRepo.mergeHistoryWithTranscript(historyMessages, session.transcript), { secrets: sensitiveValues });
    const toolCtx = { root: session.root, changeLog: session.changeLog, signal, sensitiveValues, onProcess: child => run.processes.add(child) };
    session.changeLog.sensitiveValues = sensitiveValues;

    let activeClient = client;
    const usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    let lastPromptTokens = 0;
    let steps = 0;
    let toolCallCount = 0;
    let denied = 0;
    let finalText = '';
    const turnTranscript = currentUser && currentUser.role === 'user' ? [{ role: 'user', content: String(currentUser.content || '') }] : [];
    const toolLog = [];
    const initialTranscript = session.transcript;
    const checkpoint = status => transcriptRepo.saveTurn({ runId: run.id, agentSessionId: session.id, owner: session.owner, root: session.root,
        transcript: redactValue(turnTranscript, { secrets: sensitiveValues }), status });

    try {
        await checkpoint('running');
        for (steps = 1; steps <= MAX_STEPS; steps += 1) {
            if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            const compacted = contextStats.fitMessages({ model: model || activeClient?.model, systemPrompt: fullSystem, messages, tools, maxOutputTokens });
            messages = compacted.messages;
            if (compacted.droppedTurns) write({ type: 'status', status: `较早的 ${compacted.droppedTurns} 轮已移出模型上下文，完整记录仍保留在会话档案中。` });
            const result = await activeClient.generateText({
                systemInstruction: fullSystem,
                messages,
                tools,
                maxOutputTokens,
                temperature,
                signal,
                onDelta: delta => write({ type: 'delta', delta })
            });
            if (result.providerClient) activeClient = result.providerClient;
            usage.promptTokens = Number(result.usage?.promptTokens || 0);
            usage.outputTokens += Number(result.usage?.outputTokens || 0);
            usage.totalTokens += Number(result.usage?.totalTokens || 0);
            lastPromptTokens = Number(result.usage?.promptTokens || 0) || lastPromptTokens;
            const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
            if (!toolCalls.length) {
                finalText = redactText(result.text || '', { secrets: sensitiveValues });
                break;
            }
            if (result.text) write({ type: 'delta', delta: '\n\n' });
            const modelMessage = { role: 'model', content: result.text || '', toolCalls };
            messages.push(modelMessage);
            turnTranscript.push(modelMessage);
            const toolResults = [];
            const toolMessage = { role: 'tool', toolResults };
            turnTranscript.push(toolMessage);
            await checkpoint('running');
            for (const call of toolCalls) {
                toolCallCount += 1;
                const startedAt = Date.now();
                write({ type: 'tool_start', runId: run.id, callId: call.id, tool: call.name, args: previewArgs(call.args) });
                let outcome;
                let decision = classifyDecision(session, call.name, call.args);
                let preview = {};
                if (decision !== 'deny' && decision !== 'readonly') {
                    try {
                        preview = await toolsService.preview(toolCtx, call.name, call.args);
                    } catch (error) {
                        outcome = { content: `错误（${error.code || 'ERROR'}）：${error.message}`, summary: error.message, isError: true };
                    }
                }
                if (!outcome && decision === 'ask') {
                    const answer = await awaitApproval(run, call, preview);
                    if (answer === 'always') session.alwaysAllow.add(call.name);
                    decision = answer === 'allow' || answer === 'always' ? 'allow' : answer;
                    write({ type: 'approval_result', runId: run.id, callId: call.id, decision: answer });
                }
                if (!outcome && decision !== 'allow') {
                    denied += 1;
                    const reason = decision === 'readonly' ? '当前账号为只读权限（非管理员），不能修改文件或执行命令' : decision === 'timeout' ? '审批超时，操作未执行' : decision === 'abort' ? '任务已中止' : '用户拒绝了该操作';
                    outcome = { content: reason, summary: reason, isError: true };
                }
                if (!outcome) outcome = await toolsService.execute(toolCtx, call.name, call.args);
                const durationMs = Date.now() - startedAt;
                // 命令输出随事件下发（截断），界面可展开查看，也随会话记录入库
                const output = call.name === 'run_command' && typeof outcome.content === 'string' ? outcome.content : undefined;
                write({ type: 'tool_result', runId: run.id, callId: call.id, tool: call.name, ok: !outcome.isError, summary: String(outcome.summary || '').slice(0, 200), truncated: Boolean(outcome.truncated), durationMs, ...(output ? { output } : {}) });
                if (outcome.change) write({ type: 'change', ...outcome.change });
                (outcome.changes || []).forEach(change => write({ type: 'change', ...change }));
                if (outcome.mutated || outcome.change || outcome.changes?.length || (!outcome.isError && ['write', 'destructive'].includes(toolsService.kindOf(call.name)))) await persistChanges(session);
                toolLog.push({ tool: call.name, ok: !outcome.isError, summary: String(outcome.summary || '').slice(0, 120) });
                toolResults.push({ id: call.id, name: call.name, content: outcome.content, isError: Boolean(outcome.isError) });
                await checkpoint('running');
                if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
            }
            messages.push(toolMessage);
        }
        if (!finalText && steps > MAX_STEPS) {
            finalText = `已达到单轮最大工具调用步数（${MAX_STEPS}），请继续提问以接着处理。`;
            write({ type: 'delta', delta: finalText });
        }
        // 下一轮续写时保留本轮的工具转录（按整轮裁剪，避免无限增长）
        if (finalText) turnTranscript.push({ role: 'model', content: finalText });
        session.transcript = transcriptRepo.normalizeTranscript(redactValue([...session.transcript, ...turnTranscript], { secrets: sensitiveValues }));
        session.turnCount += 1;
        const context = contextStats.build({
            model: model || activeClient?.model,
            systemPrompt: systemInstruction,
            directoryContext: addendum,
            messages,
            tools,
            providerPromptTokens: lastPromptTokens
        });
        session.lastContext = context;
        await checkpoint('completed');
        await persistTranscript(session);
        return {
            text: finalText,
            usage,
            steps: Math.min(steps, MAX_STEPS),
            toolCallCount,
            denied,
            toolLog,
            context,
            changes: session.changeLog.summary(),
            gitBranch,
            runId: run.id
        };
    } catch (error) {
        // 已执行的工具结果即使随后中断/模型出错也要恢复；尚未执行的并行调用补齐失败响应。
        const last = turnTranscript[turnTranscript.length - 1];
        const calls = turnTranscript[turnTranscript.length - 2]?.toolCalls;
        if (last?.role === 'tool' && calls) {
            const done = new Set(last.toolResults.map(item => item.id));
            for (const call of calls) if (!done.has(call.id)) last.toolResults.push({ id: call.id, name: call.name, content: '本轮已中断，操作未执行。', isError: true });
        }
        turnTranscript.push({ role: 'model', content: signal?.aborted ? '（本轮已停止）' : `（本轮失败：${redactText(error.message, { secrets: sensitiveValues })}）` });
        session.transcript = transcriptRepo.normalizeTranscript(redactValue([...initialTranscript, ...turnTranscript], { secrets: sensitiveValues }));
        await checkpoint(signal?.aborted ? 'aborted' : 'failed').catch(saveError => console.warn('[agent] failed to persist turn archive:', redactText(saveError.message)));
        await persistTranscript(session);
        throw error;
    } finally {
        run.end();
    }
}

function stats() {
    return { sessions: sessions.size, runs: runs.size, pendingApprovals: pendingApprovals.size };
}

module.exports = {
    ownerKey,
    isAdminUser,
    MAX_STEPS,
    APPROVAL_TIMEOUT_MS,
    PERMISSION_MODES,
    normalizePermissionMode,
    ensureSession,
    hydrateSession,
    findLatestSessionId,
    persistTranscript,
    persistChanges,
    restoreSession,
    loadSessionState,
    beginRun,
    requestApproval: awaitApproval,
    getSession,
    readGitBranch,
    buildDirectoryContext,
    classifyDecision,
    resolveApproval,
    runAgentTurn,
    stats,
    _internal: { sessions, runs, pendingApprovals }
};
