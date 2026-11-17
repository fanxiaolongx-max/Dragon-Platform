/**
 * sla/table.js - 表格视图渲染、排序、过滤、搜索、列拖拽、列宽调整
 */

function updateView(secId) {
    const state = AppState[secId];
    if (!state.globalData.length) return;
    let displayData = state.globalData;
    if (state.currentFilter === 'danger') displayData = displayData.filter(r => r._alertSeverity === 'danger' || r._rowClass === 'danger-row');
    else if (state.currentFilter === 'warning') displayData = displayData.filter(r => r._alertSeverity === 'warning' || r._rowClass === 'warning-row');
    else if (state.currentFilter === 'focus') displayData = displayData.filter(r => Boolean(r._alertSeverity) || r._rowClass === 'danger-row' || r._rowClass === 'warning-row');
    const sterm = document.getElementById(`search-${secId}`).value.trim().toLowerCase();
    if (sterm) displayData = displayData.filter(r => r._rawStringForSearch.includes(sterm) || (r._slaText && r._slaText.toLowerCase().includes(sterm)));
    if (state.sortKey) {
        displayData.sort((a, b) => {
            let vA = state.sortKey === '_SLA_' ? a._slaDays : a[state.sortKey];
            let vB = state.sortKey === '_SLA_' ? b._slaDays : b[state.sortKey];
            if (vA == null) vA = ''; if (vB == null) vB = '';
            const nA = parseFloat(vA), nB = parseFloat(vB);
            if (!isNaN(nA) && !isNaN(nB) && state.sortKey !== '_SLA_') return state.sortAsc ? nA - nB : nB - nA;
            if (state.sortKey === '_SLA_') return state.sortAsc ? vA - vB : vB - vA;
            vA = String(vA).toLowerCase(); vB = String(vB).toLowerCase();
            if (vA < vB) return state.sortAsc ? -1 : 1; if (vA > vB) return state.sortAsc ? 1 : -1; return 0;
        });
    }
    state.currentDisplayData = displayData;
    const rowBadge = document.getElementById(`row-count-badge-${secId}`);
    if (rowBadge) rowBadge.innerHTML = `(展示 ${displayData.length} 行 · <span style="color:#64748b;font-weight:normal;" title="双击表格中任意数据行，可竖排紧凑查看字段详情、自动隐藏空字段并一键复制">💡 双击行看详情</span>)`;
    updateDashboard(secId);
    if (state.tableRenderSuspended) {
        const container = document.getElementById(`table-container-${secId}`);
        if (container && !container.dataset.lazyPlaceholder) {
            container.dataset.lazyPlaceholder = '1';
            container.innerHTML = `<div class="sla-lazy-table-placeholder">已完成 ${displayData.length} 行数据预处理，点击上方表格标签后再加载明细表。</div>`;
        }
        return;
    }
    renderTable(secId);
}

const monthlyTargets = { 1:0, 2:0, 3:10, 4:20, 5:30, 6:50, 7:60, 8:70, 9:80, 10:90, 11:100, 12:100 };

function metricCellMatches(cellVal, pattern) {
    const str = (cellVal !== undefined && cellVal !== null) ? cellVal.toString().trim() : '';
    if (pattern === '[空]') return str === '';
    if (pattern === '[非空]') return str !== '';
    return str.includes(pattern || '');
}

function getMetricHighlightLabel(rule, parentRule) {
    if (typeof getMetricRuleDisplayLabel === 'function') return getMetricRuleDisplayLabel(rule, parentRule);
    return rule && (rule.label || rule.colZ) || '未命名指标';
}

function getMetricRulesUsingSection(secId) {
    const rules = [];
    const seen = new Set();
    const addRule = (rule, parentRule, kind, sourceKey) => {
        if (!rule) return;
        const dedupeKey = [
            rule.id || '',
            rule.sourceSecId || '',
            rule.colX || '',
            rule.valY || '',
            rule.colZ || '',
            rule.valK || '',
            ...(Array.isArray(rule.conditions) ? rule.conditions.flatMap(item => [item && item.column || '', item && item.value || '']) : []),
            rule.filterLogic || 'and',
            rule.aggregation || '',
            rule.type || ''
        ].join('|');
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        rules.push({ rule, parentRule, kind });
    };

    Object.keys(AppState || {}).forEach(parentSecId => {
        const parentState = AppState[parentSecId];
        (parentState.customMetrics || []).forEach(parentRule => {
            const isMainCross = parentRule.scope === 'all';
            const mainSource = parentRule.sourceSecId || parentSecId;
            if (mainSource === secId || isMainCross) {
                addRule(parentRule, null, isMainCross ? '跨表联合主指标' : '主指标', `current:${parentSecId}`);
            }
            (parentRule.subMetrics || []).forEach(subRule => {
                const isSubCross = subRule.scope === 'all' || (!subRule.scope && isMainCross);
                const subSource = subRule.sourceSecId || parentSecId;
                if (subSource === secId || isSubCross) {
                    addRule(subRule, parentRule, isSubCross ? '跨表联合子指标' : (parentSecId === secId ? '子指标' : '跨表子指标'), `current:${parentSecId}:${parentRule.id}`);
                }
            });
        });
    });

    const savedPrefs = typeof window.getCachedMetricRulePrefs === 'function' ? window.getCachedMetricRulePrefs() : {};
    Object.keys(savedPrefs || {}).forEach(prefKey => {
        const prefSecId = String(prefKey || '').replace(/^sla_prefs_/, '');
        const pref = savedPrefs[prefKey] || {};
        (pref.customMetrics || []).forEach(parentRule => {
            const isMainCross = parentRule.scope === 'all';
            const mainSource = parentRule.sourceSecId || prefSecId;
            if (mainSource === secId || isMainCross) {
                addRule(parentRule, null, isMainCross ? '已保存跨表联合主指标' : '已保存主指标', `saved:${prefKey}`);
            }
            (parentRule.subMetrics || []).forEach(subRule => {
                const isSubCross = subRule.scope === 'all' || (!subRule.scope && isMainCross);
                const subSource = subRule.sourceSecId || prefSecId;
                if (subSource === secId || isSubCross) {
                    addRule(subRule, parentRule, isSubCross ? '已保存跨表联合子指标' : (prefSecId === secId ? '已保存子指标' : '已保存跨表子指标'), `saved:${prefKey}:${parentRule.id}`);
                }
            });
        });
    });
    return rules;
}

function getHighlightColumnMeta(secId, targetPriorityCols) {
    const state = AppState[secId];
    const meta = new Map();
    const addColumn = (column, reason) => {
        if (!column || !state.orderedHeaders.includes(column)) return;
        if (!meta.has(column)) meta.set(column, new Set());
        meta.get(column).add(reason);
    };

    targetPriorityCols.forEach(col => addColumn(col, 'SLA/规则判断列'));
    getMetricRulesUsingSection(secId).forEach(({ rule, parentRule, kind }) => {
        const label = getMetricHighlightLabel(rule, parentRule);
        if (rule.colX) addColumn(rule.colX, `${kind}「${label}」条件列`);
        (Array.isArray(rule.conditions) ? rule.conditions : []).forEach(item => {
            if (item && item.column) addColumn(item.column, `${kind}「${label}」高级条件列`);
        });
        if (rule.colZ) addColumn(rule.colZ, `${kind}「${label}」取值/统计列`);
    });

    return meta;
}

function getBuiltInRuleColumns(mode, config) {
    if (config && mode === 'sr') return Array.from(new Set(Object.values(config.fields || {}).flat()));
    if (config && mode !== 'risk') return Array.from(new Set([
        ...(config.statusFields || []),
        ...(config.rules || []).flatMap(rule => rule.deadline?.fields || [])
    ]));
    if (mode === 'rectification') return ['task_status', 'task_create_time', 'rectify_plan_end_time'];
    if (mode === 'risk') return ['风险状态', 'risk_status', '创单时间', 'create_time_new', 'create_time', '期望关闭时间', 'ticket_close_due_date', 'due_time', '期望关闭时间-挂起', 'suspend_due_date'];
    if (mode === 'special') return ['状态-Status', 'task_status_en', 'task_status', 'task_status_cn', '创建日期-Create Date', 'create_time', '要求完成日期-Required Completion Date', 'required_completion_time', 'plan_complete_date'];
    if (mode === 'sr') return ['hw_sev_name', 'urgency', 'sr_status_name', 'open_date', 'exp_close_date', 'sus_exp_close_date', 'act_close_date', 'overdue'];
    if (mode === 'vulnerability') return ['task_status', 'create_time', 'task_create_time'];
    return [];
}

function buildMetricCellHighlightMeta(secId) {
    const state = AppState[secId];
    const cellMeta = new WeakMap();
    const addCell = (row, column, className, reason) => {
        if (!row || !column || !state.orderedHeaders.includes(column)) return;
        let rowMeta = cellMeta.get(row);
        if (!rowMeta) {
            rowMeta = {};
            cellMeta.set(row, rowMeta);
        }
        if (!rowMeta[column]) rowMeta[column] = { classes: new Set(), reasons: new Set() };
        rowMeta[column].classes.add(className);
        rowMeta[column].reasons.add(reason);
    };

    getMetricRulesUsingSection(secId).forEach(({ rule, parentRule, kind }) => {
        const label = getMetricHighlightLabel(rule, parentRule);
        const ruleName = `${kind}「${label}」`;
        const type = rule.type || 'extract';
        const rows = state.globalData || [];

        if (type === 'extract' || type === 'extract_multi') {
            const matchedRows = type === 'extract_multi'
                ? rows.filter(row => typeof metricRuleRowMatches === 'function'
                    ? metricRuleRowMatches(row, rule, true)
                    : (rule.colX && metricCellMatches(row[rule.colX], rule.valY)))
                : [rows.find(row => typeof metricRuleRowMatches === 'function'
                    ? metricRuleRowMatches(row, rule, true)
                    : (rule.colX && metricCellMatches(row[rule.colX], rule.valY)))].filter(Boolean);
            matchedRows.forEach(matchedRow => {
                if (metricCellMatches(matchedRow[rule.colX], rule.valY)) {
                    addCell(matchedRow, rule.colX, 'metric-condition-cell', `${ruleName} 条件命中：${rule.colX} 包含 ${rule.valY}`);
                }
                (Array.isArray(rule.conditions) ? rule.conditions : []).forEach(item => {
                    if (item && item.column && metricCellMatches(matchedRow[item.column], item.value)) addCell(matchedRow, item.column, 'metric-condition-cell', `${ruleName} 高级条件命中：${item.column} 包含 ${item.value}`);
                });
                addCell(matchedRow, rule.colZ, 'metric-value-cell', `${ruleName} ${type === 'extract_multi' ? '参与聚合的数值单元格' : '实际取值单元格'}`);
            });
            return;
        }

        rows.forEach(row => {
            const passX = typeof metricRuleRowMatches === 'function'
                ? metricRuleRowMatches(row, rule, true)
                : (rule.colX ? metricCellMatches(row[rule.colX], rule.valY) : true);
            if (rule.colX && passX) {
                addCell(row, rule.colX, 'metric-condition-cell', `${ruleName} 统计范围命中：${rule.colX} 包含 ${rule.valY || '(空条件)'}`);
            }
            if (passX) (Array.isArray(rule.conditions) ? rule.conditions : []).forEach(item => {
                if (item && item.column) addCell(row, item.column, 'metric-condition-cell', `${ruleName} 高级条件命中：${item.column} 包含 ${item.value}`);
            });
            if (passX && metricCellMatches(row[rule.colZ], rule.valK)) {
                addCell(row, rule.colZ, 'metric-value-cell', `${ruleName} ${type === 'ratio' ? '分子' : '计数'}命中：${rule.colZ} 包含 ${rule.valK}`);
            }
        });
    });

    return cellMeta;
}

function buildClassAttr(classNames) {
    const classes = classNames.filter(Boolean).join(' ');
    return classes ? `class="${classes}"` : '';
}

function updateDashboard(secId) {
    const state = AppState[secId];
    const panel = document.getElementById(`dashboard-${secId}`);
    if (state.mode === 'other') { panel.style.display = 'none'; return; }
    const data = state.currentDisplayData;
    if (!data.length) { panel.innerHTML = '<span style="color:#999">当前视图无数据</span>'; panel.style.display = 'flex'; return; }
    panel.style.display = 'flex';
    if (state.mode === 'rectification') {
        let sH1P=0, sH1U=0, sH2P=0, sH2U=0, sTP=0, sTU=0;
        const gv = (r, ks) => { for (const k of ks) if (r[k]) return parseFloat(r[k])||0; return 0; };
        data.forEach(r => {
            sH1P += gv(r,['2026H1到期总计划网元数','h1_plan_nes合计','h1_plan_nes']); sH1U += gv(r,['2026H1待清理网元数','h1_uncompleted_nes合计','h1_uncompleted_nes']);
            sH2P += gv(r,['2026H2到期总计划网元数','h2_plan_nes合计','h2_plan_nes']); sH2U += gv(r,['2026H2待清理网元数','h2_uncompleted_nes合计','h2_uncompleted_nes']);
            sTP += gv(r,['2026全年计划网元总数','total_plan_nes合计','total_plan_nes']); sTU += gv(r,['2026全年待清理网元总数','total_uncompleted_nes合计','total_uncompleted_nes']);
        });
        const rate = (p,u) => p===0?'-':((p-u)/p*100).toFixed(1)+'%';
        let thtml = '-';
        if (sTP > 0) {
            const r = (sTP-sTU)/sTP*100;
            const cm = window.SLATargetMonth && window.SLATargetMonth.get ? window.SLATargetMonth.get() : (new Date().getMonth()+1);
            const ct = monthlyTargets[cm]||0;
            thtml = `<div class="metric-value ${r>=ct?'success':'danger'}">${r.toFixed(1)}%</div>
                     <div style="font-size:12px;font-weight:bold;color:${r>=ct?'#00b050':'#d32f2f'}">${r>=ct?'✅ 达标':'⚠️ 落后'}</div>
                     <div style="font-size:11px;background:#f1f3f5;padding:2px 6px;border-radius:10px;margin-top:4px;">🎯 ${cm}月目标: ${ct}%</div>`;
        }
        panel.innerHTML = `
            <div class="metric-card"><div class="metric-title">H1完成率</div><div class="metric-value">${rate(sH1P,sH1U)}</div></div>
            <div class="metric-card"><div class="metric-title">H2完成率</div><div class="metric-value">${rate(sH2P,sH2U)}</div></div>
            <div class="metric-total-wrapper"><div class="metric-title">🌟 2026总完成率</div>${thtml}</div>`;
    } else if (state.mode === 'sr') {
        const total = data.length;
        const active = data.filter(r => r._srDisposition ? r._srDisposition === 'active' : (!isSRClosedStatus(r.sr_status_name) && !isSRPendingStatus(r.sr_status_name))).length;
        const pendingIgnored = data.filter(r => r._srDisposition ? r._srDisposition === 'pending' : isSRPendingStatus(r.sr_status_name)).length;
        const overdue = data.filter(r => r._slaCleanText && r._slaCleanText.includes('超期')).length;
        const danger = data.filter(r => r._rowClass === 'danger-row').length;
        const warning = data.filter(r => r._rowClass === 'warning-row').length;
        panel.innerHTML = `
            <div class="metric-card"><div class="metric-title">SR总量</div><div class="metric-value" style="color:#333">${total}</div></div>
            <div class="metric-card"><div class="metric-title">在途监控</div><div class="metric-value" style="color:#1976d2">${active}</div></div>
            <div class="metric-card"><div class="metric-title">挂起忽略</div><div class="metric-value" style="color:#9c27b0">${pendingIgnored}</div></div>
            <div class="metric-total-wrapper">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span class="metric-title">🌟 SLA预警态势</span><span class="metric-value ${danger > 0 ? 'danger' : (warning > 0 ? 'warn' : 'success')}">${overdue} 超期 / ${danger} 红 / ${warning} 黄</span></div>
                <div class="status-badge-container">
                    <span style="background:#f1f3f5;padding:2px 8px;border-radius:12px;font-size:11px;border:1px solid #e0e0e0;">历史或当前超期: <b style="color:#d32f2f">${overdue}</b></span>
                    <span style="background:#f1f3f5;padding:2px 8px;border-radius:12px;font-size:11px;border:1px solid #e0e0e0;">红色高危: <b style="color:#d32f2f">${danger}</b></span>
                    <span style="background:#f1f3f5;padding:2px 8px;border-radius:12px;font-size:11px;border:1px solid #e0e0e0;">黄色预警: <b style="color:#f57c00">${warning}</b></span>
                </div>
            </div>`;
    } else if (state.mode === 'vulnerability') {
        const total = data.length;
        const activeStatuses = ['Checking', 'Communication Dept', 'Communication Customer'];
        const active = data.filter(r => state.sectionRuleConfig ? r._slaRuleMatched === true : activeStatuses.includes(getCompatibleVal(r, ['task_status']))).length;
        const danger = data.filter(r => r._rowClass === 'danger-row').length;
        const warning = data.filter(r => r._rowClass === 'warning-row').length;
        const counts = {};
        data.forEach(r => {
            const st = getCompatibleVal(r, ['task_status']) || '未知状态';
            counts[st] = (counts[st] || 0) + 1;
        });
        const bdgs = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([s,c])=>`<span style="background:#fff7ed;padding:2px 8px;border-radius:12px;font-size:11px;border:1px solid #fed7aa;">${s}: <b style="color:#c2410c">${c}</b></span>`).join('');
        panel.innerHTML = `
            <div class="metric-card"><div class="metric-title">漏洞单量</div><div class="metric-value" style="color:#333">${total}</div></div>
            <div class="metric-card"><div class="metric-title">30天内需完成</div><div class="metric-value" style="color:#c2410c">${active}</div></div>
            <div class="metric-total-wrapper">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span class="metric-title">🌟 漏洞预警态势</span><span class="metric-value ${danger > 0 ? 'danger' : (warning > 0 ? 'warn' : 'success')}">${danger} 红 / ${warning} 黄</span></div>
                <div class="status-badge-container">${bdgs}</div>
            </div>`;
    } else {
        const keys = state.mode === 'risk' ? ['风险状态','risk_status'] : ['状态-Status','task_status_en','task_status','task_status_cn'];
        let t = data.length, clsd = 0, counts = {};
        const closedKw = ['close','关闭','闭环','完成','已解决'];
        data.forEach(r => {
            let st = getCompatibleVal(r, keys) || '未知状态'; counts[st] = (counts[st]||0)+1;
            if (closedKw.some(kw => st.toLowerCase().includes(kw))) clsd++;
        });
        const rt = t===0?0:(clsd/t*100);
        const bdgs = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([s,c])=>`<span style="background:#f1f3f5;padding:2px 8px;border-radius:12px;font-size:11px;border:1px solid #e0e0e0;">${s}: <b style="color:#1976d2">${c}</b></span>`).join('');
        panel.innerHTML = `
            <div class="metric-card"><div class="metric-title">单量</div><div class="metric-value" style="color:#333">${t}</div></div>
            <div class="metric-card"><div class="metric-title">已闭环</div><div class="metric-value" style="color:#00b050">${clsd}</div></div>
            <div class="metric-total-wrapper">
                <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span class="metric-title">🌟 解决率</span><span class="metric-value ${rt>=100?'success':(rt<80?'danger':'')}">${t===0?'-':rt.toFixed(1)+'%'}</span></div>
                <div class="status-badge-container">${bdgs}</div>
            </div>`;
    }
}

const SLA_TABLE_FIRST_ROWS = 200;
const SLA_TABLE_MORE_ROWS = 300;

function attachProgressiveRows(secId, data, rendered, rowHtml) {
    const state = AppState[secId];
    const sentinel = document.querySelector(`#table-${CSS.escape(secId)} tr.sla-more-rows`);
    if (!sentinel) return;
    const cell = sentinel.firstElementChild;
    const paint = () => {
        cell.innerHTML = `<span>已显示 ${rendered} / ${data.length} 行，继续向下滚动自动加载</span> <button type="button" class="sla-show-all-rows">显示全部</button>`;
        cell.querySelector('button').onclick = () => append(data.length - rendered);
    };
    function append(count) {
        if (state.currentDisplayData !== data) return; // 已重新排序/筛选，旧的续加作废
        const end = Math.min(data.length, rendered + count);
        let html = '';
        for (let rowIndex = rendered; rowIndex < end; rowIndex++) html += rowHtml(data[rowIndex], rowIndex);
        sentinel.insertAdjacentHTML('beforebegin', html);
        rendered = end;
        if (rendered >= data.length) { sentinel.remove(); if (state.moreRowsObserver) state.moreRowsObserver.disconnect(); state.moreRowsObserver = null; }
        else paint();
    }
    paint();
    if (typeof IntersectionObserver === 'function') {
        state.moreRowsObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) append(SLA_TABLE_MORE_ROWS);
        }, { rootMargin: '600px 0px' });
        state.moreRowsObserver.observe(sentinel);
    }
}

function renderTable(secId) {
    const state = AppState[secId];
    const data = state.currentDisplayData;
    const container = document.getElementById(`table-container-${secId}`);
    if (!data.length) { container.innerHTML = '<p style="padding:20px;text-align:center;">没有找到数据 🤷‍♂️</p>'; return; }
    const RECT_P = SLAUpload.RECT_PRIORITY_COLS, RISK_P = SLAUpload.RISK_PRIORITY_COLS, SPEC_P = SLAUpload.SPECIAL_PRIORITY_COLS, SR_P = SLAUpload.SR_PRIORITY_COLS, VULN_P = SLAUpload.VULN_PRIORITY_COLS;
    const getIcon = k => state.sortKey !== k ? '<span class="sort-icon">⇅</span>' : (state.sortAsc ? '<span class="sort-icon sort-active">▲</span>' : '<span class="sort-icon sort-active">▼</span>');
    const targetP = state.mode==='rectification'?RECT_P:(state.mode==='risk'?RISK_P:(state.mode==='special'?SPEC_P:(state.mode==='sr'?SR_P:(state.mode==='vulnerability'?VULN_P:[]))));
    const highlightColumnMeta = getHighlightColumnMeta(secId, getBuiltInRuleColumns(state.mode, state.sectionRuleConfig));
    const metricCellMeta = buildMetricCellHighlightMeta(secId);
    const tableType = state.mode || secId;
    const frequentCols = window.SLARowDetail ? window.SLARowDetail.getCachedFrequentFields(tableType) : [];
    let html = `<table id="table-${secId}"><thead><tr>`;
    if (state.mode !== 'other') {
        const sw = state.columnWidths['_SLA_'] ? `style="width:${state.columnWidths['_SLA_']}px;min-width:${state.columnWidths['_SLA_']}px;max-width:${state.columnWidths['_SLA_']}px;"` : '';
        html += `<th data-header="_SLA_" ${sw} onclick="handleSortClick('${secId}', '_SLA_')">预警与 SLA 状态 ${getIcon('_SLA_')}</th>`;
    }
    const pClass = state.mode==='rectification'?'priority-col-rect':(state.mode==='risk'?'priority-col-risk':(state.mode==='special'?'priority-col-special':(state.mode==='sr'?'priority-col-risk':(state.mode==='vulnerability'?'priority-col-risk':''))));
    state.visibleHeaders.forEach(header => {
        const safe = escapeHTML(header);
        const thClasses = [];
        if (targetP.includes(header)) thClasses.push(pClass);
        if (highlightColumnMeta.has(header)) thClasses.push('metric-involved-col');
        const isFrequent = frequentCols.includes(header);
        if (isFrequent) thClasses.push('frequent-copied-col');
        const classAttr = buildClassAttr(thClasses);
        const titleParts = [];
        if (highlightColumnMeta.has(header)) titleParts.push(Array.from(highlightColumnMeta.get(header)).join('；'));
        if (isFrequent) titleParts.push('⭐ 常用复制列（双击数据行弹窗已优先置顶）');
        const titleAttr = titleParts.length ? `title="${escapeHTML(titleParts.join('\n'))}"` : '';
        const wStyle = state.columnWidths[header] ? `style="width:${state.columnWidths[header]}px;min-width:${state.columnWidths[header]}px;max-width:${state.columnWidths[header]}px;"` : '';
        const headerDisplay = isFrequent ? `<span class="th-frequent-star" title="常用复制列">⭐</span>${safe}` : safe;
        html += `<th draggable="true" data-header="${safe.replace(/"/g,'&quot;')}" ${wStyle} ${classAttr} ${titleAttr} onclick="handleSortClick('${secId}', '${safe.replace(/'/g,"\\'")}')">${headerDisplay} ${getIcon(header)}</th>`;
    });
    html += '</tr></thead><tbody>';
    const rowHtml = (row, rowIndex) => {
        let html = `<tr class="${row._rowClass || ''} sla-data-row" data-sec="${secId}" data-row-idx="${rowIndex}" ondblclick="window.SLARowDetail && window.SLARowDetail.open('${secId}', ${rowIndex})" title="💡 双击可竖排紧凑查看字段详情并一键复制">`;
        if (state.mode !== 'other') {
            const slaW = state.columnWidths['_SLA_'] ? `style="width:${state.columnWidths['_SLA_']}px;min-width:${state.columnWidths['_SLA_']}px;max-width:${state.columnWidths['_SLA_']}px;"` : '';
            html += `<td ${slaW}>${row._slaText}</td>`;
        }
        state.visibleHeaders.forEach(header => {
            const cellValue = row[header] !== undefined ? row[header] : '';
            const safe = escapeHTML(cellValue.toString().replace(/[\r\n]+/g, ' '));
            const rowCellMeta = metricCellMeta.get(row);
            const cellHighlight = rowCellMeta && rowCellMeta[header];
            const tdClasses = [];
            if (highlightColumnMeta.has(header)) tdClasses.push('metric-involved-col-cell');
            if (cellHighlight) tdClasses.push(...Array.from(cellHighlight.classes));
            if (frequentCols.includes(header)) tdClasses.push('frequent-copied-cell');
            const classAttr = buildClassAttr(tdClasses);
            const titleParts = [safe];
            if (cellHighlight) titleParts.push(Array.from(cellHighlight.reasons).join('；'));
            else if (highlightColumnMeta.has(header)) titleParts.push(Array.from(highlightColumnMeta.get(header)).join('；'));
            const title = escapeHTML(titleParts.filter(Boolean).join('\n'));
            const wStyle = state.columnWidths[header] ? `style="width:${state.columnWidths[header]}px;min-width:${state.columnWidths[header]}px;max-width:${state.columnWidths[header]}px;"` : '';
            html += `<td title="${title}" ${classAttr} ${wStyle}>${safe}</td>`;
        });
        html += '</tr>';
        return html;
    };
    // 渐进式渲染：大表一次性生成几万个单元格会让页面每一帧的重绘都很重（数据越多越卡），
    // 先渲染一屏多一点，滚到底部再续上；排序、筛选、搜索仍基于内存中的全部数据。
    const firstChunk = Math.min(data.length, SLA_TABLE_FIRST_ROWS);
    for (let rowIndex = 0; rowIndex < firstChunk; rowIndex++) html += rowHtml(data[rowIndex], rowIndex);
    const columnCount = state.visibleHeaders.length + (state.mode !== 'other' ? 1 : 0);
    if (firstChunk < data.length) html += `<tr class="sla-more-rows" data-sec="${secId}"><td colspan="${columnCount}"></td></tr>`;
    html += '</tbody></table>';
    if (state.moreRowsObserver) { state.moreRowsObserver.disconnect(); state.moreRowsObserver = null; }
    container.innerHTML = html;
    attachResizers(secId);
    attachDragAndDrop(secId);
    attachProgressiveRows(secId, data, firstChunk, rowHtml);
    const tableEl = document.getElementById(`table-${secId}`);
    if (tableEl && !tableEl._dblclickBound) {
        tableEl._dblclickBound = true;
        tableEl.addEventListener('dblclick', function(e) {
            const tr = e.target.closest('tr.sla-data-row');
            if (tr && tr.dataset.rowIdx !== undefined) {
                const idx = parseInt(tr.dataset.rowIdx, 10);
                if (!isNaN(idx) && window.SLARowDetail) {
                    window.SLARowDetail.open(secId, idx);
                }
            }
        });
    }
}

window.handleSortClick = function(secId, key) {
    const state = AppState[secId];
    if (state.isDraggingColumn || window._globalResizing) return;
    if (state.sortKey === key) state.sortAsc = !state.sortAsc; else { state.sortKey = key; state.sortAsc = true; }
    SLAPrefs.savePrefs(secId); updateView(secId);
};

window.refreshSLAHighlightViews = function(secIds) {
    const ids = Array.isArray(secIds) ? secIds : [secIds];
    Array.from(new Set(ids.filter(Boolean))).forEach(secId => {
        if (AppState[secId] && AppState[secId].globalData && AppState[secId].globalData.length) {
            updateView(secId);
        }
    });
};

function attachDragAndDrop(secId) {
    const table = document.getElementById(`table-${secId}`);
    const state = AppState[secId];
    table.querySelectorAll('th[draggable="true"]').forEach(th => {
        th.addEventListener('dragstart', function(e) {
            if (window._globalResizing) { e.preventDefault(); return; }
            state.isDraggingColumn = true; state.draggedHeaderName = this.getAttribute('data-header'); this.style.opacity = '0.4';
        });
        th.addEventListener('dragenter', function(e) {
            e.preventDefault();
            if (this.getAttribute('data-header') !== state.draggedHeaderName && this.getAttribute('data-header') !== '_SLA_') this.classList.add('drag-over');
        });
        th.addEventListener('dragleave', function() { this.classList.remove('drag-over'); });
        th.addEventListener('dragover', e => e.preventDefault());
        th.addEventListener('drop', function(e) {
            e.preventDefault(); this.classList.remove('drag-over');
            const targetName = this.getAttribute('data-header');
            if (state.draggedHeaderName && targetName && state.draggedHeaderName !== targetName && targetName !== '_SLA_') {
                const fi = state.visibleHeaders.indexOf(state.draggedHeaderName);
                const ti = state.visibleHeaders.indexOf(targetName);
                if (fi > -1 && ti > -1) {
                    state.visibleHeaders.splice(fi, 1); state.visibleHeaders.splice(ti, 0, state.draggedHeaderName);
                    SLAPrefs.savePrefs(secId); updateView(secId);
                }
            }
        });
        th.addEventListener('dragend', function() {
            this.style.opacity = '1'; table.querySelectorAll('th').forEach(t => t.classList.remove('drag-over'));
            setTimeout(() => state.isDraggingColumn = false, 50);
        });
    });
}

function attachResizers(secId) {
    const table = document.getElementById(`table-${secId}`);
    const state = AppState[secId];
    table.querySelectorAll('th').forEach(th => {
        const resizer = document.createElement('div'); resizer.classList.add('resizer'); th.appendChild(resizer);
        let startX, startWidth;
        resizer.addEventListener('click', e => e.stopPropagation());
        resizer.addEventListener('mousedown', function(e) {
            e.stopPropagation(); e.preventDefault();
            window._globalResizing = true; startX = e.pageX; startWidth = th.offsetWidth; resizer.classList.add('resizing');
            const onMove = e => {
                const nw = startWidth + (e.pageX - startX);
                if (nw > 40) {
                    th.style.cssText += `;width:${nw}px;min-width:${nw}px;max-width:${nw}px;`;
                    const colIdx = Array.from(th.parentNode.children).indexOf(th);
                    table.querySelectorAll('tbody tr').forEach(r => {
                        const td = r.children[colIdx];
                        if (td) td.style.cssText += `;width:${nw}px;min-width:${nw}px;max-width:${nw}px;`;
                    });
                }
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
                resizer.classList.remove('resizing');
                const headerName = th.getAttribute('data-header');
                if (headerName) { state.columnWidths[headerName] = parseInt(th.style.width); SLAPrefs.savePrefs(secId); }
                setTimeout(() => window._globalResizing = false, 50);
            };
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
        });
    });
}

window.updateView = updateView;
window.SLATable = { updateView, renderTable };
