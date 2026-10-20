// 首页对话侧栏的「WeLink」分类：按群/人合并的频道对话历史（只读）、对话上方的任务进度条，
// 以及右侧工作区的「跟进与记忆」卡片（任务、提醒人、频率、下次提醒、跟进记录、关闭情况）。
// - 对话区借用 Dragon Claw 的渲染（window.DragonClaw.enterExternal），新对话 / 打开个人历史时自动退出；
// - 右侧卡片借用工作区面板（window.DragonClawWorkspace.showExternal），工作区未启用时也可显示；
// - 查看对所有登录用户开放；完成、暂停、立即提醒等操作仅管理员（接口 canManage）。
(function () {
    'use strict';

    const API = '/api/channels/welink';
    const SOURCE_KEY = 'home_chat_source';
    const PAGE_SIZE = 40;
    const REFRESH_MS = 20000;

    const TEXT = {
        'zh-CN': {
            mine: '我的对话', welink: 'WeLink', group: '群聊', person: '单聊', loading: '正在加载…', empty: '还没有 WeLink 对话', noMatch: '没有匹配的 WeLink 对话',
            loadFailed: '加载失败', retry: '重试', openTasks: '{n} 项跟进中', allDone: '跟进已完成', segments: '{n} 段对话', messages: '{n} 条消息',
            readonly: '只读 · 这是 WeLink {kind}「{name}」的对话记录，在 WeLink 里 @助手 即可继续对话。', back: '返回我的对话',
            banner: 'WeLink {kind} · {name}', start: '对话开始', newContext: '新的对话上下文', newContextHint: '之前的内容不再作为上下文', loadMore: '加载更早的消息', noMessages: '这个会话还没有对话记录',
            followTitle: '跟进与记忆', followMeta: '{n} 跟进中', noTasks: '该对话还没有跟进任务。在 WeLink 里对助手说「帮我记一下，后边跟进…」即可创建。',
            stageStart: '开始', stageActive: '进行', stageEnd: '结束', cancelledEnd: '已取消', details: '跟进详情',
            status_open: '跟进中', status_paused: '已暂停', status_done: '已完成', status_cancelled: '已取消',
            urgency_low: '低', urgency_normal: '普通', urgency_high: '高', urgency_urgent: '紧急',
            remindWho: '提醒', everyone: '群内相关人', frequency: '频率', urgency: '紧急度', nextRemind: '下次提醒', nextNote: '跟进内容', reminded: '已提醒 {n} 次', lastReminded: '上次 {time}',
            progress: '最新进展', noProgress: '暂无更新', closed: '关闭', closedBy: '{time} · {who}', due: '截止', creator: '提出人', detail: '任务详情', timeline: '跟进记录',
            done: '完成', pause: '暂停', resume: '恢复', reopen: '重新打开', cancel: '取消任务', remindNow: '立即提醒', confirmRemind: '立即在 WeLink 中发送一次提醒？', confirmRemindTitle: '立即提醒',
            confirmClose: '确认将「{title}」标记为{action}？', actionFailed: '操作失败：{error}', updated: '已更新', timezone: '时间为 {zone} 时间',
            event_created: '创建任务', event_updated: '修改任务', event_progress: '进展', event_reminded: '发送提醒', event_remind_failed: '提醒发送失败', event_paused: '暂停提醒', event_resumed: '恢复提醒',
            event_done: '完成', event_cancelled: '取消', event_reopened: '重新打开', event_limit: '达到提醒上限', chip_created: '已记录跟进任务', chip_exists: '任务已存在', chip_updated: '更新了跟进任务', chip_progress: '记录了进展', chip_done: '完成了跟进任务', chip_cancelled: '取消了跟进任务',
            prevTask: '上一个任务', nextTask: '下一个任务', system: '系统'
        },
        'en-US': {
            mine: 'My chats', welink: 'WeLink', group: 'Group', person: 'Direct', loading: 'Loading…', empty: 'No WeLink conversations yet', noMatch: 'No matching WeLink conversations',
            loadFailed: 'Could not load', retry: 'Retry', openTasks: '{n} in follow-up', allDone: 'Follow-ups done', segments: '{n} contexts', messages: '{n} messages',
            readonly: 'Read only · WeLink {kind} "{name}". @mention the assistant in WeLink to continue.', back: 'Back to my chats',
            banner: 'WeLink {kind} · {name}', start: 'Conversation start', newContext: 'New conversation context', newContextHint: 'Earlier messages are no longer in context', loadMore: 'Load earlier messages', noMessages: 'No messages in this conversation yet',
            followTitle: 'Follow-ups & memory', followMeta: '{n} open', noTasks: 'No follow-up tasks yet. Ask the assistant in WeLink to "note this and follow up…".',
            stageStart: 'Start', stageActive: 'In progress', stageEnd: 'Done', cancelledEnd: 'Cancelled', details: 'Details',
            status_open: 'Open', status_paused: 'Paused', status_done: 'Done', status_cancelled: 'Cancelled',
            urgency_low: 'Low', urgency_normal: 'Normal', urgency_high: 'High', urgency_urgent: 'Urgent',
            remindWho: 'Remind', everyone: 'Group members', frequency: 'Frequency', urgency: 'Urgency', nextRemind: 'Next reminder', nextNote: 'Ask about', reminded: 'Reminded {n}×', lastReminded: 'last {time}',
            progress: 'Latest progress', noProgress: 'No update yet', closed: 'Closed', closedBy: '{time} · {who}', due: 'Due', creator: 'Raised by', detail: 'Task details', timeline: 'Follow-up log',
            done: 'Done', pause: 'Pause', resume: 'Resume', reopen: 'Reopen', cancel: 'Cancel task', remindNow: 'Remind now', confirmRemind: 'Send a reminder in WeLink now?', confirmRemindTitle: 'Remind now',
            confirmClose: 'Mark "{title}" as {action}?', actionFailed: 'Failed: {error}', updated: 'Updated', timezone: 'Times shown in {zone}',
            event_created: 'Created', event_updated: 'Edited', event_progress: 'Progress', event_reminded: 'Reminder sent', event_remind_failed: 'Reminder failed', event_paused: 'Paused', event_resumed: 'Resumed',
            event_done: 'Done', event_cancelled: 'Cancelled', event_reopened: 'Reopened', event_limit: 'Reminder limit reached', chip_created: 'Follow-up recorded', chip_exists: 'Task already exists', chip_updated: 'Follow-up updated', chip_progress: 'Progress recorded', chip_done: 'Follow-up completed', chip_cancelled: 'Follow-up cancelled',
            prevTask: 'Previous task', nextTask: 'Next task', system: 'System'
        }
    };

    const state = {
        source: 'mine',
        threads: [],
        loaded: false,
        failed: false,
        seq: 0,
        active: null, // { kind, id, name }
        items: [],
        segments: [],
        hasMore: false,
        loadingMore: false,
        tasks: [],
        calendar: null,
        canManage: false,
        focus: 0,
        api: null,
        refreshTimer: null,
        listTimer: null,
        openSeq: 0,
        highlight: ''
    };
    const el = {};

    function lang() {
        return window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN';
    }

    function tx(key, params = {}) {
        const template = TEXT[lang()][key] ?? TEXT['zh-CN'][key] ?? key;
        return Object.keys(params).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), template);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }

    function authHeaders() {
        if (typeof window.getAuthHeaderForNav === 'function') return window.getAuthHeaderForNav();
        const token = localStorage.getItem('tools_token') || sessionStorage.getItem('tools_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    async function request(method, url, body) {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body === undefined ? undefined : JSON.stringify(body) });
        let data = {};
        try { data = await res.json(); } catch { data = {}; }
        if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
        return data;
    }

    function toast(text) {
        if (window.DragonClawText?.toast) window.DragonClawText.toast(text);
        else window.showToast?.(text);
    }

    async function confirmDialog(options) {
        if (typeof window.showNavbarConfirm === 'function') return window.showNavbarConfirm(options);
        return window.confirm(options.message);
    }

    function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
    function storeSet(key, value) { try { localStorage.setItem(key, value); } catch { /* 隐私模式 */ } }

    function kindText(kind) {
        return tx(kind === 'group' ? 'group' : 'person');
    }

    // 任务相关时间按工作日历的时区（默认开罗）显示，与提醒实际发送时间一致
    function formatTime(value, withWeekday = false) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const options = { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, ...(withWeekday ? { weekday: 'short' } : {}) };
        try {
            return date.toLocaleString(lang(), { ...options, timeZone: state.calendar?.timezone || undefined });
        } catch {
            return date.toLocaleString(lang(), options);
        }
    }

    function shortTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const sameDay = new Date().toDateString() === date.toDateString();
        return sameDay ? date.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit', hour12: false }) : date.toLocaleDateString(lang(), { month: 'short', day: 'numeric' });
    }

    const ICONS = {
        group: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="11.2" cy="6.6" r="1.8" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 13c.4-2.3 2-3.6 4-3.6s3.6 1.3 4 3.6M10.4 9.6c1.7 0 3 1.1 3.4 3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        user: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.8" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M3 13.4c.5-2.6 2.5-4 5-4s4.5 1.4 5 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
    };

    // ── 侧栏：我的对话 / WeLink 切换 ─────────────────────
    function mountTabs() {
        el.chatList = document.getElementById('homeChatList');
        el.search = document.getElementById('homeChatSearch');
        if (!el.chatList || el.tabs) return false;
        el.tabs = document.createElement('div');
        el.tabs.className = 'home-chat-tabs';
        el.tabs.setAttribute('role', 'tablist');
        el.tabs.innerHTML = `<button type="button" role="tab" data-chat-source="mine"></button><button type="button" role="tab" data-chat-source="welink"></button><i class="home-chat-tabs-ink" aria-hidden="true"></i>`;
        el.chatList.before(el.tabs);
        el.list = document.createElement('div');
        el.list.className = 'home-chat-list wl-list';
        el.list.id = 'homeWelinkList';
        el.list.setAttribute('role', 'list');
        el.list.hidden = true;
        el.chatList.after(el.list);
        el.tabs.addEventListener('click', event => {
            const button = event.target.closest('[data-chat-source]');
            if (button) setSource(button.dataset.chatSource);
        });
        el.list.addEventListener('click', event => {
            if (event.target.closest('[data-wl-retry]')) return loadThreads();
            const item = event.target.closest('[data-wl-thread]');
            if (item) openThread(state.threads[Number(item.dataset.wlThread)]);
        });
        el.search?.addEventListener('input', () => {
            if (state.source !== 'welink') return;
            clearTimeout(state.listTimer);
            state.listTimer = setTimeout(loadThreads, 220);
        });
        return true;
    }

    function renderTabs() {
        if (!el.tabs) return;
        el.tabs.querySelectorAll('[data-chat-source]').forEach(button => {
            const selected = button.dataset.chatSource === state.source;
            button.textContent = tx(button.dataset.chatSource);
            button.setAttribute('aria-selected', String(selected));
            button.classList.toggle('is-active', selected);
        });
        el.tabs.dataset.active = state.source;
    }

    function setSource(source) {
        state.source = source === 'welink' ? 'welink' : 'mine';
        storeSet(SOURCE_KEY, state.source);
        renderTabs();
        el.chatList.hidden = state.source === 'welink';
        el.list.hidden = state.source !== 'welink';
        if (state.source === 'welink') loadThreads();
    }

    async function loadThreads() {
        const seq = ++state.seq;
        if (!state.loaded) renderThreads();
        try {
            const query = el.search?.value.trim() || '';
            const data = await request('GET', `${API}/threads?limit=200&q=${encodeURIComponent(query)}`);
            if (seq !== state.seq) return;
            state.threads = Array.isArray(data.items) ? data.items : [];
            state.failed = false;
        } catch {
            if (seq !== state.seq) return;
            state.failed = !state.threads.length;
        }
        state.loaded = true;
        renderThreads();
    }

    function renderThreads() {
        if (!el.list) return;
        if (!state.loaded) {
            el.list.innerHTML = '<div class="home-chat-skeleton" aria-hidden="true"><span></span><span></span><span></span></div>';
            return;
        }
        if (state.failed) {
            el.list.innerHTML = `<div class="home-chat-empty">${escapeHtml(tx('loadFailed'))}<button type="button" class="home-chat-retry" data-wl-retry>${escapeHtml(tx('retry'))}</button></div>`;
            return;
        }
        if (!state.threads.length) {
            el.list.innerHTML = `<div class="home-chat-empty">${escapeHtml(tx(el.search?.value.trim() ? 'noMatch' : 'empty'))}</div>`;
            return;
        }
        el.list.innerHTML = state.threads.map((thread, index) => {
            const active = state.active && state.active.kind === thread.kind && state.active.id === thread.id;
            const open = thread.tasks?.open || 0;
            const finished = (thread.tasks?.done || 0) + (thread.tasks?.cancelled || 0);
            const badge = open
                ? `<span class="wl-badge is-open" title="${escapeHtml(tx('openTasks', { n: open }))}"><i></i>${open}</span>`
                : finished ? `<span class="wl-badge is-done" title="${escapeHtml(tx('allDone'))}">✓</span>` : '';
            const subtitle = thread.lastMessage || `${kindText(thread.kind)} · ${tx('messages', { n: thread.messageCount })}`;
            return `<button type="button" class="home-chat-item wl-item${active ? ' is-active' : ''}" role="listitem" data-wl-thread="${index}" title="${escapeHtml(thread.name)}"${active ? ' aria-current="true"' : ''}>
                <span class="wl-avatar wl-avatar--${thread.kind}">${ICONS[thread.kind] || ICONS.user}</span>
                <span class="wl-item-text"><span class="home-chat-title">${escapeHtml(thread.name)}</span><span class="wl-item-sub">${escapeHtml(subtitle)}</span></span>
                <span class="wl-item-side"><span class="home-chat-meta">${escapeHtml(shortTime(thread.lastActiveAt))}</span>${badge}</span>
            </button>`;
        }).join('');
    }

    // ── 打开会话：只读时间线 ───────────────────────────
    async function openThread(thread) {
        if (!thread) return;
        const api = window.DragonClaw?.enterExternal?.({ onExit: ({ switching } = {}) => leaveThread(switching) });
        if (!api) return;
        const seq = ++state.openSeq;
        state.api = api;
        state.active = { kind: thread.kind, id: thread.id, name: thread.name };
        state.items = [];
        state.segments = [];
        state.tasks = [];
        state.focus = 0;
        state.highlight = '';
        renderThreads();
        mountChrome();
        api.beginLoading();
        renderStage();
        // 跟进卡片独立加载，不让较慢的侧栏请求挡住对话正文。
        loadTasks(seq);
        try {
            const page = await request('GET', `${API}/threads/${thread.kind}/${encodeURIComponent(thread.id)}/messages?limit=${PAGE_SIZE}`);
            if (seq !== state.openSeq) return;
            state.active.name = page.thread?.name || thread.name;
            state.items = page.items || [];
            state.segments = page.segments || [];
            state.hasMore = Boolean(page.hasMore);
            renderTimeline({ scroll: 'bottom' });
            api.finishLoading();
        } catch (error) {
            if (seq !== state.openSeq) return;
            api.finishLoading(false);
            api.thread.innerHTML = `<div class="wl-thread-loading is-error">${escapeHtml(tx('loadFailed'))}：${escapeHtml(error.message)}</div>`;
        }
        clearInterval(state.refreshTimer);
        state.refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible' && state.active) loadTasks(state.openSeq);
        }, REFRESH_MS);
    }

    function leaveThread(switching) {
        clearInterval(state.refreshTimer);
        state.refreshTimer = null;
        state.openSeq += 1;
        if (switching) return; // 切换到另一个 WeLink 会话：保留界面骨架
        state.active = null;
        state.api = null;
        el.stage?.remove();
        el.stage = null;
        el.readonly?.remove();
        el.readonly = null;
        window.DragonClawWorkspace?.hideExternal?.();
        renderThreads();
    }

    function mountChrome() {
        const thread = document.getElementById('dcThread');
        if (!el.stage) {
            el.stage = document.createElement('div');
            el.stage.className = 'wl-stage';
            el.stage.addEventListener('click', onStageClick);
            thread.before(el.stage);
        }
        if (!el.readonly) {
            el.readonly = document.createElement('div');
            el.readonly.className = 'wl-readonly';
            el.readonly.addEventListener('click', event => {
                if (event.target.closest('[data-wl-back]')) window.DragonClaw?.newChat?.();
            });
            document.getElementById('dcComposer')?.after(el.readonly);
        }
        renderReadonly();
    }

    function renderReadonly() {
        if (!el.readonly || !state.active) return;
        el.readonly.innerHTML = `<span class="wl-readonly-icon" aria-hidden="true">🔒</span><span class="wl-readonly-text">${escapeHtml(tx('readonly', { kind: kindText(state.active.kind), name: state.active.name }))}</span><button type="button" class="dc-ghost-btn" data-wl-back>${escapeHtml(tx('back'))}</button>`;
    }

    function segmentIndex(sessionId) {
        return state.segments.findIndex(item => item.aiSessionId === sessionId);
    }

    function dividerHtml(segment, index) {
        const time = formatTime(segment?.startedAt);
        if (index <= 0) return `<div class="wl-divider is-start"><span>${escapeHtml(tx('start'))}${time ? ` · ${escapeHtml(time)}` : ''}</span></div>`;
        return `<div class="wl-divider is-context" title="${escapeHtml(tx('newContextHint'))}"><span><b>✦</b> ${escapeHtml(tx('newContext'))}${time ? ` · ${escapeHtml(time)}` : ''}</span></div>`;
    }

    function renderTimeline({ scroll } = {}) {
        const api = state.api;
        if (!api) return;
        const thread = api.thread;
        const previousHeight = thread.scrollHeight;
        const previousTop = thread.scrollTop;
        thread.innerHTML = `<div class="wl-banner"><span class="wl-avatar wl-avatar--${state.active.kind}">${ICONS[state.active.kind] || ICONS.user}</span><span><b>${escapeHtml(tx('banner', { kind: kindText(state.active.kind), name: state.active.name }))}</b><small>${escapeHtml(tx('segments', { n: state.segments.length }))} · ${escapeHtml(tx('messages', { n: state.items.length }))}${state.hasMore ? '+' : ''}</small></span></div>`;
        if (state.hasMore) thread.insertAdjacentHTML('beforeend', `<button type="button" class="dc-history-more" data-wl-more>${escapeHtml(tx(state.loadingMore ? 'loading' : 'loadMore'))}</button>`);
        if (!state.items.length) thread.insertAdjacentHTML('beforeend', `<div class="wl-thread-loading">${escapeHtml(tx('noMessages'))}</div>`);
        let currentSession = null;
        api.batchMessages(() => state.items.forEach((item, position) => {
            if (item.sessionId !== currentSession) {
                const index = segmentIndex(item.sessionId);
                // 更早的消息还没加载完时，首条消息可能在段落中间，分隔线等加载到段首再显示
                if (!(position === 0 && state.hasMore)) {
                    const divider = document.createElement('div');
                    divider.innerHTML = dividerHtml(state.segments[index], position === 0 ? 0 : index);
                    // 分隔线随消息一起进入同一个片段，保留时间线顺序。
                    api.appendToBatch(divider.firstElementChild);
                }
                currentSession = item.sessionId;
            }
            renderMessage(item);
        }));
        thread.querySelector('[data-wl-more]')?.addEventListener('click', loadOlder);
        if (scroll === 'bottom') thread.scrollTop = thread.scrollHeight;
        else if (scroll === 'keep') thread.scrollTop = thread.scrollHeight - previousHeight + previousTop;
    }

    function renderMessage(item) {
        const api = state.api;
        const message = api.addMessage(item.role === 'model' ? 'ai' : 'user', item.role === 'model' ? '' : item.content, {});
        message.classList.add('dc-msg--history', 'wl-msg');
        const main = message.querySelector('.dc-msg-main');
        if (item.role === 'model') {
            message.querySelector('.dc-msg-body').innerHTML = api.renderMarkdown(item.content);
            if (item.followups?.length) {
                const chips = document.createElement('div');
                chips.className = 'wl-chips';
                chips.innerHTML = item.followups.map(chip => `<button type="button" class="wl-chip is-${escapeHtml(chip.action)}" data-wl-task="${escapeHtml(chip.id)}"><span aria-hidden="true">📌</span>${escapeHtml(tx(`chip_${chip.action}`))}：${escapeHtml(chip.title || '')}</button>`).join('');
                chips.addEventListener('click', event => {
                    const button = event.target.closest('[data-wl-task]');
                    if (button) focusTask(button.dataset.wlTask, { openPanel: true });
                });
                main.appendChild(chips);
            }
            api.addCopy(message, item.content);
        }
        const meta = document.createElement('div');
        meta.className = 'wl-msg-meta';
        meta.textContent = [item.role === 'user' && state.active.kind === 'group' ? item.sender : '', api.formatTime(item.createdAt)].filter(Boolean).join(' · ');
        main.prepend(meta);
    }

    async function loadOlder() {
        if (state.loadingMore || !state.hasMore || !state.items.length) return;
        state.loadingMore = true;
        const seq = state.openSeq;
        renderTimeline({ scroll: 'keep' });
        try {
            const page = await request('GET', `${API}/threads/${state.active.kind}/${encodeURIComponent(state.active.id)}/messages?limit=${PAGE_SIZE}&before=${encodeURIComponent(state.items[0].id)}`);
            if (seq !== state.openSeq) return;
            state.items = [...(page.items || []), ...state.items];
            state.hasMore = Boolean(page.hasMore);
        } catch (error) {
            toast(tx('actionFailed', { error: error.message }));
        } finally {
            state.loadingMore = false;
        }
        if (seq === state.openSeq) renderTimeline({ scroll: 'keep' });
    }

    // ── 跟进任务：进度条 + 右侧卡片 ─────────────────────
    async function loadTasks(seq) {
        try {
            const data = await request('GET', `${API}/threads/${state.active.kind}/${encodeURIComponent(state.active.id)}/followups`);
            if (seq !== state.openSeq) return;
            const focusedId = state.tasks[state.focus]?.id;
            state.tasks = Array.isArray(data.items) ? data.items : [];
            state.calendar = data.calendar || null;
            state.canManage = Boolean(data.canManage);
            const kept = state.tasks.findIndex(task => task.id === focusedId);
            state.focus = kept >= 0 ? kept : 0;
            renderStage();
            renderPanel();
            refreshThreadBadge();
        } catch {
            /* 任务读取失败不影响查看对话 */
        }
    }

    function refreshThreadBadge() {
        const thread = state.threads.find(item => state.active && item.kind === state.active.kind && item.id === state.active.id);
        if (!thread) return;
        const count = status => state.tasks.filter(task => task.status === status).length;
        thread.tasks = { open: count('open'), paused: count('paused'), done: count('done'), cancelled: count('cancelled') };
        renderThreads();
    }

    function stageOf(task) {
        if (task.status === 'done' || task.status === 'cancelled') return 2;
        return task.remindCount > 0 || task.progress ? 1 : 0;
    }

    function renderStage() {
        if (!el.stage) return;
        const task = state.tasks[state.focus];
        el.stage.hidden = !task;
        if (!task) {
            el.stage.innerHTML = '';
            return;
        }
        const stage = stageOf(task);
        const cancelled = task.status === 'cancelled';
        const paused = task.status === 'paused';
        const steps = [
            { label: tx('stageStart'), sub: formatTime(task.createdAt) },
            { label: tx('stageActive'), sub: task.remindCount ? tx('reminded', { n: task.remindCount }) : (task.progress ? tx('progress') : (task.nextRemindAt ? formatTime(task.nextRemindAt) : '')) },
            { label: cancelled ? tx('cancelledEnd') : tx('stageEnd'), sub: task.closedAt ? formatTime(task.closedAt) : '' }
        ];
        const fill = stage === 0 ? 0 : stage === 1 ? 50 : 100;
        el.stage.className = `wl-stage is-stage-${stage}${cancelled ? ' is-cancelled' : ''}${paused ? ' is-paused' : ''}`;
        el.stage.innerHTML = `
            <div class="wl-stage-info">
                <span class="wl-status is-${task.status}">${escapeHtml(tx(`status_${task.status}`))}</span>
                <b class="wl-stage-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</b>
            </div>
            <div class="wl-track" role="progressbar" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${stage}" aria-valuetext="${escapeHtml(steps[stage].label)}" style="--wl-fill:${fill}%">
                <span class="wl-track-line"><i class="wl-track-fill"></i></span>
                ${steps.map((step, index) => `<span class="wl-node ${['is-first', 'is-middle', 'is-last'][index]}${index < stage ? ' is-past' : ''}${index === stage ? ' is-current' : ''}">
                    <i class="wl-dot">${index === 2 && stage === 2 ? (cancelled ? '✕' : '✓') : ''}</i>
                    <span class="wl-node-label">${escapeHtml(step.label)}</span>
                    ${step.sub ? `<small>${escapeHtml(step.sub)}</small>` : ''}
                </span>`).join('')}
            </div>
            <div class="wl-stage-actions">
                ${state.tasks.length > 1 ? `<span class="wl-stage-pager"><button type="button" data-wl-stage="prev" aria-label="${escapeHtml(tx('prevTask'))}">‹</button><span>${state.focus + 1}/${state.tasks.length}</span><button type="button" data-wl-stage="next" aria-label="${escapeHtml(tx('nextTask'))}">›</button></span>` : ''}
                <button type="button" class="wl-stage-detail" data-wl-stage="detail">${escapeHtml(tx('details'))}</button>
            </div>`;
    }

    function onStageClick(event) {
        const button = event.target.closest('[data-wl-stage]');
        if (!button || !state.tasks.length) return;
        const action = button.dataset.wlStage;
        if (action === 'prev' || action === 'next') {
            state.focus = (state.focus + (action === 'next' ? 1 : -1) + state.tasks.length) % state.tasks.length;
            renderStage();
            highlightCard(state.tasks[state.focus].id);
        } else {
            focusTask(state.tasks[state.focus].id, { openPanel: true });
        }
    }

    function focusTask(id, { openPanel = false } = {}) {
        const index = state.tasks.findIndex(task => task.id === id);
        if (index >= 0) {
            state.focus = index;
            renderStage();
        }
        if (openPanel) window.DragonClawWorkspace?.openPanel?.();
        highlightCard(id);
    }

    function highlightCard(id) {
        state.highlight = id;
        const card = el.panelBody?.querySelector(`[data-wl-card="${CSS.escape(id)}"]`);
        if (!card) return;
        el.panelBody.querySelectorAll('.wl-task.is-highlight').forEach(node => node.classList.remove('is-highlight'));
        card.classList.add('is-highlight');
        card.open = true;
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function assignees(task) {
        const list = (task.assignees || []).map(item => `<span class="wl-person" title="${escapeHtml(item.account || '')}">@${escapeHtml(item.name || item.account)}</span>`);
        return list.length ? list.join('') : `<span class="wl-muted">${escapeHtml(tx('everyone'))}</span>`;
    }

    function eventLabel(event) {
        return tx(`event_${event.type}`);
    }

    function actorText(actor) {
        if (!actor) return '';
        if (actor === 'system') return tx('system');
        return actor.replace(/^platform:/, '');
    }

    function taskCard(task) {
        const stage = stageOf(task);
        const closed = task.status === 'done' || task.status === 'cancelled';
        const actions = state.canManage ? [
            task.status === 'open' ? `<button type="button" class="wl-act is-primary" data-wl-act="done">${escapeHtml(tx('done'))}</button>` : '',
            task.status === 'open' ? `<button type="button" class="wl-act" data-wl-act="remind">${escapeHtml(tx('remindNow'))}</button>` : '',
            task.status === 'open' ? `<button type="button" class="wl-act" data-wl-act="pause">${escapeHtml(tx('pause'))}</button>` : '',
            task.status === 'paused' ? `<button type="button" class="wl-act is-primary" data-wl-act="resume">${escapeHtml(tx('resume'))}</button>` : '',
            !closed ? `<button type="button" class="wl-act is-quiet" data-wl-act="cancel">${escapeHtml(tx('cancel'))}</button>` : '',
            closed ? `<button type="button" class="wl-act" data-wl-act="reopen">${escapeHtml(tx('reopen'))}</button>` : '',
            !closed ? `<select class="wl-urgency" data-wl-urgency aria-label="${escapeHtml(tx('urgency'))}">${['low', 'normal', 'high', 'urgent'].map(level => `<option value="${level}"${task.urgency === level ? ' selected' : ''}>${escapeHtml(tx('urgency'))} · ${escapeHtml(tx(`urgency_${level}`))}</option>`).join('')}</select>` : ''
        ].join('') : '';
        const rows = [
            [tx('remindWho'), assignees(task)],
            [tx('frequency'), `${escapeHtml(task.frequency)}<span class="wl-urgency-tag is-${task.urgency}">${escapeHtml(tx(`urgency_${task.urgency}`))}</span>`],
            task.status === 'open' && task.nextRemindAt ? [tx('nextRemind'), `<b>${escapeHtml(formatTime(task.nextRemindAt, true))}</b>${task.nextRemindNote ? `<span class="wl-note">${escapeHtml(task.nextRemindNote)}</span>` : ''}`] : null,
            task.remindCount ? ['', `<span class="wl-muted">${escapeHtml(tx('reminded', { n: task.remindCount }))}${task.lastRemindedAt ? ` · ${escapeHtml(tx('lastReminded', { time: formatTime(task.lastRemindedAt) }))}` : ''}</span>`] : null,
            task.dueAt ? [tx('due'), escapeHtml(formatTime(task.dueAt, true))] : null,
            [tx('progress'), task.progress ? escapeHtml(task.progress) : `<span class="wl-muted">${escapeHtml(tx('noProgress'))}</span>`],
            closed ? [tx('closed'), `${escapeHtml(tx('closedBy', { time: formatTime(task.closedAt), who: actorText(task.closedBy) || '—' }))}${task.closeNote ? `<span class="wl-note">${escapeHtml(task.closeNote)}</span>` : ''}`] : null,
            task.creator ? [tx('creator'), escapeHtml(actorText(task.creator))] : null
        ].filter(Boolean);
        const events = (task.events || []).slice().reverse();
        return `<details class="wl-task is-${task.status}${state.highlight === task.id ? ' is-highlight' : ''}" data-wl-card="${escapeHtml(task.id)}"${task.status === 'open' || state.highlight === task.id ? ' open' : ''}>
            <summary>
                <span class="wl-mini" aria-hidden="true">${[0, 1, 2].map(index => `<i class="${index <= stage ? 'is-on' : ''}"></i>`).join('')}</span>
                <span class="wl-task-title">${escapeHtml(task.title)}</span>
                <span class="wl-status is-${task.status}">${escapeHtml(tx(`status_${task.status}`))}</span>
            </summary>
            <dl class="wl-rows">${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`).join('')}</dl>
            ${task.detail ? `<details class="wl-sub"><summary>${escapeHtml(tx('detail'))}</summary><div class="wl-detail">${state.api ? state.api.renderMarkdown(task.detail) : escapeHtml(task.detail)}</div></details>` : ''}
            ${events.length ? `<details class="wl-sub"${closed ? ' open' : ''}><summary>${escapeHtml(tx('timeline'))} · ${events.length}</summary><ol class="wl-timeline">${events.map(event => `<li class="is-${escapeHtml(event.type)}"><i></i><div><b>${escapeHtml(eventLabel(event))}</b><time>${escapeHtml(formatTime(event.createdAt))}</time>${event.actor ? `<span class="wl-muted"> · ${escapeHtml(actorText(event.actor))}</span>` : ''}${event.note && event.type !== 'created' ? `<p>${escapeHtml(event.note)}</p>` : ''}</div></li>`).join('')}</ol></details>` : ''}
            ${actions ? `<div class="wl-actions" data-wl-task-id="${escapeHtml(task.id)}">${actions}</div>` : ''}
        </details>`;
    }

    function renderPanel() {
        if (!state.active) return;
        const open = state.tasks.filter(task => task.status === 'open').length;
        const body = window.DragonClawWorkspace?.showExternal?.({ title: tx('followTitle'), meta: state.tasks.length ? tx('followMeta', { n: open }) : '', open: state.tasks.length ? undefined : false });
        if (!body) return;
        el.panelBody = body;
        // 保留各卡片的展开状态，定时刷新时不打断查看
        const openIds = new Set([...body.querySelectorAll('.wl-task[open]')].map(node => node.dataset.wlCard));
        const hadCards = body.querySelector('.wl-task');
        body.innerHTML = state.tasks.length
            ? `<div class="wl-tasks">${state.tasks.map(taskCard).join('')}</div><p class="wl-zone">${escapeHtml(tx('timezone', { zone: state.calendar?.timezone || 'Africa/Cairo' }))}</p>`
            : `<div class="wsp-empty">${escapeHtml(tx('noTasks'))}</div>`;
        if (hadCards) body.querySelectorAll('.wl-task').forEach(node => { node.open = openIds.has(node.dataset.wlCard) || state.highlight === node.dataset.wlCard; });
        if (!body.dataset.wlBound) {
            body.dataset.wlBound = '1';
            body.addEventListener('click', onPanelAction);
            body.addEventListener('change', onUrgencyChange);
        }
    }

    async function onPanelAction(event) {
        const button = event.target.closest('[data-wl-act]');
        if (!button || !el.panelBody?.contains(button)) return;
        const id = button.closest('[data-wl-task-id]')?.dataset.wlTaskId;
        const task = state.tasks.find(item => item.id === id);
        if (!task) return;
        const action = button.dataset.wlAct;
        if (action === 'remind') {
            if (!(await confirmDialog({ title: tx('confirmRemindTitle'), message: tx('confirmRemind'), confirmText: tx('remindNow'), tone: 'info' }))) return;
        } else if (action === 'done' || action === 'cancel') {
            if (!(await confirmDialog({ title: task.title, message: tx('confirmClose', { title: task.title, action: tx(action === 'done' ? 'status_done' : 'status_cancelled') }), confirmText: tx(action), tone: action === 'cancel' ? 'danger' : 'info' }))) return;
        }
        button.disabled = true;
        try {
            const data = action === 'remind'
                ? await request('POST', `${API}/followups/${encodeURIComponent(id)}/remind`)
                : await request('PATCH', `${API}/followups/${encodeURIComponent(id)}`, { action });
            replaceTask(data.item);
            toast(tx('updated'));
        } catch (error) {
            toast(tx('actionFailed', { error: error.message }));
            button.disabled = false;
        }
    }

    async function onUrgencyChange(event) {
        const select = event.target.closest('[data-wl-urgency]');
        if (!select) return;
        const id = select.closest('[data-wl-task-id]')?.dataset.wlTaskId;
        try {
            const data = await request('PATCH', `${API}/followups/${encodeURIComponent(id)}`, { urgency: select.value, scheduleMode: 'auto' });
            replaceTask(data.item);
            toast(tx('updated'));
        } catch (error) {
            toast(tx('actionFailed', { error: error.message }));
        }
    }

    function replaceTask(item) {
        if (!item) return;
        const index = state.tasks.findIndex(task => task.id === item.id);
        if (index >= 0) state.tasks[index] = item;
        state.highlight = item.id;
        renderStage();
        renderPanel();
        refreshThreadBadge();
    }

    function applyTexts() {
        renderTabs();
        if (state.source === 'welink') renderThreads();
        if (state.active) {
            renderReadonly();
            renderStage();
            renderPanel();
            if (state.api?.thread.hasAttribute('aria-busy')) state.api.beginLoading();
            else renderTimeline();
        }
    }

    function init() {
        if (!mountTabs()) return;
        setSource(storeGet(SOURCE_KEY) === 'welink' ? 'welink' : 'mine');
        window.addEventListener('tools:languagechange', applyTexts);
        setInterval(() => {
            if (state.source === 'welink' && document.visibilityState === 'visible' && !el.list.hidden) loadThreads();
        }, 60000);
    }

    window.HomeWelinkThreads = { open: openThread, reload: loadThreads };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
