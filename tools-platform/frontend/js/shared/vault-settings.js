// 全局设置 › 保险箱：本人保存的网站账号密码（Dragon 浏览器自动填充、AI 代填用）。
// 由 navbar.js 在切换到 vault 标签时按需加载；数据来自 /api/vault（backend/routes/vault.js），只返回当前登录账号自己的条目。
(function () {
    'use strict';
    if (window.ToolsVaultSettings) return;

    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);
    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    const view = { content: null, entries: [], neverSave: [], editing: null, reveal: null, revealed: null, query: '', notice: null, busy: false, loadError: '' };
    let revealTimer = null;

    function authHeaders() {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }
    async function api(method, path, body) {
        const res = await fetch(`/api/vault${path}`, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function ensureStyle() {
        if (document.getElementById('tools-vault-settings-style')) return;
        const style = document.createElement('style');
        style.id = 'tools-vault-settings-style';
        // 深色主题下 --nsw-* 有值，浅色主题用后面的默认色
        style.textContent = `
.nvt{display:flex;flex-direction:column;gap:14px;padding-bottom:60px;color:var(--nsw-ink,#0f172a)}
.nvt-card{border:1px solid var(--nsw-line,#e2e8f0);border-radius:12px;background:var(--nsw-side,#fff);padding:14px 16px;min-width:0}
.nvt-card h4{margin:0 0 4px;font-size:14px;font-weight:850;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.nvt-desc{margin:0;color:var(--nsw-ink3,#64748b);font-size:12px;line-height:1.7}
.nvt-points{margin:8px 0 0;padding-left:18px;color:var(--nsw-ink3,#64748b);font-size:12px;line-height:1.7;list-style:disc outside}
.nvt-notice{padding:8px 12px;border-radius:8px;font-size:12px}
.nvt-notice.is-ok{background:#ecfdf5;color:#047857}.nvt-notice.is-error{background:#fef2f2;color:#b91c1c}
.nvt-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px}
.nvt-toolbar input{flex:1 1 180px;min-width:0}
.nvt input[type=text],.nvt input[type=password],.nvt input[type=url],.nvt input[type=search]{border:1px solid var(--nsw-line,#cbd5e1);border-radius:8px;padding:6px 10px;font-size:13px;background:var(--nsw-bg,#fff);color:var(--nsw-ink,#0f172a);min-width:0;font-family:inherit}
.nvt-btn{height:28px;padding:0 10px;border:1px solid var(--nsw-line,#cbd5e1);border-radius:8px;background:var(--nsw-bg,#fff);color:var(--nsw-ink,#0f172a);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.nvt-btn:hover{border-color:#94a3b8}.nvt-btn.is-primary{background:#0f766e;border-color:#0f766e;color:#fff}.nvt-btn.is-danger{color:#dc2626}
.nvt-btn:disabled{opacity:.55;cursor:not-allowed}
.nvt-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;padding:11px 0;border-top:1px solid var(--nsw-line,#f1f5f9)}
.nvt-row:first-of-type{border-top:0}
.nvt-site{font-weight:800;font-size:13px;overflow-wrap:anywhere}
.nvt-meta{color:var(--nsw-ink3,#64748b);font-size:12px;overflow-wrap:anywhere;margin-top:2px;line-height:1.6}
.nvt-meta b{color:var(--nsw-ink,#0f172a);font-weight:700}
.nvt-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:flex-start;justify-content:flex-end}
.nvt-switches{grid-column:1/-1;display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--nsw-ink3,#475569)}
.nvt-switches label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
.nvt-inline{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px;border-radius:10px;background:var(--nsw-bg,#f8fafc);font-size:12px}
.nvt-inline input{flex:1 1 200px}
.nvt-secret{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;overflow-wrap:anywhere;user-select:all}
.nvt-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px 14px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--nsw-line,#cbd5e1)}
.nvt-field{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}
.nvt-field>span{color:var(--nsw-ink3,#475569);font-weight:700}
.nvt-field small{color:var(--nsw-ink3,#94a3b8);line-height:1.5}
.nvt-wide{grid-column:1/-1}
.nvt-empty{padding:18px 0 6px;color:var(--nsw-ink3,#64748b);font-size:13px;line-height:1.7}
.nvt-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 4px 2px 10px;border-radius:999px;background:var(--nsw-bg,#f1f5f9);font-size:12px;margin:6px 6px 0 0}
.nvt-chip span{overflow-wrap:anywhere}
.nvt-chip button{border:0;background:transparent;cursor:pointer;color:inherit;font-size:14px;line-height:1;padding:2px 6px}
@media (max-width:640px){.nvt-row{grid-template-columns:minmax(0,1fr)}.nvt-actions{justify-content:flex-start}}
`;
        document.head.appendChild(style);
    }

    const when = at => at ? new Date(at).toLocaleString(L('zh-CN', 'en-US'), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : L('从未使用', 'Never used');

    function matches(entry) {
        const query = view.query.trim().toLowerCase();
        if (!query) return true;
        const text = `${entry.origin} ${entry.username} ${entry.label}`;
        return text.toLowerCase().includes(query) || Boolean(window.ToolsPinyinSearch?.pinyinMatches(text, query));
    }

    function formHtml() {
        const editing = view.editing;
        if (!editing) return '';
        const isNew = !editing.id;
        return `<form class="nvt-form" data-vault-form autocomplete="off">
            <label class="nvt-field nvt-wide"><span>${L('网址', 'Site address')}</span>
                <input type="url" name="url" value="${esc(editing.url || '')}" placeholder="https://example.com/login" ${isNew ? '' : 'disabled'} required>
                <small>${L('按「协议 + 域名 + 端口」精确匹配，只会在这个站点上填写。', 'Matched by exact scheme, host and port; filled on this site only.')}</small></label>
            <label class="nvt-field"><span>${L('用户名', 'Username')}</span><input type="text" name="username" value="${esc(editing.username || '')}" autocomplete="off" required></label>
            <label class="nvt-field"><span>${L('密码', 'Password')}</span><input type="password" name="password" autocomplete="new-password" placeholder="${isNew ? '' : esc(L('留空表示不修改', 'Leave blank to keep'))}" ${isNew ? 'required' : ''}></label>
            <label class="nvt-field nvt-wide"><span>${L('备注（可选）', 'Note (optional)')}</span><input type="text" name="label" maxlength="120" value="${esc(editing.label || '')}"></label>
            <div class="nvt-wide nvt-actions" style="justify-content:flex-start">
                <button type="submit" class="nvt-btn is-primary" ${view.busy ? 'disabled' : ''}>${L('保存', 'Save')}</button>
                <button type="button" class="nvt-btn" data-vault="cancel-edit">${L('取消', 'Cancel')}</button>
            </div>
        </form>`;
    }

    function rowHtml(entry) {
        const revealing = view.reveal === entry.id, shown = view.revealed?.id === entry.id;
        return `<div class="nvt-row" data-id="${esc(entry.id)}">
            <div>
                <div class="nvt-site">${esc(entry.host)}</div>
                <div class="nvt-meta"><b>${esc(entry.username)}</b>${entry.label ? ` · ${esc(entry.label)}` : ''}<br>${esc(entry.origin)} · ${L('上次使用', 'Last used')} ${esc(when(entry.lastUsedAt))}${entry.useCount ? ` · ${entry.useCount} ${L('次', 'uses')}` : ''}</div>
            </div>
            <div class="nvt-actions">
                <button type="button" class="nvt-btn" data-vault="reveal">${shown ? L('隐藏密码', 'Hide') : L('查看密码', 'Show password')}</button>
                <button type="button" class="nvt-btn" data-vault="edit">${L('编辑', 'Edit')}</button>
                <button type="button" class="nvt-btn is-danger" data-vault="remove">${L('删除', 'Delete')}</button>
            </div>
            <div class="nvt-switches">
                <label><input type="checkbox" data-vault-toggle="autoFill" ${entry.autoFill ? 'checked' : ''}>${L('打开登录页时自动填写', 'Fill automatically on the sign-in page')}</label>
                <label><input type="checkbox" data-vault-toggle="autoSubmit" ${entry.autoSubmit ? 'checked' : ''} ${entry.autoFill ? '' : 'disabled'}>${L('填写后自动点登录', 'Sign in automatically after filling')}</label>
            </div>
            ${revealing ? `<form class="nvt-inline" data-vault-reveal autocomplete="off">
                <span>${L('输入平台登录密码以查看：', 'Enter your platform password to view:')}</span>
                <input type="password" name="accountPassword" autocomplete="current-password" required>
                <button type="submit" class="nvt-btn is-primary">${L('确认', 'Confirm')}</button>
                <button type="button" class="nvt-btn" data-vault="cancel-reveal">${L('取消', 'Cancel')}</button>
            </form>` : ''}
            ${shown ? `<div class="nvt-inline"><span class="nvt-secret">${esc(view.revealed.password)}</span>
                <button type="button" class="nvt-btn" data-vault="copy">${L('复制', 'Copy')}</button>
                <span>${L('30 秒后自动隐藏', 'Hidden again in 30 seconds')}</span></div>` : ''}
        </div>`;
    }

    function render() {
        const content = view.content;
        if (!content || !content.isConnected) return;
        const shownEntries = view.entries.filter(matches);
        const list = view.loadError ? `<div class="nvt-notice is-error">${esc(view.loadError)}</div>`
            : !view.entries.length ? `<div class="nvt-empty">${L('保险箱还是空的。在 Dragon 浏览器里登录任意网站，账号密码会自动存进来；也可以点「添加账号」手动录入。', 'Your vault is empty. Sign in to any site in the Dragon browser and the login is saved here, or add one manually.')}</div>`
            : !shownEntries.length ? `<div class="nvt-empty">${L('没有匹配的账号', 'No matching logins')}</div>`
            : shownEntries.map(rowHtml).join('');
        content.innerHTML = `<div class="nvt">
            ${view.notice ? `<div class="nvt-notice ${view.notice.ok ? 'is-ok' : 'is-error'}">${esc(view.notice.text)}</div>` : ''}
            <div class="nvt-card">
                <h4>🔐 ${L('我的保险箱', 'My vault')}</h4>
                <p class="nvt-desc">${L('保存你在 Dragon 浏览器里登录网站用的账号密码。之后无论是你手动打开、点击工具里的「Dragon 浏览器」按钮，还是 AI 帮你操作，遇到登录页都会自动填写并登录。', 'Logins you use in the Dragon browser. Whether you open a site yourself, from a tool, or the AI does it for you, sign-in pages are filled and submitted automatically.')}</p>
                <ul class="nvt-points">
                    <li>${L('只有你自己能看到和使用，管理员也看不到别人的保险箱。', 'Only you can see and use it. Administrators cannot open anyone else\'s vault.')}</li>
                    <li>${L('AI 只能请浏览器「用保险箱登录」，密码由浏览器直接填进网页，不会发给模型，也不会出现在对话里。', 'The AI can only ask the browser to sign in from the vault. Passwords go straight into the page — never to the model or the chat.')}</li>
                    <li>${L('密码加密保存，只在保存时的那个站点上填写；查看明文需要再输入一次平台登录密码。', 'Passwords are encrypted and only filled on the exact site they were saved for. Viewing one requires your platform password.')}</li>
                </ul>
                <div class="nvt-toolbar">
                    <input type="search" data-vault-search placeholder="${esc(L('搜索站点、用户名或备注', 'Search site, username or note'))}" value="${esc(view.query)}">
                    <button type="button" class="nvt-btn is-primary" data-vault="add">${L('添加账号', 'Add login')}</button>
                </div>
                ${formHtml()}
            </div>
            <div class="nvt-card">
                <h4>${L('已保存的账号', 'Saved logins')} <span style="font-weight:500;color:var(--nsw-ink3,#64748b);font-size:12px">${view.entries.length}</span></h4>
                ${list}
            </div>
            ${view.neverSave.length ? `<div class="nvt-card">
                <h4>${L('不保存密码的站点', 'Sites that never save')}</h4>
                <p class="nvt-desc">${L('在这些站点登录时不会保存密码。移除后恢复自动保存。', 'Logins on these sites are not saved. Remove one to save again.')}</p>
                ${view.neverSave.map(origin => `<span class="nvt-chip"><span>${esc(origin)}</span><button type="button" data-vault-allow="${esc(origin)}" aria-label="${esc(L('移除', 'Remove'))}">×</button></span>`).join('')}
            </div>` : ''}
        </div>`;
    }

    function hideRevealed() { clearTimeout(revealTimer); view.revealed = null; view.reveal = null; }
    async function load() {
        try {
            const data = await api('GET', '/');
            view.entries = data.entries || []; view.neverSave = data.neverSave || []; view.loadError = '';
        } catch (error) { view.entries = []; view.neverSave = []; view.loadError = error.message; }
    }
    async function act(text, action) {
        if (view.busy) return;
        view.busy = true;
        try { await action(); await load(); view.notice = text ? { ok: true, text } : null; }
        catch (error) { view.notice = { ok: false, text: error.message }; }
        finally { view.busy = false; render(); }
    }

    function onClick(event) {
        const allow = event.target.closest('[data-vault-allow]');
        if (allow) return act(L('已恢复自动保存', 'Saving re-enabled'), () => api('POST', '/sites/never-save', { origin: allow.dataset.vaultAllow, never: false }));
        const button = event.target.closest('[data-vault]');
        if (!button) return;
        const name = button.dataset.vault, id = button.closest('[data-id]')?.dataset.id, entry = view.entries.find(item => item.id === id);
        if (name === 'add') { view.editing = { url: '', username: '', label: '' }; view.notice = null; return render(); }
        if (name === 'cancel-edit') { view.editing = null; return render(); }
        if (name === 'cancel-reveal') { hideRevealed(); return render(); }
        if (!entry) return;
        if (name === 'edit') { view.editing = { id: entry.id, url: entry.origin, username: entry.username, label: entry.label }; view.notice = null; render(); view.content.querySelector('[data-vault-form]')?.scrollIntoView({ block: 'nearest' }); return; }
        if (name === 'reveal') {
            if (view.revealed?.id === entry.id) hideRevealed(); else { hideRevealed(); view.reveal = entry.id; }
            render(); view.content.querySelector('[data-vault-reveal] input')?.focus(); return;
        }
        if (name === 'copy' && view.revealed) {
            navigator.clipboard?.writeText(view.revealed.password).then(() => { view.notice = { ok: true, text: L('已复制', 'Copied') }; render(); }).catch(() => {});
            return;
        }
        if (name === 'remove') {
            if (!confirm(L(`删除 ${entry.host} 的账号「${entry.username}」？删除后无法恢复。`, `Delete "${entry.username}" for ${entry.host}? This cannot be undone.`))) return;
            if (view.revealed?.id === entry.id) hideRevealed();
            return act(L('已删除', 'Deleted'), () => api('DELETE', `/${encodeURIComponent(entry.id)}`));
        }
    }
    function onChange(event) {
        const toggle = event.target.closest('[data-vault-toggle]'), id = toggle?.closest('[data-id]')?.dataset.id;
        if (toggle && id) act('', () => api('PUT', `/${encodeURIComponent(id)}`, { [toggle.dataset.vaultToggle]: toggle.checked }));
    }
    function onInput(event) {
        if (!event.target.matches('[data-vault-search]')) return;
        view.query = event.target.value;
        // 拼音匹配词库较大，第一次搜索时才加载
        if (!window.ToolsPinyinSearch && typeof window.loadNavLazyScript === 'function') window.loadNavLazyScript('/js/shared/pinyin-search.js', '').then(refreshList).catch(() => {});
        refreshList();
    }
    // 搜索时只重画列表，不打断输入框
    function refreshList() {
        const position = view.content?.querySelector('[data-vault-search]')?.selectionStart;
        render();
        const input = view.content?.querySelector('[data-vault-search]');
        if (input && view.query) { input.focus(); try { input.setSelectionRange(position, position); } catch (_error) { /* 部分输入类型不支持 */ } }
    }
    function onSubmit(event) {
        const form = event.target;
        if (form.matches('[data-vault-form]')) {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(form)), editing = view.editing || {};
            return act(L('已保存', 'Saved'), async () => {
                if (editing.id) await api('PUT', `/${encodeURIComponent(editing.id)}`, { username: data.username, password: data.password || '', label: data.label || '' });
                else await api('POST', '/', { url: data.url, username: data.username, password: data.password, label: data.label || '' });
                view.editing = null;
            });
        }
        if (form.matches('[data-vault-reveal]')) {
            event.preventDefault();
            const id = form.closest('[data-id]')?.dataset.id, accountPassword = new FormData(form).get('accountPassword');
            api('POST', `/${encodeURIComponent(id)}/reveal`, { accountPassword }).then(data => {
                view.revealed = { id, password: data.password }; view.reveal = null; view.notice = null;
                clearTimeout(revealTimer); revealTimer = setTimeout(() => { hideRevealed(); render(); }, 30000);
            }).catch(error => { view.notice = { ok: false, text: error.message }; }).finally(render);
        }
    }

    async function renderInto(content) {
        ensureStyle();
        if (view.content !== content) {
            view.content = content;
            content.addEventListener('click', onClick);
            content.addEventListener('change', onChange);
            content.addEventListener('input', onInput);
            content.addEventListener('submit', onSubmit);
        }
        hideRevealed(); view.editing = null; view.notice = null; view.query = '';
        await load();
        render();
    }

    window.ToolsVaultSettings = { render: renderInto };
})();
