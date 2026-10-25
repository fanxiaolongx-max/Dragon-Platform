// 运营草稿确认：主页对话卡片与跨工具提醒共享同一个编辑器。
(function () {
    'use strict';
    if (window.ToolsOpsInbox || window.top !== window.self || window.__TP_STATIC_BASE__ || !/^https?:$/.test(location.protocol)) return;
    const API = '/api/channels/ops';
    const PAGE_SIZE = 20;
    const L = (zh, en) => /^(en|en-US)$/.test(window.ToolsI18n?.getLanguage?.() || window.ToolsCustomI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const state = { items: [], total: 0, offset: 0, hasMore: false, canManage: false, loading: false, busy: '', edits: new Map(), open: new Set(), editing: new Set(), notice: '', tone: '', signature: '', identity: '', muted: '', epoch: 0 };
    let banner, home, panel, dialog, restoreFocus, timer;

    function identity() {
        return ['tools_user', 'tools_tenant_id', 'tools_token'].map(key => localStorage.getItem(key) || sessionStorage.getItem(key) || '').join('|');
    }

    function muteKey() {
        return `tools_ops_inbox_muted:${localStorage.getItem('tools_user') || ''}:${localStorage.getItem('tools_tenant_id') || 'default'}`;
    }

    function readMuted() {
        try { return sessionStorage.getItem(muteKey()) || ''; } catch { return ''; }
    }

    async function request(method, path, body) {
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        const response = await fetch(`${API}${path}`, {
            method, credentials: 'same-origin', cache: 'no-store',
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status });
        return data;
    }

    function resetIdentity() {
        state.identity = identity();
        state.epoch += 1;
        state.items = [];
        state.total = state.offset = 0;
        state.loading = false;
        state.canManage = false;
        state.edits.clear();
        state.open.clear();
        state.editing.clear();
        state.notice = state.signature = state.muted = state.busy = '';
        state.muted = readMuted();
        closeDialog();
        render();
    }

    async function refresh({ force = false } = {}) {
        if (identity() !== state.identity) resetIdentity();
        if (state.loading || state.busy || (!force && document.visibilityState === 'hidden')) return;
        const epoch = state.epoch;
        state.loading = true;
        try {
            let data = await request('GET', `/pending?limit=${PAGE_SIZE}&offset=${state.offset}`);
            if (epoch !== state.epoch || identity() !== state.identity) return;
            if (data.total && !data.items?.length && state.offset) {
                state.offset = 0;
                data = await request('GET', `/pending?limit=${PAGE_SIZE}&offset=0`);
            }
            if (epoch !== state.epoch || identity() !== state.identity) return;
            state.canManage = data.canManage === true;
            state.items = data.items || [];
            state.total = data.total || 0;
            state.hasMore = Boolean(data.hasMore);
            for (const item of state.items) {
                const edit = state.edits.get(item.id);
                if (edit && edit.base !== item.content && edit.text === edit.base) state.edits.delete(item.id);
            }
            const signature = JSON.stringify(data);
            if (force || signature !== state.signature) {
                state.signature = signature;
                render();
            }
        } catch (error) {
            if (epoch !== state.epoch || identity() !== state.identity) return;
            if (error.status === 401 || error.status === 403) resetIdentity();
            else if (force) {
                state.notice = L('暂时无法刷新，已保留你的修改：', 'Could not refresh. Your edits are preserved: ') + error.message;
                state.tone = 'error';
                renderPanel();
            }
        } finally {
            if (epoch === state.epoch) state.loading = false;
        }
    }

    function targets(item) {
        return item.targets.map(target => `${target.channel === 'weixin' ? L('微信', 'WeChat') : 'WeLink'} · ${target.name || target.id}`).join('、');
    }

    function card(item) {
        const edit = state.edits.get(item.id);
        const text = edit?.text ?? item.content;
        const editing = state.editing.has(item.id);
        const conflict = edit && edit.base !== item.content && edit.text !== item.content;
        const disabled = state.busy ? 'disabled' : '';
        return `<details class="ops-card" data-ops-card="${esc(item.id)}" ${state.open.has(item.id) ? 'open' : ''}>
            <summary><span class="ops-card-icon" aria-hidden="true">✦</span><span class="ops-card-title"><b>${esc(item.planName || L('运营消息', 'Ops message'))}</b><small>${esc(new Date(item.createdAt).toLocaleString())}</small></span><span class="ops-tag">${esc(L('待确认', 'Review'))}</span></summary>
            <div class="ops-card-body"><div class="ops-recipients">${esc(L('发送至：', 'Send to: '))}${esc(targets(item))}</div>
            ${conflict ? `<p class="ops-warning">${esc(L('其他页面已修改这条草稿。这里保留了你的编辑，请核对最新正文后再发送。', 'This draft changed elsewhere. Your edits are preserved; check the latest text before sending.'))}<button type="button" data-ops-inbox-action="latest">${esc(L('采用最新正文', 'Use latest text'))}</button></p>` : ''}
            ${editing ? `<label class="ops-edit-label">${esc(L('编辑消息正文', 'Edit message'))}<textarea data-ops-edit="${esc(item.id)}" ${disabled}>${esc(text)}</textarea></label>` : `<div class="ops-preview">${esc(text)}</div>`}
            <div class="ops-card-actions"><button type="button" class="ops-primary" data-ops-inbox-action="send" ${disabled || (!text.trim() || conflict ? 'disabled' : '')}>${esc(state.busy === item.id ? L('处理中…', 'Working…') : L('确认并发送', 'Confirm & send'))}</button>
            <button type="button" data-ops-inbox-action="edit" ${disabled}>${esc(editing ? L('预览正文', 'Preview') : L('修改正文', 'Edit'))}</button>
            ${editing || text !== item.content ? `<button type="button" data-ops-inbox-action="save" ${disabled || (conflict ? 'disabled' : '')}>${esc(L('保存草稿', 'Save draft'))}</button>` : ''}
            <span class="ops-send-hint">${esc(L('确认后立即发送到上述对象', 'Confirmation sends immediately to these recipients'))}</span></div></div>
        </details>`;
    }

    function renderPanel() {
        if (!panel) return;
        const focused = document.activeElement;
        const focusId = focused?.dataset?.opsEdit;
        const selection = focusId ? [focused.selectionStart, focused.selectionEnd] : null;
        const scroll = panel.querySelector('.ops-card-list')?.scrollTop || 0;
        panel.innerHTML = `<header class="ops-inbox-heading"><div><span class="ops-eyebrow">${esc(L('消息待办', 'MESSAGE INBOX'))}</span><h3>${esc(L('待确认消息', 'Messages to review'))}</h3><span class="ops-count">${state.total}</span></div><button type="button" data-ops-inbox-action="refresh" ${state.busy ? 'disabled' : ''}>${esc(L('刷新', 'Refresh'))}</button></header>
            <p class="ops-inbox-description">${esc(L('草稿已准备好。核对发送对象和正文，也可以直接修改后发送。', 'Your drafts are ready. Check the recipients and message, or edit before sending.'))}</p>
            <div class="ops-feedback ${state.tone === 'error' ? 'is-error' : ''}" role="status" ${state.notice ? '' : 'hidden'}>${esc(state.notice)}</div>
            <div class="ops-card-list">${state.items.length ? state.items.map(card).join('') : `<div class="ops-empty">${esc(L('所有待确认消息已处理', 'All messages have been reviewed'))}</div>`}</div>
            ${state.offset || state.hasMore ? `<footer class="ops-paging"><button type="button" data-ops-inbox-action="prev" ${!state.offset || state.busy ? 'disabled' : ''}>${esc(L('上一页', 'Previous'))}</button><span>${state.offset + 1}–${state.offset + state.items.length} / ${state.total}</span><button type="button" data-ops-inbox-action="next" ${!state.hasMore || state.busy ? 'disabled' : ''}>${esc(L('下一页', 'Next'))}</button></footer>` : ''}`;
        panel.querySelector('.ops-card-list').scrollTop = scroll;
        if (focusId) {
            const textarea = [...panel.querySelectorAll('[data-ops-edit]')].find(node => node.dataset.opsEdit === focusId);
            textarea?.focus({ preventScroll: true });
            textarea?.setSelectionRange(...selection);
        }
    }

    function render() {
        if (!banner) return;
        const available = state.canManage && state.total > 0;
        const priorityChanged = document.body.classList.contains('ops-review-pending') !== available;
        document.body.classList.toggle('ops-review-pending', available);
        if (priorityChanged) window.dispatchEvent(new Event('tools:ops-inbox-state'));
        const batch = state.items.map(item => item.id).join('|');
        banner.hidden = !available || batch === state.muted;
        banner.setAttribute('aria-label', L('待确认消息提醒', 'Message review reminder'));
        if (dialog) {
            dialog.setAttribute('aria-label', L('待确认消息', 'Messages to review'));
            dialog.querySelector('[data-ops-inbox-action="close"]').setAttribute('aria-label', L('关闭', 'Close'));
        }
        banner.innerHTML = `<span class="ops-beacon" aria-hidden="true"><i></i>✦</span><span class="ops-banner-copy"><b>${esc(L(`${state.total} 条消息等待你确认`, `${state.total} messages ready for review`))}</b><small>${esc(L('草稿已就绪，查看后即可发送', 'Drafts are ready to review and send'))}</small></span><button type="button" class="ops-primary" data-ops-inbox-action="review">${esc(L('查看并确认', 'Review'))}<span aria-hidden="true"> ↗</span></button><button type="button" class="ops-dismiss" data-ops-inbox-action="mute" aria-label="${esc(L('暂时收起，有新消息时再提醒', 'Dismiss until the next new message'))}">×</button>`;
        if (home) {
            home.hidden = !available && !state.notice;
            home.querySelector(':scope > summary').textContent = L(`✦ 待确认消息（${state.total}）· 查看与处理`, `✦ Messages to review (${state.total}) · Open inbox`);
        }
        if (available && state.items.length && !state.open.size) state.open.add(state.items[0].id);
        renderPanel();
    }

    function review() {
        if (home) {
            window.HomeMode?.set?.('chat');
            home.hidden = false;
            home.open = true;
            panel.querySelector('.ops-card')?.setAttribute('open', '');
            home.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
            panel.querySelector('[data-ops-inbox-action="send"]')?.focus({ preventScroll: true });
        } else {
            restoreFocus = document.activeElement;
            dialog.append(panel);
            dialog.showModal();
        }
    }

    function closeDialog() {
        if (!dialog?.open) return;
        dialog.close();
        restoreFocus?.focus?.({ preventScroll: true });
    }

    async function action(event) {
        const button = event.target.closest('[data-ops-inbox-action]');
        if (!button) return;
        const kind = button.dataset.opsInboxAction;
        if (kind === 'close') return closeDialog();
        if (kind === 'mute') {
            state.muted = state.items.map(item => item.id).join('|');
            try { sessionStorage.setItem(muteKey(), state.muted); } catch { /* 当前页面仍可收起 */ }
            banner.hidden = true;
            return;
        }
        if (kind === 'review') return review();
        if (state.busy) return;
        if (kind === 'refresh' || kind === 'next' || kind === 'prev') {
            if (kind !== 'refresh') state.offset = Math.max(0, state.offset + (kind === 'next' ? PAGE_SIZE : -PAGE_SIZE));
            return refresh({ force: true });
        }
        const id = button.closest('[data-ops-card]')?.dataset.opsCard;
        const item = state.items.find(entry => entry.id === id);
        if (!item) return;
        state.open.add(id);
        if (kind === 'edit') {
            if (state.editing.has(id)) state.editing.delete(id);
            else state.editing.add(id);
            renderPanel();
            panel.querySelector('[data-ops-edit]')?.focus();
            return;
        }
        if (kind === 'latest') { state.edits.delete(id); renderPanel(); return; }
        if (kind !== 'send' && kind !== 'save') return;
        // 不弹第二次确认；卡片已展示完整正文和目标，点击此按钮就是用户确认。
        if (identity() !== state.identity) { resetIdentity(); return refresh({ force: true }); }
        const content = state.edits.get(id)?.text ?? item.content;
        if (!content.trim()) { state.notice = L('消息内容不能为空', 'Message cannot be empty'); state.tone = 'error'; renderPanel(); return; }
        const epoch = state.epoch;
        state.busy = id;
        state.notice = '';
        renderPanel();
        try {
            const result = await request(kind === 'send' ? 'POST' : 'PUT', `/runs/${encodeURIComponent(id)}${kind === 'send' ? '/send' : ''}`, { content, expectedContent: item.content });
            if (epoch !== state.epoch || identity() !== state.identity) return;
            state.edits.delete(id);
            state.editing.delete(id);
            state.tone = kind === 'send' && result.status !== 'sent' ? 'error' : '';
            state.notice = kind === 'save' ? L('修改已保存，尚未发送。', 'Draft saved. It has not been sent.') : result.status === 'sent' ? L('消息已发送。', 'Message sent.') : L('发送未全部成功，请到频道对接的推送记录查看详情：', 'Some deliveries failed. Check channel history: ') + (result.error || result.status);
            if (kind === 'send') {
                state.open.delete(id);
                state.items = state.items.filter(entry => entry.id !== id);
                state.total = Math.max(0, state.total - 1);
            }
            window.dispatchEvent(new Event('tools:ops-drafts-changed'));
            try { localStorage.setItem('tools_ops_drafts_changed', String(Date.now())); } catch { /* 当前页面仍会刷新 */ }
        } catch (error) {
            if (epoch !== state.epoch || identity() !== state.identity) return;
            state.notice = error.message;
            state.tone = 'error';
        } finally {
            if (epoch === state.epoch) { state.busy = ''; render(); await refresh({ force: true }); }
        }
    }

    function init() {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = '/css/ops-inbox.css';
        document.head.append(css);
        fetch('/api/asset-version?path=%2Fcss%2Fops-inbox.css', { cache: 'no-store' })
            .then(response => response.ok ? response.json() : null)
            .then(data => { if (data?.version) css.href = `/css/ops-inbox.css?v=${encodeURIComponent(data.version)}`; })
            .catch(() => {});
        banner = document.createElement('aside');
        banner.className = 'ops-inbox-banner';
        banner.dataset.toolsI18nIgnore = '1';
        banner.setAttribute('aria-label', L('待确认消息提醒', 'Message review reminder'));
        banner.setAttribute('aria-live', 'polite');
        banner.hidden = true;
        document.body.append(banner);
        panel = document.createElement('section');
        panel.className = 'ops-inbox-panel';
        panel.dataset.toolsI18nIgnore = '1';
        const chat = document.getElementById('dragonClaw');
        if (chat) {
            home = document.createElement('details');
            home.id = 'ops-drafts';
            home.className = 'ops-home-inbox';
            home.hidden = true;
            home.open = true;
            home.innerHTML = `<summary>${esc(L('✦ 待确认消息 · 查看与处理', '✦ Messages to review · Open inbox'))}</summary>`;
            home.append(panel);
            chat.querySelector('.dc-thread').before(home);
        } else {
            dialog = document.createElement('dialog');
            dialog.className = 'ops-inbox-dialog';
            dialog.setAttribute('aria-label', L('待确认消息', 'Messages to review'));
            dialog.innerHTML = `<button type="button" class="ops-dialog-close" data-ops-inbox-action="close" aria-label="${esc(L('关闭', 'Close'))}">×</button>`;
            dialog.append(panel);
            document.body.append(dialog);
            dialog.addEventListener('click', event => { if (event.target === dialog && !state.busy) closeDialog(); });
        }
        [banner, panel, dialog].filter(Boolean).forEach(node => node.addEventListener('click', event => { event.stopPropagation(); action(event).catch(error => { state.notice = error.message; state.tone = 'error'; renderPanel(); }); }));
        panel.addEventListener('input', event => {
            const id = event.target.dataset.opsEdit;
            const item = state.items.find(entry => entry.id === id);
            if (!item) return;
            state.edits.set(id, { base: state.edits.get(id)?.base ?? item.content, text: event.target.value });
            const edit = state.edits.get(id);
            event.target.closest('.ops-card').querySelector('[data-ops-inbox-action="send"]').disabled = !edit.text.trim() || (edit.base !== item.content && edit.text !== item.content);
        });
        panel.addEventListener('toggle', event => {
            const id = event.target.dataset.opsCard;
            if (id) { if (event.target.open) state.open.add(id); else state.open.delete(id); }
        }, true);
        state.identity = identity();
        state.muted = readMuted();
        refresh({ force: true }).then(() => { if (location.hash === '#ops-drafts') review(); });
        timer = setInterval(refresh, 20000);
        window.addEventListener('pagehide', () => clearInterval(timer));
        window.addEventListener('pageshow', event => { if (event.persisted) { timer = setInterval(refresh, 20000); refresh({ force: true }); } });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh({ force: true }); });
        window.addEventListener('focus', () => refresh());
        window.addEventListener('tools:ops-drafts-changed', () => refresh({ force: true }));
        window.addEventListener('storage', event => {
            if (['tools_user', 'tools_tenant_id', 'tools_token', 'tools_ops_drafts_changed'].includes(event.key)) {
                if (identity() !== state.identity) resetIdentity();
                refresh({ force: true });
            }
        });
        for (const event of ['tools:languagechange', 'tools:custom-languagechange']) window.addEventListener(event, () => {
            if (home) home.querySelector(':scope > summary').textContent = L('✦ 待确认消息 · 查看与处理', '✦ Messages to review · Open inbox');
            render();
        });
    }

    window.ToolsOpsInbox = { refresh: () => refresh({ force: true }), open: review };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
