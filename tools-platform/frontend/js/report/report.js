let snapshots = [];
let reportSourceSnapshots = [];
let reportMinSourceTables = window.ReportSnapshotFilter.DEFAULT_MIN_SOURCES;
let categories = [];
let globalConfig = { targets: {}, prefs: {} };
let labelToTargetMap = {};
let labelToTargetKeyMap = {};
let currentSnapshot = null;
let standardTotalScore = 0;
let metricGroups = []; // [{id, name, metrics:[label,...]}]
let editingManualMetricLabel = null;
const REPORT_TARGET_MONTH_KEY = 'report_target_month';
let metricCountTrendData = null;
let metricCountTrendLoading = null;
let expiringWarningTrendData = null;
let expiringWarningTrendLoading = null;
const inheritedTargetSavePromises = new Map();
let manualAdjustDetailDraft = null;
let manualAdjustLogVisibleCount = 5;

function rt(key, params = {}) {
    if (window.ReportI18n && typeof window.ReportI18n.t === 'function') {
        return window.ReportI18n.t(key, params);
    }
    return Object.keys(params || {}).reduce((text, name) => text.replaceAll(`{${name}}`, params[name]), key);
}

function isReportEligibleSnapshot(snapshot) {
    return window.ReportSnapshotFilter.eligible(snapshot, reportMinSourceTables);
}

let i18nMap = {
    "分组": "Group",
    "总权重": "Total Weight",
    "考核的指标名称": "Assessment Metric Name",
    "权重": "Weight",
    "月目标值": "Target",
    "全局总体达标": "Global Compliance",
    "排名": "Rank",
    "客户群": "Customer Group / Rep Office / Region",
    "客户群/代表处/区域": "Customer Group / Rep Office / Region",
    "标准总分": "Standard Total Score",
    "系统得分": "System Score",
    "预留加减分 (手动)": "Manual Adj.",
    "最终得分": "Final Score",
    "类型": "Type",
    "项目说明": "Item Description",
    "计分规则": "Scoring Rule",
    "操作": "Action",
    "整改完成率": "Rectification Completion Rate",
    "TOPN风险完成率": "TOPN Risk Completion Rate",
    "数字证书消减率": "Digital Certificate Reduction Rate",
    "产品EOS闭环率": "Product EOS Closure Rate",
    "版本EOS闭环率": "Version EOS Closure Rate",
    "重急EOS闭环率": "Critical/Urgent EOS Closure Rate",
    "锂电池整改完成率": "Lithium Battery Rectification Completion Rate",
    "路由器": "Router RC",
    "业务比对回传率": "Business Comparison Return Rate",
    "业务比对备案率": "Business Comparison Filing Rate",
    "日志稽查率": "Log Audit Rate",
    "价值网络巡检完成率": "Value Network Inspection Completion Rate",
    "逃生演练完成率": "Escape Drill Completion Rate",
    "应急演练完成率": "Emergency Drill Completion Rate",
    "拓扑刷新率": "Topology Refresh Rate",
    "预案刷新率": "Contingency Plan Refresh Rate",
    "IBMS刷新率": "IBMS Refresh Rate",
    "月度例会及报告准时完成率": "Monthly Meeting & Report Punctuality Rate",
    "服务专刊季度提交": "Quarterly Service Publication Submission",
    "半年度服务峰会召开": "Semi-Annual Service Summit Holding",
    "Jam客户互动月度发布": "Monthly Jam Customer Interaction Release",
    "L4骨干晋升目标达成": "L4 Backbone Promotion Target Achievement",
    "在职员工平均能力得分": "Avg Competence Score of Active Employees",
    "专家讲座及经验分享": "Expert Lectures & Experience Sharing",
    "项目复盘与外部对标学习": "Project Review & External Benchmarking Study",
    "青年人才辅导培养": "Youth Talent Mentoring & Training",
    "存储整改完成率": "Storage Rectification Completion Rate",
    "软件MM收编率": "Software MM Incorporation Rate",
    "SR FRT率": "SR FRT Rate",
    "高危命令拦截次数": "High-Risk Command Interception Count",
    "GUI拦截次数": "GUI Interception Count",
    "任职率": "Employment Rate",
    "维护红线岗位满足率": "Maintenance Red Line Post Fulfillment Rate",
    "0工单人数": "Zero Work Order Headcount",
    "延期补授权完成率": "Delayed Supplemental Auth Completion Rate",
    "过保订单及SPMS": "Out-of-Warranty Orders & SPMS",
    "维保订单": "Maintenance Orders",
    "业务收入": "Business Revenue",
    "PS GP利润率": "PS GP Margin",
    "TE备件短缺解决方案": "TE Spare Parts Shortage Solution",
    "TE AOS 2.0过保订单": "TE AOS 2.0 Out-of-Warranty Orders",
    "ORG AOS 2.0过保订单": "ORG AOS 2.0 Out-of-Warranty Orders",
    "VDF AOS 2.0过保订单": "VDF AOS 2.0 Out-of-Warranty Orders",
    "ET成本控制(GPR提升10%)": "ET Cost Control (GPR Up 10%)",
    "人为事故 (含整改逾期、错认漏认)": "Human Error Incident (incl. Overdue Rectification, Missed/Wrong Recognition)",
    "恢复超60分钟事故 (华为原因)": ">60min Recovery Incident (Huawei Reason)",
    "严重投诉 (CXO/Operation Head级别)": "Severe Complaint (CXO/Operation Head Level)",
    "严重违规 (瞒报、无方案/越权操作)": "Severe Violation (Concealment, No Plan/Unauthorized Operation)",
    "整改确认及执行逾期": "Overdue Rectification Confirmation & Execution",
    "不合格的关闭整改单 (审计发现)": "Unqualified Closed Rectification Ticket (Audit Finding)",
    "未按要求完成整改 (含延期)": "Incomplete Rectification as Required (incl. Delay)",
    "不规范风险处理 (月度审计)": "Non-standard Risk Handling (Monthly Audit)",
    "风险确认/挂起/关闭逾期": "Overdue Risk Confirmation/Suspension/Closure",
    "FME离职超10天未清理账号": "FME Resigned >10 Days w/o Account Cleanup",
    "WFM无授权违规操作 (未发客户延期邮件)": "WFM Unauthorized Violation (No Customer Delay Email)",
    "WFM操作回退 (代表处服务质量原因)": "WFM Operation Rollback (Rep Office Service Quality Reason)",
    "未按时完成回退复盘 (SLA:10天)": "Overdue Rollback Review (SLA: 10 Days)",
    "ITR-FRT达不到98.5% (按月)": "ITR-FRT <98.5% (Monthly)",
    "跨产品逃生演练及Jam宣传": "Cross-product Escape Drill & Jam Promotion",
    "邀约客户交流呈现服务价值": "Inviting Customers to Communicate & Present Service Value",
    "未分组": "Ungrouped",
    "未分组(Ungrouped)": "Ungrouped",
    "加分": "Bonus",
    "扣分": "Deduction",
    "手动指标": "Manual Metric",
    "总计": "Total"
};

function getReportLang() {
    return window.ToolsI18n && typeof window.ToolsI18n.getLanguage === 'function'
        ? window.ToolsI18n.getLanguage()
        : 'zh-CN';
}

function rt(key, params) {
    if (window.REPORT_T) return window.REPORT_T(key, params || {});
    return key;
}

function getTranslatedLabel(text) {
    if (!text) return '';
    if (getReportLang() === 'en-US') {
        const en = i18nMap[text] || i18nMap[String(text).replace(/\(Ungrouped\)/, '').trim()];
        if (en) return en.replace(/<[^>]+>/g, '');
    }
    return text;
}

function getBilingual(text) {
    if (!text) return '';
    return escapeHTML(getTranslatedLabel(text));
}

function escapeHTML(str) {
    return typeof str === 'string' ? str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)) : str;
}

function formatReportDateTime(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value || '-');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
}

function formatDelta(value) {
    const num = Number(value) || 0;
    if (num > 0) return `+${num}`;
    return String(num);
}

async function loadMetricCountTrendData() {
    if (metricCountTrendData) return metricCountTrendData;
    if (metricCountTrendLoading) return metricCountTrendLoading;
    metricCountTrendLoading = API.get('/api/db/metric_count_trends?days=90')
        .then(data => {
            metricCountTrendData = data || { trends: [], recent: [] };
            return metricCountTrendData;
        })
        .finally(() => {
            metricCountTrendLoading = null;
        });
    return metricCountTrendLoading;
}

async function loadExpiringWarningTrendData() {
    if (expiringWarningTrendData) return expiringWarningTrendData;
    if (expiringWarningTrendLoading) return expiringWarningTrendLoading;
    expiringWarningTrendLoading = API.get('/api/db/expiring_warning_trends?days=90')
        .then(data => {
            expiringWarningTrendData = data || { trends: [], recent: [] };
            return expiringWarningTrendData;
        })
        .finally(() => {
            expiringWarningTrendLoading = null;
        });
    return expiringWarningTrendLoading;
}

function renderRankingCountInsight() {
    const el = document.getElementById('ranking-count-insight');
    if (!el) return;
    el.classList.add('loading');
    el.innerHTML = rt('report.trend.metricCountLoading');
    loadMetricCountTrendData().then(data => {
        const recent = Array.isArray(data.recent) ? data.recent : [];
        if (!recent.length) {
            el.innerHTML = rt('report.trend.metricCountNoHistory');
            return;
        }
        const latest = recent[0];
        const prev = recent[1] || null;
        const overallDelta = prev ? latest.overall_metric_count - prev.overall_metric_count : 0;
        const subDelta = prev ? latest.sub_metric_count - prev.sub_metric_count : 0;
        const changed = overallDelta !== 0 || subDelta !== 0;
        const sequence = recent.slice().reverse().map(item => `${item.overall_metric_count}/${item.sub_metric_count}`).join(' → ');
        const title = recent.slice().reverse().map(item =>
            rt('report.trend.metricCountTitleLine', {
                time: formatReportDateTime(item.created_at),
                overall: item.overall_metric_count,
                sub: item.sub_metric_count
            })
        ).join('\n');
        el.classList.remove('loading');
        el.title = `${title}\n${rt('report.trend.metricCountTitleHint')}`;
        el.innerHTML = `
            <span>${rt('report.trend.lastThree', { sequence: escapeHTML(sequence) })}</span>
            <span class="ranking-count-pill">${rt('report.trend.overallShort', { count: latest.overall_metric_count })}</span>
            <span class="ranking-count-pill sub">${rt('report.trend.subShort', { count: latest.sub_metric_count })}</span>
            <span class="ranking-count-delta ${changed ? 'changed' : ''}">${rt('report.trend.changePair', { first: formatDelta(overallDelta), second: formatDelta(subDelta) })}</span>
        `;
    }).catch(err => {
        el.classList.remove('loading');
        el.innerHTML = rt('report.trend.metricCountLoadFailed');
        el.title = err.message || String(err);
    });
}

function renderExpiringWarningInsight() {
    const el = document.getElementById('expiring-warning-insight');
    if (!el) return;
    el.classList.add('loading');
    el.innerHTML = rt('report.trend.warningLoading');
    loadExpiringWarningTrendData().then(data => {
        const recent = Array.isArray(data.recent) ? data.recent : [];
        if (!recent.length) {
            el.innerHTML = rt('report.trend.warningNoHistory');
            return;
        }
        const latest = recent[0];
        const prev = recent[1] || null;
        const totalDelta = prev ? latest.total_warning_count - prev.total_warning_count : 0;
        const ticketDelta = prev ? latest.expiring_ticket_count - prev.expiring_ticket_count : 0;
        const changed = totalDelta !== 0 || ticketDelta !== 0;
        const sequence = recent.slice().reverse().map(item => item.total_warning_count).join(' → ');
        const title = recent.slice().reverse().map(item =>
            rt('report.trend.warningTitleLine', {
                time: formatReportDateTime(item.created_at),
                total: item.total_warning_count,
                tickets: item.expiring_ticket_count,
                special: item.special_metric_alert_count
            })
        ).join('\n');
        el.classList.remove('loading');
        el.title = `${title}\n${rt('report.trend.warningTitleHint')}`;
        el.innerHTML = `
            <span>${rt('report.trend.warningSequence', { sequence: escapeHTML(sequence) })}</span>
            <span class="ranking-count-pill">${rt('report.trend.totalShort', { count: latest.total_warning_count })}</span>
            <span class="ranking-count-pill sub">${rt('report.trend.ticketShort', { count: latest.expiring_ticket_count })}</span>
            <span class="ranking-count-delta ${changed ? 'changed' : ''}">${rt('report.trend.changePair', { first: formatDelta(totalDelta), second: formatDelta(ticketDelta) })}</span>
        `;
    }).catch(err => {
        el.classList.remove('loading');
        el.innerHTML = rt('report.trend.warningLoadFailed');
        el.title = err.message || String(err);
    });
}

function getTrendY(value, min, max, top, height) {
    if (max === min) return top + height / 2;
    return top + (max - value) / (max - min) * height;
}

function buildMetricLineChart(trends) {
    const width = 760;
    const height = 300;
    const pad = { left: 54, right: 24, top: 26, bottom: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const rows = trends.length ? trends : [];
    if (!rows.length) {
        return `<svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8">${escapeHTML(rt('report.trend.noTrendData'))}</text></svg>`;
    }
    const values = rows.flatMap(item => [item.overall_metric_count || 0, item.sub_metric_count || 0]);
    const min = Math.max(0, Math.min(...values) - 4);
    const max = Math.max(...values) + 4;
    const xOf = index => pad.left + (rows.length === 1 ? plotW / 2 : index * plotW / (rows.length - 1));
    const linePath = key => rows.map((item, index) => {
        const x = xOf(index);
        const y = getTrendY(item[key] || 0, min, max, pad.top, plotH);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const grid = [0, 1, 2, 3, 4].map(i => {
        const y = pad.top + i * plotH / 4;
        const label = Math.round(max - i * (max - min) / 4);
        return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0"/><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11">${label}</text>`;
    }).join('');
    const labels = rows.map((item, index) => {
        if (rows.length > 12 && index % Math.ceil(rows.length / 8) !== 0 && index !== rows.length - 1) return '';
        const x = xOf(index);
        return `<text x="${x}" y="${height - 16}" text-anchor="middle" fill="#64748b" font-size="10">${escapeHTML(formatReportDateTime(item.created_at).slice(0, 5))}</text>`;
    }).join('');
    const points = key => rows.map((item, index) => {
        const x = xOf(index);
        const y = getTrendY(item[key] || 0, min, max, pad.top, plotH);
        const delta = index > 0 ? (item[key] || 0) - (rows[index - 1][key] || 0) : 0;
        const major = Math.abs(delta) >= 8;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${major ? 5 : 3}" fill="${major ? '#f97316' : '#fff'}" stroke="${key === 'overall_metric_count' ? '#2563eb' : '#059669'}" stroke-width="2"><title>${escapeHTML(formatReportDateTime(item.created_at))} ${key === 'overall_metric_count' ? rt('report.trend.overallMetricCount') : rt('report.trend.subMetricCount')}：${item[key] || 0}${delta ? ` (${formatDelta(delta)})` : ''}</title></circle>`;
    }).join('');
    return `
        <svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(rt('report.trend.metricCountAria'))}">
            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#ffffff"/>
            ${grid}
            <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
            <path d="${linePath('sub_metric_count')}" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="${linePath('overall_metric_count')}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            ${points('sub_metric_count')}
            ${points('overall_metric_count')}
            ${labels}
            <g transform="translate(${pad.left}, 12)">
                <circle cx="0" cy="0" r="4" fill="#2563eb"/><text x="10" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.overallMetricCount'))}</text>
                <circle cx="92" cy="0" r="4" fill="#059669"/><text x="102" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.subMetricCount'))}</text>
                <circle cx="178" cy="0" r="5" fill="#f97316"/><text x="190" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.majorChangePoint'))}</text>
            </g>
        </svg>
    `;
}

function buildWarningLineChart(trends) {
    const width = 760;
    const height = 300;
    const pad = { left: 54, right: 24, top: 26, bottom: 46 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const rows = trends.length ? trends : [];
    if (!rows.length) {
        return `<svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8">${escapeHTML(rt('report.trend.noWarningTrendData'))}</text></svg>`;
    }
    const values = rows.flatMap(item => [
        item.total_warning_count || 0,
        item.expiring_ticket_count || 0,
        item.special_metric_alert_count || 0
    ]);
    const min = 0;
    const max = Math.max(...values, 4) + 4;
    const xOf = index => pad.left + (rows.length === 1 ? plotW / 2 : index * plotW / (rows.length - 1));
    const linePath = key => rows.map((item, index) => {
        const x = xOf(index);
        const y = getTrendY(item[key] || 0, min, max, pad.top, plotH);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const grid = [0, 1, 2, 3, 4].map(i => {
        const y = pad.top + i * plotH / 4;
        const label = Math.round(max - i * (max - min) / 4);
        return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0"/><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11">${label}</text>`;
    }).join('');
    const labels = rows.map((item, index) => {
        if (rows.length > 12 && index % Math.ceil(rows.length / 8) !== 0 && index !== rows.length - 1) return '';
        const x = xOf(index);
        return `<text x="${x}" y="${height - 16}" text-anchor="middle" fill="#64748b" font-size="10">${escapeHTML(formatReportDateTime(item.created_at).slice(0, 5))}</text>`;
    }).join('');
    const points = (key, color) => rows.map((item, index) => {
        const x = xOf(index);
        const y = getTrendY(item[key] || 0, min, max, pad.top, plotH);
        const delta = index > 0 ? (item[key] || 0) - (rows[index - 1][key] || 0) : 0;
        const major = Math.abs(delta) >= 5;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${major ? 5 : 3}" fill="${major ? '#ef4444' : '#fff'}" stroke="${color}" stroke-width="2"><title>${escapeHTML(formatReportDateTime(item.created_at))}：${item[key] || 0}${delta ? ` (${formatDelta(delta)})` : ''}</title></circle>`;
    }).join('');
    return `
        <svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(rt('report.trend.warningAria'))}">
            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#ffffff"/>
            ${grid}
            <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
            <path d="${linePath('total_warning_count')}" fill="none" stroke="#dc2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="${linePath('expiring_ticket_count')}" fill="none" stroke="#f97316" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="${linePath('special_metric_alert_count')}" fill="none" stroke="#7c3aed" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            ${points('total_warning_count', '#dc2626')}
            ${points('expiring_ticket_count', '#f97316')}
            ${points('special_metric_alert_count', '#7c3aed')}
            ${labels}
            <g transform="translate(${pad.left}, 12)">
                <circle cx="0" cy="0" r="4" fill="#dc2626"/><text x="10" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.totalWarnings'))}</text>
                <circle cx="70" cy="0" r="4" fill="#f97316"/><text x="80" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.expiringTickets'))}</text>
                <circle cx="158" cy="0" r="4" fill="#7c3aed"/><text x="168" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.specialMetrics'))}</text>
                <circle cx="258" cy="0" r="5" fill="#ef4444"/><text x="270" y="4" fill="#334155" font-size="12">${escapeHTML(rt('report.trend.majorChangePoint'))}</text>
            </g>
        </svg>
    `;
}

function buildDimensionLineChart(trends, field, titleText) {
    const width = 760;
    const height = 260;
    const pad = { left: 54, right: 24, top: 28, bottom: 42 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const rows = trends.length ? trends : [];
    if (!rows.length) {
        return `<svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8">${escapeHTML(rt('report.trend.noNamedTrendData', { name: titleText }))}</text></svg>`;
    }
    const dimensions = collectDimensionChanges(rows, field)
        .filter(item => item.latestCount > 0 || item.range > 0)
        .slice(0, 6);
    if (!dimensions.length) {
        return `<svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8">${escapeHTML(rt('report.trend.noNamedTrendData', { name: titleText }))}</text></svg>`;
    }
    const palette = ['#2563eb', '#f97316', '#7c3aed', '#059669', '#dc2626', '#0891b2'];
    const values = dimensions.flatMap(dim => rows.map(item => item[field]?.[dim.name] || 0));
    const min = 0;
    const max = Math.max(...values, 4) + 3;
    const xOf = index => pad.left + (rows.length === 1 ? plotW / 2 : index * plotW / (rows.length - 1));
    const pathFor = name => rows.map((item, index) => {
        const x = xOf(index);
        const y = getTrendY(item[field]?.[name] || 0, min, max, pad.top, plotH);
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const grid = [0, 1, 2, 3, 4].map(i => {
        const y = pad.top + i * plotH / 4;
        const label = Math.round(max - i * (max - min) / 4);
        return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0"/><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11">${label}</text>`;
    }).join('');
    const labels = rows.map((item, index) => {
        if (rows.length > 12 && index % Math.ceil(rows.length / 8) !== 0 && index !== rows.length - 1) return '';
        const x = xOf(index);
        return `<text x="${x}" y="${height - 14}" text-anchor="middle" fill="#64748b" font-size="10">${escapeHTML(formatReportDateTime(item.created_at).slice(0, 5))}</text>`;
    }).join('');
    const lines = dimensions.map((dim, index) => {
        const color = palette[index % palette.length];
        const points = rows.map((item, rowIndex) => {
            const value = item[field]?.[dim.name] || 0;
            const prev = rowIndex > 0 ? (rows[rowIndex - 1][field]?.[dim.name] || 0) : value;
            const delta = value - prev;
            const major = Math.abs(delta) >= 3;
            const x = xOf(rowIndex);
            const y = getTrendY(value, min, max, pad.top, plotH);
            return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${major ? 4.5 : 2.8}" fill="${major ? '#ef4444' : '#fff'}" stroke="${color}" stroke-width="2"><title>${escapeHTML(dim.name)} ${escapeHTML(formatReportDateTime(item.created_at))}：${value}${delta ? ` (${formatDelta(delta)})` : ''}</title></circle>`;
        }).join('');
        return `<path d="${pathFor(dim.name)}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>${points}`;
    }).join('');
    const legend = dimensions.map((dim, index) => {
        const color = palette[index % palette.length];
        const x = pad.left + (index % 3) * 210;
        const y = 12 + Math.floor(index / 3) * 16;
        const label = dim.name.length > 18 ? `${dim.name.slice(0, 18)}...` : dim.name;
        return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/><text x="${x + 10}" y="${y + 4}" fill="#334155" font-size="11">${escapeHTML(label)}</text>`;
    }).join('');
    return `
        <svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(rt('report.trend.namedTrendAria', { name: titleText }))}">
            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#ffffff"/>
            ${grid}
            <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
            ${lines}
            ${labels}
            <g>${legend}</g>
        </svg>
    `;
}

function buildDisplayTargetLines(targets) {
    const items = ['current', 'previous']
        .map(key => {
            const target = targets && targets[key];
            if (!target || !Number.isFinite(Number(target.value))) return null;
            return {
                key,
                keys: [key],
                value: Number(target.value),
                raw: target.raw || target.value,
                month: target.month,
                months: target.month ? [target.month] : [],
                condition: target.condition || 'gte',
                label: key === 'current' ? rt('report.trend.currentMonthTarget') : rt('report.trend.previousMonthTarget'),
                shortLabel: key === 'current' ? rt('report.trend.currentMonthShort') : rt('report.trend.previousMonthShort'),
                color: key === 'current' ? '#475569' : '#b45309'
            };
        })
        .filter(Boolean);
    if (items.length === 2) {
        const [current, previous] = items;
        const sameValue = Math.abs(current.value - previous.value) < 0.000001;
        const sameCondition = current.condition === previous.condition;
        const sameRaw = String(current.raw || '').replace(/\s+/g, '') === String(previous.raw || '').replace(/\s+/g, '');
        if (sameValue && sameCondition && sameRaw) {
            return [{
                ...current,
                key: 'merged',
                keys: ['current', 'previous'],
                months: [current.month, previous.month].filter(Boolean),
                label: rt('report.trend.currentPreviousTarget'),
                shortLabel: rt('report.trend.currentPreviousShort'),
                color: '#475569'
            }];
        }
    }
    return items;
}

function buildItemTrendChart(trends, options = {}) {
    const width = 820;
    const height = 310;
    const pad = { left: 58, right: 28, top: 30, bottom: 48 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const rows = Array.isArray(trends) ? trends : [];
    if (!rows.length) {
        return `<svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8">${escapeHTML(rt('report.trend.noTrendData'))}</text></svg>`;
    }
    const overallSeriesName = rt('report.trend.overall');
    const seriesNames = new Set([overallSeriesName]);
    rows.forEach(row => Object.keys(row.series || {}).forEach(name => seriesNames.add(name)));
    const allNames = Array.from(seriesNames);
    const scored = allNames.map(name => {
        const values = rows.map(row => name === overallSeriesName ? row.total_value : row.series?.[name]?.value).filter(v => Number.isFinite(Number(v))).map(Number);
        const latest = values.length ? values[values.length - 1] : 0;
        const range = values.length ? Math.max(...values) - Math.min(...values) : 0;
        return { name, latest, range };
    }).sort((a, b) => (a.name === overallSeriesName ? -1 : b.name === overallSeriesName ? 1 : (b.range - a.range || b.latest - a.latest)));
    const picked = scored.slice(0, 7).map(item => item.name);
    const targetLines = buildDisplayTargetLines(options.targets);
    const values = rows.flatMap(row => picked.map(name => name === '整体' ? row.total_value : row.series?.[name]?.value))
        .concat(targetLines.map(item => item.value))
        .filter(v => Number.isFinite(Number(v))).map(Number);
    if (!values.length) {
        return `<svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#94a3b8">${escapeHTML(rt('report.trend.noDrawableMetricValue'))}</text></svg>`;
    }
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const min = Math.min(0, minValue - Math.max(1, Math.abs(minValue) * 0.08));
    const max = maxValue + Math.max(1, Math.abs(maxValue) * 0.12);
    const palette = ['#0f172a', '#2563eb', '#f97316', '#7c3aed', '#059669', '#dc2626', '#0891b2'];
    const xOf = index => pad.left + (rows.length === 1 ? plotW / 2 : index * plotW / (rows.length - 1));
    const yOf = value => getTrendY(Number(value), min, max, pad.top, plotH);
    const occupiedBoxes = [
        { x1: pad.left - 4, y1: 0, x2: width - pad.right + 4, y2: 28 }
    ];
    const boxesOverlap = (a, b, gap = 5) => !(a.x2 + gap < b.x1 || a.x1 - gap > b.x2 || a.y2 + gap < b.y1 || a.y1 - gap > b.y2);
    const placeTargetLabel = (labelText, y) => {
        const textW = Math.min(220, Math.max(72, String(labelText).length * 6.3 + 12));
        const candidates = [
            { x: width - pad.right - 8, anchor: 'end' },
            { x: pad.left + plotW * 0.78, anchor: 'middle' },
            { x: pad.left + plotW * 0.62, anchor: 'middle' },
            { x: pad.left + plotW * 0.45, anchor: 'middle' },
            { x: pad.left + plotW * 0.28, anchor: 'middle' },
            { x: pad.left + 8, anchor: 'start' }
        ];
        const yCandidates = [y - 9, y + 17, y - 23, y + 31];
        for (const baseline of yCandidates) {
            if (baseline < pad.top + 14 || baseline > height - pad.bottom - 6) continue;
            for (const candidate of candidates) {
                let x1 = candidate.x;
                if (candidate.anchor === 'end') x1 = candidate.x - textW;
                if (candidate.anchor === 'middle') x1 = candidate.x - textW / 2;
                const box = { x1, y1: baseline - 12, x2: x1 + textW, y2: baseline + 4 };
                if (box.x1 < pad.left + 4 || box.x2 > width - pad.right - 4) continue;
                if (occupiedBoxes.some(item => boxesOverlap(box, item))) continue;
                occupiedBoxes.push(box);
                return { x: candidate.x, y: baseline, anchor: candidate.anchor };
            }
        }
        return null;
    };
    const grid = [0, 1, 2, 3, 4].map(i => {
        const y = pad.top + i * plotH / 4;
        const label = +(max - i * (max - min) / 4).toFixed(1);
        return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#e2e8f0"/><text x="${pad.left - 10}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="11">${label}</text>`;
    }).join('');
    const labels = rows.map((item, index) => {
        if (rows.length > 12 && index % Math.ceil(rows.length / 8) !== 0 && index !== rows.length - 1) return '';
        const x = xOf(index);
        return `<text x="${x}" y="${height - 16}" text-anchor="middle" fill="#64748b" font-size="10">${escapeHTML(formatReportDateTime(item.created_at).slice(0, 5))}</text>`;
    }).join('');
    const lines = picked.map((name, index) => {
        const color = palette[index % palette.length];
        const points = [];
        const path = rows.map((row, rowIndex) => {
            const value = name === overallSeriesName ? row.total_value : row.series?.[name]?.value;
            if (!Number.isFinite(Number(value))) return '';
            const x = xOf(rowIndex);
            const y = yOf(value);
            points.push({ x, y, value: Number(value), row, rowIndex });
            return `${points.length === 1 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        }).filter(Boolean).join(' ');
        const circles = points.map(point => {
            const prevPoint = points.find(p => p.rowIndex === point.rowIndex - 1);
            const delta = prevPoint ? point.value - prevPoint.value : 0;
            const major = Math.abs(delta) >= Math.max(1, Math.abs(max - min) * 0.12);
            occupiedBoxes.push({ x1: point.x - 9, y1: point.y - 9, x2: point.x + 9, y2: point.y + 9 });
            return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${major ? 5 : 3}" fill="${major ? '#ef4444' : '#fff'}" stroke="${color}" stroke-width="2"><title>${escapeHTML(name)} ${escapeHTML(formatReportDateTime(point.row.created_at))}：${point.value}${delta ? ` (${formatDelta(+delta.toFixed(2))})` : ''}</title></circle>`;
        }).join('');
        const dash = name === overallSeriesName ? '' : ' stroke-dasharray="0"';
        return path ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="${name === overallSeriesName ? 3.2 : 2.5}"${dash} stroke-linecap="round" stroke-linejoin="round" opacity=".92"/>${circles}` : '';
    }).join('');
    const placedTargetLabels = [];
    const targetLineSvg = targetLines.map(target => {
        if (target.value < min || target.value > max) return '';
        const y = yOf(target.value);
        const monthText = target.months && target.months.length > 1
            ? `(${target.months.map(month => rt('report.month.option', { month })).join('/')})`
            : (target.month ? `(${rt('report.month.option', { month: target.month })})` : '');
        const labelText = `${target.label}${monthText} ${target.raw}`;
        const labelPos = placeTargetLabel(labelText, y);
        if (labelPos) {
            placedTargetLabels.push({ ...labelPos, labelText, color: target.color });
        }
        return `
            <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="${target.color}" stroke-width="1.4" stroke-dasharray="7 7" opacity=".46"/>
        `;
    }).join('');
    const targetLabelSvg = placedTargetLabels.map(label => `
        <text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" text-anchor="${label.anchor}" fill="${label.color}" font-size="11" opacity=".82">${escapeHTML(label.labelText)}</text>
    `).join('');
    const legend = picked.map((name, index) => {
        const color = palette[index % palette.length];
        const x = pad.left + (index % 3) * 220;
        const y = 13 + Math.floor(index / 3) * 17;
        const label = name.length > 20 ? `${name.slice(0, 20)}...` : name;
        return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/><text x="${x + 10}" y="${y + 4}" fill="#334155" font-size="11">${escapeHTML(label)}</text>`;
    }).join('');
    return `
        <svg class="metric-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(options.title || rt('report.trend.metricTrend'))}">
            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#ffffff"/>
            ${grid}
            ${targetLineSvg}
            <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="#cbd5e1"/>
            ${lines}
            ${targetLabelSvg}
            ${labels}
            <g>${legend}</g>
        </svg>
    `;
}

function renderTargetSummaryInline(targets) {
    const items = buildDisplayTargetLines(targets).map(target => {
        const monthText = target.months && target.months.length > 1
            ? target.months.map(month => rt('report.month.option', { month })).join('/')
            : (target.month ? rt('report.month.option', { month: target.month }) : '');
        return `<span class="metric-target-chip ${target.key}">${target.shortLabel}${monthText ? `(${monthText})` : ''} ${escapeHTML(target.raw || target.value)}</span>`;
    }).filter(Boolean);
    return items.length ? `<span class="metric-target-summary">${items.join('')}</span>` : '';
}

function buildItemTrendTable(trends, kind) {
    const latest = trends[trends.length - 1] || null;
    const prev = trends[trends.length - 2] || null;
    if (!latest) return `<div class="data-source-note">${escapeHTML(rt('report.trend.noDetails'))}</div>`;
    const names = new Set();
    Object.keys(latest.series || {}).forEach(name => names.add(name));
    if (prev) Object.keys(prev.series || {}).forEach(name => names.add(name));
    const rows = Array.from(names).map(name => {
        const now = latest.series?.[name]?.value;
        const before = prev ? prev.series?.[name]?.value : null;
        const delta = Number.isFinite(Number(now)) && Number.isFinite(Number(before)) ? Number(now) - Number(before) : 0;
        return { name, now, delta, raw: latest.series?.[name]?.raw || '' };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
    if (!rows.length) return `<div class="data-source-note">${escapeHTML(rt('report.trend.noLatestDimensionDetails'))}</div>`;
    return rows.map(item => {
        const changed = Math.abs(item.delta) > 0.000001;
        const rawDisplay = item.raw || (item.now ?? '--');
        return `
            <div class="category-change-item ${changed ? 'major' : ''}">
                <div>
                    <div class="category-change-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
                    <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${kind === 'manual' ? rt('report.trend.occurrences') : rt('report.trend.latestValue')} ${escapeHTML(rawDisplay)}</div>
                </div>
                <div class="category-change-delta ${changed ? 'changed' : ''}">${Number.isFinite(Number(item.now)) ? +Number(item.now).toFixed(2) : '--'} (${formatDelta(+item.delta.toFixed(2))})</div>
            </div>
        `;
    }).join('');
}

function buildMonthlyTrendDetailsTable(trends, kind) {
    const rows = Array.isArray(trends) ? trends : [];
    if (!rows.length) return `<div class="data-source-note">${escapeHTML(rt('report.trend.noDetails'))}</div>`;

    const dimensionNames = new Set();
    rows.forEach(row => {
        Object.keys(row.series || {}).forEach(name => {
            if (name !== '整体' && name !== rt('report.trend.overall')) dimensionNames.add(name);
        });
    });
    const dimensions = Array.from(dimensionNames).sort((a, b) => String(a).localeCompare(String(b), 'zh-Hans-CN'));
    const formatValue = item => {
        if (!item) return '--';
        if (item.raw !== null && item.raw !== undefined && String(item.raw).trim()) return String(item.raw);
        return Number.isFinite(Number(item.value)) ? String(+Number(item.value).toFixed(2)) : '--';
    };
    const header = dimensions.map(name => `<th title="${escapeHTML(name)}">${escapeHTML(name)}</th>`).join('');
    const body = rows.map(row => {
        const month = row.trend_month || String(row.created_at || '').slice(0, 7) || '--';
        const overall = Number.isFinite(Number(row.total_value)) ? +Number(row.total_value).toFixed(2) : '--';
        const scoreCell = kind === 'manual'
            ? `<td>${Number.isFinite(Number(row.total_score)) ? +Number(row.total_score).toFixed(2) : '--'}</td>`
            : '';
        const detailCells = dimensions.map(name => `<td>${escapeHTML(formatValue(row.series?.[name]))}</td>`).join('');
        return `
            <tr>
                <td class="metric-month-cell">${escapeHTML(month)}</td>
                <td>${escapeHTML(formatReportDateTime(row.created_at))}</td>
                <td>${escapeHTML(String(overall))}</td>
                ${scoreCell}
                ${detailCells}
            </tr>
        `;
    }).join('');
    return `
        <div class="metric-monthly-table-wrap">
            <table class="metric-monthly-table">
                <thead>
                    <tr>
                        <th>${escapeHTML(rt('report.trend.dataMonth'))}</th>
                        <th>${escapeHTML(rt('report.trend.snapshotDate'))}</th>
                        <th>${escapeHTML(rt('report.trend.overallValue'))}</th>
                        ${kind === 'manual' ? `<th>${escapeHTML(rt('report.trend.scoreImpact'))}</th>` : ''}
                        ${header}
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>
        </div>
    `;
}

function renderMetricTrendLink(label, kind = 'metric') {
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return '';
    const title = kind === 'manual' ? rt('report.trend.viewManualItemTrend') : rt('report.trend.viewMetricTrend');
    const manualClass = kind === 'manual' ? ' manual' : '';
    return `<button type="button" class="metric-trend-link${manualClass}" data-trend-kind="${escapeHTML(kind)}" data-trend-label="${escapeHTML(cleanLabel)}" title="${title}">${getBilingual(cleanLabel)}</button>`;
}

function attachTrendModalToVisibleRoot(modal) {
    const fullscreenRoot = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
    const targetRoot = fullscreenRoot || document.body;
    if (modal && modal.parentElement !== targetRoot) {
        targetRoot.appendChild(modal);
    }
}

function openMetricItemTrendModal(label, kind = 'metric') {
    const cleanLabel = String(label || '').trim();
    if (!cleanLabel) return;
    const titleKind = kind === 'manual' ? rt('report.trend.manualItem') : rt('report.trend.assessmentMetric');
    const url = `/api/db/metric_item_trend?months=6&kind=${encodeURIComponent(kind)}&label=${encodeURIComponent(cleanLabel)}`;
    API.get(url).then(data => {
        const trends = Array.isArray(data.trends) ? data.trends : [];
        const targets = data.targets || null;
        const latest = trends[trends.length - 1] || null;
        const prev = trends[trends.length - 2] || null;
        const latestVal = latest && Number.isFinite(Number(latest.total_value)) ? +Number(latest.total_value).toFixed(2) : '--';
        const delta = latest && prev && Number.isFinite(Number(latest.total_value)) && Number.isFinite(Number(prev.total_value))
            ? latest.total_value - prev.total_value
            : 0;
        let modal = document.getElementById('metric-item-trend-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'metric-item-trend-modal';
            modal.className = 'metric-trend-modal';
            modal.addEventListener('click', e => {
                if (e.target === modal) modal.classList.remove('open');
            });
        }
        attachTrendModalToVisibleRoot(modal);
        modal.dataset.trendKind = kind;
        modal.dataset.trendLabel = cleanLabel;
        modal.innerHTML = `
            <div class="metric-trend-dialog">
                <div class="metric-trend-head" style="background:linear-gradient(135deg,#172554,#0f766e);">
                    <div>
                        <h3>${escapeHTML(rt('report.trend.itemModalTitle', { kind: titleKind }))}</h3>
                        <p>${escapeHTML(cleanLabel)} · ${escapeHTML(rt('report.trend.monthlySamplingSummary', { months: data.months || 6 }))}</p>
                    </div>
                    <button class="metric-trend-close" onclick="document.getElementById('metric-item-trend-modal').classList.remove('open')">&times;</button>
                </div>
                <div class="metric-trend-body">
                    <div class="metric-trend-kpis">
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.latestOverallValue'))}</div>
                            <div class="value">${latestVal}</div>
                            <div class="data-source-note">${escapeHTML(rt('report.trend.comparedWithPreviousMonth', { delta: formatDelta(+delta.toFixed(2)) }))}</div>
                        </div>
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.monthCoverage'))}</div>
                            <div class="value">${trends.length}</div>
                            <div class="data-source-note">${latest ? escapeHTML(rt('report.trend.latestSnapshotAt', { time: formatReportDateTime(latest.created_at) })) : escapeHTML(rt('report.trend.noSnapshot'))}</div>
                        </div>
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(kind === 'manual' ? rt('report.trend.latestScoreImpact') : rt('report.trend.dimensionCount'))}</div>
                            <div class="value">${kind === 'manual' && latest ? +Number(latest.total_score || 0).toFixed(2) : Object.keys(latest?.series || {}).length}</div>
                            <div class="data-source-note">${escapeHTML(kind === 'manual' ? rt('report.trend.scoreImpactNote') : rt('report.trend.customerGroupDimension'))}</div>
                        </div>
                    </div>
                    <div class="metric-trend-grid">
                        <div class="metric-chart-card">
                            <div class="metric-chart-title">
                                <strong>${escapeHTML(rt('report.trend.last6MonthLineChart'))}</strong>
                                <span>${kind === 'manual' || !targets ? escapeHTML(rt('report.trend.overallAndTopChanges')) : `${escapeHTML(rt('report.trend.overallDimensionTargetPrefix'))} ${renderTargetSummaryInline(targets)}`}</span>
                            </div>
                            ${buildItemTrendChart(trends, { title: cleanLabel, targets })}
                        </div>
                        <div class="metric-chart-card">
                            <div class="metric-chart-title">
                                <strong>${escapeHTML(rt('report.trend.latestDimensionChanges'))}</strong>
                                <span>${escapeHTML(rt('report.trend.latestVsPrevious'))}</span>
                            </div>
                            <div class="category-change-list">${buildItemTrendTable(trends, kind)}</div>
                        </div>
                    </div>
                    <div class="metric-chart-card metric-monthly-detail-card">
                        <div class="metric-chart-title">
                            <strong>${escapeHTML(rt('report.trend.monthlyDetails'))}</strong>
                            <span>${escapeHTML(rt('report.trend.monthlyDetailsNote'))}</span>
                        </div>
                        ${buildMonthlyTrendDetailsTable(trends, kind)}
                    </div>
                </div>
            </div>
        `;
        modal.classList.add('open');
    }).catch(err => {
        showToast(rt('report.trend.metricTrendLoadFailedWithMessage', { message: err.message || err }), 'error');
    });
}

window.openMetricItemTrendModal = openMetricItemTrendModal;

document.addEventListener('click', e => {
    const target = e.target && e.target.closest ? e.target.closest('.metric-trend-link') : null;
    if (!target) return;
    const label = target.dataset.trendLabel || '';
    const kind = target.dataset.trendKind || 'metric';
    if (!label) return;
    e.preventDefault();
    e.stopPropagation();
    openMetricItemTrendModal(label, kind);
});

function collectDimensionChanges(trends, field) {
    const latest = trends[trends.length - 1] || null;
    const prev = trends[trends.length - 2] || null;
    if (!latest) return [];
    const keys = new Set();
    Object.keys(latest[field] || {}).forEach(key => keys.add(key));
    if (prev) Object.keys(prev[field] || {}).forEach(key => keys.add(key));
    return Array.from(keys).map(key => {
        const latestCount = latest[field]?.[key] || 0;
        const prevCount = prev ? (prev[field]?.[key] || 0) : 0;
        const values = trends.map(item => item[field]?.[key] || 0);
        return {
            name: key,
            latestCount,
            delta: prev ? latestCount - prevCount : 0,
            range: Math.max(...values) - Math.min(...values)
        };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.latestCount - a.latestCount);
}

function buildWarningDimensionList(trends, field, emptyText) {
    const items = collectDimensionChanges(trends, field).slice(0, 12);
    if (!items.length) return `<div class="data-source-note">${escapeHTML(emptyText)}</div>`;
    const maxCount = Math.max(...items.map(item => item.latestCount), 1);
    return items.map(item => {
        const major = Math.abs(item.delta) >= 3 || item.range >= 5;
        const width = Math.max(4, item.latestCount / maxCount * 100);
        return `
            <div class="category-change-item ${major ? 'major' : ''}">
                <div>
                    <div class="category-change-name" title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</div>
                    <div class="category-change-bar"><span style="width:${width.toFixed(1)}%"></span></div>
                </div>
                <div>
                    <div class="category-change-delta ${item.delta ? 'changed' : ''}">${item.latestCount} (${formatDelta(item.delta)})</div>
                    <div style="font-size:10px;color:#94a3b8;text-align:right;">${escapeHTML(rt('report.trend.daysRange', { days: 90, range: item.range }))}</div>
                </div>
            </div>
        `;
    }).join('');
}

function collectCategoryChanges(trends) {
    const latest = trends[trends.length - 1] || null;
    const prev = trends[trends.length - 2] || null;
    if (!latest) return [];
    const cats = new Set();
    Object.keys(latest.category_counts || {}).forEach(cat => cats.add(cat));
    if (prev) Object.keys(prev.category_counts || {}).forEach(cat => cats.add(cat));
    return Array.from(cats).map(cat => {
        const latestCount = latest.category_counts?.[cat]?.sub_metric_count || 0;
        const prevCount = prev ? (prev.category_counts?.[cat]?.sub_metric_count || 0) : 0;
        const values = trends.map(item => item.category_counts?.[cat]?.sub_metric_count || 0);
        return {
            cat,
            latestCount,
            delta: prev ? latestCount - prevCount : 0,
            min: Math.min(...values),
            max: Math.max(...values),
            range: Math.max(...values) - Math.min(...values)
        };
    }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.latestCount - a.latestCount);
}

function buildCategoryChangeList(trends) {
    const changes = collectCategoryChanges(trends);
    if (!changes.length) return `<div class="data-source-note">${escapeHTML(rt('report.trend.noCategorySubMetricData'))}</div>`;
    const maxCount = Math.max(...changes.map(item => item.latestCount), 1);
    return changes.map(item => {
        const major = Math.abs(item.delta) >= 5 || item.range >= 8;
        const width = Math.max(4, item.latestCount / maxCount * 100);
        return `
            <div class="category-change-item ${major ? 'major' : ''}">
                <div>
                    <div class="category-change-name" title="${escapeHTML(item.cat)}">${escapeHTML(item.cat)}</div>
                    <div class="category-change-bar"><span style="width:${width.toFixed(1)}%"></span></div>
                </div>
                <div>
                    <div class="category-change-delta ${item.delta ? 'changed' : ''}">${item.latestCount} (${formatDelta(item.delta)})</div>
                    <div style="font-size:10px;color:#94a3b8;text-align:right;">${escapeHTML(rt('report.trend.daysRange', { days: 90, range: item.range }))}</div>
                </div>
            </div>
        `;
    }).join('');
}

function openMetricCountTrendModal() {
    loadMetricCountTrendData().then(data => {
        const trends = Array.isArray(data.trends) ? data.trends : [];
        const latest = trends[trends.length - 1] || null;
        const prev = trends[trends.length - 2] || null;
        const overallDelta = latest && prev ? latest.overall_metric_count - prev.overall_metric_count : 0;
        const subDelta = latest && prev ? latest.sub_metric_count - prev.sub_metric_count : 0;
        let modal = document.getElementById('metric-count-trend-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'metric-count-trend-modal';
            modal.className = 'metric-trend-modal';
            modal.addEventListener('click', e => {
                if (e.target === modal) modal.classList.remove('open');
            });
        }
        attachTrendModalToVisibleRoot(modal);
        modal.innerHTML = `
            <div class="metric-trend-dialog">
                <div class="metric-trend-head">
                    <div>
                        <h3>${escapeHTML(rt('report.trend.metricCountHealthTitle'))}</h3>
                        <p>${escapeHTML(rt('report.trend.metricCountHealthSubtitle', { days: data.days || 90 }))}</p>
                    </div>
                    <button class="metric-trend-close" onclick="document.getElementById('metric-count-trend-modal').classList.remove('open')">&times;</button>
                </div>
                <div class="metric-trend-body">
                    <div class="metric-trend-kpis">
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.latestOverallMetricCount'))}</div>
                            <div class="value">${latest ? latest.overall_metric_count : '--'}</div>
                            <div class="data-source-note">${escapeHTML(rt('report.trend.comparedWithPrevious', { delta: formatDelta(overallDelta) }))}</div>
                        </div>
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.latestSubMetricCount'))}</div>
                            <div class="value">${latest ? latest.sub_metric_count : '--'}</div>
                            <div class="data-source-note">${escapeHTML(rt('report.trend.comparedWithPrevious', { delta: formatDelta(subDelta) }))}</div>
                        </div>
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.snapshotCoverage'))}</div>
                            <div class="value">${trends.length}</div>
                            <div class="data-source-note">${latest ? escapeHTML(rt('report.trend.latestSnapshotAt', { time: formatReportDateTime(latest.created_at) })) : escapeHTML(rt('report.trend.noSnapshot'))}</div>
                        </div>
                    </div>
                    <div class="metric-trend-grid">
                        <div class="metric-chart-card">
                            <div class="metric-chart-title">
                                <strong>${escapeHTML(rt('report.trend.metricCountChartTitle'))}</strong>
                                <span>${escapeHTML(rt('report.trend.orangePointNote'))}</span>
                            </div>
                            ${buildMetricLineChart(trends)}
                        </div>
                        <div class="metric-chart-card">
                            <div class="metric-chart-title">
                                <strong>${escapeHTML(rt('report.trend.categorySubMetricChanges'))}</strong>
                                <span>${escapeHTML(rt('report.trend.latestVsPrevious'))}</span>
                            </div>
                            <div class="category-change-list">${buildCategoryChangeList(trends)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        modal.classList.add('open');
    }).catch(err => {
        showToast(rt('report.trend.metricTrendLoadFailedWithMessage', { message: err.message || err }), 'error');
    });
}

window.openMetricCountTrendModal = openMetricCountTrendModal;

function openExpiringWarningTrendModal() {
    loadExpiringWarningTrendData().then(data => {
        const trends = Array.isArray(data.trends) ? data.trends : [];
        const latest = trends[trends.length - 1] || null;
        const prev = trends[trends.length - 2] || null;
        const totalDelta = latest && prev ? latest.total_warning_count - prev.total_warning_count : 0;
        const ticketDelta = latest && prev ? latest.expiring_ticket_count - prev.expiring_ticket_count : 0;
        const alertDelta = latest && prev ? latest.special_metric_alert_count - prev.special_metric_alert_count : 0;
        let modal = document.getElementById('expiring-warning-trend-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'expiring-warning-trend-modal';
            modal.className = 'metric-trend-modal';
            modal.addEventListener('click', e => {
                if (e.target === modal) modal.classList.remove('open');
            });
        }
        attachTrendModalToVisibleRoot(modal);
        modal.innerHTML = `
            <div class="metric-trend-dialog">
                <div class="metric-trend-head" style="background:linear-gradient(135deg,#451a03,#b91c1c);">
                    <div>
                        <h3>${escapeHTML(rt('report.trend.warningHealthTitle'))}</h3>
                        <p>${escapeHTML(rt('report.trend.warningHealthSubtitle', { days: data.days || 90 }))}</p>
                    </div>
                    <button class="metric-trend-close" onclick="document.getElementById('expiring-warning-trend-modal').classList.remove('open')">&times;</button>
                </div>
                <div class="metric-trend-body">
                    <div class="metric-trend-kpis">
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.latestTotalWarnings'))}</div>
                            <div class="value">${latest ? latest.total_warning_count : '--'}</div>
                            <div class="data-source-note">${escapeHTML(rt('report.trend.comparedWithPrevious', { delta: formatDelta(totalDelta) }))}</div>
                        </div>
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.expiringTickets'))}</div>
                            <div class="value">${latest ? latest.expiring_ticket_count : '--'}</div>
                            <div class="data-source-note">${escapeHTML(rt('report.trend.comparedWithPrevious', { delta: formatDelta(ticketDelta) }))}</div>
                        </div>
                        <div class="metric-trend-kpi">
                            <div class="label">${escapeHTML(rt('report.trend.specialMetricAlerts'))}</div>
                            <div class="value">${latest ? latest.special_metric_alert_count : '--'}</div>
                            <div class="data-source-note">${escapeHTML(rt('report.trend.comparedWithPrevious', { delta: formatDelta(alertDelta) }))}</div>
                        </div>
                    </div>
                    <div class="metric-trend-grid">
                        <div style="display:grid;gap:16px;min-width:0;">
                            <div class="metric-chart-card">
                                <div class="metric-chart-title">
                                    <strong>${escapeHTML(rt('report.trend.warningCountChartTitle'))}</strong>
                                    <span>${escapeHTML(rt('report.trend.warningCountChartSub'))}</span>
                                </div>
                                ${buildWarningLineChart(trends)}
                            </div>
                            <div class="metric-chart-card">
                                <div class="metric-chart-title">
                                    <strong>${escapeHTML(rt('report.trend.warningTypeChanges'))}</strong>
                                    <span>${escapeHTML(rt('report.trend.showTopSixLatestVolatile'))}</span>
                                </div>
                                ${buildDimensionLineChart(trends, 'type_counts', rt('report.trend.warningType'))}
                            </div>
                            <div class="metric-chart-card">
                                <div class="metric-chart-title">
                                    <strong>${escapeHTML(rt('report.trend.networkChanges'))}</strong>
                                    <span>${escapeHTML(rt('report.trend.showTopSixNetworks'))}</span>
                                </div>
                                ${buildDimensionLineChart(trends, 'network_counts', rt('report.trend.networkDimension'))}
                            </div>
                        </div>
                        <div style="display:grid;gap:16px;">
                            <div class="metric-chart-card">
                                <div class="metric-chart-title">
                                    <strong>${escapeHTML(rt('report.trend.byWarningType'))}</strong>
                                    <span>${escapeHTML(rt('report.trend.latestVsPrevious'))}</span>
                                </div>
                                <div class="category-change-list">${buildWarningDimensionList(trends, 'type_counts', rt('report.trend.noWarningTypeData'))}</div>
                            </div>
                            <div class="metric-chart-card">
                                <div class="metric-chart-title">
                                    <strong>${escapeHTML(rt('report.trend.byNetworkDimension'))}</strong>
                                    <span>${escapeHTML(rt('report.trend.latestVsPrevious'))}</span>
                                </div>
                                <div class="category-change-list">${buildWarningDimensionList(trends, 'network_counts', rt('report.trend.noNetworkDimensionData'))}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        modal.classList.add('open');
    }).catch(err => {
        showToast(rt('report.trend.warningTrendLoadFailedWithMessage', { message: err.message || err }), 'error');
    });
}

window.openExpiringWarningTrendModal = openExpiringWarningTrendModal;

function getJSONBytes(value) {
    try {
        return new Blob([JSON.stringify(value)]).size;
    } catch (e) {
        return 0;
    }
}

function isReportCompressionSupported() {
    return typeof CompressionStream !== 'undefined' && typeof TextEncoder !== 'undefined';
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function compressTextToTransportField(text, algorithm = 'gzip') {
    const normalizedText = typeof text === 'string' ? text : '';
    const inputBytes = new TextEncoder().encode(normalizedText);
    const stream = new Blob([inputBytes]).stream().pipeThrough(new CompressionStream(algorithm));
    const compressedBuffer = await new Response(stream).arrayBuffer();
    const compressedBytes = new Uint8Array(compressedBuffer);
    return {
        encoding: `${algorithm}+base64`,
        originalBytes: inputBytes.byteLength,
        compressedBytes: compressedBytes.byteLength,
        data: bytesToBase64(compressedBytes)
    };
}

async function buildCompressedSnapshotBody(snapshot, algorithm = 'gzip') {
    const compressedSnapshot = await compressTextToTransportField(JSON.stringify(snapshot), algorithm);
    return {
        transport: {
            compression: `${algorithm}+base64`,
            payload: 'snapshot',
            originalBytes: compressedSnapshot.originalBytes,
            compressedBytes: compressedSnapshot.compressedBytes
        },
        compressedSnapshot
    };
}

async function buildCompressedReportSaveBody(payload, algorithm = 'gzip') {
    const compressedReportPayload = await compressTextToTransportField(JSON.stringify(payload), algorithm);
    return {
        transport: {
            compression: `${algorithm}+base64`,
            payload: 'report_save',
            originalBytes: compressedReportPayload.originalBytes,
            compressedBytes: compressedReportPayload.compressedBytes
        },
        compressedReportPayload
    };
}

function logReportSaveStep(step, detail) {
    const prefix = '%c[Report Save]';
    const style = 'color:#2563eb;font-weight:700;';
    if (detail === undefined) {
        console.info(prefix, style, step);
    } else {
        console.info(prefix, style, step, detail);
    }
}

function logReportSaveError(step, error, detail) {
    const prefix = '%c[Report Save]';
    const style = 'color:#ef4444;font-weight:700;';
    console.error(prefix, style, `${step} failed`, detail || '', error);
}

async function putSnapshotWithCompression(snapshotId, snapshot, reason = 'snapshot-update') {
    const path = `/api/sla/snapshots/${snapshotId}`;
    const stats = {
        reason,
        requestBytes: getJSONBytes(snapshot),
        topMetricCount: Array.isArray(snapshot && snapshot.topMetrics) ? snapshot.topMetrics.length : 0,
        expiringTicketCount: Array.isArray(snapshot && snapshot.expiringTickets) ? snapshot.expiringTickets.length : 0
    };

    try {
        logReportSaveStep('开始写回 SLA 快照', stats);
        return await API.put(path, snapshot);
    } catch (e) {
        logReportSaveError('普通 SLA 快照写回链路', e, stats);
        if (!isReportCompressionSupported()) {
            throw e;
        }

        logReportSaveStep('普通写回失败，开始构建 gzip 压缩重试请求', { reason });
        const compressedBody = await buildCompressedSnapshotBody(snapshot, 'gzip');
        const compressedStats = {
            reason,
            requestBytes: getJSONBytes(compressedBody),
            originalBytes: compressedBody.transport.originalBytes,
            compressedBytes: compressedBody.transport.compressedBytes
        };
        logReportSaveStep('gzip 压缩快照写回请求已构建', compressedStats);
        const result = await API.put(path, compressedBody);
        logReportSaveStep('gzip 压缩快照写回成功', compressedStats);
        return result;
    }
}

async function postReportSaveWithCompression(payload) {
    const path = '/api/db/save';
    const stats = {
        requestBytes: getJSONBytes(payload),
        catScoreCount: Array.isArray(payload && payload.cat_scores) ? payload.cat_scores.length : 0,
        metricDataCount: Array.isArray(payload && payload.metric_data) ? payload.metric_data.length : 0,
        expiringTicketCount: Array.isArray(payload && payload.raw_data && payload.raw_data.expiringTickets) ? payload.raw_data.expiringTickets.length : 0,
        specialMetricAlertCount: Array.isArray(payload && payload.raw_data && payload.raw_data.specialMetricAlerts) ? payload.raw_data.specialMetricAlerts.length : 0,
        hasExcelData: !!(payload && payload.excel_data)
    };

    try {
        logReportSaveStep('开始普通报表入库请求', stats);
        return await API.post(path, payload);
    } catch (e) {
        logReportSaveError('普通报表入库链路', e, stats);
        if (!isReportCompressionSupported()) {
            throw e;
        }

        logReportSaveStep('普通入库失败，开始构建 gzip 压缩重试请求');
        const compressedBody = await buildCompressedReportSaveBody(payload, 'gzip');
        const compressedStats = {
            requestBytes: getJSONBytes(compressedBody),
            originalBytes: compressedBody.transport.originalBytes,
            compressedBytes: compressedBody.transport.compressedBytes
        };
        logReportSaveStep('gzip 压缩报表入库请求已构建', compressedStats);
        const result = await API.post(path, compressedBody);
        logReportSaveStep('gzip 压缩报表入库成功', compressedStats);
        return result;
    }
}

const defaultManualAdjustItems = [
    { type: '扣分', name: '人为事故 (含整改逾期、错认漏认)', unit: 10, cap: null, desc: '10分/次, 上限无' },
    { type: '扣分', name: '恢复超60分钟事故 (华为原因)', unit: 5, cap: null, desc: '5分/次, 上限无' },
    { type: '扣分', name: '严重投诉 (CXO/Operation Head级别)', unit: 10, cap: null, desc: '10分/次, 上限无' },
    { type: '扣分', name: '严重违规 (瞒报、无方案/越权操作)', unit: 5, cap: null, desc: '5分/次, 上限无' },
    { type: '扣分', name: '整改确认及执行逾期', unit: 3, cap: 5, desc: '3分/次, 上限5分' },
    { type: '扣分', name: '不合格的关闭整改单 (审计发现)', unit: 3, cap: 5, desc: '3分/次, 上限5分' },
    { type: '扣分', name: '未按要求完成整改 (含延期)', unit: 3, cap: 5, desc: '3分/次, 上限5分' },
    { type: '扣分', name: '不规范风险处理 (月度审计)', unit: 2, cap: 5, desc: '2分/次, 上限5分' },
    { type: '扣分', name: '风险确认/挂起/关闭逾期', unit: 2, cap: 5, desc: '2分/次, 上限5分' },
    { type: '扣分', name: 'FME离职超10天未清理账号', unit: 2, cap: 5, desc: '2分/次, 上限5分' },
    { type: '扣分', name: 'WFM无授权违规操作 (未发客户延期邮件)', unit: 2, cap: 5, desc: '2分/次, 上限5分' },
    { type: '扣分', name: 'WFM操作回退 (代表处服务质量原因)', unit: 3, cap: 5, desc: '3分/次, 上限5分' },
    { type: '扣分', name: '未按时完成回退复盘 (SLA:10天)', unit: 3, cap: 5, desc: '3分/次, 上限5分' },
    { type: '扣分', name: 'ITR-FRT达不到98.5% (按月)', unit: 2, cap: 5, desc: '2分/次, 上限5分' },
    { type: '加分', name: '跨产品逃生演练及Jam宣传', unit: 2, cap: 7, desc: '2分/次, 上限7分' },
    { type: '加分', name: '邀约客户交流呈现服务价值', unit: 2, cap: 10, desc: '2分/次, 上限10分' }
];
let manualAdjustItems = [...defaultManualAdjustItems];
let editingAdjustItemIndex = null;
let manualAdjustSortDraft = [];
let manualAdjustSortDragIdx = null;

function getOrderedManualAdjustEntries() {
    return manualAdjustItems
        .map((item, idx) => ({ item, idx }))
        .filter(entry => !entry.item.deleted)
        .sort((a, b) => {
            const aOrder = Number.isFinite(Number(a.item.sortOrder)) ? Number(a.item.sortOrder) : a.idx;
            const bOrder = Number.isFinite(Number(b.item.sortOrder)) ? Number(b.item.sortOrder) : b.idx;
            return aOrder - bOrder || a.idx - b.idx;
        });
}

function calculateManualAdjustScore(item, count) {
    if (!item || item.deleted) return 0;
    const occurrences = parseInt(count, 10) || 0;
    if (occurrences <= 0) return 0;

    const unit = parseFloat(item.unit);
    if (Number.isNaN(unit)) return 0;

    let score = occurrences * unit;
    const cap = item.cap === null || item.cap === undefined || item.cap === '' ? null : parseFloat(item.cap);
    if (cap !== null && !Number.isNaN(cap) && score > cap) score = cap;

    return item.type === '扣分' ? -score : score;
}

function buildManualAdjustDesc(unit, cap) {
    return cap === null ? `${unit}分/次, 上限无` : `${unit}分/次, 上限${cap}分`;
}

function formatManualAdjustDesc(item) {
    const hasCap = item && item.cap !== null && item.cap !== undefined && item.cap !== '';
    return hasCap
        ? rt('report.adjust.ruleWithCap', { unit: item.unit, cap: item.cap })
        : rt('report.adjust.ruleNoCap', { unit: item ? item.unit : 0 });
}

async function saveSlaPrefPatch(updates) {
    await API.patch('/api/sla/config/prefs', { updates });
}

async function patchSlaTarget(targetKey, patch) {
    await API.patch(`/api/sla/targets/${encodeURIComponent(targetKey)}`, patch);
}

async function saveManualAdjustItemsConfig(successMessage) {
    if (!globalConfig.prefs) globalConfig.prefs = {};
    globalConfig.prefs.manualAdjustItems = manualAdjustItems;

    await saveSlaPrefPatch({ manualAdjustItems });
    showToast(successMessage, 'success');
    renderCurrentSnapshot();
}

function syncManualMetricGroupLabel(oldLabel, newLabel) {
    if (!oldLabel || !newLabel || oldLabel === newLabel || !Array.isArray(metricGroups)) return false;
    let changed = false;
    metricGroups = metricGroups.map(group => {
        if (!Array.isArray(group.metrics)) return group;
        const nextMetrics = group.metrics.map(label => {
            if (label === oldLabel) {
                changed = true;
                return newLabel;
            }
            return label;
        });
        return { ...group, metrics: Array.from(new Set(nextMetrics)) };
    });
    return changed;
}

function removeManualMetricFromGroups(label) {
    if (!label || !Array.isArray(metricGroups)) return false;
    let changed = false;
    metricGroups = metricGroups.map(group => {
        if (!Array.isArray(group.metrics)) return group;
        const nextMetrics = group.metrics.filter(metricLabel => metricLabel !== label);
        if (nextMetrics.length !== group.metrics.length) changed = true;
        return { ...group, metrics: nextMetrics };
    });
    return changed;
}

function getTargetMonthDefaultByDay(date = new Date()) {
    if (window.ReportSnapshotTargetMonth && typeof window.ReportSnapshotTargetMonth.inferFromDate === 'function') {
        return window.ReportSnapshotTargetMonth.inferFromDate(date);
    }
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

function getDefaultTargetMonth() {
    try {
        const saved = JSON.parse(localStorage.getItem(REPORT_TARGET_MONTH_KEY) || '{}');
        const month = parseInt(saved.month, 10);
        if (saved.date === getTodayKey() && month >= 1 && month <= 12) return month;
    } catch (e) { }
    return getTargetMonthDefaultByDay();
}

function setReportTargetMonth(month) {
    const normalized = parseInt(month, 10);
    if (normalized >= 1 && normalized <= 12) {
        localStorage.setItem(REPORT_TARGET_MONTH_KEY, JSON.stringify({
            month: normalized,
            date: getTodayKey()
        }));
    }
}

function getSnapshotSuggestedTargetMonth(snapshot) {
    if (window.ReportSnapshotTargetMonth && typeof window.ReportSnapshotTargetMonth.resolve === 'function') {
        return window.ReportSnapshotTargetMonth.resolve(snapshot);
    }
    const month = parseInt(snapshot && snapshot.selectedTargetMonth, 10);
    if (month >= 1 && month <= 12) return month;
    const timestamp = snapshot && (snapshot.timestamp || snapshot.created_at || snapshot.createdAt);
    return timestamp ? getTargetMonthDefaultByDay(new Date(timestamp)) : null;
}

function renderReportMonthOptions(preserveValue = true) {
    const monthSel = document.getElementById('target-month-select');
    if (!monthSel) return;
    const previousValue = preserveValue ? monthSel.value : '';
    let monthOptions = '';
    for (let i = 1; i <= 12; i++) {
        monthOptions += `<option value="${i}">${rt('report.month.option', { month: i })}</option>`;
    }
    monthSel.innerHTML = monthOptions;
    monthSel.value = previousValue || getDefaultTargetMonth();
    if (!monthSel.value) monthSel.value = getDefaultTargetMonth();
}

function renderSnapshotFilterSetting() {
    const input=document.getElementById('report-min-source-tables');if(!input)return;
    input.value=reportMinSourceTables;input.disabled=localStorage.getItem('tools_role')!=='admin';
    document.getElementById('report-snapshot-filter-label').textContent=rt('report.snapshot.minSources');
    const ready=reportSourceSnapshots.filter(window.ReportSnapshotFilter.hasMetrics),hidden=ready.length-snapshots.length;
    const hint=rt('report.snapshot.filterHelp')+(hidden?' · '+rt('report.snapshot.hiddenCount',{count:hidden}):'');
    document.getElementById('report-snapshot-filter-setting').title=hint+(input.disabled?' · '+rt('report.snapshot.filterAdmin'):'');
    input.setAttribute('aria-label',rt('report.snapshot.minSources'));input.setAttribute('aria-describedby','report-snapshot-filter-help');
    document.getElementById('report-snapshot-filter-help').textContent=hint;
}
window.updateReportSnapshotFilter=async function(){
    const input=document.getElementById('report-min-source-tables'),minimum=Number(input.value);
    if(!input.value.trim()||!window.ReportSnapshotFilter.valid(minimum)){input.value=reportMinSourceTables;showToast(rt('report.snapshot.filterInvalid'),'error');return;}
    if(minimum===reportMinSourceTables)return;input.disabled=true;
    try{
        await API.post('/api/db/config/report_snapshot_filter',{minSourceTables:minimum});
        reportMinSourceTables=minimum;snapshots=reportSourceSnapshots.filter(isReportEligibleSnapshot);
        renderSnapshotOptions();renderSnapshotFilterSetting();
        const selected=snapshots.find(snapshot=>snapshot.id===currentSnapshot?.id);
        if(selected){document.getElementById('snapshot-select').value=selected.id;window._preserveMatrixFilters=true;try{renderCurrentSnapshot();}finally{window._preserveMatrixFilters=false;}}else if(snapshots.length){loadSelectedSnapshot();}else{currentSnapshot=null;renderNoReportReadyState();}
        showToast(rt('report.snapshot.filterSaved'),'success');
    }catch(error){showToast(rt('report.toast.saveFailed')+': '+error.message,'error');}
    finally{renderSnapshotFilterSetting();}
};

function renderSnapshotOptions() {
    const sel = document.getElementById('snapshot-select');
    if (!sel) return;
    const previousValue = sel.value;
    if (!snapshots.length) {
        sel.innerHTML = `<option value="">${rt('report.snapshot.none')}</option>`;
        return;
    }
    sel.innerHTML = snapshots.map(s => {
        const d = new Date(s.timestamp);
        const tsStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const fileCount = window.ReportSnapshotFilter.sourceCount(s);
        return `<option value="${s.id}">${tsStr} (${rt('report.snapshot.optionSourceCount', { count: fileCount })})</option>`;
    }).join('');
    sel.value = snapshots.find(s => s.id === previousValue) ? previousValue : snapshots[0].id;
}

function renderNoReportReadyState() {
    const content = document.getElementById('report-content');
    if (!content) return;
    content.innerHTML = `<div class="empty-state"><h3>${rt('report.empty.noReadyTitle')}</h3><p>${rt(reportSourceSnapshots.some(window.ReportSnapshotFilter.hasMetrics)?'report.empty.filteredBody':'report.empty.noReadyBody',{count:reportMinSourceTables})}</p></div>`;
}

function renderReportLoadFailedState() {
    const content = document.getElementById('report-content');
    if (!content) return;
    content.innerHTML = `<div class="empty-state"><h3>${rt('report.empty.loadFailedTitle')}</h3><p>${rt('report.empty.loadFailedBody')}</p></div>`;
}

async function initReport() {
    try {
        const mode = API.getSourceMode('report_sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;
        const [snapData, catData, configData, groupData, filterConfig] = await Promise.all([
            API.get(`/api/sla/snapshots${query}`),
            API.get(`/api/sla/categories${query}`),
            API.get(`/api/sla/config${query}`),
            API.get(`/api/sla/groups${query}`),
            API.get('/api/db/config/report_snapshot_filter')
        ]);

        reportSourceSnapshots = Array.isArray(snapData)?snapData:[];
        reportMinSourceTables = window.ReportSnapshotFilter.normalize(filterConfig?.minSourceTables);
        snapshots = reportSourceSnapshots.filter(isReportEligibleSnapshot);
        currentSnapshot = null;
        renderSnapshotFilterSetting();
        categories = catData || ['TE', 'ORG', 'ET', 'VDF'];
        globalConfig = configData || { targets: {}, prefs: {} };
        metricGroups = groupData || [];

        if (globalConfig.prefs && globalConfig.prefs.manualAdjustItems) {
            manualAdjustItems = globalConfig.prefs.manualAdjustItems;
        } else {
            manualAdjustItems = [...defaultManualAdjustItems];
        }

        if (globalConfig.prefs && globalConfig.prefs.i18nMap) {
            // Strip any legacy HTML tags that might have been saved
            const loadedI18n = globalConfig.prefs.i18nMap;
            const cleanI18n = {};
            for (const [k, v] of Object.entries(loadedI18n)) {
                if (v && v.includes('<br>')) {
                    // Extract just the English text if it matches the old format
                    const match = v.match(/<span[^>]*>(.*?)<\/span>/);
                    cleanI18n[k] = match ? match[1] : v.replace(/<[^>]+>/g, '');
                } else {
                    cleanI18n[k] = v;
                }
            }
            i18nMap = { ...i18nMap, ...cleanI18n };
        }

        buildLabelTargetMap();

        // Populate month selector
        const monthSel = document.getElementById('target-month-select');
        renderReportMonthOptions(false);
        monthSel.dataset.userChanged = 'false';
        monthSel.onchange = () => {
            monthSel.dataset.userChanged = 'true';
            renderCurrentSnapshot();
        };

        const sel = document.getElementById('snapshot-select');
        if (!snapshots.length) {
            sel.innerHTML = `<option value="">${rt('report.snapshot.none')}</option>`;
            renderNoReportReadyState();
            if (window.renderReportSourcePanel) window.renderReportSourcePanel();
            return;
        }

        renderSnapshotOptions();

        // Default to the first (latest) snapshot
        sel.value = snapshots[0].id;
        loadSelectedSnapshot();
        if (window.renderReportSourcePanel) window.renderReportSourcePanel();
    } catch (e) {
        window.ToolsPageStartup?.issue('data',e);
        showToast(rt('report.toast.loadFailed'), 'error');
        console.error(e);
        if (window.renderReportSourcePanel) window.renderReportSourcePanel();
        renderReportLoadFailedState();
    }
}

function buildLabelTargetMap() {
    const { targets, prefs } = globalConfig;
    labelToTargetMap = {};
    labelToTargetKeyMap = {};

    if (prefs) {
        Object.keys(prefs).forEach(secId => {
            const pref = prefs[secId];
            const cleanSecId = secId.startsWith('sla_prefs_') ? secId.substring(10) : secId;

            if (pref.customMetrics) {
                pref.customMetrics.forEach(rule => {
                    const key = `${cleanSecId}_${rule.id}`;
                    if (targets && targets[key]) {
                        labelToTargetMap[rule.label] = targets[key];
                        labelToTargetKeyMap[rule.label] = key;
                    }
                });
            }
        });
    }

    // Map manual targets
    if (targets) {
        Object.keys(targets).forEach(k => {
            if (k.startsWith('manual_') && targets[k].label) {
                labelToTargetMap[targets[k].label] = targets[k];
                labelToTargetKeyMap[targets[k].label] = k;
            }
        });
    }
}

function applyManualMetricTargetAutoFill(targetMonth) {
    const helper = window.ReportTargetAutoFill;
    if (!helper || typeof helper.inheritLatestTargets !== 'function' || !globalConfig.targets) return;

    Object.entries(globalConfig.targets).forEach(([targetKey, targetData]) => {
        if (!targetKey.startsWith('manual_') || !targetData || !targetData.label || !targetData.autoFill) return;
        const result = helper.inheritLatestTargets(targetData, targetMonth, categories);
        if (!result.changed) return;

        const saveKey = `${targetKey}:${targetMonth}`;
        if (inheritedTargetSavePromises.has(saveKey)) return;
        const savePromise = patchSlaTarget(targetKey, targetData)
            .catch(error => {
                console.error('Manual metric target auto-fill save error:', error);
                showToast(rt('report.toast.saveFailed'), 'error');
            })
            .finally(() => inheritedTargetSavePromises.delete(saveKey));
        inheritedTargetSavePromises.set(saveKey, savePromise);
    });
}

window.loadSelectedSnapshot = function () {
    const id = document.getElementById('snapshot-select').value;
    currentSnapshot = snapshots.find(s => s.id === id);
    if (currentSnapshot) {
        const monthSel = document.getElementById('target-month-select');
        if (monthSel) {
            monthSel.value = getSnapshotSuggestedTargetMonth(currentSnapshot) || getDefaultTargetMonth();
            monthSel.dataset.userChanged = 'false';
        }
        renderReport(currentSnapshot);
    }
};

window.renderCurrentSnapshot = function () {
    const monthSel = document.getElementById('target-month-select');
    if (monthSel) setReportTargetMonth(monthSel.value);
    if (currentSnapshot) {
        renderReport(currentSnapshot);
    }
};

window.toggleAutoStdScore = async function () {
    const cb = document.getElementById('auto-std-score-cb');
    const input = document.getElementById('custom-std-score-input');
    if (!cb || !input) return;
    input.disabled = cb.checked;

    if (!globalConfig.prefs) globalConfig.prefs = {};
    globalConfig.prefs.isAutoStandardTotalScore = cb.checked;
    try {
        await saveSlaPrefPatch({ isAutoStandardTotalScore: cb.checked });
        showToast(rt('report.toast.autoFillOn') || '配置已保存', 'success');
        if (currentSnapshot) renderReport(currentSnapshot);
    } catch (e) {
        console.error(e);
        showToast(rt('report.toast.saveFailed') || '保存失败', 'error');
    }
};

window.updateCustomStdScore = async function () {
    const input = document.getElementById('custom-std-score-input');
    if (!input) return;
    let val = parseFloat(input.value);
    if (isNaN(val) || val <= 0) val = 100;
    input.value = val;

    if (!globalConfig.prefs) globalConfig.prefs = {};
    globalConfig.prefs.customStandardTotalScore = val;
    try {
        await saveSlaPrefPatch({ customStandardTotalScore: val });
        showToast('配置已保存', 'success');
        if (currentSnapshot) renderReport(currentSnapshot);
    } catch (e) {
        console.error(e);
        showToast(rt('report.toast.saveFailed') || '保存失败', 'error');
    }
};

function parseNum(str) {
    if (str === undefined || str === null || str === '--') return NaN;
    const n = parseFloat(String(str).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? NaN : n;
}

function getPreviousReportSnapshot(snap) {
    if (!snap || !Array.isArray(snapshots) || snapshots.length < 2) return null;
    const currentIndex = snapshots.findIndex(item => item && item.id === snap.id);
    if (currentIndex >= 0 && currentIndex + 1 < snapshots.length) {
        return snapshots[currentIndex + 1];
    }

    const currentTime = new Date(snap.timestamp || 0).getTime();
    if (!Number.isFinite(currentTime) || currentTime <= 0) return null;
    return snapshots
        .filter(item => item && item.id !== snap.id && new Date(item.timestamp || 0).getTime() < currentTime)
        .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())[0] || null;
}

function buildPreviousMetricValueMap(prevSnap) {
    const map = {};
    const metrics = Array.isArray(prevSnap && prevSnap.topMetrics) ? prevSnap.topMetrics : [];
    metrics.forEach(metric => {
        if (!metric || !metric.label) return;
        map[`${metric.label}@@整体`] = metric.value;
        (metric.subMetrics || []).forEach(sub => {
            if (!sub || !sub.category) return;
            map[`${metric.label}@@${sub.category}`] = sub.value;
        });
    });
    return map;
}

function normalizeTrendNumber(value) {
    if (value === undefined || value === null || value === '' || value === '--') return NaN;
    const text = String(value).trim();
    if (!/[0-9]/.test(text)) return NaN;
    return parseNum(text);
}

function renderMetricTrend(currentValue, previousValue) {
    const currentNum = normalizeTrendNumber(currentValue);
    const previousNum = normalizeTrendNumber(previousValue);
    if (!Number.isFinite(currentNum) || !Number.isFinite(previousNum)) return '';

    const delta = currentNum - previousNum;
    if (Math.abs(delta) < 0.000001) return '';

    const direction = delta > 0 ? 'up' : 'down';
    const arrow = delta > 0 ? '▲' : '▼';
    const title = delta > 0
        ? rt('report.tooltip.trendUp', { value: formatScoreValue(Math.abs(delta)) })
        : rt('report.tooltip.trendDown', { value: formatScoreValue(Math.abs(delta)) });
    return `<span class="metric-trend ${direction}" title="${escapeHTML(title)}">${arrow}</span>`;
}

function isProportionalScoringEnabled(targetData) {
    return !!(targetData && targetData.proportionalScoring);
}

function getCategoryTargetValue(targetData, month, category) {
    if (!targetData || !month || !category) return undefined;
    const monthTargets = targetData.categoryTargets && targetData.categoryTargets[String(month)];
    if (!monthTargets || typeof monthTargets !== 'object' || Array.isArray(monthTargets)) return undefined;
    const value = monthTargets[category];
    return value === '' || value === null || value === undefined ? undefined : value;
}

function getEffectiveTargetValue(targetData, month, category) {
    const categoryValue = getCategoryTargetValue(targetData, month, category);
    if (categoryValue !== undefined) return categoryValue;
    const globalValue = targetData && targetData[String(month)];
    return globalValue === '' || globalValue === null || globalValue === undefined ? undefined : globalValue;
}

function hasCategoryTargets(targetData, month) {
    const monthTargets = targetData && targetData.categoryTargets && targetData.categoryTargets[String(month)];
    return !!(monthTargets && typeof monthTargets === 'object' && Object.values(monthTargets).some(value => value !== '' && value !== null && value !== undefined));
}

function clampScoreRatio(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(1, num));
}

function calculateTargetCompletionRatio(valNum, targetNum, condition) {
    if (!Number.isFinite(valNum) || !Number.isFinite(targetNum)) return 0;
    if (condition === 'lte') {
        if (valNum <= targetNum) return 1;
        if (valNum <= 0) return targetNum >= 0 ? 1 : 0;
        return clampScoreRatio(targetNum / valNum);
    }
    if (valNum >= targetNum) return 1;
    if (targetNum <= 0) return valNum >= targetNum ? 1 : 0;
    return clampScoreRatio(valNum / targetNum);
}

function calculateOverachievementRatio(valNum, targetNum, condition) {
    if (!Number.isFinite(valNum) || !Number.isFinite(targetNum)) return 1;
    const targetBase = Math.abs(targetNum);
    if (targetBase <= 0) return 1;
    if (condition === 'lte') {
        if (valNum >= targetNum) return 1;
        return 1 + ((targetNum - valNum) / targetBase);
    }
    if (valNum <= targetNum) return 1;
    return 1 + ((valNum - targetNum) / targetBase);
}

function formatScoreValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '--';
    return Number.isInteger(num) ? String(num) : String(+num.toFixed(2));
}

function cleanMatrixCellFilterText(text) {
    return String(text || '')
        .replace(/比例计分\s*ON/g, '')
        .replace(/比例计分/g, '')
        .replace(/Proportional\s*ON/g, '')
        .replace(/Proportional/g, '')
        .replace(/✏️[\s\S]*$/, '')
        .trim();
}

function hasUsableMetricValue(metric) {
    if (!metric) return false;
    const hasGlobal = metric.value !== undefined && metric.value !== null && String(metric.value).trim() !== '' && String(metric.value).trim() !== '--';
    const hasSubs = Array.isArray(metric.subMetrics) && metric.subMetrics.some(sm => {
        return sm && sm.value !== undefined && sm.value !== null && String(sm.value).trim() !== '' && String(sm.value).trim() !== '--';
    });
    return hasGlobal || hasSubs;
}

function hasFilledValue(value) {
    if (value === undefined || value === null) return false;
    const text = String(value).trim();
    return text !== '' && text !== '--' && text !== '-';
}

function collectGlobalOnlyFailingMetricAlerts(targetMonth) {
    const metrics = window._currentOrderedMetrics || [];
    const activeCategories = Array.isArray(categories) ? categories : [];
    const alerts = [];

    metrics.forEach(metric => {
        if (!metric || !metric.label) return;
        const targetData = labelToTargetMap[metric.label];
        if (!targetData || targetData[targetMonth] === undefined || targetData[targetMonth] === '') return;

        const weight = targetData.weight !== undefined ? parseFloat(targetData.weight) : 1;
        if (!Number.isFinite(weight) || weight <= 0) return;

        const globalValue = metric.value;
        if (!hasFilledValue(globalValue)) return;

        const globalValNum = parseNum(globalValue);
        const targetNum = parseFloat(targetData[targetMonth]);
        if (!Number.isFinite(globalValNum) || !Number.isFinite(targetNum)) return;

        const condition = targetData.type || 'gte';
        let isFailing = false;
        let gap = 0;
        if (condition === 'gte' && globalValNum < targetNum) {
            isFailing = true;
            gap = targetNum - globalValNum;
        } else if (condition === 'lte' && globalValNum > targetNum) {
            isFailing = true;
            gap = globalValNum - targetNum;
        }
        if (!isFailing) return;

        const subMetrics = Array.isArray(metric.subMetrics) ? metric.subMetrics : [];
        const hasAnyCustomerValue = activeCategories.some(cat => {
            const sub = subMetrics.find(sm => sm && sm.category === cat);
            return sub && hasFilledValue(sub.value);
        });
        if (hasAnyCustomerValue) return;

        const isPercent = String(globalValue).includes('%');
        const targetRawText = String(targetData[targetMonth]);
        const targetText = `${condition === 'gte' ? '≥' : '≤'} ${targetRawText}${isPercent && !targetRawText.includes('%') ? '%' : ''}`;
        alerts.push({
            type: 'global_only_failing_metric',
            title: '全局不达标但客户群/代表处/区域无值',
            metric_label: metric.label,
            metricLabel: metric.label,
            weight,
            target_month: Number(targetMonth),
            targetMonth: Number(targetMonth),
            target_val: targetText,
            targetValue: targetText,
            global_val: String(globalValue),
            globalValue: String(globalValue),
            gap: `${+gap.toFixed(2)}${isPercent ? '%' : ''}`,
            condition,
            customer_groups_checked: activeCategories.slice(),
            created_at: new Date().toISOString(),
            _slaCleanText: `全局不达标但客户群/代表处/区域无值，差距 ${+gap.toFixed(2)}${isPercent ? '%' : ''}`
        });
    });

    return alerts;
}

function formatSnapshotTime(snapshot) {
    const d = new Date(snapshot && snapshot.timestamp);
    if (Number.isNaN(d.getTime())) return snapshot && snapshot.id ? `快照 ${snapshot.id}` : '未知快照';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function findLatestMetricSnapshotBefore(currentSnap, label) {
    const snapIdx = snapshots.findIndex(s => s.id === currentSnap.id);
    if (snapIdx < 0) return null;

    for (let i = snapIdx + 1; i < snapshots.length; i++) {
        const sourceSnap = snapshots[i];
        const sourceMetric = (sourceSnap.topMetrics || []).find(m => m.label === label);
        if (hasUsableMetricValue(sourceMetric)) {
            return {
                snapshot: sourceSnap,
                metric: sourceMetric,
                sourceText: formatSnapshotTime(sourceSnap)
            };
        }
    }
    return null;
}

function getManualAdjustAutoFillPrefs() {
    if (!globalConfig.prefs) globalConfig.prefs = {};
    if (!globalConfig.prefs.manualAdjustAutoFill || typeof globalConfig.prefs.manualAdjustAutoFill !== 'object') {
        globalConfig.prefs.manualAdjustAutoFill = {};
    }
    return globalConfig.prefs.manualAdjustAutoFill;
}

function isManualAdjustItemAutoFillEnabled(idxKey) {
    const prefs = getManualAdjustAutoFillPrefs();
    if (prefs[idxKey] !== undefined) {
        return !!prefs[idxKey];
    }
    const idx = parseInt(idxKey, 10);
    if (Array.isArray(manualAdjustItems) && Number.isInteger(idx) && manualAdjustItems[idx]) {
        return !!manualAdjustItems[idx].autoFill;
    }
    return false;
}

function hasManualAdjustValueForIndex(adjustData, itemIndex) {
    if (!adjustData || typeof adjustData !== 'object') return false;
    return categories.some(cat => {
        const val = adjustData[cat] && adjustData[cat][itemIndex];
        return val !== undefined && val !== null && String(val).trim() !== '' && !Number.isNaN(parseInt(val, 10));
    });
}

function hasManualAdjustDetailForCatAndIndex(details, cat, itemIndex) {
    if (window.ReportManualAdjustAutoFill?.hasDetailForCatAndIndex) {
        return window.ReportManualAdjustAutoFill.hasDetailForCatAndIndex(details, cat, itemIndex);
    }
    if (!details || typeof details !== 'object') return false;
    const detail = details[cat] && details[cat][itemIndex];
    if (!detail) return false;
    const records = normalizeManualAdjustDetailRecords(detail);
    return records.some(r => {
        return !!(r.reason && String(r.reason).trim())
            || !!(r.occurredAt && String(r.occurredAt).trim())
            || !!(r.recorder && String(r.recorder).trim())
            || (Array.isArray(r.attachments) && r.attachments.length > 0);
    });
}

function hasManualAdjustDetailForIndex(details, itemIndex) {
    if (window.ReportManualAdjustAutoFill?.hasDetailForIndex) {
        return window.ReportManualAdjustAutoFill.hasDetailForIndex(details, itemIndex, categories);
    }
    if (!details || typeof details !== 'object') return false;
    return categories.some(cat => hasManualAdjustDetailForCatAndIndex(details, cat, itemIndex));
}

function findLatestManualAdjustSnapshotBefore(currentSnap, itemIndex) {
    if (window.ReportManualAdjustAutoFill?.findLatestSourceSnapshot) {
        return window.ReportManualAdjustAutoFill.findLatestSourceSnapshot(
            currentSnap,
            itemIndex,
            snapshots,
            categories,
            formatSnapshotTime
        );
    }
    const snapIdx = snapshots.findIndex(s => s && s.id === currentSnap?.id);
    if (snapIdx < 0) return null;

    for (let i = snapIdx + 1; i < snapshots.length; i++) {
        const sourceSnap = snapshots[i];
        if (!sourceSnap) continue;
        const adjustData = sourceSnap.manualAdjustData || {};
        const adjustDetails = sourceSnap.manualAdjustDetails || {};
        if (hasManualAdjustValueForIndex(adjustData, itemIndex) || hasManualAdjustDetailForIndex(adjustDetails, itemIndex)) {
            return {
                snapshot: sourceSnap,
                adjustData,
                adjustDetails,
                sourceText: formatSnapshotTime(sourceSnap)
            };
        }
    }
    return null;
}

function applyManualAdjustAutoFillToSnapshot(snapshot) {
    if (!snapshot) return false;
    if (window.ReportManualAdjustAutoFill?.applyAutoFill) {
        const result = window.ReportManualAdjustAutoFill.applyAutoFill({
            snapshot,
            snapshots,
            categories,
            manualAdjustItems,
            prefs: getManualAdjustAutoFillPrefs(),
            formatTime: formatSnapshotTime,
            logMessageBuilder: ({ sourceText, recordCount, attachmentCount }) => {
                return rt('report.adjust.autoFillInheritedLog', {
                    source: sourceText,
                    count: recordCount,
                    attachments: attachmentCount
                });
            }
        });
        return result.changed;
    }

    const autoPrefs = getManualAdjustAutoFillPrefs();
    const candidateIndices = new Set();
    Object.keys(autoPrefs).forEach(idxKey => {
        if (autoPrefs[idxKey]) candidateIndices.add(idxKey);
    });
    if (Array.isArray(manualAdjustItems)) {
        manualAdjustItems.forEach((item, idx) => {
            if (item && !item.deleted && item.autoFill) {
                candidateIndices.add(String(idx));
            }
        });
    }

    if (!candidateIndices.size) return false;

    if (!snapshot.manualAdjustData || typeof snapshot.manualAdjustData !== 'object') {
        snapshot.manualAdjustData = {};
    }
    if (!snapshot.manualAdjustDetails || typeof snapshot.manualAdjustDetails !== 'object') {
        snapshot.manualAdjustDetails = {};
    }
    if (!snapshot.manualAdjustAutoFillSources || typeof snapshot.manualAdjustAutoFillSources !== 'object') {
        snapshot.manualAdjustAutoFillSources = {};
    }

    let changed = false;
    candidateIndices.forEach(idxKey => {
        const idx = parseInt(idxKey, 10);
        if (!Number.isInteger(idx) || !manualAdjustItems[idx] || manualAdjustItems[idx].deleted) return;

        const source = findLatestManualAdjustSnapshotBefore(snapshot, idxKey);
        if (!source) return;

        let itemHadEffect = false;
        categories.forEach(cat => {
            if (!snapshot.manualAdjustData[cat]) snapshot.manualAdjustData[cat] = {};
            if (!snapshot.manualAdjustDetails[cat]) snapshot.manualAdjustDetails[cat] = {};

            const currentVal = snapshot.manualAdjustData[cat][idxKey];
            const currentHasCount = currentVal !== undefined && currentVal !== null && String(currentVal).trim() !== '';
            const currentHasDetail = hasManualAdjustDetailForCatAndIndex(snapshot.manualAdjustDetails, cat, idxKey);

            if (currentHasCount && currentHasDetail) return;

            const sourceVal = source.adjustData && source.adjustData[cat] && source.adjustData[cat][idxKey];
            const sourceDetail = source.adjustDetails && source.adjustDetails[cat] && source.adjustDetails[cat][idxKey];
            const sourceRecords = normalizeManualAdjustDetailRecords(sourceDetail);

            let assignedCount = false;
            if (!currentHasCount) {
                if (sourceVal !== undefined && sourceVal !== null && String(sourceVal).trim() !== '') {
                    snapshot.manualAdjustData[cat][idxKey] = parseInt(sourceVal, 10) || 0;
                    assignedCount = true;
                    itemHadEffect = true;
                    changed = true;
                } else if (sourceRecords.length > 0) {
                    snapshot.manualAdjustData[cat][idxKey] = sourceRecords.length;
                    assignedCount = true;
                    itemHadEffect = true;
                    changed = true;
                }
            }

            if (!currentHasDetail && sourceRecords.length > 0) {
                const clonedRecords = sourceRecords.map(rec => ({
                    id: (globalThis.crypto?.randomUUID?.() || `record-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
                    occurredAt: String(rec.occurredAt || ''),
                    recorder: String(rec.recorder || ''),
                    reason: String(rec.reason || ''),
                    attachments: Array.isArray(rec.attachments)
                        ? rec.attachments.map(att => ({
                            url: String(att.url || ''),
                            name: String(att.name || ''),
                            size: typeof att.size === 'number' ? att.size : 0,
                            type: String(att.type || '')
                        }))
                        : [],
                    newFiles: []
                }));

                const totalAtts = clonedRecords.reduce((sum, r) => sum + r.attachments.length, 0);
                const logSummary = rt('report.adjust.autoFillInheritedLog', {
                    source: source.sourceText,
                    count: clonedRecords.length,
                    attachments: totalAtts
                });

                snapshot.manualAdjustDetails[cat][idxKey] = {
                    records: clonedRecords,
                    changeLog: [{ time: new Date().toISOString(), summary: logSummary }]
                };

                if (!currentHasCount && !assignedCount) {
                    snapshot.manualAdjustData[cat][idxKey] = clonedRecords.length;
                }

                itemHadEffect = true;
                changed = true;
            }
        });

        if (itemHadEffect) {
            snapshot.manualAdjustAutoFillSources[idxKey] = {
                snapshotId: source.snapshot.id,
                timestamp: source.snapshot.timestamp,
                label: source.sourceText
            };
        }
    });

    return changed;
}

function renderReport(snap) {
    const content = document.getElementById('report-content');
    const { topMetrics } = snap;
    const targetMonth = document.getElementById('target-month-select').value;
    applyManualMetricTargetAutoFill(targetMonth);
    const previousMetricValues = buildPreviousMetricValueMap(getPreviousReportSnapshot(snap));

    let metricCols = [...(topMetrics || [])];

    // Auto inject manual metrics that are missing in current snapshot
    if (globalConfig.targets) {
        Object.keys(globalConfig.targets).forEach(k => {
            if (k.startsWith('manual_') && globalConfig.targets[k].label) {
                const label = globalConfig.targets[k].label;
                const exists = metricCols.find(m => m.label === label);

                let valToUse = '--';
                let subsToUse = [];
                let autoFillSource = null;

                if (globalConfig.targets[k].autoFill) {
                    const source = findLatestMetricSnapshotBefore(snap, label);
                    if (source) {
                        valToUse = source.metric.value || '--';
                        if (source.metric.subMetrics) {
                            subsToUse = JSON.parse(JSON.stringify(source.metric.subMetrics));
                        }
                        autoFillSource = {
                            snapshotId: source.snapshot.id,
                            timestamp: source.snapshot.timestamp,
                            label: source.sourceText
                        };
                    }
                }

                if (!exists) {
                    const newMetric = {
                        id: `manual_m_${Date.now()}_${Math.random()}`,
                        colX: "手动指标",
                        valY: "总计",
                        colZ: "手动指标",
                        label: label,
                        value: valToUse,
                        subMetrics: subsToUse,
                        isManual: true,
                        autoFillSource
                    };
                    metricCols.push(newMetric);
                    if (globalConfig.targets[k].autoFill) {
                        if (!currentSnapshot.topMetrics) currentSnapshot.topMetrics = [];
                        currentSnapshot.topMetrics.push(newMetric);
                        putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'auto-fill-new-metric').catch(e => console.error('Auto-fill save error:', e));
                    }
                } else {
                    exists.isManual = true;
                    if (globalConfig.targets[k].autoFill) {
                        let changed = false;
                        if (!exists.value || exists.value === '--') { exists.value = valToUse; changed = true; }
                        if (!exists.subMetrics || exists.subMetrics.length === 0) { exists.subMetrics = subsToUse; changed = true; }
                        if (autoFillSource && (!exists.autoFillSource || exists.autoFillSource.snapshotId !== autoFillSource.snapshotId)) {
                            exists.autoFillSource = autoFillSource;
                            changed = true;
                        }

                        if (changed) {
                            if (!currentSnapshot.topMetrics) currentSnapshot.topMetrics = [];
                            const realExists = currentSnapshot.topMetrics.find(m => m.label === label);
                            if (realExists) {
                                realExists.value = exists.value;
                                realExists.subMetrics = exists.subMetrics;
                                realExists.autoFillSource = exists.autoFillSource;
                            } else {
                                currentSnapshot.topMetrics.push(exists);
                            }
                            putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'auto-fill-existing-metric').catch(e => console.error('Auto-fill save error:', e));
                        }
                    }
                }
            }
        });
    }

    if (metricCols.length === 0) {
        content.innerHTML = '<div class="empty-state"><h3>该快照无维度数据 (No dimension data in this snapshot)</h3><p>请在此快照生成前，配置相关的统计指标。<br><span style="font-size:12px;color:#888;">Please configure related metrics before generating this snapshot.</span></p></div>';
        return;
    }

    if (applyManualAdjustAutoFillToSnapshot(currentSnapshot)) {
        putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-adjust-auto-fill').catch(e => console.error('Manual adjust auto-fill save error:', e));
    }

    // Prepare data structures
    const catData = {};
    categories.forEach(cat => {
        catData[cat] = {
            name: cat,
            earnedScore: 0,
            validWeightSum: 0,
            manualScore: 0,
            values: {} // key: metric label
        };
    });

    // ── Arrange metricCols by group order ──────────────────────────────
    // Build a lookup: label -> group name (or null)
    const labelToGroup = {};
    const groupWeightMap = {};
    metricGroups.forEach(g => {
        let sumWeight = 0;
        (g.metrics || []).forEach(label => {
            labelToGroup[label] = g.name;
            const targetData = labelToTargetMap[label];
            sumWeight += (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
        });
        groupWeightMap[g.name] = sumWeight;
    });

    standardTotalScore = 0;

    // Populate values and calculate dynamic weighted score
    metricCols.forEach(m => {
        const isOthers = labelToGroup[m.label] === 'Others';
        const targetData = labelToTargetMap[m.label];
        const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
        m.hasTarget = !!(targetData && (
            getEffectiveTargetValue(targetData, targetMonth) !== undefined ||
            hasCategoryTargets(targetData, targetMonth)
        ) && weight > 0);

        if (!isOthers) {
            standardTotalScore += weight;
        }

        const subs = m.subMetrics || [];
        subs.forEach(sm => {
            if (!catData[sm.category]) {
                // Auto register unknown category
                catData[sm.category] = { name: sm.category, earnedScore: 0, validWeightSum: 0, manualScore: 0, values: {} };
                if (!categories.includes(sm.category)) categories.push(sm.category);
            }
            const valNum = parseNum(sm.value);

            let isFailing = false;
            let gapStr = '';
            let bonusScore = 0;

            if (!isNaN(valNum)) {
                const effectiveTargetValue = getEffectiveTargetValue(targetData, targetMonth, sm.category);
                if (m.hasTarget && effectiveTargetValue !== undefined) {
                    if (!isOthers) {
                        catData[sm.category].validWeightSum += weight;
                    }

                    const targetNum = parseFloat(effectiveTargetValue);
                    const condition = targetData.type || 'gte';
                    const isPercent = String(sm.value).includes('%');
                    const negativePercentageScoring = !!targetData.overachievementScoring && valNum < 0 && Math.abs(targetNum) > 0;

                    if (negativePercentageScoring) {
                        isFailing = true;
                        gapStr = `${Math.abs(valNum)}${isPercent ? '%' : ''}`;
                    } else if (condition === 'gte' && valNum < targetNum) {
                        isFailing = true;
                        gapStr = +(targetNum - valNum).toFixed(2) + (isPercent ? '%' : '');
                    } else if (condition === 'lte' && valNum > targetNum) {
                        isFailing = true;
                        gapStr = +(valNum - targetNum).toFixed(2) + (isPercent ? '%' : '');
                    } else if (!targetData.overachievementScoring && targetData.exceedBy > 0 && targetData.bonus > 0) {
                        if (condition === 'gte' && valNum > targetNum) {
                            bonusScore = Math.floor((valNum - targetNum) / targetData.exceedBy) * targetData.bonus;
                        } else if (condition === 'lte' && valNum < targetNum) {
                            bonusScore = Math.floor((targetNum - valNum) / targetData.exceedBy) * targetData.bonus;
                        }
                    }

                    const proportionalScoring = isProportionalScoringEnabled(targetData);
                    const completionRatio = negativePercentageScoring
                        ? valNum / Math.abs(targetNum)
                        : calculateTargetCompletionRatio(valNum, targetNum, condition);
                    const earnedBaseScore = negativePercentageScoring
                        ? +(weight * completionRatio).toFixed(4)
                        : (isFailing && proportionalScoring ? +(weight * completionRatio).toFixed(4) : (isFailing ? 0 : weight));
                    if (!negativePercentageScoring && !isFailing && targetData.overachievementScoring) {
                        const overachievementRatio = calculateOverachievementRatio(valNum, targetNum, condition);
                        bonusScore = +(weight * (overachievementRatio - 1)).toFixed(4);
                    }
                    const earnedScore = earnedBaseScore + (!isFailing ? bonusScore : 0);

                    if (!isOthers) {
                        catData[sm.category].earnedScore += earnedScore;
                    }

                    catData[sm.category].values[m.label] = {
                        raw: sm.value,
                        num: valNum,
                        targetValue: effectiveTargetValue,
                        isFailing: isFailing,
                        gapStr: gapStr,
                        bonusScore: bonusScore || 0,
                        earnedScore,
                        completionRatio,
                        proportionalScoring,
                        negativePercentageScoring
                    };
                    return;
                }
            }

            catData[sm.category].values[m.label] = { raw: sm.value, num: valNum, isFailing: isFailing, gapStr: gapStr, bonusScore: bonusScore || 0, earnedScore: 0, completionRatio: 0, proportionalScoring: false };
        });
    });

    const prefs = globalConfig.prefs || {};
    const isAutoStdScore = prefs.isAutoStandardTotalScore !== false;
    const customStdScore = prefs.customStandardTotalScore !== undefined ? Number(prefs.customStandardTotalScore) : 100;

    let autoStdScore = standardTotalScore;
    standardTotalScore = isAutoStdScore ? autoStdScore : customStdScore;

    const autoCb = document.getElementById('auto-std-score-cb');
    const customInput = document.getElementById('custom-std-score-input');
    if (autoCb) autoCb.checked = isAutoStdScore;
    if (customInput) {
        customInput.value = customStdScore;
        customInput.disabled = isAutoStdScore;
    }

    // ── Arrange metricCols by group order ──────────────────────────────

    // Build ordered list: grouped metrics first (in group order, then metric order), then ungrouped
    let orderedMetrics = [];
    metricGroups.forEach(g => {
        (g.metrics || []).forEach(label => {
            const m = metricCols.find(x => x.label === label);
            if (m) orderedMetrics.push(m);
        });
    });
    // Append ungrouped
    metricCols.forEach(m => {
        if (!labelToGroup[m.label]) orderedMetrics.push(m);
    });

    window._currentGroupWeightMap = groupWeightMap;
    window._currentLabelToGroup = labelToGroup;

    const tableRows = [];
    let i = 0;
    while (i < orderedMetrics.length) {
        const m = orderedMetrics[i];
        const hasTgt = labelToTargetMap[m.label] && labelToTargetMap[m.label][targetMonth] !== undefined && labelToTargetMap[m.label][targetMonth] !== '';
        const grpName = labelToGroup[m.label] || (m.isManual || hasTgt ? '未分组' : null);

        if (grpName) {
            const grpMetrics = orderedMetrics.filter(x => {
                const xHasTgt = labelToTargetMap[x.label] && labelToTargetMap[x.label][targetMonth] !== undefined && labelToTargetMap[x.label][targetMonth] !== '';
                return (labelToGroup[x.label] || (x.isManual || xHasTgt ? '未分组' : null)) === grpName;
            });
            const size = grpMetrics.length;
            const firstIdx = orderedMetrics.findIndex(x => {
                const xHasTgt = labelToTargetMap[x.label] && labelToTargetMap[x.label][targetMonth] !== undefined && labelToTargetMap[x.label][targetMonth] !== '';
                return (labelToGroup[x.label] || (x.isManual || xHasTgt ? '未分组' : null)) === grpName && x.label === grpMetrics[0].label;
            });
            if (i === firstIdx) {
                tableRows.push({ groupName: grpName, groupSize: size, isGroupStart: true, metric: m, groupWeight: groupWeightMap[grpName] || '-' });
            } else {
                tableRows.push({ groupName: grpName, groupSize: 0, isGroupStart: false, metric: m });
            }
        }
        i++;
    }

    const hasGroups = metricGroups.length > 0;

    // Generate Matrix Table
    let matrixHtml = `
        <div class="card" id="matrix-card">
            <h3 class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span>${rt('report.card.matrixTitle')}</span>
                <button onclick="toggleMatrixFullscreen()" style="padding:4px 10px; font-size:12px; background:#f0f4f8; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; color:#334155; display:flex; align-items:center; gap:4px; font-weight:normal;" title="${rt('report.action.fullscreenTitle')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                    ${rt('report.action.fullscreen')}
                </button>
            </h3>
            <div class="matrix-container" style="background:#fff; height:100%;">
            <table class="matrix-table" id="main-matrix-table">
                <thead>
                    <tr>
                        ${hasGroups ? `<th style="min-width:40px; max-width:60px; white-space:normal; position:sticky; top:0; z-index:11; background:#e8eaf6; color:#283593;">${getBilingual('分组')}</th>
                                       <th style="min-width:40px; position:sticky; top:0; z-index:11; background:#e8eaf6; color:#283593;" title="${rt('report.tooltip.groupWeight')}">${getBilingual('总权重')}</th>` : ''}
                        <th style="min-width:180px; text-align:left;">${getBilingual('考核的指标名称')}</th>
                        <th style="min-width:60px;">${getBilingual('权重')}</th>
                        <th style="min-width:100px;">${rt('report.table.targetMonth', { month: targetMonth })}</th>
                        <th style="min-width:100px; background:#fff8e1; border-right:2px solid #ffe082; color:#ef6c00;">${getBilingual('全局总体达标')}</th>
                        ${categories.map(cat => `<th>${escapeHTML(cat)}</th>`).join('')}
                        ${categories.map(cat => `<th style="background:#e8f5e9;">${escapeHTML(cat)} ${rt('report.table.score')}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
    `;

    const mainTableRows = tableRows.filter(r => r.groupName !== 'Others');
    const othersTableRows = tableRows.filter(r => r.groupName === 'Others');

    function generateMatrixRowsHtml(rows, isOthersTable) {
        let html = '';
        rows.forEach(row => {
            const m = row.metric;
            let targetStr = '--';
            let isGlobalFailing = false;
            let globalGapStr = '';

            const targetData = labelToTargetMap[m.label];
            const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;

            const globalTargetValue = getEffectiveTargetValue(targetData, targetMonth);
            if (globalTargetValue !== undefined) {
                const condition = targetData.type || 'gte';
                targetStr = (condition === 'gte' ? '≥ ' : '≤ ') + globalTargetValue;
                const isPercent = m.value && String(m.value).includes('%');
                if (isPercent) targetStr += '%';

                const globalValNum = parseNum(m.value);
                if (!isNaN(globalValNum)) {
                    const targetNum = parseFloat(globalTargetValue);
                    if (condition === 'gte' && globalValNum < targetNum) {
                        isGlobalFailing = true;
                        globalGapStr = +(targetNum - globalValNum).toFixed(2) + (isPercent ? '%' : '');
                    } else if (condition === 'lte' && globalValNum > targetNum) {
                        isGlobalFailing = true;
                        globalGapStr = +(globalValNum - targetNum).toFixed(2) + (isPercent ? '%' : '');
                    }
                }
            } else if (hasCategoryTargets(targetData, targetMonth)) {
                targetStr = rt('report.metric.categoryTargetsShort');
            }

            let globalDisplayClass = 'val-none';
            let globalTitleAttr = '';
            if (globalTargetValue !== undefined) {
                globalDisplayClass = isGlobalFailing ? 'val-warn' : 'val-good';
                globalTitleAttr = isGlobalFailing ? ` title="${escapeHTML(rt('report.tooltip.globalFailed', { gap: globalGapStr }))}"` : '';
            }
            let autoFillBtn = '';
            if (m.isManual) {
                const targetData = labelToTargetMap[m.label] || {};
                const isAuto = !!targetData.autoFill;
                const autoColor = isAuto ? '#0288d1' : '#9e9e9e';
                const autoBg = isAuto ? '#e1f5fe' : '#f5f5f5';
                const autoBorder = isAuto ? '#81d4fa' : '#e0e0e0';
                const sourceText = m.autoFillSource && m.autoFillSource.label ? ` · ${rt('report.auto.source')}: ${getTranslatedLabel(m.autoFillSource.label)}` : '';
                const autoTextFull = isAuto ? `${rt('report.auto.on')}${sourceText}` : rt('report.auto.off');
                const autoTitle = isAuto && sourceText ? rt('report.auto.sourceTitle', { label: getTranslatedLabel(m.autoFillSource.label) }) : autoTextFull;
                autoFillBtn = `<span style="cursor:pointer; margin-left:4px; font-size:14px; opacity:${isAuto ? '1' : '0.4'}; transition: opacity 0.2s;" title="${escapeHTML(autoTitle)}" onclick='toggleAutoFill(${JSON.stringify(m.label)})' onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${isAuto ? '1' : '0.4'}'">🔄</span>`;
            }
            const manualActionButtons = m.isManual ? `
                <span style="cursor:pointer; margin-left:4px; font-size:14px; opacity:0.6; transition: opacity 0.2s;" title="${rt('report.common.edit')}" onclick='editManualMetric(${JSON.stringify(m.label)})' onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">✏️</span>
                <span style="cursor:pointer; margin-left:4px; font-size:14px; opacity:0.6; transition: opacity 0.2s;" title="${rt('report.common.delete')}" onclick='deleteManualMetric(${JSON.stringify(m.label)})' onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">🗑️</span>
                ${autoFillBtn}
            ` : '';
            const proportionalEnabled = isProportionalScoringEnabled(targetData);
            const proportionalBtn = m.hasTarget ? `
                <span style="cursor:pointer; margin-left:4px; font-size:14px; opacity:${proportionalEnabled ? '1' : '0.4'}; transition: opacity 0.2s;"
                    onclick="toggleProportionalScoring('${escapeHTML(m.label)}')"
                    title="${proportionalEnabled ? rt('report.proportional.titleOn') : rt('report.proportional.titleOff')}"
                    onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${proportionalEnabled ? '1' : '0.4'}'">
                    ⚖️
                </span>
            ` : '';

            html += `<tr class="matrix-data-row" data-group="${escapeHTML(row.groupName || '未分组')}">`;

            let colIdx = 0;

            // Group column
            if (hasGroups) {
                html += `<td class="matrix-group-cell" data-col="${colIdx++}" ${row.isGroupStart ? `rowspan="${row.groupSize}"` : `style="display:none;"`}>${getBilingual(row.groupName || '未分组')}</td>`;
                html += `<td class="matrix-group-cell" data-col="${colIdx++}" ${row.isGroupStart ? `rowspan="${row.groupSize}"` : `style="display:none;"`} style="font-weight:bold; color:#1565c0;">${row.groupWeight || '-'}</td>`;
            }

            html += `
                <td data-col="${colIdx++}" style="text-align:left; font-weight:600; color:#2c3e50;">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        ${renderMetricTrendLink(m.label, 'metric')}${proportionalBtn}${manualActionButtons}
                    </div>
                </td>
                <td data-col="${colIdx++}" style="color:#666; font-weight:bold; background:#fafafa;">${weight}</td>
                <td data-col="${colIdx++}" style="color:#0277bd; font-weight:bold; background:#f5f8fa;">${targetStr}</td>
                <td data-col="${colIdx++}" style="background:#fff8e1; border-right:2px solid #ffe082;"><span class="${globalDisplayClass}"${globalTitleAttr}>${escapeHTML(String(m.value || '--'))}${renderMetricTrend(m.value, previousMetricValues[`${m.label}@@整体`])}</span></td>`;

            categories.forEach(cat => {
                const cell = catData[cat].values[m.label];
                if (!cell || cell.raw === '--') {
                    html += `<td data-col="${colIdx++}" class="val-none">--</td>`;
                } else {
                    let displayClass = 'val-none';
                    let titleAttr = '';
                    if (cell && cell.targetValue !== undefined) {
                        displayClass = cell.isFailing ? 'val-warn' : 'val-good';
                        titleAttr = cell.isFailing
                            ? ` title="${escapeHTML(rt('report.tooltip.failed', { gap: cell.gapStr }))}"`
                            : ` title="${escapeHTML(rt('report.tooltip.passed'))}"`;
                    }
                    html += `<td data-col="${colIdx++}"><span class="${displayClass}"${titleAttr}>${escapeHTML(cell.raw)}${renderMetricTrend(cell.raw, previousMetricValues[`${m.label}@@${cat}`])}</span></td>`;
                }
            });

            categories.forEach(cat => {
                const cell = catData[cat].values[m.label];
                if (!cell || cell.raw === '--') {
                    html += `<td data-col="${colIdx++}" class="val-none" style="background:#f1f8e9;">--</td>`;
                } else if (!m.hasTarget) {
                    html += `<td data-col="${colIdx++}" class="val-none" style="background:#f1f8e9;" title="${rt('report.tooltip.noScore')}">--</td>`;
                } else {
                    const earned = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
                    const scoreColor = cell.isFailing ? '#d32f2f' : '#2e7d32';
                    const bonusDisplay = cell.bonusScore ? ` <span style="font-size:10px; color:#e65100;">(+${cell.bonusScore.toFixed(2)})</span>` : '';
                    const ratioText = (cell.proportionalScoring || cell.negativePercentageScoring) && cell.isFailing
                        ? rt('report.tooltip.completionSuffix', { value: (cell.completionRatio * 100).toFixed(1) })
                        : '';
                    const scoreTitle = isOthersTable
                        ? rt('report.tooltip.extraScoreDetail', { weight, earned: formatScoreValue(earned), ratio: ratioText, bonus: cell.bonusScore || 0 })
                        : rt('report.tooltip.scoreDetail', { weight, earned: formatScoreValue(earned), ratio: ratioText, bonus: cell.bonusScore || 0 });
                    const ratioBadge = (cell.proportionalScoring || cell.negativePercentageScoring) && cell.isFailing ? `<div style="font-size:9px; color:#ef6c00; font-weight:600; line-height:1.2;">${(cell.completionRatio * 100).toFixed(0)}%</div>` : '';
                    html += `<td data-col="${colIdx++}" style="font-weight:bold; color:${scoreColor}; background:#f1f8e9;" title="${scoreTitle}">${formatScoreValue(earned)}${bonusDisplay}${ratioBadge}</td>`;
                }
            });

            html += `</tr>`;
        });
        return html;
    }

    matrixHtml += generateMatrixRowsHtml(mainTableRows, false);

    matrixHtml += `
                </tbody>
            </table>
            </div>
            <div style="margin-top:12px; font-size:12px; color:#888;">
                ${rt('report.logic.autoScoring')} <strong>${rt('report.logic.autoScoringBody')}</strong><br>
                ${rt('report.logic.proportional')}
            </div>
        </div>
    `;

    // Generate Ranking Table
    let rankingHtml = `
        <div class="card">
            <h3 class="card-title" style="color:#0277bd;">
                <span>${rt('report.card.rankingTitle')}</span>
                <button id="ranking-count-insight" class="ranking-count-insight loading" type="button" onclick="openMetricCountTrendModal()" title="${escapeHTML(rt('report.trend.metricCountTitleHint'))}">${escapeHTML(rt('report.trend.metricCountLoading'))}</button>
                <button id="expiring-warning-insight" class="ranking-count-insight loading" type="button" onclick="openExpiringWarningTrendModal()" title="${escapeHTML(rt('report.trend.warningTitleHint'))}">${escapeHTML(rt('report.trend.warningLoading'))}</button>
            </h3>
            <table class="ranking-table">
                <thead>
                    <tr>
                        <th style="width:60px;">${getBilingual('排名')}</th>
                        <th style="text-align:left;">${getBilingual('客户群/代表处/区域')}</th>
                        <th>${getBilingual('标准总分')}</th>
                        <th>${getBilingual('系统得分')}</th>
                        <th>${getBilingual('预留加减分 (手动)')}</th>
                        <th>${getBilingual('最终得分')}</th>
                    </tr>
                </thead>
                <tbody id="ranking-tbody">
                </tbody>
            </table>
        </div>
    `;

    // Generate Manual Adjustments Table
    let adjustHtml = `
        <div class="card" id="adjust-card" style="margin-top:20px; margin-bottom:20px;">
            <h3 class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:#e65100;">${rt('report.card.adjustTitle')}</span>
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:12px; font-weight:normal; color:#888; background:#f5f5f5; padding:4px 8px; border-radius:4px;">${rt('report.hint.autoSaved')}</span>
                    <button onclick="openManualAdjustSortModal()" style="padding:4px 10px; font-size:12px; background:#fff8e1; border:1px solid #ffe082; border-radius:4px; cursor:pointer; color:#e65100; display:flex; align-items:center; gap:4px; font-weight:normal;" title="${rt('report.action.sortAdjustTitle')}">
                        ↕️ ${rt('report.action.sortAdjust')}
                    </button>
                    <button onclick="openAddAdjustModal()" style="padding:4px 10px; font-size:12px; background:#e8f5e9; border:1px solid #c8e6c9; border-radius:4px; cursor:pointer; color:#2e7d32; display:flex; align-items:center; gap:4px; font-weight:normal;" title="${rt('report.action.addAdjustTitle')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        ${rt('report.action.addAdjust')}
                    </button>
                    <button onclick="toggleAdjustFullscreen()" style="padding:4px 10px; font-size:12px; background:#f0f4f8; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; color:#334155; display:flex; align-items:center; gap:4px; font-weight:normal;" title="${rt('report.action.fullscreenTitle')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                        ${rt('report.action.fullscreen')}
                    </button>
                </div>
            </h3>
            <div class="matrix-container" style="background:#fff;">
            <table class="matrix-table" style="font-size:12px;">
                <thead>
                    <tr>
                        <th style="min-width:60px;">${getBilingual('类型')}</th>
                        <th style="text-align:left;">${getBilingual('项目说明')}</th>
                        <th style="min-width:120px;">${getBilingual('计分规则')}</th>
                        ${categories.map(cat => `<th style="width:80px; background:#fff3e0;">${escapeHTML(cat)} (${rt('report.table.occurrences')})</th>`).join('')}
                        ${categories.map(cat => `<th style="width:70px; background:#e8f5e9;">${escapeHTML(cat)} (${rt('report.table.adjustScore')})</th>`).join('')}
                        <th style="width:60px;">${getBilingual('操作')}</th>
                    </tr>
                </thead>
                <tbody>
    `;

    const snapAdjustData = currentSnapshot.manualAdjustData || {};
    const snapAdjustDetails = currentSnapshot.manualAdjustDetails || {};
    const manualAutoPrefs = getManualAdjustAutoFillPrefs();
    const manualAutoSources = currentSnapshot.manualAdjustAutoFillSources || {};

    getOrderedManualAdjustEntries().forEach(({ item, idx }) => {

        const typeColor = item.type === '加分' ? '#2e7d32' : '#c62828';
        const typeBg = item.type === '加分' ? '#e8f5e9' : '#ffebee';
        const isAuto = isManualAdjustItemAutoFillEnabled(idx);
        const autoSource = manualAutoSources[idx];
        const autoColor = isAuto ? '#0288d1' : '#9e9e9e';
        const autoBg = isAuto ? '#e1f5fe' : '#f5f5f5';
        const autoBorder = isAuto ? '#81d4fa' : '#e0e0e0';
        const autoText = isAuto ? `${rt('report.auto.on')}${autoSource && autoSource.label ? ` · ${rt('report.auto.source')}: ${getTranslatedLabel(autoSource.label)}` : ''}` : rt('report.auto.off');
        const autoTitle = isAuto && autoSource && autoSource.label ? rt('report.auto.sourceTitle', { label: getTranslatedLabel(autoSource.label) }) : rt('report.auto.title');
        adjustHtml += `<tr>
            <td style="color:${typeColor}; background:${typeBg}; font-weight:bold; text-align:center;">${getBilingual(item.type)}</td>
            <td style="text-align:left;">
                <div style="display:flex; flex-direction:row; align-items:center; flex-wrap:wrap; gap:8px;">
                    ${renderMetricTrendLink(item.name, 'manual')}
                    <span style="cursor:pointer; font-size:14px; opacity:${isAuto ? '1' : '0.4'}; transition: opacity 0.2s; padding:2px;" title="${escapeHTML(autoTitle)}" onclick="toggleManualAdjustAutoFill(${idx})" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='${isAuto ? '1' : '0.4'}'">🔄</span>
                </div>
            </td>
            <td style="color:#666;">${escapeHTML(formatManualAdjustDesc(item))}</td>
        `;

        // Input fields for occurrences
        categories.forEach(cat => {
            const val = (snapAdjustData[cat] && snapAdjustData[cat][idx]) || '';
            const detail = snapAdjustDetails[cat] && snapAdjustDetails[cat][idx];
            const detailRecords = normalizeManualAdjustDetailRecords(detail);
            const attachmentCount = detailRecords.reduce((sum, record) => sum + record.attachments.length, 0);
            const hasDetail = detailRecords.some(record => record.reason || record.occurredAt || record.recorder || record.attachments.length);
            adjustHtml += `<td>
                <div style="display:flex; align-items:center; justify-content:center; gap:4px; min-width:104px;">
                    <input type="number" class="manual-adjust-input" data-cat="${escapeHTML(cat)}" data-idx="${idx}" value="${val}" min="0" step="1" onchange="calculateManualAdjustments(); saveManualAdjustData(true);" style="width:58px; text-align:center; border:1px solid #ddd; padding:4px; border-radius:4px; box-sizing:border-box;">
                    <button type="button" class="manual-adjust-detail-btn" data-cat="${escapeHTML(cat)}" data-idx="${idx}" onclick="openManualAdjustDetailModal(this.dataset.cat, Number(this.dataset.idx))" title="${escapeHTML(rt('report.adjust.detailButtonTitle'))}" aria-label="${escapeHTML(rt('report.adjust.detailButtonTitle'))}" style="position:relative; min-width:30px; height:28px; padding:2px 6px; border:1px solid ${hasDetail ? '#fb923c' : '#d8dee7'}; border-radius:6px; background:${hasDetail ? '#fff7ed' : '#fff'}; color:${hasDetail ? '#c2410c' : '#64748b'}; cursor:pointer; line-height:1;">📝${attachmentCount ? `<span style="position:absolute; right:-5px; top:-6px; min-width:15px; height:15px; padding:0 3px; border-radius:8px; background:#ea580c; color:#fff; font-size:9px; line-height:15px; box-sizing:border-box;">${attachmentCount}</span>` : ''}</button>
                </div>
            </td>`;
        });

        // Computed scores fields
        categories.forEach(cat => {
            adjustHtml += `<td id="adjust-score-${escapeHTML(cat)}-${idx}" style="font-weight:bold; text-align:center;">0</td>`;
        });

        adjustHtml += `
            <td style="text-align:center;">
                <button onclick="openAddAdjustModal(${idx})" style="background:none; border:none; cursor:pointer; font-size:16px; opacity:0.6; padding:4px;" title="${rt('report.common.edit')}" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">✏️</button>
                <button onclick="deleteAdjustItem(${idx})" style="background:none; border:none; cursor:pointer; font-size:16px; opacity:0.6; padding:4px;" title="${rt('report.common.delete')}" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">🗑️</button>
            </td>
        </tr>`;
    });

    adjustHtml += `
                </tbody>
            </table>
            </div>
            <div style="margin-top:8px; font-size:12px; color:#888;">${rt('report.logic.manualAdjust')}</div>
        </div>
    `;

    const rulesItems = getReportLang() === 'en-US'
        ? [
            ['1. Standard Total Score Baseline:', 'The Standard Total Score is the sum of all assessment metrics with weight > 0. It is the shared ranking baseline and is not affected by whether a customer group / rep office / region is exempt from some metrics.'],
            ['2. Assessment Exemption Mechanism:', 'If a metric has no clear target this month, or a customer group / rep office / region has no data shown as --, the metric is exempted. Exempt metrics do not deduct points and are not included in that customer group / rep office / region full-weight base.'],
            ['3. Dynamic Conversion Algorithm:', 'System Score = (Actual Weights Gained / Valid Full Weights Participated) x Standard Total Score. A customer group / rep office / region can still receive full converted score if it reaches 100% compliance on all metrics it actually participated in.'],
            ['4. Per-Metric Proportional Scoring Toggle:', 'Proportional scoring is disabled by default. Once enabled for a metric, failing customer groups / rep offices / regions earn partial score by target completion ratio, capped by the metric weight.'],
            ['5. Reserved Manual Adjustment Mechanism:', 'Final Score = System Score + Manual Adj. This covers non-automated special rewards and penalties. Manual items can be configured in the table above and saved to the snapshot.'],
            ['6. Dynamic Summary Analysis:', 'The summary row at the bottom of the matrix follows header filters, skips exempt items, and recalculates valid weights and scores in real time.']
        ]
        : [
            ['1. 标准总分基准：', '标准总分为当前左侧或后台配置中所有权重 > 0 的考核指标之和。该总分是各客户群/代表处/区域排名的公共基准，不受任何客户群/代表处/区域是否缺考影响。'],
            ['2. 考核免除机制：', '当某一指标在本月未配置明确目标值，或该客户群/代表处/区域在某指标上暂无数据（显示为 --）时，该指标会触发免除机制。免除指标不会扣分，也不计入该客户群/代表处/区域的考核满权基数。'],
            ['3. 动态折算算法：', '系统得分 = (实际达标获得的权重 / 实际参与考核的有效满权) × 标准总分。即使客户群/代表处/区域免考了部分指标，只要实际参与指标 100% 达标，也可以折算拿到满分。'],
            ['4. 单指标比例计分开关：', '比例计分默认关闭。用户可在单个指标旁手动开启，开启后未达标客户群/代表处/区域会按完成目标比例折算得分，最高不超过该指标权重。'],
            ['5. 预留加减分机制：', '最终得分 = 系统得分 + 预留加减分。该部分主要覆盖非自动化专项奖惩，相关人工配置可通过上方表格设置并自动存入快照。'],
            ['6. 动态汇总分析：', '矩阵最下方的汇总行会跟随表头下拉过滤条件，跳过免考项，并实时汇总有效权重与得分。']
        ];

    let rulesHtml = `
        <div class="card" style="margin-top:20px; margin-bottom:40px; background:#f8fbff; border:1px solid #bbdefb; box-shadow:0 2px 8px rgba(21,101,192,0.05);">
            <h3 class="card-title" style="color:#0277bd; font-size:15px; border-bottom:1px solid #bbdefb; padding-bottom:10px; margin-bottom:12px;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom; margin-right:6px;"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
                ${rt('report.card.rulesTitle')}
            </h3>
            <div style="font-size:13px; color:#455a64; line-height:1.8;">
                ${rulesItems.map(([title, body]) => `<p style="margin:0 0 8px;"><strong>${escapeHTML(title)}</strong>${escapeHTML(body)}</p>`).join('')}
            </div>
        </div>
    `;

    let othersMatrixHtml = '';
    if (othersTableRows && othersTableRows.length > 0) {
        othersMatrixHtml = `
        <div class="card" id="others-matrix-card" style="margin-top: 20px;">
            <h3 class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span style="color:#607d8b;">额外监控表-不计入总分 (Others 分组)</span>
                <button onclick="toggleOthersMatrixFullscreen()" style="padding:4px 10px; font-size:12px; background:#f0f4f8; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; color:#334155; display:flex; align-items:center; gap:4px; font-weight:normal;" title="${rt('report.action.fullscreenTitle')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
                    ${rt('report.action.fullscreen')}
                </button>
            </h3>
            <div class="matrix-container" style="background:#fff; height:100%;">
            <table class="matrix-table" id="others-matrix-table">
                <thead>
                    <tr>
                        ${hasGroups ? `<th style="min-width:40px; max-width:60px; white-space:normal; position:sticky; top:0; z-index:11; background:#eceff1; color:#37474f;">${getBilingual('分组')}</th>
                                       <th style="min-width:40px; position:sticky; top:0; z-index:11; background:#eceff1; color:#37474f;" title="${rt('report.tooltip.groupWeight')}">${getBilingual('总权重')}</th>` : ''}
                        <th style="min-width:180px; text-align:left;">${getBilingual('考核的指标名称')}</th>
                        <th style="min-width:60px;">${getBilingual('权重')}</th>
                        <th style="min-width:100px;">${rt('report.table.targetMonth', { month: targetMonth })}</th>
                        <th style="min-width:100px; background:#fff8e1; border-right:2px solid #ffe082; color:#ef6c00;">${getBilingual('全局总体达标')}</th>
                        ${categories.map(cat => `<th>${escapeHTML(cat)}</th>`).join('')}
                        ${categories.map(cat => `<th style="background:#f1f8e9; color:#888;">${escapeHTML(cat)} ${rt('report.table.score')}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${generateMatrixRowsHtml(othersTableRows, true)}
                </tbody>
            </table>
            </div>
            <div style="margin-top:12px; font-size:12px; color:#888;">
                ⚠️ 当前为 Others 分组的额外监控表，该表内指标支持比例计分展示，但不计入总分和排名。
            </div>
        </div>
        `;
    }

    content.innerHTML = rankingHtml + matrixHtml + adjustHtml + othersMatrixHtml + rulesHtml;
    window._currentCatData = catData;
    window._currentOrderedMetrics = orderedMetrics;

    // Setup matrix filters
    setupMatrixFilters();

    // We must call calculateManualAdjustments first so the sum goes into ranking
    setTimeout(calculateManualAdjustments, 0);
    setTimeout(renderRankingCountInsight, 0);
    setTimeout(renderExpiringWarningInsight, 0);
}

window.setupMatrixFilters = function () {
    const table = document.getElementById('main-matrix-table');
    if (!table) return;

    const thead = table.querySelector('thead');
    const headerCells = thead.querySelectorAll('tr:first-child th');

    // Remove existing if any
    const existing = thead.querySelector('.matrix-filter-row');
    if (existing) existing.remove();

    const filterRow = document.createElement('tr');
    filterRow.className = 'matrix-filter-row';

    // Calculate the dynamic height of the bilingual header row
    const firstRowHeight = thead.querySelector('tr:first-child').offsetHeight || 45;

    headerCells.forEach((th, colIdx) => {
        const filterTh = document.createElement('th');
        filterTh.style.padding = '4px';
        filterTh.style.background = '#f1f5f9';
        filterTh.style.position = 'sticky';
        filterTh.style.top = firstRowHeight + 'px';
        filterTh.style.zIndex = '20';
        filterTh.style.borderBottom = '1px solid #cbd5e1';

        filterTh.innerHTML = `
            <div class="custom-ms" data-col="${colIdx}" style="position:relative; width:100%; text-align:left; font-weight:normal;">
                <div class="ms-btn" onclick="toggleMsDropdown(${colIdx}, event)" style="background:#fff; border:1px solid #cbd5e1; border-radius:3px; padding:2px 4px; font-size:11px; cursor:pointer; min-height:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; justify-content:space-between; align-items:center;" title="${rt('report.filter.all')}">
                    <span class="ms-text">${rt('report.filter.all')}</span>
                    <span style="font-size:8px; color:#888;">▼</span>
                </div>
                <div class="ms-dropdown" id="ms-dropdown-${colIdx}" style="display:none; position:absolute; top:100%; left:0; min-width:120px; background:#fff; border:1px solid #ccc; box-shadow:0 4px 6px rgba(0,0,0,0.1); z-index:9999; max-height:250px; overflow-y:auto; padding:6px; border-radius:4px;">
                    <label style="display:block; margin-bottom:4px; font-weight:bold; cursor:pointer; border-bottom:1px solid #eee; padding-bottom:6px; font-size:11px;">
                        <input type="checkbox" class="ms-all-cb" checked onchange="msSelectAll(${colIdx}, this.checked)"> ${rt('report.filter.selectAll')}
                    </label>
                    <div class="ms-options-container"></div>
                </div>
            </div>
        `;

        filterRow.appendChild(filterTh);
    });

    thead.appendChild(filterRow);

    // Global click listener to close dropdowns
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.custom-ms')) {
            document.querySelectorAll('.ms-dropdown').forEach(d => {
                d.style.display = 'none';
                if (d.closest('th')) d.closest('th').style.zIndex = '20';
            });
        }
    });

    populateFilterOptions();
    filterMatrix();

    // Initialize summary row immediately
    if (typeof updateMatrixSummary === 'function') {
        updateMatrixSummary();
    }
};

window.toggleMsDropdown = function (colIdx, e) {
    if (e) e.stopPropagation();
    const dropdown = document.getElementById(`ms-dropdown-${colIdx}`);
    const isVisible = dropdown.style.display === 'block';

    // Close all
    document.querySelectorAll('.ms-dropdown').forEach(d => {
        d.style.display = 'none';
        if (d.closest('th')) d.closest('th').style.zIndex = '20';
    });

    if (!isVisible) {
        dropdown.style.display = 'block';
        if (dropdown.closest('th')) dropdown.closest('th').style.zIndex = '30';
    }
};

window.populateFilterOptions = function () {
    const table = document.getElementById('main-matrix-table');
    const msContainers = table.querySelectorAll('.custom-ms');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr.matrix-data-row'));

    msContainers.forEach(container => {
        const colIdx = parseInt(container.getAttribute('data-col'));
        const uniqueValues = new Set();
        const valueToRowIdx = {};

        rows.forEach((row, rowIdx) => {
            const cell = row.querySelector(`td[data-col="${colIdx}"]`);
            if (cell) {
                let val = cleanMatrixCellFilterText(cell.innerText);
                if (val) {
                    uniqueValues.add(val);
                    if (valueToRowIdx[val] === undefined) valueToRowIdx[val] = rowIdx;
                }
            }
        });

        const sorted = Array.from(uniqueValues).sort();
        const optContainer = container.querySelector('.ms-options-container');
        optContainer.innerHTML = '';

        const headerText = table.querySelector(`thead tr:first-child th:nth-child(${colIdx + 1})`).innerText || '';
        const isTargetCol = headerText.includes('月目标值') || headerText.includes('Target');
        let allChecked = true;

        sorted.forEach(val => {
            const label = document.createElement('label');
            label.style.display = 'block';
            label.style.padding = '3px 0';
            label.style.fontSize = '11px';
            label.style.cursor = 'pointer';
            label.style.whiteSpace = 'nowrap';

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            
            const firstRowIdx = valueToRowIdx[val];
            if (window._preserveMatrixFilters && window._matrixFilterStateByRow && window._matrixFilterStateByRow[colIdx]) {
                const state = window._matrixFilterStateByRow[colIdx];
                if (state.all) {
                    cb.checked = true;
                } else {
                    cb.checked = state.allowedRows.has(firstRowIdx);
                }
                if (!cb.checked) allChecked = false;
            } else {
                cb.checked = true;
                if (isTargetCol && val === '--') {
                    cb.checked = false;
                    allChecked = false;
                }
            }
            
            cb.value = val;
            cb.className = 'ms-opt-cb';
            cb.onchange = () => msCheckboxChange(colIdx);

            label.appendChild(cb);
            label.appendChild(document.createTextNode(' ' + val));
            optContainer.appendChild(label);
        });

        const allCb = container.querySelector('.ms-all-cb');
        if (allCb) allCb.checked = allChecked;
        updateMsBtnText(colIdx);
    });
};

window.msSelectAll = function (colIdx, isChecked) {
    const container = document.querySelector(`.custom-ms[data-col="${colIdx}"]`);
    const cbs = container.querySelectorAll('.ms-opt-cb');
    cbs.forEach(cb => cb.checked = isChecked);
    updateMsBtnText(colIdx);
    filterMatrix();
};

window.msCheckboxChange = function (colIdx) {
    const container = document.querySelector(`.custom-ms[data-col="${colIdx}"]`);
    const cbs = container.querySelectorAll('.ms-opt-cb');
    const allCb = container.querySelector('.ms-all-cb');

    const allChecked = Array.from(cbs).every(cb => cb.checked);
    allCb.checked = allChecked;

    updateMsBtnText(colIdx);
    filterMatrix();
};

window.updateMsBtnText = function (colIdx) {
    const container = document.querySelector(`.custom-ms[data-col="${colIdx}"]`);
    const cbs = container.querySelectorAll('.ms-opt-cb');
    const checked = Array.from(cbs).filter(cb => cb.checked);

    const btnText = container.querySelector('.ms-text');
    if (checked.length === cbs.length) {
        btnText.innerText = rt('report.filter.all');
        btnText.parentElement.title = rt('report.filter.all');
    } else if (checked.length === 0) {
        btnText.innerText = rt('report.filter.none');
        btnText.parentElement.title = rt('report.filter.none');
    } else if (checked.length === 1) {
        btnText.innerText = checked[0].value;
        btnText.parentElement.title = checked[0].value;
    } else {
        btnText.innerText = rt('report.filter.selectedCount', { count: checked.length });
        btnText.parentElement.title = checked.map(c => c.value).join(', ');
    }
};

window.filterMatrix = function () {
    const table = document.getElementById('main-matrix-table');
    const msContainers = Array.from(table.querySelectorAll('.custom-ms'));

    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr.matrix-data-row'));

    // Build filters map: colIdx -> set of allowed values
    const filters = {};
    const filterStateByRow = {};
    msContainers.forEach(container => {
        const colIdx = parseInt(container.getAttribute('data-col'));
        const allCb = container.querySelector('.ms-all-cb');
        
        filterStateByRow[colIdx] = { all: allCb.checked, allowedRows: new Set() };
        
        if (!allCb.checked) {
            const checkedVals = Array.from(container.querySelectorAll('.ms-opt-cb:checked')).map(cb => cb.value);
            const valSet = new Set(checkedVals);
            filters[colIdx] = valSet;
            
            rows.forEach((row, rowIdx) => {
                const cell = row.querySelector(`td[data-col="${colIdx}"]`);
                if (cell) {
                    let text = cleanMatrixCellFilterText(cell.innerText);
                    if (valSet.has(text)) {
                        filterStateByRow[colIdx].allowedRows.add(rowIdx);
                    }
                }
            });
        }
    });
    window._matrixFilterStateByRow = filterStateByRow;



    rows.forEach(row => {
        let match = true;
        for (let colIdx in filters) {
            const allowedSet = filters[colIdx];
            const cell = row.querySelector(`td[data-col="${colIdx}"]`);
            if (cell) {
                let text = cleanMatrixCellFilterText(cell.innerText);
                if (!allowedSet.has(text)) {
                    match = false;
                    break;
                }
            } else {
                match = false; break;
            }
        }
        row.style.display = match ? '' : 'none';
    });

    // Fix rowspans
    const groups = {};
    rows.forEach(row => {
        const groupName = row.getAttribute('data-group');
        if (groupName) {
            if (!groups[groupName]) groups[groupName] = [];
            if (row.style.display !== 'none') groups[groupName].push(row);
        }
    });

    Object.keys(groups).forEach(gName => {
        const visibleRows = groups[gName];
        rows.forEach(row => {
            if (row.getAttribute('data-group') === gName) {
                const grpCell1 = row.querySelector('td[data-col="0"]');
                const grpCell2 = row.querySelector('td[data-col="1"]');
                if (grpCell1) grpCell1.style.display = 'none';
                if (grpCell2) grpCell2.style.display = 'none';
            }
        });

        if (visibleRows.length > 0) {
            const firstRow = visibleRows[0];
            const grpCell1 = firstRow.querySelector('td[data-col="0"]');
            const grpCell2 = firstRow.querySelector('td[data-col="1"]');
            if (grpCell1) {
                grpCell1.style.display = '';
                grpCell1.rowSpan = visibleRows.length;
            }
            if (grpCell2) {
                grpCell2.style.display = '';
                grpCell2.rowSpan = visibleRows.length;
            }
        }
    });

    // Update summary row
    updateMatrixSummary();
};

window.updateMatrixSummary = function () {
    const table = document.getElementById('main-matrix-table');
    if (!table) return;

    let summaryRow = table.querySelector('.matrix-summary-row');
    if (!summaryRow) {
        summaryRow = document.createElement('tr');
        summaryRow.className = 'matrix-summary-row';
        summaryRow.style.background = '#e8eaf6';
        summaryRow.style.fontWeight = 'bold';
        summaryRow.style.position = 'sticky';
        summaryRow.style.bottom = '0';
        summaryRow.style.zIndex = '12';
        summaryRow.style.boxShadow = '0 -2px 10px rgba(0,0,0,0.1)';
        table.querySelector('tbody').appendChild(summaryRow);
    }

    const rows = Array.from(table.querySelectorAll('tbody tr.matrix-data-row'));
    const visibleRows = rows.filter(r => r.style.display !== 'none');

    const sums = {};
    visibleRows.forEach(row => {
        const cells = row.querySelectorAll('td[data-col]');
        cells.forEach(cell => {
            const col = cell.getAttribute('data-col');
            if (cell.classList.contains('val-none')) return;
            const text = cell.innerText.trim();
            if (text === '--') return;

            const val = parseFloat(text);
            if (!isNaN(val)) {
                if (!sums[col]) sums[col] = 0;
                sums[col] += val;
            }
        });
    });

    const headerCells = table.querySelectorAll('thead tr:first-child th');
    let html = '';
    headerCells.forEach((th, colIdx) => {
        const headerText = th.innerText.trim();
        if (headerText.includes(getTranslatedLabel('考核的指标名称'))) {
            html += `<td style="text-align:right; color:#283593; padding:8px;">${rt('report.summary.filtered')}</td>`;
        } else if (headerText === getTranslatedLabel('权重') || headerText.includes(rt('report.table.score'))) {
            let sumVal = sums[colIdx] !== undefined ? sums[colIdx] : 0;
            sumVal = Math.round(sumVal * 100) / 100;
            html += `<td style="color:#c62828; padding:8px;">${sumVal}</td>`;
        } else {
            html += `<td style="color:#aaa; padding:8px;">-</td>`;
        }
    });
    summaryRow.innerHTML = html;
};

window.toggleMatrixFullscreen = function () {
    const card = document.getElementById('matrix-card');
    const table = card.querySelector('.matrix-table');
    if (!card) return;

    if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
        // Enter fullscreen
        if (card.requestFullscreen) {
            card.requestFullscreen();
        } else if (card.msRequestFullscreen) {
            card.msRequestFullscreen();
        } else if (card.mozRequestFullScreen) {
            card.mozRequestFullScreen();
        } else if (card.webkitRequestFullscreen) {
            card.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
        }
        card.style.overflow = 'auto'; // allow scrolling the whole card if necessary
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        if (table) table.style.height = '100%';
        const container = card.querySelector('.matrix-container');
        if (container) {
            container.style.flex = '1';
            container.style.maxHeight = 'none';
        }
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        card.style.overflow = '';
        card.style.display = '';
        card.style.flexDirection = '';
        if (table) table.style.height = '';
        const container = card.querySelector('.matrix-container');
        if (container) {
            container.style.flex = '';
            container.style.maxHeight = '';
        }
    }
};

window.toggleOthersMatrixFullscreen = function () {
    const card = document.getElementById('others-matrix-card');
    const table = card.querySelector('.matrix-table');
    if (!card) return;

    if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
        if (card.requestFullscreen) {
            card.requestFullscreen();
        } else if (card.msRequestFullscreen) {
            card.msRequestFullscreen();
        } else if (card.mozRequestFullScreen) {
            card.mozRequestFullScreen();
        } else if (card.webkitRequestFullscreen) {
            card.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
        }
        card.style.overflow = 'auto';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        if (table) table.style.height = '100%';
        const container = card.querySelector('.matrix-container');
        if (container) {
            container.style.flex = '1';
            container.style.maxHeight = 'none';
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
        card.style.overflow = '';
        card.style.display = '';
        card.style.flexDirection = '';
        if (table) table.style.height = '';
        const container = card.querySelector('.matrix-container');
        if (container) {
            container.style.flex = '';
            container.style.maxHeight = '';
        }
    }
};

window.toggleAdjustFullscreen = function () {
    const card = document.getElementById('adjust-card');
    const table = card.querySelector('.matrix-table');
    if (!card) return;

    if (!document.fullscreenElement && !document.mozFullScreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
        if (card.requestFullscreen) card.requestFullscreen();
        else if (card.msRequestFullscreen) card.msRequestFullscreen();
        else if (card.mozRequestFullScreen) card.mozRequestFullScreen();
        else if (card.webkitRequestFullscreen) card.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);

        card.style.overflow = 'auto';
        card.style.display = 'flex';
        card.style.flexDirection = 'column';
        if (table) table.style.height = '100%';
        const container = card.querySelector('.matrix-container');
        if (container) {
            container.style.flex = '1';
            container.style.maxHeight = 'none';
        }
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();

        card.style.overflow = '';
        card.style.display = '';
        card.style.flexDirection = '';
        if (table) table.style.height = '';
        const container = card.querySelector('.matrix-container');
        if (container) {
            container.style.flex = '';
            container.style.maxHeight = '';
        }
    }
};

window.calculateManualAdjustments = function () {
    const inputs = document.querySelectorAll('.manual-adjust-input');
    const catSums = {};

    // reset sums
    categories.forEach(cat => catSums[cat] = 0);

    inputs.forEach(input => {
        const cat = input.getAttribute('data-cat');
        const idx = parseInt(input.getAttribute('data-idx'));
        const occurrences = parseInt(input.value) || 0;

        const item = manualAdjustItems[idx];
        if (!item || item.deleted) return;

        const score = calculateManualAdjustScore(item, occurrences);

        // update display
        const scoreCell = document.getElementById(`adjust-score-${cat}-${idx}`);
        if (scoreCell) {
            scoreCell.innerText = score;
            scoreCell.style.color = score < 0 ? '#d32f2f' : (score > 0 ? '#2e7d32' : '#000');
        }

        catSums[cat] += score;
    });

    // Inject sums into ranking inputs
    categories.forEach(cat => {
        const manualInput = document.getElementById(`manual-score-${cat}`);
        if (manualInput) {
            manualInput.value = catSums[cat];
        }
        if (window._currentCatData && window._currentCatData[cat]) {
            window._currentCatData[cat].manualScore = catSums[cat];
        }
    });

    renderRanking();
};

window.saveManualAdjustData = async function (silent = false) {
    if (!currentSnapshot) return;

    currentSnapshot.manualAdjustData = collectManualAdjustDataFromInputs();

    try {
        await putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-adjust-data');
        if (!silent) showToast(rt('report.toast.manualAdjustSaved'), 'success');
    } catch (e) {
        if (!silent) showToast(rt('report.toast.saveFailed'), 'error');
        console.error(e);
    }
};

function collectManualAdjustDataFromInputs() {
    const inputs = document.querySelectorAll('.manual-adjust-input');
    const newData = {};
    categories.forEach(cat => newData[cat] = {});

    inputs.forEach(input => {
        const cat = input.getAttribute('data-cat');
        const idx = input.getAttribute('data-idx');
        const val = parseInt(input.value);
        if (!isNaN(val)) {
            newData[cat][idx] = val;
        }
    });
    return newData;
}

function isManualAdjustImage(attachment) {
    return /^image\//i.test(String(attachment?.type || '')) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(attachment?.name || ''));
}

function formatManualAdjustFileSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function createManualAdjustRecord(source = {}) {
    return {
        id: String(source.id || (globalThis.crypto?.randomUUID?.() || `record-${Date.now()}-${Math.random()}`)),
        occurredAt: String(source.occurredAt || ''),
        recorder: String(source.recorder || ''),
        reason: String(source.reason || ''),
        attachments: Array.isArray(source.attachments) ? source.attachments.map(item => ({ ...item })) : [],
        newFiles: []
    };
}

function normalizeManualAdjustDetailRecords(detail) {
    if (Array.isArray(detail?.records)) return detail.records.map(createManualAdjustRecord);
    if (detail && (detail.note || Array.isArray(detail.attachments))) {
        return [createManualAdjustRecord({ reason: detail.note || '', attachments: detail.attachments || [] })];
    }
    return [];
}

function serializeManualAdjustRecord(record) {
    return {
        id: String(record?.id || ''),
        occurredAt: String(record?.occurredAt || ''),
        recorder: String(record?.recorder || ''),
        reason: String(record?.reason || ''),
        attachments: Array.isArray(record?.attachments) ? record.attachments.map(item => ({ ...item })) : []
    };
}

function manualAdjustAttachmentSignature(attachments) {
    return (Array.isArray(attachments) ? attachments : []).map(item => `${item.url || ''}\u0000${item.name || ''}`).sort().join('\u0001');
}

function buildManualAdjustChangeLogEntry(beforeRecords, afterRecords) {
    const before = Array.isArray(beforeRecords) ? beforeRecords : [];
    const after = Array.isArray(afterRecords) ? afterRecords : [];
    const beforeById = new Map(before.map((record, index) => [record.id, { record, index }]));
    const afterIds = new Set(after.map(record => record.id));
    const items = [];

    after.forEach((record, index) => {
        const previous = beforeById.get(record.id);
        if (!previous) {
            items.push({ type: 'add', index: index + 1, reason: record.reason || '' });
            return;
        }
        const fields = [];
        ['occurredAt', 'recorder', 'reason'].forEach(field => {
            if (String(previous.record[field] || '') !== String(record[field] || '')) {
                fields.push({ field, before: String(previous.record[field] || ''), after: String(record[field] || '') });
            }
        });
        if (manualAdjustAttachmentSignature(previous.record.attachments) !== manualAdjustAttachmentSignature(record.attachments)) {
            fields.push({
                field: 'attachments',
                before: Array.isArray(previous.record.attachments) ? previous.record.attachments.length : 0,
                after: Array.isArray(record.attachments) ? record.attachments.length : 0
            });
        }
        if (fields.length) items.push({ type: 'update', index: index + 1, fields });
    });

    before.forEach((record, index) => {
        if (!afterIds.has(record.id)) items.push({ type: 'remove', index: index + 1, reason: record.reason || '' });
    });
    if (!items.length) return null;
    return {
        id: globalThis.crypto?.randomUUID?.() || `change-${Date.now()}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        operator: localStorage.getItem('tools_user') || '',
        items
    };
}

function compactManualAdjustLogValue(value) {
    const text = String(value ?? '').trim();
    if (!text) return rt('report.adjust.changeEmpty');
    return text.length > 38 ? `${text.slice(0, 38)}…` : text;
}

function formatManualAdjustChangeItem(item) {
    if (item.type === 'add') {
        return rt('report.adjust.changeAdded', { index: item.index, reason: compactManualAdjustLogValue(item.reason) });
    }
    if (item.type === 'remove') {
        return rt('report.adjust.changeRemoved', { index: item.index, reason: compactManualAdjustLogValue(item.reason) });
    }
    const fieldLabels = {
        occurredAt: rt('report.adjust.occurredAt'),
        recorder: rt('report.adjust.recorder'),
        reason: rt('report.adjust.reasonLabel'),
        attachments: rt('report.adjust.evidenceLabel')
    };
    const changes = (item.fields || []).map(field => `${fieldLabels[field.field] || field.field}: ${compactManualAdjustLogValue(field.before)} → ${compactManualAdjustLogValue(field.after)}`).join(', ');
    return rt('report.adjust.changeUpdated', { index: item.index, changes });
}

function formatManualAdjustLogTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString(getReportLang(), { hour12: false });
}

function renderManualAdjustChangeLog() {
    const container = document.getElementById('manual-adjust-change-log');
    if (!container || !manualAdjustDetailDraft) return;
    const logs = manualAdjustDetailDraft.changeLog || [];
    if (!logs.length) {
        container.innerHTML = `<div style="padding:9px 10px; border-radius:6px; background:#f8fafc; color:#94a3b8; font-size:11px;">${rt('report.adjust.noChangeLog')}</div>`;
        return;
    }
    const visible = logs.slice(0, manualAdjustLogVisibleCount);
    container.innerHTML = `<div style="display:flex; flex-direction:column; gap:5px;">${visible.map(log => `
        <div style="display:grid; grid-template-columns:155px minmax(0,1fr); gap:10px; padding:7px 9px; border-radius:6px; background:#f8fafc; font-size:10px; line-height:1.5; color:#64748b;">
            <div><span style="color:#475569;">${escapeHTML(formatManualAdjustLogTime(log.timestamp))}</span>${log.operator ? `<br><span>${escapeHTML(log.operator)}</span>` : ''}</div>
            <div>${(log.items || []).map(item => `<div>${escapeHTML(formatManualAdjustChangeItem(item))}</div>`).join('')}</div>
        </div>`).join('')}</div>
        ${logs.length > visible.length ? `<button type="button" onclick="loadMoreManualAdjustLogs()" style="display:block; margin:7px auto 0; padding:3px 10px; border:1px solid #cbd5e1; border-radius:999px; background:#fff; color:#64748b; cursor:pointer; font-size:10px;">${rt('report.adjust.loadMoreChanges', { count: logs.length - visible.length })}</button>` : ''}`;
}

window.loadMoreManualAdjustLogs = function () {
    manualAdjustLogVisibleCount += 5;
    renderManualAdjustChangeLog();
};

function getManualAdjustOccurrenceInput(cat, idx) {
    return Array.from(document.querySelectorAll('.manual-adjust-input')).find(input => input.dataset.cat === cat && Number(input.dataset.idx) === idx) || null;
}

function ensureManualAdjustDetailModal() {
    let modal = document.getElementById('manual-adjust-detail-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'manual-adjust-detail-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = 'display:none; position:fixed; inset:0; z-index:100001; padding:14px; box-sizing:border-box; background:rgba(15,23,42,.58); backdrop-filter:blur(3px);';
    modal.innerHTML = `
        <div style="background:#fff; width:min(1080px, calc(100vw - 28px)); max-height:88vh; overflow:auto; border-radius:12px; box-shadow:0 18px 55px rgba(15,23,42,.28);">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:18px 20px 12px; border-bottom:1px solid #e5e7eb;">
                <div><h3 id="manual-adjust-detail-title" style="margin:0 0 5px; color:#9a3412;"></h3><div id="manual-adjust-detail-subtitle" style="font-size:12px; color:#64748b;"></div></div>
                <button type="button" onclick="closeManualAdjustDetailModal()" style="border:0; background:transparent; color:#64748b; font-size:24px; cursor:pointer;">&times;</button>
            </div>
            <div style="padding:16px 20px 20px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
                    <div style="font-size:12px; color:#64748b;">${rt('report.adjust.recordsHint')}</div>
                    <button type="button" onclick="addManualAdjustRecord()" style="flex:0 0 auto; padding:7px 11px; border:1px solid #fdba74; border-radius:7px; background:#fff7ed; color:#c2410c; cursor:pointer; font-size:12px; font-weight:600;">＋ ${rt('report.adjust.addOccurrence')}</button>
                </div>
                <div style="overflow-x:auto; border:1px solid #e2e8f0; border-radius:9px;">
                    <table style="width:100%; min-width:900px; border-collapse:collapse; table-layout:fixed; font-size:12px;">
                        <thead><tr style="background:#fff7ed; color:#9a3412;">
                            <th style="width:44px; padding:9px 6px;">#</th>
                            <th style="width:158px; padding:9px 6px;">${rt('report.adjust.occurredAt')}</th>
                            <th style="width:112px; padding:9px 6px;">${rt('report.adjust.recorder')}</th>
                            <th style="padding:9px 6px;">${rt('report.adjust.reasonLabel')}</th>
                            <th style="width:210px; padding:9px 6px;">${rt('report.adjust.evidenceLabel')}</th>
                            <th style="width:54px; padding:9px 6px;">${rt('report.table.action')}</th>
                        </tr></thead>
                        <tbody id="manual-adjust-records-body"></tbody>
                    </table>
                </div>
                <div style="font-size:11px; color:#94a3b8; margin-top:8px;">${rt('report.adjust.evidenceHint')}</div>
                <div style="margin-top:16px; padding-top:13px; border-top:1px solid #e5e7eb;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:7px;">
                        <strong style="font-size:12px; color:#475569;">🕘 ${rt('report.adjust.changeLogTitle')}</strong>
                        <span style="font-size:10px; color:#94a3b8;">${rt('report.adjust.changeLogHint')}</span>
                    </div>
                    <div id="manual-adjust-change-log"></div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:20px; padding-top:14px; border-top:1px solid #e5e7eb;">
                    <button type="button" onclick="closeManualAdjustDetailModal()" style="padding:8px 16px; border:1px solid #cbd5e1; background:#fff; border-radius:7px; cursor:pointer;">${rt('report.button.cancel')}</button>
                    <button type="button" id="manual-adjust-detail-save" onclick="saveManualAdjustDetail()" style="padding:8px 16px; border:0; background:#ea580c; color:#fff; border-radius:7px; cursor:pointer; font-weight:600;">${rt('report.adjust.saveDetail')}</button>
                </div>
            </div>
        </div>`;
    modal.addEventListener('click', event => {
        if (event.target === modal) closeManualAdjustDetailModal();
    });
    document.body.appendChild(modal);
    return modal;
}

window.openManualAdjustDetailModal = function (cat, idx) {
    if (!currentSnapshot || !manualAdjustItems[idx]) return;
    const stored = currentSnapshot.manualAdjustDetails?.[cat]?.[idx];
    const occurrenceInput = getManualAdjustOccurrenceInput(cat, idx);
    const occurrenceCount = Math.max(0, parseInt(occurrenceInput?.value, 10) || 0);
    if (occurrenceCount < 1) {
        showToast(rt('report.toast.enterOccurrenceFirst'), 'error');
        occurrenceInput?.focus();
        return;
    }
    const records = normalizeManualAdjustDetailRecords(stored);
    const originalRecords = records.map(record => serializeManualAdjustRecord(record));
    if (records.length > occurrenceCount && !confirm(rt('report.confirm.trimAdjustRecords', { count: records.length - occurrenceCount }))) return;
    while (records.length < occurrenceCount) records.push(createManualAdjustRecord());
    records.splice(occurrenceCount);
    manualAdjustDetailDraft = {
        cat,
        idx,
        records,
        originalRecords,
        changeLog: Array.isArray(stored?.changeLog) ? stored.changeLog.map(item => ({ ...item })) : []
    };
    manualAdjustLogVisibleCount = 5;
    const modal = ensureManualAdjustDetailModal();
    document.getElementById('manual-adjust-detail-title').textContent = rt('report.adjust.detailTitle');
    const autoSource = currentSnapshot.manualAdjustAutoFillSources?.[idx];
    const autoSourceHint = (autoSource && autoSource.label) ? ` (${rt('report.auto.source')}: ${getTranslatedLabel(autoSource.label)})` : '';
    document.getElementById('manual-adjust-detail-subtitle').textContent = `${cat} · ${getTranslatedLabel(manualAdjustItems[idx].name)}${autoSourceHint}`;
    renderManualAdjustRecords();
    renderManualAdjustChangeLog();
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
};

window.closeManualAdjustDetailModal = function () {
    const modal = document.getElementById('manual-adjust-detail-modal');
    if (modal) modal.style.display = 'none';
    manualAdjustDetailDraft?.records.forEach(record => record.newFiles.forEach(item => URL.revokeObjectURL(item.previewUrl)));
    manualAdjustDetailDraft = null;
};

window.addManualAdjustRecord = function () {
    if (!manualAdjustDetailDraft) return;
    syncManualAdjustRecordFields();
    manualAdjustDetailDraft.records.push(createManualAdjustRecord());
    renderManualAdjustRecords();
};

window.removeManualAdjustRecord = function (index) {
    if (!manualAdjustDetailDraft || manualAdjustDetailDraft.records.length <= 1) return;
    if (!confirm(rt('report.confirm.deleteAdjustRecord', { index: index + 1 }))) return;
    syncManualAdjustRecordFields();
    const [removed] = manualAdjustDetailDraft.records.splice(index, 1);
    removed?.newFiles.forEach(item => URL.revokeObjectURL(item.previewUrl));
    renderManualAdjustRecords();
};

window.addManualAdjustRecordFiles = function (recordIndex, fileList) {
    if (!manualAdjustDetailDraft) return;
    syncManualAdjustRecordFields();
    const record = manualAdjustDetailDraft.records[recordIndex];
    if (!record) return;
    const files = Array.from(fileList || []);
    if (record.attachments.length + record.newFiles.length + files.length > 8) {
        showToast(rt('report.toast.tooManyEvidenceFiles'), 'error');
        return;
    }
    files.forEach(file => {
        if (file.size > 12 * 1024 * 1024) {
            showToast(rt('report.toast.evidenceFileTooLarge', { name: file.name }), 'error');
            return;
        }
        record.newFiles.push({ file, previewUrl: URL.createObjectURL(file) });
    });
    renderManualAdjustRecords();
};

window.removeManualAdjustRecordFile = function (recordIndex, kind, fileIndex) {
    if (!manualAdjustDetailDraft) return;
    syncManualAdjustRecordFields();
    const record = manualAdjustDetailDraft.records[recordIndex];
    if (!record) return;
    if (kind === 'new') {
        const [removed] = record.newFiles.splice(fileIndex, 1);
        if (removed) URL.revokeObjectURL(removed.previewUrl);
    } else {
        record.attachments.splice(fileIndex, 1);
    }
    renderManualAdjustRecords();
};

function renderManualAdjustRecordFiles(record, recordIndex) {
    const entries = [
        ...record.attachments.map((attachment, index) => ({ kind: 'saved', index, attachment, previewUrl: attachment.url })),
        ...record.newFiles.map((entry, index) => ({ kind: 'new', index, attachment: { name: entry.file.name, type: entry.file.type, size: entry.file.size }, previewUrl: entry.previewUrl }))
    ];
    const items = entries.map(entry => {
        const attachment = entry.attachment;
        const preview = isManualAdjustImage(attachment)
            ? `<img src="${escapeHTML(entry.previewUrl)}" alt="" style="width:38px; height:38px; object-fit:cover; border-radius:5px; background:#f1f5f9;">`
            : `<div style="width:38px; height:38px; display:flex; align-items:center; justify-content:center; border-radius:5px; background:#f1f5f9; font-size:18px;">📄</div>`;
        const visual = entry.kind === 'saved'
            ? `<a href="${escapeHTML(entry.previewUrl)}" target="_blank" rel="noopener" title="${escapeHTML(rt('report.adjust.openEvidence'))}">${preview}</a>`
            : preview;
        return `<div style="position:relative; width:42px; padding:2px; border:1px solid #e2e8f0; border-radius:6px; background:#fff;">
            ${visual}
            <button type="button" onclick="removeManualAdjustRecordFile(${recordIndex}, '${entry.kind}', ${entry.index})" title="${escapeHTML(attachment.name)} · ${formatManualAdjustFileSize(attachment.size)}" style="position:absolute; right:-5px; top:-5px; width:16px; height:16px; padding:0; border:0; border-radius:8px; background:#475569; color:#fff; cursor:pointer; font-size:11px; line-height:16px;">×</button>
        </div>`;
    }).join('');
    return `<div style="display:flex; flex-wrap:wrap; gap:7px; align-items:center;">${items}<label title="${escapeHTML(rt('report.adjust.chooseFiles'))}" style="width:42px; height:42px; display:flex; align-items:center; justify-content:center; border:1px dashed #fb923c; border-radius:6px; color:#c2410c; cursor:pointer; font-size:19px;">＋<input type="file" multiple accept="image/*,.pdf,.txt,.csv,.xlsx,.xls,.docx,.doc,.pptx,.ppt,.zip" onchange="addManualAdjustRecordFiles(${recordIndex}, this.files)" hidden></label></div>`;
}

function syncManualAdjustRecordFields() {
    if (!manualAdjustDetailDraft) return;
    document.querySelectorAll('#manual-adjust-records-body tr[data-record-index]').forEach(row => {
        const record = manualAdjustDetailDraft.records[Number(row.dataset.recordIndex)];
        if (!record) return;
        record.occurredAt = row.querySelector('[data-field="occurredAt"]')?.value || '';
        record.recorder = row.querySelector('[data-field="recorder"]')?.value.trim() || '';
        record.reason = row.querySelector('[data-field="reason"]')?.value.trim() || '';
    });
}

function renderManualAdjustRecords() {
    const body = document.getElementById('manual-adjust-records-body');
    if (!body || !manualAdjustDetailDraft) return;
    body.innerHTML = manualAdjustDetailDraft.records.map((record, index) => `<tr data-record-index="${index}" style="border-top:1px solid #e2e8f0; vertical-align:middle;">
        <td style="padding:9px 6px; text-align:center; font-weight:700; color:#c2410c;">${index + 1}</td>
        <td style="padding:7px 5px;"><input data-field="occurredAt" type="datetime-local" value="${escapeHTML(record.occurredAt)}" style="width:100%; height:42px; padding:7px 5px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box; font:inherit;"></td>
        <td style="padding:7px 5px;"><input data-field="recorder" type="text" maxlength="80" value="${escapeHTML(record.recorder)}" placeholder="${escapeHTML(rt('report.adjust.recorderPlaceholder'))}" style="width:100%; height:42px; padding:7px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box; font:inherit;"></td>
        <td style="padding:7px 5px;"><textarea data-field="reason" rows="1" maxlength="2000" placeholder="${escapeHTML(rt('report.adjust.reasonPlaceholder'))}" style="display:block; width:100%; height:42px; min-height:42px; resize:vertical; overflow:auto; padding:10px 7px 7px; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box; font:inherit; line-height:1.35;">${escapeHTML(record.reason)}</textarea></td>
        <td style="padding:9px 8px;">${renderManualAdjustRecordFiles(record, index)}</td>
        <td style="padding:9px 5px; text-align:center;"><button type="button" onclick="removeManualAdjustRecord(${index})" ${manualAdjustDetailDraft.records.length <= 1 ? 'disabled' : ''} title="${escapeHTML(rt('report.adjust.deleteOccurrence'))}" style="border:0; background:transparent; cursor:pointer; opacity:${manualAdjustDetailDraft.records.length <= 1 ? '.25' : '.65'}; font-size:16px;">🗑️</button></td>
    </tr>`).join('');
}

async function uploadManualAdjustAttachment(file) {
    const form = new FormData();
    form.append('file', file);
    const headers = {};
    const token = localStorage.getItem('tools_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/db/manual-adjust-attachments', { method: 'POST', headers, body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
}

window.saveManualAdjustDetail = async function () {
    if (!currentSnapshot || !manualAdjustDetailDraft) return;
    const button = document.getElementById('manual-adjust-detail-save');
    button.disabled = true;
    button.textContent = rt('report.adjust.savingDetail');
    try {
        syncManualAdjustRecordFields();
        const { cat, idx } = manualAdjustDetailDraft;
        if (manualAdjustDetailDraft.records.some(record => !record.reason)) {
            throw new Error(rt('report.toast.reasonRequired'));
        }
        const records = await Promise.all(manualAdjustDetailDraft.records.map(async record => ({
            id: record.id,
            occurredAt: record.occurredAt,
            recorder: record.recorder,
            reason: record.reason,
            attachments: [...record.attachments, ...await Promise.all(record.newFiles.map(entry => uploadManualAdjustAttachment(entry.file)))]
        })));
        const changeEntry = buildManualAdjustChangeLogEntry(manualAdjustDetailDraft.originalRecords, records);
        const changeLog = changeEntry
            ? [changeEntry, ...(manualAdjustDetailDraft.changeLog || [])]
            : (manualAdjustDetailDraft.changeLog || []);
        manualAdjustDetailDraft.records.forEach(record => record.newFiles.forEach(item => URL.revokeObjectURL(item.previewUrl)));
        manualAdjustDetailDraft.records = records.map(createManualAdjustRecord);
        manualAdjustDetailDraft.originalRecords = records.map(serializeManualAdjustRecord);
        manualAdjustDetailDraft.changeLog = changeLog;
        currentSnapshot.manualAdjustData = collectManualAdjustDataFromInputs();
        const occurrenceInput = getManualAdjustOccurrenceInput(cat, idx);
        if (occurrenceInput) occurrenceInput.value = String(records.length);
        currentSnapshot.manualAdjustData[cat][idx] = records.length;
        currentSnapshot.manualAdjustDetails ||= {};
        currentSnapshot.manualAdjustDetails[cat] ||= {};
        currentSnapshot.manualAdjustDetails[cat][idx] = { records, changeLog };
        await putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-adjust-detail');
        closeManualAdjustDetailModal();
        renderCurrentSnapshot();
        showToast(rt('report.toast.manualAdjustDetailSaved'), 'success');
    } catch (error) {
        console.error(error);
        showToast(error.message || rt('report.toast.saveFailed'), 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = rt('report.adjust.saveDetail');
        }
    }
};

function renderRanking() {
    const catData = window._currentCatData;
    const cats = Object.keys(catData);

    // Calculate final scores
    cats.forEach(cat => {
        const d = catData[cat];
        const manualInput = document.getElementById(`manual-score-${cat}`);
        if (manualInput) {
            d.manualScore = parseFloat(manualInput.value) || 0;
        }

        let baseScore = 0;
        if (d.validWeightSum > 0) {
            baseScore = (d.earnedScore / d.validWeightSum) * standardTotalScore;
        }
        d.baseScore = +baseScore.toFixed(2);
        d.finalScore = +(d.baseScore + d.manualScore).toFixed(2);
    });

    // Sort
    const sortedCats = cats.sort((a, b) => catData[b].finalScore - catData[a].finalScore);

    const tbody = document.getElementById('ranking-tbody');
    if (!tbody) return;

    let html = '';
    sortedCats.forEach((cat, index) => {
        const d = catData[cat];
        let medal = `${index + 1}`;
        if (index === 0) medal = '<span class="rank-medal">🥇</span>';
        if (index === 1) medal = '<span class="rank-medal">🥈</span>';
        if (index === 2) medal = '<span class="rank-medal">🥉</span>';

        let scoreClass = 'score-badge';
        const ratio = d.validWeightSum > 0 ? (d.baseScore / standardTotalScore) : 0;

        if (ratio >= 0.95) scoreClass += ' success';
        else if (ratio < 0.8) scoreClass += ' danger';

        html += `
            <tr>
                <td style="font-weight:bold; color:#777; padding:8px;">${medal}</td>
                <td style="text-align:left; padding:8px;" class="cat-name">${escapeHTML(d.name)}</td>
                <td style="color:#666; font-weight:bold; padding:8px;">
                    <span onclick="showStdScoreDetails()" style="cursor:pointer; border-bottom:1px dashed #999;" title="${rt('report.detail.clickTitle')}">${standardTotalScore}</span>
                </td>
                <td style="color:#2c3e50; font-weight:bold; padding:8px;">
                    <div onclick="showSysScoreDetails('${escapeHTML(cat)}')" style="cursor:pointer; border-bottom:1px dashed #0277bd; display:inline-block;" title="${rt('report.detail.clickCalc')}">${d.baseScore}</div>
                    <div style="font-size:11px;color:#aaa;font-weight:normal;margin-top:2px;">(${rt('report.detail.earned')} ${formatScoreValue(d.earnedScore)} / ${rt('report.detail.fullWeight')} ${formatScoreValue(d.validWeightSum)})</div>
                </td>
                <td style="padding:8px;">
                    <div onclick="showAdjScoreDetails('${escapeHTML(cat)}')" style="cursor:pointer; display:inline-block; border-bottom:1px dashed #e65100; font-weight:bold; color:${d.manualScore >= 0 ? '#2e7d32' : '#c62828'};" title="${rt('report.detail.clickAdj')}">${d.manualScore >= 0 ? '+' + d.manualScore : d.manualScore}</div>
                </td>
                <td style="padding:8px;"><span class="${scoreClass}" style="padding:4px 12px; font-size:16px;">${d.finalScore}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

window.showScoreDetails = function (title, content) {
    let modal = document.getElementById('details-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'details-modal';
        modal.style.cssText = 'display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; align-items:center; justify-content:center;';
        modal.innerHTML = `
            <div style="background:#fff; border-radius:12px; width:760px; max-width:95%; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #eee; padding-bottom:12px;">
                    <h3 id="details-modal-title" style="margin:0; color:#0277bd;"></h3>
                    <button onclick="document.getElementById('details-modal').style.display='none'" style="border:none; background:none; font-size:20px; cursor:pointer; color:#888;">&times;</button>
                </div>
                <div id="details-modal-content" style="max-height:60vh; overflow-y:auto; font-size:13px; line-height:1.6; padding-right:10px;"></div>
                <div style="text-align:center; margin-top:20px; padding-top:10px; border-top:1px solid #eee;">
                    <button onclick="document.getElementById('details-modal').style.display='none'" style="padding:8px 24px; border:1px solid #ccc; background:#fff; color:#333; border-radius:6px; cursor:pointer;">${rt('report.detail.close')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    }
    document.getElementById('details-modal-title').innerHTML = title;
    document.getElementById('details-modal-content').innerHTML = content;
    modal.style.display = 'flex';
};

window.showStdScoreDetails = function () {
    showScoreDetails(rt('report.detail.stdTitle'), `
        <div style="margin-bottom:10px;">${rt('report.detail.stdIntro')}</div>
        <div style="font-size:24px; font-weight:bold; color:#0277bd; text-align:center; padding:10px; background:#f5f8fa; border-radius:6px;">${standardTotalScore}</div>
        <ul style="margin-top:10px; padding-left:20px; color:#555;">
            <li>${rt('report.detail.stdRule1')}</li>
            <li>${rt('report.detail.stdRule2')}</li>
        </ul>
    `);
};

window.showSysScoreDetails = function (cat) {
    const d = window._currentCatData[cat];
    if (!d) return;

    let passHtml = '';
    let failHtml = '';
    let rawLostWeight = 0;
    let bonusCredit = 0;
    // 排除项拆成两桶
    let onlyMissingHtml = '';  // ⚠️ 仅当前项缺考：其他客户群/代表处/区域有数据，当前项没有
    let allExcludedHtml = '';  // ⚪ 全员豁免：所有客户群/代表处/区域都无数据 / 未配置目标

    const targetMonth = document.getElementById('target-month-select').value;
    const allCatData = window._currentCatData || {};
    const allMetrics = window._currentOrderedMetrics || [];

    allMetrics.forEach(m => {
        const mLabel = m.label;
        if (window._currentLabelToGroup && window._currentLabelToGroup[mLabel] === 'Others') return;

        const cell = d.values[mLabel];
        const targetData = labelToTargetMap[mLabel];
        const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
        const hasTarget = getEffectiveTargetValue(targetData, targetMonth, cat) !== undefined && weight > 0;

        if (!hasTarget || !cell || cell.raw === '--') {
            const otherHasData = Object.keys(allCatData).some(otherCat => {
                if (otherCat === cat) return false;
                const otherCell = allCatData[otherCat].values[mLabel];
                return otherCell && otherCell.raw !== '--' && !isNaN(otherCell.num);
            });

            if (!hasTarget) {
                allExcludedHtml += `<li style="margin-bottom:8px; line-height:1.4;"><span style="color:#999; font-weight:600;">${getBilingual(mLabel)}</span> <span style="color:#ccc; font-size:11px;">(${rt('report.detail.noTarget')})</span></li>`;
            } else if (otherHasData) {
                onlyMissingHtml += `<li style="margin-bottom:8px; line-height:1.4;"><span style="color:#b45309; font-weight:600;">${getBilingual(mLabel)}</span> <span style="color:#d97706; font-size:11px;">(${rt('report.detail.noData')})</span></li>`;
            } else {
                allExcludedHtml += `<li style="margin-bottom:8px; line-height:1.4;"><span style="color:#999; font-weight:600;">${getBilingual(mLabel)}</span> <span style="color:#ccc; font-size:11px;">(${rt('report.detail.globalNoData')})</span></li>`;
            }
        } else if (cell.isFailing) {
            rawLostWeight += Math.max(0, weight - (Number(cell.earnedScore) || 0));
            const partialText = (cell.proportionalScoring || cell.negativePercentageScoring)
                ? `, ${rt('report.detail.partial')}: ${formatScoreValue(cell.earnedScore)} / ${weight}, ${rt('report.detail.completion')} ${(cell.completionRatio * 100).toFixed(1)}%`
                : '';
            failHtml += `<li style="margin-bottom:8px; line-height:1.4;"><span style="color:#d32f2f; font-weight:600;">${getBilingual(mLabel)}</span> <span style="color:#888; font-size:11px;">(${rt('report.detail.weight')}: ${weight}, ${rt('report.detail.gap')}: ${cell.gapStr}${partialText})</span></li>`;
        } else {
            bonusCredit += Math.max(0, (Number(cell.earnedScore) || 0) - weight);
            passHtml += `<li style="margin-bottom:8px; line-height:1.4;"><span style="color:#2e7d32; font-weight:600;">${getBilingual(mLabel)}</span> <span style="color:#888; font-size:11px;">(${rt('report.detail.weight')}: ${weight})</span></li>`;
        }
    });

    const netLostWeight = rawLostWeight - bonusCredit;
    const lostSummaryHtml = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(96px, 1fr)); gap:8px; margin-bottom:10px;">
            <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:10px; color:#9a3412; margin-bottom:2px;">${rt('report.detail.rawLostWeight')}</div>
                <div style="font-weight:bold; color:#c2410c; font-size:14px;">${formatScoreValue(rawLostWeight)}</div>
            </div>
            <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:10px; color:#166534; margin-bottom:2px;">${rt('report.detail.bonusCredit')}</div>
                <div style="font-weight:bold; color:#15803d; font-size:14px;">+${formatScoreValue(bonusCredit)}</div>
            </div>
            <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:10px; color:#991b1b; margin-bottom:2px;">${rt('report.detail.netLostWeight')}</div>
                <div style="font-weight:bold; color:#b91c1c; font-size:14px;">${formatScoreValue(netLostWeight)}</div>
            </div>
        </div>`;

    // 拼接排除项区块：仅在有内容时才渲染对应子块
    const onlyMissingBlock = onlyMissingHtml ? `
        <div style="margin-bottom:8px;">
            <div style="color:#b45309; font-size:11px; font-weight:bold; margin-bottom:4px; display:flex; align-items:center; gap:4px;">
                <span>${rt('report.detail.missingOnly')}</span>
                <span style="color:#d97706; font-weight:normal;">- ${rt('report.detail.missingOnlyHint')}</span>
            </div>
            <ul style="margin:0; padding-left:15px;">${onlyMissingHtml}</ul>
        </div>` : '';

    const allExcludedBlock = allExcludedHtml ? `
        <div>
            <div style="color:#999; font-size:11px; font-weight:bold; margin-bottom:4px; display:flex; align-items:center; gap:4px;">
                <span>${rt('report.detail.globalExempt')}</span>
                <span style="color:#bbb; font-weight:normal;">- ${rt('report.detail.globalExemptHint')}</span>
            </div>
            <ul style="margin:0; padding-left:15px;">${allExcludedHtml}</ul>
        </div>` : '';

    const excludedSection = (onlyMissingHtml || allExcludedHtml)
        ? `${onlyMissingBlock}${onlyMissingHtml && allExcludedHtml ? '<hr style="border:none; border-top:1px dashed #e0e0e0; margin:8px 0;">' : ''}${allExcludedBlock}`
        : `<li style="color:#999;">${rt('report.detail.none')}</li>`;

    showScoreDetails(rt('report.detail.sysTitle', { name: escapeHTML(d.name) }), `
        <div style="background:#f5f8fa; padding:12px; border-radius:6px; text-align:center; margin-bottom:15px; border:1px solid #e1e8ed;">
            <div style="color:#666; font-size:12px; margin-bottom:4px;">${rt('report.detail.formula')} ( ${rt('report.detail.earned')} / ${rt('report.detail.fullWeight')} ) x ${rt('report.detail.standardTotal')}</div>
            <span style="font-size:18px; color:#333;">( </span>
            <span style="color:#2e7d32; font-weight:bold; font-size:18px;" title="${rt('report.detail.earnedWeight')}">${formatScoreValue(d.earnedScore)}</span>
            <span style="font-size:18px; color:#333;"> / </span>
            <span style="color:#ef6c00; font-weight:bold; font-size:18px;" title="${rt('report.detail.fullWeight')}">${d.validWeightSum}</span>
            <span style="font-size:18px; color:#333;"> ) × </span>
            <span style="color:#0277bd; font-weight:bold; font-size:18px;" title="${rt('report.detail.standardTotal')}">${standardTotalScore}</span>
            <span style="font-size:18px; color:#333;"> = </span>
            <span style="color:#2c3e50; font-weight:bold; font-size:22px;">${d.baseScore}</span>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
            <div style="flex:1; background:#f1f8e9; padding:10px; border-radius:6px; border:1px solid #c8e6c9;">
                <div style="color:#2e7d32; font-weight:bold; border-bottom:1px solid #c8e6c9; padding-bottom:5px; margin-bottom:8px;">${rt('report.detail.passed')} (${rt('report.detail.earnedWeight')} ${formatScoreValue(d.earnedScore)})</div>
                <ul style="margin:0; padding-left:15px; font-size:12px; color:#333;">${passHtml || `<li style="color:#999;">${rt('report.detail.none')}</li>`}</ul>
            </div>
            <div style="flex:1; background:#ffebee; padding:10px; border-radius:6px; border:1px solid #ffcdd2;">
                <div style="color:#c62828; font-weight:bold; border-bottom:1px solid #ffcdd2; padding-bottom:5px; margin-bottom:8px;">${rt('report.detail.failed')} (${rt('report.detail.netLostWeight')} ${formatScoreValue(netLostWeight)})</div>
                ${lostSummaryHtml}
                <ul style="margin:0; padding-left:15px; font-size:12px; color:#333;">${failHtml || `<li style="color:#999;">${rt('report.detail.none')}</li>`}</ul>
            </div>
        </div>
        <div style="background:#fafafa; padding:10px; border-radius:6px; border:1px solid #e0e0e0; font-size:12px; color:#666;">
            <div style="color:#777; font-weight:bold; border-bottom:1px solid #e0e0e0; padding-bottom:6px; margin-bottom:8px;">${rt('report.detail.excluded')}</div>
            ${excludedSection}
        </div>
    `);
};

window.showAdjScoreDetails = function (cat) {
    const d = window._currentCatData[cat];
    if (!d) return;

    let adjDetails = '';
    if (currentSnapshot && currentSnapshot.manualAdjustData && currentSnapshot.manualAdjustData[cat]) {
        const catAdj = currentSnapshot.manualAdjustData[cat];
        getOrderedManualAdjustEntries().forEach(({ item, idx }) => {
            const count = catAdj[idx] || 0;
            if (count > 0) {
                const score = calculateManualAdjustScore(item, count);
                const detail = currentSnapshot.manualAdjustDetails?.[cat]?.[idx];
                const records = normalizeManualAdjustDetailRecords(detail);
                const recordsHtml = records.length ? `<div style="margin-top:7px; display:flex; flex-direction:column; gap:6px;">${records.map((record, recordIndex) => {
                    const attachments = Array.isArray(record.attachments) ? record.attachments : [];
                    const attachmentHtml = attachments.length ? `<div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px;">${attachments.map(attachment => isManualAdjustImage(attachment)
                        ? `<a href="${escapeHTML(attachment.url)}" target="_blank" rel="noopener" title="${escapeHTML(attachment.name)}"><img src="${escapeHTML(attachment.url)}" alt="${escapeHTML(attachment.name)}" style="width:38px; height:38px; object-fit:cover; border:1px solid #e2e8f0; border-radius:5px;"></a>`
                        : `<a href="${escapeHTML(attachment.url)}" target="_blank" rel="noopener" style="font-size:10px; color:#2563eb; text-decoration:none; padding:3px 6px; border:1px solid #bfdbfe; border-radius:5px;">📎 ${escapeHTML(attachment.name)}</a>`).join('')}</div>` : '';
                    const meta = [record.occurredAt ? record.occurredAt.replace('T', ' ') : '', record.recorder].filter(Boolean).join(' · ');
                    return `<div style="padding:7px 9px; border:1px solid #e2e8f0; border-radius:6px; background:#f8fafc; font-size:11px;">
                        <div style="display:flex; gap:8px;"><strong style="color:#c2410c;">#${recordIndex + 1}</strong><span style="color:#94a3b8;">${escapeHTML(meta)}</span></div>
                        <div style="margin-top:4px; color:#475569; white-space:pre-wrap;">${escapeHTML(record.reason || rt('report.adjust.noReason'))}</div>${attachmentHtml}
                    </div>`;
                }).join('')}</div>` : '';

                const color = score > 0 ? '#2e7d32' : '#d32f2f';
                adjDetails += `
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px; border-bottom:1px dashed #eee; padding-bottom:6px;">
                        <span style="flex:1; padding-right:10px; color:#333;">${getBilingual(item.name)} <span style="background:#eee; padding:1px 6px; border-radius:10px; font-size:11px; margin-left:4px;">x${count}</span>${recordsHtml}</span>
                        <span style="color:${color}; font-weight:bold;">${score > 0 ? '+' + score : score}</span>
                    </div>
                `;
            }
        });
    }

    showScoreDetails(rt('report.detail.adjTitle', { name: escapeHTML(d.name) }), `
        <div style="font-size:24px; font-weight:bold; color:${d.manualScore >= 0 ? '#2e7d32' : '#d32f2f'}; text-align:center; padding:10px; background:#f5f8fa; border-radius:6px; margin-bottom:15px; border:1px solid #e1e8ed;">
            ${d.manualScore >= 0 ? '+' + d.manualScore : d.manualScore}
        </div>
        ${adjDetails || `<div style="text-align:center; color:#888; padding:20px;">${rt('report.detail.noAdjRecords')}</div>`}
    `);
};

function renderManualAdjustSortList() {
    const list = document.getElementById('manual-adjust-sort-list');
    if (!list) return;
    list.innerHTML = manualAdjustSortDraft.map((idx, position) => {
        const item = manualAdjustItems[idx];
        return `
            <div class="manual-adjust-sort-row" data-item-idx="${idx}" draggable="true"
                ondragstart="startManualAdjustSortDrag(event, ${idx})"
                ondragover="dragManualAdjustSortOver(event, ${idx})"
                ondrop="event.preventDefault()"
                ondragend="endManualAdjustSortDrag()"
                style="display:flex; align-items:center; gap:8px; padding:9px 10px; border:1px solid #eee; border-radius:7px; background:#fff; cursor:grab; user-select:none; transition:transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s, opacity .2s;">
                <span style="color:#b0bec5; font-size:18px; letter-spacing:-4px; padding-right:4px;" title="${rt('report.sort.dragHint')}">⠿</span>
                <span class="manual-adjust-sort-order" style="width:24px; color:#999; text-align:center;">${position + 1}</span>
                <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHTML(getTranslatedLabel(item.name))}">${getBilingual(item.name)}</span>
            </div>
        `;
    }).join('');
}

window.openManualAdjustSortModal = function () {
    manualAdjustSortDraft = getOrderedManualAdjustEntries().map(entry => entry.idx);
    let modal = document.getElementById('manual-adjust-sort-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'manual-adjust-sort-modal';
    modal.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:99999; align-items:center; justify-content:center;';
    modal.innerHTML = `
            <div style="background:#fff; border-radius:12px; width:520px; max-width:90%; padding:22px; box-shadow:0 10px 30px rgba(0,0,0,.2);">
                <h3 style="margin:0 0 14px; color:#e65100;">${rt('report.sort.title')}</h3>
                <div style="font-size:12px; color:#78909c; margin:-6px 0 10px;">${rt('report.sort.dragHint')}</div>
                <div id="manual-adjust-sort-list" style="display:flex; flex-direction:column; gap:6px; max-height:55vh; overflow:auto;"></div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px;">
                    <button type="button" onclick="document.getElementById('manual-adjust-sort-modal').style.display='none'" style="padding:8px 16px; border:1px solid #ccc; background:#fff; border-radius:6px; cursor:pointer;">${rt('report.button.cancel')}</button>
                    <button type="button" onclick="saveManualAdjustSort()" style="padding:8px 16px; border:0; background:#e65100; color:#fff; border-radius:6px; cursor:pointer; font-weight:bold;">${rt('report.sort.save')}</button>
                </div>
            </div>
        `;
    document.body.appendChild(modal);
    renderManualAdjustSortList();
    modal.style.display = 'flex';
};

window.startManualAdjustSortDrag = function (event, itemIdx) {
    manualAdjustSortDragIdx = itemIdx;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(itemIdx));
    event.currentTarget.style.opacity = '.55';
    event.currentTarget.style.boxShadow = '0 8px 22px rgba(230,81,0,.22)';
    event.currentTarget.style.cursor = 'grabbing';
};

window.dragManualAdjustSortOver = function (event, targetItemIdx) {
    event.preventDefault();
    if (manualAdjustSortDragIdx === null || manualAdjustSortDragIdx === targetItemIdx) return;
    const from = manualAdjustSortDraft.indexOf(manualAdjustSortDragIdx);
    const to = manualAdjustSortDraft.indexOf(targetItemIdx);
    if (from < 0 || to < 0 || from === to) return;

    const list = document.getElementById('manual-adjust-sort-list');
    const rows = Array.from(list.querySelectorAll('.manual-adjust-sort-row'));
    const before = new Map(rows.map(row => [row.dataset.itemIdx, row.getBoundingClientRect().top]));

    manualAdjustSortDraft.splice(from, 1);
    manualAdjustSortDraft.splice(to, 0, manualAdjustSortDragIdx);
    const rowMap = new Map(rows.map(row => [Number(row.dataset.itemIdx), row]));
    manualAdjustSortDraft.forEach(idx => list.appendChild(rowMap.get(idx)));

    Array.from(list.querySelectorAll('.manual-adjust-sort-row')).forEach((row, position) => {
        const delta = before.get(row.dataset.itemIdx) - row.getBoundingClientRect().top;
        row.querySelector('.manual-adjust-sort-order').textContent = String(position + 1);
        if (!delta) return;
        row.style.transition = 'none';
        row.style.transform = `translateY(${delta}px)`;
        void row.offsetHeight;
        row.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1), box-shadow .2s, opacity .2s';
        row.style.transform = '';
    });
};

window.endManualAdjustSortDrag = function () {
    manualAdjustSortDragIdx = null;
    document.querySelectorAll('#manual-adjust-sort-list .manual-adjust-sort-row').forEach(row => {
        row.style.opacity = '1';
        row.style.boxShadow = 'none';
        row.style.cursor = 'grab';
    });
};

window.saveManualAdjustSort = async function () {
    manualAdjustSortDraft.forEach((itemIdx, order) => {
        manualAdjustItems[itemIdx].sortOrder = order;
    });
    try {
        document.getElementById('manual-adjust-sort-modal').style.display = 'none';
        await saveManualAdjustItemsConfig(rt('report.toast.adjustSortSaved'));
    } catch (e) {
        showToast(rt('report.toast.saveFailed'), 'error');
    }
};

window.openAddAdjustModal = function (idx = null) {
    const editIdx = Number.isInteger(idx) && manualAdjustItems[idx] && !manualAdjustItems[idx].deleted ? idx : null;
    editingAdjustItemIndex = editIdx;

    let modal = document.getElementById('add-adjust-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'add-adjust-modal';
    modal.style.cssText = 'display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:99999; align-items:center; justify-content:center;';
    modal.innerHTML = `
            <div style="background:#fff; border-radius:12px; width:440px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                <h3 style="margin-top:0; margin-bottom:20px; color:#e65100; display:flex; justify-content:space-between; align-items:center;">
                    <span id="adjust-modal-title">${rt('report.adjust.addTitle')}</span>
                    <button onclick="document.getElementById('add-adjust-modal').style.display='none'" style="border:none; background:none; font-size:20px; cursor:pointer; color:#888;">&times;</button>
                </h3>
                <div style="margin-bottom:15px;">
                    <label style="display:block; margin-bottom:5px; font-size:13px; color:#555;">${rt('report.adjust.type')}</label>
                    <select id="new-adjust-type" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; font-size:14px;">
                        <option value="扣分">${rt('report.adjust.deductOption')}</option>
                        <option value="加分">${rt('report.adjust.addOption')}</option>
                    </select>
                </div>
                <div style="margin-bottom:15px;">
                    <label style="display:block; margin-bottom:5px; font-size:13px; color:#555;">${rt('report.adjust.name')}</label>
                    <input type="text" id="new-adjust-name" placeholder="${rt('report.adjust.namePlaceholder')}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; font-size:14px;">
                </div>
                <div style="display:flex; gap:15px; margin-bottom:15px;">
                    <div style="flex:1;">
                        <label style="display:block; margin-bottom:5px; font-size:13px; color:#555;">${rt('report.adjust.unit')}</label>
                        <input type="number" id="new-adjust-unit" value="2" min="1" step="0.5" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; font-size:14px;">
                    </div>
                    <div style="flex:1;">
                        <label style="display:block; margin-bottom:5px; font-size:13px; color:#555;">${rt('report.adjust.cap')}</label>
                        <input type="number" id="new-adjust-cap" placeholder="${rt('report.adjust.capPlaceholder')}" min="1" step="0.5" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box; font-size:14px;">
                    </div>
                </div>
                <div style="margin-bottom:15px; padding:10px 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px;">
                    <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:#333; font-weight:500; margin:0;">
                        <input type="checkbox" id="new-adjust-autofill" style="cursor:pointer; width:16px; height:16px;">
                        <span>${rt('report.adjust.autoFillCheckboxLabel')}</span>
                    </label>
                    <div style="font-size:11px; color:#64748b; margin-top:4px; margin-left:24px; line-height:1.4;">${rt('report.adjust.autoFillCheckboxHint')}</div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:25px;">
                    <button onclick="document.getElementById('add-adjust-modal').style.display='none'" style="padding:8px 16px; border:1px solid #ccc; background:#fff; border-radius:6px; cursor:pointer;">${rt('report.button.cancel')}</button>
                    <button id="adjust-modal-save-btn" onclick="saveNewAdjustItem()" style="padding:8px 16px; border:none; background:#e65100; color:#fff; border-radius:6px; cursor:pointer; font-weight:bold;">${rt('report.adjust.saveGlobal')}</button>
                </div>
            </div>
        `;

    const item = editIdx === null ? null : manualAdjustItems[editIdx];
    modal.querySelector('#adjust-modal-title').textContent = editIdx === null ? rt('report.adjust.addTitle') : rt('report.adjust.editTitle');
    modal.querySelector('#adjust-modal-save-btn').textContent = editIdx === null ? rt('report.adjust.saveGlobal') : rt('report.adjust.updateGlobal');
    modal.querySelector('#new-adjust-type').value = item ? item.type : '扣分';
    modal.querySelector('#new-adjust-name').value = item ? item.name : '';
    modal.querySelector('#new-adjust-unit').value = item ? item.unit : '2';
    modal.querySelector('#new-adjust-cap').value = item && item.cap !== null && item.cap !== undefined && item.cap !== '' ? item.cap : '';
    const isAuto = editIdx !== null ? isManualAdjustItemAutoFillEnabled(editIdx) : false;
    modal.querySelector('#new-adjust-autofill').checked = isAuto;

    const card = document.getElementById('adjust-card');
    if (document.fullscreenElement === card) {
        card.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
};

window.saveNewAdjustItem = async function () {
    const type = document.getElementById('new-adjust-type').value;
    const name = document.getElementById('new-adjust-name').value.trim();
    const unit = parseFloat(document.getElementById('new-adjust-unit').value) || 0;
    const capStr = document.getElementById('new-adjust-cap').value.trim();
    const cap = capStr === '' ? null : parseFloat(capStr);
    const autoFill = !!document.getElementById('new-adjust-autofill')?.checked;

    if (!name) {
        showToast(rt('report.toast.enterItemName'), 'error');
        return;
    }

    if (unit <= 0) {
        showToast(rt('report.toast.enterValidAdjustUnit'), 'error');
        return;
    }

    if (capStr !== '' && (!Number.isFinite(cap) || cap <= 0)) {
        showToast(rt('report.toast.enterValidAdjustCap'), 'error');
        return;
    }

    const desc = buildManualAdjustDesc(unit, cap);
    const nextItem = { type, name, unit, cap, desc, autoFill };

    let targetIdx = editingAdjustItemIndex;
    if (editingAdjustItemIndex === null) {
        manualAdjustItems.push(nextItem);
        targetIdx = manualAdjustItems.length - 1;
    } else {
        manualAdjustItems[editingAdjustItemIndex] = {
            ...manualAdjustItems[editingAdjustItemIndex],
            ...nextItem
        };
    }

    try {
        await saveManualAdjustItemsConfig(editingAdjustItemIndex === null ? rt('report.toast.customItemAdded') : rt('report.toast.adjustItemUpdated'));

        const prefs = getManualAdjustAutoFillPrefs();
        prefs[String(targetIdx)] = autoFill;
        await saveSlaPrefPatch({ manualAdjustAutoFill: prefs });

        if (autoFill && currentSnapshot) {
            const changed = applyManualAdjustAutoFillToSnapshot(currentSnapshot);
            if (changed) {
                await putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-adjust-auto-fill-modal');
            }
        }

        document.getElementById('add-adjust-modal').style.display = 'none';
        editingAdjustItemIndex = null;
        renderCurrentSnapshot();
    } catch (e) {
        showToast(rt('report.toast.saveFailed'), 'error');
    }
};

window.deleteAdjustItem = async function (idx) {
    if (!confirm('确定要全局删除该加减分项目吗？\n删除后该项目将不再计分，且在所有快照中隐藏！')) {
        return;
    }

    manualAdjustItems[idx].deleted = true;

    try {
        await saveManualAdjustItemsConfig(rt('report.toast.adjustItemDeleted'));

        // Update the current snapshot to purge the removed data
        setTimeout(() => saveManualAdjustData(true), 100);
    } catch (e) {
        showToast(rt('report.toast.deleteFailed'), 'error');
        console.error(e);
    }
};

window.openWeightModal = function () {
    if (!currentSnapshot || !currentSnapshot.topMetrics) {
        showToast(rt('report.toast.loadSnapshotFirst'), 'error');
        return;
    }

    let metricCols = [...(currentSnapshot.topMetrics || [])];

    // Auto inject manual metrics that are missing in current snapshot
    if (globalConfig.targets) {
        Object.keys(globalConfig.targets).forEach(k => {
            if (k.startsWith('manual_') && globalConfig.targets[k].label) {
                const label = globalConfig.targets[k].label;
                if (!metricCols.find(m => m.label === label)) {
                    metricCols.push({ label: label, isManual: true });
                }
            }
        });
    }

    // Sort metricCols according to metricGroups order
    const orderedMetrics = [];
    const assignedLabels = new Set();

    // 1. Grouped metrics first
    metricGroups.forEach(g => {
        (g.metrics || []).forEach(label => {
            const m = metricCols.find(x => x.label === label);
            if (m) {
                orderedMetrics.push(m);
                assignedLabels.add(label);
            }
        });
    });

    // 2. Append ungrouped metrics
    metricCols.forEach(m => {
        if (!assignedLabels.has(m.label)) {
            orderedMetrics.push(m);
        }
    });

    metricCols = orderedMetrics;

    const listEl = document.getElementById('weight-modal-list');

    let html = '';
    metricCols.forEach(m => {
        const targetData = labelToTargetMap[m.label];
        const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
        const key = labelToTargetKeyMap[m.label];

        if (!key) {
            html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:8px; background:#f9f9f9; border-radius:6px; border:1px solid #eee;">
                <span style="font-weight:600; color:#555;">${getBilingual(m.label)}</span>
                <span style="color:#aaa; font-size:12px;">${rt('report.group.notMonitored')}</span>
            </div>`;
        } else {
            const highlightStyle = weight === 0 ? 'border: 2px solid #e53935; background: #ffebee;' : 'border:1px solid #ccc; background:#fff;';
            const labelColor = weight === 0 ? '#e53935' : '#2c3e50';
            const strikeStyle = weight === 0 ? 'text-decoration:line-through; opacity:0.6;' : '';

            html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:10px; background:#f5f8fa; border-radius:6px; border:1px solid #e1e8ed;">
                <span style="font-weight:600; color:${labelColor}; ${strikeStyle}">${getBilingual(m.label)}</span>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:12px; color:#666;">${getTranslatedLabel('权重')}:</span>
                    <input type="number" class="metric-weight-input" data-key="${key}" value="${weight}" step="0.1" min="0" 
                           style="width:70px; padding:6px; ${highlightStyle} border-radius:4px; text-align:center;" 
                           oninput="
                               const w = parseFloat(this.value);
                               const labelSpan = this.closest('div').previousElementSibling;
                               if(w === 0) { 
                                   this.style.backgroundColor = '#ffebee'; 
                                   this.style.borderColor = '#e53935'; 
                                   this.style.borderWidth = '2px';
                                   labelSpan.style.color = '#e53935';
                                   labelSpan.style.textDecoration = 'line-through';
                                   labelSpan.style.opacity = '0.6';
                               } else { 
                                   this.style.backgroundColor = '#fff'; 
                                   this.style.borderColor = '#ccc'; 
                                   this.style.borderWidth = '1px';
                                   labelSpan.style.color = '#2c3e50';
                                   labelSpan.style.textDecoration = 'none';
                                   labelSpan.style.opacity = '1';
                               }
                           ">
                </div>
            </div>`;
        }
    });

    if (!html) {
        html = `<div style="color:#888; text-align:center; padding:20px;">${rt('report.group.noMetrics')}</div>`;
    }

    listEl.innerHTML = html;
    document.getElementById('weight-modal').style.display = 'flex';
};

window.closeWeightModal = function () {
    document.getElementById('weight-modal').style.display = 'none';
};

window.saveWeights = async function () {
    try {
        const inputs = document.querySelectorAll('.metric-weight-input');
        let updatedTargets = { ...globalConfig.targets };

        inputs.forEach(input => {
            const key = input.getAttribute('data-key');
            const w = parseFloat(input.value) || 0;
            if (updatedTargets[key]) {
                updatedTargets[key].weight = w;
            }
        });

        await API.put('/api/sla/targets', updatedTargets);
        globalConfig.targets = updatedTargets;
        buildLabelTargetMap(); // Rebuild mapping with new weights

        showToast(rt('report.toast.weightsSaved'), 'success');
        closeWeightModal();

        renderCurrentSnapshot(); // Re-calculate everything

    } catch (e) {
        showToast(rt('report.toast.weightSaveFailed'), 'error');
        console.error(e);
    }
};

window.openAddMetricModal = function () {
    if (!currentSnapshot) {
        showToast(rt('report.toast.loadSnapshotFirst'), 'error');
        return;
    }
    editingManualMetricLabel = null;

    let modal = document.getElementById('add-metric-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'add-metric-modal';
        modal.style.cssText = 'display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:999; align-items:center; justify-content:center;';
        modal.innerHTML = `
            <div style="background:#fff; border-radius:12px; width:600px; max-width:90%; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,0.2);">
                <h3 style="margin-top:0; border-bottom:1px solid #eee; padding-bottom:12px; margin-bottom:16px; color:#2e7d32;">${rt('report.modal.addMetricTitle')}</h3>
                <div style="max-height:60vh; overflow-y:auto; margin-bottom:16px; padding-right:10px;" id="add-metric-form"></div>
                <div style="text-align:right; border-top:1px solid #eee; padding-top:16px;">
                    <button onclick="closeAddMetricModal()" style="padding:8px 16px; border:1px solid #ccc; background:#fff; border-radius:6px; cursor:pointer; margin-right:10px;">${rt('report.button.cancel')}</button>
                    <button onclick="saveManualMetric()" style="padding:8px 16px; border:none; background:#2e7d32; color:#fff; border-radius:6px; cursor:pointer; font-weight:bold;">${rt('report.button.saveMetric')}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const formEl = document.getElementById('add-metric-form');
    const targetMonth = document.getElementById('target-month-select').value;

    let html = `
        <div style="margin-bottom:12px;">
            <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${rt('report.metric.name')} <span style="color:red;">*</span></label>
            <input type="text" id="manual-metric-name" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" placeholder="${rt('report.metric.namePlaceholder')}">
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:12px;">
            <div style="flex:1;">
                <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${rt('report.metric.weight')}</label>
                <input type="number" id="manual-metric-weight" value="1" step="0.1" min="0" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;">
            </div>
            <div style="flex:1;">
                <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${rt('report.metric.type')}</label>
                <select id="manual-metric-type" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;">
                    <option value="gte">${rt('report.metric.gte')}</option>
                    <option value="lte">${rt('report.metric.lte')}</option>
                </select>
            </div>
            <div style="flex:1;">
                <label style="display:flex; align-items:center; justify-content:space-between; font-size:12px; color:#666; margin-bottom:4px;">
                    <span>${rt('report.metric.target', { month: targetMonth })}</span>
                    <button type="button" onclick="toggleManualCategoryTargets()" title="${rt('report.metric.categoryTargetsTitle')}" style="border:0; background:transparent; cursor:pointer; padding:0 2px; font-size:15px; line-height:1;">⚙️</button>
                </label>
                <input type="number" id="manual-metric-target" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" placeholder="${rt('report.metric.targetPlaceholder')}">
            </div>
        </div>

        <div id="manual-category-targets" style="display:none; margin:-2px 0 12px; padding:10px; border:1px solid #bbdefb; background:#f5fbff; border-radius:6px;">
            <div style="font-size:12px; color:#1565c0; font-weight:bold; margin-bottom:4px;">${rt('report.metric.categoryTargetsTitle')}</div>
            <div style="font-size:11px; color:#607d8b; margin-bottom:8px;">${rt('report.metric.categoryTargetsHint')}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                ${categories.map(cat => `
                    <label style="font-size:11px; color:#455a64;">
                        <span style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHTML(cat)}">${escapeHTML(cat)}</span>
                        <input type="number" class="manual-category-target-input" data-cat="${escapeHTML(cat)}" step="any" style="width:100%; padding:6px; border:1px solid #b0bec5; border-radius:4px; box-sizing:border-box;" placeholder="${rt('report.metric.inheritTarget')}">
                    </label>
                `).join('')}
            </div>
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:12px; background:#f5f8fa; padding:10px; border-radius:4px; border:1px solid #e1e8ed;">
            <div style="flex:1;">
                <label style="display:flex; align-items:center; gap:4px; white-space:nowrap; font-size:12px; color:#0277bd; margin-bottom:4px; font-weight:bold;">
                    <span style="white-space:nowrap;">${rt('report.metric.exceed')}</span>
                    <button type="button" id="manual-overachievement-toggle" aria-pressed="false" onclick="toggleManualOverachievementScoring()" title="${rt('report.metric.overachievementTitle')}" style="flex:0 0 auto; border:1px solid #ffcc80; background:#fff; border-radius:5px; cursor:pointer; padding:0 4px; font-size:14px; line-height:18px; opacity:.45;">🎁</button>
                    <input type="checkbox" id="manual-overachievement-scoring" hidden>
                </label>
                <input type="number" id="manual-metric-exceed-by" step="0.1" min="0" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" placeholder="1">
            </div>
            <div style="flex:1;">
                <label style="display:block; font-size:12px; color:#0277bd; margin-bottom:4px; font-weight:bold;">${rt('report.metric.bonus')}</label>
                <input type="number" id="manual-metric-bonus" step="0.1" min="0" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" placeholder="0.1">
            </div>
            <div style="flex:1.5; display:flex; align-items:center;">
                <span id="manual-bonus-hint" style="font-size:11px; color:#666; line-height:1.4;">${rt('report.metric.bonusHint')}</span>
            </div>
        </div>
        
        <div style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px dashed #eee;">
            <label style="display:block; font-size:12px; color:#666; margin-bottom:4px;">${rt('report.metric.globalValue')}</label>
            <input type="text" id="manual-metric-global" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" placeholder="${rt('report.metric.globalPlaceholder')}">
        </div>
        
        <label style="display:block; font-size:12px; color:#666; margin-bottom:8px;">${rt('report.metric.catValues')}</label>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
    `;

    categories.forEach(cat => {
        html += `
            <div>
                <span style="font-size:12px; font-weight:bold; color:#2c3e50; display:inline-block; margin-bottom:2px;">${escapeHTML(cat)}</span>
                <input type="text" class="manual-cat-input" data-cat="${cat}" style="width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing:border-box;" placeholder="${rt('report.metric.catPlaceholder')}">
            </div>
        `;
    });

    html += `</div>`;

    formEl.innerHTML = html;

    modal.querySelector('h3').innerHTML = rt('report.modal.addMetricTitle');

    if (document.fullscreenElement) {
        document.fullscreenElement.appendChild(modal);
    } else if (document.webkitFullscreenElement) {
        document.webkitFullscreenElement.appendChild(modal);
    } else {
        document.body.appendChild(modal);
    }

    modal.style.display = 'flex';
};

window.editManualMetric = function (label) {
    if (!currentSnapshot) return;
    editingManualMetricLabel = label;

    // Open modal to generate DOM
    openAddMetricModal();
    editingManualMetricLabel = label;

    const modal = document.getElementById('add-metric-modal');
    modal.querySelector('h3').innerHTML = rt('report.metric.editTitle');

    const nameInput = document.getElementById('manual-metric-name');
    nameInput.value = label;
    nameInput.removeAttribute('readonly');
    nameInput.style.backgroundColor = '#fff';

    // Fill target data
    const targetData = labelToTargetMap[label];
    if (targetData) {
        if (targetData.weight !== undefined) document.getElementById('manual-metric-weight').value = targetData.weight;
        if (targetData.type) document.getElementById('manual-metric-type').value = targetData.type;
        const targetMonth = document.getElementById('target-month-select').value;
        if (targetData[targetMonth] !== undefined) document.getElementById('manual-metric-target').value = targetData[targetMonth];
        if (targetData.exceedBy !== undefined) document.getElementById('manual-metric-exceed-by').value = targetData.exceedBy;
        if (targetData.bonus !== undefined) document.getElementById('manual-metric-bonus').value = targetData.bonus;
        document.getElementById('manual-overachievement-scoring').checked = !!targetData.overachievementScoring;
        updateManualOverachievementScoringUI();
        const monthTargets = targetData.categoryTargets && targetData.categoryTargets[String(targetMonth)];
        if (monthTargets && typeof monthTargets === 'object') {
            let hasConfiguredTarget = false;
            document.querySelectorAll('.manual-category-target-input').forEach(input => {
                const value = monthTargets[input.dataset.cat];
                if (value !== undefined && value !== null && value !== '') {
                    input.value = value;
                    hasConfiguredTarget = true;
                }
            });
            if (hasConfiguredTarget) document.getElementById('manual-category-targets').style.display = 'block';
        }
    }

    // Fill snapshot values if exist
    const existingMetric = (currentSnapshot.topMetrics || []).find(m => m.label === label);
    if (existingMetric) {
        if (existingMetric.value && existingMetric.value !== '--') {
            document.getElementById('manual-metric-global').value = existingMetric.value;
        }
        const subs = existingMetric.subMetrics || [];
        subs.forEach(sm => {
            const input = document.querySelector(`.manual-cat-input[data-cat="${sm.category}"]`);
            if (input && sm.value !== '--') {
                input.value = sm.value;
            }
        });
    }
};

window.toggleManualCategoryTargets = function () {
    const panel = document.getElementById('manual-category-targets');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
};

function updateManualOverachievementScoringUI() {
    const checkbox = document.getElementById('manual-overachievement-scoring');
    const button = document.getElementById('manual-overachievement-toggle');
    const exceedInput = document.getElementById('manual-metric-exceed-by');
    const bonusInput = document.getElementById('manual-metric-bonus');
    const hint = document.getElementById('manual-bonus-hint');
    if (!checkbox || !button) return;
    const enabled = checkbox.checked;
    button.setAttribute('aria-pressed', String(enabled));
    button.style.opacity = enabled ? '1' : '.45';
    button.style.background = enabled ? '#fff3e0' : '#fff';
    if (exceedInput) exceedInput.disabled = enabled;
    if (bonusInput) bonusInput.disabled = enabled;
    if (hint) hint.textContent = enabled ? rt('report.metric.overachievementHint') : rt('report.metric.bonusHint');
}

window.toggleManualOverachievementScoring = function () {
    const checkbox = document.getElementById('manual-overachievement-scoring');
    if (!checkbox) return;
    checkbox.checked = !checkbox.checked;
    updateManualOverachievementScoringUI();
};

window.closeAddMetricModal = function () {
    const modal = document.getElementById('add-metric-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.appendChild(modal);
    }
    editingManualMetricLabel = null;
};

window.saveManualMetric = async function () {
    const name = document.getElementById('manual-metric-name').value.trim();
    if (!name) return showToast(rt('report.toast.enterMetricName'), 'error');
    const originalLabel = editingManualMetricLabel;
    const isEditing = !!originalLabel;

    if (isEditing && name !== originalLabel) {
        const duplicateInSnapshot = (currentSnapshot.topMetrics || []).some(m => m.label === name && m.label !== originalLabel);
        const duplicateInTargets = !!labelToTargetKeyMap[name] && labelToTargetKeyMap[name] !== labelToTargetKeyMap[originalLabel];
        if (duplicateInSnapshot || duplicateInTargets) {
            return showToast(rt('report.toast.metricNameExists'), 'error');
        }
    } else if (!isEditing) {
        const duplicateInSnapshot = (currentSnapshot.topMetrics || []).some(m => m.label === name);
        const duplicateInTargets = !!labelToTargetKeyMap[name];
        if (duplicateInSnapshot || duplicateInTargets) {
            return showToast(rt('report.toast.metricNameExists'), 'error');
        }
    }

    const weight = parseFloat(document.getElementById('manual-metric-weight').value);
    const validWeight = isNaN(weight) ? 1 : weight;
    const type = document.getElementById('manual-metric-type').value;
    const targetVal = document.getElementById('manual-metric-target').value.trim();
    const globalVal = document.getElementById('manual-metric-global').value.trim() || '--';
    const targetMonth = document.getElementById('target-month-select').value;

    const subMetrics = [];
    document.querySelectorAll('.manual-cat-input').forEach(input => {
        const cat = input.getAttribute('data-cat');
        const val = input.value.trim() || '--';
        if (val !== '--') {
            subMetrics.push({ category: cat, value: val });
        }
    });

    const metricId = `manual_m_${Date.now()}`;
    const newMetric = {
        id: metricId,
        colX: "手动指标",
        valY: "总计",
        colZ: "手动指标",
        label: name,
        color: "",
        value: globalVal,
        subMetrics: subMetrics
    };

    let targetKey = isEditing ? labelToTargetKeyMap[originalLabel] : labelToTargetKeyMap[name];
    if (!targetKey) {
        targetKey = `manual_target_${Date.now()}`;
    }

    let updatedTargets = { ...globalConfig.targets };
    if (!updatedTargets[targetKey]) {
        updatedTargets[targetKey] = {};
    }
    updatedTargets[targetKey].type = type;
    updatedTargets[targetKey].weight = validWeight;
    updatedTargets[targetKey].label = name;

    const exceedBy = parseFloat(document.getElementById('manual-metric-exceed-by').value);
    const bonus = parseFloat(document.getElementById('manual-metric-bonus').value);
    updatedTargets[targetKey].exceedBy = isNaN(exceedBy) ? '' : exceedBy;
    updatedTargets[targetKey].bonus = isNaN(bonus) ? '' : bonus;
    updatedTargets[targetKey].overachievementScoring = !!document.getElementById('manual-overachievement-scoring').checked;

    if (targetVal) {
        updatedTargets[targetKey][targetMonth] = targetVal;
    }

    const categoryTargets = {};
    document.querySelectorAll('.manual-category-target-input').forEach(input => {
        const value = input.value.trim();
        if (value !== '') categoryTargets[input.dataset.cat] = value;
    });
    const existingCategoryTargets = updatedTargets[targetKey].categoryTargets &&
        typeof updatedTargets[targetKey].categoryTargets === 'object'
        ? { ...updatedTargets[targetKey].categoryTargets }
        : {};
    if (Object.keys(categoryTargets).length) {
        existingCategoryTargets[String(targetMonth)] = categoryTargets;
    } else {
        delete existingCategoryTargets[String(targetMonth)];
    }
    if (Object.keys(existingCategoryTargets).length) {
        updatedTargets[targetKey].categoryTargets = existingCategoryTargets;
    } else {
        delete updatedTargets[targetKey].categoryTargets;
    }

    try {
        await API.put('/api/sla/targets', updatedTargets);
        globalConfig.targets = updatedTargets;

        if (!currentSnapshot.topMetrics) currentSnapshot.topMetrics = [];

        const existingIdx = currentSnapshot.topMetrics.findIndex(m => m.label === (isEditing ? originalLabel : name));
        if (existingIdx > -1) {
            newMetric.id = currentSnapshot.topMetrics[existingIdx].id; // preserve ID
            newMetric.isManual = true;
            currentSnapshot.topMetrics[existingIdx] = newMetric;
        } else {
            newMetric.isManual = true;
            currentSnapshot.topMetrics.push(newMetric);
        }

        const groupsChanged = isEditing && syncManualMetricGroupLabel(originalLabel, name);
        if (groupsChanged) {
            await API.put('/api/sla/groups', metricGroups);
        }

        await putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-metric-save');

        buildLabelTargetMap();
        showToast(rt('report.toast.manualMetricSaved'), 'success');
        editingManualMetricLabel = null;
        closeAddMetricModal();
        renderCurrentSnapshot();
    } catch (e) {
        showToast(rt('report.toast.saveFailed'), 'error');
        console.error(e);
    }
};

window.deleteManualMetric = async function (label) {
    if (!currentSnapshot || !label) return;
    if (!confirm(rt('report.confirm.deleteManualMetric', { name: label }))) {
        return;
    }

    const originalTargets = { ...(globalConfig.targets || {}) };
    const originalGroups = JSON.parse(JSON.stringify(metricGroups || []));
    const originalTopMetrics = JSON.parse(JSON.stringify(currentSnapshot.topMetrics || []));

    try {
        if (!globalConfig.targets) globalConfig.targets = {};
        const targetKey = labelToTargetKeyMap[label];
        if (targetKey && targetKey.startsWith('manual_')) {
            delete globalConfig.targets[targetKey];
            await API.put('/api/sla/targets', globalConfig.targets);
        }

        currentSnapshot.topMetrics = (currentSnapshot.topMetrics || []).filter(m => m.label !== label);

        const groupsChanged = removeManualMetricFromGroups(label);
        if (groupsChanged) {
            await API.put('/api/sla/groups', metricGroups);
        }

        await putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-metric-delete');

        buildLabelTargetMap();
        showToast(rt('report.toast.manualMetricDeleted'), 'success');
        renderCurrentSnapshot();
    } catch (e) {
        globalConfig.targets = originalTargets;
        metricGroups = originalGroups;
        currentSnapshot.topMetrics = originalTopMetrics;
        buildLabelTargetMap();
        showToast(rt('report.toast.deleteFailed'), 'error');
        console.error(e);
    }
};

window.toggleAutoFill = async function (label) {
    if (!globalConfig.targets) globalConfig.targets = {};
    let targetKey = labelToTargetKeyMap[label];
    if (!targetKey) {
        targetKey = `manual_target_${Date.now()}`;
        globalConfig.targets[targetKey] = { label: label };
    }

    globalConfig.targets[targetKey].autoFill = !globalConfig.targets[targetKey].autoFill;

    try {
        await patchSlaTarget(targetKey, globalConfig.targets[targetKey]);
        buildLabelTargetMap();
        showToast(globalConfig.targets[targetKey].autoFill ? rt('report.toast.autoFillOn') : rt('report.toast.autoFillOff'), 'success');
        renderReport(currentSnapshot);
    } catch (e) {
        console.error(e);
        showToast(rt('report.toast.settingFailed'), 'error');
    }
};

window.toggleManualAdjustAutoFill = async function (idx) {
    if (!globalConfig.prefs) globalConfig.prefs = {};
    const prefs = getManualAdjustAutoFillPrefs();
    const key = String(idx);
    prefs[key] = !prefs[key];

    try {
        await saveSlaPrefPatch({ manualAdjustAutoFill: prefs });

        if (manualAdjustItems[idx]) {
            manualAdjustItems[idx].autoFill = prefs[key];
            await saveManualAdjustItemsConfig();
        }

        let changed = false;
        if (prefs[key] && currentSnapshot) {
            changed = applyManualAdjustAutoFillToSnapshot(currentSnapshot);
            if (changed) {
                await putSnapshotWithCompression(currentSnapshot.id, currentSnapshot, 'manual-adjust-auto-fill-toggle');
            }
        }

        showToast(
            prefs[key]
                ? (changed ? rt('report.toast.adjustAutoFillOnWithData') : rt('report.toast.adjustAutoFillOn'))
                : rt('report.toast.adjustAutoFillOff'),
            'success'
        );
        renderCurrentSnapshot();
    } catch (e) {
        prefs[key] = !prefs[key];
        console.error(e);
        showToast(rt('report.toast.settingFailed'), 'error');
    }
};

window.toggleProportionalScoring = async function (label) {
    if (!globalConfig.targets) globalConfig.targets = {};
    let targetKey = labelToTargetKeyMap[label];
    if (!targetKey) {
        showToast(rt('report.toast.noTargetForProportional'), 'warn');
        return;
    }

    globalConfig.targets[targetKey].proportionalScoring = !globalConfig.targets[targetKey].proportionalScoring;

    try {
        await patchSlaTarget(targetKey, globalConfig.targets[targetKey]);
        buildLabelTargetMap();
        showToast(
            globalConfig.targets[targetKey].proportionalScoring
                ? rt('report.toast.proportionalOn')
                : rt('report.toast.proportionalOff'),
            'success'
        );
        renderReport(currentSnapshot);
    } catch (e) {
        console.error(e);
        showToast(rt('report.toast.proportionalFailed'), 'error');
    }
};

// ══════════════════════════════════════════════════════════
// GROUP CONFIG MODAL
// ══════════════════════════════════════════════════════════

// Working copy of groups while editing in modal
let _editGroups = [];
let _focusedGroupIdx = 0; // which group is currently focused in the modal

function getAllMetricLabels() {
    if (!currentSnapshot) return [];
    const labels = new Set();
    (currentSnapshot.topMetrics || []).forEach(m => labels.add(m.label));
    // Also add manual targets that aren't in current snapshot
    if (globalConfig.targets) {
        Object.keys(globalConfig.targets).forEach(k => {
            if (k.startsWith('manual_') && globalConfig.targets[k].label) {
                labels.add(globalConfig.targets[k].label);
            }
        });
    }
    return [...labels];
}

function renderGroupModal() {
    const container = document.getElementById('group-list-container');
    const poolEl = document.getElementById('unassigned-pool');

    const allLabels = getAllMetricLabels();
    const assignedLabels = new Set(_editGroups.flatMap(g => g.metrics || []));
    const unassigned = allLabels.filter(l => !assignedLabels.has(l));

    // Clamp focused index
    if (_focusedGroupIdx >= _editGroups.length) _focusedGroupIdx = Math.max(0, _editGroups.length - 1);

    const focusedName = _editGroups[_focusedGroupIdx] ? _editGroups[_focusedGroupIdx].name : '';

    // Render unassigned pool
    const poolTitle = _editGroups.length > 0
        ? `点击分配到「${focusedName || '聚焦分组'}」`
        : '请先新增分组';
    poolEl.innerHTML = unassigned.length
        ? unassigned.map(l => `<span class="unassigned-tag" onclick="assignToFocusedGroup('${escapeHTML(l)}')" title="${escapeHTML(poolTitle)}">${getBilingual(l)}</span>`).join('')
        : `<span style="color:#bbb; font-size:12px;">${getReportLang() === 'en-US' ? 'All metrics are grouped' : '全部指标已分组'}</span>`;

    // Render group list
    container.innerHTML = _editGroups.map((g, gi) => {
        const isFocused = gi === _focusedGroupIdx;
        const focusStyle = isFocused
            ? 'border:2px solid #3949ab; box-shadow:0 0 0 3px rgba(57,73,171,0.15);'
            : 'border:1px solid #e1e8ed;';
        return `
        <div class="group-item" data-gi="${gi}" style="${focusStyle} cursor:pointer;"
            onclick="setFocusedGroup(${gi})">
            <div class="group-item-header">
                <div style="display:flex; flex-direction:column; align-items:center; margin-right:8px; line-height:1;">
                    <span onclick="event.stopPropagation(); moveGroupUp(${gi})" style="cursor:${gi === 0 ? 'not-allowed' : 'pointer'}; color:${gi === 0 ? '#ddd' : '#777'}; font-size:14px; padding:0 4px; user-select:none;" title="${rt('report.sort.moveUp')}">▲</span>
                    <span onclick="event.stopPropagation(); moveGroupDown(${gi})" style="cursor:${gi === _editGroups.length - 1 ? 'not-allowed' : 'pointer'}; color:${gi === _editGroups.length - 1 ? '#ddd' : '#777'}; font-size:14px; padding:0 4px; user-select:none;" title="${rt('report.sort.moveDown')}">▼</span>
                </div>
                <input class="group-name-input" value="${escapeHTML(g.name)}" placeholder="${rt('report.modal.groupList')}"
                    onclick="event.stopPropagation()"
                    oninput="_editGroups[${gi}].name = this.value"
                    onblur="updatePoolHint()">
                <span class="focus-badge" style="font-size:11px; background:#3949ab; color:#fff; border-radius:10px; padding:1px 7px; margin-left:4px; display:${isFocused ? 'inline' : 'none'};">${getReportLang() === 'en-US' ? 'Focused' : '聚焦'}</span>
                <span onclick="event.stopPropagation(); removeGroup(${gi})" style="cursor:pointer; color:#e53935; font-size:18px; padding:0 4px;" title="${rt('report.group.delete')}">✕</span>
            </div>
            <div class="group-metrics-list">
                ${(g.metrics || []).map((label, mi) => `
                    <div class="group-metric-tag">
                        <span onclick="event.stopPropagation(); moveMetricUp(${gi}, ${mi})" style="cursor:${mi === 0 ? 'not-allowed' : 'pointer'}; color:${mi === 0 ? '#ddd' : '#777'}; font-size:12px; padding:0 4px; user-select:none;" title="${rt('report.sort.moveUp')}">▲</span>
                        <span onclick="event.stopPropagation(); moveMetricDown(${gi}, ${mi})" style="cursor:${mi === g.metrics.length - 1 ? 'not-allowed' : 'pointer'}; color:${mi === g.metrics.length - 1 ? '#ddd' : '#777'}; font-size:12px; padding:0 4px; user-select:none;" title="${rt('report.sort.moveDown')}">▼</span>
                        <span style="flex:1; margin-left:4px;">${getBilingual(label)}</span>
                        <span class="group-metric-remove" onclick="event.stopPropagation(); removeMetricFromGroup(${gi}, ${mi})">✕</span>
                    </div>`).join('')}
                ${g.metrics.length === 0 ? `<div style="color:#bbb; font-size:12px; text-align:center; padding:4px;">${getReportLang() === 'en-US' ? 'Click a metric tag on the right to assign it here' : '点击右侧指标标签分配到此分组'}</div>` : ''}
            </div>
        </div>
    `}).join('');
}

window.moveGroupUp = function (gi) {
    if (gi <= 0) return;
    const temp = _editGroups[gi - 1];
    _editGroups[gi - 1] = _editGroups[gi];
    _editGroups[gi] = temp;
    if (_focusedGroupIdx === gi) _focusedGroupIdx = gi - 1;
    else if (_focusedGroupIdx === gi - 1) _focusedGroupIdx = gi;
    renderGroupModal();
};

window.moveGroupDown = function (gi) {
    if (gi >= _editGroups.length - 1) return;
    const temp = _editGroups[gi + 1];
    _editGroups[gi + 1] = _editGroups[gi];
    _editGroups[gi] = temp;
    if (_focusedGroupIdx === gi) _focusedGroupIdx = gi + 1;
    else if (_focusedGroupIdx === gi + 1) _focusedGroupIdx = gi;
    renderGroupModal();
};

window.moveMetricUp = function (gi, mi) {
    if (mi <= 0) return;
    const metrics = _editGroups[gi].metrics;
    const temp = metrics[mi - 1];
    metrics[mi - 1] = metrics[mi];
    metrics[mi] = temp;
    renderGroupModal();
};

window.moveMetricDown = function (gi, mi) {
    const metrics = _editGroups[gi].metrics;
    if (mi >= metrics.length - 1) return;
    const temp = metrics[mi + 1];
    metrics[mi + 1] = metrics[mi];
    metrics[mi] = temp;
    renderGroupModal();
};

window.assignToFocusedGroup = function (label) {
    if (_editGroups.length === 0) {
        _editGroups.push({ id: `grp_${Date.now()}`, name: '默认分组', metrics: [] });
        _focusedGroupIdx = 0;
    }
    const targetIdx = (_focusedGroupIdx >= 0 && _focusedGroupIdx < _editGroups.length)
        ? _focusedGroupIdx : 0;
    _editGroups[targetIdx].metrics.push(label);
    renderGroupModal();
};

// Lightweight focus update - NO full re-render so input stays editable
window.setFocusedGroup = function (gi) {
    if (_focusedGroupIdx === gi) return; // already focused, skip
    _focusedGroupIdx = gi;
    // Update borders
    document.querySelectorAll('#group-list-container .group-item').forEach((el, idx) => {
        const focused = idx === gi;
        el.style.border = focused ? '2px solid #3949ab' : '1px solid #e1e8ed';
        el.style.boxShadow = focused ? '0 0 0 3px rgba(57,73,171,0.15)' : '';
        const badge = el.querySelector('.focus-badge');
        if (badge) badge.style.display = focused ? 'inline' : 'none';
    });
    updatePoolHint();
};

window.updatePoolHint = function () {
    const groupName = (_editGroups[_focusedGroupIdx] || {}).name || '聚焦分组';
    const title = _editGroups.length > 0 ? `点击分配到「${groupName}」` : '请先新增分组';
    document.querySelectorAll('#unassigned-pool .unassigned-tag').forEach(tag => {
        tag.title = title;
    });
};

window.removeGroup = function (gi) {
    _editGroups.splice(gi, 1);
    renderGroupModal();
};

window.removeMetricFromGroup = function (gi, mi) {
    _editGroups[gi].metrics.splice(mi, 1);
    renderGroupModal();
};

window.addNewGroup = function () {
    _editGroups.push({ id: `grp_${Date.now()}`, name: '新分组', metrics: [] });
    _focusedGroupIdx = _editGroups.length - 1;
    renderGroupModal();
    // Auto-focus and select the new group's name input
    setTimeout(() => {
        const items = document.querySelectorAll('#group-list-container .group-item');
        if (items.length > 0) {
            const lastInput = items[items.length - 1].querySelector('.group-name-input');
            if (lastInput) { lastInput.focus(); lastInput.select(); }
        }
    }, 30);
};

window.openGroupModal = function () {
    // Deep clone current groups for editing
    _editGroups = JSON.parse(JSON.stringify(metricGroups));
    _focusedGroupIdx = 0;
    renderGroupModal();
    document.getElementById('group-modal').style.display = 'flex';
};

window.closeGroupModal = function () {
    document.getElementById('group-modal').style.display = 'none';
};

window.saveGroups = async function () {
    try {
        // Collect current names from inputs
        const inputs = document.querySelectorAll('.group-name-input');
        inputs.forEach((inp, i) => { if (_editGroups[i]) _editGroups[i].name = inp.value.trim() || `分组${i + 1}`; });

        await API.put('/api/sla/groups', _editGroups);
        metricGroups = _editGroups;
        showToast(rt('report.toast.groupsSaved'), 'success');
        closeGroupModal();
        renderCurrentSnapshot();
    } catch (e) {
        showToast(rt('report.toast.groupsSaveFailed'), 'error');
        console.error(e);
    }
};
let _editI18nMap = {};
let _editingZh = null;

window.openI18nModal = function () {
    _editI18nMap = { ...i18nMap };
    _editingZh = null;
    renderI18nList();
    document.getElementById('i18n-new-zh').value = '';
    document.getElementById('i18n-new-en').value = '';
    document.getElementById('i18n-modal').style.display = 'flex';
};

window.closeI18nModal = function () {
    document.getElementById('i18n-modal').style.display = 'none';
};

window.renderI18nList = function () {
    const container = document.getElementById('i18n-list-container');
    const searchInput = document.getElementById('i18n-search');
    const searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    let html = '';
    let keys = Object.keys(_editI18nMap).sort();

    if (searchTerm) {
        keys = keys.filter(zh => {
            const en = _editI18nMap[zh] || '';
            return zh.toLowerCase().includes(searchTerm) || en.toLowerCase().includes(searchTerm);
        });
    }

    if (keys.length === 0) {
        html = `<tr><td colspan="3" style="text-align:center; padding:20px; color:#999; font-size:13px;">${rt('report.i18n.noMatches')}</td></tr>`;
    } else {
        keys.forEach(zh => {
            const en = _editI18nMap[zh];
            html += `
                <tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:8px; font-size:13px; color:#333; font-weight:600;">${escapeHTML(zh)}</td>
                <td style="padding:8px; font-size:13px; color:#0277bd;">${escapeHTML(en)}</td>
                <td style="padding:8px; text-align:center; white-space:nowrap;">
                    <button onclick="editI18nEntry('${escapeHTML(zh.replace(/'/g, "\\'"))}')" style="background:none; border:none; cursor:pointer; font-size:14px; opacity:0.6; padding:4px;" title="${rt('report.i18n.editTitle')}" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">✏️</button>
                    <button onclick="deleteI18nEntry('${escapeHTML(zh.replace(/'/g, "\\'"))}')" style="background:none; border:none; cursor:pointer; font-size:14px; opacity:0.6; padding:4px;" title="${rt('report.i18n.deleteTitle')}" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'">🗑️</button>
                </td>
            </tr>
        `;
        });
    }
    container.innerHTML = html;
};

window.editI18nEntry = function (zh) {
    _editingZh = zh;
    document.getElementById('i18n-new-zh').value = zh;
    document.getElementById('i18n-new-en').value = _editI18nMap[zh] || '';
    document.getElementById('i18n-new-en').focus();
};

window.addI18nEntry = async function () {
    const zh = document.getElementById('i18n-new-zh').value.trim();
    const en = document.getElementById('i18n-new-en').value.trim();
    if (!zh || !en) {
        showToast(rt('report.toast.fillI18n'), 'error');
        return;
    }

    const previousMap = { ..._editI18nMap };
    try {
        if (_editingZh) {
            if (_editingZh !== zh) {
                if (_editI18nMap[zh] !== undefined) {
                    showToast(rt('report.toast.i18nNameExists'), 'error');
                    return;
                }
                if (confirm(`您修改了指标的中文名称（从 [${_editingZh}] 改为 [${zh}]）。\n是否要全局同步重命名该指标？（这将自动更新历史快照、分组、考核配置中的名称）`)) {
                    try {
                        await API.post('/api/sla/rename-metric', { oldName: _editingZh, newName: zh, newEn: en });
                        showToast(rt('report.toast.renameSuccess'), 'success');
                        setTimeout(() => window.location.reload(), 1500);
                        return; // Prevent further logic to avoid race condition with manual save
                    } catch (e) {
                        showToast(rt('report.toast.renameFailed'), 'error');
                        console.error(e);
                        return;
                    }
                } else {
                    delete _editI18nMap[_editingZh];
                    _editI18nMap[zh] = en;
                }
            } else {
                _editI18nMap[zh] = en;
            }
        } else {
            if (_editI18nMap[zh] !== undefined) {
                if (!confirm(`指标 [${zh}] 已存在，是否覆盖其英文翻译？`)) {
                    return;
                }
            }
            _editI18nMap[zh] = en;
        }

        // “添加 / 修改”即刻持久化，避免用户关闭弹窗后丢失刚添加的翻译。
        await API.put('/api/sla/prefs/i18nMap', _editI18nMap);
        if (!globalConfig.prefs) globalConfig.prefs = {};
        globalConfig.prefs.i18nMap = { ..._editI18nMap };
        i18nMap = { ..._editI18nMap };

        _editingZh = null;
        document.getElementById('i18n-new-zh').value = '';
        document.getElementById('i18n-new-en').value = '';
        renderI18nList();
        showToast(rt('report.toast.i18nSaved'), 'success');
    } catch (e) {
        _editI18nMap = previousMap;
        showToast(rt('report.toast.saveFailed'), 'error');
        console.error(e);
    }
};

window.deleteI18nEntry = function (zh) {
    if (confirm(`确定要删除“${zh}”的翻译吗？`)) {
        delete _editI18nMap[zh];
        renderI18nList();
    }
};

window.saveI18nMap = async function () {
    try {
        if (!globalConfig.prefs) globalConfig.prefs = {};
        globalConfig.prefs.i18nMap = _editI18nMap;

        await API.put('/api/sla/prefs/i18nMap', _editI18nMap);

        i18nMap = { ..._editI18nMap };
        showToast(rt('report.toast.i18nSaved'), 'success');
        closeI18nModal();
        setTimeout(() => window.location.reload(), 500);
    } catch (e) {
        showToast(rt('report.toast.saveFailed'), 'error');
        console.error(e);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    const modeSelect = document.getElementById('reportSourceMode');
    if (modeSelect) {
        modeSelect.value = API.getSourceMode('report_sla_data');
        modeSelect.addEventListener('change', () => {
            API.setSourceMode('report_sla_data', modeSelect.value);
            initReport();
        });
    }
    if (window.renderReportSourcePanel) window.renderReportSourcePanel();
    const startup=window.ToolsPageStartup;
    try{if(startup)await startup.run('data',()=>initReport());else await initReport();await startup?.finish();}catch(error){startup?.fail(error);console.error(error);}
});

window.addEventListener('tools:languagechange', () => {
    if (window.ReportI18n && typeof window.ReportI18n.applyPage === 'function') {
        window.ReportI18n.applyPage();
    }
    renderReportMonthOptions(true);
    renderSnapshotOptions();
    renderSnapshotFilterSetting();
    if (currentSnapshot) {
        window._preserveMatrixFilters = true;
        renderReport(currentSnapshot);
        window._preserveMatrixFilters = false;
    } else if (!snapshots.length) {
        renderNoReportReadyState();
    }
    if (document.getElementById('weight-modal') && document.getElementById('weight-modal').style.display === 'flex') {
        openWeightModal();
    }
    if (document.getElementById('group-modal') && document.getElementById('group-modal').style.display === 'flex') {
        renderGroupModal();
    }
    if (document.getElementById('i18n-modal') && document.getElementById('i18n-modal').style.display === 'flex') {
        renderI18nList();
    }
    const mappingModal = document.getElementById('template-mapping-modal');
    if (mappingModal && mappingModal.style.display !== 'none' && window._currentTemplateData) {
        getTemplateMappingRowsFromDom();
        renderTemplateMappingRows();
    }
    if (document.getElementById('metric-count-trend-modal')?.classList.contains('open')) {
        openMetricCountTrendModal();
    }
    if (document.getElementById('expiring-warning-trend-modal')?.classList.contains('open')) {
        openExpiringWarningTrendModal();
    }
    const itemTrendModal = document.getElementById('metric-item-trend-modal');
    if (itemTrendModal?.classList.contains('open')) {
        openMetricItemTrendModal(itemTrendModal.dataset.trendLabel || '', itemTrendModal.dataset.trendKind || 'metric');
    }
    if (window.renderReportSourcePanel) window.renderReportSourcePanel();
});

async function promptExpiringTickets(tickets, specialMetricAlerts = []) {
    return new Promise(resolve => {
        const metricAlerts = Array.isArray(specialMetricAlerts) ? specialMetricAlerts : [];
        const collectionOrder = ['rectification', 'special', 'risk', 'sr', 'vulnerability'];
        const getTicketUrgencyDays = (ticket) => {
            const days = Number(ticket && ticket._slaDays);
            return Number.isFinite(days) ? days : 999999;
        };
        const getCollectionRank = (ticket) => {
            const idx = collectionOrder.indexOf(String(ticket && ticket.collection || ''));
            return idx === -1 ? 999 : idx;
        };
        const sortedTickets = (tickets || []).slice().sort((a, b) => {
            const collectionRankDiff = getCollectionRank(a) - getCollectionRank(b);
            if (collectionRankDiff !== 0) return collectionRankDiff;
            const collectionA = String(a && a.collection || '');
            const collectionB = String(b && b.collection || '');
            const collectionDiff = collectionA.localeCompare(collectionB, 'zh-CN');
            if (collectionDiff !== 0) return collectionDiff;
            const dayDiff = getTicketUrgencyDays(a) - getTicketUrgencyDays(b);
            if (dayDiff !== 0) return dayDiff;
            return String(a && a.title || '').localeCompare(String(b && b.title || ''), 'zh-CN');
        });
        const groupedTickets = [];
        sortedTickets.forEach((ticket, sortedIndex) => {
            const groupKey = `${ticket.collection || 'other'}@@${ticket.title || rt('report.alert.otherTicket')}`;
            let group = groupedTickets.find(item => item.key === groupKey);
            if (!group) {
                group = {
                    key: groupKey,
                    title: ticket.title || rt('report.alert.otherTicket'),
                    collection: ticket.collection || 'other',
                    items: []
                };
                groupedTickets.push(group);
            }
            group.items.push({ ticket, sortedIndex });
        });
        if (!sortedTickets.length && !metricAlerts.length) {
            resolve({ expiringTickets: [], specialMetricAlerts: [] });
            return;
        }
        const modalId = 'expiring-tickets-modal';
        let modal = document.getElementById(modalId);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = modalId;
            modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
            document.body.appendChild(modal);
        }

        let listHtml = groupedTickets.map((group, groupIndex) => {
            const groupKey = `ticket-${groupIndex}`;
            const rowsHtml = group.items.map(({ ticket: t, sortedIndex }) => {
                const data = t.data || {};
                const id = data.sr_num || data.sr_id || data.task_id || data.risk_id || data.ticket_id || data['单号'] || data['问题风险编号'] || data['问题编号'] || rt('report.alert.unknownId');
                const network = data.network_name || data['网络名称'] || data.network || rt('report.alert.unknownNetwork');
                const urgencyDays = getTicketUrgencyDays(t);
                const urgencyText = urgencyDays < 0 ? rt('report.alert.overdueDays', { days: Math.abs(urgencyDays) }) : rt('report.alert.remainingDays', { days: urgencyDays });
                return `<div class="exp-select-row" data-checkbox-type="ticket" data-checkbox-value="${sortedIndex}" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;-webkit-user-select:none;">
                    <input type="checkbox" class="exp-ticket-cb exp-select-cb" data-group-key="${groupKey}" value="${sortedIndex}" checked style="margin-right:10px;cursor:pointer;width:16px;height:16px;">
                    <div style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(t.title)} | ${rt('report.alert.ticketId')}: ${escapeHTML(id)} | ${rt('report.alert.network')}: ${escapeHTML(network)} | ${escapeHTML(t._slaCleanText)}">
                        <span style="color:#d32f2f;font-weight:700;">${escapeHTML(urgencyText)}</span> | ${rt('report.alert.ticketId')}: <span style="color:#1976d2">${escapeHTML(id)}</span> | ${rt('report.alert.network')}: ${escapeHTML(network)} | <span style="color:#d32f2f">${escapeHTML(t._slaCleanText)}</span>
                    </div>
                </div>`;
            }).join('');
            return `<div style="border-bottom:1px solid #e2e8f0;">
                <div style="position:sticky;top:0;z-index:1;background:#fff7ed;padding:8px 10px;border-bottom:1px solid #fed7aa;display:flex;justify-content:space-between;align-items:center;gap:10px;">
                    <b style="color:#c2410c;">${escapeHTML(group.title)}</b>
                    <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                        <label style="font-size:12px;color:#9a3412;font-weight:700;display:flex;align-items:center;gap:4px;cursor:pointer;">
                            <input type="checkbox" class="exp-group-select" data-group-key="${groupKey}" checked style="cursor:pointer;width:14px;height:14px;"> ${rt('report.alert.groupSelectAll')}
                        </label>
                        <span style="font-size:12px;color:#9a3412;background:#ffedd5;border:1px solid #fed7aa;border-radius:999px;padding:2px 8px;">${rt('report.alert.groupCount', { count: group.items.length })}</span>
                    </div>
                </div>
                ${rowsHtml}
            </div>`;
        }).join('');
        if (!listHtml) {
            listHtml = `<div style="padding:14px;color:#94a3b8;font-size:13px;text-align:center;">${rt('report.alert.noTickets')}</div>`;
        }

        const metricAlertHtml = metricAlerts.length ? metricAlerts.map((item, index) => {
            const metricName = item.metric_label || item.metricLabel || rt('report.alert.metricUnknown');
            const globalValue = item.global_val || item.globalValue || '--';
            const targetValue = item.target_val || item.targetValue || '--';
            const gap = item.gap || '-';
            const weight = item.weight !== undefined ? item.weight : '-';
            return `<div class="exp-select-row" data-checkbox-type="metric" data-checkbox-value="${index}" style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;-webkit-user-select:none;">
                <input type="checkbox" class="special-alert-cb exp-select-cb" data-group-key="special-alerts" value="${index}" checked style="margin-right:10px;cursor:pointer;width:16px;height:16px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;color:#b91c1c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(metricName)}">${getBilingual(metricName)}</div>
                    <div style="font-size:12px;color:#7f1d1d;margin-top:2px;">
                        ${rt('report.alert.metricMeta', { weight: escapeHTML(String(weight)), globalValue: escapeHTML(String(globalValue)), targetValue: escapeHTML(String(targetValue)), gap: escapeHTML(String(gap)) })}
                    </div>
                </div>
            </div>`;
        }).join('') : `<div style="padding:14px;color:#94a3b8;font-size:13px;text-align:center;">${rt('report.alert.noSpecial')}</div>`;

        const totalSelectable = sortedTickets.length + metricAlerts.length;

        modal.innerHTML = `
            <div style="background:#fff;border-radius:10px;width:min(1080px,96vw);max-height:84vh;display:flex;flex-direction:column;box-shadow:0 8px 28px rgba(0,0,0,0.18);">
                <div style="padding:16px;border-bottom:1px solid #eee;background:#fff3e0;border-radius:8px 8px 0 0;display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;color:#e65100;font-size:16px;">${rt('report.alert.title')}</h3>
                    <div style="display:flex;align-items:center;gap:14px;">
                        <label style="font-size:13px;cursor:pointer;color:#e65100;font-weight:bold;display:flex;align-items:center;"><input type="checkbox" id="exp-select-all" checked style="margin-right:4px;"> ${rt('report.alert.selectAll')}</label>
                        <button id="btn-close-exp" title="${rt('report.alert.closeTitle')}" style="border:none;background:transparent;color:#9a3412;font-size:22px;line-height:1;cursor:pointer;padding:0 2px;">×</button>
                    </div>
                </div>
                <div style="padding:16px;overflow-y:auto;flex:1;">
                    <p style="margin-top:0;font-size:14px;color:#333;">${rt('report.alert.summary', { metricCount: metricAlerts.length, ticketCount: sortedTickets.length })}</p>
                    <div style="margin-bottom:14px;border:1px solid #fecaca;border-radius:8px;overflow:hidden;background:#fffafa;">
                        <div style="background:#fee2e2;padding:8px 10px;border-bottom:1px solid #fecaca;display:flex;justify-content:space-between;align-items:center;">
                            <b style="color:#b91c1c;">${rt('report.alert.specialTitle')}</b>
                            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                                <label style="font-size:12px;color:#991b1b;font-weight:700;display:flex;align-items:center;gap:4px;cursor:pointer;">
                                    <input type="checkbox" class="exp-group-select" data-group-key="special-alerts" ${metricAlerts.length ? 'checked' : ''} ${metricAlerts.length ? '' : 'disabled'} style="cursor:pointer;width:14px;height:14px;"> ${rt('report.alert.groupSelectAll')}
                                </label>
                                <span style="font-size:12px;color:#991b1b;background:#fff;border:1px solid #fecaca;border-radius:999px;padding:2px 8px;">${rt('report.alert.count', { count: metricAlerts.length })}</span>
                            </div>
                        </div>
                        <div style="max-height:180px;overflow:auto;">${metricAlertHtml}</div>
                    </div>
                    <div style="background:#fcfcfc;border-radius:6px;border:1px solid #ddd;max-height:360px;overflow-y:auto;overflow-x:hidden;margin-bottom:16px;">
                        ${listHtml}
                    </div>
                    <p style="margin-bottom:0;font-size:14px;color:#d32f2f;font-weight:bold;">
                        ${rt('report.alert.confirmQuestion')}
                    </p>
                    <p style="margin-top:4px;font-size:12px;color:#666;">
                        ${rt('report.alert.confirmHint')}
                    </p>
                </div>
                <div style="padding:16px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:12px;background:#f8f9fa;border-radius:0 0 8px 8px;">
                    <button id="btn-ignore-exp" style="padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;color:#666;font-size:14px;">${rt('report.alert.ignoreAll')}</button>
                    <button id="btn-confirm-exp" style="padding:8px 16px;border:none;background:#e65100;color:#fff;border-radius:4px;cursor:pointer;font-weight:bold;font-size:14px;" data-label-template="${escapeHTML(rt('report.alert.confirmButton', { count: '__COUNT__' }))}">${rt('report.alert.confirmButton', { count: `<span id="exp-sel-count">${totalSelectable}</span>` })}</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        const selectAllCb = document.getElementById('exp-select-all');
        const countSpan = document.getElementById('exp-sel-count');
        let lastSelectIndex = null;

        const getAllCbs = () => Array.from(modal.querySelectorAll('.exp-select-cb'));
        const getGroupCbs = (groupKey) => getAllCbs().filter(cb => cb.dataset.groupKey === groupKey);
        const getGroupSelects = () => Array.from(modal.querySelectorAll('.exp-group-select'));

        const setRangeChecked = (fromIndex, toIndex, checked) => {
            const allCbs = getAllCbs();
            const start = Math.min(fromIndex, toIndex);
            const end = Math.max(fromIndex, toIndex);
            allCbs.slice(start, end + 1).forEach(cb => { cb.checked = checked; });
        };

        const updateCount = () => {
            const allCbs = getAllCbs();
            const checkedCount = allCbs.filter(cb => cb.checked).length;
            countSpan.innerText = checkedCount;
            selectAllCb.checked = allCbs.length > 0 && checkedCount === allCbs.length;
            selectAllCb.indeterminate = checkedCount > 0 && checkedCount < allCbs.length;

            getGroupSelects().forEach(groupCb => {
                const groupCbs = getGroupCbs(groupCb.dataset.groupKey);
                const groupCheckedCount = groupCbs.filter(cb => cb.checked).length;
                groupCb.checked = groupCbs.length > 0 && groupCheckedCount === groupCbs.length;
                groupCb.indeterminate = groupCheckedCount > 0 && groupCheckedCount < groupCbs.length;
            });
        };

        selectAllCb.onchange = (e) => {
            getAllCbs().forEach(cb => cb.checked = e.target.checked);
            updateCount();
        };

        getGroupSelects().forEach(groupCb => {
            groupCb.onchange = (e) => {
                getGroupCbs(groupCb.dataset.groupKey).forEach(cb => cb.checked = e.target.checked);
                updateCount();
            };
            groupCb.onclick = e => e.stopPropagation();
        });

        const handleItemToggle = (cb, event, forceToggleFromRow = false) => {
            const allCbs = getAllCbs();
            const currentIndex = allCbs.indexOf(cb);
            const nextChecked = forceToggleFromRow ? !cb.checked : cb.checked;

            if (forceToggleFromRow) cb.checked = nextChecked;
            if (event && event.shiftKey && lastSelectIndex !== null && currentIndex > -1) {
                setRangeChecked(lastSelectIndex, currentIndex, nextChecked);
            }
            if (currentIndex > -1) lastSelectIndex = currentIndex;
            updateCount();
        };

        getAllCbs().forEach(cb => {
            cb.onclick = e => {
                e.stopPropagation();
                handleItemToggle(cb, e, false);
            };
            cb.onchange = updateCount;
        });

        modal.querySelectorAll('.exp-select-row').forEach(row => {
            row.onclick = e => {
                const cb = row.querySelector('.exp-select-cb');
                if (!cb) return;
                handleItemToggle(cb, e, true);
            };
        });

        updateCount();

        document.getElementById('btn-close-exp').onclick = () => {
            modal.style.display = 'none';
            resolve({ cancelled: true, expiringTickets: [], specialMetricAlerts: [] });
        };

        document.getElementById('btn-ignore-exp').onclick = () => {
            modal.style.display = 'none';
            resolve({ expiringTickets: [], specialMetricAlerts: [] });
        };

        document.getElementById('btn-confirm-exp').onclick = () => {
            const selectedIndices = Array.from(document.querySelectorAll('.exp-ticket-cb:checked')).map(cb => parseInt(cb.value));
            const selectedTickets = selectedIndices.map(i => sortedTickets[i]);
            const selectedMetricIndices = Array.from(document.querySelectorAll('.special-alert-cb:checked')).map(cb => parseInt(cb.value));
            const selectedMetricAlerts = selectedMetricIndices.map(i => metricAlerts[i]).filter(Boolean);
            modal.style.display = 'none';
            resolve({ expiringTickets: selectedTickets, specialMetricAlerts: selectedMetricAlerts });
        };
    });
}

function roundYuxiangScore(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.sign(num) * Math.round((Math.abs(num) + Number.EPSILON) * 100) / 100;
}

window.buildYuxiangPayload = function () {
    const orderedMetrics = window._currentOrderedMetrics;
    if (!currentSnapshot || !orderedMetrics || !window._currentCatData) {
        return null;
    }

    const monthStr = document.getElementById('target-month-select').value || '';
    const targetMonth = parseInt(monthStr, 10);
    const payload = {
        targetMonth: targetMonth >= 1 && targetMonth <= 12 ? targetMonth : null,
        metrics: [],
        adjustments: [],
        totals: {
            subTotal: { TE: 0, ORG: 0, ET: 0, VDF: 0 },
            adjustTotal: { TE: 0, ORG: 0, ET: 0, VDF: 0 },
            weightInMonth: { TE: 0, ORG: 0, ET: 0, VDF: 0 },
            finalResult: { TE: 0, ORG: 0, ET: 0, VDF: 0 }
        }
    };

    const targetCats = ['TE', 'ORG', 'ET', 'VDF'];

    // Filter out Others group metrics
    const labelGroupLookup = window._currentLabelToGroup || {};
    const mainMetrics = orderedMetrics.filter(m => labelGroupLookup[m.label] !== 'Others');
    mainMetrics.forEach(m => {
        const labelEn = rt(m.label, true) || m.label;
        const targetData = labelToTargetMap[m.label];
        let target = targetData && targetData[targetMonth] !== undefined ? targetData[targetMonth] : '';
        if (target !== '' && targetData) {
            if (targetData.type === 'gte') target = '≥ ' + target;
            else if (targetData.type === 'lte') target = '≤ ' + target;
        }
        const metricData = { label: m.label, labelEn, target };

        targetCats.forEach(cat => {
            const cell = window._currentCatData[cat] && window._currentCatData[cat].values ? window._currentCatData[cat].values[m.label] : null;
            const weight = Number(m.weight) || 0;

            let achv = '';
            let score = 0;

            if (cell) {
                achv = cell.raw;
                score = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
            }

            metricData[cat] = { achv, score: roundYuxiangScore(score), isFailing: cell ? cell.isFailing : false };
        });
        payload.metrics.push(metricData);
    });

    // Add manual adjustments
    getOrderedManualAdjustEntries().forEach(({ item, idx }) => {
        const labelEn = rt(item.name, true) || item.name;
        const adjData = {
            label: item.name,
            labelEn,
            type: item.type,
            unit: item.unit,
            cap: item.cap,
            desc: formatManualAdjustDesc(item)
        };

        targetCats.forEach(cat => {
            let score = 0;
            if (currentSnapshot.manualAdjustData && currentSnapshot.manualAdjustData[cat]) {
                const count = currentSnapshot.manualAdjustData[cat][idx] || 0;
                if (count > 0) {
                    score = calculateManualAdjustScore(item, count);
                }
            }
            const roundedScore = roundYuxiangScore(score);
            adjData[cat] = { score: roundedScore, count: (currentSnapshot.manualAdjustData && currentSnapshot.manualAdjustData[cat]) ? (currentSnapshot.manualAdjustData[cat][idx] || 0) : 0 };
            payload.totals.adjustTotal[cat] = roundYuxiangScore(payload.totals.adjustTotal[cat] + roundedScore);
        });
        payload.adjustments.push(adjData);
    });

    // Merge 全量EOS & 日志回传 & 拓扑与预案
    const mergedMetrics = [];
    let eosProduct = null;
    let logBase = null;
    let topoBase = null;

    const parseFloatSafe = (val) => {
        if (typeof val === 'string' && val.endsWith('%')) return parseFloat(val);
        if (typeof val === 'string' || typeof val === 'number') {
            const n = parseFloat(val);
            return isNaN(n) ? 0 : n;
        }
        return 0;
    };

    const mergeTwoMetrics = (baseObj, newObj, newLabel) => {
        baseObj.label = newLabel;

        const t1str = baseObj.target !== undefined && baseObj.target !== '' ? String(baseObj.target).trim() : '--';
        const t2str = newObj.target !== undefined && newObj.target !== '' ? String(newObj.target).trim() : '--';
        baseObj.target = `${t1str} & ${t2str}`;

        targetCats.forEach(cat => {
            const a1str = baseObj[cat].achv !== undefined && baseObj[cat].achv !== '' ? String(baseObj[cat].achv).trim() : '--';
            const a2str = newObj[cat].achv !== undefined && newObj[cat].achv !== '' ? String(newObj[cat].achv).trim() : '--';

            if (baseObj[cat].achv === '' && newObj[cat].achv === '') {
                baseObj[cat].achv = '';
            } else {
                baseObj[cat].achv = `${a1str} & ${a2str}`;
            }

            const s1 = parseFloatSafe(baseObj[cat].score);
            const s2 = parseFloatSafe(newObj[cat].score);
            baseObj[cat].score = roundYuxiangScore(s1 + s2);

            baseObj[cat].isFailing = baseObj[cat].isFailing || newObj[cat].isFailing;
        });
    };

    payload.metrics.forEach(md => {
        if (md.label === '全量EOS-产品') {
            eosProduct = md;
            mergedMetrics.push(eosProduct);
        } else if (md.label === '全量EOS-版本') {
            if (eosProduct) {
                mergeTwoMetrics(eosProduct, md, '全量EOS (合并)');
            } else {
                mergedMetrics.push(md);
            }
        } else if (md.label === '日志回传') {
            logBase = md;
            mergedMetrics.push(logBase);
        } else if (md.label === '日志回传备案') {
            if (logBase) {
                mergeTwoMetrics(logBase, md, '日志回传 (合并)');
            } else {
                mergedMetrics.push(md);
            }
        } else if (md.label === '拓扑') {
            topoBase = md;
            mergedMetrics.push(topoBase);
        } else if (md.label === '预案') {
            if (topoBase) {
                mergeTwoMetrics(topoBase, md, '拓扑与预案 (合并)');
            } else {
                mergedMetrics.push(md);
            }
        } else {
            mergedMetrics.push(md);
        }
    });
    payload.metrics = mergedMetrics;

    // Totals
    targetCats.forEach(cat => {
        const d = window._currentCatData[cat];
        if (d) {
            payload.totals.subTotal[cat] = roundYuxiangScore(d.earnedScore);
            payload.totals.adjustTotal[cat] = roundYuxiangScore(payload.totals.adjustTotal[cat]);
            payload.totals.weightInMonth[cat] = roundYuxiangScore(d.validWeightSum);
            payload.totals.finalResult[cat] = roundYuxiangScore(d.finalScore);
        }
    });

    return payload;
};

window.exportYuxiangExcel = async function () {
    const payload = buildYuxiangPayload();
    if (!payload) {
        return showToast(rt('report.yuxiang.noData'), 'warn');
    }
    window._yuxiangPreviewData = payload;
    window._yuxiangOverrides = {};

    document.getElementById('yuxiang-preview-modal').style.display = 'flex';
    document.getElementById('yuxiang-preview-tbody').innerHTML = `<tr><td style="text-align:center; padding: 20px;">${escapeHTML(rt('report.yuxiang.loadingPreview'))}</td></tr>`;

    try {
        const token = localStorage.getItem('tools_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch('/api/sla/preview-yuxiang', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(await response.text());
        const snapshot = await response.json();
        window._yuxiangPreviewSnapshot = snapshot;
        renderYuxiangPreview();
    } catch (e) {
        console.error(e);
        document.getElementById('yuxiang-preview-tbody').innerHTML = `<tr><td style="text-align:center; color:red;">${escapeHTML(rt('report.yuxiang.previewFailed', { message: e.message }))}</td></tr>`;
    }
};

window.renderYuxiangPreview = function () {
    const tbody = document.getElementById('yuxiang-preview-tbody');
    const snapshot = window._yuxiangPreviewSnapshot;
    if (!snapshot) return;

    const skipRender = new Set();
    const cellSpans = {};

    if (snapshot.merges) {
        snapshot.merges.forEach(mergeStr => {
            const parts = mergeStr.split(':');
            if (parts.length === 2) {
                const parseAddress = (addr) => {
                    const match = addr.match(/([A-Z]+)(\d+)/);
                    if (!match) return null;
                    const cStr = match[1];
                    const r = parseInt(match[2], 10);
                    let c = 0;
                    for (let i = 0; i < cStr.length; i++) {
                        c = c * 26 + (cStr.charCodeAt(i) - 64);
                    }
                    return { r, c, addr };
                };
                const start = parseAddress(parts[0]);
                const end = parseAddress(parts[1]);
                if (start && end) {
                    const rowspan = end.r - start.r + 1;
                    const colspan = end.c - start.c + 1;
                    cellSpans[start.addr] = { rowspan, colspan };

                    for (let rr = start.r; rr <= end.r; rr++) {
                        for (let cc = start.c; cc <= end.c; cc++) {
                            if (rr === start.r && cc === start.c) continue;
                            let colStr = '';
                            let tempC = cc;
                            while (tempC > 0) {
                                let m = (tempC - 1) % 26;
                                colStr = String.fromCharCode(65 + m) + colStr;
                                tempC = Math.floor((tempC - m) / 26);
                            }
                            skipRender.add(colStr + rr);
                        }
                    }
                }
            }
        });
    }

    let html = '';
    snapshot.rows.forEach((row, rIdx) => {
        const r = rIdx + 1;
        html += '<tr>';
        row.forEach((cell, cIdx) => {
            const c = cIdx + 1;
            if (skipRender.has(cell.address)) {
                return;
            }

            let attrs = '';
            if (cellSpans[cell.address]) {
                const spans = cellSpans[cell.address];
                if (spans.rowspan > 1) attrs += ` rowspan="${spans.rowspan}"`;
                if (spans.colspan > 1) attrs += ` colspan="${spans.colspan}"`;
            }

            let style = 'border:1px dashed #e0e0e0; padding:2px 4px; position:relative; font-size:inherit; ';
            if (cell.bg && cell.bg !== '00000000' && cell.bg !== 'FFFFFFFF') {
                style += `background-color:#${cell.bg.slice(2)}; `;
            }
            if (cell.color && cell.color !== 'FF000000') {
                style += `color:#${cell.color.slice(2)}; `;
            }
            if (cell.bold) {
                style += 'font-weight:bold; ';
            }
            style += `text-align:${cell.align || 'left'}; `;

            let val = cell.val || '';
            const key = `${r}_${c}`;
            if (window._yuxiangOverrides[key] !== undefined) {
                val = window._yuxiangOverrides[key];
                style += 'background-color:#fff3e0; '; // highlight overridden cells
            }

            html += `<td ${attrs} style="${style}"><div contenteditable="true" style="outline:none; min-height:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" onblur="updateYuxiangPreviewData(${r}, ${c}, this.innerText, this)">${escapeHTML(val)}</div></td>`;
        });
        html += '</tr>';
    });

    tbody.innerHTML = html;
};

window.updateYuxiangPreviewData = function (r, c, value, el) {
    const key = `${r}_${c}`;
    let normalizedValue = value;
    if (c >= 15 && c <= 18 && String(value).trim() !== '' && Number.isFinite(Number(value))) {
        normalizedValue = roundYuxiangScore(value).toFixed(2);
        if (el) el.innerText = normalizedValue;
    }
    window._yuxiangOverrides[key] = normalizedValue;
    if (el && el.parentElement) {
        el.parentElement.style.backgroundColor = '#fff3e0';
    }
};

window.confirmYuxiangExport = async function () {
    const payload = window._yuxiangPreviewData;
    if (!payload) return;

    const btn = document.getElementById('btn-confirm-yuxiang-export');
    const oldHtml = btn.innerHTML;
    btn.innerHTML = rt('report.yuxiang.exporting');
    btn.disabled = true;

    try {
        const monthStr = document.getElementById('target-month-select').value || '';
        const token = localStorage.getItem('tools_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        payload.overrides = window._yuxiangOverrides || {};

        const response = await fetch('/api/sla/export-yuxiang', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`${rt('report.yuxiang.exportFailed')}: ${await response.text()}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        const filenameHelper = window.ReportExportFilenames;
        a.download = filenameHelper
            ? filenameHelper.buildHorseRacingExcelFilename(monthStr, currentSnapshot && currentSnapshot.timestamp)
            : 'Egypt SPM Horse Racing Monthly Report.xlsx';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        document.getElementById('yuxiang-preview-modal').style.display = 'none';
        showToast(rt('report.yuxiang.exportSuccess'), 'success');
    } catch (e) {
        console.error(e);
        showToast(rt('report.yuxiang.exportFailedWithMessage', { message: e.message }), 'error');
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
    }
};


function getTemplateMappingRowsFromDom() {
    if (!window._currentTemplateData) return [];
    const tbody = document.getElementById('mapping-tbody');
    const rows = Array.from(tbody.querySelectorAll('tr[data-template-idx]'));
    rows.forEach(tr => {
        const idx = parseInt(tr.getAttribute('data-template-idx'), 10);
        const row = window._currentTemplateData[idx];
        if (!row) return;
        const textInput = tr.querySelector('.mapping-text');
        const select = tr.querySelector('.mapping-select');
        row.text = textInput ? textInput.value : '';
        row.mapping = select ? select.value : '';
    });
    return window._currentTemplateData;
}

function getTemplateMappingOptionsHtml(selectedValue = '') {
    const options = window._templateMappingOptions || [];
    let html = `<option value="">${escapeHTML(rt('report.mapping.unmapped'))}</option>`;
    options.forEach(opt => {
        const selected = selectedValue === opt ? 'selected' : '';
        html += `<option value="${escapeHTML(opt)}" ${selected}>${escapeHTML(opt)}</option>`;
    });
    return html;
}

function renderTemplateMappingRows() {
    const tbody = document.getElementById('mapping-tbody');
    if (!tbody || !window._currentTemplateData) return;

    const data = window._currentTemplateData;
    data.forEach((row, idx) => {
        if (!row.sourceR) row.sourceR = row.r || null;
        row.r = 3 + idx;
    });

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#888;">${escapeHTML(rt('report.mapping.noRows'))}</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map((row, idx) => {
        const selectHtml = `<select class="mapping-select" data-idx="${idx}" style="width:100%; padding:4px;">${getTemplateMappingOptionsHtml(row.mapping || '')}</select>`;
        return `<tr data-template-idx="${idx}">
            <td>${row.r}</td>
            <td><input type="text" class="mapping-text" data-idx="${idx}" value="${escapeHTML(row.text || '')}" style="width:100%; padding:4px; box-sizing:border-box;"></td>
            <td>${selectHtml}</td>
            <td style="white-space:nowrap; text-align:center;">
                <button type="button" onclick="insertMappingRowAfter(${idx})" title="${escapeHTML(rt('report.mapping.insertBelow'))}" style="padding:2px 6px; margin:0 1px; border:1px solid #d1d5db; background:#fff; border-radius:3px; cursor:pointer;">＋</button>
                <button type="button" onclick="moveMappingRow(${idx}, -1)" ${idx === 0 ? 'disabled' : ''} title="${escapeHTML(rt('report.mapping.moveUp'))}" style="padding:2px 6px; margin:0 1px; border:1px solid #d1d5db; background:#fff; border-radius:3px; cursor:pointer; ${idx === 0 ? 'opacity:.35; cursor:not-allowed;' : ''}">↑</button>
                <button type="button" onclick="moveMappingRow(${idx}, 1)" ${idx === data.length - 1 ? 'disabled' : ''} title="${escapeHTML(rt('report.mapping.moveDown'))}" style="padding:2px 6px; margin:0 1px; border:1px solid #d1d5db; background:#fff; border-radius:3px; cursor:pointer; ${idx === data.length - 1 ? 'opacity:.35; cursor:not-allowed;' : ''}">↓</button>
                <button type="button" onclick="deleteMappingRow(${idx})" title="${escapeHTML(rt('report.mapping.deleteRow'))}" style="padding:2px 6px; margin:0 1px; border:1px solid #f1c7c7; background:#fffafa; color:#b91c1c; border-radius:3px; cursor:pointer;">×</button>
            </td>
        </tr>`;
    }).join('');
}

function createBlankTemplateMappingRow(insertIndex) {
    const previous = window._currentTemplateData && window._currentTemplateData[insertIndex - 1];
    const next = window._currentTemplateData && window._currentTemplateData[insertIndex];
    return {
        r: 3 + insertIndex,
        sourceR: null,
        templateSourceR: previous ? previous.sourceR || previous.r : (next ? next.sourceR || next.r : null),
        text: '',
        mapping: '',
        isNew: true
    };
}

window.insertMappingRowAfter = function (idx) {
    if (!window._currentTemplateData) return;
    getTemplateMappingRowsFromDom();
    const insertIndex = Math.max(0, Math.min(idx + 1, window._currentTemplateData.length));
    window._currentTemplateData.splice(insertIndex, 0, createBlankTemplateMappingRow(insertIndex));
    renderTemplateMappingRows();
};

window.moveMappingRow = function (idx, delta) {
    if (!window._currentTemplateData) return;
    getTemplateMappingRowsFromDom();
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= window._currentTemplateData.length) return;
    const rows = window._currentTemplateData;
    const [row] = rows.splice(idx, 1);
    rows.splice(nextIdx, 0, row);
    renderTemplateMappingRows();
};

window.deleteMappingRow = function (idx) {
    if (!window._currentTemplateData) return;
    getTemplateMappingRowsFromDom();
    if (idx < 0 || idx >= window._currentTemplateData.length) return;
    window._currentTemplateData.splice(idx, 1);
    renderTemplateMappingRows();
};

window.addNewMappingRow = function () {
    if (!window._currentTemplateData) {
        window._currentTemplateData = [];
    } else {
        getTemplateMappingRowsFromDom();
    }
    window._currentTemplateData.push(createBlankTemplateMappingRow(window._currentTemplateData.length));
    renderTemplateMappingRows();
};

window.saveDashboardToDB = async function (event) {
    if (!currentSnapshot) {
        return showToast(rt('report.toast.noSnapshot'), 'error');
    }
    if (!isReportEligibleSnapshot(currentSnapshot)) {
        return showToast(rt('report.toast.snapshotNotEligible'), 'warn');
    }

    const snapshot_id = currentSnapshot.id;
    const month = parseInt(document.getElementById('target-month-select').value);
    setReportTargetMonth(month);
    const rawDataForSave = JSON.parse(JSON.stringify(currentSnapshot));
    const specialMetricAlerts = collectGlobalOnlyFailingMetricAlerts(month);

    if ((rawDataForSave.expiringTickets && rawDataForSave.expiringTickets.length > 0) || specialMetricAlerts.length > 0) {
        const selectedAlerts = await promptExpiringTickets(rawDataForSave.expiringTickets || [], specialMetricAlerts);
        if (selectedAlerts && selectedAlerts.cancelled) {
            showToast(rt('report.toast.saveCancelled'), 'info');
            return;
        }
        rawDataForSave.expiringTickets = selectedAlerts.expiringTickets || [];
        rawDataForSave.specialMetricAlerts = selectedAlerts.specialMetricAlerts || [];
    } else {
        rawDataForSave.specialMetricAlerts = [];
    }
    rawDataForSave.selectedTargetMonth = month;
    rawDataForSave.selectedTargetMonthLabel = `${month}月`;
    rawDataForSave.manualAdjustItems = typeof manualAdjustItems !== 'undefined' ? manualAdjustItems : [];

    // Build cat scores
    const cat_scores = [];
    const catData = window._currentCatData || {};
    Object.keys(catData).forEach(catName => {
        const c = catData[catName];
        cat_scores.push({
            cat_name: c.name,
            base_score: c.baseScore,
            manual_score: c.manualScore,
            final_score: c.finalScore
        });
    });

    // Build metric data
    const metric_data = [];
    const orderedMetrics = window._currentOrderedMetrics || [];

    orderedMetrics.forEach(m => {
        const targetData = labelToTargetMap[m.label] || {};
        const weight = targetData.weight !== undefined ? parseFloat(targetData.weight) : 1;

        let targetStr = '--';
        if (getEffectiveTargetValue(targetData, month) !== undefined) {
            const condition = targetData.type || 'gte';
            targetStr = (condition === 'gte' ? '≥ ' : '≤ ') + getEffectiveTargetValue(targetData, month);

            // Check if any cat has % in this metric to append % to target
            let isPercent = false;
            Object.keys(catData).forEach(catName => {
                const cell = catData[catName].values[m.label];
                if (cell && String(cell.raw).includes('%')) isPercent = true;
            });
            if (isPercent) targetStr += '%';
        }

        let hasAnyCustomerData = false;
        Object.keys(catData).forEach(catName => {
            const cell = catData[catName].values[m.label];
            if (cell) {
                hasAnyCustomerData = true;
                const cellTarget = getEffectiveTargetValue(targetData, month, catName);
                let cellTargetStr = '--';
                if (cellTarget !== undefined) {
                    const condition = targetData.type || 'gte';
                    cellTargetStr = (condition === 'gte' ? '≥ ' : '≤ ') + cellTarget;
                    if (String(cell.raw).includes('%')) cellTargetStr += '%';
                }
                metric_data.push({
                    cat_name: catName,
                    metric_label: m.label,
                    weight: weight,
                    target_val: cellTargetStr,
                    raw_val: String(cell.raw),
                    num_val: cell.num,
                    is_failing: cell.isFailing,
                    gap: cell.gapStr || '',
                    earned_score: cell.earnedScore,
                    proportional_scoring: !!cell.proportionalScoring,
                    completion_ratio: cell.completionRatio
                });
            }
        });

        // If a metric has no customer data but has a global value, save it as '整体'
        if (!hasAnyCustomerData && hasFilledValue(m.value)) {
            const globalValNum = parseNum(m.value);
            const targetNum = parseFloat(targetData[month]);
            let isFailing = m.isWarn || m.isFailing || false;
            let gapStr = m.gap || '';

            if (Number.isFinite(globalValNum) && Number.isFinite(targetNum)) {
                const condition = targetData.type || 'gte';
                if (condition === 'gte' && globalValNum < targetNum) {
                    isFailing = true;
                    gapStr = (targetNum - globalValNum).toFixed(1);
                } else if (condition === 'lte' && globalValNum > targetNum) {
                    isFailing = true;
                    gapStr = (globalValNum - targetNum).toFixed(1);
                }
            }

            metric_data.push({
                cat_name: '整体',
                metric_label: m.label,
                weight: weight,
                target_val: targetStr,
                raw_val: String(m.value),
                num_val: globalValNum,
                is_failing: isFailing,
                gap: gapStr,
                earned_score: null,
                proportional_scoring: false,
                completion_ratio: null
            });
        }
    });

    const payload = {
        snapshot_id: snapshot_id,
        month: month,
        created_at: currentSnapshot.timestamp,
        standard_total_score: standardTotalScore,
        cat_scores: cat_scores,
        metric_data: metric_data,
        raw_data: rawDataForSave
    };

    try {
        const btn = event ? event.target : null;
        if (btn) btn.innerHTML = rt('report.common.prepareData');

        payload.image_data = null;

        // Generate Excel File
        if (typeof ExcelJS !== 'undefined') {
            try {
                if (btn) btn.innerHTML = rt('report.common.generateReport');
                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('短板透视矩阵');

                const stripHtml = (html) => {
                    const tmp = document.createElement('div');
                    tmp.innerHTML = html;
                    return tmp.textContent || tmp.innerText || "";
                };

                // Define columns
                const columns = [
                    { header: '分组 (Group)', key: 'group', width: 18 },
                    { header: '总权重', key: 'groupWeight', width: 12 },
                    { header: '考核的指标名称 (Metric)', key: 'metric', width: 50 },
                    { header: '权重', key: 'weight', width: 10 },
                    { header: '目标值 (Target)', key: 'target', width: 18 },
                    { header: '全局总体达标', key: 'global', width: 18 }
                ];

                const catData = window._currentCatData || {};
                const categories = Object.keys(catData);
                categories.forEach(cat => {
                    columns.push({ header: cat, key: `val_${cat}`, width: 22 });
                    columns.push({ header: `${cat}得分`, key: `score_${cat}`, width: 18 });
                });

                sheet.columns = columns;

                // Set default font for all columns
                sheet.columns.forEach(column => {
                    column.font = { name: 'Microsoft YaHei', size: 11 };
                    column.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                });
                // Metric name left-aligned
                sheet.getColumn('metric').alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };

                // Style header
                const headerRow = sheet.getRow(1);
                headerRow.font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
                headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
                headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
                headerRow.height = 30; // Slightly taller header


                // Add data
                const orderedMetrics = window._currentOrderedMetrics || [];
                const groupWeightMap = window._currentGroupWeightMap || {};
                const labelToGroup = window._currentLabelToGroup || {};

                let curGroup = null;
                let curGroupStartRow = -1;
                let currentRowIdx = 2; // Header is row 1
                const merges = [];

                orderedMetrics.forEach(m => {
                    const gName = labelToGroup[m.label];
                    if (!gName) return; // Skip ungrouped as requested by user

                    if (gName !== curGroup) {
                        if (curGroup && (currentRowIdx - curGroupStartRow) > 1) {
                            merges.push({ s: curGroupStartRow, e: currentRowIdx - 1 });
                        }
                        curGroup = gName;
                        curGroupStartRow = currentRowIdx;
                    }

                    const rowData = {};
                    rowData.group = stripHtml(getBilingual(gName));
                    rowData.groupWeight = groupWeightMap[gName] || '-';
                    rowData.metric = stripHtml(getBilingual(m.label));

                    const targetData = labelToTargetMap[m.label] || {};
                    const weight = targetData.weight !== undefined ? parseFloat(targetData.weight) : 1;
                    rowData.weight = weight;

                    let targetStr = '--';
                    if (targetData[month] !== undefined && targetData[month] !== '') {
                        const condition = targetData.type || 'gte';
                        targetStr = (condition === 'gte' ? '≥ ' : '≤ ') + targetData[month];
                        let isPercent = false;
                        categories.forEach(cat => {
                            if (catData[cat].values[m.label] && String(catData[cat].values[m.label].raw).includes('%')) isPercent = true;
                        });
                        if (isPercent) targetStr += '%';
                    }
                    rowData.target = targetStr;
                    rowData.global = m.value || '--';

                    categories.forEach(cat => {
                        const cell = catData[cat].values[m.label] || {};
                        rowData[`val_${cat}`] = cell.raw || '--';
                        if (!cell || cell.raw === undefined || cell.raw === '--') {
                            rowData[`score_${cat}`] = '--';
                        } else if (!m.hasTarget) {
                            rowData[`score_${cat}`] = '--';
                        } else {
                            const earned = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
                            rowData[`score_${cat}`] = Number.isInteger(earned) ? earned : +earned.toFixed(2);
                        }
                    });

                    const row = sheet.addRow(rowData);
                    row.height = 25; // Professional row height

                    // Highlight global failing cell
                    if (m.isWarn) {
                        const globalColObj = sheet.getColumn('global');
                        const globalCell = row.getCell(globalColObj.number);
                        globalCell.font = { name: 'Microsoft YaHei', size: 11, color: { argb: 'FFD32F2F' }, bold: true };
                        globalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
                    }

                    // Highlight failing cells
                    categories.forEach(cat => {
                        const cell = catData[cat].values[m.label] || {};
                        if (cell.isFailing) {
                            const valColObj = sheet.getColumn(`val_${cat}`);
                            const valCell = row.getCell(valColObj.number);
                            valCell.font = { name: 'Microsoft YaHei', size: 11, color: { argb: 'FFD32F2F' }, bold: true };
                            valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBEE' } };
                        }
                    });

                    currentRowIdx++;
                });

                // Final group merge check
                if (curGroup && (currentRowIdx - curGroupStartRow) > 1) {
                    merges.push({ s: curGroupStartRow, e: currentRowIdx - 1 });
                }

                // Apply merges and borders
                merges.forEach(m => {
                    sheet.mergeCells(`A${m.s}:A${m.e}`);
                    sheet.mergeCells(`B${m.s}:B${m.e}`);
                });

                // Apply borders to all used cells
                sheet.eachRow((row, rowNumber) => {
                    row.eachCell((cell) => {
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                            left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                            right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                        };
                    });
                });

                // Add total score row
                const totalRowData = { metric: '🏁 总分 (Total Score)' };
                categories.forEach(cat => {
                    totalRowData[`score_${cat}`] = catData[cat].finalScore;
                });
                const totalRow = sheet.addRow(totalRowData);
                totalRow.height = 30;
                totalRow.font = { name: 'Microsoft YaHei', size: 12, bold: true, color: { argb: 'FF333333' } };
                totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF59D' } };
                // Also add borders to total row
                totalRow.eachCell((cell) => {
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFBDBDBD' } },
                        left: { style: 'thin', color: { argb: 'FFBDBDBD' } },
                        bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
                        right: { style: 'thin', color: { argb: 'FFBDBDBD' } }
                    };
                });

                const buffer = await workbook.xlsx.writeBuffer();
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                payload.excel_data = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + window.btoa(binary);
            } catch (err) {
                console.error("Excel generation error:", err);
            }
        }

        if (btn) btn.innerHTML = rt('report.common.saveToDbBusy');
        const res = await postReportSaveWithCompression(payload);
        if (btn) btn.innerHTML = rt('report.action.saveDb');

        if (res.success) {
            showToast(rt('report.toast.savedDb'), 'success');
        } else {
            showToast(res.error || rt('report.toast.saveDbFailed'), 'error');
        }
    } catch (e) {
        showToast(`${rt('report.toast.saveDbRequestFailed')}: ${e.message}`, 'error');
        console.error(e);
    }
};


window.openTemplateMappingModal = async function () {
    const modal = document.getElementById('template-mapping-modal');
    modal.style.display = 'block';
    const tbody = document.getElementById('mapping-tbody');
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">${escapeHTML(rt('report.mapping.loading'))}</td></tr>`;

    try {
        const token = localStorage.getItem('tools_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/sla/template-mapping', { headers });
        const data = await res.json();


        // If window._currentOrderedMetrics is missing, try to reconstruct it from metricCols and ungrouped
        let metricsList = window._currentOrderedMetrics || [];
        if (metricsList.length === 0 && typeof metricCols !== 'undefined') {
            metricsList = [...metricCols];
        }

        // Ensure merged labels are in the options list so auto-fill can select them!
        const metrics = metricsList.map(m => m.label);
        if (!metrics.includes('全量EOS (合并)')) metrics.push('全量EOS (合并)');
        if (!metrics.includes('日志回传 (合并)')) metrics.push('日志回传 (合并)');
        if (!metrics.includes('拓扑与预案 (合并)')) metrics.push('拓扑与预案 (合并)');

        // manualAdjustItems is a global array in report.js
        const adjs = typeof getOrderedManualAdjustEntries === 'function'
            ? getOrderedManualAdjustEntries().map(entry => entry.item.name)
            : (typeof manualAdjustItems !== 'undefined' ? manualAdjustItems : []).filter(a => !a.deleted).map(a => a.name);

        const sys = ['SYS_SubTotal', 'SYS_AdjustTotal', 'SYS_WeightInMonth', 'SYS_FinalResult'];
        const allOptions = [...metrics, ...adjs, ...sys];

        window._templateMappingOptions = allOptions;
        window._currentTemplateData = data.map((row, idx) => ({
            ...row,
            r: 3 + idx,
            sourceR: row.sourceR || row.r
        }));
        renderTemplateMappingRows();

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">${escapeHTML(rt('report.mapping.loadFailed', { message: e.message }))}</td></tr>`;
    }
};

window.saveTemplateMapping = async function () {
    if (!window._currentTemplateData) return;
    getTemplateMappingRowsFromDom();

    const payload = window._currentTemplateData.map((row, idx) => ({
        r: row.r,
        sourceR: row.sourceR || null,
        templateSourceR: row.templateSourceR || null,
        isNew: !!row.isNew,
        text: row.text || '',
        mapping: row.mapping || ''
    }));

    try {
        const token = localStorage.getItem('tools_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/sla/template-mapping', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast(rt('report.mapping.saveSuccess'));
            document.getElementById('template-mapping-modal').style.display = 'none';
        } else {
            showToast(rt('report.mapping.saveFailed'), 'error');
        }
    } catch (e) {
        showToast(rt('report.mapping.saveFailedWithMessage', { message: e.message }), 'error');
    }
};


window.autoFillSequentialMapping = function () {
    if (!window._currentTemplateData) return;

    // 1. Build ordered main metrics
    const orderedMetrics = window._currentOrderedMetrics || [];
    const labelGroupLookup = window._currentLabelToGroup || {};
    const mainMetricsRaw = orderedMetrics.filter(m => labelGroupLookup[m.label] !== 'Others');

    // Merge EOS, Log, Topo
    const mainMetrics = [];
    let eosProduct = null;
    let logBase = null;
    let topoBase = null;
    mainMetricsRaw.forEach(m => {
        if (m.label === '全量EOS-产品') {
            eosProduct = { label: '全量EOS (合并)' };
            mainMetrics.push(eosProduct);
        } else if (m.label === '全量EOS-版本') {
            if (!eosProduct) mainMetrics.push(m);
        } else if (m.label === '日志回传') {
            logBase = { label: '日志回传 (合并)' };
            mainMetrics.push(logBase);
        } else if (m.label === '日志回传备案') {
            if (!logBase) mainMetrics.push(m);
        } else if (m.label === '拓扑') {
            topoBase = { label: '拓扑与预案 (合并)' };
            mainMetrics.push(topoBase);
        } else if (m.label === '预案') {
            if (!topoBase) mainMetrics.push(m);
        } else {
            mainMetrics.push(m);
        }
    });

    const adjs = (typeof manualAdjustItems !== 'undefined' ? manualAdjustItems : []);

    const selects = document.querySelectorAll('.mapping-select');

    // Helper to find select by row
    const setSelectByRow = (r, val) => {
        const idx = window._currentTemplateData.findIndex(d => d.r === r);
        if (idx !== -1 && selects[idx]) {
            // Only set if option exists
            if (Array.from(selects[idx].options).some(o => o.value === val)) {
                selects[idx].value = val;
            }
        }
    };

    // Fill metrics 3 to 36
    mainMetrics.forEach((m, i) => {
        const r = 3 + i;
        if (r <= 36) {
            setSelectByRow(r, m.label);
        }
    });

    // Fill SubTotal 37
    setSelectByRow(37, 'SYS_SubTotal');

    // Fill Adjustments 38 to 51, 52 to 53
    adjs.forEach((a, i) => {
        let r;
        if (i < 14) r = 38 + i;
        else r = 52 + (i - 14);
        if (r <= 53) {
            setSelectByRow(r, a.name);
        }
    });

    // Fill Totals 54, 55, 56
    setSelectByRow(54, 'SYS_AdjustTotal');
    setSelectByRow(55, 'SYS_WeightInMonth');
    setSelectByRow(56, 'SYS_FinalResult');

    showToast(rt('report.mapping.autoFillDone'), 'success');
};
