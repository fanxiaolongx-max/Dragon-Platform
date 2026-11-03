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
.nat-tools ul{margin:6px 0 0;padding-left:20px;list-style:disc outside}
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
.nat-danger{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:10px 0;border-top:1px solid #f1f5f9}
.nat-danger:first-of-type{border-top:0}
.nat-danger-label{font-weight:800;font-size:13px}
.nat-danger-desc{color:#64748b;font-size:12px;line-height:1.55}
.nat-danger-rules{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px}
.nat-rule{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 4px 2px 10px;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:11.5px;font-weight:700}
.nat-rule span{overflow-wrap:anywhere}
.nat-rule button{border:0;background:transparent;color:#c2410c;font-size:11.5px;font-weight:800;cursor:pointer;padding:2px 6px;border-radius:999px}
.nat-rule button:hover{background:#ffedd5}
.nat-progress{height:6px;border-radius:999px;background:#e2e8f0;overflow:hidden;margin:8px 0 4px}
.nat-progress>span{display:block;height:100%;background:linear-gradient(90deg,#0f766e,#14b8a6);transition:width .4s ease}
.nat-guide-state{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:700;white-space:nowrap}
.nat-guide-state.is-ready{background:#dcfce7;color:#15803d}.nat-guide-state.is-stale{background:#fef3c7;color:#b45309}.nat-guide-state.is-missing{background:#f1f5f9;color:#64748b}
.nat-guide-body{grid-column:1/-1;margin:4px 0 8px;padding:10px 12px;border-radius:8px;background:#f8fafc;color:#334155;font-size:12px;line-height:1.65;white-space:pre-wrap;max-height:360px;overflow:auto}
.nat-link{border:0;background:none;color:#0f766e;font-size:12px;font-weight:700;cursor:pointer;padding:0 4px}
.nat-link:disabled{color:#94a3b8;cursor:not-allowed}
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

    function renderDanger() {
        const danger = view.danger;
        if (!danger) return `<p class="nat-desc">${esc(L('正在加载…', 'Loading…'))}</p>`;
        return danger.categories.map(category => {
            const rules = danger.rules.filter(rule => rule.category === category.id);
            const global = rules.some(rule => rule.scope === 'global');
            return `<div class="nat-danger">
                <div><div class="nat-danger-label">${esc(category.label)}</div><div class="nat-danger-desc">${esc(category.description)}</div></div>
                <div class="nat-actions">${global ? '' : `<button type="button" class="nat-btn" data-action="danger-allow" data-category="${esc(category.id)}" ${view.busy ? 'disabled' : ''}>${esc(L('永久不再询问', 'Never ask'))}</button>`}</div>
                ${rules.length ? `<div class="nat-danger-rules">${rules.map(rule => `<span class="nat-rule" title="${esc(`${rule.by || ''} ${rule.createdAt || ''}`.trim())}"><span>${esc(rule.scope === 'global' ? L('永久不再询问（含频道）', 'Never ask (incl. channels)') : L(`不再询问：${rule.root}`, `Never ask in ${rule.root}`))}</span><button type="button" data-action="danger-revoke" data-rule="${esc(rule.id)}" ${view.busy ? 'disabled' : ''}>${esc(L('撤销', 'Revoke'))}</button></span>`).join('')}</div>` : ''}
            </div>`;
        }).join('');
    }

    const guideStateLabel = state => ({ ready: L('已生成', 'Ready'), stale: L('待更新', 'Outdated'), missing: L('未生成', 'Missing') }[state] || state);

    function renderGuides() {
        const data = view.guides;
        if (!data) return `<p class="nat-desc">${esc(L('正在加载…', 'Loading…'))}</p>`;
        const job = data.job;
        const pending = data.stale + data.missing;
        const running = Boolean(job?.running);
        const progress = running ? `<div class="nat-progress"><span style="width:${job.total ? Math.round(job.done / job.total * 100) : 0}%"></span></div>
            <p class="nat-desc">${esc(L(`正在生成 ${job.done}/${job.total}${job.current ? `：${job.current}` : ''}`, `Generating ${job.done}/${job.total}${job.current ? `: ${job.current}` : ''}`))}</p>`
            : job?.finishedAt && job.total ? `<p class="nat-desc">${esc(L(`上次生成：${job.total - job.failed.length}/${job.total} 成功`, `Last run: ${job.total - job.failed.length}/${job.total} succeeded`))}${job.failed.length ? ` · <span style="color:#b91c1c">${esc(job.failed.map(item => `${item.title}：${item.error}`).join('；'))}</span>` : ''}</p>` : '';
        const rows = data.items.map(item => `<tr data-guide-id="${esc(item.id)}">
            <td><a href="${esc(item.href)}" target="_blank" rel="noopener">${esc(item.title)}</a></td>
            <td><span class="nat-guide-state is-${esc(item.state)}">${esc(guideStateLabel(item.state))}</span></td>
            <td>${esc(item.summary || '—')}</td>
            <td class="nat-num">${item.state !== 'missing' ? `<button type="button" class="nat-link" data-action="guide-view">${esc(L('查看', 'View'))}</button>` : ''}<button type="button" class="nat-link" data-action="guide-one" ${running ? 'disabled' : ''}>${esc(item.state === 'missing' ? L('生成', 'Generate') : L('重新生成', 'Redo'))}</button></td>
        </tr>${view.openGuide?.id === item.id ? `<tr><td colspan="4"><div class="nat-guide-body">${esc(view.openGuide.text)}</div></td></tr>` : ''}`).join('');
        return `<div class="nat-summary"><span>${esc(L('工具', 'Tools'))} <b>${data.total}</b></span><span>${esc(L('已生成', 'Ready'))} <b>${data.ready}</b></span><span>${esc(L('待更新', 'Outdated'))} <b>${data.stale}</b></span><span>${esc(L('未生成', 'Missing'))} <b>${data.missing}</b></span></div>
            ${progress}
            <div class="nat-actions" style="justify-content:flex-start;margin:8px 0">
                <button type="button" class="nat-btn is-primary" data-action="guide-generate" ${running || !pending ? 'disabled' : ''}>${esc(L(`生成缺失和过期的（${pending} 个）`, `Generate missing and outdated (${pending})`))}</button>
                <button type="button" class="nat-btn" data-action="guide-regenerate" ${running ? 'disabled' : ''}>${esc(L('全部重新生成', 'Regenerate all'))}</button>
            </div>
            <div class="nat-table-wrap"><table class="nat-table"><thead><tr><th>${esc(L('工具', 'Tool'))}</th><th>${esc(L('状态', 'State'))}</th><th>${esc(L('摘要', 'Summary'))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    let guideTimer = null;
    async function loadGuides() {
        try { view.guides = await api('GET', '/tool-guides'); } catch (error) { view.guides = { items: [], total: 0, ready: 0, stale: 0, missing: 0 }; view.notice = { type: 'error', text: error.message }; }
        render();
        clearTimeout(guideTimer);
        // 生成中每 2 秒刷新进度；设置页关掉后停止
        if (view.guides?.job?.running && view.content?.isConnected) guideTimer = setTimeout(loadGuides, 2000);
    }

    async function generateGuides(body) {
        view.busy = true; render();
        try {
            await api('POST', '/tool-guides/generate', body);
            view.notice = { type: 'ok', text: L('已开始生成，可以关闭设置页，生成在后台进行', 'Started; it keeps running in the background') };
        } catch (error) { view.notice = { type: 'error', text: error.message }; }
        view.busy = false;
        await loadGuides();
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
                    : L('MCP 服务只在默认工作区里配置和使用。', 'MCP servers are configured and used in the default workspace only.'))}</p>
                ${view.mcp ? `${view.servers.map(renderServer).join('') || `<p class="nat-desc">${esc(L('还没有 MCP 服务。', 'No MCP servers yet.'))}</p>`}
                ${view.editing && !view.editing.id ? renderForm(view.editing) : ''}
                ${view.editing ? '' : `<div class="nat-actions" style="justify-content:flex-start;margin-top:8px"><button type="button" class="nat-btn is-primary" data-action="add">${esc(L('添加服务', 'Add server'))}</button></div>`}` : ''}
            </section>
            <section class="nat-card" data-section="danger"><h4>⛔ ${esc(L('危险操作', 'Dangerous actions'))}</h4><p class="nat-desc">${esc(L('智能体执行的命令命中下面几类时，即使选了「完全访问」也会弹审批卡；可以在审批卡上按类别选择本对话、这个工作目录或永久不再询问。WeLink 频道等无人值守的对话没人审批，这几类命令不会执行，除非在这里设为永久不再询问。识别靠检查命令文本，写在脚本里的操作识别不到；命令里的 rm 会移到废纸篓，智能体改平台数据库前会自动备份。', 'Agent commands in these categories ask for approval even with full access; on the card you can stop asking for this chat, this folder or always. Unattended chats such as WeLink channels skip them unless set to never ask here. Detection reads the command text and cannot see inside scripts; rm moves files to the Trash and platform databases are backed up before the agent changes them.'))}</p>${renderDanger()}</section>
            <section class="nat-card" data-section="guides"><h4>📘 ${esc(L('工具使用说明', 'Tool guides'))}</h4><p class="nat-desc">${esc(L('用当前配置的模型读每个工具的页面和代码，生成一份面向用户的说明（能做什么、什么时候用、怎么用、工作原理）。Dragon Claw 按需求找工具、回答「怎么用」时会参考它，也会进入项目知识库检索。每个工具调用一次模型、读取约 1 万多 token 的源码；只生成缺失的和源码变了的。', 'The current model reads each tool\'s page and code and writes a user guide (what it does, when to use it, how to use it, how it works). Dragon Claw uses these to match needs to tools and explain usage, and they join the knowledge search. Each tool costs one model call reading about 10k+ tokens of source; only missing and changed tools are generated.'))}</p>${renderGuides()}</section>
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

    async function loadDanger() {
        try { view.danger = await api('GET', '/danger-rules'); } catch (error) { view.danger = { categories: [], rules: [] }; view.notice = { type: 'error', text: error.message }; }
        render();
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
            if (action === 'guide-generate') { generateGuides({}); return; }
            if (action === 'guide-regenerate') {
                const ok = window.AppDialog ? await window.AppDialog.confirm(L(`重新生成全部 ${view.guides?.total || 0} 个工具的说明？每个工具会调用一次模型。`, `Regenerate guides for all ${view.guides?.total || 0} tools? Each tool costs one model call.`), { cancelText: L('取消', 'Cancel') }) : window.confirm('?');
                if (ok) generateGuides({ force: true });
                return;
            }
            const guideId = button.closest('[data-guide-id]')?.dataset.guideId;
            if (action === 'guide-one' && guideId) { generateGuides({ ids: [guideId] }); return; }
            if (action === 'guide-view' && guideId) {
                if (view.openGuide?.id === guideId) { view.openGuide = null; render(); return; }
                try {
                    const guide = await api('GET', `/tool-guides/item?id=${encodeURIComponent(guideId)}`);
                    view.openGuide = { id: guideId, text: `${L('摘要', 'Summary')}：${guide.summary}\n\n${guide.guide}\n\n— ${guide.model || ''} · ${guide.generatedAt || ''}` };
                } catch (error) { view.notice = { type: 'error', text: error.message }; }
                render();
                return;
            }
            if (action === 'danger-allow' || action === 'danger-revoke') {
                view.busy = true; render();
                try {
                    if (action === 'danger-allow') await api('POST', '/danger-rules', { category: button.dataset.category });
                    else await api('DELETE', `/danger-rules/${encodeURIComponent(button.dataset.rule)}`);
                    view.notice = { type: 'ok', text: action === 'danger-allow' ? L('已设为永久不再询问，下一轮对话生效', 'Saved; applies from the next turn') : L('已撤销，下一轮对话生效', 'Revoked; applies from the next turn') };
                } catch (error) { view.notice = { type: 'error', text: error.message }; }
                view.busy = false;
                await loadDanger();
                return;
            }
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
        loadDanger();
        loadGuides();
        loadCatalog();
    }

    window.ToolsAgentToolsSettings = { render: render0, MASK };
})();
