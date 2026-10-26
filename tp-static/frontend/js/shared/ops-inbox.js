// 运营草稿确认：主页显示提示条，点击后进入对应的微信 / WeLink 会话处理。
(function () {
    'use strict';
    if (window.ToolsOpsInbox || window.top !== window.self || window.__TP_STATIC_BASE__ || !/^https?:$/.test(location.protocol)) return;
    const API = '/api/channels/ops';
    const PAGE_SIZE = 20;
    const SUCCESS_NOTICE_MS = 2200;
    const L = (zh, en) => /^(en|en-US)$/.test(window.ToolsI18n?.getLanguage?.() || window.ToolsCustomI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const state = { items: [], total: 0, offset: 0, hasMore: false, canManage: false, activeThread: null, threadReady: false, reviewing: false, loading: false, busy: '', edits: new Map(), open: new Set(), editing: new Set(), notice: '', tone: '', signature: '', identity: '', muted: '', epoch: 0 };
    let banner, home, panel, timer, noticeTimer;

    function setNotice(message, tone = '') {
        clearTimeout(noticeTimer);
        state.notice = message;
        state.tone = tone;
        // 成功反馈短暂停留；错误保留，方便核对和重试。
        if (message && tone !== 'error') noticeTimer = setTimeout(() => {
            state.notice = state.tone = '';
            render();
        }, SUCCESS_NOTICE_MS);
    }

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
        state.activeThread = null;
        state.threadReady = false;
        state.total = state.offset = 0;
        state.loading = false;
        state.canManage = false;
        state.edits.clear();
        state.open.clear();
        state.editing.clear();
        state.notice = state.signature = state.muted = state.busy = '';
        setNotice('');
        state.muted = readMuted();
        closeReview();
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
                setNotice(L('暂时无法刷新，已保留你的修改：', 'Could not refresh. Your edits are preserved: ') + error.message, 'error');
                renderPanel();
            }
        } finally {
            if (epoch === state.epoch) state.loading = false;
        }
    }

    function targets(item) {
        return item.targets.map(target => `${target.channel === 'weixin' ? L('微信', 'WeChat') : 'WeLink'} · ${target.name || target.id}`).join('、');
    }

    const targetKey = target => target ? JSON.stringify([target.channel, target.kind, target.id]) : '';
    function pendingTargets() {
        return [...new Map(state.items.flatMap(item => item.targets).map(target => [targetKey(target), target])).values()];
    }

    function mountThreadPanel() {
        state.reviewing = Boolean(home && state.canManage && state.activeThread && state.threadReady && (state.total || state.notice));
        if (state.reviewing) {
            const thread = document.getElementById('dcThread');
            if (panel.parentElement !== thread) thread.append(panel);
        }
        else panel?.remove();
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
            <button type="button" class="ops-discard" data-ops-inbox-action="discard" ${disabled}>${esc(L('丢弃', 'Discard'))}</button>
            <span class="ops-send-hint">${esc(L('确认后立即发送到上述全部对象', 'Confirmation sends immediately to all recipients listed above'))}</span></div></div>
        </details>`;
    }

    function renderPanel() {
        if (!panel || !state.reviewing) return;
        const focused = document.activeElement;
        const focusId = focused?.dataset?.opsEdit;
        const selection = focusId ? [focused.selectionStart, focused.selectionEnd] : null;
        const scroll = panel.querySelector('.ops-card-list')?.scrollTop || 0;
        const activeKey = targetKey(state.activeThread);
        const items = state.items.filter(item => item.targets.some(target => targetKey(target) === activeKey));
        panel.innerHTML = `<header class="ops-inbox-heading"><div><span class="ops-eyebrow">${esc(L('会话内运营草稿', 'DRAFTS FOR THIS CONVERSATION'))}</span><h3>${esc(L('待确认消息', 'Messages to review'))}</h3><span class="ops-count">${items.length}</span><small class="ops-total">${esc(L(`全部 ${state.total} 条待确认`, `${state.total} pending overall`))}</small></div><button type="button" data-ops-inbox-action="refresh" ${state.busy ? 'disabled' : ''}>${esc(L('刷新', 'Refresh'))}</button></header>
            <p class="ops-inbox-description">${esc(L('这里显示发往当前会话的草稿。发送前请核对正文和完整收件对象。', 'Drafts for this conversation are shown here. Check the text and all recipients before sending.'))}</p>
            <div class="ops-feedback ${state.tone === 'error' ? 'is-error' : ''}" role="status" ${state.notice ? '' : 'hidden'}>${esc(state.notice)}</div>
            <div class="ops-card-list">${items.length ? items.map(card).join('') : `<div class="ops-empty">${esc(state.total ? L('当前会话没有待确认草稿，其他会话的草稿请在左侧切换会话查看。', 'No drafts for this conversation. Select another conversation on the left to review its drafts.') : L('所有待确认消息已处理', 'All messages have been reviewed'))}</div>`}</div>
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
        const batch = state.items.map(item => item.id).join('|');
        banner.hidden = !available || batch === state.muted;
        banner.setAttribute('aria-label', L('待确认消息提醒', 'Message review reminder'));
        syncPriority();
        banner.innerHTML = `<span class="ops-beacon" aria-hidden="true"><i></i>✦</span><span class="ops-banner-copy"><b>${esc(L(`${state.total} 条消息等待你确认`, `${state.total} messages ready for review`))}</b><small>${esc(L('进入对应的微信 / WeLink 会话处理', 'Review in the matching WeChat / WeLink conversation'))}</small></span><button type="button" class="ops-primary" data-ops-inbox-action="review">${esc(L('进入对话', 'Open chat'))}<span aria-hidden="true"> ↗</span></button><button type="button" class="ops-dismiss" data-ops-inbox-action="mute" aria-label="${esc(L('暂时收起，有新消息时再提醒', 'Dismiss until the next new message'))}">×</button>`;
        mountThreadPanel();
        if (home) {
            home.hidden = !available || state.reviewing;
            home.innerHTML = `<span class="ops-prompt-dot" aria-hidden="true"></span><span>${esc(L(`有 ${state.total} 条消息待确认`, `${state.total} messages to review`))}</span><span class="ops-prompt-action">${esc(L('进入对话', 'Open chat'))} <span aria-hidden="true">→</span></span>`;
        }
        const visible = state.items.filter(item => item.targets.some(target => targetKey(target) === targetKey(state.activeThread)));
        if (available && visible.length && !visible.some(item => state.open.has(item.id))) state.open.add(visible[0].id);
        renderPanel();
        if (!available && !state.notice && !state.busy) closeReview();
    }

    // 只有浮动提醒横幅真正显示时才让推广避让（两者都在右上角）；主页对话区用就地入口，不影响推广和抽屉。
    function syncPriority() {
        const shown = Boolean(banner && !banner.hidden && !document.body.classList.contains('home-mode-chat'));
        if (document.body.classList.contains('ops-banner-shown') === shown) return;
        document.body.classList.toggle('ops-banner-shown', shown);
        window.dispatchEvent(new Event('tools:ops-inbox-state'));
    }

    async function review(target) {
        if (!home) {
            location.assign('/#ops-drafts');
            return;
        }
        if (!state.canManage || (!state.total && !state.notice)) return;
        const selected = pendingTargets().find(item => targetKey(item) === targetKey(target)) || state.items[0]?.targets[0];
        if (!selected || !window.HomeWelinkThreads?.open) return;
        const opened = await window.HomeWelinkThreads.open({ ...selected, name: selected.name || selected.id });
        if (opened !== true) return;
        window.HomeMode?.set?.('chat', { updateHash: false });
        history.replaceState(history.state, '', `${location.pathname}${location.search}#ops-drafts`);
        render();
        const thread = document.getElementById('dcThread');
        if (panel.isConnected) thread.scrollTop += panel.getBoundingClientRect().top - thread.getBoundingClientRect().top - 12;
    }

    function closeReview() {
        state.reviewing = false;
        panel?.remove();
    }

    function confirmDiscard() {
        const message = L('丢弃后这条草稿不会发送给任何对象，且无法恢复。确定丢弃？', 'This draft will not be sent to anyone and cannot be restored. Discard it?');
        const options = { tone: 'danger', confirmText: L('丢弃', 'Discard'), cancelText: L('取消', 'Cancel') };
        if (window.AppDialog?.confirm) return window.AppDialog.confirm(message, options);
        if (window.showNavbarConfirm) return window.showNavbarConfirm({ message, ...options });
        return Promise.resolve(window.confirm(message));
    }

    async function action(event) {
        const button = event.target.closest('[data-ops-inbox-action]');
        if (!button) return;
        const kind = button.dataset.opsInboxAction;
        if (kind === 'mute') {
            state.muted = state.items.map(item => item.id).join('|');
            try { sessionStorage.setItem(muteKey(), state.muted); } catch { /* 当前页面仍可收起 */ }
            banner.hidden = true;
            syncPriority();
            return;
        }
        if (kind === 'review') return review();
        if (state.busy) return;
        if (kind === 'refresh' || kind === 'next' || kind === 'prev') {
            if (kind !== 'refresh') state.offset = Math.max(0, state.offset + (kind === 'next' ? PAGE_SIZE : -PAGE_SIZE));
            await refresh({ force: true });
            if (kind !== 'refresh' && state.reviewing) document.getElementById('dcThread').scrollTop = 0;
            return;
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
        if (kind !== 'send' && kind !== 'save' && kind !== 'discard') return;
        // 发送不弹第二次确认；卡片已展示完整正文和目标，点击此按钮就是用户确认。丢弃不可恢复，需要二次确认。
        if (identity() !== state.identity) { resetIdentity(); return refresh({ force: true }); }
        if (kind === 'discard' && !await confirmDiscard()) return;
        const content = state.edits.get(id)?.text ?? item.content;
        if (!content.trim()) { setNotice(L('消息内容不能为空', 'Message cannot be empty'), 'error'); renderPanel(); return; }
        const epoch = state.epoch;
        state.busy = id;
        setNotice('');
        renderPanel();
        try {
            const result = kind === 'discard'
                ? await request('POST', `/runs/${encodeURIComponent(id)}/discard`)
                : await request(kind === 'send' ? 'POST' : 'PUT', `/runs/${encodeURIComponent(id)}${kind === 'send' ? '/send' : ''}`, { content, expectedContent: item.content });
            if (epoch !== state.epoch || identity() !== state.identity) return;
            // A save can finish before the follow-up refresh. Keep the confirmed
            // text current so an immediate send uses the new expectedContent.
            if (kind === 'save') item.content = typeof result.content === 'string' ? result.content : content;
            state.edits.delete(id);
            state.editing.delete(id);
            setNotice(kind === 'discard' ? L('草稿已丢弃，不会发送。', 'Draft discarded. It will not be sent.') : kind === 'save' ? L('修改已保存，尚未发送。', 'Draft saved. It has not been sent.') : result.status === 'sent' ? L('消息已发送。', 'Message sent.') : L('发送未全部成功，请到频道对接的推送记录查看详情：', 'Some deliveries failed. Check channel history: ') + (result.error || result.status), kind === 'send' && result.status !== 'sent' ? 'error' : '');
            if (kind === 'send' || kind === 'discard') {
                state.open.delete(id);
                state.items = state.items.filter(entry => entry.id !== id);
                state.total = Math.max(0, state.total - 1);
                window.HomeWelinkThreads?.refresh?.();
            }
            window.dispatchEvent(new Event('tools:ops-drafts-changed'));
            try { localStorage.setItem('tools_ops_drafts_changed', String(Date.now())); } catch { /* 当前页面仍会刷新 */ }
        } catch (error) {
            if (epoch !== state.epoch || identity() !== state.identity) return;
            setNotice(error.message, 'error');
        } finally {
            if (epoch === state.epoch) { state.busy = ''; render(); await refresh({ force: true }); }
        }
    }

    function init() {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = './tp-static/frontend/css/ops-inbox.css';
        document.head.append(css);
        fetch('/api/asset-version?path=%2Fcss%2Fops-inbox.css', { cache: 'no-store' })
            .then(response => response.ok ? response.json() : null)
            .then(data => { if (data?.version) css.href = `./tp-static/frontend/css/ops-inbox.css?v=${encodeURIComponent(data.version)}`; })
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
        panel.dataset.channelThreadAddon = 'ops-drafts';
        const chat = document.getElementById('dragonClaw');
        if (chat) {
            home = document.createElement('button');
            home.type = 'button';
            home.id = 'ops-drafts';
            home.className = 'ops-home-inbox';
            home.hidden = true;
            home.dataset.opsInboxAction = 'review';
            chat.querySelector('.dc-thread').before(home);
        }
        [banner, home, panel].filter(Boolean).forEach(node => node.addEventListener('click', event => { event.stopPropagation(); action(event).catch(error => { setNotice(error.message, 'error'); renderPanel(); }); }));
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
        new MutationObserver(syncPriority).observe(document.body, { attributes: true, attributeFilter: ['class'] });
        state.identity = identity();
        state.muted = readMuted();
        state.activeThread = window.HomeWelinkThreads?.active?.() || null;
        state.threadReady = Boolean(state.activeThread && !document.getElementById('dcThread')?.hasAttribute('aria-busy'));
        refresh({ force: true }).then(() => { if (location.hash === '#ops-drafts') review(); });
        window.addEventListener('home:channel-threads-ready', () => { if (location.hash === '#ops-drafts') review(); });
        window.addEventListener('home:channel-thread', event => {
            const changed = targetKey(state.activeThread) !== targetKey(event.detail.thread);
            const wasReviewing = state.reviewing;
            state.activeThread = event.detail.thread;
            state.threadReady = Boolean(event.detail.ready);
            if (!state.activeThread && location.hash === '#ops-drafts') history.replaceState(history.state, '', `${location.pathname}${location.search}`);
            if (changed || !wasReviewing) render();
            else mountThreadPanel();
        });
        window.addEventListener('hashchange', () => {
            if (location.hash === '#ops-drafts') review();
        });
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
            render();
        });
    }

    window.ToolsOpsInbox = { refresh: () => refresh({ force: true }), open: review };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
