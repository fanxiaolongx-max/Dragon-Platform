// Dragon Claw 右侧终端面板：
// - 「Agent」标签：实时显示智能体 run_command 的执行过程（只读），命令开始时自动展开面板；
// - 用户标签：管理员可新建多个交互式终端（macOS / Linux：zsh、bash…；Windows：PowerShell、CMD），
//   服务端用 node-pty 提供真终端，缺少时退化为逐行执行（本地回显）。刷新页面后会重新连接仍在运行的终端并回放输出。
(function () {
    'use strict';
    const L = (zh, en) => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const isAdmin = () => localStorage.getItem('tools_role') === 'admin';
    const AUTO_KEY = 'dragon_terminal_auto_open';
    const ICONS = {
        plus: '<path d="M10 4v12M4 10h12"/>', caret: '<path d="m6 8 4 4 4-4"/>', close: '<path d="m5 5 10 10M15 5 5 15"/>',
        clear: '<path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/>', stop: '<rect x="5" y="5" width="10" height="10" rx="1.5"/>',
        agent: '<rect x="4" y="6" width="12" height="10" rx="2"/><path d="M10 3v3M7.5 11h.01M12.5 11h.01"/>',
        shell: '<path d="m4 6 4 4-4 4M10 15h6"/>', copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M4 13V5.5A1.5 1.5 0 0 1 5.5 4H13"/>', pin: '<path d="M10 3v8M6 7l4 4 4-4M4 16h12"/>'
    };
    const icon = name => `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

    let panel, toggle, tabsNode, body, menuNode, statusNode;
    let open = false, info = null, activeId = 'agent', xtermReady = null;
    const tabs = new Map(); // id → { id, kind:'agent'|'shell', title, term, fit, node, ... }
    const agentQueue = []; // xterm 尚未加载时缓存 Agent 输出
    let agentRunning = 0;

    function headers(json) {
        const result = { ...(window.getAuthHeaderForNav?.() || {}) };
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        if (token && !result.Authorization) result.Authorization = `Bearer ${token}`;
        if (json) result['Content-Type'] = 'application/json';
        return result;
    }
    async function api(path, { method = 'GET', body: payload } = {}) {
        const res = await fetch(`/api/terminal${path}`, { method, headers: headers(payload !== undefined), body: payload === undefined ? undefined : JSON.stringify(payload) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    // ── xterm.js 按需加载 ─────────────────────────────
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const node = document.createElement('script');
            node.src = src; node.onload = resolve; node.onerror = () => reject(new Error(`load ${src}`));
            document.head.append(node);
        });
    }
    function ensureXterm() {
        if (xtermReady) return xtermReady;
        if (!document.querySelector('link[data-xterm-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet'; link.href = './tp-static/frontend/js/vendor/xterm/xterm.css'; link.dataset.xtermCss = '1';
            document.head.append(link);
        }
        xtermReady = (window.Terminal ? Promise.resolve() : loadScript('./tp-static/frontend/js/vendor/xterm/xterm.js'))
            .then(() => Promise.all([
                window.FitAddon ? null : loadScript('./tp-static/frontend/js/vendor/xterm/addon-fit.js'),
                window.WebLinksAddon ? null : loadScript('./tp-static/frontend/js/vendor/xterm/addon-web-links.js')
            ]))
            .catch(error => { xtermReady = null; throw error; });
        return xtermReady;
    }
    function theme() {
        const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
        return dark
            ? { background: '#0d1117', foreground: '#e6edf3', cursor: '#e6edf3', selectionBackground: '#3b82f655', black: '#484f58', brightBlack: '#6e7681' }
            : { background: '#ffffff', foreground: '#1f2328', cursor: '#1f2328', selectionBackground: '#3b82f633', black: '#24292f', brightBlack: '#57606a', white: '#6e7781', brightWhite: '#8c959f', yellow: '#9a6700', brightYellow: '#7d4e00' };
    }
    function makeTerm(options = {}) {
        const term = new window.Terminal({
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "Microsoft YaHei Mono", monospace',
            fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, allowProposedApi: false,
            rightClickSelectsWord: false, macOptionClickForcesSelection: true,
            theme: theme(), ...options
        });
        const fit = new window.FitAddon.FitAddon();
        term.loadAddon(fit);
        // 输出里的网址可点击（含自动换行折断的长链接），在新标签页打开
        if (window.WebLinksAddon) term.loadAddon(new window.WebLinksAddon.WebLinksAddon((event, uri) => {
            event.preventDefault();
            window.open(uri, '_blank', 'noopener,noreferrer');
        }));
        return { term, fit };
    }

    // ── 复制 ─────────────────────────────────────────
    async function copyText(text) {
        if (!text) return false;
        try { await navigator.clipboard.writeText(text); return true; } catch (_error) { /* 非安全上下文：退回 execCommand */ }
        const area = document.createElement('textarea');
        area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.append(area); area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_error) { ok = false; }
        area.remove();
        return ok;
    }
    // 整个缓冲区的纯文本：自动换行折断的行拼回一行
    function bufferText(term) {
        const buffer = term.buffer.active;
        const lines = [];
        for (let i = 0; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (!line) continue;
            const text = line.translateToString(true);
            if (line.isWrapped && lines.length) lines[lines.length - 1] += text; else lines.push(text);
        }
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        return lines.join('\n');
    }
    async function copyFrom(tab, { all = false } = {}) {
        if (!tab?.term) return;
        const selection = tab.term.getSelection();
        const text = selection && !all ? selection : bufferText(tab.term);
        const ok = await copyText(text);
        flash(ok ? (selection && !all ? L('已复制选中内容', 'Selection copied') : L('已复制全部输出', 'All output copied')) : L('复制失败，请用快捷键重试', 'Copy failed, try the keyboard shortcut'), !ok);
    }
    function flash(message, error = false) {
        statusNode.textContent = message;
        statusNode.classList.toggle('is-error', error);
        clearTimeout(flash.timer);
        flash.timer = setTimeout(() => { statusNode.classList.remove('is-error'); renderTabs(); }, 2200);
    }

    // ── 标签栏 ───────────────────────────────────────
    function renderTabs() {
        if (!tabsNode) return;
        tabsNode.innerHTML = [...tabs.values()].map(tab => {
            const current = tab.id === activeId;
            const state = tab.kind === 'agent' ? (agentRunning ? 'running' : '') : (tab.exited ? 'exited' : tab.connecting ? 'connecting' : '');
            return `<div class="dc-term-tab${current ? ' is-active' : ''}" role="presentation" data-state="${state}">
                <button type="button" role="tab" aria-selected="${current}" data-term-tab="${esc(tab.id)}" title="${esc(tab.cwd || tab.title)}">${icon(tab.kind === 'agent' ? 'agent' : 'shell')}<span>${esc(tab.title)}</span>${state === 'running' ? '<i class="dc-term-dot" aria-hidden="true"></i>' : ''}</button>
                ${tab.kind === 'shell' ? `<button type="button" class="dc-term-tab-close" data-term-close="${esc(tab.id)}" aria-label="${esc(L('关闭终端', 'Close terminal'))}">${icon('close')}</button>` : ''}
            </div>`;
        }).join('');
        const tab = tabs.get(activeId);
        statusNode.textContent = !tab ? '' : tab.kind === 'agent'
            ? (agentRunning ? L('智能体正在执行命令…', 'Agent is running a command…') : L('智能体执行的命令会实时显示在这里', 'Commands run by the agent appear here live'))
            : tab.exited ? L(`已退出（${tab.exitCode ?? '-'}）`, `Exited (${tab.exitCode ?? '-'})`) : `${tab.shellLabel || ''}${tab.pty === false ? L(' · 简易模式', ' · basic mode') : ''} · ${tab.cwd || ''}`;
        panel.querySelector('[data-term-action="interrupt"]').hidden = !tab || tab.kind === 'agent' || tab.exited;
    }
    function select(id) {
        if (!tabs.has(id)) id = 'agent';
        activeId = id;
        for (const tab of tabs.values()) if (tab.node) tab.node.hidden = tab.id !== id;
        renderTabs();
        const tab = tabs.get(id);
        requestAnimationFrame(() => { fitTab(tab); if (open && tab?.kind === 'shell') tab.term?.focus(); });
    }
    function fitTab(tab) {
        if (!tab?.term || !tab.node || tab.node.hidden || !open) return;
        try { tab.fit.fit(); } catch (_error) { return; }
        if (tab.kind === 'shell' && !tab.exited && (tab.cols !== tab.term.cols || tab.rows !== tab.term.rows)) {
            tab.cols = tab.term.cols; tab.rows = tab.term.rows;
            clearTimeout(tab.resizeTimer);
            tab.resizeTimer = setTimeout(() => api(`/sessions/${tab.id}/resize`, { method: 'POST', body: { cols: tab.cols, rows: tab.rows } }).catch(() => {}), 120);
        }
    }

    // ── Agent 标签 ───────────────────────────────────
    async function ensureAgentTab() {
        const tab = tabs.get('agent');
        if (tab.term) return tab;
        await ensureXterm();
        if (tab.term) return tab;
        const { term, fit } = makeTerm({ convertEol: true, disableStdin: true, cursorBlink: false, cursorStyle: 'bar', cursorInactiveStyle: 'none' });
        Object.assign(tab, { term, fit });
        term.open(tab.node);
        // 只读终端也要能用快捷键复制
        term.attachCustomKeyEventHandler(event => {
            if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) { copyFrom(tab); return false; }
            return true;
        });
        term.writeln(`\x1b[2m${L('Dragon Claw · 智能体命令输出', 'Dragon Claw · agent command output')}\x1b[0m`);
        agentQueue.splice(0).forEach(text => term.write(text));
        return tab;
    }
    function agentWrite(text) {
        const tab = tabs.get('agent');
        if (tab.term) tab.term.write(text); else { agentQueue.push(text); if (agentQueue.length > 2000) agentQueue.splice(0, agentQueue.length - 2000); }
    }
    const folderName = cwd => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '~';
    function onCommand(event) {
        if (!event?.type) return;
        if (event.type === 'command_start') {
            agentRunning += 1;
            const time = new Date(event.startedAt || Date.now()).toLocaleTimeString(undefined, { hour12: false });
            agentWrite(`\r\n\x1b[2m${time}\x1b[0m \x1b[36m${folderName(event.cwd)}\x1b[0m \x1b[1;32m❯\x1b[0m \x1b[1m${String(event.command || '').replace(/\n/g, '\r\n  ')}\x1b[0m\r\n`);
            if (!open && localStorage.getItem(AUTO_KEY) !== '0' && innerWidth > 860) show({ tab: 'agent', auto: true });
            else if (open && tabs.get(activeId)?.kind !== 'shell') select('agent');
            renderTabs();
        } else if (event.type === 'command_terminal') {
            // 交互式命令：在独立标签里以真终端运行，用户直接在里面输入；强制打开面板并聚焦
            agentWrite(`\x1b[33m↳ ${L('该命令需要你输入，已在「', 'This command needs your input — opened in the "')}${String(event.title || '').slice(0, 40)}${L('」标签打开交互终端', '" tab')}\x1b[0m\r\n`);
            addShellTab({ id: event.terminalId, title: `⌨ ${String(event.title || L('交互命令', 'Interactive')).slice(0, 40)}`, cwd: event.cwd, pty: event.pty, shellLabel: event.shellLabel, interactiveCommand: true });
            show({ tab: event.terminalId });
            flash(L('命令正在等待你的输入，请在终端里操作', 'The command is waiting for your input in the terminal'));
        } else if (event.type === 'command_output') {
            agentWrite(String(event.data || ''));
        } else if (event.type === 'command_end') {
            agentRunning = Math.max(0, agentRunning - 1);
            const seconds = event.durationMs ? ` · ${(event.durationMs / 1000).toFixed(event.durationMs < 10000 ? 1 : 0)}s` : '';
            agentWrite(event.ok ? `\x1b[32m✓ ${L('完成', 'done')}${event.exitCode != null ? ` (exit ${event.exitCode})` : ''}${seconds}\x1b[0m\r\n`
                : `\x1b[31m✗ ${String(event.summary || L('失败', 'failed')).replace(/[\x00-\x1f]/g, ' ')}${seconds}\x1b[0m\r\n`);
            renderTabs();
        }
    }

    // ── 用户终端 ─────────────────────────────────────
    function addShellTab(session) {
        if (tabs.has(session.id)) return tabs.get(session.id);
        const node = document.createElement('div');
        node.className = 'dc-term-view'; node.hidden = true;
        body.append(node);
        const tab = { ...session, kind: 'shell', node, connecting: true, line: '', inputQueue: '', sending: false };
        tabs.set(session.id, tab);
        mountShell(tab).catch(error => showError(error.message));
        return tab;
    }
    async function mountShell(tab) {
        await ensureXterm();
        const { term, fit } = makeTerm();
        Object.assign(tab, { term, fit });
        term.open(tab.node);
        term.onData(data => tab.pty === false ? localEdit(tab, data) : sendInput(tab, data));
        // Ctrl/Cmd+Shift+C / V：复制粘贴；Ctrl+C 交给终端（中断）
        term.attachCustomKeyEventHandler(event => {
            if (event.type !== 'keydown') return true;
            const mod = event.ctrlKey || event.metaKey;
            // 有选中内容时 ⌘C / Ctrl+C / Ctrl+Shift+C 复制；没有选中时 Ctrl+C 仍是中断
            if (mod && event.key.toLowerCase() === 'c' && (term.hasSelection() || event.shiftKey)) { copyFrom(tab); return false; }
            if (event.metaKey && event.key.toLowerCase() === 'k') { term.clear(); return false; }
            return true;
        });
        if (tab.id === activeId) { fitTab(tab); if (open) term.focus(); }
        connect(tab);
    }
    // 管道模式没有服务端回显：本地处理行编辑，回车整行发送
    function localEdit(tab, data) {
        for (const ch of data) {
            if (ch === '\r') { tab.term.write('\r\n'); sendInput(tab, `${tab.line}\r`); tab.line = ''; }
            else if (ch === '\x7f' || ch === '\b') { if (tab.line) { tab.line = tab.line.slice(0, -1); tab.term.write('\b \b'); } }
            else if (ch === '\x03') { tab.line = ''; tab.term.write('^C\r\n'); api(`/sessions/${tab.id}/interrupt`, { method: 'POST' }).catch(() => {}); }
            else if (ch >= ' ' || ch === '\t') { tab.line += ch; tab.term.write(ch); }
        }
    }
    function sendInput(tab, data) {
        if (tab.exited) return;
        tab.inputQueue += data;
        if (tab.sending) return;
        tab.sending = true;
        // 按顺序发送；同一批次内的按键合并成一次请求
        setTimeout(async function drain() {
            const chunk = tab.inputQueue; tab.inputQueue = '';
            try { await api(`/sessions/${tab.id}/input`, { method: 'POST', body: { data: chunk } }); }
            catch (error) { tab.term?.write(`\r\n\x1b[31m${error.message}\x1b[0m\r\n`); }
            if (tab.inputQueue) setTimeout(drain, 0); else tab.sending = false;
        }, 8);
    }
    async function connect(tab, attempt = 0) {
        if (!tabs.has(tab.id) || tab.exited) return;
        tab.controller?.abort();
        const controller = tab.controller = new AbortController();
        tab.connecting = true; renderTabs();
        let gotSnapshot = false;
        try {
            const res = await fetch(`/api/terminal/sessions/${encodeURIComponent(tab.id)}/stream`, { headers: headers(), signal: controller.signal });
            if (res.status === 404) { markExited(tab, null, L('终端已不存在（服务已重启或已超时关闭）', 'Terminal no longer exists (server restarted or timed out)')); return; }
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let index;
                while ((index = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
                    if (!line) continue;
                    let event; try { event = JSON.parse(line); } catch { continue; }
                    if (event.type === 'snapshot') {
                        gotSnapshot = true; attempt = 0;
                        tab.term.reset();
                        if (event.data) tab.term.write(event.data);
                        Object.assign(tab, { pty: event.session.pty, cwd: event.session.cwd, shellLabel: event.session.shellLabel, connecting: false });
                        renderTabs(); fitTab(tab);
                    } else if (event.type === 'data') tab.term.write(event.data);
                    else if (event.type === 'exit') { markExited(tab, event.exitCode); return; }
                }
            }
        } catch (error) {
            if (controller.signal.aborted) return;
        }
        if (controller.signal.aborted || !tabs.has(tab.id) || tab.exited) return;
        // 断线重连（网络抖动、代理超时）；回放会覆盖重复内容
        const delay = Math.min(10000, 500 * 2 ** Math.min(attempt, 5));
        tab.connecting = true; renderTabs();
        setTimeout(() => connect(tab, gotSnapshot ? 0 : attempt + 1), delay);
    }
    function markExited(tab, code, note) {
        tab.exited = true; tab.exitCode = code; tab.connecting = false;
        tab.term?.write(`\r\n\x1b[2m${note || L(`[进程已退出 ${code ?? ''}] 关闭此标签或新建一个终端`, `[Process exited ${code ?? ''}] Close this tab or open a new terminal`)}\x1b[0m\r\n`);
        renderTabs();
    }
    async function newTerminal(shell) {
        if (!isAdmin()) return showError(L('只有管理员可以打开终端', 'Only administrators can open a terminal'));
        try {
            const cwd = window.DragonClawWorkspace?.getWorkspacePayload?.()?.root || '';
            const count = [...tabs.values()].filter(tab => tab.kind === 'shell').length;
            const shellInfo = info?.shells?.find(item => item.id === shell) || info?.shells?.find(item => item.default);
            const { session } = await api('/sessions', { method: 'POST', body: { shell: shellInfo?.id, cwd, cols: 100, rows: 30, title: `${shellInfo?.label || L('终端', 'Terminal')}${count ? ` ${count + 1}` : ''}` } });
            addShellTab(session);
            select(session.id);
        } catch (error) { showError(error.message); }
    }
    async function closeTab(id) {
        const tab = tabs.get(id);
        if (!tab || tab.kind !== 'shell') return;
        tab.controller?.abort();
        tabs.delete(id);
        tab.term?.dispose(); tab.node.remove();
        if (activeId === id) select([...tabs.keys()].at(-1) || 'agent'); else renderTabs();
        api(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    }
    async function restoreSessions() {
        if (!isAdmin()) return;
        try {
            const data = await api('/sessions');
            info = { pty: data.pty, shells: data.shells, platform: data.platform };
            renderMenu();
            for (const session of data.items || []) if (!session.exited) addShellTab(session);
            renderTabs();
        } catch (_error) { /* 旧服务端或无权限：只保留 Agent 标签 */ }
    }

    // ── 面板 ─────────────────────────────────────────
    function renderMenu() {
        const shells = info?.shells || [];
        menuNode.innerHTML = `<div class="dc-term-menu-title">${esc(L('新建终端', 'New terminal'))}</div>${shells.map(item => `<button type="button" data-term-new="${esc(item.id)}">${icon('shell')}<span>${esc(item.label)}</span>${item.default ? `<small>${esc(L('默认', 'default'))}</small>` : ''}</button>`).join('') || `<p>${esc(L('没有可用的 Shell', 'No shells available'))}</p>`}
            <hr><label class="dc-term-menu-check"><input type="checkbox" data-term-auto ${localStorage.getItem(AUTO_KEY) !== '0' ? 'checked' : ''}><span>${esc(L('智能体执行命令时自动打开', 'Open automatically when the agent runs commands'))}</span></label>
            ${info && !info.pty ? `<p class="dc-term-menu-note">${esc(L('服务端未加载 node-pty，终端以简易模式运行（逐行执行）。', 'node-pty is not available on the server; terminals run in basic line mode.'))}</p>` : ''}`;
    }
    function showError(message) {
        statusNode.textContent = message;
        statusNode.classList.add('is-error');
        setTimeout(() => { statusNode.classList.remove('is-error'); renderTabs(); }, 5000);
    }
    function visibility() {
        panel.hidden = !open;
        document.body.classList.toggle('dc-terminal-open', open);
        toggle?.setAttribute('aria-pressed', String(open));
        window.dispatchEvent(new Event('dragon-claw:sidebar-layout'));
    }
    async function show({ tab, auto = false } = {}) {
        if (!panel) return;
        window.ChatFiles?.closePreview?.();
        window.DragonClawWorkspace?.closePanel?.();
        if (document.body.classList.contains('dc-browser-open')) window.DragonBrowserSidebar?.close?.();
        open = true; visibility();
        if (!info && isAdmin()) restoreSessions();
        try { await ensureAgentTab(); } catch (error) { showError(L('终端组件加载失败：', 'Failed to load terminal: ') + error.message); }
        select(tab || activeId);
        if (!auto) tabs.get(activeId)?.term?.focus();
    }
    function close() {
        if (!open) return;
        open = false; menuNode.hidden = true; visibility();
    }
    function init() {
        const browserToggle = document.getElementById('dcBrowserToggle');
        const workspace = document.getElementById('dcWorkspacePanel');
        if (!browserToggle || !workspace) return;
        toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'dc-ghost-btn'; toggle.id = 'dcTerminalToggle';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.textContent = L('终端', 'Terminal');
        toggle.hidden = !isAdmin(); // 只有管理员能执行命令和打开终端
        browserToggle.after(toggle);

        panel = document.createElement('aside');
        panel.className = 'dc-terminal-panel'; panel.id = 'dcTerminalPanel'; panel.hidden = true;
        panel.innerHTML = `<header class="dc-term-head">
                <div class="dc-term-tabs" role="tablist"></div>
                <div class="dc-term-new"><button type="button" data-term-action="new" title="${esc(L('新建终端', 'New terminal'))}">${icon('plus')}</button><button type="button" data-term-action="menu" aria-haspopup="menu" title="${esc(L('选择 Shell', 'Choose shell'))}">${icon('caret')}</button></div>
                <div class="dc-term-actions"><button type="button" data-term-action="interrupt" title="${esc(L('中断（Ctrl+C）', 'Interrupt (Ctrl+C)'))}" hidden>${icon('stop')}</button><button type="button" data-term-action="copy" title="${esc(L('复制（有选中复制选中，否则复制全部输出）', 'Copy (selection, or all output)'))}">${icon('copy')}</button><button type="button" data-term-action="clear" title="${esc(L('清屏', 'Clear'))}">${icon('clear')}</button><button type="button" data-term-action="close" title="${esc(L('关闭面板', 'Close panel'))}">${icon('close')}</button></div>
            </header>
            <div class="dc-term-menu" role="menu" hidden></div>
            <div class="dc-term-body"></div>
            <footer class="dc-term-status" role="status"></footer>`;
        (document.getElementById('dcBrowserPanel') || workspace).after(panel);
        tabsNode = panel.querySelector('.dc-term-tabs');
        body = panel.querySelector('.dc-term-body');
        menuNode = panel.querySelector('.dc-term-menu');
        statusNode = panel.querySelector('.dc-term-status');
        const agentNode = document.createElement('div');
        agentNode.className = 'dc-term-view'; body.append(agentNode);
        tabs.set('agent', { id: 'agent', kind: 'agent', title: 'Agent', node: agentNode });
        renderMenu(); renderTabs();

        window.SidebarResize?.bind({ panel, cssVar: '--terminal-panel-width', storageKey: 'dragon_terminal_sidebar_width', defaultWidth: 560 });
        toggle.addEventListener('click', () => open ? close() : show());
        panel.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (!button) return;
            if (button.dataset.termTab) select(button.dataset.termTab);
            if (button.dataset.termClose) closeTab(button.dataset.termClose);
            if (button.dataset.termNew) { menuNode.hidden = true; newTerminal(button.dataset.termNew); }
            const action = button.dataset.termAction;
            if (action === 'new') newTerminal();
            if (action === 'menu') { if (!info && isAdmin()) restoreSessions(); menuNode.hidden = !menuNode.hidden; }
            if (action === 'close') close();
            if (action === 'copy') copyFrom(tabs.get(activeId));
            if (action === 'clear') { const tab = tabs.get(activeId); tab?.term?.clear(); }
            if (action === 'interrupt') { const tab = tabs.get(activeId); if (tab?.kind === 'shell') api(`/sessions/${tab.id}/interrupt`, { method: 'POST' }).catch(error => showError(error.message)); }
        });
        // 兜底：焦点不在终端输入框（只读的 Agent 标签）时，面板内 ⌘C / Ctrl+C 也复制选中内容
        panel.addEventListener('keydown', event => {
            const tab = tabs.get(activeId);
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'c' || !tab?.term?.hasSelection()) return;
            if (event.target.closest?.('.xterm-helper-textarea')) return; // 终端自己的快捷键处理已复制
            event.preventDefault();
            copyFrom(tab);
        });
        // 右键：有选中内容时直接复制（不弹浏览器菜单）
        body.addEventListener('contextmenu', event => {
            const tab = tabs.get(activeId);
            if (!tab?.term?.hasSelection()) return;
            event.preventDefault();
            copyFrom(tab);
        });
        // 中键关闭标签
        tabsNode.addEventListener('auxclick', event => { const id = event.target.closest('[data-term-tab]')?.dataset.termTab; if (event.button === 1 && id && id !== 'agent') closeTab(id); });
        menuNode.addEventListener('change', event => { if (event.target.matches('[data-term-auto]')) { try { localStorage.setItem(AUTO_KEY, event.target.checked ? '1' : '0'); } catch {} } });
        document.addEventListener('pointerdown', event => { if (!menuNode.hidden && !event.target.closest('.dc-term-menu,[data-term-action="menu"]')) menuNode.hidden = true; });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !menuNode.hidden) { menuNode.hidden = true; event.preventDefault(); }
            // Ctrl+` 切换终端面板（与常见编辑器一致）
            if (event.key === '`' && event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); open ? close() : show(); }
        });
        new ResizeObserver(() => fitTab(tabs.get(activeId))).observe(body);
        window.addEventListener('dragon-claw:command', event => onCommand(event.detail));
        new MutationObserver(() => { for (const tab of tabs.values()) if (tab.term) tab.term.options.theme = theme(); })
            .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        window.addEventListener('tools:languagechange', () => { toggle.textContent = L('终端', 'Terminal'); renderMenu(); renderTabs(); });
        window.matchMedia('(max-width: 860px)').addEventListener('change', event => { if (event.matches) close(); });
        // 首页其他模式（工具页、频道）遮住对话时一并收起
        for (const name of ['home:hub', 'home:tool-frame']) window.addEventListener(name, event => { if (event.detail?.open) close(); });
        window.DragonTerminalSidebar = { open: show, close, isOpen: () => open, newTerminal };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
