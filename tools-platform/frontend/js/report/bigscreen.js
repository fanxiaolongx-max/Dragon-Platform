(function () {
    const state = {
        trends: [],
        latest: null,
        snapshots: [],
        owners: [],
        ownerDraft: [],
        pendingOwnerAvatar: '',
        charts: {},
        monthlyPath: '/api/db/monthly_report_data',
        refreshTimer: null,
        isRefreshing: false,
        lastRefreshSignature: '',
        lastSuccessfulRefreshAt: null,
        refreshStatus: '',
        refreshStatusKey: 'statusSynced',
        i18nMap: {},
        contactInfo: null,
        dashboardTitle: null,
        rankScoreTheme: 'flap',
        autoLanguageTimer: null,
        languageTransitioning: false
    };

    const RANK_SCORE_THEME_KEY = 'tools.bigscreen.rankScoreTheme';
    const RANK_SCORE_THEMES = ['flap', 'neon', 'plain'];
    const AUTO_LANGUAGE_SECONDS_KEY = 'tools.bigscreen.autoLanguageSeconds';

    const BIGSCREEN_I18N = {
        'zh-CN': {
            title: '埃及维护运营质量看板',
            loadingSubtitle: '数据来自月报页面与报表看板入库结果，正在加载...',
            noDataSubtitle: '当前筛选范围内暂无入库数据。',
            subtitle: '分析周期 {start} 至 {end}，最新快照 {snapshot}，目标月份 {month}',
            range30: '最近 30 天',
            range90: '最近 90 天',
            rangeAll: '全部数据',
            rangeCustom: '自定义',
            refresh: '刷新',
            exportHtml: '导出HTML',
            exportingHtml: '导出中',
            syncing: '同步中',
            ownerConfig: '责任人配置',
            autoLanguage: '语言轮播',
            stopAutoLanguage: '停止轮播',
            autoLanguageSeconds: '语言切换间隔（秒）',
            secondsUnit: '秒',
            fullscreen: '全屏',
            exitFullscreen: '退出全屏',
            fullscreenTitle: '全屏显示',
            exitFullscreenTitle: '退出全屏显示',
            rankTitle: '未达标客户群',
            rankSub: '按当前分数',
            rankThemeHint: '点击分数切换主题: {theme}',
            rankThemeFlap: '翻牌',
            rankThemeNeon: '霓虹',
            rankThemePlain: '纯数字',
            trendTitle: '风险走势',
            trendSub: '未达标项 / 达标率',
            weakTitle: '整体未达标诊断',
            weakSub: '指标 × 未达标客户群',
            carouselTitle: '综合轮播诊断',
            carouselSub: '多维指标展示',
            manualTitle: '额外加减分：',
            passTitle: '已达标指标巡检',
            passSub: '辅助滚动',
            trendSource: '趋势来源',
            snapshotSource: '快照来源',
            latestRefresh: '最新刷新',
            dataScope: '数据口径: 月报趋势 + 报表看板入库快照',
            sourceSqlite: 'SQLite',
            sourceJson: 'JSON',
            sourceAuto: '自动模式',
            statusSynced: '数据已同步',
            statusAutoNoChange: '自动同步完成，无变化',
            statusManualNoChange: '数据已同步，无变化',
            statusUpdated: '数据已更新',
            statusLoaded: '数据已加载',
            statusFailedKeep: '刷新失败，沿用上次数据',
            noReportData: '暂无可展示数据，请先在报表看板完成入库。',
            noFailingCustomers: '当前无未达标客户群',
            failedCustomerGroups: '未达标客户群数',
            rankStable: '当前客户群整体稳定，暂无需要突出跟进的未达标客户群。',
            rankSummary: '当前排名第 <strong>1</strong> 的客户群为 <strong>{firstCat}</strong>，得分 <strong class="good">{firstScore}</strong>；第 <strong>{lastRank}</strong> 为 <strong>{lastCat}</strong>，得分 <strong class="bad">{lastScore}</strong>。',
            rankRiskLeader: '未达标项最集中在 <strong>{cat}</strong>（<strong class="bad">{count}</strong> 项）。',
            scoreUnit: '分',
            failingMetricCount: '（总计未达标指标: {metrics}个 | 客户群明细数: {rows}条）',
            passingMetricCount: '（总计达标指标: {metrics}个 | 客户群明细数: {rows}条）',
            emptyWeak: '当前最新快照无未达标项',
            emptyMetricData: '暂无指标明细数据',
            emptyPassing: '暂无已达标指标',
            target: '目标',
            byCategoryTarget: '按分类目标',
            actual: '实测',
            current: '当前',
            gap: '差距',
            deviation: '偏离强度',
            noRisk: '无风险',
            itemUnit: '项',
            change: '变化量',
            period: '区间: {start} 至 {end}',
            previousCapture: '上次采集: {date}',
            currentCapture: '本次采集: {date}',
            concentrationByCustomer: '短板集中度 (按客户群)',
            failingItems: '未达标项',
            passRate: '达标率',
            noFailingCarousel: '当前无未达标指标',
            manualEmpty: '当前最新快照无客户群产生额外加减分',
            manualDesc: '({count}次，共 {sign}{score}分)',
            add: '加分',
            deduct: '扣分',
            unnamedConfig: '未命名配置',
            ownerPending: '责任人待配置',
            ownerTodo: '待配置',
            ownerDefault: '客户群默认',
            ownerGlobal: '整体 / 全局',
            ownerNone: '无工号',
            ownerFallbackCat: '整体/全局',
            ownerDefaultLoop: '未配置(默认轮播)',
            ownerModalTitle: '责任人配置',
            ownerModalSub: '优先匹配“客户群 + 指标”，未命中时使用客户群默认责任人。',
            close: '关闭',
            cancel: '取消',
            saveServer: '保存到服务器',
            addBtn: '添加',
            updateSave: '更新并保存',
            avatarHeader: '头像',
            customerGroup: '客户群',
            metricDimension: '指标维度',
            owner: '责任人',
            empId: '工号',
            action: '操作',
            edit: '编辑',
            delete: '删除',
            noOwners: '暂无责任人配置',
            ownerNamePlaceholder: '责任人名字',
            empIdPlaceholder: '工号',
            avatarPlaceholder: '图',
            uploadAvatar: '上传头像图片',
            avatarSelected: '已选择头像',
            chooseImage: '请选择图片文件',
            avatarReadFail: '头像图片读取失败',
            ownerRequired: '请先选择客户群并填写责任人名字',
            ownerSaved: '责任人配置已保存，共 {count} 条',
            saveFailed: '保存失败: {message}',
            exportNoData: '当前大屏还没有可导出的数据',
            exportDone: 'HTML 已导出',
            exportFailed: '导出失败: {message}',
            loadFailed: '大屏数据加载失败: {message}',
            loadFailedShort: '加载失败: {message}',
            contactDefault: '如果您对看板数据有疑问或者建议，请联系 fanxiaolong 84300033，谢谢！',
            contactModalTitle: '联系信息配置',
            contactModalSub: '底部提示语会跟随顶部语言切换按钮自动切换中英文。',
            contactZhLabel: '中文提示语',
            contactEnLabel: '英文提示语',
            contactZhPlaceholder: '请输入中文联系提示',
            contactEnPlaceholder: '请输入英文联系提示',
            titleModalTitle: '大标题配置',
            titleModalSub: '点击大屏主标题可同时维护中文和英文标题。',
            titleZhLabel: '中文大标题',
            titleEnLabel: '英文大标题',
            titleZhPlaceholder: '请输入中文大标题',
            titleEnPlaceholder: 'Enter the English dashboard title',
            titleSaved: '大标题已保存',
            titleSaveFail: '保存失败: {message}',
            contactSaved: '联系信息已保存',
            contactSaveFail: '保存失败: {message}',
            noSnapshot: '-',
            unknownMetric: '未知指标',
            unknown: 'Unknown',
            global: '全局',
            processing: '处理中',
            currentNo: '当前无{title}',
            sourceRefreshStatus: '数据源来自 NetcareCloud / 看板 / 3MS / IBMS / iSales，5 分钟自动刷新一次数据',
            sourceRefreshNoData: '等待入库数据，数据源来自 NetcareCloud / 看板 / 3MS / IBMS / iSales'
        },
        'en-US': {
            title: 'Egypt Maintenance Operation Quality Dashboard',
            loadingSubtitle: 'Loading data from monthly trends and saved report snapshots...',
            noDataSubtitle: 'No saved data is available for the selected range.',
            subtitle: 'Analysis period {start} to {end}; latest snapshot {snapshot}; target month {month}',
            range30: 'Last 30 Days',
            range90: 'Last 90 Days',
            rangeAll: 'All Data',
            rangeCustom: 'Custom',
            refresh: 'Refresh',
            exportHtml: 'Export HTML',
            exportingHtml: 'Exporting',
            syncing: 'Syncing',
            ownerConfig: 'Owner Config',
            autoLanguage: 'Language Loop',
            stopAutoLanguage: 'Stop Loop',
            autoLanguageSeconds: 'Language switch interval (seconds)',
            secondsUnit: 's',
            fullscreen: 'Fullscreen',
            exitFullscreen: 'Exit Fullscreen',
            fullscreenTitle: 'Enter fullscreen',
            exitFullscreenTitle: 'Exit fullscreen',
            rankTitle: 'At-Risk Customer Groups',
            rankSub: 'By current score',
            rankThemeHint: 'Click score to switch theme: {theme}',
            rankThemeFlap: 'Flip',
            rankThemeNeon: 'Neon',
            rankThemePlain: 'Plain',
            trendTitle: 'Risk Trend',
            trendSub: 'Failed Items / Pass Rate',
            weakTitle: 'Overall Failure Diagnosis',
            weakSub: 'Metric x failed customer group',
            carouselTitle: 'Diagnostic Carousel',
            carouselSub: 'Multi-dimensional indicators',
            manualTitle: 'Manual Adjustments:',
            passTitle: 'Passed Metric Patrol',
            passSub: 'Auto scroll',
            trendSource: 'Trend Source',
            snapshotSource: 'Snapshot Source',
            latestRefresh: 'Last Refresh',
            dataScope: 'Scope: monthly trends + saved report snapshots',
            sourceSqlite: 'SQLite',
            sourceJson: 'JSON',
            sourceAuto: 'Auto Mode',
            statusSynced: 'Data synced',
            statusAutoNoChange: 'Auto sync complete, no changes',
            statusManualNoChange: 'Data synced, no changes',
            statusUpdated: 'Data updated',
            statusLoaded: 'Data loaded',
            statusFailedKeep: 'Refresh failed, keeping previous data',
            noReportData: 'No data to display. Save a report snapshot first.',
            noFailingCustomers: 'No at-risk customer groups',
            failedCustomerGroups: 'Failed customer groups',
            rankStable: 'All customer groups are stable. No at-risk group needs highlighting.',
            rankSummary: 'The No. <strong>1</strong> customer group is <strong>{firstCat}</strong>, score <strong class="good">{firstScore}</strong>; No. <strong>{lastRank}</strong> is <strong>{lastCat}</strong>, score <strong class="bad">{lastScore}</strong>.',
            rankRiskLeader: 'Failures are most concentrated in <strong>{cat}</strong> (<strong class="bad">{count}</strong> items).',
            scoreUnit: 'pts',
            failingMetricCount: '({metrics} failed metrics | {rows} customer-group rows)',
            passingMetricCount: '({metrics} passed metrics | {rows} customer-group rows)',
            emptyWeak: 'No failed items in the latest snapshot',
            emptyMetricData: 'No metric details available',
            emptyPassing: 'No passed metrics',
            target: 'Target',
            byCategoryTarget: 'By-category targets',
            actual: 'Actual',
            current: 'Current',
            gap: 'Gap',
            deviation: 'Deviation',
            noRisk: 'No Risk',
            itemUnit: 'items',
            change: 'Change',
            period: 'Period: {start} to {end}',
            previousCapture: 'Previous: {date}',
            currentCapture: 'Current: {date}',
            concentrationByCustomer: 'Weakness Concentration (by Customer Group)',
            failingItems: 'Failed Items',
            passRate: 'Pass Rate',
            noFailingCarousel: 'No failed metrics',
            manualEmpty: 'No customer-group manual adjustments in the latest snapshot',
            manualDesc: '({count} times, {sign}{score} pts)',
            add: 'Bonus',
            deduct: 'Deduction',
            unnamedConfig: 'Unnamed Config',
            ownerPending: 'Owner pending',
            ownerTodo: 'Pending',
            ownerDefault: 'Customer-group default',
            ownerGlobal: 'Overall / Global',
            ownerNone: 'No ID',
            ownerFallbackCat: 'Overall/Global',
            ownerDefaultLoop: 'Unconfigured (default carousel)',
            ownerModalTitle: 'Owner Config',
            ownerModalSub: 'Match by customer group + metric first; fallback to customer-group default owner.',
            close: 'Close',
            cancel: 'Cancel',
            saveServer: 'Save to Server',
            addBtn: 'Add',
            updateSave: 'Update and Save',
            avatarHeader: 'Avatar',
            customerGroup: 'Customer Group',
            metricDimension: 'Metric',
            owner: 'Owner',
            empId: 'Employee ID',
            action: 'Action',
            edit: 'Edit',
            delete: 'Delete',
            noOwners: 'No owner configuration',
            ownerNamePlaceholder: 'Owner name',
            empIdPlaceholder: 'Employee ID',
            avatarPlaceholder: 'Img',
            uploadAvatar: 'Upload avatar',
            avatarSelected: 'Avatar selected',
            chooseImage: 'Please choose an image file',
            avatarReadFail: 'Failed to read avatar image',
            ownerRequired: 'Please select a customer group and enter owner name',
            ownerSaved: 'Owner config saved, {count} records',
            saveFailed: 'Save failed: {message}',
            exportNoData: 'No big screen data is available to export',
            exportDone: 'HTML exported',
            exportFailed: 'Export failed: {message}',
            loadFailed: 'Big screen data load failed: {message}',
            loadFailedShort: 'Load failed: {message}',
            contactDefault: 'If you have any questions or suggestions about the dashboard data, please contact fanxiaolong at 84300033. Thank you!',
            contactModalTitle: 'Contact Info Config',
            contactModalSub: 'The footer message follows the top language switch between Chinese and English.',
            contactZhLabel: 'Chinese Message',
            contactEnLabel: 'English Message',
            contactZhPlaceholder: 'Enter the Chinese contact message',
            contactEnPlaceholder: 'Enter the English contact message',
            titleModalTitle: 'Dashboard Title Config',
            titleModalSub: 'Click the dashboard title to maintain Chinese and English titles together.',
            titleZhLabel: 'Chinese Title',
            titleEnLabel: 'English Title',
            titleZhPlaceholder: 'Enter the Chinese dashboard title',
            titleEnPlaceholder: 'Enter the English dashboard title',
            titleSaved: 'Dashboard title saved',
            titleSaveFail: 'Save failed: {message}',
            contactSaved: 'Contact information saved',
            contactSaveFail: 'Save failed: {message}',
            noSnapshot: '-',
            unknownMetric: 'Unknown Metric',
            unknown: 'Unknown',
            global: 'Global',
            processing: 'In Progress',
            currentNo: 'No current {title}',
            sourceRefreshStatus: 'Sources: NetcareCloud / Dashboard / 3MS / IBMS / iSales; auto-refresh every 5 min',
            sourceRefreshNoData: 'Waiting for saved data. Sources: NetcareCloud / Dashboard / 3MS / IBMS / iSales'
        }
    };

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHTML(value) {
        return String(value ?? '').replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    }

    function lang() {
        return window.ToolsI18n && typeof window.ToolsI18n.getLanguage === 'function'
            ? window.ToolsI18n.getLanguage()
            : 'zh-CN';
    }

    function isEn() {
        return lang() === 'en-US';
    }

    function tr(key, params = {}) {
        const dict = BIGSCREEN_I18N[lang()] || BIGSCREEN_I18N['zh-CN'];
        const fallback = BIGSCREEN_I18N['zh-CN'];
        const template = dict[key] ?? fallback[key] ?? key;
        return String(template).replace(/\{(\w+)\}/g, (_, name) => (
            Object.prototype.hasOwnProperty.call(params, name) ? params[name] : `{${name}}`
        ));
    }

    function defaultContactInfo() {
        return {
            zh: BIGSCREEN_I18N['zh-CN'].contactDefault,
            en: BIGSCREEN_I18N['en-US'].contactDefault
        };
    }

    function defaultDashboardTitle() {
        return {
            zh: BIGSCREEN_I18N['zh-CN'].title,
            en: BIGSCREEN_I18N['en-US'].title
        };
    }

    function cleanContactText(value) {
        return String(value || '').trim().replace(/^[*•]\s*/, '');
    }

    function normalizeContactInfo(raw) {
        const defaults = defaultContactInfo();
        if (!raw || typeof raw !== 'object') return defaults;
        const zh = cleanContactText(raw.zh || raw.zhCN || raw['zh-CN'] || raw.text || '');
        const en = cleanContactText(raw.en || raw.enUS || raw['en-US'] || '');
        return {
            zh: zh || defaults.zh,
            en: en || defaults.en
        };
    }

    function normalizeDashboardTitle(raw) {
        const defaults = defaultDashboardTitle();
        if (!raw || typeof raw !== 'object') return defaults;
        const zh = String(raw.zh || raw.zhCN || raw['zh-CN'] || raw.title || '').trim();
        const en = String(raw.en || raw.enUS || raw['en-US'] || '').trim();
        const legacyDefaults = [
            { zh: 'EG运营质量综合看板', en: 'EG Operational Quality Dashboard' },
            { zh: 'EG护网行动运营质量综合看板', en: 'EG Operational Quality Dashboard' }
        ];
        if (legacyDefaults.some(item => item.zh === zh && item.en === en)) return defaults;
        return {
            zh: zh || defaults.zh,
            en: en || defaults.en
        };
    }

    function getDashboardTitle() {
        const titleInfo = normalizeDashboardTitle(state.dashboardTitle);
        return isEn() ? titleInfo.en : titleInfo.zh;
    }

    function renderDashboardTitle() {
        const titleText = getDashboardTitle();
        const h1 = $('bigscreenTitle') || document.querySelector('.title-block h1');
        if (h1) {
            h1.textContent = titleText;
            h1.title = isEn() ? 'Click to edit Chinese and English titles' : '点击编辑中文和英文大标题';
        }
        document.title = `${titleText} - Tools Platform`;
    }

    function renderContactInfo() {
        const dom = $('contactInfoText');
        if (!dom) return;
        const info = normalizeContactInfo(state.contactInfo);
        dom.textContent = isEn() ? info.en : info.zh;
    }

    function cleanI18nValue(value) {
        if (!value) return '';
        const text = String(value);
        if (text.includes('<br>')) {
            const match = text.match(/<span[^>]*>(.*?)<\/span>/);
            return match ? match[1] : text.replace(/<[^>]+>/g, '');
        }
        return text.replace(/<[^>]+>/g, '');
    }

    function translated(value) {
        const text = String(value ?? '');
        if (!text || !isEn()) return text;
        const clean = text.replace(/\(Ungrouped\)/, '').trim();
        const hardcoded = {
            '整体': 'Global/Overall',
            '全局': 'Global/Overall'
        };
        return hardcoded[text] || hardcoded[clean] || state.i18nMap[text] || state.i18nMap[clean] || text;
    }

    function sourceLabel(source) {
        if (source === 'sqlite') return tr('sourceSqlite');
        if (source === 'json') return tr('sourceJson');
        if (source === 'auto') return tr('sourceAuto');
        return source || '-';
    }

    function applyStaticI18n() {
        renderDashboardTitle();
        if ($('bigscreenSubtitle') && !state.latest) {
            $('bigscreenSubtitle').textContent = tr('loadingSubtitle');
        }
        const rangeSelect = $('rangeSelect');
        if (rangeSelect) {
            const labels = { '30': tr('range30'), '90': tr('range90'), all: tr('rangeAll'), custom: tr('rangeCustom') };
            Array.from(rangeSelect.options).forEach(option => {
                if (labels[option.value]) option.textContent = labels[option.value];
            });
        }
        const ownerBtn = $('ownerConfigBtn');
        if (ownerBtn) ownerBtn.textContent = tr('ownerConfig');
        syncAutoLanguageControls();
        const refreshBtn = $('refreshBtn');
        if (refreshBtn) refreshBtn.textContent = state.isRefreshing ? tr('syncing') : tr('refresh');
        const exportBtn = $('exportHtmlBtn');
        if (exportBtn) exportBtn.textContent = tr('exportHtml');
        const startInput = $('startDate');
        if (startInput) startInput.setAttribute('aria-label', isEn() ? 'Start date' : '开始日期');
        const endInput = $('endDate');
        if (endInput) endInput.setAttribute('aria-label', isEn() ? 'End date' : '结束日期');
        syncFullscreenButton();

        const setPanel = (selector, titleKey, subKey) => {
            const panel = document.querySelector(selector);
            if (!panel) return;
            const title = panel.querySelector('.panel-title');
            const sub = panel.querySelector('.panel-sub');
            if (title) title.textContent = tr(titleKey);
            if (sub && subKey) sub.textContent = tr(subKey);
        };
        setPanel('.customer-focus', 'rankTitle', 'rankSub');
        renderRankThemeHint();
        setPanel('.main-trend', 'trendTitle', 'trendSub');
        setPanel('.metric-carousel-panel', 'carouselTitle', 'carouselSub');
        const passPanel = document.querySelector('.pass-strip-panel');
        if (passPanel) {
            const title = passPanel.querySelector('.panel-title');
            const sub = passPanel.querySelector('.panel-sub');
            if (title) title.innerHTML = `${escapeHTML(tr('passTitle'))} <span id="passingMetricsCount" style="font-size:12px;color:var(--cyan);font-weight:normal;margin-left:8px;"></span>`;
            if (sub) sub.textContent = tr('passSub');
        }
        const weakPanel = document.querySelector('.failure-focus');
        if (weakPanel) {
            const title = weakPanel.querySelector('.panel-title');
            const sub = weakPanel.querySelector('.panel-sub');
            if (title) title.innerHTML = `${escapeHTML(tr('weakTitle'))} <span id="failingMetricsCount" style="font-size:12px;color:#ff5d73;font-weight:normal;margin-left:8px;"></span>`;
            if (sub) sub.textContent = tr('weakSub');
        }
        const manualTitle = document.querySelector('.manual-title');
        if (manualTitle) manualTitle.textContent = tr('manualTitle');
        const ownerTitle = $('ownerDialogTitle');
        if (ownerTitle) ownerTitle.textContent = tr('ownerModalTitle');
        const modalSub = document.querySelector('#ownerModal .owner-dialog-head .panel-sub');
        if (modalSub) modalSub.textContent = tr('ownerModalSub');
        const contactTitle = $('contactDialogTitle');
        if (contactTitle) contactTitle.textContent = tr('contactModalTitle');
        const contactSub = $('contactDialogSub');
        if (contactSub) contactSub.textContent = tr('contactModalSub');
        const contactZhLabel = $('contactZhLabel');
        if (contactZhLabel) contactZhLabel.textContent = tr('contactZhLabel');
        const contactEnLabel = $('contactEnLabel');
        if (contactEnLabel) contactEnLabel.textContent = tr('contactEnLabel');
        const contactZhInput = $('contactZhInput');
        if (contactZhInput) contactZhInput.placeholder = tr('contactZhPlaceholder');
        const contactEnInput = $('contactEnInput');
        if (contactEnInput) contactEnInput.placeholder = tr('contactEnPlaceholder');
        const titleDialogTitle = $('titleDialogTitle');
        if (titleDialogTitle) titleDialogTitle.textContent = tr('titleModalTitle');
        const titleDialogSub = $('titleDialogSub');
        if (titleDialogSub) titleDialogSub.textContent = tr('titleModalSub');
        const titleZhLabel = $('titleZhLabel');
        if (titleZhLabel) titleZhLabel.textContent = tr('titleZhLabel');
        const titleEnLabel = $('titleEnLabel');
        if (titleEnLabel) titleEnLabel.textContent = tr('titleEnLabel');
        const titleZhInput = $('titleZhInput');
        if (titleZhInput) titleZhInput.placeholder = tr('titleZhPlaceholder');
        const titleEnInput = $('titleEnInput');
        if (titleEnInput) titleEnInput.placeholder = tr('titleEnPlaceholder');
        const ownerNameInput = $('ownerNameInput');
        if (ownerNameInput) ownerNameInput.placeholder = tr('ownerNamePlaceholder');
        const ownerEmpInput = $('ownerEmpIdInput');
        if (ownerEmpInput) ownerEmpInput.placeholder = tr('empIdPlaceholder');
        const avatarLabel = $('ownerAvatarLabel');
        if (avatarLabel && !state.pendingOwnerAvatar) avatarLabel.textContent = tr('uploadAvatar');
        const avatarPreview = $('ownerAvatarPreview');
        if (avatarPreview && !state.pendingOwnerAvatar) avatarPreview.textContent = tr('avatarPlaceholder');
        const headers = document.querySelectorAll('.owner-table thead th');
        [tr('avatarHeader'), tr('customerGroup'), tr('metricDimension'), tr('owner'), tr('empId'), tr('action')].forEach((label, idx) => {
            if (headers[idx]) headers[idx].textContent = label;
        });
        const addOwnerBtn = $('btnAddOwner');
        if (addOwnerBtn) addOwnerBtn.textContent = editingOwnerIndex >= 0 ? tr('updateSave') : tr('addBtn');
        const closeBtns = document.querySelectorAll('#ownerModal button');
        closeBtns.forEach(btn => {
            if (btn.getAttribute('onclick') === 'BigscreenOwners.close()') {
                btn.textContent = btn.closest('.owner-dialog-foot') ? tr('cancel') : tr('close');
            } else if (btn.getAttribute('onclick') === 'BigscreenOwners.save()') {
                btn.textContent = tr('saveServer');
            } else if (btn.getAttribute('onclick') === 'BigscreenOwners.add()' && btn.id !== 'btnAddOwner') {
                btn.textContent = tr('addBtn');
            }
        });
        const contactBtns = document.querySelectorAll('#contactModal button');
        contactBtns.forEach(btn => {
            if (btn.getAttribute('onclick') === 'BigscreenContact.close()') {
                btn.textContent = btn.closest('.owner-dialog-foot') ? tr('cancel') : tr('close');
            } else if (btn.getAttribute('onclick') === 'BigscreenContact.save()') {
                btn.textContent = tr('saveServer');
            }
        });
        const titleBtns = document.querySelectorAll('#titleModal button');
        titleBtns.forEach(btn => {
            if (btn.getAttribute('onclick') === 'BigscreenTitle.close()') {
                btn.textContent = btn.closest('.owner-dialog-foot') ? tr('cancel') : tr('close');
            } else if (btn.getAttribute('onclick') === 'BigscreenTitle.save()') {
                btn.textContent = tr('saveServer');
            }
        });
        renderContactInfo();
    }

    function num(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function fmt(value, digits = 1) {
        const n = num(value, 0);
        return n.toFixed(digits);
    }

    function normalizeRankScoreTheme(value) {
        return RANK_SCORE_THEMES.includes(value) ? value : 'flap';
    }

    function getRankScoreThemeLabel(theme = state.rankScoreTheme) {
        const key = {
            flap: 'rankThemeFlap',
            neon: 'rankThemeNeon',
            plain: 'rankThemePlain'
        }[normalizeRankScoreTheme(theme)] || 'rankThemeFlap';
        return tr(key);
    }

    function loadRankScoreTheme() {
        try {
            state.rankScoreTheme = normalizeRankScoreTheme(localStorage.getItem(RANK_SCORE_THEME_KEY));
        } catch (e) {
            state.rankScoreTheme = 'flap';
        }
    }

    function saveRankScoreTheme(theme) {
        state.rankScoreTheme = normalizeRankScoreTheme(theme);
        try {
            localStorage.setItem(RANK_SCORE_THEME_KEY, state.rankScoreTheme);
        } catch (e) {
            console.warn('[bigscreen] save score theme skipped:', e);
        }
    }

    function renderRankThemeHint() {
        const panel = document.querySelector('.customer-focus');
        const sub = panel && panel.querySelector('.panel-sub');
        if (!sub) return;
        sub.textContent = tr('rankThemeHint', { theme: getRankScoreThemeLabel() });
        sub.title = isEn()
            ? 'Click any score in this panel to switch the display theme.'
            : '点击本面板任意分数可切换显示主题。';
    }

    function cycleRankScoreTheme() {
        const current = normalizeRankScoreTheme(state.rankScoreTheme);
        const idx = RANK_SCORE_THEMES.indexOf(current);
        const next = RANK_SCORE_THEMES[(idx + 1) % RANK_SCORE_THEMES.length];
        saveRankScoreTheme(next);
        renderRankList();
        if (window.showToast) {
            window.showToast(isEn()
                ? `Score theme: ${getRankScoreThemeLabel(next)}`
                : `分数显示主题：${getRankScoreThemeLabel(next)}`);
        }
    }

    function fmtDate(date = new Date()) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function parseRaw(raw) {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch (e) {
            return {};
        }
    }

    function getCurrentRange() {
        const range = $('rangeSelect') ? $('rangeSelect').value : '90';
        const params = new URLSearchParams();
        if (range === 'all') return { range, query: '' };

        let start = $('startDate') ? $('startDate').value : '';
        let end = $('endDate') ? $('endDate').value : '';

        if (range !== 'custom') {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(endDate.getDate() - parseInt(range, 10));
            start = fmtDate(startDate);
            end = fmtDate(endDate);
            if ($('startDate')) $('startDate').value = start;
            if ($('endDate')) $('endDate').value = end;
        }

        if (start && end) {
            params.set('startDate', start);
            params.set('endDate', end);
        }
        return { range, start, end, query: params.toString() ? `?${params.toString()}` : '' };
    }

    function setLoading(loading) {
        const btn = $('refreshBtn');
        if (!btn) return;
        btn.disabled = loading;
        btn.textContent = loading ? tr('syncing') : tr('refresh');
    }

    function renderScriptVersion() {
        const target = $('scriptVersion');
        if (!target) return;
        const script = [...document.scripts].find(item => item.src && item.src.includes('/js/report/bigscreen.js'));
        const src = script ? script.src : '';
        let version = '-';
        try {
            version = new URL(src, window.location.href).searchParams.get('v') || '-';
        } catch (e) {
            const match = src.match(/[?&]v=([^&]+)/);
            version = match ? match[1] : '-';
        }
        target.textContent = `v${version}`;
        target.title = isEn() ? `Current big screen script version: ${version}` : `当前大屏脚本版本: ${version}`;
    }

    function downloadTextFile(filename, content, type = 'text/html;charset=utf-8') {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function syncCloneFormState(clonedDoc) {
        const sourceFields = document.querySelectorAll('input, textarea, select');
        const clonedFields = clonedDoc.querySelectorAll('input, textarea, select');
        sourceFields.forEach((field, idx) => {
            const clone = clonedFields[idx];
            if (!clone) return;
            if (field.tagName === 'SELECT') {
                Array.from(clone.options).forEach(option => {
                    option.removeAttribute('selected');
                    if (option.value === field.value) option.setAttribute('selected', 'selected');
                });
            } else if (field.type === 'checkbox' || field.type === 'radio') {
                if (field.checked) clone.setAttribute('checked', 'checked');
                else clone.removeAttribute('checked');
            } else {
                clone.setAttribute('value', field.value || '');
                if (field.tagName === 'TEXTAREA') clone.textContent = field.value || '';
            }
            if (field.disabled) clone.setAttribute('disabled', 'disabled');
            else clone.removeAttribute('disabled');
        });
    }

    function replaceCanvasWithImages(clonedDoc) {
        const canvases = document.querySelectorAll('canvas');
        const clonedCanvases = clonedDoc.querySelectorAll('canvas');
        canvases.forEach((canvas, idx) => {
            const clone = clonedCanvases[idx];
            if (!clone) return;
            try {
                const img = clonedDoc.createElement('img');
                img.src = canvas.toDataURL('image/png');
                img.alt = 'chart';
                img.width = canvas.width;
                img.height = canvas.height;
                img.style.cssText = clone.getAttribute('style') || '';
                img.style.width = clone.style.width || `${canvas.clientWidth || canvas.width}px`;
                img.style.height = clone.style.height || `${canvas.clientHeight || canvas.height}px`;
                img.style.display = clone.style.display || 'block';
                clone.replaceWith(img);
            } catch (e) {
                console.warn('[bigscreen] chart canvas export skipped:', e);
            }
        });
    }

    function freezeExportedScoreFlaps(clonedDoc) {
        clonedDoc.querySelectorAll('.flap-board').forEach(board => {
            const value = String(board.getAttribute('data-val') || '');
            board.querySelectorAll('.flap-char').forEach((char, idx) => {
                char.textContent = value[idx] || '';
                char.style.animation = 'none';
                char.style.transform = 'rotateX(0deg)';
                char.style.filter = 'brightness(1)';
                delete char.dataset.flipping;
            });
        });
    }

    function normalizeExportedKpiSliders(clonedDoc) {
        clonedDoc.querySelectorAll('.kpi-slider[data-count]').forEach(slider => {
            const count = parseInt(slider.getAttribute('data-count'), 10);
            if (!count || count <= 1) {
                slider.style.transform = 'translateY(0)';
                slider.setAttribute('data-current', '0');
                return;
            }
            const current = parseInt(slider.getAttribute('data-current') || '0', 10);
            const normalized = ((current % count) + count) % count;
            slider.setAttribute('data-current', String(normalized));
            slider.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
            slider.style.transform = `translateY(-${normalized * 100}%)`;
        });
    }

    function appendStandaloneRuntime(clonedDoc) {
        const script = clonedDoc.createElement('script');
        script.textContent = `
            (function () {
                function initKpiCarousel() {
                    setInterval(function () {
                        document.querySelectorAll('.kpi-slider[data-count]').forEach(function (slider) {
                            var count = parseInt(slider.getAttribute('data-count'), 10);
                            if (!count || count <= 1) return;
                            var current = parseInt(slider.getAttribute('data-current') || '0', 10);
                            if (current === count) {
                                slider.style.transition = 'none';
                                slider.style.transform = 'translateY(0)';
                                slider.setAttribute('data-current', '0');
                                void slider.offsetHeight;
                                slider.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                                current = 0;
                            }
                            current += 1;
                            slider.setAttribute('data-current', String(current));
                            slider.style.transform = 'translateY(-' + (current * 100) + '%)';
                        });
                    }, 3500);
                }

                function resetScoreFlaps() {
                    document.querySelectorAll('.flap-board').forEach(function (board) {
                        var value = String(board.getAttribute('data-val') || '');
                        board.querySelectorAll('.flap-char').forEach(function (char, idx) {
                            char.textContent = value[idx] || '';
                            char.style.animation = 'none';
                            char.style.transform = 'rotateX(0deg)';
                            char.style.filter = 'brightness(1)';
                        });
                    });
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', function () {
                        resetScoreFlaps();
                        initKpiCarousel();
                    });
                } else {
                    resetScoreFlaps();
                    initKpiCarousel();
                }
            })();
        `;
        clonedDoc.body.appendChild(script);
    }

    async function inlineStylesheets(clonedDoc) {
        const links = Array.from(clonedDoc.querySelectorAll('link[rel="stylesheet"]'));
        await Promise.all(links.map(async link => {
            const href = link.getAttribute('href');
            if (!href) return;
            try {
                const absoluteUrl = new URL(href, window.location.href);
                if (absoluteUrl.origin !== window.location.origin) {
                    link.remove();
                    return;
                }
                const res = await fetch(absoluteUrl.href);
                if (!res.ok) throw new Error(`${res.status}`);
                const css = await res.text();
                const style = clonedDoc.createElement('style');
                style.setAttribute('data-inlined-from', href);
                style.textContent = css;
                link.replaceWith(style);
            } catch (e) {
                console.warn('[bigscreen] stylesheet inline skipped:', href, e);
                link.remove();
            }
        }));
    }

    function getBigscreenExportData() {
        return {
            exportedAt: new Date().toISOString(),
            language: lang(),
            range: getCurrentRange(),
            monthlyPath: state.monthlyPath,
            trends: state.trends || [],
            latest: state.latest || null,
            snapshots: state.snapshots || [],
            owners: state.owners || [],
            contactInfo: state.contactInfo || null,
            dashboardTitle: state.dashboardTitle || null,
            i18nMap: state.i18nMap || {},
            metricOrder: state.metricOrder || [],
            refreshStatusKey: state.refreshStatusKey || '',
            lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt ? state.lastSuccessfulRefreshAt.toISOString() : null
        };
    }

    async function buildStandaloneHtml() {
        const parserDoc = new DOMParser().parseFromString(
            `<!DOCTYPE html>\n${document.documentElement.outerHTML}`,
            'text/html'
        );

        syncCloneFormState(parserDoc);
        replaceCanvasWithImages(parserDoc);
        freezeExportedScoreFlaps(parserDoc);
        normalizeExportedKpiSliders(parserDoc);

        const appNavbar = parserDoc.getElementById('app-navbar');
        if (appNavbar) appNavbar.remove();
        parserDoc.querySelectorAll('[data-export-exclude="true"]').forEach(el => el.remove());
        parserDoc.querySelectorAll('script').forEach(script => script.remove());

        await inlineStylesheets(parserDoc);

        const exportStyle = parserDoc.createElement('style');
        exportStyle.textContent = `
            :root { --navbar-h: 0px !important; }
            .bigscreen { padding-top: 14px !important; }
            @media (max-height: 850px) and (min-width: 1281px) {
                .bigscreen { padding-top: 10px !important; }
            }
        `;
        parserDoc.head.appendChild(exportStyle);

        const dataScript = parserDoc.createElement('script');
        dataScript.type = 'application/json';
        dataScript.id = 'bigscreen-export-data';
        dataScript.textContent = JSON.stringify(getBigscreenExportData()).replace(/</g, '\\u003C');
        parserDoc.body.appendChild(dataScript);

        const generatedMeta = parserDoc.createElement('meta');
        generatedMeta.name = 'bigscreen-exported-at';
        generatedMeta.content = new Date().toISOString();
        parserDoc.head.appendChild(generatedMeta);
        appendStandaloneRuntime(parserDoc);

        return `<!DOCTYPE html>\n${parserDoc.documentElement.outerHTML}`;
    }

    async function exportStandaloneHtml() {
        if (!state.latest && !state.trends.length) {
            if (window.showToast) window.showToast(tr('exportNoData'), 'warn');
            return;
        }

        const btn = $('exportHtmlBtn');
        const prevText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = tr('exportingHtml');
        }

        try {
            Object.values(state.charts).forEach(chart => chart && chart.resize && chart.resize());
            const html = await buildStandaloneHtml();
            const date = new Date();
            const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
            downloadTextFile(`bigscreen-dashboard-${stamp}.html`, html);
            if (window.showToast) window.showToast(tr('exportDone'), 'success');
        } catch (e) {
            console.error('[bigscreen] export html failed:', e);
            if (window.showToast) window.showToast(tr('exportFailed', { message: e.message }), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = prevText || tr('exportHtml');
            }
        }
    }

    function metricSummary(latest) {
        const metrics = Array.isArray(latest && latest.metrics) ? latest.metrics : [];
        const failing = metrics.filter(item => Number(item.is_failing) === 1);
        const pass = Math.max(metrics.length - failing.length, 0);
        const metricLabels = [...new Set(metrics.map(item => item.metric_label || '未命名指标'))];
        const failingLabels = [...new Set(failing.map(item => item.metric_label || '未命名指标'))];
        return {
            total: metrics.length,
            failing: failing.length,
            pass,
            passRate: metrics.length ? pass / metrics.length * 100 : 0,
            metricTotal: metricLabels.length,
            metricFailing: failingLabels.length,
            metricPassing: Math.max(metricLabels.length - failingLabels.length, 0),
            metricPassRate: metricLabels.length ? (metricLabels.length - failingLabels.length) / metricLabels.length * 100 : 0
        };
    }

    function scoreTone(score) {
        if (score >= 95) return 'good';
        if (score >= 85) return 'warn';
        return 'bad';
    }

    function renderKpis() {
        const latest = state.latest || {};
        const raw = parseRaw(latest.raw_data_json);

        const tickets = Array.isArray(raw.expiringTickets) ? raw.expiringTickets : [];
        const alerts = Array.isArray(raw.specialMetricAlerts) ? raw.specialMetricAlerts : [];

        const groups = [
            { id: 'vulnerability', title: isEn() ? 'Vulnerability Alerts' : '漏洞预警', emptyTitle: isEn() ? 'vulnerability alerts' : '漏洞', icon: '🧯', items: tickets.filter(t => t.collection === 'vulnerability'), type: 'ticket' },
            { id: 'rectification', title: isEn() ? 'Rectification Alerts' : '整改预警', emptyTitle: isEn() ? 'rectification alerts' : '整改', icon: '🛠️', items: tickets.filter(t => t.collection === 'rectification'), type: 'ticket' },
            { id: 'risk_sr', title: isEn() ? 'Risk/Special/SR Alerts' : '风险/专项/工单预警', emptyTitle: isEn() ? 'risk/SR alerts' : '风险/专项/工单', icon: '📞', items: tickets.filter(t => ['risk', 'special', 'sr'].includes(t.collection)), type: 'ticket' },
            { id: 'metric_alerts', title: isEn() ? 'Global Metric Alerts' : '全局指标告警', emptyTitle: isEn() ? 'global metric alerts' : '全局指标', icon: '🚨', items: alerts, type: 'alert' }
        ];

        $('kpiRow').innerHTML = groups.map(group => {
            let slidesHtml = '';

            if (group.items.length === 0) {
                slidesHtml = `<div class="kpi-empty">✅ ${escapeHTML(tr('currentNo', { title: group.emptyTitle }))}</div>`;
            } else {
                const slideDivs = group.items.map(item => {
                    if (group.type === 'ticket') {
                        const tId = item.data?.task_id || item.data?.sr_num || item.data?.precaution_id || item.title || 'Unknown';
                        const net = item.data?.network_name || item.data?.network_cust_name || item.data?.customer_name_cn || tr('global');
                        let statusText = item._slaCleanText || item.data?.task_status || item._srStatus || tr('processing');
                        let badgeClass = 'safe';
                        if (statusText.includes('紧急') || statusText.includes('严重') || statusText.includes('超期')) {
                            badgeClass = 'danger';
                        } else if (statusText.includes('预警') || statusText.includes('剩余')) {
                            badgeClass = 'warning';
                        }

                        return `
                            <div class="kpi-slide-item">
                                <div class="kpi-slide-row1">
                                    <div class="kpi-ticket-id" title="${escapeHTML(tId)}">${escapeHTML(tId)}</div>
                                    <div class="kpi-status-badge ${badgeClass}">${escapeHTML(statusText)}</div>
                                </div>
                                <div class="kpi-slide-row2">
                                    <div class="kpi-network" title="${escapeHTML(net)}">${escapeHTML(net)}</div>
                                </div>
                            </div>
                        `;
                    } else {
                        // Alert
                        const label = translated(item.metricLabel || item.metric_label || tr('unknownMetric'));
                        const val = item.globalValue || item.global_val || '-';
                        const target = item.targetValue || item.target_val || '-';
                        const gap = item.gap ? `${tr('gap')} ${item.gap}` : tr('failingItems');

                        return `
                            <div class="kpi-slide-item">
                                <div class="kpi-slide-row1">
                                    <div class="kpi-metric-val" title="${escapeHTML(label)}">${escapeHTML(label)}: ${escapeHTML(val)}</div>
                                    <div class="kpi-status-badge danger">${escapeHTML(gap)}</div>
                                </div>
                                <div class="kpi-slide-row2">
                                    <div class="kpi-network">${escapeHTML(tr('target'))}: ${escapeHTML(target)}</div>
                                </div>
                            </div>
                        `;
                    }
                });

                // For seamless looping, append a copy of the first slide at the end if count > 1
                const renderedSlides = slideDivs.join('');
                slidesHtml = slideDivs.length > 1 ? renderedSlides + slideDivs[0] : renderedSlides;
            }

            return `
                <div class="kpi">
                    <div class="kpi-title">
                        <span class="kpi-title-icon">${group.icon}</span>
                        ${escapeHTML(group.title)} <span style="font-size: 14px; opacity: 0.8; margin-left: 4px;">(${group.items.length})</span>
                    </div>
                    <div class="kpi-slider-wrap">
                        <div class="kpi-slider" data-count="${group.items.length}" data-current="0" style="transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);">
                            ${slidesHtml}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        initKpiCarousel();
    }

    let kpiRotationInterval = null;
    function initKpiCarousel() {
        if (kpiRotationInterval) clearInterval(kpiRotationInterval);

        kpiRotationInterval = setInterval(() => {
            const sliders = document.querySelectorAll('.kpi-slider[data-count]');
            sliders.forEach(slider => {
                const count = parseInt(slider.getAttribute('data-count'), 10);
                if (count <= 1) return;

                let current = parseInt(slider.getAttribute('data-current') || '0', 10);

                if (current === count) {
                    slider.style.transition = 'none';
                    slider.style.transform = `translateY(0)`;
                    slider.setAttribute('data-current', '0');
                    void slider.offsetHeight;
                    slider.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                    current = 0;
                }

                current++;
                slider.setAttribute('data-current', current);
                slider.style.transform = `translateY(-${current * 100}%)`;
            });
        }, 3500);
    }

    function groupFailingCustomers() {
        const metrics = Array.isArray(state.latest && state.latest.metrics) ? state.latest.metrics : [];
        const grouped = {};
        metrics.filter(item => Number(item.is_failing) === 1).forEach(item => {
            const cat = item.cat_name || '-';
            if (!grouped[cat]) grouped[cat] = { cat, count: 0, metrics: [] };
            grouped[cat].count += 1;
            grouped[cat].metrics.push(item.metric_label || '未命名指标');
        });
        return Object.values(grouped).sort((a, b) => b.count - a.count || a.cat.localeCompare(b.cat));
    }

    function renderFlapChars(valueStr) {
        return String(valueStr).split('').map(char => `<span class="flap-char">${char}</span>`).join('');
    }

    function renderRankScore(score) {
        const value = fmt(score, 1);
        const theme = normalizeRankScoreTheme(state.rankScoreTheme);
        const label = escapeHTML(tr('scoreUnit'));
        const title = escapeHTML(isEn()
            ? `Click to switch score theme. Current: ${getRankScoreThemeLabel(theme)}`
            : `点击切换分数显示主题，当前: ${getRankScoreThemeLabel(theme)}`);
        if (theme === 'plain') {
            return `
                <button class="rank-score rank-score-button rank-score-plain" type="button" data-score-theme-trigger="true" title="${title}">
                    <span class="rank-score-number">${escapeHTML(value)}</span>
                    <span class="rank-score-label">${label}</span>
                </button>
            `;
        }
        if (theme === 'neon') {
            return `
                <button class="rank-score rank-score-button rank-score-neon" type="button" data-score-theme-trigger="true" title="${title}">
                    <span class="score-pill score-pill-neon">${escapeHTML(value)}</span>
                    <span class="rank-score-label">${label}</span>
                </button>
            `;
        }
        return `
            <button class="rank-score rank-score-button rank-score-flap" type="button" data-score-theme-trigger="true" title="${title}">
                <span class="flap-board" data-val="${escapeHTML(value)}">
                    ${renderFlapChars(value)}
                </span>
                <span class="rank-score-label">${label}</span>
            </button>
        `;
    }

    function renderRankList() {
        const rows = getCustomerScoreRows();
        if (!rows.length) {
            $('rankList').style.gridTemplateColumns = '';
            $('rankList').style.gridTemplateRows = '';
            $('rankList').innerHTML = `<div class="empty">${escapeHTML(tr('noFailingCustomers'))}</div>`;
            if ($('rankSummary')) $('rankSummary').textContent = tr('rankStable');
            return;
        }
        $('rankList').setAttribute('data-score-theme', normalizeRankScoreTheme(state.rankScoreTheme));
        $('rankList').style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
        $('rankList').style.gridTemplateRows = 'repeat(2, minmax(0, 1fr))';
        $('rankList').innerHTML = rows.slice(0, 4).map((item, index) => {
            return `
            <div class="rank-row">
                <div class="rank-no">${index + 1}</div>
                <div>
                    <div class="row-name" title="${escapeHTML(translated(item.cat))}">${escapeHTML(translated(item.cat))}</div>
                </div>
                ${renderRankScore(item.score)}
            </div>
        `;
        }).join('');

        renderRankThemeHint();
        if (normalizeRankScoreTheme(state.rankScoreTheme) === 'flap') startScoreFlipAnimation();
        renderRankSummary(rows);
    }

    function getCustomerScoreRows() {
        const failingRows = groupFailingCustomers();
        const failingMap = {};
        failingRows.forEach(item => { failingMap[item.cat] = item.metrics || []; });
        const catScores = Array.isArray(state.latest && state.latest.cat_scores) ? state.latest.cat_scores : [];
        return [...catScores]
            .map(item => ({
                cat: item.cat_name || '-',
                score: num(item.final_score, 0),
                baseScore: num(item.base_score, 0),
                manualScore: num(item.manual_score, 0),
                metrics: failingMap[item.cat_name] || []
            }))
            .sort((a, b) => b.score - a.score || a.cat.localeCompare(b.cat));
    }

    function renderRankSummary(rows) {
        if (!rows.length) return;
        const first = rows[0];
        const last = rows[rows.length - 1];
        const riskLeader = [...rows].sort((a, b) => b.metrics.length - a.metrics.length || a.score - b.score)[0];
        $('rankSummary').innerHTML = `
            ${tr('rankSummary', {
            firstCat: escapeHTML(translated(first.cat)),
            firstScore: fmt(first.score, 1),
            lastRank: rows.length,
            lastCat: escapeHTML(translated(last.cat)),
            lastScore: fmt(last.score, 1)
        })}
            ${riskLeader && riskLeader.metrics.length ? tr('rankRiskLeader', { cat: escapeHTML(translated(riskLeader.cat)), count: riskLeader.metrics.length }) : ''}
        `;
    }

    function getMetricSortIndex(label) {
        if (!state.metricOrder) return 9999;
        const idx = state.metricOrder.indexOf(label);
        return idx >= 0 ? idx : 9999;
    }

    function groupFailingMetrics() {
        const metrics = Array.isArray(state.latest && state.latest.metrics) ? state.latest.metrics : [];
        const grouped = {};
        metrics.filter(item => Number(item.is_failing) === 1).forEach(item => {
            const label = item.metric_label || '未命名指标';
            if (!grouped[label]) {
                grouped[label] = {
                    label,
                    count: 0,
                    cats: [],
                    values: [],
                    targets: [],
                    rows: []
                };
            }
            grouped[label].count += 1;
            grouped[label].cats.push(item.cat_name || '-');
            grouped[label].values.push(item.raw_val ?? item.num_val ?? '-');
            grouped[label].targets.push(item.target_val || '-');
            grouped[label].rows.push(item);
        });
        return Object.values(grouped).sort((a, b) => {
            return getMetricSortIndex(a.label) - getMetricSortIndex(b.label) || b.count - a.count || a.label.localeCompare(b.label);
        });
    }

    function getGroupedTargetText(item) {
        const targets = [...new Set((item.targets || []).filter(value => value && value !== '-'))];
        if (!targets.length) return '-';
        return targets.length === 1 ? targets[0] : tr('byCategoryTarget');
    }

    function parseMetricNumber(value) {
        const raw = String(value ?? '').replace(/,/g, '');
        const match = raw.match(/-?\d+(?:\.\d+)?/);
        if (!match) return null;
        const parsed = Number(match[0]);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function failSeverityScore(row) {
        const completion = Number(row && row.completion_ratio);
        if (Number.isFinite(completion)) {
            return Math.max(0, 1 - completion);
        }

        const gap = parseMetricNumber(row && row.gap);
        if (gap !== null) return Math.abs(gap);

        const rawVal = parseMetricNumber(row && (row.raw_val ?? row.num_val));
        const targetVal = parseMetricNumber(row && row.target_val);
        if (rawVal === null || targetVal === null) return 0;

        const base = Math.max(Math.abs(targetVal), 1);
        const targetText = String(row.target_val || '');
        if (targetText.includes('≤') || targetText.includes('<=')) {
            return Math.max(0, (rawVal - targetVal) / base);
        }
        return Math.max(0, (targetVal - rawVal) / base);
    }

    function severityClass(row, maxScore) {
        const score = failSeverityScore(row);
        if (score <= 0) return 'severity-low';
        if (maxScore > 0 && score >= maxScore * 0.72) return 'severity-high';
        if (maxScore > 0 && score >= maxScore * 0.36) return 'severity-mid';
        if (score >= 0.2) return 'severity-high';
        if (score >= 0.06) return 'severity-mid';
        return 'severity-low';
    }



    function ownerKey(cat, metric = '') {
        return `${String(cat || '').trim()}@@${String(metric || '').trim()}`;
    }

    function ownerMap() {
        const map = {};
        (state.owners || []).forEach(item => {
            map[ownerKey(item.cat_name, item.metric_label)] = item;
        });
        return map;
    }

    function resolveOwnersForMetric(item) {
        const map = ownerMap();
        const sortedRows = [...(item.rows || [])].sort((a, b) => failSeverityScore(b) - failSeverityScore(a));
        const ownersMap = new Map();

        for (const row of sortedRows) {
            let owner = map[ownerKey(row.cat_name, item.label)];
            if (!owner) owner = map[ownerKey(row.cat_name, '')];
            if (owner) {
                const key = owner.owner_name + '|' + (owner.emp_id || '');
                if (!ownersMap.has(key)) {
                    ownersMap.set(key, { ...owner, managedCats: new Set([row.cat_name]) });
                } else {
                    ownersMap.get(key).managedCats.add(row.cat_name);
                }
            }
        }

        if (ownersMap.size === 0) {
            let owner = map[ownerKey('整体', item.label)] || map[ownerKey('', item.label)] || map[ownerKey('全局', item.label)];
            if (owner) {
                const key = owner.owner_name + '|' + (owner.emp_id || '');
                ownersMap.set(key, { ...owner, managedCats: new Set([tr('ownerFallbackCat')]) });
            }
        }

        if (ownersMap.size === 0) {
            (state.owners || []).forEach(o => {
                if (!o.owner_name) return;
                const key = o.owner_name + '|' + (o.emp_id || '');
                if (!ownersMap.has(key)) {
                    ownersMap.set(key, { ...o, managedCats: new Set([tr('ownerDefaultLoop')]) });
                }
            });
        }

        return Array.from(ownersMap.values());
    }

    let ownerRotationInterval = null;

    function initOwnerRotation() {
        if (ownerRotationInterval) clearInterval(ownerRotationInterval);

        ownerRotationInterval = setInterval(() => {
            const sliders = document.querySelectorAll('.owner-slider[data-count]');
            sliders.forEach(slider => {
                const count = parseInt(slider.getAttribute('data-count'), 10);
                if (count <= 1) return;

                let current = parseInt(slider.getAttribute('data-current') || '0', 10);

                if (current === count) {
                    slider.style.transition = 'none';
                    slider.style.transform = `translateY(0)`;
                    current = 0;
                    void slider.offsetHeight;
                    slider.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                }

                current++;
                slider.setAttribute('data-current', current);
                slider.style.transform = `translateY(-${current * 100}%)`;

                updateChipHighlights(slider, count, current);
            });
        }, 3000);
    }

    function updateChipHighlights(slider, count, current) {
        const realIdx = current % count;
        const activeItem = slider.children[realIdx];
        if (!activeItem) return;

        const catNames = (activeItem.getAttribute('data-cats') || '').split(',');
        const card = slider.closest('.risk-card');
        if (!card) return;

        const chips = card.querySelectorAll('.cat-chip');
        chips.forEach(chip => {
            const chipCat = chip.getAttribute('data-cat');
            if (catNames.includes(chipCat)) {
                chip.classList.add('active-highlight');
                chip.classList.remove('dimmed');
            } else {
                chip.classList.remove('active-highlight');
                chip.classList.add('dimmed');
            }
        });
    }

    function startScoreFlipAnimation() {
        if (normalizeRankScoreTheme(state.rankScoreTheme) !== 'flap') return;
        const boards = document.querySelectorAll('.flap-board');
        if (!boards.length) return;

        boards.forEach((board) => {
            const realVal = String(board.getAttribute('data-val'));
            const chars = board.querySelectorAll('.flap-char');

            // Random start delay for the whole board (0 - 400ms)
            const boardDelay = Math.random() * 400;

            setTimeout(() => {
                chars.forEach((c, idx) => {
                    if (c.dataset.flipping) return;

                    const finalChar = realVal[idx] || '';
                    if (finalChar === '.') {
                        c.textContent = finalChar;
                        return;
                    }

                    c.dataset.flipping = "true";

                    // Each digit starts with a slightly random offset (0 - 150ms)
                    const charStartOffset = Math.random() * 150;

                    setTimeout(() => {
                        // Random mechanical speed (120ms - 220ms per full flip)
                        const speed = Math.floor(Math.random() * 100) + 120;

                        // Right-most digits flip more times (like an odometer settling)
                        // Range: ~4 flips for first digit, up to ~15 flips for last digit
                        const minFlips = 4 + idx * 3;
                        const targetFlips = Math.floor(Math.random() * 6) + minFlips;

                        c.style.animation = `flapTurn ${speed}ms linear infinite`;

                        let flips = 0;
                        setTimeout(() => {
                            const scramble = setInterval(() => {
                                c.textContent = Math.floor(Math.random() * 10).toString();
                                flips++;
                                if (flips >= targetFlips) {
                                    clearInterval(scramble);
                                    c.textContent = finalChar;
                                    setTimeout(() => {
                                        c.style.animation = 'none';
                                        delete c.dataset.flipping;
                                    }, speed / 2); // Wait for the final half-cycle to finish returning to 0deg
                                }
                            }, speed);
                        }, speed / 2); // Text changes exactly when flipped 90deg edge-on
                    }, charStartOffset);
                });
            }, boardDelay);
        });
    }

    function renderWeakList() {
        const rows = groupFailingMetrics();
        const countDom = $('failingMetricsCount');

        if (!rows.length) {
            if (countDom) countDom.textContent = '';
            $('weakList').innerHTML = `<div class="empty">${escapeHTML(tr('emptyWeak'))}</div>`;
            return;
        }

        if (countDom) {
            const distinctFailingMetrics = rows.length;
            const totalFailingRows = rows.reduce((acc, r) => acc + (r.rows ? r.rows.length : r.count), 0);
            countDom.textContent = tr('failingMetricCount', { metrics: distinctFailingMetrics, rows: totalFailingRows });
        }

        const loopRows = rows.length > 4 ? rows.concat(rows) : rows;
        const rowCount = Math.ceil(loopRows.length / 2);
        const duration = Math.max(8, rowCount * 6); // 6s per row for steady readable speed, min 8s
        $('weakList').innerHTML = `
            <div class="weak-scroll-track" style="${rows.length > 4 ? `animation: weakScroll ${duration}s linear infinite;` : 'animation:none;'}">
                ${loopRows.map(item => `
            <div class="weak-row risk-card">
                <div class="risk-main">
                    <div class="risk-metric-title">
                        <div class="row-name" title="${escapeHTML(translated(item.label))}">${escapeHTML(translated(item.label))}</div>
                        <span class="risk-count-badge" title="${escapeHTML(tr('failedCustomerGroups'))}">${item.count}</span>
                    </div>
                    <div class="risk-detail">
                        <div class="row-meta">${escapeHTML(tr('target'))} ${escapeHTML(getGroupedTargetText(item))}</div>
                        <div class="risk-cats">
                            ${(() => {
                const sortedRows = [...item.rows].sort((a, b) => failSeverityScore(b) - failSeverityScore(a));
                const maxScore = sortedRows.length ? failSeverityScore(sortedRows[0]) : 0;
                return sortedRows.map(row => `
                                <span class="cat-chip ${severityClass(row, maxScore)}" data-cat="${escapeHTML(row.cat_name || '-')}" title="${escapeHTML(translated(row.cat_name || '-'))} | ${escapeHTML(tr('actual'))} ${escapeHTML(row.raw_val ?? row.num_val ?? '-')} | ${escapeHTML(tr('target'))} ${escapeHTML(row.target_val || '-')} | ${escapeHTML(tr('deviation'))} ${fmt(failSeverityScore(row) * 100, 1)}">
                                    ${escapeHTML(translated(row.cat_name || '-'))}：${escapeHTML(row.raw_val ?? row.num_val ?? '-')} / ${escapeHTML(tr('target'))} ${escapeHTML(row.target_val || '-')}
                                </span>
                                `).join('');
            })()}
                        </div>
                    </div>
                </div>
                ${renderOwnerBlock(item)}
            </div>
                `).join('')}
            </div>
        `;

        const sliders = document.querySelectorAll('.owner-slider[data-count]');
        sliders.forEach(slider => {
            const count = parseInt(slider.getAttribute('data-count'), 10);
            if (count > 1) {
                updateChipHighlights(slider, count, 0);
            }
        });

        initOwnerRotation();
    }

    function renderManualAdjustStrip() {
        const strip = $('manualItemsStrip');
        if (!strip) return;

        const prefs = state.globalConfig && state.globalConfig.prefs ? state.globalConfig.prefs : {};
        const latest = state.latest || {};
        const raw = parseRaw(latest.raw_data_json);
        const manualItems = Array.isArray(raw.manualAdjustItems) ? raw.manualAdjustItems : (Array.isArray(prefs.manualAdjustItems) ? prefs.manualAdjustItems : []);
        const manualAdjustData = raw.manualAdjustData || {};

        const activeItems = [];
        Object.keys(manualAdjustData).forEach(cat => {
            const catData = manualAdjustData[cat];
            Object.keys(catData).forEach(idx => {
                const count = parseInt(catData[idx], 10) || 0;
                if (count > 0 && manualItems[idx] && !manualItems[idx].deleted) {
                    const itemDef = manualItems[idx];
                    const unit = parseFloat(itemDef.unit) || 0;
                    activeItems.push({
                        cat: cat,
                        name: itemDef.name || '未命名配置',
                        type: itemDef.type || '扣分',
                        count: count,
                        totalScore: count * unit
                    });
                }
            });
        });

        if (!activeItems.length) {
            strip.innerHTML = `<div style="color:#6e8ca8; font-size:12px;">${escapeHTML(tr('manualEmpty'))}</div>`;
            return;
        }

        const itemsHtml = activeItems.map(item => {
            const isAdd = item.type === '加分';
            const sign = isAdd ? '+' : '-';
            const typeText = isAdd ? tr('add') : tr('deduct');
            return `
                <div class="manual-item">
                    <span class="manual-item-type ${item.type}">${escapeHTML(typeText)}</span>
                    <span class="manual-item-name" style="color:var(--cyan); margin-right: 8px;">[${escapeHTML(translated(item.cat))}]</span>
                    <span class="manual-item-name">${escapeHTML(translated(item.name))}</span>
                    <span class="manual-item-desc">${escapeHTML(tr('manualDesc', { count: item.count, sign, score: item.totalScore }))}</span>
                </div>
            `;
        }).join('');

        strip.innerHTML = `
            <div class="manual-track" data-count="${activeItems.length}" data-current="0">
                ${itemsHtml}
                ${itemsHtml}
            </div>
        `;

        initManualRotation();
    }

    let manualRotationInterval = null;

    function initManualRotation() {
        if (manualRotationInterval) clearInterval(manualRotationInterval);

        manualRotationInterval = setInterval(() => {
            const sliders = document.querySelectorAll('.manual-track[data-count]');
            sliders.forEach(slider => {
                const count = parseInt(slider.getAttribute('data-count'), 10);
                if (count <= 1) return;

                let current = parseInt(slider.getAttribute('data-current') || '0', 10);

                if (current === count) {
                    slider.style.transition = 'none';
                    slider.style.transform = `translateY(0)`;
                    current = 0;
                    void slider.offsetHeight;
                    slider.style.transition = 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
                }

                current++;
                slider.setAttribute('data-current', current);
                slider.style.transform = `translateY(-${current * 100}%)`;
            });
        }, 4000); // Wait 4 seconds per item
    }

    function isImageAvatar(value) {
        return /^https?:\/\//i.test(String(value || '')) || /^data:image\//i.test(String(value || ''));
    }

    function avatarMarkup(owner, className = 'owner-avatar') {
        const avatar = String(owner && owner.avatar || '').trim();
        const name = String(owner && owner.owner_name || '').trim();
        if (avatar && isImageAvatar(avatar)) {
            return `<span class="${className}"><img src="${escapeHTML(avatar)}" alt=""></span>`;
        }
        const label = avatar || name.slice(0, 1) || (isEn() ? 'O' : '责');
        return `<span class="${className}">${escapeHTML(label.slice(0, 2))}</span>`;
    }

    function renderOwnerBlock(item) {
        const owners = resolveOwnersForMetric(item);
        if (!owners.length) {
            return `
                <div class="risk-owner" title="${escapeHTML(tr('ownerPending'))}">
                    <div class="owner-slider">
                        <div class="owner-slide-item">
                            <span class="owner-avatar">${escapeHTML(isEn() ? 'O' : '责')}</span>
                            <span class="owner-name">${escapeHTML(tr('ownerTodo'))}</span>
                        </div>
                    </div>
                </div>
            `;
        }

        const tooltip = owners.map(o => `${o.owner_name} (${o.emp_id || tr('ownerNone')}) - ${translated(o.cat_name)}`).join('\\n');

        if (owners.length === 1) {
            const owner = owners[0];
            const empIdHtml = owner.emp_id ? `<span class="owner-empid">${escapeHTML(owner.emp_id)}</span>` : '';
            return `
                <div class="risk-owner" title="${escapeHTML(tooltip)}">
                    <div class="owner-slider">
                        <div class="owner-slide-item">
                            ${avatarMarkup(owner)}
                            <span class="owner-name">${escapeHTML(owner.owner_name)}</span>
                            ${empIdHtml}
                        </div>
                    </div>
                </div>
            `;
        }

        const maxN = Math.min(owners.length, 10);
        const displayOwners = owners.slice(0, maxN);
        const sliderItems = [...displayOwners, displayOwners[0]];

        return `
            <div class="risk-owner" title="${escapeHTML(tooltip)}">
                <div class="owner-slider" data-count="${maxN}" data-current="0" style="transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);">
                    ${sliderItems.map(owner => {
            const empIdHtml = owner.emp_id ? `<span class="owner-empid">${escapeHTML(owner.emp_id)}</span>` : '';
            const cats = Array.from(owner.managedCats || []).join(',');
            return `
                            <div class="owner-slide-item" data-cats="${escapeHTML(cats)}">
                                ${avatarMarkup(owner)}
                                <span class="owner-name">${escapeHTML(owner.owner_name)}</span>
                                ${empIdHtml}
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    function renderMetricList() {
        const metrics = Array.isArray(state.latest && state.latest.metrics) ? state.latest.metrics : [];
        const countDom = $('passingMetricsCount');

        if (!metrics.length) {
            if (countDom) countDom.textContent = '';
            $('metricList').innerHTML = `<div class="empty">${escapeHTML(tr('emptyMetricData'))}</div>`;
            return;
        }
        const passRows = metrics
            .filter(item => Number(item.is_failing) !== 1)
            .sort((a, b) => {
                const labelA = String(a.metric_label || '');
                const labelB = String(b.metric_label || '');
                return getMetricSortIndex(labelA) - getMetricSortIndex(labelB) || labelA.localeCompare(labelB);
            });

        if (countDom) {
            if (passRows.length > 0) {
                const distinctPassingMetrics = new Set(passRows.map(m => m.metric_label)).size;
                const totalPassingRows = passRows.length;
                countDom.textContent = tr('passingMetricCount', { metrics: distinctPassingMetrics, rows: totalPassingRows });
            } else {
                countDom.textContent = '';
            }
        }

        if (!passRows.length) {
            $('metricList').innerHTML = `<div class="empty">${escapeHTML(tr('emptyPassing'))}</div>`;
            return;
        }
        const shouldScroll = passRows.length > 6;
        const rowCount = Math.ceil(passRows.length / 2);
        const duration = Math.max(18, rowCount * 6);
        const renderPassItems = rows => rows.map(item => `
            <div class="pass-item">
                <span class="pass-check">✓</span>
                <span class="pass-text">
                    <strong title="${escapeHTML(translated(item.metric_label))}">${escapeHTML(translated(item.metric_label || '-'))}</strong>
                    <span>${escapeHTML(translated(item.cat_name || '-'))} · ${escapeHTML(tr('actual'))} ${escapeHTML(item.raw_val ?? item.num_val ?? '-')} · ${escapeHTML(tr('target'))} ${escapeHTML(item.target_val || '-')}</span>
                </span>
            </div>
        `).join('');
        $('metricList').innerHTML = `
            <div class="pass-track" style="${shouldScroll ? `--pass-scroll-duration: ${duration}s;` : ''}">
                <div class="pass-page">${renderPassItems(passRows)}</div>
                ${shouldScroll ? `<div class="pass-page" aria-hidden="true">${renderPassItems(passRows)}</div>` : ''}
            </div>
        `;
        restartAutoScroll('metricList', '.pass-track', shouldScroll);
    }

    function restartAutoScroll(containerId, trackSelector, shouldScroll) {
        const container = $(containerId);
        const track = container ? container.querySelector(trackSelector) : null;
        if (!track) return;
        track.classList.remove('is-scrolling');
        if (!shouldScroll) return;
        window.requestAnimationFrame(() => {
            // Force a layout read so the animation starts after the panel height is stable.
            void track.offsetHeight;
            window.requestAnimationFrame(() => {
                track.classList.add('is-scrolling');
            });
        });
    }

    function getOwnerOptions() {
        const metrics = Array.isArray(state.latest && state.latest.metrics) ? state.latest.metrics : [];
        const cats = [...new Set(metrics.map(item => item.cat_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        const metricLabels = [...new Set(metrics.map(item => item.metric_label).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        return { cats, metricLabels };
    }

    function renderOwnerOptions() {
        const { cats, metricLabels } = getOwnerOptions();
        const catSelect = $('ownerCatSelect');
        const metricSelect = $('ownerMetricSelect');

        const catsList = cats.filter(c => c !== '整体' && c !== '全局');
        if (catSelect) {
            catSelect.innerHTML = [
                `<option value="整体">${escapeHTML(tr('ownerGlobal'))}</option>`,
                ...catsList.map(cat => `<option value="${escapeHTML(cat)}">${escapeHTML(translated(cat))}</option>`)
            ].join('');
        }
        if (metricSelect) {
            metricSelect.innerHTML = [
                `<option value="">${escapeHTML(tr('ownerDefault'))}</option>`,
                ...metricLabels.map(label => `<option value="${escapeHTML(label)}">${escapeHTML(translated(label))}</option>`)
            ].join('');
        }
    }

    function renderOwnerRows() {
        const tbody = $('ownerRows');
        if (!tbody) return;
        if (!state.ownerDraft.length) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#8ea8c5;padding:22px;">${escapeHTML(tr('noOwners'))}</td></tr>`;
            return;
        }
        tbody.innerHTML = state.ownerDraft.map((item, index) => `
            <tr>
                <td>${avatarMarkup(item, 'owner-mini-avatar')}</td>
                <td>${escapeHTML(translated(item.cat_name))}</td>
                <td>${escapeHTML(item.metric_label ? translated(item.metric_label) : tr('ownerDefault'))}</td>
                <td>${escapeHTML(item.owner_name)}</td>
                <td>${escapeHTML(item.emp_id || '-')}</td>
                <td>
                    <span class="owner-edit" onclick="BigscreenOwners.edit(${index})" style="color:var(--cyan);cursor:pointer;margin-right:8px;">${escapeHTML(tr('edit'))}</span>
                    <span class="owner-delete" onclick="BigscreenOwners.remove(${index})">${escapeHTML(tr('delete'))}</span>
                </td>
            </tr>
        `).join('');
    }

    function resetOwnerAvatarPicker() {
        state.pendingOwnerAvatar = '';
        const input = $('ownerAvatarInput');
        const preview = $('ownerAvatarPreview');
        const label = $('ownerAvatarLabel');
        if (input) input.value = '';
        if (preview) preview.innerHTML = tr('avatarPlaceholder');
        if (label) label.textContent = tr('uploadAvatar');
    }

    function resizeAvatarFile(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type || !file.type.startsWith('image/')) {
                reject(new Error(tr('chooseImage')));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const size = 96;
                    const canvas = document.createElement('canvas');
                    canvas.width = size;
                    canvas.height = size;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, size, size);
                    const scale = Math.max(size / img.width, size / img.height);
                    const w = img.width * scale;
                    const h = img.height * scale;
                    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = () => reject(new Error(tr('avatarReadFail')));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error(tr('avatarReadFail')));
            reader.readAsDataURL(file);
        });
    }

    async function handleOwnerAvatarChange(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            resetOwnerAvatarPicker();
            return;
        }
        try {
            const dataUrl = await resizeAvatarFile(file);
            state.pendingOwnerAvatar = dataUrl;
            const preview = $('ownerAvatarPreview');
            const label = $('ownerAvatarLabel');
            if (preview) preview.innerHTML = `<img src="${escapeHTML(dataUrl)}" alt="">`;
            if (label) label.textContent = file.name;
        } catch (error) {
            resetOwnerAvatarPicker();
            if (window.showToast) window.showToast(error.message, 'error');
        }
    }

    let editingOwnerIndex = -1;

    function openOwnerModal() {
        state.ownerDraft = (state.owners || []).map(item => ({ ...item }));
        editingOwnerIndex = -1;
        if ($('btnAddOwner')) $('btnAddOwner').textContent = tr('addBtn');
        resetOwnerAvatarPicker();
        renderOwnerOptions();
        renderOwnerRows();
        const modal = $('ownerModal');
        if (modal) {
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
        }
    }

    function closeOwnerModal() {
        const modal = $('ownerModal');
        if (modal) {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    function editOwnerDraft(index) {
        editingOwnerIndex = index;
        const item = state.ownerDraft[index];
        if ($('ownerCatSelect')) $('ownerCatSelect').value = item.cat_name;
        if ($('ownerMetricSelect')) $('ownerMetricSelect').value = item.metric_label || '';
        if ($('ownerNameInput')) $('ownerNameInput').value = item.owner_name;
        if ($('ownerEmpIdInput')) $('ownerEmpIdInput').value = item.emp_id || '';
        if (item.avatar) {
            state.pendingOwnerAvatar = item.avatar;
            if ($('ownerAvatarPreview')) $('ownerAvatarPreview').innerHTML = `<img src="${escapeHTML(item.avatar)}" alt="">`;
            if ($('ownerAvatarLabel')) $('ownerAvatarLabel').textContent = tr('avatarSelected');
        } else {
            resetOwnerAvatarPicker();
        }
        if ($('btnAddOwner')) $('btnAddOwner').textContent = tr('updateSave');
    }

    function addOwnerDraft() {
        const cat = $('ownerCatSelect') ? $('ownerCatSelect').value : '';
        const metric = $('ownerMetricSelect') ? $('ownerMetricSelect').value : '';
        const name = $('ownerNameInput') ? $('ownerNameInput').value.trim() : '';
        const empId = $('ownerEmpIdInput') ? $('ownerEmpIdInput').value.trim() : '';
        const avatar = state.pendingOwnerAvatar || '';
        if (!cat || !name) {
            if (window.showToast) window.showToast(tr('ownerRequired'), 'error');
            return;
        }
        const next = { cat_name: cat, metric_label: metric, owner_name: name, emp_id: empId, avatar };

        if (editingOwnerIndex >= 0) {
            state.ownerDraft[editingOwnerIndex] = next;
            editingOwnerIndex = -1;
            if ($('btnAddOwner')) $('btnAddOwner').textContent = tr('addBtn');
        } else {
            const idx = state.ownerDraft.findIndex(item => item.cat_name === cat && (item.metric_label || '') === metric);
            if (idx >= 0) state.ownerDraft[idx] = next;
            else state.ownerDraft.push(next);
        }

        if ($('ownerNameInput')) $('ownerNameInput').value = '';
        if ($('ownerEmpIdInput')) $('ownerEmpIdInput').value = '';
        resetOwnerAvatarPicker();
        renderOwnerRows();
    }

    function removeOwnerDraft(index) {
        state.ownerDraft.splice(index, 1);
        renderOwnerRows();
    }

    async function saveOwners() {
        try {
            await window.API.post('/api/db/config/bigscreen_owners', { items: state.ownerDraft });
            state.owners = state.ownerDraft.map(item => ({ ...item }));
            closeOwnerModal();
            renderWeakList();
            if (window.showToast) window.showToast(tr('ownerSaved', { count: state.ownerDraft.length }));
        } catch (error) {
            console.error('[bigscreen] save owners failed:', error);
            if (window.showToast) window.showToast(tr('saveFailed', { message: error.message }), 'error');
        }
    }

    function chartTextColor() {
        return '#b7cbe0';
    }

    function renderTrendChart() {
        const dom = $('trendChart');
        if (!dom || !window.echarts) return;
        const trends = state.trends || [];
        if (!state.charts.trend) state.charts.trend = echarts.init(dom);
        const chartHeight = dom.clientHeight || 220;
        const splitNumber = chartHeight < 210 ? 3 : (chartHeight < 280 ? 4 : 5);
        const dates = trends.map(item => item.date);
        const rates = trends.map(item => fmt(item.compliance_rate, 1));
        const failing = trends.map(item => num(item.metrics_failing, 0));

        state.charts.trend.setOption({
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis' },
            legend: {
                top: 6,
                textStyle: { color: chartTextColor() },
                data: [tr('failingItems'), tr('passRate')]
            },
            grid: { left: 42, right: 54, top: 54, bottom: 34 },
            xAxis: {
                type: 'category',
                data: dates,
                axisLine: { lineStyle: { color: 'rgba(183,203,224,0.34)' } },
                axisLabel: { color: chartTextColor(), fontSize: 11 }
            },
            yAxis: [
                {
                    type: 'value',
                    min: 0,
                    max: 100,
                    splitNumber,
                    axisLabel: { color: chartTextColor(), formatter: '{value}%', fontSize: 10, margin: 6 },
                    splitLine: { lineStyle: { color: 'rgba(120,190,255,0.12)' } }
                },
                {
                    type: 'value',
                    min: 0,
                    splitNumber,
                    axisLabel: { color: chartTextColor(), fontSize: 10, margin: 8 },
                    splitLine: { show: false }
                }
            ],
            animationDuration: 2000,
            animationEasing: 'cubicOut',
            series: [
                {
                    name: tr('failingItems'),
                    type: 'bar',
                    yAxisIndex: 1,
                    data: failing,
                    barMaxWidth: 16,
                    itemStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(255,93,115,1)' },
                            { offset: 1, color: 'rgba(255,93,115,0.05)' }
                        ]),
                        borderRadius: [4, 4, 0, 0],
                        shadowColor: 'rgba(255,93,115,0.3)',
                        shadowBlur: 8
                    }
                },
                {
                    name: tr('passRate'),
                    type: 'line',
                    smooth: true,
                    data: rates,
                    symbolSize: 0,
                    lineStyle: { width: 3, color: '#39d5ff', shadowColor: 'rgba(57,213,255,0.8)', shadowBlur: 12 },
                    itemStyle: { color: '#39d5ff' },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(57,213,255,0.38)' },
                            { offset: 1, color: 'rgba(57,213,255,0.02)' }
                        ])
                    }
                },
                {
                    name: tr('passRate'),
                    type: 'effectScatter',
                    data: rates,
                    symbolSize: 6,
                    showEffectOn: 'render',
                    rippleEffect: {
                        brushType: 'stroke',
                        scale: 4,
                        period: 3
                    },
                    itemStyle: {
                        color: '#baffdf',
                        shadowBlur: 14,
                        shadowColor: '#38e6a3'
                    },
                    zlevel: 2
                }
            ]
        }, true);
    }

    let metricsCarouselInterval = null;

    function startMetricsCarousel(count) {
        if (metricsCarouselInterval) clearInterval(metricsCarouselInterval);
        if (count <= 1) return;

        let currentIndex = 0;
        metricsCarouselInterval = setInterval(() => {
            const carousel = $('failingMetricsCarousel');
            if (!carousel) {
                clearInterval(metricsCarouselInterval);
                return;
            }
            const slides = carousel.querySelectorAll('.carousel-slide');
            if (!slides.length) return;

            const prevIndex = currentIndex;
            currentIndex = (currentIndex + 1) % count;

            slides.forEach((slide, i) => {
                slide.classList.remove('active', 'prev');
                if (i === currentIndex) slide.classList.add('active');
                if (i === prevIndex) slide.classList.add('prev');
            });
        }, 5000);
    }

    function renderRiskChart() {
        const dom = $('riskChart');
        if (!dom || !window.echarts) return;
        if (state.charts.risk && state.charts.risk.getDom && state.charts.risk.getDom() !== dom) {
            state.charts.risk.dispose();
            state.charts.risk = null;
        }
        if (!state.charts.risk) state.charts.risk = echarts.init(dom);
        const failingByCat = groupFailingCustomers();
        const data = failingByCat.slice(0, 7).map(item => ({
            name: translated(item.cat),
            value: item.count
        }));

        const option = {
            tooltip: {
                trigger: 'item',
                backgroundColor: 'rgba(15,23,42,0.9)',
                borderColor: '#4a5b7d',
                textStyle: { color: '#e2e8f0' }
            },
            series: [{
                type: 'pie',
                radius: ['45%', '72%'],
                center: ['50%', '50%'],
                avoidLabelOverlap: true,
                itemStyle: {
                    borderRadius: 6,
                    borderColor: 'rgba(15,23,42,0.8)',
                    borderWidth: 2,
                    shadowBlur: 10,
                    shadowColor: 'rgba(0, 0, 0, 0.4)'
                },
                label: {
                    show: true,
                    formatter: params => `${params.name}\n${params.value}${tr('itemUnit')}`,
                    color: '#9fb9d4',
                    fontSize: 11,
                    lineHeight: 14
                },
                labelLine: { length: 8, length2: 8, lineStyle: { color: '#4a5b7d' } },
                data: data.length ? data : [{ name: tr('noRisk'), value: 0 }],
                animationType: 'scale',
                animationEasing: 'elasticOut',
                animationDelay: function (idx) {
                    return Math.random() * 200;
                }
            }],
            color: ['#ff5d73', '#ff8fa0', '#f59e0b', '#fbbf24', '#38bdf8', '#7dd3fc', '#818cf8']
        };
        state.charts.risk.setOption(option);
    }

    function renderFailingMetricsCarousel() {
        const carousel = $('failingMetricsCarousel');
        if (!carousel) return;

        const latest = state.latest || {};
        const prevMetrics = latest.previous_metrics || [];
        const trends = state.trends || [];
        const prevTrend = trends.length > 1 ? trends[trends.length - 2] : null;
        const currTrend = trends.length > 0 ? trends[trends.length - 1] : null;

        let dateStr = '';
        if (currTrend && currTrend.date && prevTrend && prevTrend.date) {
            dateStr = `(${tr('period', { start: prevTrend.date, end: currTrend.date })})`;
        } else if (prevTrend && prevTrend.date) {
            dateStr = `(${tr('previousCapture', { date: prevTrend.date })})`;
        } else if (currTrend && currTrend.date) {
            dateStr = `(${tr('currentCapture', { date: currTrend.date })})`;
        }

        const metrics = Array.isArray(latest.metrics) ? latest.metrics : [];
        const failing = metrics.filter(item => Number(item.is_failing) === 1);

        if (!failing.length) {
            if (state.charts.risk) {
                state.charts.risk.dispose();
                state.charts.risk = null;
            }
            carousel.innerHTML = `<div class="empty">${escapeHTML(tr('noFailingCarousel'))}</div>`;
            return;
        }

        const grouped = {};
        failing.forEach(item => {
            const label = item.metric_label || '未命名指标';
            if (!grouped[label]) grouped[label] = { label, rows: [] };
            grouped[label].rows.push(item);
        });
        const metricGroups = Object.values(grouped).sort((a, b) => {
            return getMetricSortIndex(a.label) - getMetricSortIndex(b.label) || b.rows.length - a.rows.length || a.label.localeCompare(b.label);
        });

        const parseNumberVal = (val) => {
            if (val === null || val === undefined) return null;
            if (typeof val === 'number') return val;
            const match = String(val).match(/-?\d+(\.\d+)?/);
            return match ? parseFloat(match[0]) : null;
        };

        const getPrevValue = (catName, metricLabel) => {
            const prev = prevMetrics.find(p => p.cat_name === catName && p.metric_label === metricLabel);
            return prev ? parseNumberVal(prev.num_val ?? prev.raw_val) : null;
        };

        const firstSlide = `
            <div class="carousel-slide active" data-index="0">
                <div class="carousel-metric-name">${escapeHTML(tr('concentrationByCustomer'))}</div>
                <div id="riskChart" class="chart" style="flex:1;"></div>
            </div>
        `;

        const MAX_LINES_PER_SLIDE = 7;
        const slidesData = [];
        let currentSlideGroups = [];
        let currentSlideLines = 0;

        for (const group of metricGroups) {
            const groupLines = 1.5 + group.rows.length;
            if (currentSlideGroups.length === 0) {
                currentSlideGroups.push(group);
                currentSlideLines += groupLines;
            } else if (currentSlideLines + groupLines <= MAX_LINES_PER_SLIDE) {
                currentSlideGroups.push(group);
                currentSlideLines += groupLines;
            } else {
                slidesData.push(currentSlideGroups);
                currentSlideGroups = [group];
                currentSlideLines = groupLines;
            }
        }
        if (currentSlideGroups.length > 0) {
            slidesData.push(currentSlideGroups);
        }

        const slidesHtml = slidesData.map((groupsInSlide, slideIdx) => {
            const index = slideIdx + 1;

            return `
                <div class="carousel-slide" data-index="${index}" style="display:flex; flex-direction:column; gap:16px;">
                    ${groupsInSlide.map(group => {
                const sortedRows = [...group.rows].sort((a, b) => failSeverityScore(b) - failSeverityScore(a));
                const isSingle = groupsInSlide.length === 1;

                return `
                            <div style="display:flex; flex-direction:column; gap:6px; ${isSingle ? 'flex:1; overflow:hidden;' : ''}">
                                <div class="carousel-metric-name" style="display:flex; justify-content:space-between; align-items:flex-end; flex-shrink:0;">
                                    <div>
                                        ${escapeHTML(translated(group.label))} 
                                        <span style="font-size:12px;color:#9fb9d4;font-weight:normal;margin-left:6px;">${escapeHTML(dateStr)}</span>
                                    </div>
                                    <div style="font-size:12px;color:#9fb9d4;font-weight:normal;padding-right:4px;">${escapeHTML(tr('change'))}</div>
                                </div>
                                <div class="carousel-metric-details" style="${isSingle ? '' : 'flex:none; overflow-y:visible;'}">
                                    ${sortedRows.map(row => {
                    const curVal = parseNumberVal(row.num_val ?? row.raw_val);
                    const prevVal = getPrevValue(row.cat_name, row.metric_label);
                    let diffHtml = '<span class="carousel-cat-diff flat">-</span>';

                    if (prevVal !== null && curVal !== null) {
                        const diff = curVal - prevVal;
                        if (Math.abs(diff) > 0.001) {
                            if (diff > 0) {
                                diffHtml = '<span class="carousel-cat-diff up">↑ ' + fmt(Math.abs(diff), 1) + '</span>';
                            } else if (diff < 0) {
                                diffHtml = '<span class="carousel-cat-diff down">↓ ' + fmt(Math.abs(diff), 1) + '</span>';
                            }
                        }
                    }

                    const isZero = curVal === 0;

                    return `
                                            <div class="carousel-cat-row ${isZero ? 'zero-alert' : ''}">
                                                <div class="carousel-cat-name" title="${escapeHTML(translated(row.cat_name))}">${escapeHTML(translated(row.cat_name))}</div>
                                                <div class="carousel-cat-vals">
                                                    ${escapeHTML(tr('target'))}: ${escapeHTML(row.target_val)} | ${escapeHTML(tr('current'))}: <strong class="${isZero ? 'text-red' : ''}">${escapeHTML(row.raw_val ?? row.num_val)}</strong>
                                                </div>
                                                <div>${diffHtml}</div>
                                            </div>
                                        `;
                }).join('')}
                                </div>
                            </div>
                        `;
            }).join('')}
                </div>
            `;
        }).join('');

        if (state.charts.risk) {
            state.charts.risk.dispose();
            state.charts.risk = null;
        }
        carousel.innerHTML = firstSlide + slidesHtml;
        window.requestAnimationFrame(() => {
            renderRiskChart();
        });
        startMetricsCarousel(slidesData.length + 1);
    }

    function renderSourceStrip() {
        const trendMeta = window.API.getLastDataSourceMeta(state.monthlyPath) || window.API.getLastDataSourceMeta('/api/db/monthly_report_data') || {};
        const snapshotsMeta = window.API.getLastDataSourceMeta('/api/db/snapshots') || {};
        const refreshTime = state.lastSuccessfulRefreshAt || new Date();
        const now = refreshTime.toLocaleString('zh-CN', { hour12: false });
        const status = state.refreshStatusKey ? tr(state.refreshStatusKey) : (state.refreshStatus || tr('statusSynced'));
        const statusClass = status.includes('失败') || status.includes('failed') ? 'warn' : (status.includes('更新') || status.includes('updated') ? 'good' : '');
        $('sourceStrip').innerHTML = `
            <span>${escapeHTML(tr('trendSource'))}: ${escapeHTML(sourceLabel(trendMeta.primary))}</span>
            <span>${escapeHTML(tr('snapshotSource'))}: ${escapeHTML(sourceLabel(snapshotsMeta.primary))}</span>
            <span>${escapeHTML(tr('latestRefresh'))}: ${escapeHTML(now)}</span>
            <span class="refresh-status ${statusClass}">${escapeHTML(status)}</span>
            <span>${escapeHTML(tr('dataScope'))}</span>
        `;
    }

    function renderSubtitle() {
        const trends = state.trends || [];
        const latest = state.latest || {};
        if (!trends.length) {
            $('bigscreenSubtitle').textContent = tr('noDataSubtitle');
            $('bigscreenStatus').textContent = tr('sourceRefreshNoData');
            return;
        }
        const start = trends[0].date;
        const end = trends[trends.length - 1].date;
        $('bigscreenSubtitle').textContent = tr('subtitle', { start, end, snapshot: latest.snapshot_id || '-', month: latest.month || '-' });
        $('bigscreenStatus').textContent = tr('sourceRefreshStatus');
    }

    function renderEmptyPage(message) {
        $('kpiRow').innerHTML = '';
        ['rankList', 'weakList', 'metricList'].forEach(id => {
            $(id).innerHTML = `<div class="empty">${escapeHTML(message)}</div>`;
        });
        Object.values(state.charts).forEach(chart => chart && chart.clear && chart.clear());
        renderSubtitle();
        renderSourceStrip();
    }

    function applySnapshotExtras(latest) {
        if (!latest || !latest.raw_data_json) return [];
        const metricOrder = [];
        try {
            const raw = typeof latest.raw_data_json === 'string'
                ? JSON.parse(latest.raw_data_json)
                : latest.raw_data_json;

            if (raw && Array.isArray(raw.specialMetricAlerts)) {
                if (!latest.metrics) latest.metrics = [];
                raw.specialMetricAlerts.forEach(alert => {
                    const label = alert.metric_label || alert.metricLabel;
                    const exists = latest.metrics.some(m => m.metric_label === label && m.cat_name === '整体');
                    if (!exists) {
                        latest.metrics.push({
                            cat_name: '整体',
                            metric_label: label,
                            target_val: alert.target_val || alert.targetValue || '-',
                            raw_val: alert.global_val || alert.globalValue || '-',
                            num_val: parseFloat(alert.global_val || alert.globalValue) || 0,
                            is_failing: 1,
                            is_special_alert: true
                        });
                    }
                });
            }

            if (Array.isArray(latest.metrics)) {
                latest.metrics.forEach(m => {
                    if (m.is_special_alert) return;
                    const lbl = m.metric_label || '未命名指标';
                    if (!metricOrder.includes(lbl)) metricOrder.push(lbl);
                });

                if (raw && Array.isArray(raw.topMetrics)) {
                    const topOrder = raw.topMetrics.map(m => m.label || m.metricLabel);
                    const specialLabels = [...new Set(latest.metrics.filter(m => m.is_special_alert).map(m => m.metric_label || '未命名指标'))];

                    specialLabels.forEach(lbl => {
                        const topIdx = topOrder.indexOf(lbl);
                        if (topIdx >= 0) {
                            let insertAfterIdx = -1;
                            for (let i = topIdx - 1; i >= 0; i--) {
                                const prevLbl = topOrder[i];
                                const prevInUnique = metricOrder.indexOf(prevLbl);
                                if (prevInUnique >= 0) {
                                    insertAfterIdx = prevInUnique;
                                    break;
                                }
                            }
                            metricOrder.splice(insertAfterIdx + 1, 0, lbl);
                        } else {
                            metricOrder.push(lbl);
                        }
                    });
                } else {
                    const specialLabels = [...new Set(latest.metrics.filter(m => m.is_special_alert).map(m => m.metric_label || '未命名指标'))];
                    metricOrder.push(...specialLabels);
                }
            }
        } catch (e) {
            console.warn('[bigscreen] parse special metrics failed:', e);
        }
        return metricOrder;
    }

    function makeRefreshSignature(payload) {
        try {
            return JSON.stringify(payload);
        } catch (e) {
            return `${Date.now()}`;
        }
    }

    function updateI18nMapFromConfig(config) {
        const loaded = config && config.prefs && config.prefs.i18nMap;
        const clean = {};
        Object.entries(loaded || {}).forEach(([key, value]) => {
            clean[key] = cleanI18nValue(value);
        });
        state.i18nMap = clean;
    }

    function renderAll() {
        if (!state.trends.length || !state.latest) {
            renderEmptyPage(tr('noReportData'));
            return;
        }
        renderSubtitle();
        renderKpis();
        renderRankList();
        renderWeakList();
        renderMetricList();
        renderTrendChart();
        renderFailingMetricsCarousel();
        renderManualAdjustStrip();
        renderSourceStrip();
    }

    async function loadBigscreenData(options = {}) {
        const silent = Boolean(options.silent);
        const source = options.source || (silent ? 'auto' : 'manual');
        if (state.isRefreshing) return;
        state.isRefreshing = true;
        if (!silent) setLoading(true);
        try {
            const range = getCurrentRange();
            state.monthlyPath = `/api/db/monthly_report_data${range.query}`;
            const [monthlyData, snapshots, owners, globalConfig] = await Promise.all([
                window.API.get(state.monthlyPath),
                window.API.get('/api/db/snapshots'),
                window.API.get('/api/db/config/bigscreen_owners').then(data => (
                    Array.isArray(data && data.items) ? data.items : []
                )).catch(error => {
                    console.warn('[bigscreen] owners config unavailable:', error.message);
                    return [];
                }),
                window.API.get('/api/sla/config').catch(() => ({}))
            ]);

            const nextLatest = monthlyData ? monthlyData.latest_snapshot : null;
            const nextMetricOrder = applySnapshotExtras(nextLatest);
            const nextTrends = Array.isArray(monthlyData && monthlyData.trends) ? monthlyData.trends : [];
            const nextSnapshots = Array.isArray(snapshots) ? snapshots : [];
            const nextOwners = Array.isArray(owners) ? owners : [];
            const nextGlobalConfig = globalConfig || {};
            updateI18nMapFromConfig(nextGlobalConfig);
            const nextSignature = makeRefreshSignature({
                trends: nextTrends,
                latest: nextLatest,
                snapshots: nextSnapshots,
                owners: nextOwners,
                globalConfig: nextGlobalConfig
            });
            const hasRenderedData = Boolean(state.lastRefreshSignature);
            const unchanged = hasRenderedData && nextSignature === state.lastRefreshSignature;

            state.lastSuccessfulRefreshAt = new Date();
            if (unchanged) {
                state.refreshStatusKey = source === 'auto' ? 'statusAutoNoChange' : 'statusManualNoChange';
                state.refreshStatus = '';
                renderSourceStrip();
                return;
            }

            state.globalConfig = nextGlobalConfig;
            state.trends = nextTrends;
            state.latest = nextLatest;
            state.metricOrder = nextMetricOrder;
            state.snapshots = nextSnapshots;
            state.owners = nextOwners;
            state.lastRefreshSignature = nextSignature;
            state.refreshStatusKey = hasRenderedData ? 'statusUpdated' : 'statusLoaded';
            state.refreshStatus = '';
            renderAll();
        } catch (error) {
            if(source==='initial')window.ToolsPageStartup?.issue('data',error);
            console.error('[bigscreen] load failed:', error);
            const hasRenderedData = Boolean(state.lastRefreshSignature);
            state.refreshStatusKey = hasRenderedData ? 'statusFailedKeep' : '';
            state.refreshStatus = hasRenderedData ? '' : tr('loadFailedShort', { message: error.message });
            if (!silent && window.showToast) window.showToast(tr('loadFailed', { message: error.message }), 'error');
            if (hasRenderedData) {
                renderSourceStrip();
            } else {
                renderEmptyPage(tr('loadFailedShort', { message: error.message }));
            }
        } finally {
            state.isRefreshing = false;
            if (!silent) setLoading(false);
        }
    }

    function initControls() {
        const rangeSelect = $('rangeSelect');
        const startInput = $('startDate');
        const endInput = $('endDate');
        if (rangeSelect) {
            rangeSelect.addEventListener('change', () => {
                const custom = rangeSelect.value === 'custom';
                if (!custom) loadBigscreenData({ source: 'range' });
                if (startInput) startInput.disabled = !custom;
                if (endInput) endInput.disabled = !custom;
            });
        }
        if (startInput) startInput.disabled = true;
        if (endInput) endInput.disabled = true;
        if ($('refreshBtn')) $('refreshBtn').addEventListener('click', () => loadBigscreenData({ source: 'manual' }));
        if ($('ownerConfigBtn')) $('ownerConfigBtn').addEventListener('click', openOwnerModal);
        if ($('exportHtmlBtn')) $('exportHtmlBtn').addEventListener('click', exportStandaloneHtml);
        if ($('autoLanguageBtn')) $('autoLanguageBtn').addEventListener('click', toggleAutoLanguage);
        if ($('autoLanguageSeconds')) {
            $('autoLanguageSeconds').addEventListener('change', () => {
                const seconds = readAutoLanguageSeconds();
                $('autoLanguageSeconds').value = seconds;
                localStorage.setItem(AUTO_LANGUAGE_SECONDS_KEY, String(seconds));
                if (state.autoLanguageTimer) startAutoLanguage();
            });
        }
        if ($('ownerAvatarInput')) $('ownerAvatarInput').addEventListener('change', handleOwnerAvatarChange);
        if ($('rankList')) {
            $('rankList').addEventListener('click', event => {
                if (event.target && event.target.closest('[data-score-theme-trigger="true"]')) {
                    cycleRankScoreTheme();
                }
            });
        }
        const titleEl = $('bigscreenTitle');
        if (titleEl) {
            titleEl.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openTitleModal();
                }
            });
        }
        document.addEventListener('fullscreenchange', syncFullscreenButton);
        syncFullscreenButton();
        window.addEventListener('tools:languagechange', () => {
            applyStaticI18n();
            renderScriptVersion();
            if (state.trends.length && state.latest) renderAll();
            else renderSubtitle();
            renderOwnerOptions();
            renderOwnerRows();
        });
        window.addEventListener('resize', () => {
            Object.values(state.charts).forEach(chart => chart && chart.resize && chart.resize());
        });
    }

    function readAutoLanguageSeconds() {
        const input = $('autoLanguageSeconds');
        const seconds = Number.parseInt(input && input.value, 10);
        return Math.max(5, Math.min(300, Number.isFinite(seconds) ? seconds : 20));
    }

    function syncAutoLanguageControls() {
        const button = $('autoLanguageBtn');
        const input = $('autoLanguageSeconds');
        const unit = $('autoLanguageUnit');
        const active = Boolean(state.autoLanguageTimer);
        if (button) {
            button.textContent = active ? tr('stopAutoLanguage') : tr('autoLanguage');
            button.setAttribute('aria-pressed', String(active));
        }
        if (input) {
            input.setAttribute('aria-label', tr('autoLanguageSeconds'));
            input.title = tr('autoLanguageSeconds');
        }
        if (unit) unit.textContent = tr('secondsUnit');
    }

    function switchLanguageWithTransition() {
        if (state.languageTransitioning || document.hidden || !window.ToolsI18n) return;
        state.languageTransitioning = true;
        const screen = document.querySelector('.bigscreen');
        if (screen) screen.classList.add('language-transitioning');
        window.setTimeout(() => window.ToolsI18n.toggleLanguage(), 180);
        window.setTimeout(() => {
            if (screen) screen.classList.remove('language-transitioning');
            state.languageTransitioning = false;
        }, 420);
    }

    function stopAutoLanguage() {
        if (state.autoLanguageTimer) window.clearInterval(state.autoLanguageTimer);
        state.autoLanguageTimer = null;
        syncAutoLanguageControls();
    }

    function startAutoLanguage() {
        stopAutoLanguage();
        const seconds = readAutoLanguageSeconds();
        localStorage.setItem(AUTO_LANGUAGE_SECONDS_KEY, String(seconds));
        state.autoLanguageTimer = window.setInterval(switchLanguageWithTransition, seconds * 1000);
        syncAutoLanguageControls();
    }

    function toggleAutoLanguage() {
        if (state.autoLanguageTimer) stopAutoLanguage();
        else startAutoLanguage();
    }

    window.BigscreenOwners = {
        add: addOwnerDraft,
        remove: removeOwnerDraft,
        edit: editOwnerDraft,
        save: saveOwners,
        open: openOwnerModal,
        close: closeOwnerModal
    };

    function openTitleModal() {
        const titleInfo = normalizeDashboardTitle(state.dashboardTitle);
        const zhInput = $('titleZhInput');
        const enInput = $('titleEnInput');
        if (zhInput) zhInput.value = titleInfo.zh;
        if (enInput) enInput.value = titleInfo.en;
        const modal = $('titleModal');
        if (modal) {
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
        }
        applyStaticI18n();
        setTimeout(() => {
            const focusInput = isEn() ? enInput : zhInput;
            if (focusInput) focusInput.focus();
        }, 0);
    }

    function closeTitleModal() {
        const modal = $('titleModal');
        if (modal) {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    async function saveDashboardTitle() {
        const defaults = defaultDashboardTitle();
        const zh = String(($('titleZhInput') && $('titleZhInput').value) || '').trim() || defaults.zh;
        const en = String(($('titleEnInput') && $('titleEnInput').value) || '').trim() || defaults.en;
        const nextTitle = { zh, en };
        state.dashboardTitle = nextTitle;
        renderDashboardTitle();

        try {
            await window.API.post('/api/db/config/bigscreen_title', nextTitle);
            closeTitleModal();
            if (window.showToast) window.showToast(tr('titleSaved'));
        } catch (err) {
            console.error('保存大标题失败', err);
            if (window.showToast) window.showToast(tr('titleSaveFail', { message: err.message }), 'error');
        }
    }

    window.BigscreenTitle = {
        open: openTitleModal,
        close: closeTitleModal,
        save: saveDashboardTitle
    };

    function openContactModal() {
        const info = normalizeContactInfo(state.contactInfo);
        const zhInput = $('contactZhInput');
        const enInput = $('contactEnInput');
        if (zhInput) zhInput.value = info.zh;
        if (enInput) enInput.value = info.en;
        const modal = $('contactModal');
        if (modal) {
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
        }
        applyStaticI18n();
        setTimeout(() => {
            const focusInput = isEn() ? enInput : zhInput;
            if (focusInput) focusInput.focus();
        }, 0);
    }

    function closeContactModal() {
        const modal = $('contactModal');
        if (modal) {
            modal.classList.remove('open');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    async function saveContactInfo() {
        const defaults = defaultContactInfo();
        const zh = String(($('contactZhInput') && $('contactZhInput').value) || '').trim() || defaults.zh;
        const en = String(($('contactEnInput') && $('contactEnInput').value) || '').trim() || defaults.en;
        const nextInfo = { zh, en };
        state.contactInfo = nextInfo;
        renderContactInfo();

        try {
            await window.API.post('/api/db/config/bigscreen_contact_info', nextInfo);
            closeContactModal();
            if (window.showToast) window.showToast(tr('contactSaved'));
        } catch (err) {
            console.error('保存联系信息失败', err);
            if (window.showToast) window.showToast(tr('contactSaveFail', { message: err.message }), 'error');
        }
    }

    window.BigscreenContact = {
        open: openContactModal,
        close: closeContactModal,
        save: saveContactInfo
    };

    window.editContactInfo = function () {
        openContactModal();
    };

    function syncFullscreenButton() {
        const btn = $('fullscreenBtn');
        const text = $('fullscreenBtnText');
        const isFullscreen = Boolean(document.fullscreenElement);
        if (text) text.textContent = isFullscreen ? tr('exitFullscreen') : tr('fullscreen');
        if (btn) btn.title = isFullscreen ? tr('exitFullscreenTitle') : tr('fullscreenTitle');
    }

    window.toggleFullScreen = function () {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log(`Error attempting to enable fullscreen: ${err.message}`);
                if (window.showToast) window.showToast((isEn() ? 'Unable to enter fullscreen: ' : '无法全屏: ') + err.message, 'error');
                syncFullscreenButton();
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().catch(err => {
                    console.log(`Error attempting to exit fullscreen: ${err.message}`);
                    if (window.showToast) window.showToast((isEn() ? 'Unable to exit fullscreen: ' : '退出全屏失败: ') + err.message, 'error');
                });
            }
        }
    };

    document.addEventListener('DOMContentLoaded', async () => {
        const startup=window.ToolsPageStartup,load=(key,work)=>startup?startup.run(key,work):work();
        loadRankScoreTheme();
        const savedLanguageSeconds = Number.parseInt(localStorage.getItem(AUTO_LANGUAGE_SECONDS_KEY), 10);
        if ($('autoLanguageSeconds') && Number.isFinite(savedLanguageSeconds)) {
            $('autoLanguageSeconds').value = Math.max(5, Math.min(300, savedLanguageSeconds));
        }
        const titleLoading=load('title',()=>window.API.get('/api/db/config/bigscreen_title').then(res => {
            state.dashboardTitle = normalizeDashboardTitle(res);
            renderDashboardTitle();
        }).catch(err => {
            startup?.issue('title',err);
            console.error('Failed to load dashboard title', err);
            state.dashboardTitle = defaultDashboardTitle();
            renderDashboardTitle();
        }));

        const contactLoading=load('contact',()=>window.API.get('/api/db/config/bigscreen_contact_info').then(res => {
            state.contactInfo = normalizeContactInfo(res);
            renderContactInfo();
        }).catch(err => {
            startup?.issue('contact',err);
            console.error('Failed to load contact info', err);
            state.contactInfo = defaultContactInfo();
            renderContactInfo();
        }));

        initControls();
        applyStaticI18n();
        renderScriptVersion();
        const dataLoading=load('data',()=>loadBigscreenData({ source: 'initial' }));
        state.refreshTimer = setInterval(() => {
            loadBigscreenData({ silent: true, source: 'auto' });
        }, 5 * 60 * 1000);
        const results=await Promise.allSettled([titleLoading,contactLoading,dataLoading]);const error=results.find(result=>result.status==='rejected');if(error)startup?.fail(error.reason);else await startup?.finish();
    });
})();
