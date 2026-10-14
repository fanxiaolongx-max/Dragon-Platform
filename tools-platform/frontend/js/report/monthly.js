let chartOverallInstance = null;
let chartGroupsInstance = null;

function getMonthlyLang() {
    return window.ToolsI18n && window.ToolsI18n.getLanguage() === 'en-US' ? 'en' : 'zh';
}
window.currentLang = getMonthlyLang();

function getOrderedManualAdjustEntries(items) {
    return (Array.isArray(items) ? items : [])
        .map((item, idx) => ({ item, idx }))
        .filter(entry => entry.item && !entry.item.deleted)
        .sort((a, b) => {
            const aOrder = Number.isFinite(Number(a.item.sortOrder)) ? Number(a.item.sortOrder) : a.idx;
            const bOrder = Number.isFinite(Number(b.item.sortOrder)) ? Number(b.item.sortOrder) : b.idx;
            return aOrder - bOrder || a.idx - b.idx;
        });
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
    return !!(monthTargets && typeof monthTargets === 'object' && !Array.isArray(monthTargets) &&
        Object.values(monthTargets).some(value => value !== '' && value !== null && value !== undefined));
}

const i18n = {
    zh: {
        title: '埃及维护运营月度报告 <span id="monthlyFrontendVersion" style="font-size:14px;color:#94a3b8;font-weight:normal;margin-left:8px;">v加载中</span>',
        date_range_loading: '分析周期: 加载中...',
        filter_7_days: '最近 7 天',
        filter_30_days: '最近 30 天',
        filter_90_days: '最近 90 天',
        filter_all: '全部',
        to: '至',
        filter: '筛选',
        export_image: '🖼️ 导出为长图',
        export_pdf: '📄 导出为 PDF',
        export_daily_bundle: '按天批量导出',
        loading_report: '正在分析历史数据，生成月报...',
        section1_title: '一、整体状况与关键结论',
        section2_title: '二、历史趋势与波动分析',
        section3_title: '三、最新运行快照与短板透视',
        section3_1_title: '3.1 客户群/代表处/区域达标排名及加减分详情',
        th_rank: '排名',
        th_group: '客户群/代表处/区域名称',
        th_base_score: '基准得分',
        th_adj_score: '加减分项',
        th_final_score: '最终得分',
        th_rating: '评级',
        section3_2_title: '3.2 客户群/代表处/区域短板透视矩阵 (不达标项)',
        th_metric_name: '指标名称',
        th_target: '目标值',
        th_failures: '未达标客户群/代表处/区域及实测值',
        section3_3_title: '3.3 手工考核加减分明细',
        th_manual_score: '手工调整分数',
        th_desc: '说明',
        section3_4_title: '3.4 完整考核快照数据一览',

        // JS generated strings
        no_data: '当前时间范围内没有入库数据。',
        analysis_period: '分析周期: {start} 至 {end} (共 {count} 份数据快照)',
        overall_failing: '整体上共有 <span class="summary-highlight">{count}</span> 项指标存在未达标情况，主要包含：{list}。',
        overall_passed: '整体上所有考核指标均 <span style="color:green; font-weight:bold;">100% 达标</span>。',
        add_score: '加 {score} 分',
        sub_score: '扣 {score} 分',
        because: '，因为：{list}',
        manual_details: '额外加减分情况：{details}。',
        as_of: '截至 <strong>{date}</strong> (基于 {month} 月目标)，{overallStr} {manualStr}',
        group_details_title: '各客户群/代表处/区域详细达标情况如下：',
        group_failing: '共有 <span class="summary-highlight">{count}</span> 项未达标，主要包含：{list}。',
        group_passed: '各项指标 <span style="color:green; font-weight:bold;">全部达标</span>。',
        expiring_warning: '⚠️ 临期/超期单据提醒 ({count}项)',
        expiring_intro: '以下单据需要及时处理：',
        expiring_days_legend: '（单号后数字：正数=剩余天数，0=今日到期，负数=超期天数）',
        ticket_unmapped: '未映射',
        special_metric_warning: '🚩 所有人注意 特殊指标提醒 ({count}项)',
        special_metric_format: '<strong>[{metric}]</strong> 全局值: {global} | 目标: {target} | 差距: {gap}',
        unknown_id: '未知单号',
        unknown_network: '未知网络',
        unknown_ticket_type: '其他单据',
        unknown_status: '状态未知',
        ticket_format: '↳ {id} · {status}',

        chart1_title: '整体达标率与指标数趋势',
        chart1_overall_rate: '整体达标率',
        chart1_true_rate: '真实整体达标率',
        chart1_passed_metrics: '达标指标数',
        chart1_total_metrics: '总考核指标数',
        chart1_y_rate: '达标率',
        chart1_y_count: '数量',
        chart_unit_item: '项',

        chart2_title: '各客户群/代表处/区域达标情况趋势',

        rating_excellent: '<span style="color:green;font-weight:bold;">优秀</span>',
        rating_good: '良好',
        rating_warning: '<span style="color:red;font-weight:bold;">警告</span>',

        matrix_no_failures: '恭喜，当前快照无任何未达标项！',
        manual_default_desc: '系统记录的手工作业/质量事故奖惩等调整项',

        full_title: '(附) 计分规则与排位说明及加减分详情',
        full_th_type: '类型',
        full_th_desc: '项目说明',
        full_th_rule: '计分规则',
        full_occurrences: ' (发生次数)',
        full_adjustments: ' (加减分)',

        full_th_grouping: '分组',
        full_th_total_weight: '总权重',
        full_th_metric: '考核的指标名称',
        full_th_weight: '权重',
        full_th_month_target: '{month}月目标值',
        full_category_targets: '按分类目标',
        full_th_global: '全局总体达标',
        full_th_score: '得分',
        full_others_badge: '监控项',
        full_others_score_hint: '额外监控指标，不计入总分',
        full_proportional_hint: '比例计分已开启，完成率 {ratio}%',
        full_ungrouped: '未分组(Ungrouped)',
        full_ungrouped_short: '未分组',
        lbl_source_mode: 'SLA配置读源模式:',
        opt_mode_auto: '自动模式',
        opt_mode_sqlite: '强制 SQLite',
        lbl_target_month: '目标月份:',
        msg_exporting_img: '⏳ 正在生成长图，请稍候...',
        msg_export_img_success: '✅ 长图已成功导出！',
        msg_export_img_fail: '导出图片失败: ',
        msg_exporting_pdf: '⏳ 正在生成 PDF，请稍候...',
        msg_export_pdf_success: '✅ PDF 已成功导出！',
        msg_export_pdf_fail: '导出 PDF 失败: ',
        msg_export_daily_progress: '⏳ 正在生成日报 {current}/{total}：{date}',
        msg_export_daily_success: '✅ 已按月份打包导出 {count} 份 PDF 与完整 HTML 日报！',
        msg_export_daily_fail: '批量导出日报失败: ',
        daily_report_title: '运营质量与合规日报',
        title_dialog_heading: '修改月报标题',
        title_dialog_note: '中英文标题将同时保存到服务器，并跟随页面语言切换。',
        title_zh_label: '中文月报标题',
        title_en_label: '英文月报标题',
        title_cancel: '取消',
        title_save: '保存到服务器',
        title_click_hint: '点击修改中英文月报标题',
        title_saved: '✅ 月报中英文标题已保存到服务器',
        title_save_fail: '月报标题保存失败: ',
        title_required: '中英文月报标题均不能为空'
    },
    en: {
        title: 'Egypt Maintenance Operation Monthly Report <span id="monthlyFrontendVersion" style="font-size:14px;color:#94a3b8;font-weight:normal;margin-left:8px;">vLoading</span>',
        date_range_loading: 'Analysis Period: Loading...',
        filter_7_days: 'Last 7 Days',
        filter_30_days: 'Last 30 Days',
        filter_90_days: 'Last 90 Days',
        filter_all: 'All',
        to: 'to',
        filter: 'Filter',
        export_image: '🖼️ Export Image',
        export_pdf: '📄 Export PDF',
        export_daily_bundle: 'Export by Day',
        loading_report: 'Analyzing historical data, generating report...',
        section1_title: 'I. Overall Status & Key Conclusions',
        section2_title: 'II. Historical Trends & Volatility',
        section3_title: 'III. Latest Snapshot & Weakness Analysis',
        section3_1_title: '3.1 Customer Group / Rep Office / Region Ranking & Score Details',
        th_rank: 'Rank',
        th_group: 'Customer Group / Rep Office / Region',
        th_base_score: 'Base Score',
        th_adj_score: 'Adjustments',
        th_final_score: 'Final Score',
        th_rating: 'Rating',
        section3_2_title: '3.2 Weakness Matrix (Non-compliant Items)',
        th_metric_name: 'Metric Name',
        th_target: 'Target',
        th_failures: 'Non-compliant Groups / Rep Offices / Regions & Actuals',
        section3_3_title: '3.3 Manual Adjustment Details',
        th_manual_score: 'Adj. Score',
        th_desc: 'Description',
        section3_4_title: '3.4 Full Assessment Snapshot',

        no_data: 'No data available in the selected time range.',
        analysis_period: 'Analysis Period: {start} to {end} ({count} snapshots)',
        overall_failing: 'Overall, there are <span class="summary-highlight">{count}</span> non-compliant metrics, including: {list}.',
        overall_passed: 'Overall, all metrics are <span style="color:green; font-weight:bold;">100% Compliant</span>.',
        add_score: '+{score}',
        sub_score: '-{score}',
        because: ', because: {list}',
        manual_details: 'Score Adjustments: {details}.',
        as_of: 'As of <strong>{date}</strong> (based on Month {month} targets), {overallStr} {manualStr}',
        group_details_title: 'Detailed compliance by group:',
        group_failing: '<span class="summary-highlight">{count}</span> non-compliant items, including: {list}.',
        group_passed: 'All metrics <span style="color:green; font-weight:bold;">Compliant</span>.',
        expiring_warning: '⚠️ Expiring/Overdue Alert ({count})',
        expiring_intro: 'The following tickets require immediate action:',
        expiring_days_legend: '(Number after ID: positive = days left, 0 = due today, negative = days overdue)',
        ticket_unmapped: 'unmapped',
        special_metric_warning: '🚩 @ALL Special Alert ({count})',
        special_metric_format: '<strong>[{metric}]</strong> Global: {global} | Target: {target} | Gap: {gap}',
        unknown_id: 'Unknown ID',
        unknown_network: 'Unknown Network',
        unknown_ticket_type: 'Other tickets',
        unknown_status: 'Unknown status',
        ticket_format: '↳ {id} · {status}',

        chart1_title: 'Overall Compliance Rate & Metrics Trend',
        chart1_overall_rate: 'Compliance Rate',
        chart1_true_rate: 'True Overall Rate',
        chart1_passed_metrics: 'Compliant Metrics',
        chart1_total_metrics: 'Total Metrics',
        chart1_y_rate: 'Rate',
        chart1_y_count: 'Count',
        chart_unit_item: ' items',

        chart2_title: 'Compliance Trend by Customer Group / Rep Office / Region',

        rating_excellent: '<span style="color:green;font-weight:bold;">Excellent</span>',
        rating_good: 'Good',
        rating_warning: '<span style="color:red;font-weight:bold;">Warning</span>',

        matrix_no_failures: 'Congratulations, no non-compliant items in the current snapshot!',
        manual_default_desc: 'System recorded manual/quality adjustment items',

        full_title: '(Appx) Scoring Rules & Adjustments',
        full_th_type: 'Type',
        full_th_desc: 'Description',
        full_th_rule: 'Rule',
        full_occurrences: ' (Count)',
        full_adjustments: ' (Score)',

        full_th_grouping: 'Group',
        full_th_total_weight: 'Total Weight',
        full_th_metric: 'Metric Name',
        full_th_weight: 'Weight',
        full_th_month_target: '{month} Target',
        full_category_targets: 'By-category targets',
        full_th_global: 'Global Actual',
        full_th_score: 'Score',
        full_others_badge: 'Monitor',
        full_others_score_hint: 'Additional monitoring metric, not included in total score',
        full_proportional_hint: 'Proportional scoring is enabled, completion {ratio}%',
        full_ungrouped: 'Ungrouped',
        full_ungrouped_short: 'Ungrouped',
        lbl_source_mode: 'SLA Config Read Mode:',
        opt_mode_auto: 'Auto Mode',
        opt_mode_sqlite: 'Force SQLite',
        lbl_target_month: 'Target Month:',
        msg_exporting_img: '⏳ Generating image, please wait...',
        msg_export_img_success: '✅ Image exported successfully!',
        msg_export_img_fail: 'Failed to export image: ',
        msg_exporting_pdf: '⏳ Generating PDF, please wait...',
        msg_export_pdf_success: '✅ PDF exported successfully!',
        msg_export_pdf_fail: 'Failed to export PDF: ',
        msg_export_daily_progress: '⏳ Generating daily report {current}/{total}: {date}',
        msg_export_daily_success: '✅ Exported {count} daily PDF and full HTML reports by month!',
        msg_export_daily_fail: 'Failed to export daily reports: ',
        daily_report_title: 'Daily Quality & Compliance Report',
        title_dialog_heading: 'Edit Monthly Report Titles',
        title_dialog_note: 'Both titles are saved to the server and switch with the page language.',
        title_zh_label: 'Chinese monthly report title',
        title_en_label: 'English monthly report title',
        title_cancel: 'Cancel',
        title_save: 'Save to Server',
        title_click_hint: 'Click to edit the Chinese and English monthly report titles',
        title_saved: '✅ Chinese and English monthly report titles saved to the server',
        title_save_fail: 'Failed to save monthly report titles: ',
        title_required: 'Both Chinese and English monthly report titles are required',

        // Metric and Category mappings
        "TE": "TE",
        "ORG": "ORG",
        "ET": "ET",
        "VDF": "VDF",
        "加分": "Bonus",
        "扣分": "Penalty"
    }
};

function t(key, params = {}) {
    let str = i18n[window.currentLang][key] || key;
    for (let k in params) {
        str = str.replace(`{${k}}`, params[k]);
    }
    return str;
}

function tVal(text) {
    if (!text) return '';
    if (i18n[window.currentLang][text]) return i18n[window.currentLang][text];
    
    // 自动处理“整体xxx”这类动态拼接的词组
    if (window.currentLang === 'en' && typeof text === 'string' && text.startsWith('整体') && text.length > 2) {
        let suffix = text.substring(2).trim();
        return 'Overall ' + (i18n['en'][suffix] || suffix);
    }
    
    return text;
}

function isOthersMetricLabel(label) {
    const groups = Array.isArray(window._metricGroups) ? window._metricGroups : [];
    return groups.some(group => group && group.name === 'Others' && Array.isArray(group.metrics) && group.metrics.includes(label));
}

function othersMetricBadgeHtml() {
    return `<span style="display:inline-block; margin-left:4px; padding:1px 5px; border-radius:999px; background:#eceff1; color:#607d8b; font-size:9px; font-weight:700; vertical-align:middle;">${t('full_others_badge')}</span>`;
}

function escapeHTML(str) {
    return typeof str === 'string' ? str.replace(/[&<>'"]/g, tag => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'": '&#39;','"':'&quot;'}[tag] || tag)) : str;
}

const DEFAULT_MONTHLY_REPORT_TITLES = {
    zh: '埃及维护运营月度报告',
    en: 'Egypt Maintenance Operation Monthly Report'
};
const LEGACY_MONTHLY_REPORT_TITLES = [
    { zh: '月度运营质量与合规分析报告', en: 'Monthly Quality & Compliance Analysis' }
];
let monthlyReportTitles = { ...DEFAULT_MONTHLY_REPORT_TITLES };

function normalizeMonthlyReportTitles(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const sourceZh = typeof source.zh === 'string' ? source.zh.trim() : '';
    const sourceEn = typeof source.en === 'string' ? source.en.trim() : '';
    const isLegacyDefault = LEGACY_MONTHLY_REPORT_TITLES.some(item => item.zh === sourceZh && item.en === sourceEn);
    if (isLegacyDefault) return { ...DEFAULT_MONTHLY_REPORT_TITLES };
    return {
        zh: sourceZh || DEFAULT_MONTHLY_REPORT_TITLES.zh,
        en: sourceEn || DEFAULT_MONTHLY_REPORT_TITLES.en
    };
}

function monthlyTitleHtml(text) {
    return `${escapeHTML(text)} <span id="monthlyFrontendVersion" style="font-size:14px;color:#94a3b8;font-weight:normal;margin-left:8px;">v加载中</span>`;
}

function applyMonthlyReportTitles(value) {
    monthlyReportTitles = normalizeMonthlyReportTitles(value);
    i18n.zh.title = monthlyTitleHtml(monthlyReportTitles.zh);
    i18n.en.title = monthlyTitleHtml(monthlyReportTitles.en);
    const titleEl = document.getElementById('monthlyReportTitle');
    if (titleEl) {
        titleEl.innerHTML = i18n[window.currentLang].title;
        titleEl.title = t('title_click_hint');
        titleEl.setAttribute('aria-label', t('title_click_hint'));
    }
    document.title = `${window.currentLang === 'en' ? monthlyReportTitles.en : monthlyReportTitles.zh} - Tools Platform`;
    renderMonthlyFrontendVersion();
}

function openMonthlyTitleModal() {
    const modal = document.getElementById('monthlyTitleModal');
    const zhInput = document.getElementById('monthlyTitleZhInput');
    const enInput = document.getElementById('monthlyTitleEnInput');
    if (!modal || !zhInput || !enInput) return;
    zhInput.value = monthlyReportTitles.zh;
    enInput.value = monthlyReportTitles.en;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => (window.currentLang === 'en' ? enInput : zhInput).focus(), 0);
}

function closeMonthlyTitleModal() {
    const modal = document.getElementById('monthlyTitleModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('monthlyReportTitle')?.focus();
}

async function saveMonthlyReportTitles(event) {
    event.preventDefault();
    const zh = String(document.getElementById('monthlyTitleZhInput')?.value || '').trim();
    const en = String(document.getElementById('monthlyTitleEnInput')?.value || '').trim();
    if (!zh || !en) {
        showToast(t('title_required'), 'warn');
        return;
    }

    const saveButton = document.getElementById('monthlyTitleSaveButton');
    if (saveButton) saveButton.disabled = true;
    try {
        const nextTitles = { zh, en };
        await window.API.post('/api/db/config/monthly_report_titles', nextTitles);
        applyMonthlyReportTitles(nextTitles);
        closeMonthlyTitleModal();
        showToast(t('title_saved'), 'success');
    } catch (error) {
        console.error('Failed to save monthly report titles:', error);
        showToast(t('title_save_fail') + error.message, 'error');
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

function initMonthlyTitleEditor() {
    const titleEl = document.getElementById('monthlyReportTitle');
    const modal = document.getElementById('monthlyTitleModal');
    const form = document.getElementById('monthlyTitleForm');
    const cancelButton = document.getElementById('monthlyTitleCancelButton');
    if (titleEl) {
        titleEl.addEventListener('click', openMonthlyTitleModal);
        titleEl.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openMonthlyTitleModal();
            }
        });
    }
    if (form) form.addEventListener('submit', saveMonthlyReportTitles);
    if (cancelButton) cancelButton.addEventListener('click', closeMonthlyTitleModal);
    if (modal) {
        modal.addEventListener('click', event => {
            if (event.target === modal) closeMonthlyTitleModal();
        });
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && modal?.classList.contains('open')) closeMonthlyTitleModal();
    });

    window.API.get('/api/db/config/monthly_report_titles')
        .then(applyMonthlyReportTitles)
        .catch(error => {
            console.error('Failed to load monthly report titles:', error);
            applyMonthlyReportTitles(DEFAULT_MONTHLY_REPORT_TITLES);
        });
}

function translateTicketTitle(title) {
    const cleanTitle = String(title || '').replace(/[\u{1F300}-\u{1F9FF}]/gu, '').trim();
    if (window.currentLang !== 'en') {
        if (cleanTitle.includes('漏洞预警') || cleanTitle.includes('漏洞')) return '漏洞';
        if (cleanTitle.includes('SR详单') || cleanTitle.includes('SR')) return 'SR';
        if (cleanTitle.includes('整改')) return '整改';
        if (cleanTitle.includes('CPT专项风险') || cleanTitle.includes('专项风险') || cleanTitle.includes('CPT')) return 'CPT风险';
        if (cleanTitle.includes('常规风险') || cleanTitle === '风险') return '风险';
        return cleanTitle;
    }
    if (cleanTitle.includes('漏洞预警') || cleanTitle.includes('漏洞')) return 'Vulnerability Comm';
    if (cleanTitle.includes('SR详单') || cleanTitle.includes('SR')) return 'SR';
    if (cleanTitle.includes('整改')) return 'Rectification';
    if (cleanTitle.includes('CPT专项风险') || cleanTitle.includes('专项风险') || cleanTitle.includes('CPT')) return 'CPT';
    if (cleanTitle.includes('常规风险') || cleanTitle === '风险') return 'Risk';
    return tVal(cleanTitle) || cleanTitle || 'Ticket';
}

function translateSlaStatus(statusText) {
    let text = String(statusText || '').trim();
    if (!text || window.currentLang !== 'en') return text;
    return text
        .replace(/历史超期/g, 'Historical overdue')
        .replace(/SR超期/g, 'SR overdue')
        .replace(/SR高危/g, 'SR high risk')
        .replace(/SR预警/g, 'SR warning')
        .replace(/Critical高危/g, 'Critical high risk')
        .replace(/Critical预警/g, 'Critical warning')
        .replace(/漏洞紧急/g, 'Vulnerability urgent')
        .replace(/漏洞提醒/g, 'Vulnerability warning')
        .replace(/Checking紧急/g, 'Checking urgent')
        .replace(/Checking提醒/g, 'Checking warning')
        .replace(/整改紧急/g, 'Rectification urgent')
        .replace(/整改提醒/g, 'Rectification warning')
        .replace(/Confirm紧急/g, 'Confirm urgent')
        .replace(/Confirm提醒/g, 'Confirm warning')
        .replace(/挂起忽略/g, 'Pending ignored')
        .replace(/已关单/g, 'Closed')
        .replace(/缺少SLA关键时间/g, 'Missing SLA key time')
        .replace(/已触发上游超期标识/g, 'Upstream overdue flag triggered')
        .replace(/剩余/g, 'remaining')
        .replace(/消耗/g, 'consumed')
        .replace(/已超/g, 'overdue by')
        .replace(/小时/g, 'hours')
        .replace(/天/g, 'days')
        .replace(/周/g, 'weeks')
        .replace(/月/g, 'months');
}

function formatMonthlySlaStatus(ticket) {
    const days = ticket && ticket._slaDays;
    if (typeof days === 'number' && Number.isInteger(days) && Math.abs(days) < 100000) {
        return String(days);
    }
    let text = String(ticket && ticket._slaCleanText || '').trim();
    const remaining = text.match(/剩余\s*(-?\d+)\s*天/i) || text.match(/due in\s+(\d+)\s+days?/i);
    if (remaining) return String(Number(remaining[1]));
    const overdue = text.match(/(?:已超期|超期|逾期)\s*(\d+)\s*天/i) || text.match(/overdue by\s+(\d+)\s+days?/i);
    if (overdue) return String(-Number(overdue[1]));
    const composite = text.match(/(?:due in|overdue by)\s+(?:(\d+)\s+months?\s*)?(?:(\d+)\s+weeks?\s*)?(?:(\d+)\s+days?)?/i);
    if (composite && composite.slice(1).some(Boolean)) {
        const total = Number(composite[1] || 0) * 30 + Number(composite[2] || 0) * 7 + Number(composite[3] || 0);
        return String(/overdue by/i.test(composite[0]) ? -total : total);
    }
    const chineseComposite = text.match(/(?:剩余|已超期|超期|逾期)\s*(?:(\d+)\s*个月\s*)?(?:(\d+)\s*周\s*)?(?:(\d+)\s*天)?/);
    if (chineseComposite && chineseComposite.slice(1).some(Boolean)) {
        const total = Number(chineseComposite[1] || 0) * 30 + Number(chineseComposite[2] || 0) * 7 + Number(chineseComposite[3] || 0);
        return String(/超期|逾期/.test(chineseComposite[0]) ? -total : total);
    }
    if (ticket && ticket.collection === 'vulnerability') {
        text = text
            .replace(/^漏洞(?:紧急|提醒)\s*\(([^,，()]+)[,，]\s*(剩余\s*-?\d+\s*天)\)$/, '$1 / $2')
            .replace(/^漏洞(?:紧急|提醒)\s+([^/]+?)\s*\/\s*(剩余\s*-?\d+\s*天)$/, '$1 / $2')
            .replace(/^漏洞(?:紧急|提醒)\s*\((剩余\s*-?\d+\s*天)\)$/, '$1')
            .replace(/^漏洞(?:紧急|提醒)\s*/, '');
    }
    return translateSlaStatus(text) || t('unknown_status');
}

function updateStaticI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (i18n[window.currentLang][key]) {
            el.innerHTML = i18n[window.currentLang][key];
            if (key === 'section3_title') {
                const baselineText = window.currentLang === 'zh' ? ' (基准: ' : ' (Baseline: ';
                el.innerHTML += `${baselineText}<span id="latest-snapshot-date">${document.getElementById('latest-snapshot-date') ? document.getElementById('latest-snapshot-date').innerText : ''}</span>)`;
            }
        }
    });
    renderMonthlyFrontendVersion();
}

async function renderMonthlyFrontendVersion() {
    const versionEl = document.getElementById('monthlyFrontendVersion');
    if (!versionEl) return;
    const version = await window.ToolsAppVersion?.get();
    versionEl.textContent = version ? `v${version}` : 'v未标记';
    versionEl.title = version ? `平台版本：${version}` : '未能获取平台版本';
}

let currentTrends = null;
let currentLatest = null;
const MONTHLY_TARGET_MONTH_KEY = 'monthly_target_month';

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

function getMonthlyTargetMonth() {
    const sel = document.getElementById('monthlyTargetMonth');
    if (sel && sel.dataset.ready === 'true' && sel.value) return sel.value;
    try {
        const saved = JSON.parse(localStorage.getItem(MONTHLY_TARGET_MONTH_KEY) || '{}');
        const month = parseInt(saved.month, 10);
        if (saved.date === getTodayKey() && month >= 1 && month <= 12) return String(month);
    } catch (e) { }
    return String(getTargetMonthDefaultByDay());
}

function getMonthlyDateFilters() {
    const startDateInput = document.getElementById('filter-start-date');
    const endDateInput = document.getElementById('filter-end-date');
    return {
        startDate: startDateInput ? startDateInput.value : '',
        endDate: endDateInput ? endDateInput.value : ''
    };
}

function getMonthlyExportReferenceDate() {
    if (currentLatest && currentLatest.raw_data_json) {
        try {
            const rawSnapshot = JSON.parse(currentLatest.raw_data_json);
            if (rawSnapshot.timestamp) return rawSnapshot.timestamp;
        } catch (e) { }
    }
    if (currentLatest && currentLatest.created_at) return currentLatest.created_at;
    if (currentTrends && currentTrends.length) return currentTrends[currentTrends.length - 1].date;
    return new Date();
}

async function loadData(startDate, endDate) {
    try {
        const loader = document.getElementById('loader');
        const reportContent = document.getElementById('report-content');
        const emptyState = document.getElementById('report-empty-state');
        const errorState = document.getElementById('report-error-state');
        loader.style.display = 'block';
        reportContent.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        if (errorState) errorState.style.display = 'none';
        const exportBtnContainer = document.getElementById('export-actions');
        if (exportBtnContainer) exportBtnContainer.style.display = 'none';
        const workspaceActions = document.getElementById('monthlyWorkspaceActions');
        if (workspaceActions) workspaceActions.hidden = true;

        const params = new URLSearchParams();
        if (startDate && endDate) {
            params.set('startDate', startDate);
            params.set('endDate', endDate);
        }
        let url = `/api/db/monthly_report_data${params.toString() ? `?${params.toString()}` : ''}`;
        const mode = window.API.getSourceMode('monthly_sla_data');
        const query = mode === 'auto' ? '' : `?mode=${encodeURIComponent(mode)}`;

        const [data, configData, catDataRes, groupData, distributionPolicy] = await Promise.all([
            window.API.get(url),
            window.API.get(`/api/sla/config${query}`),
            window.API.get(`/api/sla/categories${query}`),
            window.API.get(`/api/sla/groups${query}`),
            window.API.get('/api/db/config/welink_policy_v2').catch(() => ({}))
        ]);

        window._categories = catDataRes || [];
        window._monthlyNetworkMappings = distributionPolicy.networkMappings || {};
        window._globalConfig = configData || { targets: {}, prefs: {} };
        window._metricGroups = groupData || [];

        if (window._globalConfig.prefs && window._globalConfig.prefs.i18nMap) {
            const loadedI18n = window._globalConfig.prefs.i18nMap;
            const cleanI18n = {};
            for (const [k, v] of Object.entries(loadedI18n)) {
                if (k === 'expiring_days_legend') continue;
                if (v && v.includes('<br>')) {
                    const match = v.match(/<span[^>]*>(.*?)<\/span>/);
                    cleanI18n[k] = match ? match[1] : v.replace(/<[^>]+>/g, '');
                } else {
                    cleanI18n[k] = v;
                }
            }
            i18n['en'] = { ...i18n['en'], ...cleanI18n };
        }

        let manualAdjustItems = [];
        if (configData && configData.prefs && configData.prefs.manualAdjustItems) {
            manualAdjustItems = configData.prefs.manualAdjustItems;
        } else {
            manualAdjustItems = [
                { type: '扣分', name: '人为事故 (含整改逾期、错认漏认)' },
                { type: '扣分', name: '恢复超60分钟事故 (华为原因)' },
                { type: '扣分', name: '严重投诉 (CXO/Operation Head级别)' },
                { type: '扣分', name: '严重违规 (瞒报、无方案/越权操作)' },
                { type: '扣分', name: '整改确认及执行逾期' },
                { type: '扣分', name: '不合格的关闭整改单 (审计发现)' },
                { type: '扣分', name: '未按要求完成整改 (含延期)' },
                { type: '扣分', name: '不规范风险处理 (月度审计)' },
                { type: '扣分', name: '风险确认/挂起/关闭逾期' },
                { type: '扣分', name: 'FME离职超10天未清理账号' },
                { type: '扣分', name: 'WFM无授权违规操作 (未发客户延期邮件)' },
                { type: '扣分', name: 'WFM操作回退 (代表处服务质量原因)' },
                { type: '扣分', name: '未按时完成回退复盘 (SLA:10天)' },
                { type: '扣分', name: 'ITR-FRT达不到98.5% (按月)' },
                { type: '加分', name: '跨产品逃生演练及Jam宣传' },
                { type: '加分', name: '邀约客户交流呈现服务价值' }
            ];
        }
        window._manualAdjustItems = manualAdjustItems;

        loader.style.display = 'none';
        if (window.renderMonthlySourcePanel) window.renderMonthlySourcePanel();

        if (!data || !data.trends || data.trends.length === 0) {
            currentTrends = null;
            currentLatest = null;
            document.getElementById('report-date-range').innerText = t('no_data');
            reportContent.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'block';
                const emptyText = emptyState.querySelector('p');
                if (emptyText) emptyText.innerText = t('no_data');
            }
            return;
        }

        if (emptyState) emptyState.style.display = 'none';
        reportContent.style.display = 'block';
        if (exportBtnContainer) exportBtnContainer.style.display = 'flex';

        currentTrends = data.trends;
        currentLatest = data.latest_snapshot;

        renderAll();

    } catch (error) {
        console.error('Failed to load monthly data:', error);
        if (window.renderMonthlySourcePanel) window.renderMonthlySourcePanel();
        const loader = document.getElementById('loader');
        const reportContent = document.getElementById('report-content');
        const emptyState = document.getElementById('report-empty-state');
        const errorState = document.getElementById('report-error-state');
        if (loader) loader.style.display = 'none';
        if (reportContent) reportContent.style.display = 'none';
        if (emptyState) emptyState.style.display = 'none';
        const exportBtnContainer = document.getElementById('export-actions');
        if (exportBtnContainer) exportBtnContainer.style.display = 'none';
        if (errorState) {
            errorState.style.display = 'block';
            const errorText = errorState.querySelector('p');
            if (errorText) errorText.innerText = `Failed to load data: ${error.message}`;
        }
    }
}

function renderAll() {
    if (!currentTrends || !currentLatest) return;

    updateStaticI18n();

    const actualStartDate = currentTrends[0].date;
    const actualEndDate = currentTrends[currentTrends.length - 1].date;
    document.getElementById('report-date-range').innerText = t('analysis_period', { start: actualStartDate, end: actualEndDate, count: currentTrends.length });

    const latestSnapshotElem = document.getElementById('latest-snapshot-date');
    if (latestSnapshotElem) latestSnapshotElem.innerText = actualEndDate;

    generateSummary(currentTrends, currentLatest, window._globalConfig);
    drawCharts(currentTrends);
    renderRanking(currentLatest);
    renderMatrix(currentLatest);
    renderManualScores(currentLatest);

    if (typeof renderFullSnapshot === 'function') {
        renderFullSnapshot(currentLatest, window._categories, window._globalConfig, window._metricGroups, window._manualAdjustItems);
    }
    renderMonthlyExplanation();
    if (window.MonthlyWorkspace) window.MonthlyWorkspace.afterRender();
}

function renderMonthlyExplanation() {
    const container = document.getElementById('monthly-explanation-section');
    if (!container) return;

    const zhItems = [
        ['这份月报看什么？', '它展示的是报表看板已经入库的历史快照。排名、趋势和明细都围绕“最新入库快照”和所选时间范围展开。'],
        ['排名分数从哪里来？', '客户群/代表处/区域排名直接使用报表看板入库时保存的基准得分、手工加减分和最终得分，不会在月报页面重新改写历史总分。'],
        ['系统得分是什么意思？', '系统得分来自自动指标。系统会按该对象实际参与考核的有效指标权重计算，再折算到标准总分，所以缺数据或未配置目标的指标不会直接扣分。'],
        ['预留加减分是什么？', '这是人工记录的专项奖惩，例如质量事故、严重投诉、专项加分等。最终得分 = 系统得分 + 预留加减分。'],
        ['短板透视矩阵怎么看？', '这里只列出未达标项，方便快速定位哪个指标、哪些客户群/代表处/区域有风险。点摘要里的指标名可以跳到对应明细。'],
        ['“监控项 / Others”算分吗？', '不算入总分和排名。它们是额外监控指标，所以在月报里会用灰色、虚线或“监控项”标签区分，避免被误认为正式扣分项。'],
        ['比例计分是什么意思？', '比例计分开启后，未达标不是直接 0 分，而是按完成目标的比例给部分分。例如目标 100、实际 80，可能按 80% 折算该指标分。'],
        ['为什么有些地方显示 --？', '-- 通常表示该对象没有数据、该指标没有参与、或本月没有可用目标。这类项一般不会作为有效扣分项处理。'],
        ['全局总体达标和客户群达标有什么区别？', '全局总体达标看的是该指标整体值；客户群/代表处/区域列看的是每个对象自己的值。全局异常不一定代表每个对象都有数据或都扣分。'],
        ['完整快照表为什么很大？', '它是为了追溯入库当时的完整现场：指标、目标、实测值、得分、比例计分和手工加减分都会尽量保留下来，方便事后核对。'],
        ['历史结果会不会被当前配置影响？', '排名和已入库分数以历史入库结果为准。页面展示会读取当前分组和翻译配置来辅助理解，但不会因此改写历史入库分数。']
    ];

    const enItems = [
        ['What should I read first?', 'This report shows saved snapshots from the Report Dashboard. Rankings, trends, and details are based on the latest saved snapshot and the selected date range.'],
        ['Where do ranking scores come from?', 'Customer group / rep office / region rankings use the base score, manual adjustment, and final score saved at ingestion time. The monthly page does not rewrite historical totals.'],
        ['What does System Score mean?', 'System Score comes from automated metrics. It is calculated from the valid metric weights the object actually participated in, then converted to the standard total score. Missing data or metrics without targets do not directly deduct points.'],
        ['What are Manual Adjustments?', 'These are manually recorded rewards or penalties, such as quality incidents, serious complaints, or special bonuses. Final Score = System Score + Manual Adjustment.'],
        ['How should I read the Weakness Matrix?', 'It only lists non-compliant items, so readers can quickly find which metric and which customer group / rep office / region needs attention. Metric links in the summary jump to details.'],
        ['Do Monitor / Others metrics affect score?', 'No. They are additional monitoring metrics and are not included in total score or ranking. They are shown in gray, dashed styles, or with a Monitor badge to avoid confusion.'],
        ['What is proportional scoring?', 'When enabled, a failing metric does not automatically get 0. It earns partial score based on completion ratio. For example, target 100 and actual 80 may earn 80% of that metric weight.'],
        ['Why do some cells show --?', '-- usually means no data, not participating in that metric, or no usable target for the selected month. These items are generally not treated as effective deductions.'],
        ['Global actual vs object actual?', 'Global actual is the overall value of a metric. Customer group / rep office / region columns show each object’s own value. A global issue does not always mean every object has data or loses points.'],
        ['Why is the full snapshot table so large?', 'It preserves the full ingestion-time context: metrics, targets, actuals, earned score, proportional scoring, and manual adjustments, so the result can be audited later.'],
        ['Can current config change historical results?', 'Saved rankings and scores follow the historical ingested result. Current grouping and translation settings help display the data, but do not rewrite historical scores.']
    ];

    const items = window.currentLang === 'en' ? enItems : zhItems;
    const title = window.currentLang === 'en' ? 'Reading Notes & Common Questions' : '阅读说明与常见疑问';
    const subtitle = window.currentLang === 'en'
        ? 'These notes explain the parts that are easiest to misunderstand when reading the monthly report.'
        : '下面这些说明用于解释月报里最容易被误解的地方。';

    container.innerHTML = `
        <div style="background:#f8fbff; border:1px solid #bbdefb; border-radius:12px; padding:18px 20px; box-shadow:0 2px 8px rgba(21,101,192,0.05);">
            <h4 style="margin:0 0 6px; color:#0277bd; font-size:16px;">${escapeHTML(title)}</h4>
            <div style="color:#607d8b; font-size:13px; margin-bottom:14px;">${escapeHTML(subtitle)}</div>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px;">
                ${items.map(([itemTitle, body]) => `
                    <div style="background:#fff; border:1px solid #e3edf7; border-radius:10px; padding:12px 14px;">
                        <div style="font-weight:700; color:#263238; margin-bottom:6px;">${escapeHTML(itemTitle)}</div>
                        <div style="font-size:13px; line-height:1.7; color:#546e7a;">${escapeHTML(body)}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

document.addEventListener('DOMContentLoaded', () => {
    updateStaticI18n();
    initMonthlyTitleEditor();
    const modeSelect = document.getElementById('monthlySourceMode');
    if (modeSelect) {
        modeSelect.value = window.API.getSourceMode('monthly_sla_data');
        modeSelect.addEventListener('change', () => {
            window.API.setSourceMode('monthly_sla_data', modeSelect.value);
            loadData();
        });
    }
    const monthSelect = document.getElementById('monthlyTargetMonth');
    if (monthSelect) {
        let monthOptions = '';
        for (let i = 1; i <= 12; i++) {
            monthOptions += `<option value="${i}">${window.currentLang === 'en' ? `Month ${i} Target` : `${i}月目标`}</option>`;
        }
        monthSelect.innerHTML = monthOptions;
        monthSelect.value = getMonthlyTargetMonth();
        monthSelect.dataset.ready = 'true';
        monthSelect.addEventListener('change', () => {
            localStorage.setItem(MONTHLY_TARGET_MONTH_KEY, JSON.stringify({
                month: parseInt(monthSelect.value, 10),
                date: getTodayKey()
            }));
            const { startDate, endDate } = getMonthlyDateFilters();
            loadData(startDate && endDate ? startDate : undefined, startDate && endDate ? endDate : undefined);
        });
    }
    if (window.renderMonthlySourcePanel) window.renderMonthlySourcePanel();

    window.addEventListener('tools:languagechange', () => {
        window.currentLang = getMonthlyLang();
        applyMonthlyReportTitles(monthlyReportTitles);
        
        const monthSelect = document.getElementById('monthlyTargetMonth');
        if (monthSelect) {
            let monthOptions = '';
            for (let i = 1; i <= 12; i++) {
                monthOptions += `<option value="${i}">${window.currentLang === 'en' ? `Month ${i} Target` : `${i}月目标`}</option>`;
            }
            const currentVal = monthSelect.value;
            monthSelect.innerHTML = monthOptions;
            monthSelect.value = currentVal;
        }

        if (currentTrends && currentLatest) {
            renderAll();
        } else {
            updateStaticI18n();
        }
        if (window.renderMonthlySourcePanel) window.renderMonthlySourcePanel();
    });

    // Initial load (all data)
    loadData();

    // Setup filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    const startDateInput = document.getElementById('filter-start-date');
    const endDateInput = document.getElementById('filter-end-date');
    const customBtn = document.getElementById('custom-filter-btn');

    function formatDate(d) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const days = btn.getAttribute('data-days');
            if (days === 'all') {
                startDateInput.value = '';
                endDateInput.value = '';
                loadData();
            } else {
                const end = new Date();
                const start = new Date();
                start.setDate(end.getDate() - parseInt(days));

                const sDate = formatDate(start);
                const eDate = formatDate(end);

                startDateInput.value = sDate;
                endDateInput.value = eDate;
                loadData(sDate, eDate);
            }
        });
    });

    customBtn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        const s = startDateInput.value;
        const e = endDateInput.value;
        if (!s || !e) {
            showToast('Please select start and end dates', 'warn');
            return;
        }
        if (s > e) {
            showToast('Start date cannot be after end date', 'warn');
            return;
        }
        loadData(s, e);
    });
});

function renderMonthlyExpiringTickets(tickets, categoryNames = []) {
    if (!Array.isArray(tickets) || !tickets.length) return '';
    const categories = [...new Set([...(Array.isArray(window._categories) ? window._categories : []), ...categoryNames])];
    const mappings = window.MonthlyWorkspace ? window.MonthlyWorkspace.getNetworkMappings() : (window._monthlyNetworkMappings || {});
    const grouped = new Map();
    tickets.forEach(ticket => {
        const rawNetwork = window.ExpediteNetwork.getRawNetwork(ticket);
        const category = window.ExpediteNetwork.resolveCategory(rawNetwork, categories, mappings);
        const label = category ? `[${category}]` : `${rawNetwork === 'Unknown Network' ? t('unknown_network') : rawNetwork} (${t('ticket_unmapped')})`;
        const ticketType = translateTicketTitle(ticket.title) || t('unknown_ticket_type');
        if (!grouped.has(label)) grouped.set(label, new Map());
        const byType = grouped.get(label);
        if (!byType.has(ticketType)) byType.set(ticketType, []);
        byType.get(ticketType).push(ticket);
    });

    let html = `<div class="monthly-ticket-alert">
        <h4>${t('expiring_warning', { count: tickets.length })}</h4>
        <div class="monthly-ticket-intro"><p>${t('expiring_intro')}</p><small class="monthly-ticket-days-legend">${t('expiring_days_legend')}</small></div>
        <div class="monthly-ticket-grid">`;
    [...grouped.keys()].sort((a, b) => a.localeCompare(b)).forEach(network => {
        html += `<section class="monthly-ticket-network-group"><div class="monthly-ticket-network">${escapeHTML(network)}</div>`;
        const byType = grouped.get(network);
        [...byType.keys()].sort((a, b) => a.localeCompare(b)).forEach(ticketType => {
            html += `<div class="monthly-ticket-type">[${escapeHTML(ticketType)}]</div><ul class="monthly-ticket-lines">`;
            byType.get(ticketType).forEach(ticket => {
                const data = ticket.data || {};
                const id = data.sr_num || data.sr_id || data.task_id || data.risk_id || data.ticket_id || data['单号'] || data['问题风险编号'] || data['问题编号'] || t('unknown_id');
                const days = ticket._slaDays;
                const warningDays = window.MonthlyWorkspace ? window.MonthlyWorkspace.getWarningDays() : 10;
                const imminent = typeof days === 'number' && Number.isInteger(days) && days <= warningDays;
                html += `<li${imminent ? ' class="is-imminent"' : ''}>${t('ticket_format', {
                    id: escapeHTML(String(id)),
                    status: escapeHTML(formatMonthlySlaStatus(ticket))
                })}</li>`;
            });
            html += '</ul>';
        });
        html += '</section>';
    });
    return html + '</div></div>';
}

function generateSummary(trends, latest, globalConfig) {
    if (!latest.metrics || latest.metrics.length === 0) return;

    const failingByCat = {};
    const catTotalMetrics = {};
    const overallFailingSet = new Set();

    latest.metrics.forEach(m => {
        if (!catTotalMetrics[m.cat_name]) catTotalMetrics[m.cat_name] = 0;
        catTotalMetrics[m.cat_name]++;

        if (m.is_failing === 1) {
            if (!failingByCat[m.cat_name]) failingByCat[m.cat_name] = [];
            failingByCat[m.cat_name].push(m.metric_label);
        }
    });

    let currentTrend = trends[trends.length - 1];

    // overallFailingArr calculation moved below

    const manualScoresArr = latest.cat_scores ? latest.cat_scores.filter(c => c.manual_score !== 0 && c.manual_score !== null) : [];
    let manualStr = '';

    let rawSnap = {};
    if (latest.raw_data_json) {
        try { rawSnap = JSON.parse(latest.raw_data_json); } catch (e) { }
    }
    const targetMonth = parseInt(getMonthlyTargetMonth(), 10) || rawSnap.month || (rawSnap.timestamp ? new Date(rawSnap.timestamp).getMonth() + 1 : (new Date(latest.created_at || Date.now()).getMonth() + 1));

    if (globalConfig && rawSnap.topMetrics) {
        const labelToTargetMap = {};
        const { targets, prefs } = globalConfig;
        if (prefs) {
            Object.keys(prefs).forEach(secId => {
                const pref = prefs[secId];
                const cleanSecId = secId.startsWith('sla_prefs_') ? secId.substring(10) : secId;
                if (pref.customMetrics) {
                    pref.customMetrics.forEach(rule => {
                        const key = `${cleanSecId}_${rule.id}`;
                        if (targets && targets[key]) labelToTargetMap[rule.label] = targets[key];
                    });
                }
            });
        }
        if (targets) {
            Object.keys(targets).forEach(k => {
                if (k.startsWith('manual_') && targets[k].label) {
                    labelToTargetMap[targets[k].label] = targets[k];
                }
            });
        }

        // targetMonth calculated above
        function parseNum(str) {
            if (str === undefined || str === null || str === '--') return NaN;
            const n = parseFloat(String(str).replace(/[^0-9.-]/g, ''));
            return isNaN(n) ? NaN : n;
        }

        rawSnap.topMetrics.forEach(m => {
            const targetData = labelToTargetMap[m.label];
            const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
            const hasTarget = targetData && targetData[targetMonth] !== undefined && targetData[targetMonth] !== '' && weight > 0;

            if (hasTarget) {
                const condition = targetData.type || 'gte';
                const globalValNum = parseNum(m.value);
                const targetNum = parseFloat(targetData[targetMonth]);
                if (!isNaN(globalValNum) && !isNaN(targetNum)) {
                    if (condition === 'gte' && globalValNum < targetNum) {
                        console.log("DEBUG_FAILING:", m.label, globalValNum, targetNum, condition); overallFailingSet.add(m.label);
                    } else if (condition === 'lte' && globalValNum > targetNum) {
                        console.log("DEBUG_FAILING:", m.label, globalValNum, targetNum, condition); overallFailingSet.add(m.label);
                    }
                }
            }
        });
    }
    function formatFailingMetricLink(m) {
        const isOthers = isOthersMetricLabel(m);
        const color = isOthers ? '#607d8b' : '#e31837';
        const title = isOthers ? t('full_others_score_hint') : '点击跳转至该指标详情';
        return `<a href="javascript:void(0)" onclick="const el = document.getElementById('matrix-row-${encodeURIComponent(m)}'); if(el) { el.scrollIntoView({behavior: 'smooth', block: 'center'}); el.style.backgroundColor='${isOthers ? '#eceff1' : '#fff3e0'}'; setTimeout(()=>el.style.backgroundColor='', 2000); } else { const fel = document.getElementById('full-row-${encodeURIComponent(m)}'); if(fel) { fel.scrollIntoView({behavior: 'smooth', block: 'center'}); fel.style.backgroundColor='${isOthers ? '#eceff1' : '#fff3e0'}'; setTimeout(()=>fel.style.backgroundColor='', 2000); } }" style="color:${color}; text-decoration:underline; font-weight:bold; cursor:pointer;" title="${escapeHTML(title)}">${escapeHTML(tVal(m))}${isOthers ? othersMetricBadgeHtml() : ''}</a>`;
    }

    const overallFailingArr = Array.from(overallFailingSet);
    let overallStr = '';
    if (overallFailingArr.length > 0) {
        overallStr = t('overall_failing', { count: overallFailingArr.length, list: overallFailingArr.map(formatFailingMetricLink).join('、') });
    } else {
        overallStr = t('overall_passed');
    }

    const snapAdjData = rawSnap.manualAdjustData || {};

    if (manualScoresArr.length > 0) {
        let details = manualScoresArr.map(c => {
            let actionStr = c.manual_score > 0 ? t('add_score', { score: c.manual_score }) : t('sub_score', { score: Math.abs(c.manual_score) });

            let reasons = [];
            let catAdj = snapAdjData[c.cat_name] || {};
            if (window._manualAdjustItems) {
                getOrderedManualAdjustEntries(window._manualAdjustItems).forEach(({ item, idx }) => {
                    if (catAdj[idx] > 0) {
                        reasons.push(tVal(item.name));
                    }
                });
            }

            let reasonStr = reasons.length > 0 ? t('because', { list: reasons.join('、') }) : '';
            return `${tVal(c.cat_name)}（${actionStr}${reasonStr}）`;
        }).join('；');
        manualStr = t('manual_details', { details: details });
    }

    let summaryHtml = `
        <p>${t('as_of', { date: currentTrend.date, month: targetMonth, overallStr: overallStr, manualStr: manualStr })}</p>
        <p>${t('group_details_title')}</p>
        <ul style="padding-left:20px; line-height:1.8;">
    `;

    for (let catName in catTotalMetrics) {
        let failingList = failingByCat[catName] || [];
        if (failingList.length > 0) {
            summaryHtml += `<li>【<strong>${tVal(catName)}</strong>】：${t('group_failing', { count: failingList.length, list: failingList.map(formatFailingMetricLink).join('、') })}</li>`;
        } else {
            summaryHtml += `<li>【<strong>${tVal(catName)}</strong>】：${t('group_passed')}</li>`;
        }
    }

    summaryHtml += `</ul>`;

    const specialMetricAlerts = rawSnap.specialMetricAlerts || [];
    if (specialMetricAlerts.length > 0) {
        summaryHtml += `
        <div style="margin-top:15px; padding:12px; background-color:#fef2f2; border-left:4px solid #dc2626; border-radius:4px;">
            <h4 style="margin:0 0 8px 0; color:#b91c1c; font-size:14px;">${t('special_metric_warning', { count: specialMetricAlerts.length })}</h4>
            <ul style="padding-left:20px; margin:0; line-height:1.6; color:#991b1b; font-size:13px;">
        `;
        specialMetricAlerts.forEach(item => {
            summaryHtml += `<li>${t('special_metric_format', {
                metric: tVal(item.metric_label || item.metricLabel || '未知指标'),
                global: item.global_val || item.globalValue || '--',
                target: item.target_val || item.targetValue || '--',
                gap: item.gap || '-'
            })}</li>`;
        });
        summaryHtml += `</ul></div>`;
    }

    summaryHtml += renderMonthlyExpiringTickets(rawSnap.expiringTickets || [], Object.keys(catTotalMetrics));

    document.getElementById('summary-content').innerHTML = summaryHtml;
}

function drawCharts(trends) {
    const dates = trends.map(t => t.date);

    const overallDom = document.getElementById('chart-overall');
    let chartOverall = echarts.getInstanceByDom(overallDom);
    if (!chartOverall) chartOverall = echarts.init(overallDom);

    const trueOverallRates = trends.map(t => {
        let rawSnap = {};
        if (t.raw_data_json) {
            try { rawSnap = JSON.parse(t.raw_data_json); } catch (e) { }
        }
        if (!rawSnap.topMetrics || rawSnap.topMetrics.length === 0) return t.compliance_rate !== undefined ? parseFloat(t.compliance_rate).toFixed(2) : 0;

        const targetMonth = parseInt(getMonthlyTargetMonth(), 10) || rawSnap.month || (rawSnap.timestamp ? new Date(rawSnap.timestamp).getMonth() + 1 : (new Date(t.created_at || t.date || Date.now()).getMonth() + 1));

        const labelToTargetMap = {};
        const globalConfig = window._globalConfig;
        const { targets, prefs } = globalConfig || {};
        if (prefs) {
            Object.keys(prefs).forEach(secId => {
                const pref = prefs[secId];
                const cleanSecId = secId.startsWith('sla_prefs_') ? secId.substring(10) : secId;
                if (pref.customMetrics) {
                    pref.customMetrics.forEach(rule => {
                        const key = `${cleanSecId}_${rule.id}`;
                        if (targets && targets[key]) labelToTargetMap[rule.label] = targets[key];
                    });
                }
            });
        }
        if (targets) {
            Object.keys(targets).forEach(k => {
                if (k.startsWith('manual_') && targets[k].label) {
                    labelToTargetMap[targets[k].label] = targets[k];
                }
            });
        }

        function parseNum(str) {
            if (str === undefined || str === null || str === '--') return NaN;
            const n = parseFloat(String(str).replace(/[^0-9.-]/g, ''));
            return isNaN(n) ? NaN : n;
        }

        let totalTrueMetrics = 0;
        const failingSet = new Set();

        const fallbackMap = {
            '产品EOS闭环率': '全量EOS-产品',
            '版本EOS闭环率': '全量EOS-版本',
            '业务比对回传率': '日志回传',
            '业务比对备案率': '日志回传备案',
            '价值网络巡检完成率': '价值网络HC',
            '应急演练完成率': 'iLab 应急演练',
            '锂电池整改完成率': '锂电',
            '高危命令拦截次数': '高危命令拦截'
        };
        const currentTargetLabels = Object.keys(labelToTargetMap).sort((a, b) => b.length - a.length);

        rawSnap.topMetrics.forEach(m => {
            let targetData = labelToTargetMap[m.label];
            if (!targetData) {
                let matched = fallbackMap[m.label];
                if (!matched) {
                    matched = currentTargetLabels.find(n => m.label.includes(n) || n.includes(m.label) || m.label.replace(/ /g, '').includes(n.replace(/ /g, '')));
                }
                if (matched && labelToTargetMap[matched]) {
                    targetData = labelToTargetMap[matched];
                }
            }

            const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
            const hasTarget = targetData && targetData[targetMonth] !== undefined && targetData[targetMonth] !== '' && weight > 0;

            if (hasTarget) {
                totalTrueMetrics++;
                const condition = targetData.type || 'gte';
                const globalValNum = parseNum(m.value);
                const targetNum = parseFloat(targetData[targetMonth]);
                if (!isNaN(globalValNum) && !isNaN(targetNum)) {
                    if (condition === 'gte' && globalValNum < targetNum) {
                        failingSet.add(m.label);
                    } else if (condition === 'lte' && globalValNum > targetNum) {
                        failingSet.add(m.label);
                    }
                }
            }
        });

        if (totalTrueMetrics === 0) return 100.00;
        return (((totalTrueMetrics - failingSet.size) / totalTrueMetrics) * 100).toFixed(2);
    });

    const overallRates = trends.map(t => t.compliance_rate !== undefined ? parseFloat(t.compliance_rate).toFixed(2) : 0);
    const totalMetrics = trends.map(t => t.metrics_total || 0);
    const passedMetrics = trends.map(t => (t.metrics_total || 0) - (t.metrics_failing || 0));

    chartOverall.setOption({
        title: { text: t('chart1_title'), left: 'center', textStyle: { fontSize: 15, fontWeight: 'normal' } },
        tooltip: {
            trigger: 'axis', formatter: function (params) {
                let relVal = params[0].name;
                for (let i = 0, l = params.length; i < l; i++) {
                    let unit = (params[i].seriesName === t('chart1_overall_rate') || params[i].seriesName === t('chart1_true_rate')) ? '%' : t('chart_unit_item');
                    relVal += '<br/>' + params[i].marker + params[i].seriesName + ': ' + params[i].value + unit;
                }
                return relVal;
            }
        },
        legend: { data: [t('chart1_true_rate'), t('chart1_overall_rate'), t('chart1_passed_metrics'), t('chart1_total_metrics')], bottom: 0 },
        xAxis: { type: 'category', data: dates, boundaryGap: true },
        yAxis: [
            {
                type: 'value',
                min: 0,
                max: 100,
                name: t('chart1_y_rate'),
                axisLabel: { formatter: '{value}%' }
            },
            {
                type: 'value',
                name: t('chart1_y_count'),
                min: 0,
                axisLabel: { formatter: `{value}${t('chart_unit_item').replace(' ', '')}` },
                splitLine: { show: false }
            }
        ],
        grid: { left: '3%', right: '3%', bottom: '5%', containLabel: true },
        series: [
            {
                name: t('chart1_true_rate'),
                data: trueOverallRates,
                type: 'line',
                smooth: true,
                yAxisIndex: 0,
                itemStyle: { color: '#e65100' }, // Orange for distinction
                label: { show: true, position: 'top', formatter: '{c}%' },
                labelLayout: { hideOverlap: true }
            },
            {
                name: t('chart1_overall_rate'),
                data: overallRates,
                type: 'line',
                smooth: true,
                yAxisIndex: 0,
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: 'rgba(0, 40, 94, 0.3)' },
                        { offset: 1, color: 'rgba(0, 40, 94, 0.05)' }
                    ])
                },
                itemStyle: { color: '#00285e' },
                label: { show: true, position: 'top', formatter: '{c}%' },
                labelLayout: { hideOverlap: true }
            },
            {
                name: t('chart1_total_metrics'),
                data: totalMetrics,
                type: 'line',
                smooth: true,
                yAxisIndex: 1,
                itemStyle: { color: '#9e9e9e' },
                lineStyle: { type: 'dashed' }
            },
            {
                name: t('chart1_passed_metrics'),
                data: passedMetrics,
                type: 'line',
                smooth: true,
                yAxisIndex: 1,
                itemStyle: { color: '#2e7d32' },
                label: { show: true, position: 'bottom', formatter: `{c}${t('chart_unit_item').replace(' ', '')}` },
                labelLayout: { hideOverlap: true }
            }
        ]
    }, true); // Use true to not merge with previous options if data changed entirely

    // Chart 2: Groups Trend
    const groupsDom = document.getElementById('chart-groups');
    let chartGroups = echarts.getInstanceByDom(groupsDom);
    if (!chartGroups) chartGroups = echarts.init(groupsDom);
    // Get all unique categories across all trends
    const allCatsSet = new Set();
    trends.forEach(t => {
        if (t.cat_scores) Object.keys(t.cat_scores).forEach(c => allCatsSet.add(c));
    });
    const allCats = Array.from(allCatsSet);

    const seriesData = allCats.map(cat => {
        return {
            name: cat,
            type: 'line',
            smooth: true,
            data: trends.map(t => {
                let score = (t.cat_scores && t.cat_scores[cat]) !== undefined ? t.cat_scores[cat] : null;
                return score !== null ? parseFloat(score).toFixed(2) : null;
            })
        };
    });

    chartGroups.setOption({
        title: { text: t('chart2_title'), left: 'center', textStyle: { fontSize: 15, fontWeight: 'normal' } },
        tooltip: { trigger: 'axis' },
        legend: { data: allCats.map(tVal), bottom: 0, type: 'scroll' },
        xAxis: { type: 'category', data: dates, boundaryGap: true },
        yAxis: { type: 'value', min: 'dataMin' },
        grid: { left: '3%', right: '5%', bottom: '5%', containLabel: true },
        series: seriesData.map(s => ({ ...s, name: tVal(s.name) }))
    }, true);

    if (!window._monthlyChartResizeBound) {
        window._monthlyChartResizeBound = true;
        window.addEventListener('resize', () => {
            const overallChart = echarts.getInstanceByDom(document.getElementById('chart-overall'));
            const groupsChart = echarts.getInstanceByDom(document.getElementById('chart-groups'));
            if (overallChart) overallChart.resize();
            if (groupsChart) groupsChart.resize();
        });
    }
}

function renderRanking(latest) {
    if (!latest.cat_scores || latest.cat_scores.length === 0) return;

    let sorted = [...latest.cat_scores].sort((a, b) => b.final_score - a.final_score);
    let html = '';

    sorted.forEach((cat, index) => {
        let rankStr = index + 1;
        if (index === 0) rankStr = '🥇 1';
        if (index === 1) rankStr = '🥈 2';
        if (index === 2) rankStr = '🥉 3';

        let baseScore = cat.base_score ? cat.base_score.toFixed(2) : '0.00';
        let manualScore = cat.manual_score ? cat.manual_score.toFixed(2) : '0.00';
        let finalScore = cat.final_score ? cat.final_score.toFixed(2) : '0.00';

        let manualStyle = cat.manual_score < 0 ? 'color: red;' : (cat.manual_score > 0 ? 'color: green;' : 'color: #999;');
        let manualDisplay = cat.manual_score > 0 ? '+' + manualScore : manualScore;

        let rating = t('rating_good');
        if (cat.final_score >= 95) rating = t('rating_excellent');
        else if (cat.final_score < 80) rating = t('rating_warning');

        html += `
            <tr>
                <td style="font-weight:bold; font-size:16px;">${rankStr}</td>
                <td style="font-weight:bold; color:#00285e;">${tVal(cat.cat_name)}</td>
                <td>${baseScore}</td>
                <td style="${manualStyle}">${manualDisplay}</td>
                <td style="font-size:16px; font-weight:bold; color:#333;">${finalScore}</td>
                <td>${rating}</td>
            </tr>
        `;
    });

    document.querySelector('#ranking-table tbody').innerHTML = html;
}

function renderMatrix(latest) {
    if (!latest.metrics || latest.metrics.length === 0) return;

    // Filter failing metrics (is_failing === 1)
    const failingMetrics = latest.metrics.filter(m => m.is_failing === 1);

    if (failingMetrics.length === 0) {
        document.querySelector('#matrix-table tbody').innerHTML = `<tr><td colspan="3" style="text-align:center;color:#666;">${t('matrix_no_failures')}</td></tr>`;
        return;
    }

    // Group by metric_label
    const metricGroups = {};
    failingMetrics.forEach(m => {
        if (!metricGroups[m.metric_label]) {
            metricGroups[m.metric_label] = {
                failures: []
            };
        }
        metricGroups[m.metric_label].failures.push({
            cat_name: m.cat_name,
            raw_val: m.raw_val,
            target_val: m.target_val
        });
    });

    let html = '';
    for (let label in metricGroups) {
        let group = metricGroups[label];
        const isOthers = isOthersMetricLabel(label);
        let failuresHtml = group.failures.map(f => {
            const chipStyle = isOthers
                ? 'display:inline-block; margin:2px 4px; padding:4px 8px; background:#f5f7f8; border:1px dashed #cfd8dc; border-radius:4px; font-size:13px; color:#607d8b;'
                : 'display:inline-block; margin:2px 4px; padding:4px 8px; background:#ffebee; border:1px solid #ffcdd2; border-radius:4px; font-size:13px;';
            return `<span style="${chipStyle}">
                <strong>${escapeHTML(tVal(f.cat_name))}</strong>: ${escapeHTML(String(f.raw_val ?? '--'))}
            </span>`;
        }).join(' ');
        const targetsHtml = group.failures.map(f => {
            const chipStyle = isOthers
                ? 'display:inline-block; margin:2px 4px; padding:4px 8px; background:#f5f7f8; border:1px dashed #cfd8dc; border-radius:4px; font-size:13px; color:#607d8b;'
                : 'display:inline-block; margin:2px 4px; padding:4px 8px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:4px; font-size:13px; color:#1d4ed8;';
            return `<span style="${chipStyle}">
                <strong>${escapeHTML(tVal(f.cat_name))}</strong>: ${escapeHTML(String(f.target_val || '--'))}
            </span>`;
        }).join(' ');
        const metricCellStyle = isOthers
            ? 'font-weight:600; color:#607d8b; background:#fafafa;'
            : 'font-weight:600; color:#444;';
        const targetCellStyle = isOthers
            ? 'color:#78909c; background:#fafafa;'
            : 'color:#666;';
        const rowStyle = isOthers ? ' style="background:#fafafa;" title="' + escapeHTML(t('full_others_score_hint')) + '"' : '';

        html += `
            <tr id="matrix-row-${encodeURIComponent(label)}"${rowStyle}>
                <td style="${metricCellStyle}">${escapeHTML(tVal(label))}${isOthers ? othersMetricBadgeHtml() : ''}</td>
                <td style="${targetCellStyle}">${targetsHtml}</td>
                <td>${failuresHtml}</td>
            </tr>
        `;
    }

    document.querySelector('#matrix-table tbody').innerHTML = html;
}

function renderManualScores(latest) {
    if (!latest.cat_scores) return;

    const manualScores = latest.cat_scores.filter(c => c.manual_score !== 0 && c.manual_score !== null);

    if (manualScores.length === 0) {
        document.getElementById('manual-score-section').style.display = 'none';
        return;
    }

    document.getElementById('manual-score-section').style.display = 'block';

    let rawSnap = {};
    if (latest.raw_data_json) {
        try { rawSnap = JSON.parse(latest.raw_data_json); } catch (e) { }
    }
    const snapAdjData = rawSnap.manualAdjustData || {};

    let html = '';
    manualScores.forEach(c => {
        let valStyle = c.manual_score > 0 ? 'color: green; font-weight: bold;' : 'color: red; font-weight: bold;';
        let valStr = c.manual_score > 0 ? `+${c.manual_score}` : `${c.manual_score}`;

        let reasons = [];
        let catAdj = snapAdjData[c.cat_name] || {};
        if (window._manualAdjustItems) {
            getOrderedManualAdjustEntries(window._manualAdjustItems).forEach(({ item, idx }) => {
                if (catAdj[idx] > 0) {
                    reasons.push(tVal(item.name));
                }
            });
        }
        let desc = reasons.length > 0 ? reasons.join('、') : t('manual_default_desc');

        html += `
            <tr>
                <td style="font-weight:bold; color:#00285e;">${tVal(c.cat_name)}</td>
                <td style="${valStyle}">${valStr}</td>
                <td style="color:#666;">（${desc}）</td>
            </tr>
        `;
    });

    document.querySelector('#manual-score-table tbody').innerHTML = html;
}

function renderFullSnapshot(latest, categories, globalConfig, metricGroups, manualAdjustItems) {
    if (!latest.raw_data_json) return;
    let snap;
    try { snap = JSON.parse(latest.raw_data_json); } catch (e) { return; }

    // Build labelToTargetMap
    const labelToTargetMap = {};
    const { targets, prefs } = globalConfig;
    if (prefs) {
        Object.keys(prefs).forEach(secId => {
            const pref = prefs[secId];
            const cleanSecId = secId.startsWith('sla_prefs_') ? secId.substring(10) : secId;
            if (pref.customMetrics) {
                pref.customMetrics.forEach(rule => {
                    const key = `${cleanSecId}_${rule.id}`;
                    if (targets && targets[key]) labelToTargetMap[rule.label] = targets[key];
                });
            }
        });
    }
    if (targets) {
        Object.keys(targets).forEach(k => {
            if (k.startsWith('manual_') && targets[k].label) {
                labelToTargetMap[targets[k].label] = targets[k];
            }
        });
    }

    // Prepare catData
    const catData = {};
    categories.forEach(cat => {
        catData[cat] = { earnedScore: 0, validWeightSum: 0, values: {} };
    });

    const metricCols = snap.topMetrics || [];

    // Inject missing manual
    if (targets) {
        Object.keys(targets).forEach(k => {
            if (k.startsWith('manual_') && targets[k].label) {
                const label = targets[k].label;
                if (!metricCols.find(m => m.label === label)) {
                    metricCols.push({ label: label, value: '--', subMetrics: [], isManual: true });
                } else {
                    const exists = metricCols.find(m => m.label === label);
                    if (exists) exists.isManual = true;
                }
            }
        });
    }

    const targetMonth = parseInt(getMonthlyTargetMonth(), 10) || snap.month || new Date(snap.timestamp).getMonth() + 1;

    function parseNum(str) {
        if (str === undefined || str === null || str === '--') return NaN;
        const n = parseFloat(String(str).replace(/[^0-9.-]/g, ''));
        return isNaN(n) ? NaN : n;
    }

    function formatScoreValue(value) {
        const num = parseFloat(value);
        if (isNaN(num)) return value;
        return Number.isInteger(num) ? String(num) : String(+num.toFixed(2));
    }

    const metricDbMap = {};
    (latest.metrics || []).forEach(row => {
        metricDbMap[`${row.cat_name}@@${row.metric_label}`] = row;
    });

    const labelToGroup = {};
    const groupWeightMap = {};
    metricGroups.forEach(g => {
        let sumWeight = 0;
        (g.metrics || []).forEach(label => {
            labelToGroup[label] = g.name;
            const t = labelToTargetMap[label];
            sumWeight += (t && t.weight !== undefined) ? parseFloat(t.weight) : 1;
        });
        groupWeightMap[g.name] = sumWeight;
    });

    metricCols.forEach(m => {
        const targetData = labelToTargetMap[m.label];
        const weight = (targetData && targetData.weight !== undefined) ? parseFloat(targetData.weight) : 1;
        const hasSavedCategoryTarget = (latest.metrics || []).some(row =>
            row.metric_label === m.label &&
            row.target_val !== '' &&
            row.target_val !== null &&
            row.target_val !== undefined &&
            row.target_val !== '--'
        );
        m.hasSavedCategoryTarget = hasSavedCategoryTarget;
        m.hasTarget = !!(targetData && (
            getEffectiveTargetValue(targetData, targetMonth) !== undefined ||
            hasCategoryTargets(targetData, targetMonth)
        ) && weight > 0) || (hasSavedCategoryTarget && weight > 0);
        const isOthersMetric = labelToGroup[m.label] === 'Others';

        const subs = m.subMetrics || [];
        subs.forEach(sm => {
            if (!catData[sm.category]) {
                catData[sm.category] = { earnedScore: 0, validWeightSum: 0, values: {} };
                if (!categories.includes(sm.category)) categories.push(sm.category);
            }
            const valNum = parseNum(sm.value);
            let isFailing = false;
            let gapStr = '';
            let bonusScore = 0;
            let earnedScore = 0;
            let proportionalScoring = false;
            let completionRatio = 0;
            const dbMetric = metricDbMap[`${sm.category}@@${m.label}`];
            const effectiveTargetValue = getEffectiveTargetValue(targetData, targetMonth, sm.category);
            const savedTargetValue = dbMetric && dbMetric.target_val !== '' &&
                dbMetric.target_val !== null && dbMetric.target_val !== undefined &&
                dbMetric.target_val !== '--'
                ? dbMetric.target_val
                : undefined;
            const resolvedTargetValue = effectiveTargetValue !== undefined
                ? effectiveTargetValue
                : savedTargetValue;

            if (!isNaN(valNum) && m.hasTarget && resolvedTargetValue !== undefined) {
                if (!isOthersMetric) {
                    catData[sm.category].validWeightSum += weight;
                }
                const targetNum = parseNum(resolvedTargetValue);
                const condition = String(resolvedTargetValue).trim().startsWith('≤')
                    ? 'lte'
                    : ((targetData && targetData.type) || 'gte');
                const isPercent = String(sm.value).includes('%');

                if (!isNaN(targetNum) && condition === 'gte' && valNum < targetNum) {
                    isFailing = true; gapStr = +(targetNum - valNum).toFixed(2) + (isPercent ? '%' : '');
                } else if (!isNaN(targetNum) && condition === 'lte' && valNum > targetNum) {
                    isFailing = true; gapStr = +(valNum - targetNum).toFixed(2) + (isPercent ? '%' : '');
                } else if (targetData && targetData.exceedBy > 0 && targetData.bonus > 0) {
                    if (condition === 'gte' && valNum > targetNum) {
                        bonusScore = Math.floor((valNum - targetNum) / targetData.exceedBy) * targetData.bonus;
                    } else if (condition === 'lte' && valNum < targetNum) {
                        bonusScore = Math.floor((targetNum - valNum) / targetData.exceedBy) * targetData.bonus;
                    }
                }
                if (dbMetric && dbMetric.earned_score !== null && dbMetric.earned_score !== undefined) {
                    earnedScore = parseFloat(dbMetric.earned_score) || 0;
                    proportionalScoring = !!dbMetric.proportional_scoring;
                    completionRatio = dbMetric.completion_ratio === null || dbMetric.completion_ratio === undefined ? 0 : parseFloat(dbMetric.completion_ratio) || 0;
                    if (dbMetric.is_failing !== null && dbMetric.is_failing !== undefined) isFailing = !!dbMetric.is_failing;
                    if (dbMetric.gap !== null && dbMetric.gap !== undefined) gapStr = dbMetric.gap || gapStr;
                } else {
                    earnedScore = isFailing ? 0 : (weight + bonusScore);
                }
                if (!isOthersMetric) {
                    catData[sm.category].earnedScore += earnedScore;
                }
            }
            catData[sm.category].values[m.label] = {
                raw: sm.value,
                num: valNum,
                isFailing: isFailing,
                gapStr: gapStr,
                bonusScore: bonusScore || 0,
                earnedScore,
                proportionalScoring,
                completionRatio,
                targetValue: resolvedTargetValue
            };
        });
    });

    const orderedMetrics = [];
    metricGroups.forEach(g => {
        (g.metrics || []).forEach(label => {
            const m = metricCols.find(x => x.label === label);
            if (m) orderedMetrics.push(m);
        });
    });
    metricCols.forEach(m => { if (!labelToGroup[m.label]) orderedMetrics.push(m); });

    const tableRows = [];
    let i = 0;
    while (i < orderedMetrics.length) {
        const m = orderedMetrics[i];
        const hasTgt = getEffectiveTargetValue(labelToTargetMap[m.label], targetMonth) !== undefined ||
            hasCategoryTargets(labelToTargetMap[m.label], targetMonth);
        const grpName = labelToGroup[m.label] || (m.isManual || hasTgt ? t('full_ungrouped') : null);

        if (grpName) {
            const grpMetrics = orderedMetrics.filter(x => {
                const xHasTgt = getEffectiveTargetValue(labelToTargetMap[x.label], targetMonth) !== undefined ||
                    hasCategoryTargets(labelToTargetMap[x.label], targetMonth);
                return (labelToGroup[x.label] || (x.isManual || xHasTgt ? t('full_ungrouped') : null)) === grpName;
            });
            const size = grpMetrics.length;
            const firstIdx = orderedMetrics.findIndex(x => {
                const xHasTgt = getEffectiveTargetValue(labelToTargetMap[x.label], targetMonth) !== undefined ||
                    hasCategoryTargets(labelToTargetMap[x.label], targetMonth);
                return (labelToGroup[x.label] || (x.isManual || xHasTgt ? t('full_ungrouped') : null)) === grpName && x.label === grpMetrics[0].label;
            });
            if (i === firstIdx) {
                tableRows.push({ groupName: grpName, groupSize: size, isGroupStart: true, metric: m, groupWeight: groupWeightMap[grpName] || '-' });
            } else {
                tableRows.push({ groupName: grpName, groupSize: 0, isGroupStart: false, metric: m });
            }
        }
        i++;
    }

    const escapeHTML = str => typeof str === 'string' ? str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)) : str;

    let matrixHtml = `
        <div style="background:#fff; overflow-x:auto;">
        <table class="matrix-table" style="font-size:clamp(10px, 0.85vw, 11px); line-height:1.4;">
            <thead>
                <tr>
                    <th style="width:40px; max-width:60px; background:#e8eaf6; color:#283593; white-space:normal; word-wrap:break-word; text-align:center;">${t('full_th_grouping')}</th>
                    <th style="width:40px; max-width:50px; background:#e8eaf6; color:#283593; white-space:normal; word-wrap:break-word; text-align:center;">${t('full_th_total_weight')}</th>
                    <th style="width:100px; max-width:140px; text-align:left; white-space:normal; word-wrap:break-word;">${t('full_th_metric')}</th>
                    <th style="width:40px; text-align:center;">${t('full_th_weight')}</th>
                    <th style="width:75px; text-align:center; white-space:normal; word-wrap:break-word;">${t('full_th_month_target', { month: targetMonth })}</th>
                    <th style="width:75px; background:#fff8e1; border-right:2px solid #ffe082; color:#ef6c00; text-align:center; white-space:normal; word-wrap:break-word;">${t('full_th_global')}</th>
                    ${categories.map(cat => `<th style="text-align:center; width:40px; white-space:normal; word-wrap:break-word;">${escapeHTML(tVal(cat))}</th>`).join('')}
                    ${categories.map(cat => `<th style="background:#e8f5e9; text-align:center; width:40px; white-space:normal; word-wrap:break-word;">${escapeHTML(tVal(cat))}<br>${t('full_th_score')}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;

    tableRows.forEach(row => {
        const m = row.metric;
        const isOthersMetric = labelToGroup[m.label] === 'Others';
        const rowStyle = isOthersMetric ? ' style="background:#fafafa;"' : '';
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
                    isGlobalFailing = true; globalGapStr = +(targetNum - globalValNum).toFixed(2) + (isPercent ? '%' : '');
                } else if (condition === 'lte' && globalValNum > targetNum) {
                    isGlobalFailing = true; globalGapStr = +(globalValNum - targetNum).toFixed(2) + (isPercent ? '%' : '');
                }
            }
        } else if (hasCategoryTargets(targetData, targetMonth) || m.hasSavedCategoryTarget) {
            targetStr = t('full_category_targets');
        }

        let globalDisplayClass = 'val-none';
        if (globalTargetValue !== undefined && !isNaN(parseNum(m.value))) {
            globalDisplayClass = isGlobalFailing ? 'val-warn' : 'val-good';
        }

        matrixHtml += `<tr id="full-row-${encodeURIComponent(m.label)}"${rowStyle}>`;
        if (metricGroups.length > 0) {
            const groupCellStyle = isOthersMetric
                ? 'max-width:60px; white-space:normal; word-wrap:break-word; text-align:center; background:#eceff1; color:#607d8b;'
                : 'max-width:60px; white-space:normal; word-wrap:break-word; text-align:center;';
            const groupWeightStyle = isOthersMetric
                ? 'font-weight:bold; color:#78909c; text-align:center; max-width:50px; background:#eceff1;'
                : 'font-weight:bold; color:#1565c0; text-align:center; max-width:50px;';
            matrixHtml += `<td ${row.isGroupStart ? `rowspan="${row.groupSize}"` : `style="display:none;"`} style="${groupCellStyle}">${escapeHTML(tVal(row.groupName) || t('full_ungrouped_short'))}</td>`;
            matrixHtml += `<td ${row.isGroupStart ? `rowspan="${row.groupSize}"` : `style="display:none;"`} style="${groupWeightStyle}">${row.groupWeight || '-'}</td>`;
        }

        const metricNameStyle = isOthersMetric
            ? 'text-align:left; font-weight:600; color:#607d8b; max-width:140px; white-space:normal; word-wrap:break-word;'
            : 'text-align:left; font-weight:600; color:#2c3e50; max-width:140px; white-space:normal; word-wrap:break-word;';
        const metricBadge = isOthersMetric
            ? `<span style="display:inline-block; margin-left:4px; padding:1px 5px; border-radius:999px; background:#eceff1; color:#607d8b; font-size:9px; font-weight:700;">${t('full_others_badge')}</span>`
            : '';
        const weightStyle = isOthersMetric
            ? 'color:#78909c; font-weight:bold; background:#f5f7f8; text-align:center;'
            : 'color:#666; font-weight:bold; background:#fafafa; text-align:center;';
        matrixHtml += `
            <td style="${metricNameStyle}">${escapeHTML(tVal(m.label))}${metricBadge}</td>
            <td style="${weightStyle}">${weight}</td>
            <td style="color:#0277bd; font-weight:bold; background:#f5f8fa; text-align:center; max-width:75px; white-space:normal; word-wrap:break-word;">${targetStr}</td>
            <td style="background:#fff8e1; border-right:2px solid #ffe082; text-align:center; max-width:75px; white-space:normal; word-wrap:break-word;"><span class="${globalDisplayClass}">${escapeHTML(String(m.value || '--').trim())}</span></td>`;

        categories.forEach(cat => {
            const cell = catData[cat].values[m.label];
            if (!cell || cell.raw === '--') {
                matrixHtml += `<td class="val-none" style="text-align:center;">--</td>`;
            } else {
                let displayClass = 'val-none';
                if (cell.targetValue !== undefined) displayClass = cell.isFailing ? 'val-warn' : 'val-good';
                matrixHtml += `<td style="text-align:center;"><span class="${displayClass}">${escapeHTML(String(cell.raw).trim())}</span></td>`;
            }
        });

        categories.forEach(cat => {
            const cell = catData[cat].values[m.label];
            if (!cell || cell.raw === '--') {
                matrixHtml += `<td class="val-none" style="background:#f1f8e9;">--</td>`;
            } else if (cell.targetValue === undefined) {
                matrixHtml += `<td class="val-none" style="background:#f1f8e9;">--</td>`;
            } else {
                const earned = cell.earnedScore !== undefined ? cell.earnedScore : (cell.isFailing ? 0 : (weight + (cell.bonusScore || 0)));
                const scoreColor = isOthersMetric ? '#78909c' : (cell.isFailing ? '#d32f2f' : '#2e7d32');
                const scoreBg = isOthersMetric ? '#f5f7f8' : '#f1f8e9';
                const bonusDisplay = cell.bonusScore ? ` <span style="font-size:9px; color:#e65100;">(+${cell.bonusScore.toFixed(2)})</span>` : '';
                const proportionalHint = cell.proportionalScoring && cell.isFailing ? t('full_proportional_hint', { ratio: (cell.completionRatio * 100).toFixed(1) }) : '';
                const titleText = isOthersMetric
                    ? `${t('full_others_score_hint')}${proportionalHint ? `; ${proportionalHint}` : ''}`
                    : proportionalHint;
                const ratioTitle = titleText ? ` title="${escapeHTML(titleText)}"` : '';
                const ratioBadgeColor = isOthersMetric ? '#9ca3af' : '#ef6c00';
                const ratioBadge = cell.proportionalScoring && cell.isFailing ? `<div style="font-size:9px; color:${ratioBadgeColor}; font-weight:600; line-height:1.2;">${(cell.completionRatio * 100).toFixed(0)}%</div>` : '';
                matrixHtml += `<td style="font-weight:bold; color:${scoreColor}; background:${scoreBg}; text-align:center;${isOthersMetric ? ' border:1px dashed #cfd8dc;' : ''}"${ratioTitle}>${formatScoreValue(earned)}${bonusDisplay}${ratioBadge}</td>`;
            }
        });
        matrixHtml += `</tr>`;
    });

    matrixHtml += `</tbody></table></div>`;

    // Adjustments
    const snapAdjustData = snap.manualAdjustData || {};
    let adjustHtml = `
        <div style="background:#fff; overflow-x:auto; margin-top:20px;">
        <h4 style="margin: 0 0 10px 0; color: #555;">${t('full_title')}</h4>
        <table class="matrix-table" style="font-size:clamp(10px, 0.85vw, 11px); line-height:1.4;">
            <thead>
                <tr>
                    <th style="width:40px; text-align:center;">${t('full_th_type')}</th>
                    <th style="text-align:left; max-width:200px; white-space:normal; word-wrap:break-word;">${t('full_th_desc')}</th>
                    <th style="min-width:80px; max-width:120px; white-space:normal; word-wrap:break-word;">${t('full_th_rule')}</th>
                    ${categories.map(cat => `<th style="width:60px; background:#fff3e0; text-align:center;">${escapeHTML(tVal(cat))}<br>${t('full_occurrences')}</th>`).join('')}
                    ${categories.map(cat => `<th style="width:50px; background:#e8f5e9; text-align:center;">${escapeHTML(tVal(cat))}<br>${t('full_adjustments')}</th>`).join('')}
                </tr>
            </thead>
            <tbody>
    `;

    getOrderedManualAdjustEntries(manualAdjustItems).forEach(({ item, idx }) => {
        const typeColor = item.type === '加分' ? '#2e7d32' : '#c62828';
        const typeBg = item.type === '加分' ? '#e8f5e9' : '#ffebee';

        let displayDesc = item.desc;
        if (window.currentLang === 'en' && item.unit !== undefined) {
            displayDesc = item.cap ? `${item.unit} pts/time, Cap ${item.cap} pts` : `${item.unit} pts/time, No cap`;
        }

        adjustHtml += `<tr>
            <td style="color:${typeColor}; background:${typeBg}; font-weight:bold; text-align:center;">${escapeHTML(tVal(item.type))}</td>
            <td style="text-align:left; max-width:200px; white-space:normal; word-wrap:break-word;">${escapeHTML(tVal(item.name))}</td>
            <td style="color:#666; max-width:120px; white-space:normal; word-wrap:break-word;">${escapeHTML(displayDesc)}</td>
        `;

        categories.forEach(cat => {
            const val = (snapAdjustData[cat] && snapAdjustData[cat][idx]) || '--';
            adjustHtml += `<td style="text-align:center;">${val}</td>`;
        });

        categories.forEach(cat => {
            let score = 0;
            const count = (snapAdjustData[cat] && snapAdjustData[cat][idx]) || 0;
            if (count > 0) {
                score = count * item.unit;
                if (item.cap && score > item.cap) score = item.cap;
                if (item.type === '扣分') score = -score;
            }
            const sColor = score > 0 ? '#2e7d32' : (score < 0 ? '#c62828' : '#333');
            adjustHtml += `<td style="font-weight:bold; text-align:center; color:${sColor};">${score}</td>`;
        });

        adjustHtml += `</tr>`;
    });
    adjustHtml += `</tbody></table></div>`;

    document.getElementById('full-report-content').innerHTML = matrixHtml + adjustHtml;
}

function waitForMonthlyReportPaint() {
    return new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)));
    });
}

function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function captureMonthlyReportCanvas() {
    const element = document.querySelector('.page-container');
    const filterContainer = document.getElementById('date-filter-container');
    const btnContainer = document.getElementById('export-actions');
    const workspaceActions = document.getElementById('monthlyWorkspaceActions');
    const previous = {
        filterDisplay: filterContainer ? filterContainer.style.display : '',
        buttonDisplay: btnContainer ? btnContainer.style.display : '',
        workspaceDisplay: workspaceActions ? workspaceActions.style.display : '',
        paddingBottom: element.style.paddingBottom,
        scrollY: window.scrollY
    };

    try {
        if (filterContainer) filterContainer.style.display = 'none';
        if (btnContainer) btnContainer.style.display = 'none';
        if (workspaceActions) workspaceActions.style.display = 'none';
        window.scrollTo(0, 0);
        element.style.paddingBottom = '100px';
        await waitForMonthlyReportPaint();
        return await html2canvas(element, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#f0f2f5'
        });
    } finally {
        element.style.paddingBottom = previous.paddingBottom;
        if (filterContainer) filterContainer.style.display = previous.filterDisplay || 'flex';
        if (btnContainer) btnContainer.style.display = previous.buttonDisplay || 'flex';
        if (workspaceActions) workspaceActions.style.display = previous.workspaceDisplay;
        window.scrollTo(0, previous.scrollY);
    }
}

function createPdfBlobFromCanvas(canvas) {
    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = window.jspdf;
    const pdfWidth = 595.28;
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
    const pdf = new jsPDF({
        orientation: 'p',
        unit: 'pt',
        format: [pdfWidth, pdfHeight]
    });
    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    return pdf.output('blob');
}

function buildConfiguredTargetMap(globalConfig) {
    const labelToTargetMap = {};
    const targets = globalConfig && globalConfig.targets;
    const prefs = globalConfig && globalConfig.prefs;
    if (prefs) {
        Object.keys(prefs).forEach(secId => {
            const pref = prefs[secId];
            const cleanSecId = secId.startsWith('sla_prefs_') ? secId.substring(10) : secId;
            (pref && Array.isArray(pref.customMetrics) ? pref.customMetrics : []).forEach(rule => {
                const key = `${cleanSecId}_${rule.id}`;
                if (targets && targets[key]) labelToTargetMap[rule.label] = targets[key];
            });
        });
    }
    if (targets) {
        Object.keys(targets).forEach(key => {
            if (key.startsWith('manual_') && targets[key] && targets[key].label) {
                labelToTargetMap[targets[key].label] = targets[key];
            }
        });
    }
    return labelToTargetMap;
}

function buildDailyTargetReferenceHtml(date, dailyData) {
    const latest = dailyData.latest_snapshot || {};
    const targetMonth = parseInt(latest.month, 10) || parseInt(getMonthlyTargetMonth(), 10) || new Date(`${date}T00:00:00`).getMonth() + 1;
    const targetMap = buildConfiguredTargetMap(window._globalConfig || {});
    const metricRowsByLabel = {};
    (latest.metrics || []).forEach(row => {
        const label = row.metric_label || (window.currentLang === 'en' ? 'Unknown metric' : '未知指标');
        if (!metricRowsByLabel[label]) metricRowsByLabel[label] = [];
        metricRowsByLabel[label].push(row);
    });

    let rawSnapshot = {};
    try {
        rawSnapshot = latest.raw_data_json ? JSON.parse(latest.raw_data_json) : {};
    } catch (error) {
        rawSnapshot = {};
    }
    const rawLabels = (rawSnapshot.topMetrics || []).map(item => item && item.label).filter(Boolean);
    const labels = [...new Set([
        ...Object.keys(metricRowsByLabel),
        ...rawLabels,
        ...Object.keys(targetMap)
    ])];
    const groupOrder = new Map((window._metricGroups || []).map((group, index) => [group.name, index]));
    const labelToGroup = {};
    (window._metricGroups || []).forEach(group => {
        (group.metrics || []).forEach(label => { labelToGroup[label] = group.name; });
    });
    labels.sort((a, b) => {
        const groupA = labelToGroup[a] || '';
        const groupB = labelToGroup[b] || '';
        const orderA = groupOrder.has(groupA) ? groupOrder.get(groupA) : 9999;
        const orderB = groupOrder.has(groupB) ? groupOrder.get(groupB) : 9999;
        return orderA - orderB || groupA.localeCompare(groupB) || a.localeCompare(b);
    });

    const renderTargetBadges = (savedRows, targetData) => {
        const savedTargets = savedRows
            .filter(row => row.target_val !== null && row.target_val !== undefined && row.target_val !== '' && row.target_val !== '--')
            .map(row => ({ category: row.cat_name, value: row.target_val }));
        if (savedTargets.length) {
            const uniqueValues = [...new Set(savedTargets.map(item => String(item.value)))];
            if (uniqueValues.length === 1) {
                return `<span class="target-value">${escapeHTML(uniqueValues[0])}</span>`;
            }
            return savedTargets.map(item =>
                `<span class="target-chip"><strong>${escapeHTML(tVal(item.category))}</strong>：${escapeHTML(String(item.value))}</span>`
            ).join('');
        }

        const categoryTargets = targetData && targetData.categoryTargets && targetData.categoryTargets[String(targetMonth)];
        if (categoryTargets && typeof categoryTargets === 'object' && !Array.isArray(categoryTargets)) {
            const entries = Object.entries(categoryTargets).filter(([, value]) => value !== '' && value !== null && value !== undefined);
            if (entries.length) {
                return entries.map(([category, value]) =>
                    `<span class="target-chip config-reference"><strong>${escapeHTML(tVal(category))}</strong>：${escapeHTML(String(value))}</span>`
                ).join('');
            }
        }
        const globalTarget = getEffectiveTargetValue(targetData, targetMonth);
        return globalTarget === undefined
            ? '<span class="no-value">--</span>'
            : `<span class="target-value config-reference">${escapeHTML(String(globalTarget))}</span>`;
    };

    const rowsHtml = labels.map(label => {
        const savedRows = metricRowsByLabel[label] || [];
        const targetData = targetMap[label];
        const failingRows = savedRows.filter(row => Number(row.is_failing) === 1);
        const groupName = labelToGroup[label] || (window.currentLang === 'en' ? 'Ungrouped' : '未分组');
        const condition = targetData && targetData.type === 'lte'
            ? (window.currentLang === 'en' ? '≤ target' : '不高于目标')
            : (window.currentLang === 'en' ? '≥ target' : '不低于目标');
        const savedWeight = savedRows.find(row => row.weight !== null && row.weight !== undefined);
        const weight = savedWeight ? savedWeight.weight : (targetData && targetData.weight !== undefined ? targetData.weight : '--');
        const sourceText = savedRows.some(row => row.target_val !== null && row.target_val !== undefined && row.target_val !== '' && row.target_val !== '--')
            ? (window.currentLang === 'en' ? 'Saved snapshot' : '入库快照')
            : (targetData ? (window.currentLang === 'en' ? 'Current config reference' : '当前配置参考') : '--');
        const statusText = savedRows.length
            ? (failingRows.length
                ? (window.currentLang === 'en' ? `${failingRows.length} failing` : `${failingRows.length} 项不达标`)
                : (window.currentLang === 'en' ? 'All compliant' : '全部达标'))
            : (window.currentLang === 'en' ? 'No saved result' : '无入库结果');
        const actualHtml = savedRows.length
            ? savedRows.map(row => {
                const failing = Number(row.is_failing) === 1;
                const value = row.raw_val ?? row.num_val ?? '--';
                const score = row.earned_score === null || row.earned_score === undefined ? '' : ` · ${window.currentLang === 'en' ? 'Score' : '得分'} ${row.earned_score}`;
                const gap = row.gap === null || row.gap === undefined || row.gap === '' ? '' : ` · ${window.currentLang === 'en' ? 'Gap' : '差距'} ${row.gap}`;
                return `<span class="actual-chip ${failing ? 'is-failing' : 'is-passing'}"><strong>${escapeHTML(tVal(row.cat_name))}</strong>：${escapeHTML(String(value))}${escapeHTML(score)}${escapeHTML(gap)}</span>`;
            }).join('')
            : '<span class="no-value">--</span>';

        return `
            <tr class="${failingRows.length ? 'target-row-failing' : ''}">
                <td>${escapeHTML(tVal(groupName))}</td>
                <td class="metric-name-cell">${escapeHTML(tVal(label))}${isOthersMetricLabel(label) ? othersMetricBadgeHtml() : ''}</td>
                <td>${escapeHTML(String(weight))}</td>
                <td>${escapeHTML(condition)}</td>
                <td>${renderTargetBadges(savedRows, targetData)}</td>
                <td><span class="status-badge ${failingRows.length ? 'status-failing' : (savedRows.length ? 'status-passing' : 'status-empty')}">${escapeHTML(statusText)}</span></td>
                <td>${actualHtml}</td>
                <td>${escapeHTML(sourceText)}</td>
            </tr>
        `;
    }).join('');

    const title = window.currentLang === 'en'
        ? `Month ${targetMonth} Metric Targets & Daily Results`
        : `${targetMonth}月各指标目标与当日达标明细`;
    const note = window.currentLang === 'en'
        ? 'Saved targets, results, scores, and failure states are preferred. “Current config reference” fills display gaps only and does not recalculate or overwrite the saved historical result.'
        : '优先展示入库时保存的目标、结果、得分和达标状态。“当前配置参考”仅用于补充缺失的目标展示，不会重新计算或覆盖历史入库结果。';
    const emptyRow = `<tr><td colspan="8" class="empty-target-row">${window.currentLang === 'en' ? 'No metric target data' : '暂无指标目标数据'}</td></tr>`;

    return `
        <section class="section-card report-export-target-section">
            <div class="section-title">${escapeHTML(title)}</div>
            <div class="target-reference-note">${escapeHTML(note)}</div>
            <div class="target-legend">
                <span><i class="legend-dot passing"></i>${window.currentLang === 'en' ? 'Compliant' : '达标'}</span>
                <span><i class="legend-dot failing"></i>${window.currentLang === 'en' ? 'Non-compliant' : '不达标'}</span>
                <span><i class="legend-dot reference"></i>${window.currentLang === 'en' ? 'Current config reference' : '当前配置参考'}</span>
            </div>
            <div class="target-table-scroll">
                <table class="matrix-table target-reference-table">
                    <thead>
                        <tr>
                            <th>${window.currentLang === 'en' ? 'Group' : '分组'}</th>
                            <th>${window.currentLang === 'en' ? 'Metric' : '指标名称'}</th>
                            <th>${window.currentLang === 'en' ? 'Weight' : '权重'}</th>
                            <th>${window.currentLang === 'en' ? 'Rule' : '达标规则'}</th>
                            <th>${window.currentLang === 'en' ? 'Month Target' : '当月目标'}</th>
                            <th>${window.currentLang === 'en' ? 'Status' : '达标状态'}</th>
                            <th>${window.currentLang === 'en' ? 'Daily Results by Group' : '各客户群当日实测/得分/差距'}</th>
                            <th>${window.currentLang === 'en' ? 'Target Source' : '目标来源'}</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml || emptyRow}</tbody>
                </table>
            </div>
        </section>
    `;
}

function collectMonthlyStandaloneCss() {
    const cssParts = [];
    Array.from(document.styleSheets || []).forEach(sheet => {
        try {
            cssParts.push(Array.from(sheet.cssRules || []).map(rule => rule.cssText).join('\n'));
        } catch (error) {
            // Cross-origin styles cannot be read; the report-specific fallback below keeps the export usable.
        }
    });
    cssParts.push(`
        html { scroll-behavior: smooth; }
        body { margin: 0; background: #f0f2f5; color: #333; }
        .page-container { padding-top: 28px !important; }
        .source-info-wrapper, #date-filter-container, #export-actions, #monthlyWorkspaceActions, #monthlyWorkspaceStatus, #loader, #report-empty-state, #report-error-state { display: none !important; }
        .chart-container { height: auto !important; min-width: 0 !important; padding: 12px; box-sizing: border-box; }
        .standalone-chart-image { display: block; width: 100%; height: auto; }
        .report-export-target-section { page-break-before: always; }
        .target-reference-note { margin: -4px 0 12px; padding: 10px 12px; border-left: 4px solid #0284c7; background: #eff6ff; color: #334155; font-size: 13px; line-height: 1.7; }
        .target-legend { display: flex; flex-wrap: wrap; gap: 16px; margin: 0 0 12px; color: #475569; font-size: 12px; }
        .target-legend span { display: inline-flex; align-items: center; gap: 6px; }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
        .legend-dot.passing { background: #16a34a; }
        .legend-dot.failing { background: #dc2626; }
        .legend-dot.reference { background: #f59e0b; }
        .target-table-scroll { overflow-x: auto; }
        .target-reference-table { min-width: 1180px; font-size: 12px; }
        .target-reference-table th { position: sticky; top: 0; z-index: 1; white-space: nowrap; }
        .target-reference-table td { vertical-align: top; line-height: 1.55; }
        .target-reference-table .metric-name-cell { min-width: 160px; font-weight: 700; color: #0f172a; }
        .target-row-failing > td { background: #fff7f7; border-color: #fecaca; }
        .target-chip, .actual-chip { display: inline-block; margin: 2px 4px 2px 0; padding: 3px 7px; border-radius: 5px; white-space: normal; }
        .target-chip { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
        .target-value { display: inline-block; padding: 3px 8px; border-radius: 5px; background: #eff6ff; color: #1d4ed8; font-weight: 700; }
        .config-reference { background: #fffbeb; border-color: #fde68a; color: #92400e; }
        .actual-chip.is-passing { background: #ecfdf5; border: 1px solid #bbf7d0; color: #166534; }
        .actual-chip.is-failing { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; font-weight: 700; }
        .status-badge { display: inline-block; padding: 3px 8px; border-radius: 999px; font-weight: 700; white-space: nowrap; }
        .status-passing { background: #dcfce7; color: #166534; }
        .status-failing { background: #fee2e2; color: #b91c1c; }
        .status-empty { background: #f1f5f9; color: #64748b; }
        .no-value, .empty-target-row { color: #94a3b8; }
        .empty-target-row { text-align: center !important; padding: 24px !important; }
        .standalone-footer { margin: 18px 0 0; text-align: center; color: #64748b; font-size: 11px; }
        @media print {
            @page { size: A4 landscape; margin: 10mm; }
            body { background: #fff; }
            .page-container { max-width: none !important; padding: 0 !important; }
            .section-card { box-shadow: none !important; break-inside: auto; }
            .target-reference-table { min-width: 0; font-size: 9px; }
            .target-reference-table th { position: static; }
            tr { break-inside: avoid; }
        }
    `);
    return cssParts.join('\n');
}

function replaceStandaloneChartWithImage(clone, chartId) {
    const source = document.getElementById(chartId);
    const target = clone.querySelector(`#${chartId}`);
    if (!source || !target) return;
    let imageUrl = '';
    const chart = window.echarts && window.echarts.getInstanceByDom(source);
    try {
        imageUrl = chart
            ? chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fafafa' })
            : (source.querySelector('canvas') ? source.querySelector('canvas').toDataURL('image/png') : '');
    } catch (error) {
        imageUrl = '';
    }
    if (imageUrl) {
        target.innerHTML = `<img class="standalone-chart-image" src="${imageUrl}" alt="${escapeHTML(chartId)}">`;
    }
}

function createDailyHtmlBlob(date, dailyData) {
    const source = document.querySelector('.page-container');
    if (!source) throw new Error('Report content is not available');
    const clone = source.cloneNode(true);

    clone.querySelectorAll('.source-info-wrapper, #date-filter-container, #export-actions, #monthlyWorkspaceActions, #monthlyWorkspaceStatus, #loader, #report-empty-state, #report-error-state').forEach(node => node.remove());
    const reportContent = clone.querySelector('#report-content');
    if (reportContent) reportContent.style.display = 'block';
    const explanation = clone.querySelector('#monthly-explanation-section');
    const targetReference = buildDailyTargetReferenceHtml(date, dailyData);
    if (explanation) explanation.insertAdjacentHTML('beforebegin', targetReference);
    else if (reportContent) reportContent.insertAdjacentHTML('beforeend', targetReference);

    replaceStandaloneChartWithImage(clone, 'chart-overall');
    replaceStandaloneChartWithImage(clone, 'chart-groups');
    clone.insertAdjacentHTML(
        'beforeend',
        `<div class="standalone-footer">${window.currentLang === 'en' ? 'Generated from the saved Tools Platform daily snapshot' : '基于 Tools Platform 当日入库快照生成'} · ${escapeHTML(date)}</div>`
    );

    const lang = window.currentLang === 'en' ? 'en' : 'zh-CN';
    const title = `${date}_${window.currentLang === 'en' ? 'Daily Report' : '日报'}`;
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHTML(title)}</title>
    <style>${collectMonthlyStandaloneCss()}</style>
</head>
<body>${clone.outerHTML}</body>
</html>`;
    return new Blob(['\uFEFF', html], { type: 'text/html;charset=utf-8' });
}

async function fetchDailyReportData(date) {
    const params = new URLSearchParams({ startDate: date, endDate: date });
    return window.API.get(`/api/db/monthly_report_data?${params.toString()}`);
}

function setDailyExportHeading(date) {
    const title = document.querySelector('.report-header h2');
    if (title) {
        title.innerHTML = `${escapeHTML(t('daily_report_title'))} <span style="font-size:14px;color:#94a3b8;font-weight:normal;margin-left:8px;">${escapeHTML(date)}</span>`;
    }
    const dateRange = document.getElementById('report-date-range');
    if (dateRange) {
        dateRange.innerText = window.currentLang === 'en' ? `Report Date: ${date}` : `日报日期：${date}`;
    }
}

window.exportDailyBundle = async function () {
    const button = document.getElementById('export-daily-bundle-btn');
    const originalButtonHtml = button ? button.innerHTML : '';
    const selectedRange = getMonthlyDateFilters();
    const originalState = {
        trends: currentTrends,
        latest: currentLatest,
        targetMonth: document.getElementById('monthlyTargetMonth')?.value || ''
    };
    let dates = [...new Set((currentTrends || []).map(item => item.date).filter(Boolean))].sort();

    if ((selectedRange.startDate && !selectedRange.endDate) || (!selectedRange.startDate && selectedRange.endDate)) {
        showToast(window.currentLang === 'en' ? 'Please select both start and end dates' : '请选择完整的开始日期和结束日期', 'warn');
        return;
    }
    if (selectedRange.startDate && selectedRange.startDate > selectedRange.endDate) {
        showToast(window.currentLang === 'en' ? 'Start date cannot be after end date' : '开始日期不能晚于结束日期', 'warn');
        return;
    }
    if (!window.JSZip || !window.jspdf || !window.html2canvas) {
        showToast(t('msg_export_daily_fail') + 'export library is not available', 'error');
        return;
    }

    try {
        if (button) button.disabled = true;
        if (selectedRange.startDate && selectedRange.endDate) {
            const selectedData = await window.API.get(
                `/api/db/monthly_report_data?${new URLSearchParams({
                    startDate: selectedRange.startDate,
                    endDate: selectedRange.endDate
                }).toString()}`
            );
            dates = [...new Set((selectedData.trends || []).map(item => item.date).filter(Boolean))].sort();
        }
        if (!dates.length) throw new Error(t('no_data'));

        const zip = new JSZip();
        let exportedCount = 0;

        for (let index = 0; index < dates.length; index++) {
            const date = dates[index];
            const progress = t('msg_export_daily_progress', {
                current: index + 1,
                total: dates.length,
                date
            });
            if (button) button.textContent = progress;
            showToast(progress, 'info');

            const dailyData = await fetchDailyReportData(date);
            if (!dailyData || !dailyData.latest_snapshot || !dailyData.trends || !dailyData.trends.length) continue;

            currentTrends = dailyData.trends;
            currentLatest = dailyData.latest_snapshot;
            const monthSelect = document.getElementById('monthlyTargetMonth');
            const reportMonth = parseInt(dailyData.latest_snapshot.month, 10);
            if (monthSelect && reportMonth >= 1 && reportMonth <= 12) monthSelect.value = String(reportMonth);

            renderAll();
            setDailyExportHeading(date);
            await waitForMonthlyReportPaint();

            const canvas = await captureMonthlyReportCanvas();
            const pdfBlob = createPdfBlobFromCanvas(canvas);
            const htmlBlob = createDailyHtmlBlob(date, dailyData);
            const monthFolder = date.slice(0, 7);
            const dailyBaseName = `${date}_日报`;
            zip.file(`${monthFolder}/${dailyBaseName}.pdf`, pdfBlob);
            zip.file(`${monthFolder}/${dailyBaseName}.html`, htmlBlob);
            exportedCount++;
        }

        if (!exportedCount) throw new Error(t('no_data'));
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        downloadBlob(zipBlob, `日报批量导出_${dates[0]}_至_${dates[dates.length - 1]}.zip`);
        showToast(t('msg_export_daily_success', { count: exportedCount }), 'success');
    } catch (error) {
        console.error('Failed to export daily report bundle:', error);
        showToast(t('msg_export_daily_fail') + error.message, 'error');
    } finally {
        currentTrends = originalState.trends;
        currentLatest = originalState.latest;
        const monthSelect = document.getElementById('monthlyTargetMonth');
        if (monthSelect && originalState.targetMonth) monthSelect.value = originalState.targetMonth;
        if (currentTrends && currentLatest) renderAll();
        if (button) {
            button.disabled = false;
            button.innerHTML = originalButtonHtml;
        }
    }
};

window.exportToImage = async function () {
    try {
        const btnContainer = document.getElementById('export-actions');
        btnContainer.style.display = 'none'; // hide buttons
        showToast(t('msg_exporting_img'), 'info');

        const element = document.querySelector('.page-container');

        const filterContainer = document.getElementById('date-filter-container');
        if (filterContainer) filterContainer.style.display = 'none';

        // Fix for html2canvas truncation: scroll to top before capturing
        const prevScrollY = window.scrollY;
        window.scrollTo(0, 0);

        // Add temporary bottom padding to guarantee whitespace
        const oldPadding = element.style.paddingBottom;
        element.style.paddingBottom = '100px';

        const canvas = await html2canvas(element, {
            scale: 2, // High resolution
            useCORS: true,
            backgroundColor: '#f0f2f5'
        });

        element.style.paddingBottom = oldPadding;
        window.scrollTo(0, prevScrollY);

        if (filterContainer) filterContainer.style.display = 'flex';

        const imgData = canvas.toDataURL('image/jpeg', 0.9);
        const a = document.createElement('a');
        a.href = imgData;

        let dateStr = document.getElementById('latest-snapshot-date').innerText || 'Latest';
        a.download = `Monthly_Report_${dateStr}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        btnContainer.style.display = 'flex';
        showToast(t('msg_export_img_success'), 'success');
    } catch (e) {
        console.error(e);
        document.getElementById('export-actions').style.display = 'flex';
        showToast(t('msg_export_img_fail') + e.message, 'error');
    }
};

window.exportToPDF = async function () {
    try {
        const btnContainer = document.getElementById('export-actions');
        btnContainer.style.display = 'none'; // hide buttons
        showToast(t('msg_exporting_pdf'), 'info');

        const element = document.querySelector('.page-container');

        const filterContainer = document.getElementById('date-filter-container');
        if (filterContainer) filterContainer.style.display = 'none';

        // Fix for html2canvas truncation: scroll to top before capturing
        const prevScrollY = window.scrollY;
        window.scrollTo(0, 0);

        // Add temporary bottom padding to guarantee whitespace
        const oldPadding = element.style.paddingBottom;
        element.style.paddingBottom = '100px';

        const canvas = await html2canvas(element, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#f0f2f5'
        });

        element.style.paddingBottom = oldPadding;
        window.scrollTo(0, prevScrollY);

        if (filterContainer) filterContainer.style.display = 'flex';

        const imgData = canvas.toDataURL('image/jpeg', 0.95);

        // Use jsPDF from UMD
        const { jsPDF } = window.jspdf;

        // Calculate dimensions to fit A4 width (avoiding PDF 14400pt height limit)
        // A4 width in pt is 595.28
        const pdfWidth = 595.28;
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        const pdf = new jsPDF({
            orientation: 'p',
            unit: 'pt',
            format: [pdfWidth, pdfHeight]
        });

        // Add image to cover the entire custom-sized page
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);

        const filenameHelper = window.ReportExportFilenames;
        const targetMonth = getMonthlyTargetMonth();
        const fileName = filenameHelper
            ? filenameHelper.buildMonthlyPdfFilename(targetMonth, getMonthlyExportReferenceDate())
            : 'Egypt Maintenance Operation Monthly Report.pdf';
        pdf.save(fileName);

        btnContainer.style.display = 'flex';
        showToast(t('msg_export_pdf_success'), 'success');
    } catch (e) {
        console.error(e);
        document.getElementById('export-actions').style.display = 'flex';
        showToast(t('msg_export_pdf_fail') + e.message, 'error');
    }
};

window.MonthlyReportBridge = {
    getState() {
        return {
            trends: currentTrends,
            latest: currentLatest,
            categories: window._categories,
            globalConfig: window._globalConfig,
            metricGroups: window._metricGroups,
            manualAdjustItems: window._manualAdjustItems,
            networkMappings: window._monthlyNetworkMappings,
            targetMonth: getMonthlyTargetMonth(),
            startDate: document.getElementById('filter-start-date')?.value || '',
            endDate: document.getElementById('filter-end-date')?.value || ''
        };
    },
    applyState(state) {
        currentTrends = state.trends;
        currentLatest = state.latest;
        window._categories = state.categories || [];
        window._globalConfig = state.globalConfig || { targets: {}, prefs: {} };
        window._metricGroups = state.metricGroups || [];
        window._manualAdjustItems = state.manualAdjustItems || [];
        window._monthlyNetworkMappings = state.networkMappings || {};
        const start = document.getElementById('filter-start-date');
        const end = document.getElementById('filter-end-date');
        const month = document.getElementById('monthlyTargetMonth');
        if (start) start.value = state.startDate || '';
        if (end) end.value = state.endDate || '';
        if (month && state.targetMonth) month.value = String(state.targetMonth);
        document.getElementById('loader').style.display = 'none';
        document.getElementById('report-empty-state').style.display = 'none';
        document.getElementById('report-error-state').style.display = 'none';
        document.getElementById('report-content').style.display = 'block';
        document.getElementById('export-actions').style.display = 'flex';
        renderAll();
    },
    render: renderAll
};
