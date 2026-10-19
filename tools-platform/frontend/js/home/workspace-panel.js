// 首页 Dragon Claw 工作区：选择本地目录作为上下文、权限模式、审批卡片，以及右侧「环境 / 上下文 / 更改」面板。
// - 目录选择是「路径输入 + 后端联想」（/api/agent-workspace/suggest），不依赖系统弹窗；
// - 对话负载由 dragon-claw.js 通过 getWorkspacePayload() 取得；流式事件经 handleEvent() 渲染；
// - 文案取自 dragon-claw.js 的 TEXT 表（window.DragonClawText.tx），两处共用一套中英文。
(function () {
    'use strict';

    const API = '/api/agent-workspace';
    const SESSION_KEY = 'dragon_claw_agent_session';
    const SESSION_ROOT_KEY = 'dragon_claw_agent_session_root'; // 该会话 id 对应的根目录：刷新后重选同一目录时沿用 id，服务端转录才能接上
    const PANEL_KEY = 'dragon_claw_workspace_open';
    const MODES = ['ask', 'auto', 'full'];

    const state = {
        enabled: false,
        selectionEpoch: 0,
        capability: null,
        prefs: { lastDirectory: '', recentDirectories: [], permissionMode: 'ask' },
        root: '',
        rootName: '',
        gitBranch: '',
        permissionMode: 'ask',
        agentSessionId: '',
        context: null,
        changes: [],
        openDiff: null,
        pr: null, // { phase: 'checking'|'blocked'|'form'|'running'|'done'|'failed', preflight, steps, url, error, controller }
        open: false,
        picker: { items: [], active: -1, timer: null, lastInput: null, exists: false, isDir: false, requestId: 0 }
    };
    const el = {};
    const approvalCards = new Map();
    const toolRows = new Map();

    function tx(key, params) {
        return window.DragonClawText?.tx ? window.DragonClawText.tx(key, params) : key;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function authHeaders() {
        if (typeof window.getAuthHeaderForNav === 'function') return window.getAuthHeaderForNav();
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function request(method, url, body) {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let data = {};
        try { data = await res.json(); } catch { data = {}; }
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { code: data.code, status: res.status });
        return data;
    }

    function newSessionId() {
        const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        try { sessionStorage.setItem(SESSION_KEY, id); } catch { /* ignore */ }
        return id;
    }

    function adoptSessionId(id) {
        const value = String(id || '');
        if (!/^[\w-]{8,100}$/.test(value)) return '';
        try { sessionStorage.setItem(SESSION_KEY, value); } catch { /* ignore */ }
        return value;
    }

    function formatTokens(value) {
        const number = Number(value || 0);
        if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
        if (number >= 1000) return `${(number / 1000).toFixed(number >= 100000 ? 0 : 1)}k`;
        return String(Math.round(number));
    }

    function toast(text) {
        if (window.DragonClawText?.toast) window.DragonClawText.toast(text);
        else window.showToast?.(text);
    }

    // ── 面板开关 ──────────────────────────────────────────
    function setOpen(open) {
        state.open = Boolean(open) && state.enabled;
        document.body.classList.toggle('dc-workspace-open', state.open);
        el.panel.hidden = !state.open;
        el.toggle?.setAttribute('aria-pressed', String(state.open));
        el.fab?.setAttribute('aria-pressed', String(state.open));
        try { localStorage.setItem(PANEL_KEY, state.open ? '1' : '0'); } catch { /* ignore */ }
        if (state.open) requestAnimationFrame(() => { if (state.open) el.panel.classList.add('is-drawer-open'); });
        else el.panel.classList.remove('is-drawer-open');
    }

    function isDrawerMode() {
        return window.matchMedia('(max-width: 860px)').matches;
    }

    function isReadOnly() {
        return Boolean(state.capability?.readOnly);
    }

    // ── 环境卡 ──────────────────────────────────────────
    function renderEnv() {
        const dir = state.root
            ? `<div class="wsp-dir">
                    <div class="wsp-dir-main">
                        <span class="wsp-dir-icon" aria-hidden="true">📁</span>
                        <div class="wsp-dir-text">
                            <b title="${escapeHtml(state.root)}">${escapeHtml(state.rootName)}</b>
                            <small title="${escapeHtml(state.root)}">${escapeHtml(state.root)}</small>
                        </div>
                    </div>
                    <div class="wsp-dir-actions">
                        <button type="button" class="wsp-btn" data-wsp-action="change">${escapeHtml(tx('changeDir'))}</button>
                        <button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-action="clear" title="${escapeHtml(tx('clearDir'))}">×</button>
                    </div>
               </div>
               <div class="wsp-row"><span class="wsp-row-label">${escapeHtml(tx('branch'))}</span><span class="wsp-branch">${state.gitBranch ? `<i aria-hidden="true">⎇</i> ${escapeHtml(state.gitBranch)}` : `<em>${escapeHtml(tx('noBranch'))}</em>`}</span></div>`
            : `<button type="button" class="wsp-dir-empty" data-wsp-action="change">
                    <span aria-hidden="true">📂</span>
                    <span><b>${escapeHtml(tx('chooseDir'))}</b><small>${escapeHtml(tx('chooseDirHint'))}</small></span>
               </button>`;
        const modes = MODES.map(mode => `
            <button type="button" role="radio" aria-checked="${state.permissionMode === mode}" class="wsp-mode-option${state.permissionMode === mode ? ' is-active' : ''}" data-wsp-mode="${mode}">
                <b>${escapeHtml(tx(`mode${mode[0].toUpperCase()}${mode.slice(1)}`))}</b>
                <small>${escapeHtml(tx(`mode${mode[0].toUpperCase()}${mode.slice(1)}Desc`))}</small>
            </button>`).join('');
        const recent = state.prefs.recentDirectories.filter(item => item !== state.root).slice(0, 6);
        // 管理员全部权限；其他账号只读，不显示权限模式切换
        const permission = isReadOnly()
            ? `<div class="wsp-readonly"><b>🔒 ${escapeHtml(tx('readOnlyMode'))}</b><small>${escapeHtml(tx('readOnlyDesc'))}</small></div>`
            : `<div class="wsp-mode" role="radiogroup" aria-label="${escapeHtml(tx('permission'))}">${modes}</div>`;
        el.envBody.innerHTML = `
            ${dir}
            <div class="wsp-row wsp-row-col">
                <span class="wsp-row-label">${escapeHtml(tx('permission'))}</span>
                ${permission}
            </div>
            ${recent.length ? `<div class="wsp-row wsp-row-col">
                <span class="wsp-row-label">${escapeHtml(tx('recentDirs'))}</span>
                <div class="wsp-recent">${recent.map(item => `<button type="button" class="wsp-recent-item" data-wsp-select="${escapeHtml(item)}" title="${escapeHtml(item)}"><span>📁</span><span>${escapeHtml(baseName(item))}</span><i>${escapeHtml(shorten(item))}</i></button>`).join('')}</div>
            </div>` : ''}`;
    }

    function baseName(fullPath) {
        const parts = String(fullPath).replace(/[\\/]+$/, '').split(/[\\/]/);
        return parts[parts.length - 1] || fullPath;
    }

    function shorten(fullPath) {
        const home = state.capability?.homeDir;
        let text = String(fullPath);
        if (home && text.startsWith(home)) text = `~${text.slice(home.length)}`;
        return text.length > 42 ? `…${text.slice(-40)}` : text;
    }

    // ── 上下文卡 ────────────────────────────────────────
    function renderContext() {
        const ctx = state.context;
        if (!ctx) {
            el.ctxMeta.textContent = '';
            el.ctxBody.innerHTML = `<div class="wsp-empty">${escapeHtml(tx(state.root ? 'ctxEmpty' : 'ctxNoWorkspace'))}</div>`;
            return;
        }
        const order = ['messages', 'directory', 'system', 'tools', 'free'];
        const colors = { messages: '#60a5fa', directory: '#64ffda', system: '#a78bfa', tools: '#f59e0b', free: 'rgba(148,163,184,0.18)' };
        const total = Math.max(1, ctx.windowTokens || 1);
        const percent = Math.min(100, Math.round((ctx.usedTokens / total) * 100));
        el.ctxMeta.textContent = `${percent}%`;
        el.ctxBody.innerHTML = `
            <div class="wsp-ctx-head"><span>${escapeHtml(tx('ctxUsed', { percent }))}</span><span>${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.windowTokens)}</span></div>
            <div class="wsp-ctx-bar" role="img" aria-label="${escapeHtml(tx('ctxUsed', { percent }))}">
                ${order.map(key => `<i style="flex-basis:${((ctx.parts[key] || 0) / total * 100).toFixed(2)}%;background:${colors[key]}" title="${escapeHtml(tx(`ctx${key[0].toUpperCase()}${key.slice(1)}`))}"></i>`).join('')}
            </div>
            <ul class="wsp-ctx-legend">
                ${order.map(key => `<li><i style="background:${colors[key]}"></i><span>${escapeHtml(tx(`ctx${key[0].toUpperCase()}${key.slice(1)}`))}</span><b>${formatTokens(ctx.parts[key] || 0)}</b><em>${((ctx.parts[key] || 0) / total * 100).toFixed(1)}%</em></li>`).join('')}
            </ul>
            <div class="wsp-ctx-note">${escapeHtml(tx(ctx.source === 'provider' ? 'ctxSourceProvider' : 'ctxSourceEstimate'))}</div>`;
    }

    // ── 更改卡 ──────────────────────────────────────────
    function renderChanges() {
        const list = state.changes || [];
        const added = list.reduce((sum, item) => sum + (item.added || 0), 0);
        const removed = list.reduce((sum, item) => sum + (item.removed || 0), 0);
        el.changesMeta.innerHTML = list.length ? `<span class="wsp-add">+${added}</span> <span class="wsp-del">−${removed}</span>` : '';
        if (!list.length) {
            el.changesBody.innerHTML = `<div class="wsp-empty">${escapeHtml(tx('noChanges'))}</div>`;
            return;
        }
        const kindLabel = { create: 'A', modify: 'M', delete: 'D', rename: 'R' };
        el.changesBody.innerHTML = `
            <ul class="wsp-changes">
                ${list.map(item => `
                    <li class="wsp-change${state.openDiff?.path === item.path ? ' is-open' : ''}">
                        <button type="button" class="wsp-change-main" data-wsp-diff="${escapeHtml(item.path)}" title="${escapeHtml(tx('viewDiff'))}">
                            <span class="wsp-change-kind wsp-change-kind--${item.kind}">${kindLabel[item.kind] || '?'}</span>
                            <span class="wsp-change-path">${item.from ? `<s>${escapeHtml(baseName(item.from))}</s> → ` : ''}${escapeHtml(item.path)}${item.source === 'command' ? `<em class="wsp-change-src" title="${escapeHtml(tx('commandChangeHint'))}">${escapeHtml(tx('commandTag'))}</em>` : ''}</span>
                            ${item.binary
                                ? `<span class="wsp-change-stat wsp-change-bin" title="${escapeHtml(tx('binaryChangeHint'))}">${escapeHtml(tx('binaryChange'))}</span>`
                                : `<span class="wsp-change-stat"><span class="wsp-add">+${item.added || 0}</span><span class="wsp-del">−${item.removed || 0}</span></span>`}
                        </button>
                        ${isReadOnly() ? '' : item.source === 'git'
                            ? `<span class="wsp-change-ext" title="${escapeHtml(tx('externalChange'))}">${escapeHtml(tx('externalTag'))}</span>`
                            : `<button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-revert="${escapeHtml(item.path)}" ${item.revertible === false ? 'disabled' : ''} title="${escapeHtml(tx('revert'))}">↶</button>`}
                        ${state.openDiff?.path === item.path ? `<pre class="wsp-diff">${renderDiff(state.openDiff.text)}</pre>` : ''}
                    </li>`).join('')}
            </ul>
            ${!isReadOnly() && (list.some(item => item.source !== 'git') || state.pr) ? renderPr() : ''}`;
        mountPrLog();
    }

    // ── 创建 PR ──────────────────────────────────────────
    const PR_STEPS = ['branch', 'add', 'commit', 'push', 'create'];
    const prLog = document.createElement('div');
    prLog.className = 'dc-tool-log wsp-pr-log';

    function prStepLabel(step) {
        return tx(`prStep${step[0].toUpperCase()}${step.slice(1)}`);
    }

    function renderPr() {
        const pr = state.pr;
        const busy = pr && (pr.phase === 'checking' || pr.phase === 'running');
        if (!pr || pr.phase === 'checking') {
            return `<div class="wsp-changes-foot">
                ${pr ? `<span class="wsp-pr-hint">${escapeHtml(tx('prChecking'))}</span>` : ''}
                <button type="button" class="wsp-btn" data-wsp-pr="start" ${busy ? 'disabled' : ''}>${escapeHtml(tx('createPr'))}</button>
            </div>`;
        }
        if (pr.phase === 'blocked') {
            return `<div class="wsp-pr wsp-pr--blocked">
                <div class="wsp-pr-hint">${escapeHtml(pr.error || '')}</div>
                <div class="wsp-pr-actions"><button type="button" class="wsp-btn" data-wsp-pr="start">${escapeHtml(tx('prRetry'))}</button><button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-pr="close">${escapeHtml(tx('prClose'))}</button></div>
            </div>`;
        }
        if (pr.phase === 'form') {
            const check = pr.preflight || {};
            return `<form class="wsp-pr wsp-pr-form" data-wsp-pr-form>
                <div class="wsp-pr-title">${escapeHtml(tx('prFormTitle'))}</div>
                <label class="wsp-pr-field"><span>${escapeHtml(tx('prTitleLabel'))}</span><input type="text" name="title" required maxlength="200" placeholder="${escapeHtml(tx('prTitlePlaceholder'))}" value="${escapeHtml(pr.title || '')}"></label>
                <label class="wsp-pr-field"><span>${escapeHtml(tx('prBodyLabel'))}</span><textarea name="body" rows="3" maxlength="4000" placeholder="${escapeHtml(tx('prBodyPlaceholder'))}">${escapeHtml(pr.body || '')}</textarea></label>
                <label class="wsp-pr-field"><span>${escapeHtml(tx('prBranchLabel'))} <em>${escapeHtml(tx('prBaseBranch', { branch: check.branch || '' }))}</em></span><input type="text" name="branch" maxlength="100" value="${escapeHtml(pr.branch || check.suggestedBranch || '')}"></label>
                <div class="wsp-pr-hint">${escapeHtml(tx('prFilesHint', { count: check.changedFiles || state.changes.length }))}</div>
                <div class="wsp-pr-actions"><button type="submit" class="wsp-btn wsp-btn-primary">${escapeHtml(tx('prSubmit'))}</button><button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-pr="close">${escapeHtml(tx('prCancel'))}</button></div>
            </form>`;
        }
        const icon = { pending: '…', running: '⟳', done: '✓', failed: '✗', denied: '⊘', timeout: '⊘', aborted: '⊘' };
        const stepsHtml = PR_STEPS.map(step => {
            const status = pr.steps?.[step] || '';
            return `<li class="wsp-pr-step is-${status || 'idle'}"><i aria-hidden="true">${icon[status] || '·'}</i><span>${escapeHtml(prStepLabel(step))}</span></li>`;
        }).join('');
        const headline = pr.phase === 'running' ? tx('prRunning') : pr.phase === 'done' ? tx('prDone') : pr.error || tx('prAborted');
        return `<div class="wsp-pr wsp-pr--${pr.phase}">
            <div class="wsp-pr-title">${escapeHtml(headline)}${pr.branch ? ` <code>${escapeHtml(pr.branch)}</code>` : ''}</div>
            <ul class="wsp-pr-steps">${stepsHtml}</ul>
            <div class="wsp-pr-log-slot"></div>
            ${pr.failedOutput ? `<pre class="wsp-diff wsp-pr-output">${escapeHtml(pr.failedOutput)}</pre>` : ''}
            <div class="wsp-pr-actions">
                ${pr.url ? `<a class="wsp-btn wsp-btn-primary" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">${escapeHtml(tx('prOpen'))} ↗</a>` : ''}
                ${pr.phase === 'running' ? `<button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-pr="abort">${escapeHtml(tx('prCancel'))}</button>` : `<button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-pr="close">${escapeHtml(tx('prClose'))}</button>`}
            </div>
        </div>`;
    }

    /** 审批卡与命令行渲染到 prLog（复用对话内的 handleEvent），重绘后把它挂回卡片里。 */
    function mountPrLog() {
        const slot = el.changesBody.querySelector('.wsp-pr-log-slot');
        if (slot) slot.appendChild(prLog);
    }

    function prBlockedText(check) {
        const map = { NO_SESSION: 'prNoSession', NO_GIT: 'prNoGit', NOT_GIT: 'prNotGit', NO_GH: 'prNoGh', GH_NOT_AUTHED: 'prGhNotAuthed', NO_REMOTE: 'prNoRemote', NO_CHANGES: 'prNoChanges' };
        return tx(map[check?.reason] || 'prNotGit');
    }

    async function startPr() {
        if (!state.agentSessionId || state.pr?.phase === 'running') return;
        state.pr = { phase: 'checking' };
        renderChanges();
        try {
            const check = await request('GET', `${API}/pr/${encodeURIComponent(state.agentSessionId)}/preflight`);
            state.pr = check.ok
                ? { phase: 'form', preflight: check, title: '', body: '', branch: check.suggestedBranch }
                : { phase: 'blocked', preflight: check, error: prBlockedText(check) };
        } catch (error) {
            state.pr = { phase: 'blocked', error: error.message };
        }
        renderChanges();
        el.changesBody.querySelector('input[name="title"]')?.focus();
    }

    async function submitPr(form) {
        const data = new FormData(form);
        const payload = { title: String(data.get('title') || '').trim(), body: String(data.get('body') || ''), branch: String(data.get('branch') || '').trim() };
        if (!payload.title) return;
        const controller = new AbortController();
        prLog.innerHTML = '';
        state.pr = { phase: 'running', steps: {}, branch: payload.branch, url: '', controller };
        renderChanges();
        try {
            const res = await fetch(`${API}/pr/${encodeURIComponent(state.agentSessionId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            if (!res.ok || !res.body) {
                let info = {};
                try { info = await res.json(); } catch { /* ignore */ }
                state.pr = { phase: 'blocked', preflight: info.preflight, error: info.preflight ? prBlockedText(info.preflight) : (info.error || `HTTP ${res.status}`) };
                renderChanges();
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const consume = line => {
                if (!line.trim()) return;
                let event;
                try { event = JSON.parse(line); } catch { return; }
                handlePrEvent(event);
            };
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                lines.forEach(consume);
            }
            if (buffer) consume(buffer);
            if (state.pr?.phase === 'running') state.pr = { ...state.pr, phase: 'failed', error: tx('prAborted') };
        } catch (error) {
            if (state.pr) state.pr = { ...state.pr, phase: 'failed', error: error.name === 'AbortError' ? tx('prAborted') : error.message };
        }
        renderChanges();
    }

    function handlePrEvent(event) {
        const pr = state.pr;
        if (!pr) return;
        if (event.type === 'start') {
            pr.branch = event.branch || pr.branch;
            PR_STEPS.forEach(step => { pr.steps[step] = ''; });
        } else if (event.type === 'pr_step') {
            pr.steps[event.step] = event.status === 'pending' ? 'running' : event.status;
            if (event.url) pr.url = event.url;
            if (event.status === 'failed') {
                pr.failedOutput = event.output || '';
                pr.error = tx('prFailedAt', { step: prStepLabel(event.step) });
            } else if (['denied', 'timeout'].includes(event.status)) {
                pr.error = tx('prDeniedAt', { step: prStepLabel(event.step) });
            } else if (event.status === 'aborted') {
                pr.error = tx('prAborted');
            }
        } else if (event.type === 'done') {
            pr.phase = event.ok ? 'done' : 'failed';
            pr.url = event.url || pr.url;
            if (event.gitBranch) { state.gitBranch = event.gitBranch; renderEnv(); renderChip(); }
            if (event.ok) toast(tx('prDone'));
        } else if (event.type === 'error') {
            pr.phase = 'failed';
            pr.error = event.error || 'error';
        } else {
            // approval / approval_result / tool_start / tool_result：复用对话内渲染，挂在 PR 卡里
            handleEvent(prLog, event);
            return;
        }
        renderChanges();
    }

    function abortPr() {
        state.pr?.controller?.abort();
    }

    function closePr() {
        if (state.pr?.phase === 'running') return;
        state.pr = null;
        prLog.innerHTML = '';
        renderChanges();
    }

    function renderDiff(text) {
        if (!text) return `<span class="wsp-diff-ctx">${escapeHtml(tx('diffEmpty'))}</span>`;
        return String(text).split('\n').map(line => {
            const cls = line.startsWith('+') && !line.startsWith('+++') ? 'wsp-diff-add'
                : line.startsWith('-') && !line.startsWith('---') ? 'wsp-diff-del'
                    : line.startsWith('@@') ? 'wsp-diff-hunk' : 'wsp-diff-ctx';
            return `<span class="${cls}">${escapeHtml(line)}</span>`;
        }).join('\n');
    }

    async function toggleDiff(filePath) {
        const root = state.root;
        const id = state.agentSessionId;
        if (state.openDiff?.path === filePath) {
            state.openDiff = null;
            renderChanges();
            return;
        }
        try {
            const data = await request('GET', `${API}/changes/${encodeURIComponent(state.agentSessionId)}?path=${encodeURIComponent(filePath)}&root=${encodeURIComponent(state.root)}`);
            if (state.root !== root || state.agentSessionId !== id) return;
            state.changes = data.changes || state.changes;
            state.openDiff = data.diff ? { path: filePath, text: data.diff.text } : null;
        } catch (error) {
            toast(error.message);
        }
        renderChanges();
    }

    // 实时更改：智能体本会话改动 + git 工作区实际改动（含手动修改）。结果没变就不重绘，避免打断查看 diff。
    let changesRefreshing = false;
    function applyChanges(changes) {
        const next = Array.isArray(changes) ? changes : [];
        if (JSON.stringify(next) === JSON.stringify(state.changes || [])) return;
        state.changes = next;
        if (state.openDiff && !next.some(item => item.path === state.openDiff.path)) state.openDiff = null;
        renderChanges();
    }

    async function refreshChanges() {
        if (!state.enabled || !state.root || !state.agentSessionId || changesRefreshing || state.pr?.phase === 'running') return;
        changesRefreshing = true;
        const root = state.root;
        const id = state.agentSessionId;
        try {
            const data = await request('GET', `${API}/changes/${encodeURIComponent(state.agentSessionId)}?root=${encodeURIComponent(root)}`);
            if (state.root === root && state.agentSessionId === id) applyChanges(data.changes);
        } catch { /* 刷新失败保持现状 */ } finally {
            changesRefreshing = false;
        }
    }

    // 选目录 / 恢复对话后：上一轮的上下文占用 + 当前实际改动
    async function restoreState() {
        if (!state.enabled || !state.root || !state.agentSessionId) return;
        const root = state.root;
        const id = state.agentSessionId;
        try {
            const data = await request('GET', `${API}/state/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}`);
            if (state.root !== root || state.agentSessionId !== id) return;
            if (data.context) state.context = data.context;
            renderContext();
            applyChanges(data.changes);
        } catch { /* 读取失败保持空白 */ }
    }

    async function confirmRevertConflict(filePath) {
        const options = { title: tx('revertConflictTitle'), message: tx('revertConflictMessage', { path: filePath }), confirmText: tx('revertConflictConfirm'), tone: 'danger' };
        if (typeof window.showNavbarConfirm === 'function') return window.showNavbarConfirm(options);
        if (typeof showNavbarConfirm === 'function') return showNavbarConfirm(options); // eslint-disable-line no-undef
        return window.AppDialog.confirm(options.message, options);
    }

    async function revert(filePath, force = false, target = { root: state.root, id: state.agentSessionId }) {
        if (state.root !== target.root || state.agentSessionId !== target.id) return;
        try {
            const data = await request('POST', `${API}/changes/${encodeURIComponent(target.id)}/revert`, { path: filePath, root: target.root, force });
            if (state.root !== target.root || state.agentSessionId !== target.id) return;
            state.changes = data.changes || [];
            if (state.openDiff?.path === filePath) state.openDiff = null;
            toast(tx('reverted', { path: filePath }));
        } catch (error) {
            if (state.root !== target.root || state.agentSessionId !== target.id) return;
            // 智能体改完之后文件又被改过：先确认，避免覆盖后续工作
            if (error.code === 'AGENT_CHANGE_CONFLICT' && !force) {
                if (await confirmRevertConflict(filePath)) return revert(filePath, true, target);
                return;
            }
            toast(error.message);
        }
        renderChanges();
    }

    // ── 输入框上方的工作区芯片 ───────────────────────────
    function renderChip() {
        if (!el.chip) return;
        el.chip.hidden = !state.enabled;
        if (!state.enabled) return;
        if (!state.root) {
            const last = state.prefs.lastDirectory;
            el.chip.innerHTML = `
                <button type="button" class="dc-ws-chip dc-ws-chip--empty" data-wsp-action="change"><span aria-hidden="true">📂</span>${escapeHtml(tx('chooseDirShort'))}</button>
                ${last ? `<button type="button" class="dc-ws-chip dc-ws-chip--last" data-wsp-select="${escapeHtml(last)}" title="${escapeHtml(last)}"><span aria-hidden="true">↺</span>${escapeHtml(tx('useLastDir', { name: baseName(last) }))}</button>` : ''}`;
            return;
        }
        el.chip.innerHTML = `
            <button type="button" class="dc-ws-chip dc-ws-chip--active" data-wsp-action="panel" title="${escapeHtml(state.root)}">
                <span aria-hidden="true">📁</span><b>${escapeHtml(state.rootName)}</b>
                ${state.gitBranch ? `<i>⎇ ${escapeHtml(state.gitBranch)}</i>` : ''}
                <em>${escapeHtml(isReadOnly() ? tx('readOnlyMode') : tx(`mode${state.permissionMode[0].toUpperCase()}${state.permissionMode.slice(1)}`))}</em>
            </button>
            <button type="button" class="dc-ws-chip-x" data-wsp-action="clear" aria-label="${escapeHtml(tx('clearDir'))}">×</button>`;
    }

    function renderAll() {
        renderEnv();
        renderContext();
        renderChanges();
        renderChip();
        el.panel.querySelectorAll('[data-wsp-i18n]').forEach(node => { node.textContent = tx(node.dataset.wspI18n); });
        el.picker.querySelectorAll('[data-wsp-i18n]').forEach(node => { node.textContent = tx(node.dataset.wspI18n); });
        if (el.fab) {
            const label = el.fab.querySelector('.wsp-fab-label');
            if (label) label.textContent = tx('workspace');
            el.fab.setAttribute('aria-label', tx('workspace'));
        }
        if (el.pickerInput) el.pickerInput.placeholder = tx('typedPathPlaceholder');
    }

    // ── 目录选择：路径输入 + 后端联想 ────────────────────
    function openPicker() {
        el.picker.hidden = false;
        document.body.classList.add('dc-picker-open');
        el.pickerInput.value = state.root || state.prefs.lastDirectory || '';
        renderPickerRecent();
        el.pickerInput.focus();
        el.pickerInput.select();
        suggest(true);
    }

    function closePicker() {
        el.picker.hidden = true;
        document.body.classList.remove('dc-picker-open');
        state.picker.active = -1;
    }

    function renderPickerRecent() {
        const recent = state.prefs.recentDirectories.slice(0, 8);
        el.pickerRecent.innerHTML = recent.length
            ? `<span class="wsp-picker-recent-label">${escapeHtml(tx('recentDirs'))}</span>${recent.map(item => `<button type="button" class="wsp-chip" data-wsp-fill="${escapeHtml(item)}" title="${escapeHtml(item)}">${escapeHtml(baseName(item))}</button>`).join('')}`
            : '';
    }

    function scheduleSuggest() {
        clearTimeout(state.picker.timer);
        state.picker.timer = setTimeout(() => suggest(), 150);
    }

    async function suggest(force = false) {
        const input = el.pickerInput.value;
        if (!force && input === state.picker.lastInput) return;
        state.picker.lastInput = input;
        const requestId = state.picker.requestId += 1;
        try {
            const data = await request('GET', `${API}/suggest?input=${encodeURIComponent(input)}&showHidden=${el.pickerHidden.checked ? 'true' : 'false'}`);
            if (requestId !== state.picker.requestId) return;
            state.picker.exists = Boolean(data.exists);
            state.picker.isDir = Boolean(data.isDir);
            state.picker.items = [];
            (data.groups || []).forEach(group => {
                group.entries.forEach(entry => state.picker.items.push({ ...entry, group: group.label }));
            });
            state.picker.active = state.picker.items.length ? 0 : -1;
            renderPickerList(data);
        } catch (error) {
            if (requestId !== state.picker.requestId) return;
            el.pickerList.innerHTML = '';
            el.pickerStatus.innerHTML = `<span class="wsp-status-bad">${escapeHtml(error.message)}</span>`;
        }
    }

    function renderPickerList(data) {
        const input = el.pickerInput.value.trim();
        const groupLabels = { home: tx('groupHome'), root: tx('groupRoot'), children: '' };
        let lastGroup = null;
        const html = [];
        state.picker.items.forEach((item, index) => {
            if (item.group !== lastGroup && groupLabels[item.group]) html.push(`<div class="wsp-picker-group">${escapeHtml(groupLabels[item.group])}</div>`);
            lastGroup = item.group;
            const prefix = data.prefix || '';
            const name = prefix && item.name.toLowerCase().startsWith(prefix.toLowerCase())
                ? `<mark>${escapeHtml(item.name.slice(0, prefix.length))}</mark>${escapeHtml(item.name.slice(prefix.length))}`
                : escapeHtml(item.name);
            html.push(`<button type="button" role="option" id="wspOpt${index}" aria-selected="${index === state.picker.active}" class="wsp-picker-item${index === state.picker.active ? ' is-active' : ''}" data-wsp-index="${index}" title="${escapeHtml(item.path)}">
                <span class="wsp-picker-item-icon" aria-hidden="true">${item.isGit ? '⎇' : '📁'}</span>
                <span class="wsp-picker-item-name">${name}</span>
                <span class="wsp-picker-item-path">${escapeHtml(shorten(item.path))}</span>
            </button>`);
        });
        el.pickerList.innerHTML = html.join('') || `<div class="wsp-picker-none">${escapeHtml(data.error === 'EACCES' ? tx('noPermission') : input ? tx('noMatches') : tx('noMatches'))}</div>`;
        if (!input) el.pickerStatus.innerHTML = `<span>${escapeHtml(tx('pickerEmptyHint'))}</span>`;
        else if (data.exists && data.isDir) el.pickerStatus.innerHTML = `<span class="wsp-status-ok">✓ ${escapeHtml(tx('dirReady'))}${data.isGit ? ` · ⎇ git` : ''}</span>`;
        else if (data.exists) el.pickerStatus.innerHTML = `<span class="wsp-status-bad">${escapeHtml(tx('notDir'))}</span>`;
        else el.pickerStatus.innerHTML = `<span class="wsp-status-dim">${escapeHtml(tx('dirNotFound'))}</span>`;
        el.pickerSelect.disabled = !(data.exists && data.isDir);
        el.pickerInput.setAttribute('aria-activedescendant', state.picker.active >= 0 ? `wspOpt${state.picker.active}` : '');
    }

    function setActive(index) {
        const count = state.picker.items.length;
        if (!count) return;
        state.picker.active = (index + count) % count;
        el.pickerList.querySelectorAll('.wsp-picker-item').forEach((node, position) => {
            const active = position === state.picker.active;
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-selected', String(active));
            if (active) node.scrollIntoView({ block: 'nearest' });
        });
        el.pickerInput.setAttribute('aria-activedescendant', `wspOpt${state.picker.active}`);
    }

    // Tab/→：补全到该目录并追加分隔符，继续向下联想
    function completeActive() {
        const item = state.picker.items[state.picker.active];
        if (!item) return;
        const sep = state.capability?.sep || '/';
        el.pickerInput.value = item.path.endsWith(sep) ? item.path : `${item.path}${sep}`;
        el.pickerInput.setSelectionRange(el.pickerInput.value.length, el.pickerInput.value.length);
        suggest(true);
    }

    async function confirmPicker(explicitPath) {
        const target = explicitPath || el.pickerInput.value.trim();
        if (!target) return;
        try {
            await selectDirectory(target);
            closePicker();
        } catch (error) {
            el.pickerStatus.innerHTML = `<span class="wsp-status-bad">${escapeHtml(error.message)}</span>`;
        }
    }

    async function selectDirectory(fullPath, ticket = ++state.selectionEpoch) {
        const data = await request('POST', `${API}/select`, { path: fullPath });
        if (ticket !== state.selectionEpoch) throw Object.assign(new Error('Directory selection superseded'), { name: 'AbortError' });
        state.root = data.root;
        state.rootName = data.name || baseName(data.root);
        state.gitBranch = data.gitBranch || '';
        if (data.prefs) state.prefs = data.prefs;
        state.context = null;
        state.changes = [];
        state.openDiff = null;
        state.pr?.controller?.abort();
        state.pr = null;
        let previousRoot = '';
        try { previousRoot = sessionStorage.getItem(SESSION_ROOT_KEY) || ''; } catch { /* ignore */ }
        if (previousRoot !== data.root || !state.agentSessionId) {
            // 服务端记得该目录最近的会话 id（换标签页 / 重启后 sessionStorage 为空）就沿用，否则新开
            state.agentSessionId = adoptSessionId(data.agentSessionId) || newSessionId();
        }
        try { sessionStorage.setItem(SESSION_ROOT_KEY, data.root); } catch { /* ignore */ }
        renderAll();
        setOpen(true);
        toast(tx('workspaceReady', { name: state.rootName }));
        window.dispatchEvent(new CustomEvent('dragon-claw:workspace-change', { detail: { root: state.root } }));
        restoreState();
    }

    function clearDirectory() {
        state.selectionEpoch += 1;
        state.root = '';
        state.rootName = '';
        state.gitBranch = '';
        state.context = null;
        state.changes = [];
        state.openDiff = null;
        state.pr?.controller?.abort();
        state.pr = null;
        setOpen(false);
        renderAll();
        window.dispatchEvent(new CustomEvent('dragon-claw:workspace-change', { detail: { root: '' } }));
    }

    async function setMode(mode) {
        if (!MODES.includes(mode) || mode === state.permissionMode) return;
        state.permissionMode = mode;
        renderEnv();
        renderChip();
        toast(tx('modeChanged', { mode: tx(`mode${mode[0].toUpperCase()}${mode.slice(1)}`) }));
        try {
            state.prefs = await request('PUT', `${API}/prefs`, { permissionMode: mode });
        } catch (error) {
            toast(error.message);
        }
    }

    // ── 对话内：工具行与审批卡 ───────────────────────────
    function toolLogFor(messageEl) {
        if (messageEl.classList?.contains('dc-tool-log')) return messageEl;
        let log = messageEl.querySelector('.dc-tool-log');
        if (!log) {
            log = document.createElement('div');
            log.className = 'dc-tool-log';
            const main = messageEl.querySelector('.dc-msg-main');
            main.insertBefore(log, main.firstChild);
        }
        return log;
    }

    function describeArgs(tool, args = {}) {
        if (tool === 'run_command') return args.command || '';
        if (tool === 'search') return `"${args.query || ''}"${args.path && args.path !== '.' ? ` in ${args.path}` : ''}`;
        if (tool === 'rename_path') return `${args.from || ''} → ${args.to || ''}`;
        if (tool === 'list_directory') return args.path || '.';
        if (tool === 'list_databases') return args.path || '.';
        if (tool === 'database_schema' || tool === 'read_database_table') return `${args.database || ''}${args.table ? ` / ${args.table}` : ''}`;
        return args.path || '';
    }

    function toolIcon(tool) {
        return { list_directory: '📂', read_file: '📄', search: '🔍', list_databases: '🗄', database_schema: '🗄', read_database_table: '🗄', write_file: '✏️', edit_file: '✏️', delete_path: '🗑', rename_path: '↪', run_command: '⌘', welink_list_targets: '👥', welink_send_message: '📨' }[tool] || '⚙';
    }

    // ── 对话内：写入 / 编辑后的文件卡片（预览 / 代码） ─────
    // 内容按需从 /file 读取磁盘上的当前版本；HTML/SVG 在无 allow-same-origin 的沙箱 iframe 中渲染，拿不到平台的 Token 与存储。
    const FILE_TOOLS = new Set(['write_file', 'edit_file']);
    const PREVIEW_KINDS = { html: 'html', htm: 'html', xhtml: 'html', svg: 'svg', md: 'markdown', markdown: 'markdown' };
    const fileCache = new WeakMap();
    let replaying = false;

    function fileExt(filePath) {
        const match = /\.([^./\\]+)$/.exec(String(filePath || ''));
        return match ? match[1].toLowerCase() : '';
    }

    function formatBytes(size) {
        const value = Number(size || 0);
        if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
        if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
        return `${value} B`;
    }

    function attachFileCard(row, filePath, autoOpen) {
        if (!filePath) return;
        // 同一条回复里同一文件只保留最后一张卡片（多次编辑时显示最终版本）
        const log = row.parentElement;
        log?.querySelectorAll('.dc-file-card').forEach(card => { if (card.dataset.path === filePath) card.remove(); });
        const previewKind = PREVIEW_KINDS[fileExt(filePath)] || '';
        const card = document.createElement('div');
        card.className = 'dc-file-card';
        card.dataset.path = filePath;
        card.dataset.root = state.root;
        card.dataset.session = state.agentSessionId;
        card.dataset.preview = previewKind;
        card.innerHTML = `
            <div class="dc-file-head">
                <span class="dc-file-icon" aria-hidden="true">${previewKind === 'html' ? '🌐' : previewKind === 'markdown' ? '📝' : previewKind === 'svg' ? '🖼' : '📄'}</span>
                <span class="dc-file-name" title="${escapeHtml(filePath)}">${escapeHtml(baseName(filePath))}</span>
                <span class="dc-file-meta"></span>
                <span class="dc-file-tabs" role="tablist">
                    ${previewKind ? `<button type="button" role="tab" aria-selected="false" data-file-view="preview">${escapeHtml(tx('filePreview'))}</button>` : ''}
                    <button type="button" role="tab" aria-selected="false" data-file-view="code">${escapeHtml(tx('fileCode'))}</button>
                </span>
                <button type="button" class="dc-file-btn" data-file-action="expand" title="${escapeHtml(tx('fileExpand'))}" aria-label="${escapeHtml(tx('fileExpand'))}" hidden>⤢</button>
                <button type="button" class="dc-file-btn" data-file-action="download" title="${escapeHtml(tx('fileDownload'))}" aria-label="${escapeHtml(tx('fileDownload'))}">↓</button>
            </div>
            <div class="dc-file-body" hidden></div>`;
        const anchor = row.nextElementSibling?.classList.contains('dc-tool-output') ? row.nextElementSibling : row;
        anchor.insertAdjacentElement('afterend', card);
        if (autoOpen && previewKind) showFileView(card, 'preview');
    }

    async function loadFile(card) {
        if (fileCache.has(card)) return fileCache.get(card);
        const root = card.dataset.root || state.root;
        const id = card.dataset.session || state.agentSessionId;
        const data = await request('GET', `${API}/file/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}&path=${encodeURIComponent(card.dataset.path)}`);
        fileCache.set(card, data);
        const lines = data.content ? data.content.split('\n').length : 0;
        card.querySelector('.dc-file-meta').textContent = `${tx('fileLines', { count: lines })} · ${formatBytes(data.size)}`;
        return data;
    }

    function renderCode(content) {
        const lines = String(content).split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        return `<pre class="dc-file-code"><code>${lines.map(line => `<span class="dc-file-line">${escapeHtml(line) || ' '}</span>`).join('')}</code></pre>`;
    }

    function renderPreview(card, content) {
        const kind = card.dataset.preview;
        if (kind === 'markdown') {
            const render = window.ToolsAIAssistant?.renderMarkdown;
            return `<div class="dc-file-md">${render ? render(content) : renderCode(content)}</div>`;
        }
        return `<iframe class="dc-file-frame" sandbox="allow-scripts allow-forms allow-modals allow-popups" referrerpolicy="no-referrer" title="${escapeHtml(card.dataset.path)}"></iframe><div class="dc-file-hint">${escapeHtml(tx('fileSandboxHint'))}</div>`;
    }

    async function showFileView(card, view) {
        const body = card.querySelector('.dc-file-body');
        const tabs = card.querySelectorAll('[data-file-view]');
        // 再次点击当前标签：收起
        if (card.dataset.view === view && !body.hidden) {
            body.hidden = true;
            card.dataset.view = '';
            toggleExpand(card, false);
            tabs.forEach(tab => tab.setAttribute('aria-selected', 'false'));
            card.querySelector('[data-file-action="expand"]').hidden = true;
            return;
        }
        card.dataset.view = view;
        tabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.fileView === view)));
        body.hidden = false;
        body.innerHTML = `<div class="dc-file-status">${escapeHtml(tx('fileLoading'))}</div>`;
        let data;
        try {
            data = await loadFile(card);
        } catch (error) {
            if (card.dataset.view === view) body.innerHTML = `<div class="dc-file-status is-error">${escapeHtml(error.message)}</div>`;
            return;
        }
        if (card.dataset.view !== view) return;
        body.innerHTML = view === 'preview' ? renderPreview(card, data.content) : renderCode(data.content);
        const frame = body.querySelector('iframe');
        if (frame) {
            frame.srcdoc = card.dataset.preview === 'svg'
                ? `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}body{display:grid;place-items:center;background:#fff}svg{max-width:100%;max-height:100vh}</style>${data.content}`
                : data.content;
        }
        card.querySelector('[data-file-action="expand"]').hidden = false;
    }

    function downloadFile(card) {
        loadFile(card).then(data => {
            const url = URL.createObjectURL(new Blob([data.content], { type: 'application/octet-stream' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = baseName(card.dataset.path);
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }).catch(error => toast(error.message));
    }

    const expandHomes = new WeakMap();
    function toggleExpand(card, force) {
        const expanded = force ?? !card.classList.contains('is-expanded');
        if (expanded === card.classList.contains('is-expanded')) return;
        // 消息气泡带入场动画的 transform，会困住 position:fixed；放大时把卡片临时挂到 body，还原时放回原位
        if (expanded) {
            const home = document.createComment('dc-file-card');
            card.replaceWith(home);
            expandHomes.set(card, home);
            document.body.appendChild(card);
        } else {
            const home = expandHomes.get(card);
            if (home?.isConnected) home.replaceWith(card); else card.remove();
            expandHomes.delete(card);
        }
        card.classList.toggle('is-expanded', expanded);
        document.body.classList.toggle('dc-file-expanded', Boolean(document.querySelector('.dc-file-card.is-expanded')));
        const button = card.querySelector('[data-file-action="expand"]');
        const label = tx(expanded ? 'fileCollapse' : 'fileExpand');
        button.textContent = expanded ? '⤡' : '⤢';
        button.title = label;
        button.setAttribute('aria-label', label);
    }

    function handleEvent(messageEl, event, sourceWorkspace) {
        if (!messageEl || !event) return;
        if (event.type === 'tool_start') {
            const row = document.createElement('div');
            row.className = 'dc-tool-row is-running';
            row.innerHTML = `<span class="dc-tool-icon" aria-hidden="true">${toolIcon(event.tool)}</span><span class="dc-tool-name">${escapeHtml(tx(`tool_${event.tool}`))}</span><span class="dc-tool-args" title="${escapeHtml(describeArgs(event.tool, event.args))}">${escapeHtml(describeArgs(event.tool, event.args))}</span><span class="dc-tool-state"><i class="dc-tool-spin" aria-hidden="true"></i></span>`;
            if (FILE_TOOLS.has(event.tool) && event.args?.path) row.dataset.filePath = event.args.path;
            toolLogFor(messageEl).appendChild(row);
            toolRows.set(event.callId, row);
            messageEl.querySelector('.dc-thinking')?.remove();
        } else if (event.type === 'tool_result') {
            const row = toolRows.get(event.callId);
            if (!row) return;
            row.classList.remove('is-running');
            row.classList.add(event.ok ? 'is-ok' : 'is-fail');
            row.querySelector('.dc-tool-state').innerHTML = `${event.ok ? '✓' : '✗'} <span>${escapeHtml(event.summary || '')}</span>${event.durationMs > 1500 ? ` <small>${(event.durationMs / 1000).toFixed(1)}s</small>` : ''}`;
            // 命令输出：折叠在工具行下方，需要时展开查看
            if (event.output) row.insertAdjacentHTML('afterend', `<details class="dc-tool-output"><summary>${escapeHtml(tx('toolOutput'))}</summary><pre>${escapeHtml(event.output)}</pre></details>`);
            // 写入 / 编辑成功：挂文件卡片，可在对话内预览或看代码；实时生成的 HTML/SVG/Markdown 直接展开预览
            if (event.ok && row.dataset.filePath) attachFileCard(row, row.dataset.filePath, !replaying);
        } else if (event.type === 'approval') {
            renderApproval(messageEl, event);
        } else if (event.type === 'approval_result') {
            const card = approvalCards.get(event.callId);
            if (card) settleCard(card, event.decision);
        } else if (event.type === 'change') {
            if (sourceWorkspace && (sourceWorkspace.root !== state.root || sourceWorkspace.agentSessionId !== state.agentSessionId)) return;
            const index = state.changes.findIndex(item => item.path === event.path);
            const entry = { path: event.path, kind: event.kind, added: event.added, removed: event.removed, from: event.from, revertible: event.revertible !== false, source: event.source || 'agent' };
            if (index >= 0) state.changes[index] = entry; else state.changes.unshift(entry);
            renderChanges();
        }
    }

    function renderApproval(messageEl, event) {
        const card = document.createElement('div');
        card.className = 'dc-approval';
        card.dataset.approvalId = event.id;
        const preview = event.preview || {};
        const kindLabel = tx(`tool_${event.tool}`);
        let detail = '';
        if (preview.command) detail = `<pre class="dc-approval-cmd"><span class="dc-approval-prompt">$</span> ${escapeHtml(preview.command)}</pre><div class="dc-approval-cwd">${escapeHtml(tx('inDir'))} ${escapeHtml(shorten(preview.cwd || state.root))}</div>`;
        // 风险命令（访问目录外 / 主目录 / 密钥文件）：写明原因，且不提供「总是允许」
        const risk = Array.isArray(preview.risk) && preview.risk.length ? preview.risk : null;
        if (risk) detail += `<div class="dc-approval-risk"><b>⚠️ ${escapeHtml(tx('riskTitle'))}</b><ul>${risk.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>`;
        else if (preview.diff) detail = `<details class="dc-approval-diff" open><summary>${escapeHtml(preview.path || '')} <span class="wsp-add">+${preview.added || 0}</span> <span class="wsp-del">−${preview.removed || 0}</span></summary><pre class="wsp-diff">${renderDiff(preview.diff)}</pre></details>`;
        else if (preview.to) detail = `<div class="dc-approval-path">${escapeHtml(preview.path)} → ${escapeHtml(preview.to)}</div>`;
        else if (preview.path) detail = `<div class="dc-approval-path">${escapeHtml(preview.path)}${preview.recursive ? ` <em>(${escapeHtml(tx('recursive'))})</em>` : ''}</div>`;
        else if (preview.message) detail = `<div class="dc-approval-path">${escapeHtml(preview.channel || '')} → ${escapeHtml(preview.targets || '')}</div><pre class="dc-approval-cmd">${escapeHtml(preview.message)}</pre>`;
        card.innerHTML = `
            <div class="dc-approval-head"><span class="dc-approval-icon" aria-hidden="true">${toolIcon(event.tool)}</span><b>${escapeHtml(tx('approvalTitle', { tool: kindLabel }))}</b></div>
            ${detail}
            <div class="dc-approval-actions">
                <button type="button" class="dc-action dc-action--primary" data-decision="allow">${escapeHtml(tx('allow'))}</button>
                ${risk ? '' : `<button type="button" class="dc-action" data-decision="always">${escapeHtml(tx('alwaysAllow'))}</button>`}
                <button type="button" class="dc-action dc-action--danger" data-decision="deny">${escapeHtml(tx('deny'))}</button>
            </div>
            <div class="dc-approval-status" hidden></div>`;
        card.addEventListener('click', async clickEvent => {
            const button = clickEvent.target.closest('[data-decision]');
            if (!button || card.classList.contains('is-settled')) return;
            card.querySelectorAll('[data-decision]').forEach(node => { node.disabled = true; });
            try {
                await request('POST', `${API}/approvals/${encodeURIComponent(event.id)}`, { decision: button.dataset.decision });
                settleCard(card, button.dataset.decision);
            } catch (error) {
                card.querySelectorAll('[data-decision]').forEach(node => { node.disabled = false; });
                toast(error.message);
            }
        });
        approvalCards.set(event.callId, card);
        toolLogFor(messageEl).appendChild(card);
        messageEl.querySelector('.dc-thinking')?.remove();
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        card.querySelector('[data-decision="allow"]').focus({ preventScroll: true });
    }

    function settleCard(card, decision) {
        card.classList.add('is-settled', `is-${decision}`);
        card.querySelector('.dc-approval-actions').hidden = true;
        const status = card.querySelector('.dc-approval-status');
        status.hidden = false;
        status.textContent = { allow: tx('approved'), always: tx('approvedAlways'), deny: tx('denied'), timeout: tx('approvalTimeout'), abort: tx('approvalAborted') }[decision] || decision;
    }

    function finishMessage(messageEl) {
        messageEl?.querySelectorAll('.dc-tool-row.is-running').forEach(row => {
            row.classList.remove('is-running');
            row.classList.add('is-fail');
            row.querySelector('.dc-tool-state').innerHTML = `— <span>${escapeHtml(tx('toolInterrupted'))}</span>`;
        });
        messageEl?.querySelectorAll('.dc-approval:not(.is-settled)').forEach(card => settleCard(card, 'abort'));
    }

    function applyDone(data) {
        if (!data) return;
        if (data.agentSessionId && data.agentSessionId !== state.agentSessionId) return;
        if (data.agent?.root && data.agent.root !== state.root) return;
        if (data.context) state.context = data.context;
        if (Array.isArray(data.changes)) state.changes = data.changes.map(item => ({ ...item, source: item.source || 'agent' }));
        if (data.agent?.gitBranch !== undefined) state.gitBranch = data.agent.gitBranch || state.gitBranch;
        renderContext();
        renderChanges();
        renderEnv();
        refreshChanges(); // 合并 git 工作区里的其他改动
    }

    // ── 事件绑定 ────────────────────────────────────────
    function bind() {
        document.addEventListener('click', event => {
            const action = event.target.closest('[data-wsp-action]');
            if (action && (el.panel.contains(action) || el.chip?.contains(action))) {
                if (action.dataset.wspAction === 'change') openPicker();
                else if (action.dataset.wspAction === 'clear') clearDirectory();
                else if (action.dataset.wspAction === 'panel') setOpen(!state.open);
                return;
            }
            const select = event.target.closest('[data-wsp-select]');
            if (select && (el.panel.contains(select) || el.chip?.contains(select))) {
                selectDirectory(select.dataset.wspSelect).catch(error => toast(error.message));
                return;
            }
            const mode = event.target.closest('[data-wsp-mode]');
            if (mode) return setMode(mode.dataset.wspMode);
            const diff = event.target.closest('[data-wsp-diff]');
            if (diff) return toggleDiff(diff.dataset.wspDiff);
            const revertBtn = event.target.closest('[data-wsp-revert]');
            if (revertBtn) return revert(revertBtn.dataset.wspRevert);
            const prBtn = event.target.closest('[data-wsp-pr]');
            if (prBtn && el.panel.contains(prBtn)) {
                if (prBtn.dataset.wspPr === 'start') startPr();
                else if (prBtn.dataset.wspPr === 'abort') abortPr();
                else if (prBtn.dataset.wspPr === 'close') closePr();
                return;
            }
            const fileCard = event.target.closest('.dc-file-card');
            if (fileCard) {
                const viewBtn = event.target.closest('[data-file-view]');
                const actionBtn = event.target.closest('[data-file-action]');
                if (viewBtn) showFileView(fileCard, viewBtn.dataset.fileView);
                else if (actionBtn?.dataset.fileAction === 'expand') toggleExpand(fileCard);
                else if (actionBtn?.dataset.fileAction === 'download') downloadFile(fileCard);
                return;
            }
            const head = event.target.closest('.wsp-card-head');
            if (head && el.panel.contains(head)) {
                const card = head.closest('.wsp-card');
                const open = !card.classList.contains('is-open');
                card.classList.toggle('is-open', open);
                head.setAttribute('aria-expanded', String(open));
            }
        });
        document.addEventListener('submit', event => {
            const form = event.target.closest('[data-wsp-pr-form]');
            if (!form || !el.panel.contains(form)) return;
            event.preventDefault();
            submitPr(form);
        });
        el.toggle?.addEventListener('click', () => setOpen(!state.open));
        el.fab?.addEventListener('click', () => setOpen(!state.open));
        el.close.addEventListener('click', () => setOpen(false));
        // 窄屏抽屉：点工作区以外的遮罩或按 Esc 收起（遮罩拦截这次点击，不会误触底下的内容）
        el.backdrop.addEventListener('click', () => setOpen(false));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && state.open && el.picker.hidden && isDrawerMode()) setOpen(false);
        });

        // 目录选择器
        el.pickerClose.addEventListener('click', closePicker);
        el.picker.addEventListener('click', event => {
            if (event.target === el.picker) closePicker();
            const fill = event.target.closest('[data-wsp-fill]');
            if (fill) {
                el.pickerInput.value = fill.dataset.wspFill;
                el.pickerInput.focus();
                suggest(true);
                return;
            }
            const item = event.target.closest('[data-wsp-index]');
            if (item) {
                state.picker.active = Number(item.dataset.wspIndex);
                completeActive();
            }
        });
        el.pickerInput.addEventListener('input', scheduleSuggest);
        el.pickerHidden.addEventListener('change', () => suggest(true));
        el.pickerClear.addEventListener('click', () => { el.pickerInput.value = ''; el.pickerInput.focus(); suggest(true); });
        el.pickerSelect.addEventListener('click', () => confirmPicker());
        el.pickerInput.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(state.picker.active + 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(state.picker.active - 1); }
            else if (event.key === 'Tab' || (event.key === 'ArrowRight' && el.pickerInput.selectionStart === el.pickerInput.value.length)) {
                if (state.picker.items.length) { event.preventDefault(); completeActive(); }
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (state.picker.exists && state.picker.isDir) confirmPicker();
                else if (state.picker.items.length) completeActive();
            } else if (event.key === 'Escape') { event.preventDefault(); closePicker(); }
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !el.picker.hidden) closePicker();
            else if (event.key === 'Escape') document.querySelectorAll('.dc-file-card.is-expanded').forEach(card => toggleExpand(card, false));
        });
        window.addEventListener('tools:languagechange', renderAll);
    }

    async function init() {
        el.panel = document.getElementById('dcWorkspacePanel');
        if (!el.panel) return;
        el.envBody = document.getElementById('wspEnvBody');
        el.ctxBody = document.getElementById('wspCtxBody');
        el.ctxMeta = document.getElementById('wspCtxMeta');
        el.changesBody = document.getElementById('wspChangesBody');
        el.changesMeta = document.getElementById('wspChangesMeta');
        el.close = document.getElementById('dcWorkspaceClose');
        el.toggle = document.getElementById('dcWorkspaceToggle');
        el.fab = document.getElementById('dcWorkspaceFab');
        el.chip = document.getElementById('dcWorkspaceChip');
        el.picker = document.getElementById('wspDirPicker');
        el.pickerClose = document.getElementById('wspPickerClose');
        el.pickerInput = document.getElementById('wspPickerInput');
        el.pickerClear = document.getElementById('wspPickerClear');
        el.pickerStatus = document.getElementById('wspPickerStatus');
        el.pickerList = document.getElementById('wspPickerList');
        el.pickerRecent = document.getElementById('wspPickerRecent');
        el.pickerHidden = document.getElementById('wspPickerHidden');
        el.pickerSelect = document.getElementById('wspPickerSelect');
        document.body.appendChild(el.picker);
        el.backdrop = document.createElement('div');
        el.backdrop.className = 'wsp-backdrop';
        el.backdrop.setAttribute('aria-hidden', 'true');
        el.panel.before(el.backdrop);
        bind();
        try {
            state.capability = await request('GET', `${API}/capability`);
            state.enabled = state.capability.enabled === true;
        } catch {
            state.enabled = false;
        }
        document.body.classList.toggle('dc-workspace-enabled', state.enabled);
        if (!state.enabled) {
            renderChip();
            return;
        }
        el.toggle.hidden = false;
        el.fab.hidden = false;
        try {
            state.prefs = await request('GET', `${API}/prefs`);
            state.permissionMode = state.prefs.permissionMode || 'ask';
        } catch { /* 偏好读取失败不影响使用 */ }
        state.agentSessionId = sessionStorage.getItem(SESSION_KEY) || newSessionId();
        renderAll();
        let remembered = false;
        try { remembered = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* ignore */ }
        if (remembered && window.innerWidth > 860) setOpen(true);
        // 手动或其他程序改了文件也能看到：回到页面时、面板打开期间每 15 秒刷新一次
        window.addEventListener('focus', refreshChanges);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshChanges(); });
        setInterval(() => { if (state.open && document.visibilityState === 'visible') refreshChanges(); }, 15000);
    }

    window.DragonClawWorkspace = {
        init,
        isEnabled: () => state.enabled,
        hasWorkspace: () => Boolean(state.root),
        getWorkspacePayload() {
            if (!state.enabled || !state.root) return null;
            return { agentSessionId: state.agentSessionId, root: state.root, permissionMode: state.permissionMode };
        },
        // 恢复历史对话：自动选回当时的目录、接回它的智能体会话，并恢复上下文与实际改动。
        // 目录已不存在时提示并保持未选目录，对话照常恢复。
        async resumeWorkspace({ agentSessionId, root } = {}) {
            if (state.pr?.phase === 'running') throw new Error(tx('prRunning'));
            const ticket = ++state.selectionEpoch;
            if (!state.enabled || !agentSessionId || !root) { clearDirectory(); this.resetSession(); return false; }
            if (state.root !== root) {
                try {
                    await selectDirectory(root, ticket);
                } catch {
                    if (ticket !== state.selectionEpoch) return false;
                    clearDirectory();
                    this.resetSession();
                    toast(tx('resumeDirMissing', { name: baseName(root) }));
                    return false;
                }
            }
            if (ticket !== state.selectionEpoch) return false;
            if (!this.adoptSession({ agentSessionId, root: state.root })) return false;
            setOpen(true);
            await restoreState();
            return true;
        },
        refreshChanges,
        // 恢复历史对话时接回它用过的智能体会话（工具转录在服务端按该 id 保存）。
        // 只在未选目录或已选同一目录时接回：带着旧 id 去别的目录会让服务端把旧转录作废。
        adoptSession({ agentSessionId, root } = {}) {
            if (!agentSessionId || !root || (state.root && state.root !== root)) return false;
            if (state.pr?.phase === 'running') return false;
            const id = adoptSessionId(agentSessionId);
            if (!id) return false;
            state.agentSessionId = id;
            try { sessionStorage.setItem(SESSION_ROOT_KEY, root); } catch { /* ignore */ }
            state.changes = [];
            state.openDiff = null;
            state.context = null;
            renderContext();
            renderChanges();
            return true;
        },
        resetSession({ clearWorkspace = false } = {}) {
            if (clearWorkspace) clearDirectory();
            state.selectionEpoch += 1;
            if (state.pr?.phase === 'running') state.pr.controller?.abort();
            state.pr = null;
            prLog.innerHTML = '';
            state.agentSessionId = newSessionId();
            state.changes = [];
            state.openDiff = null;
            state.context = null;
            approvalCards.clear();
            toolRows.clear();
            document.querySelectorAll('.dc-file-card.is-expanded').forEach(card => toggleExpand(card, false));
            renderContext();
            renderChanges();
        },
        handleEvent,
        finishMessage,
        // 恢复历史对话：把入库的工具过程重放成工具行、审批卡（均为已结束状态，不可再操作）
        replayEvents(messageEl, events = []) {
            if (!messageEl || !Array.isArray(events) || !events.length) return;
            const startedRows = [];
            const openCards = new Map();
            replaying = true; // 历史文件卡片默认收起，不批量加载预览
            try {
                for (const event of events) {
                    if (!event || event.type === 'change') continue;
                    handleEvent(messageEl, event);
                    if (event.type === 'tool_start') startedRows.push({ callId: event.callId, row: toolRows.get(event.callId) });
                    if (event.type === 'approval') openCards.set(event.callId, approvalCards.get(event.callId));
                    if (event.type === 'approval_result') openCards.delete(event.callId);
                }
            } finally {
                replaying = false;
            }
            // 中途停止的轮次：未完成的工具行与审批卡标为已中止
            startedRows.forEach(({ row }) => {
                if (!row || !row.classList.contains('is-running')) return;
                row.classList.remove('is-running');
                row.classList.add('is-fail');
                row.querySelector('.dc-tool-state').innerHTML = `— <span>${escapeHtml(tx('toolInterrupted'))}</span>`;
            });
            openCards.forEach(card => { if (card && !card.classList.contains('is-settled')) settleCard(card, 'abort'); });
            messageEl.querySelectorAll('.dc-approval').forEach(card => card.classList.add('is-history'));
        },
        applyDone,
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!state.open),
        openPicker,
        refreshTexts: renderAll
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
