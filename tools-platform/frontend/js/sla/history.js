let latestSLAHistorySnapshots = [];
let latestSLAHistoryI18nMap = {};
let latestSLAHistoryMetricFormatMap = {};
let latestSLAHistorySourceFiles = [];
let loadingSLAHistorySource = false;

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

async function openHistoryModal() {
    const modal = document.getElementById('history-modal');
    if(modal) modal.style.display = 'flex';
    const list = document.getElementById('history-modal-list');
    if(list) list.innerHTML = `<div class="loading-text">${SLAT('sla.history.loadingShort')}</div>`;
    try {
        const mode = API.getSourceMode('sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
        const [data, configData, catalog] = await Promise.all([
            API.get(`/api/sla/snapshots${query}`),
            API.get(`/api/sla/config${query}`).catch(() => null),
            API.get('/api/upload/source-catalog').catch(() => null)
        ]);
        latestSLAHistorySnapshots = Array.isArray(data) ? data : [];
        latestSLAHistorySourceFiles = catalog?.files || [];
        latestSLAHistoryI18nMap = (configData && configData.prefs && configData.prefs.i18nMap) || {};
        latestSLAHistoryMetricFormatMap = buildHistoryMetricFormatMap(configData);
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
        renderHistory(latestSLAHistorySnapshots);
    } catch(e) {
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
        if(list) list.innerHTML = `<div style="color:red;padding:20px;">${SLAT('sla.history.loadFail', { message: e.message })}</div>`;
    }
}

function closeHistoryModal() {
    const modal = document.getElementById('history-modal');
    if(modal) modal.style.display = 'none';
}

function renderHistory(data) {
    const list = document.getElementById('history-modal-list');
    if(!list) return;
    
    if(!data || !data.length) {
        list.innerHTML = `<div style="padding:40px;text-align:center;color:#666;">${SLAT('sla.history.empty')}</div>`;
        return;
    }

    // 1. 收集所有出现过的核心指标名称作为表头
    const metricKeys = new Set();
    data.forEach(item => {
        if (item.topMetrics) {
            item.topMetrics.forEach(m => metricKeys.add(m.label));
        }
    });
    const metricHeaders = Array.from(metricKeys);

    let html = `
    <style>
        .history-table-wrapper { overflow: auto; max-width: 100%; height: 100%; border-radius: 4px; position: relative; }
        .history-table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
        .history-table th { background: #f1f3f4; padding: 10px; text-align: left; border-bottom: 2px solid #ccc; border-right: 1px solid #ddd; position: sticky; top: 0; z-index: 10; font-weight: bold; white-space: nowrap; }
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
    <div class="history-table-wrapper">
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

    data.forEach(item => {
        const d = new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false });
        const isAutoImport = item.importSource === 'uivf12' || item.source === 'uivf12';
        const autoImportBadge = isAutoImport ? '<span class="history-auto-import-badge">自动导入</span>' : '';
        const targetMonth = getHistoryTargetMonth(item);
        const targetMonthBadge = targetMonth
            ? `<span class="history-target-month-badge">🎯 ${escapeHTML(SLAT('sla.history.targetMonth', { month: targetMonth }))}</span>`
            : '';
        
        // 构建当前行的指标 map
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

        // 区块汇总渲染
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

window.deleteHistorySnapshot = async function(id) {
    if (!confirm(SLAT('sla.history.confirmDelete'))) return;
    try {
        await API.delete('/api/sla/snapshots/' + encodeURIComponent(id));
        showToast(SLAT('sla.history.deleted'));
        // 重新加载快照列表
        openHistoryModal();
    } catch(e) {
        showToast(SLAT('sla.history.deleteFail', { message: e.message }), 'error');
    }
};

window.openHistoryModal = openHistoryModal;
window.closeHistoryModal = closeHistoryModal;

window.addEventListener('tools:languagechange', () => {
    const modal = document.getElementById('history-modal');
    if (modal && modal.style.display === 'flex' && Array.isArray(latestSLAHistorySnapshots)) {
        renderHistory(latestSLAHistorySnapshots);
    }
});
