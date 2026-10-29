// 全局设置 › 智能体工具：MCP 服务（默认租户，增删改、启用、只读免审批、测试连接）与 Dragon Claw 工具清单。
// 由 navbar.js 在切换到 agentTools 标签时按需加载；数据来自 /api/agent-mcp（backend/routes/agent-mcp.js）。
(function () {
    'use strict';
    if (window.ToolsAgentToolsSettings) return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const MASK = '••••••';
    const EMPTY = { id: '', name: '', enabled: true, trusted: false, transport: 'stdio', command: '', args: [], cwd: '', env: {}, url: '', headers: {}, timeoutMs: 120000 };
    const view = { content: null, servers: [], catalog: null, editing: null, notice: null, busy: false, mcp: true };

    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    async function api(method, path, body) {
        const res = await fetch(`/api/agent-mcp${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function ensureStyle() {
        if (document.getElementById('tools-agent-tools-settings-style')) return;
        const style = document.createElement('style');
        style.id = 'tools-agent-tools-settings-style';
        style.textContent = `
.nat{display:flex;flex-direction:column;gap:14px;padding-bottom:60px;color:#0f172a}
.nat-card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:14px 16px;min-width:0}
.nat-card h4{margin:0 0 4px;font-size:14px;font-weight:850;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nat-desc{margin:0 0 12px;color:#64748b;font-size:12px;line-height:1.6}
.nat-notice{padding:8px 12px;border-radius:8px;font-size:12px}
.nat-notice.is-ok{background:#ecfdf5;color:#047857}.nat-notice.is-error{background:#fef2f2;color:#b91c1c}
.nat-server{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;padding:10px 0;border-top:1px solid #f1f5f9}
.nat-server:first-of-type{border-top:0}
.nat-server-name{font-weight:800;font-size:13px;overflow-wrap:anywhere}
.nat-server-meta{color:#64748b;font-size:12px;overflow-wrap:anywhere;margin-top:2px}
.nat-server-error{color:#b91c1c;font-size:12px;margin-top:4px;overflow-wrap:anywhere}
.nat-badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:700;background:#f1f5f9;color:#475569}
.nat-badge.is-ready{background:#dcfce7;color:#15803d}.nat-badge.is-error{background:#fee2e2;color:#b91c1c}.nat-badge.is-connecting{background:#dbeafe;color:#1d4ed8}
.nat-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end}
.nat-btn{height:28px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:12px;font-weight:700;cursor:pointer}
.nat-btn:hover{border-color:#94a3b8}.nat-btn.is-primary{background:#0f766e;border-color:#0f766e;color:#fff}.nat-btn.is-danger{color:#b91c1c}
.nat-btn:disabled{opacity:.55;cursor:not-allowed}
.nat-tools{grid-column:1/-1;font-size:12px;color:#475569}
.nat-tools summary{cursor:pointer;font-weight:700}
.nat-tools li{margin:3px 0;overflow-wrap:anywhere}
.nat-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 14px;margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1}
.nat-field{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}
.nat-field>span{color:#475569;font-weight:700}.nat-field small{color:#94a3b8;line-height:1.5}
.nat-field input,.nat-field select,.nat-field textarea{border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;font-size:13px;background:#fff;color:#0f172a;min-width:0;font-family:inherit}
.nat-field textarea{min-height:64px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.nat-wide{grid-column:1/-1}
.nat-switch{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:700;cursor:pointer}
.nat-group{margin-top:12px}
.nat-group-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:800}
.nat-group-head small{color:#64748b;font-weight:500}
.nat-table-wrap{overflow-x:auto}
.nat-table{width:100%;border-collapse:collapse;margin-top:6px;font-size:12px}
.nat-table th,.nat-table td{padding:5px 8px;border-top:1px solid #f1f5f9;text-align:left;vertical-align:top}
.nat-table th{color:#64748b;font-weight:700;white-space:nowrap}
.nat-table td.nat-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.nat-table code{font-size:11.5px;overflow-wrap:anywhere}
.nat-table td:first-child code{white-space:nowrap;overflow-wrap:normal}
.nat-summary{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#475569}
.nat-summary b{color:#0f172a;font-size:15px}
`;
        document.head.appendChild(style);
    }

    const statusLabel = status => ({ ready: L('已连接', 'Connected'), error: L('连接失败', 'Failed'), connecting: L('连接中', 'Connecting'), disabled: L('已停用', 'Disabled'), idle: L('未连接', 'Not connected') }[status] || status);
    const mapToLines = (map, sep) => Object.entries(map || {}).map(([key, value]) => `${key}${sep}${value}`).join('\n');
    function linesToMap(text, sep) {
        const out = {};
        String(text || '').split('\n').map(line => line.trim()).filter(Boolean).forEach(line => {
            const index = line.indexOf(sep);
            if (index > 0) out[line.slice(0, index).trim()] = line.slice(index + sep.length).trim();
        });
        return out;
    }

    function renderServer(server) {
        const where = server.transport === 'http' ? server.url : [server.command, ...(server.args || [])].join(' ');
        return `<div class="nat-server" data-id="${esc(server.id)}">
            <div>
                <div class="nat-server-name">${esc(server.name)} <span class="nat-badge is-${esc(server.status)}">${esc(statusLabel(server.status))}</span>${server.trusted ? ` <span class="nat-badge">${esc(L('只读免审批', 'Read-only, no approval'))}</span>` : ''}</div>
                <div class="nat-server-meta">${esc(server.transport === 'http' ? 'HTTP' : L('本机进程', 'Local process'))} · <code>${esc(where)}</code></div>
                ${server.error ? `<div class="nat-server-error">${esc(server.error)}</div>` : ''}
            </div>
            <div class="nat-actions">
                <button type="button" class="nat-btn" data-action="test" ${view.busy ? 'disabled' : ''}>${esc(L('测试连接', 'Test'))}</button>
                <button type="button" class="nat-btn" data-action="edit">${esc(L('编辑', 'Edit'))}</button>
                <button type="button" class="nat-btn is-danger" data-action="remove">${esc(L('删除', 'Delete'))}</button>
            </div>
            ${server.tools?.length ? `<details class="nat-tools"><summary>${esc(L(`${server.tools.length} 个工具`, `${server.tools.length} tools`))}</summary><ul>${server.tools.map(tool => `<li><code>${esc(tool.name)}</code> ${esc(tool.description)}</li>`).join('')}</ul></details>` : ''}
            ${view.editing?.id === server.id ? renderForm(view.editing) : ''}
        </div>`;
    }

    function renderForm(draft) {
        const http = draft.transport === 'http';
        return `<form class="nat-form nat-wide" data-form>
            <label class="nat-field"><span>${esc(L('名称', 'Name'))}</span><input name="name" value="${esc(draft.name)}" maxlength="60" required></label>
            <label class="nat-field"><span>${esc(L('连接方式', 'Transport'))}</span><select name="transport"><option value="stdio" ${http ? '' : 'selected'}>${esc(L('本机进程（stdio）', 'Local process (stdio)'))}</option><option value="http" ${http ? 'selected' : ''}>HTTP</option></select></label>
            <label class="nat-field"><span>${esc(L('单次调用超时（秒）', 'Call timeout (s)'))}</span><input name="timeout" type="number" min="5" max="600" value="${esc(Math.round((draft.timeoutMs || 120000) / 1000))}"></label>
            ${http ? `
            <label class="nat-field nat-wide"><span>${esc(L('地址', 'URL'))}</span><input name="url" value="${esc(draft.url)}" placeholder="https://example.com/mcp"></label>
            <label class="nat-field nat-wide"><span>${esc(L('请求头（每行一个：名称: 值）', 'Headers (one per line, Name: value)'))}</span><textarea name="headers">${esc(mapToLines(draft.headers, ': '))}</textarea><small>${esc(L('值按密钥保存：不显示、不发给模型；保留 •••••• 表示不修改。', 'Values are stored as secrets: hidden and never sent to the model; keep •••••• to leave unchanged.'))}</small></label>` : `
            <label class="nat-field nat-wide"><span>${esc(L('启动命令', 'Command'))}</span><input name="command" value="${esc(draft.command)}" placeholder="/usr/local/bin/node"><small>${esc(L('先把服务装好并写死版本，填本地可执行文件；不要用 npx …@latest 现下载。', 'Install the server first with a pinned version; do not use npx …@latest.'))}</small></label>
            <label class="nat-field nat-wide"><span>${esc(L('参数（每行一个）', 'Arguments (one per line)'))}</span><textarea name="args">${esc((draft.args || []).join('\n'))}</textarea></label>
            <label class="nat-field"><span>${esc(L('工作目录（可选）', 'Working directory (optional)'))}</span><input name="cwd" value="${esc(draft.cwd)}"></label>
            <label class="nat-field nat-wide"><span>${esc(L('环境变量（每行一个：名称=值）', 'Environment (one per line, NAME=value)'))}</span><textarea name="env">${esc(mapToLines(draft.env, '='))}</textarea><small>${esc(L('值按密钥保存：不显示、不发给模型；保留 •••••• 表示不修改。代理（HTTPS_PROXY 等）会自动带上。', 'Values are stored as secrets; keep •••••• to leave unchanged. Proxy variables are passed automatically.'))}</small></label>`}
            <label class="nat-switch"><input type="checkbox" name="enabled" ${draft.enabled !== false ? 'checked' : ''}>${esc(L('启用', 'Enabled'))}</label>
            <label class="nat-switch" title="${esc(L('只在确认该服务只读取、不修改任何东西时勾选', 'Only for servers that never change anything'))}"><input type="checkbox" name="trusted" ${draft.trusted ? 'checked' : ''}>${esc(L('只读，调用不用审批', 'Read-only, no approval'))}</label>
            <div class="nat-actions nat-wide" style="justify-content:flex-start">
                <button type="submit" class="nat-btn is-primary" ${view.busy ? 'disabled' : ''}>${esc(L('保存', 'Save'))}</button>
                <button type="button" class="nat-btn" data-action="cancel">${esc(L('取消', 'Cancel'))}</button>
            </div>
        </form>`;
    }

    function renderCatalog() {
        const catalog = view.catalog;
        if (!catalog) return `<p class="nat-desc">${esc(L('正在加载…', 'Loading…'))}</p>`;
        const all = catalog.groups.flatMap(group => group.tools);
        const upfront = catalog.groups.filter(group => group.mode === 'always').flatMap(group => group.tools).reduce((sum, tool) => sum + tool.tokens, 0);
        return `<div class="nat-summary"><span>${esc(L('工具', 'Tools'))} <b>${all.length}</b></span><span>${esc(L('每步固定带上（工作区）约', 'Sent every step (workspace) ~'))} <b>${upfront.toLocaleString()}</b> token</span><span>${esc(L('累计调用', 'Total calls'))} <b>${all.reduce((sum, tool) => sum + tool.calls, 0).toLocaleString()}</b></span></div>
            ${catalog.groups.map(group => `<div class="nat-group">
                <div class="nat-group-head">${esc(group.label)} <small>${esc(group.note || '')}</small></div>
                ${group.tools.length ? `<div class="nat-table-wrap"><table class="nat-table"><thead><tr><th>${esc(L('工具', 'Tool'))}</th><th>${esc(L('类别', 'Kind'))}</th><th>${esc(L('说明', 'Description'))}</th><th class="nat-num">token</th><th class="nat-num">${esc(L('调用', 'Calls'))}</th></tr></thead><tbody>
                    ${group.tools.map(tool => `<tr><td><code>${esc(tool.name)}</code></td><td>${esc(tool.kindLabel)}</td><td>${esc(tool.summary)}</td><td class="nat-num">${tool.tokens}</td><td class="nat-num" title="${esc(tool.lastUsedAt ? L(`最近 ${tool.lastUsedAt}`, `Last ${tool.lastUsedAt}`) : '')}">${tool.calls}${tool.failures ? ` <small style="color:#b91c1c">✗${tool.failures}</small>` : ''}</td></tr>`).join('')}
                </tbody></table></div>` : ''}
            </div>`).join('')}`;
    }

    function render() {
        const content = view.content;
        if (!content) return;
        content.innerHTML = `<div class="nat">
            ${view.notice ? `<div class="nat-notice is-${view.notice.type}">${esc(view.notice.text)}</div>` : ''}
            <section class="nat-card" data-section="mcp">
                <h4>🔌 ${esc(L('MCP 服务', 'MCP servers'))}</h4>
                <p class="nat-desc">${esc(view.mcp
                    ? L('服务的工具会接进首页对话（选不选目录都能用），按需加载；默认每次调用都要用户在对话里批准。连不上的服务会自动跳过，换到能连上的网络后自动恢复。', 'Server tools join home chats (with or without a folder), loaded on demand; every call needs approval by default. Unreachable servers are skipped and come back automatically.')
                    : L('MCP 服务只在默认租户里配置和使用。', 'MCP servers are configured and used in the default tenant only.'))}</p>
                ${view.mcp ? `${view.servers.map(renderServer).join('') || `<p class="nat-desc">${esc(L('还没有 MCP 服务。', 'No MCP servers yet.'))}</p>`}
                ${view.editing && !view.editing.id ? renderForm(view.editing) : ''}
                ${view.editing ? '' : `<div class="nat-actions" style="justify-content:flex-start;margin-top:8px"><button type="button" class="nat-btn is-primary" data-action="add">${esc(L('添加服务', 'Add server'))}</button></div>`}` : ''}
            </section>
            <section class="nat-card"><h4>🧰 ${esc(L('工具清单', 'Tool catalog'))}</h4><p class="nat-desc">${esc(L('Dragon Claw 首页对话能用的工具，按来源分组；token 是工具说明占用的上下文，按需加载的工具只在用到时才占用。', 'Tools Dragon Claw home chats can use, grouped by source; tokens are the context each description takes, and deferred tools only count once loaded.'))}</p>${renderCatalog()}</section>
        </div>`;
    }

    function readForm(form) {
        const data = new FormData(form);
        const transport = data.get('transport') === 'http' ? 'http' : 'stdio';
        const base = view.editing || {};
        const server = { id: base.id || '', name: String(data.get('name') || '').trim(), transport, enabled: data.get('enabled') === 'on', trusted: data.get('trusted') === 'on',
            timeoutMs: Math.round(Number(data.get('timeout')) * 1000) || 120000 };
        if (transport === 'http') Object.assign(server, { url: String(data.get('url') || '').trim(), headers: linesToMap(data.get('headers'), ':') });
        else Object.assign(server, { command: String(data.get('command') || '').trim(), args: String(data.get('args') || '').split('\n').map(item => item.trim()).filter(Boolean), cwd: String(data.get('cwd') || '').trim(), env: linesToMap(data.get('env'), '=') });
        return server;
    }

    async function persist(servers, okText) {
        view.busy = true; render();
        try {
            view.servers = (await api('PUT', '/servers', { servers })).servers;
            view.editing = null;
            view.notice = { type: 'ok', text: okText };
            loadCatalog();
        } catch (error) {
            view.notice = { type: 'error', text: error.message };
        } finally {
            view.busy = false; render();
        }
    }

    async function loadCatalog() {
        try { view.catalog = await api('GET', '/catalog'); } catch (error) { view.catalog = { groups: [] }; view.notice = { type: 'error', text: error.message }; }
        render();
    }

    function bind(content) {
        content.addEventListener('click', async event => {
            const button = event.target.closest('[data-action]');
            if (!button || !content.contains(button) || !button.closest('.nat')) return; // 同一容器也渲染其他设置页
            const action = button.dataset.action;
            const id = button.closest('[data-id]')?.dataset.id;
            const server = view.servers.find(item => item.id === id);
            if (action === 'add') { view.editing = { ...EMPTY }; view.notice = null; render(); return; }
            if (action === 'cancel') { view.editing = null; render(); return; }
            if (action === 'edit' && server) { view.editing = JSON.parse(JSON.stringify(server)); view.notice = null; render(); return; }
            if (action === 'remove' && server) {
                const ok = window.AppDialog ? await window.AppDialog.confirm(L(`删除 MCP 服务「${server.name}」？`, `Delete MCP server "${server.name}"?`), { cancelText: L('取消', 'Cancel'), danger: true }) : window.confirm(server.name);
                if (ok) persist(view.servers.filter(item => item.id !== id), L('已删除', 'Deleted'));
                return;
            }
            if (action === 'test' && server) {
                view.busy = true; view.notice = { type: 'ok', text: L(`正在连接「${server.name}」…`, `Connecting to "${server.name}"…`) }; render();
                try {
                    const tested = (await api('POST', `/servers/${encodeURIComponent(id)}/test`)).server;
                    view.servers = view.servers.map(item => (item.id === id ? tested : item));
                    view.notice = tested.status === 'ready'
                        ? { type: 'ok', text: L(`已连接，发现 ${tested.tools.length} 个工具`, `Connected: ${tested.tools.length} tools`) }
                        : { type: 'error', text: `${L('连接失败', 'Failed')}：${tested.error}` };
                    loadCatalog();
                } catch (error) { view.notice = { type: 'error', text: error.message }; }
                view.busy = false; render();
            }
        });
        content.addEventListener('change', event => {
            if (event.target.name !== 'transport' || !view.editing || !event.target.closest('.nat')) return;
            Object.assign(view.editing, readForm(event.target.form));
            render();
        });
        content.addEventListener('submit', event => {
            const form = event.target.closest('.nat [data-form]');
            if (!form) return;
            event.preventDefault();
            const draft = readForm(form);
            const servers = draft.id ? view.servers.map(item => (item.id === draft.id ? draft : item)) : [...view.servers, draft];
            persist(servers, L('已保存', 'Saved'));
        });
    }

    async function render0(content) {
        ensureStyle();
        view.content = content;
        view.editing = null;
        view.notice = null;
        render();
        if (!content.dataset.natBound) { bind(content); content.dataset.natBound = '1'; }
        try {
            view.servers = (await api('GET', '/servers')).servers;
            view.mcp = true;
        } catch (error) {
            view.servers = [];
            view.mcp = false;
            if (!/默认租户|default tenant/i.test(error.message)) view.notice = { type: 'error', text: error.message };
        }
        render();
        loadCatalog();
    }

    window.ToolsAgentToolsSettings = { render: render0, MASK };
})();
