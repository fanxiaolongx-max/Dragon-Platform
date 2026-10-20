/**
 * sla/metrics.js - 顶部数据舱：指标推送、预警呼吸灯、目标配置弹窗
 */

function evaluateAllMetrics() {
    window.GlobalMetrics = {};
    const shouldAutoPercent = (label, colName) => (
        String(label || '').includes('率') || String(colName || '').includes('率')
    );
    const formatMetricValueByTarget = (value, targetDef, autoPercent, ruleType, aggregation) => {
        if (value === '--' || ruleType === 'count' || ruleType === 'ratio' || (ruleType === 'extract_multi' && aggregation === 'count')) return value;
        const strVal = String(value).trim();
        if (targetDef && targetDef.isPercent === false && strVal.endsWith('%')) {
            return strVal.replace(/%$/, '');
        }
        const isPercentFormat = targetDef && targetDef.isPercent !== undefined ? targetDef.isPercent : autoPercent;
        if (!isPercentFormat) return value;
        const isPercent = strVal.endsWith('%');
        const num = parseFloat(strVal);
        return !isNaN(num) ? (isPercent ? Math.round(num) + '%' : Math.round(num * 100) + '%') : value;
    };
    Object.keys(AppState).forEach(secId => {
        const state = AppState[secId];
        if (state.archiveSupplementary || !state.customMetrics || !state.customMetrics.length) return;
        state.customMetrics.forEach(rule => {
            const displayLabel = typeof getMetricRuleDisplayLabel === 'function'
                ? getMetricRuleDisplayLabel(rule)
                : (rule.label || rule.colZ || '未命名指标');
            const evalRule = (r, dataRows) => {
                const checkMatch = (cellVal, pattern) => {
                    const str = (cellVal !== undefined && cellVal !== null) ? cellVal.toString().trim() : '';
                    if (pattern === '[空]') return str === '';
                    if (pattern === '[非空]') return str !== '';
                    return str.includes(pattern);
                };
                const rowMatches = row => {
                    if (typeof metricRuleRowMatches === 'function') return metricRuleRowMatches(row, r, true);
                    if (r.colX && !checkMatch(row[r.colX], r.valY)) return false;
                    return (Array.isArray(r.conditions) ? r.conditions : []).every(item => item && item.column && checkMatch(row[item.column], item.value));
                };

                if (r.type === 'count') {
                    let count = 0;
                    for (let i = 0; i < dataRows.length; i++) {
                        const row = dataRows[i];
                        if (rowMatches(row) && checkMatch(row[r.colZ], r.valK)) count++;
                    }
                    return count;
                } else if (r.type === 'ratio') {
                    let total = 0;
                    let matched = 0;
                    for (let i = 0; i < dataRows.length; i++) {
                        const row = dataRows[i];
                        if (rowMatches(row)) {
                            total++;
                            if (checkMatch(row[r.colZ], r.valK)) matched++;
                        }
                    }
                    return total > 0 ? Math.round((matched / total) * 100) + '%' : '0%';
                } else if (r.type === 'extract_multi') {
                    return aggregateMetricRowValues(dataRows.filter(rowMatches), r);
                } else {
                    for (let i = 0; i < dataRows.length; i++) {
                        const row = dataRows[i];
                        if (rowMatches(row)) {
                            return row[r.colZ] !== undefined && row[r.colZ] !== null ? row[r.colZ] : '--';
                        }
                    }
                    return '--';
                }
            };

            const getRuleDataRows = (r, defaultRows, currentSecId) => {
                if (!r || r.scope !== 'all') return defaultRows || [];
                const rows = [...(defaultRows || [])];
                Object.keys(AppState || {}).forEach(otherSecId => {
                    if (otherSecId !== currentSecId && AppState[otherSecId] && !AppState[otherSecId].archiveSupplementary && Array.isArray(AppState[otherSecId].globalData)) {
                        rows.push(...AppState[otherSecId].globalData);
                    }
                });
                return rows;
            };

            let matchedValue = evalRule(rule, getRuleDataRows(rule, state.globalData, secId));

            const ruleColZ = rule.colZ || '';
            const targetKey = `${secId}_${rule.id}`;
            const targetDef = window.GlobalTargets ? window.GlobalTargets[targetKey] : null;
            matchedValue = formatMetricValueByTarget(matchedValue, targetDef, shouldAutoPercent(displayLabel, ruleColZ), rule.type, rule.aggregation);
            
            const evaluatedSubMetrics = [];
            if (rule.subMetrics && rule.subMetrics.length > 0) {
                rule.subMetrics.forEach(sm => {
                    const isCross = sm.scope === 'all' || (!sm.scope && rule.scope === 'all');
                    const effectiveSm = isCross && !sm.scope ? { ...sm, scope: 'all' } : sm;
                    const baseSecId = sm.sourceSecId || secId;
                    const baseData = (sm.sourceSecId && AppState[sm.sourceSecId]) 
                                        ? AppState[sm.sourceSecId].globalData 
                                        : (sm.sourceSecId ? [] : state.globalData);
                    const smRows = getRuleDataRows(effectiveSm, baseData, baseSecId);
                    let smValue = evalRule(effectiveSm, smRows);
                    
                    const effectiveLabel = typeof getMetricRuleDisplayLabel === 'function'
                        ? getMetricRuleDisplayLabel(sm, rule)
                        : (sm.label || displayLabel || '');
                    const effectiveColZ = sm.colZ || rule.colZ || '';
                    const smTargetKey = `${secId}_${sm.id}`;
                    const smTargetDef = window.GlobalTargets ? (window.GlobalTargets[smTargetKey] || window.GlobalTargets[targetKey]) : null;
                    smValue = formatMetricValueByTarget(smValue, smTargetDef, shouldAutoPercent(effectiveLabel, effectiveColZ), sm.type, sm.aggregation);
                    evaluatedSubMetrics.push({ category: sm.category, value: smValue, scope: effectiveSm.scope });
                });
            }

            window.GlobalMetrics[`${secId}_${rule.id}`] = { label: displayLabel, value: matchedValue, color: rule.color, subMetrics: evaluatedSubMetrics, scope: rule.scope };
        });
    });
    renderTopStickyBar();
}

const SLA_TARGET_MONTH_KEY = 'sla_target_month';

function getTargetMonthDefaultByDay(date = new Date()) {
    const currentMonth = date.getMonth() + 1;
    if (date.getDate() < 10) {
        return currentMonth === 1 ? 12 : currentMonth - 1;
    }
    return currentMonth;
}

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSLATargetMonth() {
    const sel = document.getElementById('slaTargetMonthSelect');
    if (sel && sel.dataset.ready === 'true' && sel.value) return parseInt(sel.value, 10);
    try {
        const saved = JSON.parse(localStorage.getItem(SLA_TARGET_MONTH_KEY) || '{}');
        const month = parseInt(saved.month, 10);
        if (saved.date === getTodayKey() && month >= 1 && month <= 12) return month;
    } catch (e) {}
    return getTargetMonthDefaultByDay();
}

function setSLATargetMonth(month) {
    const normalized = parseInt(month, 10);
    if (normalized >= 1 && normalized <= 12) {
        const select = document.getElementById('slaTargetMonthSelect');
        if (select && select.dataset.ready === 'true') select.value = String(normalized);
        localStorage.setItem(SLA_TARGET_MONTH_KEY, JSON.stringify({
            month: normalized,
            date: getTodayKey()
        }));
    }
}

function initSLATargetMonthSelect() {
    const sel = document.getElementById('slaTargetMonthSelect');
    if (!sel) return;
    const selectedMonth = getSLATargetMonth();
    let html = '';
    for (let i = 1; i <= 12; i++) {
        html += `<option value="${i}">${SLAT('sla.month.option', { month: i })}</option>`;
    }
    sel.innerHTML = html;
    sel.value = selectedMonth;
    sel.dataset.ready = 'true';
    sel.onchange = () => {
        setSLATargetMonth(sel.value);
        renderTopStickyBar();
        if (window.AppState && typeof updateView === 'function') {
            Object.keys(window.AppState).forEach(secId => {
                if (window.AppState[secId] && window.AppState[secId].globalData && window.AppState[secId].globalData.length) {
                    updateView(secId);
                }
            });
        }
    };
}

window.expandedSubMetrics = window.expandedSubMetrics || new Set();

function toggleMetricSub(btn, explicitKey) {
    const item = btn ? btn.closest('.info-item') : null;
    const group = btn ? btn.closest('.info-group') : null;
    const list = item ? item.querySelector('.sub-metrics-list') : (btn && btn.parentNode ? btn.parentNode.nextElementSibling : null);
    if (!list) return;

    const metricKey = explicitKey || (item && item.dataset ? item.dataset.metricKey : null);
    const isOpening = list.style.display === 'none' || !list.classList.contains('open');
    if (isOpening) {
        list.style.display = 'block';
        list.classList.add('open');
        if (item) item.classList.add('sub-open');
        if (group) group.classList.add('sub-open');
        btn.innerHTML = '🔼';
        btn.title = '收起子指标';
        if (metricKey) window.expandedSubMetrics.add(metricKey);
        if (item && typeof item.scrollIntoView === 'function') {
            try { item.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }); } catch (e) {}
        }
    } else {
        list.style.display = 'none';
        list.classList.remove('open');
        if (item) item.classList.remove('sub-open');
        if (group) group.classList.remove('sub-open');
        btn.innerHTML = '🔽';
        btn.title = '展开子指标';
        if (metricKey) window.expandedSubMetrics.delete(metricKey);
    }
    syncStickyBarSubExpandedState();
}

function syncStickyBarSubExpandedState() {
    const bar = document.getElementById('global-sticky-bar');
    if (!bar) return;
    const openLists = bar.querySelectorAll('.sub-metrics-list.open, .sub-metrics-list[style*="display: block"]');
    const hasAnyOpen = (window.expandedSubMetrics && window.expandedSubMetrics.size > 0) || (openLists && openLists.length > 0);
    if (hasAnyOpen) {
        bar.classList.add('sub-expanded');
    } else {
        bar.classList.remove('sub-expanded');
    }
}

// 页面预警和历史快照共用同一个按月目标判断，保留 0 目标的语义。
function getMetricWarningState(metric, targetMap, month) {
    if (!targetMap || targetMap[month] === undefined || targetMap[month] === '') return { isWarn: false, gap: '' };
    const target = parseFloat(targetMap[month]);
    const current = parseFloat(String(metric.value).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(current) || !Number.isFinite(target)) return { isWarn: false, gap: '' };
    const type = targetMap.type || 'gte';
    const isWarn = (type === 'gte' && current < target) || (type === 'lte' && current > target);
    const suffix = String(metric.value).includes('%') ? '%' : '';
    return { isWarn, gap: isWarn ? `${type === 'lte' ? '超' : '差'} ${+Math.abs(target - current).toFixed(2)}${suffix}` : '' };
}

function renderTopStickyBar() {
    const content = document.getElementById('sticky-bar-content');
    const btnExpand = document.getElementById('btn-expand-metrics');
    const btnTarget = document.getElementById('btn-target-config');
    const title = document.querySelector('.sticky-bar-title');
    const collator = new Intl.Collator('zh-Hans-CN-u-co-pinyin', {
        numeric: true,
        sensitivity: 'base'
    });
    const keys = Object.keys(window.GlobalMetrics).sort((a, b) => {
        const left = window.GlobalMetrics[a] || {};
        const right = window.GlobalMetrics[b] || {};
        const labelCompare = collator.compare(String(left.label || ''), String(right.label || ''));
        return labelCompare || String(a).localeCompare(String(b), 'en', { numeric: true });
    });
    const cm = getSLATargetMonth();
    if (title) {
        const baseTitle = SLAT('sla.sticky.title') || '⚡ 核心数据舱：';
        title.textContent = `${baseTitle.replace(/：$/, '')}（${keys.length}个指标）：`;
    }
    
    // Always show target config button so users can configure targets without importing files
    btnTarget.style.display = 'inline-block';
    
    if (!keys.length) {
        if (window.expandedSubMetrics) window.expandedSubMetrics.clear();
        syncStickyBarSubExpandedState();
        content.innerHTML = `<span style="color:#888;">${SLAT('sla.sticky.noData')}</span>`;
        btnExpand.style.display = 'none'; 
        return;
    }
    btnExpand.style.display = 'inline-block';

    if (window.expandedSubMetrics) {
        const keySet = new Set(keys);
        for (const ek of Array.from(window.expandedSubMetrics)) {
            if (!keySet.has(ek)) window.expandedSubMetrics.delete(ek);
        }
    }

    let html = '';
    keys.forEach(k => {
        const m = window.GlobalMetrics[k];
        const { isWarn, gap } = getMetricWarningState(m, window.GlobalTargets[k], cm);
        const gapHtml = gap ? `<span class="metric-gap">${gap}</span>` : '';
        const highlightClass = isWarn ? 'metric-warn-highlight' : '';
        const colorClass = isWarn ? 'danger' : m.color;

        const isSubOpen = Boolean(window.expandedSubMetrics && window.expandedSubMetrics.has(k));
        let subHtml = '';
        if (m.subMetrics && m.subMetrics.length > 0) {
            const displayStyle = isSubOpen ? 'display:block;' : 'display:none;';
            const openClass = isSubOpen ? 'open' : '';
            subHtml = `<div class="sub-metrics-list ${openClass}" style="${displayStyle} margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.2); font-size:11px;">`;
            const subItems = m.subMetrics.map(sm => {
                return `<span style="display:inline-block; margin-right:8px; white-space:nowrap; cursor:help;" title="${escapeHTML(m.label)} (${escapeHTML(sm.category)})">${escapeHTML(sm.category)}: <strong style="color:#ffb74d">${escapeHTML(String(sm.value))}</strong></span>`;
            });
            subHtml += subItems.join(' | ') + `</div>`;
        }

        const expandBtn = (m.subMetrics && m.subMetrics.length > 0)
            ? `<span onclick="toggleMetricSub(this)" class="metric-sub-toggle-btn" title="${isSubOpen ? '收起子指标' : '展开子指标'}">${isSubOpen ? '🔼' : '🔽'}</span>`
            : '';

        const itemSubClass = isSubOpen ? 'sub-open' : '';
        html += `<div class="info-group ${itemSubClass}"><div class="info-item ${highlightClass} ${itemSubClass}" data-metric-key="${escapeHTML(k)}" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; align-items:center; width:100%;">
                <span class="info-label">${escapeHTML(m.label)}:</span>
                <span class="info-value ${colorClass}">${escapeHTML(String(m.value))}</span>${gapHtml}${expandBtn}
            </div>
            ${subHtml}
        </div></div>`;
    });
    content.innerHTML = html;
    syncStickyBarSubExpandedState();
}

// ── 预警目标弹窗 ──────────────────────────────────────────

function getSecIdFromSLAPrefKey(schemaHash) {
    if (schemaHash.startsWith('sla_prefs_other_')) return schemaHash.replace('sla_prefs_', '');
    if (schemaHash.startsWith('sla_prefs_rectification')) return 'rectification';
    if (schemaHash.startsWith('sla_prefs_risk')) return 'risk';
    if (schemaHash.startsWith('sla_prefs_special')) return 'special';
    return schemaHash.replace('sla_prefs_', '');
}

function collectSavedCustomMetricTargets(prefs, targetKeys, labelMap) {
    const knownLabels = {};
    Object.keys(prefs || {}).forEach(schemaHash => {
        const pref = prefs[schemaHash];
        if (!pref || !Array.isArray(pref.customMetrics) || !pref.customMetrics.length) return;
        const secId = getSecIdFromSLAPrefKey(schemaHash);
        pref.customMetrics.forEach(cm => {
            const targetKey = `${secId}_${cm.id}`;
            knownLabels[cm.id] = cm.label;
            labelMap[targetKey] = cm.label;
            if (!targetKeys.includes(targetKey)) targetKeys.push(targetKey);
        });
    });
    return knownLabels;
}

let targetModalState = {
    view: 'cards',
    items: [],
    draft: {}
};

function isDefaultPercentTarget(label, key, targetDef) {
    return targetDef.isPercent === true || (targetDef.isPercent === undefined && (String(label || '').includes('率') || String(key || '').includes('率')));
}

function buildTargetDraft(targetKeys, labelMap) {
    const draft = {};
    targetKeys.forEach(k => {
        const targets = window.GlobalTargets[k] || {};
        const label = labelMap[k] || targets.label || k;
        draft[k] = {
            type: targets.type || 'gte',
            isPercent: isDefaultPercentTarget(label, k, targets)
        };
        for (let i = 1; i <= 12; i++) {
            draft[k][String(i)] = targets[i] !== undefined ? String(targets[i]) : '';
        }
    });
    return draft;
}

function stableTargetStringify(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
    const sorted = {};
    Object.keys(value).sort().forEach(key => {
        sorted[key] = value[key];
    });
    return JSON.stringify(sorted);
}

function buildTargetFromDraft(existingTarget, draft) {
    const next = { ...(existingTarget || {}) };
    next.type = draft.type || 'gte';
    next.isPercent = !!draft.isPercent;
    for (let i = 1; i <= 12; i++) {
        const month = String(i);
        const raw = Object.prototype.hasOwnProperty.call(draft, month) ? draft[month] : '';
        const val = String(raw ?? '').trim();
        if (val !== '') {
            next[month] = parseFloat(val);
        } else {
            delete next[month];
        }
    }
    return next;
}

function collectTargetDraftFromDom() {
    if (!targetModalState || !targetModalState.draft) return;
    document.querySelectorAll('#target-modal .condition-select').forEach(sel => {
        const k = sel.getAttribute('data-key');
        if (!k) return;
        if (!targetModalState.draft[k]) targetModalState.draft[k] = {};
        targetModalState.draft[k].type = sel.value || 'gte';
    });
    document.querySelectorAll('#target-modal .is-percent-checkbox').forEach(cb => {
        const k = cb.getAttribute('data-key');
        if (!k) return;
        if (!targetModalState.draft[k]) targetModalState.draft[k] = {};
        targetModalState.draft[k].isPercent = cb.checked;
    });
    document.querySelectorAll('#target-modal .target-month-input').forEach(input => {
        const k = input.getAttribute('data-key');
        const m = input.getAttribute('data-month');
        if (!k || !m) return;
        if (!targetModalState.draft[k]) targetModalState.draft[k] = {};
        targetModalState.draft[k][m] = input.value.trim();
    });
}

function renderTargetViewToggle() {
    const btn = document.getElementById('target-view-toggle');
    if (!btn) return;
    const isTable = targetModalState.view === 'table';
    btn.textContent = SLAT(isTable ? 'sla.metric.cardMode' : 'sla.metric.tableMode');
    btn.title = SLAT(isTable ? 'sla.metric.cardModeTitle' : 'sla.metric.tableModeTitle');
}

function targetDraftHasAnyMonthlyValue(draft) {
    if (!draft) return false;
    for (let i = 1; i <= 12; i++) {
        if (String(draft[String(i)] || '').trim() !== '') return true;
    }
    return false;
}

function getTargetModalStats() {
    const total = targetModalState.items.length;
    const filled = targetModalState.items.reduce((count, item) => {
        return count + (targetDraftHasAnyMonthlyValue(targetModalState.draft[item.key]) ? 1 : 0);
    }, 0);
    return { total, filled, missing: Math.max(0, total - filled) };
}

function renderTargetModalTitleStats() {
    const title = document.querySelector('#target-modal .modal-header h3');
    if (!title) return;
    const stats = getTargetModalStats();
    const titleText = SLAT('sla.modal.targetTitle');
    title.innerHTML = `${escapeHTML(titleText)} <span class="target-title-stats">${escapeHTML(SLAT('sla.metric.targetStats', stats))}</span>`;
}

function updateTargetInputEmptyState(input) {
    if (!input) return;
    const isEmpty = String(input.value || '').trim() === '';
    input.classList.toggle('empty-target-input', isEmpty);
    const group = input.closest('.month-input-group');
    if (group) group.classList.toggle('empty-target-cell', isEmpty);
    const cell = input.closest('td');
    if (cell) cell.classList.toggle('empty-target-cell', isEmpty);
}

function bindTargetInputEmptyState() {
    document.querySelectorAll('#target-modal .target-month-input').forEach(input => {
        updateTargetInputEmptyState(input);
        input.addEventListener('input', () => {
            updateTargetInputEmptyState(input);
            collectTargetDraftFromDom();
            renderTargetModalTitleStats();
        });
    });
}

function renderTargetCards() {
    return targetModalState.items.map(item => {
        const draft = targetModalState.draft[item.key] || {};
        let inputsHtml = '';
        for (let i = 1; i <= 12; i++) {
            const rawValue = Object.prototype.hasOwnProperty.call(draft, String(i)) ? draft[String(i)] : '';
            const value = rawValue ?? '';
            const emptyClass = String(value).trim() === '' ? ' empty-target-cell' : '';
            inputsHtml += `<div class="month-input-group${emptyClass}">
                <label>${SLAT('sla.metric.monthLabel', { month: i })}</label>
                <input class="target-month-input${emptyClass ? ' empty-target-input' : ''}" type="number" step="0.01" data-key="${item.key}" data-month="${i}" value="${escapeHTML(value)}" placeholder="${SLAT('sla.metric.targetPh')}">
            </div>`;
        }
        return `<div class="target-row">
            <div class="target-row-header">
                <span title="${escapeHTML(item.label)}">🏷️ ${escapeHTML(item.displayLabel)}</span>
                <div style="display:flex;align-items:center;gap:10px;">
                    <select class="condition-select" data-key="${item.key}">
                        <option value="gte" ${draft.type === 'gte' || !draft.type ? 'selected' : ''}>${SLAT('sla.metric.gte')}</option>
                        <option value="lte" ${draft.type === 'lte' ? 'selected' : ''}>${SLAT('sla.metric.lte')}</option>
                    </select>
                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;color:#555;">
                        <input type="checkbox" class="is-percent-checkbox" data-key="${item.key}" ${draft.isPercent ? 'checked' : ''}>
                        ${SLAT('sla.metric.percent')}
                    </label>
                    <span style="color:#666;font-weight:normal;font-size:13px;">${SLAT('sla.metric.currentValue')} <b style="color:#4a90e2;font-size:16px;">${escapeHTML(String(item.currentVal))}</b></span>
                </div>
            </div>
            <div class="target-months">${inputsHtml}</div>
        </div>`;
    }).join('');
}

function renderTargetTable() {
    const monthHeaders = Array.from({ length: 12 }, (_, i) => `<th>${SLAT('sla.metric.monthLabel', { month: i + 1 })}</th>`).join('');
    const rows = targetModalState.items.map(item => {
        const draft = targetModalState.draft[item.key] || {};
        const monthCells = Array.from({ length: 12 }, (_, index) => {
            const month = String(index + 1);
            const rawValue = Object.prototype.hasOwnProperty.call(draft, month) ? draft[month] : '';
            const value = rawValue ?? '';
            const emptyClass = String(value).trim() === '' ? ' empty-target-cell' : '';
            return `<td class="${emptyClass.trim()}"><input class="target-month-input target-table-input${emptyClass ? ' empty-target-input' : ''}" type="number" step="0.01" data-key="${item.key}" data-month="${month}" value="${escapeHTML(value)}" placeholder="${SLAT('sla.metric.targetPh')}"></td>`;
        }).join('');
        return `<tr>
            <th class="target-table-metric" title="${escapeHTML(item.label)}">🏷️ ${escapeHTML(item.displayLabel)}</th>
            <td class="target-table-current">${escapeHTML(String(item.currentVal))}</td>
            <td>
                <select class="condition-select" data-key="${item.key}">
                    <option value="gte" ${draft.type === 'gte' || !draft.type ? 'selected' : ''}>${SLAT('sla.metric.gteShort')}</option>
                    <option value="lte" ${draft.type === 'lte' ? 'selected' : ''}>${SLAT('sla.metric.lteShort')}</option>
                </select>
            </td>
            <td class="target-table-percent">
                <input type="checkbox" class="is-percent-checkbox" data-key="${item.key}" ${draft.isPercent ? 'checked' : ''}>
            </td>
            ${monthCells}
        </tr>`;
    }).join('');
    return `<div class="target-table-wrap">
        <table class="target-config-table">
            <thead>
                <tr>
                    <th>${SLAT('sla.metric.tableMetric')}</th>
                    <th>${SLAT('sla.metric.tableCurrent')}</th>
                    <th>${SLAT('sla.metric.tableDirection')}</th>
                    <th>${SLAT('sla.metric.percent')}</th>
                    ${monthHeaders}
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function renderTargetModalList() {
    const modalList = document.getElementById('target-modal-list');
    if (!modalList) return;
    const modal = document.getElementById('target-modal');
    if (modal) modal.classList.toggle('target-modal-table-mode', targetModalState.view === 'table');
    renderTargetViewToggle();
    if (!targetModalState.items.length) {
        renderTargetModalTitleStats();
        modalList.innerHTML = `<div style="text-align:center;padding:30px;color:#888;font-size:16px;">${SLAT('sla.metric.noConfig')}</div>`;
        return;
    }
    modalList.innerHTML = targetModalState.view === 'table' ? renderTargetTable() : renderTargetCards();
    bindTargetInputEmptyState();
    renderTargetModalTitleStats();
}

window.toggleTargetViewMode = function() {
    collectTargetDraftFromDom();
    targetModalState.view = targetModalState.view === 'table' ? 'cards' : 'table';
    renderTargetModalList();
};

window.openTargetModal = async function() {
    const modalList = document.getElementById('target-modal-list');
    let targetKeys = Object.keys(window.GlobalMetrics);
    let labelMap = {};
    let currentValues = {};
    let metricI18nMap = {};
    const translateMetricLabel = (label) => {
        const raw = String(label || '').trim();
        const lang = window.ToolsI18n ? window.ToolsI18n.getLanguage() : 'zh-CN';
        if (lang !== 'en-US') return raw;
        return metricI18nMap[raw] || raw;
    };
    
    // If no metrics are currently loaded (e.g. no file imported), fetch all known custom metrics and manual targets
    if (targetKeys.length === 0) {
        modalList.innerHTML = `<div style="text-align:center;padding:30px;color:#888;">${SLAT('sla.metric.loadingConfig')}</div>`;
        try {
            const mode = API.getSourceMode('sla_data');
            const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
            const configData = await API.get(`/api/sla/config${query}`);
            window.GlobalTargets = configData.targets || {};
            const prefs = configData.prefs || {};
            metricI18nMap = prefs.i18nMap || {};
            if (window.renderSLASourcePanel) window.renderSLASourcePanel();

            const knownLabels = collectSavedCustomMetricTargets(prefs, targetKeys, labelMap);
            
            // Also include anything already in GlobalTargets
            const existingTargetKeys = Object.keys(window.GlobalTargets);
            existingTargetKeys.forEach(k => {
                if (window.GlobalTargets[k].label) {
                    if (!targetKeys.includes(k)) targetKeys.push(k);
                    labelMap[k] = window.GlobalTargets[k].label;
                } else if (!labelMap[k]) {
                    // Try to guess the label from known custom metrics ids
                    let matchedLabel = '';
                    for (const cmId in knownLabels) {
                        if (k.endsWith(cmId)) {
                            matchedLabel = knownLabels[cmId];
                            break;
                        }
                    }
                    if (matchedLabel) {
                        if (!targetKeys.includes(k)) targetKeys.push(k);
                        labelMap[k] = matchedLabel;
                    }
                }
            });
        } catch (e) {
            console.error("Failed to load config", e);
            if (window.renderSLASourcePanel) window.renderSLASourcePanel();
        }
    } else {
        try {
            const mode = API.getSourceMode('sla_data');
            const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
            const configData = await API.get(`/api/sla/config${query}`);
            metricI18nMap = (configData && configData.prefs && configData.prefs.i18nMap) || {};
            window.GlobalTargets = configData.targets || window.GlobalTargets || {};
            collectSavedCustomMetricTargets((configData && configData.prefs) || {}, targetKeys, labelMap);
            if (window.renderSLASourcePanel) window.renderSLASourcePanel();
        } catch (e) {}
        targetKeys.forEach(k => {
            if (window.GlobalMetrics[k]) {
                labelMap[k] = window.GlobalMetrics[k].label;
                currentValues[k] = window.GlobalMetrics[k].value;
            }
        });
    }

    targetModalState.items = targetKeys.map(k => {
        const label = labelMap[k] || (window.GlobalTargets[k] && window.GlobalTargets[k].label) || k;
        return {
            key: k,
            label,
            displayLabel: translateMetricLabel(label),
            currentVal: currentValues[k] !== undefined ? currentValues[k] : '--'
        };
    });
    targetModalState.draft = buildTargetDraft(targetKeys, labelMap);
    renderTargetModalList();
    document.getElementById('target-modal').style.display = 'flex';
};

window.closeTargetModal = function() {
    const modal = document.getElementById('target-modal');
    modal.style.display = 'none';
    modal.classList.remove('target-modal-table-mode');
};

window.saveTargets = async function() {
    collectTargetDraftFromDom();

    const currentTargets = window.GlobalTargets || {};
    const changedTargets = [];
    targetModalState.items.forEach(item => {
        const k = item.key;
        const draft = targetModalState.draft[k] || {};
        const before = currentTargets[k] || {};
        const next = buildTargetFromDraft(before, draft);
        
        if (!next.label && item.label && item.label !== k) {
            next.label = item.label;
        }

        if (stableTargetStringify(before) !== stableTargetStringify(next)) {
            changedTargets.push({ key: k, target: next });
        }
    });

    if (!changedTargets.length) {
        showToast(SLAT('sla.metric.noChanges') || '没有目标变更');
        closeTargetModal();
        return;
    }

    try {
        const savedTargets = await Promise.all(changedTargets.map(item => {
            return API.patch(`/api/sla/targets/${encodeURIComponent(item.key)}`, {
                ...item.target,
                __replace: true
            }).then(res => ({ key: item.key, target: res && res.item ? res.item : item.target }));
        }));
        window.GlobalTargets = { ...currentTargets };
        savedTargets.forEach(item => {
            window.GlobalTargets[item.key] = item.target;
        });
        if (window.renderSLASourcePanel) {
            await SLASection.initGlobalTargets();
            window.renderSLASourcePanel();
        }
        showToast(SLAT('sla.metric.saved'));
        API.logHistory('sla', '保存预警目标', `patched:${changedTargets.length}`);
    } catch (e) { showToast(SLAT('sla.metric.saveFail'), 'error'); }
    closeTargetModal();
    renderTopStickyBar();
};

// ── 顶部栏滚动动画 ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const content = document.getElementById('sticky-bar-content');
    const btn = document.getElementById('btn-expand-metrics');
    const bar = document.getElementById('global-sticky-bar');
    let stickyHovered = false, stickyExpanded = false, currentScroll = 0, scrollDirection = 1;
    content.addEventListener('mouseenter', () => stickyHovered = true);
    content.addEventListener('mouseleave', () => stickyHovered = false);
    content.addEventListener('touchstart', () => stickyHovered = true);
    content.addEventListener('touchend', () => stickyHovered = false);
    btn.addEventListener('click', () => {
        stickyExpanded = !stickyExpanded;
        if (stickyExpanded) { bar.classList.add('expanded'); btn.innerHTML = SLAT('sla.sticky.collapse'); content.scrollLeft = 0; }
        else { bar.classList.remove('expanded'); btn.innerHTML = SLAT('sla.sticky.expand'); }
        syncStickyBarSubExpandedState();
    });
    (function step() {
        const hasSubExpanded = (window.expandedSubMetrics && window.expandedSubMetrics.size > 0) ||
            (bar && bar.classList.contains('sub-expanded'));
        if (!stickyHovered && !stickyExpanded && !hasSubExpanded && content.scrollWidth > content.clientWidth) {
            currentScroll += scrollDirection * 0.4;
            if (currentScroll <= 0) { currentScroll = 0; scrollDirection = 1; }
            else if (currentScroll >= content.scrollWidth - content.clientWidth) { currentScroll = content.scrollWidth - content.clientWidth; scrollDirection = -1; }
            content.scrollLeft = currentScroll;
        } else { currentScroll = content.scrollLeft; }
        requestAnimationFrame(step);
    })();
});

window.toggleMetricSub = toggleMetricSub;
window.syncStickyBarSubExpandedState = syncStickyBarSubExpandedState;
window.evaluateAllMetrics = evaluateAllMetrics;
window.SLAMetrics = { getMetricWarningState, evaluateAllMetrics, renderTopStickyBar, toggleMetricSub, syncStickyBarSubExpandedState };
window.SLATargetMonth = { get: getSLATargetMonth, set: setSLATargetMonth, init: initSLATargetMonthSelect };
