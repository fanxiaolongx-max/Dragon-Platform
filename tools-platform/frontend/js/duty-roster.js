(function () {
    'use strict';

    // 常用人员列表（用于快捷标签和补全）
    const COMMON_PERSONNEL = [
        'xuxiaotian', 'Pu Hai', 'Hou Xiaolei', 'Zheng chuang', 'zhangxiongfei',
        'hejinyao', 'Zhang Xuejun', 'Zhang Jun', 'Ma lin', 'gaolei',
        'Li ning', 'Wang lichao', 'Zhang haitao', 'yangxiang', 'zengyueming',
        'Xu Wei', 'Chenyin', 'Liu jiang', 'Xu mingrui', 'Zhukang',
        'Tang jiapeng', 'wangxiaoshuan', 'Zhao shuangyi', 'luojian', 'Yuan xichen',
        'haorunjun', 'Huang Leisheng', 'libaokang', 'Liu Shaokui', 'Zhao zhanxi'
    ];

    // 全局双语词典
    const I18N_DICT = {
        'zh-CN': {
            'duty.page_title': '夜间运维值班表编辑器 - Tools Platform',
            'duty.toolbar_title': '🌙 夜间运维值班表',
            'duty.target_month': '目标月份',
            'duty.prev_month': '上个月',
            'duty.next_month': '下个月',
            'duty.annual_total_label': '年度累计总人次:',
            'duty.annual_total_title': '在表尾展示的年度或累计人次基数',
            'duty.btn_import_prev': '⏮️ 引入上月',
            'duty.btn_import_prev_title': '一键引入上月或历史值班表名单快速填写本月',
            'duty.btn_copy_table': '📋 复制表格',
            'duty.btn_copy_table_title': '一键复制当前值班表到剪贴板（TSV / 邮件友好格式）',
            'duty.btn_sample': '✨ 载入示例',
            'duty.btn_sample_title': '载入参考图示的标准排班人员名单',
            'duty.btn_clear': '🧹 清空当月',
            'duty.btn_clear_title': '清空当月所有排班输入',
            'duty.btn_export_csv': '📥 导出 CSV',
            'duty.btn_export_csv_title': '导出当前值班表为 CSV 表格',
            'duty.btn_open_designer': '📑 月报设计器',
            'duty.btn_open_designer_title': '前往护网与网络安全月报编辑器调用此表',
            'duty.btn_save': '💾 保存到服务器',
            'duty.btn_save_title': '保存到服务器并同步至月报编辑器数据资料库',
            'duty.status_ready': '已就绪',
            'duty.status_dirty': '有未保存修改',
            'duty.status_saved': '已保存到服务器',
            'duty.status_loading': '加载中...',
            'duty.status_saving': '保存中...',
            'duty.status_importing': '引入中...',
            'duty.banner_rule_title': '埃及周末排班规则：',
            'duty.banner_rule_desc': '纵轴排班从 <strong>周日</strong> 开始，以 <strong>周五</strong> 与 <strong>周六</strong> 结尾。在埃及，法定工作日为周日~周四，<strong>周五、周六为法定周末</strong>（表中已标金黄色高亮）。表头根据目标月份自动按周划分（周日~周六分段）。保存后可在<strong>月报设计器</strong>的<strong>“指标与关键数据表”</strong>中直接引用，并随报告月份自动调整周日期！',
            'duty.sheet_main_title': '夜间运维值班表',
            'duty.sheet_dept': '埃及代表处交付与服务运维支持中心',
            'duty.col_period': '时间段',
            'duty.weekend_badge': '',
            'duty.out_of_month': '非当月',
            'duty.summary_prefix': '累计总计:',
            'duty.summary_suffix': '当月夜间运维值班',
            'duty.person_times': '人次',
            'duty.quick_person_title': '👥 常用值班人员快捷点击填入 / 复制',
            'duty.quick_person_desc': '点击下方人员姓名：若当前有单元格获得焦点则直接填入，否则自动复制到剪贴板。',
            'duty.stats_title': '📊 当月值班频次统计 (TOP 10)',
            'duty.stats_empty': '暂无排班数据',
            'duty.stats_times': '次',
            'duty.toast_copy_success': '✅ 已成功复制值班表到剪贴板（TSV / 邮件格式）！可直接粘贴至 Excel、WPS、邮件或聊天窗口。',
            'duty.toast_copy_fail': '复制到剪贴板失败，请手动选择复制。',
            'duty.toast_save_success': '✅ 值班表已成功保存到服务器，并已同步至月报编辑器的“指标与关键数据表”！',
            'duty.toast_save_fail': '保存失败: ',
            'duty.toast_load_fail': '加载值班表失败: ',
            'duty.toast_sample_loaded': '已载入参考示例数据，请点击“保存到服务器”持久化。',
            'duty.toast_clear_confirm': '确定清空当月所有排班人员吗？',
            'duty.toast_person_copied': '已复制 "{name}"，可直接点击单元格粘贴'
        },
        'en-US': {
            'duty.page_title': 'Night Operation Duty Roster Editor - Tools Platform',
            'duty.toolbar_title': '🌙 Night Operation Duty Roster',
            'duty.target_month': 'Target Month',
            'duty.prev_month': 'Previous Month',
            'duty.next_month': 'Next Month',
            'duty.annual_total_label': 'Annual Total Baseline:',
            'duty.annual_total_title': 'Annual or cumulative base person-times displayed in footer',
            'duty.btn_import_prev': '⏮️ Import Last Month',
            'duty.btn_import_prev_title': 'Import duty roster from last month or history to populate this month',
            'duty.btn_copy_table': '📋 Copy Table',
            'duty.btn_copy_table_title': 'Copy current roster to clipboard (TSV / spreadsheet friendly)',
            'duty.btn_sample': '✨ Load Sample',
            'duty.btn_sample_title': 'Load reference standard duty roster',
            'duty.btn_clear': '🧹 Clear Month',
            'duty.btn_clear_title': 'Clear all roster inputs for this month',
            'duty.btn_export_csv': '📥 Export CSV',
            'duty.btn_export_csv_title': 'Export current duty roster as CSV file',
            'duty.btn_open_designer': '📑 Monthly Designer',
            'duty.btn_open_designer_title': 'Open Monthly Security Report Designer to reference this roster',
            'duty.btn_save': '💾 Save to Server',
            'duty.btn_save_title': 'Save to server and sync to Monthly Designer source library',
            'duty.status_ready': 'Ready',
            'duty.status_dirty': 'Unsaved Changes',
            'duty.status_saved': 'Saved to Server',
            'duty.status_loading': 'Loading...',
            'duty.status_saving': 'Saving...',
            'duty.status_importing': 'Importing...',
            'duty.banner_rule_title': 'Egypt Weekend Scheduling Rule:',
            'duty.banner_rule_desc': 'The vertical axis starts on <strong>Sunday</strong> and ends with <strong>Friday</strong> & <strong>Saturday</strong>. In Egypt, Sunday through Thursday are official working days, and <strong>Friday & Saturday are the official weekend</strong> (highlighted in gold in the table). Columns are automatically divided by week according to the target month. Once saved, it can be directly referenced in the <strong>Monthly Designer</strong> under <strong>"Metrics & Priority Tables"</strong>!',
            'duty.sheet_main_title': 'Night Operation Duty Roster',
            'duty.sheet_dept': 'Egypt Rep Office Delivery & Service O&M Support Center',
            'duty.col_period': 'Period',
            'duty.weekend_badge': '',
            'duty.out_of_month': 'Out of Month',
            'duty.summary_prefix': 'In Total:',
            'duty.summary_suffix': 'for Night Operation On-duty',
            'duty.person_times': '*Person-times',
            'duty.quick_person_title': '👥 Common Personnel (Click to fill / copy)',
            'duty.quick_person_desc': 'Click name below: fills active focused cell, or copies to clipboard if none focused.',
            'duty.stats_title': '📊 Monthly On-duty Frequency (TOP 10)',
            'duty.stats_empty': 'No duty data yet',
            'duty.stats_times': 'times',
            'duty.toast_copy_success': '✅ Duty roster copied to clipboard (TSV & HTML)! Ready to paste into Excel, email, or chat.',
            'duty.toast_copy_fail': 'Failed to copy to clipboard, please copy manually.',
            'duty.toast_save_success': '✅ Duty roster saved to server and synced to Monthly Designer source library!',
            'duty.toast_save_fail': 'Save failed: ',
            'duty.toast_load_fail': 'Failed to load roster: ',
            'duty.toast_sample_loaded': 'Sample roster loaded. Click "Save to Server" to persist.',
            'duty.toast_clear_confirm': 'Are you sure you want to clear all roster inputs for this month?',
            'duty.toast_person_copied': 'Copied "{name}". Click any cell to paste.'
        }
    };

    const MONTH_NAMES_EN = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const STORAGE_LAST_MONTH_KEY = 'duty_roster_last_edited_month';

    function getCalendarCurrentMonth() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    }

    let currentMonth = getCalendarCurrentMonth();
    let currentRoster = null;
    let cellsData = {};
    let gridData = {};
    let isDirty = false;

    // 获取当前语言与中英文判断
    function getCurrentLang() {
        const lang = (window.ToolsI18n && typeof window.ToolsI18n.getLanguage === 'function')
            ? window.ToolsI18n.getLanguage()
            : (localStorage.getItem('tools_lang') || localStorage.getItem('tools_language') || 'zh-CN');
        return String(lang || 'zh-CN');
    }

    function isChinese() {
        return getCurrentLang().toLowerCase().startsWith('zh');
    }

    function t(key, fallback = '', params = {}) {
        const lang = getCurrentLang();
        let text = '';
        if (window.ToolsI18n && typeof window.ToolsI18n.t === 'function') {
            const translated = window.ToolsI18n.t(key, params, lang);
            if (translated && translated !== key) text = translated;
        }
        if (!text) {
            text = I18N_DICT[lang]?.[key] ?? I18N_DICT['zh-CN']?.[key] ?? fallback ?? key;
            Object.entries(params).forEach(([k, v]) => {
                text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
            });
        }
        return text;
    }

    // API 请求封装，自动携带认证 Token
    function getHeaders(extra = {}) {
        const headers = { 'Content-Type': 'application/json', ...extra };
        const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('tools_token') : null;
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }

    async function apiFetch(url, options = {}) {
        const opts = {
            ...options,
            headers: getHeaders(options.headers || {})
        };
        return fetch(url, opts);
    }

    // 客户端后备：计算埃及周历分段（周日开始，周五周六为周末）
    function calculateEgyptWeeksClientSide(year, month) {
        const firstDay = new Date(Date.UTC(year, month - 1, 1));
        const lastDay = new Date(Date.UTC(year, month, 0));
        const startDayOfWeek = firstDay.getUTCDay(); // 0(Sun) - 6(Sat)
        const firstSunday = new Date(Date.UTC(year, month - 1, 1 - startDayOfWeek));

        const weeks = [];
        let currentSunday = new Date(firstSunday.getTime());
        const formatDate = d => `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;

        while (currentSunday <= lastDay) {
            const currentSaturday = new Date(currentSunday.getTime() + 6 * 86400000);
            const key = `${formatDate(currentSunday)}-${formatDate(currentSaturday)}`;
            const days = [];
            for (let i = 0; i < 7; i++) {
                const dayDate = new Date(currentSunday.getTime() + i * 86400000);
                const inMonth = (dayDate.getUTCMonth() + 1 === month) && (dayDate.getUTCFullYear() === year);
                days.push({
                    dateStr: dayDate.toISOString().slice(0, 10),
                    month: dayDate.getUTCMonth() + 1,
                    day: dayDate.getUTCDate(),
                    year: dayDate.getUTCFullYear(),
                    weekdayIndex: i,
                    dayLabel: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i],
                    isWeekend: i === 5 || i === 6,
                    inTargetMonth: inMonth
                });
            }
            weeks.push({
                key,
                label: key,
                start: currentSunday.toISOString().slice(0, 10),
                end: currentSaturday.toISOString().slice(0, 10),
                days
            });
            currentSunday = new Date(currentSunday.getTime() + 7 * 86400000);
        }
        return weeks;
    }

    function createEmptyRosterClientSide(monthStr) {
        const [year, month] = monthStr.split('-').map(Number);
        const weeks = calculateEgyptWeeksClientSide(year, month);
        return {
            month: monthStr,
            title: '夜间运维值班表',
            weeks,
            cells: {},
            grid: {},
            totalCount: 353,
            monthlyCount: 0
        };
    }

    // 后备参考轮班名单（即使离线或未保存历史也可一键排班）
    const SAMPLE_GRID_FALLBACK = {
        Sun: ['libaokang', 'Liu Shaokui', 'Zhao shuangyi', 'Zhao zhanxi', 'libaokang', 'Liu Shaokui'],
        Mon: ['xuxiaotian', 'Pu Hai', 'Hou Xiaolei', 'Zheng chuang', 'zhangxiongfei', 'Pu Hai'],
        Tue: ['hejinyao', 'Zhang Xuejun', 'Zhang Jun', 'Ma lin', 'hejinyao', 'Zhang Xuejun'],
        Wed: ['gaolei', 'Li ning', 'Wang lichao', 'Zhang haitao', 'yangxiang', 'Li ning'],
        Thu: ['zengyueming', 'Xu Wei', 'Chenyin', 'Liu jiang', 'gaolei', 'Xu Wei'],
        Fri: ['Xu mingrui', 'Zhukang', 'Tang jiapeng', 'wangxiaoshuan', 'zengyueming', 'Zhukang'],
        Sat: ['Zhao shuangyi', 'luojian', 'Yuan xichen', 'haorunjun', 'Huang Leisheng', 'luojian']
    };

    // 立即注册词典到全局 i18n
    if (window.ToolsI18n && typeof window.ToolsI18n.register === 'function') {
        window.ToolsI18n.register('duty_roster', I18N_DICT);
    }

    // DOM 元素引用
    let monthInput, prevMonthBtn, nextMonthBtn, annualTotalInput;
    let importPrevBtn, copyTableBtn, sampleBtn, clearBtn, exportCsvBtn, openDesignerBtn, saveBtn;
    let statusMsg, rosterTable, monthTitleDisplay, personTagsContainer, statsList;

    function queryDOMElements() {
        monthInput = document.getElementById('targetMonth');
        prevMonthBtn = document.getElementById('prevMonthBtn');
        nextMonthBtn = document.getElementById('nextMonthBtn');
        annualTotalInput = document.getElementById('annualTotalInput');
        importPrevBtn = document.getElementById('importPrevBtn');
        copyTableBtn = document.getElementById('copyTableBtn');
        sampleBtn = document.getElementById('sampleBtn');
        clearBtn = document.getElementById('clearBtn');
        exportCsvBtn = document.getElementById('exportCsvBtn');
        openDesignerBtn = document.getElementById('openDesignerBtn');
        saveBtn = document.getElementById('saveBtn');
        statusMsg = document.getElementById('statusMsg');
        rosterTable = document.getElementById('rosterTable');
        monthTitleDisplay = document.getElementById('monthTitleDisplay');
        personTagsContainer = document.getElementById('personTagsContainer');
        statsList = document.getElementById('statsList');
    }

    // 解析页面默认呈现月份（优先读取 URL 参数；次之当月已保存；次之最近编辑月份；最后当前自然月）
    async function resolveDefaultMonth() {
        // 1. 优先读取 URL 参数 ?month=YYYY-MM
        const urlParams = new URLSearchParams(window.location.search);
        const paramMonth = urlParams.get('month');
        if (paramMonth && /^\d{4}-(0?[1-9]|1[0-2])$/.test(paramMonth)) {
            const m = paramMonth.match(/^(\d{4})-(0?[1-9]|1[0-2])$/);
            return `${m[1]}-${String(m[2]).padStart(2, '0')}`;
        }

        const calendarMonth = getCalendarCurrentMonth();
        const localLastMonth = localStorage.getItem(STORAGE_LAST_MONTH_KEY);

        // 2. 异步获取服务端已保存/最近编辑的值班表月份
        try {
            const res = await apiFetch('/api/duty-roster/recent');
            if (res.ok) {
                const data = await res.json();
                const list = Array.isArray(data.list) ? data.list : [];

                // 如果当前自然月已在服务端保存过排班，优先呈现当月
                const hasCurrentMonthSaved = list.some(item => item.month === calendarMonth);
                if (hasCurrentMonthSaved) {
                    return calendarMonth;
                }

                // 如果本地最近编辑过的有效月份在服务端的已保存列表中，使用本地记录
                if (localLastMonth && /^\d{4}-(0?[1-9]|1[0-2])$/.test(localLastMonth)) {
                    if (list.some(item => item.month === localLastMonth)) {
                        return localLastMonth;
                    }
                }

                // 如果服务端有最近编辑保存过的月份，使用该最近编辑月份
                if (data.recentMonth && /^\d{4}-(0?[1-9]|1[0-2])$/.test(data.recentMonth)) {
                    return data.recentMonth;
                }
            }
        } catch (e) {
            console.warn('Fetch recent month failed:', e);
        }

        // 3. 服务端不可用或无记录时回退：本地最近编辑月份 -> 自然月当月
        if (localLastMonth && /^\d{4}-(0?[1-9]|1[0-2])$/.test(localLastMonth)) {
            return localLastMonth;
        }

        return calendarMonth;
    }

    // 初始化页面
    async function init() {
        queryDOMElements();

        // 再次确保注册词典
        if (window.ToolsI18n && typeof window.ToolsI18n.register === 'function') {
            window.ToolsI18n.register('duty_roster', I18N_DICT);
        }

        // 自动解析呈现当月或最近编辑的月份
        currentMonth = await resolveDefaultMonth();
        if (monthInput) monthInput.value = currentMonth;
        try { localStorage.setItem(STORAGE_LAST_MONTH_KEY, currentMonth); } catch (_) {}

        bindEvents();
        updateLanguageUI();
        renderPersonnelTags();
        await loadRoster(currentMonth);
    }

    function bindEvents() {
        if (monthInput) {
            monthInput.addEventListener('change', async () => {
                if (monthInput.value && monthInput.value !== currentMonth) {
                    currentMonth = monthInput.value;
                    try { localStorage.setItem(STORAGE_LAST_MONTH_KEY, currentMonth); } catch (_) {}
                    await loadRoster(currentMonth);
                }
            });
        }

        if (prevMonthBtn) {
            prevMonthBtn.addEventListener('click', async () => {
                shiftMonth(-1);
            });
        }

        if (nextMonthBtn) {
            nextMonthBtn.addEventListener('click', async () => {
                shiftMonth(1);
            });
        }

        if (annualTotalInput) {
            annualTotalInput.addEventListener('input', () => {
                updateSummaryDisplay();
                markDirty();
            });
        }

        if (importPrevBtn) importPrevBtn.addEventListener('click', importPreviousMonthRoster);
        if (copyTableBtn) copyTableBtn.addEventListener('click', copyTableToClipboard);
        if (saveBtn) saveBtn.addEventListener('click', saveRoster);
        if (sampleBtn) sampleBtn.addEventListener('click', loadSample);
        if (clearBtn) clearBtn.addEventListener('click', clearCurrentRoster);
        if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportCsv);
        if (openDesignerBtn) {
            openDesignerBtn.addEventListener('click', () => {
                window.location.href = '/pages/monthly-designer.html';
            });
        }

        // 监听全局语言变更事件（来自顶栏语言切换）
        const onLangChange = () => {
            if (window.ToolsI18n && typeof window.ToolsI18n.register === 'function') {
                window.ToolsI18n.register('duty_roster', I18N_DICT);
            }
            updateLanguageUI();
            if (currentRoster) {
                renderTable();
                updateStats();
            }
        };

        window.addEventListener('tools:languagechange', onLangChange);
        window.addEventListener('languageChanged', onLangChange);
        window.addEventListener('storage', event => {
            if (event.key === 'tools_lang' || event.key === 'tools_language') {
                onLangChange();
            }
        });

        window.addEventListener('beforeunload', event => {
            if (isDirty) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
    }

    function updateLanguageUI() {
        if (window.ToolsI18n && typeof window.ToolsI18n.apply === 'function') {
            window.ToolsI18n.apply(document);
        }
        const isZh = isChinese();
        document.title = t('duty.page_title', isZh ? '夜间运维值班表编辑器 - Tools Platform' : 'Night Operation Duty Roster Editor - Tools Platform');
        updateMonthTitleDisplay();
        updateStatusBadge();
    }

    function updateMonthTitleDisplay() {
        if (!monthTitleDisplay) return;
        const [year, month] = currentMonth.split('-').map(Number);
        if (isChinese()) {
            monthTitleDisplay.textContent = `${year}年${String(month).padStart(2, '0')}月`;
        } else {
            const mName = MONTH_NAMES_EN[month - 1] || currentMonth;
            monthTitleDisplay.textContent = `${mName} ${year}`;
        }
    }

    function shiftMonth(offset) {
        const [y, m] = currentMonth.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1 + offset, 1));
        const newY = date.getUTCFullYear();
        const newM = String(date.getUTCMonth() + 1).padStart(2, '0');
        currentMonth = `${newY}-${newM}`;
        if (monthInput) monthInput.value = currentMonth;
        try { localStorage.setItem(STORAGE_LAST_MONTH_KEY, currentMonth); } catch (_) {}
        loadRoster(currentMonth);
    }

    function getPreviousMonth(monthStr) {
        const [y, m] = monthStr.split('-').map(Number);
        const prevDate = new Date(Date.UTC(y, m - 2, 1));
        const prevY = prevDate.getUTCFullYear();
        const prevM = String(prevDate.getUTCMonth() + 1).padStart(2, '0');
        return `${prevY}-${prevM}`;
    }

    function updateStatusBadge() {
        if (!statusMsg) return;
        if (isDirty) {
            statusMsg.textContent = t('duty.status_dirty', isChinese() ? '有未保存修改' : 'Unsaved Changes');
            statusMsg.className = 'status-badge';
            statusMsg.style.borderColor = '#f59e0b';
            statusMsg.style.color = '#b45309';
            statusMsg.style.background = '#fef3c7';
        } else {
            statusMsg.textContent = t('duty.status_saved', isChinese() ? '已保存到服务器' : 'Saved to Server');
            statusMsg.className = 'status-badge';
            statusMsg.style.borderColor = '#a7f3d0';
            statusMsg.style.color = '#065f46';
            statusMsg.style.background = '#ecfdf5';
        }
    }

    function markDirty() {
        isDirty = true;
        updateStatusBadge();
    }

    function markClean() {
        isDirty = false;
        updateStatusBadge();
    }

    // 从服务端加载值班表
    async function loadRoster(month) {
        try {
            if (statusMsg) statusMsg.textContent = t('duty.status_loading', isChinese() ? '加载中...' : 'Loading...');
            const res = await apiFetch(`/api/duty-roster?month=${encodeURIComponent(month)}`);
            if (!res.ok) throw new Error('Failed to load roster (HTTP ' + res.status + ')');
            const data = await res.json();
            currentRoster = data;
            cellsData = data.cells || {};
            gridData = data.grid || {};
            if (data.totalCount && annualTotalInput) {
                annualTotalInput.value = data.totalCount;
            }
            renderTable();
            markClean();
        } catch (err) {
            console.error('Load roster failed', err);
            // 本地生成空表兜底渲染，确保界面结构与埃及周立即可见
            if (!currentRoster || currentRoster.month !== month) {
                currentRoster = createEmptyRosterClientSide(month);
                cellsData = {};
                gridData = {};
                renderTable();
            }
            markDirty();
            const msg = t('duty.toast_load_fail', isChinese() ? '加载值班表失败: ' : 'Failed to load roster: ') + err.message;
            if (window.showToast) window.showToast(msg, 'error');
        }
    }

    // 载入预设示例数据
    async function loadSample() {
        try {
            if (statusMsg) statusMsg.textContent = t('duty.status_loading', isChinese() ? '载入示例中...' : 'Loading sample...');
            let data = null;
            try {
                const res = await apiFetch(`/api/duty-roster/sample?month=${encodeURIComponent(currentMonth)}`);
                if (res.ok) data = await res.json();
            } catch (netErr) {
                console.warn('Network sample fetch failed, using built-in fallback:', netErr);
            }

            if (!data) {
                // 使用客户端内置的示例生成器
                if (!currentRoster || !currentRoster.weeks) {
                    currentRoster = createEmptyRosterClientSide(currentMonth);
                }
                const sampleGrid = {};
                const sampleCells = {};
                const weekdaysMeta = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                currentRoster.weeks.forEach((w, wIdx) => {
                    sampleGrid[w.key] = {};
                    w.days.forEach(d => {
                        const dayKey = weekdaysMeta[d.weekdayIndex];
                        const list = SAMPLE_GRID_FALLBACK[dayKey] || [];
                        const name = list[wIdx % list.length] || '';
                        sampleGrid[w.key][dayKey] = name;
                        sampleCells[d.dateStr] = name;
                    });
                });
                data = {
                    month: currentMonth,
                    title: '夜间运维值班表',
                    weeks: currentRoster.weeks,
                    cells: sampleCells,
                    grid: sampleGrid,
                    totalCount: 353
                };
            }

            currentRoster = data;
            cellsData = data.cells || {};
            gridData = data.grid || {};
            if (data.totalCount && annualTotalInput) {
                annualTotalInput.value = data.totalCount;
            }
            renderTable();
            markDirty();
            if (window.showToast) {
                window.showToast(t('duty.toast_sample_loaded', isChinese() ? '已载入参考示例数据，请点击“保存到服务器”持久化' : 'Sample loaded. Click Save to persist.'), 'info');
            }
        } catch (err) {
            console.error('Load sample failed', err);
            if (window.showToast) window.showToast('Load sample failed: ' + err.message, 'error');
        }
    }

    // 清空当月
    function clearCurrentRoster() {
        if (!confirm(t('duty.toast_clear_confirm', isChinese() ? '确定清空当月所有排班人员吗？' : 'Clear all shifts for this month?'))) return;
        cellsData = {};
        gridData = {};
        renderTable();
        markDirty();
    }

    // 一键引入上月值班表，快速填写本月值班人
    async function importPreviousMonthRoster() {
        if (!currentRoster || !currentRoster.weeks) {
            currentRoster = createEmptyRosterClientSide(currentMonth);
        }
        const isZh = isChinese();
        const prevMonth = getPreviousMonth(currentMonth);

        try {
            if (importPrevBtn) importPrevBtn.disabled = true;
            if (statusMsg) statusMsg.textContent = isZh ? '正在引入排班名单...' : 'Importing roster...';

            let rosterToImport = null;
            let sourceLabel = '';

            // 1. 尝试从上一个月 (prevMonth) 获取排班
            try {
                const res = await apiFetch(`/api/duty-roster?month=${encodeURIComponent(prevMonth)}`);
                if (res.ok) {
                    const data = await res.json();
                    const hasData = (data.weeks || []).some(w => {
                        return (w.days || []).some(d => {
                            const dayKey = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekdayIndex];
                            return Boolean((data.cells?.[d.dateStr] || data.grid?.[w.key]?.[dayKey] || '').trim());
                        });
                    });
                    if (hasData) {
                        rosterToImport = data;
                        sourceLabel = isZh ? `上月（${prevMonth}）` : `last month (${prevMonth})`;
                    }
                }
            } catch (e) {
                console.warn('Fetch prev month failed:', e);
            }

            // 2. 若上月无历史排班，尝试从系统已保存的其他最近月份提取
            if (!rosterToImport) {
                try {
                    const listRes = await apiFetch('/api/duty-roster/list');
                    if (listRes.ok) {
                        const list = await listRes.json();
                        const otherMonths = (Array.isArray(list) ? list : []).filter(item => item.month && item.month !== currentMonth);
                        if (otherMonths.length > 0) {
                            const recentMonth = otherMonths[0].month;
                            const altRes = await apiFetch(`/api/duty-roster?month=${encodeURIComponent(recentMonth)}`);
                            if (altRes.ok) {
                                const altData = await altRes.json();
                                rosterToImport = altData;
                                sourceLabel = isZh ? `历史月份（${recentMonth}）` : `saved month (${recentMonth})`;
                            }
                        }
                    }
                } catch (e) {
                    console.warn('Fetch roster list failed:', e);
                }
            }

            // 3. 若数据库中尚无历史存档，自动请求标准轮班示范人员名单
            if (!rosterToImport) {
                try {
                    const sampleRes = await apiFetch(`/api/duty-roster/sample?month=${encodeURIComponent(currentMonth)}`);
                    if (sampleRes.ok) {
                        rosterToImport = await sampleRes.json();
                        sourceLabel = isZh ? '标准轮班示范库' : 'standard rotating roster';
                    }
                } catch (e) {
                    console.warn('Fetch sample failed:', e);
                }
            }

            // 4. 若接口未返回，使用自包含客户端后备标准轮班示范库
            if (!rosterToImport) {
                const fallbackGrid = {};
                const weekdaysMeta = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                currentRoster.weeks.forEach((w, wIdx) => {
                    fallbackGrid[w.key] = {};
                    weekdaysMeta.forEach(dayKey => {
                        const list = SAMPLE_GRID_FALLBACK[dayKey] || [];
                        fallbackGrid[w.key][dayKey] = list[wIdx % list.length] || '';
                    });
                });
                rosterToImport = {
                    weeks: currentRoster.weeks,
                    grid: fallbackGrid,
                    cells: {}
                };
                sourceLabel = isZh ? '标准轮班示范库' : 'standard rotating roster';
            }

            // 4. 将源名单按周和星期几智能映射并填充到当月
            const weekdaysMeta = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const sourceWeeks = rosterToImport.weeks || [];
            const sourceGrid = rosterToImport.grid || {};
            const sourceCells = rosterToImport.cells || {};
            const sourceOrdered = [];

            sourceWeeks.forEach(w => {
                w.days.forEach(d => {
                    const dayKey = weekdaysMeta[d.weekdayIndex];
                    const val = (sourceCells[d.dateStr] ?? sourceGrid[w.key]?.[dayKey] ?? '').trim();
                    if (val) sourceOrdered.push(val);
                });
            });

            let filledCount = 0;
            let cycleIdx = 0;
            const newCells = {};
            const newGrid = {};

            currentRoster.weeks.forEach((w, wIdx) => {
                newGrid[w.key] = {};
                w.days.forEach(d => {
                    const dayKey = weekdaysMeta[d.weekdayIndex];
                    let val = '';

                    // 优先按相同周次与星期几对齐
                    if (sourceWeeks.length > 0) {
                        const mappedWeek = sourceWeeks[wIdx % sourceWeeks.length];
                        val = sourceGrid[mappedWeek.key]?.[dayKey] || '';
                    }

                    // 超出周次或空缺单元格，循环复用有序名单
                    if (!val && sourceOrdered.length > 0) {
                        val = sourceOrdered[cycleIdx % sourceOrdered.length];
                        cycleIdx++;
                    }

                    if (val) {
                        val = String(val).trim();
                        newCells[d.dateStr] = val;
                        newGrid[w.key][dayKey] = val;
                        if (d.inTargetMonth) filledCount++;
                    }
                });
            });

            cellsData = newCells;
            gridData = newGrid;
            renderTable();
            markDirty();

            const toastMsg = isZh
                ? `✅ 已成功从${sourceLabel}引入排班，已快速填入当月 ${filledCount} 个班次！`
                : `✅ Successfully imported roster from ${sourceLabel}, filled ${filledCount} shifts!`;

            if (window.showToast) {
                window.showToast(toastMsg, 'success');
            } else {
                alert(toastMsg);
            }

        } catch (err) {
            console.error('Import roster failed', err);
            const failMsg = (isZh ? '引入排班失败: ' : 'Failed to import roster: ') + err.message;
            if (window.showToast) window.showToast(failMsg, 'error');
            else alert(failMsg);
            updateStatusBadge();
        } finally {
            if (importPrevBtn) importPrevBtn.disabled = false;
        }
    }

    // 一键复制当前值班表到剪贴板（TSV 与富文本 HTML 双格式）
    async function copyTableToClipboard() {
        if (!currentRoster || !currentRoster.weeks) return;
        const isZh = isChinese();
        const weeks = currentRoster.weeks;
        const weekdaysMeta = [
            { key: 'Sun', zh: '周日', en: 'Sun', isWeekend: false },
            { key: 'Mon', zh: '周一', en: 'Mon', isWeekend: false },
            { key: 'Tue', zh: '周二', en: 'Tue', isWeekend: false },
            { key: 'Wed', zh: '周三', en: 'Wed', isWeekend: false },
            { key: 'Thu', zh: '周四', en: 'Thu', isWeekend: false },
            { key: 'Fri', zh: '周五', en: 'Fri', isWeekend: true },
            { key: 'Sat', zh: '周六', en: 'Sat', isWeekend: true }
        ];

        const periodLabel = isZh ? '时间段' : 'Period';
        const totalCount = Number(annualTotalInput?.value || 353);
        const monthlyCount = calculateMonthlyPersonTimes();
        const summaryText = isZh
            ? `累计总计: ${totalCount}，当月夜间运维值班 ${monthlyCount}*人次`
            : `In Total: ${totalCount}, ${monthlyCount}*Person-times for Night Operation On-duty`;

        // 1. 构建 TSV 纯文本格式（在 Excel / WPS 中直接粘贴成完美分列表格）
        const tsvHeaders = [periodLabel, ...weeks.map(w => w.key)].join('\t');
        const tsvRows = weekdaysMeta.map(wd => {
            const rowLabel = isZh ? wd.zh : wd.en;
            const vals = weeks.map(w => {
                const dayIdx = weekdaysMeta.findIndex(x => x.key === wd.key);
                const dayMeta = w.days[dayIdx];
                const val = cellsData[dayMeta.dateStr] ?? gridData[w.key]?.[wd.key] ?? '';
                return String(val).replace(/[\t\r\n]/g, ' ').trim();
            });
            return [rowLabel, ...vals].join('\t');
        });
        const tsvSummary = [isZh ? '累计总计' : 'In Total', summaryText].join('\t');
        const tsvText = [tsvHeaders, ...tsvRows, tsvSummary].join('\r\n');

        // 2. 构建 HTML 富文本格式（粘贴至 Word、Outlook、企业微信、飞书、Teams 等富文本环境）
        let htmlTable = `<table style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;text-align:center;border:1px solid #9aa5b1;">`;
        htmlTable += `<thead><tr style="background:#dfdce9;color:#1e293b;">`;
        htmlTable += `<th style="border:1px solid #9aa5b1;padding:8px 12px;font-weight:700;">${periodLabel}</th>`;
        weeks.forEach(w => {
            htmlTable += `<th style="border:1px solid #9aa5b1;padding:8px 12px;font-weight:700;">${w.key}</th>`;
        });
        htmlTable += `</tr></thead><tbody>`;

        weekdaysMeta.forEach((wd, dayIdx) => {
            const isWeekend = wd.isWeekend;
            const rowBg = isWeekend ? '#fef7df' : '#ffffff';
            const textCol = isWeekend ? '#854d0e' : '#1e293b';
            const rowLabel = isZh ? wd.zh : wd.en;

            htmlTable += `<tr style="background:${rowBg};color:${textCol};">`;
            htmlTable += `<td style="border:1px solid #9aa5b1;padding:6px 10px;font-weight:700;">${rowLabel}</td>`;
            weeks.forEach(w => {
                const dayMeta = w.days[dayIdx];
                const val = cellsData[dayMeta.dateStr] ?? gridData[w.key]?.[wd.key] ?? '';
                const inMonth = dayMeta.inTargetMonth;
                const cellColor = inMonth ? 'inherit' : '#94a3b8';
                htmlTable += `<td style="border:1px solid #9aa5b1;padding:6px 10px;color:${cellColor};">${escapeHtml(val)}</td>`;
            });
            htmlTable += `</tr>`;
        });

        htmlTable += `</tbody><tfoot><tr style="background:#d2e1ee;color:#1e3a8a;font-weight:700;">`;
        htmlTable += `<td colspan="${weeks.length + 1}" style="border:1px solid #9aa5b1;padding:8px 14px;text-align:center;">${summaryText}</td>`;
        htmlTable += `</tr></tfoot></table>`;

        try {
            if (navigator.clipboard && window.ClipboardItem) {
                const textBlob = new Blob([tsvText], { type: 'text/plain' });
                const htmlBlob = new Blob([htmlTable], { type: 'text/html' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/plain': textBlob,
                        'text/html': htmlBlob
                    })
                ]);
            } else if (navigator.clipboard) {
                await navigator.clipboard.writeText(tsvText);
            } else {
                const ta = document.createElement('textarea');
                ta.value = tsvText;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }

            const successMsg = isZh
                ? '✅ 已成功复制值班表到剪贴板！可直接粘贴至 Excel、WPS、邮件或聊天窗口。'
                : '✅ Duty roster copied to clipboard (TSV & HTML)! Ready to paste into Excel, email, or chat.';
            if (window.showToast) window.showToast(successMsg, 'success');
            else alert(successMsg);
        } catch (err) {
            console.error('Copy to clipboard failed', err);
            const failMsg = isZh ? '复制到剪贴板失败，请手动选择复制。' : 'Failed to copy to clipboard.';
            if (window.showToast) window.showToast(failMsg, 'error');
            else alert(failMsg);
        }
    }

    // 渲染值班表核心表格
    function renderTable() {
        if (!rosterTable || !currentRoster || !currentRoster.weeks) return;

        const isZh = isChinese();
        const weeks = currentRoster.weeks;
        updateMonthTitleDisplay();

        // 1. 构建表头
        const periodHeader = isZh ? '时间段' : 'Period';
        let theadHtml = `<tr><th class="col-period">${periodHeader}</th>`;
        weeks.forEach(w => {
            theadHtml += `<th>${escapeHtml(w.key)}</th>`;
        });
        theadHtml += '</tr>';

        // 2. 构建 7 行（严格按照埃及顺序：Sun 到 Fri, Sat）
        // 埃及周末：Fri (index 5) 与 Sat (index 6)，已有金黄色高亮背景区分，不再显示“周末”字样标签
        const weekdaysMeta = [
            { key: 'Sun', zh: '周日', en: 'Sun', isWeekend: false },
            { key: 'Mon', zh: '周一', en: 'Mon', isWeekend: false },
            { key: 'Tue', zh: '周二', en: 'Tue', isWeekend: false },
            { key: 'Wed', zh: '周三', en: 'Wed', isWeekend: false },
            { key: 'Thu', zh: '周四', en: 'Thu', isWeekend: false },
            { key: 'Fri', zh: '周五', en: 'Fri', isWeekend: true },
            { key: 'Sat', zh: '周六', en: 'Sat', isWeekend: true }
        ];

        let tbodyHtml = '';
        weekdaysMeta.forEach((wd, dayIdx) => {
            const isWeekend = wd.isWeekend;
            tbodyHtml += `<tr class="${isWeekend ? 'row-weekend' : ''}">`;
            
            // 首列：星期几名称（仅按当前语言显示，有金黄色背景色高亮区分周末）
            const rowLabel = isZh ? wd.zh : wd.en;
            tbodyHtml += `<td class="cell-weekday"><strong>${rowLabel}</strong></td>`;

            // 周各列单元格
            weeks.forEach((w, weekIdx) => {
                const dayMeta = w.days[dayIdx];
                const dateStr = dayMeta.dateStr;
                const inMonth = dayMeta.inTargetMonth;
                const val = cellsData[dateStr] ?? gridData[w.key]?.[wd.key] ?? '';
                const placeholder = !inMonth ? (isZh ? '非当月' : 'Out of Month') : '';

                tbodyHtml += `
                    <td class="cell-duty ${!inMonth ? 'cell-spillover' : ''}" data-date="${dateStr}" data-week="${w.key}" data-day="${wd.key}" data-in-month="${inMonth ? 1 : 0}">
                        <span class="cell-date-tag">${dayMeta.month}/${dayMeta.day}</span>
                        <input class="cell-input" 
                               value="${escapeHtml(val)}" 
                               data-date="${dateStr}" 
                               data-week="${w.key}" 
                               data-day="${wd.key}" 
                               data-row="${dayIdx}" 
                               data-col="${weekIdx}"
                               placeholder="${placeholder}"
                               autocomplete="off">
                    </td>
                `;
            });

            tbodyHtml += '</tr>';
        });

        // 3. 构建表尾 Summary
        const totalCount = Number(annualTotalInput?.value || 353);
        const monthlyCount = calculateMonthlyPersonTimes();
        let summaryHtml = '';
        if (isZh) {
            summaryHtml = `累计总计: <span class="highlight-count" id="footAnnualTotal">${totalCount}</span>，当月夜间运维值班 <span class="highlight-count" id="footMonthlyCount">${monthlyCount}</span>*人次`;
        } else {
            summaryHtml = `In Total: <span class="highlight-count" id="footAnnualTotal">${totalCount}</span>, <span class="highlight-count" id="footMonthlyCount">${monthlyCount}</span>*Person-times for Night Operation On-duty`;
        }

        const tfootHtml = `
            <tr>
                <td colspan="${weeks.length + 1}">
                    ${summaryHtml}
                </td>
            </tr>
        `;

        rosterTable.innerHTML = `
            <thead>${theadHtml}</thead>
            <tbody>${tbodyHtml}</tbody>
            <tfoot>${tfootHtml}</tfoot>
        `;

        bindTableInputs();
        updateStats();
    }

    // 绑定表格单元格输入事件与键盘导航
    function bindTableInputs() {
        if (!rosterTable) return;
        const inputs = rosterTable.querySelectorAll('.cell-input');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                const dateStr = input.dataset.date;
                const weekKey = input.dataset.week;
                const dayKey = input.dataset.day;
                const val = input.value.trim();

                cellsData[dateStr] = val;
                if (!gridData[weekKey]) gridData[weekKey] = {};
                gridData[weekKey][dayKey] = val;

                updateSummaryDisplay();
                updateStats();
                markDirty();
            });

            // 支持方向键和回车键快速在单元格之间跳跃
            input.addEventListener('keydown', e => {
                const r = Number(input.dataset.row);
                const c = Number(input.dataset.col);
                let targetInput = null;

                if (e.key === 'ArrowUp') {
                    targetInput = rosterTable.querySelector(`.cell-input[data-row="${r - 1}"][data-col="${c}"]`);
                } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                    targetInput = rosterTable.querySelector(`.cell-input[data-row="${r + 1}"][data-col="${c}"]`);
                } else if (e.key === 'ArrowLeft' && input.selectionStart === 0) {
                    targetInput = rosterTable.querySelector(`.cell-input[data-row="${r}"][data-col="${c - 1}"]`);
                } else if (e.key === 'ArrowRight' && input.selectionEnd === input.value.length) {
                    targetInput = rosterTable.querySelector(`.cell-input[data-row="${r}"][data-col="${c + 1}"]`);
                }

                if (targetInput) {
                    e.preventDefault();
                    targetInput.focus();
                    targetInput.select();
                }
            });
        });
    }

    // 计算当月出勤人次（仅统计落在目标月份内的非空单元格）
    function calculateMonthlyPersonTimes() {
        let count = 0;
        if (!currentRoster || !currentRoster.weeks) return 0;
        currentRoster.weeks.forEach(w => {
            w.days.forEach(d => {
                if (d.inTargetMonth) {
                    const dayKey = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekdayIndex];
                    const val = cellsData[d.dateStr] ?? gridData[w.key]?.[dayKey];
                    if (val && String(val).trim()) {
                        count++;
                    }
                }
            });
        });
        return count;
    }

    // 更新底部合计数字
    function updateSummaryDisplay() {
        const totalCount = Number(annualTotalInput?.value || 353);
        const monthlyCount = calculateMonthlyPersonTimes();
        const footAnnual = document.getElementById('footAnnualTotal');
        const footMonthly = document.getElementById('footMonthlyCount');
        if (footAnnual) footAnnual.textContent = totalCount;
        if (footMonthly) footMonthly.textContent = monthlyCount;
    }

    // 保存值班表到服务器
    async function saveRoster() {
        if (!currentRoster || !saveBtn) return;
        const isZh = isChinese();
        try {
            saveBtn.disabled = true;
            saveBtn.textContent = t('duty.status_saving', isZh ? '保存中...' : 'Saving...');

            // 构建 rows 数组供表格直接查看
            const weekdaysMeta = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const rows = weekdaysMeta.map(wd => {
                const rowObj = { Period: wd };
                currentRoster.weeks.forEach(w => {
                    rowObj[w.key] = gridData[w.key]?.[wd] ?? '';
                });
                return rowObj;
            });

            const totalCount = Number(annualTotalInput?.value || 353);
            const monthlyCount = calculateMonthlyPersonTimes();
            const summaryText = `In Total: ${totalCount}, ${monthlyCount}*Person-times for Night Operation On-duty`;

            const payload = {
                month: currentMonth,
                title: '夜间运维值班表',
                weeks: currentRoster.weeks,
                rows,
                cells: cellsData,
                grid: gridData,
                totalCount,
                monthlyCount,
                summaryText
            };

            const res = await apiFetch('/api/duty-roster', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson.error || 'Server error ' + res.status);
            }

            markClean();
            try { localStorage.setItem(STORAGE_LAST_MONTH_KEY, currentMonth); } catch (_) {}
            const successMsg = t('duty.toast_save_success', isZh ? '✅ 值班表已成功保存到服务器，并已同步至月报编辑器的“指标与关键数据表”！' : '✅ Duty roster saved to server!');
            if (window.showToast) {
                window.showToast(successMsg, 'success');
            } else {
                alert(successMsg);
            }
        } catch (err) {
            console.error('Save roster failed', err);
            const failMsg = t('duty.toast_save_fail', isZh ? '保存失败: ' : 'Failed to save: ') + err.message;
            if (window.showToast) window.showToast(failMsg, 'error');
            else alert(failMsg);
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = t('duty.btn_save', isZh ? '💾 保存到服务器' : '💾 Save to Server');
        }
    }

    // 导出为 CSV
    function exportCsv() {
        if (!currentRoster || !currentRoster.weeks) return;
        const isZh = isChinese();
        const weeks = currentRoster.weeks;
        const periodHeader = isZh ? '时间段' : 'Period';
        const headers = [periodHeader, ...weeks.map(w => w.key)];
        const weekdaysMeta = [
            { key: 'Sun', zh: '周日', en: 'Sun' },
            { key: 'Mon', zh: '周一', en: 'Mon' },
            { key: 'Tue', zh: '周二', en: 'Tue' },
            { key: 'Wed', zh: '周三', en: 'Wed' },
            { key: 'Thu', zh: '周四', en: 'Thu' },
            { key: 'Fri', zh: '周五', en: 'Fri' },
            { key: 'Sat', zh: '周六', en: 'Sat' }
        ];

        const lines = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')];
        weekdaysMeta.forEach(wd => {
            const rowLabel = isZh ? wd.zh : wd.en;
            const row = [rowLabel];
            weeks.forEach(w => {
                row.push(gridData[w.key]?.[wd.key] || '');
            });
            lines.push(row.map(val => `"${val.replace(/"/g, '""')}"`).join(','));
        });

        const totalCount = Number(annualTotalInput?.value || 353);
        const monthlyCount = calculateMonthlyPersonTimes();
        const summaryText = isZh
            ? `累计总计: ${totalCount}，当月夜间运维值班 ${monthlyCount}*人次`
            : `In Total: ${totalCount}, ${monthlyCount}*Person-times for Night Operation On-duty`;
        lines.push([`"${isZh ? '累计总计' : 'In Total'}"`, `"${summaryText.replace(/"/g, '""')}"`].join(','));

        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `夜间运维值班表_${currentMonth}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // 渲染快捷人员标签
    function renderPersonnelTags() {
        if (!personTagsContainer) return;
        personTagsContainer.innerHTML = COMMON_PERSONNEL.map(name => {
            return `<span class="person-tag" data-name="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
        }).join('');

        personTagsContainer.addEventListener('click', e => {
            const tag = e.target.closest('.person-tag');
            if (!tag) return;
            const name = tag.dataset.name;

            // 查找当前激活的输入框，如果有则填入；否则复制到剪贴板
            const activeInput = document.activeElement;
            if (activeInput && activeInput.classList.contains('cell-input')) {
                activeInput.value = name;
                activeInput.dispatchEvent(new Event('input'));
            } else {
                navigator.clipboard?.writeText(name);
                const toastMsg = t('duty.toast_person_copied', isChinese() ? `已复制 "${name}"，可直接点击单元格粘贴` : `Copied "${name}"`, { name });
                if (window.showToast) window.showToast(toastMsg, 'info');
            }
        });
    }

    // 统计各人员当月值班频次
    function updateStats() {
        if (!statsList) return;
        const counts = {};
        if (currentRoster && currentRoster.weeks) {
            currentRoster.weeks.forEach(w => {
                w.days.forEach(d => {
                    if (d.inTargetMonth) {
                        const dayKey = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.weekdayIndex];
                        const val = cellsData[d.dateStr] ?? gridData[w.key]?.[dayKey];
                        if (val && String(val).trim()) {
                            const trimmed = String(val).trim();
                            counts[trimmed] = (counts[trimmed] || 0) + 1;
                        }
                    }
                });
            });
        }

        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (!sorted.length) {
            statsList.innerHTML = `<span style="color:#94a3b8;font-size:12px;">${escapeHtml(t('duty.stats_empty', isChinese() ? '暂无排班数据' : 'No duty data yet'))}</span>`;
            return;
        }

        const unit = t('duty.stats_times', isChinese() ? '次' : 'times');
        statsList.innerHTML = sorted.slice(0, 10).map(([name, count]) => `
            <div class="stats-item">
                <span>${escapeHtml(name)}</span>
                <strong>${count} ${escapeHtml(unit)}</strong>
            </div>
        `).join('');
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
