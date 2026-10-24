// 频道对接前端公共能力：任何页面都可以引入本文件调用 WeLink 推送、选择推送对象。
//
//   <script src="/js/shared/channels.js"></script>
//   const targets = await ToolsChannels.pickTargets({ title: '选择推送对象', pushableOnly: true });
//   if (targets) await ToolsChannels.push({ text: '**月报已发布**', targets, source: '月报' });
//
// targets 省略时推送到管理员配置的默认推送范围。普通用户需管理员开启「允许普通用户推送」。
// 各方法可传 channel: 'welink'（默认）| 'weixin' 指定频道。
(function () {
    'use strict';
    if (window.ToolsChannels) return;

    const BASE = '/api/channels';
    const CHANNELS = ['welink', 'weixin'];
    const L = (zh, en) => (window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh);

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function authHeaders(json = true) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    }

    async function request(method, path, body, channel = 'welink') {
        const res = await fetch(`${BASE}/${CHANNELS.includes(channel) ? channel : 'welink'}${path}`, { method, headers: authHeaders(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined });
        let data = {};
        try { data = await res.json(); } catch (_) { data = {}; }
        if (!res.ok) {
            const error = new Error(data.error || `HTTP ${res.status}`);
            error.status = res.status;
            error.code = data.code;
            throw error;
        }
        return data;
    }

    function relativeTime(iso) {
        if (!iso) return '';
        const diff = Date.now() - new Date(iso).getTime();
        const min = Math.round(diff / 60000);
        if (min < 1) return L('刚刚', 'just now');
        if (min < 60) return L(`${min} 分钟前`, `${min} min ago`);
        const hours = Math.round(min / 60);
        if (hours < 24) return L(`${hours} 小时前`, `${hours} h ago`);
        const days = Math.round(hours / 24);
        if (days < 30) return L(`${days} 天前`, `${days} d ago`);
        return new Date(iso).toLocaleDateString();
    }

    function targetKey(item) {
        return `${item.kind}:${item.id}`;
    }

    function ensureStyle() {
        if (document.getElementById('tools-channels-style')) return;
        const style = document.createElement('style');
        style.id = 'tools-channels-style';
        style.textContent = `
.tch-overlay{position:fixed;inset:0;z-index:100050;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.tch-picker{width:min(720px,100%);max-height:min(82vh,760px);display:flex;flex-direction:column;background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.28);overflow:hidden;font-size:13px}
.tch-picker header{padding:14px 16px 10px;border-bottom:1px solid #e2e8f0}
.tch-picker header h3{margin:0;font-size:16px;font-weight:800}
.tch-picker header p{margin:4px 0 0;color:#64748b;font-size:12px}
.tch-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;border-bottom:1px solid #f1f5f9}
.tch-toolbar input[type=search]{flex:1 1 200px;min-width:0;height:32px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:13px;background:#fff;color:inherit}
.tch-seg{display:inline-flex;border:1px solid #cbd5e1;border-radius:8px;overflow:hidden}
.tch-seg button{border:0;background:#f8fafc;color:#334155;padding:0 10px;height:30px;font-size:12px;font-weight:700;cursor:pointer}
.tch-seg button.active{background:#2563eb;color:#fff}
.tch-check{display:inline-flex;align-items:center;gap:5px;color:#475569;font-size:12px;white-space:nowrap}
.tch-bulk{display:flex;gap:6px;align-items:center;padding:8px 16px;color:#64748b;font-size:12px}
.tch-bulk button,.tch-btn{height:28px;padding:0 10px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-size:12px;font-weight:700;cursor:pointer}
.tch-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.tch-btn:disabled{opacity:.5;cursor:not-allowed}
.tch-bulk .tch-count{margin-left:auto;font-weight:700;color:#1e293b}
.tch-list{flex:1;overflow:auto;padding:4px 8px 8px;min-height:160px}
.tch-row{display:grid;grid-template-columns:22px 22px minmax(0,1fr) auto;gap:8px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer}
.tch-row:hover{background:#f1f5f9}
.tch-row.selected{background:#eff6ff}
.tch-row .tch-name{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tch-row .tch-sub{color:#94a3b8;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tch-row .tch-meta{display:flex;flex-direction:column;align-items:flex-end;gap:2px;color:#64748b;font-size:11px;white-space:nowrap}
.tch-badge{display:inline-block;padding:1px 6px;border-radius:999px;font-size:10px;font-weight:800;background:#dcfce7;color:#166534}
.tch-badge.off{background:#f1f5f9;color:#64748b}
.tch-empty{padding:28px 12px;text-align:center;color:#94a3b8}
.tch-picker footer{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 16px;border-top:1px solid #e2e8f0;background:#f8fafc}
.tch-manual{display:flex;gap:6px;flex:1 1 280px;min-width:0}
.tch-manual select,.tch-manual input{height:30px;border:1px solid #cbd5e1;border-radius:7px;padding:0 8px;font-size:12px;background:#fff;color:inherit;min-width:0}
.tch-manual input{flex:1}
.tch-actions{display:flex;gap:8px;margin-left:auto}
[data-theme=dark] .tch-picker{background:#0f172a;color:#e2e8f0}
[data-theme=dark] .tch-picker header,[data-theme=dark] .tch-picker footer,[data-theme=dark] .tch-toolbar{border-color:#1e293b}
[data-theme=dark] .tch-picker footer{background:#111827}
[data-theme=dark] .tch-row:hover{background:#1e293b}
[data-theme=dark] .tch-row.selected{background:#172554}
[data-theme=dark] .tch-toolbar input[type=search],[data-theme=dark] .tch-manual select,[data-theme=dark] .tch-manual input{background:#020617;border-color:#334155}
[data-theme=dark] .tch-seg button,[data-theme=dark] .tch-bulk button,[data-theme=dark] .tch-btn{background:#1e293b;border-color:#334155;color:#e2e8f0}
[data-theme=dark] .tch-seg button.active,[data-theme=dark] .tch-btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
@media (max-width:560px){.tch-row{grid-template-columns:22px 22px minmax(0,1fr)}.tch-row .tch-meta{display:none}.tch-actions{width:100%;justify-content:flex-end}}
`;
        document.head.appendChild(style);
    }

    /**
     * 打开目标选择器：从历史出现过的人员/群组中多选（按最近活跃由近及远），支持关键字过滤、类型筛选、全选/反选/清空、手动添加。
     * @param {object} [options]
     * @param {string} [options.title]
     * @param {string} [options.description]
     * @param {'all'|'user'|'group'} [options.kind='all'] 初始类型筛选
     * @param {boolean} [options.lockKind=false] 锁定类型（如人员名单只选人员）
     * @param {Array<{kind,id}>} [options.selected] 初始已选
     * @param {boolean} [options.pushableOnly=false] 初始只显示可推送目标
     * @param {boolean} [options.allowManual=true] 允许手动输入账号/群 ID
     * @returns {Promise<Array<{kind,id,name}>|null>} 取消返回 null
     */
    async function pickTargets(options = {}) {
        ensureStyle();
        const state = {
            kind: options.kind || 'all',
            q: '',
            pushableOnly: options.pushableOnly === true,
            items: [],
            loading: true,
            error: '',
            selected: new Map((options.selected || []).map(item => [targetKey(item), { kind: item.kind, id: item.id, name: item.name || item.id }]))
        };
        const overlay = document.createElement('div');
        overlay.className = 'tch-overlay';
        overlay.innerHTML = `
            <div class="tch-picker" role="dialog" aria-modal="true">
                <header><h3>${escapeHtml(options.title || L('选择人员 / 群组', 'Choose people / groups'))}</h3>
                    <p>${escapeHtml(options.description || L('来自与助理互动过的历史记录，按最近使用由近及远排序。', 'From people and groups that have used the assistant, most recent first.'))}</p></header>
                <div class="tch-toolbar">
                    <input type="search" data-role="q" placeholder="${escapeHtml(L('搜索账号、名称或备注', 'Search account, name or alias'))}">
                    ${options.lockKind ? '' : `<div class="tch-seg" data-role="kind">
                        <button type="button" data-kind="all">${escapeHtml(L('全部', 'All'))}</button>
                        <button type="button" data-kind="user">👤 ${escapeHtml(L('人员', 'People'))}</button>
                        <button type="button" data-kind="group">👥 ${escapeHtml(L('群组', 'Groups'))}</button></div>`}
                    <label class="tch-check"><input type="checkbox" data-role="pushable" ${state.pushableOnly ? 'checked' : ''}> ${escapeHtml(L('仅可推送', 'Pushable only'))}</label>
                </div>
                <div class="tch-bulk">
                    <button type="button" data-bulk="all">${escapeHtml(L('全选', 'Select all'))}</button>
                    <button type="button" data-bulk="invert">${escapeHtml(L('反选', 'Invert'))}</button>
                    <button type="button" data-bulk="clear">${escapeHtml(L('清空', 'Clear'))}</button>
                    <span class="tch-count" data-role="count"></span>
                </div>
                <div class="tch-list" data-role="list"><div class="tch-empty">${escapeHtml(L('加载中…', 'Loading…'))}</div></div>
                <footer>
                    ${options.allowManual === false ? '' : `<div class="tch-manual">
                        <select data-role="manual-kind" ${options.lockKind ? 'disabled' : ''}>
                            <option value="user">${escapeHtml(L('人员账号', 'Account'))}</option>
                            <option value="group">${escapeHtml(L('群组 ID', 'Group ID'))}</option></select>
                        <input data-role="manual-id" maxlength="200" placeholder="${escapeHtml(L('手动添加（回车）', 'Add manually (Enter)'))}">
                        <button type="button" class="tch-btn" data-role="manual-add">${escapeHtml(L('添加', 'Add'))}</button></div>`}
                    <div class="tch-actions">
                        <button type="button" class="tch-btn" data-role="cancel">${escapeHtml(L('取消', 'Cancel'))}</button>
                        <button type="button" class="tch-btn primary" data-role="ok">${escapeHtml(L('确定', 'OK'))}</button>
                    </div>
                </footer>
            </div>`;
        document.body.appendChild(overlay);
        const $ = selector => overlay.querySelector(selector);
        const manualKind = $('[data-role="manual-kind"]');
        if (manualKind && options.kind && options.kind !== 'all') manualKind.value = options.kind;

        const visibleItems = () => {
            const keyword = state.q.trim().toLowerCase();
            const known = new Set(state.items.map(targetKey));
            // 已选但历史里没有的（手动添加）也列出，便于取消
            const extras = [...state.selected.values()].filter(item => !known.has(targetKey(item))).map(item => ({ ...item, manual: true, canPush: false }));
            return [...extras, ...state.items].filter(item => {
                if (state.kind !== 'all' && item.kind !== state.kind) return false;
                if (state.pushableOnly && !item.canPush && !item.manual) return false;
                if (!keyword) return true;
                return [item.id, item.name, item.alias, item.displayName].some(value => String(value || '').toLowerCase().includes(keyword));
            });
        };

        const render = () => {
            overlay.querySelectorAll('[data-kind]').forEach(button => button.classList.toggle('active', button.dataset.kind === state.kind));
            const list = $('[data-role="list"]');
            const items = visibleItems();
            $('[data-role="count"]').textContent = L(`已选 ${state.selected.size} · 显示 ${items.length}`, `${state.selected.size} selected · ${items.length} shown`);
            if (state.loading) return;
            if (state.error) { list.innerHTML = `<div class="tch-empty">${escapeHtml(state.error)}</div>`; return; }
            if (!items.length) { list.innerHTML = `<div class="tch-empty">${escapeHtml(L('没有匹配的记录。人员或群组与助理互动后会出现在这里，也可以手动添加。', 'No matches. People and groups appear here after using the assistant; you can also add them manually.'))}</div>`; return; }
            list.innerHTML = items.map(item => {
                const key = targetKey(item);
                const checked = state.selected.has(key);
                const pushBadge = item.manual
                    ? `<span class="tch-badge off">${escapeHtml(L('手动添加', 'Manual'))}</span>`
                    : (item.canPush ? `<span class="tch-badge">${escapeHtml(L('可推送', 'Pushable'))}</span>` : `<span class="tch-badge off">${escapeHtml(item.kind === 'user' ? L('未单聊', 'No DM') : L('无会话', 'No session'))}</span>`);
                return `<label class="tch-row ${checked ? 'selected' : ''}" data-key="${escapeHtml(key)}">
                    <input type="checkbox" ${checked ? 'checked' : ''}>
                    <span aria-hidden="true">${item.kind === 'group' ? '👥' : '👤'}</span>
                    <span style="min-width:0"><div class="tch-name">${escapeHtml(item.name || item.id)}</div><div class="tch-sub">${escapeHtml(item.id)}${item.messageCount ? ` · ${escapeHtml(L(`${item.messageCount} 条消息`, `${item.messageCount} msgs`))}` : ''}</div></span>
                    <span class="tch-meta">${pushBadge}<span>${escapeHtml(relativeTime(item.lastActiveAt))}</span></span>
                </label>`;
            }).join('');
        };

        const byKey = key => visibleItems().find(item => targetKey(item) === key);
        const toggle = (item, on) => {
            const key = targetKey(item);
            if (on) state.selected.set(key, { kind: item.kind, id: item.id, name: item.name || item.id });
            else state.selected.delete(key);
        };

        return new Promise(resolve => {
            const close = result => {
                document.removeEventListener('keydown', onKey, true);
                overlay.remove();
                resolve(result);
            };
            const onKey = event => { if (event.key === 'Escape') { event.stopPropagation(); close(null); } };
            document.addEventListener('keydown', onKey, true);
            overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
            $('[data-role="q"]').addEventListener('input', event => { state.q = event.target.value; render(); });
            $('[data-role="pushable"]').addEventListener('change', event => { state.pushableOnly = event.target.checked; render(); });
            overlay.querySelectorAll('[data-kind]').forEach(button => button.addEventListener('click', () => { state.kind = button.dataset.kind; render(); }));
            $('[data-role="list"]').addEventListener('change', event => {
                const row = event.target.closest('[data-key]');
                const item = row && byKey(row.dataset.key);
                if (item) { toggle(item, event.target.checked); render(); }
            });
            overlay.querySelectorAll('[data-bulk]').forEach(button => button.addEventListener('click', () => {
                const items = visibleItems();
                if (button.dataset.bulk === 'all') items.forEach(item => toggle(item, true));
                if (button.dataset.bulk === 'invert') items.forEach(item => toggle(item, !state.selected.has(targetKey(item))));
                if (button.dataset.bulk === 'clear') state.selected.clear();
                render();
            }));
            const addManual = () => {
                const input = $('[data-role="manual-id"]');
                const id = input.value.trim();
                if (!id) return;
                const kind = options.lockKind && options.kind !== 'all' ? options.kind : manualKind.value;
                toggle({ kind, id, name: id }, true);
                input.value = '';
                render();
            };
            $('[data-role="manual-add"]')?.addEventListener('click', addManual);
            $('[data-role="manual-id"]')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addManual(); } });
            $('[data-role="cancel"]').addEventListener('click', () => close(null));
            $('[data-role="ok"]').addEventListener('click', () => close([...state.selected.values()]));
            render();
            $('[data-role="q"]').focus();
            const kindQuery = options.lockKind && options.kind && options.kind !== 'all' ? `&kind=${encodeURIComponent(options.kind)}` : '';
            request('GET', `/targets?limit=2000${kindQuery}`, undefined, options.channel).then(data => {
                state.items = Array.isArray(data.items) ? data.items : [];
            }).catch(error => {
                state.error = error.message;
            }).finally(() => {
                state.loading = false;
                render();
            });
        });
    }

    window.ToolsChannels = {
        /** 推送消息；targets 省略时使用默认推送范围。返回 { ok, sent, failed, results } */
        push: ({ text, targets, source, trigger, channel } = {}) => request('POST', '/push', { text, targets, source: source || document.title, trigger }, channel),
        /** 频道状态：{ connected, enabled, sdk, runtime, summary, ... } */
        status: ({ channel } = {}) => request('GET', '/status', undefined, channel),
        /** 历史人员/群组（按最近活跃由近及远） */
        listTargets: ({ kind, q, pushableOnly, limit, channel } = {}) => {
            const params = new URLSearchParams();
            if (kind) params.set('kind', kind);
            if (q) params.set('q', q);
            if (pushableOnly) params.set('pushable', '1');
            if (limit) params.set('limit', String(limit));
            return request('GET', `/targets?${params}`, undefined, channel).then(data => data.items || []);
        },
        pickTargets,
        request,
        escapeHtml,
        relativeTime
    };
})();
