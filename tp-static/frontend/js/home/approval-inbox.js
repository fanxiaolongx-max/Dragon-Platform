// 「需要你」收件箱：侧栏入口 + 角标；面板里列出所有对话中等审批的操作（可直接批准 / 拒绝 / 打开对话），
// 以及「推送到频道」设置：超过设定时间没处理时，发到已连接的 WeLink / 微信里的指定群组或个人，回复「批准 1234」即可放行。
// 后端：/api/agent-workspace/inbox*（agent-approval-inbox.js）。没有审批权限的账号接口返回 403，入口保持隐藏。
(function () {
    'use strict';
    if (window.ApprovalInbox) return;
    const API = '/api/agent-workspace';
    const POLL_MS = 8000;
    const en = () => window.ToolsI18n?.getLanguage?.() === 'en-US';
    const L = (zh, english) => (en() ? english : zh);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const toast = message => (window.showToast ? window.showToast(message) : console.info(message));

    const state = { items: [], available: false, open: false, settings: null, channels: [], delays: [], lastPush: null, canConfigure: false, draft: null, busy: false, seen: new Set(), timer: 0 };

    function headers(json) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    }
    async function api(method, path, body) {
        const res = await fetch(`${API}${path}`, { method, headers: headers(body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) });
        let data = {};
        try { data = await res.json(); } catch (_) { data = {}; }
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code });
        return data;
    }

    // ── 样式 ──
    function ensureStyle() {
        if (document.getElementById('approvalInboxStyle')) return;
        const style = document.createElement('style');
        style.id = 'approvalInboxStyle';
        style.textContent = `
.v2-nav-count.ai-alert{background:var(--v2-danger,#ef4444);color:#fff;font-weight:600;animation:aiPulse 2s ease-in-out infinite}
@keyframes aiPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.45)}50%{box-shadow:0 0 0 5px rgba(239,68,68,0)}}
.ai-overlay{position:fixed;inset:0;z-index:2400;background:rgba(15,17,21,.32);display:flex;justify-content:flex-end;opacity:0;transition:opacity .18s ease}
.ai-overlay.show{opacity:1}
.ai-panel{width:min(440px,100vw);height:100%;background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);border-left:1px solid var(--v2-line,#e7e7ea);display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.12);transform:translateX(24px);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.ai-overlay.show .ai-panel{transform:none}
.ai-head{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--v2-line,#e7e7ea)}
.ai-head h3{margin:0;font-size:16px;flex:1}
.ai-head small{color:var(--v2-ink3,#8a9099);font-weight:400;margin-left:6px}
.ai-x{border:0;background:transparent;color:var(--v2-ink3,#8a9099);font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:8px}
.ai-x:hover{background:var(--v2-chip,#f2f2f4)}
.ai-body{flex:1;overflow:auto;padding:12px 14px 18px}
.ai-empty{padding:34px 12px;text-align:center;color:var(--v2-ink3,#8a9099);font-size:13px;line-height:1.7}
.ai-empty b{display:block;font-size:28px;margin-bottom:6px}
.ai-card{border:1px solid var(--v2-line,#e7e7ea);border-radius:12px;padding:12px;margin-bottom:10px;background:var(--v2-bg,#fff);animation:aiIn .2s ease}
@keyframes aiIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.ai-card-top{display:flex;align-items:center;gap:8px;font-size:13px}
.ai-card-top strong{font-size:14px}
.ai-code{margin-left:auto;font:600 12px ui-monospace,Menlo,monospace;color:var(--v2-ink2,#4b5563);background:var(--v2-chip,#f2f2f4);padding:2px 7px;border-radius:6px}
.ai-detail{margin:8px 0;font:12px/1.55 ui-monospace,Menlo,monospace;background:var(--v2-chip,#f2f2f4);border-radius:8px;padding:7px 9px;white-space:pre-wrap;word-break:break-all;max-height:110px;overflow:auto}
.ai-meta{display:flex;flex-wrap:wrap;gap:6px 10px;font-size:12px;color:var(--v2-ink3,#8a9099)}
.ai-meta .ok{color:var(--v2-accent,#10a37f)}
.ai-meta .bad{color:var(--v2-danger,#ef4444)}
.ai-actions{display:flex;gap:8px;margin-top:10px}
.ai-btn{border:1px solid var(--v2-line-strong,#d6d6db);background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;transition:background .15s,transform .1s}
.ai-btn:hover{background:var(--v2-chip,#f2f2f4)}
.ai-btn:active{transform:scale(.97)}
.ai-btn:disabled{opacity:.5;cursor:default}
.ai-btn.primary{background:var(--v2-accent,#10a37f);border-color:var(--v2-accent,#10a37f);color:#fff}
.ai-btn.primary:hover{filter:brightness(1.05)}
.ai-btn.danger{color:var(--v2-danger,#ef4444)}
.ai-btn.link{border-color:transparent;margin-left:auto;color:var(--v2-ink2,#4b5563)}
.ai-section{border-top:1px solid var(--v2-line,#e7e7ea);padding:14px 16px 18px;background:var(--v2-side,var(--v2-bg,#fff))}
.ai-section h4{margin:0 0 4px;font-size:14px;display:flex;align-items:center;gap:8px}
.ai-section p.hint{margin:0 0 10px;font-size:12px;color:var(--v2-ink3,#8a9099);line-height:1.6}
.ai-row{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13px}
.ai-row>label{width:64px;flex:none;color:var(--v2-ink2,#4b5563)}
.ai-row select{flex:1;min-width:0;border:1px solid var(--v2-line-strong,#d6d6db);border-radius:8px;padding:6px 8px;background:var(--v2-bg,#fff);color:inherit;font-size:13px}
.ai-chips{flex:1;display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.ai-chip{display:inline-flex;align-items:center;gap:4px;background:var(--v2-chip,#f2f2f4);border-radius:999px;padding:2px 4px 2px 9px;font-size:12px;max-width:100%}
.ai-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-chip button{border:0;background:transparent;color:var(--v2-ink3,#8a9099);cursor:pointer;font-size:14px;line-height:1;padding:0 3px}
.ai-switch{position:relative;width:36px;height:20px;flex:none;margin-left:auto}
.ai-switch input{opacity:0;width:0;height:0}
.ai-switch i{position:absolute;inset:0;border-radius:999px;background:var(--v2-line-strong,#d6d6db);transition:background .18s;cursor:pointer}
.ai-switch i::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .18s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.ai-switch input:checked+i{background:var(--v2-accent,#10a37f)}
.ai-switch input:checked+i::after{transform:translateX(16px)}
.ai-status{font-size:12px;margin:6px 0 0;line-height:1.6}
.ai-status.bad{color:var(--v2-danger,#ef4444)}
.ai-status.ok{color:var(--v2-accent,#10a37f)}
.ai-foot{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}
@media (max-width:560px){.ai-panel{width:100vw}}
`;
        document.head.appendChild(style);
    }

    // ── 侧栏入口 ──
    function ensureNav() {
        let button = document.getElementById('v2InboxBtn');
        if (button) return button;
        const nav = document.querySelector('#homeSidebar .v2-nav');
        if (!nav) return null;
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'v2-nav-item';
        button.id = 'v2InboxBtn';
        button.hidden = true;
        button.innerHTML = `<span class="v2-ico" data-icon="bell"></span><span>${esc(L('需要你', 'Needs you'))}</span><span class="v2-nav-count" id="v2InboxCount" hidden></span>`;
        const anchor = nav.querySelector('[data-v2-action="opsDrafts"]') || nav.querySelector('[data-v2-flyout="more"]');
        nav.insertBefore(button, anchor);
        window.HomeShell?.renderIcons?.(button);
        if (!button.querySelector('.v2-ico svg')) {
            button.querySelector('.v2-ico').innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
        }
        button.addEventListener('click', () => open());
        return button;
    }

    function renderBadge() {
        const button = ensureNav();
        if (!button) return;
        button.hidden = !state.available;
        const count = document.getElementById('v2InboxCount');
        const total = state.items.length;
        count.hidden = !total;
        count.textContent = total > 99 ? '99+' : String(total);
        count.classList.toggle('ai-alert', total > 0);
        button.title = total ? L(`${total} 个操作等你审批`, `${total} approvals waiting`) : L('需要你处理的审批', 'Approvals waiting for you');
    }

    async function refresh() {
        try {
            const data = await api('GET', '/inbox');
            state.available = data.canApprove !== false;
            const fresh = (data.items || []).filter(item => !state.seen.has(item.id));
            state.items = data.items || [];
            fresh.forEach(item => state.seen.add(item.id));
            // 当前不在发起审批的那个对话时提示一下
            const current = window.DragonClaw?.currentSessionId?.();
            const elsewhere = fresh.filter(item => item.chatSessionId && item.chatSessionId !== current);
            if (elsewhere.length && !state.open) toast(L(`另一个对话里有 ${elsewhere.length} 个操作等你审批，点侧栏「需要你」处理`, `${elsewhere.length} approval(s) waiting in another chat`));
        } catch (error) {
            if (error.status === 401 || error.status === 403) { state.available = false; state.items = []; }
        }
        renderBadge();
        if (state.open) renderList();
    }

    function schedule() {
        clearTimeout(state.timer);
        state.timer = setTimeout(async () => {
            if (!document.hidden) await refresh();
            schedule();
        }, state.open ? 3000 : POLL_MS);
    }

    // ── 面板 ──
    let overlay = null;
    function relative(iso) {
        const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
        if (diff < 60) return L('刚刚', 'just now');
        if (diff < 3600) return L(`${Math.floor(diff / 60)} 分钟前`, `${Math.floor(diff / 60)}m ago`);
        return new Date(iso).toLocaleTimeString();
    }
    function remaining(iso) {
        const left = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
        return left >= 60 ? L(`剩 ${Math.ceil(left / 60)} 分钟`, `${Math.ceil(left / 60)}m left`) : L(`剩 ${left} 秒`, `${left}s left`);
    }
    function channelLabel(id) {
        return state.channels.find(item => item.channel === id)?.label || id;
    }

    function renderList() {
        const body = overlay?.querySelector('[data-ai="list"]');
        if (!body) return;
        overlay.querySelector('[data-ai="count"]').textContent = state.items.length ? L(`${state.items.length} 项`, `${state.items.length}`) : '';
        if (!state.items.length) {
            body.innerHTML = `<div class="ai-empty"><b>✓</b>${esc(L('没有等你处理的审批。', 'Nothing is waiting for you.'))}<br>${esc(L('任何对话里出现需要确认的操作，都会集中到这里。', 'Approvals from every chat show up here.'))}</div>`;
            return;
        }
        body.innerHTML = state.items.map(item => {
            const pushed = item.pushed
                ? `<span class="ok">${esc(L(`已推送到 ${channelLabel(item.pushed.channel)}`, `Sent to ${channelLabel(item.pushed.channel)}`))}${item.pushed.error ? ` · ${esc(item.pushed.error)}` : ''}</span>`
                : item.pushError ? `<span class="bad">${esc(L('推送失败：', 'Push failed: '))}${esc(item.pushError)}</span>` : '';
            return `<div class="ai-card" data-id="${esc(item.id)}">
                <div class="ai-card-top"><strong>${esc(item.label)}</strong><span class="ai-code" title="${esc(L('频道里回复「批准 码」', 'Reply "approve CODE" in the channel'))}">#${esc(item.code)}</span></div>
                ${item.detail ? `<div class="ai-detail">${esc(item.detail)}</div>` : ''}
                <div class="ai-meta"><span>${esc(item.title || L('未命名对话', 'Untitled chat'))}</span><span>${esc(relative(item.createdAt))}</span><span>${esc(remaining(item.expiresAt))}</span>${pushed}</div>
                <div class="ai-actions">
                    <button type="button" class="ai-btn primary" data-do="allow">${esc(L('批准', 'Approve'))}</button>
                    <button type="button" class="ai-btn danger" data-do="deny">${esc(L('拒绝', 'Deny'))}</button>
                    ${item.chatSessionId ? `<button type="button" class="ai-btn link" data-do="open">${esc(L('打开对话 →', 'Open chat →'))}</button>` : ''}
                </div></div>`;
        }).join('');
    }

    function renderSettings() {
        const box = overlay?.querySelector('[data-ai="settings"]');
        if (!box) return;
        if (!state.draft) { box.innerHTML = `<p class="hint">${esc(L('加载推送设置…', 'Loading…'))}</p>`; return; }
        const draft = state.draft;
        const current = state.channels.find(item => item.channel === draft.channel) || { ok: false, reason: '' };
        const anyOk = state.channels.some(item => item.ok);
        const disabled = !state.canConfigure ? 'disabled' : '';
        const last = state.lastPush;
        box.innerHTML = `
            <h4>${esc(L('推送到频道', 'Push to channel'))}
                <label class="ai-switch" title="${esc(L('启用推送', 'Enable'))}"><input type="checkbox" data-ai="enabled" ${draft.enabled ? 'checked' : ''} ${disabled || (!anyOk && !draft.enabled ? 'disabled' : '')}><i></i></label></h4>
            <p class="hint">${esc(anyOk
                ? L('审批超过设定时间没人处理，就发到下面选的群或人；在 WeLink 助理 / 微信里回复「批准 码」即可放行。', 'If an approval waits too long, notify the chosen people or groups. Reply "approve CODE" in the bot chat to approve.')
                : L('还没有可用的频道：请先在「全局设置 › 频道对接」接入 WeLink 助理、微信或 welink-cli，并确认连接正常。', 'No channel is connected. Set up WeLink, WeChat or welink-cli in Settings › Channels first.'))}</p>
            <div class="ai-row"><label>${esc(L('频道', 'Channel'))}</label>
                <select data-ai="channel" ${disabled}>${state.channels.map(item => `<option value="${esc(item.channel)}" ${item.channel === draft.channel ? 'selected' : ''}>${item.ok ? '🟢' : '⚪️'} ${esc(item.label)}${item.ok ? '' : L('（不可用）', ' (unavailable)')}</option>`).join('')}</select></div>
            ${current.ok ? (current.canReply ? '' : `<p class="ai-status">${esc(L('welink-cli 以你本人身份发送，收不到回复：只做提醒，需回到网页处理。', 'welink-cli only sends reminders; approve in the web app.'))}</p>`) : `<p class="ai-status bad">${esc(current.reason || L('频道不可用', 'Unavailable'))}</p>`}
            <div class="ai-row"><label>${esc(L('发给', 'Send to'))}</label>
                <div class="ai-chips">${draft.targets.map((item, index) => `<span class="ai-chip"><span>${item.kind === 'group' ? '👥' : '👤'} ${esc(item.name || item.id)}</span>${disabled ? '' : `<button type="button" data-remove="${index}" aria-label="remove">×</button>`}</span>`).join('') || `<span class="hint" style="font-size:12px;color:var(--v2-ink3)">${esc(L('未选择', 'None'))}</span>`}</div>
                <button type="button" class="ai-btn" data-ai="pick" ${disabled}>${esc(L('选择…', 'Choose…'))}</button></div>
            <div class="ai-row"><label>${esc(L('多久后', 'After'))}</label>
                <select data-ai="delay" ${disabled}>${state.delays.map(sec => `<option value="${sec}" ${sec === draft.delaySec ? 'selected' : ''}>${sec ? esc(L(`${sec >= 60 ? `${sec / 60} 分钟` : `${sec} 秒`}没处理再推送`, `after ${sec >= 60 ? `${sec / 60} min` : `${sec}s`} unanswered`)) : esc(L('立即推送', 'Immediately'))}</option>`).join('')}</select></div>
            ${last ? `<p class="ai-status ${last.ok ? 'ok' : 'bad'}">${esc(L('最近一次推送', 'Last push'))}：${esc(new Date(last.at).toLocaleString())} · ${last.ok ? esc(L('成功', 'sent')) : esc(last.error)}</p>` : ''}
            ${state.canConfigure ? `<div class="ai-foot">
                <button type="button" class="ai-btn" data-ai="test" ${current.ok && draft.targets.length ? '' : 'disabled'}>${esc(L('发送测试', 'Send test'))}</button>
                <button type="button" class="ai-btn primary" data-ai="save" ${state.busy ? 'disabled' : ''}>${esc(L('保存', 'Save'))}</button></div>` : ''}`;
    }

    async function loadSettings() {
        try {
            const data = await api('GET', '/inbox/settings');
            Object.assign(state, { settings: data.settings, channels: data.channels || [], delays: data.delays || [0, 30, 60, 120, 300], lastPush: data.lastPush, canConfigure: data.canConfigure !== false });
            state.draft = JSON.parse(JSON.stringify(data.settings));
        } catch (error) {
            state.draft = null;
            const box = overlay?.querySelector('[data-ai="settings"]');
            if (box) box.innerHTML = `<p class="ai-status bad">${esc(error.message)}</p>`;
            return;
        }
        renderSettings();
    }

    function loadChannelsScript() {
        if (window.ToolsChannels) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = './tp-static/frontend/js/shared/channels.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error(L('无法加载频道组件', 'Failed to load channel picker')));
            document.head.appendChild(script);
        });
    }

    async function decide(id, decision, button) {
        button.disabled = true;
        try {
            await api('POST', `/approvals/${encodeURIComponent(id)}`, { decision });
            state.items = state.items.filter(item => item.id !== id);
            renderList();
            renderBadge();
            toast(decision === 'allow' ? L('已批准，任务继续执行', 'Approved') : L('已拒绝', 'Denied'));
        } catch (error) {
            toast(error.message);
            button.disabled = false;
            refresh();
        }
    }

    async function onClick(event) {
        if (event.target === overlay || event.target.closest('[data-ai="close"]')) return close();
        const card = event.target.closest('.ai-card');
        const action = event.target.closest('[data-do]');
        if (card && action) {
            const item = state.items.find(entry => entry.id === card.dataset.id);
            if (!item) return;
            if (action.dataset.do === 'open') { close(); window.HomeMode?.set?.('chat'); window.DragonClaw?.openChat?.({ id: item.chatSessionId }); return; }
            return decide(item.id, action.dataset.do, action);
        }
        const draft = state.draft;
        if (!draft) return;
        const remove = event.target.closest('[data-remove]');
        if (remove) { draft.targets.splice(Number(remove.dataset.remove), 1); return renderSettings(); }
        const role = event.target.closest('[data-ai]')?.dataset.ai;
        if (role === 'pick') {
            try {
                await loadChannelsScript();
                const pickerChannel = draft.channel === 'weixin' ? 'weixin' : 'welink'; // welink-cli 用 WeLink 的人员 / 群组记录
                const picked = await window.ToolsChannels.pickTargets({
                    channel: pickerChannel,
                    title: L('审批通知发给谁', 'Who gets approval notifications'),
                    description: L('可选已有的人员 / 群组，也可在底部手动添加账号或群 ID。机器人频道需要对方与助理单聊过、或群里用过助理才能推送。', 'Pick existing people or groups, or add an account / group ID manually.'),
                    selected: draft.targets,
                    pushableOnly: draft.channel !== 'welink-cli',
                    ...(draft.channel === 'weixin' ? { kind: 'user', lockKind: true } : {})
                });
                if (picked) { draft.targets = picked.map(item => ({ kind: item.kind, id: item.id, name: item.name || item.id })).slice(0, 20); renderSettings(); }
            } catch (error) { toast(error.message); }
            return;
        }
        if (role === 'save' || role === 'test') {
            state.busy = true;
            try {
                if (role === 'save') {
                    const data = await api('PUT', '/inbox/settings', draft);
                    state.settings = data.settings;
                    state.draft = JSON.parse(JSON.stringify(data.settings));
                    toast(L('推送设置已保存', 'Saved'));
                } else {
                    const data = await api('POST', '/inbox/test', draft);
                    const failed = (data.results || []).filter(item => !item.ok);
                    toast(failed.length ? L(`已发送 ${data.sent} 个，失败：${failed.map(item => `${item.name || item.id}（${item.error}）`).join('、')}`, `Sent ${data.sent}, ${failed.length} failed`) : L(`测试消息已发送到 ${data.sent} 个对象`, `Test sent to ${data.sent}`));
                }
            } catch (error) { toast(error.message); }
            state.busy = false;
            renderSettings();
        }
    }

    function onChange(event) {
        const draft = state.draft;
        const role = event.target.dataset.ai;
        if (!draft || !role) return;
        if (role === 'enabled') draft.enabled = event.target.checked;
        if (role === 'delay') draft.delaySec = Number(event.target.value);
        if (role === 'channel') {
            draft.channel = event.target.value;
            if (draft.channel === 'weixin') draft.targets = draft.targets.filter(item => item.kind === 'user');
        }
        renderSettings();
    }

    function open() {
        ensureStyle();
        if (overlay) return;
        state.open = true;
        overlay = document.createElement('div');
        overlay.className = 'ai-overlay';
        overlay.innerHTML = `<aside class="ai-panel" role="dialog" aria-modal="true" aria-label="${esc(L('需要你', 'Needs you'))}">
            <div class="ai-head"><h3>🔔 ${esc(L('需要你', 'Needs you'))}<small data-ai="count"></small></h3><button type="button" class="ai-x" data-ai="close" aria-label="close">×</button></div>
            <div class="ai-body" data-ai="list"></div>
            <div class="ai-section" data-ai="settings"></div></aside>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay?.classList.add('show'));
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('change', onChange);
        document.addEventListener('keydown', onKey, true);
        renderList();
        renderSettings();
        loadSettings();
        refresh();
        schedule();
    }
    function onKey(event) { if (event.key === 'Escape' && !document.querySelector('.tch-overlay')) { event.stopPropagation(); close(); } }
    function close() {
        if (!overlay) return;
        state.open = false;
        document.removeEventListener('keydown', onKey, true);
        const node = overlay;
        overlay = null;
        node.classList.remove('show');
        setTimeout(() => node.remove(), 200);
        schedule();
    }

    function init() {
        ensureStyle();
        ensureNav();
        refresh();
        schedule();
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
        if (location.hash === '#needs-you') open();
    }

    window.ApprovalInbox = { open, close, refresh };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
