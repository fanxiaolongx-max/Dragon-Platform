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
        suspendedBy: new Set(),   // 正在显示的非对话页面（hub / tool），期间工作区隐藏
        selectionEpoch: 0,
        capability: null,
        prefs: { lastDirectory: '', recentDirectories: [], permissionMode: 'ask' },
        root: '',
        rootName: '',
        gitBranch: '',
        gitInfo: null,
        gitRequest: 0,
        gitSaving: false,
        permissionMode: 'ask',
        agentSessionId: '',
        context: null,
        changes: [],
        openDiff: null,
        diffNotes: [],
        diffEditor: null,
        expandChanges: false,
        pr: null, // { phase: 'checking'|'blocked'|'form'|'running'|'done'|'failed', preflight, steps, url, error, controller }
        open: false,
        filePreview: null,
        external: null, // { previousOpen }：显示外部卡片（WeLink 跟进与记忆）时隐藏环境/上下文/更改
        picker: { items: [], active: -1, timer: null, requestId: 0 },
        sharedWorkspace: null // 非原归属人协作共享对话时的锁定工作目录元数据
    };
    const isSharedLocked = () => Boolean(state.sharedWorkspace?.enabled && !state.sharedWorkspace.isOwner);
    const effectiveRoot = () => (isSharedLocked() ? (state.sharedWorkspace.virtualRoot || '') : state.root);
    const sharedLockedMessage = () => {
        const ownerName = state.sharedWorkspace?.ownerName || state.sharedWorkspace?.owner || '';
        const folderName = state.sharedWorkspace?.folderName || '';
        return wsLabel(
            `已自动挂载「${ownerName}」的共享目录 ${folderName}（成员不可切换；可协作读写与上传文件，需要终端命令时将自动启用隔离沙箱智能体）`,
            `Mounted shared workspace "${folderName}" from ${ownerName} (locked; read/write & uploads allowed, shell commands run in isolated sandbox)`
        );
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

    // Latest reply only: loading older history must not overwrite the current reply's counters.
    let performanceMessage = null, performanceRounds = [], performanceManual = false;
    function updatePerformance(message, rounds = [], { running = false } = {}) {
        if (!el.performanceCard || !message) return;
        if (performanceMessage?.isConnected && message !== performanceMessage && (message.compareDocumentPosition(performanceMessage) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
        if (performanceMessage !== message) performanceManual = false;
        performanceMessage = message;
        performanceRounds = Array.isArray(rounds) ? rounds : [];
        if (!performanceManual) {
            el.performanceCard.classList.toggle('is-open', running);
            el.performanceCard.querySelector('button').setAttribute('aria-expanded', String(running));
        }
        renderPerformance();
    }
    function renderPerformance() {
        if (!el.performanceCard) return;
        const en = (localStorage.getItem('tools_lang') || document.documentElement.lang).startsWith('en');
        const label = (zh, english) => en ? english : zh;
        const rounds = performanceRounds;
        const valid = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
        const sum = key => rounds.reduce((n, r) => n + (valid(r[key]) ? r[key] : 0), 0);
        const timed = rounds.filter(r => valid(r.ttftMs));
        const decoded = rounds.filter(r => !r.estimated && r.timingSource === 'request-stream' && r.tps > 0 && r.generationMs > 0 && valid(r.decodeTokens));
        const cache = rounds.filter(r => !r.estimated && valid(r.cachedInputTokens) && r.inputTokens > 0 && r.cachedInputTokens <= r.inputTokens);
        const cacheInput = cache.reduce((n,r) => n+r.inputTokens,0);
        const duration = sum('ms');
        const exact = rounds.length && rounds.every(r => !r.estimated);
        const cells = [
            [label('模型调用','Model calls'), rounds.length || '—'],
            [label('输入 Token','Input tokens'), rounds.length ? formatTokens(sum('inputTokens')) : '—'],
            [label('输出 Token','Output tokens'), rounds.length ? formatTokens(sum('outputTokens')) : '—'],
            [label('首字延迟 · 调用均值','First text · call average'), timed.length ? (timed.reduce((n,r)=>n+r.ttftMs,0)/timed.length/1000).toFixed(2)+' s' : '—'],
            [label('纯输出流速','Decode rate'), decoded.length ? (decoded.reduce((n,r)=>n+r.decodeTokens,0)*1000/decoded.reduce((n,r)=>n+r.generationMs,0)).toFixed(1)+' tok/s' : '—'],
            [label('缓存读取占比','Cache read ratio'), cacheInput ? (cache.reduce((n,r)=>n+r.cachedInputTokens,0)/cacheInput*100).toFixed(1)+'%' : '—'],
            [label('调用处理吞吐','Call processing throughput'), exact && duration > 0 ? formatTokens((sum('inputTokens')+sum('outputTokens'))*1000/duration)+' tok/s' : '—'],
            [label('已完成调用用时','Completed call time'), duration > 0 ? (duration/1000).toFixed(1)+' s' : '—']
        ];
        el.performanceCard.querySelector('[data-performance-title]').textContent = label('本轮模型统计','Latest reply metrics');
        el.performanceCard.querySelector('.wsp-card-meta').textContent = rounds.length ? String(rounds.length) : '';
        el.performanceCard.querySelector('.wsp-card-body').innerHTML = '<div class="wsp-performance-grid">'+cells.map(([name,value])=>`<div><small>${escapeHtml(name)}</small><strong>${escapeHtml(value)}</strong></div>`).join('')+'</div><p class="wsp-performance-note">'+escapeHtml(label('仅统计本轮已完成的模型调用；— 表示未提供。首字延迟包含网络与排队；吞吐含输入及缓存，按各调用耗时累加计算，不代表纯输出速度。估算用量不参与吞吐与解码统计。','Completed model calls in the latest reply only; — means unavailable. First text includes network and queueing. Throughput includes input and cache, divided by summed call durations. Estimated usage is excluded from throughput and decode.'))+'</p>';
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
    // remember=false：自动收起 / 自动展开（打开工具、切到无关对话等），不改用户记住的开关
    function setOpen(open, { remember = true } = {}) {
        if (!open && state.filePreview) { window.ChatFiles?.closePreview(); return; }
        if (open) { window.DragonBrowserSidebar?.close(); window.DragonTerminalSidebar?.close?.(); }
        state.open = Boolean(open) && (state.enabled || Boolean(state.external) || Boolean(state.filePreview));
        el.toggle?.setAttribute('aria-pressed', String(state.open));
        el.fab?.setAttribute('aria-pressed', String(state.open));
        try { if (!state.filePreview && remember) localStorage.setItem(PANEL_KEY, state.open ? '1' : '0'); } catch { /* ignore */ }
        applyVisibility();
    }

    // 工作区只属于对话：技能中心、工具页等非对话页面打开期间整块隐藏（连同借用面板的频道卡片），
    // 开关与内容原样保留，回到对话时显示该对话自己的工作区。
    function applyVisibility() {
        const visible = state.open && state.suspendedBy.size === 0;
        document.body.classList.toggle('dc-workspace-open', visible);
        el.panel.hidden = !visible;
        if (visible) requestAnimationFrame(() => { if (el.panel && !el.panel.hidden) el.panel.classList.add('is-drawer-open'); });
        else el.panel.classList.remove('is-drawer-open');
    }
    function suspendFor(view, active) {
        if (active) state.suspendedBy.add(view); else state.suspendedBy.delete(view);
        applyVisibility();
    }

    function isDrawerMode() {
        return window.matchMedia('(max-width: 860px)').matches;
    }

    function isReadOnly() {
        return Boolean(state.capability?.readOnly);
    }

    // 线性文件夹图标（currentColor），替代 📁 / 📂 表情，跟随亮色 / 深色主题
    const FOLDER_ICON = '<svg class="wsp-folder-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/></svg>';
    const FOLDER_PLUS_ICON = '<svg class="wsp-folder-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5Z"/><path d="M8 7v4M6 9h4"/></svg>';

    // ── 环境卡 ──────────────────────────────────────────
    function renderEnv() {
        if (isSharedLocked()) {
            const ownerName = state.sharedWorkspace?.ownerName || state.sharedWorkspace?.owner || '';
            const folderName = state.sharedWorkspace?.folderName || wsLabel('共享工作区', 'Shared workspace');
            el.envBody.innerHTML = `
                <div class="wsp-dir is-shared-locked">
                    <div class="wsp-dir-main">
                        <span class="wsp-dir-icon" aria-hidden="true">${FOLDER_ICON}</span>
                        <div class="wsp-dir-text">
                            <b title="${escapeHtml(folderName)}">🔗 ${escapeHtml(ownerName)} · ${escapeHtml(folderName)}</b>
                            <small>${escapeHtml(wsLabel('共享对话逻辑挂载（不可切换）', 'Remote shared workspace (locked)'))}</small>
                        </div>
                    </div>
                </div>
                <div class="wsp-row wsp-row-col">
                    <span class="wsp-row-label">${escapeHtml(tx('permission'))}</span>
                    <div class="wsp-readonly">
                        <b>🔒 ${escapeHtml(wsLabel('可协同读写与上传 · 隔离沙箱命令', 'Collaborative R/W & Uploads · Sandboxed Shell'))}</b>
                        <small>${escapeHtml(wsLabel('可直接读写共享目录文件；上传文件会保存至发起者目录的 shared-uploads/；原目录禁用直接终端命令，需要时将自动新建个人隔离沙箱子智能体执行。', 'File tools operate on the shared directory. Uploads are saved to shared-uploads/. Shell commands run in an isolated per-member sandbox subagent.'))}</small>
                    </div>
                </div>`;
            return;
        }
        const dir = state.root
            ? `<div class="wsp-dir">
                    <div class="wsp-dir-main">
                        <span class="wsp-dir-icon" aria-hidden="true">${FOLDER_ICON}</span>
                        <div class="wsp-dir-text">
                            <b title="${escapeHtml(toDisplayPath(state.root))}">${escapeHtml(state.rootName)}</b>
                            <small title="${escapeHtml(toDisplayPath(state.root))}">${escapeHtml(toDisplayPath(state.root))}</small>
                        </div>
                    </div>
                    <div class="wsp-dir-actions">
                        <button type="button" class="wsp-btn" data-wsp-action="change">${escapeHtml(tx('changeDir'))}</button>
                        <button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-action="clear" title="${escapeHtml(tx('clearDir'))}">×</button>
                    </div>
               </div>
               <div class="wsp-row"><span class="wsp-row-label">${escapeHtml(tx('branch'))}</span><span class="wsp-branch">${state.gitBranch ? `<i aria-hidden="true">⎇</i> ${escapeHtml(state.gitBranch)}` : `<em>${escapeHtml(tx('noBranch'))}</em>`}</span></div>`
            : `<button type="button" class="wsp-dir-empty" data-wsp-action="change">
                    <span class="wsp-dir-empty-icon" aria-hidden="true">${FOLDER_PLUS_ICON}</span>
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
        const worktreeBar = state.root && state.gitInfo?.git && state.gitInfo?.isWorktree && !isReadOnly()
            ? (() => {
                const info = state.gitInfo;
                const currentWt = (info.worktrees || []).find(w => w.current) || {};
                const ahead = currentWt.ahead || 0;
                const mainTarget = (info.worktrees || [])[0]?.branch || 'main';
                const statusBits = [
                    ahead ? wsLabel(`领先 ${ahead} 个提交`, `${ahead} ahead`) : '',
                    info.dirty ? wsLabel('有未提交改动', 'uncommitted changes') : wsLabel('工作区干净', 'clean')
                ].filter(Boolean).join(' · ');
                return `<div class="wsp-worktree-bar">
                    <div class="wsp-worktree-meta"><b>Worktree</b><span>${escapeHtml(statusBits)}</span></div>
                    <div class="wsp-worktree-actions">
                        ${info.dirty ? `<button type="button" class="wsp-btn" data-wsp-action="commit-worktree">${wsLabel('提交改动', 'Commit')}</button>` : ''}
                        <button type="button" class="wsp-btn wsp-btn-primary" data-wsp-action="merge-worktree" title="${escapeHtml(wsLabel(`合并回 ${mainTarget}`, `Merge into ${mainTarget}`))}">${wsLabel(`合并回 ${mainTarget}`, `Merge → ${mainTarget}`)}</button>
                        <button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-action="remove-worktree" title="${escapeHtml(wsLabel('移除此 Worktree', 'Remove worktree'))}">${wsLabel('移除', 'Remove')}</button>
                        ${info.mainRoot ? `<button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-select="${escapeHtml(info.mainRoot)}" title="${escapeHtml(wsLabel('切换回主仓库目录', 'Switch to main repo'))}">${wsLabel('回主仓', 'Main')}</button>` : ''}
                    </div>
                </div>`;
            })()
            : '';
        el.envBody.innerHTML = `
            ${dir}
            ${worktreeBar}
            <div class="wsp-row wsp-row-col">
                <span class="wsp-row-label">${escapeHtml(tx('permission'))}</span>
                ${permission}
            </div>
            ${recent.length ? `<div class="wsp-row wsp-row-col">
                <span class="wsp-row-label">${escapeHtml(tx('recentDirs'))}</span>
                <div class="wsp-recent">${recent.map(item => `<button type="button" class="wsp-recent-item" data-wsp-select="${escapeHtml(item)}" title="${escapeHtml(toDisplayPath(item))}"><span class="wsp-recent-icon" aria-hidden="true">${FOLDER_ICON}</span><span>${escapeHtml(baseName(item))}</span><i>${escapeHtml(shorten(toDisplayPath(item)))}</i></button>`).join('')}</div>
            </div>` : ''}`;
    }

    function baseName(fullPath) {
        const parts = String(fullPath).replace(/[\\/]+$/, '').split(/[\\/]/);
        return parts[parts.length - 1] || fullPath;
    }

    function toDisplayPath(fullPath) {
        const text = String(fullPath || '');
        if (!text || !state.capability?.confined) return text;
        const home = String(state.capability?.homeDir || '').replace(/[\\/]+$/, '');
        if (!home) return text;
        if (text === home) return '~';
        if (text.startsWith(`${home}/`) || text.startsWith(`${home}\\`)) return `~${text.slice(home.length)}`;
        return text;
    }

    function shorten(fullPath) {
        const home = String(state.capability?.homeDir || '').replace(/[\\/]+$/, '');
        let text = String(fullPath);
        if (home && (text === home || text.startsWith(`${home}/`) || text.startsWith(`${home}\\`))) {
            text = `~${text.slice(home.length)}` || '~';
        }
        return text.length > 42 ? `…${text.slice(-40)}` : text;
    }

    // ── 上下文卡 ────────────────────────────────────────
    function renderContext() {
        const ctx = state.context;
        if (!ctx) {
            renderContextMini(null);
            el.ctxBody.innerHTML = `<div class="wsp-empty">${escapeHtml(tx(state.root ? 'ctxEmpty' : 'ctxNoWorkspace'))}</div>`;
            return;
        }
        // 旧会话存档里没有的分项（skills、toolResults、reserve）不显示
        const order = ['messages', 'toolResults', 'directory', 'system', 'skills', 'tools', 'reserve', 'free'].filter(key => key in ctx.parts);
        const colors = { messages: '#60a5fa', toolResults: '#22d3ee', directory: '#64ffda', system: '#a78bfa', skills: '#f472b6', tools: '#f59e0b', reserve: 'rgba(148,163,184,0.42)', free: 'rgba(148,163,184,0.18)' };
        const total = Math.max(1, ctx.windowTokens || 1);
        const percent = Math.min(100, Math.round((ctx.usedTokens / total) * 100));
        renderContextMini({ percent, label: `${tx('ctxUsed', { percent })} · ${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.windowTokens)}` });
        el.ctxBody.innerHTML = `
            <div class="wsp-ctx-head"><span>${escapeHtml(tx('ctxUsed', { percent }))}</span><span>${formatTokens(ctx.usedTokens)} / ${formatTokens(ctx.windowTokens)}</span></div>
            <div class="wsp-ctx-bar" role="img" aria-label="${escapeHtml(tx('ctxUsed', { percent }))}">
                ${order.map(key => `<i style="flex-basis:${((ctx.parts[key] || 0) / total * 100).toFixed(2)}%;background:${colors[key]}" title="${escapeHtml(tx(`ctx${key[0].toUpperCase()}${key.slice(1)}`))}"></i>`).join('')}
            </div>
            <ul class="wsp-ctx-legend">
                ${order.map(key => `<li><i style="background:${colors[key]}"></i><span>${escapeHtml(tx(`ctx${key[0].toUpperCase()}${key.slice(1)}`))}</span><b>${formatTokens(ctx.parts[key] || 0)}</b><em>${((ctx.parts[key] || 0) / total * 100).toFixed(1)}%</em></li>`).join('')}
            </ul>
            ${ctx.tools?.deferred ? `<div class="wsp-ctx-cache">${escapeHtml(tx('ctxDeferredTools', { loaded: ctx.tools.loaded, count: ctx.tools.deferred, tokens: formatTokens(ctx.tools.deferredTokens) }))}</div>` : ''}
            ${ctx.cache ? `<div class="wsp-ctx-cache">${escapeHtml(ctx.cache.cachedTokens > 0 ? tx('ctxCache', { percent: Math.round(ctx.cache.hitRate * 100), tokens: formatTokens(ctx.cache.cachedTokens) }) : tx('ctxCacheNone'))}</div>` : ''}
            <div class="wsp-ctx-note">${escapeHtml(tx(ctx.source === 'provider' ? 'ctxSourceProvider' : 'ctxSourceEstimate'))}${ctx.windowSource ? ` · ${escapeHtml(tx(ctx.windowSource === 'configured' ? 'ctxWindowConfigured' : 'ctxWindowModel'))}` : ''}</div>`;
    }

    // 卡头上的占用：收起时显示迷你进度条 + 百分比，展开时只留百分比（明细条在卡内）。
    // 元素常驻、只改宽度和数字，占用变化时进度条平滑过渡、数字滚动到新值；接近自动压缩线（80%）时变色。
    let ctxMini = null;
    function renderContextMini(info) {
        if (!info) {
            if (ctxMini) cancelAnimationFrame(ctxMini.frame);
            ctxMini = null;
            el.ctxMeta.textContent = '';
            return;
        }
        if (!ctxMini || !el.ctxMeta.contains(ctxMini.root)) {
            if (ctxMini) cancelAnimationFrame(ctxMini.frame);
            el.ctxMeta.innerHTML = '<span class="wsp-ctx-mini"><span class="wsp-ctx-mini-track" aria-hidden="true"><i></i></span><b>0%</b></span>';
            const root = el.ctxMeta.firstElementChild;
            ctxMini = { root, fill: root.querySelector('i'), num: root.querySelector('b'), shown: 0, frame: 0 };
        }
        const mini = ctxMini;
        const { root, fill, num } = mini;
        const percent = Math.max(0, Math.min(100, info.percent));
        root.dataset.level = percent >= 75 ? 'high' : percent >= 60 ? 'warn' : 'ok';
        root.title = info.label;
        root.setAttribute('aria-label', info.label);
        requestAnimationFrame(() => { fill.style.width = `${percent}%`; });
        cancelAnimationFrame(ctxMini.frame);
        const from = ctxMini.shown;
        if (from === percent || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            ctxMini.shown = percent;
            num.textContent = `${percent}%`;
            return;
        }
        const started = performance.now();
        const step = now => {
            if (ctxMini !== mini) return;
            const t = Math.min(1, (now - started) / 450);
            ctxMini.shown = Math.round(from + (percent - from) * (1 - (1 - t) ** 3));
            num.textContent = `${ctxMini.shown}%`;
            if (t < 1) ctxMini.frame = requestAnimationFrame(step);
        };
        ctxMini.frame = requestAnimationFrame(step);
    }

    // ── 更改卡 ──────────────────────────────────────────
    const CHANGES_COLLAPSE_THRESHOLD = 8;
    function renderChanges() {
        const list = state.changes || [];
        const added = list.reduce((sum, item) => sum + (item.added || 0), 0);
        const removed = list.reduce((sum, item) => sum + (item.removed || 0), 0);
        el.changesMeta.innerHTML = list.length ? `<span class="wsp-add">+${added}</span> <span class="wsp-del">−${removed}</span>` : '';
        if (!list.length) {
            el.changesBody.innerHTML = `<div class="wsp-empty">${escapeHtml(tx('noChanges'))}</div>`;
            return;
        }
        // 如果打开的 diff 在折叠范围之外，自动展开以保持 diff 可见
        if (state.openDiff && list.findIndex(item => item.path === state.openDiff.path) >= CHANGES_COLLAPSE_THRESHOLD) {
            state.expandChanges = true;
        }
        const isFolded = list.length > CHANGES_COLLAPSE_THRESHOLD && !state.expandChanges;
        const visibleList = isFolded ? list.slice(0, CHANGES_COLLAPSE_THRESHOLD) : list;
        const kindLabel = { create: 'A', modify: 'M', delete: 'D', rename: 'R' };
        el.changesBody.innerHTML = `
            <ul class="wsp-changes">
                ${visibleList.map(item => `
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
                        ${state.openDiff?.path === item.path ? `<div class="wsp-diff">${renderDiff(state.openDiff.text, item.path)}</div>` : ''}
                    </li>`).join('')}
                ${list.length > CHANGES_COLLAPSE_THRESHOLD ? `
                    <li class="wsp-changes-fold">
                        <button type="button" class="wsp-changes-more" data-wsp-changes-toggle="${state.expandChanges ? 'collapse' : 'expand'}">
                            <span class="wsp-changes-more-arrow">${state.expandChanges ? '▲' : '▼'}</span>
                            <span>${escapeHtml(state.expandChanges ? tx('changesShowLess') : tx('changesShowMore', { count: list.length - CHANGES_COLLAPSE_THRESHOLD }))}</span>
                        </button>
                    </li>` : ''}
            </ul>
            ${renderDiffNotesBar()}
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

    function parseDiffLines(text) {
        const rows = [];
        let oldNo = 0, newNo = 0, hunk = '';
        String(text || '').split('\n').forEach((line, idx) => {
            const hMatch = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)$/.exec(line);
            if (hMatch) {
                oldNo = Number(hMatch[1]) || 1;
                newNo = Number(hMatch[2]) || 1;
                hunk = line;
                rows.push({ idx, line, kind: 'hunk', oldNum: '', newNum: '', lineKey: '', annotatable: false, hunk });
                return;
            }
            if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) {
                rows.push({ idx, line, kind: 'meta', oldNum: '', newNum: '', lineKey: '', annotatable: false, hunk });
                return;
            }
            if (line.startsWith('+')) {
                const lineNum = newNo++;
                rows.push({ idx, line, kind: 'add', oldNum: '', newNum: lineNum, lineKey: `new:${lineNum}:${idx}`, side: 'new', lineNum, annotatable: true, hunk });
                return;
            }
            if (line.startsWith('-')) {
                const lineNum = oldNo++;
                rows.push({ idx, line, kind: 'del', oldNum: lineNum, newNum: '', lineKey: `old:${lineNum}:${idx}`, side: 'old', lineNum, annotatable: true, hunk });
                return;
            }
            const o = oldNo > 0 ? oldNo++ : '';
            const n = newNo > 0 ? newNo++ : '';
            rows.push({ idx, line, kind: 'ctx', oldNum: o, newNum: n, lineKey: n ? `ctx:${n}:${idx}` : `raw:${idx}`, side: 'new', lineNum: n || idx + 1, annotatable: Boolean(n || line.trim()), hunk });
        });
        return rows;
    }

    function renderDiff(text, filePath = state.openDiff?.path || '') {
        if (!text) return `<span class="wsp-diff-ctx">${escapeHtml(tx('diffEmpty'))}</span>`;
        const rows = parseDiffLines(text);
        return rows.map(row => {
            const cls = row.kind === 'add' ? 'wsp-diff-add'
                : row.kind === 'del' ? 'wsp-diff-del'
                    : row.kind === 'hunk' ? 'wsp-diff-hunk' : 'wsp-diff-ctx';
            const notes = row.lineKey ? state.diffNotes.filter(n => n.path === filePath && n.lineKey === row.lineKey) : [];
            const editing = row.lineKey && state.diffEditor?.path === filePath && state.diffEditor?.lineKey === row.lineKey;
            const lnOld = row.oldNum ? String(row.oldNum) : '';
            const lnNew = row.newNum ? String(row.newNum) : '';
            const addBtn = row.annotatable
                ? `<button type="button" class="wsp-diff-add-note" data-wsp-diff-annotate="${escapeHtml(row.lineKey)}" data-wsp-diff-path="${escapeHtml(filePath)}" data-wsp-diff-num="${row.lineNum}" data-wsp-diff-side="${row.side || 'new'}" data-wsp-diff-code="${escapeHtml(row.line)}" title="${escapeHtml(wsLabel('对此行添加批注', 'Annotate this line'))}">+</button>`
                : '<span class="wsp-diff-pad"></span>';
            const notesHtml = notes.map(note => `
                <div class="wsp-diff-note" data-wsp-note-id="${escapeHtml(note.id)}">
                    <span class="wsp-diff-note-tag">${escapeHtml(wsLabel('批注', 'Note'))} L${note.lineNum}</span>
                    <span class="wsp-diff-note-text">${escapeHtml(note.comment)}</span>
                    <button type="button" class="wsp-diff-note-del" data-wsp-note-del="${escapeHtml(note.id)}" title="${escapeHtml(wsLabel('删除批注', 'Delete note'))}">×</button>
                </div>`).join('');
            const editorHtml = editing ? `
                <div class="wsp-diff-editor">
                    <textarea rows="2" data-wsp-diff-input placeholder="${escapeHtml(wsLabel('写下对这行代码的修改意见…（Enter 保存，Esc 取消）', 'Describe the change you want on this line… (Enter to save, Esc to cancel)'))}">${escapeHtml(state.diffEditor.draft || '')}</textarea>
                    <div class="wsp-diff-editor-actions">
                        <button type="button" class="wsp-btn wsp-btn-primary" data-wsp-diff-save>${wsLabel('保存批注', 'Save')}</button>
                        <button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-diff-cancel>${wsLabel('取消', 'Cancel')}</button>
                    </div>
                </div>` : '';
            return `<div class="wsp-diff-row ${cls}">${addBtn}<span class="wsp-diff-ln">${lnOld}</span><span class="wsp-diff-ln">${lnNew}</span><code class="wsp-diff-code">${escapeHtml(row.line)}</code></div>${notesHtml}${editorHtml}`;
        }).join('');
    }

    function renderDiffNotesBar() {
        const count = state.diffNotes.length;
        if (!count) return '';
        return `<div class="wsp-review-bar">
            <span class="wsp-review-count">${escapeHtml(wsLabel(`已批注 ${count} 处`, `${count} diff note${count > 1 ? 's' : ''}`))}</span>
            <div class="wsp-review-actions">
                <button type="button" class="wsp-btn" data-wsp-notes-send="insert">${wsLabel('插入输入框', 'Insert')}</button>
                <button type="button" class="wsp-btn wsp-btn-primary" data-wsp-notes-send="send">${wsLabel('发给 Agent 修改', 'Send to Agent')}</button>
                <button type="button" class="wsp-btn wsp-btn-quiet" data-wsp-notes-clear>${wsLabel('清空', 'Clear')}</button>
            </div>
        </div>`;
    }

    function formatDiffNotesPrompt() {
        if (!state.diffNotes.length) return '';
        const header = wsLabel('请根据以下 Diff 行级批注调整代码：', 'Please update the code based on these diff review notes:');
        const items = state.diffNotes.map((note, idx) => {
            const loc = `${note.path}:L${note.lineNum}`;
            const code = String(note.code || '').trim().slice(0, 140);
            return `${idx + 1}. \`${loc}\`${code ? ` (\`${code}\`)` : ''}\n   - ${note.comment}`;
        }).join('\n');
        return `${header}\n${items}`;
    }

    function sendDiffNotes(sendNow = false) {
        const prompt = formatDiffNotesPrompt();
        if (!prompt) return;
        const ok = window.DragonClaw?.composePrompt?.(prompt, { send: sendNow, append: true });
        if (!ok) {
            toast(wsLabel('当前输入框不可用，请切换到可发送的对话', 'Composer is unavailable right now'));
            return;
        }
        if (sendNow) {
            state.diffNotes = [];
            state.diffEditor = null;
            renderChanges();
        }
        toast(sendNow ? wsLabel('已将批注发送给 Agent', 'Sent review notes to Agent') : wsLabel('已将批注插入输入框', 'Inserted review notes into composer'));
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
        const root = effectiveRoot();
        const id = state.agentSessionId || (isSharedLocked() ? 'shws' : '');
        if ((!state.enabled && !isSharedLocked()) || !root || !id || changesRefreshing || state.pr?.phase === 'running') return;
        changesRefreshing = true;
        try {
            const data = await request('GET', `${API}/changes/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}`);
            if (effectiveRoot() === root) applyChanges(data.changes);
        } catch { /* 刷新失败保持现状 */ } finally {
            changesRefreshing = false;
        }
    }

    // 选目录 / 恢复对话后：上一轮的上下文占用 + 当前实际改动
    async function restoreState() {
        const root = effectiveRoot();
        const id = state.agentSessionId || (isSharedLocked() ? 'shws' : '');
        if ((!state.enabled && !isSharedLocked()) || !root || !id) return;
        try {
            const data = await request('GET', `${API}/state/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}`);
            if (effectiveRoot() !== root) return;
            if (data.context) state.context = data.context;
            renderContext();
            applyChanges(data.changes);
        } catch { /* 读取失败保持空白 */ }
    }

    async function confirmRevertConflict(filePath) {
        const options = { title: tx('revertConflictTitle'), message: tx('revertConflictMessage', { path: filePath }), confirmText: tx('revertConflictConfirm'), tone: 'danger' };
        if (typeof window.showPlatformConfirm === 'function') return window.showPlatformConfirm(options);
        if (typeof showPlatformConfirm === 'function') return showPlatformConfirm(options); // eslint-disable-line no-undef
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

    // ── 按轮回退：改过文件的回答下面显示「回退到这一轮之前」 ──────
    let checkpointRequest = 0;
    async function decorateCheckpoints() {
        const thread = document.getElementById('dcThread');
        if (!thread) return;
        const clear = () => thread.querySelectorAll('.dc-rewind-btn').forEach(node => node.remove());
        if (!state.enabled || !state.root || !state.agentSessionId || isReadOnly()) { clear(); return; }
        const ticket = ++checkpointRequest;
        const target = { root: state.root, id: state.agentSessionId };
        let runs = [];
        try {
            runs = (await request('GET', `${API}/checkpoints/${encodeURIComponent(target.id)}?root=${encodeURIComponent(target.root)}`)).runs || [];
        } catch { return; }
        if (ticket !== checkpointRequest || state.root !== target.root || state.agentSessionId !== target.id) return;
        const byRun = new Map(runs.map(item => [item.runId, item]));
        thread.querySelectorAll('.dc-msg--ai[data-run-id]').forEach(message => {
            const run = byRun.get(message.dataset.runId);
            const existing = message.querySelector('.dc-rewind-btn');
            if (!run) { existing?.remove(); return; }
            if (existing) return;
            const bar = message.querySelector('.dc-msg-tools');
            if (!bar) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dc-rewind-btn';
            button.title = tx('rewindTitle', { count: run.files });
            button.innerHTML = `<span aria-hidden="true">↶</span>${escapeHtml(tx('rewindAction'))}<small>${escapeHtml(tx('rewindFiles', { count: run.files }))}</small>`;
            button.addEventListener('click', () => rewindTurn(run, target, message));
            bar.appendChild(button);
        });
    }

    async function rewindTurn(run, target, message) {
        if (state.root !== target.root || state.agentSessionId !== target.id) return;
        const later = [...document.querySelectorAll('#dcThread .dc-msg--ai[data-run-id]')];
        const index = later.indexOf(message);
        const laterCount = later.slice(index + 1).filter(node => node.querySelector('.dc-rewind-btn')).length;
        const files = run.paths.slice(0, 8).join('\n') + (run.paths.length > 8 ? `\n${tx('rewindMoreFiles', { count: run.paths.length - 8 })}` : '');
        const options = { title: tx('rewindConfirmTitle'), message: `${tx(laterCount ? 'rewindConfirmLater' : 'rewindConfirm', { count: laterCount })}\n\n${files}`, confirmText: tx('rewindAction'), tone: 'danger' };
        const ok = typeof window.showPlatformConfirm === 'function' ? await window.showPlatformConfirm(options) : await window.AppDialog.confirm(options.message, options);
        if (!ok) return;
        try {
            const data = await request('POST', `${API}/checkpoints/${encodeURIComponent(target.id)}/rewind`, { root: target.root, runId: run.runId });
            if (state.root !== target.root || state.agentSessionId !== target.id) return;
            applyChanges(data.changes);
            message.querySelector('.dc-msg-main')?.insertAdjacentHTML('beforeend', `<div class="dc-rewound">↶ ${escapeHtml(tx('rewindDone', { count: data.restored.length }))}${data.skipped?.length ? ` · ${escapeHtml(tx('rewindSkipped', { count: data.skipped.length }))}` : ''}</div>`);
            toast(tx('rewindDone', { count: data.restored.length }));
        } catch (error) {
            toast(error.message);
        }
        decorateCheckpoints();
    }

    const wsLabel = (zh, en) => window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
    const WS_ICONS = {
        folder: '<path d="M2.5 6V5A1.5 1.5 0 0 1 4 3.5h4l2 2h6A1.5 1.5 0 0 1 17.5 7v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15Z"/>',
        branch: '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="16" r="2"/><circle cx="15" cy="5" r="2"/><path d="M6 6v8m9-7c0 5-9 2-9 7"/>',
        plus: '<path d="M10 3v14M3 10h14"/>',
        none: '<path d="M3 8V5a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v3M3 10l7 7m0-7-7 7"/>',
        search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/>',
        check: '<path d="m4 10 4 4 8-8"/>',
        details: '<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M8 3v14m3-9h3m-3 4h3"/>'
    };
    const wsIcon = key => `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WS_ICONS[key] || ''}</svg>`;
    const workspaceBusy = () => state.gitSaving || state.pr?.phase === 'running' || document.querySelector('#dcComposer.is-generating');

    async function refreshGit() {
        if (!state.root || isSharedLocked()) return;
        const root = state.root, version = ++state.gitRequest;
        try {
            const data = await request('GET', `${API}/git?root=${encodeURIComponent(root)}`);
            if (version !== state.gitRequest || root !== state.root || typeof data.git !== 'boolean') return;
            if (JSON.stringify(state.gitInfo) === JSON.stringify(data)) return;
            state.gitInfo = data;state.gitBranch = data.branch || '';
            const open = el.chip?.querySelector('details[open]')?.dataset.wspPicker;
            renderChip();renderEnv();
            if (open) el.chip.querySelector(`[data-wsp-picker="${open}"]`)?.setAttribute('open', '');
        } catch { /* A failed Git refresh never clears the selected workspace. */ }
    }

    function renderGitControls() {
        const info = state.gitInfo;
        if (!state.root || !info?.git) return '';
        const unavailable = isReadOnly() || workspaceBusy();
        const branchName = info.branch || (info.head ? wsLabel('分离的 HEAD', 'Detached HEAD') : wsLabel('尚无提交', 'No commits yet'));
        return `<details class="dc-context-picker dc-branch-picker" data-wsp-picker="branch">
            <summary title="${escapeHtml(branchName)}">${wsIcon('branch')}<span>${escapeHtml(branchName)}</span><span class="dc-context-caret" aria-hidden="true">⌄</span></summary>
            <div class="dc-context-menu"><label class="dc-workspace-search">${wsIcon('search')}<input type="search" data-wsp-branch-search placeholder="${wsLabel('搜索分支', 'Search branches')}" aria-label="${wsLabel('搜索分支', 'Search branches')}"></label>
                <div class="dc-context-branches">${(info.branches || []).map(branch => {
                    const elsewhere = branch.worktreeRoot && branch.worktreeRoot !== info.repoRoot;
                    return `<button type="button" data-wsp-branch="${escapeHtml(branch.name)}" title="${escapeHtml(elsewhere ? wsLabel('已在其他 worktree 使用：', 'Used in another worktree: ') + branch.worktreeRoot : branch.name)}" aria-current="${Boolean(branch.current)}" ${unavailable || elsewhere ? 'disabled' : ''}>${wsIcon('branch')}<span>${escapeHtml(branch.name)}</span>${branch.current ? wsIcon('check') : ''}</button>`;
                }).join('')}</div><p class="dc-context-empty" data-wsp-branch-empty ${(info.branches || []).length ? 'hidden' : ''}>${wsLabel('没有匹配的分支', 'No matching branches')}</p>
                <div class="dc-context-divider"></div><button type="button" data-wsp-action="new-branch" ${unavailable || !info.head ? 'disabled' : ''}>${wsIcon('plus')}<span>${wsLabel('新建分支', 'New branch')}</span></button>
                <p class="dc-context-explanation">${wsLabel('切换前会检查未提交改动，不会自动丢弃或暂存。', 'Uncommitted changes block switching. Changes are never discarded or stashed automatically.')}</p>
            </div></details>
            <details class="dc-context-picker dc-worktree-picker" data-wsp-picker="worktree">
                <summary><span class="dc-worktree-check${info.isWorktree ? ' is-checked' : ''}">${info.isWorktree ? wsIcon('check') : ''}</span><span>Worktree</span><span class="dc-context-caret" aria-hidden="true">⌄</span></summary>
                <div class="dc-context-menu"><p class="dc-context-explanation">${wsLabel('基于当前已提交的代码创建独立目录，不带入未提交改动。', 'Create an isolated directory from the current commit. Uncommitted changes are kept in the original workspace.')}</p>
                    <button type="button" data-wsp-action="new-worktree" ${unavailable || !info.head ? 'disabled' : ''}>${wsIcon('plus')}<span>${wsLabel('新建 Worktree', 'New worktree')}</span></button>
                    ${(info.worktrees || []).length ? '<div class="dc-context-divider"></div>' : ''}
                    ${(info.worktrees || []).map(item => `<div class="dc-worktree-row">
                        <button type="button" data-wsp-select="${escapeHtml(item.root)}" title="${escapeHtml(item.root)}" aria-current="${Boolean(item.current)}" ${!item.available || workspaceBusy() ? 'disabled' : ''}>${wsIcon('folder')}<span><b>${escapeHtml(baseName(item.root))}</b><small>${escapeHtml(item.branch || wsLabel('分离的 HEAD', 'Detached HEAD'))}${item.isMain ? ` · ${wsLabel('主仓库', 'main')}` : ''}${item.ahead ? ` · +${item.ahead}` : ''}${item.dirty ? ` · ${wsLabel('有改动', 'dirty')}` : ''}</small></span>${item.current ? wsIcon('check') : ''}</button>
                        ${!item.isMain && !unavailable ? `<button type="button" class="dc-worktree-rm" data-wsp-remove-wt="${escapeHtml(item.root)}" title="${escapeHtml(wsLabel('移除此 Worktree', 'Remove worktree'))}">×</button>` : ''}
                    </div>`).join('')}
                </div></details>`;
    }

    async function changeBranch(branch, create = false) {
        if (!state.root || isReadOnly() || workspaceBusy()) return;
        if (!create && branch === state.gitBranch) return;
        const root = state.root, ticket = state.selectionEpoch;
        state.gitSaving = true;renderChip();
        try {
            await request('POST', `${API}/git/branch`, {root,branch,create});
            if (root !== state.root || ticket !== state.selectionEpoch) return;
            window.DragonClawWorkspace.resetSession();
            await selectDirectory(root);
            toast(wsLabel('已切换到分支 ', 'Switched to branch ') + branch);
        } catch(error) { toast(error.message); }
        finally { state.gitSaving = false;renderChip(); }
    }

    async function createWorktree() {
        if (!state.root || isReadOnly() || workspaceBusy()) return;
        const root = state.root, ticket = state.selectionEpoch;
        state.gitSaving = true;renderChip();
        try {
            const data = await request('POST', `${API}/git/worktree`, {root});
            if (root !== state.root || ticket !== state.selectionEpoch) return;
            await selectDirectory(data.root);
            toast(wsLabel('已进入独立 Worktree', 'Opened the new worktree'));
        } catch(error) { toast(error.message); }
        finally { state.gitSaving = false;renderChip(); }
    }

    async function commitWorktree() {
        if (!state.root || isReadOnly() || workspaceBusy()) return;
        const message = await window.AppDialog.prompt(
            wsLabel('输入本次 Worktree 改动的提交说明（将自动暂存当前目录改动并提交）。', 'Enter a commit message for changes in this worktree.'),
            { title: wsLabel('提交 Worktree 改动', 'Commit worktree changes'), defaultValue: `feat: ${state.gitBranch || 'worktree'} changes`, maxLength: 300 }
        );
        if (!message?.trim()) return;
        const root = state.root, ticket = state.selectionEpoch;
        state.gitSaving = true; renderChip(); renderEnv();
        try {
            const data = await request('POST', `${API}/git/worktree/commit`, { root, message: message.trim() });
            if (root !== state.root || ticket !== state.selectionEpoch) return;
            state.gitInfo = data.git;
            await Promise.all([refreshChanges(), refreshGit()]);
            renderEnv(); renderChip();
            toast(data.committed ? wsLabel('已提交改动', 'Committed changes') : wsLabel('工作区干净，无需提交', 'Working tree is clean'));
        } catch (error) { toast(error.message); }
        finally { state.gitSaving = false; renderChip(); renderEnv(); }
    }

    async function mergeCurrentWorktree() {
        if (!state.root || !state.gitInfo?.isWorktree || isReadOnly() || workspaceBusy()) return;
        const info = state.gitInfo;
        const mainTarget = (info.worktrees || [])[0]?.branch || 'main';
        const root = state.root, ticket = state.selectionEpoch;
        let dirtyCommitted = false;
        if (info.dirty) {
            const msg = await window.AppDialog.prompt(
                wsLabel(`当前 Worktree 有未提交改动，请输入提交说明，提交后将合并回 ${mainTarget}。`, `Uncommitted changes detected. Enter a commit message before merging into ${mainTarget}.`),
                { title: wsLabel('提交并合并 Worktree', 'Commit & Merge Worktree'), defaultValue: `feat: merge ${info.branch || 'worktree'}`, maxLength: 300 }
            );
            if (!msg?.trim()) return;
            state.gitSaving = true; renderChip(); renderEnv();
            try {
                await request('POST', `${API}/git/worktree/commit`, { root, message: msg.trim() });
                dirtyCommitted = true;
            } catch (error) {
                state.gitSaving = false; renderChip(); renderEnv();
                toast(error.message);
                return;
            }
        }
        const ok = await window.AppDialog.confirm(
            wsLabel(`确定将分支 ${info.branch} 合并回 ${mainTarget}，并清理此独立 Worktree？`, `Merge ${info.branch} into ${mainTarget} and clean up this worktree?`),
            { title: wsLabel('合并回主分支', 'Merge Worktree') }
        );
        if (!ok) {
            if (dirtyCommitted) await refreshGit();
            state.gitSaving = false; renderChip(); renderEnv();
            return;
        }
        state.gitSaving = true; renderChip(); renderEnv();
        try {
            const data = await request('POST', `${API}/git/worktree/merge`, {
                root,
                targetBranch: mainTarget,
                mode: 'merge',
                message: `Merge ${info.branch} into ${mainTarget}`,
                removeAfter: true
            });
            if (root !== state.root || ticket !== state.selectionEpoch) return;
            if (data.nothingToMerge) {
                toast(wsLabel('没有领先主分支的新提交可合并', 'Nothing ahead of main branch to merge'));
                await refreshGit();
            } else {
                toast(wsLabel(`已合并到 ${data.targetBranch} 并清理 Worktree`, `Merged into ${data.targetBranch} and cleaned up`));
                if (data.mainRoot) await selectDirectory(data.mainRoot);
            }
        } catch (error) { toast(error.message); }
        finally { state.gitSaving = false; renderChip(); renderEnv(); }
    }

    async function removeTargetWorktree(targetRoot) {
        if (!state.root || isReadOnly() || workspaceBusy()) return;
        const target = targetRoot || state.root;
        const wt = (state.gitInfo?.worktrees || []).find(item => item.root === target);
        const isCurrent = target === state.root;
        const warnDirty = wt?.dirty ? wsLabel('\n注意：该 Worktree 仍有未提交改动，强制移除将丢弃这些未提交改动！', '\nWarning: this worktree has uncommitted changes that will be discarded if forced!') : '';
        const ok = await window.AppDialog.confirm(
            wsLabel(`确定移除 Worktree「${baseName(target)}」吗？${warnDirty}`, `Remove worktree "${baseName(target)}"?${warnDirty}`),
            { title: wsLabel('移除 Worktree', 'Remove Worktree'), tone: wt?.dirty ? 'danger' : undefined }
        );
        if (!ok) return;
        const root = state.root, ticket = state.selectionEpoch;
        state.gitSaving = true; renderChip(); renderEnv();
        try {
            const data = await request('POST', `${API}/git/worktree/remove`, {
                root,
                worktreeRoot: target,
                force: Boolean(wt?.dirty),
                deleteBranch: true
            });
            if (root !== state.root || ticket !== state.selectionEpoch) return;
            toast(wsLabel('已移除 Worktree', 'Removed worktree'));
            if (isCurrent && data.mainRoot) await selectDirectory(data.mainRoot);
            else await refreshGit();
        } catch (error) { toast(error.message); }
        finally { state.gitSaving = false; renderChip(); renderEnv(); }
    }

    async function createWorkspace() {
        if (isReadOnly() || workspaceBusy()) return;
        const sep = state.capability?.sep || '/';
        const defaultDir = state.capability?.confined ? `~${sep}workspace` : ((state.capability?.homeDir || '') + sep + 'workspace');
        const directory = await window.AppDialog.prompt(
            state.capability?.confined
                ? wsLabel('输入团队工作区内的子目录路径（~ 表示你的工作区根目录）。', 'Enter a folder path inside your team workspace (~ is your workspace root).')
                : wsLabel('输入新文件夹的完整路径。已有目录请使用“打开本地文件夹”。', 'Enter the full path for a new folder. To use an existing folder, choose Open local folder.'),
            { title: wsLabel('新建工作空间', 'New workspace'), defaultValue: defaultDir, maxLength: 1024 }
        );
        if (!directory?.trim()) return;
        try { const data = await request('POST', `${API}/create`, {path:directory.trim()});await selectDirectory(data.root); }
        catch(error) { toast(error.message); }
    }

    // ── 输入框上方的工作区芯片 ───────────────────────────
    function renderChip() {
        if (!el.chip) return;
        const sharedLocked = isSharedLocked();
        el.chip.hidden = !(state.enabled || sharedLocked);
        if (!state.enabled && !sharedLocked) return;
        if (sharedLocked) {
            const ownerName = state.sharedWorkspace?.ownerName || state.sharedWorkspace?.owner || '';
            const folderName = state.sharedWorkspace?.folderName || wsLabel('共享工作区', 'Shared workspace');
            const labelText = wsLabel(`${ownerName} 的共享目录 · ${folderName}`, `${ownerName} · ${folderName}`);
            el.chip.innerHTML = `
                <button type="button" class="dc-shared-lock-chip" data-wsp-action="shared-locked-tip" aria-disabled="true" title="${escapeHtml(sharedLockedMessage())}">
                    <span class="dc-shared-lock-icon" aria-hidden="true">🔒</span>
                    <span>${escapeHtml(labelText)}</span>
                </button>
                <span class="dc-context-readonly dc-shared-sandbox-badge" title="${escapeHtml(sharedLockedMessage())}">${escapeHtml(wsLabel('协同读写 · 隔离沙箱命令', 'Collab R/W · Sandbox'))}</span>`;
            return;
        }
        {
            const en = window.ToolsI18n?.getLanguage?.() === 'en-US';
            const label = (zh, english) => en ? english : zh;
            const folder = wsIcon('folder');
            const recent = [...new Set([state.root, state.prefs.lastDirectory, ...state.prefs.recentDirectories].filter(Boolean))].slice(0, 8);
            const modeName = isReadOnly() ? tx('readOnlyMode') : tx(`mode${state.permissionMode[0].toUpperCase()}${state.permissionMode.slice(1)}`);
            el.chip.innerHTML = `
                <details class="dc-context-picker dc-directory-picker" data-wsp-picker="directory">
                    <summary title="${escapeHtml(toDisplayPath(state.root) || tx('chooseDirHint'))}">${folder}<span>${escapeHtml(state.rootName || label('选择工作空间', 'Choose workspace'))}</span><span class="dc-context-caret" aria-hidden="true">⌄</span></summary>
                    <div class="dc-context-menu">
                        <label class="dc-workspace-search">${wsIcon('search')}<input type="search" data-wsp-recent-search placeholder="${label('搜索最近工作空间', 'Search recent workspaces')}" aria-label="${label('搜索最近工作空间', 'Search recent workspaces')}" autocomplete="off"></label>
                        <div class="dc-context-recents">${recent.map((path, index) => `<button type="button"${index >= 4 ? ' hidden' : ''} data-wsp-select="${escapeHtml(path)}" title="${escapeHtml(toDisplayPath(path))}" aria-current="${path === state.root}">${folder}<span>${escapeHtml(baseName(path))}</span>${path === state.root ? wsIcon('check') : ''}</button>`).join('')}</div>
                        <p class="dc-context-empty" ${recent.length ? 'hidden' : ''}>${label('暂无最近工作空间', 'No recent workspaces')}</p>
                        <div class="dc-context-divider"></div>
                        ${!isReadOnly() ? `<button type="button" data-wsp-action="create-workspace">${wsIcon('plus')}<span>${label('新建工作空间', 'New workspace')}</span></button>` : ''}
                        <button type="button" data-wsp-action="change">${folder}<span>${label('打开本地文件夹', 'Open local folder')}</span></button>
                        ${state.root ? `<button type="button" data-wsp-action="clear">${wsIcon('none')}<span>${label('不使用工作空间', 'No workspace')}</span></button><div class="dc-context-divider"></div><button type="button" class="dc-workspace-details" data-wsp-action="panel">${wsIcon('details')}<span>${label('查看工作空间详情', 'Workspace details')}</span></button>` : ''}
                    </div>
                </details>
                ${renderGitControls()}
                ${isReadOnly() ? `<span class="dc-context-readonly" title="${escapeHtml(tx('readOnlyDesc'))}">♧ ${escapeHtml(modeName)}</span>` : `<details class="dc-context-picker dc-permission-picker${state.permissionMode === 'full' ? ' is-full' : ''}">
                    <summary><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 6 2.5V9c0 4-2.5 6.5-6 8-3.5-1.5-6-4-6-8V4.5L10 2Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg><span>${escapeHtml(modeName)}</span><span class="dc-context-caret" aria-hidden="true">⌄</span></summary>
                    <div class="dc-context-menu"><p class="dc-context-explanation">${label('设置智能体在工作区中执行操作的权限。', 'Choose which workspace actions the agent may perform.')}</p>
                        ${MODES.map(mode => `<button type="button" class="dc-permission-option" data-wsp-mode="${mode}" role="menuitemradio" aria-checked="${state.permissionMode === mode}"><span><b>${escapeHtml(tx(`mode${mode[0].toUpperCase()}${mode.slice(1)}`))}</b><small>${escapeHtml(tx(`mode${mode[0].toUpperCase()}${mode.slice(1)}Desc`))}</small></span><span class="dc-context-check" aria-hidden="true">${state.permissionMode === mode ? '✓' : ''}</span></button>`).join('')}
                    </div>
                </details>`}`;
            return;
        }


    }

    function renderAll() {
        renderPerformance();
        renderEnv();
        renderContext();
        renderChanges();
        renderChip();
        el.panel.querySelectorAll('[data-wsp-i18n]').forEach(node => { node.textContent = tx(node.dataset.wspI18n); });
        el.picker.querySelectorAll('[data-wsp-i18n]').forEach(node => {
            const key = node.dataset.wspI18n;
            node.textContent = tx(key === 'pickerHelp' && state.capability?.confined ? 'teamPickerHelp' : key);
        });
        if (el.fab) {
            const label = el.fab.querySelector('.wsp-fab-label');
            if (label) label.textContent = tx('workspace');
            el.fab.setAttribute('aria-label', tx('workspace'));
        }
        if (el.pickerInput) el.pickerInput.placeholder = tx(state.capability?.confined ? 'teamPathPlaceholder' : 'typedPathPlaceholder');
    }

    // ── 目录选择：路径输入 + 后端联想 ────────────────────
    let pendingPickResolve = null;

    function resolvePendingPick(value) {
        const resolve = pendingPickResolve;
        pendingPickResolve = null;
        if (resolve) resolve(value);
    }

    function pickDirectory() {
        resolvePendingPick(null);
        if (!state.enabled) return Promise.resolve(null);
        return new Promise(resolve => {
            pendingPickResolve = resolve;
            openPicker();
        });
    }

    async function openPicker() {
        if (isSharedLocked()) {
            resolvePendingPick(null);
            toast(sharedLockedMessage());
            return;
        }
        if (!state.enabled) {
            resolvePendingPick(null);
            return;
        }
        const prepareAccountDirectory = state.capability.canPrepareAccountDirectory && !state.root;
        clearTimeout(state.picker.timer);
        const requestId = ++state.picker.requestId;
        el.picker.hidden = false;
        document.body.classList.add('dc-picker-open');
        el.pickerInput.value = prepareAccountDirectory ? '' : toDisplayPath(state.root || state.prefs.lastDirectory || (state.capability?.confined ? '~' : ''));
        el.pickerList.replaceChildren();
        el.pickerStatus.textContent = prepareAccountDirectory ? tx('accountDirectoryLoading') : '';
        state.picker.items = [];
        state.picker.active = -1;
        el.pickerSelect.disabled = true;
        renderPickerRecent();
        el.pickerInput.focus();
        el.pickerInput.select();
        if (prepareAccountDirectory) {
            try {
                const { directory } = await request('POST', `${API}/account-directory`);
                if (requestId !== state.picker.requestId) return;
                if (!directory) throw new Error('Missing account directory');
                el.pickerInput.value = toDisplayPath(directory);
                if (document.activeElement === el.pickerInput) el.pickerInput.select();
            } catch (error) {
                if (requestId !== state.picker.requestId) return;
                const key = error.code === 'ACCOUNT_DIRECTORY_CONFLICT' ? 'accountDirectoryConflict' : 'accountDirectoryFailed';
                return suggest(key);
            }
        }
        suggest();
    }

    function closePicker() {
        clearTimeout(state.picker.timer);
        state.picker.requestId++;
        el.picker.hidden = true;
        document.body.classList.remove('dc-picker-open');
        state.picker.active = -1;
        resolvePendingPick(null);
    }

    function renderPickerRecent() {
        const recent = state.prefs.recentDirectories.slice(0, 8);
        el.pickerRecent.innerHTML = recent.length
            ? `<span class="wsp-picker-recent-label">${escapeHtml(tx('recentDirs'))}</span>${recent.map(item => { const shown = toDisplayPath(item); return `<button type="button" class="wsp-chip" data-wsp-fill="${escapeHtml(shown)}" title="${escapeHtml(shown)}">${escapeHtml(baseName(item))}</button>`; }).join('')}`
            : '';
    }

    function scheduleSuggest() {
        clearTimeout(state.picker.timer);
        state.picker.requestId++;
        state.picker.timer = setTimeout(() => suggest(), 150);
    }

    async function suggest(notice) {
        clearTimeout(state.picker.timer);
        const input = el.pickerInput.value;
        const requestId = state.picker.requestId += 1;
        try {
            const data = await request('GET', `${API}/suggest?input=${encodeURIComponent(input)}&showHidden=${el.pickerHidden.checked ? 'true' : 'false'}`);
            if (requestId !== state.picker.requestId) return;
            state.picker.items = [];
            (data.groups || []).forEach(group => {
                group.entries.forEach(entry => state.picker.items.push({ ...entry, group: group.label }));
            });
            state.picker.active = state.picker.items.length ? 0 : -1;
            renderPickerList(data);
            if (notice) el.pickerStatus.textContent = tx(notice);
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
            const shownPath = toDisplayPath(item.path);
            html.push(`<button type="button" role="option" id="wspOpt${index}" aria-selected="${index === state.picker.active}" class="wsp-picker-item${index === state.picker.active ? ' is-active' : ''}" data-wsp-index="${index}" title="${escapeHtml(shownPath)}">
                <span class="wsp-picker-item-icon" aria-hidden="true">${item.isGit ? '⎇' : FOLDER_ICON}</span>
                <span class="wsp-picker-item-name">${name}</span>
                <span class="wsp-picker-item-path">${escapeHtml(shorten(shownPath))}</span>
            </button>`);
        });
        el.pickerList.innerHTML = html.join('') || `<div class="wsp-picker-none">${escapeHtml(data.error === 'EACCES' ? tx('noPermission') : input ? tx('noMatches') : tx('noMatches'))}</div>`;
        if (!input) el.pickerStatus.textContent = tx(data.confined ? 'teamPickerEmptyHint' : 'pickerEmptyHint');
        else if (data.exists && data.isDir) el.pickerStatus.innerHTML = `<span class="wsp-status-ok">✓ ${escapeHtml(tx('dirReady'))}${data.isGit ? ` · ⎇ git` : ''}</span>`;
        else if (data.exists) el.pickerStatus.innerHTML = `<span class="wsp-status-bad">${escapeHtml(tx('notDir'))}</span>`;
        else el.pickerStatus.innerHTML = `<span class="wsp-status-dim">${escapeHtml(tx('dirNotFound'))}</span>`;
        el.pickerSelect.disabled = !input || !(data.exists && data.isDir);
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
        const shown = toDisplayPath(item.path);
        el.pickerInput.value = shown.endsWith(sep) ? shown : `${shown}${sep}`;
        el.pickerInput.setSelectionRange(el.pickerInput.value.length, el.pickerInput.value.length);
        suggest();
    }

    async function confirmPicker(explicitPath) {
        const target = explicitPath || el.pickerInput.value.trim();
        if (!target) return;
        try {
            await selectDirectory(target);
            const result = state.root ? { root: state.root, agentSessionId: state.agentSessionId } : null;
            const resolve = pendingPickResolve;
            pendingPickResolve = null;
            closePicker();
            if (resolve) resolve(result);
        } catch (error) {
            el.pickerStatus.innerHTML = `<span class="wsp-status-bad">${escapeHtml(error.message)}</span>`;
        }
    }

    function isScratchDirectory(dir) {
        if (!dir || typeof dir !== 'string') return false;
        const trimmed = dir.trim();
        if (!trimmed) return false;
        if (trimmed.includes('dragon-claw-scratch')) return true;
        if (/[\\/]scratch[\\/][a-f0-9]+$/i.test(trimmed)) return true;
        return false;
    }

    async function selectDirectory(fullPath, ticket = ++state.selectionEpoch, { openPanel = true } = {}) {
        if (isSharedLocked()) {
            toast(sharedLockedMessage());
            return;
        }
        if (!fullPath || isScratchDirectory(fullPath)) return;
        const data = await request('POST', `${API}/select`, { path: fullPath });
        if (ticket !== state.selectionEpoch) throw Object.assign(new Error('Directory selection superseded'), { name: 'AbortError' });
        state.root = data.root;
        state.rootName = data.name || baseName(data.root);
        state.gitBranch = data.gitBranch || '';
        state.gitInfo = data.git || null;
        state.gitRequest++;
        if (data.prefs) state.prefs = data.prefs;
        state.context = null;
        state.changes = [];
        state.openDiff = null;
        state.expandChanges = false;
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

        refreshGit();
        toast(tx('workspaceReady', { name: state.rootName }));
        window.dispatchEvent(new CustomEvent('dragon-claw:workspace-change', { detail: { root: state.root } }));
        restoreState();
    }

    function clearDirectory() {
        state.selectionEpoch += 1;
        state.root = '';
        state.rootName = '';
        state.gitBranch = '';
        state.gitInfo = null;state.gitRequest++;
        state.context = null;
        state.changes = [];
        state.openDiff = null;
        state.expandChanges = false;
        state.pr?.controller?.abort();
        state.pr = null;
        setOpen(false);
        renderAll();
        window.dispatchEvent(new CustomEvent('dragon-claw:workspace-change', { detail: { root: '' } }));
    }

    async function setMode(mode) {
        if (isReadOnly() || state.permissionSaving || !MODES.includes(mode) || mode === state.permissionMode) return;
        state.permissionSaving = true;
        el.chip?.setAttribute('aria-busy', 'true');
        try {
            const saved = await request('PUT', `${API}/prefs`, { permissionMode: mode });
            state.prefs = saved;
            state.permissionMode = saved.permissionMode || mode;
            renderEnv(); renderChip();
            toast(tx('modeChanged', { mode: tx(`mode${state.permissionMode[0].toUpperCase()}${state.permissionMode.slice(1)}`) }));
        } catch (error) {
            toast(error.message);
        } finally {
            state.permissionSaving = false;
            el.chip?.removeAttribute('aria-busy');
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
        if (tool === 'list_uiv_scripts' || tool === 'list_uiv_categories') return args.query || args.category || '';
        if (tool === 'move_uiv_script') return `${Array.isArray(args.items) ? `${args.items.length} 个脚本` : args.id || ''} → ${args.category || ''}`;
        if (tool === 'manage_uiv_category') return `${args.action || ''} ${args.name || ''}${args.newName ? ` → ${args.newName}` : ''}${args.moveScriptsTo ? ` → ${args.moveScriptsTo}` : ''}`.trim();
        if (tool === 'read_uiv_script' || tool === 'save_uiv_script' || tool === 'delete_uiv_script') return `${args.action || ''} ${args.id || args.sourceId || ''}${args.field ? ` / ${args.field}` : ''}`.trim();
        if (tool === 'run_command' || tool === 'welink_query' || tool === 'welink_action' || /^netcare_/.test(tool)) return args.command || '';
        if (tool === 'view_image') return `${String(args.path || '').split('/').pop()}${args.question ? ` · ${args.question}` : ''}`;
        if (tool === 'browser_navigate') return args.url || '';
        if (tool === 'browser_click' || tool === 'browser_type') return `${args.ref || ''}${args.text ? ` ← ${args.text}` : ''}`;
        if (tool === 'browser_network') return [args.type, args.filter].filter(Boolean).join(' ');
        if (tool === 'browser_network_body') return args.requestId || '';
        if (tool === 'browser_evaluate') return args.expression || '';
        if (tool === 'browser_wait') return args.text || (args.timeoutMs ? `${args.timeoutMs}ms` : '');
        if (tool === 'calculate') return Array.isArray(args.expressions) ? args.expressions.join('；') : args.expression || '';
        if (tool === 'read_document') return `${args.path || ''}${args.sheet ? ` / ${args.sheet}` : ''}`;
        if (tool === 'query_data') return args.sql || args.path || '';
        if (tool === 'diff_files') return `${args.path || 'A'} ⇄ ${args.otherPath || 'B'}`;
        if (tool === 'multi_edit') return `${args.path || ''}${Array.isArray(args.edits) ? ` · ${args.edits.length}` : ''}`;
        if (tool === 'zip_files') return `${Array.isArray(args.paths) ? args.paths.join(', ') : ''} → ${args.output || ''}`;
        if (tool === 'unzip_file') return `${args.path || ''}${args.to ? ` → ${args.to}` : ''}`;
        if (tool === 'memory') return `${args.action || ''}${args.id ? ` #${args.id}` : ''} ${args.content || ''}`.trim();
        if (tool === 'search') return `"${args.query || ''}"${args.path && args.path !== '.' ? ` in ${args.path}` : ''}`;
        if (tool === 'rename_path') return `${args.from || ''} → ${args.to || ''}`;
        if (tool === 'tool_search') return [...(Array.isArray(args.select) ? args.select : []), args.query || ''].filter(Boolean).join(', ');
        if (tool === 'load_skill') return args.id ? `@${String(args.id).replace(/^@/, '')}` : '';
        if (tool === 'list_directory') return args.path || '.';
        if (tool === 'list_databases') return args.path || '.';
        if (tool === 'database_schema' || tool === 'read_database_table' || tool === 'insert_database_row' || tool === 'update_database_rows' || tool === 'delete_database_rows') {
            const dbNames = {
                'tools.db': '平台业务主库',
                'report.db': '报表指标与催办业务库',
                'ai-knowledge.db': 'AI 知识库',
                'datacom-knowledge.db': '数通知识库',
                'requirements.db': '需求广场库',
                'ezscan-warehouse.db': '仓储库',
                'chat-history.db': '聊天记录库'
            };
            const rawDb = String(args.database || '');
            const dbKey = rawDb.replace(/^platform:(?:(?:data|report)\/)?/i, '').toLowerCase();
            const dbLabel = rawDb.startsWith('platform:') ? (dbNames[dbKey] || '平台数据库') : rawDb.startsWith('local:') ? '工作区本地 SQLite' : '';
            const dbText = rawDb ? `${rawDb}${dbLabel ? `（${dbLabel}）` : ''}` : '';
            return `${dbText}${args.table ? ` / ${args.table}` : ''}`;
        }
        return args.path || '';
    }

    // 工具显示名：有翻译用翻译；MCP 工具（mcp__服务__工具）显示「MCP · 工具」；其余直接用工具名
    function toolLabel(tool) {
        const key = `tool_${tool}`;
        const text = tx(key);
        if (text && text !== key) return text;
        const mcp = /^mcp__(.+?)__(.+)$/.exec(String(tool || ''));
        return mcp ? `MCP · ${mcp[2]}` : String(tool || '');
    }

    function toolIcon(tool) {
        return { save_skill: '🧬', read_skill: '📜', find_platform_tools: '🧭', read_tool_guide: '📘', list_directory: '📂', read_file: '📄', search: '🔍', list_databases: '🗄', database_schema: '🗄', read_database_table: '🗄', write_file: '✏️', edit_file: '✏️', delete_path: '🗑', rename_path: '↪', run_command: '⌘', welink_list_targets: '👥', welink_send_message: '📨', welink_query: '💼', welink_action: '📤', tool_search: '🧰', calculate: '🧮', read_document: '📑', query_data: '📊', diff_files: '⇄', multi_edit: '✏️', zip_files: '🗜', unzip_file: '🗜', memory: '🧠', view_image: '🖼', browser_navigate: '🌐', browser_snapshot: '🌐', browser_click: '🖱', browser_type: '⌨️', browser_login: '🔐', browser_scroll: '🌐', browser_wait: '⏳', browser_network: '📡', browser_network_body: '📡', browser_console: '🧾', browser_screenshot: '📸', browser_tabs: '🗂', browser_evaluate: '⚡', load_skill: '✨', ops_send_draft: '📣', ops_test_send: '📣', netcare_tables: '🧭', netcare_describe: '🧭', netcare_query: '🧭', netcare_sql: '🧭' }[tool] || '⚙';
    }

    // ── 对话内：写入 / 编辑后的文件卡片（预览 / 代码） ─────
    // 内容按需从 /file 读取磁盘上的当前版本；HTML/SVG 在无 allow-same-origin 的沙箱 iframe 中渲染，拿不到平台的 Token 与存储。
    const FILE_TOOLS = new Set(['write_file', 'edit_file', 'multi_edit']);
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

    function isSwarmBrowserActive() {
        try {
            if (typeof window.DragonHtmlSwarm?.isSwarmBrowserOpen === 'function') {
                return window.DragonHtmlSwarm.isSwarmBrowserOpen();
            }
            const sidebarOpen = Boolean(window.DragonBrowserSidebar?.isOpen?.());
            const panel = document.getElementById('dcBrowserPanel');
            const hasSwarm = Boolean(panel && panel.classList.contains('is-swarm-canvas'));
            return sidebarOpen && (hasSwarm || Boolean(window.DragonHtmlSwarm?.isActive?.()));
        } catch (_e) {
            return false;
        }
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
        card.dataset.root = effectiveRoot();
        card.dataset.session = state.agentSessionId || (isSharedLocked() ? 'shws' : '');
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
        // 如果右侧已自动打开 AI 指针群协同绘制浏览器，左侧的 HTML 预览无需默认展开，
        // 自动保持收起状态（用户仍可点击「预览」或「代码」手动展开），
        // 避免左侧过早展示完成内容与右侧协同绘制动画产生视觉冲突。
        const suppressAutoPreview = previewKind === 'html' && isSwarmBrowserActive();
        if (autoOpen && previewKind && !suppressAutoPreview) {
            showFileView(card, 'preview');
        }
        // 异步读取文件内容以更新文件行数与大小元数据；
        // 仅在当轮实时新生成 HTML（autoOpen && !replaying）时自动注入右侧 Dragon 浏览器 AI 指针群协同绘制；
        // 正常打开/回放历史对话时不再自动弹出绘制（需要查看时可点击消息下方预览按钮手动触发）。
        loadFile(card).then(data => {
            if (autoOpen && !replaying && previewKind === 'html' && data?.content && window.DragonHtmlSwarm) {
                window.DragonHtmlSwarm.playFullHtml?.(data.content, { title: baseName(filePath) });
            }
        }).catch(() => {});
    }

    async function loadFile(card) {
        if (fileCache.has(card)) return fileCache.get(card);
        const root = card.dataset.root || effectiveRoot();
        const id = card.dataset.session || state.agentSessionId || (isSharedLocked() ? 'shws' : 'shared');
        const data = await request('GET', `${API}/file/${encodeURIComponent(id)}?root=${encodeURIComponent(root)}&path=${encodeURIComponent(card.dataset.path)}`);
        fileCache.set(card, data);
        const lines = data.content ? data.content.split('\n').length : 0;
        card.querySelector('.dc-file-meta').textContent = `${tx('fileLines', { count: lines })} · ${formatBytes(data.size)}`;
        return data;
    }

    function renderCode(content, filePath = '') {
        const lines = String(content).split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        const lang = window.IdeHighlighter ? window.IdeHighlighter.detectLanguage(filePath) : 'text';
        let highlighted = '';
        if (window.IdeHighlighter && lang && lang !== 'text') {
            try { highlighted = window.IdeHighlighter.highlight(lines.join('\n'), lang); } catch (_e) { highlighted = lines.map(line => escapeHtml(line)).join('\n'); }
        } else {
            highlighted = lines.map(line => escapeHtml(line)).join('\n');
        }
        const highlightedLines = highlighted.split('\n');
        return `<pre class="dc-file-code"><code>${highlightedLines.map(line => `<span class="dc-file-line">${line || ' '}</span>`).join('')}</code></pre>`;
    }

    function renderPreview(card, content) {
        const kind = card.dataset.preview;
        if (kind === 'markdown') {
            const render = window.ToolsAIAssistant?.renderMarkdown;
            return `<div class="dc-file-md">${render ? render(content) : renderCode(content, card.dataset.path)}</div>`;
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
        body.innerHTML = view === 'preview' ? renderPreview(card, data.content) : renderCode(data.content, card.dataset.path);
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

    // ── 对话内：子智能体卡片（task 工具） ─────────────────
    // 每个子智能体一张卡：头像（图标 + 它的颜色）、名字、任务、状态与用时；运行中在卡片下方滚动显示最近几次工具调用，
    // 完成后显示结论摘要。点开看完整任务说明、全部工具调用和结论。同一步并行派出的卡片收在一组里。
    const subagents = new Map(); // id → { card, tools: Map, started, toolCount }
    const SUB_PEEK = 3;
    let subTicker = null;

    function formatElapsed(ms) {
        const seconds = Math.max(0, Math.round(ms / 1000));
        return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    }

    function formatTokens(count) {
        const value = Number(count || 0);
        return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
    }

    function tickSubagents() {
        let running = 0;
        subagents.forEach(item => {
            if (!item.card.classList.contains('is-running') || !item.started) return;
            if (!item.card.isConnected) return;
            running += 1;
            updateSubStats(item, Date.now() - item.started);
        });
        if (!running && subTicker) { clearInterval(subTicker); subTicker = null; }
    }

    function updateSubStats(item, elapsed, tokens) {
        const parts = [tx('subTools', { count: item.toolCount })];
        if (elapsed !== undefined) parts.push(formatElapsed(elapsed));
        if (tokens) parts.push(tx('subTokens', { count: formatTokens(tokens) }));
        item.card.querySelector('.dc-sub-stats').textContent = parts.join(' · ');
    }

    function updateSubGroup(group) {
        if (!group) return;
        const cards = [...group.querySelectorAll(':scope > .dc-sub')];
        const running = cards.filter(card => card.classList.contains('is-running')).length;
        group.classList.toggle('is-single', cards.length < 2);
        group.querySelector('.dc-sub-group-title').textContent = tx('subGroup', { count: cards.length });
        group.querySelector('.dc-sub-group-state').textContent = running ? tx('subGroupRunning', { count: running }) : tx('subGroupDone');
        group.classList.toggle('is-running', running > 0);
    }

    function renderSubTool(item, event) {
        let line = item.tools.get(event.callId);
        if (!line || (event.state === 'running' && !line.classList.contains('is-running'))) {
            item.toolCount += 1;
            line = document.createElement('li');
            line.className = 'dc-sub-tool';
            line.innerHTML = `<span class="dc-sub-tool-icon" aria-hidden="true">${toolIcon(event.tool)}</span><span class="dc-sub-tool-name">${escapeHtml(toolLabel(event.tool))}</span><span class="dc-sub-tool-args"></span><span class="dc-sub-tool-state"></span>`;
            item.tools.set(event.callId, line);
            item.card.querySelector('.dc-sub-tools').appendChild(line);
        }
        if (event.args !== undefined) {
            const args = describeArgs(event.tool, event.args || {});
            line.querySelector('.dc-sub-tool-args').textContent = args;
            line.querySelector('.dc-sub-tool-args').title = args;
        }
        line.className = `dc-sub-tool is-${event.state === 'running' ? 'running' : event.state === 'done' ? 'ok' : 'fail'}`;
        line.querySelector('.dc-sub-tool-state').innerHTML = event.state === 'running' ? '<i class="dc-tool-spin" aria-hidden="true"></i>'
            : `${event.state === 'done' ? '✓' : '✗'}${event.summary ? ` <span>${escapeHtml(event.summary)}</span>` : ''}`;
        // 卡片下方的「最近动态」：只留最近几条
        const peek = item.card.querySelector('.dc-sub-peek');
        if (item.card.classList.contains('is-running')) {
            const lines = [...item.card.querySelectorAll('.dc-sub-tools > .dc-sub-tool')];
            peek.innerHTML = lines.slice(-SUB_PEEK).map(node => `<div class="dc-sub-peek-line ${node.classList.contains('is-running') ? 'is-running' : ''}">${node.querySelector('.dc-sub-tool-icon').outerHTML}<span>${escapeHtml(node.querySelector('.dc-sub-tool-name').textContent)}</span><em>${escapeHtml(node.querySelector('.dc-sub-tool-args').textContent)}</em></div>`).join('');
            const hidden = lines.length - SUB_PEEK;
            if (hidden > 0) peek.insertAdjacentHTML('afterbegin', `<div class="dc-sub-peek-more">${escapeHtml(tx('subMore', { count: hidden }))}</div>`);
        }
    }

    function renderSubagent(messageEl, event) {
        let item = subagents.get(event.id);
        if (event.phase === 'start' || !item) {
            if (item?.card.isConnected && messageEl.contains(item.card) && item.card.classList.contains('is-running')) return; // 重复的开始事件
            const card = document.createElement('div');
            card.className = 'dc-sub is-running';
            card.dataset.subId = event.id;
            if (/^#[0-9a-f]{6}$/i.test(event.color || '')) card.style.setProperty('--sub', event.color);
            card.innerHTML = `
                <button type="button" class="dc-sub-head" aria-expanded="false">
                    <span class="dc-sub-avatar" aria-hidden="true">${escapeHtml(event.emoji || '🤖')}</span>
                    <span class="dc-sub-title"><b class="dc-sub-name">${escapeHtml(event.name || tx('subDefaultName'))}</b><span class="dc-sub-desc">${escapeHtml(event.description || '')}</span></span>
                    <span class="dc-sub-meta"><span class="dc-sub-status">${escapeHtml(tx('subRunning'))}</span><span class="dc-sub-stats"></span></span>
                    <span class="dc-sub-caret" aria-hidden="true"></span>
                </button>
                <div class="dc-sub-peek"><div class="dc-sub-peek-line is-running"><span class="dc-sub-tool-icon" aria-hidden="true">🧭</span><span>${escapeHtml(tx('subWaiting'))}</span></div></div>
                <div class="dc-sub-body" hidden>
                    <div class="dc-sub-label">${escapeHtml(tx('subTask'))}</div>
                    <div class="dc-sub-prompt">${escapeHtml(event.prompt || '')}</div>
                    <div class="dc-sub-label">${escapeHtml(tx('subToolsTitle'))}</div>
                    <ol class="dc-sub-tools"></ol>
                    <div class="dc-sub-result-wrap" hidden><div class="dc-sub-label">${escapeHtml(tx('subResult'))}</div><div class="dc-sub-result"></div></div>
                </div>`;
            card.querySelector('.dc-sub-head').addEventListener('click', () => {
                const body = card.querySelector('.dc-sub-body');
                body.hidden = !body.hidden;
                card.classList.toggle('is-open', !body.hidden);
                card.querySelector('.dc-sub-head').setAttribute('aria-expanded', String(!body.hidden));
            });
            // 相邻派出的子智能体放进同一组
            const log = toolLogFor(messageEl);
            let group = log.lastElementChild?.classList.contains('dc-sub-group') ? log.lastElementChild : null;
            if (!group) {
                group = document.createElement('div');
                group.className = 'dc-sub-group is-single';
                group.innerHTML = `<div class="dc-sub-group-head"><span class="dc-sub-group-icon" aria-hidden="true">🚀</span><b class="dc-sub-group-title"></b><span class="dc-sub-group-state"></span></div>`;
                log.appendChild(group);
            }
            group.appendChild(card);
            item = { card, tools: new Map(), started: replaying ? 0 : Date.now(), toolCount: 0 };
            subagents.set(event.id, item);
            updateSubStats(item, replaying ? undefined : 0);
            updateSubGroup(group);
            messageEl.querySelector('.dc-thinking')?.remove();
            if (!replaying && !subTicker) subTicker = setInterval(tickSubagents, 1000);
            if (event.phase === 'start') return;
        }
        if (event.phase === 'tool') {
            renderSubTool(item, event);
            updateSubStats(item, item.started ? Date.now() - item.started : undefined);
        } else if (event.phase === 'status') {
            item.card.querySelector('.dc-sub-status').textContent = tx('subRunning');
        } else if (event.phase === 'done') {
            settleSubagent(item, event);
        }
    }

    function settleSubagent(item, event) {
        const { card } = item;
        const state = event.ok ? 'done' : event.aborted ? 'stopped' : 'failed';
        card.classList.remove('is-running');
        card.classList.add(`is-${state}`);
        card.querySelector('.dc-sub-status').textContent = tx({ done: 'subDone', stopped: 'subStopped', failed: 'subFailed' }[state]);
        if (event.toolCount !== undefined) item.toolCount = event.toolCount;
        updateSubStats(item, event.durationMs, event.tokens);
        const peek = card.querySelector('.dc-sub-peek');
        if (event.ok && event.result) {
            // 结论：卡片下方显示第一段，展开看完整 Markdown
            const first = String(event.result).split('\n').map(line => line.replace(/^[#>*\-\s]+/, '').replace(/[`*_]/g, '').trim()).find(Boolean) || '';
            peek.innerHTML = `<div class="dc-sub-peek-result">${escapeHtml(first)}</div>`;
            const render = window.ToolsAIAssistant?.renderMarkdown;
            const wrap = card.querySelector('.dc-sub-result-wrap');
            wrap.hidden = false;
            wrap.querySelector('.dc-sub-result').innerHTML = render ? render(String(event.result)) : `<pre>${escapeHtml(event.result)}</pre>`;
        } else {
            peek.innerHTML = event.error ? `<div class="dc-sub-peek-result is-error">${escapeHtml(event.error)}</div>` : '';
        }
        card.querySelectorAll('.dc-sub-tools > .dc-sub-tool.is-running').forEach(line => {
            line.className = 'dc-sub-tool is-fail';
            line.querySelector('.dc-sub-tool-state').textContent = '—';
        });
        updateSubGroup(card.closest('.dc-sub-group'));
    }

    function handleEvent(messageEl, event, sourceWorkspace) {
        if (!messageEl || !event) return;
        if (event.type === 'subagent') {
            renderSubagent(messageEl, event);
            return;
        }
        if (event.type === 'tool_start') {
            const row = document.createElement('div');
            row.className = 'dc-tool-row is-running';
            row.dataset.tool = event.tool;
            row.innerHTML = `<span class="dc-tool-icon" aria-hidden="true">${toolIcon(event.tool)}</span><span class="dc-tool-name">${escapeHtml(toolLabel(event.tool))}</span><span class="dc-tool-args" title="${escapeHtml(describeArgs(event.tool, event.args))}">${escapeHtml(describeArgs(event.tool, event.args))}</span><span class="dc-tool-state"><i class="dc-tool-spin" aria-hidden="true"></i></span>`;
            // 文件卡片只用于用户选择的目录（或已同步给本人的共享文件副本）；没选目录（对话传入 null）时不挂预览。重放历史时不传
            const fileTarget = event.sharedPath || event.args?.path;
            if (sourceWorkspace !== null && FILE_TOOLS.has(event.tool) && fileTarget) row.dataset.filePath = fileTarget;
            toolLogFor(messageEl).appendChild(row);
            toolRows.set(event.callId, row);
            messageEl.querySelector('.dc-thinking')?.remove();
        } else if (event.type === 'tool_result') {
            const row = toolRows.get(event.callId);
            if (!row) return;
            row.classList.remove('is-running');
            row.classList.add(event.ok ? 'is-ok' : 'is-fail');
            if (!replaying && event.ok && row.dataset.tool?.startsWith('browser_'))
                window.dispatchEvent(new CustomEvent('dragon-claw:browser-update', { detail: { tool: row.dataset.tool } }));
            let displaySummary = event.summary || '';
            if (event.ok && /^(?:database_schema|read_database_table|insert_database_row|update_database_rows|delete_database_rows)$/.test(row.dataset.tool || '')) {
                const sepIdx = displaySummary.lastIndexOf(' · ');
                const colonIdx = sepIdx < 0 ? displaySummary.lastIndexOf('：') : -1;
                const splitAt = sepIdx >= 0 ? sepIdx : colonIdx;
                if (splitAt > 0) {
                    const richTarget = displaySummary.slice(0, splitAt).replace(/^(?:insert|update|delete)\s+/i, '').trim();
                    const rightMetric = displaySummary.slice(splitAt + (sepIdx >= 0 ? 3 : 1)).trim();
                    const argsEl = row.querySelector('.dc-tool-args');
                    if (argsEl && richTarget) {
                        argsEl.textContent = richTarget;
                        argsEl.title = richTarget;
                    }
                    if (rightMetric) displaySummary = rightMetric;
                }
            }
            row.querySelector('.dc-tool-state').innerHTML = `${event.ok ? '✓' : '✗'} <span>${escapeHtml(displaySummary)}</span>${event.durationMs > 1500 ? ` <small>${(event.durationMs / 1000).toFixed(1)}s</small>` : ''}`;
            // 命令输出：折叠在工具行下方，需要时展开查看
            if (event.output) row.insertAdjacentHTML('afterend', `<details class="dc-tool-output"><summary>${escapeHtml(tx('toolOutput'))}</summary><pre>${escapeHtml(event.output)}</pre></details>`);
            // 网页截图、看过的图片：工具行下方显示缩略图，点击放大（与对话里的图片同一套预览）
            if (Array.isArray(event.images) && event.images.length && window.ChatFiles) {
                const cf = window.ChatFiles;
                row.insertAdjacentHTML('afterend', `<div class="dc-tool-images">${event.images.map(file => { const name = String(file).split(/[\\/]/).pop(); return cf.imageHtml(cf.fileUrl(file), name, cf.fileUrl(file, true), name); }).join('')}</div>`);
            }
            // 大结果已完整存成文件：挂文件卡片，可打开或下载
            if (event.artifact?.path && window.ChatFiles) row.insertAdjacentHTML('afterend', `<div class="dc-tool-artifact">${window.ChatFiles.chipHtml(event.artifact.path, tx('toolArtifact', { lines: event.artifact.lines || '' }))}</div>`);
            // 写入 / 编辑成功：挂文件卡片，可在对话内预览或看代码；实时生成的 HTML/SVG/Markdown 直接展开预览
            if (event.ok && row.dataset.filePath) attachFileCard(row, row.dataset.filePath, !replaying);
        } else if (event.type === 'plan') {
            // 任务清单：每次更新整份替换，放在工具行上方
            let box = messageEl.querySelector('.dc-todo');
            if (!box) {
                box = document.createElement('div');
                box.className = 'dc-todo';
                const log = toolLogFor(messageEl);
                log.parentNode.insertBefore(box, log);
            }
            const items = Array.isArray(event.items) ? event.items : [];
            const done = items.filter(item => item.status === 'completed').length;
            const dock = window.DragonClawTodoDock;
            if (dock) {
                if (!box.querySelector('.dc-todo-list')) box.innerHTML = '<div class="dc-todo-head"><b></b><span></span></div><ol class="dc-todo-list"></ol>';
                box.querySelector('.dc-todo-head b').textContent = tx('todoTitle');
                box.querySelector('.dc-todo-head span').textContent = `${done}/${items.length}`;
                dock.renderList(box.querySelector('.dc-todo-list'), items);
                // 进行中的清单停靠在输入框上方；历史记录只在消息里显示
                if (!replaying) dock.update(messageEl, items, box);
            } else {
                box.innerHTML = `<div class="dc-todo-head"><b>${escapeHtml(tx('todoTitle'))}</b><span>${done}/${items.length}</span></div><ol>${items.map(item => `<li class="is-${escapeHtml(item.status)}"><span class="dc-todo-mark" aria-hidden="true">${item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '●' : ''}</span><span>${escapeHtml(item.content)}</span></li>`).join('')}</ol>`;
            }
        } else if (event.type === 'question') {
            // 智能体提问：选项按钮点一下就作为下一条消息发送；历史记录里的只读
            const card = document.createElement('div');
            card.className = `dc-question${replaying ? ' is-history' : ''}`;
            const options = Array.isArray(event.options) ? event.options : [];
            card.innerHTML = `<div class="dc-question-hint">${escapeHtml(tx('questionHint'))}</div><div class="dc-question-options">${options.map((option, index) => `<button type="button" class="dc-action" data-answer="${escapeHtml(option)}"${replaying ? ' disabled' : ''}>${index + 1}. ${escapeHtml(option)}</button>`).join('')}</div>`;
            card.addEventListener('click', clickEvent => {
                const button = clickEvent.target.closest('[data-answer]');
                if (!button || card.classList.contains('is-history')) return;
                card.classList.add('is-history');
                button.classList.add('is-chosen');
                card.querySelectorAll('[data-answer]').forEach(node => { node.disabled = true; });
                window.dispatchEvent(new CustomEvent('dragon-claw:answer', { detail: { text: button.dataset.answer } }));
            });
            (messageEl.querySelector('.dc-msg-main') || messageEl).appendChild(card);
        } else if (event.type === 'approval') {
            renderApproval(messageEl, event);
        } else if (event.type === 'approval_result') {
            const card = approvalCards.get(event.callId);
            if (card) settleCard(card, event.decision, event.scope, event);
        } else if (event.type === 'change') {
            if (sourceWorkspace === null || (sourceWorkspace && (sourceWorkspace.root !== state.root || sourceWorkspace.agentSessionId !== state.agentSessionId))) return;
            const index = state.changes.findIndex(item => item.path === event.path);
            const entry = { path: event.path, kind: event.kind, added: event.added, removed: event.removed, from: event.from, revertible: event.revertible !== false, source: event.source || 'agent' };
            if (index >= 0) state.changes[index] = entry; else state.changes.unshift(entry);
            renderChanges();
        }
    }

    function renderWorkspaceChoiceApproval(card, event, preview) {
        const skills = Array.isArray(preview.skills) && preview.skills.length
            ? preview.skills.map(id => `@${String(id).replace(/^@/, '')}`).join('、')
            : tx('workspace');
        const hours = Number(preview.ttlHours) || 24;
        card.dataset.kind = 'workspace_choice';
        card.dataset.ttlHours = String(hours);
        card.innerHTML = `
            <div class="dc-approval-head"><span class="dc-approval-icon" aria-hidden="true">📂</span><b>${escapeHtml(tx('workspaceChoiceTitle', { skills }))}</b></div>
            <div class="dc-approval-cwd">${escapeHtml(tx('workspaceChoiceDesc', { hours }))}</div>
            <div class="dc-approval-actions">
                <button type="button" class="dc-action dc-action--primary" data-decision="select_workspace">📂 ${escapeHtml(tx('workspaceChoicePick'))}</button>
                <button type="button" class="dc-action" data-decision="scratch">⏱ ${escapeHtml(tx('workspaceChoiceTemp', { hours }))}</button>
                <button type="button" class="dc-action dc-action--danger" data-decision="deny">${escapeHtml(tx('workspaceChoiceCancel'))}</button>
            </div>
            <div class="dc-approval-status" hidden></div>`;
        card.addEventListener('click', async clickEvent => {
            const button = clickEvent.target.closest('[data-decision]');
            if (!button || card.classList.contains('is-settled')) return;
            const decision = button.dataset.decision;
            const buttons = card.querySelectorAll('[data-decision]');
            buttons.forEach(node => { node.disabled = true; });
            try {
                const url = `${API}/approvals/${encodeURIComponent(event.id)}`;
                if (decision === 'select_workspace') {
                    const picked = await pickDirectory();
                    if (!picked?.root) {
                        if (!card.classList.contains('is-settled')) buttons.forEach(node => { node.disabled = false; });
                        return;
                    }
                    await request('POST', url, { decision: 'select_workspace', root: picked.root, agentSessionId: picked.agentSessionId });
                    settleCard(card, 'select_workspace', '', { root: picked.root });
                    return;
                }
                if (decision === 'scratch') {
                    await request('POST', url, { decision: 'scratch' });
                    settleCard(card, 'scratch', '', { ttlHours: hours });
                    return;
                }
                await request('POST', url, { decision: 'deny' });
                settleCard(card, 'deny');
            } catch (error) {
                if (!card.classList.contains('is-settled')) buttons.forEach(node => { node.disabled = false; });
                toast(error.message);
            }
        });
    }

    const dockedApprovals = new Map();

    function restoreApproval(card) {
        const marker = dockedApprovals.get(card);
        if (!marker) return;
        if (marker.parentNode) marker.replaceWith(card);
        else card.remove();
        dockedApprovals.delete(card);
        if (!dockedApprovals.size) approvalObserver.disconnect();
    }

    function mountApproval(messageEl, event, card) {
        approvalCards.set(event.callId, card);
        const log = toolLogFor(messageEl);
        log.appendChild(card);
        messageEl.querySelector('.dc-thinking')?.remove();
        if (replaying) return;
        const dock = document.getElementById('dcApprovalDock');
        if (!dock || !messageEl.closest('#dcThread')) {
            card.scrollIntoView({ block: 'nearest' });
            return;
        }
        const marker = document.createComment('approval');
        card.replaceWith(marker);
        if (!dockedApprovals.size) approvalObserver.observe(messageEl.closest('#dcThread'), { childList: true, subtree: true });
        dockedApprovals.set(card, marker);
        dock.appendChild(card);
    }

    const approvalObserver = new MutationObserver(() => {
        for (const [card, marker] of dockedApprovals) {
            if (!marker.isConnected || !marker.parentElement?.closest('#dcThread')) restoreApproval(card);
        }
    });

    function renderApproval(messageEl, event) {
        const card = document.createElement('div');
        card.className = 'dc-approval';
        card.dataset.approvalId = event.id;
        const preview = event.preview || {};
        if (preview.kind === 'workspace_choice') {
            renderWorkspaceChoiceApproval(card, event, preview);
            mountApproval(messageEl, event, card);
            return;
        }
        const kindLabel = toolLabel(event.tool);
        let detail = '';
        // WeLink 写操作（welink_action）：逐项列出要执行的内容，完整命令折叠在下面
        if (Array.isArray(preview.fields)) detail = `${preview.title ? `<div class="dc-approval-path"><b>${escapeHtml(preview.title)}</b>${preview.impact ? ` · ${escapeHtml(preview.impact)}` : ''}</div>` : ''}<table class="dc-approval-fields" style="width:100%;border-collapse:collapse;margin:6px 0;font-size:13px">${preview.fields.map(field => `<tr><th style="text-align:left;vertical-align:top;white-space:nowrap;padding:3px 10px 3px 0;font-weight:500;opacity:.75">${escapeHtml(field.label || field.name || '')}</th><td style="padding:3px 0;white-space:pre-wrap;word-break:break-word">${escapeHtml(field.value ?? '')}</td></tr>`).join('')}</table>${preview.command ? `<details><summary style="cursor:pointer;opacity:.75;font-size:12px">${escapeHtml(tx('approvalCommand'))}</summary><pre class="dc-approval-cmd">${escapeHtml(preview.command)}</pre></details>` : ''}`;
        else if (preview.command) detail = `<pre class="dc-approval-cmd"><span class="dc-approval-prompt">$</span> ${escapeHtml(preview.command)}</pre><div class="dc-approval-cwd">${escapeHtml(tx('inDir'))} ${escapeHtml(shorten(preview.cwd || state.root))}</div>`;
        // 风险命令（访问目录外 / 主目录 / 密钥文件）：写明原因，且不提供「总是允许」
        const risk = Array.isArray(preview.risk) && preview.risk.length ? preview.risk : null;
        if (risk) detail += `<div class="dc-approval-risk"><b>⚠️ ${escapeHtml(tx('riskTitle'))}</b><ul>${risk.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>`;
        // 危险类别（完全访问下也会询问）：可按类别选择不再询问的范围
        const danger = Array.isArray(preview.danger) && preview.danger.length ? preview.danger : null;
        const scopes = danger ? (Array.isArray(preview.dangerScopes) && preview.dangerScopes.length ? preview.dangerScopes : ['session']) : [];
        if (danger) detail += `<div class="dc-approval-risk dc-approval-danger"><b>⛔ ${escapeHtml(tx('dangerTitle', { labels: danger.map(hit => hit.label).join('、') }))}</b><ul>${danger.map(hit => `<li>${escapeHtml(hit.reason)}</li>`).join('')}</ul></div>`;
        else if (preview.diff) detail = `<details class="dc-approval-diff" open><summary>${escapeHtml(preview.path || '')} <span class="wsp-add">+${preview.added || 0}</span> <span class="wsp-del">−${preview.removed || 0}</span></summary><pre class="wsp-diff">${renderDiff(preview.diff)}</pre></details>`;
        else if (preview.to) detail = `<div class="dc-approval-path">${escapeHtml(preview.path)} → ${escapeHtml(preview.to)}</div>`;
        else if (preview.path) detail = `<div class="dc-approval-path">${escapeHtml(preview.path)}${preview.recursive ? ` <em>(${escapeHtml(tx('recursive'))})</em>` : ''}</div>`;
        else if (preview.message) detail = `<div class="dc-approval-path">${escapeHtml(preview.channel || '')} → ${escapeHtml(preview.targets || '')}</div><pre class="dc-approval-cmd">${escapeHtml(preview.message)}</pre>`;
        card.innerHTML = `
            <div class="dc-approval-head"><span class="dc-approval-icon" aria-hidden="true">${toolIcon(event.tool)}</span><b>${escapeHtml(tx('approvalTitle', { tool: kindLabel }))}</b></div>
            ${detail}
            <div class="dc-approval-actions">
                <button type="button" class="dc-action dc-action--primary" data-decision="allow">${escapeHtml(tx('allow'))}</button>
                ${danger ? `<span class="dc-approval-never"><button type="button" class="dc-action" data-decision="always">${escapeHtml(tx('dangerNever'))}</button><select class="dc-approval-scope" aria-label="${escapeHtml(tx('dangerScope'))}">${scopes.map(scope => `<option value="${escapeHtml(scope)}">${escapeHtml(tx(`scope_${scope}`))}</option>`).join('')}</select></span>`
                    : risk || event.noAlways ? '' : `<button type="button" class="dc-action" data-decision="always">${escapeHtml(tx('alwaysAllow'))}</button>`}
                <button type="button" class="dc-action dc-action--danger" data-decision="deny">${escapeHtml(tx('deny'))}</button>
            </div>
            <div class="dc-approval-status" hidden></div>`;
        card.addEventListener('click', async clickEvent => {
            const button = clickEvent.target.closest('[data-decision]');
            if (!button || card.classList.contains('is-settled')) return;
            card.querySelectorAll('[data-decision]').forEach(node => { node.disabled = true; });
            const scope = danger && button.dataset.decision === 'always' ? card.querySelector('.dc-approval-scope')?.value || 'session' : '';
            try {
                // 工作区审批走 agent-workspace；WeLink 写操作的审批卡带自己的地址（只接受该前缀）
                const url = typeof event.approvalUrl === 'string' && event.approvalUrl.startsWith('/api/channels/welink-cli/approvals/') ? event.approvalUrl : `${API}/approvals/${encodeURIComponent(event.id)}`;
                await request('POST', url, { decision: button.dataset.decision, ...(scope ? { scope } : {}) });
                settleCard(card, button.dataset.decision, scope);
            } catch (error) {
                card.querySelectorAll('[data-decision]').forEach(node => { node.disabled = false; });
                toast(error.message);
            }
        });
        mountApproval(messageEl, event, card);
    }

    function settleCard(card, decision, scope = '', meta = {}) {
        restoreApproval(card);
        card.classList.add('is-settled', `is-${decision}`);
        card.querySelector('.dc-approval-actions').hidden = true;
        const status = card.querySelector('.dc-approval-status');
        status.hidden = false;
        if (decision === 'select_workspace') {
            status.textContent = tx('workspaceSelected', { path: shorten(meta.root || '') });
            return;
        }
        if (decision === 'scratch') {
            const hours = Number(meta.ttlHours || card.dataset.ttlHours) || 24;
            status.textContent = tx('workspaceTempAllocated', { hours });
            return;
        }
        if (decision === 'deny' && card.dataset.kind === 'workspace_choice') {
            status.textContent = tx('workspaceChoiceCancelled');
            return;
        }
        if (decision === 'always' && scope) { status.textContent = tx('approvedDanger', { scope: tx(`scope_${scope}`) }); return; }
        status.textContent = { allow: tx('approved'), always: tx('approvedAlways'), deny: tx('denied'), timeout: tx('approvalTimeout'), abort: tx('approvalAborted') }[decision] || decision;
    }

    function finishMessage(messageEl) {
        for (const [card, marker] of dockedApprovals) {
            if (messageEl?.contains(marker)) restoreApproval(card);
        }
        window.DragonClawTodoDock?.finish(messageEl);
        messageEl?.querySelectorAll('.dc-tool-row.is-running').forEach(row => {
            row.classList.remove('is-running');
            row.classList.add('is-fail');
            row.querySelector('.dc-tool-state').innerHTML = `— <span>${escapeHtml(tx('toolInterrupted'))}</span>`;
        });
        messageEl?.querySelectorAll('.dc-approval:not(.is-settled)').forEach(card => settleCard(card, 'abort'));
        messageEl?.querySelectorAll('.dc-sub.is-running').forEach(card => {
            const item = subagents.get(card.dataset.subId);
            if (item) settleSubagent(item, { ok: false, aborted: true });
        });
    }

    function applyDone(data) {
        if (!data) return;
        if (data.agent?.sharedWorkspace) {
            window.DragonClawWorkspace?.setSharedWorkspace?.(data.agent.sharedWorkspace);
        }
        const activeRoot = effectiveRoot();
        if (data.agentSessionId && data.agentSessionId !== state.agentSessionId && !isSharedLocked()) return;
        if (data.agent?.root && data.agent.root !== activeRoot) return;
        if (data.agent?.sharedWorkspace?.virtualRoot && data.agent.sharedWorkspace.virtualRoot !== activeRoot) return;
        if (data.context) state.context = data.context;
        if (Array.isArray(data.changes)) state.changes = data.changes.map(item => ({ ...item, source: item.source || 'agent' }));
        if (data.agent?.gitBranch !== undefined) state.gitBranch = data.agent.gitBranch || state.gitBranch;
        renderContext();
        renderChanges();
        renderEnv();
        refreshGit();
        refreshChanges(); // 合并 git 工作区里的其他改动
        decorateCheckpoints();
    }

    // ── 事件绑定 ────────────────────────────────────────
    function positionContextMenu(details) {
        const menu = details.querySelector('.dc-context-menu');
        if (!menu || !details.open) return;
        const pad = 12, gap = 8, anchor = details.querySelector('summary').getBoundingClientRect();
        // Measure the real content instead of deciding from a fixed 180px threshold.
        menu.style.transform = 'none'; menu.style.right = menu.style.bottom = 'auto';
        menu.style.maxHeight = `${Math.max(0, Math.min(440, innerHeight - pad * 2))}px`;
        const above = Math.max(0, anchor.top - gap - pad), below = Math.max(0, innerHeight - anchor.bottom - gap - pad);
        const desired = menu.offsetHeight;
        const down = desired > above && below > above;
        menu.dataset.placement = down ? 'below' : 'above';
        menu.style.maxHeight = `${Math.floor(Math.min(440, down ? below : above))}px`;
        const parent = menu.offsetParent;
        if (!parent) return;
        const origin = parent.getBoundingClientRect();
        const x = Math.max(pad, Math.min(anchor.left, innerWidth - menu.offsetWidth - pad));
        const y = Math.max(pad, Math.min(down ? anchor.bottom + gap : anchor.top - gap - menu.offsetHeight, innerHeight - menu.offsetHeight - pad));
        menu.style.left = `${x - origin.left - parent.clientLeft + parent.scrollLeft}px`;
        menu.style.top = `${y - origin.top - parent.clientTop + parent.scrollTop}px`;
        menu.style.transformOrigin = down ? 'top left' : 'bottom left';
    }

    function bind() {
        el.chip?.addEventListener('toggle', event => {
            if (!event.target.open) return;
            window.HomeComposer?.close?.();window.HomeAgentDiscussion?.closePicker?.();window.DragonClawSkills?.closeSuggestions?.();
            el.chip.querySelectorAll('details[open]').forEach(node => { if (node !== event.target) node.open = false; });
            positionContextMenu(event.target);
            event.target.querySelector('input[type=search]')?.focus({preventScroll:true});
        }, true);
        const positionOpenMenus = () => el.chip?.querySelectorAll('details[open]').forEach(positionContextMenu);
        window.addEventListener('resize', positionOpenMenus);
        document.addEventListener('scroll', event => { if (!event.target.closest?.('.dc-context-menu')) positionOpenMenus(); }, true);
        el.chip?.addEventListener('input', event => {
            if (!event.target.matches('[data-wsp-recent-search], [data-wsp-branch-search]')) return;
            const menu = event.target.closest('.dc-context-menu'), query = event.target.value.trim().toLowerCase();
            const branchSearch = event.target.matches('[data-wsp-branch-search]');
            const options = [...menu.querySelectorAll(branchSearch ? '[data-wsp-branch]' : '[data-wsp-select]')];
            options.forEach((button, index) => { button.hidden = !button.title.toLowerCase().includes(query) || (!branchSearch && !query && index >= 4); });
            const empty = menu.querySelector('.dc-context-empty');
            empty.hidden = options.some(button => !button.hidden);
            if (!branchSearch) empty.textContent = query ? wsLabel('未找到匹配的工作空间', 'No matching workspaces') : wsLabel('暂无最近工作空间', 'No recent workspaces');
            positionContextMenu(event.target.closest('details'));

        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            el.chip?.querySelectorAll('details[open]').forEach(node => { node.open = false; node.querySelector('summary').focus(); });
        });
        document.addEventListener('click', event => {
            if (!el.chip?.contains(event.target) || event.target.closest('[data-wsp-action], [data-wsp-select], [data-wsp-mode]')) el.chip?.querySelectorAll('details[open]').forEach(node => { node.open = false; });
            const branch = event.target.closest('[data-wsp-branch]');
            if (branch && !branch.disabled && el.chip?.contains(branch)) { el.chip.querySelectorAll('details[open]').forEach(node => node.open = false);changeBranch(branch.dataset.wspBranch);return; }
            const action = event.target.closest('[data-wsp-action]');
            if (action && (el.panel.contains(action) || el.chip?.contains(action))) {
                if (action.dataset.wspAction === 'shared-locked-tip') toast(sharedLockedMessage());
                else if (action.dataset.wspAction === 'create-workspace') createWorkspace();
                else if (action.dataset.wspAction === 'new-worktree') createWorktree();
                else if (action.dataset.wspAction === 'commit-worktree') commitWorktree();
                else if (action.dataset.wspAction === 'merge-worktree') mergeCurrentWorktree();
                else if (action.dataset.wspAction === 'remove-worktree') removeTargetWorktree(state.root);
                else if (action.dataset.wspAction === 'new-branch') {
                    if (isReadOnly() || workspaceBusy()) return;
                    window.AppDialog.prompt(wsLabel('输入新的 Git 分支名称', 'Enter a new Git branch name'), {title:wsLabel('新建分支', 'New branch'),defaultValue:'codex/task',maxLength:160}).then(name => { if(name?.trim())changeBranch(name.trim(),true); });
                }
                else if (action.dataset.wspAction === 'change') openPicker();
                else if (action.dataset.wspAction === 'clear') clearDirectory();
                else if (action.dataset.wspAction === 'panel') setOpen(!state.open);
                return;
            }
            const removeWtBtn = event.target.closest('[data-wsp-remove-wt]');
            if (removeWtBtn && el.chip?.contains(removeWtBtn)) {
                el.chip.querySelectorAll('details[open]').forEach(node => { node.open = false; });
                removeTargetWorktree(removeWtBtn.dataset.wspRemoveWt);
                return;
            }
            const annotateBtn = event.target.closest('[data-wsp-diff-annotate]');
            if (annotateBtn && el.panel.contains(annotateBtn)) {
                state.diffEditor = {
                    path: annotateBtn.dataset.wspDiffPath || state.openDiff?.path || '',
                    lineKey: annotateBtn.dataset.wspDiffAnnotate,
                    lineNum: Number(annotateBtn.dataset.wspDiffNum) || 1,
                    side: annotateBtn.dataset.wspDiffSide || 'new',
                    code: annotateBtn.dataset.wspDiffCode || '',
                    draft: ''
                };
                renderChanges();
                requestAnimationFrame(() => el.panel.querySelector('[data-wsp-diff-input]')?.focus());
                return;
            }
            const saveNoteBtn = event.target.closest('[data-wsp-diff-save]');
            if (saveNoteBtn && el.panel.contains(saveNoteBtn)) {
                const input = el.panel.querySelector('[data-wsp-diff-input]');
                const comment = String(input?.value ?? state.diffEditor?.draft ?? '').trim();
                if (comment && state.diffEditor) {
                    state.diffNotes.push({
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        path: state.diffEditor.path,
                        lineKey: state.diffEditor.lineKey,
                        lineNum: state.diffEditor.lineNum,
                        side: state.diffEditor.side,
                        code: state.diffEditor.code,
                        comment
                    });
                    state.diffEditor = null;
                    renderChanges();
                } else {
                    input?.focus();
                }
                return;
            }
            const cancelNoteBtn = event.target.closest('[data-wsp-diff-cancel]');
            if (cancelNoteBtn && el.panel.contains(cancelNoteBtn)) {
                state.diffEditor = null;
                renderChanges();
                return;
            }
            const delNoteBtn = event.target.closest('[data-wsp-note-del]');
            if (delNoteBtn && el.panel.contains(delNoteBtn)) {
                state.diffNotes = state.diffNotes.filter(n => n.id !== delNoteBtn.dataset.wspNoteDel);
                renderChanges();
                return;
            }
            const sendNotesBtn = event.target.closest('[data-wsp-notes-send]');
            if (sendNotesBtn && el.panel.contains(sendNotesBtn)) {
                sendDiffNotes(sendNotesBtn.dataset.wspNotesSend === 'send');
                return;
            }
            const clearNotesBtn = event.target.closest('[data-wsp-notes-clear]');
            if (clearNotesBtn && el.panel.contains(clearNotesBtn)) {
                state.diffNotes = [];
                state.diffEditor = null;
                renderChanges();
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
            const toggleChangesBtn = event.target.closest('[data-wsp-changes-toggle]');
            if (toggleChangesBtn && el.panel.contains(toggleChangesBtn)) {
                state.expandChanges = !state.expandChanges;
                renderChanges();
                return;
            }
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
                if (viewBtn) {
                    fileCard.dataset.userOpened = '1';
                    showFileView(fileCard, viewBtn.dataset.fileView);
                }
                else if (actionBtn?.dataset.fileAction === 'expand') toggleExpand(fileCard);
                else if (actionBtn?.dataset.fileAction === 'download') downloadFile(fileCard);
                return;
            }
            const head = event.target.closest('.wsp-card-head');
            if (head && el.panel.contains(head)) {
                const card = head.closest('.wsp-card');
                if (card === el.performanceCard) performanceManual = true;
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
            const diffInput = event.target?.closest?.('[data-wsp-diff-input]');
            if (diffInput && el.panel.contains(diffInput)) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    el.panel.querySelector('[data-wsp-diff-save]')?.click();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    state.diffEditor = null;
                    renderChanges();
                }
                return;
            }
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
                suggest();
                return;
            }
            const item = event.target.closest('[data-wsp-index]');
            if (item) {
                state.picker.active = Number(item.dataset.wspIndex);
                completeActive();
            }
        });
        el.pickerInput.addEventListener('input', scheduleSuggest);
        el.pickerHidden.addEventListener('change', () => suggest());
        el.pickerClear.addEventListener('click', () => { el.pickerInput.value = ''; el.pickerInput.focus(); suggest(); });
        el.pickerSelect.addEventListener('click', () => confirmPicker());
        el.pickerInput.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(state.picker.active + 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(state.picker.active - 1); }
            else if (event.key === 'Tab' || (event.key === 'ArrowRight' && el.pickerInput.selectionStart === el.pickerInput.value.length)) {
                if (state.picker.items.length) { event.preventDefault(); completeActive(); }
            } else if (event.key === 'Enter') {
                event.preventDefault();
                if (!el.pickerSelect.disabled) confirmPicker();
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
        if (el.panel) return;
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
        el.extCard = document.createElement('section');
        el.extCard.className = 'wsp-card wsp-card--external is-open';
        el.extCard.dataset.card = 'external';
        el.extCard.innerHTML = '<button type="button" class="wsp-card-head" aria-expanded="true"><span data-wsp-ext-title></span><span class="wsp-card-meta" data-wsp-ext-meta></span><i class="wsp-caret" aria-hidden="true"></i></button><div class="wsp-card-body" data-wsp-ext-body></div>';
        el.panel.appendChild(el.extCard);
        window.SidebarResize?.bind({ panel: el.panel, cssVar: '--workspace-panel-width', storageKey: 'dragon_workspace_sidebar_width' });
        el.performanceCard = document.createElement('section');
        el.performanceCard.className = 'wsp-card';
        el.performanceCard.dataset.card = 'performance';
        el.performanceCard.innerHTML = '<button type="button" class="wsp-card-head" aria-expanded="false"><span data-performance-title></span><span class="wsp-card-meta"></span><i class="wsp-caret" aria-hidden="true"></i></button><div class="wsp-card-body"></div>';
        el.ctxBody.closest('.wsp-card').before(el.performanceCard);
        renderPerformance();
        bind();
        // 非对话页面期间隐藏工作区；未启用工作区时频道卡片也借用面板，所以在能力检测之前就挂上
        window.addEventListener('home:hub', event => suspendFor('hub', Boolean(event.detail?.open)));
        window.addEventListener('home:tool-frame', event => suspendFor('tool', Boolean(event.detail?.open)));
        if (document.body.classList.contains('v2-hub-open')) state.suspendedBy.add('hub');
        if (document.body.classList.contains('v2-tool-open')) state.suspendedBy.add('tool');
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
        // 主页的新建对话始终保持收起，不恢复上次面板的展开状态。
        // 手动或其他程序改了文件也能看到：回到页面时、面板打开期间每 15 秒刷新一次
        window.addEventListener('focus', refreshChanges);
        window.addEventListener('focus', refreshGit);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshChanges(); });
        setInterval(() => { if (state.open && document.visibilityState === 'visible') refreshChanges(); }, 15000);
    }

    // 外部卡片：其他模块（如 WeLink 对话的跟进与记忆）借用右侧工作区面板展示内容，工作区未启用时也可用。
    function showExternal({ title = '', meta = '', open } = {}) {
        if (!el.panel || !el.extCard) return null;
        if (!state.external) state.external = { previousOpen: state.open };
        el.panel.classList.add('is-external');
        el.extCard.querySelector('[data-wsp-ext-title]').textContent = title;
        el.extCard.querySelector('[data-wsp-ext-meta]').textContent = meta;
        const shouldOpen = open !== undefined ? open : !isDrawerMode();
        if (shouldOpen) setOpen(true);
        return el.extCard.querySelector('[data-wsp-ext-body]');
    }

    function hideExternal() {
        if (!state.external) return;
        const { previousOpen } = state.external;
        state.external = null;
        el.panel.classList.remove('is-external');
        el.extCard.querySelector('[data-wsp-ext-body]').innerHTML = '';
        setOpen(previousOpen && state.enabled);
    }

    window.DragonClawWorkspace = {
        init,
        showExternal,
        hideExternal,
        mountFilePreview(node) {
            if (!el.panel) return false;
            if (!state.filePreview) state.filePreview = { previousOpen: state.open, scrollTop: el.panel.scrollTop };
            el.panel.classList.add('has-file-preview');
            el.panel.appendChild(node);
            setOpen(true);
            return true;
        },
        unmountFilePreview() {
            if (!state.filePreview) return;
            const { previousOpen, scrollTop } = state.filePreview;
            state.filePreview = null;
            el.panel.classList.remove('has-file-preview');
            setOpen(previousOpen);
            el.panel.scrollTop = scrollTop;
        },
        openPanel: () => setOpen(true),
        closePanel: () => setOpen(false, { remember: false }),
        isPanelOpen: () => state.open,
        isEnabled: () => state.enabled,
        isSharedLocked,
        setSharedWorkspace(info) {
            const next = info && info.enabled ? info : null;
            const prev = state.sharedWorkspace;
            if (JSON.stringify(prev) === JSON.stringify(next)) return;
            state.sharedWorkspace = next;
            if (el.toggle) el.toggle.hidden = !(state.enabled || isSharedLocked());
            if (el.fab) el.fab.hidden = !(state.enabled || isSharedLocked());
            renderAll();
            if (isSharedLocked()) restoreState();
        },
        hasWorkspace: () => Boolean(state.root || isSharedLocked()),
        getWorkspacePayload() {
            if (isSharedLocked()) {
                return { agentSessionId: state.agentSessionId || 'shws', sharedWorkspaceId: state.sharedWorkspace.shareId, permissionMode: state.permissionMode };
            }
            if (!state.enabled || !state.root) return null;
            return { agentSessionId: state.agentSessionId, root: state.root, permissionMode: state.permissionMode };
        },
        // 恢复历史对话：自动选回当时的目录、接回它的智能体会话，并恢复上下文与实际改动。
        // 目录已不存在时提示并保持未选目录，对话照常恢复。
        async resumeWorkspace({ agentSessionId, root } = {}) {
            if (state.pr?.phase === 'running') throw new Error(tx('prRunning'));
            if (isSharedLocked()) { renderAll(); restoreState(); return true; }
            const ticket = ++state.selectionEpoch;
            // 切到没有关联目录的对话：工作区与这个对话无关，自动收起
            if (!state.enabled || !agentSessionId || !root || isScratchDirectory(root)) { clearDirectory(); this.resetSession(); if (!state.external && !state.filePreview) setOpen(false, { remember: false }); return false; }
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
            state.diffNotes = [];
            state.diffEditor = null;
            state.expandChanges = false;
            state.context = null;
            renderContext();
            renderChanges();
            return true;
        },
        resetSession({ clearWorkspace = false } = {}) {
            setOpen(false, { remember: false });
            if (clearWorkspace) clearDirectory();
            state.selectionEpoch += 1;
            if (state.pr?.phase === 'running') state.pr.controller?.abort();
            state.pr = null;
            prLog.innerHTML = '';
            state.agentSessionId = newSessionId();
            state.changes = [];
            state.openDiff = null;
            state.diffNotes = [];
            state.diffEditor = null;
            state.expandChanges = false;
            state.context = null;
            performanceMessage = null; performanceRounds = []; performanceManual = false;
            el.performanceCard?.classList.remove('is-open');
            el.performanceCard?.querySelector('button').setAttribute('aria-expanded', 'false');
            renderPerformance();
            for (const card of dockedApprovals.keys()) restoreApproval(card);
            approvalCards.clear();
            toolRows.clear();
            document.querySelectorAll('.dc-file-card.is-expanded').forEach(card => toggleExpand(card, false));
            renderContext();
            renderChanges();
        },
        performance: updatePerformance,
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
                    if (!event || event.type === 'change' || event.type === 'model_round') continue;
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
        decorateCheckpoints,
        applyCompaction(data) {
            if (data.agentSessionId !== state.agentSessionId || data.root !== state.root) return;
            state.context = null; // 下一轮请求按压缩后的实际内容重新计算，避免继续展示旧占用。
            renderContext();
            el.ctxBody.innerHTML = `<div class="wsp-empty">${escapeHtml(tx('ctxCompacted'))}</div>`;
        },
        open: () => setOpen(true),
        close: () => setOpen(false),
        toggle: () => setOpen(!state.open),
        openPicker,
        selectDirectory: (path, options) => selectDirectory(path, undefined, options),
        getRoot: () => state.root,
        loadFile,
        clearDirectory,
        refreshTexts: renderAll
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
