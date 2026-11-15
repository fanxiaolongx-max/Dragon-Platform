// Shared platform capability: platform-services. See docs/frontend-architecture.md.
async function checkServerStatus() {
    try {
        const response = await fetch('/api/health');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json();
        publishPlatformStatus({ online: true });
    } catch (_) {
        publishPlatformStatus({ online: false });
    }
}

let serviceStatusDays = 90;
let serviceStatusView = 'overview';
let serviceStatusTimer = null;
let serviceStatusRequestSeq = 0;
let serviceStatusRequestPending = false;
let serviceRuntimeLogPage = 1;
let serviceRuntimeLogTimer = null;
let serviceRuntimeLogRequestSeq = 0;

function serviceStatusBi(zh, en) {
    return window.ToolsI18n?.getLanguage?.() === 'en-US' ? en : zh;
}

function canInspectServiceFailures() {
    return localStorage.getItem('tools_role') === 'admin';
}

function serviceStateMeta(state) {
    const states = {
        operational: { icon: '✓', label: serviceStatusBi('正常', 'Operational') },
        degraded: { icon: '!', label: serviceStatusBi('部分请求失败', 'Degraded') },
        incident: { icon: '!', label: serviceStatusBi('服务异常', 'Incident') },
        'no-data': { icon: '·', label: serviceStatusBi('暂无数据', 'No data') }
    };
    return states[state] || states['no-data'];
}

function resolveOverallServiceStatusMeta(data = {}) {
    const services = Array.isArray(data.services) ? data.services : [];
    const overall = data.overall || {};
    const isEn = window.ToolsI18n?.getLanguage?.() === 'en-US';

    const incidentServices = services.filter(service => service.currentState === 'incident');
    const degradedServices = services.filter(service => service.currentState === 'degraded');
    const activeServices = services.filter(service => service.currentState !== 'no-data');

    if (!activeServices.length && overall.currentState === 'no-data') {
        return {
            state: 'no-data',
            icon: '·',
            label: serviceStatusBi('暂无数据', 'No data'),
            detail: serviceStatusBi('暂无请求数据', 'No request data available'),
            hasIssue: false
        };
    }

    if (activeServices.length > 0 && incidentServices.length === activeServices.length) {
        return {
            state: 'incident',
            icon: '!',
            label: serviceStatusBi('服务异常', 'Incident'),
            detail: serviceStatusBi('全部服务出现异常', 'All services experiencing incidents'),
            hasIssue: true
        };
    }

    if (incidentServices.length > 0) {
        const names = incidentServices.map(service => isEn ? (service.nameEn || service.name) : (service.name || service.id));
        let detail = '';
        if (isEn) {
            detail = names.length === 1
                ? `${names[0]} may experience issues`
                : names.length === 2
                    ? `${names[0]} & ${names[1]} may experience issues`
                    : `${names[0]} and ${names.length - 1} other services may experience issues`;
        } else {
            detail = names.length === 1
                ? `${names[0]}部分可能存在异常`
                : names.length === 2
                    ? `${names[0]}、${names[1]}部分可能存在异常`
                    : `${names[0]}等 ${names.length} 个服务可能存在异常`;
        }
        return {
            state: 'operational',
            icon: '✓',
            label: serviceStatusBi('正常', 'Operational'),
            detail,
            hasIssue: true
        };
    }

    if (degradedServices.length > 0) {
        const names = degradedServices.map(service => isEn ? (service.nameEn || service.name) : (service.name || service.id));
        let detail = '';
        if (isEn) {
            detail = names.length === 1
                ? `${names[0]} may experience issues`
                : names.length === 2
                    ? `${names[0]} & ${names[1]} may experience issues`
                    : `${names[0]} and ${names.length - 1} other services may experience issues`;
        } else {
            detail = names.length === 1
                ? `${names[0]}部分可能存在异常`
                : names.length === 2
                    ? `${names[0]}、${names[1]}部分可能存在异常`
                    : `${names[0]}等 ${names.length} 个服务可能存在异常`;
        }
        return {
            state: 'operational',
            icon: '✓',
            label: serviceStatusBi('正常', 'Operational'),
            detail,
            hasIssue: true
        };
    }

    return {
        state: 'operational',
        icon: '✓',
        label: serviceStatusBi('正常', 'Operational'),
        detail: serviceStatusBi('全部服务运行正常', 'All services operational'),
        hasIssue: false
    };
}

function licenseStatusMeta(license = {}) {
    if (!license.enabled) {
        return {
            state: 'no-data',
            icon: '—',
            label: serviceStatusBi('Web 部署', 'Web deployment'),
            detail: serviceStatusBi('无需桌面 License', 'Desktop License not required')
        };
    }
    const state = ['operational', 'degraded', 'incident'].includes(license.state) ? license.state : 'incident';
    const expiresAt = Number(license.expiresAt);
    const expiryText = Number.isFinite(expiresAt) && expiresAt > 0
        ? new Date(expiresAt).toLocaleString(window.ToolsI18n?.getLanguage?.() === 'en-US' ? 'en-US' : 'zh-CN')
        : serviceStatusBi('未知', 'Unknown');
    if (!license.valid) {
        return {
            state: 'incident',
            icon: '!',
            label: serviceStatusBi('License 已失效', 'License invalid'),
            detail: `${license.reasonCode || 'EXPIRED'} · ${serviceStatusBi('到期', 'Expires')} ${expiryText}`
        };
    }
    if (state === 'incident') {
        return {
            state,
            icon: '!',
            label: serviceStatusBi('License 即将到期', 'License expires imminently'),
            detail: `${serviceStatusBi('剩余', 'Remaining')} ${Number(license.hoursRemaining || 0)} ${serviceStatusBi('小时', 'hours')} · ${expiryText}`
        };
    }
    if (state === 'degraded') {
        return {
            state,
            icon: '!',
            label: serviceStatusBi('License 临近到期', 'License expires soon'),
            detail: `${serviceStatusBi('剩余', 'Remaining')} ${Number(license.daysRemaining || 0)} ${serviceStatusBi('天', 'days')} · ${expiryText}`
        };
    }
    return {
        state,
        icon: '✓',
        label: serviceStatusBi('License 可用', 'License active'),
        detail: `${serviceStatusBi('剩余', 'Remaining')} ${Number(license.daysRemaining || 0)} ${serviceStatusBi('天', 'days')} · ${expiryText}`
    };
}

function ensureServiceStatusModal() {
    let modal = document.getElementById('serviceStatusModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'serviceStatusModal';
    modal.className = 'service-status-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="service-status-dialog" role="dialog" aria-modal="true" aria-labelledby="serviceStatusTitle">
            <div class="service-status-head">
                <div>
                    <div class="service-status-kicker">TOOLS PLATFORM STATUS</div>
                    <h2 id="serviceStatusTitle"></h2>
                    <p id="serviceStatusSubtitle"></p>
                </div>
                <button type="button" class="service-status-close" onclick="closeServiceStatusModal()" aria-label="Close">×</button>
            </div>
            <div class="service-status-toolbar">
                <div class="service-status-tabs">
                    <button type="button" id="serviceStatusOverviewTab" onclick="setServiceStatusView('overview')">${serviceStatusBi('状态概览', 'Overview')}</button>
                    <button type="button" id="serviceStatusLogsTab" onclick="setServiceStatusView('logs')">${serviceStatusBi('运行日志', 'Runtime logs')}</button>
                    <button type="button" id="serviceStatusDiagTab" onclick="setServiceStatusView('diagnostics')">${serviceStatusBi('平台自检', 'Self-check')}</button>
                </div>
                <div class="service-status-toolbar-actions">
                    <div class="service-status-range" id="serviceStatusRange"></div>
                    <button type="button" class="service-status-refresh" onclick="refreshServiceStatusView()">↻ <span>${serviceStatusBi('刷新', 'Refresh')}</span></button>
                </div>
            </div>
            <div class="service-status-content" id="serviceStatusContent"></div>
        </div>`;
    modal.addEventListener('click', event => { if (event.target === modal) window.closeServiceStatusModal(); });
    document.body.appendChild(modal);
    return modal;
}

function ensureServiceFailureModal() {
    let modal = document.getElementById('serviceFailureModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'serviceFailureModal';
    modal.className = 'service-failure-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="service-failure-dialog" role="dialog" aria-modal="true" aria-labelledby="serviceFailureTitle">
            <div class="service-failure-head">
                <div><small>REQUEST DIAGNOSTICS</small><h3 id="serviceFailureTitle"></h3><p id="serviceFailureSubtitle"></p></div>
                <button type="button" onclick="closeServiceFailureModal()" aria-label="Close">×</button>
            </div>
            <div class="service-failure-content" id="serviceFailureContent"></div>
        </div>`;
    modal.addEventListener('click', event => { if (event.target === modal) window.closeServiceFailureModal(); });
    document.body.appendChild(modal);
    return modal;
}

function formatServiceFailureBody(value) {
    if (!value) return serviceStatusBi('（无内容）', '(empty)');
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch (_) { return value; }
}

window.openServiceFailureModal = async function (serviceKey = '', date = '', statusClass = '') {
    const modal = ensureServiceFailureModal();
    const serviceName = serviceKey
        ? document.querySelector(`[data-service-status-key="${serviceKey}"]`)?.dataset.serviceStatusName || serviceKey
        : serviceStatusBi('全部服务', 'All services');
    modal.style.display = 'flex';
    document.getElementById('serviceFailureTitle').textContent = serviceStatusBi('失败请求明细', 'Failed request details');
    document.getElementById('serviceFailureSubtitle').textContent = [serviceName, date, statusClass].filter(Boolean).join(' · ');
    const content = document.getElementById('serviceFailureContent');
    content.innerHTML = `<div class="service-status-loading"><span></span>${serviceStatusBi('正在读取失败记录…', 'Loading failed requests…')}</div>`;
    const query = new URLSearchParams({ limit: '100' });
    if (serviceKey) query.set('serviceKey', serviceKey);
    if (date) query.set('date', date);
    if (statusClass) query.set('statusClass', statusClass);
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status/failures?${query}`);
        const failures = data.failures || [];
        const authNotice = data.excludedAuthResponses > 0
            ? `<div class="service-status-notice">${serviceStatusBi('已排除', 'Excluded')} ${Number(data.excludedAuthResponses).toLocaleString()} ${serviceStatusBi('条正常登录或会话过期拦截，不计入服务异常；原始诊断记录仍保留。', 'expected login or session-expiry responses from service failures; original diagnostic records are retained.')}</div>`
            : '';
        if (!failures.length) {
            const hasFilter = Boolean(serviceKey || date || statusClass);
            content.innerHTML = `${authNotice}
                <div class="service-failure-empty">
                    <strong>${date ? `${navEscape(date)} · ${serviceStatusBi('该时间点无失败请求记录', 'No failure records for this time point')}` : serviceStatusBi('暂无可查看的失败明细', 'No failure details available')}</strong>
                    <p>${date ? `${navEscape(serviceName)} ${serviceStatusBi('在所选时间点运行正常，未产生 4xx 或 5xx 请求异常。', 'operated normally at this time with no 4xx or 5xx exceptions.')}` : serviceStatusBi('失败明细从本功能启用后开始记录，历史统计仍会保留。', 'Failure details are recorded after this feature is enabled; historical totals remain available.')}</p>
                    ${hasFilter ? `
                        <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                            ${date && serviceKey ? `<button type="button" class="service-failure-quick-btn" onclick="openServiceFailureModal('${navEscape(serviceKey)}','','')">${serviceStatusBi('查看该服务全部失败记录', 'View all failures for this service')}</button>` : ''}
                            ${(date || serviceKey) ? `<button type="button" class="service-failure-quick-btn" onclick="openServiceFailureModal('','','')">${serviceStatusBi('查看全平台所有失败记录', 'View all platform failures')}</button>` : ''}
                        </div>` : ''}
                </div>`;
            return;
        }
        content.innerHTML = authNotice + failures.map((failure, index) => `
            <details class="service-failure-item" ${index === 0 ? 'open' : ''}>
                <summary>
                    <span class="service-failure-code ${failure.statusCode >= 500 ? 'server' : 'client'}">${Number(failure.statusCode)}</span>
                    <b>${navEscape(failure.method)} ${navEscape(failure.path)}</b>
                    <time>${navEscape(new Date(failure.requestAt).toLocaleString())}</time>
                    <em>${Number(failure.durationMs)}ms</em>
                </summary>
                <div class="service-failure-meta"><span>Request ID</span><code>${navEscape(failure.requestId || '—')}</code></div>
                <div class="service-failure-columns">
                    <section><h4>${serviceStatusBi('请求内容（已脱敏）', 'Request (redacted)')}</h4><pre>${navEscape(formatServiceFailureBody(failure.requestBody))}</pre></section>
                    <section><h4>${serviceStatusBi('失败返回（已脱敏）', 'Failure response (redacted)')}</h4><pre>${navEscape(formatServiceFailureBody(failure.responseBody))}</pre></section>
                </div>
            </details>`).join('');
    } catch (error) {
        content.innerHTML = `<div class="service-status-error"><strong>${serviceStatusBi('失败明细读取失败', 'Unable to load failure details')}</strong><p>${navEscape(error.message)}</p></div>`;
    }
};

window.closeServiceFailureModal = function () {
    const modal = document.getElementById('serviceFailureModal');
    if (modal) modal.style.display = 'none';
};

window.openServiceStatusModal = function () {
    const modal = ensureServiceStatusModal();
    modal.style.display = 'flex';
    document.body.classList.add('service-status-open');
    document.getElementById('serviceStatusTitle').textContent = serviceStatusBi('服务状态中心', 'Service Status Center');
    document.getElementById('serviceStatusSubtitle').textContent = serviceStatusBi('基于平台真实 API 请求返回结果生成', 'Generated from actual platform API responses');
    const runtimeLogsTab = document.getElementById('serviceStatusLogsTab');
    if (runtimeLogsTab) runtimeLogsTab.hidden = !canInspectServiceFailures();
    const diagTab = document.getElementById('serviceStatusDiagTab');
    if (diagTab) diagTab.hidden = !canInspectServiceFailures();
    window.setServiceStatusView('overview');
};

window.closeServiceStatusModal = function () {
    const modal = document.getElementById('serviceStatusModal');
    if (modal) modal.style.display = 'none';
    document.body.classList.remove('service-status-open');
    window.clearServiceStatusPolling();
    window.clearServiceRuntimeLogPolling();
};

window.setServiceStatusView = function (view) {
    serviceStatusView = ['logs', 'diagnostics'].includes(view) && canInspectServiceFailures() ? view : 'overview';
    document.getElementById('serviceStatusOverviewTab')?.classList.toggle('active', serviceStatusView === 'overview');
    document.getElementById('serviceStatusLogsTab')?.classList.toggle('active', serviceStatusView === 'logs');
    document.getElementById('serviceStatusDiagTab')?.classList.toggle('active', serviceStatusView === 'diagnostics');
    if (serviceStatusView === 'diagnostics') {
        const subtitle = document.getElementById('serviceStatusSubtitle');
        if (subtitle) subtitle.textContent = serviceStatusBi('数据库、模型、磁盘、进程与出站网络的即时检查', 'Live checks of database, models, disk, process and outbound network');
        window.clearServiceStatusPolling();
        window.clearServiceRuntimeLogPolling();
        window.loadPlatformDiagnostics();
        return;
    }
    const subtitle = document.getElementById('serviceStatusSubtitle');
    if (subtitle) subtitle.textContent = serviceStatusView === 'logs'
        ? serviceStatusBi('后台全量控制台日志 · 自动脱敏', 'Complete backend console · automatically redacted')
        : serviceStatusBi('基于平台真实 API 请求返回结果生成', 'Generated from actual platform API responses');
    if (serviceStatusView === 'logs') {
        window.clearServiceStatusPolling();
        window.renderServiceRuntimeLogShell();
        window.loadServiceRuntimeLogs(1);
    } else {
        window.clearServiceRuntimeLogPolling();
        window.startServiceStatusPolling();
        window.loadServiceStatusHistory();
    }
};

window.refreshServiceStatusView = function () {
    if (serviceStatusView === 'diagnostics') return window.loadPlatformDiagnostics();
    if (serviceStatusView === 'logs') window.loadServiceRuntimeLogs(serviceRuntimeLogPage);
    else window.loadServiceStatusHistory();
};

window.clearServiceStatusPolling = function () {
    if (serviceStatusTimer) window.clearInterval(serviceStatusTimer);
    serviceStatusTimer = null;
    serviceStatusRequestSeq += 1;
    serviceStatusRequestPending = false;
};

window.startServiceStatusPolling = function () {
    window.clearServiceStatusPolling();
    serviceStatusTimer = window.setInterval(() => {
        window.loadServiceStatusHistory(true);
    }, 5000);
};

window.clearServiceRuntimeLogPolling = function () {
    if (serviceRuntimeLogTimer) window.clearInterval(serviceRuntimeLogTimer);
    serviceRuntimeLogTimer = null;
};

function runtimeLogFilters() {
    const levels = [...document.querySelectorAll('.service-runtime-levels input:checked')].map(input => input.value);
    return {
        q: document.getElementById('serviceRuntimeLogSearch')?.value.trim() || '',
        levels: levels.length ? levels.join(',') : '__none__',
        startDate: document.getElementById('serviceRuntimeLogStartDate')?.value || '',
        endDate: document.getElementById('serviceRuntimeLogEndDate')?.value || ''
    };
}

window.clearServiceRuntimeLogFilters = function () {
    const search = document.getElementById('serviceRuntimeLogSearch');
    const startDate = document.getElementById('serviceRuntimeLogStartDate');
    const endDate = document.getElementById('serviceRuntimeLogEndDate');
    if (search) search.value = '';
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    document.querySelectorAll('.service-runtime-levels input').forEach(input => { input.checked = true; });
    window.loadServiceRuntimeLogs(1);
};

window.renderServiceRuntimeLogShell = function () {
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    if (!content || !range) return;
    range.innerHTML = '';
    content.innerHTML = `
        <section class="service-runtime-log-panel">
            <div class="service-runtime-log-filter">
                <label class="service-runtime-search"><span>⌕</span><input id="serviceRuntimeLogSearch" type="search" placeholder="${serviceStatusBi('搜索详情、代码位置或请求 ID', 'Search detail, source or request ID')}" onkeydown="if(event.key==='Enter') loadServiceRuntimeLogs(1)"></label>
                <div class="service-runtime-levels" role="group" aria-label="${serviceStatusBi('日志等级（可多选）', 'Log levels (multi-select)')}">
                    ${['DEBUG', 'INFO', 'LOG', 'WARN', 'ERROR'].map(level => `<label class="${level.toLowerCase()}"><input type="checkbox" value="${level}" checked onchange="loadServiceRuntimeLogs(1)"><span>${level}</span></label>`).join('')}
                </div>
                <label class="service-runtime-date"><span>${serviceStatusBi('从', 'From')}</span><input id="serviceRuntimeLogStartDate" type="date" onchange="loadServiceRuntimeLogs(1)"></label>
                <label class="service-runtime-date"><span>${serviceStatusBi('到', 'To')}</span><input id="serviceRuntimeLogEndDate" type="date" onchange="loadServiceRuntimeLogs(1)"></label>
                <button type="button" class="service-runtime-query" onclick="loadServiceRuntimeLogs(1)">${serviceStatusBi('查询', 'Search')}</button>
                <button type="button" class="service-runtime-reset" onclick="clearServiceRuntimeLogFilters()">${serviceStatusBi('重置', 'Reset')}</button>
                <label class="service-runtime-follow"><input id="serviceRuntimeLogFollow" type="checkbox" checked onchange="toggleServiceRuntimeLogPolling()"> ${serviceStatusBi('实时跟随', 'Follow live')}</label>
            </div>
            <div class="service-runtime-export">
                <button type="button" class="service-runtime-reset" onclick="exportServiceRuntimeLogs(true)">${serviceStatusBi('导出当天 ZIP', 'Export today ZIP')}</button>
                <button type="button" class="service-runtime-reset" onclick="exportServiceRuntimeLogs(false)">${serviceStatusBi('导出日期范围 ZIP', 'Export date range ZIP')}</button>
                <span id="serviceRuntimeLogExportStatus" role="status">${serviceStatusBi('导出全部等级，含本人 AI 文本/代码；不含图片附件。日期按本机时区。', 'All levels, with your AI text/code; no media attachments. Dates use your local timezone.')}</span>
            </div>
            <div class="service-runtime-log-summary" id="serviceRuntimeLogSummary"></div>
            <div class="service-runtime-log-list" id="serviceRuntimeLogList" aria-live="polite"></div>
            <div class="service-runtime-log-pagination" id="serviceRuntimeLogPagination"></div>
        </section>`;
    window.toggleServiceRuntimeLogPolling();
};

window.exportServiceRuntimeLogs = async function (todayOnly) {
    const buttons = document.querySelectorAll('.service-runtime-export button');
    if ([...buttons].some(button => button.disabled)) return;
    const status = document.getElementById('serviceRuntimeLogExportStatus');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const startDate = todayOnly ? today : document.getElementById('serviceRuntimeLogStartDate')?.value;
    const endDate = todayOnly ? today : document.getElementById('serviceRuntimeLogEndDate')?.value;
    if (!startDate || !endDate || endDate < startDate) {
        if (status) status.textContent = serviceStatusBi('请在上方选择有效的起止日期。', 'Select a valid start and end date above.');
        return;
    }
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    end.setDate(end.getDate() + 1);
    const query = new URLSearchParams({ startDate, endDate, startOffset: String(start.getTimezoneOffset()), endOffset: String(end.getTimezoneOffset()) });
    buttons.forEach(button => { button.disabled = true; });
    if (status) status.textContent = serviceStatusBi('正在打包日志并尝试读取 AI 对话…', 'Packing logs and trying to read AI conversations…');
    try {
        const token = localStorage.getItem('tools_token');
        const response = await fetch(`/api/platform-metrics/service-status/logs/export?${query}`, {
            credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${response.status}`);
        }
        if (!response.headers.get('Content-Type')?.includes('application/zip')) throw new Error(serviceStatusBi('服务器未返回日志压缩包，请检查登录状态。', 'No ZIP received; check your login.'));
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `service-logs-${startDate}_${endDate}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
        if (status) status.textContent = serviceStatusBi('已生成 ZIP。导出数量、保留范围和 AI 读取情况见包内 manifest.json。', 'ZIP ready. See manifest.json for counts, retention and AI availability.');
    } catch (error) {
        if (status) status.textContent = serviceStatusBi('导出失败：', 'Export failed: ') + error.message;
    } finally {
        buttons.forEach(button => { button.disabled = false; });
    }
};

window.toggleServiceRuntimeLogPolling = function () {
    window.clearServiceRuntimeLogPolling();
    const follow = document.getElementById('serviceRuntimeLogFollow');
    if (serviceStatusView !== 'logs' || !follow?.checked) return;
    serviceRuntimeLogTimer = window.setInterval(() => {
        if (document.getElementById('serviceStatusModal')?.style.display === 'flex') window.loadServiceRuntimeLogs(1, true);
    }, 3000);
};

window.loadServiceRuntimeLogs = async function (page = 1, isLiveRefresh = false) {
    if (serviceStatusView !== 'logs') return;
    const list = document.getElementById('serviceRuntimeLogList');
    const summary = document.getElementById('serviceRuntimeLogSummary');
    const pagination = document.getElementById('serviceRuntimeLogPagination');
    if (!list || !summary || !pagination) return;
    if (!isLiveRefresh && Number(page) > 1) {
        const follow = document.getElementById('serviceRuntimeLogFollow');
        if (follow) follow.checked = false;
        window.toggleServiceRuntimeLogPolling();
    }
    const requestSeq = ++serviceRuntimeLogRequestSeq;
    const filters = runtimeLogFilters();
    if (!isLiveRefresh) list.innerHTML = `<div class="service-runtime-log-loading">${serviceStatusBi('正在读取程序运行日志…', 'Loading runtime logs…')}</div>`;
    const query = new URLSearchParams({ ...filters, page: String(page), pageSize: '50' });
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status/logs?${query}`);
        if (requestSeq !== serviceRuntimeLogRequestSeq || serviceStatusView !== 'logs') return;
        serviceRuntimeLogPage = data.page || page;
        const logs = data.logs || [];
        summary.textContent = `${serviceStatusBi('共', 'Total')} ${Number(data.total || 0).toLocaleString()} ${serviceStatusBi('条 · 保留最近', 'entries · last')} ${data.retentionDays || 30} ${serviceStatusBi('天 · 每 3 秒刷新', 'days · refreshes every 3 seconds')}`;
        list.innerHTML = logs.length ? `<div class="service-runtime-log-header"><span>${serviceStatusBi('时间', 'Time')}</span><span>${serviceStatusBi('等级', 'Level')}</span><span>${serviceStatusBi('代码位置', 'Source')}</span><span>${serviceStatusBi('详情', 'Detail')}</span><span>${serviceStatusBi('上下文', 'Context')}</span></div>${logs.map(log => {
            const context = log.requestId
                ? `${log.statusCode == null ? '—' : `HTTP ${Number(log.statusCode)}`} · ${log.durationMs == null ? '—' : `${Number(log.durationMs)}ms`} · ${navEscape(log.requestId)}`
                : serviceStatusBi('后台控制台', 'Backend console');
            return `<details class="service-runtime-log-row ${String(log.level || 'LOG').toLowerCase()}"><summary>
                <time>${navEscape(new Date(log.timestamp).toLocaleString())}</time>
                <span class="service-runtime-log-level">${navEscape(log.level)}</span>
                <code title="${navEscape(log.source)}">${navEscape(log.source)}</code>
                <p title="${navEscape(log.detail)}">${navEscape(log.detail)}</p>
                <span class="service-runtime-log-meta">${context}</span>
            </summary><pre>${navEscape(log.detail)}</pre></details>`;
        }).join('')}` : `<div class="service-runtime-log-empty">${serviceStatusBi('没有匹配的运行日志', 'No matching runtime logs')}</div>`;
        const previousDisabled = data.page <= 1 ? 'disabled' : '';
        const nextDisabled = data.page >= data.totalPages ? 'disabled' : '';
        pagination.innerHTML = `<button type="button" ${previousDisabled} onclick="loadServiceRuntimeLogs(${Math.max(1, data.page - 1)})">${serviceStatusBi('上一页', 'Previous')}</button><span>${data.page} / ${data.totalPages}</span><button type="button" ${nextDisabled} onclick="loadServiceRuntimeLogs(${Math.min(data.totalPages, data.page + 1)})">${serviceStatusBi('下一页', 'Next')}</button>`;
        if (isLiveRefresh && document.getElementById('serviceRuntimeLogFollow')?.checked) list.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
        if (requestSeq !== serviceRuntimeLogRequestSeq) return;
        list.innerHTML = `<div class="service-runtime-log-empty error">${navEscape(error.message || serviceStatusBi('日志读取失败', 'Unable to load logs'))}</div>`;
    }
};

window.setServiceStatusDays = function (days) {
    serviceStatusDays = [30, 90, 180].includes(Number(days)) ? Number(days) : 90;
    window.loadServiceStatusHistory();
};

function serviceStatusRequest(url, options = {}) {
    if (window.API?.get && (!options.method || options.method === 'GET')) return window.API.get(url);
    if (window.API?.post && options.method === 'POST') return window.API.post(url, options.body);
    const fetchOptions = {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(localStorage.getItem('tools_token') ? { Authorization: `Bearer ${localStorage.getItem('tools_token')}` } : {})
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {})
    };
    return fetch(url, fetchOptions).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        return body;
    });
}

window.inspectChannelsNow = async function () {
    const btn = document.getElementById('serviceChannelInspectBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span> ${serviceStatusBi('抽查中…', 'Checking…')}`;
    }
    try {
        await serviceStatusRequest('/api/platform-metrics/service-status/channels/inspect', { method: 'POST' });
        await window.loadServiceStatusHistory();
    } catch (err) {
        const msg = serviceStatusBi('频道抽查失败：', 'Channel inspection failed: ') + err.message;
        if (window.AppDialog && typeof window.AppDialog.alert === 'function') {
            window.AppDialog.alert(msg, { title: serviceStatusBi('频道抽查失败', 'Inspection failed'), tone: 'danger' });
        } else if (typeof showPlatformNotice === 'function') {
            showPlatformNotice(msg, { tone: 'error' });
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `↻ <span>${serviceStatusBi('立即抽查', 'Inspect Now')}</span>`;
        }
    }
};

function renderChannelsWatchdogHtml(channelsData, canInspectFailures) {
    if (!channelsData || !channelsData.enabled) return '';
    const channels = channelsData.channels || [];
    if (!channels.length) return '';
    const lastCheckText = channelsData.lastCheckAt ? new Date(channelsData.lastCheckAt).toLocaleTimeString() : '—';
    const recoveryText = channelsData.autoRecoveryCount > 0
        ? ` · ${serviceStatusBi('已自动自愈', 'Auto-healed')} ${channelsData.autoRecoveryCount} ${serviceStatusBi('次', 'times')}`
        : '';
    const cards = channels.map(c => {
        const icon = c.id === 'welink' ? '💼' : '💬';
        const badgeClass = c.state || (c.enabled ? 'operational' : 'disabled');
        const badgeLabel = c.stateLabel || (c.enabled ? serviceStatusBi('正常', 'Operational') : serviceStatusBi('未启用', 'Disabled'));
        const heartbeatType = c.heartbeat?.type || (c.id === 'welink' ? 'WebSocket Keepalive' : 'Long-Polling');
        const heartbeatState = c.heartbeat?.healthy ? serviceStatusBi('长连接活跃', 'Active') : (c.enabled ? serviceStatusBi('异常断开', 'Disconnected') : serviceStatusBi('未启用', 'Disabled'));
        const lastHbText = c.heartbeat?.lastHeartbeatAt ? new Date(c.heartbeat.lastHeartbeatAt).toLocaleTimeString() : '—';
        const autoHealInfo = c.autoHeal?.recoveredCount ? `${serviceStatusBi('已自愈', 'Recovered')} ${c.autoHeal.recoveredCount} ${serviceStatusBi('次', 'times')}` : serviceStatusBi('就绪保活中', 'Standby');
        const clickAttr = canInspectFailures ? ` onclick="openServiceFailureModal('channels','','')" style="cursor:pointer;" title="${serviceStatusBi('点击查看频道服务失败明细', 'Click to view channel failures')}"` : '';
        return `
            <div class="service-channel-card ${navEscape(c.state || 'operational')} ${canInspectFailures ? 'clickable' : ''}"${clickAttr}>
                <div class="service-channel-header">
                    <div class="service-channel-name"><span>${icon}</span><span>${navEscape(c.name)} ${serviceStatusBi('助理', 'Assistant')}</span></div>
                    <span class="service-channel-badge ${navEscape(badgeClass)}"><i></i>${navEscape(badgeLabel)}</span>
                </div>
                <div class="service-channel-body">
                    <div class="service-channel-row"><span>${serviceStatusBi('心跳保活', 'Heartbeat')}</span><span>${navEscape(heartbeatType)} · <b>${navEscape(heartbeatState)}</b></span></div>
                    <div class="service-channel-row"><span>${serviceStatusBi('最近心跳', 'Last Heartbeat')}</span><code>${navEscape(lastHbText)}</code></div>
                    ${c.channel ? `<div class="service-channel-row"><span>${serviceStatusBi('频道标识', 'Channel')}</span><span><code>${navEscape(c.channel)}</code> (${navEscape(c.environment || 'prod')})</span></div>` : ''}
                    <div class="service-channel-row"><span>${serviceStatusBi('自愈监控', 'Auto-heal Watchdog')}</span><span>${navEscape(autoHealInfo)}</span></div>
                    ${c.lastError ? `<div class="service-channel-err" title="${navEscape(c.lastError)}">⚠️ ${navEscape(c.lastError)}</div>` : ''}
                </div>
            </div>`;
    }).join('');
    return `
        <section class="service-status-channels">
            <div class="service-status-channels-head">
                <div>
                    <div class="service-status-channels-title">
                        <span>📡</span>
                        <span>${serviceStatusBi('频道对接与心跳保活检测', 'Channel Integration & Heartbeat Keepalive')}</span>
                    </div>
                    <div class="service-status-channels-sub">
                        ${serviceStatusBi('30 秒定时抽查 · 面板每 5 秒更新 · 断线超时自动重连自愈 · 上次抽查', 'Checked every 30s · Panel refreshes every 5s · Auto-heal reconnect on timeout · Last check')}: ${navEscape(lastCheckText)}${navEscape(recoveryText)}
                    </div>
                </div>
                <div class="service-status-channels-action">
                    <button type="button" class="service-channel-inspect-btn" id="serviceChannelInspectBtn" onclick="inspectChannelsNow()">↻ <span>${serviceStatusBi('立即抽查', 'Inspect Now')}</span></button>
                </div>
            </div>
            <div class="service-status-channels-grid">${cards}</div>
        </section>`;
}

// ── 平台自检（仅管理员）：与基座 Web 版的调试面板对应，检查项按主线版的运行环境取舍 ──
window.loadPlatformDiagnostics = async function () {
    const content = document.getElementById('serviceStatusContent');
    if (!content) return;
    content.innerHTML = `<div class="service-status-loading"><span></span>${serviceStatusBi('正在自检…', 'Running checks…')}</div>`;
    try {
        const data = await serviceStatusRequest('/api/platform-metrics/diagnostics');
        if (serviceStatusView !== 'diagnostics') return;
        const rows = (data.checks || []).map(item => `
            <article class="service-status-card platform-diag-item ${item.ok ? 'ok' : 'bad'}">
                <div class="service-status-card-head"><span class="service-state-icon ${item.ok ? 'operational' : 'incident'}">${item.ok ? '✓' : '!'}</span><strong>${navEscape(item.label)}</strong><small>${Number(item.durationMs || 0)} ms</small></div>
                <p class="platform-diag-summary">${navEscape(item.summary || '')}</p>
            </article>`).join('');
        content.innerHTML = `
            <div class="service-status-notice">${serviceStatusBi('检查时间', 'Checked at')} ${navEscape(new Date(data.at).toLocaleString())} · ${data.ok ? serviceStatusBi('全部正常', 'All checks passed') : serviceStatusBi('有项目需要关注', 'Some checks need attention')}</div>
            <section class="service-status-grid">${rows}</section>
            <section class="service-status-card platform-diag-probe">
                <div class="service-status-card-head"><strong>${serviceStatusBi('出站探针', 'Outbound probe')}</strong><small>${serviceStatusBi('从平台服务器访问一个地址，查看域名解析、连接与状态码', 'Reach a URL from the platform server: DNS, connection and status code')}</small></div>
                <form onsubmit="event.preventDefault(); runPlatformProbe(this.elements.url.value)">
                    <input name="url" type="url" required placeholder="https://" style="width:100%;box-sizing:border-box;margin:8px 0;padding:8px 10px;border:1px solid var(--border-color,#d0d7de);border-radius:8px">
                    <button type="submit" class="service-status-refresh">${serviceStatusBi('探测', 'Probe')}</button>
                </form>
                <pre id="platformProbeResult" class="platform-diag-summary" style="white-space:pre-wrap;margin:8px 0 0"></pre>
            </section>`;
    } catch (error) {
        content.innerHTML = `<div class="service-status-error"><strong>${serviceStatusBi('自检失败', 'Self-check failed')}</strong><p>${navEscape(error.message)}</p></div>`;
    }
};

window.runPlatformProbe = async function (url) {
    const out = document.getElementById('platformProbeResult');
    if (!out) return;
    out.textContent = serviceStatusBi('探测中…', 'Probing…');
    try {
        const r = await serviceStatusRequest('/api/platform-metrics/diagnostics/probe', { method: 'POST', body: { url } });
        out.textContent = `${r.ok ? '✓' : '✗'} ${r.message} · ${r.durationMs} ms\n${serviceStatusBi('解析到', 'Resolved to')}：${(r.addresses || []).join(', ') || '—'}`;
    } catch (error) {
        out.textContent = `✗ ${error.message}`;
    }
};

function renderServiceStatusHistory(data) {
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    if (!content || !range) return;
    range.innerHTML = [30, 90, 180].map(days => `<button type="button" class="${days === data.days ? 'active' : ''}" onclick="setServiceStatusDays(${days})">${days} ${serviceStatusBi('天', 'days')}</button>`).join('');
    const overall = data.overall || {};
    const overallMeta = resolveOverallServiceStatusMeta(data);
    const licenseMeta = licenseStatusMeta(data.license || {});
    const availability = overall.availability == null ? '—' : `${Number(overall.availability).toFixed(2)}%`;
    const canInspectFailures = canInspectServiceFailures();
    const failureStat = (kind, label, count, statusClass) => canInspectFailures
        ? `<button type="button" class="service-status-stat ${kind} service-status-clickable" onclick="openServiceFailureModal('','','${statusClass}')"><small>${label}</small><strong>${Number(count || 0).toLocaleString()}</strong><em>${serviceStatusBi('点击查看明细', 'View details')}</em></button>`
        : `<div class="service-status-stat ${kind}"><small>${label}</small><strong>${Number(count || 0).toLocaleString()}</strong></div>`;
    const cards = (data.services || []).map(service => {
        const meta = serviceStateMeta(service.currentState);
        const serviceAvailability = service.summary?.availability == null ? '—' : `${Number(service.summary.availability).toFixed(2)}%`;
        const bars = (service.history || []).map(day => {
            const title = `${day.date} · ${serviceStateMeta(day.state).label}\n${serviceStatusBi('请求', 'Requests')}: ${day.requests} · ${serviceStatusBi('成功', 'Success')}: ${day.successes} · 4xx: ${day.clientErrors} · 5xx: ${day.serverErrors}\n${serviceStatusBi('平均响应', 'Avg response')}: ${day.averageDurationMs}ms\n${canInspectFailures ? serviceStatusBi('点击查看失败请求明细', 'Click to view failed request details') : ''}`;
            const clickable = canInspectFailures;
            const action = clickable ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','${navEscape(day.date)}','')"` : '';
            return `<button type="button" class="service-day-bar ${navEscape(day.state)} ${clickable ? 'clickable' : ''}" title="${navEscape(title)}" aria-label="${navEscape(title)}"${action}></button>`;
        }).join('');
        const name = window.ToolsI18n?.getLanguage?.() === 'en-US' ? service.nameEn : service.name;
        const description = window.ToolsI18n?.getLanguage?.() === 'en-US' ? service.descriptionEn : service.description;
        const cardClickAttr = canInspectFailures ? ` style="cursor:pointer;" title="${serviceStatusBi('点击查看该服务失败明细', 'Click to view failures for this service')}"` : '';
        return `
            <article class="service-status-card" data-service-status-key="${navEscape(service.id)}" data-service-status-name="${navEscape(name)}">
                <div class="service-status-card-head"${cardClickAttr}${canInspectFailures ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','','')"` : ''}>
                    <div><h3>${navEscape(name)}</h3><p>${navEscape(description)}</p></div>
                    <span class="service-state-icon ${navEscape(service.currentState)}" title="${navEscape(meta.label)}">${meta.icon}</span>
                </div>
                <div class="service-status-bars" style="--status-days:${data.days}">${bars}</div>
                <div class="service-status-axis"><span>${navEscape(data.startDate)}</span><b>${serviceAvailability} ${serviceStatusBi('可用率', 'availability')}</b><span>${navEscape(data.endDate)}</span></div>
                <div class="service-status-card-foot"${cardClickAttr}${canInspectFailures ? ` onclick="openServiceFailureModal('${navEscape(service.id)}','','')"` : ''}><span class="service-state-label ${navEscape(service.currentState)}">${navEscape(meta.label)}</span><span>${Number(service.summary?.requests || 0).toLocaleString()} ${serviceStatusBi('次请求', 'requests')}</span><span>${Number(service.summary?.averageDurationMs || 0)}ms ${serviceStatusBi('平均', 'avg')}</span></div>
            </article>`;
    }).join('');
    content.innerHTML = `
        <section class="service-status-overview">
            <div class="service-status-current ${navEscape(overallMeta.state)} ${canInspectFailures ? 'service-status-clickable' : ''}" ${canInspectFailures ? 'onclick="openServiceFailureModal(\'\',\'\',\'\')"' : ''}><span class="service-state-icon ${navEscape(overallMeta.state)}">${overallMeta.icon}</span><div><small>${serviceStatusBi('当前状态', 'Current status')}</small><strong>${navEscape(overallMeta.label)}</strong><em class="${overallMeta.hasIssue ? 'warning' : ''}" title="${navEscape(overallMeta.detail)}">${navEscape(overallMeta.detail)}</em></div></div>
            <div class="service-status-license ${navEscape(licenseMeta.state)}"><span class="service-state-icon ${navEscape(licenseMeta.state)}">${licenseMeta.icon}</span><div><small>${serviceStatusBi('License 可用状态', 'License availability')}</small><strong>${navEscape(licenseMeta.label)}</strong><em title="${navEscape(licenseMeta.detail)}">${navEscape(licenseMeta.detail)}</em></div></div>
            <div class="service-status-stat ${canInspectFailures ? 'service-status-clickable' : ''}" ${canInspectFailures ? 'onclick="openServiceFailureModal(\'\',\'\',\'\')"' : ''}><small>${serviceStatusBi('可用率', 'Availability')}</small><strong>${availability}</strong></div>
            <div class="service-status-stat ${canInspectFailures ? 'service-status-clickable' : ''}" ${canInspectFailures ? 'onclick="openServiceFailureModal(\'\',\'\',\'\')"' : ''}><small>${serviceStatusBi('成功返回', 'Successful')}</small><strong>${Number(overall.successes || 0).toLocaleString()}</strong></div>
            ${failureStat('warning', serviceStatusBi('客户端失败 4xx', 'Client errors 4xx'), overall.clientErrors, '4xx')}
            ${failureStat('danger', serviceStatusBi('服务端失败 5xx', 'Server errors 5xx'), overall.serverErrors, '5xx')}
        </section>
        ${Number(overall.requests || 0) ? '' : `<div class="service-status-notice">${serviceStatusBi('状态历史从本功能启用后开始累计；暂无历史请求时显示为灰色。', 'History starts accumulating after this feature is enabled; days without requests are gray.')}</div>`}
        <section class="service-status-grid">${cards}</section>
        <div class="service-status-legend"><span><i class="operational"></i>${serviceStatusBi('正常', 'Operational')}</span><span><i class="degraded"></i>${serviceStatusBi('存在 4xx', 'Has 4xx')}</span><span><i class="incident"></i>${serviceStatusBi('存在 5xx', 'Has 5xx')}</span><span><i class="no-data"></i>${serviceStatusBi('无请求数据', 'No requests')}</span><em>${serviceStatusBi('可用率按“非 5xx 请求 ÷ 全部请求”计算；正常登录拦截不计入 4xx 异常。', 'Availability is calculated as non-5xx requests divided by all requests; expected login responses are excluded from 4xx failures.')}</em></div>
        ${renderChannelsWatchdogHtml(data.channels, canInspectFailures)}`;
}

window.loadServiceStatusHistory = async function (isLiveRefresh = false) {
    if (serviceStatusView !== 'overview') return;
    const modal = ensureServiceStatusModal();
    if (modal.style.display !== 'flex') return;
    if (isLiveRefresh && (document.hidden || serviceStatusRequestPending)) return;
    const content = document.getElementById('serviceStatusContent');
    const range = document.getElementById('serviceStatusRange');
    const requestSeq = ++serviceStatusRequestSeq;
    serviceStatusRequestPending = true;
    if (!isLiveRefresh) {
        range.innerHTML = [30, 90, 180].map(days => `<button type="button" class="${days === serviceStatusDays ? 'active' : ''}" onclick="setServiceStatusDays(${days})">${days} ${serviceStatusBi('天', 'days')}</button>`).join('');
        content.innerHTML = `<div class="service-status-loading"><span></span>${serviceStatusBi('正在读取服务状态…', 'Loading service status…')}</div>`;
    }
    try {
        const data = await serviceStatusRequest(`/api/platform-metrics/service-status?days=${serviceStatusDays}`);
        if (requestSeq !== serviceStatusRequestSeq || serviceStatusView !== 'overview' || modal.style.display !== 'flex') return;
        const scrollTop = content.scrollTop;
        renderServiceStatusHistory(data);
        if (isLiveRefresh) content.scrollTop = scrollTop;
    } catch (error) {
        if (requestSeq !== serviceStatusRequestSeq || serviceStatusView !== 'overview' || modal.style.display !== 'flex' || isLiveRefresh) return;
        content.innerHTML = `<div class="service-status-error"><strong>${serviceStatusBi('服务状态读取失败', 'Unable to load service status')}</strong><p>${navEscape(error.message)}</p><button type="button" onclick="loadServiceStatusHistory()">${serviceStatusBi('重试', 'Retry')}</button></div>`;
    } finally {
        if (requestSeq === serviceStatusRequestSeq) serviceStatusRequestPending = false;
    }
};

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (document.getElementById('serviceFailureModal')?.style.display === 'flex') window.closeServiceFailureModal();
    else if (document.getElementById('serviceStatusModal')?.style.display === 'flex') window.closeServiceStatusModal();
});

