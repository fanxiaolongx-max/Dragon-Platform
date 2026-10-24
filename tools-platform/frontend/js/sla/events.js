/**
 * sla/events.js - 工具条事件绑定：列设置、去重提取、指标配置
 */

function bindEvents(secId) {
    const wrapper = document.getElementById(`section-${secId}`);
    const state = AppState[secId];

    wrapper.querySelector(`#search-${secId}`).addEventListener('input', () => updateView(secId));
    wrapper.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            wrapper.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active'); state.currentFilter = this.dataset.filter; updateView(secId);
        });
    });

    const elevateZ = (targetPicker) => {
        document.querySelectorAll('.section-card').forEach(c => c.style.zIndex = '1');
        wrapper.style.zIndex = '100';
        wrapper.querySelectorAll('.dropdown-menu').forEach(m => { if (m !== targetPicker) m.classList.remove('show'); });
        targetPicker.classList.toggle('show');
    };

    // 列设置
    const sBtn = wrapper.querySelector(`#settings-btn-${secId}`);
    const cPicker = wrapper.querySelector(`#column-picker-${secId}`);
    sBtn.addEventListener('click', e => { e.stopPropagation(); elevateZ(cPicker); if (cPicker.classList.contains('show')) renderColPicker(secId); });
    wrapper.querySelector(`#p-search-${secId}`).addEventListener('input', function() {
        const term = this.value.trim().toLowerCase();
        cPicker.querySelectorAll('.column-item').forEach(item => { item.style.display = item.dataset.colName.includes(term) ? 'flex' : 'none'; });
    });
    wrapper.querySelector(`#p-all-${secId}`).addEventListener('click', () => {
        cPicker.querySelectorAll('.column-item').forEach(item => {
            if (item.style.display !== 'none') { const cb = item.querySelector('input[type="checkbox"]'); if (!cb.checked) { cb.checked = true; if (!state.visibleHeaders.includes(cb.value)) state.visibleHeaders.push(cb.value); } }
        });
        state.visibleHeaders = state.orderedHeaders.filter(c => state.visibleHeaders.includes(c)); SLAPrefs.savePrefs(secId); updateView(secId);
    });
    wrapper.querySelector(`#p-none-${secId}`).addEventListener('click', () => {
        cPicker.querySelectorAll('.column-item').forEach(item => {
            if (item.style.display !== 'none') { const cb = item.querySelector('input[type="checkbox"]'); if (cb.checked) { cb.checked = false; state.visibleHeaders = state.visibleHeaders.filter(c => c !== cb.value); } }
        });
        SLAPrefs.savePrefs(secId); updateView(secId);
    });

    // 去重提取
    const cpBtn = wrapper.querySelector(`#copy-btn-${secId}`);
    const cpPicker = wrapper.querySelector(`#copy-picker-${secId}`);
    cpBtn.addEventListener('click', e => { e.stopPropagation(); elevateZ(cpPicker); if (cpPicker.classList.contains('show')) renderCopyMenu(secId); });
    wrapper.querySelector(`#c-search-${secId}`).addEventListener('input', function() {
        const term = this.value.trim().toLowerCase();
        cpPicker.querySelectorAll('.copy-list-item').forEach(item => { item.style.display = item.dataset.colName.includes(term) ? 'flex' : 'none'; });
        cpPicker.querySelectorAll('.copy-list-sep').forEach(sep => { sep.style.display = term ? 'none' : 'block'; });
    });

    // 指标
    const mBtn = wrapper.querySelector(`#metrics-btn-${secId}`);
    const mPicker = wrapper.querySelector(`#metrics-picker-${secId}`);
    mBtn.addEventListener('click', e => {
        e.stopPropagation(); elevateZ(mPicker);
        if (mPicker.classList.contains('show')) {
            populateMetricSelects(secId);
            resetMetricForm(secId);
            renderMetricList(secId);
        }
    });
    wrapper.querySelector(`#add-metric-btn-${secId}`).addEventListener('click', () => addMetricRule(secId));

    wrapper.querySelector(`#export-btn-${secId}`).addEventListener('click', () => exportData(secId));
    updateMetricRuleSummary(secId);
}

function renderColPicker(secId) {
    const state = AppState[secId];
    const list = document.getElementById(`p-list-${secId}`);
    list.innerHTML = '';
    state.orderedHeaders.forEach(col => {
        const label = document.createElement('label'); label.className = 'column-item'; label.dataset.colName = col.toLowerCase();
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.visibleHeaders.includes(col); cb.value = col;
        cb.addEventListener('change', e => {
            if (e.target.checked) { if (!state.visibleHeaders.includes(col)) state.visibleHeaders.push(col); }
            else { state.visibleHeaders = state.visibleHeaders.filter(c => c !== col); }
            state.visibleHeaders = state.orderedHeaders.filter(c => state.visibleHeaders.includes(c));
            SLAPrefs.savePrefs(secId); updateView(secId);
        });
        const span = document.createElement('span'); span.textContent = col; span.title = col;
        label.appendChild(cb); label.appendChild(span); list.appendChild(label);
    });
}

function renderCopyMenu(secId) {
    const state = AppState[secId];
    const list = document.getElementById(`c-list-${secId}`);
    list.innerHTML = '';
    const regex = /owner|handler|责任|处理|负责|分配|派发|人|名/i;
    const candidateCols = state.orderedHeaders.filter(h => regex.test(h));
    const otherCols = state.orderedHeaders.filter(h => !regex.test(h));
    candidateCols.forEach(col => {
        const item = document.createElement('div');
        item.className = 'column-item copy-list-item'; item.style.cssText = 'padding:8px 15px;cursor:pointer;'; item.dataset.colName = col.toLowerCase();
        item.innerHTML = `<span style="color:#e65100;font-weight:bold;">⭐ ${escapeHTML(col)}</span>`;
        item.addEventListener('click', () => { executeCopy(secId, col); document.getElementById(`copy-picker-${secId}`).classList.remove('show'); });
        list.appendChild(item);
    });
    if (candidateCols.length > 0 && otherCols.length > 0) {
        const sep = document.createElement('div'); sep.className = 'copy-list-sep'; sep.style.cssText = 'height:1px;background:#ffe0b2;margin:4px 0;'; list.appendChild(sep);
    }
    otherCols.forEach(col => {
        const item = document.createElement('div');
        item.className = 'column-item copy-list-item'; item.style.cssText = 'padding:8px 15px;cursor:pointer;'; item.dataset.colName = col.toLowerCase();
        item.innerHTML = `<span style="color:#666;">📄 ${escapeHTML(col)}</span>`;
        item.addEventListener('click', () => { executeCopy(secId, col); document.getElementById(`copy-picker-${secId}`).classList.remove('show'); });
        list.appendChild(item);
    });
    const si = document.getElementById(`c-search-${secId}`); if (si) si.value = '';
}

function executeCopy(secId, colName) {
    const data = AppState[secId].currentDisplayData;
    if (!data || !data.length) { showToast(SLAT('sla.copy.noData'), 'warning'); return; }
    const arr = data.map(r => r[colName]).filter(v => v !== undefined && v !== null && v.toString().trim() !== '');
    const unique = [...new Set(arr)];
    if (!unique.length) { showToast(SLAT('sla.copy.noValid'), 'warning'); return; }
    const text = unique.join(', ');
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => AppDialog.alert(SLAT('sla.copy.successCount', { count: unique.length, text }), { title: SLAT('sla.dialog.done'), tone: 'success' })).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
}
function fallbackCopy(text) {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); AppDialog.alert(SLAT('sla.copy.success', { text }), { title: SLAT('sla.dialog.done'), tone: 'success' }); } catch (e) { showToast(SLAT('sla.copy.fail'), 'error'); }
    document.body.removeChild(t);
}

function exportData(secId) {
    const state = AppState[secId];
    if (!state.currentDisplayData.length) return;
    const arr = state.currentDisplayData.map(row => {
        const n = {};
        if (state.mode !== 'other') n['预警状态'] = row._slaCleanText;
        state.visibleHeaders.forEach(h => n[h] = row[h] !== undefined ? row[h] : '');
        return n;
    });
    const ws = XLSX.utils.json_to_sheet(arr); const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, `Export_${state.mode}_${new Date().getTime()}.xlsx`);
    API.logHistory('sla', '导出数据', `${state.title} ${arr.length}行`);
}

// ── 指标配置 ──────────────────────────────────────────────

// Keep existing call sites on the shared monthly/import extraction engine.
function getMetricRuleConditions(rule) { return window.MetricExtraction.conditions(rule); }
function metricRuleCellMatches(value, pattern) { return window.MetricExtraction.cellMatches(value, pattern); }
function metricRuleRowMatches(row, rule, includePrimary = true) { return window.MetricExtraction.rowMatches(row, rule, includePrimary); }
function parseMetricNumericValue(value) { return window.MetricExtraction.parseNumber(value); }
function aggregateMetricRowValues(rows, rule) { return window.MetricExtraction.aggregate(rows, rule); }

function buildMetricConditionFieldOptions(fields, selected = '') {
    return `<option value="">请选择条件列</option>` + (fields || []).map(field =>
        `<option value="${escapeHTML(field)}" ${field === selected ? 'selected' : ''}>${escapeHTML(field)}</option>`
    ).join('');
}

function renderMetricConditionRows(container, fields, conditions, mode) {
    if (!container) return;
    const changeHandler = mode === 'editor' ? 'renderMetricRuleEditorPreview()' : '';
    container.innerHTML = (conditions || []).map((condition, index) => `
        <div class="metric-condition-row" data-condition-index="${index}">
            <select data-field="column" ${changeHandler ? `onchange="${changeHandler}"` : ''}>${buildMetricConditionFieldOptions(fields, condition.column || '')}</select>
            <input data-field="value" value="${escapeHTML(condition.value || '')}" placeholder="包含内容（支持 [空]/[非空]）" ${changeHandler ? `oninput="${changeHandler}"` : ''}>
            <button type="button" title="删除此条件" onclick="${mode === 'editor' ? `removeMetricRuleEditorCondition(${index})` : (mode === 'copy-editor' ? `removeMetricRuleCopyCondition(${index})` : `removeMetricConditionRow('${mode}', ${index})`)}">×</button>
        </div>
    `).join('');
}

function readMetricConditionRows(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('.metric-condition-row')).map(row => ({
        column: row.querySelector('[data-field="column"]')?.value || '',
        value: row.querySelector('[data-field="value"]')?.value.trim() || ''
    })).filter(item => item.column && item.value);
}

function readMetricConditionDraftRows(container) {
    if (!container) return [];
    return Array.from(container.querySelectorAll('.metric-condition-row')).map(row => ({
        column: row.querySelector('[data-field="column"]')?.value || '',
        value: row.querySelector('[data-field="value"]')?.value || ''
    }));
}

window.toggleMetricAdvancedConditions = function(secId) {
    const panel = document.getElementById(`m-conditions-panel-${secId}`);
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

window.addMetricConditionRow = function(secId) {
    const container = document.getElementById(`m-conditions-${secId}`);
    const conditions = readMetricConditionDraftRows(container);
    conditions.push({ column: '', value: '' });
    renderMetricConditionRows(container, AppState[secId]?.orderedHeaders || [], conditions, secId);
    const panel = document.getElementById(`m-conditions-panel-${secId}`);
    if (panel) panel.style.display = 'block';
    const count = document.getElementById(`m-conditions-count-${secId}`);
    if (count) count.textContent = String(conditions.length);
};

window.removeMetricConditionRow = function(secId, index) {
    const container = document.getElementById(`m-conditions-${secId}`);
    const conditions = readMetricConditionDraftRows(container);
    conditions.splice(index, 1);
    renderMetricConditionRows(container, AppState[secId]?.orderedHeaders || [], conditions, secId);
    const count = document.getElementById(`m-conditions-count-${secId}`);
    if (count) count.textContent = String(conditions.length);
};

window.setMetricCreateType = function(secId, type) {
    const isExtract = type === 'extract' || type === 'extract_multi';
    const isMulti = type === 'extract_multi';
    const extractConfig = document.getElementById(`m-extract-config-${secId}`);
    const countConfig = document.getElementById(`m-count-config-${secId}`);
    const multiConfig = document.getElementById(`m-multi-config-${secId}`);
    const logicWrap = document.getElementById(`m-condition-logic-wrap-${secId}`);
    const logic = document.getElementById(`m-condition-logic-${secId}`);
    const help = document.getElementById(`m-conditions-help-${secId}`);
    if (extractConfig) extractConfig.style.display = isExtract ? 'block' : 'none';
    if (countConfig) countConfig.style.display = isExtract ? 'none' : 'block';
    if (multiConfig) multiConfig.style.display = isMulti ? 'block' : 'none';
    if (logicWrap) logicWrap.style.display = isMulti ? 'flex' : 'none';
    if (!isMulti && logic) logic.value = 'and';
    if (help) help.textContent = isMulti
        ? SLAT('sla.section.multiConditionsHelp')
        : SLAT('sla.section.andConditionsHelp');
};

function populateMetricSelects(secId) {
    const state = AppState[secId];
    let htmlX = `<option value="">${SLAT('sla.section.colXOption')}</option>`;
    let htmlZ = `<option value="">${SLAT('sla.section.colZOption')}</option>`;
    let htmlCX = `<option value="">${SLAT('sla.section.countXOption')}</option>`;
    let htmlCZ = `<option value="">${SLAT('sla.section.countZOption')}</option>`;

    state.orderedHeaders.forEach(h => {
        const hSafe = escapeHTML(h);
        htmlX += `<option value="${hSafe}">${hSafe}</option>`;
        htmlZ += `<option value="${hSafe}">${hSafe}</option>`;
        htmlCX += `<option value="${hSafe}">${hSafe}</option>`;
        htmlCZ += `<option value="${hSafe}">${hSafe}</option>`;
    });

    document.getElementById(`m-colx-${secId}`).innerHTML = htmlX;
    document.getElementById(`m-colz-${secId}`).innerHTML = htmlZ;
    const ccolx = document.getElementById(`m-c-colx-${secId}`); if (ccolx) ccolx.innerHTML = htmlCX;
    const ccolz = document.getElementById(`m-c-colz-${secId}`); if (ccolz) ccolz.innerHTML = htmlCZ;

    // Populate Parents
    let parentHtml = `<option value="">${SLAT('sla.section.mainMetric')}</option>`;
    Object.keys(AppState).forEach(sId => {
        const s = AppState[sId];
        if (s.customMetrics) {
            s.customMetrics.forEach(r => {
                const titleStr = s.title || sId;
                const parentLabel = getMetricRuleDisplayLabel(r);
                const subMetricText = SLAT('sla.section.subMetricOf', { parent: escapeHTML(parentLabel), table: escapeHTML(titleStr) });
                parentHtml += `<option value="${sId}|${r.id}">${subMetricText}</option>`;
            });
        }
    });
    const parentSel = document.getElementById(`m-parent-${secId}`);
    if (parentSel) {
        parentSel.innerHTML = parentHtml;
    }

    // Populate Categories
    const cats = window.GlobalCategories || ['TE', 'ORG', 'ET', 'VDF'];
    let catHtml = `<option value="">${SLAT('sla.section.chooseCategory')}</option>`;
    cats.forEach(c => { catHtml += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`; });
    const catSel = document.getElementById(`m-cat-${secId}`);
    if (catSel) catSel.innerHTML = catHtml;
    const conditions = readMetricConditionRows(document.getElementById(`m-conditions-${secId}`));
    renderMetricConditionRows(document.getElementById(`m-conditions-${secId}`), state.orderedHeaders, conditions, secId);
}

function resetMetricForm(secId) {
    const setValue = (id, value = '') => {
        const el = document.getElementById(`${id}-${secId}`);
        if (el) el.value = value;
    };

    const extractType = document.querySelector(`input[name="m-type-${secId}"][value="extract"]`);
    if (extractType) extractType.checked = true;

    const extractConfig = document.getElementById(`m-extract-config-${secId}`);
    const countConfig = document.getElementById(`m-count-config-${secId}`);
    if (extractConfig) extractConfig.style.display = 'block';
    if (countConfig) countConfig.style.display = 'none';
    const multiConfig = document.getElementById(`m-multi-config-${secId}`);
    if (multiConfig) multiConfig.style.display = 'none';

    [
        'm-colx', 'm-valy', 'm-colz',
        'm-c-colx', 'm-c-valy', 'm-c-colz', 'm-c-valk',
        'm-label', 'm-color', 'm-parent', 'm-cat'
    ].forEach(id => setValue(id));
    setValue('m-aggregation', 'sum');
    setValue('m-condition-logic', 'and');
    const logicWrap = document.getElementById(`m-condition-logic-wrap-${secId}`);
    if (logicWrap) logicWrap.style.display = 'none';

    const labelContainer = document.getElementById(`m-label-container-${secId}`);
    const categorySelect = document.getElementById(`m-cat-${secId}`);
    if (labelContainer) labelContainer.style.display = 'flex';
    if (categorySelect) categorySelect.style.display = 'none';
    const conditionsContainer = document.getElementById(`m-conditions-${secId}`);
    if (conditionsContainer) conditionsContainer.innerHTML = '';
    const conditionsPanel = document.getElementById(`m-conditions-panel-${secId}`);
    if (conditionsPanel) conditionsPanel.style.display = 'none';
    const conditionsCount = document.getElementById(`m-conditions-count-${secId}`);
    if (conditionsCount) conditionsCount.textContent = '0';
    const currentScope = document.querySelector(`input[name="m-scope-${secId}"][value="current"]`);
    if (currentScope) currentScope.checked = true;
}

function addMetricRule(secId) {
    const typeEl = document.querySelector(`input[name="m-type-${secId}"]:checked`);
    const type = typeEl ? typeEl.value : 'extract';

    let colX, valY, colZ, valK;
    if (type === 'extract' || type === 'extract_multi') {
        colX = document.getElementById(`m-colx-${secId}`).value;
        valY = document.getElementById(`m-valy-${secId}`).value.trim();
        colZ = document.getElementById(`m-colz-${secId}`).value;
        valK = '';
        if (!colX || !valY || !colZ) { showToast('请将提取模式的 X/Y/Z 列填写完整！', 'warning'); document.getElementById(!colX ? `m-colx-${secId}` : !valY ? `m-valy-${secId}` : `m-colz-${secId}`)?.focus(); return; }
    } else {
        const cx = document.getElementById(`m-c-colx-${secId}`);
        const cy = document.getElementById(`m-c-valy-${secId}`);
        const cz = document.getElementById(`m-c-colz-${secId}`);
        const ck = document.getElementById(`m-c-valk-${secId}`);
        colX = cx ? cx.value : '';
        valY = cy ? cy.value.trim() : '';
        colZ = cz ? cz.value : '';
        valK = ck ? ck.value.trim() : '';
        if (!colZ || !valK) { showToast('请将统计/占比模式的 Z/K 填写完整！', 'warning'); (!colZ ? cz : ck)?.focus(); return; }
    }

    let label = document.getElementById(`m-label-${secId}`).value.trim();
    const color = document.getElementById(`m-color-${secId}`).value;
    const parentVal = document.getElementById(`m-parent-${secId}`) ? document.getElementById(`m-parent-${secId}`).value : '';
    const category = document.getElementById(`m-cat-${secId}`) ? document.getElementById(`m-cat-${secId}`).value : '';

    if (parentVal && !category) { showToast('作为子指标时必须选择分类！', 'warning'); document.getElementById(`m-cat-${secId}`)?.focus(); return; }
    if (!parentVal && !label) { showToast('请输入主指标名称！', 'warning'); document.getElementById(`m-label-${secId}`)?.focus(); return; }

    if (parentVal && !label) {
        const [parentSecId, parentRuleId] = parentVal.split('|');
        const parentState = AppState[parentSecId];
        if (parentState) {
            const parent = parentState.customMetrics.find(r => r.id === parentRuleId);
            if (parent) {
                label = getMetricRuleDisplayLabel(parent); // inherit parent's label
            }
        }
    }

    const conditions = readMetricConditionRows(document.getElementById(`m-conditions-${secId}`));
    const aggregation = type === 'extract_multi' ? (document.getElementById(`m-aggregation-${secId}`)?.value || 'sum') : '';
    const filterLogic = type === 'extract_multi' ? (document.getElementById(`m-condition-logic-${secId}`)?.value || 'and') : 'and';
    const scopeEl = document.querySelector(`input[name="m-scope-${secId}"]:checked`);
    const scope = scopeEl ? scopeEl.value : 'current';
    const rule = {
        id: 'm_' + new Date().getTime(),
        type, colX, valY, colZ, valK, label, color, conditions, aggregation, filterLogic,
        scope,
        sourceSecId: secId
    };

    if (parentVal) {
        const [parentSecId, parentRuleId] = parentVal.split('|');
        const parentState = AppState[parentSecId];
        if (parentState) {
            const parent = parentState.customMetrics.find(r => r.id === parentRuleId);
            if (parent) {
                if (!parent.subMetrics) parent.subMetrics = [];
                rule.category = category;
                rule.label = getMetricRuleDisplayLabel(rule, parent);
                parent.subMetrics.push(rule);
                SLAPrefs.savePrefs(parentSecId);
                if (parentSecId !== secId) {
                    renderMetricList(parentSecId);
                }
            }
        }
    } else {
        AppState[secId].customMetrics.push(rule);
        SLAPrefs.savePrefs(secId);
    }

    renderMetricList(secId); evaluateAllMetrics(); updateAllMetricRuleSummaries();
    if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(AppState || {}));
    resetMetricForm(secId);
}

window.deleteMetricRule = async function(secId, ruleId) {
    const existingRule = AppState[secId]?.customMetrics?.find(r => r.id === ruleId);
    AppState[secId].customMetrics = AppState[secId].customMetrics.filter(r => r.id !== ruleId);
    SLAPrefs.savePrefs(secId);
    await removeMetricRuleTarget({ origin: '当前导入', parentSecId: secId, secId, parentRuleId: ruleId }, existingRule);
    renderMetricList(secId); evaluateAllMetrics(); updateAllMetricRuleSummaries();
    if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(AppState || {}));
};

window.deleteSubMetricRule = function(secId, parentRuleId, subIndex) {
    const parent = AppState[secId].customMetrics.find(r => r.id === parentRuleId);
    if (parent && parent.subMetrics) {
        parent.subMetrics.splice(subIndex, 1);
        SLAPrefs.savePrefs(secId); renderMetricList(secId); evaluateAllMetrics(); updateAllMetricRuleSummaries();
        if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(AppState || {}));
        if (document.getElementById('metric-rules-modal')?.style.display === 'flex') renderAllMetricRules();
    }
};

function getMetricRuleDisplayLabel(rule, parentRule) {
    const candidates = [
        rule && rule.label,
        parentRule && parentRule.label,
        rule && rule.metricLabel,
        rule && rule.name,
        rule && rule.colZ,
        parentRule && parentRule.colZ,
        '未命名指标'
    ];
    const found = candidates.find(item => item !== undefined && item !== null && String(item).trim() && String(item).trim() !== 'undefined');
    return String(found || '未命名指标').trim();
}

const SLA_PREF_TITLE_MAP = {
    rectification: '整改详单合集',
    risk: '常规风险合集',
    special: 'CPT专项风险合集',
    sr: 'SR详单分析',
    vulnerability: '漏洞预警详单'
};

const SLA_RULE_IMPORT_PREFIX_MAP = {
    rectification: 'PBI_自动抓取-整改详单_整改_Latest',
    risk: 'PBI_自动抓取-风险详单_Latest',
    special: 'PBI_自动抓取-CPT风险详表_Latest',
    sr: 'PBI_自动抓取-详单-SR_Latest',
    vulnerability: 'PBI_自动抓取-详单漏洞_漏洞预警_Latest'
};

let cachedMetricRulePrefs = null;
let cachedMetricRuleConfig = null;
let latestMetricRuleRecords = [];
let editingMetricRuleRecord = null;
let copyingMetricRuleRecord = null;
let metricRuleFastMappingTemplateText = '';
const expandedMetricRuleGroups = new Set();

function getMetricRuleI18nMap() {
    return (cachedMetricRuleConfig && cachedMetricRuleConfig.prefs && cachedMetricRuleConfig.prefs.i18nMap)
        || (cachedMetricRulePrefs && cachedMetricRulePrefs.i18nMap)
        || {};
}

function translateMetricRuleLabel(label) {
    const raw = String(label || '').trim();
    const lang = window.ToolsI18n ? window.ToolsI18n.getLanguage() : 'zh-CN';
    if (!raw || lang !== 'en-US') return raw;
    return getMetricRuleI18nMap()[raw] || raw;
}

function translateMetricRuleSectionTitle(title) {
    const raw = String(title || '').trim();
    const lang = window.ToolsI18n ? window.ToolsI18n.getLanguage() : 'zh-CN';
    if (!raw || lang !== 'en-US') return raw;
    const map = {
        '整改详单合集': SLAT('sla.section.title.rectBatch'),
        '常规风险合集': SLAT('sla.section.title.riskBatch'),
        'CPT专项风险合集': SLAT('sla.section.title.specialBatch'),
        'SR详单分析': SLAT('sla.section.title.sr'),
        '漏洞预警详单': SLAT('sla.section.title.vulnBatch'),
        '🔧 整改监控': SLAT('sla.section.title.rect'),
        '⚠️ 常规风险监控': SLAT('sla.section.title.risk'),
        '🛠️ 专项风险监控': SLAT('sla.section.title.special'),
        '📞 SR详单分析': SLAT('sla.section.title.sr'),
        '🧯 漏洞预警分析': SLAT('sla.section.title.vuln')
    };
    return map[raw] || raw;
}

function getMetricRuleDisplayOrigin(origin) {
    return origin === '当前导入' ? SLAT('sla.rules.current') : (origin === '已保存配置' ? SLAT('sla.rules.saved') : origin);
}

function normalizeMetricPrefSecId(prefKey) {
    return String(prefKey || '').replace(/^sla_prefs_/, '');
}

function getMetricRuleKnownMode(secId, prefKey) {
    const candidates = [secId, prefKey, normalizeMetricPrefSecId(secId), normalizeMetricPrefSecId(prefKey)]
        .filter(Boolean)
        .map(value => String(value));
    return Object.keys(SLA_RULE_IMPORT_PREFIX_MAP).find(mode => candidates.some(value => value === mode || value.startsWith(`${mode}_`))) || '';
}

function normalizeMetricRuleSourceName(name) {
    const baseName = String(name || '').trim().replace(/\.[^.]+$/, '');
    if (!baseName) return '';
    const knownPrefix = Object.values(SLA_RULE_IMPORT_PREFIX_MAP).find(prefix => baseName.startsWith(prefix));
    if (knownPrefix) return `${knownPrefix}*`;
    const latestIndex = baseName.indexOf('_Latest');
    if (latestIndex >= 0) return `${baseName.slice(0, latestIndex + '_Latest'.length)}*`;
    return baseName;
}

function getSavedMetricRuleSourceMeta(prefKey, sourceSecId) {
    const prefs = cachedMetricRulePrefs || {};
    const direct = prefKey && prefs[prefKey] && prefs[prefKey]._sourceMeta;
    if (direct) return direct;
    const normalized = normalizeMetricPrefSecId(sourceSecId || prefKey);
    const inferredKey = normalized ? `sla_prefs_${normalized}` : '';
    if (inferredKey && prefs[inferredKey] && prefs[inferredKey]._sourceMeta) return prefs[inferredKey]._sourceMeta;
    return null;
}

function getMetricRuleMatchedPrefixInfo(sourceSecId, prefKey, tableTitle) {
    const state = AppState && AppState[sourceSecId];
    const sourceFiles = state && Array.isArray(state.sourceFiles) ? state.sourceFiles : [];
    const prefixes = Array.from(new Set(sourceFiles.map(normalizeMetricRuleSourceName).filter(Boolean)));
    if (prefixes.length) {
        const text = prefixes.length > 2 ? `${prefixes.slice(0, 2).join(' / ')} +${prefixes.length - 2}` : prefixes.join(' / ');
        return { text, title: prefixes.join('\n') };
    }
    const savedMeta = getSavedMetricRuleSourceMeta(prefKey, sourceSecId);
    if (savedMeta) {
        const savedFiles = Array.isArray(savedMeta.sourceFiles) ? savedMeta.sourceFiles : [];
        const savedPrefixes = Array.from(new Set(savedFiles.map(normalizeMetricRuleSourceName).filter(Boolean)));
        if (savedPrefixes.length) {
            const text = savedPrefixes.length > 2 ? `${savedPrefixes.slice(0, 2).join(' / ')} +${savedPrefixes.length - 2}` : savedPrefixes.join(' / ');
            return { text, title: savedPrefixes.join('\n') };
        }
        if (savedMeta.matchedPrefix) {
            return { text: savedMeta.matchedPrefix, title: savedMeta.matchedPrefix };
        }
        if (savedMeta.baseName) {
            return { text: savedMeta.baseName, title: savedMeta.baseName };
        }
    }
    const mode = getMetricRuleKnownMode(sourceSecId, prefKey);
    if (mode && SLA_RULE_IMPORT_PREFIX_MAP[mode]) {
        const prefix = `${SLA_RULE_IMPORT_PREFIX_MAP[mode]}*`;
        return { text: prefix, title: prefix };
    }
    const normalized = normalizeMetricPrefSecId(sourceSecId || prefKey);
    if (String(normalized).startsWith('other_')) {
        const text = SLAT('sla.rules.customFilePrefixMissing', { id: normalized });
        const title = SLAT('sla.rules.customFilePrefixMissingTitle', { id: normalized });
        return { text, title };
    }
    const fallback = tableTitle || getSectionDisplayTitle(sourceSecId, prefKey);
    return { text: fallback, title: fallback };
}

function getMetricRuleTargetSecId(record) {
    if (!record) return '';
    if (record.origin === '当前导入') return record.parentSecId || record.secId || '';
    const prefKey = String(record.prefKey || '');
    if (prefKey.startsWith('sla_prefs_other_')) return prefKey.replace('sla_prefs_', '');
    if (prefKey.startsWith('sla_prefs_rectification')) return 'rectification';
    if (prefKey.startsWith('sla_prefs_risk')) return 'risk';
    if (prefKey.startsWith('sla_prefs_special')) return 'special';
    return normalizeMetricPrefSecId(prefKey);
}

async function removeMetricRuleTarget(record, rule) {
    const secId = getMetricRuleTargetSecId(record);
    const ruleId = (rule && rule.id) || (record && record.parentRuleId);
    const targetKey = secId && ruleId ? `${secId}_${ruleId}` : '';
    if (!targetKey || !window.GlobalTargets || !Object.prototype.hasOwnProperty.call(window.GlobalTargets, targetKey)) return;
    delete window.GlobalTargets[targetKey];
    try {
        await API.put('/api/sla/targets', window.GlobalTargets);
        if (window.SLASection && typeof window.SLASection.initGlobalTargets === 'function') {
            await window.SLASection.initGlobalTargets();
        }
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
    } catch (e) {
        console.warn('[SLA Metric Rules] 清理已删除规则的预警目标失败:', e);
    }
}

function getSectionDisplayTitle(secId, prefKey) {
    const state = AppState && AppState[secId];
    if (state && state.title) return state.title;
    const savedMeta = getSavedMetricRuleSourceMeta(prefKey, secId);
    if (savedMeta?.createdFrom === 'monthly-designer' && savedMeta.title) return savedMeta.title;
    const normalized = normalizeMetricPrefSecId(secId || prefKey);
    if (SLA_PREF_TITLE_MAP[normalized]) return SLA_PREF_TITLE_MAP[normalized];
    if (String(normalized).startsWith('other_')) return SLAT('sla.rules.otherTable', { id: normalized });
    return normalized || prefKey || SLAT('sla.rules.unknownTable');
}

function describeMetricRule(rule) {
    if (!rule) return '';
    if (rule.type === 'count') {
        return `COUNT ${rule.colX ? `[${escapeHTML(rule.colX)}] ${SLAT('sla.rules.contains')} '${escapeHTML(rule.valY)}' ${SLAT('sla.rules.and')} ` : ''}[${escapeHTML(rule.colZ)}] ${SLAT('sla.rules.contains')} '${escapeHTML(rule.valK)}'`;
    }
    if (rule.type === 'ratio') {
        return `RATIO [${escapeHTML(rule.colZ)}] ${SLAT('sla.rules.contains')} '${escapeHTML(rule.valK)}' / ${rule.colX ? `[${escapeHTML(rule.colX)}] ${SLAT('sla.rules.contains')} '${escapeHTML(rule.valY)}'` : SLAT('sla.rules.totalRows')}`;
    }
    if (rule.type === 'extract_multi') {
        const labels = { first: 'FIRST', sum: 'SUM', avg: 'AVG', max: 'MAX', min: 'MIN', count: 'COUNT' };
        return `${labels[rule.aggregation || 'sum'] || 'SUM'} [${escapeHTML(rule.colZ)}]`;
    }
    return `SHOW [${escapeHTML(rule.colZ)}]`;
}

function describeMetricCondition(rule) {
    if (!rule) return '-';
    const parts = [];
    if (rule.type === 'count' || rule.type === 'ratio') {
        if (rule.colX && rule.valY) parts.push(`[${escapeHTML(rule.colX)}] ${SLAT('sla.rules.contains')} '${escapeHTML(rule.valY)}'`);
    } else if (rule.colX && rule.valY) {
        parts.push(`[${escapeHTML(rule.colX)}] ${SLAT('sla.rules.contains')} '${escapeHTML(rule.valY)}'`);
    }
    getMetricRuleConditions(rule).forEach(item => {
        parts.push(`[${escapeHTML(item.column)}] ${SLAT('sla.rules.contains')} '${escapeHTML(item.value)}'`);
    });
    const relation = rule.type === 'extract_multi' && rule.filterLogic === 'or'
        ? SLAT('sla.rules.or')
        : SLAT('sla.rules.and');
    return parts.length ? parts.join(` ${relation} `) : SLAT('sla.rules.allRows');
}

function getMetricRuleModeFieldLabels(type) {
    if (type === 'count') {
        return {
            colX: SLAT('sla.rules.countColX'),
            valY: SLAT('sla.rules.countValY'),
            colZ: SLAT('sla.rules.countColZ'),
            valK: SLAT('sla.rules.countValK'),
            showValK: true
        };
    }
    if (type === 'ratio') {
        return {
            colX: SLAT('sla.rules.ratioColX'),
            valY: SLAT('sla.rules.ratioValY'),
            colZ: SLAT('sla.rules.ratioColZ'),
            valK: SLAT('sla.rules.ratioValK'),
            showValK: true
        };
    }
    return {
        colX: SLAT('sla.rules.extractColX'),
        valY: SLAT('sla.rules.extractValY'),
        colZ: SLAT('sla.rules.extractColZ'),
        valK: SLAT('sla.rules.extractValK'),
        showValK: false
    };
}

function updateMetricRuleEditorModeLabels(type) {
    const labels = getMetricRuleModeFieldLabels(type || 'extract');
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    set('metric-rule-edit-colx-label', labels.colX);
    set('metric-rule-edit-valy-label', labels.valY);
    set('metric-rule-edit-colz-label', labels.colZ);
    set('metric-rule-edit-valk-label', labels.valK);
}

function getMetricRuleSearchText(record) {
    const ruleType = record.rule && record.rule.type ? record.rule.type : 'extract';
    const modeAliases = ruleType === 'count'
        ? '统计 count COUNT'
        : (ruleType === 'ratio' ? '占比 比例 ratio RATIO' : (ruleType === 'extract_multi' ? '提取多行 聚合 aggregate sum avg max min' : '提取 extract show SHOW'));
    return [
        record.rule?.createdFrom === 'monthly-designer' ? '月报编辑器 monthly editor' : '',
        record.label,
        record.parentMetricName,
        record.subMetricName,
        record.category,
        record.typeText,
        ruleType,
        modeAliases,
        record.tableTitle,
        record.filePrefixText,
        record.filePrefixTitle,
        record.parentTitle,
        record.sourceTitle,
        record.prefKey,
        record.rule && record.rule.colX,
        record.rule && record.rule.valY,
        record.rule && record.rule.colZ,
        record.rule && record.rule.valK,
        ...getMetricRuleConditions(record.rule).flatMap(item => [item.column, item.value]),
        record.relationText,
        record.rule && record.rule.scope === 'all' ? '跨表 跨所有独立表 联合提取' : '',
        translateMetricRuleLabel(record.parentMetricName),
        translateMetricRuleLabel(record.subMetricName),
        translateMetricRuleSectionTitle(record.tableTitle),
        translateMetricRuleSectionTitle(record.parentTitle),
        translateMetricRuleSectionTitle(record.sourceTitle)
    ].filter(Boolean).join(' ').toLowerCase();
}

function makeMetricRuleRecord(base) {
    const rule = base.rule || {};
    const parentRule = base.parentRule || null;
    const sourceSecId = rule.sourceSecId || base.sourceSecId || base.parentSecId;
    const isCrossTable = Boolean((sourceSecId && base.parentSecId && sourceSecId !== base.parentSecId) || rule.scope === 'all');
    const parentMetricName = getMetricRuleDisplayLabel(parentRule || rule);
    const subMetricName = base.kind === 'sub'
        ? getMetricRuleDisplayLabel(rule, parentRule)
        : '-';
    const tableTitle = getSectionDisplayTitle(sourceSecId, base.prefKey);
    const matchedPrefix = getMetricRuleMatchedPrefixInfo(sourceSecId, base.prefKey, tableTitle);
    const record = {
        ...base,
        sourceSecId,
        isCrossTable,
        tableTitle,
        filePrefixText: matchedPrefix.text,
        filePrefixTitle: matchedPrefix.title,
        parentTitle: getSectionDisplayTitle(base.parentSecId, base.prefKey),
        sourceTitle: getSectionDisplayTitle(sourceSecId, base.prefKey),
        parentMetricName,
        subMetricName,
        label: base.kind === 'sub' ? subMetricName : parentMetricName,
        conditionText: describeMetricCondition(rule),
        resultText: describeMetricRule(rule),
        relationText: rule.scope === 'all'
            ? '🌐 跨所有独立表联合提取'
            : (base.kind === 'sub'
                ? SLAT('sla.rules.attachTo', {
                    table: translateMetricRuleSectionTitle(getSectionDisplayTitle(base.parentSecId, base.prefKey)),
                    metric: translateMetricRuleLabel(parentMetricName)
                })
                : SLAT('sla.rules.independent')),
        category: base.kind === 'sub' ? (rule.category || SLAT('sla.rules.uncategorized')) : '-',
        typeText: rule.type === 'count'
            ? SLAT('sla.rules.count')
            : (rule.type === 'ratio'
                ? SLAT('sla.rules.ratio')
                : (rule.type === 'extract_multi' ? SLAT('sla.rules.extractMulti') : SLAT('sla.rules.extract')))
    };
    record.searchText = getMetricRuleSearchText(record);
    return record;
}

function renderMetricRuleLineage(record) {
    if (record.kind === 'main') {
        return `
            <div class="metric-rule-lineage root">
                <span class="metric-line-node root-dot"></span>
                <span class="metric-line-text"><b>${SLAT('sla.rules.rootLine')}</b><br>${escapeHTML(translateMetricRuleSectionTitle(record.parentTitle))}</span>
            </div>
        `;
    }
    const isCross = record.isCrossTable;
    return `
        <div class="metric-rule-lineage ${isCross ? 'cross' : 'child'}">
            <span class="metric-line-branch">${isCross ? '↳' : '└'}</span>
            <span class="metric-line-text">
                <b>${isCross ? SLAT('sla.rules.crossAttach') : SLAT('sla.rules.localAttach')}</b><br>
                <span title="${escapeHTML(record.sourceTitle)}">${escapeHTML(translateMetricRuleSectionTitle(record.sourceTitle))}</span>
                <span class="metric-line-arrow">→</span>
                <span title="${escapeHTML(record.parentTitle)}">${escapeHTML(translateMetricRuleSectionTitle(record.parentTitle))}</span>
            </span>
        </div>
    `;
}

function getMetricRuleGroupKey(record) {
    return `${record.origin}|${record.parentSecId || record.prefKey}|${record.parentRuleId}`;
}

function collectCurrentMetricRuleRecords() {
    const records = [];
    Object.keys(AppState || {}).forEach(secId => {
        const state = AppState[secId];
        (state.customMetrics || []).forEach(rule => {
            records.push(makeMetricRuleRecord({
                kind: 'main',
                origin: '当前导入',
                secId,
                sourceSecId: secId,
                parentSecId: secId,
                parentRuleId: rule.id,
                rule
            }));
            (rule.subMetrics || []).forEach((sm, subIndex) => {
                records.push(makeMetricRuleRecord({
                    kind: 'sub',
                    origin: '当前导入',
                    secId,
                    parentSecId: secId,
                    parentRuleId: rule.id,
                    subIndex,
                    parentRule: rule,
                    rule: sm
                }));
            });
        });
    });
    return records;
}

function collectSavedMetricRuleRecords(prefs) {
    const records = [];
    Object.keys(prefs || {}).forEach(prefKey => {
        const pref = prefs[prefKey] || {};
        const secId = normalizeMetricPrefSecId(prefKey);
        (pref.customMetrics || []).forEach(rule => {
            records.push(makeMetricRuleRecord({
                kind: 'main',
                origin: '已保存配置',
                secId,
                sourceSecId: secId,
                parentSecId: secId,
                parentRuleId: rule.id,
                prefKey,
                rule
            }));
            (rule.subMetrics || []).forEach((sm, subIndex) => {
                records.push(makeMetricRuleRecord({
                    kind: 'sub',
                    origin: '已保存配置',
                    secId,
                    parentSecId: secId,
                    parentRuleId: rule.id,
                    subIndex,
                    parentRule: rule,
                    prefKey,
                    rule: sm
                }));
            });
        });
    });
    return records;
}

function collectMetricRuleRecords() {
    const merged = new Map();
    collectSavedMetricRuleRecords(cachedMetricRulePrefs || {}).forEach(record => {
        const key = `${record.parentSecId}|${record.parentRuleId}|${record.kind}|${record.subIndex ?? 'main'}|${record.sourceSecId}`;
        merged.set(key, record);
    });
    collectCurrentMetricRuleRecords().forEach(record => {
        const key = `${record.parentSecId}|${record.parentRuleId}|${record.kind}|${record.subIndex ?? 'main'}|${record.sourceSecId}`;
        merged.set(key, record);
    });
    return [...merged.values()];
}

function getInboundSubMetricRecords(secId) {
    return collectMetricRuleRecords().filter(record => (
        record.kind === 'sub'
        && record.sourceSecId === secId
        && record.parentSecId !== secId
    ));
}

function updateMetricRuleSummary(secId) {
    const badge = document.getElementById(`rule-summary-badge-${secId}`);
    const state = AppState && AppState[secId];
    if (!badge || !state) return;

    const mainRules = state.customMetrics || [];
    const subCount = mainRules.reduce((sum, rule) => sum + ((rule.subMetrics || []).length), 0);

    const crossSubRecords = getInboundSubMetricRecords(secId);
    const crossSubCount = crossSubRecords.length;

    let detail = mainRules.length
        ? mainRules.map(rule => `${getMetricRuleDisplayLabel(rule)}：${(rule.subMetrics || []).length} 个子指标`).join('\n')
        : '当前表暂无主指标规则';

    if (crossSubCount > 0) {
        detail += `\n\n📌 包含跨表子指标：${crossSubCount} 个`;
        crossSubRecords.forEach(r => {
            detail += `\n- [${r.category}] ${r.subMetricName} (归属: ${r.parentTitle})`;
        });
    }

    if (crossSubCount > 0) {
        badge.innerHTML = SLAT('sla.section.ruleSummaryCross', { main: mainRules.length, sub: subCount, cross: crossSubCount });
    } else {
        badge.textContent = SLAT('sla.section.ruleSummary', { main: mainRules.length, sub: subCount });
    }

    badge.title = detail;
    badge.classList.toggle('empty', mainRules.length === 0 && subCount === 0 && crossSubCount === 0);
}

function updateAllMetricRuleSummaries() {
    Object.keys(AppState || {}).forEach(secId => updateMetricRuleSummary(secId));
}

function renderMetricRuleCard(record, options = {}) {
    const editBtn = options.allowEdit && record.kind === 'sub'
        ? `<button onclick="openMetricRuleEditorById('${record.parentSecId}', '${record.parentRuleId}', ${record.subIndex})" style="border:none; background:none; color:#1976d2; cursor:pointer;">✎ 修改</button>`
        : '';
    const deleteBtn = record.kind === 'sub' && options.allowDelete
        ? `<button onclick="deleteSubMetricRule('${record.parentSecId}', '${record.parentRuleId}', ${record.subIndex}); renderMetricList('${record.sourceSecId}'); if (document.getElementById('metric-rules-modal')?.style.display === 'flex') renderAllMetricRules();" style="border:none; background:none; color:#d32f2f; cursor:pointer;">✖ 删除</button>`
        : '';

    let sourceNote = `<span style="color:#d32f2f;font-weight:bold;">(跨表挂载至: ${escapeHTML(record.parentTitle)})</span>`;
    return `
        <div style="font-size:11px; color:#555; background: #fafafa; padding: 6px; padding-right: 80px; margin-bottom: 4px; border-radius: 4px; position: relative;">
            <div style="position:absolute; right:6px; top:6px; display:flex; gap:6px;">
                ${editBtn}
                ${deleteBtn}
            </div>
            <b>[${escapeHTML(record.category || '未分类')}] ${escapeHTML(record.subMetricName)}</b> ${sourceNote}: <br/>${record.conditionText} ➔ ${record.resultText}
        </div>
    `;
}

async function refreshMetricRulePrefsCache() {
    try {
        const mode = API.getSourceMode('sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
        const data = await API.get(`/api/sla/config${query}`);
        cachedMetricRuleConfig = data || {};
        cachedMetricRulePrefs = data && data.prefs ? data.prefs : {};
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
    } catch (e) {
        console.warn('[SLA Metric Rules] 读取已保存规则失败，仅展示当前导入规则', e);
        cachedMetricRuleConfig = {};
        cachedMetricRulePrefs = {};
    }
}

window.refreshMetricRulePrefsCache = refreshMetricRulePrefsCache;
window.getCachedMetricRulePrefs = function() {
    return cachedMetricRulePrefs || {};
};

function highlightMetricRuleSection(secId) {
    const section = document.getElementById(`section-${secId}`);
    const metricBtn = document.getElementById(`metrics-btn-${secId}`);
    if (!section) return false;

    closeMetricRulesModal();
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.classList.add('metric-rule-jump-highlight');
    if (metricBtn) {
        metricBtn.classList.add('metric-rule-button-highlight');
        setTimeout(() => {
            populateMetricSelects(secId);
            renderMetricList(secId);
            metricBtn.click();
        }, 450);
    }
    setTimeout(() => {
        section.classList.remove('metric-rule-jump-highlight');
        if (metricBtn) metricBtn.classList.remove('metric-rule-button-highlight');
    }, 2600);
    return true;
}

window.jumpToMetricRuleTable = function(secId, title) {
    if (highlightMetricRuleSection(secId)) return;
    const safeTitle = title || getSectionDisplayTitle(secId);
    showToast(`当前页面还未导入「${safeTitle}」，请先导入对应表格后再跳转。`, 'warning');
};

function getMetricRuleFieldCandidates(record) {
    const state = AppState && AppState[record.sourceSecId];
    if (state && state.orderedHeaders) return state.orderedHeaders;
    const pref = cachedMetricRulePrefs && cachedMetricRulePrefs[record.prefKey];
    if (pref) {
        return pref.orderedHeaders || pref.visibleHeaders || Object.keys(pref.columnWidths || {});
    }
    return [];
}

function getMetricRuleMainOptions(record) {
    return collectMetricRuleRecords()
        .filter(item => item.kind === 'main' && item.origin === record.origin)
        .filter(item => !(record.kind === 'main' && item.parentRuleId === record.parentRuleId && item.parentSecId === record.parentSecId))
        .map(item => ({
            value: item.origin === '当前导入'
                ? `current|${item.parentSecId}|${item.parentRuleId}`
                : `saved|${item.prefKey}|${item.parentRuleId}`,
            label: `${translateMetricRuleSectionTitle(item.parentTitle)} / ${translateMetricRuleLabel(item.parentMetricName)}`
        }));
}

function findCurrentRuleRef(record) {
    const state = AppState && AppState[record.parentSecId];
    if (!state) return null;
    const parent = (state.customMetrics || []).find(rule => rule.id === record.parentRuleId);
    if (!parent) return null;
    return {
        origin: 'current',
        state,
        parent,
        rule: record.kind === 'sub' ? (parent.subMetrics || [])[record.subIndex] : parent
    };
}

function findSavedRuleRef(record) {
    const pref = cachedMetricRulePrefs && cachedMetricRulePrefs[record.prefKey];
    if (!pref) return null;
    const parent = (pref.customMetrics || []).find(rule => rule.id === record.parentRuleId);
    if (!parent) return null;
    return {
        origin: 'saved',
        pref,
        parent,
        rule: record.kind === 'sub' ? (parent.subMetrics || [])[record.subIndex] : parent
    };
}

function findMetricRuleRef(record) {
    return record.origin === '当前导入' ? findCurrentRuleRef(record) : findSavedRuleRef(record);
}
window.findMetricRuleRef = findMetricRuleRef;

function renderMetricRuleEditorPreview() {
    const type = document.getElementById('metric-rule-edit-type')?.value || 'extract';
    const colX = document.getElementById('metric-rule-edit-colx')?.value || '';
    const valY = document.getElementById('metric-rule-edit-valy')?.value || '';
    const colZ = document.getElementById('metric-rule-edit-colz')?.value || '';
    const valK = document.getElementById('metric-rule-edit-valk')?.value || '';
    const category = document.getElementById('metric-rule-edit-category')?.value || '';
    const parentSel = document.getElementById('metric-rule-edit-parent');
    const parentText = parentSel && parentSel.selectedOptions[0] ? parentSel.selectedOptions[0].textContent : SLAT('sla.rules.independent');
    const conditions = readMetricConditionRows(document.getElementById('metric-rule-edit-conditions-list'));
    const aggregation = document.getElementById('metric-rule-edit-aggregation')?.value || 'sum';
    const filterLogic = document.getElementById('metric-rule-edit-filter-logic')?.value || 'and';
    const scope = document.getElementById('metric-rule-edit-scope')?.value || 'current';
    const rule = { type, colX, valY, colZ, valK, conditions, aggregation, filterLogic, scope };
    const preview = document.getElementById('metric-rule-edit-preview');
    if (!preview) return;
    const scopeBadge = scope === 'all' ? '<span style="color:#7b1fa2; font-weight:bold; margin-left:6px;">[🌐 跨所有独立表联合提取]</span>' : '';
    preview.innerHTML = `
        <div><b>${SLAT('sla.rules.previewRule')}</b>: IF ${describeMetricCondition(rule)} ➔ ${describeMetricRule(rule)}${scopeBadge}</div>
        <div><b>${SLAT('sla.rules.previewOwner')}</b>: ${editingMetricRuleRecord?.kind === 'sub' ? `[${escapeHTML(translateMetricRuleLabel(category || SLAT('sla.rules.uncategorized')))}] ${SLAT('sla.rules.attachToMetric', { metric: escapeHTML(parentText) })}` : SLAT('sla.rules.independent')}</div>
    `;
}

window.refreshMetricRuleEditorMode = function() {
    const type = document.getElementById('metric-rule-edit-type')?.value || 'extract';
    const isExtract = type === 'extract' || type === 'extract_multi';
    const isMulti = type === 'extract_multi';
    updateMetricRuleEditorModeLabels(type);
    document.querySelectorAll('.metric-rule-edit-stat-only').forEach(el => {
        el.style.display = isExtract ? 'none' : 'flex';
    });
    document.querySelectorAll('.metric-rule-edit-multi-only').forEach(el => {
        el.style.display = isMulti ? 'flex' : 'none';
    });
    const help = document.getElementById('metric-rule-edit-conditions-help');
    if (help) help.textContent = isMulti
        ? SLAT('sla.section.multiConditionsHelp')
        : SLAT('sla.section.andConditionsHelp');
    renderMetricRuleEditorPreview();
};

window.addMetricRuleEditorCondition = function() {
    if (!editingMetricRuleRecord) return;
    const container = document.getElementById('metric-rule-edit-conditions-list');
    const conditions = readMetricConditionDraftRows(container);
    conditions.push({ column: '', value: '' });
    renderMetricConditionRows(container, getMetricRuleFieldCandidates(editingMetricRuleRecord), conditions, 'editor');
    renderMetricRuleEditorPreview();
};

window.removeMetricRuleEditorCondition = function(index) {
    if (!editingMetricRuleRecord) return;
    const container = document.getElementById('metric-rule-edit-conditions-list');
    const conditions = readMetricConditionDraftRows(container);
    conditions.splice(index, 1);
    renderMetricConditionRows(container, getMetricRuleFieldCandidates(editingMetricRuleRecord), conditions, 'editor');
    renderMetricRuleEditorPreview();
};

window.openMetricRuleEditorById = function(secId, ruleId, subIndex = -1) {
    const allRecords = collectMetricRuleRecords();
    const record = allRecords.find(r =>
        r.origin === '当前导入' &&
        r.parentSecId === secId &&
        r.parentRuleId === ruleId &&
        (subIndex === -1 ? r.kind === 'main' : (r.kind === 'sub' && r.subIndex === subIndex))
    );
    if (!record) {
        showToast(SLAT('sla.rules.notFoundConfig'), 'warning');
        return;
    }
    if (typeof latestMetricRuleRecords === 'undefined') window.latestMetricRuleRecords = [];
    const index = latestMetricRuleRecords.push(record) - 1;
    openMetricRuleEditor(index);
};

window.openMetricRuleEditor = function(index) {
    const record = latestMetricRuleRecords[index];
    if (!record) return;
    const ref = findMetricRuleRef(record);
    if (!ref || !ref.rule) {
        showToast(SLAT('sla.rules.notEditable'), 'warning');
        return;
    }
    editingMetricRuleRecord = record;
    const rule = ref.rule;
    const modal = document.getElementById('metric-rule-edit-modal');
    if (!modal) return;

    document.getElementById('metric-rule-edit-index').value = String(index);
    document.getElementById('metric-rule-edit-label').value = getMetricRuleDisplayLabel(rule, ref.parent);
    document.getElementById('metric-rule-edit-type').value = rule.type || 'extract';
    const candidates = Array.from(new Set([
        ...getMetricRuleFieldCandidates(record),
        rule.colX,
        rule.colZ
    ].filter(Boolean)));

    const fieldOptionsHtml = `<option value="">${SLAT('sla.rules.emptyColumn')}</option>` + candidates
        .map(col => `<option value="${escapeHTML(col)}">${escapeHTML(col)}</option>`).join('');

    document.getElementById('metric-rule-edit-colx').innerHTML = fieldOptionsHtml;
    document.getElementById('metric-rule-edit-colz').innerHTML = fieldOptionsHtml;

    document.getElementById('metric-rule-edit-colx').value = rule.colX || '';
    document.getElementById('metric-rule-edit-colz').value = rule.colZ || '';
    document.getElementById('metric-rule-edit-valy').value = rule.valY || '';
    document.getElementById('metric-rule-edit-valk').value = rule.valK || '';
    document.getElementById('metric-rule-edit-aggregation').value = rule.aggregation || 'sum';
    document.getElementById('metric-rule-edit-filter-logic').value = rule.filterLogic || 'and';
    renderMetricConditionRows(
        document.getElementById('metric-rule-edit-conditions-list'),
        candidates,
        getMetricRuleConditions(rule),
        'editor'
    );

    const cats = window.GlobalCategories || ['TE', 'ORG', 'ET', 'VDF'];
    document.getElementById('metric-rule-edit-category').innerHTML = cats
        .map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`).join('');
    document.getElementById('metric-rule-edit-category').value = rule.category || record.category || cats[0] || '';

    const parentOptions = getMetricRuleMainOptions(record);
    document.getElementById('metric-rule-edit-parent').innerHTML = parentOptions.length
        ? parentOptions.map(item => `<option value="${escapeHTML(item.value)}">${escapeHTML(item.label)}</option>`).join('')
        : `<option value="">${SLAT('sla.rules.noMainMetric')}</option>`;
    const currentParentValue = record.origin === '当前导入'
        ? `current|${record.parentSecId}|${record.parentRuleId}`
        : `saved|${record.prefKey}|${record.parentRuleId}`;
    if (record.kind === 'sub') document.getElementById('metric-rule-edit-parent').value = currentParentValue;

    const scopeEl = document.getElementById('metric-rule-edit-scope');
    if (scopeEl) {
        scopeEl.value = rule.scope || 'current';
        scopeEl.disabled = rule.createdFrom === 'monthly-designer';
        scopeEl.title = rule.createdFrom === 'monthly-designer' ? SLAT('sla.rules.monthlyScope') : '';
    }

    document.querySelectorAll('.metric-rule-edit-sub-only').forEach(el => {
        el.style.display = record.kind === 'sub' ? 'flex' : 'none';
    });
    document.getElementById('metric-rule-edit-subtitle').textContent = `${getMetricRuleDisplayOrigin(record.origin)} · ${translateMetricRuleSectionTitle(record.parentTitle)} · ${record.kind === 'sub' ? SLAT('sla.rules.sub') : SLAT('sla.rules.main')}`;
    ['metric-rule-edit-label', 'metric-rule-edit-colx', 'metric-rule-edit-valy', 'metric-rule-edit-colz', 'metric-rule-edit-valk', 'metric-rule-edit-aggregation', 'metric-rule-edit-filter-logic', 'metric-rule-edit-category', 'metric-rule-edit-parent', 'metric-rule-edit-scope']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.oninput = renderMetricRuleEditorPreview;
            if (el) el.onchange = id === 'metric-rule-edit-type' ? refreshMetricRuleEditorMode : renderMetricRuleEditorPreview;
        });
    refreshMetricRuleEditorMode();
    modal.style.display = 'flex';
};

window.closeMetricRuleEditor = function() {
    const modal = document.getElementById('metric-rule-edit-modal');
    if (modal) modal.style.display = 'none';
    editingMetricRuleRecord = null;
};

async function persistSavedMetricRuleConfig() {
    const payload = {
        targets: cachedMetricRuleConfig && cachedMetricRuleConfig.targets ? cachedMetricRuleConfig.targets : null,
        prefs: cachedMetricRulePrefs || {}
    };
    await API.post('/api/sla/config', payload);
    await refreshMetricRulePrefsCache();
}

function moveSubMetricRule(record, ref, newParentValue) {
    if (record.kind !== 'sub' || !newParentValue) return [];
    const changedSecIds = new Set();
    if (record.origin === '当前导入') {
        const [, newSecId, newRuleId] = newParentValue.split('|');
        if (newSecId === record.parentSecId && newRuleId === record.parentRuleId) return [];
        const oldParent = ref.parent;
        const rule = ref.rule;
        const newParent = AppState[newSecId]?.customMetrics?.find(item => item.id === newRuleId);
        if (!newParent) {
            throw new Error(SLAT('sla.rules.notFoundParent'));
        }
        oldParent.subMetrics.splice(record.subIndex, 1);
        if (!newParent.subMetrics) newParent.subMetrics = [];
        newParent.subMetrics.push(rule);
        changedSecIds.add(record.parentSecId);
        changedSecIds.add(newSecId);
        return [...changedSecIds];
    }

    const [, newPrefKey, newRuleId] = newParentValue.split('|');
    if (newPrefKey === record.prefKey && newRuleId === record.parentRuleId) return [];
    const rule = ref.rule;
    const newPref = cachedMetricRulePrefs[newPrefKey];
    const newParent = newPref?.customMetrics?.find(item => item.id === newRuleId);
    if (!newParent) {
        throw new Error(SLAT('sla.rules.notFoundParent'));
    }
    ref.parent.subMetrics.splice(record.subIndex, 1);
    if (!newParent.subMetrics) newParent.subMetrics = [];
    newParent.subMetrics.push(rule);
    return [];
}

window.saveMetricRuleEditor = async function() {
    if (!editingMetricRuleRecord) return;
    const record = editingMetricRuleRecord;
    const ref = findMetricRuleRef(record);
    if (!ref || !ref.rule) {
        showToast(SLAT('sla.rules.saveMissing'), 'error');
        return;
    }

    const type = document.getElementById('metric-rule-edit-type').value;
    const colX = document.getElementById('metric-rule-edit-colx').value.trim();
    const valY = document.getElementById('metric-rule-edit-valy').value.trim();
    const colZ = document.getElementById('metric-rule-edit-colz').value.trim();
    const valK = document.getElementById('metric-rule-edit-valk').value.trim();
    const label = document.getElementById('metric-rule-edit-label').value.trim();
    const conditions = readMetricConditionRows(document.getElementById('metric-rule-edit-conditions-list'));
    const isExtract = type === 'extract' || type === 'extract_multi';

    if (!label) { showToast(SLAT('sla.rules.needName'), 'warning'); return; }
    if (!colZ) { showToast(SLAT('sla.rules.needColZ'), 'warning'); return; }
    if (isExtract && (!colX || !valY)) { showToast(SLAT('sla.rules.needExtractFields'), 'warning'); return; }
    if (!isExtract && !valK) { showToast(SLAT('sla.rules.needStatValue'), 'warning'); return; }

    const rule = ref.rule;
    rule.type = type;
    rule.colX = colX;
    rule.valY = valY;
    rule.colZ = colZ;
    rule.valK = isExtract ? '' : valK;
    rule.conditions = conditions;
    rule.aggregation = type === 'extract_multi' ? (document.getElementById('metric-rule-edit-aggregation').value || 'sum') : '';
    rule.filterLogic = type === 'extract_multi' ? (document.getElementById('metric-rule-edit-filter-logic').value || 'and') : 'and';
    rule.scope = document.getElementById('metric-rule-edit-scope')?.value || 'current';
    rule.label = label;
    if (record.kind === 'sub') {
        rule.category = document.getElementById('metric-rule-edit-category').value || rule.category || '未分类';
    }

    try {
        const changedSecIds = moveSubMetricRule(record, ref, document.getElementById('metric-rule-edit-parent').value);
        if (record.origin === '当前导入') {
            const secIds = changedSecIds.length ? changedSecIds : [record.parentSecId];
            for (const secId of secIds) {
                if (AppState[secId]) {
                    await SLAPrefs.savePrefs(secId);
                    renderMetricList(secId);
                }
            }
            evaluateAllMetrics();
            updateAllMetricRuleSummaries();
            if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(AppState || {}));
        } else {
            await persistSavedMetricRuleConfig();
        }
        closeMetricRuleEditor();
        await refreshMetricRulePrefsCache();
        renderAllMetricRules();
        showToast(SLAT('sla.rules.savedToast'));
    } catch (e) {
        console.error('[SLA Metric Rules] 保存规则失败:', e);
        showToast(SLAT('sla.rules.saveFail', { message: e.message || e }), 'error');
    }
};

function createMetricRuleId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return `m_${window.crypto.randomUUID()}`;
    }
    return `m_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function cloneMetricRuleForCopy(sourceRule, record, rowData) {
    const cloned = JSON.parse(JSON.stringify(sourceRule || {}));
    cloned.id = createMetricRuleId();
    cloned.type = rowData.type;
    cloned.colX = rowData.colX;
    cloned.valY = rowData.valY;
    cloned.colZ = rowData.colZ;
    cloned.valK = (rowData.type === 'extract' || rowData.type === 'extract_multi') ? '' : rowData.valK;
    cloned.conditions = getMetricRuleConditions({ conditions: rowData.conditions }).map(item => ({ ...item }));
    cloned.scope = rowData.scope || sourceRule.scope || 'current';
    cloned.label = rowData.label;
    cloned.sourceSecId = sourceRule.sourceSecId || record.sourceSecId;
    if (record.kind === 'main') {
        cloned.subMetrics = [];
    } else {
        delete cloned.subMetrics;
        cloned.category = rowData.category || sourceRule.category || record.category || SLAT('sla.rules.uncategorized');
    }
    return cloned;
}

function getMetricRuleCopyFieldOptions(record, rule) {
    return Array.from(new Set([
        ...getMetricRuleFieldCandidates(record),
        rule.colX,
        rule.colZ,
        ...getMetricRuleConditions(rule).map(item => item.column)
    ].filter(Boolean)));
}

function parseMetricRuleCopyConditions(value) {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return getMetricRuleConditions({ conditions: parsed }).map(item => ({ column: item.column, value: String(item.value) }));
    } catch (e) {
        return [];
    }
}

function canonicalMetricRuleConditions(conditions) {
    return getMetricRuleConditions({ conditions })
        .map(item => ({ column: String(item.column), value: String(item.value).trim() }))
        .sort((a, b) => `${a.column}\u0000${a.value}`.localeCompare(`${b.column}\u0000${b.value}`, 'zh-CN'));
}

function metricRuleConditionsSignature(conditions) {
    return JSON.stringify(canonicalMetricRuleConditions(conditions));
}

function readMetricRuleCopyRows() {
    return Array.from(document.querySelectorAll('#metric-rule-copy-rows tr')).map((row, index) => ({
        index: index + 1,
        label: row.querySelector('[data-field="label"]')?.value.trim() || '',
        type: row.querySelector('[data-field="type"]')?.value || 'extract',
        category: row.querySelector('[data-field="category"]')?.value || '',
        parent: row.querySelector('[data-field="parent"]')?.value || '',
        colX: row.querySelector('[data-field="colX"]')?.value.trim() || '',
        valY: row.querySelector('[data-field="valY"]')?.value.trim() || '',
        colZ: row.querySelector('[data-field="colZ"]')?.value.trim() || '',
        valK: row.querySelector('[data-field="valK"]')?.value.trim() || '',
        conditions: parseMetricRuleCopyConditions(row.querySelector('[data-field="conditions"]')?.value || '[]')
    }));
}

function getMetricRuleCopyDraftCount() {
    const input = document.getElementById('metric-rule-copy-count');
    const count = Number(input?.value || 1);
    return Math.max(1, Math.min(50, Number.isFinite(count) ? Math.floor(count) : 1));
}

function renderMetricRuleCopySelect(options, value, field, disabled = false) {
    const optionHtml = options.map(item => {
        const itemValue = typeof item === 'string' ? item : item.value;
        const label = typeof item === 'string' ? item : item.label;
        return `<option value="${escapeHTML(itemValue)}" ${itemValue === value ? 'selected' : ''}>${escapeHTML(label)}</option>`;
    }).join('');
    return `<select data-field="${field}" ${disabled ? 'disabled style="background: #f1f5f9; color: #94a3b8;"' : ''}>${optionHtml}</select>`;
}

function updateMetricRuleCopyHeaders(type) {
    const labels = getMetricRuleModeFieldLabels(type || 'extract');
    const headers = document.querySelectorAll('#metric-rule-copy-modal .metric-rule-copy-table th');
    const headerKeys = [
        '#',
        SLAT('sla.modal.metricName'),
        SLAT('sla.modal.mode'),
        SLAT('sla.modal.category'),
        SLAT('sla.modal.parent'),
        labels.colX,
        labels.valY,
        labels.colZ,
        labels.valK,
        '高级多重过滤',
        SLAT('sla.rules.thAction')
    ];
    headerKeys.forEach((text, index) => {
        if (headers[index]) headers[index].textContent = text;
    });
    if (headers[8]) headers[8].style.display = labels.showValK ? '' : 'none';
    document.querySelectorAll('#metric-rule-copy-modal .metric-rule-copy-valk-col').forEach(el => {
        el.style.display = labels.showValK ? '' : 'none';
    });
}
window.updateMetricRuleCopyHeaders = updateMetricRuleCopyHeaders;

window.renderMetricRuleCopyRows = function() {
    if (!copyingMetricRuleRecord) return;
    const record = copyingMetricRuleRecord;
    const ref = findMetricRuleRef(record);
    const tbody = document.getElementById('metric-rule-copy-rows');
    if (!tbody || !ref?.rule) return;

    const currentRows = readMetricRuleCopyRows();
    const count = getMetricRuleCopyDraftCount();
    const countInput = document.getElementById('metric-rule-copy-count');
    if (countInput && String(countInput.value) !== String(count)) countInput.value = String(count);

    const rule = ref.rule;
    const copyType = rule.type || 'extract';
    const copyLabels = getMetricRuleModeFieldLabels(copyType);
    const fieldCandidates = getMetricRuleCopyFieldOptions(record, rule);
    const fieldOptions = [{ value: '', label: SLAT('sla.rules.emptyColumn') }, ...fieldCandidates.map(col => ({ value: col, label: col }))];
    const typeOptions = [
        { value: 'extract', label: SLAT('sla.modal.extract') },
        { value: 'extract_multi', label: SLAT('sla.modal.extractMulti') },
        { value: 'count', label: SLAT('sla.modal.count') },
        { value: 'ratio', label: SLAT('sla.modal.ratio') }
    ];
    const cats = window.GlobalCategories || ['TE', 'ORG', 'ET', 'VDF'];
    const categoryOptions = cats.map(cat => ({ value: cat, label: cat }));
    const parentOptions = getMetricRuleMainOptions(record);
    const currentParentValue = record.origin === '当前导入'
        ? `current|${record.parentSecId}|${record.parentRuleId}`
        : `saved|${record.prefKey}|${record.parentRuleId}`;
    const baseLabel = getMetricRuleDisplayLabel(rule, ref.parent);
    const rows = [];

    for (let i = 0; i < count; i += 1) {
        const existing = currentRows[i] || {};
        const mapping = (window.currentCopyMappings && window.currentCopyMappings[i]) || null;
        const rowType = existing.type || copyType;
        const row = {
            label: existing.label || baseLabel,
            type: rowType,
            category: mapping ? mapping.category : (existing.category || rule.category || record.category || cats[0] || ''),
            parent: existing.parent || currentParentValue,
            colX: existing.colX || rule.colX || '',
            valY: mapping && (rowType === 'extract' || rowType === 'extract_multi') ? mapping.conditionValue : (existing.valY || rule.valY || ''),
            colZ: existing.colZ || rule.colZ || '',
            valK: mapping && rowType !== 'extract' && rowType !== 'extract_multi' ? mapping.conditionValue : (existing.valK || rule.valK || ''),
            conditions: Object.prototype.hasOwnProperty.call(existing, 'conditions')
                ? existing.conditions
                : getMetricRuleConditions(rule).map(item => ({ ...item }))
        };
        const conditionsJson = JSON.stringify(row.conditions || []);
        const conditionsCount = (row.conditions || []).length;
        rows.push(`
            <tr>
                <td class="metric-rule-copy-index">${i + 1}</td>
                <td><input data-field="label" value="${escapeHTML(row.label)}" ${record.kind === 'sub' ? 'disabled style="background: #f1f5f9; color: #94a3b8;"' : ''}></td>
                <td>${renderMetricRuleCopySelect(typeOptions, row.type, 'type', true)}</td>
                <td>${record.kind === 'main'
                    ? `<span class="metric-rule-copy-static">-</span>`
                    : renderMetricRuleCopySelect(categoryOptions, row.category, 'category')}</td>
                <td>${record.kind === 'sub'
                    ? renderMetricRuleCopySelect(parentOptions, row.parent, 'parent')
                    : `<span class="metric-rule-copy-static">${SLAT('sla.rules.independent')}</span>`}</td>
                <td>${renderMetricRuleCopySelect(fieldOptions, row.colX, 'colX')}</td>
                <td><input data-field="valY" value="${escapeHTML(row.valY)}"></td>
                <td>${renderMetricRuleCopySelect(fieldOptions, row.colZ, 'colZ')}</td>
                <td class="metric-rule-copy-valk-col" style="${copyLabels.showValK ? '' : 'display:none;'}"><input data-field="valK" value="${escapeHTML(row.valK)}"></td>
                <td>
                    <textarea data-field="conditions" hidden>${escapeHTML(conditionsJson)}</textarea>
                    <button type="button" class="metric-rule-copy-conditions-btn ${conditionsCount ? 'has-conditions' : ''}" onclick="openMetricRuleCopyConditionsEditor(${i})">⚙️ ${conditionsCount} 条</button>
                </td>
                <td><button type="button" class="metric-rule-copy-row-delete" onclick="deleteMetricRuleCopyRow(${i})">${SLAT('sla.rules.delete')}</button></td>
            </tr>
        `);
    }
    tbody.innerHTML = rows.join('');
    updateMetricRuleCopyHeaders(copyType);
};

window.deleteMetricRuleCopyRow = function(index) {
    const tbody = document.getElementById('metric-rule-copy-rows');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length <= 1) {
        showToast(SLAT('sla.rules.copyNeedOneRow'), 'warning');
        return;
    }
    const target = rows[index];
    if (!target) return;
    target.remove();
    if (Array.isArray(window.currentCopyMappings)) {
        window.currentCopyMappings.splice(index, 1);
    }
    const remainingRows = Array.from(tbody.querySelectorAll('tr'));
    remainingRows.forEach((row, rowIndex) => {
        const indexCell = row.querySelector('.metric-rule-copy-index');
        const deleteBtn = row.querySelector('.metric-rule-copy-row-delete');
        if (indexCell) indexCell.textContent = String(rowIndex + 1);
        if (deleteBtn) deleteBtn.setAttribute('onclick', `deleteMetricRuleCopyRow(${rowIndex})`);
    });
    const countInput = document.getElementById('metric-rule-copy-count');
    if (countInput) countInput.value = String(remainingRows.length);
};

function getMetricRuleCopyConditionsDraft() {
    return readMetricConditionDraftRows(document.getElementById('metric-rule-copy-conditions-list'));
}

window.openMetricRuleCopyConditionsEditor = function(index) {
    if (!copyingMetricRuleRecord) return;
    const row = document.querySelectorAll('#metric-rule-copy-rows tr')[index];
    if (!row) return;
    const conditions = parseMetricRuleCopyConditions(row.querySelector('[data-field="conditions"]')?.value || '[]');
    const ref = findMetricRuleRef(copyingMetricRuleRecord);
    const fields = ref?.rule ? getMetricRuleCopyFieldOptions(copyingMetricRuleRecord, ref.rule) : [];
    document.getElementById('metric-rule-copy-conditions-row-index').value = String(index);
    document.getElementById('metric-rule-copy-conditions-subtitle').textContent = `第 ${index + 1} 条复制规则 · 已配置 ${conditions.length} 条高级条件`;
    renderMetricConditionRows(document.getElementById('metric-rule-copy-conditions-list'), fields, conditions, 'copy-editor');
    document.getElementById('metric-rule-copy-conditions-modal').style.display = 'flex';
};

window.closeMetricRuleCopyConditionsEditor = function() {
    const modal = document.getElementById('metric-rule-copy-conditions-modal');
    if (modal) modal.style.display = 'none';
};

window.addMetricRuleCopyCondition = function() {
    if (!copyingMetricRuleRecord) return;
    const ref = findMetricRuleRef(copyingMetricRuleRecord);
    const fields = ref?.rule ? getMetricRuleCopyFieldOptions(copyingMetricRuleRecord, ref.rule) : [];
    const conditions = getMetricRuleCopyConditionsDraft();
    conditions.push({ column: '', value: '' });
    renderMetricConditionRows(document.getElementById('metric-rule-copy-conditions-list'), fields, conditions, 'copy-editor');
};

window.removeMetricRuleCopyCondition = function(index) {
    if (!copyingMetricRuleRecord) return;
    const ref = findMetricRuleRef(copyingMetricRuleRecord);
    const fields = ref?.rule ? getMetricRuleCopyFieldOptions(copyingMetricRuleRecord, ref.rule) : [];
    const conditions = getMetricRuleCopyConditionsDraft();
    conditions.splice(index, 1);
    renderMetricConditionRows(document.getElementById('metric-rule-copy-conditions-list'), fields, conditions, 'copy-editor');
};

window.applyMetricRuleCopyConditionsEditor = function() {
    const index = Number(document.getElementById('metric-rule-copy-conditions-row-index')?.value);
    const row = document.querySelectorAll('#metric-rule-copy-rows tr')[index];
    if (!row) return;
    const drafts = getMetricRuleCopyConditionsDraft();
    const incompleteIndex = drafts.findIndex(item => !item.column || !String(item.value || '').trim());
    if (incompleteIndex >= 0) {
        showToast(`第 ${incompleteIndex + 1} 条高级条件请完整选择列并填写条件值`, 'warning');
        return;
    }
    const conditions = getMetricRuleConditions({ conditions: drafts });
    const storage = row.querySelector('[data-field="conditions"]');
    if (storage) storage.value = JSON.stringify(conditions);
    const button = row.querySelector('.metric-rule-copy-conditions-btn');
    if (button) {
        button.textContent = `⚙️ ${conditions.length} 条`;
        button.classList.toggle('has-conditions', conditions.length > 0);
    }
    closeMetricRuleCopyConditionsEditor();
};

function setMetricRuleFastMappingControlsEnabled(enabled) {
    ['metric-rule-fast-apply-btn', 'metric-rule-fast-template-btn'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.disabled = !enabled;
        btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        btn.title = enabled ? '' : SLAT('sla.rules.fastMappingMainDisabled');
        btn.classList.toggle('disabled', !enabled);
    });
}

window.openMetricRuleCopyModal = function(index) {
    const record = latestMetricRuleRecords[index];
    if (!record) return;
    const ref = findMetricRuleRef(record);
    if (!ref || !ref.rule) {
        showToast(SLAT('sla.rules.notEditable'), 'warning');
        return;
    }
    copyingMetricRuleRecord = record;
    window.copyingMetricRuleRecord = record;
    window.currentCopyMappings = [];
    const rule = ref.rule;
    const modal = document.getElementById('metric-rule-copy-modal');
    if (!modal) return;

    document.getElementById('metric-rule-copy-index').value = String(index);
    document.getElementById('metric-rule-copy-count').value = '1';
    document.getElementById('metric-rule-copy-subtitle').textContent = `${getMetricRuleDisplayOrigin(record.origin)} · ${translateMetricRuleSectionTitle(record.parentTitle)} · ${record.kind === 'sub' ? SLAT('sla.rules.sub') : SLAT('sla.rules.main')}`;
    document.getElementById('metric-rule-copy-original').innerHTML = `
        <div><b>${SLAT('sla.rules.copyOriginal')}</b>: ${escapeHTML(translateMetricRuleLabel(getMetricRuleDisplayLabel(rule, ref.parent)))}</div>
        <div><b>${SLAT('sla.rules.previewRule')}</b>: IF ${describeMetricCondition(rule)} ➔ ${describeMetricRule(rule)}</div>
        <div><b>${SLAT('sla.rules.previewOwner')}</b>: ${escapeHTML(record.relationText || '')}</div>
    `;
    const tbody = document.getElementById('metric-rule-copy-rows');
    if (tbody) tbody.innerHTML = '';
    setMetricRuleFastMappingControlsEnabled(record.kind === 'sub');
    renderMetricRuleCopyRows();
    modal.style.display = 'flex';
};

window.closeMetricRuleCopyModal = function() {
    closeMetricRuleCopyConditionsEditor();
    const modal = document.getElementById('metric-rule-copy-modal');
    if (modal) modal.style.display = 'none';
    copyingMetricRuleRecord = null;
    window.copyingMetricRuleRecord = null;
    window.currentCopyMappings = [];
};

window.currentCopyMappings = [];
window.metricRuleFastMappingTemplateText = '';

async function loadMetricRuleFastMappingTemplate() {
    try {
        const data = await API.get('/api/sla/rule-templates/fast-mapping');
        metricRuleFastMappingTemplateText = data && typeof data.text === 'string' ? data.text : '';
        window.metricRuleFastMappingTemplateText = metricRuleFastMappingTemplateText;
        return metricRuleFastMappingTemplateText;
    } catch (e) {
        console.error('Failed to load fast mapping template', e);
        return metricRuleFastMappingTemplateText || '';
    }
}

function parseMetricRuleMappingText(text) {
    const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const mappings = [];
    for (const line of lines) {
        let parts;
        if (line.includes('\t')) {
            parts = line.split('\t').map(item => item.trim());
        } else if (line.includes(',')) {
            parts = line.split(',').map(item => item.trim());
        } else {
            parts = line.split(/\s+/).map(item => item.trim());
        }
        parts = parts.filter(Boolean);
        if (parts.length >= 2) {
            mappings.push({ category: parts[0], conditionValue: parts.slice(1).join(' ') });
        } else if (parts.length === 1) {
            mappings.push({ category: parts[0], conditionValue: '' });
        }
    }
    return mappings;
}

function getMetricRuleTemplateCategories() {
    const cats = Array.isArray(window.GlobalCategories) && window.GlobalCategories.length
        ? window.GlobalCategories
        : ['TE', 'ORG', 'ET', 'VDF'];
    return Array.from(new Set(cats.map(cat => String(cat || '').trim()).filter(Boolean)));
}

function renderMetricRuleMappingTemplateRows(mappings = []) {
    const tbody = document.getElementById('metric-rule-mapping-rows');
    if (!tbody) return;
    const categories = getMetricRuleTemplateCategories();
    const savedByCategory = new Map();
    mappings.forEach(row => {
        if (row && row.category && !savedByCategory.has(row.category)) {
            savedByCategory.set(row.category, row.conditionValue || '');
        }
    });
    const extraCategories = mappings
        .map(row => row.category)
        .filter(cat => cat && !categories.includes(cat));
    const rowCategories = Array.from(new Set([...categories, ...extraCategories]));
    const categoryOptions = rowCategories.map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`).join('');
    const rows = rowCategories.map(category => ({
        category,
        conditionValue: savedByCategory.has(category) ? savedByCategory.get(category) : ''
    }));
    tbody.innerHTML = rows.map((row, index) => `
        <tr>
            <td class="metric-rule-template-index">${index + 1}</td>
            <td>
                <select data-field="category">
                    ${categoryOptions.replace(`value="${escapeHTML(row.category || '')}"`, `value="${escapeHTML(row.category || '')}" selected`)}
                </select>
            </td>
            <td><input data-field="conditionValue" value="${escapeHTML(row.conditionValue || '')}" placeholder="例如：整改超期"></td>
        </tr>
    `).join('');
}

function readMetricRuleMappingTemplateRows(includeEmpty = false) {
    return Array.from(document.querySelectorAll('#metric-rule-mapping-rows tr')).map(row => ({
        category: row.querySelector('[data-field="category"]')?.value.trim() || '',
        conditionValue: row.querySelector('[data-field="conditionValue"]')?.value.trim() || ''
    })).filter(row => includeEmpty || row.category || row.conditionValue);
}

function serializeMetricRuleMappingTemplateRows() {
    return readMetricRuleMappingTemplateRows()
        .filter(row => row.category && row.conditionValue)
        .map(row => `${row.category}\t${row.conditionValue || ''}`.trimEnd())
        .join('\n');
}

window.handleMetricRuleMappingPaste = function(event) {
    const text = event.clipboardData?.getData('text/plain') || '';
    const rawLines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (!rawLines.length) return;
    event.preventDefault();

    const targetRow = event.target?.closest('tr');
    const allRows = Array.from(document.querySelectorAll('#metric-rule-mapping-rows tr'));
    const startIndex = Math.max(0, allRows.indexOf(targetRow));
    const rows = readMetricRuleMappingTemplateRows(true);
    const pastedRows = rawLines.map(line => line.split('\t').map(item => item.trim()));
    const hasTwoColumns = pastedRows.some(parts => parts.length >= 2);
    if (hasTwoColumns) {
        const rowByCategory = new Map(rows.map((row, index) => [row.category, index]));
        pastedRows.forEach(parts => {
            const category = parts[0] || '';
            if (!rowByCategory.has(category)) return;
            rows[rowByCategory.get(category)].conditionValue = parts.slice(1).join(' ').trim();
        });
    } else {
        rawLines.forEach((line, offset) => {
            if (!rows[startIndex + offset]) return;
            rows[startIndex + offset].conditionValue = line;
        });
    }
    renderMetricRuleMappingTemplateRows(rows);
};

window.openMetricRuleMappingModal = async function() {
    if (copyingMetricRuleRecord && copyingMetricRuleRecord.kind === 'main') {
        showToast(SLAT('sla.rules.fastMappingMainDisabled'), 'warning');
        return;
    }
    const modal = document.getElementById('metric-rule-mapping-modal');
    if (modal) {
        const text = await loadMetricRuleFastMappingTemplate();
        renderMetricRuleMappingTemplateRows(parseMetricRuleMappingText(text));
        modal.style.display = 'flex';
    }
};

window.closeMetricRuleMappingModal = function() {
    const modal = document.getElementById('metric-rule-mapping-modal');
    if (modal) modal.style.display = 'none';
};

window.saveAndApplyMetricRuleMapping = async function() {
    const text = serializeMetricRuleMappingTemplateRows();

    try {
        if (typeof API !== 'undefined' && API.put) {
            await API.put('/api/sla/rule-templates/fast-mapping', { text });
        }
        metricRuleFastMappingTemplateText = text;
        window.metricRuleFastMappingTemplateText = text;
    } catch (e) {
        console.error('Failed to save fast mapping template', e);
        showToast(SLAT('sla.rules.fastMappingSaveFail', { message: e.message || e }), 'error');
        return;
    }

    closeMetricRuleMappingModal();
    applyParsedMappingText(text);
};

window.directApplyMetricRuleMapping = async function() {
    if (copyingMetricRuleRecord && copyingMetricRuleRecord.kind === 'main') {
        showToast(SLAT('sla.rules.fastMappingMainDisabled'), 'warning');
        return;
    }
    const text = metricRuleFastMappingTemplateText || await loadMetricRuleFastMappingTemplate();
    if (!text) {
        showToast(SLAT('sla.rules.fastMappingMissingTemplate'), 'warning');
        return;
    }
    applyParsedMappingText(text);
};

function applyParsedMappingText(text) {
    const mappings = parseMetricRuleMappingText(text);

    if (mappings.length === 0) {
        showToast(SLAT('sla.rules.fastMappingParseEmpty'), 'warning');
        return;
    }

    window.currentCopyMappings = mappings;
    const countInput = document.getElementById('metric-rule-copy-count');
    if (countInput) {
        countInput.value = mappings.length;
    }
    renderMetricRuleCopyRows();
    window.currentCopyMappings = [];
    showToast(SLAT('sla.rules.fastMappingApplied', { count: mappings.length }), 'success');
}

function findMetricRuleCopyParent(parentValue) {
    const [scope, key, ruleId] = String(parentValue || '').split('|');
    if (scope === 'current') {
        const state = AppState && AppState[key];
        const parent = state?.customMetrics?.find(rule => rule.id === ruleId);
        return parent ? { scope, secId: key, parent } : null;
    }
    if (scope === 'saved') {
        const pref = cachedMetricRulePrefs && cachedMetricRulePrefs[key];
        const parent = pref?.customMetrics?.find(rule => rule.id === ruleId);
        return parent ? { scope, prefKey: key, parent } : null;
    }
    return null;
}

window.saveMetricRuleCopies = async function() {
    if (!copyingMetricRuleRecord) return;
    const record = copyingMetricRuleRecord;
    const ref = findMetricRuleRef(record);
    if (!ref || !ref.rule) {
        showToast(SLAT('sla.rules.saveMissing'), 'error');
        return;
    }

    const rows = readMetricRuleCopyRows();
    if (!rows.length) return;

    const allRecords = typeof collectMetricRuleRecords === 'function' ? collectMetricRuleRecords() : latestMetricRuleRecords || [];
    const allExistingLabels = new Set();
    const existingSignatures = new Set();

    allRecords.forEach(r => {
        const ref = typeof findMetricRuleRef === 'function' ? findMetricRuleRef(r) : null;
        if (ref && ref.rule) {
            if (ref.rule.label) {
                allExistingLabels.add(ref.rule.label);
            }
            if (r.kind === 'sub') {
                const rType = ref.rule.type || 'extract';
                const sig = [
                    rType,
                    ref.rule.category || r.category || '',
                    r.parentRuleId || '',
                    ref.rule.colX || '',
                    ref.rule.valY || '',
                    ref.rule.colZ || '',
                    (rType === 'extract' || rType === 'extract_multi') ? '' : (ref.rule.valK || ''),
                    rType === 'extract_multi' ? (ref.rule.aggregation || 'sum') : '',
                    rType === 'extract_multi' ? (ref.rule.filterLogic || 'and') : '',
                    metricRuleConditionsSignature(ref.rule.conditions)
                ].join('||');
                existingSignatures.add(sig);
            }
        }
    });

    const newLabels = new Set();
    const newSignatures = new Set();

    for (const row of rows) {
        if (!row.label && record.kind === 'main') { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}${SLAT('sla.rules.needName')}`, 'warning'); return; }

        if (record.kind === 'main') {
            if (allExistingLabels.has(row.label)) { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}指标名称「${escapeHTML(row.label)}」已存在，请修改`, 'warning'); return; }
            if (newLabels.has(row.label)) { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}批量复制中包含了重复的指标名称「${escapeHTML(row.label)}」`, 'warning'); return; }
            newLabels.add(row.label);
        } else if (record.kind === 'sub') {
            const parentId = (row.parent || '').split('|')[2] || '';
            const rowType = row.type || 'extract';
            const sig = [
                rowType,
                row.category || '',
                parentId,
                row.colX || '',
                row.valY || '',
                row.colZ || '',
                (rowType === 'extract' || rowType === 'extract_multi') ? '' : (row.valK || ''),
                rowType === 'extract_multi' ? (ref.rule.aggregation || 'sum') : '',
                rowType === 'extract_multi' ? (ref.rule.filterLogic || 'and') : '',
                metricRuleConditionsSignature(row.conditions)
            ].join('||');

            if (existingSignatures.has(sig)) {
                showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}复制的规则与现有规则完全一致，请修改条件或字段`, 'warning'); return;
            }
            if (newSignatures.has(sig)) {
                showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}批量复制中包含完全相同的规则配置，请修改`, 'warning'); return;
            }
            newSignatures.add(sig);
        }

        if (!row.colZ) { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}${SLAT('sla.rules.needColZ')}`, 'warning'); return; }
        if ((row.type === 'extract' || row.type === 'extract_multi') && (!row.colX || !row.valY)) { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}${SLAT('sla.rules.needExtractFields')}`, 'warning'); return; }
        if (row.type !== 'extract' && row.type !== 'extract_multi' && !row.valK) { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}${SLAT('sla.rules.needStatValue')}`, 'warning'); return; }
        if (record.kind === 'sub' && !row.parent) { showToast(`${SLAT('sla.rules.copyRowPrefix', { index: row.index })}${SLAT('sla.rules.notFoundParent')}`, 'warning'); return; }
    }

    const changedCurrentSecIds = new Set();
    let changedSaved = false;
    try {
        rows.forEach(row => {
            const copied = cloneMetricRuleForCopy(ref.rule, record, row);
            if (record.kind === 'main') {
                if (record.origin === '当前导入') {
                    const state = AppState[record.parentSecId];
                    if (!state) throw new Error(SLAT('sla.rules.copyMissingTarget'));
                    if (!state.customMetrics) state.customMetrics = [];
                    state.customMetrics.push(copied);
                    changedCurrentSecIds.add(record.parentSecId);
                } else {
                    const pref = cachedMetricRulePrefs && cachedMetricRulePrefs[record.prefKey];
                    if (!pref) throw new Error(SLAT('sla.rules.copyMissingTarget'));
                    if (!pref.customMetrics) pref.customMetrics = [];
                    pref.customMetrics.push(copied);
                    changedSaved = true;
                }
                return;
            }

            const target = findMetricRuleCopyParent(row.parent);
            if (!target) throw new Error(SLAT('sla.rules.notFoundParent'));
            if (!target.parent.subMetrics) target.parent.subMetrics = [];
            target.parent.subMetrics.push(copied);
            if (target.scope === 'current') changedCurrentSecIds.add(target.secId);
            else changedSaved = true;
        });

        for (const secId of changedCurrentSecIds) {
            if (AppState[secId]) {
                await SLAPrefs.savePrefs(secId);
                renderMetricList(secId);
            }
        }
        if (changedCurrentSecIds.size) {
            evaluateAllMetrics();
            updateAllMetricRuleSummaries();
            if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(AppState || {}));
        }
        if (changedSaved) await persistSavedMetricRuleConfig();

        closeMetricRuleCopyModal();
        await refreshMetricRulePrefsCache();
        renderAllMetricRules();
        showToast(SLAT('sla.rules.copySavedToast', { count: rows.length }));
    } catch (e) {
        console.error('[SLA Metric Rules] 复制规则失败:', e);
        showToast(SLAT('sla.rules.copyFail', { message: e.message || e }), 'error');
    }
};

window.deleteMetricRuleFromOverview = async function(index) {
    const record = latestMetricRuleRecords[index];
    if (!record) return;
    const ref = findMetricRuleRef(record);
    if (!ref || !ref.rule) {
        showToast('未找到这条规则，请刷新后重试。', 'warning');
        return;
    }

    const ruleName = record.kind === 'main'
        ? record.parentMetricName
        : `[${record.category}] ${record.subMetricName}`;
    const extra = record.kind === 'main'
        ? '主指标下的子指标也会一起删除。'
        : '仅删除这一条子指标挂载。';
    if (!await AppDialog.confirm(`确认删除规则「${ruleName}」吗？\n${extra}`, { title: '删除指标规则', tone: 'danger', confirmText: '删除' })) return;

    try {
        if (record.origin === '当前导入') {
            const state = AppState[record.parentSecId];
            if (!state) throw new Error('当前页面未找到对应表格状态');
            if (record.kind === 'main') {
                state.customMetrics = (state.customMetrics || []).filter(rule => rule.id !== record.parentRuleId);
            } else {
                const parent = (state.customMetrics || []).find(rule => rule.id === record.parentRuleId);
                if (!parent || !parent.subMetrics) throw new Error('未找到对应子指标');
                parent.subMetrics.splice(record.subIndex, 1);
            }
            await SLAPrefs.savePrefs(record.parentSecId);
            renderMetricList(record.parentSecId);
            evaluateAllMetrics();
            updateAllMetricRuleSummaries();
            if (window.refreshSLAHighlightViews) window.refreshSLAHighlightViews(Object.keys(AppState || {}));
        } else {
            const pref = cachedMetricRulePrefs && cachedMetricRulePrefs[record.prefKey];
            if (!pref) throw new Error('未找到已保存配置');
            if (record.kind === 'main') {
                pref.customMetrics = (pref.customMetrics || []).filter(rule => rule.id !== record.parentRuleId);
            } else {
                const parent = (pref.customMetrics || []).find(rule => rule.id === record.parentRuleId);
                if (!parent || !parent.subMetrics) throw new Error('未找到对应子指标');
                parent.subMetrics.splice(record.subIndex, 1);
            }
            await persistSavedMetricRuleConfig();
        }
        await removeMetricRuleTarget(record, ref.rule);
        await refreshMetricRulePrefsCache();
        renderAllMetricRules();
        showToast('指标规则已删除。');
    } catch (e) {
        console.error('[SLA Metric Rules] 删除规则失败:', e);
        showToast(`删除失败：${e.message || e}`, 'error');
    }
};

window.openMetricRulesModal = async function() {
    const modal = document.getElementById('metric-rules-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    const search = document.getElementById('metric-rules-search');
    if (search) search.value = '';
    const crossOnly = document.getElementById('metric-rules-cross-only');
    if (crossOnly) crossOnly.checked = false;
    const monthlyOnly = document.getElementById('metric-rules-monthly-only');
    if (monthlyOnly) monthlyOnly.checked = false;
    const list = document.getElementById('metric-rules-modal-list');
    if (list) list.innerHTML = `<div class="metric-rules-empty">${SLAT('sla.rules.loading')}</div>`;
    await Promise.all([
        refreshMetricRulePrefsCache(),
        loadMetricRuleFastMappingTemplate()
    ]);
    renderAllMetricRules();
};

window.closeMetricRulesModal = function() {
    const modal = document.getElementById('metric-rules-modal');
    if (modal) modal.style.display = 'none';
};

window.addEventListener('tools:languagechange', () => {
    const modal = document.getElementById('metric-rules-modal');
    if (modal && modal.style.display === 'flex') renderAllMetricRules();
    const editModal = document.getElementById('metric-rule-edit-modal');
    if (editModal && editModal.style.display === 'flex' && editingMetricRuleRecord) {
        document.getElementById('metric-rule-edit-subtitle').textContent = `${getMetricRuleDisplayOrigin(editingMetricRuleRecord.origin)} · ${translateMetricRuleSectionTitle(editingMetricRuleRecord.parentTitle)} · ${editingMetricRuleRecord.kind === 'sub' ? SLAT('sla.rules.sub') : SLAT('sla.rules.main')}`;
        refreshMetricRuleEditorMode();
    }
    const copyModal = document.getElementById('metric-rule-copy-modal');
    if (copyModal && copyModal.style.display === 'flex' && copyingMetricRuleRecord) {
        const index = latestMetricRuleRecords.indexOf(copyingMetricRuleRecord);
        if (index >= 0) openMetricRuleCopyModal(index);
    }
});

window.toggleMetricRuleGroup = function(groupKey) {
    let isExpanding = false;
    if (expandedMetricRuleGroups.has(groupKey)) {
        expandedMetricRuleGroups.delete(groupKey);
    } else {
        expandedMetricRuleGroups.add(groupKey);
        isExpanding = true;
    }
    renderAllMetricRules(isExpanding ? groupKey : null);
};

window.renderAllMetricRules = function(justExpandedGroupKey = null) {
    const list = document.getElementById('metric-rules-modal-list');
    if (!list) return;
    const wrap = list.querySelector('.metric-rules-table-wrap');
    const savedScrollTop = wrap ? wrap.scrollTop : 0;
    const term = (document.getElementById('metric-rules-search')?.value || '').trim().toLowerCase();
    const crossOnly = Boolean(document.getElementById('metric-rules-cross-only')?.checked);
    const monthlyOnly = Boolean(document.getElementById('metric-rules-monthly-only')?.checked);
    const allFilteredRecords = collectMetricRuleRecords().filter(record => {
        if (monthlyOnly && record.rule?.createdFrom !== 'monthly-designer') return false;
        if (crossOnly && !record.isCrossTable) return false;
        if (!term) return true;
        return (record.searchText || '').includes(term);
    });

    if (!allFilteredRecords.length) {
        list.innerHTML = `<div class="metric-rules-empty">${SLAT('sla.rules.empty')}</div>`;
        return;
    }

    allFilteredRecords.sort((a, b) => (
        `${a.parentTitle}|${a.parentMetricName}|${a.kind}|${a.category}`.localeCompare(`${b.parentTitle}|${b.parentMetricName}|${b.kind}|${b.category}`, 'zh-CN')
    ));

    const allRecords = collectMetricRuleRecords();
    const currentCount = allRecords.filter(r => r.origin === '当前导入').length;
    const savedCount = allRecords.filter(r => r.origin === '已保存配置').length;
    const crossCount = allRecords.filter(r => r.isCrossTable).length;
    const grouped = new Map();
    allFilteredRecords.forEach(record => {
        const groupKey = getMetricRuleGroupKey(record);
        if (!grouped.has(groupKey)) grouped.set(groupKey, { main: null, subs: [] });
        const bucket = grouped.get(groupKey);
        if (record.kind === 'main') bucket.main = record;
        else bucket.subs.push(record);
    });

    const baseRecords = collectMetricRuleRecords();
    grouped.forEach((bucket, groupKey) => {
        if (bucket.main) return;
        const fallback = baseRecords.find(record => record.kind === 'main' && getMetricRuleGroupKey(record) === groupKey);
        if (fallback) bucket.main = fallback;
    });

    latestMetricRuleRecords = [];
    const rowParts = [];
    grouped.forEach((bucket, groupKey) => {
        if (!bucket.main) return;
        const mainRecord = bucket.main;
        const matchedSubCount = bucket.subs.length;
        const totalSubCount = baseRecords.filter(record => record.kind === 'sub' && getMetricRuleGroupKey(record) === groupKey).length;
        const shouldAutoExpand = Boolean(term && matchedSubCount > 0 && !mainRecord.searchText.includes(term));
        const isExpanded = expandedMetricRuleGroups.has(groupKey) || shouldAutoExpand;
        const mainIndex = latestMetricRuleRecords.push(mainRecord) - 1;
        const mainActionHtml = `
            <div class="metric-rule-actions">
                <button class="metric-rule-view-btn" onclick="jumpToMetricRuleTable('${mainRecord.sourceSecId}', '${escapeHTML(mainRecord.sourceTitle)}')">${SLAT('sla.rules.view')}</button>
                <button class="metric-rule-edit-btn" onclick="openMetricRuleEditor(${mainIndex})">${SLAT('sla.rules.edit')}</button>
                <button class="metric-rule-copy-btn" onclick="openMetricRuleCopyModal(${mainIndex})">${SLAT('sla.rules.copy')}</button>
                <button class="metric-rule-mini-danger" onclick="deleteMetricRuleFromOverview(${mainIndex})">${SLAT('sla.rules.delete')}</button>
            </div>
        `;
        rowParts.push(`
            <tr class="metric-rule-main-row ${mainRecord.rule?.createdFrom === 'monthly-designer' ? 'metric-rule-monthly-row' : ''} ${totalSubCount ? 'has-children' : ''}">
                <td>
                    <div class="metric-rule-tree-head">
                        ${totalSubCount ? `<button class="metric-rule-expand-btn ${isExpanded ? 'expanded' : ''}" onclick="toggleMetricRuleGroup('${escapeHTML(groupKey)}')" title="${isExpanded ? SLAT('sla.rules.collapse') : SLAT('sla.rules.expand')}">${isExpanded ? '▾' : '▸'}</button>` : '<span class="metric-rule-expand-placeholder"></span>'}
                        ${renderMetricRuleLineage(mainRecord)}
                    </div>
                </td>
                <td title="${escapeHTML(mainRecord.tableTitle)}">${escapeHTML(translateMetricRuleSectionTitle(mainRecord.tableTitle))}</td>
                <td title="${escapeHTML(mainRecord.filePrefixTitle)}"><span class="metric-rule-prefix">${escapeHTML(mainRecord.filePrefixText)}</span></td>
                <td>${mainRecord.rule?.createdFrom === 'monthly-designer' ? `<span class="metric-rule-badge monthly">${SLAT('sla.rules.monthlyOrigin')}</span>` : ''}<span class="metric-rule-badge ${mainRecord.origin === '当前导入' ? 'main' : 'saved'}">${escapeHTML(getMetricRuleDisplayOrigin(mainRecord.origin))}</span></td>
                <td><span class="metric-rule-badge main">${SLAT('sla.rules.main')}</span>${totalSubCount ? `<span class="metric-rule-child-count">${matchedSubCount === totalSubCount ? totalSubCount : `${matchedSubCount}/${totalSubCount}`} ${SLAT('sla.rules.childUnit')}</span>` : ''}</td>
                <td title="${escapeHTML(mainRecord.parentMetricName)}"><strong>${escapeHTML(translateMetricRuleLabel(mainRecord.parentMetricName))}</strong></td>
                <td><span class="metric-rule-muted">${SLAT('sla.rules.folded')}</span></td>
                <td><span class="metric-rule-type">${escapeHTML(mainRecord.typeText)}</span></td>
                <td title="${escapeHTML(mainRecord.conditionText)}">${mainRecord.conditionText}</td>
                <td title="${escapeHTML(mainRecord.resultText)}">${mainRecord.resultText}</td>
                <td title="${escapeHTML(mainRecord.relationText)}">${escapeHTML(mainRecord.relationText)}</td>
                <td>${mainActionHtml}</td>
            </tr>
        `);
        if (!isExpanded) return;
        bucket.subs.forEach(record => {
            const index = latestMetricRuleRecords.push(record) - 1;
            const actionHtml = `
                <div class="metric-rule-actions">
                    <button class="metric-rule-view-btn" onclick="jumpToMetricRuleTable('${record.sourceSecId}', '${escapeHTML(record.sourceTitle)}')">${SLAT('sla.rules.view')}</button>
                    <button class="metric-rule-edit-btn" onclick="openMetricRuleEditor(${index})">${SLAT('sla.rules.edit')}</button>
                    <button class="metric-rule-copy-btn" onclick="openMetricRuleCopyModal(${index})">${SLAT('sla.rules.copy')}</button>
                    <button class="metric-rule-mini-danger" onclick="deleteMetricRuleFromOverview(${index})">${SLAT('sla.rules.delete')}</button>
                </div>
            `;
            rowParts.push(`
                <tr class="metric-rule-child-row ${record.isCrossTable ? 'metric-rule-cross-row' : ''} ${groupKey === justExpandedGroupKey ? 'metric-rule-just-expanded' : ''}">
                    <td>${renderMetricRuleLineage(record)}</td>
                    <td title="${escapeHTML(record.tableTitle)}">${escapeHTML(translateMetricRuleSectionTitle(record.tableTitle))}</td>
                    <td title="${escapeHTML(record.filePrefixTitle)}"><span class="metric-rule-prefix">${escapeHTML(record.filePrefixText)}</span></td>
                    <td><span class="metric-rule-badge ${record.origin === '当前导入' ? 'main' : 'saved'}">${escapeHTML(getMetricRuleDisplayOrigin(record.origin))}</span></td>
                    <td><span class="metric-rule-badge sub">${record.isCrossTable ? SLAT('sla.rules.crossSub') : SLAT('sla.rules.sub')}</span></td>
                    <td title="${escapeHTML(record.parentMetricName)}"><strong>${escapeHTML(translateMetricRuleLabel(record.parentMetricName))}</strong></td>
                    <td title="${escapeHTML(record.subMetricName)}"><span class="metric-rule-category">[${escapeHTML(translateMetricRuleLabel(record.category))}]</span>${escapeHTML(translateMetricRuleLabel(record.subMetricName))}</td>
                    <td><span class="metric-rule-type">${escapeHTML(record.typeText)}</span></td>
                    <td title="${escapeHTML(record.conditionText)}">${record.conditionText}</td>
                    <td title="${escapeHTML(record.resultText)}">${record.resultText}</td>
                    <td title="${escapeHTML(record.relationText)}">${escapeHTML(record.relationText)}</td>
                    <td>${actionHtml}</td>
                </tr>
            `);
        });
    });

    const rows = rowParts.join('');

    list.innerHTML = `
        <div class="metric-rules-summary">
            <span>${SLAT('sla.rules.summaryShown', { count: latestMetricRuleRecords.length })}</span>
            <span>${SLAT('sla.rules.summaryCurrent', { count: currentCount })}</span>
            <span>${SLAT('sla.rules.summarySaved', { count: savedCount })}</span>
            <span>${SLAT('sla.rules.summaryCross', { count: crossCount })}</span>
            <span class="metric-rule-muted">${SLAT('sla.rules.summaryHint')}</span>
        </div>
        <div class="metric-rules-table-wrap">
            <table class="metric-rules-table">
                <thead>
                    <tr>
                        <th>${SLAT('sla.rules.thLineage')}</th>
                        <th>${SLAT('sla.rules.thTable')}</th>
                        <th>${SLAT('sla.rules.thFilePrefix')}</th>
                        <th>${SLAT('sla.rules.thSource')}</th>
                        <th>${SLAT('sla.rules.thRuleType')}</th>
                        <th>${SLAT('sla.rules.thMainMetric')}</th>
                        <th>${SLAT('sla.rules.thSubMetric')}</th>
                        <th>${SLAT('sla.rules.thMode')}</th>
                        <th>${SLAT('sla.rules.thCondition')}</th>
                        <th>${SLAT('sla.rules.thResult')}</th>
                        <th>${SLAT('sla.rules.thRelation')}</th>
                        <th>${SLAT('sla.rules.thAction')}</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;

    if (savedScrollTop > 0) {
        const newWrap = list.querySelector('.metric-rules-table-wrap');
        if (newWrap) newWrap.scrollTop = savedScrollTop;
    }
};

function renderMetricList(secId) {
    const state = AppState[secId];
    const list = document.getElementById(`m-list-${secId}`);
    const inboundRecords = getInboundSubMetricRecords(secId);
    if (!state.customMetrics.length && !inboundRecords.length) {
        list.innerHTML = `<div style="color:#aaa;font-size:12px;text-align:center;">${SLAT('sla.section.noRules')}</div>`;
        return;
    }

    let html = '';
    state.customMetrics.forEach(r => {
        let subHtml = '';
        if (r.subMetrics && r.subMetrics.length > 0) {
            subHtml = `<div style="margin-top:6px; padding-left: 10px; border-left: 2px solid #e1bee7;">`;
            r.subMetrics.forEach((sm, idx) => {
                let sourceNote = (sm.scope === 'all')
                    ? `<span style="color:#7b1fa2;font-weight:bold;">${SLAT('sla.section.crossNote')}</span> `
                    : ((sm.sourceSecId && sm.sourceSecId !== secId)
                        ? `<span style="color:#d32f2f;font-weight:bold;">${SLAT('sla.section.crossSource', { title: escapeHTML(AppState[sm.sourceSecId]?.title || sm.sourceSecId) })}</span> `
                        : '');
                const smLabel = getMetricRuleDisplayLabel(sm, r);
                let smDesc = describeMetricRule(sm);

                subHtml += `
                <div style="font-size:11px; color:#555; background: #fafafa; padding: 6px; padding-right: 80px; margin-bottom: 4px; border-radius: 4px; position: relative;">
                    <div style="position:absolute; right:6px; top:6px; display:flex; gap:6px;">
                        <button onclick="openMetricRuleEditorById('${secId}', '${r.id}', ${idx})" style="border:none; background:none; color:#1976d2; cursor:pointer;">${SLAT('sla.section.ruleEdit')}</button>
                        <button onclick="deleteSubMetricRule('${secId}', '${r.id}', ${idx})" style="border:none; background:none; color:#d32f2f; cursor:pointer;">${SLAT('sla.section.ruleDelete')}</button>
                    </div>
                    <b>[${escapeHTML(sm.category || SLAT('sla.section.uncategorized'))}] ${escapeHTML(smLabel)}</b> ${sourceNote}: <br/>${smDesc}
                </div>`;
            });
            subHtml += `</div>`;
        }

        let rDesc = '';
        rDesc = describeMetricRule(r).replace(' ➔ ', ' <br>➔ ');
        const crossBadge = r.scope === 'all'
            ? ` <span style="background:#f3e5f5; color:#7b1fa2; font-size:11px; padding:1px 6px; border-radius:10px; font-weight:normal; margin-left:6px;">${SLAT('sla.section.crossBadge')}</span>`
            : '';

        html += `
        <div class="rule-config-item" style="border-bottom: 1px dashed #eee; padding-bottom: 8px; margin-bottom: 8px;">
            <div style="display:flex; justify-content: space-between; align-items: center;">
                <div style="font-weight:bold;color:#4a90e2;font-size:13px;">[${escapeHTML(getMetricRuleDisplayLabel(r))}]${crossBadge}</div>
                <div>
                    <button class="action-btn" onclick="openMetricRuleEditorById('${secId}', '${r.id}')" style="font-size:11px; padding:2px 6px; background:#e3f2fd; color:#1565c0; margin-right:6px;">${SLAT('sla.section.ruleEdit')}</button>
                    <button class="action-btn" onclick="deleteMetricRule('${secId}', '${r.id}')" style="font-size:11px; padding:2px 6px; background:#ffebee; color:#c62828;">${SLAT('sla.section.ruleDelete')}</button>
                </div>
            </div>
            <div style="font-size:11px;color:#666;margin-top:4px;">${rDesc}</div>
            ${subHtml}
        </div>`;
    });
    if (inboundRecords.length) {
        html += `
            <div style="margin-top: 10px; padding: 8px; border: 1px dashed #ccc; border-radius: 8px; background: #fafafa;">
                <div style="margin-bottom: 7px; color: #1976d2; font-size: 12px; font-weight: bold;">${SLAT('sla.section.inboundHeader')}</div>
                ${inboundRecords.map(record => renderMetricRuleCard(record, { allowEdit: true, allowDelete: true })).join('')}
            </div>
        `;
    }
    list.innerHTML = html;
    updateMetricRuleSummary(secId);
}

document.addEventListener('click', e => {
    document.querySelectorAll('.dropdown-menu.show').forEach(menu => {
        const secId = menu.id.split('-').pop();
        const b1 = document.getElementById(`settings-btn-${secId}`);
        const b2 = document.getElementById(`copy-btn-${secId}`);
        const b3 = document.getElementById(`metrics-btn-${secId}`);
        if (!menu.contains(e.target) && e.target !== b1 && e.target !== b2 && e.target !== b3) {
            menu.classList.remove('show');
            const sec = document.getElementById(`section-${secId}`);
            if (sec) sec.style.zIndex = '1';
        }
    });
});

window.SLAEvents = { bindEvents };
window.bindEvents = bindEvents;
