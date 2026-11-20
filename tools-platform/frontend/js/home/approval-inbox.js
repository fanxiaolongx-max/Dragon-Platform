// 「需要你」收件箱：并入左下角「消息中心」——角标计入待审批数，消息中心顶部列出所有对话中等审批的操作
// （可直接批准 / 拒绝 / 打开对话）；「审批推送」抽屉里设置推送到频道：超过设定时间没处理时，发到已连接的 WeLink / 微信里的指定群组或个人，回复「批准 1234」即可放行。
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

    const state = { items: [], available: false, open: false, host: null, settings: null, channels: [], delays: [], lastPush: null, canConfigure: false, draft: null, busy: false, seen: new Set(), timer: 0 };

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
#v2AlertCount.is-approval{animation:ainboxPulse 2s ease-in-out infinite}
@keyframes ainboxPulse{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.5)}50%{box-shadow:0 0 0 5px rgba(239,68,68,0)}}
.ainbox-host{width:min(1060px,100% - 80px);margin:8px auto 4px}
.ainbox-host[hidden]{display:none}
.ainbox-host-head{display:flex;align-items:center;gap:8px;margin:10px 0 8px;font-size:12.5px;font-weight:500;color:var(--v2-ink3,#8a9099)}
.ainbox-host-head b{background:var(--v2-danger,#ef4444);color:#fff;border-radius:999px;padding:0 7px;font-size:11px;line-height:18px}
.ainbox-host .ainbox-card{border-color:color-mix(in srgb,var(--v2-danger,#ef4444) 28%,var(--v2-line,#e7e7ea));background:color-mix(in srgb,var(--v2-danger,#ef4444) 3%,var(--v2-bg,#fff))}
@media (max-width:700px){.ainbox-host{width:calc(100% - 32px)}}
.ainbox-overlay{position:fixed;inset:0;z-index:2400;background:rgba(15,17,21,.32);display:flex;justify-content:flex-end;opacity:0;transition:opacity .18s ease}
.ainbox-overlay.show{opacity:1}
.ainbox-panel{width:min(440px,100vw);height:100%;background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);border-left:1px solid var(--v2-line,#e7e7ea);display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(0,0,0,.12);transform:translateX(24px);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.ainbox-overlay.show .ainbox-panel{transform:none}
.ainbox-head{display:flex;align-items:center;gap:10px;padding:16px 18px 12px;border-bottom:1px solid var(--v2-line,#e7e7ea)}
.ainbox-head h3{margin:0;font-size:16px;flex:1}
.ainbox-head small{color:var(--v2-ink3,#8a9099);font-weight:400;margin-left:6px}
.ainbox-x{border:0;background:transparent;color:var(--v2-ink3,#8a9099);font-size:20px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:8px}
.ainbox-x:hover{background:var(--v2-chip,#f2f2f4)}
.ainbox-body{flex:1;overflow:auto;padding:12px 14px 18px}
.ainbox-empty{padding:34px 12px;text-align:center;color:var(--v2-ink3,#8a9099);font-size:13px;line-height:1.7}
.ainbox-empty b{display:block;font-size:28px;margin-bottom:6px}
.ainbox-card{border:1px solid var(--v2-line,#e7e7ea);border-radius:12px;padding:12px;margin-bottom:10px;background:var(--v2-bg,#fff);animation:ainboxIn .2s ease}
@keyframes ainboxIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.ainbox-card-top{display:flex;align-items:center;gap:8px;font-size:13px}
.ainbox-card-top strong{font-size:14px}
.ainbox-code{margin-left:auto;font:600 12px ui-monospace,Menlo,monospace;color:var(--v2-ink2,#4b5563);background:var(--v2-chip,#f2f2f4);padding:2px 7px;border-radius:6px}
.ainbox-detail{margin:8px 0;font:12px/1.55 ui-monospace,Menlo,monospace;background:var(--v2-chip,#f2f2f4);border-radius:8px;padding:7px 9px;white-space:pre-wrap;word-break:break-all;max-height:110px;overflow:auto}
.ainbox-meta{display:flex;flex-wrap:wrap;gap:6px 10px;font-size:12px;color:var(--v2-ink3,#8a9099)}
.ainbox-meta .ok{color:var(--v2-accent,#10a37f)}
.ainbox-meta .bad{color:var(--v2-danger,#ef4444)}
.ainbox-actions{display:flex;gap:8px;margin-top:10px}
.ainbox-btn{border:1px solid var(--v2-line-strong,#d6d6db);background:var(--v2-bg,#fff);color:var(--v2-ink,#1f2328);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;transition:background .15s,transform .1s}
.ainbox-btn:hover{background:var(--v2-chip,#f2f2f4)}
.ainbox-btn:active{transform:scale(.97)}
.ainbox-btn:disabled{opacity:.5;cursor:default}
.ainbox-btn.primary{background:var(--v2-accent,#10a37f);border-color:var(--v2-accent,#10a37f);color:#fff}
.ainbox-btn.primary:hover{filter:brightness(1.05)}
.ainbox-btn.danger{color:var(--v2-danger,#ef4444)}
.ainbox-btn.link{border-color:transparent;margin-left:auto;color:var(--v2-ink2,#4b5563)}
.ainbox-section{border-top:1px solid var(--v2-line,#e7e7ea);padding:14px 16px 18px;background:var(--v2-side,var(--v2-bg,#fff))}
.ainbox-section h4{margin:0 0 4px;font-size:14px;display:flex;align-items:center;gap:8px}
.ainbox-section p.hint{margin:0 0 10px;font-size:12px;color:var(--v2-ink3,#8a9099);line-height:1.6}
.ainbox-row{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13px}
.ainbox-row>label{width:64px;flex:none;color:var(--v2-ink2,#4b5563)}
.ainbox-row select{flex:1;min-width:0;border:1px solid var(--v2-line-strong,#d6d6db);border-radius:8px;padding:6px 8px;background:var(--v2-bg,#fff);color:inherit;font-size:13px}
.ainbox-chips{flex:1;display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.ainbox-chip{display:inline-flex;align-items:center;gap:4px;background:var(--v2-chip,#f2f2f4);border-radius:999px;padding:2px 4px 2px 9px;font-size:12px;max-width:100%}
.ainbox-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ainbox-chip button{border:0;background:transparent;color:var(--v2-ink3,#8a9099);cursor:pointer;font-size:14px;line-height:1;padding:0 3px}
.ainbox-switch{position:relative;width:36px;height:20px;flex:none;margin-left:auto}
.ainbox-switch input{opacity:0;width:0;height:0}
.ainbox-switch i{position:absolute;inset:0;border-radius:999px;background:var(--v2-line-strong,#d6d6db);transition:background .18s;cursor:pointer}
.ainbox-switch i::after{content:'';position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .18s;box-shadow:0 1px 2px rgba(0,0,0,.2)}
.ainbox-switch input:checked+i{background:var(--v2-accent,#10a37f)}
.ainbox-switch input:checked+i::after{transform:translateX(16px)}
.ainbox-status{font-size:12px;margin:6px 0 0;line-height:1.6}
.ainbox-status.bad{color:var(--v2-danger,#ef4444)}
.ainbox-status.ok{color:var(--v2-accent,#10a37f)}
.ainbox-foot{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}
@media (max-width:560px){.ainbox-panel{width:100vw}}
`;
        document.head.appendChild(style);
    }

    // ── 角标：通知 home-shell 把待审批数计入消息中心角标 ──
    function renderBadge() {
        window.dispatchEvent(new CustomEvent('tools:approval-inbox', { detail: { total: state.available ? state.items.length : 0 } }));
        window.dispatchEvent(new Event('dragon-claw:radar-refresh'));
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
            if (elsewhere.length && !state.open) toast(L(`另一个对话里有 ${elsewhere.length} 个操作等你审批，点左下角消息中心处理`, `${elsewhere.length} approval(s) waiting in another chat`));
        } catch (error) {
            if (error.status === 401 || error.status === 403) { state.available = false; state.items = []; }
        }
        renderBadge();
        renderList();
    }

    function schedule() {
        clearTimeout(state.timer);
        state.timer = setTimeout(async () => {
            if (!document.hidden) await refresh();
            schedule();
        }, state.open || state.host?.isConnected ? 3000 : POLL_MS);
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
        return state.channels.find(item => item.channel === id)?.label || ({ welink: L('WeLink 助理', 'WeLink'), weixin: L('微信', 'WeChat'), 'welink-cli': 'welink-cli' })[id] || id;
    }

    /** 消息中心顶部的「需要你」区块（home-shell 打开消息中心时传入容器） */
    function renderInto(host) {
        if (!host) return;
        ensureStyle();
        if (state.host !== host) {
            state.host = host;
            host.addEventListener('click', onCardClick);
            refresh();
            schedule();
        }
        renderList();
    }

    function renderList() {
        const body = state.host;
        if (!body?.isConnected) return;
        body.classList.add('ainbox-host');
        body.hidden = !state.available || !state.items.length;
        if (body.hidden) { body.innerHTML = ''; return; }
        body.innerHTML = `<div class="ainbox-host-head">🔔 ${esc(L('需要你审批', 'Needs your approval'))}<b>${state.items.length}</b></div>` + state.items.map(item => {
            const pushed = item.pushed
                ? `<span class="ok">${esc(L(`已推送到 ${channelLabel(item.pushed.channel)}`, `Sent to ${channelLabel(item.pushed.channel)}`))}${item.pushed.error ? ` · ${esc(item.pushed.error)}` : ''}</span>`
                : item.pushError ? `<span class="bad">${esc(L('推送失败：', 'Push failed: '))}${esc(item.pushError)}</span>` : '';
            return `<div class="ainbox-card" data-id="${esc(item.id)}">
                <div class="ainbox-card-top"><strong>${esc(item.label)}</strong><span class="ainbox-code" title="${esc(L('频道里回复「批准 码」', 'Reply "approve CODE" in the channel'))}">#${esc(item.code)}</span></div>
                ${item.detail ? `<div class="ainbox-detail">${esc(item.detail)}</div>` : ''}
                <div class="ainbox-meta"><span>${esc(item.title || L('未命名对话', 'Untitled chat'))}</span><span>${esc(relative(item.createdAt))}</span><span>${esc(remaining(item.expiresAt))}</span>${pushed}</div>
                <div class="ainbox-actions">
                    <button type="button" class="ainbox-btn primary" data-do="allow">${esc(L('批准', 'Approve'))}</button>
                    <button type="button" class="ainbox-btn danger" data-do="deny">${esc(L('拒绝', 'Deny'))}</button>
                    ${item.chatSessionId ? `<button type="button" class="ainbox-btn link" data-do="open">${esc(L('打开对话 →', 'Open chat →'))}</button>` : ''}
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
                <label class="ainbox-switch" title="${esc(L('启用推送', 'Enable'))}"><input type="checkbox" data-ai="enabled" ${draft.enabled ? 'checked' : ''} ${disabled || (!anyOk && !draft.enabled ? 'disabled' : '')}><i></i></label></h4>
            <p class="hint">${esc(anyOk
                ? L('审批超过设定时间没人处理，就发到下面选的群或人；在 WeLink 助理 / 微信里回复「批准 码」即可放行。', 'If an approval waits too long, notify the chosen people or groups. Reply "approve CODE" in the bot chat to approve.')
                : L('还没有可用的频道：请先在「全局设置 › 频道对接」接入 WeLink 助理、微信或 welink-cli，并确认连接正常。', 'No channel is connected. Set up WeLink, WeChat or welink-cli in Settings › Channels first.'))}</p>
            <div class="ainbox-row"><label>${esc(L('频道', 'Channel'))}</label>
                <select data-ai="channel" ${disabled}>${state.channels.map(item => `<option value="${esc(item.channel)}" ${item.channel === draft.channel ? 'selected' : ''}>${item.ok ? '🟢' : '⚪️'} ${esc(item.label)}${item.ok ? '' : L('（不可用）', ' (unavailable)')}</option>`).join('')}</select></div>
            ${current.ok ? (current.canReply ? '' : `<p class="ainbox-status">${esc(L('welink-cli 以你本人身份发送，收不到回复：只做提醒，需回到网页处理。', 'welink-cli only sends reminders; approve in the web app.'))}</p>`) : `<p class="ainbox-status bad">${esc(current.reason || L('频道不可用', 'Unavailable'))}</p>`}
            <div class="ainbox-row"><label>${esc(L('发给', 'Send to'))}</label>
                <div class="ainbox-chips">${draft.targets.map((item, index) => `<span class="ainbox-chip"><span>${item.kind === 'group' ? '👥' : '👤'} ${esc(item.name || item.id)}</span>${disabled ? '' : `<button type="button" data-remove="${index}" aria-label="remove">×</button>`}</span>`).join('') || `<span class="hint" style="font-size:12px;color:var(--v2-ink3)">${esc(L('未选择', 'None'))}</span>`}</div>
                <button type="button" class="ainbox-btn" data-ai="pick" ${disabled}>${esc(L('选择…', 'Choose…'))}</button></div>
            <div class="ainbox-row"><label>${esc(L('多久后', 'After'))}</label>
                <select data-ai="delay" ${disabled}>${state.delays.map(sec => `<option value="${sec}" ${sec === draft.delaySec ? 'selected' : ''}>${sec ? esc(L(`${sec >= 60 ? `${sec / 60} 分钟` : `${sec} 秒`}没处理再推送`, `after ${sec >= 60 ? `${sec / 60} min` : `${sec}s`} unanswered`)) : esc(L('立即推送', 'Immediately'))}</option>`).join('')}</select></div>
            ${last ? `<p class="ainbox-status ${last.ok ? 'ok' : 'bad'}">${esc(L('最近一次推送', 'Last push'))}：${esc(new Date(last.at).toLocaleString())} · ${last.ok ? esc(L('成功', 'sent')) : esc(last.error)}</p>` : ''}
            ${state.canConfigure ? `<div class="ainbox-foot">
                <button type="button" class="ainbox-btn" data-ai="test" ${current.ok && draft.targets.length ? '' : 'disabled'}>${esc(L('发送测试', 'Send test'))}</button>
                <button type="button" class="ainbox-btn primary" data-ai="save" ${state.busy ? 'disabled' : ''}>${esc(L('保存', 'Save'))}</button></div>` : ''}`;
    }

    async function loadSettings() {
        try {
            const data = await api('GET', '/inbox/settings');
            Object.assign(state, { settings: data.settings, channels: data.channels || [], delays: data.delays || [0, 30, 60, 120, 300], lastPush: data.lastPush, canConfigure: data.canConfigure !== false });
            state.draft = JSON.parse(JSON.stringify(data.settings));
        } catch (error) {
            state.draft = null;
            const box = overlay?.querySelector('[data-ai="settings"]');
            if (box) box.innerHTML = `<p class="ainbox-status bad">${esc(error.message)}</p>`;
            return;
        }
        renderSettings();
    }

    function loadChannelsScript() {
        if (window.ToolsChannels) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/shared/channels.js';
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

    function onCardClick(event) {
        const card = event.target.closest('.ainbox-card');
        const action = event.target.closest('[data-do]');
        if (!card || !action) return;
        const item = state.items.find(entry => entry.id === card.dataset.id);
        if (!item) return;
        if (action.dataset.do === 'open') {
            document.querySelector('.v2-messages [data-msg-close]')?.click();
            window.HomeMode?.set?.('chat');
            window.DragonClaw?.openChat?.({ id: item.chatSessionId });
            return;
        }
        decide(item.id, action.dataset.do, action);
    }

    async function onClick(event) {
        if (event.target === overlay || event.target.closest('[data-ai="close"]')) return close();
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
        overlay.className = 'ainbox-overlay';
        overlay.innerHTML = `<aside class="ainbox-panel" role="dialog" aria-modal="true" aria-label="${esc(L('审批推送', 'Approval push'))}">
            <div class="ainbox-head"><h3>🔔 ${esc(L('审批推送', 'Approval push'))}</h3><button type="button" class="ainbox-x" data-ai="close" aria-label="close">×</button></div>
            <div class="ainbox-section" data-ai="settings" style="border-top:0;flex:1;overflow:auto"></div></aside>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay?.classList.add('show'));
        overlay.addEventListener('click', onClick);
        overlay.addEventListener('change', onChange);
        document.addEventListener('keydown', onKey, true);
        renderSettings();
        loadSettings();
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
        refresh();
        schedule();
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
        
    }

    window.ApprovalInbox = { open, openSettings: open, close, refresh, renderInto, count: () => (state.available ? state.items.length : 0), items: () => (state.available ? state.items.slice() : []), available: () => state.available };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
