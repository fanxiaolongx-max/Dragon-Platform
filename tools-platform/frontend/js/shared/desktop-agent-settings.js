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
            style.href = '/css/desktop-agents.css';
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
        content.innerHTML = `<section class="desktop-agent-settings"><p>${esc(L('连接的是运行平台服务这台电脑上的桌面 Agent。会话仅对当前绑定的平台账号和租户可见；网页会同步最近会话，发送消息回到选中的原生会话。', 'Connect to the desktop agents on the computer running this platform service. Conversations are private to the bound account and tenant. Web replies continue the selected native session.'))}</p>
        <form class="desktop-agent-setting-fields">
        <label><span>${L('启用本机桌面对话连接', 'Connect this desktop')}</span><input type="checkbox" name="enabled" ${cfg.enabled ? 'checked' : ''}></label>
        <label><span>${L('自动同步最近对话', 'Automatically sync recent chats')}</span><input type="checkbox" name="autoSync" ${cfg.autoSync ? 'checked' : ''}></label>
        <label><span>${L('允许从 Web 向原会话发送消息', 'Allow Web replies to native sessions')}</span><input type="checkbox" name="allowSend" ${cfg.allowSend ? 'checked' : ''}></label>
        ${Object.entries(names).map(([id, name]) => `<label><span>${name}</span><input type="checkbox" name="${id}" ${cfg.providers[id] ? 'checked' : ''}></label>`).join('')}
        <label><span>${L('最近对话数量（每家）', 'Recent chats per agent')}</span><input type="number" name="recentLimit" min="10" max="200" value="${cfg.recentLimit}"></label>
        <label><span>${L('同步间隔（秒）', 'Sync interval (seconds)')}</span><input type="number" name="syncSeconds" min="10" max="300" value="${cfg.syncSeconds}"></label>
        <div class="desktop-agent-setting-actions"><button type="submit">${L('保存连接设置', 'Save connection settings')}</button><button type="button" data-desktop-inspect ${cfg.enabled ? '' : 'disabled'}>${L('检测并同步', 'Check & sync')}</button></div></form>
        <div class="desktop-agent-setting-result" role="status"></div>
        <p>${esc(L('Codex 使用原生桌面 IPC；Antigravity 使用桌面连接；Claude Code 当前支持读取本机历史，发送连接尚未接通。不会自动改用 CLI 或平台模型代答。桌面客户端关闭、权限缺失或会话运行中时，会明确提示。', 'Codex uses native desktop IPC, Antigravity its desktop connection, and Claude Code currently supports local history only; sending is not connected. No automatic CLI or platform-model fallback. Closed clients, missing permissions and busy sessions are reported.'))}</p>
        <p>${esc(L('DragonTAC 的网页升级与桌面对话是两个入口。当前升级原型的执行通道仍以任务中显示的实际能力为准；此设置不会把未接通的桌面能力标记为可用。', 'DragonTAC escalation and desktop conversations are separate entry points. Each escalation task continues to report its actual execution channel; these settings do not imply unavailable desktop capabilities are connected.'))}</p></section>`;
        const form = content.querySelector('form'), result = content.querySelector('[role=status]');
        let saving = false;
        async function inspect() { try {
            result.textContent = L('正在检测本机客户端…', 'Checking desktop clients…');
            const data = await request('POST', '/sync');
            if (!result.isConnected)
                return;
            result.textContent = (data.providers || []).map(p => `${names[p.id]} · ${p.connected ? L('已连接', 'Connected') : L('未连接', 'Disconnected')} · ${p.canSend ? L('可发送', 'Can send') : L('仅查看或不可用', 'Read-only / unavailable')}\n${p.reason || ''}`).join('\n\n');
            window.dispatchEvent(new Event('tools:desktop-agent-settings-changed'));
        }
        catch (error) {
            if (result.isConnected)
                result.textContent = error.message;
        } }
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (saving)
                return;
            saving = true;
            const button = form.querySelector('[type=submit]');
            button.disabled = true;
            try {
                const patch = { enabled: form.elements.enabled.checked, autoSync: form.elements.autoSync.checked, allowSend: form.elements.allowSend.checked, recentLimit: Number(form.elements.recentLimit.value), syncSeconds: Number(form.elements.syncSeconds.value), providers: Object.fromEntries(Object.keys(names).map(k => [k, form.elements[k].checked])) };
                await request('PUT', '/settings', patch);
                if (!result.isConnected)
                    return;
                result.textContent = L('设置已保存。', 'Settings saved.');
                form.querySelector('[data-desktop-inspect]').disabled = !patch.enabled;
                window.dispatchEvent(new Event('tools:desktop-agent-settings-changed'));
                if (patch.enabled)
                    await inspect();
            }
            catch (error) {
                if (result.isConnected)
                    result.textContent = error.message;
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
