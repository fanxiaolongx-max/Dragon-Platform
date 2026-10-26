(function () {
    'use strict';
    const API = '/api/desktop-agents', names = { codex: 'Codex', claudecode: 'Claude Code', antigravity: 'Antigravity' };
    const state = { settings: null, items: [], providers: [], provider: 'codex', active: null, api: null, visible: false, loading: false, error: '', epoch: 0, viewEpoch: 0, identity: '', drafts: new Map(), notices: new Map(), unknown: new Set(), sending: false, lastSync: null, lastRefreshAt: 0, signature: '', timer: null, detail: null, pending: null, pendingCount: 0, tick: null, view: null, dock: null, mode: (() => { try {
        return localStorage.getItem('desktop_agent_busy_mode') === 'steer' ? 'steer' : 'queue';
    }
    catch {
        return 'queue';
    } })() };
    let root, list, poll;
    let autoSelect = false;
    const L = (zh, en) => /^en/.test(window.ToolsI18n?.getLanguage?.() || localStorage.getItem('tools_lang') || '') ? en : zh;
    const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const identity = () => ['tools_user', 'tools_tenant_id', 'tools_token'].map(k => localStorage.getItem(k) || sessionStorage.getItem(k) || '').join('|');
    const key = s => s.provider + ':' + s.id;
    async function request(method, url, body) { const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token'); const response = await fetch(API + url, { method, credentials: 'same-origin', cache: 'no-store', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const data = await response.json().catch(() => ({})); if (!response.ok)
        throw Object.assign(new Error(data.error || `HTTP ${response.status}`), { status: response.status, code: data.code }); return data; }
    function reset() { clearInterval(state.timer); state.lastRefreshAt = 0; state.epoch++; state.loading = false; state.sending = false; state.settings = null; state.items = []; state.providers = []; state.drafts.clear(); state.notices.clear(); state.unknown.clear(); state.identity = identity(); if (state.active)
        window.DragonClaw?.newChat?.(); state.active = null; state.error = ''; render(); }
    function settings() { window.openNavSettingsModal?.(); window.switchNavSettingsTab?.('desktopAgents'); }
    async function configure() { const epoch = state.epoch; try {
        const data = await request('GET', '/settings');
        if (epoch !== state.epoch || identity() !== state.identity)
            return;
        state.settings = data.owned ? data.settings : null;
        state.lastSync = null;
        state.lastRefreshAt = 0;
        scheduleListRefresh();
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
    function scheduleListRefresh() {
        clearInterval(state.timer);
        state.timer = null;
        if (!state.settings?.enabled || !state.settings.autoSync) return;
        state.timer = setInterval(() => {
            if (identity() !== state.identity) { reset(); configure(); return; }
            if (state.visible && document.visibilityState === 'visible') sync();
        }, state.settings.syncSeconds * 1000);
    }
    async function sync(manual = false) { if (identity() !== state.identity) {
        reset();
        return configure();
    } if (!state.settings?.enabled || state.loading)
        return; if (!manual && state.lastRefreshAt && Date.now() - state.lastRefreshAt < state.settings.syncSeconds * 1000)
        return; const epoch = state.epoch; state.loading = true; renderControls(); try {
        const data = await request(manual ? 'POST' : 'GET', manual ? '/sync' : '/sessions');
        if (epoch !== state.epoch || identity() !== state.identity)
            return;
        state.items = data.items || [];
        state.providers = data.providers || [];
        state.lastSync = data.syncedAt;
        state.lastRefreshAt = Date.now();
        state.error = '';
        if(!state.drafting&&(!state.active||!state.items.some(item=>state.active&&key(item)===key(state.active))))autoSelect=true;
        render();
        openFirst();
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
            scheduleListRefresh();
        }
    } }
    function renderControls() { if (!root)
        return; const header = root.querySelector('.desktop-agents-controls'); header.innerHTML = `<div class="desktop-agent-providers" role="group" aria-label="${L('选择第三方 Agent', 'Select an agent')}">${Object.entries(names).map(([id, name]) => `<button type="button" class="desktop-agent-provider" data-desktop-provider="${id}" aria-pressed="${state.provider === id}" aria-label="${name}" title="${name}"><img src="./tp-static/frontend/assets/desktop-agents/${id}.png" width="24" height="24" alt="" draggable="false"></button>`).join('')}</div><button type="button" data-desktop-sync title="${L('立即重新读取最近对话列表，不必等待自动刷新；对话正文独立更新', 'Reread the recent conversation list now, without waiting. Open conversations update separately.')}" ${state.loading || !state.settings?.enabled ? 'disabled' : ''}>${L(state.loading ? '刷新中…' : '刷新列表', state.loading ? 'Refreshing…' : 'Refresh list')}</button><button type="button" data-desktop-settings title="${L('桌面 Agent 设置', 'Desktop agent settings')}" aria-label="${L('桌面 Agent 设置', 'Desktop agent settings')}">⚙</button>`; const status = state.providers.find(p => p.id === state.provider); root.querySelector('.desktop-agents-status').textContent = state.error || (!state.settings?.enabled ? L('在全局设置连接本机桌面后，最近对话会自动同步。', 'Connect this desktop in global settings to sync recent chats.') : status?.reason || L('正在读取桌面对话…', 'Reading desktop chats…')); }
    function shortTime(value) {
        const date = new Date(value), now = new Date(), pad = n => String(n).padStart(2, '0');
        if (date.toDateString() === now.toDateString())
            return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString())
            return L('昨天', 'Yesterday');
        return date.getFullYear() === now.getFullYear() ? `${date.getMonth() + 1}/${date.getDate()}` : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
    }
    function render() {
        if (!root)
            return;
        renderControls();
        const query = (document.getElementById('homeChatSearch')?.value || '').toLowerCase();
        const config={source:'desktop:'+state.provider,items:state.items,id:s=>s.id,title:s=>s.title,date:s=>s.updatedAt,query,selector:'[data-desktop-session]',index:'desktopIndex'};
        const sections=window.HomeConversationList?.sections(state.items.filter(s=>s.provider===state.provider),{...config,query})||[{label:'',entries:state.items.filter(s=>s.provider===state.provider&&s.title.toLowerCase().includes(query)).map(item=>({item,title:item.title}))}];
        const rows=sections.flatMap(section=>section.entries);
        list.replaceChildren();
        if (!state.settings?.enabled || !rows.length) {
            const empty = document.createElement('div');
            empty.className = 'home-chat-empty';
            empty.textContent = state.settings?.enabled ? L('暂无可读取的最近对话，请打开桌面客户端后同步。', 'No recent chats available. Open the desktop client and sync.') : L('第三方桌面对话尚未连接', 'Desktop chats are not connected');
            list.append(empty);
            window.HomeConversationList?.enhance(list,config);
            return;
        }
        for(const section of sections){
        if(section.entries.length&&section.label){const heading=document.createElement('div');heading.className='home-chat-group';heading.textContent=section.label;list.append(heading);}
        for (const entry of section.entries) {
            const row=entry.item;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'home-chat-item desktop-agent-chat' + (state.active && key(row) === key(state.active) ? ' is-active' : '');
            button.dataset.desktopSession = row.id;
            button.dataset.desktopIndex = state.items.indexOf(row);
            const title = document.createElement('b');
            title.textContent = entry.title;
            button.title = entry.title;
            button.append(title);
            // 时间仅在悬停时显示于右侧，始终保留单行标题。
            if (row.updatedAt) {
                const time = document.createElement('time');
                time.dateTime = row.updatedAt;
                time.textContent = shortTime(row.updatedAt);
                time.title = new Date(row.updatedAt).toLocaleString();
                button.append(time);
            }
            button.addEventListener('click', () => open(row));
            list.append(button);
        }}
        window.HomeConversationList?.enhance(list,config);
    }
    function current(epoch, session) { return epoch === state.viewEpoch && identity() === state.identity && state.active && key(state.active) === key(session); }
    function openFirst() {
        if (!state.visible || !autoSelect || !state.lastSync || state.drafting) return;
        const first=state.items.find(item=>item.provider===state.provider&&!window.HomeConversationList?.get('desktop:'+state.provider,item.id).hidden&&!window.HomeConversationList?.get('desktop:'+state.provider,item.id).archived);
        if (first) { open(first); return; }
        const api=window.DragonClaw?.enterExternal?.({owner:'desktop-agent',onExit:exit});
        if (!api) return;
        autoSelect=false;
        const hint=document.createElement('div');hint.className='home-chat-empty';
        hint.textContent=names[state.provider]+' · '+L('暂无可用对话，请打开客户端后同步。','No available conversations. Open the client and sync.')+' '+(state.providers.find(p=>p.id===state.provider)?.reason||'');
        api.thread.append(hint);api.finishLoading();
    }
    function exit() { state.viewEpoch++; state.drafting = null; clearInterval(poll); poll = null; clearInterval(state.tick); state.tick = null; const body = document.querySelector('[data-wsp-ext-body]'); if (body) {
        body.onclick = null;
        delete body.dataset.signature;
    } if (state.active)
        window.DragonClawWorkspace?.hideExternal?.(); state.active = null; state.api = null; state.signature = ''; state.detail = null; state.pending = null; state.view = null; state.dock?.remove(); state.dock = null; render(); }
    // 复用「我的对话」的输入框：只读、未确认投递时禁用并在占位文字里说明原因
    function busyMode() { return state.mode === 'steer' && state.detail?.canSteer ? 'steer' : 'queue'; }
    function composer(session) { const k = key(session), unknown = state.unknown.has(k), canSend = Boolean(session.canSend) && !unknown, name = names[session.provider], working = state.detail?.busy || state.pending; return { canSend, send, draft: state.drafts.get(k) || '', onInput: value => { if (state.active && key(state.active) === k)
        state.drafts.set(k, value); }, placeholder: unknown ? L('上次提交结果未确认，请先核对桌面原会话；此处不会自动重发', 'Last delivery is unconfirmed. Check the desktop conversation first.') : canSend && working ? (busyMode() === 'steer' ? L(`引导 ${name}：消息并入当前这一轮`, `Steer ${name}: joins the current turn`) : L(`排队：${name} 本轮结束后自动发送`, `Queue: sends when ${name} finishes this turn`)) : canSend ? L('发送到', 'Send to') + ' ' + names[session.provider] + ' · ' + session.title : L(names[session.provider] + ' 桌面会话当前只读', names[session.provider] + ' desktop session is read-only') }; }
    // 「新对话」：在当前选中的桌面 Agent 里新建原生会话。第一条消息发出并确认后打开这个新会话。
    function newChat() {
        if (!state.visible || !state.settings?.enabled)
            return false;
        const provider = state.provider, name = names[provider], status = state.providers.find(p => p.id === provider), canSend = Boolean(status?.canSend);
        let api;
        const create = async text => {
            const epoch = state.viewEpoch, thread = api.thread;
            const pending = api.addMessage('user', text), working = api.addMessage('ai', '');
            working.classList.add('desktop-agent-thinking');
            working.querySelector('.dc-msg-body').remove();
            working.querySelector('.dc-msg-main').insertAdjacentHTML('beforeend', `<div class="dc-activity" role="status"><span class="dc-activity-orbit" aria-hidden="true"><i></i><i></i><i></i></span><span class="dc-activity-text">${esc(L(`正在 ${name} 中新建会话…`, `Creating a ${name} session…`))}</span></div>`);
            api.scrollToBottom();
            try {
                const result = await request('POST', `/${provider}/new`, { text, requestId: crypto.randomUUID() });
                if (epoch !== state.viewEpoch)
                    return true;
                if (result.status !== 'accepted' || !result.id)
                    throw Error(result.error || L('桌面尚未确认新会话，请到桌面核对，不会重发', 'The desktop has not confirmed the new session. Check it there; it will not be resent.'));
                await sync(true);
                if (epoch !== state.viewEpoch)
                    return true;
                const row = state.items.find(item => item.provider === provider && item.id === result.id) || { provider, id: result.id, title: text.slice(0, 40), updatedAt: new Date().toISOString(), source: 'desktop-history' };
                open(row);
                return true;
            }
            catch (error) {
                if (epoch === state.viewEpoch && thread.isConnected) {
                    pending.remove();
                    working.remove();
                    api.toast(error.message);
                }
                return false;
            }
        };
        api = window.DragonClaw?.enterExternal?.({ onExit: exit, owner: 'desktop-agent', composer: { canSend, send: create, placeholder: canSend ? L(`新建 ${name} 会话：输入第一条消息`, `New ${name} session: type the first message`) : L(`${name} 当前不能从网页新建会话`, `${name} can't start sessions from the Web right now`) } });
        if (!api)
            return true;
        state.viewEpoch++;
        state.active = null;
        state.drafting = provider; // 新建草稿期间不触发「自动打开第一条」
        render();
        const banner = document.createElement('div');
        banner.className = 'desktop-agent-banner';
        banner.innerHTML = `<div><b>${esc(L('新建', 'New') + ' ' + name + ' ' + L('会话', 'session'))}</b><small>${esc(canSend ? L('发送第一条消息后，会在桌面上新建这个会话并打开它', 'Sending the first message creates the session on the desktop and opens it here') : (status?.reason || L('当前连接仅支持查看', 'This connection is read-only')))}</small></div><button type="button" data-desktop-back>${esc(L('返回我的对话', 'Back to my chats'))}</button>`;
        banner.querySelector('[data-desktop-back]').addEventListener('click', back);
        api.thread.append(banner);
        api.finishLoading?.();
        document.getElementById('dcInput')?.focus({ preventScroll: true });
        return true;
    }
    async function open(session) {
        const api = window.DragonClaw?.enterExternal?.({ onExit: exit, owner: 'desktop-agent', composer: composer({ ...session, canSend: false }) });
        if (!api)
            return;
        autoSelect=false;
        state.drafting = null;
        state.active = session;
        state.api = api;
        state.signature = '';
        state.detail = null;
        state.pending = null;
        state.view = null;
        const epoch = ++state.viewEpoch;
        state.identity = identity();
        window.HomeMode?.set?.('chat');
        render();
        api.beginLoading();
        await refreshMessages(epoch, session, true);
        schedule(epoch, session);
    }
    function schedule(epoch, session) { if (!current(epoch, session))
        return; clearInterval(poll); poll = setInterval(() => { if (document.visibilityState === 'visible')
        refreshMessages(epoch, session); }, state.detail?.busy || state.pending ? 2500 : 5000); }
    function elapsed(since) { const ms = Math.max(0, Date.now() - Date.parse(since)), m = Math.floor(ms / 60000), sec = Math.floor(ms / 1000) % 60; return m ? L(`${m}分${sec}秒`, `${m}m ${sec}s`) : L(`${sec}秒`, `${sec}s`); }
    function busyText() { const d = state.detail, name = names[state.active.provider]; if (d?.busy)
        return d.busySince ? L(`${name} 正在处理 · ${elapsed(d.busySince)}`, `${name} is working · ${elapsed(d.busySince)}`) : L(`${name} 正在处理…`, `${name} is working…`); return L(`已发送，等待 ${name} 响应…`, `Sent. Waiting for ${name}…`); }
    function tick() { const working = state.detail?.busy || state.pending; document.querySelectorAll('[data-desktop-busy]').forEach(node => { node.textContent = working ? busyText() : ''; }); const status = document.querySelector('[data-desktop-status]'); if (status)
        status.textContent = statusText(); if (!working) {
        clearInterval(state.tick);
        state.tick = null;
    } }
    function statusText() { const d = state.detail; if (!d)
        return L('读取中…', 'Loading…'); if (d.busy || state.pending)
        return busyText(); return state.active.canSend ? L('空闲 · 可发送', 'Idle · ready') : L('只读', 'Read-only'); }
    // 轮询只做增量更新：已显示的消息原地保留，新消息追加（自带淡入），内容有变化的只改正文，避免整屏重绘闪烁
    const sameItem = (a, b) => a && b && a.role === b.role && a.content === b.content && a.createdAt === b.createdAt;
    // 只替换从第一个变化处开始的段落：前面的段落、代码块和选中的文字保持不动
    function morph(target, html) { const next = document.createElement('div'); next.innerHTML = html; const before = [...target.childNodes], after = [...next.childNodes]; let i = 0; while (i < before.length && i < after.length && before[i].isEqualNode(after[i]))
        i++; before.slice(i).forEach(n => n.remove()); target.append(...after.slice(i)); }
    function fillMessage(node, item) { if (item.role !== 'user')
        morph(node.querySelector('.dc-msg-body'), state.api.renderMarkdown(item.content));
    else
        node.querySelector('.dc-msg-body').textContent = item.content; const copy = node.querySelector('[data-dc-copy]'); if (copy)
        copy.dataset.dcCopy = item.content; }
    function thinkingNode() {
        const message = state.api.addMessage('ai', '');
        message.classList.add('desktop-agent-thinking');
        message.setAttribute('aria-busy', 'true');
        message.querySelector('.dc-msg-body').remove();
        const row = document.createElement('div');
        row.className = 'dc-activity';
        row.setAttribute('role', 'status');
        row.innerHTML = '<span class="dc-activity-orbit" aria-hidden="true"><i></i><i></i><i></i></span><span class="dc-activity-text" data-desktop-busy></span>';
        message.querySelector('.dc-msg-main').append(row);
        return message;
    }
    function renderThread(data, initial) {
        const api = state.api, session = state.active, thread = api.thread, near = api.isNearBottom(), items = data.items || [];
        let view = state.view;
        if (initial || !view || !view.banner.isConnected) {
            thread.replaceChildren();
            const banner = document.createElement('div');
            banner.className = 'desktop-agent-banner';
            banner.innerHTML = `<div><b>${esc(names[session.provider])} · ${esc(session.title)}</b><small>${esc(L('原生桌面会话 · 消息发送回同一个 Agent', 'Native desktop session · Replies go to this same agent'))}</small></div><button type="button" data-desktop-back>${esc(L('返回我的对话', 'Back to my chats'))}</button>`;
            banner.querySelector('[data-desktop-back]').addEventListener('click', back);
            thread.append(banner);
            view = state.view = { banner, hint: null, rows: [], thinking: null };
        }
        if (!items.length && !view.hint) {
            view.hint = document.createElement('div');
            view.hint.className = 'home-chat-empty';
            view.banner.after(view.hint);
        }
        if (view.hint) {
            if (items.length) {
                view.hint.remove();
                view.hint = null;
            }
            else
                view.hint.textContent = data.reason || L('这个会话还没有可显示的消息', 'No messages to display');
        }
        // 记录只保留最近 200 条：窗口前移时先去掉已滑出的旧消息
        const shift = items.length ? view.rows.findIndex(row => sameItem(row.item, items[0])) : view.rows.length;
        if (shift > 0)
            view.rows.splice(0, shift).forEach(row => row.node.remove());
        let same = 0;
        while (same < view.rows.length && same < items.length && sameItem(view.rows[same].item, items[same]))
            same++;
        // 正在生成的最后一条只是正文变长：原地更新，不重新插入
        while (same < view.rows.length && same < items.length && view.rows[same].item.role === items[same].role && same >= view.rows.length - 2) {
            fillMessage(view.rows[same].node, items[same]);
            view.rows[same].item = items[same];
            same++;
        }
        view.rows.splice(same).forEach(row => row.node.remove());
        // 插到“正在处理”之前或批量追加到末尾：都不强制滚动，用户往上翻看时不被拉回底部
        const anchor = view.thinking, fresh = [];
        const add = () => { for (const item of items.slice(same)) {
            const node = api.addMessage(item.role === 'user' ? 'user' : 'ai', item.role === 'user' ? item.content : '', anchor ? { before: anchor } : undefined);
            api.addCopy(node, item.content);
            fillMessage(node, item);
            fresh.push({ item, node });
        } };
        anchor ? add() : api.batchMessages(add);
        view.rows.push(...fresh);
        const working = Boolean(data.busy || state.pending);
        if (working && !view.thinking)
            api.batchMessages(() => { view.thinking = thinkingNode(); });
        if (!working && view.thinking) {
            view.thinking.remove();
            view.thinking = null;
        }
        // 同一轮里连续的 Agent 段落合成一组：只保留第一条头像，段落之间紧凑排列
        const nodes = [...view.rows.map(row => row.node), ...(view.thinking ? [view.thinking] : [])];
        nodes.forEach((node, i) => { const ai = node.classList.contains('dc-msg--ai'); node.classList.toggle('desktop-agent-cont', ai && Boolean(nodes[i - 1]?.classList.contains('dc-msg--ai'))); node.classList.toggle('is-continued', ai && Boolean(nodes[i + 1]?.classList.contains('dc-msg--ai'))); });
        if (initial || (near && (fresh.length || working)))
            api.scrollToBottom();
    }
    // 输入框上方的运行中条：选择排队或引导，并列出排队中的消息（可取消）
    function renderDock() {
        const session = state.active, d = state.detail;
        if (!session || !d)
            return;
        const working = Boolean(d.busy || state.pending), queue = d.queue || [], showMode = working && session.canSend;
        if (!showMode && !queue.length) {
            state.dock?.remove();
            state.dock = null;
            return;
        }
        if (!state.dock) {
            state.dock = document.createElement('div');
            state.dock.className = 'desktop-agent-dock';
            state.dock.addEventListener('click', e => {
                const mode = e.target.closest('[data-desktop-mode]')?.dataset.desktopMode;
                if (mode) {
                    state.mode = mode;
                    try {
                        localStorage.setItem('desktop_agent_busy_mode', mode);
                    }
                    catch { }
                    renderDock();
                    state.api?.setComposer(composer(state.active));
                }
                const cancel = e.target.closest('[data-desktop-cancel]')?.dataset.desktopCancel;
                if (cancel && state.active)
                    cancelQueued(state.active, cancel);
            });
            document.getElementById('dcComposer')?.before(state.dock);
        }
        const mode = busyMode(), label = { queued: L('排队中', 'Queued'), sending: L('投递中', 'Sending'), failed: L('未发送', 'Not sent') };
        const signature = JSON.stringify([showMode, mode, d.canSteer, queue, L('zh', 'en')]);
        if (state.dock.dataset.signature === signature)
            return;
        state.dock.dataset.signature = signature;
        state.dock.innerHTML = `${showMode ? `<div class="desktop-agent-mode"><span>${esc(L(names[session.provider] + ' 运行中，新消息：', names[session.provider] + ' is running. New messages:'))}</span><div role="group"><button type="button" data-desktop-mode="queue" aria-pressed="${mode === 'queue'}" title="${esc(L('本轮结束后自动发送', 'Sent when this turn finishes'))}">${esc(L('排队', 'Queue'))}</button>${d.canSteer ? `<button type="button" data-desktop-mode="steer" aria-pressed="${mode === 'steer'}" title="${esc(L('并入当前这一轮，Agent 会马上看到', 'Joins the running turn right away'))}">${esc(L('引导', 'Steer'))}</button>` : ''}</div></div>` : ''}${queue.map(item => `<div class="desktop-agent-queued" data-status="${esc(item.status)}"><i>${esc(label[item.status] || '')}</i><span>${esc(item.text)}</span>${item.error ? `<small>${esc(item.error)}</small>` : ''}${item.status !== 'sending' ? `<button type="button" data-desktop-cancel="${esc(item.requestId)}">${esc(item.status === 'failed' ? L('移除', 'Remove') : L('取消', 'Cancel'))}</button>` : ''}</div>`).join('')}`;
    }
    async function cancelQueued(session, requestId) { try {
        const data = await request('DELETE', `/${session.provider}/sessions/${encodeURIComponent(session.id)}/queue/${encodeURIComponent(requestId)}`);
        if (state.active && key(state.active) === key(session) && state.detail) {
            state.detail.queue = data.queue;
            renderDock();
        }
    }
    catch (error) {
        state.api?.toast(error.message);
    } }
    function renderWorkspace(first) {
        const session = state.active, d = state.detail;
        if (!session || !d)
            return;
        const body = window.DragonClawWorkspace?.showExternal?.({ title: L('Agent 会话', 'Agent session'), meta: names[session.provider], open: first ? undefined : false });
        if (!body)
            return;
        const updated = d.items?.at(-1)?.createdAt || session.updatedAt, signature = JSON.stringify([session.id, session.canSend, state.unknown.has(key(session)), d.reason, d.stale, d.items?.length, updated, Boolean(d.busy || state.pending), L('zh', 'en')]);
        if (!first && body.dataset.signature === signature)
            return;
        body.dataset.signature = signature;
        const facts = [[L('会话', 'Session'), session.title], [L('状态', 'Status'), statusText(), 'status'], [L('发送', 'Sending'), session.canSend && !state.unknown.has(key(session)) ? L('输入框消息直接投递到这个原生会话', 'The composer delivers to this native session') : (d.reason || L('当前连接仅支持查看', 'This connection is read-only'))], d.stale && [L('同步', 'Sync'), L('桌面当前在其他会话，正文暂停更新；运行状态照常显示', 'The desktop shows another chat; text updates pause, status still updates')], [L('消息', 'Messages'), L(`${d.items?.length || 0} 条`, `${d.items?.length || 0}`)], updated && [L('最近活动', 'Last activity'), new Date(updated).toLocaleString()], [L('会话 ID', 'Session ID'), session.id]].filter(Boolean);
        body.innerHTML = `<dl class="desktop-agent-facts">${facts.map(([k, v, tag]) => `<div><dt>${esc(k)}</dt><dd${tag ? ` data-desktop-${tag}` : ''}>${esc(v)}</dd></div>`).join('')}</dl><div class="desktop-agent-ws-actions"><button type="button" data-desktop-refresh>${esc(L('刷新', 'Refresh'))}</button><button type="button" data-desktop-settings>${esc(L('连接设置', 'Connection settings'))}</button><button type="button" data-desktop-back>${esc(L('返回我的对话', 'Back to my chats'))}</button></div>`;
        body.onclick = e => { if (e.target.closest('[data-desktop-back]'))
            back(); if (e.target.closest('[data-desktop-settings]'))
            settings(); if (e.target.closest('[data-desktop-refresh]') && state.active)
            refreshMessages(state.viewEpoch, state.active); };
    }
    function back() { window.DragonClaw?.newChat?.(); window.HomeWelinkThreads?.setSource?.('mine'); }
    async function refreshMessages(epoch, session, initial = false) {
        try {
            // 轮询只被动读取：Antigravity 桌面在别的会话时不切换它，正文保持上次内容
            const data = await request('GET', `/${session.provider}/sessions/${encodeURIComponent(session.id)}/messages${initial ? '' : '?passive=1'}`);
            if (!current(epoch, session))
                return;
            if (data.stale)
                data.items = state.detail?.items || [];
            // 发送后到 Agent 开始处理之间日志可能还没更新：先保持“已发送”状态，最多等一分钟
            if (state.pending && (data.busy || Date.now() - state.pending > 60000 || (data.items || []).length > state.pendingCount))
                state.pending = null;
            const wasBusy = state.detail?.busy;
            state.detail = data;
            state.active = { ...state.active, canSend: data.canSend };
            const signature = JSON.stringify([data.items || [], Boolean(data.busy || state.pending)]);
            if (signature !== state.signature || initial) {
                renderThread(data, initial);
                state.signature = signature;
            }
            state.api.setComposer(composer(state.active));
            renderDock();
            renderWorkspace(initial);
            if ((data.busy || state.pending) && !state.tick)
                state.tick = setInterval(tick, 1000);
            tick();
            if (!initial && Boolean(wasBusy) !== Boolean(data.busy))
                schedule(epoch, session);
            if (initial) // 淡入只在首次打开时做；轮询时做会让整个消息区每隔几秒闪一下
                state.api.finishLoading();
        }
        catch (error) {
            if (current(epoch, session)) {
                if (initial)
                    state.api.finishLoading();
                state.api.toast(error.message);
            }
        }
    }
    async function send(text) { const session = state.active; if (!session || !session.canSend || state.sending || state.unknown.has(key(session)))
        return false; const epoch = state.viewEpoch, account = state.identity, mode = state.detail?.busy || state.pending ? busyMode() : 'send'; state.sending = true; try {
        const result = await request('POST', `/${session.provider}/sessions/${encodeURIComponent(session.id)}/messages`, { text, requestId: crypto.randomUUID(), mode });
        if (account !== state.identity || account !== identity())
            return false;
        if (result.status === 'queued') {
            if ((state.drafts.get(key(session)) || '').trim() === text)
                state.drafts.delete(key(session));
            if (current(epoch, session) && state.detail) {
                state.detail.queue = result.queue;
                renderDock();
            }
            return true;
        }
        if (result.status !== 'accepted') {
            if (['sending', 'unknown'].includes(result.status))
                state.unknown.add(key(session));
            throw Error(result.error || L('桌面尚未确认接收', 'Desktop has not acknowledged delivery'));
        }
        if ((state.drafts.get(key(session)) || '').trim() === text)
            state.drafts.delete(key(session));
        if (!current(epoch, session))
            return true;
        state.pending = Date.now();
        state.pendingCount = (state.detail?.items || []).length;
        await refreshMessages(epoch, session);
        schedule(epoch, session);
        return true;
    }
    catch (error) {
        if (account === state.identity && account === identity() && error.status === 504)
            state.unknown.add(key(session));
        if (current(epoch, session)) {
            state.api.setComposer(composer(state.active));
            state.api.toast(error.message);
        }
        throw error;
    }
    finally {
        state.sending = false;
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
        root.addEventListener('click', e => { const provider=e.target.closest('[data-desktop-provider]');
            if(provider&&provider.dataset.desktopProvider!==state.provider){
                window.HomeConversationList?.close();
                state.provider=provider.dataset.desktopProvider;
                render();autoSelect=true;openFirst();
                root.querySelector(`[data-desktop-provider="${state.provider}"]`)?.focus({preventScroll:true});
            }
            if (e.target.closest('[data-desktop-sync]'))
            sync(true); if (e.target.closest('[data-desktop-settings]'))
            settings(); });
        configure();
        window.addEventListener('tools:desktop-agent-settings-changed', configure);
        window.addEventListener('home:conversation-list-changed',()=>render());
        window.addEventListener('tools:languagechange', () => { render(); if (state.active)
            refreshMessages(state.viewEpoch, state.active, true); });
        window.addEventListener('storage', e => { if (['tools_user', 'tools_tenant_id', 'tools_token'].includes(e.key))
            reset(); });
        window.addEventListener('pagehide', () => { clearInterval(poll); clearInterval(state.timer); clearInterval(state.tick); });
        window.dispatchEvent(new Event('home:desktop-agents-ready'));
    }
    window.HomeDesktopAgents = { available: () => localStorage.getItem('tools_role') === 'admin', show: visible => { if(visible&&!state.visible)autoSelect=true;state.visible = visible; if (root)
            root.hidden = !visible; if (visible && state.settings?.enabled)
            {openFirst();sync();} }, search: render, refresh: () => sync(true), open, newChat };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init, { once: true });
    else
        init();
})();
