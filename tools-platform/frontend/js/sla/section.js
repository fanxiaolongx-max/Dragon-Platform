/**
 * sla/section.js - 表格区块初始化、数据预处理、DOM 渲染
 */

const AppState = {};
const RuleDataContextCache = new Map();
window.GlobalMetrics = {};
window.GlobalTargets = {};

// 初始化 GlobalTargets（从服务端加载）
async function initGlobalTargets() {
    try {
        const mode = API.getSourceMode('sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
        window.GlobalTargets = await API.get(`/api/sla/targets${query}`);
        if (window.renderSLASourcePanel) window.renderSLASourcePanel();
    } catch (e) {}
}

function escapeHTML(str) {
    return typeof str === 'string' ? str.replace(/[&<>'"]/g, tag => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'": '&#39;','"':'&quot;'}[tag]||tag)) : str;
}
function getCompatibleVal(row, keys) {
    for (const key of keys) { if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key].toString().trim(); }
    return '';
}
window.escapeHTML = escapeHTML;
window.getCompatibleVal = getCompatibleVal;

// Priority cols and hash fn are accessed via SLAUpload.*

function parseFlexibleDate(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date && !isNaN(value)) return value;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = raw
        .replace(/\u00a0/g, ' ')
        .replace(/\./g, '/')
        .replace(/-/g, '/')
        .replace('T', ' ')
        .replace(/Z$/, '');
    const date = new Date(normalized);
    return isNaN(date) ? null : date;
}

function shouldInspectDateCell(columnName, value) {
    const col = String(columnName || '').toLowerCase();
    const raw = String(value || '').trim();
    if (!raw) return false;
    if (/month|year|月份|年度|年份/.test(col)) return false;
    const dateColumn = /(date|time|日期|时间|创建|创单|期望|要求完成|关闭|完成|create|open|close|due|end|completion|plan|start|survey)/i.test(col);
    const concreteDateValue = (
        /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(raw) ||
        /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(raw) ||
        /\d{4}-\d{1,2}-\d{1,2}T\d{1,2}:\d{1,2}/.test(raw)
    );
    return dateColumn && concreteDateValue;
}

function recordDateParseIssue(state, rowIndex, columnName, value, usage) {
    if (!state || value === undefined || value === null || value === '') return;
    if (!state.dateParseIssues) state.dateParseIssues = [];
    if (!state._dateParseIssueKeys) state._dateParseIssueKeys = new Set();
    const raw = String(value).trim();
    if (!raw) return;
    const key = `${rowIndex}@@${raw}`;
    if (state._dateParseIssueKeys.has(key)) return;
    state._dateParseIssueKeys.add(key);
    state.dateParseIssues.push({
        rowNumber: rowIndex + 2,
        column: columnName,
        value: raw,
        usage: usage || '疑似日期字段'
    });
}

function parseDateForSLA(state, rowIndex, columnName, value, usage) {
    const date = parseFlexibleDate(value);
    if (!date) recordDateParseIssue(state, rowIndex, columnName, value, usage);
    return date;
}

function inspectDateLikeCells(state, row, rowIndex) {
    Object.entries(row || {}).forEach(([column, value]) => {
        if (shouldInspectDateCell(column, value) && !parseFlexibleDate(value)) {
            recordDateParseIssue(state, rowIndex, column, value, '疑似日期字段');
        }
    });
}

function buildDateParseWarningHTML(secId) {
    const state = AppState[secId];
    const issues = (state && state.dateParseIssues) || [];
    if (!issues.length) return '';
    const examples = issues.slice(0, 3).map(i => `${escapeHTML(i.column)}=${escapeHTML(i.value)}`).join('；');
    const detail = issues.slice(0, 50).map(i =>
        `<div class="date-warning-row">第 ${i.rowNumber} 行 · ${escapeHTML(i.column)} · ${escapeHTML(i.usage)}<br><code>${escapeHTML(i.value)}</code></div>`
    ).join('');
    const more = issues.length > 50 ? `<div class="date-warning-more">仅展示前 50 条，剩余 ${issues.length - 50} 条请优先检查原始表日期格式。</div>` : '';
    return `
        <div class="date-parse-warning" id="date-warning-${secId}">
            <span class="date-warning-icon">⚠️</span>
            <span><b>发现 ${issues.length} 个日期值未能解析</b>，这些单元格可能影响 SLA/超期判断。建议格式：2026/05/02 19:03 或 2026-05-02 19:03。</span>
            <span class="date-warning-example">示例：${examples}</span>
            <span class="date-warning-help">悬停查看明细</span>
            <div class="date-warning-tooltip">${detail}${more}</div>
        </div>`;
}

function getSectionRuleDetails(mode) {
    const configuredRiskItems = window.SLARiskRules && typeof window.SLARiskRules.describeConfig === 'function'
        ? [
            '文件前缀：PBI_自动抓取-风险详单_Latest',
            ...window.SLARiskRules.describeConfig()
        ]
        : [
            '文件前缀：PBI_自动抓取-风险详单_Latest',
            '检查状态字段优先级：风险状态 -> risk_status',
            'Risk Confirming：创单时间 + 30天',
            'Risk Open / Risk Suspended / Complete Reviewing：按 ticket_close_due_date 倒计时',
            '告警分级：剩余 <= 10 天标红，剩余 < 30 天标紫'
        ];
    const rules = {
        rectification: {
            title: '整改详单规则',
            tone: '#1976d2',
            items: [
                '文件前缀：PBI_自动抓取-整改详单_整改_Latest',
                '检查状态字段：task_status；取值规则：只检查这一列',
                'Checking：task_create_time + 30天，剩余 <= 10 天标红，剩余 < 30 天标黄',
                'Rectification Implementation：按 rectify_plan_end_time 倒计时，剩余 <= 10 天标红，剩余 < 82 天标黄',
                '关键列：task_status / task_create_time / rectify_plan_end_time'
            ]
        },
        special: {
            title: 'CPT专项风险规则',
            tone: '#00796b',
            items: [
                '文件前缀：PBI_自动抓取-CPT风险详表_Latest',
                '检查状态字段优先级：状态-Status -> task_status_en -> task_status -> task_status_cn；取值规则：按顺序取第一个非空值为准',
                '待确认/草稿/Draft/To Be Confirmed/Confirm/Confirming：创建日期 + 30天，剩余 <= 10 天标红，剩余 < 30 天标青',
                '处理中/评审中/Processing/Reviewing：按要求完成日期倒计时，剩余 <= 10 天标红，剩余 < 30 天标青',
                '关键列：状态-Status / 创建日期-Create Date / 要求完成日期-Required Completion Date'
            ]
        },
        risk: {
            title: '常规风险规则',
            tone: '#7b1fa2',
            items: configuredRiskItems
        },
        sr: {
            title: 'SR详单规则',
            tone: '#d9480f',
            items: [
                '文件前缀：PBI_自动抓取-详单-SR_Latest',
                '检查状态字段：sr_status_name；取值规则：只检查这一列；同时读取 hw_sev_name / urgency 判断 Critical 等级，读取 overdue 判断上游超期标识',
                '在途单：以 exp_close_date 为唯一截止基准；有 sus_exp_close_date 时按挂起后期望关闭时间判断',
                'Pending/Suspend/Hold/挂起：忽略预警，上游每天顺延期望关闭时间',
                '已关闭单：act_close_date 晚于 exp_close_date 或上游 overdue=Y 计为历史超期；如挂起后未超期则单独标识',
                'Critical：消耗 > 85% 或剩余 < 12小时标红；消耗 > 70% 且剩余 < 48小时标黄；其他在途单消耗 > 95% 标红，> 80% 标黄'
            ]
        },
        vulnerability: {
            title: '漏洞预警详单规则',
            tone: '#c2410c',
            items: [
                '文件前缀：PBI_自动抓取-详单漏洞_漏洞预警_Latest',
                '检查状态字段：task_status；取值规则：只检查这一列',
                '状态范围：Checking / Communication Dept / Communication Customer',
                '建单基准：create_time 或 task_create_time + 30天',
                '剩余 <= 10 天标红，剩余 < 30 天标黄',
                '关键列：task_status / create_time / task_create_time'
            ]
        }
    };
    if (mode !== 'risk' && window.SLAOtherRules && window.SLAOtherRules.SUPPORTED_MODES.includes(mode)) {
        const prefixes = {
            rectification: 'PBI_自动抓取-整改详单_整改_Latest',
            special: 'PBI_自动抓取-CPT风险详表_Latest',
            sr: 'PBI_自动抓取-详单-SR_Latest',
            vulnerability: 'PBI_自动抓取-详单漏洞_漏洞预警_Latest'
        };
        rules[mode].items = [`文件前缀：${prefixes[mode]}`, ...window.SLAOtherRules.describeConfig(mode)];
    }
    return rules[mode] || null;
}

function buildSectionRuleHTML(mode) {
    const rule = getSectionRuleDetails(mode);
    if (!rule) return '';
    const items = rule.items.map(item => `<li>${escapeHTML(item)}</li>`).join('');
    return `<div class="section-rule-panel" style="--section-rule-color:${escapeHTML(rule.tone)}">
        <div class="section-rule-title">${escapeHTML(rule.title)}</div>
        <ul>${items}</ul>
    </div>`;
}

function ensureSectionRuleModal() {
    let modal = document.getElementById('section-rule-config-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'section-rule-config-modal';
    modal.className = 'modal-overlay section-rule-config-modal';
    modal.innerHTML = `
        <div class="modal-content section-rule-config-content" role="dialog" aria-modal="true" aria-labelledby="section-rule-config-title">
            <div class="modal-header section-rule-config-header">
                <div>
                    <h3 id="section-rule-config-title">规则配置</h3>
                    <div class="section-rule-config-subtitle" id="section-rule-config-subtitle">当前为只读配置</div>
                </div>
                <button class="modal-close" type="button" aria-label="关闭" onclick="closeSectionRuleModal()">✖</button>
            </div>
            <div class="modal-body section-rule-config-body" id="section-rule-config-body"></div>
            <div class="modal-footer section-rule-config-footer">
                <span id="section-rule-config-status">规则修改功能将在后续版本开放</span>
                <div id="section-rule-config-actions"><button class="btn-save section-rule-config-close" type="button" onclick="closeSectionRuleModal()">关闭</button></div>
            </div>
        </div>`;
    modal.addEventListener('click', event => {
        if (event.target === modal) closeSectionRuleModal();
    });
    document.body.appendChild(modal);
    return modal;
}

async function openSectionRuleModal(mode) {
    const rule = getSectionRuleDetails(mode);
    if (!rule) return;
    const modal = ensureSectionRuleModal();
    const title = document.getElementById('section-rule-config-title');
    const body = document.getElementById('section-rule-config-body');
    const subtitle = document.getElementById('section-rule-config-subtitle');
    const status = document.getElementById('section-rule-config-status');
    const actions = document.getElementById('section-rule-config-actions');
    if (title) title.textContent = `⚙️ ${rule.title}`;
    modal.style.setProperty('--section-rule-color', rule.tone);
    const isOtherEditable = window.SLAOtherRules && window.SLAOtherRules.SUPPORTED_MODES.includes(mode);
    modal.classList.toggle('risk-edit-mode', mode === 'risk' || isOtherEditable);
    if (mode === 'risk' && window.SLARiskRules) {
        if (subtitle) subtitle.textContent = '可编辑状态识别条件、截止日期算法和分级告警类型';
        if (status) {
            status.textContent = '正在读取已保存配置…';
            status.classList.remove('error');
        }
        if (actions) actions.innerHTML = `
            <button class="section-rule-secondary-btn" type="button" onclick="SLARiskRules.resetEditor()">恢复默认</button>
            <button class="section-rule-secondary-btn" type="button" onclick="closeSectionRuleModal()">关闭</button>
            <button class="btn-save section-rule-config-save" type="button" onclick="SLARiskRules.saveFromEditor()">保存并应用</button>`;
        modal.style.display = 'flex';
        const config = await window.SLARiskRules.loadConfig();
        window.SLARiskRules.prepareEditor(config);
        if (status) status.textContent = '修改后点击“保存并应用”，当前已导入数据会立即重算';
    } else if (isOtherEditable) {
        if (subtitle) subtitle.textContent = mode === 'sr'
            ? '可编辑字段来源、状态条件、消耗率阈值和所有告警展示类型'
            : '可编辑状态识别条件、截止日期算法，以及每条规则自己的告警分级';
        if (status) {
            status.textContent = '正在读取已保存配置…';
            status.classList.remove('error');
        }
        if (actions) actions.innerHTML = `
            <button class="section-rule-secondary-btn" type="button" onclick="SLAOtherRules.resetEditor()">恢复默认</button>
            <button class="section-rule-secondary-btn" type="button" onclick="closeSectionRuleModal()">关闭</button>
            <button class="btn-save section-rule-config-save" type="button" onclick="SLAOtherRules.saveFromEditor()">保存并应用</button>`;
        modal.style.display = 'flex';
        const config = await window.SLAOtherRules.loadConfig(mode);
        window.SLAOtherRules.prepareEditor(mode, config);
        if (status) status.textContent = '修改后点击“保存并应用”，当前已导入数据会立即重算';
    } else {
        if (subtitle) subtitle.textContent = '当前为只读配置';
        if (status) {
            status.textContent = '这一类规则的可编辑功能将在后续步骤开放';
            status.classList.remove('error');
        }
        if (actions) actions.innerHTML = '<button class="btn-save section-rule-config-close" type="button" onclick="closeSectionRuleModal()">关闭</button>';
        if (body) body.innerHTML = buildSectionRuleHTML(mode);
        modal.style.display = 'flex';
    }
}

function closeSectionRuleModal() {
    const modal = document.getElementById('section-rule-config-modal');
    if (modal) modal.style.display = 'none';
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSectionRuleModal();
});

function getSRStatus(row) {
    return getCompatibleVal(row, ['sr_status_name']).trim();
}

function isSRClosedStatus(statusText) {
    const status = String(statusText || '').toLowerCase();
    return ['closed', 'resolved', 'canceled', 'cancelled'].some(token => status.includes(token));
}

function isSRPendingStatus(statusText) {
    const status = String(statusText || '').toLowerCase();
    return ['pending', 'suspend', 'suspended', 'hold', '挂起'].some(token => status.includes(token));
}

function getSRSeverity(row) {
    const sev = getCompatibleVal(row, ['hw_sev_name', 'urgency']).toLowerCase();
    if (sev.includes('critical') || sev.includes('schedule action') || sev.includes('immediate action')) return 'critical';
    if (sev.includes('major')) return 'major';
    if (sev.includes('minor')) return 'minor';
    return 'normal';
}


// 同一次渲染可能跳过多个区块：合并成一条统一弹窗提示，避免逐个打断或互相覆盖
const skippedSectionMessages = [];
function warnSkippedSection(message) {
    console.warn('[SLA section]', message);
    skippedSectionMessages.push(message);
    if (skippedSectionMessages.length > 1) return;
    setTimeout(() => {
        const text = skippedSectionMessages.splice(0).join('\n');
        AppDialog.alert(text, { title: SLAT('sla.dialog.notice'), tone: 'warning' });
    }, 0);
}
function formatSRDuration(hours) {
    const absHours = Math.abs(Math.ceil(hours || 0));
    if (absHours <= 48) {
        return `${absHours} 小时`;
    }

    const days = Math.ceil(absHours / 24);
    if (days < 7) {
        return `${days} 天`;
    }

    if (days < 30) {
        const weeks = Math.floor(days / 7);
        const remainDays = days % 7;
        return remainDays > 0 ? `${weeks}周${remainDays}天` : `${weeks}周`;
    }

    const months = Math.floor(days / 30);
    const remainDays = days % 30;
    return remainDays > 0 ? `${months}月${remainDays}天` : `${months}月`;
}

async function initSection(secId, mode, title, rawData, themeColor, baseName = '', sourceFiles = [], options = {}) {
    const RECT_P = SLAUpload.RECT_PRIORITY_COLS, RISK_P = SLAUpload.RISK_PRIORITY_COLS, SPEC_P = SLAUpload.SPECIAL_PRIORITY_COLS, SR_P = SLAUpload.SR_PRIORITY_COLS, VULN_P = SLAUpload.VULN_PRIORITY_COLS;
    const riskRuleConfig = mode === 'risk' && window.SLARiskRules
        ? await window.SLARiskRules.loadConfig()
        : null;
    const sectionRuleConfig = mode !== 'risk' && window.SLAOtherRules && window.SLAOtherRules.SUPPORTED_MODES.includes(mode)
        ? await window.SLAOtherRules.loadConfig(mode)
        : null;
    let allHeadersSet = new Set();
    rawData.forEach(row => Object.keys(row).forEach(k => {
        if (!SLAUpload.isRuntimeField || !SLAUpload.isRuntimeField(k)) allHeadersSet.add(k);
    }));
    const allHeaders = Array.from(allHeadersSet);
    const validHeaders = allHeaders.filter(col => rawData.some(row => row[col] !== undefined && row[col] !== null && row[col].toString().trim() !== ''));

    if (sectionRuleConfig) {
        const statusFields = mode === 'sr' ? sectionRuleConfig.fields.status : sectionRuleConfig.statusFields;
        if (!statusFields.some(field => validHeaders.includes(field))) {
            warnSkippedSection(`区块 [${title}] 未找到已配置的状态字段（${statusFields.join(' / ')}），跳过渲染。`);
            return;
        }
    } else if (mode === 'rectification' && !validHeaders.includes('task_status')) { warnSkippedSection(`区块 [${title}] 未找到 task_status，跳过渲染。`); return; }
    if (mode === 'risk') {
        const statusFields = (riskRuleConfig && riskRuleConfig.statusFields) || ['风险状态', 'risk_status'];
        if (!statusFields.some(field => validHeaders.includes(field))) {
            warnSkippedSection(`区块 [${title}] 未找到已配置的状态字段（${statusFields.join(' / ')}），跳过渲染。`);
            return;
        }
    }
    if (!sectionRuleConfig && mode === 'special' && !(validHeaders.includes('状态-Status') || validHeaders.includes('task_status_en') || validHeaders.includes('task_status') || validHeaders.includes('task_status_cn'))) { warnSkippedSection(`区块 [${title}] 未找到状态列，跳过渲染。`); return; }
    if (!sectionRuleConfig && mode === 'sr' && !validHeaders.includes('sr_status_name')) { warnSkippedSection(`区块 [${title}] 未找到 sr_status_name，跳过渲染。`); return; }
    if (!sectionRuleConfig && mode === 'vulnerability' && !validHeaders.includes('task_status')) { warnSkippedSection(`区块 [${title}] 未找到 task_status，跳过渲染。`); return; }

    const targetPriorityCols = mode === 'rectification' ? RECT_P : (mode === 'risk' ? RISK_P : (mode === 'special' ? SPEC_P : (mode === 'sr' ? SR_P : (mode === 'vulnerability' ? VULN_P : []))));
    const foundPriorityCols = targetPriorityCols.filter(col => validHeaders.includes(col));
    const otherCols = validHeaders.filter(col => !targetPriorityCols.includes(col));
    if (validHeaders.includes('版本标识') && !foundPriorityCols.includes('版本标识')) {
        foundPriorityCols.unshift('版本标识');
        const idx = otherCols.indexOf('版本标识'); if (idx > -1) otherCols.splice(idx, 1);
    }
    if (window.SLARowDetail && typeof window.SLARowDetail.fetchCopiedFields === 'function') {
        try { await window.SLARowDetail.fetchCopiedFields(mode || secId); } catch (e) {}
    }
    let frequentCols = [];
    if (window.SLARowDetail && typeof window.SLARowDetail.getCachedFrequentFields === 'function') {
        const cached = window.SLARowDetail.getCachedFrequentFields(mode || secId);
        frequentCols = (cached || []).filter(col => validHeaders.includes(col));
    }
    const remainingPriority = foundPriorityCols.filter(col => !frequentCols.includes(col));
    const remainingOther = otherCols.filter(col => !frequentCols.includes(col));
    const orderedHeadersLocal = [...frequentCols, ...remainingPriority, ...remainingOther];
    const schemaHashStr = options.originalSchemaHash || ((mode === 'other' && baseName) ? 'sla_prefs_other_' + SLAUpload.generateSchemaHash(baseName) : 'sla_prefs_' + mode + '_' + SLAUpload.generateSchemaHash(orderedHeadersLocal.slice().sort().join('|')));

    AppState[secId] = {
        mode, title, schemaHash: schemaHashStr,
        archiveSupplementary: !!options.archiveSupplementary,
        baseName: baseName || '',
        sourceData: rawData,
        riskRuleConfig,
        sectionRuleConfig,
        orderedHeaders: orderedHeadersLocal, visibleHeaders: [...orderedHeadersLocal],
        globalData: [], currentDisplayData: [],
        sortKey: null, sortAsc: true, currentFilter: 'all',
        columnWidths: {}, isDraggingColumn: false, draggedHeaderName: null,
        customMetrics: [],
        sourceFiles: Array.from(new Set((Array.isArray(sourceFiles) ? sourceFiles : []).filter(Boolean).map(String))),
        tableRenderSuspended: !!(options && options.deferTableRender)
    };

    await SLAPrefs.loadPrefs(secId);
    if (options.reviewOnly && !AppState[secId].hasSavedPrefs && Array.isArray(options.savedRules)) AppState[secId].customMetrics = JSON.parse(JSON.stringify(options.savedRules));
    if (!options.reviewOnly && window.SLAPrefs && typeof window.SLAPrefs.saveSourceMeta === 'function') {
        await window.SLAPrefs.saveSourceMeta(secId);
    }
    preprocessData(secId, rawData);
    buildDOM(secId, title, themeColor);
    bindEvents(secId);
    updateView(secId);
    evaluateAllMetrics();
}

function preprocessData(secId, rawData) {
    const state = AppState[secId];
    const now = new Date();
    const mode = state.mode;
    state.dateParseIssues = [];
    state._dateParseIssueKeys = new Set();
    state.globalData = rawData.map((row, rowIndex) => {
        let _slaDays = 999999, _slaText = '-', _slaCleanText = '-', _rowClass = '', _alertSeverity = '';
        row._slaRuleMatched = false;
        delete row._slaDeadline;
        delete row._srDisposition;
        delete row._srStatus;
        delete row._srSeverity;
        delete row._srConsumeRate;
        delete row._srRemainingHours;
        delete row._srRemainingDays;
        inspectDateLikeCells(state, row, rowIndex);
        if (mode !== 'risk' && state.sectionRuleConfig && window.SLAOtherRules) {
            const configuredResult = window.SLAOtherRules.evaluate(mode, row, {
                config: state.sectionRuleConfig,
                now,
                parseDate: (value, field, rule) => parseDateForSLA(state, rowIndex, field, value, `${rule.name} 截止日期`)
            });
            if (configuredResult) {
                _slaDays = configuredResult.slaDays;
                if (configuredResult.deadline) row._slaDeadline = configuredResult.deadline.toISOString();
                _slaText = configuredResult.text;
                _slaCleanText = configuredResult.cleanText;
                _rowClass = configuredResult.rowClass;
                _alertSeverity = configuredResult.alertSeverity;
                row._slaRuleMatched = configuredResult.matched === true;
                if (configuredResult.srMeta) {
                    row._srStatus = configuredResult.srMeta.status;
                    row._srSeverity = configuredResult.srMeta.severity;
                    row._srConsumeRate = configuredResult.srMeta.consumeRate;
                    row._srRemainingHours = configuredResult.srMeta.remainingHours;
                    row._srRemainingDays = configuredResult.srMeta.remainingDays;
                    row._srDisposition = configuredResult.srMeta.disposition;
                }
            }
        } else if (mode === 'rectification') {
            const status = row['task_status'] ? row['task_status'].toString().trim() : '';
            if (status === 'Checking') {
                const ct = row['task_create_time'];
                if (ct) {
                    const cd = parseDateForSLA(state, rowIndex, 'task_create_time', ct, 'Checking 建单时间');
                    if (cd) {
                        const dl = new Date(cd); dl.setDate(dl.getDate() + 30);
                        row._slaDeadline = dl.toISOString();
                        _slaDays = Math.ceil((dl - now) / 86400000);
                        const base = `剩余 ${_slaDays} 天`; _slaText = base; _slaCleanText = base;
                        if (_slaDays <= 10) { _rowClass = 'danger-row'; _slaText = `<span class="badge">Checking紧急</span> ${_slaText}`; _slaCleanText = `Checking紧急 (${base})`; }
                        else if (_slaDays < 30) { _rowClass = 'warning-row'; _slaText = `<span class="badge">Checking提醒</span> ${_slaText}`; _slaCleanText = `Checking提醒 (${base})`; }
                    } else { _slaText = '<span style="color:red">解析失败</span>'; }
                }
            } else if (status === 'Rectification Implementation') {
                const ret = row['rectify_plan_end_time'];
                if (ret) {
                    const dl = parseDateForSLA(state, rowIndex, 'rectify_plan_end_time', ret, '整改期望完成时间');
                    if (dl) {
                        row._slaDeadline = dl.toISOString();
                        _slaDays = Math.ceil((dl - now) / 86400000);
                        const base = `剩余 ${_slaDays} 天`; _slaText = base; _slaCleanText = base;
                        if (_slaDays <= 10) { _rowClass = 'danger-row'; _slaText = `<span class="badge">整改紧急</span> ${_slaText}`; _slaCleanText = `整改紧急 (${base})`; }
                        else if (_slaDays < 82) { _rowClass = 'warning-row'; _slaText = `<span class="badge">整改提醒</span> ${_slaText}`; _slaCleanText = `整改提醒 (${base})`; }
                    } else { _slaText = '<span style="color:red">解析失败</span>'; }
                }
            }
        } else if (mode === 'risk') {
            const riskResult = window.SLARiskRules && window.SLARiskRules.evaluate(row, {
                config: state.riskRuleConfig,
                now,
                parseDate: (value, field, rule) => parseDateForSLA(
                    state,
                    rowIndex,
                    field,
                    value,
                    `${rule.name} 截止日期`
                )
            });
            if (riskResult) {
                _slaDays = riskResult.slaDays;
                if (riskResult.deadline) row._slaDeadline = riskResult.deadline.toISOString();
                _slaText = riskResult.text;
                _slaCleanText = riskResult.cleanText;
                _rowClass = riskResult.rowClass;
                _alertSeverity = riskResult.alertSeverity;
            }
        } else if (mode === 'special') {
            const status = getCompatibleVal(row, ['状态-Status', 'task_status_en', 'task_status', 'task_status_cn']);
            const normalizedStatus = status.toLowerCase();
            if (['待确认','草稿'].includes(status) || ['draft','to be confirmed','confirm','confirming'].includes(normalizedStatus)) {
                const ctStr = getCompatibleVal(row, ['创建日期-Create Date', 'create_time']);
                if (ctStr) {
                    const cd = parseDateForSLA(state, rowIndex, '创建日期-Create Date/create_time', ctStr, '专项风险创建日期');
                    if (cd) {
                        const dl = new Date(cd); dl.setDate(dl.getDate() + 30);
                        row._slaDeadline = dl.toISOString();
                        _slaDays = Math.ceil((dl - now) / 86400000);
                        const base = `剩余 ${_slaDays} 天`; _slaText = base; _slaCleanText = base;
                        if (_slaDays <= 10) { _rowClass = 'danger-row'; _slaText = `<span class="badge">确认紧急</span> ${_slaText}`; }
                        else if (_slaDays < 30) { _rowClass = 'warning-row'; _slaText = `<span class="badge badge-special">确认提醒</span> ${_slaText}`; }
                    } else { _slaText = '<span style="color:red">解析失败</span>'; }
                }
            } else if (['处理中','评审中','Processing','Reviewing'].includes(status)) {
                const ecStr = getCompatibleVal(row, ['要求完成日期-Required Completion Date', 'required_completion_time', 'plan_complete_date']);
                if (ecStr) {
                    const dl = parseDateForSLA(state, rowIndex, '要求完成日期/required_completion_time', ecStr, '专项风险要求完成日期');
                    if (dl) {
                        row._slaDeadline = dl.toISOString();
                        _slaDays = Math.ceil((dl - now) / 86400000);
                        const base = `剩余 ${_slaDays} 天`; _slaText = base; _slaCleanText = base;
                        if (_slaDays <= 10) { _rowClass = 'danger-row'; _slaText = `<span class="badge">处理紧急</span> ${_slaText}`; }
                        else if (_slaDays < 30) { _rowClass = 'warning-row'; _slaText = `<span class="badge badge-special">处理提醒</span> ${_slaText}`; }
                    } else { _slaText = '<span style="color:red">解析失败</span>'; }
                }
            }
        } else if (mode === 'vulnerability') {
            const status = getCompatibleVal(row, ['task_status']);
            const activeStatuses = ['Checking', 'Communication Dept', 'Communication Customer'];
            if (activeStatuses.includes(status)) {
                const ctStr = getCompatibleVal(row, ['create_time', 'task_create_time']);
                if (ctStr) {
                    const cd = parseDateForSLA(state, rowIndex, 'create_time/task_create_time', ctStr, '漏洞建单时间');
                    if (cd) {
                        const dl = new Date(cd);
                        dl.setDate(dl.getDate() + 30);
                        row._slaDeadline = dl.toISOString();
                        _slaDays = Math.ceil((dl - now) / 86400000);
                        const base = `剩余 ${_slaDays} 天`;
                        _slaText = base;
                        _slaCleanText = base;
                        if (_slaDays <= 10) {
                            _rowClass = 'danger-row';
                            _slaText = `<span class="badge">漏洞紧急</span> ${status} / ${base}`;
                            _slaCleanText = `漏洞紧急 (${status}, ${base})`;
                        } else if (_slaDays < 30) {
                            _rowClass = 'warning-row';
                            _slaText = `<span class="badge badge-risk">漏洞提醒</span> ${status} / ${base}`;
                            _slaCleanText = `漏洞提醒 (${status}, ${base})`;
                        } else {
                            _slaText = `${status} / ${base}`;
                            _slaCleanText = _slaText;
                        }
                    } else {
                        _slaText = '<span style="color:red">create_time 解析失败</span>';
                    }
                } else {
                    _slaText = '<span style="color:red">缺少 create_time</span>';
                }
            }
        } else if (mode === 'sr') {
            const status = getSRStatus(row);
            const overdueFlag = getCompatibleVal(row, ['overdue']).toLowerCase();
            const severity = getSRSeverity(row);
            const openDateRaw = getCompatibleVal(row, ['open_date']);
            const expCloseDateRaw = getCompatibleVal(row, ['exp_close_date']);
            const susExpCloseDateRaw = getCompatibleVal(row, ['sus_exp_close_date', '期望关闭时间-挂起']);
            const actCloseDateRaw = getCompatibleVal(row, ['act_close_date']);
            const openDate = openDateRaw ? parseDateForSLA(state, rowIndex, 'open_date', openDateRaw, 'SR 开单时间') : null;
            const expCloseDate = expCloseDateRaw ? parseDateForSLA(state, rowIndex, 'exp_close_date', expCloseDateRaw, 'SR 期望关单时间') : null;
            const susExpCloseDate = susExpCloseDateRaw ? parseDateForSLA(state, rowIndex, 'sus_exp_close_date', susExpCloseDateRaw, '挂起后期望关单时间') : null;
            const actCloseDate = actCloseDateRaw ? parseDateForSLA(state, rowIndex, 'act_close_date', actCloseDateRaw, 'SR 实际关单时间') : null;
            const isClosed = isSRClosedStatus(status);
            const isPending = isSRPendingStatus(status);

            if (isPending) {
                _slaDays = 999998;
                _slaText = `<span class="badge badge-special">挂起忽略</span> ${status || 'Pending'}`;
                _slaCleanText = `挂起忽略 (${status || 'Pending'})`;
            } else if (isClosed) {
                const isOverdueByStandard = (actCloseDate && expCloseDate && actCloseDate > expCloseDate) || overdueFlag === 'y';
                
                if (isOverdueByStandard) {
                    if (susExpCloseDate) {
                        if (actCloseDate && actCloseDate <= susExpCloseDate) {
                            _slaDays = 999997;
                            _slaText = `<span class="badge badge-special" style="background:#0288d1;color:white;border:none;">挂起后未超期</span> ${status || 'Closed'}`;
                            _slaCleanText = `挂起后未超期 (${status || 'Closed'})`;
                        } else {
                            const overdueHours = (actCloseDate && susExpCloseDate) ? Math.ceil((actCloseDate - susExpCloseDate) / 3600000) : 0;
                            _slaDays = -1;
                            _rowClass = 'danger-row';
                            const overdueText = overdueHours > 0 ? formatSRDuration(overdueHours) : '已触发挂起超期';
                            _slaText = `<span class="badge" style="background:#d32f2f;color:white;border:none;">挂起后超期</span> ${overdueHours > 0 ? `已超 ${overdueText}` : overdueText}`;
                            _slaCleanText = `挂起后超期 (${overdueText})`;
                        }
                    } else {
                        const overdueHours = (actCloseDate && expCloseDate) ? Math.ceil((actCloseDate - expCloseDate) / 3600000) : 0;
                        _slaDays = -1;
                        _rowClass = 'danger-row';
                        const overdueText = overdueHours > 0 ? formatSRDuration(overdueHours) : '已触发上游超期标识';
                        _slaText = `<span class="badge">历史超期</span> ${overdueHours > 0 ? `已超 ${overdueText}` : overdueText}`;
                        _slaCleanText = `历史超期 (${overdueText})`;
                    }
                } else {
                    _slaDays = 999997;
                    _slaText = `<span class="badge badge-special">已关单</span> ${status || 'Closed'}`;
                    _slaCleanText = `已关单 (${status || 'Closed'})`;
                }
            } else if (openDate && expCloseDate) {
                const effectiveExpCloseDate = susExpCloseDate || expCloseDate;
                row._slaDeadline = effectiveExpCloseDate.toISOString();
                const totalMs = effectiveExpCloseDate - openDate;
                const consumedMs = now - openDate;
                const remainingMs = effectiveExpCloseDate - now;
                const remainingHours = Math.ceil(remainingMs / 3600000);
                const remainingDays = Math.ceil(remainingMs / 86400000);
                const consumeRate = totalMs > 0 ? (consumedMs / totalMs) * 100 : 100;
                _slaDays = remainingDays;

                row._srStatus = status;
                row._srSeverity = severity;
                row._srConsumeRate = Number.isFinite(consumeRate) ? +consumeRate.toFixed(2) : null;
                row._srRemainingHours = remainingHours;
                row._srRemainingDays = remainingDays;

                if (remainingMs < 0 || overdueFlag === 'y') {
                    _rowClass = 'danger-row';
                    const overdueText = formatSRDuration(Math.abs(remainingHours));
                    _slaText = `<span class="badge">SR超期</span> 已超 ${overdueText}`;
                    _slaCleanText = `SR超期 (${overdueText})`;
                } else if (severity === 'critical') {
                    if (consumeRate > 85 || remainingHours < 12) {
                        _rowClass = 'danger-row';
                        const remainText = formatSRDuration(remainingHours);
                        _slaText = `<span class="badge">Critical高危</span> 剩余 ${remainText} / 消耗 ${consumeRate.toFixed(0)}%`;
                        _slaCleanText = `Critical高危 (${remainText}, ${consumeRate.toFixed(0)}%)`;
                    } else if (consumeRate > 70 && remainingHours < 48) {
                        _rowClass = 'warning-row';
                        const remainText = formatSRDuration(remainingHours);
                        _slaText = `<span class="badge badge-risk">Critical预警</span> 剩余 ${remainText} / 消耗 ${consumeRate.toFixed(0)}%`;
                        _slaCleanText = `Critical预警 (${remainText}, ${consumeRate.toFixed(0)}%)`;
                    } else {
                        const remainText = formatSRDuration(remainingHours);
                        _slaText = `剩余 ${remainText} / 消耗 ${consumeRate.toFixed(0)}%`;
                        _slaCleanText = _slaText;
                    }
                } else {
                    if (consumeRate > 95) {
                        _rowClass = 'danger-row';
                        const remainText = formatSRDuration(remainingHours);
                        _slaText = `<span class="badge">SR高危</span> 剩余 ${remainText} / 消耗 ${consumeRate.toFixed(0)}%`;
                        _slaCleanText = `SR高危 (${remainText}, ${consumeRate.toFixed(0)}%)`;
                    } else if (consumeRate > 80) {
                        _rowClass = 'warning-row';
                        const remainText = formatSRDuration(remainingHours);
                        _slaText = `<span class="badge badge-risk">SR预警</span> 剩余 ${remainText} / 消耗 ${consumeRate.toFixed(0)}%`;
                        _slaCleanText = `SR预警 (${remainText}, ${consumeRate.toFixed(0)}%)`;
                    } else {
                        const remainText = formatSRDuration(remainingHours);
                        _slaText = `剩余 ${remainText} / 消耗 ${consumeRate.toFixed(0)}%`;
                        _slaCleanText = _slaText;
                    }
                }
            } else {
                _slaText = '<span style="color:#ff9800">缺少SLA关键时间</span>';
                _slaCleanText = '缺少SLA关键时间';
                _slaDays = 999996;
            }
        }
        if (_slaText.includes('解析失败')) _slaDays = -999999;
        if (!_alertSeverity) {
            if (_rowClass === 'danger-row') _alertSeverity = 'danger';
            else if (_rowClass === 'warning-row') _alertSeverity = 'warning';
            else if (_rowClass === 'info-row') _alertSeverity = 'info';
        }
        const cleanValuesArr = Object.values(row).map(v => v != null ? v.toString().replace(/[\r\n]+/g, ' ') : '');
        return { ...row, _slaDays, _slaText, _slaCleanText, _rowClass, _alertSeverity, _rawStringForSearch: cleanValuesArr.join('|||').toLowerCase() };
    });
    delete state._dateParseIssueKeys;
}

function applyRiskRuleConfig(config) {
    Object.entries(AppState).forEach(([secId, state]) => {
        if (!state || state.mode !== 'risk') return;
        state.riskRuleConfig = window.SLARiskRules
            ? window.SLARiskRules.normalizeConfig(config)
            : config;
        preprocessData(secId, state.sourceData || state.globalData || []);
        if (typeof window.updateView === 'function') window.updateView(secId);
    });
    if (typeof window.evaluateAllMetrics === 'function') window.evaluateAllMetrics();
}

function applySectionRuleConfig(mode, config) {
    Object.entries(AppState).forEach(([secId, state]) => {
        if (!state || state.mode !== mode) return;
        state.sectionRuleConfig = window.SLAOtherRules
            ? window.SLAOtherRules.normalizeConfig(mode, config)
            : config;
        preprocessData(secId, state.sourceData || state.globalData || []);
        if (typeof window.updateView === 'function') window.updateView(secId);
    });
    if (typeof window.evaluateAllMetrics === 'function') window.evaluateAllMetrics();
}

function getRuleDataContext(mode, valueFields = []) {
    const requestedValueFields = Array.from(new Set((valueFields || []).map(String))).sort();
    const states = Object.values(AppState).filter(state => state && state.mode === mode);
    const sourceRefs = states.map(state => state.sourceData);
    const cacheKey = `${mode}@@${requestedValueFields.join('|')}`;
    const cached = RuleDataContextCache.get(cacheKey);
    if (cached && cached.sourceRefs.length === sourceRefs.length && cached.sourceRefs.every((ref, index) => ref === sourceRefs[index])) {
        return cached.result;
    }
    const requestedSet = new Set(requestedValueFields);
    const columnMap = new Map();
    let rowCount = 0;
    states.forEach(state => {
        const rows = Array.isArray(state.sourceData) ? state.sourceData : [];
        rowCount += rows.length;
        rows.forEach(row => {
            Object.entries(row || {}).forEach(([name, rawValue]) => {
                if (!name || (SLAUpload.isRuntimeField && SLAUpload.isRuntimeField(name))) return;
                if (!columnMap.has(name)) columnMap.set(name, { name, nonEmptyCount: 0, valueCounts: new Map() });
                const column = columnMap.get(name);
                if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return;
                const value = String(rawValue).trim();
                column.nonEmptyCount += 1;
                if (requestedSet.has(name)) column.valueCounts.set(value, (column.valueCounts.get(value) || 0) + 1);
            });
        });
    });
    const columns = Array.from(columnMap.values()).map(column => ({
        name: column.name,
        nonEmptyCount: column.nonEmptyCount,
        values: Array.from(column.valueCounts, ([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN'))
    })).sort((a, b) => b.nonEmptyCount - a.nonEmptyCount || a.name.localeCompare(b.name, 'zh-CN'));
    const result = { rowCount, columns };
    RuleDataContextCache.set(cacheKey, { sourceRefs, result });
    return result;
}

function buildDOM(secId, title, themeColor) {
    const tt = window.SLAT || ((key) => key);
    const sourceFiles = (AppState[secId] && Array.isArray(AppState[secId].sourceFiles)) ? AppState[secId].sourceFiles : [];
    const sourceFileText = sourceFiles.join('；');
    const sourceFileHtml = sourceFiles.length
        ? `<span class="section-source-files" title="${escapeHTML(sourceFileText)}">导入文件：${escapeHTML(sourceFileText)}</span>`
        : '';
    const sectionRule = getSectionRuleDetails(AppState[secId].mode);
    const ruleButtonHtml = sectionRule
        ? `<button type="button" class="section-rule-config-btn" style="--section-rule-color:${escapeHTML(sectionRule.tone)}" onclick="openSectionRuleModal('${escapeHTML(AppState[secId].mode)}')">⚙️ 查看规则配置</button>`
        : '';
    const html = `
    <div class="section-card" id="section-${secId}">
        <div class="section-header">
            <h3 class="section-title" style="color:${themeColor}">
                ${title} <span style="font-size:12px;color:#888;font-weight:normal;" id="row-count-badge-${secId}"></span>
                ${sourceFileHtml}
                <span class="rule-summary-badge" id="rule-summary-badge-${secId}" title="${tt('sla.section.noRulesTitle')}">${tt('sla.section.ruleSummary', { main: 0, sub: 0 })}</span>
            </h3>
            <div class="section-header-actions">${ruleButtonHtml}</div>
        </div>
        <div class="dashboard-panel" id="dashboard-${secId}" style="display:none;"></div>
        ${buildDateParseWarningHTML(secId)}
        <div class="toolbar" id="toolbar-${secId}">
            <div class="filter-group">
                <button class="filter-btn active" data-sec="${secId}" data-filter="all">${tt('sla.section.all')}</button>
                ${AppState[secId].mode !== 'other' ? `<button class="filter-btn" data-sec="${secId}" data-filter="focus">${tt('sla.section.focus')}</button>
                <button class="filter-btn" data-sec="${secId}" data-filter="danger">${tt('sla.section.danger')}</button>
                <button class="filter-btn" data-sec="${secId}" data-filter="warning">${tt('sla.section.warning')}</button>` : ''}
            </div>
            <div class="search-container">
                <input type="text" id="search-${secId}" class="search-box" placeholder="${tt('sla.section.searchPh')}">
                <button id="settings-btn-${secId}" class="action-btn settings-btn">${tt('sla.section.columns')}</button>
                <button id="copy-btn-${secId}" class="action-btn copy-btn">${tt('sla.section.copyUnique')}</button>
                <button id="metrics-btn-${secId}" class="action-btn metrics-btn">${tt('sla.section.metrics')}</button>
                <button id="export-btn-${secId}" class="action-btn export-btn">${tt('sla.section.export')}</button>
                <div id="column-picker-${secId}" class="dropdown-menu" style="right:250px;width:220px;">
                    <div class="picker-header">
                        <input type="text" id="p-search-${secId}" class="picker-search" placeholder="${tt('sla.section.filterColumnsPh')}">
                        <div class="picker-actions">
                            <button id="p-all-${secId}" class="picker-action-btn">${tt('sla.section.selectAll')}</button>
                            <button id="p-none-${secId}" class="picker-action-btn">${tt('sla.section.clear')}</button>
                        </div>
                    </div>
                    <div id="p-list-${secId}" class="picker-list"></div>
                </div>
                <div id="copy-picker-${secId}" class="dropdown-menu" style="right:170px;width:240px;border-color:#ffb74d;">
                    <div class="picker-header" style="background:#fff8e1;border-bottom:1px solid #ffe0b2;">
                        <div style="color:#e65100;font-size:12px;font-weight:bold;margin-bottom:6px;">${tt('sla.section.copyHint')}</div>
                        <input type="text" id="c-search-${secId}" class="picker-search" placeholder="${tt('sla.section.copySearchPh')}" style="border-color:#ffb74d;">
                    </div>
                    <div id="c-list-${secId}" class="picker-list" style="padding:0;"></div>
                </div>
                <div id="metrics-picker-${secId}" class="dropdown-menu" style="right:40px;width:520px;max-width:calc(100vw - 40px);padding:16px;border-color:#9c27b0;max-height:min(660px, calc(100vh - 120px));overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.22);border-radius:8px;">
                    <div style="font-weight:bold;color:#8e44ad;font-size:13px;margin-bottom:10px;border-bottom:1px solid #f3e5f5;padding-bottom:6px;">${tt('sla.section.metricHint')}</div>
                    
                    <div style="margin-bottom:10px; display:flex; flex-wrap:wrap; gap:6px 12px; font-size:12px;">
                        <label style="cursor:pointer;"><input type="radio" name="m-type-${secId}" value="extract" checked onclick="setMetricCreateType('${secId}', 'extract')"> <span class="m-type-extract-lbl">${tt('sla.section.extractOne')}</span></label>
                        <label style="cursor:pointer;"><input type="radio" name="m-type-${secId}" value="extract_multi" onclick="setMetricCreateType('${secId}', 'extract_multi')"> <span class="m-type-multi-lbl">${tt('sla.section.extractMulti')}</span></label>
                        <label style="cursor:pointer;"><input type="radio" name="m-type-${secId}" value="count" onclick="setMetricCreateType('${secId}', 'count')"> <span class="m-type-count-lbl">${tt('sla.section.countTimes')}</span></label>
                        <label style="cursor:pointer;"><input type="radio" name="m-type-${secId}" value="ratio" onclick="setMetricCreateType('${secId}', 'ratio')"> <span class="m-type-ratio-lbl">${tt('sla.section.countRatio')}</span></label>
                    </div>

                    <div style="margin-bottom:10px; display:flex; align-items:center; gap:12px; font-size:12px; background:#faf5ff; padding:7px 10px; border-radius:6px; border:1px solid #e9d5ff;">
                        <span style="font-weight:bold; color:#7e22ce;" class="m-scope-title">${tt('sla.section.dataScope')}</span>
                        <label style="cursor:pointer; display:inline-flex; align-items:center; gap:4px;"><input type="radio" name="m-scope-${secId}" value="current" checked> <span class="m-scope-current-lbl">${tt('sla.section.scopeCurrent')}</span></label>
                        <label style="cursor:pointer; display:inline-flex; align-items:center; gap:4px;"><input type="radio" name="m-scope-${secId}" value="all"> <span class="m-scope-all-lbl">${tt('sla.section.scopeAll')}</span></label>
                    </div>

                    <!-- 提取模式 -->
                    <div id="m-extract-config-${secId}">
                        <select id="m-colx-${secId}" class="picker-search" style="margin-bottom:6px;cursor:pointer;"><option value="">${tt('sla.section.colXOption')}</option></select>
                        <input type="text" id="m-valy-${secId}" class="picker-search" placeholder="${tt('sla.section.valYPh')}" style="margin-bottom:6px;">
                        <select id="m-colz-${secId}" class="picker-search" style="margin-bottom:6px;cursor:pointer;"><option value="">${tt('sla.section.colZOption')}</option></select>
                    </div>

                    <div id="m-multi-config-${secId}" style="display:none;margin-bottom:6px;">
                        <select id="m-aggregation-${secId}" class="picker-search" style="margin-bottom:0;cursor:pointer;">
                            <option value="sum">${tt('sla.section.aggregateSum')}</option>
                            <option value="avg">${tt('sla.section.aggregateAvg')}</option>
                            <option value="max">${tt('sla.section.aggregateMax')}</option>
                            <option value="min">${tt('sla.section.aggregateMin')}</option>
                            <option value="count">${tt('sla.section.aggregateCount')}</option>
                        </select>
                    </div>

                    <!-- 统计模式/占比模式 -->
                    <div id="m-count-config-${secId}" style="display:none;">
                        <select id="m-c-colx-${secId}" class="picker-search" style="margin-bottom:6px;cursor:pointer;"><option value="">${tt('sla.section.countXOption')}</option></select>
                        <input type="text" id="m-c-valy-${secId}" class="picker-search" placeholder="${tt('sla.section.countYPh')}" style="margin-bottom:6px;">
                        <select id="m-c-colz-${secId}" class="picker-search" style="margin-bottom:6px;cursor:pointer;"><option value="">${tt('sla.section.countZOption')}</option></select>
                        <input type="text" id="m-c-valk-${secId}" class="picker-search" placeholder="${tt('sla.section.countKPh')}" style="margin-bottom:6px;">
                    </div>

                    <div class="metric-advanced-filter">
                        <button type="button" class="metric-advanced-toggle" onclick="toggleMetricAdvancedConditions('${secId}')"><span class="m-adv-filter-lbl">${tt('sla.section.advancedFilter')}</span> <span id="m-conditions-count-${secId}">0</span></button>
                        <div id="m-conditions-panel-${secId}" class="metric-advanced-panel" style="display:none;">
                            <div id="m-condition-logic-wrap-${secId}" class="metric-condition-logic" style="display:none;">
                                <span class="m-condition-logic-lbl">${tt('sla.section.conditionRelation')}</span>
                                <select id="m-condition-logic-${secId}">
                                    <option value="and">${tt('sla.section.conditionAnd')}</option>
                                    <option value="or">${tt('sla.section.conditionOr')}</option>
                                </select>
                            </div>
                            <p id="m-conditions-help-${secId}">${tt('sla.section.advancedHelp')}</p>
                            <div id="m-conditions-${secId}"></div>
                            <button type="button" class="metric-condition-add" onclick="addMetricConditionRow('${secId}')">${tt('sla.section.addCondition')}</button>
                        </div>
                    </div>

                    <div id="m-label-container-${secId}" style="display:flex;gap:6px;margin-bottom:8px;">
                        <input type="text" id="m-label-${secId}" class="picker-search" placeholder="${tt('sla.section.metricNamePh')}" style="margin-bottom:0;flex:1;">
                        <select id="m-color-${secId}" class="picker-search" style="margin-bottom:0;width:80px;cursor:pointer;">
                            <option value="">${tt('sla.section.color')}</option><option value="success">${tt('sla.section.green')}</option>
                            <option value="danger">${tt('sla.section.red')}</option><option value="warn">${tt('sla.section.yellow')}</option>
                        </select>
                    </div>
                    
                    <div style="display:flex;gap:6px;margin-bottom:8px;">
                        <select id="m-parent-${secId}" class="picker-search" style="margin-bottom:0;flex:1;cursor:pointer;" onchange="document.getElementById('m-cat-${secId}').style.display = this.value ? 'block' : 'none'; document.getElementById('m-label-container-${secId}').style.display = this.value ? 'none' : 'flex';">
                            <option value="">${tt('sla.section.mainMetric')}</option>
                        </select>
                        <select id="m-cat-${secId}" class="picker-search" style="margin-bottom:0;width:90px;cursor:pointer;display:none;">
                            <option value="">${tt('sla.section.chooseCategory')}</option>
                        </select>
                    </div>

                    <button id="add-metric-btn-${secId}" style="width:100%;padding:6px;background:#8e44ad;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;">${tt('sla.section.saveRule')}</button>
                    <div id="m-list-${secId}" style="margin-top:10px;border-top:1px dashed #eee;padding-top:8px;"></div>
                </div>
            </div>
        </div>
        <div id="table-container-${secId}" class="table-wrapper"></div>
    </div>`;
    document.getElementById('main-wrapper').insertAdjacentHTML('beforeend', html);
}

window.SLASection = { initSection, preprocessData, buildDOM, AppState, initGlobalTargets, getSectionRuleDetails, openSectionRuleModal, closeSectionRuleModal, applyRiskRuleConfig, applySectionRuleConfig, getRuleDataContext };
window.AppState = AppState;
window.openSectionRuleModal = openSectionRuleModal;
window.closeSectionRuleModal = closeSectionRuleModal;
