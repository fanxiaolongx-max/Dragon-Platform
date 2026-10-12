let latestSLAHistorySnapshots = [];
let latestSLAHistoryI18nMap = {};
let latestSLAHistoryMetricFormatMap = {};
let latestSLAHistorySourceFiles = [];
let loadingSLAHistorySource = false;
let historyCurrentPage = 1;
let historyPageSize = 10;

function getHistorySecIdFromPrefKey(prefKey) {
    const normalized = String(prefKey || '');
    if (normalized.startsWith('sla_prefs_other_')) return normalized.replace('sla_prefs_', '');
    if (normalized.startsWith('sla_prefs_rectification')) return 'rectification';
    if (normalized.startsWith('sla_prefs_risk')) return 'risk';
    if (normalized.startsWith('sla_prefs_special')) return 'special';
    if (normalized.startsWith('sla_prefs_sr')) return 'sr';
    if (normalized.startsWith('sla_prefs_vulnerability')) return 'vulnerability';
    return normalized.replace('sla_prefs_', '');
}

function buildHistoryMetricFormatMap(configData) {
    const targets = (configData && configData.targets) || {};
    const prefs = (configData && configData.prefs) || {};
    const out = {};
    Object.values(targets).forEach(target => {
        if (target && target.label && target.isPercent !== undefined) out[target.label] = { isPercent: target.isPercent };
    });
    Object.entries(prefs).forEach(([prefKey, pref]) => {
        if (!pref || !Array.isArray(pref.customMetrics)) return;
        const secId = getHistorySecIdFromPrefKey(prefKey);
        pref.customMetrics.forEach(rule => {
            const target = targets[`${secId}_${rule.id}`];
            if (rule.label && target && target.isPercent !== undefined) out[rule.label] = { isPercent: target.isPercent };
            (rule.subMetrics || []).forEach(sm => {
                const subTarget = targets[`${secId}_${sm.id}`] || target;
                const label = sm.label || rule.label || sm.category;
                if (label && subTarget && subTarget.isPercent !== undefined) out[label] = { isPercent: subTarget.isPercent };
            });
        });
    });
    return out;
}

function getHistoryMetricLabel(label) {
    const raw = String(label || '').trim();
    if (!raw) return raw;
    const lang = window.ToolsI18n ? window.ToolsI18n.getLanguage() : 'zh-CN';
    if (lang !== 'en-US') return raw;
    return latestSLAHistoryI18nMap[raw] || raw;
}

function getHistoryStatusLabel(status) {
    const raw = String(status || '').trim();
    if (!raw) return raw;
    const lang = window.ToolsI18n ? window.ToolsI18n.getLanguage() : 'zh-CN';
    if (lang !== 'en-US') return raw;
    const statusMap = {
        '达标': 'Met',
        '落后': 'Behind',
        '超标': 'Exceeded',
        '预警': 'Warning'
    };
    return statusMap[raw] || raw;
}

function getHistoryMetricValue(label, value) {
    const format = latestSLAHistoryMetricFormatMap[String(label || '').trim()];
    const raw = String(value ?? '').trim();
    if (format && format.isPercent === false && raw.endsWith('%')) return raw.replace(/%$/, '');
    return String(value ?? '');
}

function getHistoryTargetMonth(item) {
    const month = Number(item && (item.selectedTargetMonth ?? item.targetMonth ?? item.month));
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

let cleanupHistoryScroll=()=>{};
function syncHistoryScrollbar(){
    cleanupHistoryScroll();
    const footer=document.getElementById('history-horizontal-scroll');if(!footer)return;
    const wrapper=document.querySelector('#history-modal-list .history-table-wrapper'),range=footer.querySelector('[data-history-scroll-range]'),left=footer.querySelector('[data-history-scroll-left]'),right=footer.querySelector('[data-history-scroll-right]');
    const text=(zh,en)=>window.ToolsI18n?.getLanguage()==='en-US'?en:zh;
    footer.querySelector('[data-history-scroll-label]').textContent=text('横向浏览','Horizontal scroll');
    left.setAttribute('aria-label',text('向左滚动','Scroll left'));right.setAttribute('aria-label',text('向右滚动','Scroll right'));range.setAttribute('aria-label',text('横向滚动历史快照表格','Scroll the snapshot table horizontally'));
    let frame=0;
    const update=()=>{
        frame=0;const max=wrapper?Math.max(0,wrapper.scrollWidth-wrapper.clientWidth):0,value=wrapper?Math.min(max,Math.max(0,wrapper.scrollLeft)):0;
        range.max=String(max);range.value=String(value);range.disabled=max<1;left.disabled=value<1;right.disabled=value>=max-1;
        const progress=max?Math.round(value/max*100):0,label=max?progress+'%':text('所有列已展示','All columns visible');
        footer.querySelector('[data-history-scroll-position]').textContent=label;range.setAttribute('aria-valuetext',label);
        range.style.setProperty('--scroll-thumb-width',Math.max(28,Math.min(160,range.clientWidth*(wrapper?wrapper.clientWidth/wrapper.scrollWidth:1)))+'px');
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    range.oninput=()=>{if(wrapper)wrapper.scrollLeft=Number(range.value);update();};
    left.onclick=()=>{if(wrapper){wrapper.scrollLeft-=Math.max(120,wrapper.clientWidth*.7);update();}};
    right.onclick=()=>{if(wrapper){wrapper.scrollLeft+=Math.max(120,wrapper.clientWidth*.7);update();}};
    wrapper?.addEventListener('scroll',schedule,{passive:true});
    const observer=new ResizeObserver(schedule);observer.observe(footer);if(wrapper){observer.observe(wrapper);const table=wrapper.querySelector('table');if(table)observer.observe(table);}
    cleanupHistoryScroll=()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);wrapper?.removeEventListener('scroll',schedule);range.oninput=left.onclick=right.onclick=null;};update();
}

function renderFeatherArt(container) {
    if (!container) return;
    const featherEl = container.querySelector('[data-startup-feather]');
    if (!featherEl) return;
    if (featherEl.querySelector('svg')) return;
    if (window.ToolsStartup && typeof window.ToolsStartup.feather === 'function') {
        window.ToolsStartup.feather(container);
        return;
    }
    const body = 'M45 157 C3 128 14 58 62 35 C85 24 117 12 146 13 C155 44 142 83 114 112 C95 133 72 146 45 157Z';
    const barbs = Array.from({length:36},(_,i)=>{const f=i/35,x=46+99*f,y=153-139*f,w=Math.sin(Math.PI*f)*40,j=Math.sin(i*1.7)*2;return `<path d="M${x} ${y} Q${x-w*.6} ${y-7} ${x-w} ${y-24+j} M${x} ${y} Q${x+w*.55} ${y+2} ${x+w*.78} ${y+16+j}"/>`;}).join('');
    featherEl.innerHTML = `<svg viewBox="0 0 180 205" aria-hidden="true"><defs><linearGradient id="historyBootFeather" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".48" stop-color="#ecf3f8"/><stop offset="1" stop-color="#9db5c9"/></linearGradient><linearGradient id="historyBootQuill"><stop stop-color="#d8c6a1"/><stop offset="1" stop-color="#fffdf5"/></linearGradient><clipPath id="historyBootFeatherClip"><path d="${body}"/></clipPath></defs><path d="${body}" fill="url(#historyBootFeather)" stroke="#a9bccb" stroke-width=".65"/><g clip-path="url(#historyBootFeatherClip)" stroke="#708da5" stroke-opacity=".42" stroke-width=".55" fill="none">${barbs}</g><path d="M29 189 Q76 91 146 13" fill="none" stroke="url(#historyBootQuill)" stroke-width="2.3" stroke-linecap="round"/><path d="M46 156 Q93 120 121 95" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width=".7"/></svg>`;
}

const HISTORY_LOADING_STEPS = [
    { key: 'snapshots', label: () => SLAT('sla.history.stepSnapshots') },
    { key: 'config', label: () => SLAT('sla.history.stepConfig') },
    { key: 'catalog', label: () => SLAT('sla.history.stepCatalog') },
    { key: 'render', label: () => SLAT('sla.history.stepRender') }
];

function renderHistoryLoadingState(container, activeStepKey, percent) {
    if (!container) return;
    const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    let loader = container.querySelector('#history-feather-loader');
    
    if (!loader) {
        container.innerHTML = `
            <div class="history-feather-loader" id="history-feather-loader">
                <div class="history-feather-card">
                    <div class="startup-art" aria-hidden="true">
                        <div class="startup-halo"></div>
                        <div class="startup-feather" data-startup-feather></div>
                    </div>
                    <p class="startup-eyebrow">TOOLS PLATFORM · SNAPSHOTS</p>
                    <h3 class="history-feather-title">${escapeHTML(SLAT('sla.history.featherLoading'))}</h3>
                    <p class="history-feather-msg" id="history-feather-msg"></p>
                    <div class="startup-track" id="history-feather-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--startup-progress: 0%;">
                        <span></span>
                    </div>
                    <div class="startup-progress-label">
                        <span id="history-feather-step-count">0 / 4 个步骤</span>
                        <strong id="history-feather-percent">0%</strong>
                    </div>
                    <div class="history-feather-steps" id="history-feather-steps">
                        ${HISTORY_LOADING_STEPS.map((s, idx) => `
                            <div class="history-feather-step-item" data-step="${s.key}" data-state="waiting">
                                <span>${idx + 1}. ${escapeHTML(s.label())}</span>
                                <small>${escapeHTML(SLAT('sla.history.stepWaiting'))}</small>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        loader = container.querySelector('#history-feather-loader');
        renderFeatherArt(loader);
    }
    
    const track = loader.querySelector('#history-feather-track');
    if (track) {
        track.style.setProperty('--startup-progress', `${clampedPercent}%`);
        track.setAttribute('aria-valuenow', String(clampedPercent));
    }
    const percentEl = loader.querySelector('#history-feather-percent');
    if (percentEl) percentEl.textContent = `${clampedPercent}%`;

    const activeIndex = HISTORY_LOADING_STEPS.findIndex(s => s.key === activeStepKey);
    let settledCount = 0;
    HISTORY_LOADING_STEPS.forEach((s, idx) => {
        const itemEl = loader.querySelector(`[data-step="${s.key}"]`);
        if (!itemEl) return;
        const smallEl = itemEl.querySelector('small');
        if (clampedPercent >= 100 || idx < activeIndex) {
            itemEl.dataset.state = 'ready';
            if (smallEl) smallEl.textContent = SLAT('sla.history.stepReady');
            settledCount++;
        } else if (idx === activeIndex) {
            itemEl.dataset.state = 'loading';
            if (smallEl) smallEl.textContent = SLAT('sla.history.stepRunning');
        } else {
            itemEl.dataset.state = 'waiting';
            if (smallEl) smallEl.textContent = SLAT('sla.history.stepWaiting');
        }
    });

    if (clampedPercent >= 100) settledCount = HISTORY_LOADING_STEPS.length;
    const countEl = loader.querySelector('#history-feather-step-count');
    if (countEl) countEl.textContent = SLAT('sla.history.stepCount', { settled: settledCount, total: HISTORY_LOADING_STEPS.length });

    const msgEl = loader.querySelector('#history-feather-msg');
    if (msgEl) {
        const activeStep = HISTORY_LOADING_STEPS[activeIndex];
        msgEl.textContent = clampedPercent >= 100
            ? SLAT('sla.history.ready')
            : (activeStep ? `${activeStep.label()}…` : SLAT('sla.history.loadingShort'));
    }
}

async function openHistoryModal() {
    const modal = document.getElementById('history-modal');
    if(modal) modal.style.display = 'flex';
    const list = document.getElementById('history-modal-list');
    const paginationBar = document.getElementById('history-pagination-bar');
    if (paginationBar) paginationBar.style.display = 'none';

    renderHistoryLoadingState(list, 'snapshots', 15);
    syncHistoryScrollbar();

    try {
        const mode = API.getSourceMode('sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;

        renderHistoryLoadingState(list, 'snapshots', 25);
        const dataPromise = API.get(`/api/sla/snapshots${query}`);
        const data = await dataPromise;
        renderHistoryLoadingState(list, 'config', 50);

        const configPromise = API.get(`/api/sla/config${query}`).catch(() => null);
        const configData = await configPromise;
        renderHistoryLoadingState(list, 'catalog', 75);

        const catalogPromise = API.get('/api/upload/source-catalog').catch(() => null);
        const catalog = await catalogPromise;
        renderHistoryLoadingState(list, 'render', 92);

        latestSLAHistorySnapshots = Array.isArray(data) ? data : [];
        latestSLAHistorySourceFiles = catalog?.files || [];
        latestSLAHistoryI18nMap = (configData && configData.prefs && configData.prefs.i18nMap) || {};
        latestSLAHistoryMetricFormatMap = buildHistoryMetricFormatMap(configData);
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();

        renderHistoryLoadingState(list, 'render', 100);
        await new Promise(r => setTimeout(r, 160));

        renderHistory(latestSLAHistorySnapshots);
    } catch(e) {
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
        if(list) list.innerHTML = `<div style="color:red;padding:24px;text-align:center;">${SLAT('sla.history.loadFail', { message: e.message })}</div>`;
    }
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal');
    if(modal) modal.style.display = 'none';
    const paginationBar = document.getElementById('history-pagination-bar');
    if (paginationBar) paginationBar.style.display = 'none';
    cleanupHistoryScroll();
}

function renderHistoryPaginationBar(barEl, { totalCount, totalPages, currentPage, pageSize, startIndex, endIndex }) {
    if (!barEl) return;
    const summaryText = pageSize === 'all'
        ? SLAT('sla.history.paginationSummaryAll', { total: totalCount })
        : SLAT('sla.history.paginationSummary', { total: totalCount, start: startIndex, end: endIndex });

    const pageNumbers = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
    } else {
        if (currentPage <= 4) {
            pageNumbers.push(1, 2, 3, 4, 5, '...', totalPages);
        } else if (currentPage >= totalPages - 3) {
            pageNumbers.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
        } else {
            pageNumbers.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
        }
    }

    barEl.innerHTML = `
        <div class="history-pagination-left">
            <span class="history-pagination-summary">${escapeHTML(summaryText)}</span>
            <label class="history-page-size-wrap">
                <span>${escapeHTML(SLAT('sla.history.pageSizeLabel'))}</span>
                <select class="history-page-size-select" onchange="window.setHistoryPageSize(this.value)">
                    <option value="10" ${pageSize == 10 ? 'selected' : ''}>${escapeHTML(SLAT('sla.history.pageSizeDefault'))}</option>
                    <option value="20" ${pageSize == 20 ? 'selected' : ''}>${escapeHTML(SLAT('sla.history.pageSizeUnit', { size: '20' }))}</option>
                    <option value="50" ${pageSize == 50 ? 'selected' : ''}>${escapeHTML(SLAT('sla.history.pageSizeUnit', { size: '50' }))}</option>
                    <option value="100" ${pageSize == 100 ? 'selected' : ''}>${escapeHTML(SLAT('sla.history.pageSizeUnit', { size: '100' }))}</option>
                    <option value="all" ${pageSize === 'all' ? 'selected' : ''}>${escapeHTML(SLAT('sla.history.pageSizeAll'))}</option>
                </select>
            </label>
        </div>
        <div class="history-pagination-right">
            <button type="button" class="history-page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="window.gotoHistoryPage(1)" title="${escapeHTML(SLAT('sla.history.firstPage'))}">«</button>
            <button type="button" class="history-page-btn" ${currentPage <= 1 ? 'disabled' : ''} onclick="window.gotoHistoryPage(${currentPage - 1})" title="${escapeHTML(SLAT('sla.history.prevPage'))}">‹</button>
            <div class="history-page-numbers">
                ${pageNumbers.map(p => p === '...'
                    ? `<span class="history-page-ellipsis">…</span>`
                    : `<button type="button" class="history-page-btn ${p === currentPage ? 'active' : ''}" onclick="window.gotoHistoryPage(${p})">${p}</button>`
                ).join('')}
            </div>
            <button type="button" class="history-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="window.gotoHistoryPage(${currentPage + 1})" title="${escapeHTML(SLAT('sla.history.nextPage'))}">›</button>
            <button type="button" class="history-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} onclick="window.gotoHistoryPage(${totalPages})" title="${escapeHTML(SLAT('sla.history.lastPage'))}">»</button>
            <div class="history-page-jump-wrap">
                <span>${escapeHTML(SLAT('sla.history.jumpTo'))}</span>
                <input type="number" min="1" max="${totalPages}" value="${currentPage}" class="history-page-jump-input" id="history-page-jump-input" onkeydown="if(event.key==='Enter')window.gotoHistoryPage(this.value)">
                <span>${escapeHTML(SLAT('sla.history.pageUnit'))}</span>
                <button type="button" class="history-page-jump-btn" onclick="window.gotoHistoryPage(document.getElementById('history-page-jump-input').value)">${escapeHTML(SLAT('sla.history.jumpTo'))}</button>
            </div>
        </div>
    `;
}

window.gotoHistoryPage = function(page) {
    const p = parseInt(page, 10);
    if (isNaN(p)) return;
    const totalCount = latestSLAHistorySnapshots.length;
    const totalPages = historyPageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalCount / historyPageSize));
    const target = Math.max(1, Math.min(p, totalPages));
    if (target === historyCurrentPage) return;
    historyCurrentPage = target;
    renderHistory(latestSLAHistorySnapshots);
    const wrapper = document.getElementById('history-table-scroll');
    if (wrapper) wrapper.scrollTop = 0;
};

window.setHistoryPageSize = function(size) {
    historyPageSize = size === 'all' ? 'all' : (parseInt(size, 10) || 10);
    historyCurrentPage = 1;
    renderHistory(latestSLAHistorySnapshots);
    const wrapper = document.getElementById('history-table-scroll');
    if (wrapper) wrapper.scrollTop = 0;
};

function renderHistory(data) {
    if (Array.isArray(data)) latestSLAHistorySnapshots = data;
    const list = document.getElementById('history-modal-list');
    const paginationBar = document.getElementById('history-pagination-bar');
    if(!list) return;
    
    if(!data || !data.length) {
        list.innerHTML = `<div style="padding:40px;text-align:center;color:#666;">${SLAT('sla.history.empty')}</div>`;
        if (paginationBar) paginationBar.style.display = 'none';
        syncHistoryScrollbar();
        return;
    }

    // 1. 收集所有出现过的核心指标名称作为表头（按全量快照，保证列对齐）
    const metricKeys = new Set();
    data.forEach(item => {
        if (item.topMetrics) {
            item.topMetrics.forEach(m => metricKeys.add(m.label));
        }
    });
    const metricHeaders = Array.from(metricKeys);

    // 2. 分页计算与渐进式按需切片渲染
    const totalCount = data.length;
    const totalPages = historyPageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalCount / historyPageSize));
    if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
    if (historyCurrentPage < 1) historyCurrentPage = 1;

    let startIndex = 0;
    let endIndex = totalCount;
    let pageItems = data;
    if (historyPageSize !== 'all') {
        startIndex = (historyCurrentPage - 1) * historyPageSize;
        endIndex = Math.min(startIndex + historyPageSize, totalCount);
        pageItems = data.slice(startIndex, endIndex);
    }

    let html = `
    <style>
        .history-table-wrapper { overflow: auto; max-width: 100%; height: 100%; border-radius: 4px; position: relative; }
        .history-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
        .history-table th { color: #344b62; background: #f1f3f4; padding: 10px; text-align: left; border-bottom: 2px solid #ccc; border-right: 1px solid #ddd; position: sticky; top: 0; z-index: 10; font-weight: bold; white-space: nowrap; }
        .history-table td { padding: 10px 12px; border-bottom: 1px solid #eee; border-right: 1px solid #eee; vertical-align: middle; white-space: nowrap; }
        .history-table tr:hover td { background: #f9f9f9; }
        .history-table td.warn-cell { background: #ffebee; border-left: 2px solid #ef5350; }
        .snap-gap { display: block; font-size: 10px; color: #d32f2f; font-weight: bold; margin-top: 2px; }
        .snap-value-normal { color: #555; }
        .snap-value-warn { color: #d32f2f; font-weight: bold; font-size: 14px; }
        .sticky-col { left: 0; position: sticky; background: #e0e0e0 !important; z-index: 20 !important; box-shadow: 2px 0 5px rgba(0,0,0,0.1); border-right: 2px solid #ccc !important; }
        .sticky-col-td { left: 0; position: sticky; background: #fafafa !important; z-index: 11 !important; box-shadow: 2px 0 5px rgba(0,0,0,0.05); border-right: 2px solid #ccc !important; }
        .history-table tr:hover td.sticky-col-td { background: #f0f0f0 !important; }
        .summary-col { min-width: 220px; max-width: 520px; white-space: normal !important; word-wrap: break-word; }
        .history-summary-details { min-width: 190px; }
        .history-summary-toggle { display:inline-flex; align-items:center; gap:6px; color:#1565c0; font-weight:800; cursor:pointer; user-select:none; list-style:none; }
        .history-summary-toggle::-webkit-details-marker { display:none; }
        .history-summary-toggle::before { content:'▶'; font-size:9px; transition:transform .15s ease; }
        .history-summary-details[open] > .history-summary-toggle::before { transform:rotate(90deg); }
        .history-summary-content { margin-top:8px; min-width:330px; }
        .history-import-cell { display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-width:156px; padding:4px 0; }
        .history-import-time { color:#1976d2; font-weight:800; line-height:1.45; white-space:normal; word-break:break-word; }
        .history-import-badges { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
        .history-target-month-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:999px; background:linear-gradient(135deg,#fff7ed,#ffedd5); border:1px solid #fdba74; color:#c2410c; box-shadow:0 2px 6px rgba(234,88,12,.10); font-size:10px; font-weight:900; line-height:1.35; letter-spacing:.1px; }
        .history-auto-import-badge { display:inline-flex; align-items:center; padding:3px 8px; border-radius:999px; background:#ecfeff; border:1px solid #67e8f9; color:#0369a1; font-size:10px; font-weight:800; line-height:1.35; }
        .history-delete-btn { display:inline-flex; align-items:center; justify-content:center; min-height:24px; padding:3px 8px; font-size:11px; background:#fff; border:1px solid #fecaca; color:#dc2626; border-radius:6px; cursor:pointer; line-height:1.2; }
        .history-delete-btn:hover { background:#fff1f2; border-color:#fca5a5; }
        .history-actions { display:flex;flex-wrap:wrap;gap:6px; }
        .history-load-btn { display:inline-flex;align-items:center;justify-content:center;min-height:24px;padding:3px 8px;font-size:11px;background:var(--bg-secondary,#eff6ff);border:1px solid #93c5fd;color:var(--text-color,#1565c0);border-radius:6px;cursor:pointer;line-height:1.2; }
        .history-load-btn:disabled { opacity:.6;cursor:wait; }
    </style>
    <div class="history-table-wrapper" id="history-table-scroll">
    <table class="history-table">
        <thead>
            <tr>
                <th class="sticky-col" style="min-width: 170px;">${SLAT('sla.history.importTime')}</th>
                <th>${SLAT('sla.history.sourceTables')}</th>
                ${metricHeaders.map(h => `<th title="${escapeHTML(h)}">${escapeHTML(getHistoryMetricLabel(h))}</th>`).join('')}
                <th class="summary-col">${SLAT('sla.history.summary')}</th>
            </tr>
        </thead>
        <tbody>
    `;

    pageItems.forEach(item => {
        const d = new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false });
        const isAutoImport = item.importSource === 'uivf12' || item.source === 'uivf12';
        const autoImportBadge = isAutoImport ? '<span class="history-auto-import-badge">自动导入</span>' : '';
        const targetMonth = getHistoryTargetMonth(item);
        const targetMonthBadge = targetMonth
            ? `<span class="history-target-month-badge">🎯 ${escapeHTML(SLAT('sla.history.targetMonth', { month: targetMonth }))}</span>`
            : '';
        
        const mMap = {};
        if (item.topMetrics) {
            item.topMetrics.forEach(m => {
                mMap[m.label] = m;
            });
        }

        let metricColsHtml = '';
        metricHeaders.forEach(h => {
            const m = mMap[h];
            if (m) {
                let cellSubHtml = '';
                if (m.subMetrics && m.subMetrics.length > 0) {
                    cellSubHtml = `<div style="margin-top:4px; font-size:10px; color:#666; border-top:1px solid #e0e0e0; padding-top:2px;">`;
                    m.subMetrics.forEach(sm => {
                        const categoryLabel = getHistoryMetricLabel(sm.category);
                        cellSubHtml += `<div style="margin-bottom:2px;" title="${escapeHTML(sm.category)}">${escapeHTML(categoryLabel)}: <b style="color:#e65100">${escapeHTML(String(sm.value))}</b></div>`;
                    });
                    cellSubHtml += `</div>`;
                }

                if (m.isWarn) {
                    const gapText = m.gap ? `<span class="snap-gap">${m.gap}</span>` : '';
                    metricColsHtml += `<td class="warn-cell" style="vertical-align:top;"><span class="snap-value-warn">${escapeHTML(getHistoryMetricValue(h, m.value))}</span>${gapText}${cellSubHtml}</td>`;
                } else {
                    const safeColor = m.color && m.color.includes('#') ? m.color : '#333';
                    metricColsHtml += `<td style="vertical-align:top;"><span class="snap-value-normal" style="color:${safeColor}; font-weight:bold;">${escapeHTML(getHistoryMetricValue(h, m.value))}</span>${cellSubHtml}</td>`;
                }
            } else {
                metricColsHtml += `<td style="color:#ccc; vertical-align:top;">--</td>`;
            }
        });

        let summaryHtml = '';
        let summaryMetricCount = 0;
        if(item.summary && item.summary.length) {
            item.summary.forEach(sec => {
                let secText = `<strong style="color:#555;">${escapeHTML(sec.section.replace(/\s*合集/, ''))}</strong>: `;
                sec.metrics.forEach(m => {
                    summaryMetricCount += 1;
                    const statusColor = (m.status || '').includes('达标') ? '#388e3c' : ((m.status || '').includes('落后') ? '#d32f2f' : '#888');
                    const metricTitle = getHistoryMetricLabel(m.title);
                    const statusLabel = getHistoryStatusLabel(m.status);
                    secText += `<span style="margin-right:6px;" title="${escapeHTML(m.title)}">${escapeHTML(metricTitle)} <strong style="color:#333">${escapeHTML(getHistoryMetricValue(m.title, m.value))}</strong> <span style="color:${statusColor}">${escapeHTML(statusLabel)}</span></span>`;
                });
                summaryHtml += `<div style="margin-bottom:4px; font-size:11px; background:#f5f5f5; padding:3px 6px; border-radius:4px;">${secText}</div>`;
            });
        }
        const summaryCellHtml = summaryHtml
            ? `<details class="history-summary-details"><summary class="history-summary-toggle">${escapeHTML(SLAT('sla.history.expandSummary', { count: summaryMetricCount }))}</summary><div class="history-summary-content">${summaryHtml}</div></details>`
            : '<span style="color:#aaa;">--</span>';

        html += `
            <tr>
                <td class="sticky-col-td">
                    <div class="history-import-cell">
                        <div class="history-import-time">${escapeHTML(d)}</div>
                        <div class="history-import-badges">${targetMonthBadge}${autoImportBadge}</div>
                        <div class="history-actions"><button class="history-delete-btn" onclick="deleteHistorySnapshot('${item.id}')" title="${SLAT('sla.history.deleteTitle')}">${SLAT('sla.history.delete')}</button>
                        ${item.sourceBatchId && latestSLAHistorySourceFiles.some(file=>file.batch_id===item.sourceBatchId) ? `<button type="button" class="history-load-btn" data-source-snapshot="${escapeHTML(item.id)}" ${loadingSLAHistorySource?'disabled':''} title="${escapeHTML(SLAT('sla.history.loadOriginalsTitle'))}">${SLAT('sla.history.loadOriginals')}</button>` : ''}</div>
                    </div>
                </td>
                <td><span style="background:#e3f2fd; padding:2px 6px; border-radius:10px; color:#1565c0;">${item.files.length}</span></td>
                ${metricColsHtml}
                <td class="summary-col">${summaryCellHtml}</td>
            </tr>
        `;
    });
    
    html += `</tbody></table></div>`;
    list.innerHTML = html;
    list.querySelectorAll('[data-source-snapshot]').forEach(button=>button.addEventListener('click',()=>loadHistoryOriginals(button.dataset.sourceSnapshot)));

    if (paginationBar) {
        paginationBar.style.display = 'flex';
        renderHistoryPaginationBar(paginationBar, {
            totalCount,
            totalPages,
            currentPage: historyCurrentPage,
            pageSize: historyPageSize,
            startIndex: startIndex + 1,
            endIndex
        });
    }

    syncHistoryScrollbar();
}

async function loadHistoryOriginals(id) {
    if (loadingSLAHistorySource) return;
    const snapshot = latestSLAHistorySnapshots.find(item=>String(item.id)===String(id));
    if (!snapshot) return;
    loadingSLAHistorySource = true;
    document.querySelectorAll('.history-load-btn').forEach(button=>{button.disabled=true;button.textContent=SLAT('sla.history.loadingOriginals');});
    try {
        await window.SLAUpload.loadArchivedSnapshot(snapshot);
        closeHistoryModal();
        showToast(SLAT('sla.history.originalsLoaded'));
    } catch (error) {
        showToast(SLAT('sla.history.originalsLoadFail', { message:error.message }), 'error');
    } finally {
        loadingSLAHistorySource = false;
        renderHistory(latestSLAHistorySnapshots);
    }
}

const historyDeleteText=(zh,en)=>window.ToolsI18n?.getLanguage()==='en-US'?en:zh;
const historyFileSize=value=>{const bytes=Number(value)||0;return bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(1)+' MB';};
window.deleteHistorySnapshot = async function(id) {
    if(document.getElementById('history-delete-dialog'))return;
    const dialog=document.createElement('dialog');dialog.id='history-delete-dialog';dialog.className='history-delete-dialog';
    dialog.innerHTML=`<header><div><small>${historyDeleteText('历史导入预警快照','Historical import snapshot')}</small><h3>${historyDeleteText('删除快照','Delete snapshot')}</h3></div><button type="button" data-close aria-label="${historyDeleteText('关闭','Close')}">×</button></header><div data-impact><p>${historyDeleteText('正在读取关联原始文件…','Loading associated original files…')}</p></div><p data-error role="alert"></p><footer><button type="button" data-close>${historyDeleteText('取消','Cancel')}</button></footer>`;
    document.body.append(dialog);let busy=false;
    dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    const bindClose=()=>dialog.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>{if(!busy)dialog.close();});bindClose();dialog.showModal();
    try{
        const impact=await API.get('/api/sla/snapshots/'+encodeURIComponent(id)+'/delete-preview');if(!dialog.isConnected||!dialog.open)return;
        const snapshot=latestSLAHistorySnapshots.find(item=>String(item.id)===String(id));
        dialog.querySelector('[data-impact]').innerHTML=`<p>${escapeHTML(snapshot?.timestamp||'')}</p><p>${historyDeleteText('请选择删除范围。仅删除快照会保留历史原始文件；一并删除会永久移除文件及已解析工作表。','Choose the deletion scope. Snapshot-only deletion keeps original archives; deleting both permanently removes files and parsed worksheets.')}</p><div class="history-delete-summary">${historyDeleteText('关联原始文件','Associated original files')} · ${impact.files.length} · ${historyFileSize(impact.totalBytes)}</div>${impact.files.length?`<div class="history-delete-files"><table><thead><tr><th>${historyDeleteText('原始文件','Original file')}</th><th>${historyDeleteText('存档方式','Archive format')}</th><th>${historyDeleteText('文件大小','File size')}</th></tr></thead><tbody>${impact.files.map(file=>`<tr><td title="${escapeHTML(file.name)}">${escapeHTML(file.name)}<small>${escapeHTML(file.created_at)} · ${file.sheetCount} ${historyDeleteText('个工作表','worksheets')}</small></td><td>${file.kind==='structured'?historyDeleteText('结构化行','Structured rows'):historyDeleteText('原文件','Original file')}</td><td>${historyFileSize(file.size)}</td></tr>`).join('')}</tbody></table></div>`:`<p>${historyDeleteText('没有关联原始文件。','No associated original files.')}</p>`}${impact.sharedSnapshotCount?`<p class="history-delete-warning">${historyDeleteText('这些文件所在批次还被 '+impact.sharedSnapshotCount+' 份快照引用。一并删除后，其他快照的已保存指标会保留，但原始文件将无法读取。','This batch is referenced by '+impact.sharedSnapshotCount+' other snapshots. Their saved metrics remain, but the original files will no longer be available.')}</p>`:''}`;
        dialog.querySelector('footer').innerHTML=`<button type="button" data-close>${historyDeleteText('取消','Cancel')}</button><button type="button" data-delete="snapshot">${historyDeleteText('仅删除快照','Delete snapshot only')}</button>${impact.files.length?`<button type="button" data-delete="all" class="history-delete-danger">${historyDeleteText('删除快照及原始文件','Delete snapshot and originals')}</button>`:''}`;bindClose();
        dialog.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{
            if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(item=>item.disabled=true);dialog.querySelector('[data-error]').textContent='';
            
            const isDeleteAll = button.dataset.delete === 'all';
            const impactEl = dialog.querySelector('[data-impact]');
            const footerEl = dialog.querySelector('footer');
            if (footerEl) footerEl.style.display = 'none';
            if (impactEl) {
                impactEl.innerHTML = `
                    <div class="history-delete-progress-card">
                        <div class="startup-art" aria-hidden="true">
                            <div class="startup-halo"></div>
                            <div class="startup-feather" data-startup-feather></div>
                        </div>
                        <h4>${escapeHTML(SLAT('sla.history.deleteProgressTitle'))}</h4>
                        <p class="history-delete-progress-msg" id="history-delete-step-msg">${escapeHTML(SLAT('sla.history.deleteStepRequest'))}</p>
                        <div class="startup-track" id="history-delete-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25" style="--startup-progress: 25%;">
                            <span></span>
                        </div>
                        <div class="startup-progress-label">
                            <span>${isDeleteAll ? escapeHTML(historyDeleteText('清理快照与关联原始文件', 'Deleting snapshot and associated files')) : escapeHTML(historyDeleteText('清理快照记录', 'Deleting snapshot record'))}</span>
                            <strong id="history-delete-percent">25%</strong>
                        </div>
                    </div>
                `;
                renderFeatherArt(impactEl);
            }

            const updateDeleteProgress = (stepMsg, percent) => {
                const track = dialog.querySelector('#history-delete-track');
                const pEl = dialog.querySelector('#history-delete-percent');
                const mEl = dialog.querySelector('#history-delete-step-msg');
                if (track) track.style.setProperty('--startup-progress', `${percent}%`);
                if (pEl) pEl.textContent = `${percent}%`;
                if (mEl) mEl.textContent = stepMsg;
            };

            try{
                updateDeleteProgress(SLAT('sla.history.deleteStepClean'), 55);
                await API.deleteWithBody('/api/sla/snapshots/'+encodeURIComponent(id),{deleteOriginals:isDeleteAll,confirmed:true,previewToken:impact.previewToken});
                updateDeleteProgress(isDeleteAll ? SLAT('sla.history.deleteStepFiles') : SLAT('sla.history.deleteStepFinish'), 90);
                await new Promise(r => setTimeout(r, 180));
                updateDeleteProgress(SLAT('sla.history.deleteStepFinish'), 100);
                await new Promise(r => setTimeout(r, 120));
                dialog.close();
                showToast(SLAT('sla.history.deleted'));
                
                if (latestSLAHistorySnapshots.length > 1 && historyPageSize !== 'all') {
                    const remainingTotal = latestSLAHistorySnapshots.length - 1;
                    const maxPage = Math.max(1, Math.ceil(remainingTotal / historyPageSize));
                    if (historyCurrentPage > maxPage) {
                        historyCurrentPage = maxPage;
                    }
                }
                await openHistoryModal();
            }catch(error){
                if (footerEl) footerEl.style.display = 'flex';
                dialog.querySelector('[data-error]').textContent=error.status===409?historyDeleteText('文件清单已变化，请关闭此窗口后重新查看并确认。','The file list changed. Close this window and review the updated list.'):SLAT('sla.history.deleteFail',{message:error.message});
            }
            finally{busy=false;dialog.querySelectorAll('button').forEach(item=>item.disabled=false);}
        });
    }catch(error){if(dialog.isConnected)dialog.querySelector('[data-error]').textContent=SLAT('sla.history.deleteFail',{message:error.message});}
};

window.openHistoryModal = openHistoryModal;
window.closeHistoryModal = closeHistoryModal;
window.renderHistory = renderHistory;
window.renderHistoryLoadingState = renderHistoryLoadingState;

window.addEventListener('tools:languagechange', () => {
    const modal = document.getElementById('history-modal');
    if (modal && modal.style.display === 'flex' && Array.isArray(latestSLAHistorySnapshots)) {
        renderHistory(latestSLAHistorySnapshots);
    }
});

