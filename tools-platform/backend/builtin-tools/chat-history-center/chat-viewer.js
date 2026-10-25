(() => {
    'use strict';

    const state = {
        user: null,
        settings: { mySenderId: '' },
        conversations: [],
        conversationTotal: 0,
        conversationOffset: 0,
        activeConversation: null,
        nextBefore: null,
        messages: [],
        chatHits: [],
        chatHitIndex: 0,
        unreadOnly: false,
        pinnedOnly: false,
        searchPage: 1,
        searchTotal: 0,
        searchRows: [],
        searchParams: null,
        conversationCache: new Map(),
        sourcePage: 1,
        sourceTotal: 0,
        sourceTotalPages: 1,
        parserRules: [],
        tableData: { directory: [], people: [], groups: [], groupMembers: [] },
        analyticsPaging: {
            directory: { offset: 0, total: 0, hasMore: true, loading: false, dataVersion: null, requestId: 0 },
            people: { offset: 0, total: 0, hasMore: true, loading: false, dataVersion: null, requestId: 0 },
            groups: { offset: 0, total: 0, hasMore: true, loading: false, dataVersion: null, requestId: 0 }
        },
        tableViews: {
            directory: { sortKey: 'message_count', sortDirection: 'desc', filters: new Map() },
            people: { sortKey: 'message_count', sortDirection: 'desc', filters: new Map() },
            groups: { sortKey: 'message_count', sortDirection: 'desc', filters: new Map() },
            groupMembers: { sortKey: 'message_count', sortDirection: 'desc', filters: new Map() }
        },
        activeTableFilter: null,
        activeView: 'chat',
        groupAnalysis: null,
        personaStyleSaving: false,
        theme: localStorage.getItem('chat_history_theme') || 'system'
    };
    const $ = id => document.getElementById(id);
    const typeLabels = { single: '单聊', group: '群组', discussion: '讨论组', other: '其他' };
    const personaStyleSeries = {
        operations: {
            label: '经典运营',
            roles: { core: '👑 核心领袖', active: '🔥 积极中坚', regular: '💬 常规参与', low: '🌱 边缘发言' }
        },
        team: {
            label: '团队协作',
            roles: { core: '🧭 团队领航者', active: '🚀 推进主力', regular: '🤝 协作伙伴', low: '👀 观察参与者' }
        },
        pets: {
            label: '萌宠乐园',
            roles: { core: '🦁 领队狮狮', active: '🐰 活力兔兔', regular: '🐿️ 协作松鼠', low: '🐣 潜力萌新' }
        },
        dessert: {
            label: '甜点派对',
            roles: { core: '🎂 镇场蛋糕', active: '🧁 活力杯糕', regular: '🍪 协作曲奇', low: '🍬 甜心萌新' }
        },
        energy: {
            label: '能量等级',
            roles: { core: '🏆 S 级核心', active: '⚡ A 级活跃', regular: '💡 B 级参与', low: '🌙 C 级低频' }
        },
        nature: {
            label: '自然生态',
            roles: { core: '🌳 参天主干', active: '🌿 繁茂枝干', regular: '🌼 活力新芽', low: '🌰 待萌种子' }
        }
    };
    const personaStyleKeys = Object.keys(personaStyleSeries);
    const ANALYTICS_PAGE_SIZE = 100;
    const COLUMN_WIDTH_STORAGE_KEY = 'chat_history_analytics_column_widths_v1';
    const ANALYTICS_COLUMN_WIDTHS = {
        directory: [170, 150, 210, 120, 110, 130, 155, 110],
        people: [190, 105, 105, 105, 120, 130, 155],
        groups: [270, 105, 115, 115, 110, 205, 120, 155, 110],
        groupMembers: [190, 210, 185, 105, 115, 115, 140, 155]
    };
    const ANALYTICS_COLUMN_MIN_WIDTHS = {
        directory: [110, 100, 110, 90, 85, 100, 120, 96],
        people: [120, 80, 80, 80, 95, 105, 120],
        groups: [130, 85, 90, 90, 90, 130, 95, 120, 96],
        groupMembers: [120, 140, 140, 85, 95, 95, 110, 120]
    };
    const CONVERSATION_PANE_WIDTH_STORAGE_KEY = 'chat_history_conv_pane_width_v1';
    const CONVERSATION_PANE_DEFAULT_WIDTH = 320;
    const CONVERSATION_PANE_MIN_WIDTH = 220;
    const CONVERSATION_PANE_MAX_WIDTH = 680;
    let applyConversationPaneWidth = null;
    let toastTimer;
    let conversationDebounce;
    let peopleDebounce;
    let sourceDebounce;
    let preloadRunning = false;
    let statsLoadPromise = null;

    function showToast(message, error = false) {
        const toast = $('toast');
        toast.textContent = message;
        toast.className = `toast show${error ? ' error' : ''}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2800);
    }

    function setLoading(visible, text = '正在处理…', progress = null, detail = '') {
        $('loading').hidden = !visible;
        $('loadingText').textContent = text;
        const progressHost = $('loadingProgress');
        const progressBar = $('loadingProgressBar');
        const progressLabel = $('loadingProgressLabel');
        const hasProgress = visible && Number.isFinite(progress);
        if (progressHost) progressHost.hidden = !hasProgress;
        if (progressBar) progressBar.style.width = `${hasProgress ? Math.max(0, Math.min(100, progress)) : 0}%`;
        if (progressLabel) progressLabel.textContent = hasProgress ? `${Math.round(progress)}%` : '';
        const loadingLog = $('loadingLog');
        if (loadingLog) {
            loadingLog.hidden = !visible || !detail;
            loadingLog.textContent = detail;
        }
    }

    async function withServiceProgress(request, expectedType = '') {
        let stopped = false;
        let polling = false;
        const poll = async () => {
            if (stopped || polling) return;
            polling = true;
            try {
                const status = await API.get(`/api/chat-history/status?_=${Date.now()}`);
                let current = expectedType && status.operation?.type === expectedType && status.operation?.active !== false ? status.operation : null;
                if (!current && !status.ready) current = status.initialization;
                if (!current && status.maintenance?.active) current = status.maintenance;
                if (current && current.message) {
                    const sizeMb = Number(status.database?.size || 0) / 1024 / 1024;
                    const elapsed = current.startedAt ? Math.max(0, Math.round((Date.now() - new Date(current.startedAt).getTime()) / 1000)) : 0;
                    const detail = [current.message, elapsed > 0 ? `已用时 ${elapsed} 秒` : '', sizeMb > 0 ? `数据库 ${sizeMb.toFixed(1)} MB` : ''].filter(Boolean).join(' · ');
                    setLoading(true, current.message, Number.isFinite(current.progress) ? current.progress : null, detail);
                }
            } catch (_error) {
                // The primary request remains authoritative; status polling is best-effort only.
            } finally {
                polling = false;
            }
        };
        await poll();
        const timer = setInterval(poll, 700);
        try {
            return await request;
        } finally {
            stopped = true;
            clearInterval(timer);
        }
    }

    function yieldToBrowser() {
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    function resetAnalyticsPaging() {
        Object.values(state.analyticsPaging).forEach(page => {
            page.offset = 0;
            page.total = 0;
            page.hasMore = true;
            page.loading = false;
            page.dataVersion = null;
            page.requestId += 1;
        });
    }

    function applyAnalyticsPage(tableName, data, append = false) {
        const page = state.analyticsPaging[tableName];
        const incomingVersion = data.analyticsCache?.dataVersion ?? null;
        const versionChanged = append && page.dataVersion !== null && incomingVersion !== null && page.dataVersion !== incomingVersion;
        const shouldAppend = append && !versionChanged;
        const incoming = Array.isArray(data.items) ? data.items : [];
        const rows = shouldAppend ? [...state.tableData[tableName], ...incoming] : incoming;
        page.offset = rows.length;
        page.total = Number(data.total ?? rows.length);
        page.hasMore = page.offset < page.total && incoming.length > 0;
        page.dataVersion = incomingVersion;
        state.tableData[tableName] = rows;
        return rows;
    }

    function setLazyTableLoading(tableName, loading) {
        const wrap = $(`${tableName}TableWrap`);
        wrap?.classList.toggle('lazy-loading', loading);
    }

    function setupAnalyticsLazyLoading() {
        const loaders = {
            directory: () => loadDirectory($('directoryQuery').value.trim(), { append: true }),
            people: () => loadPeopleOnly({ append: true }),
            groups: () => loadGroupsOnly({ append: true })
        };
        Object.entries(loaders).forEach(([tableName, loadMore]) => {
            const wrap = $(`${tableName}TableWrap`);
            if (!wrap || wrap.dataset.lazyLoadingReady === '1') return;
            wrap.dataset.lazyLoadingReady = '1';
            wrap.addEventListener('scroll', () => {
                const remaining = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight;
                if (remaining <= 160) void loadMore();
            }, { passive: true });
        });
    }

    function updateAnalyticsCacheStatus(responses) {
        const status = $('analyticsCacheStatus');
        if (!status) return;
        const entries = responses.map(item => item?.analyticsCache).filter(Boolean);
        if (!entries.length) {
            status.hidden = true;
            return;
        }
        const newest = entries.map(item => item.generatedAt).filter(Boolean).sort().at(-1);
        status.textContent = entries.every(item => item.hit)
            ? `⚡ 已读取分析缓存${newest ? ` · ${formatDateTime(newest)}` : ''}`
            : `✓ 分析已更新并缓存${newest ? ` · ${formatDateTime(newest)}` : ''}`;
        status.hidden = false;
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString('zh-CN');
    }

    function formatDateTime(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value).replace('T', ' ').slice(0, 19) : date.toLocaleString('zh-CN');
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function applyTheme(theme) {
        const pref = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
        state.theme = pref;
        try { localStorage.setItem('chat_history_theme', pref); } catch (_) {}

        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const isDark = pref === 'dark' || (pref === 'system' && prefersDark);

        document.documentElement.setAttribute('data-theme', pref);
        document.documentElement.classList.toggle('dark-theme', isDark);

        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === pref);
        });
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function compactText(value, length = 70) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        return text.length > length ? `${text.slice(0, length)}…` : text;
    }

    function tableCellValue(tableName, item, key) {
        if (tableName === 'people' && key === 'person_label') {
            return `${item.sender_name || '未知'} (${item.sender_id || '-'})${item.is_me ? ' （我）' : ''}`;
        }
        if (tableName === 'groups' && key === 'conversation_type') {
            return typeLabels[item.conversation_type] || item.conversation_type || '-';
        }
        if (tableName === 'groups' && key === 'top_speaker') {
            return item.top_speaker_name ? `${item.top_speaker_name}${item.top_speaker_count ? ` (${item.top_speaker_count}条)` : ''}` : '-';
        }
        if (tableName === 'groupMembers' && key === 'sender_name') {
            return `${item.sender_name || '未知'} (${item.sender_id || '-'})${item.is_me ? ' （我）' : ''}`;
        }
        if (tableName === 'groupMembers' && key === 'persona_role') {
            return personaRoleLabel(item.role_level);
        }
        const value = item[key];
        if (value === null || value === undefined || value === '') return '-';
        return String(value);
    }

    function currentPersonaStyle() {
        const style = state.groupAnalysis?.conversation?.persona_style;
        return personaStyleSeries[style] ? style : 'operations';
    }

    function personaRoleLabel(roleLevel) {
        const series = personaStyleSeries[currentPersonaStyle()] || personaStyleSeries.operations;
        return series.roles[roleLevel] || series.roles.low;
    }

    function updatePersonaStyleHeader() {
        const label = document.querySelector('[data-table-head="groupMembers"] [data-key="persona_role"] .table-head-label');
        const series = personaStyleSeries[currentPersonaStyle()];
        if (!label || !series) return;
        label.textContent = `运营角色画像 · ${series.label}`;
        label.title = state.user?.role === 'admin'
            ? '点击任一角色画像，可切换整个群组的系列风格'
            : '当前群组使用的运营角色画像系列';
    }

    function personaPendingStorageKey(conversationId) {
        const tenantId = state.user?.tenantId || 'default';
        return `chat-history-persona-style-pending:${tenantId}:${conversationId}`;
    }

    function readPendingPersonaStyle(conversationId) {
        try {
            const style = localStorage.getItem(personaPendingStorageKey(conversationId));
            return personaStyleSeries[style] ? style : '';
        } catch (_) {
            return '';
        }
    }

    function writePendingPersonaStyle(conversationId, style) {
        try {
            const key = personaPendingStorageKey(conversationId);
            if (style) localStorage.setItem(key, style);
            else localStorage.removeItem(key);
        } catch (_) { /* 本机存储不可用时仍保留当前页面选择 */ }
    }

    function setPersonaStyleStatus(message = '', kind = '') {
        const status = $('personaStyleStatus');
        if (!status) return;
        status.textContent = message;
        status.className = `persona-style-status${kind ? ` ${kind}` : ''}`;
        status.hidden = !message;
    }

    async function persistPersonaStyle(activeAnalysis, style, options = {}) {
        if (!activeAnalysis || state.personaStyleSaving) return;
        const conversationId = activeAnalysis.conversation.id;
        state.personaStyleSaving = true;
        setPersonaStyleStatus(options.retry ? '正在同步上次选择…' : '正在自动保存…', 'saving');
        try {
            const saved = await API.put(`/api/chat-history/stats/groups/${encodeURIComponent(conversationId)}/persona-style`, { personaStyle: style });
            activeAnalysis.conversation.persona_style_updated_at = saved.updatedAt || null;
            writePendingPersonaStyle(conversationId, '');
            if (state.groupAnalysis === activeAnalysis) {
                setPersonaStyleStatus(`已自动保存·${personaStyleSeries[style].label}`, 'saved');
            }
        } catch (error) {
            writePendingPersonaStyle(conversationId, style);
            if (state.groupAnalysis === activeAnalysis) {
                setPersonaStyleStatus(`已保留当前选择，待服务恢复后自动同步（${error.message || '保存失败'}）`, 'pending');
            }
        } finally {
            state.personaStyleSaving = false;
        }
    }

    async function cyclePersonaStyle() {
        if (!state.groupAnalysis || state.personaStyleSaving) return;
        const activeAnalysis = state.groupAnalysis;
        const current = currentPersonaStyle();
        const next = personaStyleKeys[(personaStyleKeys.indexOf(current) + 1) % personaStyleKeys.length];

        activeAnalysis.conversation.persona_style = next;
        state.tableViews.groupMembers.filters.delete('persona_role');
        updatePersonaStyleHeader();
        renderTable('groupMembers');
        await persistPersonaStyle(activeAnalysis, next);
    }

    function compareTableValues(left, right, type) {
        if (type === 'number') {
            const a = left === null || left === undefined ? Number.NEGATIVE_INFINITY : Number(left);
            const b = right === null || right === undefined ? Number.NEGATIVE_INFINITY : Number(right);
            return a - b;
        }
        if (type === 'date') return String(left || '').localeCompare(String(right || ''));
        return String(left || '').localeCompare(String(right || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
    }

    function filteredAndSortedRows(tableName) {
        const view = state.tableViews[tableName];
        const head = document.querySelector(`[data-table-head="${tableName}"]`);
        const type = head?.querySelector(`[data-key="${view.sortKey}"]`)?.dataset.type || 'text';
        const rows = state.tableData[tableName].filter(item => {
            for (const [key, selected] of view.filters.entries()) {
                if (!selected.has(tableCellValue(tableName, item, key))) return false;
            }
            return true;
        });
        rows.sort((a, b) => {
            const result = compareTableValues(
                view.sortKey === 'person_label' ? tableCellValue(tableName, a, view.sortKey) : a[view.sortKey],
                view.sortKey === 'person_label' ? tableCellValue(tableName, b, view.sortKey) : b[view.sortKey],
                type
            );
            return view.sortDirection === 'asc' ? result : -result;
        });
        return rows;
    }

    function updateTableHeadState(tableName) {
        const view = state.tableViews[tableName];
        document.querySelectorAll(`[data-table-head="${tableName}"] th[data-key]`).forEach(th => {
            const sort = th.querySelector('.table-sort-btn');
            const filter = th.querySelector('.table-filter-btn');
            if (sort) {
                const active = view.sortKey === th.dataset.key;
                sort.classList.toggle('active', active);
                sort.textContent = active ? (view.sortDirection === 'asc' ? '↑' : '↓') : '↕';
                sort.title = active && view.sortDirection === 'asc' ? '当前升序，点击切换降序' : '点击排序';
            }
            filter?.classList.toggle('active', view.filters.has(th.dataset.key));
        });
    }

    function renderTable(tableName) {
        if (tableName === 'directory') renderDirectoryRows(filteredAndSortedRows(tableName));
        else if (tableName === 'groups') renderGroupRows(filteredAndSortedRows(tableName));
        else if (tableName === 'groupMembers') renderGroupMemberRows(filteredAndSortedRows(tableName));
        else renderPeopleRows(filteredAndSortedRows(tableName));
        updateTableHeadState(tableName);
    }

    function readColumnWidths() {
        try {
            const value = JSON.parse(localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY) || '{}');
            return value && typeof value === 'object' ? value : {};
        } catch (_) {
            return {};
        }
    }

    function saveColumnWidth(tableName, index, width) {
        try {
            const saved = readColumnWidths();
            if (!saved[tableName]) saved[tableName] = {};
            saved[tableName][index] = Math.round(width);
            localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(saved));
        } catch (_) {}
    }

    function applyResizableTableWidth(tableName) {
        const head = document.querySelector(`[data-table-head="${tableName}"]`);
        const table = head?.closest('table');
        if (!head || !table) return;
        const widths = [...head.children].map(th => Number.parseFloat(th.style.width) || th.getBoundingClientRect().width || 100);
        table.style.width = `${Math.ceil(widths.reduce((sum, width) => sum + width, 0))}px`;
        table.style.minWidth = '100%';
        table.style.tableLayout = 'fixed';
    }

    function setupResizableTableColumns(head, tableName) {
        if (!ANALYTICS_COLUMN_WIDTHS[tableName] || head.dataset.resizableReady === '1') return;
        head.dataset.resizableReady = '1';
        head.closest('table')?.classList.add('resizable-table');
        const saved = readColumnWidths()[tableName] || {};
        [...head.children].forEach((th, index) => {
            const defaultWidth = ANALYTICS_COLUMN_WIDTHS[tableName][index] || 110;
            const minimumWidth = ANALYTICS_COLUMN_MIN_WIDTHS[tableName]?.[index] || 70;
            const initialWidth = Math.max(minimumWidth, Math.min(520, Number(saved[index]) || defaultWidth));
            th.style.width = `${initialWidth}px`;
            th.style.minWidth = `${initialWidth}px`;
            const handle = document.createElement('span');
            handle.className = 'column-resize-handle';
            handle.title = '拖动调整列宽，双击恢复默认宽度';
            handle.tabIndex = 0;
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-orientation', 'vertical');
            handle.setAttribute('aria-label', `${th.textContent.trim() || '当前列'}：调整列宽`);
            handle.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                const startX = event.clientX;
                const startWidth = th.getBoundingClientRect().width;
                document.body.classList.add('resizing-table-column');
                const move = moveEvent => {
                    const width = Math.max(minimumWidth, Math.min(520, startWidth + moveEvent.clientX - startX));
                    th.style.width = `${width}px`;
                    th.style.minWidth = `${width}px`;
                    applyResizableTableWidth(tableName);
                };
                const finish = () => {
                    document.removeEventListener('pointermove', move);
                    document.removeEventListener('pointerup', finish);
                    document.removeEventListener('pointercancel', finish);
                    document.body.classList.remove('resizing-table-column');
                    saveColumnWidth(tableName, index, Number.parseFloat(th.style.width) || defaultWidth);
                };
                document.addEventListener('pointermove', move);
                document.addEventListener('pointerup', finish, { once: true });
                document.addEventListener('pointercancel', finish, { once: true });
            });
            handle.addEventListener('dblclick', event => {
                event.preventDefault();
                event.stopPropagation();
                th.style.width = `${defaultWidth}px`;
                th.style.minWidth = `${defaultWidth}px`;
                saveColumnWidth(tableName, index, defaultWidth);
                applyResizableTableWidth(tableName);
                showToast('已恢复该列默认宽度');
            });
            handle.addEventListener('keydown', event => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const step = event.shiftKey ? 25 : 10;
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                const current = Number.parseFloat(th.style.width) || defaultWidth;
                const width = Math.max(minimumWidth, Math.min(520, current + direction * step));
                th.style.width = `${width}px`;
                th.style.minWidth = `${width}px`;
                saveColumnWidth(tableName, index, width);
                applyResizableTableWidth(tableName);
            });
            th.append(handle);
        });
        applyResizableTableWidth(tableName);
    }

    function setupConversationPaneResize() {
        const pane = document.querySelector('.conversation-pane');
        const chatView = $('view-chat');
        if (!pane || !chatView) return;

        let handle = $('conversationResizeHandle') || pane.querySelector('.conversation-resize-handle');
        if (!handle) {
            handle = document.createElement('div');
            handle.id = 'conversationResizeHandle';
            handle.className = 'conversation-resize-handle';
            handle.title = '拖动调整会话列表宽度，双击恢复默认';
            handle.tabIndex = 0;
            handle.setAttribute('role', 'separator');
            handle.setAttribute('aria-orientation', 'vertical');
            handle.setAttribute('aria-label', '调整会话列表宽度');
            pane.append(handle);
        }

        let preferred = CONVERSATION_PANE_DEFAULT_WIDTH;
        try {
            const saved = Number(localStorage.getItem(CONVERSATION_PANE_WIDTH_STORAGE_KEY));
            if (saved && !isNaN(saved)) preferred = saved;
        } catch (_) {}
        preferred = Math.max(CONVERSATION_PANE_MIN_WIDTH, Math.min(CONVERSATION_PANE_MAX_WIDTH, preferred));

        const apply = () => {
            const containerWidth = chatView.getBoundingClientRect().width || window.innerWidth;
            if (containerWidth <= 760) return;
            const detailPane = $('detailPane');
            const detailOpen = detailPane && !detailPane.hidden && containerWidth > 1100;
            const reservedRight = detailOpen ? 640 : 340;
            const max = Math.max(CONVERSATION_PANE_MIN_WIDTH, Math.min(CONVERSATION_PANE_MAX_WIDTH, containerWidth - reservedRight));
            const effective = Math.round(Math.max(CONVERSATION_PANE_MIN_WIDTH, Math.min(preferred, max)));
            document.documentElement.style.setProperty('--conv-pane-width', `${effective}px`);
            chatView.style.setProperty('--conv-pane-width', `${effective}px`);
            handle.setAttribute('aria-valuenow', String(effective));
            handle.setAttribute('aria-valuemin', String(CONVERSATION_PANE_MIN_WIDTH));
            handle.setAttribute('aria-valuemax', String(CONVERSATION_PANE_MAX_WIDTH));
        };
        applyConversationPaneWidth = apply;

        const save = width => {
            preferred = Math.max(CONVERSATION_PANE_MIN_WIDTH, Math.min(CONVERSATION_PANE_MAX_WIDTH, width));
            try {
                localStorage.setItem(CONVERSATION_PANE_WIDTH_STORAGE_KEY, String(preferred));
            } catch (_) {}
            apply();
        };

        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX;
            const startWidth = pane.getBoundingClientRect().width;
            document.body.classList.add('is-resizing-pane');
            pane.classList.add('is-resizing');

            const move = moveEvent => {
                const width = startWidth + (moveEvent.clientX - startX);
                save(width);
            };

            const finish = () => {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', finish);
                document.removeEventListener('pointercancel', finish);
                document.body.classList.remove('is-resizing-pane');
                pane.classList.remove('is-resizing');
            };

            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', finish, { once: true });
            document.addEventListener('pointercancel', finish, { once: true });
        });

        handle.addEventListener('dblclick', event => {
            event.preventDefault();
            event.stopPropagation();
            save(CONVERSATION_PANE_DEFAULT_WIDTH);
            showToast('已恢复会话列表默认宽度');
        });

        handle.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.shiftKey ? 32 : 16;
            const current = pane.getBoundingClientRect().width || preferred;
            if (event.key === 'Home') {
                save(CONVERSATION_PANE_DEFAULT_WIDTH);
            } else if (event.key === 'End') {
                save(CONVERSATION_PANE_MAX_WIDTH);
            } else if (event.key === 'ArrowRight') {
                save(current + step);
            } else if (event.key === 'ArrowLeft') {
                save(current - step);
            }
        });

        const detailPane = $('detailPane');
        if (detailPane) {
            try {
                const mutObserver = new MutationObserver(apply);
                mutObserver.observe(detailPane, { attributes: true, attributeFilter: ['hidden'] });
            } catch (_) {}
        }

        try {
            const observer = new ResizeObserver(apply);
            observer.observe(chatView);
        } catch (_) {
            window.addEventListener('resize', apply);
        }

        apply();
    }

    function closeTableFilterPopover() {
        $('tableFilterPopover').hidden = true;
        state.activeTableFilter = null;
    }

    function renderTableFilterOptions(search = '') {
        const active = state.activeTableFilter;
        if (!active) return;
        const query = String(search || '').trim().toLocaleLowerCase();
        const host = $('tableFilterOptions');
        host.replaceChildren();
        active.values.filter(value => !query || value.toLocaleLowerCase().includes(query)).forEach(value => {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = value;
            checkbox.checked = active.selected.has(value);
            checkbox.addEventListener('change', () => checkbox.checked ? active.selected.add(value) : active.selected.delete(value));
            const text = document.createElement('span');
            text.textContent = value;
            label.append(checkbox, text);
            host.append(label);
        });
    }

    function openTableFilterPopover(tableName, key, title, anchor) {
        const values = [...new Set(state.tableData[tableName].map(item => tableCellValue(tableName, item, key)))]
            .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }));
        const current = state.tableViews[tableName].filters.get(key);
        const hasFilter = state.tableViews[tableName].filters.has(key);
        state.activeTableFilter = { tableName, key, values, selected: new Set(hasFilter ? current : values) };
        $('tableFilterTitle').textContent = `${title}筛选`;
        $('tableFilterSearch').value = '';
        renderTableFilterOptions();
        const popover = $('tableFilterPopover');
        popover.hidden = false;
        const rect = anchor.getBoundingClientRect();
        const left = Math.min(window.innerWidth - 292, Math.max(8, rect.left - 120));
        const top = Math.min(window.innerHeight - 390, rect.bottom + 6);
        popover.style.left = `${left}px`;
        popover.style.top = `${Math.max(8, top)}px`;
    }

    function setupInteractiveTableHeads() {
        document.querySelectorAll('[data-table-head]').forEach(head => {
            const tableName = head.dataset.tableHead;
            head.querySelectorAll('th[data-key]').forEach(th => {
                const title = th.textContent.trim();
                th.replaceChildren();
                const label = document.createElement('span');
                label.className = 'table-head-label';
                label.textContent = title;
                const actions = document.createElement('span');
                actions.className = 'table-head-actions';
                const sort = document.createElement('button');
                sort.type = 'button';
                sort.className = 'table-head-btn table-sort-btn';
                sort.textContent = '↕';
                sort.addEventListener('click', () => {
                    const view = state.tableViews[tableName];
                    if (view.sortKey === th.dataset.key) view.sortDirection = view.sortDirection === 'asc' ? 'desc' : 'asc';
                    else {
                        view.sortKey = th.dataset.key;
                        view.sortDirection = th.dataset.type === 'text' || !th.dataset.type ? 'asc' : 'desc';
                    }
                    renderTable(tableName);
                });
                const filter = document.createElement('button');
                filter.type = 'button';
                filter.className = 'table-head-btn table-filter-btn';
                filter.textContent = '⌄';
                filter.title = '单选或多选过滤';
                filter.addEventListener('click', () => openTableFilterPopover(tableName, th.dataset.key, title, filter));
                actions.append(sort, filter);
                th.append(label, actions);
            });
            setupResizableTableColumns(head, tableName);
            updateTableHeadState(tableName);
        });
    }

    function shortTime(value) {
        if (!value) return '';
        const today = new Date().toISOString().slice(0, 10);
        return value.slice(0, 10) === today ? value.slice(11, 16) : value.slice(5, 16);
    }

    function dayLabel(value) {
        const day = String(value || '').slice(0, 10);
        const today = new Date();
        const yesterday = new Date(Date.now() - 86400000);
        const local = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (day === local(today)) return '今天';
        if (day === local(yesterday)) return '昨天';
        return day;
    }

    function appendHighlighted(parent, value, keyword) {
        const text = String(value || '');
        if (!keyword) {
            parent.textContent = text;
            return;
        }
        const needle = String(keyword).toLowerCase();
        let cursor = 0;
        while (cursor < text.length) {
            const index = text.toLowerCase().indexOf(needle, cursor);
            if (index < 0) {
                parent.append(document.createTextNode(text.slice(cursor)));
                break;
            }
            if (index > cursor) parent.append(document.createTextNode(text.slice(cursor, index)));
            const mark = document.createElement('mark');
            mark.textContent = text.slice(index, index + needle.length);
            parent.append(mark);
            cursor = index + needle.length;
        }
    }

    function queryString(params) {
        const search = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') search.set(key, value);
        });
        return search.toString();
    }

    async function apiUpload(path, formData) {
        const headers = {};
        const token = localStorage.getItem('tools_token');
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(path, { method: 'POST', headers, body: formData });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
    }

    function switchView(name) {
        exitCardFullscreen();
        state.activeView = name;
        document.querySelectorAll('.top-tab').forEach(button => button.classList.toggle('active', button.dataset.view === name));
        document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${name}`));
        if (name === 'chat') {
            applyConversationPaneWidth?.();
        }
        if (name === 'analytics') void loadStats();
        if (name === 'manage' && state.user && state.user.role === 'admin') {
            loadSources();
            loadParserRules();
        }
    }

    function conversationFilters() {
        return {
            q: $('conversationQuery').value.trim(),
            type: $('conversationType').value,
            unread: state.unreadOnly ? '1' : '',
            pinned: state.pinnedOnly ? '1' : '',
            limit: 40,
            offset: state.conversationOffset
        };
    }

    async function fetchConversationData(id, focusId = null) {
        const [conversation, messages] = await Promise.all([
            API.get(`/api/chat-history/conversations/${encodeURIComponent(id)}`),
            API.get(`/api/chat-history/conversations/${encodeURIComponent(id)}/messages?${focusId ? `around=${focusId}` : 'limit=80'}`)
        ]);
        const payload = {
            conversation,
            messages: messages.items || [],
            nextBefore: messages.nextBefore,
            hasMore: Boolean(messages.hasMore),
            fetchedAt: Date.now()
        };
        state.conversationCache.set(id, payload);
        return payload;
    }

    async function preloadConversations(conversations) {
        if (preloadRunning || !Array.isArray(conversations) || !conversations.length) return;
        preloadRunning = true;
        const queue = conversations.slice(0, 15);
        for (const item of queue) {
            if (!state.conversationCache.has(item.id)) {
                try {
                    await fetchConversationData(item.id);
                } catch (_err) { /* ignore preload error */ }
                await new Promise(resolve => setTimeout(resolve, 30));
            }
        }
        preloadRunning = false;
    }

    async function loadConversations(reset = true) {
        if (reset) state.conversationOffset = 0;
        const data = await API.get(`/api/chat-history/conversations?${queryString(conversationFilters())}`);
        state.settings.mySenderId = data.mySenderId || state.settings.mySenderId;
        state.conversations = reset ? data.items : state.conversations.concat(data.items);
        state.conversationTotal = data.total;
        state.conversationOffset = state.conversations.length;
        renderConversations();
    }

    function renderConversations() {
        const host = $('conversationList');
        host.replaceChildren();
        if (!state.conversations.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<span>🗂️</span><h2>暂无会话</h2><p>调整筛选条件或导入聊天记录。</p>';
            host.append(empty);
        }
        state.conversations.forEach(item => {
            const button = document.createElement('button');
            button.className = `conversation-item${state.activeConversation && state.activeConversation.id === item.id ? ' active' : ''}`;
            button.dataset.id = item.id;
            button.type = 'button';
            const avatar = document.createElement('span');
            avatar.className = 'conv-avatar';
            avatar.textContent = (item.display_name || '?').slice(0, 1).toUpperCase();
            const body = document.createElement('span');
            body.className = 'conv-body';
            const top = document.createElement('span');
            top.className = 'conv-top';
            const name = document.createElement('span');
            name.className = 'conv-name';
            name.textContent = `${item.pinned ? '📌 ' : ''}${item.display_name}`;
            const time = document.createElement('span');
            time.className = 'conv-time';
            time.textContent = shortTime(item.last_message_time);
            top.append(name, time);
            const bottom = document.createElement('span');
            bottom.className = 'conv-bottom';
            const preview = document.createElement('span');
            preview.className = 'conv-preview';
            preview.textContent = compactText(item.last_message || '暂无消息');
            const type = document.createElement('span');
            type.className = 'type-dot';
            type.textContent = typeLabels[item.conversation_type] || '其他';
            bottom.append(preview, type);
            if (Number(item.unread_count) > 0) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = Number(item.unread_count) > 99 ? '99+' : item.unread_count;
                bottom.append(badge);
            }
            body.append(top, bottom);
            button.append(avatar, body);
            button.addEventListener('click', () => openConversation(item.id));
            button.addEventListener('mouseenter', () => {
                if (!state.conversationCache.has(item.id)) {
                    fetchConversationData(item.id).catch(() => {});
                }
            });
            host.append(button);
        });
        const hasMoreConvs = state.conversations.length < state.conversationTotal;
        $('loadMoreConversations').hidden = !hasMoreConvs;
        if (hasMoreConvs) {
            $('loadMoreConversations').textContent = `加载更多会话 (${state.conversations.length} / ${state.conversationTotal})`;
        }
        preloadConversations(state.conversations);
    }

    function applyConversationData(data, id, focusId, fromSearch, updateScroll = true) {
        const { conversation, messages, hasMore, nextBefore } = data;
        state.activeConversation = conversation;
        state.messages = messages;
        state.nextBefore = nextBefore;
        $('chatEmpty').hidden = true;
        $('chatWorkspace').hidden = false;
        document.body.classList.add('has-chat');
        $('chatName').textContent = conversation.display_name;
        $('chatAvatar').textContent = (conversation.display_name || '?').slice(0, 1).toUpperCase();
        $('chatMeta').textContent = `${typeLabels[conversation.conversation_type] || '其他'} · ${formatNumber(conversation.message_count)} 条消息 · ${formatNumber(conversation.participant_count)} 人`;
        $('pinButton').classList.toggle('active', Boolean(conversation.pinned));
        $('loadOlderMessages').hidden = !hasMore;
        renderMessages(state.messages, fromSearch && state.lastSearch ? state.lastSearch.keyword : '', focusId);
        renderConversationDetail(conversation);
        document.querySelectorAll('.conversation-item').forEach(el => {
            const isTarget = el.dataset.id === id;
            el.classList.toggle('active', isTarget);
            if (isTarget) {
                const badge = el.querySelector('.badge');
                if (badge) badge.remove();
            }
        });

        if (updateScroll) {
            const scroller = $('messageScroller');
            requestAnimationFrame(() => {
                if (focusId) {
                    const target = document.querySelector(`[data-message-id="${focusId}"]`);
                    if (target && scroller) {
                        const scrollerRect = scroller.getBoundingClientRect();
                        const targetRect = target.getBoundingClientRect();
                        const delta = (targetRect.top - scrollerRect.top) - (scrollerRect.height / 2) + (targetRect.height / 2);
                        scroller.scrollTop += delta;
                    }
                } else {
                    const saved = localStorage.getItem(`chat-history-scroll:${id}`);
                    scroller.scrollTop = saved === null ? scroller.scrollHeight : Number(saved);
                }
            });
        }
    }

    async function openConversation(id, focusId = null, fromSearch = false) {
        if (state.activeConversation && state.activeConversation.id !== id) {
            localStorage.setItem(`chat-history-scroll:${state.activeConversation.id}`, String($('messageScroller').scrollTop));
            state.chatHits = [];
            $('chatSearch').value = '';
            if ($('clearChatInputBtn')) $('clearChatInputBtn').hidden = true;
            $('chatHitNav').hidden = true;
            $('clearChatSearch').hidden = true;
        }
        if (fromSearch && state.lastSearch) {
            $('searchReturnBanner').hidden = false;
            $('chatBackToSearch').hidden = false;
            const kw = state.lastSearch.keyword ? `“${state.lastSearch.keyword}”` : '当前搜索条件';
            $('searchReturnText').textContent = `正在查看搜索结果关联消息 · 关键词：${kw} · 第 ${state.lastSearch.page} 页 · 共 ${formatNumber(state.lastSearch.total)} 条匹配`;
        } else if (!fromSearch) {
            $('searchReturnBanner').hidden = true;
            $('chatBackToSearch').hidden = true;
        }

        const convSummary = state.conversations.find(c => c.id === id);
        if (convSummary) {
            state.activeConversation = { ...convSummary };
            if (Number(convSummary.unread_count) > 0) {
                convSummary.unread_count = 0;
            }
        }

        // Immediately remove unread badge and highlight active item in sidebar
        document.querySelectorAll('.conversation-item').forEach(el => {
            const isTarget = el.dataset.id === id;
            el.classList.toggle('active', isTarget);
            if (isTarget) {
                const badge = el.querySelector('.badge');
                if (badge) badge.remove();
            }
        });

        // Fire mark-as-read to backend API
        API.put(`/api/chat-history/conversations/${encodeURIComponent(id)}/read`, {}).catch(() => {});

        const cached = !focusId ? state.conversationCache.get(id) : null;
        if (cached) {
            applyConversationData(cached, id, focusId, fromSearch);
            if (Date.now() - cached.fetchedAt > 20000) {
                fetchConversationData(id).then(fresh => {
                    if (state.activeConversation && state.activeConversation.id === id && !focusId) {
                        applyConversationData(fresh, id, null, fromSearch, false);
                    }
                }).catch(() => {});
            }
        } else {
            $('chatEmpty').hidden = true;
            $('chatWorkspace').hidden = false;
            document.body.classList.add('has-chat');
            if (convSummary) {
                $('chatName').textContent = convSummary.display_name;
                $('chatAvatar').textContent = (convSummary.display_name || '?').slice(0, 1).toUpperCase();
                $('chatMeta').textContent = `${typeLabels[convSummary.conversation_type] || '其他'} · ${formatNumber(convSummary.message_count)} 条消息`;
            }
            try {
                const data = await fetchConversationData(id, focusId);
                applyConversationData(data, id, focusId, fromSearch);
            } catch (error) {
                showToast(error.message, true);
            }
        }
    }

    function renderMessages(items, keyword = '', focusId = null) {
        const host = $('messageList');
        host.replaceChildren();
        let lastDay = '';
        items.forEach(item => {
            const day = String(item.message_time || '').slice(0, 10);
            if (day !== lastDay) {
                const separator = document.createElement('div');
                separator.className = 'date-sep';
                const label = document.createElement('span');
                label.textContent = dayLabel(item.message_time);
                separator.append(label);
                host.append(separator);
                lastDay = day;
            }
            const mine = state.settings.mySenderId && String(item.sender_id) === String(state.settings.mySenderId);
            const row = document.createElement('div');
            row.className = `message-row ${mine ? 'mine' : 'other'}`;
            row.dataset.messageId = item.id;
            const meta = document.createElement('div');
            meta.className = 'message-meta';
            meta.textContent = `${mine ? '我' : (item.sender_name || item.sender_id || '未知')} · ${String(item.message_time || '').slice(11, 16)}`;
            const wrap = document.createElement('div');
            wrap.className = 'bubble-wrap';
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            if (Number(item.id) === Number(focusId)) bubble.style.boxShadow = '0 0 0 3px #e7b62e';
            appendHighlighted(bubble, item.content, keyword);
            bubble.title = '右键复制消息';
            bubble.addEventListener('contextmenu', async event => {
                event.preventDefault();
                try {
                    await navigator.clipboard.writeText(item.content || '');
                    showToast('已复制消息');
                } catch (_error) {
                    showToast('复制失败', true);
                }
            });
            const favorite = document.createElement('button');
            favorite.className = `favorite-btn${item.favorite ? ' active' : ''}`;
            favorite.textContent = item.favorite ? '★' : '☆';
            favorite.title = item.favorite ? '取消收藏' : '收藏';
            favorite.addEventListener('click', async () => {
                const next = !Boolean(item.favorite);
                try {
                    await API.put(`/api/chat-history/favorites/${encodeURIComponent(item.stable_key)}`, { favorite: next });
                    item.favorite = next ? 1 : 0;
                    favorite.classList.toggle('active', next);
                    favorite.textContent = next ? '★' : '☆';
                } catch (error) { showToast(error.message, true); }
            });
            wrap.append(bubble, favorite);
            row.append(meta, wrap);
            host.append(row);
        });
        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.innerHTML = '<span>🔎</span><h2>没有匹配的消息</h2>';
            host.append(empty);
        }
    }

    async function loadOlderMessages() {
        if (!state.activeConversation || !state.nextBefore) return;
        const scroller = $('messageScroller');
        const previousHeight = scroller.scrollHeight;
        const data = await API.get(`/api/chat-history/conversations/${encodeURIComponent(state.activeConversation.id)}/messages?before=${state.nextBefore}&limit=80`);
        state.messages = (data.items || []).concat(state.messages);
        state.nextBefore = data.nextBefore;
        $('loadOlderMessages').hidden = !data.hasMore;
        renderMessages(state.messages);
        requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight - previousHeight; });
    }

    function renderConversationDetail(conversation) {
        const host = $('detailContent');
        host.replaceChildren();
        const info = document.createElement('section');
        info.className = 'detail-section';
        info.innerHTML = '<h3>基本信息</h3>';
        const value = document.createElement('div');
        value.className = 'detail-value';
        value.textContent = `${typeLabels[conversation.conversation_type] || '其他'}\n${conversation.relative_path}\n${conversation.first_message_time || '-'} 至 ${conversation.last_message_time || '-'}`;
        info.append(value);
        const people = document.createElement('section');
        people.className = 'detail-section';
        people.innerHTML = '<h3>参与者</h3>';
        (conversation.participants || []).forEach(item => {
            const row = document.createElement('div');
            row.className = 'participant';
            const name = document.createElement('strong');
            name.textContent = `${item.sender_name || '未知'}${item.sender_id ? ` (${item.sender_id})` : ''}`;
            const count = document.createElement('span');
            count.textContent = `${formatNumber(item.message_count)} 条`;
            row.append(name, count);
            people.append(row);
        });
        host.append(info, people);
    }

    async function runChatSearch() {
        if (!state.activeConversation) return;
        const keyword = $('chatSearch').value.trim();
        if (!keyword) return;
        setLoading(true, '正在搜索当前会话…');
        try {
            const data = await API.get(`/api/chat-history/search?${queryString({ keyword, conversationId: state.activeConversation.id, limit: 200 })}`);
            state.chatHits = data.items || [];
            state.chatHitIndex = 0;
            $('clearChatSearch').hidden = false;
            $('chatHitNav').hidden = !state.chatHits.length;
            if (!state.chatHits.length) {
                state.messages = [];
                renderMessages([], keyword);
            } else {
                await showChatHit(0);
            }
        } catch (error) { showToast(error.message, true); }
        finally { setLoading(false); }
    }

    async function showChatHit(index) {
        if (!state.activeConversation || !state.chatHits.length) return;
        state.chatHitIndex = Math.max(0, Math.min(index, state.chatHits.length - 1));
        const hit = state.chatHits[state.chatHitIndex];
        const data = await API.get(`/api/chat-history/conversations/${encodeURIComponent(state.activeConversation.id)}/messages?around=${hit.id}`);
        state.messages = data.items || [];
        state.nextBefore = null;
        $('loadOlderMessages').hidden = true;
        $('chatHitCount').textContent = `${state.chatHitIndex + 1} / ${state.chatHits.length}`;
        $('chatHitPrev').disabled = state.chatHitIndex === 0;
        $('chatHitNext').disabled = state.chatHitIndex >= state.chatHits.length - 1;
        renderMessages(state.messages, $('chatSearch').value.trim(), hit.id);
        requestAnimationFrame(() => document.querySelector(`[data-message-id="${hit.id}"]`)?.scrollIntoView({ block: 'center' }));
    }

    function collectSearchParams(offset = 0, limit = 50) {
        return {
            keyword: $('searchKeyword').value.trim(),
            sender: $('searchSender').value.trim(),
            type: $('searchType').value,
            direction: $('searchDirection').value,
            from: $('searchFrom').value,
            to: $('searchTo').value,
            favorites: $('searchFavorites').checked ? '1' : '',
            limit,
            offset
        };
    }

    async function runGlobalSearch(page = 1) {
        const params = collectSearchParams((page - 1) * 50, 50);
        if (!params.keyword && !params.sender && !params.type && !params.direction && !params.from && !params.to && !params.favorites) {
            showToast('请至少输入一个搜索条件', true);
            return;
        }
        setLoading(true, '正在检索聊天记录…');
        try {
            const data = await API.get(`/api/chat-history/search?${queryString(params)}`);
            state.searchPage = page;
            state.searchTotal = data.total;
            state.searchRows = data.items || [];
            state.searchParams = params;
            renderSearchResults(data);
        } catch (error) { showToast(error.message, true); }
        finally { setLoading(false); }
    }

    function renderSearchResults(data) {
        const host = $('searchResults');
        host.replaceChildren();
        $('searchSummary').textContent = `找到 ${formatNumber(data.total)} 条消息`;
        $('searchEngine').textContent = data.ftsAvailable ? 'FTS5 trigram 全文索引' : 'SQLite LIKE 兼容搜索';
        $('exportSearch').disabled = data.total === 0;
        const keyword = $('searchKeyword').value.trim();
        state.searchRows.forEach(item => {
            const card = document.createElement('article');
            card.className = 'search-item';
            card.dataset.searchMessageId = item.id;
            const head = document.createElement('div');
            head.className = 'search-item-head';
            const conversation = document.createElement('strong');
            conversation.textContent = item.display_name;
            const sender = document.createElement('span');
            sender.textContent = `${item.sender_name || item.sender_id || '未知'} · ${item.message_time}`;
            const spacer = document.createElement('span');
            spacer.className = 'spacer';
            const star = document.createElement('button');
            star.className = `favorite-btn${item.favorite ? ' active' : ''}`;
            star.textContent = item.favorite ? '★' : '☆';
            star.addEventListener('click', async () => {
                const next = !Boolean(item.favorite);
                await API.put(`/api/chat-history/favorites/${encodeURIComponent(item.stable_key)}`, { favorite: next });
                item.favorite = next ? 1 : 0;
                star.classList.toggle('active', next);
                star.textContent = next ? '★' : '☆';
            });
            head.append(conversation, sender, spacer, star);
            const content = document.createElement('div');
            content.className = 'search-content';
            appendHighlighted(content, item.content, keyword);
            const context = document.createElement('div');
            context.className = 'search-context';
            context.textContent = [item.previous_content && `上一条：${compactText(item.previous_content, 80)}`, item.next_content && `下一条：${compactText(item.next_content, 80)}`].filter(Boolean).join(' · ');
            const actions = document.createElement('div');
            actions.className = 'search-actions';
            const open = document.createElement('button');
            open.className = 'link-btn';
            open.textContent = '在会话中查看 →';
            open.addEventListener('click', async () => {
                state.lastSearch = {
                    keyword,
                    page: state.searchPage,
                    total: data.total,
                    targetMessageId: item.id
                };
                switchView('chat');
                await openConversation(item.conversation_id, item.id, true);
            });
            actions.append(open);
            card.append(head, content, context, actions);
            host.append(card);
        });
        const pages = Math.max(1, Math.ceil(data.total / 50));
        $('searchPage').textContent = `${state.searchPage} / ${pages}`;
        $('searchPrev').disabled = state.searchPage <= 1;
        $('searchNext').disabled = state.searchPage >= pages;
    }

    function returnToSearch() {
        switchView('search');
        $('searchReturnBanner').hidden = true;
        $('chatBackToSearch').hidden = true;
        if (state.lastSearch && state.lastSearch.targetMessageId) {
            const targetId = state.lastSearch.targetMessageId;
            requestAnimationFrame(() => {
                const card = document.querySelector(`[data-search-message-id="${targetId}"]`);
                if (card) {
                    card.classList.add('highlight-target');
                    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    setTimeout(() => card.classList.remove('highlight-target'), 3500);
                }
            });
        }
    }

    async function exportSearch() {
        if (!state.searchParams || !state.searchTotal) return;
        setLoading(true, '正在生成 Excel…');
        try {
            const rows = [];
            const maxRows = Math.min(state.searchTotal, 50000);
            for (let offset = 0; offset < maxRows; offset += 200) {
                const data = await API.get(`/api/chat-history/search?${queryString({ ...state.searchParams, offset, limit: 200 })}`);
                rows.push(...data.items);
                if (!data.items.length) break;
            }
            const data = rows.map(item => ({
                '会话': item.display_name,
                '类型': typeLabels[item.conversation_type] || '其他',
                '发送人': item.sender_name,
                '发送人工号': item.sender_id,
                '时间': item.message_time,
                '消息内容': item.content,
                '是否收藏': item.favorite ? '是' : '否'
            }));
            const sheet = XLSX.utils.json_to_sheet(data);
            sheet['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 21 }, { wch: 70 }, { wch: 10 }];
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, '聊天搜索结果');
            XLSX.writeFile(book, `聊天记录_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.xlsx`);
            if (state.searchTotal > 50000) showToast('数据过多，本次导出前 50,000 条');
        } catch (error) { showToast(error.message, true); }
        finally { setLoading(false); }
    }

    async function loadStats() {
        if (statsLoadPromise) return statsLoadPromise;
        statsLoadPromise = (async () => {
            resetAnalyticsPaging();
            setLoading(true, '正在读取会话概览…', 5);
            try {
                const overview = await withServiceProgress(API.get('/api/chat-history/stats/overview'), 'overview');
                renderOverview(overview);
                setLoading(true, '正在统计参与人员…', 30);
                await yieldToBrowser();

                const people = await API.get(`/api/chat-history/stats/people?${queryString({ q: $('peopleQuery').value.trim(), limit: ANALYTICS_PAGE_SIZE, offset: 0 })}`);
                renderPeople(applyAnalyticsPage('people', people), people.total);
                setLoading(true, '正在加载工号映射库…', 55);
                await yieldToBrowser();

                const directory = await API.get(`/api/chat-history/directory?${queryString({ q: $('directoryQuery').value.trim(), limit: ANALYTICS_PAGE_SIZE, offset: 0 })}`);
                renderDirectory(applyAnalyticsPage('directory', directory), directory.total);
                setLoading(true, '正在统计群组与讨论组…', 75);
                await yieldToBrowser();

                const groups = await API.get(`/api/chat-history/stats/groups?${queryString({ q: ($('groupQuery')?.value || '').trim(), type: $('groupTypeFilter')?.value || '', limit: ANALYTICS_PAGE_SIZE, offset: 0 })}`);
                renderGroups(applyAnalyticsPage('groups', groups), groups.total);
                updateAnalyticsCacheStatus([overview, people, groups]);
                setLoading(true, '正在完成页面渲染…', 100);
                await yieldToBrowser();
            } catch (error) {
                showToast(error.message, true);
            } finally {
                setLoading(false);
                statsLoadPromise = null;
            }
        })();
        return statsLoadPromise;
    }

    async function refreshAnalytics() {
        setLoading(true, '正在刷新分析缓存…', 5);
        try {
            await API.post('/api/chat-history/stats/refresh', {});
            await loadStats();
            showToast('数据洞察已重新分析并缓存');
        } catch (error) {
            showToast(error.message, true);
        } finally {
            setLoading(false);
        }
    }

    async function loadDirectory(query = '', options = {}) {
        const append = options.append === true;
        const page = state.analyticsPaging.directory;
        if (append && (page.loading || !page.hasMore)) return;
        const requestId = append ? page.requestId : ++page.requestId;
        page.loading = true;
        setLazyTableLoading('directory', append);
        try {
            const offset = append ? page.offset : 0;
            const data = await API.get(`/api/chat-history/directory?${queryString({ q: query, limit: ANALYTICS_PAGE_SIZE, offset })}`);
            if (requestId !== page.requestId) return;
            renderDirectory(applyAnalyticsPage('directory', data, append), data.total);
        } catch (error) { showToast(error.message, true); }
        finally {
            if (requestId === page.requestId) {
                page.loading = false;
                setLazyTableLoading('directory', false);
            }
        }
    }

    async function loadPeopleOnly(options = {}) {
        const append = options.append === true;
        const page = state.analyticsPaging.people;
        if (append && (page.loading || !page.hasMore)) return;
        const requestId = append ? page.requestId : ++page.requestId;
        page.loading = true;
        setLazyTableLoading('people', append);
        try {
            const offset = append ? page.offset : 0;
            const data = await API.get(`/api/chat-history/stats/people?${queryString({ q: $('peopleQuery').value.trim(), limit: ANALYTICS_PAGE_SIZE, offset })}`);
            if (requestId !== page.requestId) return;
            renderPeople(applyAnalyticsPage('people', data, append), data.total);
        } catch (error) { showToast(error.message, true); }
        finally {
            if (requestId === page.requestId) {
                page.loading = false;
                setLazyTableLoading('people', false);
            }
        }
    }

    function renderOverview(data) {
        const summary = data.summary || {};
        const others = Number(summary.message_count || 0) - Number(summary.my_messages || 0);
        const unidentCount = Number(summary.unidentified_messages || 0);
        const metrics = [
            { label: '会话总数', value: summary.conversation_count, type: 'default' },
            { label: '消息总数', value: summary.message_count, type: 'default' },
            { label: '数据识别率', value: summary.recognition_rate || '100.0%', type: 'info' },
            { label: '工号已识别', value: summary.identified_messages || summary.message_count, type: 'default' },
            {
                label: '未识别工号',
                value: unidentCount,
                type: unidentCount > 0 ? 'warn kpi-clickable' : 'default kpi-clickable',
                actionHint: '查看明细 →',
                onClick: openUnidentifiedDialog
            },
            { label: '映射人员库', value: summary.directory_person_count || summary.participant_count, type: 'default' },
            { label: '我发送', value: summary.my_messages, type: 'default' },
            { label: '他人发送', value: others, type: 'default' }
        ];
        const kpis = $('kpiGrid');
        kpis.replaceChildren();
        metrics.forEach(item => {
            const card = document.createElement('div');
            card.className = `kpi ${item.type.includes('warn') ? 'kpi-warn' : item.type.includes('info') ? 'kpi-info' : ''} ${item.type.includes('kpi-clickable') ? 'kpi-clickable' : ''}`;
            const name = document.createElement('label');
            name.textContent = item.label;
            if (item.actionHint) {
                const hint = document.createElement('span');
                hint.className = 'kpi-action-hint';
                hint.textContent = item.actionHint;
                name.append(hint);
            }
            const number = document.createElement('strong');
            number.textContent = typeof item.value === 'number' ? formatNumber(item.value) : item.value;
            card.append(name, number);
            if (item.onClick) {
                card.addEventListener('click', item.onClick);
            }
            kpis.append(card);
        });
        const months = data.months || [];
        const maxMonth = Math.max(1, ...months.map(item => Number(item.message_count)));
        const monthChart = $('monthChart');
        monthChart.replaceChildren();
        months.forEach(item => {
            const col = document.createElement('div');
            col.className = 'bar-col';
            col.title = `${item.month}: ${formatNumber(item.message_count)}`;
            const bar = document.createElement('i');
            bar.style.height = `${Math.max(2, Number(item.message_count) / maxMonth * 92)}%`;
            const label = document.createElement('span');
            label.textContent = item.month;
            col.append(bar, label);
            monthChart.append(col);
        });
        const hourMap = new Map((data.hours || []).map(item => [Number(item.hour), Number(item.message_count)]));
        const maxHour = Math.max(1, ...hourMap.values());
        const hourChart = $('hourChart');
        hourChart.replaceChildren();
        for (let hour = 0; hour < 24; hour += 1) {
            const value = hourMap.get(hour) || 0;
            const cell = document.createElement('div');
            cell.className = 'hour-cell';
            cell.style.background = `rgba(18,163,111,${0.08 + value / maxHour * 0.78})`;
            cell.textContent = `${String(hour).padStart(2, '0')}:00`;
            cell.title = `${formatNumber(value)} 条消息`;
            hourChart.append(cell);
        }
        const types = data.types || [];
        const maxType = Math.max(1, ...types.map(item => Number(item.message_count)));
        const typeHost = $('typeStats');
        typeHost.replaceChildren();
        types.forEach(item => {
            const row = document.createElement('div');
            row.className = 'type-row';
            const top = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = typeLabels[item.type] || '其他';
            const number = document.createElement('span');
            number.textContent = `${formatNumber(item.conversation_count)} 会话 · ${formatNumber(item.message_count)} 消息`;
            top.append(name, number);
            const bar = document.createElement('i');
            bar.style.setProperty('--value', `${Number(item.message_count) / maxType * 100}%`);
            row.append(top, bar);
            typeHost.append(row);
        });
    }

    async function openUnidentifiedDialog() {
        setLoading(true, '正在加载未识别消息明细…');
        try {
            const res = await API.get('/api/chat-history/stats/unidentified?limit=100');
            const table = $('unidentifiedTable');
            table.replaceChildren();
            const items = res.items || [];
            if (!items.length) {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="5" style="text-align:center;color:var(--green);padding:24px;font-weight:600;">🎉 暂无未识别工号或格式异常的消息！所有消息发送人工号识别率 100%。</td>';
                table.append(row);
            } else {
                items.forEach(item => {
                    const tr = document.createElement('tr');
                    const conv = document.createElement('td');
                    conv.innerHTML = `<strong>${escapeHtml(item.display_name)}</strong><small style="display:block;color:var(--muted);">${escapeHtml(item.relative_path || '')}</small>`;
                    const sender = document.createElement('td');
                    sender.textContent = item.sender_name || '（完全缺失）';
                    const issue = document.createElement('td');
                    issue.innerHTML = `<span class="badge-warn">${escapeHtml(item.issue_type)}</span>`;
                    const time = document.createElement('td');
                    time.textContent = item.message_time || '-';
                    const content = document.createElement('td');
                    content.textContent = compactText(item.content || '', 90);
                    tr.append(conv, sender, issue, time, content);
                    table.append(tr);
                });
            }
            $('unidentifiedDialog').showModal();
        } catch (err) {
            showToast(err.message, true);
        } finally {
            setLoading(false);
        }
    }

    function renderDirectory(items, total = items.length) {
        state.tableData.directory = items;
        if ($('directoryMeta')) {
            $('directoryMeta').textContent = Number(total) > items.length
                ? `（已加载 ${formatNumber(items.length)} / ${formatNumber(total)} 人，下滑继续加载）`
                : `（共 ${formatNumber(total)} 人，导入时自动学习并持久化存储）`;
        }
        renderTable('directory');
    }

    function renderDirectoryRows(items) {
        const body = $('directoryTable');
        body.replaceChildren();
        if (!items.length) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="8" style="text-align:center;color:var(--muted);padding:18px;">暂无匹配的人员映射数据（导入聊天记录时系统会自动提取并维护工号映射库）</td>';
            body.append(row);
            return;
        }
        items.forEach(item => {
            const tr = document.createElement('tr');
            const idTd = document.createElement('td');
            idTd.innerHTML = `<code>${escapeHtml(item.sender_id)}</code>`;
            idTd.title = item.sender_id || '';
            const nameTd = document.createElement('td');
            nameTd.innerHTML = `<strong>${escapeHtml(item.sender_name)}</strong>`;
            nameTd.title = item.sender_name || '';
            const aliasTd = document.createElement('td');
            aliasTd.textContent = item.alias_names || '-';
            aliasTd.title = item.alias_names || '-';
            aliasTd.style.color = 'var(--muted)';
            const convTd = document.createElement('td');
            convTd.textContent = `${formatNumber(item.conversation_count)} 个会话`;
            const msgTd = document.createElement('td');
            msgTd.textContent = `${formatNumber(item.message_count)} 条`;
            const firstTd = document.createElement('td');
            firstTd.textContent = item.first_seen_at ? item.first_seen_at.slice(0, 10) : '-';
            const lastTd = document.createElement('td');
            lastTd.textContent = item.last_seen_at ? item.last_seen_at.slice(0, 16) : '-';
            const actionTd = document.createElement('td');
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-small';
            editBtn.textContent = '✏️ 编辑姓名';
            editBtn.addEventListener('click', () => {
                $('editSenderId').value = item.sender_id;
                $('editSenderName').value = item.sender_name;
                $('editAliasNames').value = item.alias_names || '';
                $('editSyncMessages').checked = true;
                $('editPersonDialog').showModal();
            });
            actionTd.append(editBtn);
            tr.append(idTd, nameTd, aliasTd, convTd, msgTd, firstTd, lastTd, actionTd);
            body.append(tr);
        });
    }

    async function exportDirectory() {
        setLoading(true, '正在生成人员映射表…');
        try {
            const data = await API.get('/api/chat-history/directory?limit=10000');
            const rows = (data.items || []).map(item => ({
                '工号 (Sender ID)': item.sender_id,
                '映射姓名 (Name)': item.sender_name,
                '别名 / 曾用名': item.alias_names || '',
                '关联会话数': item.conversation_count,
                '发信总量': item.message_count,
                '首次活跃时间': item.first_seen_at || '',
                '最近活跃时间': item.last_seen_at || '',
                '最后更新时间': item.updated_at || ''
            }));
            const sheet = XLSX.utils.json_to_sheet(rows);
            sheet['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, '工号与姓名映射库');
            XLSX.writeFile(book, `工号与姓名映射表_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.xlsx`);
            showToast('工号姓名映射表已导出');
        } catch (error) {
            showToast(error.message, true);
        } finally {
            setLoading(false);
        }
    }

    function responseLabel(minutes) {
        if (minutes === null || minutes === undefined) return '-';
        const value = Number(minutes);
        if (value < 60) return `${Math.round(value)} 分钟`;
        return `${(value / 60).toFixed(1)} 小时`;
    }

    function renderPeople(items, total = items.length) {
        state.tableData.people = items;
        if ($('peopleStatsMeta')) {
            $('peopleStatsMeta').textContent = Number(total) > items.length
                ? `（已加载 ${formatNumber(items.length)} / ${formatNumber(total)} 人，下滑继续加载）`
                : `（共 ${formatNumber(total)} 位发言人员）`;
        }
        renderTable('people');
    }

    function renderPeopleRows(items) {
        const body = $('peopleTable');
        body.replaceChildren();
        if (!items.length) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="7" style="text-align:center;color:var(--muted);padding:18px;">暂无符合当前筛选条件的人员统计</td>';
            body.append(row);
            return;
        }
        items.forEach(item => {
            const row = document.createElement('tr');
            const person = document.createElement('td');
            const strong = document.createElement('strong');
            strong.textContent = `${item.sender_name || '未知'}${item.is_me ? ' （我）' : ''}`;
            const id = document.createElement('small');
            id.textContent = item.sender_id || '-';
            person.title = `${item.sender_name || '未知'}\n${item.sender_id || '-'}`;
            person.append(strong, id);
            [item.message_count, item.conversation_count, item.active_days, item.average_length, responseLabel(item.average_response_minutes), item.last_message_time || '-'].forEach(value => {
                const cell = document.createElement('td');
                cell.textContent = typeof value === 'number' ? formatNumber(value) : value;
                row.append(cell);
            });
            row.prepend(person);
            body.append(row);
        });
    }

    function renderGroups(items, total = items.length) {
        state.tableData.groups = items;
        state.analyticsPaging.groups.total = Number(total);
        if ($('groupStatsMeta')) {
            $('groupStatsMeta').textContent = Number(total) > items.length
                ? `（已加载 ${formatNumber(items.length)} / ${formatNumber(total)} 个，下滑继续加载）`
                : `（共 ${formatNumber(total)} 个群聊与讨论组）`;
        }
        renderTable('groups');
    }

    function renderGroupRows(items) {
        const body = $('groupsTable');
        if (!body) return;
        body.replaceChildren();
        if (!items.length) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="9" style="text-align:center;color:var(--muted);padding:18px;">暂无符合当前筛选条件的群组或讨论组</td>';
            body.append(row);
            return;
        }
        items.forEach(item => {
            const row = document.createElement('tr');

            // Name
            const nameTd = document.createElement('td');
            nameTd.className = 'group-name-cell';
            const link = document.createElement('a');
            link.className = 'group-name-link';
            link.href = 'javascript:void(0)';
            link.textContent = item.display_name || '未命名群聊';
            link.title = `${item.display_name || '未命名群聊'}\n点击查看该群运营深度分析`;
            link.addEventListener('click', e => {
                e.preventDefault();
                openGroupAnalysis(item.conversation_id);
            });
            nameTd.append(link);

            // Type
            const typeTd = document.createElement('td');
            const isGroup = item.conversation_type === 'group';
            const badgeClass = isGroup ? 'type-group' : item.conversation_type === 'discussion' ? 'type-discussion' : 'type-single';
            const badge = document.createElement('span');
            badge.className = `type-badge ${badgeClass}`;
            badge.textContent = typeLabels[item.conversation_type] || item.conversation_type || '其他';
            typeTd.append(badge);

            // Message Count
            const msgTd = document.createElement('td');
            msgTd.textContent = `${formatNumber(item.message_count)} 条`;

            // Sender Count
            const sendersTd = document.createElement('td');
            sendersTd.textContent = `${formatNumber(item.sender_count)} 人`;

            // Active Days
            const daysTd = document.createElement('td');
            daysTd.textContent = `${formatNumber(item.active_days)} 天`;

            // Top Speaker
            const topTd = document.createElement('td');
            if (item.top_speaker_name) {
                const pct = item.message_count > 0 ? Math.round((item.top_speaker_count / item.message_count) * 100) : 0;
                topTd.innerHTML = `<strong>${escapeHtml(item.top_speaker_name)}</strong> <small style="color:var(--muted)">(${formatNumber(item.top_speaker_count)}条 · ${pct}%)</small>`;
                topTd.title = `${item.top_speaker_name}\n${formatNumber(item.top_speaker_count)} 条 · ${pct}%`;
            } else {
                topTd.textContent = '-';
            }

            // Average Length
            const lenTd = document.createElement('td');
            lenTd.textContent = `${item.average_length || 0} 字`;

            // Last Message Time
            const lastTd = document.createElement('td');
            lastTd.textContent = item.last_message_time ? item.last_message_time.slice(0, 16) : '-';

            // Action
            const actTd = document.createElement('td');
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'btn btn-small';
            openBtn.textContent = '查看聊天 ↗';
            openBtn.title = '进入会话视图查看该群完整聊天记录';
            openBtn.addEventListener('click', async () => {
                switchView('chat');
                await openConversation(item.conversation_id);
            });
            actTd.append(openBtn);

            row.append(nameTd, typeTd, msgTd, sendersTd, daysTd, topTd, lenTd, lastTd, actTd);
            body.append(row);
        });
    }

    async function openGroupAnalysis(conversationId) {
        if (!conversationId) return;
        setLoading(true, '正在加载群组深度运营分析…');
        try {
            const data = await API.get(`/api/chat-history/stats/groups/${encodeURIComponent(conversationId)}/analysis`);
            state.groupAnalysis = data;
            const pendingPersonaStyle = state.user?.role === 'admin' ? readPendingPersonaStyle(conversationId) : '';
            if (pendingPersonaStyle) data.conversation.persona_style = pendingPersonaStyle;
            state.tableViews.groupMembers.filters.clear();
            updatePersonaStyleHeader();
            setPersonaStyleStatus(pendingPersonaStyle ? '已恢复上次选择，正在同步…' : '', pendingPersonaStyle ? 'saving' : '');

            // 1. Title & Meta
            $('groupAnalysisTitle').textContent = data.conversation.display_name || '未命名会话';
            const typeSpan = $('groupAnalysisType');
            const cType = data.conversation.conversation_type;
            typeSpan.textContent = typeLabels[cType] || cType || '群组';
            typeSpan.className = `type-badge ${cType === 'group' ? 'type-group' : cType === 'discussion' ? 'type-discussion' : 'type-single'}`;
            const firstDate = data.overview.first_message_time ? data.overview.first_message_time.slice(0, 10) : '-';
            const lastDate = data.overview.last_message_time ? data.overview.last_message_time.slice(0, 10) : '-';
            $('groupAnalysisMeta').textContent = `${data.conversation.relative_path} · 活跃跨度: ${firstDate} 至 ${lastDate}`;

            // 2. Diagnostics
            $('diagStructure').textContent = data.diagnosis.structure;
            $('diagCadence').textContent = data.diagnosis.cadence;
            $('diagStyle').textContent = data.diagnosis.style;
            $('diagSummaryText').textContent = data.diagnosis.summary;

            // 3. KPIs
            $('gkpiTotalMessages').textContent = `${formatNumber(data.overview.total_messages)} 条`;
            $('gkpiSpan').textContent = `存续跨度 ${data.overview.day_span} 天 · 密度 ${data.overview.activity_density}%`;
            $('gkpiSenderCount').textContent = `${formatNumber(data.overview.sender_count)} 人`;
            $('gkpiAvgMemberMsg').textContent = `人均发信 ${data.overview.avg_member_messages} 条`;
            $('gkpiActiveDays').textContent = `${formatNumber(data.overview.active_days)} 天`;
            $('gkpiAvgDailyMsg').textContent = `日均发信 ${data.overview.avg_daily_messages} 条`;
            $('gkpiConcentration').textContent = `${data.overview.top2_concentration}%`;
            $('gkpiAvgResponse').textContent = data.overview.overall_avg_response !== null ? responseLabel(data.overview.overall_avg_response) : '-';
            $('gkpiAvgLength').textContent = `${data.overview.average_length} 字`;

            // 4. 24h Hourly Bars & Badges
            const maxHourCount = Math.max(...data.hourly_distribution.map(d => d.count), 1);
            let peakHour = data.hourly_distribution[0];
            let workHoursCount = 0;
            data.hourly_distribution.forEach(h => {
                if (h.count > peakHour.count) peakHour = h;
                if (h.hour >= 9 && h.hour < 18) workHoursCount += h.count;
            });
            const workPct = data.overview.total_messages > 0 ? Math.round((workHoursCount / data.overview.total_messages) * 100) : 0;

            const summaryHost = $('groupHourlySummary');
            if (summaryHost) {
                summaryHost.replaceChildren();
                const peakBadge = document.createElement('span');
                peakBadge.className = 'hourly-badge peak-badge';
                peakBadge.textContent = `🔥 活跃峰值: ${peakHour.hour}:00 - ${peakHour.hour + 1}:00 (${peakHour.count}条)`;
                const workBadge = document.createElement('span');
                workBadge.className = 'hourly-badge';
                workBadge.textContent = `💼 工作时段 (9:00-18:00): 占 ${workPct}%`;
                summaryHost.append(peakBadge, workBadge);
            }

            const hourlyHost = $('groupHourlyBars');
            hourlyHost.replaceChildren();
            data.hourly_distribution.forEach(h => {
                const col = document.createElement('div');
                const isPeak = h.hour === peakHour.hour && h.count > 0;
                col.className = `group-hour-col${isPeak ? ' is-peak' : ''}`;
                col.title = `${h.hour}:00 - ${h.hour}:59\n累计发信: ${h.count} 条${isPeak ? '（全天峰值）' : ''}`;

                if (h.count > 0) {
                    const countNum = document.createElement('span');
                    countNum.className = 'group-hour-count';
                    countNum.textContent = String(h.count);
                    col.append(countNum);
                }

                const bar = document.createElement('div');
                bar.className = 'group-hour-bar';
                const heightPct = Math.max(4, Math.round((h.count / maxHourCount) * 100));
                bar.style.height = `${heightPct}%`;
                if (h.count === 0) bar.style.opacity = '0.2';

                const label = document.createElement('span');
                label.className = 'group-hour-label';
                label.textContent = h.hour % 2 === 0 ? `${h.hour}h` : '';

                col.append(bar, label);
                hourlyHost.append(col);
            });

            // 5. Members table
            state.tableData.groupMembers = data.members || [];
            $('groupMembersCount').textContent = `（共 ${state.tableData.groupMembers.length} 位发言成员）`;
            if ($('groupMemberSearch')) $('groupMemberSearch').value = '';
            renderTable('groupMembers');

            // 6. Jump and Close buttons
            const dlg = $('groupAnalysisDialog');
            const closeGroupAnalysis = () => {
                if (dlg && dlg.open) dlg.close();
            };
            if ($('closeGroupAnalysisDialog')) $('closeGroupAnalysisDialog').onclick = closeGroupAnalysis;
            if ($('closeGroupAnalysisBtn')) $('closeGroupAnalysisBtn').onclick = closeGroupAnalysis;
            if (dlg) {
                dlg.onclick = event => {
                    if (event.target === dlg) closeGroupAnalysis();
                };
            }

            $('groupJumpChatBtn').onclick = async () => {
                closeGroupAnalysis();
                switchView('chat');
                await openConversation(data.conversation.id);
            };

            dlg.showModal();
            if (pendingPersonaStyle) void persistPersonaStyle(data, pendingPersonaStyle, { retry: true });
        } catch (error) {
            showToast(error.message, true);
        } finally {
            setLoading(false);
        }
    }

    function renderGroupMemberRows(items) {
        const body = $('groupMemberTable');
        if (!body) return;
        body.replaceChildren();

        const query = ($('groupMemberSearch')?.value || '').trim().toLowerCase();
        const displayItems = query
            ? items.filter(m => (m.sender_name || '').toLowerCase().includes(query) || (m.sender_id || '').toLowerCase().includes(query))
            : items;

        if (!displayItems.length) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="8" style="text-align:center;color:var(--muted);padding:18px;">未找到匹配的群成员</td>';
            body.append(row);
            return;
        }

        displayItems.forEach(item => {
            const row = document.createElement('tr');

            // Member name & ID
            const memberTd = document.createElement('td');
            const strong = document.createElement('strong');
            strong.textContent = `${item.sender_name || '未知'}${item.is_me ? ' （我）' : ''}`;
            const idSmall = document.createElement('small');
            idSmall.textContent = item.sender_id || '-';
            idSmall.style.display = 'block';
            idSmall.style.color = 'var(--muted)';
            idSmall.style.fontSize = '10px';
            memberTd.title = `${item.sender_name || '未知'}\n${item.sender_id || '-'}`;
            memberTd.append(strong, idSmall);

            // Role badge
            const roleTd = document.createElement('td');
            const canEditPersonaStyle = state.user?.role === 'admin';
            const badge = document.createElement(canEditPersonaStyle ? 'button' : 'span');
            if (canEditPersonaStyle) badge.type = 'button';
            badge.className = `role-badge role-badge-${item.role_level || 'low'}`;
            badge.textContent = personaRoleLabel(item.role_level);
            badge.title = canEditPersonaStyle
                ? `当前：${personaStyleSeries[currentPersonaStyle()].label}系列；点击切换下一系列并自动保存`
                : `当前：${personaStyleSeries[currentPersonaStyle()].label}系列`;
            if (canEditPersonaStyle) {
                badge.setAttribute('aria-label', `${badge.textContent}，点击切换画像风格`);
                badge.addEventListener('click', cyclePersonaStyle);
            }
            roleTd.append(badge);

            // Message count & progress bar
            const countTd = document.createElement('td');
            const pctBox = document.createElement('div');
            pctBox.className = 'msg-pct-bar';
            const pctTrack = document.createElement('span');
            pctTrack.className = 'msg-pct-track';
            const pctFill = document.createElement('i');
            pctFill.className = 'msg-pct-fill';
            pctFill.style.width = `${Math.min(100, item.message_percent || 0)}%`;
            pctTrack.append(pctFill);
            const countLabel = document.createElement('span');
            countLabel.textContent = `${formatNumber(item.message_count)} 条 (${item.message_percent}%)`;
            pctBox.append(pctTrack, countLabel);
            countTd.append(pctBox);

            // Active days
            const daysTd = document.createElement('td');
            daysTd.textContent = `${formatNumber(item.active_days)} 天`;

            // Daily frequency
            const freqTd = document.createElement('td');
            freqTd.textContent = `${item.daily_frequency || 0} 条/天`;

            // Avg length
            const lenTd = document.createElement('td');
            lenTd.textContent = `${item.average_length || 0} 字`;

            // Avg response
            const respTd = document.createElement('td');
            respTd.textContent = item.average_response_minutes !== null ? responseLabel(item.average_response_minutes) : '-';

            // Last message time
            const lastTd = document.createElement('td');
            lastTd.textContent = item.last_message_time ? item.last_message_time.slice(0, 16) : '-';

            row.append(memberTd, roleTd, countTd, daysTd, freqTd, lenTd, respTd, lastTd);
            body.append(row);
        });
    }

    function openImportDialog() {
        $('importDialog').showModal();
    }

    async function importFiles(fileList, options = {}) {
        const files = [...fileList].filter(file => /\.txt$/i.test(file.name));
        if (!files.length) {
            showToast('选定目录中没有 TXT 文件', true);
            return;
        }
        $('importDialog').close();
        switchView('manage');
        $('importPanel').hidden = false;
        $('importLog').replaceChildren();
        let processed = 0;
        let imported = 0;
        let skipped = 0;
        let failed = 0;
        const batchSize = 20;
        for (let start = 0; start < files.length; start += batchSize) {
            const batch = files.slice(start, start + batchSize);
            const form = new FormData();
            const relativePaths = batch.map(file => file.webkitRelativePath || file.relativePath || file.name);
            form.append('relativePaths', JSON.stringify(relativePaths));
            form.append('modifiedAts', JSON.stringify(batch.map(file => file.lastModified || 0)));
            if (options.dataKind === 'test') form.append('dataKind', 'test');
            batch.forEach(file => form.append('files', file, file.name));
            $('importStage').textContent = `正在导入 ${relativePaths[0]}`;
            try {
                const result = await apiUpload('/api/chat-history/import', form);
                imported += Number(result.imported || 0);
                skipped += Number(result.skipped || 0);
                failed += (result.errors || []).length;
                (result.results || []).forEach(item => appendImportLog(`${item.skipped ? '跳过未变更' : '已导入'} · ${item.relativePath} · ${formatNumber(item.messageCount)} 条`, 'ok'));
                (result.errors || []).forEach(item => appendImportLog(`失败 · ${item.relativePath} · ${item.error}`, 'error'));
            } catch (error) {
                failed += batch.length;
                appendImportLog(`批次导入失败 · ${error.message}`, 'error');
            }
            processed += batch.length;
            const percent = Math.round(processed / files.length * 100);
            $('importProgress').style.width = `${percent}%`;
            $('importCount').textContent = `${processed} / ${files.length}`;
        }
        $('importStage').textContent = `导入完成：新增/更新 ${imported}，跳过 ${skipped}，失败 ${failed}`;
        showToast(failed ? '导入完成，部分文件失败' : '聊天记录导入完成', Boolean(failed));
        state.conversationCache.clear();
        await Promise.all([loadSources(), loadConversations(true)]);
        $('directoryInput').value = '';
        $('filesInput').value = '';
    }

    async function importTestData() {
        $('importDialog').close();
        setLoading(true, '正在生成全场景测试数据…');
        try {
            if (!state.settings.mySenderId) {
                try {
                    const res = await API.put('/api/chat-history/settings', { mySenderId: 'f84300033' });
                    state.settings.mySenderId = res.mySenderId;
                    $('mySenderId').value = res.mySenderId;
                } catch (_err) { /* ignore */ }
            }
            const myId = state.settings.mySenderId || 'f84300033';
            const files = window.ChatTestData ? window.ChatTestData.createTestFiles(myId) : [];
            if (!files.length) throw new Error('测试数据生成器未就绪，请检查脚本加载');
            await importFiles(files, { dataKind: 'test' });
            showToast('全场景测试聊天数据已导入成功！');
            switchView('chat');
            if (state.conversations && state.conversations.length) {
                await openConversation(state.conversations[0].id);
            }
        } catch (error) {
            showToast(`导入测试数据失败：${error.message}`, true);
        } finally {
            setLoading(false);
        }
    }

    function appendImportLog(message, kind) {
        const line = document.createElement('div');
        line.className = kind === 'error' ? 'log-error' : 'log-ok';
        line.textContent = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`;
        $('importLog').append(line);
        $('importLog').scrollTop = $('importLog').scrollHeight;
    }

    async function clearTestData() {
        const confirmed = window.confirm('确认要清空所有一键导入的测试聊天数据吗？\n\n- 删除已标记的测试数据及可安全识别的旧版测试会话\n- 真实导入的聊天记录将被完整保留\n- 清空后可随时再次一键导入测试数据');
        if (!confirmed) return;
        setLoading(true, '正在清空测试数据…');
        try {
            const res = await API.post('/api/chat-history/sources/clear-test-data');
            showToast(`已成功清空 ${res.deletedCount || 0} 个测试数据源！`);
            state.conversationCache.clear();
            state.activeConversation = null;
            $('chatEmpty').hidden = false;
            $('chatWorkspace').hidden = true;
            await Promise.all([loadSources(1), loadConversations(true)]);
            if (state.activeView === 'analytics') void loadStats();
        } catch (error) {
            showToast(error.message, true);
        } finally {
            setLoading(false);
        }
    }

    async function loadSources(page = 1) {
        if (!state.user || state.user.role !== 'admin') return;
        try {
            state.sourcePage = page;
            const q = $('sourceQuery') ? $('sourceQuery').value.trim() : '';
            const type = $('sourceType') ? $('sourceType').value : '';
            const data = await API.get(`/api/chat-history/sources?${queryString({ q, type, page, limit: 20 })}`);
            const sources = Array.isArray(data) ? data : (data.items || []);
            state.sourceTotal = data.total !== undefined ? data.total : sources.length;
            state.sourceTotalPages = data.totalPages || Math.max(1, Math.ceil(state.sourceTotal / 20));

            if ($('sourceTotalMeta')) {
                $('sourceTotalMeta').textContent = `共 ${formatNumber(state.sourceTotal)} 个数据源${q ? '（搜索结果）' : ''}`;
            }
            if ($('sourcePage')) {
                $('sourcePage').textContent = `${state.sourcePage} / ${state.sourceTotalPages}`;
            }
            if ($('sourcePrev')) $('sourcePrev').disabled = state.sourcePage <= 1;
            if ($('sourceNext')) $('sourceNext').disabled = state.sourcePage >= state.sourceTotalPages;

            const host = $('sourceList');
            host.replaceChildren();
            if (!sources.length) {
                const empty = document.createElement('div');
                empty.className = 'empty-state';
                empty.innerHTML = `<span>🗂️</span><h2>${q ? '没有匹配的数据源' : '尚未导入数据'}</h2><p>${q ? '尝试更改搜索关键词或类型筛选。' : '点击右上角导入 TXT 记录或测试数据。'}</p>`;
                host.append(empty);
                return;
            }
            sources.forEach(source => {
                const row = document.createElement('div');
                row.className = 'source-item';
                
                const info = document.createElement('div');
                info.className = 'source-info';

                const headLine = document.createElement('div');
                headLine.className = 'source-headline';
                
                const typeBadge = document.createElement('span');
                typeBadge.className = `type-badge type-${source.conversation_type || 'other'}`;
                typeBadge.textContent = typeLabels[source.conversation_type] || '其他';

                const name = document.createElement('strong');
                name.className = 'source-name';
                name.textContent = source.display_name || source.relative_path;

                const countBadge = document.createElement('span');
                countBadge.className = 'source-count-badge';
                countBadge.textContent = `${formatNumber(source.message_count)} 条消息`;

                headLine.append(typeBadge, name, countBadge);

                const meta = document.createElement('small');
                meta.className = 'source-meta';
                const sizeStr = formatBytes(source.file_size);
                meta.textContent = `${source.relative_path} · 大小: ${sizeStr} · 导入时间: ${source.imported_at ? source.imported_at.replace('T', ' ').slice(0, 19) : '-'}`;

                info.append(headLine, meta);

                const remove = document.createElement('button');
                remove.className = 'danger-btn';
                remove.type = 'button';
                remove.textContent = '删除';
                remove.addEventListener('click', () => {
                    openDeleteSourceDialog(source);
                });
                row.append(info, remove);
                host.append(row);
            });
        } catch (error) { showToast(error.message, true); }
    }

    let pendingDeleteSource = null;

    function openDeleteSourceDialog(source) {
        if (!source) return;
        pendingDeleteSource = source;
        const dialog = $('deleteSourceDialog');
        if (!dialog) return;

        const typeBadge = $('deleteSourceTypeBadge');
        if (typeBadge) {
            typeBadge.className = `type-badge type-${source.conversation_type || 'other'}`;
            typeBadge.textContent = typeLabels[source.conversation_type] || '其他';
        }

        const nameEl = $('deleteSourceName');
        if (nameEl) {
            nameEl.textContent = source.display_name || source.relative_path || '未命名数据源';
        }

        const countBadge = $('deleteSourceCountBadge');
        if (countBadge) {
            countBadge.textContent = `${formatNumber(source.message_count)} 条消息`;
        }

        const metaEl = $('deleteSourceMeta');
        if (metaEl) {
            const sizeStr = formatBytes(source.file_size);
            const importTime = source.imported_at ? source.imported_at.replace('T', ' ').slice(0, 19) : '-';
            metaEl.textContent = `${source.relative_path || ''} · 大小: ${sizeStr} · 导入时间: ${importTime}`;
        }

        const confirmBtn = $('confirmDeleteSourceBtn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '确认删除';
        }

        dialog.showModal();
    }

    function parserRuleTypeLabel(type) {
        return { contains: '包含', prefix: '开头匹配', exact: '整行相等', regex: '正则' }[type] || type;
    }

    function openParserRuleDialog(rule = null) {
        $('parserRuleDialogTitle').textContent = rule ? '编辑排除规则' : '新增排除规则';
        $('parserRuleId').value = rule ? rule.id : '';
        $('parserRuleName').value = rule ? rule.name : '';
        $('parserRuleType').value = rule ? rule.match_type : 'contains';
        $('parserRulePattern').value = rule ? rule.pattern : '';
        $('parserRuleEnabled').checked = rule ? Boolean(rule.enabled) : true;
        $('parserRuleDialog').showModal();
    }

    function renderParserRules() {
        const host = $('parserRuleList');
        host.replaceChildren();
        if (!state.parserRules.length) {
            host.innerHTML = '<div class="empty-state compact-empty"><span>🧩</span><h2>暂无排除规则</h2><p>新增规则后，匹配的脚本行将保留在上一条消息正文中。</p></div>';
            return;
        }
        state.parserRules.forEach(rule => {
            const row = document.createElement('div');
            row.className = `rule-item${rule.enabled ? '' : ' disabled'}`;
            const info = document.createElement('div');
            info.className = 'rule-info';
            const title = document.createElement('div');
            const name = document.createElement('strong');
            name.textContent = rule.name;
            const type = document.createElement('span');
            type.className = 'type-badge';
            type.textContent = parserRuleTypeLabel(rule.match_type);
            const source = document.createElement('span');
            source.className = `rule-status ${rule.enabled ? 'enabled' : ''}`;
            source.textContent = rule.enabled ? '已启用' : '已停用';
            title.append(name, type, source);
            const pattern = document.createElement('code');
            pattern.textContent = rule.pattern;
            info.append(title, pattern);
            const actions = document.createElement('div');
            actions.className = 'rule-actions';
            const toggle = document.createElement('button');
            toggle.className = 'btn btn-small';
            toggle.type = 'button';
            toggle.textContent = rule.enabled ? '停用' : '启用';
            toggle.addEventListener('click', async () => {
                try {
                    await API.put(`/api/chat-history/parser-rules/${rule.id}`, { enabled: !rule.enabled });
                    await loadParserRules();
                    showToast(`规则已${rule.enabled ? '停用' : '启用'}，重新导入后生效`);
                } catch (error) { showToast(error.message, true); }
            });
            const edit = document.createElement('button');
            edit.className = 'btn btn-small';
            edit.type = 'button';
            edit.textContent = '编辑';
            edit.addEventListener('click', () => openParserRuleDialog(rule));
            const remove = document.createElement('button');
            remove.className = 'danger-btn';
            remove.type = 'button';
            remove.textContent = '删除';
            remove.addEventListener('click', async () => {
                if (!window.confirm(`确认删除排除规则“${rule.name}”？`)) return;
                try {
                    await API.delete(`/api/chat-history/parser-rules/${rule.id}`);
                    await loadParserRules();
                    showToast('规则已删除，重新导入后生效');
                } catch (error) { showToast(error.message, true); }
            });
            actions.append(toggle, edit, remove);
            row.append(info, actions);
            host.append(row);
        });
    }

    async function loadParserRules() {
        if (!state.user || state.user.role !== 'admin') return;
        try {
            const data = await API.get('/api/chat-history/parser-rules');
            state.parserRules = data.items || [];
            renderParserRules();
        } catch (error) { showToast(error.message, true); }
    }

    async function initialize() {
        if (window.location.protocol === 'file:') {
            document.body.innerHTML = '<div class="empty-state" style="height:100vh"><span>🔒</span><h2>请从 Tools Platform 内打开</h2><p>此工具依赖平台的租户数据、登录鉴权和聊天服务。</p></div>';
            return;
        }
        applyTheme(state.theme);
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (state.theme === 'system') applyTheme('system');
            });
        }
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
        });
        setupInteractiveTableHeads();
        setupAnalyticsLazyLoading();
        setupConversationPaneResize();
        setLoading(true, '正在连接聊天记录服务…');
        try {
            const [user, settings] = await Promise.all([
                API.get('/api/auth/me'),
                withServiceProgress(API.get('/api/chat-history/settings'))
            ]);
            state.user = user;
            state.settings = settings;
            document.querySelectorAll('.admin-only').forEach(element => { element.hidden = user.role !== 'admin'; });
            $('tenantHint').textContent = `${user.username} · 租户共享数据 · 个人状态独立`;
            $('mySenderId').value = settings.mySenderId || '';
            await loadConversations(true);
        } catch (error) {
            showToast(error.message, true);
        } finally {
            setLoading(false);
        }
    }

    let directoryDebounce;
    document.querySelectorAll('.top-tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('conversationQuery').addEventListener('input', () => { clearTimeout(conversationDebounce); conversationDebounce = setTimeout(() => loadConversations(true), 250); });
    $('conversationType').addEventListener('change', () => loadConversations(true));
    $('unreadFilter').addEventListener('click', () => { state.unreadOnly = !state.unreadOnly; $('unreadFilter').classList.toggle('active', state.unreadOnly); loadConversations(true); });
    $('pinnedFilter').addEventListener('click', () => { state.pinnedOnly = !state.pinnedOnly; $('pinnedFilter').classList.toggle('active', state.pinnedOnly); loadConversations(true); });
    $('loadMoreConversations').addEventListener('click', () => loadConversations(false));
    $('loadOlderMessages').addEventListener('click', loadOlderMessages);
    $('toggleChatSearchBtn')?.addEventListener('click', () => {
        const bar = $('chatSearchbar');
        const willShow = bar.hidden;
        bar.hidden = !willShow;
        $('toggleChatSearchBtn').classList.toggle('active', willShow);
        if (willShow) {
            $('chatSearch').focus();
            $('chatSearch').select();
        }
    });
    $('chatSearch').addEventListener('input', () => {
        $('clearChatInputBtn').hidden = !$('chatSearch').value.trim();
    });
    $('clearChatInputBtn')?.addEventListener('click', () => {
        $('chatSearch').value = '';
        $('clearChatInputBtn').hidden = true;
        $('chatSearch').focus();
    });
    $('chatSearchButton').addEventListener('click', runChatSearch);
    $('chatSearch').addEventListener('keydown', event => {
        if (event.key === 'Enter') runChatSearch();
        if (event.key === 'Escape') {
            if (!$('clearChatSearch').hidden) {
                $('clearChatSearch').click();
            } else {
                $('chatSearch').value = '';
                $('clearChatInputBtn').hidden = true;
            }
        }
    });
    $('chatHitPrev').addEventListener('click', () => showChatHit(state.chatHitIndex - 1));
    $('chatHitNext').addEventListener('click', () => showChatHit(state.chatHitIndex + 1));
    $('clearChatSearch').addEventListener('click', () => {
        $('chatSearch').value = '';
        $('clearChatInputBtn').hidden = true;
        $('clearChatSearch').hidden = true;
        $('chatHitNav').hidden = true;
        state.chatHits = [];
        if (state.activeConversation) openConversation(state.activeConversation.id);
    });
    $('pinButton').addEventListener('click', async () => {
        if (!state.activeConversation) return;
        const next = !Boolean(state.activeConversation.pinned);
        await API.put(`/api/chat-history/conversations/${encodeURIComponent(state.activeConversation.id)}/pin`, { pinned: next });
        state.activeConversation.pinned = next ? 1 : 0;
        $('pinButton').classList.toggle('active', next);
        if (state.conversationCache.has(state.activeConversation.id)) {
            const cached = state.conversationCache.get(state.activeConversation.id);
            if (cached && cached.conversation) cached.conversation.pinned = next ? 1 : 0;
        }
        loadConversations(true);
    });
    $('detailButton').addEventListener('click', () => { $('detailPane').hidden = false; });
    $('closeDetail').addEventListener('click', () => { $('detailPane').hidden = true; });
    $('chatAvatar').addEventListener('click', () => document.body.classList.remove('has-chat'));
    $('mobileBackToConversations')?.addEventListener('click', () => document.body.classList.remove('has-chat'));
    $('returnToSearchButton')?.addEventListener('click', returnToSearch);
    $('chatBackToSearch')?.addEventListener('click', returnToSearch);
    $('dismissSearchBanner')?.addEventListener('click', () => { $('searchReturnBanner').hidden = true; });
    $('searchForm').addEventListener('submit', event => { event.preventDefault(); runGlobalSearch(1); });
    $('searchPrev').addEventListener('click', () => runGlobalSearch(state.searchPage - 1));
    $('searchNext').addEventListener('click', () => runGlobalSearch(state.searchPage + 1));
    $('exportSearch').addEventListener('click', exportSearch);
    $('refreshStats').addEventListener('click', () => void refreshAnalytics());
    $('closeTableFilter')?.addEventListener('click', closeTableFilterPopover);
    $('cancelTableFilter')?.addEventListener('click', closeTableFilterPopover);
    $('tableFilterSearch')?.addEventListener('input', event => renderTableFilterOptions(event.target.value));
    $('selectAllFilterValues')?.addEventListener('click', () => {
        if (!state.activeTableFilter) return;
        state.activeTableFilter.selected = new Set(state.activeTableFilter.values);
        renderTableFilterOptions($('tableFilterSearch').value);
    });
    $('clearFilterValues')?.addEventListener('click', () => {
        if (!state.activeTableFilter) return;
        state.activeTableFilter.selected.clear();
        renderTableFilterOptions($('tableFilterSearch').value);
    });
    $('applyTableFilter')?.addEventListener('click', () => {
        const active = state.activeTableFilter;
        if (!active) return;
        const view = state.tableViews[active.tableName];
        if (active.selected.size === active.values.length) view.filters.delete(active.key);
        else view.filters.set(active.key, new Set(active.selected));
        closeTableFilterPopover();
        renderTable(active.tableName);
    });
    $('peopleQuery').addEventListener('input', () => { clearTimeout(peopleDebounce); peopleDebounce = setTimeout(loadPeopleOnly, 250); });
    let groupDebounce;
    async function loadGroupsOnly(options = {}) {
        const append = options.append === true;
        const page = state.analyticsPaging.groups;
        if (append && (page.loading || !page.hasMore)) return;
        const requestId = append ? page.requestId : ++page.requestId;
        page.loading = true;
        setLazyTableLoading('groups', append);
        try {
            const offset = append ? page.offset : 0;
            const data = await API.get(`/api/chat-history/stats/groups?${queryString({ q: ($('groupQuery')?.value || '').trim(), type: $('groupTypeFilter')?.value || '', limit: ANALYTICS_PAGE_SIZE, offset })}`);
            if (requestId !== page.requestId) return;
            renderGroups(applyAnalyticsPage('groups', data, append), data.total);
        } catch (error) { showToast(error.message, true); }
        finally {
            if (requestId === page.requestId) {
                page.loading = false;
                setLazyTableLoading('groups', false);
            }
        }
    }
    $('groupQuery')?.addEventListener('input', () => {
        clearTimeout(groupDebounce);
        groupDebounce = setTimeout(loadGroupsOnly, 250);
    });
    $('groupTypeFilter')?.addEventListener('change', loadGroupsOnly);
    $('directoryQuery')?.addEventListener('input', () => {
        clearTimeout(directoryDebounce);
        directoryDebounce = setTimeout(() => loadDirectory($('directoryQuery').value.trim()), 250);
    });
    $('exportDirectoryBtn')?.addEventListener('click', exportDirectory);
    $('closeUnidentifiedDialog')?.addEventListener('click', () => $('unidentifiedDialog').close());
    $('closeUnidentifiedBtn')?.addEventListener('click', () => $('unidentifiedDialog').close());
    $('closeEditPersonDialog')?.addEventListener('click', () => $('editPersonDialog').close());
    $('cancelEditPersonBtn')?.addEventListener('click', () => $('editPersonDialog').close());
    $('editPersonForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const senderId = $('editSenderId').value.trim();
        const senderName = $('editSenderName').value.trim();
        const aliasNames = $('editAliasNames').value.trim();
        const syncMessages = $('editSyncMessages').checked;
        if (!senderId || !senderName) return;
        setLoading(true, '正在保存人员映射…');
        try {
            await API.put(`/api/chat-history/directory/${encodeURIComponent(senderId)}`, {
                senderName,
                aliasNames,
                syncMessages
            });
            $('editPersonDialog').close();
            showToast('人员姓名映射已更新');
            state.conversationCache.clear();
            await Promise.all([loadStats(), loadConversations(true)]);
            if (state.activeConversation) openConversation(state.activeConversation.id);
        } catch (error) {
            showToast(error.message, true);
        } finally {
            setLoading(false);
        }
    });
    $('clearTestDataBtn')?.addEventListener('click', clearTestData);
    $('addParserRuleBtn')?.addEventListener('click', () => openParserRuleDialog());
    $('closeParserRuleDialog')?.addEventListener('click', () => $('parserRuleDialog').close());
    $('cancelParserRuleBtn')?.addEventListener('click', () => $('parserRuleDialog').close());
    $('parserRuleForm')?.addEventListener('submit', async event => {
        event.preventDefault();
        const id = $('parserRuleId').value;
        const payload = {
            name: $('parserRuleName').value.trim(),
            matchType: $('parserRuleType').value,
            pattern: $('parserRulePattern').value.trim(),
            enabled: $('parserRuleEnabled').checked
        };
        try {
            if (id) await API.put(`/api/chat-history/parser-rules/${encodeURIComponent(id)}`, payload);
            else await API.post('/api/chat-history/parser-rules', payload);
            $('parserRuleDialog').close();
            await loadParserRules();
            showToast('解析排除规则已保存，重新导入原目录后生效');
        } catch (error) { showToast(error.message, true); }
    });
    $('settingsButton').addEventListener('click', () => $('settingsDialog').showModal());
    $('saveSettings').addEventListener('click', async event => {
        event.preventDefault();
        try {
            const result = await API.put('/api/chat-history/settings', { mySenderId: $('mySenderId').value.trim() });
            state.settings.mySenderId = result.mySenderId;
            $('settingsDialog').close();
            showToast('我的工号已保存');
            if (state.activeConversation) openConversation(state.activeConversation.id);
            loadConversations(true);
        } catch (error) { showToast(error.message, true); }
    });
    ['importButton', 'manageImportButton'].forEach(id => $(id)?.addEventListener('click', openImportDialog));
    $('closeImportDialog')?.addEventListener('click', () => $('importDialog').close());
    $('chooseDirectory')?.addEventListener('click', () => $('directoryInput').click());
    $('chooseFiles')?.addEventListener('click', () => $('filesInput').click());
    $('chooseTestData')?.addEventListener('click', importTestData);
    $('manageTestDataButton')?.addEventListener('click', importTestData);
    $('emptyImportTestData')?.addEventListener('click', importTestData);
    $('emptyImportDirectory')?.addEventListener('click', openImportDialog);
    $('directoryInput')?.addEventListener('change', event => importFiles(event.target.files));
    $('filesInput')?.addEventListener('change', event => importFiles(event.target.files));
    $('sourceQuery')?.addEventListener('input', () => {
        clearTimeout(sourceDebounce);
        sourceDebounce = setTimeout(() => loadSources(1), 250);
    });
    $('sourceType')?.addEventListener('change', () => loadSources(1));
    $('sourcePrev')?.addEventListener('click', () => {
        if (state.sourcePage > 1) loadSources(state.sourcePage - 1);
    });
    $('sourceNext')?.addEventListener('click', () => {
        if (state.sourcePage < state.sourceTotalPages) loadSources(state.sourcePage + 1);
    });
    $('refreshSources')?.addEventListener('click', () => loadSources(state.sourcePage));
    $('closeDeleteSourceDialog')?.addEventListener('click', () => $('deleteSourceDialog')?.close());
    $('cancelDeleteSourceBtn')?.addEventListener('click', () => $('deleteSourceDialog')?.close());
    $('confirmDeleteSourceBtn')?.addEventListener('click', async () => {
        if (!pendingDeleteSource) return;
        const source = pendingDeleteSource;
        const confirmBtn = $('confirmDeleteSourceBtn');
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = '正在删除…';
        }
        try {
            await API.delete(`/api/chat-history/sources/${encodeURIComponent(source.id)}`);
            $('deleteSourceDialog')?.close();
            showToast('数据源已成功删除');
            state.conversationCache.delete(source.conversation_id);
            pendingDeleteSource = null;
            await Promise.all([loadSources(state.sourcePage), loadConversations(true)]);
        } catch (error) {
            showToast(error.message, true);
        } finally {
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = '确认删除';
            }
        }
    });
    let scrollMemoryTimer;
    $('messageScroller').addEventListener('scroll', () => {
        if (!state.activeConversation || !$('chatHitNav').hidden) return;
        clearTimeout(scrollMemoryTimer);
        scrollMemoryTimer = setTimeout(() => {
            localStorage.setItem(`chat-history-scroll:${state.activeConversation.id}`, String($('messageScroller').scrollTop));
        }, 100);
    }, { passive: true });

    function toggleCardFullscreen(cardId) {
        const card = $(cardId);
        if (!card) return;
        const isCurrentlyFullscreen = card.classList.contains('card-fullscreen');

        document.querySelectorAll('.card.card-fullscreen').forEach(other => {
            other.classList.remove('card-fullscreen');
            const btn = other.querySelector('.card-fullscreen-btn');
            if (btn) {
                btn.classList.remove('active');
                btn.textContent = '⛶ 全屏';
                btn.title = '全屏查看表格';
            }
        });

        if (isCurrentlyFullscreen) {
            document.body.classList.remove('has-card-fullscreen');
        } else {
            card.classList.add('card-fullscreen');
            document.body.classList.add('has-card-fullscreen');
            const btn = card.querySelector('.card-fullscreen-btn');
            if (btn) {
                btn.classList.add('active');
                btn.textContent = '🗗 退出全屏';
                btn.title = '退出全屏模式 (Esc)';
            }
        }
    }

    function exitCardFullscreen() {
        const fullscreenCards = document.querySelectorAll('.card.card-fullscreen');
        if (!fullscreenCards.length) return;
        fullscreenCards.forEach(card => {
            card.classList.remove('card-fullscreen');
            const btn = card.querySelector('.card-fullscreen-btn');
            if (btn) {
                btn.classList.remove('active');
                btn.textContent = '⛶ 全屏';
                btn.title = '全屏查看表格';
            }
        });
        document.body.classList.remove('has-card-fullscreen');
    }

    document.querySelectorAll('.card-fullscreen-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            toggleCardFullscreen(btn.dataset.card);
        });
    });

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            const dlg = $('groupAnalysisDialog');
            if (dlg && dlg.open) {
                dlg.close();
                return;
            }
            if (document.body.classList.contains('has-card-fullscreen')) {
                exitCardFullscreen();
            }
        }
    });

    $('closeGroupAnalysisDialog')?.addEventListener('click', () => $('groupAnalysisDialog')?.close());
    $('closeGroupAnalysisBtn')?.addEventListener('click', () => $('groupAnalysisDialog')?.close());
    $('groupMemberSearch')?.addEventListener('input', () => {
        renderTable('groupMembers');
    });

    window.addEventListener('tools:languagechange', () => {
        window.parent?.postMessage({ type: 'tools-custom-tool-language', lang: localStorage.getItem('tools_lang') || 'zh-CN' }, window.location.origin);
    });
    document.addEventListener('DOMContentLoaded', initialize);
})();
