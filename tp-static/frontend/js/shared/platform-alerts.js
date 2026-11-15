// Shared platform capability: platform-alerts. See docs/frontend-architecture.md.
function formatAlertTime(value) {
    if (!value) return '-';
    const raw = String(value).trim();
    // SQLite CURRENT_TIMESTAMP is UTC but omits the timezone suffix.
    // Mark timezone-less database timestamps as UTC before formatting with
    // local Date getters, so each browser sees its own local time.
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
        ? `${raw.replace(' ', 'T')}Z`
        : raw;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return value || '-';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function alertTypeLabel(type) {
    if (type === 'config') return navT('nav.alert.config');
    if (type === 'security') return navT('nav.alert.security');
    if (type === 'user_action') return navT('nav.alert.userAction');
    if (type === 'alert') return navT('nav.alertCenter');
    return navT('nav.alert.system');
}

function severityLabel(severity) {
    return ({ info: 'Info', warn: 'Warn', error: 'Error', critical: 'Critical' })[severity] || 'Info';
}

async function fetchAlertCenterSummary() {
    const res = await fetch('/api/alert-center/summary', { headers: getAuthHeaderForNav() });
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

async function fetchAlertCenterEvents(filter = navState.alertCenter.filter) {
    const params = new URLSearchParams({ limit: '120' });
    if (filter === 'unread') params.set('status', 'unread');
    if (filter === 'config') params.set('type', 'config');
    if (filter === 'security') params.set('type', 'security');
    if (filter === 'user_action') params.set('type', 'user_action');
    if (filter === 'system') params.set('type', 'system');
    const res = await fetch(`/api/alert-center/events?${params.toString()}`, { headers: getAuthHeaderForNav() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const events = data.events || [];
    return filter === 'warn'
        ? events.filter(event => ['warn', 'error', 'critical'].includes(event.severity))
        : events;
}

function updateAlertCenterBadge(summary = navState.alertCenter.summary) {
    publishPlatformStatus({ unread: Number(summary?.unread) || 0 });
}

function stopAlertCenterPolling() {
    if (alertCenterPollTimer) {
        clearInterval(alertCenterPollTimer);
        alertCenterPollTimer = null;
    }
}

// 后台标签页不轮询（19 个页面都带导航栏，开着几个标签时各自每分钟回源一次）；切回来时补刷一次
let alertCenterVisibilityBound = false;
function startAlertCenterPolling(intervalMs = 60000) {
    stopAlertCenterPolling();
    if (!hasNavAuthToken()) return;
    alertCenterPollTimer = setInterval(() => {
        if (document.visibilityState !== 'hidden') refreshAlertCenterBadge();
    }, intervalMs);
    if (!alertCenterVisibilityBound) {
        alertCenterVisibilityBound = true;
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && alertCenterPollTimer) refreshAlertCenterBadge();
        });
    }
}

window.startAlertCenterPolling = startAlertCenterPolling;
window.stopAlertCenterPolling = stopAlertCenterPolling;

async function refreshAlertCenterBadge() {
    if (!hasNavAuthToken()) {
        stopAlertCenterPolling();
        updateAlertCenterBadge({ unread: 0 });
        return;
    }
    try {
        navState.alertCenter.summary = await fetchAlertCenterSummary();
        updateAlertCenterBadge();
    } catch (e) {
        if (e.status === 401 || (e.message && e.message.includes('401'))) {
            // 检测到 401 响应说明登录凭据失效，立即停止轮询，避免对服务端产生大量无效日志
            stopAlertCenterPolling();
            updateAlertCenterBadge({ unread: 0 });
            return;
        }
        console.warn('[AlertCenter] summary failed:', e);
    }
}

function ensureAlertCenterModal() {
    let modal = document.getElementById('alertCenterModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'alertCenterModal';
    modal.className = 'alert-center-modal';
    modal.innerHTML = `
        <div class="alert-center-backdrop" onclick="closeAlertCenter()"></div>
        <aside class="alert-center-panel" role="dialog" aria-modal="true" aria-labelledby="alertCenterTitle">
            <div class="alert-center-head">
                <div>
                    <h2 id="alertCenterTitle">${navEscape(navT('nav.alert.title'))}</h2>
                    <p>${navEscape(navT('nav.alert.subtitle'))}</p>
                </div>
                <button class="alert-center-close" type="button" onclick="closeAlertCenter()">×</button>
            </div>
            <div class="alert-center-summary" id="alertCenterSummary"></div>
            <div class="alert-center-toolbar">
                <div class="alert-center-filters" id="alertCenterFilters"></div>
                <div class="alert-center-actions">
                    <button type="button" onclick="markAllAlertCenterRead()">${navEscape(navT('nav.alert.markAll'))}</button>
                    <button type="button" onclick="archiveAllAlertCenter()">${navEscape(navT('nav.alert.archiveAll'))}</button>
                    <button type="button" onclick="reloadAlertCenter()">${navEscape(navT('nav.alert.refresh'))}</button>
                </div>
            </div>
            <div class="alert-center-list" id="alertCenterList">${navEscape(navT('nav.alert.loading'))}</div>
        </aside>
    `;
    document.body.appendChild(modal);
    return modal;
}

function renderAlertCenterFilters() {
    const el = document.getElementById('alertCenterFilters');
    if (!el) return;
    const filters = [
        ['all', navT('nav.alert.all')],
        ['unread', navT('nav.alert.unread')],
        ['warn', navT('nav.alert.warn')],
        ['config', navT('nav.alert.config')],
        ['security', navT('nav.alert.security')],
        ['user_action', navT('nav.alert.userAction')],
        ['system', navT('nav.alert.system')]
    ];
    el.innerHTML = filters.map(([id, label]) => `
        <button type="button" class="${navState.alertCenter.filter === id ? 'active' : ''}" onclick="setAlertCenterFilter('${id}')">${navEscape(label)}</button>
    `).join('');
}

function renderAlertCenterSummary() {
    const el = document.getElementById('alertCenterSummary');
    if (!el) return;
    const summary = navState.alertCenter.summary || {};
    el.innerHTML = `
        <div><span>${navEscape(navT('nav.alert.summaryTotal'))}</span><strong>${Number(summary.total) || 0}</strong></div>
        <div><span>${navEscape(navT('nav.alert.summaryUnread'))}</span><strong>${Number(summary.unread) || 0}</strong></div>
        <div><span>${navEscape(navT('nav.alert.summaryRisk'))}</span><strong>${Number(summary.warnOrAbove) || 0}</strong></div>
    `;
}

function renderAlertCenterList() {
    const list = document.getElementById('alertCenterList');
    if (!list) return;
    if (navState.alertCenter.loading) {
        list.innerHTML = `<div class="alert-center-empty">${navEscape(navT('nav.alert.loading'))}</div>`;
        return;
    }
    const events = navState.alertCenter.events || [];
    if (!events.length) {
        list.innerHTML = `<div class="alert-center-empty">${navEscape(navT('nav.alert.empty'))}</div>`;
        return;
    }
    list.innerHTML = events.map(event => {
        const meta = [
            event.actor ? `${navT('nav.alert.actor')}: ${event.actor}` : '',
            event.source ? `${navT('nav.alert.source')}: ${event.source}` : '',
            event.object_type || event.object_id ? `${navT('nav.alert.object')}: ${event.object_type || '-'} ${event.object_id || ''}` : ''
        ].filter(Boolean);
        const detailEntries = event.detail && typeof event.detail === 'object'
            ? Object.entries(event.detail).slice(0, 4)
            : [];
        return `
            <article class="alert-center-item ${navEscape(event.severity)} ${event.status === 'unread' ? 'unread' : ''}">
                <div class="alert-center-item-top">
                    <div class="alert-center-title-wrap">
                        <span class="alert-center-severity">${navEscape(severityLabel(event.severity))}</span>
                        <span class="alert-center-type">${navEscape(alertTypeLabel(event.event_type))}</span>
                        <strong>${navEscape(event.title)}</strong>
                    </div>
                    <time>${navEscape(formatAlertTime(event.created_at))}</time>
                </div>
                ${event.ai_summary ? `<div class="alert-center-ai-summary"><span>AI</span>${navEscape(event.ai_summary)}</div>` : ''}
                ${event.message ? `<div class="alert-center-message" onclick="this.classList.toggle('expanded')" title="点击展开/收起">${navEscape(event.message)}</div>` : ''}
                ${meta.length ? `<div class="alert-center-meta">${meta.map(navEscape).join(' · ')}</div>` : ''}
                ${detailEntries.length ? `<div class="alert-center-detail">${detailEntries.map(([k, v]) => `<span onclick="this.classList.toggle('expanded')" title="点击展开/收起">${navEscape(k)}: ${navEscape(typeof v === 'object' ? JSON.stringify(v) : v)}</span>`).join('')}</div>` : ''}
                <div class="alert-center-row-actions">
                    ${event.status === 'unread' ? `<button type="button" onclick="markAlertCenterRead('${navEscape(event.id)}')">${navEscape(navT('nav.alert.read'))}</button>` : ''}
                    <button type="button" onclick="archiveAlertCenterEvent('${navEscape(event.id)}')">${navEscape(navT('nav.alert.archive'))}</button>
                </div>
            </article>
        `;
    }).join('');
}

window.reloadAlertCenter = async function () {
    navState.alertCenter.loading = true;
    renderAlertCenterSummary();
    renderAlertCenterFilters();
    renderAlertCenterList();
    try {
        const [summary, events] = await Promise.all([
            fetchAlertCenterSummary(),
            fetchAlertCenterEvents()
        ]);
        navState.alertCenter.summary = summary;
        navState.alertCenter.events = events;
        updateAlertCenterBadge(summary);
    } catch (e) {
        const list = document.getElementById('alertCenterList');
        if (list) list.innerHTML = `<div class="alert-center-empty warning">${navEscape(navT('nav.alert.failLoad'))}${navEscape(e.message)}</div>`;
    } finally {
        navState.alertCenter.loading = false;
        renderAlertCenterSummary();
        renderAlertCenterFilters();
        renderAlertCenterList();
    }
};

window.openAlertCenter = function () {
    const modal = ensureAlertCenterModal();
    modal.classList.add('open');
    window.reloadAlertCenter();
};

window.closeAlertCenter = function () {
    document.getElementById('alertCenterModal')?.classList.remove('open');
};

window.setAlertCenterFilter = function (filter) {
    navState.alertCenter.filter = filter || 'all';
    window.reloadAlertCenter();
};

window.markAlertCenterRead = async function (id) {
    await fetch('/api/alert-center/events/read', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() },
        body: JSON.stringify({ ids: [id] })
    });
    window.reloadAlertCenter();
};

window.markAllAlertCenterRead = async function () {
    await fetch('/api/alert-center/events/read-all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }
    });
    window.reloadAlertCenter();
};

window.archiveAllAlertCenter = async function () {
    const confirmed = await showPlatformConfirm({
        title: navT('nav.alert.archiveConfirmTitle'),
        message: navT('nav.alert.archiveAllConfirm'),
        hint: navT('nav.alert.archiveConfirmHint'),
        cancelText: navT('nav.alert.archiveConfirmCancel'),
        confirmText: navT('nav.alert.archiveConfirmAction')
    });
    if (!confirmed) return;
    await fetch('/api/alert-center/events/archive-all', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaderForNav() }
    });
    window.reloadAlertCenter();
};

window.archiveAlertCenterEvent = async function (id) {
    await fetch(`/api/alert-center/events/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: getAuthHeaderForNav()
    });
    window.reloadAlertCenter();
};

