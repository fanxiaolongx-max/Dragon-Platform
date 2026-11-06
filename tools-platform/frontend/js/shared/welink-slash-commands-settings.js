// 全局设置 › 频道对接 › WeLink：斜杠命令管理卡片（测试版 / Beta，基于 assistant-command-executor）
// 支持在网页端配置、发布与下架 WeLink 客户端斜杠命令，并导出本地 Python 脚手架代码。
(function () {
    'use strict';
    if (window.ToolsWelinkSlashCommands) return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const BASE = '/api/channels/welink-slash-commands';

    const state = {
        el: null,
        loaded: false,
        loading: false,
        error: '',
        busy: false,
        notice: null, // { kind: 'ok'|'bad'|'info', text: '' }
        commands: [],
        defaultUrl: window.location.origin,
        form: {
            name: 'dragonclaw',
            nameZh: '龙爪平台',
            nameEn: 'dragonclaw',
            descZh: '龙爪自动化工具平台快捷入口',
            descEn: 'Dragon Claw Platform',
            type: 1,
            scopes: ['user', 'group'],
            url: window.location.origin
        },
        scaffoldModal: null // { name, scaffold }
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

    async function load() {
        state.loading = true;
        render();
        try {
            const data = await request('GET', '');
            state.commands = data.commands || [];
            if (data.defaultUrl) {
                state.defaultUrl = data.defaultUrl;
                if (!state.form.url) state.form.url = data.defaultUrl;
            }
            state.error = '';
        } catch (error) {
            state.error = error.message;
        } finally {
            state.loading = false;
            state.loaded = true;
            render();
        }
    }

    function applyPreset(presetType) {
        if (presetType === 'dragonclaw') {
            state.form = {
                name: 'dragonclaw',
                nameZh: '龙爪平台',
                nameEn: 'dragonclaw',
                descZh: '一键呼出龙爪自动化工具平台',
                descEn: 'Dragon Claw Platform',
                type: 1,
                scopes: ['user', 'group'],
                url: state.defaultUrl || window.location.origin
            };
        } else if (presetType === 'query') {
            state.form = {
                name: 'dc_query',
                nameZh: '龙爪智能查询',
                nameEn: 'dc_query',
                descZh: '输入 /dc_query 自动化查询与待办',
                descEn: 'Dragon Claw Local Query',
                type: 3,
                scopes: ['user', 'group'],
                url: ''
            };
        }
        state.notice = { kind: 'info', text: L(`已填充预设配置（${state.form.nameZh}），确认信息后点击下方「发布命令」即可提交。`, `Preset loaded (${state.form.nameZh}). Click "Publish Command" below to submit.`) };
        render();
    }

    async function handlePublish() {
        if (state.busy) return;
        const form = state.form;
        const name = String(form.name || '').trim().toLowerCase().replace(/^\//, '');
        if (!name) {
            state.notice = { kind: 'bad', text: L('请填写命令英文名称（触发词）', 'Command English identifier is required') };
            render();
            return;
        }
        if (Number(form.type) !== 3 && !String(form.url || '').trim()) {
            state.notice = { kind: 'bad', text: L('打开网页类型必须填写目标 URL', 'Target URL is required for web-opening command') };
            render();
            return;
        }
        state.busy = true;
        state.notice = null;
        render();
        try {
            const payload = {
                name,
                nameZh: form.nameZh || name,
                nameEn: form.nameEn || name,
                descZh: form.descZh || '',
                descEn: form.descEn || '',
                type: Number(form.type) || 1,
                scopes: form.scopes.length ? form.scopes : ['user', 'group'],
                url: form.url || ''
            };
            const result = await request('POST', '', payload);
            state.notice = {
                kind: 'ok',
                text: L(
                    `🎉 斜杠命令 /${name} 发布成功！已同步至 WeLink 网关。由于网关分布式缓存机制，大约需要 5~10 分钟在客户端生效，届时在聊天框键入「/」即可选用。`,
                    `Command /${name} published! Gateway sync takes ~5-10 minutes to reflect in WeLink client.`
                )
            };
            await load();
        } catch (error) {
            state.notice = { kind: 'bad', text: error.message };
        } finally {
            state.busy = false;
            render();
        }
    }

    async function handleDelete(name) {
        if (!confirm(L(`确定从 WeLink 网关注销并下架斜杠命令 /${name} 吗？`, `Unpublish slash command /${name}?`))) return;
        state.busy = true;
        render();
        try {
            await request('DELETE', `/${encodeURIComponent(name)}`);
            state.notice = { kind: 'ok', text: L(`命令 /${name} 已成功下架。`, `Command /${name} removed.`) };
            await load();
        } catch (error) {
            state.notice = { kind: 'bad', text: error.message };
        } finally {
            state.busy = false;
            render();
        }
    }

    async function handleViewScaffold(name) {
        try {
            const data = await request('GET', `/${encodeURIComponent(name)}/scaffold`);
            state.scaffoldModal = { name, scaffold: data.scaffold, command: data.command };
            render();
        } catch (error) {
            state.notice = { kind: 'bad', text: error.message };
            render();
        }
    }

    function copyToClipboard(text, successMsg) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                state.notice = { kind: 'ok', text: successMsg || L('已复制到剪贴板', 'Copied to clipboard') };
                render();
            });
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            state.notice = { kind: 'ok', text: successMsg || L('已复制到剪贴板', 'Copied to clipboard') };
            render();
        }
    }

    function renderModal() {
        if (!state.scaffoldModal) return '';
        const modal = state.scaffoldModal;
        return `
        <div style="position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;">
            <div class="wsc-modal-window" style="background:var(--v2-bg, #fff);border-radius:12px;width:100%;max-width:760px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 25px -5px rgba(0,0,0,0.4);border:1px solid var(--v2-line, #e2e8f0);overflow:hidden;">
                <div style="padding:14px 18px;border-bottom:1px solid var(--v2-line, #e2e8f0);display:flex;align-items:center;justify-content:space-between;">
                    <div style="font-weight:800;font-size:14px;color:var(--v2-ink, #0f172a);display:flex;align-items:center;gap:8px;">
                        <span>🐍 WeLink 命令脚手架代码 (commands/${esc(modal.name)}_command/command.py)</span>
                    </div>
                    <button type="button" class="nch-btn" data-action="close-scaffold-modal" style="height:26px;padding:0 8px;">✕</button>
                </div>
                <div style="padding:12px 18px;background:var(--v2-side, #f8fafc);border-bottom:1px solid var(--v2-line, #e2e8f0);font-size:12px;color:var(--v2-ink3, #475569);line-height:1.5;">
                    💡 将下方代码保存到本地 <code>assistant_command_executor\\commands\\${esc(modal.name)}_command\\command.py</code>，然后运行 <code>python -m ace serve --env prod</code> 即可在本地调试运行。
                </div>
                <div style="padding:14px 18px;overflow-y:auto;flex:1;">
                    <pre style="margin:0;padding:12px;background:#0f172a;color:#e2e8f0;border-radius:8px;font-size:12px;font-family:ui-monospace,Menlo,Monaco,monospace;line-height:1.5;overflow-x:auto;"><code>${esc(modal.scaffold)}</code></pre>
                </div>
                <div style="padding:12px 18px;border-top:1px solid var(--v2-line, #e2e8f0);display:flex;justify-content:flex-end;gap:10px;">
                    <button type="button" class="nch-btn" data-action="close-scaffold-modal">${esc(L('关闭', 'Close'))}</button>
                    <button type="button" class="nch-btn primary" data-action="copy-scaffold-code">📋 ${esc(L('复制代码', 'Copy Code'))}</button>
                </div>
            </div>
        </div>`;
    }

    function render() {
        if (!state.el) return;
        const el = state.el;

        const noticeHtml = state.notice ? `<div class="nch-alert ${esc(state.notice.kind)}" style="margin-bottom:12px">${esc(state.notice.text)}</div>` : '';
        const errorHtml = state.error ? `<div class="nch-alert bad" style="margin-bottom:12px">${esc(state.error)}</div>` : '';

        // 命令列表行
        const rows = state.commands.map(cmd => {
            const isWeb = cmd.type === 1 || cmd.type === 2;
            const typeLabel = cmd.type === 1 ? L('网页直达', 'Web Open') : (cmd.type === 2 ? L('网页卡片', 'Web Card') : L('Python 回调', 'Python Hook'));
            const scopesLabel = (cmd.scopes || []).map(s => s === 'user' ? L('单聊', 'Direct') : L('群聊', 'Group')).join(' + ') || L('全范围', 'All');
            const targetContent = isWeb
                ? (cmd.url
                    ? `<a href="${esc(cmd.url)}" target="_blank" rel="noreferrer" style="color:#2563eb;text-decoration:none">${esc(cmd.url)}</a>`
                    : `<span class="nch-muted">${esc(L('未配置 URL', 'No URL configured'))}</span>`)
                : `<span class="nch-muted">${esc(cmd.descZh || L('本地 Python 监听回调', 'Local Python hook'))}</span>`;

            return `
            <tr>
                <td style="vertical-align:middle;font-weight:700;color:#2563eb;white-space:nowrap;font-size:12px;line-height:1.4">/${esc(cmd.name)}</td>
                <td style="vertical-align:middle;white-space:nowrap;font-size:12px;line-height:1.4">${esc(cmd.nameZh || cmd.name)}</td>
                <td style="vertical-align:middle;white-space:nowrap"><span class="nch-pill ${isWeb ? 'ok' : 'info'}" style="font-size:11px;padding:2px 8px;vertical-align:middle;line-height:1.2">${esc(typeLabel)}</span></td>
                <td style="vertical-align:middle;white-space:nowrap;font-size:12px;line-height:1.4">${esc(scopesLabel)}</td>
                <td style="vertical-align:middle;font-size:12px;line-height:1.4;max-width:240px;word-break:break-all;">${targetContent}</td>
                <td style="vertical-align:middle;white-space:nowrap">
                    <div style="display:flex;gap:6px;align-items:center;">
                        <button type="button" class="nch-btn" data-action="copy-cmd" data-name="${esc(cmd.name)}" title="${esc(L('复制触发指令', 'Copy command text'))}" style="height:26px;padding:0 8px;font-size:11px;display:inline-flex;align-items:center;gap:3px">📋 /${esc(cmd.name)}</button>
                        <button type="button" class="nch-btn" data-action="view-scaffold" data-name="${esc(cmd.name)}" title="${esc(L('查看/导出 Python 脚手架', 'View Python scaffold'))}" style="height:26px;padding:0 8px;font-size:11px;display:inline-flex;align-items:center;gap:3px">🐍 ${esc(L('代码', 'Code'))}</button>
                        <button type="button" class="nch-btn danger" data-action="delete-cmd" data-name="${esc(cmd.name)}" ${state.busy ? 'disabled' : ''} title="${esc(L('下架注销', 'Delete'))}" style="height:26px;padding:0 8px;font-size:11px;display:inline-flex;align-items:center;justify-content:center">🗑️</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        const tableHtml = !state.commands.length
            ? `<div class="nch-muted" style="padding:16px 0;text-align:center">${esc(L('暂无已发布的斜杠命令，请在下方快速配置并发布。', 'No slash commands yet. Fill the form below to publish.'))}</div>`
            : `
            <div class="nch-table-wrap" style="margin-bottom:14px;"><table class="nch-table wsc-table">
                <thead><tr>
                    <th style="vertical-align:middle">${esc(L('触发词', 'Trigger'))}</th>
                    <th style="vertical-align:middle">${esc(L('显示名称', 'Display Name'))}</th>
                    <th style="vertical-align:middle">${esc(L('类型', 'Type'))}</th>
                    <th style="vertical-align:middle">${esc(L('入口范围', 'Scope'))}</th>
                    <th style="vertical-align:middle">${esc(L('目标 / 说明', 'Target / Notes'))}</th>
                    <th style="vertical-align:middle;width:170px">${esc(L('操作', 'Actions'))}</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table></div>`;

        const form = state.form;
        const isTypeWeb = Number(form.type) !== 3;

        el.innerHTML = `
            <style>
                .wsc-table th, .wsc-table td {
                    vertical-align: middle !important;
                    padding-top: 8px !important;
                    padding-bottom: 8px !important;
                }
            </style>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <h4 style="margin:0;display:flex;align-items:center;gap:6px;">
                    <span>⚡ ${esc(L('WeLink 斜杠命令管理', 'WeLink Slash Commands'))}</span>
                    <span class="nch-pill" style="background:#8b5cf615;color:#8b5cf6;border:1px solid #8b5cf635;font-size:11px;padding:1px 6px;">${esc(L('测试版', 'Beta'))}</span>
                </h4>
                <div style="display:flex;gap:6px;">
                    <button type="button" class="nch-btn" data-action="refresh" ${state.loading ? 'disabled' : ''}>🔄 ${esc(L('刷新列表', 'Refresh'))}</button>
                </div>
            </div>
            <p class="nch-desc" style="margin-bottom:10px;">
                ${esc(L(
                    '在 WeLink 客户端聊天框键入「/」唤起命令候选菜单。Type 1（网页直达）在群聊中供全员一键点击打开，无需本地常驻后台；Type 3（本地 Python 命令）由发布者电脑的 ace serve 提供消息处理服务。',
                    'Type "/" in WeLink IM chat to trigger commands. Type 1 allows all group members to open web portals directly without background daemon; Type 3 executes via local Python ace serve.'
                ))}
            </p>

            ${noticeHtml}
            ${errorHtml}

            <!-- 现存命令表格 -->
            <div style="margin-top:8px;">
                <div style="font-size:12px;font-weight:700;color:var(--v2-ink2, #334155);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                    <span>📋 ${esc(L('已注册的斜杠命令', 'Registered Commands'))}</span>
                    <span class="nch-muted" style="font-weight:400;font-size:11px;">(${state.commands.length})</span>
                </div>
                ${tableHtml}
            </div>

            <!-- 新增发布表单 -->
            <div class="wsc-form-card" style="background:var(--v2-side, #f8fafc);border:1px solid var(--v2-line, #e2e8f0);border-radius:10px;padding:14px;margin-top:12px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
                    <span style="font-size:13px;font-weight:800;color:var(--v2-ink, #0f172a);">🚀 ${esc(L('发布新斜杠命令', 'Publish New Slash Command'))}</span>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button type="button" class="nch-btn" data-action="preset-dragonclaw" style="font-size:11px;height:26px;">🌟 ${esc(L('填入龙爪平台一键直达 (Type 1)', 'Preset: Dragon Claw (Type 1)'))}</button>
                        <button type="button" class="nch-btn" data-action="preset-query" style="font-size:11px;height:26px;">⚡ ${esc(L('填入本地智能查询 (Type 3)', 'Preset: Local Query (Type 3)'))}</button>
                    </div>
                </div>

                <div class="nch-grid" style="grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:10px;">
                    <div class="nch-field">
                        <span>${esc(L('命令英文标识 (触发词)', 'Identifier (Trigger)'))} *</span>
                        <input type="text" data-field="name" value="${esc(form.name)}" placeholder="如 dragonclaw（输入 /dragonclaw）" />
                        <small class="nch-muted">${esc(L('小写字母、数字或下划线', 'Lowercase letters, digits, underscores'))}</small>
                    </div>
                    <div class="nch-field">
                        <span>${esc(L('中文显示名称', 'Chinese Name'))} *</span>
                        <input type="text" data-field="nameZh" value="${esc(form.nameZh)}" placeholder="如 龙爪平台" />
                    </div>
                    <div class="nch-field">
                        <span>${esc(L('命令类型', 'Command Type'))} *</span>
                        <select data-field="type">
                            <option value="1" ${Number(form.type) === 1 ? 'selected' : ''}>1 - 直接打开网页 / We码（推荐，轻量）</option>
                            <option value="2" ${Number(form.type) === 2 ? 'selected' : ''}>2 - 在聊天中返回网页卡片</option>
                            <option value="3" ${Number(form.type) === 3 ? 'selected' : ''}>3 - 本地 Python 命令（需 ace serve）</option>
                        </select>
                    </div>
                    <div class="nch-field">
                        <span>${esc(L('入口范围', 'Scope'))} *</span>
                        <div style="display:flex;gap:12px;height:32px;align-items:center;">
                            <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--v2-ink, inherit);">
                                <input type="checkbox" data-scope="user" ${form.scopes.includes('user') ? 'checked' : ''} /> IM 单聊
                            </label>
                            <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--v2-ink, inherit);">
                                <input type="checkbox" data-scope="group" ${form.scopes.includes('group') ? 'checked' : ''} /> IM 群聊
                            </label>
                        </div>
                    </div>
                    <div class="nch-field nch-wide" style="grid-column:1/-1;">
                        <span>${esc(L('中文描述', 'Description'))}</span>
                        <input type="text" data-field="descZh" value="${esc(form.descZh)}" placeholder="如 龙爪自动化工具平台快捷入口" />
                    </div>
                    ${isTypeWeb ? `
                    <div class="nch-field nch-wide" style="grid-column:1/-1;">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                            <span>${esc(L('目标网页 URL (打开的网页或 We 码链接)', 'Target Web URL'))} *</span>
                            <button type="button" class="nch-link" data-action="fill-current-url" style="font-size:11px;">🔗 ${esc(L('填入当前平台地址', 'Fill current origin'))}</button>
                        </div>
                        <input type="text" data-field="url" value="${esc(form.url)}" placeholder="例如 ${esc(state.defaultUrl || 'http://127.0.0.1:5200')}" />
                        <small class="nch-muted">${esc(L('若需群内其他同事直接打开，请填写真实内网 IP 或域名，不要填 localhost', 'For other colleagues to access, use an intranet IP or domain, not localhost'))}</small>
                    </div>
                    ` : `
                    <div class="nch-field nch-wide" style="grid-column:1/-1;">
                        <div class="nch-alert info" style="margin:0;font-size:11px;">
                            💡 <b>${esc(L('Type 3 说明', 'Type 3 Notes'))}</b>：发布后，群成员在聊天中触发此命令时，事件会通过长连接路由至发布者本机。发布者电脑需在华为内网运行 <code>python -m ace serve --env prod</code> 接收处理。点击发布后可在上方列表中导出 Python <code>command.py</code> 业务逻辑代码。
                        </div>
                    </div>
                    `}
                </div>

                <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:14px;gap:10px;">
                    <button type="button" class="nch-btn primary" data-action="publish-slash-cmd" ${state.busy ? 'disabled' : ''}>
                        ${state.busy ? '⏳ ' + esc(L('正在发布…', 'Publishing…')) : '🚀 ' + esc(L('发布命令到 WeLink 网关', 'Publish Command to WeLink'))}
                    </button>
                </div>
            </div>

            ${renderModal()}
        `;

        bindEvents();
    }

    function bindEvents() {
        const el = state.el;
        if (!el) return;

        // 刷新
        el.querySelector('[data-action="refresh"]')?.addEventListener('click', () => load());

        // 预设
        el.querySelector('[data-action="preset-dragonclaw"]')?.addEventListener('click', () => applyPreset('dragonclaw'));
        el.querySelector('[data-action="preset-query"]')?.addEventListener('click', () => applyPreset('query'));

        // 填入当前平台地址
        el.querySelector('[data-action="fill-current-url"]')?.addEventListener('click', () => {
            state.form.url = state.defaultUrl || window.location.origin;
            render();
        });

        // 表单字段输入监听
        ['name', 'nameZh', 'descZh', 'url'].forEach(f => {
            el.querySelector(`[data-field="${f}"]`)?.addEventListener('input', e => {
                state.form[f] = e.target.value;
            });
        });

        // 类型选择
        el.querySelector('[data-field="type"]')?.addEventListener('change', e => {
            state.form.type = Number(e.target.value);
            render();
        });

        // 范围多选
        el.querySelectorAll('[data-scope]').forEach(cb => {
            cb.addEventListener('change', () => {
                const checked = [];
                el.querySelectorAll('[data-scope]:checked').forEach(c => checked.push(c.getAttribute('data-scope')));
                state.form.scopes = checked.length ? checked : ['user', 'group'];
            });
        });

        // 发布
        el.querySelector('[data-action="publish-slash-cmd"]')?.addEventListener('click', handlePublish);

        // 表格操作
        el.querySelectorAll('[data-action="copy-cmd"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.getAttribute('data-name');
                copyToClipboard(`/${name}`, L(`已复制指令 /${name} 到剪贴板`, `Copied /${name}`));
            });
        });

        el.querySelectorAll('[data-action="view-scaffold"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.getAttribute('data-name');
                handleViewScaffold(name);
            });
        });

        el.querySelectorAll('[data-action="delete-cmd"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.getAttribute('data-name');
                handleDelete(name);
            });
        });

        // 模态框操作
        el.querySelectorAll('[data-action="close-scaffold-modal"]').forEach(btn => {
            btn.addEventListener('click', () => {
                state.scaffoldModal = null;
                render();
            });
        });

        el.querySelector('[data-action="copy-scaffold-code"]')?.addEventListener('click', () => {
            if (state.scaffoldModal?.scaffold) {
                copyToClipboard(state.scaffoldModal.scaffold, L('脚手架代码已复制到剪贴板！', 'Scaffold code copied!'));
            }
        });
    }

    function init(rootEl) {
        state.el = rootEl;
        if (!state.loaded && !state.loading) {
            load();
        } else {
            render();
        }
    }

    window.ToolsWelinkSlashCommands = {
        render: init,
        load
    };
})();
