(function () {
    const L = (zh, en) => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const names = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity' };
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    async function request(method, path, body) { const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token'); const r = await fetch('/api/desktop-agents' + path, { method, credentials: 'same-origin', cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json().catch(() => ({})); if (!r.ok)
        throw Error(d.error || `HTTP ${r.status}`); return d; }
    async function render(content) {
        if (!document.querySelector('link[data-desktop-agent-style]')) {
            const style = document.createElement('link');
            style.rel = 'stylesheet';
            style.href = './tp-static/frontend/css/desktop-agents.css';
            style.dataset.desktopAgentStyle = '';
            document.head.append(style);
        }
        content.textContent = L('正在读取桌面连接设置…', 'Loading desktop connection settings…');
        let config;
        try {
            config = await request('GET', '/settings');
        }
        catch (error) {
            if (content.isConnected)
                content.textContent = error.message;
            return;
        }
        if (!content.isConnected || document.querySelector('.nav-settings-tab.active')?.dataset.tab !== 'desktopAgents')
            return;
        if (!config.owned) {
            content.textContent = config.reason;
            return;
        }
        const cfg = config.settings;
        const toggle = (name, title, hint, on) => `<label class="da-row"><span><b>${title}</b>${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" class="da-switch" name="${name}" ${on ? 'checked' : ''}></label>`;
        const notes = { codex: L('原生桌面 IPC · 可发送、可读取运行状态', 'Native desktop IPC · send and live status'), claudecode: L('读取本机历史 · 可选模拟操作发送', 'Local history · optional UI automation sending'), antigravity: L('桌面页面连接 · 打开记录会切换桌面会话', 'Desktop page connection · opening a chat switches the desktop view') };
        content.innerHTML = `<section class="desktop-agent-settings">
            <form class="desktop-agent-setting-fields">
                <div class="da-overview">
                    <div class="da-card"><h4>${L('连接与发送', 'Connection & replies')}</h4>
                        ${toggle('enabled', L('连接本机桌面 Agent', 'Connect local desktop agents'), L('仅当前账号和租户可见', 'Visible only to this account and tenant'), cfg.enabled)}
                        ${toggle('allowSend', L('允许网页发送消息', 'Allow replies from the Web'), L('关闭后仍可查看会话', 'Turn off for read-only conversations'), cfg.allowSend)}
                    </div>
                    <div class="da-card"><h4>${L('最近对话列表', 'Recent conversation list')}</h4>
                        ${toggle('autoSync', L('自动刷新列表', 'Automatically refresh the list'), '', cfg.autoSync)}
                        <div class="da-inline">
                            <label><span>${L('列表刷新间隔', 'List refresh interval')}</span><span class="da-unit"><input type="number" name="syncSeconds" min="10" max="300" value="${cfg.syncSeconds}"><em>${L('秒', 's')}</em></span></label>
                            <label><span>${L('每个 Agent 显示', 'Chats per agent')}</span><span class="da-unit"><input type="number" name="recentLimit" min="10" max="200" value="${cfg.recentLimit}"><em>${L('条', '')}</em></span></label>
                        </div>
                        <p class="da-help">${L('只控制最近列表；打开的对话正文会独立自动刷新。', 'Applies to the recent list only. An open conversation refreshes independently.')}</p>
                    </div>
                </div>
                <div class="da-connections-head"><h4>${L('桌面客户端', 'Desktop clients')}</h4><button type="button" data-desktop-inspect ${cfg.enabled ? '' : 'disabled'}>${L('检测连接', 'Check connections')}</button></div>
                <div class="da-providers">
                    ${Object.entries(names).map(([id, name]) => `<div class="da-provider" data-provider="${id}">
                        <label class="da-provider-head"><span class="da-provider-title"><img src="./tp-static/frontend/assets/desktop-agents/${id}.png" width="24" height="24" alt="" class="da-agent-icon" onerror="this.style.display='none'"><b>${name}</b></span><input type="checkbox" class="da-switch" name="${id}" ${cfg.providers[id] ? 'checked' : ''}></label>
                        <small>${notes[id]}</small><span class="da-state" data-state="${id}"></span>
                        ${id === 'claudecode' ? `<div class="da-provider-extra"><label class="da-sub"><span><b>${L('模拟操作发送', 'Send by UI automation')}</b><small>${L('仅 macOS，需辅助功能权限', 'macOS only · Accessibility required')}</small></span><input type="checkbox" class="da-switch" name="claudeAutomation" ${cfg.claudeAutomation ? 'checked' : ''}></label><details class="da-notes"><summary>${L('发送时会发生什么？', 'What happens when sending?')}</summary><p>${L('Claude 会切到前台，打开并核对目标会话后发送，再切回原应用。请在 macOS 系统设置中为运行平台的程序授予辅助功能权限。', 'Claude comes to the front, opens and verifies the target conversation, sends, then returns to the previous app. Grant Accessibility permission to the program running this platform in macOS settings.')}</p></details></div>` : ''}
                    </div>`).join('')}
                </div>
                <div class="da-footer">
                    <details class="da-notes"><summary>${L('连接说明与排障', 'Connection details & troubleshooting')}</summary><p>${esc(L('连接的是运行平台服务这台电脑上的客户端。Codex 使用桌面 IPC；Antigravity 使用桌面页面连接，打开记录会切换桌面会话；Claude Code 读取本机历史，可选模拟操作发送。未连接时请确认客户端已启动并登录。', 'Connects to desktop clients on the computer running this service. Codex uses desktop IPC; Antigravity uses a desktop page connection and opening a conversation switches its desktop view; Claude Code reads local history with optional UI automation. If offline, check the client is running and signed in.'))}</p><p>${esc(L('刷新列表会立即重新读取最近对话，不必等待自动刷新间隔。自动刷新关闭时仍可手动刷新；正文刷新不受列表开关影响。不会自动改用 CLI 或平台模型代答。', 'Refresh list immediately rereads recent conversations without waiting for the next interval. Manual refresh remains available when automatic list refresh is off; open conversations refresh separately. No CLI or platform-model fallback.'))}</p></details>
                    <button type="submit" class="is-primary">${L('保存设置', 'Save settings')}</button>
                </div>
                <div class="desktop-agent-setting-result" role="status" aria-live="polite"></div>
            </form>
        </section>`;
        const form = content.querySelector('form'), result = content.querySelector('[role=status]');
        let saving = false, inspecting = false;
        function updateAvailability() {
            form.elements.syncSeconds.disabled = !form.elements.enabled.checked || !form.elements.autoSync.checked;
            form.querySelector('[data-desktop-inspect]').disabled = !form.elements.enabled.checked || inspecting;
        }
        form.elements.enabled.addEventListener('change', updateAvailability);
        form.elements.autoSync.addEventListener('change', updateAvailability);
        updateAvailability();
        // 每家 Agent 卡片与右侧看板显示实际连接能力：已连接/可发送、只读或未连接
        function showStates(providers) { for (const p of providers || []) {
            const node = content.querySelector(`[data-state="${p.id}"]`);
            const level = !p.enabled ? 'off' : !p.connected ? 'down' : p.canSend ? 'ok' : 'read';
            const labelText = { off: L('已停用', 'Disabled'), down: L('未连接', 'Not connected'), ok: L('已连接 · 可发送', 'Connected · can send'), read: L('已连接 · 只读', 'Connected · read-only') }[level];
            if (node) {
                node.dataset.level = level;
                node.textContent = labelText;
                node.title = p.reason || '';
            }
        } }
        async function inspect() {
            if (inspecting) return;
            inspecting = true;
            updateAvailability();
            try {
            result.dataset.tone = '';
            result.textContent = L('正在检测本机客户端…', 'Checking desktop clients…');
            const data = await request('POST', '/sync');
            if (!result.isConnected)
                return;
            showStates(data.providers);
            result.dataset.tone = 'ok';
            result.textContent = L('检测完成：', 'Checked: ') + (data.providers || []).filter(p => p.enabled).map(p => `${names[p.id]} ${p.connected ? (p.canSend ? L('可发送', 'can send') : L('只读', 'read-only')) : L('未连接', 'offline')}`).join(' · ');
            window.dispatchEvent(new Event('tools:desktop-agent-settings-changed'));
        }
        catch (error) {
            if (result.isConnected) {
                result.dataset.tone = 'error';
                result.textContent = error.message;
            }
        } finally { inspecting = false; updateAvailability(); } }
        if (cfg.enabled)
            request('GET', '/sessions').then(data => { if (content.isConnected)
                showStates(data.providers); }).catch(() => { });
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (saving)
                return;
            saving = true;
            const button = form.querySelector('[type=submit]');
            button.disabled = true;
            try {
                const patch = { enabled: form.elements.enabled.checked, autoSync: form.elements.autoSync.checked, allowSend: form.elements.allowSend.checked, claudeAutomation: form.elements.claudeAutomation.checked, recentLimit: Number(form.elements.recentLimit.value), syncSeconds: Number(form.elements.syncSeconds.value), providers: Object.fromEntries(Object.keys(names).map(k => [k, form.elements[k].checked])) };
                await request('PUT', '/settings', patch);
                if (!result.isConnected)
                    return;
                result.dataset.tone = 'ok';
                result.textContent = L('设置已保存。', 'Settings saved.');
                form.querySelector('[data-desktop-inspect]').disabled = !patch.enabled;
                window.dispatchEvent(new Event('tools:desktop-agent-settings-changed'));
                if (patch.enabled)
                    await inspect();
            }
            catch (error) {
                if (result.isConnected) {
                    result.dataset.tone = 'error';
                    result.textContent = error.message;
                }
            }
            finally {
                saving = false;
                button.disabled = false;
            }
        });
        form.querySelector('[data-desktop-inspect]').addEventListener('click', inspect);
    }
    window.ToolsDesktopAgentSettings = { render };
})();
