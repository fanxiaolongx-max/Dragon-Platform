(function () {
    'use strict';
    const API = '/api/desktop-agents', names = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity' };
    const state = { settings: null, items: [], providers: [], provider: 'codex', active: null, api: null, visible: false, loading: false, error: '', epoch: 0, viewEpoch: 0, identity: '', drafts: new Map(), notices: new Map(), unknown: new Set(), sending: false, lastSync: null, signature: '', timer: null };
    let root, list, form, poll;
    const L = (zh, en) => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const identity = () => ['tools_user', 'tools_tenant_id', 'tools_token'].map(k => localStorage.getItem(k) || sessionStorage.getItem(k) || '').join('|');
    const key = s => s.provider + ':' + s.id;
    async function request(method, url, body) { const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token'); const response = await fetch(API + url, { method, credentials: 'same-origin', cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json().catch(() => ({})); if (!response.ok)
        throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, code: data.code }); return data; }
    function reset() { state.epoch++; state.loading = false; state.sending = false; state.settings = null; state.items = []; state.providers = []; state.drafts.clear(); state.notices.clear(); state.unknown.clear(); state.identity = identity(); if (state.active)
        window.DragonClaw?.newChat?.(); state.active = null; state.error = ''; render(); }
    function settings() { window.openNavSettingsModal?.(); window.switchNavSettingsTab?.('desktopAgents'); }
    async function configure() { const epoch = state.epoch; try {
        const data = await request('GET', '/settings');
        if (epoch !== state.epoch || identity() !== state.identity)
            return;
        state.settings = data.owned ? data.settings : null;
        state.lastSync = null;
        if (!state.settings?.enabled && state.active) {
            state.drafts.clear();
            window.DragonClaw?.newChat?.();
        }
        state.error = data.owned ? '' : data.reason;
        window.dispatchEvent(new Event('home:desktop-agents-ready'));
        render();
        if (state.settings?.enabled)
            await sync();
    }
    catch (error) {
        if (epoch === state.epoch) {
            state.error = error.message;
            render();
        }
    } }
    async function sync(manual = false) { if (identity() !== state.identity) {
        reset();
        return configure();
    } if (!state.settings?.enabled || state.loading)
        return; if (!manual && state.lastSync && Date.now() - Date.parse(state.lastSync) < state.settings.syncSeconds * 1000)
        return; const epoch = state.epoch; state.loading = true; renderControls(); try {
        const data = await request(manual ? 'POST' : 'GET', manual ? '/sync' : '/sessions');
        if (epoch !== state.epoch || identity() !== state.identity)
            return;
        state.items = data.items || [];
        state.providers = data.providers || [];
        state.lastSync = data.syncedAt;
        state.error = '';
        render();
    }
    catch (error) {
        if (epoch === state.epoch) {
            state.error = error.message;
            renderControls();
        }
    }
    finally {
        if (epoch === state.epoch) {
            state.loading = false;
            renderControls();
        }
    } }
    function renderControls() { if (!root)
        return; const header = root.querySelector('.desktop-agents-controls'); header.innerHTML = `<label class="desktop-agent-select"><span>${L('桌面 Agent', 'Desktop agent')}</span><select data-desktop-provider aria-label="${L('选择第三方 Agent', 'Select an agent')}">${Object.entries(names).map(([id, name]) => `<option value="${id}" ${state.provider === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label><button type="button" data-desktop-sync ${state.loading || !state.settings?.enabled ? 'disabled' : ''}>${L(state.loading ? '同步中…' : '同步', 'Sync')}</button><button type="button" data-desktop-settings aria-label="${L('桌面 Agent 设置', 'Desktop agent settings')}">⚙</button>`; const status = state.providers.find(p => p.id === state.provider); root.querySelector('.desktop-agents-status').textContent = state.error || (!state.settings?.enabled ? L('在全局设置连接本机桌面后，最近对话会自动同步。', 'Connect this desktop in global settings to sync recent chats.') : status?.reason || L('正在读取桌面对话…', 'Reading desktop chats…')); }
    function render() {
        if (!root)
            return;
        renderControls();
        const query = (document.getElementById('homeChatSearch')?.value || '').toLowerCase();
        const rows = state.items.filter(s => s.provider === state.provider && s.title.toLowerCase().includes(query));
        list.replaceChildren();
        if (!state.settings?.enabled || !rows.length) {
            const empty = document.createElement('div');
            empty.className = 'home-chat-empty';
            empty.textContent = state.settings?.enabled ? L('暂无可读取的最近对话，请打开桌面客户端后同步。', 'No recent chats available. Open the desktop client and sync.') : L('第三方桌面对话尚未连接', 'Desktop chats are not connected');
            list.append(empty);
            return;
        }
        for (const row of rows) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'home-chat-item desktop-agent-chat' + (state.active && key(row) === key(state.active) ? ' is-active' : '');
            button.dataset.desktopSession = row.id;
            const title = document.createElement('b');
            title.textContent = row.title;
            const meta = document.createElement('small');
            meta.textContent = names[row.provider] + (row.updatedAt ? ' · ' + new Date(row.updatedAt).toLocaleString() : ' · ' + L('按桌面侧栏顺序', 'Desktop sidebar order'));
            button.append(title, meta);
            button.addEventListener('click', () => open(row));
            list.append(button);
        }
    }
    function current(epoch, session) { return epoch === state.viewEpoch && identity() === state.identity && state.active && key(state.active) === key(session); }
    function exit() { state.viewEpoch++; clearInterval(poll); poll = null; state.active = null; state.api = null; state.signature = ''; form?.remove(); form = null; render(); }
    async function open(session) {
        const api = window.DragonClaw?.enterExternal?.({ onExit: exit });
        if (!api)
            return;
        state.active = session;
        state.api = api;
        state.signature = '';
        const epoch = ++state.viewEpoch;
        state.identity = identity();
        window.HomeMode?.set?.('chat');
        render();
        renderComposer();
        api.beginLoading();
        await refreshMessages(epoch, session, true);
        if (current(epoch, session)) {
            clearInterval(poll);
            poll = setInterval(() => { if (document.visibilityState === 'visible')
                refreshMessages(epoch, session); }, 4000);
        }
    }
    async function refreshMessages(epoch, session, initial = false) {
        try {
            const data = await request('GET', `/${session.provider}/sessions/${encodeURIComponent(session.id)}/messages`);
            if (!current(epoch, session))
                return;
            const signature = JSON.stringify(data.items || []);
            if (signature !== state.signature || initial) {
                const api = state.api, thread = api.thread, top = thread.scrollTop, near = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 90;
                thread.replaceChildren();
                const banner = document.createElement('div');
                banner.className = 'desktop-agent-banner';
                banner.innerHTML = `<b>${esc(names[session.provider])} · ${esc(session.title)}</b><small>${esc(L('原生桌面会话 · 消息发送回同一个 Agent', 'Native desktop session · Replies go to this same agent'))}</small>`;
                thread.append(banner);
                if (!data.items?.length) {
                    const hint = document.createElement('div');
                    hint.className = 'home-chat-empty';
                    hint.textContent = data.reason || L('这个会话还没有可显示的消息', 'No messages to display');
                    thread.append(hint);
                }
                api.batchMessages(() => { for (const item of data.items || []) {
                    const message = api.addMessage(item.role === 'user' ? 'user' : 'ai', item.role === 'user' ? item.content : '');
                    if (item.role !== 'user')
                        message.querySelector('.dc-msg-body').innerHTML = api.renderMarkdown(item.content);
                    api.addCopy(message, item.content);
                } });
                if (initial || near)
                    api.scrollToBottom();
                else
                    thread.scrollTop = top;
                state.signature = signature;
            }
            state.active = { ...state.active, canSend: data.canSend };
            renderComposer();
            state.api.finishLoading();
        }
        catch (error) {
            if (current(epoch, session)) {
                state.api.finishLoading();
                setNotice(error.message, true);
            }
        }
    }
    function renderComposer() {
        if (!state.active)
            return;
        if (!form) {
            form = document.createElement('section');
            form.className = 'desktop-agent-composer';
            document.getElementById('dcComposer')?.after(form);
            form.addEventListener('input', e => { if (e.target.matches('textarea')) {
                state.drafts.set(key(state.active), e.target.value);
                const button = form.querySelector('[data-desktop-send]');
                if (button)
                    button.disabled = state.sending || !e.target.value.trim();
            } });
            form.addEventListener('submit', e => { e.preventDefault(); send(); });
            form.addEventListener('keydown', e => { if (e.target.matches('textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                send();
            } });
            form.addEventListener('click', e => { if (e.target.closest('[data-desktop-back]')) {
                window.DragonClaw?.newChat?.();
                window.HomeWelinkThreads?.setSource?.('mine');
            } if (e.target.closest('[data-desktop-settings]'))
                settings(); });
        }
        const session = state.active, k = key(session), draft = state.drafts.get(k) || '', unknown = state.unknown.has(k), focused = form.contains(document.activeElement);
        if (focused && form.dataset.session === k) {
            const input = form.querySelector('textarea');
            if (input) {
                input.disabled = state.sending;
                if (input.value !== draft)
                    input.value = draft;
            }
            const button = form.querySelector('[data-desktop-send]');
            if (button)
                button.disabled = state.sending || !draft.trim() || unknown;
            return;
        }
        form.dataset.session = k;
        form.innerHTML = `<header><span>${esc(names[session.provider])} · ${esc(session.title)}</span><button type="button" data-desktop-back>${L('返回我的对话', 'Back to my chats')}</button></header>${session.canSend && !unknown ? `<form><textarea rows="3" maxlength="20000" aria-label="${esc(L('回复到原生桌面会话', 'Reply to the native desktop session'))}" placeholder="${esc(L('发送到', 'Send to') + ' ' + names[session.provider])}" ${state.sending ? 'disabled' : ''}>${esc(draft)}</textarea><div class="desktop-agent-send"><small>${L('Enter 发送 · Shift + Enter 换行', 'Enter sends · Shift + Enter for newline')}</small><button data-desktop-send ${state.sending || !draft.trim() ? 'disabled' : ''}>${esc(state.sending ? L('正在提交…', 'Submitting…') : L('发送到', 'Send to') + ' ' + names[session.provider])}</button></div></form>` : `<p>${esc(unknown ? L('上次提交结果未确认。请先核对桌面原会话；此处不会自动重发。', 'Last delivery is unconfirmed. Check the desktop conversation; it will not be resent automatically.') : L('当前连接仅支持查看。请检查桌面客户端、连接器权限和发送设置。', 'This connection is read-only. Check the desktop client, connector permissions and send setting.'))} <button type="button" data-desktop-settings>${L('检查设置', 'Check settings')}</button></p>`}<div class="desktop-agent-notice${state.notices.get(k)?.error ? ' is-error' : ''}" role="status">${esc(state.notices.get(k)?.text || '')}</div>`;
    }
    function setNotice(text, error = false) { if (state.active)
        state.notices.set(key(state.active), { text, error }); if (!form)
        return; const node = form.querySelector('.desktop-agent-notice'); node.textContent = text; node.classList.toggle('is-error', error); }
    async function send() { const session = state.active; if (!session || !session.canSend || state.sending || state.unknown.has(key(session)))
        return; const text = state.drafts.get(key(session)) || ''; if (!text.trim())
        return; const epoch = state.viewEpoch, account = state.identity; state.sending = true; renderComposer(); try {
        const result = await request('POST', `/${session.provider}/sessions/${encodeURIComponent(session.id)}/messages`, { text, requestId: crypto.randomUUID() });
        if (account !== state.identity || account !== identity())
            return;
        if (result.status !== 'accepted') {
            if (['sending', 'unknown'].includes(result.status))
                state.unknown.add(key(session));
            throw Error(result.error || L('桌面尚未确认接收', 'Desktop has not acknowledged delivery'));
        }
        if (state.drafts.get(key(session)) === text)
            state.drafts.delete(key(session));
        if (!current(epoch, session))
            return;
        setNotice(L('已交给原生桌面会话，等待 Agent 回复…', 'Accepted by the native session. Waiting for the agent…'));
        await refreshMessages(epoch, session);
    }
    catch (error) {
        if (account === state.identity && account === identity() && error.status === 504)
            state.unknown.add(key(session));
        if (current(epoch, session)) {
            renderComposer();
            setNotice(error.message, true);
        }
    }
    finally {
        if (account === state.identity && account === identity()) {
            state.sending = false;
            if (state.active)
                renderComposer();
        }
    } }
    function init() {
        if (localStorage.getItem('tools_role') !== 'admin')
            return;
        const mine = document.getElementById('homeChatList');
        if (!mine)
            return;
        state.identity = identity();
        root = document.createElement('section');
        root.className = 'desktop-agents-sidebar';
        root.hidden = !state.visible;
        root.innerHTML = '<div class="desktop-agents-controls"></div><div class="desktop-agents-status" role="status"></div><div class="home-chat-list desktop-agent-list"></div>';
        list = root.querySelector('.desktop-agent-list');
        mine.after(root);
        root.addEventListener('change', e => { if (e.target.matches('[data-desktop-provider]')) {
            state.provider = e.target.value;
            render();
        } });
        root.addEventListener('click', e => { if (e.target.closest('[data-desktop-sync]'))
            sync(true); if (e.target.closest('[data-desktop-settings]'))
            settings(); });
        configure();
        window.addEventListener('tools:desktop-agent-settings-changed', configure);
        window.addEventListener('tools:languagechange', () => { render(); renderComposer(); if (state.active)
            refreshMessages(state.viewEpoch, state.active, true); });
        window.addEventListener('storage', e => { if (['tools_user', 'tools_tenant_id', 'tools_token'].includes(e.key))
            reset(); });
        state.timer = setInterval(() => { if (identity() !== state.identity)
            return reset(); if (state.settings?.autoSync && document.visibilityState === 'visible')
            sync(); }, 10000);
        window.addEventListener('pagehide', () => { clearInterval(poll); clearInterval(state.timer); });
        window.dispatchEvent(new Event('home:desktop-agents-ready'));
    }
    window.HomeDesktopAgents = { available: () => localStorage.getItem('tools_role') === 'admin', show: visible => { state.visible = visible; if (root)
            root.hidden = !visible; if (visible && state.settings?.enabled)
            sync(); }, search: render, refresh: () => sync(true), open };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init, { once: true });
    else
        init();
})();
