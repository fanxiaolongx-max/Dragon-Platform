// 全局设置 › 频道对接 › WeLink：个人身份（welink-cli）卡片。
// 检测本机 welink-cli 安装、扫码登录 / 注销、邮箱 autodiscover，以及是否允许 Dragon Claw 的 @welink-office 使用。
// 由 channel-settings.js 在 WeLink 标签按需加载；样式复用 channel-settings 的 nch-* 类。
(function () {
    'use strict';
    if (window.ToolsWelinkCli) return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const BASE = '/api/channels/welink-cli';

    const state = {
        el: null,
        loaded: false,
        loading: false,
        error: '',
        forbidden: false,
        config: null,
        install: null,
        auth: null,
        authLoading: false,
        busy: '',
        notice: null,
        login: null, // { phase, qrUrl, qrText, elapsed, log: [], error }
        loginController: null,
        draftPath: null,
        draftEmail: null,
        logs: null, // { items, running, file }
        logsOpen: false,
        logsError: '',
        logExpanded: new Set(),
        logTimer: 0
    };

    function headers(json) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    }

    async function request(method, path, body) {
        const res = await fetch(`${BASE}${path}`, { method, headers: headers(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined });
        let data = {};
        try { data = await res.json(); } catch (_) { data = {}; }
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
        return data;
    }

    async function load({ refresh = false } = {}) {
        state.loading = true;
        render();
        try {
            const data = await request('GET', `/status${refresh ? '?refresh=1' : ''}`);
            state.config = data.config;
            state.install = data.install;
            state.error = '';
            state.forbidden = false;
        } catch (error) {
            state.error = error.message;
            state.forbidden = error.status === 403;
        }
        state.loading = false;
        state.loaded = true;
        render();
        if (state.install?.available) loadAuth();
    }

    async function loadAuth() {
        state.authLoading = true;
        render();
        try {
            const data = await request('GET', '/status?auth=1');
            state.auth = data.auth || null;
        } catch (error) {
            state.auth = { loggedIn: null, text: '', error: error.message };
        }
        state.authLoading = false;
        render();
        if (state.logsOpen) loadLogs();
    }

    async function runAction(name, task) {
        if (state.busy) return;
        state.busy = name;
        state.notice = null;
        render();
        try {
            await task();
        } catch (error) {
            state.notice = { kind: 'bad', text: error.message };
        } finally {
            state.busy = '';
            render();
        }
    }

    async function saveConfig(patch) {
        const data = await request('PUT', '/config', patch);
        state.config = data.config;
        state.install = data.install;
        state.draftPath = null;
    }

    async function startLogin() {
        if (state.login && state.login.phase === 'running') return;
        const controller = new AbortController();
        state.loginController = controller;
        state.login = { phase: 'running', status: L('正在连接 WeLink PC…', 'Connecting to WeLink PC…'), qrUrl: '', qrText: '', elapsed: null, log: [], error: '' };
        render();
        try {
            const res = await fetch(`${BASE}/login`, { method: 'POST', headers: headers(true), body: JSON.stringify({ env: state.config?.env || '' }), signal: controller.signal });
            if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();
                lines.filter(Boolean).forEach(line => handleLoginMessage(JSON.parse(line)));
                render();
            }
        } catch (error) {
            if (error.name !== 'AbortError') Object.assign(state.login, { phase: 'failed', error: error.message });
            else Object.assign(state.login, { phase: 'cancelled' });
        }
        if (state.login.phase === 'running') state.login.phase = 'failed';
        state.loginController = null;
        render();
        if (state.login.phase === 'done') loadAuth();
    }

    function handleLoginMessage(message) {
        const login = state.login;
        if (message.type === 'done') { login.phase = 'done'; login.status = L('登录成功，凭据已缓存在本机。', 'Signed in. Credentials cached on this machine.'); return; }
        if (message.type === 'error') { login.phase = 'failed'; login.error = message.error; return; }
        const event = message.event || {};
        if (event.type === 'qrcode') { login.qrUrl = event.url; login.status = L('请用 WeLink 手机端扫码并确认授权。', 'Scan with WeLink mobile and confirm.'); }
        else if (event.type === 'qrtext') login.qrText = event.text;
        else if (event.type === 'waiting') login.elapsed = event.elapsed;
        else if (event.type === 'scanned') login.status = L('已扫码，正在获取登录凭据…', 'Scanned. Obtaining credentials…');
        else if (event.type === 'expired') login.status = L('二维码已过期，请重新登录。', 'QR code expired. Start again.');
        else if (event.type === 'log' && event.text) login.log = [...login.log, event.text].slice(-8);
    }

    // ── 调用日志 ─────────────────────────────────────────
    async function loadLogs() {
        clearTimeout(state.logTimer);
        try {
            state.logs = await request('GET', '/logs?limit=50');
            state.logsError = '';
        } catch (error) {
            state.logsError = error.message;
        }
        renderLogs();
        // 有命令在执行（或排队）时每 2 秒刷新，能看到卡在哪一条、已经跑了多久
        if (state.logsOpen && state.logs?.running && state.el && document.body.contains(state.el)) state.logTimer = setTimeout(loadLogs, 2000);
    }

    function formatDuration(ms) {
        const value = Number(ms) || 0;
        return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
    }

    function renderLogs() {
        const box = state.el?.querySelector('[data-role="cli-logs"]');
        if (!box) return;
        const logs = state.logs;
        const items = logs?.items || [];
        const head = `<div class="nch-row" style="justify-content:space-between;cursor:pointer" data-cli-action="logs-toggle">
                <b>${state.logsOpen ? '▾' : '▸'} ${esc(L('调用日志', 'Call log'))}</b>
                <span class="nch-muted">${esc(L('每条 welink-cli 命令的耗时、退出码和输出片段；也写入本机日志文件', 'Duration, exit code and output of each welink-cli command; also written to a local log file'))}</span>
            </div>`;
        if (!state.logsOpen) { box.innerHTML = head; return; }
        const running = logs?.running
            ? `<div class="nch-pill warn" style="margin:8px 0"><i></i>${esc(L(`正在执行：${logs.running.command} · 已 ${Math.round(logs.running.elapsedMs / 1000)} 秒`, `Running: ${logs.running.command} · ${Math.round(logs.running.elapsedMs / 1000)}s`))}</div>`
            : '';
        const rows = items.map(item => {
            const ok = item.code === 0;
            const status = item.error ? item.error : (ok ? L('退出码 0', 'exit 0') : L(`退出码 ${item.code}`, `exit ${item.code}`));
            const open = state.logExpanded.has(item.id);
            const output = [item.stdout ? item.stdout : '', item.stderr ? `--- stderr ---\n${item.stderr}` : '', item.stdoutChars > (item.stdout || '').length ? L(`…（共 ${item.stdoutChars} 字符，日志只保留前 ${item.stdout.length} 字符）`, `…(${item.stdoutChars} chars, first ${item.stdout.length} kept)`) : ''].filter(Boolean).join('\n');
            return `<div style="border-top:1px solid rgba(127,127,127,.18);padding:6px 0">
                <div class="nch-row" style="gap:8px;cursor:pointer;flex-wrap:nowrap" data-cli-action="log-expand" data-log-id="${esc(item.id)}">
                    <span style="color:${ok ? '#16a34a' : '#dc2626'}">${ok ? '✓' : '✗'}</span>
                    <span class="nch-muted" style="white-space:nowrap">${esc(new Date(item.at).toLocaleTimeString())}</span>
                    <code style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(item.command)}</code>
                    <span class="nch-muted" style="white-space:nowrap">${esc(formatDuration(item.durationMs))}${item.queuedMs > 1000 ? esc(L(` · 排队 ${formatDuration(item.queuedMs)}`, ` · queued ${formatDuration(item.queuedMs)}`)) : ''}</span>
                </div>
                ${open ? `<div class="nch-muted" style="margin:4px 0">${esc(status)}</div><pre style="white-space:pre-wrap;word-break:break-all;font-size:12px;max-height:320px;overflow:auto;margin:4px 0;padding:8px;border-radius:6px;background:rgba(127,127,127,.08)">${esc(output || L('（无输出）', '(no output)'))}</pre>` : ''}
            </div>`;
        }).join('');
        box.innerHTML = `${head}
            <div class="nch-row" style="margin:8px 0">
                <button type="button" class="nch-btn" data-cli-action="logs-refresh">${esc(L('刷新', 'Refresh'))}</button>
                <button type="button" class="nch-btn" data-cli-action="logs-clear" ${items.length ? '' : 'disabled'}>${esc(L('清空', 'Clear'))}</button>
                ${logs?.file ? `<span class="nch-muted" style="word-break:break-all">${esc(L('日志文件：', 'Log file: '))}${esc(logs.file)}</span>` : ''}
            </div>
            ${state.logsError ? `<p class="nch-desc" style="color:#b91c1c">${esc(state.logsError)}</p>` : ''}
            ${running}
            ${items.length ? rows : `<p class="nch-muted">${esc(logs ? L('还没有调用记录（服务重启后内存中的记录会清空，日志文件保留）。', 'No calls yet (in-memory list resets on restart; the log file is kept).') : L('加载中…', 'Loading…'))}</p>`}`;
    }

    function cancelLogin() {
        state.loginController?.abort();
    }

    // ── 渲染 ─────────────────────────────────────────────
    function authPill() {
        if (!state.install?.available) return `<span class="nch-pill bad"><i></i>${esc(L('未安装', 'Not installed'))}</span>`;
        if (state.authLoading) return `<span class="nch-pill warn"><i></i>${esc(L('检查登录中…', 'Checking…'))}</span>`;
        const loggedIn = state.auth?.loggedIn;
        if (loggedIn === true) {
            const auth = state.auth;
            const detail = [auth.uid, auth.environment ? L(`环境 ${auth.environment}`, `env ${auth.environment}`) : '',
                auth.refreshing ? L('令牌将在下次调用时自动刷新', 'token refreshes on next call') : (auth.expiresIn ? L(`令牌 ${auth.expiresIn} 后到期（会自动刷新）`, `token expires in ${auth.expiresIn} (auto-refresh)`) : '')].filter(Boolean).join(' · ');
            return `<span class="nch-pill ok"><i></i>${esc(L('已登录', 'Signed in'))}${detail ? ` · ${esc(detail)}` : ''}</span>`;
        }
        if (loggedIn === false) return `<span class="nch-pill bad"><i></i>${esc(L('未登录', 'Signed out'))}</span>`;
        return `<span class="nch-pill warn"><i></i>${esc(L('登录状态未知', 'Status unknown'))}</span>`;
    }

    function renderLogin() {
        const login = state.login;
        if (!login) return '';
        const running = login.phase === 'running';
        const title = login.phase === 'failed' ? `${L('登录失败：', 'Sign-in failed: ')}${login.error || ''}`
            : (login.phase === 'cancelled' ? L('已取消登录。', 'Sign-in cancelled.') : login.status);
        return `<div class="nch-qr">
            ${login.qrUrl && running ? `<div class="nch-qr-img"><img src="${esc(login.qrUrl)}" alt="WeLink QR" style="width:100%;height:100%;object-fit:contain"></div>` : ''}
            <div class="nch-qr-info">
                <b>${esc(title)}</b>
                ${running && login.elapsed !== null ? `<div>${esc(L(`已等待 ${login.elapsed} 秒`, `Waiting ${login.elapsed}s`))}</div>` : ''}
                ${login.qrUrl && running ? `<div><a href="${esc(login.qrUrl)}" target="_blank" rel="noopener">${esc(L('二维码图片打不开？在新窗口打开', 'QR not showing? Open in a new window'))}</a></div>
                    <div class="nch-muted">${esc(L('二维码图片来自 WeLink 内网地址，需在内网环境访问。', 'The QR image is served from the WeLink intranet.'))}</div>` : ''}
                ${login.qrText && running ? `<details><summary>${esc(L('字符二维码（备用）', 'Text QR (fallback)'))}</summary><pre style="font:8px/8px monospace;letter-spacing:0;margin:6px 0;white-space:pre">${esc(login.qrText)}</pre></details>` : ''}
                ${login.log.length ? `<div class="nch-muted" style="white-space:pre-wrap">${esc(login.log.join('\n'))}</div>` : ''}
                ${running ? `<div class="nch-row"><button type="button" class="nch-btn" data-cli-action="login-cancel">${esc(L('取消', 'Cancel'))}</button></div>` : ''}
            </div>
        </div>`;
    }

    function render() {
        const el = state.el;
        if (!el || !document.body.contains(el)) return;
        if (!state.loaded) {
            el.innerHTML = `<h4>🪪 ${esc(L('个人身份（welink-cli）', 'Personal identity (welink-cli)'))}</h4><p class="nch-desc">${esc(L('正在检测…', 'Detecting…'))}</p>`;
            return;
        }
        if (state.forbidden || (state.error && !state.config)) {
            el.innerHTML = `<h4>🪪 ${esc(L('个人身份（welink-cli）', 'Personal identity (welink-cli)'))}</h4><p class="nch-desc">${esc(state.error)}</p>`;
            return;
        }
        const config = state.config || {};
        const install = state.install || {};
        const busy = state.busy;
        const loginRunning = state.login?.phase === 'running';
        const pathValue = state.draftPath ?? config.cliPath ?? '';
        const emailValue = state.draftEmail ?? config.email ?? '';
        el.innerHTML = `
            <h4>🪪 ${esc(L('个人身份（welink-cli）', 'Personal identity (welink-cli)'))}</h4>
            <p class="nch-desc">${esc(L('上面的助理以「机器人」身份收发消息；这里的 welink-cli 以你本人在本机 WeLink PC 上登录的身份工作，让 Dragon Claw 的 @welink-office 可以查询你的联系人、聊天记录、会议、云空间、邮件和日历（当前只读）。凭据保存在本机系统用户目录，仅默认租户的管理员可用。', 'The assistant above acts as a bot. welink-cli works as you (the account signed in to WeLink PC on this machine), letting Dragon Claw @welink-office query your contacts, chats, meetings, cloud drive, mail and calendar (read-only for now). Credentials stay in this machine’s user profile; default-tenant admins only.'))}</p>
            <div class="nch-status" style="margin-bottom:10px">
                ${authPill()}
                ${install.available ? `<span class="nch-muted">welink-cli ${esc(install.version || '')} · ${esc(install.entry || '')}</span>` : `<span class="nch-muted">${esc(install.hint || '')}</span>`}
            </div>
            ${state.auth?.text || state.auth?.error ? `<details style="margin-bottom:10px"><summary class="nch-muted">${esc(L('auth status 原始输出', 'auth status output'))}</summary><pre style="white-space:pre-wrap;font-size:12px;margin:6px 0">${esc(state.auth.error || state.auth.text)}</pre></details>` : ''}
            <label class="nch-switch" style="margin-bottom:8px"><input type="checkbox" data-cli-field="enabled" ${config.enabled ? 'checked' : ''} ${busy ? 'disabled' : ''}> ${esc(L('允许 Dragon Claw 通过 @welink-office 以我的身份查询 WeLink（查询结果会发送给当前 AI 模型）', 'Allow Dragon Claw @welink-office to query WeLink as me (results are sent to the current AI model)'))}</label>
            <label class="nch-switch" style="margin-bottom:12px"><input type="checkbox" data-cli-field="verbose" ${config.verbose ? 'checked' : ''} ${busy ? 'disabled' : ''}> ${esc(L('详细模式：对话里每条 welink-cli 命令都可展开查看完整命令行和原始输出（输出会随聊天记录保存）', 'Verbose: each welink-cli command in the chat can be expanded to show the command line and raw output (saved with the chat history)'))}</label>
            <div class="nch-grid">
                <label class="nch-field"><span>${esc(L('登录环境', 'Environment'))}</span><select data-cli-field="env" ${busy ? 'disabled' : ''}><option value="" ${config.env !== 'pro' ? 'selected' : ''}>${esc(L('默认', 'Default'))}</option><option value="pro" ${config.env === 'pro' ? 'selected' : ''}>${esc(L('生产 pro', 'Production (pro)'))}</option></select></label>
                <label class="nch-field" style="grid-column:1/-1"><span>${esc(L('CLI 路径（可选）', 'CLI path (optional)'))}</span><input data-cli-field="cliPath" value="${esc(pathValue)}" maxlength="500" placeholder="${esc(L('留空自动查找 npm 全局目录；也可填 welink-cli.cmd 或安装目录', 'Blank = npm global; or welink-cli.cmd / install folder'))}"></label>
            </div>
            <div class="nch-row">
                <button type="button" class="nch-btn primary" data-cli-action="login" ${!install.available || loginRunning || busy ? 'disabled' : ''}>📱 ${esc(loginRunning ? L('等待扫码…', 'Waiting for scan…') : L('扫码登录', 'Sign in with QR'))}</button>
                <button type="button" class="nch-btn" data-cli-action="recheck" ${busy || loginRunning ? 'disabled' : ''}>${esc(busy === 'recheck' ? L('检测中…', 'Checking…') : L('重新检测', 'Re-detect'))}</button>
                <button type="button" class="nch-btn" data-cli-action="save-path" ${busy || loginRunning ? 'disabled' : ''}>${esc(L('保存路径', 'Save path'))}</button>
                ${install.available && state.auth?.loggedIn !== false ? `<button type="button" class="nch-btn danger" data-cli-action="logout" ${busy || loginRunning ? 'disabled' : ''}>${esc(L('注销', 'Sign out'))}</button>` : ''}
            </div>
            ${renderLogin()}
            <div class="nch-row" style="margin-top:12px">
                <input data-cli-field="email" value="${esc(emailValue)}" maxlength="200" placeholder="${esc(L('你的邮箱，如 zhangsan@huawei.com', 'Your email address'))}" style="flex:1 1 220px" ${install.available ? '' : 'disabled'}>
                <button type="button" class="nch-btn" data-cli-action="autodiscover" ${!install.available || busy || loginRunning ? 'disabled' : ''}>${esc(busy === 'autodiscover' ? L('发现中…', 'Discovering…') : L('邮箱 autodiscover', 'Mail autodiscover'))}</button>
                <span class="nch-muted">${esc(config.email ? L(`已为 ${config.email} 执行过`, `Done for ${config.email}`) : L('首次使用邮件/日历前执行一次', 'Run once before using mail/calendar'))}</span>
            </div>
            ${state.notice ? `<p class="nch-desc" style="margin-top:10px;color:${state.notice.kind === 'bad' ? '#b91c1c' : '#166534'}">${esc(state.notice.text)}</p>` : ''}
            <div data-role="cli-logs" style="margin-top:14px"></div>`;
        renderLogs();
    }

    // ── 事件 ─────────────────────────────────────────────
    function onClick(event) {
        const button = event.target.closest('[data-cli-action]');
        if (!button || !state.el?.contains(button)) return;
        const action = button.dataset.cliAction;
        if (action === 'logs-toggle') {
            state.logsOpen = !state.logsOpen;
            if (state.logsOpen) loadLogs(); else { clearTimeout(state.logTimer); renderLogs(); }
        } else if (action === 'logs-refresh') loadLogs();
        else if (action === 'logs-clear') request('DELETE', '/logs').then(() => { state.logExpanded.clear(); return loadLogs(); }).catch(error => { state.logsError = error.message; renderLogs(); });
        else if (action === 'log-expand') {
            const id = Number(button.dataset.logId);
            if (state.logExpanded.has(id)) state.logExpanded.delete(id); else state.logExpanded.add(id);
            renderLogs();
        } else if (action === 'login') startLogin();
        else if (action === 'login-cancel') cancelLogin();
        else if (action === 'recheck') runAction('recheck', async () => { await load({ refresh: true }); });
        else if (action === 'save-path') runAction('save-path', async () => { await saveConfig({ cliPath: state.draftPath ?? state.config?.cliPath ?? '' }); if (state.install?.available) loadAuth(); });
        else if (action === 'logout') {
            const confirmed = window.AppDialog
                ? window.AppDialog.confirm(L('注销后会清除本机 welink-cli 的全部凭据，需要重新扫码登录。', 'This clears all welink-cli credentials on this machine.'), { title: L('注销 welink-cli', 'Sign out'), tone: 'danger', confirmText: L('注销', 'Sign out'), cancelText: L('取消', 'Cancel') })
                : Promise.resolve(window.confirm(L('注销 welink-cli？', 'Sign out of welink-cli?')));
            confirmed.then(ok => ok && runAction('logout', async () => {
                await request('POST', '/logout');
                state.login = null;
                state.notice = { kind: 'ok', text: L('已注销', 'Signed out') };
                await loadAuth();
            }));
        } else if (action === 'autodiscover') {
            runAction('autodiscover', async () => {
                const email = (state.draftEmail ?? state.config?.email ?? '').trim();
                await request('POST', '/autodiscover', { email });
                state.config = { ...state.config, email };
                state.draftEmail = null;
                state.notice = { kind: 'ok', text: L('邮箱服务器已发现，邮件和日历可以使用了。', 'Mail server discovered.') };
            });
        }
    }

    function onInput(event) {
        const field = event.target.dataset?.cliField;
        if (!field || !state.el?.contains(event.target)) return;
        // 输入框打字时不重绘，避免丢焦点；点「保存路径」/邮箱按钮时再提交
        if (field === 'cliPath') { state.draftPath = event.target.value; return; }
        if (field === 'email') { state.draftEmail = event.target.value; return; }
        if (event.type !== 'change') return;
        if (field === 'enabled') runAction('enabled', () => saveConfig({ enabled: event.target.checked }));
        if (field === 'env') runAction('env', () => saveConfig({ env: event.target.value }));
        if (field === 'verbose') runAction('verbose', () => saveConfig({ verbose: event.target.checked }));
    }

    function bind(el) {
        if (el.dataset.welinkCliBound) return;
        el.dataset.welinkCliBound = '1';
        el.addEventListener('click', onClick);
        el.addEventListener('input', onInput);
        el.addEventListener('change', onInput);
    }

    /** channel-settings 每次整页重绘都会给一个新的容器；状态保留在模块里，只是换个地方画。 */
    function renderInto(el) {
        state.el = el;
        bind(el);
        render();
        if (!state.loaded && !state.loading) load();
    }

    window.ToolsWelinkCli = { render: renderInto };
})();
